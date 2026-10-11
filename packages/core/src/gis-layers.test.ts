import assert from "node:assert/strict";
import test from "node:test";
import { writeArrayBuffer } from "geotiff";
import { gisAreaM2, gisDistanceM, importGisGeoJson, importGisGeoTiff, reprojectGisXY } from "./gis.ts";

test("local GeoJSON retains IDs, nested attributes and polygon holes while reprojecting UTM", () => {
  const point = reprojectGisXY([114.2, 0.4], "EPSG:4326", "EPSG:32650");
  const result = importGisGeoJson({ type: "FeatureCollection", features: [
    { type: "Feature", id: "head", properties: { name: "Survey", nested: { source: "local" } }, geometry: { type: "Point", coordinates: point } },
    { type: "Feature", id: 2, properties: null, geometry: { type: "Polygon", coordinates: [
      [[500000, 0], [501000, 0], [501000, 1000], [500000, 0]],
      [[500100, 100], [500200, 100], [500200, 200], [500100, 100]],
    ] } },
  ] }, "EPSG:32650");
  assert.equal(result.vector.features[0]!.id, "head");
  assert.deepEqual(result.vector.features[0]!.properties, { name: "Survey", nested: { source: "local" } });
  const geometry = result.vector.features[0]!.geometry;
  assert.equal(geometry.type, "Point");
  if (geometry.type === "Point") assert.ok(Math.abs(geometry.coordinates[0]! - 114.2) < 1e-9);
  assert.equal(result.vector.features[1]!.geometry.coordinates.length, 2);
});

test("vector imports accept all six supported geometry types and reject ambiguous or invalid input", () => {
  for (const geometry of [
    { type: "Point", coordinates: [0, 0] },
    { type: "MultiPoint", coordinates: [[0, 0], [1, 1]] },
    { type: "LineString", coordinates: [[0, 0], [1, 1]] },
    { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]]] },
    { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    { type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] },
  ]) assert.equal(importGisGeoJson(geometry, "EPSG:4326").vector.features[0]!.geometry.type, geometry.type);
  assert.throws(() => importGisGeoJson({ type: "Point", coordinates: [0, 0, 5] }, "EPSG:4326"), /two-dimensional/);
  assert.throws(() => importGisGeoJson({ type: "Point", coordinates: [NaN, 0] }, "EPSG:4326"), /finite/);
  assert.throws(() => importGisGeoJson({ type: "Point", coordinates: [0, 0], crs: {} }, "EPSG:4326"), /Legacy/);
  assert.throws(() => importGisGeoJson({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }, "EPSG:4326"), /close/);
  assert.throws(() => importGisGeoJson({ type: "LineString", coordinates: [[179, 0], [-179, 0]] }, "EPSG:4326"), /Antimeridian/);
  assert.throws(() => importGisGeoJson({ type: "GeometryCollection", geometries: [] }, "EPSG:4326"), /Supported/);
  const feature = { type: "Feature", id: 1, geometry: { type: "Point", coordinates: [0, 0] } };
  assert.throws(() => importGisGeoJson({ type: "FeatureCollection", features: [feature, { ...feature, id: "1" }] }, "EPSG:4326"), /unique/);
  assert.throws(() => importGisGeoJson({ type: "FeatureCollection", features: Array(10001).fill(feature) }, "EPSG:4326"), /10,000/);
});

test("spherical measurements meet known distance and area thresholds and validate geography", () => {
  assert.ok(Math.abs(gisDistanceM([[0, 0], [1, 0]]) - 111195.08) < 0.01);
  const area = gisAreaM2([[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]]);
  assert.ok(area > 1236434 && area < 1236435);
  assert.equal(gisDistanceM([]), 0);
  assert.equal(gisAreaM2([[0, 0], [1, 0]]), 0);
  assert.throws(() => gisAreaM2([[179, 0], [-179, 0], [-179, 1]]), /antimeridian/);
  assert.throws(() => gisDistanceM([[0, 0], [0, 90]]), /extent/);
});

