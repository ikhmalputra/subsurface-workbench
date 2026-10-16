import assert from "node:assert/strict";
import test from "node:test";
import { closedHighs, closure, crestFrom, frameAround, grossRockVolume, levelLines, readCurve, sample, spillDepth, supportOf, thinPlate, trendSurface, volumeCurve } from "../src/data/map-model.ts";
import type { GridFrame } from "../src/data/map-model.ts";
import { inPlace, monteCarlo, tornado, triangular } from "../src/data/volumetrics-model.ts";

test("a thin-plate spline through points on a plane is that plane, and passes through scattered points", () => {
  const plane = (x: number, y: number) => 2000 + 0.01 * x - 0.02 * y;
  const points = [[0, 0], [5000, 300], [1200, 7000], [8000, 8000], [4000, 4100], [6500, 1500]].map(([x, y]) => ({ x: x!, y: y!, z: plane(x!, y!) }));
  const f = thinPlate(points, 0);
  for (const [x, y] of [[2500, 2500], [9000, -1000], [100, 6000]]) assert.ok(Math.abs(f(x!, y!) - plane(x!, y!)) < 1e-6, `at ${x},${y}`);
  const bumpy = points.map((p, i) => ({ ...p, z: p.z + (i % 2 ? 40 : -40) }));
  const g = thinPlate(bumpy, 0);
  for (const p of bumpy) assert.ok(Math.abs(g(p.x, p.y) - p.z) < 1e-6);
});

/** A dome: 2000 m at its crest at (0, 0), deepening as r²/1000 (so 10 m deeper 100 m out). */
const frame: GridFrame = { x0: -2000, y0: -2000, cell: 25, nx: 161, ny: 161 };
const dome = sample(frame, (x, y) => 2000 + (x * x + y * y) / 1000);
const thick = new Float32Array(dome.length).fill(1e6);

test("from anywhere on the dome, uphill leads to its crest; the closure stays inside the map until it spills", () => {
  const crest = crestFrom(dome, frame, 3 * frame.nx + 5);
  assert.equal(crest, 80 * frame.nx + 80);
  assert.ok(!closure(dome, frame, crest, 3000).leaks);
  assert.ok(closure(dome, frame, crest, 6100).leaks);
  // It spills where the dome first meets the edge: 2000 m out, at 2000 + 4000 m.
  assert.ok(Math.abs(spillDepth(dome, frame, crest)! - 6000) <= 1);
});

test("the rock volume above a contact on the dome is the paraboloid's, π·a·h²/2", () => {
  const crest = crestFrom(dome, frame, 0);
  const h = 900, contact = 2000 + h, exact = Math.PI * 1000 * h * h / 2;
  const volume = grossRockVolume(dome, thick, frame, closure(dome, frame, crest, contact).mask, contact);
  assert.ok(Math.abs(volume - exact) / exact < 0.02, `${volume} vs ${exact}`);
  // A zone 50 m thick holds less: the slab between the top and 50 m below it, cut by the contact.
  const slab = grossRockVolume(dome, new Float32Array(dome.length).fill(50), frame, closure(dome, frame, crest, contact).mask, contact);
  assert.ok(slab < volume && slab > 0);
  const curve = volumeCurve(dome, thick, frame, crest, 2900, 10);
  assert.equal(curve.volumes[0], 0);
  assert.ok(Math.abs(readCurve(curve.contacts, curve.volumes, 2900) - volume) < 1);
});

test("the contact's outline on the dome is one closed ring at its radius", () => {
  const crest = crestFrom(dome, frame, 0), contact = 2900;
  const lines = levelLines(dome, frame, contact, closure(dome, frame, crest, contact).mask);
  assert.equal(lines.length, 1);
  const ring = lines[0]!;
  assert.deepEqual(ring[0], ring.at(-1));
  for (const [x, y] of ring) assert.ok(Math.abs(Math.hypot(x, y) - Math.sqrt(900 * 1000)) < 15);
});

test("a frame pads the points and keeps square cells", () => {
  const f = frameAround([{ x: 0, y: 0 }, { x: 10000, y: 5000 }], 50);
  assert.ok(f.x0 < 0 && f.y0 < 0 && f.x0 + (f.nx - 1) * f.cell >= 10000 && f.y0 + (f.ny - 1) * f.cell >= 5000);
});

test("a triangular range runs from low through its mode to high", () => {
  const r = { low: 0.1, mode: 0.2, high: 0.4 };
  assert.equal(triangular(r, 0), 0.1);
  assert.equal(triangular(r, 1), 0.4);
  assert.ok(Math.abs(triangular(r, 1 / 3) - 0.2) < 1e-12);
});

