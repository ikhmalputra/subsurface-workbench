import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";

const schematic = (page: Page) => page.locator(".sw-wd-canvas [data-testid='assembly-schematic']");
const tile = (page: Page, id: string) => page.locator(`.sw-asm-tile[data-catalog-id="${id}"]`);
const item = (page: Page, id: string) => schematic(page).locator(`[data-item-id="${id}"]`).first();

async function openBuilder(page: Page) {
  await page.goto("/builder/");
  await expect(page.getByTestId("curved-assembly-schematic")).toBeVisible();
  await page.getByRole("button", { name: "Schematic", exact: true }).click();
  await page.getByRole("button", { name: "Add parts", exact: true }).click();
  await expect(schematic(page)).toBeVisible();
}

test("component filter has one control surface and filters the library without overflow", async ({ page }) => {
  await openBuilder(page);
  const search = page.getByRole("textbox", { name: "Filter components", exact: true });
  const field = page.locator(".sw-asm-search");
  await page.locator(".demo-nav-secondary").filter({ hasText: "Appearance" }).locator("summary").click();
  for (const theme of ["light", "dark", "high-contrast"]) {
    await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption(theme);
    for (const density of ["comfortable", "compact"]) {
      await page.getByRole("combobox", { name: "Density", exact: true }).selectOption(density);
      await search.focus();
      const layout = await field.evaluate((label) => {
        const input = label.querySelector("input")!;
        const outer = label.getBoundingClientRect(), inner = input.getBoundingClientRect();
        return {
          border: getComputedStyle(input).borderTopWidth,
          outline: getComputedStyle(input).outlineStyle,
          ring: getComputedStyle(label).outlineStyle,
          contained: inner.left >= outer.left && inner.right <= outer.right,
          height: outer.height,
        };
      });
      expect(layout.border).toBe("0px");
      expect(layout.outline).toBe("none");
      expect(layout.ring).toBe("solid");
      expect(layout.contained).toBe(true);
      expect(layout.height).toBeGreaterThanOrEqual(density === "comfortable" ? 44 : 34);
    }
  }
  const matches = await page.locator(".sw-asm-tile").evaluateAll((tiles) => tiles
    .filter((tile) => tile.getAttribute("aria-label")?.toLowerCase().includes("casing head"))
    .map((tile) => tile.getAttribute("data-catalog-id")).sort());
  await search.fill("CASING HEAD");
  await expect(page.locator(".sw-asm-tile")).toHaveCount(matches.length);
  expect(await page.locator(".sw-asm-tile").evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("data-catalog-id")).sort())).toEqual(matches);
  await search.fill("no-such-component");
  await expect(page.locator(".sw-asm-empty")).toContainText("No component matches");
  await search.fill("");
  await expect(page.locator(".sw-asm-tile")).toHaveCount(55);
  await page.setViewportSize({ width: 390, height: 844 });
  const contained = await field.evaluate((label) => {
    const input = label.querySelector("input")!.getBoundingClientRect();
    const outer = label.getBoundingClientRect();
    return input.right <= outer.right && outer.right <= innerWidth;
  });
  expect(contained).toBe(true);
});

async function selectDesignStep(workflow: Locator, name: string) {
  const phase = ({
    "Location & datum": "Define",
    "Offset wells": "Define",
    "Geology & pressure": "Plan",
    Trajectory: "Plan",
    Casing: "Design",
    Cement: "Design",
    Completion: "Design",
    Assemble: "Schematic",
  } as Record<string, string>)[name] ?? name;
  await workflow.locator(".sw-wd-steps button", { hasText: phase }).click();
  if (phase !== name && phase !== "Schematic") await workflow.locator(".sw-wd-substeps button", { hasText: name }).click();
}

async function dropAt(page: Page, catalogId: string, target: Locator, fraction: number) {
  await page.getByRole("button", { name: "Add parts", exact: true }).click();
  const box = (await target.boundingBox())!;
  await tile(page, catalogId).dragTo(target, { targetPosition: { x: box.width * 0.34, y: box.height * fraction } });
}

