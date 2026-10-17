import { PSI_PER_M_PER_SG, findPipe, pressureAt, tubingTable, tvdAtMd } from "@ikhmalputra/subsurface-core";
import type { WellDesignBrief } from "@ikhmalputra/subsurface-core";
import { bubblePoint, calibrateFlow, casingPressureAt, cumulativeAtTests, cumulativeOn, forecastWell, gasLiftDesign, gaugeFit, inflow, inflowByTest, liftOptimum, liftPerformance, liftTable, matchPvt, matchTank, operatingPoint, outflowCurve, pressureAtDate, pressurePoints, rateGrid, solutionGor, tankPressure, traverse, worTrend } from "@ikhmalputra/subsurface-core/production";
import type { BlackOil, Correlation, FlowTuning, GasLiftInput, Inflow, LabPvt, NodalCurve, ProductionMonth, Tank, OperatingPoint, PvtTuning, Reservoir, Traverse, WellModel, WellPath, WellTest } from "@ikhmalputra/subsurface-core/production";

/**
 * A designed well as a producer: what its brief says (depths, path, tubing, perforations, pore
 * pressure, temperature, lift) and what it does not (oil and gas gravity, gas–oil ratio, water cut,
 * permeability, skin, wellhead pressure, lift gas rate), the latter as inputs the user sets. From
 * them, the inflow and outflow curves, the operating point, the traverse at it, and how the rate
 * moves with one input. Field units inside, as the correlations are; the module converts for show.
 */

export const FT_PER_M = 3.28084;
export const SM3_PER_STB = 0.158987;

export interface NodalInputs {
  readonly api: number;
  readonly gasSg: number;
  readonly gor: number;
  readonly waterSg: number;
  /** Fraction of the produced liquid that is water. */
  readonly waterCut: number;
  readonly permeabilityMd: number;
  readonly skin: number;
  readonly drainageRadiusM: number;
  readonly whpPsi: number;
  /** Lift gas injected at the deepest mandrel, thousand scf/d (0 = none). */
  readonly liftMscfD: number;
  /** Tubing outside diameter, in: the design's by default. */
  readonly tubingOdIn: number | null;
  /** Reservoir pressure lost to production so far, fraction of the initial. */
  readonly depletion: number;
}
export const defaultNodal: NodalInputs = { api: 35, gasSg: 0.75, gor: 450, waterSg: 1.03, waterCut: 0.3, permeabilityMd: 30, skin: 3, drainageRadiusM: 450, whpPsi: 250, liftMscfD: 800, tubingOdIn: null, depletion: 0 };

export type Compare = "tubing" | "lift" | "waterCut" | "whp";
export const COMPARE_VALUES: Readonly<Record<Compare, readonly number[]>> = {
  tubing: [2.375, 2.875, 3.5, 4.5], lift: [0, 400, 800, 1500, 2500, 4000], waterCut: [0, 0.2, 0.4, 0.6, 0.8], whp: [100, 250, 500, 800],
};

export interface WellCase {
  readonly fluid: BlackOil;
  readonly reservoir: Reservoir;
  readonly path: WellPath;
  readonly tempAt: (tvdFt: number) => number;
  /** Mid-perforation depth, m MD and m TVD; perforated interval, m. */
  readonly midPerfMdM: number;
  readonly midPerfTvdM: number;
  readonly perfThicknessM: number;
  readonly liftDepthMdM: number | null;
  readonly tubingIdIn: number;
  readonly tubingOdIn: number;
  readonly lift: string;
  /** What came from the design, for the panel to say so. */
  readonly fromDesign: { readonly pressureSg: number; readonly tempC: number };
}

