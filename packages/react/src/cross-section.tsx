"use client";

import { useId, useMemo } from "react";
import type { SubsurfaceWellboreTrajectory } from "@ikhmalputra/subsurface-core/contracts";
import type { SubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import { createSubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import { useSubsurfaceSelector } from "./state-hooks.js";
import { AccessibleTable, getAccessibleRowsPage } from "./accessible-table.js";

export interface CrossSectionTop {
  readonly id: string;
  readonly label: string;
  readonly mdM: number;
}

export interface CrossSectionWell {
  readonly id: string;
  readonly label: string;
  readonly provenance: "documented" | "synthetic" | "user-authored";
  readonly trajectory: SubsurfaceWellboreTrajectory;
  readonly tops: readonly CrossSectionTop[];
}

export interface CrossSectionPoint {
  readonly alongM: number;
  readonly offsetM: number;
  readonly depthM: number;
}

export interface WellCrossSectionProps {
  readonly wells: readonly CrossSectionWell[];
  readonly store?: SubsurfaceStore;
  readonly maxOffsetM?: number;
  readonly height?: number;
  readonly title?: string;
  readonly onFocusWell?: (wellId: string) => void;
}

const WIDTH = 1000;
const MARGIN = { left: 78, right: 24, top: 72, bottom: 52 };

function interpolateAtMd(trajectory: SubsurfaceWellboreTrajectory, mdM: number): readonly [number, number, number] | null {
  const depths = trajectory.depthsMdM;
  if (mdM < depths[0]! || mdM > depths[depths.length - 1]!) return null;
  let lo = 0, hi = depths.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (depths[mid]! < mdM) lo = mid + 1;
    else hi = mid;
  }
  if (depths[lo] === mdM || lo === 0) {
    return [trajectory.xyz[3 * lo]!, trajectory.xyz[3 * lo + 1]!, trajectory.xyz[3 * lo + 2]!];
  }
  const a = lo - 1, b = lo;
  const fraction = (mdM - depths[a]!) / (depths[b]! - depths[a]!);
  return [0, 1, 2].map((axis) => trajectory.xyz[3 * a + axis]! + (trajectory.xyz[3 * b + axis]! - trajectory.xyz[3 * a + axis]!) * fraction) as [number, number, number];
}

/** Project one XYZ point onto the explicitly declared vertical curtain between the end wells. */
export function projectCrossSectionPoint(
  point: readonly [number, number, number],
  origin: readonly [number, number],
  unitAlong: readonly [number, number],
): CrossSectionPoint {
  if (![...point, ...origin, ...unitAlong].every(Number.isFinite)) throw new TypeError("Cross-section coordinates must be finite.");
  return {
    alongM: (point[0] - origin[0]) * unitAlong[0] + (point[1] - origin[1]) * unitAlong[1],
    offsetM: (point[0] - origin[0]) * -unitAlong[1] + (point[1] - origin[1]) * unitAlong[0],
    depthM: point[2],
  };
}

function validateWells(wells: readonly CrossSectionWell[]) {
  if (wells.length < 2) throw new RangeError("A well cross-section requires at least two wells.");
  if (new Set(wells.map((well) => well.id)).size !== wells.length) throw new TypeError("Cross-section well IDs must be unique.");
  const first = wells[0]!.trajectory.reference;
  for (const well of wells) {
    if (!well.id.trim() || !well.label.trim() || well.trajectory.id !== well.id) {
      throw new TypeError(`Cross-section trajectory must belong to well "${well.id}".`);
    }
    const reference = well.trajectory.reference;
    if (reference.units !== first.units || reference.crs !== first.crs || reference.depthDatum !== first.depthDatum) {
      throw new TypeError("Cross-section wells must use the same declared units, CRS, and depth datum; transform them explicitly before rendering.");
    }
    const topIds = new Set<string>();
    for (const top of well.tops) {
      if (!top.id.trim() || !top.label.trim() || !Number.isFinite(top.mdM) || top.mdM < 0
        || top.mdM < well.trajectory.depthsMdM[0]!
        || top.mdM > well.trajectory.depthsMdM.at(-1)!) {
        throw new TypeError(`Well "${well.id}" has a top outside its supplied measured-depth trajectory.`);
      }
      if (topIds.has(top.id)) throw new TypeError(`Well "${well.id}" has duplicate top "${top.id}".`);
      topIds.add(top.id);
    }
  }
}

/** Vertical section through the first/last wellheads; off-plane distance is disclosed, never hidden. */
export function WellCrossSection({
  wells,
  store,
  maxOffsetM = 250,
  height = 620,
  title = "Well cross-section",
  onFocusWell,
}: WellCrossSectionProps) {
  const activeStore = useMemo(() => store ?? createSubsurfaceStore(), [store]);
  const activeWellId = useSubsurfaceSelector(activeStore, (state) => state.activeAsset.wellId);
  const model = useMemo(() => {
    validateWells(wells);
    if (!Number.isFinite(maxOffsetM) || maxOffsetM < 0) throw new RangeError("Maximum cross-section offset must be finite and non-negative.");
    if (!Number.isFinite(height) || height < 260) throw new RangeError("Cross-section height must be at least 260 pixels.");
    const start = wells[0]!.trajectory.xyz;
    const end = wells.at(-1)!.trajectory.xyz;
    const dx = end[0]! - start[0]!, dy = end[1]! - start[1]!;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length < 1e-9) throw new RangeError("The end wells must have distinct horizontal wellhead coordinates.");
    const unitAlong: readonly [number, number] = [dx / length, dy / length];
    const wellsProjected = wells.map((well) => {
      const points = Array.from({ length: well.trajectory.depthsMdM.length }, (_, index) => projectCrossSectionPoint(
        [well.trajectory.xyz[index * 3]!, well.trajectory.xyz[index * 3 + 1]!, well.trajectory.xyz[index * 3 + 2]!],
        [start[0]!, start[1]!],
        unitAlong,
      ));
      return {
        well,
        points,
        maxOffset: points.reduce((maximum, point) => Math.max(maximum, Math.abs(point.offsetM)), 0),
        tops: well.tops.map((top) => {
          const xyz = interpolateAtMd(well.trajectory, top.mdM);
          return { ...top, point: xyz ? projectCrossSectionPoint(xyz, [start[0]!, start[1]!], unitAlong) : null };
        }),
      };
    });
    let minAlong = Infinity, maxAlong = -Infinity, minDepth = Infinity, maxDepth = -Infinity;
    for (const item of wellsProjected) for (const point of item.points) {
      minAlong = Math.min(minAlong, point.alongM);
      maxAlong = Math.max(maxAlong, point.alongM);
      minDepth = Math.min(minDepth, point.depthM);
      maxDepth = Math.max(maxDepth, point.depthM);
    }
    const pad = (low: number, high: number) => Math.max((high - low) * 0.05, 10);
    const alongPad = pad(minAlong, maxAlong), depthPad = pad(minDepth, maxDepth);
    minAlong -= alongPad; maxAlong += alongPad; minDepth -= depthPad; maxDepth += depthPad;
    const plot = { x: MARGIN.left, y: MARGIN.top, width: WIDTH - MARGIN.left - MARGIN.right, height: height - MARGIN.top - MARGIN.bottom };
    const x = (value: number) => plot.x + (value - minAlong) / (maxAlong - minAlong) * plot.width;
    const y = (value: number) => plot.y + (value - minDepth) / (maxDepth - minDepth) * plot.height;
    const tops = [...new Set(wells.flatMap((well) => well.tops.map((top) => top.id)))];
    return { wellsProjected, minAlong, maxAlong, minDepth, maxDepth, plot, x, y, tops, unitAlong, length };
  }, [wells, maxOffsetM, height]);

  const tickDepths = Array.from({ length: 7 }, (_, index) => model.minDepth + (model.maxDepth - model.minDepth) * index / 6);
  const viewWidth = WIDTH;
  const incompleteTops = model.tops.flatMap((id) => {
    const tied = model.wellsProjected.filter(({ tops }) => {
      const top = tops.find((item) => item.id === id);
      return top?.point && Math.abs(top.point.offsetM) <= maxOffsetM;
    });
    if (tied.length === model.wellsProjected.length) return [];
    const label = model.wellsProjected.flatMap(({ tops }) => tops.filter((top) => top.id === id).map((top) => top.label))[0];
    const missing = model.wellsProjected.filter(({ tops }) => {
      const top = tops.find((item) => item.id === id);
      return !top?.point || Math.abs(top.point.offsetM) > maxOffsetM;
    }).map(({ well }) => well.label);
    return label ? [{ label, missing }] : [];
  });
  const tableRowCount = model.wellsProjected.reduce((total, item) => total + item.points.length + item.tops.length, 0);
  const summaryId = useId();
  const focus = (wellId: string) => {
    onFocusWell?.(wellId);
    store?.focusAsset(wellId, null, "well-cross-section");
  };

  return <section className="sw-cross-section" aria-label={title} data-testid="well-cross-section">
    <header className="sw-cross-section-head">
      <div><h2>{title}</h2><p>Vertical curtain from {wells[0]!.label} to {wells.at(-1)!.label} · {model.length.toFixed(0)} m horizontal span</p></div>
      <span>Frame: {wells[0]!.trajectory.reference.crs} · Z down · {wells[0]!.trajectory.reference.depthDatum}</span>
    </header>
    <div className="sw-cross-section-scroll">
      <svg className="sw-cross-section-svg" viewBox={`0 0 ${viewWidth} ${height}`} style={{ width: `max(100%, ${viewWidth}px)`, height: `${height}px` }} preserveAspectRatio="none" role="group" aria-label={`${title}, vertical along-section distance and depth`} aria-describedby={summaryId}>
        {Array.from({ length: 7 }, (_, index) => model.minAlong + (model.maxAlong - model.minAlong) * index / 6).map((along) => <g key={along} aria-hidden="true">
          <line x1={model.x(along)} x2={model.x(along)} y1={model.plot.y} y2={model.plot.y + model.plot.height} className="sw-cross-section-grid" />
          <text x={model.x(along)} y={height - 32} textAnchor="middle" className="sw-cross-section-axis">{Math.round(along).toLocaleString()} m</text>
        </g>)}
        {tickDepths.map((depth) => <g key={depth} aria-hidden="true">
          <line x1={model.plot.x} x2={model.plot.x + model.plot.width} y1={model.y(depth)} y2={model.y(depth)} className="sw-cross-section-grid" />
          <text x={model.plot.x - 8} y={model.y(depth) + 4} textAnchor="end" className="sw-cross-section-axis">{Math.round(depth).toLocaleString()} m</text>
        </g>)}
        <text x={model.plot.x + model.plot.width / 2} y={height - 12} textAnchor="middle" className="sw-cross-section-axis">Along curtain (m)</text>
        <text x={16} y={model.plot.y + model.plot.height / 2} transform={`rotate(-90 16 ${model.plot.y + model.plot.height / 2})`} textAnchor="middle" className="sw-cross-section-axis">Depth, positive down (m)</text>
        {model.wellsProjected.map(({ well, points, maxOffset, tops }, index) => {
          const path = points.map((point, pointIndex) => `${pointIndex ? "L" : "M"}${model.x(point.alongM).toFixed(2)},${model.y(point.depthM).toFixed(2)}`).join("");
          const head = points[0]!;
          const offPlane = maxOffset > maxOffsetM;
          return <g key={well.id} data-well-id={well.id}>
            <path
              d={path}
              className={`sw-cross-section-path${offPlane ? " is-off-plane" : ""}${well.id === activeWellId ? " is-active" : ""}`}
              aria-hidden="true" pointerEvents="none"
            />
            <path
              d={path}
              className="sw-cross-section-hit-target"
              role="button" tabIndex={0} aria-label={`Focus ${well.label}; maximum curtain offset ${maxOffset.toFixed(0)} metres`}
              onClick={() => focus(well.id)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focus(well.id); } }}
              data-offset-m={maxOffset.toFixed(2)}
            />
            <circle cx={model.x(head.alongM)} cy={model.y(head.depthM)} r={5} className="sw-cross-section-wellhead" />
            <text x={model.x(head.alongM)} y={model.y(head.depthM) - 10} textAnchor="middle" className="sw-cross-section-label">{well.label}</text>
            <text x={model.x(head.alongM)} y={model.plot.y - 13} textAnchor="middle" className="sw-cross-section-provenance">{well.provenance.toUpperCase()}</text>
            {tops.map((top) => top.point && <g key={top.id} data-top-id={top.id}>
              <circle cx={model.x(top.point.alongM)} cy={model.y(top.point.depthM)} r={3.5} className="sw-cross-section-top" />
              <text x={model.x(top.point.alongM) + 5} y={model.y(top.point.depthM) - 4} className="sw-cross-section-top-label">{top.label}</text>
            </g>)}
            {offPlane && <title>{`${well.label} is ${maxOffset.toFixed(0)} m from the curtain; shown as a projected path.`}</title>}
            <metadata>{`Well ${index + 1} maximum offset ${maxOffset.toFixed(2)} m`}</metadata>
          </g>;
        })}
        {model.tops.map((id) => {
          const points = model.wellsProjected.map(({ tops }) => {
            const top = tops.find((item) => item.id === id);
            return top?.point && Math.abs(top.point.offsetM) <= maxOffsetM ? top.point : null;
          });
          const segments: string[] = [];
          for (let index = 1; index < points.length; index += 1) {
            const previous = points[index - 1], current = points[index];
            if (previous && current) {
              segments.push(`M${model.x(previous.alongM).toFixed(2)},${model.y(previous.depthM).toFixed(2)}L${model.x(current.alongM).toFixed(2)},${model.y(current.depthM).toFixed(2)}`);
            }
          }
          return segments.length ? <path key={id} d={segments.join("")} className="sw-cross-section-top-link" data-linked-top={id} aria-hidden="true" /> : null;
        })}
      </svg>
    </div>
    <p className="sw-sr-only" id={summaryId}>{wells.length} wells across a {model.length.toFixed(0)} metre curtain. Depth is positive down. Dashed trajectories are outside the declared curtain tolerance. Formation tops connect only when explicit IDs match.</p>
    <AccessibleTable
      label="cross-section stations and tops"
      description="Projected trajectory stations and supplied formation tops. Along-curtain distance, offset, and depth are in the declared metre frame; no values are extrapolated."
      columns={[{ label: "Kind" }, { label: "Well" }, { label: "ID / label" }, { label: "MD", unit: "m" }, { label: "Along", unit: "m" }, { label: "Offset", unit: "m" }, { label: "Depth", unit: "m, positive down" }]}
      rowCount={tableRowCount}
      getRows={(start, end) => getAccessibleRowsPage(model.wellsProjected.flatMap(({ well, points, tops }) => [
        {
          rowCount: points.length,
          getRow: (index: number) => {
            const point = points[index]!;
            return ["Trajectory station", well.label, `station ${index + 1}`, well.trajectory.depthsMdM[index] ?? null, point.alongM, point.offsetM, point.depthM];
          },
        },
        {
          rowCount: tops.length,
          getRow: (index: number) => {
            const top = tops[index]!;
            return ["Formation top", well.label, top.label, top.mdM, top.point?.alongM ?? null, top.point?.offsetM ?? null, top.point?.depthM ?? null];
          },
        },
      ]), start, end)}
    />
    {incompleteTops.length > 0 && <p className="sw-cross-section-warning" role="note">
      Unmatched tops are not connected: {incompleteTops.map((top) => `${top.label} missing or outside tolerance in ${top.missing.join(", ")}`).join("; ")}.
    </p>}
    {model.wellsProjected.some((item) => item.maxOffset > maxOffsetM) && <p className="sw-cross-section-warning" role="note">
      Projected wells outside the {maxOffsetM.toLocaleString()} m curtain tolerance are dashed; offset is reported in each well's accessible label.
    </p>}
    <footer className="sw-cross-section-legend"><span><i />Well trajectory</span><span><i className="is-top" />Correlated top (matching ID only)</span><span><i className="is-offset" />Outside curtain tolerance</span></footer>
    {wells.some((well) => well.provenance === "synthetic") && <p className="sw-cross-section-warning">Synthetic trajectories and tops are illustrative only; they are not measured well data.</p>}
  </section>;
}
