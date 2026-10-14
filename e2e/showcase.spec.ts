import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { SCENE_READY, SOFTWARE_RENDERING } from "./support/timing";
import { waitForScene } from "./support/scene";
import { gotoApp, openNavigation, selectWellView, openTool } from "./support/app";

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => Array.from(document.body.querySelectorAll<HTMLElement>("*"))
    // Regions that scroll sideways by design are exempt: the well section's tracks are wider than
    // a phone and the section itself is the scroller, which is the same arrangement as the station
    // table. The test is about the page, which must never scroll sideways.
    .filter((element) => !element.closest(".demo-code pre, .demo-install, .sw-traj-table-scroll table, .sw-wd-steps ol, .demo-section"))
    .map((element) => ({ tag: element.tagName, className: String(element.className), right: Math.round(element.getBoundingClientRect().right), left: Math.round(element.getBoundingClientRect().left) }))
    .filter((bounds) => bounds.right > window.innerWidth + 1 || bounds.left < -1));
}

async function noAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
}

test("landing page links every capability to a working consumer example", async ({ page }) => {
  await gotoApp(page, "/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Start with the well");
  const cards = page.getByTestId("capability-card");
  await expect(cards).toHaveCount(5);
  const hrefs = await cards.evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(hrefs).toEqual(["/view-well/", "/builder/", "/trajectory/", "/analysis/", "/well-report/"]);
  await expect(page.getByRole("table")).toContainText("@ikhmalputra/subsurface-react/assembly-three");
  await noAxeViolations(page);
  await page.screenshot({ path: "output/playwright/showcase-home.png", fullPage: true });
  await cards.first().click();
  await expect(page).toHaveURL(/\/view-well\/$/);
  await openNavigation(page);
  await expect(page.getByRole("link", { name: "View well" })).toHaveAttribute("aria-current", "page");
});

test("view-well composes the adapter, 2.5D schematic and 3D cutaway directly", async ({ page }) => {
  test.slow(SOFTWARE_RENDERING, "software-rendered 3D cutaway");
  await gotoApp(page, "/view-well/");
  // View well opens on the well section; this test is about the straight 2.5D schematic.
  await page.getByRole("combobox", { name: "View", exact: true }).selectOption("schematic");
  await expect(page.locator(".sw-asm-item")).toHaveCount(7);
  // Hidden, not destroyed: a preset the 3D cutaway is not part of no longer throws the scene away.
  // It is mounted on first use and kept, so returning to "split" does not rebuild it.
  await expect(page.locator(".sw-asm-scene")).not.toBeVisible();
  await page.getByRole("combobox", { name: "View", exact: true }).selectOption("split");
  await expect(page.locator(".sw-asm-scene canvas")).toBeVisible();
  await page.getByRole("button", { name: /Production casing \/ 7 in/ }).first().click();
  await expect(page.getByTestId("demo-record")).toHaveAttribute("data-component-id", "production-casing");
  await expect(page.getByTestId("demo-record")).toContainText("Source · page 67");

  await page.getByRole("combobox", { name: "View", exact: true }).selectOption("schematic");
  await expect(page.locator(".sw-asm-scene")).not.toBeVisible();
  await page.getByRole("combobox", { name: "View", exact: true }).selectOption("split");

  await page.getByRole("combobox", { name: "Well", exact: true }).selectOption("s-profile");
  await expect(page.locator(".sw-asm-item").first()).toBeVisible();
  expect(await page.locator(".sw-asm-item").count()).toBeGreaterThan(7);
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await expect(page.getByTestId("component-inventory-total")).toHaveText("746 records");

  await page.getByText("Usage and SDK details").click();
  await expect(page.locator(".demo-code pre")).toContainText("wellComponentsToAssembly");
  await noAxeViolations(page);
  await page.screenshot({ path: "output/playwright/showcase-view-well.png", fullPage: true });
});

