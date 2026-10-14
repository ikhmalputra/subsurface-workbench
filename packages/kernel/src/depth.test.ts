import assert from "node:assert/strict";
import test from "node:test";
import { between, contains, interval, md, metres, overlaps, requireComparable, thickness, tvd } from "./depth.ts";
import { valueIn } from "./quantity.ts";

test("measured depth and true vertical depth are not interchangeable", () => {
  // 1,558 m along a deviated hole is not 1,558 m down, and the types will not let the two meet.
  assert.throws(() => requireComparable(md(1558, "m", "RKB"), tvd(1558, "m", "RKB")), /different things/);
});

test("depths from different datums are refused rather than subtracted", () => {
  // A field mixing a seabed wellhead with a rig floor has to reconcile them; inventing that
  // reconciliation would be fabricating evidence.
  assert.throws(() => between(md(0, "m", "RKB"), md(100, "m", "seabed wellhead")), /without reconciling/);
});

test("an interval cannot end above it starts", () => {
  assert.throws(() => interval(md(1000, "m", "RKB"), md(400, "m", "RKB")), /cannot end above/);
});

test("a casing run measures the same whichever unit it was written in", () => {
  const run = interval(md(0, "m", "RKB"), md(497, "m", "RKB"));
  assert.equal(metres(run.base), 497);
  assert.ok(Math.abs(valueIn(thickness(run), "ft") - 1630.577) < 0.01);
});

test("containment and overlap work on the depth axis, not on bare numbers", () => {
  const surface = interval(md(0, "m", "RKB"), md(497, "m", "RKB"));
  const intermediate = interval(md(400, "m", "RKB"), md(1558, "m", "RKB"));
  assert.equal(contains(surface, md(300, "m", "RKB")), true);
  assert.equal(contains(surface, md(600, "m", "RKB")), false);
  assert.equal(overlaps(surface, intermediate), true, "the strings overlap between 400 and 497 m");
});
