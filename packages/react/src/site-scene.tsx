"use client";

import { useEffect, useEffectEvent, useId, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { uniform } from "three/tsl";
import { scaleLinear } from "d3-scale";
import { seismicColour } from "@ikhmalputra/subsurface-core";
import type { SeismicColorMap } from "@ikhmalputra/subsurface-core";
import { createSceneRenderer } from "./scene-renderer.js";
import type { SceneRenderer } from "./scene-renderer.js";
import { sliceMaterial } from "./seismic-materials.js";
import { COMPASS_FACES, ViewCube } from "./view-cube.js";
import type { NamedView } from "./view-cube.js";
import { SceneViewKeys } from "./scene-tools.js";
import { CommandButton } from "./ui.js";
import type { SceneSeismicVolume } from "./well-scene.js";
import { LabelLayer, axesBox } from "./scene-labels.js";
import type { SceneLabelKind } from "./scene-labels.js";

/**
 * One subsurface site in 3D: its wells, the surfaces interpreted between them and the seismic that
 * covers them, in a single frame — east, north and depth in metres from one datum — so they line
 * up by construction rather than by eye.
 *
 * It is drawn the way an interpretation package draws a site: inside a box whose edges carry
 * labelled east, north and depth ticks; seismic as three orthogonal slices you move through the
 * volume; horizons as surfaces; wells as paths with their picks; the ground or sea surface as a
 * faint reference level. Labels are page text laid over the canvas, so they stay sharp at any size.
 *
 * Nothing is inferred. A surface is drawn only from what the host supplies, and every surface
 * carries the host's note on what it is. Unknowns stay unknown.
 */

export type SiteProvenance = "documented" | "synthetic" | "user-authored";

export interface SiteSceneWell {
  readonly id: string;
  readonly label: string;
  readonly provenance: SiteProvenance;
  /** Stations as [east, north, depth] triples in site metres, depth positive down from the site datum. */
  readonly xyz: ArrayLike<number>;
  /** Measured depth of each station, metres. */
  readonly mdM: ArrayLike<number>;
  /** Picks on the well: casing shoes, formation tops. */
  readonly markers?: readonly { readonly mdM: number; readonly label: string }[];
  /** Intervals drawn thicker in their own colour, e.g. the reservoir interval the well penetrates. */
  readonly intervals?: readonly { readonly topMdM: number; readonly baseMdM: number; readonly label: string; readonly color: string }[];
}

export type SiteSurfaceGeometry =
  /** A level surface across the whole site at one depth. */
  | { readonly kind: "plane"; readonly depthM: number }
  /** Points [east, north, depth], triangulated in plan unless triangles are supplied. */
  | { readonly kind: "tin"; readonly points: readonly (readonly [number, number, number])[]; readonly triangles?: readonly number[] };

export interface SiteSceneSurface {
  readonly id: string;
  readonly label: string;
  readonly provenance: SiteProvenance;
  /** "horizon" is an interpreted surface; "reference" a level such as the ground or the sea surface. */
  readonly role: "horizon" | "reference";
  readonly color: string;
  /** What the surface is, and what it is not: shown with it. */
  readonly note: string;
  readonly geometry: SiteSurfaceGeometry;
  /** A colour for each TIN point (sRGB, 0–1), e.g. depth-coloured like a structure map; the surface's own colour when absent. */
  readonly pointColors?: readonly (readonly [number, number, number])[];
  /** Drawn faint, without its label or contours, until it is the scene's focused surface: one of many tops, e.g. */
  readonly quiet?: boolean;
}

export interface SiteSceneProps {
  readonly title: string;
  /** The depth reference, e.g. "m TVD below RKB (1,659 m ASL)". Shown on the depth axis. */
  readonly depthLabel: string;
  /** What the east/north origin is, e.g. "wellhead, NAD83 / UTM 12N grid". */
  readonly originLabel: string;
  readonly wells: readonly SiteSceneWell[];
  readonly surfaces?: readonly SiteSceneSurface[];
  /** A seismic volume in the same frame: along/offset from its origin on the azimuth, `topTvdM`/`baseTvdM` as site depth. */
  readonly seismic?: SceneSeismicVolume | null;
  /** The volume's p99 absolute amplitude: colour saturates there at gain 1, as on the 2D section. */
  readonly seismicClip?: number;
  /** Shown when there is no seismic, e.g. "No seismic is supplied for this field". */
  readonly seismicNote?: string;
  readonly selectedWellId?: string | null;
  readonly onSelectWell?: (id: string) => void;
  /** A measured depth on one well to mark with a ring, e.g. a linked depth cursor. */
  readonly cursor?: { readonly wellId: string; readonly mdM: number } | null;
  /**
   * How far each well had been drilled, by well id, metres MD: its path, intervals and picks are
   * drawn only above that depth. Wells not named are drawn whole. Applied without a rebuild.
   */
  readonly reach?: Readonly<Record<string, number>> | null;
  /** Picks to hide, by well id and marker label: a shoe whose string had not yet been run, say. */
  readonly hiddenMarkers?: Readonly<Record<string, readonly string[]>> | null;
  /** An interval to light up along one well, e.g. a brushed log interval. MD metres. */
  readonly highlight?: { readonly wellId: string; readonly topMdM: number; readonly baseMdM: number; readonly color?: string } | null;
  /**
   * Slice positions set from outside, in the volume's own units (inline: offset m; crossline: along
   * m; depth: site m); null hides a slice, a missing key leaves it as it is. The scene follows them.
   */
  readonly slices?: Partial<SiteSlices> | null;
  /** Called when a slice is moved here — by its slider or by dragging its handle — with all three and the one that moved. */
  readonly onSlicesChange?: (slices: SiteSlices, moved: SliceKey) => void;
  /** A vertical cutting plane between two plan points (site east/north, metres), e.g. a section line drawn on a map, down to `baseM`. */
  readonly curtain?: { readonly from: readonly [number, number]; readonly to: readonly [number, number]; readonly baseM: number; readonly label: string } | null;
  /**
   * A band down one well, coloured sample by sample with the seismic colour map: a trace in −1…1 at
   * each MD, laid across the well in the volume's along direction (the inline slice through the well),
   * e.g. a synthetic seismogram spliced into the seismic where it ties.
   */
  readonly ribbon?: { readonly wellId: string; readonly mdM: ArrayLike<number>; readonly values: ArrayLike<number>; readonly halfWidthM: number; readonly label: string; readonly colorMap?: SeismicColorMap } | null;
  /** Where the camera opens: an interval of one well, seen square-on to the volume's inline slices, instead of the whole site. */
  readonly frame?: { readonly wellId: string; readonly topMdM: number; readonly baseMdM: number } | null;
  /**
   * A click (not a drag) on a seismic slice, in the volume's own units: along and offset in metres,
   * depth in site metres. With it, the pointer is a crosshair over the slices: e.g. to seed a horizon.
   */
  readonly onSeismicPick?: (at: { readonly alongM: number; readonly offsetM: number; readonly depthM: number; readonly slice: SliceKey }) => void;
  /**
   * The ground as it is: a regular grid of depths (site metres, rows north to south) over an east and
   * north extent, draped with an image when one is given (e.g. aerial imagery). Shown with the reference levels.
   */
  readonly terrain?: SiteTerrain | null;
  /**
   * A section through several wells, standing in the site: a wall along their plan positions between two
   * depths, a column down each well coloured interval by interval (e.g. its lithology) laid in the wall,
   * and lines across the wall joining a pick from well to well (e.g. a correlated top).
   */
  readonly fence?: SiteFence | null;
  /** The vertical exaggeration the scene opens with, e.g. for a field far wider than it is deep. 1 when absent. */
  readonly initialExaggeration?: number;
  /** The legend of wells and surfaces under the scene; shown unless false, e.g. where the host lists them itself. */
  readonly legend?: boolean;
  /** The surface brought forward: drawn solid with its label and contours while every other is faint. */
  readonly focusSurfaceId?: string | null;
  /** The host's own controls, placed in the scene's toolbar rather than over the view. */
  readonly tools?: ReactNode;
  /** Point clouds in the site's frame (e.g. microseismic events): each point a sphere sized relative to the wells' markers. */
  readonly points?: readonly SitePointCloud[] | null;
}

export interface SitePointCloud {
  readonly id: string;
  readonly label: string;
  /** East, north and depth (site metres), a size (1 is a well marker's), and an optional colour per point. */
  readonly points: readonly { readonly e: number; readonly n: number; readonly d: number; readonly size: number; readonly color?: string }[];
  readonly color: string;
  readonly opacity?: number;
}

export interface SiteFence {
  readonly label: string;
  /** The wall's corners in plan, in order: east and north, site metres. With none, only the lines are drawn (e.g. fault sticks). */
  readonly stations: readonly (readonly [number, number])[];
  readonly topM: number;
  readonly baseM: number;
  readonly columns?: readonly { readonly wellId: string; readonly intervals: readonly { readonly topMdM: number; readonly baseMdM: number; readonly color: string }[] }[];
  /** Points are [east, north, depth]; an emphasised line is drawn thicker. */
  readonly lines?: readonly { readonly label: string; readonly color: string; readonly points: readonly (readonly [number, number, number])[]; readonly emphasis?: boolean }[];
}

export interface SiteTerrain {
  readonly east: readonly [number, number];
  readonly north: readonly [number, number];
  readonly cols: number;
  readonly rows: number;
  /** One depth per cell (taken at its middle; east and north are the cells' outer edges), row by row from the north edge; NaN where there is no ground. */
  readonly depthsM: ArrayLike<number>;
  readonly imageUrl?: string;
  readonly label: string;
}

interface Layers { readonly wells: boolean; readonly seismic: boolean; readonly horizons: boolean; readonly reference: boolean; readonly labels: boolean }
export type SliceKey = "inline" | "crossline" | "depth";
/** Slice positions in the volume's own units — offset and along in metres, depth in site metres; null hides the slice. */
export type SiteSlices = Readonly<Record<SliceKey, number | null>>;
type Slices = SiteSlices;

const WELL_COLOURS = ["#1f6fb2", "#c2410c", "#0f766e", "#7c3aed", "#b45309", "#be185d"];

/** Plan triangulation (Bowyer–Watson) of a few points: the TIN a host gets when it supplies only picks. */
export function triangulatePlan(points: readonly (readonly [number, number])[]): number[] {
  if (points.length < 3) return [];
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY) || 1, mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
  const all: [number, number][] = [...points.map((p) => [p[0], p[1]] as [number, number]), [mx - 20 * span, my - span], [mx, my + 20 * span], [mx + 20 * span, my - span]];
  const n = points.length;
  let triangles: [number, number, number][] = [[n, n + 1, n + 2]];
  const circumcircle = ([a, b, c]: [number, number, number]) => {
    const [ax, ay] = all[a]!, [bx, by] = all[b]!, [cx, cy] = all[c]!;
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    return { x: ux, y: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 };
  };
  for (let i = 0; i < n; i++) {
    const [px, py] = all[i]!;
    const bad = triangles.filter((t) => { const c = circumcircle(t); return (px - c.x) ** 2 + (py - c.y) ** 2 < c.r2; });
    const edges: [number, number][] = [];
    for (const t of bad) for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]] as [number, number][]) {
      const shared = bad.some((other) => other !== t && [[other[0], other[1]], [other[1], other[2]], [other[2], other[0]]].some(([c, d]) => (c === a && d === b) || (c === b && d === a)));
      if (!shared) edges.push([a, b]);
    }
    triangles = triangles.filter((t) => !bad.includes(t));
    for (const [a, b] of edges) triangles.push([a, b, i]);
  }
  return triangles.filter((t) => t.every((index) => index < n)).flat();
}