test("view-well selection is pronounced and both views explode into individual components", async ({ page }) => {
  // Mounts the 3D cutaway through software WebGL; a loaded runner has taken two minutes to get
  // there, which left nothing for the rest of the test.
  test.slow(SOFTWARE_RENDERING, "software-rendered 3D cutaway");
  await gotoApp(page, "/view-well/");
  await page.getByRole("combobox", { name: "View", exact: true }).selectOption("split");
  const schematic = page.locator(".sw-asm-schematic-frame > svg");
  await expect(schematic).not.toHaveAttribute("data-has-selection", /.*/);
  await page.getByRole("button", { name: /Production casing \/ 7 in/ }).first().click();
  await expect(schematic).toHaveAttribute("data-has-selection", "true");
  await expect(page.getByTestId("assembly-selection-band")).toBeVisible();
  await expect(page.getByTestId("assembly-scene")).toHaveAttribute("data-selected", "production-casing");
  await expect(page.locator(".sw-asm3d-tag")).toHaveText("Production casing / 7 in");

  await page.getByRole("button", { name: "Isolate selected component" }).click();
  await expect(page.getByTestId("assembly-scene")).toHaveAttribute("data-isolated", "true");
  await page.getByRole("button", { name: "Isolate selected component" }).click();
  await expect(page.getByTestId("assembly-scene")).toHaveAttribute("data-isolated", "false");

  await page.getByRole("region", { name: "Construction schematic" }).getByRole("button", { name: "Exploded view" }).click();
  const exploded = page.getByTestId("assembly-exploded");
  await expect(exploded).toBeVisible();
  await expect(page.getByTestId("assembly-scene")).toHaveAttribute("data-exploded", "true");
  await expect(exploded.locator(".sw-asm-part")).toHaveCount(7);
  await expect(exploded.locator('.sw-asm-part[data-item-id="production-casing"]')).toHaveAttribute("aria-pressed", "true");
  await exploded.locator('.sw-asm-part[data-item-id="surface-casing"]').click();
  await expect(page.getByTestId("demo-record")).toHaveAttribute("data-component-id", "surface-casing");
  await expect(exploded.locator('.sw-asm-part[data-item-id="surface-casing"]')).toHaveAttribute("aria-pressed", "true");
  await noAxeViolations(page);
  await page.screenshot({ path: "output/playwright/showcase-view-well-exploded.png", fullPage: true });

  await page.getByRole("region", { name: "Construction schematic" }).getByRole("button", { name: "Exploded view" }).click();
  await expect(exploded).toHaveCount(0);
  await expect(page.getByTestId("assembly-scene")).toHaveAttribute("data-exploded", "false");
});

test("trajectory path click probes depth and selects the string at that depth", async ({ page }) => {
  await gotoApp(page, "/trajectory/");
  // The survey opens on the well section; the 3D well is one of the section's presets.
  await selectWellView(page, "well3d", ["well3d"]);
  const scene = page.getByTestId("interactive-well-scene");
  await expect(scene).toHaveAttribute("data-ready", "true", { timeout: SCENE_READY });
  const readout = page.getByTestId("well-scene-readout");
  await expect(readout).toHaveAttribute("data-md", "");
  const box = (await scene.boundingBox())!;
  let hit: [number, number] | null = null;
  for (let fy = 0.55; fy < 0.95 && !hit; fy += 0.015) {
    for (let fx = 0.3; fx < 0.75 && !hit; fx += 0.006) {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
      if (await readout.getAttribute("data-md")) hit = [fx, fy];
    }
  }
  expect(hit).not.toBeNull();
  await page.mouse.click(box.x + box.width * hit![0], box.y + box.height * hit![1]);
  await page.mouse.move(box.x + 4, box.y + box.height - 4);
  await expect(readout).not.toHaveAttribute("data-md", "");
  expect(Number(await readout.getAttribute("data-md"))).toBeGreaterThan(0);
  await expect(page.getByTestId("demo-record")).not.toHaveAttribute("data-component-id", "surface-casing");
  await expect(readout).toContainText((await page.getByTestId("demo-record").locator("h2").textContent())!);
  await noAxeViolations(page);
  await page.screenshot({ path: "output/playwright/showcase-trajectory.png" });
});

