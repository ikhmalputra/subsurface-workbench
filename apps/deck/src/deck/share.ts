import { addDesign, designEntries, designForSite, designHistory, kestrel } from "../data/design.ts";
import type { DesignValue } from "../data/design.ts";
import { addRecordedWell, commitRecord, editOf, editedValue, recordedEntries, recordedForSite, same } from "../data/records.ts";
import type { WellRecordValue } from "../data/records.ts";
import { importedLogs } from "../data/logs.ts";
import { baseOf, basePlace, wellIdFor } from "../data/place.ts";
import { siteById } from "../data/sites.ts";
import { formatDate } from "../data/history.ts";
import { fmt } from "../format.ts";
import type { ModuleId, Tiles } from "../modules/registry.ts";
import { minSizes, moduleById, moduleIds } from "../modules/registry.ts";
import { isLayout } from "./layout.ts";
import { actions, deck, signals } from "./store.ts";
import { SHARE_KEY, decodeSharedDeck, encodeSharedDeck, sharedPayload } from "./share-codec.ts";
import type { CarriedWell, SharedDeck } from "./share-codec.ts";

/**
 * Send the deck: the deck as it is now, as a link, and a link opened as the deck it was made from.
 * The link carries the sender's own well when the place is one, so it opens in any browser; it
 * leaves out what is too large or too personal for a link (imported LAS files, the 3D camera).
 */

/** The deck as it is now. */
export function captureDeck(): SharedDeck {
  const now = deck.get(), bus = signals.getState();
  let carried: CarriedWell | null = null, whatIf: SharedDeck["whatIf"] = null;
  const design = designForSite(now.siteId);
  const recorded = recordedForSite(now.siteId);
  if (design) {
    const state = design.history.getState();
    carried = { kind: "design", builtIn: design.builtIn, value: state.committed };
    if (state.pending) whatIf = { label: state.pending.label, value: state.pending.value };
  } else if (recorded) {
    carried = { kind: "recorded", value: recorded.history.getState().committed };
  } else if (now.siteId) {
    // A well already in the deck, with the sender's edits over its records.
    const wellId = wellIdFor(now.siteId, now.wellId), base = basePlace(now.siteId, now.wellId);
    const edited = wellId ? editedValue(wellId) : null;
    if (wellId && base && edited && !same(edited, baseOf(base))) carried = { kind: "edit", siteId: now.siteId, wellId, value: edited };
  }
  const slices = bus.seismicSlices;
  return {
    v: 1,
    site: now.siteId ? { id: now.siteId, well: now.wellId } : null,
    tiles: now.tiles as SharedDeck["tiles"], stage: now.stage,
    component: bus.activeAsset.componentId, md: bus.depthLink.pinnedMdM, window: bus.depthLink.window,
    brush: bus.dataInteraction.depthRange, time: bus.time?.cursorMs ?? null,
    slices: slices.inline === null && slices.crossline === null && slices.time_depth === null ? null : { inline: slices.inline, crossline: slices.crossline, depth: slices.time_depth },
    sectionLine: now.sectionLine, fusions: now.fusions, whatIf, carried,
  };
}

/** The link to this page that opens the given deck. */
export async function shareLink(shared: SharedDeck, location: { readonly origin: string; readonly pathname: string; readonly search: string } = window.location) {
  return `${location.origin}${location.pathname}${location.search}#${SHARE_KEY}=${await encodeSharedDeck(shared)}`;
}

const wellName = (carried: CarriedWell) => (carried.kind === "design" ? carried.value.brief.identity.name : carried.value.identity.name) || "Unnamed well";

