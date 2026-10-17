import { catalogueWell, readDetail, readHeaders } from "@ikhmalputra/subsurface-core/data-contract";
import type { CataloguedWell, DataProblem, WellBundle, WellDataSource } from "@ikhmalputra/subsurface-core/data-contract";
import { BASE } from "../base.ts";
import { SOURCE_TYPES, contractJsonSource, parseDeckConfig } from "./sources/config.ts";
import type { SourceConfig } from "./sources/config.ts";
import { addDetail, addFullWell, addWells, catalogueField, catalogueState, dropSource, fieldHasDetail, fullWell, setCatalogueState, setFieldStatus, sourceEnabled, touchField } from "./catalogue-state.ts";
import type { SourceStatus } from "./catalogue-state.ts";
import { designBundle, equatorBundles, forgeBundles, recordBundle } from "./sources/convert.ts";
import { forceBundles } from "./sources/samples.ts";
import { forceWells, onForceChange } from "./force.ts";
import { designEntries } from "./design.ts";
import { recordedEntries } from "./records.ts";

/**
 * Every well the deck can draw, from the sources its host configured: the data layer between the
 * tools and a tenant's backend.
 *
 * - The bundled samples are in from the first frame, checked synchronously.
 * - The deck then reads `config.json`, and each source's headers page by page. The globe and the
 *   lists fill in as they arrive. A source is cut off at 250,000 wells, and says so.
 * - A field's paths and tops are read only when the field is opened: in batches, simplified for
 *   drawing, cancelled if the deck moves on. The selected well's full path is read on its own.
 * - Designs and entered wells are drawn live from their own stores; the "browser" source lists them.
 */

const MAX_WELLS_PER_SOURCE = 250_000;
const MAX_PROBLEMS = 5_000;
/** Paths drawn for a field are kept to their shape within this many metres. */
const DRAW_TOLERANCE_M = 2;

const whole = (bundles: readonly WellBundle[], sourceId: string) => {
  const problems: DataProblem[] = [], wells: CataloguedWell[] = [];
  for (const bundle of bundles) { const { entry, problems: found } = catalogueWell(bundle, sourceId); problems.push(...found); if (entry) wells.push(entry); }
  return { wells, problems };
};
const sampleBundles = () => [...forgeBundles(), ...equatorBundles(), ...forceBundles(), ...designEntries().filter((item) => item.record.builtIn).map((item) => designBundle(item.record, item.value.brief))];
const browserBundles = () => [
  ...recordedEntries().map(({ entry, value }) => recordBundle(entry, value)),
  ...designEntries().filter((item) => !item.record.builtIn && item.value.brief.location.latitude !== null).map((item) => designBundle(item.record, item.value.brief)),
];

let problems: (DataProblem & { sourceId: string })[] = [];
let dropped = 0;
const report = (sourceId: string, found: readonly DataProblem[]) => {
  if (!found.length) return;
  const room = MAX_PROBLEMS - problems.length;
  problems = [...problems, ...found.slice(0, Math.max(0, room)).map((problem) => ({ ...problem, sourceId }))];
  dropped += Math.max(0, found.length - room);
  setCatalogueState({ problems: dropped ? [...problems, { object: "source", id: "more", severity: "warning", message: `${dropped.toLocaleString("en-US")} more problems not listed.`, sourceId }] : problems });
};
const setSource = (status: SourceStatus) => setCatalogueState({ sources: [...catalogueState().sources.filter((entry) => entry.id !== status.id), status] });

/** The samples, held whole: in from the moment this module loads. */
function loadSamples() {
  dropSource("samples");
  const { wells, problems: found } = whole(sampleBundles(), "samples");
  addWells("samples", wells);
  report("samples", found);
  setSource({ id: "samples", label: SOURCE_TYPES.samples.label, standard: SOURCE_TYPES.samples.standard, wells: wells.length, reading: false, truncated: false, error: null });
}
loadSamples();

const adapters = new Map<string, WellDataSource>();
const reads = new Map<string, AbortController>();

/** One configured source read: whole if it is ours, headers page by page if it is anyone else's. */
async function readSource(source: SourceConfig, index: number) {
  if (source.type === "samples") { loadSamples(); return; }
  if (source.type === "browser") {
    dropSource("browser");
    const { wells, problems: found } = whole(browserBundles(), "browser");
    addWells("browser", wells); report("browser", found);
    setSource({ id: "browser", label: SOURCE_TYPES.browser.label, standard: SOURCE_TYPES.browser.standard, wells: wells.length, reading: false, truncated: false, error: null });
    return;
  }
  const label = source.label ?? SOURCE_TYPES[source.type].label;
  if (source.type !== "contract-json") {
    report("config", [{ object: "source", id: `${source.type}-${index}`, severity: "error", message: `${label} (${SOURCE_TYPES[source.type].standard}): this build has no ${SOURCE_TYPES[source.type].label} adapter yet, so nothing is read from ${source.url}.` }]);
    return;
  }
  const adapter = contractJsonSource(`file-${index}`, source, BASE);
  adapters.set(adapter.id, adapter);
  reads.get(adapter.id)?.abort();
  const controller = new AbortController();
  reads.set(adapter.id, controller);
  dropSource(adapter.id);
  let listed = 0, total: number | undefined;
  const status = (reading: boolean, truncated = false, error: string | null = null) => setSource({ id: adapter.id, label, standard: adapter.standard, wells: listed, ...(total !== undefined ? { total } : {}), reading, truncated, error });
  status(true);
  try {
    const read = await readHeaders(adapter, {
      signal: controller.signal, maxWells: MAX_WELLS_PER_SOURCE,
      onPage: (wells, all) => {
        const clashes = addWells(adapter.id, wells.map((well) => ({ sourceId: adapter.id, well, wellbores: [] })));
        if (clashes.length) report(adapter.id, clashes.map((id) => ({ object: "well", id, severity: "error", message: `Another source already serves a well with id "${id}"; this one is left out.` })));
        listed += wells.length - clashes.length; total = all; status(true);
      },
    });
    report(adapter.id, read.problems);
    status(false, read.truncated);
  } catch (cause) {
    if (controller.signal.aborted) return;
    const message = cause instanceof Error ? cause.message : String(cause);
    report(adapter.id, [{ object: "source", id: adapter.id, severity: "error", message: `${label} could not be read: ${message}` }]);
    status(false, false, message);
  }
}

