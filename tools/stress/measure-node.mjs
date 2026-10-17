// How the data layer holds up as a tenant grows: time and memory to load, check and place N wells.
//   node --expose-gc tools/stress/measure-node.mjs 1000 10000 50000
import { performance } from "node:perf_hooks";
import { tenant } from "./tenant.mjs";
import { bundleSource, loadWellCatalogue } from "../../packages/core/dist/data-contract.js";
import { siteOfWells } from "../../packages/react/dist/sites.js";

const mb = (bytes) => (bytes / 1048576).toFixed(0);
const heap = () => { globalThis.gc?.(); return process.memoryUsage().heapUsed; };
for (const n of process.argv.slice(2).map(Number)) {
  const base = heap();
  let t = performance.now();
  const file = tenant({ wells: n });
  const json = JSON.stringify(file);
  const made = performance.now() - t;
  t = performance.now();
  const parsed = JSON.parse(json);
  const parse = performance.now() - t;
  t = performance.now();
  const catalogue = await loadWellCatalogue([bundleSource("t", "Tenant", "test", () => parsed.wells)]);
  const load = performance.now() - t;
  const held = heap() - base;
  t = performance.now();
  const field = catalogue.wells.filter((entry) => entry.well.field?.id === "f0");
  const site = siteOfWells(field, { id: "s", label: "F0", summary: "", provenance: "synthetic", caveat: "", seismicNote: "", surfaces: { kinds: ["formation"], colour: () => "#000" } });
  const oneField = performance.now() - t;
  t = performance.now();
  const all = siteOfWells(catalogue.wells, { id: "all", label: "All", summary: "", provenance: "synthetic", caveat: "", seismicNote: "", surfaces: { kinds: ["formation"], colour: () => "#000" } });
  const everything = performance.now() - t;
  console.log(JSON.stringify({ wells: n, jsonMB: +mb(json.length), parseMs: Math.round(parse), catalogueMs: Math.round(load), heldMB: +mb(held), fieldWells: field.length, fieldSiteMs: Math.round(oneField), allInOneSiteMs: Math.round(everything), surfaces: all?.surfaces.length, problems: catalogue.problems.length, made: Math.round(made) }));
}
