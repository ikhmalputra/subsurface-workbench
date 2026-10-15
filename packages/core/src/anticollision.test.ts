import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { forgeDesign } from "./index.ts";
import { closestApproach, forge16aPlaced, forge16aWellheads, forgeNeighbours, forgeSurveyUncertainty, holeRadiusAt, placeForgeOffsetWells, separationFactor, separations } from "./anticollision.ts";
import type { ForgeOffsetWellsRecord, PlacedWell } from "./anticollision.ts";

const vertical = (id: string, e: number, n: number, depthM = 1000): PlacedWell => ({
  id, label: id, provenance: "synthetic", eastingM: e, northingM: n, depthZeroElevationM: 0, datumNote: "", errorModel: null,
  stations: [{ mdM: 0, tvdM: 0, northingM: 0, eastingM: 0 }, { mdM: depthM, tvdM: depthM, northingM: 0, eastingM: 0 }],
});

test("two vertical wells: the centre-to-centre distance is the wellhead spacing, bearing from north", () => {
  const samples = separations(vertical("a", 0, 0), vertical("b", 10, 0), 100);
  assert.equal(samples.length, 11);
  for (const sample of samples) {
    assert.ok(Math.abs(sample.centreToCentreM - 10) < 1e-9);
    assert.equal(sample.bearingFrom, "north");
    assert.ok(Math.abs(sample.bearingDeg - 90) < 1e-9, "east of a vertical well is 90° from north");
  }
});

test("a horizontal well: an offset above is on the high side, one to the east is 90° right looking north", () => {
  const horizontal: PlacedWell = { ...vertical("h", 0, 0), stations: [{ mdM: 0, tvdM: 1000, northingM: 0, eastingM: 0 }, { mdM: 500, tvdM: 1000, northingM: 500, eastingM: 0 }] };
  const above: PlacedWell = { ...horizontal, id: "above", depthZeroElevationM: 20 };
  const east: PlacedWell = { ...horizontal, id: "east", eastingM: 15 };
  const up = separations(horizontal, above, 250)[1]!;
  assert.ok(Math.abs(up.centreToCentreM - 20) < 1e-9);
  assert.equal(up.bearingFrom, "high side");
  assert.ok(Math.min(up.bearingDeg, 360 - up.bearingDeg) < 1e-6);
  const right = separations(horizontal, east, 250)[1]!;
  assert.ok(Math.abs(right.bearingDeg - 90) < 1e-6);
});

test("the nearest point is found between the offset's stations, with its measured depth", () => {
  const diagonal: PlacedWell = { ...vertical("d", 0, 0), stations: [{ mdM: 0, tvdM: 0, northingM: -100, eastingM: 30 }, { mdM: 200, tvdM: 0, northingM: 100, eastingM: 30 }] };
  const sample = separations(vertical("a", 0, 0, 0.5), diagonal, 1)[0]!;
  assert.ok(Math.abs(sample.centreToCentreM - 30) < 1e-9);
  assert.ok(Math.abs(sample.offsetMdM - 100) < 1e-9);
});

const record = JSON.parse(readFileSync(new URL("./forge-offset-wells.json", import.meta.url), "utf8")) as ForgeOffsetWellsRecord;

test("the separation factor follows the ISCWSA rule", () => {
  // 50 m apart, 2 m² variance each along the line, 0.1 m radii: (50 − 0.5) / (3.5 · √(4 + 0.25)).
  const cov = [2, 0, 0, 1, 0, 1];
  assert.ok(Math.abs(separationFactor({ n: 50, e: 0, v: 0 }, cov, cov, 0.1, 0.1) - 49.5 / (3.5 * Math.sqrt(4.25))) < 1e-12);
  assert.equal(separationFactor({ n: 0.2, e: 0, v: 0 }, cov, cov, 0.1, 0.1), 0);
});

