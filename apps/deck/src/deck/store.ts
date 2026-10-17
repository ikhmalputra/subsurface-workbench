import { useSyncExternalStore } from "react";
import { createSubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import type { StateEvent } from "@ikhmalputra/subsurface-core/state";
import type { ModuleId, Signal, Tiles } from "../modules/registry.ts";
import { initialLayout, initialStage, minSizes, moduleById, moduleIds } from "../modules/registry.ts";
import type { Drop, Layout, Opening, Rect } from "./layout.ts";
import { isLayout, planDropIn, planMove, planOpen, planResize, without } from "./layout.ts";
import { wellIdFor } from "../data/place.ts";
import { setActiveSite } from "../data/design.ts";
import { setActiveEditWell } from "../data/records.ts";

/**
 * Two stores. The core store is the signal bus every SDK view understands (selection, depth, the
 * camera). This one holds what is the deck's own: the place, the layout, the theme, and the pulses
 * that show a signal leaving one module and landing in the others.
 */
export const signals = createSubsurfaceStore();

/** Where a signal came from: a module, or the deck's own chrome. */
export type Origin = ModuleId | "rail" | "clock" | "bar";

export interface Pulse {
  readonly id: number;
  readonly signal: Signal;
  readonly from: Origin;
  readonly to: readonly ModuleId[];
  readonly at: number;
}

export interface DeckState {
  readonly siteId: string | null;
  readonly wellId: string | null;
  readonly tiles: Tiles;
  readonly stage: ModuleId;
  readonly theme: "night" | "day";
  /** When each open module was last used, to choose which one gives way when the grid is full. */
  readonly lastUsed: Readonly<Partial<Record<ModuleId, number>>>;
  /** Signals in flight, drawn as pulses between tiles and as an edge flash where they land. */
  readonly pulses: readonly Pulse[];
  /** The patch bay: every live connection drawn at once, while ⌥ is held. */
  readonly patch: boolean;
  /** One line on what the deck just did (made room, opened a link), shown in the lens; `ms` for longer reads. */
  readonly note: { readonly text: string; readonly at: number; readonly ms?: number } | null;
  readonly commandOpen: boolean;
  /** The Share dialog: a link to the deck as it is now. */
  readonly shareOpen: boolean;
  /** A tile spread over the whole grid for a while; the layout under it is kept. */
  readonly focus: ModuleId | null;
  /** The New well dialog. */
  readonly newWellOpen: boolean;
  /** A section line drawn on the map, longitude/latitude ends: the curtain tile cuts along it. */
  readonly sectionLine: readonly [readonly [number, number], readonly [number, number]] | null;
  /** Fused tiles, by "from>to": what the target draws of the source (e.g. the log curve's mnemonic). */
  readonly fusions: Readonly<Record<string, string>>;
  /** While a tile is dragged over a fusable target: the pair, for the target to say what a drop does. */
  readonly fuseAim: { readonly from: ModuleId; readonly to: ModuleId } | null;
}

/** Theme and layout are this browser's preference; storage that fails only means they are not kept. */
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string | null) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* not kept */ } };
const LAYOUT_KEY = "deck-layout-v3";
const storedTheme = read("deck-theme") === "day" ? "day" : "night";
const storedLayout = (() => {
  try {
    const value = JSON.parse(read(LAYOUT_KEY) ?? "null") as { tiles?: unknown; stage?: unknown } | null;
    if (!value || !isLayout(value.tiles, moduleIds, minSizes)) return null;
    const tiles = value.tiles as Tiles;
    return tiles[value.stage as ModuleId] ? { tiles, stage: value.stage as ModuleId } : null;
  } catch { return null; }
})();

const swap = (tiles: Tiles, a: ModuleId, b: ModuleId): Tiles => {
  const rectA = tiles[a], rectB = tiles[b];
  return rectA && rectB ? { ...tiles, [a]: rectB, [b]: rectA } : tiles;
};
/** The deck always opens on the world: a kept layout opens with the globe on the stage, if it is open. */
const opening = (() => {
  if (!storedLayout) return { tiles: initialLayout, stage: initialStage };
  const { tiles, stage } = storedLayout;
  return tiles.globe ? { tiles: swap(tiles, stage, "globe"), stage: "globe" as const } : storedLayout;
})();

