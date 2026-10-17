// The mock OSDU platform and identity provider, checked end to end over real sockets:
//   node --test tools/mock-osdu/mock.test.mjs
// Every server here listens on an ephemeral port; nothing is left running.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIdp } from "./idp.mjs";
import { createMockOsdu, pandasJson, pickFields } from "./server.mjs";
import { HOSTILE_IDS, HOSTILE_STRINGS, recordsForField, tenantRecords } from "./records.mjs";
import { LuceneError, kindMatcher, parseQuery } from "./lucene.mjs";
import { createFaults } from "./faults.mjs";
import { randomToken, sha256b64url, signJwt, verifyJwt } from "./jwt.mjs";
import { tenant, writeTenant } from "../stress/tenant.mjs";
import { osduSource } from "../../packages/core/src/osdu.ts";
import { readDetail, readHeaders } from "../../packages/core/src/data-contract.ts";

const ORIGIN = "http://deck.test", PARTITION = "opendes", CLIENT = "deck", REDIRECT = "http://deck.test/callback";
const form = (fields) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** An identity provider and a mock platform on ephemeral ports, with a token ready to use. */
async function startStack({ profile = "clean", wells = 2500, stations = 20, cursorTtlS = 60, seed = 7, perField = 200 } = {}) {
  const idp = createIdp({ port: 0, tokenTtlS: 300 });
  const { issuer } = await idp.listen();
  const mock = createMockOsdu({ port: 0, adminPort: 0, profile, wells, stations, perField, cursorTtlS, seed, idp: issuer, issuer, allowOrigin: ORIGIN, partition: PARTITION });
  const { url, adminUrl } = await mock.listen();
  const token = idp.mintAccessToken();
  const headers = { authorization: `Bearer ${token}`, "data-partition-id": PARTITION, "content-type": "application/json" };
  const search = (body, extraHeaders = {}, path = "/api/search/v2/query_with_cursor") => fetch(`${url}${path}`, { method: "POST", headers: { ...headers, ...extraHeaders }, body: JSON.stringify(body) });
  const bulk = (kind, id, query = "") => fetch(`${url}/api/os-wellbore-ddms/ddms/v3/${kind}/${encodeURIComponent(id)}/data${query}`, { headers });
  const admin = (path, body) => fetch(`${adminUrl}${path}`, body ? { method: "POST", body: JSON.stringify(body) } : {}).then((r) => r.json());
  return { idp, mock, issuer, url, adminUrl, token, headers, search, bulk, admin, close: async () => { await mock.close(); await idp.close(); } };
}
const pkce = () => { const verifier = randomToken(32); return { verifier, challenge: sha256b64url(verifier) }; };
const authorizeUrl = (issuer, extra = {}) => { const url = new URL(`${issuer}/authorize`); url.search = new URLSearchParams({ response_type: "code", client_id: CLIENT, redirect_uri: REDIRECT, scope: "openid profile offline_access", state: "state-1", nonce: "nonce-1", code_challenge_method: "S256", ...extra }); return url; };
const location = (response) => new URL(response.headers.get("location"));
const claimsOf = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

