#!/usr/bin/env node
// A mock OSDU platform: Search (query_with_cursor and query) over the stress tenant's records, the
// Wellbore DDMS bulk endpoints for trajectories and marker sets, the platform's own gatekeeping
// (a bearer token the mock identity provider signed, the data-partition-id header, strict CORS),
// four data profiles, and a fault engine with an admin API on a second port.
//
//   node tools/mock-osdu/server.mjs --wells 200000 --per-field 200 --profile quirky --port 4100 \
//     --admin-port 4101 --allow-origin http://127.0.0.1:8080 --partition opendes \
//     --idp http://127.0.0.1:4102 --seed 7
//
// Without --idp a mock identity provider starts in this process on --idp-port (4102). Records are
// generated per field on demand (records.mjs), so 200,000 wells cost nothing until asked for.
// Plain node:http and node:crypto, no dependencies.
import { gzipSync } from "node:zlib";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { FAMILIES, KINDS, PROFILES, tenantRecords } from "./records.mjs";
import { LuceneError, kindMatcher, parseQuery, stripRef } from "./lucene.mjs";
import { createFaults } from "./faults.mjs";
import { verifyJwt } from "./jwt.mjs";
import { createIdp } from "./idp.mjs";

const MAX_LIMIT = 1000, MAX_OFFSET = 10_000, MAX_BODY = 1_048_576, MAX_CURSORS = 10_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const osduError = (code, reason, message) => ({ code, reason, message });

/** `record` cut to the dotted paths Search was asked for (`id`, `kind`, `data.FacilityName`, …). */
export function pickFields(record, fields) {
  if (!Array.isArray(fields) || !fields.length) return record;
  const out = {};
  for (const path of fields) {
    if (typeof path !== "string") continue;
    const parts = path.split(".");
    let source = record, target = out;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (source === null || typeof source !== "object" || !Object.hasOwn(source, part)) break;
      if (i === parts.length - 1) target[part] = source[part];
      else { target[part] ??= {}; target = target[part]; source = source[part]; }
    }
  }
  return out;
}

/** A bulk table as pandas writes JSON: `split` ({columns, index, data}) or `columns` ({col: {row: value}}). NaN and Infinity come out as Python's json.dumps writes them. */
export function pandasJson({ columns, rows }, orient = "split") {
  const value = (v) => typeof v === "number" ? (Number.isNaN(v) ? "NaN" : v === Infinity ? "Infinity" : v === -Infinity ? "-Infinity" : String(v)) : JSON.stringify(v ?? null);
  if (orient === "split") return `{"columns":${JSON.stringify(columns)},"index":[${rows.map((_, i) => i).join(",")}],"data":[${rows.map((row) => `[${row.map(value).join(",")}]`).join(",")}]}`;
  if (orient === "columns") return `{${columns.map((column, c) => `${JSON.stringify(column)}:{${rows.map((row, i) => `"${i}":${value(row[c])}`).join(",")}}`).join(",")}}`;
  if (orient === "records") return `[${rows.map((row) => `{${columns.map((column, c) => `${JSON.stringify(column)}:${value(row[c])}`).join(",")}}`).join(",")}]`;
  throw new RangeError(`orient must be split, columns or records`);
}

