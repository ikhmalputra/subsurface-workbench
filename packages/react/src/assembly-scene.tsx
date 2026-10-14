"use client";

import { InfoTip } from "./info-tip.js";
import { useEffect, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { ClippingGroup } from "three/webgpu";
import { createSceneRenderer } from "./scene-renderer.js";
import { AmbientOcclusion } from "./scene-ao.js";
import type { SceneRenderer } from "./scene-renderer.js";
import { getCatalogEntry, moveComponent, placeComponent } from "@ikhmalputra/subsurface-core";
import type { AssemblyItem, WellAssembly } from "@ikhmalputra/subsurface-core";
import { Boxes, Crosshair, Focus, Maximize } from "lucide-react";
import { assetUrl, catalogIdFromDrag } from "./assembly-palette.js";
import { formatDepth } from "./assembly-format.js";
import { CommandButton } from "./ui.js";
import { MODEL_FACES, ViewCube } from "./view-cube.js";
import type { NamedView } from "./view-cube.js";
import { SectionTool } from "./section-tool.js";
import type { SectionState } from "./section-tool.js";
import { SceneSectionControl, SceneViewKeys } from "./scene-tools.js";

export interface AssemblySceneProps {
  readonly assembly: WellAssembly;
  readonly assetBaseUrl: string;
  readonly selectedId?: string | null;
  readonly onSelect?: (itemId: string | null) => void;
  readonly onDropComponent?: (catalogId: string, depthM: number) => void;
  readonly onMoveComponent?: (itemId: string, depthM: number) => void;
  readonly title?: string;
  /** Controlled exploded mode: strings, cement, tubing and tools pulled apart side by side on a shared depth scale. */
  readonly exploded?: boolean;
  readonly defaultExploded?: boolean;
  readonly onExplodedChange?: (exploded: boolean) => void;
}

const SCENE_H = 40;
const RADIUS_PER_IN = 0.11;
const R = (inches: number) => inches * RADIUS_PER_IN;
const CUT_START = THREE.MathUtils.degToRad(76);
const CUT_LENGTH = Math.PI * 1.5;
const models = new Map<string, Promise<THREE.Group>>();

// The catalogue's models are quantised and meshopt-packed (tools/compress-models.mjs); one loader
// with the decoder serves them all.
let loader: GLTFLoader | null = null;
function modelLoader() {
  loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

function loadModel(url: string) {
  let pending = models.get(url);
  if (!pending) {
    pending = modelLoader().loadAsync(url).then((gltf) => gltf.scene);
    pending.catch(() => models.delete(url));
    models.set(url, pending);
  }
  return pending;
}

function tag(object: THREE.Object3D, itemId: string) {
  object.traverse((child) => { child.userData.itemId = itemId; });
  return object;
}

function shell(inner: number, outer: number, yTop: number, yBottom: number, material: THREE.Material, full = false) {
  const points = [new THREE.Vector2(inner, yTop), new THREE.Vector2(outer, yTop), new THREE.Vector2(outer, yBottom), new THREE.Vector2(inner, yBottom), new THREE.Vector2(inner, yTop)];
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(points, 72, full ? 0 : CUT_START, full ? Math.PI * 2 : CUT_LENGTH), material);
  mesh.castShadow = true;
  return mesh;
}

function tagSprite(text: string, fill: string, ink: string, height = 0.028) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  const font = "600 34px 'IBM Plex Sans', system-ui, sans-serif";
  context.font = font;
  canvas.width = Math.ceil(context.measureText(text).width) + 40;
  canvas.height = 60;
  context.font = font;
  context.fillStyle = fill;
  context.beginPath();
  context.roundRect(0, 0, canvas.width, canvas.height, 12);
  context.fill();
  context.fillStyle = ink;
  context.textBaseline = "middle";
  context.fillText(text, 20, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, sizeAttenuation: false }));
  sprite.scale.set(height * canvas.width / canvas.height, height, 1);
  sprite.renderOrder = 20;
  return sprite;
}

function disposeTree(group: THREE.Object3D) {
  group.traverse((child) => {
    if (child instanceof THREE.Sprite) { child.material.map?.dispose(); child.material.dispose(); }
    else if (child instanceof THREE.Mesh || child instanceof THREE.Line) { child.geometry.dispose(); (child.material as THREE.Material).dispose(); }
  });
  group.clear();
}

/**
 * A depth tick drawn into a sprite.
 *
 * The colour used to be a hard-coded dark grey, which was legible only because the backdrop was a
 * hard-coded near-white in every theme. Both now follow the theme, and the label carries the
 * halo the rest of the drawing text uses, so it stays readable against the model as well as
 * against the ground.
 */
function depthLabel(text: string, ink: string, halo: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext("2d")!;
  context.font = "500 30px 'IBM Plex Mono', monospace";
  context.textAlign = "right";
  context.lineWidth = 5;
  context.lineJoin = "round";
  context.strokeStyle = halo;
  context.strokeText(text, 248, 42);
  context.fillStyle = ink;
  context.fillText(text, 248, 42);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.scale.set(4, 1, 1);
  return sprite;
}

