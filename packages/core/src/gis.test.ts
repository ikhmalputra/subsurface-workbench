import assert from "node:assert/strict";
import test from "node:test";
import { prepareGisDocument, reprojectGisXY, selectGisStation } from "./gis.ts";
import type { GisDocument } from "./gis.ts";
import { createSubsurfaceStore } from "./state.ts";

function fixture(): GisDocument {
  return { version: 1, id: "test-field",
    wells: [{ id: "a", label: "Well A", source: "Test", provenance: "synthetic", crs: "EPSG:32631", depthDatum: "RKB", xyz: new Float64Array([500000, 0, 0, 500100, 100, 500]), depthsMdM: new Float64Array([0, 510]) }],
    layers: [{ id: "boundary", label: "Boundary", source: "Test", provenance: "synthetic", crs: "EPSG:4326", kind: "seismic-footprint", geometry: "Polygon", coordinates: [[2.99, 0], [3.01, 0], [3.01, 0.01], [2.99, 0]], elevationDatum: null }],
  };
}

test("UTM control points and geographic/WebMercator round trips agree to sub-millimetre horizontal tolerance", () => {
  const north = reprojectGisXY([3, 0], "EPSG:4326", "EPSG:32631");
  assert.ok(Math.abs(north[0] - 500000) < 0.0001);
  assert.ok(Math.abs(north[1]) < 0.0001);
  const south = reprojectGisXY([3, 0], "EPSG:4326", "EPSG:32731");
  assert.ok(Math.abs(south[1] - 10000000) < 0.0001);
  const southernPoint = reprojectGisXY([151.2, -33.86], "EPSG:4326", "EPSG:32756");
  const southernRoundTrip = reprojectGisXY(southernPoint, "EPSG:32756", "EPSG:4326");
  assert.ok(Math.abs(southernRoundTrip[0] - 151.2) < 1e-9);
  assert.ok(Math.abs(southernRoundTrip[1] + 33.86) < 1e-9);
  for (const crs of ["EPSG:32650", "EPSG:3857"]) {
    const point = reprojectGisXY([114.231, 5.412], "EPSG:4326", crs);
    const result = reprojectGisXY(point, crs, "EPSG:4326");
    assert.ok(Math.abs(result[0] - 114.231) < 1e-9);
    assert.ok(Math.abs(result[1] - 5.412) < 1e-9);
  }
});

test("mixed layer CRS normalizes horizontally without converting TVD or source coordinates", () => {
  const document = fixture(), before = [...document.wells[0]!.xyz];
  const model = prepareGisDocument(document);
  assert.ok(Math.abs(model.wells[0]!.stations[0]!.geographic[0] - 3) < 1e-10);
  assert.deepEqual(model.layers[0]!.coordinates[0], [2.99, 0]);
  assert.equal(model.wells[0]!.stations[1]!.xyz[2], 500);
  assert.deepEqual([...document.wells[0]!.xyz], before);
});

test("NAD83 / UTM places the Utah FORGE 16A(78)-32 wellhead at Milford, Utah and round-trips", () => {
  const [longitude, latitude] = reprojectGisXY([334637.9, 4263458.9], "EPSG:26912", "EPSG:4326");
  assert.ok(Math.abs(longitude - -112.89643) < 1e-5 && Math.abs(latitude - 38.50416) < 1e-5, `${longitude}, ${latitude}`);
  const back = reprojectGisXY([longitude, latitude], "EPSG:4326", "EPSG:26912");
  assert.ok(Math.abs(back[0] - 334637.9) < 1e-3 && Math.abs(back[1] - 4263458.9) < 1e-3);
});

test("unsupported datum, malformed geometry, non-finite coordinates and unordered MD fail explicitly", () => {
  assert.throws(() => reprojectGisXY([500000, 0], "EPSG:27700", "EPSG:4326"), /Unsupported GIS CRS/);
  assert.throws(() => reprojectGisXY([500000, 0], "EPSG:26930", "EPSG:4326"), /Unsupported GIS CRS/);
  assert.throws(() => reprojectGisXY([0, 90], "EPSG:4326", "EPSG:3857"), /extent/);
  assert.throws(() => reprojectGisXY([0, NaN], "EPSG:4326", "EPSG:3857"), /finite/);
  const document = fixture();
  assert.throws(() => prepareGisDocument({ ...document, layers: [{ ...document.layers[0]!, coordinates: [[0, 0], [1, 0], [1, 1], [0, 1]] }] }), /closed ring/);
  assert.throws(() => prepareGisDocument({ ...document, wells: [{ ...document.wells[0]!, depthsMdM: new Float64Array([0, 0]) }] }), /non-increasing/);
  assert.throws(() => prepareGisDocument({ ...document, layers: [{ ...document.layers[0]!, id: "a" }] }), /unique/);
  assert.throws(() => prepareGisDocument({ ...document, wells: [{ ...document.wells[0]!, crs: "EPSG:4326" }] }), /projected/);
  assert.throws(() => prepareGisDocument({ ...document, layers: [{ ...document.layers[0]!, source: "" }] }), /source/);
  assert.throws(() => prepareGisDocument({ ...document, layers: [{ ...document.layers[0]!, coordinates: [[179, 0], [-179, 0], [-179, 1], [179, 0]] }] }), /Antimeridian/);
});

test("map and scene selection publish exact source-frame XYZ and MD to one store", () => {
  const store = createSubsurfaceStore(), well = fixture().wells[0]!;
  selectGisStation(store, well, 1, "map");
  assert.equal(store.getState().activeAsset.wellId, "a");
  assert.equal(store.getState().depthLink.pinnedMdM, 510);
  assert.deepEqual(store.getState().activeAsset.spatial_xyz, [500100, 100, 500]);
  selectGisStation(store, well, 0, "scene");
  assert.equal(store.getState().depthLink.pinnedMdM, 0);
  assert.deepEqual(store.getState().activeAsset.spatial_xyz, [500000, 0, 0]);
  assert.throws(() => selectGisStation(store, well, 1.5), /index/);
  const before = store.getState();
  assert.throws(() => selectGisStation(store, { ...well, xyz: new Float64Array([0, 0, 0]) }, 1), /finite/);
  assert.equal(store.getState(), before, "invalid station must not partially mutate shared selection");
});
