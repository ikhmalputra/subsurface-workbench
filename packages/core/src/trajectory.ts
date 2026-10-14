import type { SurveyPoint, WellComponent, WellDesign } from "./index.ts";

/**
 * Directional-survey math using the minimum curvature method (API Bulletin D20,
 * SPE-84246). Each course between two stations is a circular arc; positions come
 * from the average of the station unit tangents scaled by the ratio factor
 * RF = 2/β · tan(β/2), where β is the dogleg angle. Inclination is measured from
 * vertical, azimuth clockwise from grid north, and every length is in metres.
 * Dogleg severity is normalised to a 30 m course length unless configured.
 */

export interface SurveyStationInput {
  readonly mdM: number;
  readonly inclinationDeg: number;
  readonly azimuthDeg: number;
}

export interface TieInPoint {
  readonly tvdM: number;
  readonly northingM: number;
  readonly eastingM: number;
}

export interface TrajectoryOptions {
  /** Position of the first station. Defaults to the depth reference origin. */
  readonly tieIn?: TieInPoint;
  /** Azimuth of the vertical-section plane. Defaults to the closure azimuth at the last station. */
  readonly verticalSectionAzimuthDeg?: number;
  /** Course length used to normalise dogleg severity, build and turn rate. Defaults to 30 m. */
  readonly dlsCourseLengthM?: number;
}

export interface ComputedStation extends SurveyPoint {
  readonly courseLengthM: number;
  readonly doglegDeg: number;
  readonly dlsDegPer30m: number;
  readonly buildRateDegPer30m: number;
  readonly turnRateDegPer30m: number;
  readonly verticalSectionM: number;
  readonly closureDistanceM: number;
  readonly closureAzimuthDeg: number;
}

export interface TrajectorySummary {
  readonly totalDepthMdM: number;
  readonly totalDepthTvdM: number;
  readonly closureDistanceM: number;
  readonly closureAzimuthDeg: number;
  readonly verticalSectionAzimuthDeg: number;
  readonly maxInclinationDeg: number;
  readonly maxDlsDegPer30m: number;
  readonly maxDlsMdM: number;
  /**
   * Kickoff: the deepest station still within the tolerance (default 2°) before the inclination
   * rises above it and stays above it for a sustained interval (default 90 m MD, or to TD). A single
   * noisy station in a near-vertical hole is not a kickoff; FORGE wanders up to 2.07° by 369 m and
   * builds from 1,779 m.
   */
  readonly kickoffMdM: number | null;
  readonly stationCount: number;
}

