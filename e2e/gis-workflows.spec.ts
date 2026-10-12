import { expect, test } from "@playwright/test";
import { writeArrayBuffer } from "../packages/core/node_modules/geotiff/dist-module/geotiff.js";
import { gotoApp } from "./support/app";

test("local vectors support CRS import, styles, identify, measurement and Field navigation persistence", async ({ page }) => {
  const errors: string[] = [], external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (!request.url().startsWith("http://127.0.0.1:3101/")) external.push(request.url()); });
  await gotoApp(page, "/map/");
  await expect(page.getByTestId("gis-map")).toHaveAttribute("data-ready", "true");
  const tools = page.getByTestId("gis-tools");
  const file = { type: "FeatureCollection", features: [{ type: "Feature", id: "permit-1", properties: { name: "Local permit", operator: "Test", pressure: null }, geometry: { type: "Polygon", coordinates: [[[114.19, 0.39], [114.21, 0.39], [114.21, 0.41], [114.19, 0.41], [114.19, 0.39]]] } }] };
  await tools.getByLabel("Import local GIS file").setInputFiles({ name: "permit.geojson", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
  await expect(tools.getByText("Layer stack · 1")).toBeVisible();
  await tools.getByRole("button", { name: "Fit permit.geojson" }).click();
  await tools.getByLabel("Coordinate pair (X, Y)").fill("114.2, 0.4");
  await tools.getByRole("button", { name: "Go to coordinates" }).click();
  const canvas = page.getByTestId("gis-map").locator("canvas");
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(tools.getByTestId("gis-identification")).toContainText("Local permit");
  await expect(tools.getByTestId("gis-identification")).toContainText("permit-1");
  await expect(tools.getByTestId("gis-identification")).toContainText("pressure");
  await expect(tools.getByTestId("gis-identification")).toContainText("null");
  await tools.getByLabel("Show permit.geojson").uncheck();
  await expect(tools.getByLabel("Show permit.geojson")).not.toBeChecked();
  await tools.getByLabel("Show permit.geojson").check();
  await tools.getByLabel("Opacity permit.geojson").fill("0.5");
  await tools.screenshot({ path: "output/playwright/local-gis-tools.png" });
  await tools.getByLabel("GIS tool").selectOption("distance");
  for (const pair of ["0, 0", "0.01, 0"]) {
    await tools.getByLabel("Coordinate pair (X, Y)").fill(pair);
    await tools.getByRole("button", { name: "Add measurement vertex" }).click();
  }
  await expect(tools.getByTestId("gis-measurement")).toContainText("1112.0 m");
  await tools.getByRole("button", { name: "Finish measurement" }).click();
  await canvas.click({ position: { x: 150, y: 150 } });
  await expect(tools.getByTestId("gis-measurement")).toContainText("2 vertices · Finished");
  await expect(page.getByTestId("gis-map")).toHaveAttribute("data-selected-md", "");
  await tools.getByLabel("GIS tool").selectOption("area");
  for (const pair of ["0, 0", "0.01, 0", "0.01, 0.01", "0, 0.01"]) {
    await tools.getByLabel("Coordinate pair (X, Y)").fill(pair);
    await tools.getByRole("button", { name: "Add measurement vertex" }).click();
  }
  await expect(tools.getByTestId("gis-measurement")).toContainText("1236434.6 m²");
  await tools.getByRole("button", { name: "Undo vertex" }).click();
  await expect(tools.getByTestId("gis-measurement")).toContainText("3 vertices");
  await page.getByRole("link", { name: "2 · Compare intervals", exact: true }).click();
  await page.getByRole("link", { name: "1 · Locate wells", exact: true }).click();
  await expect(tools.getByText("Layer stack · 1")).toBeVisible();
  await expect(tools.getByLabel("Opacity permit.geojson")).toHaveValue("0.5");
  await expect(tools.getByTestId("gis-measurement")).toContainText("3 vertices");
  await tools.getByRole("button", { name: "Remove permit.geojson" }).click();
  await expect(tools.getByText("Layer stack · 0")).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(1);
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test("invalid imports report errors and a projected local vector fits on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, "/map/");
  await expect(page.getByTestId("gis-map")).toHaveAttribute("data-ready", "true");
  const tools = page.getByTestId("gis-tools");
  await tools.getByLabel("Import local GIS file").setInputFiles({ name: "invalid.geojson", mimeType: "application/json", buffer: Buffer.from('{"type":"Point","coordinates":[0,0,5]}') });
  await expect(tools.getByRole("alert")).toContainText("two-dimensional");
  await tools.getByLabel("Source / coordinate CRS").selectOption("EPSG:32650");
  await tools.getByLabel("Import local GIS file").setInputFiles({ name: "utm.geojson", mimeType: "application/json", buffer: Buffer.from('{"type":"Feature","id":"wellhead","properties":{"source":"local UTM"},"geometry":{"type":"Point","coordinates":[500000,0]}}') });
  await expect(tools.getByRole("alert")).toHaveCount(0);
  await tools.getByRole("button", { name: "Fit utm.geojson" }).click();
  await tools.getByText("Feature attributes · 1").click();
  await tools.getByLabel("Inspect feature in utm.geojson").selectOption("wellhead");
  await expect(tools.getByTestId("gis-identification")).toContainText("local UTM");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("local TIFF renders, samples and replaces the illustrative seabed on the same map canvas", async ({ page }) => {
  const errors: string[] = [], external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (!request.url().startsWith("http://127.0.0.1:3101/")) external.push(request.url()); });
  await gotoApp(page, "/map/");
  await expect(page.getByTestId("gis-map")).toHaveAttribute("data-3d-ready", "true");
  const tools = page.getByTestId("gis-tools"), canvas = page.getByTestId("gis-map").locator("canvas");
  await tools.getByLabel("GeoTIFF use").selectOption("depth");
  await tools.getByLabel("Vertical datum (metres)").fill("MSL");
  const buffer = writeArrayBuffer(new Uint16Array([1000, 1050, 1100, 1100, 1200, 1300, 1200, 1250, 1300]), { width: 3, height: 3, GeographicTypeGeoKey: 4326, ModelPixelScale: [0.01, 0.01, 0], ModelTiepoint: [0, 0, 0, 114.185, 0.415, 0], PhotometricInterpretation: 1 });
  await tools.getByLabel("Import local GIS file").setInputFiles({ name: "seabed.tif", mimeType: "image/tiff", buffer: Buffer.from(buffer) });
  await expect(tools.getByRole("alert")).toHaveCount(0);
  await expect(tools.getByText("Layer stack · 1")).toBeVisible();
  await tools.getByRole("button", { name: "Fit seabed.tif" }).click();
  await tools.getByLabel("Coordinate pair (X, Y)").fill("114.2, 0.4");
  await tools.getByRole("button", { name: "Go to coordinates" }).click();
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(tools.getByTestId("gis-identification")).toContainText("1200");
  await expect(tools.getByTestId("gis-identification")).toContainText("MSL");
  await tools.getByLabel(/I confirm the bathymetry datum/).check();
  await tools.getByRole("button", { name: "Use seabed.tif as 3D seabed" }).click();
  await expect(canvas).toHaveAttribute("data-bathymetry-triangles", "8");
  await page.getByRole("button", { name: "Toggle map perspective" }).click();
  await expect(page.locator("canvas")).toHaveCount(1);
  await canvas.screenshot({ path: "output/playwright/local-gis-bathymetry.png" });
  await tools.getByRole("button", { name: "Restore illustrative environment" }).click();
  await expect(canvas).toHaveAttribute("data-bathymetry-triangles", "0");
  expect(errors).toEqual([]); expect(external).toEqual([]);
});
