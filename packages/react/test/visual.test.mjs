import assert from "node:assert/strict";
import test from "node:test";
import { categoryColor, colorMapCss, sampleColorMap, subsurfaceCategoryPalette } from "../dist/visual.js";

test("sequential color maps preserve endpoints, clamp values, and interpolate in OKLab", () => {
  assert.equal(sampleColorMap(-1, [0, 1], "cividis"), "#00224e");
  assert.equal(sampleColorMap(2, [0, 1], "cividis"), "#fee838");
  const middle = sampleColorMap(0.5, [0, 1], "cividis");
  assert.match(middle, /^#[0-9a-f]{6}$/);
  assert.notEqual(middle, "#808080");
  assert.match(colorMapCss("viridis"), /^linear-gradient\(90deg,/);
  assert.throws(() => sampleColorMap(0.5, [1, 1]), /strictly increasing domain/);
  assert.throws(() => sampleColorMap(Number.NaN, [0, 1]), /finite value/);
});

test("qualitative palette repeats predictably and rejects invalid category indexes", () => {
  assert.equal(categoryColor(0), subsurfaceCategoryPalette[0]);
  assert.equal(categoryColor(subsurfaceCategoryPalette.length), subsurfaceCategoryPalette[0]);
  assert.throws(() => categoryColor(-1), /non-negative safe integer/);
});
