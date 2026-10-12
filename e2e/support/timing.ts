/**
 * CI has no GPU, so WebGL runs through SwiftShader on a small runner and a scene takes several
 * times longer to initialise than on a real GPU. These budgets are generous there and tight
 * locally, so a genuine hang still fails fast during development.
 */

/**
 * Whether this run renders in software. Declared here rather than in the Playwright config so the
 * config and the specs cannot disagree about it — they did, and a spec that guessed wrong either
 * scaled a budget that did not need it or left one unscaled that did.
 */
export const SOFTWARE_RENDERING = Boolean(process.env.CI) || process.env.WEBGPU_TEST === "1";

/** A 3D scene reaching data-ready, including its first software-rendered frame. */
export const SCENE_READY = SOFTWARE_RENDERING ? 90_000 : 20_000;

/** Controls that only exist once a multi-megabyte asset (the seismic cube) has decoded. */
export const HEAVY_ASSET = SOFTWARE_RENDERING ? 90_000 : 60_000;

/**
 * How long one GPU pick may take to appear after the pointer moves.
 *
 * A pick is a render into an offscreen target plus a framebuffer read. On a real GPU that lands
 * within a frame; under SwiftShader at a large viewport it does not, so a probe that samples and
 * moves on immediately reads "no hit" everywhere and a sweep fails without ever testing the
 * geometry it was written to test.
 */
export const GPU_PICK_DWELL = SOFTWARE_RENDERING ? 2_000 : 200;
