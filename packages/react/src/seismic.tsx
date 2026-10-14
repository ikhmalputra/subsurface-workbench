"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { scaleLinear } from "d3-scale";
import { amplitudeClip, seismicColour, seismicImage, wellMdAtDepth, wellPointAtMd, type ProjectedPoint, type SeismicColorMap, type SegyFile, type SegyTrace } from "@ikhmalputra/subsurface-core";
import { AccessibleTable } from "./accessible-table.js";
import { CommandButton } from "./ui.js";
import { usePlotZoom } from "./depth-zoom.js";

export type { SeismicColorMap } from "@ikhmalputra/subsurface-core";

/** A measured-depth interval drawn along the well path (casing string, hole section, run, …). */
export interface SeismicWellInterval {
  readonly id: string;
  readonly label: string;
  readonly topMdM: number;
  readonly baseMdM: number;
  readonly color?: string;
}

export interface SeismicWellMarker {
  readonly mdM: number;
  readonly label: string;
}

/** Measured-depth window `[top, base]` in metres shared with other depth views. `null` shows everything. */
export type MdWindow = readonly [number, number];

/** Visible part of the section in its own axes: along-line x and sample depth (or time). */
export interface SeismicView {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}

export interface SeismicSectionProps {
  readonly file: SegyFile;
  /** Horizontal position of each trace, e.g. distance along line. Defaults to the trace index. */
  readonly traceX?: (trace: SegyTrace) => number;
  readonly xLabel?: string;
  /** Vertical value of sample 0 and the step between samples. Defaults to 0 and the binary interval / 1000 (ms for time data). */
  readonly depthStart?: number;
  readonly depthStep?: number;
  readonly depthLabel?: string;
  /** Well stations already projected to the section's x/depth axes. */
  readonly wellPath?: readonly ProjectedPoint[];
  readonly intervals?: readonly SeismicWellInterval[];
  readonly markers?: readonly SeismicWellMarker[];
  readonly selectedId?: string | null;
  /** Measured depth shown as a cursor on the well, e.g. the pointer depth in a linked schematic. */
  readonly cursorMdM?: number | null;
  /** Called with the measured depth of the well station nearest to a click (or the keyboard cursor on Enter). */
  readonly onSelectMd?: (mdM: number) => void;
  /** Hover correlation: the well MD at the pointer's depth (on the well path, or where the well crosses that depth), `null` when the pointer leaves. */
  readonly onCursorMdChange?: (mdM: number | null) => void;
  /**
   * Controlled measured-depth window. When set (including `null` for the whole section), the view fits the well
   * between those depths; zooming or panning reports the MD range of the well inside the visible depth band through
   * `onMdWindowChange`. Leave `undefined` for an independent view.
   */
  readonly mdWindow?: MdWindow | null;
  readonly onMdWindowChange?: (window: MdWindow | null) => void;
  readonly initialColorMap?: SeismicColorMap;
  readonly initialGain?: number;
  readonly title?: string;
}

const M = { left: 62, right: 18, top: 26, bottom: 44 };
const PICK_PX = 22;
const MIN_SPAN_SAMPLES = 8;
const fmt = (value: number, digits = 0) => value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });

const windowKey = (win: MdWindow | null | undefined) => (win ? `${Math.round(win[0])}:${Math.round(win[1])}` : "full");

