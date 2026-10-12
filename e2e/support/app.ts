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
  return response;
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
