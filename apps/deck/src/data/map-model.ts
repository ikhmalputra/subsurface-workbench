/**
 * Maps from wells: a surface through scattered points by thin-plate spline (the minimum-curvature
 * surface, smoothed a little so close wells that disagree do not make it ring), sampled on a grid;
 * and on a depth grid, the closure a contact makes: the cells above it connected to a crest, where
 * it spills, and the rock volume between a top, a base and the contact. Depths are positive down.
 * Pure: runs anywhere.
 */

export interface MapPoint { readonly x: number; readonly y: number; readonly z: number }
export interface GridFrame { readonly x0: number; readonly y0: number; readonly cell: number; readonly nx: number; readonly ny: number }

/** Solves a small dense system in place by Gaussian elimination with partial pivoting. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[p]![c]!)) p = r;
    [a[c], a[p]] = [a[p]!, a[c]!]; [b[c], b[p]] = [b[p]!, b[c]!];
    const pivot = a[c]![c]!;
    if (Math.abs(pivot) < 1e-12) continue;
    for (let r = c + 1; r < n; r++) {
      const f = a[r]![c]! / pivot;
      if (!f) continue;
      for (let k = c; k < n; k++) a[r]![k]! -= f * a[c]![k]!;
      b[r]! -= f * b[c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r]!;
    for (let k = r + 1; k < n; k++) sum -= a[r]![k]! * x[k]!;
    x[r] = Math.abs(a[r]![r]!) < 1e-12 ? 0 : sum / a[r]![r]!;
  }
  return x;
}

/**
 * A thin-plate spline through the points: z = a + b·x + c·y + Σ wᵢ·U(|p − pᵢ|), U(r) = r² ln r.
 * `smoothing` (≥ 0, in units of the points' own spread) trades fitting each point exactly for a
 * calmer surface. One point gives a flat surface; two, a plane along them.
 */
export function thinPlate(points: readonly MapPoint[], smoothing = 0.01): (x: number, y: number) => number {
  const n = points.length;
  if (!n) return () => NaN;
  const mx = points.reduce((s, p) => s + p.x, 0) / n, my = points.reduce((s, p) => s + p.y, 0) / n;
  const scale = Math.max(1, ...points.map((p) => Math.hypot(p.x - mx, p.y - my)));
  const u = (x: number, y: number) => [(x - mx) / scale, (y - my) / scale] as const;
  if (n < 3) { const mean = points.reduce((s, p) => s + p.z, 0) / n; return () => mean; }
  const q = points.map((p) => u(p.x, p.y));
  const U = (r2: number) => r2 > 1e-18 ? 0.5 * r2 * Math.log(r2) : 0;
  const size = n + 3;
  const a = Array.from({ length: size }, () => new Array<number>(size).fill(0)), b = new Array<number>(size).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) a[i]![j] = i === j ? smoothing : U((q[i]![0] - q[j]![0]) ** 2 + (q[i]![1] - q[j]![1]) ** 2);
    a[i]![n] = a[n]![i] = 1; a[i]![n + 1] = a[n + 1]![i] = q[i]![0]; a[i]![n + 2] = a[n + 2]![i] = q[i]![1];
    b[i] = points[i]!.z;
  }
  const w = solve(a, b);
  return (x: number, y: number) => {
    const [px, py] = u(x, y);
    let z = w[n]! + w[n + 1]! * px + w[n + 2]! * py;
    for (let i = 0; i < n; i++) z += w[i]! * U((px - q[i]![0]) ** 2 + (py - q[i]![1]) ** 2);
    return z;
  };
}

/** The median distance from each point to its nearest neighbour: the data's own spacing. */
export function spacing(points: readonly { readonly x: number; readonly y: number }[]): number {
  // Wells at one place (a sidetrack, a re-entry) are not neighbours: only distances over a metre count.
  const d = points.map((p, i) => Math.min(...points.filter((_, j) => j !== i).map((q) => Math.hypot(p.x - q.x, p.y - q.y)).filter((v) => v > 1))).filter(Number.isFinite).sort((a, b) => a - b);
  return d.length ? d[Math.floor(d.length / 2)]! : 1000;
}

/**
 * A surface that honours every point but does not invent structure away from them: a plane fitted
 * through all the points (the regional dip), plus the thin-plate spline of what is left over,
 * held within the least and greatest that the points themselves leave over, and faded out with
 * distance from the nearest point over `reach` (by default one and a half times the points' own
 * spacing). Near the wells it is the spline; far from them, the regional plane. A spline alone
 * overshoots between sparse wells and runs away beyond them: highs and lows no well has seen.
 */
