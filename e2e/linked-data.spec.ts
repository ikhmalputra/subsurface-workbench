import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createMockLogCurve, createMockTrajectory } from "../packages/core/dist/sandbox.js";
import { gotoApp, openAppearance } from "./support/app";

test("table hover, chart brush, and spatial selection link using stable sample IDs", async ({ page }) => {
  await gotoApp(page, "/linked-data/");
  await page.getByRole("button", { name: "Open independent synthetic example" }).click();
  const view = page.getByTestId("linked-dataset");
  await expect(view).toBeVisible();

  const row = view.locator('tr[data-sample-id="well-a:sample:0010"]');
  await row.hover();
  await expect(row).toHaveClass(/is-hovered/);
  await expect(view.locator(".sw-linked-dataset-point.is-hovered")).toHaveCount(1);
  await expect(view.locator(".sw-linked-dataset-spatial-point.is-hovered")).toHaveCount(1);

  await row.click();
  await expect(row).toHaveAttribute("aria-selected", "true");
  await expect(view.locator(".sw-linked-dataset-point.is-selected")).toHaveCount(1);
  await expect(view.locator(".sw-linked-dataset-spatial-point.is-selected")).toHaveCount(1);
  const trajectory = createMockTrajectory({ id: "linked-well-a", stations: 600, totalDepthMdM: 3000, seed: 107 });
  const curve = createMockLogCurve(trajectory, { seed: 22 });
  const sampleIndex = 9;
  const expectedXyz = Array.from(trajectory.xyz.slice(27, 30), (value) => value.toFixed(1)).join(", ");
  await expect(page.locator(".demo-correlation-status")).toContainText(`XYZ ${expectedXyz} m`);
  const expectedDepth = trajectory.depthsMdM[sampleIndex]!;
  const expectedValue = curve.values[sampleIndex]!;
  await expect(view.getByRole("button", { name: `well-a:sample:0010, depth ${expectedDepth}, Porosity ${expectedValue} v/v` })).toBeVisible();
  await expect(view.locator('tr[data-sample-id="well-a:sample:0010"] [role="gridcell"]').nth(2)).toHaveText(String(expectedValue));

  const spatialSample = view.locator('.sw-linked-dataset-spatial-point[data-sample-id="well-a:sample:0012"]');
  // The document scrolls inside the sheet; a raw pointer click needs the point on screen first.
  await spatialSample.scrollIntoViewIfNeeded();
  const spatialBounds = await spatialSample.boundingBox();
  if (!spatialBounds) throw new Error("Spatial sample is not laid out.");
  await page.mouse.click(spatialBounds.x + spatialBounds.width / 2, spatialBounds.y + spatialBounds.height / 2);
  await expect(page.locator(".demo-correlation-status")).toContainText("selected:");
  const selectionStatus = await page.locator(".demo-correlation-status").textContent();
  const selectedId = selectionStatus?.match(/well-a:sample:\d{4}/)?.[0];
  expect(selectedId).toBeTruthy();
  await expect(view.locator(`tr[data-sample-id="${selectedId}"]`)).toHaveAttribute("aria-selected", "true");
  await expect(view.locator(".sw-linked-dataset-point.is-selected")).toHaveCount(1);
  await expect(view.locator(".sw-linked-dataset-spatial-point.is-selected")).toHaveAttribute("data-sample-id", selectedId!);

  const chart = view.getByRole("group", { name: /Porosity by depth/ });
  const bounds = await chart.boundingBox();
  if (!bounds) throw new Error("Linked chart is not laid out.");
  const y = bounds.y + bounds.height * 0.55;
  await page.mouse.move(bounds.x + bounds.width * 0.18, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.42, y, { steps: 4 });
  await page.mouse.up();
  const status = view.locator(".sw-linked-dataset-status");
  await expect(status).toContainText(/of 600 rows visible/);
  const countText = await status.textContent();
  const visible = Number(countText?.match(/(\d+) of 600/)?.[1]);
  expect(visible).toBeGreaterThan(1);
  expect(visible).toBeLessThan(600);
});

test("virtual table supports keyboard movement, filtering, and CSV export with no axe violations", async ({ page }) => {
  await gotoApp(page, "/linked-data/");
  await page.getByRole("button", { name: "Open independent synthetic example" }).click();
  const view = page.getByTestId("linked-dataset");
  const firstRow = view.locator('tr[data-sample-id="well-a:sample:0001"]');
  await firstRow.focus();
  await page.keyboard.press("ArrowDown");
  await expect(view.locator('tr[data-sample-id="well-a:sample:0002"]')).toBeFocused();

  await view.getByRole("searchbox", { name: "Filter samples" }).fill("sample:0002");
  await expect(view.locator('tr[data-sample-id="well-a:sample:0002"]')).toBeVisible();
  await expect(view.locator(".sw-linked-dataset-status")).toContainText("1 of 600 rows visible");
  const download = page.waitForEvent("download");
  await view.getByRole("button", { name: "Download CSV" }).click();
  expect((await download).suggestedFilename()).toBe("well-a-porosity-observations.csv");

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
});

test("chart samples are keyboard-navigable and theme/density controls update the view", async ({ page }) => {
  await gotoApp(page, "/linked-data/");
  await page.getByRole("button", { name: "Open independent synthetic example" }).click();
  const view = page.getByTestId("linked-dataset");
  const points = view.locator(".sw-linked-dataset-point");
  const firstPoint = points.first();
  await firstPoint.focus();
  await page.keyboard.press("ArrowRight");
  const focusedPoint = view.locator(".sw-linked-dataset-point:focus");
  await expect(focusedPoint).toHaveAttribute("aria-label", /well-a:sample:0002/);
  const focusedLabel = await focusedPoint.getAttribute("aria-label");
  await page.keyboard.press("Enter");
  const selectedSampleId = focusedLabel?.split(",")[0];
  if (!selectedSampleId) throw new Error("Focused chart sample did not expose a stable ID.");
  await expect(view.locator(`tr[data-sample-id="${selectedSampleId}"]`)).toHaveAttribute("aria-selected", "true");

  const provider = page.locator('[data-sw-theme]');
  await openAppearance(page);
  expect(await view.locator('tr[data-sample-id]').first().evaluate((element) => element.getBoundingClientRect().height)).toBe(44);
  await page.getByLabel("Theme").selectOption("dark");
  await expect(provider).toHaveAttribute("data-sw-theme", "dark");
  expect(await provider.evaluate((element) => getComputedStyle(element).getPropertyValue("--sw-surface").trim())).toBe("#242629");
  let results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
  await page.getByLabel("Theme").selectOption("high-contrast");
  await expect(provider).toHaveAttribute("data-sw-theme", "high-contrast");
  await page.getByLabel("Density").selectOption("compact");
  await expect(provider).toHaveAttribute("data-sw-density", "compact");
  expect(await view.locator('tr[data-sample-id]').first().evaluate((element) => element.getBoundingClientRect().height)).toBe(36);

  results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
});

test("reduced-motion preference removes linked-mark animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoApp(page, "/linked-data/");
  await page.getByRole("button", { name: "Open independent synthetic example" }).click();
  const point = page.getByTestId("linked-dataset").locator(".sw-linked-dataset-point").first();
  const duration = await point.evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(Number.parseFloat(duration)).toBeLessThan(0.001);
});