let state: DeckState = { siteId: null, wellId: null, tiles: opening.tiles, stage: opening.stage, theme: storedTheme, lastUsed: {}, pulses: [], patch: false, note: null, commandOpen: false, shareOpen: false, focus: null, newWellOpen: false, sectionLine: null, fusions: {}, fuseAim: null };
const listeners = new Set<() => void>();
const set = (next: Partial<DeckState>) => {
  state = { ...state, ...next };
  if (next.tiles || next.stage) write(LAYOUT_KEY, JSON.stringify({ tiles: state.tiles, stage: state.stage }));
  listeners.forEach((listener) => listener());
};
export const deck = { get: () => state, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); } };
export function useDeck<T>(select: (value: DeckState) => T): T {
  return useSyncExternalStore(deck.subscribe, () => select(state), () => select(state));
}

export const openIds = (tiles: Tiles = state.tiles) => moduleIds.filter((id) => tiles[id]);

// ── Pulses ───────────────────────────────────────────────────────────────────────────────────
let pulseId = 0;
const PULSE_MS = 900;
/** A signal leaves `from` and lands in every open tile that listens to it. */
export function pulse(signal: Signal, from: Origin) {
  const to = openIds().filter((id) => id !== from && moduleById[id].listens.includes(signal));
  const at = performance.now();
  const used = typeof from === "string" && from in moduleById ? { ...state.lastUsed, [from]: Date.now() } : state.lastUsed;
  set({ pulses: [...state.pulses.filter((entry) => at - entry.at < PULSE_MS), { id: ++pulseId, signal, from, to, at }], lastUsed: used });
  window.setTimeout(() => { const now = performance.now(); if (state.pulses.some((entry) => now - entry.at >= PULSE_MS)) set({ pulses: state.pulses.filter((entry) => now - entry.at < PULSE_MS) }); }, PULSE_MS + 20);
}

/** Who sent a store event: modules publish as `deck:<id>`; the rail and the bar as themselves. */
function originOf(source: string | null): Origin {
  const name = source?.startsWith("deck:") ? source.slice(5) : null;
  if (name && name in moduleById) return name as ModuleId;
  return name === "rail" ? "rail" : name === "clock" ? "clock" : "bar";
}

/**
 * Every discrete signal on the bus becomes a pulse: a pick or a selection at once, a zoom or a
 * camera move at most a few times a second. Hovering is continuous and shows as the cursor itself
 * in every tile, not as a stream of pulses.
 */
const lastOf = new Map<string, number>();
function throttled(key: string, ms: number) {
  const now = performance.now();
  if (now - (lastOf.get(key) ?? -Infinity) < ms) return true;
  lastOf.set(key, now);
  return false;
}
signals.subscribe((event: StateEvent) => {
  const from = originOf(event.source);
  if (event.type === "asset" && event.state.activeAsset.componentId !== event.previous.activeAsset.componentId) pulse("object", from);
  else if (event.type === "depth-pick") pulse("depth", from);
  else if (event.type === "depth-window" && !throttled(`window:${from}`, 450)) pulse("depth", from);
  else if ((event.type === "camera" || event.type === "slices") && !throttled(`view:${from}`, 600)) pulse("view", from);
  else if (event.type === "time" && !throttled(`time:${from}`, 380)) pulse("time", from);
  else if (event.type === "data-interaction" && event.state.dataInteraction.depthRange !== event.previous.dataInteraction.depthRange && !throttled(`brush:${from}`, 300)) pulse("object", from);
});

// ── Actions ──────────────────────────────────────────────────────────────────────────────────
const largest = (tiles: Tiles) => openIds(tiles).sort((a, b) => tiles[b]!.w * tiles[b]!.h - tiles[a]!.w * tiles[a]!.h)[0] ?? initialStage;

function commit(drop: Drop | null, id: ModuleId) {
  if (!drop) return;
  const other = drop.swappedWith as ModuleId | null;
  const stage = other === null ? state.stage : state.stage === id ? other : state.stage === other ? id : state.stage;
  set({ tiles: drop.tiles as Tiles, stage, lastUsed: { ...state.lastUsed, [id]: Date.now() } });
}