interface DragHint { readonly x: number; readonly y: number; readonly text: string; readonly valid: boolean }

export function AssemblyScene({ assembly, assetBaseUrl, selectedId = null, onSelect, onDropComponent, onMoveComponent, title = "3D assembly", exploded: explodedProp, defaultExploded = false, onExplodedChange }: AssemblySceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ rebuild: (value: WellAssembly) => void; highlight: (id: string | null) => void; fit: (id?: string | null) => void; depthAt: (x: number, y: number) => number; marker: (depth: number | null, valid?: boolean) => void; pick: (x: number, y: number) => string | null; setControls: (enabled: boolean) => void; explode: (on: boolean, animate?: boolean) => void; isolate: (id: string | null) => void; section: (state: SectionState | null) => void; look: (view: NamedView) => void } | null>(null);
  const [explodedState, setExplodedState] = useState(defaultExploded);
  const exploded = explodedProp ?? explodedState;
  const [isolated, setIsolated] = useState(false);
  const latest = useRef({ assembly, selectedId, onSelect, onMoveComponent, exploded, isolated });
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState("");
  const [hint, setHint] = useState<DragHint | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [section, setSection] = useState<SectionState | null>(null);
  useEffect(() => { latest.current = { assembly, selectedId, onSelect, onMoveComponent, exploded, isolated }; });

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    // WebGPU where the browser has it, WebGL 2 where it does not; the scene builds now and draws once the device is up.
    let started: SceneRenderer;
    try {
      started = createSceneRenderer({ alpha: true });
    } catch {
      setFailure("3D is unavailable in this browser; the schematic remains fully editable.");
      return;
    }
    const { renderer } = started;
    renderer.domElement.setAttribute("aria-hidden", "true");
    element.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    /**
     * Three-point lighting, because one sun and a bright hemisphere is what made this flat.
     *
     * The hemisphere was carrying most of the exposure, which lights every surface of a cylinder
     * almost equally — so casing read as a flat orange stripe rather than a tube. Dropping it to a
     * fill and putting the energy into a key gives the tubulars a lit side and a shaded side; a
     * dim rim from behind separates the model from the backdrop it now has.
     */
    scene.add(new THREE.HemisphereLight(0xf4f1e8, 0x56605a, 0.55));
    const key = new THREE.DirectionalLight(0xfff4e6, 2.4);
    key.position.set(14, 30, 22);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe9ff, 0.7);
    fill.position.set(-22, 8, 14);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.1);
    rim.position.set(-8, 16, -26);
    scene.add(rim);
    const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 2000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.zoomToCursor = true;
    controls.minDistance = 1.2;
    controls.maxDistance = 400;
    // The construction is a clipping group: the section plane cuts it on either backend.
    const world = new ClippingGroup();
    const context = new THREE.Group();
    const ladder = new THREE.Group();
    const selection = new THREE.Group();
    ladder.visible = false;
    scene.add(context, ladder, world, selection);
    // Cut the construction, not the context: the depth ladder and ground stay whole around the cut.
    const section = new SectionTool(world, {
      solids: () => { const meshes: THREE.Mesh[] = []; world.traverse((object) => { if ((object as THREE.Mesh).isMesh && !object.userData.sectionCap) meshes.push(object as THREE.Mesh); }); return meshes; },
      bounds: () => new THREE.Box3().setFromObject(world),
    });
    scene.add(section.outline);
    let sectionDirty = false;
    const cube = new ViewCube(camera, controls, element, { labels: MODEL_FACES, home: new THREE.Vector3(0.92, 0.34, 1), onChange: () => undefined,
      onSettled: () => { element.dataset.camera = `${camera.position.toArray().map((value) => value.toFixed(2)).join(",")}|${controls.target.toArray().map((value) => value.toFixed(2)).join(",")}`; } });
    const selectTone = () => new THREE.Color(getComputedStyle(element).getPropertyValue("--sw-select").trim() || "#ff6a00");
    const themeColour = (name: string, fallback: string) => getComputedStyle(element).getPropertyValue(name).trim() || fallback;
    const labelInk = () => themeColour("--sw-well-text", "#3d4a44");
    const labelHalo = () => themeColour("--sw-text-halo", "#ffffff");
    const nameTag = document.createElement("div");
    nameTag.className = "sw-asm3d-tag";
    nameTag.setAttribute("aria-hidden", "true");
    nameTag.hidden = true;
    element.append(nameTag);
    const projected = new THREE.Vector3();
    const placeTag = () => {
      const anchors = selection.userData.anchors as THREE.Vector3[] | null;
      if (!anchors) { nameTag.hidden = true; return; }
      const width = element.clientWidth;
      const height = element.clientHeight;
      const screen = anchors.map((anchor) => {
        projected.copy(anchor).applyMatrix4(selection.matrixWorld).project(camera);
        return { x: (projected.x + 1) / 2 * width, y: (1 - projected.y) / 2 * height, z: projected.z };
      });
      const [left, right] = screen[0]!.x <= screen[1]!.x ? [screen[0]!, screen[1]!] : [screen[1]!, screen[0]!];
      if (left.z > 1 || right.y < -20 || right.y > height + 20) { nameTag.hidden = true; return; }
      nameTag.hidden = false;
      const tagWidth = nameTag.offsetWidth;
      const tagHeight = nameTag.offsetHeight;
      const onRight = right.x + 12 + tagWidth <= width - 8 || left.x - 12 - tagWidth < 8;
      nameTag.dataset.side = onRight ? "right" : "left";
      const x = Math.min(width - tagWidth - 8, Math.max(8, onRight ? right.x + 12 : left.x - 12 - tagWidth));
      const y = Math.min(height - tagHeight - 8, Math.max(8, right.y - tagHeight / 2));
      nameTag.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    };
    let explodedNow = false;
    let animating = false;
    let fitAfter = false;
    const markerRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 8, 64), new THREE.MeshBasicMaterial({ color: 0x235faa, depthTest: false, transparent: true }));
    markerRing.rotation.x = Math.PI / 2;
    markerRing.renderOrder = 10;
    markerRing.visible = false;
    scene.add(markerRing);
    let token = 0;
    let td = 1;
    const y = (md: number) => -md / td * SCENE_H;

    function drawContext(maxRadius: number) {
      context.clear();
      const ground = new THREE.Mesh(new THREE.RingGeometry(maxRadius + 0.6, maxRadius + 5, 64), new THREE.MeshStandardMaterial({ color: 0xd8d1c0, roughness: 1, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
      ground.rotation.x = -Math.PI / 2;
      context.add(ground);
      const step = [100, 200, 250, 500, 1000, 2000].find((value) => td / value <= 9) ?? 5000;
      for (let md = 0; md <= td + 1e-6; md += step) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(maxRadius + 0.35, maxRadius + 0.42, 64), new THREE.MeshBasicMaterial({ color: 0x9aa59f, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = y(md);
        const label = depthLabel(md === 0 ? "0 m" : `${md.toLocaleString("en-US")} m`, labelInk(), labelHalo());
        label.position.set(-(maxRadius + 2.6), y(md), 0);
        context.add(ring, label);
      }
      const td3 = depthLabel(`TD ${formatDepth(td)}`, labelInk(), labelHalo());
      td3.position.set(maxRadius + 2.6, y(td), 0);
      context.add(td3);
    }

    function rebuild(value: WellAssembly) {
      const build = ++token;
      td = value.totalDepthM;
      world.clear();
      const items = value.items;
      const strings = items.filter((item) => ["casing", "liner"].includes(getCatalogEntry(item.catalogId).slot));
      const maxRadius = Math.max(R(20), ...items.filter((item) => getCatalogEntry(item.catalogId).slot !== "cement").map((item) => R(item.odIn)));
      drawContext(maxRadius);
      const material = (item: AssemblyItem, overrides: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: getCatalogEntry(item.catalogId).color, metalness: 0.55, roughness: 0.38, side: THREE.DoubleSide, ...overrides });
      const deepest = strings.reduce<AssemblyItem | undefined>((best, item) => (!best || item.bottomM > best.bottomM || (item.bottomM === best.bottomM && item.odIn < best.odIn) ? item : best), undefined);
      if (deepest && deepest.bottomM < td) {
        const radius = R(deepest.idIn ?? deepest.odIn) * 0.98;
        const hole = shell(radius, radius + 0.08, y(deepest.bottomM), y(td), new THREE.MeshStandardMaterial({ color: 0x8b7d64, roughness: 1, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
        hole.userData.context = true;
        world.add(hole);
      }
      for (const item of items) {
        const spec = getCatalogEntry(item.catalogId);
        const group = new THREE.Group();
        group.name = item.id;
        if (spec.slot === "casing" || spec.slot === "liner" || spec.slot === "tubing") {
          const outer = R(item.odIn);
          const inner = R(item.idIn ?? item.odIn * 0.9);
          group.add(shell(Math.min(inner, outer - 0.02), outer, y(item.topM), y(item.bottomM), material(item)));
          if (spec.slot !== "tubing") {
            const shoe = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(outer, y(item.bottomM) + 0.5), new THREE.Vector2(outer + 0.18, y(item.bottomM)), new THREE.Vector2(inner, y(item.bottomM)), new THREE.Vector2(outer, y(item.bottomM) + 0.5)], 72, CUT_START, CUT_LENGTH), material(item, { metalness: 0.7, roughness: 0.3 }));
            group.add(shoe);
          }
        } else if (spec.slot === "cement") {
          const hostItem = items.find((entry) => entry.id === item.hostId);
          if (hostItem) {
            const cuts = [...new Set([item.topM, item.bottomM, ...strings.filter((entry) => entry.odIn > hostItem.odIn && entry.bottomM > item.topM && entry.bottomM < item.bottomM).map((entry) => entry.bottomM)])].sort((a, b) => a - b);
            for (let index = 1; index < cuts.length; index++) {
              const mid = (cuts[index - 1]! + cuts[index]!) / 2;
              const outer = strings.filter((entry) => entry.odIn > hostItem.odIn && entry.topM <= mid && entry.bottomM >= mid).sort((a, b) => a.odIn - b.odIn)[0];
              const outerR = outer ? R(outer.idIn ?? outer.odIn * 0.92) - 0.005 : R(hostItem.odIn * 1.28);
              group.add(shell(R(hostItem.odIn) + 0.005, outerR, y(cuts[index - 1]!), y(cuts[index]!), new THREE.MeshStandardMaterial({ color: 0xb7bab2, roughness: 0.96, metalness: 0, side: THREE.DoubleSide })));
            }
          }
        } else if (spec.asset.model && spec.slot !== "surface") {
          const url = assetUrl(assetBaseUrl, spec.asset.model);
          loadModel(url).then((source) => {
            if (build !== token) return;
            const model = source.clone(true);
            model.traverse((child) => { if (child instanceof THREE.Mesh) child.material = (child.material as THREE.Material).clone(); });
            const box = new THREE.Box3().setFromObject(model);
            const height = Math.max(box.max.y - box.min.y, 1e-3);
            const scale = R(item.odIn);
            const interval = y(item.topM) - y(item.bottomM);
            const stretch = (spec.slot === "sandface" || spec.slot === "plug") && interval > 0.3;
            const squash = Math.min(1, 2.2 / (height * scale));
            model.scale.set(scale, stretch ? interval / height : scale * Math.max(squash, 0.35), scale);
            const mid = y((item.topM + item.bottomM) / 2);
            model.position.y = mid - (box.max.y + box.min.y) / 2 * model.scale.y;
            model.rotation.y = THREE.MathUtils.degToRad(-32);
            group.add(tag(model, item.id));
            highlight(latest.current.selectedId);
            sectionDirty = true;
            setLoaded((count) => count + 1);
          }, () => setFailure(`Could not load ${spec.label} model from ${url}.`));
        }
        world.add(tag(group, item.id));
      }
      stackSurface(items, build);
      layout(value, false);
      highlight(latest.current.selectedId);
      sectionDirty = true;
      if (latest.current.isolated) isolate(latest.current.selectedId, false);
    }

    /** Surface kit stacks bottom-up by catalog `stackOrder`, each level resting on the measured top of the one below. */
    function stackSurface(items: readonly AssemblyItem[], build: number) {
      const surface = items.filter((item) => getCatalogEntry(item.catalogId).slot === "surface" && getCatalogEntry(item.catalogId).asset.model).sort((a, b) => (getCatalogEntry(a.catalogId).stackOrder ?? 9) - (getCatalogEntry(b.catalogId).stackOrder ?? 9) || b.odIn - a.odIn);
      if (!surface.length) return;
      const base = items.find((item) => item.catalogId === "wellhead") ?? surface[0]!;
      const scale = R(base.odIn) / 1.55;
      Promise.all(surface.map((item) => loadModel(assetUrl(assetBaseUrl, getCatalogEntry(item.catalogId).asset.model!)))).then((sources) => {
        if (build !== token) return;
        let floor = 0;
        let level = -1;
        let levelFloor = 0;
        surface.forEach((item, index) => {
          const spec = getCatalogEntry(item.catalogId);
          const model = sources[index]!.clone(true);
          model.traverse((child) => { if (child instanceof THREE.Mesh) child.material = (child.material as THREE.Material).clone(); });
          const box = new THREE.Box3().setFromObject(model);
          const nested = spec.stackOrder === level;
          const own = nested ? scale * 0.55 : scale;
          model.scale.setScalar(own);
          if (!nested) { level = spec.stackOrder ?? 9; levelFloor = floor; }
          const seat = nested ? levelFloor + (floor - levelFloor) * 0.55 : floor;
          model.position.y = seat - box.min.y * own;
          if (!nested) floor = seat + (box.max.y - box.min.y) * own;
          world.getObjectByName(item.id)?.add(tag(model, item.id));
        });
        highlight(latest.current.selectedId);
        sectionDirty = true;
        setLoaded((count) => count + surface.length);
      }, () => setFailure("Could not load the surface stack models."));
    }

    let isolatedId: string | null = null;
    function applyVisibility() {
      for (const child of world.children) child.visible = isolatedId ? child.name === isolatedId : !(explodedNow && child.userData.context);
      context.visible = !isolatedId && !explodedNow;
      ladder.visible = !isolatedId && explodedNow;
    }

    /** Columns read outside-in: each string followed by its cement, then tubing, then tool strings; surface kit on the left. */
    function layout(value: WellAssembly, animate: boolean) {
      const slotOf = (item: AssemblyItem) => getCatalogEntry(item.catalogId).slot;
      const columns: { ids: string[]; radius: number; label: string }[] = [];
      const surface = value.items.filter((item) => slotOf(item) === "surface");
      if (surface.length) columns.push({ ids: surface.map((item) => item.id), radius: R(Math.max(...surface.map((item) => item.odIn))) * 1.1, label: "Surface" });
      for (const string of value.items.filter((item) => ["casing", "liner"].includes(slotOf(item))).sort((a, b) => b.odIn - a.odIn)) {
        columns.push({ ids: [string.id], radius: R(string.odIn) + 0.2, label: string.label });
        for (const cement of value.items.filter((item) => slotOf(item) === "cement" && item.hostId === string.id)) columns.push({ ids: [cement.id], radius: R(string.odIn * 1.28) + 0.1, label: cement.label });
      }
      for (const cement of value.items.filter((item) => slotOf(item) === "cement" && !columns.some((column) => column.ids.includes(item.id)))) columns.push({ ids: [cement.id], radius: R(cement.odIn * 1.28), label: cement.label });
      for (const tubing of value.items.filter((item) => slotOf(item) === "tubing")) columns.push({ ids: [tubing.id], radius: R(tubing.odIn) + 0.2, label: tubing.label });
      for (const [slotName, label] of [["tubing-tool", "Tubing tools"], ["casing-tool", "Casing tools"], ["sandface", "Sandface"], ["plug", "Plugs"]] as const) {
        const tools = value.items.filter((item) => slotOf(item) === slotName);
        if (tools.length) columns.push({ ids: tools.map((item) => item.id), radius: R(Math.max(...tools.map((item) => item.odIn))) + 0.3, label: `${label} · ${tools.length}` });
      }
      const gap = 1.6;
      let cursor = 0;
      const centres = columns.map((column) => { const x = cursor + column.radius; cursor += column.radius * 2 + gap; return x; });
      const shift = (cursor - gap) / 2;
      const targets = new Map<string, number>();
      columns.forEach((column, index) => column.ids.forEach((id) => targets.set(id, explodedNow ? centres[index]! - shift : 0)));
      for (const child of world.children) {
        const target = targets.get(child.name) ?? 0;
        child.userData.targetX = target;
        if (!animate) child.position.x = target;
      }
      animating = animate;
      disposeTree(ladder);
      applyVisibility();
      if (!explodedNow || !columns.length) return;
      const left = -shift - 1.2;
      const right = cursor - gap - shift + 1.2;
      const step = [100, 200, 250, 500, 1000, 2000].find((size) => td / size <= 9) ?? 5000;
      for (let md = 0; md <= td + 1e-6; md += step) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(left, y(md), 0), new THREE.Vector3(right, y(md), 0)]), new THREE.LineBasicMaterial({ color: 0x9aa59f, transparent: true, opacity: 0.6 }));
        const label = depthLabel(md === 0 ? "0 m" : `${md.toLocaleString("en-US")} m`, labelInk(), labelHalo());
        label.position.set(left - 2.1, y(md), 0);
        ladder.add(line, label);
      }
      columns.forEach((column, index) => {
        if (column.label === "Surface") return;
        const label = tagSprite(column.label, "rgba(255,255,255,0.94)", "#20322a");
        const material = label.material;
        material.sizeAttenuation = true;
        const aspect = label.scale.x / label.scale.y;
        const pitch = Math.min(centres[index]! - (centres[index - 1] ?? -Infinity), (centres[index + 1] ?? Infinity) - centres[index]!);
        const width = Math.min(aspect * 1.5, pitch * 1.9);
        label.scale.set(width, width / aspect, 1);
        label.center.set(0.5, 0);
        label.position.set(centres[index]! - shift, 0.9 + (index % 2) * 1.85, 0);
        ladder.add(label);
      });
    }

    function explode(on: boolean, animate = true) {
      explodedNow = on;
      element!.dataset.exploded = String(on);
      layout(latest.current.assembly, animate);
      fitAfter = true;
      if (!animate) { fitAfter = false; fit(latest.current.isolated ? latest.current.selectedId : null); }
    }

    function isolate(id: string | null, refit = true) {
      isolatedId = id;
      applyVisibility();
      element!.dataset.isolated = String(Boolean(id));
      if (refit) fit(id);
      highlight(latest.current.selectedId);
    }

    function frameSelection(id: string | null) {
      disposeTree(selection);
      selection.position.x = 0;
      selection.userData.anchors = null;
      nameTag.hidden = true;
      const target = id ? world.getObjectByName(id) : undefined;
      selection.userData.target = target;
      selection.userData.anchorX = target?.position.x ?? 0;
      if (!target || !target.visible) return;
      world.updateMatrixWorld(true);
      const box = new THREE.Box3();
      target.traverse((child) => { if (child instanceof THREE.Mesh) box.expandByObject(child); });
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      const radius = Math.max(size.x, size.z) / 2 + 0.28;
      const tone = selectTone();
      for (const level of [box.max.y, box.min.y]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, Math.max(0.045, radius * 0.035), 10, 72), new THREE.MeshBasicMaterial({ color: tone, depthTest: false, transparent: true }));
        ring.rotation.x = Math.PI / 2;
        ring.position.set(centre.x, level, centre.z);
        ring.renderOrder = 15;
        selection.add(ring);
      }
      const item = latest.current.assembly.items.find((entry) => entry.id === id);
      if (item) {
        nameTag.textContent = item.label;
        const y = Math.min(box.max.y, Math.max(box.min.y, centre.y));
        selection.userData.anchors = [new THREE.Vector3(centre.x - radius, y, centre.z), new THREE.Vector3(centre.x + radius, y, centre.z)];
      }
    }

    function highlight(id: string | null) {
      const tone = selectTone();
      const present = id !== null && Boolean(world.getObjectByName(id));
      world.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const value = child.material as THREE.MeshStandardMaterial;
        const base = (child.userData.base ??= { opacity: value.opacity, transparent: value.transparent, depthWrite: value.depthWrite }) as { opacity: number; transparent: boolean; depthWrite: boolean };
        const active = present && child.userData.itemId === id;
        const dim = present && !active;
        if ("emissive" in value) {
          value.emissive.copy(active ? tone : new THREE.Color(0x000000));
          value.emissiveIntensity = active ? 0.9 : 0;
        }
        value.transparent = dim || base.transparent;
        value.opacity = dim ? base.opacity * 0.14 : base.opacity;
        value.depthWrite = dim ? false : base.depthWrite;
        value.needsUpdate = true;
      });
      element!.dataset.selected = present ? id! : "";
      frameSelection(present ? id : null);
    }

    function fit(id?: string | null) {
      world.updateMatrixWorld(true);
      const box = new THREE.Box3();
      if (id) world.getObjectByName(id)?.traverse((child) => { if (child instanceof THREE.Mesh) box.expandByObject(child); });
      if (box.isEmpty()) { world.children.forEach((child) => { if (child.visible) box.expandByObject(child); }); box.expandByPoint(new THREE.Vector3(0, y(td), 0)).expandByPoint(new THREE.Vector3(0, explodedNow ? 3.4 : 2, 0)); }
      const center = box.getCenter(new THREE.Vector3());
      const minimum = id ? 7 : 4;
      // A three-quarter view rather than a near-side-on one. Looking at a vertical object from
      // almost square on is what makes a 3D scene read as a 2D stick: there is no foreshortening
      // anywhere, so nothing tells the eye it has depth.
      const direction = new THREE.Vector3(0.92, 0.34, 1).normalize();

      /**
       * Fit the box as the camera will actually see it.
       *
       * The old fit measured the world-axis extents and assumed the camera looked down -Z, which
       * is true only for a front-on view. Tilting the camera made the projected height larger than
       * `size.y` and the wellhead went off the top of the frame. Measuring the corners in the
       * camera's own basis is exact from any direction, and it is what lets the padding come down
       * to a few percent without risking a crop.
       */
      const forward = direction.clone().negate();
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forward).normalize();
      const up = new THREE.Vector3().crossVectors(forward, right).normalize();
      let halfWidth = 0, halfHeight = 0, halfDepth = 0;
      for (const cx of [box.min.x, box.max.x]) for (const cy of [box.min.y, box.max.y]) for (const cz of [box.min.z, box.max.z]) {
        const offset = new THREE.Vector3(cx, cy, cz).sub(center);
        halfWidth = Math.max(halfWidth, Math.abs(offset.dot(right)));
        halfHeight = Math.max(halfHeight, Math.abs(offset.dot(up)));
        halfDepth = Math.max(halfDepth, Math.abs(offset.dot(forward)));
      }
      halfHeight = Math.max(halfHeight, minimum / 2);
      halfWidth = Math.max(halfWidth, minimum / 2);
      const vertical = THREE.MathUtils.degToRad(camera.fov) / 2;
      const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
      const distance = Math.max(halfHeight / Math.tan(vertical), halfWidth / Math.tan(horizontal)) * 1.06 + halfDepth;
      controls.target.copy(center);
      camera.position.copy(center).addScaledVector(direction, distance);
      camera.near = Math.max(0.02, distance / 500);
      camera.far = distance * 20;
      camera.updateProjectionMatrix();
      controls.update();
      element!.dataset.camera = `${camera.position.toArray().map((value) => value.toFixed(2)).join(",")}|${controls.target.toArray().map((value) => value.toFixed(2)).join(",")}`;
    }

    const raycaster = new THREE.Raycaster();
    function ndc(clientX: number, clientY: number) {
      const rect = renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    }
    function depthAt(clientX: number, clientY: number) {
      raycaster.setFromCamera(ndc(clientX, clientY), camera);
      const facing = camera.getWorldDirection(new THREE.Vector3()).setY(0);
      if (facing.lengthSq() < 1e-6) facing.set(0, 0, -1);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(facing.normalize(), new THREE.Vector3());
      const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      const md = hit ? -hit.y / SCENE_H * td : 0;
      return Math.round(Math.min(Math.max(md, 0), td));
    }
    function pick(clientX: number, clientY: number) {
      raycaster.setFromCamera(ndc(clientX, clientY), camera);
      const shown = (object: THREE.Object3D | null): boolean => !object || (object.visible && shown(object.parent));
      return raycaster.intersectObject(world, true).find((hit) => hit.object.userData.itemId && shown(hit.object))?.object.userData.itemId as string | undefined ?? null;
    }
    function marker(depth: number | null, valid = true) {
      markerRing.visible = depth !== null;
      if (depth === null) return;
      const radius = Math.max(R(20), ...latest.current.assembly.items.map((item) => R(item.odIn))) + 0.4;
      markerRing.scale.setScalar(radius);
      markerRing.position.y = y(depth);
      (markerRing.material as THREE.MeshBasicMaterial).color.setHex(valid ? 0x235faa : 0xc0392b);
    }
    api.current = { rebuild, highlight, fit, depthAt, marker, pick, setControls: (enabled) => { controls.enabled = enabled; }, explode, isolate: (id) => isolate(id), section: (state) => section.set(state), look: (view) => cube.look(view) };

    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    explodedNow = latest.current.exploded;
    element.dataset.exploded = String(explodedNow);
    rebuild(latest.current.assembly);
    fit();
    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      if (animating) {
        let settled = true;
        for (const child of world.children) {
          const target = (child.userData.targetX as number | undefined) ?? 0;
          const next = THREE.MathUtils.lerp(child.position.x, target, 0.16);
          child.position.x = Math.abs(next - target) < 0.01 ? target : next;
          if (child.position.x !== target) settled = false;
        }
        const followed = selection.userData.target as THREE.Object3D | undefined;
        if (followed) selection.position.x = followed.position.x - (selection.userData.anchorX as number);
        if (settled) {
          animating = false;
          if (fitAfter) { fitAfter = false; fit(latest.current.isolated ? latest.current.selectedId : null); }
        }
      }
      if (sectionDirty) { sectionDirty = false; section.refresh(); }
      cube.update();
      if (!cube.swinging) controls.update();
      if (!started.draws()) return;
      if (occlusion) occlusion.render(); else renderer.render(scene, camera);
      placeTag();
    };
    loop();
    controls.addEventListener("end", () => { element.dataset.camera = `${camera.position.toArray().map((value) => value.toFixed(2)).join(",")}|${controls.target.toArray().map((value) => value.toFixed(2)).join(",")}`; });
    // Ambient occlusion gives the parts their crevices back; if the device cannot run it, the plain pass stands.
    let occlusion: AmbientOcclusion | null = null;
    started.ready.then((backend) => {
      scene.environment = started.environment();
      try { occlusion = new AmbientOcclusion(renderer, scene, camera, { radius: 0.5 }); } catch { occlusion = null; }
      element.dataset.backend = backend;
      setReady(true);
    }, (cause) => setFailure(`3D could not start (${cause instanceof Error ? cause.message : String(cause)}); the schematic remains fully editable.`));
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      cube.dispose();
      section.dispose();
      controls.dispose();
      occlusion?.dispose();
      started.dispose();
      renderer.domElement.remove();
      nameTag.remove();
      api.current = null;
    };
  }, [assetBaseUrl]);

  useEffect(() => { api.current?.rebuild(assembly); }, [assembly]);
  useEffect(() => { api.current?.section(section); }, [section, ready]);
  useEffect(() => { api.current?.highlight(selectedId); }, [selectedId, loaded]);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } api.current?.explode(exploded); }, [exploded]);
  useEffect(() => { if (!selectedId && isolated) setIsolated(false); }, [selectedId, isolated]);
  const wasIsolated = useRef(false);
  useEffect(() => {
    if (isolated) api.current?.isolate(selectedId);
    else if (wasIsolated.current) api.current?.isolate(null);
    wasIsolated.current = isolated;
  }, [isolated, selectedId]);
  const toggleExploded = () => { const next = !exploded; if (explodedProp === undefined) setExplodedState(next); onExplodedChange?.(next); };

  const gesture = useRef<{ x: number; y: number; id: string | null; dragging: boolean; pointer: number } | null>(null);

  function preview(catalogId: string, depth: number) {
    try { return { text: placeComponent(assembly, catalogId, depth).note, valid: true }; } catch (error) { return { text: error instanceof Error ? error.message : String(error), valid: false }; }
  }

  function local(event: { clientX: number; clientY: number }) {
    const rect = host.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  const dropProps = onDropComponent ? {
    onDragOver(event: ReactDragEvent<HTMLDivElement>) {
      const catalogId = catalogIdFromDrag(event);
      if (!catalogId || !api.current) return;
      event.preventDefault();
      const depth = api.current.depthAt(event.clientX, event.clientY);
      const result = preview(catalogId, depth);
      event.dataTransfer.dropEffect = "copy";
      api.current.marker(depth, result.valid);
      setHint({ ...local(event), text: `${formatDepth(depth)} · ${result.text}`, valid: result.valid });
    },
    onDragLeave(event: ReactDragEvent<HTMLDivElement>) {
      if (host.current?.contains(event.relatedTarget as Node | null)) return;
      api.current?.marker(null);
      setHint(null);
    },
    onDrop(event: ReactDragEvent<HTMLDivElement>) {
      const catalogId = catalogIdFromDrag(event);
      api.current?.marker(null);
      setHint(null);
      if (!catalogId || !api.current) return;
      event.preventDefault();
      onDropComponent(catalogId, api.current.depthAt(event.clientX, event.clientY));
    },
  } : {};

  return <section className="sw-asm-scene" aria-label={title}>
    <header className="sw-asm-panel-head">
      <div className="sw-title"><h2>{title}</h2><InfoTip label="About this 3D view">Blender-modelled components shown {exploded ? "exploded on a shared depth scale" : "as a cutaway"}. Depth is compressed and diameters are exaggerated so every string stays visible.</InfoTip></div>
      <div className="sw-asm-tools" role="toolbar" aria-label="3D view">
        <CommandButton type="button" className="sw-asm-mode" aria-pressed={exploded} aria-label="Exploded view" title="Pull every string, cement sheath and tool apart on a shared depth scale" onClick={toggleExploded}><Boxes size={15} /><span>Exploded</span></CommandButton>
        <CommandButton type="button" className="sw-asm-mode" aria-pressed={isolated} aria-label="Isolate selected component" title="Show only the selected component" disabled={!selectedId} onClick={() => setIsolated((value) => !value)}><Focus size={15} /><span>Isolate</span></CommandButton>
        <CommandButton type="button" aria-label="Focus selected component" disabled={!selectedId} onClick={() => api.current?.fit(selectedId)}><Crosshair size={15} /></CommandButton>
        <CommandButton type="button" aria-label="Fit whole assembly" onClick={() => api.current?.fit()}><Maximize size={15} /></CommandButton>
      </div>
    </header>
    <div ref={host} className="sw-asm-canvas" data-testid="assembly-scene" data-ready={ready} data-models-loaded={loaded} data-item-count={assembly.items.length}
      role="application" aria-roledescription="3D assembly view" aria-label={`${title}: ${assembly.items.length} components. Drag to orbit, scroll to zoom toward the pointer, click to select${onMoveComponent ? ", drag a selected component to move it" : ""}.`}
      onPointerDown={(event) => {
        if (!api.current || event.button !== 0) return;
        const id = api.current.pick(event.clientX, event.clientY);
        const movable = Boolean(id && id === latest.current.selectedId && onMoveComponent && getCatalogEntry(assembly.items.find((item) => item.id === id)?.catalogId ?? "wellhead").slot !== "surface");
        gesture.current = { x: event.clientX, y: event.clientY, id, dragging: false, pointer: event.pointerId };
        if (movable) { api.current.setControls(false); event.currentTarget.setPointerCapture(event.pointerId); gesture.current.dragging = true; }
      }}
      onPointerMove={(event) => {
        const current = gesture.current;
        if (!current?.dragging || !current.id || !api.current) return;
        const depth = api.current.depthAt(event.clientX, event.clientY);
        try {
          const moved = moveComponent(assembly, current.id, depth).items.find((item) => item.id === current.id)!;
          api.current.marker(depth, true);
          setHint({ ...local(event), text: `${moved.label}: ${formatDepth(moved.topM)} → ${formatDepth(moved.bottomM)}`, valid: true });
        } catch (error) {
          api.current.marker(depth, false);
          setHint({ ...local(event), text: error instanceof Error ? error.message : String(error), valid: false });
        }
      }}
      onPointerUp={(event) => {
        const current = gesture.current;
        gesture.current = null;
        api.current?.setControls(true);
        api.current?.marker(null);
        setHint(null);
        if (!current || !api.current) return;
        const travelled = Math.hypot(event.clientX - current.x, event.clientY - current.y);
        if (current.dragging && current.id && travelled > 4) onMoveComponent?.(current.id, api.current.depthAt(event.clientX, event.clientY));
        else if (travelled <= 4) onSelect?.(current.id);
      }}
      {...dropProps}>
      <SceneSectionControl state={section} onChange={setSection} axes={{ x: "Side", z: "Front", y: "Depth" }} />
      <SceneViewKeys labels={MODEL_FACES} onView={(view) => api.current?.look(view)} />
      {hint && <div className={`sw-asm-scene-hint${hint.valid ? "" : " is-invalid"}`} style={{ left: hint.x, top: hint.y }} role="status">{hint.text}</div>}
      {failure && <p className="sw-asm-scene-failure" role="status">{failure}</p>}
    </div>
  </section>;
}

export default AssemblyScene;
