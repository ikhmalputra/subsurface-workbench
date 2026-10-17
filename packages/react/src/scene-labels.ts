import * as THREE from "three";
import { scaleLinear } from "d3-scale";

/**
 * Labels for 3D scenes as page text laid over the canvas, not textures painted into it: they stay
 * sharp at any zoom and pixel ratio, use the page's fonts and theme, and can be read by the page.
 *
 * A label is an Object3D, so a scene positions and parents it like anything else; `place` projects
 * every label after each draw. Names and picks give way to each other when they would overlap —
 * the higher priority stays — and slide left rather than run off the right edge. Ticks always show.
 */

export type SceneLabelKind = "tick" | "axis" | "name" | "pick";

export class SceneLabel extends THREE.Object3D {
  readonly element: HTMLSpanElement;
  shown = true;
  /** Its size on the page, measured while shown: a hidden label (display none) measures nothing. */
  size: { readonly w: number; readonly h: number } | null = null;
  constructor(text: string, readonly kind: SceneLabelKind, readonly priority: number, readonly options: { readonly className?: string; readonly colour?: string; readonly layer?: string; readonly owner?: string } = {}) {
    super();
    this.element = document.createElement("span");
    this.element.className = `sw-scene-label is-${kind}${options.className ? ` ${options.className}` : ""}`;
    this.element.textContent = text;
    if (options.colour) this.element.style.setProperty("--sw-scene-label-accent", options.colour);
  }
}

export class LabelLayer {
  readonly root: HTMLDivElement;
  private readonly labels: SceneLabel[] = [];
  private readonly point = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "sw-scene-labels";
    this.root.setAttribute("aria-hidden", "true");
    container.append(this.root);
  }

  /** A new label; position it (and parent it, if it should follow an object) like any Object3D. */
  label(text: string, kind: SceneLabelKind, priority: number, options?: SceneLabel["options"], at?: THREE.Vector3) {
    const label = new SceneLabel(text, kind, priority, options);
    if (at) label.position.copy(at);
    this.root.append(label.element);
    this.labels.push(label);
    return label;
  }

  /** Project every label for this camera; `filter` hides labels a host's own layers have turned off. */
  place(camera: THREE.Camera, filter?: (label: SceneLabel) => boolean, obstacles: readonly Element[] = []) {
    const width = this.root.clientWidth, height = this.root.clientHeight;
    // The host's own panels over the view (toolbar, readout, view cube) are taken before any label: none is drawn under them.
    const origin = this.root.getBoundingClientRect();
    const taken: { x0: number; y0: number; x1: number; y1: number }[] = obstacles.map((element) => element.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ x0: r.left - origin.left - 4, y0: r.top - origin.top - 4, x1: r.right - origin.left + 4, y1: r.bottom - origin.top + 4 }));
    const order = [...this.labels].sort((a, b) => b.priority - a.priority);
    for (const label of order) {
      let visible = (filter?.(label) ?? true) && this.inScene(label);
      if (visible) {
        label.getWorldPosition(this.point).project(camera);
        const x = (this.point.x + 1) / 2 * width, y = (1 - this.point.y) / 2 * height;
        visible = this.point.z < 1 && this.point.z > -1 && x > -60 && x < width + 60 && y > -30 && y < height + 30;
        if (visible) {
          const { w, h } = this.measure(label);
          const floating = label.kind === "name" || label.kind === "pick";
          const left = floating ? x + Math.min(0, width - 8 - (x + w)) : x;
          const box = floating ? { x0: left - 2, y0: y - h, x1: left + w + 2, y1: y + 2 } : label.kind === "tick" ? tickBox(label, x, y, w, h) : { x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 };
          // Every label, ticks too, gives way to one already placed (placed by priority): nothing is drawn over anything.
          if (taken.some((r) => box.x0 < r.x1 && box.x1 > r.x0 && box.y0 < r.y1 && box.y1 > r.y0)) visible = false;
          else {
            taken.push(box);
            label.element.style.transform = `translate(${left.toFixed(1)}px, ${y.toFixed(1)}px) ${anchor(label)}`;
          }
        }
      }
      if (visible !== label.shown) { label.shown = visible; label.element.hidden = !visible; }
    }
  }

  /** Take one label away for good: off the page and out of placement. */
  remove(label: SceneLabel) {
    const index = this.labels.indexOf(label);
    if (index >= 0) this.labels.splice(index, 1);
    label.removeFromParent();
    label.element.remove();
  }

  /** Every label of this kind and owner, e.g. to style the selected well's name. */
  each(visit: (label: SceneLabel) => void) { for (const label of this.labels) visit(label); }

  dispose() {
    for (const label of this.labels) label.removeFromParent();
    this.labels.length = 0;
    this.root.remove();
  }

  /** A label's true size, so one hidden last time is judged at its real width, not a guess that lets it overlap. */
  private measure(label: SceneLabel) {
    const element = label.element;
    if (!element.hidden || !label.size) {
      const hidden = element.hidden;
      if (hidden) element.hidden = false;
      if (element.offsetWidth > 0) label.size = { w: element.offsetWidth, h: element.offsetHeight };
      if (hidden) element.hidden = true;
    }
    return label.size ?? { w: 40, h: 14 };
  }

  /** A label shows only while it and every ancestor are visible, as a mesh would. */
  private inScene(label: SceneLabel) {
    for (let object: THREE.Object3D | null = label; object; object = object.parent) if (!object.visible) return false;
    return true;
  }
}