export function trendSurface(given: readonly MapPoint[], reach = 1.5 * spacing(given)): (x: number, y: number) => number {
  // Wells at one place give one point, at their mean depth: two depths at one place would break the spline.
  const merged = new Map<string, MapPoint[]>();
  for (const p of given) { const key = `${Math.round(p.x)},${Math.round(p.y)}`; merged.set(key, [...(merged.get(key) ?? []), p]); }
  const points = [...merged.values()].map((group) => ({ x: group[0]!.x, y: group[0]!.y, z: group.reduce((s, p) => s + p.z, 0) / group.length }));
  const n = points.length;
  if (n < 3) return thinPlate(points);
  // The plane by least squares, through the normal equations.
  const mx = points.reduce((s, p) => s + p.x, 0) / n, my = points.reduce((s, p) => s + p.y, 0) / n, mz = points.reduce((s, p) => s + p.z, 0) / n;
  let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;
  for (const p of points) { const dx = p.x - mx, dy = p.y - my, dz = p.z - mz; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; sxz += dx * dz; syz += dy * dz; }
  const det = sxx * syy - sxy * sxy;
  const gx = Math.abs(det) > 1e-9 ? (sxz * syy - syz * sxy) / det : 0, gy = Math.abs(det) > 1e-9 ? (syz * sxx - sxz * sxy) / det : 0;
  const plane = (x: number, y: number) => mz + gx * (x - mx) + gy * (y - my);
  const left = points.map((p) => ({ x: p.x, y: p.y, z: p.z - plane(p.x, p.y) }));
  const residual = thinPlate(left, 0), lo = Math.min(...left.map((p) => p.z)), hi = Math.max(...left.map((p) => p.z));
  return (x: number, y: number) => {
    let d = Infinity;
    for (const p of points) d = Math.min(d, Math.hypot(p.x - x, p.y - y));
    return plane(x, y) + Math.exp(-((d / reach) ** 2)) * Math.min(hi, Math.max(lo, residual(x, y)));
  };
}

/** The nodes within `reach` of a point: where a map made from those points rests on them. */
export function supportOf(frame: GridFrame, points: readonly { readonly x: number; readonly y: number }[], reach: number): Uint8Array {
  const mask = new Uint8Array(frame.nx * frame.ny);
  for (let j = 0; j < frame.ny; j++) for (let i = 0; i < frame.nx; i++) {
    const x = frame.x0 + i * frame.cell, y = frame.y0 + j * frame.cell;
    if (points.some((p) => Math.hypot(p.x - x, p.y - y) <= reach)) mask[j * frame.nx + i] = 1;
  }
  return mask;
}

/** A frame around the points, padded, with about `cells` cells along its longer side. */
export function frameAround(points: readonly { readonly x: number; readonly y: number }[], cells = 96, pad = 0.12): GridFrame {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(x1 - x0, y1 - y0, 1000), margin = span * pad, cell = (span + 2 * margin) / cells;
  const nx = Math.max(2, Math.ceil((x1 - x0 + 2 * margin) / cell) + 1), ny = Math.max(2, Math.ceil((y1 - y0 + 2 * margin) / cell) + 1);
  return { x0: x0 - margin, y0: y0 - margin, cell, nx, ny };
}

/** A function sampled at every node of a frame, row by row from y0 (south) up. */
export function sample(frame: GridFrame, f: (x: number, y: number) => number): Float32Array {
  const out = new Float32Array(frame.nx * frame.ny);
  for (let j = 0; j < frame.ny; j++) for (let i = 0; i < frame.nx; i++) out[j * frame.nx + i] = f(frame.x0 + i * frame.cell, frame.y0 + j * frame.cell);
  return out;
}

/** From a node, uphill (shallower) step by step to a crest: the local high the node drains up to, without leaving the supported nodes when a mask is given. */
export function crestFrom(top: ArrayLike<number>, frame: GridFrame, start: number, support?: Uint8Array): number {
  let at = start;
  // From outside the support (a click on the dimmed map), start at the nearest node inside it.
  if (support && !support[at] && support.includes(1)) {
    const si = start % frame.nx, sj = Math.floor(start / frame.nx);
    let best = Infinity;
    for (let k = 0; k < support.length; k++) if (support[k]) { const d = (k % frame.nx - si) ** 2 + (Math.floor(k / frame.nx) - sj) ** 2; if (d < best) { best = d; at = k; } }
  }
  for (;;) {
    const i = at % frame.nx, j = Math.floor(at / frame.nx);
    let best = at;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= frame.nx || jj >= frame.ny) continue;
      const k = jj * frame.nx + ii;
      if (support && !support[k]) continue;
      if (top[k]! < top[best]!) best = k;
    }
    if (best === at) return at;
    at = best;
  }
}

