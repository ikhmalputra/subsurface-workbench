/**
 * Production engineering for one well: black-oil PVT, inflow (Darcy productivity index with Vogel
 * below the bubble point), multiphase flow up the tubing (Beggs & Brill, with Payne's holdup
 * correction, along the real well path) and nodal analysis: where what the reservoir can deliver
 * meets what the tubing can lift. Field units inside (psia, °F, STB/d, scf, ft, in, cp); callers
 * convert at the edges. Pure: runs anywhere.
 *
 * Correlations, as published:
 * - Standing (1947): bubble point, solution gas–oil ratio, saturated oil formation volume factor.
 * - Vasquez & Beggs (1980): undersaturated oil compressibility and viscosity.
 * - Beggs & Robinson (1975): dead and live oil viscosity.
 * - Sutton (1985) pseudo-critical properties; Dranchuk & Abou-Kassem (1975) gas Z-factor.
 * - Lee, Gonzalez & Eakin (1966): gas viscosity.
 * - Beggs & Brill (1973), Payne et al. (1979): multiphase flow pattern, holdup and friction.
 * - Vogel (1968): inflow below the bubble point.
 */

export interface BlackOil {
  /** Stock-tank oil gravity, °API. */
  readonly api: number;
  /** Gas specific gravity (air = 1). */
  readonly gasSg: number;
  /** Producing gas–oil ratio, scf/STB: the solution GOR at the bubble point for a black oil. */
  readonly gor: number;
  /** Produced water specific gravity. */
  readonly waterSg: number;
  /** Factors that bring the correlations onto lab data (see `matchPvt`); 1 when unmatched. */
  readonly tuning?: PvtTuning;
}

/**
 * How the correlations are brought onto a lab report, as PROSPER and Pipesim do: the bubble point
 * scaled (and the solution-gas curve with it, so all the gas is in solution at the matched bubble
 * point), the formation volume factor and the oil viscosity multiplied.
 */
export interface PvtTuning { readonly pbFactor: number; readonly boFactor: number; readonly muFactor: number }
const tuned = (fluid: BlackOil) => fluid.tuning ?? { pbFactor: 1, boFactor: 1, muFactor: 1 };

const oilSg = (api: number) => 141.5 / (131.5 + api);
const rankine = (f: number) => f + 459.67;

/** Bubble-point pressure, psia (Standing, times any match factor); never below atmospheric (a dead oil is saturated there). */
export function bubblePoint(fluid: BlackOil, tempF: number): number {
  return Math.max(14.7, tuned(fluid).pbFactor * 18.2 * ((fluid.gor / fluid.gasSg) ** 0.83 * 10 ** (0.00091 * tempF - 0.0125 * fluid.api) - 1.4));
}

/** Gas dissolved in the oil at a pressure, scf/STB (Standing): all of it at and above the bubble point. */
export function solutionGor(fluid: BlackOil, p: number, tempF: number): number {
  if (p >= bubblePoint(fluid, tempF)) return fluid.gor;
  // A matched bubble point stretches the curve along pressure: the correlation is read at p / factor.
  const q = p / tuned(fluid).pbFactor;
  return Math.min(fluid.gor, Math.max(0, fluid.gasSg * ((q / 18.2 + 1.4) * 10 ** (0.0125 * fluid.api - 0.00091 * tempF)) ** (1 / 0.83)));
}

/** Oil formation volume factor, rb/STB: Standing when saturated, Vasquez–Beggs compressibility above the bubble point. */
export function oilFvf(fluid: BlackOil, p: number, tempF: number): number {
  const pb = bubblePoint(fluid, tempF), rs = solutionGor(fluid, Math.min(p, pb), tempF);
  const saturated = (r: number) => tuned(fluid).boFactor * (0.9759 + 0.00012 * (r * Math.sqrt(fluid.gasSg / oilSg(fluid.api)) + 1.25 * tempF) ** 1.2);
  if (p <= pb) return saturated(rs);
  const co = (-1433 + 5 * fluid.gor + 17.2 * tempF - 1180 * fluid.gasSg + 12.61 * fluid.api) / (p * 1e5);
  return saturated(fluid.gor) * Math.exp(-co * (p - pb));
}

/** Oil viscosity, cp: Beggs–Robinson dead and live oil, Vasquez–Beggs above the bubble point. */
export function oilViscosity(fluid: BlackOil, p: number, tempF: number): number {
  const dead = 10 ** (tempF ** -1.163 * 10 ** (3.0324 - 0.02023 * fluid.api)) - 1;
  const pb = bubblePoint(fluid, tempF), rs = solutionGor(fluid, Math.min(p, pb), tempF);
  const live = tuned(fluid).muFactor * 10.715 * (rs + 100) ** -0.515 * dead ** (5.44 * (rs + 150) ** -0.338);
  if (p <= pb) return live;
  const m = 2.6 * p ** 1.187 * Math.exp(-11.513 - 8.98e-5 * p);
  return live * (p / pb) ** m;
}

/** In-situ oil density, lb/ft³: the stock-tank oil and the gas dissolved in it, in the volume they take. */
export function oilDensity(fluid: BlackOil, p: number, tempF: number): number {
  return (62.37 * oilSg(fluid.api) + 0.0136 * solutionGor(fluid, p, tempF) * fluid.gasSg) / oilFvf(fluid, p, tempF);
}

/** Gas compressibility factor Z (Dranchuk–Abou-Kassem on Sutton pseudo-criticals). */
export function gasZ(gasSg: number, p: number, tempF: number): number {
  const tpc = 169.2 + 349.5 * gasSg - 74 * gasSg * gasSg, ppc = 756.8 - 131 * gasSg - 3.6 * gasSg * gasSg;
  const tr = rankine(tempF) / tpc, pr = p / ppc;
  const A = [0.3265, -1.07, -0.5339, 0.01569, -0.05165, 0.5475, -0.7361, 0.1844, 0.1056, 0.6134, 0.721];
  const c1 = A[0]! + A[1]! / tr + A[2]! / tr ** 3 + A[3]! / tr ** 4 + A[4]! / tr ** 5;
  const c2 = A[5]! + A[6]! / tr + A[7]! / tr ** 2, c3 = A[8]! * (A[6]! / tr + A[7]! / tr ** 2);
  const c4 = (r: number) => A[9]! * (1 + A[10]! * r * r) * (r * r / tr ** 3) * Math.exp(-A[10]! * r * r);
  // Newton on reduced density: z = 0.27 pr / (rho tr).
  let rho = 0.27 * pr / tr;
  for (let i = 0; i < 60; i++) {
    const f = (r: number) => 1 + c1 * r + c2 * r * r - c3 * r ** 5 + c4(r) - 0.27 * pr / (r * tr);
    const h = 1e-6 * Math.max(1e-3, rho), d = (f(rho + h) - f(rho - h)) / (2 * h);
    const next = rho - f(rho) / d;
    if (!Number.isFinite(next) || next <= 0) break;
    if (Math.abs(next - rho) < 1e-10) { rho = next; break; }
    rho = next;
  }
  return 0.27 * pr / (rho * tr);
}

