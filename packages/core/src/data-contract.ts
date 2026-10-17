import { computeMinimumCurvature, tvdAtSurveyMd } from "./trajectory.ts";
import type { SurveyPoint } from "./index.ts";

/**
 * The data contract for wells: the canonical objects every view reads, whatever serves them.
 *
 * The workbench is a front end. A tenant's backend serves its wells, through:
 * - an OSDU platform;
 * - a WITSML store over ETP;
 * - an API over a PPDM database;
 * - files.
 * The bundled samples are one more source. Adapters convert each source to these objects, and
 * nothing downstream knows where a well came from except through `provenance`.
 *
 * Conventions:
 * - Lengths are metres and angles degrees.
 * - MD is measured along the hole. TVD is vertical depth below the wellbore's own depth datum.
 * - Elevations are metres above mean sea level.
 * - A location is WGS84 longitude and latitude, as OSDU normalises it (`Wgs84Coordinates`). The
 *   position as the source gave it is kept beside it, so nothing is lost converting.
 */

/** The contract's version: the minor rises when something is added, the major when a reader of the old one would misread the new. */
export const CONTRACT_VERSION = "1.1";

/** Where an object came from: the reader is always told, and synthetic data is always labelled. */
export interface Provenance {
  /** documented: public records; synthetic: generated; user-authored: typed here; tenant: the tenant's own system. */
  readonly kind: "documented" | "synthetic" | "user-authored" | "tenant";
  /** A citation a person can follow: a GDR submission, a report, a system and record id. */
  readonly source: string;
  readonly licence?: string;
  /** The record in the standard it came from, e.g. an OSDU kind and id or a WITSML uid. */
  readonly record?: { readonly standard: "OSDU" | "WITSML" | "PPDM" | "RESQML" | "LAS" | "deck"; readonly kind?: string; readonly id: string };
}

/** Longitude and latitude, WGS84; and the position the source supplied, in its own CRS. */
export interface WellLocation {
  readonly longitude: number;
  readonly latitude: number;
  /** As supplied, e.g. { crs: "EPSG:26912", easting, northing } for a NAD83 / UTM 12N survey plat. */
  readonly projected?: { readonly crs: string; readonly easting: number; readonly northing: number };
}

/**
 * A well: the surface site and its identity.
 * WITSML Well · OSDU master-data--Well · PPDM WELL.
 */
export interface CanonicalWell {
  readonly id: string;
  readonly name: string;
  /** The field or project area it belongs to: the deck groups wells into sites by it. */
  readonly field: { readonly id: string; readonly name: string } | null;
  readonly operator?: string;
  readonly country?: string;
  /** Unique well identifier as the regulator issues it (API number, NPDID, UWI). */
  readonly uwi?: string;
  /** Null when the source gives none: the well is then listed, never placed at a guessed spot. */
  readonly location: WellLocation | null;
  readonly environment: "onshore" | "offshore" | null;
  readonly waterDepthM: number | null;
  readonly groundElevationM: number | null;
  readonly provenance: Provenance;
}

/** The zero of a wellbore's depths. RKB rotary Kelly bushing, KB Kelly bushing, DF drill floor, GL ground level, MSL sea level. */
export type DepthDatumReference = "RKB" | "KB" | "DF" | "GL" | "MSL" | "other";
export interface DepthDatum {
  readonly reference: DepthDatumReference;
  /** Height of the datum above mean sea level; null when the source does not give it. */
  readonly elevationM: number | null;
  readonly description?: string;
}

/**
 * A wellbore: one hole from the well, with the datum its depths are measured from.
 * WITSML Wellbore · OSDU master-data--Wellbore (its VerticalMeasurements carry the datum) · PPDM WELL.
 */
export interface CanonicalWellbore {
  readonly id: string;
  readonly wellId: string;
  readonly name: string;
  readonly status: "planned" | "drilling" | "drilled";
  readonly datum: DepthDatum;
  readonly totalDepthMdM: number | null;
  readonly provenance: Provenance;
}