/**
 * The closure at a contact: the nodes shallower than it connected (side by side) to the crest, and
 * whether it leaks: reaches the map's edge or, given a support mask, runs out of the area the map
 * rests on, where nothing says it closes.
 */
export function closure(top: ArrayLike<number>, frame: GridFrame, crest: number, contact: number, support?: Uint8Array): { readonly mask: Uint8Array; readonly cells: number; readonly leaks: boolean } {
  const mask = new Uint8Array(frame.nx * frame.ny);
  if (!(top[crest]! < contact)) return { mask, cells: 0, leaks: false };
  const stack = [crest];
  mask[crest] = 1;
  let cells = 0, leaks = false;
  while (stack.length) {
    const k = stack.pop()!;
    cells++;
    const i = k % frame.nx, j = Math.floor(k / frame.nx);
    if (i === 0 || j === 0 || i === frame.nx - 1 || j === frame.ny - 1) leaks = true;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= frame.nx || jj >= frame.ny) continue;
      const m = jj * frame.nx + ii;
      if (mask[m] || !(top[m]! < contact)) continue;
      if (support && !support[m]) { leaks = true; continue; }
      mask[m] = 1; stack.push(m);
    }
  }
  return { mask, cells, leaks };
}

/** The spill depth: the deepest contact whose closure stays off the map's edge, to a metre. Null when even the crest leaks. */
export function spillDepth(top: ArrayLike<number>, frame: GridFrame, crest: number, support?: Uint8Array): number | null {
  let lo = top[crest]!, hi = Math.max(...Array.from(top));
  if (closure(top, frame, crest, lo + 0.5, support).leaks) return null;
  if (!closure(top, frame, crest, hi + 1, support).leaks) return hi;
  while (hi - lo > 1) { const mid = (lo + hi) / 2; if (closure(top, frame, crest, mid, support).leaks) hi = mid; else lo = mid; }
  return lo;
}

/** Rock volume (m³) inside the closure between the top, the base (top + thickness) and the contact. */
export function grossRockVolume(top: ArrayLike<number>, thickness: ArrayLike<number>, frame: GridFrame, mask: Uint8Array, contact: number): number {
  let sum = 0;
  for (let k = 0; k < mask.length; k++) if (mask[k]) sum += Math.max(0, Math.min(top[k]! + Math.max(0, thickness[k]!), contact) - top[k]!);
  return sum * frame.cell * frame.cell;
}

/** Rock volume against contact depth, for `count` contacts from the crest down to `deepest`: the curve a Monte Carlo reads from. */
export function volumeCurve(top: ArrayLike<number>, thickness: ArrayLike<number>, frame: GridFrame, crest: number, deepest: number, count = 48, support?: Uint8Array): { readonly contacts: Float64Array; readonly volumes: Float64Array } {
  const contacts = new Float64Array(count), volumes = new Float64Array(count), from = top[crest]!;
  if (!(deepest > from)) { contacts.fill(from); return { contacts, volumes }; }
  for (let c = 0; c < count; c++) {
    const contact = from + (deepest - from) * c / (count - 1);
    contacts[c] = contact;
    volumes[c] = grossRockVolume(top, thickness, frame, closure(top, frame, crest, contact, support).mask, contact);
  }
  return { contacts, volumes };
}

/** Reads a curve at x, linearly; clamped at its ends. */
export function readCurve(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number): number {
  const n = xs.length;
  if (x <= xs[0]! || xs[n - 1]! <= xs[0]!) return ys[0]!;
  if (x >= xs[n - 1]!) return ys[n - 1]!;
  let i = 1;
  while (xs[i]! < x) i++;
  const t = (x - xs[i - 1]!) / (xs[i]! - xs[i - 1]!);
  return ys[i - 1]! + t * (ys[i]! - ys[i - 1]!);
}

/**
 * Where a level meets the grid, as polylines in map units (marching squares, segments chained end to
 * end): e.g. a contact's outline round its closure. With a mask, only cells touching it are traced.
 */
