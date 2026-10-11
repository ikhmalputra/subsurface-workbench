import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("section uses the same R1 markers and sea-surface depth, with explicit endpoints", async ({ page }) => {
  await page.goto("/cross-section/");
  const section = page.getByTestId("well-cross-section");
  await expect(section).toContainText("synthetic sea surface");
  await expect(section.getByText("Sand R1 top").first()).toBeVisible();
  const well = section.getByRole("button", { name: /Focus Equator B/ });
  await well.focus(); await well.press("Enter");
  await expect(page.getByTestId("workspace-context")).toContainText("Equator B");
  await expect(section.locator('[data-well-id="offshore-2"] .sw-cross-section-path')).toHaveClass(/is-active/);
  await page.getByRole("combobox", { name: "End well" }).selectOption("offshore-1");
  await expect(page.getByRole("alert").filter({ hasText: "distinct endpoint" })).toBeVisible();
  await page.getByRole("combobox", { name: "End well" }).selectOption("offshore-2");
  await expect(section).toBeVisible();
});

test("section labels off-plane limitations and passes accessibility", async ({ page }) => {
  await page.goto("/cross-section/");
  await expect(page.getByTestId("well-cross-section")).toContainText("offset");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
  await page.screenshot({ path: "output/playwright/field-section.png", fullPage: true });
});
