import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { gotoApp, reloadApp, openAppearance } from "./support/app";

test("engineering study completes scope, QC, evidence, findings and durable export", async ({ page }) => {
  const renderingErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error" && message.text().includes("<path>")) renderingErrors.push(message.text()); });
  await gotoApp(page, "/analysis/");
  await expect(page.getByRole("heading", { name: "Drilling performance review" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open independent synthetic example" })).toHaveCount(0);
  await page.getByLabel("Investigation question").fill("Why does sampled ROP change between these intervals?");
  await page.getByLabel("Target interval top (m MD)").fill("1000");
  await page.getByLabel("Target interval base (m MD)").fill("2000");
  await page.getByLabel("Comparison interval top (m MD)").fill("100");
  await page.getByLabel("Comparison interval base (m MD)").fill("1000");
  await page.getByRole("button", { name: "Check inputs", exact: true }).click();
  await page.getByRole("checkbox", { name: "I reviewed source units, depth reference and sampling limitations" }).check();
  await page.getByRole("button", { name: "Review evidence", exact: true }).click();
  await expect(page.getByText("Target sampled mean ROP", { exact: true })).toBeVisible();
  await page.getByLabel("Evidence interval").selectOption("comparison");
  await expect(page.getByRole("heading", { name: "Comparison drilling evidence", exact: true })).toBeVisible();
  const fullLog = page.getByRole("button", { name: "Full log", exact: true });
  await expect(fullLog).toHaveAttribute("aria-pressed", "false");
  await fullLog.click();
  await expect(fullLog).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Zoom to selection", exact: true }).click();
  await expect(fullLog).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("Target 1000–2000 m MD vs comparison 100–1000 m MD.", { exact: true })).toBeVisible();
  await page.getByText("Inspect and attach exact log samples", { exact: true }).click();
  await page.getByRole("button", { name: /Attach sample/ }).first().click();
  await expect(page.getByTestId("workspace-context")).not.toContainText("Depth: not selected");
  await page.getByRole("button", { name: "Attach interval comparison" }).click();
  const records = page.getByRole("region", { name: "Operational evidence", exact: true });
  await expect(records.getByRole("table", { name: "comparison overlapping runs" })).toBeVisible();
  const attachRun = records.getByRole("button", { name: /^Attach run / }).first();
  const runId = (await attachRun.getAttribute("aria-label"))!.replace("Attach run ", "");
  await attachRun.click();
  await expect(records.getByRole("button", { name: `Detach run ${runId}`, exact: true })).toHaveAttribute("aria-pressed", "true");
  await records.getByRole("button", { name: /Daily reports/ }).click();
  await expect(records.getByRole("table", { name: "comparison daily reports by end-of-day MD" })).toBeVisible();
  await records.locator("tbody summary").first().click();
  await expect(records.locator("tbody details").first()).toHaveAttribute("open", "");
  const attachDay = records.getByRole("button", { name: /^Attach daily report / }).first();
  const dayDate = (await attachDay.getAttribute("aria-label"))!.replace("Attach daily report ", "");
  await attachDay.click();
  await expect(records.getByRole("button", { name: `Detach daily report ${dayDate}`, exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Record findings" }).click();
  await page.getByLabel("Finding", { exact: true }).fill("The two sampled ROP means differ; the comparison alone does not establish cause.");
  await page.getByLabel("Uncertainty and next check").fill("Review lithology, bit condition and operational timing before attributing the difference.");
  await page.getByRole("button", { name: "Save finding" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Study saved on this device." })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export study", exact: true }).click();
  const artifact = await download;
  expect(artifact.suggestedFilename()).toBe("forge-drilling-study.json");
  const path = await artifact.path();
  if (!path) throw new Error("Study export was not produced.");
  const report = JSON.parse(await readFile(path, "utf8"));
  expect(report.study.question).toBe("Why does sampled ROP change between these intervals?");
  expect(report.study.results.target.validCount).toBeGreaterThan(0);
  expect(report.assumptions).toHaveLength(5);
  expect(report.evaluation.target.rows.length).toBeGreaterThan(0);
  expect(report.study.evidenceIds).toEqual(expect.arrayContaining([`run:${runId}`, `day:${dayDate}`]));
  expect(renderingErrors).toEqual([]);
  await reloadApp(page);
  const saved = page.getByLabel("Saved studies", { exact: true });
  await saved.selectOption({ label: "Why does sampled ROP change between these intervals?" });
  await page.getByRole("button", { name: /4.*Findings/ }).click();
  await expect(page.getByRole("textbox", { name: "Finding", exact: true })).toHaveValue(/sampled ROP means differ/);
  await page.getByRole("button", { name: "Save finding" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Review evidence" })).toBeVisible();
});

test("operational evidence stays compact, keyboard accessible and themed on phones", async ({ page }) => {
  await gotoApp(page, "/analysis/");
  await page.getByRole("button", { name: "Check inputs", exact: true }).click();
  await page.getByRole("checkbox", { name: /I reviewed source units/ }).check();
  await page.getByRole("button", { name: "Review evidence", exact: true }).click();
  const records = page.getByRole("region", { name: "Operational evidence", exact: true });
  await openAppearance(page);
  for (const theme of ["light", "dark", "high-contrast"]) {
    await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption(theme);
    for (const name of [/^Runs/, /^Daily reports/]) {
      await records.getByRole("button", { name }).click();
      await records.locator("tbody summary").first().focus();
      await page.keyboard.press("Enter");
      await expect(records.locator("tbody details").first()).toHaveAttribute("open", "");
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await records.locator("tbody summary").first().press("Enter");
    }
  }
  await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("light");
  await page.setViewportSize({ width: 390, height: 844 });
  await records.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  const tableBounds = await records.locator(".demo-study-context-table").boundingBox();
  expect(tableBounds?.height).toBeLessThanOrEqual(320);
  const register = records.getByRole("region", { name: "Daily reports register", exact: true });
  expect(await register.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const mobileAttach = register.getByRole("button", { name: /^Attach daily report/ }).first();
  const actionBounds = await mobileAttach.boundingBox();
  const registerBounds = await register.boundingBox();
  if (!actionBounds || !registerBounds) throw new Error("Mobile record action is not rendered.");
  expect(actionBounds.x + actionBounds.width).toBeLessThanOrEqual(registerBounds.x + registerBounds.width);
  await mobileAttach.click();
  await expect(register.getByRole("button", { name: /^Detach daily report/ }).first()).toHaveAttribute("aria-pressed", "true");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await register.focus();
  await page.keyboard.press("PageDown");
  await expect.poll(() => register.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const headerBounds = await register.locator("thead").boundingBox();
  // The invariant is that the header stays pinned to the register's top while the register scrolls
  // internally, so compare against where the register is now: focusing it can scroll the page itself.
  const scrolledRegisterBounds = (await register.boundingBox())!;
  expect(headerBounds?.y).toBeCloseTo(scrolledRegisterBounds.y, 0);
  await records.getByRole("button", { name: /^Runs/ }).click();
  await records.getByRole("button", { name: /^Daily reports/ }).click();
  await expect.poll(() => register.evaluate((element) => element.scrollTop)).toBe(0);
  await records.screenshot({ path: "output/playwright/analysis-records-phone.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await records.scrollIntoViewIfNeeded();
  await records.screenshot({ path: "output/playwright/analysis-records-desktop.png" });
});

test("blocked study writes report failure without claiming durable save", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "subsurface:drilling-studies:v1") throw new Error("Study storage denied");
      return original.call(this, key, value);
    };
  });
  await gotoApp(page, "/analysis/");
  await page.getByRole("button", { name: "Check inputs", exact: true }).click();
  await page.getByRole("checkbox", { name: /I reviewed source units/ }).check();
  await page.getByRole("button", { name: "Review evidence", exact: true }).click();
  await page.getByRole("button", { name: "Attach interval comparison" }).click();
  await page.getByRole("button", { name: "Record findings" }).click();
  await page.getByLabel("Finding", { exact: true }).fill("Observation");
  await page.getByLabel("Uncertainty and next check").fill("Unknown cause");
  await page.getByRole("button", { name: "Save finding" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Study storage denied" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Study saved" })).toHaveCount(0);
});

test("Analysis has honest missing-data state, storage errors and responsive themed workflow", async ({ page }) => {
  await gotoApp(page, "/analysis/");
  await openAppearance(page);
  for (const theme of ["light", "dark", "high-contrast"]) {
    await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption(theme);
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => node.target) }))).toEqual([]);
  }
  await page.getByRole("combobox", { name: "Well", exact: true }).selectOption("s-profile");
  await page.getByRole("button", { name: "Check inputs", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "No synthetic replacement" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review evidence", exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await page.addInitScript(() => localStorage.setItem("subsurface:drilling-studies:v1", "{broken"));
  await reloadApp(page);
  await expect(page.getByRole("alert").filter({ hasText: "Saved studies could not be loaded" })).toBeVisible();
});
