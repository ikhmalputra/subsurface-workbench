"use client";

import { InfoTip } from "./info-tip.js";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject, MouseEvent as ReactMouseEvent } from "react";
import { scaleLinear } from "d3-scale";
import type { BuildHoldInput, BuildHoldPlan, BuildHoldTarget, ComputedStation, FormationLayer, SurveyStationInput, TrajectoryIssue, TrajectorySummary } from "@ikhmalputra/subsurface-core";
import { AccessibleTable } from "./accessible-table.js";
import { CommandButton } from "./ui.js";

/**
 * Trajectory engineering views. Every view takes stations computed by
 * `computeMinimumCurvature` from `@ikhmalputra/subsurface-core`, shares a selected MD,
 * and can be used on its own. Plan and section views are drawn at true scale
 * (equal metres per pixel on both axes), so angles on screen are real angles.
 */

export interface TrajectoryMarker { readonly mdM: number; readonly label: string }

export interface TrajectoryPlotProps {
  readonly survey: readonly ComputedStation[];
  readonly selectedMdM?: number | null;
  readonly onSelectMd?: (mdM: number) => void;
  /** Optional target; drag it (or focus it and use the arrow keys) to emit `onTargetChange`. */
  readonly target?: BuildHoldTarget | null;
  readonly targetInvalid?: boolean;
  readonly onTargetChange?: (target: BuildHoldTarget) => void;
  /** Fired when a drag or key nudge ends, e.g. to rebuild an expensive 3D scene once. */
  readonly onTargetCommit?: () => void;
  readonly dlsLimitDegPer30m?: number;
  readonly markers?: readonly TrajectoryMarker[];
  readonly height?: number;
}

const PATH = "#147a65";
const OVER = "#c62828";
const SELECT = "#ff6a00";
const TARGET = "#2f5fb3";

const metres = (value: number, digits = 1) => value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const degrees = (value: number, digits = 2) => `${value.toFixed(digits)}°`;

interface Frame {
  readonly x: (value: number) => number;
  readonly y: (value: number) => number;
  readonly invertX: (pixel: number) => number;
  readonly invertY: (pixel: number) => number;
  readonly xTicks: readonly number[];
  readonly yTicks: readonly number[];
  readonly scale: number;
}

function trueScaleFrame(xs: readonly number[], ys: readonly number[], box: { left: number; top: number; width: number; height: number }, minimumSpan = 100): Frame {
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const spanX = Math.max(x1 - x0, minimumSpan);
  const spanY = Math.max(y1 - y0, minimumSpan);
  const scale = Math.min(box.width / (spanX * 1.12), box.height / (spanY * 1.12));
  const centerX = (x0 + x1) / 2;
  const centerY = (y0 + y1) / 2;
  const screenX = box.left + box.width / 2;
  const screenY = box.top + box.height / 2;
  const visibleX = [centerX - box.width / 2 / scale, centerX + box.width / 2 / scale];
  const visibleY = [centerY - box.height / 2 / scale, centerY + box.height / 2 / scale];
  return {
    x: (value) => screenX + (value - centerX) * scale,
    y: (value) => screenY + (value - centerY) * scale,
    invertX: (pixel) => centerX + (pixel - screenX) / scale,
    invertY: (pixel) => centerY + (pixel - screenY) / scale,
    xTicks: scaleLinear().domain(visibleX).ticks(Math.max(3, Math.round(box.width / 90))),
    yTicks: scaleLinear().domain(visibleY).ticks(Math.max(3, Math.round(box.height / 70))),
    scale,
  };
}

function svgPoint(event: { clientX: number; clientY: number }, svg: SVGSVGElement) {
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

/** Nearest MD on the drawn polyline to a screen point, interpolated along the closest segment. */
function nearestMd(points: readonly { x: number; y: number; mdM: number }[], x: number, y: number) {
  let best = { distance: Infinity, mdM: points[0]?.mdM ?? 0 };
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / length));
    const distance = Math.hypot(a.x + t * dx - x, a.y + t * dy - y);
    if (distance < best.distance) best = { distance, mdM: a.mdM + t * (b.mdM - a.mdM) };
  }
  return best;
}

