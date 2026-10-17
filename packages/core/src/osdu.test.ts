import assert from "node:assert/strict";
import test from "node:test";
import { readDetail, readHeaders } from "./data-contract.ts";
import type { DataProblem } from "./data-contract.ts";
import { ensureCrs } from "./gis.ts";
import { cellField, datumFromVerticalMeasurements, describeOsduError, lengthToMetres, markerSetFromOsdu, osduSource, refToId, tableRows, trajectoryFromOsdu, wellboreFromOsdu, wellFromOsdu } from "./osdu.ts";
import type { OsduRecord } from "./osdu.ts";
import { HttpError } from "./fetch-guard.ts";

const P = "opendes";
const ref = (kind: string, id: string) => `${P}:${kind}:${id}:`;
const well = (n: number, extra: Record<string, unknown> = {}): OsduRecord => ({ id: `${P}:master-data--Well:w${n}`, kind: "osdu:wks:master-data--Well:1.3.0", version: 1, data: {
  FacilityName: `Well ${n}`, NameAliases: [{ AliasName: `UWI-${n}`, AliasNameTypeID: ref("reference-data--AliasNameType", "UWI") }],
  GeoContexts: [{ GeoTypeID: ref("reference-data--GeoPoliticalEntityType", "Field"), FieldID: ref("master-data--Field", "f1") }],
  SpatialLocation: { Wgs84Coordinates: { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [2.16397 + n * 0.001, 57.79715] } }] } },
  OperatingEnvironmentID: ref("reference-data--OperatingEnvironment", "Offshore"), CurrentOperatorID: ref("master-data--Organisation", "Equinor"),
  ...extra } });
const wellbore = (n: number, extra: Record<string, unknown> = {}): OsduRecord => ({ id: `${P}:master-data--Wellbore:wb${n}`, kind: "osdu:wks:master-data--Wellbore:1.5.0", data: {
  WellID: ref("master-data--Well", `w${n}`), FacilityName: `Well ${n} bore`, DefaultVerticalMeasurementID: "RKB",
  VerticalMeasurements: [
    { VerticalMeasurementID: "RKB", VerticalMeasurement: 30, VerticalMeasurementTypeID: ref("reference-data--VerticalMeasurementType", "Rotary Table"), VerticalMeasurementUnitOfMeasureID: ref("reference-data--UnitOfMeasure", "m") },
    { VerticalMeasurementID: "TD", VerticalMeasurement: 9842.52, VerticalMeasurementTypeID: ref("reference-data--VerticalMeasurementType", "Total Depth"), VerticalMeasurementPathID: ref("reference-data--VerticalMeasurementPath", "Measured Depth"), VerticalMeasurementUnitOfMeasureID: ref("reference-data--UnitOfMeasure", "ft") },
  ], ...extra } });
const trajectory = (n: number, name: string, extra: Record<string, unknown> = {}): OsduRecord => ({ id: `${P}:work-product-component--WellboreTrajectory:t${n}-${name}`, kind: "osdu:wks:work-product-component--WellboreTrajectory:1.3.0", modifyTime: name === "plan" ? "2020-01-01T00:00:00Z" : "2024-01-01T00:00:00Z", data: {
  WellboreID: ref("master-data--Wellbore", `wb${n}`), Name: name, AzimuthReferenceType: ref("reference-data--AzimuthReferenceType", "Grid North"),
  AvailableTrajectoryStationProperties: [
    { TrajectoryStationPropertyTypeID: ref("reference-data--TrajectoryStationPropertyType", "MD"), Name: "MD", StationPropertyUnitID: ref("reference-data--UnitOfMeasure", "ft") },
    { TrajectoryStationPropertyTypeID: ref("reference-data--TrajectoryStationPropertyType", "Inclination"), Name: "INCL", StationPropertyUnitID: ref("reference-data--UnitOfMeasure", "dega") },
    { TrajectoryStationPropertyTypeID: ref("reference-data--TrajectoryStationPropertyType", "AzimuthTN"), Name: "AZIM_TN", StationPropertyUnitID: ref("reference-data--UnitOfMeasure", "dega") },
    { TrajectoryStationPropertyTypeID: ref("reference-data--TrajectoryStationPropertyType", "TVD"), Name: "TVD", StationPropertyUnitID: ref("reference-data--UnitOfMeasure", "ft") },
  ], ...extra } });