test("open directly to the well schematic and start a new design", async ({ page }) => {
  await page.goto("/builder/");
  const workflow = page.getByTestId("well-design-workflow");
  await expect(workflow.getByTestId("curved-assembly-schematic")).toBeVisible();
  await expect(workflow.locator(".sw-wd-title small")).toContainText("EXAMPLE WELL");
  await expect(workflow.locator(".sw-wd-steps button[aria-current='step']")).toContainText("Schematic");
  await expect(workflow.getByTestId("design-readiness")).toContainText("100% data");
  await expect(workflow.getByRole("button", { name: "New design" })).toBeVisible();
  await expect(workflow.getByRole("button", { name: "Rebuild schematic" })).toBeVisible();
  const canvas = await workflow.locator(".sw-wd-canvas").boundingBox();
  const tools = await workflow.locator(".sw-wd-tools").boundingBox();
  expect(canvas).not.toBeNull();
  expect(tools).not.toBeNull();
  expect(tools!.x).toBeGreaterThan(canvas!.x);
  await expect(workflow.getByTestId("curved-assembly-schematic")).toBeVisible();
  await page.screenshot({ path: "output/playwright/well-schematic-start.png" });
  const results = await new AxeBuilder({ page }).include(".sw-wd").analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  await workflow.getByRole("button", { name: "New design" }).click();
  await expect(workflow.getByTestId("design-readiness")).not.toContainText("100%");
  await expect(workflow.getByTestId("curved-assembly-schematic")).toBeVisible();
  await expect(workflow.locator(".sw-wd-steps button")).toHaveCount(5);
  await expect(workflow.locator(".sw-wd-steps button[aria-current='step']")).toContainText("Define");
  await expect(workflow.locator(".sw-wd-tools").getByRole("textbox", { name: /^Well name/ })).toHaveValue("");
  await workflow.getByRole("button", { name: "Example well" }).click();
  await expect(workflow.getByTestId("curved-assembly-schematic")).toBeVisible();
});