/** Reads every configured source again. */
export async function refreshCatalogue(): Promise<void> {
  for (const controller of [...reads.values(), ...fieldReads.values()]) controller.abort();
  reads.clear(); fieldReads.clear();
  problems = []; dropped = 0;
  // What every source served before is let go, then each is read afresh.
  for (const id of new Set(catalogueState().sources.map((source) => source.id))) dropSource(id);
  setCatalogueState({ loading: true, problems: [], sources: [], fields: new Map() }, true);
  const configured = catalogueState().config.sources;
  if (!configured.some((source) => source.type === "samples")) dropSource("samples");
  if (!configured.some((source) => source.type === "browser")) dropSource("browser");
  await Promise.all(configured.map(readSource));
  setCatalogueState({ loading: false });
}

const fieldReads = new Map<string, AbortController>();
/**
 * A field opened: its wells' paths and tops read, in batches, simplified for drawing. Only the field
 * on screen is read: opening another cancels the last. A field read before is kept, the last few.
 */
export async function openField(key: string) {
  const field = catalogueField(key);
  const adapter = field ? adapters.get(field.sourceId) : undefined;
  if (!field || !adapter) return;
  if (fieldHasDetail(key) || fieldReads.has(key)) { touchField(key); return; }
  for (const [other, controller] of fieldReads) if (other !== key) { controller.abort(); fieldReads.delete(other); setFieldStatus(other, { reading: false, read: 0, total: 0, error: "Left before it finished" }); }
  const controller = new AbortController();
  fieldReads.set(key, controller);
  const ids = field.wells.map((entry) => entry.well.id);
  let read = 0;
  setFieldStatus(key, { reading: true, read, total: ids.length, error: null });
  try {
    const result = await readDetail(adapter, ids, { signal: controller.signal, simplifyM: DRAW_TOLERANCE_M, batch: 100, concurrency: 4,
      onBatch: (wells) => { addDetail(key, wells); read += wells.length; setFieldStatus(key, { reading: true, read, total: ids.length, error: null }); } });
    report(field.sourceId, result.problems);
    touchField(key);
    // Nothing read and the source refused: the field says why, rather than looking empty.
    const refused = result.problems.find((problem) => problem.object === "source" && problem.severity === "error");
    const reason = refused ? /\(([^)]*)\)\.?$/.exec(refused.message)?.[1] ?? refused.message.replace(/\.$/, "") : "";
    setFieldStatus(key, { reading: false, read, total: ids.length, error: !refused ? null : read === 0 ? `None of its ${ids.length.toLocaleString("en-US")} wells could be read (${reason})` : `${(ids.length - read).toLocaleString("en-US")} of its ${ids.length.toLocaleString("en-US")} wells could not be read (${reason})` });
  } catch (cause) {
    if (!controller.signal.aborted) setFieldStatus(key, { reading: false, read, total: ids.length, error: cause instanceof Error ? cause.message : String(cause) });
  } finally {
    if (fieldReads.get(key) === controller) fieldReads.delete(key);
  }
}

/** The selected well's full path, for its own calculations: read once, the last few kept. */
export async function openWell(key: string, wellId: string) {
  const field = catalogueField(key);
  const adapter = field ? adapters.get(field.sourceId) : undefined;
  if (!adapter || fullWell(wellId)) return;
  try {
    const { wells } = await readDetail(adapter, [wellId], { batch: 1, concurrency: 1 });
    if (wells[0]) addFullWell(wells[0]);
  } catch { /* the simplified path stays in use */ }
}

let started = false;
/** Reads the host's config.json (or keeps the default without one), then every source it names. */
export async function startCatalogue(): Promise<void> {
  if (started) return;
  started = true;
  // The FORCE index arrives on its own: the samples are read again when it does (not as each well's logs come in).
  let forceCount = forceWells().length;
  onForceChange(() => { const count = forceWells().length; if (count !== forceCount) { forceCount = count; if (sourceEnabled("samples")) loadSamples(); } });
  try {
    const response = await fetch(`${BASE}config.json`, { cache: "no-cache" });
    if (response.status === 404) setCatalogueState({ configNote: "No config.json beside the deck: the bundled samples and this browser's wells." });
    else if (!response.ok) setCatalogueState({ configNote: `config.json could not be read (HTTP ${response.status}): the bundled samples and this browser's wells.` });
    else {
      const { config, problems: found } = parseDeckConfig(await response.json());
      setCatalogueState({ config, configProblems: found, configNote: `${config.sources.length} source${config.sources.length === 1 ? "" : "s"} from config.json.` });
    }
  } catch (cause) {
    setCatalogueState({ configNote: `config.json is not valid JSON (${cause instanceof Error ? cause.message : String(cause)}): the bundled samples and this browser's wells.` });
  }
  await refreshCatalogue();
}

export { catalogueState, sourceEnabled, useCatalogue, useCatalogueVersion } from "./catalogue-state.ts";
