/**
 * Induced seismicity from a hydraulic stimulation, as the geothermal and unconventional industry
 * models it before and during pumping:
 *
 * - The in-situ stress tensor (vertical, maximum and minimum horizontal) and pore pressure by depth.
 * - A population of pre-existing fractures, oriented in sets and sized by a power law; each one's
 *   normal and shear stress, and the pore-pressure rise that brings it to Coulomb failure
 *   (τ = μ(σn − p) + c).
 * - A hydraulic fracture opening normal to the minimum stress from the stage, its area growing with
 *   the volume pumped, and the pressure diffusing from its faces into the rock (one-dimensional
 *   diffusion from a constant-pressure face, switched off at shut-in by superposition).
 * - An event where and when the pressure rise first reaches a fracture's critical pressure: the
 *   Kaiser effect follows (a fracture slips once; re-pumping triggers nothing new until the
 *   pressure exceeds what it was), and so does the trailing seismicity after shut-in.
 * - Its magnitude from the slipped area (a circular crack, Eshelby: M0 = 16/7 Δσ r³), so the
 *   Gutenberg–Richter b-value follows from the fracture-size exponent.
 * - The catalogue read as a monitoring team reads it: Aki's maximum-likelihood b, the seismogenic
 *   index Σ (Shapiro), the probability of exceeding a magnitude in the volume still to pump, and the
 *   traffic light.
 *
 * SI inside (metres, seconds, pascals) except stresses at depth, which come in psi from the logs and
 * are converted once. Local frame: x east, y north, z up (metres), origin where the caller sets it.
 */

const PSI = 6894.757;

/** A seeded random generator (mulberry32) with normal and uniform draws. */
export function seededRandom(seed: number) {
  let t = seed >>> 0;
  const next = () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  return { next, normal: () => { const u = Math.max(1e-12, next()), v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); } };
}

// ── Stress ────────────────────────────────────────────────────────────────────────────────────
export interface StressField {
  /** Gradients below the depth reference, psi/ft: vertical stress, minimum horizontal stress, pore pressure. */
  readonly svGrad: number;
  readonly shminGrad: number;
  readonly ppGrad: number;
  /** Where SHmax sits between Shmin and Sv: SHmax = Shmin + ratio (Sv − Shmin); 0–1 is normal to strike-slip. */
  readonly shmaxRatio: number;
  /** SHmax azimuth, degrees clockwise from north. */
  readonly shmaxAzimuthDeg: number;
  /** Elevation of the depth reference (TVD 0), metres. */
  readonly datumElevationM: number;
}

/** Principal stresses and pore pressure at an elevation, pascals. */
export function stressAt(field: StressField, zM: number) {
  const tvdFt = (field.datumElevationM - zM) * 3.28084;
  const sv = field.svGrad * tvdFt * PSI, sh = field.shminGrad * tvdFt * PSI, pp = field.ppGrad * tvdFt * PSI;
  return { sv, sH: sh + field.shmaxRatio * (sv - sh), sh, pp };
}

/** The horizontal unit vectors along SHmax and Shmin. */
const horizontalAxes = (azimuthDeg: number) => {
  const a = azimuthDeg * Math.PI / 180;
  return { h1: [Math.sin(a), Math.cos(a), 0] as const, h2: [Math.cos(a), -Math.sin(a), 0] as const };
};

/**
 * Normal and shear stress on a plane with unit normal n (pascals): the traction t = S·n with S the
 * principal stress tensor, σn = n·t, τ = |t − σn n|.
 */
export function tractionOn(field: StressField, zM: number, n: readonly [number, number, number]) {
  const s = stressAt(field, zM), { h1, h2 } = horizontalAxes(field.shmaxAzimuthDeg);
  const d1 = n[0] * h1[0] + n[1] * h1[1], d2 = n[0] * h2[0] + n[1] * h2[1], d3 = n[2];
  const t = [s.sH * d1 * h1[0] + s.sh * d2 * h2[0], s.sH * d1 * h1[1] + s.sh * d2 * h2[1], s.sv * d3];
  const sigmaN = t[0]! * n[0] + t[1]! * n[1] + t[2]! * n[2];
  const tau = Math.sqrt(Math.max(0, t[0]! ** 2 + t[1]! ** 2 + t[2]! ** 2 - sigmaN ** 2));
  return { sigmaN, tau, pp: s.pp };
}

