#!/usr/bin/env node
// Property-based fuzzing of everything that reads data at the deck's boundaries: the contract's
// validators and path maths, the config parser, the share codec, the OSDU mappers, and the LAS,
// QuakeML and SEG-Y parsers. Each property states what must hold for *any* input: nothing throws
// except the stated, worded error; every number out is finite; MD stays monotonic; a simplified
// path stays within its tolerance; round trips hold; and no input reaches Object.prototype.
//
//   node tools/fuzz/run.mjs --runs 500            # t0: every commit
//   node tools/fuzz/run.mjs --runs 10000          # t1: nightly
//   node tools/fuzz/run.mjs --only las,segy --seed 42
//
// A failing seed is written to tools/fuzz/replays.json and replayed first on every later run, so a
// bug found once is checked for ever. The report goes to output/reports/fuzz.json.
import fc from "fast-check";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { BUDGETS } from "../budgets.mjs";
import { validateWell, validateWellbore, validateTrajectory, validateMarkerSet, resolveTrajectory, simplifyPath, catalogueWell, trueToGrid, gridConvergenceDeg } from "../../packages/core/src/data-contract.ts";
import { parseDeckConfig, secretKeys, connectOrigins } from "../../packages/core/src/deck-config.ts";
import { wellFromOsdu, wellboreFromOsdu, trajectoryFromOsdu, markerSetFromOsdu, tableRows, lengthToMetres, angleToDegrees, locationFromOsdu, datumFromVerticalMeasurements, describeOsduError } from "../../packages/core/src/osdu.ts";
import { parseLas, formatLas } from "../../packages/core/src/records.ts";
import { readQuakeML, writeQuakeML } from "../../packages/core/src/quakeml.ts";
import { parseSegy } from "../../packages/core/src/seismic.ts";
import { encodeSharedDeck, decodeSharedDeck, validateSharedDeck, sharedPayload } from "../../apps/deck/src/deck/share-codec.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REPLAYS = `${ROOT}tools/fuzz/replays.json`;
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const RUNS = Number(flag("--runs", "500"));
const ONLY = flag("--only", "")?.split(",").filter(Boolean) ?? [];
const SEED = flag("--seed") === undefined ? undefined : Number(flag("--seed"));

const fixture = (path) => readFileSync(`${ROOT}${path}`);
const LAS = fixture("packages/fixtures/data/forge-16a-openhole-1ft.las").toString();
const LAS_SYNTH = fixture("packages/fixtures/data/synthetic/kestrel-a7-dts-day30.synthetic.las").toString();
const QUAKEML = fixture("packages/fixtures/data/synthetic/forge-16a-stimulation-2022.synthetic.quakeml.xml").toString();
const SEGY = fixture("packages/fixtures/data/forge-16a-psdm-section.sgy");
const WELLS = JSON.parse(fixture("apps/deck/test/fixtures/test.wells.json").toString());

// ── Shared arbitraries ────────────────────────────────────────────────────────────────────────
const finite = (min, max) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
/** Any double, NaN and the infinities included: what an unchecked backend can serve. */
const wild = fc.double();
const nullable = (arb) => fc.option(arb, { nil: null });
/** Names as a hostile or careless backend might serve them. */
const name = fc.oneof(
  { weight: 4, arbitrary: fc.string() },
  fc.string({ unit: "binary", maxLength: 40 }),
  fc.constantFrom("", " ", "<script>__xss()</script>", "__proto__", "constructor", "prototype", "\u202eRTL", "\u200b", "=1+1", "x".repeat(5000), "NaN", "Infinity", "null"),
);
const provenance = fc.record({ kind: fc.constantFrom("documented", "synthetic", "user-authored", "tenant"), source: name });
const well = fc.record({
  id: name, name, field: nullable(fc.record({ id: name, name })),
  location: nullable(fc.record({ longitude: wild, latitude: wild, projected: fc.record({ crs: name, easting: wild, northing: wild }) }, { requiredKeys: ["longitude", "latitude"] })),
  environment: fc.constantFrom("onshore", "offshore", null), waterDepthM: nullable(wild), groundElevationM: nullable(wild), provenance,
});
const datum = fc.record({ reference: fc.constantFrom("RKB", "KB", "DF", "GL", "MSL", "other"), elevationM: nullable(wild) });
const wellbore = fc.record({ id: name, wellId: name, name, status: fc.constantFrom("planned", "drilling", "drilled"), datum, totalDepthMdM: nullable(wild), provenance });
const station = fc.record({ mdM: wild, inclinationDeg: wild, azimuthDeg: wild, tvdM: wild, northM: wild, eastM: wild }, { requiredKeys: ["mdM"] });
const trajectory = fc.record({ id: name, wellboreId: name, name, kind: fc.constantFrom("definitive", "survey", "planned"), azimuthReference: fc.constantFrom("grid", "true", "unknown"), stations: fc.array(station, { maxLength: 40 }), provenance });
const marker = fc.record({ id: name, name, mdM: wild, tvdM: wild, kind: fc.constantFrom("formation", "group", "contact", "other"), lithology: name }, { requiredKeys: ["id", "name", "mdM", "kind"] });
const markerSet = fc.record({ id: name, wellboreId: name, name, markers: fc.array(marker, { maxLength: 30 }), provenance });
const bundle = fc.record({
  well, wellbores: fc.array(fc.record({ wellbore, trajectories: fc.array(trajectory, { maxLength: 3 }), markerSets: fc.array(markerSet, { maxLength: 2 }) }), { maxLength: 3 }),
  problems: fc.array(fc.record({ object: fc.constantFrom("source", "well", "wellbore", "trajectory", "markers"), id: name, severity: fc.constantFrom("error", "warning"), message: name }), { maxLength: 3 }),
}, { requiredKeys: ["well", "wellbores"] });