/** The design as a producer; null with what is missing. */
export function wellCase(brief: WellDesignBrief, inputs: NodalInputs): WellCase | string {
  const completion = brief.completion;
  if (!completion) return "No completion yet: tubing, packer and perforations come from the Well designer's Completion stage.";
  const perf = completion.perforations[0];
  if (!perf) return "The completion has no perforations: add them in the Well designer.";
  if (!brief.geology.pressures.length) return "No pore pressures yet: the reservoir pressure comes from the Well designer's Geology & pressures stage.";
  const midMd = (perf.topMdM + perf.bottomMdM) / 2, midTvd = tvdAtMd(brief, midMd);
  const thickness = Math.max(3, tvdAtMd(brief, perf.bottomMdM) - tvdAtMd(brief, perf.topMdM));
  const odIn = inputs.tubingOdIn ?? completion.tubingOdIn;
  const pipe = inputs.tubingOdIn === null ? findPipe(completion.tubingOdIn, completion.tubingWeightLbFt, tubingTable) : tubingTable.find((row) => Math.abs(row.odIn - odIn) < 1e-6);
  if (!pipe) return `Tubing ${odIn} in is not in the API table.`;
  const pore = pressureAt(brief, midTvd).porePressureSg;
  const tempC = brief.geology.surfaceTemperatureC + brief.geology.geothermalGradientCPerKm * midTvd / 1000;
  const toF = (c: number) => c * 9 / 5 + 32;
  const production = [...brief.sections].filter((section) => section.role === "production" || section.role === "liner").sort((a, b) => b.shoeMdM - a.shoeMdM)[0];
  const md: number[] = [], tvd: number[] = [];
  for (let m = 0; m < midMd; m += 50) { md.push(m * FT_PER_M); tvd.push(tvdAtMd(brief, m) * FT_PER_M); }
  md.push(midMd * FT_PER_M); tvd.push(midTvd * FT_PER_M);
  const liftDepth = completion.artificialLift === "gas-lift" ? Math.max(100, completion.packerMdM - 30) : null;
  return {
    fluid: { api: inputs.api, gasSg: inputs.gasSg, gor: inputs.gor, waterSg: inputs.waterSg },
    reservoir: {
      pressure: (pore * PSI_PER_M_PER_SG * midTvd + 14.7) * (1 - inputs.depletion), tempF: toF(tempC),
      permeabilityMd: inputs.permeabilityMd, netPayFt: thickness * FT_PER_M, skin: inputs.skin,
      drainageRadiusFt: inputs.drainageRadiusM * FT_PER_M, wellboreRadiusFt: (production?.holeSizeIn ?? 8.5) / 24,
    },
    path: { mdFt: md, tvdFt: tvd },
    tempAt: (tvdFt: number) => toF(brief.geology.surfaceTemperatureC + brief.geology.geothermalGradientCPerKm * tvdFt / FT_PER_M / 1000),
    midPerfMdM: midMd, midPerfTvdM: midTvd, perfThicknessM: thickness, liftDepthMdM: liftDepth,
    tubingIdIn: pipe.idIn, tubingOdIn: pipe.odIn, lift: completion.artificialLift,
    fromDesign: { pressureSg: pore, tempC },
  };
}

export interface Solved {
  readonly ipr: Inflow;
  readonly vlp: NodalCurve;
  readonly point: OperatingPoint | null;
  readonly traverse: Traverse | null;
  readonly bubblePointPsi: number;
}

/**
 * What a match fixed, from the well's own tests: the PVT factors, the tubing correlation and its
 * factors, and the inflow the latest test shows. Prediction uses these in place of the assumptions.
 */
export interface Calibration {
  readonly at: string;
  readonly tests: number;
  readonly pvt: PvtTuning | null;
  /** The fluid the match settled on: the lab's gravities where it gave them, and the PVT factors. */
  readonly fluid: BlackOil;
  readonly flow: FlowTuning & { readonly mae: number; readonly bias: number; readonly resolved?: { readonly holdup: boolean; readonly friction: boolean }; readonly clear?: boolean };
  readonly lastTest: WellTest;
  /** The last test's flowing pressure at the perforations, psia: where the test sits on the nodal plot. */
  readonly lastPwf: number;
  readonly pi: number;
  readonly reservoirPressure: number;
}