/**
 * One station. A source may give angles (MD, inclination, azimuth: a directional survey), positions
 * (MD, TVD, north, east: a computed or definitive path), or both. All three are allowed because the
 * standards allow all three:
 * - WITSML TrajectoryStation carries md, tvd, incl, azi, dispNs and dispEw.
 * - OSDU WellboreTrajectory's bulk data carries MD, inclination, azimuth, TVD and X/Y.
 * - PPDM WELL_DIR_SRVY_STATION carries station MD, inclination and azimuth.
 * North and east are offsets from the wellhead in the trajectory's azimuth reference.
 */
export interface TrajectoryStation {
  readonly mdM: number;
  readonly inclinationDeg?: number;
  readonly azimuthDeg?: number;
  readonly tvdM?: number;
  readonly northM?: number;
  readonly eastM?: number;
}

/**
 * A wellbore's path.
 * WITSML Trajectory · OSDU work-product-component--WellboreTrajectory · PPDM WELL_DIR_SRVY + WELL_DIR_SRVY_STATION.
 */
export interface CanonicalTrajectory {
  readonly id: string;
  readonly wellboreId: string;
  readonly name: string;
  /** definitive: the well's accepted path; survey: one survey run; planned: a design. */
  readonly kind: "definitive" | "survey" | "planned";
  /**
   * North the azimuths and offsets are measured from. "unknown" is drawn as grid north, and the
   * site says so: the two differ by the meridian convergence, up to a few degrees.
   */
  readonly azimuthReference: "grid" | "true" | "unknown";
  readonly stations: readonly TrajectoryStation[];
  readonly provenance: Provenance;
}

/**
 * A pick on a wellbore: a formation or group top, a fluid contact, or another marker.
 * WITSML WellboreMarker in a WellboreMarkerSet · OSDU work-product-component--WellboreMarkerSet · PPDM STRAT_WELL_SECTION.
 */
export interface CanonicalMarker {
  readonly id: string;
  readonly name: string;
  readonly mdM: number;
  /** As the source gives it; otherwise read off the trajectory. */
  readonly tvdM?: number;
  readonly kind: "formation" | "group" | "contact" | "other";
  readonly lithology?: string;
}
export interface CanonicalMarkerSet {
  readonly id: string;
  readonly wellboreId: string;
  readonly name: string;
  readonly markers: readonly CanonicalMarker[];
  readonly provenance: Provenance;
}

/**
 * A source of wells: one adapter per backend.
 *
 * A tenant may hold hundreds of thousands of wells, far more than a browser tab can keep. So a
 * source is read in two tiers, the way the standards' own APIs are:
 * - `headers` pages through the wells' identity, field and location. That is what the globe and the
 *   lists need, about 200 bytes a well. (OSDU Search pages with a cursor; ETP Discovery and a PPDM
 *   API page likewise.)
 * - `detail` serves wellbores, paths and tops for the wells asked for, when a field is opened. (OSDU
 *   Storage and the Wellbore DDMS; ETP Store; the API's well endpoints.)
 * Every call is async, can be cancelled, and gives what it has. A source with nothing for a well
 * returns no bundle for it, not an error.
 */
export interface WellDataSource {
  readonly id: string;
  readonly label: string;
  /** The standard the source speaks, for the reader: "Bundled samples", "OSDU", "WITSML 2.1 over ETP 1.2". */
  readonly standard: string;
  headers(cursor: string | null, signal?: AbortSignal): Promise<HeaderPage>;
  detail(wellIds: readonly string[], signal?: AbortSignal): Promise<readonly WellBundle[]>;
}
/** One page of well headers, and the cursor to the next (null on the last). */
export interface HeaderPage {
  readonly wells: readonly CanonicalWell[];
  readonly next: string | null;
  /** How many wells the source holds in all, when it says. */
  readonly total?: number;
}

// ── Checks at the boundary ────────────────────────────────────────────────────────────────────

