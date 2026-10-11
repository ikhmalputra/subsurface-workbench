import { expect, test } from "@playwright/test";

test("one Field project preserves selected wells, depth and tool settings through the workflow", async ({ page }) => {
  await page.goto("/map/");
  await page.getByRole("button", { name: "Inspect Equator B" }).click();
  await page.getByRole("checkbox", { name: "Include Equator D" }).uncheck();
  await page.getByRole("link", { name: "2 · Compare intervals" }).click();
  await expect(page.getByRole("slider", { name: "Select measured depth in Equator D" })).toHaveCount(0);
  await expect(page.getByTestId("workspace-context")).toContainText("Equator B");
  await page.getByRole("combobox", { name: "Log response" }).selectOption("porosity");
  const slider = page.getByRole("slider", { name: "Select measured depth in Equator B" });
  await slider.focus(); await slider.press("ArrowDown");
  const depth = await page.getByTestId("workspace-context").textContent();
  await page.getByRole("link", { name: "3 · Spatial section" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "endpoint" })).toBeVisible();
  await page.getByRole("combobox", { name: "End well" }).selectOption("offshore-3");
  await expect(page.getByTestId("well-cross-section")).toBeVisible();
  await expect(page.getByTestId("workspace-context")).toHaveText(depth!);
  await page.getByRole("link", { name: "2 · Compare intervals" }).click();
  await expect(page.getByRole("combobox", { name: "Log response" })).toHaveValue("porosity");
  await page.getByRole("link", { name: "1 · Locate wells" }).click();
  await expect(page.getByTestId("gis-map")).toHaveAttribute("data-selected-well", "offshore-2");
  await page.getByRole("link", { name: "Well", exact: true }).click();
  await expect(page.getByTestId("workspace-context")).toContainText("Documented record");
});

test("phone Field tools fit and guard an empty comparison", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/correlation/");
  for (const name of ["A", "B", "C", "D"]) await page.getByRole("checkbox", { name: `Include Equator ${name}` }).uncheck();
  await expect(page.getByRole("alert").filter({ hasText: "at least two" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
