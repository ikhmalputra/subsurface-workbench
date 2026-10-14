// Open every tool in the catalogue and check it is usable: nothing clipped, text readable, and the
// panel it opens named after the button that opened it.
//
// This is the instrument for "the tools are unreadable". It found 47 clipped elements in the daily
// register and 12 buttons opening 5 panels; it is how we know when that is fixed.
//
//   pnpm dev          (in one terminal)
//   node tools/tool-audit.mjs
import { chromium } from "@playwright/test";

const BASE = process.env.DESIGN_URL ?? "http://localhost:3000";
const DOMAINS = ["Drilling", "Geology", "Geophysics", "Petrophysics", "Completions", "Production", "Field & data"];
const MIN_FONT_PX = 11;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
await page.goto(`${BASE}/view-well/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("html[data-sw-hydrated='true']", { timeout: 30_000 });
await page.waitForTimeout(3_000);
await page.getByRole("navigation", { name: "Well browser" }).getByRole("tab", { name: "Tools", exact: true }).click();
await page.waitForTimeout(400);

const catalogue = page.locator('[data-testid="tool-catalogue"]');
const rows = [];
for (const domain of DOMAINS) {
  if (!(await catalogue.getByLabel("Sub-domain").locator(`option:text-is("${domain}")`).count())) continue;
  await catalogue.getByLabel("Sub-domain").selectOption({ label: domain });
  await page.waitForTimeout(350);
  const names = (await catalogue.getByRole("button").allInnerTexts()).map((t) => t.split("\n")[0].trim()).filter(Boolean);
  for (const name of names) {
    try { await catalogue.getByRole("button", { name, exact: true }).click({ timeout: 3_000 }); } catch { continue; }
    await page.waitForTimeout(900);
    const seen = await page.evaluate((floor) => {
      // The front panel of whichever region it landed in. A document fills the sheet instead.
      const panel = document.querySelector(".swx-insp .demo-float:not([hidden]), .swx-shelf .demo-float:not([hidden])");
      if (!panel) return null;
      const sized = [...panel.querySelectorAll("*")].filter((node) => node.getClientRects().length);
      // Content wider than its box is only a defect when the box hides it. An element with
      // `overflow: auto` is scrollable by design, and a screen-reader-only element is 1px by
      // design — counting either as clipped is how an audit reports 18 defects in a panel that
      // has one.
      const clipped = sized.filter((node) => {
        if (node.scrollWidth <= node.clientWidth + 1) return false;
        if (node.clientWidth <= 4 || node.clientHeight <= 4) return false;
        // A text field whose value is longer than the box scrolls inside itself; that is what a
        // text field does.
        if (["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName)) return false;
        const overflow = getComputedStyle(node).overflowX;
        return overflow === "hidden" || overflow === "clip";
      });
      return {
        region: panel.closest(".swx-shelf") ? "shelf" : "column",
        title: panel.querySelector(".demo-float-title")?.textContent?.trim() ?? "",
        clipped: clipped.length,
        worst: clipped.sort((a, b) => (b.scrollWidth - b.clientWidth) - (a.scrollWidth - a.clientWidth))[0]
          ? `${(clipped[0].className || clipped[0].tagName).toString().split(" ")[0]} needs ${clipped[0].scrollWidth} in ${clipped[0].clientWidth}` : "",
        tiny: sized.filter((node) => node.textContent?.trim() && parseFloat(getComputedStyle(node).fontSize) < floor).length,
      };
    }, MIN_FONT_PX);
    if (seen) rows.push({ name, ...seen });
    // Close it before the next one. Two regions populated at once and `querySelector` reports the
    // first in document order, which is the inspector — so every shelf tool read as the column's.
    for (const close of await page.locator(".swx-insp .demo-float:not([hidden]) .demo-float-close, .swx-shelf .demo-float:not([hidden]) .demo-float-close").all()) {
      await close.click({ timeout: 1_500 }).catch(() => {});
    }
    await page.waitForTimeout(350);
  }
}
await browser.close();

const named = (row) => row.title.toLowerCase().startsWith(row.name.toLowerCase()) || row.title.toLowerCase().includes(row.name.toLowerCase());
console.log("tool".padEnd(18), "region".padEnd(7), "clipped".padStart(8), "tiny".padStart(5), "  panel");
for (const row of rows) {
  console.log(row.name.padEnd(18), row.region.padEnd(7), String(row.clipped).padStart(8), String(row.tiny).padStart(5),
    `  ${named(row) ? " " : "✗"} ${row.title}${row.worst ? `   — ${row.worst}` : ""}`);
}
const clipped = rows.filter((row) => row.clipped > 0);
const misnamed = rows.filter((row) => !named(row));
console.log(`\n${rows.length} tools · ${clipped.length} with clipped content · ${misnamed.length} opening a differently named panel`);
process.exit(clipped.length || misnamed.length ? 1 : 0);