const tubingOf = (well: WellCase, liftMscfD: number) => ({ idIn: well.tubingIdIn, depthFt: well.midPerfMdM * FT_PER_M, liftDepthFt: well.liftDepthMdM === null ? null : well.liftDepthMdM * FT_PER_M, liftGasScfD: well.liftDepthMdM === null ? 0 : liftMscfD * 1000 });

/** The well as the core's calibration takes it. */
export const modelOf = (well: WellCase, pvt: PvtTuning | null = null, fluid: BlackOil = well.fluid): WellModel => ({
  fluid: { ...fluid, tuning: pvt ?? undefined }, path: well.path, tempAt: well.tempAt, tubing: tubingOf(well, 0),
  initialPressure: well.reservoir.pressure, reservoirTempF: well.reservoir.tempF,
});

/** The whole match, as an engineer runs it: PVT to the lab, every correlation tuned to the gauges, the inflow each test shows. */
export function runMatch(well: WellCase, tests: readonly WellTest[], lab: LabPvt | null) {
  const pvt = lab ? matchPvt(well.fluid, lab, well.reservoir.tempF) : null;
  const model = modelOf(well, pvt?.tuning ?? null, pvt?.fluid ?? well.fluid);
  const flow = calibrateFlow(model, tests);
  const best = flow.best;
  const before = gaugeFit(model, tests, { correlation: "beggs-brill", holdupFactor: 1, frictionFactor: 1 });
  const after = gaugeFit(model, tests, best);
  const byTest = inflowByTest(model, tests, best);
  const sorted = [...byTest].filter((row) => row.pi !== null).sort((a, b) => Date.parse(a.test.date) - Date.parse(b.test.date));
  const last = sorted.at(-1);
  const calibration: Calibration | null = last ? {
    at: new Date().toISOString().slice(0, 10), tests: tests.length, pvt: pvt?.tuning ?? null, fluid: model.fluid,
    flow: { correlation: best.correlation, holdupFactor: best.holdupFactor, frictionFactor: best.frictionFactor, mae: best.mae, bias: best.bias, resolved: best.resolved, clear: flow.clear },
    lastTest: last.test, lastPwf: last.pwf ?? NaN, pi: last.pi!, reservoirPressure: last.reservoirPressure,
  } : null;
  return { pvt, flow, before, after, byTest, calibration, model };
}

/** Reservoir pressure today by the tests' trend: for predicting now, not at the last test. */
export const pressureNow = (well: WellCase, tests: readonly WellTest[], date: string) => pressureAtDate(modelOf(well), tests, date);

/** What prediction runs on: the matched fluid, reservoir, inflow and tubing correlation once calibrated, else the assumed ones. */
function basis(well: WellCase, inputs: NodalInputs, calibration: Calibration | null) {
  const fluid: BlackOil = calibration ? { ...calibration.fluid, gor: calibration.lastTest.gor } : well.fluid;
  const reservoir = calibration ? { ...well.reservoir, pressure: calibration.reservoirPressure * (1 - inputs.depletion) } : well.reservoir;
  // Calibrated, the inflow is the latest test's productivity index (skin and permeability cannot be told apart from rate).
  const ipr = calibration ? inflow(reservoir, fluid, calibration.pi, inputs.waterCut) : inflow(reservoir, fluid, undefined, inputs.waterCut);
  const flow: FlowTuning | null = calibration ? { correlation: calibration.flow.correlation as Correlation, holdupFactor: calibration.flow.holdupFactor, frictionFactor: calibration.flow.frictionFactor } : null;
  return { fluid, reservoir, ipr, flow };
}

