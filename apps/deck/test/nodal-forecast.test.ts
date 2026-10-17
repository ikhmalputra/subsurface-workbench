import assert from "node:assert/strict";
import test from "node:test";
import { exampleWellBrief } from "@ikhmalputra/subsurface-core";
import { defaultForecast, defaultLift, defaultNodal, forecastBand, injectionCheck, runMatch, solve, tankMatch, wellCase } from "../src/data/nodal-model.ts";
import { KESTREL_INJECTION_MD_M, TRUE_STOIIP, kestrelSynthetic } from "../src/data/kestrel-tests.ts";

// Kestrel's synthetic history comes from a truth that does not share the match's assumptions: its own
// rock and water compressibility and connate water, an aquifer off the match's grid, Hagedorn & Brown
// with holdup 1.08 and friction 1.25. These check what the match can and cannot recover from it.
test("Kestrel: the match recovers the tubing; injection is checked; the tank is bracketed, not claimed", () => {
  const brief = exampleWellBrief();
  const designed = wellCase(brief, defaultNodal);
  assert.ok(typeof designed !== "string");
  const well = { ...designed, liftDepthMdM: KESTREL_INJECTION_MD_M };
  const sample = kestrelSynthetic(brief)!;
  assert.ok(sample.production.length >= 30, "monthly allocated volumes");
  const match = runMatch(well, sample.tests, sample.lab);
  const calibration = match.calibration!;
  assert.equal(calibration.flow.correlation, "hagedorn-brown");
  if (calibration.flow.resolved?.holdup) assert.ok(Math.abs(calibration.flow.holdupFactor - 1.08) < 0.05, `holdup ${calibration.flow.holdupFactor}`);
  if (calibration.flow.resolved?.friction) assert.ok(Math.abs(calibration.flow.frictionFactor - 1.25) < 0.15, `friction ${calibration.flow.frictionFactor}`);

  // Gas lift at the recorded operating valve gets in; at the default depth above the packer it cannot.
  const inputs = { ...defaultNodal, waterCut: calibration.lastTest.waterCut, whpPsi: Math.round(calibration.lastTest.whp - 14.7), liftMscfD: 1000 };
  assert.equal(injectionCheck(well, solve(well, inputs, undefined, calibration).traverse, defaultLift)!.ok, true);
  assert.equal(injectionCheck(designed, solve(designed, inputs, undefined, calibration).traverse, defaultLift)!.ok, false);

  // The tank: the build-ups cannot pin it, and the match must say so: the truth inside the 95% interval,
  // the interval wide, and the assumed rock's effect reported.
  const matched = tankMatch(well, sample.tests, sample.production, calibration);
  assert.ok(matched.initialMeasured, "initial pressure from the first build-up");
  assert.ok(matched.range.stoiip[0] <= TRUE_STOIIP && matched.range.stoiip[1] >= TRUE_STOIIP, `${matched.range.stoiip.join("–")}`);
  assert.ok(matched.range.stoiip[1] / matched.range.stoiip[0] > 1.5, "the interval shows how little the pressures know");
  assert.ok(Math.abs(matched.rock[0]!.stoiip / matched.rock[1]!.stoiip - 1) > 0.1, "rock compressibility moves the answer");

  // The forecast across the indistinguishable tanks: gas lift outlasts natural flow on every one.
  const band = forecastBand(well, inputs, calibration, sample.tests, sample.production, matched, matched.tank, defaultForecast);
  for (const c of [band.main, band.low, band.high]) {
    const total = (steps: readonly { oil: number }[]) => steps.reduce((sum, s) => sum + s.oil, 0);
    assert.ok(c.lifted && total(c.lifted.steps) > total(c.natural.steps));
    assert.ok(c.natural.steps[0]!.pressure < matched.initialPressure, "starts depleted");
  }
});