/** Gas density, lb/ft³. */
export const gasDensity = (gasSg: number, p: number, tempF: number) => 28.967 * gasSg * p / (gasZ(gasSg, p, tempF) * 10.7316 * rankine(tempF));
/** Gas formation volume factor, ft³ at the pressure and temperature per scf. */
export const gasFvf = (gasSg: number, p: number, tempF: number) => 0.02827 * gasZ(gasSg, p, tempF) * rankine(tempF) / p;

/** Gas viscosity, cp (Lee–Gonzalez–Eakin). */
export function gasViscosity(gasSg: number, p: number, tempF: number): number {
  const t = rankine(tempF), m = 28.967 * gasSg, rho = gasDensity(gasSg, p, tempF) / 62.428;
  const k = (9.4 + 0.02 * m) * t ** 1.5 / (209 + 19 * m + t), x = 3.5 + 986 / t + 0.01 * m, y = 2.4 - 0.2 * x;
  return 1e-4 * k * Math.exp(x * rho ** y);
}

// ── Inflow ───────────────────────────────────────────────────────────────────────────────────
export interface Reservoir {
  /** Average reservoir pressure, psia. */
  readonly pressure: number;
  readonly tempF: number;
  /** Permeability, mD, and net pay, ft. */
  readonly permeabilityMd: number;
  readonly netPayFt: number;
  readonly skin: number;
  /** Drainage radius and wellbore radius, ft. */
  readonly drainageRadiusFt: number;
  readonly wellboreRadiusFt: number;
}

/** Darcy's productivity index for pseudo-steady radial flow, STB/d/psi, on oil properties at reservoir pressure. */
export function productivityIndex(reservoir: Reservoir, fluid: BlackOil): number {
  const p = reservoir.pressure, t = reservoir.tempF;
  return 0.00708 * reservoir.permeabilityMd * reservoir.netPayFt
    / (oilViscosity(fluid, p, t) * oilFvf(fluid, p, t) * (Math.log(reservoir.drainageRadiusFt / reservoir.wellboreRadiusFt) - 0.75 + reservoir.skin));
}

export interface Inflow {
  readonly pi: number;
  readonly bubblePoint: number;
  /** Absolute open flow: the liquid rate at zero bottom-hole pressure, STB/d. */
  readonly aof: number;
  /** Liquid rate at a flowing bottom-hole pressure, STB/d. */
  readonly rate: (pwf: number) => number;
  /** Flowing bottom-hole pressure for a liquid rate, psia; null beyond the open flow. */
  readonly pwf: (rate: number) => number | null;
}

/** The well's inflow: straight line above the bubble point, Vogel's curve below it (composite IPR), applied to total liquid. */
export function inflow(reservoir: Reservoir, fluid: BlackOil, piOverride?: number): Inflow {
  const pi = piOverride ?? productivityIndex(reservoir, fluid), pr = reservoir.pressure;
  const pb = Math.min(pr, bubblePoint(fluid, reservoir.tempF));
  const qb = pi * (pr - pb), vogelMax = pi * pb / 1.8;
  const rate = (pwf: number) => {
    const p = Math.max(0, Math.min(pr, pwf));
    if (p >= pb) return pi * (pr - p);
    const x = pb > 0 ? p / pb : 0;
    return qb + vogelMax * (1 - 0.2 * x - 0.8 * x * x);
  };
  const aof = rate(0);
  const pwf = (q: number) => {
    if (q < 0 || q > aof) return null;
    if (q <= qb) return pr - q / pi;
    // Vogel's quadratic in x = pwf/pb, solved for the root in 0..1.
    const c = (q - qb) / vogelMax - 1, disc = 0.04 - 3.2 * c;
    const x = (-0.2 + Math.sqrt(Math.max(0, disc))) / 1.6;
    return Math.max(0, x * pb);
  };
  return { pi, bubblePoint: pb, aof, rate, pwf };
}

// ── Outflow: Beggs & Brill ────────────────────────────────────────────────────────────────────
export type FlowPattern = "liquid" | "segregated" | "transition" | "intermittent" | "distributed" | "gas";

export interface FlowPoint {
  /** Pressure gradient, psi/ft, and its parts. */
  readonly gradient: number;
  readonly elevation: number;
  readonly friction: number;
  readonly pattern: FlowPattern;
  /** Liquid holdup (fraction of pipe the liquid fills) and no-slip liquid fraction. */
  readonly holdup: number;
  readonly noSlip: number;
  /** Superficial and mixture velocities, ft/s. */
  readonly vsl: number;
  readonly vsg: number;
}

/** Darcy friction factor (Swamee–Jain), laminar below Re 2,000. */
function friction(re: number, relRoughness: number): number {
  if (re < 2000) return 64 / Math.max(re, 1);
  return 0.25 / Math.log10(relRoughness / 3.7 + 5.74 / re ** 0.9) ** 2;
}

/** What flows at one point in the tubing: the phases at that pressure and temperature, and their properties. */
export interface FlowInput {
  readonly p: number; readonly tempF: number; readonly fluid: BlackOil;
  readonly oilRate: number; readonly waterRate: number; readonly liftGasScfD: number;
  readonly idIn: number; readonly angleDeg: number; readonly roughnessIn?: number;
  /** Multipliers a match puts on the correlation's holdup and friction, as PROSPER's VLP matching does; 1 when unmatched. */
  readonly holdupFactor?: number; readonly frictionFactor?: number;
}
export type Correlation = "beggs-brill" | "hagedorn-brown";
export const CORRELATIONS: readonly { readonly id: Correlation; readonly name: string }[] = [
  { id: "beggs-brill", name: "Beggs & Brill" }, { id: "hagedorn-brown", name: "Hagedorn & Brown" },
];

