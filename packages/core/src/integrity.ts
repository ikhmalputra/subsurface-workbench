/**
 * Annulus integrity as ISO 16530-1 and API RP 90 manage it: each annulus's maximum allowable
 * annulus surface pressure (MAASP) from the limits that bound it, and the trapped-annulus pressure
 * build-up (APB) when the well heats up in production, as WellCat computes it.
 *
 * - MAASP: the least of (a) the outer string's burst, derated, against the backup outside it; (b) the
 *   inner string's collapse, derated, against the least pressure inside it; (c) the formation at an
 *   exposed shoe (the open hole between the outer string's shoe and the inner string's cement). Each
 *   is taken down the annulus with its fluid's gradient, and the one that binds is named.
 * - Flowing temperature: Ramey (1962), the fluid warmer than the rock above the producing depth by a
 *   relaxation distance that grows with rate and with time on production.
 * - APB: the fluid trapped above the cement expands by αΔT against its compressibility κ plus the
 *   annulus's compliance C, both strings ballooning elastically: ΔP = αΔT / (κ + C).
 *
 * Field units: psi, ft, °F, inches.
 */

export type Limit = "burst" | "collapse" | "formation" | "packer";

export interface AnnulusInput {
  readonly name: string;
  /** Depth the annulus reaches, TVD ft: the packer or the top of the inner string's cement. */
  readonly bottomTvdFt: number;
  /** Fluid in the annulus, psi/ft. */
  readonly fluidGradient: number;
  /** Outer string: its burst rating, and what stands behind it (the next annulus's fluid or pore pressure), psi/ft. */
  readonly outerBurstPsi: number;
  readonly backupGradient: number;
  /** Inner string: its collapse rating, and the least pressure inside it (surface psi and gradient). */
  readonly innerCollapsePsi: number;
  readonly insideSurfacePsi: number;
  readonly insideGradient: number;
  /** The outer string's shoe, where the open hole below it meets the annulus: TVD ft and fracture pressure, psi; null if cemented over. */
  readonly exposedShoe: { readonly tvdFt: number; readonly fracturePsi: number } | null;
  /** A packer at the bottom and its differential rating, psi (the A annulus). */
  readonly packerRatingPsi?: number;
}
export interface Derating { readonly burst: number; readonly collapse: number; readonly formation: number }
/** Common practice: 80% of the burst and collapse ratings, 100% of the formation's strength. */
export const defaultDerating: Derating = { burst: 0.8, collapse: 0.8, formation: 1 };

/**
 * MAASP and its governing limit. Each limit is the surface pressure that brings the limit to its
 * derated value at the worst depth on the annulus; the gradients being linear, the worst depth is
 * one end or the other.
 */
export function maasp(a: AnnulusInput, d: Derating = defaultDerating) {
  const ends = [0, a.bottomTvdFt];
  // (a) Burst of the outer string: Ps + gf·z − gb·z ≤ derated burst.
  const burst = Math.min(...ends.map((z) => d.burst * a.outerBurstPsi - (a.fluidGradient - a.backupGradient) * z));
  // (b) Collapse of the inner string: (Ps + gf·z) − (Pin + gin·z) ≤ derated collapse.
  const collapse = Math.min(...ends.map((z) => d.collapse * a.innerCollapsePsi - a.fluidGradient * z + a.insideSurfacePsi + a.insideGradient * z));
  const limits: { limit: Limit; psi: number }[] = [{ limit: "burst", psi: burst }, { limit: "collapse", psi: collapse }];
  // (c) The formation at an exposed shoe: Ps + gf·z_shoe ≤ fracture pressure.
  if (a.exposedShoe) limits.push({ limit: "formation", psi: d.formation * a.exposedShoe.fracturePsi - a.fluidGradient * a.exposedShoe.tvdFt });
  // (d) The packer's differential: the annulus over the tubing's least pressure at the packer.
  if (a.packerRatingPsi !== undefined) limits.push({ limit: "packer", psi: a.packerRatingPsi - a.fluidGradient * a.bottomTvdFt + a.insideSurfacePsi + a.insideGradient * a.bottomTvdFt });
  const governing = limits.reduce((m, l) => l.psi < m.psi ? l : m);
  return { maaspPsi: Math.max(0, governing.psi), governing: governing.limit, limits };
}

