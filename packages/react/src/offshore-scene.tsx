"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import * as THREE from "three";
import { seabedDepthAt } from "./offshore-environment.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { GeographicGisModel } from "@ikhmalputra/subsurface-core/gis";
import { CommandButton } from "./ui.js";

export interface OffshoreSceneProps {
  readonly model: GeographicGisModel;
  /** Projected metre coordinates of the local scene origin, in the wells' shared CRS. */
  readonly origin: readonly [number, number];
  /** Sea-surface-to-seabed depth in metres at each wellhead. */
  readonly waterDepthsM: Readonly<Record<string, number>>;
  readonly selectedWellId: string | null;
  readonly onSelectWell: (id: string) => void;
}

export function OffshoreScene({ model, origin, waterDepthsM, selectedWellId, onSelectWell }: OffshoreSceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const focus = useRef<(id: string | null) => void>(() => undefined);
  const layers = useRef<(water: boolean, seabed: boolean) => void>(() => undefined);
  const zoom = useRef<(factor: number) => void>(() => undefined);
  const orbit = useRef<(angle: number) => void>(() => undefined);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [water, setWater] = useState(true);
  const [seabed, setSeabed] = useState(true);
  const [camera, setCamera] = useState("");
  const [flying, setFlying] = useState(false);
  const select = useEffectEvent((id: string) => onSelectWell(id));

  useEffect(() => {
    if (!host.current) return;
    const element = host.current;
    let renderer: THREE.WebGLRenderer;
    try {
      const crs = model.wells[0]!.well.crs;
      if (!origin.every(Number.isFinite)) throw new TypeError("Offshore scene origin must contain finite projected metre coordinates.");
      if (model.wells.some(({ well }) => well.crs !== crs || !Number.isFinite(waterDepthsM[well.id]) || waterDepthsM[well.id]! <= 0)) throw new TypeError("Offshore wells require one shared projected CRS and positive water depths.");
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch (cause) {
      setError(`Offshore 3D could not start: ${cause instanceof Error ? cause.message : String(cause)}`);
      return;
    }
    setError(null);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor("#071a2d");
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2("#071a2d", 0.000065);
    const view = new THREE.PerspectiveCamera(48, 1, 5, 60000);
    const controls = new OrbitControls(view, renderer.domElement);
    controls.maxDistance = 24000; controls.minDistance = 120;
    controls.maxPolarAngle = Math.PI * 0.9;
    controls.enableDamping = true;
    scene.add(new THREE.AmbientLight("#b5deff", 2));
    const light = new THREE.DirectionalLight("#ffffff", 3);
    light.position.set(-3000, 6000, 2000); scene.add(light);
    const point = (xyz: readonly number[], id: string) => new THREE.Vector3(xyz[0]! - origin[0], -waterDepthsM[id]! - xyz[2]!, -(xyz[1]! - origin[1]));
    const objects: THREE.Mesh[] = [];
    const heads = new Map<string, THREE.Vector3>();
    const targets = new Map<string, THREE.Sphere>();
    const materials = new Map<string, THREE.MeshStandardMaterial>();
    const colors = ["#39d8c3", "#ffbf69", "#83b8ff", "#ff82ad"];
    const extent = 6000;
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(extent * 2, extent * 2, 40, 40), new THREE.MeshStandardMaterial({ color: "#2589bb", transparent: true, opacity: 0.19, side: THREE.DoubleSide, depthWrite: false, roughness: 0.25 }));
    sea.rotation.x = -Math.PI / 2; sea.renderOrder = 2; scene.add(sea);
    const floorGeometry = new THREE.PlaneGeometry(extent * 2, extent * 2, 70, 70);
    floorGeometry.rotateX(-Math.PI / 2);
    const positions = floorGeometry.attributes.position!;
    const anchors = model.wells.map(({ well, stations }) => ({ x: stations[0]!.xyz[0] - origin[0], y: -(stations[0]!.xyz[1] - origin[1]), depthM: waterDepthsM[well.id]! }));
    const floorDepth = (x: number, z: number) => seabedDepthAt(anchors, x, z);
    for (let i = 0; i < positions.count; i++) positions.setY(i, -floorDepth(positions.getX(i), positions.getZ(i)));
    floorGeometry.computeVertexNormals();
    const floor = new THREE.Mesh(floorGeometry, new THREE.MeshStandardMaterial({ color: "#426c76", transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, roughness: 1 }));
    floor.renderOrder = 1; scene.add(floor);
    const grid = new THREE.GridHelper(extent * 2, 24, "#74b8d1", "#295b78"); grid.position.y = 2;
    scene.add(grid);
    function label(text: string, position: THREE.Vector3, color: string) {
      const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 80;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Offshore labels require a 2D canvas context.");
      context.fillStyle = "#071a2de6"; context.fillRect(0, 0, 512, 80);
      context.fillStyle = color; context.font = "600 27px sans-serif"; context.fillText(text, 14, 49);
      const texture = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, sizeAttenuation: false, fog: false }));
      sprite.position.copy(position); sprite.scale.set(0.16, 0.025, 1); sprite.renderOrder = 5; scene.add(sprite);
    }
    label("SEA SURFACE / 0 m", new THREE.Vector3(-4200, 150, -4000), "#b7e6ff");
    label("N / GRID NORTH", new THREE.Vector3(0, 100, -5500), "#b7e6ff");
    for (const [index, { well, stations }] of model.wells.entries()) {
      const color = colors[index % colors.length]!;
      const head = point(stations[0]!.xyz, well.id); heads.set(well.id, head);
      const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.12 });
      materials.set(well.id, material);
      const path = new THREE.CatmullRomCurve3(stations.map((station) => point(station.xyz, well.id)), false, "centripetal");
      targets.set(well.id, new THREE.Box3().setFromPoints(path.points).getBoundingSphere(new THREE.Sphere()));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(path, stations.length * 2, 24, 8, false), material);
      tube.userData.wellId = well.id; objects.push(tube); scene.add(tube);
      const headMesh = new THREE.Mesh(new THREE.CylinderGeometry(70, 95, 100, 16), material);
      headMesh.position.copy(head); headMesh.userData.wellId = well.id; objects.push(headMesh); scene.add(headMesh);
      const surface = new THREE.Vector3(head.x, 70, head.z);
      const marker = new THREE.Mesh(new THREE.SphereGeometry(65, 16, 12), material);
      marker.position.copy(surface); marker.userData.wellId = well.id; objects.push(marker); scene.add(marker);
      const riser = new THREE.Line(new THREE.BufferGeometry().setFromPoints([surface, head]), new THREE.LineDashedMaterial({ color, dashSize: 60, gapSize: 35 }));
      riser.computeLineDistances(); scene.add(riser);
      label(well.label, surface.clone().add(new THREE.Vector3(0, 180, 0)), color);
      label(`${waterDepthsM[well.id]!.toFixed(0)} m WATER`, head.clone().add(new THREE.Vector3(350, 0, 0)), color);
    }
    let animation = 0, transition: { start: number; from: THREE.Vector3; to: THREE.Vector3; targetFrom: THREE.Vector3; targetTo: THREE.Vector3 } | null = null;
    function report() { setCamera(`${view.position.x.toFixed(0)}, ${view.position.y.toFixed(0)}, ${view.position.z.toFixed(0)}`); }
    focus.current = (id) => {
      const head = id ? heads.get(id) : null;
      const bounds = id ? targets.get(id) : null;
      const targetTo = bounds ? bounds.center.clone() : new THREE.Vector3(0, -1600, 0);
      const distance = bounds ? Math.max(1200, bounds.radius / Math.sin(THREE.MathUtils.degToRad(view.fov / 2)) / Math.min(1, view.aspect)) : 0;
      const to = head ? targetTo.clone().add(new THREE.Vector3(0.65, 0.15, 0.85).normalize().multiplyScalar(distance * 1.15)) : new THREE.Vector3(8500, 7000, 9500);
      for (const [wellId, material] of materials) material.emissiveIntensity = wellId === id ? 0.9 : 0.12;
      transition = { start: performance.now(), from: view.position.clone(), to, targetFrom: controls.target.clone(), targetTo };
      setFlying(true);
    };
    layers.current = (showWater, showSeabed) => { sea.visible = showWater; grid.visible = showWater; floor.visible = showSeabed; };
    zoom.current = (factor) => { transition = null; setFlying(false); view.position.sub(controls.target).multiplyScalar(factor).add(controls.target); controls.update(); report(); };
    orbit.current = (angle) => {
      transition = null;
      setFlying(false);
      view.position.sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle).add(controls.target);
      controls.update(); report();
    };
    view.position.set(8500, 7000, 9500); controls.target.set(0, -1600, 0); controls.update(); report();
    const ray = new THREE.Raycaster();
    let down: readonly [number, number] | null = null;
    const pointerDown = (event: PointerEvent) => { down = [event.clientX, event.clientY]; };
    const pointerUp = (event: PointerEvent) => {
      if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) { down = null; return; }
      down = null;
      const box = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((event.clientX - box.left) / box.width * 2 - 1, -(event.clientY - box.top) / box.height * 2 + 1), view);
      const hit = ray.intersectObjects(objects)[0];
      if (!hit) {
        const candidates = objects.filter((object) => object.geometry instanceof THREE.SphereGeometry);
        const nearest = candidates.map((object) => ({ object, distance: ray.ray.distanceToPoint(object.position) })).filter((entry) => entry.distance < 180).sort((a, b) => a.distance - b.distance)[0];
        if (nearest) { const id = String(nearest.object.userData.wellId); focus.current(id); select(id); return; }
      }
      if (hit) { const id = String(hit.object.userData.wellId); focus.current(id); select(id); }
    };
    const cancelFlight = () => { transition = null; setFlying(false); };
    controls.addEventListener("start", cancelFlight);
    controls.addEventListener("end", report);
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    const resize = new ResizeObserver(() => {
      view.aspect = element.clientWidth / Math.max(1, element.clientHeight); view.updateProjectionMatrix();
      renderer.setSize(element.clientWidth, element.clientHeight);
    });
    resize.observe(element);
    renderer.domElement.setAttribute("aria-label", "Continuous offshore 3D scene. Orbit and zoom with the pointer; select wells and use camera buttons for keyboard access.");
    function render(now: number) {
      if (transition) {
        const t = matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : Math.min(1, (now - transition.start) / 1100), eased = t * t * (3 - 2 * t);
        view.position.lerpVectors(transition.from, transition.to, eased);
        controls.target.lerpVectors(transition.targetFrom, transition.targetTo, eased);
        if (t === 1) { transition = null; setFlying(false); report(); }
      }
      controls.update(); renderer.render(scene, view); animation = requestAnimationFrame(render);
    }
    animation = requestAnimationFrame(render); setReady(true);
    return () => {
      cancelAnimationFrame(animation); resize.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", pointerDown); renderer.domElement.removeEventListener("pointerup", pointerUp);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite) {
          if (!(object instanceof THREE.Sprite)) object.geometry.dispose();
          const list = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of list) { if ("map" in material && material.map instanceof THREE.Texture) material.map.dispose(); material.dispose(); }
        }
      });
      renderer.dispose(); renderer.domElement.remove(); focus.current = () => undefined; layers.current = () => undefined; zoom.current = () => undefined; orbit.current = () => undefined;
    };
  }, [model, origin, waterDepthsM]);

  useEffect(() => { if (ready) focus.current(selectedWellId); }, [selectedWellId, ready]);
  useEffect(() => { if (ready) layers.current(water, seabed); }, [water, seabed, ready]);
  return <section className="sw-offshore" data-testid="offshore-scene" data-ready={ready} data-flying={flying} data-selected-well={selectedWellId ?? ""} data-camera={camera} aria-label="Continuous offshore field scene">
    <div className="sw-offshore-tools">
      <CommandButton icon="fit" onClick={() => focus.current(null)}>Surface overview</CommandButton>
      <CommandButton icon="focus" disabled={!selectedWellId} onClick={() => focus.current(selectedWellId)}>Dive to selected well</CommandButton>
      <CommandButton icon="zoomIn" onClick={() => zoom.current(0.8)}>Zoom in</CommandButton><CommandButton icon="zoomOut" onClick={() => zoom.current(1.25)}>Zoom out</CommandButton>
      <CommandButton icon="previous" onClick={() => orbit.current(Math.PI / 8)}>Orbit left</CommandButton><CommandButton icon="next" onClick={() => orbit.current(-Math.PI / 8)}>Orbit right</CommandButton>
      <label><input type="checkbox" checked={water} onChange={(event) => setWater(event.target.checked)} />Sea surface</label>
      <label><input type="checkbox" checked={seabed} onChange={(event) => setSeabed(event.target.checked)} />Illustrative seabed</label>
    </div>
    {error && <p role="alert">{error}</p>}
    <div ref={host} className="sw-offshore-canvas" />
    <div className="sw-offshore-wells" role="group" aria-label="Select offshore well">{model.wells.map(({ well }) => <CommandButton kind="selection" key={well.id} aria-pressed={selectedWellId === well.id} onClick={() => { focus.current(well.id); onSelectWell(well.id); }}>{well.label}</CommandButton>)}</div>
    <p className="sw-offshore-caption">Synthetic near-equatorial field · projected metres · 500 m surface grid · north = −scene Z · tube diameters exaggerated for visibility · dashed lines = illustrative surface ties, not reported risers · seabed interpolated from illustrative wellhead water depths</p>
    <output className="sw-sr-only" aria-live="polite">Camera east / elevation / south: {camera} metres</output>
  </section>;
}
