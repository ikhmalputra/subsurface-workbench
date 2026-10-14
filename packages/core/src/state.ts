import { validateSlicePlane, validateWellLogStyle } from "./interpretation.ts";
import type { SlicePlane, WellLogStyle } from "./interpretation.ts";
export type { SlicePlane, WellLogStyle } from "./interpretation.ts";

export type SpatialXYZ = readonly [number, number, number];
export type MdWindow = readonly [number, number];
export type TimeWindow = readonly [number, number];

export interface DatasetBrush {
  readonly datasetId: string;
  readonly startId: string;
  readonly endId: string;
}

export interface DataInteractionState {
  readonly datasetId: string | null;
  readonly hoveredId: string | null;
  readonly selectedIds: readonly string[];
  readonly depthRange: MdWindow | null;
  /** UTC Unix epoch milliseconds. */
  readonly timeRange: TimeWindow | null;
  readonly brush: DatasetBrush | null;
}

export interface SubsurfaceState {
  readonly activeAsset: {
    readonly wellId: string | null;
    readonly componentId: string | null;
    readonly depth_md: number | null;
    readonly spatial_xyz: SpatialXYZ | null;
  };
  /** Positions are in the host's explicitly declared seismic coordinate frame, not grid indices. */
  readonly seismicSlices: { readonly inline: number | null; readonly crossline: number | null; readonly time_depth: number | null };
  readonly viewState: { readonly position: SpatialXYZ; readonly target: SpatialXYZ; readonly zoom: number };
  readonly depthLink: { readonly linked: boolean; readonly window: MdWindow | null; readonly hoverMdM: number | null; readonly pinnedMdM: number | null };
  readonly dataInteraction: DataInteractionState;
  readonly interpretation?: { readonly slicePlane: SlicePlane | null; readonly logStyle: WellLogStyle | null };
  /**
   * The moment in the asset's history every time-aware view shows, as UTC Unix epoch milliseconds;
   * null shows the asset as finally recorded. Optional so older snapshots still hydrate.
   */
  readonly time?: { readonly cursorMs: number | null };
}

export type StateEventType = "asset" | "depth-hover" | "depth-pick" | "spatial-pick" | "slices" | "camera" | "depth-window" | "depth-link" | "data-interaction" | "interpretation" | "time" | "hydrate";
export interface StateEvent {
  readonly type: StateEventType;
  /** Identifier of the publishing component; lets imperative subscribers suppress echoes. */
  readonly source: string | null;
  readonly state: SubsurfaceState;
  readonly previous: SubsurfaceState;
}
export type Unsubscribe = () => void;

export interface SubsurfaceStore {
  readonly getState: () => SubsurfaceState;
  readonly subscribe: (listener: (event: StateEvent) => void) => Unsubscribe;
  readonly subscribeSelector: <T>(selector: (state: SubsurfaceState) => T, listener: (value: T, previous: T, event: StateEvent) => void, options?: { equality?: (a: T, b: T) => boolean; ignoreSource?: string }) => Unsubscribe;
  readonly on: (type: StateEventType, listener: (event: StateEvent) => void) => Unsubscribe;
  readonly focusAsset: (wellId: string | null, componentId?: string | null, source?: string) => void;
  readonly selectComponent: (componentId: string | null, source?: string) => void;
  readonly updateDepthHover: (wellId: string | null, md: number | null, source?: string) => void;
  readonly pinDepth: (wellId: string | null, md: number | null, source?: string) => void;
  readonly triggerSpatialPick: (xyz: SpatialXYZ | null, source?: string) => void;
  readonly setSeismicSlices: (slices: Partial<SubsurfaceState["seismicSlices"]>, source?: string) => void;
  readonly setViewState: (view: Partial<SubsurfaceState["viewState"]>, source?: string) => void;
  readonly setDepthWindow: (window: MdWindow | null, source?: string) => void;
  readonly setDataInteraction: (interaction: Partial<DataInteractionState>, source?: string) => void;
  readonly clearDataInteraction: (source?: string) => void;
  readonly setDepthLinked: (linked: boolean, source?: string) => void;
  readonly hydrate: (state: SubsurfaceState, source?: string) => void;
  readonly setSlicePlane: (plane: SlicePlane | null, source?: string) => void;
  readonly setLogStyle: (style: WellLogStyle | null, source?: string) => void;
  /** Moves the time cursor (UTC Unix epoch milliseconds); null returns to the asset as finally recorded. */
  readonly setTimeCursor: (cursorMs: number | null, source?: string) => void;
}

