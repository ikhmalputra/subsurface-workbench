import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { budget } from "./support/timing";
import { gotoApp, openAppearance, openTool } from "./support/app";

const routes = ["/", "/view-well/", "/trajectory/", "/builder/", "/edit-well/", "/analysis/", "/map/", "/correlation/", "/cross-section/", "/petrophysics/", "/production/", "/linked-data/", "/sandbox/", "/well-report/"];

async function auditExpandedCommands(page: Page) {
  const defects = await page.locator('button[data-ui-kind="command"]').evaluateAll((buttons) => buttons.flatMap((button) => {
    const rect = button.getBoundingClientRect();
    if (!rect.width || !rect.height) return [];
    const icon = button.querySelector(":scope > svg")?.getBoundingClientRect();
    const name = button.getAttribute("aria-label") || button.textContent?.trim();
    return !name || rect.height < 31.5 || getComputedStyle(button).borderRadius !== "4px" || icon?.width !== 16 || icon?.height !== 16
      ? [{ name, height: rect.height, icon }] : [];
  }));
  expect(defects).toEqual([]);
}

test("the well editing tools support themes, docking beside the sheet and the command audit", async ({ page }) => {
  test.setTimeout(budget(180_000));
  await gotoApp(page, "/edit-well/?well=forge");
  await openAppearance(page);
  await expect(page.getByRole("button", { name: "Export JSON", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Blank well", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Example", exact: true })).toHaveCount(0);
  const canvas = page.getByTestId("curved-assembly-schematic");
  await expect(canvas).toBeVisible();
  for (const [domain, tool, testId] of [["Drilling", "Construction editor", "tool-construction"], ["Drilling", "Well properties", "tool-well-properties"], ["Drilling", "Component records", "tool-component-records"], ["Geology", "Formation tops", "tool-formations"], ["Field & data", "Data sources", "tool-records-data"]] as const) {
    await openTool(page, domain, tool);
    const panel = page.getByTestId(testId);
    await expect(panel).toBeVisible();
    await expect(canvas).toBeVisible();
    // The tool docks beside the sheet, never over the drawing.
    const drawing = (await canvas.boundingBox())!, dock = (await panel.boundingBox())!;
    expect(drawing.x + drawing.width).toBeLessThanOrEqual(dock.x + 1);
    if (testId !== "tool-construction") expect(await panel.locator("input").first().evaluate((element) => getComputedStyle(element).borderTopStyle)).toBe("solid");
    for (const theme of ["light", "dark", "high-contrast"]) {
      await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption(theme);
      await auditExpandedCommands(page);
      const result = await new AxeBuilder({ page }).include(`[data-float="${testId}"]`).analyze();
      expect(result.violations.map((issue) => ({ tool, theme, id: issue.id, nodes: issue.nodes.map((node) => node.target) }))).toEqual([]);
    }
    await page.locator(`[data-float="${testId}"]`).getByRole("button", { name: /^Dismiss/ }).click();
  }
});

