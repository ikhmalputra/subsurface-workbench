/**
 * The deck's runtime configuration: `config.json` beside the deck, read when it starts, written by
 * whoever hosts it. It names the sources the wells come from and the identity provider the tenant
 * signs in with. Nothing in it is a secret: a config holding one is refused, so a key can never be
 * published by mistake.
 *
 * {
 *   "version": 1,
 *   "sources": [
 *     { "type": "samples" },
 *     { "type": "browser" },
 *     { "type": "contract-json", "label": "Field A export", "url": "data/field-a.wells.json" },
 *     { "type": "osdu", "label": "Our OSDU", "url": "https://osdu.example.com", "dataPartition": "opendes", "auth": "corp" }
 *   ],
 *   "auth": { "corp": { "issuer": "https://login.example.com/tenant", "clientId": "…", "scopes": ["openid", "profile", "offline_access"] } },
 *   "share": { "mode": "reference" }
 * }
 *
 * The same parser runs in the deck and in the deployment's renderer, so a config is judged once,
 * the same way, wherever it is read.
 */

export const CONFIG_SCHEMA_VERSION = 1;

/** An OpenID Connect provider, as a public client sees it: no secret, ever. */
export interface AuthProfile {
  readonly issuer: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
  /** Extra authorization-request parameters some providers need (`audience`, `resource`). */
  readonly extraParams?: Readonly<Record<string, string>>;
  /** Endpoints given outright, for a provider whose discovery document does not cover them (Cognito's token endpoint is on another host). */
  readonly metadata?: { readonly authorizationEndpoint?: string; readonly tokenEndpoint?: string; readonly jwksUri?: string; readonly endSessionEndpoint?: string };
}

/** Which OSDU APIs an `osdu` source calls, and the record kinds it asks for; the defaults fit a standard platform. */
export interface OsduPaths { readonly search?: string; readonly wellboreDdms?: string }
export interface OsduKinds { readonly well?: string; readonly field?: string; readonly wellbore?: string; readonly trajectory?: string; readonly markerSet?: string }

export type SourceConfig =
  | { readonly type: "samples" }
  | { readonly type: "browser" }
  /** Wells already in the data contract's JSON, as a file (or a paged index of files) the deployment serves. */
  | { readonly type: "contract-json"; readonly label?: string; readonly url: string; readonly auth?: string }
  | { readonly type: "osdu"; readonly label?: string; readonly url: string; readonly dataPartition: string; readonly auth?: string; readonly paths?: OsduPaths; readonly kinds?: OsduKinds; readonly query?: string }
  | { readonly type: "witsml-etp"; readonly label?: string; readonly url: string; readonly auth?: string }
  | { readonly type: "ppdm-api"; readonly label?: string; readonly url: string; readonly auth?: string };

export type ShareMode = "reference" | "carry" | "off";

export interface DeckConfig {
  readonly version: typeof CONFIG_SCHEMA_VERSION;
  readonly sources: readonly SourceConfig[];
  readonly auth?: Readonly<Record<string, AuthProfile>>;
  /** What a share link carries: ids and view state only (`reference`, a client's default), the sender's own wells too (`carry`, the public demo), or nothing (`off`). */
  readonly share?: { readonly mode: ShareMode };
  /** Extra origins the deployment's CSP must let the browser connect to, beyond the sources and providers named here. */
  readonly csp?: { readonly connectSrc?: readonly string[] };
  readonly instance?: { readonly id?: string; readonly name?: string };
  /** The tenant's own OpenTelemetry collector; nothing is ever sent anywhere else. */
  readonly telemetry?: { readonly endpoint?: string };
  /** Coordinate reference systems of the tenant's own (a local grid, an engineering CRS), by code, as proj4 strings; EPSG codes come with the SDK. */
  readonly crs?: { readonly definitions: Readonly<Record<string, string>> };
}

export const DEFAULT_CONFIG: DeckConfig = Object.freeze({ version: 1, sources: Object.freeze([{ type: "samples" }, { type: "browser" }] as const) });

