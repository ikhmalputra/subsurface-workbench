"use client";

import { useId, useMemo, type KeyboardEvent, type MouseEvent } from "react";
import type { SubsurfaceState } from "@ikhmalputra/subsurface-core/state";
import type { SubsurfaceWellLogCurve } from "@ikhmalputra/subsurface-core/contracts";
import { createSubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import type { SubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import { useSubsurfaceSelector } from "./state-hooks.js";
import { AccessibleTable, getAccessibleRowsPage } from "./accessible-table.js";

export interface CorrelationTop {
  /** Shared, stable identifier used to tie this top between wells. */
  readonly id: string;
  readonly label: string;
  readonly mdM: number;
}

export interface CorrelationLogTrack {
  readonly curve: SubsurfaceWellLogCurve;
  readonly label: string;
  readonly color: string;
  /** Explicit display limits; values outside the limits are clipped, never rescaled implicitly. */
  readonly domain: readonly [number, number];
}

export interface CorrelationWell {
  readonly id: string;
  readonly label: string;
  readonly provenance: "documented" | "synthetic" | "user-authored";
  readonly tracks: readonly CorrelationLogTrack[];
  readonly tops: readonly CorrelationTop[];
}

export interface MultiWellCorrelationProps {
  readonly wells: readonly CorrelationWell[];
  readonly flattenOn?: string | null;
  readonly onFlattenOnChange?: (topId: string | null) => void;
  readonly store?: SubsurfaceStore;
  readonly height?: number;
  readonly maxPointsPerPixel?: number;
  readonly onSelectDepth?: (wellId: string, mdM: number) => void;
  readonly title?: string;
  /** Minimum rendered chart width; lower than the default fits more wells on desktop while retaining narrow-screen scrolling. */
  readonly minWidth?: number;
}

interface Sample {
  readonly mdM: number;
  readonly value: number | null;
}

const LEFT = 78;
const TRACK_WIDTH = 300;
const PLOT_LEFT = 48;
const PLOT_WIDTH = 236;
const TOP = 116;
const BOTTOM = 50;
const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

function isNullSample(curve: SubsurfaceWellLogCurve, value: number): boolean {
  return Number.isNaN(value)
    ? curve.nullValue === "nan"
    : curve.nullValue === null ? false : value === curve.nullValue;
}

function formatNumber(value: number): string {
  return numberFormat.format(value);
}

function trackEvidence(track: CorrelationLogTrack) {
  let validCount = 0;
  let nullCount = 0;
  let clippedCount = 0;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const value of track.curve.values) {
    if (isNullSample(track.curve, value)) {
      nullCount += 1;
      continue;
    }
    validCount += 1;
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
    if (value < track.domain[0] || value > track.domain[1]) clippedCount += 1;
  }
  return {
    validCount,
    nullCount,
    clippedCount,
    min: validCount ? min : null,
    max: validCount ? max : null,
    mean: validCount ? sum / validCount : null,
  };
}

/** Screen-bucket min/max decimation that keeps null samples as hard line breaks. */
export function decimateCorrelationSamples(
  curve: SubsurfaceWellLogCurve,
  relativeTopMdM: number,
  minRelativeMdM: number,
  maxRelativeMdM: number,
  pixelHeight: number,
  maxPointsPerPixel = 2,
): readonly Sample[] {
  if (!Number.isFinite(relativeTopMdM) || !Number.isFinite(minRelativeMdM) || !Number.isFinite(maxRelativeMdM)
    || maxRelativeMdM <= minRelativeMdM || !Number.isFinite(pixelHeight) || pixelHeight < 1
    || !Number.isSafeInteger(maxPointsPerPixel) || maxPointsPerPixel < 1) {
    throw new RangeError("Correlation decimation requires finite increasing depth bounds and positive pixel density.");
  }

  const bucketCount = Math.max(1, Math.floor(pixelHeight * maxPointsPerPixel));
  const selected = new Set<number>();
  const buckets = new Map<number, { first: number; last: number; min: number; max: number; minValue: number; maxValue: number }>();
  const gaps: number[] = [];

  for (let index = 0; index < curve.depthsMdM.length; index += 1) {
    const mdM = curve.depthsMdM[index]!;
    const relativeMdM = mdM - relativeTopMdM;
    if (relativeMdM < minRelativeMdM || relativeMdM > maxRelativeMdM) continue;
    const value = curve.values[index]!;
    if (isNullSample(curve, value)) {
      gaps.push(index);
      continue;
    }
    if (!Number.isFinite(value)) throw new TypeError(`Invalid non-finite sample at index ${index}; validate the log contract before rendering.`);
    const bucket = Math.min(bucketCount - 1, Math.floor((relativeMdM - minRelativeMdM) / (maxRelativeMdM - minRelativeMdM) * bucketCount));
    const current = buckets.get(bucket);
    if (!current) {
      buckets.set(bucket, { first: index, last: index, min: index, max: index, minValue: value, maxValue: value });
      continue;
    }
    current.last = index;
    if (value < current.minValue) { current.minValue = value; current.min = index; }
    if (value > current.maxValue) { current.maxValue = value; current.max = index; }
  }

  for (const bucket of buckets.values()) {
    selected.add(bucket.first);
    selected.add(bucket.min);
    selected.add(bucket.max);
    selected.add(bucket.last);
  }
  for (const index of gaps) selected.add(index);

  return [...selected].sort((a, b) => a - b).map((index) => {
    const value = curve.values[index]!;
    return { mdM: curve.depthsMdM[index]!, value: isNullSample(curve, value) ? null : value };
  });
}

function validWell(well: CorrelationWell): void {
  if (!well.id.trim() || !well.label.trim()) throw new TypeError("Correlation wells require non-empty IDs and labels.");
  const trackIds = new Set<string>();
  for (const track of well.tracks) {
    if (!track.curve.id.trim() || track.curve.wellId !== well.id) throw new TypeError(`Log "${track.curve.id}" does not belong to well "${well.id}".`);
    if (trackIds.has(track.curve.id)) throw new TypeError(`Duplicate log "${track.curve.id}" in well "${well.id}".`);
    trackIds.add(track.curve.id);
    if (!track.label.trim() || !/^#[\da-f]{6}$/i.test(track.color)) throw new TypeError(`Log "${track.curve.id}" needs a label and six-digit hex colour.`);
    if (track.domain.length !== 2 || !track.domain.every(Number.isFinite) || track.domain[1] <= track.domain[0] || !Number.isFinite(track.domain[1] - track.domain[0])) {
      throw new RangeError(`Log "${track.curve.id}" requires finite increasing display limits.`);
    }
  }
  const topIds = new Set<string>();
  for (const top of well.tops) {
    if (!top.id.trim() || !top.label.trim() || !Number.isFinite(top.mdM) || top.mdM < 0) throw new TypeError(`Well "${well.id}" has an invalid correlated top.`);
    if (topIds.has(top.id)) throw new TypeError(`Duplicate correlated top "${top.id}" in well "${well.id}".`);
    topIds.add(top.id);
  }
}

function cursorFromState(state: SubsurfaceState) {
  return { wellId: state.activeAsset.wellId, mdM: state.activeAsset.depth_md };
}

/** Side-by-side logs linked by explicit tops; MD values and original log columns are never altered. */
export function MultiWellCorrelation({
  wells,
  flattenOn = null,
  onFlattenOnChange,
  store,
  height = 900,
  maxPointsPerPixel = 2,
  onSelectDepth,
  title = "Multi-well correlation",
  minWidth,
}: MultiWellCorrelationProps) {
  const activeStore = useMemo(() => store ?? createSubsurfaceStore(), [store]);
  const cursor = useSubsurfaceSelector(activeStore, cursorFromState, (a, b) => a.wellId === b.wellId && a.mdM === b.mdM);
  const visibleCursor = store ? cursor : null;

  const topChoices = useMemo(() => {
    if (!wells.length) return [];
    const shared = new Map(wells[0]!.tops.map((top) => [top.id, top.label]));
    for (const well of wells.slice(1)) {
      const available = new Set(well.tops.map((top) => top.id));
      for (const id of shared.keys()) if (!available.has(id)) shared.delete(id);
    }
    return [...shared].map(([id, label]) => ({ id, label }));
  }, [wells]);

  const layout = useMemo(() => {
    for (const well of wells) validWell(well);
    if (!Number.isFinite(height) || height < 260) throw new RangeError("Correlation view height must be at least 260 pixels.");
    if (wells.length < 2) throw new RangeError("Multi-well correlation requires at least two wells.");
    if (new Set(wells.map((well) => well.id)).size !== wells.length) throw new TypeError("Correlation well IDs must be unique.");
    if (flattenOn && !topChoices.some((top) => top.id === flattenOn)) throw new TypeError(`Flatten marker "${flattenOn}" is not present in every well.`);

    const offsets = wells.map((well) => flattenOn ? well.tops.find((top) => top.id === flattenOn)!.mdM : 0);
    let minMd = Infinity, maxMd = -Infinity;
    wells.forEach((well, index) => {
      const offset = offsets[index]!;
      for (const track of well.tracks) {
        const depths = track.curve.depthsMdM;
        if (!depths.length) continue;
        minMd = Math.min(minMd, depths[0]! - offset);
        maxMd = Math.max(maxMd, depths[depths.length - 1]! - offset);
      }
      for (const top of well.tops) {
        minMd = Math.min(minMd, top.mdM - offset);
        maxMd = Math.max(maxMd, top.mdM - offset);
      }
    });
    if (!Number.isFinite(minMd) || !Number.isFinite(maxMd)) { minMd = 0; maxMd = 1; }
    if (maxMd <= minMd) maxMd = minMd + 1;
    const padding = Math.max((maxMd - minMd) * 0.025, 1);
    minMd -= padding;
    maxMd += padding;
    const plotTop = TOP, plotBottom = height - BOTTOM;
    const y = (md: number) => plotTop + (md - minMd) / (maxMd - minMd) * (plotBottom - plotTop);
    const mdAt = (pixel: number) => minMd + (pixel - plotTop) / (plotBottom - plotTop) * (maxMd - minMd);
    return { offsets, minMd, maxMd, plotTop, plotBottom, y, mdAt };
  }, [wells, flattenOn, topChoices, height]);
  const viewWidth = LEFT + wells.length * TRACK_WIDTH + 8;
  if (minWidth !== undefined && (!Number.isFinite(minWidth) || minWidth < 300)) throw new RangeError("Correlation minimum width must be at least 300 pixels.");

  const topIds = useMemo(() => [...new Set(wells.flatMap((well) => well.tops.map((top) => top.id)))], [wells]);
  const incompleteTops = useMemo(() => topIds.flatMap((id) => {
    const present = wells.filter((well) => well.tops.some((top) => top.id === id));
    if (present.length === wells.length) return [];
    const label = present[0]!.tops.find((top) => top.id === id)!.label;
    return [{ id, label, missing: wells.filter((well) => !well.tops.some((top) => top.id === id)).map((well) => well.label) }];
  }), [topIds, wells]);
  const tickValues = useMemo(() => {
    const count = Math.max(4, Math.min(11, Math.floor((layout.plotBottom - layout.plotTop) / 70) + 1));
    return Array.from({ length: count }, (_, index) => layout.minMd + (layout.maxMd - layout.minMd) * index / (count - 1));
  }, [layout]);
  const cursorRelativeMd = visibleCursor?.wellId && visibleCursor.mdM !== null
    ? (() => {
      const index = wells.findIndex((well) => well.id === visibleCursor.wellId);
      if (index < 0) return null;
      if (!flattenOn) return { mdM: visibleCursor.mdM, sourceWellId: visibleCursor.wellId, flatten: false };
      const top = wells[index]!.tops.find((item) => item.id === flattenOn);
      return top ? { mdM: visibleCursor.mdM! - top.mdM, sourceWellId: visibleCursor.wellId, flatten: true } : null;
    })()
    : null;

  const selectAt = (well: CorrelationWell, offset: number, event: MouseEvent<SVGRectElement>) => {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const bounds = svg.getBoundingClientRect();
    if (!bounds.height) return;
    const viewY = (event.clientY - bounds.top) / bounds.height * height;
    const relativeMdM = layout.mdAt(viewY);
    const mdM = relativeMdM + offset;
    if (!Number.isFinite(mdM) || mdM < 0) return;
    onSelectDepth?.(well.id, mdM);
    if (store) store.pinDepth(well.id, mdM, "multiwell-correlation");
  };

  const moveByKeyboard = (well: CorrelationWell, offset: number, event: KeyboardEvent<SVGRectElement>) => {
    const step = event.shiftKey ? 100 : Math.max(1, (layout.maxMd - layout.minMd) / 100);
    const direction = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    const relativeMd = visibleCursor?.wellId === well.id && visibleCursor.mdM !== null
      ? visibleCursor.mdM - offset
      : (layout.minMd + layout.maxMd) / 2;
    const mdM = Math.max(0, relativeMd + direction * step + offset);
    onSelectDepth?.(well.id, mdM);
    if (store) store.pinDepth(well.id, mdM, "multiwell-correlation");
  };
  const tableRowCount = wells.reduce((total, well) => total + well.tracks.reduce((trackTotal, track) => trackTotal + track.curve.values.length, 0), 0);
  const evidenceRows = useMemo(() => wells.flatMap((well) => well.tracks.map((track) => ({
    well,
    track,
    evidence: trackEvidence(track),
    startMdM: track.curve.depthsMdM[0] ?? null,
    endMdM: track.curve.depthsMdM.at(-1) ?? null,
  }))), [wells]);
  const evidenceByTrack = useMemo(() => new Map(evidenceRows.map(({ well, track, evidence }) => [`${well.id}:${track.curve.id}`, evidence] as const)), [evidenceRows]);
  const totalNullSamples = evidenceRows.reduce((total, row) => total + row.evidence.nullCount, 0);
  const summaryId = useId();

  return <section className="sw-correlation" aria-label={title} data-testid="multiwell-correlation">
    <header className="sw-correlation-head">
      <div><h2>{title}</h2><p>{flattenOn ? `Flattened on ${topChoices.find((top) => top.id === flattenOn)?.label}; MD values remain unchanged.` : "Independent measured-depth axes; choose a shared top to align wells."}</p></div>
      <label>Flatten on
        <select aria-label="Flatten correlation on" value={flattenOn ?? ""} onChange={(event) => onFlattenOnChange?.(event.target.value || null)} disabled={!onFlattenOnChange}>
          <option value="">No flattening</option>
          {topChoices.map((top) => <option key={top.id} value={top.id}>{top.label}</option>)}
        </select>
      </label>
    </header>
    <div className="sw-correlation-scroll">
      <svg className="sw-correlation-svg" viewBox={`0 0 ${viewWidth} ${height}`} preserveAspectRatio="none" style={{ width: `max(100%, ${minWidth ?? viewWidth}px)`, height: `${height}px` }} role="group" aria-label={`${title}, ${wells.length} wells`} aria-describedby={summaryId}>
        <g aria-hidden="true">
          {tickValues.map((tick) => <g key={tick}>
            <line x1={LEFT} x2={viewWidth} y1={layout.y(tick)} y2={layout.y(tick)} className="sw-correlation-grid" />
            <text x={LEFT - 8} y={layout.y(tick) + 4} textAnchor="end" className="sw-correlation-axis">{formatNumber(tick)} m</text>
          </g>)}
          <text x={13} y={(layout.plotTop + layout.plotBottom) / 2} transform={`rotate(-90 13 ${(layout.plotTop + layout.plotBottom) / 2})`} className="sw-correlation-axis-title">{flattenOn ? "Relative MD from flatten marker (m)" : "MD (m)"}</text>
        </g>
        {wells.map((well, wellIndex) => {
          const x0 = LEFT + wellIndex * TRACK_WIDTH;
          const offset = layout.offsets[wellIndex]!;
          const flattenTopAvailable = !flattenOn || well.tops.some((top) => top.id === flattenOn);
          const relativeCursor = cursorRelativeMd && (cursorRelativeMd.flatten ? flattenTopAvailable : cursorRelativeMd.sourceWellId === well.id)
            ? cursorRelativeMd.mdM
            : null;
          return <g key={well.id} transform={`translate(${x0} 0)`} data-well-id={well.id}>
            <text x={PLOT_LEFT + PLOT_WIDTH / 2} y={22} textAnchor="middle" className="sw-correlation-well">{well.label}</text>
            <text x={PLOT_LEFT + PLOT_WIDTH / 2} y={42} textAnchor="middle" className="sw-correlation-provenance">{well.provenance === "synthetic" ? "SYNTHETIC DATA · NOT FIELD EVIDENCE" : well.provenance.toUpperCase()}</text>
            <rect x={PLOT_LEFT} y={layout.plotTop} width={PLOT_WIDTH} height={layout.plotBottom - layout.plotTop} className="sw-correlation-track-bg" />
            {well.tracks.map((track, trackIndex) => {
              const domainWidth = track.domain[1] - track.domain[0];
              const subWidth = PLOT_WIDTH / Math.max(1, well.tracks.length);
              const subLeft = PLOT_LEFT + trackIndex * subWidth;
              const x = (value: number) => subLeft + Math.max(0, Math.min(1, (value - track.domain[0]) / domainWidth)) * subWidth;
              const evidence = evidenceByTrack.get(`${well.id}:${track.curve.id}`)!;
              const domainTicks = [track.domain[0], (track.domain[0] + track.domain[1]) / 2, track.domain[1]];
              const samples = decimateCorrelationSamples(track.curve, offset, layout.minMd, layout.maxMd, layout.plotBottom - layout.plotTop, maxPointsPerPixel);
              const segments: string[] = [];
              let current = "";
              for (const sample of samples) {
                if (sample.value === null) {
                  if (current) segments.push(current);
                  current = "";
                  continue;
                }
                const px = x(sample.value), py = layout.y(sample.mdM - offset);
                current += `${current ? "L" : "M"}${px.toFixed(2)},${py.toFixed(2)}`;
              }
              if (current) segments.push(current);
              return <g key={track.curve.id}>
                <line x1={subLeft} x2={subLeft} y1={layout.plotTop} y2={layout.plotBottom} className="sw-correlation-subtrack" />
                {domainTicks.map((tick, tickIndex) => <g key={`${tick}-${tickIndex}`}>
                  <line x1={x(tick)} x2={x(tick)} y1={layout.plotTop} y2={layout.plotBottom} className="sw-correlation-value-grid" />
                  <text x={x(tick)} y={95} textAnchor={tickIndex === 0 ? "start" : tickIndex === 2 ? "end" : "middle"} className="sw-correlation-value-axis">{formatNumber(tick)}</text>
                </g>)}
                <path d={segments.join("")} fill="none" stroke={track.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" data-log-id={track.curve.id} />
                <text x={subLeft + subWidth / 2} y={67} textAnchor="middle" className="sw-correlation-log-label">{track.label} · {track.curve.unit} · {formatNumber(track.domain[0])}–{formatNumber(track.domain[1])}</text>
                <line x1={subLeft} x2={subLeft + subWidth} y1={101} y2={101} className="sw-correlation-value-axis-line" />
                <title>{`${track.label}: ${evidence.validCount} valid samples, ${evidence.nullCount} null samples; observed ${evidence.min === null ? "not reported" : `${formatNumber(evidence.min)} to ${formatNumber(evidence.max!)}`} ${track.curve.unit}; display domain ${track.domain[0]} to ${track.domain[1]} ${track.curve.unit}.`}</title>
              </g>;
            })}
            {topIds.map((id) => {
              const top = well.tops.find((item) => item.id === id);
              if (!top) return null;
              const py = layout.y(top.mdM - offset);
              return <g key={id} data-top-id={id}>
                <line x1={PLOT_LEFT} x2={PLOT_LEFT + PLOT_WIDTH} y1={py} y2={py} className="sw-correlation-top" />
                <text x={PLOT_LEFT + PLOT_WIDTH - 3} y={py - 4} textAnchor="end" className="sw-correlation-top-label">{top.label} · {formatNumber(top.mdM)} m MD</text>
              </g>;
            })}
            {relativeCursor !== null && relativeCursor >= layout.minMd && relativeCursor <= layout.maxMd && <g aria-label={`Linked cursor at ${Math.round(relativeCursor + offset)} metres MD`}>
              <line x1={PLOT_LEFT} x2={PLOT_LEFT + PLOT_WIDTH} y1={layout.y(relativeCursor)} y2={layout.y(relativeCursor)} className="sw-correlation-cursor" />
              <text x={PLOT_LEFT + PLOT_WIDTH - 3} y={layout.y(relativeCursor) - 4} textAnchor="end" className="sw-correlation-cursor-label">{formatNumber(relativeCursor + offset)} m MD</text>
            </g>}
            {flattenOn && !flattenTopAvailable && <text x={PLOT_LEFT + PLOT_WIDTH / 2} y={(layout.plotTop + layout.plotBottom) / 2} textAnchor="middle" className="sw-correlation-missing">Flatten top missing</text>}
            <rect
              x={PLOT_LEFT} y={layout.plotTop} width={PLOT_WIDTH} height={layout.plotBottom - layout.plotTop}
              fill="transparent" className="sw-correlation-hit"
              role="slider" tabIndex={0} aria-label={`Select measured depth in ${well.label}`}
              aria-orientation="vertical"
              aria-valuemin={Math.max(0, Math.round(layout.minMd + offset))} aria-valuemax={Math.round(layout.maxMd + offset)}
              aria-valuenow={visibleCursor?.wellId === well.id && visibleCursor.mdM !== null ? Math.round(visibleCursor.mdM) : Math.round((layout.minMd + layout.maxMd) / 2 + offset)}
              aria-valuetext={visibleCursor?.wellId === well.id && visibleCursor.mdM !== null ? `${visibleCursor.mdM.toFixed(1)} metres measured depth` : `No depth selected; use arrow keys to choose depth in ${well.label}`}
              onClick={(event) => selectAt(well, offset, event)}
              onKeyDown={(event) => moveByKeyboard(well, offset, event)}
            />
          </g>;
        })}
        {flattenOn && wells.length > 1 && <g aria-hidden="true">
          {topIds.map((id) => {
            const points = wells.map((well, index) => {
              const top = well.tops.find((item) => item.id === id);
              return top ? `${LEFT + index * TRACK_WIDTH + PLOT_LEFT + PLOT_WIDTH / 2},${layout.y(top.mdM - layout.offsets[index]!)}` : null;
            });
            let paths = "";
            let previous = false;
            for (const point of points) {
              if (point) { paths += `${previous ? "L" : "M"}${point}`; previous = true; }
              else previous = false;
            }
            return paths ? <path key={id} d={paths} className="sw-correlation-link" data-linked-top={id} /> : null;
          })}
        </g>}
      </svg>
    </div>
    <p className="sw-sr-only" id={summaryId}>{wells.length} wells and {tableRowCount} supplied log samples. The chart shows eleven depth grid lines and a labelled value scale for each track. Flattening uses the selected explicit formation top; missing tops are not bridged. Use each well's measured-depth slider or the data table for keyboard navigation.</p>
    <section className="sw-correlation-evidence" aria-labelledby={`${summaryId}-evidence`}>
      <div className="sw-correlation-evidence-head">
        <div>
          <h3 id={`${summaryId}-evidence`}>What the plot is based on</h3>
          <p>Coverage and value summaries are calculated from supplied samples. They describe input data only; they do not prove a geological correlation.</p>
        </div>
        <p className="sw-correlation-evidence-count">{wells.length} wells <span>·</span> {tableRowCount.toLocaleString()} samples <span>·</span> {totalNullSamples.toLocaleString()} null samples</p>
      </div>
      <div className="sw-correlation-evidence-table-wrap">
        <table className="sw-correlation-evidence-table">
          <caption>Per-track sample coverage and observed values</caption>
          <thead><tr>
            <th scope="col">Well / track</th><th scope="col">Observed MD range</th><th scope="col">Valid / total</th>
            <th scope="col">Null samples</th><th scope="col">Observed min–max</th><th scope="col">Mean</th><th scope="col">Outside display limits</th>
          </tr></thead>
          <tbody>{evidenceRows.map(({ well, track, evidence, startMdM, endMdM }) => <tr key={`${well.id}:${track.curve.id}`}>
            <th scope="row">{well.label} · {track.label}</th>
            <td>{startMdM === null || endMdM === null ? "not reported" : `${formatNumber(startMdM)}–${formatNumber(endMdM)} m MD`}</td>
            <td>{evidence.validCount} / {track.curve.values.length}</td>
            <td>{evidence.nullCount}</td>
            <td>{evidence.min === null ? "not reported" : `${formatNumber(evidence.min)}–${formatNumber(evidence.max!)} ${track.curve.unit}`}</td>
            <td>{evidence.mean === null ? "not reported" : `${formatNumber(evidence.mean)} ${track.curve.unit}`}</td>
            <td>{evidence.clippedCount} · domain {formatNumber(track.domain[0])}–{formatNumber(track.domain[1])} {track.curve.unit}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="sw-correlation-evidence-table-wrap">
        <table className="sw-correlation-evidence-table sw-correlation-tie-table">
          <caption>{flattenOn
            ? `Top tie audit: supplied measured depths and relative offsets from ${topChoices.find((top) => top.id === flattenOn)?.label}`
            : "Top tie audit: supplied measured depths; no flattening reference is selected"}</caption>
          <thead><tr><th scope="col">Top ID / label</th>{wells.map((well) => <th scope="col" key={well.id}>{well.label} · {flattenOn ? "MD / relative MD (m)" : "MD (m)"}</th>)}</tr></thead>
          <tbody>{topIds.map((id) => {
            const label = wells.flatMap((well) => well.tops).find((top) => top.id === id)?.label ?? id;
            return <tr key={id}>
              <th scope="row">{label} <code>{id}</code></th>
              {wells.map((well, wellIndex) => {
                const top = well.tops.find((item) => item.id === id);
                return <td key={well.id}>{top
                  ? flattenOn ? `${formatNumber(top.mdM)} / ${formatNumber(top.mdM - layout.offsets[wellIndex]!)} m`
                    : `${formatNumber(top.mdM)} m MD`
                  : "not reported"}</td>;
              })}
            </tr>;
          })}</tbody>
        </table>
      </div>
    </section>
    <AccessibleTable
      label="correlation samples"
      description="Supplied log samples by well, measured depth, track, value, and unit. Null samples are shown as not reported."
      columns={[{ label: "Well" }, { label: "Measured depth", unit: "m MD" }, { label: "Track" }, { label: "Value" }, { label: "Unit" }]}
      rowCount={tableRowCount}
      getRows={(start, end) => getAccessibleRowsPage(wells.flatMap((well) => well.tracks.map((track) => ({
        rowCount: track.curve.values.length,
        getRow: (index: number) => {
          const value = track.curve.values[index]!;
          return [
            well.label,
            track.curve.depthsMdM[index] ?? null,
            track.label,
            Number.isNaN(value) || (track.curve.nullValue !== "nan" && track.curve.nullValue !== null && value === track.curve.nullValue) ? null : value,
            track.curve.unit,
          ];
        },
      }))), start, end)}
    />
    {incompleteTops.length > 0 && <p className="sw-correlation-note" role="note">
      Unmatched tops are not bridged: {incompleteTops.map((top) => `${top.label} missing in ${top.missing.join(", ")}`).join("; ")}.
    </p>}
    <footer className="sw-correlation-legend">
      {wells.flatMap((well) => well.tracks.map((track) => <span key={`${well.id}:${track.curve.id}`}><i style={{ backgroundColor: track.color }} />{well.label}: {track.label} ({track.domain[0]}–{track.domain[1]} {track.curve.unit})</span>))}
      <span><i className="sw-correlation-top-key" />Correlated top</span>
      <span><i className="sw-correlation-cursor-key" />Linked depth cursor</span>
    </footer>
    {wells.some((well) => well.provenance === "synthetic") && <p className="sw-correlation-note">Synthetic inputs are for visualization testing only; they are not measured well data.</p>}
  </section>;
}
