import type { SeismicCube } from "./seismic.ts";

/**
 * Seismic attributes as the interpretation packages compute them (Petrel, OpendTect):
 *
 * - Instantaneous attributes from the analytic trace (Taner, Koehler & Sheriff 1979): the
 *   envelope (reflection strength), instantaneous phase and instantaneous frequency, by a Hilbert
 *   transform done with an FFT.
 * - RMS amplitude in a sliding window.
 * - Local dip from the gradient structure tensor (the dip that best explains the gradients nearby).
 * - Semblance coherence (Marfurt et al. 1998) over a 3 × 3 trace neighbourhood and a vertical
 *   window, the traces shifted along the local dip so that dipping beds are not mistaken for
 *   discontinuities.
 * - Fault likelihood: the discontinuity (1 − semblance) sharpened and smoothed along the vertical,
 *   then thinned to its ridge across the fault (non-maximum suppression).
 *
 * The cube is indexed as the deck's (along fastest, then offset, then depth sample).
 */

const index = (cube: Pick<SeismicCube, "alongCount" | "offsetCount">, a: number, o: number, s: number) => (s * cube.offsetCount + o) * cube.alongCount + a;

// ── FFT and the analytic trace ────────────────────────────────────────────────────────────────
/** In-place radix-2 FFT (inverse with `inverse`), lengths a power of two. */
export function fft(re: Float64Array, im: Float64Array, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k]!, ai = im[i + k]!, br = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci, bi = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi; re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i]! /= n; im[i]! /= n; }
}

/** The analytic trace's envelope, phase (radians) and frequency (cycles per sample), from one trace. */
export function instantaneous(trace: ArrayLike<number>) {
  const n = trace.length, size = 1 << Math.ceil(Math.log2(Math.max(2, n)));
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let i = 0; i < n; i++) re[i] = trace[i]!;
  fft(re, im);
  // Keep DC and Nyquist, double the positive frequencies, drop the negative ones: the analytic signal.
  for (let k = 1; k < size / 2; k++) { re[k]! *= 2; im[k]! *= 2; }
  for (let k = size / 2 + 1; k < size; k++) { re[k] = 0; im[k] = 0; }
  fft(re, im, true);
  const envelope = new Float32Array(n), phase = new Float32Array(n), frequency = new Float32Array(n);
  for (let i = 0; i < n; i++) { envelope[i] = Math.hypot(re[i]!, im[i]!); phase[i] = Math.atan2(im[i]!, re[i]!); }
  // Frequency as the phase's rate of change, unwrapped, from the analytic signal's derivative (stable where the envelope is small).
  for (let i = 0; i < n; i++) {
    const p = i > 0 ? i - 1 : i, q = i < n - 1 ? i + 1 : i;
    const xr = re[i]!, xi = im[i]!, dr = (re[q]! - re[p]!) / Math.max(1, q - p), di = (im[q]! - im[p]!) / Math.max(1, q - p), e2 = xr * xr + xi * xi;
    frequency[i] = e2 > 1e-12 ? (xr * di - xi * dr) / e2 / (2 * Math.PI) : 0;
  }
  return { envelope, phase, frequency };
}

/** RMS amplitude in a window of 2·half + 1 samples. */
export function rms(trace: ArrayLike<number>, half: number): Float32Array {
  const n = trace.length, out = new Float32Array(n), sq = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sq[i + 1] = sq[i]! + trace[i]! * trace[i]!;
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - half), b = Math.min(n, i + half + 1); out[i] = Math.sqrt((sq[b]! - sq[a]!) / (b - a)); }
  return out;
}

/** Each trace of a cube through a per-trace transform, into a volume of the same shape. */
export function perTrace(cube: SeismicCube, transform: (trace: Float32Array) => Float32Array): Float32Array {
  const out = new Float32Array(cube.counts.length), trace = new Float32Array(cube.sampleCount);
  for (let o = 0; o < cube.offsetCount; o++) for (let a = 0; a < cube.alongCount; a++) {
    for (let s = 0; s < cube.sampleCount; s++) trace[s] = cube.counts[index(cube, a, o, s)]!;
    const t = transform(trace);
    for (let s = 0; s < cube.sampleCount; s++) out[index(cube, a, o, s)] = t[s]!;
  }
  return out;
}

