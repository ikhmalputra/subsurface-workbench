import assert from "node:assert/strict";
import test from "node:test";
import type { SeismicCube } from "@ikhmalputra/subsurface-core";
import { coverage, track } from "../src/data/horizon-model.ts";
import { crosses, cutOffs, faultAt, faultMesh, faultTrace, stickAt, throwOf } from "../src/data/fault-model.ts";
import type { Stick } from "../src/data/fault-model.ts";

/** A flat reflector at sample 40, dropped by `throwS` samples east of along 19.5: a vertical fault. */
function faulted(throwS: number, na = 40, no = 20, ns = 120): SeismicCube {
  const counts = new Int8Array(na * no * ns);
  for (let a = 0; a < na; a++) for (let o = 0; o < no; o++) {
    const centre = a < 20 ? 40 : 40 + throwS;
    for (let s = 0; s < ns; s++) { const x = (s - centre) / 2.5; counts[(s * no + o) * na + a] = Math.round(100 * (1 - 2 * x * x) * Math.exp(-x * x)); }
  }
  return { counts, alongCount: na, offsetCount: no, sampleCount: ns, amplitudePerCount: 0.01, alongFromM: 0, offsetFromM: 0, spacingM: 25 };
}
/** Sticks down the fault on two inlines, from sample 10 to 100. */
const fault: readonly Stick[] = [{ o: 2, points: [{ a: 19.5, s: 10 }, { a: 19.5, s: 100 }] }, { o: 17, points: [{ a: 19.5, s: 10 }, { a: 19.5, s: 100 }] }];

test("a stick is read between its points and a little past its ends, and the fault between sticks", () => {
  const stick: Stick = { o: 0, points: [{ a: 10, s: 0 }, { a: 20, s: 100 }] };
  assert.equal(stickAt(stick, 50), 15);
  assert.equal(stickAt(stick, 110), 21);
  assert.equal(stickAt(stick, 130), null);
  const leaning: readonly Stick[] = [{ o: 0, points: [{ a: 10, s: 0 }, { a: 10, s: 100 }] }, { o: 10, points: [{ a: 20, s: 0 }, { a: 20, s: 100 }] }];
  assert.equal(faultAt(leaning, 5, 50), 15);
  assert.equal(faultAt(leaning, 13, 50), 20);
  assert.equal(faultAt(leaning, 30, 50), null);
  assert.ok(crosses(leaning, 14, 5, 16, 5, 50));
  assert.ok(!crosses(leaning, 12, 5, 13, 5, 50));
});

test("without the fault a small throw is tracked straight across it; with it the horizon stops there", () => {
  const cube = faulted(2);
  assert.equal(coverage(track(cube, { a: 5, o: 10, s: 40 })), 1);
  const barrier = (a: number, o: number, na: number, no: number, s: number) => crosses(fault, a, o, na, no, s);
  const stopped = track(cube, { a: 5, o: 10, s: 40 }, undefined, barrier);
  // The sticks (inlines 2 and 17, carried 4 bins past each) span every inline here: nothing east of the fault is reached.
  for (let o = 0; o < 20; o++) for (let a = 20; a < 40; a++) assert.ok(Number.isNaN(stopped[o * 40 + a]!), `tracked across at ${a},${o}`);
  assert.equal(coverage(stopped), 0.5);
});

test("a seed across the fault carries the horizon on, and the throw is read from its cut-offs", () => {
  const cube = faulted(6);
  const barrier = (a: number, o: number, na: number, no: number, s: number) => crosses(fault, a, o, na, no, s);
  const grid = track(cube, [{ a: 5, o: 10, s: 40 }, { a: 30, o: 10, s: 46 }], undefined, barrier);
  assert.equal(coverage(grid), 1);
  const cut = cutOffs(grid, 40, 10, fault)!;
  assert.deepEqual([cut.a1, cut.a2], [19, 20]);
  const thrown = throwOf(grid, 40, 20, fault)!;
  assert.ok(Math.abs(thrown.samples - 6) < 0.3, `throw ${thrown.samples}`);
  assert.equal(thrown.inlines, 20);
  // On the map the fault cuts the horizon in one line down every inline, at its along position.
  const lines = faultTrace(grid, 40, 20, fault);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.length, 20);
  assert.ok(lines[0]!.every(([a]) => a === 19.5));
});

test("two sticks make a strip of triangles; one stick makes none", () => {
  const mesh = faultMesh(fault, 12);
  assert.equal(mesh.points.length, 24);
  assert.equal(mesh.triangles.length, 11 * 2 * 3);
  assert.equal(faultMesh(fault.slice(0, 1)).triangles.length, 0);
});
