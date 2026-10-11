import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateArchieWaterSaturation,
  calculateSchlumbergerMN,
  calculatedSeriesToCurve,
  schlumbergerMNToCurves,
} from "./contracts.ts";
import type { PetrophysicsDepthReference, PetrophysicsLogCurve } from "./contracts.ts";

const reference: PetrophysicsDepthReference = { kind: "MD", unit: "m", datum: "RKB" };
function curve(id: string, unit: string, depths: number[], values: number[], nullValue: PetrophysicsLogCurve["nullValue"] = null): PetrophysicsLogCurve {
  return {
    version: 1, id, wellId: "well-a", mnemonic: id.toUpperCase(), name: id, unit,
    depthReference: reference, depthsMdM: Float64Array.from(depths), values: Float64Array.from(values), nullValue,
  };
}

test("Archie water saturation calculates reference values and retains formula parameters", () => {
  const porosity = curve("phi", "v/v", [100, 110], [0.2, 0.2]);
  const resistivity = curve("rt", "ohm.m", [100, 110], [10, 2.5]);
  const calculation = calculateArchieWaterSaturation(porosity, resistivity, {
    a: 1, m: 2, n: 2, rwAtFormationTemperatureOhmM: 0.1,
  });
  assert.equal(calculation.formula, "Sw = (a * Rw / (Rt * phi^m))^(1/n)");
  assert.ok(Math.abs(calculation.points[0]!.value! - 0.5) < 1e-12);
  assert.ok(Math.abs(calculation.points[1]!.value! - 1) < 1e-12);
  assert.deepEqual(calculation.points.map(({ quality }) => quality), ["valid", "valid"]);
  assert.equal(calculation.parameters.rwAtFormationTemperatureOhmM, 0.1);
  const asCurve = calculatedSeriesToCurve(calculation, {
    id: "sw", wellId: "well-a", mnemonic: "SW_ARCHIE", name: "Archie water saturation", depthReference: reference,
  });
  assert.ok(Math.abs(asCurve.values[0]! - 0.5) < 1e-12);
  assert.ok(Math.abs(asCurve.values[1]! - 1) < 1e-12);
  assert.equal(asCurve.unit, "fraction");
});

test("Archie records out-of-range, invalid, missing, and unpaired samples without clamping", () => {
  const porosity = curve("phi", "v/v", [100, 110, 120, 130], [0.2, 0.2, 0.2, 0.1]);
  const resistivity = curve("rt", "ohm.m", [100, 110, 125, 130], [10, 0.01, 3, 1]);
  const calculation = calculateArchieWaterSaturation(porosity, resistivity, {
    a: 1, m: 2, n: 2, rwAtFormationTemperatureOhmM: 0.1,
  });
  assert.deepEqual(calculation.points.map(({ mdM, quality }) => [mdM, quality]), [
    [100, "valid"], [110, "out-of-range"], [120, "missing"], [125, "missing"], [130, "out-of-range"],
  ]);
  assert.ok(calculation.points[1]!.value! > 1, "Sw above one remains visible instead of being clamped");
  assert.match(calculation.points[1]!.reason!, /without clamping/);

  const sentinelCurve = curve("phi", "v/v", [100, 110], [0.2, -999.25], -999.25);
  const withSentinel = calculateArchieWaterSaturation(sentinelCurve, curve("rt", "ohm.m", [100, 110], [10, 10]), {
    a: 1, m: 2, n: 2, rwAtFormationTemperatureOhmM: 0.1,
  });
  assert.equal(withSentinel.points[1]?.quality, "missing");

  const invalidPhi = calculateArchieWaterSaturation(curve("phi", "v/v", [100], [0]), curve("rt", "ohm.m", [100], [10]), {
    a: 1, m: 2, n: 2, rwAtFormationTemperatureOhmM: 0.1,
  });
  assert.equal(invalidPhi.points[0]?.quality, "invalid");
  const overflow = calculateArchieWaterSaturation(curve("phi", "v/v", [100], [Number.MIN_VALUE]), curve("rt", "ohm.m", [100], [10]), {
    a: 1, m: 2, n: 2, rwAtFormationTemperatureOhmM: 0.1,
  });
  assert.equal(overflow.points[0]?.quality, "invalid");
  assert.equal(overflow.points[0]?.value, null);
  assert.throws(() => calculateArchieWaterSaturation(curve("phi", "fraction", [100], [0.2]), curve("rt", "ohm.m", [100], [10]), {
    a: 1, m: 2, n: 2, rwAtFormationTemperatureOhmM: 0.1,
  }), /must use v\/v/);
  assert.throws(() => calculateArchieWaterSaturation(curve("phi", "v/v", [100], [0.2]), curve("rt", "ohm.m", [100], [10]), {
    a: 1, m: 0, n: 2, rwAtFormationTemperatureOhmM: 0.1,
  }), /Archie m/);
});