function insitu(input: FlowInput) {
  const { p, tempF, fluid, oilRate, waterRate } = input;
  const d = input.idIn / 12, area = Math.PI / 4 * d * d, theta = input.angleDeg * Math.PI / 180;
  const rs = solutionGor(fluid, p, tempF), bo = oilFvf(fluid, p, tempF);
  const freeGas = Math.max(0, oilRate * (fluid.gor - rs)) + input.liftGasScfD;
  const qo = oilRate * bo * 5.615 / 86400, qw = waterRate * 5.615 / 86400, qg = freeGas * gasFvf(fluid.gasSg, p, tempF) / 86400;
  const vsl = (qo + qw) / area, vsg = qg / area, vm = vsl + vsg;
  const rhoW = 62.37 * fluid.waterSg, rhoG = gasDensity(fluid.gasSg, p, tempF);
  const fo = qo + qw > 0 ? qo / (qo + qw) : 1;
  // Oil properties only where there is oil; water is taken at 0.5 cp.
  const rhoL = (fo > 0 ? oilDensity(fluid, p, tempF) * fo : 0) + rhoW * (1 - fo);
  const muL = (fo > 0 ? oilViscosity(fluid, p, tempF) * fo : 0) + 0.5 * (1 - fo), muG = gasViscosity(fluid.gasSg, p, tempF);
  const sigma = 30 * fo + 60 * (1 - fo);
  const lambda = vm > 0 ? vsl / vm : 1;
  return { d, theta, sinT: Math.sin(theta), rough: (input.roughnessIn ?? 0.0006) / input.idIn, vsl, vsg, vm, rhoL, rhoG, muL, muG, sigma, lambda, hf: input.holdupFactor ?? 1, ff: input.frictionFactor ?? 1 };
}

/** One phase only, at either end: no pattern to pick. */
function singlePhase(f: ReturnType<typeof insitu>): FlowPoint {
  const liquid = f.lambda >= 0.9999, rho = liquid ? f.rhoL : f.rhoG, mu = liquid ? f.muL : f.muG;
  const re = 1488 * rho * f.vm * f.d / mu, fr0 = friction(re, f.rough);
  const elevation = rho * f.sinT / 144, fr = f.ff * fr0 * rho * f.vm * f.vm / (2 * 32.174 * f.d) / 144;
  return { gradient: elevation + fr, elevation, friction: fr, pattern: liquid ? "liquid" : "gas", holdup: liquid ? 1 : 0, noSlip: f.lambda, vsl: f.vsl, vsg: f.vsg };
}

/**
 * The pressure gradient at one point in the tubing (Beggs & Brill with Payne's correction): flow
 * pattern from the Froude number and no-slip liquid fraction, holdup corrected for inclination,
 * friction from the two-phase factor. `angleDeg` is from horizontal (90 = straight up).
 */
export function beggsBrill(input: FlowInput): FlowPoint {
  const f = insitu(input);
  const { d, theta, sinT, rough, vsl, vsg, vm, rhoL, rhoG, muL, muG, sigma, lambda } = f;
  if (lambda >= 0.9999 || lambda <= 1e-4) return singlePhase(f);

  const nfr = vm * vm / (32.174 * d);
  const l1 = 316 * lambda ** 0.302, l2 = 0.0009252 * lambda ** -2.4684, l3 = 0.1 * lambda ** -1.4516, l4 = 0.5 * lambda ** -6.738;
  let pattern: FlowPattern;
  if ((lambda < 0.01 && nfr < l1) || (lambda >= 0.01 && nfr < l2)) pattern = "segregated";
  else if (lambda >= 0.01 && nfr >= l2 && nfr <= l3) pattern = "transition";
  else if ((lambda >= 0.01 && lambda < 0.4 && nfr > l3 && nfr <= l1) || (lambda >= 0.4 && nfr > l3 && nfr <= l4)) pattern = "intermittent";
  else pattern = "distributed";

  const nlv = 1.938 * vsl * (rhoL / sigma) ** 0.25;
  const holdupOf = (kind: "segregated" | "intermittent" | "distributed") => {
    const [a, b, c] = kind === "segregated" ? [0.98, 0.4846, 0.0868] : kind === "intermittent" ? [0.845, 0.5351, 0.0173] : [1.065, 0.5824, 0.0609];
    const h0 = Math.max(lambda, a * lambda ** b / nfr ** c);
    // Inclination: uphill coefficients; distributed flow needs none.
    let C = 0;
    if (kind !== "distributed" && sinT > 0) {
      const [e, g1, g2, h] = kind === "segregated" ? [0.011, -3.768, 3.539, -1.614] : [2.96, 0.305, -0.4473, 0.0978];
      C = Math.max(0, (1 - lambda) * Math.log(e * lambda ** g1 * nlv ** g2 * nfr ** h));
    }
    const s = Math.sin(1.8 * theta), psi = 1 + C * (s - s ** 3 / 3);
    // Payne: Beggs & Brill over-predict holdup uphill.
    return Math.min(1, Math.max(lambda, h0 * psi * (sinT > 0 ? 0.924 : 1)));
  };
  let holdup: number;
  if (pattern === "transition") { const A = (l3 - nfr) / (l3 - l2); holdup = A * holdupOf("segregated") + (1 - A) * holdupOf("intermittent"); }
  else holdup = holdupOf(pattern);
  holdup = Math.min(1, Math.max(lambda, holdup * f.hf));

  const rhoN = rhoL * lambda + rhoG * (1 - lambda), muN = muL * lambda + muG * (1 - lambda);
  const re = 1488 * rhoN * vm * d / muN, fn = friction(re, rough);
  const y = lambda / (holdup * holdup), ly = Math.log(y);
  const S = y > 1 && y < 1.2 ? Math.log(2.2 * y - 1.2) : ly / (-0.0523 + 3.182 * ly - 0.8725 * ly * ly + 0.01853 * ly ** 4);
  const ftp = f.ff * fn * Math.exp(S);
  const rhoS = rhoL * holdup + rhoG * (1 - holdup);
  const elevation = rhoS * sinT / 144, fr = ftp * rhoN * vm * vm / (2 * 32.174 * d) / 144;
  return { gradient: elevation + fr, elevation, friction: fr, pattern, holdup, noSlip: lambda, vsl, vsg };
}

/**
 * The pressure gradient by Hagedorn & Brown (1965), as modified in Brill & Mayhill: holdup from the
 * correlation's three charts (curve fits), Griffith's bubble flow where the gas is too little to slug,
 * and holdup never below the no-slip fraction. Built on vertical wells: the elevation term uses the
 * well's inclination, the holdup does not.
 */
