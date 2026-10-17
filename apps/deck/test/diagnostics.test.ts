import assert from "node:assert/strict";
import test from "node:test";
import { parseDeckConfig } from "@ikhmalputra/subsurface-core/deck-config";
import { diagnosticsBundle, errorKind, formatDiagnostics, recordError, recentErrors } from "../src/deck/diagnostics.ts";
import type { DiagnosticsInput } from "../src/deck/diagnostics.ts";

const TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhbGljZUBleGFtcGxlLmNvbSJ9.c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWduYXR1cmU";
const input = (): DiagnosticsInput => ({
  now: new Date("2026-10-17T16:00:00Z"),
  version: { version: "0.4.0", commit: "9f1376612", builtAt: "2026-10-17T15:00:00Z", schemas: { config: 1, contract: "1.1" }, minUpgradeFrom: "0.0.1" },
  origin: "https://deck.tenant.example", base: "/x/",
  browser: { userAgent: "TestBrowser/1", language: "en", cores: 8, memoryGiB: 8, webgl2: true, webgpu: false, viewport: "1440×1000", dpr: 2, online: true },
  config: parseDeckConfig({ version: 1, sources: [{ type: "samples" }, { type: "osdu", label: "Our OSDU", url: "https://osdu.tenant.example/api/v2/?partition=secret-name", dataPartition: "opendes", auth: "corp" }], auth: { corp: { issuer: "https://login.tenant.example/realms/wells", clientId: "deck", scopes: ["openid"] } }, share: { mode: "reference" } }).config,
  configProblems: ["Note: unknown key \"extra\" in config.json (ignored)."],
  sources: [
    { id: "samples-0", label: "Samples", standard: "Bundled samples", wells: 12, reading: false, error: null },
    { id: "osdu-1", label: "Our OSDU", standard: "OSDU", wells: 48_000, total: 200_000, reading: true, truncated: false, error: `401 at https://osdu.tenant.example/api/search/v2/query_with_cursor?token=${TOKEN} for well Alpha-7` },
  ],
  fields: new Map([["osdu-1:north", { reading: true, error: null }], ["osdu-1:south", { reading: false, error: "cut short" }]]),
  wellCount: 48_012, loading: true,
  problems: [{ sourceId: "osdu-1", object: "trajectory", id: "osdu-1:Alpha-7", severity: "error", message: "Alpha-7's path: Station 3: MD does not increase" }, { sourceId: "osdu-1", object: "well", id: "w", severity: "warning", message: "The well Bravo-2 has no name." }],
  auth: { profiles: { corp: { status: "signed-in", sub: "alice@tenant.example", name: "Alice Example", expiresAt: new Date("2026-10-17T16:30:00Z").getTime(), error: null } } },
  storage: { usedMiB: 12.5, quotaMiB: 10_000, deckKeys: 4, deckBytes: 2048 },
  errors: [{ at: new Date("2026-10-17T15:59:00Z").getTime(), message: `Failed to fetch https://osdu.tenant.example/x?code=abc&state=xyz (Bearer ${TOKEN})` }],
});

test("the bundle carries the build, browser, source origins, counts and statuses", () => {
  const bundle = diagnosticsBundle(input());
  assert.equal(bundle.build?.version, "0.4.0");
  assert.deepEqual(bundle.sources.map((s) => [s.type, s.origin, s.wells, s.total, s.reading]), [["samples", null, 12, null, false], ["osdu", "https://osdu.tenant.example", 48_000, 200_000, true]]);
  assert.deepEqual(bundle.catalogue, { wells: 48_012, loading: true, fields: 2, fieldsReading: 1, fieldsFailed: 1, problems: { "trajectory/error": 1, "well/warning": 1 } });
  assert.deepEqual(bundle.auth, [{ profile: "corp", issuerOrigin: "https://login.tenant.example", status: "signed-in", signedIn: true, expiresInS: 1800, error: null }]);
  assert.equal(bundle.config.shareMode, "reference");
  assert.equal(bundle.config.problems.length, 1);
  assert.equal(bundle.errors.length, 1);
});

test("the bundle holds no token, no person, no well name and no URL beyond its origin", () => {
  const text = formatDiagnostics(diagnosticsBundle(input()));
  for (const secret of [TOKEN, "alice", "Alice", "Alpha-7", "Bravo-2", "partition=secret-name", "/api/v2", "code=abc", "state=xyz", "/realms/wells"]) assert.doesNotMatch(text, new RegExp(secret.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")), `holds ${secret}`);
  const bundle = diagnosticsBundle(input());
  assert.equal(bundle.sources[1]?.error, "sign-in", "an error travels as its kind");
  assert.deepEqual(bundle.errors.map((e) => e.kind), ["unreachable"]);
  assert.match(text, /unknown key \\"extra\\"/, "a config note names a key, never data, and is kept");
});

test("errorKind names the trouble, never the text", () => {
  assert.equal(errorKind(null), null);
  assert.equal(errorKind("No access to partition opendes: the account needs…"), "access");
  assert.equal(errorKind("The listing's cursor expired on the platform: read again."), "cursor-expired");
  assert.equal(errorKind("The response is larger than the 64 MB limit: cut short."), "too-large");
  assert.equal(errorKind("The request timed out after 30 s."), "timeout");
  assert.equal(errorKind("The browser could not reach https://x: blocked by CORS…"), "unreachable");
  assert.equal(errorKind("502 Bad Gateway from the platform"), "http-502");
  assert.equal(errorKind("TypeError: Cannot read properties of undefined (reading 'mdM') for well Alpha-7"), "TypeError");
  assert.equal(errorKind("Alpha-7's path: Station 3: MD does not increase"), "other");
});

test("the last errors are kept, capped at twenty, newest last", () => {
  for (let i = 0; i < 25; i++) recordError(`error ${i}`);
  assert.equal(recentErrors().length, 20);
  assert.equal(recentErrors().at(-1)?.message, "error 24");
  assert.equal(diagnosticsBundle({ ...input(), errors: recentErrors() }).errors.length, 10);
});
