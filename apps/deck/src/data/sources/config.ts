import { bundleSource } from "@ikhmalputra/subsurface-core/data-contract";
import type { CanonicalWell, WellBundle, WellDataSource } from "@ikhmalputra/subsurface-core/data-contract";
import { fetchJsonGuarded } from "./fetch-guard.ts";

/**
 * Where the deck's wells come from, set by whoever hosts it: a `config.json` beside the deck,
 * read when it starts. A tenant's deployment names its own sources; the default is the bundled
 * samples and the wells kept in this browser. Nothing here is a secret. Sign-in to a tenant's
 * backend goes through their identity provider, never a key in this file.
 *
 * {
 *   "sources": [
 *     { "type": "samples" },
 *     { "type": "browser" },
 *     { "type": "contract-json", "label": "Field A export", "url": "data/field-a.wells.json" },
 *     { "type": "osdu", "label": "Our OSDU", "url": "https://osdu.example.com", "dataPartition": "opendes" }
 *   ]
 * }
 */

export type SourceConfig =
  | { readonly type: "samples" }
  | { readonly type: "browser" }
  /** Wells already in the data contract's JSON (`subsurface-wells`), as a file the deployment serves. */
  | { readonly type: "contract-json"; readonly label?: string; readonly url: string }
  | { readonly type: "osdu"; readonly label?: string; readonly url: string; readonly dataPartition: string }
  | { readonly type: "witsml-etp"; readonly label?: string; readonly url: string }
  | { readonly type: "ppdm-api"; readonly label?: string; readonly url: string };

export interface DeckConfig { readonly sources: readonly SourceConfig[] }

export const DEFAULT_CONFIG: DeckConfig = Object.freeze({ sources: Object.freeze([{ type: "samples" }, { type: "browser" }] as const) });

