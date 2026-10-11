import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { daysVsDepth, forgeOperations, intervalsOverlap, lasCurve, parseLas, runsInInterval, sectionAtDepth } from "./records.ts";

test("FORGE daily reports cover every day from rig move to cement", () => {
  const { days } = forgeOperations;
  assert.equal(days.length, 76);
  assert.equal(days[0]?.date, "2020-10-20");
  assert.equal(days.at(-1)?.date, "2021-01-03");
  for (let index = 1; index < days.length; index += 1) {
    assert.equal(Date.parse(days[index]!.date) - Date.parse(days[index - 1]!.date), 86_400_000);
  }
  const nov15 = days.find((day) => day.date === "2020-11-15");
  assert.equal(nov15?.mdFt, 5200);
  assert.equal(nov15?.tvdFt, 5199);
  assert.equal(nov15?.footageFt, 87);
  assert.equal(nov15?.mudWeightPpg, 8.9);
  assert.match(nov15?.headline ?? "", /^DRILLING AHEAD WITH BHA #9 AT 5200' MD/);
  assert.ok(days.every((day) => day.headline.length > 0 && day.page >= 1 && day.page <= 19));
});

test("days vs depth is monotonic and reaches reported TD", () => {
  const points = daysVsDepth(forgeOperations);
  assert.ok(points.length > 60);
  points.slice(1).forEach((point, index) => assert.ok(point.mdFt >= points[index]!.mdFt));
  assert.equal(points.at(-1)?.mdFt, 10_987);
});

test("service runs carry the report's stated figures and pages", () => {
  const byId = new Map(forgeOperations.runs.map((run) => [run.id, run]));
  assert.equal(byId.get("BHA 01")?.avgRopFph, 134);
  assert.equal(byId.get("BHA 01")?.page, 10);
  assert.equal(byId.get("BHA 04")?.footageFt, 2908);
  assert.equal(byId.get("BHA 10")?.footageFt, 124);
  assert.equal(byId.get("BHA 32")?.outcome, "failed");
  assert.equal(byId.get("BHA 54")?.topFt, 10_787);
  assert.ok(forgeOperations.runs.every((run) => run.page >= 10 && run.page <= 71));
  assert.deepEqual(runsInInterval(forgeOperations, 5470, 5480).map((run) => run.id), ["BHA 10", "BHA 11"]);
  // Intermediate hole in metres converted back to feet ends at 5,112.9 ft.
  assert.deepEqual(runsInInterval(forgeOperations, 1629, 5112.9).map((run) => run.id), ["BHA 03", "BHA 04", "BHA 05", "BHA 06", "BHA 07"]);
  assert.equal(intervalsOverlap(28, 1629, 1629, 5113), false);
  assert.equal(intervalsOverlap(5113, 5113, 1629, 5112.9), true);
});

test("hole sections link to schematic components", () => {
  assert.deepEqual(forgeOperations.sections.map((section) => section.holeComponentId), ["surface-hole", "intermediate-hole", "production-hole"]);
  assert.equal(sectionAtDepth(forgeOperations, 4000)?.id, "intermediate");
  assert.equal(sectionAtDepth(forgeOperations, 10_900)?.id, "production");
  assert.equal(sectionAtDepth(forgeOperations, 5)?.id, "surface");
  assert.equal(forgeOperations.milestones.find((event) => event.id === "rig-release")?.date, "2021-01-12");
});

test("parseLas reads headers, nulls and prefixed curve names", () => {
  const las = parseLas([
    "~Version", " VERS. 2.0 : version", " WRAP. NO : one line",
    "~Well", " STRT.ft 100 : start", " NULL. -999.25 : null", " LOC. LAT: 38N : LOCATION",
    "~Curve", "#MNEM.UNIT : DESCRIPTION", " DEPTH .feet : Depth", " MUDL_ROP .ft/h : Penetration Rate",
    "~A DEPTH ROP", "\t100\t12.5", "\t101\t-999.25\r",
  ].join("\n"));
  assert.equal(las.version, "2.0");
  assert.equal(las.well.LOC?.value, "LAT: 38N");
  assert.equal(las.well.STRT?.unit, "ft");
  assert.deepEqual(lasCurve(las, "rop")?.values, [12.5, null]);
  assert.equal(lasCurve(las, "ROP")?.unit, "ft/h");
  assert.throws(() => parseLas("~V\n WRAP. YES : wrapped\n~C\n DEPT.m : d\n~A\n1"), /Wrapped/);
  assert.throws(() => parseLas("~C\n DEPT.m : d\n X.m : x\n~A\n1"), /expected 2/);
});

test("the published 10 ft mud log parses with provenance", () => {
  const las = parseLas(readFileSync(new URL("../../../apps/demo/public/data/forge-16a-mudlog-10ft.las", import.meta.url), "utf8"));
  const depth = las.curves[0]!;
  assert.equal(depth.values.length, 1086);
  assert.equal(depth.values[0], 130);
  assert.equal(depth.values.at(-1), 10_980);
  assert.equal(las.parameters.SHA?.value, forgeOperations.sources.mudlog?.sha256);
  assert.match(las.parameters.SRC?.value ?? "", /^https:\/\/gdr\.openei\.org\//);
  assert.ok((lasCurve(las, "ROP")?.values.filter((value) => value !== null).length ?? 0) > 1000);
});
