import stringWeightsData from "./forge-string-weights.json" with { type: "json" };

/**
 * Soft-string torque and drag (Johancsik, Friesen & Dawson 1984): the string lies on the low side
 * of the hole, stiffness ignored. From the bit up, each element adds its buoyed weight along the
 * hole and, moving, the friction of the side force it presses with:
 *
 *   N  = √[(F·Δa·sin ī)² + (F·Δi + w·ΔL·sin ī)²]
 *   ΔF = w·ΔL·cos ī ± μ·N   (+ picking up, − slacking off, 0 rotating)
 *   ΔT = μ·N·r              (rotating)
 *
 * Oilfield units throughout: feet, pounds, inches, ft-lbf, ppg.
 */

export interface StringSegment {
  /** Length, ft; segments run from the bit upward. */
  readonly lengthFt: number;
  /** Weight in air, lb per ft. */
  readonly weightLbFt: number;
  /** OD that bears on the wall, in (for torque). */
  readonly odIn: number;
}

export interface TorqueDragStation { readonly mdFt: number; readonly inclinationDeg: number; readonly azimuthDeg: number }

export type Movement = "pickup" | "slackoff" | "rotating";

export interface TorqueDragInput {
  readonly survey: readonly TorqueDragStation[];
  /** From the bit up; the last segment runs to surface if the string is longer than the bit depth. */
  readonly string: readonly StringSegment[];
  readonly bitMdFt: number;
  readonly mudWeightPpg: number;
  /** Friction factor above and below the shoe. */
  readonly frictionCased: number;
  readonly frictionOpen: number;
  readonly shoeMdFt: number;
  /** Element length, ft. */
  readonly stepFt?: number;
}

/** Buoyancy of steel (65.5 ppg) in a mud. */
export const buoyancyFactor = (mudWeightPpg: number) => 1 - mudWeightPpg / 65.5;

/** Inclination and azimuth at an MD, straight between stations; azimuth wraps the short way. */
function attitudeAt(survey: readonly TorqueDragStation[], mdFt: number) {
  if (mdFt <= survey[0]!.mdFt) return survey[0]!;
  if (mdFt >= survey.at(-1)!.mdFt) return survey.at(-1)!;
  let low = 0, high = survey.length - 1;
  while (high - low > 1) { const mid = (low + high) >> 1; if (survey[mid]!.mdFt <= mdFt) low = mid; else high = mid; }
  const a = survey[low]!, b = survey[high]!, t = (mdFt - a.mdFt) / (b.mdFt - a.mdFt || 1);
  let dAz = b.azimuthDeg - a.azimuthDeg; if (dAz > 180) dAz -= 360; if (dAz < -180) dAz += 360;
  return { mdFt, inclinationDeg: a.inclinationDeg + t * (b.inclinationDeg - a.inclinationDeg), azimuthDeg: a.azimuthDeg + t * dAz };
}

/** The segment at a distance above the bit, the last one running on to surface. */
function segmentAt(string: readonly StringSegment[], aboveBitFt: number) {
  let top = 0;
  for (const segment of string) { top += segment.lengthFt; if (aboveBitFt < top) return segment; }
  return string.at(-1)!;
}

export interface TorqueDragResult {
  /** Load at surface, lb (block weight not included). */
  readonly hookloadLb: number;
  /** Torque at surface, ft-lbf (rotating only; 0 otherwise). */
  readonly torqueFtLbf: number;
  /** Axial load along the string, from the bit up: MD ft and lb. */
  readonly profile: readonly { readonly mdFt: number; readonly forceLb: number }[];
}