function finite(value: number, field: string) {
  if (!Number.isFinite(value)) throw new TypeError(`${field} must be finite.`);
}
function depth(value: number | null) {
  if (value !== null) { finite(value, "Measured depth"); if (value < 0) throw new RangeError("Measured depth must be non-negative."); }
}
function id(value: string | null) {
  if (value !== null && (typeof value !== "string" || !value.trim())) throw new TypeError("Asset identifiers must be non-empty strings or null.");
}
function vector(value: SpatialXYZ): SpatialXYZ {
  if (!Array.isArray(value) || value.length !== 3) throw new TypeError("Spatial coordinates must contain exactly three numbers.");
  for (let i = 0; i < 3; i++) finite(value[i]!, "Coordinate");
  return Object.freeze([value[0], value[1], value[2]]);
}
function sameArray<T>(a: readonly T[] | null, b: readonly T[] | null) {
  return a === b || (a !== null && b !== null && a.length === b.length && a.every((value, index) => Object.is(value, b[index])));
}
function sameRecord(a: object, b: object): boolean {
  if (Object.keys(a).length !== Object.keys(b).length) return false;
  return Object.entries(a).every(([key, value]) => {
    const other = Reflect.get(b, key);
    if (Array.isArray(value) || Array.isArray(other)) return sameArray(value, other);
    return value !== null && other !== null && typeof value === "object" && typeof other === "object" ? sameRecord(value, other) : Object.is(value, other);
  });
}

export function createInitialSubsurfaceState(): SubsurfaceState {
  return {
    activeAsset: { wellId: null, componentId: null, depth_md: null, spatial_xyz: null },
    seismicSlices: { inline: null, crossline: null, time_depth: null },
    viewState: { position: [0, 0, 1000], target: [0, 0, 0], zoom: 1 },
    depthLink: { linked: true, window: null, hoverMdM: null, pinnedMdM: null },
    dataInteraction: { datasetId: null, hoveredId: null, selectedIds: [], depthRange: null, timeRange: null, brush: null },
    time: { cursorMs: null },
  };
}

function epochMs(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || Math.abs(value) > 8.64e15) throw new RangeError("Time cursor must be exact, valid UTC Unix epoch milliseconds.");
  return value;
}

