import { expect, test } from "@playwright/test";

test("shared selection is encoded in the URL and survives reload without losing host query/hash", async ({ page }) => {
  await page.goto("/view-well/?theme=dark#inspect");
  // The drawing is server-rendered before hydration attaches its handlers, so wait for
  // it to become interactive before selecting.
  await expect(page.getByTestId("curved-assembly-schematic")).toBeVisible();
  // The default curved drawing draws each tubular as two fill-less paths, so a
  // bounding-box-centre click falls through to the cement behind it. Select with the
  // keyboard, which the curved schematic supports directly.
  await page.locator('[data-item-id="production-casing"]').press("Enter");
  await expect.poll(() => new URL(page.url()).searchParams.get("sw.component")).toBe("production-casing");
  let url = new URL(page.url());
  expect(url.searchParams.get("theme")).toBe("dark");
  expect(url.hash).toBe("#inspect");
  await page.reload();
  await expect(page.getByTestId("demo-record")).toHaveAttribute("data-component-id", "production-casing");
  await page.getByRole("combobox", { name: "View", exact: true }).selectOption("split");
  await expect(page.getByTestId("assembly-scene")).toHaveAttribute("data-selected", "production-casing");
  await page.getByRole("combobox", { name: "Well", exact: true }).selectOption("s-profile");
  await expect.poll(() => new URL(page.url()).searchParams.get("sw.well")).toBe("synthetic-s-profile-01");
  url = new URL(page.url());
  expect(url.searchParams.has("sw.component")).toBe(false);
  expect(url.searchParams.get("theme")).toBe("dark");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Well", exact: true })).toHaveValue("s-profile");
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await expect(page.getByTestId("component-inventory-total")).toHaveText("746 records");
});

test("shared link hydrates pinned MD and window; hovering does not write transient depth to the URL", async ({ page }) => {
  await page.goto("/view-well/?sw.v=1&sw.well=forge&sw.md=1500&sw.window=500,2500&sw.component=production-casing");
  await page.getByRole("button", { name: "Schematic", exact: true }).click();
  await expect(page.getByTestId("demo-record")).toHaveAttribute("data-component-id", "production-casing");
  const cursor = page.getByTestId("assembly-cursor");
  await expect(cursor).toHaveCount(1);
  const schematic = page.getByTestId("assembly-schematic");
  await expect(page.getByRole("region", { name: "Construction schematic" }).locator("header small")).toHaveText("500 m – 2,500 m MD");
  const url = page.url();
  const frame = schematic;
  const bounds = (await frame.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.65);
  await page.waitForTimeout(250);
  expect(page.url()).toBe(url);
  await page.getByRole("button", { name: "Depth views linked" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("sw.linked")).toBe("0");
  expect(new URL(page.url()).searchParams.get("sw.md")).toBe("1500");
});

test("invalid and unknown asset links show explicit errors without replacing the current well", async ({ page }) => {
  await page.goto("/view-well/?sw.v=1&sw.well=missing");
  await expect(page.getByRole("alert").filter({ hasText: "shared view link" })).toContainText("Unknown linked well");
  await expect(page.getByRole("combobox", { name: "Well", exact: true })).toHaveValue("forge");
  await page.goto("/view-well/?sw.v=1&sw.well=forge&sw.component=missing");
  await expect(page.getByRole("alert").filter({ hasText: "shared view link" })).toContainText("Unknown linked component");
  await page.goto("/view-well/?sw.v=1&sw.well=forge&sw.logCurve=missing&sw.logMode=color&sw.logDomain=0,1&sw.logRadius=1,2");
  await expect(page.getByRole("alert").filter({ hasText: "shared view link" })).toContainText("Unknown linked log");
  await expect(page.getByRole("combobox", { name: "Well", exact: true })).toHaveValue("forge");
  await page.goto("/view-well/?sw.v=1&sw.well=forge&sw.md=-5");
  await expect(page.getByRole("alert").filter({ hasText: "shared view link" })).toContainText("non-negative");
  await expect(page.getByTestId("curved-assembly-schematic").locator("[data-item-id]")).toHaveCount(7);
  await page.goto("/view-well/?theme=dark&sw.v=1&sw.retired=1");
  await expect(page.getByRole("alert").filter({ hasText: "shared view link" })).toContainText("Unknown state URL parameter");
  await page.getByRole("combobox", { name: "Well", exact: true }).selectOption("s-profile");
  await expect.poll(() => new URL(page.url()).searchParams.has("sw.retired")).toBe(false);
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "shared view link" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Well", exact: true })).toHaveValue("s-profile");
});

test("popstate restores a shared snapshot and legacy well links", async ({ page }) => {
  await page.goto("/view-well/?well=s-profile&theme=dark");
  await expect(page.getByRole("combobox", { name: "Well", exact: true })).toHaveValue("s-profile");
  await page.evaluate(() => {
    window.history.pushState(window.history.state, "", "/view-well/?sw.v=1&sw.well=forge&sw.component=production-casing");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByRole("combobox", { name: "Well", exact: true })).toHaveValue("forge");
  await expect(page.getByTestId("demo-record")).toHaveAttribute("data-component-id", "production-casing");
  await page.goBack();
  await expect(page.getByRole("combobox", { name: "Well", exact: true })).toHaveValue("s-profile");
});

test("well-scene camera hydrates in metre coordinates and camera input updates the shared link", async ({ page }) => {
  await page.goto("/view-well/?sw.v=1&sw.well=forge&sw.camera=1000,1000,-1000&sw.target=0,0,1300&sw.zoom=1");
  await page.getByRole("combobox", { name: "View", exact: true }).selectOption("earth");
  const scene = page.getByTestId("interactive-well-scene");
  await expect(scene).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  await expect(scene).toHaveAttribute("data-camera", /^10\.000,10\.000,-10\.000,/);
  await expect(scene).toHaveAttribute("data-target", "0.000,-13.000,0.000");
  await page.getByRole("button", { name: "Fit 3D well", exact: true }).first().click();
  await expect.poll(() => new URL(page.url()).searchParams.get("sw.camera")).not.toBe("1000,1000,-1000");
  await expect(scene).toHaveAttribute("data-ready", "true");
  // The volume tools only exist once the seismic cube has loaded, which the camera assertions above
  // do not need. Opening them here rather than straight after the view switch keeps the camera half
  // of this test independent of a multi-megabyte asset finishing first.
  const volumeOptions = page.locator(".demo-scene-options > summary");
  await expect(volumeOptions).toBeVisible({ timeout: 60_000 });
  await volumeOptions.click();
  const controls = page.getByRole("group", { name: "Cut the volume" });
  const slider = controls.locator("label", { hasText: "Across well" }).locator("input");
  await expect(slider).toBeVisible({ timeout: 20_000 });
  await slider.fill("50");
  await expect.poll(() => new URL(page.url()).searchParams.get("sw.crossline")).not.toBeNull();
  await expect(scene).toHaveAttribute("data-ready", "true");
});
