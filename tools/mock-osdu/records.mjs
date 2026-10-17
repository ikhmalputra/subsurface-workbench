// The stress tenant as OSDU records: one field at a time, on demand, deterministic.
//
// Field f is `tenant({ wells, stations, perField: wells, seed: 7 + f })` from ../stress/tenant.mjs,
// renamed and moved exactly as writeTenant does, so the mock platform and the contract-json stress
// tenant hold the same wells at the same places. A few fields are kept in a cache; 200,000 wells
// never sit in memory.
//
// Four profiles: clean (OSDU as its well-known schemas describe it), quirky (what a real tenant
// does: feet, true-north azimuths, as-ingested positions only, chained datums, its own column
// names, references without the colon, wells with no field), hostile (names and ids built to
// break a reader), huge (clean, at 200,000 wells and 2,000 stations).
import { tenant } from "../stress/tenant.mjs";

export const PROFILES = ["clean", "quirky", "hostile", "huge"];

export const KINDS = Object.freeze({
  well: "osdu:wks:master-data--Well:1.3.0",
  field: "osdu:wks:master-data--Field:1.0.0",
  wellbore: "osdu:wks:master-data--Wellbore:1.5.0",
  trajectory: "osdu:wks:work-product-component--WellboreTrajectory:1.3.0",
  markerSet: "osdu:wks:work-product-component--WellboreMarkerSet:1.2.0",
});
export const FAMILIES = Object.keys(KINDS);

const OPERATORS = ["Equinor", "Aker BP", "Var Energi", "ConocoPhillips", "TotalEnergies", "Wintershall Dea"];
const FT = 0.3048;

// ── Hostile strings ───────────────────────────────────────────────────────────────────────────
// Each is a string a naive reader would execute, mis-render or choke on. They go verbatim into
// names, fields, operators and markers; a view that shows them as text, no more, passes.
export const HOSTILE_STRINGS = Object.freeze([
  "<img src=x onerror=__xss()>",
  "\"><svg onload=__xss()>",
  "javascript:__xss()",
  "{{constructor.constructor('__xss()')()}}",
  "Well ‮gnp.exe",
  "Zero​width‍ joiner﻿",
  "'; DROP TABLE wells; --",
  "${7*7} #{7*7} %00",
]);
export const HOSTILE_IDS = Object.freeze(["__proto__", "constructor"]);
const GIANT_NAME_LENGTH = 100_000;

// ── ED50 / UTM zone 31N (EPSG:23031) for the as-ingested position ─────────────────────────────
// WGS 84 → ECEF → Helmert (the inverse of +towgs84=-87,-98,-121) → International 1924 → UTM 31N.
const WGS84 = { a: 6378137, f: 1 / 298.257223563 }, INTL = { a: 6378388, f: 1 / 297 };
const rad = Math.PI / 180;
function toEcef(lon, lat, { a, f }) {
  const e2 = f * (2 - f), p = lat * rad, l = lon * rad, n = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  return [n * Math.cos(p) * Math.cos(l), n * Math.cos(p) * Math.sin(l), n * (1 - e2) * Math.sin(p)];
}
function fromEcef([x, y, z], { a, f }) {
  const e2 = f * (2 - f), lon = Math.atan2(y, x), r = Math.hypot(x, y);
  let lat = Math.atan2(z, r * (1 - e2));
  for (let i = 0; i < 6; i++) { const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2); lat = Math.atan2(z + e2 * n * Math.sin(lat), r); }
  return [lon / rad, lat / rad];
}
function transverseMercator(lon, lat, { a, f }, lon0, k0 = 0.9996, falseEasting = 500_000) {
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2), p = lat * rad, dl = (lon - lon0) * rad;
  const sin = Math.sin(p), cos = Math.cos(p), tan = Math.tan(p);
  const n = a / Math.sqrt(1 - e2 * sin * sin), t = tan * tan, c = ep2 * cos * cos, A = dl * cos;
  const e4 = e2 * e2, e6 = e4 * e2;
  const m = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * p - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * p) + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * p) - (35 * e6 / 3072) * Math.sin(6 * p));
  const x = falseEasting + k0 * n * (A + (1 - t + c) * A ** 3 / 6 + (5 - 18 * t + t * t + 72 * c - 58 * ep2) * A ** 5 / 120);
  const y = k0 * (m + n * tan * (A * A / 2 + (5 - t + 9 * c + 4 * c * c) * A ** 4 / 24 + (61 - 58 * t + t * t + 600 * c - 330 * ep2) * A ** 6 / 720));
  return [x, y];
}
/** [easting, northing] in ED50 / UTM zone 31N for a WGS 84 position. */
export function toEd50Utm31([lon, lat]) {
  const [x, y, z] = toEcef(lon, lat, WGS84);
  const [lon50, lat50] = fromEcef([x + 87, y + 98, z + 121], INTL);
  const [e, n] = transverseMercator(lon50, lat50, INTL, 3);
  return [+e.toFixed(2), +n.toFixed(2)];
}

