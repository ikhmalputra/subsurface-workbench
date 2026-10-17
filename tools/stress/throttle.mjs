#!/usr/bin/env node
// The deck on a slow machine and a slow link (Chromium's CPU throttling and network conditions),
// on the mock platform. Budgets in tools/budgets.mjs `network`:
// - CPU 4× slower: the globe ready in time, no main-thread stall over the budget;
// - a VPN (5 Mbit/s, 80 ms): a 200-well field ready in time;
// - a poor link (400 kbit/s, 400 ms): the field ready in time, with progress visible on the way;
// - the heap within budget throughout; zero page errors.
//
//   node tools/stress/throttle.mjs         # report: output/reports/throttle.json
//   node tools/stress/throttle.mjs cpu4x   # one condition (cpu4x, vpn, poor, poor-uncompressed)
import { mkdirSync, writeFileSync } from "node:fs";
import { BUDGETS } from "../budgets.mjs";
import { fieldButton, fieldText, launch, mark, openDeck, reading, signIn, sourcesListed, startStand, worstStalls } from "./harness.mjs";

const B = BUDGETS.network;
// The platform compresses its JSON (gzip), as the client checklist in docs/IDP_GUIDE.md asks. The
// poor link is also run against a platform that does not: measured and reported, not budgeted,
// since a 200-well field is 2.8 MB uncompressed, a minute at 400 kbit/s whatever the deck does.
const VPN = { offline: false, latency: 80, downloadThroughput: 5e6 / 8, uploadThroughput: 2e6 / 8 };
const POOR = { offline: false, latency: 400, downloadThroughput: 4e5 / 8, uploadThroughput: 1e5 / 8 };
const CONDITIONS = {
  cpu4x: { cpu: 4, network: null, gzip: true, budgeted: true, fieldBudget: B.fieldVpnMs },
  vpn: { cpu: 1, network: VPN, gzip: true, budgeted: true, fieldBudget: B.fieldVpnMs },
  poor: { cpu: 1, network: POOR, gzip: true, budgeted: true, fieldBudget: B.fieldPoorMs },
  "poor-uncompressed": { cpu: 1, network: POOR, gzip: false, budgeted: false, fieldBudget: Infinity },
};
const results = [], measures = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const browser = await launch();
let stand = null;
try {
  const only = process.argv.slice(2);
  for (const [name, condition] of Object.entries(CONDITIONS).filter(([n]) => !only.length || only.includes(n))) {
    stand = await startStand({ profile: "clean", wells: 1000, perField: 200, stations: 120, ports: 4120, gzip: condition.gzip });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: condition.cpu });
    if (condition.network) { await cdp.send("Network.enable"); await cdp.send("Network.emulateNetworkConditions", condition.network); }
    await page.close();
    // The stand's page helpers open their own page; throttling is per page, so apply it there too.
    const deck = await openDeck(context, stand.base, { ready: false });
    const session = await context.newCDPSession(deck);
    await session.send("Emulation.setCPUThrottlingRate", { rate: condition.cpu });
    if (condition.network) { await session.send("Network.enable"); await session.send("Network.emulateNetworkConditions", condition.network); }
    const t0 = Date.now();
    await deck.reload();
    await deck.waitForSelector("[data-testid='wells-map'][data-ready='true']", { timeout: 180000 });
    const globeMs = Date.now() - t0;
    if (name === "cpu4x") check(`${name}: globe ready`, globeMs <= B.globeReadyMs, `${globeMs} ms (budget ${B.globeReadyMs})`);
    else console.log(`     ${name}: globe ready in ${globeMs} ms`);
    await mark(deck, "globe ready → sign in");
    await signIn(deck, { timeoutMs: 120000 });
    await mark(deck, "signed in → listing");
    await sourcesListed(deck, { timeoutMs: 180000 });
    await mark(deck, "listed → open field");
    const button = await fieldButton(deck, 0);
    const tField = Date.now();
    await button.click();
    // On the poor link, sample the field's row while it reads: the reader must see progress, not a frozen row.
    const seen = [];
    let fieldText_ = "";
    for (;;) {
      const sample = await fieldText(deck, 0).catch(() => "");
      if (sample) { seen.push(sample.replace(/\d[\d,]*/g, "#")); fieldText_ = sample; }
      if (sample && !/· reading/.test(sample) && Date.now() - tField > 300) break;
      if (Date.now() - tField > 240000) break;
      await deck.waitForTimeout(250);
    }
    const fieldMs = Date.now() - tField;
    if (condition.budgeted) check(`${name}: 200-well field ready`, fieldMs <= condition.fieldBudget, `${fieldMs} ms (budget ${condition.fieldBudget})`);
    else { measures.push({ name, fieldMs }); console.log(`     ${name}: 200-well field ready in ${fieldMs} ms (measured, not budgeted)`); }
    if (condition.network === POOR) check("poor: progress visible while reading", new Set(seen.filter((text) => /reading # of #/.test(text))).size >= 1 && seen.some((text) => /reading/.test(text)), [...new Set(seen)].join(" | ").slice(0, 300));
    check(`${name}: field read whole`, !/could not|None of/.test(fieldText_), fieldText_.replace(/\n/g, " ").slice(0, 120));
    await mark(deck, "field read → site in 3D");
    await deck.locator('.dock-item[data-id="site3d"]').click().catch(() => {});
    await deck.waitForTimeout(4000);
    // Only the selected well's picks are labelled, so only its labels are made: none with no well selected, never one per pick in the field.
    const picks = await deck.locator("[data-testid='site-scene'] .sw-scene-label.is-pick:not(.is-cursor)").count();
    const selected = await deck.locator("[data-testid='site-scene']").getAttribute("data-selected-well").catch(() => "");
    const names = await deck.locator("[data-testid='site-scene'] .sw-scene-label.is-well").count();
    check(`${name}: pick labels for the selected well only`, names > 0 && picks <= (selected ? 40 : 0), `${names} well names, ${picks} pick labels, ${selected ? `well ${selected} selected` : "no well selected"}`);
    const measured = await reading(deck);
    check(`${name}: worst stall`, measured.worstStallMs <= B.longTaskMs, `${measured.worstStallMs} ms over ${measured.stalls} stalls (budget ${B.longTaskMs}); worst: ${(await worstStalls(deck, 4)).join("; ")}`);
    check(`${name}: heap`, measured.heapMB <= B.heapMB, `${measured.heapMB} MB (budget ${B.heapMB})`);
    check(`${name}: zero page errors`, deck.errors.length === 0, deck.errors.slice(0, 3).join(" | "));
    await context.close();
    await stand.stop(); stand = null;
  }
} catch (error) {
  check("the run itself", false, String(error).slice(0, 400));
} finally {
  await browser.close().catch(() => {});
  if (stand) await stand.stop();
}
mkdirSync(new URL("../../output/reports/", import.meta.url).pathname, { recursive: true });
writeFileSync(new URL("../../output/reports/throttle.json", import.meta.url).pathname, JSON.stringify({ at: new Date().toISOString(), budgets: B, results, measures }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length} checks, ${failed} failed. Report: output/reports/throttle.json`);
process.exit(failed ? 1 : 0);