describe("mock OSDU and identity provider (clean profile, 2,500 wells)", () => {
  let s;
  before(async () => { s = await startStack(); });
  after(async () => { await s.close(); });

  it("walks the PKCE flow end to end: discovery, code, tokens, a platform call, refresh rotation and reuse detection", async () => {
    const discovery = await fetch(`${s.issuer}/.well-known/openid-configuration`).then((r) => r.json());
    assert.equal(discovery.issuer, s.issuer);
    assert.deepEqual(discovery.code_challenge_methods_supported, ["S256"]);
    assert.equal(discovery.end_session_endpoint, `${s.issuer}/logout`);
    const { verifier, challenge } = pkce();
    const authorized = await fetch(authorizeUrl(s.issuer, { code_challenge: challenge }), { redirect: "manual" });
    assert.equal(authorized.status, 302);
    const back = location(authorized);
    assert.equal(back.origin + back.pathname, REDIRECT);
    assert.equal(back.searchParams.get("state"), "state-1");
    const code = back.searchParams.get("code");
    assert.ok(code, "a code comes back");
    const cookie = authorized.headers.get("set-cookie").split(";")[0];

    // The wrong verifier is refused and the code survives for the right one; a second use of the code is refused.
    const wrong = await fetch(`${s.issuer}/token`, form({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: CLIENT, code_verifier: randomToken(32) }));
    assert.equal(wrong.status, 400);
    assert.equal((await wrong.json()).error, "invalid_grant");
    const { verifier: verifier2, challenge: challenge2 } = pkce();
    const code2 = location(await fetch(authorizeUrl(s.issuer, { code_challenge: challenge2 }), { redirect: "manual", headers: { cookie } })).searchParams.get("code");
    const tokens = await fetch(`${s.issuer}/token`, form({ grant_type: "authorization_code", code: code2, redirect_uri: REDIRECT, client_id: CLIENT, code_verifier: verifier2 })).then((r) => r.json());
    assert.equal(tokens.token_type, "Bearer");
    assert.ok(tokens.access_token && tokens.id_token && tokens.refresh_token);
    const id = claimsOf(tokens.id_token);
    assert.equal(id.nonce, "nonce-1"); assert.equal(id.sub, "mock-user"); assert.equal(id.name, "Mock User"); assert.equal(id.aud, CLIENT);
    assert.deepEqual(verifyJwt(tokens.access_token, s.idp.jwks(), { issuer: s.issuer }).claims.sub, "mock-user");
    const replay = await fetch(`${s.issuer}/token`, form({ grant_type: "authorization_code", code: code2, redirect_uri: REDIRECT, client_id: CLIENT, code_verifier: verifier2 }));
    assert.equal((await replay.json()).error, "invalid_grant");
    void verifier;

    // The access token opens the platform.
    const page = await s.search({ kind: "*:*:master-data--Field:*", query: "*", limit: 3 }, { authorization: `Bearer ${tokens.access_token}` });
    assert.equal(page.status, 200);
    assert.equal((await page.json()).totalCount, 13);

    // Refresh rotates; the old token presented again revokes the family, the new one included.
    const rotated = await fetch(`${s.issuer}/token`, form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: CLIENT })).then((r) => r.json());
    assert.ok(rotated.refresh_token && rotated.refresh_token !== tokens.refresh_token);
    assert.ok(rotated.access_token !== tokens.access_token);
    // A rotated token is born unused: a client refreshing on schedule rotates again and again (a token
    // issued already "used" made the second refresh look like a replay; found by tools/e2e/auth.mjs).
    let latest = rotated;
    for (let i = 0; i < 3; i++) {
      const next = await fetch(`${s.issuer}/token`, form({ grant_type: "refresh_token", refresh_token: latest.refresh_token, client_id: CLIENT }));
      assert.equal(next.status, 200, `rotation ${i + 2}`);
      latest = await next.json();
    }
    const reused = await fetch(`${s.issuer}/token`, form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: CLIENT }));
    assert.equal(reused.status, 400);
    assert.match((await reused.json()).error_description, /reuse/);
    const family = await fetch(`${s.issuer}/token`, form({ grant_type: "refresh_token", refresh_token: latest.refresh_token, client_id: CLIENT }));
    assert.equal((await family.json()).error, "invalid_grant");

    // prompt=none: login_required without the session cookie, a code with it.
    const silentNo = await fetch(authorizeUrl(s.issuer, { code_challenge: challenge, prompt: "none" }), { redirect: "manual" });
    assert.equal(location(silentNo).searchParams.get("error"), "login_required");
    assert.equal(location(silentNo).searchParams.get("state"), "state-1");
    const silentYes = await fetch(authorizeUrl(s.issuer, { code_challenge: challenge, prompt: "none" }), { redirect: "manual", headers: { cookie } });
    assert.ok(location(silentYes).searchParams.get("code"));
    // PKCE is required: no challenge, or plain, is an error on the redirect.
    const noPkce = await fetch(authorizeUrl(s.issuer, { code_challenge_method: "plain", code_challenge: "abc" }), { redirect: "manual" });
    assert.equal(location(noPkce).searchParams.get("error"), "invalid_request");
    // Logout honours post_logout_redirect_uri and clears the session.
    const out = await fetch(`${s.issuer}/logout?post_logout_redirect_uri=${encodeURIComponent("http://deck.test/bye")}&state=s9&id_token_hint=${tokens.id_token}`, { redirect: "manual", headers: { cookie } });
    assert.equal(out.status, 302);
    assert.equal(location(out).href, "http://deck.test/bye?state=s9");
    const afterLogout = await fetch(authorizeUrl(s.issuer, { code_challenge: challenge, prompt: "none" }), { redirect: "manual", headers: { cookie } });
    assert.equal(location(afterLogout).searchParams.get("error"), "login_required");
  });

  it("pages 2,500 wells with a cursor: the pages sum to totalCount, ids are unique, and the last page has no cursor", async () => {
    const ids = new Set();
    let cursor, pages = 0, totalCount;
    do {
      const response = await s.search({ kind: "*:*:master-data--Well:1.*.*", query: "*", limit: 1000, returnedFields: ["id", "kind", "data.FacilityName", "data.GeoContexts", "data.SpatialLocation"], ...(cursor ? { cursor } : {}) });
      assert.equal(response.status, 200);
      const body = await response.json();
      totalCount = body.totalCount;
      for (const record of body.results) {
        ids.add(record.id);
        assert.deepEqual(Object.keys(record).sort(), ["data", "id", "kind"], "only the returned fields");
        assert.deepEqual(Object.keys(record.data).sort(), ["FacilityName", "GeoContexts", "SpatialLocation"]);
        assert.equal(record.kind, "osdu:wks:master-data--Well:1.3.0");
      }
      pages++;
      cursor = body.cursor;
      if (pages < 3) assert.equal(typeof cursor, "string");
    } while (cursor);
    assert.equal(pages, 3);
    assert.equal(ids.size, 2500);
    assert.equal(totalCount, 2500);
    assert.ok(ids.has("opendes:master-data--Well:t0") && ids.has("opendes:master-data--Well:t2499"));
    // A consumed cursor cannot be replayed; a limit over 1,000 is refused as the platform refuses it.
    const first = await s.search({ kind: "*:*:master-data--Well:*", query: "*", limit: 1000 }).then((r) => r.json());
    assert.equal((await s.search({ cursor: first.cursor })).status, 200);
    const replay = await s.search({ cursor: first.cursor });
    assert.equal(replay.status, 400);
    assert.equal((await replay.json()).reason, "cursor expired");
    assert.equal((await s.search({ kind: "*:*:master-data--Well:*", query: "*", limit: 1001 })).status, 400);
  });

  it("answers the adapter's id queries, kind patterns and the offset endpoint; refuses syntax it does not know", async () => {
    const wellbores = await s.search({ kind: "*:*:master-data--Wellbore:*", query: 'data.WellID:("opendes:master-data--Well:t5:" OR "opendes:master-data--Well:t5" OR "opendes:master-data--Well:t2400:" OR "opendes:master-data--Well:t9999:")', limit: 1000 }).then((r) => r.json());
    assert.deepEqual(wellbores.results.map((record) => record.id).sort(), ["opendes:master-data--Wellbore:t2400", "opendes:master-data--Wellbore:t5"]);
    assert.equal(wellbores.totalCount, 2);
    const trajectories = await s.search({ kind: "*:*:work-product-component--WellboreTrajectory:*", query: 'data.WellboreID:("opendes:master-data--Wellbore:t5:")', limit: 10 }).then((r) => r.json());
    assert.deepEqual(trajectories.results.map((record) => record.id), ["opendes:work-product-component--WellboreTrajectory:t5-def"]);
    assert.equal(trajectories.results[0].data.AzimuthReferenceType, "opendes:reference-data--AzimuthReferenceType:Grid North:");
    const markers = await s.search({ kind: "*:*:work-product-component--WellboreMarkerSet:*", query: 'data.WellboreID:("opendes:master-data--Wellbore:t5:")', limit: 10 }).then((r) => r.json());
    assert.equal(markers.results[0].data.Markers.length, 20);
    const fields = await s.search({ kind: "*:*:master-data--Field:*", query: 'id:("opendes:master-data--Field:f3:" OR "opendes:master-data--Field:f3")', limit: 10, returnedFields: ["id", "data.FieldName"] }).then((r) => r.json());
    assert.deepEqual(fields.results, [{ id: "opendes:master-data--Field:f3", data: { FieldName: "Field 3" } }]);
    // A wrong-kind id finds nothing; a kind nothing matches is an empty answer, not an error.
    assert.equal((await s.search({ kind: "*:*:master-data--Field:*", query: 'id:("opendes:master-data--Well:t5:")', limit: 10 }).then((r) => r.json())).totalCount, 0);
    assert.equal((await s.search({ kind: "*:*:master-data--Rig:*", query: "*", limit: 10 }).then((r) => r.json())).totalCount, 0);
    const offset = await s.search({ kind: "*:*:master-data--Well:*", query: "*", limit: 5, offset: 2495, returnedFields: ["id"] }, {}, "/api/search/v2/query").then((r) => r.json());
    assert.deepEqual(offset.results.map((record) => record.id), [2495, 2496, 2497, 2498, 2499].map((n) => `opendes:master-data--Well:t${n}`));
    assert.equal(offset.totalCount, 2500);
    for (const query of ["data.FacilityName:T-3-0", "id:(a AND b)", "*:* AND data.X:1", "(id:x"]) {
      const response = await s.search({ kind: "*:*:master-data--Well:*", query, limit: 10 });
      assert.equal(response.status, 400, query);
      assert.match((await response.json()).message, /Invalid query/);
    }
    assert.equal((await s.search({ kind: "*:*:master-data--Well:*", query: "*", limit: 10, offset: 9996 }, {}, "/api/search/v2/query")).status, 400);
    const malformed = await fetch(`${s.url}/api/search/v2/query`, { method: "POST", headers: s.headers, body: "{not json" });
    assert.equal(malformed.status, 400);
  });

  it("refuses the wrong partition with 403 and a missing, forged, expired or foreign token with 401", async () => {
    const wrongPartition = await s.search({ kind: "*:*:master-data--Field:*", query: "*", limit: 1 }, { "data-partition-id": "other" });
    assert.equal(wrongPartition.status, 403);
    assert.match((await wrongPartition.json()).message, /Entitlements.*users\.datalake\.viewers@other/);
    const missingPartition = await fetch(`${s.url}/api/search/v2/query`, { method: "POST", headers: { authorization: s.headers.authorization, "content-type": "application/json" }, body: "{}" });
    assert.equal(missingPartition.status, 403);
    const foreign = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
    const now = Math.floor(Date.now() / 1000);
    const cases = {
      "no header": undefined,
      "not a token": "Bearer nope",
      "basic auth": "Basic dXNlcjpwYXNz",
      "foreign key": `Bearer ${signJwt({ iss: s.issuer, sub: "x", iat: now, exp: now + 300 }, foreign, s.idp.kid)}`,
      "expired": `Bearer ${s.idp.mintAccessToken({ iat: now - 1000, exp: now - 500 })}`,
      "wrong issuer": `Bearer ${s.idp.mintAccessToken({ iss: "http://other.test" })}`,
      "alg none": `Bearer ${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: "x", exp: now + 300 })).toString("base64url")}.`,
    };
    for (const [name, authorization] of Object.entries(cases)) {
      const response = await fetch(`${s.url}/api/search/v2/query`, { method: "POST", headers: { ...(authorization ? { authorization } : {}), "data-partition-id": PARTITION, "content-type": "application/json" }, body: "{}" });
      assert.equal(response.status, 401, name);
      assert.match(response.headers.get("www-authenticate"), /invalid_token/, name);
      assert.equal((await response.json()).code, 401);
    }
    // 401 before 403: a bad token with a wrong partition is 401.
    assert.equal((await fetch(`${s.url}/api/search/v2/query`, { method: "POST", headers: { authorization: "Bearer nope", "data-partition-id": "other" }, body: "{}" })).status, 401);
  });

  it("allows only the deck's origin through CORS, with the adapter's headers, and exposes x-request-id", async () => {
    const preflight = await fetch(`${s.url}/api/search/v2/query_with_cursor`, { method: "OPTIONS", headers: { origin: ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "authorization, data-partition-id, content-type" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), ORIGIN);
    assert.equal(preflight.headers.get("vary"), "Origin");
    for (const header of ["authorization", "data-partition-id", "content-type"]) assert.match(preflight.headers.get("access-control-allow-headers"), new RegExp(header));
    assert.match(preflight.headers.get("access-control-allow-methods"), /POST/);
    const other = await fetch(`${s.url}/api/search/v2/query_with_cursor`, { method: "OPTIONS", headers: { origin: "http://evil.test", "access-control-request-method": "POST" } });
    assert.equal(other.status, 403);
    assert.equal(other.headers.get("access-control-allow-origin"), null);
    const actual = await s.search({ kind: "*:*:master-data--Field:*", query: "*", limit: 1 }, { origin: ORIGIN });
    assert.equal(actual.headers.get("access-control-allow-origin"), ORIGIN);
    assert.match(actual.headers.get("access-control-expose-headers"), /x-request-id/);
    assert.match(actual.headers.get("x-request-id"), /^[0-9a-f-]{36}$/);
    const foreign = await s.search({ kind: "*:*:master-data--Field:*", query: "*", limit: 1 }, { origin: "http://evil.test" });
    assert.equal(foreign.headers.get("access-control-allow-origin"), null);
  });

  it("serves trajectory and marker bulk in both orientations, filtered to the curves asked for; 404 for an unknown id", async () => {
    const expected = tenant({ wells: 200, stations: 20, perField: 200, seed: 7 }).wells[5].wellbores[0].trajectories[0].stations;
    const split = await s.bulk("wellboretrajectories", "opendes:work-product-component--WellboreTrajectory:t5-def").then((r) => r.json());
    assert.deepEqual(split.columns, ["MD", "INCL", "AZIM", "TVD", "DX", "DY"]);
    assert.equal(split.data.length, 20);
    assert.deepEqual(split.index, split.data.map((_, i) => i));
    assert.deepEqual(split.data[7], [expected[7].mdM, expected[7].inclinationDeg, expected[7].azimuthDeg, expected[7].tvdM, expected[7].eastM, expected[7].northM]);
    const columns = await s.bulk("wellboretrajectories", "opendes:work-product-component--WellboreTrajectory:t5-def", "?orient=columns&curves=MD,TVD").then((r) => r.json());
    assert.deepEqual(Object.keys(columns), ["MD", "TVD"]);
    assert.equal(columns.MD["19"], expected[19].mdM);
    assert.equal(Object.keys(columns.MD).length, 20);
    const filtered = await s.bulk("wellboretrajectories", "opendes:work-product-component--WellboreTrajectory:t5-def", "?curves=INCL,MD&orient=split").then((r) => r.json());
    assert.deepEqual(filtered.columns, ["INCL", "MD"]);
    assert.deepEqual(filtered.data[3], [expected[3].inclinationDeg, expected[3].mdM]);
    assert.equal((await s.bulk("wellboretrajectories", "opendes:work-product-component--WellboreTrajectory:t5-def", "?curves=MD,NOPE")).status, 400);
    assert.equal((await s.bulk("wellboretrajectories", "opendes:work-product-component--WellboreTrajectory:t5-def", "?orient=table")).status, 400);
    const markers = await s.bulk("wellboremarkersets", "opendes:work-product-component--WellboreMarkerSet:t5-tops").then((r) => r.json());
    assert.deepEqual(markers.columns, ["MarkerName", "MarkerMeasuredDepth", "MarkerTypeID"]);
    assert.equal(markers.data.length, 20);
    assert.equal(markers.data[0][0], "Unit A");
    for (const [kind, id] of [["wellboretrajectories", "opendes:work-product-component--WellboreTrajectory:t99999-def"], ["wellboretrajectories", "opendes:work-product-component--WellboreMarkerSet:t5-tops"], ["wellboremarkersets", "opendes:work-product-component--WellboreMarkerSet:nope"], ["wellboretrajectories", "__proto__"]]) {
      const response = await s.bulk(kind, id);
      assert.equal(response.status, 404, id);
      assert.equal((await response.json()).reason, "Not Found");
    }
  });

  it("is read whole by the core OSDU adapter: every header listed, a field's detail with datums, paths and tops", async () => {
    const source = osduSource({ id: "mock", baseUrl: s.url, dataPartition: PARTITION, auth: { token: async () => s.token }, pageSize: 1000 });
    const seen = [];
    const headers = await readHeaders(source, { onPage: (wells, total) => seen.push([wells.length, total]) });
    assert.equal(headers.wells.length, 2500);
    assert.deepEqual(headers.problems, []);
    assert.deepEqual(seen, [[1000, 2500], [1000, 2500], [500, 2500]]);
    const well = headers.wells.find((entry) => entry.id === "opendes:master-data--Well:t605");
    assert.deepEqual(well.field, { id: "opendes:master-data--Field:f3", name: "Field 3" });
    assert.equal(well.name, "T-3-5");
    assert.equal(well.uwi, String(1_000_000 + 605));
    assert.equal(well.environment, "offshore");
    assert.ok(["Equinor", "Aker BP", "Var Energi", "ConocoPhillips", "TotalEnergies", "Wintershall Dea"].includes(well.operator), "an operator is named");
    assert.equal(well.location.projected.crs, "EPSG:23031");
    const original = recordsForField(3, { wells: 200, stations: 20 }).well[5].data.SpatialLocation.Wgs84Coordinates.features[0].geometry.coordinates;
    assert.deepEqual([well.location.longitude, well.location.latitude], original);
    const detail = await readDetail(source, ["opendes:master-data--Well:t605", "opendes:master-data--Well:t606", "opendes:master-data--Well:t2499"]);
    assert.deepEqual(detail.problems, []);
    assert.equal(detail.wells.length, 3);
    const expected = tenant({ wells: 200, stations: 20, perField: 200, seed: 10 }).wells[5].wellbores[0];
    const entry = detail.wells.find((item) => item.well.id === "opendes:master-data--Well:t605");
    const bore = entry.wellbores[0];
    assert.equal(bore.wellbore.datum.reference, "RKB");
    assert.equal(bore.wellbore.datum.elevationM, expected.wellbore.datum.elevationM);
    assert.equal(bore.wellbore.totalDepthMdM, expected.wellbore.totalDepthMdM);
    assert.equal(bore.trajectory.kind, "definitive");
    assert.equal(bore.trajectory.azimuthReference, "grid");
    assert.equal(bore.trajectory.stations.length, 20);
    assert.equal(bore.path.length, 20, "the path is computed from the stations");
    const station = bore.trajectory.stations[9], want = expected.trajectories[0].stations[9];
    assert.deepEqual([station.mdM, station.inclinationDeg, station.azimuthDeg, station.tvdM, station.northM, station.eastM], [want.mdM, want.inclinationDeg, want.azimuthDeg, want.tvdM, want.northM, want.eastM]);
    assert.equal(bore.markers.length, 20);
    assert.equal(bore.markers[3].name, "Unit D");
    assert.equal(bore.markers[3].mdM, expected.markerSets[0].markers[3].mdM);
    assert.equal(bore.markers[3].kind, "formation");
    // The raw bundles, as the adapter hands them to the contract, carry the records' provenance.
    const bundles = await source.detail(["opendes:master-data--Well:t605"]);
    assert.equal(bundles.length, 1);
    assert.deepEqual(bundles[0].well.provenance.record, { standard: "OSDU", kind: "osdu:wks:master-data--Well:1.3.0", id: "opendes:master-data--Well:t605" });
    assert.equal(bundles[0].wellbores[0].trajectories.length, 1);
    assert.equal(bundles[0].wellbores[0].markerSets.length, 1);
    assert.equal(bundles[0].problems, undefined);
  });

  it("injects faults deterministically for a seed, sends Retry-After and logs whether it was honoured", async () => {
    const run = async () => {
      await s.admin("/__admin/reset", {});
      await s.admin("/__admin/faults", { route: "search", rate5xx: 0.25, rate429: 0.25, retryAfterS: 0 });
      const statuses = [];
      for (let i = 0; i < 40; i++) statuses.push((await s.search({ kind: "*:*:master-data--Field:*", query: "*", limit: 1 })).status);
      return statuses;
    };
    const first = await run(), second = await run();
    assert.deepEqual(first, second);
    assert.ok(first.includes(200) && first.some((status) => status === 429) && first.some((status) => status >= 500), `a mix of outcomes: ${first.join(",")}`);
    const log = await s.admin("/__admin/log");
    assert.equal(log.routes.search.requests, 40);
    assert.equal(Object.values(log.routes.search.statuses).reduce((a, b) => a + b, 0), 40);
    assert.equal(log.routes.search.retryAfter.sent, first.filter((status) => status === 429).length);
    assert.ok(log.concurrency.peak >= 1);
    // Another seed, another sequence.
    const other = await startStack({ wells: 50, stations: 5, seed: 99 });
    try {
      await other.admin("/__admin/faults", { route: "search", rate5xx: 0.25, rate429: 0.25, retryAfterS: 0 });
      const statuses = [];
      for (let i = 0; i < 40; i++) statuses.push((await other.search({ kind: "*:*:master-data--Field:*", query: "*", limit: 1 })).status);
      assert.notDeepEqual(statuses, first);
    } finally { await other.close(); }
    // Retry-After honoured or ignored: the next request on the route is judged by when it comes.
    await s.admin("/__admin/reset", {});
    await s.admin("/__admin/faults", { route: "markers", rate429: 1, retryAfterS: 1 });
    const throttled = await s.bulk("wellboremarkersets", "opendes:work-product-component--WellboreMarkerSet:t5-tops");
    assert.equal(throttled.status, 429);
    assert.equal(throttled.headers.get("retry-after"), "1");
    await s.bulk("wellboremarkersets", "opendes:work-product-component--WellboreMarkerSet:t5-tops");
    await sleep(1050);
    await s.bulk("wellboremarkersets", "opendes:work-product-component--WellboreMarkerSet:t5-tops");
    const after = await s.admin("/__admin/log");
    assert.deepEqual(after.routes.markers.retryAfter, { sent: 3, honoured: 1, ignored: 1 });
    assert.deepEqual(await s.admin("/__admin/reset", {}), { ok: true });
    assert.deepEqual(await s.admin("/__admin/faults"), {});
    assert.equal((await fetch(`${s.adminUrl}/__admin/faults`, { method: "POST", body: JSON.stringify({ route: "nope", latencyMs: 1 }) })).status, 400);
    assert.equal((await fetch(`${s.adminUrl}/__admin/faults`, { method: "POST", body: JSON.stringify({ rate5xx: 2 }) })).status, 400);
  });

  it("applies latency, oversize, truncated JSON, expired cursors, a 401 storm and clock skew", async () => {
    await s.admin("/__admin/faults", { route: "search", oversizeBytes: 5000 });
    const big = await s.search({ kind: "*:*:master-data--Field:*", query: "*", limit: 1 });
    const bigText = await big.text();
    assert.ok(bigText.length > 5000 && JSON.parse(bigText).padding.length === 5000);
    await s.admin("/__admin/reset", {});
    await s.admin("/__admin/faults", { route: "search", truncateJson: true });
    const cut = await s.search({ kind: "*:*:master-data--Field:*", query: "*", limit: 1 });
    assert.equal(cut.status, 200);
    await assert.rejects(cut.json());
    await s.admin("/__admin/reset", {});
    const page = await s.search({ kind: "*:*:master-data--Well:*", query: "*", limit: 1000 }).then((r) => r.json());
    await s.admin("/__admin/faults", { expireCursors: true });
    const expired = await s.search({ cursor: page.cursor });
    assert.equal(expired.status, 400);
    assert.equal((await expired.json()).reason, "cursor expired");
    await s.admin("/__admin/reset", {});
    await s.admin("/__admin/faults", { storm401: 1 });
    assert.equal((await s.search({ kind: "*:*:master-data--Field:*", query: "*", limit: 1 })).status, 401);
    await s.admin("/__admin/reset", {});
    // The platform's clock five minutes ahead sees a 300 s token as expired; a minute of leeway is not enough.
    await s.admin("/__admin/faults", { clockSkewS: 600 });
    assert.equal((await s.search({ kind: "*:*:master-data--Field:*", query: "*", limit: 1 })).status, 401);
    await s.admin("/__admin/reset", {});
    await s.admin("/__admin/faults", { route: "search", latencyMs: 150, jitterMs: 50 });
    const started = Date.now();
    assert.equal((await s.search({ kind: "*:*:master-data--Field:*", query: "*", limit: 1 })).status, 200);
    assert.ok(Date.now() - started >= 140, "the latency was applied");
    await s.admin("/__admin/reset", {});
    const health = await s.admin("/__admin/health");
    assert.equal(health.wells, 2500); assert.equal(health.profile, "clean"); assert.ok(health.cachedFields.length <= 8);
  });

  it("counts a connection the client closes mid-trickle as aborted", async () => {
    await s.admin("/__admin/reset", {});
    await s.admin("/__admin/faults", { route: "trajectory", trickleBytesPerS: 100 });
    const path = `/api/os-wellbore-ddms/ddms/v3/wellboretrajectories/${encodeURIComponent("opendes:work-product-component--WellboreTrajectory:t5-def")}/data`;
    const target = new URL(s.url);
    await new Promise((resolve, reject) => {
      const request = httpRequest({ host: target.hostname, port: target.port, path, headers: s.headers }, (response) => {
        assert.equal(response.statusCode, 200);
        response.once("data", () => { request.destroy(); resolve(); });
      });
      request.on("error", reject);
      request.end();
    });
    let log;
    for (let i = 0; i < 40; i++) { log = await s.admin("/__admin/log"); if (log.routes.trajectory.aborted === 1) break; await sleep(50); }
    assert.equal(log.routes.trajectory.aborted, 1);
    assert.equal(log.total.aborted, 1);
    assert.equal(log.routes.trajectory.requests, 1);
    assert.equal(log.concurrency.current, 0);
    // A connection the server resets is not the client's doing.
    await s.admin("/__admin/reset", {});
    await s.admin("/__admin/faults", { route: "markers", rateReset: 1 });
    await assert.rejects(s.bulk("wellboremarkersets", "opendes:work-product-component--WellboreMarkerSet:t5-tops").then((r) => r.text()));
    const reset = await s.admin("/__admin/log");
    assert.equal(reset.routes.markers.aborted, 0);
    assert.equal(reset.routes.markers.requests, 1);
    await s.admin("/__admin/reset", {});
  });

  it("expires an idle cursor after --cursor-ttl", async () => {
    const short = await startStack({ wells: 400, stations: 5, cursorTtlS: 0.3 });
    try {
      const page = await short.search({ kind: "*:*:master-data--Well:*", query: "*", limit: 100 }).then((r) => r.json());
      assert.equal(typeof page.cursor, "string");
      await sleep(400);
      const late = await short.search({ cursor: page.cursor });
      assert.equal(late.status, 400);
      assert.deepEqual(await late.json().then((body) => [body.code, body.reason]), [400, "cursor expired"]);
    } finally { await short.close(); }
  });
});

