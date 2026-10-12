import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
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
export async function gotoApp(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator("html[data-sw-hydrated='true']"), "the application should hydrate before being driven")
    .toBeAttached({ timeout: SCENE_READY });
}