export function torqueDrag(input: TorqueDragInput, movement: Movement): TorqueDragResult {
  const step = input.stepFt ?? 30;
  const bf = buoyancyFactor(input.mudWeightPpg);
  const sign = movement === "pickup" ? 1 : movement === "slackoff" ? -1 : 0;
  const rad = Math.PI / 180;
  let force = 0, torque = 0;
  const profile = [{ mdFt: input.bitMdFt, forceLb: 0 }];
  for (let bottom = input.bitMdFt; bottom > 1e-9;) {
    const top = Math.max(0, bottom - step), length = bottom - top;
    const lower = attitudeAt(input.survey, bottom), upper = attitudeAt(input.survey, top);
    const segment = segmentAt(input.string, input.bitMdFt - (bottom + top) / 2);
    const w = segment.weightLbFt * bf;
    const inc = (lower.inclinationDeg + upper.inclinationDeg) / 2 * rad;
    const dInc = (upper.inclinationDeg - lower.inclinationDeg) * rad, dAz = (upper.azimuthDeg - lower.azimuthDeg) * rad;
    const mu = (bottom + top) / 2 > input.shoeMdFt ? input.frictionOpen : input.frictionCased;
    const normal = Math.hypot(force * dAz * Math.sin(inc), force * dInc + w * length * Math.sin(inc));
    force += w * length * Math.cos(inc) + sign * mu * normal;
    if (movement === "rotating") torque += mu * normal * segment.odIn / 24;
    profile.push({ mdFt: top, forceLb: force });
    bottom = top;
  }
  return { hookloadLb: force, torqueFtLbf: torque, profile };
}

// ── FORGE 16A(78)-32: the daily reports' string weights ──────────────────────────────────────

export interface StringWeightDay {
  readonly date: string;
  readonly report: string;
  readonly mdFt: number | null;
  readonly mudWeightPpg: number | null;
  readonly rotLb: number | null;
  readonly puLb: number | null;
  readonly soLb: number | null;
  readonly torqueFtLbf: number | null;
  /** The last BOP test the report states, as written (MM/DD/YY). */
  readonly lastBopTest?: string | null;
  readonly bha: { readonly description: string | null; readonly lengthFt: number | null; readonly weightAirLb: number | null; readonly weightMudLb: number | null; readonly components: readonly { readonly index: number; readonly component: string; readonly odIn: number | null; readonly idIn: number | null; readonly lengthFt: number | null }[] };
  readonly flags: readonly string[];
}
export interface StringWeightsRecord {
  readonly source: { readonly url: string; readonly sha256: string; readonly gdr: number };
  readonly drillPipe: string;
  readonly note: string;
  readonly days: readonly StringWeightDay[];
}
/** What 16A's daily drilling reports (GDR 1283) say about the string each day. */
export const forgeStringWeights = stringWeightsData as unknown as StringWeightsRecord;

/**
 * A day usable for calibration: a depth, all three weights, a mud weight, and a BHA whose reported
 * length and weight in air make a plausible 20–150 lb/ft; a flagged slack-off leaves that day out of
 * the slack-off fit only.
 */
export function calibrationDays(record: StringWeightsRecord = forgeStringWeights) {
  return record.days.flatMap((day) => {
    const { mdFt, rotLb, puLb, soLb, mudWeightPpg, bha } = day;
    if (mdFt === null || rotLb === null || puLb === null || soLb === null || mudWeightPpg === null || bha.lengthFt === null || bha.weightAirLb === null) return [];
    const perFt = bha.weightAirLb / bha.lengthFt;
    if (bha.lengthFt >= mdFt || perFt < 20 || perFt > 150) return [];
    return [{ ...day, mdFt, rotLb, puLb, soLb, mudWeightPpg, bhaLengthFt: bha.lengthFt, bhaLbFt: perFt, soUsable: day.flags.length === 0 }];
  });
}
export type CalibrationDay = ReturnType<typeof calibrationDays>[number];

/** The day's string: its BHA as one segment of its reported weight, drill pipe above. */
export const dayString = (day: CalibrationDay, pipeLbFt: number, pipeOdIn = 5): StringSegment[] => [
  { lengthFt: day.bhaLengthFt, weightLbFt: day.bhaLbFt, odIn: 6.5 },
  { lengthFt: Math.max(0, day.mdFt - day.bhaLengthFt), weightLbFt: pipeLbFt, odIn: pipeOdIn },
];

