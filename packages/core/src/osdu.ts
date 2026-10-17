import { HttpError, fetchJsonGuarded, limit } from "./fetch-guard.ts";
import type { GuardAuth } from "./fetch-guard.ts";
import { crsFromReference, ensureCrs, knownCrs, reprojectGisXY } from "./gis.ts";
import type { CanonicalMarker, CanonicalMarkerSet, CanonicalTrajectory, CanonicalWell, CanonicalWellbore, DataProblem, DepthDatum, HeaderPage, TrajectoryStation, WellBundle, WellDataSource } from "./data-contract.ts";

/**
 * A tenant's OSDU platform as a source of wells, through the data contract.
 *
 * - **Listing** (`headers`): Search, `query_with_cursor` on the Well kind, a page of headers at a
 *   time; one batched Search per page names the fields. A well with no field is put in a 1° cell,
 *   so reads per field stay bounded.
 * - **Detail** (`detail`): for a batch of wells, Search for their Wellbores, then for each
 *   wellbore's trajectories and marker sets; the trajectory's stations and, when not inline, the
 *   markers come from the Wellbore DDMS bulk endpoints. Columns are mapped through the records'
 *   own property lists and converted to metres and degrees.
 * - Every request carries the bearer token and `data-partition-id`, goes through the fetch guard,
 *   and shares one limiter per source, so a field's batches never stampede the platform.
 * - One well's trouble (a 404 from the DDMS, a unit the adapter does not know) is reported on that
 *   well and the batch carries on.
 *
 * Nothing is written. Record kinds and API paths are configurable; the defaults fit a standard
 * platform.
 */

export interface OsduSourceOptions {
  readonly id: string;
  readonly label?: string;
  /** The platform's base URL, or a same-origin path that proxies to it. */
  readonly baseUrl: string;
  readonly dataPartition: string;
  readonly auth?: GuardAuth;
  readonly paths?: { readonly search?: string; readonly wellboreDdms?: string };
  readonly kinds?: { readonly well?: string; readonly field?: string; readonly wellbore?: string; readonly trajectory?: string; readonly markerSet?: string };
  /** An extra Search query every well must match. */
  readonly query?: string;
  readonly pageSize?: number;
  readonly concurrency?: number;
  readonly timeoutMs?: number;
  /** For the tests: the fetch to use. */
  readonly fetcher?: typeof fetch;
}

export const OSDU_DEFAULTS = Object.freeze({
  paths: { search: "/api/search/v2", wellboreDdms: "/api/os-wellbore-ddms" },
  kinds: { well: "*:*:master-data--Well:*", field: "*:*:master-data--Field:*", wellbore: "*:*:master-data--Wellbore:*", trajectory: "*:*:work-product-component--WellboreTrajectory:*", markerSet: "*:*:work-product-component--WellboreMarkerSet:*" },
});

/** An OSDU record as Search and Storage return it: the data block is whatever the schema says. */
export interface OsduRecord { readonly id: string; readonly kind: string; readonly version?: number; readonly modifyTime?: string; readonly createTime?: string; readonly data: Readonly<Record<string, unknown>> }
/** A bulk table from the Wellbore DDMS, in pandas' `split` orientation, or `columns`, or a list of row objects. */
export type OsduTable = { readonly columns: readonly string[]; readonly data: readonly (readonly unknown[])[]; readonly index?: readonly unknown[] } | Readonly<Record<string, Readonly<Record<string, unknown>>>> | readonly Readonly<Record<string, unknown>>[];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined => typeof value === "string" && value ? value : undefined;
const num = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
/** A record id without a version suffix: references end ":"; a versioned one ":<version>:". */
export const refToId = (ref: string) => ref.replace(/:\d+:$/, "").replace(/:$/, "");
/** The last meaningful segment of a reference, e.g. "…:OperatingEnvironment:Offshore:" → "Offshore". */
export const endOfRef = (ref: string | undefined) => ref ? ref.replace(/:$/, "").split(":").pop() ?? "" : "";