test("trajectory math is verified, the planner hits a dragged target and station edits recompute", async ({ page }) => {
  // The survey is the section with its summary and station editor beside it; the planner is a
  // tool over the same section, and the plan view is one of the section's presets.
  await gotoApp(page, "/trajectory/");
  await expect(page.getByTestId("trajectory-verification")).toContainText("422 stations");
  await expect(page.getByTestId("trajectory-summary")).toContainText("3,339.1 m");
  await selectWellView(page, "well3d", ["well3d"]);
  await waitForScene(page);
  await expect(page.getByTestId("well-scene-dls-legend")).toBeVisible();

  await openTool(page, "Drilling", "Planner");
  await expect(page.getByTestId("trajectory-preview")).toContainText("build & hold plan");
  await selectWellView(page, "trajectory", ["plan", "section"]);
  const holdBefore = await page.getByLabel("Solved build and hold geometry").textContent();
  const handle = page.getByTestId("trajectory-plan-view").getByRole("slider");
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2 - 40, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByLabel("Solved build and hold geometry")).not.toHaveText(holdBefore!);
  const targetEast = Number(await page.getByLabel("Target east (m)").inputValue());
  const targetTvd = Number(await page.getByLabel("Target TVD (m)").inputValue());
  const targetMd = Number((await page.getByLabel("Solved build and hold geometry").getByText(/m$/).last().textContent())!.replace(/[^0-9.]/g, ""));
  const lastRow = page.getByTestId("survey-table").locator("tbody tr").last();
  expect(Math.abs(Number((await lastRow.locator("td").nth(0).textContent())!.replace(/,/g, "")) - targetMd)).toBeLessThan(0.1);
  expect(Math.abs(Number((await lastRow.locator("td").nth(3).textContent())!.replace(/,/g, "")) - targetTvd)).toBeLessThan(0.05);
  expect(Math.abs(Number((await lastRow.locator("td").nth(5).textContent())!.replace(/,/g, "")) - targetEast)).toBeLessThan(0.05);

  // Editing a station in the station editor takes over the preview from the plan.
  await page.getByRole("button", { name: "Edit these stations", exact: true }).click();
  const tvdCell = page.getByTestId("survey-table").locator("tbody tr").nth(20).locator("td").nth(3);
  const tvdBefore = await tvdCell.textContent();
  const inclination = page.getByLabel("Station 15 inclination");
  await inclination.fill("30");
  await inclination.press("Enter");
  await expect(tvdCell).not.toHaveText(tvdBefore!);
  await expect(page.getByTestId("trajectory-preview")).toContainText("edited stations");
  await expect(page.getByLabel("Survey issues")).toContainText("exceeds the 3°/30 m limit");
  const md = page.getByLabel("Station 16 measured depth");
  await md.fill("1");
  await md.press("Enter");
  await expect(page.locator(".demo-reject")).toContainText("Measured depth must increase");
  await noAxeViolations(page);
});

