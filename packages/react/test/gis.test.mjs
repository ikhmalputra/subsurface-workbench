import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createSubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import { GisMap } from "../dist/gis-map.js";
import maplibre from "maplibre-gl";
import { prepareGisDocument } from "@ikhmalputra/subsurface-core/gis";
import { makeGisTrajectoryLayer } from "../dist/gis-trajectories.js";
import { seabedDepthAt } from "../dist/offshore-environment.js";
import { makeGisBathymetry } from "../dist/gis-bathymetry.js";
import { reprojectGisXY } from "@ikhmalputra/subsurface-core/gis";

test("GIS entry point server-renders controls without importing a browser engine or creating workers", () => {
  const document = {
    version: 1, id: "server-render",
    wells: [{
      id: "a", label: "Test well", crs: "EPSG:32631",
      depthDatum: "RKB", source: "Test survey", provenance: "synthetic",
      xyz: new Float64Array([500000, 0, 0, 500100, 0, 100]),
      depthsMdM: new Float64Array([0, 105]),
    }],
    layers: [],
  };
  const html = renderToStaticMarkup(createElement(GisMap, {
    document, store: createSubsurfaceStore(), workerUrl: "/gis/maplibre-gl-csp-worker.js",
  }));
  assert.match(html, /data-ready="false"/);
  assert.match(html, /No basemap supplied/);
  assert.match(html, /Survey station/);
  assert.match(html, /EPSG:32631/);
});

test("continuous linked MD keeps its value while the map labels the nearest source station", () => {
  const store = createSubsurfaceStore();
  store.pinDepth("a", 60.5);
  const html = renderToStaticMarkup(createElement(GisMap, {
    document: { version: 1, id: "continuous-depth", layers: [], wells: [{
      id: "a", label: "Test well", crs: "EPSG:32631", depthDatum: "RKB", source: "Test survey", provenance: "synthetic",
      xyz: new Float64Array([500000, 0, 0, 500100, 0, 100]), depthsMdM: new Float64Array([0, 105]),
    }] },
    store, workerUrl: "/gis/maplibre-gl-csp-worker.js",
  }));
  assert.match(html, /data-selected-md="60.5"/);
  assert.match(html, /data-marker-md="105"/);
  assert.match(html, /nearest supplied station: 105.0 m MD/);
  assert.equal(store.getState().activeAsset.depth_md, 60.5);
});

test("embedded 3D rejects inconsistent identities, vertical datum, positions and water depth", () => {
  const model = prepareGisDocument({ version: 1, id: "validation", layers: [], wells: [{
    id: "a", label: "A", crs: "EPSG:32631", depthDatum: "seabed", source: "Test", provenance: "synthetic",
    xyz: new Float64Array([500000, 0, 0, 500000, 0, 100]), depthsMdM: new Float64Array([0, 100]),
  }] });
  const design = { id: "a", revision: 1, units: "m", provenance: "synthetic", depthDatum: "seabed", casingBottomM: 0, totalDepthM: 100, components: [],
    survey: [0, 100].map((mdM) => ({ mdM, tvdM: mdM, eastingM: 0, northingM: 0, inclinationDeg: 0, azimuthDeg: 0 })) };
  const entry = { design, waterDepthM: 800 };
  const make = (entries) => makeGisTrajectoryLayer(model, entries, maplibre.MercatorCoordinate, assert.fail);
  assert.throws(() => make([entry, entry]), /unique/);
  assert.throws(() => make([{ ...entry, waterDepthM: -1 }]), /non-negative/);
  assert.throws(() => make([{ ...entry, design: { ...design, id: "unknown" } }]), /matching wells/);
  assert.throws(() => make([{ ...entry, design: { ...design, depthDatum: "sea surface" } }]), /datum/);
  assert.throws(() => make([{ ...entry, design: { ...design, survey: design.survey.map((point) => ({ ...point, tvdM: point.tvdM + 800 })) } }]), /positions/);
  assert.throws(() => make([{ ...entry, markers: [{ label: "outside", mdM: 101 }] }]), /in-range/);
});

test("illustrative seabed exactly anchors supplied water depths without inventing extra evidence", () => {
  const anchors = [{ x: 0, y: 0, depthM: 800 }, { x: 1000, y: 0, depthM: 1200 }];
  assert.equal(seabedDepthAt(anchors, 0, 0), 800);
  assert.equal(seabedDepthAt(anchors, 1000, 0), 1200);
  assert.ok(Math.abs(seabedDepthAt(anchors, 500, 0) - 1000) < 1e-9);
  assert.ok(seabedDepthAt(anchors, 250, 500) >= 800 && seabedDepthAt(anchors, 250, 500) <= 1200);
  assert.throws(() => seabedDepthAt([], 0, 0), /anchors/);
  assert.throws(() => seabedDepthAt([{ x: 0, y: 0, depthM: -1 }], 0, 0), /non-negative/);
});

test("imported bathymetry positions positive-down depth and positive-up elevation identically and excludes NoData", () => {
  const origin = maplibre.MercatorCoordinate.fromLngLat([114.2, 0.4], 0);
  const scale = origin.meterInMercatorCoordinateUnits();
  const a = reprojectGisXY([114.2, 0.4], "EPSG:4326", "EPSG:3857");
  const b = reprojectGisXY([114.21, 0.41], "EPSG:4326", "EPSG:3857");
  const raster = { width: 2, height: 2, rgba: new Uint8ClampedArray(16).fill(255), displayBounds: [a[0], a[1], b[0], b[1]], verticalDatum: "MSL", values: new Float64Array([1000, 1100, 1200, 1300]), mode: "depth" };
  const depth = makeGisBathymetry(raster, maplibre.MercatorCoordinate, origin, scale);
  const elevation = makeGisBathymetry({ ...raster, mode: "elevation", values: new Float64Array([-1000, -1100, -1200, -1300]) }, maplibre.MercatorCoordinate, origin, scale);
  assert.deepEqual([...depth.mesh.geometry.getAttribute("position").array], [...elevation.mesh.geometry.getAttribute("position").array]);
  assert.equal(depth.triangles, 2);
  assert.ok(depth.bounds.max.z < -999);
  const holes = makeGisBathymetry({ ...raster, values: new Float64Array([NaN, 1100, 1200, 1300]) }, maplibre.MercatorCoordinate, origin, scale);
  assert.equal(holes.triangles, 1);
  assert.throws(() => makeGisBathymetry({ ...raster, values: new Float64Array(4).fill(NaN) }, maplibre.MercatorCoordinate, origin, scale), /no complete/);
  assert.throws(() => makeGisBathymetry({ ...raster, verticalDatum: null }, maplibre.MercatorCoordinate, origin, scale), /datum/);
  depth.dispose(); elevation.dispose(); holes.dispose();
});