export function levelLines(z: ArrayLike<number>, frame: GridFrame, level: number, mask?: Uint8Array): [number, number][][] {
  const key = (x: number, y: number) => `${x.toFixed(3)},${y.toFixed(3)}`;
  const segments: [[number, number], [number, number]][] = [];
  const at = (i: number, j: number) => z[j * frame.nx + i]!;
  const cross = (p1: number, q1: number, p2: number, q2: number): [number, number] => {
    // Each edge is read from the same end whichever cell it is reached from, so shared points match exactly.
    const [i1, j1, i2, j2] = q1 * frame.nx + p1 < q2 * frame.nx + p2 ? [p1, q1, p2, q2] : [p2, q2, p1, q1];
    const a = at(i1, j1), b = at(i2, j2), t = (level - a) / (b - a);
    return [frame.x0 + (i1 + (i2 - i1) * t) * frame.cell, frame.y0 + (j1 + (j2 - j1) * t) * frame.cell];
  };
  for (let j = 0; j + 1 < frame.ny; j++) for (let i = 0; i + 1 < frame.nx; i++) {
    if (mask && !(mask[j * frame.nx + i] || mask[j * frame.nx + i + 1] || mask[(j + 1) * frame.nx + i] || mask[(j + 1) * frame.nx + i + 1])) continue;
    const corners = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]] as const;
    const points: [number, number][] = [];
    for (let e = 0; e < 4; e++) {
      const [i1, j1] = corners[e]!, [i2, j2] = corners[(e + 1) % 4]!;
      if ((at(i1, j1) < level) !== (at(i2, j2) < level)) points.push(cross(i1, j1, i2, j2));
    }
    // A node exactly on the level gives a segment of no length: nothing to draw.
    const add = (p: [number, number], q: [number, number]) => { if (key(...p) !== key(...q)) segments.push([p, q]); };
    if (points.length === 2) add(points[0]!, points[1]!);
    else if (points.length === 4) { add(points[0]!, points[1]!); add(points[2]!, points[3]!); }
  }
  // Chain: from each unused segment, follow shared end points both ways.
  const ends = new Map<string, number[]>();
  segments.forEach(([a, b], s) => { for (const p of [a, b]) { const k = key(...p); ends.set(k, [...(ends.get(k) ?? []), s]); } });
  const used = new Uint8Array(segments.length), lines: [number, number][][] = [];
  for (let s = 0; s < segments.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const line: [number, number][] = [segments[s]![0], segments[s]![1]];
    for (const forward of [true, false]) {
      for (;;) {
        const tip = forward ? line.at(-1)! : line[0]!;
        const next = (ends.get(key(...tip)) ?? []).find((other) => !used[other]);
        if (next === undefined) break;
        used[next] = 1;
        const [a, b] = segments[next]!, far = key(...a) === key(...tip) ? b : a;
        if (forward) line.push(far); else line.unshift(far);
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * The highs on the map that close: nodes shallower than all eight neighbours, inside the support,
 * whose closure spills before it leaks, with at least `minRelief` metres from crest to spill,
 * one per structure. Largest relief first: the map's prospects.
 */
export function closedHighs(top: ArrayLike<number>, frame: GridFrame, support?: Uint8Array, minRelief = 10): { readonly crest: number; readonly depth: number; readonly spill: number }[] {
  const out: { crest: number; depth: number; spill: number }[] = [];
  for (let j = 1; j + 1 < frame.ny; j++) for (let i = 1; i + 1 < frame.nx; i++) {
    const k = j * frame.nx + i;
    if (support && !support[k]) continue;
    let high = true;
    for (let dj = -1; dj <= 1 && high; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && !(top[k]! < top[k + dj * frame.nx + di]!)) { high = false; break; }
    if (!high) continue;
    const spill = spillDepth(top, frame, k, support);
    if (spill !== null && spill - top[k]! >= minRelief) out.push({ crest: k, depth: top[k]!, spill });
  }
  // Peaks of one structure share its closure: keep the shallowest of each, largest relief first.
  out.sort((a, b) => (b.spill - b.depth) - (a.spill - a.depth) || a.depth - b.depth);
  const kept: { crest: number; depth: number; spill: number }[] = [], taken: Uint8Array[] = [];
  for (const high of out) {
    if (taken.some((mask) => mask[high.crest])) continue;
    kept.push(high);
    taken.push(closure(top, frame, high.crest, high.spill - 0.5, support).mask);
  }
  return kept;
}
