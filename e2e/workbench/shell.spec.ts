import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const canvas = (page: Page) => page.getByTestId("workbench-canvas");

/** Stamp a value that only survives if the element is never unmounted and replaced. */
async function stampCanvas(page: Page, token: string) {
  await canvas(page).evaluate((element, value) => { (element as HTMLElement).dataset.mountCheck = value; }, token);
}
async function readStamp(page: Page) {
  return canvas(page).evaluate((element) => (element as HTMLElement).dataset.mountCheck ?? null);
}

/**
 * Wait for every running CSS transition to finish. Controls transition colour on hover, so sampling
 * straight after a theme switch reads interpolated mid-transition values and reports contrast
 * failures for colours that are never actually displayed at rest.
 */
async function settle(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
}

test("the shell frame renders every region once", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("workbench-tabs")).toBeVisible();
  await expect(page.getByTestId("workbench-rail")).toBeVisible();
  await expect(page.getByTestId("workbench-options")).toBeVisible();
  await expect(page.getByTestId("workbench-status")).toBeVisible();
  await expect(canvas(page)).toHaveCount(1);
  await expect(page.getByTestId("workbench-dock-right")).toBeVisible();

  // Documents are wells; the active one drives the whole shell.
  await expect(page.getByRole("tab", { name: /Utah FORGE/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("workbench-status")).toContainText("documented");
});

test("the canvas is never remounted by tools, panels, documents or theme", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("curved-assembly-schematic")).toBeVisible();
  await stampCanvas(page, "same-canvas");

  // Canvas mode: the case that remounts in the current demo app.
  await page.getByRole("button", { name: "Schematic", exact: true }).click();
  await expect(page.locator('[data-testid="assembly-schematic"]')).toBeVisible();
  expect(await readStamp(page)).toBe("same-canvas");

  await page.getByRole("button", { name: "Curved", exact: true }).click();
  await expect(page.getByTestId("curved-assembly-schematic")).toBeVisible();
  expect(await readStamp(page)).toBe("same-canvas");

  // Panel tabs.
  for (const name of ["Properties", "Records", "Sources", "History", "Layers"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    expect(await readStamp(page)).toBe("same-canvas");
  }

  // Document switch and theme change.
  await page.getByRole("tab", { name: /S-profile/ }).click();
  await expect(page.getByTestId("workbench-status")).toContainText("synthetic");
  expect(await readStamp(page)).toBe("same-canvas");

  await page.getByLabel("Theme").selectOption("dark");
  expect(await readStamp(page)).toBe("same-canvas");
});

test("both canvas modes stay mounted so switching keeps their view state", async ({ page }) => {
  await page.goto("/");
  const curved = page.locator('.swb-canvas-layer[data-layer="curved"]');
  const schematic = page.locator('.swb-canvas-layer[data-layer="schematic"]');

  // Present in the DOM at all times; only visibility changes.
  await expect(curved).toHaveCount(1);
  await expect(schematic).toHaveCount(1);
  await expect(curved).toHaveAttribute("data-active", "true");
  await expect(schematic).toBeHidden();

  await page.getByRole("button", { name: "Schematic", exact: true }).click();
  await expect(schematic).toHaveAttribute("data-active", "true");
  await expect(curved).toBeHidden();
  // The hidden mode is still mounted, which is what preserves its zoom and depth window.
  await expect(curved).toHaveCount(1);
});

test("selecting in the drawing surfaces the inspector and reports source values", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("curved-assembly-schematic")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Layers", exact: true })).toHaveAttribute("aria-selected", "true");

  // Both canvas modes are mounted at once, so component ids legitimately appear twice. Scope to the
  // visible layer rather than loosening the selector.
  await page.locator('.swb-canvas-layer[data-active] [data-item-id="production-casing"]').press("Enter");

  // The view asked the shell to reveal a panel; it does not know where the dock is.
  await expect(page.getByRole("tab", { name: "Properties", exact: true })).toHaveAttribute("aria-selected", "true");
  const properties = page.locator('[data-panel-id="properties"]');
  await expect(properties).toContainText("Production casing / 7 in");
  // FORGE does not report casing inside diameter; it must stay unreported, not be invented.
  await expect(properties).toContainText("not reported");
  await expect(page.getByTestId("workbench-status")).toContainText("production-casing");
});