function pointAtMd<T extends { mdM: number }>(points: readonly (T & { x: number; y: number })[], mdM: number) {
  const index = points.findIndex((point) => point.mdM >= mdM);
  if (index <= 0) return points[Math.max(0, index)] ?? null;
  const a = points[index - 1]!;
  const b = points[index]!;
  const t = (mdM - a.mdM) / (b.mdM - a.mdM || 1);
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

function useTargetDrag(svg: RefObject<SVGSVGElement | null>, live: Frame, toTarget: (frame: Frame, x: number, y: number) => BuildHoldTarget | null, onChange?: (target: BuildHoldTarget) => void, onCommit?: () => void) {
  // The frame is frozen while dragging so the axes do not rescale under the pointer.
  const [frozen, setFrozen] = useState<Frame | null>(null);
  const frame = frozen ?? live;
  const handlers = {
    onPointerDown(event: ReactPointerEvent<SVGGElement>) {
      if (!onChange) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setFrozen(live);
    },
    onPointerMove(event: ReactPointerEvent<SVGGElement>) {
      if (!frozen || !svg.current || !onChange) return;
      const point = svgPoint(event, svg.current);
      const next = toTarget(frozen, point.x, point.y);
      if (next) onChange(next);
    },
    onPointerUp(event: ReactPointerEvent<SVGGElement>) {
      if (!frozen) return;
      event.stopPropagation();
      setFrozen(null);
      onCommit?.();
    },
    onClick(event: ReactMouseEvent) { event.stopPropagation(); },
  };
  return { frame, dragging: !!frozen, handlers };
}

function nudge(event: ReactKeyboardEvent, apply: (dx: number, dy: number) => void, onCommit?: () => void) {
  const step = event.shiftKey ? 100 : 10;
  const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  const move = moves[event.key];
  if (!move) return;
  event.preventDefault();
  apply(move[0], move[1]);
  onCommit?.();
}

function Grid({ frame, box, xLabel, yLabel, formatX = (value: number) => value.toLocaleString("en-US"), formatY = (value: number) => value.toLocaleString("en-US") }: { frame: Frame; box: { left: number; top: number; width: number; height: number }; xLabel: string; yLabel: string; formatX?: (value: number) => string; formatY?: (value: number) => string }) {
  return <g className="sw-traj-grid" pointerEvents="none">
    {frame.xTicks.map((tick) => { const x = frame.x(tick); return x < box.left || x > box.left + box.width ? null : <g key={`x${tick}`}><line x1={x} x2={x} y1={box.top} y2={box.top + box.height} /><text x={x} y={box.top + box.height + 14} textAnchor="middle" className="sw-axis-value">{formatX(tick)}</text></g>; })}
    {frame.yTicks.map((tick) => { const y = frame.y(tick); return y < box.top || y > box.top + box.height ? null : <g key={`y${tick}`}><line x1={box.left} x2={box.left + box.width} y1={y} y2={y} /><text x={box.left - 6} y={y + 3} textAnchor="end" className="sw-axis-value">{formatY(tick)}</text></g>; })}
    <rect x={box.left} y={box.top} width={box.width} height={box.height} className="sw-traj-frame" />
    <text x={box.left + box.width} y={box.top + box.height + 28} textAnchor="end" className="sw-axis-title">{xLabel}</text>
    <text x={box.left} y={box.top - 8} className="sw-axis-title">{yLabel}</text>
  </g>;
}

function PathSegments({ points, survey, limit }: { points: readonly { x: number; y: number }[]; survey: readonly ComputedStation[]; limit?: number }) {
  const segments: ReactNode[] = [];
  for (let index = 1; index < points.length; index++) {
    const over = limit !== undefined && survey[index]!.dlsDegPer30m > limit + 1e-9;
    segments.push(<line key={index} x1={points[index - 1]!.x} y1={points[index - 1]!.y} x2={points[index]!.x} y2={points[index]!.y} stroke={over ? OVER : PATH} strokeWidth={over ? 4 : 3} strokeLinecap="round" />);
  }
  return <g pointerEvents="none"><polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#fff" strokeWidth="7" strokeLinejoin="round" />{segments}</g>;
}

function Markers({ points, markers }: { points: readonly { x: number; y: number; mdM: number }[]; markers?: readonly TrajectoryMarker[] }) {
  return <g pointerEvents="none">{markers?.map((marker) => { const point = pointAtMd(points, marker.mdM); return point && <g key={marker.label} className="sw-traj-marker"><circle cx={point.x} cy={point.y} r="4.5" /><text x={point.x + 8} y={point.y - 6}>{marker.label}</text></g>; })}</g>;
}

function SelectedMark({ points, mdM }: { points: readonly { x: number; y: number; mdM: number }[]; mdM?: number | null }) {
  if (mdM == null) return null;
  const point = pointAtMd(points, mdM);
  return point && <g pointerEvents="none" data-testid="traj-selected-mark"><circle cx={point.x} cy={point.y} r="10" fill="none" stroke={SELECT} strokeWidth="3" /><circle cx={point.x} cy={point.y} r="4" fill={SELECT} /></g>;
}

function TargetHandle({ x, y, invalid, label, interactive, handlers, onKeyDown }: { x: number; y: number; invalid?: boolean; label: string; interactive: boolean; handlers: ReturnType<typeof useTargetDrag>["handlers"]; onKeyDown: (event: ReactKeyboardEvent) => void }) {
  const color = invalid ? OVER : TARGET;
  return <g className="sw-traj-target" data-invalid={invalid || undefined} role={interactive ? "slider" : "img"} tabIndex={interactive ? 0 : undefined} aria-label={label} aria-valuetext={label} {...(interactive ? { ...handlers, onKeyDown } : {})} style={{ cursor: interactive ? "grab" : undefined }}>
    <circle cx={x} cy={y} r="16" fill="transparent" />
    <circle cx={x} cy={y} r="11" fill="#fff" stroke={color} strokeWidth="2.5" />
    <circle cx={x} cy={y} r="5" fill={color} />
    <line x1={x - 16} x2={x + 16} y1={y} y2={y} stroke={color} strokeWidth="1.5" />
    <line x1={x} x2={x} y1={y - 16} y2={y + 16} stroke={color} strokeWidth="1.5" />
  </g>;
}

/** Plan (top-down) view: easting to the right, northing up, true scale with a north arrow. */
export function TrajectoryPlanView({ survey, selectedMdM, onSelectMd, target, targetInvalid, onTargetChange, onTargetCommit, dlsLimitDegPer30m, markers, height = 340 }: TrajectoryPlotProps) {
  const svg = useRef<SVGSVGElement>(null);
  const width = 460;
  const box = { left: 58, top: 28, width: width - 78, height: height - 66 };
  const live = useMemo(() => trueScaleFrame([...survey.map((station) => station.eastingM), ...(target ? [target.eastingM] : [])], [...survey.map((station) => -station.northingM), ...(target ? [-target.northingM] : [])], box), [survey, target, height]);
  const { frame, handlers } = useTargetDrag(svg, live, (view, x, y) => target ? { ...target, eastingM: Math.round(view.invertX(x)), northingM: Math.round(-view.invertY(y)) } : null, onTargetChange, onTargetCommit);
  const points = survey.map((station) => ({ x: frame.x(station.eastingM), y: frame.y(-station.northingM), mdM: station.mdM }));
  const last = survey.at(-1);
  const maxDls = Math.max(0, ...survey.map((station) => station.dlsDegPer30m));
  return <figure className="sw-traj-plot" data-testid="trajectory-plan-view">
    <figcaption><strong className="sw-title">Plan view<InfoTip label="About the plan view">Map view from above: grid north up, true scale. Closure is the horizontal distance and bearing from the wellhead to the last station.</InfoTip></strong>{last && <span>closure {metres(last.closureDistanceM, 0)} m @ {degrees(last.closureAzimuthDeg, 1)}</span>}</figcaption>
    <svg ref={svg} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Plan view of the trajectory: easting against northing in metres" onClick={(event) => { if (!onSelectMd || !svg.current) return; const point = svgPoint(event, svg.current); const hit = nearestMd(points, point.x, point.y); if (hit.distance < 18) onSelectMd(hit.mdM); }}>
      <Grid frame={frame} box={box} xLabel="EASTING / m" yLabel="NORTHING / m" formatY={(value) => (-value).toLocaleString("en-US")} />
      <g transform={`translate(${box.left + box.width - 26} ${box.top + 30})`} className="sw-traj-north" pointerEvents="none"><path d="M0 -18 L7 6 L0 1 L-7 6 Z" /><text y="20" textAnchor="middle">N</text></g>
      <g pointerEvents="none" className="sw-traj-scale"><line x1={box.left + 12} x2={box.left + 12 + niceLength(frame.scale) * frame.scale} y1={box.top + box.height - 14} y2={box.top + box.height - 14} /><text x={box.left + 12} y={box.top + box.height - 20}>{niceLength(frame.scale).toLocaleString("en-US")} m</text></g>
      {target && <line x1={frame.x(0)} y1={frame.y(0)} x2={frame.x(target.eastingM)} y2={frame.y(-target.northingM)} className="sw-traj-aim" />}
      <PathSegments points={points} survey={survey} limit={dlsLimitDegPer30m} />
      <circle cx={frame.x(survey[0]?.eastingM ?? 0)} cy={frame.y(-(survey[0]?.northingM ?? 0))} r="5" className="sw-traj-wellhead" />
      <Markers points={points} markers={markers} />
      <SelectedMark points={points} mdM={selectedMdM} />
      {target && <TargetHandle x={frame.x(target.eastingM)} y={frame.y(-target.northingM)} invalid={targetInvalid} interactive={!!onTargetChange} handlers={handlers} label={`Target ${metres(target.northingM, 0)} m N, ${metres(target.eastingM, 0)} m E`} onKeyDown={(event) => nudge(event, (dx, dy) => onTargetChange?.({ ...target, eastingM: target.eastingM + dx, northingM: target.northingM - dy }), onTargetCommit)} />}
    </svg>
    <p className="sw-sr-only">{survey.length} supplied survey stations from {metres(survey[0]?.mdM ?? 0)} to {metres(last?.mdM ?? 0)} m measured depth; maximum dogleg severity {degrees(maxDls, 1)} per 30 m.</p>
    <AccessibleTable label="trajectory plan stations" description="Supplied computed trajectory stations in the declared metre coordinate frame." columns={[{ label: "MD", unit: "m" }, { label: "Northing", unit: "m" }, { label: "Easting", unit: "m" }, { label: "TVD", unit: "m" }, { label: "DLS", unit: "°/30 m" }]} rowCount={survey.length} getRows={(start, end) => survey.slice(start, end).map((station) => [station.mdM, station.northingM, station.eastingM, station.tvdM, station.dlsDegPer30m])} />
  </figure>;
}

function niceLength(scale: number) {
  const raw = 90 / scale;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit < 2 ? 1 : unit < 5 ? 2 : 5) * power;
}

