import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { SCENE_READY } from "./timing";

/**
 * Wait for a 3D view to be usable.
 *
 * Two things have to happen and they are not the same: the lazy Three chunk has to mount, and the
 * scene has to produce its first frame. Under software rendering each can take tens of seconds, so
 * they get separate budgets — sharing one meant a slow import left nothing for rendering, and the
 * failure read "element not found" without saying which step did not happen.
 *
 * Every scene wait goes through here so a spec cannot quietly fall back to the default expect
 * timeout, which is what broke edit-well on CI while the specs that passed a budget survived.
 */
export async function waitForScene(page: Page, testId = "interactive-well-scene"): Promise<Locator> {
  const scene = page.getByTestId(testId);
  await expect(scene, `${testId} should mount its lazily imported renderer`).toBeAttached({ timeout: SCENE_READY });
  await expect(scene, `${testId} should render its first frame`).toHaveAttribute("data-ready", "true", { timeout: SCENE_READY });
  return scene;
}
