import assert from "node:assert/strict";
import test from "node:test";
import { interactionDatasetSchema, validateInteractionDataset } from "./dataset.ts";

function dataset(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    id: "porosity-observations",
    assetId: "asset:well-1",
    wellId: "well-1",
    key: { kind: "depth", unit: "m", reference: "MD" },
    sampleIds: ["sample-1", "sample-2", "sample-3"],
    keyValues: new Float64Array([0, 10, 20]),
    columns: [{
      id: "porosity",
      label: "Porosity",
      unit: "v/v",
      values: new Float32Array([0.1, Number.NaN, 0.3]),
      nullValue: "nan",
    }],
    reference: { units: "m", crs: "local: east/north", depthDatum: "RKB" },
    spatialXYZ: new Float64Array([0, 0, 0, 10, 1, 10, 20, 2, 20]),
    ...overrides,
  };
}

test("interaction dataset validates explicit keys, stable IDs and aligned typed arrays without copying columns", () => {
  const input = dataset();
  const validated = validateInteractionDataset(input);
  assert.equal(validated.keyValues, input.keyValues);
  assert.equal(validated.columns[0]!.values, input.columns[0]!.values);
  assert.equal(validated.spatialXYZ, input.spatialXYZ);
  assert.deepEqual(validated.sampleIds, ["sample-1", "sample-2", "sample-3"]);
  assert.equal(validated.columns[0]!.nullValue, "nan");
  assert.equal(interactionDatasetSchema.properties.key.oneOf.length, 3);
});

test("interaction dataset rejects duplicate or misaligned samples and unlabelled nulls", () => {
  assert.throws(() => validateInteractionDataset(dataset({ sampleIds: ["same", "same", "third"] })), /sample IDs must be unique/);
  assert.throws(() => validateInteractionDataset(dataset({ keyValues: new Float32Array([0, 10]) })), /expected exactly 3 values/);
  assert.throws(() => validateInteractionDataset(dataset({ spatialXYZ: new Float32Array([0, 0, 0]) })), /expected exactly 9 values/);
  assert.throws(() => validateInteractionDataset(dataset({
    columns: [{ id: "porosity", label: "Porosity", unit: "v/v", values: new Float32Array([0.1, Number.NaN, 0.3]), nullValue: null }],
  })), /expected a finite number/);
});

test("interaction dataset enforces MD metres, ordered UTC epoch milliseconds and sample indices", () => {
  assert.throws(() => validateInteractionDataset(dataset({
    key: { kind: "depth", unit: "ft", reference: "MD" },
  })), /expected "m"/);
  assert.throws(() => validateInteractionDataset(dataset({
    key: { kind: "time", unit: "unix-ms", timeZone: "local" },
  })), /expected "UTC"/);
  assert.throws(() => validateInteractionDataset(dataset({
    key: { kind: "time", unit: "unix-ms", timeZone: "UTC" },
    keyValues: new Float64Array([0, 1.5, 2]),
  })), /exact, valid epoch millisecond/);
  assert.throws(() => validateInteractionDataset(dataset({
    key: { kind: "time", unit: "unix-ms", timeZone: "UTC" },
    keyValues: new Float32Array([0, 1, 2]),
  })), /require Float64Array precision/);
  assert.throws(() => validateInteractionDataset(dataset({
    key: { kind: "index", unit: "sample" },
    keyValues: new Float64Array([0, 1, 1]),
  })), /strictly increasing/);
});