/** Vertical section: horizontal departure projected on the section azimuth against TVD, true scale. */
export function TrajectorySectionView({ survey, selectedMdM, onSelectMd, target, targetInvalid, onTargetChange, onTargetCommit, dlsLimitDegPer30m, markers, height = 380, verticalSectionAzimuthDeg, formations }: TrajectoryPlotProps & { readonly verticalSectionAzimuthDeg: number; readonly formations?: readonly FormationLayer[] }) {
  const svg = useRef<SVGSVGElement>(null);
  const width = 640;
  const box = { left: 64, top: 28, width: width - 86, height: height - 66 };
  const sectionCos = Math.cos(verticalSectionAzimuthDeg * Math.PI / 180);
  const sectionSin = Math.sin(verticalSectionAzimuthDeg * Math.PI / 180);
  const sectionOf = (point: { northingM: number; eastingM: number }) => point.northingM * sectionCos + point.eastingM * sectionSin;
  const live = useMemo(() => trueScaleFrame([0, ...survey.map(sectionOf), ...(target ? [sectionOf(target)] : [])], [0, ...survey.map((station) => station.tvdM), ...(target ? [target.tvdM] : [])], box), [survey, target, verticalSectionAzimuthDeg, height]);
  const { frame, handlers } = useTargetDrag(svg, live, (view, x, y) => {
    if (!target) return null;
    const section = view.invertX(x);
    return { tvdM: Math.round(view.invertY(y)), northingM: Math.round(section * sectionCos), eastingM: Math.round(section * sectionSin) };
  }, onTargetChange, onTargetCommit);
  const points = survey.map((station) => ({ x: frame.x(sectionOf(station)), y: frame.y(station.tvdM), mdM: station.mdM }));
  const clip = useId();
  const maxDlsActual = Math.max(0, ...survey.map((station) => station.dlsDegPer30m));
  return <figure className="sw-traj-plot" data-testid="trajectory-section-view">
    <figcaption><strong className="sw-title">Vertical section<InfoTip label="About the vertical section">The path projected onto a vertical plane along the section azimuth: TVD below the depth reference against horizontal displacement, true scale.</InfoTip></strong><span>azimuth {degrees(verticalSectionAzimuthDeg, 1)}</span></figcaption>
    <svg ref={svg} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`Vertical section along azimuth ${verticalSectionAzimuthDeg.toFixed(1)} degrees: departure against true vertical depth`} onClick={(event) => { if (!onSelectMd || !svg.current) return; const point = svgPoint(event, svg.current); const hit = nearestMd(points, point.x, point.y); if (hit.distance < 18) onSelectMd(hit.mdM); }}>
      <clipPath id={clip}><rect x={box.left} y={box.top} width={box.width} height={box.height} /></clipPath>
      <g clipPath={`url(#${clip})`} pointerEvents="none">{formations?.map((layer) => { const top = Math.max(box.top, frame.y(layer.topTvdM)); const bottom = Math.min(box.top + box.height, frame.y(layer.bottomTvdM)); return bottom > top && <g key={layer.id}><rect x={box.left} y={top} width={box.width} height={bottom - top} fill={layer.color} opacity="0.55" /><text x={box.left + box.width - 8} y={top + 14} textAnchor="end" className="sw-traj-layer">{layer.name}</text></g>; })}</g>
      <Grid frame={frame} box={box} xLabel={`VERTICAL SECTION @ ${verticalSectionAzimuthDeg.toFixed(1)}° / m`} yLabel="TVD / m" />
      {target && <g pointerEvents="none" className="sw-traj-aim"><line x1={box.left} x2={box.left + box.width} y1={frame.y(target.tvdM)} y2={frame.y(target.tvdM)} /></g>}
      <PathSegments points={points} survey={survey} limit={dlsLimitDegPer30m} />
      <Markers points={points} markers={markers} />
      <SelectedMark points={points} mdM={selectedMdM} />
      {target && <TargetHandle x={frame.x(sectionOf(target))} y={frame.y(target.tvdM)} invalid={targetInvalid} interactive={!!onTargetChange} handlers={handlers} label={`Target ${metres(target.tvdM, 0)} m TVD, ${metres(sectionOf(target), 0)} m departure`} onKeyDown={(event) => nudge(event, (dx, dy) => { const section = sectionOf(target) + dx; onTargetChange?.({ tvdM: target.tvdM + dy, northingM: section * sectionCos, eastingM: section * sectionSin }); }, onTargetCommit)} />}
    </svg>
    <p className="sw-sr-only">{survey.length} supplied stations projected at azimuth {degrees(verticalSectionAzimuthDeg, 1)}. Measured depth and true vertical depth are in metres; maximum dogleg severity {degrees(maxDlsActual, 1)} per 30 m.</p>
    <AccessibleTable label="vertical section stations" description={`Supplied trajectory stations projected along azimuth ${degrees(verticalSectionAzimuthDeg, 1)}; no values are extrapolated.`} columns={[{ label: "MD", unit: "m" }, { label: "Section departure", unit: "m" }, { label: "TVD", unit: "m" }, { label: "DLS", unit: "°/30 m" }]} rowCount={survey.length} getRows={(start, end) => survey.slice(start, end).map((station) => [station.mdM, sectionOf(station), station.tvdM, station.dlsDegPer30m])} />
  </figure>;
}

