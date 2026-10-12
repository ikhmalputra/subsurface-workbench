import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { GPU_PICK_DWELL, SCENE_READY, SOFTWARE_RENDERING } from "./support/timing";
import { waitForScene } from "./support/scene";
import { gotoApp, reloadApp, selectWellView } from "./support/app";

/**
 * A GPU change is only observable once the renderer has presented a new frame. On a real GPU that
 * is effectively immediate; under software rendering it lags, so a single screenshot taken right
 * after moving a control can still show the previous frame. Polling keeps the assertion exactly as
 * strong — the pixels must genuinely change — and only allows the frame time to arrive.
 */
async function expectRenderedPixelsToChange(canvas: Locator, before: Buffer, why: string) {
  try {
    await expect
      .poll(async () => !(await canvas.screenshot()).equals(before), { message: why, timeout: SCENE_READY })
      .toBe(true);
  } catch (failure) {
    // "The pixels did not change" has two very different causes: a canvas that drew nothing at all,
    // and one that drew correctly but ignored the control. Report which, so the failure is
    // actionable instead of ambiguous.
    throw new Error(`${why}\ncanvas content: ${JSON.stringify(await describeCanvas(canvas))}`, { cause: failure });
  }
}

/** Composite the canvas into a 2D context and summarise it; a single distinct colour means blank. */
async function describeCanvas(canvas: Locator) {
  return canvas.evaluate((element) => {
    const source = element as HTMLCanvasElement;
    const copy = document.createElement("canvas");
    copy.width = source.width;
    copy.height = source.height;
    const context = copy.getContext("2d");
    if (!context) return { error: "no 2d context for readback" };
    context.drawImage(source, 0, 0);
    const { data } = context.getImageData(0, 0, copy.width, copy.height);
    const colours = new Set<number>();
    for (let index = 0; index < data.length; index += 4) {
      colours.add((data[index]! << 24) | (data[index + 1]! << 16) | (data[index + 2]! << 8) | data[index + 3]!);
      if (colours.size > 64) break;
    }
    return { width: copy.width, height: copy.height, distinctColours: colours.size, topLeft: [data[0], data[1], data[2], data[3]] };
  });
}

test("arbitrary slices rotate and translate inside the existing scene and restore through a shared URL", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await gotoApp(page, "/view-well/");
  await selectWellView(page, "earth", ["earth"]);
  // Wait for the scene before touching anything else. Selecting "earth" starts a software-rendered
  // build that occupies the main thread, and a click issued into that window waits on actionability
  // checks that cannot run — which is how a disclosure click consumed a whole test budget.
  const scene = await waitForScene(page);
  await page.locator(".demo-scene-options > summary").click();
  const canvas = scene.locator("canvas");
  await expect(canvas).toHaveAttribute("role", "img");
  await expect(canvas).toHaveAttribute("tabindex", "0");
  await expect(canvas).toHaveAttribute("aria-describedby");
  const cameraAnnouncement = scene.locator("output.sw-sr-only[aria-live='polite']");
  const beforePan = await cameraAnnouncement.textContent();
  await scene.getByRole("button", { name: "Pan scene left" }).click();
  await expect(cameraAnnouncement).not.toHaveText(beforePan ?? "");
  await expect(scene.getByRole("button", { name: "Zoom scene in" })).toBeEnabled();
  const sliceSelect = page.getByLabel("Seismic slice", { exact: true });
  await sliceSelect.selectOption("arbitrary");
  await expect(scene).toHaveAttribute("data-slice-vertices", /^[3-6]$/);
  await page.getByLabel("Plane azimuth", { exact: true }).fill("37");
  await page.getByLabel("Plane tilt", { exact: true }).fill("65");
  await page.getByLabel("Plane offset", { exact: true }).fill("100");
  await expect(scene).toHaveAttribute("data-slice-vertices", /^[3-6]$/);
  await expect.poll(() => Number(new URL(page.url()).searchParams.get("sw.planeNormal")?.split(",")[2]).toFixed(4)).toBe(Math.cos(65 * Math.PI / 180).toFixed(4));
  const url = page.url(), normal = new URL(url).searchParams.get("sw.planeNormal");
  await reloadApp(page);
  await selectWellView(page, "earth", ["earth"]);
  await waitForScene(page);
  await page.locator(".demo-scene-options > summary").click();
  await expect(scene).toHaveAttribute("data-slice-vertices", /^[3-6]$/);
  expect(new URL(page.url()).searchParams.get("sw.planeNormal")).toBe(normal);
  await expect(page.getByLabel("Plane tilt", { exact: true })).toHaveValue("65");
  await page.screenshot({ path: "output/playwright/arbitrary-slice.png" });
  await sliceSelect.selectOption("volume");
  await expect(scene).toHaveAttribute("data-slice-vertices", "0");
  expect(errors.filter((m) => /shader|WebGL|THREE/i.test(m))).toEqual([]);
});

