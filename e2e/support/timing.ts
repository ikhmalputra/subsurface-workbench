/**
 * CI has no GPU, so WebGL runs through SwiftShader on a small runner and a scene takes several
 * times longer to initialise than on a real GPU. These budgets are generous there and tight
 * locally, so a genuine hang still fails fast during development.
 */
const onCi = Boolean(process.env.CI);

/** A 3D scene reaching data-ready, including its first software-rendered frame. */
export const SCENE_READY = onCi ? 90_000 : 20_000;

/** Controls that only exist once a multi-megabyte asset (the seismic cube) has decoded. */
export const HEAVY_ASSET = onCi ? 90_000 : 60_000;
