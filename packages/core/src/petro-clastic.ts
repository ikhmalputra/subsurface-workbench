/**
 * Clastic petrophysics as the interpretation suites run it (Techlog, IP, Geolog): shale volume from
 * gamma ray, shale-corrected density–neutron porosity, water saturation by Archie in clean sand and by
 * Simandoux or Indonesia where clay conducts, Rw read off the Pickett plot or carried to formation
 * temperature, permeability by Timur or Coates from porosity and irreducible saturation, cutoffs to net
 * reservoir and net pay, and a Monte Carlo over the parameters for P90, P50 and P10 with a tornado.
 *
 * Porosity and saturation are fractions; resistivity ohm·m; density g/cm³; temperature °F; depth m.
 */

export type ShaleMethod = "linear" | "larionov-tertiary" | "larionov-older";
export type SaturationModel = "archie" | "simandoux" | "indonesia";

/** Shale volume from the gamma-ray index between the clean and shale lines. */
export function shaleVolume(gr: number, clean: number, shale: number, method: ShaleMethod = "linear"): number {
  const i = Math.max(0, Math.min(1, (gr - clean) / Math.max(1e-6, shale - clean)));
  if (method === "larionov-tertiary") return Math.min(1, 0.083 * (2 ** (3.7 * i) - 1));
  if (method === "larionov-older") return Math.min(1, 0.33 * (2 ** (2 * i) - 1));
  return i;
}

export interface PorosityParams { readonly rhoMatrix: number; readonly rhoFluid: number; readonly rhoShale: number; readonly nphiShale: number }
/**
 * Effective porosity from density and neutron (limestone units, here taken as sandstone-corrected
 * already), each corrected for the shale in it, then combined as √((φD² + φN²)/2): the root mean
 * square reads right in gas, where the neutron falls and the density porosity rises.
 */
export function effectivePorosity(rhob: number, nphi: number, vsh: number, p: PorosityParams): number {
  const phiD = (p.rhoMatrix - rhob) / (p.rhoMatrix - p.rhoFluid);
  const phiDsh = (p.rhoMatrix - p.rhoShale) / (p.rhoMatrix - p.rhoFluid);
  const d = phiD - vsh * phiDsh, n = nphi - vsh * p.nphiShale;
  const phi = Math.sqrt(Math.max(0, (Math.max(0, d) ** 2 + Math.max(0, n) ** 2) / 2));
  return Math.max(0, Math.min(0.45, phi));
}

export interface SaturationParams { readonly a: number; readonly m: number; readonly n: number; readonly rw: number; readonly rsh: number }

/** Water saturation (0–1) by Archie, Simandoux (1963, modified) or Indonesia (Poupon–Leveaux 1971). */
export function waterSaturation(model: SaturationModel, rt: number, phi: number, vsh: number, p: SaturationParams): number {
  if (!(rt > 0) || !(phi > 0)) return 1;
  const archieTerm = phi ** p.m / (p.a * p.rw); // conductance of the clean pores at Sw = 1
  if (model === "archie" || vsh <= 0) return clamp01((1 / (rt * archieTerm)) ** (1 / p.n));
  if (model === "indonesia") {
    const k = vsh ** (1 - vsh / 2) / Math.sqrt(p.rsh) + Math.sqrt(archieTerm);
    return clamp01((1 / (Math.sqrt(rt) * k)) ** (2 / p.n));
  }
  // Simandoux: 1/Rt = (φ^m/(a Rw)) Sw^n + (Vsh/Rsh) Sw, solved by Newton (exact quadratic when n = 2).
  const c = vsh / p.rsh, target = 1 / rt;
  if (Math.abs(p.n - 2) < 1e-9) return clamp01((-c + Math.sqrt(c * c + 4 * archieTerm * target)) / (2 * archieTerm));
  let sw = 0.5;
  for (let i = 0; i < 40; i++) { const f = archieTerm * sw ** p.n + c * sw - target, df = p.n * archieTerm * sw ** (p.n - 1) + c; const next = clamp01(sw - f / df); if (Math.abs(next - sw) < 1e-10) { sw = next; break; } sw = next; }
  return sw;
}
const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 1));

