// Every module, on a place it works at, as a tile and expanded over the deck, at two window sizes:
// anything drawn on top of something else that is not meant to be. Reports, per module and state,
//   - text over text: two pieces of text (HTML or SVG) whose boxes overlap, neither inside the other;
//   - panels over panels: two bordered or filled blocks overlapping without one holding the other;
//   - spills: an element running past its tile, or a box whose content is wider than it and shows;
//   - floating layers: absolutely or fixed positioned panels sitting over the module's content.
// Needs a build served locally and Playwright:
//
//   PLAYWRIGHT=/path/to/playwright-core/index.mjs node tools/audit-overlaps.mjs [http://127.0.0.1:3110/] [module ids…]
const playwright = await import(process.env.PLAYWRIGHT ?? "@playwright/test").catch(() => null);
if (!playwright) { console.error("Playwright is not installed here."); process.exit(2); }
const base = process.argv[2] ?? "http://127.0.0.1:3110/";
const only = new Set(process.argv.slice(3));
const PLACES = { forge: "Utah FORGE", kestrel: "Kestrel", force: "31/2-7" };
const SHOTS = [
  ["globe", null], ["site3d", "forge"], ["seismic", "forge"], ["attributes", "forge"], ["correlate", "force"], ["tie", "forge"], ["horizons", "forge"], ["volumetrics", "force"],
  ["logs", "forge"], ["petro", "force"], ["geomech", "forge"], ["stimulation", "forge"], ["window", "kestrel"],
  ["drilling", "forge"], ["rig", "kestrel"], ["torquedrag", "forge"], ["hydraulics", "kestrel"], ["kick", "kestrel"], ["anticollision", "forge"], ["plan", "forge"], ["profile", "forge"],
  ["designer", "kestrel"], ["construction", "forge"], ["section", "forge"], ["well3d", "forge"], ["cutaway", "forge"], ["strings", "kestrel"], ["cement", "kestrel"], ["barriers", "kestrel"],
  ["decline", null], ["nodal", "kestrel"], ["editor", "forge"], ["compare", "forge"],
];
const SIZES = (process.env.SIZES ?? "1440x1000,1280x800").split(",").map((s) => s.split("x").map(Number));

