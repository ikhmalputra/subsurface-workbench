import assert from "node:assert/strict";
import test from "node:test";
import {
  flattenPetrophysicsWells,
  pairPetrophysicsCurves,
  petrophysicsHistogram,
  petrophysicsHistogramDepthRange,
  petrophysicsTrackTemplateSchema,
  summarizePetrophysicsZones,
  validatePetrophysicsTrackTemplate,
  validatePetrophysicsWell,
} from "./contracts.ts";
import type { PetrophysicsLogCurve, PetrophysicsWell } from "./contracts.ts";

const reference = { kind: "MD" as const, unit: "m" as const, datum: "RKB" };
function curve(id: string, depthsMdM: number[], values: number[], nullValue: number | null = null): PetrophysicsLogCurve {
  return { version: 1, id, wellId: "well-a", mnemonic: id.toUpperCase(), name: id, unit: "v/v", depthReference: reference, depthsMdM: Float64Array.from(depthsMdM), values: Float32Array.from(values), nullValue };
}
function well(wellId: string, markerMdM: number): PetrophysicsWell {
  const log = curve("phi", [100, 104, 108, 112, 116], [0.1, 0.2, -999.25, 0.8, 0.9], -999.25);
  const depthReference = reference;
  return {
    version: 1, wellId, depthReference, provenance: "documented",
    curves: [{ ...log, wellId }],
    zones: [{ id: "zone", name: "Zone", topMdM: 100, baseMdM: 116, lithology: "unknown", color: "#abc" }],
    tops: [{ id: "marker", name: "Marker", mdM: markerMdM }],
    corePoints: [],
  };
}

test("crossplot pairs only equal MD keys and excludes null values without interpolation", () => {
  const x = curve("x", [100, 104, 108, 112], [1, 2, 3, 4], null);
  const y = curve("y", [100, 108, 112], [5, 6, 7], null);
  assert.deepEqual(pairPetrophysicsCurves(x, y), [
    { mdM: 100, x: 1, y: 5 },
    { mdM: 108, x: 3, y: 6 },
    { mdM: 112, x: 4, y: 7 },
  ]);
  assert.throws(() => pairPetrophysicsCurves(x, { ...y, wellId: "well-b" }), /same well/);
});

test("histogram produces exact bins and excludes explicit sentinels", () => {
  const source = curve("gr", [0, 1, 2, 3], [0, 5, -999.25, 10], -999.25);
  const histogram = petrophysicsHistogram(source, 2);
  assert.equal(histogram.min, 0);
  assert.equal(histogram.max, 10);
  assert.deepEqual(histogram.bins, [{ lower: 0, upper: 5, count: 1 }, { lower: 5, upper: 10, count: 2 }]);
  assert.deepEqual(petrophysicsHistogramDepthRange(source, histogram, 0), [0, 0]);
  assert.deepEqual(petrophysicsHistogramDepthRange(source, histogram, 1), [1, 3]);
  assert.deepEqual(petrophysicsHistogram(curve("empty", [0, 1], [-999.25, -999.25], -999.25), 2), { min: null, max: null, bins: [] });
  assert.throws(() => petrophysicsHistogram(curve("gr", [0], [1]), 513), RangeError);
  const constant = curve("constant", [10, 12, 14], [2, 2, 2]);
  const constantHistogram = petrophysicsHistogram(constant, 4);
  assert.deepEqual(petrophysicsHistogramDepthRange(constant, constantHistogram, 0), [10, 14]);
  assert.equal(constantHistogram.bins[0]?.count, 3);
  assert.throws(() => petrophysicsHistogramDepthRange(constant, constantHistogram, 4), RangeError);
});

