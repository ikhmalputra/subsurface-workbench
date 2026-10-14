import * as THREE from "three";

/**
 * An AutoCAD-style view cube over a scene's top-right corner. It turns with the camera; clicking a
 * face, an edge or a corner swings the camera round the orbit target to look from that side — 26
 * views in all, the way a CAD user expects.
 *
 * It is drawn in the page, not in the scene: six CSS 3D faces rotated by the camera's own rotation.
 * That keeps it independent of the renderer — WebGL, WebGPU, a post-processing pipeline — and its
 * captions are real text. Each face is a 3 × 3 grid: the middle is the face, the sides are its
 * edges and the corners its corners.
 *
 * The host calls `update()` whenever it draws, before drawing: that advances a swing in progress
 * and turns the cube to match the camera. While swinging the cube calls `onChange` once per frame,
 * the host's cue to draw again, so a scene that renders only on demand still animates.
 */

/** Face captions by axis, in the scene's own frame (x, y, z positive and negative). */
export interface ViewCubeLabels { readonly px: string; readonly nx: string; readonly py: string; readonly ny: string; readonly pz: string; readonly nz: string }

/** Earth scenes: x east, y up, z south (north is −z). */
export const COMPASS_FACES: ViewCubeLabels = { px: "EAST", nx: "WEST", py: "TOP", ny: "BOTTOM", pz: "SOUTH", nz: "NORTH" };
/** A model with no geography: the assembly on its own axis. */
export const MODEL_FACES: ViewCubeLabels = { px: "RIGHT", nx: "LEFT", py: "TOP", ny: "BOTTOM", pz: "FRONT", nz: "BACK" };

/** Named views a keyboard user can reach; the vector is where the camera sits relative to the target. */
export type NamedView = "top" | "bottom" | "px" | "nx" | "pz" | "nz" | "home";
const NAMED: Readonly<Record<Exclude<NamedView, "home">, THREE.Vector3>> = {
  top: new THREE.Vector3(0, 1, 0), bottom: new THREE.Vector3(0, -1, 0),
  px: new THREE.Vector3(1, 0, 0), nx: new THREE.Vector3(-1, 0, 0), pz: new THREE.Vector3(0, 0, 1), nz: new THREE.Vector3(0, 0, -1),
};

interface OrbitLike { readonly target: THREE.Vector3; update(): unknown; enabled: boolean }

export interface ViewCubeOptions {
  readonly labels?: ViewCubeLabels;
  /** Draw a N–E–S–W ring under the cube (earth scenes). */
  readonly compass?: boolean;
  /** The camera's view of `home`, relative to the target: what the scene's own fit uses. */
  readonly home?: THREE.Vector3;
  /** Called when a swing begins, e.g. to cancel a host's own camera flight. */
  readonly onStart?: () => void;
  /** Called every frame while the camera swings; the host draws. */
  readonly onChange: () => void;
  /** Called once when a swing ends, so the host can report the camera. */
  readonly onSettled?: () => void;
}

/** Edge of the cube in CSS pixels; the widget's square is sized in CSS around it. */
const EDGE = 50;

interface Face { readonly normal: THREE.Vector3; readonly up: THREE.Vector3; readonly element: HTMLElement }

export class ViewCube {
  private readonly root: HTMLDivElement;
  private readonly faces: Face[] = [];
  private readonly ring: HTMLElement | null;
  /** Compass letters with the ground point each marks; they face the viewer, so they never flatten. */
  private readonly marks: { readonly element: HTMLElement; readonly at: THREE.Vector3 }[] = [];
  private readonly home: THREE.Vector3;
  private swing: { readonly start: number; readonly from: THREE.Vector3; readonly turn: THREE.Quaternion; readonly up: THREE.Vector3; readonly distance: number } | null = null;
  private frame = 0;
  private readonly rotation = new THREE.Matrix4();