/**
 * A trajectory that passes its checks: MD strictly rising; angles in range; positions, when given,
 * built from a direction and the MD step, so no station drops further than it was drilled.
 */
const validTrajectory = fc.record({
  mode: fc.constantFrom("angles", "positions", "both"),
  first: fc.record({ mdM: finite(0, 500), tvdM: finite(0, 500), northM: finite(-50, 50), eastM: finite(-50, 50) }),
  steps: fc.array(fc.record({ dMd: finite(0.01, 400), inclinationDeg: finite(0, 180), azimuthDeg: finite(0, 359.999) }), { minLength: 1, maxLength: 60 }),
  azimuthReference: fc.constantFrom("grid", "true", "unknown"),
}).map(({ mode, first, steps, azimuthReference }) => {
  const stations = [];
  let mdM = first.mdM, tvdM = first.tvdM, northM = first.northM, eastM = first.eastM, inclinationDeg = steps[0].inclinationDeg, azimuthDeg = steps[0].azimuthDeg;
  const push = () => stations.push(mode === "angles" ? { mdM, inclinationDeg, azimuthDeg } : mode === "positions" ? { mdM, tvdM, northM, eastM } : { mdM, inclinationDeg, azimuthDeg, tvdM, northM, eastM });
  push();
  for (const step of steps) {
    const inc = step.inclinationDeg * Math.PI / 180, azi = step.azimuthDeg * Math.PI / 180;
    mdM += step.dMd; tvdM += Math.cos(inc) * step.dMd; northM += Math.sin(inc) * Math.cos(azi) * step.dMd; eastM += Math.sin(inc) * Math.sin(azi) * step.dMd;
    inclinationDeg = step.inclinationDeg; azimuthDeg = step.azimuthDeg;
    push();
  }
  return { id: "t", wellboreId: "b", name: "fuzz", kind: "definitive", azimuthReference, stations, provenance: { kind: "synthetic", source: "fuzz" } };
});

/** JSON whose text names `__proto__` as an own key: what JSON.parse of a hostile file yields. */
const protoJson = fc.tuple(fc.jsonValue({ maxDepth: 3 }), fc.jsonValue({ maxDepth: 2 })).map(([a, b]) => JSON.parse(`{"__proto__":${JSON.stringify(b)},"polluted":${JSON.stringify(b)},"x":${JSON.stringify(a)}}`));
const anyJson = fc.oneof({ weight: 3, arbitrary: fc.jsonValue({ maxDepth: 4 }) }, fc.anything({ maxDepth: 3 }), protoJson);

const isFinite = Number.isFinite;
const monotonic = (path) => path.every((point, i) => i === 0 || point.mdM > path[i - 1].mdM);
const allFinite = (path) => path.every((point) => [point.mdM, point.tvdM, point.northingM, point.eastingM, point.inclinationDeg, point.azimuthDeg].every(isFinite));
const unpolluted = () => Object.keys(Object.prototype).length === 0 && !("polluted" in {}) && ({}).x === undefined && Object.getPrototypeOf({}) === Object.prototype;
const problemsOk = (problems) => Array.isArray(problems) && problems.every((problem) => typeof problem.message === "string" && typeof problem.id === "string" && (problem.severity === "error" || problem.severity === "warning"));
/** The thrown error is one of the stated kinds with a message in words, never a crash from inside the parser. */
const statedError = (error, kinds, must) => kinds.some((kind) => error instanceof kind) && typeof error.message === "string" && error.message.length > 0 && (!must || must.test(error.message));
const distanceToSegment = (p, a, b) => {
  const ab = [b.northingM - a.northingM, b.eastingM - a.eastingM, b.tvdM - a.tvdM], ap = [p.northingM - a.northingM, p.eastingM - a.eastingM, p.tvdM - a.tvdM];
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2));
  return Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]);
};