export function SeismicSection({ file, traceX = (trace) => trace.index, xLabel = "Trace", depthStart = 0, depthStep, depthLabel = "ms", wellPath = [], intervals = [], markers = [], selectedId = null, cursorMdM = null, onSelectMd, onCursorMdChange, mdWindow, onMdWindowChange, initialColorMap = "grey", initialGain = 1, title = "Seismic section" }: SeismicSectionProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const ids = useId();
  const clipId = `${ids.replace(/:/g, "")}-plot`;
  const [size, setSize] = useState({ w: 960, h: 600 });
  const W = size.w, H = size.h;
  const [map, setMap] = useState<SeismicColorMap>(initialColorMap);
  const [gain, setGain] = useState(initialGain);
  const [hover, setHover] = useState<{ trace: number; sample: number; md: number | null; corr: number | null } | null>(null);
  const [keyMd, setKeyMd] = useState<number | null>(null);
  const [own, setOwn] = useState<{ key: string | null; view: SeismicView | null }>({ key: null, view: null });
  const drag = useRef<{ x: number; y: number; view: SeismicView; moved: boolean; id: number } | null>(null);
  const step = depthStep ?? file.binary.sampleInterval / 1000;
  const n = file.traceCount, m = file.sampleCount;
  const xs = useMemo(() => file.traces.map(traceX), [file, traceX]);
  const clip = useMemo(() => amplitudeClip(file.data, 99), [file]);
  const scaled = clip / gain;
  const half = n > 1 ? Math.abs((xs[n - 1]! - xs[0]!) / (n - 1)) / 2 : 0.5;
  const full: SeismicView = useMemo(() => ({ x0: Math.min(...xs) - half, x1: Math.max(...xs) + half, z0: depthStart - step / 2, z1: depthStart + (m - 0.5) * step }), [xs, half, depthStart, step, m]);
  const minZ = Math.min(full.z1 - full.z0, MIN_SPAN_SAMPLES * step);
  const minX = Math.min(full.x1 - full.x0, 6 * half * 2);

  function clampView(view: SeismicView): SeismicView {
    const zs = Math.min(full.z1 - full.z0, Math.max(minZ, view.z1 - view.z0));
    const xspan = Math.min(full.x1 - full.x0, Math.max(minX, view.x1 - view.x0));
    const z0 = Math.min(Math.max(full.z0, view.z0), full.z1 - zs);
    const x0 = Math.min(Math.max(full.x0, view.x0), full.x1 - xspan);
    return { x0, x1: x0 + xspan, z0, z1: z0 + zs };
  }

  function fitMd(win: MdWindow | null): SeismicView {
    if (!win || wellPath.length === 0) return full;
    const a = wellPointAtMd(wellPath, win[0])!, b = wellPointAtMd(wellPath, win[1])!;
    const inside = [a, b, ...wellPath.filter((point) => point.mdM > win[0] && point.mdM < win[1])];
    const z0 = Math.min(...inside.map((point) => point.depthM)), z1 = Math.max(...inside.map((point) => point.depthM));
    const a0 = Math.min(...inside.map((point) => point.alongM)), a1 = Math.max(...inside.map((point) => point.alongM));
    const zs = Math.max(minZ, z1 - z0);
    const xspan = Math.max((full.x1 - full.x0) * (zs / (full.z1 - full.z0)), (a1 - a0) * 1.3, minX);
    const mid = (a0 + a1) / 2;
    return clampView({ x0: mid - xspan / 2, x1: mid + xspan / 2, z0: (z0 + z1) / 2 - zs / 2, z1: (z0 + z1) / 2 + zs / 2 });
  }

  const controlled = mdWindow !== undefined;
  if (controlled && own.key !== windowKey(mdWindow)) setOwn({ key: windowKey(mdWindow), view: fitMd(mdWindow) });
  const view = controlled && own.key !== windowKey(mdWindow) ? fitMd(mdWindow) : own.view ?? full;
  const zoomed = view.x1 - view.x0 < full.x1 - full.x0 - 1e-6 || view.z1 - view.z0 < full.z1 - full.z0 - 1e-6;

  function mdWindowOf(next: SeismicView): MdWindow | null | "outside" {
    const isFull = next.x1 - next.x0 >= full.x1 - full.x0 - 1e-6 && next.z1 - next.z0 >= full.z1 - full.z0 - 1e-6;
    if (isFull || wellPath.length === 0) return null;
    const first = wellPath[0]!, last = wellPath.at(-1)!;
    const lo = Math.min(...wellPath.map((point) => point.depthM)), hi = Math.max(...wellPath.map((point) => point.depthM));
    if (next.z1 < lo || next.z0 > hi) return "outside";
    const top = next.z0 <= first.depthM ? first.mdM : wellMdAtDepth(wellPath, next.z0) ?? first.mdM;
    const base = next.z1 >= last.depthM ? last.mdM : wellMdAtDepth(wellPath, next.z1) ?? last.mdM;
    return [Math.round(Math.min(top, base)), Math.round(Math.max(top, base))];
  }

  function applyView(next: SeismicView | null) {
    const target = next ? clampView(next) : full;
    const win = next ? mdWindowOf(target) : null;
    if (win === "outside") { setOwn({ key: windowKey(mdWindow), view: target }); return; }
    setOwn({ key: windowKey(win), view: target });
    onMdWindowChange?.(win);
  }

  function zoomAround(factor: number, cx = (view.x0 + view.x1) / 2, cz = (view.z0 + view.z1) / 2) {
    const fx = (cx - view.x0) / (view.x1 - view.x0), fz = (cz - view.z0) / (view.z1 - view.z0);
    const xspan = (view.x1 - view.x0) * factor, zs = (view.z1 - view.z0) * factor;
    if (factor > 1 && xspan >= full.x1 - full.x0 && zs >= full.z1 - full.z0) { applyView(null); return; }
    applyView({ x0: cx - fx * xspan, x1: cx - fx * xspan + xspan, z0: cz - fz * zs, z1: cz - fz * zs + zs });
  }

  const x = scaleLinear().domain([view.x0, view.x1]).range([M.left, W - M.right]);
  const y = scaleLinear().domain([view.z0, view.z1]).range([M.top, H - M.bottom]);
  const plotW = W - M.left - M.right, plotH = H - M.top - M.bottom;
  const lastLabelY = { left: -Infinity, right: -Infinity };
  const markerLabels = markers
    .flatMap((marker) => { const point = wellPointAtMd(wellPath, marker.mdM); return point ? [{ label: marker.label, px: x(point.alongM), py: y(point.depthM) }] : []; })
    .sort((a, b) => a.py - b.py)
    .map((item) => {
      const left = item.px - M.left > Math.min(190, item.label.length * 6.6 + 20);
      const side = left ? "left" : "right";
      const ty = Math.max(item.py + 4, lastLabelY[side] + 14);
      lastLabelY[side] = ty;
      return { ...item, left, ty, moved: ty > item.py + 4.5 };
    });

  useEffect(() => {
    const element = frameRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      if (width > 0 && height > 0) setSize({ w: Math.round(Math.max(420, width)), h: Math.round(Math.max(300, height)) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    canvas.width = n;
    canvas.height = m;
    const image = context.createImageData(n, m);
    image.data.set(seismicImage(file, { colorMap: map, clip: scaled }).data);
    context.putImageData(image, 0, 0);
  }, [file, map, scaled, n, m]);

  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      // Ctrl/⌘ + wheel zooms through d3-zoom below; a plain wheel pans a zoomed section.
      if (event.ctrlKey || event.metaKey) return;
      if (zoomed) {
        event.preventDefault();
        const dx = (event.shiftKey ? event.deltaY : event.deltaX) * (view.x1 - view.x0) / plotW;
        const dz = (event.shiftKey ? 0 : event.deltaY) * (view.z1 - view.z0) / plotH;
        applyView({ x0: view.x0 + dx, x1: view.x1 + dx, z0: view.z0 + dz, z1: view.z1 + dz });
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  });

  // Drag to pan, Ctrl/⌘ + wheel to zoom about the pointer, Shift + drag for a zoom box: d3-zoom and
  // d3-brush, measured from the view on screen when the gesture began.
  const gestureBase = useRef<SeismicView | null>(null);
  usePlotZoom(svgRef, {
    plot: () => [[M.left, M.top], [W - M.right, H - M.bottom]],
    onStart: () => { gestureBase.current = view; },
    onGesture: ({ invert }) => {
      const base = gestureBase.current ?? view;
      const bx = scaleLinear().domain([base.x0, base.x1]).range([M.left, W - M.right]);
      const by = scaleLinear().domain([base.z0, base.z1]).range([M.top, H - M.bottom]);
      const [left, top] = invert(M.left, M.top), [right, bottom] = invert(W - M.right, H - M.bottom);
      const next = { x0: bx.invert(left), x1: bx.invert(right), z0: by.invert(top), z1: by.invert(bottom) };
      const whole = next.x1 - next.x0 >= full.x1 - full.x0 - 1e-6 && next.z1 - next.z0 >= full.z1 - full.z0 - 1e-6;
      applyView(whole ? null : next);
    },
    onBox: ([[left, top], [right, bottom]]) => applyView({ x0: x.invert(left), x1: x.invert(right), z0: y.invert(top), z1: y.invert(bottom) }),
  });

  const pathD = (points: readonly ProjectedPoint[]) => points.map((point, index) => `${index ? "L" : "M"}${x(point.alongM).toFixed(1)},${y(point.depthM).toFixed(1)}`).join("");
  const slice = (top: number, base: number) => {
    const a = wellPointAtMd(wellPath, top), b = wellPointAtMd(wellPath, base);
    return a && b ? [a, ...wellPath.filter((point) => point.mdM > top && point.mdM < base), b] : [];
  };
  const selected = intervals.find((item) => item.id === selectedId) ?? null;
  const cursor = keyMd ?? hover?.md ?? cursorMdM;
  const cursorPoint = cursor === null || wellPath.length === 0 ? null : wellPointAtMd(wellPath, cursor);

  function locate(clientX: number, clientY: number) {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return null;
    const px = ((clientX - box.left) / box.width) * W;
    const py = ((clientY - box.top) / box.height) * H;
    if (px < M.left || px > W - M.right || py < M.top || py > H - M.bottom) return null;
    const along = x.invert(px);
    let trace = 0;
    xs.forEach((value, index) => { if (Math.abs(value - along) < Math.abs(xs[trace]! - along)) trace = index; });
    const depth = y.invert(py);
    const sample = Math.max(0, Math.min(m - 1, Math.round((depth - depthStart) / step)));
    let md: number | null = null, best = PICK_PX;
    for (let i = 1; i < wellPath.length; i += 1) {
      const a = wellPath[i - 1]!, b = wellPath[i]!;
      const ax = x(a.alongM), ay = y(a.depthM), bx = x(b.alongM), by = y(b.depthM);
      const len = (bx - ax) ** 2 + (by - ay) ** 2;
      const t = len ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len)) : 0;
      const distance = Math.hypot(ax + t * (bx - ax) - px, ay + t * (by - ay) - py);
      if (distance < best) { best = distance; md = a.mdM + t * (b.mdM - a.mdM); }
    }
    const corr = md ?? wellMdAtDepth(wellPath, depth);
    return { trace, sample, md: md === null ? null : Math.round(md), corr: corr === null ? null : Math.round(corr) };
  }

  function hoverAt(clientX: number, clientY: number) {
    const hit = locate(clientX, clientY);
    setHover(hit);
    onCursorMdChange?.(hit?.corr ?? null);
  }

  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, view, moved: false, id: event.pointerId };
  }
  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    // d3-zoom pans while the button is down; past a few pixels the press is a drag, not a click.
    const current = drag.current;
    if (current && (current.moved || Math.hypot(event.clientX - current.x, event.clientY - current.y) > 4)) { current.moved = true; return; }
    hoverAt(event.clientX, event.clientY);
  }
  function onPointerUp(event: PointerEvent<SVGSVGElement>) {
    const current = drag.current;
    drag.current = null;
    if (!current || current.moved) return;
    const hit = locate(event.clientX, event.clientY);
    if (hit?.md !== null && hit?.md !== undefined) onSelectMd?.(hit.md);
  }

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomAround(0.5); return; }
    if (event.key === "-" || event.key === "_") { event.preventDefault(); zoomAround(2); return; }
    if (event.key === "0") { event.preventDefault(); applyView(null); return; }
    if (wellPath.length === 0) return;
    const first = wellPath[0]!.mdM, last = wellPath.at(-1)!.mdM;
    const base = keyMd ?? cursorMdM ?? first;
    const delta = event.shiftKey ? 150 : 30;
    const move = (md: number) => { setKeyMd(md); onCursorMdChange?.(md); };
    if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); move(Math.min(last, base + delta)); }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") { event.preventDefault(); move(Math.max(first, base - delta)); }
    if (event.key === "Enter" && keyMd !== null) onSelectMd?.(keyMd);
    if (event.key === "Escape") { setKeyMd(null); onCursorMdChange?.(null); }
  }

  const readTrace = hover ? file.traces[hover.trace] : null;
  const amplitude = hover ? file.data[hover.trace * m + hover.sample] : null;
  const legend = [-1, -0.5, 0, 0.5, 1];
  const pct = (value: number, total: number) => `${(value / total) * 100}%`;

  return <section className="sw-rec sw-seis" aria-label={title} data-testid="seismic-section">
    <header className="sw-rec-head">
      <h3>{title}</h3>
      <div className="sw-seis-tools">
        <label htmlFor={`${ids}-map`}>Colour</label>
        <select id={`${ids}-map`} value={map} onChange={(event) => setMap(event.target.value as SeismicColorMap)}>
          <option value="grey">Grey (peak black)</option>
          <option value="red-blue">Red–white–blue</option>
        </select>
        <label htmlFor={`${ids}-gain`}>Gain {fmt(gain, 1)}×</label>
        <input id={`${ids}-gain`} type="range" min={0.5} max={6} step={0.25} value={gain} onChange={(event) => setGain(Number(event.target.value))} />
        <span>clip ±{fmt(scaled, 3)}</span>
        <span className="sw-seis-zoom" role="toolbar" aria-label="Section view">
          <CommandButton icon="zoomIn" type="button" onClick={() => zoomAround(0.5)} aria-label="Zoom section in"></CommandButton>
          <CommandButton icon="zoomOut" type="button" onClick={() => zoomAround(2)} aria-label="Zoom section out" disabled={!zoomed}></CommandButton>
          <CommandButton icon="focus" type="button" onClick={() => applyView(fitMd([selected!.topMdM, selected!.baseMdM]))} disabled={!selected || wellPath.length === 0} aria-label="Zoom section to selection">Selection</CommandButton>
          <CommandButton icon="fit" type="button" onClick={() => applyView(null)} aria-label="Fit whole section" disabled={!zoomed}>Fit</CommandButton>
        </span>
      </div>
    </header>
    <div className="sw-seis-readout" aria-live="polite" data-testid="seismic-readout">
      {hover && readTrace ? <>
        <strong>{depthLabel === "ms" ? `${fmt(depthStart + hover.sample * step)} ms` : `${fmt(depthStart + hover.sample * step)} ${depthLabel}`}</strong>
        <span>{xLabel} {fmt(xs[hover.trace]!)}</span>
        <span>Trace {readTrace.index + 1} · IL {readTrace.inline} · XL {readTrace.crossline}</span>
        <span>X {fmt(readTrace.x, 1)} · Y {fmt(readTrace.y, 1)}</span>
        <span>Amplitude {amplitude === null || amplitude === undefined ? "—" : fmt(amplitude, 4)}</span>
        {hover.md !== null ? <span className="sw-seis-well">Well MD {fmt(hover.md)} m · click to select</span> : hover.corr !== null && <span>Well reaches this depth at MD {fmt(hover.corr)} m</span>}
      </> : cursorPoint && keyMd !== null ? <><strong>Well MD {fmt(cursorPoint.mdM)} m</strong><span>Depth {fmt(cursorPoint.depthM)} {depthLabel}</span><span>Enter selects · Esc clears</span></>
        : <span>Hover to read trace headers and amplitude. Click the well path, or focus the section and use ↑/↓ then Enter, to select by depth. Ctrl/⌘ + wheel or +/− zooms, drag or wheel pans, 0 fits.</span>}
    </div>
    <div ref={frameRef} className="sw-seis-frame" tabIndex={0} role="group" aria-label={`${title}. ${wellPath.length ? "Arrow keys move a cursor along the well, Shift for larger steps, Enter selects that depth. " : ""}Plus and minus zoom, 0 fits.`} onKeyDown={onKey} onBlur={() => { if (keyMd !== null) { setKeyMd(null); onCursorMdChange?.(null); } }} data-zoomed={zoomed ? "true" : undefined}>
      <div className="sw-seis-clip" style={{ left: pct(M.left, W), top: pct(M.top, H), width: pct(plotW, W), height: pct(plotH, H) }}>
        <canvas ref={canvasRef} className="sw-seis-image" aria-hidden style={{ left: pct(x(full.x0) - M.left, plotW), top: pct(y(full.z0) - M.top, plotH), width: pct(x(full.x1) - x(full.x0), plotW), height: pct(y(full.z1) - y(full.z0), plotH) }} />
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} aria-hidden onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; }} onPointerLeave={() => { if (!drag.current?.moved) { setHover(null); onCursorMdChange?.(null); } }} data-testid="seismic-plot" data-view={`${Math.round(view.z0)}:${Math.round(view.z1)}`}>
        <defs><clipPath id={clipId}><rect x={M.left} y={M.top} width={plotW} height={plotH} /></clipPath></defs>
        <rect x={M.left} y={M.top} width={plotW} height={plotH} className="sw-seis-border" />
        {y.ticks(Math.max(4, Math.round(plotH / 55))).map((tick) => <g key={`y${tick}`}><line x1={M.left - 5} x2={M.left} y1={y(tick)} y2={y(tick)} className="sw-seis-tick" /><text x={M.left - 8} y={y(tick) + 4} textAnchor="end" className="sw-seis-ticklabel">{fmt(tick)}</text></g>)}
        {x.ticks(Math.max(3, Math.round(plotW / 90))).map((tick) => <g key={`x${tick}`}><line x1={x(tick)} x2={x(tick)} y1={H - M.bottom} y2={H - M.bottom + 5} className="sw-seis-tick" /><text x={x(tick)} y={H - M.bottom + 18} textAnchor="middle" className="sw-seis-ticklabel">{fmt(tick)}</text></g>)}
        <text x={M.left + plotW / 2} y={H - 6} textAnchor="middle" className="sw-seis-axis">{xLabel}</text>
        <text transform={`translate(14 ${M.top + plotH / 2}) rotate(-90)`} textAnchor="middle" className="sw-seis-axis">{depthLabel === "ms" ? "Time (ms)" : `Depth (${depthLabel})`}</text>
        <g clipPath={`url(#${clipId})`}>
          {wellPath.length > 1 && <g>
            <path d={pathD(wellPath)} className="sw-seis-well-halo" />
            <path d={pathD(wellPath)} className="sw-seis-well-path" />
            {intervals.map((item) => { const points = slice(item.topMdM, item.baseMdM); return points.length > 1 && item.id !== selectedId ? <path key={item.id} d={pathD(points)} className="sw-seis-interval" style={{ stroke: item.color }} /> : null; })}
            {selected && slice(selected.topMdM, selected.baseMdM).length > 1 && <g data-testid="seismic-selected">
              <path d={pathD(slice(selected.topMdM, selected.baseMdM))} className="sw-seis-selected-halo" />
              <path d={pathD(slice(selected.topMdM, selected.baseMdM))} className="sw-seis-selected" />
            </g>}
            {markerLabels.map((label) => <g key={label.label} className="sw-seis-marker"><path d={`M${label.px - 7},${label.py}L${label.px},${label.py - 9}L${label.px},${label.py}Z`} />
              {label.moved && <line x1={label.px} y1={label.py} x2={label.left ? label.px - 10 : label.px + 10} y2={label.ty - 4} className="sw-seis-marker-leader" />}
              <text x={label.left ? label.px - 12 : label.px + 12} y={label.ty} textAnchor={label.left ? "end" : "start"}>{label.label}</text></g>)}
            {cursorPoint && <g data-testid="seismic-cursor"><line x1={M.left} x2={W - M.right} y1={y(cursorPoint.depthM)} y2={y(cursorPoint.depthM)} className="sw-seis-cursor-line" /><circle cx={x(cursorPoint.alongM)} cy={y(cursorPoint.depthM)} r={7} className="sw-seis-cursor" /></g>}
          </g>}
          {hover && <g className="sw-seis-crosshair"><line x1={x(xs[hover.trace]!)} x2={x(xs[hover.trace]!)} y1={M.top} y2={H - M.bottom} /><line x1={M.left} x2={W - M.right} y1={y(depthStart + hover.sample * step)} y2={y(depthStart + hover.sample * step)} /></g>}
        </g>
      </svg>
    </div>
    <div className="sw-seis-legend">
      <span className="sw-seis-ramp" aria-hidden style={{ background: `linear-gradient(90deg, ${legend.map((v) => `rgb(${seismicColour(map, v).join(",")})`).join(",")})` }} />
      <span>−{fmt(scaled, 2)}</span><span>0</span><span>+{fmt(scaled, 2)}</span>
      <span className="sw-seis-legend-note">{file.traceCount} traces × {file.sampleCount} samples · showing {fmt(view.z0)}–{fmt(view.z1)} {depthLabel === "ms" ? "ms" : depthLabel} · display clip = 99th percentile |amplitude| ÷ gain</span>
    </div>
    <p className="sw-sr-only">{title}: {file.traceCount} traces and {file.sampleCount} samples per trace, shown over {fmt(view.z0)} to {fmt(view.z1)} {depthLabel === "ms" ? "milliseconds" : depthLabel}. Amplitude display is clipped at {fmt(scaled, 3)}; the source values are available in the table.</p>
    <AccessibleTable
      label={`${title} trace samples`}
      description={`Supplied trace headers and raw amplitudes by sample. Sample axis is ${depthLabel === "ms" ? "time in milliseconds" : `depth in ${depthLabel}`}; amplitudes are not gain-scaled in the table.`}
      columns={[{ label: depthLabel === "ms" ? "Time" : "Depth", unit: depthLabel === "ms" ? "ms" : depthLabel }, { label: "Trace" }, { label: "Inline" }, { label: "Crossline" }, { label: "X" }, { label: "Y" }, { label: "Amplitude" }]}
      rowCount={file.traceCount * file.sampleCount}
      getRows={(start, end) => Array.from({ length: end - start }, (_, offset) => {
        const index = start + offset;
        const traceIndex = Math.floor(index / m);
        const sampleIndex = index % m;
        const trace = file.traces[traceIndex]!;
        const amplitudeValue = file.data[index];
        return [
          depthStart + sampleIndex * step,
          trace.index + 1,
          trace.inline,
          trace.crossline,
          trace.x,
          trace.y,
          amplitudeValue === null || amplitudeValue === undefined || !Number.isFinite(amplitudeValue) ? null : amplitudeValue,
        ];
      })}
    />
  </section>;
}

