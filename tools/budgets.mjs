// The site's performance budgets, shared by tools/perf-budget.mjs (sizes, from the build) and
// tools/bench-deck.mjs (runtime, in a browser). Sizes are gzip, what crosses the network.
export const BUDGETS = {
  /** JavaScript a page needs before its first draw, gzip kB. */
  initialJs: { "index.html": 100, "deck/index.html": 380, "developers/index.html": 260 },
  /** No single chunk larger than this, gzip kB (MapLibre is the largest, ~280). */
  chunk: 300,
  /** The compute worker, gzip kB. */
  worker: 70,
  /** Any data file served with the site, raw MB (the FORGE PSDM sub-volume is the largest, 4.3). */
  dataFile: 5,
  /** In a browser (tools/bench-deck.mjs), on the local server. */
  runtime: { startupMs: 2500, startupLongTaskMs: 150, moduleLongTaskMs: 100, scene3dLongTaskMs: 200 },
};
