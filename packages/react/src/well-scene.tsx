"use client";

import { InfoTip } from "./info-tip.js";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { computeMinimumCurvature, getWellComponents, positionAtMeasuredDepth, seismicColour } from "@ikhmalputra/subsurface-core";
import type { BuildHoldTarget, SeismicImage, WellComponent, WellDesign } from "@ikhmalputra/subsurface-core";
import type { SlicePlane, SpatialXYZ, SubsurfaceState, WellLogStyle } from "@ikhmalputra/subsurface-core/state";
import type { SubsurfaceWellLogCurve } from "@ikhmalputra/subsurface-core/contracts";
import { GpuFramebufferPicker } from "./gpu-picker.js";
import type { GpuPickTarget } from "./gpu-picker.js";
import { SeismicSlice } from "./seismic-slice.js";
import { LogCylinder } from "./log-cylinder.js";
import { dlsColor } from "./trajectory-colour.js";
import { cutawayTube } from "./cutaway-tube.js";
import { Crosshair, Maximize, ChevronDown } from "lucide-react";
import { CommandButton } from "./ui.js";

function CasingDiameterInset({ components, selectedId, onSelect }: { components: readonly WellComponent[]; selectedId: string; onSelect: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const strings = components.filter((component) => component.kind === "Casing" && component.outerDiameterMm !== null);
  const maximum = Math.max(1, ...strings.map((component) => component.outerDiameterMm!));
  const color = (component: WellComponent) => component.id === "surface-casing" ? "#197c6e" : component.id === "intermediate-casing" ? "#4768a5" : component.id === "production-casing" ? "#c46143" : "#147e68";
  function depthText(component: WellComponent) {
    if (component.kind === "Wellhead" || component.kind === "Valve") return "Surface location / depth not reported";
    const top = component.topDepthReported ? `${component.topDepthM.toFixed(0)} m` : "Top not reported (plotted at 0)";
    const bottom = component.rawBottomDepthFt != null ? `${component.rawBottomDepthFt.toLocaleString("en-US")} ft MD` : `${component.bottomDepthM.toFixed(0)} m MD`;
    return `${top} to ${bottom}`;
  }
  return <section className="sw-scene-record-panel" aria-label="3D source record selector" data-testid="casing-scale-inset" data-expanded={expanded}>
    <header className="sw-scene-record-heading"><CommandButton kind="selection" className="sw-scene-record-toggle" aria-label="Toggle 3D source records" aria-expanded={expanded} aria-controls="sw-3d-source-records" onClick={() => setExpanded((value) => !value)}><span>3D INSPECTION</span><strong>{components.find((component) => component.id === selectedId)?.name ?? "Well records"}</strong><small>{components.length} source intervals</small><ChevronDown size={15} /></CommandButton></header>
    <div className="sw-scene-record-layout" id="sw-3d-source-records">
      <div className="sw-scene-ring-column"><svg viewBox="0 0 120 120" role="img" aria-label="Casing outside diameters at relative scale; IDs and wall thicknesses are not reported"><circle cx="60" cy="60" r="45" fill="none" stroke="#d9e2dc" strokeWidth="1" />{strings.map((component) => <circle key={component.id} cx="60" cy="60" r={42 * component.outerDiameterMm! / maximum} fill="none" stroke={selectedId === component.id ? "#235faa" : color(component)} strokeWidth={selectedId === component.id ? 4 : 2.5} />)}</svg><p>OD / relative<br />ID not reported <InfoTip label="About the diameter inset">Selection updates the inspector. Geometry is display-only; casing IDs and wall thickness are not source data.</InfoTip></p></div>
      <div className="sw-scene-record-list">{components.map((component) => <CommandButton kind="selection" key={component.id} aria-pressed={selectedId === component.id} aria-label={`Select ${component.name}`} onClick={() => { onSelect(component.id); setExpanded(false); }}><i style={{ backgroundColor: color(component) }} /><span><strong>{component.name}</strong><small>{component.kind} / {depthText(component)}</small><small>{component.material}{component.sourcePage ? ` / report p.${component.sourcePage}` : ""}</small></span></CommandButton>)}</div>
    </div>
  </section>;
}

const STRING_COLORS = ["#2f8f7a", "#4a6fb0", "#c8643f", "#8a6bb5"];
const KIND_COLORS: Readonly<Record<string, string>> = { Tubular: "#b8734a", Packer: "#36423c", "Safety valve": "#d2a23a", "Gas lift mandrel": "#5f86ad", Gauge: "#2f8f7a", "Landing nipple": "#8c939a", Centralizer: "#7b8a84", Connection: "#9aa3a8", Coupling: "#9aa3a8" };
const TOOL_KINDS = new Set(["Packer", "Safety valve", "Gas lift mandrel", "Gauge", "Landing nipple", "Centralizer"]);
const SELECT_COLOR = "#ff6a00";
const PROBE_COLOR = "#2f6fd6";
const CURSOR_COLOR = "#1d4ed8";
type StandardMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
interface DepthReadout { readonly mdM: number; readonly tvdM: number; readonly inclinationDeg: number; readonly azimuthDeg: number; readonly name: string | null }
interface SectionReadout { readonly label: string; readonly alongM: number; readonly offsetM: number | null; readonly tvdM: number; readonly mdM: number | null; readonly amplitude?: number }

/**
 * A vertical seismic section hung in the scene as a textured curtain. Coordinates are well-local, like the survey:
 * metres east/north of the wellhead and TVD below the well reference. Build `image` with `seismicImage(file)` and convert
 * datum depths with `seismicDepthToTvd` from `@ikhmalputra/subsurface-core`.
 */
export interface SceneSeismicSection {
  readonly image: SeismicImage;
  /** Grid azimuth of the section line, degrees clockwise from north. */
  readonly azimuthDeg: number;
  /** Distance along the line of the first and last trace edges. */
  readonly alongStartM: number;
  readonly alongEndM: number;
  /** TVD of the first and last sample edges. */
  readonly topTvdM: number;
  readonly baseTvdM: number;
  /** Where along = 0 sits, east/north of the wellhead. Default 0, 0. */
  readonly originEastingM?: number;
  readonly originNorthingM?: number;
  /** TVD range to show; defaults to ground level down to the base, so data above the ground is not drawn. */
  readonly visibleTvdM?: readonly [number, number];
  /** Default 1. Panels are drawn depth-sorted against each other; the well is always drawn over them. */
  readonly opacity?: number;
  /** Short name drawn on the panel and listed in the legend, e.g. "Inline along well". */
  readonly label?: string;
}

/**
 * A regular seismic volume (e.g. a well-centred cut of a 3D survey) on a grid aligned with `azimuthDeg`. Amplitudes are
 * int8 counts, uploaded once as a 3D texture: `counts[(sample * offsetCount + offset) * alongCount + along]`, offset to
 * the right of the azimuth, sample 0 shallowest. Extents are cell edges in well-local metres; TVD below the well reference.
 */
export interface SceneSeismicVolume {
  readonly counts: Int8Array;
  readonly alongCount: number;
  readonly offsetCount: number;
  readonly sampleCount: number;
  /** Amplitude of one count; the hover readout reports count × amplitudePerCount. */
  readonly amplitudePerCount: number;
  readonly azimuthDeg: number;
  readonly alongStartM: number;
  readonly alongEndM: number;
  readonly offsetStartM: number;
  readonly offsetEndM: number;
  readonly topTvdM: number;
  readonly baseTvdM: number;
  readonly originEastingM?: number;
  readonly originNorthingM?: number;
  /** Colour saturates at ±127 / gain counts. Default 1. */
  readonly gain?: number;
  readonly label?: string;
}

/** How the volume is shown; changing it does not rebuild the scene. Ranges are clamped to the volume. */
export interface SceneVolumeView {
  /**
   * "solid": an opaque block whose faces show the data, so cropping exposes inline, crossline and depth-slice cuts.
   * "render": a see-through volume render in which weak amplitudes are transparent and strong reflectors stay opaque.
   */
  readonly mode?: "solid" | "render";
  readonly alongM?: readonly [number, number];
  readonly offsetM?: readonly [number, number];
  /** Defaults to ground level down to the base of the volume. */
  readonly tvdM?: readonly [number, number];
  /** Render mode: fraction of full colour below which samples are transparent. Default 0.5. */
  readonly threshold?: number;
}

export interface WellSceneProps {
  readonly design: WellDesign;
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
  readonly layersVisible?: boolean;
  /** "dls" colours the path from green through amber (at the limit) to red above it. */
  readonly colorBy?: "solid" | "dls";
  readonly dlsLimitDegPer30m?: number;
  /** Drill target drawn as a marker; coordinates relative to the wellhead, metres. */
  readonly target?: BuildHoldTarget | null;
  /** Controlled probe depth; the marker and readout follow it. */
  readonly probeMdM?: number | null;
  /** Called with the MD picked on the path or on a component. */
  readonly onProbe?: (mdM: number) => void;
  /**
   * Vertical seismic panels (e.g. an inline along the well and a crossline). With any seismic the formation block grows
   * to enclose it, like an interpretation window. Memoise the array: the scene rebuilds when its identity changes.
   */
  readonly sections?: readonly SceneSeismicSection[];
  /** Seismic volume shown as a croppable block or a volume render; memoise it. */
  readonly volume?: SceneSeismicVolume | null;
  readonly volumeView?: SceneVolumeView;
  /** Linked depth cursor (e.g. from `useDepthLink`): a ring on the well and a line across each panel or around the volume. */
  readonly cursorMdM?: number | null;
  /** Emits the MD under the pointer: on the well directly, or on a panel where the well reaches that TVD. */
  readonly onCursorMdChange?: (mdM: number | null) => void;
  /** Linked MD window: highlighted on the well and as a band on each vertical panel. */
  readonly mdWindow?: readonly [number, number] | null;
  /** Camera and target in well-local [east, north, TVD] metres, not Three.js display units. Null keeps automatic framing. */
  readonly cameraView?: SubsurfaceState["viewState"] | null;
  /** Emitted after a user camera interaction or fit/focus action, never when applying controlled cameraView. */
  readonly onCameraViewChange?: (view: SubsurfaceState["viewState"]) => void;
  /** Picked surface intersection in well-local [east, north, TVD] metres. */
  readonly onSpatialPick?: (xyz: SpatialXYZ) => void;
  readonly slicePlane?: SlicePlane | null;
  /** Translation gizmo emits changes along the plane normal; the host owns orientation controls. */
  readonly onSlicePlaneChange?: (plane: SlicePlane) => void;
  /** CPU remains the compatible default. GPU reads float position/ID and volume amplitude FBOs asynchronously. */
  readonly picking?: "cpu" | "gpu";
  readonly onGpuPick?: (pick: { readonly xyz: SpatialXYZ; readonly amplitude: number | null; readonly componentId: string | null }) => void;
  readonly logCurve?: SubsurfaceWellLogCurve | null;
  readonly logStyle?: WellLogStyle | null;
}

const NO_SECTIONS: readonly SceneSeismicSection[] = [];
const DEFAULT_VIEW: SceneVolumeView = {};

const VOLUME_VERTEX = `
uniform vec3 uCropMin;
uniform vec3 uCropSize;
varying vec3 vUvw;
void main() {
  vUvw = uCropMin + position * uCropSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const VOLUME_COMMON = `
uniform highp sampler3D uVolume;
uniform sampler2D uLut;
uniform float uGain;
varying vec3 vUvw;
vec3 lut(float a) { return texture(uLut, vec2(clamp(a, -1.0, 1.0) * 0.5 + 0.5, 0.5)).rgb; }`;
const SOLID_FRAGMENT = `${VOLUME_COMMON}
void main() { gl_FragColor = vec4(lut(texture(uVolume, vUvw).r * uGain), 1.0); }`;
// Front-to-back compositing from where the eye ray enters the crop box to this back face; one step per voxel crossed.
const RENDER_FRAGMENT = `${VOLUME_COMMON}
uniform vec3 uEye;
uniform vec3 uCropMin;
uniform vec3 uCropMax;
uniform vec3 uDims;
uniform float uThreshold;
void main() {
  vec3 dir = vUvw - uEye;
  vec3 inv = 1.0 / dir;
  vec3 near = min((uCropMin - uEye) * inv, (uCropMax - uEye) * inv);
  float entry = clamp(max(max(near.x, near.y), near.z), 0.0, 1.0);
  vec3 start = uEye + dir * entry;
  vec3 span = vUvw - start;
  int steps = int(clamp(length(span * uDims), 1.0, 720.0));
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 720; i++) {
    if (i >= steps || sum.a > 0.97) break;
    float a = texture(uVolume, start + span * ((float(i) + 0.5) / float(steps))).r * uGain;
    float alpha = smoothstep(uThreshold, 1.0, abs(a)) * 0.35;
    sum.rgb += (1.0 - sum.a) * alpha * lut(a);
    sum.a += (1.0 - sum.a) * alpha;
  }
  gl_FragColor = sum;
}`;
const savedViews = new Map<string, { position: THREE.Vector3; target: THREE.Vector3 }>();

function niceStep(total: number) {
  const raw = total / 6;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2.5 : unit < 7.5 ? 5 : 10) * power;
}

function textSprite(text: string, screenHeight: number, color = "#33423b", weight = 500) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  const font = `${weight} 40px 'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif`;
  context.font = font;
  canvas.width = Math.ceil(context.measureText(text).width) + 28;
  canvas.height = 64;
  context.font = font;
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.lineWidth = 9;
  context.strokeStyle = "rgba(246, 248, 246, 0.92)";
  context.strokeText(text, 14, 33);
  context.fillStyle = color;
  context.fillText(text, 14, 33);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, sizeAttenuation: false }));
  sprite.center.set(0, 0.5);
  sprite.scale.set(screenHeight * canvas.width / canvas.height, screenHeight, 1);
  sprite.renderOrder = 20;
  return sprite;
}

