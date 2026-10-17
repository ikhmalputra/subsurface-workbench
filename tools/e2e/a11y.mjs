#!/usr/bin/env node
// Accessibility sweep with axe-core over the landing page, the Developers page and the deck in its
// main states, at 1440 × 1000: zero serious or critical findings against WCAG 2.2 AA fails the
// run. Findings go to output/reports/a11y.json with the selectors and the rule's help page.
//
//   node tools/e2e/a11y.mjs http://localhost:3200/        # a served build (tools/serve.mjs)
//   node tools/e2e/a11y.mjs http://localhost:3200/ --all   # every tool, not only the main states
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const playwright = await import(process.env.PLAYWRIGHT ?? "@playwright/test").catch(() => null);
if (!playwright) { console.error("Playwright is not installed here."); process.exit(2); }
const base = process.argv[2] ?? "http://localhost:3200/";
const all = process.argv.includes("--all");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const out = new URL("../../output/reports/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await playwright.chromium.launch({ args: ["--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
// axe goes in as an init script: the served pages' CSP allows no inline script, and an init script is not subject to it.
await context.addInitScript({ content: axeSource });
const page = await context.newPage();
const command = async (text) => { await page.keyboard.press("Meta+k"); await page.waitForTimeout(200); await page.keyboard.type(text); await page.waitForTimeout(300); await page.keyboard.press("Enter"); await page.waitForTimeout(1500); };
const results = [];
/** Runs axe on the page as it is, keeping serious and critical findings; moderate and minor are reported but do not fail. */
async function audit(state) {
  const result = await page.evaluate(async () => {
    const run = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] });
    return run.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.slice(0, 6).map((n) => ({ target: n.target.join(" "), summary: n.failureSummary?.split("\n").slice(1, 3).join(" ").trim() })) }));
  });
  const serious = result.filter((v) => v.impact === "serious" || v.impact === "critical");
  results.push({ state, violations: result, serious: serious.length });
  console.log(`${serious.length ? "FAIL" : "ok  "} ${state}: ${result.length} finding${result.length === 1 ? "" : "s"}, ${serious.length} serious${serious.length ? `\n${serious.map((v) => `     ${v.impact} ${v.id}: ${v.help}\n${v.nodes.map((n) => `       ${n.target}${n.summary ? ` — ${n.summary}` : ""}`).join("\n")}`).join("\n")}` : ""}`);
}

await page.goto(`${base}`); await page.waitForTimeout(2500); await audit("landing");
await page.goto(`${base}developers/`); await page.waitForTimeout(2500); await audit("developers");
await page.goto(`${base}deck/`); await page.evaluate(() => localStorage.clear()); await page.reload();
// The globe settles its intro move about two seconds after it is ready; labels are decluttered then.
await page.waitForSelector("[data-testid='wells-map'][data-ready='true']", { timeout: 60000 }); await page.waitForTimeout(3500);
await audit("deck: the world");
await page.keyboard.press("Meta+k"); await page.waitForTimeout(400); await audit("deck: command palette open"); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
await command("FORGE"); await page.waitForTimeout(4000); await audit("deck: FORGE, opening tiles");
const tools = all ? await page.evaluate(() => [...document.querySelectorAll(".dock-item[data-id]")].map((el) => el.getAttribute("data-id"))) : ["site3d", "sources", "logs", "integrity", "plan"];
for (const id of tools) {
  const item = page.locator(`.dock-item[data-id="${id}"]`);
  if (!(await item.count())) continue;
  await item.click(); await page.waitForTimeout(2500);
  const expand = page.locator(`[data-module="${id}"] .tile-action[aria-pressed='false']`).first();
  if (await expand.count()) { await expand.click(); await page.waitForTimeout(1500); }
  await audit(`deck: ${id} expanded`);
  await page.keyboard.press("Escape"); await page.waitForTimeout(600);
}
await browser.close();

const serious = results.reduce((n, r) => n + r.serious, 0);
const total = results.reduce((n, r) => n + r.violations.length, 0);
writeFileSync(`${out}a11y.json`, JSON.stringify({ at: new Date().toISOString(), base, serious, total, results }, null, 2));
console.log(`\n${results.length} states, ${total} findings, ${serious} serious or critical. Report: output/reports/a11y.json`);
process.exit(serious ? 1 : 0);