/** Depth log of inclination, azimuth and dogleg severity against MD, with the DLS limit drawn. */
export interface TrajectoryLogProps extends Pick<TrajectoryPlotProps, "survey" | "selectedMdM" | "onSelectMd" | "dlsLimitDegPer30m" | "markers" | "height"> {
  /** Linked hover depth (e.g. `useDepthLink().cursorMdM`), drawn as a dashed line with values. */
  readonly cursorMdM?: number | null;
  /** Emits the MD under the pointer, null on leave. */
  readonly onCursorMdChange?: (mdM: number | null) => void;
  /** Linked MD window, shaded across the tracks. */
  readonly mdWindow?: readonly [number, number] | null;
}

/** Survey values at an MD, linearly interpolated between stations (DLS taken from the interval that contains it). */
function stationAt(survey: readonly ComputedStation[], mdM: number) {
  const index = survey.findIndex((station) => station.mdM >= mdM);
  if (index <= 0) { const station = survey[Math.max(0, index)] ?? survey.at(-1)!; return { mdM, inclinationDeg: station.inclinationDeg, azimuthDeg: station.azimuthDeg, dlsDegPer30m: station.dlsDegPer30m }; }
  const a = survey[index - 1]!, b = survey[index]!, t = (mdM - a.mdM) / Math.max(1e-9, b.mdM - a.mdM);
  let turn = b.azimuthDeg - a.azimuthDeg; if (turn > 180) turn -= 360; if (turn < -180) turn += 360;
  return { mdM, inclinationDeg: a.inclinationDeg + (b.inclinationDeg - a.inclinationDeg) * t, azimuthDeg: (a.azimuthDeg + turn * t + 360) % 360, dlsDegPer30m: b.dlsDegPer30m };
}

