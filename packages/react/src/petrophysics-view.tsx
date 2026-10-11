"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { scaleLinear } from "d3-scale";
import { petrophysicsValueAt } from "@ikhmalputra/subsurface-core/contracts";
import type { PetrophysicsLogCurve, PetrophysicsTrackSpec, PetrophysicsWell } from "@ikhmalputra/subsurface-core/contracts";
import { AccessibleTable, getAccessibleRowsPage } from "./accessible-table.js";

export interface PetrophysicsLogViewProps {
  readonly well: PetrophysicsWell;
  readonly tracks: readonly PetrophysicsTrackSpec[];
  readonly selectedMdM?: number | null;
  readonly cursorMdM?: number | null;
  readonly onSelectMd?: (mdM: number) => void;
  readonly onCursorMdChange?: (mdM: number | null) => void;
  readonly depthRangeMdM?: readonly [number, number] | null;
  readonly onBrushChange?: (range: readonly [number, number] | null) => void;
  readonly height?: number;
  readonly title?: string;
}

const fmt = (value: number, digits = 1) => value.toLocaleString("en-US", { maximumFractionDigits: digits });

function nearestSample(curve: PetrophysicsLogCurve, mdM: number) {
  let low = 0, high = curve.depthsMdM.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (curve.depthsMdM[middle]! < mdM) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return 0;
  if (low >= curve.depthsMdM.length) return curve.depthsMdM.length - 1;
  return mdM - curve.depthsMdM[low - 1]! <= curve.depthsMdM[low]! - mdM ? low - 1 : low;
}

function curveGeometry(curve: PetrophysicsLogCurve, spec: PetrophysicsTrackSpec, x: (value: number) => number, y: (mdM: number) => number, depthRange: readonly [number, number], left: number, right: number): ReactNode[] {
  const segments: ReactNode[] = [];
  let points: string[] = [];
  const flush = () => {
    if (points.length > 1) {
      const first = points[0]!.split(",");
      const last = points.at(-1)!.split(",");
      if (spec.fill && spec.fill !== "none") {
        const fillX = spec.fill === "left" ? left : right;
        segments.push(<path key={`fill-${segments.length}`} d={`${points.join(" ")} L${fillX},${last[1]} L${fillX},${first[1]} Z`} className="sw-petro-fill" style={{ fill: spec.color }} />);
      }
      segments.push(<path key={`curve-${segments.length}`} d={points.join(" ")} className="sw-petro-curve" style={{ stroke: spec.color }} />);
    }
    points = [];
  };
  for (let index = 0; index < curve.depthsMdM.length; index++) {
    const mdM = curve.depthsMdM[index]!;
    const value = petrophysicsValueAt(curve, index);
    if (mdM < depthRange[0] || mdM > depthRange[1] || value === null) { flush(); continue; }
    points.push(`${x(value).toFixed(2)},${y(mdM).toFixed(2)}`);
  }
  flush();
  if (spec.cutoff) {
    for (let index = 1; index < curve.depthsMdM.length; index++) {
      const a = petrophysicsValueAt(curve, index - 1), b = petrophysicsValueAt(curve, index);
      const mdA = curve.depthsMdM[index - 1]!, mdB = curve.depthsMdM[index]!;
      if (a === null || b === null || mdB < depthRange[0] || mdA > depthRange[1]) continue;
      const hitA = spec.cutoff.side === "above" ? a >= spec.cutoff.value : a <= spec.cutoff.value;
      const hitB = spec.cutoff.side === "above" ? b >= spec.cutoff.value : b <= spec.cutoff.value;
      if (hitA || hitB) segments.push(<line key={`cutoff-${index}`} x1={x(a)} y1={y(mdA)} x2={x(b)} y2={y(mdB)} className="sw-petro-cutoff" style={{ stroke: spec.cutoff.color }} />);
    }
  }
  return segments;
}

