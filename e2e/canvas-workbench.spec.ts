import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoApp, openNavigation } from "./support/app";

for (const route of ["/view-well/?well=s-profile", "/edit-well/?well=s-profile", "/builder/"]) {
  test(`${route} opens with a dominant curved canvas and immediate view controls`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await gotoApp(page, route);
    const modes = page.getByRole("group", { name: "Canvas view", exact: true });
    if (route.startsWith("/view")) {
      // View well opens on the well section; the curved drawing this test measures is a mode of it.
      await expect(page.getByTestId("well-section")).toBeVisible();
      await expect(modes.getByRole("button", { name: "Section", exact: true })).toHaveAttribute("aria-pressed", "true");
      await modes.getByRole("button", { name: "Curved", exact: true }).click();
    }
    const canvas = page.getByTestId("curved-assembly-schematic");
    await expect(canvas).toBeVisible();
    await expect(modes.getByRole("button", { name: "Curved", exact: true })).toHaveAttribute("aria-pressed", "true");
    const dock = page.locator(route.startsWith("/view") ? "#well-inspector" : route.startsWith("/edit") ? ".demo-edit-tool-panel" : ".sw-wd-tools");
    const drawing = (await canvas.boundingBox())!, tools = (await dock.boundingBox())!;
    expect(drawing.y).toBeLessThan(360);
    expect(drawing.height).toBeGreaterThan(400);
    expect(drawing.width).toBeGreaterThan(tools.width * 1.8);
    expect(drawing.x + drawing.width).toBeLessThanOrEqual(tools.x);
    if (route === "/builder/") {
      const usage = await page.locator(".demo-workbench-usage > summary").boundingBox();
      expect(usage!.y).toBeGreaterThan(drawing.y + drawing.height);
    }
    await modes.getByRole("button", { name: "Schematic", exact: true }).click();
    await expect(page.locator(".sw-wd-canvas [data-testid='assembly-schematic'], .demo-edit-canvas [data-testid='assembly-schematic'], .demo-view-grid [data-testid='assembly-schematic']")).toBeVisible();
    await modes.getByRole("button", { name: "Curved", exact: true }).click();
    await expect(canvas).toBeVisible();
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations.map((issue) => ({ id: issue.id, nodes: issue.nodes.map((node) => node.target) }))).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(canvas).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(errors).toEqual([]);
  });
}