// ── Units ─────────────────────────────────────────────────────────────────────────────────────
const LENGTH: Readonly<Record<string, number>> = { m: 1, metre: 1, meter: 1, metres: 1, meters: 1, km: 1000, ft: 0.3048, foot: 0.3048, feet: 0.3048, ftus: 0.30480061, "ft[us]": 0.30480061, "us survey foot": 0.30480061, ussurveyfoot: 0.30480061, cm: 0.01, mm: 0.001, in: 0.0254, inch: 0.0254 };
const ANGLE: Readonly<Record<string, number>> = { dega: 1, deg: 1, degree: 1, degrees: 1, "°": 1, rad: 180 / Math.PI, radian: 180 / Math.PI, grad: 0.9, gon: 0.9 };
const unitKey = (ref: string | undefined) => endOfRef(ref).trim().toLowerCase();
/** A length in metres, or null when the unit is unknown. */
// Own keys only: a unit named "constructor" or "__proto__" (a hostile record) is unknown, not Object.prototype's.
const factorIn = (table: Readonly<Record<string, number>>, uomRef: string | undefined) => { const key = unitKey(uomRef); return Object.hasOwn(table, key) ? table[key] : undefined; };
export function lengthToMetres(value: number, uomRef: string | undefined): number | null { const factor = factorIn(LENGTH, uomRef); return factor === undefined ? null : value * factor; }
export function angleToDegrees(value: number, uomRef: string | undefined): number | null { const factor = factorIn(ANGLE, uomRef); return factor === undefined ? null : value * factor; }
/** Metres per unit for a length unit the adapter knows, else null; an absent unit is taken as metres. */
const metresPer = (uomRef: string | undefined) => uomRef === undefined ? 1 : LENGTH[unitKey(uomRef)] ?? null;
const degreesPer = (uomRef: string | undefined) => uomRef === undefined ? 1 : ANGLE[unitKey(uomRef)] ?? null;

// ── Positions ─────────────────────────────────────────────────────────────────────────────────
/** The first point in a GeoJSON or AnyCrs feature collection: a Point's coordinates, else the first coordinate of any geometry. */
function firstPoint(collection: unknown): readonly [number, number] | null {
  if (!isObject(collection) || !Array.isArray(collection.features)) return null;
  for (const feature of collection.features) {
    const geometry = isObject(feature) ? feature.geometry : null;
    if (!isObject(geometry)) continue;
    let coordinates: unknown = geometry.coordinates;
    while (Array.isArray(coordinates) && Array.isArray(coordinates[0])) coordinates = coordinates[0];
    if (Array.isArray(coordinates) && coordinates.length >= 2) { const x = num(coordinates[0]), y = num(coordinates[1]); if (x !== null && y !== null) return [x, y]; }
  }
  return null;
}

/** The well's location: WGS 84 as the platform normalised it, else the as-ingested position reprojected when its CRS is known. */
export function locationFromOsdu(data: Readonly<Record<string, unknown>>, problems: DataProblem[], wellId: string): CanonicalWell["location"] {
  const spatial = isObject(data.SpatialLocation) ? data.SpatialLocation : null;
  const ingested = spatial && isObject(spatial.AsIngestedCoordinates) ? spatial.AsIngestedCoordinates : null;
  const crs = ingested ? crsFromReference(str(ingested.CoordinateReferenceSystemID) ?? str(ingested.persistableReferenceCrs)) : null;
  const own = ingested ? firstPoint(ingested) : null;
  const projected = own && crs ? { crs, easting: own[0], northing: own[1] } : undefined;
  const wgs = spatial ? firstPoint(spatial.Wgs84Coordinates) : null;
  if (wgs) return { longitude: wgs[0], latitude: wgs[1], ...(projected ? { projected } : {}) };
  if (!own) return null;
  if (!crs) { problems.push({ object: "well", id: wellId, severity: "warning", message: "No WGS 84 location, and the as-ingested position names no CRS the adapter can read: the well is listed, not placed." }); return null; }
  if (crs === "EPSG:4326") return { longitude: own[0], latitude: own[1] };
  if (!knownCrs(crs)) { problems.push({ object: "well", id: wellId, severity: "warning", message: `No WGS 84 location, and its CRS ${crs} is not known here: the well is listed, not placed.` }); return null; }
  try {
    const [longitude, latitude] = reprojectGisXY(own, crs, "EPSG:4326");
    return { longitude, latitude, projected: projected! };
  } catch (cause) {
    problems.push({ object: "well", id: wellId, severity: "warning", message: `The as-ingested position in ${crs} could not be converted: ${cause instanceof Error ? cause.message : String(cause)}` });
    return null;
  }
}

/** A 1° cell for a well with no field, so wells without one still group into sites of bounded size. */
export const cellField = (longitude: number, latitude: number) => { const lat = Math.floor(latitude), lon = Math.floor(longitude); return { id: `osdu-cell:${lat}:${lon}`, name: `Unassigned ${Math.abs(lat)}°${lat < 0 ? "S" : "N"} ${Math.abs(lon)}°${lon < 0 ? "W" : "E"}` }; };

