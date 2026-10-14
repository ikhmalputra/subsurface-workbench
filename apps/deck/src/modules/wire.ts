import { useMemo } from "react";
import type { DepthLink } from "@ikhmalputra/subsurface-react";
import { useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";
import { usePlace } from "../data/place.ts";
import { signals } from "../deck/store.ts";
import type { ModuleId } from "./registry.ts";

/**
 * One module's line to the signal bus. Everything it sends is stamped with its own id, so the deck
 * can draw the pulse from the right tile; everything it reads is the one shared state, so a cursor
 * set anywhere is the cursor everywhere.
 */
export function useWire(id: ModuleId) {
  const source = `deck:${id}`;
  const depth = useSubsurfaceSelector(signals, (state) => state.depthLink);
  const componentId = useSubsurfaceSelector(signals, (state) => state.activeAsset.componentId);
  const wellId = useSubsurfaceSelector(signals, (state) => state.activeAsset.wellId);
  const brush = useSubsurfaceSelector(signals, (state) => state.dataInteraction.depthRange);
  const place = usePlace();
  return useMemo(() => {
    const well = wellId ?? "forge";
    const hover = (mdM: number | null) => signals.updateDepthHover(well, mdM === null ? null : Math.max(0, mdM), source);
    const pin = (mdM: number | null) => signals.pinDepth(well, mdM === null ? null : Math.max(0, mdM), source);
    const setWindow = (window: readonly [number, number] | null) => signals.setDepthWindow(window, source);
    const select = (next: string | null) => signals.selectComponent(next, source);
    const cursor = depth.hoverMdM ?? depth.pinnedMdM;
    /** The SDK's depth-link shape, for views that take one (the well section). */
    const link: DepthLink = {
      linked: true, setLinked: () => undefined,
      window: depth.window, setWindow,
      cursorMdM: cursor, setCursorMdM: hover,
      pinnedMdM: depth.pinnedMdM, pinCursor: pin,
    };
    const selected = place?.components.find((component) => component.id === componentId);
    /** A brushed interval, MD metres: the sample set every module can read. Null clears it. */
    const setBrush = (range: readonly [number, number] | null) => signals.setDataInteraction({ depthRange: range && range[1] > range[0] ? [Math.max(0, range[0]), range[1]] : null }, source);
    return { source, depth, cursor, pinned: depth.pinnedMdM, window: depth.window, componentId, selected, hover, pin, setWindow, select, link, brush, setBrush, place };
  }, [source, depth, componentId, wellId, brush, place]);
}
export type Wire = ReturnType<typeof useWire>;
