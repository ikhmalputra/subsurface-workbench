import assert from "node:assert/strict";
import test from "node:test";
import { boreholeStresses, breakdownPressure, collapsePressure, forge5832Stress, stressRegime, wallStresses } from "./geomechanics.ts";

const vertical = { inclinationDeg: 0, azimuthDeg: 30 };
const field = { svPsi: 9000, shMaxPsi: 6000, shMinPsi: 4500, shMaxAzimuthDeg: 30 };

test("a vertical hole: the far field is the horizontal stresses, and the hoop stress is Kirsch's", () => {
  const far = boreholeStresses(field, vertical);
  assert.ok(Math.abs(far.sx - 6000) < 1e-9 && Math.abs(far.sy - 4500) < 1e-9 && Math.abs(far.sz - 9000) < 1e-9);
  assert.ok(Math.abs(far.txy) < 1e-9 && Math.abs(far.txz) < 1e-9 && Math.abs(far.tyz) < 1e-9);
  // Across SHmax (90° from it) the hoop stress peaks at 3SH − Sh − Pw; along it, it bottoms at 3Sh − SH − Pw.
  const peak = wallStresses(far, Math.PI / 2, 4000, 0, 0.25), low = wallStresses(far, 0, 4000, 0, 0.25);
  assert.ok(Math.abs(peak.hoop - (3 * 6000 - 4500 - 4000)) < 1e-9);
  assert.ok(Math.abs(low.hoop - (3 * 4500 - 6000 - 4000)) < 1e-9);
});

test("an inclined hole sees the vertical stress across it", () => {
  const far = boreholeStresses(field, { inclinationDeg: 90, azimuthDeg: 30 });
  // Horizontal along SHmax: across it lie Sv (high side) and Shmin; along it, SHmax.
  assert.ok(Math.abs(far.sx - 9000) < 1e-6 && Math.abs(far.sy - 4500) < 1e-6 && Math.abs(far.sz - 6000) < 1e-6);
});

test("collapse in a vertical hole matches the Mohr–Coulomb closed form", () => {
  // Hoop the greatest, radial the least, axial between: 3SH − Sh − Pw − Pp = UCS + q(Pw − Pp).
  const rock = { ucsPsi: 8000, frictionDeg: 30, tensilePsi: 500, poisson: 0.25 };
  const pp = 2000, q = 3;
  const expected = (3 * 6000 - 4500 - pp - 8000 + q * pp) / (1 + q);
  const got = collapsePressure(field, vertical, rock, pp, pp, 9000)!;
  assert.ok(Math.abs(got - expected) <= 1.5, `${got} vs ${expected}`);
});

test("breakdown in a vertical hole is Hubbert–Willis with the tensile strength", () => {
  const rock = { ucsPsi: 8000, frictionDeg: 30, tensilePsi: 500, poisson: 0.25 };
  const pp = 2000;
  const expected = 3 * 4500 - 6000 - pp + 500;
  const got = breakdownPressure(field, vertical, rock, pp, 12000)!;
  assert.ok(Math.abs(got - expected) <= 1.5, `${got} vs ${expected}`);
});

test("the regime follows Anderson", () => {
  assert.equal(stressRegime(9000, 6000, 4500), "normal");
  assert.equal(stressRegime(6000, 9000, 4500), "strike-slip");
  assert.equal(stressRegime(4000, 9000, 4500), "reverse");
});

test("58-32's calibrated profile: normal faulting in the granite, Shmin about 0.6 psi/ft", () => {
  assert.equal(forge5832Stress.mdFt.length, 1070);
  assert.match(forge5832Stress.source.sha256, /^[0-9a-f]{64}$/);
  const at = forge5832Stress.mdFt.indexOf(6955);
  const sh = forge5832Stress.shMinPsi[at]!, sH = forge5832Stress.shMaxPsi[at]!, sv = forge5832Stress.svPsi[at]!;
  assert.equal(stressRegime(sv, sH, sh), "normal");
  assert.ok(Math.abs(sh / 6955 - 0.59) < 0.02);
});