// ── The tenant, per field ─────────────────────────────────────────────────────────────────────
/** writeTenant's rename: field f's well i is `t${f*perField+i}` in field `f${f}`, moved to its own place. */
function fieldBundles(f, { wells, perField, stations }) {
  return tenant({ wells, stations, perField, seed: 7 + f }).wells.map((bundle, i) => {
    const id = `t${f * perField + i}`;
    const renamed = JSON.parse(JSON.stringify(bundle).replaceAll(`"t${i}"`, `"${id}"`).replaceAll(`"t${i}-`, `"${id}-`).replaceAll('"f0"', `"f${f}"`).replaceAll('"Field 0"', `"Field ${f}"`).replaceAll(`"T-0-${i}"`, `"T-${f}-${i}"`));
    renamed.well.location = { longitude: +(renamed.well.location.longitude + (f % 40) * 0.4).toFixed(6), latitude: +(renamed.well.location.latitude + Math.floor(f / 40) * 0.3).toFixed(6) };
    return renamed;
  });
}

/**
 * Field f's records, built from the stress tenant. `wells` is how many wells the field holds (the
 * last field of a tenant may be short); `perField` is the tenant's wells per field, which numbers the ids. The result holds the field record, and per well its Well,
 * Wellbore, WellboreTrajectory and WellboreMarkerSet records, and the bulk tables behind the last
 * two. Record ids follow OSDU: `<partition>:<group>--<Entity>:<name>`; a reference to one is the id
 * with a trailing colon (the quirky profile leaves the colon off, as some tenants do).
 */
