// The dock's card shows each tool at work: this captures every module spread over the deck, on a
// place it works at, and saves a small JPEG per module to apps/deck/public/landing/tools/. Run it
// after a change that alters how a module looks. Needs a build served locally and Playwright:
//
//   pnpm build && SERVE_APP=deck PORT=3110 node tools/serve.mjs &
//   PLAYWRIGHT=/path/to/node_modules/@playwright/test/index.mjs node tools/capture-tool-previews.mjs [http://127.0.0.1:3110/] [module ids…]
//
// Downscaled with macOS `sips` to 560 px wide.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const playwright = await import(process.env.PLAYWRIGHT ?? "@playwright/test").catch(() => null);
if (!playwright) { console.error("Playwright is not installed here: install @playwright/test (and Chromium) and point PLAYWRIGHT at it."); process.exit(2); }
const base = process.argv[2] ?? "http://127.0.0.1:3110/";
const only = new Set(process.argv.slice(3));
const out = new URL("../apps/deck/public/landing/tools/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

/** Where each module is shown, and anything to do once it is open (a lens, a wait for the worker). */
const PLACES = {
  forge: "Utah FORGE", kestrel: "Kestrel", force: "31/2-7",
};
const SHOTS = [
  ["globe", null], ["site3d", "forge"], ["seismic", "forge"], ["attributes", "forge", 9000], ["curtain", "forge"], ["correlate", "force", 6000], ["tie", "forge", 5000], ["horizons", "forge", 6000], ["volumetrics", "force", 6000],
  ["logs", "forge"], ["petro", "force", 5000],
  ["geomech", "forge"], ["stimulation", "forge", 6000], ["window", "kestrel"],
  ["drilling", "forge"], ["rig", "kestrel", 6000], ["torquedrag", "forge"], ["hydraulics", "kestrel"], ["kick", "kestrel"], ["anticollision", "forge"], ["plan", "forge"], ["profile", "forge"],
  ["designer", "kestrel"], ["construction", "forge"], ["section", "forge"], ["well3d", "forge", 6000], ["cutaway", "forge", 5000], ["strings", "kestrel"], ["cement", "kestrel"], ["barriers", "kestrel"],
  ["decline", null, 5000], ["nodal", "kestrel", 5000],
  ["editor", "forge"], ["compare", "forge", 5000], ["sources", null, 4000],
];

const browser = await playwright.chromium.launch({ args: ["--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" })).newPage();
const command = async (text) => { await page.keyboard.press("Meta+k"); await page.waitForTimeout(200); await page.keyboard.type(text); await page.waitForTimeout(300); await page.keyboard.press("Enter"); };
await page.goto(`${base}deck/`); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForSelector("[data-testid='wells-map'][data-ready='true']", { timeout: 60000 });
let at = null;
for (const [id, place, wait = 3500] of SHOTS) {
  if (only.size && !only.has(id)) continue;
  if (place && place !== at) { await command(PLACES[place]); await page.waitForTimeout(4500); at = place; }
  await openModule(id);
  // Off the dock, so its card is not in the picture.
  await page.mouse.move(900, 980); await page.waitForTimeout(wait);
  const tile = page.locator(`[data-module="${id}"]`).first();
  if (!(await tile.count())) { console.log(`skip ${id}: did not open`); continue; }
  const spread = tile.locator(".tile-action[aria-pressed='false']").first();
  if (await spread.count()) { await spread.click(); await page.mouse.move(900, 980); await page.waitForTimeout(1500); }
  // A module showing its empty state has nothing to preview: the card falls back to its glyph.
  if (await tile.locator(".empty, [data-empty]").count()) { console.log(`skip ${id}: empty here`); await page.evaluate((m) => document.querySelector(`[data-module="${m}"] .tile-action[aria-label^='Close']`)?.click(), id); continue; }
  const file = `${out}${id}.jpg`;
  await page.locator(`[data-module="${id}"]`).first().screenshot({ path: file, type: "jpeg", quality: 82 });
  execFileSync("sips", ["--resampleWidth", "560", "-s", "formatOptions", "72", file], { stdio: "ignore" });
  console.log(`saved ${id}`);
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  await page.evaluate(() => { for (const el of [...document.querySelectorAll("[data-module]")]) el.querySelector(".tile-action[aria-label^='Close']")?.click(); });
  await page.waitForTimeout(400);
}
await browser.close();

/** Opens a module from its dock button (a click opens it where there is room). */
async function openModule(id) {
  await page.locator(`.dock-item[data-id="${id}"]`).click();
}
