import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

// A page in miniature that counts forced layouts: a size read after any style or visibility write
// makes the browser lay the page out again before it can answer. LabelLayer must read every size it
// needs in one batch per frame, not once per label (found by tools/stress/throttle.mjs: 1.2 s
// stalls at CPU 4× in a 200-well field).
let dirty = false, layouts = 0, reads = 0;
const write = () => { dirty = true; };
const read = () => { reads += 1; if (dirty) { layouts += 1; dirty = false; } };
class FakeStyle { constructor() { this._t = ""; } get transform() { return this._t; } set transform(v) { this._t = v; write(); } setProperty() { write(); } }
class FakeElement {
  constructor() { this.children = []; this.style = new FakeStyle(); this._hidden = false; this.textContent = ""; this.className = ""; this.parent = null; }
  get hidden() { return this._hidden; }
  set hidden(v) { this._hidden = v; write(); }
  get offsetWidth() { read(); return this._hidden ? 0 : 8 * this.textContent.length; }
  get offsetHeight() { read(); return this._hidden ? 0 : 14; }
  get clientWidth() { read(); return 1200; }
  get clientHeight() { read(); return 800; }
  getBoundingClientRect() { read(); return { left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 }; }
  setAttribute() {}
  append(child) { this.children.push(child); child.parent = this; write(); }
  remove() {}
  get classList() { const names = this.className.split(" "); return { contains: (name) => names.includes(name) }; }
}
globalThis.document = { createElement: () => new FakeElement() };
const { LabelLayer } = await import("../dist/scene-labels.js");

function scene(count) {
  const layer = new LabelLayer(new FakeElement());
  const camera = new THREE.OrthographicCamera(-1000, 1000, 1000, -1000, 0.1, 100);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  const labels = [];
  for (let i = 0; i < count; i++) labels.push(layer.label(`Well ${i}`, i % 5 === 0 ? "name" : "pick", i % 5 === 0 ? 2 : 1, undefined, new THREE.Vector3((i % 40) * 50 - 1000, Math.floor(i / 40) * 40 - 900, 0)));
  for (const label of labels) label.updateMatrixWorld();
  return { layer, camera, labels };
}

test("placing a thousand labels costs a bounded number of layouts, not one per label", () => {
  const { layer, camera } = scene(1000);
  layouts = 0; reads = 0; dirty = true;
  layer.place(camera);
  assert.ok(layouts <= 3, `first frame forced ${layouts} layouts over ${reads} reads`);
  // Later frames measure nothing new: sizes are kept until a label's text changes.
  for (let frame = 0; frame < 5; frame++) { layouts = 0; dirty = true; layer.place(camera); assert.ok(layouts <= 2, `frame ${frame} forced ${layouts} layouts`); }
});

test("labels never overlap; picks never push a name out; a changed text is measured again", () => {
  const { layer, camera, labels } = scene(400);
  layer.place(camera);
  const shown = labels.filter((label) => label.shown);
  assert.ok(shown.length > 0 && shown.length < labels.length, `${shown.length} of ${labels.length} shown`);
  // Boxes of what is shown, from the transforms written (names and picks sit above-right of their point).
  const boxes = shown.map((label) => { const [, x, y] = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(label.element.style.transform).map(Number); return { x0: x - 2, y0: y - label.size.h, x1: x + label.size.w + 2, y1: y + 2 }; });
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    assert.ok(!(a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0), `labels ${i} and ${j} overlap`);
  }
  // The same names alone: exactly the names shown with the picks present.
  const names = scene(400);
  for (const label of names.labels) if (label.kind === "pick") names.layer.remove(label);
  names.layer.place(names.camera);
  const shownNames = (list) => list.filter((label) => label.kind === "name" && label.shown).map((label) => label.element.textContent).sort();
  assert.deepEqual(shownNames(labels), shownNames(names.labels));
  // Text changed: measured again.
  const before = labels[0].size;
  labels[0].element.textContent = "A much longer well name than before";
  layer.place(camera);
  assert.ok(labels[0].size.w > before.w, `re-measured: ${before.w} → ${labels[0].size.w}`);
});