export function TrajectoryLog({ survey, selectedMdM, onSelectMd, dlsLimitDegPer30m, markers, height = 380, cursorMdM = null, onCursorMdChange, mdWindow = null }: TrajectoryLogProps) {
  const svg = useRef<SVGSVGElement>(null);
  const [keyboardMdM, setKeyboardMdM] = useState<number | null>(null);
  const width = 420;
  const top = 40;
  const bottom = height - 26;
  const tracks = [
    { key: "inc", title: "INC / °", left: 64, width: 108 },
    { key: "azi", title: "AZI / °", left: 182, width: 108 },
    { key: "dls", title: "DLS / °/30 m", left: 300, width: 108 },
  ] as const;
  const md = scaleLinear().domain([survey[0]?.mdM ?? 0, survey.at(-1)?.mdM ?? 1]).range([top, bottom]);
  const maxInc = Math.max(90, ...survey.map((station) => station.inclinationDeg));
  const maxDls = Math.max((dlsLimitDegPer30m ?? 0) * 1.4, 1, ...survey.map((station) => station.dlsDegPer30m)) * 1.05;
  const scales = { inc: scaleLinear().domain([0, maxInc]), azi: scaleLinear().domain([0, 360]), dls: scaleLinear().domain([0, maxDls]) };
  const x = (key: "inc" | "azi" | "dls", value: number) => { const track = tracks.find((item) => item.key === key)!; return track.left + scales[key].range([0, track.width])(value); };
  const curve = (key: "inc" | "azi") => survey.map((station) => `${x(key, key === "inc" ? station.inclinationDeg : station.azimuthDeg)},${md(station.mdM)}`).join(" ");
  const selectedY = selectedMdM == null ? null : md(selectedMdM);
  const inRange = (value: number | null) => value != null && value >= md.domain()[0]! && value <= md.domain()[1]!;
  const activeCursorMdM = cursorMdM ?? keyboardMdM;
  const cursor = inRange(activeCursorMdM) ? stationAt(survey, activeCursorMdM!) : null;
  const band = mdWindow ? [Math.max(md.domain()[0]!, Math.min(...mdWindow)), Math.min(md.domain()[1]!, Math.max(...mdWindow))] as const : null;
  const maxDlsActual = Math.max(0, ...survey.map((station) => station.dlsDegPer30m));
  const pointerMd = (event: ReactPointerEvent<SVGSVGElement>) => { if (!svg.current) return null; const point = svgPoint(event, svg.current); return point.y >= top && point.y <= bottom ? md.invert(point.y) : null; };
  function onKeyDown(event: ReactKeyboardEvent<SVGSVGElement>) {
    if (event.key === "Enter" && activeCursorMdM !== null) {
      event.preventDefault();
      onSelectMd?.(activeCursorMdM);
      return;
    }
    const direction = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    const currentIndex = survey.findIndex((station) => station.mdM >= (activeCursorMdM ?? selectedMdM ?? survey[0]?.mdM ?? 0));
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? survey.length - 1
      : direction ? Math.max(0, Math.min(survey.length - 1, (currentIndex < 0 ? 0 : currentIndex) + direction * (event.shiftKey ? 10 : 1))) : -1;
    if (nextIndex < 0 || !survey[nextIndex]) return;
    event.preventDefault();
    const nextMdM = survey[nextIndex]!.mdM;
    setKeyboardMdM(nextMdM);
    onCursorMdChange?.(nextMdM);
  }
  return <figure className="sw-traj-plot" data-testid="trajectory-log" data-cursor-md={cursor ? cursor.mdM.toFixed(1) : undefined}>
    <figcaption><strong className="sw-title">Survey log<InfoTip label="About the survey log">Inclination, azimuth and dogleg severity (DLS) against measured depth. DLS bars past the limit line are drawn red.</InfoTip></strong>{dlsLimitDegPer30m !== undefined && <span>DLS limit {dlsLimitDegPer30m}°/30 m</span>}</figcaption>
    <svg ref={svg} viewBox={`0 0 ${width} ${height}`} role="group" tabIndex={0} aria-label="Inclination, azimuth and dogleg severity against measured depth. Use arrow keys to move by station, Home and End for first and last, Enter to select." onKeyDown={onKeyDown} onClick={(event) => { if (!onSelectMd || !svg.current) return; const point = svgPoint(event, svg.current); if (point.y >= top && point.y <= bottom) onSelectMd(md.invert(point.y)); }} onPointerMove={onCursorMdChange ? (event) => onCursorMdChange(pointerMd(event)) : undefined} onPointerLeave={onCursorMdChange ? () => onCursorMdChange(null) : undefined}>
      <g className="sw-traj-grid" pointerEvents="none">
        {md.ticks(8).map((tick) => <g key={tick}><line x1={tracks[0].left} x2={tracks[2].left + tracks[2].width} y1={md(tick)} y2={md(tick)} /><text x={tracks[0].left - 6} y={md(tick) + 3} textAnchor="end" className="sw-axis-value">{tick.toLocaleString("en-US")}</text></g>)}
        {tracks.map((track) => <g key={track.key}><rect x={track.left} y={top} width={track.width} height={bottom - top} className="sw-traj-frame" /><text x={track.left} y={top - 22} className="sw-axis-title">{track.title}</text>{scales[track.key].range([0, track.width]).ticks(3).map((tick) => <text key={tick} x={x(track.key, tick)} y={top - 8} textAnchor="middle" className="sw-axis-value">{tick}</text>)}</g>)}
        <text x={tracks[0].left - 6} y={top - 22} textAnchor="end" className="sw-axis-title">MD / m</text>
      </g>
      {band && band[1] > band[0] && <rect x={tracks[0].left} y={md(band[0])} width={tracks[2].left + tracks[2].width - tracks[0].left} height={md(band[1]) - md(band[0])} fill="#1d4ed8" fillOpacity="0.1" pointerEvents="none" data-testid="traj-window" />}
      <polyline points={curve("inc")} fill="none" stroke={PATH} strokeWidth="2.5" pointerEvents="none" />
      <g pointerEvents="none">{survey.map((station) => <circle key={station.mdM} cx={x("azi", station.azimuthDeg)} cy={md(station.mdM)} r="1.6" fill="#4a6fb0" />)}</g>
      <g pointerEvents="none">{survey.slice(1).map((station, index) => { const over = dlsLimitDegPer30m !== undefined && station.dlsDegPer30m > dlsLimitDegPer30m + 1e-9; const y0 = md(survey[index]!.mdM); return <rect key={station.mdM} x={tracks[2].left} y={y0} width={Math.max(0.5, x("dls", station.dlsDegPer30m) - tracks[2].left)} height={Math.max(0.6, md(station.mdM) - y0)} fill={over ? OVER : "#7d9a8c"} />; })}</g>
      {dlsLimitDegPer30m !== undefined && <line x1={x("dls", dlsLimitDegPer30m)} x2={x("dls", dlsLimitDegPer30m)} y1={top} y2={bottom} stroke={OVER} strokeDasharray="4 3" strokeWidth="1.5" pointerEvents="none" />}
      <g pointerEvents="none">{markers?.map((marker) => <g key={marker.label} className="sw-traj-marker"><line x1={tracks[0].left} x2={tracks[2].left + tracks[2].width} y1={md(marker.mdM)} y2={md(marker.mdM)} /><text x={tracks[0].left + 4} y={md(marker.mdM) - 4}>{marker.label}</text></g>)}</g>
      {selectedY != null && <line x1={tracks[0].left - 4} x2={tracks[2].left + tracks[2].width + 4} y1={selectedY} y2={selectedY} stroke={SELECT} strokeWidth="2.5" pointerEvents="none" data-testid="traj-selected-mark" />}
      {cursor && <g pointerEvents="none" className="sw-traj-cursor" data-testid="traj-cursor"><line x1={tracks[0].left - 4} x2={tracks[2].left + tracks[2].width + 4} y1={md(cursor.mdM)} y2={md(cursor.mdM)} stroke="#1d4ed8" strokeWidth="1.5" strokeDasharray="5 3" /><text x={tracks[0].left - 6} y={md(cursor.mdM) + 3} textAnchor="end">{Math.round(cursor.mdM).toLocaleString("en-US")}</text>{tracks.map((track) => <text key={track.key} x={track.left + track.width - 3} y={md(cursor.mdM) - 4} textAnchor="end">{(track.key === "inc" ? cursor.inclinationDeg : track.key === "azi" ? cursor.azimuthDeg : cursor.dlsDegPer30m).toFixed(1)}</text>)}</g>}
    </svg>
    <p className="sw-sr-only">{survey.length} supplied trajectory stations from {metres(survey[0]?.mdM ?? 0)} to {metres(survey.at(-1)?.mdM ?? 0)} m measured depth; maximum dogleg severity {degrees(maxDlsActual, 1)} per 30 m.</p>
    <AccessibleTable label="trajectory survey log" description="Computed inclination, azimuth and dogleg severity at supplied measured-depth stations." columns={[{ label: "MD", unit: "m" }, { label: "Inclination", unit: "°" }, { label: "Azimuth", unit: "°" }, { label: "DLS", unit: "°/30 m" }]} rowCount={survey.length} getRows={(start, end) => survey.slice(start, end).map((station) => [station.mdM, station.inclinationDeg, station.azimuthDeg, station.dlsDegPer30m])} />
  </figure>;
}

