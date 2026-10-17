/**
 * Reading from a tenant's backend without trusting it to be small, quick or well:
 * - Every request has two time limits: nothing arriving for `timeoutMs` (no answer, or a body that
 *   stops), and the whole response taking longer than `totalTimeoutMs`. A slow link that keeps
 *   delivering is waited for; a dead one is not (found by tools/stress/throttle.mjs: a 1.7 MB page of
 *   well headers on a 400 kbit/s link was cut off at 30 s, then fetched again twice).
 * - A server error, a 429 or a 503 is retried, waiting as long as `Retry-After` asks (capped) or
 *   longer each time; a 401 is retried once after the caller has refreshed its sign-in; other
 *   client errors are not retried.
 * - A body larger than the cap is refused as it streams in, before it can fill the tab's memory.
 *   This holds whether or not the server says how large it is.
 * - Cancelling (leaving a field before it loads) stops the request.
 * - No error ever carries the request's headers: a token cannot leak through a message.
 */

export interface GuardAuth {
  /** The bearer token for this request, or null for none. */
  token(): Promise<string | null>;
  /**
   * Called once on a 401, with the token that was refused; the request is then retried with
   * `token()` again. A provider may skip the refresh when that token has already been replaced.
   */
  onUnauthorized?(rejected: string | null): Promise<void>;
}

export interface GuardOptions {
  readonly method?: "GET" | "POST" | "PUT" | "DELETE";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
  /** The longest wait with nothing arriving: for the answer, then between pieces of the body. 30 s. */
  readonly timeoutMs?: number;
  /** The longest a whole response may take, however steadily it arrives. 10 minutes. */
  readonly totalTimeoutMs?: number;
  readonly maxBytes?: number;
  readonly retries?: number;
  /** The longest `Retry-After` honoured, in ms; a server asking for more is treated as failed. */
  readonly maxRetryAfterMs?: number;
  readonly signal?: AbortSignal;
  readonly auth?: GuardAuth;
  /** For the tests: the fetch to use. */
  readonly fetcher?: typeof fetch;
}

export interface GuardedResponse { readonly status: number; readonly headers: Headers; readonly bytes: Uint8Array }

export class TooLarge extends Error {}
/** A response the guard will not retry: the status, and the start of the body for the reader. */
export class HttpError extends Error {
  readonly status: number;
  readonly bodyText: string;
  constructor(status: number, bodyText: string, url: string) {
    super(`HTTP ${status} from ${redact(url)}${bodyText ? `: ${bodyText.slice(0, 200)}` : ""}`);
    this.status = status;
    this.bodyText = bodyText;
  }
}

/** A URL with any query string removed: a signed URL's signature never lands in a message. */
const redact = (url: string) => url.replace(/\?.*$/, "");

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});

/** `Retry-After` as milliseconds: seconds, or an HTTP date; null when absent or unreadable. */
export function retryAfterMs(headers: Headers): number | null {
  const value = headers.get("retry-after");
  if (!value) return null;
  if (/^\d+$/.test(value.trim())) return Number(value) * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

export async function fetchGuarded(url: string, options: GuardOptions = {}): Promise<GuardedResponse> {
  const { method = "GET", headers = {}, body, timeoutMs = 30_000, totalTimeoutMs = 600_000, maxBytes = 64 * 1048576, retries = 2, maxRetryAfterMs = 30_000, signal, auth, fetcher = fetch } = options;
  let refreshed = false;
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const stop = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", stop, { once: true });
    let timer = setTimeout(() => controller.abort(new Error(`no answer in ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    /** Bytes arrived: the idle limit starts again. */
    const alive = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(new Error(`no data for ${Math.round(timeoutMs / 1000)} s`)), timeoutMs); };
    const deadline = setTimeout(() => controller.abort(new Error(`not finished in ${totalTimeoutMs >= 60_000 ? `${Math.round(totalTimeoutMs / 60_000)} min` : `${Math.round(totalTimeoutMs / 1000)} s`}`)), totalTimeoutMs);
    try {
      const token = await auth?.token();
      // Cancelled while the token was being fetched: nothing is sent.
      if (controller.signal.aborted) throw controller.signal.reason;
      const sent: Record<string, string> = { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) };
      const response = await fetcher(url, { method, headers: sent, body: body as BodyInit | undefined, signal: controller.signal });
      alive();
      if (response.status === 401 && auth?.onUnauthorized && !refreshed) { refreshed = true; await auth.onUnauthorized(token ?? null); continue; }
      if (response.status === 429 || response.status === 503 || (response.status >= 500 && response.status !== 503)) {
        if (attempt < retries) {
          const asked = retryAfterMs(response.headers);
          if (asked !== null && asked > maxRetryAfterMs) throw new HttpError(response.status, `asked to wait ${Math.round(asked / 1000)} s`, url);
          // A 429 whose Retry-After the browser hides (a platform that does not expose it to CORS) is
          // waited out from a second, the least a rate limiter usually asks; other failures from half that.
          await sleep(asked ?? (response.status === 429 ? 1000 : 500) * 2 ** attempt, signal);
          continue;
        }
        throw new HttpError(response.status, await response.text().catch(() => ""), url);
      }
      if (!response.ok) throw new HttpError(response.status, await response.text().catch(() => ""), url);
      const declared = Number(response.headers.get("content-length") ?? NaN);
      if (Number.isFinite(declared) && declared > maxBytes) throw new TooLarge(`${(declared / 1048576).toFixed(0)} MB is over the ${(maxBytes / 1048576).toFixed(0)} MB a single response may be`);
      if (!response.body) { const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.byteLength > maxBytes) throw new TooLarge(`over ${(maxBytes / 1048576).toFixed(0)} MB, the most a single response may be`); return { status: response.status, headers: response.headers, bytes }; }
      // Counted as it arrives, so a server that does not say its size is stopped all the same.
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        alive();
        total += value.byteLength;
        if (total > maxBytes) { controller.abort(); throw new TooLarge(`over ${(maxBytes / 1048576).toFixed(0)} MB, the most a single response may be`); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let at = 0;
      for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
      return { status: response.status, headers: response.headers, bytes };
    } catch (cause) {
      if (signal?.aborted || cause instanceof TooLarge || cause instanceof HttpError) throw cause;
      // A server that never answered, or stopped mid-body, may answer another time; one that was
      // still sending at the overall limit would only be cut off again.
      const reason = controller.signal.aborted ? controller.signal.reason : cause;
      const retryable = cause instanceof TypeError || (reason instanceof Error && /no answer|no data/.test(reason.message));
      if (retryable && attempt < retries) { await sleep(500 * 2 ** attempt, signal); continue; }
      throw cause instanceof Error && controller.signal.aborted && controller.signal.reason instanceof Error ? controller.signal.reason : cause;
    } finally {
      clearTimeout(timer);
      clearTimeout(deadline);
      signal?.removeEventListener("abort", stop);
    }
  }
}

/** A JSON body, guarded as above. */
export async function fetchJsonGuarded(url: string, options: GuardOptions = {}): Promise<unknown> {
  const { bytes } = await fetchGuarded(url, { ...options, headers: { accept: "application/json", ...options.headers } });
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * At most `concurrency` tasks at once: the rest wait their turn. One per backend source, so a
 * field's batches, a well's detail and a search never stampede it.
 */
export function limit(concurrency: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => { active--; queue.shift()?.(); };
  return async (task) => {
    if (active >= concurrency) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try { return await task(); } finally { next(); }
  };
}
