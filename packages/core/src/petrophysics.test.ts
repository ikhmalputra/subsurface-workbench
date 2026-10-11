import assert from "node:assert/strict";
import test from "node:test";
import { ContractValidationError, petrophysicsWellSchema, petrophysicsValueAt, validatePetrophysicsWell } from "./contracts.ts";
import type { PetrophysicsWell } from "./contracts.ts";

const depthsMdM = new Float64Array([100, 110, 120, 130]);
const values = new Float32Array([55, -999.25, 68, 72]);
const well: PetrophysicsWell = {
  version: 1,
  wellId: "well-a",
  depthReference: { kind: "MD", unit: "m", datum: "RKB" },
  provenance: "documented",
  curves: [{
    version: 1, id: "curve-gr", wellId: "well-a", mnemonic: "GR", name: "Gamma ray", unit: "API",
    depthReference: { kind: "MD", unit: "m", datum: "RKB" }, depthsMdM, values, nullValue: -999.25,
  }],
  zones: [{ id: "zone-a", name: "Sand interval", topMdM: 110, baseMdM: 130, lithology: "sandstone", color: "#d9c28f" }],
  tops: [{ id: "top-a", name: "Top Sand", mdM: 110 }],
  corePoints: [{ id: "core-a", mdM: 120, label: "Core plug 1", description: null }],
};

test("petrophysics contracts retain aligned typed columns and resolve explicit sentinels as unknown", () => {
  const validated = validatePetrophysicsWell(well);
  assert.equal(validated.curves[0]?.depthsMdM, depthsMdM);
  assert.equal(validated.curves[0]?.values, values);
  assert.equal(petrophysicsValueAt(validated.curves[0]!, 0), 55);
  assert.equal(petrophysicsValueAt(validated.curves[0]!, 1), null);
  assert.equal(petrophysicsValueAt(validated.curves[0]!, -1), null);
  assert.equal(petrophysicsValueAt(validated.curves[0]!, 4), null);
  assert.equal(validated.zones[0]?.baseMdM, 130);
  assert.equal(validated.corePoints[0]?.description, null);
});

test("petrophysics explicitly allows NaN only under the matching missing-value policy", () => {
  const nanCurve = { ...well.curves[0]!, values: new Float32Array([55, NaN, 68, 72]), nullValue: "nan" as const };
  assert.equal(petrophysicsValueAt(validatePetrophysicsWell({ ...well, curves: [nanCurve] }).curves[0]!, 1), null);
  assert.throws(() => validatePetrophysicsWell({ ...well, curves: [{ ...nanCurve, nullValue: null }] }), ContractValidationError);
  assert.throws(() => validatePetrophysicsWell({ ...well, curves: [{ ...well.curves[0]!, values: new Float32Array([55, Infinity, 68, 72]) }] }), ContractValidationError);
});

const invalid: readonly [string, unknown][] = [
  ["wrong depth unit", { ...well, depthReference: { ...well.depthReference, unit: "ft" } }],
  ["wrong datum", { ...well, curves: [{ ...well.curves[0]!, depthReference: { ...well.depthReference, datum: "MSL" } }] }],
  ["wrong well id", { ...well, curves: [{ ...well.curves[0]!, wellId: "other-well" }] }],
  ["duplicate curve id", { ...well, curves: [well.curves[0], well.curves[0]] }],
  ["decreasing measured depth", { ...well, curves: [{ ...well.curves[0]!, depthsMdM: new Float64Array([100, 110, 109, 130]) }] }],
  ["unaligned curve samples", { ...well, curves: [{ ...well.curves[0]!, values: new Float32Array([1, 2]) }] }],
  ["inexact float32 sentinel", { ...well, curves: [{ ...well.curves[0]!, nullValue: 0.1 }] }],
  ["reversed zone", { ...well, zones: [{ ...well.zones[0]!, baseMdM: 100 }] }],
  ["invalid zone color", { ...well, zones: [{ ...well.zones[0]!, color: "not-a-color" }] }],
  ["negative formation top", { ...well, tops: [{ ...well.tops[0]!, mdM: -1 }] }],
  ["missing core label", { ...well, corePoints: [{ ...well.corePoints[0]!, label: " " }] }],
];
for (const [label, value] of invalid) {
  test(`petrophysics rejects ${label}`, () => assert.throws(() => validatePetrophysicsWell(value), ContractValidationError));
}

test("petrophysics JSON schema is strict and serializable", () => {
  const copy = JSON.parse(JSON.stringify(petrophysicsWellSchema));
  assert.deepEqual(copy, petrophysicsWellSchema);
  assert.equal(copy.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(copy.additionalProperties, false);
  assert.equal(copy.properties.curves.items.additionalProperties, false);
  assert.equal(copy.properties.curves.items.properties.values.items.type.includes("null"), true);
  assert.equal(copy.properties.corePoints.items.properties.measurements.items.properties.value.type.includes("null"), true);
});
