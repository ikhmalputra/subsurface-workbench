import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { waitForScene } from "./support/scene";
import { SCENE_READY } from "./support/timing";
import { gotoApp, reloadApp, openNavigation } from "./support/app";

test("View well opens the selected record and uses edits as the active revision", async ({ page }) => {
  await gotoApp(page, "/view-well/");
  await page.getByRole("button", { name: /Production casing \/ 7 in/ }).first().focus();
  await page.keyboard.press("Enter");
  await page.locator(".demo-toolbar").getByRole("link", { name: "Edit well", exact: true }).click();
  await expect(page).toHaveURL(/well=forge.*tool=edit-well.*component=production-casing|well=forge.*component=production-casing.*tool=edit-well/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Edit");
  const inspector = page.getByTestId("assembly-inspector");
  const label = inspector.getByLabel("Label", { exact: true });
  const original = await label.inputValue();
  await label.fill("My edited casing");
  await inspector.getByRole("button", { name: "Apply changes" }).click();
  await expect(page.getByTestId("assembly-status")).toContainText("My edited casing updated");
  await expect(page.getByTestId("curved-assembly-schematic").locator('[data-item-id="production-casing"]').first()).toHaveAttribute("aria-label", /My edited casing/);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => `${node.target.join(" ")} ${node.failureSummary}`).join(", ")}`)).toEqual([]);
  await page.screenshot({ path: "output/playwright/edit-well.png" });
  await reloadApp(page);
  await expect(label).toHaveValue(original);
  await page.getByRole("link", { name: "Back to View well" }).click();
  await expect(page.getByRole("combobox", { name: "View", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Well", exact: true }).selectOption("s-profile");
  await expect(page.locator(".demo-toolbar").getByRole("link", { name: "Edit well", exact: true })).toHaveAttribute("href", "/view-well/?well=s-profile&tool=edit-well");
  await page.locator(".demo-toolbar").getByRole("link", { name: "Edit well", exact: true }).click();
  await expect(page).toHaveURL(/well=s-profile.*tool=edit-well$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("S-profile");
  await page.getByRole("link", { name: "Back to View well" }).click();
  await expect(page.getByRole("combobox", { name: "Well", exact: true })).toHaveValue("s-profile");
  await expect(page.locator(".demo-toolbar").getByRole("link", { name: "Edit well", exact: true })).toHaveAttribute("href", "/view-well/?well=s-profile&tool=edit-well");
});

test("full well edits recompute trajectory and reach construction, source records, report and export", async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await gotoApp(page, "/edit-well/?well=forge");
  const tabs = page.getByRole("tablist", { name: "Well editor" });
  const schematic = page.getByTestId("curved-assembly-schematic");
  await expect(schematic).toBeVisible();
  const drawing = await page.locator(".demo-edit-canvas").boundingBox();
  const tools = await page.locator(".demo-edit-tool-panel").boundingBox();
  expect(drawing).not.toBeNull();
  expect(tools).not.toBeNull();
  expect(tools!.x).toBeGreaterThan(drawing!.x);
  await tabs.getByRole("tab", { name: "Well properties" }).click();
  await expect(schematic).toBeVisible();
  await page.getByLabel("Well name", { exact: true }).fill("My FORGE revision");
  await page.getByLabel("Well name", { exact: true }).press("Tab");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("My FORGE revision");
  const originalDepth = await page.getByLabel("Total depth (m MD)", { exact: true }).inputValue();
  await page.getByLabel("Total depth (m MD)", { exact: true }).fill("-1");
  await page.getByLabel("Total depth (m MD)", { exact: true }).press("Tab");
  await expect(page.getByRole("alert").filter({ hasText: "finite number" })).toBeVisible();
  await page.getByLabel("Total depth (m MD)", { exact: true }).fill(originalDepth);
  await page.getByLabel("Total depth (m MD)", { exact: true }).press("Tab");

  await tabs.getByRole("tab", { name: "Trajectory", exact: true }).click();
  await expect(schematic).toBeVisible();
  const inclination = page.getByLabel("Station 6 inclination", { exact: true });
  const oldInclination = Number(await inclination.inputValue());
  await inclination.fill(String(oldInclination + 1));
  await inclination.press("Tab");
  await expect(inclination).toHaveValue(String(Number((oldInclination + 1).toFixed(2))));
  await page.getByLabel("Station 6 measured depth", { exact: true }).fill("0");
  await page.getByLabel("Station 6 measured depth", { exact: true }).press("Tab");
  await expect(page.getByRole("alert").filter({ hasText: "Station" })).toBeVisible();

  await tabs.getByRole("tab", { name: "Component records" }).click();
  await expect(schematic).toBeVisible();
  await page.getByLabel("Component record", { exact: true }).selectOption("production-hole");
  await page.getByLabel("Component description", { exact: true }).fill("User revised hole record");
  await page.getByLabel("Component description", { exact: true }).press("Tab");
  await tabs.getByRole("tab", { name: "Formations", exact: true }).click();
  await expect(schematic).toBeVisible();
  const formation = page.getByLabel("Formation name", { exact: true });
  await formation.fill("Revised formation");
  await formation.press("Tab");

  await tabs.getByRole("tab", { name: "Records & data" }).click();
  await expect(schematic).toBeVisible();
  await page.getByLabel("Headline", { exact: true }).fill("User revised daily report");
  await page.getByLabel("Headline", { exact: true }).press("Tab");
  await expect(page.getByLabel("Headline", { exact: true })).toHaveValue("User revised daily report");
  await page.getByLabel("Date", { exact: true }).fill("2024-02-30");
  await page.getByLabel("Date", { exact: true }).press("Tab");
  await expect(page.getByRole("alert").filter({ hasText: "valid YYYY-MM-DD" })).toBeVisible();
  await page.getByLabel("Record collection", { exact: true }).selectOption("runs");
  await page.getByLabel("Summary", { exact: true }).fill("User revised service run");
  await page.getByLabel("Summary", { exact: true }).press("Tab");

  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export full well" }).click();
  const download = await pending;
  const path = await download.path();
  if (!path) throw new Error("Full well export did not create a file.");
  const exported = JSON.parse(await readFile(path, "utf8"));
  expect(exported.design.provenance).toBe("user-authored");
  expect(exported.design.survey[5].inclinationDeg).toBeCloseTo(oldInclination + 1);
  expect(exported.design.components.find((entry: { id: string }) => entry.id === "production-hole").description).toBe("User revised hole record");
  expect(exported.design.formations[0].name).toBe("Revised formation");
  expect(exported.operations.days).toHaveLength(76);
  expect(exported.operations.days[0].headline).toBe("User revised daily report");
  expect(exported.operations.runs[0].summary).toBe("User revised service run");
  await page.getByRole("link", { name: "Back to View well" }).click();
  await expect(page.getByTestId("workspace-context")).toContainText("User-authored revision");
  // The 3D view lazily imports Three and renders through software WebGL on CI.
  test.slow();
  await page.getByRole("combobox", { name: "View", exact: true }).selectOption("earth");
  await waitForScene(page);
  await openNavigation(page);
  await page.getByRole("link", { name: "Well report", exact: true }).click();
  // Two separate things can go wrong leaving a software-rendered 3D route, and asserting the report
  // text alone cannot tell them apart: a navigation that has not completed and a report that has
  // not rendered both present as an empty locator. So the URL is checked first, and the report gets
  // a scene-sized budget — this is the only step in the stretch after `waitForScene` that was still
  // on the default 15 s, and the assertion itself is unchanged.
  await expect(page).toHaveURL(/tool=report$/, { timeout: SCENE_READY });
  const report = page.getByTestId("well-report");
  await expect(report, errors.join("\n")).toContainText("My FORGE revision", { timeout: SCENE_READY });
  await expect(report).toContainText("Revised formation");
  await expect(report).toContainText("User revised hole record");
  await expect(report).not.toContainText("two FIT results");
  await openNavigation(page);
  await page.getByRole("link", { name: "View well", exact: true }).click();
  await page.locator(".demo-toolbar").getByRole("link", { name: "Edit well", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Restore original well" }).click();
  await tabs.getByRole("tab", { name: "Well properties" }).click();
  await expect(page.getByLabel("Well name", { exact: true })).not.toHaveValue("My FORGE revision");
  await tabs.getByRole("tab", { name: "Trajectory", exact: true }).click();
  await expect(page.getByLabel("Station 6 inclination", { exact: true })).toHaveValue(String(oldInclination));
});

test("edit page reports unknown wells and fits a phone viewport", async ({ page }) => {
  await gotoApp(page, "/edit-well/?well=missing");
  await expect(page.getByRole("alert").filter({ hasText: "not found" })).toBeVisible();
  await expect(page.getByTestId("assembly-schematic")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, "/edit-well/?well=forge");
  await expect(page.getByTestId("curved-assembly-schematic")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("active revision preserves edits and undo history across navigation while reload restores the source", async ({ page }) => {
  await gotoApp(page, "/edit-well/?well=forge&component=production-casing");
  const inspector = page.getByTestId("assembly-inspector");
  const label = inspector.getByLabel("Label", { exact: true });
  const original = await label.inputValue();
  await label.fill("Draft production casing");
  await inspector.getByRole("button", { name: "Apply changes" }).click();
  await page.getByRole("link", { name: "Back to View well" }).click();
  await expect(page.getByTestId("curved-assembly-schematic").locator('[data-item-id="production-casing"]').first()).toHaveAttribute("aria-label", /Draft production casing/);
  await page.locator(".demo-toolbar").getByRole("link", { name: "Edit well", exact: true }).click();
  await expect(label).toHaveValue("Draft production casing");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(label).toHaveValue(original);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(label).toHaveValue("Draft production casing");

  await page.getByRole("link", { name: "Back to View well" }).click();
  await expect(page).toHaveURL(/\/view-well\//);
  await expect(page.getByRole("combobox", { name: "View", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Well", exact: true }).selectOption("s-profile");
  await expect(page.getByRole("combobox", { name: "Well", exact: true })).toHaveValue("s-profile");
  await expect(page.locator(".demo-toolbar").getByRole("link", { name: "Edit well", exact: true })).toHaveAttribute("href", "/view-well/?well=s-profile&tool=edit-well");
  await page.locator(".demo-toolbar").getByRole("link", { name: "Edit well", exact: true }).click();
  await expect(page.getByTestId("curved-assembly-schematic")).not.toContainText("Draft production casing");
  await page.getByRole("link", { name: "Back to View well" }).click();
  await expect(page.getByRole("combobox", { name: "View", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Well", exact: true }).selectOption("forge");
  await expect(page.locator(".demo-toolbar").getByRole("link", { name: "Edit well", exact: true })).toHaveAttribute("href", "/view-well/?well=forge&tool=edit-well");
  await page.locator(".demo-toolbar").getByRole("link", { name: "Edit well", exact: true }).click();
  await expect(label).toHaveValue("Draft production casing");
  await reloadApp(page);
  await page.getByTestId("curved-assembly-schematic").locator('[data-item-id="production-casing"]').first().focus();
  await page.keyboard.press("Enter");
  await expect(label).toHaveValue(original);
});

test("an edit in the builder is on the section's construction track one click later", async ({ page }) => {
  await gotoApp(page, "/edit-well/?well=forge");
  // Rename a casing through the builder's inspector.
  const curved = page.getByTestId("curved-assembly-schematic");
  await curved.locator('[data-item-id="production-casing"]').first().focus();
  await page.keyboard.press("Enter");
  const inspector = page.getByTestId("assembly-inspector");
  await inspector.getByLabel("Label", { exact: true }).fill("Section-checked casing");
  await inspector.getByRole("button", { name: "Apply changes" }).click();

  // The section is the same spine as View well, over this revision: the renamed casing sits on
  // the construction track beside the mud log and the survey, with nothing re-entered.
  await page.getByRole("group", { name: "Editor view" }).getByRole("button", { name: "Section", exact: true }).click();
  const section = page.getByTestId("well-section");
  await expect(section).toBeVisible();
  await expect(section.getByTestId("assembly-schematic").locator('[data-item-id="production-casing"]')).toHaveAttribute("aria-label", /Section-checked casing/);
  await expect(section.getByTestId("log-tracks")).toBeAttached();
  await expect(section.getByTestId("trajectory-log")).toBeAttached();
  // Back to the editor, which kept its canvas and its undo history.
  await page.getByRole("group", { name: "Editor view" }).getByRole("button", { name: "Edit", exact: true }).click();
  await expect(curved).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
});