/** Unit normal of a plane from its strike and dip (right-hand rule: dip to the right of strike), x east, y north, z up. */
export function normalOf(strikeDeg: number, dipDeg: number): [number, number, number] {
  const s = strikeDeg * Math.PI / 180, d = dipDeg * Math.PI / 180;
  // The dip direction is strike + 90°; the normal tilts away from it by the dip.
  return [Math.sin(s + Math.PI / 2) * Math.sin(d), Math.cos(s + Math.PI / 2) * Math.sin(d), Math.cos(d)];
}

/** The pore-pressure rise that brings a plane to Coulomb failure, pascals (≤ 0: it is already critically stressed). */
export function criticalPressure(sigmaN: number, tau: number, pp: number, mu: number, cohesionPa = 0): number {
  return sigmaN - pp - (tau - cohesionPa) / mu;
}

// ── Fractures ─────────────────────────────────────────────────────────────────────────────────
export interface FractureSet { readonly strikeDeg: number; readonly dipDeg: number; readonly kappa: number; readonly weight: number }
export interface Fracture {
  readonly x: number; readonly y: number; readonly z: number;
  readonly normal: readonly [number, number, number];
  readonly strikeDeg: number; readonly dipDeg: number;
  readonly radiusM: number;
  readonly mu: number;
  /** Pore-pressure rise to failure, pascals (a slightly critical fracture keeps a small positive value). */
  readonly criticalPa: number;
  readonly sigmaN: number; readonly tau: number; readonly pp: number;
}

export interface FractureInput {
  readonly field: StressField;
  readonly center: { readonly x: number; readonly y: number; readonly z: number };
  /** Half-sizes of the box the fractures fill, metres. */
  readonly half: { readonly x: number; readonly y: number; readonly z: number };
  readonly count: number;
  readonly sets: readonly FractureSet[];
  /** Radius range, metres, and the exponent of the size density n(r) ∝ r^−exponent (3 gives b ≈ 1). */
  readonly radiusMinM: number; readonly radiusMaxM: number; readonly sizeExponent: number;
  readonly muMean: number; readonly muSd: number; readonly cohesionPa?: number;
  /** Relative fracture density by elevation, 0–1 (e.g. the FMI's fracture intensity). */
  readonly densityAt?: (zM: number) => number;
  readonly seed?: number;
}

