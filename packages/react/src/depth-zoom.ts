import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { scaleLinear } from "d3-scale";
import { select } from "d3-selection";
import type { Selection } from "d3-selection";
import { zoom, zoomIdentity } from "d3-zoom";
import type { D3ZoomEvent, ZoomBehavior } from "d3-zoom";
import { brush as selectBrush, brushY } from "d3-brush";
import type { BrushBehavior, D3BrushEvent } from "d3-brush";

/**
 * One way to move along a depth axis, shared by every depth view — the well section, the
 * construction schematic, the log tracks — instead of three copies of the same wheel handler.
 * Built on d3-zoom and d3-brush, so the gestures are the ones engineers already know from maps
 * and CAD:
 *
 * - Ctrl/⌘ + wheel, or a trackpad pinch, zooms about the depth under the pointer.
 * - A plain wheel pans the depth window (or scrolls the page when the view is not zoomed).
 * - Dragging pans; a click that does not move still selects.
 * - Shift + drag draws a depth box and zooms to it, AutoCAD's zoom window.
 * - Double-click zooms in about the pointer; Shift + double-click zooms out.
 *
 * The window it reports is the shared depth window: `null` is the whole extent.
 */

export type DepthWindow = readonly [number, number];

export interface DepthAxis {
  /** The whole depth range the view can show, shallow first. */
  readonly extent: DepthWindow;
  /** Where the plot runs on the surface, in the surface's own units (SVG user units, or CSS px for HTML). */
  readonly plot: readonly [number, number];
  /** The smallest span a zoom may reach. */
  readonly minSpan: number;
}

export interface DepthZoomOptions {
  /** Read on every gesture, so a resize or a new extent needs no re-attach. */
  readonly axis: () => DepthAxis;
  readonly onWindow: (window: DepthWindow | null) => void;
  /** Drags that start on these elements belong to them (a draggable item, a control). */
  readonly ignore?: string;
  /** A plain wheel scrolls the page here while the surface can still scroll itself. */
  readonly canScroll?: () => boolean;
}

const IGNORE = "button, input, select, textarea, a, [role='button'], [data-depth-zoom='ignore']";
const SVG_NS = "http://www.w3.org/2000/svg";

export class DepthZoom {
  private readonly selection: Selection<Element, unknown, null, undefined>;
  private readonly behaviour: ZoomBehavior<Element, unknown>;
  private readonly box: { readonly svg: SVGSVGElement; readonly group: SVGGElement; readonly brush: BrushBehavior<unknown> };
  private syncing = false;
  private readonly cleanup: (() => void)[] = [];

  constructor(private readonly surface: Element, private readonly options: DepthZoomOptions) {
    const ignore = options.ignore ? `${IGNORE}, ${options.ignore}` : IGNORE;
    const ignored = (target: EventTarget | null) => target instanceof Element && target.closest(ignore) !== null;
    this.selection = select(surface);
    this.behaviour = zoom<Element, unknown>()
      .filter((event: Event) => {
        if (event.type === "wheel") return (event as WheelEvent).ctrlKey || (event as WheelEvent).metaKey;
        if (event.type === "dblclick") return !ignored(event.target);
        const mouse = event as MouseEvent;
        return !mouse.button && !mouse.shiftKey && !ignored(event.target);
      })
      // d3 zooms by 2^delta. A wheel notch (~100 px) zooms 1.6×, as these views always have; a
      // trackpad pinch arrives as small Ctrl-wheel deltas and needs more gain to feel direct.
      .wheelDelta((event: WheelEvent) => {
        const unit = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? 400 : 1;
        const delta = event.deltaY * unit;
        return -delta * (Math.abs(delta) < 40 ? 0.02 : 0.0058);
      })
      .clickDistance(4)
      .extent(() => { const { plot } = this.options.axis(); return [[0, plot[0]], [1, plot[1]]]; })
      .on("zoom", (event: D3ZoomEvent<Element, unknown>) => {
        if (this.syncing) return;
        const { extent, plot } = this.options.axis();
        const [top, base] = event.transform.rescaleY(scaleLinear().domain(extent).range(plot)).domain() as [number, number];
        this.emit(top, base);
      });
    this.applyLimits();
    this.selection.call(this.behaviour);
    // d3's own double-click zoom stays; its wheel handler only sees Ctrl/⌘ (the filter above).
    // A plain wheel pans here, in pixels, which is how a long log scrolls.
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      const k = (this.surface as Element & { __zoom?: { k: number } }).__zoom?.k ?? 1;
      if (k <= 1.0001 || this.options.canScroll?.()) return;
      event.preventDefault();
      const { plot } = this.options.axis();
      this.behaviour.translateBy(this.selection, 0, -event.deltaY * (plot[1] - plot[0]) / 900 / k);
    };
    surface.addEventListener("wheel", wheel as EventListener, { passive: false });
    this.cleanup.push(() => surface.removeEventListener("wheel", wheel as EventListener));

