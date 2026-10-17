import assert from "node:assert/strict";
import test from "node:test";
import { HttpError, TooLarge, fetchGuarded, fetchJsonGuarded, limit, retryAfterMs } from "./fetch-guard.ts";

const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" }, ...init });
/** A fetch scripted by a list of responses (or throwers), recording what it was asked. */
const scripted = (steps: readonly (Response | Error)[]) => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher: typeof fetch = async (url, init) => { calls.push({ url: String(url), init }); const step = steps[Math.min(calls.length - 1, steps.length - 1)]!; if (step instanceof Error) throw step; return step.clone(); };
  return { fetcher, calls };
};

test("a 429 waits as long as Retry-After asks, then succeeds; a 503 is retried; a server asking too long is given up on", async () => {
  const { fetcher, calls } = scripted([new Response("busy", { status: 429, headers: { "retry-after": "0" } }), new Response("down", { status: 503 }), json({ ok: true })]);
  const started = Date.now();
  assert.deepEqual(await fetchJsonGuarded("https://x.example/a", { fetcher, retries: 2 }), { ok: true });
  assert.equal(calls.length, 3);
  assert.ok(Date.now() - started < 2000);
  const patient = scripted([new Response("busy", { status: 429, headers: { "retry-after": "3600" } })]);
  await assert.rejects(fetchGuarded("https://x.example/a", { fetcher: patient.fetcher }), (error: unknown) => error instanceof HttpError && error.status === 429 && /wait 3600 s/.test(error.message));
  assert.equal(patient.calls.length, 1, "not retried when the wait is longer than allowed");
  assert.equal(retryAfterMs(new Headers({ "retry-after": "2" })), 2000);
  assert.equal(retryAfterMs(new Headers()), null);
});

test("a 401 is retried once after the sign-in is refreshed, with the new token; a second 401 is an error", async () => {
  let token = "old";
  const { fetcher, calls } = scripted([new Response("", { status: 401 }), json({ ok: true })]);
  const result = await fetchJsonGuarded("https://x.example/a", { fetcher, auth: { token: async () => token, onUnauthorized: async () => { token = "new"; } } });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls.map((call) => (call.init?.headers as Record<string, string>).authorization), ["Bearer old", "Bearer new"]);
  const twice = scripted([new Response("", { status: 401 })]);
  await assert.rejects(fetchGuarded("https://x.example/a?sig=SECRET", { fetcher: twice.fetcher, auth: { token: async () => "t", onUnauthorized: async () => {} } }), (error: unknown) => error instanceof HttpError && error.status === 401 && !/SECRET|Bearer/.test(error.message));
  assert.equal(twice.calls.length, 2);
});

test("other client errors are not retried; the message carries the status and the start of the body, never the headers", async () => {
  const { fetcher, calls } = scripted([new Response("no such well", { status: 404 })]);
  await assert.rejects(fetchGuarded("https://x.example/w/1", { fetcher, auth: { token: async () => "TOKEN" } }), (error: unknown) => error instanceof HttpError && error.status === 404 && /no such well/.test(error.message) && !/TOKEN/.test(error.message));
  assert.equal(calls.length, 1);
});

test("a body over the cap is stopped as it streams, before it is all read; a declared size over the cap is refused outright", async () => {
  let sent = 0;
  const big: typeof fetch = async () => new Response(new ReadableStream({ pull(controller) { if (sent >= 3 << 20) { controller.close(); return; } sent += 1 << 16; controller.enqueue(new Uint8Array(1 << 16).fill(32)); } }));
  await assert.rejects(fetchGuarded("x", { fetcher: big, maxBytes: 1 << 20 }), (error: unknown) => error instanceof TooLarge);
  assert.ok(sent < 3 << 20, `stopped after ${sent} bytes`);
  const declared: typeof fetch = async () => new Response("", { headers: { "content-length": String(200 << 20) } });
  await assert.rejects(fetchGuarded("x", { fetcher: declared }), (error: unknown) => error instanceof TooLarge);
});