export type TrajectoryIssueSeverity = "error" | "warning";
export interface TrajectoryIssue {
  readonly index: number;
  readonly field: "mdM" | "inclinationDeg" | "azimuthDeg" | "dls";
  readonly severity: TrajectoryIssueSeverity;
  readonly message: string;
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export function normalizeAzimuth(azimuthDeg: number): number {
  return ((azimuthDeg % 360) + 360) % 360;
}

function tangent(inclinationDeg: number, azimuthDeg: number): [number, number, number] {
  const inc = inclinationDeg * RAD;
  const azi = azimuthDeg * RAD;
  return [Math.sin(inc) * Math.cos(azi), Math.sin(inc) * Math.sin(azi), Math.cos(inc)];
}

/** Dogleg angle in degrees between two survey directions. */
export function doglegAngleDeg(from: Pick<SurveyStationInput, "inclinationDeg" | "azimuthDeg">, to: Pick<SurveyStationInput, "inclinationDeg" | "azimuthDeg">): number {
  const i1 = from.inclinationDeg * RAD;
  const i2 = to.inclinationDeg * RAD;
  const cosine = Math.cos(i2 - i1) - Math.sin(i1) * Math.sin(i2) * (1 - Math.cos((to.azimuthDeg - from.azimuthDeg) * RAD));
  return Math.acos(Math.min(1, Math.max(-1, cosine))) * DEG;
}

/** Minimum curvature ratio factor for a dogleg in radians; tends to 1 for straight courses. */
export function ratioFactor(doglegRad: number): number {
  return doglegRad < 1e-7 ? 1 + doglegRad * doglegRad / 12 : 2 / doglegRad * Math.tan(doglegRad / 2);
}

function courseDisplacement(lengthM: number, from: SurveyStationInput, to: SurveyStationInput) {
  const t1 = tangent(from.inclinationDeg, from.azimuthDeg);
  const t2 = tangent(to.inclinationDeg, to.azimuthDeg);
  const factor = lengthM / 2 * ratioFactor(doglegAngleDeg(from, to) * RAD);
  return { northingM: (t1[0] + t2[0]) * factor, eastingM: (t1[1] + t2[1]) * factor, tvdM: (t1[2] + t2[2]) * factor };
}

function signedAzimuthChange(fromDeg: number, toDeg: number) {
  return ((toDeg - fromDeg + 540) % 360) - 180;
}

/** Hard input errors (non-finite, out-of-range, non-increasing MD) plus DLS warnings above `maxDlsDegPer30m`. */
export function validateSurveyStations(stations: readonly SurveyStationInput[], options: { readonly maxDlsDegPer30m?: number; readonly dlsCourseLengthM?: number } = {}): readonly TrajectoryIssue[] {
  const issues: TrajectoryIssue[] = [];
  if (stations.length < 2) issues.push({ index: 0, field: "mdM", severity: "error", message: "A trajectory needs at least two survey stations." });
  stations.forEach((station, index) => {
    if (!Number.isFinite(station.mdM) || station.mdM < 0) issues.push({ index, field: "mdM", severity: "error", message: "Measured depth must be a finite value at or below the depth reference." });
    else if (index > 0 && !(station.mdM > stations[index - 1]!.mdM)) issues.push({ index, field: "mdM", severity: "error", message: "Measured depth must increase from the previous station." });
    if (!Number.isFinite(station.inclinationDeg) || station.inclinationDeg < 0 || station.inclinationDeg > 180) issues.push({ index, field: "inclinationDeg", severity: "error", message: "Inclination must be between 0° (vertical down) and 180°." });
    if (!Number.isFinite(station.azimuthDeg) || station.azimuthDeg < 0 || station.azimuthDeg >= 360) issues.push({ index, field: "azimuthDeg", severity: "error", message: "Azimuth must be from 0° up to (not including) 360°." });
  });
  const limit = options.maxDlsDegPer30m;
  if (limit !== undefined && !issues.some((issue) => issue.severity === "error")) {
    const course = options.dlsCourseLengthM ?? 30;
    for (let index = 1; index < stations.length; index++) {
      const dls = doglegAngleDeg(stations[index - 1]!, stations[index]!) * course / (stations[index]!.mdM - stations[index - 1]!.mdM);
      if (dls > limit + 1e-9) issues.push({ index, field: "dls", severity: "warning", message: `Dogleg severity ${dls.toFixed(2)}°/${course} m exceeds the ${limit}°/${course} m limit.` });
    }
  }
  return Object.freeze(issues.map((issue) => Object.freeze(issue)));
}

/**
 * Compute positions and curvature for survey stations by minimum curvature.
 * Throws `RangeError` if the stations contain errors from `validateSurveyStations`.
 */
export function computeMinimumCurvature(stations: readonly SurveyStationInput[], options: TrajectoryOptions = {}): readonly ComputedStation[] {
  const error = validateSurveyStations(stations).find((issue) => issue.severity === "error");
  if (error) throw new RangeError(`Station ${error.index + 1}: ${error.message}`);
  const course = options.dlsCourseLengthM ?? 30;
  if (!Number.isFinite(course) || course <= 0) throw new RangeError("DLS course length must be finite and positive.");
  const tie = options.tieIn ?? { tvdM: 0, northingM: 0, eastingM: 0 };
  const positions: { tvdM: number; northingM: number; eastingM: number; dogleg: number; length: number }[] = [{ ...tie, dogleg: 0, length: 0 }];
  for (let index = 1; index < stations.length; index++) {
    const from = stations[index - 1]!;
    const to = stations[index]!;
    const length = to.mdM - from.mdM;
    const step = courseDisplacement(length, from, to);
    const previous = positions[index - 1]!;
    positions.push({ tvdM: previous.tvdM + step.tvdM, northingM: previous.northingM + step.northingM, eastingM: previous.eastingM + step.eastingM, dogleg: doglegAngleDeg(from, to), length });
  }
  const last = positions.at(-1)!;
  const sectionAzimuth = options.verticalSectionAzimuthDeg ?? normalizeAzimuth(Math.atan2(last.eastingM - tie.eastingM, last.northingM - tie.northingM) * DEG);
  const sectionCos = Math.cos(sectionAzimuth * RAD);
  const sectionSin = Math.sin(sectionAzimuth * RAD);
  return Object.freeze(stations.map((station, index) => {
    const position = positions[index]!;
    const north = position.northingM - tie.northingM;
    const east = position.eastingM - tie.eastingM;
    const previous = stations[index - 1];
    const perCourse = position.length > 0 ? course / position.length : 0;
    const closure = Math.hypot(north, east);
    return Object.freeze({
      mdM: station.mdM,
      tvdM: position.tvdM,
      northingM: position.northingM,
      eastingM: position.eastingM,
      inclinationDeg: station.inclinationDeg,
      azimuthDeg: station.azimuthDeg,
      courseLengthM: position.length,
      doglegDeg: position.dogleg,
      dlsDegPer30m: position.dogleg * perCourse,
      buildRateDegPer30m: previous ? (station.inclinationDeg - previous.inclinationDeg) * perCourse : 0,
      turnRateDegPer30m: previous ? signedAzimuthChange(previous.azimuthDeg, station.azimuthDeg) * perCourse : 0,
      verticalSectionM: north * sectionCos + east * sectionSin,
      closureDistanceM: closure,
      closureAzimuthDeg: closure < 1e-9 ? 0 : normalizeAzimuth(Math.atan2(east, north) * DEG),
    });
  }));
}

/**
 * Position, inclination and azimuth at any MD between two stations, following the
 * minimum-curvature arc (the tangent is spherically interpolated), so azimuth wraps
 * correctly across north and positions stay on the same arc used for the stations.
 */
export function interpolateSurveyPoint(from: SurveyPoint, to: SurveyPoint, mdM: number): SurveyPoint {
  const length = to.mdM - from.mdM;
  if (length <= 0 || mdM <= from.mdM) return { ...from, mdM: Math.max(mdM, from.mdM) };
  if (mdM >= to.mdM) return to;
  const fraction = (mdM - from.mdM) / length;
  const t1 = tangent(from.inclinationDeg, from.azimuthDeg);
  const t2 = tangent(to.inclinationDeg, to.azimuthDeg);
  const dogleg = doglegAngleDeg(from, to) * RAD;
  let direction: [number, number, number];
  if (dogleg < 1e-9) direction = t1;
  else {
    const a = Math.sin((1 - fraction) * dogleg) / Math.sin(dogleg);
    const b = Math.sin(fraction * dogleg) / Math.sin(dogleg);
    direction = [a * t1[0] + b * t2[0], a * t1[1] + b * t2[1], a * t1[2] + b * t2[2]];
  }
  const horizontal = Math.hypot(direction[0], direction[1]);
  const inclinationDeg = Math.atan2(horizontal, direction[2]) * DEG;
  const azimuthDeg = horizontal < 1e-9 ? (fraction < 0.5 ? from.azimuthDeg : to.azimuthDeg) : normalizeAzimuth(Math.atan2(direction[1], direction[0]) * DEG);
  const step = courseDisplacement(mdM - from.mdM, from, { mdM, inclinationDeg, azimuthDeg });
  return { mdM, tvdM: from.tvdM + step.tvdM, northingM: from.northingM + step.northingM, eastingM: from.eastingM + step.eastingM, inclinationDeg, azimuthDeg };
}

/** Interpolate along a computed or stored survey at a measured depth inside its coverage. */
export function surveyPointAtMd(survey: readonly SurveyPoint[], mdM: number): SurveyPoint {
  const first = survey[0];
  if (!first || !Number.isFinite(mdM) || mdM < first.mdM || mdM > survey.at(-1)!.mdM) throw new RangeError("Survey does not cover measured depth.");
  let low = 0;
  let high = survey.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (survey[middle]!.mdM <= mdM) low = middle;
    else high = middle;
  }
  const lower = survey[low]!;
  if (lower.mdM === mdM) return lower;
  const upper = survey[high]!;
  return upper.mdM === mdM ? upper : interpolateSurveyPoint(lower, upper, mdM);
}