// ── Records to the contract ───────────────────────────────────────────────────────────────────
const provenanceOf = (record: OsduRecord, partition: string) => ({ kind: "tenant" as const, source: `OSDU ${partition}, ${record.kind}`, record: { standard: "OSDU" as const, kind: record.kind, id: record.id } });

export function wellFromOsdu(record: OsduRecord, partition: string, fieldNames: ReadonlyMap<string, string>, problems: DataProblem[]): CanonicalWell {
  const data = record.data;
  const id = refToId(record.id);
  const aliases = Array.isArray(data.NameAliases) ? data.NameAliases.filter(isObject) : [];
  const name = str(data.FacilityName) ?? aliases.map((alias) => str(alias.AliasName)).find(Boolean) ?? id.split(":").pop() ?? id;
  const uwi = aliases.find((alias) => /UWI|API|Unique Well/i.test(endOfRef(str(alias.AliasNameTypeID))))?.AliasName;
  const contexts = Array.isArray(data.GeoContexts) ? data.GeoContexts.filter(isObject) : [];
  const fieldRef = contexts.map((context) => str(context.FieldID)).find(Boolean);
  const location = locationFromOsdu(data, problems, id);
  const field = fieldRef ? { id: refToId(fieldRef), name: fieldNames.get(refToId(fieldRef)) ?? endOfRef(fieldRef) } : location ? cellField(location.longitude, location.latitude) : null;
  const environment = /offshore/i.test(endOfRef(str(data.OperatingEnvironmentID))) ? "offshore" as const : /onshore/i.test(endOfRef(str(data.OperatingEnvironmentID))) ? "onshore" as const : null;
  const measurements = Array.isArray(data.VerticalMeasurements) ? data.VerticalMeasurements.filter(isObject) : [];
  const ground = measurements.find((entry) => /ground level/i.test(endOfRef(str(entry.VerticalMeasurementTypeID))) || str(entry.VerticalMeasurementID) === "GL");
  const groundValue = ground ? num(ground.VerticalMeasurement) : null;
  const groundElevationM = ground && groundValue !== null ? lengthToMetres(groundValue, str(ground.VerticalMeasurementUnitOfMeasureID)) : null;
  const operator = endOfRef(str(data.CurrentOperatorID));
  return {
    id, name, field, ...(operator ? { operator } : {}), ...(typeof uwi === "string" && uwi ? { uwi } : {}),
    location, environment, waterDepthM: null, groundElevationM, provenance: provenanceOf(record, partition),
  };
}

const DATUM_KINDS: readonly (readonly [RegExp, DepthDatum["reference"]])[] = [[/rotary table|rkb/i, "RKB"], [/kelly bushing|\bkb\b/i, "KB"], [/derrick floor|drill floor|\bdf\b/i, "DF"], [/ground level|\bgl\b/i, "GL"], [/mean sea level|\bmsl\b/i, "MSL"]];

/**
 * The wellbore's depth datum from its vertical measurements: the default one, and its elevation
 * above mean sea level found by following `VerticalReferenceID` from entry to entry until one
 * stands on sea level (or names no reference, which the schema takes as sea level).
 */