test("edit existing component properties, keep edits across phases, undo and export", async ({ page }) => {
  await openBuilder(page);
  const workflow = page.getByTestId("well-design-workflow");
  await workflow.getByRole("button", { name: "Edit properties", exact: true }).click();
  const selector = workflow.getByRole("combobox", { name: "Component to edit" });
  await expect(selector).toBeFocused();
  await selector.selectOption("production-casing-1");
  const inspector = page.getByTestId("assembly-inspector");
  const label = inspector.getByLabel("Label", { exact: true });
  const original = await label.inputValue();
  const od = inspector.getByLabel("OD (in)", { exact: true });
  const originalOd = await od.inputValue();
  const schematicBox = await schematic(page).boundingBox();
  const inspectorBox = await inspector.boundingBox();
  expect(schematicBox).not.toBeNull();
  expect(inspectorBox).not.toBeNull();
  expect(inspectorBox!.x).toBeGreaterThan(schematicBox!.x);
  expect(inspectorBox!.y).toBeLessThan(schematicBox!.y + 180);

  await od.fill("-1");
  await inspector.getByRole("button", { name: "Apply changes" }).click();
  await expect(inspector.getByRole("alert")).toContainText("non-negative");
  await od.fill(originalOd);
  await label.fill("Edited production string");
  await inspector.getByRole("button", { name: "Apply changes" }).click();
  await expect(item(page, "production-casing-1")).toHaveAttribute("aria-label", /Edited production string/);
  await expect(inspector.getByRole("alert")).toHaveCount(0);
  await page.screenshot({ path: "output/playwright/builder-edit-properties.png" });

  await selectDesignStep(workflow, "Review");
  await selectDesignStep(workflow, "Assemble");
  await expect(label).toHaveValue("Edited production string");
  await selectDesignStep(workflow, "Geology & pressure");
  await page.getByLabel("Pore pressure at 2620 m (SG)").fill("1.62");
  await page.getByLabel("Pore pressure at 2620 m (SG)").press("Enter");
  await selectDesignStep(workflow, "Assemble");
  await expect(workflow.getByRole("button", { name: "Rebuild from design" })).toBeVisible();
  await expect(label).toHaveValue("Edited production string");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(label).toHaveValue(original);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(label).toHaveValue("Edited production string");

  const pendingDownload = page.waitForEvent("download");
  await workflow.locator(".sw-asm-draft-tools summary").click();
  await workflow.getByRole("button", { name: "Export JSON" }).click();
  const download = await pendingDownload;
  const path = await download.path();
  if (!path) throw new Error("Assembly export did not produce a downloaded file.");
  expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ id: "production-casing-1", label: "Edited production string" })]) });

  page.once("dialog", (dialog) => dialog.dismiss());
  await workflow.getByRole("button", { name: "Rebuild schematic" }).click();
  await expect(label).toHaveValue("Edited production string");
  page.once("dialog", (dialog) => dialog.accept());
  await workflow.getByRole("button", { name: "Rebuild schematic" }).click();
  await workflow.getByRole("combobox", { name: "Component to edit" }).selectOption("production-casing-1");
  await expect(label).toHaveValue(original);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("assemble a blank well by dragging Blender-rendered components onto the schematic and the 3D view", async ({ page }) => {
  await openBuilder(page);
  await expect(page.locator(".sw-asm-tile")).toHaveCount(55);
  await expect(page.locator(".sw-asm-tile img").first()).toHaveJSProperty("complete", true);
  await page.locator(".sw-asm-draft-tools summary").click();
  await page.getByRole("button", { name: "Blank well" }).click();
  await expect(page.getByTestId("assembly-revision")).toContainText("0 parts");

  await page.getByRole("button", { name: "Add Casing head (A-section)" }).click();
  await expect(page.getByTestId("assembly-inspector")).toContainText("Casing head");

  await dropAt(page, "conductor", schematic(page), 0.25);
  await expect(item(page, "conductor-1")).toBeVisible();
  await dropAt(page, "surface-casing", schematic(page), 0.5);
  await expect(item(page, "surface-casing-1")).toBeVisible();
  await expect(page.getByTestId("assembly-inspector")).toContainText("Surface casing");

  await dropAt(page, "packer", schematic(page), 0.4);
  await expect(page.getByTestId("assembly-status")).toHaveClass(/is-error/);
  await expect(page.getByTestId("assembly-status")).toContainText(/tubing/i);
  await expect(schematic(page).locator('[data-item-id^="packer"]')).toHaveCount(0);

  await page.getByRole("button", { name: "3D view", exact: true }).click();
  const scene = page.getByTestId("assembly-scene");
  await expect(scene).toHaveAttribute("data-ready", "true");
  await dropAt(page, "cement", scene, 0.6);
  await expect(page.getByTestId("assembly-status")).toContainText("above its shoe");
  await dropAt(page, "cement", scene, 0.3);
  await expect(page.getByTestId("assembly-status")).toContainText(/Cemented Surface casing from \d+ m to the shoe/);
  await expect(scene).toHaveAttribute("data-item-count", "4");
  await page.getByRole("button", { name: "Schematic", exact: true }).click();
  await expect(item(page, "cement-1")).toBeVisible();

  await item(page, "surface-casing-1").focus();
  await page.keyboard.press("Enter");
  const bottom = page.getByLabel("Bottom MD (m)");
  const before = Number(await bottom.inputValue());
  await item(page, "surface-casing-1").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(bottom).toHaveValue(String(before + 10));

  await bottom.fill("640");
  await page.getByRole("button", { name: "Apply changes" }).click();
  await expect(item(page, "surface-casing-1")).toHaveAttribute("aria-label", /shoe 640 m/);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(item(page, "surface-casing-1")).toHaveAttribute("aria-label", new RegExp(`shoe ${(before + 10).toLocaleString("en-US")} m`));
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(item(page, "surface-casing-1")).toHaveAttribute("aria-label", /shoe 640 m/);
  await page.screenshot({ path: "output/playwright/builder-assembled.png" });

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test("example well loads every Blender model, moves a shoe by pointer drag and picks parts in 3D", async ({ page }) => {
  await openBuilder(page);
  await page.locator(".sw-asm-draft-tools summary").click();
  await page.getByRole("button", { name: "Example", exact: true }).click();
  await page.getByRole("button", { name: "3D view", exact: true }).click();
  const scene = page.getByTestId("assembly-scene");
  await expect(scene).toHaveAttribute("data-models-loaded", "10", { timeout: 20_000 });
  await page.getByRole("button", { name: "Schematic", exact: true }).click();

  const casing = item(page, "intermediate-casing-1");
  const label = await casing.getAttribute("aria-label");
  const wall = casing.locator(".sw-asm-wall").first();
  await wall.scrollIntoViewIfNeeded();
  const box = (await wall.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height - 6;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 30, { steps: 5 });
  await expect(page.getByTestId("assembly-drop-preview")).toBeVisible();
  await page.mouse.move(x, y + 60, { steps: 5 });
  await page.mouse.up();
  await expect(casing).not.toHaveAttribute("aria-label", label!);
  await expect(page.getByTestId("assembly-revision")).toContainText("Rev 2");

  await page.getByRole("button", { name: "3D view", exact: true }).click();
  await page.getByRole("button", { name: "Blank well" }).click();
  await page.getByRole("button", { name: "Example", exact: true }).click();
  await expect(scene).toHaveAttribute("data-models-loaded", /\d+/);
  await scene.scrollIntoViewIfNeeded();
  const canvas = (await scene.boundingBox())!;
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height * 0.45);
  await expect(page.getByTestId("assembly-inspector")).toBeVisible();
  await page.getByRole("button", { name: "Focus selected component" }).click();
  await expect(scene).not.toHaveAttribute("data-camera", "");
  await page.screenshot({ path: "output/playwright/builder-3d-pick.png" });
});

test("design a well from data: propose casing from pressures, inspect loads, then assemble the engineered design", async ({ page }) => {
  await page.goto("/builder/");
  await page.getByRole("button", { name: "Schematic", exact: true }).click();
  const workflow = page.getByTestId("well-design-workflow");
  await expect(workflow.getByTestId("design-readiness")).toContainText("100% data · no errors");
  const step = (name: string) => selectDesignStep(workflow, name);
  await expect(page.getByTestId("wd-readiness")).toHaveCount(0);

  await step("Geology & pressure");
  await expect(page.getByTestId("pressure-window-plot")).toBeVisible();
  await page.getByLabel("Pore pressure at 2620 m (SG)").fill("1.62");
  await page.getByLabel("Pore pressure at 2620 m (SG)").press("Enter");

  await step("Casing");
  const casing = page.getByTestId("wd-casing");
  await casing.getByRole("button", { name: "Propose from pressures" }).click();
  const rows = casing.locator("tbody tr");
  expect(await rows.count()).toBeGreaterThanOrEqual(4);
  await expect(rows.last()).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("section-load-card")).toContainText("meets every casing check");
  await rows.nth(1).getByRole("button", { name: /^Select / }).click();
  await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("pressure-window-plot").locator('.sw-wd-string[aria-pressed="true"]')).toHaveCount(1);

  await step("Cement");
  await expect(page.getByTestId("wd-cement")).toContainText("Total slurry");
  expect(await page.getByTestId("pressure-window-plot").locator(".sw-wd-ecd").count()).toBeGreaterThanOrEqual(3);
  await step("Completion");
  await expect(schematic(page)).toBeVisible();
  await step("Review");
  await expect(page.getByTestId("wd-programme")).toContainText("Total slurry");
  await expect(page.getByTestId("wd-readiness")).toContainText("Ready to assemble");

  await step("Assemble");
  await expect(workflow.getByRole("status").filter({ hasText: "Design inputs have changed" })).toBeVisible();
  await workflow.getByRole("button", { name: "Rebuild from design" }).click();
  await page.getByRole("button", { name: "Schematic", exact: true }).click();
  await expect(page.getByTestId("assembly-revision")).toContainText("no errors");
  await expect(schematic(page).locator('[data-item-id^="production-casing"]').first()).toBeVisible();
  const boxes = await schematic(page).locator(".sw-asm-label-title, .sw-asm-stack-label tspan").evaluateAll((nodes) => nodes.map((node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, text: node.textContent }; }));
  expect(boxes.length).toBeGreaterThan(10);
  const overlaps = boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1).map((b) => `${a.text} × ${b.text}`));
  expect(overlaps).toEqual([]);
  await page.screenshot({ path: "output/playwright/well-design-assembled.png" });

  await workflow.getByRole("button", { name: "New design" }).click();
  await expect(workflow.getByTestId("design-readiness")).not.toContainText("100%");
  await step("Assemble");
  await expect(page.getByTestId("assembly-revision")).toBeVisible();

  await workflow.getByRole("button", { name: "Example well" }).click();
  await step("Casing");
  const results = await new AxeBuilder({ page }).include(".sw-wd").analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ") + " " + node.failureSummary).join(" | ")}`)).toEqual([]);
});

