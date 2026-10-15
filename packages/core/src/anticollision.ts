import forgeOffsetWellsData from "./forge-offset-wells.json" with { type: "json" };
import forgeSurveyUncertaintyData from "./forge-survey-uncertainty.json" with { type: "json" };
import { forgeConstructionWells } from "./forge-construction.ts";
import { forgeSeismicSection } from "./seismic.ts";
import { computeMinimumCurvature } from "./trajectory.ts";
import { usSurveyFeetToMetres } from "./units.ts";

/**
 * Anti-collision between wells from their surveys. Every well is placed in one absolute frame —
 * easting and northing in a shared projected CRS, elevation in metres above sea level — from its
 * wellhead and the elevation its depths are measured from. Centre-to-centre distance always; the
 * ISCWSA separation factor (Sawaryn et al. 2019, SPE 187073) where both wells carry position
 * covariances: SF = max(D − (Rr + Ro + Sm), 0) / (k · √(uᵀ(Cr + Co)u + σpa²)).
 */

/** ISCWSA separation-rule constants: k for the probability of crossing, the projection-ahead sphere, the surface margin. */
export const ISCWSA_RULE = Object.freeze({ k: 3.5, sigmaPaM: 0.5, surfaceMarginM: 0.3 });

/** Position covariance along a well: north, east, vertical (down), metres squared, per station. */
export interface WellUncertainty {
  readonly mdM: readonly number[];
  /** Upper triangle per station: NN, NE, NV, EE, EV, VV. */
  readonly cov: readonly (readonly number[])[];
  /** The error model of each run of stations, as applied. */
  readonly models: readonly { readonly model: string; readonly fromMdM: number; readonly toMdM: number }[];
}

export interface PlacedWell {
  readonly id: string;
  readonly label: string;
  readonly provenance: "documented" | "synthetic" | "user-authored";
  /** Wellhead in the shared projected CRS, metres. */
  readonly eastingM: number;
  readonly northingM: number;
  /** Elevation of the depth reference (TVD 0), metres above sea level. */
  readonly depthZeroElevationM: number;
  /** What the depth reference is and where the numbers came from, for the reader. */
  readonly datumNote: string;
  /** Survey stations: measured depth, TVD below the depth reference, and north/east from the wellhead, metres. */
  readonly stations: readonly { readonly mdM: number; readonly tvdM: number; readonly northingM: number; readonly eastingM: number }[];
  /** The survey's error model as applied, in words, or null when none is. */
  readonly errorModel: string | null;
  readonly uncertainty?: WellUncertainty | null;
  /** Hole radius down the well: each entry holds to its MD. Beyond the last, the last. */
  readonly holeRadii?: readonly { readonly toMdM: number; readonly radiusM: number; readonly note?: string }[];
}

/** A point on a well in the shared frame: easting, northing, elevation (m ASL), at a measured depth. */
export interface WellPoint { readonly mdM: number; readonly e: number; readonly n: number; readonly z: number }

/** A placed well's stations in the shared frame. */
export function wellPoints(well: PlacedWell): WellPoint[] {
  return well.stations.map((station) => ({ mdM: station.mdM, e: well.eastingM + station.eastingM, n: well.northingM + station.northingM, z: well.depthZeroElevationM - station.tvdM }));
}

/** The point at a measured depth, straight between the bracketing stations; null outside the survey. */
export function pointAtMd(points: readonly WellPoint[], mdM: number): WellPoint | null {
  if (!points.length || mdM < points[0]!.mdM || mdM > points.at(-1)!.mdM) return null;
  let low = 0, high = points.length - 1;
  while (high - low > 1) { const mid = (low + high) >> 1; if (points[mid]!.mdM <= mdM) low = mid; else high = mid; }
  const a = points[low]!, b = points[high]!;
  const t = b.mdM > a.mdM ? (mdM - a.mdM) / (b.mdM - a.mdM) : 0;
  return { mdM, e: a.e + t * (b.e - a.e), n: a.n + t * (b.n - a.n), z: a.z + t * (b.z - a.z) };
}

