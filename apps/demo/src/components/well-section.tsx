"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CommandButton } from "@ikhmalputra/subsurface-react/ui";
import { metresToFeet } from "@ikhmalputra/subsurface-core";
import type { ComputedStation, FormationLayer, SurveyPoint, WellAssembly, WellComponent, WellOperations } from "@ikhmalputra/subsurface-core";
import type { DepthLink } from "@ikhmalputra/subsurface-react";
import { AssemblySchematic } from "@ikhmalputra/subsurface-react/assembly";
import { LogTracks } from "@ikhmalputra/subsurface-react/records";
import { TrajectoryLog } from "@ikhmalputra/subsurface-react/trajectory";
import { useLas } from "./use-las";
import { depthBridge } from "../lib/depth";

/**
 * The well section: one depth axis, and everything the well knows about itself as tracks on it.
 *
 * This is how INT GeoToolkit, Techlog and Petrel show a well, and the reason is not taste. The
 * schematic, the log and the survey are all indexed on measured depth; drawn on one scale, a reader
 * sees a casing shoe, the ROP that drilled past it and the dogleg at that point in one glance. Drawn
 * as separate panels — or, as this application did, with the log in a drawer below the fold — the
 * depth link still fires, but across a scroll boundary nobody can perceive it. The link was real
 * and the interface made it meaningless.
 *
 * Every track maps the same window to the same pixels: the container fixes a plot inset and each
 * component honours it through its `frame` prop. The container draws the depth ruler; the tracks
 * draw their own cursor line at the shared depth, which coincides by construction.
 */

const FRAME = { bottom: 28, chromeless: true } as const;

/**
 * The ruler's own mapping — linear, the same as every track's — and round tick values.
 * Written out rather than pulled from d3 because the demo app does not depend on d3 and a ruler is
 * not a reason to start; the tracks bring their own scales and this one has to agree with them,
 * which linear interpolation over the same window and the same inset does by construction.
 */
function linearScale(domain: readonly [number, number], range: readonly [number, number]) {
  const k = (range[1] - range[0]) / (domain[1] - domain[0] || 1);
  return (value: number) => range[0] + (value - domain[0]) * k;
}
function niceTicks(domain: readonly [number, number], count: number): number[] {
  const span = Math.abs(domain[1] - domain[0]);
  if (!(span > 0)) return [domain[0]];
  const raw = span / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const unit = [1, 2, 5, 10].map((m) => m * magnitude).find((m) => m >= raw) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let value = Math.ceil(domain[0] / unit) * unit; value <= domain[1] + 1e-9; value += unit) ticks.push(Math.round(value * 1e6) / 1e6);
  return ticks;
}
const HEAD_PX = 36;
const TOOLBAR_PX = 32;
/**
 * The tracks never render shorter than this. A section that fits whatever height it is given
 * squashes the moment a dock opens or the window shrinks — 3,339 m into 280px is 0.08 px/m, and
 * every casing becomes a line. Below this the strip keeps its scale and scrolls inside its box,
 * with the ruler and the track heads pinned, which is how a well-log viewer behaves.
 */
const MIN_TRACK_PX = 560;
const MIN_SPAN_M = 20;
const ZOOM_STEP = 0.6;
type TrackId = "construction" | "log" | "survey";
const fmtM = (value: number) => Math.round(value).toLocaleString("en-US");

/**
 * Two drilling curves by default. Each log track is 120px wide, and at 1440px with the inspector
 * open the section has about 875px: ruler, construction and two curves fit; a third pushes the
 * survey off the right edge. The full seven-curve log stays one preset away.
 */
const logTracks = [
  { mnemonic: "ROP", label: "ROP", color: "#147a65" },
  { mnemonic: "WOB", label: "WOB", color: "#2c3f7a" },
] as const;

