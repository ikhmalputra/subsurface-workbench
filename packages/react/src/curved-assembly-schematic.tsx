"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { scaleLinear } from "d3-scale";
import { getCatalogEntry, surveyPointAtMd } from "@ikhmalputra/subsurface-core";
import type { FormationLayer, SurveyPoint } from "@ikhmalputra/subsurface-core";
import type { AssemblySchematicProps } from "./assembly-schematic.js";
import { catalogIdFromDrag } from "./assembly-palette.js";
import { formatDepth, formatInches } from "./assembly-format.js";
import { InteractiveViewport } from "./viewport.js";

export interface CurvedAssemblySchematicProps extends Pick<AssemblySchematicProps, "assembly" | "assetBaseUrl" | "selectedId" | "issues" | "onSelect" | "onDropComponent" | "onMoveComponent" | "onRemoveComponent" | "records"> {
  readonly survey?: readonly SurveyPoint[];
  readonly formations?: readonly FormationLayer[];
}

const reportedMaterial = (value: string | undefined) => value && !/not reported/i.test(value) ? value : null;

/** Vertical section of the actual survey; tubular widths are exaggerated for legibility. */
export function CurvedAssemblySchematic({ assembly, survey, formations = [], selectedId, issues = [], onSelect, onDropComponent, onMoveComponent, onRemoveComponent, records }: CurvedAssemblySchematicProps) {
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
    const holeOds = (records ?? []).filter((record) => record.kind === "Hole" && record.outerDiameterMm !== null).map((record) => record.outerDiameterMm! / 25.4);
    const radius = Math.max(12, ...assembly.items.map((item) => item.odIn * 1.8), ...holeOds.map((od) => od * 1.8));
    // Room on the right for shoe labels, and below for the departure axis.
    const availableWidth = Math.max(1, size.width - 300 - radius * 2);
    const availableHeight = Math.max(1, size.height - 110);
    const scale = Math.min(availableWidth / Math.max(maxX - minX, 1), availableHeight / Math.max(maxY - minY, 1));
    const x = scaleLinear().domain([minX, minX + availableWidth / scale]).range([70 + radius, 70 + radius + availableWidth]);
    const y = scaleLinear().domain([minY, minY + availableHeight / scale]).range([30, size.height - 80]);
    const shift = (availableWidth - (maxX - minX) * scale) / 2;
    const xOf = (departure: number) => x(departure) + shift;
    const center = (md: number) => { const point = position(md); return { x: xOf(point.departure), y: y(point.tvd) }; };
    const offset = (md: number, radius: number) => {
      const point = center(md), a = center(Math.max(first.mdM, md - 1)), b = center(Math.min(last.mdM, md + 1));
      const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: point.x + (b.y - a.y) / length * radius, y: point.y - (b.x - a.x) / length * radius };
    };
    const path = (top: number, bottom: number, radius = 0) => {
      const points = [top, ...samples.filter((point) => point.md > top && point.md < bottom).map((point) => point.md), bottom];
      return points.map((md, index) => { const point = offset(md, radius); return `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`; }).join(" ");
    };
    /** A closed band between two offsets on one side of the path: cement, or the annulus to the hole wall. */
    const band = (top: number, bottom: number, inner: number, outer: number) => {
      const points = [top, ...samples.filter((point) => point.md > top && point.md < bottom).map((point) => point.md), bottom];
      const out = points.map((md) => offset(md, outer)), back = [...points].reverse().map((md) => offset(md, inner));
      return [...out, ...back].map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ") + " Z";
    };
    const departures = scaleLinear().domain([minX, maxX]).nice().ticks(5).filter((tick) => tick >= minX - 1 && tick <= maxX + 1);
    return { path, band, center, offset, xOf, departures, position, samples: samples.map((point) => ({ ...center(point.md), md: point.md })), y, first, last, endMd, hasCoverage };
  }, [assembly.totalDepthM, assembly.items, survey, size, records]);
  const holes = (records ?? []).filter((record) => record.kind === "Hole" && record.outerDiameterMm !== null);
  const holeAt = (md: number) => holes.find((hole) => hole.topDepthM <= md && hole.bottomDepthM >= md);
  const recordOf = new Map((records ?? []).map((record) => [record.id as string, record]));
  const strings = assembly.items.filter((item) => ["casing", "liner", "tubing"].includes(getCatalogEntry(item.catalogId).slot)).sort((a, b) => a.bottomM - b.bottomM);
  const shoeLabels = (() => {
    // Shoe labels stack down the right-hand margin with leaders, never on top of one another.
    let cursor = -Infinity;
    return strings.filter((item) => item.bottomM <= geometry.last.mdM + 1e-6 && geometry.hasCoverage).map((item) => {
      const spec = getCatalogEntry(item.catalogId);
      const at = geometry.offset(item.bottomM, Math.max(4, item.odIn * 1.8));
      const ly = Math.max(at.y, cursor + 46);
      cursor = ly;
      const tvd = geometry.position(item.bottomM).tvd;
      return { item, color: spec.color, at, ly, tvd, tubing: spec.slot === "tubing" };
    });
  })();
  const labelX = size.width - 214;
  const mdStep = (() => { const raw = assembly.totalDepthM / 6, power = 10 ** Math.floor(Math.log10(raw)), unit = raw / power; return (unit < 1.5 ? 1 : unit < 3.5 ? 2.5 : unit < 7.5 ? 5 : 10) * power; })();
  const lastStation = survey?.at(-1);
  const selected = assembly.items.find((item) => item.id === selectedId);
  const items = [...assembly.items].sort((a, b) => b.odIn - a.odIn);
  const radiusMax = Math.max(12, ...assembly.items.map((item) => item.odIn * 1.8), ...(records ?? []).filter((record) => record.kind === "Hole" && record.outerDiameterMm !== null).map((record) => record.outerDiameterMm! / 25.4 * 1.8));
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
        {geometry.hasCoverage && holes.map((hole) => {
          const top = Math.max(geometry.first.mdM, hole.topDepthM), bottom = Math.min(geometry.endMd, hole.bottomDepthM);
          if (!(bottom > top)) return null;
          const R = hole.outerDiameterMm! / 25.4 * 1.8;
          return <g key={hole.id} className="sw-curved-hole" data-hole-id={hole.id} pointerEvents="none">
            <path d={`${geometry.band(top, bottom, 0, R)} ${geometry.band(top, bottom, -R, 0)}`} className="sw-curved-borehole" />
            <path d={geometry.path(top, bottom, -R)} className="sw-curved-hole-wall" /><path d={geometry.path(top, bottom, R)} className="sw-curved-hole-wall" />
          </g>;
        })}
        {geometry.hasCoverage && assembly.items.filter((item) => getCatalogEntry(item.catalogId).slot === "cement").map((item) => {
          const host = assembly.items.find((value) => value.id === item.hostId);
          const top = Math.max(geometry.first.mdM, item.topM), bottom = Math.min(geometry.endMd, item.bottomM);
          if (!host || !(bottom > top)) return null;
          // Cement fills from its string to the next string out, else to its recorded OD or the hole drilled there.
          const recordOd = recordOf.get(item.id)?.outerDiameterMm;
          const outerString = assembly.items.filter((value) => ["casing", "liner"].includes(getCatalogEntry(value.catalogId).slot) && value.odIn > host.odIn && value.topM <= top && value.bottomM >= top).sort((a, b) => a.odIn - b.odIn)[0];
          const pieces: [number, number, number][] = [];
          const split = outerString ? Math.min(bottom, outerString.bottomM) : top;
          if (outerString && split > top) pieces.push([top, split, (outerString.idIn ?? outerString.odIn * 0.92) * 1.8]);
          if (bottom > split) { const hole = holeAt((split + bottom) / 2); pieces.push([split, bottom, (recordOd ? recordOd / 25.4 : hole ? hole.outerDiameterMm! / 25.4 : host.odIn * 1.28) * 1.8]); }
          const inner = host.odIn * 1.8;
          return <g key={`cement-${item.id}`} className="sw-curved-cement" pointerEvents="none">{pieces.map(([a, b, outer]) => <path key={a} d={`${geometry.band(a, b, inner, outer)} ${geometry.band(a, b, -outer, -inner)}`} />)}</g>;
        })}
        {geometry.hasCoverage && <path d={geometry.path(geometry.first.mdM, geometry.endMd)} className="sw-curved-centerline" />}
        {geometry.hasCoverage && Array.from({ length: Math.floor(geometry.endMd / mdStep) }, (_, index) => (index + 1) * mdStep).filter((md) => { const at = geometry.center(md), end = geometry.center(geometry.endMd); return md >= geometry.first.mdM && Math.hypot(at.x - end.x, at.y - end.y) > 110; }).map((md) => {
          const inner = geometry.offset(md, -radiusMax - 4), outer = geometry.offset(md, -radiusMax - 12);
          return <g key={md} className="sw-curved-md-tick" aria-hidden="true"><line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} /><text x={outer.x - 4} y={outer.y + 3.5} textAnchor="end">{md.toLocaleString("en-US")} MD</text></g>;
        })}
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
              </> : spec.slot === "cement"
                // The cement band itself is drawn beneath, to the hole wall; this is its pick target.
                ? <path d={geometry.path(top, bottom)} fill="none" stroke="currentColor" strokeWidth={radius * 2} opacity={active ? 0.35 : 0} pointerEvents="stroke" />
                : <path d={geometry.path(top, bottom)} fill="none" stroke="currentColor" strokeWidth={radius * 2} opacity={0.8} />}
            </>}
            <title>{`${item.label} · ${formatDepth(item.bottomM)} MD`}</title>
          </g>;
        })}
        {shoeLabels.map(({ item, color, at, ly, tvd, tubing }) => {
          const record = recordOf.get(item.id);
          const R = Math.max(4, item.odIn * 1.8);
          const shoe = geometry.offset(item.bottomM, R), inner = geometry.offset(item.bottomM - Math.max(4, assembly.totalDepthM * 0.006), R);
          return <g key={`shoe-${item.id}`} className="sw-curved-shoe" data-shoe-for={item.id} pointerEvents="none">
            {!tubing && <path d={`M${shoe.x} ${shoe.y} L${inner.x} ${inner.y} L${shoe.x + (shoe.x - geometry.center(item.bottomM).x) * 0.5} ${shoe.y + (shoe.y - geometry.center(item.bottomM).y) * 0.5} Z`} fill={color} />}
            <path d={`M${at.x + 4} ${at.y} L${labelX - 10} ${ly} H${labelX - 4}`} className="sw-curved-leader" />
            <rect x={labelX} y={ly - 9} width={4} height={record?.rawBottomDepthFt ? 39 : 26} rx={1} fill={color} />
            <text x={labelX + 9} y={ly} className="sw-curved-label-title">{item.label.length > 30 ? `${item.label.slice(0, 29)}…` : item.label}</text>
            <text x={labelX + 9} y={ly + 13} className="sw-curved-label-detail">{tubing ? "Tail" : "Shoe"} {formatDepth(item.bottomM)} MD · {formatDepth(tvd)} TVD</text>
            {record?.rawBottomDepthFt ? <text x={labelX + 9} y={ly + 26} className="sw-curved-label-detail">Reported {record.rawBottomDepthFt.toLocaleString("en-US")} ft{reportedMaterial(record.material) ? ` · ${reportedMaterial(record.material)!.split(" / ")[0]}` : ""}</text> : null}
          </g>;
        })}
        {geometry.hasCoverage && (() => {
          const end = geometry.center(geometry.endMd);
          return <text x={end.x - 6} y={end.y + 18} textAnchor="end" className="sw-curved-td">TD {formatDepth(geometry.endMd)} MD · {formatDepth(geometry.position(geometry.endMd).tvd)} TVD{lastStation ? ` · inc ${lastStation.inclinationDeg.toFixed(1)}°` : ""}</text>;
        })()}
        <g className="sw-curved-departure" aria-hidden="true">
          <line x1={70} x2={size.width - 230} y1={size.height - 50} y2={size.height - 50} />
          {geometry.departures.map((tick) => <g key={tick}><line x1={geometry.xOf(tick)} x2={geometry.xOf(tick)} y1={size.height - 50} y2={size.height - 45} /><text x={geometry.xOf(tick)} y={size.height - 34} textAnchor="middle">{Math.round(tick).toLocaleString("en-US")}</text></g>)}
        </g>
        <text x={size.width / 2} y={size.height - 12} textAnchor="middle" className="sw-curved-axis">Departure along the section, m · TVD, m · true scale in depth and departure · widths exaggerated</text>
      </svg>
    </InteractiveViewport>
    <p className="sw-curved-status" role="status">{selected ? `${selected.label} · ${formatInches(selected.odIn)} · ${formatDepth(selected.bottomM)} MD` : `${assembly.items.length} components · ${formatDepth(assembly.totalDepthM)} MD`}
      {survey?.length ? ` · Survey coverage ${formatDepth(survey[0]!.mdM)}–${formatDepth(survey.at(-1)!.mdM)}` : " · Vertical well (no directional survey)"}
      {!geometry.hasCoverage && " · No survey coverage within the assembly depth"}
    </p>
  </section>;
}
