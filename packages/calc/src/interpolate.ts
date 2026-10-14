/**
 * Reading a value between two samples, written once.
 *
 * The previous core had four of these — in the trajectory, twice in the seismic projection and
 * again in the pressure lookup — each a slightly different "find the bracketing pair and
 * interpolate", each with its own answer at the ends of the range. Four implementations is four
 * chances for the edges to disagree, and the edges are where a reader notices.
 */

/** Where `at` falls between two keys, clamped to [0, 1]. */
export const fractionBetween = (lower: number, upper: number, at: number): number =>
  upper === lower ? 0 : Math.min(1, Math.max(0, (at - lower) / (upper - lower)));

export interface Bracket<T> { readonly before: T; readonly after: T; readonly fraction: number }

/**
 * The two samples surrounding `at`, and how far between them it lies.
 *
 * Beyond either end the nearest sample is returned on both sides with a fraction of 0 or 1 — the
 * value is clamped, never extrapolated. Extrapolating a survey past its last station invents
 * measured evidence, which is the one thing this project does not do.
 */
export function bracket<T>(samples: readonly T[], key: (sample: T) => number, at: number): Bracket<T> | null {
  if (samples.length === 0) return null;
  const first = samples[0]!, last = samples[samples.length - 1]!;
  if (at <= key(first)) return { before: first, after: first, fraction: 0 };
  if (at >= key(last)) return { before: last, after: last, fraction: 1 };
  // Binary search: a survey is 422 stations and a log is tens of thousands of samples, and this is
  // called per pointer move.
  let low = 0, high = samples.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (key(samples[mid]!) <= at) low = mid; else high = mid;
  }
  const before = samples[low]!, after = samples[high]!;
  return { before, after, fraction: fractionBetween(key(before), key(after), at) };
}

export const lerp = (from: number, to: number, fraction: number): number => from + (to - from) * fraction;
