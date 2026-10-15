import stress5832Data from "./forge-58-32-stress.json" with { type: "json" };

/**
 * One-dimensional geomechanics: the stresses at the wall of an inclined borehole and the mud
 * pressures at which it fails, after Fjær et al. (Petroleum Related Rock Mechanics) and Peška &
 * Zoback (1995). Pressures and stresses in psi throughout. The far-field stresses are principal,
 * one vertical: Sv, and SHmax at an azimuth with Shmin across it.
 */

export interface PrincipalStresses {
  readonly svPsi: number;
  readonly shMaxPsi: number;
  readonly shMinPsi: number;
  /** Azimuth of SHmax, degrees from north (grid or true, as the borehole azimuth is). */
  readonly shMaxAzimuthDeg: number;
}
export interface Borehole { readonly inclinationDeg: number; readonly azimuthDeg: number }
export interface RockStrength {
  readonly ucsPsi: number;
  readonly frictionDeg: number;
  readonly tensilePsi: number;
  readonly poisson: number;
}

/** The far-field stress in the borehole's frame: x to the high side, y to its right, z down the hole. */
export function boreholeStresses(stress: PrincipalStresses, hole: Borehole) {
  const r = Math.PI / 180;
  const a = stress.shMaxAzimuthDeg * r, i = hole.inclinationDeg * r, b = hole.azimuthDeg * r;
  // North, east, down.
  const uH = [Math.cos(a), Math.sin(a), 0], uh = [-Math.sin(a), Math.cos(a), 0];
  const S = (p: readonly number[], q: readonly number[]) => stress.shMaxPsi * (p[0]! * uH[0]! + p[1]! * uH[1]!) * (q[0]! * uH[0]! + q[1]! * uH[1]!)
    + stress.shMinPsi * (p[0]! * uh[0]! + p[1]! * uh[1]!) * (q[0]! * uh[0]! + q[1]! * uh[1]!) + stress.svPsi * p[2]! * q[2]!;
  const z = [Math.sin(i) * Math.cos(b), Math.sin(i) * Math.sin(b), Math.cos(i)];
  const x = [Math.cos(i) * Math.cos(b), Math.cos(i) * Math.sin(b), -Math.sin(i)];
  const y = [z[1]! * x[2]! - z[2]! * x[1]!, z[2]! * x[0]! - z[0]! * x[2]!, z[0]! * x[1]! - z[1]! * x[0]!];
  return { sx: S(x, x), sy: S(y, y), sz: S(z, z), txy: S(x, y), tyz: S(y, z), txz: S(x, z) };
}

/** Effective stresses at the wall, θ from the high side, for a mud pressure: hoop, axial, radial and the hoop–axial shear. */
export function wallStresses(far: ReturnType<typeof boreholeStresses>, thetaRad: number, mudPsi: number, porePsi: number, poisson: number) {
  const c2 = Math.cos(2 * thetaRad), s2 = Math.sin(2 * thetaRad);
  return {
    hoop: far.sx + far.sy - 2 * (far.sx - far.sy) * c2 - 4 * far.txy * s2 - mudPsi - porePsi,
    axial: far.sz - 2 * poisson * ((far.sx - far.sy) * c2 + 2 * far.txy * s2) - porePsi,
    radial: mudPsi - porePsi,
    shear: 2 * (far.tyz * Math.cos(thetaRad) - far.txz * Math.sin(thetaRad)),
  };
}

const ANGLES = Array.from({ length: 72 }, (_, k) => k * Math.PI / 36);

/** The greatest and least effective principal stresses anywhere round the wall. */
function wallExtremes(far: ReturnType<typeof boreholeStresses>, mudPsi: number, porePsi: number, poisson: number) {
  let s1 = -Infinity, s3 = Infinity, worst = -Infinity;
  return (q: number, ucs: number) => {
    s1 = -Infinity; s3 = Infinity; worst = -Infinity;
    for (const theta of ANGLES) {
      const w = wallStresses(far, theta, mudPsi, porePsi, poisson);
      const mid = (w.hoop + w.axial) / 2, half = Math.hypot((w.hoop - w.axial) / 2, w.shear);
      const big = Math.max(mid + half, w.radial), small = Math.min(mid - half, w.radial);
      s1 = Math.max(s1, big); s3 = Math.min(s3, small);
      worst = Math.max(worst, big - (ucs + q * small));
    }
    return { s1, s3, worst };
  };
}