/**
 * Contour segments across a TIN at a round depth interval (5, 10, 25, 50, 100 or 250 m) chosen to
 * give about a dozen levels: each triangle a level crosses contributes the segment where it does.
 */
export function contourLines(points: readonly (readonly [number, number, number])[], triangles: readonly number[]): [number, number, number][] {
  let lo = Infinity, hi = -Infinity;
  for (const p of points) { lo = Math.min(lo, p[2]); hi = Math.max(hi, p[2]); }
  const step = [5, 10, 25, 50, 100, 250].find((candidate) => (hi - lo) / candidate <= 14) ?? 500;
  const out: [number, number, number][] = [];
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const tri = [points[triangles[t]!]!, points[triangles[t + 1]!]!, points[triangles[t + 2]!]!];
    const min = Math.min(tri[0]![2], tri[1]![2], tri[2]![2]), max = Math.max(tri[0]![2], tri[1]![2], tri[2]![2]);
    for (let level = Math.ceil(min / step) * step; level < max; level += step) {
      const crossing: [number, number, number][] = [];
      for (const [a, b] of [[0, 1], [1, 2], [2, 0]] as const) {
        const p = tri[a]!, q = tri[b]!;
        if ((p[2] < level) === (q[2] < level)) continue;
        const f = (level - p[2]) / (q[2] - p[2]);
        crossing.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, level]);
      }
      if (crossing.length === 2) out.push(crossing[0]!, crossing[1]!);
    }
  }
  return out;
}

function pointAtMd(well: SiteSceneWell, md: number): [number, number, number] | null {
  const count = well.mdM.length;
  if (count === 0 || md < well.mdM[0]! || md > well.mdM[count - 1]!) return null;
  for (let i = 1; i < count; i++) {
    const a = well.mdM[i - 1]!, b = well.mdM[i]!;
    if (md <= b) {
      const t = b > a ? (md - a) / (b - a) : 0;
      return [0, 1, 2].map((k) => well.xyz[(i - 1) * 3 + k]! + t * (well.xyz[i * 3 + k]! - well.xyz[(i - 1) * 3 + k]!)) as [number, number, number];
    }
  }
  return [well.xyz[(count - 1) * 3]!, well.xyz[(count - 1) * 3 + 1]!, well.xyz[(count - 1) * 3 + 2]!];
}

const fmt = (value: number) => Math.round(value).toLocaleString("en-US");

/** Ground images by URL, decoded once: a scene rebuilt (a new surface, another exaggeration) does not fetch and decode them again. */
const groundImages = new Map<string, Promise<HTMLImageElement>>();
function groundImage(url: string): Promise<HTMLImageElement> {
  let image = groundImages.get(url);
  if (!image) { image = new THREE.ImageLoader().loadAsync(url); groundImages.set(url, image); image.catch(() => groundImages.delete(url)); }
  return image;
}

