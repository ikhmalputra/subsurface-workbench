import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoApp, openNavigation } from "./support/app";

test("desktop opens a drawing-first workspace with a single ownership point for controls", async ({ page }) => {
  await gotoApp(page, "/view-well/");
  await expect(page.getByRole("combobox", { name: "Well", exact: true })).toHaveCount(1);
  // The navigation is a floating panel; open it to count the workspaces, then put it away.
  await openNavigation(page);
  const workspaces = page.getByRole("group", { name: "Workspaces", exact: true });
  await expect(workspaces.getByRole("link")).toHaveCount(4);
  for (const name of ["Well", "Design", "Field", "Analysis"]) await expect(workspaces.getByRole("link", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close navigation" }).click();
  // The workspace opens on the well section — the schematic with the log and survey as tracks on
  // one depth axis — and no 3D canvas has been started for it.
  await expect(page.getByRole("combobox", { name: "View", exact: true })).toHaveValue("section");
  await expect(page.getByTestId("well-section")).toBeVisible();
  await expect(page.getByTestId("assembly-scene")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Section", exact: true })).toHaveAttribute("aria-pressed", "true");
  // The rest of this test is about the curved drawing's geometry and chrome, one click away.
  await page.getByRole("button", { name: "Curved", exact: true }).click();
  await expect(page.getByTestId("curved-assembly-schematic")).toBeVisible();
  await expect(page.getByRole("button", { name: "Curved", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("link", { name: "Edit well", exact: true })).toHaveCount(1);
  // With nothing selected the inspector describes the well and the view it is showing. It used to
  // be the single sentence under a "Views" heading; the heading is now "This view" and the well's
  // own facts sit above it, so the assertion checks both halves rather than the old wording.
  const inspector = page.getByRole("complementary", { name: "Component inspector" });
  await expect(inspector).toContainText("This well");
  await expect(inspector).toContainText("3,339 m MD");
  await expect(inspector).toContainText("Follow the measured trajectory in a schematic section.");
  await expect(page.getByRole("region", { name: "Component inventory", exact: true })).toBeHidden();
  await expect(page.getByTestId("well-file")).toBeHidden();
  await expect(page.getByRole("combobox", { name: "Theme", exact: true })).toBeHidden();

  // One sheet: the drawing is the window, the panels float over it.
  const drawing = (await page.getByRole("region", { name: "Curved well construction" }).boundingBox())!;
  expect(drawing.y).toBeLessThan(240);
  expect(drawing.width).toBeGreaterThan(750);
  expect(drawing.height).toBeGreaterThanOrEqual(700);
  expect(drawing.y + drawing.height).toBeLessThanOrEqual(1000);
  const depthControls = (await page.locator(".demo-drawing-status").boundingBox())!;
  expect(depthControls.y + depthControls.height).toBeLessThanOrEqual(1000);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
  await page.screenshot({ path: "output/playwright/workbench-desktop.png" });

  await page.getByRole("button", { name: /Production casing \/ 7 in/ }).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("demo-record")).toHaveAttribute("data-component-id", "production-casing");
  await page.getByRole("combobox", { name: "View", exact: true }).selectOption("scene");
  await expect(page.getByTestId("assembly-scene")).toHaveAttribute("data-selected", "production-casing");
  await expect(page.getByTestId("assembly-schematic")).toHaveCount(0);
  await page.locator(".demo-records-drawer > summary").click();
  await expect(page.getByTestId("well-file")).toContainText("76 daily reports");
});

test("drawing tools locate exact depth, focus sourced intervals and reclaim inspector space", async ({ page }) => {
  await gotoApp(page, "/view-well/");
  await page.getByRole("button", { name: "Schematic", exact: true }).click();
  const drawing = page.getByRole("region", { name: "Construction schematic" });
  // The inspector docks to the right by default and takes its column; hiding it gives the
  // column back to the drawing.
  const width = (await drawing.boundingBox())!.width;
  await page.getByRole("button", { name: "Hide inspector", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Component inspector" })).toBeHidden();
  await expect.poll(async () => (await drawing.boundingBox())!.width).toBeGreaterThan(width + 250);
  await page.getByRole("button", { name: "Show inspector", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Component inspector" })).toBeVisible();
  await page.getByLabel("Go to MD", { exact: true }).fill("1500.5");
  await page.getByRole("button", { name: "Locate depth", exact: true }).click();
  await expect(page.getByTestId("workspace-context")).toContainText("Depth: 1,500.5 m MD");
  await page.getByLabel("Go to MD", { exact: true }).fill("-5");
  await page.getByRole("button", { name: "Locate depth", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Enter an MD between" })).toBeVisible();
  await expect(page.getByTestId("workspace-context")).toContainText("Depth: 1,500.5 m MD");
  await page.getByRole("button", { name: "Components", exact: true }).click();
  const inventory = page.getByRole("region", { name: "Component inventory", exact: true });
  await inventory.getByLabel("Search", { exact: true }).fill("Surface casing");
  await inventory.getByRole("button", { name: /Surface casing/ }).click();
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  await expect(page.getByRole("button", { name: "Focus selected interval", exact: true })).toBeDisabled();
  await expect(page.getByRole("complementary", { name: "Component inspector" })).toContainText("top MD not reported");
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await inventory.getByLabel("Search", { exact: true }).fill("Intermediate hole");
  await inventory.getByRole("button", { name: /Intermediate hole/ }).click();
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  await page.getByRole("button", { name: "Focus selected interval", exact: true }).click();
  await expect(page.getByTestId("assembly-cursor")).toHaveCount(1);
  await expect(drawing.locator("header small")).not.toHaveText("0 – 3,339 m MD · TD");
  await page.getByRole("button", { name: "Focus selected interval", exact: true }).press("Escape");
  await expect(page.getByTestId("workspace-context")).toContainText("No component selected");
  await expect(page.getByTestId("workspace-context")).toContainText("Depth: not selected");
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await expect(page.getByRole("region", { name: "Drawing basis" })).toContainText("Published records");
});

test("phone navigation is deliberate, keyboard accessible and closes after changing tasks", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, "/view-well/");
  const menu = page.getByRole("button", { name: "Open navigation" });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("link", { name: "3D trajectory", exact: true })).toBeHidden();
  // On a phone the section scrolls sideways inside its own box; the page itself must not.
  await expect(page.getByTestId("well-section")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await menu.focus();
  await menu.press("Enter");
  await expect(page.getByRole("button", { name: "Close navigation" })).toHaveAttribute("aria-expanded", "true");
  await openNavigation(page);
  await page.getByRole("link", { name: "3D trajectory", exact: true }).click();
  await expect(page).toHaveURL(/tool=trajectory$/);
  await expect(page.getByRole("button", { name: "Open navigation" })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("combobox", { name: "Well", exact: true })).toHaveCount(1);
  await page.screenshot({ path: "output/playwright/workbench-mobile.png" });
});
