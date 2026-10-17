import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteScene, triangulatePlan } from "../dist/site-scene.js";
import { WellsMap } from "../dist/wells-map.js";

test("plan triangulation covers four picks with two triangles and every pick used", () => {
  const triangles = triangulatePlan([[0, 0], [1000, 0], [1000, 800], [0, 800]]);
  assert.equal(triangles.length, 6);
  assert.deepEqual([...new Set(triangles)].sort(), [0, 1, 2, 3]);
  assert.deepEqual(triangulatePlan([[0, 0], [1, 1]]), []);
  // An interior pick splits the hull into four triangles.
  assert.equal(triangulatePlan([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5]]).length, 12);
});

test("the site scene names its wells, surfaces and provenance before any 3D starts", () => {
  const html = renderToStaticMarkup(createElement(SiteScene, {
    title: "Test site", depthLabel: "m below sea surface", originLabel: "field origin",
    wells: [{ id: "a", label: "Well A", provenance: "synthetic", xyz: [0, 0, 800, 100, 0, 2000], mdM: [0, 1210] }],
    surfaces: [{ id: "top", label: "Sand top", provenance: "synthetic", role: "horizon", color: "#d97706", note: "Interpolated between picks. Not a mapped surface.", geometry: { kind: "plane", depthM: 1500 } }],
    seismicNote: "No seismic is supplied for this field.",
  }));
  assert.match(html, /data-testid="site-scene"/);
  assert.match(html, /Well A/);
  assert.match(html, /Sand top/);
  assert.match(html, /Not a mapped surface/);
  assert.match(html, /No seismic is supplied for this field/);
  assert.match(html, /synthetic/);
  assert.match(html, /Origin: field origin · depth m below sea surface/);
});

test("the wells map renders on the server and says when no basemap is supplied", () => {
  const html = renderToStaticMarkup(createElement(WellsMap, { sites: [], workerUrl: "/gis/maplibre-gl-worker.mjs", selectedSiteId: null, selectedWellId: null, onSelect: () => undefined }));
  assert.match(html, /data-testid="wells-map"/);
  assert.match(html, /No basemap supplied: graticule only/);
});

// The previous Bowyer–Watson, kept as the reference: circles recomputed per point, cavity edges compared pairwise.
function referenceTriangulation(points) {
  if (points.length < 3) return [];
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY) || 1, mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
  const all = [...points.map((p) => [p[0], p[1]]), [mx - 20 * span, my - span], [mx, my + 20 * span], [mx + 20 * span, my - span]];
  const n = points.length;
  let triangles = [[n, n + 1, n + 2]];
  const circle = ([a, b, c]) => { const [ax, ay] = all[a], [bx, by] = all[b], [cx, cy] = all[c]; const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)); const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d; const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d; return { x: ux, y: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 }; };
  for (let i = 0; i < n; i++) {
    const [px, py] = all[i];
    const bad = triangles.filter((t) => { const c = circle(t); return (px - c.x) ** 2 + (py - c.y) ** 2 < c.r2; });
    const edges = [];
    for (const t of bad) for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) if (!bad.some((o) => o !== t && [[o[0], o[1]], [o[1], o[2]], [o[2], o[0]]].some(([c, d]) => (c === a && d === b) || (c === b && d === a)))) edges.push([a, b]);
    triangles = triangles.filter((t) => !bad.includes(t));
    for (const [a, b] of edges) triangles.push([a, b, i]);
  }
  return triangles.filter((t) => t.every((k) => k < n)).flat();
}
const triangleSet = (flat) => { const out = []; for (let i = 0; i < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]].sort((a, b) => a - b).join(",")); return out.sort(); };

test("triangulatePlan: the same Delaunay triangles as the reference it replaced, each with an empty circumcircle (its speed is held by tools/stress/throttle.mjs)", () => {
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (const n of [5, 40, 200]) {
    const points = Array.from({ length: n }, () => [random() * 16000, random() * 7500]);
    const fast = triangulatePlan(points);
    assert.deepEqual(triangleSet(fast), triangleSet(referenceTriangulation(points)), `${n} points`);
    for (let t = 0; t < fast.length; t += 3) {
      const [a, b, c] = [points[fast[t]], points[fast[t + 1]], points[fast[t + 2]]];
      const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
      const ux = ((a[0] ** 2 + a[1] ** 2) * (b[1] - c[1]) + (b[0] ** 2 + b[1] ** 2) * (c[1] - a[1]) + (c[0] ** 2 + c[1] ** 2) * (a[1] - b[1])) / d;
      const uy = ((a[0] ** 2 + a[1] ** 2) * (c[0] - b[0]) + (b[0] ** 2 + b[1] ** 2) * (a[0] - c[0]) + (c[0] ** 2 + c[1] ** 2) * (b[0] - a[0])) / d;
      const r2 = (a[0] - ux) ** 2 + (a[1] - uy) ** 2;
      assert.ok(points.every((p) => (p[0] - ux) ** 2 + (p[1] - uy) ** 2 >= r2 * (1 - 1e-9)), "a point inside a triangle's circumcircle");
    }
  }
});
