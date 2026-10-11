import assert from "node:assert/strict";
import test from "node:test";
import { curtainBetweenWells, intersectSliceBox, sampleWellLog, slicePlaneFromAngles, validateSlicePlane } from "./interpretation.ts";
import { createSubsurfaceStore } from "./state.ts";
import { stateFromUrl, stateToUrl } from "./state-url.ts";
import { validateWellLogCurve } from "./columnar-contracts.ts";

test("horizontal, vertical, oblique, face-coincident and disjoint planes intersect a cube correctly", () => {
  for (const [origin, normal, count] of [
    [[0.5, 0.5, 0.5], [0, 0, 1], 4],
    [[0.5, 0.5, 0.5], [1, 0, 0], 4],
    [[0.5, 0.5, 0.5], [1, 1, 1], 6],
    [[0, 0, 0], [1, 0, 0], 4],
    [[0, 0, 0], [1, 1, 1], 0],
    [[2, 2, 2], [1, 1, 1], 0],
  ] as const) {
    const points = intersectSliceBox({ origin, normal }, [0, 0, 0], [1, 1, 1]);
    assert.equal(points.length, count);
    for (const p of points) {
      assert.ok(p.every((v) => v >= -1e-9 && v <= 1 + 1e-9));
      assert.ok(Math.abs(p.reduce((sum, v, i) => sum + (v - origin[i]!) * normal[i]!, 0)) < 1e-9);
    }
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) assert.notDeepEqual(points[i], points[j]);
  }
});

test("cropped non-cubic boxes and arbitrarily scaled normals give the same intersection", () => {
  const a = intersectSliceBox({ origin: [15, 40, 50], normal: [0, 0, 100] }, [10, 20, 30], [20, 60, 70]);
  assert.equal(a.length, 4);
  assert.ok(a.every((p) => p[2] === 50));
  assert.deepEqual(a, intersectSliceBox({ origin: [15, 40, 50], normal: [0, 0, 1] }, [10, 20, 30], [20, 60, 70]));
  assert.throws(() => validateSlicePlane({ origin: [0, 0, 0], normal: [0, 0, 0] }), RangeError);
  assert.throws(() => validateSlicePlane({ origin: [0, NaN, 0], normal: [1, 0, 0] }), TypeError);
  assert.throws(() => intersectSliceBox({ origin: [0, 0, 0], normal: [1, 0, 0] }, [0, 0, 0], [0, 1, 1]), RangeError);
});

test("angle semantics and two-well curtains preserve the declared XYZ plane", () => {
  const horizontal = slicePlaneFromAngles([0, 0, 50], 0, 0);
  assert.deepEqual(horizontal.normal, [0, 0, 1]);
  const vertical = slicePlaneFromAngles([0, 0, 0], 90, 90);
  assert.ok(Math.abs(vertical.normal[0] - 1) < 1e-12);
  const curtain = curtainBetweenWells([10, 20, 0], [40, 60, 100]);
  const displacement = [30, 40, 100];
  assert.ok(Math.abs(curtain.normal.reduce((sum, n, i) => sum + n * displacement[i]!, 0)) < 1e-10);
  assert.equal(curtain.normal[2], 0);
  assert.throws(() => curtainBetweenWells([0, 0, 0], [0, 0, 100]), RangeError);
  assert.throws(() => slicePlaneFromAngles([0, 0, 0], 0, 181), RangeError);
});

test("binary log sampling interpolates explicit MDs without extrapolation or crossing null gaps", () => {
  const curve = validateWellLogCurve({ version: 1, id: "porosity", wellId: "well", unit: "%", depthsMdM: new Float64Array([10, 20, 30, 40, 50]), values: new Float32Array([1, 3, NaN, 5, 9]), nullValue: "nan" });
  assert.equal(sampleWellLog(curve, 10), 1);
  assert.equal(sampleWellLog(curve, 15), 2);
  assert.equal(sampleWellLog(curve, 50), 9);
  for (const md of [0, 9, 25, 30, 35, 51]) assert.equal(sampleWellLog(curve, md), null);
  assert.equal(sampleWellLog(curve, 45), 7);
  assert.throws(() => sampleWellLog(curve, NaN), TypeError);
  const single = validateWellLogCurve({ ...curve, depthsMdM: new Float64Array([5]), values: new Float32Array([3]), nullValue: null });
  assert.equal(sampleWellLog(single, 5), 3);
  assert.equal(sampleWellLog(single, 4), null);
  const sentinel = { ...curve, values: new Float32Array([1, 3, -999, 5, 9]), nullValue: -999 };
  assert.equal(sampleWellLog(sentinel, 25), null);
});

test("interpretation is immutable, selector-linked, no-op safe and URL round-trippable", () => {
  const store = createSubsurfaceStore();
  const plane = slicePlaneFromAngles([10, 20, 30], 45, 75);
  store.setSlicePlane(plane);
  store.setLogStyle({ curveId: "porosity", mode: "color-radius", domain: [0, 1], radiusRange: [0.5, 2] });
  let calls = 0;
  store.on("interpretation", () => calls++);
  store.setSlicePlane(plane);
  assert.equal(calls, 0);
  assert.ok(Object.isFrozen(store.getState().interpretation?.slicePlane?.origin));
  const url = stateToUrl(store.getState(), "https://example.test/");
  const restored = stateFromUrl(url)!;
  assert.deepEqual(restored.interpretation, store.getState().interpretation);
  store.setSlicePlane(null);
  assert.equal(store.getState().interpretation?.logStyle?.curveId, "porosity");
  assert.equal(calls, 1);
  assert.throws(() => store.setLogStyle({ curveId: "", mode: "color", domain: [0, 1], radiusRange: [1, 2] }));
  assert.throws(() => store.setLogStyle({ curveId: "porosity", mode: "color", domain: [1, 1], radiusRange: [1, 2] }));
  assert.throws(() => store.setLogStyle({ curveId: "porosity", mode: "radius", domain: [0, 1], radiusRange: [-1, 2] }));
});

test("controlled plane echoes stay no-op across repeated normalization and URL hydration", () => {
  for (let angle = 1; angle < 180; angle += 7) {
    const store = createSubsurfaceStore();
    store.setSlicePlane(slicePlaneFromAngles([10, 20, 30], angle, angle));
    const initial = store.getState();
    let calls = 0;
    store.on("interpretation", () => calls++);
    for (let repeat = 0; repeat < 5; repeat++) store.setSlicePlane(store.getState().interpretation!.slicePlane!);
    assert.equal(store.getState(), initial);
    assert.equal(calls, 0);
    const restored = stateFromUrl(stateToUrl(initial, "https://example.test/"))!;
    assert.deepEqual(restored.interpretation, initial.interpretation);
  }
});

for (const query of [
  "sw.planeOrigin=0,0,0", "sw.planeNormal=1,0,0", "sw.planeOrigin=0,0,0&sw.planeNormal=0,0,0",
  "sw.logMode=radius", "sw.logCurve=porosity&sw.logMode=unsupported&sw.logDomain=0,1&sw.logRadius=1,2",
  "sw.logCurve=porosity&sw.logMode=radius&sw.logDomain=0,1&sw.logRadius=0,0",
]) test(`interpretation URL rejects incomplete or invalid data: ${query}`, () => {
  assert.throws(() => stateFromUrl(`https://example.test/?sw.v=1&${query}`));
});