/** Index of the first station of a sustained departure from vertical, or -1 if the well never leaves it. */
export function sustainedDepartureIndex(stations: readonly { readonly mdM: number; readonly inclinationDeg: number }[], toleranceDeg = 2, sustainM = 90): number {
  if (!(toleranceDeg >= 0) || !(sustainM >= 0)) throw new RangeError("Kickoff tolerance and sustained interval must be non-negative.");
  for (let index = 0; index < stations.length; index++) {
    if (stations[index]!.inclinationDeg <= toleranceDeg) continue;
    let sustained = true;
    for (let next = index + 1; next < stations.length && stations[next]!.mdM <= stations[index]!.mdM + sustainM; next++) {
      if (stations[next]!.inclinationDeg <= toleranceDeg) { sustained = false; break; }
    }
    if (sustained) return index;
  }
  return -1;
}

export function summarizeTrajectory(computed: readonly ComputedStation[], options: { readonly kickoffToleranceDeg?: number; readonly kickoffSustainM?: number; readonly verticalSectionAzimuthDeg?: number } = {}): TrajectorySummary {
  const last = computed.at(-1);
  if (!last) throw new RangeError("Cannot summarise an empty trajectory.");
  const departure = sustainedDepartureIndex(computed, options.kickoffToleranceDeg ?? 2, options.kickoffSustainM ?? 90);
  let maxDls = computed[0]!;
  let maxInclination = 0;
  for (const station of computed) {
    if (station.dlsDegPer30m > maxDls.dlsDegPer30m) maxDls = station;
    maxInclination = Math.max(maxInclination, station.inclinationDeg);
  }
  const first = computed[0]!;
  const north = last.northingM - first.northingM;
  const east = last.eastingM - first.eastingM;
  return Object.freeze({
    totalDepthMdM: last.mdM,
    totalDepthTvdM: last.tvdM,
    closureDistanceM: last.closureDistanceM,
    closureAzimuthDeg: last.closureAzimuthDeg,
    verticalSectionAzimuthDeg: options.verticalSectionAzimuthDeg ?? normalizeAzimuth(Math.atan2(east, north) * DEG),
    maxInclinationDeg: maxInclination,
    maxDlsDegPer30m: maxDls.dlsDegPer30m,
    maxDlsMdM: maxDls.mdM,
    kickoffMdM: departure <= 0 ? null : computed[departure - 1]!.mdM,
    stationCount: computed.length,
  });
}