export function SiteScene({ title, depthLabel, originLabel, wells, surfaces = [], seismic = null, seismicClip, seismicNote, selectedWellId = null, onSelectWell, cursor = null, reach = null, hiddenMarkers = null, highlight = null, slices: given = null, onSlicesChange, curtain = null, ribbon = null, frame: opening = null, onSeismicPick, terrain = null, fence = null, initialExaggeration = 1, legend = true, focusSurfaceId = null, points = null, tools = null }: SiteSceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const ids = useId();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readout, setReadout] = useState<string | null>(null);
  const [layers, setLayers] = useState<Layers>({ wells: true, seismic: true, horizons: true, reference: true, labels: true });
  const [exaggeration, setExaggeration] = useState(initialExaggeration);
  const [colorMap, setColorMap] = useState<SeismicColorMap>("grey");
  const [gain, setGain] = useState(1);
  const volumeFrame = useMemo(() => seismic ? { along: [seismic.alongStartM, seismic.alongEndM] as const, offset: [seismic.offsetStartM, seismic.offsetEndM] as const, depth: [seismic.topTvdM, seismic.baseTvdM] as const } : null, [seismic]);
  const [slices, setSlices] = useState<Slices>({ inline: 0, crossline: null, depth: null });
  const clampTo = (value: number, [a, b]: readonly [number, number]) => Math.min(Math.max(value, Math.min(a, b)), Math.max(a, b));
  const frameOf = (key: SliceKey) => !volumeFrame ? null : key === "inline" ? volumeFrame.offset : key === "crossline" ? volumeFrame.along : volumeFrame.depth;
  /** Positions from outside, clamped to the volume; keys not given keep what is there. */
  const merge = (base: Slices, from: Partial<Slices> | null): Slices => {
    if (!from) return base;
    const next = { ...base };
    for (const key of ["inline", "crossline", "depth"] as const) {
      const value = from[key], range = frameOf(key);
      if (value === undefined) continue;
      next[key] = value === null || !range ? null : clampTo(value, range);
    }
    return next;
  };
  // A new volume starts with the inline through its origin (the well plane, for a well-centred cut),
  // a crossline at the far end and a depth slice at its base, the way interpretation tools open one;
  // positions given from outside win.
  const givenRef = useRef(given);
  givenRef.current = given;
  useEffect(() => {
    if (!volumeFrame) return;
    setSlices(merge({ inline: clampTo(0, volumeFrame.offset), crossline: volumeFrame.along[1] - (volumeFrame.along[1] - volumeFrame.along[0]) * 0.02, depth: volumeFrame.depth[1] - (volumeFrame.depth[1] - volumeFrame.depth[0]) * 0.01 }, givenRef.current));
  }, [volumeFrame]);
  useEffect(() => {
    if (!volumeFrame || !given) return;
    setSlices((current) => { const next = merge(current, given); return next.inline === current.inline && next.crossline === current.crossline && next.depth === current.depth ? current : next; });
  }, [volumeFrame, given?.inline, given?.crossline, given?.depth]);
  /** A slice moved here: kept, and reported to the host. */
  const moveSlice = (key: SliceKey, value: number | null) => {
    setSlices((current) => {
      const range = frameOf(key);
      const next = { ...current, [key]: value === null || !range ? null : clampTo(value, range) };
      if (next[key] !== current[key]) queueMicrotask(() => onSlicesChange?.(next, key));
      return next;
    });
  };
  const dragSlice = useEffectEvent((key: SliceKey, value: number) => moveSlice(key, value));
  const engine = useRef<{
    layers(next: Layers): void; slices(next: Slices): void; style(map: SeismicColorMap, gain: number): void;
    select(id: string | null): void; fit(): void; look(view: NamedView): void;
    cursor(at: { readonly wellId: string; readonly mdM: number } | null): void;
    reach(depths: Readonly<Record<string, number>> | null, hidden: Readonly<Record<string, readonly string[]>> | null): void;
    highlight(band: SiteSceneProps["highlight"]): void;
    curtain(plane: SiteSceneProps["curtain"]): void;
    ribbon(band: SiteSceneProps["ribbon"]): void;
    fence(wall: SiteSceneProps["fence"]): void;
    focusSurface(id: string | null): void;
    points(clouds: SiteSceneProps["points"]): void;
  } | null>(null);
  const openingRef = useRef(opening);
  /** Where the user left the camera: a rebuild (a new surface, a renamed horizon) keeps it rather than flying back to the opening view. */
  const keptView = useRef<{ readonly position: THREE.Vector3; readonly target: THREE.Vector3 } | null>(null);
  openingRef.current = opening;
  const fenceRef = useRef(fence);
  fenceRef.current = fence;
  const reachRef = useRef({ reach, hiddenMarkers });
  reachRef.current = { reach, hiddenMarkers };
  const pick = useEffectEvent((id: string) => onSelectWell?.(id));
  const pickSeismic = useEffectEvent((at: Parameters<NonNullable<SiteSceneProps["onSeismicPick"]>>[0]) => onSeismicPick?.(at));
  const picking = useRef(false);
  picking.current = onSeismicPick !== undefined;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const stage: HTMLDivElement = element;
    let started: SceneRenderer;
    try { started = createSceneRenderer({ alpha: true, toneMapping: THREE.NoToneMapping, pixelRatioCap: 2 }); }
    catch (cause) { setError(`The site scene could not start: ${cause instanceof Error ? cause.message : String(cause)}`); return; }
    setError(null);
    const { renderer } = started;
    renderer.setClearColor(0x000000, 0);
    element.prepend(renderer.domElement);
    const css = getComputedStyle(element);
    const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const axisColour = token("--sw-scene-axis", "#7d8794"), gridColour = token("--sw-scene-grid", "#d5dbe2");
    const scene = new THREE.Scene();
    // Low sky light and an oblique sun from the north-west: relief on a surface shades the way a hillshade map does.
    scene.add(new THREE.HemisphereLight("#ffffff", "#7d8794", 1.25));
    const sun = new THREE.DirectionalLight("#fff7ea", 2.6);
    sun.position.set(-0.9, 1.1, -0.7);
    scene.add(sun);
    const view = new THREE.PerspectiveCamera(38, 1, 1, 1e6);
    const controls = new OrbitControls(view, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    const disposables: { dispose(): void }[] = [];
    const keep = <T extends { dispose(): void }>(item: T) => { disposables.push(item); return item; };

    // ── The frame ────────────────────────────────────────────────────────────────────────────
    const ve = exaggeration;
    const xs: number[] = [], ys: number[] = [], ds: number[] = [];
    const note = (e: number, n: number, d: number) => { xs.push(e); ys.push(n); ds.push(d); };
    for (const well of wells) for (let i = 0; i < well.mdM.length; i++) note(well.xyz[i * 3]!, well.xyz[i * 3 + 1]!, well.xyz[i * 3 + 2]!);
    for (const surface of surfaces) if (surface.geometry.kind === "tin") for (const p of surface.geometry.points) note(p[0], p[1], p[2]); else ds.push(surface.geometry.depthM);
    if (terrain) {
      for (const e of terrain.east) for (const n of terrain.north) { xs.push(e); ys.push(n); }
      // The ground can stand above the datum (negative depth): the frame must reach up to it.
      let top = Infinity, bottom = -Infinity;
      for (let i = 0; i < terrain.depthsM.length; i++) { const d = terrain.depthsM[i]!; if (Number.isFinite(d)) { top = Math.min(top, d); bottom = Math.max(bottom, d); } }
      if (Number.isFinite(top)) ds.push(top, bottom);
    }
    const azimuth = seismic ? THREE.MathUtils.degToRad(seismic.azimuthDeg) : 0, sinA = Math.sin(azimuth), cosA = Math.cos(azimuth);
    const plan = (along: number, offset: number) => seismic ? [(seismic.originEastingM ?? 0) + along * sinA + offset * cosA, (seismic.originNorthingM ?? 0) + along * cosA - offset * sinA] as const : [0, 0] as const;
    if (seismic) for (const a of [seismic.alongStartM, seismic.alongEndM]) for (const o of [seismic.offsetStartM, seismic.offsetEndM]) { const [e, n] = plan(a, o); note(e, n, seismic.topTvdM); note(e, n, seismic.baseTvdM); }
    if (xs.length === 0) { setError("The site has no wells, surfaces or seismic to draw."); started.dispose(); renderer.domElement.remove(); return; }
    const pad = (lo: number, hi: number, f: number) => { const span = Math.max(hi - lo, 200); return [lo - span * f, hi + span * f] as const; };
    const east = scaleLinear().domain(pad(Math.min(...xs), Math.max(...xs), 0.06)).nice();
    const north = scaleLinear().domain(pad(Math.min(...ys), Math.max(...ys), 0.06)).nice();
    const depth = scaleLinear().domain([Math.min(0, ...ds), Math.max(...ds) * 1.02]).nice();
    const [e0, e1] = east.domain() as [number, number], [n0, n1] = north.domain() as [number, number], [d0, d1] = depth.domain() as [number, number];
    const cx = (e0 + e1) / 2, cy = (n0 + n1) / 2;
    const at = (e: number, n: number, d: number) => new THREE.Vector3(e - cx, -d * ve, -(n - cy));
    const span = Math.max(e1 - e0, n1 - n0, (d1 - d0) * ve);
    const radius = span * 0.0042;

    // The box, its ticks and walls, and every label: page text over the canvas, shared with the well scene.
    const labels = new LabelLayer(stage);
    const frameBox = axesBox({ at, east: [e0, e1], north: [n0, n1], depth: [d0, d1], depthTitle: depthLabel, labels, axisColour, gridColour });
    scene.add(frameBox.group);
    disposables.push(frameBox);
    const corners = (d: number) => [at(e0, n0, d), at(e1, n0, d), at(e1, n1, d), at(e0, n1, d)];
    const top = corners(d0), bottom = corners(d1);
    const label = (text: string, position: THREE.Vector3, kind: SceneLabelKind, priority: number, extra?: { readonly className?: string; readonly wellId?: string; readonly colour?: string; readonly layer?: string }) => {
      const entry = labels.label(text, kind, priority, { className: extra?.className, colour: extra?.colour, owner: extra?.wellId, layer: extra?.layer }, position);
      scene.add(entry);
      return entry;
    };

    // ── Surfaces ─────────────────────────────────────────────────────────────────────────────
    const groups = { wells: new THREE.Group(), seismic: new THREE.Group(), horizons: new THREE.Group(), reference: new THREE.Group() };
    for (const group of Object.values(groups)) scene.add(group);
    const pickables: THREE.Object3D[] = [];
    const surfaceParts = new Map<string, { readonly material: THREE.MeshStandardMaterial; readonly opacity: number; readonly quiet: boolean; readonly extras: THREE.Object3D[]; readonly text: ReturnType<typeof label> }>();
    for (const surface of surfaces) {
      const group = surface.role === "horizon" ? groups.horizons : groups.reference;
      const geometry = new THREE.BufferGeometry();
      let outline: THREE.Vector3[];
      let anchor: THREE.Vector3;
      if (surface.geometry.kind === "plane") {
        const d = surface.geometry.depthM;
        const ring = corners(d);
        geometry.setFromPoints(ring);
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        outline = ring.flatMap((p, i) => [p, ring[(i + 1) % 4]!]);
        anchor = at(e0 + (e1 - e0) * 0.04, n1, d);
      } else {
        const { points } = surface.geometry;
        const triangles = surface.geometry.triangles ?? triangulatePlan(points.map((p) => [p[0], p[1]] as const));
        if (triangles.length === 0) continue;
        geometry.setFromPoints(points.map((p) => at(p[0], p[1], p[2])));
        geometry.setIndex([...triangles]);
        if (surface.pointColors?.length === points.length) {
          const linear = new THREE.Color();
          geometry.setAttribute("color", new THREE.Float32BufferAttribute(surface.pointColors.flatMap(([r, g, b]) => { linear.setRGB(r, g, b, THREE.SRGBColorSpace); return [linear.r, linear.g, linear.b]; }), 3));
        }
        // The boundary: edges used by one triangle only.
        const count = new Map<string, [number, number]>();
        for (let t = 0; t < triangles.length; t += 3) for (const [a, b] of [[triangles[t]!, triangles[t + 1]!], [triangles[t + 1]!, triangles[t + 2]!], [triangles[t + 2]!, triangles[t]!]]) {
          const key = a! < b! ? `${a}-${b}` : `${b}-${a}`;
          if (count.has(key)) count.delete(key); else count.set(key, [a!, b!]);
        }
        outline = [...count.values()].flatMap(([a, b]) => [at(...points[a]!), at(...points[b]!)]);
        const mean = points.reduce((sum, p) => [sum[0] + p[0] / points.length, sum[1] + p[1] / points.length, sum[2] + p[2] / points.length], [0, 0, 0]);
        anchor = at(mean[0], mean[1], mean[2]);
      }
      geometry.computeVertexNormals();
      keep(geometry);
      const reference = surface.role === "reference";
      const coloured = surface.geometry.kind === "tin" && surface.pointColors?.length === surface.geometry.points.length;
      const material = keep(new THREE.MeshStandardMaterial({ color: coloured ? "#ffffff" : surface.color, vertexColors: coloured, transparent: true, opacity: reference ? 0.16 : surface.quiet ? 0.07 : coloured ? 0.92 : 0.62, side: THREE.DoubleSide, depthWrite: !reference && !surface.quiet, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.surface = surface;
      mesh.renderOrder = reference ? 3 : 2;
      group.add(mesh);
      if (!reference) pickables.push(mesh);
      const edge = new THREE.LineSegments(keep(new THREE.BufferGeometry().setFromPoints(outline)), keep(new THREE.LineBasicMaterial({ color: surface.color })));
      group.add(edge);
      const extras: THREE.Object3D[] = [edge];
      // Contours draped on an interpreted surface, at a round interval giving about a dozen lines: its relief at a glance.
      if (!reference && surface.geometry.kind === "tin" && surface.geometry.points.length >= 12) {
        const lines = contourLines(surface.geometry.points, [...(surface.geometry.triangles ?? triangulatePlan(surface.geometry.points.map((p) => [p[0], p[1]] as const)))]);
        if (lines.length) {
          const contours = new THREE.LineSegments(keep(new THREE.BufferGeometry().setFromPoints(lines.map((p) => at(p[0], p[1], p[2])))), keep(new THREE.LineBasicMaterial({ color: "#0b0f1a", transparent: true, opacity: 0.45, depthWrite: false })));
          contours.renderOrder = 4;
          group.add(contours);
          extras.push(contours);
        }
      }
      const text = label(surface.label, anchor, "name", reference ? 1 : 2, { className: reference ? "is-reference" : "is-horizon", colour: surface.color, layer: reference ? "reference" : "horizons" });
      if (surface.quiet) { text.visible = false; for (const item of extras) item.visible = false; }
      surfaceParts.set(surface.id, { material, opacity: material.opacity, quiet: !!surface.quiet, extras, text });
    }

    // ── The ground: a height mesh, draped with its image ─────────────────────────────────────
    if (terrain && terrain.cols >= 2 && terrain.rows >= 2 && terrain.depthsM.length === terrain.cols * terrain.rows) {
      const { cols, rows } = terrain, positions = new Float32Array(cols * rows * 3), uvs = new Float32Array(cols * rows * 2);
      let fallback = 0;
      for (let i = 0; i < terrain.depthsM.length; i++) if (Number.isFinite(terrain.depthsM[i]!)) { fallback = terrain.depthsM[i]!; break; }
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const k = r * cols + c, d = terrain.depthsM[k]!;
        // Each sample is the middle of its cell (the extent is the cells' outer edges), and the image covers the whole extent.
        const u = (c + 0.5) / cols, v = (r + 0.5) / rows;
        const p = at(terrain.east[0] + (terrain.east[1] - terrain.east[0]) * u, terrain.north[1] - (terrain.north[1] - terrain.north[0]) * v, Number.isFinite(d) ? d : fallback);
        positions.set([p.x, p.y, p.z], k * 3);
        uvs.set([u, 1 - v], k * 2);
      }
      const index: number[] = [];
      for (let r = 0; r + 1 < rows; r++) for (let c = 0; c + 1 < cols; c++) { const k = r * cols + c; index.push(k, k + cols, k + 1, k + 1, k + cols, k + cols + 1); }
      const geometry = keep(new THREE.BufferGeometry());
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
      geometry.setIndex(index);
      geometry.computeVertexNormals();
      // Earth-coloured until the image arrives (white would flash); the image is decoded once per page and reused by every rebuild.
      const material = keep(new THREE.MeshStandardMaterial({ color: "#9a8f78", roughness: 1, metalness: 0, side: THREE.DoubleSide }));
      if (terrain.imageUrl) groundImage(terrain.imageUrl).then((image) => {
        if (dead) return;
        const texture = keep(new THREE.Texture(image));
        texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8; texture.needsUpdate = true;
        material.map = texture; material.color.set("#ffffff"); material.needsUpdate = true; invalidate();
      }, () => { /* no image: the ground stays plain */ });
      const ground = new THREE.Mesh(geometry, material);
      ground.renderOrder = 1;
      groups.reference.add(ground);
      label(terrain.label, at(terrain.east[0], terrain.north[1], Number.isFinite(terrain.depthsM[0]!) ? terrain.depthsM[0]! : fallback), "name", 1, { className: "is-reference", layer: "reference" });
    }

    // ── Wells ────────────────────────────────────────────────────────────────────────────────
    const wellMaterials = new Map<string, THREE.MeshStandardMaterial>();
    const wellTubes: THREE.Mesh[] = [];
    /** Everything drawn along a well, with the MD it spans, so a reach can cut it. */
    const alongWells: { readonly wellId: string; readonly object: THREE.Object3D; readonly start: number; readonly end: number; readonly segments?: number; readonly marker?: string }[] = [];
    wells.forEach((well, index) => {
      const colour = WELL_COLOURS[index % WELL_COLOURS.length]!;
      const points: THREE.Vector3[] = [];
      for (let i = 0; i < well.mdM.length; i++) points.push(at(well.xyz[i * 3]!, well.xyz[i * 3 + 1]!, well.xyz[i * 3 + 2]!));
      if (points.length < 2) return;
      const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
      const material = keep(new THREE.MeshStandardMaterial({ color: colour, roughness: 0.45, metalness: 0.1, emissive: colour, emissiveIntensity: 0 }));
      wellMaterials.set(well.id, material);
      const tubeSegments = Math.min(1200, points.length * 3);
      const tube = new THREE.Mesh(keep(new THREE.TubeGeometry(curve, tubeSegments, radius, 10, false)), material);
      tube.userData.well = well;
      alongWells.push({ wellId: well.id, object: tube, start: well.mdM[0]!, end: well.mdM[well.mdM.length - 1]!, segments: tubeSegments });
      groups.wells.add(tube);
      wellTubes.push(tube);
      pickables.push(tube);
      const head = points[0]!;
      const cap = new THREE.Mesh(keep(new THREE.CylinderGeometry(radius * 2.6, radius * 2.6, radius * 2.2, 20)), material);
      cap.position.copy(head);
      cap.userData.well = well;
      groups.wells.add(cap);
      pickables.push(cap);
      label(well.label, head.clone().add(new THREE.Vector3(0, radius * 9, 0)), "name", 3, { className: "is-well", wellId: well.id, colour });
      for (const interval of well.intervals ?? []) {
        const sub: THREE.Vector3[] = [];
        const step = Math.max(2, (interval.baseMdM - interval.topMdM) / 60);
        for (let md = interval.topMdM; md <= interval.baseMdM + 1e-6; md += step) { const p = pointAtMd(well, Math.min(md, interval.baseMdM)); if (p) sub.push(at(...p)); }
        if (sub.length < 2) continue;
        const band = new THREE.Mesh(keep(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sub, false, "centripetal"), sub.length * 2, radius * 1.75, 12, false)), keep(new THREE.MeshStandardMaterial({ color: interval.color, roughness: 0.6 })));
        band.userData.well = well;
        alongWells.push({ wellId: well.id, object: band, start: interval.topMdM, end: interval.baseMdM, segments: sub.length * 2 });
        groups.wells.add(band);
        pickables.push(band);
      }
      for (const marker of well.markers ?? []) {
        const p = pointAtMd(well, marker.mdM);
        if (!p) continue;
        const position = at(...p);
        const ring = new THREE.Mesh(keep(new THREE.SphereGeometry(radius * 2.1, 14, 10)), keep(new THREE.MeshStandardMaterial({ color: "#1d232b", roughness: 0.5 })));
        ring.position.copy(position);
        groups.wells.add(ring);
        const pick = label(marker.label, position.clone().add(new THREE.Vector3(radius * 5, 0, 0)), "pick", 1, { wellId: well.id, layer: "wells" });
        alongWells.push({ wellId: well.id, object: ring, start: marker.mdM, end: marker.mdM, marker: marker.label }, { wellId: well.id, object: pick, start: marker.mdM, end: marker.mdM, marker: marker.label });
      }
    });

    let highlightMesh: THREE.Mesh | null = null;
    let ribbonGroup: THREE.Group | null = null, ribbonLabel: ReturnType<typeof label> | null = null;
    let ribbonBand: SiteSceneProps["ribbon"] = null, ribbonMap: SeismicColorMap = "grey";
    const clearRibbon = () => {
      if (ribbonGroup) { scene.remove(ribbonGroup); ribbonGroup.traverse((item) => { if (item instanceof THREE.Mesh || item instanceof THREE.LineSegments) { item.geometry.dispose(); (item.material as THREE.Material).dispose(); } }); ribbonGroup = null; }
      if (ribbonLabel) { labels.remove(ribbonLabel); ribbonLabel = null; }
    };
    /** The ribbon as two rows of vertices either side of the well, each pair coloured by its sample. */
    const drawRibbon = () => {
      clearRibbon();
      const band = ribbonBand, well = band ? wells.find((entry) => entry.id === band.wellId) : undefined;
      if (!band || !well || band.mdM.length < 2) { invalidate(); return; }
      const [ux, uy] = seismic ? [sinA, cosA] : [1, 0];
      const positions: number[] = [], colours: number[] = [], index: number[] = [], left: THREE.Vector3[] = [], right: THREE.Vector3[] = [];
      const colour = new THREE.Color();
      for (let k = 0; k < band.mdM.length; k++) {
        const p = pointAtMd(well, band.mdM[k]!);
        if (!p) continue;
        const a = at(p[0] - ux * band.halfWidthM, p[1] - uy * band.halfWidthM, p[2]), b = at(p[0] + ux * band.halfWidthM, p[1] + uy * band.halfWidthM, p[2]);
        const [r, g, bl] = seismicColour(band.colorMap ?? ribbonMap, band.values[k] ?? 0);
        colour.setRGB(r / 255, g / 255, bl / 255, THREE.SRGBColorSpace);
        const row = positions.length / 6;
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        colours.push(colour.r, colour.g, colour.b, colour.r, colour.g, colour.b);
        if (row > 0) index.push((row - 1) * 2, row * 2, row * 2 + 1, (row - 1) * 2, row * 2 + 1, (row - 1) * 2 + 1);
        left.push(a); right.push(b);
      }
      if (left.length < 2) { invalidate(); return; }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
      geometry.setIndex(index);
      // Drawn just in front of a slice it lies in, so the two never fight for the same pixels.
      const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      const edgeColour = token("--sw-cursor", "#1d4ed8");
      const outline = [...left.slice(1).flatMap((p, i) => [left[i]!, p]), ...right.slice(1).flatMap((p, i) => [right[i]!, p]), left[0]!, right[0]!, left.at(-1)!, right.at(-1)!];
      const edge = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(outline), new THREE.LineBasicMaterial({ color: edgeColour }));
      fill.renderOrder = edge.renderOrder = 9;
      ribbonGroup = new THREE.Group();
      ribbonGroup.add(fill, edge);
      scene.add(ribbonGroup);
      ribbonLabel = label(band.label, right[0]!.clone(), "name", 3, { className: "is-cursor", colour: edgeColour });
      invalidate();
    };
    let curtainGroup: THREE.Group | null = null, curtainLabel: ReturnType<typeof label> | null = null;
    let fenceGroup: THREE.Group | null = null, fenceLabels: ReturnType<typeof label>[] = [];
    const clearFence = () => {
      if (fenceGroup) { scene.remove(fenceGroup); fenceGroup.traverse((item) => { if (item instanceof THREE.Mesh || item instanceof THREE.LineSegments) { item.geometry.dispose(); (item.material as THREE.Material).dispose(); } }); fenceGroup = null; }
      for (const entry of fenceLabels) labels.remove(entry);
      fenceLabels = [];
    };
    /** The fence: its wall, a column down each well in the wall's own plane, and the lines across it. */
    const drawFence = (wall: SiteSceneProps["fence"]) => {
      clearFence();
      if (!wall) { invalidate(); return; }
      const group = new THREE.Group();
      const stations = wall.stations;
      if (stations.length >= 2) {
        const positions: number[] = [], index: number[] = [];
        stations.forEach(([e, n], i) => {
          const a = at(e, n, wall.topM), b = at(e, n, wall.baseM);
          positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
          if (i > 0) index.push((i - 1) * 2, i * 2, i * 2 + 1, (i - 1) * 2, i * 2 + 1, (i - 1) * 2 + 1);
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(index);
        const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: token("--sw-fence", "#c7d2fe"), transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }));
        fill.renderOrder = 7;
        const outline: THREE.Vector3[] = [];
        stations.forEach(([e, n], i) => {
          outline.push(at(e, n, wall.topM), at(e, n, wall.baseM));
          if (i > 0) { const [pe, pn] = stations[i - 1]!; outline.push(at(pe, pn, wall.topM), at(e, n, wall.topM), at(pe, pn, wall.baseM), at(e, n, wall.baseM)); }
        });
        group.add(fill, new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(outline), new THREE.LineBasicMaterial({ color: token("--sw-fence", "#c7d2fe"), transparent: true, opacity: 0.55 })));
      }
      // Each column lies in the wall: across the well along the wall's direction where the well stands.
      const half = span * 0.018;
      for (const column of stations.length ? wall.columns ?? [] : []) {
        const well = wells.find((entry) => entry.id === column.wellId);
        if (!well || !column.intervals.length) continue;
        const head = [well.xyz[0]!, well.xyz[1]!] as const;
        let nearest = 0;
        stations.forEach(([e, n], i) => { if (Math.hypot(e - head[0], n - head[1]) < Math.hypot(stations[nearest]![0] - head[0], stations[nearest]![1] - head[1])) nearest = i; });
        const from = stations[Math.max(0, nearest - 1)]!, to = stations[Math.min(stations.length - 1, nearest + 1)]!;
        const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
        const [ux, uy] = length > 0 ? [(to[0] - from[0]) / length, (to[1] - from[1]) / length] : [1, 0];
        const positions: number[] = [], colours: number[] = [], index: number[] = [];
        const colour = new THREE.Color();
        for (const interval of column.intervals) {
          const p = pointAtMd(well, interval.topMdM), q = pointAtMd(well, interval.baseMdM);
          if (!p || !q) continue;
          colour.set(interval.color);
          const row = positions.length / 3;
          for (const [e, n, d] of [p, q]) { const a = at(e - ux * half, n - uy * half, d), b = at(e + ux * half, n + uy * half, d); positions.push(a.x, a.y, a.z, b.x, b.y, b.z); }
          for (let k = 0; k < 4; k++) colours.push(colour.r, colour.g, colour.b);
          index.push(row, row + 2, row + 3, row, row + 3, row + 1);
        }
        if (!index.length) continue;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
        geometry.setIndex(index);
        const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
        fill.renderOrder = 8;
        group.add(fill);
      }
      // Lines across the wall, as thin tubes so they read at any distance.
      for (const line of wall.lines ?? []) {
        if (line.points.length < 2) continue;
        const path = new THREE.CurvePath<THREE.Vector3>();
        const points = line.points.map(([e, n, d]) => at(e, n, d));
        for (let i = 1; i < points.length; i++) path.add(new THREE.LineCurve3(points[i - 1]!, points[i]!));
        const tube = new THREE.Mesh(new THREE.TubeGeometry(path, (points.length - 1) * 4, radius * (line.emphasis ? 1.9 : 1.05), 8, false), new THREE.MeshBasicMaterial({ color: line.color, depthTest: !line.emphasis, transparent: true, opacity: line.emphasis ? 1 : 0.92 }));
        tube.renderOrder = line.emphasis ? 10 : 9;
        group.add(tube);
        // Labelled halfway along its last span, clear of the well names at either end.
        if (line.label) fenceLabels.push(label(line.label, points.at(-2)!.clone().lerp(points.at(-1)!, 0.5), "pick", line.emphasis ? 3 : 1, { colour: line.color }));
      }
      if (stations.length) { const [e, n] = stations[0]!; fenceLabels.push(label(wall.label, at(e, n, wall.topM), "name", 3, { className: "is-seismic" })); }
      fenceGroup = group;
      scene.add(group);
      invalidate();
    };
    // ── Point clouds: instanced spheres, one draw per cloud ─────────────────────────────────
    let pointGroup: THREE.Group | null = null;
    let pointLabels: ReturnType<typeof label>[] = [];
    const pointSphere = keep(new THREE.SphereGeometry(1, 12, 8));
    const drawPoints = (clouds: SiteSceneProps["points"]) => {
      if (pointGroup) { scene.remove(pointGroup); pointGroup.traverse((item) => { if (item instanceof THREE.InstancedMesh) { (item.material as THREE.Material).dispose(); item.dispose(); } }); pointGroup = null; }
      for (const entry of pointLabels) labels.remove(entry);
      pointLabels = [];
      if (!clouds?.length) { invalidate(); return; }
      const group = new THREE.Group(), matrix = new THREE.Matrix4(), colour = new THREE.Color();
      for (const cloud of clouds) {
        if (!cloud.points.length) continue;
        const mesh = new THREE.InstancedMesh(pointSphere, new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: (cloud.opacity ?? 1) < 1, opacity: cloud.opacity ?? 1, depthWrite: (cloud.opacity ?? 1) >= 1 }), cloud.points.length);
        let sum = new THREE.Vector3();
        cloud.points.forEach((p, i) => {
          const at3 = at(p.e, p.n, p.d), r = radius * 1.35 * Math.max(0.3, p.size);
          matrix.makeScale(r, r, r).setPosition(at3);
          mesh.setMatrixAt(i, matrix);
          mesh.setColorAt(i, colour.set(p.color ?? cloud.color));
          sum = sum.add(at3);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.renderOrder = 9;
        group.add(mesh);
        pointLabels.push(label(`${cloud.label} · ${cloud.points.length}`, sum.multiplyScalar(1 / cloud.points.length), "pick", 2, { colour: cloud.color }));
      }
      pointGroup = group;
      scene.add(group);
      invalidate();
    };
    // ── The linked depth cursor: one ring, moved along whichever well it is on ─────────────
    const cursorColour = token("--sw-cursor", "#1d4ed8");
    const cursorRing = new THREE.Mesh(keep(new THREE.TorusGeometry(radius * 3.4, radius * 0.7, 10, 32)), keep(new THREE.MeshBasicMaterial({ color: cursorColour, depthTest: false, transparent: true })));
    const cursorDot = new THREE.Mesh(keep(new THREE.SphereGeometry(radius * 1.9, 14, 10)), keep(new THREE.MeshBasicMaterial({ color: cursorColour, depthTest: false, transparent: true })));
    cursorRing.renderOrder = cursorDot.renderOrder = 10;
    cursorRing.visible = cursorDot.visible = false;
    scene.add(cursorRing, cursorDot);
    const cursorLabel = label("", new THREE.Vector3(), "pick", 4, { className: "is-cursor", colour: cursorColour });
    cursorLabel.visible = false;

    // ── Seismic ──────────────────────────────────────────────────────────────────────────────
    const gainUniform = uniform(1);
    let lutBytes: Uint8Array | null = null, lutTexture: THREE.DataTexture | null = null;
    const sliceMeshes = new Map<SliceKey, { mesh: THREE.Mesh; edge: THREE.LineSegments }>();
    let frameInverse: THREE.Matrix4 | null = null, frameMatrix: THREE.Matrix4 | null = null;
    const handles = new Map<SliceKey, THREE.Mesh>();
    if (seismic) {
      const { alongCount: nx, offsetCount: ny, sampleCount: nz } = seismic;
      if (seismic.counts.length !== nx * ny * nz) throw new Error(`Seismic volume has ${seismic.counts.length} counts, expected ${nx} × ${ny} × ${nz}.`);
      const corner = (a: number, o: number, d: number) => { const [e, n] = plan(a, o); return at(e, n, d); };
      const origin = corner(seismic.alongStartM, seismic.offsetStartM, seismic.topTvdM);
      frameMatrix = new THREE.Matrix4().makeBasis(
        corner(seismic.alongEndM, seismic.offsetStartM, seismic.topTvdM).sub(origin),
        corner(seismic.alongStartM, seismic.offsetEndM, seismic.topTvdM).sub(origin),
        corner(seismic.alongStartM, seismic.offsetStartM, seismic.baseTvdM).sub(origin),
      ).setPosition(origin);
      frameInverse = frameMatrix.clone().invert();
      const bytes = new Uint8Array(seismic.counts.length);
      for (let i = 0; i < bytes.length; i++) bytes[i] = seismic.counts[i]! + 128;
      const texture = keep(new THREE.Data3DTexture(bytes, nx, ny, nz));
      texture.format = THREE.RedFormat; texture.type = THREE.UnsignedByteType;
      texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
      texture.unpackAlignment = 1; texture.needsUpdate = true;
      lutBytes = new Uint8Array(256 * 4);
      lutTexture = keep(new THREE.DataTexture(lutBytes, 256, 1, THREE.RGBAFormat));
      lutTexture.magFilter = THREE.LinearFilter; lutTexture.minFilter = THREE.LinearFilter;
      lutTexture.colorSpace = THREE.SRGBColorSpace;
      const material = keep(sliceMaterial(texture, lutTexture, gainUniform));
      for (const key of ["inline", "crossline", "depth"] as const) {
        const geometry = keep(new THREE.BufferGeometry());
        geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(frameMatrix);
        mesh.userData.slice = key;
        const edgeGeometry = keep(new THREE.BufferGeometry());
        edgeGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(24), 3));
        const edge = new THREE.LineSegments(edgeGeometry, keep(new THREE.LineBasicMaterial({ color: "#36404b" })));
        edge.matrixAutoUpdate = false;
        edge.matrix.copy(frameMatrix);
        groups.seismic.add(mesh, edge);
        pickables.push(mesh);
        sliceMeshes.set(key, { mesh, edge });
        // A handle on the slice's top edge: dragging it moves the slice; dragging anywhere else orbits.
        const handle = new THREE.Mesh(keep(new THREE.SphereGeometry(radius * 4.5, 20, 14)), keep(new THREE.MeshBasicMaterial({ color: token("--sw-select", "#f59e0b"), depthTest: false, transparent: true, opacity: 0.95 })));
        handle.renderOrder = 11;
        handle.userData.handle = key;
        groups.seismic.add(handle);
        handles.set(key, handle);
      }
      const unit = keep(new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5));
      const box = new THREE.LineSegments(keep(new THREE.EdgesGeometry(unit)), keep(new THREE.LineBasicMaterial({ color: "#36404b", transparent: true, opacity: 0.55 })));
      box.matrixAutoUpdate = false;
      box.matrix.copy(frameMatrix);
      groups.seismic.add(box);
      label(seismic.label ?? "Seismic volume", corner(seismic.alongEndM, seismic.offsetStartM, seismic.topTvdM), "name", 2, { className: "is-seismic", layer: "seismic" });
    }
    const amplitudeAt = (point: THREE.Vector3) => {
      if (!seismic || !frameInverse) return null;
      const uvw = point.clone().applyMatrix4(frameInverse);
      const index = (value: number, count: number) => THREE.MathUtils.clamp(Math.floor(value * count), 0, count - 1);
      const count = seismic.counts[(index(uvw.z, seismic.sampleCount) * seismic.offsetCount + index(uvw.y, seismic.offsetCount)) * seismic.alongCount + index(uvw.x, seismic.alongCount)]!;
      return count * seismic.amplitudePerCount;
    };

    // ── Drawing on demand ────────────────────────────────────────────────────────────────────
    let engineSlices: Slices = { inline: null, crossline: null, depth: null };
    let frame = 0, layerState: Layers = { wells: true, seismic: true, horizons: true, reference: true, labels: true }, selected: string | null = null;
    function placeLabels() {
      labels.place(view, (entry) => {
        const layer = entry.options.layer as keyof Layers | undefined;
        return layerState.labels && (!layer || layerState[layer]) && (entry.kind !== "pick" || entry.options.owner === selected || wells.length === 1);
      }, [...stage.querySelectorAll(".sw-site-hud, .sw-site-readout, .sw-viewcube")]);
    }
    function draw() {
      frame = 0;
      cube.update();
      if (!cube.swinging && controls.update()) invalidate();
      if (cube.swinging) invalidate();
      sun.position.copy(view.position).add(new THREE.Vector3(span, span * 2, span));
      if (started.draws()) renderer.render(scene, view);
      placeLabels();
    }
    function invalidate() { if (!frame) frame = requestAnimationFrame(draw); }
    const home = new THREE.Vector3(0.95, 0.62, 1.15);
    const cube = new ViewCube(view, controls, element, { labels: COMPASS_FACES, compass: true, home, onChange: invalidate });
    function fitTo(sphere: THREE.Sphere, direction = view.position.clone().sub(controls.target).normalize()) {
      const fov = THREE.MathUtils.degToRad(view.fov / 2);
      const distance = sphere.radius / Math.sin(Math.min(fov, Math.atan(Math.tan(fov) * view.aspect))) * 1.08;
      controls.target.copy(sphere.center);
      view.position.copy(sphere.center).addScaledVector(direction.lengthSq() ? direction : home.clone().normalize(), distance);
      view.near = distance / 200; view.far = distance * 20; view.updateProjectionMatrix();
      controls.update();
      invalidate();
    }
    const whole = new THREE.Box3().setFromPoints([...top, ...bottom]).getBoundingSphere(new THREE.Sphere());
    controls.maxDistance = whole.radius * 8;
    controls.minDistance = radius * 6;

    // The opening view: the whole site, or a well interval framed with room around it, looking along the volume's offset axis.
    const opened = openingRef.current, openWell = opened ? wells.find((entry) => entry.id === opened.wellId) : undefined;
    let openingView = () => fitTo(whole, home.clone().normalize());
    if (opened && openWell) {
      const points: THREE.Vector3[] = [];
      for (let md = opened.topMdM; md <= opened.baseMdM; md += Math.max(1, (opened.baseMdM - opened.topMdM) / 40)) { const p = pointAtMd(openWell, md); if (p) points.push(at(...p)); }
      if (points.length) {
        const sphere = new THREE.Box3().setFromPoints(points).getBoundingSphere(new THREE.Sphere());
        sphere.radius = Math.max(sphere.radius * 1.15, radius * 30);
        openingView = () => fitTo(sphere, new THREE.Vector3(seismic ? cosA : 0, 0.32, seismic ? sinA : 1).normalize());
      }
    }
    // With a fence and no interval to open on, the fence fills the view, seen square-on from the home side.
    const wall = fenceRef.current;
    if (!(opened && openWell) && wall && wall.stations.length >= 2) {
      const corners = wall.stations.flatMap(([e, n]) => [at(e, n, wall.topM), at(e, n, wall.baseM)]);
      const sphere = new THREE.Box3().setFromPoints(corners).getBoundingSphere(new THREE.Sphere());
      const first = corners[0]!, last = corners[corners.length - 2]!;
      const along = last.clone().sub(first).setY(0).normalize();
      const normal = new THREE.Vector3(-along.z, 0, along.x);
      if (normal.dot(home) < 0) normal.negate();
      sphere.radius *= 0.92;
      const facing = normal.add(new THREE.Vector3(0, 0.42, 0)).normalize();
      openingView = () => fitTo(sphere, facing.clone());
    }
    // Until the camera is first moved by hand, the opening view is fitted again as the stage settles (a tile opening, say).
    // Once it has been, a rebuilt scene opens where the user left it.
    let settling = !keptView.current;
    if (keptView.current) {
      view.position.copy(keptView.current.position); controls.target.copy(keptView.current.target);
      const distance = view.position.distanceTo(controls.target);
      view.near = distance / 200; view.far = distance * 20; view.updateProjectionMatrix(); controls.update();
    }
    controls.addEventListener("start", () => { settling = false; });
    controls.addEventListener("change", () => { if (!settling) keptView.current = { position: view.position.clone(), target: controls.target.clone() }; });
    function resize() {
      const width = Math.max(1, stage.clientWidth), height = Math.max(1, stage.clientHeight);
      view.aspect = width / height; view.updateProjectionMatrix();
      renderer.setSize(width, height);
      if (settling) openingView();
      invalidate();
    }
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    controls.addEventListener("change", invalidate);

    // Hover reads the site under the pointer; a click on a well selects it.
    const ray = new THREE.Raycaster();
    let hoverFrame = 0, down: [number, number] | null = null;
    const hitAt = (clientX: number, clientY: number) => {
      const box = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((clientX - box.left) / box.width * 2 - 1, -(clientY - box.top) / box.height * 2 + 1), view);
      return ray.intersectObjects(pickables.filter((object) => { for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false; return true; }), false)[0] ?? null;
    };
    const trueAt = (point: THREE.Vector3) => ({ e: point.x + cx, n: -point.z + cy, d: -point.y / ve });
    /** The first seismic slice under the pointer, whatever lies in front of it, in the volume's own units. */
    const sliceAt = (clientX: number, clientY: number) => {
      if (!seismic || !frameInverse || !groups.seismic.visible) return null;
      const box = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((clientX - box.left) / box.width * 2 - 1, -(clientY - box.top) / box.height * 2 + 1), view);
      const hit = ray.intersectObjects([...sliceMeshes.values()].map((entry) => entry.mesh).filter((mesh) => mesh.visible), false)[0];
      if (!hit) return null;
      const uvw = hit.point.clone().applyMatrix4(frameInverse);
      return { alongM: seismic.alongStartM + uvw.x * (seismic.alongEndM - seismic.alongStartM), offsetM: seismic.offsetStartM + uvw.y * (seismic.offsetEndM - seismic.offsetStartM), depthM: seismic.topTvdM + uvw.z * (seismic.baseTvdM - seismic.topTvdM), slice: hit.object.userData.slice as SliceKey };
    };
    const describe = (hit: THREE.Intersection) => {
      const { e, n, d } = trueAt(hit.point);
      const where = `E ${fmt(e)} · N ${fmt(n)} · ${fmt(d)} m depth`;
      const well = hit.object.userData.well as SiteSceneWell | undefined;
      if (well) {
        let best = 0, distance = Infinity;
        for (let i = 0; i < well.mdM.length; i++) {
          const q = at(well.xyz[i * 3]!, well.xyz[i * 3 + 1]!, well.xyz[i * 3 + 2]!).distanceToSquared(hit.point);
          if (q < distance) { distance = q; best = i; }
        }
        return `${well.label} · ${fmt(well.mdM[best]!)} m MD · ${fmt(well.xyz[best * 3 + 2]!)} m depth · click to select`;
      }
      const surface = hit.object.userData.surface as SiteSceneSurface | undefined;
      if (surface) return `${surface.label} · ${where} · ${surface.note}`;
      const slice = hit.object.userData.slice as SliceKey | undefined;
      if (slice) { const amplitude = amplitudeAt(hit.point); return `${slice === "inline" ? "Inline" : slice === "crossline" ? "Crossline" : "Depth slice"} · ${where} · amplitude ${amplitude === null ? "not available" : amplitude.toFixed(3)} · drag its handle to move it`; }
      return where;
    };
    // Dragging a slice handle: the pointer moves on the plane through the handle that holds the
    // slice's axis and faces the camera most squarely; the slice follows the pointer along the axis.
    const handleAt = (clientX: number, clientY: number) => {
      const box = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((clientX - box.left) / box.width * 2 - 1, -(clientY - box.top) / box.height * 2 + 1), view);
      const shown = [...handles.values()].filter((handle) => handle.visible && groups.seismic.visible);
      return ray.intersectObjects(shown, false)[0] ?? null;
    };
    let sliding: { readonly key: SliceKey; readonly axis: THREE.Vector3; readonly plane: THREE.Plane; readonly from: THREE.Vector3; readonly value: number; readonly span: number; readonly pointer: number } | null = null;
    const pointOnPlane = (clientX: number, clientY: number, plane: THREE.Plane) => {
      const box = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((clientX - box.left) / box.width * 2 - 1, -(clientY - box.top) / box.height * 2 + 1), view);
      return ray.ray.intersectPlane(plane, new THREE.Vector3());
    };
    const move = (event: PointerEvent) => {
      if (sliding) {
        const point = pointOnPlane(event.clientX, event.clientY, sliding.plane);
        if (point) dragSlice(sliding.key, sliding.value + point.sub(sliding.from).dot(sliding.axis) / sliding.axis.lengthSq() * sliding.span);
        return;
      }
      if (event.buttons) return;
      cancelAnimationFrame(hoverFrame);
      hoverFrame = requestAnimationFrame(() => {
        const handle = handleAt(event.clientX, event.clientY);
        renderer.domElement.style.cursor = handle ? "grab" : picking.current && sliceAt(event.clientX, event.clientY) ? "crosshair" : "";
        if (handle) { const key = handle.object.userData.handle as SliceKey; setReadout(`${key === "inline" ? "Inline" : key === "crossline" ? "Crossline" : "Depth slice"} handle · drag to move the slice`); return; }
        const hit = hitAt(event.clientX, event.clientY); setReadout(hit ? describe(hit) : null);
      });
    };
    const leave = () => { cancelAnimationFrame(hoverFrame); setReadout(null); };
    const press = (event: PointerEvent) => {
      down = [event.clientX, event.clientY];
      const handle = event.button === 0 && seismic && frameMatrix ? handleAt(event.clientX, event.clientY) : null;
      if (!handle || !seismic || !frameMatrix) return;
      const key = handle.object.userData.handle as SliceKey;
      const axis = new THREE.Vector3().setFromMatrixColumn(frameMatrix, key === "inline" ? 1 : key === "crossline" ? 0 : 2);
      const look = view.getWorldDirection(new THREE.Vector3());
      const facing = look.clone().sub(axis.clone().normalize().multiplyScalar(look.dot(axis.clone().normalize())));
      if (facing.lengthSq() < 1e-8) return;
      const range = key === "inline" ? [seismic.offsetStartM, seismic.offsetEndM] : key === "crossline" ? [seismic.alongStartM, seismic.alongEndM] : [seismic.topTvdM, seismic.baseTvdM];
      const value = engineSlices[key];
      if (value === null) return;
      sliding = { key, axis, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(facing.normalize(), handle.object.position), from: handle.object.position.clone(), value, span: range[1]! - range[0]!, pointer: event.pointerId };
      controls.enabled = false;
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = "grabbing";
      event.stopImmediatePropagation();
    };
    const release = (event: PointerEvent) => {
      if (sliding) {
        if (renderer.domElement.hasPointerCapture(sliding.pointer)) renderer.domElement.releasePointerCapture(sliding.pointer);
        sliding = null; down = null; controls.enabled = true; renderer.domElement.style.cursor = "";
        return;
      }
      if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) { down = null; return; }
      down = null;
      const well = hitAt(event.clientX, event.clientY)?.object.userData.well as SiteSceneWell | undefined;
      if (well) { pick(well.id); return; }
      if (picking.current) { const at = sliceAt(event.clientX, event.clientY); if (at) pickSeismic(at); }
    };
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerleave", leave);
    // Capture phase, so a press on a slice handle is seen before the orbit controls take it.
    renderer.domElement.addEventListener("pointerdown", press, { capture: true });
    renderer.domElement.addEventListener("pointerup", release);
    renderer.domElement.setAttribute("aria-label", `${title}: 3D site view. Drag to orbit, right-drag to pan, wheel to zoom. Use the view buttons and layer controls for keyboard access.`);

    engine.current = {
      layers(next) {
        layerState = next;
        groups.wells.visible = next.wells; groups.seismic.visible = next.seismic; groups.horizons.visible = next.horizons; groups.reference.visible = next.reference;
        invalidate();
      },
      slices(next) {
        engineSlices = next;
        if (!seismic) return;
        const fraction = (value: number, a: number, b: number) => THREE.MathUtils.clamp((value - a) / (b - a), 0, 1);
        for (const [key, { mesh, edge }] of sliceMeshes) {
          const value = next[key];
          mesh.visible = edge.visible = value !== null;
          if (value === null) continue;
          const f = key === "inline" ? fraction(value, seismic.offsetStartM, seismic.offsetEndM) : key === "crossline" ? fraction(value, seismic.alongStartM, seismic.alongEndM) : fraction(value, seismic.topTvdM, seismic.baseTvdM);
          const quad = key === "inline" ? [[0, f, 0], [1, f, 0], [1, f, 1], [0, f, 1]] : key === "crossline" ? [[f, 0, 0], [f, 1, 0], [f, 1, 1], [f, 0, 1]] : [[0, 0, f], [1, 0, f], [1, 1, f], [0, 1, f]];
          const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
          quad.forEach((p, i) => position.setXYZ(i, p[0]!, p[1]!, p[2]!));
          position.needsUpdate = true;
          mesh.geometry.computeBoundingSphere(); mesh.geometry.computeBoundingBox();
          const edgePosition = edge.geometry.getAttribute("position") as THREE.BufferAttribute;
          quad.forEach((p, i) => { const q = quad[(i + 1) % 4]!; edgePosition.setXYZ(i * 2, p[0]!, p[1]!, p[2]!); edgePosition.setXYZ(i * 2 + 1, q[0]!, q[1]!, q[2]!); });
          edgePosition.needsUpdate = true;
          edge.geometry.computeBoundingSphere();
        }
        for (const [key, handle] of handles) {
          const value = next[key];
          handle.visible = value !== null && frameMatrix !== null;
          if (value === null || !frameMatrix) continue;
          const f = key === "inline" ? fraction(value, seismic.offsetStartM, seismic.offsetEndM) : key === "crossline" ? fraction(value, seismic.alongStartM, seismic.alongEndM) : fraction(value, seismic.topTvdM, seismic.baseTvdM);
          handle.position.set(...(key === "inline" ? [0.5, f, 0] : key === "crossline" ? [f, 0.5, 0] : [1, 0.5, f]) as [number, number, number]).applyMatrix4(frameMatrix);
        }
        invalidate();
      },
      style(map, nextGain) {
        if (!seismic || !lutBytes || !lutTexture) return;
        ribbonMap = map;
        if (ribbonBand) drawRibbon();
        for (let i = 0; i < 256; i++) { const [r, g, b] = seismicColour(map, i / 127.5 - 1); lutBytes.set([r, g, b, 255], i * 4); }
        lutTexture.needsUpdate = true;
        // At gain 1 colour saturates at the clip amplitude, the 2D section's default.
        const clip = seismicClip ?? 127 * seismic.amplitudePerCount;
        gainUniform.value = nextGain * seismic.amplitudePerCount * 127 / clip;
        invalidate();
      },
      select(id) {
        selected = id;
        for (const [wellId, material] of wellMaterials) material.emissiveIntensity = wellId === id ? 0.55 : 0;
        labels.each((entry) => { if (entry.options.owner && entry.kind === "name") entry.element.classList.toggle("is-selected", entry.options.owner === id); });
        invalidate();
      },
      fit() { fitTo(whole, home.clone().normalize()); },
      look(named) { cube.look(named); invalidate(); },
      reach(depths, hidden) {
        for (const item of alongWells) {
          if (item.marker !== undefined && hidden?.[item.wellId]?.includes(item.marker)) { item.object.visible = false; continue; }
          const limit = depths?.[item.wellId];
          if (limit === undefined) { item.object.visible = true; if (item.segments && item.object instanceof THREE.Mesh) item.object.geometry.setDrawRange(0, Infinity); continue; }
          if (!item.segments || !(item.object instanceof THREE.Mesh)) { item.object.visible = item.end <= limit; continue; }
          const part = THREE.MathUtils.clamp((limit - item.start) / Math.max(1e-6, item.end - item.start), 0, 1);
          const total = item.object.geometry.index?.count ?? 0;
          item.object.geometry.setDrawRange(0, part >= 1 ? total : Math.ceil(part * item.segments) * (total / item.segments));
          item.object.visible = part > 0;
        }
        invalidate();
      },
      curtain(plane) {
        if (curtainGroup) { scene.remove(curtainGroup); curtainGroup.traverse((item) => { if (item instanceof THREE.Mesh || item instanceof THREE.LineSegments) { item.geometry.dispose(); (item.material as THREE.Material).dispose(); } }); curtainGroup = null; }
        if (curtainLabel) { labels.remove(curtainLabel); curtainLabel = null; }
        if (plane) {
          const [ae, an] = plane.from, [be, bn] = plane.to;
          const corners = [at(ae, an, d0), at(be, bn, d0), at(be, bn, plane.baseM), at(ae, an, plane.baseM)];
          const geometry = new THREE.BufferGeometry().setFromPoints(corners);
          geometry.setIndex([0, 1, 2, 0, 2, 3]);
          const colour = token("--sw-select", "#f59e0b");
          const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
          const edge = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(corners.flatMap((p, i) => [p, corners[(i + 1) % 4]!])), new THREE.LineBasicMaterial({ color: colour }));
          fill.renderOrder = 8;
          curtainGroup = new THREE.Group();
          curtainGroup.add(fill, edge);
          scene.add(curtainGroup);
          curtainLabel = label(plane.label, corners[1]!.clone(), "name", 3, { className: "is-seismic" });
        }
        invalidate();
      },
      ribbon(band) { ribbonBand = band; drawRibbon(); },
      fence(wall) { drawFence(wall); },
      points(clouds) { drawPoints(clouds); },
      focusSurface(id) {
        const known = id !== null && surfaceParts.has(id);
        for (const [key, part] of surfaceParts) {
          const on = key === id;
          part.material.opacity = on ? Math.max(part.quiet ? 0.55 : 0.72, part.opacity) : known && !part.quiet && part.opacity > 0.2 ? 0.12 : part.opacity;
          if (part.quiet) part.material.depthWrite = on;
          if (part.quiet) { part.text.visible = on; for (const item of part.extras) item.visible = on; }
        }
        invalidate();
      },
      highlight(band) {
        if (highlightMesh) { scene.remove(highlightMesh); highlightMesh.geometry.dispose(); (highlightMesh.material as THREE.Material).dispose(); highlightMesh = null; }
        const well = band ? wells.find((entry) => entry.id === band.wellId) : undefined;
        if (band && well) {
          const points: THREE.Vector3[] = [];
          const step = Math.max(1, (band.baseMdM - band.topMdM) / 80);
          for (let md = band.topMdM; md <= band.baseMdM + 1e-6; md += step) { const p = pointAtMd(well, Math.min(md, band.baseMdM)); if (p) points.push(at(...p)); }
          if (points.length >= 2) {
            highlightMesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, "centripetal"), points.length * 2, radius * 2.6, 14, false), new THREE.MeshBasicMaterial({ color: band.color ?? cursorColour, transparent: true, opacity: 0.55, depthWrite: false }));
            highlightMesh.renderOrder = 9;
            scene.add(highlightMesh);
          }
        }
        invalidate();
      },
      cursor(target) {
        const well = target ? wells.find((entry) => entry.id === target.wellId) : undefined;
        const p = well && target ? pointAtMd(well, target.mdM) : null;
        cursorRing.visible = cursorDot.visible = cursorLabel.visible = p !== null;
        if (p && well && target) {
          const position = at(...p);
          // The ring lies across the well: its axis along the path at that depth.
          const ahead = pointAtMd(well, target.mdM + 5) ?? pointAtMd(well, target.mdM - 5) ?? p;
          const along = at(...ahead).sub(position);
          if (along.lengthSq() > 0) cursorRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), along.normalize());
          cursorRing.position.copy(position); cursorDot.position.copy(position);
          cursorLabel.position.copy(position.clone().add(new THREE.Vector3(radius * 6, radius * 3, 0)));
          cursorLabel.element.textContent = `${fmt(target.mdM)} m MD · depth ${fmt(p[2])} m`;
        }
        invalidate();
      },
    };
    // A scene closed before its renderer started (a rebuild, a closed tile) says nothing: its successor speaks.
    let dead = false;
    started.ready.then((backend) => { if (dead) return; element.dataset.backend = backend; setReady(true); invalidate(); }, (cause) => { if (!dead) setError(`The site scene could not start: ${cause instanceof Error ? cause.message : String(cause)}`); });
    return () => {
      dead = true;
      cancelAnimationFrame(frame); cancelAnimationFrame(hoverFrame);
      observer.disconnect(); cube.dispose(); controls.dispose();
      renderer.domElement.removeEventListener("pointermove", move);
      renderer.domElement.removeEventListener("pointerleave", leave);
      renderer.domElement.removeEventListener("pointerdown", press, { capture: true });
      renderer.domElement.removeEventListener("pointerup", release);
      if (highlightMesh) { highlightMesh.geometry.dispose(); (highlightMesh.material as THREE.Material).dispose(); }
      clearRibbon();
      clearFence();
      labels.dispose();
      for (const item of disposables) item.dispose();
      started.dispose(); renderer.domElement.remove();
      engine.current = null;
      setReady(false);
    };
  }, [title, depthLabel, wells, surfaces, seismic, seismicClip, exaggeration, terrain]);

  useEffect(() => { if (ready) engine.current?.layers(layers); }, [ready, layers]);
  useEffect(() => { if (ready) engine.current?.slices(slices); }, [ready, slices]);
  useEffect(() => { if (ready) engine.current?.style(colorMap, gain); }, [ready, colorMap, gain]);
  useEffect(() => { if (ready) engine.current?.select(selectedWellId); }, [ready, selectedWellId]);
  useEffect(() => { if (ready) engine.current?.cursor(cursor); }, [ready, cursor?.wellId, cursor?.mdM]);
  useEffect(() => { if (ready) engine.current?.curtain(curtain); }, [ready, curtain?.from[0], curtain?.from[1], curtain?.to[0], curtain?.to[1], curtain?.baseM, curtain?.label]);
  useEffect(() => { if (ready) engine.current?.highlight(highlight); }, [ready, highlight?.wellId, highlight?.topMdM, highlight?.baseMdM, highlight?.color]);
  useEffect(() => { if (ready) engine.current?.ribbon(ribbon); }, [ready, ribbon]);
  useEffect(() => { if (ready) engine.current?.fence(fence); }, [ready, fence]);
  useEffect(() => { if (ready) engine.current?.points(points); }, [ready, points]);
  useEffect(() => { if (ready) engine.current?.focusSurface(focusSurfaceId); }, [ready, focusSurfaceId]);
  const reachKey = `${reach ? Object.entries(reach).map(([id, md]) => `${id}:${md}`).join("|") : ""}/${hiddenMarkers ? Object.entries(hiddenMarkers).map(([id, labels]) => `${id}:${labels.join(",")}`).join("|") : ""}`;
  useEffect(() => { if (ready) engine.current?.reach(reachRef.current.reach, reachRef.current.hiddenMarkers); }, [ready, reachKey]);

  const toggle = (key: keyof Layers) => setLayers((current) => ({ ...current, [key]: !current[key] }));
  const horizons = surfaces.filter((surface) => surface.role === "horizon");
  const references = surfaces.filter((surface) => surface.role === "reference");
  const stop = { onPointerDown: (event: { stopPropagation(): void }) => event.stopPropagation(), onPointerUp: (event: { stopPropagation(): void }) => event.stopPropagation() };
  const sliceRange = (key: SliceKey): readonly [number, number] | null => !volumeFrame ? null : key === "inline" ? volumeFrame.offset : key === "crossline" ? volumeFrame.along : volumeFrame.depth;
  const sliceNames: Readonly<Record<SliceKey, string>> = { inline: "Inline", crossline: "Crossline", depth: "Depth" };

  return <section className="sw-site" aria-label={title} data-testid="site-scene" data-ready={ready} data-selected-well={selectedWellId ?? ""} data-exaggeration={exaggeration}>
    <div ref={host} className="sw-site-canvas">
      <div className="sw-scene-hud sw-site-hud" role="toolbar" aria-label="Site view" {...stop}>
        <CommandButton icon="fit" onClick={() => engine.current?.fit()}>Fit</CommandButton>
        <span className="sw-scene-hud-segment" role="group" aria-label="Show">
          <CommandButton kind="selection" aria-pressed={layers.wells} onClick={() => toggle("wells")}>Wells</CommandButton>
          {seismic && <CommandButton kind="selection" aria-pressed={layers.seismic} onClick={() => toggle("seismic")}>Seismic</CommandButton>}
          {horizons.length > 0 && <CommandButton kind="selection" aria-pressed={layers.horizons} onClick={() => toggle("horizons")}>Horizons</CommandButton>}
          {references.length > 0 && <CommandButton kind="selection" aria-pressed={layers.reference} onClick={() => toggle("reference")}>Datum levels</CommandButton>}
          <CommandButton kind="selection" aria-pressed={layers.labels} onClick={() => toggle("labels")}>Labels</CommandButton>
        </span>
        {tools}
        <label className="sw-site-select">Vertical ×<select value={exaggeration} onChange={(event) => setExaggeration(Number(event.target.value))}>{[...new Set([1, 2, 3, 5, 10, initialExaggeration])].sort((a, b) => a - b).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      </div>
      <SceneViewKeys labels={COMPASS_FACES} onView={(named) => engine.current?.look(named)} />
      {error && <p role="alert" className="sw-site-error">{error}</p>}
      {!ready && !error && <p role="status" className="sw-site-status">Starting the 3D site…</p>}
      <output className="sw-site-readout" aria-live="off">{readout ?? `Origin: ${originLabel} · depth ${depthLabel}${exaggeration > 1 ? ` · vertical exaggeration ${exaggeration}×` : ""}`}</output>
    </div>
    <div className="sw-site-foot">
      {seismic && <div className="sw-site-seismic" role="group" aria-label="Seismic slices" data-hidden={layers.seismic ? undefined : "true"}>
        {(["inline", "crossline", "depth"] as const).map((key) => {
          const range = sliceRange(key)!, value = slices[key];
          return <div key={key} className="sw-site-slice">
            <CommandButton kind="selection" aria-pressed={value !== null} onClick={() => moveSlice(key, value === null ? (range[0] + range[1]) / 2 : null)}>{sliceNames[key]}</CommandButton>
            <input id={`${ids}-${key}`} type="range" aria-label={`${sliceNames[key]} position`} min={Math.min(...range)} max={Math.max(...range)} step="any" value={value ?? (range[0] + range[1]) / 2} disabled={value === null} onChange={(event) => moveSlice(key, Number(event.target.value))} />
            <output htmlFor={`${ids}-${key}`}>{value === null ? "off" : key === "depth" ? `${fmt(value)} m` : `${value >= 0 ? "+" : ""}${fmt(value)} m`}</output>
          </div>;
        })}
        <div className="sw-site-slice">
          <label className="sw-site-select">Colour<select value={colorMap} onChange={(event) => setColorMap(event.target.value as SeismicColorMap)}><option value="grey">Grey (peak black)</option><option value="red-blue">Red–white–blue</option></select></label>
          <label className="sw-site-select">Gain {gain.toFixed(1)}×<input type="range" min={0.5} max={6} step={0.25} value={gain} onChange={(event) => setGain(Number(event.target.value))} /></label>
        </div>
      </div>}
      {legend && <div className="sw-site-legend" aria-label="Legend">
        <ul>
          {wells.map((well, index) => <li key={well.id}>
            <CommandButton kind="selection" className="sw-site-swatch-button" aria-pressed={selectedWellId === well.id} onClick={() => onSelectWell?.(well.id)}>
              <i className="sw-site-swatch is-line" style={{ background: WELL_COLOURS[index % WELL_COLOURS.length] }} aria-hidden="true" />{well.label}
            </CommandButton>
            <span className={`sw-site-provenance is-${well.provenance}`}>{well.provenance}</span>
          </li>)}
          {[...horizons, ...references].map((surface) => <li key={surface.id} title={surface.note}>
            <span><i className={`sw-site-swatch${surface.role === "reference" ? " is-reference" : ""}`} style={{ background: surface.color }} aria-hidden="true" />{surface.label}</span>
            <span className={`sw-site-provenance is-${surface.provenance}`}>{surface.provenance}</span>
            <small>{surface.note}</small>
          </li>)}
          {seismic ? <li><span><i className={`sw-site-swatch is-ramp is-${colorMap}`} aria-hidden="true" />{seismic.label ?? "Seismic volume"}</span><small>Colour saturates at ±{((seismicClip ?? 127 * seismic.amplitudePerCount) / gain).toFixed(3)}, the 2D section's clip ÷ gain</small></li>
            : seismicNote ? <li><span><i className="sw-site-swatch is-none" aria-hidden="true" />Seismic</span><small>{seismicNote}</small></li> : null}
        </ul>
      </div>}
    </div>
  </section>;
}
