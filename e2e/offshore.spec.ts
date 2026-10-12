import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoApp } from "./support/app";

test("continuous offshore scene selects multiple wells and descends to their seabed location", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await gotoApp(page, "/map/");
  await page.getByRole("combobox", { name: "Spatial view" }).selectOption("3d");
  const scene = page.getByTestId("offshore-scene");
  await expect(scene).toHaveAttribute("data-ready", "true");
  await expect(scene.getByRole("button", { name: /^Equator / })).toHaveCount(4);
  await scene.getByRole("button", { name: "Equator B" }).click();
  await expect(scene).toHaveAttribute("data-selected-well", "offshore-2");
  const details = page.getByTestId("offshore-details");
  await expect(details).toContainText("980 m below sea surface");
  await expect(details).toContainText("EPSG:32650");
  await expect.poll(async () => Number((await scene.getAttribute("data-camera"))!.split(",")[1])).toBeLessThan(0);
  const beforeOrbit = await scene.getAttribute("data-camera");
  await scene.getByRole("button", { name: "Orbit left" }).click();
  await expect(scene).not.toHaveAttribute("data-camera", beforeOrbit!);
  const underwater = await scene.getAttribute("data-camera");
  const canvas = scene.locator("canvas");
  await canvas.scrollIntoViewIfNeeded();
  const visible = await canvas.screenshot();
  await scene.getByRole("checkbox", { name: "Illustrative seabed" }).uncheck();
  expect(visible.equals(await canvas.screenshot())).toBe(false);
  await scene.getByRole("button", { name: "Equator D" }).click();
  await expect(scene).toHaveAttribute("data-selected-well", "offshore-4");
  await expect(details).toContainText("1340 m below sea surface");
  await expect.poll(() => scene.getAttribute("data-camera")).not.toBe(underwater);
  await scene.getByRole("button", { name: "Surface overview" }).click();
  await expect.poll(async () => Number((await scene.getAttribute("data-camera"))!.split(",")[1])).toBeGreaterThan(6000);
  await canvas.scrollIntoViewIfNeeded();
  // The scene publishes where it drew each wellhead, so the pick is aimed rather than swept: the
  // old 13×13 sweep over the middle of the canvas was hoping to land on an eight-pixel marker.
  await expect(scene).toHaveAttribute("data-flying", "false");
  const host = scene.locator(".sw-offshore-canvas");
  await expect(host).toHaveAttribute("data-wellheads", /offshore-1:\d+,\d+/);
  const heads = Object.fromEntries((await host.getAttribute("data-wellheads"))!.split(";").map((entry) => {
    const [id, at] = entry.split(":");
    const [x, y] = at!.split(",").map(Number);
    return [id, { x: x!, y: y! }];
  }));
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + heads["offshore-1"]!.x, box.y + heads["offshore-1"]!.y);
  await expect(scene, "Picking a rendered offshore well must select its identity").toHaveAttribute("data-selected-well", "offshore-1");
  expect(errors).toEqual([]);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.map((entry) => entry.id)).toEqual([]);
  await scene.getByRole("checkbox", { name: "Illustrative seabed" }).check();
  await scene.getByRole("button", { name: "Dive to selected well" }).click();
  await expect(scene).toHaveAttribute("data-flying", "false");
  await expect.poll(async () => Number((await scene.getAttribute("data-camera"))!.split(",")[1])).toBeLessThan(0);
  await page.screenshot({ path: "output/playwright/offshore.png", fullPage: true });
});

test("offshore scene fits a phone and supports keyboard well selection", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, "/map/");
  await page.getByRole("combobox", { name: "Spatial view" }).selectOption("3d");
  const scene = page.getByTestId("offshore-scene");
  await expect(scene).toHaveAttribute("data-ready", "true");
  await scene.getByRole("button", { name: "Equator C" }).focus();
  await page.keyboard.press("Enter");
  await expect(scene).toHaveAttribute("data-selected-well", "offshore-3");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
