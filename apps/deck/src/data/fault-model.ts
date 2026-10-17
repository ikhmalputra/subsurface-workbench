/**
 * Faults interpreted on a seismic cube as sticks: on an inline (one offset bin), a line of points
 * down the fault, each an along bin and a depth sample (both fractional). Between sticks the fault
 * is interpolated inline to inline, so it can stop a horizon tracker, cut a structure map and give a
 * throw. Pure: runs anywhere.
 */

export interface StickPoint { readonly a: number; readonly s: number }
export interface Stick { readonly o: number; readonly points: readonly StickPoint[] }

/** How far beyond its end points, in samples, a stick is taken to carry on along its end segments. */
const REACH_S = 12;
/** How far beyond the first and last sticks, in offset bins, the fault is taken to carry on. */
const REACH_O = 4;

/** A stick's along position at a depth sample: linear between its points, carried on past its ends a little; null beyond that. */
export function stickAt(stick: Stick, s: number, reach = REACH_S): number | null {
  const p = stick.points;
  if (!p.length) return null;
  if (p.length === 1) return Math.abs(s - p[0]!.s) <= reach ? p[0]!.a : null;
  const along = (u: StickPoint, v: StickPoint) => v.s === u.s ? u.a : u.a + (v.a - u.a) * (s - u.s) / (v.s - u.s);
  if (s < p[0]!.s) return p[0]!.s - s <= reach ? along(p[0]!, p[1]!) : null;
  const last = p.length - 1;
  if (s > p[last]!.s) return s - p[last]!.s <= reach ? along(p[last - 1]!, p[last]!) : null;
  for (let i = 1; i <= last; i++) if (s <= p[i]!.s) return along(p[i - 1]!, p[i]!);
  return null;
}

/** The fault's along position on inline `o` at sample `s`: between the sticks either side, linearly; past the end sticks, the nearest one for a few bins. */
export function faultAt(sticks: readonly Stick[], o: number, s: number): number | null {
  if (!sticks.length) return null;
  let below: Stick | null = null, above: Stick | null = null;
  for (const stick of sticks) {
    if (stick.o <= o && (!below || stick.o > below.o)) below = stick;
    if (stick.o >= o && (!above || stick.o < above.o)) above = stick;
  }
  if (below && above) {
    const p = stickAt(below, s), q = stickAt(above, s);
    if (p === null || q === null) return p ?? q;
    return above.o === below.o ? p : p + (q - p) * (o - below.o) / (above.o - below.o);
  }
  const end = (below ?? above)!;
  return Math.abs(o - end.o) <= REACH_O ? stickAt(end, s) : null;
}

/** Whether a step between neighbouring traces at sample `s` crosses the fault: the two traces lie on opposite sides of it. */
export function crosses(sticks: readonly Stick[], a: number, o: number, na: number, no: number, s: number): boolean {
  const f = faultAt(sticks, o, s), g = faultAt(sticks, no, s);
  if (f === null || g === null) return false;
  return (a < f) !== (na < g);
}

/** A stick's points every `n`th of the way down it, by depth. */
function resample(stick: Stick, n: number): StickPoint[] {
  const top = stick.points[0]!.s, base = stick.points.at(-1)!.s;
  return Array.from({ length: n }, (_, i) => { const s = top + (base - top) * i / (n - 1); return { a: stickAt(stick, s, 0) ?? stick.points[0]!.a, s }; });
}

/** The fault as a surface: neighbouring sticks joined by a strip of triangles. Points are [along bin, offset bin, sample]. */
export function faultMesh(sticks: readonly Stick[], n = 12): { readonly points: [number, number, number][]; readonly triangles: number[] } {
  const usable = [...sticks].filter((stick) => stick.points.length >= 2).sort((x, y) => x.o - y.o);
  const points: [number, number, number][] = [], triangles: number[] = [];
  usable.forEach((stick, k) => {
    for (const p of resample(stick, n)) points.push([p.a, stick.o, p.s]);
    if (k === 0) return;
    const r0 = (k - 1) * n, r1 = k * n;
    for (let i = 0; i + 1 < n; i++) triangles.push(r0 + i, r1 + i, r1 + i + 1, r0 + i, r1 + i + 1, r0 + i + 1);
  });
  return { points, triangles };
}

