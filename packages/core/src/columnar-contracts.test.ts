import assert from "node:assert/strict";
import test from "node:test";
import { ContractValidationError, blenderGeomHorizonSchema, validateBlenderGeomHorizon, validateSeismicVoxelCube, validateWellLogCurve, validateWellboreTrajectory, wellLogCurveSchema, wellboreTrajectorySchema } from "./contracts.ts";
import { createMockLogCurve, createMockSeismicCube, createMockTrajectory } from "./sandbox.ts";
import type { BlenderGeomHorizon } from "./contracts.ts";

const trajectory = createMockTrajectory({ stations: 4 });
const log = createMockLogCurve(trajectory);
const mesh: BlenderGeomHorizon = {
  version: 1, id: "horizon", reference: trajectory.reference, format: "glb", source: "blob:local",
  meshToWorld: [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1],
  attributes: [{ semantic: "_POROSITY", layer: "porosity", shaderInput: "porosity", itemSize: 1, domain: [0, 0.4] }],
};

test("columnar trajectory and logs retain Float32/64 storage, including shared subarray views", () => {
  const path = validateWellboreTrajectory(trajectory);
  assert.equal(path.xyz, trajectory.xyz);
  assert.equal(path.depthsMdM, trajectory.depthsMdM);
  assert.notEqual(path.reference, trajectory.reference);
  const larger = new Float32Array(8);
  const values = larger.subarray(2, 6);
  const curve = validateWellLogCurve({ ...log, values });
  assert.equal(curve.values, values);
  assert.equal(curve.values.buffer, larger.buffer);
  assert.equal(curve.depthsMdM, path.depthsMdM);
});

for (const [field, bad] of [
  ["unknown", { ...trajectory, extra: 1 }],
  ["ordinary arrays", { ...trajectory, xyz: Array.from(trajectory.xyz) }],
  ["misaligned XYZ", { ...trajectory, xyz: new Float32Array(3) }],
  ["duplicate MD", { ...trajectory, depthsMdM: new Float32Array([0, 10, 10, 20]) }],
  ["negative MD", { ...trajectory, depthsMdM: new Float32Array([-1, 10, 15, 20]) }],
  ["inclination length", { ...trajectory, inclinationsDeg: new Float32Array(3) }],
  ["inclination limit", { ...trajectory, inclinationsDeg: new Float32Array([0, 1, 2, 181]) }],
  ["azimuth endpoint", { ...trajectory, azimuthsDeg: new Float32Array([0, 1, 2, 360]) }],
  ["nonfinite XYZ", { ...trajectory, xyz: new Float64Array(12).fill(NaN) }],
] as const) test(`columnar trajectory rejects ${field}`, () => assert.throws(() => validateWellboreTrajectory(bad), ContractValidationError));

test("log missing data is explicit; infinities and implicit NaNs fail", () => {
  const values = new Float32Array([1, NaN, 2, 3]);
  assert.equal(validateWellLogCurve({ ...log, values, nullValue: "nan" }).values, values);
  assert.throws(() => validateWellLogCurve({ ...log, values }), ContractValidationError);
  assert.throws(() => validateWellLogCurve({ ...log, values: new Float32Array([1, Infinity, 2, 3]), nullValue: "nan" }), ContractValidationError);
  assert.throws(() => validateWellLogCurve({ ...log, values: new Float32Array(2) }), ContractValidationError);
  assert.throws(() => validateWellLogCurve({ ...log, wellId: "" }), ContractValidationError);
  assert.throws(() => validateWellLogCurve({ ...log, nullValue: NaN }), ContractValidationError);
  assert.throws(() => validateWellLogCurve({ ...log, nullValue: 0.1 }), ContractValidationError);
  assert.equal(validateWellLogCurve({ ...log, values: new Float64Array(4), nullValue: 0.1 }).nullValue, 0.1);
  const sentinel = validateWellLogCurve({ ...log, values: new Float32Array([-999, 1, 2, 3]), nullValue: -999 });
  assert.equal(sentinel.values[0], -999);
});

test("voxel cube alias validates the existing binary layout without copying", () => {
  const cube = createMockSeismicCube({ dimensions: [3, 2, 4] });
  assert.equal(validateSeismicVoxelCube(cube).data, cube.data);
  assert.throws(() => validateSeismicVoxelCube({ ...cube, extra: true }), ContractValidationError);
  assert.throws(() => validateSeismicVoxelCube({ ...cube, data: new Uint8Array(24) }), ContractValidationError);
});

test("Blender contract copies metadata and validates explicit affine transforms and attribute mapping", () => {
  const result = validateBlenderGeomHorizon(mesh);
  assert.deepEqual(result, mesh);
  assert.notEqual(result.meshToWorld, mesh.meshToWorld);
  assert.notEqual(result.attributes, mesh.attributes);
  assert.deepEqual(validateBlenderGeomHorizon({ ...mesh, format: "gltf", attributes: [] }).attributes, []);
});

