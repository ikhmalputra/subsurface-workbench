import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { computeMinimumCurvature, surveyPointAtMd } from "@ikhmalputra/subsurface-core/trajectory";
import type { SurveyPoint } from "@ikhmalputra/subsurface-core";
import { mdAtTvd } from "@ikhmalputra/subsurface-core/well-design";
import type { DrillingSimulator } from "@ikhmalputra/subsurface-core/simulation";

/**
 * The hole in 3D, along the well's real path: the survey (minimum curvature) puts every metre of
 * hole where the plan says it goes, so a build, a tangent or a turn is seen as it is. Casing set,
 * the open hole growing as the bit cuts, the string turning, mud down the string and up the
 * annulus carrying cuttings, gas rising and swelling, losses into the rock, the rams closing, kill
 * mud filling the well: the same readings as the 2D view, on the true trajectory. Diameters are
 * exaggerated 40× so the hole can be seen at all against a well kilometres long; positions are to
 * scale (east, north, TVD below the rig floor).
 */

const K = 40 * 0.0254 / 2; // metres of radius drawn per inch of diameter
const LITHOLOGY: readonly [RegExp, number][] = [[/granite|basement|igneous/i, 0x8f7f88], [/lime|carbonate|dolom|chalk/i, 0x6f93a8], [/sand/i, 0xb08d4f], [/clay|unconsolidated/i, 0x7a5c46], [/shale|mud/i, 0x55657a]];
const lithologyColour = (lithology: string) => LITHOLOGY.find(([pattern]) => pattern.test(lithology))?.[1] ?? 0x5f6675;
const MUD = new THREE.Color(0xd6c4a0), CUTTING = new THREE.Color(0xb08d4f), KILL = new THREE.Color(0xf2b45c);

interface Frame { readonly p: THREE.Vector3; readonly t: THREE.Vector3; readonly n: THREE.Vector3; readonly b: THREE.Vector3 }