function settle(opening: Opening | null, id: ModuleId, from: Origin) {
  if (!opening) { set({ note: { text: `There is no room for ${moduleById[id].title} that keeps every tile readable. Close a tile or make one smaller.`, at: Date.now() } }); return; }
  const replaced = opening.replaced as ModuleId | null, split = opening.split as ModuleId | null;
  const stage = replaced && replaced === state.stage ? id : state.stage;
  const note = replaced ? `${moduleById[id].title} took the place of ${moduleById[replaced].title}.` : split ? `${moduleById[id].title} shares ${moduleById[split].title}'s room.` : null;
  // A focused tile whose place another module took is gone: focus with it, or the deck would hide every tile for one that is not there.
  const focus = state.focus && !(opening.tiles as Tiles)[state.focus] ? null : state.focus;
  set({ tiles: opening.tiles as Tiles, stage, focus, lastUsed: { ...state.lastUsed, [id]: Date.now() }, note: note ? { text: note, at: Date.now() } : state.note });
  // A module arriving is told everything at once: the place and whatever else it listens to.
  for (const signal of moduleById[id].listens) if (signal !== "whatif") set({ pulses: [...state.pulses, { id: ++pulseId, signal, from, to: [id], at: performance.now() }] });
}

/**
 * A module that needs the stage, on a full deck: it takes the stage's tile, which closes; when the
 * stage is too small for it, the largest tile that is big enough.
 */
function takeStage(id: ModuleId): Opening | null {
  const min = minSizes[id];
  const fits = (key: string) => { const room = state.tiles[key as ModuleId]; return !!room && room.w >= min.w && room.h >= min.h; };
  const area = (key: string) => { const room = state.tiles[key as ModuleId]!; return room.w * room.h; };
  const taken = fits(state.stage) ? state.stage : Object.keys(state.tiles).filter(fits).sort((a, b) => area(b) - area(a))[0] as ModuleId | undefined;
  if (!taken) return null;
  const room = state.tiles[taken]!;
  return { tiles: { ...without(state.tiles, taken), [id]: room } as Layout, landed: room, split: null, replaced: taken };
}

