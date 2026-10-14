import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoApp } from "./support/app";

// Desktop-only product (Ikhmal, 2026-10-13): desktop widths.
for (const width of [1440, 1024]) {
  test(`drawing fits the canvas and zoom changes actual geometry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await gotoApp(page, "/builder/");
    const canvas = page.getByTestId("curved-assembly-schematic");
    const path = canvas.locator(".sw-curved-centerline");
    await expect(canvas).toBeVisible();
    await expect.poll(async () => {
      const drawing = await path.boundingBox(), frame = await canvas.boundingBox();
      return drawing!.height / frame!.height;
    }).toBeGreaterThan(0.8);
    const initial = (await path.boundingBox())!;
    const frame = (await canvas.boundingBox())!;
    expect(initial.x).toBeGreaterThanOrEqual(frame.x);
    expect(initial.x + initial.width).toBeLessThanOrEqual(frame.x + frame.width);
    expect(initial.y).toBeGreaterThanOrEqual(frame.y);
    expect(initial.y + initial.height).toBeLessThanOrEqual(frame.y + frame.height);
    await page.getByRole("button", { name: "Zoom in Curved well construction", exact: true }).click();
    await expect.poll(async () => (await path.boundingBox())!.height).toBeGreaterThan(initial.height * 1.25);
    const zoomed = (await path.boundingBox())!;
    const surface = (await canvas.boundingBox())!;
    await page.mouse.move(surface.x + surface.width * 0.8, surface.y + surface.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(surface.x + surface.width * 0.8 - 40, surface.y + surface.height * 0.5 + 30, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Math.abs((await path.boundingBox())!.x - zoomed.x)).toBeGreaterThan(30);
    await page.getByRole("button", { name: "Zoom out Curved well construction", exact: true }).click();
    await expect.poll(async () => (await path.boundingBox())!.height).toBeLessThan(initial.height * 1.05);
    await page.getByRole("button", { name: "Fit Curved well construction", exact: true }).click();
    await expect.poll(async () => Math.abs((await path.boundingBox())!.height - initial.height)).toBeLessThan(1);
    const modes = page.getByRole("group", { name: "Canvas view", exact: true });
    await modes.getByRole("button", { name: "Formations", exact: true }).click();
    await expect(canvas.locator("[data-formation-id]").first()).toBeVisible();
    await modes.getByRole("button", { name: "Schematic", exact: true }).click();
    await expect(page.locator(".sw-wd-canvas [data-testid='assembly-schematic'] [data-formation-id]").first()).toBeVisible();
    await modes.getByRole("button", { name: "Formations", exact: true }).click();
    await expect(page.locator(".sw-wd-canvas [data-formation-id]")).toHaveCount(0);
    await modes.getByRole("button", { name: "Curved", exact: true }).click();
    await expect(canvas.locator("[data-formation-id]")).toHaveCount(0);
    await expect(modes.getByRole("button", { name: "3D view", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `output/playwright/drawing-fit-${width}.png`, fullPage: true });
  });
}

// Desktop-only product (Ikhmal, 2026-10-13): desktop widths.
for (const width of [1440, 1024]) {
  test(`vertical schematic uses the available canvas without shrinking at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await gotoApp(page, "/builder/");
    await page.getByRole("group", { name: "Canvas view", exact: true }).getByRole("button", { name: "Schematic", exact: true }).click();
    const canvas = page.getByTestId("assembly-schematic");
    await expect.poll(() => canvas.evaluate((svg: SVGSVGElement) => {
      const box = svg.getBoundingClientRect();
      return Math.abs(svg.viewBox.baseVal.width / svg.viewBox.baseVal.height - box.width / box.height);
    })).toBeLessThan(0.01);
    const frame = (await canvas.boundingBox())!;
    const axis = canvas.locator(".sw-asm-axis");
    const depth = (await axis.boundingBox())!;
    expect(depth.height / frame.height).toBeGreaterThan(0.45);
    expect((depth.x - frame.x) / frame.width).toBeCloseTo(0.5, 2);
    const viewport = (await page.getByRole("region", { name: "Engineering schematic drawing", exact: true }).boundingBox())!;
    expect(Math.abs(depth.x - (viewport.x + viewport.width / 2))).toBeLessThan(8);
    const equipment = (await canvas.locator(".sw-asm-surface").boundingBox())!;
    expect((depth.y + depth.height - equipment.y) / frame.height).toBeGreaterThan(0.85);
    const casing = canvas.locator('[data-item-id="conductor-1"] .sw-asm-hit');
    await expect(casing).toBeVisible();
    expect((await casing.boundingBox())!.width).toBeGreaterThan(170);
    await expect(canvas.locator(".sw-asm-labels")).toContainText("OD");
    await expect(canvas.locator(".sw-asm-labels")).toContainText("ID");
    await expect(canvas.locator(".sw-asm-labels")).toContainText("Shoe");
    await expect(canvas.locator(".sw-asm-labels")).not.toContainText("…");
    const annotations = await canvas.locator(".sw-asm-label").evaluateAll((groups) => groups.map((group) => {
      const boxes = [...group.querySelectorAll("text, strong, .sw-asm-label-detail")].map((text) => text.getBoundingClientRect());
      return { top: Math.min(...boxes.map((box) => box.top)), bottom: Math.max(...boxes.map((box) => box.bottom)) };
    }));
    for (let index = 1; index < annotations.length; index++) expect(annotations[index]!.top).toBeGreaterThan(annotations[index - 1]!.bottom);
    await expect(page.locator(".sw-asm-scale-note")).toContainText("Linear MD");
    expect(depth.y).toBeGreaterThanOrEqual(frame.y);
    expect(depth.y + depth.height).toBeLessThanOrEqual(frame.y + frame.height);
    await page.getByRole("button", { name: "Zoom depth in", exact: true }).click();
    await expect(page.locator(".sw-asm-panel-head small")).not.toContainText("· TD");
    await page.getByRole("button", { name: "Fit whole well", exact: true }).click();
    await expect(page.locator(".sw-asm-panel-head small")).toContainText("· TD");
    await page.screenshot({ path: `output/playwright/vertical-fit-${width}.png`, fullPage: true });
  });
}

