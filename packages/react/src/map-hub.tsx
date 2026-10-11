"use client";

import { useId, useMemo, type KeyboardEvent, type MouseEvent } from "react";
import type { SpatialReference, SubsurfaceWellboreTrajectory } from "@ikhmalputra/subsurface-core/contracts";
import { validateWellboreTrajectory } from "@ikhmalputra/subsurface-core/contracts";
import { createSubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import type { SpatialXYZ, SubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import { useSubsurfaceSelector } from "./state-hooks.js";
import { AccessibleTable, getAccessibleRowsPage } from "./accessible-table.js";

export interface MapWell {
  readonly id: string;
  readonly label: string;
  readonly provenance: "documented" | "synthetic" | "user-authored";
  readonly trajectory: SubsurfaceWellboreTrajectory;
}

export interface MapOutline {
  readonly id: string;
  readonly label: string;
  readonly kind: "seismic" | "surface";
  readonly reference: SpatialReference;
  /** Flat [X0,Y0,X1,Y1,...] coordinates in the same metre-based map frame. */
  readonly xy: Float32Array | Float64Array;
  /** Seismic footprints are always closed; surface outlines are open unless explicitly closed. */
  readonly closed?: boolean;
}

export interface MapHubProps {
  readonly wells: readonly MapWell[];
  readonly outlines?: readonly MapOutline[];
  readonly store?: SubsurfaceStore;
  readonly title?: string;
  readonly onFocusWell?: (wellId: string) => void;
  readonly onSpatialPick?: (wellId: string, xyz: SpatialXYZ) => void;
}

const WIDTH = 960;
const HEIGHT = 600;
const PLOT = { left: 76, right: 28, top: 40, bottom: 58 };

function sameReference(a: SpatialReference, b: SpatialReference): boolean {
  return a.units === b.units && a.crs === b.crs && a.depthDatum === b.depthDatum;
}

function validateInputs(wells: readonly MapWell[], outlines: readonly MapOutline[]) {
  if (!wells.length) throw new RangeError("The map hub requires at least one well trajectory.");
  if (new Set(wells.map((well) => well.id)).size !== wells.length) throw new TypeError("Map well IDs must be unique.");
  if (new Set(outlines.map((outline) => outline.id)).size !== outlines.length) throw new TypeError("Map outline IDs must be unique.");
  const reference = wells[0]!.trajectory.reference;
  const validatedWells = wells.map((well) => {
    if (!well.id.trim() || !well.label.trim() || well.trajectory.id !== well.id) {
      throw new TypeError(`Map trajectory must belong to well "${well.id}".`);
    }
    const trajectory = validateWellboreTrajectory(well.trajectory);
    if (!sameReference(trajectory.reference, reference)) {
      throw new TypeError("Map wells must share the same declared units, CRS, and depth datum; transform them explicitly before rendering.");
    }
    return { ...well, trajectory };
  });
  for (const outline of outlines) {
    if (!outline.id.trim() || !outline.label.trim()) throw new TypeError("Map outlines require stable IDs and non-empty labels.");
    if (outline.kind !== "seismic" && outline.kind !== "surface") throw new TypeError(`Map outline "${outline.id}" has an unsupported kind.`);
    if (outline.closed !== undefined && typeof outline.closed !== "boolean") throw new TypeError(`Map outline "${outline.id}" closed must be boolean.`);
    if (!sameReference(outline.reference, reference)) {
      throw new TypeError(`Map outline "${outline.id}" uses a different declared spatial reference.`);
    }
    if (!(outline.xy instanceof Float32Array || outline.xy instanceof Float64Array) || outline.xy.length < 6 || outline.xy.length % 2 !== 0) {
      throw new TypeError(`Map outline "${outline.id}" must contain at least three flat XY points.`);
    }
    for (let index = 0; index < outline.xy.length; index += 1) {
      if (!Number.isFinite(outline.xy[index])) throw new TypeError(`Map outline "${outline.id}" contains a non-finite coordinate at index ${index}.`);
    }
  }
  return { reference, wells: validatedWells };
}

/** Linked XY overview. Picks publish an exact source trajectory station, not a fabricated interpolated point. */
export function MapHub({
  wells,
  outlines = [],
  store,
  title = "Map hub",
  onFocusWell,
  onSpatialPick,
}: MapHubProps) {
  const activeStore = useMemo(() => store ?? createSubsurfaceStore(), [store]);
  const activeWellId = useSubsurfaceSelector(activeStore, (state) => state.activeAsset.wellId);
  const model = useMemo(() => {
    const validated = validateInputs(wells, outlines);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const include = (x: number, y: number) => {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    };
    for (const well of validated.wells) {
      const { xyz } = well.trajectory;
      for (let index = 0; index < xyz.length; index += 3) include(xyz[index]!, xyz[index + 1]!);
    }
    for (const outline of outlines) {
      for (let index = 0; index < outline.xy.length; index += 2) include(outline.xy[index]!, outline.xy[index + 1]!);
    }
    const pad = (span: number) => Math.max(span * 0.06, 10);
    const xPad = pad(maxX - minX), yPad = pad(maxY - minY);
    minX -= xPad; maxX += xPad; minY -= yPad; maxY += yPad;
    const plot = { x: PLOT.left, y: PLOT.top, width: WIDTH - PLOT.left - PLOT.right, height: HEIGHT - PLOT.top - PLOT.bottom };
    const x = (value: number) => plot.x + (value - minX) / (maxX - minX) * plot.width;
    const y = (value: number) => plot.y + (maxY - value) / (maxY - minY) * plot.height;
    const wellPaths = validated.wells.map((well) => {
      const { xyz } = well.trajectory;
      const path = Array.from({ length: well.trajectory.depthsMdM.length }, (_, index) =>
        `${index ? "L" : "M"}${x(xyz[index * 3]!).toFixed(2)},${y(xyz[index * 3 + 1]!).toFixed(2)}`).join("");
      return { well, path };
    });
    const outlinePaths = outlines.map((outline) => {
      const points = Array.from({ length: outline.xy.length / 2 }, (_, index) =>
        `${index ? "L" : "M"}${x(outline.xy[index * 2]!).toFixed(2)},${y(outline.xy[index * 2 + 1]!).toFixed(2)}`);
      return { outline, path: `${points.join("")}${outline.kind === "seismic" || outline.closed ? "Z" : ""}` };
    });
    return { ...validated, minX, maxX, minY, maxY, plot, x, y, wellPaths, outlinePaths };
  }, [wells, outlines]);

  const selectable = Boolean(store || onFocusWell || onSpatialPick);
  const tableRowCount = model.wells.reduce((total, well) => total + well.trajectory.depthsMdM.length, 0)
    + model.outlinePaths.reduce((total, { outline }) => total + outline.xy.length / 2, 0);
  const summaryId = useId();
  const pickWell = (well: MapWell, event: MouseEvent<SVGPathElement>) => {
    onFocusWell?.(well.id);
    activeStore.focusAsset(well.id, null, "map-hub");
    const svg = event.currentTarget.ownerSVGElement;
    const rect = svg?.getBoundingClientRect();
    if (!svg || !rect || rect.width === 0 || rect.height === 0) return;
    const mapX = model.minX + ((event.clientX - rect.left) / rect.width * WIDTH - model.plot.x) / model.plot.width * (model.maxX - model.minX);
    const mapY = model.maxY - ((event.clientY - rect.top) / rect.height * HEIGHT - model.plot.y) / model.plot.height * (model.maxY - model.minY);
    const { xyz: coordinates, depthsMdM } = well.trajectory;
    let nearest = 0, nearestDistance = Infinity;
    for (let index = 0; index < depthsMdM.length; index += 1) {
      const dx = (coordinates[index * 3]! - mapX) / (model.maxX - model.minX) * model.plot.width;
      const dy = (coordinates[index * 3 + 1]! - mapY) / (model.maxY - model.minY) * model.plot.height;
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) { nearest = index; nearestDistance = distance; }
    }
    const xyz: SpatialXYZ = [coordinates[nearest * 3]!, coordinates[nearest * 3 + 1]!, coordinates[nearest * 3 + 2]!];
    onSpatialPick?.(well.id, xyz);
    activeStore.triggerSpatialPick(xyz, "map-hub");
  };

  const xTicks = Array.from({ length: 5 }, (_, index) => model.minX + (model.maxX - model.minX) * index / 4);
  const yTicks = Array.from({ length: 5 }, (_, index) => model.minY + (model.maxY - model.minY) * index / 4);
  return <section className="sw-map-hub" aria-label={title} data-testid="map-hub">
    <header className="sw-map-hub-head">
      <div><h2>{title}</h2><p>{model.reference.crs} · X/Y in metres · Z down</p></div>
      <span>{wells.length} well{wells.length === 1 ? "" : "s"} · {outlines.length} outline{outlines.length === 1 ? "" : "s"}</span>
    </header>
    <div className="sw-map-hub-scroll">
      <svg className="sw-map-hub-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ width: `max(100%, ${WIDTH}px)`, height: `${HEIGHT}px` }} preserveAspectRatio="none" role="group" aria-label={`${title}, plan view of well paths and outlines`} aria-describedby={summaryId}>
        {xTicks.map((tick) => <g key={`x-${tick}`} aria-hidden="true">
          <line x1={model.x(tick)} x2={model.x(tick)} y1={model.plot.y} y2={model.plot.y + model.plot.height} className="sw-map-hub-grid" />
          <text x={model.x(tick)} y={model.plot.y + model.plot.height + 18} textAnchor="middle" className="sw-map-hub-axis">{Math.round(tick).toLocaleString()}</text>
        </g>)}
        {yTicks.map((tick) => <g key={`y-${tick}`} aria-hidden="true">
          <line x1={model.plot.x} x2={model.plot.x + model.plot.width} y1={model.y(tick)} y2={model.y(tick)} className="sw-map-hub-grid" />
          <text x={model.plot.x - 8} y={model.y(tick) + 4} textAnchor="end" className="sw-map-hub-axis">{Math.round(tick).toLocaleString()}</text>
        </g>)}
        <text x={model.plot.x + model.plot.width / 2} y={HEIGHT - 12} textAnchor="middle" className="sw-map-hub-axis">X (m)</text>
        <text x={16} y={model.plot.y + model.plot.height / 2} transform={`rotate(-90 16 ${model.plot.y + model.plot.height / 2})`} textAnchor="middle" className="sw-map-hub-axis">Y (m)</text>
        {model.outlinePaths.map(({ outline, path }) => <path key={outline.id} d={path} className={`sw-map-hub-outline is-${outline.kind}`} aria-hidden="true" data-outline-id={outline.id}>
          <title>{`${outline.label} outline; supplied by the host in ${model.reference.crs}.`}</title>
        </path>)}
        {model.wellPaths.map(({ well, path }) => {
          const { xyz } = well.trajectory;
          const headX = xyz[0]!, headY = xyz[1]!;
          const hitAttributes = selectable ? {
            role: "button" as const,
            tabIndex: 0,
            "aria-label": `Focus ${well.label} and pick nearest trajectory station`,
            onClick: (event: MouseEvent<SVGPathElement>) => pickWell(well, event),
            onKeyDown: (event: KeyboardEvent<SVGPathElement>) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                const index = Math.floor((well.trajectory.depthsMdM.length - 1) / 2);
                const xyz: SpatialXYZ = [xyzArray[index * 3]!, xyzArray[index * 3 + 1]!, xyzArray[index * 3 + 2]!];
                onFocusWell?.(well.id);
                activeStore.focusAsset(well.id, null, "map-hub");
                onSpatialPick?.(well.id, xyz);
                activeStore.triggerSpatialPick(xyz, "map-hub");
              }
            },
          } : { "aria-hidden": true as const };
          const xyzArray = well.trajectory.xyz;
          return <g key={well.id} data-well-id={well.id} className={activeWellId === well.id ? "is-active" : undefined}>
            <path d={path} className={`sw-map-hub-well-path is-${well.provenance}`} aria-hidden="true" pointerEvents="none" />
            <path d={path} className="sw-map-hub-hit-target" {...hitAttributes} />
            <circle cx={model.x(headX)} cy={model.y(headY)} r={5} className="sw-map-hub-wellhead" aria-hidden="true" />
            <text x={model.x(headX) + 8} y={model.y(headY) - 8} className="sw-map-hub-label" aria-hidden="true">{well.label}</text>
          </g>;
        })}
      </svg>
    </div>
    <p className="sw-sr-only" id={summaryId}>{wells.length} wells and {outlines.length} supplied map outlines in {model.reference.crs}. Well selection focuses that well and publishes a supplied trajectory station; use keyboard activation to select the mid-trajectory station.</p>
    <AccessibleTable
      label="map coordinates"
      description={`Supplied trajectory stations and outline vertices in ${model.reference.crs}; coordinates are in metres with Z positive down.`}
      columns={[{ label: "Feature" }, { label: "Kind" }, { label: "Sample" }, { label: "MD", unit: "m" }, { label: "X", unit: "m" }, { label: "Y", unit: "m" }, { label: "Z", unit: "m, positive down" }]}
      rowCount={tableRowCount}
      getRows={(start, end) => getAccessibleRowsPage([
        ...model.wells.map((well) => ({
          rowCount: well.trajectory.depthsMdM.length,
          getRow: (index: number) => [
            well.label,
            "Well trajectory",
            `station ${index + 1}`,
            well.trajectory.depthsMdM[index] ?? null,
            well.trajectory.xyz[index * 3] ?? null,
            well.trajectory.xyz[index * 3 + 1] ?? null,
            well.trajectory.xyz[index * 3 + 2] ?? null,
          ],
        })),
        ...model.outlinePaths.map(({ outline }) => ({
          rowCount: outline.xy.length / 2,
          getRow: (index: number) => [
            outline.label,
            outline.kind === "seismic" ? "Seismic footprint" : "Surface outline",
            `vertex ${index + 1}`,
            null,
            outline.xy[index * 2] ?? null,
            outline.xy[index * 2 + 1] ?? null,
            null,
          ],
        })),
      ], start, end)}
    />
    <footer className="sw-map-hub-legend">
      <span><i className="is-well" />Well trajectory</span>
      {outlines.some((outline) => outline.kind === "seismic") && <span><i className="is-seismic" />Seismic footprint</span>}
      {outlines.some((outline) => outline.kind === "surface") && <span><i className="is-surface" />Surface outline</span>}
    </footer>
    {wells.some((well) => well.provenance === "synthetic") && <p className="sw-map-hub-warning">Synthetic trajectories are illustrative only; they are not measured well data.</p>}
  </section>;
}