export function createMockOsdu(options = {}) {
  const {
    port = 4100, adminPort = 4101, host = "127.0.0.1", profile = "clean", perField = 200, partition = "opendes", allowOrigin = "http://127.0.0.1:8080",
    seed = 7, cursorTtlS = 60, gzip = false, idp: idpUrl, jwks: jwksProvider, issuer, log: logLine = () => {},
  } = options;
  if (!PROFILES.includes(profile)) throw new RangeError(`--profile must be one of ${PROFILES.join(", ")}`);
  const wells = options.wells ?? (profile === "huge" ? 200_000 : 1000), stations = options.stations ?? (profile === "huge" ? 2000 : 300);
  const records = tenantRecords({ wells, perField, stations, profile, partition });
  const faults = createFaults({ seed });
  const { log } = faults;
  const cursors = new Map();
  let api = null, admin = null;

  // ── The identity provider's keys ────────────────────────────────────────────────────────────
  let jwksCache = null, jwksAt = 0;
  async function loadJwks(force = false) {
    if (jwksProvider) return jwksProvider();
    if (jwksCache && !force && Date.now() - jwksAt < 60_000) return jwksCache;
    const discovery = await fetch(`${idpUrl}/.well-known/openid-configuration`).then((r) => r.ok ? r.json() : null).catch(() => null);
    const response = await fetch(discovery?.jwks_uri ?? `${idpUrl}/jwks`);
    if (!response.ok) throw new Error(`JWKS ${response.status}`);
    jwksCache = await response.json(); jwksAt = Date.now();
    return jwksCache;
  }
  async function authenticate(request, clockSkewS) {
    const match = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? "");
    if (!match) return { error: "no bearer token" };
    const nowS = Math.floor(Date.now() / 1000) + clockSkewS;
    let result = verifyJwt(match[1], await loadJwks(), { nowS, issuer: issuer ?? undefined });
    if (result.error === "unknown key" && !jwksProvider) result = verifyJwt(match[1], await loadJwks(true), { nowS, issuer: issuer ?? undefined });
    return result;
  }

  // ── Search ──────────────────────────────────────────────────────────────────────────────────
  class BadRequest extends Error { constructor(message, reason = "Bad Request") { super(message); this.reason = reason; } }
  const sweepCursors = () => {
    const now = Date.now();
    for (const [token, state] of cursors) if (now - state.lastUsedAt > cursorTtlS * 1000) cursors.delete(token);
    while (cursors.size > MAX_CURSORS) cursors.delete(cursors.keys().next().value);
  };
  /** The records a query names, resolved by id without touching fields it does not need. */
  function resolve(families, parsed) {
    const found = [], seen = new Set();
    const add = (record) => { if (record && !seen.has(record.id)) { seen.add(record.id); found.push(record); } };
    for (const family of families) {
      for (const value of parsed.values) {
        const key = value.split(":").pop();
        if (parsed.field === "id") { const record = records.byKey(family, key); if (record && (record.id === value || key === value)) add(record); }
        else if (parsed.field === "data.WellID" && family === "wellbore") { const record = records.byKey("wellbore", key); if (record && stripRef(record.data.WellID) === value) add(record); }
        else if (parsed.field === "data.WellboreID" && (family === "trajectory" || family === "markerSet")) { const record = records.byKey(family, `${key}${family === "trajectory" ? "-def" : "-tops"}`); if (record && stripRef(record.data.WellboreID) === value) add(record); }
      }
    }
    return found;
  }
  function searchPage({ kind, query, limit, offset, returnedFields }) {
    const matches = kindMatcher(kind);
    const families = FAMILIES.filter((family) => matches(KINDS[family]));
    const parsed = parseQuery(query);
    let results, totalCount;
    if (parsed.all) {
      const counts = families.map((family) => records.count(family));
      totalCount = counts.reduce((sum, count) => sum + count, 0);
      results = [];
      let skip = offset;
      for (let f = 0; f < families.length && results.length < limit; f++) {
        if (skip >= counts[f]) { skip -= counts[f]; continue; }
        for (let n = skip; n < counts[f] && results.length < limit; n++) results.push(records.at(families[f], n));
        skip = 0;
      }
    } else {
      const found = resolve(families, parsed);
      totalCount = found.length;
      results = found.slice(offset, offset + limit);
    }
    return { results: results.map((record) => pickFields(record, returnedFields)), totalCount, hasMore: offset + limit < totalCount };
  }
  function validateSearchBody(body, { withOffset }) {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequest("the request body is a JSON object");
    const limit = body.limit === undefined ? 10 : body.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new BadRequest(`limit must be an integer from 1 to ${MAX_LIMIT}`);
    if (body.returnedFields !== undefined && (!Array.isArray(body.returnedFields) || !body.returnedFields.every((field) => typeof field === "string"))) throw new BadRequest("returnedFields must be a list of field paths");
    const offset = withOffset ? body.offset ?? 0 : 0;
    if (withOffset && (!Number.isInteger(offset) || offset < 0 || offset + limit > MAX_OFFSET)) throw new BadRequest(`offset must be an integer from 0, and offset + limit at most ${MAX_OFFSET}`);
    return { limit, offset, returnedFields: body.returnedFields };
  }
  function queryWithCursor(body, fault) {
    sweepCursors();
    const { limit, returnedFields } = validateSearchBody(body, { withOffset: false });
    let state;
    if (body.cursor !== undefined && body.cursor !== null) {
      if (typeof body.cursor !== "string") throw new BadRequest("cursor must be a string");
      state = cursors.get(body.cursor);
      if (!state || fault.expireCursors) { cursors.delete(body.cursor); throw new BadRequest("The cursor has expired or is not known. Start the query again.", "cursor expired"); }
      cursors.delete(body.cursor);
    } else {
      if (typeof body.kind !== "string") throw new BadRequest("kind is required");
      state = { kind: body.kind, query: body.query, limit, returnedFields, offset: 0 };
    }
    const page = searchPage(state);
    const out = { results: page.results, totalCount: page.totalCount };
    if (page.hasMore) { const token = randomUUID().replaceAll("-", "") + Buffer.from(String(state.offset)).toString("base64url"); cursors.set(token, { ...state, offset: state.offset + state.limit, lastUsedAt: Date.now() }); out.cursor = token; }
    return out;
  }
  function queryWithOffset(body) {
    const { limit, offset, returnedFields } = validateSearchBody(body, { withOffset: true });
    if (typeof body.kind !== "string") throw new BadRequest("kind is required");
    const page = searchPage({ kind: body.kind, query: body.query, limit, offset, returnedFields });
    return { results: page.results, totalCount: page.totalCount };
  }

  // ── Wellbore DDMS bulk ──────────────────────────────────────────────────────────────────────
  function bulkData(kindPath, recordId, search) {
    const table = records.bulk(recordId);
    const expected = kindPath === "wellboretrajectories" ? "WellboreTrajectory" : "WellboreMarkerSet";
    if (!table || !recordId.includes(`--${expected}:`)) return { status: 404, body: osduError(404, "Not Found", `${expected} ${recordId} was not found in partition ${partition}`) };
    const orient = search.get("orient") ?? "split";
    if (!["split", "columns", "records"].includes(orient)) return { status: 400, body: osduError(400, "Bad Request", "orient must be split, columns or records") };
    let { columns, rows } = table;
    const curves = search.get("curves");
    if (curves !== null) {
      const wanted = curves.split(",").map((name) => name.trim()).filter(Boolean);
      const unknown = wanted.filter((name) => !columns.includes(name));
      if (unknown.length) return { status: 400, body: osduError(400, "Bad Request", `Unknown curves: ${unknown.join(", ")}. Available: ${columns.join(", ")}`) };
      const indexes = wanted.map((name) => columns.indexOf(name));
      columns = wanted; rows = rows.map((row) => indexes.map((i) => row[i]));
    }
    const offset = Number(search.get("offset") ?? 0), limit = Number(search.get("limit") ?? rows.length);
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 0) return { status: 400, body: osduError(400, "Bad Request", "offset and limit must be non-negative integers") };
    if (offset || limit < rows.length) rows = rows.slice(offset, offset + limit);
    return { status: 200, text: pandasJson({ columns, rows }, orient) };
  }

  // ── HTTP plumbing ───────────────────────────────────────────────────────────────────────────
  const readJson = (request) => new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    request.on("data", (chunk) => { size += chunk.length; if (size > MAX_BODY) { reject(new BadRequest("the request body is over 1 MB", "Payload Too Large")); request.destroy(); return; } chunks.push(chunk); });
    request.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch { reject(new BadRequest("the request body is not JSON")); } });
    request.on("error", reject);
  });
  const routeOf = (method, pathname) => {
    if (method === "POST" && (pathname === "/api/search/v2/query_with_cursor" || pathname === "/api/search/v2/query")) return "search";
    const bulk = /^\/api\/os-wellbore-ddms\/ddms\/v3\/(wellboretrajectories|wellboremarkersets)\/([^/]+)\/data$/.exec(pathname);
    if (method === "GET" && bulk) return bulk[1] === "wellboretrajectories" ? "trajectory" : "markers";
    return "other";
  };
  /** Write a JSON body, through the fault engine's output faults: reset, trickle, truncate, oversize. */
  function deliver(response, status, payload, fault, headers = {}) {
    let text = typeof payload === "string" ? payload : JSON.stringify(payload);
    if (fault.oversizeBytes > 0 && text.endsWith("}")) text = `${text.slice(0, -1)},"padding":"${"x".repeat(fault.oversizeBytes)}"}`;
    let body = Buffer.from(text, "utf8");
    if (fault.truncateJson) body = body.subarray(0, Math.max(1, Math.floor(body.length / 2)));
    // --gzip: compressed as a platform's ingress with compression on would send it, when the client accepts it and no output fault is set.
    const outputFault = fault.reset || fault.truncateJson || fault.trickleBytesPerS > 0 || fault.oversizeBytes > 0;
    if (gzip && !outputFault && /\bgzip\b/.test(response.req?.headers["accept-encoding"] ?? "")) { body = gzipSync(body); headers = { ...headers, "content-encoding": "gzip", vary: "Accept-Encoding" }; }
    if (fault.reset) {
      response.locals.reset = true;
      response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": String(body.length), ...headers });
      response.write(body.subarray(0, Math.floor(body.length / 2)));
      setTimeout(() => response.destroy(), 5);
      return;
    }
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": String(body.length), ...headers });
    if (fault.trickleBytesPerS > 0) {
      response.flushHeaders();
      const interval = 100, chunk = Math.max(1, Math.round(fault.trickleBytesPerS * interval / 1000));
      let offset = 0;
      const step = () => {
        if (response.destroyed) return;
        const next = body.subarray(offset, offset + chunk); offset += chunk;
        if (offset >= body.length) response.end(next); else { response.write(next); setTimeout(step, interval); }
      };
      step();
      return;
    }
    response.end(body);
  }
  const plain = (response, status, payload, headers = {}) => { const body = Buffer.from(JSON.stringify(payload)); response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": String(body.length), ...headers }); response.end(body); };

  async function handleApi(request, response) {
    response.locals = {};
    const requestId = randomUUID();
    response.setHeader("x-request-id", requestId);
    response.setHeader("cache-control", "no-store");
    if (request.headers["correlation-id"]) response.setHeader("correlation-id", String(request.headers["correlation-id"]));
    const url = new URL(request.url, `http://${host}`);
    const origin = request.headers.origin;
    const originAllowed = origin !== undefined && origin === allowOrigin;
    if (originAllowed) { response.setHeader("access-control-allow-origin", origin); response.setHeader("vary", "Origin"); response.setHeader("access-control-expose-headers", "x-request-id, correlation-id, retry-after"); }
    if (request.method === "OPTIONS") {
      // Preflight: only the deck's origin, only the headers the adapter sends. Another origin is refused outright.
      if (!originAllowed) { response.writeHead(403); response.end(); return; }
      response.writeHead(204, { "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "authorization, data-partition-id, content-type, correlation-id", "access-control-max-age": "600" });
      response.end(); return;
    }
    const route = routeOf(request.method, url.pathname);
    const end = log.begin(route);
    let retryAfterS;
    response.on("close", () => end({ status: response.statusCode, aborted: !response.writableFinished && !response.locals.reset, retryAfterS }));
    const fault = faults.decide(route);
    logLine(`${request.method} ${url.pathname} (${route}${fault.status ? `, fault ${fault.status}` : ""}${fault.latencyMs ? `, +${fault.latencyMs} ms` : ""})`);
    if (fault.latencyMs > 0) { await sleep(fault.latencyMs); if (response.destroyed) return; }

    let auth;
    try { auth = await authenticate(request, fault.clockSkewS); } catch (error) { return plain(response, 503, osduError(503, "Service Unavailable", `The identity provider's keys could not be read: ${error.message}`)); }
    if (auth.error) return plain(response, 401, osduError(401, "Unauthorized", `The user is not authorized to perform this action (${auth.error}).`), { "www-authenticate": `Bearer error="invalid_token", error_description="${auth.error}"` });
    if (fault.status === 401) return plain(response, 401, osduError(401, "Unauthorized", "The user is not authorized to perform this action (token rejected)."), { "www-authenticate": 'Bearer error="invalid_token"' });
    const partitionHeader = request.headers["data-partition-id"];
    if (partitionHeader !== partition) return plain(response, 403, osduError(403, "Forbidden", `Entitlements: user ${auth.claims.sub} does not belong to group users.datalake.viewers@${partitionHeader || "(no data-partition-id)"}.example.com and may not access partition ${partitionHeader || "(none)"}.`));
    if (fault.status === 429) { retryAfterS = fault.retryAfterS; return plain(response, 429, osduError(429, "Too Many Requests", `Rate limit exceeded on ${route}. Retry after ${retryAfterS} s.`), { "retry-after": String(retryAfterS) }); }
    if (fault.status >= 500) return plain(response, fault.status, osduError(fault.status, fault.status === 503 ? "Service Unavailable" : fault.status === 502 ? "Bad Gateway" : "Internal Server Error", `Injected fault on ${route} (seed ${seed}).`));
    if (route === "other") return plain(response, 404, osduError(404, "Not Found", `${request.method} ${url.pathname} is not an endpoint of this mock platform.`));

    try {
      if (route === "search") {
        const body = await readJson(request);
        const result = url.pathname.endsWith("query_with_cursor") ? queryWithCursor(body, fault) : queryWithOffset(body);
        return deliver(response, 200, result, fault);
      }
      const [, kindPath, rawId] = /^\/api\/os-wellbore-ddms\/ddms\/v3\/(wellboretrajectories|wellboremarkersets)\/([^/]+)\/data$/.exec(url.pathname);
      const result = bulkData(kindPath, decodeURIComponent(rawId), url.searchParams);
      return deliver(response, result.status, result.text ?? result.body, fault);
    } catch (error) {
      if (error instanceof LuceneError) return plain(response, 400, osduError(400, "Bad Request", `Invalid query: ${error.message}`));
      if (error instanceof BadRequest) return plain(response, error.reason === "Payload Too Large" ? 413 : 400, osduError(error.reason === "Payload Too Large" ? 413 : 400, error.reason, error.message));
      logLine(`error: ${error.stack ?? error}`);
      return plain(response, 500, osduError(500, "Internal Server Error", error.message));
    }
  }

  async function handleAdmin(request, response) {
    const url = new URL(request.url, `http://${host}`);
    const reply = (status, payload) => plain(response, status, payload, { "cache-control": "no-store" });
    try {
      if (request.method === "GET" && url.pathname === "/__admin/health") return reply(200, { ok: true, profile, wells, perField, stations, partition, allowOrigin, issuer: issuer ?? idpUrl ?? null, cursorTtlS, seed, cachedFields: records.cachedFields(), openCursors: cursors.size });
      if (request.method === "GET" && url.pathname === "/__admin/log") return reply(200, log.snapshot());
      if (request.method === "GET" && url.pathname === "/__admin/faults") return reply(200, faults.current());
      if (request.method === "POST" && url.pathname === "/__admin/faults") { const body = await readJson(request); return reply(200, faults.set(body)); }
      if (request.method === "POST" && url.pathname === "/__admin/reset") { faults.reset(); cursors.clear(); return reply(200, { ok: true }); }
      return reply(404, { error: "not found", endpoints: ["GET /__admin/health", "GET /__admin/log", "GET /__admin/faults", "POST /__admin/faults", "POST /__admin/reset"] });
    } catch (error) {
      return reply(error instanceof BadRequest ? 400 : 400, { error: error.message });
    }
  }

  const listenOn = (server, wanted) => new Promise((resolve, reject) => { server.on("error", reject); server.listen(wanted, host, () => resolve(server.address().port)); });
  return {
    records, faults, log,
    get url() { return api ? `http://${host}:${api.address().port}` : null; },
    get adminUrl() { return admin ? `http://${host}:${admin.address().port}` : null; },
    async listen() {
      api = createServer((request, response) => handleApi(request, response).catch((error) => { logLine(`error: ${error.stack ?? error}`); if (!response.headersSent) plain(response, 500, osduError(500, "Internal Server Error", error.message)); else response.destroy(); }));
      admin = createServer((request, response) => handleAdmin(request, response).catch((error) => plain(response, 500, { error: error.message })));
      api.keepAliveTimeout = 5000;
      const [apiPort, adminPortBound] = await Promise.all([listenOn(api, port), listenOn(admin, adminPort)]);
      return { port: apiPort, adminPort: adminPortBound, url: this.url, adminUrl: this.adminUrl };
    },
    async close() {
      for (const server of [api, admin]) if (server) { server.closeAllConnections?.(); await new Promise((resolve) => server.close(() => resolve())); }
      api = admin = null;
    },
  };
}

export function parseServerArgs(argv) {
  const flag = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
  const number = (name, fallback) => { const value = flag(name); return value === undefined ? fallback : Number(value); };
  return {
    wells: number("--wells"), perField: number("--per-field", 200), stations: number("--stations"), profile: flag("--profile", "clean"),
    port: number("--port", 4100), adminPort: number("--admin-port", 4101), allowOrigin: flag("--allow-origin", "http://127.0.0.1:8080"), partition: flag("--partition", "opendes"),
    idp: flag("--idp"), idpPort: number("--idp-port", 4102), gzip: argv.includes("--gzip"), seed: number("--seed", 7), cursorTtlS: number("--cursor-ttl", 60), tokenTtlS: number("--token-ttl", 300), clockSkewS: number("--clock-skew", 0),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseServerArgs(process.argv.slice(2));
  const say = (line) => console.log(`${new Date().toISOString()} ${line}`);
  let idp = null, idpUrl = args.idp;
  if (!idpUrl) {
    idp = createIdp({ port: args.idpPort, tokenTtlS: args.tokenTtlS, clockSkewS: args.clockSkewS, log: (line) => say(`[idp] ${line}`) });
    ({ issuer: idpUrl } = await idp.listen());
    say(`Mock identity provider at ${idpUrl}`);
  }
  const mock = createMockOsdu({ ...args, idp: idpUrl, issuer: idpUrl, log: (line) => say(`[osdu] ${line}`) });
  const { url, adminUrl } = await mock.listen();
  say(`Mock OSDU (${args.profile}) at ${url}: ${mock.records.wells.toLocaleString("en-US")} wells in ${mock.records.fieldCount.toLocaleString("en-US")} fields of ${args.perField}, ${mock.records.stations} stations each, partition ${args.partition}, origin ${args.allowOrigin}`);
  say(`Admin API at ${adminUrl}/__admin/{health,log,faults,reset}`);
  const stop = async () => { await mock.close(); await idp?.close(); process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}