/** Rw carried from one temperature to another (Arps, °F). */
export const rwAtTemperature = (rw: number, fromF: number, toF: number) => rw * (fromF + 6.77) / (toF + 6.77);

/**
 * The Pickett plot's water line, log Rt = log(a Rw) − m log φ, fitted to the points of a water zone:
 * least squares on log–log, the lower envelope taken by keeping the points at or under the median
 * residual of a first fit (hydrocarbon raises Rt, never lowers it).
 */
export function pickettFit(points: readonly { readonly phi: number; readonly rt: number }[]): { aRw: number; m: number } | null {
  const pts = points.filter((p) => p.phi > 0.03 && p.rt > 0).map((p) => ({ x: Math.log10(p.phi), y: Math.log10(p.rt) }));
  const fit = (q: readonly { x: number; y: number }[]) => {
    const n = q.length, mx = q.reduce((s, p) => s + p.x, 0) / n, my = q.reduce((s, p) => s + p.y, 0) / n;
    const sxx = q.reduce((s, p) => s + (p.x - mx) ** 2, 0), slope = sxx > 0 ? q.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx : 0;
    return { slope, intercept: my - slope * mx };
  };
  if (pts.length < 5) return null;
  const first = fit(pts), resid = pts.map((p) => p.y - (first.intercept + first.slope * p.x)), median = [...resid].sort((a, b) => a - b)[Math.floor(resid.length / 2)]!;
  const low = pts.filter((_, i) => resid[i]! <= median);
  const line = fit(low.length >= 5 ? low : pts);
  return { aRw: 10 ** line.intercept, m: -line.slope };
}

/** Permeability, mD: Timur (1968), k = 0.136 φ%^4.4 / Swi%²; Coates (1981), k = [100 φ² (1 − Swi) / Swi]². */
export function permeability(model: "timur" | "coates", phi: number, swi: number): number {
  const s = Math.max(0.01, Math.min(1, swi));
  if (model === "timur") return 0.136 * (phi * 100) ** 4.4 / (s * 100) ** 2;
  return (100 * phi * phi * (1 - s) / s) ** 2;
}
/** Irreducible water saturation from a constant bulk volume of water at irreducible (Buckles). */
export const irreducibleSw = (phi: number, bvwIrr: number) => Math.min(1, bvwIrr / Math.max(1e-3, phi));

export interface Cutoffs { readonly vsh: number; readonly phi: number; readonly sw: number }
export interface ZoneSample { readonly mdM: number; readonly stepM: number; readonly vsh: number; readonly phi: number; readonly sw: number }
/** Net reservoir (Vsh and φ pass), net pay (and Sw passes), their mean φ and Sw, and the hydrocarbon column Σφ(1−Sw)h. */
export function payOf(samples: readonly ZoneSample[], cut: Cutoffs) {
  let gross = 0, net = 0, pay = 0, phiNet = 0, swPay = 0, phiPay = 0, column = 0;
  for (const s of samples) {
    if (!Number.isFinite(s.phi) || !Number.isFinite(s.sw) || !Number.isFinite(s.vsh)) continue;
    gross += s.stepM;
    if (s.vsh > cut.vsh || s.phi < cut.phi) continue;
    net += s.stepM; phiNet += s.phi * s.stepM;
    if (s.sw > cut.sw) continue;
    pay += s.stepM; phiPay += s.phi * s.stepM; swPay += s.sw * s.phi * s.stepM; column += s.phi * (1 - s.sw) * s.stepM;
  }
  return { gross, net, pay, ntg: gross ? net / gross : 0, phiNet: net ? phiNet / net : 0, phiPay: pay ? phiPay / pay : 0, swPay: phiPay ? swPay / phiPay : 0, column };
}