export interface WellSectionProps {
  readonly assembly: WellAssembly;
  readonly components: readonly WellComponent[];
  readonly survey: readonly ComputedStation[];
  readonly stations?: readonly SurveyPoint[];
  readonly formations?: readonly FormationLayer[];
  readonly totalDepthM: number;
  readonly operations: WellOperations | null;
  readonly logUrl?: string;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly onSelectMd: (mdM: number) => void;
  readonly link: DepthLink;
  readonly showFormations?: boolean;
  /** Depth markers beyond the casing shoes — a planner's kick-off, end of build and target. */
  readonly markers?: readonly { readonly mdM: number; readonly label: string }[];
  /** Dogleg limit drawn on the survey track. */
  readonly dlsLimitDegPer30m?: number;
  /**
   * Depth intervals to show across the section — a study's target and comparison windows, a
   * focus interval. Drawn as bands on the ruler and as labelled intervals on the log track, in
   * metres here and converted once at the log's boundary.
   */
  readonly highlights?: readonly { readonly id: string; readonly label: string; readonly topM: number; readonly baseM: number; readonly tone?: "neutral" | "problem" | "failed"; readonly focused?: boolean }[];
}

export function WellSection({ assembly, components, survey, stations, formations = [], totalDepthM, operations, logUrl, selectedId, onSelect, onSelectMd, link, showFormations = true, markers = [], dlsLimitDegPer30m, highlights = [] }: WellSectionProps) {
  const host = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const rulerSvg = useRef<SVGSVGElement>(null);
  const [height, setHeight] = useState(640);
  const [shown, setShown] = useState<Record<TrackId, boolean>>({ construction: true, log: true, survey: true });
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => { const next = Math.round(entry!.contentRect.height); if (next > 0) setHeight(next); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The surface equipment stack sits above depth zero; the inset has to clear it, and it has to be
  // the same for every track, so the tallest requirement wins for all of them.
  const surfaceCount = assembly.items.filter((item) => item.topM <= 0 && item.bottomM <= 0).length;
  const frame = useMemo(() => ({ ...FRAME, top: Math.max(96, surfaceCount * 22 + 24) }), [surfaceCount]);
  const trackHeight = Math.max(MIN_TRACK_PX, height - HEAD_PX - TOOLBAR_PX);

  const windowM = link.window ?? ([0, totalDepthM] as const);
  const span = windowM[1] - windowM[0];
  const zoomed = link.window !== null && span < totalDepthM - 1e-6;
  /**
   * Zoom is a change of the shared depth window, so the log preview, the 3D scene and every other
   * linked view follow it; the anchor stays where it was on screen, like a map. Zooming out past
   * the whole well clears the window rather than clamping it, which is what "whole well" means
   * to every other consumer of the link.
   */
  const zoomBy = (factor: number, anchorMdM?: number) => {
    const next = Math.min(totalDepthM, Math.max(MIN_SPAN_M, span * factor));
    if (next >= totalDepthM) { link.setWindow(null); return; }
    const pivot = anchorMdM ?? link.cursorMdM ?? link.pinnedMdM ?? windowM[0] + span / 2;
    const ratio = Math.min(1, Math.max(0, (pivot - windowM[0]) / span));
    const start = Math.min(Math.max(0, pivot - ratio * next), totalDepthM - next);
    link.setWindow([start, start + next]);
  };
  const bridge = depthBridge(link);
  const log = useLas(logUrl);
  const y = linearScale([windowM[0], windowM[1]], [frame.top, trackHeight - frame.bottom]);
  const cursorY = link.cursorMdM === null || link.cursorMdM < windowM[0] || link.cursorMdM > windowM[1] ? null : y(link.cursorMdM);

  const shoes = useMemo(() => components
    .filter((component) => component.kind === "Casing")
    .map((component) => ({ mdM: component.bottomDepthM, depthFt: component.rawBottomDepthFt ?? metresToFeet(component.bottomDepthM), label: `${component.name.split(" / ").pop()?.trim()} shoe` })), [components]);
  const runs = useMemo(() => (operations?.runs ?? [])
    .filter((run) => run.topFt !== null && run.baseFt !== null && run.baseFt > run.topFt)
    .map((run) => ({ id: run.id, label: `${run.id} · ${run.kind}`, topFt: run.topFt as number, baseFt: run.baseFt as number, tone: run.outcome === "completed" ? "neutral" as const : run.outcome })), [operations]);
  const selected = components.find((component) => component.id === selectedId);
  const highlightIntervals = useMemo(() => highlights
    .filter((band) => Number.isFinite(band.topM) && Number.isFinite(band.baseM) && band.baseM > band.topM)
    .map((band) => ({ id: band.id, label: band.label, topFt: metresToFeet(band.topM), baseFt: metresToFeet(band.baseM), tone: band.tone ?? "neutral" as const })), [highlights]);

  // Bands across the whole section, the way a well-section zone is drawn: a translucent fill over
  // every track between two depths, labelled once at its top edge. The ruler repeats them opaque
  // so the scale reads on its own. Clipped to the window; an interval outside it is not drawn.
  const bands = highlights
    .filter((band) => Number.isFinite(band.topM) && Number.isFinite(band.baseM) && band.baseM > band.topM && band.baseM > windowM[0] && band.topM < windowM[1])
    .map((band) => { const top = y(Math.max(windowM[0], band.topM)); const base = y(Math.min(windowM[1], band.baseM)); return { ...band, top, height: Math.max(1, base - top) }; });

  // Ctrl/⌘ + wheel zooms about the depth under the pointer; a plain wheel scrolls the strip when
  // it is taller than its box and pans the window when it is not. The schematic track keeps its
  // own wheel handling, which does the same two things, so its events are left alone.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (event.target instanceof Element && event.target.closest(".sw-asm-schematic")) return;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const rect = rulerSvg.current?.getBoundingClientRect();
        const plot = trackHeight - frame.top - frame.bottom;
        const anchor = rect ? windowM[0] + ((event.clientY - rect.top - frame.top) / plot) * span : undefined;
        zoomBy(Math.exp(event.deltaY * 0.004), anchor);
      } else if (zoomed && element.scrollHeight <= element.clientHeight + 1) {
        const start = Math.min(Math.max(0, windowM[0] + event.deltaY * span / 900), totalDepthM - span);
        if (start !== windowM[0]) { event.preventDefault(); link.setWindow([start, start + span]); }
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  });

  const trackToggles: { id: TrackId; label: string; available: boolean }[] = [
    { id: "construction", label: "Construction", available: true },
    { id: "log", label: "Mud log", available: !!logUrl },
    { id: "survey", label: "Survey", available: survey.length > 1 },
  ];
  const ticks = niceTicks(windowM, Math.max(4, Math.round(trackHeight / 70)));
  return <div ref={host} className="demo-section" data-testid="well-section" data-window={`${Math.round(windowM[0])},${Math.round(windowM[1])}`}>
    <div className="demo-section-toolbar" role="toolbar" aria-label="Section tools">
      <div className="demo-section-zoom" role="group" aria-label="Depth window">
        <CommandButton kind="selection" icon="zoomIn" aria-label="Zoom in section" onClick={() => zoomBy(ZOOM_STEP)} disabled={span <= MIN_SPAN_M + 1e-6} />
        <CommandButton kind="selection" icon="zoomOut" aria-label="Zoom out section" onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={!zoomed} />
        <CommandButton kind="selection" icon="fit" aria-label="Fit whole well in section" onClick={() => link.setWindow(null)} disabled={!zoomed} />
        <span className="demo-section-window">{fmtM(windowM[0])}–{fmtM(windowM[1])} m MD{zoomed ? "" : " · whole well"} · ⌘/Ctrl + wheel to zoom</span>
      </div>
      <div className="demo-section-toggles" role="group" aria-label="Tracks">
        {trackToggles.filter((track) => track.available).map((track) => <CommandButton key={track.id} kind="selection" aria-label={`${track.label} track`} aria-pressed={shown[track.id]} onClick={() => setShown((current) => ({ ...current, [track.id]: !current[track.id] }))}>{track.label}</CommandButton>)}
      </div>
    </div>
    <div ref={scroller} className="demo-section-scroll">
    <div className="demo-section-strip">
    {bands.length > 0 && <div className="demo-section-bands" aria-hidden="true">
      {bands.map((band) => <div key={band.id} className="demo-section-band" data-highlight={band.id} data-focused={band.focused || undefined} style={{ top: HEAD_PX + band.top, height: band.height }}><span>{band.label}</span></div>)}
    </div>}
    <div className="demo-section-track demo-section-ruler" aria-hidden="true">
      <div className="demo-track-head"><span>MD</span><small>m</small></div>
      <svg ref={rulerSvg} width={56} height={trackHeight} viewBox={`0 0 56 ${trackHeight}`}>
        {bands.map((band) => <rect key={band.id} className="demo-ruler-band" data-highlight={band.id} data-focused={band.focused || undefined} x={0} y={band.top} width={56} height={band.height}><title>{band.label}</title></rect>)}
        {ticks.map((tick) => <g key={tick}><line x1={44} x2={56} y1={y(tick)} y2={y(tick)} className="demo-ruler-tick" /><text x={40} y={y(tick) + 3} textAnchor="end" className="demo-ruler-label">{tick.toLocaleString("en-US")}</text></g>)}
        {cursorY !== null && <g className="demo-ruler-cursor" data-cursor-md={Math.round(link.cursorMdM!)}><line x1={0} x2={56} y1={cursorY} y2={cursorY} /><rect x={2} y={cursorY - 17} width={44} height={14} rx={3} /><text x={24} y={cursorY - 6} textAnchor="middle">{Math.round(link.cursorMdM!).toLocaleString("en-US")}</text></g>}
      </svg>
    </div>

    {shown.construction && <div className="demo-section-track demo-section-construction">
      <div className="demo-track-head"><span>Construction</span><small>{components.length} records</small></div>
      <div className="demo-track-body" style={{ height: trackHeight }}>
        <AssemblySchematic assembly={assembly} survey={stations} formations={showFormations ? formations : undefined} assetBaseUrl="/well-components"
          selectedId={selectedId} onSelect={onSelect} frame={frame}
          depthWindow={link.window} onDepthWindowChange={link.setWindow} cursorDepthM={link.cursorMdM} onCursorDepthChange={link.setCursorMdM} />
      </div>
    </div>}

    {logUrl && shown.log && <div className="demo-section-track demo-section-log">
      <div className="demo-track-head"><span>Mud log</span><small>{log.loaded ? "ROP · WOB · 10 ft means · ft" : log.status === "error" ? "unavailable" : "loading"}</small></div>
      <div className="demo-track-body" style={{ height: trackHeight }}>
        {log.loaded
          ? <LogTracks las={log.loaded.las} tracks={logTracks} markers={shoes} intervals={[...runs, ...highlightIntervals]} height={trackHeight} frame={frame}
              selectedRange={bridge.rangeOf(selected)} cursorFt={bridge.cursorFt}
              depthWindowFt={[metresToFeet(windowM[0]), metresToFeet(windowM[1])]} onDepthWindowChange={bridge.setWindowFt}
              onCursorChange={bridge.setCursorFt} onSelectDepth={(depthFt) => bridge.pinFt(depthFt)} title="Mud log" />
          : <p className="demo-track-empty" role="status">{log.status === "error" ? `Mud log could not be loaded (${log.error}).` : "Loading mud log…"}</p>}
      </div>
    </div>}

    {survey.length > 1 && shown.survey && <div className="demo-section-track demo-section-survey">
      <div className="demo-track-head"><span>Survey</span><small>{survey.length} stations · inc / azi / DLS</small></div>
      <div className="demo-track-body" style={{ height: trackHeight }}>
        <TrajectoryLog survey={survey} height={trackHeight} frame={frame} domainMdM={windowM} mdWindow={null}
          selectedMdM={link.pinnedMdM} onSelectMd={onSelectMd} cursorMdM={link.cursorMdM} onCursorMdChange={link.setCursorMdM}
          markers={[...shoes.map(({ mdM, label }) => ({ mdM, label })), ...markers]} dlsLimitDegPer30m={dlsLimitDegPer30m} />
      </div>
    </div>}
    </div>
    </div>
  </div>;
}