export interface Separation {
  readonly referenceMdM: number;
  /** The nearest point on the offset well and its measured depth. */
  readonly offsetMdM: number;
  readonly centreToCentreM: number;
  /** Offset minus reference, metres: east, north, up. */
  readonly de: number;
  readonly dn: number;
  readonly dz: number;
  /**
   * Where the offset lies around the reference well, degrees clockwise looking down the hole: from
   * the high side where the reference is inclined more than 5°, from grid north where it is near
   * vertical. The travelling-cylinder angle.
   */
  readonly bearingDeg: number;
  readonly bearingFrom: "high side" | "north";
  /** ISCWSA separation factor (the least over the offset's stations), and that station's MD; null without covariances. */
  readonly separationFactor: number | null;
  readonly sfOffsetMdM: number | null;
}

/** A covariance at a measured depth, straight between stations (as the positions are). */
export function covarianceAt(uncertainty: WellUncertainty, mdM: number): readonly number[] {
  const md = uncertainty.mdM;
  if (mdM <= md[0]!) return uncertainty.cov[0]!;
  if (mdM >= md[md.length - 1]!) return uncertainty.cov[md.length - 1]!;
  let low = 0, high = md.length - 1;
  while (high - low > 1) { const mid = (low + high) >> 1; if (md[mid]! <= mdM) low = mid; else high = mid; }
  const t = (mdM - md[low]!) / (md[high]! - md[low]! || 1);
  return uncertainty.cov[low]!.map((value, k) => value + t * (uncertainty.cov[high]![k]! - value));
}

export const holeRadiusAt = (well: PlacedWell, mdM: number) => {
  const radii = well.holeRadii ?? [];
  return (radii.find((entry) => mdM <= entry.toMdM) ?? radii.at(-1))?.radiusM ?? 0;
};

/** uᵀ C u for a unit vector given as north, east, down. */
const along = (c: readonly number[], n: number, e: number, v: number) => c[0]! * n * n + 2 * c[1]! * n * e + 2 * c[2]! * n * v + c[3]! * e * e + 2 * c[4]! * e * v + c[5]! * v * v;

/** The ISCWSA separation factor between two positions with covariances and hole radii. */
export function separationFactor(d: { readonly n: number; readonly e: number; readonly v: number }, cr: readonly number[], co: readonly number[], rr: number, ro: number, rule = ISCWSA_RULE): number {
  const distance = Math.hypot(d.n, d.e, d.v);
  if (distance === 0) return 0;
  const n = d.n / distance, e = d.e / distance, v = d.v / distance;
  const spread = along(cr, n, e, v) + along(co, n, e, v);
  return Math.max(distance - (rr + ro + rule.surfaceMarginM), 0) / (rule.k * Math.sqrt(spread + rule.sigmaPaM ** 2));
}

/** The nearest point to `p` on the segment a–b, with its parameter along the segment. */
function nearestOnSegment(p: WellPoint, a: WellPoint, b: WellPoint) {
  const ux = b.e - a.e, uy = b.n - a.n, uz = b.z - a.z;
  const length = ux * ux + uy * uy + uz * uz;
  const t = length > 0 ? Math.min(1, Math.max(0, ((p.e - a.e) * ux + (p.n - a.n) * uy + (p.z - a.z) * uz) / length)) : 0;
  const q = { e: a.e + t * ux, n: a.n + t * uy, z: a.z + t * uz };
  return { t, q, d2: (p.e - q.e) ** 2 + (p.n - q.n) ** 2 + (p.z - q.z) ** 2 };
}

/**
 * Closest approach of an offset well to a reference well, sampled every `stepM` of reference MD
 * (and at the reference's last station). Each sample is the nearest point anywhere on the offset
 * survey, straight between its stations. Stops where the reference survey ends.
 */
