import { expect } from "@playwright/test";
import type { Page, Response } from "@playwright/test";
import { SCENE_READY } from "./timing";

/**
 * Open a route and wait until the application can actually receive input.
 *
 * Every route is prerendered, so `page.goto` resolves on markup whose handlers are not attached
 * yet. Playwright's actionability checks pass in that window — the control is present, visible and
 * stable — so an interaction is accepted and then dropped, and a controlled `<select>` is quietly
 * reset to its React value when hydration arrives. The failure surfaces much later as "the view
 * never changed", which is how one CI shard spent three minutes waiting for a 3D scene that was
 * never asked for.
 *
 * `html[data-sw-hydrated]` is set by the application frame in an effect, so waiting for it means
 * React is mounted and effects have run.
 */
/** Open a tool from the ribbon: its sub-domain tab, then its button. The ribbon is docked top by default. */
export async function openTool(page: Page, domain: string, name: string) {
  const ribbon = page.locator('[data-float="ribbon"]');
  await ribbon.getByRole("tab", { name: domain, exact: true }).click();
  await ribbon.getByRole("button", { name, exact: true }).click();
}

export async function gotoApp(page: Page, url: string): Promise<Response | null> {
  const response = await page.goto(url);
  await expect(page.locator("html[data-sw-hydrated='true']"), "the application should hydrate before being driven")
    .toBeAttached({ timeout: SCENE_READY });
  await streamedBoundariesSettled(page);
  await forwarded(page);
  await paintedFrame(page);
  return response;
}

/**
 * The old routes forward to the sheet with `?tool=`: a test that opened `/builder/` is driven on
 * the sheet with the design brief open. Wait for the forward and for the document to be there.
 */
async function forwarded(page: Page): Promise<void> {
  await expect(page.locator("[data-forwarding]"), "a forwarding route should reach the sheet").toHaveCount(0, { timeout: SCENE_READY });
  if (new URL(page.url()).pathname.replace(/\/$/, "") === "/view-well") {
    const tool = new URL(page.url()).searchParams.get("tool") ?? "section";
    // The survey is not a document: it is the section with the summary and the station editor beside it.
    const document = tool === "trajectory" || tool === "study" || tool === "edit-well" || tool === "brief" ? "section" : tool;
    await expect(page.locator(`.demo-tool-page[data-document="${document}"]`), `the "${document}" document should open on the sheet`).toBeAttached({ timeout: SCENE_READY });
    if (tool === "trajectory") await expect(page.getByTestId("tool-stations"), "the station editor should open with the survey").toBeAttached({ timeout: SCENE_READY });
    if (tool === "study") await expect(page.getByTestId("tool-study"), "the study tool should open with the section").toBeAttached({ timeout: SCENE_READY });
    if (tool === "edit-well") await expect(page.getByTestId("tool-construction"), "the construction tool should open with the Edit view").toBeAttached({ timeout: SCENE_READY });
    if (tool === "brief") await expect(page.locator(".sw-wd-steps"), "the design tool should open with the Design view").toBeAttached({ timeout: SCENE_READY });
  }
}

/**
 * Wait until Next's streamed Suspense content has been swapped in.
 *
 * A prerendered page carries each Suspense boundary's content in a hidden `<div id="S:n">` and
 * swaps it into place with an inline script. React can client-render the same boundary before
 * that script runs — the frame hydrates first and marks itself ready — and for a few hundred
 * milliseconds the document holds two copies of the route: the live one and the hidden streamed
 * one. A test that reaches for the well section in that window finds both.
 */
async function streamedBoundariesSettled(page: Page): Promise<void> {
  await expect(page.locator('div[hidden][id^="S:"]'), "streamed Suspense content should be swapped in before the app is driven")
    .toHaveCount(0, { timeout: SCENE_READY });
}

/**
 * Wait until the document has painted a frame.
 *
 * Hydration is a DOM fact; a screenshot needs a compositor frame, and after a heavy predecessor
 * in the same browser the first frame of a new document can lag the DOM by long enough for
 * Chromium to refuse the capture ("Unable to capture screenshot"). It happened only in the full
 * file, never in isolation, which is the signature of exactly this. Two animation frames is the
 * standard way to be past the first paint.
 */
async function paintedFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/**
 * Choose a view preset on the well workspace and wait until it is actually showing.
 *
 * Selecting a preset and then waiting for its heaviest content cannot distinguish three failures:
 * the selection never reaching React, the pane never mounting, and the renderer never attaching.
 * Twice now a CI shard has spent two 90-second attempts reporting the third while the page was
 * still showing the previous preset — which rules out the third, and nothing in the evidence said
 * so. Each step is checked here, in order, so a failure names itself.
 */
export async function selectWellView(page: Page, preset: string, panes: readonly string[]): Promise<void> {
  const view = page.getByRole("combobox", { name: "View", exact: true });
  await view.selectOption(preset);
  await expect(view, `the "${preset}" selection should reach the application`).toHaveValue(preset);
  for (const pane of panes) {
    await expect(page.locator(`[data-pane='${pane}'][data-mounted='true']`), `the "${pane}" pane should mount for the "${preset}" preset`)
      .toBeAttached({ timeout: SCENE_READY });
  }
}

/**
 * Reload and wait for the application to be driveable again.
 *
 * A reload is the worse case, not the gentler one: the document is served from cache, so the
 * prerendered markup paints almost immediately and the window before hydration is wider in
 * wall-clock terms than on a cold navigation. A CI shard selected a view preset in that window and
 * the `<select>` went back to its React value, which the test then spent 90 seconds describing as a
 * 3D renderer that would not attach.
 */
export async function reloadApp(page: Page): Promise<void> {
  await page.reload();
  await expect(page.locator("html[data-sw-hydrated='true']"), "the application should hydrate after a reload before being driven")
    .toBeAttached({ timeout: SCENE_READY });
  await streamedBoundariesSettled(page);
  await forwarded(page);
  await paintedFrame(page);
}

/**
 * Open the navigation panel if it is closed. There is no sidebar: the navigation is a floating
 * panel behind a toggle on the workspace toolbar, closed by default so the sheet is clear, and it
 * closes itself when a destination is chosen. Idempotent, so a test can call it before every move.
 */
export async function openNavigation(page: Page): Promise<void> {
  const open = page.getByRole("button", { name: "Open navigation" });
  if (await open.count()) await open.click();
  await expect(page.getByRole("navigation", { name: "Workbench navigation" })).toBeVisible();
}

/** Put the navigation panel away so it covers nothing on the sheet. */
export async function closeNavigation(page: Page): Promise<void> {
  const close = page.getByRole("button", { name: "Close navigation" });
  if (await close.count()) await close.click();
  await expect(page.getByRole("navigation", { name: "Workbench navigation" })).toBeHidden();
}

/** Open the appearance menu on the status bar, so the theme and density selects are usable. */
export async function openAppearance(page: Page): Promise<void> {
  const appearance = page.locator(".demo-nav-secondary").filter({ hasText: "Appearance" });
  if (!(await appearance.evaluate((element) => (element as HTMLDetailsElement).open))) await appearance.locator("summary").click();
  await expect(page.getByRole("combobox", { name: "Theme", exact: true })).toBeVisible();
}