/** What a shared deck holds, in words, for the Share dialog and the note on arrival. */
export function describeDeck(shared: SharedDeck, componentName: (id: string) => string = (id) => id): { readonly rows: readonly { readonly label: string; readonly value: string }[]; readonly left: readonly string[] } {
  const site = siteById(shared.site?.id ?? null);
  const well = site?.wells.find((entry) => entry.id === shared.site?.well);
  const open = Object.keys(shared.tiles).filter((id): id is ModuleId => id in moduleById);
  const rows: { label: string; value: string }[] = [];
  rows.push({ label: "Place", value: site ? `${site.map.label}${well && site.wells.length > 1 ? ` · ${well.label}` : ""}` : "The world" });
  rows.push({ label: "Tiles", value: `${open.length}: ${[shared.stage, ...open.filter((id) => id !== shared.stage)].filter((id) => id in moduleById).map((id) => moduleById[id as ModuleId].title).join(", ")}` });
  if (shared.md !== null) rows.push({ label: "Depth", value: `${fmt(shared.md)} m MD, pinned` });
  if (shared.window) rows.push({ label: "Window", value: `${fmt(shared.window[0])}–${fmt(shared.window[1])} m MD` });
  if (shared.brush) rows.push({ label: "Brushed", value: `${fmt(shared.brush[0])}–${fmt(shared.brush[1])} m MD` });
  if (shared.time !== null) rows.push({ label: "Day", value: formatDate(new Date(shared.time).toISOString().slice(0, 10)) });
  if (shared.component) rows.push({ label: "Selected", value: componentName(shared.component) });
  if (shared.sectionLine) rows.push({ label: "Section line", value: "drawn on the globe" });
  if (shared.whatIf) rows.push({ label: "What-if", value: `${shared.whatIf.label}, not applied` });
  if (shared.carried) rows.push({ label: "Your well", value: shared.carried.kind === "design" ? `${wellName(shared.carried)}, the whole design` : shared.carried.kind === "recorded" ? `${wellName(shared.carried)}, its survey, tops and construction` : `your edits to ${wellName(shared.carried)}` });
  const left: string[] = ["The 3D camera angle: each view opens on its own default"];
  const wellId = shared.site ? wellIdFor(shared.site.id, shared.site.well) : null;
  if (wellId && importedLogs(wellId).length) left.unshift("Imported LAS logs: send the files with the link");
  return { rows, left };
}

// ── Opening a link ───────────────────────────────────────────────────────────────────────────

/** Puts the link's well into this deck (or finds it already here) and says where the place now is. */
function receiveWell(shared: SharedDeck, notes: string[]): { siteId: string | null; wellId: string | null } {
  const siteId = shared.site?.id ?? null, wellId = shared.site?.well ?? null;
  const carried = shared.carried;
  if (!carried) return { siteId, wellId };
  if (carried.kind === "design") {
    const shown = carried.builtIn ? { ...carried.value, brief: { ...carried.value.brief, identity: { ...carried.value.brief.identity, name: `${wellName(carried)} (shared)` } } } : carried.value;
    const match = designEntries().find((entry) => same(entry.record.history.getState().committed, carried.value) || same(entry.record.history.getState().committed, shown));
    if (match) return { siteId: match.record.siteId, wellId: null };
    // The example as it ships needs nothing carried; an edited example opens beside this deck's own.
    if (carried.builtIn && same(carried.value.brief, kestrel.brief)) return { siteId: "kestrel", wellId: null };
    const record = addDesign(shown as DesignValue);
    notes.push(`${wellName({ ...carried, value: shown as DesignValue })} was added to your planned wells.`);
    return { siteId: record.siteId, wellId: null };
  }
  if (carried.kind === "recorded") {
    const match = recordedEntries().find((entry) => same(entry.entry.history.getState().committed, carried.value));
    if (match) return { siteId: match.entry.siteId, wellId: null };
    const entry = addRecordedWell(carried.value);
    notes.push(`${wellName(carried)} was added to your wells.`);
    return { siteId: entry.siteId, wellId: null };
  }
  // Edits over a well already in the deck: they become this deck's edits, unless it has its own.
  const base = basePlace(carried.siteId, carried.wellId);
  if (!base) { notes.push("The edited well is not in this deck, so the edits were left out."); return { siteId, wellId }; }
  const mine = editedValue(carried.wellId);
  if (mine && same(mine, carried.value)) return { siteId, wellId };
  if (!mine || same(mine, baseOf(base))) {
    commitRecord(editOf(carried.wellId, carried.siteId, baseOf(base)), "Edits from a shared link", () => carried.value);
    notes.push(`The link's edits to ${base.label} are now this deck's; undo them in the Well editor.`);
    return { siteId, wellId };
  }
  // This deck has its own, different edits to that well: they stay, and the link's open as a well of their own.
  const head = siteById(carried.siteId)?.map.wells.find((entry) => entry.id === carried.wellId)?.head ?? siteById(carried.siteId)?.map.wells[0]?.head;
  const value: WellRecordValue = { ...carried.value, identity: { ...carried.value.identity, name: `${wellName(carried)} (shared edit)` }, location: { ...carried.value.location, longitude: carried.value.location.longitude ?? head?.[0] ?? null, latitude: carried.value.location.latitude ?? head?.[1] ?? null } };
  const match = recordedEntries().find((entry) => same(entry.entry.history.getState().committed, value));
  if (match) return { siteId: match.entry.siteId, wellId: null };
  try {
    const entry = addRecordedWell(value);
    notes.push(`You have your own edits to ${base.label}; they are kept, and the link's edits opened as ${value.identity.name}.`);
    return { siteId: entry.siteId, wellId: null };
  } catch {
    notes.push(`You have your own edits to ${base.label}; they are kept, and the link's edits were left out.`);
    return { siteId, wellId };
  }
}

