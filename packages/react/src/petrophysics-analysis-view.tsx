"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { scaleLinear, scaleLog } from "d3-scale";
import {
  flattenPetrophysicsWells,
  pairPetrophysicsCurves,
  petrophysicsHistogram,
  petrophysicsHistogramDepthRange,
  petrophysicsValueAt,
  summarizePetrophysicsZones,
} from "@ikhmalputra/subsurface-core/contracts";
import type {
  ArchieWaterSaturationCalculation,
  SchlumbergerMNCrossplot,
  PetrophysicsLogCurve,
  PetrophysicsTrackSpec,
  PetrophysicsWell,
  PetrophysicsZoneSummaryRule,
} from "@ikhmalputra/subsurface-core/contracts";
import { AccessibleTable } from "./accessible-table.js";
import { CommandButton } from "./ui.js";

const fmt = (value: number, digits = 3) => value.toLocaleString("en-US", { maximumFractionDigits: digits });

export interface PetrophysicsCrossplotProps {
  readonly xCurve: PetrophysicsLogCurve;
  readonly yCurve: PetrophysicsLogCurve;
  readonly depthRangeMdM?: readonly [number, number] | null;
  readonly onBrushChange?: (range: readonly [number, number] | null) => void;
  readonly onSelectMd?: (mdM: number) => void;
  readonly title?: string;
  /** Axis ranges, data units; a reversed pair reverses the axis (density is read top-down, say). Default: the data's extent. */
  readonly xDomain?: readonly [number, number];
  readonly yDomain?: readonly [number, number];
  /** A colour per sample, by MD, e.g. by computed water saturation. */
  readonly pointColor?: (mdM: number) => string | undefined;
  /** Drawn beneath the samples in the plot's scales, e.g. lithology lines on a density–neutron chart. */
  readonly overlay?: (scale: { readonly x: (value: number) => number; readonly y: (value: number) => number }) => ReactNode;
  /** Draw only the samples inside `depthRangeMdM`, and at most this many of them (evenly thinned). */
  readonly onlyInRange?: boolean;
  readonly maxPoints?: number;
  /** "log" for a curve read on a logarithmic grid, such as resistivity; samples at or below zero are left out. */
  readonly xScale?: "linear" | "log";
  readonly yScale?: "linear" | "log";
  /** Draw at the size the plot is given (its svg sized by the page) rather than a fixed 410 × 250 that scales, text and all. */
  readonly fill?: boolean;
}

