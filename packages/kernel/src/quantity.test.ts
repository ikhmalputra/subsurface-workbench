import assert from "node:assert/strict";
import test from "node:test";
import { METRES_PER_FOOT, METRES_PER_US_SURVEY_FOOT, add, canonical, compare, length, pressure, to, valueIn } from "./quantity.ts";

test("the two feet in this project's data are both exact, and differ as the standards say", () => {
  assert.equal(METRES_PER_FOOT, 0.3048);
  assert.equal(METRES_PER_US_SURVEY_FOOT, 1200 / 3937);
  // About 7 mm at the bottom of a 3,300 m well: never a disagreement about where the well is, but
  // quoting one with the other's factor misstates a sourced number, and both are in this dataset.
  const difference = valueIn(length(10955, "ftUS"), "m") - valueIn(length(10955, "ft"), "m");
  assert.ok(difference > 0.006 && difference < 0.007, `expected ~7 mm, got ${difference}`);
});

test("a depth that goes out to a feet view and comes back is the same depth", () => {
  const there = to(length(1558, "m"), "ft");
  assert.equal(valueIn(there, "m"), 1558);
});

test("arithmetic converts before it adds, so units cannot be mixed by accident", () => {
  const total = add(length(100, "m"), length(100, "ft"));
  assert.equal(total.unit, "m");
  assert.ok(Math.abs(total.value - 130.48) < 1e-9);
  assert.equal(compare(length(1, "m"), length(3, "ft")) > 0, true);
});

test("canonical is the unit the rest of the system holds", () => {
  assert.equal(canonical(length(1, "ft")), METRES_PER_FOOT);
  assert.ok(Math.abs(canonical(pressure(1, "psi")) - 6894.757293168361) < 1e-9);
});
