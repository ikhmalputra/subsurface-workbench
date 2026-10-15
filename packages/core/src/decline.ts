/**
 * Arps decline curves (Arps 1945): exponential (b = 0), hyperbolic (0 < b < 1) and harmonic
 * (b = 1). Time in years, the nominal initial decline Di per year, rates in any unit per day; a
 * cumulative is rate × 365.25 days per year, in that unit.
 */

export interface ArpsDecline {
  /** Rate at t = 0. */
  readonly qi: number;
  /** Nominal initial decline, per year. */
  readonly di: number;
  /** Hyperbolic exponent, 0 (exponential) to 1 (harmonic). */
  readonly b: number;
}

const DAYS_PER_YEAR = 365.25;
const EXPONENTIAL = 1e-6;

/** Rate at time t (years). */
export function arpsRate({ qi, di, b }: ArpsDecline, t: number): number {
  return b < EXPONENTIAL ? qi * Math.exp(-di * t) : qi / Math.pow(1 + b * di * t, 1 / b);
}

/** Volume produced from 0 to t (years): the rate's own unit × days. */
export function arpsCumulative({ qi, di, b }: ArpsDecline, t: number): number {
  const perYear = qi * DAYS_PER_YEAR;
  if (b < EXPONENTIAL) return perYear / di * (1 - Math.exp(-di * t));
  if (Math.abs(b - 1) < EXPONENTIAL) return perYear / di * Math.log(1 + di * t);
  return perYear / ((1 - b) * di) * (1 - Math.pow(1 + b * di * t, (b - 1) / b));
}

/** Years until the rate falls to `rate`; 0 if it is already there, Infinity if it never will. */
export function arpsTimeToRate({ qi, di, b }: ArpsDecline, rate: number): number {
  if (rate >= qi) return 0;
  if (!(rate > 0) || !(di > 0)) return Infinity;
  return b < EXPONENTIAL ? Math.log(qi / rate) / di : (Math.pow(qi / rate, b) - 1) / (b * di);
}

/** Effective annual decline at the start: the share of the rate lost over the first year. */
export const effectiveDecline = (decline: ArpsDecline) => 1 - arpsRate(decline, 1) / decline.qi;

export interface ArpsFit extends ArpsDecline {
  /** Samples used (positive rates only), and the fit's quality in log rate. */
  readonly samples: number;
  readonly rmsLog: number;
  readonly r2Log: number;
}

/**
 * The Arps curve that best fits rates in log space: for each b on a 0.05 grid in [bMin, bMax], Di
 * by a scan then a golden-section refinement, qi in closed form (the mean log residual). Zero and
 * missing rates are left out, not fitted as zero. Null with fewer than three positive rates.
 */
export function fitArps(times: readonly number[], rates: readonly (number | null)[], options: { readonly bMin?: number; readonly bMax?: number } = {}): ArpsFit | null {
  const t: number[] = [], y: number[] = [];
  times.forEach((time, i) => { const q = rates[i]; if (q !== null && q !== undefined && q > 0 && Number.isFinite(time)) { t.push(time); y.push(Math.log(q)); } });
  if (t.length < 3) return null;
  const bMin = Math.max(0, options.bMin ?? 0), bMax = Math.min(1, options.bMax ?? 1);
  const mean = y.reduce((sum, value) => sum + value, 0) / y.length;
  const total = y.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const shape = (b: number, di: number, time: number) => b < EXPONENTIAL ? di * time : Math.log(1 + b * di * time) / b;
  const evaluate = (b: number, di: number) => {
    let lnQi = 0;
    for (let i = 0; i < t.length; i++) lnQi += y[i]! + shape(b, di, t[i]!);
    lnQi /= t.length;
    let sse = 0;
    for (let i = 0; i < t.length; i++) sse += (y[i]! - (lnQi - shape(b, di, t[i]!))) ** 2;
    return { sse, qi: Math.exp(lnQi) };
  };
  let best: { b: number; di: number; sse: number; qi: number } | null = null;
  for (let b = bMin; b <= bMax + 1e-9; b += 0.05) {
    // Di from 1e-4 to 10 per year: a scan, then golden section around the best.
    const lo = Math.log(1e-4), hi = Math.log(10), steps = 60;
    let at = 0, least = Infinity;
    for (let k = 0; k <= steps; k++) { const value = evaluate(b, Math.exp(lo + (hi - lo) * k / steps)).sse; if (value < least) { least = value; at = k; } }
    let a = lo + (hi - lo) * Math.max(0, at - 1) / steps, c = lo + (hi - lo) * Math.min(steps, at + 1) / steps;
    const ratio = (Math.sqrt(5) - 1) / 2;
    let x1 = c - ratio * (c - a), x2 = a + ratio * (c - a), f1 = evaluate(b, Math.exp(x1)).sse, f2 = evaluate(b, Math.exp(x2)).sse;
    for (let k = 0; k < 80; k++) {
      if (f1 < f2) { c = x2; x2 = x1; f2 = f1; x1 = c - ratio * (c - a); f1 = evaluate(b, Math.exp(x1)).sse; }
      else { a = x1; x1 = x2; f1 = f2; x2 = a + ratio * (c - a); f2 = evaluate(b, Math.exp(x2)).sse; }
    }
    const di = Math.exp((a + c) / 2), fit = evaluate(b, di);
    if (!best || fit.sse < best.sse) best = { b: Math.round(b * 100) / 100, di, ...fit };
  }
  return { qi: best!.qi, di: best!.di, b: best!.b, samples: t.length, rmsLog: Math.sqrt(best!.sse / t.length), r2Log: total > 0 ? 1 - best!.sse / total : 1 };
}

/** Days in a calendar month, the month given as year × 12 + (month − 1). */
export function daysInMonth(month: number): number {
  const year = Math.floor(month / 12), m = month % 12;
  return new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
}
