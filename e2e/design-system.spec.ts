import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoApp, openAppearance, selectWellView } from "./support/app";

const showcaseViews = [
  { route: "/correlation/", testId: "multiwell-correlation", svg: ".sw-correlation-svg" },
  { route: "/cross-section/", testId: "well-cross-section", svg: ".sw-cross-section-svg" },
] as const;

const themes = [
  // The neutral palette of the graphite frame: ink #1f2327 / surface #fff in light, #e6e7e9 on
  // #242629 in dark. The pins are the tokens, so a drift in either theme fails here by name.
  { id: "light", surface: "rgb(255, 255, 255)", ink: "rgb(31, 35, 39)" },
  { id: "dark", surface: "rgb(36, 38, 41)", ink: "rgb(230, 231, 233)" },
  { id: "high-contrast", surface: "rgb(0, 0, 0)", ink: "rgb(255, 255, 255)" },
] as const;

for (const view of showcaseViews) {
  test(`${view.route} flagship view responds to shared themes without axe violations`, async ({ page }) => {
    await gotoApp(page, view.route);
    const renderedView = page.getByTestId(view.testId);
    await expect(renderedView).toBeVisible();
    const provider = page.locator("[data-sw-theme]");
    const svg = renderedView.locator(view.svg);
    const tableAlternative = renderedView.locator(".sw-accessible-table");
    await tableAlternative.locator("summary").click();
    await openAppearance(page);
    const dataTable = tableAlternative.locator("table");
    await expect(dataTable).toBeVisible();
    await expect(dataTable.locator("tbody tr").first()).toBeVisible();
    await expect(dataTable.locator("thead th")).toHaveCount(view.testId === "well-cross-section" ? 7 : 5);
    expect(await dataTable.locator("tbody tr").count()).toBeGreaterThan(0);
    if (view.testId === "multiwell-correlation") {
      await tableAlternative.getByRole("button", { name: "Next rows" }).click();
      await expect(tableAlternative.locator(".sw-accessible-table-controls")).toContainText("Rows 51–100");
      await tableAlternative.getByRole("button", { name: "Previous rows" }).click();
      await expect(tableAlternative.locator(".sw-accessible-table-controls")).toContainText("Rows 1–50");
    }

    for (const theme of themes) {
      await page.getByLabel("Theme").selectOption(theme.id);
      await expect(provider).toHaveAttribute("data-sw-theme", theme.id);
      expect(await svg.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(theme.surface);
      expect(await renderedView.evaluate((element) => getComputedStyle(element).color)).toBe(theme.ink);
      const results = await new AxeBuilder({ page }).analyze();
      expect(
        results.violations.map((violation) =>
          `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`),
      ).toEqual([]);
    }
  });
}

test("WebGPU canvas exposes keyboard camera controls and announces shared zoom state", async ({ page }) => {
  await gotoApp(page, "/sandbox/");
  await page.getByRole("button", { name: "Open independent synthetic example" }).click();
  await page.getByRole("button", { name: "Start WebGPU" }).click();
  const viewer = page.getByTestId("webgpu-viewer");
  await expect(viewer).toBeVisible();
  const zoomStatus = viewer.locator('[aria-live="polite"]');
  await expect(zoomStatus).toContainText("zoom 1.00");
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoomStatus).toContainText("zoom 1.25");
  await viewer.getByRole("button", { name: "Move camera left" }).focus();
  await page.keyboard.press("Enter");
  await expect(zoomStatus).toContainText("Camera position");
});

test("trajectory charts expose keyboard-readable station tables", async ({ page }) => {
  await gotoApp(page, "/trajectory/");
  // The survey opens on the well section; the plan, section and survey-log charts are its "Trajectory plan & section" preset.
  await selectWellView(page, "trajectory", ["plan", "section", "survey"]);
  for (const [testId, label, columnCount] of [
    ["trajectory-plan-view", "trajectory plan stations", 5],
    ["trajectory-section-view", "vertical section stations", 4],
    ["trajectory-log", "trajectory survey log", 4],
  ] as const) {
    const chart = page.getByTestId(testId);
    const alternative = chart.locator(".sw-accessible-table");
    await alternative.locator("summary").click();
    const table = alternative.locator("table");
    await expect(table).toBeVisible();
    await expect(table.locator("caption")).toHaveText(label);
    await expect(table.locator("thead th")).toHaveCount(columnCount);
    await expect(table.locator("tbody tr")).toHaveCount(50);
    await expect(table.locator("tbody tr").first().locator("td").first()).not.toHaveText("not reported");
    await alternative.getByRole("button", { name: "Next rows" }).click();
    await expect(alternative.locator(".sw-accessible-table-controls")).toContainText("Rows 51–100");
  }
  const trajectoryLog = page.getByTestId("trajectory-log");
  await trajectoryLog.getByRole("group", { name: /^Inclination, azimuth and dogleg severity/ }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(trajectoryLog).toHaveAttribute("data-cursor-md", /\d/);
  await page.keyboard.press("Enter");
  await expect(trajectoryLog.locator('[data-testid="traj-selected-mark"]')).toHaveCount(1);
});

test("well components can be selected and inspected without a pointer", async ({ page }) => {
  await gotoApp(page, "/trajectory/");
  await selectWellView(page, "well3d", ["well3d"]);
  const scene = page.getByTestId("interactive-well-scene");
  await expect(scene).toHaveAttribute("data-ready", "true");
  const picker = scene.locator(".sw-scene-component-picker");
  await picker.locator("summary").click();
  const component = picker.getByRole("button").last();
  await component.focus();
  await page.keyboard.press("Enter");
  await expect(component).toHaveAttribute("aria-pressed", "true");
});

test("daily, log, and seismic charts expose paged raw-value tables", async ({ page }) => {
  await gotoApp(page, "/view-well/");
  await page.locator(".demo-records-drawer > summary").click();
  const dailyChart = page.getByTestId("days-vs-depth");
  const dailyTable = dailyChart.locator(".sw-accessible-table");
  await dailyTable.locator("summary").click();
  await expect(dailyTable.locator("thead th")).toHaveCount(4);
  await expect(dailyTable.locator("tbody tr").first()).toBeVisible();

  const file = page.getByTestId("well-file");
  await file.getByRole("tab", { name: "Mud log" }).click();
  const logChart = file.getByTestId("log-tracks");
  const logTable = logChart.locator(".sw-accessible-table");
  await logTable.locator("summary").click();
  await expect(logTable.locator("thead th").first()).toContainText("ft");
  await expect(logTable.locator("tbody tr")).toHaveCount(50);
  await expect(logTable.locator("tbody tr").first().locator("td").first()).not.toHaveText("not reported");
  await expect(logTable).toContainText("not reported");

  await file.getByRole("tab", { name: "Seismic (SEG-Y)" }).click();
  const seismicChart = file.getByTestId("seismic-section");
  const seismicTable = seismicChart.locator(".sw-accessible-table");
  await seismicTable.locator("summary").click();
  await expect(seismicTable.locator("thead th")).toHaveCount(7);
  await expect(seismicTable.locator("tbody tr")).toHaveCount(50);
  await expect(seismicTable.locator("tbody tr").first().locator("td").nth(1)).toHaveText("1");
});