/** One case solved: inflow, outflow, where they meet and the traverse there; with a calibration, on the matched model. */
export function solve(well: WellCase, inputs: NodalInputs, rates?: Float64Array, calibration: Calibration | null = null): Solved {
  const { fluid, reservoir, ipr, flow } = basis(well, inputs, calibration);
  const grid = rates ?? rateGrid(ipr.aof, 36);
  const tubing = tubingOf(well, inputs.liftMscfD);
  const run = (q: number) => traverse({ whp: inputs.whpPsi + 14.7, fluid, liquidRate: q, waterCut: inputs.waterCut, tubing, path: well.path, tempAt: well.tempAt, stepFt: 150, ...flow });
  const vlp = outflowCurve(grid, (q) => run(q).bottomPressure);
  const point = operatingPoint(ipr, vlp);
  return { ipr, vlp, point, traverse: point ? run(point.rate) : null, bubblePointPsi: bubblePoint(fluid, reservoir.tempF) };
}

/** What the gas-lift design needs that the well design does not say: the gas supply, the unloading conditions and the prices. */
export interface LiftInputs {
  /** Surface injection pressures the compressor gives, psig: at kickoff and in steady operation. */
  readonly kickoffPsig: number;
  readonly operatingPsig: number;
  /** Lift gas the compressor can give this well, Mscf/d. */
  readonly availableMscfD: number;
  readonly liftGasSg: number;
  /** Wellhead pressure while unloading to the flowline or test separator, psig. */
  readonly unloadingWhpPsig: number;
  /** Load (kill or completion) fluid in the well before kickoff, SG. */
  readonly loadFluidSg: number;
  /** Surface opening pressure dropped per valve down the string, psi. */
  readonly perValveDropPsi: number;
  readonly minSpacingM: number;
  /** Oil netback after transport and royalty, $/bbl; lift gas cost (compression fuel and upkeep, or its sales value), $/Mscf. */
  readonly oilNetback: number;
  readonly gasCost: number;
}
export const defaultLift: LiftInputs = { kickoffPsig: 1900, operatingPsig: 1800, availableMscfD: 2500, liftGasSg: 0.65, unloadingWhpPsig: 120, loadFluidSg: 1.06, perValveDropPsi: 20, minSpacingM: 90, oilNetback: 55, gasCost: 2.5 };

/** The gas-lift design for the well as it is predicted today: injection depth, valve schedule, performance curve and optimum. */
export function liftDesign(brief: WellDesignBrief, well: WellCase, inputs: NodalInputs, calibration: Calibration | null, lift: LiftInputs) {
  const { fluid, ipr, flow } = basis(well, inputs, calibration);
  const model: WellModel = { fluid, path: well.path, tempAt: well.tempAt, tubing: tubingOf(well, 0), initialPressure: well.reservoir.pressure, reservoirTempF: well.reservoir.tempF };
  const packer = brief.completion?.packerMdM ?? well.midPerfMdM - 60;
  const input: GasLiftInput = {
    model, ipr, flow: flow ?? undefined, waterCut: inputs.waterCut, gor: fluid.gor, whp: inputs.whpPsi + 14.7,
    unloadingWhp: lift.unloadingWhpPsig + 14.7, liftGasSg: lift.liftGasSg, kickoffPsia: lift.kickoffPsig + 14.7, operatingPsia: lift.operatingPsig + 14.7,
    availableScfD: lift.availableMscfD * 1000, perValveDropPsi: lift.perValveDropPsi, loadGradientPsiFt: lift.loadFluidSg * 0.433,
    minSpacingFt: lift.minSpacingM * FT_PER_M, deepestMdFt: Math.max(500, (packer - 30) * FT_PER_M),
  };
  const design = gasLiftDesign(input);
  const injection = design.operating?.mdFt ?? null;
  // To twice the gas available: past the supply only to show where the curve turns over.
  const gas = [0, 0.08, 0.16, 0.25, 0.35, 0.5, 0.65, 0.8, 1, 1.2, 1.45, 1.7, 2].map((f) => Math.round(f * Math.max(lift.availableMscfD, 500)) * 1000);
  const curve = injection === null ? [] : liftPerformance(input, injection, gas);
  // Still rising at the last point: carry the curve on until it turns over, so the "most oil" is a maximum and not the grid's edge.
  for (let k = 0; k < 4 && injection !== null && curve.length > 1 && curve.at(-1)!.oil >= Math.max(...curve.map((p) => p.oil)); k++) curve.push(...liftPerformance(input, injection, [Math.round(curve.at(-1)!.gasScfD * 1.5)]));
  const maximumFound = curve.length > 1 && curve.at(-1)!.oil < Math.max(...curve.map((p) => p.oil));
  const optimum = curve.length && injection !== null ? liftOptimum(curve, lift.oilNetback, lift.gasCost, input.availableScfD, (g) => liftPerformance(input, injection, [g])[0]!.oil) : null;
  // The well's own flowing tubing pressure at the optimum: the line the design chart draws.
  const tubingLine = injection !== null && optimum ? (() => {
    const fluidAt: BlackOil = { ...fluid };
    const q = optimum.economic.oil / Math.max(1e-6, 1 - inputs.waterCut);
    return traverse({ whp: input.whp, fluid: fluidAt, liquidRate: q, waterCut: inputs.waterCut, tubing: { ...model.tubing, liftDepthFt: injection, liftGasScfD: optimum.economic.gasScfD }, path: well.path, tempAt: well.tempAt, stepFt: 150, ...flow });
  })() : null;
  return { input, design, curve, optimum, maximumFound, gasLimited: !!optimum && optimum.economic.gasScfD >= input.availableScfD - 1, tubingLine, packerMdM: packer };
}