// ── Temperature ───────────────────────────────────────────────────────────────────────────────
export interface RameyInput {
  /** Surface (or seabed) temperature, °F, and the geothermal gradient, °F/ft. */
  readonly surfaceF: number; readonly gradientFPerFt: number;
  /** The producing depth, TVD ft. */
  readonly depthFt: number;
  /** Mass rate, lbm/s; the fluid's heat capacity, Btu/(lbm·°F). */
  readonly massRateLbmS: number; readonly heatCapacity: number;
  /** The rock's conductivity, Btu/(hr·ft·°F), and diffusivity, ft²/hr; the wellbore radius, ft. */
  readonly earthConductivity: number; readonly earthDiffusivity: number; readonly wellRadiusFt: number;
}
/** Ramey's time function, f(t) = ln(2√(αt)/r) − 0.290 (long-time form; held at a small floor early). */
export const rameyF = (diffusivity: number, hours: number, radiusFt: number) => Math.max(0.3, Math.log(2 * Math.sqrt(diffusivity * Math.max(1e-3, hours)) / radiusFt) - 0.29);
/** The relaxation distance A, ft: how far up the fluid carries the bottom-hole temperature. */
export function relaxation(r: RameyInput, hours: number): number {
  const w = r.massRateLbmS * 3600; // lbm/hr
  return w * r.heatCapacity * rameyF(r.earthDiffusivity, hours, r.wellRadiusFt) / (2 * Math.PI * r.earthConductivity);
}
/** The flowing fluid's temperature at a TVD after some hours on production, °F. */
export function flowingTemperature(r: RameyInput, tvdFt: number, hours: number): number {
  const geo = r.surfaceF + r.gradientFPerFt * tvdFt;
  if (r.massRateLbmS <= 0) return geo;
  const A = relaxation(r, hours);
  return geo + r.gradientFPerFt * A * (1 - Math.exp(-(r.depthFt - tvdFt) / A));
}

// ── Pressure build-up ─────────────────────────────────────────────────────────────────────────
/**
 * How much an annulus's volume grows per psi inside it, 1/psi: the outer string balloons out under
 * internal pressure and the inner one is squeezed in (thin-wall, Lamé's leading term), E for steel.
 * Over the free (uncemented) length; a cemented section adds nothing.
 */
export function annulusCompliance(outerIdIn: number, outerWallIn: number, innerOdIn: number, innerWallIn: number, youngPsi = 30e6): number {
  const ro = outerIdIn / 2, ri = innerOdIn / 2;
  const area = ro * ro - ri * ri;
  // dA/A per psi: 2(ro·Δro + ri·|Δri|) / (ro² − ri²) with Δr/r = p r / (E t).
  return 2 * (ro * ro * (ro / (youngPsi * outerWallIn)) + ri * ri * (ri / (youngPsi * innerWallIn))) / area;
}
/** The trapped fluid's pressure rise for an average temperature rise: αΔT / (κ + C). */
export const thermalApb = (deltaTF: number, alphaPerF: number, kappaPerPsi: number, compliancePerPsi: number) => alphaPerF * deltaTF / (kappaPerPsi + compliancePerPsi);

/** Water-based fluids near 150 °F: expansion 2.5×10⁻⁴ /°F, compressibility 2.8×10⁻⁶ /psi. */
export const WATER = { alphaPerF: 2.5e-4, kappaPerPsi: 2.8e-6 } as const;

// ── Calibration: the rock's heat conduction from a temperature survey ─────────────────────────
/**
 * The earth conductivity that makes Ramey's profile fit a flowing temperature survey (DTS, PLT or a
 * gradient run) taken at a known rate and time on production. The data constrain the relaxation
 * distance, w·c·f(t)/(2πk), so with the rate and time known they constrain k. Golden-section on
 * log k; the range is every k whose misfit an F-test (95%, one parameter) cannot tell from the best.
 */
export function calibrateConductivity(base: RameyInput, hours: number, survey: readonly { readonly tvdFt: number; readonly tempF: number }[], bounds: readonly [number, number] = [0.3, 6]) {
  const usable = survey.filter((p) => Number.isFinite(p.tvdFt) && Number.isFinite(p.tempF) && p.tvdFt <= base.depthFt);
  const sse = (k: number) => usable.reduce((s, p) => s + (flowingTemperature({ ...base, earthConductivity: k }, p.tvdFt, hours) - p.tempF) ** 2, 0);
  let lo = Math.log(bounds[0]), hi = Math.log(bounds[1]);
  const g = (Math.sqrt(5) - 1) / 2;
  let a = hi - g * (hi - lo), b = lo + g * (hi - lo), fa = sse(Math.exp(a)), fb = sse(Math.exp(b));
  for (let i = 0; i < 80; i++) {
    if (fa < fb) { hi = b; b = a; fb = fa; a = hi - g * (hi - lo); fa = sse(Math.exp(a)); }
    else { lo = a; a = b; fa = fb; b = lo + g * (hi - lo); fb = sse(Math.exp(b)); }
  }
  const k = Math.exp((lo + hi) / 2), best = sse(k), n = usable.length;
  // F(1, n−1) at 95% is about 3.84 for large n; the bound is SSE ≤ best·(1 + F/(n−1)).
  const limit = best * (1 + 3.84 / Math.max(1, n - 1));
  // Each end of the range: where the misfit climbs through the limit, by bisection on log k (the bound itself if it never does).
  const edge = (to: number) => { if (sse(to) <= limit) return to; let inside = Math.log(k), outside = Math.log(to); for (let i = 0; i < 50; i++) { const mid = (inside + outside) / 2; if (sse(Math.exp(mid)) <= limit) inside = mid; else outside = mid; } return Math.exp(inside); };
  return { k, rmsF: Math.sqrt(best / Math.max(1, n)), n, range: [edge(bounds[0]), edge(bounds[1])] as const, atBoundary: Math.abs(Math.log(k / bounds[0])) < 0.01 || Math.abs(Math.log(k / bounds[1])) < 0.01 };
}