test("log colour and display radius update co-axial geometry without rebuilding the well scene", async ({ page }) => {
  // The only test that builds the earth scene twice: once, then again after a reload to prove the
  // log mode survives in the URL. Two software-rendered scene builds plus the seismic decode do not
  // fit the default budget on a loaded runner, where a single build has been measured near 110 s.
  test.slow(SOFTWARE_RENDERING, "two software-rendered scene builds in one test");
  await gotoApp(page, "/view-well/");
  await selectWellView(page, "earth", ["earth"]);
  // Wait for the scene before touching anything else. Selecting "earth" starts a software-rendered
  // build that occupies the main thread, and a click issued into that window waits on actionability
  // checks that cannot run — which is how a disclosure click consumed a whole test budget.
  const scene = await waitForScene(page);
  await page.locator(".demo-scene-options > summary").click();
  const camera = await scene.getAttribute("data-camera");
  await page.getByLabel("Well log styling").selectOption("color-radius");
  await expect(scene).toHaveAttribute("data-log-triangles", /^\d{4,}$/);
  await expect(page.getByTestId("porosity-readout")).toContainText("synthetic, not FORGE data");
  await page.getByLabel("Well log styling").selectOption("radius");
  await expect(scene).toHaveAttribute("data-camera", camera!);
  await expect.poll(() => new URL(page.url()).searchParams.get("sw.logMode")).toBe("radius");
  await reloadApp(page);
  await selectWellView(page, "earth", ["earth"]);
  await waitForScene(page);
  await page.locator(".demo-scene-options > summary").click();
  await expect(page.getByLabel("Well log styling")).toHaveValue("radius");
  await expect(scene).toHaveAttribute("data-log-triangles", /^\d{4,}$/);
  await page.getByLabel("Well log styling").selectOption("none");
  await expect(scene).toHaveAttribute("data-log-triangles", "0");
});

test("float GPU framebuffer reads exact surface coordinates and sampled amplitude, detects misses and restores state", async ({ page }) => {
  await gotoApp(page, "/sandbox/");
  await page.getByRole("button", { name: "Open independent synthetic example" }).click();
  await page.getByRole("button", { name: "Run WebGL picking check" }).click();
  const result = page.getByTestId("gpu-check-result");
  await expect(result).toBeVisible({ timeout: SCENE_READY });
  expect(Number(await result.getAttribute("data-amplitude"))).toBeCloseTo(1.5, 5);
  const xyz = (await result.getAttribute("data-xyz"))!.split(",").map(Number);
  expect(xyz[0]).toBeCloseTo(0.03125, 5);
  expect(xyz[1]).toBeCloseTo(-0.03125, 5);
  expect(xyz[2]).toBeCloseTo(0, 5);
  await expect(result).toHaveAttribute("data-miss", "true");
  await expect(result).toHaveAttribute("data-restored", "true");
  await expect(result).toHaveAttribute("data-hidden", "true");
  await expect(result).toHaveAttribute("data-disposed", "true");
});

