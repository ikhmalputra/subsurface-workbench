import assert from "node:assert/strict";
import test from "node:test";
import { exampleWellBrief } from "@ikhmalputra/subsurface-core";
import { chosenTank, defaultForecast, defaultNodal, forecastCases, runMatch, tankMatch, wellCase } from "../src/data/nodal-model.ts";
import { TRUE_AQUIFER, TRUE_STOIIP, kestrelSynthetic } from "../src/data/kestrel-tests.ts";

test("Kestrel forecast: the tank match brackets the hidden tank; gas lift outlasts natural flow", () => {
  const brief = exampleWellBrief();
  const well = wellCase(brief, defaultNodal);
  assert.ok(typeof well !== "string");
  const sample = kestrelSynthetic(brief)!;
  assert.ok(sample.production.length >= 30, "monthly allocated volumes");
  const calibration = runMatch(well, sample.tests, sample.lab).calibration!;
  const matched = tankMatch(well, sample.tests, sample.production, calibration);
  assert.ok(matched.range.stoiip[0] <= TRUE_STOIIP * 1.05 && matched.range.stoiip[1] >= TRUE_STOIIP * 0.95, `${matched.range.stoiip.join("–")}`);
  const truthLike = chosenTank(matched, TRUE_AQUIFER);
  assert.ok(Math.abs(truthLike.stoiip / TRUE_STOIIP - 1) < 0.1, `${truthLike.stoiip}`);
  const inputs = { ...defaultNodal, waterCut: calibration.lastTest.waterCut, whpPsi: Math.round(calibration.lastTest.whp - 14.7), liftMscfD: 1000 };
  const cases = forecastCases(well, inputs, calibration, sample.tests, sample.production, truthLike, defaultForecast);
  assert.ok(cases.lifted, "a gas-lift case");
  const total = (steps: readonly { oil: number }[]) => steps.reduce((sum, s) => sum + s.oil, 0);
  assert.ok(total(cases.lifted!.steps) > total(cases.natural.steps));
  assert.ok(cases.natural.endDate <= cases.lifted!.endDate);
  assert.ok(cases.natural.steps[0]!.pressure < well.reservoir.pressure, "starts depleted");
});