/** Copies and freezes small state snapshots; no model/voxel buffers belong in reactive state. */
function snapshot(input: SubsurfaceState): SubsurfaceState {
  const a = input.activeAsset;
  id(a.wellId); id(a.componentId); depth(a.depth_md);
  if (a.wellId === null && (a.componentId !== null || a.depth_md !== null)) throw new TypeError("A selected component or measured depth requires a wellId.");
  for (const value of Object.values(input.seismicSlices)) if (value !== null) finite(value, "Slice position");
  const v = input.viewState;
  finite(v.zoom, "Zoom");
  if (v.zoom <= 0) throw new RangeError("Zoom must be positive.");
  if (sameArray(v.position, v.target)) throw new RangeError("Camera position and target must be distinct.");
  const d = input.depthLink;
  if (typeof d.linked !== "boolean") throw new TypeError("Depth linked must be boolean.");
  depth(d.hoverMdM); depth(d.pinnedMdM);
  if (d.window !== null) {
    if (d.window.length !== 2) throw new TypeError("Depth window must contain two numbers.");
    depth(d.window[0]); depth(d.window[1]);
    if (d.window[1] <= d.window[0]) throw new RangeError("Depth window base must exceed top.");
  }
  if (a.depth_md !== (d.hoverMdM ?? d.pinnedMdM)) throw new TypeError("Active measured depth must match the linked cursor.");
  const interaction = input.dataInteraction ?? createInitialSubsurfaceState().dataInteraction;
  if (typeof interaction !== "object" || interaction === null) throw new TypeError("Data interaction state must be an object.");
  id(interaction.datasetId); id(interaction.hoveredId);
  if (!Array.isArray(interaction.selectedIds)) throw new TypeError("Selected sample IDs must be an array.");
  if (interaction.selectedIds.length > 128) throw new RangeError("Selected sample IDs must contain at most 128 entries.");
  if (interaction.datasetId === null && (interaction.hoveredId !== null || interaction.selectedIds.length > 0 || interaction.brush !== null)) {
    throw new TypeError("A dataset interaction requires a datasetId.");
  }
  const selectedIds = interaction.selectedIds.map((sampleId) => {
    id(sampleId);
    if (sampleId === null) throw new TypeError("Selected sample IDs must be non-empty.");
    return sampleId;
  });
  if (new Set(selectedIds).size !== selectedIds.length) throw new TypeError("Selected sample IDs must be unique.");
  const checkedRange = (range: TimeWindow | null, field: string, nonNegative: boolean, epochMilliseconds = false): TimeWindow | null => {
    if (range === null) return null;
    if (!Array.isArray(range) || range.length !== 2) throw new TypeError(`${field} must contain two values.`);
    finite(range[0], `${field} start`); finite(range[1], `${field} end`);
    if (epochMilliseconds && range.some((value) => !Number.isSafeInteger(value) || Math.abs(value) > 8.64e15)) {
      throw new RangeError(`${field} must use exact, valid UTC Unix epoch milliseconds.`);
    }
    if ((nonNegative && range[0] < 0) || range[1] <= range[0]) throw new RangeError(`${field} must be an increasing${nonNegative ? " non-negative" : ""} range.`);
    return Object.freeze([range[0], range[1]] as const);
  };
  const depthRange = checkedRange(interaction.depthRange, "Depth range", true);
  const timeRange = checkedRange(interaction.timeRange, "Time range", false, true);
  let brush: DatasetBrush | null = null;
  if (interaction.brush !== null && (typeof interaction.brush !== "object" || interaction.brush === undefined)) {
    throw new TypeError("Dataset brush must be an object or null.");
  }
  if (interaction.brush !== null) {
    id(interaction.brush.datasetId); id(interaction.brush.startId); id(interaction.brush.endId);
    if (interaction.brush.datasetId !== interaction.datasetId || interaction.brush.startId === null || interaction.brush.endId === null) {
      throw new TypeError("Brush endpoints must belong to the active dataset.");
    }
    brush = Object.freeze({ ...interaction.brush });
  }
  return Object.freeze({
    activeAsset: Object.freeze({ ...a, spatial_xyz: a.spatial_xyz === null ? null : vector(a.spatial_xyz) }),
    seismicSlices: Object.freeze({ ...input.seismicSlices }),
    viewState: Object.freeze({ ...v, position: vector(v.position), target: vector(v.target) }),
    depthLink: Object.freeze({ ...d, window: d.window === null ? null : Object.freeze([d.window[0], d.window[1]] as const) }),
    dataInteraction: Object.freeze({
      datasetId: interaction.datasetId,
      hoveredId: interaction.hoveredId,
      selectedIds: Object.freeze(selectedIds),
      depthRange,
      timeRange,
      brush,
    }),
    ...(input.interpretation ? { interpretation: Object.freeze({
      slicePlane: input.interpretation.slicePlane === null ? null : validateSlicePlane(input.interpretation.slicePlane),
      logStyle: input.interpretation.logStyle === null ? null : validateWellLogStyle(input.interpretation.logStyle),
    }) } : {}),
    time: Object.freeze({ cursorMs: epochMs(input.time?.cursorMs ?? null) }),
  });
}