for (const route of routes) {
  test(`${route} shared commands, themes, focus and phone layout`, async ({ page }, info) => {
    test.setTimeout(budget(60_000));
    await gotoApp(page, route);
    const example = page.getByRole("button", { name: "Open independent synthetic example" });
    if (await example.count()) await example.click();
    if (route === "/map/") await expect(page.getByTestId("gis-map")).toHaveAttribute("data-ready", "true");
    await openAppearance(page);
    const audit = [];
    for (const theme of ["light", "dark", "high-contrast"]) {
      await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption(theme);
      const controls = await page.locator("button[data-ui-kind]").evaluateAll((buttons) => buttons.flatMap((button) => {
        const rect = button.getBoundingClientRect(), css = getComputedStyle(button);
        if (!rect.width || !rect.height) return [];
        const svg = button.querySelector(":scope > svg");
        return [{
          name: button.getAttribute("aria-label") || button.textContent?.trim(),
          kind: button.getAttribute("data-ui-kind"), disabled: button.hasAttribute("disabled"),
          height: rect.height, width: rect.width, radius: css.borderRadius,
          color: css.color, background: css.backgroundColor,
          icon: svg ? { width: svg.getBoundingClientRect().width, height: svg.getBoundingClientRect().height } : null,
        }];
      }));
      audit.push({ theme, controls });
      expect(controls.filter((control) => !control.name)).toEqual([]);
      expect(controls.filter((control) => control.kind === "command" && (!control.icon || control.height < 31.5 || control.radius !== "4px"))).toEqual([]);
      expect(controls.filter((control) => control.icon && (control.icon.width !== 16 || control.icon.height !== 16))).toEqual([]);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.map((violation) => ({ theme, id: violation.id, nodes: violation.nodes.map((node) => ({ target: node.target, reason: node.failureSummary })) }))).toEqual([]);
    }

    const command = page.locator('button[data-ui-kind="command"]:enabled:visible').first();
    if (await command.count()) {
      await command.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      expect(await command.evaluate((button) => getComputedStyle(button).outlineStyle)).toBe("solid");
    }
    await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("light");
    if (["/view-well/", "/builder/", "/map/", "/production/"].includes(route)) await page.screenshot({ path: `output/playwright/ui-${route.split("/")[1]}-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await openAppearance(page);
    await page.getByRole("combobox", { name: "Density", exact: true }).selectOption("compact");
    const layout = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      overflow: [...document.querySelectorAll("main *")].map((element) => ({ tag: element.tagName, className: element.getAttribute("class"), right: Math.round(element.getBoundingClientRect().right) })).filter((element) => element.right > innerWidth + 1).slice(0, 12),
    }));
    expect(layout.width, JSON.stringify(layout)).toBeLessThanOrEqual(391);
    expect(await page.locator(".demo-nav-toggle").evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(31.5);
    await info.attach("ui-control-inventory", { body: JSON.stringify(audit, null, 2), contentType: "application/json" });
  });
}

test("expanded design editors and alternate well views share the same theme and control contract", async ({ page }) => {
  test.setTimeout(budget(180_000));
  await gotoApp(page, "/builder/");
  const workflow = page.getByTestId("tool-design");
  await openAppearance(page);
  for (const [phase, step] of [
    ["Define", "Identity"], ["Define", "Location & datum"], ["Define", "Offset wells"],
    ["Plan", "Geology & pressure"], ["Plan", "Trajectory"],
    ["Design", "Casing"], ["Design", "Cement"], ["Design", "Completion"], ["Review", ""],
  ]) {
    await workflow.locator(".sw-wd-steps button").filter({ hasText: phase }).click();
    if (step) await workflow.locator(".sw-wd-substeps button").filter({ hasText: step }).click();
    for (const theme of ["light", "dark", "high-contrast"]) {
      await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption(theme);
      await auditExpandedCommands(page);
      const result = await new AxeBuilder({ page }).analyze();
      expect(result.violations.map((violation) => ({ step, theme, id: violation.id, nodes: violation.nodes.map((node) => ({ target: node.target, reason: node.failureSummary })) }))).toEqual([]);
    }
  }
  await gotoApp(page, "/view-well/");
  await openAppearance(page);
  await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("dark");
  for (const view of ["split", "curved", "profile", "earth", "seismic"]) {
    await page.getByRole("combobox", { name: "View", exact: true }).selectOption(view);
    await auditExpandedCommands(page);
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations.map((violation) => ({ view, id: violation.id, nodes: violation.nodes.map((node) => ({ target: node.target, reason: node.failureSummary })) }))).toEqual([]);
  }
});

test("expanded well records keep readable themed tables and chart tools", async ({ page }) => {
  test.setTimeout(budget(120_000));
  await gotoApp(page, "/view-well/");
  await openAppearance(page);
  await page.locator(".demo-records-drawer > summary").click();
  const file = page.getByTestId("well-file");
  const tabs = await file.getByRole("tab").allTextContents();
  for (const tab of tabs) {
    await file.getByRole("tab", { name: tab, exact: true }).click();
    for (const theme of ["light", "dark", "high-contrast"]) {
      await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption(theme);
      await auditExpandedCommands(page);
      const result = await new AxeBuilder({ page }).analyze();
      expect(result.violations.map((violation) => ({ tab, theme, id: violation.id, nodes: violation.nodes.map((node) => ({ target: node.target, reason: node.failureSummary })) }))).toEqual([]);
    }
  }
});
