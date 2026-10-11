import assert from "node:assert/strict";
import test from "node:test";
import { ContractValidationError, seismicVolumeFromBuffer, seismicVolumeHeaderSchema, validateSeismicVolume, validateSeismicVolumeHeader, validateWellPath, wellPathSchema } from "./contracts.ts";
import type { SeismicVolumeHeader, WellPathInput } from "./contracts.ts";

const reference = { units: "m", crs: "local: east/north from wellhead", depthDatum: "RKB" } as const;
const path: WellPathInput = {
  version: 1, id: "well-1", reference,
  points: [[0, 0, 0], [0, 0, 100], [100, 0, 100], [150, 0, 90]],
  measuredDepthsM: [0, 100, 200, 260],
  logs: [{ id: "porosity", unit: "%", depthsMdM: [50, 150, 250], values: [15, null, 22] }],
};
const header: SeismicVolumeHeader = {
  version: 1, id: "cube-1", reference, dimensions: [2, 3, 2],
  bounds: { xMin: -10, xMax: 10, yMin: 0, yMax: 30, zMin: 100, zMax: 120 },
  sampleType: "float32", byteOrder: "little-endian", layout: "x-fastest",
  amplitude: { scale: 2, offset: -1, unit: "relative amplitude" },
};

function rejects(work: () => unknown, field: string) {
  assert.throws(work, (error: unknown) => {
    assert.ok(error instanceof ContractValidationError);
    assert.equal(error.issues.length, 1);
    assert.equal(error.issues[0]?.path, field);
    assert.ok(error.issues[0]?.message);
    return true;
  });
}

test("well paths accept horizontal and upward segments, explicit missing logs and independent JSON snapshots", () => {
  const input = JSON.parse(JSON.stringify(path));
  const validated = validateWellPath(input);
  assert.deepEqual(validated, path);
  input.points[0][0] = 1000;
  input.logs[0].values[0] = 1000;
  assert.equal(validated.points[0]?.[0], 0);
  assert.equal(validated.logs[0]?.values[0], 15);
  assert.deepEqual(validateWellPath({ ...path, logs: [] }).logs, []);
});

const invalidPaths: readonly [string, unknown, string][] = [
  ["null root", null, "$"],
  ["extra field", { ...path, extra: true }, "$.extra"],
  ["missing field", { version: 1 }, "$.id"],
  ["unsupported version", { ...path, version: 2 }, "$.version"],
  ["empty identifier", { ...path, id: " " }, "$.id"],
  ["unreported units", { ...path, reference: { ...reference, units: "ft" } }, "$.reference.units"],
  ["missing datum", { ...path, reference: { units: "m", crs: "local" } }, "$.reference.depthDatum"],
  ["short path", { ...path, points: [[0, 0, 0]] }, "$.points"],
  ["wrong tuple", { ...path, points: [[0, 0], [0, 0, 100]] }, "$.points[0]"],
  ["non-finite coordinate", { ...path, points: [[NaN, 0, 0], [0, 0, 100]] }, "$.points[0][0]"],
  ["string number", { ...path, points: [["0", 0, 0], [0, 0, 100]] }, "$.points[0][0]"],
  ["depth length mismatch", { ...path, measuredDepthsM: [0, 100] }, "$.measuredDepthsM"],
  ["duplicate depth", { ...path, measuredDepthsM: [0, 100, 100, 260] }, "$.measuredDepthsM[2]"],
  ["decreasing depth", { ...path, measuredDepthsM: [0, 100, 90, 260] }, "$.measuredDepthsM[2]"],
  ["negative MD", { ...path, measuredDepthsM: [-1, 100, 200, 260] }, "$.measuredDepthsM[0]"],
  ["duplicate log", { ...path, logs: [path.logs[0], path.logs[0]] }, "$.logs[1].id"],
  ["out-of-range log", { ...path, logs: [{ ...path.logs[0], depthsMdM: [50, 150, 270] }] }, "$.logs[0].depthsMdM"],
  ["log length mismatch", { ...path, logs: [{ ...path.logs[0], values: [1] }] }, "$.logs[0].values"],
  ["non-finite log", { ...path, logs: [{ ...path.logs[0], values: [1, Infinity, 2] }] }, "$.logs[0].values[1]"],
  ["unsorted log", { ...path, logs: [{ ...path.logs[0], depthsMdM: [150, 50, 250] }] }, "$.logs[0].depthsMdM[1]"],
  ["sparse points", { ...path, points: new Array(2) }, "$.points[0]"],
  ["sparse depths", { ...path, measuredDepthsM: new Array(4) }, "$.measuredDepthsM[0]"],
  ["sparse log values", { ...path, logs: [{ ...path.logs[0], values: new Array(3) }] }, "$.logs[0].values[0]"],
];
for (const [name, value, field] of invalidPaths) test(`well path rejects ${name}`, () => rejects(() => validateWellPath(value), field));