for (const [label, bad] of [
  ["non-GLTF source", { ...mesh, format: "obj" }],
  ["empty source", { ...mesh, source: "" }],
  ["matrix size", { ...mesh, meshToWorld: [1, 2] }],
  ["singular transform", { ...mesh, meshToWorld: Array.from({ length: 16 }, (_, i) => i === 15 ? 1 : 0) }],
  ["projective transform", { ...mesh, meshToWorld: mesh.meshToWorld.map((n, i) => i === 3 ? 1 : n) }],
  ["sparse matrix", { ...mesh, meshToWorld: new Array(16) }],
  ["standard semantic", { ...mesh, attributes: [{ ...mesh.attributes[0], semantic: "POSITION" }] }],
  ["bad shader identifier", { ...mesh, attributes: [{ ...mesh.attributes[0], shaderInput: "void main() {}" }] }],
  ["duplicate mapping", { ...mesh, attributes: [mesh.attributes[0], mesh.attributes[0]] }],
  ["invalid size", { ...mesh, attributes: [{ ...mesh.attributes[0], itemSize: 5 }] }],
  ["reversed range", { ...mesh, attributes: [{ ...mesh.attributes[0], domain: [1, 0] }] }],
  ["overflowed range", { ...mesh, attributes: [{ ...mesh.attributes[0], domain: [-Number.MAX_VALUE, Number.MAX_VALUE] }] }],
] as const) test(`Blender metadata rejects ${label}`, () => assert.throws(() => validateBlenderGeomHorizon(bad), ContractValidationError));

test("all new transport schemas are serializable and distinguish JSON arrays from binary columns", () => {
  const schemas = [wellboreTrajectorySchema, wellLogCurveSchema, blenderGeomHorizonSchema];
  for (const schema of schemas) {
    assert.deepEqual(JSON.parse(JSON.stringify(schema)), schema);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  }
  assert.equal(wellboreTrajectorySchema.properties.xyz.minItems, 6);
  assert.equal(wellLogCurveSchema.properties.nullValue.anyOf[0].const, "nan");
});

test("sandbox produces deterministic bounded samples and aligned curves with a shared MD buffer", () => {
  const a = createMockSeismicCube({ dimensions: [8, 9, 10], seed: 7 });
  const b = createMockSeismicCube({ dimensions: [8, 9, 10], seed: 7 });
  assert.deepEqual(a.data, b.data);
  assert.notDeepEqual(a.data, createMockSeismicCube({ dimensions: [8, 9, 10], seed: 8 }).data);
  assert.equal(a.data.length, 720);
  assert.ok(a.data.every((value) => Number.isFinite(value) && Math.abs(value) <= 1));
  const path = createMockTrajectory({ stations: 100, totalDepthMdM: 2000 });
  assert.equal(path.depthsMdM.at(-1), 2000);
  assert.deepEqual(path.xyz.slice(0, 3), new Float64Array([0, 0, 0]));
  assert.ok(path.xyz.at(-1)! <= 2000);
  assert.deepEqual(path, createMockTrajectory({ stations: 100, totalDepthMdM: 2000 }));
  const curve = createMockLogCurve(path);
  assert.equal(curve.depthsMdM, path.depthsMdM);
  assert.ok(curve.values.every((value) => value >= 0.09 && value <= 0.23));
});

test("sandbox Uint8 samples reproduce Float32 physical amplitudes within quantization tolerance", () => {
  const options = { dimensions: [8, 9, 10] as const, seed: 7 };
  const floats = createMockSeismicCube(options);
  const bytes = createMockSeismicCube({ ...options, sampleType: "uint8" });
  assert.ok(bytes.data instanceof Uint8Array);
  assert.equal(bytes.header.sampleType, "uint8");
  assert.equal(validateSeismicVoxelCube(bytes).data, bytes.data);
  const { scale, offset } = bytes.header.amplitude;
  for (let i = 0; i < bytes.data.length; i++) assert.ok(Math.abs(bytes.data[i]! * scale + offset - floats.data[i]!) <= 1 / 255 + 1e-7);
  assert.deepEqual(bytes.data, createMockSeismicCube({ ...options, sampleType: "uint8" }).data);
});

test("sandbox enforces allocation limits, numeric settings and unsigned seeds before allocating", () => {
  assert.throws(() => createMockSeismicCube({ dimensions: [256, 256, 256] }), RangeError);
  assert.throws(() => createMockSeismicCube({ dimensions: [0, 1, 1] }), ContractValidationError);
  assert.throws(() => createMockSeismicCube({ seed: -1 }), RangeError);
  assert.throws(() => createMockTrajectory({ stations: 1 }), RangeError);
  assert.throws(() => createMockTrajectory({ stations: 100001 }), RangeError);
  assert.throws(() => createMockTrajectory({ totalDepthMdM: Infinity }), RangeError);
});
