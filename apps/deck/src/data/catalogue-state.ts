import { useSyncExternalStore } from "react";
import type { CanonicalWell, CataloguedWell, DataProblem } from "@ikhmalputra/subsurface-core/data-contract";
import { DEFAULT_CONFIG } from "./sources/config.ts";
import type { DeckConfig, SourceConfig } from "./sources/config.ts";

/**
 * The catalogue's state: what the deck's sources have served, held apart from the code that loads
 * it (catalogue.ts), so the registry and the places can read it anywhere, the tests included.
 *
 * It is built to hold a large tenant without holding all of it:
 * - **Headers** of every well listed, light (identity, field, location), grouped by field as they
 *   arrive.
 * - **Detail** (wellbores, simplified paths, tops) only for the fields opened. The least recently
 *   opened fields are dropped past a budget.
 * - **Full paths** for the few wells selected, for their own calculations.
 * Changes are announced at most every 120 ms (every second while reading), so a stream of pages cannot flood the page with renders.
 */

export interface SourceStatus {
  readonly id: string;
  readonly label: string;
  readonly standard: string;
  /** Wells listed so far, and how many the source says it holds. */
  readonly wells: number;
  readonly total?: number;
  readonly reading: boolean;
  readonly truncated: boolean;
  readonly error: string | null;
}
export interface FieldStatus { readonly reading: boolean; readonly read: number; readonly total: number; readonly error: string | null }
/** One field's wells as the deck holds them: headers, with detail where it has been read. */
export interface CatalogueField {
  readonly key: string;
  readonly sourceId: string;
  readonly fieldId: string;
  readonly name: string;
  readonly wells: readonly CataloguedWell[];
  /** Changes whenever the field's wells do: sites built from it are rebuilt only then. */
  readonly version: number;
}

export interface CatalogueState {
  readonly config: DeckConfig;
  readonly configNote: string;
  readonly configProblems: readonly string[];
  readonly sources: readonly SourceStatus[];
  readonly problems: readonly (DataProblem & { readonly sourceId: string })[];
  readonly fields: ReadonlyMap<string, FieldStatus>;
  readonly loading: boolean;
  readonly wellCount: number;
}

/** The key a field is known by, and the site it becomes: a sample's own id, or "<source>:<field>" for anyone else's. */
export const fieldKey = (sourceId: string, fieldId: string) => sourceId === "samples" || sourceId === "browser" ? fieldId : `${sourceId}:${fieldId}`;
const fieldIdOf = (well: CanonicalWell) => well.field?.id ?? well.id;

// ── The store ─────────────────────────────────────────────────────────────────────────────────
let state: CatalogueState = { config: DEFAULT_CONFIG, configNote: "Starting on the bundled samples.", configProblems: [], sources: [], problems: [], fields: new Map(), loading: true, wellCount: 0 };
interface FieldBucket { sourceId: string; fieldId: string; name: string; ids: string[]; version: number; snapshot: CatalogueField | null }
const buckets = new Map<string, FieldBucket>();
const headers = new Map<string, CataloguedWell>();
const detail = new Map<string, CataloguedWell>();
/** Fields with detail held, most recently opened last. */
const detailed: string[] = [];
const full = new Map<string, CataloguedWell>();
const MAX_DETAILED_FIELDS = 6, MAX_FULL_WELLS = 12;

let version = 0, scheduled: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const announce = () => { if (scheduled) clearTimeout(scheduled); scheduled = null; version++; for (const listener of [...listeners]) listener(); };
/**
 * Tells the readers something changed: at most every 120 ms, or every second while sources are
 * still being read. That way a backend paging in a large tenant redraws the globe a few times, not
 * on every page.
 */
