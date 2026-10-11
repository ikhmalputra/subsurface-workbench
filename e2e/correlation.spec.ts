import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("correlation compares the shared field interval with unit-labelled distinct logs", async ({ page }) => {
  await page.goto("/correlation/");
  const view = page.getByTestId("multiwell-correlation");
  await expect(view.locator("[data-linked-top='reservoir-base']")).toHaveCount(1);
  await expect(view.locator(".sw-correlation-svg")).toHaveCSS("height", "700px");
  const drawing = (await view.locator(".sw-correlation-svg").boundingBox())!;
  const available = (await view.locator(".sw-correlation-scroll").boundingBox())!;
  expect(drawing.width).toBeLessThanOrEqual(available.width + 1);
  await page.getByRole("combobox", { name: "Flatten correlation on" }).selectOption("reservoir-base");
  await expect(view.locator(".sw-correlation-head p")).toContainText("Flattened on Sand R1 base");
  await page.getByRole("combobox", { name: "Log response" }).selectOption("resistivity");
  await expect(view).toContainText("ohm.m");
  const slider = page.getByRole("slider", { name: "Select measured depth in Equator A" });
  await slider.focus(); await slider.press("ArrowDown");
  await expect(page.getByTestId("workspace-context")).toContainText("Equator A");
  await expect(view.locator("[aria-label^='Linked cursor at']")).toHaveCount(4);
  const summary = page.getByRole("table", { name: "Vertical interval coverage and qualifying thickness" });
  await expect(summary).toContainText("Equator C");
  await expect(summary).toContainText("Equator D");
  const qualifying = page.getByTestId("qualifying-offshore-1");
  const before = await qualifying.innerText();
  await page.getByRole("combobox", { name: "Resistivity minimum (ohm.m)" }).selectOption("25");
  await expect(qualifying).toHaveText("0.0");
  expect(before).not.toBe("0.0");
  await expect(page.getByText("not net pay, hydrocarbon volume or reserves", { exact: false })).toBeVisible();
});

test("correlation supports keyboard selection and has no axe violations", async ({ page }) => {
  await page.goto("/correlation/");
  await expect(page.getByRole("heading", { name: "Equator field", level: 1 })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
  await page.screenshot({ path: "output/playwright/field-correlation.png", fullPage: true });
});