export function hagedornBrown(input: FlowInput): FlowPoint {
  const f = insitu(input);
  const { d, sinT, rough, vsl, vsg, vm, rhoL, rhoG, muL, muG, sigma, lambda } = f;
  if (lambda >= 0.9999 || lambda <= 1e-4) return singlePhase(f);
  let holdup: number, pattern: FlowPattern;
  // Griffith: bubble flow while the gas fraction is under the boundary.
  const lb = Math.max(0.13, 1.071 - 0.2218 * vm * vm / d);
  if (vsg / vm < lb) {
    const vs = 0.8;
    holdup = 1 - 0.5 * (1 + vm / vs - Math.sqrt((1 + vm / vs) ** 2 - 4 * vsg / vs));
    pattern = "distributed";
  } else {
    const k = (rhoL / sigma) ** 0.25;
    const nlv = 1.938 * vsl * k, ngv = 1.938 * vsg * k, nd = 120.872 * d * Math.sqrt(rhoL / sigma), nl = 0.15726 * muL * (1 / (rhoL * sigma ** 3)) ** 0.25;
    const cnl = (0.0019 + 0.0322 * nl - 0.6642 * nl * nl + 4.9951 * nl ** 3) / (1 - 10.0147 * nl + 33.8696 * nl * nl + 277.2817 * nl ** 3);
    const x1 = nlv / ngv ** 0.575 * (input.p / 14.7) ** 0.1 * cnl / nd;
    const hlPsi = Math.sqrt(Math.max(0, (0.0047 + 1123.32 * x1 + 729489.64 * x1 * x1) / (1 + 1097.1566 * x1 + 722153.97 * x1 * x1)));
    const x2 = ngv * nl ** 0.38 / nd ** 2.14;
    const psi = x2 <= 0.01 ? 1 : (1.0886 - 69.9473 * x2 + 2334.3497 * x2 * x2 - 12896.683 * x2 ** 3) / (1 - 53.4401 * x2 + 1517.9369 * x2 * x2 - 8419.8115 * x2 ** 3);
    holdup = hlPsi * psi;
    pattern = "intermittent";
  }
  holdup = Math.min(1, Math.max(lambda, holdup * f.hf));
  const rhoS = rhoL * holdup + rhoG * (1 - holdup), rhoN = rhoL * lambda + rhoG * (1 - lambda);
  const muS = muL ** holdup * muG ** (1 - holdup);
  const re = 1488 * rhoN * vm * d / muS, fr0 = f.ff * friction(re, rough);
  const elevation = rhoS * sinT / 144, fr = fr0 * rhoN * rhoN * vm * vm / (2 * 32.174 * d * rhoS) / 144;
  return { gradient: elevation + fr, elevation, friction: fr, pattern, holdup, noSlip: lambda, vsl, vsg };
}

export const gradientBy: Readonly<Record<Correlation, (input: FlowInput) => FlowPoint>> = { "beggs-brill": beggsBrill, "hagedorn-brown": hagedornBrown };

export interface WellPath {
  /** Stations down the tubing: measured depth and true vertical depth, ft. */
  readonly mdFt: readonly number[];
  readonly tvdFt: readonly number[];
}
export interface Tubing {
  readonly idIn: number;
  /** Down to the producing depth (mid-perforations), ft MD. */
  readonly depthFt: number;
  /** Gas lift injected at this depth, ft MD, at this rate, scf/d; none when null. */
  readonly liftDepthFt: number | null;
  readonly liftGasScfD: number;
}
export interface Traverse {
  /** Pressure at the producing depth, psia; null when the column cannot be carried (flow reversal, pressure ≤ 0). */
  readonly bottomPressure: number | null;
  readonly points: readonly ({ readonly mdFt: number; readonly tvdFt: number; readonly p: number; readonly tempF: number } & FlowPoint)[];
}

const tvdAtMd = (path: WellPath, md: number) => {
  const m = path.mdFt, t = path.tvdFt;
  if (md <= m[0]!) return t[0]! + (md - m[0]!);
  for (let i = 1; i < m.length; i++) if (md <= m[i]!) return t[i - 1]! + (t[i]! - t[i - 1]!) * (md - m[i - 1]!) / (m[i]! - m[i - 1]! || 1);
  return t.at(-1)! + (md - m.at(-1)!) * ((t.at(-1)! - t.at(-2)!) / (m.at(-1)! - m.at(-2)! || 1));
};

/**
 * Walks down the tubing from the wellhead pressure to the producing depth in steps, the gradient
 * taken at each step's middle (predictor–corrector). Temperature at each depth comes from `tempAt`
 * (by TVD); lift gas joins the flow above its injection depth.
 */
export function traverse(input: {
  readonly whp: number; readonly fluid: BlackOil; readonly liquidRate: number; readonly waterCut: number;
  readonly tubing: Tubing; readonly path: WellPath; readonly tempAt: (tvdFt: number) => number; readonly stepFt?: number;
  readonly correlation?: Correlation; readonly holdupFactor?: number; readonly frictionFactor?: number;
  /** Stop at this measured depth instead of the producing depth, ft: e.g. at a downhole gauge. */
  readonly toMdFt?: number;
}): Traverse {
  const { fluid, tubing, path } = input, step = input.stepFt ?? 100;
  const oil = input.liquidRate * (1 - input.waterCut), water = input.liquidRate * input.waterCut;
  const points: Traverse["points"][number][] = [];
  let p = input.whp;
  const at = (md: number, pressure: number) => {
    const tvdA = tvdAtMd(path, Math.max(0, md - 5)), tvdB = tvdAtMd(path, md + 5);
    const angle = Math.asin(Math.max(-1, Math.min(1, (tvdB - tvdA) / 10))) * 180 / Math.PI;
    const tvd = tvdAtMd(path, md), tempF = input.tempAt(tvd);
    const lift = tubing.liftDepthFt !== null && md <= tubing.liftDepthFt ? tubing.liftGasScfD : 0;
    return { tvd, tempF, flow: gradientBy[input.correlation ?? "beggs-brill"]({ p: pressure, tempF, fluid, oilRate: oil, waterRate: water, liftGasScfD: lift, idIn: tubing.idIn, angleDeg: angle, holdupFactor: input.holdupFactor, frictionFactor: input.frictionFactor }) };
  };
  const bottom = Math.min(tubing.depthFt, input.toMdFt ?? tubing.depthFt);
  for (let md = 0; md < bottom;) {
    const ds = Math.min(step, bottom - md);
    const here = at(md, p);
    points.push({ mdFt: md, tvdFt: here.tvd, p, tempF: here.tempF, ...here.flow });
    const mid = at(md + ds / 2, p + here.flow.gradient * ds / 2);
    p += mid.flow.gradient * ds;
    md += ds;
    if (!Number.isFinite(p) || p <= 0) return { bottomPressure: null, points };
  }
  const end = at(bottom, p);
  points.push({ mdFt: bottom, tvdFt: end.tvd, p, tempF: end.tempF, ...end.flow });
  return { bottomPressure: p, points };
}

