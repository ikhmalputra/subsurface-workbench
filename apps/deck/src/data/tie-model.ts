/**
 * A well tie: the seismic a well's logs predict, set against the seismic recorded there. Impedance
 * from sonic and density, reflectivity at each change, a time–depth relation from the sonic, a Ricker
 * wavelet convolved in time, and the result laid back on depth beside the PSDM traces at the well.
 * The tie is then a bulk shift and a stretch of the synthetic in depth, scored by correlation.
 * Pure functions: no fetching, so they run anywhere (the tests read them).
 */

const US_PER_FT_TO_S_PER_M = 1e-6 / 0.3048;

/** Acoustic impedance, kg/(m²·s), from slowness (µs/ft) and density (g/cm³); NaN where either is missing. */
export function impedance(dtUsPerFt: ArrayLike<number>, rhoGcc: ArrayLike<number>): Float64Array {
  return Float64Array.from({ length: dtUsPerFt.length }, (_, k) => {
    const dt = dtUsPerFt[k]!, rho = rhoGcc[k]!;
    return Number.isFinite(dt) && Number.isFinite(rho) && dt > 0 ? rho * 1000 / (dt * US_PER_FT_TO_S_PER_M) : NaN;
  });
}

/** Normal-incidence reflection coefficient at the top of each sample; 0 where impedance is missing on either side. */
export function reflectivity(ai: ArrayLike<number>): Float64Array {
  const r = new Float64Array(ai.length);
  for (let k = 1; k < ai.length; k++) { const a = ai[k - 1]!, b = ai[k]!; r[k] = Number.isFinite(a) && Number.isFinite(b) && a + b > 0 ? (b - a) / (b + a) : 0; }
  return r;
}

/**
 * Two-way time below the first sample, seconds, at each sample: the sonic integrated over TVD. A gap
 * in the sonic is bridged with the slowness either side of it.
 */
export function twoWayTime(tvdM: ArrayLike<number>, dtUsPerFt: ArrayLike<number>): Float64Array {
  const n = tvdM.length, t = new Float64Array(n);
  const filled = Float64Array.from({ length: n }, (_, k) => dtUsPerFt[k]!);
  let last = NaN;
  for (let k = 0; k < n; k++) { if (Number.isFinite(filled[k]!)) last = filled[k]!; else filled[k] = last; }
  for (let k = n - 1; k >= 0; k--) { if (Number.isFinite(filled[k]!)) last = filled[k]!; else filled[k] = last; }
  for (let k = 1; k < n; k++) t[k] = t[k - 1]! + 2 * (tvdM[k]! - tvdM[k - 1]!) * (filled[k - 1]! + filled[k]!) / 2 * US_PER_FT_TO_S_PER_M;
  return t;
}

/** A zero-phase Ricker wavelet of peak frequency `hz`, sampled every `dtS` over ±`halfS`. */
export function ricker(hz: number, dtS: number, halfS = 0.064): Float64Array {
  const half = Math.round(halfS / dtS);
  return Float64Array.from({ length: 2 * half + 1 }, (_, i) => { const a = (Math.PI * hz * (i - half) * dtS) ** 2; return (1 - 2 * a) * Math.exp(-a); });
}

/**
 * The synthetic at each depth sample: reflectivity placed in time on a 1 ms grid, convolved with the
 * wavelet, read back at each sample's time. Positive where impedance increases downward (SEG normal);
 * `polarity` −1 reverses it.
 */
export function synthetic(r: ArrayLike<number>, twt: ArrayLike<number>, hz: number, polarity: 1 | -1 = 1): Float64Array {
  const dt = 0.001, n = r.length;
  const m = Math.ceil(twt[n - 1]! / dt) + 2;
  const series = new Float64Array(m);
  for (let k = 0; k < n; k++) { const at = twt[k]! / dt, i = Math.floor(at), f = at - i; series[i] = series[i]! + r[k]! * (1 - f); series[i + 1] = series[i + 1]! + r[k]! * f; }
  const w = ricker(hz, dt), half = (w.length - 1) / 2;
  const trace = new Float64Array(m);
  for (let i = 0; i < m; i++) { if (!series[i]) continue; for (let j = 0; j < w.length; j++) { const at = i + j - half; if (at >= 0 && at < m) trace[at] = trace[at]! + series[i]! * w[j]!; } }
  return Float64Array.from({ length: n }, (_, k) => { const at = twt[k]! / dt, i = Math.floor(at), f = at - i; return polarity * ((trace[i] ?? 0) * (1 - f) + (trace[i + 1] ?? 0) * f); });
}

/** Pearson correlation of two equally long series, skipping pairs where either is missing; NaN with fewer than 8 pairs. */
export function correlation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    n++; sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y;
  }
  if (n < 8) return NaN;
  const va = saa - sa * sa / n, vb = sbb - sb * sb / n;
  return va > 0 && vb > 0 ? (sab - sa * sb / n) / Math.sqrt(va * vb) : NaN;
}

/** Where a synthetic sample lands once shifted and stretched: about the top of the logs, in seismic depth. */
export interface Fit { readonly shiftM: number; readonly stretch: number }
export const placed = (depthM: number, topM: number, fit: Fit) => topM + (depthM - topM) * fit.stretch + fit.shiftM;

/**
 * The synthetic resampled at the seismic's depth samples under a fit: depths are the synthetic's own
 * (seismic depth of each log sample), `at` the seismic samples' depths. NaN outside the logged interval.
 */
export function onSeismic(syn: ArrayLike<number>, depths: ArrayLike<number>, at: ArrayLike<number>, fit: Fit): Float64Array {
  const top = depths[0]!, step = (depths[depths.length - 1]! - top) / Math.max(1, depths.length - 1);
  return Float64Array.from({ length: at.length }, (_, s) => {
    const z = top + (at[s]! - fit.shiftM - top) / fit.stretch;
    const k = (z - top) / step, i = Math.floor(k), f = k - i;
    return i < 0 || i >= depths.length - 1 ? NaN : syn[i]! * (1 - f) + syn[i + 1]! * f;
  });
}

/**
 * The fit that best matches the seismic near `around`: bulk shift (m) and stretch searched together
 * within `range` of it, scored by correlation. Kept local on purpose: a wide search can lock the
 * synthetic onto the wrong cycle, so the person puts it near the event and the search refines.
 */
export function bestFit(syn: ArrayLike<number>, depths: ArrayLike<number>, seismic: ArrayLike<number>, at: ArrayLike<number>, range = { shiftM: 80, stretch: 0.06 }, around: Fit = { shiftM: 0, stretch: 1 }): Fit & { readonly r: number } {
  let best = { shiftM: around.shiftM, stretch: around.stretch, r: -Infinity };
  for (let stretch = around.stretch - range.stretch; stretch <= around.stretch + range.stretch + 1e-9; stretch += 0.005) {
    for (let shiftM = Math.round(around.shiftM - range.shiftM); shiftM <= around.shiftM + range.shiftM; shiftM += 1) {
      const r = correlation(onSeismic(syn, depths, at, { shiftM, stretch }), seismic);
      if (r > best.r) best = { shiftM, stretch: Math.round(stretch * 1000) / 1000, r };
    }
  }
  return best;
}