/**
 * Where a tracked horizon meets a fault on one inline: the last trace tracked on one side and the
 * first on the other, with the horizon's depth at each (samples). Null where the horizon does not
 * reach the fault from both sides within `gap` traces.
 */
export function cutOffs(grid: ArrayLike<number>, alongCount: number, o: number, sticks: readonly Stick[], gap = 8): { readonly a1: number; readonly s1: number; readonly a2: number; readonly s2: number } | null {
  let last = -1;
  for (let a = 0; a < alongCount; a++) {
    const s = grid[o * alongCount + a]!;
    if (Number.isNaN(s)) continue;
    if (last >= 0 && a - last <= gap) {
      const p = grid[o * alongCount + last]!;
      const f = faultAt(sticks, o, p), g = faultAt(sticks, o, s);
      if (f !== null && g !== null && last < f && a >= g) return { a1: last, s1: p, a2: a, s2: s };
    }
    last = a;
  }
  return null;
}

/** The fault's throw on a horizon: the median depth step across its cut-offs, inline by inline, in samples; null where it has none. */
export function throwOf(grid: ArrayLike<number>, alongCount: number, offsetCount: number, sticks: readonly Stick[]): { readonly samples: number; readonly inlines: number } | null {
  const steps: number[] = [];
  for (let o = 0; o < offsetCount; o++) { const cut = cutOffs(grid, alongCount, o, sticks); if (cut) steps.push(Math.abs(cut.s2 - cut.s1)); }
  if (!steps.length) return null;
  steps.sort((x, y) => x - y);
  return { samples: steps[Math.floor(steps.length / 2)]!, inlines: steps.length };
}

/**
 * Where the fault cuts a horizon, inline by inline: the fault's along position at the horizon's depth,
 * found where the tracked traces change side of it. Runs of neighbouring inlines come back as separate
 * lines, [along bin, offset bin].
 */
export function faultTrace(grid: ArrayLike<number>, alongCount: number, offsetCount: number, sticks: readonly Stick[]): [number, number][][] {
  const lines: [number, number][][] = [];
  let line: [number, number][] = [];
  for (let o = 0; o < offsetCount; o++) {
    const cut = cutOffs(grid, alongCount, o, sticks, alongCount);
    const at = cut ? faultAt(sticks, o, cut.s1) : null;
    if (at === null) { if (line.length > 1) lines.push(line); line = []; continue; }
    line.push([at, o]);
  }
  if (line.length > 1) lines.push(line);
  return lines;
}

/**
 * A stick point moved onto the fault: the trace within `reach` of where it was clicked, along the
 * inline at that depth, where the fault likelihood peaks, refined between traces by a parabola. It
 * stays where it was when nothing there reads as a fault (the peak under `least`, 0–1).
 */
export function snapToRidge(likelihood: ArrayLike<number>, dims: { readonly alongCount: number; readonly offsetCount: number; readonly sampleCount: number }, scale: number, a: number, o: number, s: number, reach = 3, least = 0.35): { readonly a: number; readonly value: number } | null {
  const si = Math.round(s), ai = Math.round(a);
  if (si < 0 || si >= dims.sampleCount || o < 0 || o >= dims.offsetCount) return null;
  const at = (aa: number) => aa < 0 || aa >= dims.alongCount ? -Infinity : likelihood[(si * dims.offsetCount + o) * dims.alongCount + aa]! / scale;
  let best = ai, value = -Infinity;
  for (let d = -reach; d <= reach; d++) { const v = at(ai + d); if (v > value || (v === value && Math.abs(d) < Math.abs(best - ai))) { value = v; best = ai + d; } }
  if (!(value >= least)) return null;
  const y0 = at(best - 1), y2 = at(best + 1), curve = y0 - 2 * value + y2;
  const shift = Number.isFinite(y0) && Number.isFinite(y2) && curve < 0 ? Math.max(-0.5, Math.min(0.5, (y0 - y2) / (2 * curve))) : 0;
  return { a: best + shift, value };
}
