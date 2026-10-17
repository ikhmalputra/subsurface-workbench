// Faults a tenant's platform shows under load, injected on purpose and reproducibly: latency and
// jitter, 5xx and 429 (with Retry-After), connections reset mid-response, bodies trickled a few
// bytes a second, JSON cut short, bodies far over size, cursors that have expired, 401 storms, a
// clock out of step. Every random draw comes from one seeded generator, so a run with the same
// --seed and the same requests in the same order gets the same faults.
//
// The admin log beside it counts what the client did about them: statuses per route, connections
// the client closed before the response ended, peak concurrency, and whether a Retry-After was
// honoured (the next request on that route waited at least as long).

export const ROUTES = ["search", "trajectory", "markers"];
const FIELDS = ["latencyMs", "jitterMs", "rate5xx", "rate429", "retryAfterS", "rateReset", "trickleBytesPerS", "truncateJson", "oversizeBytes", "expireCursors", "storm401", "clockSkewS"];
const EMPTY = Object.freeze({ latencyMs: 0, jitterMs: 0, rate5xx: 0, rate429: 0, retryAfterS: 1, rateReset: 0, trickleBytesPerS: 0, truncateJson: false, oversizeBytes: 0, expireCursors: false, storm401: 0, clockSkewS: 0 });

/** A small deterministic generator (mulberry32) on `seed`. */
export function prng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fault spec as the admin API accepts it, checked and completed; throws on a bad field. */
export function normaliseSpec(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new TypeError("a fault spec is an object");
  const out = {};
  for (const [name, value] of Object.entries(spec)) {
    if (name === "route") continue;
    if (!FIELDS.includes(name)) throw new TypeError(`unknown fault field ${name}`);
    const expectBoolean = name === "truncateJson" || name === "expireCursors";
    if (expectBoolean ? typeof value !== "boolean" : typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be ${expectBoolean ? "true or false" : "a non-negative number"}`);
    if (/^rate|^storm/.test(name) && value > 1) throw new TypeError(`${name} is a rate from 0 to 1`);
    out[name] = value;
  }
  const route = spec.route ?? "*";
  if (route !== "*" && !ROUTES.includes(route)) throw new TypeError(`route must be one of ${[...ROUTES, "*"].join(", ")}`);
  return { route, spec: out };
}

export function createFaults({ seed = 7 } = {}) {
  let random = prng(seed);
  const specs = new Map();
  const log = createLog();
  return {
    /** Set the faults for a route (or "*", every route). Fields left out keep their previous values on that route. */
    set(raw) {
      const { route, spec } = normaliseSpec(raw);
      specs.set(route, { ...(specs.get(route) ?? {}), ...spec });
      return this.current();
    },
    current() { return Object.fromEntries([...specs].map(([route, spec]) => [route, { ...EMPTY, ...spec }])); },
    /** Clear every fault and the log, and rewind the generator so the next run repeats. */
    reset() { specs.clear(); random = prng(seed); log.reset(); },
    /** What this request suffers: "*" first, then the route's own settings over it; the draws happen in a fixed order. */
    decide(route) {
      const spec = { ...EMPTY, ...(specs.get("*") ?? {}), ...(specs.get(route) ?? {}) };
      const draws = [random(), random(), random(), random(), random()];
      const latencyMs = spec.latencyMs + Math.round(draws[0] * spec.jitterMs);
      const status = draws[1] < spec.storm401 ? 401 : draws[2] < spec.rate429 ? 429 : draws[3] < spec.rate5xx ? [500, 502, 503][Math.floor(draws[0] * 3)] : null;
      const reset = status === null && draws[4] < spec.rateReset;
      return { latencyMs, status, retryAfterS: spec.retryAfterS, reset, trickleBytesPerS: spec.trickleBytesPerS, truncateJson: spec.truncateJson, oversizeBytes: spec.oversizeBytes, expireCursors: spec.expireCursors, clockSkewS: spec.clockSkewS };
    },
    log,
  };
}

/** The admin log: counts per route and overall, reset with the faults. */
export function createLog() {
  const fresh = () => ({ requests: 0, statuses: {}, aborted: 0, retryAfter: { sent: 0, honoured: 0, ignored: 0 } });
  let routes, total, concurrency, peak, pending, startedAt;
  const reset = () => { routes = Object.fromEntries([...ROUTES, "other"].map((route) => [route, fresh()])); total = fresh(); concurrency = 0; peak = 0; pending = new Map(); startedAt = new Date().toISOString(); };
  reset();
  const bucket = (route) => routes[ROUTES.includes(route) ? route : "other"];
  return {
    reset,
    /** A request began: returns the function to call when it ends. */
    begin(route) {
      concurrency++; peak = Math.max(peak, concurrency);
      const now = Date.now();
      const wait = pending.get(route);
      if (wait) { pending.delete(route); const counter = now >= wait ? "honoured" : "ignored"; bucket(route).retryAfter[counter]++; total.retryAfter[counter]++; }
      bucket(route).requests++; total.requests++;
      let ended = false;
      return ({ status, aborted = false, retryAfterS }) => {
        if (ended) return; ended = true;
        concurrency--;
        for (const entry of [bucket(route), total]) {
          if (status !== undefined) entry.statuses[status] = (entry.statuses[status] ?? 0) + 1;
          if (aborted) entry.aborted++;
          if (status === 429) entry.retryAfter.sent++;
        }
        if (status === 429 && retryAfterS !== undefined) pending.set(route, Date.now() + retryAfterS * 1000);
      };
    },
    snapshot() { return { startedAt, total, routes, concurrency: { current: concurrency, peak } }; },
  };
}
