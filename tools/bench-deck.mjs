// Runtime budgets in a real browser: the deck's startup, and how long each module blocks the main
// thread while it loads and draws, on every site that has it. Needs a build served locally and
// Playwright with Chromium:
//
//   pnpm build && SERVE_APP=deck PORT=3110 node tools/serve.mjs &
//   PLAYWRIGHT=/path/to/node_modules/@playwright/test/index.mjs node tools/bench-deck.mjs [http://127.0.0.1:3110/]
import { BUDGETS } from "./budgets.mjs";

const playwright = await import(process.env.PLAYWRIGHT ?? "@playwright/test").catch(() => null);
if (!playwright) { console.error("Playwright is not installed here: install @playwright/test (and Chromium) and point PLAYWRIGHT at it."); process.exit(2); }
const base = process.argv[2] ?? "http://127.0.0.1:3110/";
const browser = await playwright.chromium.launch({ args: ["--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
await page.addInitScript(() => { window.__long = []; new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__long.push(e.duration); }).observe({ type: "longtask", buffered: true }); });
const take = () => page.evaluate(() => { const l = window.__long; window.__long = []; return l; });
const command = async (text) => { await page.keyboard.press("Meta+k"); await page.waitForTimeout(150); await page.keyboard.type(text); await page.waitForTimeout(150); await page.keyboard.press("Enter"); };
const broken = [], rows = [];
const check = (label, value, budget) => { rows.push(`${value <= budget ? "ok  " : "OVER"} ${label.padEnd(40)} ${String(Math.round(value)).padStart(6)} / ${budget} ms`); if (value > budget) broken.push(`${label}: ${Math.round(value)} ms over ${budget} ms`); };

const t0 = Date.now();
await page.goto(`${base}deck/`); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForSelector("[data-testid='wells-map'][data-ready='true']", { timeout: 60000 });
check("startup: globe ready", Date.now() - t0, BUDGETS.runtime.startupMs);
check("startup: main-thread blocking", (await take()).reduce((a, b) => a + b, 0), BUDGETS.runtime.startupLongTaskMs);

const SCENES = new Set(["site in 3d", "well in 3d", "cutaway"]);
const SITES = {
  utah: ["site in 3d", "well section", "seismic section", "logs", "geomechanics", "torque", "anti-collision", "drilling record", "well in 3d", "cutaway", "compare wells", "decline curves", "plan view", "barriers"],
  equator: ["logs", "petrophysics"],
  kestrel: ["well designer", "pressure window", "kick tolerance", "cement", "hydraulics", "construction", "live drilling"],
};
for (const [site, modules] of Object.entries(SITES)) {
  await command(`fly to ${site}`); await page.waitForTimeout(4000); await take();
  for (const module of modules) {
    await command(`open ${module}`); await page.waitForTimeout(3500);
    const worst = Math.max(0, ...(await take()));
    check(`${site} · ${module}: longest task`, worst, SCENES.has(module) ? BUDGETS.runtime.scene3dLongTaskMs : BUDGETS.runtime.moduleLongTaskMs);
    await page.evaluate(() => { for (const el of [...document.querySelectorAll("[data-module]")].slice(0, -2)) el.querySelector(".tile-action[aria-label^='Close']")?.click(); });
    await page.waitForTimeout(300); await take();
  }
}
await browser.close();
console.log(rows.join("\n"));
if (broken.length) { console.error(`\n${broken.length} runtime budget${broken.length === 1 ? "" : "s"} broken:\n  ${broken.join("\n  ")}`); process.exit(1); }
console.log("\nEvery runtime budget holds.");
