"use client";

import { useCallback, useState } from "react";
import { createInitialSubsurfaceState, createSubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import type { SubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import { useSubsurfaceSelector } from "./state-hooks.js";

/** Measured-depth window `[top, base]` in metres. */
export type DepthWindow = readonly [number, number];

/** Shared depth state for linking views (schematic, seismic section, logs) by measured depth. */
export interface DepthLink {
  /** When false, views should be passed `undefined` windows and no cursor callbacks so each navigates on its own. */
  readonly linked: boolean;
  readonly setLinked: (linked: boolean) => void;
  /** Visible MD window, `null` for the whole well. */
  readonly window: DepthWindow | null;
  readonly setWindow: (window: DepthWindow | null) => void;
  /** MD to mark in every view: the hover position when there is one, otherwise the pinned depth. */
  readonly cursorMdM: number | null;
  /** Transient hover cursor; `null` (pointer left) falls back to the pinned depth. */
  readonly setCursorMdM: (mdM: number | null) => void;
  /** Depth the user explicitly picked (a click, a report, a log sample); survives hover. */
  readonly pinnedMdM: number | null;
  readonly pinCursor: (mdM: number | null) => void;
}

/**
 * Holds one MD window and cursor for any number of depth views. Wire each view's controlled window and cursor props
 * to it while `linked` is true; unlinking clears the hover cursor and leaves each view where it is.
 */
export function useDepthLink(initialLinked = true, sharedStore?: SubsurfaceStore): DepthLink {
  const [localStore] = useState(() => {
    const initial = createInitialSubsurfaceState();
    // Standalone legacy depth links still have an owning asset, without requiring a host wellId.
    return createSubsurfaceStore({ ...initial, activeAsset: { ...initial.activeAsset, wellId: "depth-link" }, depthLink: { ...initial.depthLink, linked: initialLinked } });
  });
  const store = sharedStore ?? localStore;
  const depth = useSubsurfaceSelector(store, (state) => state.depthLink);
  const setWindow = useCallback((next: DepthWindow | null) => store.setDepthWindow(next, "depth-link"), [store]);
  const setCursorMdM = useCallback((next: number | null) => store.updateDepthHover(store.getState().activeAsset.wellId, next, "depth-link"), [store]);
  const pinCursor = useCallback((next: number | null) => store.pinDepth(store.getState().activeAsset.wellId, next, "depth-link"), [store]);
  const setLinked = useCallback((next: boolean) => store.setDepthLinked(next, "depth-link"), [store]);
  return { linked: depth.linked, setLinked, window: depth.window, setWindow, cursorMdM: depth.hoverMdM ?? depth.pinnedMdM, setCursorMdM, pinnedMdM: depth.pinnedMdM, pinCursor };
}
