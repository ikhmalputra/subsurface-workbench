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
 * point), the oil's swelling (Bo − 1) and its viscosity multiplied.
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

/**
 * Oil formation volume factor, rb/STB: Standing when saturated (a match factor scales its swelling,
 * Bo − 1, so stock-tank oil stays at 1), and above the bubble point Vasquez–Beggs' compressibility
 * co = A/p integrated: Bo = Bob (pb/p)^A. A is floored where the correlation, outside its range
 * (very low GOR, cool oil), would turn negative and make the oil swell under pressure.
 */
export function oilFvf(fluid: BlackOil, p: number, tempF: number): number {
  const pb = bubblePoint(fluid, tempF), rs = solutionGor(fluid, Math.min(p, pb), tempF);
  const saturated = (r: number) => 1 + tuned(fluid).boFactor * (0.9759 + 0.00012 * (r * Math.sqrt(fluid.gasSg / oilSg(fluid.api)) + 1.25 * tempF) ** 1.2 - 1);
  if (p <= pb) return saturated(rs);
  return saturated(fluid.gor) * (pb / p) ** undersaturatedA(fluid, tempF);
}
/** Vasquez–Beggs' A: the undersaturated oil compressibility is A/p (1/psi); floored at 1×10⁻⁶ /psi at 3,000 psia. */
const undersaturatedA = (fluid: BlackOil, tempF: number) => Math.max(0.003, (-1433 + 5 * fluid.gor + 17.2 * tempF - 1180 * fluid.gasSg + 12.61 * fluid.api) * 1e-5);

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
  return zReduced(p / ppc, rankine(tempF) / tpc);
}