describe("quirky profile", () => {
  let s;
  before(async () => { s = await startStack({ profile: "quirky", wells: 200, stations: 20 }); });
  after(async () => { await s.close(); });

  it("serves feet, true-north azimuths, its own column names, bulk-only markers, no WGS 84 and references without the colon", async () => {
    const wells = await s.search({ kind: "*:*:master-data--Well:*", query: "*", limit: 200 }).then((r) => r.json());
    assert.equal(wells.totalCount, 200);
    const withoutField = wells.results.filter((record) => record.data.GeoContexts.length === 0);
    assert.equal(withoutField.length, 20, "one well in ten has no field");
    for (const record of wells.results) {
      assert.equal(record.data.SpatialLocation.Wgs84Coordinates, undefined);
      assert.equal(record.data.SpatialLocation.AsIngestedCoordinates.CoordinateReferenceSystemID, "opendes:reference-data--CoordinateReferenceSystem:Projected:EPSG::23031");
      assert.equal(record.data.VerticalMeasurements[0].VerticalMeasurementUnitOfMeasureID, "opendes:reference-data--UnitOfMeasure:ft");
    }
    const bore = await s.search({ kind: "*:*:master-data--Wellbore:*", query: 'data.WellID:("opendes:master-data--Well:t7")', limit: 10 }).then((r) => r.json());
    assert.equal(bore.results.length, 1);
    assert.deepEqual(bore.results[0].data.VerticalMeasurements.map((entry) => [entry.VerticalMeasurementID, entry.VerticalReferenceID]), [["DF", "GL"], ["GL", "MSL"], ["TD", "DF"]]);
    assert.equal(bore.results[0].data.DefaultVerticalMeasurementID, "DF");
    const trajectory = await s.search({ kind: "*:*:work-product-component--WellboreTrajectory:*", query: 'data.WellboreID:("opendes:master-data--Wellbore:t7")', limit: 10 }).then((r) => r.json());
    const properties = trajectory.results[0].data.AvailableTrajectoryStationProperties;
    assert.deepEqual(properties.map((property) => property.Name), ["MeasuredDepth", "Inclination", "AZIM_TN", "TVD", "DispNS", "DispEW"]);
    assert.equal(properties[2].TrajectoryStationPropertyTypeID, "opendes:reference-data--TrajectoryStationPropertyType:AzimuthTN");
    assert.equal(properties[0].StationPropertyUnitID, "opendes:reference-data--UnitOfMeasure:ft");
    assert.equal(trajectory.results[0].data.AzimuthReferenceType, "opendes:reference-data--AzimuthReferenceType:True North");
    const bulk = await s.bulk("wellboretrajectories", "opendes:work-product-component--WellboreTrajectory:t7-def").then((r) => r.json());
    assert.deepEqual(bulk.columns, ["MeasuredDepth", "Inclination", "AZIM_TN", "TVD", "DispNS", "DispEW"]);
    const metres = tenant({ wells: 200, stations: 20, perField: 200, seed: 7 }).wells[7].wellbores[0].trajectories[0].stations[19];
    assert.ok(Math.abs(bulk.data[19][0] * 0.3048 - metres.mdM) < 0.001, "MD in feet");
    const markers = await s.search({ kind: "*:*:work-product-component--WellboreMarkerSet:*", query: 'data.WellboreID:("opendes:master-data--Wellbore:t7")', limit: 10 }).then((r) => r.json());
    assert.equal(markers.results[0].data.Markers, undefined, "markers in bulk only");
    const markerBulk = await s.bulk("wellboremarkersets", "opendes:work-product-component--WellboreMarkerSet:t7-tops").then((r) => r.json());
    assert.equal(markerBulk.data.length, 20);
  });

  it("comes through the core adapter at the same places and depths as the clean profile", async () => {
    const source = osduSource({ id: "quirky", baseUrl: s.url, dataPartition: PARTITION, auth: { token: async () => s.token } });
    const headers = await readHeaders(source);
    assert.equal(headers.wells.length, 200);
    const expected = tenant({ wells: 200, stations: 20, perField: 200, seed: 7 }).wells[7];
    const well = headers.wells.find((entry) => entry.id === "opendes:master-data--Well:t7");
    assert.ok(Math.abs(well.location.longitude - expected.well.location.longitude) < 2e-5 && Math.abs(well.location.latitude - expected.well.location.latitude) < 2e-5, "placed from the as-ingested position");
    assert.equal(well.location.projected.crs, "EPSG:23031");
    assert.deepEqual(well.field, { id: "opendes:master-data--Field:f0", name: "Field 0" });
    const unassigned = headers.wells.find((entry) => entry.id === "opendes:master-data--Well:t9");
    assert.match(unassigned.field.id, /^osdu-cell:/);
    const detail = await readDetail(source, ["opendes:master-data--Well:t7"]);
    const bore = detail.wells[0].wellbores[0];
    assert.equal(bore.wellbore.datum.reference, "DF");
    assert.ok(Math.abs(bore.wellbore.datum.elevationM - expected.wellbores[0].wellbore.datum.elevationM) < 0.01, `datum chain DF→GL→MSL sums to the RKB height (${bore.wellbore.datum.elevationM})`);
    assert.ok(Math.abs(bore.wellbore.totalDepthMdM - expected.wellbores[0].wellbore.totalDepthMdM) < 0.01);
    assert.equal(bore.trajectory.azimuthReference, "true");
    const station = bore.trajectory.stations[19], want = expected.wellbores[0].trajectories[0].stations[19];
    for (const [got, wanted] of [[station.mdM, want.mdM], [station.tvdM, want.tvdM], [station.northM, want.northM], [station.eastM, want.eastM]]) assert.ok(Math.abs(got - wanted) < 0.002, `${got} ≈ ${wanted}`);
    assert.equal(station.azimuthDeg, want.azimuthDeg);
    assert.equal(bore.markers.length, 20);
    assert.ok(Math.abs(bore.markers[2].mdM - expected.wellbores[0].markerSets[0].markers[2].mdM) < 0.01);
    assert.deepEqual(detail.problems, []);
  });
});