const markerSet = (n: number, inline: boolean): OsduRecord => ({ id: `${P}:work-product-component--WellboreMarkerSet:m${n}`, kind: "osdu:wks:work-product-component--WellboreMarkerSet:1.2.0", data: {
  WellboreID: ref("master-data--Wellbore", `wb${n}`), Name: "Tops", VerticalMeasurement: { VerticalMeasurementUnitOfMeasureID: ref("reference-data--UnitOfMeasure", "ft") },
  ...(inline ? { Markers: [{ MarkerName: "Top A", MarkerMeasuredDepth: 3280.84, MarkerTypeID: ref("reference-data--MarkerType", "Formation Top") }, { MarkerName: "OWC", MarkerMeasuredDepth: 6561.68, MarkerTypeID: ref("reference-data--MarkerType", "Fluid Contact") }] } : {}) } });
const bulkTrajectory = { columns: ["MD", "INCL", "AZIM_TN", "TVD"], index: [0, 1, 2], data: [[0, 0, 45, 0], [3280.84, 10, 45, 3230], [6561.68, 20, 45, 6200]] };

/** A tiny OSDU: Search routes by kind and query, the DDMS by record id; every call is counted and checked for its headers. */
function platform(records: { wells: OsduRecord[]; fields: OsduRecord[]; wellbores: OsduRecord[]; trajectories: OsduRecord[]; markerSets: OsduRecord[] }, bulk: Record<string, unknown>, options: { pageSize?: number; failTrajectory?: string; status?: number } = {}) {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  let inFlight = 0, peak = 0;
  const cursors = new Map<string, number>();
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input), headers = init?.headers as Record<string, string>, body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, headers, body });
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 2));
    inFlight--;
    if (options.status) return new Response("nope", { status: options.status });
    if (!headers.authorization) return new Response("", { status: 401 });
    if (headers["data-partition-id"] !== P) return new Response("forbidden", { status: 403 });
    if (url.endsWith("/query_with_cursor")) {
      const kind = String(body.kind), query = String(body.query), limit = Number(body.limit ?? 1000);
      const pool = /master-data--Well:/.test(kind) ? records.wells : /master-data--Field/.test(kind) ? records.fields : /Wellbore:/.test(kind) ? records.wellbores : /Trajectory/.test(kind) ? records.trajectories : records.markerSets;
      const ids = [...query.matchAll(/"([^"]+?):?"/g)].map((match) => match[1]!.replace(/:$/, ""));
      const field = /^(data\.\w+|id):\(/.exec(query)?.[1];
      const hits = query === "*" ? pool : pool.filter((record) => field === "id" ? ids.includes(record.id) : ids.includes(String(record.data[field!.replace("data.", "")]).replace(/:$/, "")));
      if (body.cursor === "expired") return new Response(JSON.stringify({ code: 400, reason: "cursor expired" }), { status: 400 });
      const start = body.cursor ? cursors.get(body.cursor) ?? 0 : 0;
      const page = hits.slice(start, start + limit);
      const next = start + limit < hits.length ? `c${start + limit}` : null;
      if (next) cursors.set(next, start + limit);
      return new Response(JSON.stringify({ results: page, cursor: next, totalCount: hits.length }), { headers: { "content-type": "application/json" } });
    }
    const match = /\/ddms\/v3\/(wellboretrajectories|wellboremarkersets)\/([^/]+)\/data/.exec(url);
    if (match) {
      const id = decodeURIComponent(match[2]!);
      if (id === options.failTrajectory) return new Response("no bulk data", { status: 404 });
      const table = bulk[id];
      return table ? new Response(JSON.stringify(table), { headers: { "content-type": "application/json" } }) : new Response("not found", { status: 404 });
    }
    return new Response("unknown route", { status: 404 });
  };
  return { fetcher, calls, peak: () => peak };
}

