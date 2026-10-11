import assert from "node:assert/strict";
import test from "node:test";
import { validateProductionSurveillanceDocument } from "./production-surveillance.ts";

const utc = Date.UTC(2025, 0, 1);

function document(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    id: "well-1-production",
    wellId: "well-1",
    wellLabel: "Well 1",
    provenance: "documented",
    source: "Monthly production report",
    dataset: {
      version: 1,
      id: "well-1-production-observations",
      assetId: "asset:well-1",
      wellId: "well-1",
      key: { kind: "time", unit: "unix-ms", timeZone: "UTC" },
      sampleIds: ["day-1", "day-2", "day-3"],
      keyValues: new Float64Array([utc, utc + 86_400_000, utc + 172_800_000]),
      columns: [
        { id: "oil-rate", label: "Oil rate", unit: "m3/d", values: new Float32Array([8.1, Number.NaN, 9.2]), nullValue: "nan" },
        { id: "water-rate", label: "Water rate", unit: "m3/d", values: new Float32Array([1.1, 1.3, 1.4]), nullValue: "nan" },
      ],
      reference: null,
      spatialXYZ: null,
    },
    events: [{
      id: "test-1",
      kind: "production-test",
      startTimeMs: utc + 86_400_000,
      endTimeMs: utc + 86_400_000 + 3_600_000,
      mdM: 1840,
      componentId: "packer-1",
      summary: "Production test",
      source: "Daily operations report",
    }],
    ...overrides,
  };
}

test("production surveillance validates UTC observations, source facts, depth and stable event IDs", () => {
  const result = validateProductionSurveillanceDocument(document());
  assert.equal(result.dataset.key.kind, "time");
  assert.equal(result.dataset.keyValues[1], utc + 86_400_000);
  assert.equal(result.dataset.columns[0]!.unit, "m3/d");
  assert.equal(Number.isNaN(result.dataset.columns[0]!.values[1]), true);
  assert.equal(result.events[0]!.mdM, 1840);
  assert.equal(result.events[0]!.source, "Daily operations report");
});

test("production surveillance rejects mismatched wells, non-time keys and invalid event semantics", () => {
  const input = document();
  const badWellDataset = { ...input.dataset as object, wellId: "well-2" };
  assert.throws(() => validateProductionSurveillanceDocument({ ...input, dataset: badWellDataset }), /dataset wellId must match/);
  assert.throws(() => validateProductionSurveillanceDocument({
    ...input,
    dataset: { ...input.dataset as object, key: { kind: "depth", unit: "m", reference: "MD" } },
  }), /must use UTC time keys/);
  assert.throws(() => validateProductionSurveillanceDocument({
    ...input,
    events: [{ ...input.events[0]!, startTimeMs: utc + 0.5 }],
  }), /exact, valid UTC Unix epoch milliseconds/);
  assert.throws(() => validateProductionSurveillanceDocument({
    ...input,
    events: [{ ...input.events[0]!, mdM: -1 }],
  }), /measured depth must be non-negative/);
  assert.throws(() => validateProductionSurveillanceDocument({
    ...input,
    events: [{ ...input.events[0]!, endTimeMs: utc }],
  }), /event end must not precede its start/);
});
