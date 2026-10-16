import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeForceLogs, flattenAt, forceFormations, forceStations, mdAtTvdss, sampleAt, topsOf, tvdssAt } from "../src/data/force-model.ts";
import type { ForceIndex, ForceWell } from "../src/data/force-model.ts";

// The FORCE 2020 wells as tools/build-force2020.mjs wrote them.
const folder = new URL("../../../packages/fixtures/data/force2020/", import.meta.url);
const index = JSON.parse(readFileSync(new URL("wells.json", folder), "utf8")) as ForceIndex;
const well = (name: string) => index.wells.find((entry) => entry.name === name)!;
const logsOf = (entry: ForceWell) => { const bytes = readFileSync(new URL(entry.file, folder)); return decodeForceLogs(entry, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); };

test("all 118 wells are there, each with logs, the Directorate's group tops, a path and a rig floor", () => {
  assert.equal(index.wells.length, 118);
  assert.equal(new Set(index.wells.map((entry) => entry.id)).size, 118);
  for (const entry of index.wells) {
    assert.ok(index.areas.some((area) => area.id === entry.area), entry.name);
    assert.ok(entry.curves.some((curve) => curve.m === "GR"), `${entry.name} has GR`);
    assert.ok(entry.groups.length > 0, `${entry.name} has group tops`);
    assert.ok(entry.datumElevationM !== null && entry.datumElevationM > 0 && entry.datumElevationM < 80, `${entry.name} rig floor ${entry.datumElevationM}`);
    assert.ok(entry.lonLat && entry.lonLat[0] > 1 && entry.lonLat[0] < 5 && entry.lonLat[1] > 56 && entry.lonLat[1] < 62, `${entry.name} sits in the Norwegian North Sea`);
    for (let i = 1; i < entry.survey.length; i++) assert.ok(entry.survey[i]![0] > entry.survey[i - 1]![0], `${entry.name} path runs down the hole`);
    assert.equal(readFileSync(new URL(entry.file, folder)).byteLength, entry.n * (entry.curves.length + (entry.lithology ? 1 : 0)) * 2, `${entry.name} file size`);
  }
});

test("a decoded log matches the competition's own samples", () => {
  // 15/9-13's GR samples between 1999.75 and 2000.25 m MD in train.csv: 43.91, 46.04, 46.73 and 49.75 API.
  const entry = well("15/9-13");
  const logs = logsOf(entry);
  const gr = logs.curves.GR![sampleAt(entry, 2000)]!;
  assert.ok(Math.abs(gr - (43.912 + 46.036 + 46.731 + 49.754) / 4) < 0.02, `GR ${gr}`);
  // Resistivity comes back in ohm·m, not log10; lithology as a class index.
  assert.ok(Math.min(...Array.from(logs.curves.RDEP!).filter(Number.isFinite)) > 0);
  assert.ok(logs.litho && Array.from(logs.litho).every((code) => code >= -1 && code < 12));
});

test("depth along the path: TVDSS and MD invert each other, and the Directorate's tops agree with the path", () => {
  const entry = well("15/9-13");
  for (const md of [600, 1500, 2441, 3200]) assert.ok(Math.abs(mdAtTvdss(entry, tvdssAt(entry, md)) - md) < 0.05, `MD ${md}`);
  for (const top of entry.groups.filter((item) => item.tvdss !== null && item.md > entry.survey[0]![0])) assert.ok(Math.abs(tvdssAt(entry, top.md) - top.tvdss!) < 3, `${top.name}: path ${tvdssAt(entry, top.md)} vs pick ${top.tvdss}`);
  // The rig floor from the shallow tops: 15/9-13's Nordland top is 106 m MD at 81 m TVDSS.
  assert.equal(entry.datumElevationM, 25);
  const stations = forceStations(entry);
  assert.ok(Math.abs(stations[0]!.tvdM - (entry.survey[0]![3] + 25)) < 1e-9);
  const layers = forceFormations(entry);
  assert.deepEqual(layers.map((layer) => layer.name), entry.groups.map((top) => top.name));
  for (let i = 1; i < layers.length; i++) assert.equal(layers[i - 1]!.bottomTvdM, layers[i]!.topTvdM);
});

test("flattening hangs a well on your pick before the Directorate's, and leaves it out without either", () => {
  const entry = well("15/9-13");
  const theirs = topsOf(entry, []);
  const shetland = entry.groups.find((top) => top.name === "Shetland Gp.")!;
  assert.equal(flattenAt(theirs, null), 0);
  assert.equal(flattenAt(theirs, "Shetland Gp."), shetland.tvdss);
  const mine = topsOf(entry, [{ name: "Shetland Gp.", md: shetland.md + 10 }]);
  assert.ok(Math.abs(flattenAt(mine, "Shetland Gp.")! - tvdssAt(entry, shetland.md + 10)) < 1e-9);
  assert.equal(flattenAt(theirs, "Brent Gp."), null);
});

test("a GR pattern is found again where it repeats, with its match score", async () => {
  const { matchPick } = await import("../src/data/force-model.ts");
  const entry = well("15/9-13");
  const gr = logsOf(entry).curves.GR!;
  // The same well shifted by 37 samples (18.5 m) and offset by 10 API: found at the shift, r ≈ 1.
  const shifted = new Float32Array(gr.length).fill(NaN);
  for (let k = 0; k + 37 < gr.length; k++) shifted[k + 37] = gr[k]! + 10;
  const at = sampleAt(entry, 2440);
  const found = matchPick(gr, at, shifted, at + 10, 60, 200)!;
  assert.equal(found.index, at + 37);
  assert.ok(found.r > 0.999);
  // Against a flat log there is nothing to match.
  assert.equal(matchPick(gr, at, new Float32Array(gr.length).fill(50), at, 60, 200), null);
});
