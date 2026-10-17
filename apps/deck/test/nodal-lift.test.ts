import assert from "node:assert/strict";
import test from "node:test";
import { exampleWellBrief } from "@ikhmalputra/subsurface-core";
import { FT_PER_M, defaultLift, defaultNodal, liftDesign, runMatch, wellCase } from "../src/data/nodal-model.ts";
import { kestrelSynthetic } from "../src/data/kestrel-tests.ts";

test("gas-lift design on the matched Kestrel well: injection above the packer, valves stepping down, optimum within the gas", () => {
  const brief = exampleWellBrief();
  const well = wellCase(brief, defaultNodal);
  assert.ok(typeof well !== "string");
  const sample = kestrelSynthetic(brief)!;
  const calibration = runMatch(well, sample.tests, sample.lab).calibration!;
  const inputs = { ...defaultNodal, waterCut: calibration.lastTest.waterCut, whpPsi: Math.round(calibration.lastTest.whp - 14.7), gor: calibration.lastTest.gor };
  const result = liftDesign(brief, well, inputs, calibration, defaultLift);
  const op = result.design.operating!;
  assert.ok(op, result.design.reason ?? "");
  assert.ok(op.mdFt / FT_PER_M < brief.completion!.packerMdM, "the operating valve sits above the packer");
  assert.equal(result.design.valves.at(-1)!.role, "operating");
  const openings = result.design.valves.map((v) => v.surfaceOpeningPsig);
  assert.deepEqual([...openings].sort((a, b) => b - a), openings, "surface opening pressures fall down the string");
  const best = result.optimum!;
  assert.ok(best.economic.gasScfD <= defaultLift.availableMscfD * 1000 && best.economic.gasScfD <= best.maximum.gasScfD);
  assert.ok(best.economic.oil > result.curve[0]!.oil, "lift gas adds oil");
  // A weaker compressor: the injection point moves up the well.
  const weak = liftDesign(brief, well, inputs, calibration, { ...defaultLift, kickoffPsig: 1400, operatingPsig: 1300 });
  assert.ok(!weak.design.operating || weak.design.operating.mdFt < op.mdFt);
});