test("zone summary exposes sampled mean and threshold thickness while excluding gaps", () => {
  const log = curve("phi", [0, 2, 4, 6, 20, 22], [0.2, 0.3, 0.8, 0.9, 0.9, 0.9], null);
  const result = summarizePetrophysicsZones(
    [{ id: "z", name: "zone", topMdM: 0, baseMdM: 22, lithology: "unknown", color: "#abc" }],
    log,
    { curveId: "phi", cutoff: 0.5, side: "above", maxSampleGapM: 3 },
  )[0]!;
  assert.equal(result.sampleCount, 5);
  assert.equal(result.reportedSampleCount, 5);
  assert.ok(Math.abs(result.mean! - 0.62) < 1e-6);
  assert.equal(result.grossSampledThicknessM, 8);
  assert.equal(result.netSampledThicknessM, 4);
  assert.equal(result.netToGross, 0.5);
  assert.equal(summarizePetrophysicsZones(
    [{ id: "empty", name: "empty", topMdM: 30, baseMdM: 40, lithology: "unknown", color: "#abc" }],
    log,
    { curveId: "phi", cutoff: 0.5, side: "above", maxSampleGapM: 3 },
  )[0]?.netToGross, null);
});

test("marker flattening returns relative display depths and preserves source samples", () => {
  const first = well("well-a", 108);
  const second = well("well-b", 112);
  const sourceValues = first.curves[0]!.values;
  const flattened = flattenPetrophysicsWells([first, second], "marker");
  assert.deepEqual(Array.from(flattened[0]!.curves[0]!.relativeDepthsM), [-8, -4, 0, 4, 8]);
  assert.deepEqual(Array.from(flattened[1]!.curves[0]!.relativeDepthsM), [-12, -8, -4, 0, 4]);
  assert.equal(flattened[0]!.curves[0]!.curve.values, sourceValues);
  assert.equal(first.curves[0]!.depthsMdM[2], 108);
  assert.throws(() => flattenPetrophysicsWells([first, { ...second, tops: [] }], "marker"), /explicit top tie/);
  assert.throws(() => flattenPetrophysicsWells([first, { ...second, depthReference: { ...reference, datum: "MSL" } }], "marker"), /matching MD units and depth datums/);
});

test("track template validates strict, JSON-ready display configuration", () => {
  const template = validatePetrophysicsTrackTemplate({
    version: 1, id: "standard", name: "Standard tracks",
    tracks: [{ curveId: "gr", label: "Gamma ray", color: "#123456", min: 0, max: 150, fill: "left", cutoff: { id: "gr-cut", value: 75, side: "above", color: "#ff0000", label: "High GR" } }],
  });
  assert.equal(JSON.parse(JSON.stringify(template)).tracks[0].cutoff.value, 75);
  assert.equal(JSON.parse(JSON.stringify(petrophysicsTrackTemplateSchema)).additionalProperties, false);
  assert.throws(() => validatePetrophysicsTrackTemplate({ ...template, extra: true }), /unknown field/);
  assert.throws(() => validatePetrophysicsTrackTemplate({ ...template, tracks: [{ ...template.tracks[0], max: 0 }] }), /greater than minimum/);
  assert.throws(() => validatePetrophysicsTrackTemplate({ ...template, tracks: [template.tracks[0], template.tracks[0]] }), /duplicate track/);
});

test("core point measurements are optional, typed, and explicit about nulls", () => {
  const source = well("well-a", 108);
  const enriched = validatePetrophysicsWell({
    ...source,
    corePoints: [{ id: "plug-a", mdM: 104, label: "Core plug", description: null, measurements: [
      { id: "porosity", mnemonic: "POR", value: 0.21, unit: "v/v" },
      { id: "permeability", mnemonic: "PERM", value: null, unit: "mD" },
    ] }],
  });
  assert.deepEqual(enriched.corePoints[0]?.measurements?.map(({ value }) => value), [0.21, null]);
  assert.throws(() => validatePetrophysicsWell({
    ...source,
    corePoints: [{ id: "plug-a", mdM: 104, label: "Core plug", description: null, measurements: [
      { id: "duplicate", mnemonic: "POR", value: 0.2, unit: "v/v" },
      { id: "duplicate", mnemonic: "PERM", value: 10, unit: "mD" },
    ] }],
  }), /duplicate identifier/);
});
