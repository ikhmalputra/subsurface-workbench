import { computeMinimumCurvature, parseLas } from "@ikhmalputra/subsurface-core";
import type { ComputedStation, LasFile, SurveyPoint, WellDesign } from "@ikhmalputra/subsurface-core";

/**
 * Load each source once, then derive every shape from that one parse.
 *
 * Before this, three views each fetched and parsed the same LAS for the same well — the well file
 * for its feet-indexed tracks, the drilling study for its validated copy plus the raw text it
 * signs, and the report for its metre-indexed curves. Three fetches, three parses, three loading
 * states, and three chances to disagree about what the file says.
 *
 * The parse is the expensive, shareable part; the three shapes are cheap projections of it. So the
 * fetch is cached by URL, the parse happens once per fetch, and each projection is memoized against
 * the parsed file's identity. A pane that needs a projection asks for it and gets the same object
 * every time, which is also what lets panes sit side by side without racing each other.
 *
 * Nothing is persisted. These caches live for the page session only; the host still owns the data.
 */

export interface LoadedLas {
  readonly url: string;
  /** Kept because the drilling study signs the source text, not the parsed result. */
  readonly text: string;
  readonly las: LasFile;
}

const lasRequests = new Map<string, Promise<LoadedLas>>();
const lasReady = new Map<string, LoadedLas>();

/** One fetch and one parse per URL. A failed load is not cached, so a retry can succeed. */
export function loadLas(url: string): Promise<LoadedLas> {
  const cached = lasRequests.get(url);
  if (cached) return cached;
  // `fetch` is called inside the chain so that a synchronous throw — a blocked request, a stubbed
  // transport — becomes a rejected promise like every other failure, instead of escaping past the
  // cache cleanup below and leaving a pane holding a request that was never registered.
  const request = Promise.resolve()
    .then(() => fetch(url))
    .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.text(); })
    .then((text) => {
      const loaded: LoadedLas = { url, text, las: parseLas(text) };
      lasReady.set(url, loaded);
      return loaded;
    });
  request.catch(() => lasRequests.delete(url));
  lasRequests.set(url, request);
  return request;
}

/**
 * The already-parsed file, if this URL has been loaded.
 *
 * A pane that opens after the load can render its first frame with data instead of a spinner, which
 * is the difference between switching panes and reloading them. Awaiting a settled promise would
 * still cost a render, and that render is the flicker.
 */
export function loadedLas(url: string): LoadedLas | undefined {
  return lasReady.get(url);
}

const projections = new WeakMap<LasFile, Map<string, unknown>>();

/**
 * Memoize a projection of a parsed file against the file's identity.
 *
 * Keyed on the object rather than the URL so a projection cannot outlive the parse it describes,
 * and so a caller holding a `LasFile` from anywhere gets the same answer.
 */
export function lasProjection<T>(las: LasFile, key: string, build: (las: LasFile) => T): T {
  let byKey = projections.get(las);
  if (!byKey) { byKey = new Map(); projections.set(las, byKey); }
  if (byKey.has(key)) return byKey.get(key) as T;
  const value = build(las);
  byKey.set(key, value);
  return value;
}

/**
 * A projection that is allowed to fail, returned as a value instead of a throw.
 *
 * The validated drilling log and the report's metre-indexed curves both reject files they cannot
 * read safely — a non-increasing depth curve, a missing DEPTH curve. Those are legitimate answers
 * about the data, and a pane has to be able to show the reason rather than crash the workspace it
 * shares with other panes. The failure is memoized too: re-rendering does not re-validate.
 */
export type Attempt<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export function lasAttempt<T>(las: LasFile, key: string, build: (las: LasFile) => T): Attempt<T> {
  return lasProjection(las, `attempt:${key}`, (file) => {
    try { return { ok: true as const, value: build(file) }; }
    catch (caught: unknown) { return { ok: false as const, error: caught instanceof Error ? caught.message : String(caught) }; }
  });
}

/**
 * Minimum curvature once per station list.
 *
 * Four call sites computed this independently for the same well — the well file's survey tab, the
 * construction view, and the 3D scene inside the SDK. The calculation is pure, so the only thing
 * stopping it being shared was that nobody owned the result.
 *
 * Keyed on the station array, not the well id, because an authored revision supplies a different
 * array for the same well and must not read the source well's answer.
 */
const surveys = new WeakMap<object, readonly ComputedStation[]>();

export function computedSurvey(stations: readonly SurveyPoint[] | undefined): readonly ComputedStation[] {
  if (!stations || stations.length < 2) return [];
  const cached = surveys.get(stations);
  if (cached) return cached;
  const computed = computeMinimumCurvature(stations, { tieIn: stations[0] });
  surveys.set(stations, computed);
  return computed;
}

/** The surveyed path of a design, computed once however many panes draw it. */
export function designSurvey(design: WellDesign): readonly ComputedStation[] {
  return computedSurvey(design.survey);
}
