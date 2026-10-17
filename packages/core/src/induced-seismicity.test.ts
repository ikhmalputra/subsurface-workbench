import assert from "node:assert/strict";
import test from "node:test";
import { bValue, completeness, criticalPressure, exceedance, frontDiffusivity, generateFractures, momentMagnitude, normalOf, pressureRise, seededRandom, seismogenicIndex, simulateStimulation, strikeDipOf, tractionOn, trafficLight } from "./induced-seismicity.ts";
import type { Fracture, PressureModel, Stage, StressField } from "./induced-seismicity.ts";

const near = (actual: number, expected: number, tolerance: number, what: string) => assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} vs ${expected} ± ${tolerance}`);
const PSI = 6894.757;
// A FORGE-like granite at about 8,000 ft TVD: Sv 1.13, Shmin 0.74, pore 0.433 psi/ft; SHmax halfway; SHmax N25°E.
const field: StressField = { svGrad: 1.13, shminGrad: 0.74, ppGrad: 0.433, shmaxRatio: 0.5, shmaxAzimuthDeg: 25, datumElevationM: 0 };
const z = -8000 / 3.28084;

test("stress on a plane: the Mohr circle by hand, and Coulomb's critical pressure", () => {
  const sv = 1.13 * 8000 * PSI, sh = 0.74 * 8000 * PSI, sH = sh + 0.5 * (sv - sh), pp = 0.433 * 8000 * PSI;
  // A vertical plane facing Shmin carries Shmin and no shear: it needs the pore pressure up to Shmin to open.
  const facingShmin = tractionOn(field, z, [Math.cos(25 * Math.PI / 180), -Math.sin(25 * Math.PI / 180), 0]);
  near(facingShmin.sigmaN, sh, 1, "σn facing Shmin"); near(facingShmin.tau, 0, 1, "τ facing Shmin");
  near(criticalPressure(facingShmin.sigmaN, facingShmin.tau, pp, 0.6), sh - pp, 1, "critical pressure, no shear");
  // A vertical plane at 45° between SHmax and Shmin: σn = (SH + Sh)/2, τ = (SH − Sh)/2 (the circle's top).
  const a = (25 + 45) * Math.PI / 180, mid = tractionOn(field, z, [Math.sin(a), Math.cos(a), 0]);
  near(mid.sigmaN, (sH + sh) / 2, 1, "σn at 45°"); near(mid.tau, (sH - sh) / 2, 1, "τ at 45°");
  near(criticalPressure(mid.sigmaN, mid.tau, pp, 0.6), (sH + sh) / 2 - pp - (sH - sh) / 2 / 0.6, 1, "critical pressure at 45°");
  // Strike and dip survive the round trip through the normal.
  for (const [s, d] of [[25, 70], [115, 40], [300, 85]] as const) { const back = strikeDipOf(normalOf(s, d)); near(back.strikeDeg, s, 1e-6, "strike"); near(back.dipDeg, d, 1e-6, "dip"); }
});

/** Fractures filling a ball around the origin, each with a critical pressure drawn evenly up to a ceiling. */
function ball(count: number, radius: number, ceilingPa: number, seed = 3): Fracture[] {
  const random = seededRandom(seed), out: Fracture[] = [];
  while (out.length < count) {
    const x = (random.next() * 2 - 1) * radius, y = (random.next() * 2 - 1) * radius, zz = (random.next() * 2 - 1) * radius;
    if (Math.hypot(x, y, zz) > radius) continue;
    out.push({ x, y, z: z + zz, normal: [0, 0, 1], strikeDeg: 0, dipDeg: 0, radiusM: 3, mu: 0.6, criticalPa: random.next() * ceilingPa, sigmaN: 0, tau: 0, pp: 0 });
  }
  return out;
}
const pointModel = (D: number): PressureModel => ({ field, diffusivity: D, netPressurePa: 2e6, efficiency: 0.3, widthM: 0.005, mode: "point" });
const stageAt = (startS: number, endS: number, id = "s"): Stage => ({ id, label: id, center: { x: 0, y: 0, z }, startS, endS, rateM3s: 0.1 });

test("the triggering front grows as √t, and Shapiro's envelope gives the diffusivity back", () => {
  const D = 0.2, model = pointModel(D), stage = stageAt(0, 4 * 3600);
  const source = pressureRise(model, stage, { x: 0.01, y: 0, z }, 1000);
  const fractures = ball(16000, 320, source * 0.5);
  const { events } = simulateStimulation(fractures, [stage], model, { untilS: 4 * 3600, steps: 240 });
  assert.ok(events.length > 500, `${events.length} events`);
  const reach = (t: number) => { const rs = events.filter((e) => e.tS <= t).map((e) => Math.hypot(e.x, e.y, e.z - z)).sort((a, b) => a - b); return rs[Math.floor(0.95 * (rs.length - 1))]!; };
  near(reach(4 * 3600) / reach(3600), 2, 0.2, "doubling √t (4× the time)");
  const fitted = frontDiffusivity(events.map((e) => ({ tS: e.tS, r: Math.hypot(e.x, e.y, e.z - z) })));
  assert.ok(fitted > D / 2 && fitted < D * 2, `D fitted ${fitted} against ${D}`);
  // The check can fail: four times the diffusivity is told apart.
  assert.ok(!(fitted > 4 * D / 2 && fitted < 4 * D * 2), "a four-fold wrong D would be rejected");
});

test("magnitudes: Aki's b back from a Gutenberg–Richter sample, and b from the fracture sizes", () => {
  const random = seededRandom(5), mc = -1;
  const mags = Array.from({ length: 6000 }, () => Math.round((mc - 0.05 - Math.log10(1 - random.next()) / 1.0) * 10) / 10);
  near(bValue(mags, mc).b, 1, 0.05, "b from a b = 1 sample");
  near(completeness(mags), mc + 0.2, 0.11, "completeness by maximum curvature, plus 0.2");
  // A power law of fracture sizes n(r) ∝ r^−3 gives b = 1; r^−4 gives b = 1.5 (b = (exponent − 1) / 2).
  for (const [exponent, expected] of [[3, 1], [4, 1.5]] as const) {
    const fractures = generateFractures({ field, center: { x: 0, y: 0, z }, half: { x: 300, y: 300, z: 300 }, count: 8000, sets: [{ strikeDeg: 25, dipDeg: 70, kappa: 15, weight: 1 }], radiusMinM: 2, radiusMaxM: 200, sizeExponent: exponent, muMean: 0.6, muSd: 0.05, seed: 9 });
    const m = fractures.map((f) => Math.round(momentMagnitude(f.radiusM, 1e6) * 10) / 10);
    near(bValue(m, completeness(m)).b, expected, 0.12, `b for exponent ${exponent}`);
  }
  // Σ inverts its own definition, and more volume never lowers the chance of a large event.
  const sigma = seismogenicIndex(200, 600, 1, 0);
  near(10 ** (sigma - 1 * 0) * 600, 200, 1e-6, "Σ round trip");
  assert.ok(exceedance(sigma, 1, 2, 2000) > exceedance(sigma, 1, 2, 500));
  assert.equal(trafficLight(0.4, 1, 2).light, "green"); assert.equal(trafficLight(1.2, 1, 2).light, "amber"); assert.equal(trafficLight(2.1, 1, 2).light, "red");
});

test("Kaiser effect, trailing events after shut-in, and a cloud stretched along SHmax", () => {
  const model = pointModel(0.2), first = stageAt(0, 2 * 3600, "a"), again = stageAt(30 * 3600, 32 * 3600, "b");
  const source = pressureRise(model, first, { x: 0.01, y: 0, z }, 1000);
  const fractures = ball(4000, 130, source * 0.5, 7);
  const { events } = simulateStimulation(fractures, [first, again], model, { untilS: 34 * 3600, steps: 600 });
  const inFirst = events.filter((e) => e.tS <= 30 * 3600).length, inSecond = events.length - inFirst;
  assert.ok(inFirst > 300, `${inFirst}`);
  // Pumping the same again into rock already taken to that pressure: few new events (it never quite reaches as far in two hours).
  assert.ok(inSecond < inFirst * 0.15, `${inSecond} on re-pumping against ${inFirst}`);
  // After shut-in the pressure keeps spreading outward, and events trail.
  assert.ok(events.some((e) => e.tS > 2 * 3600 + 60 && e.tS < 30 * 3600), "events after shut-in");
  // A hydraulic fracture grows along SHmax: the cloud is long in that direction and thin across it.
  const frac: PressureModel = { ...model, mode: "fracture", diffusivity: 0.1 };
  const wide = generateFractures({ field, center: { x: 0, y: 0, z }, half: { x: 300, y: 300, z: 200 }, count: 12000, sets: [{ strikeDeg: 25, dipDeg: 75, kappa: 10, weight: 1 }, { strikeDeg: 115, dipDeg: 60, kappa: 10, weight: 1 }], radiusMinM: 2, radiusMaxM: 60, sizeExponent: 3, muMean: 0.6, muSd: 0.05, seed: 2 });
  const cloud = simulateStimulation(wide, [stageAt(0, 3 * 3600)], frac, { untilS: 4 * 3600, steps: 160 }).events;
  assert.ok(cloud.length > 50, `${cloud.length}`);
  const a = 25 * Math.PI / 180, spread = (u: (e: { x: number; y: number }) => number) => { const v = cloud.map(u), m = v.reduce((s, x) => s + x, 0) / v.length; return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length); };
  const along = spread((e) => e.x * Math.sin(a) + e.y * Math.cos(a)), across = spread((e) => e.x * Math.cos(a) - e.y * Math.sin(a));
  assert.ok(along > 2 * across, `along ${along} across ${across}`);
});
