"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { scaleLinear } from "d3-scale";
import { getCatalogEntry, surveyPointAtMd } from "@ikhmalputra/subsurface-core";
import type { FormationLayer, SurveyPoint } from "@ikhmalputra/subsurface-core";
import type { AssemblySchematicProps } from "./assembly-schematic.js";
import { catalogIdFromDrag } from "./assembly-palette.js";
import { formatDepth, formatInches } from "./assembly-format.js";
import { InteractiveViewport } from "./viewport.js";

export interface CurvedAssemblySchematicProps extends Pick<AssemblySchematicProps, "assembly" | "assetBaseUrl" | "selectedId" | "issues" | "onSelect" | "onDropComponent" | "onMoveComponent" | "onRemoveComponent"> {
  readonly survey?: readonly SurveyPoint[];
  readonly formations?: readonly FormationLayer[];
}

/** Vertical section of the actual survey; tubular widths are exaggerated for legibility. */
export function CurvedAssemblySchematic({ assembly, survey, formations = [], selectedId, issues = [], onSelect, onDropComponent, onMoveComponent, onRemoveComponent }: CurvedAssemblySchematicProps) {
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 800, height: 570 });
  useEffect(() => {
    const frame = svg.current?.closest(".sw-transform-wrapper");
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);
  const geometry = useMemo(() => {
    const stations = survey?.length ? survey : [
      { mdM: 0, tvdM: 0, eastingM: 0, northingM: 0, inclinationDeg: 0, azimuthDeg: 0 },
      { mdM: assembly.totalDepthM, tvdM: assembly.totalDepthM, eastingM: 0, northingM: 0, inclinationDeg: 0, azimuthDeg: 0 },
    ];
    const first = stations[0]!, last = stations.at(-1)!;
    const angle = Math.atan2(last.eastingM - first.eastingM, last.northingM - first.northingM);
    const position = (md: number) => {
      const point = surveyPointAtMd(stations, Math.max(first.mdM, Math.min(last.mdM, md)));
      return {
        md,
        departure: (point.eastingM - first.eastingM) * Math.sin(angle) + (point.northingM - first.northingM) * Math.cos(angle),
        tvd: point.tvdM,
      };
    };
    const endMd = Math.min(assembly.totalDepthM, last.mdM);
    const hasCoverage = first.mdM <= endMd;
    const samples = Array.from({ length: 241 }, (_, index) => position(first.mdM + Math.max(0, endMd - first.mdM) * index / 240));
    const minX = Math.min(0, ...samples.map((point) => point.departure));
    const maxX = Math.max(0, ...samples.map((point) => point.departure));
    const minY = Math.min(0, ...samples.map((point) => point.tvd));
    const maxY = Math.max(1, ...samples.map((point) => point.tvd));
    const radius = Math.max(12, ...assembly.items.map((item) => item.odIn * 1.8));
    const availableWidth = Math.max(1, size.width - 100 - radius * 2);
    const availableHeight = Math.max(1, size.height - 70);
    const scale = Math.min(availableWidth / Math.max(maxX - minX, 1), availableHeight / Math.max(maxY - minY, 1));
    const x = scaleLinear().domain([minX, minX + availableWidth / scale]).range([70 + radius, 70 + radius + availableWidth]);
    const y = scaleLinear().domain([minY, minY + availableHeight / scale]).range([30, size.height - 40]);
    const center = (md: number) => { const point = position(md); return { x: x(point.departure) + (availableWidth - (maxX - minX) * scale) / 2, y: y(point.tvd) }; };
    const offset = (md: number, radius: number) => {
      const point = center(md), a = center(Math.max(first.mdM, md - 1)), b = center(Math.min(last.mdM, md + 1));
      const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: point.x + (b.y - a.y) / length * radius, y: point.y - (b.x - a.x) / length * radius };
    };
    const path = (top: number, bottom: number, radius = 0) => {
      const points = [top, ...samples.filter((point) => point.md > top && point.md < bottom).map((point) => point.md), bottom];
      return points.map((md, index) => { const point = offset(md, radius); return `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`; }).join(" ");
    };
    return { path, center, offset, samples: samples.map((point) => ({ ...center(point.md), md: point.md })), y, first, last, endMd, hasCoverage };
  }, [assembly.totalDepthM, assembly.items, survey, size]);
  const selected = assembly.items.find((item) => item.id === selectedId);
  const items = [...assembly.items].sort((a, b) => b.odIn - a.odIn);
  function pointerDepth(clientX: number, clientY: number) {
    if (!geometry.hasCoverage) return null;
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return geometry.samples.reduce((best, sample) => Math.hypot(point.x - sample.x, point.y - sample.y) < Math.hypot(point.x - best.x, point.y - best.y) ? sample : best).md;
  }
  return <section className="sw-curved-assembly" aria-label="Curved well construction" onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); onSelect?.(null); }
  }}>
    <InteractiveViewport name="Curved well construction">
      <svg ref={svg} viewBox={`0 0 ${size.width} ${size.height}`} role="group" aria-label="Construction following the well trajectory" data-testid="curved-assembly-schematic" data-revision={assembly.revision}
        onClick={(event) => { if (!(event.target as Element).closest(".sw-curved-item")) onSelect?.(null); }}
        onDragOver={(event) => { if (onDropComponent && catalogIdFromDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
        onDrop={(event) => {
          const id = catalogIdFromDrag(event), depth = pointerDepth(event.clientX, event.clientY);
          if (id && depth !== null && onDropComponent) { event.preventDefault(); onDropComponent(id, depth); }
        }}>
        <text x="12" y="16" className="sw-curved-axis">TVD / m</text>
        {formations.map((layer) => {
          const top = Math.max(30, geometry.y(layer.topTvdM)), bottom = Math.min(size.height - 40, geometry.y(layer.bottomTvdM));
          return bottom > top && <g key={layer.id} data-formation-id={layer.id} pointerEvents="none">
            <rect x="70" y={top} width={Math.max(0, size.width - 90)} height={bottom - top} fill={layer.color} opacity="0.22" />
            <text x={size.width - 24} y={top + 14} textAnchor="end" className="sw-curved-axis">{layer.name}</text>
          </g>;
        })}
        {geometry.y.ticks(6).map((tick) => <g key={tick} aria-hidden="true"><line x1="70" x2={size.width - 20} y1={geometry.y(tick)} y2={geometry.y(tick)} className="sw-curved-grid" /><text x="62" y={geometry.y(tick) + 4} textAnchor="end" className="sw-curved-axis">{Math.round(tick).toLocaleString("en-US")}</text></g>)}
        {geometry.hasCoverage && <path d={geometry.path(geometry.first.mdM, geometry.endMd)} className="sw-curved-centerline" />}
        {items.map((item) => {
          if (!geometry.hasCoverage) return null;
          const spec = getCatalogEntry(item.catalogId), surface = spec.slot === "surface";
          const top = Math.max(geometry.first.mdM, item.topM), bottom = Math.min(geometry.last.mdM, item.bottomM);
          if (!surface && (bottom < top || top > geometry.last.mdM)) return null;
          const radius = Math.max(4, item.odIn * 1.8), active = selectedId === item.id;
          const shoe = geometry.offset(bottom, radius);
          const anchor = geometry.center(surface ? geometry.first.mdM : bottom);
          const tubular = ["casing", "liner", "tubing", "sandface"].includes(spec.slot);
          const error = issues.some((issue) => issue.itemId === item.id && issue.severity === "error");
          return <g key={item.id} role="button" tabIndex={0} aria-pressed={active} aria-label={`${item.label}, ${formatInches(item.odIn)}, ${formatDepth(item.topM)} to ${formatDepth(item.bottomM)}`}
            data-item-id={item.id} className={`sw-curved-item${active ? " is-selected" : ""}${error ? " is-error" : ""}`} style={{ color: spec.color }}
            onClick={() => onSelect?.(active ? null : item.id)} onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect?.(active ? null : item.id); }
              if (onRemoveComponent && (event.key === "Delete" || event.key === "Backspace")) { event.preventDefault(); onRemoveComponent(item.id); }
              if (onMoveComponent && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
                event.preventDefault(); onSelect?.(item.id);
                onMoveComponent(item.id, (spec.slot === "cement" ? item.topM : item.bottomM) + (event.key === "ArrowDown" ? 5 : -5));
              }
            }}>
            {surface ? <rect x={anchor.x - radius} y={anchor.y - 12} width={radius * 2} height={12} rx="2" fill="currentColor" /> : <>
              {tubular ? <>
                <path d={geometry.path(top, bottom, -radius)} fill="none" stroke="transparent" strokeWidth="9" />
                <path d={geometry.path(top, bottom, radius)} fill="none" stroke="transparent" strokeWidth="9" />
                <path d={geometry.path(top, bottom, -radius)} className="sw-curved-wall" />
                <path d={geometry.path(top, bottom, radius)} className="sw-curved-wall" />
                <circle cx={shoe.x} cy={shoe.y} r="3.5" fill="currentColor" />
              </> : <path d={geometry.path(top, bottom)} fill="none" stroke="currentColor" strokeWidth={radius * 2} opacity={spec.slot === "cement" ? 0.25 : 0.8} />}
            </>}
            <title>{`${item.label} · ${formatDepth(item.bottomM)} MD`}</title>
          </g>;
        })}
        <text x={size.width / 2} y={size.height - 12} textAnchor="middle" className="sw-curved-axis">Vertical section · widths exaggerated</text>
      </svg>
    </InteractiveViewport>
    <p className="sw-curved-status" role="status">{selected ? `${selected.label} · ${formatInches(selected.odIn)} · ${formatDepth(selected.bottomM)} MD` : `${assembly.items.length} components · ${formatDepth(assembly.totalDepthM)} MD`}
      {survey?.length ? ` · Survey coverage ${formatDepth(survey[0]!.mdM)}–${formatDepth(survey.at(-1)!.mdM)}` : " · Vertical well (no directional survey)"}
      {!geometry.hasCoverage && " · No survey coverage within the assembly depth"}
    </p>
  </section>;
}