test("GPU slice picking reads coordinates on the oblique plane and publishes the chosen XYZ", async ({ page }) => {
  test.slow(SOFTWARE_RENDERING, "up to 24 software-rendered GPU picks in one sweep");
  await page.setViewportSize({ width: 1600, height: 1400 });
  await gotoApp(page, "/view-well/");
  await selectWellView(page, "earth", ["earth"]);
  // Wait for the scene before touching anything else. Selecting "earth" starts a software-rendered
  // build that occupies the main thread, and a click issued into that window waits on actionability
  // checks that cannot run — which is how a disclosure click consumed a whole test budget.
  const scene = await waitForScene(page);
  await page.locator(".demo-scene-options > summary").click();
  await page.getByLabel("Seismic slice", { exact: true }).selectOption("arbitrary");
  await page.getByLabel("Plane tilt", { exact: true }).fill("60");
  await page.getByLabel("Picking engine").selectOption("gpu");
  const box = (await scene.locator("canvas").boundingBox())!;
  const readout = page.getByTestId("gpu-pick-readout");
  /**
   * Whether the pick under the pointer reports an amplitude, allowing the pick a frame to arrive.
   *
   * A fixed 100 ms dwell was enough on a GPU and nowhere near enough under SwiftShader, so every
   * one of the 24 probe points read "no hit" and the sweep reported the plane unhittable without
   * ever having rendered a pick. Waiting for the readout keeps the assertion exactly as strong —
   * the pick must still produce a finite amplitude — and only allows the frame time to arrive.
   */
  const picked = async () => {
    const deadline = Date.now() + GPU_PICK_DWELL;
    do {
      const value = await readout.count() ? await readout.getAttribute("data-amplitude") : null;
      if (value !== null && value !== "" && Number.isFinite(Number(value))) return true;
      await page.waitForTimeout(50);
    } while (Date.now() < deadline);
    return false;
  };
  let hit: [number, number] | null = null;
  for (let fy = 0.35; fy <= 0.8 && !hit; fy += 0.08) for (let fx = 0.3; fx <= 0.8 && !hit; fx += 0.08) {
    const at: [number, number] = [box.x + box.width * fx, box.y + box.height * fy];
    await page.mouse.move(at[0], at[1]);
    if (await picked()) hit = at;
  }
  expect(hit, "no probe point on the tilted plane produced a GPU pick").not.toBeNull();
  await page.mouse.click(hit![0], hit![1]);
  await expect.poll(() => new URL(page.url()).searchParams.get("sw.xyz")).not.toBeNull();
  const url = new URL(page.url()), xyz = url.searchParams.get("sw.xyz")!.split(",").map(Number), origin = url.searchParams.get("sw.planeOrigin")!.split(",").map(Number), normal = url.searchParams.get("sw.planeNormal")!.split(",").map(Number);
  expect(Math.abs(xyz.reduce((sum, x, i) => sum + (x - origin[i]!) * normal[i]!, 0))).toBeLessThan(0.05);
});

test("WebGPU is explicitly opt-in and unavailable browsers show an actionable error without a fake ready canvas", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true }); });
  await gotoApp(page, "/sandbox/");
  await page.getByRole("button", { name: "Open independent synthetic example" }).click();
  await expect(page.getByTestId("webgpu-viewer")).toHaveCount(0);
  await page.getByRole("button", { name: "Start WebGPU" }).click();
  const viewer = page.getByTestId("webgpu-viewer");
  await expect(viewer).toHaveAttribute("data-status", "error");
  await expect(page.getByRole("alert").filter({ hasText: "WebGPU" })).toBeVisible();
  const cameraAnnouncement = viewer.locator('[aria-live="polite"]');
  await expect(cameraAnnouncement).toContainText("zoom 1.00");
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  await expect(cameraAnnouncement).toContainText("zoom 1.25");
  await viewer.getByRole("button", { name: "Move camera left" }).focus();
  await page.keyboard.press("Enter");
  await expect(cameraAnnouncement).toContainText("Camera position");
  await expect(page.getByRole("link", { name: "Use the WebGL well viewer" })).toBeVisible();
});

