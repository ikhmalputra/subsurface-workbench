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