/** The adapters a config may name, and whether this build has them yet. */
export const SOURCE_TYPES = Object.freeze({
  samples: { label: "Bundled samples", standard: "Utah FORGE, FORCE 2020, Equator and Kestrel A-7", available: true },
  browser: { label: "This browser", standard: "Wells entered, imported or designed on the deck", available: true },
  "contract-json": { label: "Wells file", standard: "Data contract JSON (subsurface-wells)", available: true },
  osdu: { label: "OSDU", standard: "OSDU Wellbore DDMS and Search", available: false },
  "witsml-etp": { label: "WITSML store", standard: "WITSML 2.1 over ETP 1.2", available: false },
  "ppdm-api": { label: "PPDM", standard: "An API over a PPDM 3.9 database", available: false },
} as const);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** A same-origin path, or https: a config must not send the deck to a plain-http or script URL. */
const safeUrl = (value: unknown): value is string => typeof value === "string" && value.length > 0 && (/^https:\/\//.test(value) || !/^[a-z][a-z0-9+.-]*:/i.test(value));

/**
 * A config read from JSON: every source it names that the deck understands, and a problem for
 * each one it does not. A config with no usable `sources` falls back to the default, and says so.
 */
export function parseDeckConfig(json: unknown): { readonly config: DeckConfig; readonly problems: readonly string[] } {
  const problems: string[] = [];
  if (!isObject(json) || !Array.isArray(json.sources)) return { config: DEFAULT_CONFIG, problems: ["config.json has no \"sources\" list: using the bundled samples and this browser's wells."] };
  const sources: SourceConfig[] = [];
  json.sources.forEach((entry, index) => {
    const at = `Source ${index + 1}`;
    if (!isObject(entry) || typeof entry.type !== "string") { problems.push(`${at} has no "type".`); return; }
    const label = typeof entry.label === "string" ? entry.label : undefined;
    switch (entry.type) {
      case "samples": case "browser":
        if (sources.some((source) => source.type === entry.type)) problems.push(`${at}: "${entry.type}" is listed twice.`);
        else sources.push({ type: entry.type });
        return;
      case "contract-json": case "witsml-etp": case "ppdm-api":
        if (!safeUrl(entry.url)) { problems.push(`${at} (${entry.type}): "url" must be a path beside the deck or an https address.`); return; }
        sources.push({ type: entry.type, url: entry.url, ...(label ? { label } : {}) });
        return;
      case "osdu":
        if (!safeUrl(entry.url)) { problems.push(`${at} (osdu): "url" must be an https address.`); return; }
        if (typeof entry.dataPartition !== "string" || !entry.dataPartition) { problems.push(`${at} (osdu): "dataPartition" is required.`); return; }
        sources.push({ type: "osdu", url: entry.url, dataPartition: entry.dataPartition, ...(label ? { label } : {}) });
        return;
      default:
        problems.push(`${at}: the deck does not know a source of type "${entry.type}".`);
    }
  });
  return { config: { sources }, problems };
}

/**
 * The file formats a `contract-json` source serves, both in the data contract:
 * - `subsurface-wells`: every well whole, in one file. For a few thousand wells at most; a file
 *   over 64 MB is refused, with the reason.
 * - `subsurface-wells-index`: the headers, a field at a time, each field naming a file of its
 *   wells whole. Only the index is read when the deck starts. A field's file is read when the field
 *   is opened, so a tenant of any size loads in the time its headers take.
 */
export interface WellsFile { readonly format: "subsurface-wells"; readonly version: 1; readonly wells: readonly WellBundle[] }
export interface WellsIndex {
  readonly format: "subsurface-wells-index";
  readonly version: 1;
  readonly fields: readonly { readonly id: string; readonly name: string; readonly wells: readonly CanonicalWell[]; readonly detail: string }[];
  /** The next page of the index, for a tenant too large for one: its URL, beside the deck or https. */
  readonly next?: string;
}

const resolveUrl = (url: string, base: string) => /^https:\/\//.test(url) ? url : `${base}${url.replace(/^\.?\//, "")}`;

/**
 * Wells from a file, or a paged index of files, in the data contract's JSON, read through the fetch
 * guard. An index is read a page at a time, following each page's `next` like a backend's cursor.
 */
export function contractJsonSource(id: string, config: Extract<SourceConfig, { type: "contract-json" }>, base: string, load: (url: string, signal?: AbortSignal) => Promise<unknown> = (url, signal) => fetchJsonGuarded(url, { signal })): WellDataSource {
  const first = resolveUrl(config.url, base);
  const label = config.label ?? config.url;
  const standard = SOURCE_TYPES["contract-json"].standard;
  /** A single file, held whole once read. */
  let whole: WellDataSource | null = null;
  /** Each field's detail file, by field id, from the index pages read so far; and each well's field. */
  const fieldsById = new Map<string, WellsIndex["fields"][number]>();
  const fieldOf = new Map<string, string>();
  const read = async (url: string, signal?: AbortSignal) => {
    const json = await load(url, signal);
    if (isObject(json) && json.format === "subsurface-wells" && Array.isArray(json.wells)) return { kind: "file" as const, wells: json.wells as readonly WellBundle[] };
    if (isObject(json) && json.format === "subsurface-wells-index" && Array.isArray(json.fields)) return { kind: "index" as const, index: json as unknown as WellsIndex };
    throw new Error(`${url} is not a subsurface-wells file or index (format "subsurface-wells" or "subsurface-wells-index", version 1).`);
  };
  // An index's field files, read once each, the last few kept: a field reopened is not read again.
  const fieldFiles = new Map<string, Promise<readonly WellBundle[]>>();
  const fieldFile = (field: WellsIndex["fields"][number], signal?: AbortSignal) => {
    let file = fieldFiles.get(field.id);
    if (!file) {
      file = load(resolveUrl(field.detail, base), signal).then((json) => {
        if (!isObject(json) || json.format !== "subsurface-wells" || !Array.isArray(json.wells)) throw new Error(`${field.detail} is not a subsurface-wells file.`);
        return json.wells as readonly WellBundle[];
      });
      file.catch(() => fieldFiles.delete(field.id));
      fieldFiles.set(field.id, file);
      while (fieldFiles.size > 8) fieldFiles.delete(fieldFiles.keys().next().value!);
    }
    return file;
  };
  return {
    id, label, standard,
    headers: async (cursor, signal) => {
      if (whole) return whole.headers(cursor, signal);
      // The cursor of an index is the URL of its next page; the first call reads the configured URL.
      const opened = await read(cursor ?? first, signal);
      if (opened.kind === "file") {
        if (cursor) throw new Error(`${cursor} is a file, not a page of the index.`);
        whole = bundleSource(id, label, standard, () => opened.wells);
        return whole.headers(null, signal);
      }
      const wells: CanonicalWell[] = [];
      for (const field of opened.index.fields) {
        fieldsById.set(field.id, field);
        for (const well of field.wells) { fieldOf.set(well.id, field.id); wells.push(well.field ? well : { ...well, field: { id: field.id, name: field.name } }); }
      }
      const next = typeof opened.index.next === "string" && opened.index.next ? resolveUrl(opened.index.next, base) : null;
      return { wells, next };
    },
    detail: async (wellIds, signal) => {
      if (whole) return whole.detail(wellIds, signal);
      const wanted = new Set(wellIds);
      const fields = [...new Set(wellIds.map((wellId) => fieldOf.get(wellId)).filter((field): field is string => !!field))].map((field) => fieldsById.get(field)!);
      const files = await Promise.all(fields.map((field) => fieldFile(field, signal)));
      return files.flat().filter((bundle) => wanted.has(bundle.well.id));
    },
  };
}
