import { defineConfig, devices } from "@playwright/test";

const viewport = { width: 1440, height: 1000 };
const launchOptions = { args: process.env.WEBGPU_TEST === "1" ? ["--enable-unsafe-webgpu", "--use-angle=swiftshader"] : [] };

// Two apps run side by side for the duration of the 0.2.0 migration: the existing demo keeps the
// behavioural contract green while the new workbench grows its own suite in the same CI run.
export default defineConfig({
  retries: 0,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "output/playwright/results.json" }]],
  use: { trace: "retain-on-failure", launchOptions },
  projects: [
    {
      name: "demo",
      testDir: "./e2e",
      testIgnore: "workbench/**",
      use: { ...devices["Desktop Chrome"], viewport, baseURL: "http://127.0.0.1:3101" },
    },
    {
      name: "workbench",
      testDir: "./e2e/workbench",
      use: { ...devices["Desktop Chrome"], viewport, baseURL: "http://127.0.0.1:3103" },
    },
  ],
  webServer: [
    { command: "node tools/serve.mjs", env: { PORT: "3101", SERVE_APP: "demo" }, url: "http://127.0.0.1:3101", reuseExistingServer: false },
    { command: "node tools/serve.mjs", env: { PORT: "3103", SERVE_APP: "workbench" }, url: "http://127.0.0.1:3103", reuseExistingServer: false },
  ],
});