    // Shift + drag: a depth box over the surface, live only while Shift is held, so it never
    // blocks hover or clicks on the tracks underneath.
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "sw-depth-box");
    svg.setAttribute("aria-hidden", "true");
    const group = document.createElementNS(SVG_NS, "g");
    svg.append(group);
    // An SVG surface cannot hold an HTML-positioned overlay, so the box goes beside it in its parent.
    const host = surface instanceof SVGSVGElement ? surface.parentElement ?? surface : surface;
    if (host instanceof HTMLElement && getComputedStyle(host).position === "static") host.style.position = "relative";
    host.append(svg);
    const brush = brushY<unknown>().on("end", (event: D3BrushEvent<unknown>) => {
      if (!event.selection || !event.sourceEvent) return;
      const [from, to] = event.selection as [number, number];
      select(group).call(brush.move, null);
      const scale = this.currentScale();
      const top = scale.invert(from), base = scale.invert(to);
      if (Math.abs(base - top) > 0) this.emit(Math.min(top, base), Math.max(top, base));
    });
    this.box = { svg, group, brush };
    select(group).call(brush);
    const shift = (event: KeyboardEvent) => { svg.classList.toggle("is-live", event.shiftKey); if (event.shiftKey) this.placeBox(); };
    const enter = (event: PointerEvent) => { svg.classList.toggle("is-live", event.shiftKey); if (event.shiftKey) this.placeBox(); };
    window.addEventListener("keydown", shift);
    window.addEventListener("keyup", shift);
    surface.addEventListener("pointermove", enter as EventListener);
    this.cleanup.push(() => { window.removeEventListener("keydown", shift); window.removeEventListener("keyup", shift); surface.removeEventListener("pointermove", enter as EventListener); svg.remove(); });
  }

  /** Follow a window set elsewhere — another linked view, a button — without reporting it back. */
  sync(window: DepthWindow | null) {
    this.applyLimits();
    const { extent, plot } = this.options.axis();
    const [top, base] = window ?? extent;
    const span = Math.max(1e-9, base - top);
    const k = (extent[1] - extent[0]) / span;
    const y0 = scaleLinear().domain(extent).range(plot);
    const transform = zoomIdentity.translate(0, plot[0] - k * y0(top)).scale(k);
    this.syncing = true;
    try { this.behaviour.transform(this.selection, transform); } finally { this.syncing = false; }
  }

  dispose() {
    this.selection.on(".zoom", null);
    for (const step of this.cleanup) step();
  }

  private applyLimits() {
    const { extent, minSpan } = this.options.axis();
    this.behaviour.scaleExtent([1, Math.max(1, (extent[1] - extent[0]) / minSpan)]);
    const { plot } = this.options.axis();
    this.behaviour.translateExtent([[-Infinity, plot[0]], [Infinity, plot[1]]]);
  }

  private currentScale() {
    const { extent, plot } = this.options.axis();
    const t = (this.surface as Element & { __zoom?: typeof zoomIdentity }).__zoom ?? zoomIdentity;
    return t.rescaleY(scaleLinear().domain(extent).range(plot));
  }

  private placeBox() {
    const rect = this.surface.getBoundingClientRect();
    const host = this.box.svg.parentElement?.getBoundingClientRect();
    if (!host) return;
    const svg = this.box.svg;
    svg.style.left = `${rect.left - host.left}px`;
    svg.style.top = `${rect.top - host.top}px`;
    svg.style.width = `${rect.width}px`;
    svg.style.height = `${rect.height}px`;
    // The overlay draws in the surface's units: for an SVG surface its viewBox, for HTML its CSS px.
    const viewBox = this.surface instanceof SVGSVGElement ? this.surface.viewBox.baseVal : null;
    const width = viewBox && viewBox.width ? viewBox.width : rect.width, height = viewBox && viewBox.height ? viewBox.height : rect.height;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("preserveAspectRatio", "none");
    const { plot } = this.options.axis();
    this.box.brush.extent([[0, plot[0]], [width, plot[1]]]);
    select(this.box.group).call(this.box.brush);
  }

  private emit(top: number, base: number) {
    const { extent, minSpan } = this.options.axis();
    const whole = extent[1] - extent[0];
    let span = Math.max(minSpan, base - top);
    if (span >= whole - 1e-6) { this.options.onWindow(null); return; }
    span = Math.min(span, whole);
    const start = Math.min(Math.max(extent[0], top), extent[1] - span);
    this.options.onWindow([start, start + span]);
  }
}

/**
 * Attach a DepthZoom to an element for as long as `enabled`, keeping it in step with the window the
 * component is showing. `axis` and `onWindow` may change every render; the zoom reads the latest.
 */
