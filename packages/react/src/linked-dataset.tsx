"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent } from "react";
import { validateInteractionDataset } from "@ikhmalputra/subsurface-core/contracts";
import type { InteractionDataset } from "@ikhmalputra/subsurface-core/contracts";
import { createSubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import type { SpatialXYZ, SubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import { useSubsurfaceSelector } from "./state-hooks.js";
import { ColorScaleLegend, useSubsurfaceVisualConfiguration } from "./visual-provider.js";
import { sampleColorMap } from "./visual.js";
import { CommandButton } from "./ui.js";

export interface LinkedDatasetViewProps {
  readonly dataset: InteractionDataset;
  readonly store?: SubsurfaceStore;
  readonly valueColumnId?: string;
  readonly title?: string;
  readonly tableHeight?: number;
}

interface SampleRow {
  readonly index: number;
  readonly id: string;
  readonly keyValue: number;
  readonly value: number | null;
}

const CHART = { width: 720, height: 300, left: 58, right: 20, top: 18, bottom: 42 };
const COMPACT_TABLE_ROW_HEIGHT = 36;
const COMFORTABLE_TABLE_ROW_HEIGHT = 44;
const TABLE_OVERSCAN = 4;

function isNull(value: number, sentinel: InteractionDataset["columns"][number]["nullValue"]): boolean {
  return sentinel === "nan" ? Number.isNaN(value) : sentinel === null ? false : value === sentinel;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows: readonly SampleRow[], dataset: InteractionDataset, column: InteractionDataset["columns"][number]): string {
  return [
    ["sample_id", dataset.key.kind, column.label, "unit"].map(csvCell).join(","),
    ...rows.map((row) => [row.id, row.keyValue, row.value === null ? "not reported" : row.value, column.unit].map(csvCell).join(",")),
  ].join("\r\n");
}

/** Links one columnar dataset across a chart, virtualized table, and XY spatial view. */
export function LinkedDatasetView({
  dataset: input,
  store,
  valueColumnId,
  title = "Linked dataset",
  tableHeight = 280,
}: LinkedDatasetViewProps) {
  const dataset = useMemo(() => validateInteractionDataset(input), [input]);
  const activeStore = useMemo(() => store ?? createSubsurfaceStore(), [store]);
  const interaction = useSubsurfaceSelector(activeStore, (state) => state.dataInteraction);
  const { density } = useSubsurfaceVisualConfiguration();
  const tableRowHeight = density === "comfortable" ? COMFORTABLE_TABLE_ROW_HEIGHT : COMPACT_TABLE_ROW_HEIGHT;
  const current = interaction.datasetId === dataset.id ? interaction : null;
  const sampleIdSet = useMemo(() => new Set(dataset.sampleIds), [dataset]);
  const selectedIds = current?.selectedIds.filter((id) => sampleIdSet.has(id)) ?? [];
  const hoveredId = current?.hoveredId && sampleIdSet.has(current.hoveredId) ? current.hoveredId : null;
  const chartRef = useRef<SVGSVGElement>(null);
  const chartPointRefs = useRef(new Map<string, SVGCircleElement>());
  const tableScroller = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"key" | "value">("key");
  const [descending, setDescending] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const [focusedChartSampleId, setFocusedChartSampleId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const summaryId = useId();
  const column = dataset.columns.find((candidate) => candidate.id === valueColumnId) ?? dataset.columns[0]!;
  if (valueColumnId && !dataset.columns.some((candidate) => candidate.id === valueColumnId)) {
    throw new TypeError(`Dataset "${dataset.id}" has no value column "${valueColumnId}".`);
  }

  const rows = useMemo<readonly SampleRow[]>(() => dataset.sampleIds.map((id, index) => {
    const raw = column.values[index]!;
    return { id, index, keyValue: dataset.keyValues[index]!, value: isNull(raw, column.nullValue) ? null : raw };
  }), [dataset, column]);
  const filteredRows = useMemo(() => {
    const candidateBrush = current?.brush?.datasetId === dataset.id ? current.brush : null;
    const candidateStart = candidateBrush ? dataset.sampleIds.indexOf(candidateBrush.startId) : -1;
    const candidateEnd = candidateBrush ? dataset.sampleIds.indexOf(candidateBrush.endId) : -1;
    const brush = candidateStart >= 0 && candidateEnd >= 0 ? candidateBrush : null;
    let start = 0, end = rows.length - 1;
    if (brush) {
      start = dataset.sampleIds.indexOf(brush.startId);
      end = dataset.sampleIds.indexOf(brush.endId);
      if (start > end) [start, end] = [end, start];
    }
    const depthRange = dataset.key.kind === "depth" ? current?.depthRange : null;
    const timeRange = dataset.key.kind === "time" ? current?.timeRange : null;
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      if (row.index < start || row.index > end) return false;
      if (depthRange && (row.keyValue < depthRange[0] || row.keyValue > depthRange[1])) return false;
      if (timeRange && (row.keyValue < timeRange[0] || row.keyValue > timeRange[1])) return false;
      if (!normalizedQuery) return true;
      return `${row.id} ${row.keyValue} ${row.value ?? "not reported"}`.toLocaleLowerCase().includes(normalizedQuery);
    }).sort((a, b) => {
      const delta = sort === "key" ? a.keyValue - b.keyValue : (a.value ?? Infinity) - (b.value ?? Infinity);
      return (descending ? -1 : 1) * delta;
    });
  }, [rows, current, dataset, query, sort, descending]);

  const firstVisible = Math.max(0, Math.floor(scrollTop / tableRowHeight) - TABLE_OVERSCAN);
  const lastVisible = Math.min(filteredRows.length, Math.ceil((scrollTop + tableHeight) / tableRowHeight) + TABLE_OVERSCAN);
  const virtualRows = filteredRows.slice(firstVisible, lastVisible);
  const keyMin = dataset.keyValues[0]!;
  const keyMax = dataset.keyValues[dataset.keyValues.length - 1]!;
  let valueMin = Infinity, valueMax = -Infinity, reportedCount = 0;
  for (const row of rows) if (row.value !== null) {
    valueMin = Math.min(valueMin, row.value);
    valueMax = Math.max(valueMax, row.value);
    reportedCount += 1;
  }
  const rawValueCount = reportedCount;
  const valueSpan = valueMax - valueMin || 1;
  const colorDomain: readonly [number, number] = [
    valueMin,
    valueMax === valueMin ? valueMin + Math.max(1, Math.abs(valueMin) * Number.EPSILON * 2) : valueMax,
  ];
  const plot = { x: CHART.left, y: CHART.top, width: CHART.width - CHART.left - CHART.right, height: CHART.height - CHART.top - CHART.bottom };
  const chartX = (keyValue: number) => plot.x + (keyValue - keyMin) / (keyMax - keyMin || 1) * plot.width;
  const chartY = (value: number) => plot.y + (valueMax - value) / valueSpan * plot.height;
  const bucketWidth = Math.max(1, Math.floor(plot.width));
  const chartBuckets = new Map<number, { first: number; last: number; min: number; max: number; minValue: number; maxValue: number }>();
  const chartNulls: number[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (row.value === null) { chartNulls.push(index); continue; }
    const bucket = Math.min(bucketWidth - 1, Math.floor((row.keyValue - keyMin) / (keyMax - keyMin || 1) * bucketWidth));
    const entry = chartBuckets.get(bucket);
    if (!entry) chartBuckets.set(bucket, { first: index, last: index, min: index, max: index, minValue: row.value, maxValue: row.value });
    else {
      entry.last = index;
      if (row.value < entry.minValue) { entry.min = index; entry.minValue = row.value; }
      if (row.value > entry.maxValue) { entry.max = index; entry.maxValue = row.value; }
    }
  }
  const chartIndices = new Set<number>(chartNulls);
  for (const bucket of chartBuckets.values()) for (const index of [bucket.first, bucket.min, bucket.max, bucket.last]) chartIndices.add(index);
  for (const id of [...selectedIds, ...(hoveredId ? [hoveredId] : [])]) {
    const index = dataset.sampleIds.indexOf(id);
    if (index >= 0) chartIndices.add(index);
  }
  const navigableChartIndices = [...chartIndices].filter((index) => rows[index]!.value !== null).sort((a, b) => a - b);
  const firstNavigableChartId = navigableChartIndices.length ? rows[navigableChartIndices[0]!]!.id : null;
  const navigableChartRows = navigableChartIndices
    .map((index) => rows[index]!)
    .filter((row): row is SampleRow & { readonly value: number } => row.value !== null);
  const path = [...chartIndices].sort((a, b) => a - b).reduce((result, index) => {
    const row = rows[index]!;
    if (row.value === null) return { d: result.d, penDown: false };
    const command = result.penDown ? "L" : "M";
    return { d: `${result.d}${command}${chartX(row.keyValue).toFixed(2)},${chartY(row.value).toFixed(2)}`, penDown: true };
  }, { d: "", penDown: false }).d;

  const spatial = dataset.spatialXYZ && dataset.reference ? Array.from({ length: dataset.sampleIds.length }, (_, index) => ({
    id: dataset.sampleIds[index]!,
    index,
    x: dataset.spatialXYZ![index * 3]!,
    y: dataset.spatialXYZ![index * 3 + 1]!,
    z: dataset.spatialXYZ![index * 3 + 2]!,
  })) : [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const point of spatial) {
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
  }
  if (!spatial.length) { minX = 0; maxX = 1; minY = 0; maxY = 1; }
  const padX = Math.max((maxX - minX) * 0.08, 1), padY = Math.max((maxY - minY) * 0.08, 1);
  minX -= padX; maxX += padX; minY -= padY; maxY += padY;
  const spatialX = (value: number) => 24 + (value - minX) / (maxX - minX) * 352;
  const spatialY = (value: number) => 216 - (value - minY) / (maxY - minY) * 192;
  const spatialPath = spatial.map((point, index) => `${index ? "L" : "M"}${spatialX(point.x).toFixed(2)},${spatialY(point.y).toFixed(2)}`).join("");

  function publishHover(sampleId: string | null, source: string) {
    const index = sampleId === null ? -1 : dataset.sampleIds.indexOf(sampleId);
    activeStore.setDataInteraction({ datasetId: dataset.id, hoveredId: sampleId }, source);
    if (index >= 0 && dataset.wellId && dataset.spatialXYZ) {
      activeStore.triggerSpatialPick([
        dataset.spatialXYZ[index * 3]!,
        dataset.spatialXYZ[index * 3 + 1]!,
        dataset.spatialXYZ[index * 3 + 2]!,
      ], source);
    }
  }
  function selectSample(sampleId: string, source: string) {
    const index = dataset.sampleIds.indexOf(sampleId);
    activeStore.setDataInteraction({ datasetId: dataset.id, hoveredId: sampleId, selectedIds: [sampleId] }, source);
    const visibleRowIndex = filteredRows.findIndex((row) => row.id === sampleId);
    if (visibleRowIndex >= 0) {
      setFocusedRow(visibleRowIndex);
      tableScroller.current?.scrollTo({ top: visibleRowIndex * tableRowHeight });
    }
    if (dataset.wellId) activeStore.focusAsset(dataset.wellId, null, source);
    if (index >= 0 && dataset.spatialXYZ) {
      const xyz: SpatialXYZ = [dataset.spatialXYZ[index * 3]!, dataset.spatialXYZ[index * 3 + 1]!, dataset.spatialXYZ[index * 3 + 2]!];
      activeStore.triggerSpatialPick(xyz, source);
    }
  }
  function indexAtPointer(event: PointerEvent<SVGSVGElement>): number {
    const svg = chartRef.current;
    const rect = svg?.getBoundingClientRect();
    if (!svg || !rect || rect.width === 0) return 0;
    const x = (event.clientX - rect.left) / rect.width * CHART.width;
    const key = keyMin + (x - plot.x) / plot.width * (keyMax - keyMin);
    let low = 0, high = dataset.keyValues.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (dataset.keyValues[mid]! < key) low = mid + 1;
      else high = mid;
    }
    if (low > 0 && Math.abs(dataset.keyValues[low - 1]! - key) < Math.abs(dataset.keyValues[low]! - key)) low -= 1;
    return low;
  }
  function spatialIndexAtPointer(event: PointerEvent<SVGSVGElement> | ReactMouseEvent<SVGSVGElement>): number {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || spatial.length === 0) return -1;
    const pointerX = (event.clientX - rect.left) / rect.width * 400;
    const pointerY = (event.clientY - rect.top) / rect.height * 250;
    let nearest = 0, nearestDistance = Infinity;
    for (let index = 0; index < spatial.length; index += 1) {
      const point = spatial[index]!;
      const dx = spatialX(point.x) - pointerX;
      const dy = spatialY(point.y) - pointerY;
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) { nearest = index; nearestDistance = distance; }
    }
    return nearest;
  }
  function startBrush(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const row = rows[indexAtPointer(event)]!;
    publishHover(row.id, "linked-chart");
  }
  function moveBrush(event: PointerEvent<SVGSVGElement>) {
    const row = rows[indexAtPointer(event)]!;
    publishHover(row.id, "linked-chart");
  }
  function finishBrush(event: PointerEvent<SVGSVGElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const first = indexAtPointer(event);
    const pointerStart = Number(event.currentTarget.dataset.brushStartIndex ?? first);
    const low = Math.min(first, pointerStart), high = Math.max(first, pointerStart);
    const start = rows[low]!, end = rows[high]!;
    if (low === high) {
      selectSample(start.id, "linked-chart");
      event.currentTarget.removeAttribute("data-brush-start-index");
      return;
    }
    const depthRange = dataset.key.kind === "depth" ? [start.keyValue, end.keyValue] as const : null;
    const timeRange = dataset.key.kind === "time" ? [start.keyValue, end.keyValue] as const : null;
    activeStore.setDataInteraction({
      datasetId: dataset.id,
      hoveredId: end.id,
      brush: { datasetId: dataset.id, startId: start.id, endId: end.id },
      depthRange,
      timeRange,
    }, "linked-chart");
    if (dataset.wellId) activeStore.focusAsset(dataset.wellId, null, "linked-chart");
    event.currentTarget.removeAttribute("data-brush-start-index");
  }

  async function copyFilteredCsv() {
    try {
      if (!globalThis.navigator?.clipboard?.writeText) throw new Error("Clipboard access is unavailable in this browser context.");
      await globalThis.navigator.clipboard.writeText(toCsv(filteredRows, dataset, column));
      setStatus(`Copied ${filteredRows.length} filtered rows as CSV.`);
    } catch (error) {
      setStatus(`CSV copy failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  function downloadCsv() {
    try {
      const blob = new Blob([toCsv(filteredRows, dataset, column)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${dataset.id}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus(`Exported ${filteredRows.length} filtered rows as CSV.`);
    } catch (error) {
      setStatus(`CSV export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  function navigateGrid(event: KeyboardEvent<HTMLTableRowElement>, index: number) {
    const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : event.key === "Home" ? -index : event.key === "End" ? filteredRows.length - 1 - index : 0;
    if (!delta && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = Math.max(0, Math.min(filteredRows.length - 1, index + delta));
    const target = filteredRows[next];
    if (!target) return;
    setFocusedRow(next);
    tableScroller.current?.scrollTo({ top: Math.max(0, next * tableRowHeight - tableHeight / 2) });
    requestAnimationFrame(() => rowRefs.current.get(next)?.focus());
  }
  function navigateChart(event: KeyboardEvent<SVGCircleElement>, sampleId: string) {
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1
        : event.key === "Home" ? -Infinity : event.key === "End" ? Infinity : 0;
    if (direction !== 0) {
      event.preventDefault();
      const currentIndex = navigableChartIndices.findIndex((index) => rows[index]!.id === sampleId);
      const nextIndex = direction === -Infinity ? 0
        : direction === Infinity ? navigableChartIndices.length - 1
          : Math.max(0, Math.min(navigableChartIndices.length - 1, currentIndex + direction));
      const targetId = rows[navigableChartIndices[nextIndex]!]!.id;
      setFocusedChartSampleId(targetId);
      requestAnimationFrame(() => chartPointRefs.current.get(targetId)?.focus());
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectSample(sampleId, "linked-chart");
    }
  }

  const brushIndices = current?.brush?.datasetId === dataset.id
    ? [dataset.sampleIds.indexOf(current.brush.startId), dataset.sampleIds.indexOf(current.brush.endId)].sort((a, b) => a - b)
    : null;
  const brushStartIndex = brushIndices?.[0] ?? -1;
  const brushEndIndex = brushIndices?.[1] ?? -1;
  const summary = `${dataset.sampleIds.length} samples; ${column.label}, ${column.unit}; ${rawValueCount} reported and ${dataset.sampleIds.length - rawValueCount} not reported.`;
  if (!Number.isFinite(tableHeight) || tableHeight < tableRowHeight) throw new RangeError("Linked dataset table height must be finite and at least one row.");
  if (!rawValueCount) return <section className="sw-linked-dataset" data-testid="linked-dataset" role="alert">
    Dataset "{dataset.id}" column "{column.label}" has no reported values to plot.
  </section>;
  return <section className="sw-linked-dataset" data-testid="linked-dataset" aria-label={title}>
    <header className="sw-linked-dataset-head">
      <div><h2>{title}</h2><p>{dataset.id} · {dataset.key.kind === "depth" ? "Measured depth (m MD)" : dataset.key.kind === "time" ? "UTC time (Unix ms)" : "Sample index"}{dataset.reference ? ` · ${dataset.reference.crs}` : ""}</p></div>
      <span>{summary}</span>
    </header>
    <div className="sw-linked-dataset-grid">
      <section className="sw-linked-dataset-chart" aria-label="Linked chart">
        <h3>{column.label} <span>({column.unit})</span></h3>
        <svg
          ref={chartRef}
          viewBox={`0 0 ${CHART.width} ${CHART.height}`}
          role="group"
          aria-label={`${column.label} by ${dataset.key.kind}; drag horizontally to brush and filter rows`}
          aria-describedby={summaryId}
          onPointerDown={(event) => {
            event.currentTarget.dataset.brushStartIndex = String(indexAtPointer(event));
            startBrush(event);
          }}
          onPointerMove={moveBrush}
          onPointerUp={finishBrush}
          onPointerCancel={(event) => event.currentTarget.removeAttribute("data-brush-start-index")}
        >
          <g aria-hidden="true">
            {[0, 1, 2, 3, 4].map((tick) => {
              const y = plot.y + plot.height * tick / 4;
              const value = valueMax - valueSpan * tick / 4;
              return <g key={tick}><line x1={plot.x} x2={plot.x + plot.width} y1={y} y2={y} className="sw-linked-dataset-gridline" /><text x={plot.x - 8} y={y + 4} textAnchor="end">{value.toPrecision(3)}</text></g>;
            })}
            <text x={plot.x + plot.width / 2} y={CHART.height - 8} textAnchor="middle">{dataset.key.kind === "depth" ? "Measured depth (m MD)" : dataset.key.kind === "time" ? "UTC epoch milliseconds" : "Sample index"}</text>
          </g>
          {brushStartIndex >= 0 && brushEndIndex >= 0 && <rect
            x={chartX(rows[brushStartIndex]!.keyValue)}
            y={plot.y}
            width={Math.max(2, chartX(rows[brushEndIndex]!.keyValue) - chartX(rows[brushStartIndex]!.keyValue))}
            height={plot.height}
            className="sw-linked-dataset-brush"
            aria-hidden="true"
          />}
          <path d={path} className="sw-linked-dataset-line" aria-hidden="true" />
          {navigableChartRows.map((row) => <circle
            key={row.id}
            ref={(element) => { if (element) chartPointRefs.current.set(row.id, element); else chartPointRefs.current.delete(row.id); }}
            cx={chartX(row.keyValue)}
            cy={chartY(row.value)}
            r={selectedIds.includes(row.id) || hoveredId === row.id ? 5 : 2.4}
            className={`sw-linked-dataset-point${selectedIds.includes(row.id) ? " is-selected" : ""}${hoveredId === row.id ? " is-hovered" : ""}`}
            style={{ fill: sampleColorMap(row.value, colorDomain) }}
            role="button"
            tabIndex={focusedChartSampleId === row.id || (focusedChartSampleId === null && firstNavigableChartId === row.id) ? 0 : -1}
            aria-label={`${row.id}, ${dataset.key.kind} ${row.keyValue}, ${column.label} ${row.value} ${column.unit}`}
            onPointerEnter={() => publishHover(row.id, "linked-chart")}
            onFocus={() => { setFocusedChartSampleId(row.id); publishHover(row.id, "linked-chart"); }}
            onClick={() => selectSample(row.id, "linked-chart")}
            onKeyDown={(event) => navigateChart(event, row.id)}
          />)}
        </svg>
        <p id={summaryId} className="sw-sr-only">{summary} Use arrow keys to move between plotted samples, then press Enter to select. A linked table below provides the same samples.</p>
        <ColorScaleLegend label={column.label} minimum={valueMin} maximum={valueMax} unit={column.unit} />
        <p className="sw-linked-dataset-help">Drag across the chart to brush the table. Use arrow keys to move between plotted samples, then Enter to select; the linked table provides an exact keyboard alternative.</p>
      </section>
      <section className="sw-linked-dataset-spatial" aria-label="Linked spatial view">
        <h3>Spatial samples {dataset.reference && <span>({dataset.reference.units} · Z down)</span>}</h3>
        {spatial.length ? <svg
          viewBox="0 0 400 250"
          role="group"
          aria-label={`XY locations in ${dataset.reference!.crs}; click to select nearest supplied sample, or use the sample table with a keyboard`}
          onPointerMove={(event) => {
            const index = spatialIndexAtPointer(event);
            if (index >= 0) publishHover(spatial[index]!.id, "linked-spatial");
          }}
          onPointerLeave={() => publishHover(null, "linked-spatial")}
          onClick={(event) => {
            const index = spatialIndexAtPointer(event);
            if (index >= 0) selectSample(spatial[index]!.id, "linked-spatial");
          }}
        >
          {[0, 1, 2, 3, 4].map((tick) => <g key={tick} aria-hidden="true">
            <line x1={24 + tick * 88} x2={24 + tick * 88} y1={24} y2={224} className="sw-linked-dataset-gridline" />
            <line x1={24} x2={376} y1={24 + tick * 48} y2={24 + tick * 48} className="sw-linked-dataset-gridline" />
          </g>)}
          <path d={spatialPath} className="sw-linked-dataset-spatial-line" aria-hidden="true" />
          {spatial.map((point) => <circle
            key={point.id}
            cx={spatialX(point.x)}
            cy={spatialY(point.y)}
            r={selectedIds.includes(point.id) || hoveredId === point.id ? 6 : 3}
            className={`sw-linked-dataset-spatial-point${selectedIds.includes(point.id) ? " is-selected" : ""}${hoveredId === point.id ? " is-hovered" : ""}`}
            data-sample-id={point.id}
            aria-hidden="true"
            pointerEvents="none"
          />)}
          <text x="200" y="244" textAnchor="middle">{dataset.reference!.crs}</text>
        </svg> : <p>Spatial coordinates were not supplied for this dataset.</p>}
        <p className="sw-linked-dataset-help">{dataset.wellId ? `Linked well: ${dataset.wellId}` : "No well identity supplied; picks remain dataset-local."} Use the sample table to keyboard-select an exact point.</p>
      </section>
      <section className="sw-linked-dataset-table" aria-label="Linked data table">
        <div className="sw-linked-dataset-table-toolbar">
          <label>Filter samples <input type="search" value={query} onChange={(event) => { setQuery(event.currentTarget.value); setFocusedRow(null); setScrollTop(0); tableScroller.current?.scrollTo({ top: 0 }); }} /></label>
          <CommandButton icon="settings" type="button" onClick={() => { setSort(sort === "key" ? "value" : "key"); setDescending((value) => sort === "key" ? false : !value); }}>
            Sort by {sort === "key" ? dataset.key.kind : column.label}{descending ? " descending" : " ascending"}
          </CommandButton>
          <CommandButton icon="download" type="button" onClick={() => void copyFilteredCsv()}>Copy filtered CSV</CommandButton>
          <CommandButton icon="download" type="button" onClick={downloadCsv}>Download CSV</CommandButton>
        </div>
        <div
          ref={tableScroller}
          className="sw-linked-dataset-table-scroll"
          style={{ height: `${tableHeight}px` }}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <table role="grid" aria-label={`${dataset.id} sample table`}>
            <thead><tr role="row">
              <th role="columnheader" scope="col"><CommandButton kind="selection" type="button" onClick={() => { setSort("key"); setDescending((value) => sort === "key" ? !value : false); }}>{dataset.key.kind}{dataset.key.kind === "depth" ? " (m MD)" : dataset.key.kind === "time" ? " (UTC ms)" : ""}</CommandButton></th>
              <th role="columnheader" scope="col">Sample ID</th>
              <th role="columnheader" scope="col"><CommandButton kind="selection" type="button" onClick={() => { setSort("value"); setDescending((value) => sort === "value" ? !value : false); }}>{column.label} ({column.unit})</CommandButton></th>
            </tr></thead>
            <tbody>
              {firstVisible > 0 && <tr role="presentation" aria-hidden="true"><td colSpan={3} style={{ height: firstVisible * tableRowHeight }} /></tr>}
              {virtualRows.map((row, virtualIndex) => {
                const index = firstVisible + virtualIndex;
                const selected = selectedIds.includes(row.id);
                return <tr
                  key={row.id}
                  ref={(element) => { if (element) rowRefs.current.set(index, element); else rowRefs.current.delete(index); }}
                  data-sample-id={row.id}
                  data-row-index={index}
                  role="row"
                  aria-rowindex={index + 2}
                  aria-selected={selected}
                  tabIndex={focusedRow === index || ((focusedRow === null || focusedRow >= filteredRows.length) && index === firstVisible) ? 0 : -1}
                  className={`${selected ? "is-selected" : ""}${hoveredId === row.id ? " is-hovered" : ""}`}
                  style={{ height: tableRowHeight }}
                  onPointerEnter={() => publishHover(row.id, "linked-table")}
                  onPointerLeave={() => publishHover(null, "linked-table")}
                  onFocus={() => publishHover(row.id, "linked-table")}
                  onClick={() => selectSample(row.id, "linked-table")}
                  onKeyDown={(event) => navigateGrid(event, index)}
                >
                  <td role="gridcell">{row.keyValue}</td>
                  <td role="gridcell">{row.id}</td>
                  <td role="gridcell">{row.value === null ? "not reported" : row.value}</td>
                </tr>;
              })}
              {lastVisible < filteredRows.length && <tr role="presentation" aria-hidden="true"><td colSpan={3} style={{ height: (filteredRows.length - lastVisible) * tableRowHeight }} /></tr>}
              {filteredRows.length === 0 && <tr role="row"><td role="gridcell" colSpan={3}>No samples match the current filter or brush.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
    <p className="sw-linked-dataset-status" role="status" aria-live="polite">{status || `${filteredRows.length} of ${rows.length} rows visible. ${hoveredId ? `Sample ${hoveredId} linked.` : ""}`}</p>
  </section>;
}
