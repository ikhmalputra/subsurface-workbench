// The deck under a large tenant, in Chromium at 1440 × 1000:
// - how long until the globe is usable and until the catalogue has loaded;
// - the longest main-thread stall;
// - the JS heap;
// - what the Data sources tool and a big field's Site in 3D cost.
//   PLAYWRIGHT=… node tools/stress/measure-browser.mjs http://localhost:3310/ "<field name to fly to>"
const playwright = await import(process.env.PLAYWRIGHT ?? "@playwright/test");
const [base = "http://localhost:3310/", field = "Field 0"] = process.argv.slice(2);
const browser = await playwright.chromium.launch({ args: ["--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--enable-precise-memory-info"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" })).newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("crash", () => errors.push("THE PAGE CRASHED"));
// Long tasks: every main-thread stall over 50 ms, as the browser reports it.
await page.addInitScript(() => { window.__stalls = []; new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__stalls.push(entry.duration); }).observe({ type: "longtask", buffered: true }); });
const t0 = Date.now();
await page.goto(`${base}deck/`); await page.evaluate(() => localStorage.clear()); await page.reload();
const reading = async () => page.evaluate(() => ({ heapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576), stalls: window.__stalls.length, worstStallMs: Math.round(Math.max(0, ...window.__stalls)), stalledMs: Math.round(window.__stalls.reduce((a, b) => a + b, 0)) }));
try {
  await page.waitForSelector("[data-testid='wells-map'][data-ready='true']", { timeout: 120000 });
  const globe = Date.now() - t0;
  await page.waitForFunction(() => document.querySelectorAll(".maplibregl-canvas").length > 0, null, { timeout: 120000 });
  await page.waitForTimeout(15000);
  console.log(JSON.stringify({ step: "start", globeReadyMs: globe, ...(await reading()) }));
  let t = Date.now();
  await page.locator('.dock-item[data-id="sources"]').click();
  await page.waitForSelector('[data-module="sources"] .ds-row', { timeout: 120000 });
  // The wells listed, as the tool's own count says, and how many rows it actually drew (only those in view).
  const listed = await page.locator('[data-module="sources"] .mf-numbers span').nth(1).locator("b").innerText();
  console.log(JSON.stringify({ step: "data sources", ms: Date.now() - t, listed, rowsDrawn: await page.locator('[data-module="sources"] .ds-row').count(), ...(await reading()) }));
  await page.locator('[data-module="sources"] .ds-list').evaluate((element) => { element.scrollTop = element.scrollHeight / 2; });
  await page.waitForTimeout(400);
  console.log(JSON.stringify({ step: "data sources scrolled halfway", firstRow: await page.locator('[data-module="sources"] .ds-row:not(.ds-head)').first().innerText().then((text) => text.split("\n")[0]), ...(await reading()) }));
  t = Date.now();
  await page.keyboard.press("Meta+k"); await page.waitForTimeout(200); await page.keyboard.type(field); await page.waitForTimeout(500); await page.keyboard.press("Enter");
  await page.waitForTimeout(3000);
  if (!(await page.locator('[data-module="site3d"]').count())) await page.locator('.dock-item[data-id="site3d"]').click();
  await page.waitForSelector('[data-module="site3d"] canvas', { timeout: 120000 }); await page.waitForTimeout(5000);
  console.log(JSON.stringify({ step: `site3d ${field}`, ms: Date.now() - t, ...(await reading()) }));
  await page.screenshot({ path: process.env.SHOT ?? "/tmp/stress.png" });
} catch (error) { errors.push(String(error).slice(0, 300)); }
console.log(JSON.stringify({ errors }));
await browser.close();