const changed = () => { scheduled ??= setTimeout(announce, state.loading ? 1000 : 120); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => state;
const versionSnapshot = () => version;

export const catalogueState = () => state;
export const useCatalogue = () => useSyncExternalStore(subscribe, snapshot, snapshot);
/** Re-renders when the catalogue changes: for the modules that read sites. */
export const useCatalogueVersion = () => useSyncExternalStore(subscribe, versionSnapshot, versionSnapshot);
export const sourceEnabled = (type: SourceConfig["type"]) => state.config.sources.some((source) => source.type === type);

export function setCatalogueState(next: Partial<CatalogueState>, now = false) { state = { ...state, ...next }; if (now) announce(); else changed(); }

/** A source's wells listed: headers only, or whole for a source held whole. A well id another source already serves is left out. */
export function addWells(sourceId: string, wells: readonly CataloguedWell[]): readonly string[] {
  const clashes: string[] = [];
  for (const entry of wells) {
    const id = entry.well.id;
    const held = headers.get(id);
    if (held && held.sourceId !== sourceId) { clashes.push(id); continue; }
    headers.set(id, entry);
    if (entry.wellbores.length) detail.set(id, entry);
    const key = fieldKey(sourceId, fieldIdOf(entry.well));
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { sourceId, fieldId: fieldIdOf(entry.well), name: entry.well.field?.name ?? entry.well.name, ids: [], version: 0, snapshot: null }; buckets.set(key, bucket); }
    if (!held) bucket.ids.push(id);
    bucket.version++; bucket.snapshot = null;
  }
  state = { ...state, wellCount: headers.size };
  changed();
  return clashes;
}

/** Detail read for some of a field's wells: kept while the field is among the last few opened. */
export function addDetail(key: string, wells: readonly CataloguedWell[]) {
  for (const entry of wells) detail.set(entry.well.id, entry);
  const bucket = buckets.get(key);
  if (bucket) { bucket.version++; bucket.snapshot = null; }
  changed();
}
/** A field opened: it moves to the end of the held list; the field held longest is dropped past the budget. */
export function touchField(key: string) {
  const at = detailed.indexOf(key);
  if (at >= 0) detailed.splice(at, 1);
  detailed.push(key);
  while (detailed.length > MAX_DETAILED_FIELDS) {
    const dropped = detailed.shift()!, bucket = buckets.get(dropped);
    // The samples and this browser's wells are held whole; only a source's detail is let go.
    if (!bucket || bucket.sourceId === "samples" || bucket.sourceId === "browser") continue;
    for (const id of bucket.ids) detail.delete(id);
    bucket.version++; bucket.snapshot = null;
    const fields = new Map(state.fields); fields.delete(dropped); state = { ...state, fields };
  }
}
export const fieldHasDetail = (key: string) => state.fields.get(key)?.reading === false && !state.fields.get(key)?.error && detailed.includes(key);
export function setFieldStatus(key: string, status: FieldStatus) { const fields = new Map(state.fields); fields.set(key, status); state = { ...state, fields }; changed(); }

/** A selected well's full path, the last few kept. */
export function addFullWell(entry: CataloguedWell) {
  full.delete(entry.well.id); full.set(entry.well.id, entry);
  while (full.size > MAX_FULL_WELLS) full.delete(full.keys().next().value!);
  changed();
}
export const fullWell = (wellId: string) => full.get(wellId) ?? null;

/** Everything a source served is let go, before it is read again. */
export function dropSource(sourceId: string) {
  for (const [key, bucket] of buckets) if (bucket.sourceId === sourceId) {
    for (const id of bucket.ids) { headers.delete(id); detail.delete(id); full.delete(id); }
    buckets.delete(key);
    const at = detailed.indexOf(key); if (at >= 0) detailed.splice(at, 1);
  }
  state = { ...state, wellCount: headers.size, problems: state.problems.filter((problem) => problem.sourceId !== sourceId) };
  changed();
}

// ── Reading it ────────────────────────────────────────────────────────────────────────────────
/** Every field, as the deck holds it now. A field's snapshot is rebuilt only when its wells changed. */
export function catalogueFields(): readonly CatalogueField[] {
  return [...buckets.entries()].map(([key, bucket]) => bucket.snapshot ??= {
    key, sourceId: bucket.sourceId, fieldId: bucket.fieldId, name: bucket.name, version: bucket.version,
    wells: bucket.ids.map((id) => detail.get(id) ?? headers.get(id)!),
  });
}
export function catalogueField(key: string): CatalogueField | null {
  const bucket = buckets.get(key);
  if (!bucket) return null;
  return bucket.snapshot ??= { key, sourceId: bucket.sourceId, fieldId: bucket.fieldId, name: bucket.name, version: bucket.version, wells: bucket.ids.map((id) => detail.get(id) ?? headers.get(id)!) };
}

/** A site served by a configured source other than the samples and this browser: a tenant's field. */
export const isTenantSite = (siteId: string | null) => !!siteId && siteId.includes(":") && buckets.has(siteId);
/** The wells of a tenant's site, with detail where it has been read. */
export const tenantWells = (siteId: string): readonly CataloguedWell[] => catalogueField(siteId)?.wells ?? [];