export function datumFromVerticalMeasurements(data: Readonly<Record<string, unknown>>, problems: DataProblem[], wellboreId: string): DepthDatum {
  const measurements = Array.isArray(data.VerticalMeasurements) ? data.VerticalMeasurements.filter(isObject) : [];
  const byId = new Map(measurements.map((entry) => [str(entry.VerticalMeasurementID) ?? "", entry]));
  const defaultId = str(data.DefaultVerticalMeasurementID);
  const start = (defaultId && byId.get(defaultId)) ?? measurements.find((entry) => DATUM_KINDS.some(([pattern]) => pattern.test(`${endOfRef(str(entry.VerticalMeasurementTypeID))} ${str(entry.VerticalMeasurementID) ?? ""}`)));
  if (!start) { problems.push({ object: "wellbore", id: wellboreId, severity: "warning", message: "No vertical measurement names the depth datum: depths are kept from an unstated datum." }); return { reference: "other", elevationM: null }; }
  const kindOf = (entry: Record<string, unknown>) => DATUM_KINDS.find(([pattern]) => pattern.test(`${endOfRef(str(entry.VerticalMeasurementTypeID))} ${str(entry.VerticalMeasurementID) ?? ""}`))?.[1] ?? "other";
  let elevationM = 0, entry: Record<string, unknown> | undefined = start, hops = 0;
  while (entry) {
    const value = num(entry.VerticalMeasurement);
    const metres = value === null ? null : lengthToMetres(value, str(entry.VerticalMeasurementUnitOfMeasureID));
    if (metres === null) { problems.push({ object: "wellbore", id: wellboreId, severity: "warning", message: `The ${str(entry.VerticalMeasurementID) ?? "datum"} measurement has no value or a unit the adapter does not know: the datum's elevation is not given.` }); return { reference: kindOf(start), elevationM: null }; }
    elevationM += metres;
    const next = str(entry.VerticalReferenceID);
    if (!next || /mean sea level|msl/i.test(endOfRef(str(entry.VerticalCRSID)) + " " + next) && !byId.has(next)) break;
    if (++hops > 10) { problems.push({ object: "wellbore", id: wellboreId, severity: "warning", message: "The datum's references loop: its elevation is not given." }); return { reference: kindOf(start), elevationM: null }; }
    entry = byId.get(next);
  }
  return { reference: kindOf(start), elevationM, description: `${endOfRef(str(start.VerticalMeasurementTypeID)) || str(start.VerticalMeasurementID) || "datum"} from the wellbore's vertical measurements` };
}

/** Total depth in metres MD from the wellbore's vertical measurements, or null. */
export function totalDepthFromOsdu(data: Readonly<Record<string, unknown>>): number | null {
  const measurements = Array.isArray(data.VerticalMeasurements) ? data.VerticalMeasurements.filter(isObject) : [];
  const td = measurements.find((entry) => /total depth|\btd\b/i.test(`${endOfRef(str(entry.VerticalMeasurementTypeID))} ${str(entry.VerticalMeasurementID) ?? ""}`) && !/true vertical/i.test(endOfRef(str(entry.VerticalMeasurementPathID))));
  const value = td ? num(td.VerticalMeasurement) : null;
  return td && value !== null ? lengthToMetres(value, str(td.VerticalMeasurementUnitOfMeasureID)) : null;
}

export function wellboreFromOsdu(record: OsduRecord, partition: string, problems: DataProblem[]): CanonicalWellbore {
  const id = refToId(record.id);
  const data = record.data;
  const state = JSON.stringify(data.FacilityStates ?? data.FacilityOperators ?? "");
  return {
    id, wellId: refToId(str(data.WellID) ?? ""), name: str(data.FacilityName) ?? id.split(":").pop() ?? id,
    status: /planned|proposed/i.test(state) ? "planned" : /drilling|active/i.test(state) ? "drilling" : "drilled",
    datum: datumFromVerticalMeasurements(data, problems, id), totalDepthMdM: totalDepthFromOsdu(data), provenance: provenanceOf(record, partition),
  };
}

/** The rows of a bulk table as objects by column name, whatever orientation the DDMS answered in. */
export function tableRows(table: OsduTable): readonly Readonly<Record<string, unknown>>[] {
  // Rows that are not objects (a null in a hand-written table) are skipped, not read.
  if (Array.isArray(table)) return table.filter(isObject);
  if (isObject(table) && Array.isArray(table.columns) && Array.isArray(table.data)) {
    const columns = table.columns as readonly string[];
    return (table.data as readonly (readonly unknown[])[]).map((row) => Object.fromEntries(columns.map((column, i) => [column, row[i]])));
  }
  if (isObject(table)) {
    const byColumn = table as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    const columns = Object.keys(byColumn).filter((column) => isObject(byColumn[column]));
    const first = columns[0] ? Object.keys(byColumn[columns[0]]!) : [];
    return first.map((key) => Object.fromEntries(columns.map((column) => [column, byColumn[column]![key]]))).filter(isObject);
  }
  return [];
}