export function separations(reference: PlacedWell, offset: PlacedWell, stepM = 10): Separation[] {
  if (!(stepM > 0)) throw new RangeError("The sampling step must be positive.");
  const ref = wellPoints(reference), off = wellPoints(offset);
  if (ref.length < 2 || off.length < 1) return [];
  const result: Separation[] = [];
  const first = ref[0]!.mdM, last = ref.at(-1)!.mdM;
  const depths: number[] = [];
  for (let md = first; md < last; md += stepM) depths.push(md);
  depths.push(last);
  for (const md of depths) {
    const p = pointAtMd(ref, md)!;
    let best = { d2: Infinity, q: off[0]!, md: off[0]!.mdM };
    if (off.length === 1) best = { d2: (p.e - off[0]!.e) ** 2 + (p.n - off[0]!.n) ** 2 + (p.z - off[0]!.z) ** 2, q: off[0]!, md: off[0]!.mdM };
    for (let i = 1; i < off.length; i++) {
      const a = off[i - 1]!, b = off[i]!;
      const hit = nearestOnSegment(p, a, b);
      if (hit.d2 < best.d2) best = { d2: hit.d2, q: { mdM: a.mdM + hit.t * (b.mdM - a.mdM), ...hit.q }, md: a.mdM + hit.t * (b.mdM - a.mdM) };
    }
    const de = best.q.e - p.e, dn = best.q.n - p.n, dz = best.q.z - p.z;
    const { bearingDeg, bearingFrom } = bearingAround(ref, md, de, dn, dz);
    // The separation factor is the least over the offset's stations, as the ISCWSA rule is applied:
    // the nearest centre is not always the least separated once the ellipsoids differ.
    let sf: number | null = null, sfMd: number | null = null;
    if (reference.uncertainty && offset.uncertainty) {
      const cr = covarianceAt(reference.uncertainty, md), rr = holeRadiusAt(reference, md);
      for (const q of off) {
        const value = separationFactor({ n: q.n - p.n, e: q.e - p.e, v: p.z - q.z }, cr, covarianceAt(offset.uncertainty, q.mdM), rr, holeRadiusAt(offset, q.mdM));
        if (sf === null || value < sf) { sf = value; sfMd = q.mdM; }
      }
    }
    result.push({ referenceMdM: md, offsetMdM: best.md, centreToCentreM: Math.sqrt(best.d2), de, dn, dz, bearingDeg, bearingFrom, separationFactor: sf, sfOffsetMdM: sfMd });
  }
  return result;
}

/** The travelling-cylinder angle of a vector from the reference well at a depth. */
function bearingAround(ref: readonly WellPoint[], md: number, de: number, dn: number, dz: number): { bearingDeg: number; bearingFrom: "high side" | "north" } {
  const ahead = pointAtMd(ref, Math.min(ref.at(-1)!.mdM, md + 5)) ?? ref.at(-1)!;
  const behind = pointAtMd(ref, Math.max(ref[0]!.mdM, md - 5)) ?? ref[0]!;
  let tx = ahead.e - behind.e, ty = ahead.n - behind.n, tz = ahead.z - behind.z;
  const length = Math.hypot(tx, ty, tz) || 1;
  tx /= length; ty /= length; tz /= length;
  // Remove the along-hole part: what is left lies in the plane across the hole.
  const along = de * tx + dn * ty + dz * tz;
  const px = de - along * tx, py = dn - along * ty, pz = dz - along * tz;
  const inclination = Math.acos(Math.min(1, Math.max(-1, -tz))) * 180 / Math.PI;
  if (inclination > 5) {
    // High side: the upward direction across the hole. Right of it, looking down the hole, is tangent × up.
    const up = { x: -tz * tx, y: -tz * ty, z: 1 - tz * tz };
    const u = Math.hypot(up.x, up.y, up.z) || 1;
    const hx = up.x / u, hy = up.y / u, hz = up.z / u;
    const rx = ty * hz - tz * hy, ry = tz * hx - tx * hz, rz = tx * hy - ty * hx;
    const angle = Math.atan2(px * rx + py * ry + pz * rz, px * hx + py * hy + pz * hz) * 180 / Math.PI;
    return { bearingDeg: (angle + 360) % 360, bearingFrom: "high side" };
  }
  return { bearingDeg: (Math.atan2(px, py) * 180 / Math.PI + 360) % 360, bearingFrom: "north" };
}

/** The least centre-to-centre distance in a set of samples, or null for none. */
export function closestApproach(samples: readonly Separation[]): Separation | null {
  return samples.reduce<Separation | null>((best, sample) => !best || sample.centreToCentreM < best.centreToCentreM ? sample : best, null);
}

// ── The FORGE neighbours ──────────────────────────────────────────────────────────────────────

/** A licensed surveyor's as-built wellhead: NAD83 / UTM 12N metres, with the latitude and longitude it was given in. */
export interface AsBuilt { readonly eastingM: number; readonly northingM: number; readonly latitude: number; readonly longitude: number; readonly elevationFt: number; readonly of: string; readonly source: string }