/** Key results of a computed trajectory. */
export function TrajectorySummaryPanel({ summary, dlsLimitDegPer30m, footer }: { readonly summary: TrajectorySummary; readonly dlsLimitDegPer30m?: number; readonly footer?: ReactNode }) {
  const over = dlsLimitDegPer30m !== undefined && summary.maxDlsDegPer30m > dlsLimitDegPer30m + 1e-9;
  const items: [string, string, string?][] = [
    ["TD (MD)", `${metres(summary.totalDepthMdM)} m`],
    ["TD (TVD)", `${metres(summary.totalDepthTvdM)} m`],
    ["Closure", `${metres(summary.closureDistanceM)} m`, `@ ${degrees(summary.closureAzimuthDeg, 1)}`],
    ["Kickoff", summary.kickoffMdM == null ? "—" : `${metres(summary.kickoffMdM, 0)} m MD`],
    ["Max inclination", degrees(summary.maxInclinationDeg)],
    ["Max DLS", `${summary.maxDlsDegPer30m.toFixed(2)}°/30 m`, `at ${metres(summary.maxDlsMdM, 0)} m MD`],
  ];
  return <section className="sw-traj-summary" aria-label="Trajectory summary" data-testid="trajectory-summary">
    <dl>{items.map(([label, value, detail]) => <div key={label} data-over={label === "Max DLS" && over ? true : undefined}><dt>{label}</dt><dd>{value}{detail && <small>{detail}</small>}</dd></div>)}</dl>
    {footer}
  </section>;
}