describe("hostile profile", () => {
  let s;
  before(async () => { s = await startStack({ profile: "hostile", wells: 100, stations: 20 }); });
  after(async () => { await s.close(); });

  it("carries every hostile string verbatim, prototype-named ids, a 100,000-character name and non-JSON numbers", async () => {
    const wells = await s.search({ kind: "*:*:master-data--Well:*", query: "*", limit: 100 }).then((r) => r.json());
    const names = wells.results.map((record) => record.data.FacilityName);
    for (const hostile of HOSTILE_STRINGS) assert.ok(names.includes(hostile), `name ${JSON.stringify(hostile)}`);
    assert.equal(names.find((name) => name.length === 100_000)?.length, 100_000);
    assert.ok(wells.results.some((record) => record.data.CurrentOperatorID.includes("<img src=x onerror=__xss()>")), "an operator");
    const fields = await s.search({ kind: "*:*:master-data--Field:*", query: "*", limit: 10 }).then((r) => r.json());
    assert.equal(fields.results[0].data.FieldName, HOSTILE_STRINGS[0]);
    for (const id of HOSTILE_IDS) {
      const found = await s.search({ kind: "*:*:master-data--Well:*", query: `id:("opendes:master-data--Well:${id}:" OR "opendes:master-data--Well:${id}")`, limit: 10 }).then((r) => r.json());
      assert.deepEqual(found.results.map((record) => record.id), [`opendes:master-data--Well:${id}`]);
      const bores = await s.search({ kind: "*:*:master-data--Wellbore:*", query: `data.WellID:("opendes:master-data--Well:${id}:")`, limit: 10 }).then((r) => r.json());
      assert.deepEqual(bores.results.map((record) => record.id), [`opendes:master-data--Wellbore:${id}`]);
    }
    assert.equal(wells.results.filter((record) => record.id === "opendes:master-data--Well:t1").length, 0, "t1 was renamed __proto__");
    const markers = await s.search({ kind: "*:*:work-product-component--WellboreMarkerSet:*", query: 'data.WellboreID:("opendes:master-data--Wellbore:t6:")', limit: 10 }).then((r) => r.json());
    assert.ok(markers.results[0].data.Markers.some((marker) => HOSTILE_STRINGS.includes(marker.MarkerName)));
    const response = await s.bulk("wellboretrajectories", "opendes:work-product-component--WellboreTrajectory:t4-def");
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(text, /\[NaN,/); assert.match(text, /\[Infinity,/); assert.match(text, /\[1e\+308,/);
    assert.throws(() => JSON.parse(text), SyntaxError, "as Python writes it: not JSON");
    // The adapter survives the lot: the hostile well is reported, not thrown.
    const source = osduSource({ id: "hostile", baseUrl: s.url, dataPartition: PARTITION, auth: { token: async () => s.token } });
    const headers = await readHeaders(source);
    assert.equal(headers.wells.length, 100);
    const detail = await readDetail(source, ["opendes:master-data--Well:t4", "opendes:master-data--Well:__proto__"]);
    assert.equal(detail.wells.length, 2);
    assert.ok(detail.problems.some((problem) => problem.object === "trajectory" && /t4-def/.test(problem.id)), "the bad bulk is a problem on that trajectory");
    assert.equal(Object.getPrototypeOf({}).polluted, undefined);
  });
});

describe("the records, the query parser and the tokens", () => {
  it("holds the same wells as the stress tenant that writeTenant writes", () => {
    const dir = mkdtempSync(join(tmpdir(), "mock-osdu-"));
    try {
      writeTenant(dir, { wells: 600, stations: 5, perField: 200, detailFields: 1 });
      const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
      const written = index.fields[2];
      const records = recordsForField(2, { wells: 200, stations: 5 });
      assert.equal(records.field.data.FieldName, written.name);
      written.wells.forEach((well, i) => {
        const record = records.well[i];
        assert.equal(record.id, `opendes:master-data--Well:${well.id}`);
        assert.equal(record.data.FacilityName, well.name);
        assert.deepEqual(record.data.SpatialLocation.Wgs84Coordinates.features[0].geometry.coordinates, [well.location.longitude, well.location.latitude]);
        assert.equal(record.data.GeoContexts[0].FieldID, `opendes:master-data--Field:${well.field.id}:`);
      });
      const detail = JSON.parse(readFileSync(join(dir, "fields", "f0.json"), "utf8"));
      const first = recordsForField(0, { wells: 200, stations: 5 });
      assert.equal(first.bulk.get("opendes:work-product-component--WellboreTrajectory:t3-def").rows[4][0], detail.wells[3].wellbores[0].trajectories[0].stations[4].mdM);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("generates fields on demand and keeps only a few: 200,000 wells of 2,000 stations never sit in memory", () => {
    const huge = tenantRecords({ wells: 200_000, perField: 200, stations: 2000, profile: "huge" });
    assert.equal(huge.fieldCount, 1000);
    assert.equal(huge.count("well"), 200_000);
    assert.equal(huge.at("well", 199_999).id, "opendes:master-data--Well:t199999");
    assert.equal(huge.at("field", 999).data.FieldName, "Field 999");
    assert.equal(huge.at("well", 200_000), null);
    assert.equal(huge.byKey("wellbore", "t123456").data.WellID, "opendes:master-data--Well:t123456:");
    assert.equal(huge.bulk("opendes:work-product-component--WellboreTrajectory:t123456-def").rows.length, 2000);
    assert.equal(huge.byKey("well", "t200000"), null);
    assert.equal(huge.byKey("well", "__proto__"), null, "only the hostile profile has that id");
    assert.ok(huge.cachedFields().length <= 3, `${huge.cachedFields().length} fields cached`);
  });

  it("parses only the adapter's Lucene and refuses the rest", () => {
    assert.deepEqual(parseQuery("*"), { all: true });
    assert.deepEqual(parseQuery(""), { all: true });
    assert.deepEqual(parseQuery(undefined), { all: true });
    assert.deepEqual(parseQuery('id:("a:" OR "b" OR "a")'), { field: "id", values: new Set(["a", "b"]) });
    assert.deepEqual(parseQuery('data.WellID:("opendes:master-data--Well:t1:")'), { field: "data.WellID", values: new Set(["opendes:master-data--Well:t1"]) });
    assert.deepEqual(parseQuery("data.WellboreID:(x OR y:)"), { field: "data.WellboreID", values: new Set(["x", "y"]) });
    assert.deepEqual(parseQuery('id:"a:1:"'), { field: "id", values: new Set(["a"]) });
    for (const bad of ["id:()", "name:x", "id:(a AND b)", "id:(\"a\" OR )", "NOT id:x", 42]) assert.throws(() => parseQuery(bad), LuceneError, String(bad));
    const well = kindMatcher("*:*:master-data--Well:1.*.*");
    assert.ok(well("osdu:wks:master-data--Well:1.3.0") && !well("osdu:wks:master-data--Wellbore:1.5.0") && !well("osdu:wks:master-data--Well:2.0.0"));
    assert.ok(kindMatcher("osdu:wks:master-data--Well:1.3.0")("osdu:wks:master-data--Well:1.3.0"));
    assert.throws(() => kindMatcher("master-data--Well"), LuceneError);
    assert.deepEqual(pickFields({ id: "x", kind: "k", version: 1, data: { a: 1, b: { c: 2 } } }, ["id", "data.b.c", "data.nope", "data.a"]), { id: "x", data: { b: { c: 2 }, a: 1 } });
    assert.equal(pandasJson({ columns: ["MD", "N"], rows: [[NaN, "a"], [Infinity, null]] }, "split"), '{"columns":["MD","N"],"index":[0,1],"data":[[NaN,"a"],[Infinity,null]]}');
    assert.equal(pandasJson({ columns: ["MD"], rows: [[1.5], [2]] }, "columns"), '{"MD":{"0":1.5,"1":2}}');
  });

  it("draws faults from one seeded generator and merges * with the route's own settings", () => {
    const a = createFaults({ seed: 3 }), b = createFaults({ seed: 3 }), c = createFaults({ seed: 4 });
    for (const faults of [a, b, c]) { faults.set({ rate5xx: 0.5 }); faults.set({ route: "search", latencyMs: 10, rate429: 0.3 }); }
    const sequence = (faults) => Array.from({ length: 30 }, (_, i) => faults.decide(i % 2 ? "search" : "markers").status);
    const first = sequence(a);
    assert.deepEqual(first, sequence(b));
    assert.notDeepEqual(first, sequence(c));
    assert.equal(a.decide("search").latencyMs, 10);
    assert.equal(a.decide("markers").latencyMs, 0);
    assert.deepEqual(Object.keys(a.current()).sort(), ["*", "search"]);
    a.reset();
    assert.deepEqual(a.current(), {});
    a.set({ rate5xx: 0.5 }); a.set({ route: "search", latencyMs: 10, rate429: 0.3 });
    assert.deepEqual(sequence(a), first, "reset rewinds the generator");
    assert.throws(() => a.set({ route: "search", bogus: 1 }), TypeError);
    assert.throws(() => a.set({ rate429: 1.5 }), TypeError);
    assert.throws(() => a.set({ truncateJson: 1 }), TypeError);
  });

  it("signs and verifies ES256 tokens, and refuses the forgeries", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "ES256", use: "sig" }] };
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt({ iss: "me", sub: "s", iat: now, exp: now + 60 }, privateKey, "k1");
    assert.equal(verifyJwt(token, jwks, { issuer: "me" }).claims.sub, "s");
    assert.equal(verifyJwt(token, jwks, { issuer: "you" }).error, "wrong issuer");
    assert.equal(verifyJwt(token, jwks, { nowS: now + 200 }).error, "token expired");
    assert.equal(verifyJwt(token, jwks, { nowS: now + 100 }).claims.sub, "s", "a minute of leeway");
    assert.equal(verifyJwt(`${token.slice(0, -4)}AAAA`, jwks).error, "bad signature");
    assert.equal(verifyJwt(token, { keys: [{ ...jwks.keys[0], kid: "k2" }] }).error, "unknown key");
    assert.equal(verifyJwt("a.b", jwks).error, "malformed token");
    const [, payload, signature] = token.split(".");
    assert.equal(verifyJwt(`${Buffer.from(JSON.stringify({ alg: "HS256", kid: "k1" })).toString("base64url")}.${payload}.${signature}`, jwks).error, "alg HS256 not accepted");
    assert.equal(verifyJwt(`${Buffer.from(JSON.stringify({ alg: "none", kid: "k1" })).toString("base64url")}.${payload}.`, jwks).error, "alg none not accepted");
  });
});