test("the FORGE neighbours keep their sources, licensed wellheads and depth references", () => {
  assert.equal(record.licence, "CC-BY-4.0");
  for (const source of Object.values(record.sources)) assert.match(source.sha256, /^[0-9a-f]{64}$/);
  const [b16, w58] = placeForgeOffsetWells(record);
  assert.equal(b16!.label, "16B(78)-32");
  assert.equal(b16!.stations.length, 428);
  // 16B's licensed location agrees with its survey report's wellhead to a millimetre.
  assert.ok(Math.abs(b16!.eastingM - 1097907.09 * 1200 / 3937) < 0.005 && Math.abs(b16!.northingM - 13987765.96 * 1200 / 3937) < 0.005);
  assert.ok(Math.abs(b16!.stations.at(-1)!.tvdM - 8391.36 * 1200 / 3937) < 0.01);
  assert.equal(w58!.stations.length, 59);
  // 58-32 is measured from KB, 21.5 ft above its GPS ground.
  assert.ok(Math.abs(w58!.depthZeroElevationM - (1684.7724 + 21.5 * 1200 / 3937)) < 1e-3);
  // 16A: the licensed as-built, 1.8 m from the GPS survey, 16.2 m from the planned position.
  const offBy = (head: { eastingM: number; northingM: number }) => Math.hypot(head.eastingM - forge16aWellheads.asBuilt.eastingM, head.northingM - forge16aWellheads.asBuilt.northingM);
  assert.ok(Math.abs(offBy(forge16aWellheads.gps) - 1.8) < 0.05);
  assert.ok(Math.abs(offBy(forge16aWellheads.plan) - 16.2) < 0.05);
});

test("FORGE: the separation factor matches welleng's ISCWSA result for each neighbour", () => {
  const a16 = forge16aPlaced(forgeDesign.survey!);
  for (const well of forgeNeighbours) {
    const check = forgeSurveyUncertainty.checks[well.id]!;
    const samples = separations(a16, well, 10).filter((sample) => sample.separationFactor !== null);
    const least = samples.reduce((best, sample) => sample.separationFactor! < best.separationFactor! ? sample : best);
    assert.ok(Math.abs(least.separationFactor! - check.minSf) / check.minSf < 0.03, `${well.id}: ${least.separationFactor!.toFixed(3)} here, ${check.minSf} in welleng`);
    assert.ok(Math.abs(least.referenceMdM - check.atReferenceMdM) < 60, `${well.id}: at ${least.referenceMdM} m here, ${check.atReferenceMdM} m in welleng`);
  }
});

test("FORGE: 16B(78)-32 runs beside 16A(78)-32 from the same pad; 58-32 stays far off", () => {
  const a16 = forge16aPlaced(forgeDesign.survey!);
  const [b16, w58] = forgeNeighbours;
  const near = closestApproach(separations(a16, b16!, 10))!;
  assert.ok(near.centreToCentreM < 40, `16A–16B closest ${near.centreToCentreM.toFixed(1)} m`);
  assert.ok(Math.abs(separations(a16, b16!, 10)[0]!.centreToCentreM - 36.9) < 1.5, "the two wellheads are 36.9 m apart");
  const far = closestApproach(separations(a16, w58!, 10))!;
  assert.ok(far.centreToCentreM > near.centreToCentreM);
});

test("FORGE: the neighbours' hole radii are their reported hole sizes, not a stand-in", () => {
  const [b16, w58] = forgeNeighbours;
  const inches = (well: typeof b16, mdFt: number) => holeRadiusAt(well!, mdFt * 1200 / 3937) * 2000 / 25.4;
  // 16B: 22 in to 1,146 ft, 14 3/4 in to 4,845 ft, 9 1/2 in to TD (its end-of-well report, pp. 12 and 163).
  assert.ok(Math.abs(inches(b16, 500) - 22) < 1e-9);
  assert.ok(Math.abs(inches(b16, 3000) - 14.75) < 1e-9);
  assert.ok(Math.abs(inches(b16, 10000) - 9.5) < 1e-9);
  // 58-32: 36 in conductor hole, 17 1/2 in to 342 ft, 12 1/4 in to 2,180 ft, 8 3/4 in to TD.
  assert.ok(Math.abs(inches(w58, 50) - 36) < 1e-9);
  assert.ok(Math.abs(inches(w58, 1000) - 12.25) < 1e-9);
  assert.ok(Math.abs(inches(w58, 7000) - 8.75) < 1e-9);
  assert.ok(b16!.holeRadii!.every((entry) => !/stand-in/.test(entry.note ?? "")));
});
