import { expect, test } from "@playwright/test";
import { gotoApp } from "./support/app";

test("workspace preserves source-well context and appearance across compatible views", async ({ page }) => {
  await gotoApp(page, "/trajectory/");
  const context = page.getByTestId("workspace-context");
  await expect(context).toContainText("Documented record");
  await page.locator(".demo-nav-secondary").filter({ hasText: "Appearance" }).locator("summary").click();
  await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("dark");
  await page.getByRole("combobox", { name: "Density", exact: true }).selectOption("compact");
  const log = page.getByTestId("trajectory-log").locator("svg");
  await log.focus();
  await log.press("Home");
  await log.press("ArrowDown");
  await log.press("Enter");
  const depth = await context.locator("span").filter({ hasText: /^Depth:/ }).innerText();
  expect(depth).not.toContain("not selected");
  await page.getByRole("button", { name: "Plan build & hold", exact: true }).click();
  await log.focus();
  await log.press("End");
  await log.press("Enter");
  await expect(context.locator("span").filter({ hasText: /^Depth:/ })).toHaveText(depth);

  await page.getByRole("link", { name: "Well report", exact: true }).click();
  await expect(context.locator("span").filter({ hasText: /^Depth:/ })).toHaveText(depth);
  await expect(page.getByRole("combobox", { name: "Theme", exact: true })).toHaveValue("dark");
  await expect(page.getByRole("combobox", { name: "Density", exact: true })).toHaveValue("compact");
  await expect(page.getByTestId("well-report-link-status")).toContainText("selected");
  await page.getByTestId("well-report-component-list").locator('[data-report-component="production-casing"]').getByRole("button", { name: "View", exact: true }).click();
  const componentSelection = await context.locator("span").filter({ hasText: /^Selection:/ }).innerText();
  expect(componentSelection).not.toContain("No component");

  await page.getByRole("link", { name: "View well", exact: true }).click();
  await expect(context.locator("span").filter({ hasText: /^Selection:/ })).toHaveText(componentSelection);
  await page.getByRole("combobox", { name: "Well", exact: true }).selectOption("s-profile");
  await expect(context).toContainText("Synthetic example");
  await expect(context).toContainText("Depth: not selected");
  await page.getByRole("link", { name: "Well report", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Report not supplied for this well" })).toBeVisible();
  await expect(page.getByTestId("well-report")).toHaveCount(0);

  await page.getByRole("link", { name: "Field", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Equator field" })).toBeVisible();
  await page.getByRole("button", { name: "Inspect Equator A" }).focus();
  await page.keyboard.press("Enter");
  await expect(context).toContainText("Equator A");
  await page.getByRole("link", { name: "Well", exact: true }).click();
  await expect(context.getByRole("combobox", { name: "Well", exact: true })).toHaveValue("s-profile");
  await expect(context).toContainText("Depth: not selected");
});

test("legacy well links hydrate canonical identity and component selection survives navigation", async ({ page }) => {
  await gotoApp(page, "/view-well/?well=s-profile");
  const context = page.getByTestId("workspace-context");
  await expect(context.getByRole("combobox", { name: "Well", exact: true })).toHaveValue("s-profile");
  await page.getByRole("button", { name: "Schematic", exact: true }).click();
  const item = page.getByTestId("assembly-schematic").locator("[data-item-id]").first();
  await item.click();
  const selection = await context.locator("span").filter({ hasText: /^Selection:/ }).innerText();
  expect(selection).not.toContain("No component");
  await page.getByRole("link", { name: "3D trajectory", exact: true }).click();
  await expect(context.locator("span").filter({ hasText: /^Selection:/ })).toHaveText(selection);
  await page.getByRole("link", { name: "View well", exact: true }).click();
  await expect(context.locator("span").filter({ hasText: /^Selection:/ })).toHaveText(selection);
});

test("four workspaces expose contextual views without merging incompatible example datasets", async ({ page }) => {
  await gotoApp(page, "/view-well/");
  await page.getByRole("link", { name: "Field", exact: true }).click();
  const fieldViews = page.getByRole("group", { name: "Field views", exact: true });
  await expect(fieldViews.getByRole("link")).toHaveText(["Field workspace"]);
  await page.getByRole("link", { name: "2 · Compare intervals" }).click();
  await expect(page).toHaveURL(/\/correlation\/$/);
  await expect(page.getByRole("heading", { name: "Equator field" })).toBeVisible();
  await page.getByRole("link", { name: "Analysis", exact: true }).click();
  const analysisViews = page.getByRole("group", { name: "Analysis views", exact: true });
  await expect(analysisViews.getByRole("link")).toHaveText(["Engineering studies"]);
  await expect(page).toHaveURL(/\/analysis\/$/);
  await expect(page.getByRole("heading", { name: "Drilling performance review" })).toBeVisible();
  await page.getByRole("link", { name: "Well", exact: true }).click();
  await expect(page.getByRole("group", { name: "Well views", exact: true })).toBeVisible();
});