/** Sets the deck to a shared one. Returns what the person who opened the link should be told. */
export function applySharedDeck(shared: SharedDeck): string {
  const notes: string[] = [];
  let { siteId, wellId } = receiveWell(shared, notes);
  if (siteId && !siteById(siteId)) { notes.push("Its place is not in this deck, so it opened on the world."); siteId = null; wellId = null; }
  actions.selectSite(siteId, wellId, "bar");
  // Tiles of modules this deck no longer has are dropped; a layout that then does not fit keeps this deck's own.
  const known = Object.fromEntries(Object.entries(shared.tiles).filter(([id]) => (moduleIds as readonly string[]).includes(id))) as Tiles;
  const dropped = Object.keys(shared.tiles).length - Object.keys(known).length;
  const stage = (known[shared.stage as ModuleId] ? shared.stage : Object.keys(known)[0]) as ModuleId | undefined;
  if (stage && isLayout(known, moduleIds, minSizes)) {
    actions.restore({ tiles: known, stage, sectionLine: shared.sectionLine, fusions: shared.fusions });
    if (dropped) notes.push(`${dropped} of its tiles ${dropped === 1 ? "is a module" : "are modules"} this deck does not have.`);
  } else notes.push("Its layout does not fit this deck, so your own was kept.");
  const well = wellIdFor(siteId, wellId), source = "deck:bar";
  if (shared.component) signals.selectComponent(shared.component, source);
  if (shared.md !== null) signals.pinDepth(well, shared.md, source);
  if (shared.window) signals.setDepthWindow(shared.window, source);
  if (shared.brush) signals.setDataInteraction({ depthRange: shared.brush }, source);
  if (shared.time !== null) signals.setTimeCursor(shared.time, source);
  if (shared.slices) signals.setSeismicSlices({ inline: shared.slices.inline, crossline: shared.slices.crossline, time_depth: shared.slices.depth }, source);
  if (shared.whatIf && designForSite(siteId)) designHistory.propose(shared.whatIf.label, shared.whatIf.value);
  const site = siteById(siteId);
  return [`Opened a shared deck${site ? ` on ${site.map.label}` : ""}.`, ...notes].join(" ");
}

let opened = "";
/** Opens the deck in the page's link, once per link; the link is then taken off the address bar. */
export async function openSharedLink(): Promise<void> {
  const payload = sharedPayload(window.location.hash);
  if (!payload || payload === opened) return;
  opened = payload;
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  try {
    const shared = await decodeSharedDeck(payload);
    const said = applySharedDeck(shared);
    actions.notify(said, said.length > 60 ? 9000 : 5000);
  } catch (error) {
    actions.notify(`This link could not be opened. ${error instanceof Error ? error.message : ""} The deck opened as usual.`, 9000);
  }
}
