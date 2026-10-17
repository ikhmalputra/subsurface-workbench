import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { crsFromReference, datumShiftOf, ensureCrs, gridConvergenceAtDeg, knownCrs, registerCrs, reprojectGisXY } from "./gis.ts";

/** Degrees, minutes and seconds to degrees. */
const dms = (d: number, m: number, s: number, sign = 1) => sign * (d + m / 60 + s / 3600);
/** Metres between two WGS 84 points a few hundred metres apart, by the equirectangular approximation. */
const apart = (a: readonly [number, number], b: readonly [number, number]) => Math.hypot((b[0] - a[0]) * 111_320 * Math.cos((a[1] + b[1]) / 2 * Math.PI / 180), (b[1] - a[1]) * 110_574);

test("an EPSG code outside the built-in set must be ensured first; then it works, and unknown codes are named", async () => {
  assert.throws(() => reprojectGisXY([450000, 6400000], "EPSG:23031", "EPSG:4326"), /ensureCrs\(\["EPSG:23031"\]\)/);
  assert.deepEqual(await ensureCrs(["EPSG:23031", "EPSG:27700", "EPSG:4277", "EPSG:32040", "EPSG:4267", "EPSG:2154", "EPSG:999999", "EPSG:32631"]), ["EPSG:999999"]);
  assert.equal(knownCrs("EPSG:23031")?.name, "ED50 / UTM zone 31N");
  assert.equal(knownCrs("EPSG:999999"), null);
  // Round trip on a projected CRS holds to a millimetre.
  const [lon, lat] = reprojectGisXY([450397.3, 6406647.5], "EPSG:23031", "EPSG:4326");
  const [e, n] = reprojectGisXY([lon, lat], "EPSG:4326", "EPSG:23031");
  assert.ok(Math.abs(e - 450397.3) < 1e-3 && Math.abs(n - 6406647.5) < 1e-3);
});

test("IOGP Guidance Note 7-2 worked examples: Transverse Mercator (OSGB36) and Lambert Conic Conformal 2SP (NAD27 Texas South Central), projection only", async () => {
  await ensureCrs(["EPSG:4277", "EPSG:27700", "EPSG:4267", "EPSG:32040"]);
  // OSGB36 / British National Grid: 50°30'00"N 00°30'00"E → E 577274.99 m, N 69740.50 m.
  const osgb = reprojectGisXY([dms(0, 30, 0), dms(50, 30, 0)], "EPSG:4277", "EPSG:27700");
  assert.ok(Math.abs(osgb[0] - 577274.99) < 0.01 && Math.abs(osgb[1] - 69740.50) < 0.01, `${osgb}`);
  // NAD27 / Texas South Central (US survey feet): 28°30'00"N 96°00'00"W → E 2963503.91 ft, N 254759.80 ft.
  const texas = reprojectGisXY([dms(96, 0, 0, -1), dms(28, 30, 0)], "EPSG:4267", "EPSG:32040");
  assert.ok(Math.abs(texas[0] - 2963503.91) < 0.02 && Math.abs(texas[1] - 254759.80) < 0.02, `${texas}`);
});

test("a datum shift is approximated by the published Helmert, and is said so: FORCE's ED50 wellheads land within 5 m of the positions the Directorate's own shift gave", async () => {
  await ensureCrs(["EPSG:23031"]);
  const index = JSON.parse(readFileSync(new URL("../../fixtures/data/force2020/wells.json", import.meta.url), "utf8")) as { wells: { utm: [number, number] | null; lonLat: [number, number] | null }[] };
  let worst = 0, checked = 0;
  for (const well of index.wells.slice(0, 40)) {
    if (!well.utm || !well.lonLat) continue;
    worst = Math.max(worst, apart(reprojectGisXY(well.utm, "EPSG:23031", "EPSG:4326"), well.lonLat));
    checked++;
  }
  assert.ok(checked >= 30 && worst < 5, `${checked} wells, worst ${worst.toFixed(2)} m`);
  assert.match(datumShiftOf("EPSG:23031")!, /Helmert/);
  assert.match(datumShiftOf("EPSG:32631")!, /WGS 84 datum/);
  assert.match(datumShiftOf("EPSG:27700")!, /about 2 m/);
});

