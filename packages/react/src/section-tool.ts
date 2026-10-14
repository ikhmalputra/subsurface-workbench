import * as THREE from "three";

/**
 * A section plane: a cut through the model along one axis that hides everything on one side, the
 * way SolidWorks' section view or AutoCAD's live section does. Where the plane cuts a solid, the
 * solid's inside is drawn in a flat colour — a cheap cap that makes a cut tube read as a wall, not
 * as a hollow shell.
 *
 * Clipping is done the way each renderer allows: the WebGL renderer takes global clipping planes
 * (`beforeRender` sets them each frame); the WebGPU renderer clips the children of a
 * `THREE.ClippingGroup`, so pass one (or several, for a scene drawn in more than one pass) as
 * `root` and each carries the plane itself.
 */

export type SectionAxis = "x" | "y" | "z";
export interface SectionState {
  readonly axis: SectionAxis;
  /** Where along the axis the plane sits, 0 at the model's minimum, 1 at its maximum. */
  readonly at: number;
  /** Keep the other side. */
  readonly flip: boolean;
}

interface Solid { readonly mesh: THREE.Mesh; readonly cap: THREE.Mesh }
/** `THREE.ClippingGroup` from `three/webgpu`, described by shape so this module works with either build. */
interface ClipGroup { readonly isClippingGroup?: boolean; clippingPlanes?: THREE.Plane[] }
interface Renderer { clippingPlanes?: THREE.Plane[] }

const AXIS: Readonly<Record<SectionAxis, THREE.Vector3>> = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

export class SectionTool {
  readonly plane = new THREE.Plane();
  /** The plane's outline, sized to the model; add it to the scene outside the clipped root. */
  readonly outline: THREE.Line;
  private state: SectionState | null = null;
  private solids: Solid[] = [];
  private readonly sides = new Map<THREE.Material, THREE.Side>();
  private readonly caps = new Map<string, THREE.MeshBasicMaterial>();

  private readonly roots: readonly THREE.Object3D[];

  constructor(root: THREE.Object3D | readonly THREE.Object3D[], private readonly options: {
    /** The opaque meshes whose cut faces should be filled. */
    readonly solids: () => readonly THREE.Mesh[];
    /** The extent the plane travels across. */
    readonly bounds: () => THREE.Box3;
  }) {
    this.roots = Array.isArray(root) ? root : [root as THREE.Object3D];
    // A closed Line, not a LineLoop: the WebGPU renderer draws only lines and segments.
    this.outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 5 }, () => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: "#ff6a00", transparent: true, opacity: 0.9, depthTest: false, toneMapped: false }));
    this.outline.renderOrder = 30;
    this.outline.visible = false;
  }

  get active() { return this.state !== null; }

  /** Turn the section on at a position, move it, or turn it off with `null`. */
  set(state: SectionState | null) {
    const was = this.state;
    this.state = state;
    if (!state) { this.uncap(); this.outline.visible = false; this.applyGroup(); return; }
    const box = this.options.bounds();
    if (box.isEmpty()) return;
    const axis = AXIS[state.axis];
    const low = box.min.dot(axis), high = box.max.dot(axis);
    const position = low + (high - low) * THREE.MathUtils.clamp(state.at, 0, 1);
    // The plane keeps the side its normal points to; by default the side below the cut position.
    const normal = axis.clone().multiplyScalar(state.flip ? 1 : -1);
    this.plane.set(normal, -normal.dot(axis.clone().multiplyScalar(position)));
    this.drawOutline(box, state.axis, position);
    if (!was) this.cap();
    this.applyGroup();
  }

  /** WebGL: set the global clipping plane for the coming pass. Harmless for WebGPU. */
  beforeRender(renderer: Renderer) {
    if ("clippingPlanes" in renderer && !this.roots.some((root) => (root as unknown as ClipGroup).isClippingGroup)) renderer.clippingPlanes = this.state ? [this.plane] : [];
  }

  /** The model was rebuilt: re-cap its new solids if a section is on. */
  refresh() {
    if (!this.state) return;
    this.uncap();
    this.cap();
    this.set(this.state);
  }

  dispose() {
    this.uncap();
    for (const material of this.caps.values()) material.dispose();
    this.outline.geometry.dispose();
    (this.outline.material as THREE.Material).dispose();
  }

  private applyGroup() {
    for (const root of this.roots) {
      const group = root as unknown as ClipGroup;
      if (group.isClippingGroup) group.clippingPlanes = this.state ? [this.plane] : [];
    }
  }

  private capMaterial(colour: THREE.Color) {
    const shade = colour.clone().multiplyScalar(0.72);
    const key = shade.getHexString();
    let material = this.caps.get(key);
    if (!material) {
      material = new THREE.MeshBasicMaterial({ color: shade, side: THREE.BackSide, toneMapped: false });
      this.caps.set(key, material);
    }
    return material;
  }

  private cap() {
    for (const mesh of this.options.solids()) {
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (!material || material.transparent) continue;
      // A double-sided material would draw its own lit inside over the cap; while cut, show its front only.
      for (const each of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (!this.sides.has(each)) this.sides.set(each, each.side);
        each.side = THREE.FrontSide;
        each.needsUpdate = true;
      }
      const colour = (material as THREE.MeshStandardMaterial).color ?? new THREE.Color("#8a8f99");
      const cap = new THREE.Mesh(mesh.geometry, this.capMaterial(colour));
      cap.userData.sectionCap = true;
      cap.raycast = () => undefined;
      mesh.add(cap);
      this.solids.push({ mesh, cap });
    }
  }

  private uncap() {
    for (const { mesh, cap } of this.solids) mesh.remove(cap);
    this.solids = [];
    for (const [material, side] of this.sides) { material.side = side; material.needsUpdate = true; }
    this.sides.clear();
  }

  private drawOutline(box: THREE.Box3, axis: SectionAxis, position: number) {
    const { min, max } = box;
    const corners = axis === "x"
      ? [[position, min.y, min.z], [position, max.y, min.z], [position, max.y, max.z], [position, min.y, max.z]]
      : axis === "y"
        ? [[min.x, position, min.z], [max.x, position, min.z], [max.x, position, max.z], [min.x, position, max.z]]
        : [[min.x, min.y, position], [max.x, min.y, position], [max.x, max.y, position], [min.x, max.y, position]];
    const attribute = this.outline.geometry.getAttribute("position") as THREE.BufferAttribute;
    [...corners, corners[0]!].forEach(([x, y, z], index) => attribute.setXYZ(index, x!, y!, z!));
    attribute.needsUpdate = true;
    this.outline.geometry.computeBoundingSphere();
    this.outline.visible = true;
  }
}