  constructor(private readonly view: THREE.PerspectiveCamera, private readonly controls: OrbitLike, container: HTMLElement, private readonly options: ViewCubeOptions) {
    this.home = (options.home ?? new THREE.Vector3(0.85, 0.32, 1.15)).clone().normalize();
    const labels = options.labels ?? MODEL_FACES;
    this.root = document.createElement("div");
    this.root.className = `sw-viewcube${options.compass ? " has-compass" : ""}`;
    this.root.setAttribute("aria-hidden", "true");
    // The cube's clicks are the cube's: a scene that orbits on drag or picks on pointer-up must not see them.
    for (const type of ["pointerdown", "pointerup", "click", "wheel", "dblclick"] as const) this.root.addEventListener(type, (event) => event.stopPropagation());
    const stage = document.createElement("div");
    stage.className = "sw-viewcube-stage";
    this.root.append(stage);
    if (options.compass) {
      const ring = document.createElement("div");
      ring.className = "sw-viewcube-ring";
      stage.append(ring);
      const radius = EDGE * 1.04, below = -EDGE * 0.62;
      for (const [letter, x, z] of [["N", 0, -1], ["E", 1, 0], ["S", 0, 1], ["W", -1, 0]] as const) {
        const mark = document.createElement("span");
        mark.className = "sw-viewcube-mark";
        mark.textContent = letter;
        mark.dataset.mark = letter;
        stage.append(mark);
        this.marks.push({ element: mark, at: new THREE.Vector3(x * radius, below, z * radius) });
      }
      this.ring = ring;
    } else this.ring = null;
    // Each face: outward normal, the direction its caption's top points, and its caption.
    const specs: [THREE.Vector3, THREE.Vector3, string][] = [
      [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), labels.px],
      [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), labels.nx],
      // From above, north (−z) is the top of the caption, so a plan view reads upright.
      [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), labels.py],
      [new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), labels.ny],
      [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), labels.pz],
      [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), labels.nz],
    ];
    const keys = ["px", "nx", "py", "ny", "pz", "nz"] as const;
    specs.forEach(([normal, up, caption], index) => {
      const element = document.createElement("div");
      element.className = "sw-viewcube-face";
      element.dataset.face = keys[index];
      const right = new THREE.Vector3().crossVectors(up, normal);
      for (let row = 1; row >= -1; row--) for (let column = -1; column <= 1; column++) {
        const zone = document.createElement("div");
        zone.className = `sw-viewcube-zone${row === 0 && column === 0 ? " is-face" : row !== 0 && column !== 0 ? " is-corner" : " is-edge"}`;
        const direction = normal.clone().addScaledVector(right, column).addScaledVector(up, row).normalize();
        zone.addEventListener("pointerdown", (event) => { if (event.button === 0) { event.preventDefault(); this.swingTo(direction); } });
        element.append(zone);
      }
      const text = document.createElement("span");
      text.className = "sw-viewcube-caption";
      text.textContent = caption;
      element.append(text);
      stage.append(element);
      this.faces.push({ normal, up, element });
    });
    container.append(this.root);
    this.update();
  }

  /** True while the camera is swinging to a view; hosts with damped controls skip their update. */
  get swinging() { return this.swing !== null; }

  /** Swing to a named view: the keyboard route to the same cube, minus edges and corners. */
  look(view: NamedView) {
    this.swingTo(view === "home" ? this.home : NAMED[view]);
  }

  /** Advance a swing in progress and turn the cube to match the camera. Call before drawing. */
  update() {
    this.advance();
    this.layout();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.root.remove();
  }

  /** Turn every face by the camera's rotation, in CSS space (y down). */
  private layout() {
    this.view.updateMatrixWorld();
    this.rotation.extractRotation(this.view.matrixWorldInverse);
    const css = (v: THREE.Vector3) => { const r = v.clone().applyMatrix4(this.rotation); return [r.x, -r.y, r.z] as const; };
    const matrix = (x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3, at: THREE.Vector3) => {
      const [a, b, c] = css(x), [d, e, f] = css(y), [g, h, i] = css(z), [j, k, l] = css(at);
      return `matrix3d(${a},${b},${c},0,${d},${e},${f},0,${g},${h},${i},0,${j},${k},${l},1)`;
    };
    for (const { normal, up, element } of this.faces) {
      const right = new THREE.Vector3().crossVectors(up, normal);
      // An element's own y runs down its caption, so its y axis is the face's "up" reversed.
      element.style.transform = matrix(right, up.clone().negate(), normal, normal.clone().multiplyScalar(EDGE / 2));
    }
    // The ring lies flat under the cube with N toward −z; it is seen from below too, so it is not culled.
    if (this.ring) this.ring.style.transform = matrix(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -EDGE * 0.62, 0));
    for (const { element, at } of this.marks) {
      const [x, y, z] = css(at);
      element.style.transform = `translate3d(${x}px, ${y}px, ${z}px)`;
    }
  }

  private swingTo(direction: THREE.Vector3) {
    const offset = this.view.position.clone().sub(this.controls.target);
    const distance = offset.length();
    if (distance < 1e-9) return;
    const from = offset.divideScalar(distance);
    // Straight up or down would leave the orbit with no defined heading. Tip the camera a hair to
    // the south (+z) so that, looking down, north (−z) is up the screen, as on a plan.
    const to = direction.clone();
    if (Math.abs(to.y) > 0.9999) to.set(0, Math.sign(to.y), 1e-3).normalize();
    this.options.onStart?.();
    this.swing = { start: performance.now(), from, turn: new THREE.Quaternion().setFromUnitVectors(from, to), up: this.view.up.clone(), distance };
    this.controls.enabled = false;
    const tick = () => {
      if (!this.swing) return;
      this.options.onChange();
      if (this.swing) this.frame = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(tick);
  }

  private advance() {
    const swing = this.swing;
    if (!swing) return;
    const t = matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : Math.min(1, (performance.now() - swing.start) / 420);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    const step = new THREE.Quaternion().slerp(swing.turn, eased);
    this.view.position.copy(this.controls.target).addScaledVector(swing.from.clone().applyQuaternion(step), swing.distance);
    this.view.up.copy(swing.up);
    this.view.lookAt(this.controls.target);
    this.view.updateMatrixWorld();
    if (t < 1) return;
    this.swing = null;
    this.controls.enabled = true;
    this.controls.update();
    this.options.onSettled?.();
  }
}