// ── Nodal ────────────────────────────────────────────────────────────────────────────────────
export interface NodalCurve { readonly rates: Float64Array; readonly pressures: Float64Array }
export interface OperatingPoint { readonly rate: number; readonly pwf: number }

/** The tubing's outflow: bottom-hole pressure the tubing needs for each liquid rate (NaN where it cannot carry it). */
export function outflowCurve(rates: ArrayLike<number>, run: (rate: number) => number | null): NodalCurve {
  const out = new Float64Array(rates.length);
  for (let i = 0; i < rates.length; i++) out[i] = run(rates[i]!) ?? NaN;
  return { rates: Float64Array.from(rates), pressures: out };
}

/**
 * Where inflow meets outflow: the highest rate at which the reservoir's pressure for that rate still
 * reaches what the tubing needs (the stable crossing, right of the outflow curve's minimum). Null
 * when the curves never meet: the well does not flow naturally at these conditions.
 */
export function operatingPoint(ipr: Inflow, vlp: NodalCurve): OperatingPoint | null {
  let found: OperatingPoint | null = null;
  for (let i = 1; i < vlp.rates.length; i++) {
    const q0 = vlp.rates[i - 1]!, q1 = vlp.rates[i]!, v0 = vlp.pressures[i - 1]!, v1 = vlp.pressures[i]!;
    const i0 = ipr.pwf(q0), i1 = ipr.pwf(q1);
    if (i0 === null || i1 === null || !Number.isFinite(v0) || !Number.isFinite(v1)) continue;
    const d0 = i0 - v0, d1 = i1 - v1;
    if (d0 >= 0 && d1 < 0) {
      const t = d0 / (d0 - d1), rate = q0 + (q1 - q0) * t;
      found = { rate, pwf: v0 + (v1 - v0) * t };
    }
  }
  return found;
}

/** Rates to draw the curves on: from a trickle to the open flow. */
export const rateGrid = (aof: number, count = 40) => Float64Array.from({ length: count }, (_, i) => Math.max(1, aof * (i + 0.5) / count));

// ── Calibration: matching the model to what the well did ─────────────────────────────────────
/**
 * One well test, as a test separator and the well's gauges report it. Pressures psia, rates at
 * stock-tank conditions. The gauge reading and the reservoir pressure (from a build-up) are
 * optional: most tests have the first, few the second.
 */
export interface WellTest {
  readonly date: string;
  readonly liquidRate: number;
  readonly waterCut: number;
  /** Producing gas–oil ratio, scf/STB (formation gas only, lift gas excluded). */
  readonly gor: number;
  readonly whp: number;
  readonly liftGasScfD: number;
  readonly gaugeMdFt: number | null;
  readonly gaugePressure: number | null;
  readonly reservoirPressure: number | null;
}

/** The well as the calibration sees it: everything but the tests and the tuning. */
export interface WellModel {
  readonly fluid: BlackOil;
  readonly path: WellPath;
  readonly tempAt: (tvdFt: number) => number;
  readonly tubing: Tubing;
  /** Reservoir pressure before production, psia: used where no build-up says otherwise. */
  readonly initialPressure: number;
  readonly reservoirTempF: number;
}

/** A lab PVT report at reservoir temperature: what the correlations are matched to. Oil and gas gravity, where the report gives them, replace the assumed ones. */
export interface LabPvt { readonly bubblePoint: number; readonly rsb: number; readonly boAtPb: number; readonly muAtPb: number; readonly api?: number; readonly gasSg?: number }

/** The factors that put the correlations on the lab's bubble point, Bo and viscosity, how far off they were, and the matched fluid. */
export function matchPvt(fluid: BlackOil, lab: LabPvt, tempF: number) {
  const plain: BlackOil = { ...fluid, api: lab.api ?? fluid.api, gasSg: lab.gasSg ?? fluid.gasSg, gor: lab.rsb, tuning: undefined };
  const pb = bubblePoint(plain, tempF), bo = oilFvf(plain, pb, tempF), mu = oilViscosity(plain, pb, tempF);
  const tuning: PvtTuning = { pbFactor: lab.bubblePoint / pb, boFactor: lab.boAtPb / bo, muFactor: lab.muAtPb / mu };
  return { tuning, fluid: { ...plain, tuning } as BlackOil, correlation: { bubblePoint: pb, boAtPb: bo, muAtPb: mu }, lab };
}

export interface FlowTuning { readonly correlation: Correlation; readonly holdupFactor: number; readonly frictionFactor: number }

const testFluid = (model: WellModel, test: WellTest): BlackOil => ({ ...model.fluid, gor: test.gor });
const testRun = (model: WellModel, test: WellTest, flow: FlowTuning, toMdFt?: number, stepFt = 200) => traverse({
  whp: test.whp, fluid: testFluid(model, test), liquidRate: test.liquidRate, waterCut: test.waterCut,
  tubing: { ...model.tubing, liftGasScfD: test.liftGasScfD }, path: model.path, tempAt: model.tempAt, stepFt,
  correlation: flow.correlation, holdupFactor: flow.holdupFactor, frictionFactor: flow.frictionFactor, toMdFt,
});

/** The model's gauge pressure for each test with a gauge reading, against the reading: residuals (model − measured), mean absolute error and bias, psi. */
export function gaugeFit(model: WellModel, tests: readonly WellTest[], flow: FlowTuning) {
  const rows = tests.filter((test) => test.gaugeMdFt !== null && test.gaugePressure !== null).map((test) => {
    const at = testRun(model, test, flow, test.gaugeMdFt!).bottomPressure;
    return { test, model: at, residual: at === null ? null : at - test.gaugePressure! };
  });
  const ok = rows.filter((row) => row.residual !== null).map((row) => row.residual!);
  const mae = ok.length ? ok.reduce((s, r) => s + Math.abs(r), 0) / ok.length : NaN;
  const bias = ok.length ? ok.reduce((s, r) => s + r, 0) / ok.length : NaN;
  return { rows, mae: ok.length === rows.length ? mae : Infinity, bias };
}

/** Every correlation, untuned, against the gauges: smallest error first. */
export const rankCorrelations = (model: WellModel, tests: readonly WellTest[]) =>
  CORRELATIONS.map((c) => ({ ...c, ...gaugeFit(model, tests, { correlation: c.id, holdupFactor: 1, frictionFactor: 1 }) })).sort((a, b) => a.mae - b.mae);