/** A Fisher-distributed pole about a mean pole (κ: concentration, larger is tighter). */
function fisherPole(mean: readonly [number, number, number], kappa: number, random: ReturnType<typeof seededRandom>): [number, number, number] {
  const u = random.next(), w = 1 + Math.log(u + (1 - u) * Math.exp(-2 * kappa)) / kappa, v = Math.sqrt(Math.max(0, 1 - w * w)), phi = 2 * Math.PI * random.next();
  // A basis about the mean.
  const a: [number, number, number] = Math.abs(mean[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e1 = normalise(cross(mean, a)), e2 = cross(mean, e1);
  return normalise([w * mean[0] + v * (Math.cos(phi) * e1[0] + Math.sin(phi) * e2[0]), w * mean[1] + v * (Math.cos(phi) * e1[1] + Math.sin(phi) * e2[1]), w * mean[2] + v * (Math.cos(phi) * e1[2] + Math.sin(phi) * e2[2])]);
}
const cross = (a: readonly number[], b: readonly number[]): [number, number, number] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const normalise = (v: readonly number[]): [number, number, number] => { const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1; return [v[0]! / l, v[1]! / l, v[2]! / l]; };

/** Strike and dip back from an upward-pointing normal. */
export function strikeDipOf(n: readonly [number, number, number]): { strikeDeg: number; dipDeg: number } {
  const up = n[2] < 0 ? [-n[0], -n[1], -n[2]] : n;
  const dip = Math.acos(Math.max(-1, Math.min(1, up[2]!))) * 180 / Math.PI;
  const dipDir = Math.atan2(up[0]!, up[1]!) * 180 / Math.PI;
  return { strikeDeg: ((dipDir - 90) % 360 + 360) % 360, dipDeg: dip };
}

/** The pre-existing fractures around the stages, with each one's stress state and critical pressure. */
export function generateFractures(input: FractureInput): Fracture[] {
  const random = seededRandom(input.seed ?? 11), out: Fracture[] = [];
  const total = input.sets.reduce((s, set) => s + set.weight, 0) || 1;
  const a = input.sizeExponent - 1, r0 = input.radiusMinM, r1 = input.radiusMaxM;
  let guard = 0;
  while (out.length < input.count && guard++ < input.count * 20) {
    const x = input.center.x + (random.next() * 2 - 1) * input.half.x, y = input.center.y + (random.next() * 2 - 1) * input.half.y, z = input.center.z + (random.next() * 2 - 1) * input.half.z;
    if (input.densityAt && random.next() > input.densityAt(z)) continue;
    let pick = random.next() * total, set = input.sets[0]!;
    for (const s of input.sets) { pick -= s.weight; if (pick <= 0) { set = s; break; } }
    const normal = fisherPole(normalOf(set.strikeDeg, set.dipDeg), set.kappa, random);
    // Truncated power law by inverse transform: P(R > r) ∝ r^−a between r0 and r1.
    const u = random.next(), radiusM = (r0 ** -a - u * (r0 ** -a - r1 ** -a)) ** (-1 / a);
    const mu = Math.max(0.2, input.muMean + input.muSd * random.normal());
    const { sigmaN, tau, pp } = tractionOn(input.field, z, normal);
    const pc = criticalPressure(sigmaN, tau, pp, mu, input.cohesionPa ?? 0);
    // Already at failure: these slip at the first touch of pressure (a few kPa).
    const criticalPa = pc > 0 ? pc : 5e3 * (1 + random.next());
    out.push({ x, y, z, normal, ...strikeDipOf(normal), radiusM, mu, criticalPa, sigmaN, tau, pp });
  }
  return out;
}

// ── Pressure ──────────────────────────────────────────────────────────────────────────────────
/** Complementary error function (Abramowitz & Stegun 7.1.26, |error| < 1.5×10⁻⁷). */
export function erfc(x: number): number {
  const z = Math.abs(x), t = 1 / (1 + 0.3275911 * z);
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z * z);
  return x >= 0 ? y : 2 - y;
}

export interface Stage {
  readonly id: string;
  readonly label: string;
  /** Centre of the stage interval in the local frame, metres. */
  readonly center: { readonly x: number; readonly y: number; readonly z: number };
  /** Pumping: start and end, seconds from the job's start; rate, m³/s. */
  readonly startS: number;
  readonly endS: number;
  readonly rateM3s: number;
}

export interface PressureModel {
  readonly field: StressField;
  /** Hydraulic diffusivity of the fractured rock, m²/s. */
  readonly diffusivity: number;
  /** Net pressure in the hydraulic fracture over the minimum stress, pascals. */
  readonly netPressurePa: number;
  /** Fraction of the pumped volume that stays in the fracture as width (fluid efficiency), and its mean width, m. */
  readonly efficiency: number;
  readonly widthM: number;
  /** "fracture": a hydraulic fracture grows along SHmax; "point": pressure diffuses from the stage centre alone. */
  readonly mode: "fracture" | "point";
}

/** The hydraulic fracture's radius at a time: its area holds the stored share of the volume pumped so far. */
export function fractureRadius(model: PressureModel, stage: Stage, tS: number): number {
  const pumped = stage.rateM3s * Math.max(0, Math.min(tS, stage.endS) - stage.startS);
  return Math.sqrt(model.efficiency * pumped / (Math.PI * model.widthM));
}

/**
 * The pore-pressure rise at a point and time from one stage, pascals. From the fracture's faces (or
 * the stage centre), pressure held at the fracture's level diffuses into the rock as from a face at
 * constant pressure, erfc(d / 2√(Dτ)), where τ counts from when the growing fracture reached the
 * point's nearest place on it; at shut-in the face is switched off by superposing the opposite step.
 */
export function pressureRise(model: PressureModel, stage: Stage, p: { readonly x: number; readonly y: number; readonly z: number }, tS: number): number {
  return stageRiser(model, stage)(p, tS);
}

/** The same, with the stage's constants worked out once: what the simulation calls millions of times. */
export function stageRiser(model: PressureModel, stage: Stage) {
  const s = stressAt(model.field, stage.center.z);
  const source = Math.max(0, s.sh + model.netPressurePa - s.pp);
  const { h1, h2 } = horizontalAxes(model.field.shmaxAzimuthDeg);
  const full = fractureRadius(model, stage, stage.endS), pump = stage.endS - stage.startS, D = model.diffusivity, cx = stage.center.x, cy = stage.center.y, cz = stage.center.z;
  const k = Math.sqrt(model.efficiency * stage.rateM3s / (Math.PI * model.widthM));
  return (p: { readonly x: number; readonly y: number; readonly z: number }, tS: number) => {
    if (tS <= stage.startS) return 0;
    const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
    let d: number, arrival = stage.startS;
    if (model.mode === "point") d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    else {
      const along = dx * h1[0] + dy * h1[1], across = dx * h2[0] + dy * h2[1], inPlane = Math.sqrt(along * along + dz * dz);
      const radius = k * Math.sqrt(Math.max(0, Math.min(tS, stage.endS) - stage.startS));
      const gap = inPlane - radius;
      d = gap > 0 ? Math.sqrt(across * across + gap * gap) : Math.abs(across);
      if (full > 0) { const reach = inPlane < radius ? inPlane : radius, f = reach / full; arrival = stage.startS + pump * f * f; }
    }
    const on = tS - arrival;
    if (on <= 0) return 0;
    let rise = erfc(d / (2 * Math.sqrt(D * on)));
    if (tS > stage.endS) rise -= erfc(d / (2 * Math.sqrt(D * (tS - stage.endS))));
    return rise > 0 ? source * rise : 0;
  };
}

// ── Events ────────────────────────────────────────────────────────────────────────────────────
export interface SeismicEvent { readonly tS: number; readonly x: number; readonly y: number; readonly z: number; readonly mw: number; readonly fracture: number; readonly stage: string }

/** Moment magnitude of a circular crack of radius r slipping with a stress drop (Eshelby; Hanks–Kanamori). */
export const momentMagnitude = (radiusM: number, stressDropPa: number) => (2 / 3) * (Math.log10(16 / 7 * stressDropPa * radiusM ** 3) - 9.1);

/**
 * The job, step by step: each fracture slips the first time the pressure rise where it is reaches
 * its critical pressure (summed over the stages pumped so far). Once slipped it is spent: the Kaiser
 * effect. Returns the events in time order and the largest rise each fracture saw.
 */
export function simulateStimulation(fractures: readonly Fracture[], stages: readonly Stage[], model: PressureModel, options: { readonly untilS?: number; readonly steps?: number; readonly times?: readonly number[]; readonly stressDropPa?: number }) {
  const events: SeismicEvent[] = [], slipped = new Uint8Array(fractures.length), peak = new Float64Array(fractures.length);
  const drop = options.stressDropPa ?? 1e6;
  const times = options.times ?? Array.from({ length: options.steps ?? 200 }, (_, k) => (k + 1) * (options.untilS ?? 0) / (options.steps ?? 200));
  // Only fractures some stage's pressure can reach by the end: the fracture's full radius plus four
  // diffusion lengths (erfc(2) is 0.5%). The rest are skipped, which is most of a wide population.
  // A stage's pressure is followed to ten times its pumping time after shut-in; by then the rise has
  // spread and fallen to a small share of the source and the next stage is days away.
  const until = times.length ? times[times.length - 1]! : 0;
  const windowEnd = stages.map((stage) => Math.min(until, stage.endS + 10 * (stage.endS - stage.startS)));
  const reach = stages.map((stage, j) => ({ stage, r: (model.mode === "fracture" ? fractureRadius(model, stage, stage.endS) : 0) + 4 * Math.sqrt(model.diffusivity * Math.max(0, windowEnd[j]! - stage.startS)) }));
  const live: number[] = [], earliest = new Float64Array(fractures.length).fill(Infinity);
  for (let i = 0; i < fractures.length; i++) {
    const f = fractures[i]!;
    for (const { stage, r } of reach) {
      const dist = Math.hypot(f.x - stage.center.x, f.y - stage.center.y, f.z - stage.center.z);
      if (dist > r) continue;
      // The pressure cannot be felt before four diffusion lengths beyond the full fracture cover the gap.
      const gap = Math.max(0, dist - (model.mode === "fracture" ? fractureRadius(model, stage, stage.endS) : 0));
      earliest[i] = Math.min(earliest[i]!, stage.startS + (gap / 4) ** 2 / model.diffusivity);
    }
    if (earliest[i]! < Infinity) live.push(i);
  }
  const risers = stages.map((stage) => stageRiser(model, stage));
  for (const t of times) {
    for (const i of live) {
      if (slipped[i] || t < earliest[i]!) continue;
      const f = fractures[i]!;
      let rise = 0, best = 0, from = stages[0]!;
      for (let j = 0; j < stages.length; j++) { if (t <= stages[j]!.startS || t > windowEnd[j]!) continue; const r = risers[j]!(f, t); if (r > best) { best = r; from = stages[j]!; } rise += r; }
      if (rise > peak[i]!) peak[i] = rise;
      if (rise >= f.criticalPa) {
        slipped[i] = 1;
        events.push({ tS: t, x: f.x, y: f.y, z: f.z, mw: momentMagnitude(f.radiusM, drop), fracture: i, stage: from.id });
      }
    }
  }
  return { events, peak };
}

/** Time steps for a job: dense while each stage pumps and just after, sparser in the gaps between stages. */
export function jobTimes(stages: readonly Stage[], untilS: number, perStage = 90): number[] {
  const out = new Set<number>();
  for (const stage of stages) {
    const pump = stage.endS - stage.startS;
    for (let k = 1; k <= perStage; k++) out.add(stage.startS + pump * k / perStage);
    // After shut-in: geometric steps out to ten times the pumping time.
    for (let k = 1; k <= perStage / 2; k++) out.add(stage.endS + pump * 10 * (k / (perStage / 2)) ** 2);
  }
  return [...out].filter((t) => t > 0 && t <= untilS).sort((a, b) => a - b);
}

// ── Reading the catalogue ─────────────────────────────────────────────────────────────────────
/** Magnitude of completeness by maximum curvature (the most populated 0.1 bin), plus a correction. */
export function completeness(mags: readonly number[], bin = 0.1, correction = 0.2): number {
  if (!mags.length) return NaN;
  const counts = new Map<number, number>();
  for (const m of mags) { const b = Math.round(m / bin); counts.set(b, (counts.get(b) ?? 0) + 1); }
  let best = 0, most = -1;
  for (const [b, c] of counts) if (c > most || (c === most && b < best)) { most = c; best = b; }
  return best * bin + correction;
}

/** Aki's maximum-likelihood b-value above a completeness magnitude (Utsu's binning correction). */
export function bValue(mags: readonly number[], mc: number, bin = 0.1): { b: number; n: number; sigma: number } {
  const above = mags.filter((m) => m >= mc - 1e-9);
  const n = above.length;
  if (n < 2) return { b: NaN, n, sigma: NaN };
  const mean = above.reduce((s, m) => s + m, 0) / n;
  const b = Math.LOG10E / (mean - (mc - bin / 2));
  return { b, n, sigma: b / Math.sqrt(n) };
}

/** Shapiro's seismogenic index from the events above a magnitude and the volume injected, m³: Σ = log N(≥M) − log V + bM. */
export const seismogenicIndex = (countAbove: number, volumeM3: number, b: number, magnitude: number) => Math.log10(Math.max(1, countAbove)) - Math.log10(volumeM3) + b * magnitude;

/** The probability that a further volume brings at least one event of a magnitude or more (Poisson). */
export const exceedance = (sigma: number, b: number, magnitude: number, volumeM3: number) => 1 - Math.exp(-(10 ** (sigma - b * magnitude)) * volumeM3);

/** The triggering front's diffusivity from events' distances and times: the 95th-percentile distance against √(4πDt), least squares. */
export function frontDiffusivity(events: readonly { readonly tS: number; readonly r: number }[], since = 0): number {
  const pts = events.filter((e) => e.tS > since).map((e) => ({ t: e.tS - since, r: e.r })).sort((a, b) => a.t - b.t);
  if (pts.length < 20) return NaN;
  // The envelope: the 95th percentile of distance within time bins.
  const bins = 10, per = Math.ceil(pts.length / bins), env: { t: number; r: number }[] = [];
  for (let i = 0; i < pts.length; i += per) { const chunk = pts.slice(i, i + per), rs = chunk.map((p) => p.r).sort((a, b) => a - b); env.push({ t: chunk.at(-1)!.t, r: rs[Math.floor(0.95 * (rs.length - 1))]! }); }
  // r² = 4πD t → D = Σ r²t / (4π Σ t²).
  const num = env.reduce((s, p) => s + p.r * p.r * p.t, 0), den = env.reduce((s, p) => s + p.t * p.t, 0);
  return num / (4 * Math.PI * den);
}

export type Light = "green" | "amber" | "red";
/** The traffic light on the largest magnitude so far, with the response a protocol prescribes. */
export function trafficLight(maxMw: number, amber: number, red: number): { light: Light; response: string } {
  if (maxMw >= red) return { light: "red", response: "Stop pumping and bleed off; no restart without review" };
  if (maxMw >= amber) return { light: "amber", response: "Hold or cut the rate; continue only under review" };
  return { light: "green", response: "Continue as planned" };
}