export function useDepthZoom(surface: RefObject<Element | null>, options: DepthZoomOptions & { readonly enabled?: boolean; readonly window: DepthWindow | null }) {
  const latest = useRef(options);
  latest.current = options;
  const instance = useRef<DepthZoom | null>(null);
  const enabled = options.enabled ?? true;
  useEffect(() => {
    const element = surface.current;
    if (!enabled || !element) return;
    const zoomer = new DepthZoom(element, {
      axis: () => latest.current.axis(),
      onWindow: (window) => latest.current.onWindow(window),
      ignore: latest.current.ignore,
      canScroll: () => latest.current.canScroll?.() ?? false,
    });
    instance.current = zoomer;
    zoomer.sync(latest.current.window);
    return () => { zoomer.dispose(); instance.current = null; };
  }, [enabled, surface]);
  // Every render: the window or the plot's size may have changed; following costs one transform.
  useLayoutEffect(() => { instance.current?.sync(latest.current.window); });
}

/**
 * The same gestures for a two-axis plot whose view is not one uniform zoom (the seismic section:
 * its depth and distance spans are fitted and clamped separately). d3-zoom recognises the gesture;
 * the plot keeps owning its view. At the start of each gesture the plot notes the view on screen,
 * and every event hands it the gesture so far as a mapping of screen points, so a drag or a run of
 * wheel notches is always measured from where it began. The transform returns to identity when the
 * gesture ends. Shift + drag draws a 2D box (d3-brush) and zooms to it.
 */
export interface PlotGesture {
  /** Where, on the screen as it was when the gesture began, a point on the screen now came from. */
  readonly invert: (x: number, y: number) => readonly [number, number];
}

export function usePlotZoom(surface: RefObject<SVGSVGElement | null>, options: {
  readonly enabled?: boolean;
  /** The plot rectangle in the SVG's user units: top-left, bottom-right. */
  readonly plot: () => readonly [readonly [number, number], readonly [number, number]];
  /** A gesture begins: remember the view on screen. */
  readonly onStart: () => void;
  readonly onGesture: (gesture: PlotGesture) => void;
  /** A Shift + drag box in user units, top-left then bottom-right. */
  readonly onBox: (box: readonly [readonly [number, number], readonly [number, number]]) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const enabled = options.enabled ?? true;
  useEffect(() => {
    const svg = surface.current;
    if (!enabled || !svg) return;
    const selection = select<SVGSVGElement, unknown>(svg);
    let resetting = false;
    const behaviour: ZoomBehavior<SVGSVGElement, unknown> = zoom<SVGSVGElement, unknown>()
      .filter((event: Event) => {
        if (event.type === "wheel") return (event as WheelEvent).ctrlKey || (event as WheelEvent).metaKey;
        const mouse = event as MouseEvent;
        return !mouse.button && !mouse.shiftKey;
      })
      .wheelDelta((event: WheelEvent) => {
        const unit = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? 400 : 1;
        const delta = event.deltaY * unit;
        return -delta * (Math.abs(delta) < 40 ? 0.02 : 0.0058);
      })
      .clickDistance(4)
      .on("start", () => { if (!resetting) latest.current.onStart(); })
      .on("zoom", (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        if (resetting) return;
        const t = event.transform;
        latest.current.onGesture({ invert: (x, y) => [t.invertX(x), t.invertY(y)] });
      })
      .on("end", () => {
        if (resetting) return;
        resetting = true;
        try { behaviour.transform(selection, zoomIdentity); } finally { resetting = false; }
      });
    selection.call(behaviour).on("dblclick.zoom", null);
    const group = selection.append("g").attr("class", "sw-plot-box");
    // Shift is how the box is reached, so it must not also be d3-brush's "lock to one axis".
    const box: BrushBehavior<unknown> = selectBrush<unknown>().keyModifiers(false).on("end", (event: D3BrushEvent<unknown>) => {
      if (!event.selection || !event.sourceEvent) return;
      const [[x0, y0], [x1, y1]] = event.selection as [[number, number], [number, number]];
      group.call(box.move, null);
      if (Math.abs(x1 - x0) > 4 && Math.abs(y1 - y0) > 4) latest.current.onBox([[x0, y0], [x1, y1]]);
    });
    const place = () => { const [a, b] = latest.current.plot(); box.extent([[a[0], a[1]], [b[0], b[1]]]); group.call(box); };
    place();
    const live = (on: boolean) => { if (on && !group.classed("is-live")) place(); group.classed("is-live", on); };
    const keys = (event: KeyboardEvent) => live(event.shiftKey);
    const move = (event: PointerEvent) => live(event.shiftKey);
    window.addEventListener("keydown", keys);
    window.addEventListener("keyup", keys);
    svg.addEventListener("pointermove", move);
    return () => {
      selection.on(".zoom", null);
      window.removeEventListener("keydown", keys);
      window.removeEventListener("keyup", keys);
      svg.removeEventListener("pointermove", move);
      group.remove();
    };
  }, [enabled, surface]);
}