/** A tick's box on screen, as its anchor places it (see `anchor`). */
function tickBox(label: SceneLabel, x: number, y: number, w: number, h: number) {
  const classes = label.element.classList;
  if (classes.contains("is-depth")) return { x0: x - w - 8, y0: y - h / 2, x1: x - 8, y1: y + h / 2 };
  if (classes.contains("is-east")) return { x0: x - w / 2, y0: y + 6, x1: x + w / 2, y1: y + 6 + h };
  return { x0: x + 8, y0: y - h / 2, x1: x + 8 + w, y1: y + h / 2 };
}

/** Where each kind of label sits against its point: ticks beside their edge, names above-right. */
function anchor(label: SceneLabel) {
  if (label.kind === "tick") {
    const classes = label.element.classList;
    return classes.contains("is-depth") ? "translate(calc(-100% - 8px), -50%)" : classes.contains("is-east") ? "translate(-50%, 6px)" : "translate(8px, -50%)";
  }
  return label.kind === "axis" ? "translate(-50%, -50%)" : "translate(0, -100%)";
}

const fmt = (value: number) => Math.round(value).toLocaleString("en-US");

/**
 * The frame of a subsurface scene: a box with east, north and depth ticks on its near edges (as seen
 * from the south-east, above), a floor grid and depth lines on the far walls. Domains are in metres;
 * `at` maps metres to the scene. Returns the objects to add and the resources to dispose.
 */
export function axesBox({ at, east: [e0, e1], north: [n0, n1], depth: [d0, d1], depthTitle, labels, axisColour, gridColour, walls = true }: {
  readonly at: (east: number, north: number, depth: number) => THREE.Vector3;
  readonly east: readonly [number, number];
  readonly north: readonly [number, number];
  readonly depth: readonly [number, number];
  readonly depthTitle: string;
  readonly labels: LabelLayer;
  readonly axisColour: string;
  readonly gridColour: string;
  /** Floor grid and far-wall depth lines; off where the scene already draws walls of its own. */
  readonly walls?: boolean;
}) {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const lines = (points: THREE.Vector3[], colour: string, opacity = 1) => {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: colour, transparent: opacity < 1, opacity });
    disposables.push(geometry, material);
    group.add(new THREE.LineSegments(geometry, material));
  };
  const corners = (d: number) => [at(e0, n0, d), at(e1, n0, d), at(e1, n1, d), at(e0, n1, d)];
  const top = corners(d0), bottom = corners(d1);
  const edges: THREE.Vector3[] = [];
  for (let i = 0; i < 4; i++) edges.push(top[i]!, top[(i + 1) % 4]!, bottom[i]!, bottom[(i + 1) % 4]!, top[i]!, bottom[i]!);
  lines(edges, axisColour);
  const eTicks = scaleLinear().domain([e0, e1]).ticks(6), nTicks = scaleLinear().domain([n0, n1]).ticks(6), dTicks = scaleLinear().domain([d0, d1]).ticks(7);
  const marks: THREE.Vector3[] = [];
  const tickLength = Math.max(e1 - e0, n1 - n0) * 0.012;
  for (const e of eTicks) marks.push(at(e, n0, d1), at(e, n0 - tickLength, d1));
  for (const n of nTicks) marks.push(at(e1, n, d1), at(e1 + tickLength, n, d1));
  for (const d of dTicks) marks.push(at(e0, n0, d), at(e0 - tickLength, n0, d));
  lines(marks, axisColour);
  if (walls) {
    const grid: THREE.Vector3[] = [];
    for (const e of eTicks) grid.push(at(e, n0, d1), at(e, n1, d1), at(e, n1, d0), at(e, n1, d1));
    for (const n of nTicks) grid.push(at(e0, n, d1), at(e1, n, d1), at(e0, n, d0), at(e0, n, d1));
    for (const d of dTicks) grid.push(at(e0, n1, d), at(e1, n1, d), at(e0, n0, d), at(e0, n1, d));
    lines(grid, gridColour, 0.85);
  }
  for (const e of eTicks) group.add(labels.label(fmt(e), "tick", 0, { className: "is-east" }, at(e, n0 - tickLength, d1)));
  for (const n of nTicks) group.add(labels.label(fmt(n), "tick", 0, { className: "is-north" }, at(e1 + tickLength, n, d1)));
  for (const d of dTicks) group.add(labels.label(fmt(d), "tick", 0, { className: "is-depth" }, at(e0 - tickLength, n0, d)));
  group.add(labels.label("Easting (m)", "axis", 1, undefined, at((e0 + e1) / 2, n0 - (n1 - n0) * 0.1, d1)));
  group.add(labels.label("Northing (m)", "axis", 1, undefined, at(e1 + (e1 - e0) * 0.1, (n0 + n1) / 2, d1)));
  const title = at(e0, n0, d0);
  title.y += (at(e0, n0, d0).y - at(e0, n0, d1).y) * 0.06;
  group.add(labels.label(`Depth (${depthTitle})`, "axis", 1, { className: "is-depth-title" }, title));
  return { group, dispose: () => { for (const item of disposables) item.dispose(); } };
}