test("editing tools never replace or remount the canvas and changes reach both drawing modes", async ({ page }) => {
  await gotoApp(page, "/edit-well/?well=s-profile");
  const curved = page.getByTestId("curved-assembly-schematic");
  await curved.evaluate((element) => element.setAttribute("data-mount-check", "same-canvas"));
  const tabs = page.getByRole("tablist", { name: "Well editor" });
  for (const tab of ["Well properties", "Trajectory", "Component records", "Formations", "Records & data", "Construction"]) {
    await tabs.getByRole("tab", { name: tab, exact: true }).click();
    await expect(curved).toHaveAttribute("data-mount-check", "same-canvas");
  }
  const id = await curved.locator("[data-item-id]").first().getAttribute("data-item-id");
  if (!id) throw new Error("Curved drawing has no selectable component.");
  await curved.locator(`[data-item-id="${id}"]`).focus();
  await page.keyboard.press("Enter");
  const inspector = page.getByTestId("assembly-inspector");
  const label = inspector.getByLabel("Label", { exact: true });
  const original = await label.inputValue();
  await label.fill("Canvas-driven edit");
  await inspector.getByRole("button", { name: "Apply changes" }).click();
  await expect(curved.locator(`[data-item-id="${id}"]`)).toHaveAttribute("aria-label", /Canvas-driven edit/);
  await page.getByRole("button", { name: "Schematic", exact: true }).click();
  await expect(page.getByTestId("assembly-schematic").locator(`[data-item-id="${id}"]`).first()).toHaveAttribute("aria-label", /Canvas-driven edit/);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(label).toHaveValue(original);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of ["Well properties", "Trajectory", "Component records", "Formations", "Records & data"]) {
    await tabs.getByRole("tab", { name: tab, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
});

test("curved canvas accepts native palette drops and wall picks reveal editing tools", async ({ page }) => {
  await gotoApp(page, "/builder/");
  const workflow = page.getByTestId("well-design-workflow");
  const canvas = workflow.getByTestId("curved-assembly-schematic");
  await workflow.locator(".sw-asm-draft-tools summary").click();
  await workflow.getByRole("button", { name: "Blank well", exact: true }).click();
  await workflow.getByRole("button", { name: "Add parts", exact: true }).click();
  const target = await canvas.locator(".sw-curved-centerline").evaluate((element) => {
    const path = element as SVGPathElement;
    const point = path.getPointAtLength(path.getTotalLength() * 0.6);
    const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
    const svg = path.ownerSVGElement!.getBoundingClientRect();
    return { x: screen.x - svg.x, y: screen.y - svg.y };
  });

  await workflow.locator('.sw-asm-tile[data-catalog-id="surface-casing"]').dragTo(canvas, { targetPosition: target });
  const component = canvas.locator('[data-item-id="surface-casing-1"]');
  await expect(component).toBeVisible();
  const bottom = workflow.getByTestId("assembly-inspector").getByLabel("Bottom MD (m)", { exact: true });
  const before = Number(await bottom.inputValue());
  expect(before).toBeGreaterThan(0);
  await component.focus();
  await page.keyboard.press("ArrowDown");
  await expect(bottom).toHaveValue(String(before + 5));
  await workflow.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(bottom).toHaveValue(String(before));
  await workflow.getByRole("combobox", { name: "Component to edit", exact: true }).selectOption("");
  await workflow.getByRole("button", { name: "Zoom in Curved well construction", exact: true }).click();
  await workflow.locator(".sw-wd-steps button").filter({ hasText: "Plan" }).click();
  await expect(bottom).toBeHidden();
  const point = await component.locator(".sw-curved-wall").first().evaluate((element) => {
    const path = element as SVGPathElement;
    const point = path.getPointAtLength(path.getTotalLength() * 0.55);
    const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.click(point.x, point.y);
  await expect(bottom).toBeVisible();
  await expect(component).toHaveAttribute("aria-pressed", "true");
});

for (const width of [1440, 1024, 768, 390]) {
    test(`design dock controls remain unobstructed at ${width}px across all tools`, async ({ page }) => {
      test.setTimeout(90000);
      await page.setViewportSize({ width, height: 1000 });
      await gotoApp(page, "/builder/");
      const dock = page.getByRole("complementary", { name: "Well design tools", exact: true });
      const content = page.getByRole("region", { name: "Active design tools", exact: true });
      const canvas = page.getByTestId("curved-assembly-schematic");
      await expect(canvas).toBeVisible();
      await canvas.evaluate((element) => element.setAttribute("data-layout-check", "persistent"));
      for (const [phase, step] of [
        ["Define", "Identity"], ["Define", "Location & datum"], ["Define", "Offset wells"],
        ["Plan", "Geology & pressure"], ["Plan", "Trajectory"],
        ["Design", "Casing"], ["Design", "Cement"], ["Design", "Completion"], ["Review", ""],
      ]) {
        await dock.locator(".sw-wd-steps button").filter({ hasText: phase }).click();
        if (step) await dock.locator(".sw-wd-substeps button").filter({ hasText: step }).click();
        if (width > 900) await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBe(0);
        await expect(canvas).toHaveAttribute("data-layout-check", "persistent");
        expect(await page.evaluate(() => document.documentElement.scrollWidth), step).toBeLessThanOrEqual(width);
        const geometry = await content.evaluate((element) => {
          const navigation = element.previousElementSibling!.getBoundingClientRect();
          const rect = element.getBoundingClientRect();
          return { navigationBottom: navigation.bottom, contentTop: rect.top, width: rect.width, scrollWidth: element.scrollWidth };
        });
        expect(geometry.contentTop, step).toBeGreaterThanOrEqual(geometry.navigationBottom);
        expect(geometry.scrollWidth, step).toBeLessThanOrEqual(Math.ceil(geometry.width));
        const controls = content.locator(".sw-wd-main").getByRole("button").filter({ visible: true });
        for (const control of [controls.first(), controls.last()]) {
          await control.scrollIntoViewIfNeeded();
          expect(await control.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return !!hit && element.contains(hit);
          }), `${width}px ${step} button must receive pointer events`).toBe(true);
        }

        if (width > 900) {
          await content.evaluate((element) => { element.scrollTop = element.scrollHeight; });
          const navigation = dock.locator(".sw-wd-tool-navigation");
          const nav = await navigation.boundingBox();
          const body = await content.boundingBox();
          expect(nav!.y + nav!.height).toBeLessThanOrEqual(body!.y);
          expect(await content.locator(".sw-wd-aside").evaluateAll((elements) => elements.every((element) => getComputedStyle(element).position === "static"))).toBe(true);
        }
      }
      await dock.locator(".sw-wd-steps button").filter({ hasText: "Schematic" }).click();
      await dock.getByRole("button", { name: "Add parts", exact: true }).click();
      await expect(dock.locator(".sw-asm-tile").first()).toBeVisible();
      expect(await dock.locator(".sw-asm-tile").evaluateAll((tiles) => tiles.every((tile) => {
        const bounds = tile.getBoundingClientRect();
        const button = tile.querySelector("button")!.getBoundingClientRect();
        return button.left >= bounds.left && button.right <= bounds.right;
      }))).toBe(true);
      await page.screenshot({ path: `output/playwright/design-dock-${width}.png`, fullPage: true });
    });
  }

test("the application frame survives navigation between routes", async ({ page }) => {
  // The frame used to be rendered inside every page and handed the route as a prop, so moving
  // between destinations replaced it. Stamping the live DOM node is the only way to tell a surviving
  // element from an identical replacement: a re-rendered node keeps the attribute, a remounted one
  // cannot, because React created it after the stamp was written.
  await gotoApp(page, "/view-well/?well=s-profile");
  // The frame's persistent parts: the workspace toolbar floating over the sheet and the status bar.
  const sidebar = page.locator('[data-float="workspace"]');
  const status = page.getByTestId("workbench-status");
  await expect(sidebar).toBeVisible();
  await sidebar.evaluate((element) => element.setAttribute("data-mount-check", "same-frame"));
  await status.evaluate((element) => element.setAttribute("data-mount-check", "same-frame"));

  // Every kind of destination: a view inside the current workspace, three other workspaces, and
  // the report. The navigation only lists the active workspace's own views, so the cross-workspace
  // moves go through the Workspaces group — which is how someone actually leaves a workspace.
  const workspaces = page.getByRole("group", { name: "Workspaces" });
  const steps = [
    { link: page.getByRole("link", { name: "3D trajectory", exact: true }), url: /tool=trajectory/ },
    { link: workspaces.getByRole("link", { name: /^Field/ }), url: /tool=field/ },
    { link: workspaces.getByRole("link", { name: /^Analysis/ }), url: /tool=study/ },
    { link: page.getByRole("link", { name: "Well report", exact: true }), url: /tool=report/ },
    { link: workspaces.getByRole("link", { name: /^Well\b/ }), url: /\/view-well\/$/ },
  ];
  for (const step of steps) {
    await openNavigation(page);
    await step.link.click();
    await expect(page).toHaveURL(step.url);
    // The frame is the same element, and the navigation inside it still tracks the active route —
    // the thing that made the frame a function of the route in the first place.
    await expect(sidebar).toHaveAttribute("data-mount-check", "same-frame");
    await expect(status).toHaveAttribute("data-mount-check", "same-frame");
    // The navigation closes on arrival; reopen it to read the highlight it carries.
    await openNavigation(page);
    await expect(step.link).toHaveAttribute("aria-current", /page|true/);
  }
  await openNavigation(page);
  await page.getByRole("link", { name: "Subsurface Workbench showcase home" }).click();
  await expect(sidebar).toHaveAttribute("data-mount-check", "same-frame");
  await expect(status).toHaveAttribute("data-mount-check", "same-frame");
});
