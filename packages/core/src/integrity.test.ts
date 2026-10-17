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
