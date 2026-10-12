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
export async function gotoApp(page: Page, url: string): Promise<Response | null> {
  const response = await page.goto(url);
  await expect(page.locator("html[data-sw-hydrated='true']"), "the application should hydrate before being driven")
    .toBeAttached({ timeout: SCENE_READY });
  await paintedFrame(page);
  return response;
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
  await paintedFrame(page);
}