test("view-well follows the trajectory with the cited FORGE record and shares selection", async ({ page }) => {
  await gotoApp(page, "/view-well/");
  await page.getByRole("combobox", { name: "View", exact: true }).selectOption("profile");
  await expect(page.locator(".sw-asm-scene, .sw-asm-schematic-frame")).not.toBeVisible();
  await expect(page.locator(".demo-toolbar").getByRole("button", { name: "Exploded view" })).toHaveCount(0);
  const viewport = page.getByTestId("Curved well section-viewport");
  await expect(viewport).toHaveAttribute("data-scale", "1");
  await page.getByRole("button", { name: "Zoom in Curved well section" }).click();
  await expect.poll(async () => Number(await viewport.getAttribute("data-scale"))).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Fit Curved well section" }).click();
  await expect(page.getByRole("button", { name: "Trajectory profile", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("schematic-track-trajectory")).toHaveAttribute("aria-label", /survey stations.*Easting.*measured depth/);
  await page.getByRole("button", { name: "Well construction schematic", exact: true }).click();

  await expect(page.getByTestId("schematic-section-production-casing")).toHaveAttribute("aria-label", /7 in.*T95.*10,787 ft/);
  await expect(page.getByTestId("schematic-section-surface-casing")).toHaveAttribute("aria-label", /1,629 ft report MD/);
  await page.getByRole("button", { name: "Interval data table", exact: true }).click();
  await expect(page.getByTestId("schematic-track-hole")).toHaveAttribute("aria-label", /17 1\/2 in.*12 1\/4 in.*8 3\/4 in/);
  await expect(page.getByTestId("schematic-track-casing")).toHaveAttribute("aria-label", /1,629 ft.*5,110 ft.*10,787 ft/);
  await page.getByTestId("schematic-component-production-hole").click();
  await expect(page.getByTestId("demo-record")).toHaveAttribute("data-component-id", "production-hole");

  await page.getByRole("button", { name: "Well construction schematic", exact: true }).click();
  await page.getByTestId("schematic-component-production-casing").click();
  await expect(page.getByTestId("demo-record")).toHaveAttribute("data-component-id", "production-casing");
  await page.getByRole("combobox", { name: "View", exact: true }).selectOption("split");
  await expect(page.getByTestId("assembly-scene")).toHaveAttribute("data-selected", "production-casing");

  await page.getByRole("combobox", { name: "View", exact: true }).selectOption("profile");
  await expect(page.getByRole("button", { name: "Well construction schematic", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Trajectory profile", exact: true }).click();
  await page.getByRole("combobox", { name: "Well", exact: true }).selectOption("s-profile");
  await expect(page.getByTestId("schematic-track-trajectory")).toBeVisible();
  await noAxeViolations(page);
  await page.screenshot({ path: "output/playwright/showcase-view-well-curved.png", fullPage: true });
});

// Desktop-only product (Ikhmal, 2026-10-13): phone layout is out of scope.
test.skip("showcase pages fit a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/view-well/", "/builder/", "/trajectory/"]) {
    await gotoApp(page, path);
    await page.waitForLoadState("networkidle");
    expect(await horizontalOverflow(page), path).toEqual([]);
  }
  await gotoApp(page, "/");
  // The application shell is the viewport (100dvh with its own scroll region), so a full-page
  // capture adds nothing; this captures what a phone shows. `gotoApp` waits for a painted frame,
  // which is what the capture needs — it was refused when this ran after the file's 3D tests.
  await page.screenshot({ path: "output/playwright/showcase-home-mobile.png" });
});

test("view-well inventory searches every record and shares selection with the schematic", async ({ page }) => {
  await gotoApp(page, "/view-well/");
  await page.getByRole("combobox", { name: "Well", exact: true }).selectOption("s-profile");
  // The inventory links selection to the straight schematic's drawing items.
  await page.getByRole("combobox", { name: "View", exact: true }).selectOption("schematic");
  await expect(page.getByRole("button", { name: "Components", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Components", exact: true }).click();
  const inventory = page.getByRole("region", { name: "Component inventory", exact: true });
  await expect(inventory.getByTestId("component-inventory-total").first()).toHaveText("746 records");
  await inventory.getByLabel("Type").selectOption("Tubing joint");
  await expect(inventory).toContainText("209 matching · page 1 of 21");
  await inventory.getByRole("button", { name: "Next records" }).click();
  await expect(inventory).toContainText("page 2 of 21");
  await inventory.locator('[data-component-id="tubular-joint-11"]').click();
  // Selecting a record hands the inspector back to the record panel, so the
  // inventory unmounts; the selection itself must still reach record and drawing.
  await expect(page.getByTestId("demo-record")).toHaveAttribute("data-component-id", "tubular-joint-11");
  await expect(page.locator('.sw-asm-schematic-frame [data-item-id="tubular"]').first()).toHaveAttribute("aria-pressed", "true");

  // Re-opening the inventory jumps to the page holding the shared selection.
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await expect(inventory.locator('[data-component-id="tubular-joint-11"]')).toHaveAttribute("aria-pressed", "true");
  await inventory.getByLabel("Type").selectOption("all");
  await inventory.getByLabel("Search").fill("mandrel");
  await expect(inventory).toContainText("3 matching · page 1 of 1");
  await inventory.getByLabel("Search").fill("");
  await page.locator('.sw-asm-schematic-frame [data-item-id="mandrel-2"]').first().click();
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await expect(inventory.locator('[data-component-id="mandrel-2"]')).toHaveAttribute("aria-pressed", "true");
  await expect(inventory.locator('[data-component-id="mandrel-2"]')).toBeVisible();
  await noAxeViolations(page);
  await page.screenshot({ path: "output/playwright/showcase-view-well-inventory.png", fullPage: true });
});

test("view-well well file links history, runs and mud log to the construction by depth", async ({ page }) => {
  await gotoApp(page, "/view-well/");
  await page.locator(".demo-records-drawer > summary").click();
  const file = page.getByTestId("well-file");
  await expect(file).toContainText("76 daily reports · 54 service runs");
  const history = file.getByTestId("well-history-log");
  await expect(history).toContainText("76 of 76 reports");
  await expect(history.getByTestId("history-day")).toHaveCount(8);
  await history.getByRole("button", { name: "Show report for 20 Oct 2020" }).click();
  await expect(history).toContainText("Daily operations summary, p. 1");
  await history.getByLabel("Search").fill("packer");
  await expect(history).not.toContainText("76 of 76 reports");

  await file.getByTestId("hole-section-log").getByRole("button", { name: /Intermediate/ }).click();
  await expect(page.getByTestId("demo-record")).toHaveAttribute("data-component-id", "intermediate-hole");
  await expect(file).toContainText("linked to Intermediate hole");

  await file.getByRole("tab", { name: "Service & BHA runs" }).click();
  const runs = file.getByTestId("service-run-log");
  await expect(runs).toContainText("54 runs");
  await runs.getByLabel(/Only 1,629/).check();
  await expect(runs.getByTestId("service-run").locator("td:first-child, th:first-child")).toHaveText(["BHA 03", "BHA 04", "BHA 05", "BHA 06", "BHA 07"]);
  await noAxeViolations(page);

  await file.getByRole("tab", { name: "Mud log" }).click();
  const log = file.getByTestId("log-tracks");
  await expect(log).toContainText("130–10,980 ft");
  await log.locator(".sw-logs-frame > svg").scrollIntoViewIfNeeded();
  const box = (await log.locator(".sw-logs-frame > svg").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6);
  await expect(page.getByTestId("demo-record")).toHaveAttribute("data-component-id", "production-hole");
  await expect(log.getByTestId("log-readout")).toContainText("ROP");
  await noAxeViolations(page);
  await page.screenshot({ path: "output/playwright/showcase-view-well-file.png", fullPage: true });

  await page.getByRole("combobox", { name: "Well", exact: true }).selectOption("s-profile");
  await expect(page.getByTestId("well-file-empty")).toContainText("Nothing is invented");
});

test("view-well seismic tab parses the FORGE SEG-Y and picks construction by depth on the section", async ({ page }) => {
  await gotoApp(page, "/view-well/");
  await page.locator(".demo-records-drawer > summary").click();
  const file = page.getByTestId("well-file");
  await file.getByRole("tab", { name: "Seismic (SEG-Y)" }).click();
  const section = file.getByTestId("seismic-section");
  await expect(section).toContainText("3D anisotropic PSDM");
  await expect(section).toContainText("110 traces × 801 samples");
  const headers = file.getByTestId("segy-headers");
  await expect(headers).toContainText("4-byte IBM floating point");
  await expect(headers).toContainText("SECTION FROM 3D ANISO PSDM");
  await expect(headers).toContainText("big-endian · EBCDIC text");
  await expect(file).toContainText("not tied to well check-shots");

  await file.getByTestId("hole-section-log").getByRole("button", { name: /Surface/ }).click();
  await expect(page.getByTestId("demo-record")).toHaveAttribute("data-component-id", "surface-hole");
  await expect(section.getByTestId("seismic-selected")).toHaveCount(1);

  // Wellhead is at 0 m along a −750…1975 m line; 1000 m below datum is ~2,820 ft MD (intermediate hole).
  const plot = section.getByTestId("seismic-plot");
  await plot.scrollIntoViewIfNeeded();
  const box = (await plot.boundingBox())!;
  const [, , vbW, vbH] = (await plot.getAttribute("viewBox"))!.split(" ").map(Number) as [number, number, number, number];
  const px = (62 + ((0 + 762.5) / 2750) * (vbW - 80)) / vbW;
  const py = (26 + ((1000 + 2.5) / 4005) * (vbH - 70)) / vbH;
  await page.mouse.move(box.x + box.width * px, box.y + box.height * py);
  await expect(section.getByTestId("seismic-readout")).toContainText("click to select");
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByTestId("demo-record")).toHaveAttribute("data-component-id", "intermediate-hole");
  await expect(headers).toContainText("Shotpoint");

  await page.mouse.move(0, 0);
  await section.getByRole("group", { name: /3D anisotropic PSDM/ }).focus();
  for (let step = 0; step < 20; step += 1) await page.keyboard.press("Shift+ArrowDown");
  await expect(section.getByTestId("seismic-readout")).toContainText("Well MD 3,339 m");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("demo-record")).toHaveAttribute("data-component-id", "production-hole");
  await section.getByLabel("Colour").selectOption("red-blue");
  await noAxeViolations(page);
  await page.screenshot({ path: "output/playwright/showcase-view-well-seismic.png", fullPage: true });
});

test("view-well links seismic, schematic and mud log by depth, and can unlink them", async ({ page }) => {
  await gotoApp(page, "/view-well/");
  await page.getByRole("combobox", { name: "View", exact: true }).selectOption("seismic");
  const schematic = page.getByTestId("assembly-schematic");
  const header = page.getByRole("region", { name: "Construction schematic" }).locator("header small");
  const plot = page.getByTestId("seismic-plot").first();
  await expect(plot).toHaveAttribute("data-view", /^-?\d+:40\d\d$/);
  await expect(page.getByRole("button", { name: "Depth views linked" })).toHaveAttribute("aria-pressed", "true");

  // Zooming the section drives the schematic's MD window through the well path.
  await page.getByRole("button", { name: "Zoom section in" }).click();
  await page.getByRole("button", { name: "Zoom section in" }).click();
  await expect(plot).toHaveAttribute("data-view", "1499:2501");
  await expect(header).toContainText("1,359 m – 2,738 m MD");

  // Zooming the schematic drives the section back.
  await page.getByRole("button", { name: "Zoom depth in" }).click();
  await expect(plot).not.toHaveAttribute("data-view", "1499:2501");
  const linkedView = await plot.getAttribute("data-view");

  // Hover crosses over: schematic → seismic cursor, seismic → schematic cursor.
  await schematic.scrollIntoViewIfNeeded();
  const asm = (await schematic.boundingBox())!;
  await page.mouse.move(asm.x + asm.width * 0.4, asm.y + asm.height * 0.5);
  await expect(page.getByTestId("seismic-cursor")).toHaveCount(1);
  const sec = (await plot.boundingBox())!;
  await page.mouse.move(sec.x + sec.width * 0.3, sec.y + sec.height * 0.5);
  await expect(page.getByTestId("assembly-cursor")).toHaveCount(1);
  await expect(page.getByTestId("seismic-readout").first()).toContainText(/Well (MD|reaches this depth)/);
  await noAxeViolations(page);
  await page.screenshot({ path: "output/playwright/showcase-view-well-linked.png", fullPage: true });

  // The mud log in the well file follows the shared window too.
  await page.locator(".demo-records-drawer > summary").click();
  await page.getByTestId("well-file").getByRole("tab", { name: "Mud log" }).click();
  await expect(page.getByTestId("log-tracks")).not.toContainText("130–10,980 ft");

  // Unlinked, each view zooms on its own.
  await page.mouse.move(0, 0);
  await page.getByRole("button", { name: "Depth views linked" }).click();
  await expect(page.getByRole("button", { name: "Depth views independent" })).toHaveAttribute("aria-pressed", "false");
  const headerBefore = await header.textContent();
  await page.getByRole("button", { name: "Fit whole section" }).click();
  await expect(plot).not.toHaveAttribute("data-view", linkedView!);
  await expect(header).toHaveText(headerBefore!);
  await schematic.hover();
  await expect(page.getByTestId("seismic-cursor")).toHaveCount(0);
});

test("view-well puts the well inside the full seismic volume beside the survey log in one linked 3D view @slow", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1400 });
  await gotoApp(page, "/view-well/");
  await selectWellView(page, "earth", ["earth", "survey"]);
  // The scene first: selecting "earth" starts a software-rendered build that occupies the main
  // thread, and a click issued into that window waits on actionability checks that cannot run.
  const scene = await waitForScene(page);
  await page.locator(".demo-scene-options > summary").click();
  const legend = page.getByTestId("well-scene-section-legend");
  await expect(legend).toContainText("FORGE PSDM volume · 2.75 × 1.52 km");
  // The cube can be volume-rendered and cut open without rebuilding the scene.
  await page.getByRole("button", { name: "Volume render" }).click();
  await expect(page.getByRole("button", { name: "Volume render" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Transparent below")).toBeVisible();
  await page.getByRole("button", { name: "Solid cube" }).click();
  const across = page.getByRole("group", { name: "Cut the volume" }).locator("label", { hasText: "Across well" });
  await across.getByRole("slider").fill("50");
  await expect(across.locator("output")).toHaveText("0 m");
  await expect(scene).toHaveCount(1);
  await page.getByRole("button", { name: "Uncut" }).click();
  await expect(across.locator("output")).toHaveText("763 m");
  const log = page.getByTestId("trajectory-log");
  const readout = page.getByTestId("well-scene-readout");

  // Hovering the survey log moves the shared cursor and prints the interpolated survey values.
  const box = (await log.getByRole("group", { name: /^Inclination, azimuth and dogleg severity/ }).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.6);
  await expect(page.getByTestId("traj-cursor")).toHaveCount(1);
  await expect(log).toHaveAttribute("data-cursor-md", /^\d+\.\d$/);

  // Hovering the cube reads position, TVD and amplitude, and where the well reaches that TVD.
  const canvas = (await scene.locator("canvas").boundingBox())!;
  let onSection: [number, number] | null = null;
  for (let fy = 0.35; fy < 0.8 && !onSection; fy += 0.05) for (let fx = 0.3; fx < 0.75 && !onSection; fx += 0.05) {
    await page.mouse.move(canvas.x + canvas.width * fx, canvas.y + canvas.height * fy);
    if (await page.locator('[data-testid="well-scene-readout"][data-section]').count()) onSection = [fx, fy];
  }
  expect(onSection, "pointer finds the seismic volume").not.toBeNull();
  await expect(readout).toContainText(/FORGE PSDM volume.*along.*offset.*TVD.*amp -?\d+\.\d\d.*(well reaches at MD|below well TD)/s);
  await expect(log).toHaveAttribute("data-cursor-md", /^\d+\.\d$/);

  // Clicking the cube pins that depth on the well, the survey log and the record card.
  await page.mouse.click(canvas.x + canvas.width * onSection![0], canvas.y + canvas.height * onSection![1]);
  await page.mouse.move(0, 0);
  await expect(readout).toHaveAttribute("data-md", /^\d+\.\d$/);
  await expect(page.getByTestId("traj-selected-mark")).toHaveCount(1);
  const pinned = Number(await readout.getAttribute("data-md"));
  await noAxeViolations(page);
  await page.screenshot({ path: "output/playwright/showcase-view-well-3d-seismic.png", fullPage: true });

  // The directional survey in the well file follows the pinned depth.
  await page.locator(".demo-records-drawer > summary").click();
  await page.getByTestId("well-file").getByRole("tab", { name: "Directional survey" }).click();
  const selectedRow = page.getByTestId("survey-table").locator('tr[aria-selected="true"]');
  await expect(selectedRow).toHaveCount(1);
  const rowMd = Number((await selectedRow.locator("td").first().innerText()).replace(/,/g, ""));
  expect(Math.abs(rowMd - pinned)).toBeLessThan(120);
});

test("static host keeps a strict CSP and loads nothing heavy before it is asked for", async ({ page }) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  const response = await gotoApp(page, "/");
  await page.waitForLoadState("networkidle");
  const headers = response!.headers();
  expect(headers["content-security-policy"]).toContain("object-src 'none'");
  expect(headers["content-security-policy"]).not.toContain("unsafe-eval");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(errors).toEqual([]);
  expect(requests.every((url) => url.startsWith("http://127.0.0.1:3101/"))).toBe(true);
  expect(requests.filter((url) => /three|wasm|pyodide/i.test(url))).toEqual([]);
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("view-well presets are sets of panes that keep their state instead of being rebuilt", async ({ page }) => {
  await gotoApp(page, "/view-well/");
  const view = page.getByRole("combobox", { name: "View", exact: true });

  // Open every pane once so each is mounted, then stamp the live nodes. A stamp survives a
  // re-render and cannot survive a remount, which is the only way to tell them apart.
  for (const preset of ["schematic", "split", "profile", "curved"]) await view.selectOption(preset);
  const schematic = page.getByTestId("assembly-schematic");
  const cutaway = page.getByTestId("assembly-scene");
  const viewport = page.getByTestId("Curved well section-viewport");
  for (const pane of [schematic, cutaway, viewport]) {
    await expect(pane).toBeAttached();
    await pane.evaluate((element) => element.setAttribute("data-mount-check", "same-pane"));
  }

  // Zoom the curved section, so there is view state a rebuild would lose.
  await view.selectOption("profile");
  await page.getByRole("button", { name: "Zoom in Curved well section" }).click();
  const zoomed = Number(await viewport.getAttribute("data-scale"));
  expect(zoomed).toBeGreaterThan(1);

  for (const preset of ["schematic", "split", "seismic", "curved", "profile"]) {
    await view.selectOption(preset);
    for (const pane of [schematic, cutaway, viewport]) {
      await expect(pane).toHaveAttribute("data-mount-check", "same-pane");
    }
  }

  // Back on the preset that shows it, the section is still where the reader left it.
  await expect(viewport).toHaveAttribute("data-scale", String(zoomed));

  // And a preset is a set: "2.5D + seismic" shows the construction drawing and the section at once,
  // which is what makes them comparable rather than sequential.
  await view.selectOption("seismic");
  await expect(schematic).toBeVisible();
  await expect(page.getByTestId("seismic-section")).toBeVisible();
  await expect(cutaway).not.toBeVisible();
});

test("the active well's trajectory is a preset of its own workspace, sharing one depth", async ({ page }) => {
  await gotoApp(page, "/view-well/");
  const view = page.getByRole("combobox", { name: "View", exact: true });
  await view.selectOption("trajectory");

  // Plan view and vertical section of the well that is already active — the surveyed path was
  // rendered by five component sets across four routes, so asking where this well goes meant
  // leaving the well.
  const plan = page.locator("[data-pane='plan']");
  const section = page.locator("[data-pane='section']");
  await expect(plan).toBeVisible();
  await expect(section).toBeVisible();

  // Both mark the same casing shoes, from one derivation. FORGE has three casing strings, and the
  // marker label is the nominal size — asserting the count rather than the wording keeps this about
  // the shared derivation rather than the phrasing.
  for (const pane of [plan, section]) {
    await expect(pane.locator(".sw-traj-marker")).toHaveCount(3);
  }
  await expect(section.getByText("7 in shoe")).toBeAttached();

  // One depth: picking in the section moves the pinned MD that every other pane reads.
  await page.getByRole("spinbutton", { name: "Go to MD" }).fill("2000");
  await page.getByRole("button", { name: "Locate depth" }).click();
  const pinned = page.getByRole("status").filter({ hasText: "Pinned" });
  await expect(pinned).toContainText("2,000 m MD");

  // And the construction is one selection away, in the same workspace, with the depth intact.
  await view.selectOption("curved");
  await expect(page.getByTestId("curved-assembly-schematic")).toBeVisible();
  await expect(pinned).toContainText("2,000 m MD");
});

test("the days-vs-depth chart shares the one depth cursor with the construction and the mud log", async ({ page }) => {
  await gotoApp(page, "/view-well/");
  await page.locator(".demo-records-drawer > summary").click();
  const chart = page.getByTestId("days-vs-depth");
  await expect(chart).toBeVisible();

  // Nine runs did not complete. Five report a base depth and no top, so they are lines rather than
  // intervals — a band would have to invent the top.
  await expect(chart.locator(".sw-dvd-trouble")).toHaveCount(9);
  await expect(chart.locator(".sw-dvd-trouble[data-top-reported='false']")).toHaveCount(5);

  // Pinning a depth anywhere puts the cursor on the chart: this was the only view on the drill
  // stage's own axis that could not follow a depth at all.
  await expect(chart.locator(".sw-dvd-depth-cursor")).toHaveCount(0);
  await page.getByRole("spinbutton", { name: "Go to MD" }).fill("1500");
  await page.getByRole("button", { name: "Locate depth" }).click();
  await expect(chart.locator(".sw-dvd-depth-cursor")).toHaveCount(1);
  await expect(chart.locator(".sw-dvd-depth-cursor")).toHaveAttribute("data-cursor-ft", "4921.3");

  // And the mud log, in the same drawer, draws its own cursor from the same shared depth — one
  // store value, two views, two units.
  const file = page.getByTestId("well-file");
  await file.getByRole("tab", { name: "Mud log" }).click();
  await expect(file.getByTestId("log-tracks").locator(".sw-logs-cursor")).toHaveCount(1);
});

test("the well section puts construction, log and survey on one depth axis in one viewport", async ({ page }) => {
  await gotoApp(page, "/view-well/");
  await selectWellView(page, "section", ["wellsection"]);
  const section = page.getByTestId("well-section");
  await expect(section).toBeVisible();
  for (const testId of ["assembly-schematic", "log-tracks", "trajectory-log"]) await expect(section.getByTestId(testId)).toBeAttached();

  // No scrolling to see linked things: the section sits inside the viewport, and so does the
  // depth command line under it.
  const box = (await section.boundingBox())!;
  expect(box.y).toBeGreaterThan(0);
  expect(box.y + box.height).toBeLessThanOrEqual(1000);

  // Pin a depth; every track draws its cursor at the same pixel row. Within a pixel, because the
  // three components compute the mapping independently and the test is that they agree.
  await page.getByRole("spinbutton", { name: "Go to MD" }).fill("1558");
  await page.getByRole("button", { name: "Locate depth" }).click();
  const rows = await Promise.all([
    section.locator(".demo-ruler-cursor line"),
    section.locator(".sw-logs-cursor"),
    section.locator("[data-testid='traj-cursor'] line").first(),
  ].map(async (locator) => { await expect(locator).toBeAttached(); return (await locator.boundingBox())!.y; }));
  for (const row of rows) expect(Math.abs(row - rows[0]!)).toBeLessThanOrEqual(1);
  await expect(section.locator(".demo-ruler-cursor")).toHaveAttribute("data-cursor-md", "1558");

  // And the selection reached the record the depth falls in, with no second click anywhere.
  await expect(page.getByTestId("demo-record")).toHaveAttribute("data-component-id", "intermediate-hole");
});

test("the trajectory route opens on the same spine as View well, with the planner's survey as a track", async ({ page }) => {
  await gotoApp(page, "/trajectory/");
  const section = page.getByTestId("well-section");
  await expect(section).toBeVisible();
  await expect(section.getByTestId("assembly-schematic")).toBeAttached();
  await expect(section.getByTestId("trajectory-log")).toBeAttached();
  // The survey opens with the station editor docked under the section, so an edit and its effect
  // share a screen.
  await expect(page.getByTestId("survey-table")).toBeVisible();
  const box = (await section.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(1000);

  // Editing a station redraws the survey track above it; the construction stays put beside it.
  const before = await section.getByTestId("trajectory-log").locator("polyline").first().getAttribute("points");
  await page.getByRole("button", { name: "Edit these stations", exact: true }).click();
  const inclination = page.getByLabel("Station 15 inclination");
  await inclination.fill("30");
  await inclination.press("Enter");
  await expect.poll(async () => section.getByTestId("trajectory-log").locator("polyline").first().getAttribute("points")).not.toBe(before);
  await expect(section.getByTestId("assembly-schematic")).toBeAttached();
});