type StationField = "md" | "inc" | "aziTN" | "aziGN" | "tvd" | "north" | "east" | "x" | "y";
const PROPERTY_FIELDS: readonly (readonly [RegExp, StationField])[] = [
  [/^(md|measured ?depth|depth)$/i, "md"], [/^(incl?|inclination)$/i, "inc"], [/^(azimuth ?tn|azim_?tn|azimuthtn|azimuth true( north)?)$/i, "aziTN"], [/^(azimuth ?gn|azim_?gn|azimuthgn|azimuth grid( north)?)$/i, "aziGN"],
  [/^(azi|azim|azimuth)$/i, "aziGN"], [/^(tvd|true ?vertical ?depth)$/i, "tvd"], [/^(dy|disp ?ns|ns|northing|north|delta ?north)$/i, "north"], [/^(dx|disp ?ew|ew|easting|east|delta ?east)$/i, "east"], [/^(x|utm ?x)$/i, "x"], [/^(y|utm ?y)$/i, "y"],
];
const fieldOf = (name: string): StationField | null => PROPERTY_FIELDS.find(([pattern]) => pattern.test(name.trim()))?.[1] ?? null;

/**
 * A trajectory record and its bulk stations as the contract's trajectory. Columns are mapped
 * through `AvailableTrajectoryStationProperties` (type, name and unit), or by common column names
 * when the record lists none. Lengths become metres and angles degrees; a column in a unit the
 * adapter does not know is dropped and said so. Absolute X/Y become offsets from the first station.
 */
export function trajectoryFromOsdu(record: OsduRecord, table: OsduTable, partition: string, problems: DataProblem[], options: { readonly definitive?: boolean } = {}): CanonicalTrajectory | null {
  const data = record.data;
  const id = refToId(record.id);
  const wellboreId = refToId(str(data.WellboreID) ?? "");
  const properties = Array.isArray(data.AvailableTrajectoryStationProperties) ? data.AvailableTrajectoryStationProperties.filter(isObject) : [];
  // Which column holds which field, and the factor to metres or degrees.
  const columns = new Map<StationField, { readonly name: string; readonly factor: number }>();
  const listed = properties.length ? properties.map((property) => ({ name: str(property.Name) ?? "", type: endOfRef(str(property.TrajectoryStationPropertyTypeID)), unit: str(property.StationPropertyUnitID) })) : [];
  const rows = tableRows(table);
  const sample = rows[0] ?? {};
  const candidates = listed.length ? listed : Object.keys(sample).map((name) => ({ name, type: name, unit: undefined }));
  for (const candidate of candidates) {
    const field = fieldOf(candidate.type) ?? fieldOf(candidate.name);
    if (!field || columns.has(field) || !(candidate.name in sample)) continue;
    const factor = field === "inc" || field === "aziTN" || field === "aziGN" ? degreesPer(candidate.unit) : metresPer(candidate.unit);
    if (factor === null) { problems.push({ object: "trajectory", id, severity: "warning", message: `Column ${candidate.name} is in a unit the adapter does not know (${endOfRef(candidate.unit)}): left out.` }); continue; }
    columns.set(field, { name: candidate.name, factor });
  }
  const md = columns.get("md");
  if (!md) { problems.push({ object: "trajectory", id, severity: "error", message: `No measured-depth column among ${Object.keys(sample).join(", ") || "none"}: the path cannot be read.` }); return null; }
  const read = (row: Readonly<Record<string, unknown>>, field: StationField) => { const column = columns.get(field); if (!column) return undefined; const value = num(row[column.name]); return value === null ? undefined : value * column.factor; };
  const azimuthReference: CanonicalTrajectory["azimuthReference"] = columns.has("aziTN") ? "true" : columns.has("aziGN") ? (/true/i.test(endOfRef(str(data.AzimuthReferenceType))) ? "true" : /grid/i.test(endOfRef(str(data.AzimuthReferenceType))) ? "grid" : "unknown") : "unknown";
  const origin = rows.length && columns.has("x") && columns.has("y") ? { x: read(rows[0]!, "x") ?? 0, y: read(rows[0]!, "y") ?? 0 } : null;
  const stations: TrajectoryStation[] = [];
  for (const row of rows) {
    const mdM = read(row, "md");
    if (mdM === undefined) continue;
    const inclinationDeg = read(row, "inc"), azimuthDeg = read(row, "aziTN") ?? read(row, "aziGN"), tvdM = read(row, "tvd");
    const northM = read(row, "north") ?? (origin ? (read(row, "y") ?? origin.y) - origin.y : undefined), eastM = read(row, "east") ?? (origin ? (read(row, "x") ?? origin.x) - origin.x : undefined);
    stations.push({ mdM, ...(inclinationDeg !== undefined ? { inclinationDeg } : {}), ...(azimuthDeg !== undefined ? { azimuthDeg } : {}), ...(tvdM !== undefined ? { tvdM } : {}), ...(northM !== undefined ? { northM } : {}), ...(eastM !== undefined ? { eastM } : {}) });
  }
  stations.sort((a, b) => a.mdM - b.mdM);
  return { id, wellboreId, name: str(data.Name) ?? "Trajectory", kind: options.definitive ? "definitive" : /plan/i.test(str(data.Name) ?? "") ? "planned" : "survey", azimuthReference, stations, provenance: provenanceOf(record, partition) };
}