function NumberCell({ value, onCommit, label, invalid, step = "any", digits = 2 }: { value: number; onCommit: (value: number) => void; label: string; invalid?: boolean; step?: string; digits?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const next = Number(draft);
    setDraft(null);
    if (draft.trim() !== "" && Number.isFinite(next) && next !== value) onCommit(next);
  };
  return <input type="number" inputMode="decimal" step={step} aria-label={label} aria-invalid={invalid || undefined} value={draft ?? Number(value.toFixed(digits))} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { commit(); (event.target as HTMLInputElement).blur(); } if (event.key === "Escape") setDraft(null); }} />;
}

export interface SurveyTableProps {
  readonly survey: readonly ComputedStation[];
  /** Pass `onChange` to make MD, inclination and azimuth editable; positions always come from the math. */
  readonly onChange?: (stations: readonly SurveyStationInput[]) => void;
  readonly issues?: readonly TrajectoryIssue[];
  readonly selectedMdM?: number | null;
  readonly onSelectMd?: (mdM: number) => void;
  readonly dlsLimitDegPer30m?: number;
  readonly maxHeight?: number;
}

/** Survey station table with minimum-curvature results; editable when `onChange` is given. */
export function SurveyTable({ survey, onChange, issues = [], selectedMdM, onSelectMd, dlsLimitDegPer30m, maxHeight = 420 }: SurveyTableProps) {
  const body = useRef<HTMLDivElement>(null);
  const editable = !!onChange;
  const stations = survey.map(({ mdM, inclinationDeg, azimuthDeg }) => ({ mdM, inclinationDeg, azimuthDeg }));
  let selectedIndex = -1;
  if (selectedMdM != null) {
    let best = Infinity;
    survey.forEach((station, index) => { const distance = Math.abs(station.mdM - selectedMdM); if (distance < best) { best = distance; selectedIndex = index; } });
  }
  useEffect(() => {
    const row = body.current?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    const container = body.current;
    if (!row || !container || container.contains(document.activeElement)) return;
    const top = row.offsetTop - container.clientHeight / 3;
    container.scrollTo({ top: Math.max(0, top) });
  }, [selectedIndex]);
  const update = (index: number, patch: Partial<SurveyStationInput>) => onChange?.(stations.map((station, position) => position === index ? { ...station, ...patch } : station));
  const insertAfter = (index: number) => {
    const current = stations[index]!;
    const next = stations[index + 1];
    const mdM = next ? (current.mdM + next.mdM) / 2 : current.mdM + 30;
    onChange?.([...stations.slice(0, index + 1), { mdM: Math.round(mdM * 100) / 100, inclinationDeg: next ? (current.inclinationDeg + next.inclinationDeg) / 2 : current.inclinationDeg, azimuthDeg: current.azimuthDeg }, ...stations.slice(index + 1)]);
  };
  const remove = (index: number) => { if (stations.length > 2 && index > 0) onChange?.(stations.filter((_, position) => position !== index)); };
  const issueFor = (index: number, field: TrajectoryIssue["field"]) => issues.find((issue) => issue.index === index && issue.field === field);
  return <div className="sw-traj-table" data-testid="survey-table" data-editable={editable || undefined}>
    <div className="sw-traj-table-scroll" ref={body} style={{ maxHeight }} tabIndex={0} role="region" aria-label="Survey stations">
      <table>
        <caption className="sw-sr-only">Survey stations with minimum-curvature positions</caption>
        <thead><tr><th scope="col">#</th><th scope="col">MD m</th><th scope="col">Inc °</th><th scope="col">Azi °</th><th scope="col">TVD m</th><th scope="col">N m</th><th scope="col">E m</th><th scope="col">VS m</th><th scope="col">DLS °/30 m</th>{editable && <th scope="col"><span className="sw-sr-only">Actions</span></th>}</tr></thead>
        <tbody>{survey.map((station, index) => {
          const over = dlsLimitDegPer30m !== undefined && station.dlsDegPer30m > dlsLimitDegPer30m + 1e-9;
          const rowIssue = issues.find((issue) => issue.index === index);
          return <tr key={index} data-index={index} aria-selected={index === selectedIndex} data-over={over || undefined} title={rowIssue?.message} onClick={() => onSelectMd?.(station.mdM)}>
            <th scope="row">{index + 1}</th>
            {editable ? <>
              <td><NumberCell label={`Station ${index + 1} measured depth`} value={station.mdM} invalid={!!issueFor(index, "mdM")} onCommit={(mdM) => update(index, { mdM })} /></td>
              <td><NumberCell label={`Station ${index + 1} inclination`} value={station.inclinationDeg} invalid={!!issueFor(index, "inclinationDeg")} onCommit={(inclinationDeg) => update(index, { inclinationDeg })} /></td>
              <td><NumberCell label={`Station ${index + 1} azimuth`} value={station.azimuthDeg} invalid={!!issueFor(index, "azimuthDeg")} onCommit={(azimuthDeg) => update(index, { azimuthDeg })} /></td>
            </> : <><td>{metres(station.mdM, 2)}</td><td>{station.inclinationDeg.toFixed(2)}</td><td>{station.azimuthDeg.toFixed(2)}</td></>}
            <td>{metres(station.tvdM, 2)}</td><td>{metres(station.northingM, 2)}</td><td>{metres(station.eastingM, 2)}</td><td>{metres(station.verticalSectionM, 2)}</td>
            <td className="sw-traj-dls">{index === 0 ? "—" : station.dlsDegPer30m.toFixed(2)}</td>
            {editable && <td className="sw-traj-actions"><CommandButton icon="add" type="button" aria-label={`Insert a station after ${index + 1}`} onClick={(event) => { event.stopPropagation(); insertAfter(index); }}></CommandButton><CommandButton icon="remove" type="button" aria-label={`Delete station ${index + 1}`} disabled={index === 0 || stations.length <= 2} onClick={(event) => { event.stopPropagation(); remove(index); }}></CommandButton></td>}
          </tr>;
        })}</tbody>
      </table>
    </div>
    {issues.length > 0 && <ul className="sw-traj-issues" aria-label="Survey issues">{issues.slice(0, 6).map((issue) => <li key={`${issue.index}-${issue.field}`} data-severity={issue.severity}><CommandButton kind="selection" type="button" onClick={() => { const station = survey[issue.index]; if (station) onSelectMd?.(station.mdM); }}>Station {issue.index + 1}</CommandButton> {issue.message}</li>)}{issues.length > 6 && <li>+{issues.length - 6} more</li>}</ul>}
  </div>;
}