export const actions = {
  /** Fuse one tile into another (or change what it fuses); the source tile stays where it was. */
  fuse(from: ModuleId, to: ModuleId, value: string) {
    set({ fusions: { ...state.fusions, [`${from}>${to}`]: value }, fuseAim: null });
    pulse("view", from);
  },
  /** Pull a fusion back off. */
  unfuse(key: string) {
    set({ fusions: Object.fromEntries(Object.entries(state.fusions).filter(([entry]) => entry !== key)) });
  },
  aimFuse(aim: DeckState["fuseAim"]) {
    if (aim?.from !== state.fuseAim?.from || aim?.to !== state.fuseAim?.to) set({ fuseAim: aim });
  },
  /** A section line drawn on the map: kept, and the curtain tile opens to show it. */
  setSectionLine(line: DeckState["sectionLine"], from: Origin = "globe") {
    set({ sectionLine: line });
    if (line) actions.open("curtain", from);
    pulse("view", from);
  },
  /** Place: a site (and a well in it) everywhere at once. Choosing a site stages it in 3D. */
  selectSite(siteId: string | null, wellId: string | null = null, from: Origin = "bar") {
    const changed = siteId !== state.siteId || wellId !== state.wellId;
    const siteChanged = siteId !== state.siteId;
    // On a planned well, its design becomes the one every module reads and edits.
    setActiveSite(siteId);
    setActiveEditWell(wellIdFor(siteId, wellId));
    set({ siteId, wellId });
    // A new place clears what belonged to the old one: the store drops its selection, cursor and window.
    if (changed) {
      signals.focusAsset(wellIdFor(siteId, wellId), null, `deck:${from}`);
      signals.setDataInteraction({ depthRange: null }, `deck:${from}`);
    }
    // A moment belongs to one well's history; a new place starts from the finished record.
    if (siteChanged) signals.setTimeCursor(null, `deck:${from}`);
    // A new site is staged in 3D; another well on the same site leaves the stage where it is.
    if (siteId && siteChanged && state.stage !== "site3d") actions.promote("site3d");
    if (!siteId && state.stage !== "globe" && state.tiles.globe) actions.promote("globe");
    if (changed) pulse("place", from);
  },
  /** Swap a tile with the stage: the stage is wherever the focus is. Opens the module if it is closed. */
  promote(id: ModuleId) {
    if (moduleById[id].opensFocused && state.tiles[id]) { actions.setFocus(id); return; }
    const opened = !state.tiles[id];
    if (opened) actions.open(id);
    const tile = state.tiles[id], stage = state.tiles[state.stage];
    if (id === state.stage || !tile) return;
    // Opened at least as large as the stage: it is the stage where it landed, and nothing moves.
    if (opened && (!stage || tile.w * tile.h >= stage.w * stage.h)) { set({ stage: id }); return; }
    set({ tiles: swap(state.tiles, state.stage, id), stage: id, lastUsed: { ...state.lastUsed, [id]: Date.now() } });
  },
  open(id: ModuleId, from: Origin = "bar") {
    if (state.tiles[id]) { pulse("place", from); if (moduleById[id].opensFocused) actions.setFocus(id); return; }
    const opening = planOpen(state.tiles as Layout, id, minSizes, moduleById[id].size, state.stage, state.lastUsed as Record<string, number>);
    settle(opening ?? (moduleById[id].opensOnStage || moduleById[id].opensFocused ? takeStage(id) : null), id, from);
    if (moduleById[id].opensOnStage && state.tiles[id]) actions.promote(id);
    if (moduleById[id].opensFocused && state.tiles[id]) actions.setFocus(id);
  },
  /** A module dragged in from the dock and dropped on a cell. */
  dropIn(id: ModuleId, at: { col: number; row: number }) {
    settle(planDropIn(state.tiles as Layout, id, at, minSizes, moduleById[id].size), id, "bar");
  },
  previewDropIn(id: ModuleId, at: { col: number; row: number }): Rect | null {
    return planDropIn(state.tiles as Layout, id, at, minSizes, moduleById[id].size)?.landed ?? null;
  },
  close(id: ModuleId) {
    if (state.focus === id) set({ focus: null });
    if (!state.tiles[id] || openIds().length === 1) return;
    const rest = without(state.tiles, id);
    set({ tiles: rest, stage: state.stage === id ? largest(rest) : state.stage });
  },
  /** A drop on the grid; see `planMove` and `planResize` for what is accepted. */
  place(id: ModuleId, target: Rect) { commit(planMove(state.tiles as Layout, id, target, minSizes), id); },
  resize(id: ModuleId, target: Rect) { commit(planResize(state.tiles as Layout, id, target, minSizes), id); },
  /** What a drop would do, for the snap guide while dragging. */
  preview(kind: "move" | "resize", id: ModuleId, target: Rect) { return (kind === "move" ? planMove : planResize)(state.tiles as Layout, id, target, minSizes); },
  resetLayout() { set({ tiles: initialLayout, stage: initialStage }); if (state.siteId) actions.promote("site3d"); },
  setTheme(theme: "night" | "day") { write("deck-theme", theme); set({ theme }); },
  openCommand(open: boolean) { set({ commandOpen: open }); },
  openNewWell(open: boolean) { set({ newWellOpen: open, commandOpen: false }); },
  /** Spread a tile over the whole grid, or put it back. */
  setFocus(id: ModuleId | null) { if (id !== state.focus) set({ focus: id && state.tiles[id] ? id : null }); },
  openShare(open: boolean) { set({ shareOpen: open, commandOpen: false }); },
  /** A line in the lens; long ones stay up longer. */
  notify(text: string, ms?: number) { set({ note: { text, at: Date.now(), ...(ms ? { ms } : {}) } }); },
  /** A shared deck's own tiles and drawings, set at once (the place is chosen first, by `selectSite`). */
  restore(next: { readonly tiles: Tiles; readonly stage: ModuleId; readonly sectionLine: DeckState["sectionLine"]; readonly fusions: DeckState["fusions"] }) {
    set({ tiles: next.tiles, stage: next.stage, sectionLine: next.sectionLine, fusions: next.fusions, lastUsed: {} });
  },
  /** Go to a well with its editor on the stage. */
  editWell(siteId: string, wellId: string | null = null, from: Origin = "bar") {
    actions.selectSite(siteId, wellId, from);
    actions.promote("editor");
  },
  /** Go to a planned well with its designer on the stage. */
  designWell(siteId: string, from: Origin = "bar") {
    actions.selectSite(siteId, null, from);
    actions.promote("designer");
  },
  setPatch(patch: boolean) { if (patch !== state.patch) set({ patch }); },
};