export function PetrophysicsLogView({
  well,
  tracks,
  selectedMdM = null,
  cursorMdM = null,
  onSelectMd,
  onCursorMdChange,
  depthRangeMdM = null,
  onBrushChange,
  height = 560,
  title = "Petrophysics log",
}: PetrophysicsLogViewProps) {
  const svg = useRef<SVGSVGElement>(null);
  const brushStart = useRef<number | null>(null);
  const [keyboardMdM, setKeyboardMdM] = useState<number | null>(null);
  const clipId = useId();
  const curves = new Map(well.curves.map((curve) => [curve.id, curve]));
  const resolved = tracks.map((spec) => {
    const curve = curves.get(spec.curveId);
    if (!spec.curveId.trim()) throw new TypeError("Petrophysics track curveId must be non-empty.");
    if (!curve) throw new TypeError(`Petrophysics track references unknown curve: ${spec.curveId}`);
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(spec.color)) throw new TypeError(`Petrophysics track ${spec.curveId} requires a CSS hex color.`);
    if (!Number.isFinite(spec.min) || !Number.isFinite(spec.max) || spec.max <= spec.min) throw new RangeError(`Petrophysics track ${spec.curveId} requires a finite min < max domain.`);
    if (spec.fill !== undefined && spec.fill !== "none" && spec.fill !== "left" && spec.fill !== "right") throw new TypeError(`Petrophysics track ${spec.curveId} has an invalid fill direction.`);
    if (spec.cutoff) {
      if (!spec.cutoff.id.trim() || !spec.cutoff.label.trim()) throw new TypeError(`Petrophysics track ${spec.curveId} cutoff requires an ID and label.`);
      if (!Number.isFinite(spec.cutoff.value)) throw new RangeError(`Petrophysics track ${spec.curveId} cutoff must be finite.`);
      if (spec.cutoff.side !== "above" && spec.cutoff.side !== "below") throw new TypeError(`Petrophysics track ${spec.curveId} cutoff side must be above or below.`);
      if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(spec.cutoff.color)) throw new TypeError(`Petrophysics track ${spec.curveId} cutoff requires a CSS hex color.`);
    }
    return { spec, curve };
  });
  if (resolved.length === 0) throw new RangeError("PetrophysicsLogView requires at least one configured track.");
  const suppliedDepths = resolved.flatMap(({ curve }) => curve.depthsMdM.length ? [curve.depthsMdM[0]!, curve.depthsMdM.at(-1)!] : []);
  const minMdM = Math.min(...suppliedDepths, ...well.zones.map((zone) => zone.topMdM), ...well.tops.map((top) => top.mdM), ...well.corePoints.map((point) => point.mdM));
  const maxMdM = Math.max(...suppliedDepths, ...well.zones.map((zone) => zone.baseMdM), ...well.tops.map((top) => top.mdM), ...well.corePoints.map((point) => point.mdM));
  if (!Number.isFinite(minMdM) || !Number.isFinite(maxMdM)) throw new RangeError("PetrophysicsLogView requires at least one depth sample or annotation.");
  const top = 42, bottom = height - 32, axisWidth = 76, zoneWidth = 130, coreWidth = 44, trackWidth = 138;
  const width = axisWidth + zoneWidth + coreWidth + resolved.length * trackWidth + 18;
  const y = scaleLinear().domain(minMdM === maxMdM ? [minMdM, minMdM + 1] : [minMdM, maxMdM]).range([top, bottom]);
  const plotLeft = axisWidth + zoneWidth + coreWidth;
  const plotRight = width - 8;
  const visibleRange = depthRangeMdM ? [Math.max(minMdM, Math.min(...depthRangeMdM)), Math.min(maxMdM, Math.max(...depthRangeMdM))] as const : null;
  const selectedY = selectedMdM == null ? null : y(selectedMdM);
  const cursor = cursorMdM ?? keyboardMdM;
  const pointerDepth = (event: PointerEvent<SVGSVGElement>) => {
    if (!svg.current) return null;
    const matrix = svg.current.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return Math.max(minMdM, Math.min(maxMdM, y.invert(point.y)));
  };
  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    const mdM = pointerDepth(event);
    if (mdM === null) return;
    brushStart.current = mdM;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerUp(event: PointerEvent<SVGSVGElement>) {
    const start = brushStart.current;
    brushStart.current = null;
    if (start === null) return;
    const end = pointerDepth(event);
    if (end === null) return;
    if (Math.abs(end - start) >= Math.max(0.5, (maxMdM - minMdM) / Math.max(1, height - top - (height - bottom)))) {
      onBrushChange?.([Math.min(start, end), Math.max(start, end)]);
    } else onSelectMd?.(end);
  }
  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    const anchor = cursor ?? selectedMdM ?? minMdM;
    const stationDepths = resolved[0]?.curve.depthsMdM;
    if (!stationDepths?.length) return;
    const index = nearestSample(resolved[0]!.curve, anchor);
    const step = event.shiftKey ? 10 : 1;
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? stationDepths.length - 1
      : event.key === "ArrowDown" ? Math.min(stationDepths.length - 1, index + step)
        : event.key === "ArrowUp" ? Math.max(0, index - step) : -1;
    if (nextIndex >= 0) {
      event.preventDefault();
      const next = stationDepths[nextIndex]!;
      setKeyboardMdM(next);
      onCursorMdChange?.(next);
    } else if (event.key === "Enter" && cursor !== null) {
      event.preventDefault();
      onSelectMd?.(cursor);
    } else if (event.key === "Escape") {
      setKeyboardMdM(null);
      onCursorMdChange?.(null);
      onBrushChange?.(null);
    }
  }
  const tableRows = resolved.reduce((count, item) => count + item.curve.values.length, 0);

  return <figure className="sw-petro" data-testid="petrophysics-log" data-well-id={well.wellId} data-depth-datum={well.depthReference.datum}>
    <figcaption><strong>{title}</strong><span>{resolved.length} tracks · MD / m · datum {well.depthReference.datum}{well.provenance === "synthetic" ? " · SYNTHETIC" : ""}</span></figcaption>
    {well.provenance === "synthetic" && <p className="sw-petro-notice" role="note">Synthetic petrophysics data for visualization testing only; it is not measured well data or interpretation.</p>}
    <div className="sw-petro-scroll">
      <svg
        ref={svg}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        tabIndex={0}
        aria-label={`${title}. Measured depth in metres, datum ${well.depthReference.datum}. Arrow keys move the depth cursor; Enter selects; drag vertically to brush a depth interval.`}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerMove={(event) => { const mdM = pointerDepth(event); if (mdM !== null) onCursorMdChange?.(mdM); }}
        onPointerLeave={() => onCursorMdChange?.(null)}
      >
        <defs><clipPath id={clipId}><rect x={axisWidth} y={top} width={width - axisWidth - 8} height={bottom - top} /></clipPath></defs>
        <rect x="0" y="0" width={width} height={height} className="sw-petro-background" />
        <text x={axisWidth - 8} y={top - 17} textAnchor="end" className="sw-petro-label">MD / m</text>
        {y.ticks(10).map((tick) => <g key={`depth-${tick}`}><line x1={axisWidth} x2={plotRight} y1={y(tick)} y2={y(tick)} className="sw-petro-grid" /><text x={axisWidth - 8} y={y(tick) + 4} textAnchor="end" className="sw-petro-axis">{fmt(tick, 0)}</text></g>)}
        <g clipPath={`url(#${clipId})`}>
          {well.zones.map((zone) => {
            const yTop = Math.max(top, y(zone.topMdM)), yBase = Math.min(bottom, y(zone.baseMdM));
            return yBase <= yTop ? null : <g key={zone.id}>
              <rect x={axisWidth} y={yTop} width={plotRight - axisWidth} height={yBase - yTop} fill={zone.color} fillOpacity="0.22" />
              <text x={axisWidth + 8} y={Math.min(yBase - 3, yTop + 14)} className="sw-petro-zone">{zone.name} · {zone.lithology}</text>
            </g>;
          })}
          {visibleRange && visibleRange[1] > visibleRange[0] && <rect x={axisWidth} y={y(visibleRange[0])} width={plotRight - axisWidth} height={y(visibleRange[1]) - y(visibleRange[0])} className="sw-petro-brush" data-testid="petrophysics-brush" />}
          {well.tops.map((formationTop) => <g key={formationTop.id}><line x1={axisWidth} x2={plotRight} y1={y(formationTop.mdM)} y2={y(formationTop.mdM)} className="sw-petro-top" /><text x={plotRight - 5} y={y(formationTop.mdM) - 4} textAnchor="end" className="sw-petro-top-label">{formationTop.name}</text></g>)}
          {well.corePoints.map((point) => <g key={point.id} className="sw-petro-core" data-core-id={point.id}><path d={`M${plotLeft - 15},${y(point.mdM) - 6}L${plotLeft - 9},${y(point.mdM)}L${plotLeft - 15},${y(point.mdM) + 6}L${plotLeft - 21},${y(point.mdM)}Z`} /><title>{`${point.label} · MD ${fmt(point.mdM)} m${point.description ? ` · ${point.description}` : ""}`}</title></g>)}
          {resolved.map(({ curve, spec }, index) => {
            const left = plotLeft + index * trackWidth, right = left + trackWidth - 10;
            const x = scaleLinear().domain([spec.min, spec.max]).range([left + 5, right - 5]);
            const depthDomain = y.domain();
            const geometry = curveGeometry(curve, spec, x, y, [depthDomain[0]!, depthDomain[1]!], left + 5, right - 5);
            return <g key={curve.id} data-curve-id={curve.id}>
              <rect x={left} y={top} width={trackWidth - 10} height={bottom - top} className="sw-petro-track" />
              <text x={left + 4} y={top - 19} className="sw-petro-label">{spec.label ?? curve.mnemonic}</text>
              <text x={left + 4} y={top - 5} className="sw-petro-axis">{fmt(spec.min)}–{fmt(spec.max)} {curve.unit}</text>
              {geometry}
              {spec.cutoff && <text x={left + 4} y={bottom + 20} className="sw-petro-cutoff-label">{spec.cutoff.label}: {spec.cutoff.side} {fmt(spec.cutoff.value)} {curve.unit}</text>}
            </g>;
          })}
          {selectedY !== null && <line x1={axisWidth} x2={plotRight} y1={selectedY} y2={selectedY} className="sw-petro-selected" data-testid="petrophysics-selected-depth" />}
          {cursor !== null && <g className="sw-petro-cursor" data-testid="petrophysics-cursor"><line x1={axisWidth} x2={plotRight} y1={y(cursor)} y2={y(cursor)} /><text x={axisWidth - 8} y={y(cursor) - 5} textAnchor="end">{fmt(cursor)} m</text></g>}
        </g>
        <text x={axisWidth + 6} y={height - 5} className="sw-petro-key"><tspan className="sw-petro-top-key">—</tspan> formation top <tspan className="sw-petro-core-key">◆</tspan> core point</text>
      </svg>
    </div>
    <div className="sw-petro-readout" aria-live="polite" data-testid="petrophysics-readout">
      {cursor === null ? <span>Use ↑/↓, Home/End, or drag to brush a depth interval; press Enter to select a depth.</span> : <><strong>MD {fmt(cursor)} m</strong>{resolved.map(({ curve }) => { const sample = nearestSample(curve, cursor); const value = petrophysicsValueAt(curve, sample); return <span key={curve.id}>{curve.mnemonic}: {value === null ? "not reported" : `${fmt(value, 3)} ${curve.unit}`}</span>; })}</>}
    </div>
    <footer className="sw-petro-legend">
      {well.zones.map((zone) => <span key={zone.id}><i style={{ background: zone.color }} />{zone.name} · {zone.lithology}</span>)}
      {well.tops.map((formationTop) => <span key={formationTop.id} className="sw-petro-top-key">{formationTop.name}</span>)}
      {well.corePoints.map((point) => <span key={point.id} className="sw-petro-core-key">{point.label} · {fmt(point.mdM)} m</span>)}
      {resolved.map(({ curve, spec }) => spec.cutoff && <span key={curve.id} className="sw-petro-cutoff-key"><i style={{ background: spec.cutoff.color }} />{spec.cutoff.label} ({spec.cutoff.side} {fmt(spec.cutoff.value)} {curve.unit})</span>)}
    </footer>
    {well.corePoints.some((point) => point.measurements !== undefined) && <table className="sw-petro-core-table" data-testid="petrophysics-core-measurements">
      <caption>Supplied core measurements · values are not inferred from logs</caption>
      <thead><tr><th scope="col">Core point</th><th scope="col">MD (m)</th><th scope="col">Measurement</th><th scope="col">Value</th><th scope="col">Unit</th></tr></thead>
      <tbody>{well.corePoints.flatMap((point) => (point.measurements?.length
        ? point.measurements.map((measurement) => <tr key={`${point.id}-${measurement.id}`}><th scope="row">{point.label}</th><td>{fmt(point.mdM)}</td><td>{measurement.mnemonic}</td><td>{measurement.value === null ? "not reported" : fmt(measurement.value, 6)}</td><td>{measurement.unit}</td></tr>)
        : point.measurements ? [<tr key={`${point.id}-empty`}><th scope="row">{point.label}</th><td>{fmt(point.mdM)}</td><td colSpan={3}>No measurements supplied</td></tr>] : []))}</tbody>
    </table>}
    <AccessibleTable
      label={`${well.wellId} petrophysics samples`}
      description={`Raw supplied samples in measured depth metres referenced to ${well.depthReference.datum}. Null policies and sentinels display as not reported; no values are interpolated.`}
      columns={[{ label: "Curve" }, { label: "Mnemonic" }, { label: "MD", unit: "m" }, { label: "Value" }, { label: "Unit" }]}
      rowCount={tableRows}
      getRows={(start, end) => {
        const groups = resolved.map(({ curve }) => ({
          rowCount: curve.values.length,
          getRow: (index: number) => [curve.name, curve.mnemonic, curve.depthsMdM[index]!, petrophysicsValueAt(curve, index), curve.unit],
        }));
        return getAccessibleRowsPage(groups, start, end);
      }}
    />
  </figure>;
}