const SOURCE = (fetcher: typeof fetch, extra: Partial<Parameters<typeof osduSource>[0]> = {}) => osduSource({ id: "osdu", baseUrl: "https://osdu.example.com/", dataPartition: P, auth: { token: async () => "T" }, fetcher, pageSize: 2, ...extra });

test("headers page through Search with a cursor, resolve field names once per page, and put a well with no field in a 1° cell", async () => {
  const wells = [well(1), well(2), well(3, { GeoContexts: [] }), well(4, { GeoContexts: [{ FieldID: ref("master-data--Field", "f9") }] })];
  const osdu = platform({ wells, fields: [{ id: `${P}:master-data--Field:f1`, kind: "osdu:wks:master-data--Field:1.0.0", data: { FieldName: "North Block" } }], wellbores: [], trajectories: [], markerSets: [] }, {});
  const read = await readHeaders(SOURCE(osdu.fetcher));
  assert.equal(read.wells.length, 4);
  assert.deepEqual(read.wells.map((entry) => entry.field?.name), ["North Block", "North Block", "Unassigned 57°N 2°E", "f9"]);
  assert.equal(read.wells[0]!.id, `${P}:master-data--Well:w1`);
  assert.equal(read.wells[0]!.uwi, "UWI-1");
  assert.equal(read.wells[0]!.environment, "offshore");
  assert.equal(read.wells[0]!.operator, "Equinor");
  assert.equal(read.wells[0]!.provenance.record?.standard, "OSDU");
  const searches = osdu.calls.filter((call) => call.url.endsWith("/query_with_cursor"));
  assert.equal(searches.filter((call) => /Well:/.test(String(call.body.kind))).length, 2, "two pages of two");
  // Field names are resolved once per field: f1 on the first page, f9 when the second page brings it; f1 is not asked for again.
  assert.equal(searches.filter((call) => /Field/.test(String(call.body.kind))).length, 2);
  assert.deepEqual(searches.filter((call) => /Field/.test(String(call.body.kind))).map((call) => String(call.body.query).includes("f1")), [true, false]);
  assert.ok(osdu.calls.every((call) => call.headers.authorization === "Bearer T" && call.headers["data-partition-id"] === P));
  assert.deepEqual(cellField(-0.5, -33.2), { id: "osdu-cell:-34:-1", name: "Unassigned 34°S 1°W" });
});

