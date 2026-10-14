import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoApp, openAppearance } from "./support/app";

test("geographic Field map shares four well identities with the underwater scene without external requests", async ({ page }) => {
  const external: string[] = [], errors: string[] = [];
  page.on("request", (request) => { if (!request.url().startsWith("http://127.0.0.1:3101/")) external.push(request.url()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await gotoApp(page, "/map/");
  await page.getByRole("combobox", { name: "Spatial view" }).selectOption("map");
  const gis = page.getByTestId("gis-map");
  await expect(gis).toHaveAttribute("data-ready", "true");
  await expect(gis.locator("canvas")).toHaveAttribute("data-fitting", "false");
  await expect(gis.locator("canvas")).toHaveAttribute("data-visible-trajectories", "4");
  await expect(gis.getByRole("combobox", { name: "Well", exact: true }).locator("option")).toHaveCount(4);
  await gis.getByRole("combobox", { name: "Well", exact: true }).selectOption("offshore-3");
  await gis.getByRole("button", { name: "Select final survey station" }).click();
  await expect(gis).toHaveAttribute("data-selected-md", "2900");
  await expect(gis).toHaveAttribute("data-3d-ready", "true");
  await expect(gis).toHaveAttribute("data-trajectory-count", "4");
  await expect(page.locator("canvas")).toHaveCount(1);
  const detail = page.getByTestId("field-trajectory-inspector");
  await expect(detail).toHaveAttribute("data-well-id", "offshore-3");
  await expect(detail.getByTestId("field-trajectory-position")).toContainText("2900.0 m");
  await expect(page.getByTestId("workspace-context")).toContainText("Equator C");
  await gis.getByRole("button", { name: "Fit field" }).click();
  await expect(gis.locator("canvas")).toHaveAttribute("data-fitting", "false");
  await expect(gis.locator("canvas")).toHaveAttribute("data-visible-trajectories", "4");
  await gis.getByRole("button", { name: "Toggle map perspective" }).click();
  await gis.getByRole("button", { name: "Toggle map perspective" }).click();
  await gis.getByRole("slider", { name: "Survey station" }).focus();
  await page.keyboard.press("Home");
  await expect(gis).toHaveAttribute("data-selected-md", "0");
  await detail.getByRole("spinbutton", { name: "Go to trajectory MD" }).fill("1250.5");
  await detail.getByRole("button", { name: "Go to depth", exact: true }).click();
  await expect(gis).toHaveAttribute("data-selected-md", "1250.5");
  await expect(gis.locator("canvas")).toHaveAttribute("data-probe-md", "1250.5");
  await expect(gis).toContainText("nearest source station for this register");
  await expect(detail.getByTestId("field-trajectory-position")).toContainText("1250.5 m");
  await detail.getByRole("spinbutton", { name: "Go to trajectory MD" }).fill("9999");
  await detail.getByRole("button", { name: "Go to depth", exact: true }).click();
  await expect(detail.getByRole("alert")).toContainText("between 0 and 2900");
  await expect(gis).toHaveAttribute("data-selected-md", "1250.5");
  await detail.getByRole("button", { name: "Sand R1 top", exact: true }).click();
  await expect(detail.getByRole("alert")).toHaveCount(0);
  await expect(detail.getByRole("slider", { name: "Trajectory measured depth" })).not.toHaveValue("1250.5");
  await gis.getByRole("button", { name: "Focus selected trajectory" }).click();
  await expect(gis.locator("canvas")).toHaveAttribute("data-fitting", "false");
  await gis.locator("canvas").screenshot({ path: "output/playwright/field-embedded-trajectory.png" });
  const canvas = gis.locator("canvas");
  const first = await canvas.screenshot();
  await openAppearance(page);
  await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("dark");
  expect(first.equals(await canvas.screenshot())).toBe(false);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.map((violation) => violation.id)).toEqual([]);
  await page.getByRole("combobox", { name: "Spatial view" }).selectOption("3d");
  await expect(page.getByTestId("offshore-scene")).toHaveAttribute("data-selected-well", "offshore-3");
  // The trajectory inspector is the field's tool, not the map's: it stays beside the 3D scene.
  await expect(detail).toBeVisible();
  await page.getByRole("combobox", { name: "Spatial view" }).selectOption("map");
  await page.getByRole("button", { name: "Inspect Equator D" }).click();
  await expect(detail).toHaveAttribute("data-well-id", "offshore-4");
  await expect(detail.getByTestId("field-trajectory-position")).toContainText("Select a depth");
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

// Desktop-only product (Ikhmal, 2026-10-13): phone layout is out of scope.
test.skip("geographic Field map fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, "/map/");
  await page.getByRole("combobox", { name: "Spatial view" }).selectOption("map");
  await expect(page.getByTestId("gis-map")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "Inspect Equator A" }).click();
  await expect(page.getByTestId("field-trajectory-inspector")).toBeVisible();
  await expect(page.getByTestId("gis-map")).toHaveAttribute("data-3d-ready", "true");
  await expect(page.getByTestId("gis-map").locator("canvas")).toHaveAttribute("data-fitting", "false");
  await expect(page.getByTestId("gis-map").locator("canvas")).toHaveAttribute("data-visible-trajectories", "4");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("clicking the detailed 3D path pins a continuous depth across Field tools", async ({ page }) => {
  await gotoApp(page, "/map/");
  await page.getByRole("combobox", { name: "Spatial view" }).selectOption("map");
  await page.getByRole("button", { name: "Inspect Equator A" }).click();
  const gis = page.getByTestId("gis-map");
  await expect(gis).toHaveAttribute("data-3d-ready", "true");
  const scene = gis.locator("canvas");
  await gis.getByRole("checkbox", { name: "Construction cutaway" }).uncheck();
  await scene.scrollIntoViewIfNeeded();
  const box = (await scene.boundingBox())!;
  let hit: [number, number] | null = null;
  for (let fy = 0.2; fy < 0.9 && !hit; fy += 0.035) {
    for (let fx = 0.1; fx < 0.9 && !hit; fx += 0.025) {
      await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
      const md = Number(await gis.getAttribute("data-selected-md"));
      if (md > 0 && md < 2400 && !Number.isInteger(md)) hit = [fx, fy];
    }
  }
  expect(hit).not.toBeNull();
  await page.mouse.click(box.x + box.width * hit![0], box.y + box.height * hit![1]);
  await page.mouse.move(box.x + 4, box.y + box.height - 4);
  const md = Number(await page.getByTestId("gis-map").getAttribute("data-selected-md"));
  expect(md).toBeGreaterThan(0);
  await expect(page.getByTestId("field-trajectory-position")).toContainText(`${md.toFixed(1)} m`);
  await expect(page.locator("canvas")).toHaveCount(1);
  await gis.screenshot({ path: "output/playwright/field-map-trajectory.png" });
  await page.getByRole("link", { name: "2 · Compare intervals" }).click();
  await expect(page.getByTestId("workspace-context")).toContainText(`${md.toFixed(1)} m MD`);
  await page.getByRole("link", { name: "1 · Locate wells" }).click();
  await expect(page.getByTestId("field-trajectory-position")).toContainText(`${md.toFixed(1)} m`);
});

test("map renders selectable synthetic well construction rather than only a trajectory line", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await gotoApp(page, "/map/");
  const gis = page.getByTestId("gis-map"), canvas = gis.locator("canvas");
  await expect(gis).toHaveAttribute("data-3d-ready", "true");
  await expect(canvas).toHaveAttribute("data-component-count", "56");
  await page.getByRole("button", { name: "Inspect Equator A" }).click();
  await gis.getByRole("button", { name: "Focus selected trajectory" }).click();
  await expect(canvas).toHaveAttribute("data-fitting", "false");
  await page.getByRole("combobox", { name: "Construction component" }).selectOption("production-packer");
  await expect(canvas).toHaveAttribute("data-selected-component", "production-packer");
  await expect(page.getByTestId("field-component-record")).toContainText("215 / 114.3 mm");
  await gis.getByRole("button", { name: "Inspect selected component" }).click();
  await expect(canvas).toHaveAttribute("data-focusing", "false");
  expect(Number(await canvas.getAttribute("data-center-elevation"))).toBeLessThan(-800);
  await canvas.scrollIntoViewIfNeeded();
  await canvas.screenshot({ path: "output/playwright/field-map-construction.png" });
  const withConstruction = await canvas.screenshot();
  await gis.getByRole("checkbox", { name: "Construction cutaway" }).uncheck();
  expect(withConstruction.equals(await canvas.screenshot())).toBe(false);
  await gis.getByRole("checkbox", { name: "Construction cutaway" }).check();
  await gis.getByRole("combobox", { name: "Diameter exaggeration" }).selectOption("800");
  expect(withConstruction.equals(await canvas.screenshot())).toBe(false);
  await page.getByRole("combobox", { name: "Construction component" }).selectOption("");
  await expect(canvas).toHaveAttribute("data-selected-component", "");
  const box = (await canvas.boundingBox())!;
  let hit = false;
  for (let fy = 0.2; fy < 0.85 && !hit; fy += 0.06) for (let fx = 0.2; fx < 0.85 && !hit; fx += 0.04) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    hit = await page.getByTestId("field-component-record").count() > 0;
  }
  expect(hit, "Clicking construction geometry must select its source component").toBe(true);
  await expect(page.getByTestId("field-component-record")).toBeVisible();
  const componentId = await page.getByRole("combobox", { name: "Construction component" }).inputValue();
  await page.getByRole("link", { name: "2 · Compare intervals" }).click();
  await page.getByRole("link", { name: "1 · Locate wells" }).click();
  await expect(page.getByRole("combobox", { name: "Construction component" })).toHaveValue(componentId);
  await expect(page.locator("canvas")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("offshore environment renders in the same map canvas and layers preserve well inspection", async ({ page }) => {
  await gotoApp(page, "/map/");
  const gis = page.getByTestId("gis-map"), canvas = gis.locator("canvas");
  await expect(gis).toHaveAttribute("data-3d-ready", "true");
  await expect(canvas).toHaveAttribute("data-fitting", "false");
  await expect(canvas).toHaveAttribute("data-environment-layers", "sea,water,seabed,subsurface");
  await expect(page.locator("canvas")).toHaveCount(1);
  await canvas.scrollIntoViewIfNeeded();
  await canvas.screenshot({ path: "output/playwright/field-map-environment.png" });
  for (const name of ["Sea surface", "Water column", "Illustrative seabed", "Subsurface cutaway"]) {
    const before = await canvas.screenshot();
    await gis.getByRole("checkbox", { name, exact: true }).uncheck();
    expect(before.equals(await canvas.screenshot()), `${name} should visibly change the map`).toBe(false);
    await gis.getByRole("checkbox", { name, exact: true }).check();
  }
  await page.getByRole("button", { name: "Inspect Equator C" }).click();
  await page.getByRole("combobox", { name: "Construction component" }).selectOption("production-packer");
  await gis.getByRole("button", { name: "Inspect selected component" }).click();
  await expect(canvas).toHaveAttribute("data-focusing", "false");
  await expect(page.getByTestId("field-component-record")).toContainText("Production packer");
  await gis.getByRole("button", { name: "Fit field" }).click();
  await expect(canvas).toHaveAttribute("data-fitting", "false");
  await expect(canvas).toHaveAttribute("data-visible-trajectories", "4");
});