/** The adapters a config may name, and whether this build has them yet. */
export const SOURCE_TYPES = Object.freeze({
  samples: { label: "Bundled samples", standard: "Utah FORGE, FORCE 2020, Equator and Kestrel A-7", available: true },
  browser: { label: "This browser", standard: "Wells entered, imported or designed on the deck", available: true },
  "contract-json": { label: "Wells file", standard: "Data contract JSON (subsurface-wells)", available: true },
  osdu: { label: "OSDU", standard: "OSDU Search and Wellbore DDMS", available: false },
  "witsml-etp": { label: "WITSML store", standard: "WITSML 2.1 over ETP 1.2", available: false },
  "ppdm-api": { label: "PPDM", standard: "An API over a PPDM 3.9 database", available: false },
} as const);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isHttps = (value: unknown): value is string => typeof value === "string" && /^https:\/\/[^\s/?#]+/.test(value);
/** A same-origin path, or https: a config must not send the deck to a plain-http or script URL. */
const safeUrl = (value: unknown): value is string => typeof value === "string" && value.length > 0 && (isHttps(value) || !/^[a-z][a-z0-9+.-]*:/i.test(value));
/** A key that could only ever hold a credential. */
const SECRET_KEY = /^(client[_-]?secret|api[_-]?key|password|passwd|secret|access[_-]?token|refresh[_-]?token|id[_-]?token|bearer|private[_-]?key)$/i;

/** Every key path in a value that looks like a credential. */
export function secretKeys(value: unknown, path = ""): readonly string[] {
  if (Array.isArray(value)) return value.flatMap((entry, i) => secretKeys(entry, `${path}[${i}]`));
  if (!isObject(value)) return [];
  return Object.entries(value).flatMap(([key, entry]) => [...(SECRET_KEY.test(key) ? [`${path ? `${path}.` : ""}${key}`] : []), ...secretKeys(entry, `${path ? `${path}.` : ""}${key}`)]);
}

/** An https origin from a URL or an origin, else null. */
export const originOf = (url: string): string | null => { try { const parsed = new URL(url); return parsed.protocol === "https:" ? parsed.origin : null; } catch { return null; } };

export interface ParsedConfig { readonly config: DeckConfig; readonly problems: readonly string[] }

/**
 * A config read from JSON: every source and provider it names that the deck understands, and a
 * problem for each thing it does not. A config with no usable `sources` falls back to the default,
 * and says so; one written for a newer schema is refused whole, since its meaning is not known.
 * With `strict`, unknown keys are problems too (the deployment's renderer refuses them; the deck
 * only reports them).
 */
export function parseDeckConfig(json: unknown, options: { readonly strict?: boolean } = {}): ParsedConfig {
  const problems: string[] = [];
  if (!isObject(json)) return { config: DEFAULT_CONFIG, problems: ["config.json is not an object: using the bundled samples and this browser's wells."] };
  const version = json.version === undefined ? 1 : json.version;
  if (!Number.isInteger(version) || (version as number) < 1) return { config: DEFAULT_CONFIG, problems: [`config.json has an invalid "version" (${JSON.stringify(json.version)}): using the default.`] };
  if ((version as number) > CONFIG_SCHEMA_VERSION) return { config: DEFAULT_CONFIG, problems: [`config.json is written for config schema ${version}; this build reads schema ${CONFIG_SCHEMA_VERSION}. Upgrade the deck, or write the config for schema ${CONFIG_SCHEMA_VERSION}.`] };
  for (const key of secretKeys(json)) problems.push(`"${key}" looks like a credential. A config is public: it must never hold one. The entry holding it is ignored.`);
  const known = new Set(["version", "sources", "auth", "share", "csp", "instance", "telemetry", "crs"]);
  for (const key of Object.keys(json)) if (!known.has(key)) problems.push(`${options.strict ? "" : "Note: "}unknown key "${key}" in config.json${options.strict ? "" : " (ignored)"}.`);

  // Identity providers first, so sources can name them.
  const auth: Record<string, AuthProfile> = {};
  if (json.auth !== undefined) {
    if (!isObject(json.auth)) problems.push('"auth" must be an object of named profiles.');
    else for (const [name, entry] of Object.entries(json.auth)) {
      const at = `auth.${name}`;
      if (!isObject(entry)) { problems.push(`${at} must be an object.`); continue; }
      if (secretKeys(entry).length) { problems.push(`${at} holds a credential and is ignored.`); continue; }
      if (!isHttps(entry.issuer)) { problems.push(`${at}: "issuer" must be an https URL.`); continue; }
      if (typeof entry.clientId !== "string" || !entry.clientId) { problems.push(`${at}: "clientId" is required.`); continue; }
      const scopes = Array.isArray(entry.scopes) && entry.scopes.every((scope) => typeof scope === "string") ? entry.scopes as string[] : null;
      if (entry.scopes !== undefined && !scopes) { problems.push(`${at}: "scopes" must be a list of strings.`); continue; }
      const profile: AuthProfile = { issuer: entry.issuer, clientId: entry.clientId, scopes: scopes?.length ? scopes : ["openid"] };
      const extra = entry.extraParams;
      if (extra !== undefined) { if (isObject(extra) && Object.values(extra).every((value) => typeof value === "string")) (profile as { extraParams?: Record<string, string> }).extraParams = extra as Record<string, string>; else problems.push(`${at}: "extraParams" must map names to strings (ignored).`); }
      const meta = entry.metadata;
      if (meta !== undefined) {
        if (!isObject(meta)) problems.push(`${at}: "metadata" must be an object (ignored).`);
        else {
          const endpoints: Record<string, string> = {};
          for (const key of ["authorizationEndpoint", "tokenEndpoint", "jwksUri", "endSessionEndpoint"]) if (meta[key] !== undefined) { if (isHttps(meta[key])) endpoints[key] = meta[key] as string; else problems.push(`${at}.metadata.${key} must be an https URL (ignored).`); }
          (profile as { metadata?: AuthProfile["metadata"] }).metadata = endpoints;
        }
      }
      auth[name] = profile;
    }
  }

  if (!Array.isArray(json.sources)) return { config: { ...DEFAULT_CONFIG, ...(Object.keys(auth).length ? { auth } : {}) }, problems: [...problems, 'config.json has no "sources" list: using the bundled samples and this browser\'s wells.'] };
  const sources: SourceConfig[] = [];
  const named = (entry: Record<string, unknown>, at: string): { auth?: string } | null => {
    if (entry.auth === undefined) return {};
    if (typeof entry.auth !== "string" || !auth[entry.auth]) { problems.push(`${at}: "auth" names a profile (${JSON.stringify(entry.auth)}) that config.json does not define.`); return null; }
    return { auth: entry.auth };
  };
  json.sources.forEach((entry, index) => {
    const at = `Source ${index + 1}`;
    if (!isObject(entry) || typeof entry.type !== "string") { problems.push(`${at} has no "type".`); return; }
    if (secretKeys(entry).length) { problems.push(`${at} (${entry.type}) holds a credential and is left out.`); return; }
    const label = typeof entry.label === "string" ? entry.label : undefined;
    switch (entry.type) {
      case "samples": case "browser":
        if (sources.some((source) => source.type === entry.type)) problems.push(`${at}: "${entry.type}" is listed twice.`);
        else sources.push({ type: entry.type });
        return;
      case "contract-json": case "witsml-etp": case "ppdm-api": {
        if (!safeUrl(entry.url)) { problems.push(`${at} (${entry.type}): "url" must be a path beside the deck or an https address.`); return; }
        const authed = named(entry, at); if (!authed) return;
        sources.push({ type: entry.type, url: entry.url, ...(label ? { label } : {}), ...authed });
        return;
      }
      case "osdu": {
        if (!safeUrl(entry.url)) { problems.push(`${at} (osdu): "url" must be an https address, or a path beside the deck that proxies to one.`); return; }
        if (typeof entry.dataPartition !== "string" || !entry.dataPartition) { problems.push(`${at} (osdu): "dataPartition" is required.`); return; }
        const authed = named(entry, at); if (!authed) return;
        if (!authed.auth) problems.push(`Note: ${at} (osdu) names no "auth" profile: its requests will carry no sign-in.`);
        const strings = (value: unknown, keys: readonly string[]): Record<string, string> | undefined => { if (value === undefined) return undefined; if (!isObject(value)) { problems.push(`${at} (osdu): expected an object (ignored).`); return undefined; } const out: Record<string, string> = {}; for (const key of keys) if (typeof value[key] === "string") out[key] = value[key] as string; return out; };
        const paths = strings(entry.paths, ["search", "wellboreDdms"]), kinds = strings(entry.kinds, ["well", "field", "wellbore", "trajectory", "markerSet"]);
        sources.push({ type: "osdu", url: entry.url, dataPartition: entry.dataPartition, ...(label ? { label } : {}), ...authed, ...(paths ? { paths } : {}), ...(kinds ? { kinds } : {}), ...(typeof entry.query === "string" ? { query: entry.query } : {}) });
        return;
      }
      default:
        problems.push(`${at}: the deck does not know a source of type "${entry.type}".`);
    }
  });

  const config: { -readonly [K in keyof DeckConfig]: DeckConfig[K] } = { version: 1, sources };
  if (Object.keys(auth).length) config.auth = auth;
  if (json.share !== undefined) {
    const mode = isObject(json.share) ? json.share.mode : undefined;
    if (mode === "reference" || mode === "carry" || mode === "off") config.share = { mode };
    else problems.push(`"share.mode" must be "reference", "carry" or "off" (got ${JSON.stringify(mode)}); sharing carries nothing until it is set.`);
  }
  if (json.csp !== undefined) {
    const list = isObject(json.csp) ? json.csp.connectSrc : undefined;
    if (list !== undefined && !Array.isArray(list)) problems.push('"csp.connectSrc" must be a list of https origins.');
    else if (list) {
      const origins: string[] = [];
      for (const entry of list) { const origin = typeof entry === "string" && !entry.includes("*") ? originOf(entry) : null; if (origin) origins.push(origin); else problems.push(`csp.connectSrc entry ${JSON.stringify(entry)} is not an https origin (no wildcards, no http); ignored.`); }
      config.csp = { connectSrc: origins };
    }
  }
  if (json.instance !== undefined) {
    if (!isObject(json.instance)) problems.push('"instance" must be an object (ignored).');
    else config.instance = { ...(typeof json.instance.id === "string" ? { id: json.instance.id } : {}), ...(typeof json.instance.name === "string" ? { name: json.instance.name } : {}) };
  }
  if (json.telemetry !== undefined) {
    const endpoint = isObject(json.telemetry) ? json.telemetry.endpoint : undefined;
    if (endpoint === undefined) config.telemetry = {};
    else if (isHttps(endpoint)) config.telemetry = { endpoint };
    else problems.push('"telemetry.endpoint" must be an https URL (ignored).');
  }
  if (json.crs !== undefined) {
    const defs = isObject(json.crs) ? json.crs.definitions : undefined;
    if (!isObject(defs)) problems.push('"crs.definitions" must map codes ("LOCAL:field-grid") to proj4 strings.');
    else {
      const definitions: Record<string, string> = {};
      for (const [code, value] of Object.entries(defs)) {
        if (!/^[A-Z][A-Z0-9_-]*:[A-Za-z0-9._-]+$/.test(code)) problems.push(`crs.definitions: "${code}" is not a CRS code like "LOCAL:field-grid" (ignored).`);
        else if (typeof value !== "string" || !/\+proj=[a-z]+/.test(value)) problems.push(`crs.definitions.${code} must be a proj4 string with +proj= (ignored).`);
        else definitions[code] = value;
      }
      config.crs = { definitions };
    }
  }
  return { config, problems };
}

/**
 * The https origins a browser running this config must be allowed to connect to: every source's
 * and provider's, the explicit `csp.connectSrc`, and the telemetry endpoint. A deployment's
 * Content-Security-Policy `connect-src` is `'self'` plus these, and nothing else.
 */
export function connectOrigins(config: DeckConfig): readonly string[] {
  const origins = new Set<string>();
  const add = (url: string | undefined) => { const origin = url ? originOf(url) : null; if (origin) origins.add(origin); };
  for (const source of config.sources) if ("url" in source) add(source.url);
  for (const profile of Object.values(config.auth ?? {})) { add(profile.issuer); for (const endpoint of Object.values(profile.metadata ?? {})) add(endpoint); }
  for (const origin of config.csp?.connectSrc ?? []) add(origin);
  add(config.telemetry?.endpoint);
  return [...origins].sort();
}