// ── Text and byte mutation of the real fixtures ───────────────────────────────────────────────
const textOps = fc.array(fc.record({ kind: fc.constantFrom("drop-line", "dup-line", "swap-lines", "char", "insert", "truncate", "blank-line", "join-lines"), a: fc.nat(), b: fc.nat(), s: fc.string({ unit: "binary", maxLength: 12 }) }), { minLength: 1, maxLength: 6 });
function mutateText(text, ops) {
  let lines = text.split("\n");
  for (const op of ops) {
    const n = lines.length, i = op.a % Math.max(1, n), j = op.b % Math.max(1, n);
    if (op.kind === "drop-line") lines.splice(i, 1);
    else if (op.kind === "dup-line") lines.splice(i, 0, lines[i] ?? "");
    else if (op.kind === "swap-lines") { const t = lines[i]; lines[i] = lines[j] ?? ""; lines[j] = t ?? ""; }
    else if (op.kind === "blank-line") lines[i] = "";
    else if (op.kind === "join-lines") lines.splice(i, 2, `${lines[i] ?? ""}${lines[i + 1] ?? ""}`);
    else if (op.kind === "char") { const line = lines[i] ?? ""; const k = line.length ? op.b % line.length : 0; lines[i] = line.slice(0, k) + op.s + line.slice(k + 1); }
    else if (op.kind === "insert") { const line = lines[i] ?? ""; const k = line.length ? op.b % line.length : 0; lines[i] = line.slice(0, k) + op.s + line.slice(k); }
    else if (op.kind === "truncate") { const whole = lines.join("\n"); lines = whole.slice(0, op.a % Math.max(1, whole.length)).split("\n"); }
  }
  return lines.join("\n");
}
const byteOps = fc.array(fc.record({ kind: fc.constantFrom("set", "truncate", "zero-run", "u16", "u32", "grow"), a: fc.nat(), b: fc.nat(), n: fc.nat(64) }), { minLength: 1, maxLength: 5 });
/** Byte mutations biased to the headers (the first 3600 bytes and the first trace header), where a parser's trust lives. */
function mutateBytes(source, ops) {
  let bytes = new Uint8Array(source);
  for (const op of ops) {
    const at = op.a % 2 === 0 ? op.b % Math.min(bytes.length || 1, 3840) : op.b % Math.max(1, bytes.length);
    if (op.kind === "set") bytes[at] = op.n & 255;
    else if (op.kind === "truncate") bytes = bytes.slice(0, op.b % Math.max(1, bytes.length));
    else if (op.kind === "zero-run") bytes.fill(0, at, Math.min(bytes.length, at + op.n));
    else if (op.kind === "u16" && bytes.length >= 2) new DataView(bytes.buffer, bytes.byteOffset, bytes.length).setUint16(Math.min(at, bytes.length - 2), op.b & 0xffff, op.n % 2 === 0);
    else if (op.kind === "u32" && bytes.length >= 4) new DataView(bytes.buffer, bytes.byteOffset, bytes.length).setUint32(Math.min(at, bytes.length - 4), op.b >>> 0, op.n % 2 === 0);
    else if (op.kind === "grow") { const grown = new Uint8Array(bytes.length + op.n); grown.set(bytes); bytes = grown; }
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
/** Deletes, retypes or replaces fields anywhere in a JSON tree: a backend that drifted from the contract. */
const treeOps = fc.array(fc.record({ path: fc.array(fc.nat(6), { maxLength: 6 }), kind: fc.constantFrom("delete", "replace", "retype", "proto"), value: fc.jsonValue({ maxDepth: 2 }) }), { minLength: 1, maxLength: 5 });
function mutateTree(root, ops) {
  const copy = JSON.parse(JSON.stringify(root));
  for (const op of ops) {
    let node = copy, parent = null, key = null;
    for (const step of op.path) {
      if (node === null || typeof node !== "object") break;
      const keys = Object.keys(node);
      if (!keys.length) break;
      parent = node; key = keys[step % keys.length]; node = node[key];
    }
    if (parent === null) continue;
    // A list loses the entry outright: JSON has no holes, so a sparse array would be a shape no backend can serve.
    if (op.kind === "delete") { if (Array.isArray(parent)) parent.splice(Number(key), 1); else delete parent[key]; }
    else if (op.kind === "replace") parent[key] = op.value;
    else if (op.kind === "retype") parent[key] = typeof node === "number" ? String(node) : typeof node === "string" ? Number(node) : Array.isArray(node) ? { ...node } : node === null ? [] : null;
    else parent[key] = JSON.parse(`{"__proto__":{"polluted":1},"polluted":1}`);
  }
  return copy;
}

// ── The properties ────────────────────────────────────────────────────────────────────────────
/** name → { property, runs? (a divisor of --runs for the slow ones) } */
const PROPERTIES = {
  "contract/validators-never-throw": fc.property(well, wellbore, trajectory, markerSet, nullable(wild), (w, b, t, m, td) =>
    problemsOk(validateWell(w)) && problemsOk(validateWellbore(b)) && problemsOk(validateTrajectory(t)) && problemsOk(validateMarkerSet(m, td)) && unpolluted()),

  "contract/validator-admits-only-sound-paths": fc.property(trajectory, (t) => {
    if (validateTrajectory(t).some((p) => p.severity === "error")) return true;
    // Whatever passed must resolve to finite, monotonic stations: the checks are the only gate before drawing.
    const path = resolveTrajectory(t);
    return path.length === t.stations.length && allFinite(path) && monotonic(path);
  }),

  "contract/resolve-finite-monotonic": fc.property(validTrajectory, (t) => {
    if (validateTrajectory(t).some((p) => p.severity === "error")) throw new Error(`the generator made an invalid path: ${validateTrajectory(t)[0].message}`);
    const path = resolveTrajectory(t);
    if (path.length !== t.stations.length || !allFinite(path) || !monotonic(path)) return false;
    // No station lies deeper than the hole drilled to it, and a supplied position is kept as given.
    return path.every((point, i) => point.tvdM - path[0].tvdM <= point.mdM - path[0].mdM + 1e-6
      && (t.stations[i].tvdM === undefined || point.tvdM === t.stations[i].tvdM)
      && (t.stations[i].northM === undefined || point.northingM === t.stations[i].northM));
  }),

  "contract/simplify-within-tolerance": fc.property(validTrajectory, finite(0, 60), (t, tolerance) => {
    const path = resolveTrajectory(t), simple = simplifyPath(path, tolerance);
    if (simple.length < Math.min(2, path.length) || simple.length > path.length) return false;
    if (simple[0] !== path[0] || simple.at(-1) !== path.at(-1) || !monotonic(simple)) return false;
    // Every kept point is an original, and every original lies within the tolerance of the simplified line.
    if (!simple.every((point) => path.includes(point))) return false;
    return path.every((point) => Math.min(...simple.slice(1).map((b, i) => distanceToSegment(point, simple[i], b))) <= tolerance + 1e-6);
  }),

  "contract/simplify-handles-anything": fc.property(fc.array(fc.record({ mdM: wild, tvdM: wild, northingM: wild, eastingM: wild, inclinationDeg: wild, azimuthDeg: wild }), { maxLength: 30 }), wild, (path, tolerance) => {
    const simple = simplifyPath(path, tolerance);
    return Array.isArray(simple) && simple.length <= Math.max(path.length, 0) && simple.every((point) => path.includes(point));
  }),

  "contract/catalogue-well-never-throws": fc.property(bundle, (b) => {
    const { entry, problems } = catalogueWell(b, "fuzz");
    if (!problemsOk(problems) || !unpolluted()) return false;
    const wellError = validateWell(b.well).some((p) => p.severity === "error");
    if (wellError !== (entry === null)) return false;
    return entry === null || entry.wellbores.every((bore) => allFinite(bore.path) && monotonic(bore.path) && Array.isArray(bore.markers));
  }),

  "contract/catalogue-mutated-fixture": fc.property(fc.nat(WELLS.wells.length - 1), treeOps, (i, ops) => {
    // A backend's drift from the contract (fields gone, lists that are not lists, `__proto__` keys) costs one well with a stated reason, never a throw that loses the batch.
    const result = catalogueWell(mutateTree(WELLS.wells[i], ops), "fuzz");
    return problemsOk(result.problems) && unpolluted() && (result.entry === null || result.entry.wellbores.every((bore) => allFinite(bore.path) && monotonic(bore.path)));
  }),

  "contract/grid-maths-finite": fc.property(finite(-180, 180), finite(-89.9, 89.9), finite(-180, 180), finite(-1e5, 1e5), finite(-1e5, 1e5), (lon, lat, cm, n, e) => {
    const c = gridConvergenceDeg(lon, lat, cm);
    const turned = trueToGrid(n, e, Number.isFinite(c) ? c : 0);
    // A rotation keeps length.
    return isFinite(turned.northM) && isFinite(turned.eastM) && Math.abs(Math.hypot(turned.northM, turned.eastM) - Math.hypot(n, e)) < 1e-6 * (1 + Math.hypot(n, e));
  }),

  "config/parse-never-throws": fc.property(anyJson, (json) => {
    const { config, problems } = parseDeckConfig(json);
    const strict = parseDeckConfig(json, { strict: true });
    if (!Array.isArray(config.sources) || !Array.isArray(problems) || !problems.every((p) => typeof p === "string") || !Array.isArray(strict.problems)) return false;
    // Whatever came out is a config the deck can act on without a secret in it, and its origins are https.
    if (secretKeys(config).length) return false;
    const origins = connectOrigins(config);
    if (!origins.every((origin) => /^https:\/\/[^/]+$/.test(origin))) return false;
    // A secret anywhere in the input is named in the problems, and never carried.
    const secrets = secretKeys(json);
    return (secrets.length === 0 || problems.some((p) => /credential/.test(p))) && unpolluted();
  }),

  "config/structured-garbage": fc.property(fc.record({
    version: anyJson, about: anyJson,
    sources: fc.array(fc.record({ type: fc.oneof(fc.constantFrom("samples", "browser", "contract-json", "osdu", "witsml-etp", "ppdm-api"), name), url: fc.oneof(name, fc.webUrl(), anyJson), label: anyJson, dataPartition: anyJson, auth: anyJson, paths: anyJson, kinds: anyJson, query: anyJson, pageSize: anyJson, clientSecret: anyJson }, { requiredKeys: [] }), { maxLength: 4 }),
    auth: fc.dictionary(name, fc.record({ issuer: fc.oneof(name, fc.webUrl()), clientId: anyJson, scopes: anyJson, metadata: anyJson, extraParams: anyJson, password: anyJson }, { requiredKeys: [] }), { maxKeys: 3 }),
    share: anyJson, csp: fc.record({ connectSrc: fc.oneof(anyJson, fc.array(fc.oneof(name, fc.webUrl()))) }, { requiredKeys: [] }), instance: anyJson, telemetry: anyJson, crs: anyJson,
  }, { requiredKeys: [] }), (json) => {
    const { config, problems } = parseDeckConfig(json, { strict: true });
    if (!Array.isArray(problems) || secretKeys(config).length) return false;
    // Every source kept is of a known type with an https url when it has one; nothing else survives.
    return config.sources.every((source) => ["samples", "browser", "contract-json", "osdu", "witsml-etp", "ppdm-api"].includes(source.type) && (source.url === undefined || typeof source.url === "string"))
      && connectOrigins(config).every((origin) => origin.startsWith("https://")) && unpolluted();
  }),

  "share/round-trip": fc.asyncProperty(fc.record({
    v: fc.constant(1),
    site: nullable(fc.record({ id: name, well: nullable(name) })),
    tiles: fc.dictionary(name, fc.record({ col: fc.integer({ min: -4, max: 40 }), row: fc.integer({ min: -4, max: 40 }), w: fc.integer({ min: 0, max: 40 }), h: fc.integer({ min: 0, max: 40 }) }), { maxKeys: 8 }),
    stage: name, component: nullable(name), md: nullable(finite(0, 1e5)),
    window: nullable(fc.tuple(finite(-1e6, 1e6), finite(-1e6, 1e6))), brush: nullable(fc.tuple(finite(-1e6, 1e6), finite(-1e6, 1e6))),
    time: nullable(fc.integer({ min: -8.64e15, max: 8.64e15 })),
    slices: nullable(fc.record({ inline: nullable(finite(-1e6, 1e6)), crossline: nullable(finite(-1e6, 1e6)), depth: nullable(finite(-1e6, 1e6)) })),
    sectionLine: nullable(fc.tuple(fc.tuple(finite(-1e6, 1e6), finite(-1e6, 1e6)), fc.tuple(finite(-1e6, 1e6), finite(-1e6, 1e6)))),
    fusions: fc.dictionary(name, name, { maxKeys: 4 }),
    whatIf: nullable(fc.record({ label: name, value: fc.constant({ brief: { identity: {}, sections: [] }, hydraulics: {} }) })),
    carried: nullable(fc.oneof(
      fc.record({ kind: fc.constant("design"), builtIn: fc.boolean(), value: fc.constant({ brief: { identity: {}, sections: [] }, hydraulics: {} }) }),
      fc.record({ kind: fc.constant("recorded"), value: fc.record({ identity: fc.constant({}), location: fc.constant({}), stations: fc.constant([]), tops: fc.constant([]), components: fc.constant([]), totalDepthM: finite(0, 1e4) }) }),
      fc.record({ kind: fc.constant("edit"), siteId: name, wellId: name, value: fc.record({ identity: fc.constant({}), location: fc.constant({}), stations: fc.constant([]), tops: fc.constant([]), components: fc.constant([]), totalDepthM: finite(0, 1e4) }) }),
    )),
  }), async (deck) => {
    // `__proto__` as a tile or fusion name cannot survive JSON.stringify → JSON.parse as an own key, so it is left to the garbage property.
    if ("__proto__" in deck.tiles || "__proto__" in deck.fusions) return true;
    const text = await encodeSharedDeck(deck);
    if (!/^[A-Za-z0-9_-]*$/.test(text) || sharedPayload(`#deck=${text}`) !== text) return false;
    const back = await decodeSharedDeck(text);
    return JSON.stringify(back) === JSON.stringify(JSON.parse(JSON.stringify(deck))) && unpolluted();
  }),

  "share/garbage-is-refused-in-words": fc.asyncProperty(fc.oneof(fc.string(), fc.string({ unit: "binary" }), fc.stringMatching(/^[A-Za-z0-9_-]{0,200}$/)), anyJson, async (text, json) => {
    try { await decodeSharedDeck(text); } catch (error) { if (!statedError(error, [TypeError], /link/)) return false; }
    try { validateSharedDeck(json); } catch (error) { if (!statedError(error, [TypeError], /link/)) return false; }
    return sharedPayload(text) === null || typeof sharedPayload(text) === "string" ? unpolluted() : false;
  }),

  "share/tampered-link-is-refused-in-words": fc.asyncProperty(fc.nat(), fc.constantFrom("A", "z", "0", "_", "-"), fc.nat(), async (at, char, cut) => {
    const text = await encodeSharedDeck({ v: 1, site: { id: "forge", well: null }, tiles: { a: { col: 0, row: 0, w: 2, h: 2 } }, stage: "plan", component: null, md: 12.5, window: null, brush: null, time: null, slices: null, sectionLine: null, fusions: {}, whatIf: null, carried: null });
    const i = at % text.length;
    const tampered = cut % 3 === 0 ? text.slice(0, i) : text.slice(0, i) + char + text.slice(i + 1);
    try { await decodeSharedDeck(tampered); return true; } catch (error) { return statedError(error, [TypeError], /link/); }
  }),

  "osdu/mappers-never-throw": fc.property(fc.record({ id: name, kind: name, version: fc.option(fc.nat()), modifyTime: fc.option(name), data: fc.oneof(
    fc.dictionary(name, anyJson, { maxKeys: 6 }),
    fc.record({ FacilityName: anyJson, SpatialLocation: anyJson, GeoContexts: anyJson, VerticalMeasurements: anyJson, WellID: anyJson, WellboreID: anyJson, DefaultVerticalMeasurementID: anyJson, FacilityOperators: anyJson, CountryID: anyJson, FacilityStates: anyJson, AvailableTrajectoryStationProperties: anyJson, Markers: anyJson, VerticalMeasurement: anyJson, Name: anyJson, UWI: anyJson, FacilityNameAliases: anyJson }, { requiredKeys: [] }),
    protoJson,
  ) }, { requiredKeys: ["id", "kind", "data"] }), fc.oneof(
    fc.record({ columns: fc.array(fc.oneof(name, fc.constantFrom("MD", "TVD", "X", "Y", "AzimuthTN", "AzimuthGN", "Inclination", "Measured Depth", "True Vertical Depth", "MarkerMeasuredDepth", "MarkerName")), { maxLength: 8 }), data: fc.array(fc.array(anyJson, { maxLength: 8 }), { maxLength: 10 }), index: fc.option(fc.array(anyJson, { maxLength: 10 })) }, { requiredKeys: ["columns", "data"] }),
    fc.dictionary(name, fc.dictionary(name, anyJson, { maxKeys: 5 }), { maxKeys: 6 }),
    fc.array(fc.dictionary(fc.oneof(name, fc.constantFrom("MD", "TVD", "X", "Y", "MarkerMeasuredDepth", "MarkerName")), anyJson, { maxKeys: 6 }), { maxLength: 10 }),
    anyJson,
  ), fc.array(fc.tuple(name, name), { maxLength: 3 }), (record, table, fieldNames) => {
    const problems = [];
    const partition = "fuzz";
    const w = wellFromOsdu(record, partition, new Map(fieldNames), problems);
    const b = wellboreFromOsdu(record, partition, problems);
    let t, m, rows;
    try { rows = tableRows(table); } catch (error) { if (!statedError(error, [TypeError, RangeError])) return false; }
    t = trajectoryFromOsdu(record, table, partition, problems, { definitive: true });
    m = markerSetFromOsdu(record, table, partition, problems);
    locationFromOsdu(record.data, problems, record.id); datumFromVerticalMeasurements(record.data, problems, record.id);
    if (!problemsOk(problems) || !unpolluted()) return false;
    // What came out is in the contract's shape: strings where it says strings, numbers or null where it says so.
    if (typeof w.id !== "string" || typeof w.name !== "string" || (w.location !== null && !(isFinite(w.location.longitude) && isFinite(w.location.latitude)))) return false;
    if (typeof b.id !== "string" || (b.datum.elevationM !== null && !isFinite(b.datum.elevationM)) || (b.totalDepthMdM !== null && !isFinite(b.totalDepthMdM))) return false;
    // A trajectory with no readable table is null, with a stated problem; one that came out is in shape.
    if (t !== null && (!Array.isArray(t.stations) || !t.stations.every((s) => typeof s.mdM === "number"))) return false;
    if (!Array.isArray(m.markers) || !m.markers.every((marker) => typeof marker.mdM === "number" && typeof marker.name === "string")) return false;
    // And the contract's own checks then take it without a crash; what passes resolves finite.
    if (t !== null && !validateTrajectory(t).some((p) => p.severity === "error") && !allFinite(resolveTrajectory(t))) return false;
    return problemsOk(validateWell(w)) && problemsOk(validateWellbore(b)) && problemsOk(validateMarkerSet(m, b.totalDepthMdM)) && (rows === undefined || Array.isArray(rows));
  }),

  "osdu/units-and-errors": fc.property(wild, fc.oneof(name, fc.constantFrom("m", "ft", "ftUS", "opendes:reference-data--UnitOfMeasure:ft:", "opendes:reference-data--UnitOfMeasure:m:", "dega", "rad", undefined)), anyJson, (value, uom, cause) => {
    const metres = lengthToMetres(value, uom), degrees = angleToDegrees(value, uom);
    if (!(metres === null || typeof metres === "number") || !(degrees === null || typeof degrees === "number")) return false;
    // A known unit on a finite value converts to a finite value; a finite metre value is never changed by "m".
    if (isFinite(value) && metres !== null && !isFinite(metres)) return false;
    if (isFinite(value) && /(^|:)m:?$/.test(uom ?? "") && metres !== value) return false;
    const text = describeOsduError(cause, "fuzz", "https://osdu.example.com");
    return typeof text === "string" && text.length > 0 && !/undefined|\[object Object\]/.test(text);
  }),

  "las/mutated-fixtures": fc.property(fc.constantFrom(LAS, LAS_SYNTH), textOps, (source, ops) => {
    const text = mutateText(source, ops);
    let las;
    try { las = parseLas(text); } catch (error) { if (statedError(error, [RangeError], /LAS/)) return true; throw error; }
    const n = las.curves[0]?.values.length ?? 0;
    if (!las.curves.every((curve) => curve.values.length === n)) throw new Error(`curves of unequal length: ${las.curves.map((curve) => curve.values.length).join(", ")}`);
    if (!las.curves.every((curve) => curve.values.every((v) => v === null || isFinite(v)))) throw new Error("a curve value is neither null nor finite");
    if (!isFinite(las.nullValue)) throw new Error(`null value ${las.nullValue} is not a number`);
    return typeof las.version === "string";
  }),

  "las/garbage": fc.property(fc.oneof(fc.string(), fc.string({ unit: "binary" }), fc.stringMatching(/^(~[VWCPAO][^\n]{0,20}\n([^\n]{0,30}\n){0,4}){0,5}$/)), (text) => {
    try { const las = parseLas(text); return las.curves.every((curve) => curve.values.every((v) => v === null || isFinite(v))); } catch (error) { return statedError(error, [RangeError], /LAS/); }
  }),

  "las/format-then-parse": fc.property(fc.record({
    curves: fc.array(fc.record({ mnemonic: fc.stringMatching(/^[A-Z][A-Z0-9_]{0,5}$/), unit: fc.constantFrom("M", "FT", "", "API", "OHMM"), description: fc.string({ maxLength: 20 }).map((s) => s.replace(/:/g, " ")), digits: fc.integer({ min: 0, max: 6 }) }), { minLength: 1, maxLength: 5 }),
    n: fc.integer({ min: 0, max: 40 }), values: fc.infiniteStream(nullable(finite(-1e6, 1e6))),
    well: fc.array(fc.record({ mnemonic: fc.stringMatching(/^[A-Z]{2,4}$/), unit: fc.constant(""), value: fc.string({ maxLength: 12 }).map((s) => s.replace(/:/g, " ").trim()), description: fc.string({ maxLength: 12 }).map((s) => s.replace(/:/g, " ")) }), { maxLength: 3 }),
  }), ({ curves, n, values, well }) => {
    const stream = values[Symbol.iterator]();
    const file = { well, curves: curves.map((curve, c) => ({ ...curve, value: "", values: Array.from({ length: n }, (_, i) => c === 0 ? i * 0.5 : stream.next().value) })) };
    const back = parseLas(formatLas(file));
    if (back.curves.length !== curves.length) return false;
    return back.curves.every((curve, c) => curve.mnemonic === curves[c].mnemonic && curve.values.length === n && curve.values.every((v, i) => {
      const expected = file.curves[c].values[i];
      // A value that rounds onto the null value is read as null: the format's own ambiguity, and the one allowed difference.
      if (expected === null) return v === null;
      return (v === null && Math.abs(expected - -999.25) < 10 ** -curves[c].digits) || (v !== null && Math.abs(v - expected) <= 0.5 * 10 ** -curves[c].digits + 1e-9);
    }));
  }),

  "quakeml/mutated-fixture": fc.property(textOps, (ops) => {
    const xml = mutateText(QUAKEML, ops);
    let catalogue;
    try { catalogue = readQuakeML(xml); } catch (error) { return statedError(error, [SyntaxError], /QuakeML/); }
    return typeof catalogue.publicId === "string" && catalogue.events.every((event) => [event.latitude, event.longitude, event.depthM, event.magnitude].every(isFinite) && typeof event.time === "string" && typeof event.id === "string");
  }),

  "quakeml/garbage": fc.property(fc.oneof(fc.string(), fc.string({ unit: "binary" }), fc.stringMatching(/^<(q:)?quakeml><eventParameters( publicID="[a-z]{0,5}")?>(<event( publicID="[a-z:/]{0,8}")?>(<origin>(<latitude><value>[-0-9.e]{0,6}<\/value><\/latitude>)?(<time><value>[0-9T:Z-]{0,12}<\/value><\/time>)?<\/origin>)?(<magnitude><mag><value>[-0-9.]{0,4}<\/value><\/mag><\/magnitude>)?<\/event>){0,3}<\/eventParameters><\/(q:)?quakeml>$/)), (xml) => {
    try { const c = readQuakeML(xml); return c.events.every((event) => [event.latitude, event.longitude, event.depthM, event.magnitude].every(isFinite)); } catch (error) { return statedError(error, [SyntaxError], /QuakeML/); }
  }),

  "quakeml/write-then-read": fc.property(fc.record({
    publicId: fc.stringMatching(/^smi:[a-z.]{1,12}\/[a-z0-9]{1,8}$/), description: fc.option(fc.string({ maxLength: 30 })), agency: fc.option(fc.stringMatching(/^[A-Z]{2,6}$/)),
    events: fc.array(fc.record({
      id: fc.stringMatching(/^smi:[a-z.]{1,8}\/event\/[a-z0-9]{1,8}$/), time: fc.date({ min: new Date("1970-01-01"), max: new Date("2100-01-01"), noInvalidDate: true }).map((d) => d.toISOString()),
      latitude: finite(-90, 90), longitude: finite(-180, 180), depthM: finite(-1000, 50000), magnitude: finite(-2, 9.9), magnitudeType: fc.constantFrom("Mw", "ML", "Mwa", "Md"),
      timeUncertaintyS: fc.option(finite(0, 100), { nil: undefined }), horizontalUncertaintyM: fc.option(finite(0, 1e4), { nil: undefined }), depthUncertaintyM: fc.option(finite(0, 1e4), { nil: undefined }),
      evaluationMode: fc.option(fc.constantFrom("manual", "automatic"), { nil: undefined }), type: fc.option(fc.constantFrom("earthquake", "induced or triggered event", "<b>&"), { nil: undefined }), comment: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
    }), { maxLength: 6 }),
  }), (catalogue) => {
    const back = readQuakeML(writeQuakeML(catalogue));
    if (back.publicId !== catalogue.publicId || back.events.length !== catalogue.events.length) return false;
    return back.events.every((event, i) => {
      const e = catalogue.events[i];
      const near = (a, b, digits) => Math.abs(a - b) <= 0.5 * 10 ** -digits + 1e-9;
      return event.id === e.id && event.time === e.time && near(event.latitude, e.latitude, 7) && near(event.longitude, e.longitude, 7) && near(event.depthM, e.depthM, 1) && near(event.magnitude, e.magnitude, 2)
        && event.magnitudeType === e.magnitudeType && (e.type === undefined || event.type === e.type) && (e.comment === undefined || e.comment.trim() === "" || event.comment === e.comment.trim()) && event.evaluationMode === e.evaluationMode
        && (e.horizontalUncertaintyM === undefined || near(event.horizontalUncertaintyM, e.horizontalUncertaintyM, 1));
    });
  }),

  "segy/mutated-fixture": { runs: 0.2, property: fc.property(byteOps, (ops) => {
    const buffer = mutateBytes(SEGY, ops);
    let file;
    try { file = parseSegy(buffer, { maxTraces: 64 }); } catch (error) { return statedError(error, [Error], /SEG-Y/) && !(error instanceof RangeError); }
    return file.traceCount >= 0 && file.data.length === file.traceCount * file.sampleCount && file.traces.length === file.traceCount && file.textHeader.length === 40 && file.traces.every((trace) => [trace.x, trace.y, trace.inline, trace.crossline].every((v) => typeof v === "number"));
  }) },

  "segy/garbage": fc.property(fc.oneof(fc.uint8Array({ maxLength: 4000 }), fc.uint8Array({ minLength: 3600, maxLength: 3600 }).chain((head) => fc.tuple(fc.constant(head), fc.constantFrom(1, 2, 3, 5, 8), fc.nat(0xffff), fc.integer({ min: 0, max: 4 })).map(([bytes, format, samples, ext]) => {
    // A header that claims a format, a sample count and extended headers the body never delivers.
    const view = new DataView(bytes.buffer); view.setUint16(3224, format, false); view.setUint16(3220, samples, false); view.setInt16(3504, ext, false); return bytes;
  }))), (bytes) => {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    try { const file = parseSegy(buffer, { maxTraces: 16 }); return file.data.length === file.traceCount * file.sampleCount; } catch (error) { return statedError(error, [Error], /SEG-Y/) && !(error instanceof RangeError); }
  }),
};

// ── Running, replaying, reporting ─────────────────────────────────────────────────────────────
const replays = JSON.parse(readFileSync(REPLAYS, "utf8"));
const chosen = Object.entries(PROPERTIES).filter(([key]) => !ONLY.length || ONLY.some((only) => key === only || key.startsWith(`${only}/`)));
if (args.includes("--list")) { for (const [key] of chosen) console.log(key); process.exit(0); }
const results = [];
let failed = 0;
const t0 = performance.now();
for (const [key, spec] of chosen) {
  const property = spec.property ?? spec;
  const runs = Math.max(20, Math.round(RUNS * (spec.runs ?? 1)));
  const started = performance.now();
  // Replays first: every seed that ever failed is run again at its own path, so a fix stays fixed.
  const again = replays.filter((entry) => entry.property === key);
  const outcomes = [];
  for (const entry of again) outcomes.push(await fc.check(property, { seed: entry.seed, path: entry.path, endOnFailure: true, numRuns: 1 }));
  outcomes.push(await fc.check(property, { numRuns: runs, seed: SEED, endOnFailure: true }));
  const failure = outcomes.find((outcome) => outcome.failed);
  const ms = Math.round(performance.now() - started);
  if (failure) {
    failed += 1;
    const cause = failure.errorInstance ?? failure.error;
    results.push({ property: key, status: "FAIL", runs, ms, seed: failure.seed, path: failure.counterexamplePath, counterexample: failure.counterexample, error: String(cause?.message ?? cause).slice(0, 400) });
    if (!again.some((entry) => entry.seed === failure.seed && entry.path === failure.counterexamplePath)) replays.push({ property: key, seed: failure.seed, path: failure.counterexamplePath, found: new Date().toISOString().slice(0, 10) });
    console.log(`FAIL ${key}  seed ${failure.seed} path ${failure.counterexamplePath} [${ms} ms]\n     ${String(cause?.message ?? cause).split("\n")[0].slice(0, 300)}\n     ${fc.stringify(failure.counterexample).slice(0, 600)}`);
    // --dump: the whole counterexample and the stack, for working out what the shrunk input did.
    if (args.includes("--dump")) console.log(`\n${fc.stringify(failure.counterexample)}\n\n${cause?.stack ?? ""}\n`);
  } else {
    results.push({ property: key, status: "ok", runs, replays: again.length, ms });
    console.log(`ok   ${key}  ${runs} runs${again.length ? ` + ${again.length} replay${again.length === 1 ? "" : "s"}` : ""} [${ms} ms]`);
  }
}
const totalMs = Math.round(performance.now() - t0);
writeFileSync(REPLAYS, `${JSON.stringify(replays, null, 2)}\n`);
mkdirSync(`${ROOT}output/reports`, { recursive: true });
writeFileSync(`${ROOT}output/reports/fuzz.json`, JSON.stringify({ at: new Date().toISOString(), runs: RUNS, totalMs, failed, results }, null, 2));
const budgetMs = RUNS <= BUDGETS.fuzz.runsT0 ? BUDGETS.fuzz.t0Ms : BUDGETS.fuzz.t1Ms;
const overBudget = totalMs > budgetMs;
console.log(`\n${chosen.length} properties, ${failed} failed, ${(totalMs / 1000).toFixed(1)} s (budget ${budgetMs / 1000} s${overBudget ? ", OVER" : ""}). Report: output/reports/fuzz.json`);
process.exit(failed || overBudget ? 1 : 0);
