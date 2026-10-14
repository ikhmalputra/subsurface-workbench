"use client";

import type { SelectionStore } from "@ikhmalputra/subsurface-kernel";
import type { Placement } from "@ikhmalputra/subsurface-scene";
import { useLinked } from "./use-selection.ts";

/**
 * The construction, drawn flat against a depth axis.
 *
 * It takes the same `Placement[]` the three.js assembly takes. That is the point: the 2D schematic
 * and the 3D scene cannot disagree about where a casing shoe is, what diameter it was drawn at or
 * whether that diameter was reported, because neither of them decides. Both read the answer the
 * scene layer computed.
 *
 * Previously each view worked it out separately, which is how a shoe could sit at one depth in the
 * schematic and another in the cutaway.
 */

export interface WellSchematicProps {
  readonly placements: readonly Placement[];
  /** The depth range to draw, in metres MD. */
  readonly fromMdM: number;
  readonly toMdM: number;
  /** Link to other views by sharing a store. Without one the schematic keeps its own selection. */
  readonly store?: SelectionStore;
  readonly height?: number;
  readonly width?: number;
  readonly title?: string;
}

const PAD = { top: 18, bottom: 18, left: 54, right: 8 };

export function WellSchematic({ placements, fromMdM, toMdM, store, height = 520, width = 320, title = "Well construction" }: WellSchematicProps) {
  const linked = useLinked("schematic", store);
  const span = Math.max(1e-9, toMdM - fromMdM);
  const plot = Math.max(1, height - PAD.top - PAD.bottom);
  const y = (mdM: number) => PAD.top + ((mdM - fromMdM) / span) * plot;
  const axis = PAD.left + (width - PAD.left - PAD.right) / 2;

  // Widest first, so a production string inside an intermediate one is not hidden by it.
  const ordered = [...placements].sort((a, b) => b.radiusScale * b.entry.bounds.radius - a.radiusScale * a.entry.bounds.radius);
  const widest = ordered[0] ? ordered[0].radiusScale * ordered[0].entry.bounds.radius : 1;
  const halfWidth = (placement: Placement) =>
    Math.max(2, ((placement.radiusScale * placement.entry.bounds.radius) / widest) * ((width - PAD.left - PAD.right) / 2 - 4));

  const cursorY = linked.cursorMdM === null || linked.cursorMdM < fromMdM || linked.cursorMdM > toMdM ? null : y(linked.cursorMdM);

  return <svg className="sw-schematic" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}
    onPointerLeave={() => linked.hover(null)}
    onPointerMove={(event) => {
      const box = event.currentTarget.getBoundingClientRect();
      const at = fromMdM + ((event.clientY - box.top - PAD.top) / plot) * span;
      linked.hover(at >= fromMdM && at <= toMdM ? at : null);
    }}>
    <title>{title}</title>
    {ordered.map((placement) => {
      const top = y(Math.max(fromMdM, placement.topMdM));
      const base = y(Math.min(toMdM, placement.baseMdM));
      const half = halfWidth(placement);
      const selected = linked.selection.componentId === placement.componentId;
      return <g key={placement.componentId} className="sw-schematic-part" data-component={placement.componentId}
        data-basis={placement.radiusBasis} data-selected={selected || undefined}
        onClick={() => linked.select(selected ? null : placement.componentId)}>
        <title>{`${placement.componentId} — ${placement.note}`}</title>
        <rect x={axis - half} y={top} width={half * 2} height={Math.max(1, base - top)}
          fill={selected ? "var(--sw-selected, #ececfb)" : "var(--sw-surface, #fff)"}
          stroke={placement.radiusBasis === "nominal" ? "var(--sw-muted, #626a80)" : "var(--sw-ink, #1a1d26)"}
          // A part drawn at a nominal radius is dashed. The difference between measured and assumed
          // has to be visible in the drawing, not only in a tooltip nobody opens.
          strokeDasharray={placement.radiusBasis === "nominal" ? "4 3" : undefined} />
      </g>;
    })}
    {cursorY !== null && <line className="sw-schematic-cursor" x1={0} x2={width} y1={cursorY} y2={cursorY}
      stroke="var(--sw-cursor, #5b5bd6)" strokeWidth={1.5} strokeDasharray="5 3" />}
  </svg>;
}