test("engineering overview preserves diameter ratios, component designs and selected depth detail", async ({ page }) => {
  await gotoApp(page, "/builder/");
  await page.getByRole("group", { name: "Canvas view", exact: true }).getByRole("button", { name: "Schematic", exact: true }).click();
  const canvas = page.getByTestId("assembly-schematic");
  const diameter = (id: string) => canvas.locator(`[data-item-id="${id}"] .sw-asm-wall`).evaluateAll((walls) => {
    const first = (walls[0] as SVGRectElement).x.baseVal.value;
    const last = walls.at(-1) as SVGRectElement;
    return last.x.baseVal.value + last.width.baseVal.value - first;
  });
  expect(await diameter("surface-casing-1") / await diameter("conductor-1")).toBeCloseTo(20 / 30, 5);
  await expect(canvas.locator(".sw-asm-surface image").first()).toBeVisible();
  await expect(canvas.locator("foreignObject")).toHaveCount(0);
  await expect(page.locator(".sw-asm-overview-notes")).toHaveCount(0);
  const accessibility = await new AxeBuilder({ page }).include(".sw-wd-canvas").analyze();
  expect(accessibility.violations.map((violation) => violation.id)).toEqual([]);
  const tool = canvas.locator('[data-component-kind="Safety valve"]').first();
  await expect(tool).toBeVisible();
  await expect(tool.locator(".sw-asm-flapper")).toBeVisible();
  await expect(tool.locator(".sw-asm-control-line")).toHaveAttribute("d", /^M.*V/);
  await tool.focus();
  await page.keyboard.press("Enter");
  await expect(tool).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Inspect selected depth", exact: true }).click();
  await expect(page.locator(".sw-asm-scale-note")).toContainText("Depth detail");
  await expect(tool.locator(".sw-asm-flapper")).toBeVisible();
  await expect(page.getByTestId("assembly-selection-band")).toBeVisible();
  await page.getByRole("button", { name: "Fit whole well", exact: true }).click();
  await expect(page.locator(".sw-asm-scale-note")).toContainText("Engineering overview");
});