function formatMetres(value: number) {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 0 })} m`;
}

export default function WellScene({ design, selectedId, onSelect, layersVisible = true, colorBy = "solid", dlsLimitDegPer30m = 3, target = null, probeMdM, onProbe, sections = NO_SECTIONS, volume = null, volumeView = DEFAULT_VIEW, cursorMdM = null, onCursorMdChange, mdWindow = null, cameraView = null, onCameraViewChange, onSpatialPick, slicePlane = null, onSlicePlaneChange, picking = "cpu", onGpuPick, logCurve = null, logStyle = null }: WellSceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const redraw = useRef<() => void>(() => undefined);
  const reset = useRef<() => void>(() => undefined);
  const focus = useRef<(id: string) => void>(() => undefined);
  const highlight = useRef<(id: string) => void>(() => undefined);
  const probeAt = useRef<(mdM: number | null) => void>(() => undefined);
  const cursorAt = useRef<(mdM: number | null) => void>(() => undefined);
  const windowAt = useRef<(window: readonly [number, number] | null) => void>(() => undefined);
  const viewAt = useRef<(view: SceneVolumeView) => void>(() => undefined);
  const cameraAt = useRef<(view: SubsurfaceState["viewState"]) => void>(() => undefined);
  const sliceAt = useRef<(plane: SlicePlane | null) => void>(() => undefined);
  const logAt = useRef<(curve: SubsurfaceWellLogCurve | null, style: WellLogStyle | null) => void>(() => undefined);
  const [sliceVertices, setSliceVertices] = useState(0);
  const [logTriangles, setLogTriangles] = useState(0);
  const [gpuReadout, setGpuReadout] = useState<{ xyz: SpatialXYZ; amplitude: number | null } | null>(null);
  const [sectionHover, setSectionHover] = useState<SectionReadout | null>(null);
  const compass = useRef<SVGSVGElement>(null);
  const [cameraState, setCameraState] = useState("");
  const [targetState, setTargetState] = useState("");
  const [accessibleCamera, setAccessibleCamera] = useState<SubsurfaceState["viewState"] | null>(cameraView);
  const canvasDescriptionId = useId();
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState("");
  const [componentCount, setComponentCount] = useState(0);
  const [layerCount, setLayerCount] = useState(0);
  const [hover, setHover] = useState<DepthReadout | null>(null);
  const [probe, setProbe] = useState<DepthReadout | null>(null);
  const emitSelection = useEffectEvent((id: string) => onSelect(id));
  const commitProbe = useEffectEvent((mdM: number) => {
    probeAt.current(probeMdM === undefined ? mdM : probeMdM);
    onProbe?.(mdM);
  });
  const emitCursor = useEffectEvent((mdM: number | null) => onCursorMdChange?.(mdM));
  const emitCamera = useEffectEvent((view: SubsurfaceState["viewState"]) => onCameraViewChange?.(view));
  const applyControlledCamera = useEffectEvent(() => {
    if (cameraView) cameraAt.current(cameraView);
  });
  const emitSpatialPick = useEffectEvent((xyz: SpatialXYZ) => onSpatialPick?.(xyz));
  const emitGpuPick = useEffectEvent((pick: { xyz: SpatialXYZ; amplitude: number | null; componentId: string | null }) => onGpuPick?.(pick));
  const emitSlice = useEffectEvent((plane: SlicePlane) => onSlicePlaneChange?.(plane));
  const isGpuPicking = useEffectEvent(() => picking === "gpu");
  const initialSlice = useEffectEvent(() => slicePlane);
  const targetKey = target ? `${target.tvdM},${target.northingM},${target.eastingM}` : "";

  useEffect(() => {
    const container = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); }
    catch { setFailure("WebGL is unavailable. The 2D schematic and inventory remain available."); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const environment = new THREE.PMREMGenerator(renderer);
    const environmentMap = environment.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environmentMap;
    scene.add(new THREE.HemisphereLight(0xf4f1e8, 0x56605a, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.position.set(14, 30, 22);
    scene.add(sun);
    // Earth pass: formation block, ground and seismic panels, depth-sorted together. The well pass is drawn after a depth
    // clear so casing, DLS colour and labels stay readable through the seismic.
    const earth = new THREE.Scene();
    earth.environment = environmentMap;
    earth.add(new THREE.HemisphereLight(0xf4f1e8, 0x56605a, 1.1));
    const earthSun = sun.clone();
    earth.add(earthSun);
    renderer.autoClear = false;
    const hasSeismic = sections.length > 0 || !!volume;
    const ground = hasSeismic ? earth : scene;
    const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.zoomToCursor = true;

    const totalDepth = design.totalDepthM;
    const vector = (mdM: number) => {
      const point = positionAtMeasuredDepth(design, mdM);
      return new THREE.Vector3(point.eastingM / 100, -point.tvdM / 100, -point.northingM / 100); // three.js is right-handed: x = east, y = up, z = south
    };
    const stations = design.survey ?? [positionAtMeasuredDepth(design, 0), positionAtMeasuredDepth(design, totalDepth)];
    const bounds = new THREE.Box3().setFromPoints(stations.map((station) => vector(station.mdM)));
    const extent = bounds.getSize(new THREE.Vector3());
    const size = Math.max(4, extent.x, extent.y, extent.z);
    const records = getWellComponents(design);
    const top = records.filter((component) => !component.parentId);
    const surfaceKinds = new Set(["Wellhead", "Valve"]);
    const maxOd = Math.max(1, ...top.filter((component) => !surfaceKinds.has(component.kind)).map((component) => component.outerDiameterMm ?? 0));
    const unit = THREE.MathUtils.clamp(size * 0.032, 0.16, 2);
    const radiusFor = (od: number | null, fallback: number) => od == null ? fallback : unit * od / maxOd;
    const radiusById = new Map<string, number>();
    const created: StandardMesh[] = [];
    const disposables: { dispose: () => void }[] = [environment, environmentMap];

    function curveBetween(start: number, end: number) {
      const points = [vector(start), ...stations.filter((station) => station.mdM > start && station.mdM < end).map((station) => vector(station.mdM)), vector(end)];
      if (points[0]!.distanceTo(points[points.length - 1]!) < 1e-6) points[points.length - 1] = points[0]!.clone().add(new THREE.Vector3(0, -0.05, 0));
      const curve = new THREE.CurvePath<THREE.Vector3>();
      for (let index = 1; index < points.length; index++) curve.add(new THREE.LineCurve3(points[index - 1]!, points[index]!));
      return { curve, count: points.length };
    }
    function tube(start: number, end: number, radius: number, radial = 32, cutaway = false) {
      const { curve, count } = curveBetween(start, end);
      const segments = THREE.MathUtils.clamp(count * 2, 2, 420);
      const geometry = cutaway ? cutawayTube(curve, segments, radius, radial) : new THREE.TubeGeometry(curve, segments, radius, radial, false);
      return { geometry, curve };
    }
    const metal = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, metalness: 0.62, roughness: 0.34, side: THREE.DoubleSide, ...extra });
    function add(mesh: StandardMesh, id: string) {
      mesh.userData.componentId = id;
      scene.add(mesh);
      created.push(mesh);
      return mesh;
    }
    function orient(mesh: THREE.Object3D, direction: THREE.Vector3) {
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    }

    const casings = top.filter((component) => component.kind === "Casing").sort((a, b) => (b.outerDiameterMm ?? 0) - (a.outerDiameterMm ?? 0));
    casings.forEach((component, index) => radiusById.set(component.id, radiusFor(component.outerDiameterMm, unit * 0.6 * (1 - index * 0.15))));
    const casingColor = new Map(casings.map((component, index) => [component.id, STRING_COLORS[index % STRING_COLORS.length]!]));
    for (const component of top) {
      if (surfaceKinds.has(component.kind)) continue;
      const end = Math.min(totalDepth, component.bottomDepthM);
      const start = Math.min(component.topDepthM, end);
      if (end - start < 0.5) {
        const radius = radiusFor(component.outerDiameterMm, unit * 0.5);
        const disc = add(new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.15, radius * 1.15, unit * 0.16, 32), metal(KIND_COLORS[component.kind] ?? "#9aa3a8")), component.id);
        disc.position.copy(vector(start));
        continue;
      }
      if (component.kind === "Hole") {
        const radius = radiusFor(component.outerDiameterMm, unit);
        radiusById.set(component.id, radius);
        add(new THREE.Mesh(tube(start, end, radius, 28).geometry, new THREE.MeshStandardMaterial({ color: "#8b7d64", roughness: 1, transparent: true, opacity: hasSeismic ? 0.07 : 0.16, depthWrite: false, side: THREE.DoubleSide })), component.id);
      } else if (component.kind === "Cement") {
        const host = casings.find((casing) => casing.id === component.parentId) ?? [...casings].sort((a, b) => Math.abs(a.bottomDepthM - end) - Math.abs(b.bottomDepthM - end))[0];
        const radius = component.outerDiameterMm != null ? radiusFor(component.outerDiameterMm, unit) : (radiusById.get(host?.id ?? "") ?? unit * 0.6) * 1.24;
        radiusById.set(component.id, radius);
        add(new THREE.Mesh(tube(start, end, radius, 32, true).geometry, new THREE.MeshStandardMaterial({ color: "#cfc6ad", roughness: 0.95, metalness: 0, transparent: true, opacity: hasSeismic ? 0.18 : 0.5, depthWrite: false, side: THREE.DoubleSide })), component.id);
      } else if (component.kind === "Casing") {
        const radius = radiusById.get(component.id)!;
        const color = casingColor.get(component.id)!;
        const { geometry, curve } = tube(start, end, radius, 32, true);
        add(new THREE.Mesh(geometry, metal(color)), component.id);
        const shoe = add(new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.16, radius * 1.4, unit * 0.55, 32), metal(color, { roughness: 0.5 })), component.id);
        const tangent = curve.getTangentAt(1);
        orient(shoe, tangent.clone().negate());
        shoe.position.copy(vector(end)).addScaledVector(tangent, -unit * 0.2);
      } else {
        const radius = component.kind === "Tubular" ? radiusFor(component.outerDiameterMm, unit * 0.3) : radiusFor(component.outerDiameterMm, unit * 0.5) * 1.05;
        radiusById.set(component.id, radius);
        add(new THREE.Mesh(tube(start, end, radius, 20).geometry, metal(KIND_COLORS[component.kind] ?? "#167e68")), component.id);
      }
    }
    for (const component of records) {
      if (!component.parentId || !TOOL_KINDS.has(component.kind)) continue;
      const hostRadius = radiusById.get(component.parentId) ?? unit * 0.3;
      const radius = component.kind === "Centralizer" ? hostRadius * 1.14 : hostRadius * 1.75;
      const middle = (component.topDepthM + component.bottomDepthM) / 2;
      const half = Math.max((component.bottomDepthM - component.topDepthM) / 2, unit * 22);
      add(new THREE.Mesh(tube(Math.max(0, middle - half), Math.min(totalDepth, middle + half), radius, 24).geometry, metal(KIND_COLORS[component.kind] ?? "#7b8a84")), component.id);
    }

    const wellhead = vector(0);
    const surfaceRadius = (casings.length ? radiusById.get(casings[0]!.id)! : unit * 0.6) * 1.25;
    let stackY = wellhead.y;
    for (const component of top.filter((value) => surfaceKinds.has(value.kind))) {
      const isValve = component.kind === "Valve";
      const bodyRadius = isValve ? surfaceRadius * 0.62 : surfaceRadius;
      const bodyHeight = unit * (isValve ? 1.3 : 0.95);
      const color = isValve ? "#b8452f" : "#5f6a72";
      const flange = unit * 0.16;
      const parts: [THREE.BufferGeometry, number, string][] = [
        [new THREE.CylinderGeometry(bodyRadius * 1.38, bodyRadius * 1.38, flange, 40), flange / 2, "#4b545b"],
        [new THREE.CylinderGeometry(bodyRadius, bodyRadius, bodyHeight, 40), flange + bodyHeight / 2, color],
        [new THREE.CylinderGeometry(bodyRadius * 1.38, bodyRadius * 1.38, flange, 40), flange * 1.5 + bodyHeight, "#4b545b"],
      ];
      for (const [geometry, offset, partColor] of parts) add(new THREE.Mesh(geometry, metal(partColor)), component.id).position.set(wellhead.x, stackY + offset, wellhead.z);
      if (isValve) {
        const wheel = add(new THREE.Mesh(new THREE.TorusGeometry(bodyRadius * 0.9, unit * 0.06, 10, 36), metal("#2d3438")), component.id);
        wheel.position.set(wellhead.x + bodyRadius * 2, stackY + flange + bodyHeight / 2, wellhead.z);
        wheel.rotation.y = Math.PI / 2;
        const stem = add(new THREE.Mesh(new THREE.CylinderGeometry(unit * 0.05, unit * 0.05, bodyRadius * 2, 12), metal("#2d3438")), component.id);
        stem.rotation.z = Math.PI / 2;
        stem.position.set(wellhead.x + bodyRadius, stackY + flange + bodyHeight / 2, wellhead.z);
      } else {
        for (const side of [-1, 1]) {
          const outlet = add(new THREE.Mesh(new THREE.CylinderGeometry(bodyRadius * 0.28, bodyRadius * 0.28, bodyRadius * 0.9, 20), metal(color)), component.id);
          outlet.rotation.z = Math.PI / 2;
          outlet.position.set(wellhead.x + side * bodyRadius * 1.3, stackY + flange + bodyHeight / 2, wellhead.z);
        }
      }
      stackY += flange * 2 + bodyHeight;
    }
    setComponentCount(records.length);

    const pathCurve = curveBetween(0, totalDepth);
    const pathSegments = THREE.MathUtils.clamp(pathCurve.count * 2, 8, 600);
    const computed = design.survey && design.survey.length > 1 ? computeMinimumCurvature(design.survey, { tieIn: design.survey[0] }) : [];
    const dlsAt = (mdM: number) => { const index = computed.findIndex((station) => station.mdM >= mdM); return index <= 0 ? 0 : computed[index]!.dlsDegPer30m; };
    const pathGeometry = new THREE.TubeGeometry(pathCurve.curve, pathSegments, unit * (colorBy === "dls" ? 0.16 : 0.075), 8, false);
    let pathMaterial: THREE.MeshBasicMaterial;
    if (colorBy === "dls" && computed.length) {
      const colors: number[] = [];
      for (let ring = 0; ring <= pathSegments; ring++) {
        const color = dlsColor(dlsAt(totalDepth * ring / pathSegments), dlsLimitDegPer30m);
        for (let side = 0; side <= 8; side++) colors.push(color.r, color.g, color.b);
      }
      pathGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      pathMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
    } else pathMaterial = new THREE.MeshBasicMaterial({ color: "#0f9a7c" });
    const pathMesh = new THREE.Mesh(pathGeometry, pathMaterial);
    scene.add(pathMesh);
    const logCylinder = new LogCylinder(vector, totalDepth, unit * 0.35);
    scene.add(logCylinder.mesh);
    logAt.current = (curve, style) => {
      if (curve && curve.wellId !== design.id) throw new TypeError("Log curve wellId must match the scene design.");
      setLogTriangles(logCylinder.update(curve, style));
      pathMesh.visible = !logCylinder.mesh.visible;
      render();
    };
    const hitTarget = new THREE.Mesh(new THREE.TubeGeometry(pathCurve.curve, pathSegments, unit * 1.9, 12, false), new THREE.MeshBasicMaterial({ visible: false }));
    scene.add(hitTarget);
    const samples = Array.from({ length: 601 }, (_, index) => { const mdM = totalDepth * index / 600; return { mdM, point: vector(mdM) }; });
    /** First MD where the well reaches a TVD, or null below TD. */
    const mdAtTvd = (tvdM: number) => {
      for (let index = 1; index < samples.length; index++) {
        const a = samples[index - 1]!, b = samples[index]!;
        const ta = -a.point.y * 100, tb = -b.point.y * 100;
        if (tb >= tvdM && tb > ta) return tvdM <= ta ? a.mdM : a.mdM + (b.mdM - a.mdM) * (tvdM - ta) / (tb - ta);
      }
      return null;
    };
    const nearestDepth = (point: THREE.Vector3) => samples.reduce((best, sample) => sample.point.distanceToSquared(point) < best.point.distanceToSquared(point) ? sample : best).mdM;
    function componentAt(mdM: number) {
      const covering = top.filter((component) => component.topDepthM <= mdM && component.bottomDepthM >= mdM);
      const strings = covering.filter((component) => component.kind === "Casing" || component.kind === "Tubular").sort((a, b) => (a.outerDiameterMm ?? 0) - (b.outerDiameterMm ?? 0));
      return strings[0] ?? covering.find((component) => component.kind === "Hole") ?? covering[0] ?? null;
    }
    const readout = (mdM: number, name: string | null): DepthReadout => { const point = positionAtMeasuredDepth(design, Math.min(totalDepth, Math.max(0, mdM))); return { mdM, tvdM: point.tvdM, inclinationDeg: point.inclinationDeg, azimuthDeg: point.azimuthDeg, name }; };

    const labelHeight = 0.024;
    const step = niceStep(totalDepth);
    const tickMaterial = new THREE.MeshBasicMaterial({ color: "#0f9a7c" });
    for (let mdM = step; mdM < totalDepth - step * 0.25; mdM += step) {
      const point = vector(mdM);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(unit * 0.16, 12, 8), tickMaterial);
      dot.position.copy(point);
      scene.add(dot);
      const text = textSprite(`${formatMetres(mdM)} MD`, labelHeight, "#2f4a40");
      text.position.copy(point).add(new THREE.Vector3(unit * 2.6, 0, 0));
      scene.add(text);
    }
    const bottom = vector(totalDepth);
    const tdLabel = textSprite(`TD ${formatMetres(totalDepth)} MD`, labelHeight, "#20322a", 600);
    tdLabel.position.copy(bottom).add(new THREE.Vector3(unit * 2.6, 0, 0));
    scene.add(tdLabel);
    const bit = new THREE.Mesh(new THREE.ConeGeometry(unit * 0.32, unit * 0.7, 20), metal("#20322a"));
    orient(bit, pathCurve.curve.getTangentAt(1).negate());
    bit.position.copy(bottom);
    scene.add(bit);
    const probeMarker = new THREE.Mesh(new THREE.SphereGeometry(unit * 0.45, 20, 12), new THREE.MeshBasicMaterial({ color: PROBE_COLOR, depthTest: false, transparent: true, opacity: 0.9 }));
    probeMarker.renderOrder = 15;
    probeMarker.visible = false;
    scene.add(probeMarker);
    const cursorMaterial = new THREE.MeshBasicMaterial({ color: CURSOR_COLOR, depthTest: false, transparent: true, opacity: 0.95 });
    const cursorRing = new THREE.Mesh(new THREE.TorusGeometry(unit * 0.8, unit * 0.13, 10, 36), cursorMaterial);
    cursorRing.renderOrder = 16;
    cursorRing.visible = false;
    scene.add(cursorRing);
    const windowMaterial = new THREE.MeshBasicMaterial({ color: CURSOR_COLOR, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
    const bandMaterial = new THREE.MeshBasicMaterial({ color: CURSOR_COLOR, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
    let windowTube: THREE.Mesh | null = null;
    let windowBands: THREE.Mesh[] = [];
    disposables.push(windowMaterial, bandMaterial);

    const margin = Math.max(size * 0.14, unit * 5);
    const box = { minX: bounds.min.x - margin, maxX: bounds.max.x + margin, minZ: bounds.min.z - margin, maxZ: bounds.max.z + margin };
    const planAt = (originE: number, originN: number, azimuthDeg: number) => {
      const azimuth = THREE.MathUtils.degToRad(azimuthDeg), east = Math.sin(azimuth), north = Math.cos(azimuth);
      return (alongM: number, offsetM: number, tvdM: number) => new THREE.Vector3((originE + alongM * east + offsetM * north) / 100, -tvdM / 100, -(originN + alongM * north - offsetM * east) / 100);
    };
    const footprint = [
      ...sections.flatMap((panel) => { const at = planAt(panel.originEastingM ?? 0, panel.originNorthingM ?? 0, panel.azimuthDeg); return [at(panel.alongStartM, 0, 0), at(panel.alongEndM, 0, 0)]; }),
      ...(volume ? (() => { const at = planAt(volume.originEastingM ?? 0, volume.originNorthingM ?? 0, volume.azimuthDeg); return [at(volume.alongStartM, volume.offsetStartM, 0), at(volume.alongEndM, volume.offsetStartM, 0), at(volume.alongEndM, volume.offsetEndM, 0), at(volume.alongStartM, volume.offsetEndM, 0)]; })() : []),
    ];
    for (const point of footprint) { box.minX = Math.min(box.minX, point.x); box.maxX = Math.max(box.maxX, point.x); box.minZ = Math.min(box.minZ, point.z); box.maxZ = Math.max(box.maxZ, point.z); }
    const blockCenter = new THREE.Vector3((box.minX + box.maxX) / 2, 0, (box.minZ + box.maxZ) / 2);
    const blockWidth = box.maxX - box.minX;
    const blockDepth = box.maxZ - box.minZ;
    const groundY = -(design.groundTvdM ?? 0) / 100;
    let visibleLayers = 0;
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    for (const layer of layersVisible ? design.formations ?? [] : []) {
      const layerBottom = Math.min(layer.bottomTvdM, -bounds.min.y * 100);
      const thickness = layerBottom - layer.topTvdM;
      if (thickness <= 0) continue;
      visibleLayers++;
      const geometry = new THREE.BoxGeometry(blockWidth, thickness / 100, blockDepth);
      const wall = new THREE.MeshStandardMaterial({ color: layer.color, roughness: 1, metalness: 0, side: THREE.BackSide, transparent: true, opacity: 0.92, polygonOffset: hasSeismic, polygonOffsetFactor: 2, polygonOffsetUnits: 8 });
      // A volume fills the block, so a layer's floor would veil everything beneath it; the edges still mark the boundary.
      const block = new THREE.Mesh(geometry, [wall, wall, hidden, volume ? hidden : wall, wall, wall]);
      block.position.set(blockCenter.x, -(layer.topTvdM + thickness / 2) / 100, blockCenter.z);
      block.renderOrder = -2;
      ground.add(block);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: "#6f7d76", transparent: true, opacity: 0.45 }));
      edges.position.copy(block.position);
      ground.add(edges);
      const name = textSprite(layer.name.toUpperCase(), labelHeight * 0.85, "#4b5b53", 600);
      name.position.set(box.minX + blockWidth * 0.03, -(layer.topTvdM / 100) - unit * 1.4, box.minZ + 0.01);
      scene.add(name);
    }
    setLayerCount(visibleLayers);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(blockWidth, blockDepth), new THREE.MeshStandardMaterial({ color: "#d8d1c0", roughness: 1, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(blockCenter.x, groundY, blockCenter.z);
    ground.add(pad);
    const grid = new THREE.GridHelper(Math.max(blockWidth, blockDepth), 16, "#9aa79f", "#c9d2cc");
    grid.position.set(blockCenter.x, groundY + 0.002, blockCenter.z);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    ground.add(grid);

    interface Panel { readonly mesh: THREE.Mesh; readonly label: string; readonly local: (point: THREE.Vector3) => { alongM: number; offsetM: number | null; tvdM: number; amplitude?: number }; readonly line?: (tvdM: number) => THREE.Vector3[] }
    const panels: Panel[] = [];
    const panelCorners: THREE.Vector3[] = [];
    function seismicTexture(image: SeismicImage) {
      const texture = new THREE.DataTexture(image.data, image.width, image.height, THREE.RGBAFormat);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      return texture;
    }
    function hangPanel(corners: THREE.Vector3[], uv: number[], image: SeismicImage, opacity: number, label: string, labelAt: THREE.Vector3) {
      const geometry = new THREE.BufferGeometry().setFromPoints(corners);
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: seismicTexture(image), side: THREE.DoubleSide, transparent: opacity < 1, opacity, toneMapped: false }));
      mesh.userData.section = true;
      earth.add(mesh);
      earth.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners), new THREE.LineBasicMaterial({ color: "#20322a" })));
      panelCorners.push(...corners);
      if (label) {
        const tag = textSprite(label.toUpperCase(), labelHeight * 0.8, "#20322a", 700);
        tag.position.copy(labelAt);
        scene.add(tag);
      }
      return mesh;
    }
    sections.forEach((section, index) => {
      const azimuth = THREE.MathUtils.degToRad(section.azimuthDeg);
      const east = Math.sin(azimuth), north = Math.cos(azimuth);
      const originE = section.originEastingM ?? 0, originN = section.originNorthingM ?? 0;
      const at = (alongM: number, tvdM: number) => new THREE.Vector3((originE + alongM * east) / 100, -tvdM / 100, -(originN + alongM * north) / 100);
      const span = section.baseTvdM - section.topTvdM;
      const [wantTop, wantBase] = section.visibleTvdM ?? [Math.max(section.topTvdM, design.groundTvdM ?? section.topTvdM), section.baseTvdM];
      const top = THREE.MathUtils.clamp(wantTop, section.topTvdM, section.baseTvdM), base = THREE.MathUtils.clamp(wantBase, top, section.baseTvdM);
      const v0 = (top - section.topTvdM) / span, v1 = (base - section.topTvdM) / span;
      const a0 = section.alongStartM, a1 = section.alongEndM;
      const label = section.label ?? `Section ${index + 1}`;
      const mesh = hangPanel([at(a0, top), at(a1, top), at(a1, base), at(a0, base)], [0, v0, 1, v0, 1, v1, 0, v1], section.image, section.opacity ?? 1, section.label ?? "", at(a1, base).add(new THREE.Vector3(0, unit * 1.2, 0)));
      panels.push({ mesh, label, local: (point) => ({ alongM: (point.x * 100 - originE) * east + (-point.z * 100 - originN) * north, offsetM: null, tvdM: -point.y * 100 }), line: (tvdM) => [at(a0, tvdM), at(a1, tvdM)] });
    });
    let setVolumeView: (view: SceneVolumeView) => void = () => undefined;
    let volumeEye: (() => void) | null = null;
    let currentSlice: SlicePlane | null = null;
    let applySlice: (plane: SlicePlane | null) => void = () => undefined;
    const volumeBindings = new Map<THREE.Mesh, NonNullable<GpuPickTarget["volume"]>>();
    const sliceAnchor = new THREE.Object3D();
    scene.add(sliceAnchor);
    const transform = new TransformControls(camera, renderer.domElement);
    transform.setMode("translate"); transform.setSpace("local");
    transform.showX = false; transform.showY = false; transform.showZ = true;
    scene.add(transform.getHelper());
    transform.addEventListener("dragging-changed", (event) => { controls.enabled = !event.value; });
    transform.addEventListener("change", () => render());
    transform.addEventListener("objectChange", () => {
      if (!currentSlice) return;
      const p = sliceAnchor.position;
      emitSlice({ origin: [p.x * 100, -p.z * 100, -p.y * 100], normal: currentSlice.normal });
    });
    if (volume) {
      const { alongCount: nx, offsetCount: ny, sampleCount: nz, alongStartM: a0, alongEndM: a1, offsetStartM: o0, offsetEndM: o1, topTvdM: t0, baseTvdM: t1 } = volume;
      if (volume.counts.length !== nx * ny * nz) throw new Error(`Seismic volume has ${volume.counts.length} counts, expected ${nx} × ${ny} × ${nz}`);
      const at = planAt(volume.originEastingM ?? 0, volume.originNorthingM ?? 0, volume.azimuthDeg);
      // The frame maps the unit cube (along, offset, depth) onto the volume in the scene; it is affine, so rays stay straight.
      const frame = new THREE.Object3D();
      const origin = at(a0, o0, t0);
      frame.matrix.makeBasis(at(a1, o0, t0).sub(origin), at(a0, o1, t0).sub(origin), at(a0, o0, t1).sub(origin)).setPosition(origin);
      frame.matrixAutoUpdate = false;
      frame.updateMatrixWorld(true);
      earth.add(frame);
      const texture = new THREE.Data3DTexture(volume.counts, nx, ny, nz);
      texture.format = THREE.RedFormat;
      texture.type = THREE.ByteType;
      texture.internalFormat = "R8_SNORM";
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.unpackAlignment = 1;
      texture.needsUpdate = true;
      const lutBytes = new Uint8Array(256 * 4);
      for (let index = 0; index < 256; index++) { const [r, g, b] = seismicColour("seismic", index / 127.5 - 1); lutBytes.set([r, g, b, 255], index * 4); }
      const lutTexture = new THREE.DataTexture(lutBytes, 256, 1, THREE.RGBAFormat);
      lutTexture.magFilter = THREE.LinearFilter;
      lutTexture.minFilter = THREE.LinearFilter;
      lutTexture.needsUpdate = true;
      disposables.push(texture, lutTexture);
      const cropMin = new THREE.Vector3(0, 0, 0), cropMax = new THREE.Vector3(1, 1, 1), cropSize = new THREE.Vector3(1, 1, 1);
      const shared = { uVolume: { value: texture }, uLut: { value: lutTexture }, uGain: { value: volume.gain ?? 1 }, uCropMin: { value: cropMin }, uCropSize: { value: cropSize } };
      const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
      const solid = new THREE.Mesh(unitBox, new THREE.ShaderMaterial({ uniforms: shared, vertexShader: VOLUME_VERTEX, fragmentShader: SOLID_FRAGMENT, side: THREE.DoubleSide, toneMapped: false }));
      const eye = new THREE.Vector3();
      const rendered = new THREE.Mesh(unitBox.clone(), new THREE.ShaderMaterial({
        uniforms: { ...shared, uEye: { value: eye }, uCropMax: { value: cropMax }, uDims: { value: new THREE.Vector3(nx, ny, nz) }, uThreshold: { value: 0.5 } },
        vertexShader: VOLUME_VERTEX, fragmentShader: RENDER_FRAGMENT, side: THREE.BackSide, transparent: true, depthWrite: false, premultipliedAlpha: true, toneMapped: false,
      }));
      const proxy = new THREE.Mesh(unitBox.clone(), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(unitBox), new THREE.LineBasicMaterial({ color: "#20322a" }));
      const cropped = [solid, rendered, proxy, outline];
      for (const object of cropped) frame.add(object);
      const label = volume.label ?? "Seismic volume";
      const tag = textSprite(label.toUpperCase(), labelHeight * 0.8, "#20322a", 700);
      scene.add(tag);
      const frameInverse = frame.matrixWorld.clone().invert();
      const slice = new SeismicSlice(texture, lutTexture, volume.gain ?? 1);
      frame.add(slice.mesh);
      const binding = { texture, worldToTexture: frameInverse, scale: 127 * volume.amplitudePerCount, offset: 0 };
      volumeBindings.set(proxy, binding); volumeBindings.set(slice.mesh, binding);
      const localVolume = (point: THREE.Vector3) => {
        const uvw = point.clone().applyMatrix4(frameInverse);
        const index = (value: number, count: number) => THREE.MathUtils.clamp(Math.floor(value * count), 0, count - 1);
        const count = volume.counts[(index(uvw.z, nz) * ny + index(uvw.y, ny)) * nx + index(uvw.x, nx)]!;
        return { ...metres(uvw.x, uvw.y, uvw.z), amplitude: count * volume.amplitudePerCount };
      };
      let displayMode: SceneVolumeView["mode"] = "solid";
      applySlice = (plane) => {
        currentSlice = plane;
        setSliceVertices(slice.update(plane, frame.matrixWorld, cropMin, cropMax));
        solid.visible = !plane && displayMode !== "render";
        rendered.visible = !plane && displayMode === "render";
        proxy.visible = !plane;
        if (plane) {
          sliceAnchor.position.set(plane.origin[0] / 100, -plane.origin[2] / 100, -plane.origin[1] / 100);
          sliceAnchor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(plane.normal[0], -plane.normal[2], -plane.normal[1]).normalize());
          if (!transform.object) transform.attach(sliceAnchor);
        } else transform.detach();
      };
      volumeEye = () => { eye.copy(camera.position).applyMatrix4(frameInverse); };
      const metres = (u: number, v: number, w: number) => ({ alongM: a0 + u * (a1 - a0), offsetM: o0 + v * (o1 - o0), tvdM: t0 + w * (t1 - t0) });
      const corner = (u: number, v: number, w: number) => new THREE.Vector3(u, v, w).applyMatrix4(frame.matrixWorld);
      for (const u of [0, 1]) for (const v of [0, 1]) for (const w of [0, 1]) panelCorners.push(corner(u, v, w));
      setVolumeView = (view) => {
        const fraction = (range: readonly [number, number] | undefined, start: number, end: number, fallback: readonly [number, number]) => {
          const [lo, hi] = range ?? fallback;
          const f0 = THREE.MathUtils.clamp((Math.min(lo, hi) - start) / (end - start), 0, 1), f1 = THREE.MathUtils.clamp((Math.max(lo, hi) - start) / (end - start), 0, 1);
          return [f0, Math.max(f1, Math.min(1, f0 + 1e-3))] as const;
        };
        const [u0, u1] = fraction(view.alongM, a0, a1, [a0, a1]);
        const [v0, v1] = fraction(view.offsetM, o0, o1, [o0, o1]);
        const [w0, w1] = fraction(view.tvdM, t0, t1, [Math.max(t0, design.groundTvdM ?? t0), t1]);
        cropMin.set(u0, v0, w0);
        cropMax.set(u1, v1, w1);
        cropSize.subVectors(cropMax, cropMin);
        for (const object of cropped) { object.position.copy(cropMin); object.scale.copy(cropSize); }
        displayMode = view.mode;
        applySlice(currentSlice);
        (rendered.material as THREE.ShaderMaterial).uniforms.uThreshold!.value = THREE.MathUtils.clamp(view.threshold ?? 0.5, 0, 0.99);
        frame.updateMatrixWorld(true);
        tag.position.copy(corner(u1, v1, w1)).add(new THREE.Vector3(0, unit * 1.2, 0));
      };
      panels.push({
        mesh: proxy, label,
        local: localVolume,
        line: (tvdM) => { const w = (tvdM - t0) / (t1 - t0); return [corner(cropMin.x, cropMin.y, w), corner(cropMax.x, cropMin.y, w), corner(cropMax.x, cropMax.y, w), corner(cropMin.x, cropMax.y, w)]; },
      });
      panels.push({ mesh: slice.mesh, label: "Arbitrary seismic slice", local: localVolume });
      setVolumeView(volumeView);
    }
    sliceAt.current = (plane) => { applySlice(plane); render(); };
    const cursorLines = panels.filter((panel) => panel.line).map(() => {
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: CURSOR_COLOR, depthTest: false, transparent: true }));
      line.renderOrder = 16;
      line.visible = false;
      scene.add(line);
      return line;
    });
    const sectionLines = panels.flatMap((panel) => panel.line ? [panel.line] : []);

    const shadowPoints = samples.map((sample) => new THREE.Vector3(sample.point.x, groundY + 0.004, sample.point.z));
    const shadowMaterial = new THREE.LineDashedMaterial({ color: "#3f5a4e", dashSize: unit * 0.6, gapSize: unit * 0.4, transparent: true, opacity: 0.75 });
    const shadow = new THREE.Line(new THREE.BufferGeometry().setFromPoints(shadowPoints), shadowMaterial);
    shadow.computeLineDistances();
    scene.add(shadow);
    const bottomPoint = vector(totalDepth);
    const plumb = new THREE.Line(new THREE.BufferGeometry().setFromPoints([bottomPoint, new THREE.Vector3(bottomPoint.x, groundY, bottomPoint.z)]), new THREE.LineDashedMaterial({ color: "#3f5a4e", dashSize: unit * 0.5, gapSize: unit * 0.5, transparent: true, opacity: 0.55 }));
    plumb.computeLineDistances();
    scene.add(plumb);
    const shadowEnd = new THREE.Mesh(new THREE.CircleGeometry(unit * 0.35, 24), new THREE.MeshBasicMaterial({ color: "#3f5a4e", side: THREE.DoubleSide }));
    shadowEnd.rotation.x = -Math.PI / 2;
    shadowEnd.position.set(bottomPoint.x, groundY + 0.006, bottomPoint.z);
    scene.add(shadowEnd);
    if (target) {
      const aim = new THREE.Vector3(target.eastingM / 100, -target.tvdM / 100, -target.northingM / 100);
      const targetMaterial = new THREE.MeshBasicMaterial({ color: "#2f5fb3", depthTest: false, transparent: true, opacity: 0.95 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(unit * 1.1, unit * 0.12, 10, 40), targetMaterial);
      ring.position.copy(aim);
      ring.renderOrder = 14;
      const core = new THREE.Mesh(new THREE.SphereGeometry(unit * 0.32, 16, 10), targetMaterial);
      core.position.copy(aim);
      core.renderOrder = 14;
      scene.add(ring, core);
      const ringFlat = ring.clone();
      ringFlat.rotation.x = Math.PI / 2;
      scene.add(ringFlat);
      const label = textSprite("TARGET", labelHeight, "#2f5fb3", 700);
      label.position.copy(aim).add(new THREE.Vector3(unit * 1.6, unit * 0.8, 0));
      scene.add(label);
    }

    let collar: THREE.Mesh | null = null;
    const collarMaterial = new THREE.MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
    disposables.push(collarMaterial, hidden);
    function updateCompass() {
      const element = compass.current;
      if (!element) return;
      const forward = controls.target.clone().sub(camera.position);
      const heading = Math.hypot(forward.x, forward.z) < 1e-9 ? 0 : (Math.atan2(forward.x, -forward.z) * 180 / Math.PI + 360) % 360;
      element.querySelector("[data-dial]")?.setAttribute("transform", `rotate(${(-heading).toFixed(2)})`);
      element.querySelectorAll<SVGTextElement>("[data-upright]").forEach((label) => label.setAttribute("transform", `rotate(${heading.toFixed(2)})`));
      const caption = element.querySelector("[data-heading]");
      if (caption) caption.textContent = `view ${Math.round(heading) % 360}°`;
    }
    function render() {
      updateCompass();
      camera.updateMatrixWorld();
      volumeEye?.();
      renderer.clear();
      renderer.render(earth, camera);
      renderer.clearDepth();
      renderer.render(scene, camera);
      setCameraState([...camera.position.toArray(), ...camera.quaternion.toArray()].map((value) => value.toFixed(3)).join(","));
      setTargetState(controls.target.toArray().map((value) => value.toFixed(3)).join(","));
    }
    function fitBounds(boundsToFit: THREE.Box3, padding = 1.08) {
      if (boundsToFit.isEmpty()) return;
      const sphere = boundsToFit.getBoundingSphere(new THREE.Sphere());
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
      const distance = sphere.radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2) * padding;
      const direction = new THREE.Vector3(0.85, 0.32, 1.15).normalize();
      controls.target.copy(sphere.center);
      camera.position.copy(sphere.center).addScaledVector(direction, distance);
      camera.near = Math.max(0.01, distance / 2000);
      camera.far = Math.max(1000, distance * 20);
      camera.updateProjectionMatrix();
      controls.minDistance = Math.max(unit * 1.5, 0.05);
      controls.maxDistance = Math.max(distance * 6, 20);
      controls.update();
      render();
    }
    function fit() {
      const whole = new THREE.Box3().setFromPoints(stations.map((station) => vector(station.mdM)));
      for (const corner of panelCorners) whole.expandByPoint(corner);
      whole.expandByPoint(new THREE.Vector3(box.minX, groundY, box.minZ)).expandByPoint(new THREE.Vector3(box.maxX, groundY, box.maxZ)).expandByPoint(new THREE.Vector3(wellhead.x, stackY, wellhead.z));
      fitBounds(whole, 1.02);
    }
    function resize() {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      render();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    controls.addEventListener("change", render);
    const spatial = (point: THREE.Vector3): SpatialXYZ => [point.x * 100, -point.z * 100, -point.y * 100];
    function reportCamera() {
      const view = { position: spatial(camera.position), target: spatial(controls.target), zoom: camera.zoom };
      setAccessibleCamera(view);
      emitCamera(view);
    }
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute("tabindex", "0");
    renderer.domElement.setAttribute("aria-label", "Interactive 3D well scene");
    renderer.domElement.setAttribute("aria-describedby", canvasDescriptionId);
    controls.addEventListener("end", reportCamera);
    cameraAt.current = (view) => {
      const { position, target, zoom } = view;
      if (![...position, ...target, zoom].every(Number.isFinite) || zoom <= 0 || position.every((value, i) => value === target[i])) throw new TypeError("Camera view requires finite, distinct position/target vectors and positive zoom.");
      camera.position.set(position[0] / 100, -position[2] / 100, -position[1] / 100);
      controls.target.set(target[0] / 100, -target[2] / 100, -target[1] / 100);
      camera.zoom = zoom;
      const distance = camera.position.distanceTo(controls.target);
      camera.near = Math.max(0.01, distance / 2000);
      camera.far = Math.max(1000, distance * 20);
      controls.minDistance = Math.min(controls.minDistance, distance * 0.5);
      controls.maxDistance = Math.max(controls.maxDistance, distance * 2);
      camera.updateProjectionMatrix();
      controls.update();
      render();
    };
    const ray = new THREE.Raycaster();
    function cast(event: PointerEvent) {
      const rectangle = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((event.clientX - rectangle.left) / rectangle.width * 2 - 1, -(event.clientY - rectangle.top) / rectangle.height * 2 + 1), camera);
      const part = ray.intersectObjects(created)[0];
      if (part) return { id: part.object.userData.componentId as string, mdM: nearestDepth(part.point), xyz: spatial(part.point) };
      const path = ray.intersectObject(hitTarget)[0];
      if (path) { const mdM = nearestDepth(path.point); return { id: componentAt(mdM)?.id ?? null, mdM, xyz: spatial(path.point) }; }
      const plane = panels.length ? ray.intersectObjects(panels.filter((panel) => panel.mesh.visible).map((panel) => panel.mesh))[0] : undefined;
      const panel = plane && panels.find((value) => value.mesh === plane.object);
      if (!plane || !panel) return null;
      const local = panel.local(plane.point);
      const mdM = mdAtTvd(local.tvdM);
      return { id: mdM === null ? null : componentAt(mdM)?.id ?? null, mdM, xyz: spatial(plane.point), section: { label: panel.label, ...local, mdM } };
    }
    let pressed: { horizontal: number; vertical: number } | null = null;
    let hoverFrame = 0;
    let gpuPicker: GpuFramebufferPicker | null = null, pickPending = false, dead = false, pointerGeneration = 0;
    let pendingClick: PointerEvent | null = null;
    let pendingHover: PointerEvent | null = null;
    const gpuCast = async (event: PointerEvent, clicked: boolean) => {
      if (transform.dragging) return;
      if (pickPending) { if (clicked) { pendingClick = event; pendingHover = null; } else pendingHover = event; pointerGeneration++; return; }
      pickPending = true;
      const generation = ++pointerGeneration;
      try {
        gpuPicker ??= new GpuFramebufferPicker(renderer);
        const rectangle = renderer.domElement.getBoundingClientRect(), size = renderer.getDrawingBufferSize(new THREE.Vector2());
        const targets: GpuPickTarget[] = [
          ...created.filter((mesh) => mesh.visible).map((mesh) => ({ mesh })),
          ...[pathMesh, logCylinder.mesh].filter((mesh) => mesh.visible).map((mesh) => ({ mesh })),
          ...panels.filter((panel) => panel.mesh.visible).map((panel) => ({ mesh: panel.mesh, volume: volumeBindings.get(panel.mesh) })),
        ];
        const result = await gpuPicker.pick(camera, targets, (event.clientX - rectangle.left) / rectangle.width * size.x, (event.clientY - rectangle.top) / rectangle.height * size.y);
        if (dead || !isGpuPicking() || (!clicked && generation !== pointerGeneration)) return;
        if (!result) { setGpuReadout(null); setHover(null); setSectionHover(null); emitCursor(null); return; }
        const xyz = spatial(result.point), panel = panels.find((p) => p.mesh === result.target.mesh);
        const mdM = panel ? mdAtTvd(xyz[2]) : nearestDepth(result.point);
        const id = panel || result.target.mesh === pathMesh || result.target.mesh === logCylinder.mesh ? mdM === null ? null : componentAt(mdM)?.id ?? null : result.target.mesh.userData.componentId as string;
        const local = panel?.local(result.point);
        setGpuReadout({ xyz, amplitude: result.amplitude });
        setSectionHover(panel && local ? { label: panel.label, ...local, ...(result.amplitude !== null ? { amplitude: result.amplitude } : {}), mdM } : null);
        setHover(mdM === null ? null : readout(mdM, records.find((c) => c.id === id)?.name ?? null));
        emitCursor(mdM);
        if (clicked) {
          emitSpatialPick(xyz); emitGpuPick({ xyz, amplitude: result.amplitude, componentId: id });
          if (mdM !== null) { commitProbe(mdM); if (id) emitSelection(id); }
        }
      } catch (error) {
        if (!dead) setFailure(`GPU picking failed: ${error instanceof Error ? error.message : String(error)}. Select CPU picking to continue.`);
      } finally {
        pickPending = false;
        if (dead || !isGpuPicking()) { pendingClick = null; pendingHover = null; }
        else if (pendingClick) { const click = pendingClick; pendingClick = null; void gpuCast(click, true); }
        else if (pendingHover) { const hover = pendingHover; pendingHover = null; void gpuCast(hover, false); }
      }
    };
    function pointerDown(event: PointerEvent) { pressed = { horizontal: event.clientX, vertical: event.clientY }; }
    function pointerUp(event: PointerEvent) {
      const start = pressed;
      pressed = null;
      if (!start || Math.hypot(event.clientX - start.horizontal, event.clientY - start.vertical) > 5) return;
      if (transform.axis !== null) return;
      if (isGpuPicking()) { void gpuCast(event, true); return; }
      const hit = cast(event);
      if (hit) emitSpatialPick(hit.xyz);
      if (!hit || hit.mdM === null) return;
      commitProbe(hit.mdM);
      if (hit.id) emitSelection(hit.id);
      render();
    }
    function pointerMove(event: PointerEvent) {
      if (pressed || hoverFrame) return;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        if (isGpuPicking()) { void gpuCast(event, false); return; }
        const hit = cast(event);
        renderer.domElement.style.cursor = hit?.mdM != null ? "pointer" : hit ? "crosshair" : "";
        setHover(hit?.mdM != null ? readout(hit.mdM, records.find((component) => component.id === hit.id)?.name ?? null) : null);
        setSectionHover(hit && "section" in hit ? hit.section ?? null : null);
        emitCursor(hit?.mdM ?? null);
      });
    }
    function pointerLeave() {
      pointerGeneration++; pendingHover = null;
      cancelAnimationFrame(hoverFrame); hoverFrame = 0;
      setGpuReadout(null); setHover(null); setSectionHover(null); emitCursor(null);
    }
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    renderer.domElement.addEventListener("pointermove", pointerMove);
    renderer.domElement.addEventListener("pointerleave", pointerLeave);
    redraw.current = render;
    reset.current = () => { fit(); reportCamera(); };
    highlight.current = (id) => {
      const present = id !== null && created.some((mesh) => mesh.userData.componentId === id);
      for (const mesh of created) {
        const selected = present && mesh.userData.componentId === id;
        const dim = present && !selected;
        const base = (mesh.userData.base ??= { opacity: mesh.material.opacity, transparent: mesh.material.transparent, depthWrite: mesh.material.depthWrite }) as { opacity: number; transparent: boolean; depthWrite: boolean };
        mesh.material.emissive.set(selected ? SELECT_COLOR : "#000000");
        mesh.material.emissiveIntensity = selected ? 0.85 : 0;
        mesh.material.transparent = dim || base.transparent;
        mesh.material.opacity = dim ? base.opacity * (hasSeismic ? 0.7 : 0.28) : base.opacity;
        mesh.material.depthWrite = dim ? false : base.depthWrite;
        mesh.material.needsUpdate = true;
      }
      if (collar) { scene.remove(collar); collar.geometry.dispose(); collar = null; }
      const component = records.find((value) => value.id === id);
      if (component && component.bottomDepthM - component.topDepthM >= 0.5) {
        const base = radiusById.get(id) ?? (component.parentId ? radiusById.get(component.parentId) : undefined) ?? unit * 0.4;
        const middle = (component.topDepthM + component.bottomDepthM) / 2;
        const half = Math.max((component.bottomDepthM - component.topDepthM) / 2, unit * 18);
        collar = new THREE.Mesh(tube(Math.max(0, middle - half), Math.min(totalDepth, middle + half), base * 1.3 + unit * 0.12, 32).geometry, collarMaterial);
        collar.userData.collar = id;
        scene.add(collar);
      }
      render();
    };
    focus.current = (id) => {
      const intervalBounds = new THREE.Box3();
      for (const object of created) if (object.userData.componentId === id) intervalBounds.expandByObject(object);
      if (collar?.userData.collar === id) intervalBounds.expandByObject(collar);
      const component = records.find((value) => value.id === id);
      if (intervalBounds.isEmpty() && component) intervalBounds.expandByPoint(vector(component.topDepthM)).expandByPoint(vector(component.bottomDepthM)).expandByScalar(unit * 3);
      fitBounds(intervalBounds, 1.2);
      reportCamera();
    };
    resize();
    const saved = savedViews.get(design.id);
    if (saved) {
      camera.position.copy(saved.position);
      controls.target.copy(saved.target);
      const distance = saved.position.distanceTo(saved.target);
      camera.near = Math.max(0.01, distance / 2000);
      camera.far = Math.max(1000, distance * 20);
      camera.updateProjectionMatrix();
      controls.minDistance = Math.max(unit * 1.5, 0.05);
      controls.maxDistance = Math.max(size * 12, 20);
      controls.update();
      render();
    } else fit();
    applyControlledCamera();
    probeAt.current = (mdM) => {
      if (mdM == null || !Number.isFinite(mdM)) { probeMarker.visible = false; setProbe(null); render(); return; }
      const depth = Math.min(totalDepth, Math.max(0, mdM));
      probeMarker.position.copy(vector(depth));
      probeMarker.visible = true;
      setProbe(readout(depth, componentAt(depth)?.name ?? null));
      render();
    };
    let lastCursor: number | null = null;
    let lastWindow: readonly [number, number] | null = null;
    cursorAt.current = (mdM) => {
      lastCursor = mdM;
      const show = mdM != null && Number.isFinite(mdM);
      cursorRing.visible = show;
      for (const line of cursorLines) line.visible = show;
      if (show) {
        const depth = Math.min(totalDepth, Math.max(0, mdM));
        const point = vector(depth);
        cursorRing.position.copy(point);
        cursorRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), vector(Math.min(totalDepth, depth + 1)).sub(vector(Math.max(0, depth - 1))).normalize());
        sectionLines.forEach((line, index) => cursorLines[index]!.geometry.setFromPoints(line(-point.y * 100)));
      }
      render();
    };
    windowAt.current = (window) => {
      lastWindow = window;
      for (const mesh of [windowTube, ...windowBands]) if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
      windowTube = null;
      windowBands = [];
      if (window) {
        const top = Math.max(0, Math.min(window[0], window[1])), base = Math.min(totalDepth, Math.max(window[0], window[1]));
        if (base - top > 0.5) {
          windowTube = new THREE.Mesh(tube(top, base, unit * 0.5, 16).geometry, windowMaterial);
          scene.add(windowTube);
          for (const line of sectionLines) {
            const upper = line(-vector(top).y * 100), lower = line(-vector(base).y * 100);
            const geometry = new THREE.BufferGeometry().setFromPoints([...upper, ...lower]);
            const count = upper.length, index: number[] = [];
            for (let side = 0; side < (count > 2 ? count : 1); side++) { const next = (side + 1) % count; index.push(side, next, count + next, side, count + next, count + side); }
            geometry.setIndex(index);
            const band = new THREE.Mesh(geometry, bandMaterial);
            band.renderOrder = 1;
            scene.add(band);
            windowBands.push(band);
          }
        }
      }
      render();
    };
    viewAt.current = (view) => { setVolumeView(view); cursorAt.current(lastCursor); windowAt.current(lastWindow); };
    sliceAt.current(initialSlice());
    reportCamera();
    setReady(true);
    return () => {
      dead = true; gpuPicker?.dispose(); transform.dispose();
      savedViews.set(design.id, { position: camera.position.clone(), target: controls.target.clone() });
      setReady(false);
      setHover(null);
      setProbe(null);
      setSectionHover(null);
      cancelAnimationFrame(hoverFrame);
      observer.disconnect();
      controls.removeEventListener("change", render);
      controls.removeEventListener("end", reportCamera);
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.domElement.removeEventListener("pointermove", pointerMove);
      renderer.domElement.removeEventListener("pointerleave", pointerLeave);
      if (collar) collar.geometry.dispose();
      for (const root of [scene, earth]) root.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) { (material as THREE.SpriteMaterial).map?.dispose(); material.dispose(); }
        }
      });
      for (const item of disposables) item.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      redraw.current = () => undefined;
      reset.current = () => undefined;
      focus.current = () => undefined;
      highlight.current = () => undefined;
      probeAt.current = () => undefined;
      cursorAt.current = () => undefined;
      windowAt.current = () => undefined;
      viewAt.current = () => undefined;
      cameraAt.current = () => undefined;
      sliceAt.current = () => undefined;
      logAt.current = () => undefined;
    };
  }, [design, layersVisible, colorBy, dlsLimitDegPer30m, targetKey, sections, volume]); // target and volumeView are applied without a rebuild

  useEffect(() => { if (probeMdM !== undefined) probeAt.current(probeMdM); }, [probeMdM, ready]);
  useEffect(() => { if (cameraView) cameraAt.current(cameraView); }, [cameraView, ready]);
  useEffect(() => {
    try { sliceAt.current(slicePlane); } catch (error) { setFailure(`Slice update failed: ${error instanceof Error ? error.message : String(error)}`); }
  }, [slicePlane, ready]);
  useEffect(() => {
    try { logAt.current(logCurve, logStyle); } catch (error) { setFailure(`Log styling failed: ${error instanceof Error ? error.message : String(error)}`); }
  }, [logCurve, logStyle, ready]);
  useEffect(() => { setGpuReadout(null); setFailure(""); }, [picking]);
  useEffect(() => { cursorAt.current(cursorMdM); }, [cursorMdM, ready]);
  const windowKey = mdWindow ? `${mdWindow[0]}:${mdWindow[1]}` : "";
  useEffect(() => { windowAt.current(mdWindow); }, [windowKey, ready]);

  useEffect(() => { highlight.current(selectedId); }, [selectedId, ready]);
  const viewKey = JSON.stringify(volumeView);
  useEffect(() => { viewAt.current(volumeView); }, [viewKey, ready]);

  const shown = hover ?? probe;
  function adjustCamera(axis: 0 | 2, amount: number) {
    if (!accessibleCamera) return;
    const position = [...accessibleCamera.position] as [number, number, number];
    const target = [...accessibleCamera.target] as [number, number, number];
    const step = Math.max(design.totalDepthM * 0.04, 10);
    position[axis] += amount * step;
    target[axis] += amount * step;
    const next = { ...accessibleCamera, position, target };
    setAccessibleCamera(next);
    cameraAt.current(next);
    emitCamera(next);
  }
  function adjustZoom(factor: number) {
    if (!accessibleCamera) return;
    const next = { ...accessibleCamera, zoom: Math.max(0.1, Math.min(10, accessibleCamera.zoom * factor)) };
    setAccessibleCamera(next);
    cameraAt.current(next);
    emitCamera(next);
  }
  return <div className="sw-well-scene" data-testid="interactive-well-scene" data-ready={ready} data-camera={cameraState} data-target={targetState} data-layer-count={layerCount} data-component-count={componentCount} data-slice-vertices={sliceVertices} data-log-triangles={logTriangles} data-picking={picking}>
    <div ref={host} className="sw-scene-host" />
    <p className="sw-sr-only" id={canvasDescriptionId}>Interactive 3D well and optional seismic view. Pointer users can orbit the scene. Keyboard users can use the camera controls alongside the scene to pan on X and depth axes, zoom, fit, or focus the selected interval.</p>
    <div className="sw-scene-keyboard-controls" role="group" aria-label="3D camera keyboard alternatives">
      <CommandButton kind="selection" type="button" aria-label="Pan scene left" disabled={!ready || !accessibleCamera} onClick={() => adjustCamera(0, -1)}>Left</CommandButton>
      <CommandButton kind="selection" type="button" aria-label="Pan scene up" disabled={!ready || !accessibleCamera} onClick={() => adjustCamera(2, -1)}>Up</CommandButton>
      <CommandButton kind="selection" type="button" aria-label="Pan scene down" disabled={!ready || !accessibleCamera} onClick={() => adjustCamera(2, 1)}>Down</CommandButton>
      <CommandButton kind="selection" type="button" aria-label="Pan scene right" disabled={!ready || !accessibleCamera} onClick={() => adjustCamera(0, 1)}>Right</CommandButton>
      <CommandButton icon="zoomIn" type="button" aria-label="Zoom scene in" disabled={!ready || !accessibleCamera} onClick={() => adjustZoom(1.25)}>Zoom in</CommandButton>
      <CommandButton icon="zoomOut" type="button" aria-label="Zoom scene out" disabled={!ready || !accessibleCamera} onClick={() => adjustZoom(0.8)}>Zoom out</CommandButton>
      <CommandButton icon="fit" type="button" aria-label="Fit 3D well" disabled={!ready} onClick={() => reset.current()}>Fit scene</CommandButton>
      <CommandButton icon="focus" type="button" aria-label="Focus selected interval" disabled={!ready} onClick={() => focus.current(selectedId)}>Focus interval</CommandButton>
    </div>
    <details className="sw-scene-component-picker">
      <summary>Choose a well component</summary>
      <div role="group" aria-label="Well components">
        {getWellComponents(design).map((component) => <CommandButton kind="selection" key={component.id} type="button" aria-pressed={selectedId === component.id} onClick={() => onSelect(component.id)}>{component.name}</CommandButton>)}
      </div>
    </details>
    <output className="sw-sr-only" aria-live="polite">{accessibleCamera ? `Camera position ${accessibleCamera.position.map((value) => value.toFixed(1)).join(", ")} metres; zoom ${accessibleCamera.zoom.toFixed(2)}.` : "Camera view initializing."}</output>
    {gpuReadout && <output className="sw-scene-legend" data-testid="gpu-pick-readout" data-xyz={gpuReadout.xyz.join(",")} data-amplitude={gpuReadout.amplitude ?? ""}>GPU pick: {gpuReadout.xyz.map((v) => v.toFixed(1)).join(", ")} m{gpuReadout.amplitude !== null && ` · amplitude ${gpuReadout.amplitude.toFixed(3)}`}</output>}
    {design.provenance === "documented" && <CasingDiameterInset components={getWellComponents(design)} selectedId={selectedId} onSelect={onSelect} />}
    <CommandButton className="sw-icon-button sw-scene-fit" aria-label="Fit 3D well" title="Fit 3D well" onClick={() => reset.current()}><Maximize size={17} /></CommandButton>
    <CommandButton className="sw-icon-button sw-scene-focus" aria-label="Focus selected interval" title="Focus selected interval" onClick={() => focus.current(selectedId)}><Crosshair size={17} /></CommandButton>
    <svg ref={compass} className="sw-scene-compass" viewBox="-40 -40 80 92" role="img" aria-label="Compass: grid north relative to the current view direction (up)" data-testid="well-scene-compass"><circle r="36" /><g data-dial=""><line x1="0" y1="6" x2="0" y2="-14" className="sw-compass-north" /><path d="M0 -22 L5.5 -12 L-5.5 -12 Z" className="sw-compass-head" /><line x1="-6" y1="0" x2="19" y2="0" className="sw-compass-east" /><g transform="translate(0 -29)"><text data-upright="" y="4">N</text></g><g transform="translate(27 0)"><text data-upright="" y="4">E</text></g></g><text data-heading="" y="49" className="sw-compass-caption">view 0°</text></svg>
    {(sections.length > 0 || volume) && <span className="sw-scene-legend sw-scene-section-legend" data-testid="well-scene-section-legend">{[...sections.map((panel, index) => panel.label ?? `Section ${index + 1}`), ...(volume ? [volume.label ?? "Seismic volume"] : [])].map((name, index) => <span key={index}>{name}</span>)}<small>Hover the seismic for position, TVD and amplitude; click to pin the depth where the well reaches it</small></span>}
    {colorBy === "dls" && <span className="sw-scene-legend" data-testid="well-scene-dls-legend">DLS 0<i aria-hidden="true" />{dlsLimitDegPer30m}°/30 m limit →</span>}
    <output className="sw-scene-readout" data-testid="well-scene-readout" data-md={shown ? shown.mdM.toFixed(1) : ""} data-section={sectionHover ? "" : undefined} aria-live="polite">{sectionHover && <span className="sw-scene-section-readout"><b>{sectionHover.label}</b><span>along {formatMetres(sectionHover.alongM)}</span>{sectionHover.offsetM !== null && <span>offset {formatMetres(sectionHover.offsetM)}</span>}<span>TVD {formatMetres(sectionHover.tvdM)}</span>{sectionHover.amplitude !== undefined && <span>amp {sectionHover.amplitude.toFixed(2)}</span>}<span>{sectionHover.mdM === null ? "below well TD" : `well reaches at MD ${formatMetres(sectionHover.mdM)}`}</span></span>}{shown ? <><b>MD {formatMetres(shown.mdM)}</b><span>TVD {formatMetres(shown.tvdM)}</span><span>Inc {shown.inclinationDeg.toFixed(1)}°</span><span>Azi {shown.azimuthDeg.toFixed(1)}°</span>{shown.name && <span>{shown.name}</span>}</> : !sectionHover && <span>Click the well path to probe a depth</span>}</output>
    <span className="sw-scene-status">{failure || <>{design.provenance === "documented" ? "Observed survey" : design.provenance === "user-authored" ? (design.trajectoryName ?? "User-planned trajectory") : "Synthetic survey"} · not to scale <InfoTip label="About this 3D scene">{design.provenance === "documented" ? "Observed survey and reported ODs. Diameters are exaggerated for legibility; the cutaway shows nesting, not wall thickness." : design.provenance === "user-authored" ? "Planned values, not engineering approval. Diameters are exaggerated for legibility." : "Synthetic survey fixture. Diameters are exaggerated for legibility."}</InfoTip></>}</span>
  </div>;
}
