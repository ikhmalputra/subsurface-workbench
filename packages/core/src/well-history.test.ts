import assert from "node:assert/strict";
import test from "node:test";
import { forgeDesign, getWellComponents } from "./index.ts";
import { forgeOperations } from "./records.ts";
import { dateToMs, forgeInstalls, historySpan, msToDate, wellAsOf } from "./well-history.ts";

const components = getWellComponents(forgeDesign);
const on = (date: string) => wellAsOf(forgeOperations, components, forgeInstalls, date);
const ids = (date: string) => on(date).installedIds;

test("before spud the well is not there; on spud day it is 28 ft deep", () => {
  const before = on("2020-10-25");
  assert.equal(before.drilledFt, 0);
  assert.deepEqual(before.components, []);
  assert.equal(before.dayFromSpud, -5);
  assert.equal(on("2020-10-30").drilledFt, 28);
  assert.equal(on("2020-10-30").dayFromSpud, 0);
});

test("the surface hole is drilled before its casing is run, and the casing and cement go in on the reported day", () => {
  const drilled = on("2020-10-31");
  assert.equal(drilled.drilledFt, 1629);
  assert.deepEqual(drilled.installedIds, []);
  assert.ok(drilled.components.some((component) => component.id === "surface-hole"));
  assert.deepEqual(ids("2020-11-01"), ["surface-casing", "surface-cement"]);
  assert.equal(on("2020-11-01").events.length, 2);
});

test("a hole is drawn only as deep as it had been drilled", () => {
  const day = on("2020-11-07");
  assert.equal(day.drilledFt, 4552);
  const hole = day.components.find((component) => component.id === "intermediate-hole")!;
  assert.ok(Math.abs(hole.bottomDepthM - 4552 * 0.3048) < 1e-9);
  assert.equal(day.components.some((component) => component.id === "production-hole"), false);
});

test("the production string is part-run on 1 January and complete on 2 January", () => {
  const part = on("2021-01-01");
  const string = part.components.find((component) => component.id === "production-casing")!;
  assert.ok(Math.abs(string.bottomDepthM - 5936 * 0.3048) < 1e-9);
  assert.equal(string.rawBottomDepthFt, 5936);
  assert.ok(part.installedIds.includes("production-casing"));
  assert.equal(part.completeIds.includes("production-casing"), false);
  const whole = on("2021-01-02").components.find((component) => component.id === "production-casing")!;
  assert.equal(whole.bottomDepthM, components.find((component) => component.id === "production-casing")!.bottomDepthM);
});

test("each day carries its own report; dates without one say so", () => {
  const cement = on("2021-01-03");
  assert.equal(cement.report?.page, 19);
  assert.match(cement.report?.headline ?? "", /WAITING ON CEMENT/);
  assert.ok(cement.installedIds.includes("production-cement"));
  const release = on("2021-01-12");
  assert.equal(release.report, null);
  assert.ok(release.installedIds.includes("wellhead"));
  assert.equal(release.milestones[0]?.id, "rig-release");
});

test("the history spans the first report to rig release, and dates map to UTC days both ways", () => {
  const span = historySpan(forgeOperations, forgeInstalls);
  assert.equal(span.first, "2020-10-20");
  assert.equal(span.last, "2021-01-12");
  assert.equal(span.spud, "2020-10-30");
  assert.equal(span.reportDates.length, 76);
  assert.equal(msToDate(dateToMs("2020-12-19") + 13 * 3_600_000), "2020-12-19");
  assert.throws(() => on("not a date"), /Not a date/);
  assert.throws(() => wellAsOf(forgeOperations, components, [{ componentId: "nowhere", date: "2020-11-01", page: 1, label: "x" }], "2020-11-02"), /unknown component/);
});