// ── Sustained casing pressure: the diagnostic test ────────────────────────────────────────────
/**
 * BSEE's limits for a casing pressure (NTL 2009-G01, after API RP 90): MAWOP, the lesser of 50% of
 * the evaluated string's minimum internal yield (MIYP), 80% of the next outer string's MIYP and 75%
 * of the inner string's collapse; and the share of MIYP above which a pressure must be diagnosed
 * (10% on the A annulus, except under active gas lift; 20% on the outer annuli).
 */
export function casingPressureLimits(input: { readonly annulus: string; readonly miypPsi: number; readonly nextOuterMiypPsi: number | null; readonly innerCollapsePsi: number; readonly gasLift?: boolean }) {
  const candidates = [{ by: "50% of its MIYP", psi: 0.5 * input.miypPsi }, ...(input.nextOuterMiypPsi ? [{ by: "80% of the next outer string's MIYP", psi: 0.8 * input.nextOuterMiypPsi }] : []), { by: "75% of the inner string's collapse", psi: 0.75 * input.innerCollapsePsi }];
  const mawop = candidates.reduce((m, c) => c.psi < m.psi ? c : m);
  const share = input.annulus === "A" ? (input.gasLift ? null : 0.1) : 0.2;
  return { mawopPsi: mawop.psi, mawopBy: mawop.by, diagnoseAbovePsi: share === null ? null : share * input.miypPsi, share };
}

export interface BleedTest { readonly startH: number; readonly endH: number; readonly fromPsi: number; readonly toPsi: number; readonly bledToZero: boolean; readonly hoursToBleed: number; readonly rebuildPsi: number | null; readonly thermalPsi: number; readonly sustained: boolean }
/**
 * Every bleed-down in a pressure record (a fall of more than half to under 15% of where it started,
 * within a day), and the 24 hours after it: how far it built back, against how far heat alone
 * could build it over the same hours (`thermalAt`, the thermal pressure at a time on production).
 * Building back more than heat explains, by more than 100 psi and 10% of the starting pressure,
 * is sustained casing pressure: something is feeding the annulus.
 */
export function bleedTests(hours: readonly number[], psi: readonly (number | null)[], thermalAt: (h: number) => number): BleedTest[] {
  const out: BleedTest[] = [];
  const at = (h: number) => { let best: number | null = null, d = Infinity; for (let i = 0; i < hours.length; i++) { const v = psi[i]; if (v === null || v === undefined) continue; const dd = Math.abs(hours[i]! - h); if (dd < d) { d = dd; best = v; } } return d <= 2 ? best : null; };
  for (let i = 1; i < hours.length; i++) {
    const p0 = psi[i - 1], p1 = psi[i];
    if (p0 === null || p1 === null || p0 === undefined || p1 === undefined || p1 >= p0 * 0.9 || p0 < 50) continue;
    // A fall starts here: follow it while it keeps falling (or sits near zero), up to 24 hours.
    let j = i, low = p1;
    while (j + 1 < hours.length && hours[j + 1]! - hours[i - 1]! <= 24) { const v = psi[j + 1]; if (v === null || v === undefined || v > low + Math.max(5, 0.02 * p0)) break; low = Math.min(low, v); j++; }
    if (low > 0.15 * p0 || p0 - low < 0.5 * p0) continue;
    // It ends where it first reached its lowest (or zero): sitting at zero afterwards is not bleeding.
    const zero = Math.max(25, 0.03 * p0);
    let k = i;
    while (k < j && (psi[k] ?? Infinity) > Math.max(low, Math.min(zero, p0))) k++;
    if ((psi[k] ?? Infinity) <= zero) low = Math.min(low, psi[k]!);
    const startH = hours[i - 1]!, endH = hours[k]!;
    const after = at(endH + 24);
    const thermal = Math.max(0, thermalAt(endH + 24) - thermalAt(endH));
    const rebuild = after === null ? null : after - low;
    out.push({ startH, endH, fromPsi: p0, toPsi: low, bledToZero: low <= zero, hoursToBleed: endH - startH, rebuildPsi: rebuild, thermalPsi: thermal, sustained: rebuild !== null && rebuild - thermal > Math.max(100, 0.1 * p0) });
    i = j;
  }
  return out;
}
