// Screenshots of modules for design review, at 1440 × 1000 unless SIZE says otherwise:
//
//   PLAYWRIGHT=… node tools/shot.mjs <base url> <place|-> <module> [tile|expanded] [lens…]
//
// Writes output/design/<module>-<state>[-<lens>].png and prints the paths.
import { mkdirSync } from "node:fs";

const playwright = await import(process.env.PLAYWRIGHT ?? "@playwright/test").catch(() => null);
if (!playwright) { console.error("Playwright is not installed here."); process.exit(2); }
const [base, place, id, state = "expanded", ...lenses] = process.argv.slice(2);
const [W, H] = (process.env.SIZE ?? "1440x1000").split("x").map(Number);
const out = new URL("../output/design/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await playwright.chromium.launch({ args: ["--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: W, height: H }, colorScheme: "dark" })).newPage();
const command = async (text) => { await page.keyboard.press("Meta+k"); await page.waitForTimeout(200); await page.keyboard.type(text); await page.waitForTimeout(300); await page.keyboard.press("Enter"); };
await page.goto(`${base}deck/`); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForSelector("[data-testid='wells-map'][data-ready='true']", { timeout: 60000 });
if (place && place !== "-") { await command(place); await page.waitForTimeout(4000); }
if (!(await page.locator(`[data-module="${id}"]`).count())) await page.locator(`.dock-item[data-id="${id}"]`).click();
await page.mouse.move(W / 2, H - 6);
await page.waitForTimeout(3500);
const expanded = await page.locator(`[data-module="${id}"] .tile-action[aria-pressed='true']`).count();
if (state === "expanded" && !expanded) { await page.locator(`[data-module="${id}"] .tile-action[aria-pressed='false']`).first().click(); await page.waitForTimeout(1500); }
if (state === "tile" && expanded) { await page.keyboard.press("Escape"); await page.waitForTimeout(1200); }
const paths = [];
for (const lens of lenses.length ? lenses : [null]) {
  if (lens) {
    // A lens tab, or a button (a page link) by its text.
    const tab = page.locator(`[data-module="${id}"] [role=tab]`, { hasText: lens });
    if (await tab.count()) await tab.first().click(); else await page.locator(`[data-module="${id}"] button`, { hasText: lens }).first().click();
    await page.waitForTimeout(2000);
  }
  // TILE_OUT: the expanded tile alone, as a JPEG for the landing page (the last lens's).
  if (process.env.TILE_OUT) { await page.mouse.move(W / 2, H - 6); await page.waitForTimeout(600); await page.locator(`[data-module="${id}"]`).first().screenshot({ path: process.env.TILE_OUT, type: "jpeg", quality: 84 }); paths.push(process.env.TILE_OUT); continue; }
  const file = `${out}${id}-${state}${lens ? `-${lens.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : ""}.png`;
  await page.screenshot({ path: file });
  paths.push(file);
}
await browser.close();
console.log(paths.join("\n"));
