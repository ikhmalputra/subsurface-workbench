/**
 * Probabilistic in-place volumes: rock volume from the closure a contact makes, times net to gross,
 * porosity and hydrocarbon saturation, over the formation volume factor, each input a triangular
 * range, sampled many times. Results are read the industry's way round: P90 is the volume exceeded
 * in 90% of the runs (the low case), P10 the high case. Seeded, so a range gives the same answer
 * every time. Pure: runs anywhere.
 */

export interface Range { readonly low: number; readonly mode: number; readonly high: number }
export type Fluid = "oil" | "gas";
export interface VolumeInputs {
  /** Rock volume (m³) for a contact depth (m). */
  readonly rock: (contact: number) => number;
  readonly contact: Range;
  readonly ntg: Range;
  readonly porosity: Range;
  /** Water saturation (fraction): hydrocarbon saturation is one minus it. */
  readonly sw: Range;
  /** Bo (rm³/Sm³) for oil, or Bg (rm³/Sm³, ≪ 1) for gas. */
  readonly fvf: Range;
}
export const INPUTS = ["contact", "ntg", "porosity", "sw", "fvf"] as const;
export type InputName = typeof INPUTS[number];

/** A small, fast, seeded random number generator (mulberry32). */
export function random(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** A range typed out of order is still a range: its least, middle and greatest values. */
export function ordered(range: Range): Range {
  const [low, mode, high] = [range.low, range.mode, range.high].sort((x, y) => x - y) as [number, number, number];
  return { low, mode, high };
}

/** The value a triangular range takes at a cumulative probability u (0–1). */
export function triangular(range: Range, u: number): number {
  const { low, mode, high } = ordered(range);
  if (high <= low) return mode;
  const f = (mode - low) / (high - low);
  return u < f ? low + Math.sqrt(u * (high - low) * (mode - low)) : high - Math.sqrt((1 - u) * (high - low) * (high - mode));
}

/** In-place volume (Sm³) for one set of values. */
export function inPlace(rock: number, ntg: number, porosity: number, sw: number, fvf: number): number {
  return fvf > 0 ? rock * Math.max(0, ntg) * Math.max(0, porosity) * Math.max(0, 1 - sw) / fvf : 0;
}

export interface VolumeResult {
  /** Every run's volume (Sm³), smallest first. */
  readonly runs: Float64Array;
  readonly p90: number;
  readonly p50: number;
  readonly p10: number;
  readonly mean: number;
  /** The volume with every input at its most likely value. */
  readonly mostLikely: number;
}

/** The volume exceeded in a share of the runs: exceeded(runs, 0.9) is the P90. */
export const exceeded = (sorted: ArrayLike<number>, share: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((1 - share) * sorted.length)))]!;

const orderedInputs = (inputs: VolumeInputs): VolumeInputs => ({ ...inputs, contact: ordered(inputs.contact), ntg: ordered(inputs.ntg), porosity: ordered(inputs.porosity), sw: ordered(inputs.sw), fvf: ordered(inputs.fvf) });

/** Samples the inputs `runs` times, each independently. */
export function monteCarlo(given: VolumeInputs, runs = 4000, seed = 2026): VolumeResult {
  const inputs = orderedInputs(given);
  const next = random(seed), out = new Float64Array(runs);
  let sum = 0;
  for (let r = 0; r < runs; r++) {
    const contact = triangular(inputs.contact, next());
    const v = inPlace(inputs.rock(contact), triangular(inputs.ntg, next()), triangular(inputs.porosity, next()), triangular(inputs.sw, next()), triangular(inputs.fvf, next()));
    out[r] = v; sum += v;
  }
  out.sort();
  return { runs: out, p90: exceeded(out, 0.9), p50: exceeded(out, 0.5), p10: exceeded(out, 0.1), mean: sum / runs, mostLikely: inPlace(inputs.rock(inputs.contact.mode), inputs.ntg.mode, inputs.porosity.mode, inputs.sw.mode, inputs.fvf.mode) };
}

/**
 * How much each input moves the volume: every other input at its most likely value, this one at the
 * value it takes one time in ten from either end of its range. Largest swing first.
 */
export function tornado(given: VolumeInputs): { readonly name: InputName; readonly low: number; readonly high: number }[] {
  const inputs = orderedInputs(given);
  const at = (name: InputName, u: number | null) => {
    const v = (key: InputName) => key === name && u !== null ? triangular(inputs[key], u) : inputs[key].mode;
    return inPlace(inputs.rock(v("contact")), v("ntg"), v("porosity"), v("sw"), v("fvf"));
  };
  return INPUTS.map((name) => { const a = at(name, 0.1), b = at(name, 0.9); return { name, low: Math.min(a, b), high: Math.max(a, b) }; })
    .sort((x, y) => (y.high - y.low) - (x.high - x.low));
}
