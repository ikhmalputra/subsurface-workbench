// Builds the logs the deck ties to the seismic at Utah FORGE 58-32 (MU-ESW1): compressional sonic,
// bulk density, gamma ray and caliper, on a 0.5 m MD grid. Source: Nash and Moore (2018), Utah FORGE:
// Logs and Data from Deep Well 58-32 (MU-ESW1), GDR 1006, DOI 10.15121/1452735, CC BY 4.0.
//
//   node tools/build-forge-tie.mjs <folder>
//
// <folder> holds, from GDR 1006 (https://gdr.openei.org/submissions/1006):
//   dsi.las   "D5RL-00187_University of  Utah_ME-ESW1_Run1_DSI Sonic.las" (DTCO)
//   tcom.las  "58-32_logs/Logs/D5RL-00187_University of Utah_ME-ESW1_Run2_TCOM_Main.las" from 58-32_logs.zip (RHOZ, GR, HCAL)
//
// Writes packages/fixtures/data/forge-58-32-tie.json. Depths are MD below the DMF KB the headers give.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const folder = process.argv[2];
if (!folder) { console.error("Usage: node tools/build-forge-tie.mjs <folder with dsi.las and tcom.las>"); process.exit(1); }

/** A LAS 2.0 file's curves, by mnemonic, with the file's NULL as null. */
function readLas(path) {
  const text = readFileSync(path, "latin1");
  const section = (name) => text.split(new RegExp(`^~${name}`, "m"))[1]?.split(/^~/m)[0] ?? "";
  const nullValue = Number(/^\s*NULL\s*\.\S*\s+(\S+)/m.exec(section("W"))?.[1] ?? -999.25);
  const names = section("C").split("\n").slice(1).filter((line) => line.trim() && !line.trim().startsWith("#")).map((line) => line.split(".")[0].trim());
  const values = section("A").split("\n").slice(1).join(" ").trim().split(/\s+/).map(Number);
  const curves = Object.fromEntries(names.map((name) => [name, []]));
  for (let i = 0; i + names.length <= values.length; i += names.length) names.forEach((name, k) => curves[name].push(values[i + k] === nullValue ? null : values[i + k]));
  return { curves, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
}

const FT = 0.3048, STEP = 0.5;
const dsi = readLas(join(folder, "dsi.las"));
const tcom = readLas(join(folder, "tcom.las"));
// Plausible ranges: what lies outside is a tool reading, not rock (cycle skips, casing, washouts).
const keep = { DTCO: [40, 200], RHOZ: [1.8, 3.1], GR: [0, 600], HCAL: [4, 30] };
const depthsDsi = dsi.curves.DEPT.map((ft) => ft * FT), depthsTcom = tcom.curves.DEPT.map((ft) => ft * FT);
const top = Math.ceil(Math.min(...depthsDsi.filter((d, i) => dsi.curves.DTCO[i] !== null)) / STEP) * STEP;
const base = Math.floor(Math.max(...depthsDsi.filter((d, i) => dsi.curves.DTCO[i] !== null)) / STEP) * STEP;
const n = Math.round((base - top) / STEP) + 1;
/** The mean of a curve's kept samples in each half-metre bin. */
function bin(depths, values, [lo, hi]) {
  const sum = new Float64Array(n), count = new Uint16Array(n);
  depths.forEach((depth, i) => {
    const value = values[i];
    if (value === null || value < lo || value > hi) return;
    const k = Math.round((depth - top) / STEP);
    if (k < 0 || k >= n) return;
    sum[k] += value; count[k]++;
  });
  return Array.from(sum, (total, k) => count[k] ? Math.round(total / count[k] * 1000) / 1000 : null);
}
const out = {
  well: "58-32 (MU-ESW1)",
  source: "Utah FORGE: Logs and Data from Deep Well 58-32 (MU-ESW1), GDR 1006, DOI 10.15121/1452735, CC BY 4.0",
  files: {
    dsi: { name: "D5RL-00187_University of  Utah_ME-ESW1_Run1_DSI Sonic.las", sha256: dsi.sha256 },
    tcom: { name: "58-32_logs.zip :: D5RL-00187_University of Utah_ME-ESW1_Run2_TCOM_Main.las", sha256: tcom.sha256 },
  },
  depth: "MD below the DMF KB the headers give (KB 5557.5 ft), metres",
  topMdM: top, stepM: STEP, n,
  curves: {
    DTCO: { unit: "us/ft", label: "Compressional slowness (DSI)", values: bin(depthsDsi, dsi.curves.DTCO, keep.DTCO) },
    RHOZ: { unit: "g/cm3", label: "Bulk density (standard resolution)", values: bin(depthsTcom, tcom.curves.RHOZ, keep.RHOZ) },
    GR: { unit: "gAPI", label: "Gamma ray", values: bin(depthsTcom, tcom.curves.GR, keep.GR) },
    HCAL: { unit: "in", label: "Caliper", values: bin(depthsTcom, tcom.curves.HCAL, keep.HCAL) },
  },
};
const target = join(root, "packages/fixtures/data/forge-58-32-tie.json");
writeFileSync(target, JSON.stringify(out));
const filled = (name) => out.curves[name].values.filter((value) => value !== null).length;
console.log(`58-32 tie logs → ${target}: ${top}–${base} m MD, ${n} samples (DTCO ${filled("DTCO")}, RHOZ ${filled("RHOZ")}, GR ${filled("GR")}), ${(readFileSync(target).length / 1024).toFixed(0)} KB`);