test("seismic headers and typed samples validate without copying the voxel storage", () => {
  const data = Float32Array.from({ length: 12 }, (_, i) => i - 6);
  const volume = validateSeismicVolume(header, data);
  assert.deepEqual(volume.header, header);
  assert.equal(volume.data, data);
  assert.notEqual(volume.header.bounds, header.bounds);
  const bytes = new Uint8Array(12);
  assert.equal(validateSeismicVolume({ ...header, sampleType: "uint8" }, bytes).data, bytes);
  assert.deepEqual(validateSeismicVolumeHeader({ ...header, dimensions: [1, 1, 1] }).dimensions, [1, 1, 1]);
});

const invalidHeaders: readonly [string, unknown, string][] = [
  ["unknown metadata", { ...header, extra: 1 }, "$.extra"],
  ["wrong version", { ...header, version: 2 }, "$.version"],
  ["zero dimension", { ...header, dimensions: [0, 3, 2] }, "$.dimensions[0]"],
  ["fractional dimension", { ...header, dimensions: [2, 1.5, 2] }, "$.dimensions[1]"],
  ["unsafe voxel count", { ...header, dimensions: [Number.MAX_SAFE_INTEGER, 2, 2] }, "$.dimensions"],
  ["reversed bounds", { ...header, bounds: { ...header.bounds, xMax: -20 } }, "$.bounds.xMax"],
  ["empty bounds", { ...header, bounds: { ...header.bounds, yMax: 0 } }, "$.bounds.yMax"],
  ["non-finite extent", { ...header, bounds: { ...header.bounds, xMin: -Number.MAX_VALUE, xMax: Number.MAX_VALUE } }, "$.bounds.xMax"],
  ["unknown sample type", { ...header, sampleType: "int16" }, "$.sampleType"],
  ["wrong endianness", { ...header, byteOrder: "big-endian" }, "$.byteOrder"],
  ["wrong layout", { ...header, layout: "z-fastest" }, "$.layout"],
  ["zero amplitude scale", { ...header, amplitude: { ...header.amplitude, scale: 0 } }, "$.amplitude.scale"],
];
for (const [name, value, field] of invalidHeaders) test(`seismic header rejects ${name}`, () => rejects(() => validateSeismicVolumeHeader(value), field));

test("seismic data rejects wrong types, wrong lengths, invalid samples and amplitude overflow", () => {
  rejects(() => validateSeismicVolume(header, new Uint8Array(12)), "$.data");
  rejects(() => validateSeismicVolume({ ...header, sampleType: "uint8" }, new Float32Array(12)), "$.data");
  rejects(() => validateSeismicVolume(header, new Int8Array(12)), "$.data");
  rejects(() => validateSeismicVolume(header, new Float32Array(11)), "$.data");
  rejects(() => validateSeismicVolume(header, new Float32Array(13)), "$.data");
  const data = new Float32Array(12);
  data[4] = NaN;
  rejects(() => validateSeismicVolume(header, data), "$.data[4]");
  data[4] = Infinity;
  rejects(() => validateSeismicVolume(header, data), "$.data[4]");
  data[4] = 100;
  rejects(() => validateSeismicVolume({ ...header, amplitude: { ...header.amplitude, scale: Number.MAX_VALUE } }, data), "$.data[4]");
});

test("raw float32 decoding uses little-endian bytes and preserves x-fastest index order", () => {
  const buffer = new ArrayBuffer(12 * 4);
  const view = new DataView(buffer);
  for (let z = 0; z < 2; z += 1) for (let y = 0; y < 3; y += 1) for (let x = 0; x < 2; x += 1) {
    const index = (z * 3 + y) * 2 + x;
    view.setFloat32(index * 4, 100 * z + 10 * y + x + 0.25, true);
  }
  const volume = seismicVolumeFromBuffer(header, buffer);
  assert.deepEqual([...volume.data], [0.25, 1.25, 10.25, 11.25, 20.25, 21.25, 100.25, 101.25, 110.25, 111.25, 120.25, 121.25]);
  rejects(() => seismicVolumeFromBuffer(header, new ArrayBuffer(47)), "$.data");
  rejects(() => seismicVolumeFromBuffer(header, new ArrayBuffer(49)), "$.data");
  view.setFloat32(0, NaN, true);
  rejects(() => seismicVolumeFromBuffer(header, buffer), "$.data[0]");
  const bytes = Uint8Array.from({ length: 12 }, (_, i) => i);
  assert.deepEqual([...seismicVolumeFromBuffer({ ...header, sampleType: "uint8" }, bytes.buffer).data], [...bytes]);
});

test("published JSON schemas declare strict versioned objects and binary metadata", () => {
  assert.equal(wellPathSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(wellPathSchema.additionalProperties, false);
  assert.equal(wellPathSchema.properties.points.items.maxItems, 3);
  assert.equal(wellPathSchema.properties.logs.items.additionalProperties, false);
  assert.deepEqual(seismicVolumeHeaderSchema.properties.sampleType.enum, ["float32", "uint8"]);
  assert.equal(seismicVolumeHeaderSchema.properties.layout.const, "x-fastest");
  assert.doesNotThrow(() => JSON.stringify([wellPathSchema, seismicVolumeHeaderSchema]));
});