/** The fixture written by tools/survey/build_forge_offset_wells.py, as JSON. */
export interface ForgeOffsetWellsRecord {
  readonly licence: string;
  readonly sources: Readonly<Record<string, { readonly url: string; readonly sha256: string; readonly gdr: number }>>;
  readonly forge16aWellhead: {
    readonly gps: { readonly eastingM: number; readonly northingM: number; readonly groundElevationM: number; readonly source: string };
    readonly asBuilt: AsBuilt;
  };
  readonly wells: readonly {
    readonly id: string;
    readonly label: string;
    readonly source: string;
    readonly surveyKind: string;
    readonly crs: string;
    readonly north: string;
    readonly wellhead: { readonly eastingFt?: number; readonly northingFt?: number; readonly eastingM?: number; readonly northingM?: number; readonly groundElevationM?: number; readonly source: string; readonly asBuilt?: AsBuilt };
    readonly depthReference: { readonly kind: string; readonly elevationFt?: number; readonly groundElevationFt?: number; readonly kbAboveGroundFt?: number; readonly headerKbFt?: number; readonly headerGlFt?: number; readonly source?: string };
    readonly check: string;
    /** MD (ft), inclination (°), azimuth (°) per station, as reported. */
    readonly stations: readonly (readonly number[])[];
  }[];
}

/**
 * A neighbour's hole sizes, section by section, from its end-of-well report (forge-construction.ts):
 * each runs to its reported bottom, the deepest on to TD. Both are measured from the same KB as the
 * well's survey. Null for a well with no construction record.
 */
function reportedHoleRadii(id: string): PlacedWell["holeRadii"] | null {
  const well = forgeConstructionWells.find((entry) => entry.id === id);
  const holes = (well?.components ?? []).filter((component) => component.kind === "Hole" && component.outerDiameterMm !== null).sort((a, b) => a.bottomDepthM - b.bottomDepthM);
  if (!well || !holes.length) return null;
  return holes.map((hole, index) => ({ toMdM: index === holes.length - 1 ? Infinity : hole.bottomDepthM, radiusM: hole.outerDiameterMm! / 2000, note: `${hole.name}, ${well.source.label} p. ${hole.sourcePage}` }));
}

/**
 * The FORGE neighbours placed in metres: survey feet converted with 1200/3937, minimum curvature
 * from the reported stations, the licensed as-built wellhead where there is one. 58-32's depths are
 * from its KB, which its log header puts 21.5 ft above ground; the ground is the GPS survey's.
 */
export function placeForgeOffsetWells(record: ForgeOffsetWellsRecord, uncertainty?: Readonly<Record<string, WellUncertainty>>): PlacedWell[] {
  return record.wells.map((well) => {
    const stations = computeMinimumCurvature(well.stations.map(([md, inc, azi]) => ({ mdM: usSurveyFeetToMetres(md!), inclinationDeg: inc!, azimuthDeg: azi! })));
    const head = well.wellhead;
    const eastingM = head.asBuilt?.eastingM ?? head.eastingM ?? usSurveyFeetToMetres(head.eastingFt!);
    const northingM = head.asBuilt?.northingM ?? head.northingM ?? usSurveyFeetToMetres(head.northingFt!);
    const reference = well.depthReference;
    const datum = reference.elevationFt !== undefined
      ? { elevation: usSurveyFeetToMetres(reference.elevationFt), note: `${reference.kind} ${reference.elevationFt.toFixed(2)} ft (${usSurveyFeetToMetres(reference.elevationFt).toFixed(1)} m ASL), from the survey report` }
      : reference.kbAboveGroundFt !== undefined && head.groundElevationM !== undefined
        ? { elevation: head.groundElevationM + usSurveyFeetToMetres(reference.kbAboveGroundFt), note: `KB ${reference.kbAboveGroundFt} ft above ground (its log header: drilling measured from KB, KB ${reference.headerKbFt} ft, GL ${reference.headerGlFt} ft) on the GPS ground of ${head.groundElevationM.toFixed(1)} m ASL` }
        : { elevation: head.groundElevationM ?? 0, note: `Depth reference not reported: taken at the GPS ground elevation, ${(head.groundElevationM ?? 0).toFixed(1)} m ASL` };
    const own = uncertainty?.[well.id] ?? null;
    return {
      id: well.id, label: well.label, provenance: "documented", eastingM, northingM, depthZeroElevationM: datum.elevation,
      datumNote: `${datum.note}. Wellhead: ${head.asBuilt ? head.asBuilt.source : head.source}. Survey: ${well.source}.`, stations,
      errorModel: own ? own.models.map((run) => `${run.model} ${Math.round(run.fromMdM)}–${Math.round(run.toMdM)} m`).join(", ") : null,
      uncertainty: own,
      holeRadii: reportedHoleRadii(well.id) ?? [{ toMdM: Infinity, radiusM: 8.75 * 0.0254 / 2, note: "8.75 in stand-in: this well's hole sizes are not in the records used" }],
    };
  });
}

