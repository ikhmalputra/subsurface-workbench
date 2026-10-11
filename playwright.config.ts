import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  retries: 0,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "output/playwright/results.json" }]],
  use: {
    baseURL: "http://127.0.0.1:3101", trace: "retain-on-failure",
    launchOptions: { args: process.env.WEBGPU_TEST === "1" ? ["--enable-unsafe-webgpu", "--use-angle=swiftshader"] : [] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
  // SERVE_APP stays parameterised so a second app can be served without touching the server again.
  webServer: { command: "node tools/serve.mjs", env: { PORT: "3101", SERVE_APP: "demo" }, url: "http://127.0.0.1:3101", reuseExistingServer: false },
});
