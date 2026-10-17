/**
 * Reading from a tenant's backend without trusting it to be small, quick or well:
 * - Every request has a time limit.
 * - A server error is retried twice, waiting longer each time.
 * - A body larger than the cap is refused as it streams in, before it can fill the tab's memory.
 *   This holds whether or not the server says how large it is.
 * - Cancelling (leaving a field before it loads) stops the request.
 */

export interface GuardOptions {
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly retries?: number;
  readonly signal?: AbortSignal;
  /** For the tests: the fetch to use. */
  readonly fetcher?: typeof fetch;
}

export class TooLarge extends Error {}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});

export async function fetchJsonGuarded(url: string, options: GuardOptions = {}): Promise<unknown> {
  const { timeoutMs = 30_000, maxBytes = 64 * 1048576, retries = 2, signal, fetcher = fetch } = options;
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const stop = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(() => controller.abort(new Error(`no answer in ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    try {
      const response = await fetcher(url, { signal: controller.signal });
      if (!response.ok) {
        if (response.status >= 500 && attempt < retries) { await sleep(500 * 2 ** attempt, signal); continue; }
        throw new Error(`HTTP ${response.status}`);
      }
      const declared = Number(response.headers.get("content-length") ?? NaN);
      if (Number.isFinite(declared) && declared > maxBytes) throw new TooLarge(`${(declared / 1048576).toFixed(0)} MB is over the ${(maxBytes / 1048576).toFixed(0)} MB a single file may be: split it into an index and a file per field`);
      if (!response.body) return JSON.parse(await response.text());
      // Counted as it arrives, so a server that does not say its size is stopped all the same.
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) { controller.abort(); throw new TooLarge(`over ${(maxBytes / 1048576).toFixed(0)} MB, the most a single file may be: split it into an index and a file per field`); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let at = 0;
      for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (cause) {
      if (signal?.aborted || cause instanceof TooLarge) throw cause;
      const retryable = cause instanceof TypeError || (cause instanceof Error && /no answer/.test(cause.message));
      if (retryable && attempt < retries) { await sleep(500 * 2 ** attempt, signal); continue; }
      throw cause instanceof Error && controller.signal.aborted && controller.signal.reason instanceof Error ? controller.signal.reason : cause;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    }
  }
}