function raster(values: number[], overrides: Record<string, unknown> = {}) {
  return writeArrayBuffer(values, { width: 3, height: 3, GeographicTypeGeoKey: 4326, ModelPixelScale: [0.01, 0.01, 0], ModelTiepoint: [0, 0, 0, 114.2, 0.43, 0], PhotometricInterpretation: 1, ...overrides });
}

test("GeoTIFF numeric import preserves metre values, masks NoData and checks CRS / vertical datum", async () => {
  const buffer = raster([100, 110, 120, 130, 255, 150, 160, 170, 180], { GDAL_NODATA: "255" });
  const result = await importGisGeoTiff(buffer, { sourceCrs: "EPSG:4326", mode: "depth", verticalDatum: "MSL" });
  assert.equal(result.raster.verticalDatum, "MSL");
  assert.equal(result.raster.width, 3);
  assert.equal(result.raster.min, 100); assert.equal(result.raster.max, 180);
  assert.ok(Number.isNaN(result.raster.values![4]));
  assert.equal(result.raster.rgba[19], 0);
  assert.ok(Math.abs(result.raster.corners[0][0] - 114.2) < 1e-8);
  await assert.rejects(importGisGeoTiff(buffer, { sourceCrs: "EPSG:3857", mode: "imagery" }), /match/);
  await assert.rejects(importGisGeoTiff(buffer, { sourceCrs: "EPSG:4326", mode: "depth" }), /datum/);
  await assert.rejects(importGisGeoTiff(raster(Array(9).fill(255), { GDAL_NODATA: "255" }), { sourceCrs: "EPSG:4326", mode: "imagery" }), /no valid/);
});

test("projected GeoTIFF uses an inverse-warped Mercator grid rather than corner stretching", async () => {
  const buffer = raster([10, 20, 30, 40, 50, 60, 70, 80, 90], { GeographicTypeGeoKey: undefined, ProjectedCSTypeGeoKey: 32650, ModelPixelScale: [100, 100, 0], ModelTiepoint: [0, 0, 0, 200000, 1000000, 0] });
  const result = await importGisGeoTiff(buffer, { sourceCrs: "EPSG:32650", mode: "elevation", verticalDatum: "MSL" });
  assert.equal(result.raster.values!.length, 9);
  assert.equal(result.raster.corners[0][0], result.raster.corners[3][0]);
  assert.equal(result.raster.corners[0][1], result.raster.corners[1][1]);
  assert.ok(result.raster.values!.some(Number.isFinite));
});

test("16-bit depth and floating-point elevations are decoded without byte truncation", async () => {
  for (const values of [new Uint16Array([1000, 1100, 1200, 1300]), new Float32Array([-1000.5, -1100.5, -1200.5, -1300.5])]) {
    const buffer = writeArrayBuffer(values, { width: 2, height: 2, GeographicTypeGeoKey: 4326, ModelPixelScale: [0.01, 0.01, 0], ModelTiepoint: [0, 0, 0, 114.2, 0.43, 0], PhotometricInterpretation: 1 });
    const result = await importGisGeoTiff(buffer, { sourceCrs: "EPSG:4326", mode: values instanceof Float32Array ? "elevation" : "depth", verticalDatum: "MSL" });
    assert.deepEqual([...result.raster.values!], [...values]);
  }
});

test("GeoTIFF georeferencing accounts for non-zero raster tiepoints and pixel-is-point centres", async () => {
  const result = await importGisGeoTiff(raster(Array(9).fill(100), { ModelTiepoint: [1, 1, 0, 114.21, 0.42, 0] }), { sourceCrs: "EPSG:4326", mode: "imagery" });
  assert.ok(Math.abs(result.raster.sourceBounds[0] - 114.2) < 1e-9);
  assert.ok(Math.abs(result.raster.sourceBounds[3] - 0.43) < 1e-9);
  const point = await importGisGeoTiff(raster(Array(9).fill(100), { GTRasterTypeGeoKey: 2 }), { sourceCrs: "EPSG:4326", mode: "imagery" });
  assert.ok(Math.abs(point.raster.sourceBounds[0] - 114.195) < 1e-9);
  assert.ok(Math.abs(point.raster.sourceBounds[3] - 0.435) < 1e-9);
});