const GPM_TO_M3S = 6.309e-5, IN = 0.0254, CUTTING_SLIP_MS = 0.12, GAS_SLIP_MS = 0.3;
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
/** A soft round sprite, so particles read as droplets and chips rather than squares. */
function roundSprite() {
  const c = document.createElement("canvas"); c.width = c.height = 32;
  const g = c.getContext("2d")!; const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)"); grad.addColorStop(0.6, "rgba(255,255,255,0.85)"); grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export function RigView3D({ simRef, running, rate }: { readonly simRef: RefObject<DrillingSimulator | null>; readonly running: boolean; readonly rate: number }) {
  const host = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const live = useRef({ running, follow, rate });
  live.current = { running, follow, rate };

  useEffect(() => {
    const element = host.current, sim0 = simRef.current;
    if (!element || !sim0) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x070a14);
    element.prepend(renderer.domElement);
    renderer.domElement.className = "rig3d-canvas";
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 1, 20000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    // A studio environment so steel reads as steel; fog so depth reads as depth.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.fog = new THREE.Fog(0x070a14, 600, 4200); // near and far follow the camera, below
    scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x1a1410, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(800, 1500, 600); scene.add(sun);

    // ---- the path: a frame every 2 m along the survey ----
    let sim = sim0;
    const disposables: { dispose(): void }[] = [];
    const group = new THREE.Group(); scene.add(group);
    let frames: Frame[] = [];
    const frameAt = (md: number): Frame => frames[Math.max(0, Math.min(frames.length - 1, Math.round(md / 2)))]!;
    const at = (md: number) => frameAt(md).p;
    const buildPath = () => {
      const brief = sim.brief;
      const stations: readonly SurveyPoint[] = brief.trajectory?.length ? computeMinimumCurvature(brief.trajectory) : [
        { mdM: 0, tvdM: 0, northingM: 0, eastingM: 0, inclinationDeg: 0, azimuthDeg: 0 }, { mdM: brief.totalDepthMdM + 100, tvdM: brief.totalDepthMdM + 100, northingM: 0, eastingM: 0, inclinationDeg: 0, azimuthDeg: 0 }];
      const end = Math.max(sim.targetMdM, brief.totalDepthMdM) + 60, last = stations.at(-1)!;
      frames = [];
      for (let md = 0; md <= end; md += 2) {
        const point = md <= last.mdM ? surveyPointAtMd(stations, md) : last;
        const inc = point.inclinationDeg * Math.PI / 180, az = point.azimuthDeg * Math.PI / 180;
        const beyond = Math.max(0, md - last.mdM);
        const p = new THREE.Vector3(point.eastingM + beyond * Math.sin(inc) * Math.sin(az), -(point.tvdM + beyond * Math.cos(inc)), -(point.northingM + beyond * Math.sin(inc) * Math.cos(az)));
        const t = new THREE.Vector3(Math.sin(inc) * Math.sin(az), -Math.cos(inc), -Math.sin(inc) * Math.cos(az)).normalize();
        const ref = Math.abs(t.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        const n = new THREE.Vector3().crossVectors(t, ref).normalize(), b = new THREE.Vector3().crossVectors(t, n).normalize();
        frames.push({ p, t, n, b });
      }
    };
    const curve = (from: number, to: number) => {
      const points: THREE.Vector3[] = [];
      for (let md = Math.max(0, from); md < to; md += 10) points.push(at(md).clone());
      points.push(at(to).clone());
      if (points.length < 2) points.push(at(to + 2).clone());
      return new THREE.CatmullRomCurve3(points);
    };
    const tube = (from: number, to: number, radius: number, material: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve(from, to), Math.max(4, Math.ceil((to - from) / 6)), radius, 20, false), material);
      group.add(mesh);
      return mesh;
    };
    const replace = (mesh: THREE.Mesh | null, next: () => THREE.Mesh) => { if (mesh) { group.remove(mesh); mesh.geometry.dispose(); } return next(); };

    // ---- materials ----
    // Casing and hole draw only their far wall (back faces): the near half is cut away, as in an engineering cutaway.
    const steel = new THREE.MeshStandardMaterial({ color: 0xb4bdcc, metalness: 0.85, roughness: 0.3, side: THREE.BackSide });
    const cement = new THREE.MeshStandardMaterial({ color: 0x9aa0ad, roughness: 0.9, transparent: true, opacity: 0.16, depthWrite: false });
    const openHole = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1, side: THREE.BackSide });
    const stripes = document.createElement("canvas"); stripes.width = 8; stripes.height = 64;
    const sctx = stripes.getContext("2d")!; sctx.fillStyle = "#8b96a9"; sctx.fillRect(0, 0, 8, 64); sctx.fillStyle = "#d8dfeb"; sctx.fillRect(0, 0, 8, 10); sctx.fillRect(0, 32, 8, 6);
    const stripeTexture = new THREE.CanvasTexture(stripes); stripeTexture.wrapS = stripeTexture.wrapT = THREE.RepeatWrapping;
    const pipe = new THREE.MeshStandardMaterial({ map: stripeTexture, metalness: 0.8, roughness: 0.32 });
    disposables.push(steel, cement, openHole, pipe, stripeTexture);

    // ---- what does not move: formations, sea, casing set, the rig ----
    const statics: THREE.Object3D[] = [];
    const discs: THREE.Object3D[] = [];
    const labels: { el: HTMLSpanElement; at: THREE.Vector3 }[] = [];
    const label = (text: string, position: THREE.Vector3, kind = "") => { const el = document.createElement("span"); el.className = `rig3d-label ${kind}`; el.textContent = text; element.appendChild(el); labels.push({ el, at: position }); return el; };
    const mudFill = new THREE.MeshStandardMaterial({ color: 0x6b5a45, roughness: 1, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
    const killFill = new THREE.MeshStandardMaterial({ color: 0xd08a3a, roughness: 0.9, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide });
    disposables.push(mudFill, killFill);
    let mudMesh: THREE.Mesh | null = null, killAnnulusMesh: THREE.Mesh | null = null, builtFront = -1;
    let holeMesh: THREE.Mesh | null = null, pipeMesh: THREE.Mesh | null = null, bhaMesh: THREE.Mesh | null = null, killMesh: THREE.Mesh | null = null;
    let builtHole = -1, builtBit = -1, builtKill = -1;
    const bit = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 18), new THREE.MeshStandardMaterial({ color: 0xe7ecf4, metalness: 0.8, roughness: 0.25 }));
    group.add(bit); disposables.push(bit.geometry, bit.material as THREE.Material);
    const rams = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x7c5a6a, roughness: 0.6 }));
    group.add(rams); disposables.push(rams.geometry, rams.material as THREE.Material);
    const block = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 6), new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.4, roughness: 0.5 }));
    group.add(block); disposables.push(block.geometry, block.material as THREE.Material);
    const bitLabel = label("", new THREE.Vector3(), "is-bit"), eventLabel = label("", new THREE.Vector3(), "is-event");


    const buildStatics = () => {
      for (const object of statics) { group.remove(object); if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) object.geometry.dispose(); }
      statics.length = 0; discs.length = 0;
      for (const l of labels.splice(2)) l.el.remove();
      const brief = sim.brief;
      const formations = [...brief.geology.formations].sort((a, b) => a.topTvdM - b.topTvdM);
      for (const f of formations) {
        const md = mdAtTvd(brief, f.topTvdM); if (md > sim.targetMdM + 400) continue;
        const centre = at(md);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(260, 48), new THREE.MeshStandardMaterial({ color: lithologyColour(f.lithology), transparent: true, opacity: f.reservoir ? 0.3 : 0.14, depthWrite: false, side: THREE.DoubleSide }));
        disc.rotation.x = -Math.PI / 2; disc.position.set(centre.x, centre.y, centre.z);
        group.add(disc); statics.push(disc); discs.push(disc); disposables.push(disc.material as THREE.Material);
        label(f.name, new THREE.Vector3(centre.x + 200, centre.y, centre.z), f.reservoir ? "is-reservoir" : "");
      }
      const elevation = brief.datum.elevationAboveMslM ?? 0, water = brief.location.waterDepthM ?? 0;
      if (water > 0) {
        const sea = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshStandardMaterial({ color: 0x1e4b74, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
        sea.rotation.x = -Math.PI / 2; sea.position.y = -elevation; group.add(sea); statics.push(sea); disposables.push(sea.material as THREE.Material);
        const seabed = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshStandardMaterial({ color: 0x3a3022, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }));
        seabed.rotation.x = -Math.PI / 2; seabed.position.y = -(elevation + water); group.add(seabed); statics.push(seabed); disposables.push(seabed.material as THREE.Material);
      }
      const sections = [...brief.sections].sort((a, b) => a.shoeMdM - b.shoeMdM);
      sections.slice(0, sim.sectionIndex).forEach((s) => {
        statics.push(tube(0, s.shoeMdM, s.odIn * K, steel));
        const toc = s.cement?.topMdM ?? s.shoeMdM;
        if (toc < s.shoeMdM) statics.push(tube(toc, s.shoeMdM, s.holeSizeIn * K, cement));
        label(`${s.label.replace(/ casing.*/i, "")} shoe`, at(s.shoeMdM).clone().add(new THREE.Vector3(-30, 0, 0)), "is-shoe");
      });
      // The rig: a mast over the hole, the floor, the BOP below it.
      const mast = new THREE.BufferGeometry(), legs: number[] = [];
      const h = 46, base = 9, topW = 2;
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]] as const) legs.push(sx * base, 2, sz * base, sx * topW, h, sz * topW);
      for (let i = 1; i < 8; i++) { const y = 2 + (h - 2) * i / 8, w = base - (base - topW) * i / 8; legs.push(-w, y, -w, w, y, -w, w, y, -w, w, y, w, w, y, w, -w, y, w, -w, y, w, -w, y, -w); }
      mast.setAttribute("position", new THREE.Float32BufferAttribute(legs, 3));
      const mastLines = new THREE.LineSegments(mast, new THREE.LineBasicMaterial({ color: 0x5c6a86 }));
      group.add(mastLines); statics.push(mastLines); disposables.push(mastLines.material as THREE.Material);
      const floor = new THREE.Mesh(new THREE.BoxGeometry(30, 2, 30), new THREE.MeshStandardMaterial({ color: 0x2a3247, roughness: 0.8 }));
      floor.position.y = 1; group.add(floor); statics.push(floor); disposables.push(floor.material as THREE.Material);
      rams.position.set(0, -6, 0); rams.scale.set(sim.holeIn * K * 2 + 6, 6, sim.holeIn * K * 2 + 6);
    };

    // ---- particles: mud and cuttings; instanced bubbles for gas ----
    const COUNT = 900;
    const positions = new Float32Array(COUNT * 3), colours = new Float32Array(COUNT * 3);
    const points = new THREE.BufferGeometry();
    points.setAttribute("position", new THREE.BufferAttribute(positions, 3)); points.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    const sprite = roundSprite(); disposables.push(sprite);
    const cloud = new THREE.Points(points, new THREE.PointsMaterial({ size: 1.7, map: sprite, alphaTest: 0.05, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false }));
    cloud.frustumCulled = false; group.add(cloud); disposables.push(points, cloud.material as THREE.Material);
    type Particle = { md: number; annulus: boolean; angle: number; radial: number; cutting: boolean };
    let particles: Particle[] = [];
    const seed = (from: number, to: number) => { particles = Array.from({ length: COUNT }, (_, i) => ({ md: from + Math.random() * Math.max(1, to - from), annulus: i % 4 !== 0, angle: Math.random() * Math.PI * 2, radial: Math.random(), cutting: false })); };
    let bubblePhase = 0, cuttingLoad = 0;
    const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf2f6ff, roughness: 0.2, transparent: true, opacity: 0.85 }), 260);
    bubbles.frustumCulled = false; group.add(bubbles); disposables.push(bubbles.geometry, bubbles.material as THREE.Material);
    const arrows = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 3, 10), new THREE.MeshStandardMaterial({ color: 0xf87171, emissive: 0x7f1d1d }), 24);
    arrows.frustumCulled = false; group.add(arrows); disposables.push(arrows.geometry, arrows.material as THREE.Material);
    const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(), place = new THREE.Vector3();

    let lastSim: DrillingSimulator | null = null, lastFollow: boolean | null = null, frameId = 0, last = performance.now(), clock = 0, angle = 0;
    const fitWhole = () => {
      const box = new THREE.Box3(); for (let md = 0; md <= sim.targetMdM; md += 50) box.expandByPoint(at(md)); box.expandByPoint(new THREE.Vector3(0, 50, 0));
      const centre = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
      controls.target.copy(centre); camera.position.copy(centre).add(new THREE.Vector3(size * 0.85, size * 0.15, size * 0.85)); camera.near = 1; camera.far = size * 10; camera.updateProjectionMatrix();
    };
    const resize = () => { const w = element.clientWidth, h = element.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();

    const animate = (now: number) => {
      frameId = requestAnimationFrame(animate);
      const current = simRef.current; if (!current) return;
      if (current !== lastSim) { sim = current; lastSim = current; buildPath(); buildStatics(); builtHole = builtBit = builtKill = builtFront = -1; seed(0, sim.now.bitMdM); fitWhole(); lastFollow = null; }
      const r = sim.now;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const moving = live.current.running && r.mode !== "section-td";
      if (moving) clock += dt;
      const rate = moving ? live.current.rate : 0, simDt = rate * dt;
      // Rotation at its real rate, held to what the eye can follow.
      if (moving && r.rotating) angle += dt * Math.min(2.5, r.rpm / 60 * Math.max(1, rate));

      // Rebuild what grows: the open hole, the string, the kill mud in it.
      if (Math.abs(r.holeMdM - builtHole) > 2) {
        builtHole = r.holeMdM;
        holeMesh = replace(holeMesh, () => tube(sim.shoeMdM, Math.max(sim.shoeMdM + 2, r.holeMdM), sim.holeIn * K, openHole));
        mudMesh = replace(mudMesh, () => tube(0, Math.max(4, r.holeMdM), Math.min(sim.holeIn, sim.casingIdIn) * K * 0.97, mudFill));
      }
      const front = r.kill && r.kill.annulusFraction > 0 ? r.bitMdM * (1 - r.kill.annulusFraction) : -1;
      if (Math.abs(front - builtFront) > 3) {
        builtFront = front;
        if (killAnnulusMesh) { group.remove(killAnnulusMesh); killAnnulusMesh.geometry.dispose(); killAnnulusMesh = null; }
        if (front >= 0 && r.bitMdM - front > 3) killAnnulusMesh = tube(front, r.bitMdM, Math.min(sim.holeIn, sim.casingIdIn) * K * 0.95, killFill);
      }
      if (Math.abs(r.bitMdM - builtBit) > 2) {
        builtBit = r.bitMdM;
        const bhaTop = Math.max(0, r.bitMdM - sim.string.bhaLengthM);
        pipeMesh = replace(pipeMesh, () => tube(0, Math.max(4, bhaTop), sim.string.pipeOdIn * K, pipe));
        bhaMesh = replace(bhaMesh, () => tube(bhaTop, r.bitMdM, sim.string.bhaOdIn * K, pipe));
      }
      const killTo = r.kill ? r.bitMdM * r.kill.stringFraction : 0;
      if (Math.abs(killTo - builtKill) > 3) { builtKill = killTo; if (killMesh) { group.remove(killMesh); killMesh.geometry.dispose(); (killMesh.material as THREE.Material).dispose(); killMesh = null; } if (killTo > 5) killMesh = tube(0, killTo, sim.string.pipeIdIn * K * 0.9, new THREE.MeshBasicMaterial({ color: 0xf2b45c, transparent: true, opacity: 0.75 })); }
      stripeTexture.offset.set(0, -angle); stripeTexture.repeat.set(30, 1);

      // The bit, pointing down the hole; the block riding the stand; the rams.
      const f = frameAt(r.bitMdM);
      bit.position.copy(f.p).addScaledVector(f.t, -1);
      bit.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), f.t);
      bit.scale.set(sim.holeIn * K * 0.95, 4, sim.holeIn * K * 0.95);
      bit.rotateY(angle * Math.PI * 2);
      const drilled = Math.max(0, Math.min(1, r.standDrilledM / 28.5));
      const lift = r.connectionProgress !== null ? Math.min(1, r.connectionProgress / 0.6) : 0;
      block.position.set(0, 8 + 34 * (r.connectionProgress !== null ? lift : 1 - drilled), 0);
      const closed = r.mode === "shut-in" || r.mode === "killing";
      (rams.material as THREE.MeshStandardMaterial).color.set(closed ? 0xef4444 : 0x7c5a6a);
      (rams.material as THREE.MeshStandardMaterial).emissive.set(closed ? 0x5f1010 : 0x000000);

      // Mud and cuttings, at the real ratio of pipe to annular velocity.
      const followNow = live.current.follow;
      const top = followNow ? Math.max(0, r.bitMdM - 300) : 0;
      if (followNow !== lastFollow) {
        if (!followNow && lastFollow !== null) fitWhole();
        if (followNow) {
          // Beside the bit, looking across the path from its high side, so the build and the hole around the bit both read.
          const fb = frameAt(r.bitMdM), side = new THREE.Vector3(fb.t.z, 0, -fb.t.x); if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
          controls.target.copy(fb.p); camera.position.copy(fb.p).addScaledVector(side.normalize(), 150).add(new THREE.Vector3(0, 60, 0)).addScaledVector(fb.t, -60);
          camera.near = 0.5; camera.far = 30000; camera.updateProjectionMatrix();
        }
        lastFollow = followNow; seed(top, r.bitMdM);
      }
      // Mud moves at its real velocity for the flow and each section's area, times the simulation speed;
      // cuttings slip back through it, and fall when the pumps stop.
      const pumping = moving && r.pumpsOn && r.flowInGpm > 0;
      const q = pumping ? r.flowInGpm * GPM_TO_M3S : 0;
      const bhaTopMd = r.bitMdM - sim.string.bhaLengthM;
      const annulusV = (md: number) => { const outer = md < sim.shoeMdM ? sim.casingIdIn : sim.holeIn, inner = md > bhaTopMd ? sim.string.bhaOdIn : sim.string.pipeOdIn; return q / (Math.PI / 4 * (outer ** 2 - inner ** 2) * IN * IN); };
      const pipeV = q / (Math.PI / 4 * (sim.string.pipeIdIn * IN) ** 2);
      const returns = r.flowInGpm > 0 ? Math.max(0, r.flowOutGpm / r.flowInGpm) : 0;
      const span = Math.max(1, r.bitMdM - top);
      cuttingLoad += ((r.onBottom && pumping ? Math.min(0.5, r.ropMh / 40) : 0) - cuttingLoad) * Math.min(1, dt * 0.8);
      particles.forEach((p, i) => {
        if (!p.annulus) { p.md += pipeV * simDt; if (p.md > r.bitMdM) { p.md -= span; } }
        else if (p.cutting) {
          p.md += pumping ? -Math.max(0, annulusV(p.md) * returns - CUTTING_SLIP_MS) * simDt : CUTTING_SLIP_MS * simDt;
          if (p.md > r.bitMdM - 0.5) p.md = r.bitMdM - 0.5 - hash(i) * 2;
          if (p.md < top) { p.md += span; p.cutting = hash(i + clock) < cuttingLoad; }
        } else { p.md -= annulusV(p.md) * returns * simDt; if (p.md < top) { p.md += span; p.cutting = hash(i * 1.7 + clock) < cuttingLoad; } }
        const fr = frameAt(p.md), bore = (p.md < sim.shoeMdM ? sim.casingIdIn : sim.holeIn) * K;
        const inner = p.annulus ? (p.md > r.bitMdM - sim.string.bhaLengthM ? sim.string.bhaOdIn : sim.string.pipeOdIn) * K + 0.4 : 0;
        const outer = p.annulus ? bore - 0.4 : sim.string.pipeIdIn * K * 0.6;
        const radius = inner + p.radial * Math.max(0, outer - inner), a = p.angle + (p.annulus ? 0 : angle * 6);
        place.copy(fr.p).addScaledVector(fr.n, Math.cos(a) * radius).addScaledVector(fr.b, Math.sin(a) * radius);
        positions.set([place.x, place.y, place.z], i * 3);
        const killed = r.kill && (p.annulus ? p.md > r.bitMdM * (1 - r.kill.annulusFraction) : p.md < r.bitMdM * r.kill.stringFraction);
        const colour = killed ? KILL : p.annulus && p.cutting ? CUTTING : MUD;
        colours.set([colour.r, colour.g, colour.b], i * 3);
      });
      points.attributes.position!.needsUpdate = true; points.attributes.color!.needsUpdate = true;

      // Gas: from where it enters up to the slug, swelling as the pressure on it falls.
      const t = r.truth;
      let shown = 0;
      if (t.influxMdM !== null && t.influxLengthM > 0) {
        const base = t.influxSourceMdM !== null && t.influxRateBblMin > 0.02 ? Math.max(t.influxMdM, t.influxSourceMdM) : t.influxMdM, topMd = Math.max(0, t.influxMdM - t.influxLengthM);
        const count = Math.min(260, 24 + Math.round(t.influxLengthM * 4)), length = Math.max(1, base - topMd);
        const deep = (-frameAt(base).p.y || 1) + 15;
        bubblePhase += GAS_SLIP_MS * simDt;
        for (let i = 0; i < count; i++) {
          // Scattered through the annulus, each rising through the mud at its slip velocity and swelling by Boyle's law.
          const md = topMd + (((hash(i * 1.37) - bubblePhase / length) % 1) + 1) % 1 * length;
          const fr = frameAt(md), bore = (md < sim.shoeMdM ? sim.casingIdIn : sim.holeIn) * K, inner = (md > bhaTopMd ? sim.string.bhaOdIn : sim.string.pipeOdIn) * K;
          const swell = t.influxGas ? Math.cbrt(deep / (-fr.p.y + 15)) : 1;
          const size = Math.min((bore - inner) * 0.45, (0.25 + hash(i * 4.3) * 0.5) * swell);
          const a = hash(i * 2.39) * Math.PI * 2, radius = inner + size + hash(i * 3.71) * Math.max(0, bore - inner - size * 2);
          place.copy(fr.p).addScaledVector(fr.n, Math.cos(a) * radius).addScaledVector(fr.b, Math.sin(a) * radius);
          matrix.compose(place, quaternion.identity(), scale.set(size, size, size)); bubbles.setMatrixAt(shown++, matrix);
        }
        (bubbles.material as THREE.MeshStandardMaterial).color.set(t.influxGas ? 0xf2f6ff : 0x6b4a22);
      }
      bubbles.count = shown; bubbles.instanceMatrix.needsUpdate = true;

      // Arrows: inward where the rock gives an influx, outward where it takes mud.
      let arrowCount = 0;
      const ring = (md: number, inward: boolean, colour: number) => {
        const fr = frameAt(md), bore = (md < sim.shoeMdM ? sim.casingIdIn : sim.holeIn) * K;
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4, pulse = (clock * 1.5 + i / 8) % 1, distance = inward ? bore + 14 - pulse * 12 : bore + 2 + pulse * 12;
          const dir = new THREE.Vector3().addScaledVector(fr.n, Math.cos(a)).addScaledVector(fr.b, Math.sin(a)).normalize();
          place.copy(fr.p).addScaledVector(dir, distance);
          quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), inward ? dir.clone().negate() : dir);
          matrix.compose(place, quaternion, scale.set(1.3, 1.3, 1.3)); arrows.setMatrixAt(arrowCount++, matrix);
        }
        (arrows.material as THREE.MeshStandardMaterial).color.set(colour);
      };
      if (t.influxSourceMdM !== null && t.influxRateBblMin > 0.02) ring(t.influxSourceMdM, true, t.influxGas ? 0xf2f6ff : 0x8b5a2b);
      else if (t.lossMdM !== null) ring(t.lossMdM, false, 0xf87171);
      arrows.count = arrowCount; arrows.instanceMatrix.needsUpdate = true;

      // The camera: following the bit, or free.
      if (followNow) {
        const target = frameAt(r.bitMdM).p;
        controls.target.lerp(target, 1 - Math.exp(-dt * 3));
        const offset = camera.position.clone().sub(controls.target);
        const want = 180;
        if (Math.abs(offset.length() - want) > 2) camera.position.copy(controls.target).add(offset.setLength(offset.length() + (want - offset.length()) * (1 - Math.exp(-dt * 2))));
      }
      controls.update();
      const distance = camera.position.distanceTo(controls.target);
      (scene.fog as THREE.Fog).near = distance * 0.8; (scene.fog as THREE.Fog).far = distance * 3.5;
      for (const disc of discs) disc.visible = !followNow;
      renderer.render(scene, camera);

      // Labels follow their points on screen.
      const w = element.clientWidth, h = element.clientHeight;
      bitLabel.textContent = `bit ${Math.round(r.bitMdM)} m MD · ${Math.round(-f.p.y)} m TVD`; labels[0]!.at.copy(f.p).add(new THREE.Vector3(8, 0, 0));
      const event = t.influxSourceMdM !== null && t.influxRateBblMin > 0.02 ? [t.influxSourceMdM, t.influxGas ? "gas coming in" : "influx coming in"] as const : t.lossMdM !== null ? [t.lossMdM, `losing ${r.lossRateBblMin.toFixed(1)} bbl/min`] as const : null;
      eventLabel.style.display = event ? "" : "none";
      if (event) { eventLabel.textContent = event[1]; labels[1]!.at.copy(frameAt(event[0]).p).add(new THREE.Vector3(-14, 0, 0)); }
      // Labels never sit on one another: the bit and the event first, then the rest where there is room.
      const placed: { x: number; y: number }[] = [];
      labels.forEach((l, index) => {
        const v = l.at.clone().project(camera);
        const sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * h;
        const crowded = index > 1 && placed.some((p) => Math.abs(p.x - sx) < 170 && Math.abs(p.y - sy) < 16);
        if (!crowded && l.el.style.display !== "none") placed.push({ x: sx, y: sy });
        const visible = !crowded && v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
        l.el.style.opacity = visible ? "" : "0";
        l.el.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - v.y) / 2 * h).toFixed(1)}px)`;
      });
      if (hud.current) hud.current.textContent = `MD ${Math.round(r.bitMdM)} m · TVD ${Math.round(-f.p.y)} m · inc ${(Math.acos(Math.max(-1, Math.min(1, -f.t.y))) * 180 / Math.PI).toFixed(1)}°`;
    };
    frameId = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frameId); observer.disconnect(); controls.dispose();
      for (const mesh of [holeMesh, pipeMesh, bhaMesh, killMesh, mudMesh, killAnnulusMesh]) mesh?.geometry.dispose();
      for (const object of statics) if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) object.geometry.dispose();
      for (const d of disposables) d.dispose();
      for (const l of labels) l.el.remove();
      scene.environment?.dispose(); pmrem.dispose();
      renderer.dispose(); renderer.domElement.remove();
    };
  }, [simRef]);

  // The camera bar and the key sit above and below the view, never over it; the view is the host the renderer fills.
  return <div className="rig3d">
    <div className="rig3d-hud"><span ref={hud} /><span className="log-sets" role="group" aria-label="Camera">
      <button type="button" aria-pressed={follow} onClick={() => setFollow(true)}>Follow the bit</button>
      <button type="button" aria-pressed={!follow} onClick={() => setFollow(false)}>Whole well</button>
    </span></div>
    <div className="rig3d-view" ref={host} />
    <p className="rig3d-key"><i className="is-mud" />mud <i className="is-cutting" />cuttings <i className="is-gas" />gas <i className="is-kill" />kill mud <i className="is-loss" />losses · diameters ×40 · drag to orbit, scroll to zoom</p>
  </div>;
}