/** A marker set record, with its markers inline or from the bulk table. */
export function markerSetFromOsdu(record: OsduRecord, table: OsduTable | null, partition: string, problems: DataProblem[]): CanonicalMarkerSet {
  const data = record.data;
  const id = refToId(record.id);
  const unit = isObject(data.VerticalMeasurement) ? str(data.VerticalMeasurement.VerticalMeasurementUnitOfMeasureID) : undefined;
  const factor = metresPer(unit);
  if (factor === null) problems.push({ object: "markers", id, severity: "warning", message: `Marker depths are in a unit the adapter does not know (${endOfRef(unit)}): taken as metres.` });
  const toM = factor ?? 1;
  const kindOf = (typeRef: string | undefined): CanonicalMarker["kind"] => { const type = endOfRef(typeRef); return /contact|fluid|owc|gwc|goc/i.test(type) ? "contact" : /group/i.test(type) ? "group" : /formation|top|strat|member/i.test(type) || !type ? "formation" : "other"; };
  const inline = Array.isArray(data.Markers) ? data.Markers.filter(isObject) : [];
  const rows = inline.length ? inline : table ? tableRows(table) : [];
  const markers: CanonicalMarker[] = [];
  rows.forEach((row, i) => {
    const mdValue = num(row.MarkerMeasuredDepth ?? row.MD ?? row.MeasuredDepth ?? row.md);
    if (mdValue === null) return;
    const tvd = num(row.MarkerTrueVerticalDepth ?? row.TVD);
    markers.push({ id: `${id}:${i}`, name: str(row.MarkerName) ?? str(row.Name) ?? `Marker ${i + 1}`, mdM: mdValue * toM, ...(tvd !== null ? { tvdM: tvd * toM } : {}), kind: kindOf(str(row.MarkerTypeID) ?? str(row.MarkerType)), ...(str(row.LithologyID) ? { lithology: endOfRef(str(row.LithologyID)) } : {}) });
  });
  return { id, wellboreId: refToId(str(data.WellboreID) ?? ""), name: str(data.Name) ?? "Markers", markers, provenance: provenanceOf(record, partition) };
}

// ── The source ────────────────────────────────────────────────────────────────────────────────
interface SearchResponse { readonly results?: readonly OsduRecord[]; readonly cursor?: string | null; readonly totalCount?: number }

/** What a failure means to the reader, in the platform's own terms. */
export function describeOsduError(cause: unknown, partition: string, baseUrl: string): string {
  if (cause instanceof HttpError) {
    if (cause.status === 401) return "Sign-in expired: sign in again.";
    if (cause.status === 403) return `No access to partition ${partition}: the account needs the platform's entitlement groups (users.datalake.viewers or a data group) for it.`;
    if (cause.status === 400 && /cursor/i.test(cause.bodyText)) return "The listing's cursor expired on the platform: read again.";
    return cause.message;
  }
  if (cause instanceof TypeError) return `The browser could not reach ${baseUrl}: blocked by CORS on the platform (its allowed origins must include this deck's), or by this deployment's Content-Security-Policy connect-src.`;
  // A thrown non-Error (a rejected promise's bare value) is named as such, never "[object Object]" to the reader.
  return cause instanceof Error ? cause.message : typeof cause === "string" && cause.trim() ? cause : "The platform's reply could not be read (an error with no message).";
}

