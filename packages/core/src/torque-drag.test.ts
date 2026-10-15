import assert from "node:assert/strict";
import test from "node:test";
import { forgeDesign } from "./index.ts";
import { buoyancyFactor, calibrate, calibrationDays, forgeStringWeights, torqueDrag } from "./torque-drag.ts";
import { metresToFeet } from "./units.ts";

const pipe = [{ lengthFt: 10000, weightLbFt: 20, odIn: 5 }];
const straight = (inc: number) => [{ mdFt: 0, inclinationDeg: inc, azimuthDeg: 90 }, { mdFt: 20000, inclinationDeg: inc, azimuthDeg: 90 }];
const base = { string: pipe, bitMdFt: 10000, mudWeightPpg: 0, frictionCased: 0.3, frictionOpen: 0.3, shoeMdFt: 0 };

test("a vertical string hangs its own weight, whatever the friction", () => {
  for (const movement of ["pickup", "slackoff", "rotating"] as const) {
    const result = torqueDrag({ ...base, survey: straight(0) }, movement);
    assert.ok(Math.abs(result.hookloadLb - 200000) < 1e-6, movement);
    assert.ok(Math.abs(result.torqueFtLbf) < 1e-6);
  }
});

test("a straight inclined hole: w·L·(cos θ ± μ sin θ), and torque μ·r·w·L·sin θ", () => {
  const theta = 60 * Math.PI / 180, wl = 20 * 10000;
  const input = { ...base, survey: straight(60) };
  assert.ok(Math.abs(torqueDrag(input, "pickup").hookloadLb - wl * (Math.cos(theta) + 0.3 * Math.sin(theta))) < 1e-6);
  assert.ok(Math.abs(torqueDrag(input, "slackoff").hookloadLb - wl * (Math.cos(theta) - 0.3 * Math.sin(theta))) < 1e-6);
  const rotating = torqueDrag(input, "rotating");
  assert.ok(Math.abs(rotating.hookloadLb - wl * Math.cos(theta)) < 1e-6);
  assert.ok(Math.abs(rotating.torqueFtLbf - 0.3 * (5 / 24) * wl * Math.sin(theta)) < 1e-6);
});

test("mud buoys the string: steel at 65.5 ppg", () => {
  assert.ok(Math.abs(buoyancyFactor(9) - (1 - 9 / 65.5)) < 1e-12);
  const wet = torqueDrag({ ...base, survey: straight(0), mudWeightPpg: 9 }, "rotating").hookloadLb;
  assert.ok(Math.abs(wet - 200000 * (1 - 9 / 65.5)) < 1e-6);
});

test("a build section adds drag going up: tension pressing into the curve", () => {
  const survey = [{ mdFt: 0, inclinationDeg: 0, azimuthDeg: 90 }, { mdFt: 3000, inclinationDeg: 0, azimuthDeg: 90 }, { mdFt: 6000, inclinationDeg: 60, azimuthDeg: 90 }, { mdFt: 12000, inclinationDeg: 60, azimuthDeg: 90 }];
  const input = { ...base, survey, bitMdFt: 12000, string: [{ lengthFt: 12000, weightLbFt: 20, odIn: 5 }] };
  const up = torqueDrag(input, "pickup").hookloadLb, down = torqueDrag(input, "slackoff").hookloadLb, rot = torqueDrag(input, "rotating").hookloadLb;
  assert.ok(up > rot && rot > down);
});

test("FORGE: the reports give a calibration — block, pipe weight and friction in sensible ranges", () => {
  const days = calibrationDays();
  assert.ok(days.length >= 15, `${days.length} usable days`);
  assert.match(forgeStringWeights.source.sha256, /^[0-9a-f]{64}$/);
  const survey = forgeDesign.survey!.map((s) => ({ mdFt: metresToFeet(s.mdM), inclinationDeg: s.inclinationDeg, azimuthDeg: s.azimuthDeg }));
  const fit = calibrate(survey, 5110, days);
  assert.ok(fit.pipeLbFt > 10 && fit.pipeLbFt < 40, `pipe ${fit.pipeLbFt}`);
  assert.ok(fit.blockLb > 0 && fit.blockLb < 150000, `block ${fit.blockLb}`);
  assert.ok(fit.frictionOpen >= 0.05 && fit.frictionOpen <= 0.6);
});