test("revealing the inspector does not trap the dock on that panel", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("curved-assembly-schematic")).toBeVisible();
  await page.locator('.swb-canvas-layer[data-active] [data-item-id="production-casing"]').press("Enter");
  await expect(page.getByRole("tab", { name: "Properties", exact: true })).toHaveAttribute("aria-selected", "true");

  // With the component still selected, the user must be able to move to another panel and stay there
  // through unrelated state changes.
  await page.getByRole("tab", { name: "Layers", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Layers", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByLabel("Density").selectOption("compact");
  await page.getByRole("button", { name: "Schematic", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Layers", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("layers carry per-layer provenance and do not offer toggles the renderer cannot honour", async ({ page }) => {
  await page.goto("/");
  const layers = page.locator('[data-panel-id="layers"]');
  await expect(layers.getByRole("list", { name: "Layers" })).toBeVisible();

  // Construction is sourced, but FORGE strata are conceptual, so the two cannot share a badge.
  await expect(layers.locator('[data-layer-id="casing"] .swb-badge')).toHaveAttribute("data-provenance", "documented");
  await expect(layers.locator('[data-layer-id="formations"] .swb-badge')).toHaveAttribute("data-provenance", "synthetic");

  // Formations genuinely controls rendering; the construction layers do not yet, and say so.
  await expect(layers.getByRole("button", { name: /Hide Casing & liners/ })).toBeDisabled();
  const formationToggle = layers.getByRole("button", { name: /Formations/ }).first();
  await expect(formationToggle).toBeEnabled();
  await formationToggle.click();
  await expect(layers.locator('[data-layer-id="formations"]')).toHaveAttribute("data-visible", "false");

  // Survey station count comes from the record, not a constant.
  await expect(layers.locator('[data-layer-id="survey"]')).toContainText("422 stations");
});

test("shell controls meet the shared control contract and have no axe violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("curved-assembly-schematic")).toBeVisible();

  const commands = page.locator('button[data-ui-kind="command"]');
  const total = await commands.count();
  expect(total).toBeGreaterThan(0);
  for (let index = 0; index < total; index++) {
    const button = commands.nth(index);
    if (!(await button.isVisible())) continue;
    expect((await button.getAttribute("aria-label")) ?? (await button.textContent())?.trim()).toBeTruthy();
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(43.5);
    expect(await button.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("4px");
  }

  for (const theme of ["light", "dark", "high-contrast"]) {
    await page.getByLabel("Theme").selectOption(theme);
    await settle(page);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.length} node(s)`), `${theme} violations`).toEqual([]);
  }
});

test("the 3D cutaway loads on demand as a third canvas mode without remounting", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("curved-assembly-schematic")).toBeVisible();
  await stampCanvas(page, "same-canvas");
  // Three.js must not be in the initial payload; the mode pulls it in on first use.
  await expect(page.locator('.swb-canvas-layer[data-layer="cutaway"] canvas')).toHaveCount(0);

  await page.getByRole("button", { name: "3D cutaway", exact: true }).click();
  await expect(page.locator('.swb-canvas-layer[data-layer="cutaway"] canvas')).toBeVisible({ timeout: 20000 });
  expect(await readStamp(page)).toBe("same-canvas");

  // Returning to a 2D mode leaves the loaded scene mounted rather than tearing it down.
  await page.getByRole("button", { name: "Curved", exact: true }).click();
  await expect(page.locator('.swb-canvas-layer[data-layer="cutaway"] canvas')).toHaveCount(1);
  expect(await readStamp(page)).toBe("same-canvas");
});

test("the records register searches every source record and shares selection", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: /^S-profile/ }).click();
  await page.getByRole("tab", { name: "Records", exact: true }).click();
  const records = page.locator('[data-panel-id="records"]');

  // The synthetic S-profile carries joint-level detail; the count comes from the record.
  await expect(records.getByTestId("component-inventory-total").first()).toHaveText("746 records");
  await records.getByLabel("Search").fill("mandrel");
  await expect(records).toContainText("3 matching");

  await records.locator("[data-component-id]").first().click();
  // Selecting from the register reveals the inspector, exactly as selecting in the drawing does.
  await expect(page.getByRole("tab", { name: "Properties", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-panel-id="properties"]')).toContainText("Gas lift mandrel");
});

test("the shell fits a phone viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("curved-assembly-schematic")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
});
