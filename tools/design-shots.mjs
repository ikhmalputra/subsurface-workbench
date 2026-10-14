// Screenshots and an accessibility sweep of the running app — a design aid, not a gate.
//
// The end-to-end suite was removed because passing it had become the goal. What it was genuinely
// good at, and what nothing else does, is telling you whether the thing you just styled is legible
// in all three themes: it caught white-on-indigo in dark and a grey caption on the graphite bar,
// both of which look fine until you check. So that part survives as a script you run when you want
// to look at the app, and nothing runs it for you.
//
//   pnpm dev        (in one terminal)
//   pnpm design     (in another)
//
// Shots land in output/design/, which is gitignored.
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.DESIGN_URL ?? "http://localhost:3000";
const OUT = "output/design";
const VIEWPORT = { width: 1440, height: 1000 };
const Axe = AxeBuilder.default ?? AxeBuilder;

/** The states worth looking at. Add one here rather than taking ad-hoc captures. */
const SHOTS = [
  { name: "landing", url: "/" },
  { name: "sheet", url: "/view-well/" },
  { name: "tools", url: "/view-well/", act: openCatalogue },
  { name: "tool-open", url: "/view-well/", act: async (page) => { await openCatalogue(page); await openTool(page, "Hydraulics"); } },
];

async function openCatalogue(page) {
  await page.getByRole("navigation", { name: "Well browser" }).getByRole("tab", { name: "Tools", exact: true }).click();
  await page.waitForTimeout(500);
}
async function openTool(page, name) {
  await page.locator('[data-testid="tool-catalogue"]').getByRole("button", { name, exact: true }).click();
  await page.waitForTimeout(1200);
}
/** The theme lives on a div inside the provider, not on the document element. */
const setTheme = (page, theme) => page.evaluate((value) => {
  document.querySelector("[data-sw-theme]")?.setAttribute("data-sw-theme", value);
}, theme);

async function settle(page, url) {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
  // Every route is prerendered, so the markup paints before React attaches a handler; the frame
  // sets this once its effects have run.
  await page.waitForSelector("html[data-sw-hydrated='true']", { timeout: 30_000 });
  await page.waitForTimeout(2_500);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEWPORT });
await mkdir(OUT, { recursive: true });
let failures = 0;

for (const shot of SHOTS) {
  const page = await context.newPage();
  await settle(page, shot.url);
  if (shot.act) await shot.act(page);
  for (const theme of ["light", "dark", "high-contrast"]) {
    await setTheme(page, theme);
    await page.waitForTimeout(400);
    const file = `${OUT}/${shot.name}-${theme}.png`;
    await page.screenshot({ path: file });
    const { violations } = await new Axe({ page }).analyze();
    if (violations.length) {
      failures += violations.length;
      console.log(`${shot.name} · ${theme}  ${violations.length} violation(s)`);
      for (const violation of violations) {
        console.log(`    ${violation.id} ×${violation.nodes.length} — ${violation.nodes[0]?.target?.join(" ")}`);
      }
    } else {
      console.log(`${shot.name} · ${theme}  clean  →  ${file}`);
    }
  }
  await page.close();
}

await browser.close();
console.log(failures ? `\n${failures} accessibility violation(s).` : "\nNo accessibility violations.");
process.exit(failures ? 1 : 0);