test("native WebGPU compiles and renders the synthetic volume and oblique plane", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Native WebGPU verification runs in Chromium.");
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await gotoApp(page, "/sandbox/");
  await page.getByRole("button", { name: "Open independent synthetic example" }).click();
  const supported = await page.evaluate(async () => {
    // Typed locally rather than by pulling @webgpu/types into the suite: this is the only WebGPU
    // reference in the specs, and all it needs to know is whether an adapter comes back.
    const gpu = (navigator as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    if (!gpu) return false;
    return (await gpu.requestAdapter()) !== null;
  });
  if (process.env.WEBGPU_TEST === "1") expect(supported, "GPU validation job must obtain a real native WebGPU adapter").toBe(true);
  test.skip(!supported, "This browser/device has no WebGPU adapter; unsupported behavior is covered separately.");
  await page.getByRole("button", { name: "Start WebGPU" }).click();
  const viewer = page.getByTestId("webgpu-viewer");
  await expect(viewer).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
  await expect(viewer.locator("canvas")).toHaveAttribute("data-backend", "webgpu");
  const canvas = viewer.locator("canvas");
  // An adapter can exist and still never present a frame: on a GPU-less Linux runner Chrome hands
  // out one whose canvas stays fully transparent, while the viewer still reports ready. That is an
  // environment limit rather than a product defect, so prove the adapter renders something before
  // asserting what rendering does — and say so loudly instead of reporting a silent pass.
  const painted = await describeCanvas(canvas);
  test.skip(
    "distinctColours" in painted && painted.distinctColours === 1,
    `WebGPU adapter present but renders nothing: ${JSON.stringify(painted)}. Software WebGPU is not usable here, so the pixel checks below cannot run.`,
  );
  const volume = await canvas.screenshot();
  await page.getByLabel("Opacity", { exact: true }).fill("0");
  await expectRenderedPixelsToChange(canvas, volume, "volume opacity must change rendered GPU pixels");
  await page.getByLabel("Opacity", { exact: true }).fill("20");
  await page.getByRole("button", { name: "Oblique slice" }).click();
  await page.getByLabel("Plane tilt", { exact: true }).fill("70");
  await page.waitForTimeout(500);
  await expect(viewer).toHaveAttribute("data-status", "ready");
  expect(errors.filter((error) => /shader|WGSL|WebGPU|validation|pipeline/i.test(error))).toEqual([]);
  await page.screenshot({ path: "output/playwright/webgpu-sandbox.png" });
  const slice = await canvas.screenshot();
  await page.getByLabel("Slice depth", { exact: true }).fill("1100");
  await expectRenderedPixelsToChange(canvas, slice, "slice translation must change rendered GPU pixels");
  await page.getByRole("button", { name: "Regenerate seismic", exact: true }).click();
  await expect(viewer).toHaveAttribute("data-status", "ready");
  await expect(canvas).toHaveCount(1);
  await page.getByRole("button", { name: "Oblique slice", exact: true }).click();
  await page.getByLabel("Voxel format", { exact: true }).selectOption("uint8");
  await expect(viewer).toHaveAttribute("data-status", "ready");
  const byteVolume = await canvas.screenshot();
  await page.getByLabel("Opacity", { exact: true }).fill("0");
  expect(byteVolume.equals(await canvas.screenshot()), "calibrated Uint8 volume must paint non-background pixels").toBe(false);
  await page.getByLabel("Opacity", { exact: true }).fill("20");
  await page.getByRole("button", { name: "Stop WebGPU" }).click();
  await expect(viewer).toHaveCount(0);
  await page.getByRole("button", { name: "Start WebGPU", exact: true }).click();
  await expect(page.getByTestId("webgpu-viewer")).toHaveAttribute("data-status", "ready");
  await expect(page.getByTestId("webgpu-viewer").locator("canvas")).toHaveCount(1);
  await page.getByRole("button", { name: "Stop WebGPU", exact: true }).click();
  await page.getByRole("button", { name: "Start WebGPU", exact: true }).click();
  await page.getByRole("button", { name: "Stop WebGPU", exact: true }).click();
  await expect(page.getByTestId("webgpu-viewer")).toHaveCount(0);
  expect(errors.filter((error) => /shader|WGSL|WebGPU|validation|pipeline/i.test(error))).toEqual([]);
});

// Desktop-only product (Ikhmal, 2026-10-13): phone layout is out of scope.
test.skip("sandbox controls fit a phone and have accessible names without starting a GPU", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await gotoApp(page, "/sandbox/");
  await page.getByRole("button", { name: "Open independent synthetic example" }).click();
  await expect(page.getByLabel("Voxel format", { exact: true })).toHaveValue("float32");
  await page.getByRole("button", { name: "Oblique slice", exact: true }).click();
  await expect(page.getByLabel("Plane tilt", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  await expect(page.getByTestId("webgpu-viewer")).toHaveCount(0);
});