// ── Dip ───────────────────────────────────────────────────────────────────────────────────────
/** Box smoothing of a volume along one axis (0 along, 1 offset, 2 sample), radius r. */
function smoothAxis(v: Float32Array, cube: SeismicCube, axis: 0 | 1 | 2, r: number): Float32Array {
  if (r <= 0) return v;
  const out = new Float32Array(v.length), [na, no, ns] = [cube.alongCount, cube.offsetCount, cube.sampleCount];
  const len = axis === 0 ? na : axis === 1 ? no : ns, stride = axis === 0 ? 1 : axis === 1 ? na : na * no;
  const lines = v.length / len, buf = new Float64Array(len + 1);
  for (let line = 0; line < lines; line++) {
    // The start of this line: walk the other two axes.
    let base: number;
    if (axis === 0) base = line * na;
    else if (axis === 1) { const a = line % na, s = Math.floor(line / na); base = s * na * no + a; }
    else base = line;
    for (let i = 0; i < len; i++) buf[i + 1] = buf[i]! + v[base + i * stride]!;
    for (let i = 0; i < len; i++) { const lo = Math.max(0, i - r), hi = Math.min(len, i + r + 1); out[base + i * stride] = (buf[hi]! - buf[lo]!) / (hi - lo); }
  }
  return out;
}

/**
 * Local dip in samples per trace along and across, from the gradient structure tensor: the dip
 * p that makes the gradient's projection vanish on average, p = −⟨gₓ g_s⟩ / ⟨g_s²⟩, the averages a box
 * of radius `r` traces and `rs` samples.
 */
export function dips(cube: SeismicCube, r = 2, rs = 4) {
  const n = cube.counts.length, na = cube.alongCount, no = cube.offsetCount, ns = cube.sampleCount;
  const gaGs = new Float32Array(n), goGs = new Float32Array(n), gsGs = new Float32Array(n);
  const v = (a: number, o: number, s: number) => cube.counts[index(cube, Math.max(0, Math.min(na - 1, a)), Math.max(0, Math.min(no - 1, o)), Math.max(0, Math.min(ns - 1, s)))]!;
  for (let s = 0; s < ns; s++) for (let o = 0; o < no; o++) for (let a = 0; a < na; a++) {
    const ga = (v(a + 1, o, s) - v(a - 1, o, s)) / 2, go = (v(a, o + 1, s) - v(a, o - 1, s)) / 2, gs = (v(a, o, s + 1) - v(a, o, s - 1)) / 2, i = index(cube, a, o, s);
    gaGs[i] = ga * gs; goGs[i] = go * gs; gsGs[i] = gs * gs;
  }
  const smooth = (x: Float32Array) => smoothAxis(smoothAxis(smoothAxis(x, cube, 0, r), cube, 1, r), cube, 2, rs);
  const A = smooth(gaGs), O = smooth(goGs), S = smooth(gsGs);
  const pa = new Float32Array(n), po = new Float32Array(n);
  for (let i = 0; i < n; i++) { const d = S[i]! > 1e-6 ? S[i]! : 1e-6; pa[i] = Math.max(-3, Math.min(3, -A[i]! / d)); po[i] = Math.max(-3, Math.min(3, -O[i]! / d)); }
  return { pa, po };
}

// ── Coherence and faults ──────────────────────────────────────────────────────────────────────
/**
 * Semblance over the 3 × 3 traces around each sample and 2·half + 1 samples, each neighbour read
 * along the local dip (linear between samples): Σₜ(Σⱼ uⱼ)² / (N Σₜ Σⱼ uⱼ²). 1 where the
 * reflectors carry on, lower across a fault or a fracture zone.
 */