/** The same well with one input changed: what the comparison curves are drawn from. */
export function withValue(inputs: NodalInputs, compare: Compare, value: number): NodalInputs {
  return compare === "tubing" ? { ...inputs, tubingOdIn: value } : compare === "lift" ? { ...inputs, liftMscfD: value } : compare === "waterCut" ? { ...inputs, waterCut: value } : { ...inputs, whpPsi: value };
}

/** What the forecast needs that the tests do not give. */
export interface ForecastInputs {
  readonly years: number;
  /** Oil rate below which the well is shut in, STB/d. */
  readonly economicLimit: number;
  /** Liquid the facilities take from this well, STB/d. */
  readonly maxLiquid: number;
}
export const defaultForecast: ForecastInputs = { years: 10, economicLimit: 300, maxLiquid: 12000 };
/** The rock and water the tank assumes: no core or log values reach this module yet. */
export const TANK_ASSUMED = { swi: 0.2, cw: 3e-6, cf: 5e-6 };

/** The tank the engineer picked among the matched candidates (an aquifer size), else the best fit. */
export function chosenTank(matched: ReturnType<typeof tankMatch>, aquifer: number | null): Tank {
  const pick = aquifer === null ? null : matched.all.find((fit) => fit.aquifer === aquifer);
  return pick ? { ...matched.tank, stoiip: pick.stoiip, aquifer: pick.aquifer } : matched.tank;
}

/** The tank matched to the well's build-up pressures, on the matched fluid. */
export function tankMatch(well: WellCase, tests: readonly WellTest[], production: readonly ProductionMonth[], calibration: Calibration) {
  // The initial pressure is the first build-up when one was taken as production started (the design's pore pressure otherwise).
  const first = [...tests].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
  const initialPressure = first?.reservoirPressure ?? well.reservoir.pressure;
  const points = pressurePoints(tests, production);
  const base = { initialPressure, tempF: well.reservoir.tempF, fluid: calibration.fluid, ...TANK_ASSUMED };
  const matched = matchTank(base, points);
  // The rock is assumed: how far the best STOIIP moves across a plausible pore compressibility.
  const rock = ROCK_RANGE.map((cf) => ({ cf, stoiip: matchTank({ ...base, cf }, points).tank.stoiip }));
  return { ...matched, rock, initialPressure, initialMeasured: first?.reservoirPressure != null };
}
/** Pore compressibility across which the match is repeated, 1/psi: consolidated sandstone's usual span. */
export const ROCK_RANGE = [3e-6, 1e-5] as const;

/**
 * Whether the lift gas can get in at the injection depth: the casing pressure there (the operating
 * pressure plus the gas column) must clear the flowing tubing pressure by the valve differential.
 */