export interface SegyHeaderPanelProps {
  readonly file: SegyFile;
  /** Trace whose header is listed. Defaults to the first trace. */
  readonly traceIndex?: number;
  readonly title?: string;
}

const measurement = ["unspecified", "metres", "feet"];
const sorting: Record<number, string> = { [-1]: "other", 0: "unknown", 1: "as recorded", 2: "CDP ensemble", 3: "single fold continuous profile", 4: "horizontally stacked", 5: "common source", 6: "common receiver", 7: "common offset", 8: "common mid-point", 9: "common conversion point" };

/** Every header in the file: summary, 40-card textual header, binary header and one trace header. */
export function SegyHeaderPanel({ file, traceIndex = 0, title = "SEG-Y headers" }: SegyHeaderPanelProps) {
  const trace = file.traces[Math.max(0, Math.min(file.traceCount - 1, traceIndex))];
  const b = file.binary;
  const binaryRows: [string, string, string][] = [
    ["3201", "Job ID", String(b.jobId)],
    ["3205", "Line number", String(b.lineNumber)],
    ["3209", "Reel number", String(b.reelNumber)],
    ["3213", "Traces per ensemble", String(b.tracesPerEnsemble)],
    ["3215", "Auxiliary traces per ensemble", String(b.auxTracesPerEnsemble)],
    ["3217", "Sample interval", String(b.sampleInterval)],
    ["3219", "Original sample interval", String(b.sampleIntervalOriginal)],
    ["3221", "Samples per trace", String(b.samplesPerTrace)],
    ["3223", "Original samples per trace", String(b.samplesPerTraceOriginal)],
    ["3225", "Sample format", `${b.format} — ${file.formatName}`],
    ["3227", "Ensemble fold", String(b.ensembleFold)],
    ["3229", "Trace sorting", `${b.sortingCode} — ${sorting[b.sortingCode] ?? "non-standard"}`],
    ["3255", "Measurement system", `${b.measurementSystem} — ${measurement[b.measurementSystem] ?? "non-standard"}`],
    ["3501", "SEG-Y revision", b.revision],
    ["3503", "Fixed-length traces", String(b.fixedLengthTraces)],
    ["3505", "Extended textual headers", String(b.extendedTextHeaders)],
  ];
  const traceRows: [string, string][] = trace ? [
    ["Trace", `${trace.index + 1} of ${file.traceCount}`],
    ["Inline / crossline", `${trace.inline} / ${trace.crossline}`],
    ["CDP", String(trace.cdp)],
    ["X / Y", `${fmt(trace.x, 2)} / ${fmt(trace.y, 2)}`],
    ["Coordinate scalar", String(trace.coordinateScalar)],
    ["Shotpoint", String(trace.shotpoint)],
    ["Samples (trace header)", String(trace.headerSampleCount)],
  ] : [];
  return <section className="sw-rec sw-segy" aria-label={title} data-testid="segy-headers">
    <header className="sw-rec-head"><h3>{title}</h3><span>{fmt(file.byteLength / 1024, 0)} KiB · {file.byteOrder}-endian · {file.textEncoding.toUpperCase()} text</span></header>
    <dl className="sw-segy-summary">
      <div><dt>Format</dt><dd>{file.formatName}</dd></div>
      <div><dt>Traces</dt><dd>{fmt(file.traceCount)}</dd></div>
      <div><dt>Samples / trace</dt><dd>{fmt(file.sampleCount)}</dd></div>
      <div><dt>Interval (raw)</dt><dd>{b.sampleInterval}</dd></div>
      <div><dt>Revision</dt><dd>{b.revision}</dd></div>
      <div><dt>Units</dt><dd>{measurement[b.measurementSystem] ?? "non-standard"}</dd></div>
    </dl>
    <div className="sw-segy-grid">
      <div>
        <h4>Textual header (3200 bytes)</h4>
        <pre className="sw-segy-text" tabIndex={0} aria-label="Textual header card images">{file.textHeader.join("\n")}</pre>
      </div>
      <div>
        <h4>Binary header (400 bytes)</h4>
        <table className="sw-segy-table"><thead><tr><th scope="col">Byte</th><th scope="col">Field</th><th scope="col">Value</th></tr></thead>
          <tbody>{binaryRows.map(([byte, label, value]) => <tr key={byte}><td>{byte}</td><th scope="row">{label}</th><td>{value}</td></tr>)}</tbody></table>
        <h4>Trace header</h4>
        <table className="sw-segy-table" data-testid="segy-trace-header"><tbody>{traceRows.map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td>{value}</td></tr>)}</tbody></table>
      </div>
    </div>
  </section>;
}
