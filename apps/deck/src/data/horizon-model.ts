import type { SeismicCube } from "@ikhmalputra/subsurface-core";

/**
 * Horizon autotracking on a seismic cube: from a seed on a reflector, follow the same peak (or
 * trough) trace to neighbouring trace, best match first, accepting a step only where the waveform
 * around it correlates with the trace it came from. The result is a grid of depths, one per trace,
 * in fractional samples, NaN where the reflector could not be followed. Pure: runs anywhere.
 */

export type Polarity = "peak" | "trough";
export interface TrackOptions {
  readonly polarity: Polarity;
  /** How far, in samples, the reflector may move from one trace to the next. */
  readonly search: number;
  /** Half the waveform compared between traces, in samples. */
  readonly window: number;
  /** The least correlation a step needs. */
  readonly minCorrelation: number;
}
export const defaultTrack: TrackOptions = { polarity: "peak", search: 3, window: 5, minCorrelation: 0.7 };

const at = (cube: SeismicCube, a: number, o: number, s: number) => cube.counts[(s * cube.offsetCount + o) * cube.alongCount + a]!;

/** The nearest sample within `reach` of `s` that is a local extremum of the polarity, refined to a fraction of a sample by a parabola. */
export function snap(cube: SeismicCube, a: number, o: number, s: number, polarity: Polarity, reach = 4): number | null {
  const sign = polarity === "peak" ? 1 : -1;
  let best: number | null = null, bestValue = -Infinity;
  for (let d = 0; d <= reach; d++) for (const k of d === 0 ? [s] : [s - d, s + d]) {
    if (k < 1 || k >= cube.sampleCount - 1) continue;
    const v = sign * at(cube, a, o, k);
    if (v > 0 && v >= sign * at(cube, a, o, k - 1) && v >= sign * at(cube, a, o, k + 1) && (best === null || Math.abs(k - s) < Math.abs(best - s) || (Math.abs(k - s) === Math.abs(best - s) && v > bestValue))) { best = k; bestValue = v; }
  }
  if (best === null) return null;
  const y0 = at(cube, a, o, best - 1), y1 = at(cube, a, o, best), y2 = at(cube, a, o, best + 1);
  const curve = y0 - 2 * y1 + y2;
  return curve === 0 ? best : best + Math.max(-0.5, Math.min(0.5, (y0 - y2) / (2 * curve)));
}

/** Pearson correlation of the waveforms around two samples of two traces. */
function similarity(cube: SeismicCube, a1: number, o1: number, s1: number, a2: number, o2: number, s2: number, half: number): number {
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let k = -half; k <= half; k++) {
    const p = s1 + k, q = s2 + k;
    if (p < 0 || q < 0 || p >= cube.sampleCount || q >= cube.sampleCount) continue;
    const x = at(cube, a1, o1, p), y = at(cube, a2, o2, q);
    n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
  }
  const vx = sxx - sx * sx / n, vy = syy - sy * sy / n;
  return n > 2 && vx > 0 && vy > 0 ? (sxy - sx * sy / n) / Math.sqrt(vx * vy) : 0;
}

/** A max-heap of candidate steps, by correlation: the surest steps are taken first. */
class Heap {
  private readonly items: { readonly score: number; readonly a: number; readonly o: number; readonly s: number }[] = [];
  get size() { return this.items.length; }
  push(item: { score: number; a: number; o: number; s: number }) {
    const h = this.items; h.push(item);
    for (let i = h.length - 1; i > 0;) { const p = (i - 1) >> 1; if (h[p]!.score >= h[i]!.score) break; [h[p], h[i]] = [h[i]!, h[p]!]; i = p; }
  }
  pop() {
    const h = this.items, top = h[0]!, last = h.pop()!;
    if (h.length) {
      h[0] = last;
      for (let i = 0; ;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.length && h[l]!.score > h[m]!.score) m = l; if (r < h.length && h[r]!.score > h[m]!.score) m = r; if (m === i) break; [h[m], h[i]] = [h[i]!, h[m]!]; i = m; }
    }
    return top;
  }
}

export interface Seed { readonly a: number; readonly o: number; readonly s: number }
/** Whether a step from one trace to its neighbour, at a depth sample, is barred (e.g. it crosses a fault). */
export type Barrier = (a: number, o: number, na: number, no: number, s: number) => boolean;

/**
 * Tracks from one or more seeds (along bin, offset bin, sample): a depth in fractional samples for
 * every trace reached, NaN elsewhere. A barrier stops steps across it, so a fault ends the horizon
 * on its side and a seed on the far side carries it on there.
 */
export function track(cube: SeismicCube, seeds: Seed | readonly Seed[], options: TrackOptions = defaultTrack, barrier?: Barrier): Float32Array {
  const grid = new Float32Array(cube.alongCount * cube.offsetCount).fill(NaN);
  const heap = new Heap();
  const offer = (a: number, o: number, s: number) => {
    for (const [da, dof] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const na = a + da, no = o + dof;
      if (na < 0 || no < 0 || na >= cube.alongCount || no >= cube.offsetCount || !Number.isNaN(grid[no * cube.alongCount + na]!)) continue;
      if (barrier?.(a, o, na, no, s)) continue;
      const found = snap(cube, na, no, Math.round(s), options.polarity, options.search);
      if (found === null || Math.abs(found - s) > options.search) continue;
      // Compared at the same rounded place in both traces, moved by the rounded step: rounding each depth
      // on its own would misalign two waveforms either side of a half sample.
      const score = similarity(cube, a, o, Math.round(s), na, no, Math.round(s) + Math.round(found - s), options.window);
      if (score >= options.minCorrelation) heap.push({ score, a: na, o: no, s: found });
    }
  };
  for (const seed of Array.isArray(seeds) ? seeds as readonly Seed[] : [seeds as Seed]) {
    const start = snap(cube, seed.a, seed.o, Math.round(seed.s), options.polarity);
    if (start === null || !Number.isNaN(grid[seed.o * cube.alongCount + seed.a]!)) continue;
    grid[seed.o * cube.alongCount + seed.a] = start;
    offer(seed.a, seed.o, start);
  }
  while (heap.size) {
    const step = heap.pop();
    const k = step.o * cube.alongCount + step.a;
    if (!Number.isNaN(grid[k]!)) continue;
    grid[k] = step.s;
    offer(step.a, step.o, step.s);
  }
  return grid;
}

/** The share of traces a horizon reached. */
export const coverage = (grid: ArrayLike<number>) => { let n = 0; for (let i = 0; i < grid.length; i++) if (!Number.isNaN(grid[i]!)) n++; return n / Math.max(1, grid.length); };

/** A colour ramp for depth on a structure map: shallow warm, deep cool (sRGB, 0–1). */
export function depthColour(t: number): [number, number, number] {
  const stops: readonly (readonly [number, number, number])[] = [[0.99, 0.84, 0.35], [0.98, 0.55, 0.25], [0.86, 0.25, 0.42], [0.47, 0.22, 0.6], [0.17, 0.32, 0.67], [0.1, 0.6, 0.72]];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  const a = stops[i]!, b = stops[i + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