test("Schlumberger M-N transform calculates dimensionless coordinates and handles missing samples", () => {
  const phi = curve("nphi", "v/v", [100, 110], [0.2, 0.2]);
  const density = curve("rhob", "g/cm3", [100, 110], [2.4, 2.4]);
  const sonic = curve("dt", "us/ft", [100, 110], [80, 80]);
  const parameters = {
    matrixDensityGPerCm3: 2.65,
    fluidDensityGPerCm3: 1,
    matrixSlownessUsPerFt: 55,
    fluidSlownessUsPerFt: 189,
  };
  const calculation = calculateSchlumbergerMN(phi, density, sonic, parameters);
  assert.equal(calculation.formula, "M = (DTf - DT) / (phiN * (DTf - DTma)); N = (rhoma - rhob) / (phiN * (rhoma - rhof))");
  assert.ok(Math.abs(calculation.points[0]!.m! - 109 / 26.8) < 1e-12);
  assert.ok(Math.abs(calculation.points[0]!.n! - 0.25 / 0.33) < 1e-12);
  assert.equal(calculation.points[0]?.quality, "valid");
  const curves = schlumbergerMNToCurves(calculation, { wellId: "well-a", depthReference: reference, idPrefix: "mn" });
  assert.equal(curves.m.values[0], calculation.points[0]?.m);
  assert.equal(curves.n.values[0], calculation.points[0]?.n);
  assert.equal(curves.m.unit, "dimensionless");

  const withNull = calculateSchlumbergerMN(
    curve("nphi", "v/v", [100, 110], [0.2, Number.NaN], "nan"),
    density,
    sonic,
    parameters,
  );
  assert.equal(withNull.points[1]?.quality, "missing");
  assert.ok(Number.isNaN(schlumbergerMNToCurves(withNull, { wellId: "well-a", depthReference: reference, idPrefix: "mn-null" }).m.values[1]));
});

test("Schlumberger M-N validates dimensions, units, and non-degenerate matrix/fluid parameters", () => {
  const phi = curve("nphi", "v/v", [100], [0.2]);
  const density = curve("rhob", "g/cm3", [100], [2.4]);
  const sonic = curve("dt", "us/ft", [100], [80]);
  const parameters = { matrixDensityGPerCm3: 2.65, fluidDensityGPerCm3: 1, matrixSlownessUsPerFt: 55, fluidSlownessUsPerFt: 189 };
  assert.throws(() => calculateSchlumbergerMN(phi, curve("rhob", "kg/m3", [100], [2400]), sonic, parameters), /must use g\/cm3/);
  assert.throws(() => calculateSchlumbergerMN(phi, density, curve("dt", "us/m", [100], [260]), parameters), /must use us\/ft/);
  assert.throws(() => calculateSchlumbergerMN(phi, density, sonic, { ...parameters, matrixDensityGPerCm3: 1 }), /density must differ/);
  assert.throws(() => calculateSchlumbergerMN(phi, density, sonic, { ...parameters, matrixSlownessUsPerFt: 189 }), /slowness must differ/);
  assert.throws(() => calculateSchlumbergerMN(phi, density, sonic, { ...parameters, fluidDensityGPerCm3: 0 }), /greater than zero/);
  assert.throws(() => calculateSchlumbergerMN(phi, { ...density, depthReference: { ...reference, datum: "MSL" } }, sonic, parameters), /matching depth references/);
});

test("Schlumberger M-N leaves unmatched exact-MD samples visible as missing", () => {
  const calculation = calculateSchlumbergerMN(
    curve("nphi", "v/v", [100, 110], [0.2, 0.25]),
    curve("rhob", "g/cm3", [100, 120], [2.4, 2.35]),
    curve("dt", "us/ft", [100, 110, 120], [80, 82, 84]),
    { matrixDensityGPerCm3: 2.65, fluidDensityGPerCm3: 1, matrixSlownessUsPerFt: 55, fluidSlownessUsPerFt: 189 },
  );
  assert.deepEqual(calculation.points.map(({ mdM, quality, reason }) => [mdM, quality, reason]), [
    [100, "valid", null],
    [110, "missing", "Input curves do not share this exact MD key."],
    [120, "missing", "One or more input curves have no sample at this MD."],
  ]);
});