/**
 * Recompute stored positions from their MD / inclination / azimuth and report the
 * largest 3D difference. Useful to show that published coordinates follow minimum curvature.
 */
export function surveyConsistency(survey: readonly SurveyPoint[]): { readonly maxDeviationM: number; readonly atMdM: number } {
  const first = survey[0];
  if (!first) return { maxDeviationM: 0, atMdM: 0 };
  const recomputed = computeMinimumCurvature(survey, { tieIn: first });
  let worst = { maxDeviationM: 0, atMdM: first.mdM };
  survey.forEach((station, index) => {
    const value = recomputed[index]!;
    const deviation = Math.hypot(value.tvdM - station.tvdM, value.northingM - station.northingM, value.eastingM - station.eastingM);
    if (deviation > worst.maxDeviationM) worst = { maxDeviationM: deviation, atMdM: station.mdM };
  });
  return Object.freeze(worst);
}

export interface BuildHoldTarget {
  readonly tvdM: number;
  readonly northingM: number;
  readonly eastingM: number;
}

export interface BuildHoldInput {
  /** MD (= TVD, the well is vertical above it) where the build section starts. */
  readonly kickoffMdM: number;
  readonly buildRateDegPer30m: number;
  /** Target relative to the wellhead / depth reference. */
  readonly target: BuildHoldTarget;
  /** MD to drill past the target along the hold tangent. Defaults to 0. */
  readonly extensionM?: number;
  /** Spacing of generated stations. Defaults to 30 m. */
  readonly stationIntervalM?: number;
}

export interface BuildHoldPlan {
  readonly stations: readonly SurveyStationInput[];
  readonly holdInclinationDeg: number;
  readonly azimuthDeg: number;
  readonly radiusM: number;
  readonly endOfBuildMdM: number;
  readonly endOfBuildTvdM: number;
  readonly holdLengthM: number;
  readonly targetMdM: number;
  readonly targetDisplacementM: number;
  readonly totalDepthMdM: number;
}

/**
 * Solve a two-dimensional build-and-hold ("J") profile that passes through a target.
 * With build radius R = 30·180/(π·BUR), horizontal offset D and depth below kickoff Z,
 * the hold inclination θ satisfies Z·sinθ − (D − R)·cosθ = R, i.e.
 * θ = atan2(D − R, Z) + asin(R / √((D − R)² + Z²)), and hold length = √((D − R)² + Z² − R²).
 */