export interface DataProblem {
  readonly object: "source" | "well" | "wellbore" | "trajectory" | "markers";
  readonly id: string;
  /** error: the object is left out; warning: it is used, and the reader is told. */
  readonly severity: "error" | "warning";
  readonly message: string;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function validateWell(well: CanonicalWell): readonly DataProblem[] {
  const problems: DataProblem[] = [];
  const add = (severity: DataProblem["severity"], message: string) => problems.push({ object: "well", id: well.id, severity, message });
  if (!well.id) add("error", "The well has no id.");
  if (!well.name.trim()) add("warning", "The well has no name.");
  if (well.location) {
    const { longitude, latitude } = well.location;
    if (!finite(longitude) || longitude < -180 || longitude > 180) add("error", `Longitude ${longitude} is outside −180° to 180°.`);
    if (!finite(latitude) || latitude < -90 || latitude > 90) add("error", `Latitude ${latitude} is outside −90° to 90°.`);
  }
  if (well.waterDepthM !== null && (!finite(well.waterDepthM) || well.waterDepthM < 0)) add("error", `Water depth ${well.waterDepthM} m is not a depth.`);
  if (well.environment === "onshore" && well.waterDepthM) add("warning", "An onshore well gives a water depth.");
  return problems;
}

export function validateWellbore(wellbore: CanonicalWellbore): readonly DataProblem[] {
  const problems: DataProblem[] = [];
  const add = (severity: DataProblem["severity"], message: string) => problems.push({ object: "wellbore", id: wellbore.id, severity, message });
  if (!wellbore.id) add("error", "The wellbore has no id.");
  if (!wellbore.wellId) add("error", "The wellbore names no well.");
  if (wellbore.datum.elevationM !== null && !finite(wellbore.datum.elevationM)) add("error", "The depth datum's elevation is not a number.");
  if (wellbore.datum.elevationM === null) add("warning", `The ${wellbore.datum.reference} elevation is not given: depths cannot be put below sea level.`);
  if (wellbore.totalDepthMdM !== null && (!finite(wellbore.totalDepthMdM) || wellbore.totalDepthMdM <= 0)) add("error", `Total depth ${wellbore.totalDepthMdM} m is not a depth.`);
  return problems;
}

/**
 * The checks a trajectory must pass before it is drawn:
 * - MD rises from station to station.
 * - Inclination is 0–180° and azimuth 0–360°.
 * - Every station gives angles or positions.
 * - TVD never exceeds the MD drilled to reach it.
 */
export function validateTrajectory(trajectory: CanonicalTrajectory): readonly DataProblem[] {
  const problems: DataProblem[] = [];
  const add = (severity: DataProblem["severity"], message: string) => problems.push({ object: "trajectory", id: trajectory.id, severity, message });
  const stations = trajectory.stations;
  if (stations.length < 2) add("error", `${stations.length} station${stations.length === 1 ? "" : "s"}: a path needs two.`);
  stations.forEach((station, index) => {
    const at = `Station ${index + 1} (MD ${station.mdM})`;
    if (!finite(station.mdM)) { add("error", `${at}: MD is not a number.`); return; }
    if (index > 0 && !(station.mdM > stations[index - 1]!.mdM)) add("error", `${at}: MD does not increase from the station before (${stations[index - 1]!.mdM}).`);
    const angles = station.inclinationDeg !== undefined && station.azimuthDeg !== undefined;
    const positions = station.tvdM !== undefined && station.northM !== undefined && station.eastM !== undefined;
    if (!angles && !positions) add("error", `${at}: gives neither inclination and azimuth nor TVD, north and east.`);
    if (station.inclinationDeg !== undefined && (!finite(station.inclinationDeg) || station.inclinationDeg < 0 || station.inclinationDeg > 180)) add("error", `${at}: inclination ${station.inclinationDeg}° is outside 0–180°.`);
    if (station.azimuthDeg !== undefined && (!finite(station.azimuthDeg) || station.azimuthDeg < 0 || station.azimuthDeg >= 360)) add("error", `${at}: azimuth ${station.azimuthDeg}° is outside 0–360°.`);
    if (positions && [station.tvdM, station.northM, station.eastM].some((value) => !finite(value))) add("error", `${at}: a position is not a number.`);
  });
  // A path cannot drop further than the hole it took to get there.
  const first = stations[0];
  if (first && first.tvdM !== undefined) stations.forEach((station, index) => {
    if (station.tvdM !== undefined && station.tvdM - first.tvdM! > station.mdM - first.mdM + 0.5) add("error", `Station ${index + 1}: TVD ${station.tvdM} m is deeper than the ${station.mdM - first.mdM} m drilled from the first station.`);
  });
  if (trajectory.azimuthReference === "unknown") add("warning", "The source does not say whether azimuths are to grid or true north: drawn as grid north.");
  return problems;
}

export function validateMarkerSet(set: CanonicalMarkerSet, totalDepthMdM: number | null): readonly DataProblem[] {
  const problems: DataProblem[] = [];
  const add = (severity: DataProblem["severity"], message: string) => problems.push({ object: "markers", id: set.id, severity, message });
  for (const marker of set.markers) {
    if (!finite(marker.mdM) || marker.mdM < 0) add("error", `${marker.name}: MD ${marker.mdM} is not a depth.`);
    else if (totalDepthMdM !== null && marker.mdM > totalDepthMdM + 0.5) add("warning", `${marker.name} at ${marker.mdM} m MD is below the wellbore's ${totalDepthMdM} m total depth.`);
  }
  return problems;
}

// ── From what was supplied to a full path ─────────────────────────────────────────────────────

const RAD = Math.PI / 180, DEG = 180 / Math.PI;

/**
 * Every station with MD, inclination, azimuth, TVD, north and east.
 * - **Positions supplied:** kept as given. A definitive survey's positions are the operator's, and
 *   recomputing them would quietly replace their method with ours. Angles a station lacks are
 *   derived from the chord arriving at it (the first station from the chord leaving it).
 * - **Angles only:** positions are computed by minimum curvature from the first station. That
 *   station is taken at TVD equal to its MD, below the datum on a vertical hole, unless it gives
 *   its own position.
 * Station i's north and east become the deck's `northingM` and `eastingM`: offsets from the
 * wellhead, not map coordinates.
 */
export function resolveTrajectory(trajectory: CanonicalTrajectory): readonly SurveyPoint[] {
  const stations = trajectory.stations;
  if (stations.length < 2) return [];
  const hasPositions = stations.every((station) => station.tvdM !== undefined && station.northM !== undefined && station.eastM !== undefined);
  if (hasPositions) {
    return stations.map((station, index) => {
      // The chord arriving at a station gives its direction; the first station takes the chord leaving it.
      const j = Math.max(1, index), a = stations[j - 1]!, b = stations[j]!;
      const dn = b.northM! - a.northM!, de = b.eastM! - a.eastM!, dz = b.tvdM! - a.tvdM!;
      const horizontal = Math.hypot(dn, de);
      return {
        mdM: station.mdM, tvdM: station.tvdM!, northingM: station.northM!, eastingM: station.eastM!,
        inclinationDeg: station.inclinationDeg ?? Math.atan2(horizontal, dz) * DEG,
        azimuthDeg: station.azimuthDeg ?? (horizontal < 1e-9 ? 0 : (Math.atan2(de, dn) * DEG + 360) % 360),
      };
    });
  }
  const first = stations[0]!;
  const tieIn = { tvdM: first.tvdM ?? first.mdM, northingM: first.northM ?? 0, eastingM: first.eastM ?? 0 };
  return computeMinimumCurvature(stations.map((station) => ({ mdM: station.mdM, inclinationDeg: station.inclinationDeg ?? 0, azimuthDeg: station.azimuthDeg ?? 0 })), { tieIn })
    .map((point) => ({ mdM: point.mdM, tvdM: point.tvdM, northingM: point.northingM, eastingM: point.eastingM, inclinationDeg: point.inclinationDeg, azimuthDeg: point.azimuthDeg }));
}

/** A marker's TVD: the source's own if it gave one, else read off the path; null off the path. */
export const markerTvd = (marker: CanonicalMarker, path: readonly SurveyPoint[]): number | null => marker.tvdM ?? tvdAtSurveyMd(path, marker.mdM);

/**
 * Grid convergence: the angle from true north to grid north at a point, for a transverse Mercator
 * (UTM) grid with central meridian `centralMeridianDeg`. A true-north offset is turned by it onto
 * the grid. This is the spherical first-order form, γ = atan(tan(λ − λ0) · sin φ). It is good to
 * well under 0.01° across a UTM zone, against offsets of a few kilometres.
 */
export function gridConvergenceDeg(longitude: number, latitude: number, centralMeridianDeg: number): number {
  return Math.atan(Math.tan((longitude - centralMeridianDeg) * RAD) * Math.sin(latitude * RAD)) * DEG;
}

/** North and east turned from true north to grid north by the convergence at the wellhead. */
export function trueToGrid(northM: number, eastM: number, convergenceDeg: number): { readonly northM: number; readonly eastM: number } {
  const c = Math.cos(convergenceDeg * RAD), s = Math.sin(convergenceDeg * RAD);
  // Grid north lies `convergence` east of true north, so a bearing measured from grid north is that much less.
  return { northM: northM * c + eastM * s, eastM: eastM * c - northM * s };
}

// ── Loading every source ──────────────────────────────────────────────────────────────────────

export interface CataloguedWellbore {
  readonly wellbore: CanonicalWellbore;
  /** The definitive path if the source marks one, else the first survey, else the plan. */
  readonly trajectory: CanonicalTrajectory | null;
  /** That trajectory as full stations; empty without one. */
  readonly path: readonly SurveyPoint[];
  readonly markers: readonly CanonicalMarker[];
}
export interface CataloguedWell {
  readonly sourceId: string;
  readonly well: CanonicalWell;
  readonly wellbores: readonly CataloguedWellbore[];
}
export interface WellCatalogue {
  readonly sources: readonly { readonly id: string; readonly label: string; readonly standard: string; readonly wells: number; readonly error: string | null }[];
  readonly wells: readonly CataloguedWell[];
  /** Everything left out or flagged, so the reader can see what their backend served wrong. */
  readonly problems: readonly (DataProblem & { readonly sourceId: string })[];
}

const preference: Readonly<Record<CanonicalTrajectory["kind"], number>> = { definitive: 0, survey: 1, planned: 2 };

/** One well with everything served for it, as an adapter that already holds whole records gives it. */
export interface WellBundle {
  readonly well: CanonicalWell;
  readonly wellbores: readonly { readonly wellbore: CanonicalWellbore; readonly trajectories: readonly CanonicalTrajectory[]; readonly markerSets: readonly CanonicalMarkerSet[] }[];
  /** What the adapter could not serve for this well (a path the backend has no data for, a unit it does not know): reported with the checks' own findings, so one well's trouble never fails its batch. Since 1.1. */
  readonly problems?: readonly DataProblem[];
}

/**
 * One well checked and made ready to draw: synchronous, for what is already in hand. A well that
 * fails its checks gives null; a wellbore, path or marker set that fails is left out. Either way,
 * the problems say why.
 */
export function catalogueWell(bundle: WellBundle, sourceId: string): { readonly entry: CataloguedWell | null; readonly problems: readonly DataProblem[] } {
  const problems: DataProblem[] = [...(bundle.problems ?? [])];
  const flag = (list: readonly DataProblem[]) => { problems.push(...list); return !list.some((problem) => problem.severity === "error"); };
  if (!flag(validateWell(bundle.well))) return { entry: null, problems };
  const wellbores = bundle.wellbores.filter((item) => flag(validateWellbore(item.wellbore))).map((item): CataloguedWellbore => {
    const trajectory = item.trajectories.filter((candidate) => flag(validateTrajectory(candidate))).sort((a, b) => preference[a.kind] - preference[b.kind])[0] ?? null;
    const markers = item.markerSets.filter((set) => flag(validateMarkerSet(set, item.wellbore.totalDepthMdM))).flatMap((set) => set.markers);
    return { wellbore: item.wellbore, trajectory, path: trajectory ? resolveTrajectory(trajectory) : [], markers };
  });
  return { entry: { sourceId, well: bundle.well, wellbores }, problems };
}

/** A source over bundles already in hand (a file, the samples), served a page at a time like any backend. */
export function bundleSource(id: string, label: string, standard: string, bundles: () => readonly WellBundle[] | Promise<readonly WellBundle[]>, pageSize = 1000): WellDataSource {
  let held: Promise<readonly WellBundle[]> | null = null;
  let byId: Map<string, WellBundle> | null = null;
  const all = async () => { held ??= Promise.resolve(bundles()); const list = await held; byId ??= new Map(list.map((bundle) => [bundle.well.id, bundle])); return { list, byId }; };
  return {
    id, label, standard,
    headers: async (cursor) => {
      const { list } = await all();
      const start = cursor ? Number(cursor) : 0;
      const end = Math.min(list.length, start + pageSize);
      return { wells: list.slice(start, end).map((bundle) => bundle.well), next: end < list.length ? String(end) : null, total: list.length };
    },
    detail: async (wellIds) => { const { byId: index } = await all(); return wellIds.flatMap((wellId) => index.get(wellId) ?? []); },
  };
}

/**
 * Every header a source pages through, as the pages arrive. It stops at `maxWells` and says so, so a
 * source larger than the deck can hold is cut short rather than taking the tab down. It also stops
 * when cancelled.
 */
export async function readHeaders(source: WellDataSource, options: { readonly maxWells?: number; readonly signal?: AbortSignal; readonly onPage?: (wells: readonly CanonicalWell[], total: number | undefined) => void } = {}): Promise<{ readonly wells: readonly CanonicalWell[]; readonly problems: readonly DataProblem[]; readonly truncated: boolean }> {
  const max = options.maxWells ?? 250_000;
  const wells: CanonicalWell[] = [], problems: DataProblem[] = [];
  let cursor: string | null = null, truncated = false;
  do {
    options.signal?.throwIfAborted();
    const page: HeaderPage = await source.headers(cursor, options.signal);
    const kept: CanonicalWell[] = [];
    for (const well of page.wells) {
      // A header too malformed even to check is left out on its own.
      let found: readonly DataProblem[];
      try { found = validateWell(well); } catch (cause) { found = [{ object: "well", id: String((well as { id?: unknown })?.id ?? "?"), severity: "error", message: `The record could not be read: ${cause instanceof Error ? cause.message : String(cause)}` }]; }
      problems.push(...found);
      if (!found.some((problem) => problem.severity === "error")) kept.push(well);
    }
    const room = max - wells.length;
    if (kept.length > room) { wells.push(...kept.slice(0, room)); truncated = true; break; }
    wells.push(...kept);
    options.onPage?.(kept, page.total);
    if (page.next !== null && page.next === cursor) throw new Error("The source returned the same page cursor twice.");
    cursor = page.next;
  } while (cursor !== null);
  if (truncated) problems.push({ object: "source", id: source.id, severity: "warning", message: `Only the first ${max.toLocaleString("en-US")} wells are listed; open a field to work in it, or narrow the source.` });
  return { wells, problems, truncated };
}

/**
 * Detail for some wells: asked for in batches, a few at a time, each batch checked and made ready as
 * it lands. Between batches the work yields, so the page never stalls for long. A batch that fails
 * is reported and the rest carry on. `simplify` keeps a path to its shape within that many metres
 * (for drawing many wells); leave it out for a well's full path.
 */
export async function readDetail(source: WellDataSource, wellIds: readonly string[], options: { readonly batch?: number; readonly concurrency?: number; readonly signal?: AbortSignal; readonly simplifyM?: number; readonly onBatch?: (wells: readonly CataloguedWell[]) => void } = {}): Promise<{ readonly wells: readonly CataloguedWell[]; readonly problems: readonly DataProblem[] }> {
  const size = options.batch ?? 100, lanes = options.concurrency ?? 4;
  const batches: (readonly string[])[] = [];
  for (let i = 0; i < wellIds.length; i += size) batches.push(wellIds.slice(i, i + size));
  const wells: CataloguedWell[] = [], problems: DataProblem[] = [];
  let next = 0;
  const lane = async () => {
    while (next < batches.length) {
      options.signal?.throwIfAborted();
      const ids = batches[next++]!;
      try {
        const bundles = await source.detail(ids, options.signal);
        const made: CataloguedWell[] = [];
        for (const bundle of bundles) {
          try {
            const { entry, problems: found } = catalogueWell(bundle, source.id);
            problems.push(...found);
            if (entry) made.push(options.simplifyM ? simplifyWell(entry, options.simplifyM) : entry);
          } catch (cause) {
            problems.push({ object: "well", id: String(bundle?.well?.id ?? "?"), severity: "error", message: `The record could not be read: ${cause instanceof Error ? cause.message : String(cause)}` });
          }
        }
        wells.push(...made);
        options.onBatch?.(made);
      } catch (cause) {
        if (options.signal?.aborted) throw cause;
        problems.push({ object: "source", id: source.id, severity: "error", message: `${ids.length} wells could not be read (${cause instanceof Error ? cause.message : String(cause)}).` });
      }
      // Give the page a turn between batches.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  await Promise.all(Array.from({ length: Math.min(lanes, batches.length) }, lane));
  return { wells, problems };
}

/**
 * A path kept to its shape within `toleranceM` metres in 3D (Douglas–Peucker on TVD, north and east),
 * its first and last stations always kept. For drawing a field of wells; a well's own calculations
 * use its full path.
 */
export function simplifyPath(path: readonly SurveyPoint[], toleranceM: number): readonly SurveyPoint[] {
  if (path.length <= 2 || toleranceM <= 0) return path;
  const keep = new Uint8Array(path.length);
  keep[0] = 1; keep[path.length - 1] = 1;
  const stack: [number, number][] = [[0, path.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const a = path[i]!, b = path[j]!;
    const dx = b.eastingM - a.eastingM, dy = b.northingM - a.northingM, dz = b.tvdM - a.tvdM, length2 = dx * dx + dy * dy + dz * dz;
    let worst = -1, at = -1;
    for (let k = i + 1; k < j; k++) {
      const p = path[k]!;
      const px = p.eastingM - a.eastingM, py = p.northingM - a.northingM, pz = p.tvdM - a.tvdM;
      const t = length2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / length2)) : 0;
      const ex = px - t * dx, ey = py - t * dy, ez = pz - t * dz, d2 = ex * ex + ey * ey + ez * ez;
      if (d2 > worst) { worst = d2; at = k; }
    }
    if (at >= 0 && worst > toleranceM * toleranceM) { keep[at] = 1; stack.push([i, at], [at, j]); }
  }
  return path.filter((_, k) => keep[k] === 1);
}
const simplifyWell = (entry: CataloguedWell, toleranceM: number): CataloguedWell => ({ ...entry, wellbores: entry.wellbores.map((bore) => ({ ...bore, path: simplifyPath(bore.path, toleranceM) })) });

/**
 * Every well from every source, checked, headers and detail together. This is for sources small
 * enough to hold whole: the tests, a file, the samples. A large tenant is read with `readHeaders`,
 * and `readDetail` field by field. A source that fails, or a record that fails its checks, is left
 * out and listed in `problems`; it never takes the other wells with it. A well id already served by
 * an earlier source is a problem too: the first source keeps it.
 */
export async function loadWellCatalogue(sources: readonly WellDataSource[]): Promise<WellCatalogue> {
  const problems: (DataProblem & { sourceId: string })[] = [];
  const wells: CataloguedWell[] = [];
  const seen = new Set<string>();
  // Sources are read at once; what each served is then kept in source order, so the first keeps a duplicated id.
  const read = await Promise.all(sources.map(async (source) => {
    try {
      const listed = await readHeaders(source);
      const detail = await readDetail(source, listed.wells.map((well) => well.id));
      // A well whose detail the source did not serve is still listed, without wellbores.
      const served = new Map(detail.wells.map((entry) => [entry.well.id, entry]));
      const loaded = listed.wells.map((well) => served.get(well.id) ?? { sourceId: source.id, well, wellbores: [] });
      return { source, found: [...listed.problems, ...detail.problems], loaded, error: null };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return { source, found: [{ object: "source" as const, id: source.id, severity: "error" as const, message: `${source.label} could not be read: ${message}` }], loaded: [] as CataloguedWell[], error: message };
    }
  }));
  const summaries = read.map(({ source, found, loaded, error }) => {
    problems.push(...found.map((problem) => ({ ...problem, sourceId: source.id })));
    let count = 0;
    for (const entry of loaded) {
      if (seen.has(entry.well.id)) { problems.push({ object: "well", id: entry.well.id, severity: "error", message: `Another source already serves a well with id "${entry.well.id}"; this one is left out.`, sourceId: source.id }); continue; }
      seen.add(entry.well.id);
      wells.push(entry);
      count++;
    }
    return { id: source.id, label: source.label, standard: source.standard, wells: count, error };
  });
  return { sources: summaries, wells, problems };
}