/**
 * Tunes the chosen correlation's holdup and friction multipliers to the gauges (coordinate descent,
 * golden-section in each, holdup 0.5–1.6, friction 0.3–3): the "VLP match" step of PROSPER and
 * Pipesim. Multipliers far from 1 say the correlation, or the data, is wrong for this well.
 */
export function tuneFlow(model: WellModel, tests: readonly WellTest[], correlation: Correlation): FlowTuning & { readonly mae: number; readonly bias: number } {
  let hf = 1, ff = 1;
  const cost = (h: number, f: number) => gaugeFit(model, tests, { correlation, holdupFactor: h, frictionFactor: f }).mae;
  const golden = (lo: number, hi: number, at: (x: number) => number) => {
    const g = (Math.sqrt(5) - 1) / 2;
    let a = lo, b = hi, c = b - g * (b - a), d = a + g * (b - a), fc = at(c), fd = at(d);
    for (let i = 0; i < 14; i++) {
      if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = at(c); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = at(d); }
    }
    return (a + b) / 2;
  };
  for (let round = 0; round < 3; round++) {
    hf = golden(0.5, 1.6, (h) => cost(h, ff));
    ff = golden(0.3, 3, (f) => cost(hf, f));
  }
  const fit = gaugeFit(model, tests, { correlation, holdupFactor: hf, frictionFactor: ff });
  return { correlation, holdupFactor: hf, frictionFactor: ff, mae: fit.mae, bias: fit.bias };
}

/**
 * The tubing match: every correlation tuned to the gauges, the best one chosen by its tuned error
 * (within 2 psi, the one whose factors stay nearest 1). Ranking untuned correlations is not enough:
 * a correlation can fit better untuned and still not take the well's shape when tuned.
 */
export function calibrateFlow(model: WellModel, tests: readonly WellTest[]) {
  const all = CORRELATIONS.map((c) => {
    const plain = gaugeFit(model, tests, { correlation: c.id, holdupFactor: 1, frictionFactor: 1 });
    return { ...c, untunedMae: plain.mae, untunedBias: plain.bias, ...tuneFlow(model, tests, c.id) };
  });
  const distance = (t: { holdupFactor: number; frictionFactor: number }) => Math.abs(Math.log(t.holdupFactor)) + Math.abs(Math.log(t.frictionFactor));
  const best = [...all].sort((a, b) => Math.abs(a.mae - b.mae) <= 2 ? distance(a) - distance(b) : a.mae - b.mae)[0]!;
  return { all, best };
}

/** Reservoir pressure at a date: the build-ups' readings, straight between them; before the first, the initial pressure; after the last, the trend of the last two carried on. */
export function pressureAtDate(model: WellModel, tests: readonly WellTest[], date: string): { readonly pressure: number; readonly measured: boolean } {
  const t = Date.parse(date), points = tests.filter((test) => test.reservoirPressure !== null).map((test) => ({ t: Date.parse(test.date), p: test.reservoirPressure! })).sort((a, b) => a.t - b.t);
  const exact = points.find((point) => point.t === t);
  if (exact) return { pressure: exact.p, measured: true };
  const all = [{ t: Math.min(t, ...points.map((point) => point.t)) - 1, p: model.initialPressure }, ...points];
  for (let i = 1; i < all.length; i++) if (t <= all[i]!.t) { const a = all[i - 1]!, b = all[i]!; return { pressure: a.p + (b.p - a.p) * (t - a.t) / (b.t - a.t || 1), measured: false }; }
  const a = all.at(-2)!, b = all.at(-1)!;
  return { pressure: b.p + (b.p - a.p) * (t - b.t) / (b.t - a.t || 1), measured: false };
}

/**
 * What each test says of the inflow: the flowing pressure at the perforations (the gauge, carried
 * down the tuned tubing model; or the whole tubing from the wellhead without a gauge), the reservoir
 * pressure then, and the productivity index that joins them (Vogel below the bubble point).
 */
export function inflowByTest(model: WellModel, tests: readonly WellTest[], flow: FlowTuning) {
  return tests.map((test) => {
    const fluid = testFluid(model, test);
    const whole = testRun(model, test, flow).bottomPressure;
    let pwf = whole;
    if (whole !== null && test.gaugeMdFt !== null && test.gaugePressure !== null) {
      const atGauge = testRun(model, test, flow, test.gaugeMdFt).bottomPressure;
      if (atGauge !== null) pwf = test.gaugePressure + (whole - atGauge);
    }
    const { pressure, measured } = pressureAtDate(model, tests, test.date);
    const pb = Math.min(pressure, bubblePoint(fluid, model.reservoirTempF));
    let pi: number | null = null;
    if (pwf !== null && pwf < pressure) {
      // Invert the composite IPR: q = J(Pr − pb) + J pb/1.8 (1 − 0.2x − 0.8x²) below pb, q = J(Pr − pwf) above.
      const shape = pwf >= pb ? pressure - pwf : (pressure - pb) + pb / 1.8 * (1 - 0.2 * (pwf / pb) - 0.8 * (pwf / pb) ** 2);
      pi = test.liquidRate / shape;
    }
    return { test, pwf, reservoirPressure: pressure, pressureMeasured: measured, pi };
  });
}

/** The skin a productivity index implies for a permeability (they cannot be told apart from rate alone: say which k it assumes). */
export function skinFromPi(pi: number, reservoir: Omit<Reservoir, "skin">, fluid: BlackOil): number {
  const p = reservoir.pressure, t = reservoir.tempF;
  return 0.00708 * reservoir.permeabilityMd * reservoir.netPayFt / (pi * oilViscosity(fluid, p, t) * oilFvf(fluid, p, t)) - Math.log(reservoir.drainageRadiusFt / reservoir.wellboreRadiusFt) + 0.75;
}

