import { feetToMetres, metresToFeet } from "@ikhmalputra/subsurface-core";
import type { WellComponent } from "@ikhmalputra/subsurface-core";
import type { DepthLink, DepthWindow } from "@ikhmalputra/subsurface-react";
import type { DepthRange } from "@ikhmalputra/subsurface-react/records";

/**
 * The one place metres meet feet.
 *
 * The store holds measured depth in metres — one unit, so two views cannot disagree about where the
 * cursor is. Four operational views are indexed in feet, because their sources are: the mud log is
 * a LAS in feet, and the daily reports, service runs and hole sections quote feet from the drilling
 * report. Neither side is wrong, so there has to be a boundary, and the only question is whether it
 * is one boundary or twenty.
 *
 * It was twenty. `0.3048` appeared as a bare literal at roughly two dozen call sites and as five
 * private constants under four different names, which is not a style problem: a conversion written
 * inline is invisible to a reader checking whether a value crossing between a metre view and a feet
 * view was converted at all, and there is nothing to grep for when one was missed.
 *
 * So the views keep their own units and this bridge is the only thing that knows both.
 */
export interface DepthBridge {
  /** Hover-or-pinned cursor for a feet-indexed view. */
  readonly cursorFt: number | null;
  /** The explicitly picked depth, in feet. */
  readonly pinnedFt: number | null;
  /** Visible window in feet, `null` for the whole well. */
  readonly windowFt: readonly [number, number] | null;
  readonly setCursorFt: (depthFt: number | null) => void;
  readonly pinFt: (depthFt: number | null) => void;
  readonly setWindowFt: (windowFt: readonly [number, number] | null) => void;
  /** A component's extent as a feet range, for views that highlight the selection. */
  readonly rangeOf: (component: WellComponent | undefined) => DepthRange | null;
}

export function depthBridge(link: DepthLink): DepthBridge {
  return {
    cursorFt: link.cursorMdM === null ? null : metresToFeet(link.cursorMdM),
    pinnedFt: link.pinnedMdM === null ? null : metresToFeet(link.pinnedMdM),
    windowFt: link.window === null ? null : [metresToFeet(link.window[0]), metresToFeet(link.window[1])],
    setCursorFt: (depthFt) => link.setCursorMdM(depthFt === null ? null : feetToMetres(depthFt)),
    pinFt: (depthFt) => link.pinCursor(depthFt === null ? null : feetToMetres(depthFt)),
    // Rounded to whole metres because a window is where the reader is looking, not a measurement:
    // an unrounded window puts 17 significant digits in the shared URL and in every view's label.
    setWindowFt: (windowFt) => link.setWindow(windowFt === null
      ? null
      : [Math.round(feetToMetres(windowFt[0])), Math.round(feetToMetres(windowFt[1]))] as DepthWindow),
    rangeOf: (component) => component === undefined ? null : {
      // An unreported top is plotted from surface rather than guessed at; the drawings do the same.
      topFt: metresToFeet(component.topDepthReported === false ? 0 : component.topDepthM),
      baseFt: metresToFeet(component.bottomDepthM),
    },
  };
}

/** A feet depth from the records, as metres for the store. Named so the direction cannot be misread. */
export const recordDepthToMetres = (depthFt: number | null | undefined): number | undefined =>
  depthFt === null || depthFt === undefined ? undefined : feetToMetres(depthFt);
