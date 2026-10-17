import assert from "node:assert/strict";
import test from "node:test";
import { WATER, annulusCompliance, flowingTemperature, maasp, thermalApb } from "./integrity.ts";
import type { AnnulusInput, RameyInput } from "./integrity.ts";

const near = (actual: number, expected: number, tolerance: number, what: string) => assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} vs ${expected} ± ${tolerance}`);

test("MAASP: each limit worked by hand, and the one that binds is named", () => {
  // The A annulus to a packer at 8,000 ft TVD: 0.45 psi/ft packer fluid, brine 0.465 behind the casing,
  // casing burst 9,000, tubing collapse 7,000 with gas inside from 0 psi, packer rated 5,000.
  const a: AnnulusInput = { name: "A", bottomTvdFt: 8000, fluidGradient: 0.45, outerBurstPsi: 9000, backupGradient: 0.465, innerCollapsePsi: 7000, insideSurfacePsi: 0, insideGradient: 0.1, exposedShoe: null, packerRatingPsi: 5000 };
  const out = maasp(a);
  // Burst: 0.8 × 9,000 at surface (the backup outweighs the fluid below) = 7,200.
  near(out.limits.find((l) => l.limit === "burst")!.psi, 7200, 1e-9, "burst");
  // Collapse at the packer: 5,600 − 0.45 × 8,000 + 0.1 × 8,000 = 2,800.
  near(out.limits.find((l) => l.limit === "collapse")!.psi, 2800, 1e-9, "collapse");
  // Packer: 5,000 − 3,600 + 800 = 2,200, the least: it governs.
  near(out.maaspPsi, 2200, 1e-9, "MAASP"); assert.equal(out.governing, "packer");
  // Without the packer, collapse governs.
  assert.equal(maasp({ ...a, packerRatingPsi: undefined }).governing, "collapse");
  // The B annulus open to the formation at a 6,000 ft shoe that fractures at 0.8 psi/ft: 4,800 − 0.5 × 6,000 = 1,800.
  const b = maasp({ name: "B", bottomTvdFt: 7000, fluidGradient: 0.5, outerBurstPsi: 7000, backupGradient: 0.465, innerCollapsePsi: 8000, insideSurfacePsi: 0, insideGradient: 0.45, exposedShoe: { tvdFt: 6000, fracturePsi: 4800 } });
  near(b.maaspPsi, 1800, 1e-9, "B MAASP"); assert.equal(b.governing, "formation");
});

test("APB: rigid is αΔT/κ, a compliant annulus less, thinner pipe less still", () => {
  near(thermalApb(100, WATER.alphaPerF, WATER.kappaPerPsi, 0), 2.5e-4 * 100 / 2.8e-6, 1e-6, "rigid");
  // 9 5/8 in 47 lb/ft (ID 8.681, wall 0.472) around 7 in 29 lb/ft (wall 0.408).
  const c = annulusCompliance(8.681, 0.472, 7, 0.408);
  assert.ok(c > 1e-7 && c < 1e-5, `${c}`);
  const withPipe = thermalApb(100, WATER.alphaPerF, WATER.kappaPerPsi, c);
  assert.ok(withPipe < 2.5e-4 * 100 / 2.8e-6 && withPipe > 1000, `${withPipe}`);
  assert.ok(annulusCompliance(8.681, 0.3, 7, 0.3) > c, "thinner walls balloon more");
});

test("Ramey: geothermal at no rate, the bottom-hole temperature at a very high rate, warming with time", () => {
  const r: RameyInput = { surfaceF: 60, gradientFPerFt: 0.015, depthFt: 9000, massRateLbmS: 20, heatCapacity: 0.6, earthConductivity: 1.4, earthDiffusivity: 0.04, wellRadiusFt: 0.35 };
  near(flowingTemperature({ ...r, massRateLbmS: 0 }, 3000, 100), 60 + 45, 1e-9, "no flow: geothermal");
  near(flowingTemperature({ ...r, massRateLbmS: 1e6 }, 3000, 100), 60 + 135, 0.5, "very high rate: isothermal at bottom-hole temperature");
  const early = flowingTemperature(r, 2000, 1), late = flowingTemperature(r, 2000, 24 * 30);
  assert.ok(late > early && early > 60 + 30, `${early} → ${late}`);
  // At the producing depth the fluid is at the rock's temperature, always.
  near(flowingTemperature(r, 9000, 50), 60 + 135, 1e-9, "at the perforations");
});

test("Calibration: the conductivity behind a survey is found again, and its range holds it", async () => {
  const { calibrateConductivity } = await import("./integrity.ts");
  const base: RameyInput = { surfaceF: 70, gradientFPerFt: 0.016, depthFt: 9000, massRateLbmS: 8, heatCapacity: 0.6, earthConductivity: 1.4, earthDiffusivity: 0.04, wellRadiusFt: 0.35 };
  // A survey from k = 2.3 (not where the search starts), with ±0.3 °F of deterministic jitter.
  const survey = Array.from({ length: 300 }, (_, i) => { const tvdFt = i * 30; return { tvdFt, tempF: flowingTemperature({ ...base, earthConductivity: 2.3 }, tvdFt, 500) + 0.3 * Math.sin(i * 12.9898) }; });
  const fit = calibrateConductivity(base, 500, survey);
  near(fit.k, 2.3, 0.15, "k");
  assert.ok(fit.range[0] <= 2.3 && fit.range[1] >= 2.3, `${fit.range}`);
  assert.ok(fit.rmsF < 0.4, `${fit.rmsF}`);
  // The wrong time on production gives a different k: what the survey constrains is the relaxation distance.
  assert.ok(Math.abs(calibrateConductivity(base, 5000, survey).k - 2.3) > 0.2);
});

test("SCP: BSEE's MAWOP and diagnose-above limits, and a bleed that builds back beyond heat flags it", async () => {
  const { bleedTests, casingPressureLimits } = await import("./integrity.ts");
  // B annulus: 9 5/8 in N80 intermediate (MIYP 6,870), 13 3/8 in K55 outside (3,450), 7 in P110 inside (collapse 8,530).
  const b = casingPressureLimits({ annulus: "B", miypPsi: 6870, nextOuterMiypPsi: 3450, innerCollapsePsi: 8530 });
  near(b.mawopPsi, 2760, 1e-9, "80% of 3,450 governs"); assert.match(b.mawopBy, /next outer/); near(b.diagnoseAbovePsi!, 1374, 1e-9, "20% of MIYP");
  const a = casingPressureLimits({ annulus: "A", miypPsi: 11220, nextOuterMiypPsi: 6870, innerCollapsePsi: 7870, gasLift: true });
  assert.equal(a.diagnoseAbovePsi, null, "active gas lift: no 10% trigger");
  // Two records bled at hour 100 over 6 hours: one rebuilds by 600 psi in a day, one by heat alone.
  const hours = Array.from({ length: 200 }, (_, i) => i);
  const heat = (h: number) => 1000 + 2 * h;
  const fed = hours.map((h) => h < 100 ? heat(h) : h < 106 ? heat(h) * Math.exp(-(h - 99)) : Math.min(1200, (h - 106) * 25));
  const thermal = hours.map((h) => h < 100 ? heat(h) : h < 106 ? heat(h) * Math.exp(-(h - 99)) : 2 * (h - 106));
  const [fedTest] = bleedTests(hours, fed, heat), [heatTest] = bleedTests(hours, thermal, heat);
  assert.ok(fedTest && heatTest);
  assert.ok(fedTest.bledToZero && fedTest.sustained, JSON.stringify(fedTest));
  near(fedTest.thermalPsi, 48, 1e-9, "heat explains 2 psi/h over the day");
  assert.ok(!heatTest.sustained, JSON.stringify(heatTest));
  // No bleed, no test.
  assert.equal(bleedTests(hours, hours.map(heat), heat).length, 0);
});

test("Compliance: the thin-wall annulus compliance is within 10% of the thick-wall (Lamé) answer for casing", () => {
  // Lamé: a thick cylinder under internal pressure p (outer string) or external pressure p (inner
  // string), radial displacement at the annulus face, plane stress. Worked independently here.
  const E = 30e6, nu = 0.3;
  const lameInner = (a: number, b: number) => (a * (1 - nu) * a * a + a * (1 + nu) * b * b) / (E * (b * b - a * a)); // u/p at r=a, internal pressure
  const lameOuter = (a: number, b: number) => (b * (1 - nu) * b * b + b * (1 + nu) * a * a) / (E * (b * b - a * a)); // |u|/p at r=b, external pressure
  for (const [outerId, outerWall, innerOd, innerWall] of [[8.681, 0.472, 7, 0.408], [12.347, 0.514, 9.625, 0.472], [6.184, 0.408, 3.5, 0.254]] as const) {
    const ro = outerId / 2, ri = innerOd / 2;
    const exact = 2 * (ro * lameInner(ro, ro + outerWall) + ri * lameOuter(ri - innerWall, ri)) / (ro * ro - ri * ri);
    const thin = annulusCompliance(outerId, outerWall, innerOd, innerWall);
    assert.ok(Math.abs(thin / exact - 1) < 0.1, `${outerId}×${innerOd}: thin ${thin.toExponential(3)} vs Lamé ${exact.toExponential(3)}`);
  }
});
