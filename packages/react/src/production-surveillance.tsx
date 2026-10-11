"use client";

import { useMemo, useState } from "react";
import { validateProductionSurveillanceDocument } from "@ikhmalputra/subsurface-core/contracts";
import type { ProductionSurveillanceDocument, ProductionSurveillanceEvent } from "@ikhmalputra/subsurface-core/contracts";
import type { WellAssembly } from "@ikhmalputra/subsurface-core/assembly";
import { createSubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import type { SubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import { AssemblySchematic } from "./assembly-schematic.js";
import { LinkedDatasetView } from "./linked-dataset.js";
import { useSubsurfaceSelector } from "./state-hooks.js";
import { CommandButton } from "./ui.js";

export interface ProductionSurveillanceViewProps {
  readonly document: ProductionSurveillanceDocument;
  readonly store?: SubsurfaceStore;
  readonly assembly?: WellAssembly;
  readonly assetBaseUrl?: string;
  readonly tableHeight?: number;
}

function formatUtc(value: number): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(value) + " UTC";
}

function eventDepth(event: ProductionSurveillanceEvent): string {
  if (event.mdM === null) return "Depth not reported";
  return `${event.mdM.toLocaleString("en", { maximumFractionDigits: 2 })} m MD`;
}

/** Links UTC production observations and operational events to shared well/depth state. */
export function ProductionSurveillanceView({
  document: input,
  store,
  assembly,
  assetBaseUrl = "",
  tableHeight = 280,
}: ProductionSurveillanceViewProps) {
  const document = useMemo(() => validateProductionSurveillanceDocument(input), [input]);
  if (assembly && assembly.id !== document.wellId) {
    throw new TypeError(`Assembly "${assembly.id}" does not belong to well "${document.wellId}".`);
  }
  if (assembly && !assetBaseUrl.trim()) {
    throw new TypeError("assetBaseUrl is required when a well assembly is supplied.");
  }
  if (assembly) {
    for (const event of document.events) {
      if (event.componentId !== null && !assembly.items.some((item) => item.id === event.componentId)) {
        throw new TypeError(`Event "${event.id}" references component "${event.componentId}" absent from assembly "${assembly.id}".`);
      }
    }
  }
  const localStore = useMemo(() => createSubsurfaceStore(), []);
  const activeStore = store ?? localStore;
  const [columnId, setColumnId] = useState(document.dataset.columns[0]!.id);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const interaction = useSubsurfaceSelector(activeStore, (state) => state.dataInteraction);
  const cursorDepthM = useSubsurfaceSelector(activeStore, (state) =>
    state.activeAsset.wellId === document.wellId ? state.depthLink.hoverMdM ?? state.depthLink.pinnedMdM : null,
  );
  const selectedColumnId = document.dataset.columns.some((column) => column.id === columnId)
    ? columnId
    : document.dataset.columns[0]!.id;
  const currentRange = interaction.datasetId === document.dataset.id ? interaction.timeRange : null;
  const visibleEvents = currentRange
    ? document.events.filter((event) => {
      const eventEnd = event.endTimeMs ?? event.startTimeMs;
      return eventEnd >= currentRange[0] && event.startTimeMs <= currentRange[1];
    })
    : document.events;

  function selectEvent(event: ProductionSurveillanceEvent) {
    setActiveEventId(event.id);
    activeStore.focusAsset(document.wellId, event.componentId, "production-surveillance");
    activeStore.pinDepth(document.wellId, event.mdM, "production-surveillance");
    const from = Math.min(event.startTimeMs, 8.64e15 - 1);
    const to = event.endTimeMs !== null && event.endTimeMs > from ? event.endTimeMs : from + 1;
    activeStore.setDataInteraction({
      datasetId: document.dataset.id,
      hoveredId: null,
      selectedIds: [],
      depthRange: null,
      timeRange: [from, to],
      brush: null,
    }, "production-surveillance");
  }

  return <section className="sw-production-surveillance" aria-label={`Production and surveillance for ${document.wellLabel}`}>
    <header className="sw-production-header">
      <div>
        <p className="sw-production-eyebrow">Production &amp; surveillance</p>
        <h2>{document.wellLabel}</h2>
      </div>
      <div className={`sw-production-provenance sw-production-provenance-${document.provenance}`}>
        {document.provenance === "synthetic" ? "Synthetic example — not reported well performance" : document.provenance}
        {document.source ? <span>Source: {document.source}</span> : <span>Source: not reported</span>}
      </div>
    </header>

    <div className="sw-production-observations">
      <div className="sw-production-chart-heading">
        <div>
          <h3>Time-series observations</h3>
          <p>Values are supplied observations; units, nulls, and UTC timestamps come from the host dataset.</p>
        </div>
        <label>
          <span>Measurement</span>
          <select value={selectedColumnId} onChange={(event) => setColumnId(event.currentTarget.value)}>
            {document.dataset.columns.map((column) => <option key={column.id} value={column.id}>
              {column.label} ({column.unit})
            </option>)}
          </select>
        </label>
      </div>
      <LinkedDatasetView
        dataset={document.dataset}
        store={activeStore}
        valueColumnId={selectedColumnId}
        title={`${document.dataset.columns.find((column) => column.id === selectedColumnId)!.label} · ${document.dataset.columns.find((column) => column.id === selectedColumnId)!.unit}`}
        tableHeight={tableHeight}
      />
    </div>

    <div className="sw-production-linked-panels">
      <section className="sw-production-events" aria-label="Production and surveillance events">
        <div className="sw-production-chart-heading">
          <div>
            <h3>Events</h3>
            <p>Select an event to focus its time interval and, when reported, its measured depth.</p>
          </div>
          {currentRange && <CommandButton icon="clear" type="button" onClick={() => activeStore.setDataInteraction({
            datasetId: document.dataset.id, timeRange: null, brush: null,
          }, "production-surveillance")}>Clear time filter</CommandButton>}
        </div>
        {visibleEvents.length ? <ol className="sw-production-event-list">
          {visibleEvents.map((event) => <li key={event.id}>
            <CommandButton kind="selection"
              type="button"
              className={activeEventId === event.id ? "is-active" : ""}
              aria-pressed={activeEventId === event.id}
              onClick={() => selectEvent(event)}
            >
              <span className={`sw-production-event-kind sw-production-event-kind-${event.kind}`}>{event.kind.replaceAll("-", " ")}</span>
              <strong>{event.summary}</strong>
              <span>{formatUtc(event.startTimeMs)}{event.endTimeMs !== null && event.endTimeMs !== event.startTimeMs ? ` – ${formatUtc(event.endTimeMs)}` : ""}</span>
              <span>{eventDepth(event)}</span>
              <small>Source: {event.source ?? "not reported"}</small>
            </CommandButton>
          </li>)}
        </ol> : <p className="sw-production-empty">No events match the selected UTC time range.</p>}
      </section>

      {assembly ? <section className="sw-production-schematic" aria-label="Well construction context">
        <h3>Well construction context</h3>
        <p>Event measured depth is shown on this supplied construction schematic when available.</p>
        <AssemblySchematic
          assembly={assembly}
          assetBaseUrl={assetBaseUrl}
          selectedId={visibleEvents.find((event) => event.id === activeEventId)?.componentId ?? null}
          cursorDepthM={cursorDepthM}
          title={`${document.wellLabel} construction schematic`}
        />
      </section> : <section className="sw-production-schematic" aria-label="Well construction context">
        <h3>Well construction context</h3>
        <p>Construction schematic not supplied; events remain available with reported depth values.</p>
      </section>}
    </div>
  </section>;
}
