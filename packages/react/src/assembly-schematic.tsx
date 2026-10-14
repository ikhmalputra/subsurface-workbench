"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { scaleLinear } from "d3-scale";
import { useDepthZoom } from "./depth-zoom.js";
import { getCatalogEntry, mdAtTvd, moveComponent, placeComponent, stringsAtDepth, tvdAtSurveyMd } from "@ikhmalputra/subsurface-core";
import type { AssemblyCatalogEntry, AssemblyIssue, AssemblyItem, FormationLayer, SurveyPoint, WellAssembly, WellComponent } from "@ikhmalputra/subsurface-core";
import { Boxes, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { assetUrl, catalogIdFromDrag } from "./assembly-palette.js";
import { formatDepth, formatInches } from "./assembly-format.js";
import { ExplodedParts } from "./assembly-exploded.js";
import { CommandButton } from "./ui.js";

/** Plot inset for a view drawn as a track on a shared depth axis. */
export interface TrackFrame { readonly top: number; readonly bottom: number; readonly chromeless?: boolean }

export interface AssemblySchematicProps {
  readonly assembly: WellAssembly;
  readonly assetBaseUrl: string;
  readonly selectedId?: string | null;
  readonly issues?: readonly AssemblyIssue[];
  readonly onSelect?: (itemId: string | null) => void;
  /** Enables palette drops. Depth is measured depth in metres at the pointer. */
  readonly onDropComponent?: (catalogId: string, depthM: number) => void;
  /** Enables pointer and keyboard moves of placed items. */
  readonly onMoveComponent?: (itemId: string, depthM: number) => void;
  readonly onRemoveComponent?: (itemId: string) => void;
  readonly title?: string;
  readonly formations?: readonly FormationLayer[];
  readonly survey?: readonly SurveyPoint[];
  /** Controlled exploded mode: every component laid out on its own with its Blender render. */
  readonly exploded?: boolean;
  readonly defaultExploded?: boolean;
  readonly onExplodedChange?: (exploded: boolean) => void;
  /** Controlled measured-depth window `[top, base]` in metres; `null` fits the whole well. Leave `undefined` for an independent view. */
  readonly depthWindow?: readonly [number, number] | null;
  /** Reports zoom and pan (buttons, Ctrl/⌘ + wheel, wheel) so other depth views can follow. */
  readonly onDepthWindowChange?: (window: readonly [number, number] | null) => void;
  /**
   * Handle zoom and pan gestures on the drawing (default). A host that puts the schematic in a
   * larger depth surface — the well section — turns this off and lets that surface handle them.
   */
  readonly depthGestures?: boolean;
  /** Measured depth drawn as a cursor line, e.g. the pointer depth in a linked seismic section or log. */
  readonly cursorDepthM?: number | null;
  /** Depth intervals to mark across the drawing, e.g. a brushed log interval. MD metres. */
  readonly highlights?: readonly { readonly id: string; readonly topM: number; readonly baseM: number; readonly label: string }[];
  /**
   * Render as a track on a shared depth axis.
   *
   * `top` and `bottom` fix the plot inset in pixels, so a container laying several depth views side
   * by side can give every one the same mapping from depth to pixel; `chromeless` drops the panel's
   * own header and toolbar so the container can supply one header row for all tracks. Without it
   * the schematic picks its own inset from the surface-equipment stack and grows taller than its
   * box when annotations need room — right for a standalone panel, wrong beside other tracks.
   */
  readonly frame?: TrackFrame;
  /** Reports the measured depth under the pointer, `null` when it leaves. */
  readonly onCursorDepthChange?: (depthM: number | null) => void;
  /**
   * The source records the assembly was built from (matched by id). With them the drawing shows
   * what the records say and the assembly cannot hold: drilled hole sections and their bit sizes,
   * grade, weight and connection, cement slurry, depths as reported in feet and source pages.
   */
  readonly records?: readonly WellComponent[];
  /**
   * Formations drawn as a lithology column beside the depth rulers, whatever the earth tint
   * (`formations`) is set to. Standalone drawings only; a track leaves geology to its container.
   */
  readonly formationColumn?: readonly FormationLayer[];
}

/** A lithology name to the pattern geologists draw it with. */
type Lithology = "air" | "water" | "sand" | "shale" | "carbonate" | "crystalline" | "salt" | "coal" | "sediment" | "plain";
function lithologyOf(name: string): Lithology {
  const value = name.toLowerCase();
  if (/\bair\b/.test(value)) return "air";
  if (/water|sea/.test(value)) return "water";
  if (/salt|halite|anhydrite/.test(value)) return "salt";
  if (/coal|lignite/.test(value)) return "coal";
  if (/sand|grit|conglomerate/.test(value)) return "sand";
  if (/shale|clay|mud|silt/.test(value)) return "shale";
  if (/lime|dolo|carbonate|chalk|marl/.test(value)) return "carbonate";
  if (/granit|basement|crystalline|igneous|metamorph|gneiss|schist|basalt/.test(value)) return "crystalline";
  if (/sediment/.test(value)) return "sediment";
  return "plain";
}

function LithologyPattern({ id, kind, color }: { readonly id: string; readonly kind: Lithology; readonly color: string }) {
  const ink = "rgba(40, 46, 52, .55)";
  const glyph = kind === "sand" ? <><circle cx="2.5" cy="2.5" r=".85" fill={ink} /><circle cx="7.5" cy="7" r=".85" fill={ink} /></>
    : kind === "shale" ? <><line x1="1" y1="3" x2="5" y2="3" stroke={ink} strokeWidth=".9" /><line x1="6" y1="8" x2="9.5" y2="8" stroke={ink} strokeWidth=".9" /></>
    : kind === "carbonate" ? <><path d="M0 .5H10M0 5.5H10M5 .5V5.5M0 5.5V10M10 5.5V10" stroke={ink} strokeWidth=".7" fill="none" /></>
    : kind === "crystalline" ? <><path d="M2.5 1V4M1 2.5H4M7.5 6V9M6 7.5H9" stroke={ink} strokeWidth=".8" /></>
    : kind === "salt" ? <><path d="M0 0L10 10M10 0L0 10" stroke={ink} strokeWidth=".6" /></>
    : kind === "water" ? <><path d="M0 5 q2.5 -2 5 0 t5 0" stroke="rgba(30, 90, 140, .45)" strokeWidth=".8" fill="none" /></>
    : kind === "sediment" ? <><circle cx="2.5" cy="2.5" r=".8" fill={ink} /><line x1="5.5" y1="7.5" x2="9" y2="7.5" stroke={ink} strokeWidth=".8" /></>
    : kind === "coal" ? <rect width="10" height="10" fill="rgba(30, 30, 30, .55)" /> : null;
  return <pattern id={id} width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill={color} />{glyph}</pattern>;
}

/** The reported text of a record field, or null where the record says it was not reported. */
function reported(value: string | undefined) {
  return value && !/not reported/i.test(value) ? value : null;
}

const MAJOR_SLOTS: ReadonlySet<string> = new Set(["casing", "liner", "tubing", "cement", "sandface"]);
function wrapLabel(text: string, limit: number) {
  const lines: string[] = [];
  for (const word of text.split(/\s+/)) {
    const last = lines.at(-1);
    if (last && last.length + word.length + 1 <= limit) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

interface Preview { readonly assembly: WellAssembly; readonly focusId: string | null; readonly depthM: number; readonly message: string; readonly valid: boolean; readonly kind: "drop" | "move" }

function slot(item: AssemblyItem) { return getCatalogEntry(item.catalogId).slot; }

function anchorDepth(item: AssemblyItem) {
  const value = slot(item);
  if (value === "casing" || value === "tubing" || value === "liner") return item.bottomM;
  if (value === "cement") return item.topM;
  return (item.topM + item.bottomM) / 2;
}

function itemSummary(item: AssemblyItem) {
  const value = slot(item);
  if (value === "surface") return "Surface";
  if (value === "casing") return `${formatInches(item.odIn)} · shoe ${formatDepth(item.bottomM)}`;
  if (value === "liner") return `${formatInches(item.odIn)} · ${formatDepth(item.topM)}–${formatDepth(item.bottomM)}`;
  if (value === "cement") return `TOC ${formatDepth(item.topM)} → ${formatDepth(item.bottomM)}`;
  if (value === "tubing") return `${formatInches(item.odIn)} · tail ${formatDepth(item.bottomM)}`;
  return `${formatInches(item.odIn)} · ${formatDepth(item.topM)}`;
}

export function AssemblySchematic({ assembly, assetBaseUrl, selectedId = null, issues = [], onSelect, onDropComponent, onMoveComponent, onRemoveComponent, title = "Well construction schematic", formations = [], survey, exploded: explodedProp, defaultExploded = false, onExplodedChange, depthWindow: depthWindowProp, onDepthWindowChange, cursorDepthM = null, onCursorDepthChange, frame: trackFrame, depthGestures = true, records, formationColumn, highlights = [] }: AssemblySchematicProps) {
  const [explodedState, setExplodedState] = useState(defaultExploded);
  const exploded = explodedProp ?? explodedState;
  const toggleExploded = () => { const next = !exploded; if (explodedProp === undefined) setExplodedState(next); onExplodedChange?.(next); };
  const uid = useId().replace(/:/g, "");
  const svg = useRef<SVGSVGElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 940 });
  const W = size.width;
  const recordOf = useMemo(() => new Map((records ?? []).map((record) => [record.id as string, record])), [records]);
  // Drilled hole sections: the assembly holds steel, the records hold the hole it sits in.
  const holes = useMemo(() => (records ?? []).filter((record) => record.kind === "Hole" && record.outerDiameterMm !== null)
    .map((record) => ({ id: record.id as string, label: record.name, topM: record.topDepthM, bottomM: Math.min(record.bottomDepthM, assembly.totalDepthM), odIn: record.outerDiameterMm! / 25.4, record }))
    .sort((a, b) => a.topM - b.topM), [records, assembly.totalDepthM]);
  const holeAt = (depthM: number) => holes.find((hole) => hole.topM <= depthM && hole.bottomM >= depthM);
  // TVD on the surveyed (curved) path, not a straight chord between stations.
  const tvdAt = (mdM: number) => survey && survey.length >= 2 ? tvdAtSurveyMd(survey, mdM) : null;
  const maxOd = Math.max(30, ...assembly.items.map((item) => item.odIn), ...holes.map((hole) => hole.odIn));
  const pxPerIn = Math.min(3.6, (W * 0.42 - 70) / (maxOd * 2));
  const r = (inches: number) => inches * pxPerIn;
  const CX = W / 2;
  const RULER_X = CX - r(maxOd) - 44;
  const LABEL_X = CX + r(maxOd) + 34;
  const [preview, setPreview] = useState<Preview | null>(null);
  const shown = preview?.assembly ?? assembly;
  const [ownWindow, setOwnWindow] = useState<readonly [number, number] | null>(null);
  if (depthWindowProp !== undefined && (depthWindowProp?.[0] !== ownWindow?.[0] || depthWindowProp?.[1] !== ownWindow?.[1])) setOwnWindow(depthWindowProp);
  const depthWindow = depthWindowProp !== undefined ? depthWindowProp : ownWindow;
  const setWindow = (next: readonly [number, number] | null) => {
    const value = next ? [Math.round(next[0]), Math.round(next[1])] as const : null;
    setOwnWindow(value);
    onDepthWindowChange?.(value);
  };
  const drag = useRef<{ id: string; startY: number; moved: boolean } | null>(null);
  const td = assembly.totalDepthM;
  const [top, bottom] = depthWindow && depthWindow[1] <= td && depthWindow[1] - depthWindow[0] < td ? depthWindow : [0, td];
  const zoomed = bottom - top < td - 0.5;
  const annotatedCount = shown.items.filter((item) => slot(item) !== "surface" && (zoomed || ["casing", "liner", "tubing", "sandface"].includes(slot(item)) || item.id === selectedId) && anchorDepth(item) >= top && anchorDepth(item) <= bottom).length;
  const surfaceCount = shown.items.filter((item) => slot(item) === "surface").length;
  // As a track, the inset is dictated and the height is the box: a schematic that grew to fit
  // its annotations would stop sharing a scale with the tracks beside it.
  const Y0 = trackFrame ? trackFrame.top : Math.max(90, surfaceCount * 22 + 12);
  // Full record labels need a standalone drawing's width; a track keeps the compact ones.
  const rich = !!records && !trackFrame;
  const labelGap = zoomed ? 78 : rich ? 96 : 60;
  const H = trackFrame ? size.height : Math.max(size.height, annotatedCount * labelGap + 40);
  const Y1 = H - (trackFrame ? trackFrame.bottom : 32);
  const y = useMemo(() => scaleLinear().domain([top, bottom]).range([Y0, Y1]), [top, bottom, Y0, Y1]);
  const errors = new Set(issues.filter((issue) => issue.severity === "error" && issue.itemId).map((issue) => issue.itemId!));
  const warnings = new Set(issues.filter((issue) => issue.severity === "warning" && issue.itemId).map((issue) => issue.itemId!));

  useEffect(() => {
    const element = frame.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      // Standalone, the drawing keeps a 900px floor and scrolls inside its frame so labels have
      // room. As a track it has to fit the column it was given — a 900px drawing in a 320px
      // track shows the middle third and nothing else.
      if (width > 0 && height > 0) setSize({ width: trackFrame ? width : Math.max(900, width), height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [exploded, trackFrame]);

  useEffect(() => {
    if (frame.current) frame.current.scrollLeft = Math.max(0, (W - frame.current.clientWidth) / 2);
  }, [W, size.height, exploded]);

  // Zoom and pan are the shared depth gestures (depth-zoom.ts): Ctrl/⌘ + wheel or pinch, wheel,
  // drag, Shift + drag box, double-click. Dragging a part still moves the part.
  useDepthZoom(svg, {
    enabled: depthGestures,
    window: depthWindow && depthWindow[1] <= td && depthWindow[1] - depthWindow[0] < td ? depthWindow : null,
    axis: () => ({ extent: [0, td], plot: [Y0, Y1], minSpan: 40 }),
    onWindow: setWindow,
    ignore: ".sw-asm-item, .sw-asm-label",
    canScroll: () => { const element = frame.current; return !!element && element.scrollHeight > element.clientHeight + 1; },
  });

  function depthAt(clientY: number) {
    const element = svg.current;
    const matrix = element?.getScreenCTM();
    if (!element || !matrix) return top;
    const point = new DOMPoint(0, clientY).matrixTransform(matrix.inverse());
    const depth = y.invert(Math.min(Math.max(point.y, Y0), Y1));
    return Math.round(Math.min(Math.max(depth, 0), td));
  }

  function pointerDepth(clientY: number) {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(0, clientY).matrixTransform(matrix.inverse());
    return point.y < Y0 || point.y > Y1 ? null : Math.round(y.invert(point.y));
  }

  function zoom(factor: number) {
    const span = Math.min(td, Math.max(40, (bottom - top) * factor));
    const selected = assembly.items.find((item) => item.id === selectedId);
    const pivot = selected ? anchorDepth(selected) : (top + bottom) / 2;
    const start = Math.min(Math.max(0, pivot - span / 2), td - span);
    setWindow([start, start + span]);
  }

  function dropPreview(catalogId: string, depthM: number): Preview {
    try {
      const result = placeComponent(assembly, catalogId, depthM);
      return { assembly: result.assembly, focusId: result.itemId, depthM, message: result.note, valid: true, kind: "drop" };
    } catch (error) {
      return { assembly, focusId: null, depthM, message: error instanceof Error ? error.message : String(error), valid: false, kind: "drop" };
    }
  }

  const dropHandlers = onDropComponent ? {
    onDragOver(event: DragEvent<SVGSVGElement>) {
      const catalogId = catalogIdFromDrag(event);
      if (!catalogId) return;
      event.preventDefault();
      const depth = depthAt(event.clientY);
      if (preview?.kind === "drop" && preview.depthM === depth && preview.focusId?.startsWith(catalogId)) return;
      const next = dropPreview(catalogId, depth);
      event.dataTransfer.dropEffect = "copy";
      setPreview(next);
    },
    onDragLeave(event: DragEvent<SVGSVGElement>) {
      if (!svg.current?.contains(event.relatedTarget as Node | null)) setPreview(null);
    },
    onDrop(event: DragEvent<SVGSVGElement>) {
      const catalogId = catalogIdFromDrag(event);
      setPreview(null);
      if (!catalogId) return;
      event.preventDefault();
      onDropComponent(catalogId, depthAt(event.clientY));
    },
  } : {};

  function startMove(event: ReactPointerEvent<SVGGElement>, item: AssemblyItem) {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (!onMoveComponent || slot(item) === "surface") { onSelect?.(selectedId === item.id ? null : item.id); return; }
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: item.id, startY: event.clientY, moved: false };
  }

  function continueMove(event: ReactPointerEvent<SVGGElement>) {
    const current = drag.current;
    if (!current) return;
    if (!current.moved && Math.abs(event.clientY - current.startY) < 4) return;
    current.moved = true;
    const depth = depthAt(event.clientY);
    try {
      const next = moveComponent(assembly, current.id, depth);
      const moved = next.items.find((item) => item.id === current.id)!;
      setPreview({ assembly: next, focusId: current.id, depthM: anchorDepth(moved), message: `${moved.label}: ${itemSummary(moved)}`, valid: true, kind: "move" });
    } catch (error) {
      setPreview({ assembly, focusId: current.id, depthM: depth, message: error instanceof Error ? error.message : String(error), valid: false, kind: "move" });
    }
  }

  function endMove(event: ReactPointerEvent<SVGGElement>, item: AssemblyItem) {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    if (current.moved && preview?.valid) onMoveComponent?.(item.id, depthAt(event.clientY));
    else if (!current.moved) onSelect?.(selectedId === item.id ? null : item.id);
    setPreview(null);
  }

  function onItemKey(event: ReactKeyboardEvent<SVGGElement>, item: AssemblyItem) {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect?.(selectedId === item.id ? null : item.id); return; }
    if ((event.key === "Delete" || event.key === "Backspace") && onRemoveComponent) { event.preventDefault(); onRemoveComponent(item.id); return; }
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && onMoveComponent && slot(item) !== "surface") {
      event.preventDefault();
      const step = (event.shiftKey ? 50 : 5) * (event.key === "ArrowUp" ? -1 : 1);
      onSelect?.(item.id);
      onMoveComponent(item.id, anchorDepth(item) + step);
    }
  }

  const items = shown.items;
  const strings = items.filter((item) => slot(item) === "casing" || slot(item) === "liner");
  const tubing = items.find((item) => item.catalogId === "tubing");
  const deepestShoe = Math.max(0, ...strings.map((item) => item.bottomM));
  const innermostDeep = strings.filter((item) => item.bottomM === deepestShoe).sort((a, b) => a.odIn - b.odIn)[0];
  const holeR = innermostDeep ? r(innermostDeep.idIn ?? innermostDeep.odIn) - 2 : r(8.5);
  // Left of the MD ruler, standalone: a TVD ruler where there is a survey, then the formation column.
  const showTvd = !trackFrame && !!survey && survey.length > 1;
  const TVD_X = RULER_X - 62;
  const COL_W = 56;
  const COL_X = (showTvd ? TVD_X - 50 : RULER_X - 60) - COL_W;
  const showColumn = !trackFrame && !!formationColumn?.length && COL_X > 4;
  const tdTvd = tvdAt(td);
  const clip = `sw-asm-clip-${uid}`;
  const hatch = `sw-asm-cement-${uid}`;
  const packerHatch = `sw-asm-packer-${uid}`;
  const gravel = `sw-asm-gravel-${uid}`;
  const screen = `sw-asm-screen-${uid}`;
  const glow = `sw-asm-glow-${uid}`;
  const contour = `sw-asm-contour-${uid}`;
  const ticks = y.ticks(9);

  function cementSegments(item: AssemblyItem) {
    const host = items.find((value) => value.id === item.hostId);
    if (!host) return [];
    const cuts = new Set([item.topM, item.bottomM]);
    for (const value of strings) if (value.odIn > host.odIn && value.bottomM > item.topM && value.bottomM < item.bottomM) cuts.add(value.bottomM);
    const sorted = [...cuts].sort((a, b) => a - b);
    return sorted.slice(1).map((end, index) => {
      const start = sorted[index]!;
      const outer = strings.filter((value) => value.odIn > host.odIn && value.topM <= (start + end) / 2 && value.bottomM >= (start + end) / 2).sort((a, b) => a.odIn - b.odIn)[0];
      // Outside the next string the cement reaches the borehole wall: the cement record's own OD, else
      // the hole section drilled there. Only with neither is a nominal envelope drawn, and marked so.
      const recordOd = recordOf.get(item.id)?.outerDiameterMm;
      const hole = holeAt((start + end) / 2);
      const outerR = outer ? r(outer.idIn ?? outer.odIn * 0.92) : recordOd ? r(recordOd / 25.4) : hole ? r(hole.odIn) : r(host.odIn * 1.28);
      return { start, end, inner: r(host.odIn), outer: outerR, open: !outer, nominal: !outer && !recordOd && !hole };
    });
  }

  function interactive(item: AssemblyItem) {
    const selected = item.id === selectedId;
    const focus = preview?.focusId === item.id;
    const state = errors.has(item.id) ? "error" : warnings.has(item.id) ? "warning" : "ok";
    return {
      className: `sw-asm-item${selected ? " is-selected" : ""}${focus ? " is-preview" : ""}`,
      "data-item-id": item.id,
      "data-top-md": item.topM,
      "data-bottom-md": item.bottomM,
      "data-state": state,
      role: "button" as const,
      tabIndex: 0,
      "aria-pressed": selected,
      "aria-label": `${item.label}, ${itemSummary(item)}${state !== "ok" ? `, has ${state}` : ""}. ${onMoveComponent && slot(item) !== "surface" ? "Arrow keys move, Shift for 50 m." : ""}${onRemoveComponent ? " Delete removes." : ""}`,
      filter: selected ? `url(#${contour})` : focus ? `url(#${glow})` : undefined,
      onPointerDown: (event: ReactPointerEvent<SVGGElement>) => startMove(event, item),
      onPointerMove: continueMove,
      onPointerUp: (event: ReactPointerEvent<SVGGElement>) => endMove(event, item),
      onPointerCancel: () => { drag.current = null; setPreview(null); },
      onKeyDown: (event: ReactKeyboardEvent<SVGGElement>) => onItemKey(event, item),
    };
  }

  function drawItem(item: AssemblyItem) {
    const spec = getCatalogEntry(item.catalogId);
    const yt = y(item.topM);
    const yb = y(item.bottomM);
    const outer = r(item.odIn);
    const tone = spec.color;
    switch (spec.slot) {
      case "surface": return null;
      case "cement": return <g key={item.id} {...interactive(item)}>{cementSegments(item).map((segment) => {
        const a = y(segment.start), b = y(segment.end);
        return <g key={segment.start}>
          <rect x={CX - segment.outer} y={a} width={segment.outer - segment.inner} height={b - a} fill={`url(#${hatch})`} className="sw-asm-cement" />
          <rect x={CX + segment.inner} y={a} width={segment.outer - segment.inner} height={b - a} fill={`url(#${hatch})`} className="sw-asm-cement" />
          {segment.open && !holes.length && <><path d={`M${CX - segment.outer} ${a} v${b - a}`} className={`sw-asm-hole-wall${segment.nominal ? " is-nominal" : ""}`} /><path d={`M${CX + segment.outer} ${a} v${b - a}`} className={`sw-asm-hole-wall${segment.nominal ? " is-nominal" : ""}`} /></>}
        </g>;
      })}<line x1={CX - outer - 26} x2={CX - outer - 4} y1={yt} y2={yt} className="sw-asm-toc" /></g>;
      case "casing":
      case "liner": {
        const wall = Math.max(4, outer - r(item.idIn ?? item.odIn * 0.92));
        const host = items.find((value) => value.id === item.hostId);
        return <g key={item.id} {...interactive(item)}>
          <rect x={CX - outer - 6} y={yt} width={outer * 2 + 12} height={yb - yt} className="sw-asm-hit" />
          <rect x={CX - outer} y={yt} width={wall} height={yb - yt} fill={tone} className="sw-asm-wall" />
          <rect x={CX + outer - wall} y={yt} width={wall} height={yb - yt} fill={tone} className="sw-asm-wall" />
          <path d={`M${CX - outer} ${yb} h-11 l11 -${Math.min(14, yb - yt)} z M${CX + outer} ${yb} h11 l-11 -${Math.min(14, yb - yt)} z`} fill={tone} className="sw-asm-shoe" />
          {spec.slot === "liner" && host && <path d={`M${CX - outer} ${yt} L${CX - r(host.idIn ?? host.odIn)} ${yt} L${CX - outer} ${yt + Math.min(14, yb - yt)} z M${CX + outer} ${yt} L${CX + r(host.idIn ?? host.odIn)} ${yt} L${CX + outer} ${yt + Math.min(14, yb - yt)} z`} className="sw-asm-hanger" />}
        </g>;
      }
      case "tubing": {
        const wall = Math.max(2.5, outer - r(item.idIn ?? item.odIn * 0.88));
        return <g key={item.id} {...interactive(item)}>
          <rect x={CX - outer - 5} y={yt} width={outer * 2 + 10} height={yb - yt} className="sw-asm-hit" />
          <rect x={CX - outer} y={yt} width={wall} height={yb - yt} fill={tone} className="sw-asm-wall" />
          <rect x={CX + outer - wall} y={yt} width={wall} height={yb - yt} fill={tone} className="sw-asm-wall" />
          <path d={`M${CX - outer} ${yb - Math.min(9, yb - yt)} l${outer} ${Math.min(9, yb - yt)} l${outer} -${Math.min(9, yb - yt)}`} className="sw-asm-tubing-tail" stroke={tone} />
        </g>;
      }
      case "tubing-tool":
      case "casing-tool": {
        const host = items.find((value) => value.id === item.hostId);
        const inner = host ? r(host.odIn) : r(2);
        const h = yb - yt;
        const mid = (yt + yb) / 2;
        const body = toolGlyph(item, spec, host, inner, outer, 0, 24, 12, tone);
        return <g key={item.id} {...interactive(item)} data-component-kind={spec.kind}>
          <rect x={CX - outer - 8} y={mid - Math.max(h, 12) / 2} width={outer * 2 + 16} height={Math.max(h, 12)} className="sw-asm-hit" />
          {spec.kind === "Safety valve" && <path d={`M${CX + inner + 7} ${y(0)} V${mid}`} className="sw-asm-control-line" />}
          {spec.kind === "Gauge" && <path d={`M${CX - outer - 3} ${y(0)} V${yt}`} className="sw-asm-control-line is-gauge" />}
          {item.catalogId === "esp" && <path d={`M${CX - outer - 4} ${y(0)} V${yt}`} className="sw-asm-control-line is-power" />}
          <svg x={0} y={yt} width={W} height={h} viewBox={`0 0 ${W} 24`} preserveAspectRatio="none" data-testid="component-length">{body}</svg>
        </g>;
      }
      case "sandface": {
        const host = items.find((value) => value.id === item.hostId);
        const wallR = host ? r(host.odIn) : holeR;
        const h = yb - yt;
        let body: ReactNode;
        if (item.catalogId === "perforations") {
          const count = Math.max(2, Math.min(24, Math.round(h / 7)));
          body = Array.from({ length: count }, (_, index) => {
            const py = yt + (index + 0.5) * h / count;
            const side = index % 2 ? 1 : -1;
            return <path key={index} d={`M${CX + side * (wallR - 3)} ${py} l${side * 26} -2.4 l${side * 4} 2.4 l${-side * 4} 2.4 l${-side * 26} -2.4`} className="sw-asm-perf" />;
          });
        } else if (item.catalogId === "gravel-pack") {
          const outerR = host?.idIn ? r(host.idIn) - 1 : holeR + 4;
          body = <><rect x={CX - outerR} y={yt} width={outerR - outer * 0.82} height={h} fill={`url(#${gravel})`} className="sw-asm-tool" /><rect x={CX + outer * 0.82} y={yt} width={outerR - outer * 0.82} height={h} fill={`url(#${gravel})`} className="sw-asm-tool" /></>;
        } else if (spec.kind === "Packer") {
          const seal = host?.idIn ? r(host.idIn) : holeR + 4;
          body = <><rect x={CX - seal} y={yt} width={seal - outer * 0.7} height={h} rx={3} fill={tone} className="sw-asm-tool" /><rect x={CX + outer * 0.7} y={yt} width={seal - outer * 0.7} height={h} rx={3} fill={tone} className="sw-asm-tool" /></>;
        } else {
          const wall = Math.max(3, outer - r(item.idIn ?? item.odIn * 0.8));
          const slots = item.catalogId === "slotted-liner" || item.catalogId === "frac-sleeve";
          body = <><rect x={CX - outer} y={yt} width={wall} height={h} fill={slots ? tone : `url(#${screen})`} stroke={tone} className="sw-asm-tool" /><rect x={CX + outer - wall} y={yt} width={wall} height={h} fill={slots ? tone : `url(#${screen})`} stroke={tone} className="sw-asm-tool" />{slots && Array.from({ length: Math.max(1, Math.min(18, Math.round(h / 10))) }, (_, index) => <g key={index} className="sw-asm-slot"><rect x={CX - outer + 1} y={yt + (index + 0.3) * h / Math.max(1, Math.min(18, Math.round(h / 10)))} width={wall - 2} height={2.2} /><rect x={CX + outer - wall + 1} y={yt + (index + 0.3) * h / Math.max(1, Math.min(18, Math.round(h / 10)))} width={wall - 2} height={2.2} /></g>)}{item.catalogId === "icd-screen" && <circle cx={CX + outer + 3} cy={yt + h / 2} r={2.6} className="sw-asm-valve-dot" />}</>;
        }
        return <g key={item.id} {...interactive(item)}><rect x={CX - wallR - 30} y={yt - 2} width={(wallR + 30) * 2} height={h + 4} className="sw-asm-hit" /><svg x={0} y={yt} width={W} height={h} viewBox={`0 ${yt} ${W} ${h}`} preserveAspectRatio="none" data-testid="component-length">{body}</svg></g>;
      }
      case "plug": {
        const host = items.find((value) => value.id === item.hostId);
        const bore = host ? r(host.idIn ?? host.odIn * 0.9) : holeR;
        const h = yb - yt;
        const body = item.catalogId === "cement-plug"
          ? <rect x={CX - bore} y={yt} width={bore * 2} height={h} fill={`url(#${hatch})`} className="sw-asm-tool" />
          : <><rect x={CX - bore} y={yt} width={bore * 2} height={h} fill={`url(#${packerHatch})`} className="sw-asm-tool" /><path d={`M${CX - bore} ${yt} l6 -5 M${CX + bore} ${yt} l-6 -5 M${CX - bore} ${yt + h} l6 5 M${CX + bore} ${yt + h} l-6 5`} className="sw-asm-slips" />{item.catalogId === "cement-retainer" && <rect x={CX - 3} y={yt - 8} width={6} height={h + 8} fill="#c9ced0" className="sw-asm-tool" />}</>;
        return <g key={item.id} {...interactive(item)}><rect x={CX - bore - 6} y={yt - 6} width={bore * 2 + 12} height={h + 12} className="sw-asm-hit" /><svg x={0} y={yt} width={W} height={h} viewBox={`0 ${yt} ${W} ${h}`} preserveAspectRatio="none" data-testid="component-length">{body}</svg></g>;
      }
    }
  }

  function toolGlyph(item: AssemblyItem, spec: AssemblyCatalogEntry, host: AssemblyItem | undefined, inner: number, outer: number, top: number, h: number, mid: number, tone: string): ReactNode {
    const ring = (fill: string) => <><rect x={CX - outer} y={top} width={outer - inner} height={h} fill={fill} className="sw-asm-tool" /><rect x={CX + inner} y={top} width={outer - inner} height={h} fill={fill} className="sw-asm-tool" /></>;
    if (spec.attach === "shoe") {
      const shoeY = top + h * 0.6;
      return <path d={`M${CX - inner} ${top} V${shoeY} Q${CX} ${top + h} ${CX + inner} ${shoeY} V${top} z`} fill={tone} className="sw-asm-tool" />;
    }
    if (spec.attach === "shoe-track") {
      const bore = host ? r(host.idIn ?? host.odIn * 0.9) : inner;
      return <><rect x={CX - bore} y={top} width={bore * 2} height={Math.max(h, 7)} fill={tone} className="sw-asm-tool" />{item.catalogId === "float-collar" ? <path d={`M${CX - 5} ${top + 1} L${CX} ${top + Math.max(h, 7) - 1} L${CX + 5} ${top + 1} z`} className="sw-asm-flapper" /> : <rect x={CX - bore} y={top - 3} width={bore * 2} height={3} fill="#2b3135" />}</>;
    }
    if (spec.attach === "liner-top" || spec.sealsToCasing || item.catalogId === "seal-assembly") {
      const outerString = spec.attach === "liner-top" ? items.find((value) => value.id === host?.hostId) : stringsAtDepth(shown, item.topM)[0];
      const seal = outerString ? r(outerString.idIn ?? outerString.odIn) : outer;
      const from = spec.attach === "liner-top" && host ? r(host.odIn) : inner;
      if (item.catalogId === "seal-assembly") return <>{ring(tone)}{Array.from({ length: 3 }, (_, index) => <line key={index} x1={CX - outer} x2={CX + outer} y1={top + (index + 1) * h / 4} y2={top + (index + 1) * h / 4} className="sw-asm-seal-line" />)}</>;
      return <><rect x={CX - seal} y={top} width={seal - from} height={h} fill={`url(#${packerHatch})`} className="sw-asm-tool" /><rect x={CX + from} y={top} width={seal - from} height={h} fill={`url(#${packerHatch})`} className="sw-asm-tool" />{item.catalogId === "permanent-packer" && <path d={`M${CX - seal} ${top} l5 -4 M${CX + seal} ${top} l-5 -4`} className="sw-asm-slips" />}</>;
    }
    if (spec.kind === "Centralizer") {
      if (item.catalogId === "cement-basket") return <path d={`M${CX - inner} ${top + h} L${CX - outer - 6} ${top} M${CX - inner} ${top + h} L${CX - outer} ${top + h * 0.3} M${CX + inner} ${top + h} L${CX + outer + 6} ${top} M${CX + inner} ${top + h} L${CX + outer} ${top + h * 0.3}`} className="sw-asm-bow" stroke={tone} />;
      if (item.catalogId === "rigid-centralizer") return <><rect x={CX - outer} y={top} width={outer - inner} height={h} rx={2} fill={tone} className="sw-asm-tool" /><rect x={CX + inner} y={top} width={outer - inner} height={h} rx={2} fill={tone} className="sw-asm-tool" /></>;
      return <path d={`M${CX - inner} ${top} Q${CX - outer - 4} ${mid} ${CX - inner} ${top + h} M${CX + inner} ${top} Q${CX + outer + 4} ${mid} ${CX + inner} ${top + h}`} className="sw-asm-bow" stroke={tone} />;
    }
    if (spec.kind === "Safety valve") {
      return <>{ring(tone)}<path d={`M${CX - inner} ${mid} L${CX} ${top} L${CX + inner} ${mid} L${CX} ${top + h} z`} className="sw-asm-flapper" /></>;
    }
    if (spec.kind === "Gas lift mandrel") {
      return <><rect x={CX - outer} y={top} width={outer * 2} height={h} rx={3} className="sw-asm-tool-body" fill={tone} /><ellipse cx={CX + outer + 5} cy={mid} rx={6} ry={Math.max(h / 2, 7)} fill={tone} className="sw-asm-tool" /><circle cx={CX + outer + 5} cy={mid} r={2.4} className="sw-asm-valve-dot" />{item.catalogId === "chemical-injection-mandrel" && <path d={`M${CX + outer + 5} ${y(0)} V${mid - 7}`} className="sw-asm-control-line is-chemical" />}</>;
    }
    if (spec.kind === "Landing nipple") {
      const profile = <path d={`M${CX - outer} ${top} h${outer - inner + 3} l-3 ${h / 2} l3 ${h / 2} h${-(outer - inner + 3)} z M${CX + outer} ${top} h${-(outer - inner + 3)} l3 ${h / 2} l-3 ${h / 2} h${outer - inner + 3} z`} fill={tone} className="sw-asm-tool" />;
      if (item.catalogId === "sliding-sleeve") return <>{profile}<circle cx={CX - outer + 2} cy={mid} r={1.8} className="sw-asm-valve-dot" /><circle cx={CX + outer - 2} cy={mid} r={1.8} className="sw-asm-valve-dot" /></>;
      if (item.catalogId === "no-go-nipple") return <>{profile}<line x1={CX - inner} x2={CX + inner} y1={top + h - 1} y2={top + h - 1} className="sw-asm-seal-line" /></>;
      return profile;
    }
    if (spec.kind === "Gauge") {
      return <rect x={CX - outer - 6} y={top} width={outer - inner + 6} height={h} rx={2} fill={tone} className="sw-asm-tool" />;
    }
    if (spec.category === "Artificial lift") {
      const stages = Math.max(2, Math.min(14, Math.round(h / 6)));
      return <><rect x={CX - outer} y={top} width={outer * 2} height={h} rx={2} fill={tone} className="sw-asm-tool-body" />{Array.from({ length: stages }, (_, index) => <line key={index} x1={CX - outer + 2} x2={CX + outer - 2} y1={top + (index + 0.5) * h / stages} y2={top + (index + 0.5) * h / stages} className="sw-asm-stage" />)}</>;
    }
    if (spec.atTubingTail) return <path d={`M${CX - inner} ${top} L${CX - outer} ${top + h} M${CX + inner} ${top} L${CX + outer} ${top + h}`} className="sw-asm-bow" stroke={tone} />;
    if (item.catalogId === "stage-tool") return <>{ring(tone)}<circle cx={CX - outer + 2} cy={mid} r={1.8} className="sw-asm-valve-dot" /><circle cx={CX + outer - 2} cy={mid} r={1.8} className="sw-asm-valve-dot" /></>;
    return ring(tone);
  }

  const ordered = [...items].sort((a, b) => order(a) - order(b));
  function order(item: AssemblyItem) { return { cement: 0, casing: 1, liner: 2, sandface: 3, tubing: 4, "casing-tool": 5, "tubing-tool": 6, plug: 7, surface: 8 }[slot(item)]; }

  const labelLayout = useMemo(() => {
    const visible = items.filter((item) => slot(item) !== "surface" && (zoomed || ["casing", "liner", "tubing", "sandface"].includes(slot(item)) || item.id === selectedId) && anchorDepth(item) >= top && anchorDepth(item) <= bottom)
      .map((item) => ({ item, anchor: y(anchorDepth(item)) })).sort((a, b) => a.anchor - b.anchor);
    // Accessories a few metres apart (shoe track, centralizers) share one label; strings, cement and perforations keep their own.
    const groups: { members: { item: AssemblyItem; anchor: number }[]; anchor: number; at: number }[] = [];
    let open: (typeof groups)[number] | null = null;
    for (const entry of visible) {
      const accessory = !MAJOR_SLOTS.has(slot(entry.item));
      if (accessory && open && entry.anchor - open.anchor <= 14 && open.members.length < 5) { open.members.push(entry); continue; }
      const group = { members: [entry], anchor: entry.anchor, at: 0 };
      groups.push(group);
      open = accessory ? group : null;
    }
    // A label's detail runs below its anchor; the last one must end inside the drawing, not under the legend.
    const first = 42, last = Y1 - 12 - (rich && !zoomed ? 70 : 0);
    const gap = labelGap;
    let cursor = first - gap;
    for (const label of groups) { label.at = Math.max(label.anchor, cursor + gap); cursor = label.at; }
    let limit = last;
    for (let index = groups.length - 1; index >= 0; index--) { const label = groups[index]!; label.at = Math.min(label.at, limit); limit = label.at - gap; }
    return { groups, compact: gap < 26 };
  }, [items, top, bottom, y, Y1, zoomed, selectedId, labelGap, rich]);

  const stack = useMemo(() => {
    const surface = items.filter((item) => slot(item) === "surface");
    const levels = [...new Set(surface.map((item) => getCatalogEntry(item.catalogId).stackOrder ?? 9))].sort((a, b) => a - b);
    const weight = (level: number) => level >= 4 ? 1.7 : level === 1 ? 1.1 : 0.85;
    const total = levels.reduce((sum, level) => sum + weight(level), 0);
    const room = Y0 - 6;
    const extra = Math.max(0, room - surface.length * 13);
    let cursor = Y0;
    return levels.map((level) => {
      const members = surface.filter((item) => (getCatalogEntry(item.catalogId).stackOrder ?? 9) === level);
      const height = members.length * 13 + extra * weight(level) / Math.max(total, 1);
      cursor -= height;
      return { level, members, y: cursor, height };
    });
  }, [items, Y0]);
  const selectedItem = items.find((item) => item.id === selectedId);
  const band = selectedItem && slot(selectedItem) !== "surface" && selectedItem.bottomM >= top && selectedItem.topM <= bottom ? (() => {
    const a = y(Math.max(selectedItem.topM, top));
    const b = Math.max(y(Math.min(selectedItem.bottomM, bottom)), a + 2);
    const tool = slot(selectedItem) === "casing-tool" || slot(selectedItem) === "tubing-tool";
    return { a: tool ? a - 6 : a, b: tool ? b + 6 : b, topM: selectedItem.topM, bottomM: selectedItem.bottomM };
  })() : null;

  return <section className="sw-asm-schematic" aria-label={title} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); drag.current = null; setPreview(null); onSelect?.(null); }
  }}>
    {!trackFrame?.chromeless && <header className="sw-asm-panel-head">
      <div><h2>{title}</h2><small>{zoomed ? `${formatDepth(top)} – ${formatDepth(bottom)} MD` : `0 – ${formatDepth(td)} MD · TD`}</small></div>
      <div className="sw-asm-tools" role="toolbar" aria-label="Schematic view">
        <CommandButton type="button" onClick={() => zoom(0.5)} aria-label="Zoom depth in" disabled={exploded}><ZoomIn size={15} /></CommandButton>
        <CommandButton type="button" onClick={() => zoom(2)} aria-label="Zoom depth out" disabled={exploded || !zoomed}><ZoomOut size={15} /></CommandButton>
        <CommandButton type="button" onClick={() => setWindow(null)} aria-label="Fit whole well" disabled={exploded || !zoomed}><Maximize2 size={15} /></CommandButton>
        <CommandButton type="button" className="sw-asm-mode" onClick={() => zoom(0.05)} disabled={exploded || !selectedItem || slot(selectedItem) === "surface"} aria-label="Inspect selected depth"><ZoomIn size={15} /><span>Detail</span></CommandButton>
        <CommandButton type="button" className="sw-asm-mode" onClick={toggleExploded} aria-pressed={exploded} aria-label="Exploded view" title="Exploded view: every component on its own"><Boxes size={15} /><span>Exploded</span></CommandButton>
      </div>
    </header>}
    {exploded ? <ExplodedParts assembly={assembly} assetBaseUrl={assetBaseUrl} selectedId={selectedId} onSelect={onSelect} issues={issues} /> :
    <div ref={frame} className="sw-asm-schematic-frame" tabIndex={0} role="region" aria-label="Engineering schematic drawing" data-dropping={preview?.kind === "drop" ? (preview.valid ? "valid" : "invalid") : undefined}>
      <svg ref={svg} style={{ width: W, height: H }} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`${title}. ${items.length} components. ${onDropComponent ? "Drop catalog components to place them at the pointer depth." : ""}`} data-testid="assembly-schematic" data-revision={assembly.revision} data-has-selection={selectedItem ? "true" : undefined}
        onPointerDown={(event) => { if (!(event.target as Element).closest(".sw-asm-item, .sw-asm-label")) onSelect?.(null); }}
        onPointerMove={onCursorDepthChange ? (event) => onCursorDepthChange(pointerDepth(event.clientY)) : undefined}
        onPointerLeave={onCursorDepthChange ? () => onCursorDepthChange(null) : undefined} {...dropHandlers}>
        <defs>
          <clipPath id={clip}><rect x={0} y={Y0} width={W} height={Y1 - Y0 + 24} /></clipPath>
          <pattern id={hatch} width="7" height="7" patternUnits="userSpaceOnUse"><rect width="7" height="7" fill="#d6dad5" /><circle cx="2" cy="2" r=".9" fill="#8e958f" /><circle cx="5.5" cy="5" r=".7" fill="#a5aba5" /></pattern>
          <pattern id={packerHatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#2b3135" /><line x1="0" y1="0" x2="0" y2="6" stroke="#59646b" strokeWidth="2" /></pattern>
          <pattern id={gravel} width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#e6d3a6" /><circle cx="1.6" cy="1.8" r="1.2" fill="#b99a63" /><circle cx="4.6" cy="4.4" r="1.1" fill="#9f804a" /></pattern>
          <pattern id={screen} width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#dfe4e5" /><line x1="0" y1="2" x2="4" y2="2" stroke="#6f7b80" strokeWidth="1" /></pattern>
          <filter id={glow} x="-30%" y="-10%" width="160%" height="120%"><feDropShadow dx="0" dy="0" stdDeviation="2.4" floodColor="#235faa" floodOpacity=".9" /></filter>
          <filter id={contour} x="-40%" y="-8%" width="180%" height="116%" colorInterpolationFilters="sRGB">
            <feMorphology in="SourceAlpha" operator="dilate" radius="3.4" result="outer" />
            <feFlood className="sw-asm-select-flood" result="tone" />
            <feComposite in="tone" in2="outer" operator="in" result="ring" />
            <feMorphology in="SourceAlpha" operator="dilate" radius="1.4" result="inner" />
            <feFlood floodColor="#ffffff" result="white" />
            <feComposite in="white" in2="inner" operator="in" result="halo" />
            <feMerge><feMergeNode in="ring" /><feMergeNode in="halo" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {(formationColumn ?? []).map((layer, index) => <LithologyPattern key={layer.id} id={`${clip}-lith-${index}`} kind={lithologyOf(layer.lithology)} color={layer.color} />)}
          <linearGradient id={`${clip}-earth`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#f1ede3" /><stop offset="1" stopColor="#e6e3dc" /></linearGradient>
        </defs>
        <rect className="sw-asm-bg" x={0} y={0} width={W} height={H} fill="transparent" />
        <rect className="sw-asm-bg" x={RULER_X} y={Y0} width={LABEL_X - RULER_X - 20} height={Y1 - Y0} fill={`url(#${clip}-earth)`} />
        {formations.map((layer) => {
          const trajectory = { trajectory: survey ?? null, totalDepthMdM: td };
          const layerTop = Math.max(Y0, y(mdAtTvd(trajectory, layer.topTvdM)));
          const layerBottom = Math.min(Y1, y(mdAtTvd(trajectory, layer.bottomTvdM)));
          return layerBottom > layerTop && <g key={layer.id} data-formation-id={layer.id} pointerEvents="none">
            <rect x={RULER_X} y={layerTop} width={LABEL_X - RULER_X - 20} height={layerBottom - layerTop} fill={layer.color} opacity="0.3" />
            <text x={RULER_X + 6} y={layerTop + 14} className="sw-asm-label-detail">{layer.name}</text>
          </g>;
        })}
        <g className="sw-asm-ruler" aria-hidden>
          {ticks.map((tick) => <g key={tick}><line x1={RULER_X - 10} x2={RULER_X} y1={y(tick)} y2={y(tick)} /><line x1={RULER_X} x2={LABEL_X - 20} y1={y(tick)} y2={y(tick)} className="sw-asm-gridline" />{!trackFrame && <text x={RULER_X - 14} y={y(tick) + 3.5} textAnchor="end">{tick.toLocaleString("en-US")}</text>}</g>)}
          {!trackFrame && <text x={RULER_X - 52} y={Y0 - 10} className="sw-asm-axis-title">MD (m)</text>}
          {showTvd && <>
            {ticks.map((tick) => { const tvd = tvdAt(tick); return tvd === null ? null : <text key={`tvd-${tick}`} x={TVD_X} y={y(tick) + 3.5} textAnchor="end" className="sw-asm-tvd">{Math.round(tvd).toLocaleString("en-US")}</text>; })}
            <text x={TVD_X - 44} y={Y0 - 10} className="sw-asm-axis-title">TVD (m)</text>
          </>}
        </g>
        {showColumn && <g className="sw-asm-formation-column" aria-label="Formation column" data-testid="formation-column">
          <text x={COL_X} y={Y0 - 10} className="sw-asm-axis-title">Formation</text>
          {formationColumn!.map((layer, index) => {
            const trajectory = { trajectory: survey ?? null, totalDepthMdM: td };
            const mdTop = mdAtTvd(trajectory, layer.topTvdM), mdBase = mdAtTvd(trajectory, layer.bottomTvdM);
            const a = Math.max(Y0, y(Math.max(mdTop, top))), b = Math.min(Y1, y(Math.min(mdBase, bottom)));
            if (!(b > a)) return null;
            const h = b - a, vertical = h >= layer.name.length * 6.2 + 12, fits = h >= 13;
            return <g key={layer.id} data-formation-id={layer.id}>
              <title>{`${layer.name} · ${layer.lithology} · ${Math.round(layer.topTvdM).toLocaleString("en-US")}–${Math.round(layer.bottomTvdM).toLocaleString("en-US")} m TVD${layer.interpretation ? `\n${layer.interpretation}` : ""}`}</title>
              <rect x={COL_X} y={a} width={COL_W} height={h} fill={`url(#${clip}-lith-${index})`} className="sw-asm-formation-cell" />
              {vertical ? <text transform={`translate(${COL_X + COL_W / 2 + 4} ${(a + b) / 2}) rotate(-90)`} textAnchor="middle" className="sw-asm-formation-name">{layer.name}</text>
                : fits && <text x={COL_X + 4} y={a + 11} className="sw-asm-formation-name is-short">{layer.name.length > 10 ? `${layer.name.slice(0, 9)}…` : layer.name}</text>}
              {mdTop > top && mdTop < bottom && mdTop > 0.5 && <line x1={COL_X + COL_W} x2={LABEL_X - 20} y1={y(mdTop)} y2={y(mdTop)} className="sw-asm-formation-top" />}
            </g>;
          })}
        </g>}
        {top <= 0 && <line x1={RULER_X} x2={LABEL_X - 20} y1={Y0} y2={Y0} className="sw-asm-ground" />}
        <g className="sw-asm-surface" aria-label="Surface equipment">
          {stack.map(({ level, members, y: sy, height }) => {
            const main = members.find((item) => item.catalogId !== "tubing-hanger") ?? members[0]!;
            const hanger = members.find((item) => item.catalogId === "tubing-hanger" && item !== main);
            const width = level >= 4 ? 112 : 96 - level * 6;
            return <g key={level} data-stack-level={level}>
              <image className={main.id === selectedId ? "is-selected" : undefined} href={assetUrl(assetBaseUrl, getCatalogEntry(main.catalogId).asset.thumbnail)} x={CX - width / 2} y={sy} width={width} height={height} preserveAspectRatio="xMidYMax meet" />
              {hanger && <image className={hanger.id === selectedId ? "is-selected" : undefined} href={assetUrl(assetBaseUrl, getCatalogEntry(hanger.catalogId).asset.thumbnail)} x={CX - 15} y={sy + height * 0.45} width={30} height={height * 0.5} preserveAspectRatio="xMidYMid meet" />}
              <text x={CX - width / 2 - 8} y={sy + height / 2 + 3.5 - (members.length - 1) * 6.5} textAnchor="end" className="sw-asm-stack-label">{members.map((item, index) => <tspan key={item.id} x={CX - width / 2 - 8} dy={index ? 13 : 0} className={item.id === selectedId ? "is-selected" : undefined}>{item.label.replace(/ \(.*\)$/, "")}</tspan>)}</text>
              <rect {...interactive(main)} x={CX - width / 2} y={sy} width={width} height={height} className={`${interactive(main).className} sw-asm-hit`} />
              {hanger && <rect {...interactive(hanger)} x={CX - 16} y={sy + height * 0.45} width={32} height={height * 0.5} className={`${interactive(hanger).className} sw-asm-hit`} />}
            </g>;
          })}
          {!stack.length && onDropComponent && <g className="sw-asm-surface-slot"><rect x={CX - 60} y={44} width={120} height={70} rx={6} /><text x={CX} y={84} textAnchor="middle">Drop wellhead</text></g>}
        </g>
        <g clipPath={`url(#${clip})`}>
          {holes.map((hole, index) => {
            const a = Math.max(hole.topM, top), b = Math.min(hole.bottomM, bottom);
            if (!(b > a)) return null;
            const R = r(hole.odIn), ya = y(a), yb = y(b);
            const openFrom = Math.max(a, deepestShoe);
            const casedTo = Math.min(b, deepestShoe);
            const wavy = (side: number) => {
              const y0 = y(openFrom), steps = Math.max(2, Math.round((yb - y0) / 7));
              return `M${CX + side * R} ${y0} ${Array.from({ length: steps }, (_, step) => `L${CX + side * (R + (step % 2 ? 3 : 0))} ${y0 + (yb - y0) * (step + 1) / steps}`).join(" ")}`;
            };
            const previous = holes[index - 1];
            return <g key={hole.id} className="sw-asm-hole" data-hole-id={hole.id} pointerEvents="none">
              <rect x={CX - R} y={ya} width={R * 2} height={yb - ya} className="sw-asm-borehole" />
              {casedTo > a && <path d={`M${CX - R} ${ya} V${y(casedTo)} M${CX + R} ${ya} V${y(casedTo)}`} className="sw-asm-hole-wall" />}
              {b > openFrom && <path d={`${wavy(-1)} ${wavy(1)}`} className="sw-asm-open-hole" />}
              {previous && hole.topM >= top && hole.topM <= bottom && previous.odIn > hole.odIn && <path d={`M${CX - r(previous.odIn)} ${ya} H${CX - R} M${CX + R} ${ya} H${CX + r(previous.odIn)}`} className="sw-asm-hole-wall" />}
            </g>;
          })}
          {!holes.length && innermostDeep && deepestShoe < bottom && <path d={`M${CX - holeR} ${y(Math.max(deepestShoe, top))} ${Array.from({ length: 24 }, (_, index) => `L${CX - holeR - (index % 2 ? 4 : 0)} ${y(Math.max(deepestShoe, top)) + (y(td) - y(Math.max(deepestShoe, top))) * (index + 1) / 24}`).join(" ")} M${CX + holeR} ${y(Math.max(deepestShoe, top))} ${Array.from({ length: 24 }, (_, index) => `L${CX + holeR + (index % 2 ? 4 : 0)} ${y(Math.max(deepestShoe, top)) + (y(td) - y(Math.max(deepestShoe, top))) * (index + 1) / 24}`).join(" ")}`} className="sw-asm-open-hole" />}
          {band && <g className="sw-asm-select-band" aria-hidden data-testid="assembly-selection-band"><rect x={RULER_X} y={band.a} width={LABEL_X - RULER_X - 20} height={band.b - band.a} /><line x1={RULER_X} x2={LABEL_X - 20} y1={band.a} y2={band.a} /><line x1={RULER_X} x2={LABEL_X - 20} y1={band.b} y2={band.b} /></g>}
          <line x1={CX} x2={CX} y1={Y0} y2={y(td)} className="sw-asm-axis" />
          {ordered.map(drawItem)}
          {tubing && <text x={CX} y={Math.min(y(tubing.bottomM) + 24, Y1 + 10)} textAnchor="middle" className="sw-asm-small">EOT</text>}
          <line x1={RULER_X} x2={LABEL_X - 20} y1={y(td)} y2={y(td)} className="sw-asm-td-line" />
          <text x={LABEL_X - 24} y={trackFrame ? y(td) - 5 : y(td) + 15} textAnchor="end" className="sw-asm-small">TD {formatDepth(td)}{tdTvd !== null && !trackFrame ? ` MD · ${formatDepth(tdTvd)} TVD` : ""}</text>
        </g>
        {band && <g className="sw-asm-select-ruler" aria-hidden>
          <path d={`M${RULER_X - 2} ${band.a} H${RULER_X - 8} V${band.b} H${RULER_X - 2}`} />
          <rect x={RULER_X - 60} y={band.a - 9} width={50} height={16} rx={3} /><text x={RULER_X - 35} y={band.a + 2.5} textAnchor="middle">{Math.round(band.topM).toLocaleString("en-US")}</text>
          {band.b - band.a > 22 && <><rect x={RULER_X - 60} y={band.b - 7} width={50} height={16} rx={3} /><text x={RULER_X - 35} y={band.b + 4.5} textAnchor="middle">{Math.round(band.bottomM).toLocaleString("en-US")}</text></>}
        </g>}
        {highlights.filter((band) => band.baseM >= top && band.topM <= bottom).map((band) => {
          const y0 = y(Math.max(top, band.topM)), y1 = y(Math.min(bottom, band.baseM));
          return <g key={band.id} className="sw-asm-highlight" pointerEvents="none" data-highlight={band.id}>
            <rect x={62} width={Math.max(0, LABEL_X - 82)} y={y0} height={Math.max(2, y1 - y0)} />
            <text x={66} y={y0 + 12}>{band.label}</text>
          </g>;
        })}
        {cursorDepthM !== null && cursorDepthM >= top && cursorDepthM <= bottom && <g className="sw-asm-cursor" aria-hidden data-testid="assembly-cursor">
          <line x1={62} x2={LABEL_X - 20} y1={y(cursorDepthM)} y2={y(cursorDepthM)} />
          <rect x={LABEL_X - 92} y={y(cursorDepthM) - 17} width={72} height={15} rx={3} /><text x={LABEL_X - 56} y={y(cursorDepthM) - 6} textAnchor="middle">{formatDepth(cursorDepthM)}</text>
        </g>}
        <g className="sw-asm-labels">
          {labelLayout.groups.map(({ members, at }) => {
            const chosen = members.find((member) => member.item.id === selectedId) ?? members[0]!;
            const item = chosen.item;
            const spec = getCatalogEntry(item.catalogId);
            const reach = (member: AssemblyItem) => slot(member) === "cement" ? CX + r(member.odIn * 1.28) : CX + r(member.odIn) + (getCatalogEntry(member.catalogId).slot === "tubing-tool" ? 10 : 6);
            const stateOf = (member: AssemblyItem) => errors.has(member.id) ? "error" : warnings.has(member.id) ? "warning" : "ok";
            const state = members.some((member) => stateOf(member.item) === "error") ? "error" : members.some((member) => stateOf(member.item) === "warning") ? "warning" : "ok";
            const selected = members.some((member) => member.item.id === selectedId);
            const position = members.indexOf(chosen);
            const many = members.length > 1;
            const title = item.label + (many ? ` ${position + 1}/${members.length}` : "") + (state !== "ok" ? (state === "error" ? "  ⨯" : "  !") : "");
            const detail = many ? `${formatInches(Math.max(...members.map((member) => member.item.odIn)))} · ${formatDepth(Math.min(...members.map((member) => anchorDepth(member.item))))}–${Math.round(Math.max(...members.map((member) => anchorDepth(member.item)))).toLocaleString("en-US")} m` : itemSummary(item);
            const next = () => onSelect?.(selected ? many && position < members.length - 1 ? members[position + 1]!.item.id : null : item.id);
            const tall = !labelLayout.compact;
            const textX = LABEL_X + 12;
            const titleLines = wrapLabel(title, Math.max(18, Math.floor((W - textX - 16) / 6.4)));
            const cement = items.find((value) => slot(value) === "cement" && value.hostId === item.id);
            const record = recordOf.get(item.id);
            const isString = ["casing", "liner", "tubing"].includes(slot(item));
            const hole = isString && slot(item) !== "tubing" ? holeAt(item.bottomM - 0.5) : undefined;
            const shoeTvd = tvdAt(item.bottomM);
            const material = reported(record?.material);
            const slurry = cement ? reported(recordOf.get(cement.id)?.material) : null;
            const detailLines = !rich ? [
              `OD ${formatInches(item.odIn)} · ID ${item.idIn == null ? "not reported" : formatInches(item.idIn)}`,
              `${slot(item) === "casing" || slot(item) === "liner" ? "Shoe" : slot(item) === "tubing" ? "Tail" : "Base"} ${formatDepth(item.bottomM)} MD · Top ${formatDepth(item.topM)}`,
              ...(cement ? [`Cement TOC ${formatDepth(cement.topM)} MD`] : []),
            ] : [
              `OD ${formatInches(item.odIn)} · ID ${item.idIn == null ? "not reported" : formatInches(item.idIn)}`,
              material || record?.sourcePage ? [material?.replaceAll(" / ", " · "), record?.sourcePage ? `p. ${record.sourcePage}` : null].filter(Boolean).join(" · ") : null,
              `${slot(item) === "casing" || slot(item) === "liner" ? "Shoe" : slot(item) === "tubing" ? "Tail" : "Base"} ${formatDepth(item.bottomM)} MD${shoeTvd !== null && Math.abs(shoeTvd - item.bottomM) > 0.5 ? ` · ${formatDepth(shoeTvd)} TVD` : ""}`,
              `${record?.rawBottomDepthFt ? `Reported ${record.rawBottomDepthFt.toLocaleString("en-US")} ft · ` : ""}top ${record?.topDepthReported === false ? "not reported" : formatDepth(item.topM)}`,
              hole ? `In ${formatInches(hole.odIn)} hole to ${formatDepth(hole.bottomM)}${hole.bottomM - item.bottomM > 1 ? ` · ${Math.round(hole.bottomM - item.bottomM).toLocaleString("en-US")} m below shoe` : ""}` : null,
              cement ? `Cement TOC ${formatDepth(cement.topM)} · ${slurry?.replaceAll(" / ", " · ") ?? "slurry not reported"}` : null,
            ].filter((line): line is string => !!line).flatMap((line) => wrapLabel(line, Math.max(24, Math.floor((W - Math.max(0, W - size.width) / 2 - textX - 20) / 6.8))));
            return <g key={members[0]!.item.id} role="button" tabIndex={0} aria-pressed={selected} aria-label={title} className={`sw-asm-label${selected ? " is-selected" : ""}${members.some((member) => preview?.focusId === member.item.id) ? " is-preview" : ""}`} data-state={state} data-group-size={members.length} onPointerDown={(event) => { event.stopPropagation(); next(); }} onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); next(); }
            }}>
              <title>{members.map((member) => `${member.item.label} — ${itemSummary(member.item)}`).join("\n") + (many ? "\nClick to step through, then clear selection." : "\nClick again to clear selection.")}</title>
              <rect x={LABEL_X} y={at - 24} width={W - LABEL_X - 12} height={titleLines.length * 13 + (zoomed ? 30 : detailLines.length * 13 + 4)} className="sw-asm-hit" />
              {selected && <rect x={LABEL_X - 3} y={at - (tall ? 17 : 12)} width={W - LABEL_X - 1} height={tall ? 33 : 20} rx={5} className="sw-asm-label-pill" />}
              {members.map((member) => <path key={member.item.id} d={`M${reach(member.item)} ${member.anchor} H${LABEL_X - 26} L${LABEL_X - 8} ${at - 4} H${LABEL_X - 2}`} className={`sw-asm-leader${member === chosen && selected ? " is-active" : ""}`} />)}
              {selected && <circle cx={reach(item)} cy={chosen.anchor} r={3.6} className="sw-asm-leader-dot" />}
              <rect x={LABEL_X} y={at - (tall ? 14 : 10)} width={6} height={tall ? 24 : 15} rx={1.5} fill={spec.color} />
              <text x={textX} y={at - 20} className="sw-asm-label-title">{titleLines.map((line, index) => <tspan key={index} x={textX} dy={index ? 13 : 0}>{line}</tspan>)}</text>
              {!zoomed ? <text x={textX} y={at - 20 + titleLines.length * 13} className="sw-asm-label-detail">
                {detailLines.map((line, index) => <tspan key={index} x={textX} dy={index ? 13 : 0}>{line}</tspan>)}
              </text> : tall && <text x={textX} y={at - 20 + titleLines.length * 13} className="sw-asm-label-detail">{wrapLabel(detail, Math.max(18, Math.floor((W - textX - 16) / 6.1))).map((line, index) => <tspan key={index} x={textX} dy={index ? 13 : 0}>{line}</tspan>)}</text>}
            </g>;
          })}
        </g>
        {preview && <g className={`sw-asm-ghost${preview.valid ? "" : " is-invalid"}`} pointerEvents="none" data-testid="assembly-drop-preview">
          <line x1={62} x2={W - 8} y1={y(Math.min(Math.max(preview.depthM, top), bottom))} y2={y(Math.min(Math.max(preview.depthM, top), bottom))} />
          <rect x={62} y={y(Math.min(Math.max(preview.depthM, top), bottom)) - 30} width={Math.min(W - 70, 12 + preview.message.length * 6.1)} height={22} rx={4} />
          <text x={70} y={y(Math.min(Math.max(preview.depthM, top), bottom)) - 15}>{preview.message}</text>
        </g>}
      </svg>
    </div>}
    {!trackFrame?.chromeless && !exploded && <ul className="sw-asm-legend" aria-label="Legend">
      <li><svg width="22" height="14" aria-hidden="true"><rect x="3" y="0" width="4" height="14" fill="#5b6670" /><rect x="15" y="0" width="4" height="14" fill="#5b6670" /><path d="M3 14h-3l3-5z M19 14h3l-3-5z" fill="#5b6670" /></svg>Casing and shoe</li>
      <li><svg width="22" height="14" aria-hidden="true"><rect width="22" height="14" fill={`url(#${hatch})`} /></svg>Cement</li>
      {holes.length > 0 && <li><svg width="22" height="14" aria-hidden="true"><rect width="22" height="14" className="sw-asm-borehole" /><path d="M1 0V14M21 0V14" className="sw-asm-hole-wall" /></svg>Drilled hole (bit size)</li>}
      <li><svg width="22" height="14" aria-hidden="true"><path d="M3 0L6 3.5L3 7L6 10.5L3 14M19 0L16 3.5L19 7L16 10.5L19 14" className="sw-asm-open-hole" /></svg>Open hole</li>
      {showColumn && formationColumn!.map((layer, index) => <li key={layer.id}><svg width="22" height="14" aria-hidden="true"><rect width="22" height="14" fill={`url(#${clip}-lith-${index})`} stroke="rgba(0,0,0,.25)" /></svg>{layer.lithology}</li>)}
    </ul>}
    {!trackFrame?.chromeless && <p className="sw-asm-scale-note">{zoomed ? "Depth detail" : "Engineering overview"} · Linear MD{showTvd ? ", TVD read from the survey" : ""} · Actual component lengths · Diameters proportional, exaggerated relative to depth{rich ? " · Labels quote the source records; unreported values say so" : ""}. Select a short tool, then Detail.</p>}
  </section>;
}
