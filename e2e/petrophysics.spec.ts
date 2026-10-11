import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("petrophysics log exposes aligned tracks, supplied context, and a linked keyboard depth cursor", async ({ page }) => {
  await page.goto("/petrophysics/");
  await page.getByRole("button", { name: "Open independent synthetic example" }).click();
  const view = page.getByTestId("petrophysics-log");
  await expect(view).toHaveAttribute("data-well-id", "synthetic-petro-01");
  await expect(view).toHaveAttribute("data-depth-datum", "RKB");
  await expect(view).toContainText("SYNTHETIC");
  await expect(view.locator("[data-curve-id]")).toHaveCount(4);
  await expect(view.locator("[data-core-id]")).toHaveCount(2);
  await expect(view.locator(".sw-petro-top")).toHaveCount(2);
  await expect(view.locator(".sw-petro-cutoff-label")).toContainText("Display cutoff: above 75 API");
  await expect(view.getByTestId("petrophysics-core-measurements")).toContainText("0.21");
  await expect(view.getByTestId("petrophysics-core-measurements")).toContainText("not reported");
  await expect(page.getByTestId("petrophysics-link-status")).toContainText("no depth range");
  await expect(page.getByTestId("petrophysics-crossplot")).toHaveCount(3);
  await expect(page.getByTestId("petrophysics-crossplot").first()).toContainText("Exact shared MD keys only");
  await expect(page.getByTestId("petrophysics-crossplot").nth(1)).toContainText("Calculated Archie water saturation vs porosity");
  await expect(page.getByTestId("petrophysics-crossplot").nth(2)).toContainText("Calculated Schlumberger M-N coordinates");
  await expect(page.getByTestId("petrophysics-calculations")).toContainText("Sw = (a * Rw / (Rt * phi^m))^(1/n)");
  await expect(page.getByTestId("petrophysics-calculations")).toContainText("M = (DTf - DT)");
  await expect(page.getByTestId("petrophysics-calculations")).toContainText("caller must temperature-correct Rw");
  await expect(page.getByTestId("petrophysics-zone-summary")).toContainText("Gross sampled");
  await expect(page.getByTestId("petrophysics-flatten")).toContainText("synthetic-petro-02");

  const plot = view.locator("svg[role=group]");
  await plot.focus();
  await page.keyboard.press("ArrowDown");
  await expect(view.locator(".sw-petro-readout")).toContainText("MD 1,005 m");
  await expect(page.getByTestId("petrophysics-link-status")).toContainText("cursor 1005.0 m MD");
  await page.keyboard.press("Enter");
  await expect(view.locator('[data-testid="petrophysics-selected-depth"]')).toHaveCount(1);

  const box = (await plot.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.52, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByTestId("petrophysics-link-status")).toContainText("brushed");
  await expect(view.locator('[data-testid="petrophysics-brush"]')).toHaveCount(1);

  const details = view.locator(".sw-accessible-table");
  await details.locator("summary").click();
  await expect(details.locator("table thead th")).toHaveCount(5);
  await expect(details.locator("tbody tr")).toHaveCount(50);
  await details.getByRole("button", { name: "Next rows" }).click();
  await expect(details.locator(".sw-accessible-table-controls")).toContainText("Rows 51–100");
  await expect(details.locator("tbody")).toContainText("not reported");
  await details.getByRole("button", { name: "Next rows" }).click();
  await expect(details.locator(".sw-accessible-table-controls")).toContainText("Rows 101–150");

  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
});

test("petrophysics templates and analysis views link selections to the shared MD range", async ({ page }) => {
  await page.goto("/petrophysics/");
  await page.getByRole("button", { name: "Open independent synthetic example" }).click();
  await page.getByLabel("Track template").selectOption("porosity");
  await expect(page.getByTestId("petrophysics-log").locator("[data-curve-id]")).toHaveCount(2);
  await page.getByText("View or copy this JSON track template").click();
  await expect(page.locator(".sw-petro-template-json pre")).toContainText('"id": "porosity"');

  const crossplot = page.getByTestId("petrophysics-crossplot").first();
  const plot = crossplot.locator("svg[role=group]");
  await plot.scrollIntoViewIfNeeded();
  await plot.focus();
  await page.keyboard.press("ArrowRight");
  await expect(plot.locator(".sw-petro-analysis-point-keyboard")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("petrophysics-link-status")).toContainText("cursor");
  const box = (await plot.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.08);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.94, box.y + box.height * 0.88, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId("petrophysics-link-status")).toContainText("brushed");
  await expect(crossplot.locator('[role=status]')).toContainText("paired samples in linked depth range");

  await page.getByTestId("petrophysics-histogram").locator(".sw-petro-histogram-keys button").first().click();
  await expect(page.getByTestId("petrophysics-link-status")).toContainText("brushed");
});