export function recordsForField(f, { wells = 200, perField = wells, stations = 300, profile = "clean", partition = "opendes" } = {}) {
  if (!PROFILES.includes(profile)) throw new RangeError(`unknown profile ${profile}`);
  if (wells > perField) throw new RangeError("a field holds at most perField wells");
  const quirky = profile === "quirky", hostile = profile === "hostile";
  const ref = (group, entity, name) => `${partition}:${group}--${entity}:${name}${quirky ? "" : ":"}`;
  const refData = (type, value) => ref("reference-data", type, value);
  const UOM = { m: refData("UnitOfMeasure", "m"), ft: refData("UnitOfMeasure", "ft"), dega: refData("UnitOfMeasure", "dega") };
  const lengthUnit = quirky ? UOM.ft : UOM.m;
  const length = (metres) => quirky ? +(metres / FT).toFixed(2) : metres;
  const MSL_CRS = refData("CoordinateReferenceSystem", "Vertical:EPSG::5714");
  const time = new Date(Date.UTC(2024, 0, 1 + (f % 365))).toISOString();
  const meta = { version: 1, createTime: time, modifyTime: time, acl: { viewers: [`data.default.viewers@${partition}.example.com`], owners: [`data.default.owners@${partition}.example.com`] }, legal: { legaltags: [`${partition}-public-usa-dataset-1`], otherRelevantDataCountries: ["NO"], status: "compliant" } };

  // Hostile names cycle through the strings; wells 1 and 2 of field 0 take the prototype ids; well 3 of field 0 a 100,000-character name.
  const hostileName = (i, fallback) => hostile ? HOSTILE_STRINGS[i % HOSTILE_STRINGS.length] : fallback;
  const wellName = (i, fallback) => hostile && f === 0 && i === 3 ? "A".repeat(GIANT_NAME_LENGTH) : hostile && i % 3 === 0 ? hostileName(i, fallback) : fallback;
  const wellKey = (i, id) => hostile && f === 0 && i >= 1 && i <= HOSTILE_IDS.length ? HOSTILE_IDS[i - 1] : id;

  const bundles = fieldBundles(f, { wells, perField, stations });
  const fieldName = hostile && f === 0 ? HOSTILE_STRINGS[0] : `Field ${f}`;
  const fieldRecord = { id: `${partition}:master-data--Field:f${f}`, kind: KINDS.field, ...meta, data: { FieldName: fieldName, FieldDescription: "Synthetic stress-test field (not real data)" } };

  const out = { f, wells: bundles.length, field: fieldRecord, well: [], wellbore: [], trajectory: [], markerSet: [], bulk: new Map(), keys: new Map() };
  const trajectoryColumns = quirky
    ? [["MD", "MeasuredDepth", UOM.ft], ["Inclination", "Inclination", UOM.dega], ["AzimuthTN", "AZIM_TN", UOM.dega], ["TVD", "TVD", UOM.ft], ["DY", "DispNS", UOM.ft], ["DX", "DispEW", UOM.ft]]
    : [["MD", "MD", UOM.m], ["Inclination", "INCL", UOM.dega], ["AzimuthGN", "AZIM", UOM.dega], ["TVD", "TVD", UOM.m], ["DX", "DX", UOM.m], ["DY", "DY", UOM.m]];

  bundles.forEach((bundle, i) => {
    const key = wellKey(i, bundle.well.id);
    const wellId = `${partition}:master-data--Well:${key}`, wellboreId = `${partition}:master-data--Wellbore:${key}`;
    const trajectoryId = `${partition}:work-product-component--WellboreTrajectory:${key}-def`, markerSetId = `${partition}:work-product-component--WellboreMarkerSet:${key}-tops`;
    out.keys.set(key, i);
    const name = wellName(i, bundle.well.name);
    const operator = hostile && i % 5 === 0 ? HOSTILE_STRINGS[(i + 2) % HOSTILE_STRINGS.length] : OPERATORS[(f + i) % OPERATORS.length];
    const { longitude, latitude } = bundle.well.location;
    const [easting, northing] = toEd50Utm31([longitude, latitude]);
    const point = (coordinates) => ({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates }, properties: {} }] });
    const spatial = {
      ...(quirky ? {} : { Wgs84Coordinates: point([longitude, latitude]) }),
      AsIngestedCoordinates: { ...point([easting, northing]), CoordinateReferenceSystemID: refData("CoordinateReferenceSystem", "Projected:EPSG::23031"), persistableReferenceCrs: JSON.stringify({ authCode: { auth: "EPSG", code: "23031" }, name: "ED50 / UTM zone 31N", type: "LBC", ver: "PE_10_9_1" }) },
      SpatialLocationCoordinatesDate: time, QuantitativeAccuracyBandID: refData("QuantitativeAccuracyBand", "Within10m"), SpatialGeometryTypeID: refData("SpatialGeometryType", "Point"),
    };
    // Every tenth quirky well has no GeoContexts: the adapter must put it in a cell, not drop it.
    const contexts = quirky && i % 10 === 9 ? [] : [{ FieldID: ref("master-data", "Field", `f${f}`), GeoTypeID: refData("GeoPoliticalEntityType", "Field") }];
    out.well.push({ id: wellId, kind: KINDS.well, ...meta, data: {
      FacilityName: name,
      FacilityID: `${f}-${i}`,
      NameAliases: [{ AliasName: String(1_000_000 + f * perField + i), AliasNameTypeID: refData("AliasNameType", "UWI") }],
      GeoContexts: contexts,
      SpatialLocation: spatial,
      OperatingEnvironmentID: refData("OperatingEnvironment", "Offshore"),
      CurrentOperatorID: ref("master-data", "Organisation", operator),
      FacilityTypeID: refData("FacilityType", "Well"),
      FacilityStates: [{ FacilityStateTypeID: refData("FacilityStateType", "Producing") }],
      VerticalMeasurements: [{ VerticalMeasurementID: "GL", VerticalMeasurement: length(-bundle.well.waterDepthM), VerticalMeasurementTypeID: refData("VerticalMeasurementType", "Ground Level"), VerticalMeasurementUnitOfMeasureID: lengthUnit, VerticalCRSID: MSL_CRS, VerticalMeasurementDescription: "Seabed (synthetic)" }],
      DefaultVerticalMeasurementID: "GL",
    } });

    const bore = bundle.wellbores[0];
    const rkb = bore.wellbore.datum.elevationM, td = bore.wellbore.totalDepthMdM, water = bundle.well.waterDepthM;
    const measurements = quirky
      // Drill floor stands on ground level stands on sea level: the adapter follows the chain to the same height.
      ? [
        { VerticalMeasurementID: "DF", VerticalMeasurement: length(rkb + water), VerticalMeasurementTypeID: refData("VerticalMeasurementType", "Drill Floor"), VerticalMeasurementUnitOfMeasureID: UOM.ft, VerticalReferenceID: "GL" },
        { VerticalMeasurementID: "GL", VerticalMeasurement: length(-water), VerticalMeasurementTypeID: refData("VerticalMeasurementType", "Ground Level"), VerticalMeasurementUnitOfMeasureID: UOM.ft, VerticalReferenceID: "MSL", VerticalCRSID: MSL_CRS },
        { VerticalMeasurementID: "TD", VerticalMeasurement: length(td), VerticalMeasurementTypeID: refData("VerticalMeasurementType", "Total Depth"), VerticalMeasurementPathID: refData("VerticalMeasurementPath", "Measured Depth"), VerticalMeasurementUnitOfMeasureID: UOM.ft, VerticalReferenceID: "DF" },
      ]
      : [
        { VerticalMeasurementID: "RKB", VerticalMeasurement: rkb, VerticalMeasurementTypeID: refData("VerticalMeasurementType", "Kelly Bushing"), VerticalMeasurementUnitOfMeasureID: UOM.m, VerticalCRSID: MSL_CRS, VerticalMeasurementDescription: "Rotary Kelly bushing above mean sea level" },
        { VerticalMeasurementID: "TD", VerticalMeasurement: td, VerticalMeasurementTypeID: refData("VerticalMeasurementType", "Total Depth"), VerticalMeasurementPathID: refData("VerticalMeasurementPath", "Measured Depth"), VerticalMeasurementUnitOfMeasureID: UOM.m, VerticalReferenceID: "RKB" },
      ];
    out.wellbore.push({ id: wellboreId, kind: KINDS.wellbore, ...meta, data: {
      WellID: ref("master-data", "Well", key), FacilityName: name, SequenceNumber: 1,
      FacilityStates: [{ FacilityStateTypeID: refData("FacilityStateType", "Completed") }],
      VerticalMeasurements: measurements, DefaultVerticalMeasurementID: quirky ? "DF" : "RKB",
      DefinitiveTrajectoryID: `${trajectoryId}${quirky ? "" : ":"}`,
      TrajectoryTypeID: refData("WellboreTrajectoryType", "Directional"),
    } });

    const trajectory = bore.trajectories[0];
    out.trajectory.push({ id: trajectoryId, kind: KINDS.trajectory, ...meta, data: {
      WellboreID: ref("master-data", "Wellbore", key), Name: hostile && i % 4 === 0 ? hostileName(i + 1, "Definitive") : "Definitive",
      AzimuthReferenceType: refData("AzimuthReferenceType", quirky ? "True North" : "Grid North"),
      CalculationMethodType: refData("CalculationMethodType", "Minimum Curvature"),
      ProjectedCRSID: refData("CoordinateReferenceSystem", "Projected:EPSG::23031"),
      TopDepthMeasuredDepth: length(0), BaseDepthMeasuredDepth: length(td), VerticalMeasurement: { VerticalMeasurementUnitOfMeasureID: lengthUnit },
      AvailableTrajectoryStationProperties: trajectoryColumns.map(([type, column, unit]) => ({ TrajectoryStationPropertyTypeID: refData("TrajectoryStationPropertyType", type), Name: column, StationPropertyUnitID: unit })),
      Datasets: [ref("dataset", "FileCollection.Bulk", `${key}-def`)],
    } });
    const stations = trajectory.stations;
    const l = (value) => quirky ? +(value / FT).toFixed(3) : value;
    const rows = stations.map((s) => quirky
      ? [l(s.mdM), s.inclinationDeg, s.azimuthDeg, l(s.tvdM), l(s.northM), l(s.eastM)]
      : [s.mdM, s.inclinationDeg, s.azimuthDeg, s.tvdM, s.eastM, s.northM]);
    // One hostile path carries the numbers JSON cannot: the DDMS is Python, and json.dumps writes them as NaN and Infinity.
    if (hostile && f === 0 && i === 4 && rows.length > 8) { rows[5][0] = NaN; rows[6][0] = Infinity; rows[7][0] = 1e308; }
    out.bulk.set(trajectoryId, { columns: trajectoryColumns.map(([, column]) => column), rows });

    const markers = bore.markerSets[0].markers.map((marker, k) => ({
      MarkerName: hostile && (i + k) % 6 === 0 ? HOSTILE_STRINGS[(i + k) % HOSTILE_STRINGS.length] : marker.name,
      MarkerMeasuredDepth: length(marker.mdM),
      MarkerTypeID: refData("MarkerType", "Formation Top"),
      FeatureTypeID: refData("FeatureType", "Formation"),
    }));
    out.markerSet.push({ id: markerSetId, kind: KINDS.markerSet, ...meta, data: {
      WellboreID: ref("master-data", "Wellbore", key), Name: "Tops",
      VerticalMeasurement: { VerticalMeasurementUnitOfMeasureID: lengthUnit, VerticalMeasurementTypeID: refData("VerticalMeasurementType", quirky ? "Drill Floor" : "Kelly Bushing") },
      // A quirky tenant keeps its markers in bulk only; the schema allows both.
      ...(quirky ? {} : { Markers: markers }),
      AvailableMarkerProperties: ["MarkerName", "MarkerMeasuredDepth", "MarkerTypeID"].map((column) => ({ MarkerPropertyTypeID: refData("MarkerPropertyType", column), Name: column, MarkerPropertyUnitID: column === "MarkerMeasuredDepth" ? lengthUnit : undefined })),
      Datasets: [ref("dataset", "FileCollection.Bulk", `${key}-tops`)],
    } });
    out.bulk.set(markerSetId, { columns: ["MarkerName", "MarkerMeasuredDepth", "MarkerTypeID"], rows: markers.map((marker) => [marker.MarkerName, marker.MarkerMeasuredDepth, marker.MarkerTypeID]) });
  });
  return out;
}