/** Instance-scoped, synchronous store and event bus for React, raw canvas and map consumers. */
export function createSubsurfaceStore(initial = createInitialSubsurfaceState()): SubsurfaceStore {
  let state = snapshot(initial);
  let notifying = false;
  const listeners = new Set<(event: StateEvent) => void>();
  function publish(next: SubsurfaceState, type: StateEventType, source?: string) {
    // Ignore identical values before the re-entry guard: controlled view echoes are harmless.
    if (sameRecord(state, next)) return;
    if (notifying) throw new Error("A state subscriber cannot synchronously publish a different state. Publish from user input, not from the render/update handler.");
    const checked = snapshot(next);
    const previous = state;
    state = Object.freeze({
      activeAsset: sameRecord(previous.activeAsset, checked.activeAsset) ? previous.activeAsset : checked.activeAsset,
      seismicSlices: sameRecord(previous.seismicSlices, checked.seismicSlices) ? previous.seismicSlices : checked.seismicSlices,
      viewState: sameRecord(previous.viewState, checked.viewState) ? previous.viewState : checked.viewState,
      depthLink: sameRecord(previous.depthLink, checked.depthLink) ? previous.depthLink : checked.depthLink,
      dataInteraction: sameRecord(previous.dataInteraction, checked.dataInteraction) ? previous.dataInteraction : checked.dataInteraction,
      ...(checked.interpretation ? { interpretation: previous.interpretation && sameRecord(previous.interpretation, checked.interpretation) ? previous.interpretation : checked.interpretation } : {}),
      time: previous.time && sameRecord(previous.time, checked.time!) ? previous.time : checked.time!,
    });
    const event = { type, source: source ?? null, state, previous };
    const errors: unknown[] = [];
    notifying = true;
    try {
      for (const listener of [...listeners]) {
        if (!listeners.has(listener)) continue;
        try { listener(event); } catch (error) { errors.push(error); }
      }
    } finally { notifying = false; }
    if (errors.length) throw new AggregateError(errors, "Subsurface state subscribers failed.");
  }
  const subscribe: SubsurfaceStore["subscribe"] = (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  const setDepth = (wellId: string | null, md: number | null, pinned: boolean, source?: string) => {
    id(wellId); depth(md);
    const changedWell = state.activeAsset.wellId !== wellId;
    const base = changedWell ? { ...state.depthLink, window: null, pinnedMdM: null, hoverMdM: null } : state.depthLink;
    const d = pinned ? { ...base, pinnedMdM: md, hoverMdM: null } : { ...base, hoverMdM: md };
    publish({ ...state, activeAsset: { ...state.activeAsset, wellId, componentId: changedWell ? null : state.activeAsset.componentId, spatial_xyz: changedWell ? null : state.activeAsset.spatial_xyz, depth_md: d.hoverMdM ?? d.pinnedMdM }, depthLink: d }, pinned ? "depth-pick" : "depth-hover", source);
  };
  return {
    getState: () => state, subscribe,
    subscribeSelector(selector, listener, options = {}) {
      let value = selector(state);
      return subscribe((event) => {
        const next = selector(event.state);
        if ((options.equality ?? Object.is)(value, next)) return;
        const previous = value;
        value = next;
        if (event.source !== options.ignoreSource) listener(next, previous, event);
      });
    },
    on: (type, listener) => subscribe((event) => { if (event.type === type) listener(event); }),
    focusAsset(wellId, componentId = null, source) {
      id(wellId); id(componentId);
      const changed = wellId !== state.activeAsset.wellId;
      publish({ ...state, activeAsset: { ...state.activeAsset, wellId, componentId, ...(changed ? { depth_md: null, spatial_xyz: null } : {}) }, depthLink: changed ? { ...state.depthLink, window: null, hoverMdM: null, pinnedMdM: null } : state.depthLink }, "asset", source);
    },
    selectComponent: (componentId, source) => { id(componentId); publish({ ...state, activeAsset: { ...state.activeAsset, componentId } }, "asset", source); },
    updateDepthHover: (wellId, md, source) => setDepth(wellId, md, false, source),
    pinDepth: (wellId, md, source) => setDepth(wellId, md, true, source),
    triggerSpatialPick: (xyz, source) => publish({ ...state, activeAsset: { ...state.activeAsset, spatial_xyz: xyz } }, "spatial-pick", source),
    setSeismicSlices: (slices, source) => publish({ ...state, seismicSlices: { ...state.seismicSlices, ...slices } }, "slices", source),
    setViewState: (view, source) => publish({ ...state, viewState: { ...state.viewState, ...view } }, "camera", source),
    setDepthWindow: (window, source) => publish({ ...state, depthLink: { ...state.depthLink, window } }, "depth-window", source),
    setDataInteraction(interaction, source) {
      const allowed = new Set(["datasetId", "hoveredId", "selectedIds", "depthRange", "timeRange", "brush"]);
      for (const key of Object.keys(interaction)) if (!allowed.has(key)) throw new TypeError(`Unknown data interaction field: ${key}`);
      const datasetChanged = interaction.datasetId !== undefined && interaction.datasetId !== state.dataInteraction.datasetId;
      const base = datasetChanged
        ? { datasetId: interaction.datasetId!, hoveredId: null, selectedIds: [], depthRange: null, timeRange: null, brush: null }
        : state.dataInteraction;
      publish({ ...state, dataInteraction: { ...base, ...interaction } }, "data-interaction", source);
    },
    clearDataInteraction(source) {
      publish({ ...state, dataInteraction: createInitialSubsurfaceState().dataInteraction }, "data-interaction", source);
    },
    setDepthLinked(linked, source) {
      const d = { ...state.depthLink, linked, hoverMdM: null };
      publish({ ...state, activeAsset: { ...state.activeAsset, depth_md: d.pinnedMdM }, depthLink: d }, "depth-link", source);
    },
    hydrate: (next, source) => { publish(snapshot(next), "hydrate", source); },
    setSlicePlane: (slicePlane, source) => publish({ ...state, interpretation: { slicePlane, logStyle: state.interpretation?.logStyle ?? null } }, "interpretation", source),
    setLogStyle: (logStyle, source) => publish({ ...state, interpretation: { logStyle, slicePlane: state.interpretation?.slicePlane ?? null } }, "interpretation", source),
    setTimeCursor: (cursorMs, source) => publish({ ...state, time: { cursorMs } }, "time", source),
  };
}
export * from "./edit-history.ts";