test("downhole symbols use their real MD lengths before and after depth zoom", async ({ page }) => {
  await gotoApp(page, "/builder/");
  await page.getByRole("group", { name: "Canvas view", exact: true }).getByRole("button", { name: "Schematic", exact: true }).click();
  const canvas = page.getByTestId("assembly-schematic");
  const verify = async () => {
    const lengths = await canvas.evaluate((svg) => {
      const ticks = [...svg.querySelectorAll(".sw-asm-ruler g")].map((tick) => ({
        md: Number(tick.querySelector("text")!.textContent!.replaceAll(",", "")),
        y: (tick.querySelector("line") as SVGLineElement).y1.baseVal.value,
      }));
      const pxPerM = (ticks[1]!.y - ticks[0]!.y) / (ticks[1]!.md - ticks[0]!.md);
      return [...svg.querySelectorAll('[data-testid="component-length"]')].map((element) => {
        const symbol = element as SVGSVGElement;
        const item = element.parentElement!;
        return { top: Number(item.getAttribute("data-top-md")), bottom: Number(item.getAttribute("data-bottom-md")), height: symbol.height.baseVal.value, y: symbol.y.baseVal.value, pxPerM, firstMd: ticks[0]!.md, firstY: ticks[0]!.y };
      });
    });
    expect(lengths.length).toBeGreaterThan(10);
    for (const value of lengths) {
      expect(Math.abs(value.height - (value.bottom - value.top) * value.pxPerM)).toBeLessThan(0.001);
      expect(Math.abs(value.y - (value.firstY + (value.top - value.firstMd) * value.pxPerM))).toBeLessThan(0.01);
    }
  };
  await verify();
  await canvas.locator('[data-component-kind="Safety valve"]').focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Inspect selected depth", exact: true }).click();
  await verify();
});

for (const route of ["/builder/", "/view-well/?well=s-profile", "/edit-well/?well=s-profile"]) {
  test(`${route} lets users clear component selection in either drawing`, async ({ page }) => {
    await gotoApp(page, route);
    const modes = page.getByRole("group", { name: "Canvas view", exact: true });
    for (const mode of ["Schematic", "Curved"]) {
      await modes.getByRole("button", { name: mode, exact: true }).click();
      const canvas = page.getByTestId(mode === "Schematic" ? "assembly-schematic" : "curved-assembly-schematic");
      const item = canvas.locator("[data-item-id]").first();
      await item.focus();
      await page.keyboard.press("Enter");
      await expect(item).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("Enter");
      await expect(item).toHaveAttribute("aria-pressed", "false");
      await page.keyboard.press("Space");
      await expect(item).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("Escape");
      await expect(canvas.locator('[data-item-id][aria-pressed="true"]')).toHaveCount(0);
      await item.focus();
      await page.keyboard.press("Enter");
      await canvas.click({ position: { x: 8, y: 8 } });
      await expect(canvas.locator('[data-item-id][aria-pressed="true"]')).toHaveCount(0);
      if (mode === "Schematic") {
        const annotation = canvas.locator(".sw-asm-label").first();
        await annotation.locator(".sw-asm-label-title").click();
        await expect(annotation).toHaveAttribute("aria-pressed", "true");
        await annotation.locator(".sw-asm-label-title").click();
        await expect(annotation).toHaveAttribute("aria-pressed", "false");
        const surface = canvas.locator(".sw-asm-surface .sw-asm-item").first();
        if (await surface.count()) {
          await surface.click();
          await expect(surface).toHaveAttribute("aria-pressed", "true");
          await surface.click();
          await expect(surface).toHaveAttribute("aria-pressed", "false");
        }
        const casing = canvas.locator(".sw-asm-item:has(.sw-asm-wall)").first();
        const wall = casing.locator(".sw-asm-wall").first();
        await wall.click();
        await expect(casing).toHaveAttribute("aria-pressed", "true");
        await wall.click();
        await expect(casing).toHaveAttribute("aria-pressed", "false");
      }
    }
  });
}

for (const route of ["/edit-well/?well=s-profile", "/view-well/?well=s-profile"]) {
  test(`${route} exposes formation layers alongside its drawing modes`, async ({ page }) => {
    await gotoApp(page, route);
    const modes = page.getByRole("group", { name: "Canvas view", exact: true });
    const formations = modes.getByRole("button", { name: "Formations", exact: true });
    await formations.click();
    if (route.startsWith("/view")) {
      // View well opens on the section, whose schematic track carries the layers too.
      await expect(page.getByTestId("well-section").getByTestId("assembly-schematic").locator("[data-formation-id]").first()).toBeVisible();
      await modes.getByRole("button", { name: "Curved", exact: true }).click();
    }
    await expect(page.getByTestId("curved-assembly-schematic").locator("[data-formation-id]").first()).toBeVisible();
    await modes.getByRole("button", { name: "Schematic", exact: true }).click();
    await expect(page.getByTestId("assembly-schematic").locator("[data-formation-id]").first()).toBeVisible();
    await formations.click();
    await expect(page.locator("[data-formation-id]")).toHaveCount(0);
  });
}