/** The raw curves at one depth sample. */
export interface LogSample { readonly mdM: number; readonly gr: number; readonly rt: number; readonly rhob: number; readonly nphi: number }
export interface Interpretation {
  readonly grClean: number; readonly grShale: number; readonly shale: ShaleMethod;
  readonly porosity: PorosityParams;
  readonly model: SaturationModel; readonly sat: SaturationParams;
  readonly cutoffs: Cutoffs;
  readonly perm: "timur" | "coates"; readonly bvwIrr: number;
}
/** One sample interpreted. */
export function interpret(s: LogSample, p: Interpretation) {
  const vsh = shaleVolume(s.gr, p.grClean, p.grShale, p.shale);
  const phi = effectivePorosity(s.rhob, s.nphi, vsh, p.porosity);
  const sw = waterSaturation(p.model, s.rt, phi, vsh, p.sat);
  const swi = irreducibleSw(phi, p.bvwIrr);
  const k = phi > 0.01 ? permeability(p.perm, phi, Math.max(swi, 0.05)) : 0;
  return { mdM: s.mdM, vsh, phi, sw, k, bvw: phi * sw };
}

/** A parameter's range for the Monte Carlo: triangular between low and high about the most likely. */
export interface Range { readonly low: number; readonly mode: number; readonly high: number }
export interface Uncertainty { readonly rw: Range; readonly m: Range; readonly n: Range; readonly rsh: Range; readonly vshCut: Range; readonly phiCut: Range; readonly swCut: Range }

/** A seeded random draw (mulberry32). */
function seeded(seed: number) { let t = seed >>> 0; return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }
/** A triangular draw. */
export function triangular(r: Range, u: number): number {
  const { low: a, mode: c, high: b } = r;
  if (b <= a) return a;
  const f = (c - a) / (b - a);
  return u < f ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c));
}

/**
 * Monte Carlo over Rw, m, n, Rsh and the cutoffs: each run re-interprets the zone's samples and
 * takes its net pay and hydrocarbon column. P90 is the value 90% of runs exceed (the low case), as
 * the industry quotes it. With the tornado: each parameter alone at its low and high, the rest at mode.
 */
export function monteCarloPay(samples: readonly LogSample[], stepM: number, base: Interpretation, u: Uncertainty, runs = 600, seed = 7) {
  const random = seeded(seed);
  const run = (rw: number, m: number, n: number, rsh: number, cut: Cutoffs) => {
    const p: Interpretation = { ...base, sat: { ...base.sat, rw, m, n, rsh }, cutoffs: cut };
    return payOf(samples.map((s) => ({ ...interpret(s, p), stepM })), cut);
  };
  const pays: number[] = [], columns: number[] = [];
  for (let i = 0; i < runs; i++) {
    const r = run(triangular(u.rw, random()), triangular(u.m, random()), triangular(u.n, random()), triangular(u.rsh, random()), { vsh: triangular(u.vshCut, random()), phi: triangular(u.phiCut, random()), sw: triangular(u.swCut, random()) });
    pays.push(r.pay); columns.push(r.column);
  }
  const pct = (xs: number[], exceed: number) => { const sorted = [...xs].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((1 - exceed) * (sorted.length - 1))))]!; };
  const at = (key: keyof Uncertainty, which: "low" | "high") => {
    const v = (k: keyof Uncertainty) => k === key ? u[k][which] : u[k].mode;
    return run(v("rw"), v("m"), v("n"), v("rsh"), { vsh: v("vshCut"), phi: v("phiCut"), sw: v("swCut") }).column;
  };
  const baseColumn = run(u.rw.mode, u.m.mode, u.n.mode, u.rsh.mode, { vsh: u.vshCut.mode, phi: u.phiCut.mode, sw: u.swCut.mode }).column;
  const tornado = (Object.keys(u) as (keyof Uncertainty)[]).map((key) => ({ key, low: at(key, "low"), high: at(key, "high") })).sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low));
  return {
    pay: { p90: pct(pays, 0.9), p50: pct(pays, 0.5), p10: pct(pays, 0.1) },
    column: { p90: pct(columns, 0.9), p50: pct(columns, 0.5), p10: pct(columns, 0.1) },
    pays, columns, base: baseColumn, tornado,
  };
}