// ── Synthetic tests: a known well to calibrate against ───────────────────────────────────────
/** A small, seeded random number generator (mulberry32) and a normal draw from it. */
function seeded(seed: number) {
  let t = seed >>> 0;
  const next = () => { t = (t + 0x6d2b79f5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  return { next, normal: () => Math.sqrt(-2 * Math.log(Math.max(1e-12, next()))) * Math.cos(2 * Math.PI * next()) };
}

export interface TestPlan { readonly date: string; readonly whp: number; readonly waterCut: number; readonly gor: number; readonly liftGasScfD: number; readonly buildUp: boolean }

/**
 * Well tests a known ("true") well would give: at each planned date, the reservoir as it then was,
 * the operating point of the true inflow and tubing, the gauge reading at that rate, a build-up
 * pressure where planned, each with seeded measurement noise (gauge ±`gaugeNoisePsi`, rate
 * ±`rateNoise`). For checking that a calibration finds the truth, and for showing one: label it
 * synthetic wherever it is shown. A test the true well cannot flow is left out.
 */
export function syntheticWellTests(truth: {
  readonly model: WellModel; readonly flow: FlowTuning; readonly reservoirAt: (date: string) => Reservoir;
  readonly plan: readonly TestPlan[]; readonly gaugeMdFt: number; readonly gaugeNoisePsi?: number; readonly rateNoise?: number; readonly seed?: number;
}): WellTest[] {
  const random = seeded(truth.seed ?? 7);
  return truth.plan.flatMap((plan) => {
    const reservoir = truth.reservoirAt(plan.date), fluid: BlackOil = { ...truth.model.fluid, gor: plan.gor };
    const ipr = inflow(reservoir, fluid);
    const run = (q: number, toMdFt?: number) => traverse({ whp: plan.whp, fluid, liquidRate: q, waterCut: plan.waterCut, tubing: { ...truth.model.tubing, liftGasScfD: plan.liftGasScfD }, path: truth.model.path, tempAt: truth.model.tempAt, stepFt: 150, correlation: truth.flow.correlation, holdupFactor: truth.flow.holdupFactor, frictionFactor: truth.flow.frictionFactor, toMdFt });
    const point = operatingPoint(ipr, outflowCurve(rateGrid(ipr.aof, 48), (q) => run(q).bottomPressure));
    if (!point) return [];
    const gauge = run(point.rate, truth.gaugeMdFt).bottomPressure;
    return [{
      date: plan.date, liquidRate: Math.round(point.rate * (1 + (truth.rateNoise ?? 0.02) * random.normal())), waterCut: plan.waterCut, gor: plan.gor, whp: plan.whp, liftGasScfD: plan.liftGasScfD,
      gaugeMdFt: truth.gaugeMdFt, gaugePressure: gauge === null ? null : Math.round(gauge + (truth.gaugeNoisePsi ?? 10) * random.normal()),
      reservoirPressure: plan.buildUp ? Math.round(reservoir.pressure + 15 * random.normal()) : null,
    }];
  });
}

// ── Gas-lift design (continuous flow, injection-pressure-operated valves) ──────────────────────
/**
 * Injection gas pressure down the annulus: the surface pressure plus the weight of the static gas
 * column, integrated in steps with Z at each (psia, at a TVD in ft).
 */
export function casingPressureAt(surfacePsia: number, gasSg: number, tvdFt: number, tempAt: (tvdFt: number) => number, stepFt = 200): number {
  let p = surfacePsia;
  for (let d = 0; d < tvdFt;) {
    const ds = Math.min(stepFt, tvdFt - d), mid = d + ds / 2;
    p += gasDensity(gasSg, p, tempAt(mid)) / 144 * ds;
    d += ds;
  }
  return p;
}

export interface GasLiftInput {
  readonly model: WellModel;
  /** The reservoir's inflow: the matched one where the well has been matched. */
  readonly ipr: Inflow;
  readonly flow?: FlowTuning;
  readonly waterCut: number;
  readonly gor: number;
  /** Flowing wellhead pressure in production, and while unloading (to the flowline), psia. */
  readonly whp: number;
  readonly unloadingWhp: number;
  readonly liftGasSg: number;
  /** Surface injection pressures, psia: kickoff (available at the start) and operating. */
  readonly kickoffPsia: number;
  readonly operatingPsia: number;
  /** Gas the compressor can give this well, scf/d. */
  readonly availableScfD: number;
  /** Casing over tubing pressure kept at the operating valve, psi (API practice: about 100). */
  readonly valveDifferentialPsi?: number;
  /** Surface operating pressure dropped at each deeper unloading valve so those above close, psi (20–25). */
  readonly perValveDropPsi?: number;
  /** Load (completion) fluid gradient the well is unloaded from, psi/ft (brine about 0.465). */
  readonly loadGradientPsiFt?: number;
  /** Closest two valves may sit, ft MD. */
  readonly minSpacingFt?: number;
  /** Deepest a valve may sit: just above the packer, ft MD. */
  readonly deepestMdFt: number;
  /** Port to bellows area ratio of the valves (1.5 in valve, ¼ in port: 0.067). */
  readonly portRatio?: number;
}

/** The operating point with lift gas injected at one depth, and the flowing tubing pressure there. */
export function liftedPoint(input: GasLiftInput, injectionMdFt: number, gasScfD: number, rates?: Float64Array) {
  const fluid: BlackOil = { ...input.model.fluid, gor: input.gor };
  const tubing = { ...input.model.tubing, liftDepthFt: injectionMdFt, liftGasScfD: gasScfD };
  const run = (q: number, toMdFt?: number) => traverse({ whp: input.whp, fluid, liquidRate: q, waterCut: input.waterCut, tubing, path: input.model.path, tempAt: input.model.tempAt, stepFt: 200, toMdFt, ...input.flow });
  const point = operatingPoint(input.ipr, outflowCurve(rates ?? rateGrid(input.ipr.aof, 24), (q) => run(q).bottomPressure));
  const tubingAt = point ? run(point.rate, injectionMdFt).bottomPressure : null;
  return { point, tubingAt, run };
}

export interface LiftValve {
  readonly role: "unloading" | "operating";
  readonly mdFt: number;
  readonly tvdFt: number;
  readonly tempF: number;
  /** Casing (opening) and design tubing pressure at the valve, psia. */
  readonly casingPsia: number;
  readonly tubingPsia: number;
  /** Surface injection pressure the valve is set to open at, psig. */
  readonly surfaceOpeningPsig: number;
  /** Test-rack opening pressure at 60 °F, psig: what the valve shop sets the bellows to (unloading valves). */
  readonly ptroPsig: number | null;
}

/**
 * A continuous-flow gas-lift design, as API RP 11V6 and the textbooks lay it out:
 * 1. the deepest injection point the operating injection pressure can reach at the available gas,
 *    keeping the valve differential over the flowing tubing pressure (and above the packer);
 * 2. unloading valves from the top: the first where the load fluid from the unloading wellhead
 *    pressure balances the kickoff pressure at depth, each next where the load fluid below the one
 *    above (from the design tubing line) balances the casing pressure, the surface pressure dropped
 *    at each so the valves above close; down to the operating valve, no two closer than the minimum;
 * 3. each valve's test-rack opening pressure (nitrogen dome, temperature-corrected to 60 °F).
 */
export function gasLiftDesign(input: GasLiftInput) {
  const dv = input.valveDifferentialPsi ?? 100, drop = input.perValveDropPsi ?? 20, gs = input.loadGradientPsiFt ?? 0.465;
  const minSpacing = input.minSpacingFt ?? 300, R = input.portRatio ?? 0.067, path = input.model.path, tempAt = input.model.tempAt;
  const tvdOf = (md: number) => { const m = path.mdFt, t = path.tvdFt; for (let i = 1; i < m.length; i++) if (md <= m[i]!) return t[i - 1]! + (t[i]! - t[i - 1]!) * (md - m[i - 1]!) / (m[i]! - m[i - 1]! || 1); return t.at(-1)! + (md - m.at(-1)!); };
  const casing = (surface: number, md: number) => casingPressureAt(surface, input.liftGasSg, tvdOf(md), tempAt);

  // 1. Deepest injection point: from just above the packer upward, the first depth whose casing pressure clears the tubing by the differential.
  let operating: { mdFt: number; point: OperatingPoint; tubingAt: number; casingAt: number } | null = null;
  for (let md = input.deepestMdFt; md >= 500; md -= 250) {
    const lifted = liftedPoint(input, md, input.availableScfD);
    if (!lifted.point || lifted.tubingAt === null) continue;
    const pc = casing(input.operatingPsia, md);
    if (pc - dv >= lifted.tubingAt) { operating = { mdFt: md, point: lifted.point, tubingAt: lifted.tubingAt, casingAt: pc }; break; }
  }
  if (!operating) return { operating: null, valves: [] as LiftValve[], reason: "The operating injection pressure cannot reach the tubing at any depth with the gas available: more pressure or less wellhead pressure is needed." };

  // The design tubing line: from the wellhead (raised by a fifth of the casing–wellhead difference, the usual allowance) to the flowing tubing pressure at the operating valve.
  const top = input.whp + 0.2 * (input.operatingPsia - input.whp), opTvd = tvdOf(operating.mdFt);
  const designTubing = (md: number) => top + (operating!.tubingAt - top) * Math.min(1, tvdOf(md) / opTvd);

  // 2. Unloading valves.
  const balance = (fromMd: number, fromPsia: number, surfaceCasing: number) => {
    // Deepest depth where the load column from `fromPsia` at `fromMd` still sits under the casing pressure (less the differential).
    let lo = fromMd, hi = operating!.mdFt;
    const ok = (md: number) => fromPsia + gs * (tvdOf(md) - tvdOf(fromMd)) <= casing(surfaceCasing, md) - (fromMd === 0 ? 0 : dv / 2);
    if (ok(hi)) return hi;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
    return lo;
  };
  // Depths first, with the surface pressure falling a step per valve from the operating pressure (the conservative side:
  // the valves end up a little shallower than the pressures they are later set to would allow).
  const depths: number[] = [];
  let md = balance(0, input.unloadingWhp, input.kickoffPsia);
  while (md < operating.mdFt - minSpacing && depths.length < 20) {
    depths.push(md);
    const next = balance(md, designTubing(md), input.operatingPsia - drop * depths.length);
    if (next - md < minSpacing) break;
    md = next;
  }
  // Then the settings: the operating valve opens at the operating pressure, each unloading valve above it a step higher
  // (never above the kickoff pressure), so as the casing pressure falls they close from the top down.
  const valves: LiftValve[] = depths.map((at, i) => {
    const surface = Math.min(input.kickoffPsia, input.operatingPsia + drop * (depths.length - i));
    const tvd = tvdOf(at), t = tempAt(tvd), pc = casing(surface, at), pt = designTubing(at);
    // Nitrogen-charged bellows: dome pressure at valve temperature, then corrected to 60 °F for the test rack.
    const dome = pc * (1 - R) + pt * R, ct = 1 / (1 + 0.00215 * (t - 60));
    return { role: "unloading", mdFt: at, tvdFt: tvd, tempF: t, casingPsia: pc, tubingPsia: pt, surfaceOpeningPsig: surface - 14.7, ptroPsig: dome * ct / (1 - R) - 14.7 };
  });
  const opT = tempAt(opTvd);
  valves.push({ role: "operating", mdFt: operating.mdFt, tvdFt: opTvd, tempF: opT, casingPsia: operating.casingAt, tubingPsia: operating.tubingAt, surfaceOpeningPsig: input.operatingPsia - 14.7, ptroPsig: null });
  return { operating, valves, reason: null };
}

/**
 * The gas-lift performance curve at one injection depth: oil and liquid rate for each lift gas rate.
 * Its slope (extra oil per extra Mscf) falls as gas rises and reaches zero at the technical maximum;
 * past it more gas loses oil to friction.
 */
export function liftPerformance(input: GasLiftInput, injectionMdFt: number, gasRates: readonly number[]) {
  return gasRates.map((gas) => {
    const lifted = liftedPoint(input, injectionMdFt, gas);
    const liquid = lifted.point?.rate ?? 0;
    return { gasScfD: gas, liquid, oil: liquid * (1 - input.waterCut) };
  });
}

/**
 * Where to run the lift gas: the technical maximum (most oil), and the economic optimum, the rate
 * at which one more Mscf of gas brings in oil worth no more than it costs (slope = gas cost / oil
 * netback), capped by the gas available. Prices in any one currency: per bbl of oil, per Mscf of gas.
 */
export function liftOptimum(curve: readonly { readonly gasScfD: number; readonly oil: number }[], oilNetback: number, gasCostPerMscf: number, availableScfD: number) {
  const pts = [...curve].sort((a, b) => a.gasScfD - b.gasScfD);
  const max = pts.reduce((best, p) => p.oil > best.oil ? p : best, pts[0]!);
  const value = (p: { gasScfD: number; oil: number }) => p.oil * oilNetback - p.gasScfD / 1000 * gasCostPerMscf;
  // On the curve read between its points, the best daily margin within the gas available.
  let best = pts[0]!, bestValue = value(best);
  for (let i = 1; i < pts.length; i++) for (let k = 0; k <= 20; k++) {
    const a = pts[i - 1]!, b = pts[i]!, f = k / 20, p = { gasScfD: a.gasScfD + (b.gasScfD - a.gasScfD) * f, oil: a.oil + (b.oil - a.oil) * f };
    if (p.gasScfD > availableScfD) continue;
    const v = value(p);
    if (v > bestValue) { bestValue = v; best = p; }
  }
  return { maximum: max, economic: best, marginPerDay: bestValue, breakEvenSlope: gasCostPerMscf / oilNetback };
}
