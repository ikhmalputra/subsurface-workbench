/**
 * The deck's runtime config is parsed in core (`@ikhmalputra/subsurface-core/deck-config`), so the
 * deployment's renderer and the deck judge a config.json the same way. This module re-exports it
 * and holds the one source the deck builds itself: wells from a file in the data contract.
 */
export { CONFIG_SCHEMA_VERSION, DEFAULT_CONFIG, SOURCE_TYPES, connectOrigins, parseDeckConfig } from "@ikhmalputra/subsurface-core/deck-config";
export type { AuthProfile, DeckConfig, OsduKinds, OsduPaths, ShareMode, SourceConfig } from "@ikhmalputra/subsurface-core/deck-config";
import { bundleSource } from "@ikhmalputra/subsurface-core/data-contract";
import type { CanonicalWell, WellBundle, WellDataSource } from "@ikhmalputra/subsurface-core/data-contract";
import { SOURCE_TYPES } from "@ikhmalputra/subsurface-core/deck-config";
import type { SourceConfig } from "@ikhmalputra/subsurface-core/deck-config";
import { fetchJsonGuarded } from "@ikhmalputra/subsurface-core/fetch-guard";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

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

/** A URL a file names: https, or http on this machine (a mock), as given; a path, beside the deck; any other scheme is refused in words. */
const resolveUrl = (url: string, base: string) => {
  if (/^https:\/\//i.test(url) || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(?=[/?#]|$)/i.test(url)) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) throw new Error(`${url.slice(0, 80)} is not an https URL or a path beside the deck: not read.`);
  return `${base}${url.replace(/^\.?\//, "")}`;
};

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