export function osduSource(options: OsduSourceOptions): WellDataSource {
  const { id, baseUrl, dataPartition, auth, query = "", pageSize = 1000, concurrency = 6, timeoutMs, fetcher } = options;
  const paths = { ...OSDU_DEFAULTS.paths, ...options.paths }, kinds = { ...OSDU_DEFAULTS.kinds, ...options.kinds };
  const base = baseUrl.replace(/\/$/, "");
  const run = limit(concurrency);
  const fieldNames = new Map<string, string>();

  const call = (path: string, init: { readonly method?: "GET" | "POST"; readonly body?: unknown; readonly signal?: AbortSignal }) => run(async () => {
    try {
      return await fetchJsonGuarded(`${base}${path}`, { method: init.method ?? "GET", headers: { "content-type": "application/json", "data-partition-id": dataPartition }, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}), ...(auth ? { auth } : {}), ...(timeoutMs ? { timeoutMs } : {}), ...(fetcher ? { fetcher } : {}), ...(init.signal ? { signal: init.signal } : {}) });
    } catch (cause) {
      if (init.signal?.aborted) throw cause;
      throw new Error(describeOsduError(cause, dataPartition, base), { cause });
    }
  });
  const search = async (body: { kind: string; query: string; limit?: number; cursor?: string; returnedFields?: readonly string[] }, signal?: AbortSignal): Promise<SearchResponse> => {
    const response = await call(`${paths.search}/query_with_cursor`, { method: "POST", body: { limit: pageSize, ...body }, signal });
    return isObject(response) ? response as SearchResponse : {};
  };
  /** Every page of a query, for the detail queries that may run past one page. */
  const searchAll = async (body: { kind: string; query: string; returnedFields?: readonly string[] }, signal?: AbortSignal): Promise<readonly OsduRecord[]> => {
    const out: OsduRecord[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 1000; page++) {
      const response = await search({ ...body, ...(cursor ? { cursor } : {}) }, signal);
      out.push(...(response.results ?? []));
      if (!response.cursor || !response.results?.length || response.results.length < pageSize) break;
      cursor = response.cursor;
    }
    return out;
  };
  const idList = (ids: readonly string[]) => ids.map((value) => `"${value}:" OR "${value}"`).join(" OR ");
  const chunks = <T>(list: readonly T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
  const byField = async (field: string, ids: readonly string[], kind: string, returnedFields: readonly string[] | undefined, signal?: AbortSignal) =>
    (await Promise.all(chunks(ids, 50).map((chunk) => searchAll({ kind, query: `${field}:(${idList(chunk)})`, ...(returnedFields ? { returnedFields } : {}) }, signal)))).flat();

  const WELL_FIELDS = ["id", "kind", "version", "data.FacilityName", "data.NameAliases", "data.GeoContexts", "data.SpatialLocation", "data.OperatingEnvironmentID", "data.CurrentOperatorID", "data.VerticalMeasurements", "data.DefaultVerticalMeasurementID"];
  /** Well records to the contract, after their fields are named and their positions' CRSs made ready. */
  const wellsOf = async (results: readonly OsduRecord[], problems: DataProblem[], signal?: AbortSignal) => {
    const fieldRefs = [...new Set(results.flatMap((record) => (Array.isArray(record.data.GeoContexts) ? record.data.GeoContexts.filter(isObject) : []).map((context) => str(context.FieldID)).filter((ref): ref is string => !!ref).map(refToId)))].filter((ref) => !fieldNames.has(ref));
    if (fieldRefs.length) for (const found of await byField("id", fieldRefs, kinds.field, ["id", "data.FieldName"], signal)) fieldNames.set(refToId(found.id), str(found.data.FieldName) ?? endOfRef(found.id));
    const crsCodes = [...new Set(results.map((record) => { const spatial = isObject(record.data.SpatialLocation) ? record.data.SpatialLocation : null; const ingested = spatial && isObject(spatial.AsIngestedCoordinates) ? spatial.AsIngestedCoordinates : null; return ingested ? crsFromReference(str(ingested.CoordinateReferenceSystemID)) : null; }).filter((code): code is string => !!code))];
    if (crsCodes.length) await ensureCrs(crsCodes);
    return results.map((record) => wellFromOsdu(record, dataPartition, fieldNames, problems));
  };

  return {
    id, label: options.label ?? `OSDU ${dataPartition}`, standard: "OSDU Search and Wellbore DDMS",
    headers: async (cursor, signal) => {
      const response = await search({ kind: kinds.well, query: query || "*", ...(cursor ? { cursor } : {}), returnedFields: WELL_FIELDS }, signal);
      const results = response.results ?? [];
      const problems: DataProblem[] = [];
      const wells = await wellsOf(results, problems, signal);
      // A platform may hand back a cursor on its last page; a short page ends the listing.
      const next = response.cursor && results.length >= pageSize ? response.cursor : null;
      return { wells, next, ...(typeof response.totalCount === "number" ? { total: response.totalCount } : {}), ...(problems.length ? { problems } : {}) } as HeaderPage & { readonly problems?: readonly DataProblem[] };
    },
    detail: async (wellIds, signal) => {
      // The wells themselves (the bundle carries the well whole) and their wellbores, each one batched query per 50 ids.
      const [wellRecords, wellbores] = await Promise.all([byField("id", wellIds, kinds.well, WELL_FIELDS, signal), byField("data.WellID", wellIds, kinds.wellbore, undefined, signal)]);
      const headerProblems: DataProblem[] = [];
      const wellsById = new Map((await wellsOf(wellRecords, headerProblems, signal)).map((entry) => [entry.id, entry]));
      const boreIds = wellbores.map((record) => refToId(record.id));
      const [trajectories, markerSets] = await Promise.all([
        byField("data.WellboreID", boreIds, kinds.trajectory, undefined, signal),
        byField("data.WellboreID", boreIds, kinds.markerSet, undefined, signal),
      ]);
      const boresByWell = new Map<string, OsduRecord[]>();
      for (const record of wellbores) { const wellId = refToId(str(record.data.WellID) ?? ""); boresByWell.set(wellId, [...(boresByWell.get(wellId) ?? []), record]); }
      const perBore = <T extends OsduRecord>(list: readonly T[]) => { const map = new Map<string, T[]>(); for (const record of list) { const boreId = refToId(str(record.data.WellboreID) ?? ""); map.set(boreId, [...(map.get(boreId) ?? []), record]); } return map; };
      const trajectoriesByBore = perBore(trajectories), markersByBore = perBore(markerSets);
      const bulk = (kind: "wellboretrajectories" | "wellboremarkersets", recordId: string) => call(`${paths.wellboreDdms}/ddms/v3/${kind}/${encodeURIComponent(recordId)}/data`, { signal }) as Promise<OsduTable>;

      return Promise.all(wellIds.map(async (wellId): Promise<WellBundle | null> => {
        const bores = boresByWell.get(wellId) ?? [];
        if (!bores.length) return null;
        const problems: DataProblem[] = [];
        const wellbores = await Promise.all(bores.map(async (boreRecord) => {
          const wellbore = wellboreFromOsdu(boreRecord, dataPartition, problems);
          const definitiveRef = str(boreRecord.data.DefinitiveTrajectoryID);
          const candidates = [...(trajectoriesByBore.get(wellbore.id) ?? [])].sort((a, b) => Date.parse(b.modifyTime ?? "") - Date.parse(a.modifyTime ?? "") || 0);
          const definitive = (definitiveRef && candidates.find((record) => refToId(record.id) === refToId(definitiveRef))) ?? candidates[0] ?? null;
          // Only the definitive path is read: the wellbore's named one, else the most recently changed.
          const read: CanonicalTrajectory[] = [];
          if (definitive) {
            try {
              const trajectory = trajectoryFromOsdu(definitive, await bulk("wellboretrajectories", refToId(definitive.id)), dataPartition, problems, { definitive: true });
              if (trajectory) read.push(trajectory);
            } catch (cause) {
              problems.push({ object: "trajectory", id: refToId(definitive.id), severity: "error", message: `The path could not be read from the Wellbore DDMS: ${cause instanceof Error ? cause.message : String(cause)}` });
            }
          }
          const sets: CanonicalMarkerSet[] = [];
          for (const record of markersByBore.get(wellbore.id) ?? []) {
            try {
              const inline = Array.isArray(record.data.Markers) && record.data.Markers.length > 0;
              sets.push(markerSetFromOsdu(record, inline ? null : await bulk("wellboremarkersets", refToId(record.id)), dataPartition, problems));
            } catch (cause) {
              problems.push({ object: "markers", id: refToId(record.id), severity: "warning", message: `The markers could not be read from the Wellbore DDMS: ${cause instanceof Error ? cause.message : String(cause)}` });
            }
          }
          return { wellbore, trajectories: read, markerSets: sets };
        }));
        const well = wellsById.get(wellId);
        if (!well) { problems.push({ object: "well", id: wellId, severity: "warning", message: "The well record itself was not served, only its wellbores: named after the first." }); }
        problems.push(...headerProblems.filter((problem) => problem.id === wellId));
        return { well: well ?? { id: wellId, name: wellbores[0]!.wellbore.name, field: null, location: null, environment: null, waterDepthM: null, groundElevationM: null, provenance: provenanceOf(bores[0]!, dataPartition) }, wellbores, ...(problems.length ? { problems } : {}) };
      })).then((bundles) => bundles.filter((bundle): bundle is WellBundle => bundle !== null));
    },
  };
}
