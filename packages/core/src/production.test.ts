import assert from "node:assert/strict";
import test from "node:test";
import { beggsBrill, bubblePoint, gasViscosity, gasZ, inflow, oilFvf, oilViscosity, operatingPoint, outflowCurve, rateGrid, solutionGor, traverse } from "./production.ts";
import type { BlackOil, Reservoir, WellModel, WellPath, WellTest } from "./production.ts";
import { bubblePoint as pbOf, calibrateFlow, gaugeFit, inflowByTest, matchPvt, pressureAtDate, rankCorrelations, skinFromPi, syntheticWellTests, tuneFlow } from "./production.ts";

const oil: BlackOil = { api: 35, gasSg: 0.75, gor: 600, waterSg: 1.03 };
const near = (actual: number, expected: number, tolerance: number, what: string) => assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} vs ${expected} ± ${tolerance}`);

test("PVT: the bubble point holds all the gas, and the oil swells with it and thins", () => {
  const t = 200, pb = bubblePoint(oil, t);
  // Standing by hand: 18.2[(600/0.75)^0.83 · 10^(0.00091·200 − 0.0125·35) − 1.4] = 2,569.5 psia.
  near(pb, 2569.5, 0.5, "bubble point");
  near(solutionGor(oil, pb, t), oil.gor, 1, "Rs at the bubble point");
  assert.ok(solutionGor(oil, pb / 2, t) < oil.gor / 1.5, "half the pressure keeps well under the gas");
  // Bo peaks at the bubble point: gas leaves below it, the liquid compresses above it.
  assert.ok(oilFvf(oil, pb, t) > oilFvf(oil, pb / 2, t) && oilFvf(oil, pb, t) > oilFvf(oil, pb + 2000, t));
  // Standing by hand: 0.9759 + 0.00012[600·√(0.75/0.8498) + 1.25·200]^1.2 = 1.3489.
  near(oilFvf(oil, pb, t), 1.3489, 0.0005, "Bo at the bubble point");
  // Above it, Vasquez–Beggs integrated: Bo = Bob (pb/p)^A, A = 10⁻⁵(−1433 + 5·600 + 17.2·200 − 1180·0.75 + 12.61·35) = 0.045634.
  near(oilFvf(oil, 2 * pb, t), 1.3489 * 0.5 ** 0.045634, 0.0005, "Bo at twice the bubble point");
  // A Bo match scales the swelling, so stock-tank oil stays at 1.
  near(oilFvf({ ...oil, gor: 0, tuning: { pbFactor: 1, boFactor: 1.2, muFactor: 1 } }, 14.7, 60), oilFvf({ ...oil, gor: 0 }, 14.7, 60) * 1.2 - 0.2, 1e-9, "Bo factor on the swelling");
  // Dead oil of 35 °API at 200 °F is under 2 cp (Beggs–Robinson); gas in solution thins it.
  assert.ok(oilViscosity(oil, 14.7, t) < 2 && oilViscosity(oil, pb, t) < oilViscosity(oil, 14.7, t));
});

test("gas: Z follows the Standing–Katz chart, and the viscosity is a gas's", () => {
  // 0.7 gas: Tpc 377.6 °R, Ppc 663.3 psia. Hall–Yarborough, solved independently, gives 0.821 at
  // Tpr 1.5, Ppr 2 and 0.562 at Tpr 1.2, Ppr 2 (the chart's dip near the critical point).
  near(gasZ(0.7, 2 * 663.34, 1.5 * 377.59 - 459.67), 0.821, 0.005, "Z at Tpr 1.5, Ppr 2");
  near(gasZ(0.7, 2 * 663.34, 1.2 * 377.59 - 459.67), 0.562, 0.015, "Z at Tpr 1.2, Ppr 2");
  near(gasZ(0.7, 14.7, 100), 1, 0.01, "Z at the surface");
  // Lee–Gonzalez–Eakin, worked independently: 0.01694 cp for 0.72 gas at 2,000 psia and 140 °F.
  near(gasViscosity(0.72, 2000, 140), 0.01694, 0.00005, "gas viscosity");
});

const reservoir: Reservoir = { pressure: 3700, tempF: 210, permeabilityMd: 150, netPayFt: 60, skin: 2, drainageRadiusFt: 1500, wellboreRadiusFt: 0.354 };

test("inflow: a straight line above the bubble point, Vogel's curve below, and they invert", () => {
  const ipr = inflow(reservoir, oil);
  assert.ok(ipr.pi > 1 && ipr.pi < 20, `PI ${ipr.pi}`);
  assert.equal(ipr.rate(reservoir.pressure), 0);
  near(ipr.rate(0), ipr.aof, 1e-6, "open flow");
  for (const p of [3500, ipr.bubblePoint, 1500, 400]) near(ipr.pwf(ipr.rate(p))!, p, 0.5, `pwf round trip at ${p}`);
  // Below the bubble point each psi of drawdown buys less.
  assert.ok(ipr.rate(ipr.bubblePoint) - ipr.rate(ipr.bubblePoint + 100) > ipr.rate(500) - ipr.rate(600));
  // Vogel's own example: Pr = Pb = 2,400, 100 STB/d at 1,800 psi gives 250 STB/d open flow and 211 at 800.
  const vogel = inflow({ ...reservoir, pressure: 2400 }, { ...oil, gor: 3000 }, 100 / (2400 / 1.8 * (1 - 0.2 * 0.75 - 0.8 * 0.5625)));
  near(vogel.aof, 250, 0.01, "Vogel open flow"); near(vogel.rate(800), 211.1, 0.1, "Vogel at 800 psi");
  // Petrobras: water alone is a straight line; half water lies between the two.
  const water = inflow(reservoir, oil, ipr.pi, 1), half = inflow(reservoir, oil, ipr.pi, 0.5);
  near(water.rate(500), ipr.pi * (reservoir.pressure - 500), 1e-6, "water: straight line");
  near(half.rate(500), (water.rate(500) + ipr.rate(500)) / 2, 1e-6, "half water: the average");
  near(half.pwf(half.rate(700))!, 700, 0.01, "composite round trip");
});

test("reservoir pressure by date: no build-ups, one, two on a day, and after the last", () => {
  const model: WellModel = { fluid: oil, path, tempAt, tubing: { idIn: 2.992, depthFt: 8800, liftDepthFt: null, liftGasScfD: 0 }, initialPressure: 3000, reservoirTempF: 200 };
  const t = (date: string, p: number | null): WellTest => ({ date, liquidRate: 1000, waterCut: 0, gor: 600, whp: 214.7, liftGasScfD: 0, gaugeMdFt: null, gaugePressure: null, reservoirPressure: p });
  assert.equal(pressureAtDate(model, [t("2024-01-01", null)], "2025-01-01").pressure, 3000);
  // One build-up a year after production started: straight from the initial pressure to it, and that year's trend after.
  const one = [t("2023-01-01", null), t("2024-01-01", 2900)];
  near(pressureAtDate(model, one, "2023-07-02").pressure, 2950, 0.5, "between start and the build-up");
  near(pressureAtDate(model, one, "2025-01-01").pressure, 2900 - 100 * 366 / 365, 0.01, "the year's trend carried on");
  // A single build-up on the first test's day: nothing to take a trend from, so it is held.
  assert.equal(pressureAtDate(model, [t("2024-01-01", 2900)], "2025-01-01").pressure, 2900);
  // Two on one day are averaged; the trend of the last two carries on.
  const two = [t("2023-01-01", null), t("2024-01-01", 2900), t("2024-01-01", 2880), t("2025-01-01", 2790)];
  assert.equal(pressureAtDate(model, two, "2024-01-01").pressure, 2890);
  near(pressureAtDate(model, two, "2026-01-01").pressure, 2690, 1, "extrapolated a year on");
  assert.equal(pressureAtDate(model, two, "not a date").pressure, 3000);
});

test("Beggs & Brill: water alone climbs at its hydrostatic gradient; gas lightens the column", () => {
  const water: BlackOil = { ...oil, gor: 0 };
  const w = beggsBrill({ p: 1000, tempF: 150, fluid: water, oilRate: 0, waterRate: 500, liftGasScfD: 0, idIn: 2.992, angleDeg: 90 });
  assert.equal(w.pattern, "liquid");
  near(w.elevation, 62.37 * 1.03 / 144, 1e-6, "hydrostatic");
  assert.ok(w.friction > 0 && w.friction < 0.01);
  const live = beggsBrill({ p: 800, tempF: 150, fluid: oil, oilRate: 1500, waterRate: 300, liftGasScfD: 0, idIn: 2.992, angleDeg: 90 });
  assert.ok(live.gradient < w.gradient && live.holdup > live.noSlip && live.holdup <= 1, `${live.pattern} ${live.holdup} ${live.noSlip}`);
});

const path: WellPath = { mdFt: [0, 3000, 9000], tvdFt: [0, 3000, 8600] };
const tempAt = (tvd: number) => 80 + 0.016 * tvd;

test("tubing: lift gas lowers the pressure needed at the bottom; a higher wellhead pressure cuts the rate", () => {
  const base = { fluid: oil, liquidRate: 1500, waterCut: 0.3, path, tempAt, tubing: { idIn: 2.992, depthFt: 8800, liftDepthFt: 8000, liftGasScfD: 0 } };
  const natural = traverse({ ...base, whp: 250 }).bottomPressure!;
  const lifted = traverse({ ...base, whp: 250, tubing: { ...base.tubing, liftGasScfD: 800_000 } }).bottomPressure!;
  assert.ok(lifted < natural - 200, `${natural} → ${lifted}`);
  const ipr = inflow(reservoir, oil), rates = rateGrid(ipr.aof);
  const at = (whp: number) => operatingPoint(ipr, outflowCurve(rates, (q) => traverse({ ...base, whp, liquidRate: q }).bottomPressure));
  const low = at(150)!, high = at(600)!;
  assert.ok(low.rate > high.rate, `${low.rate} vs ${high.rate}`);
  near(ipr.pwf(low.rate)!, low.pwf, 15, "the operating point lies on the inflow curve");
  // Too much water and no lift: the column is too heavy and the well dies.
  const dead = operatingPoint({ ...ipr }, outflowCurve(rates, (q) => traverse({ ...base, whp: 250, liquidRate: q, waterCut: 0.97, fluid: { ...oil, gor: 150 } }).bottomPressure));
  assert.ok(dead === null || dead.rate < low.rate / 3);
});

// ── Calibration ──────────────────────────────────────────────────────────────────────────────


test("calibration finds the truth a synthetic well's tests were made from", () => {
  // The true well: Hagedorn & Brown with its holdup 10% and friction 30% over the plain correlation,
  // a fluid whose lab bubble point sits 8% above Standing's, skin growing and pressure falling.
  const trueFluid = { ...oil, gor: 520, tuning: { pbFactor: 1.08, boFactor: 1.02, muFactor: 1.15 } };
  const model: WellModel = { fluid: trueFluid, path, tempAt, tubing: { idIn: 2.992, depthFt: 8800, liftDepthFt: 8000, liftGasScfD: 0 }, initialPressure: 3700, reservoirTempF: 210 };
  const days = (d: string) => (Date.parse(d) - Date.parse("2024-01-01")) / 86400000;
  const reservoirAt = (d: string) => ({ ...reservoir, pressure: 3700 - 0.45 * days(d), skin: 2 + days(d) / 365 * 2 });
  const plan = ["2024-02-01", "2024-06-01", "2024-10-01", "2025-02-01", "2025-06-01", "2025-10-01"].map((date, i) => ({ date, whp: 250 + 20 * i, waterCut: 0.1 + 0.06 * i, gor: 520, liftGasScfD: i >= 3 ? 600_000 : 0, buildUp: i % 2 === 0 }));
  const tests = syntheticWellTests({ model, flow: { correlation: "hagedorn-brown", holdupFactor: 1.1, frictionFactor: 1.3 }, reservoirAt, plan, gaugeMdFt: 8000, gaugeNoisePsi: 5, rateNoise: 0.01 });
  assert.equal(tests.length, 6);

  // PVT: the lab report is the truth's; matching the plain correlations to it recovers its factors.
  const lab = { bubblePoint: pbOf(trueFluid, 210), rsb: 520, boAtPb: 0, muAtPb: 0 };
  const plain = { ...oil, gor: 520 };
  const matched = matchPvt(plain, { ...lab, boAtPb: oilFvfAt(trueFluid, lab.bubblePoint), muAtPb: oilViscosity(trueFluid, lab.bubblePoint, 210) }, 210);
  near(matched.tuning.pbFactor, 1.08, 1e-6, "Pb factor");
  near(matched.tuning.boFactor, 1.02, 1e-6, "Bo factor");
  near(matched.tuning.muFactor, 1.15, 1e-6, "viscosity factor");

  // Tubing: untuned, a correlation that is not the truth's may fit better (here Beggs & Brill: the
  // truth's tuned Hagedorn & Brown behaves like it), which is why the match tunes after ranking.
  const calibrated = { ...model, fluid: { ...plain, tuning: matched.tuning } };
  const ranking = rankCorrelations(calibrated, tests);
  assert.equal(ranking[0]!.id, "beggs-brill");
  const { best: tuned } = calibrateFlow(calibrated, tests);
  assert.equal(tuned.correlation, "hagedorn-brown");
  assert.ok(tuned.mae < 16, `gauge error after tuning ${tuned.mae}`);
  // These tests sit at similar rates with noise: holdup and friction trade off, and the gauges cannot
  // tell them apart. The tuner must say so (friction not resolved, held at 1), not report a value.
  const own = tuneFlow(calibrated, tests, "hagedorn-brown");
  assert.equal(own.resolved.holdup, true);
  assert.equal(own.resolved.friction, false, "friction cannot be resolved from these tests");
  assert.equal(own.frictionFactor, 1);
  // Without noise the same tests do pin both down: the tuner finds the truth, not just a low error.
  const clean = syntheticWellTests({ model, flow: { correlation: "hagedorn-brown", holdupFactor: 1.1, frictionFactor: 1.3 }, reservoirAt, plan, gaugeMdFt: 8000, gaugeNoisePsi: 0, rateNoise: 0 });
  const exact = tuneFlow(calibrated, clean, "hagedorn-brown");
  near(exact.holdupFactor, 1.1, 0.02, "holdup, noise-free"); near(exact.frictionFactor, 1.3, 0.05, "friction, noise-free");
  // And with noise, a multi-rate test (choke and lift steps) resolves friction too.
  const steps = ["2024-02-01", "2024-02-02", "2024-02-03", "2024-06-01", "2024-06-02", "2024-10-01", "2024-10-02", "2025-02-01"].map((date, i) => ({ date, whp: [150, 450, 900, 200, 700, 300, 850, 250][i]!, waterCut: 0.1 + 0.02 * i, gor: 520, liftGasScfD: [0, 0, 0, 600e3, 600e3, 1.2e6, 1.2e6, 0][i]!, buildUp: i % 3 === 0 }));
  const multi = tuneFlow(calibrated, syntheticWellTests({ model, flow: { correlation: "hagedorn-brown", holdupFactor: 1.1, frictionFactor: 1.3 }, reservoirAt, plan: steps, gaugeMdFt: 8000, gaugeNoisePsi: 5, rateNoise: 0.01 }), "hagedorn-brown");
  assert.ok(multi.resolved.friction && multi.resolved.holdup, "a multi-rate test resolves both");
  near(multi.holdupFactor, 1.1, 0.04, "holdup, multi-rate"); near(multi.frictionFactor, 1.3, 0.12, "friction, multi-rate");
  // No gauges: nothing to tune, so the correlation is left as published.
  const blind = tuneFlow(calibrated, tests.map((t) => ({ ...t, gaugePressure: null })), "hagedorn-brown");
  assert.equal(blind.gauges, 0); assert.equal(blind.holdupFactor, 1); assert.equal(blind.frictionFactor, 1);

  // Inflow: each test's productivity index is the true one at its date, and the skin read from it at the true k tracks the truth.
  // With the gauges removed, the flowing pressure comes from the tuned tubing alone: the PI then depends on the match.
  const tubingOnly = inflowByTest(calibrated, clean.map((t) => ({ ...t, gaugePressure: null })), exact);
  for (const row of tubingOnly) { const truthPi = inflow(reservoirAt(row.test.date), { ...trueFluid, gor: row.test.gor }, undefined, row.test.waterCut).pi; near(row.pi!, truthPi, truthPi * 0.05, `PI from the tubing on ${row.test.date}`); }
  const untunedPi = inflowByTest(calibrated, clean.map((t) => ({ ...t, gaugePressure: null })), { correlation: "hagedorn-brown", holdupFactor: 1, frictionFactor: 1 });
  assert.ok(untunedPi.some((row) => Math.abs(row.pi! / inflow(reservoirAt(row.test.date), { ...trueFluid, gor: row.test.gor }).pi - 1) > 0.1), "an untuned tubing gets the PI wrong: the check can fail");
  const byTest = inflowByTest(calibrated, tests, tuned);
  for (const row of byTest) {
    const truthRes = reservoirAt(row.test.date), truthPi = inflow(truthRes, { ...trueFluid, gor: row.test.gor }, undefined, row.test.waterCut).pi;
    near(row.pi!, truthPi, truthPi * 0.06, `PI on ${row.test.date}`);
    near(skinFromPi(row.pi!, { ...truthRes }, { ...plain, tuning: matched.tuning }), truthRes.skin, 0.5, `skin on ${row.test.date}`);
  }
  assert.ok(gaugeFit(calibrated, tests, tuned).mae < 16);
});

const oilFvfAt = (fluid: BlackOil, p: number) => oilFvf(fluid, p, 210);

// ── Gas-lift design ─────────────────────────────────────────────────────────────────────────
import { casingPressureAt, gasLiftDesign, liftOptimum, liftPerformance } from "./production.ts";
import type { GasLiftInput } from "./production.ts";

test("gas lift: casing pressure gains its gas column; the design reaches deeper with more pressure; valves step down to the operating one", () => {
  // A static gas column of SG 0.65 at 1000 psia gains roughly 2.3 psi per 100 ft.
  const pc = casingPressureAt(1014.7, 0.65, 8000, tempAt);
  assert.ok(pc > 1014.7 + 150 && pc < 1014.7 + 260, `${pc}`);
  const tired = { ...reservoir, pressure: 2600 };
  const model: WellModel = { fluid: { ...oil, gor: 300 }, path, tempAt, tubing: { idIn: 2.992, depthFt: 8800, liftDepthFt: null, liftGasScfD: 0 }, initialPressure: 2600, reservoirTempF: 210 };
  const base: GasLiftInput = {
    model, ipr: inflow(tired, model.fluid), waterCut: 0.5, gor: 300, whp: 164.7, unloadingWhp: 114.7, liftGasSg: 0.65,
    kickoffPsia: 1214.7, operatingPsia: 1064.7, availableScfD: 1_000_000, deepestMdFt: 8600,
  };
  const design = gasLiftDesign(base)!;
  assert.ok(design.operating && design.reason === null, design.reason ?? "");
  // The deepest unloading valve really uncovers the operating valve: the load fluid from the design
  // tubing pressure there, down to the operating valve, sits under the operating casing pressure.
  const last = design.valves.at(-2)!, op = design.valves.at(-1)!;
  const designTop = base.whp + 0.2 * (base.operatingPsia - base.whp), designAt = (tvd: number) => designTop + (design.operating!.tubingAt - designTop) * tvd / op.tvdFt;
  assert.ok(designAt(last.tvdFt) + 0.465 * (op.tvdFt - last.tvdFt) <= casingPressureAt(base.operatingPsia, 0.65, op.tvdFt, tempAt) + 0.5, "the last unloading valve reaches the operating one");
  // Each valve's casing pressure is the gas column under its own setting: depths and settings agree.
  for (const v of design.valves) near(v.casingPsia, casingPressureAt(v.surfaceOpeningPsig + 14.7, 0.65, v.tvdFt, tempAt), 0.5, `casing pressure at ${Math.round(v.mdFt)} ft`);
  // Only 150 psi of kickoff margin over 50: no string of 20-psi steps can uncover that valve, and the design says so rather than drawing one.
  const short = gasLiftDesign({ ...base, kickoffPsia: 1114.7 });
  assert.equal(short.valves.length, 0); assert.ok(short.reason, "a reason is given");
  const valves = design.valves;
  assert.equal(valves.at(-1)!.role, "operating");
  assert.ok(valves.length >= 3, `${valves.length} valves`);
  for (let i = 1; i < valves.length; i++) assert.ok(valves[i]!.mdFt - valves[i - 1]!.mdFt >= 299, "no two valves closer than the minimum");
  // Each unloading valve opens at a lower surface pressure than the one above, so the ones above close.
  const unloading = valves.filter((v) => v.role === "unloading");
  for (let i = 1; i < valves.length; i++) assert.ok(valves[i]!.surfaceOpeningPsig <= valves[i - 1]!.surfaceOpeningPsig);
  // Spacing narrows with depth (the tubing line climbs toward the casing line).
  if (unloading.length >= 3) assert.ok(unloading[1]!.mdFt - unloading[0]!.mdFt > unloading.at(-1)!.mdFt - unloading.at(-2)!.mdFt - 1);
  // The operating valve's casing pressure clears the flowing tubing pressure by the differential.
  assert.ok(design.operating!.casingAt - design.operating!.tubingAt >= 100);
  // Less injection pressure: the point of injection moves up.
  const weak = gasLiftDesign({ ...base, kickoffPsia: 864.7, operatingPsia: 714.7 });
  assert.ok(!weak.operating || weak.operating.mdFt < design.operating!.mdFt, `${weak.operating?.mdFt} vs ${design.operating!.mdFt}`);

  // The performance curve rises then flattens; the economic optimum sits below the technical maximum.
  const curve = liftPerformance(base, design.operating!.mdFt, [0, 250e3, 500e3, 1e6, 1.5e6, 2.5e6, 4e6]);
  assert.ok(curve[3]!.oil > curve[0]!.oil, "lift gas brings oil");
  const best = liftOptimum(curve, 60, 3, 4e6);
  assert.ok(best.economic.gasScfD <= best.maximum.gasScfD && best.economic.gasScfD > 0, `${best.economic.gasScfD} vs ${best.maximum.gasScfD}`);
  // On the model, not the grid: the optimum is where one more Mscf/d brings oil worth what it costs.
  const oilAt = (g: number) => liftPerformance(base, design.operating!.mdFt, [g])[0]!.oil;
  const refined = liftOptimum(curve, 60, 3, 4e6, oilAt), g = refined.economic.gasScfD;
  assert.ok(!curve.some((p) => Math.abs(p.gasScfD - g) < 1000), `optimum ${g} sits on a grid point`);
  // The daily margin peaks there: less gas or more gas both earn less. (Beggs & Brill's flow-pattern map has
  // published jumps, so the curve's local slope is kinked; the margin is the honest test.)
  const margin = (x: number) => oilAt(x) * 60 - x / 1000 * 3;
  for (const d of [-200e3, -100e3, 100e3, 200e3]) assert.ok(margin(g) >= margin(g + d) - 1, `margin at ${g + d} beats the optimum`);
  // Over a wider span the slope is the break-even: gas cost over oil netback.
  near((oilAt(g + 200e3) - oilAt(g - 200e3)) / 400, 3 / 60, 0.012, "marginal oil per Mscf across the optimum");
  assert.ok(refined.maximum.gasScfD > g, "the technical maximum lies past the economic optimum");
  const dear = liftOptimum(curve, 60, 30, 4e6);
  assert.ok(dear.economic.gasScfD <= best.economic.gasScfD, "dearer gas: less of it");
  assert.ok(liftOptimum(curve, 60, 3, 500e3).economic.gasScfD <= 500e3, "never past the gas available");
});

// ── Material balance and forecast ───────────────────────────────────────────────────────────
import { cumulativeAtTests, cumulativeOn, forecastWell, liftTable, matchTank, pressurePoints, tankGor, tankPressure, tankStep, tankTerms, worTrend } from "./production.ts";
import type { Tank, TankState } from "./production.ts";

const tankBase = { initialPressure: 4000, tempF: 200, fluid: { api: 35, gasSg: 0.75, gor: 600, waterSg: 1.03 }, swi: 0.2, cw: 3e-6, cf: 4e-6 };

test("tank: stepping and solving agree; the match recovers STOIIP and aquifer; below the bubble point free gas comes out", () => {
  const truth: Tank = { ...tankBase, stoiip: 40e6, aquifer: 2 };
  // Above the bubble point a step lands on the pressure the balance solves for.
  let s: TankState = { p: 4000, np: 0, wp: 0, gp: 0 };
  const dates = ["2024-01-01", "2024-07-01", "2025-01-01", "2025-07-01", "2026-01-01"];
  const tests: WellTest[] = [];
  for (let i = 0; i < dates.length; i++) {
    const wc = 0.1 + 0.1 * i;
    tests.push({ date: dates[i]!, liquidRate: 2000, waterCut: wc, gor: 600, whp: 264.7, liftGasScfD: 0, gaugeMdFt: null, gaugePressure: null, reservoirPressure: Math.round(s.p) });
    if (i < dates.length - 1) {
      const days = (Date.parse(dates[i + 1]!) - Date.parse(dates[i]!)) / 86400000;
      // Production as the cumulative reads it: the trapezoid of this test's and the next's rates.
      const oil = 2000 * (1 - (wc + 0.05)) * days, water = 2000 * (wc + 0.05) * days;
      s = tankStep(truth, s, oil, water);
    }
  }
  near(tankPressure(truth, s), s.p, 1, "step against solve");
  // Kept above the bubble point, so the tests' constant GOR is the truth's: the data are consistent.
  assert.ok(s.p < 3700 && s.p > pbOf(tankBase.fluid, tankBase.tempF), `${s.p}`);
  const matched = matchTank(tankBase, pressurePoints(tests));
  // Pressures rounded to the psi, otherwise noise-free, on the match's own rock: the best fit finds the
  // truth's aquifer (refined, not read off the grid) and its STOIIP. This checks the solver, not the
  // method's power: the deck test checks that against a truth whose rock differs from the assumed.
  near(matched.tank.aquifer, 2, 0.1, "aquifer");
  near(matched.tank.stoiip / 40e6, 1, 0.02, "STOIIP");
  assert.ok(matched.mae < 1, `${matched.mae}`);
  assert.ok(matched.range.stoiip[0] <= 40e6 && matched.range.stoiip[1] >= 40e6, "the truth inside the range");
  // Havlena–Odeh: F grows with Et.
  const pts = matched.points;
  assert.ok(pts.at(-1)!.f > pts[0]!.f && pts.at(-1)!.et > pts[0]!.et);
  // Below the bubble point, once the gas saturation passes the critical, the GOR climbs over the solution GOR.
  const small: Tank = { ...tankBase, stoiip: 2e6, aquifer: 0 };
  let t: TankState = { p: 4000, np: 0, wp: 0, gp: 0 };
  for (let i = 0; i < 40; i++) t = tankStep(small, t, 6000, 0);
  const rs = tankTerms(small, t.p).rs;
  assert.ok(t.p < pbOf(small.fluid, small.tempF) - 400, `${t.p}`);
  assert.ok(tankGor(small, t.p, t.np) > rs * 1.2, `${tankGor(small, t.p, t.np)} vs ${rs}`);
  // An aquifer fills the pores behind the oil: at the same production less gas comes out of solution
  // into a smaller free space, so the producing GOR stays nearer the solution GOR.
  const wet: Tank = { ...small, aquifer: 4 };
  let u: TankState = { p: 4000, np: 0, wp: 0, gp: 0 };
  for (let i = 0; i < 40; i++) u = tankStep(wet, u, 6000, 0);
  assert.ok(u.p > t.p && tankGor(wet, u.p, u.np, u.wp) < tankGor(small, t.p, t.np, t.wp), `${tankGor(wet, u.p, u.np, u.wp)} vs ${tankGor(small, t.p, t.np, t.wp)}`);
  assert.equal(cumulativeAtTests(tests).at(-1)!.np > 0, true);
  near(cumulativeOn([{ month: "2024-01", oil: 3100, water: 0, gas: 0 }, { month: "2024-02", oil: 2900, water: 0, gas: 0 }], "2024-02-15").np, 3100 + 2900 * 14 / 29, 1e-6, "cumulative mid-month");
});

test("WOR trend recovers its line; the forecast declines and lift gas makes more oil", () => {
  const trend = worTrend([0, 1e6, 2e6, 3e6].map((np) => { const wor = Math.exp(-2 + 1e-6 * np); return { np, waterCut: wor / (1 + wor) }; }));
  near(trend.slope, 1e-6, 1e-9, "slope"); near(trend.intercept, -2, 1e-6, "intercept");
  const tank: Tank = { ...tankBase, stoiip: 15e6, aquifer: 1 };
  const model: WellModel = { fluid: tankBase.fluid, path, tempAt, tubing: { idIn: 2.992, depthFt: 8800, liftDepthFt: 8000, liftGasScfD: 0 }, initialPressure: 4000, reservoirTempF: 200 };
  const table = (gas: number) => liftTable((q, wc, gor) => traverse({ whp: 214.7, fluid: { ...model.fluid, gor }, liquidRate: q, waterCut: wc, tubing: { ...model.tubing, liftGasScfD: gas }, path, tempAt, stepFt: 300 }).bottomPressure, 8000, 600);
  const run = (gas: number) => forecastWell({ tank, start: { p: 4000, np: 0, wp: 0, gp: 0 }, startDate: "2026-01-01", pi: 4, waterCutAt: (np) => Math.min(0.95, 0.1 + np / 2e7), minWaterCut: 0.1, bhp: table(gas).bhp, maxRate: 8000, months: 96, economicLimit: 50 });
  const natural = run(0), lifted = run(1.5e6);
  assert.ok(natural.steps.length > 3);
  assert.ok(natural.steps.at(-1)!.oil < natural.steps[0]!.oil, "oil declines");
  assert.ok(natural.steps.at(-1)!.pressure < 4000);
  const total = (f: typeof natural) => f.steps.reduce((sum, s) => sum + s.oil * 30.4, 0);
  assert.ok(total(lifted) > total(natural), `${total(lifted)} vs ${total(natural)}`);
});