export interface Calibration {
  /** Hookload with nothing hanging: travelling block, top drive, links. */
  readonly blockLb: number;
  readonly pipeLbFt: number;
  readonly frictionCased: number;
  readonly frictionOpen: number;
  readonly rmsRotLb: number;
  readonly rmsPuSoLb: number;
  readonly days: number;
}

/**
 * Calibrate on the reports. Rotating, axial friction vanishes, so the rotating weight is the block
 * plus the buoyed string's weight along the hole: linear in the block weight and the pipe weight per
 * foot, solved by least squares. Then the two friction factors (cased, open hole) that best match
 * the pick-up and slack-off weights, by a 0.01 grid search.
 */
export function calibrate(survey: readonly TorqueDragStation[], shoeMdFt: number, days: readonly CalibrationDay[] = calibrationDays()): Calibration {
  const axial = (day: CalibrationDay, pipeLbFt: number) => torqueDrag({ survey, string: dayString(day, pipeLbFt), bitMdFt: day.mdFt, mudWeightPpg: day.mudWeightPpg, frictionCased: 0, frictionOpen: 0, shoeMdFt }, "rotating").hookloadLb;
  // ROT = B + a + p·w, with a the BHA's share and p the pipe's per lb/ft (both buoyed, along the hole).
  const rows = days.map((day) => { const a = axial(day, 0); return { a, p: axial(day, 1) - a, y: day.rotLb }; });
  let sxx = 0, sx = 0, sxy = 0, sy = 0;
  for (const row of rows) { const y = row.y - row.a; sxx += row.p * row.p; sx += row.p; sxy += row.p * y; sy += y; }
  const n = rows.length, pipeLbFt = (n * sxy - sx * sy) / (n * sxx - sx * sx), blockLb = (sy - pipeLbFt * sx) / n;
  const rmsRotLb = Math.sqrt(rows.reduce((sum, row) => sum + (blockLb + row.a + row.p * pipeLbFt - row.y) ** 2, 0) / n);
  const misfit = (fc: number, fo: number) => {
    let sse = 0, count = 0;
    for (const day of days) {
      const input = { survey, string: dayString(day, pipeLbFt), bitMdFt: day.mdFt, mudWeightPpg: day.mudWeightPpg, frictionCased: fc, frictionOpen: fo, shoeMdFt, stepFt: 60 };
      sse += (blockLb + torqueDrag(input, "pickup").hookloadLb - day.puLb) ** 2; count++;
      if (day.soUsable) { sse += (blockLb + torqueDrag(input, "slackoff").hookloadLb - day.soLb) ** 2; count++; }
    }
    return { sse, count };
  };
  // A 0.05 grid over 0.05–0.60, then 0.01 around the best.
  let best = { frictionCased: 0, frictionOpen: 0, sse: Infinity, count: 0 };
  const search = (fcs: readonly number[], fos: readonly number[]) => {
    for (const fc of fcs) for (const fo of fos) {
      const value = misfit(fc, fo);
      if (value.sse < best.sse) best = { frictionCased: Math.round(fc * 100) / 100, frictionOpen: Math.round(fo * 100) / 100, ...value };
    }
  };
  const grid = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, k) => Math.round((from + k * step) * 100) / 100).filter((value) => value >= 0.05 && value <= 0.6);
  search(grid(0.05, 0.6, 0.05), grid(0.05, 0.6, 0.05));
  search(grid(best.frictionCased - 0.04, best.frictionCased + 0.04, 0.01), grid(best.frictionOpen - 0.04, best.frictionOpen + 0.04, 0.01));
  return { blockLb, pipeLbFt, frictionCased: best.frictionCased, frictionOpen: best.frictionOpen, rmsRotLb, rmsPuSoLb: Math.sqrt(best.sse / best.count), days: n };
}
