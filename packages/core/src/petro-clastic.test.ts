import assert from "node:assert/strict";
import test from "node:test";
import { effectivePorosity, interpret, monteCarloPay, payOf, permeability, pickettFit, rwAtTemperature, shaleVolume, triangular, waterSaturation } from "./petro-clastic.ts";
import type { Interpretation, LogSample, Uncertainty } from "./petro-clastic.ts";

const near = (actual: number, expected: number, tolerance: number, what: string) => assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} vs ${expected} ± ${tolerance}`);
const sat = { a: 1, m: 2, n: 2, rw: 0.05, rsh: 2 };

test("saturation: Archie, Simandoux and Indonesia against values worked by hand", () => {
  // Asquith's clean sand: φ 20%, Rw 0.05, Rt 10 → Sw = √(0.05 / (0.04 × 10)) = 35.4%.
  near(waterSaturation("archie", 10, 0.2, 0, sat), 0.35355, 1e-4, "Archie");
  // With 30% shale at Rsh 2: Simandoux's quadratic gives 27.2%, Indonesia 27.5% (worked independently).
  near(waterSaturation("simandoux", 10, 0.2, 0.3, sat), 0.27202, 1e-4, "Simandoux");
  near(waterSaturation("indonesia", 10, 0.2, 0.3, sat), 0.27533, 1e-4, "Indonesia");
  // Both shaly-sand models are Archie in clean sand, and each is told apart from Archie in shale.
  for (const model of ["simandoux", "indonesia"] as const) {
    near(waterSaturation(model, 10, 0.2, 0, sat), 0.35355, 1e-4, `${model} at Vsh 0`);
    assert.ok(Math.abs(waterSaturation(model, 10, 0.2, 0.3, sat) - 0.35355) > 0.05, `${model} differs from Archie in shale`);
  }
  // Simandoux by Newton when n ≠ 2 still satisfies its equation.
  const sw = waterSaturation("simandoux", 10, 0.2, 0.3, { ...sat, n: 2.3 });
  near(0.04 / 0.05 * sw ** 2.3 + 0.3 / 2 * sw, 0.1, 1e-8, "Simandoux at n 2.3");
  near(rwAtTemperature(0.1, 75, 200), 0.1 * 81.77 / 206.77, 1e-12, "Arps");
});

test("clay, porosity and permeability", () => {
  near(shaleVolume(60, 20, 100, "linear"), 0.5, 1e-12, "linear Vsh");
  near(shaleVolume(60, 20, 100, "larionov-tertiary"), 0.21622, 1e-4, "Larionov, Tertiary");
  assert.ok(shaleVolume(60, 20, 100, "larionov-older") < 0.5 && shaleVolume(60, 20, 100, "larionov-older") > 0.21622);
  // A clean water sand: density 2.32 on a 2.65 matrix is 20%; neutron 20% agrees.
  const p = { rhoMatrix: 2.65, rhoFluid: 1, rhoShale: 2.45, nphiShale: 0.35 };
  near(effectivePorosity(2.32, 0.2, 0, p), 0.2, 1e-9, "clean porosity");
  // Shale raises the neutron and lowers the density porosity; correcting for it lowers φ.
  assert.ok(effectivePorosity(2.32, 0.28, 0.3, p) < effectivePorosity(2.32, 0.28, 0, p));
  // Timur and Coates at φ 25%, Swi 20%: 481 and 625 mD (worked independently).
  near(permeability("timur", 0.25, 0.2), 481.3, 0.1, "Timur"); near(permeability("coates", 0.25, 0.2), 625, 1e-9, "Coates");
});

test("Pickett: Rw and m back from a water zone with some hydrocarbon in it", () => {
  let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const water = Array.from({ length: 80 }, () => { const phi = 0.08 + rnd() * 0.25; return { phi, rt: 0.06 / phi ** 2.1 * 10 ** ((rnd() - 0.5) * 0.04) }; });
  const oily = Array.from({ length: 30 }, () => { const phi = 0.12 + rnd() * 0.2; return { phi, rt: 0.06 / phi ** 2.1 / 0.3 ** 2 }; });
  const fit = pickettFit([...water, ...oily])!;
  near(fit.m, 2.1, 0.12, "m"); near(fit.aRw / 0.06, 1, 0.12, "a·Rw");
  // Without the lower envelope the hydrocarbon would drag the line: the check can tell.
  assert.ok(Math.abs(fit.aRw / 0.06 - 1) < Math.abs(0.06 / 0.3 ** 2 / 0.06 - 1));
});

test("pay and Monte Carlo: cutoffs, percentiles in order, reproducible, and wider inputs give a wider spread", () => {
  const step = 0.5;
  // A 20 m sand with oil over water, 10 m of shale above.
  const samples: LogSample[] = Array.from({ length: 60 }, (_, i) => {
    const md = 2000 + i * step, sand = i >= 20, oil = i < 40;
    return { mdM: md, gr: sand ? 30 : 110, rt: sand ? (oil ? 30 : 0.8) : 2, rhob: sand ? 2.3 : 2.5, nphi: sand ? 0.2 : 0.35 };
  });
  const base: Interpretation = { grClean: 25, grShale: 115, shale: "linear", porosity: { rhoMatrix: 2.65, rhoFluid: 1, rhoShale: 2.5, nphiShale: 0.35 }, model: "simandoux", sat: { a: 1, m: 2, n: 2, rw: 0.04, rsh: 2 }, cutoffs: { vsh: 0.4, phi: 0.08, sw: 0.5 }, perm: "timur", bvwIrr: 0.04 };
  const out = payOf(samples.map((s) => ({ ...interpret(s, base), stepM: step })), base.cutoffs);
  near(out.gross, 30, 1e-9, "gross"); near(out.net, 20, 1e-9, "net sand"); near(out.pay, 10, 1e-9, "pay (the oil leg)");
  const u: Uncertainty = { rw: { low: 0.03, mode: 0.04, high: 0.06 }, m: { low: 1.8, mode: 2, high: 2.2 }, n: { low: 1.8, mode: 2, high: 2.2 }, rsh: { low: 1.5, mode: 2, high: 3 }, vshCut: { low: 0.35, mode: 0.4, high: 0.45 }, phiCut: { low: 0.06, mode: 0.08, high: 0.1 }, swCut: { low: 0.45, mode: 0.5, high: 0.6 } };
  const mc = monteCarloPay(samples, step, base, u, 400, 11);
  assert.ok(mc.column.p90 <= mc.column.p50 && mc.column.p50 <= mc.column.p10, JSON.stringify(mc.column));
  assert.deepEqual(monteCarloPay(samples, step, base, u, 400, 11).column, mc.column, "a seed reproduces");
  const tight = monteCarloPay(samples, step, base, { ...u, rw: { low: 0.039, mode: 0.04, high: 0.041 }, m: { low: 1.99, mode: 2, high: 2.01 }, n: { low: 1.99, mode: 2, high: 2.01 } }, 400, 11);
  assert.ok(mc.column.p10 - mc.column.p90 > tight.column.p10 - tight.column.p90, "wider inputs, wider outcome");
  assert.ok(Math.abs(mc.tornado[0]!.high - mc.tornado[0]!.low) >= Math.abs(mc.tornado.at(-1)!.high - mc.tornado.at(-1)!.low), "tornado sorted by swing");
  // A triangular draw stays in its range and sits at its mode in the middle of the CDF when symmetric.
  near(triangular({ low: 1, mode: 2, high: 3 }, 0.5), 2, 1e-12, "triangular median");
});