export function planBuildHold(input: BuildHoldInput): BuildHoldPlan {
  const { kickoffMdM, buildRateDegPer30m, target } = input;
  const interval = input.stationIntervalM ?? 30;
  const extension = input.extensionM ?? 0;
  if (!Number.isFinite(kickoffMdM) || kickoffMdM < 0) throw new RangeError("Kickoff depth must be finite and at or below the depth reference.");
  if (!Number.isFinite(buildRateDegPer30m) || buildRateDegPer30m <= 0 || buildRateDegPer30m > 30) throw new RangeError("Build rate must be greater than 0 and at most 30°/30 m.");
  if (![target.tvdM, target.northingM, target.eastingM].every(Number.isFinite)) throw new RangeError("Target coordinates must be finite.");
  if (!Number.isFinite(extension) || extension < 0) throw new RangeError("Extension beyond the target must be finite and not negative.");
  if (!Number.isFinite(interval) || interval <= 0) throw new RangeError("Station interval must be finite and positive.");
  const depthBelowKickoff = target.tvdM - kickoffMdM;
  if (depthBelowKickoff <= 0) throw new RangeError("Target must be deeper than the kickoff point.");
  const displacement = Math.hypot(target.northingM, target.eastingM);
  const azimuthDeg = displacement < 1e-9 ? 0 : normalizeAzimuth(Math.atan2(target.eastingM, target.northingM) * DEG);
  const radius = 30 * DEG / buildRateDegPer30m;
  const offset = displacement - radius;
  const reach = Math.hypot(offset, depthBelowKickoff);
  if (reach < radius - 1e-9) throw new RangeError(`Target lies inside the ${radius.toFixed(0)} m build radius; lower the build rate or move the target.`);
  const theta = Math.atan2(offset, depthBelowKickoff) + Math.asin(Math.min(1, radius / reach));
  const holdInclinationDeg = Math.max(0, theta * DEG);
  if (holdInclinationDeg > 90 + 1e-6) throw new RangeError(`Reaching this target needs ${holdInclinationDeg.toFixed(1)}° inclination; raise the build rate, kick off shallower or move the target deeper.`);
  const holdLength = Math.sqrt(Math.max(0, reach * reach - radius * radius));
  const buildLength = holdInclinationDeg / buildRateDegPer30m * 30;
  const endOfBuildMdM = kickoffMdM + buildLength;
  const targetMdM = endOfBuildMdM + holdLength;
  const totalDepthMdM = targetMdM + extension;
  const inclinationAt = (mdM: number) => mdM <= kickoffMdM ? 0 : mdM >= endOfBuildMdM ? holdInclinationDeg : (mdM - kickoffMdM) / 30 * buildRateDegPer30m;
  const depths = new Set<number>([0, kickoffMdM, endOfBuildMdM, targetMdM, totalDepthMdM]);
  for (let mdM = interval; mdM < totalDepthMdM; mdM += interval) depths.add(Math.round(mdM * 1e6) / 1e6);
  const stations = [...depths].sort((a, b) => a - b).filter((mdM, index, list) => index === 0 || mdM - list[index - 1]! > 1e-6).map((mdM) => Object.freeze({ mdM, inclinationDeg: inclinationAt(mdM), azimuthDeg }));
  return Object.freeze({
    stations: Object.freeze(stations),
    holdInclinationDeg,
    azimuthDeg,
    radiusM: radius,
    endOfBuildMdM,
    endOfBuildTvdM: kickoffMdM + radius * Math.sin(theta),
    holdLengthM: holdLength,
    targetMdM,
    targetDisplacementM: displacement,
    totalDepthMdM,
  });
}

/**
 * Return a new user-authored revision whose survey is recomputed from the given
 * stations by minimum curvature. Components below the new TD are trimmed so the
 * construction never extends past the hole.
 */
export function designWithTrajectory(design: WellDesign, stations: readonly SurveyStationInput[], details: { readonly name?: string; readonly note?: string } = {}): WellDesign {
  const survey = computeMinimumCurvature(stations);
  const totalDepthM = survey.at(-1)!.mdM;
  const components = design.components
    ?.filter((component) => component.topDepthM < totalDepthM || (component.topDepthM === 0 && component.bottomDepthM === 0))
    .map((component): WellComponent => component.bottomDepthM > totalDepthM ? Object.freeze({ ...component, bottomDepthM: totalDepthM }) : component);
  const { hashes: _hashes, ...rest } = design as WellDesign & { hashes?: unknown };
  void _hashes;
  return Object.freeze({
    ...rest,
    id: design.provenance === "user-authored" ? design.id : `${design.id}-plan`,
    revision: design.revision + 1,
    provenance: "user-authored",
    surveyStatus: "planned",
    totalDepthM,
    casingBottomM: Math.min(design.casingBottomM, totalDepthM),
    survey: Object.freeze(survey.map((station) => Object.freeze({ mdM: station.mdM, tvdM: station.tvdM, northingM: station.northingM, eastingM: station.eastingM, inclinationDeg: station.inclinationDeg, azimuthDeg: station.azimuthDeg }))),
    trajectoryName: details.name ?? "Edited trajectory",
    trajectoryNote: details.note ?? "Planned positions computed by minimum curvature from MD, inclination and azimuth stations.",
    components: components ? Object.freeze(components) : undefined,
  });
}
