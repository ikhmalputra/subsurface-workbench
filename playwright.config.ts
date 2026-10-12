import { defineConfig, devices } from "@playwright/test";
import { SOFTWARE_RENDERING as softwareRendering } from "./e2e/support/timing";

// CI runners have no GPU, and Chrome no longer falls back to software WebGL on its own: without
// these flags every WebGL context fails to create, so the 3D scenes report data-ready="false" and
// every scene-dependent test fails while the 2D ones pass. Local runs keep the real GPU for speed.
// The flag itself lives in e2e/support/timing so the specs scale their budgets off the same value.
const args = [
  ...(softwareRendering ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : []),
  // On a GPU-less Linux runner Chrome will hand out a WebGPU adapter that never presents a frame:
  // the canvas reports ready with the right backend but the pixels never change. Point Dawn at
  // SwiftShader explicitly so the adapter it returns is one that actually renders.
  ...(process.env.WEBGPU_TEST === "1" ? ["--enable-unsafe-webgpu", "--use-webgpu-adapter=swiftshader"] : []),
];

export default defineConfig({
  testDir: "./e2e",
  // Software rendering under full-suite load makes a couple of scene-settling assertions timing
  // sensitive; they pass in isolation. A retry keeps CI usable, and Playwright still reports a
  // retried test as flaky rather than green, so it stays visible instead of being masked.
  retries: softwareRendering ? 1 : 0,
  // CI shards across jobs on two-core runners, so each shard stays serial. Locally the suite
  // parallelises, but only to two: at four, concurrent Chromium instances contend for the GPU
  // and the scene-heavy specs fail. Two is stable and still halves the wall time.
  workers: process.env.CI ? 1 : 2,
  // Software rendering is several times slower than a real GPU; the scene-heavy specs need the
  // headroom, and CI measured 21.6 minutes against 7 locally.
  timeout: softwareRendering ? 120_000 : 30_000,
  expect: { timeout: softwareRendering ? 15_000 : 5_000 },
  reporter: [["list"], ["json", { outputFile: "output/playwright/results.json" }]],
  use: {
    baseURL: "http://127.0.0.1:3101", trace: "retain-on-failure",
    launchOptions: { args },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
  // SERVE_APP stays parameterised so a second app can be served without touching the server again.
  webServer: { command: "node tools/serve.mjs", env: { PORT: "3101", SERVE_APP: "demo" }, url: "http://127.0.0.1:3101", reuseExistingServer: false },
});