export function injectionCheck(well: WellCase, traverse: Traverse | null, lift: LiftInputs, differentialPsi = 100) {
  if (well.liftDepthMdM === null || !traverse) return null;
  const md = well.liftDepthMdM * FT_PER_M, at = traverse.points.reduce((best, p) => Math.abs(p.mdFt - md) < Math.abs(best.mdFt - md) ? p : best, traverse.points[0]!);
  const casing = casingPressureAt(lift.operatingPsig + 14.7, lift.liftGasSg, at.tvdFt, well.tempAt);
  return { casing, tubing: at.p, margin: casing - at.p - differentialPsi, ok: casing - at.p >= differentialPsi };
}

/**
 * The forecast from the last test: natural flow, and with lift gas at the rate and depth Predict
 * holds. Lift curves are tabulated once per case; the tank, the WOR trend and the matched
 * productivity index carry it month by month.
 */
export function forecastCases(well: WellCase, inputs: NodalInputs, calibration: Calibration, tests: readonly WellTest[], production: readonly ProductionMonth[], tank: Tank, f: ForecastInputs) {
  // Cumulatives at each test: from the allocated volumes where there are any, else read between the tests.
  const cum = cumulativeAtTests(tests).map((row) => production.length ? { ...row, ...cumulativeOn(production, row.test.date) } : row), last = cum.at(-1)!;
  const start = { p: tankPressure(tank, last), np: last.np, wp: last.wp, gp: last.gp };
  const wor = worTrend(cum.map((row) => ({ np: row.np, waterCut: row.test.waterCut })));
  const flow = { correlation: calibration.flow.correlation as Correlation, holdupFactor: calibration.flow.holdupFactor, frictionFactor: calibration.flow.frictionFactor };
  const rsi = solutionGor(tank.fluid, tank.initialPressure, tank.tempF);
  const table = (liftMscfD: number) => liftTable((q, wc, gor) => traverse({ whp: inputs.whpPsi + 14.7, fluid: { ...tank.fluid, gor }, liquidRate: q, waterCut: wc, tubing: tubingOf(well, liftMscfD), path: well.path, tempAt: well.tempAt, stepFt: 300, ...flow }).bottomPressure, f.maxLiquid, rsi);
  const run = (liftMscfD: number) => forecastWell({
    tank, start, startDate: last.test.date, pi: calibration.pi, waterCutAt: wor.wcAt, minWaterCut: last.test.waterCut,
    bhp: table(liftMscfD).bhp, maxRate: f.maxLiquid, months: Math.round(f.years * 12), economicLimit: f.economicLimit,
  });
  const natural = run(0);
  const lifted = well.liftDepthMdM !== null && inputs.liftMscfD > 0 ? run(inputs.liftMscfD) : null;
  return { start, wor, cum, natural, lifted };
}

/**
 * The forecast across the tanks the pressures cannot tell apart: the chosen one, and the smallest and
 * largest STOIIP within the match's 95% interval. A band, because one line would claim more than
 * the build-ups know.
 */
export function forecastBand(well: WellCase, inputs: NodalInputs, calibration: Calibration, tests: readonly WellTest[], production: readonly ProductionMonth[], matched: ReturnType<typeof tankMatch>, tank: Tank, f: ForecastInputs) {
  const alike = [...matched.all.filter((fit) => fit.within), matched.best];
  const lo = alike.reduce((a, b) => b.stoiip < a.stoiip ? b : a), hi = alike.reduce((a, b) => b.stoiip > a.stoiip ? b : a);
  const run = (fit: { stoiip: number; aquifer: number }) => forecastCases(well, inputs, calibration, tests, production, { ...matched.tank, stoiip: fit.stoiip, aquifer: fit.aquifer }, f);
  return { main: forecastCases(well, inputs, calibration, tests, production, tank, f), low: run(lo), high: run(hi), tanks: { low: lo, high: hi } };
}