/** Does the wall fail in shear (Mohr–Coulomb) anywhere round the hole at this mud pressure? */
export function shearFails(stress: PrincipalStresses, hole: Borehole, rock: RockStrength, mudPsi: number, porePsi: number): boolean {
  const q = (1 + Math.sin(rock.frictionDeg * Math.PI / 180)) / (1 - Math.sin(rock.frictionDeg * Math.PI / 180));
  return wallExtremes(boreholeStresses(stress, hole), mudPsi, porePsi, rock.poisson)(q, rock.ucsPsi).worst > 0;
}

/** Does the wall part in tension anywhere round the hole at this mud pressure? */
export function tensileFails(stress: PrincipalStresses, hole: Borehole, rock: RockStrength, mudPsi: number, porePsi: number): boolean {
  return wallExtremes(boreholeStresses(stress, hole), mudPsi, porePsi, rock.poisson)(1, Infinity).s3 < -rock.tensilePsi;
}

/**
 * The least mud pressure that keeps the wall from failing in shear (breakouts), searched upward
 * from `fromPsi` to `toPsi`: `fromPsi` itself when the wall stands there, null when it fails
 * throughout. The search walks up rather than bisecting the range, because a wall that stands at
 * moderate pressure can fail again at high pressure, in a different mode.
 */
export function collapsePressure(stress: PrincipalStresses, hole: Borehole, rock: RockStrength, porePsi: number, fromPsi: number, toPsi: number): number | null {
  const fails = (mud: number) => shearFails(stress, hole, rock, mud, porePsi);
  if (!fails(fromPsi)) return fromPsi;
  const step = Math.max(1, (toPsi - fromPsi) / 120);
  for (let low = fromPsi, high = fromPsi + step; low < toPsi; low = high, high += step) {
    const top = Math.min(high, toPsi);
    if (fails(top)) continue;
    let a = low, b = top;
    while (b - a > 1) { const mid = (a + b) / 2; if (fails(mid)) a = mid; else b = mid; }
    return b;
  }
  return null;
}

/** The mud pressure at which the wall first parts in tension (fracture initiation), searched up to `toPsi`; null if it holds throughout. */
export function breakdownPressure(stress: PrincipalStresses, hole: Borehole, rock: RockStrength, porePsi: number, toPsi: number): number | null {
  const fails = (mud: number) => tensileFails(stress, hole, rock, mud, porePsi);
  if (!fails(toPsi)) return null;
  let low = porePsi, high = toPsi;
  if (fails(low)) return low;
  while (high - low > 1) { const mid = (low + high) / 2; if (fails(mid)) high = mid; else low = mid; }
  return high;
}

/** Andersonian faulting regime from the three principal stresses. */
export function stressRegime(svPsi: number, shMaxPsi: number, shMinPsi: number): "normal" | "strike-slip" | "reverse" {
  return svPsi >= shMaxPsi ? "normal" : svPsi >= shMinPsi ? "strike-slip" : "reverse";
}

/** Psi per foot of one SG of mud: water at 8.345 ppg is 0.4335 psi/ft. */
export const PSI_PER_FT_PER_SG = 0.4335;

// ── FORGE 58-32 ─────────────────────────────────────────────────────────────────────────────

export interface Stress5832Record {
  readonly source: { readonly url: string; readonly sha256: string; readonly gdr: number };
  readonly note: string;
  readonly mdFt: readonly number[];
  readonly shMaxPsi: readonly (number | null)[];
  readonly shMinPsi: readonly (number | null)[];
  readonly svPsi: readonly (number | null)[];
}
/** 58-32's calibrated stress profile (GDR 1032): SHmax and Shmin from its dipole sonic with a Biot coefficient calibrated to its injection tests, and Sv. */
export const forge5832Stress = stress5832Data as Stress5832Record;
