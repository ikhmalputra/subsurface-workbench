import { type Known, absent, derived, reported } from "@ikhmalputra/subsurface-kernel";
import { DEG, RAD, doglegAngleDeg, normalizeAzimuth, ratioFactor, signedAzimuthChange, tangent } from "./angle.ts";
import { bracket, lerp } from "./interpolate.ts";

/**
 * Where the hole goes, by minimum curvature.
 *
 * The algorithm is carried unchanged from the previous core, where it is pinned against the Utah
 * FORGE 16A(78)-32 survey — 422 observed stations whose published positions it has to reproduce.
 * What is new is the shape around it.
 *
 * A station is a measurement: measured depth, inclination, azimuth. A position is a computation
 * from those, and the two were the same type before, so a view handed a computed position could not
 * tell whether the northing it was drawing had been surveyed or inferred. Here a station holds only
 * what was measured and a `Position` is produced separately, marked `derived`, naming what it came
 * from. A tie-in that was reported stays reported.
 */

export interface Station {
  readonly mdM: number;
  readonly inclinationDeg: number;
  readonly azimuthDeg: number;
}

export interface Position {
  readonly mdM: number;
  readonly tvdM: number;
  readonly northingM: number;
  readonly eastingM: number;
  readonly inclinationDeg: number;
  readonly azimuthDeg: number;
  /** Dogleg across the course that ended here, and the same rate per the course length asked for. */
  readonly doglegDeg: number;
  readonly dlsDegPerCourse: number;
}

export interface TieIn {
  readonly tvdM: number;
  readonly northingM: number;
  readonly eastingM: number;
}

export interface SurveyOptions {
  /** Where the first station sits. Without one the survey starts at the origin, which is a choice. */
  readonly tieIn?: TieIn;
  /** The length doglegs are quoted over. 30 m is the convention; 100 ft appears in US reports. */
  readonly courseLengthM?: number;
}

const ORIGIN: TieIn = { tvdM: 0, northingM: 0, eastingM: 0 };

/** One course: the displacement between two stations, by minimum curvature. */
function course(lengthM: number, from: Station, to: Station) {
  const a = tangent(from.inclinationDeg, from.azimuthDeg);
  const b = tangent(to.inclinationDeg, to.azimuthDeg);
  const dogleg = doglegAngleDeg(from, to);
  const factor = (lengthM / 2) * ratioFactor(dogleg * RAD);
  return {
    northingM: (a[0] + b[0]) * factor,
    eastingM: (a[1] + b[1]) * factor,
    tvdM: (a[2] + b[2]) * factor,
    dogleg,
  };
}

/**
 * Positions for every station.
 *
 * Refuses rather than repairs: a survey whose measured depth does not increase has no course to
 * integrate, and guessing which station was meant would invent geometry.
 */
export function positions(stations: readonly Station[], options: SurveyOptions = {}): Known<readonly Position[]> {
  if (stations.length < 2) return absent("a survey needs at least two stations");
  const courseLengthM = options.courseLengthM ?? 30;
  for (let i = 0; i < stations.length; i++) {
    const station = stations[i]!;
    if (!Number.isFinite(station.mdM) || station.mdM < 0) return absent(`station ${i + 1} has no usable measured depth`);
    if (!(station.inclinationDeg >= 0 && station.inclinationDeg <= 180)) return absent(`station ${i + 1} has an inclination outside 0–180°`);
    if (!Number.isFinite(station.azimuthDeg)) return absent(`station ${i + 1} has no usable azimuth`);
    if (i > 0 && station.mdM <= stations[i - 1]!.mdM) return absent(`station ${i + 1} does not go deeper than the one before it`);
  }
  const tie = options.tieIn ?? ORIGIN;
  const out: Position[] = [{ ...stations[0]!, ...tie, azimuthDeg: normalizeAzimuth(stations[0]!.azimuthDeg), doglegDeg: 0, dlsDegPerCourse: 0 }];
  for (let i = 1; i < stations.length; i++) {
    const from = stations[i - 1]!, to = stations[i]!, previous = out[i - 1]!;
    const lengthM = to.mdM - from.mdM;
    const step = course(lengthM, from, to);
    out.push({
      mdM: to.mdM,
      tvdM: previous.tvdM + step.tvdM,
      northingM: previous.northingM + step.northingM,
      eastingM: previous.eastingM + step.eastingM,
      inclinationDeg: to.inclinationDeg,
      azimuthDeg: normalizeAzimuth(to.azimuthDeg),
      doglegDeg: step.dogleg,
      dlsDegPerCourse: lengthM > 0 ? (step.dogleg * courseLengthM) / lengthM : 0,
    });
  }
  return derived(out, `minimum curvature over ${stations.length} stations${options.tieIn ? ", from the supplied tie-in" : ""}`);
}

/**
 * The position at a measured depth between stations.
 *
 * Linear between the bracketing pair, and clamped at both ends: a depth past the last station is
 * reported at the last station rather than extrapolated, because the survey stops where it stops.
 * The previous core's uncovered interval was explicitly not extrapolated and this keeps that.
 */
export function at(path: readonly Position[], mdM: number): Known<Position> {
  const found = bracket(path, (p) => p.mdM, mdM);
  if (!found) return absent("no survey to read");
  const { before, after, fraction } = found;
  if (before === after) return derived(before, mdM < before.mdM ? "clamped to the first station" : "clamped to the last station");
  const turn = signedAzimuthChange(before.azimuthDeg, after.azimuthDeg);
  return derived({
    mdM,
    tvdM: lerp(before.tvdM, after.tvdM, fraction),
    northingM: lerp(before.northingM, after.northingM, fraction),
    eastingM: lerp(before.eastingM, after.eastingM, fraction),
    inclinationDeg: lerp(before.inclinationDeg, after.inclinationDeg, fraction),
    azimuthDeg: normalizeAzimuth(before.azimuthDeg + turn * fraction),
    doglegDeg: after.doglegDeg * fraction,
    dlsDegPerCourse: after.dlsDegPerCourse,
  }, "interpolated between two survey stations");
}

export interface Summary {
  readonly stations: number;
  readonly totalDepthM: number;
  readonly bottomTvdM: number;
  readonly closureM: number;
  readonly closureAzimuthDeg: number;
  readonly maxDlsDegPerCourse: number;
  /** Where inclination first passes 2°, if it ever does: a vertical well has no kick-off. */
  readonly kickoffMdM: Known<number>;
}

export function summarize(path: readonly Position[]): Known<Summary> {
  if (path.length < 2) return absent("a summary needs at least two positions");
  const last = path[path.length - 1]!, first = path[0]!;
  const north = last.northingM - first.northingM, east = last.eastingM - first.eastingM;
  const kickoff = path.find((p) => p.inclinationDeg > 2);
  return derived({
    stations: path.length,
    totalDepthM: last.mdM,
    bottomTvdM: last.tvdM,
    closureM: Math.hypot(north, east),
    closureAzimuthDeg: normalizeAzimuth(Math.atan2(east, north) * DEG),
    maxDlsDegPerCourse: path.reduce((most, p) => Math.max(most, p.dlsDegPerCourse), 0),
    kickoffMdM: kickoff ? derived(kickoff.mdM, "first station past 2° inclination") : absent("the well never leaves vertical"),
  }, "summarised from the computed path");
}

/** A tie-in a source stated, so the positions built on it keep that citation. */
export const reportedTieIn = (tie: TieIn, document: string, atText?: string): Known<TieIn> =>
  reported(tie, { document, at: atText });