test("detail: wellbores by well, the definitive path read from the DDMS with feet to metres and true-north azimuths, markers inline and from bulk, the datum chain summed, TD converted", async () => {
  const records = { wells: [well(1), well(2)], fields: [], wellbores: [wellbore(1, { DefinitiveTrajectoryID: `${P}:work-product-component--WellboreTrajectory:t1-final:` }), wellbore(2)],
    trajectories: [trajectory(1, "plan"), trajectory(1, "final"), trajectory(2, "final")], markerSets: [markerSet(1, true), markerSet(2, false)] };
  const osdu = platform(records, { [`${P}:work-product-component--WellboreTrajectory:t1-final`]: bulkTrajectory, [`${P}:work-product-component--WellboreTrajectory:t2-final`]: { MD: { "0": 0, "1": 3280.84 }, INCL: { "0": 0, "1": 5 }, AZIM_TN: { "0": 90, "1": 90 }, TVD: { "0": 0, "1": 3270 } }, [`${P}:work-product-component--WellboreMarkerSet:m2`]: [{ MarkerName: "Top B", MarkerMeasuredDepth: 1640.42, MarkerTypeID: "…:Formation Top:" }] });
  const read = await readDetail(SOURCE(osdu.fetcher), [`${P}:master-data--Well:w1`, `${P}:master-data--Well:w2`], { batch: 100 });
  assert.equal(read.wells.length, 2);
  const [a, b] = read.wells;
  const bore = a!.wellbores[0]!;
  assert.equal(bore.wellbore.datum.reference, "RKB");
  assert.equal(bore.wellbore.datum.elevationM, 30);
  assert.ok(Math.abs(bore.wellbore.totalDepthMdM! - 3000) < 0.01, "TD 9842.52 ft is 3,000 m");
  assert.equal(bore.trajectory!.id, `${P}:work-product-component--WellboreTrajectory:t1-final`, "the wellbore's definitive trajectory, not the plan");
  assert.equal(bore.trajectory!.azimuthReference, "true");
  assert.ok(Math.abs(bore.path.at(-1)!.mdM - 2000) < 0.01 && Math.abs(bore.path.at(-1)!.tvdM - 6200 * 0.3048) < 0.01, "feet became metres");
  assert.equal(bore.path.length, 3);
  assert.deepEqual(bore.markers.map((marker) => [marker.name, Math.round(marker.mdM), marker.kind]), [["Top A", 1000, "formation"], ["OWC", 2000, "contact"]]);
  assert.deepEqual(b!.wellbores[0]!.markers.map((marker) => [marker.name, Math.round(marker.mdM)]), [["Top B", 500]], "bulk markers in the columns orientation of the table");
  assert.equal(b!.wellbores[0]!.path.length, 2);
  // Only the definitive path was fetched from the DDMS: one bulk call per wellbore for trajectories, and only the bore without inline markers asked for them.
  const bulk = osdu.calls.filter((call) => /\/ddms\/v3\//.test(call.url)).map((call) => call.url.replace(/.*\/ddms\/v3\//, ""));
  assert.equal(bulk.filter((url) => url.startsWith("wellboretrajectories")).length, 2);
  assert.equal(bulk.filter((url) => url.startsWith("wellboremarkersets")).length, 1);
  assert.deepEqual(read.problems, []);
});

test("one well's trouble stays its own: a DDMS 404 leaves that well without a path, with a stated problem, and the rest of the batch is read", async () => {
  const records = { wells: [well(1), well(2)], fields: [], wellbores: [wellbore(1), wellbore(2)], trajectories: [trajectory(1, "final"), trajectory(2, "final")], markerSets: [] };
  const osdu = platform(records, { [`${P}:work-product-component--WellboreTrajectory:t2-final`]: bulkTrajectory }, { failTrajectory: `${P}:work-product-component--WellboreTrajectory:t1-final` });
  const read = await readDetail(SOURCE(osdu.fetcher), [`${P}:master-data--Well:w1`, `${P}:master-data--Well:w2`]);
  assert.equal(read.wells.length, 2);
  assert.equal(read.wells.find((entry) => entry.well.id.endsWith("w1"))!.wellbores[0]!.path.length, 0);
  assert.equal(read.wells.find((entry) => entry.well.id.endsWith("w2"))!.wellbores[0]!.path.length, 3);
  assert.ok(read.problems.some((problem: DataProblem) => problem.object === "trajectory" && /404/.test(problem.message)), read.problems.map((problem) => problem.message).join("\n"));
});

test("quirks: feet, an unknown unit, no property list, absolute X/Y, a datum chained DF → GL → MSL, and an as-ingested ED50 position reprojected", async () => {
  await ensureCrs(["EPSG:23031"]);
  const problems: DataProblem[] = [];
  // No property list: columns found by name; X/Y become offsets from the first station; the furlong column is dropped and said so.
  const bare = trajectoryFromOsdu({ id: "t", kind: "k", data: { WellboreID: "wb:", Name: "Final survey", AzimuthReferenceType: "…:True North:" } }, [{ MeasuredDepth: 0, Inclination: 0, Azimuth: 0, X: 450000, Y: 6400000, TVD: 0 }, { MeasuredDepth: 100, Inclination: 10, Azimuth: 90, X: 450010, Y: 6400000, TVD: 98 }], P, problems)!;
  assert.equal(bare.azimuthReference, "true");
  assert.deepEqual(bare.stations[1], { mdM: 100, inclinationDeg: 10, azimuthDeg: 90, tvdM: 98, northM: 0, eastM: 10 });
  const odd = trajectoryFromOsdu(trajectory(9, "final", { AvailableTrajectoryStationProperties: [{ TrajectoryStationPropertyTypeID: "…:MD:", Name: "MD", StationPropertyUnitID: "…:furlong:" }] }), { columns: ["MD"], data: [[1], [2]] }, P, problems);
  assert.equal(odd, null, "no usable MD column: no path");
  assert.ok(problems.some((problem) => /furlong/.test(problem.message)) && problems.some((problem) => /No measured-depth column/.test(problem.message)));
  // DF 2 m above GL, GL 50 m above MSL: the datum is 52 m above sea level.
  const chained = datumFromVerticalMeasurements({ DefaultVerticalMeasurementID: "DF", VerticalMeasurements: [
    { VerticalMeasurementID: "DF", VerticalMeasurement: 2, VerticalMeasurementTypeID: "…:Derrick Floor:", VerticalMeasurementUnitOfMeasureID: "…:m:", VerticalReferenceID: "GL" },
    { VerticalMeasurementID: "GL", VerticalMeasurement: 50, VerticalMeasurementTypeID: "…:Ground Level:", VerticalMeasurementUnitOfMeasureID: "…:m:" },
  ] }, problems, "wb");
  assert.deepEqual([chained.reference, chained.elevationM], ["DF", 52]);
  // Only an as-ingested position, in ED50 / UTM 31N: reprojected to within 5 m of the Directorate's own conversion for this FORCE well.
  const ingested = wellFromOsdu(well(7, { SpatialLocation: { AsIngestedCoordinates: { type: "AnyCrsFeatureCollection", CoordinateReferenceSystemID: ref("reference-data--CoordinateReferenceSystem", "Projected:EPSG::23031"), features: [{ type: "AnyCrsFeature", geometry: { type: "AnyCrsPoint", coordinates: [450397.3, 6406647.5] } }] } } }), P, new Map(), problems);
  assert.ok(ingested.location && Math.hypot((ingested.location.longitude - 2.16397) * 111_320 * Math.cos(57.8 * Math.PI / 180), (ingested.location.latitude - 57.79715) * 110_574) < 5, JSON.stringify(ingested.location));
  assert.equal(ingested.location!.projected?.crs, "EPSG:23031");
  assert.equal(lengthToMetres(1, "…:ft:"), 0.3048);
  assert.equal(lengthToMetres(1, "…:furlong:"), null);
  assert.equal(refToId("opendes:master-data--Well:w1:"), "opendes:master-data--Well:w1");
  assert.equal(refToId("opendes:master-data--Well:w1:3:"), "opendes:master-data--Well:w1");
  assert.deepEqual(tableRows({ columns: ["a", "b"], data: [[1, 2]] }), [{ a: 1, b: 2 }]);
  const markers = markerSetFromOsdu(markerSet(3, true), null, P, problems);
  assert.equal(markers.markers[1]!.kind, "contact");
});

test("the reader is told what an error means: expired sign-in, missing entitlements, a blocked origin, an expired cursor; every call stays within the source's concurrency", async () => {
  assert.match(describeOsduError(new HttpError(401, "", "u"), P, "https://o"), /Sign-in expired/);
  assert.match(describeOsduError(new HttpError(403, "", "u"), P, "https://o"), /partition opendes.*entitlement/);
  assert.match(describeOsduError(new HttpError(400, '{"reason":"cursor expired"}', "u"), P, "https://o"), /cursor expired/);
  assert.match(describeOsduError(new TypeError("Failed to fetch"), P, "https://o"), /CORS.*Content-Security-Policy/);
  const forbidden = platform({ wells: [well(1)], fields: [], wellbores: [], trajectories: [], markerSets: [] }, {}, { status: 403 });
  await assert.rejects(readHeaders(SOURCE(forbidden.fetcher)), /partition opendes/);
  const wrong = platform({ wells: [well(1)], fields: [], wellbores: [], trajectories: [], markerSets: [] }, {});
  await assert.rejects(readHeaders(SOURCE(wrong.fetcher, { dataPartition: "other" })), /partition other/);
  // Forty wells' detail with a concurrency of 3: never more than three requests in flight.
  const n = 40;
  const records = { wells: Array.from({ length: n }, (_, i) => well(i)), fields: [], wellbores: Array.from({ length: n }, (_, i) => wellbore(i)), trajectories: Array.from({ length: n }, (_, i) => trajectory(i, "final")), markerSets: [] };
  const bulk = Object.fromEntries(Array.from({ length: n }, (_, i) => [`${P}:work-product-component--WellboreTrajectory:t${i}-final`, bulkTrajectory]));
  const osdu = platform(records, bulk, { pageSize: 1000 });
  const read = await readDetail(SOURCE(osdu.fetcher, { pageSize: 1000, concurrency: 3 }), records.wells.map((record) => record.id), { batch: 10, concurrency: 4 });
  assert.equal(read.wells.length, n);
  assert.ok(osdu.peak() <= 3, `peak in flight ${osdu.peak()}`);
});

test("describeOsduError: a thrown non-Error is named as such, never \"[object Object]\" (found by fuzzing)", () => {
  assert.doesNotMatch(describeOsduError([{ a: 1 }], P, "https://o"), /object Object/);
  assert.match(describeOsduError(undefined, P, "https://o"), /could not be read/);
  assert.equal(describeOsduError("the socket closed", P, "https://o"), "the socket closed");
  assert.equal(describeOsduError(new Error("boom"), P, "https://o"), "boom");
});

test("OSDU units and tables: a unit named like an Object.prototype key is unknown, and a row that is not an object is skipped (found by fuzzing)", () => {
  assert.equal(lengthToMetres(10, "__proto__"), null);
  assert.equal(lengthToMetres(10, "constructor"), null);
  assert.equal(lengthToMetres(10, `${P}:reference-data--UnitOfMeasure:ft:`), 3.048);
  assert.deepEqual(tableRows([null, { MD: 1 }, 4, undefined] as never), [{ MD: 1 }]);
  const problems: never[] = [];
  const set = markerSetFromOsdu({ id: "m", kind: "k", data: {} }, [null, { MarkerMeasuredDepth: 1200, MarkerName: "Top" }] as never, P, problems);
  assert.equal(set.markers.length, 1);
});

test("detail searches ask only for the fields the mappers read: whole and trimmed records map the same (mock clean and quirky tenants)", async () => {
  const { recordsForField } = await import("../../../tools/mock-osdu/records.mjs");
  const { pickFields, pandasJson } = await import("../../../tools/mock-osdu/server.mjs");
  const { DETAIL_FIELDS } = await import("./osdu.ts");
  for (const profile of ["clean", "quirky"]) {
    const field = recordsForField(0, { wells: 12, perField: 12, stations: 40, profile });
    const map = (trim: boolean) => {
      const problems: never[] = [];
      const cut = (record: object, fields: readonly string[]) => trim ? pickFields(record, fields) : record;
      return {
        wellbores: field.wellbore.map((record: never) => wellboreFromOsdu(cut(record, DETAIL_FIELDS.wellbore) as never, P, problems)),
        trajectories: field.trajectory.map((record: { id: string }) => trajectoryFromOsdu(cut(record, DETAIL_FIELDS.trajectory) as never, JSON.parse(pandasJson(field.bulk.get(record.id))) as never, P, problems, { definitive: true })),
        markers: field.markerSet.map((record: { id: string; data: { Markers?: unknown[] } }) => markerSetFromOsdu(cut(record, DETAIL_FIELDS.markerSet) as never, record.data.Markers ? null : JSON.parse(pandasJson(field.bulk.get(record.id))) as never, P, problems)),
        definitive: field.wellbore.map((record: { data: Record<string, unknown> }) => (cut(record, DETAIL_FIELDS.wellbore) as { data: Record<string, unknown> }).data.DefinitiveTrajectoryID ?? null),
        problems,
      };
    };
    assert.deepEqual(map(true), map(false), `${profile}: trimmed records map differently`);
    const trimmed = map(true);
    assert.ok(trimmed.trajectories.every((t) => t && t.stations.length === 40), `${profile}: every path whole (${trimmed.trajectories.map((t) => t?.stations.length).join(",")})`);
    assert.ok(trimmed.markers.every((m) => m.markers.length > 0) && trimmed.wellbores.every((b) => b.datum.elevationM !== null && b.totalDepthMdM !== null), `${profile}: markers, datums and depths read`);
  }
});