export function PetrophysicsCrossplot({ xCurve, yCurve, depthRangeMdM = null, onBrushChange, onSelectMd, title, xDomain: xFixed, yDomain: yFixed, pointColor, overlay, onlyInRange = false, maxPoints = Infinity, xScale = "linear", yScale = "linear", fill = false }: PetrophysicsCrossplotProps) {
  if (xCurve.wellId !== yCurve.wellId) throw new TypeError("Petrophysics crossplot curves must belong to the same well.");
  const svg = useRef<SVGSVGElement>(null);
  const start = useRef<readonly [number, number] | null>(null);
  const [keyboardIndex, setKeyboardIndex] = useState<number | null>(null);
  const [size, setSize] = useState<{ readonly w: number; readonly h: number } | null>(null);
  useEffect(() => {
    const element = svg.current;
    if (!fill || !element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => { const box = entry?.contentRect; if (box && box.width > 80 && box.height > 80) setSize({ w: Math.round(box.width), h: Math.round(box.height) }); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fill]);
  const W = fill && size ? size.w : 410, H = fill && size ? size.h : 250;
  const points = pairPetrophysicsCurves(xCurve, yCurve).filter((point) => (xScale !== "log" || point.x > 0) && (yScale !== "log" || point.y > 0));
  const isInDepthRange = (mdM: number) => depthRangeMdM === null || (mdM >= depthRangeMdM[0] && mdM <= depthRangeMdM[1]);
  const visible = depthRangeMdM
    ? points.filter((point) => point.mdM >= depthRangeMdM[0] && point.mdM <= depthRangeMdM[1])
    : points;
  const xExtent = points.reduce((extent, point) => [Math.min(extent[0], point.x), Math.max(extent[1], point.x)] as const, [Infinity, -Infinity] as const);
  const yExtent = points.reduce((extent, point) => [Math.min(extent[0], point.y), Math.max(extent[1], point.y)] as const, [Infinity, -Infinity] as const);
  const xDomain = xFixed ?? (!points.length ? [0, 1] as const : xExtent[0] === xExtent[1] ? [xExtent[0] - 0.5, xExtent[1] + 0.5] as const : xExtent);
  const yDomain = yFixed ?? (!points.length ? [0, 1] as const : yExtent[0] === yExtent[1] ? [yExtent[0] - 0.5, yExtent[1] + 0.5] as const : yExtent);
  const drawn = (() => {
    const shown = onlyInRange ? visible : points;
    if (shown.length <= maxPoints) return shown;
    const stride = Math.ceil(shown.length / maxPoints);
    return shown.filter((_, index) => index % stride === 0);
  })();
  const left = 54, right = W - 34, top = 18, bottom = H - 34;
  const x = (xScale === "log" ? scaleLog() : scaleLinear()).domain(xDomain).range([left, right]);
  const y = (yScale === "log" ? scaleLog() : scaleLinear()).domain(yDomain).range([bottom, top]);
  // With fixed axes a sample can fall outside them: it is drawn hollow on the frame, not dropped.
  const plotX = (value: number) => Math.min(right, Math.max(left, x(value)));
  const plotY = (value: number) => Math.min(bottom, Math.max(top, y(value)));
  const outside = (point: { readonly x: number; readonly y: number }) => x(point.x) < left || x(point.x) > right || y(point.y) < top || y(point.y) > bottom;
  const offScale = (xFixed || yFixed) ? drawn.filter(outside).length : 0;
  const pointAt = (event: PointerEvent<SVGSVGElement>) => {
    if (!svg.current) return null;
    const matrix = svg.current.getScreenCTM();
    if (!matrix) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return [p.x, p.y] as const;
  };
  const handleDown = (event: PointerEvent<SVGSVGElement>) => {
    start.current = pointAt(event);
    if (start.current) event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handleUp = (event: PointerEvent<SVGSVGElement>) => {
    const from = start.current;
    start.current = null;
    const to = pointAt(event);
    if (!from || !to) return;
    const selected = visible.filter((point) => {
      const px = plotX(point.x), py = plotY(point.y);
      return px >= Math.min(from[0], to[0]) && px <= Math.max(from[0], to[0])
        && py >= Math.min(from[1], to[1]) && py <= Math.max(from[1], to[1]);
    });
    if (selected.length > 0) {
      const range = selected.reduce((bounds, point) => [Math.min(bounds[0], point.mdM), Math.max(bounds[1], point.mdM)] as const, [Infinity, -Infinity] as const);
      onBrushChange?.(range);
    }
  };
  const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (points.length === 0) return;
    const current = keyboardIndex ?? 0;
    if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
      setKeyboardIndex(Math.max(0, Math.min(points.length - 1, current + direction)));
    } else if (event.key === "Home") {
      event.preventDefault();
      setKeyboardIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setKeyboardIndex(points.length - 1);
    } else if (event.key === "Enter" && keyboardIndex !== null) {
      event.preventDefault();
      onSelectMd?.(points[keyboardIndex]!.mdM);
    }
  };
  const label = title ?? `${yCurve.mnemonic} versus ${xCurve.mnemonic}`;
  return <section className="sw-petro-analysis" data-testid="petrophysics-crossplot">
    <h2>{label}</h2>
    <p>Exact shared MD keys only; no resampling. Drag a rectangle over points to link their measured-depth extent.</p>
    <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="group" tabIndex={0} aria-label={`${label}. X ${xCurve.mnemonic} in ${xCurve.unit}; Y ${yCurve.mnemonic} in ${yCurve.unit}. Exact-MD sample pairs only; arrow keys browse, Enter selects one sample, or drag to brush.`} onPointerDown={handleDown} onPointerUp={handleUp} onKeyDown={handleKeyDown}>
      <rect x={left} y={top} width={right - left} height={bottom - top} className="sw-petro-analysis-plot" />
      <line x1={left} x2={right} y1={bottom} y2={bottom} className="sw-petro-analysis-axis" />
      <line x1={left} x2={left} y1={top} y2={bottom} className="sw-petro-analysis-axis" />
      {(xFixed || yFixed) && <g className="sw-petro-analysis-ticks" aria-hidden="true">
        {x.ticks(xScale === "log" ? 4 : 5).filter((tick, index, all) => xScale !== "log" || all.length < 8 || Math.log10(tick) % 1 === 0).map((tick) => <text key={`x${tick}`} x={x(tick)} y={bottom + 13} textAnchor="middle">{fmt(tick, 2)}</text>)}
        {y.ticks(yScale === "log" ? 4 : 5).filter((tick, index, all) => yScale !== "log" || all.length < 8 || Math.log10(tick) % 1 === 0).map((tick) => <text key={`y${tick}`} x={left - 5} y={y(tick) + 3} textAnchor="end">{fmt(tick, 2)}</text>)}
      </g>}
      {overlay && <g className="sw-petro-analysis-overlay" pointerEvents="none">{overlay({ x: (value) => x(value), y: (value) => y(value) })}</g>}
      {drawn.map((point) => { const focused = keyboardIndex !== null && points[keyboardIndex] === point; const colour = pointColor?.(point.mdM); const off = outside(point); return <circle key={point.mdM} cx={plotX(point.x)} cy={plotY(point.y)} r={focused ? 6 : isInDepthRange(point.mdM) ? 3 : 2} className={focused ? "sw-petro-analysis-point-keyboard" : off ? "sw-petro-analysis-point-off" : isInDepthRange(point.mdM) ? "sw-petro-analysis-point" : "sw-petro-analysis-point-muted"} style={colour && !focused ? (off ? { stroke: colour } : { fill: colour }) : undefined} onClick={onSelectMd ? () => onSelectMd(point.mdM) : undefined}><title>{`MD ${fmt(point.mdM, 1)} m · ${xCurve.mnemonic} ${fmt(point.x)} ${xCurve.unit} · ${yCurve.mnemonic} ${fmt(point.y)} ${yCurve.unit}`}</title></circle>; })}
      <text x={(left + right) / 2} y={H - 7} textAnchor="middle">{xCurve.mnemonic} ({xCurve.unit})</text>
      <text x="12" y={(top + bottom) / 2} transform={`rotate(-90 12 ${(top + bottom) / 2})`} textAnchor="middle">{yCurve.mnemonic} ({yCurve.unit})</text>
    </svg>
    <p role="status">{visible.length} of {points.length} paired samples in linked depth range{offScale ? ` · ${offScale} beyond the axes, drawn hollow on the frame` : ""}</p>
    <AccessibleTable
      label={`${label} paired samples`}
      description="Only samples with exactly equal measured-depth keys are paired. Missing samples and unmatched depths are not interpolated."
      columns={[{ label: "MD", unit: "m" }, { label: xCurve.mnemonic, unit: xCurve.unit }, { label: yCurve.mnemonic, unit: yCurve.unit }]}
      rowCount={points.length}
      getRows={(from, to) => points.slice(from, to).map((point) => [point.mdM, point.x, point.y])}
    />
  </section>;
}

export interface PetrophysicsHistogramProps {
  readonly curve: PetrophysicsLogCurve;
  readonly binCount?: number;
  readonly onBrushChange?: (range: readonly [number, number] | null) => void;
  readonly onSelectMd?: (mdM: number) => void;
}

export function PetrophysicsHistogram({ curve, binCount = 12, onBrushChange, onSelectMd }: PetrophysicsHistogramProps) {
  const histogram = petrophysicsHistogram(curve, binCount);
  const maxCount = Math.max(1, ...histogram.bins.map((bin) => bin.count));
  const width = 360, height = 190, left = 36, right = 346, top = 12, bottom = 150;
  const selectBin = (binIndex: number) => {
    const range = petrophysicsHistogramDepthRange(curve, histogram, binIndex);
    if (!range) return;
    if (range[0] === range[1]) onSelectMd?.(range[0]);
    else onBrushChange?.(range);
  };
  return <section className="sw-petro-analysis" data-testid="petrophysics-histogram">
    <h2>{curve.mnemonic} distribution</h2>
    <p>Click a bin to link the depth interval of the supplied samples in that value bin. Nulls are excluded.</p>
    {!histogram.bins.length
      ? <p role="status">No reported samples to histogram.</p>
      : <>
        <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${curve.mnemonic} histogram in ${curve.unit}; ${histogram.bins.length} bins`}>
          <line x1={left} x2={right} y1={bottom} y2={bottom} className="sw-petro-analysis-axis" />
          {histogram.bins.map((bin, index) => {
            const barWidth = (right - left) / histogram.bins.length - 2;
            const barHeight = (bottom - top) * bin.count / maxCount;
            return <rect key={index} x={left + index * (right - left) / histogram.bins.length + 1} y={bottom - barHeight} width={Math.max(1, barWidth)} height={barHeight} className="sw-petro-histogram-bar" role="button" tabIndex={0} aria-label={`${bin.count} samples from ${fmt(bin.lower)} to ${fmt(bin.upper)} ${curve.unit}`} onClick={() => selectBin(index)} onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                selectBin(index);
              }
            }}><title>{`${bin.count} samples · ${fmt(bin.lower)}–${fmt(bin.upper)} ${curve.unit}`}</title></rect>;
          })}
          <text x={(left + right) / 2} y={height - 8} textAnchor="middle">{curve.mnemonic} ({curve.unit})</text>
        </svg>
        <div className="sw-petro-histogram-keys">{histogram.bins.map((bin, index) => <CommandButton kind="selection" type="button" key={index} onClick={() => selectBin(index)}>{fmt(bin.lower)}–{fmt(bin.upper)}: {bin.count}</CommandButton>)}</div>
      </>}
  </section>;
}

export interface PetrophysicsZoneSummaryViewProps {
  readonly well: PetrophysicsWell;
  readonly rule: PetrophysicsZoneSummaryRule;
}

export function PetrophysicsZoneSummaryView({ well, rule }: PetrophysicsZoneSummaryViewProps) {
  const curve = well.curves.find((candidate) => candidate.id === rule.curveId);
  if (!curve) throw new TypeError(`Zone summary references unknown curve "${rule.curveId}".`);
  const summaries = summarizePetrophysicsZones(well.zones, curve, rule);
  const zones = new Map(well.zones.map((zone) => [zone.id, zone]));
  return <section className="sw-petro-analysis" data-testid="petrophysics-zone-summary">
    <h2>Zone sample summary</h2>
    <p>Mean = sum(reported samples within [top, base)) / reported sample count. Net-to-gross is qualifying sampled interval thickness / gross sampled interval thickness; only adjacent reported samples no farther apart than {fmt(rule.maxSampleGapM, 1)} m are counted. No interpolation is used.</p>
    <table>
      <caption>{curve.mnemonic} threshold summary; {rule.side} {fmt(rule.cutoff)} {curve.unit}</caption>
      <thead><tr><th scope="col">Zone</th><th scope="col">Samples</th><th scope="col">Mean ({curve.unit})</th><th scope="col">Gross sampled (m)</th><th scope="col">Net sampled (m)</th><th scope="col">Net / gross</th></tr></thead>
      <tbody>{summaries.map((summary) => <tr key={summary.zoneId}>
        <th scope="row">{zones.get(summary.zoneId)?.name ?? "not reported"}</th>
        <td>{summary.reportedSampleCount} / {summary.sampleCount}</td>
        <td>{summary.mean === null ? "not reported" : fmt(summary.mean)}</td>
        <td>{fmt(summary.grossSampledThicknessM, 1)}</td>
        <td>{fmt(summary.netSampledThicknessM, 1)}</td>
        <td>{summary.netToGross === null ? "not reported" : `${fmt(summary.netToGross * 100, 1)}%`}</td>
      </tr>)}</tbody>
    </table>
  </section>;
}

export interface PetrophysicsCalculationReportProps {
  readonly archie: ArchieWaterSaturationCalculation;
  readonly mn: SchlumbergerMNCrossplot;
}

export function PetrophysicsCalculationReport({ archie, mn }: PetrophysicsCalculationReportProps) {
  const counts = (points: readonly { readonly quality: string }[]) => points.reduce<Record<string, number>>((result, point) => {
    result[point.quality] = (result[point.quality] ?? 0) + 1;
    return result;
  }, {});
  const archieCounts = counts(archie.points);
  const mnCounts = counts(mn.points);
  return <section className="sw-petro-analysis" data-testid="petrophysics-calculations">
    <h2>Calculated petrophysics · supplied parameters</h2>
    <h3>Archie water saturation</h3>
    <p><code>{archie.formula}</code></p>
    <p>Inputs: porosity <code>{archie.inputCurveIds.porosity}</code> (v/v), Rt <code>{archie.inputCurveIds.resistivity}</code> (ohm.m). Parameters: a={fmt(archie.parameters.a)}, m={fmt(archie.parameters.m)}, n={fmt(archie.parameters.n)}, Rw={fmt(archie.parameters.rwAtFormationTemperatureOhmM)} ohm.m (caller must temperature-correct Rw).</p>
    <p>Sample quality: {Object.entries(archieCounts).map(([quality, count]) => `${quality}: ${count}`).join(" · ") || "no samples"}. Sw above 1 is retained and flagged, never clamped.</p>
    <AccessibleTable
      label="Archie water saturation calculation"
      description="Per-sample Archie Sw output in fraction with explicit quality and reason. Input arrays are paired at exact MD keys; gaps are not interpolated."
      columns={[{ label: "MD", unit: "m" }, { label: "Sw", unit: "fraction" }, { label: "Quality" }, { label: "Reason" }]}
      rowCount={archie.points.length}
      getRows={(start, end) => archie.points.slice(start, end).map((point) => [point.mdM, point.value, point.quality, point.reason])}
    />
    <h3>Schlumberger M–N coordinates</h3>
    <p><code>{mn.formula}</code></p>
    <p>Inputs: neutron <code>{mn.inputCurveIds.neutronPorosity}</code> (v/v), bulk density <code>{mn.inputCurveIds.bulkDensity}</code> (g/cm3), sonic <code>{mn.inputCurveIds.sonicSlowness}</code> (us/ft). Matrix/fluid: density {fmt(mn.parameters.matrixDensityGPerCm3)} / {fmt(mn.parameters.fluidDensityGPerCm3)} g/cm3; slowness {fmt(mn.parameters.matrixSlownessUsPerFt)} / {fmt(mn.parameters.fluidSlownessUsPerFt)} us/ft; fluid neutron {fmt(mn.parameters.fluidNeutronPorosity ?? 1)} v/v. Only the fluid values enter M and N; the declared matrix plots at M {fmt(mn.matrixPoint.m)}, N {fmt(mn.matrixPoint.n)}.</p>
    <p>Sample quality: {Object.entries(mnCounts).map(([quality, count]) => `${quality}: ${count}`).join(" · ") || "no samples"}. Coordinates are calculated transforms, not lithology classifications.</p>
    <AccessibleTable
      label="Schlumberger M-N calculation"
      description="Per-sample dimensionless M and N values, with invalid and unknown samples identified. All input curves are matched at exact MD keys."
      columns={[{ label: "MD", unit: "m" }, { label: "M", unit: "dimensionless" }, { label: "N", unit: "dimensionless" }, { label: "Quality" }, { label: "Reason" }]}
      rowCount={mn.points.length}
      getRows={(start, end) => mn.points.slice(start, end).map((point) => [point.mdM, point.m, point.n, point.quality, point.reason])}
    />
  </section>;
}

export interface PetrophysicsFlattenViewProps {
  readonly wells: readonly PetrophysicsWell[];
  readonly markerId: string;
}

export function PetrophysicsFlattenView({ wells, markerId }: PetrophysicsFlattenViewProps) {
  const flattened = flattenPetrophysicsWells(wells, markerId);
  let min = Infinity, max = -Infinity;
  for (const well of flattened) for (const curve of well.curves) for (const relative of curve.relativeDepthsM) {
    min = Math.min(min, relative);
    max = Math.max(max, relative);
  }
  const x = scaleLinear().domain(min === max ? [min - 1, max + 1] : [min, max]).range([24, 576]);
  return <section className="sw-petro-analysis" data-testid="petrophysics-flatten">
    <h2>Marker-flattened wells · {markerId}</h2>
    <p>Display-only relative MD = supplied MD − explicitly tied marker MD. Source depth and value columns are unchanged; no marker or sample is inferred.</p>
    <svg viewBox="0 0 600 100" role="img" aria-label={`Relative measured depths for ${flattened.length} wells flattened on ${markerId}`}>
      <line x1={24} x2={576} y1={50} y2={50} className="sw-petro-analysis-axis" />
      <text x={24} y={20}>{fmt(min, 1)} m</text><text x={576} y={20} textAnchor="end">{fmt(max, 1)} m</text>
      {flattened.map((well, index) => {
        const y = 38 + index * 24;
        return <g key={well.well.wellId} data-flattened-well={well.well.wellId}>
          <text x={8} y={y + 4} textAnchor="end">{well.well.wellId}</text>
          <line x1={x(0)} x2={x(0)} y1={y - 8} y2={y + 8} className="sw-petro-flatten-marker" />
          {well.curves.flatMap(({ curve: sourceCurve, relativeDepthsM }) => Array.from(relativeDepthsM, (relative, sample) => petrophysicsValueAt(sourceCurve, sample) === null ? null : <circle key={`${sourceCurve.id}-${sample}`} cx={x(relative)} cy={y} r={3} className="sw-petro-analysis-point"><title>{`${well.well.wellId} · ${sourceCurve.mnemonic} · relative MD ${fmt(relative, 1)} m`}</title></circle>))}
          <title>{`${well.well.wellId} marker at source MD ${fmt(well.markerMdM, 1)} m`}</title>
        </g>;
      })}
      <text x={300} y={94} textAnchor="middle">Relative measured depth (m)</text>
    </svg>
    <table><caption>Source marker ties and derived display offsets</caption><thead><tr><th scope="col">Well</th><th scope="col">Marker</th><th scope="col">Source marker MD (m)</th><th scope="col">Samples</th></tr></thead>
      <tbody>{flattened.map((well) => <tr key={well.well.wellId}><th scope="row">{well.well.wellId}</th><td>{well.markerId}</td><td>{fmt(well.markerMdM, 1)}</td><td>{well.curves.reduce((count, item) => count + item.curve.values.length, 0)}</td></tr>)}</tbody>
    </table>
  </section>;
}

export interface PetrophysicsTemplateSelectProps {
  readonly templates: readonly { readonly id: string; readonly name: string; readonly tracks: readonly PetrophysicsTrackSpec[] }[];
  readonly value: string;
  readonly onChange: (templateId: string) => void;
}

export function PetrophysicsTemplateSelect({ templates, value, onChange }: PetrophysicsTemplateSelectProps) {
  return <label className="sw-petro-template">Track template
    <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
      {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
    </select>
  </label>;
}