test("grid convergence by projection: equal to the transverse-Mercator formula on UTM, and to n·Δλ on a Lambert grid, with the sign of grid north east of true north", async () => {
  await ensureCrs(["EPSG:2154"]);
  // UTM 31N (central meridian 3°E) at 5°E 60°N: the transverse-Mercator formula atan(tan Δλ · sin φ) = 1.7322°.
  const rad = Math.PI / 180, formula = (dLon: number, lat: number) => Math.atan(Math.tan(dLon * rad) * Math.sin(lat * rad)) / rad;
  assert.ok(Math.abs(gridConvergenceAtDeg("EPSG:32631", 5, 60) - formula(2, 60)) < 1e-3, `${gridConvergenceAtDeg("EPSG:32631", 5, 60)}`);
  assert.ok(Math.abs(gridConvergenceAtDeg("EPSG:32631", 3, 60)) < 1e-6, "none on the central meridian");
  assert.ok(Math.abs(gridConvergenceAtDeg("EPSG:32631", 1, 60) - formula(-2, 60)) < 1e-3, "west of the meridian it turns the other way");
  // Lambert-93 (RGF93, LCC 2SP 44°/49°, origin 3°E): the cone constant n = 0.7256077650, so at 5°E γ = 2° · n = 1.4512°.
  assert.ok(Math.abs(gridConvergenceAtDeg("EPSG:2154", 5, 48) - 2 * 0.725607765) < 1e-3);
  // In the southern hemisphere the sense flips: UTM 50S at 119°E 1°S, east of the 117° meridian.
  assert.ok(gridConvergenceAtDeg("EPSG:32750", 119, -1) < 0);
});

test("the standards' CRS references all read to an EPSG code", () => {
  assert.equal(crsFromReference("opendes:reference-data--CoordinateReferenceSystem:Projected:EPSG::23031:"), "EPSG:23031");
  assert.equal(crsFromReference("osdu:reference-data--CoordinateReferenceSystem:BoundProjected:EPSG::23031_1311:"), "EPSG:23031");
  assert.equal(crsFromReference("urn:ogc:def:crs:EPSG::4326"), "EPSG:4326");
  assert.equal(crsFromReference("urn:ogc:def:crs:EPSG:8.9:27700"), "EPSG:27700");
  assert.equal(crsFromReference("EPSG:32631"), "EPSG:32631");
  assert.equal(crsFromReference("32631"), "EPSG:32631");
  assert.equal(crsFromReference("ED50 / UTM zone 31N"), null);
  assert.equal(crsFromReference(null), null);
});

test("a tenant's own CRS is registered by code, checked, and reports no datum shift unless it names one", () => {
  assert.throws(() => registerCrs("field grid", "+proj=tmerc"), /looks like/);
  assert.throws(() => registerCrs("LOCAL:grid", "not a projection"), /\+proj=/);
  registerCrs("LOCAL:grid", "+proj=tmerc +lat_0=0 +lon_0=3 +k=0.9996 +x_0=500000 +y_0=0 +ellps=intl +units=m +no_defs");
  assert.match(datumShiftOf("LOCAL:grid")!, /no datum shift/);
  const [e, n] = reprojectGisXY([3, 0], "EPSG:4326", "LOCAL:grid");
  assert.ok(Math.abs(e - 500000) < 1e-6 && Math.abs(n) < 1e-6);
  registerCrs("LOCAL:grid-shifted", "+proj=tmerc +lat_0=0 +lon_0=3 +k=0.9996 +x_0=500000 +y_0=0 +ellps=intl +towgs84=-87,-98,-121 +units=m +no_defs", { shiftAccuracyM: 3 });
  assert.match(datumShiftOf("LOCAL:grid-shifted")!, /Helmert.*about 3 m/);
});
