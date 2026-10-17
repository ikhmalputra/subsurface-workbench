import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { CONFIG_SCHEMA_VERSION, DEFAULT_CONFIG, connectOrigins, parseDeckConfig, secretKeys } from "./deck-config.ts";

const errors = (problems: readonly string[]) => problems.filter((problem) => !problem.startsWith("Note:"));

test("a full client config parses to exactly what it says, and nothing it does not", () => {
  const { config, problems } = parseDeckConfig({
    version: 1,
    sources: [
      { type: "osdu", label: "Our OSDU", url: "https://osdu.example.com", dataPartition: "opendes", auth: "corp", kinds: { well: "*:*:master-data--Well:1.*.*" }, query: "data.FacilityName:*" },
      { type: "contract-json", url: "data/wells.index.json" },
    ],
    auth: { corp: { issuer: "https://login.example.com/tenant", clientId: "abc", scopes: ["openid", "offline_access"], extraParams: { audience: "osdu" }, metadata: { tokenEndpoint: "https://token.example.com/oauth2/token" } } },
    share: { mode: "reference" },
    csp: { connectSrc: ["https://telemetry.example.com/v1", "https://extra.example.com"] },
    instance: { id: "north", name: "North block" },
    telemetry: { endpoint: "https://otel.example.com/v1/traces" },
  });
  assert.deepEqual(problems, []);
  assert.equal(config.version, CONFIG_SCHEMA_VERSION);
  assert.equal(config.sources.length, 2);
  const osdu = config.sources[0]!;
  assert.ok(osdu.type === "osdu" && osdu.auth === "corp" && osdu.kinds?.well === "*:*:master-data--Well:1.*.*" && osdu.query === "data.FacilityName:*");
  assert.deepEqual(config.auth?.corp?.scopes, ["openid", "offline_access"]);
  assert.equal(config.auth?.corp?.metadata?.tokenEndpoint, "https://token.example.com/oauth2/token");
  assert.equal(config.share?.mode, "reference");
  assert.deepEqual(config.csp?.connectSrc, ["https://telemetry.example.com", "https://extra.example.com"]);
  assert.deepEqual(connectOrigins(config), ["https://extra.example.com", "https://login.example.com", "https://osdu.example.com", "https://otel.example.com", "https://telemetry.example.com", "https://token.example.com"]);
});

test("a credential anywhere is refused: the entry holding it is left out, and the reader is told where", () => {
  const { config, problems } = parseDeckConfig({ sources: [
    { type: "osdu", url: "https://osdu.example.com", dataPartition: "p", clientSecret: "shh" },
    { type: "samples" },
  ], auth: { corp: { issuer: "https://login.example.com", clientId: "x", client_secret: "shh" } } });
  assert.deepEqual(config.sources.map((source) => source.type), ["samples"]);
  assert.equal(config.auth, undefined);
  assert.ok(problems.some((problem) => /sources\[0\]\.clientSecret/.test(problem)));
  assert.ok(problems.some((problem) => /auth\.corp\.client_secret/.test(problem)));
  assert.deepEqual(secretKeys({ a: { apiKey: 1, tokenEndpoint: "fine", nested: [{ password: "x" }] } }), ["a.apiKey", "a.nested[0].password"]);
});

test("a config for a newer schema is refused whole; a missing version means 1", () => {
  const newer = parseDeckConfig({ version: CONFIG_SCHEMA_VERSION + 1, sources: [{ type: "samples" }] });
  assert.deepEqual(newer.config, DEFAULT_CONFIG);
  assert.match(newer.problems[0]!, /written for config schema 2/);
  assert.deepEqual(errors(parseDeckConfig({ sources: [{ type: "browser" }] }).problems), []);
  assert.match(parseDeckConfig({ version: "one", sources: [] }).problems[0]!, /invalid "version"/);
});

test("urls and origins: https or a path beside the deck; never http, javascript or a wildcard", () => {
  const read = parseDeckConfig({ sources: [
    { type: "contract-json", url: "javascript:alert(1)" },
    { type: "contract-json", url: "http://plain.example.com/w.json" },
    { type: "contract-json", url: "./data/ok.json" },
    { type: "osdu", url: "https://osdu.example.com" },
    { type: "osdu", url: "/osdu-proxy", dataPartition: "p" },
    { type: "ftp", url: "ftp://x" },
  ], csp: { connectSrc: ["https://*.example.com", "http://plain.example.com", "https://ok.example.com/path"] }, telemetry: { endpoint: "http://otel" } });
  assert.deepEqual(read.config.sources.map((source) => "url" in source ? source.url : source.type), ["./data/ok.json", "/osdu-proxy"]);
  assert.equal(read.problems.filter((problem) => /"url" must be/.test(problem)).length, 2);
  assert.ok(read.problems.some((problem) => /dataPartition/.test(problem)));
  assert.ok(read.problems.some((problem) => /type "ftp"/.test(problem)));
  assert.deepEqual(read.config.csp?.connectSrc, ["https://ok.example.com"]);
  assert.equal(read.problems.filter((problem) => /connectSrc entry/.test(problem)).length, 2);
  assert.ok(read.problems.some((problem) => /telemetry\.endpoint/.test(problem)));
});

test("an auth profile must be https with a client id; a source naming an unknown profile is left out", () => {
  const read = parseDeckConfig({ sources: [{ type: "osdu", url: "https://o.example.com", dataPartition: "p", auth: "nope" }, { type: "osdu", url: "https://o.example.com", dataPartition: "p" }],
    auth: { bad: { issuer: "http://login.example.com", clientId: "x" }, noid: { issuer: "https://login.example.com" }, ok: { issuer: "https://login.example.com", clientId: "x" } } });
  assert.deepEqual(Object.keys(read.config.auth ?? {}), ["ok"]);
  assert.deepEqual(read.config.auth?.ok?.scopes, ["openid"]);
  assert.equal(read.config.sources.length, 1, "the source naming a missing profile is left out; the one without auth stays");
  assert.ok(read.problems.some((problem) => /names a profile \("nope"\)/.test(problem)));
  assert.ok(read.problems.some((problem) => problem.startsWith("Note:") && /no "auth" profile/.test(problem)));
});

test("share mode and strictness", () => {
  assert.equal(parseDeckConfig({ sources: [], share: { mode: "carry" } }).config.share?.mode, "carry");
  assert.match(parseDeckConfig({ sources: [], share: { mode: "loud" } }).problems[0]!, /share\.mode/);
  const loose = parseDeckConfig({ sources: [], extra: 1 }), strict = parseDeckConfig({ sources: [], extra: 1 }, { strict: true });
  assert.match(loose.problems[0]!, /^Note: unknown key "extra"/);
  assert.match(strict.problems[0]!, /^unknown key "extra"/);
});

test("every frozen config from an earlier release still parses without errors", () => {
  const dir = new URL("./fixtures/compat/", import.meta.url);
  const files = readdirSync(dir).filter((name) => /^config-v1-.*\.json$/.test(name));
  assert.ok(files.length >= 2, `${files.length} compat fixtures`);
  for (const name of files) {
    const read = parseDeckConfig(JSON.parse(readFileSync(new URL(name, dir), "utf8")));
    assert.deepEqual(errors(read.problems), [], `${name}: ${read.problems.join(" | ")}`);
    assert.ok(read.config.sources.length > 0, name);
  }
});