test("a dead server times out and is retried the configured number of times; cancelling stops everything", async () => {
  let calls = 0;
  // Like fetch: a request on an already-aborted signal rejects at once; otherwise it hangs until aborted.
  const silent: typeof fetch = (_, init) => { calls++; return new Promise((_, reject) => { if (init?.signal?.aborted) reject(init.signal.reason); else init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)); }); };
  await assert.rejects(fetchGuarded("x", { fetcher: silent, timeoutMs: 30, retries: 1 }), /no answer/);
  assert.equal(calls, 2);
  const controller = new AbortController();
  const pending = fetchGuarded("x", { fetcher: silent, timeoutMs: 10_000, signal: controller.signal });
  controller.abort(new Error("left the field"));
  await assert.rejects(pending, /left the field/);
});

test("POST sends its body and headers, and the accept header is set for JSON", async () => {
  const { fetcher, calls } = scripted([json({ results: [] })]);
  await fetchJsonGuarded("https://x.example/search", { fetcher, method: "POST", body: '{"kind":"*"}', headers: { "content-type": "application/json", "data-partition-id": "opendes" } });
  const sent = calls[0]!.init!;
  assert.equal(sent.method, "POST");
  assert.equal(sent.body, '{"kind":"*"}');
  assert.deepEqual(sent.headers, { accept: "application/json", "content-type": "application/json", "data-partition-id": "opendes" });
});

test("limit runs at most N tasks at once and keeps the order of completion honest", async () => {
  const run = limit(2);
  let active = 0, peak = 0;
  const task = (ms: number) => run(async () => { active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, ms)); active--; return ms; });
  const results = await Promise.all([task(30), task(10), task(20), task(5), task(1)]);
  assert.deepEqual(results, [30, 10, 20, 5, 1]);
  assert.equal(peak, 2);
  await assert.rejects(run(async () => { throw new Error("boom"); }), /boom/);
  assert.equal(active, 0, "a failed task releases its slot");
});

test("a 429 whose Retry-After is hidden (not exposed to CORS) is waited out from a second, not half of one", async () => {
  const { fetcher, calls } = scripted([new Response("busy", { status: 429 }), json({ ok: true })]);
  const t0 = Date.now();
  await fetchGuarded("https://x.example/a", { fetcher });
  assert.equal(calls.length, 2);
  assert.ok(Date.now() - t0 >= 990, `waited ${Date.now() - t0} ms`);
});

test("a 401 tells the auth hook which token was refused, then retries once with token() again", async () => {
  const { fetcher } = scripted([new Response("no", { status: 401 }), json({ ok: true })]);
  const refused: (string | null)[] = [];
  let token = "old";
  await fetchGuarded("https://x.example/a", { fetcher, auth: { token: async () => token, onUnauthorized: async (rejected) => { refused.push(rejected); token = "new"; } } });
  assert.deepEqual(refused, ["old"]);
});

/** A body that arrives in pieces, `gapMs` apart; `stallAfter` pieces in, it stops for `stallMs`. */
const trickle = (pieces: number, gapMs: number, stall?: { after: number; ms: number }) => (async (_url: string | URL | Request, init?: RequestInit) => {
  const signal = init?.signal;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let i = 0; i < pieces; i++) {
        const wait = stall && i === stall.after ? stall.ms : gapMs;
        const aborted = await new Promise<boolean>((resolve) => { const t = setTimeout(() => resolve(false), wait); signal?.addEventListener("abort", () => { clearTimeout(t); resolve(true); }, { once: true }); });
        if (aborted) { controller.error(signal?.reason); return; }
        controller.enqueue(new TextEncoder().encode(i === 0 ? "[" : i === pieces - 1 ? "0]" : "0,"));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}) as typeof fetch;

test("a slow body that keeps arriving is waited for past the idle limit; one that stops is cut off and said so", async () => {
  // Twelve pieces 60 ms apart: 720 ms in all, never 200 ms without data.
  const slow = await fetchJsonGuarded("https://x.example/a", { fetcher: trickle(12, 60), timeoutMs: 200, retries: 0 });
  assert.equal((slow as number[]).length, 11);
  // A body that stops for 600 ms half-way: no data for the idle limit.
  await assert.rejects(fetchGuarded("https://x.example/a", { fetcher: trickle(12, 20, { after: 6, ms: 600 }), timeoutMs: 200, retries: 0 }), /no data for/);
  // However steadily it arrives, the overall limit holds.
  await assert.rejects(fetchGuarded("https://x.example/a", { fetcher: trickle(40, 50), timeoutMs: 200, totalTimeoutMs: 500, retries: 0 }), /not finished in/);
});