/** Z at a reduced pressure and temperature (Dranchuk–Abou-Kassem). */
function zReduced(pr: number, tr: number): number {
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

/**
 * The well's inflow of total liquid: a straight line above the bubble point; below it the Petrobras
 * composite, Vogel's curve on the oil fraction and a straight line on the water. The productivity
 * index is a liquid one: measured from tests, or Darcy's on oil properties when assumed.
 */
export function inflow(reservoir: Reservoir, fluid: BlackOil, piOverride?: number, waterCut = 0): Inflow {
  const pi = piOverride ?? productivityIndex(reservoir, fluid), pr = reservoir.pressure;
  const pb = Math.min(pr, bubblePoint(fluid, reservoir.tempF)), fw = Math.max(0, Math.min(1, waterCut));
  const rate = (pwf: number) => pi * compositeShape(pr, pb, Math.max(0, Math.min(pr, pwf)), fw);
  const aof = rate(0);
  const pwf = (q: number) => {
    if (q < 0 || q > aof) return null;
    const qb = pi * (pr - pb);
    if (q <= qb) return pr - q / pi;
    // Below the bubble point the composite is monotone in pwf: bisect.
    let lo = 0, hi = pb;
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (rate(mid) > q) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };
  return { pi, bubblePoint: pb, aof, rate, pwf };
}

/**
 * The composite inflow per unit productivity index (Petrobras): straight above the bubble point;
 * below it, the oil fraction follows Vogel (free gas cuts its mobility) and the water a straight line.
 */
export function compositeShape(pr: number, pb: number, pwf: number, waterCut: number): number {
  if (pwf >= pb) return pr - pwf;
  const x = pb > 0 ? pwf / pb : 0;
  return (pr - pb) + (1 - waterCut) * pb / 1.8 * (1 - 0.2 * x - 0.8 * x * x) + waterCut * (pb - pwf);
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

/**
 * Near single-phase gas (no-slip liquid under 1%) both correlations leave their data: Hagedorn &
 * Brown's chart never reads below 0.07 holdup. The holdup is eased onto the no-slip value on a log
 * scale between 1% and 0.01% liquid, so the gradient meets the gas-only one without a jump.
 */
const toGas = (holdup: number, lambda: number) => lambda >= 0.01 ? holdup : lambda + (holdup - lambda) * Math.max(0, Math.log(lambda / 1e-4) / Math.log(100));
/** Kinetic energy term (Beggs & Brill's Ek): the gradient over (1 − Ek). Matters near the top of gas-lifted wells. */
const accelerated = (gradient: number, rhoS: number, vm: number, vsg: number, p: number) => gradient / (1 - Math.min(0.9, rhoS * vm * vsg / (32.174 * p * 144)));

/** One phase only, at either end: no pattern to pick. */
function singlePhase(f: ReturnType<typeof insitu>): FlowPoint {
  const liquid = f.lambda >= 0.9999, rho = liquid ? f.rhoL : f.rhoG, mu = liquid ? f.muL : f.muG;
  const re = 1488 * rho * f.vm * f.d / mu, fr0 = friction(re, f.rough);
  const elevation = rho * f.sinT / 144, fr = f.ff * fr0 * rho * f.vm * f.vm / (2 * 32.174 * f.d) / 144;
  return { gradient: elevation + fr, elevation, friction: fr, pattern: liquid ? "liquid" : "gas", holdup: liquid ? 1 : 0, noSlip: f.lambda, vsl: f.vsl, vsg: f.vsg };
}

/**
 * The pressure gradient at one point in the tubing (Beggs & Brill with Payne's correction): flow
 * pattern from the Froude number and no-slip liquid fraction, holdup corrected for inclination (up
 * and down), friction from the two-phase factor, and the kinetic term. `angleDeg` is from horizontal
 * (90 = straight up).
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
    // Inclination: uphill coefficients (none for distributed flow); downhill, one set for every pattern.
    let C = 0;
    if (sinT > 0 && kind !== "distributed") {
      const [e, g1, g2, h] = kind === "segregated" ? [0.011, -3.768, 3.539, -1.614] : [2.96, 0.305, -0.4473, 0.0978];
      C = Math.max(0, (1 - lambda) * Math.log(e * lambda ** g1 * nlv ** g2 * nfr ** h));
    } else if (sinT < 0) C = Math.max(0, (1 - lambda) * Math.log(4.7 * lambda ** -0.3692 * nlv ** 0.1244 * nfr ** -0.5056));
    const s = Math.sin(1.8 * theta), psi = 1 + C * (s - s ** 3 / 3);
    // Payne: Beggs & Brill over-predict holdup, 0.924 uphill and 0.685 downhill.
    const h = h0 * psi * (sinT > 0 ? 0.924 : sinT < 0 ? 0.685 : 1);
    // Uphill the gas cannot lag the liquid, so holdup stays at or above no-slip (Payne's factor can
    // take it under, which the published order allows); downhill the liquid runs ahead and may fall below.
    return Math.min(1, sinT > 0 ? Math.max(lambda, h) : Math.max(1e-4, h));
  };
  let holdup: number;
  if (pattern === "transition") { const A = (l3 - nfr) / (l3 - l2); holdup = A * holdupOf("segregated") + (1 - A) * holdupOf("intermittent"); }
  else holdup = holdupOf(pattern);
  holdup = toGas(Math.min(1, Math.max(sinT > 0 ? lambda : 1e-4, holdup * f.hf)), lambda);

  const rhoN = rhoL * lambda + rhoG * (1 - lambda), muN = muL * lambda + muG * (1 - lambda);
  const re = 1488 * rhoN * vm * d / muN, fn = friction(re, rough);
  const y = lambda / (holdup * holdup), ly = Math.log(y);
  const S = y > 1 && y < 1.2 ? Math.log(2.2 * y - 1.2) : ly / (-0.0523 + 3.182 * ly - 0.8725 * ly * ly + 0.01853 * ly ** 4);
  const ftp = f.ff * fn * Math.exp(S);
  const rhoS = rhoL * holdup + rhoG * (1 - holdup);
  const elevation = rhoS * sinT / 144, fr = ftp * rhoN * vm * vm / (2 * 32.174 * d) / 144;
  return { gradient: accelerated(elevation + fr, rhoS, vm, vsg, input.p), elevation, friction: fr, pattern, holdup, noSlip: lambda, vsl, vsg };
}

/**
 * The pressure gradient by Hagedorn & Brown (1965), as modified in Brill & Mayhill: holdup from the
 * correlation's three charts (curve fits), Griffith's bubble flow where the gas is too little to slug
 * (friction then on the liquid), holdup never below the no-slip fraction, and the kinetic term. Built on vertical wells: the elevation term uses the
 * well's inclination, the holdup does not.
 */
export function hagedornBrown(input: FlowInput): FlowPoint {
  const f = insitu(input);
  const { d, sinT, rough, vsl, vsg, vm, rhoL, rhoG, muL, muG, sigma, lambda } = f;
  if (lambda >= 0.9999 || lambda <= 1e-4) return singlePhase(f);
  let holdup: number, pattern: FlowPattern;
  // Griffith: bubble flow while the gas fraction is under the boundary.
  const lb = Math.max(0.13, 1.071 - 0.2218 * vm * vm / d);
  const bubble = vsg / vm < lb;
  if (bubble) {
    const vs = 0.8;
    holdup = 1 - 0.5 * (1 + vm / vs - Math.sqrt((1 + vm / vs) ** 2 - 4 * vsg / vs));
    pattern = "distributed";
  } else {
    const k = (rhoL / sigma) ** 0.25;
    const nlv = 1.938 * vsl * k, ngv = 1.938 * vsg * k, nd = 120.872 * d * Math.sqrt(rhoL / sigma), nl = 0.15726 * muL * (1 / (rhoL * sigma ** 3)) ** 0.25;
    const cnl = (0.0019 + 0.0322 * nl - 0.6642 * nl * nl + 4.9951 * nl ** 3) / (1 - 10.0147 * nl + 33.8696 * nl * nl + 277.2817 * nl ** 3);
    const x1 = nlv / ngv ** 0.575 * (input.p / 14.7) ** 0.1 * cnl / nd;
    const hlPsi = Math.sqrt(Math.max(0, (0.0047 + 1123.32 * x1 + 729489.64 * x1 * x1) / (1 + 1097.1566 * x1 + 722153.97 * x1 * x1)));
    // The secondary chart ends at 0.09; the fit has a pole just past it.
    const x2 = Math.min(0.09, ngv * nl ** 0.38 / nd ** 2.14);
    const psi = x2 <= 0.01 ? 1 : (1.0886 - 69.9473 * x2 + 2334.3497 * x2 * x2 - 12896.683 * x2 ** 3) / (1 - 53.4401 * x2 + 1517.9369 * x2 * x2 - 8419.8115 * x2 ** 3);
    holdup = hlPsi * psi;
    pattern = "intermittent";
  }
  holdup = toGas(Math.min(1, Math.max(lambda, holdup * f.hf)), lambda);
  const rhoS = rhoL * holdup + rhoG * (1 - holdup), rhoN = rhoL * lambda + rhoG * (1 - lambda);
  let fr: number;
  if (bubble) {
    // Griffith bubble flow: friction on the liquid at its in-situ velocity.
    const vL = vsl / holdup, re = 1488 * rhoL * vL * d / muL;
    fr = f.ff * friction(re, rough) * rhoL * vL * vL / (2 * 32.174 * d) / 144;
  } else {
    const muS = muL ** holdup * muG ** (1 - holdup), re = 1488 * rhoN * vm * d / muS;
    fr = f.ff * friction(re, rough) * rhoN * rhoN * vm * vm / (2 * 32.174 * d * rhoS) / 144;
  }
  const elevation = rhoS * sinT / 144;
  return { gradient: accelerated(elevation + fr, rhoS, vm, vsg, input.p), elevation, friction: fr, pattern, holdup, noSlip: lambda, vsl, vsg };
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
  /** Pressure at the producing depth, psia; null when the pressure leaves 0–20,000 psia (the tubing cannot carry the rate). */
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
    const mdA = Math.max(0, md - 5), mdB = md + 5, tvdA = tvdAtMd(path, mdA), tvdB = tvdAtMd(path, mdB);
    const angle = Math.asin(Math.max(-1, Math.min(1, (tvdB - tvdA) / (mdB - mdA)))) * 180 / Math.PI;
    const tvd = tvdAtMd(path, md), tempF = input.tempAt(tvd);
    const lift = tubing.liftDepthFt !== null && md <= tubing.liftDepthFt ? tubing.liftGasScfD : 0;
    return { tvd, tempF, flow: gradientBy[input.correlation ?? "beggs-brill"]({ p: pressure, tempF, fluid, oilRate: oil, waterRate: water, liftGasScfD: lift, idIn: tubing.idIn, angleDeg: angle, holdupFactor: input.holdupFactor, frictionFactor: input.frictionFactor }) };
  };
  const bottom = Math.min(tubing.depthFt, input.toMdFt ?? tubing.depthFt);
  const lift = tubing.liftDepthFt !== null && tubing.liftGasScfD > 0 ? tubing.liftDepthFt : null;
  for (let md = 0; md < bottom;) {
    // A step ends at the injection point, so the gas joins exactly there.
    const ds = lift !== null && md < lift && md + step > lift ? lift - md : Math.min(step, bottom - md);
    const here = at(md, p);
    points.push({ mdFt: md, tvdFt: here.tvd, p, tempF: here.tempF, ...here.flow });
    const mid = at(md + ds / 2, p + here.flow.gradient * ds / 2);
    p += mid.flow.gradient * ds;
    md += ds;
    // Beyond 20,000 psia the PVT correlations are long past their data: the tubing cannot carry this rate.
    if (!Number.isFinite(p) || p <= 0 || p > 20000) return { bottomPressure: null, points };
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
export function operatingPoint(ipr: Inflow, vlp: NodalCurve, exact?: (rate: number) => number | null): OperatingPoint | null {
  let found: OperatingPoint | null = null, bracket: [number, number] | null = null;
  for (let i = 1; i < vlp.rates.length; i++) {
    const q0 = vlp.rates[i - 1]!, q1 = vlp.rates[i]!, v0 = vlp.pressures[i - 1]!, v1 = vlp.pressures[i]!;
    const i0 = ipr.pwf(q0), i1 = ipr.pwf(q1);
    if (i0 === null || i1 === null || !Number.isFinite(v0) || !Number.isFinite(v1)) continue;
    const d0 = i0 - v0, d1 = i1 - v1;
    if (d0 >= 0 && d1 < 0) {
      const t = d0 / (d0 - d1), rate = q0 + (q1 - q0) * t;
      found = { rate, pwf: v0 + (v1 - v0) * t };
      bracket = [q0, q1];
    }
  }
  // The grid only brackets the crossing; read straight between grid points the rate is off by up to a
  // few per cent, enough to make slopes (the gas-lift curve's) jagged. With the outflow itself, bisect.
  if (found && bracket && exact) {
    let [a, b] = bracket;
    const gap = (q: number) => { const v = exact(q), w = ipr.pwf(q); return v === null || w === null || !Number.isFinite(v) ? NaN : w - v; };
    for (let k = 0; k < 18 && b - a > 1e-4 * b; k++) { const m = (a + b) / 2, g = gap(m); if (!Number.isFinite(g)) break; if (g >= 0) a = m; else b = m; }
    const rate = (a + b) / 2, pwf = exact(rate);
    if (pwf !== null && Number.isFinite(pwf)) found = { rate, pwf };
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
  // The Bo factor scales the swelling (Bo − 1), as oilFvf applies it.
  const tuning: PvtTuning = { pbFactor: lab.bubblePoint / pb, boFactor: (lab.boAtPb - 1) / (bo - 1), muFactor: lab.muAtPb / mu };
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
  // A gauge below the producing depth is outside the tubing model: left out rather than read at the bottom.
  const rows = tests.filter((test) => test.gaugeMdFt !== null && test.gaugePressure !== null && test.gaugeMdFt <= model.tubing.depthFt).map((test) => {
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
export function tuneFlow(model: WellModel, tests: readonly WellTest[], correlation: Correlation): FlowTuning & { readonly mae: number; readonly bias: number; readonly resolved: { readonly holdup: boolean; readonly friction: boolean }; readonly gauges: number } {
  const fitAt = (h: number, f: number) => gaugeFit(model, tests, { correlation, holdupFactor: h, frictionFactor: f });
  const n = fitAt(1, 1).rows.filter((row) => row.residual !== null).length;
  // No gauge readings: nothing to tune against, so the correlation stays as published.
  if (!n) return { correlation, holdupFactor: 1, frictionFactor: 1, mae: NaN, bias: NaN, resolved: { holdup: false, friction: false }, gauges: 0 };
  const H = [0.5, 1.6] as const, F = [0.3, 3] as const;
  const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
  const sse = (h: number, f: number) => { const rows = fitAt(clamp(h, H), clamp(f, F)).rows; return rows.reduce((sum, row) => sum + (row.residual === null ? 1e8 : row.residual ** 2), 0); };
  // Both factors together (Nelder–Mead on the squared residuals, in log space): holdup and friction
  // trade off along a narrow valley that one-at-a-time searches stop short in.
  const nelder = (start: readonly [number, number]) => {
    const f = (x: readonly number[]) => sse(Math.exp(x[0]!), Math.exp(x[1]!));
    let simplex = [[Math.log(start[0]), Math.log(start[1])], [Math.log(start[0]) + 0.08, Math.log(start[1])], [Math.log(start[0]), Math.log(start[1]) + 0.15]].map((x) => ({ x, v: f(x) }));
    for (let it = 0; it < 80; it++) {
      simplex.sort((a, b) => a.v - b.v);
      const [best, mid, worst] = simplex as [typeof simplex[0], typeof simplex[0], typeof simplex[0]];
      if (Math.abs(worst.v - best.v) <= 1e-6 * (1 + best.v) && Math.hypot(worst.x[0]! - best.x[0]!, worst.x[1]! - best.x[1]!) < 1e-4) break;
      const c = [(best.x[0]! + mid.x[0]!) / 2, (best.x[1]! + mid.x[1]!) / 2];
      const at = (t: number) => { const x = [c[0]! + t * (worst.x[0]! - c[0]!), c[1]! + t * (worst.x[1]! - c[1]!)]; return { x, v: f(x) }; };
      const r = at(-1);
      if (r.v < best.v) { const e = at(-2); simplex = [best, mid, e.v < r.v ? e : r]; }
      else if (r.v < mid.v) simplex = [best, mid, r];
      else { const k = at(r.v < worst.v ? -0.5 : 0.5); if (k.v < Math.min(r.v, worst.v)) simplex = [best, mid, k]; else simplex = [best, ...[mid, worst].map((p) => { const x = [best.x[0]! + (p.x[0]! - best.x[0]!) / 2, best.x[1]! + (p.x[1]! - best.x[1]!) / 2]; return { x, v: f(x) }; })]; }
    }
    simplex.sort((a, b) => a.v - b.v);
    return { h: clamp(Math.exp(simplex[0]!.x[0]!), H), f: clamp(Math.exp(simplex[0]!.x[1]!), F), v: simplex[0]!.v };
  };
  // Started from the best of a coarse grid, so a second valley is not missed.
  let start: [number, number] = [1, 1], startV = Infinity;
  for (const h of [0.7, 0.9, 1.1, 1.3]) for (const f of [0.6, 1, 1.5, 2.2]) { const v = sse(h, f); if (v < startV) { startV = v; start = [h, f]; } }
  const both = nelder(start);
  const golden = (lo: number, hi: number, at: (x: number) => number) => {
    const g = (Math.sqrt(5) - 1) / 2;
    let a = lo, b = hi, c = b - g * (b - a), d = a + g * (b - a), fc = at(c), fd = at(d);
    for (let i = 0; i < 24; i++) { if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = at(c); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = at(d); } }
    return (a + b) / 2;
  };
  // Is each factor resolved by these tests? The nested-model F-test at 95%: the second factor counts
  // only if it cuts the squared residuals by more than chance would with this many gauges; else it is
  // held at 1, not reported as if measured.
  const holdupOnly = golden(H[0], H[1], (h) => sse(h, 1)), frictionOnly = golden(F[0], F[1], (f) => sse(1, f));
  const sH = sse(holdupOnly, 1), sF = sse(1, frictionOnly);
  const significant = (reduced: number) => n > 2 && both.v > 0 ? (reduced - both.v) / (both.v / (n - 2)) > fCritical95(n - 2) : n > 2 && reduced > both.v;
  const resolved = { holdup: significant(sF), friction: significant(sH) };
  let hf = both.h, ff = both.f;
  if (!resolved.friction && !resolved.holdup) { if (sH <= sF) { hf = holdupOnly; ff = 1; } else { hf = 1; ff = frictionOnly; } }
  else if (!resolved.friction) { hf = holdupOnly; ff = 1; }
  else if (!resolved.holdup) { hf = 1; ff = frictionOnly; }
  const fit = fitAt(hf, ff);
  return { correlation, holdupFactor: hf, frictionFactor: ff, mae: fit.mae, bias: fit.bias, resolved, gauges: n };
}

/** The F distribution's 95th percentile with 1 and df degrees of freedom. */
function fCritical95(df: number): number {
  const table: readonly [number, number][] = [[1, 161.4], [2, 18.51], [3, 10.13], [4, 7.71], [5, 6.61], [6, 5.99], [7, 5.59], [8, 5.32], [9, 5.12], [10, 4.96], [12, 4.75], [15, 4.54], [20, 4.35], [30, 4.17], [60, 4.0], [120, 3.92]];
  if (df >= 120) return 3.84;
  for (let i = 1; i < table.length; i++) if (df <= table[i]![0]) { const [d0, f0] = table[i - 1]!, [d1, f1] = table[i]!; return f0 + (f1 - f0) * (df - d0) / (d1 - d0); }
  return 3.84;
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
  const ranked = [...all].sort((a, b) => Math.abs(a.mae - b.mae) <= 2 || !Number.isFinite(a.mae - b.mae) ? distance(a) - distance(b) : a.mae - b.mae);
  const best = ranked[0]!, next = ranked[1];
  // Whether the gauges really prefer it: its tuned error clearly (a fifth, and 2 psi) under the next one's.
  const clear = !!next && Number.isFinite(best.mae) && next.mae > best.mae + Math.max(2, 0.2 * best.mae);
  return { all, best, clear };
}

/** Reservoir pressure at a date: the build-ups' readings, straight between them; before the first, the initial pressure; after the last, the trend of the last two carried on. */
export function pressureAtDate(model: WellModel, tests: readonly WellTest[], date: string): { readonly pressure: number; readonly measured: boolean } {
  const t = Date.parse(date);
  if (!Number.isFinite(t)) return { pressure: model.initialPressure, measured: false };
  // Build-ups by date, two on one day averaged.
  const byDay = new Map<number, number[]>();
  for (const test of tests) { const d = Date.parse(test.date); if (test.reservoirPressure !== null && Number.isFinite(d)) byDay.set(d, [...(byDay.get(d) ?? []), test.reservoirPressure]); }
  const points = [...byDay].map(([d, ps]) => ({ t: d, p: ps.reduce((a, b) => a + b, 0) / ps.length })).sort((a, b) => a.t - b.t);
  const exact = points.find((point) => point.t === t);
  if (exact) return { pressure: exact.p, measured: true };
  // Production starts at the first test: the initial pressure there, unless a build-up was taken that day.
  const firstTest = Math.min(...tests.map((test) => Date.parse(test.date)).filter(Number.isFinite));
  const all = Number.isFinite(firstTest) && (!points.length || firstTest < points[0]!.t) ? [{ t: firstTest, p: model.initialPressure }, ...points] : points;
  if (!all.length || t <= all[0]!.t) return { pressure: all[0]?.p ?? model.initialPressure, measured: false };
  for (let i = 1; i < all.length; i++) if (t <= all[i]!.t) { const a = all[i - 1]!, b = all[i]!; return { pressure: a.p + (b.p - a.p) * (t - a.t) / (b.t - a.t), measured: false }; }
  // After the last: the last two points' trend, or the last value held when there is only one.
  if (all.length < 2) return { pressure: all[0]!.p, measured: false };
  const a = all.at(-2)!, b = all.at(-1)!;
  return { pressure: Math.max(14.7, b.p + (b.p - a.p) * (t - b.t) / (b.t - a.t)), measured: false };
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
      // Invert the composite IPR, which is linear in J at a given pwf.
      pi = test.liquidRate / compositeShape(pressure, pb, pwf, test.waterCut);
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
    const ipr = inflow(reservoir, fluid, undefined, plan.waterCut);
    const run = (q: number, toMdFt?: number) => traverse({ whp: plan.whp, fluid, liquidRate: q, waterCut: plan.waterCut, tubing: { ...truth.model.tubing, liftGasScfD: plan.liftGasScfD }, path: truth.model.path, tempAt: truth.model.tempAt, stepFt: 150, correlation: truth.flow.correlation, holdupFactor: truth.flow.holdupFactor, frictionFactor: truth.flow.frictionFactor, toMdFt });
    const point = operatingPoint(ipr, outflowCurve(rateGrid(ipr.aof, 48), (q) => run(q).bottomPressure), (q) => run(q).bottomPressure);
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
  const point = operatingPoint(input.ipr, outflowCurve(rates ?? rateGrid(input.ipr.aof, 24), (q) => run(q).bottomPressure), (q) => run(q).bottomPressure);
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

  // 2. Unloading valves (Takacs; API RP 11V6). Settings step down the string so the casing pressure
  // closes them from the top: the operating valve opens at the operating pressure, each valve above
  // it one drop higher. Each valve's depth comes from the pressure it is set to: the load fluid from
  // the design tubing pressure at the valve above, down to where it meets the casing pressure at this
  // valve's opening pressure, D(n+1) = D(n) + (Pc(n+1) − Pt(n))/Gs. The top valve is spaced on the
  // kickoff pressure from the unloading wellhead pressure. The design is the fewest valves whose
  // deepest one can uncover the operating valve.
  const reach = (fromMd: number, fromPsia: number, surfacePsia: number) => {
    const ok = (md: number) => fromPsia + gs * (tvdOf(md) - tvdOf(fromMd)) <= casing(surfacePsia, md);
    let lo = fromMd, hi = operating!.mdFt;
    if (ok(hi)) return hi;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
    return lo;
  };
  const opening = (k: number, count: number) => input.operatingPsia + drop * (count + 1 - k); // valve k of count unloading valves, psia
  let depths: number[] | null = null, why: string | null = null;
  for (let count = 0; count <= 20 && !depths; count++) {
    if (count > 0 && opening(1, count) > input.kickoffPsia + 1e-6) { why = `The kickoff pressure leaves room for ${count - 1} unloading valve${count === 2 ? "" : "s"} at ${drop} psi apart, and more are needed: raise the kickoff pressure or lower the drop per valve.`; break; }
    const first = reach(0, input.unloadingWhp, input.kickoffPsia);
    if (count === 0) { if (first >= operating.mdFt) depths = []; continue; }
    const ds = [first];
    for (let k = 1; k < count && ds.at(-1)! < operating.mdFt; k++) ds.push(reach(ds.at(-1)!, designTubing(ds.at(-1)!), opening(k + 1, count)));
    if (ds.length < count || ds.at(-1)! >= operating.mdFt) continue;
    if (reach(ds.at(-1)!, designTubing(ds.at(-1)!), input.operatingPsia) < operating.mdFt) continue;
    const tight = ds.findIndex((d, i) => (i ? d - ds[i - 1]! : Infinity) < minSpacing || operating!.mdFt - d < minSpacing / 2);
    if (tight >= 0) { why = `Unloading needs valves closer than the ${Math.round(minSpacing / FT_PER_M_CORE)} m allowed near ${Math.round(ds[tight]! / FT_PER_M_CORE)} m: more kickoff pressure, a lighter load fluid or a lower unloading wellhead pressure.`; break; }
    depths = ds;
  }
  if (!depths) return { operating, valves: [] as LiftValve[], reason: why ?? "No set of up to 20 unloading valves uncovers the operating valve." };
  const valves: LiftValve[] = depths.map((at, i) => {
    const surface = opening(i + 1, depths!.length);
    const tvd = tvdOf(at), t = tempAt(tvd), pc = casing(surface, at), pt = designTubing(at);
    // Nitrogen-charged bellows: dome pressure at the valve's temperature, carried to 60 °F at constant
    // volume with nitrogen's own Z (not the low-pressure rule of thumb), then the test-rack opening.
    const dome = pc * (1 - R) + pt * R, dome60 = nitrogenAt60(dome, t);
    return { role: "unloading", mdFt: at, tvdFt: tvd, tempF: t, casingPsia: pc, tubingPsia: pt, surfaceOpeningPsig: surface - 14.7, ptroPsig: (dome60 - 14.7) / (1 - R) };
  });
  const opT = tempAt(opTvd);
  valves.push({ role: "operating", mdFt: operating.mdFt, tvdFt: opTvd, tempF: opT, casingPsia: operating.casingAt, tubingPsia: operating.tubingAt, surfaceOpeningPsig: input.operatingPsia - 14.7, ptroPsig: null });
  return { operating, valves, reason: null };
}

const FT_PER_M_CORE = 3.28084;

/** A nitrogen dome's pressure at 60 °F, psia, from its pressure at a valve temperature (constant volume, p/ZT fixed; N2: 227.2 °R, 492.8 psia). */
export function nitrogenAt60(psia: number, tempF: number): number {
  const z = (p: number, t: number) => zReduced(p / 492.8, rankine(t) / 227.16);
  const k = psia / (z(psia, tempF) * rankine(tempF)) * rankine(60);
  let p60 = psia * rankine(60) / rankine(tempF);
  for (let i = 0; i < 30; i++) p60 = k * z(p60, 60);
  return p60;
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
 * The curve's points only bracket them: given the model (`oilAt`), each is found by golden section
 * between the grid points either side of the best one, so neither lands on a grid point by
 * construction. Without the model, the best grid points are returned as they are.
 */
export function liftOptimum(curve: readonly { readonly gasScfD: number; readonly oil: number }[], oilNetback: number, gasCostPerMscf: number, availableScfD: number, oilAt?: (gasScfD: number) => number) {
  const pts = [...curve].sort((a, b) => a.gasScfD - b.gasScfD);
  const value = (p: { gasScfD: number; oil: number }) => p.oil * oilNetback - p.gasScfD / 1000 * gasCostPerMscf;
  const argBest = (score: (p: { gasScfD: number; oil: number }) => number, cap: number) => {
    let i = -1;
    pts.forEach((p, k) => { if (p.gasScfD <= cap && (i < 0 || score(p) > score(pts[i]!))) i = k; });
    return Math.max(0, i);
  };
  const refine = (i: number, score: (p: { gasScfD: number; oil: number }) => number, cap: number) => {
    const node = pts[i]!;
    if (!oilAt) return node;
    let a = pts[Math.max(0, i - 1)]!.gasScfD, b = Math.min(cap, pts[Math.min(pts.length - 1, i + 1)]!.gasScfD);
    if (b <= a) return node;
    const at = (g: number) => ({ gasScfD: g, oil: oilAt(g) });
    const r = (Math.sqrt(5) - 1) / 2;
    let c = at(b - r * (b - a)), d = at(a + r * (b - a));
    for (let k = 0; k < 14; k++) {
      if (score(c) >= score(d)) { b = d.gasScfD; d = c; c = at(b - r * (b - a)); } else { a = c.gasScfD; c = d; d = at(a + r * (b - a)); }
    }
    const found = score(c) >= score(d) ? c : d;
    return score(found) >= score(node) ? found : node;
  };
  const maximum = refine(argBest((p) => p.oil, Infinity), (p) => p.oil, Infinity);
  const economic = refine(argBest(value, availableScfD), value, availableScfD);
  return { maximum, economic, marginPerDay: value(economic), breakEvenSlope: gasCostPerMscf / oilNetback, refined: !!oilAt };
}

// ── Material balance and forecast (a tank, as MBAL runs it, fed by the well's lift curves) ────────
/** Bbl per ft³. */
const BBL_PER_FT3 = 1 / 5.615;

/**
 * An oil tank without a gas cap: solution-gas drive, rock and connate-water expansion, and a pot
 * aquifer sized as a multiple of the oil zone's pore volume. Below the bubble point the free gas is
 * produced by Corey relative permeability (Muskat/Tarner).
 */
export interface Tank {
  /** Stock-tank oil initially in place, STB. */
  readonly stoiip: number;
  readonly initialPressure: number;
  readonly tempF: number;
  readonly fluid: BlackOil;
  readonly swi: number;
  /** Water and pore compressibility, 1/psi. */
  readonly cw: number;
  readonly cf: number;
  /** Pot aquifer pore volume over the oil zone's (0: none). */
  readonly aquifer: number;
  readonly relPerm?: { readonly sgc: number; readonly sorg: number; readonly no: number; readonly ng: number; readonly krgMax: number };
}
export interface TankState { readonly p: number; readonly np: number; readonly wp: number; readonly gp: number }

const BW = 1.02;
const defaultRelPerm = { sgc: 0.05, sorg: 0.2, no: 3, ng: 2, krgMax: 0.8 };

/** The expansion terms at a pressure (Havlena–Odeh), rb per STB of oil in place, and the PVT behind them. */
export function tankTerms(tank: Tank, p: number) {
  const t = tank.tempF, f = tank.fluid, pi = tank.initialPressure;
  const boi = oilFvf(f, pi, t), rsi = solutionGor(f, pi, t), bo = oilFvf(f, p, t), rs = solutionGor(f, p, t);
  const bg = gasFvf(f.gasSg, Math.max(14.7, p), t) * BBL_PER_FT3;
  const dp = pi - p;
  const eo = bo - boi + (rsi - rs) * bg;
  const efw = boi * (tank.cw * tank.swi + tank.cf) / (1 - tank.swi) * dp;
  // The pot aquifer, per STB in place: its pore volume times total compressibility times the drop.
  const we = tank.aquifer * boi / (1 - tank.swi) * (tank.cw + tank.cf) * dp;
  return { boi, rsi, bo, rs, bg, eo, efw, we, et: eo + efw };
}

/** Underground withdrawal, rb (Havlena–Odeh F). */
const withdrawal = (terms: ReturnType<typeof tankTerms>, s: Omit<TankState, "p">) => s.np * (terms.bo - terms.rs * terms.bg) + s.gp * terms.bg + s.wp * BW;
const residual = (tank: Tank, p: number, s: Omit<TankState, "p">) => { const k = tankTerms(tank, p); return withdrawal(k, s) - tank.stoiip * (k.et + k.we); };

/** The tank pressure that balances these cumulatives (oil and water in STB/bbl, gas in scf). */
export function tankPressure(tank: Tank, s: Omit<TankState, "p">): number {
  // From the initial pressure down to the first balance: at much lower pressures the produced gas's volume turns it back over.
  let hi = tank.initialPressure, lo = hi;
  if (residual(tank, hi, s) <= 0) return hi;
  for (let k = 1; k <= 400; k++) { lo = Math.max(14.7, tank.initialPressure - k * 10 * (1 + k / 20)); if (residual(tank, lo, s) <= 0 || lo === 14.7) break; hi = lo; }
  for (let i = 0; i < 60 && hi - lo > 0.01; i++) { const mid = (lo + hi) / 2; if (residual(tank, mid, s) > 0) hi = mid; else lo = mid; }
  return (lo + hi) / 2;
}

/** Producing GOR at a pressure and cumulative oil: solution gas, plus free gas once its saturation passes the critical. */
export function tankGor(tank: Tank, p: number, np: number, wp = 0): number {
  const k = tankTerms(tank, p), kr = tank.relPerm ?? defaultRelPerm;
  if (p >= bubblePoint(tank.fluid, tank.tempF)) return k.rs;
  // Saturations in the pore volume as it now is: the pores shrunk by their compressibility, the water
  // grown by its own expansion and the aquifer's influx, less what was produced; the rest oil and gas.
  const pv = tank.stoiip * k.boi / (1 - tank.swi), dp = tank.initialPressure - p, pvNow = pv * (1 - tank.cf * dp);
  const water = pv * tank.swi * (1 + tank.cw * dp) + tank.stoiip * k.we - wp * BW;
  const so = Math.max(0, (tank.stoiip - np) * k.bo / pvNow), sw = Math.min(1, Math.max(0, water / pvNow)), sg = Math.max(0, 1 - so - sw);
  if (sg <= kr.sgc) return k.rs;
  const span = 1 - sw - kr.sgc - kr.sorg;
  const krg = kr.krgMax * Math.min(1, (sg - kr.sgc) / Math.max(1e-6, span)) ** kr.ng, kro = Math.max(1e-6, Math.max(0, (so - kr.sorg) / Math.max(1e-6, 1 - sw - kr.sorg)) ** kr.no);
  const muo = oilViscosity(tank.fluid, p, tank.tempF), mug = gasViscosity(tank.fluid.gasSg, Math.max(14.7, p), tank.tempF);
  return k.rs + krg / kro * muo * k.bo / (mug * k.bg);
}

/** One production step (Tarner): the new pressure, with the gas produced at the step's average GOR. */
export function tankStep(tank: Tank, state: TankState, dNp: number, dWp: number): TankState & { readonly gor: number } {
  const np = state.np + dNp, wp = state.wp + dWp, g0 = tankGor(tank, state.p, state.np, state.wp);
  const gpAt = (p: number) => state.gp + (g0 + tankGor(tank, p, np, wp)) / 2 * dNp;
  const r = (p: number) => residual(tank, p, { np, wp, gp: gpAt(p) });
  let hi = state.p;
  if (r(hi) <= 0) return { p: hi, np, wp, gp: gpAt(hi), gor: tankGor(tank, hi, np, wp) };
  // The root nearest the last pressure: at much lower trial pressures the free gas term can turn the balance back over.
  let lo = hi;
  for (let k = 1; k <= 400; k++) { lo = Math.max(14.7, state.p - k * 10 * (1 + k / 20)); if (r(lo) <= 0 || lo === 14.7) break; hi = lo; }
  for (let i = 0; i < 50 && hi - lo > 0.05; i++) { const mid = (lo + hi) / 2; if (r(mid) > 0) hi = mid; else lo = mid; }
  const p = (lo + hi) / 2;
  return { p, np, wp, gp: gpAt(p), gor: tankGor(tank, p, np, wp) };
}

/** Cumulative oil, water and gas at each test, the rates read as straight lines between tests from the first. */
export function cumulativeAtTests(tests: readonly WellTest[]) {
  const sorted = [...tests].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  let np = 0, wp = 0, gp = 0;
  return sorted.map((test, i) => {
    if (i) {
      const prev = sorted[i - 1]!, days = (Date.parse(test.date) - Date.parse(prev.date)) / 86400000;
      const oil = (t: WellTest) => t.liquidRate * (1 - t.waterCut), water = (t: WellTest) => t.liquidRate * t.waterCut;
      np += (oil(prev) + oil(test)) / 2 * days; wp += (water(prev) + water(test)) / 2 * days;
      gp += (oil(prev) * prev.gor + oil(test) * test.gor) / 2 * days;
    }
    return { test, np, wp, gp };
  });
}

/** A month's allocated production: what the field's allocation gives each well (oil STB, water bbl, gas scf). */
export interface ProductionMonth { readonly month: string; readonly oil: number; readonly water: number; readonly gas: number }

/** Cumulatives on a date from the monthly volumes, each month spread evenly over its days. */
export function cumulativeOn(history: readonly ProductionMonth[], date: string) {
  const t = Date.parse(date);
  let np = 0, wp = 0, gp = 0;
  for (const m of history) {
    const a = Date.parse(`${m.month.slice(0, 7)}-01`), end = new Date(a); end.setUTCMonth(end.getUTCMonth() + 1);
    const f = Math.max(0, Math.min(1, (t - a) / (end.getTime() - a)));
    np += m.oil * f; wp += m.water * f; gp += m.gas * f;
  }
  return { np, wp, gp };
}

/** The pressure points the tank is matched to: each build-up with the cumulatives on its date, from the monthly volumes where there are any, else read between the tests. */
export function pressurePoints(tests: readonly WellTest[], history: readonly ProductionMonth[] = []) {
  const byTests = cumulativeAtTests(tests);
  return byTests.filter((row) => row.test.reservoirPressure !== null).map((row) => ({ date: row.test.date, pressure: row.test.reservoirPressure!, ...(history.length ? cumulativeOn(history, row.test.date) : { np: row.np, wp: row.wp, gp: row.gp }) }));
}

/**
 * The tank matched to the measured reservoir pressures by least squares: STOIIP by golden section
 * for each aquifer size, the best aquifer refined between them, and the range the pressures cannot
 * tell apart (the 95% profile-likelihood interval at the build-ups' stated accuracy). `mae` is the RMS miss.
 * With the Havlena–Odeh points (F against Et): a straight line through the origin, slope N, means no aquifer.
 */
export function matchTank(base: Omit<Tank, "stoiip" | "aquifer">, points: readonly { readonly date: string; readonly pressure: number; readonly np: number; readonly wp: number; readonly gp: number }[], noisePsi = 15) {
  const history = points.filter((row) => row.np > 0);
  const n = history.length;
  // Least squares on the pressures: for one aquifer size, the STOIIP by golden section in log space.
  const sseOf = (stoiip: number, aquifer: number) => history.reduce((sum, row) => sum + (tankPressure({ ...base, stoiip, aquifer }, row) - row.pressure) ** 2, 0);
  const golden = (lo: number, hi: number, at: (x: number) => number, iterations: number) => {
    const g = (Math.sqrt(5) - 1) / 2;
    let a = lo, b = hi, c = b - g * (b - a), d = a + g * (b - a), fc = at(c), fd = at(d);
    for (let i = 0; i < iterations; i++) { if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = at(c); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = at(d); } }
    return (a + b) / 2;
  };
  const fit = (aquifer: number) => {
    const logN = golden(5, 10, (x) => sseOf(10 ** x, aquifer), 50);
    const sse = sseOf(10 ** logN, aquifer);
    return { aquifer, stoiip: 10 ** logN, sse, mae: Math.sqrt(sse / Math.max(1, n)) };
  };
  const all = [0, 0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12].map(fit);
  // The best fit, its aquifer refined between the grid sizes either side (not snapped to the grid).
  const i = all.reduce((best, f, k) => f.sse < all[best]!.sse ? k : best, 0);
  const lo = all[Math.max(0, i - 1)]!.aquifer, hi = all[Math.min(all.length - 1, i + 1)]!.aquifer;
  const chosen = hi > lo ? [fit(golden(lo, hi, (x) => fit(x).sse, 16)), all[i]!].reduce((a, b) => a.sse <= b.sse ? a : b) : all[i]!;
  // The tanks the pressures cannot tell apart: the 95% profile-likelihood interval over the aquifer
  // (Δχ² ≤ 3.84), with the stated build-up accuracy as σ, raised to the fit's own scatter if that is worse.
  const sigma2 = Math.max(noisePsi ** 2, n > 2 ? chosen.sse / (n - 2) : 0);
  const alike = [...all, chosen].filter((f) => (f.sse - chosen.sse) / sigma2 <= 3.84);
  const range = { stoiip: [Math.min(...alike.map((f) => f.stoiip)), Math.max(...alike.map((f) => f.stoiip))] as const, aquifer: [Math.min(...alike.map((f) => f.aquifer)), Math.max(...alike.map((f) => f.aquifer))] as const };
  const tank: Tank = { ...base, stoiip: chosen.stoiip, aquifer: chosen.aquifer };
  const plotted = history.map((row) => {
    const k = tankTerms(tank, row.pressure);
    return { date: row.date, np: row.np, wp: row.wp, gp: row.gp, measured: row.pressure, model: tankPressure(tank, row), f: withdrawal(k, row), et: k.et, we: k.we };
  });
  const within = (f: { sse: number }) => (f.sse - chosen.sse) / sigma2 <= 3.84;
  return { tank, mae: chosen.mae, all: all.map((f) => ({ ...f, within: within(f) })), best: chosen, range, sigma: Math.sqrt(sigma2), points: plotted };
}

/**
 * The water–oil ratio trend: ln(WOR) straight against cumulative oil, fitted by least squares (the
 * industry's WOR plot). Trusted only once the water cut passes about 50%.
 */
export function worTrend(rows: readonly { readonly np: number; readonly waterCut: number }[]) {
  const pts = rows.filter((r) => r.waterCut > 0.005 && r.waterCut < 0.995).map((r) => ({ x: r.np, y: Math.log(r.waterCut / (1 - r.waterCut)) }));
  const n = pts.length, mx = pts.reduce((s, p) => s + p.x, 0) / Math.max(1, n), my = pts.reduce((s, p) => s + p.y, 0) / Math.max(1, n);
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0), slope = n > 1 && sxx > 0 ? pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx : 0;
  const intercept = my - slope * mx;
  const wcAt = (np: number) => { const wor = Math.exp(intercept + slope * np); return wor / (1 + wor); };
  return { slope, intercept, points: pts, wcAt, early: (rows.at(-1)?.waterCut ?? 0) < 0.5 };
}

/**
 * Lift curves: the bottom-hole pressure the tubing needs over a grid of liquid rate, water cut and
 * GOR at one wellhead pressure and lift gas rate, read back by interpolation. The tables PROSPER
 * hands MBAL so the forecast need not run a traverse each step.
 */
export function liftTable(run: (rate: number, waterCut: number, gor: number) => number | null, maxRate: number, rsi: number) {
  // Rates geometric from 50 STB/d, dense where the curve turns at low rate; GOR from solution to 25 times it.
  const rates = Array.from({ length: 22 }, (_, i) => 50 * (maxRate / 50) ** (i / 21));
  const cuts = [0, 0.2, 0.4, 0.6, 0.75, 0.85, 0.92, 0.97];
  const gors = [rsi, rsi * 1.6, rsi * 3, rsi * 6, rsi * 12, rsi * 25];
  // Each cell traversed only when first read: a forecast that stays above the bubble point reads one GOR.
  const cells = new Map<number, number>();
  const cell = (ia: number, ib: number, ic: number) => {
    const key = (ia * cuts.length + ib) * rates.length + ic;
    let v = cells.get(key);
    if (v === undefined) { v = run(rates[ic]!, cuts[ib]!, gors[ia]!) ?? NaN; cells.set(key, v); }
    return v;
  };
  const bracket = (xs: readonly number[], v: number, extrapolate = false) => { let i = 0; while (i < xs.length - 2 && v > xs[i + 1]!) i++; const f = (v - xs[i]!) / (xs[i + 1]! - xs[i]!); return { i, f: Math.max(0, extrapolate ? f : Math.min(1, f)) }; };
  const bhp = (q: number, wc: number, gor: number) => {
    // Rate carried on straight past the last node (friction keeps climbing); water cut and GOR held at their ends.
    const a = bracket(gors, gor), b = bracket(cuts, wc), c = bracket(rates, q, true);
    let out = 0;
    for (const [ia, wa] of [[a.i, 1 - a.f], [a.i + 1, a.f]] as const) for (const [ib, wb] of [[b.i, 1 - b.f], [b.i + 1, b.f]] as const) for (const [ic, wc2] of [[c.i, 1 - c.f], [c.i + 1, c.f]] as const) {
      const w = wa * wb * wc2;
      if (w !== 0) out += w * cell(ia, ib, ic);
    }
    return out;
  };
  return { rates, bhp };
}

export interface ForecastStep { readonly date: string; readonly pressure: number; readonly oil: number; readonly water: number; readonly gor: number; readonly waterCut: number; readonly np: number }

/**
 * A monthly forecast: each month the tank's pressure sets the inflow (the matched productivity index,
 * Vogel below the bubble point), the WOR trend sets the water cut, the tank the GOR, and the lift
 * curves the outflow; the operating point produces for the month and the tank steps on. It stops at
 * the horizon, when the well dies, or when oil falls below the economic limit.
 */
export function forecastWell(input: {
  readonly tank: Tank; readonly start: TankState; readonly startDate: string; readonly pi: number;
  readonly waterCutAt: (np: number) => number; readonly minWaterCut: number;
  readonly bhp: (rate: number, waterCut: number, gor: number) => number; readonly maxRate: number;
  readonly months: number; readonly economicLimit: number;
}) {
  const steps: ForecastStep[] = [];
  let state: TankState = input.start, end: "horizon" | "dead" | "economic" = "horizon";
  const date = new Date(input.startDate);
  for (let m = 0; m < input.months; m++) {
    const wc = Math.min(0.99, Math.max(input.minWaterCut, input.waterCutAt(state.np)));
    const gor = tankGor(input.tank, state.p, state.np, state.wp);
    const reservoir: Reservoir = { pressure: state.p, tempF: input.tank.tempF, permeabilityMd: 1, netPayFt: 1, skin: 0, drainageRadiusFt: 1000, wellboreRadiusFt: 0.35 };
    const ipr = inflow(reservoir, input.tank.fluid, input.pi, wc);
    const grid = rateGrid(Math.min(ipr.aof, input.maxRate), 28);
    const vlp = (q: number) => { const v = input.bhp(q, wc, gor); return Number.isFinite(v) ? v : null; };
    let point = operatingPoint(ipr, outflowCurve(grid, vlp), vlp);
    // The well could make more than the facilities take: choked back to their limit, not dead.
    if (!point && ipr.aof > input.maxRate) { const atCap = ipr.pwf(input.maxRate), need = vlp(input.maxRate); if (atCap !== null && need !== null && atCap >= need) point = { rate: input.maxRate, pwf: atCap }; }
    if (!point) { end = "dead"; break; }
    const oil = point.rate * (1 - wc);
    if (oil < input.economicLimit) { end = "economic"; break; }
    steps.push({ date: date.toISOString().slice(0, 10), pressure: state.p, oil, water: point.rate * wc, gor, waterCut: wc, np: state.np });
    const next = new Date(date); next.setUTCMonth(next.getUTCMonth() + 1);
    const days = (next.getTime() - date.getTime()) / 86400000;
    state = tankStep(input.tank, state, oil * days, point.rate * wc * days);
    date.setTime(next.getTime());
  }
  return { steps, end, endDate: date.toISOString().slice(0, 10), final: state };
}