/**
 * The whole tenant, field by field: `fields` generated on demand and a few kept. `at(family, n)`
 * is the n-th record of a kind in id order; `byKey(family, key)` finds one by the name at the end
 * of its id (t123, t123-def, f3, __proto__). Neither touches a field it does not need.
 */
export function tenantRecords({ wells = 1000, perField = 200, stations = 300, profile = "clean", partition = "opendes", cache } = {}) {
  const fieldCount = Math.ceil(wells / perField);
  const keep = cache ?? (stations > 1000 ? 3 : 8);
  const cached = new Map();
  const field = (f) => {
    if (f < 0 || f >= fieldCount) return null;
    if (cached.has(f)) { const hit = cached.get(f); cached.delete(f); cached.set(f, hit); return hit; }
    const records = recordsForField(f, { wells: Math.min(perField, wells - f * perField), perField, stations, profile, partition });
    cached.set(f, records);
    if (cached.size > keep) cached.delete(cached.keys().next().value);
    return records;
  };
  const count = (family) => family === "field" ? fieldCount : wells;
  const at = (family, n) => {
    if (n < 0 || n >= count(family)) return null;
    if (family === "field") return field(n).field;
    return field(Math.floor(n / perField))[family][n % perField];
  };
  /** The well number behind a key: t123 → 123; a hostile id → the number it replaced. */
  const wellNumber = (key) => {
    const plain = /^t(\d+)$/.exec(key);
    if (plain) return Number(plain[1]);
    const hostileIndex = profile === "hostile" ? HOSTILE_IDS.indexOf(key) : -1;
    return hostileIndex >= 0 ? hostileIndex + 1 : null;
  };
  const byKey = (family, key) => {
    if (family === "field") { const m = /^f(\d+)$/.exec(key); return m ? field(Number(m[1]))?.field ?? null : null; }
    const base = family === "trajectory" ? key.replace(/-def$/, "") : family === "markerSet" ? key.replace(/-tops$/, "") : key;
    if (base === key && (family === "trajectory" || family === "markerSet")) return null;
    const n = wellNumber(base);
    if (n === null || n >= wells) return null;
    const records = field(Math.floor(n / perField));
    const i = records.keys.get(base);
    return i === undefined ? null : records[family][i];
  };
  const bulk = (recordId) => {
    const key = recordId.split(":").pop();
    const family = key.endsWith("-def") ? "trajectory" : key.endsWith("-tops") ? "markerSet" : null;
    if (!family) return null;
    const record = byKey(family, key);
    if (!record || record.id !== recordId) return null;
    return field(Math.floor(wellNumber(key.replace(/-(def|tops)$/, "")) / perField)).bulk.get(recordId) ?? null;
  };
  return { wells, perField, fieldCount, stations, profile, partition, field, count, at, byKey, bulk, cachedFields: () => [...cached.keys()] };
}