/** Position covariances from tools/survey/build_forge_survey_uncertainty.py: OWSG generic models per reported tool, tied on run to run. */
export interface ForgeSurveyUncertaintyRecord {
  readonly source: { readonly welleng: string; readonly field: { readonly b_total: number; readonly dip: number; readonly declination: number } };
  readonly rule: { readonly k: number; readonly sigmaPaM: number; readonly surfaceMarginM: number };
  readonly wells: Readonly<Record<string, WellUncertainty>>;
  /** welleng's own ISCWSA results, 16A against each neighbour, to check this implementation against. */
  readonly checks: Readonly<Record<string, { readonly minSf: number; readonly atReferenceMdM: number }>>;
}
export const forgeSurveyUncertainty = forgeSurveyUncertaintyData as ForgeSurveyUncertaintyRecord;

/** The FORGE wells near 16A(78)-32 (16B(78)-32 and 58-32), placed from GDR 1516, 1006 and 1358. */
export const forgeOffsetWellsRecord = forgeOffsetWellsData as ForgeOffsetWellsRecord;
export const forgeNeighbours: readonly PlacedWell[] = Object.freeze(placeForgeOffsetWells(forgeOffsetWellsRecord, forgeSurveyUncertainty.wells));

/** 16A(78)-32's hole sizes from its records (GDR 1283): 17 1/2 in to 1,629 ft, 12 1/4 in to 5,110 ft, 8 3/4 in to TD. */
export const forge16aHoleRadii = Object.freeze([
  { toMdM: usSurveyFeetToMetres(1629), radiusM: 17.5 * 0.0254 / 2 },
  { toMdM: usSurveyFeetToMetres(5110), radiusM: 12.25 * 0.0254 / 2 },
  { toMdM: Infinity, radiusM: 8.75 * 0.0254 / 2 },
]);

/**
 * 16A(78)-32's wellhead. The licensed as-built survey (Woolsey Land Surveying, 2023) is the one
 * used; the survey workbook's own reference point agrees with it to 0.07 m and the UGS GPS survey to
 * 1.8 m. The planned-trajectory CSV (GDR 1216) the seismic tie was first built on is 16.2 m off.
 */
export const forge16aWellheads = Object.freeze({
  asBuilt: { eastingM: forgeOffsetWellsRecord.forge16aWellhead.asBuilt.eastingM, northingM: forgeOffsetWellsRecord.forge16aWellhead.asBuilt.northingM, source: forgeOffsetWellsRecord.forge16aWellhead.asBuilt.source },
  gps: { eastingM: forgeOffsetWellsRecord.forge16aWellhead.gps.eastingM, northingM: forgeOffsetWellsRecord.forge16aWellhead.gps.northingM, source: forgeOffsetWellsRecord.forge16aWellhead.gps.source },
  plan: { eastingM: forgeSeismicSection.wellhead.eastingM, northingM: forgeSeismicSection.wellhead.northingM, source: "GDR 1216 planned-trajectory CSV" },
});

/** 16A(78)-32 as a placed well: as-built wellhead, RKB depths, its covariances and hole sizes. */
export function forge16aPlaced(stations: PlacedWell["stations"]): PlacedWell {
  const uncertainty = forgeSurveyUncertainty.wells.forge ?? null;
  return {
    id: "forge", label: "16A(78)-32", provenance: "documented",
    eastingM: forge16aWellheads.asBuilt.eastingM, northingM: forge16aWellheads.asBuilt.northingM,
    depthZeroElevationM: forgeSeismicSection.rkbElevationM,
    datumNote: `RKB 5,444 ft (the survey workbook). Wellhead: ${forge16aWellheads.asBuilt.source}.`,
    stations, uncertainty, holeRadii: forge16aHoleRadii,
    errorModel: uncertainty ? uncertainty.models.map((run) => `${run.model} ${Math.round(run.fromMdM)}–${Math.round(run.toMdM)} m`).join(", ") : null,
  };
}