test("Monte Carlo: fixed inputs give one answer; ranges give P90 ≤ P50 ≤ P10, the same every time", () => {
  const fixed = (v: number) => ({ low: v, mode: v, high: v });
  const rock = (contact: number) => (contact - 2000) * 1e6;
  const one = monteCarlo({ rock, contact: fixed(2100), ntg: fixed(0.7), porosity: fixed(0.25), sw: fixed(0.3), fvf: fixed(1.2) }, 200);
  const exact = inPlace(1e8, 0.7, 0.25, 0.3, 1.2);
  assert.ok(Math.abs(one.p90 - exact) < 1e-3 && Math.abs(one.p10 - exact) < 1e-3);
  const ranged = { rock, contact: { low: 2050, mode: 2100, high: 2140 }, ntg: { low: 0.5, mode: 0.7, high: 0.85 }, porosity: { low: 0.18, mode: 0.24, high: 0.3 }, sw: { low: 0.2, mode: 0.3, high: 0.5 }, fvf: { low: 1.1, mode: 1.2, high: 1.35 } };
  const a = monteCarlo(ranged), b = monteCarlo(ranged);
  assert.ok(a.p90 < a.p50 && a.p50 < a.p10);
  assert.equal(a.p50, b.p50);
  // The contact moves the rock volume most here.
  assert.equal(tornado(ranged)[0]!.name, "contact");
});

test("the trend surface honours every well, invents no high beyond them, and is the regional dip far away", () => {
  // Sparse wells on a dipping plane with one well 300 m high: a spline alone overshoots around it.
  const plane = (x: number) => 2500 + 0.02 * x;
  const points = [[0, 0], [10000, 0], [0, 10000], [10000, 10000], [5000, 5000], [5000, 0], [0, 5000]].map(([x, y], i) => ({ x: x!, y: y!, z: plane(x!) - (i === 4 ? 300 : 0) }));
  const f = trendSurface(points);
  for (const p of points) assert.ok(Math.abs(f(p.x, p.y) - p.z) < 1e-6);
  const shallowest = Math.min(...points.map((p) => p.z));
  for (let x = -5000; x <= 15000; x += 500) for (let y = -5000; y <= 15000; y += 500) assert.ok(f(x, y) >= shallowest - 1, `a high at ${x},${y}: ${f(x, y)}`);
  const g = thinPlate(points.filter((_, i) => i !== 4), 0);
  assert.ok(Math.abs(f(80000, 5000) - g(80000, 5000)) < 200, "far off, the regional dip");
});

test("a closure that runs off the supported area leaks; highs of one structure are one prospect", () => {
  // Two peaks on one dome: 2000 m at (0, 0) and 2005 m at (400, 0), joined above 2020 m.
  const twin = sample(frame, (x, y) => Math.min(2000 + (x * x + y * y) / 1000, 2005 + ((x - 400) ** 2 + y * y) / 1000));
  const highs = closedHighs(twin, frame);
  assert.equal(highs.length, 1);
  assert.equal(highs[0]!.crest, 80 * frame.nx + 80);
  const support = supportOf(frame, [{ x: 0, y: 0 }], 600);
  const crest = crestFrom(twin, frame, 0, support);
  assert.ok(support[crest]);
  assert.ok(closure(twin, frame, highs[0]!.crest, 2300, support).leaks, "past 600 m from the well the map has no say");
  assert.ok(!closure(twin, frame, highs[0]!.crest, 2300).leaks);
});

test("a range typed out of order is read as its least, middle and greatest", () => {
  const shuffled = { low: 0.3, mode: 0.1, high: 0.2 };
  for (const u of [0, 0.25, 0.5, 0.75, 1]) { const v = triangular(shuffled, u); assert.ok(v >= 0.1 && v <= 0.3, `${v}`); }
});

test("an out-of-order range gives the same most likely volume and tornado as the ordered one", () => {
  const rock = (contact: number) => (contact - 2000) * 1e6;
  const base = { rock, contact: { low: 2050, mode: 2100, high: 2140 }, porosity: { low: 0.18, mode: 0.24, high: 0.3 }, sw: { low: 0.2, mode: 0.3, high: 0.5 }, fvf: { low: 1.1, mode: 1.2, high: 1.35 } };
  const a = monteCarlo({ ...base, ntg: { low: 0.2, mode: 0.6, high: 0.7 } }), b = monteCarlo({ ...base, ntg: { low: 0.7, mode: 0.2, high: 0.6 } });
  assert.equal(a.mostLikely, b.mostLikely);
  assert.deepEqual(tornado({ ...base, ntg: { low: 0.2, mode: 0.6, high: 0.7 } }), tornado({ ...base, ntg: { low: 0.7, mode: 0.2, high: 0.6 } }));
});

test("wells at one place do not break the map", () => {
  const points = [{ x: 0, y: 0, z: 2000 }, { x: 0, y: 0, z: 2010 }, { x: 5000, y: 0, z: 2100 }, { x: 5000, y: 0, z: 2100 }, { x: 0, y: 5000, z: 2200 }];
  const f = trendSurface(points);
  for (const [x, y] of [[0, 0], [2500, 2500], [5000, 0]]) assert.ok(Number.isFinite(f(x!, y!)));
  assert.ok(Math.abs(f(0, 0) - 2005) < 1e-6, "the mean of the two depths there");
});