test("offset wells: rank FORGE, start a pad well beside it, adopt its design and re-check it", async ({ page }) => {
  await page.goto("/builder/");
  const workflow = page.getByTestId("well-design-workflow");
  await selectDesignStep(workflow, "Offset wells");
  const library = page.getByTestId("offset-library");
  const forge = library.locator(".sw-ow-list button", { hasText: "16A(78)-32" });
  await expect(forge).toHaveAttribute("data-verdict", "poor");
  await expect(page.getByTestId("offset-detail")).toContainText("FIT 9.5 ppg");
  await expect(page.getByTestId("offset-overlay")).toBeVisible();

  await library.getByRole("button", { name: "Start new well beside it" }).click();
  await expect(forge).toHaveAttribute("data-verdict", "strong");
  await library.getByRole("button", { name: "Adopt full design" }).click();
  const result = page.getByTestId("adoption-result");
  await expect(result).toContainText("Adopted full design");
  await expect(result.locator(".sw-ow-changes li").first()).toBeVisible();
  await expect(result).toContainText("Every string passes");

  await selectDesignStep(workflow, "Casing");
  await expect(page.getByTestId("kick-tolerance")).toBeVisible();
  await expect(page.getByTestId("effective-ratings")).toContainText("yield at");
  await selectDesignStep(workflow, "Review");
  await expect(page.getByTestId("wd-coverage")).toContainText("Not checked");

  await selectDesignStep(workflow, "Offset wells");
  await library.getByRole("button", { name: "Save this design" }).click();
  await expect(library.locator(".sw-ow-list li")).toHaveCount(2);
  const storedLibrary = await page.evaluate(() => JSON.parse(localStorage.getItem("subsurface-demo-wells") ?? "null"));
  expect(storedLibrary).toMatchObject({ version: 1, offsets: [expect.objectContaining({ id: expect.any(String), brief: expect.any(Object) })] });
  await page.reload();
  await selectDesignStep(workflow, "Offset wells");
  await expect(library.locator(".sw-ow-list li")).toHaveCount(2);
  await page.screenshot({ path: "output/playwright/offset-wells.png", fullPage: true });
  const results = await new AxeBuilder({ page }).include(".sw-wd").analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ") + " " + node.failureSummary).join(" | ")}`)).toEqual([]);
});