export function semblance(cube: SeismicCube, half = 4, dip?: { readonly pa: Float32Array; readonly po: Float32Array }): Float32Array {
  const na = cube.alongCount, no = cube.offsetCount, ns = cube.sampleCount, out = new Float32Array(cube.counts.length);
  const read = (a: number, o: number, s: number) => {
    if (s <= 0) return cube.counts[index(cube, a, o, 0)]!;
    if (s >= ns - 1) return cube.counts[index(cube, a, o, ns - 1)]!;
    const k = Math.floor(s), f = s - k;
    return cube.counts[index(cube, a, o, k)]! * (1 - f) + cube.counts[index(cube, a, o, k + 1)]! * f;
  };
  for (let s = 0; s < ns; s++) for (let o = 0; o < no; o++) for (let a = 0; a < na; a++) {
    const i = index(cube, a, o, s), pa = dip ? dip.pa[i]! : 0, po = dip ? dip.po[i]! : 0;
    let num = 0, den = 0, traces = 0;
    for (let t = -half; t <= half; t++) {
      let sum = 0, sumSq = 0, count = 0;
      for (let dob = -1; dob <= 1; dob++) for (let da = -1; da <= 1; da++) {
        const aa = a + da, oo = o + dob;
        if (aa < 0 || aa >= na || oo < 0 || oo >= no) continue;
        const u = read(aa, oo, s + t + pa * da + po * dob);
        sum += u; sumSq += u * u; count++;
      }
      num += sum * sum; den += count * sumSq; traces = count;
    }
    out[i] = den > 0 && traces > 1 ? num / den : 1;
  }
  return out;
}

/**
 * Fault likelihood from semblance: (1 − S) raised to a power (only sharp discontinuities survive),
 * smoothed down the fault's height, then kept only where it is a ridge across the fault, in the
 * along or offset direction (non-maximum suppression), so a fault reads as a line, not a smear.
 */
export function faultLikelihood(cube: SeismicCube, sem: Float32Array, power = 6, verticalRadius = 6): Float32Array {
  const na = cube.alongCount, no = cube.offsetCount, ns = cube.sampleCount;
  const raw = new Float32Array(sem.length);
  for (let i = 0; i < sem.length; i++) raw[i] = (1 - Math.min(1, Math.max(0, sem[i]!))) ** power;
  // Stretch the likelihood so the strongest 0.5% reach 1.
  const sorted = Float32Array.from(raw).sort(), top = sorted[Math.floor(0.995 * (sorted.length - 1))]! || 1;
  for (let i = 0; i < raw.length; i++) raw[i] = Math.min(1, raw[i]! / top);
  const smooth = smoothAxis(raw, cube, 2, verticalRadius);
  const out = new Float32Array(sem.length);
  for (let s = 0; s < ns; s++) for (let o = 0; o < no; o++) for (let a = 0; a < na; a++) {
    const i = index(cube, a, o, s), v = smooth[i]!;
    const ridgeA = (a === 0 || v >= smooth[index(cube, a - 1, o, s)]!) && (a === na - 1 || v >= smooth[index(cube, a + 1, o, s)]!);
    const ridgeO = (o === 0 || v >= smooth[index(cube, a, o - 1, s)]!) && (o === no - 1 || v >= smooth[index(cube, a, o + 1, s)]!);
    out[i] = ridgeA || ridgeO ? v : v * 0.25;
  }
  return out;
}

/** A float volume as 0–255 bytes between two values (for drawing and for sending between threads). */
export function toBytes(v: Float32Array, lo: number, hi: number): Uint8Array {
  const out = new Uint8Array(v.length), span = hi - lo || 1;
  for (let i = 0; i < v.length; i++) out[i] = Math.max(0, Math.min(255, Math.round((v[i]! - lo) / span * 255)));
  return out;
}
/** A value's percentile in a volume (from a sample of it). */
export function percentile(v: ArrayLike<number>, q: number, stride = 7): number {
  const sample: number[] = [];
  for (let i = 0; i < v.length; i += stride) if (Number.isFinite(v[i]!)) sample.push(v[i]!);
  sample.sort((a, b) => a - b);
  return sample[Math.min(sample.length - 1, Math.max(0, Math.round(q * (sample.length - 1))))] ?? 0;
}
