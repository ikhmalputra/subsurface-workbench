import assert from "node:assert/strict";
import test from "node:test";
import { absent, combine, derived, isKnown, mapKnown, orElse, reported, sayWhy } from "./known.ts";

test("an absence cannot be read as a number by forgetting to check", () => {
  const unknown = absent<number>("inner diameter not reported");
  assert.equal(isKnown(unknown), false);
  // There is no `unwrap`. Reading means saying what the absence becomes, at the call site.
  assert.equal(orElse(unknown, 0), 0);
  assert.equal(sayWhy(unknown), "inner diameter not reported");
});

test("a conversion keeps its provenance and does not become a measurement", () => {
  const od = reported(339.7, { document: "Drilling Summary", at: "p10", sha256: "abc" });
  const inches = mapKnown(od, (mm) => mm / 25.4);
  assert.equal(inches.state, "reported");
  assert.ok(inches.state === "reported" && inches.source.at === "p10");
});

test("anything computed from a derived value is derived, never reported", () => {
  const shoe = reported(497, { document: "GDR 1283" });
  const gradient = derived(1.6, "from the pressure window");
  const both = combine(shoe, gradient, (d, g) => d * g, "kick tolerance");
  assert.equal(both.state, "derived", "a result is only as strong as its weakest input");
});

test("anything computed from an absence is absent, and says why", () => {
  const shoe = reported(497, { document: "GDR 1283" });
  const missing = absent<number>("no leak-off test for this shoe");
  const result = combine(shoe, missing, (a, b) => a * b, "kick tolerance");
  assert.equal(result.state, "absent");
  assert.equal(sayWhy(result), "no leak-off test for this shoe");
});
