// The site's performance budgets, shared by tools/perf-budget.mjs (sizes, from the build) and
// tools/bench-deck.mjs (runtime, in a browser). Sizes are gzip, what crosses the network.
export const BUDGETS = {
  /** JavaScript a page needs before its first draw, gzip kB. The deck's rose from 380 when the config.json parser (core deck-config) joined its startup, 2026-10. */
  initialJs: { "index.html": 100, "deck/index.html": 390, "developers/index.html": 260 },
  /** No single chunk larger than this, gzip kB (MapLibre is the largest, ~280). */
  chunk: 300,
  /** The compute worker, gzip kB. */
  worker: 70,
  /** Any data file served with the site, raw MB (the FORGE PSDM sub-volume is the largest, 4.3). */
  dataFile: 5,
  /** In a browser (tools/bench-deck.mjs), on the local server. */
  runtime: { startupMs: 2500, startupLongTaskMs: 150, moduleLongTaskMs: 100, scene3dLongTaskMs: 200 },
  /** Property-based fuzzing (tools/fuzz/run.mjs): runs per property at each tier, and how long the whole suite may take. */
  fuzz: { runsT0: 500, t0Ms: 120_000, runsT1: 10_000, t1Ms: 1_800_000 },
  /** Fault injection on the mock platform (tools/stress/faults.mjs), at 50 ms latency for a 200-well field. */
  faults: { fieldReadyMs: 8000, baseRequests: 6, requestsPerWell: 2, inFlight: 6, shownWithinMs: 5000 },
  /** A slow machine and a slow link (tools/stress/throttle.mjs): CPU 4×, a VPN (5 Mbit/s, 80 ms), a poor link (400 kbit/s, 400 ms). */
  network: { globeReadyMs: 4000, fieldVpnMs: 15000, fieldPoorMs: 45000, longTaskMs: 400, heapMB: 400 },
};