/** Runs in the page: everything wrong inside one tile. */
function inspect(id) {
  const tile = document.querySelector(`[data-module="${id}"]`);
  if (!tile) return { missing: true };
  const T = tile.getBoundingClientRect();
  const shown = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const cs = getComputedStyle(el); if (cs.visibility === "hidden" || Number(cs.opacity) < 0.05 || cs.display === "none") return false; let p = el; while (p && p !== tile) { const s = getComputedStyle(p); if (Number(s.opacity) < 0.05 || s.display === "none" || s.visibility === "hidden" || (s.clipPath !== "none" && s.clipPath !== "") || (p.getBoundingClientRect().width <= 1 && s.overflow !== "visible")) return false; p = p.parentElement; } return r.bottom > T.top && r.top < T.bottom && r.right > T.left && r.left < T.right; };
  const label = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : el.className?.baseVal ? "." + el.className.baseVal.split(/\s+/)[0] : ""}“${(el.textContent ?? "").trim().slice(0, 24)}”`;
  // A box clipped away by an ancestor (overflow hidden/auto) is not seen: only the visible part counts.
  const visibleRect = (el) => { let r = el.getBoundingClientRect(); let { left, top, right, bottom } = r; let p = el.parentElement; while (p && p !== document.body) { const s = getComputedStyle(p); if (s.overflow !== "visible" || s.overflowX !== "visible" || s.overflowY !== "visible") { const q = p.getBoundingClientRect(); left = Math.max(left, q.left); top = Math.max(top, q.top); right = Math.min(right, q.right); bottom = Math.min(bottom, q.bottom); } if (p === tile) break; p = p.parentElement; } return { left, top, right, bottom, w: right - left, h: bottom - top }; };
  const overlap = (a, b) => { const x = Math.min(a.right, b.right) - Math.max(a.left, b.left), y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); return x > 2 && y > 2 ? x * y : 0; };
  // Text leaves: HTML elements whose own text is not empty, and SVG text.
  const texts = [];
  for (const el of tile.querySelectorAll("*")) {
    if (el.closest(".tile-head, .sw-viewcube")) continue;
    const isSvgText = el instanceof SVGTextElement;
    const own = isSvgText ? el.textContent.trim() : [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
    if (!own || !shown(el)) continue;
    let rect;
    if (isSvgText) rect = visibleRect(el);
    else { const range = document.createRange(); range.selectNodeContents(el); const r = range.getBoundingClientRect(); rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; const v = visibleRect(el); rect = { left: Math.max(rect.left, v.left), top: Math.max(rect.top, v.top), right: Math.min(rect.right, v.right), bottom: Math.min(rect.bottom, v.bottom) }; }
    if (rect.right - rect.left < 2 || rect.bottom - rect.top < 2) continue;
    texts.push({ el, r: rect });
  }
  const textHits = [];
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j];
    if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const area = overlap(a.r, b.r), small = Math.min((a.r.right - a.r.left) * (a.r.bottom - a.r.top), (b.r.right - b.r.left) * (b.r.bottom - b.r.top));
    if (area > 0.15 * small) textHits.push(`${label(a.el)} × ${label(b.el)}`);
  }
  // Panels: blocks with their own background or border, not inside one another.
  const panels = [...tile.querySelectorAll("section, aside, figure, header, .nodal-card, [class*='card'], [class*='panel'], [class*='drawer'], [class*='popover'], [class*='menu'], [class*='legend'], [class*='hint']")].filter((el) => {
    if (el.closest(".tile-head") || !shown(el)) return false;
    const cs = getComputedStyle(el);
    return (cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.borderTopWidth !== "0px" || cs.backdropFilter !== "none") && el !== tile;
  }).map((el) => ({ el, r: visibleRect(el), floating: ["absolute", "fixed", "sticky"].includes(getComputedStyle(el).position) }));
  const panelHits = [];
  for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
    const a = panels[i], b = panels[j];
    if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const area = overlap(a.r, b.r), small = Math.min(a.r.w * a.r.h, b.r.w * b.r.h);
    if (area > 0.04 * small && area > 200) panelHits.push(`${a.floating ? "[float] " : ""}${label(a.el)} × ${b.floating ? "[float] " : ""}${label(b.el)}`);
  }
  // Spills: content wider than its box that shows (overflow visible), and anything past the tile.
  const spills = [];
  for (const el of tile.querySelectorAll("*")) {
    if (!(el instanceof HTMLElement) || el.closest(".sw-viewcube") || !shown(el)) continue;
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 3 && cs.overflowX === "visible" && el.clientWidth > 0 && !["SPAN", "B", "SMALL", "EM", "I", "LABEL", "BUTTON", "A"].includes(el.tagName)) spills.push(`${label(el)} ${el.scrollWidth}>${el.clientWidth}`);
  }
  return { texts: [...new Set(textHits)].slice(0, 12), panels: [...new Set(panelHits)].slice(0, 12), spills: [...new Set(spills)].slice(0, 8) };
}

const browser = await playwright.chromium.launch({ args: ["--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"] });
const report = [];
for (const [W, H] of SIZES) {
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, colorScheme: "dark" })).newPage();
  const command = async (text) => { await page.keyboard.press("Meta+k"); await page.waitForTimeout(200); await page.keyboard.type(text); await page.waitForTimeout(300); await page.keyboard.press("Enter"); };
  await page.goto(`${base}deck/`); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForSelector("[data-testid='wells-map'][data-ready='true']", { timeout: 60000 });
  let at = null;
  for (const [id, place] of SHOTS) {
    if (only.size && !only.has(id)) continue;
    if (place && place !== at) { await command(PLACES[place]); await page.waitForTimeout(4000); at = place; }
    await page.locator(`.dock-item[data-id="${id}"]`).click();
    await page.mouse.move(W / 2, H - 10);
    await page.waitForTimeout(3500);
    for (const state of ["tile", "expanded"]) {
      const expanded = await page.locator(`[data-module="${id}"] .tile-action[aria-pressed='true']`).count();
      if (state === "expanded" && !expanded) { await page.locator(`[data-module="${id}"] .tile-action[aria-pressed='false']`).first().click().catch(() => undefined); await page.waitForTimeout(1500); }
      if (state === "tile" && expanded) { await page.keyboard.press("Escape"); await page.waitForTimeout(1200); }
      // Each lens (a module's tabs) is its own view: checked one by one.
      const tabs = await page.locator(`[data-module="${id}"] [role=tablist] [role=tab]`).allTextContents();
      for (const tab of tabs.length ? tabs : [null]) {
        if (tab !== null) { await page.locator(`[data-module="${id}"] [role=tablist] [role=tab]`, { hasText: tab }).first().click().catch(() => undefined); await page.waitForTimeout(1200); }
        const found = await page.evaluate(inspect, id);
        const name = `${W}×${H} ${id} ${state}${tab ? ` · ${tab.trim()}` : ""}`;
        if (found.missing) { report.push(`${name}: did not open`); console.log(report.at(-1)); continue; }
        const n = found.texts.length + found.panels.length + found.spills.length;
        if (n) report.push(`${name}:\n${[...found.texts.map((t) => `  text   ${t}`), ...found.panels.map((t) => `  panel  ${t}`), ...found.spills.map((t) => `  spill  ${t}`)].join("\n")}`);
        else report.push(`${name}: clean`);
        console.log(report.at(-1));
      }
    }
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    await page.evaluate(() => { for (const el of [...document.querySelectorAll("[data-module]")]) el.querySelector(".tile-action[aria-label^='Close']")?.click(); });
    await page.waitForTimeout(400);
  }
  await page.close();
}
await browser.close();
const dirty = report.filter((line) => !/: clean$/.test(line)).length;
console.log(`\n${dirty} module states with something on top of something else.`);
process.exitCode = dirty ? 1 : 0;