export interface BuildHoldFormProps {
  readonly value: BuildHoldInput;
  readonly onChange: (value: BuildHoldInput) => void;
  readonly plan?: BuildHoldPlan | null;
  readonly error?: string | null;
}

/** Inputs for `planBuildHold` with the solved geometry beside them. */
export function BuildHoldForm({ value, onChange, plan, error }: BuildHoldFormProps) {
  const field = (label: string, unit: string, current: number, apply: (next: number) => BuildHoldInput, hint?: string) => <label className="sw-traj-field"><span>{label}<small>{unit}</small></span><NumberCell label={`${label} (${unit})`} value={current} onCommit={(next) => onChange(apply(next))} digits={2} />{hint && <em>{hint}</em>}</label>;
  return <section className="sw-traj-form" aria-label="Build and hold planner" data-testid="build-hold-form">
    <div className="sw-traj-fields">
      {field("Kickoff", "m MD", value.kickoffMdM, (kickoffMdM) => ({ ...value, kickoffMdM }), "vertical above")}
      {field("Build rate", "°/30 m", value.buildRateDegPer30m, (buildRateDegPer30m) => ({ ...value, buildRateDegPer30m }))}
      {field("Target TVD", "m", value.target.tvdM, (tvdM) => ({ ...value, target: { ...value.target, tvdM } }))}
      {field("Target north", "m", value.target.northingM, (northingM) => ({ ...value, target: { ...value.target, northingM } }))}
      {field("Target east", "m", value.target.eastingM, (eastingM) => ({ ...value, target: { ...value.target, eastingM } }))}
      {field("Drill past target", "m", value.extensionM ?? 0, (extensionM) => ({ ...value, extensionM }))}
    </div>
    {error ? <p className="sw-traj-error" role="alert">{error}</p> : plan && <dl className="sw-traj-solved" aria-label="Solved build and hold geometry">
      <div><dt>Hold inclination</dt><dd>{degrees(plan.holdInclinationDeg)}</dd></div>
      <div><dt>Azimuth</dt><dd>{degrees(plan.azimuthDeg)}</dd></div>
      <div><dt>Build radius</dt><dd>{metres(plan.radiusM, 0)} m</dd></div>
      <div><dt>End of build</dt><dd>{metres(plan.endOfBuildMdM, 0)} m MD · {metres(plan.endOfBuildTvdM, 0)} m TVD</dd></div>
      <div><dt>Hold length</dt><dd>{metres(plan.holdLengthM, 0)} m</dd></div>
      <div><dt>Target MD</dt><dd>{metres(plan.targetMdM, 1)} m</dd></div>
    </dl>}
  </section>;
}