test("corrupt saved offset data is reported and does not break the builder", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("subsurface-demo-wells", JSON.stringify([null])));
  await page.goto("/builder/");
  await expect(page.getByTestId("curved-assembly-schematic")).toBeVisible();
  await expect(page.getByTestId("well-library-error")).toContainText("could not be loaded");
  await expect(page.getByTestId("well-library-error")).toContainText("legacyOffsets[0] must be an object");
  const workflow = page.getByTestId("well-design-workflow");
  await selectDesignStep(workflow, "Offset wells");
  await expect(page.getByTestId("offset-library").locator(".sw-ow-list li")).toHaveCount(1);
});

test("blocked local storage access is reported while the in-memory builder remains usable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { throw new DOMException("Storage is disabled", "SecurityError"); },
    });
  });
  await page.goto("/builder/");
  await expect(page.getByTestId("well-library-error")).toContainText("could not be loaded");
  await expect(page.getByTestId("well-library-error")).toContainText("Storage is disabled");
  await expect(page.getByTestId("curved-assembly-schematic")).toBeVisible();
  await page.getByRole("button", { name: "New design" }).click();
  await expect(page.locator(".sw-wd-tools").getByRole("textbox", { name: /^Well name/ })).toBeVisible();
});

test("a blocked library write is reported and is not shown as durably saved", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "subsurface-demo-wells") throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  await page.goto("/builder/");
  const workflow = page.getByTestId("well-design-workflow");
  await selectDesignStep(workflow, "Offset wells");
  const library = page.getByTestId("offset-library");
  await library.getByRole("button", { name: "Save this design" }).click();
  await expect(page.getByTestId("well-library-error")).toContainText("could not be updated");
  await expect(page.getByTestId("well-library-error")).toContainText("Storage quota exceeded");
  await expect(library.locator(".sw-ow-list li")).toHaveCount(1);
});
