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
