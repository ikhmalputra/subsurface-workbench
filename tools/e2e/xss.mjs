#!/usr/bin/env node
// Script injection through data: the mock platform's `hostile` profile serves names, fields,
// operators and markers holding HTML, SVG event handlers, javascript: URLs, template expressions,
// right-to-left and zero-width text, a 100,000-character name, ids `__proto__` and `constructor`,
// and a trajectory whose numbers are not JSON. The deck lists, draws, searches and shares them.
// What must hold: `window.__xss` is never called; zero Content-Security-Policy violations; no
// element gains an `on*` attribute or a `javascript:` URL; `Object.prototype` is untouched; zero
// page errors; the deck is still usable afterwards.
//
//   node tools/e2e/xss.mjs                 # report: output/reports/xss.json
import { mkdirSync, writeFileSync } from "node:fs";
import { launch, openDeck, openField, openSources, problemLines, reading, signIn, sourcesListed, startStand, wait } from "../stress/harness.mjs";

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const stand = await startStand({ profile: "hostile", wells: 120, perField: 40, stations: 60, ports: 4130 });
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const domClean = (page) => page.evaluate(() => {
  const handlers = [...document.querySelectorAll("*")].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name))).map((el) => el.tagName).slice(0, 5);
  const scriptUrls = [...document.querySelectorAll("[href], [src], [xlink\\:href]")].filter((el) => /^\s*javascript:/i.test(el.getAttribute("href") ?? el.getAttribute("src") ?? el.getAttribute("xlink:href") ?? "")).length;
  const injected = document.querySelectorAll("img[src='x'], svg[onload]").length;
  return { handlers, scriptUrls, injected, polluted: "polluted" in {} || Object.keys(Object.prototype).length > 0, title: document.title };
});
try {
  // The detectors first: a hostile name put in with innerHTML, in a scratch page under the same CSP,
  // must be caught (a CSP violation and an on* attribute). Otherwise a clean run below proves nothing.
  const scratch = await openDeck(context, stand.base, { ready: false });
  await scratch.evaluate(() => { const probe = document.createElement("div"); probe.id = "xss-probe"; probe.innerHTML = "<img src=x onerror=__xss()>"; document.body.append(probe); });
  await wait(800);
  const probe = await reading(scratch), probeDom = await domClean(scratch);
  check("the detectors catch a planted injection", probe.cspViolations.length > 0 && probeDom.handlers.length > 0 && probeDom.injected > 0, `${probe.cspViolations.length} CSP violation(s), on* on ${probeDom.handlers.join(",")}, ${probeDom.injected} injected`);
  await scratch.close();

  const page = await openDeck(context, stand.base);
  await signIn(page);
  const listed = await sourcesListed(page);
  check("hostile tenant listed", /\b120\b/.test(listed.join(" ")), listed.join(" | "));

  // Every well's name in the list, including the 100,000-character one and the __proto__ id.
  const tool = await openSources(page);
  const names = await tool.locator(".ds-row:not(.ds-head):not(.ds-field) .ds-open").allInnerTexts();
  check("hostile names drawn as text", names.some((n) => /<img|<svg|onerror|__proto__|constructor/.test(n)), `${names.length} rows, e.g. ${names.find((n) => /</.test(n))?.slice(0, 60)}`);

  // Open the hostile field: the 3D site, the plan and the profile draw it; the NaN trajectory is a stated problem.
  const field = await openField(page, { nth: 0 }, { timeoutMs: 120000 });
  check("hostile field read", !/None of/.test(field.text), field.text.slice(0, 120));
  for (const id of ["site3d", "plan", "profile"]) { await page.locator(`.dock-item[data-id="${id}"]`).click(); await wait(2500); }
  const problems = (await problemLines(page)).join("\n");
  check("the not-JSON trajectory is a stated problem", /JSON|not be read|parse|shape/i.test(problems), problems.split("\n").find((l) => /JSON|read|shape/i.test(l))?.slice(0, 160));

  // Search for the hostile names, hover the globe, open the share dialog.
  await page.keyboard.press("Meta+k"); await wait(300); await page.keyboard.type("<img src=x"); await wait(600);
  const hits = await page.locator("[cmdk-item]").count();
  await page.keyboard.press("Escape"); await wait(300);
  check("command search survives hostile text", page.errors.length === 0, `${hits} hits`);
  await page.locator(".sw-wells-map").hover({ position: { x: 300, y: 300 } }).catch(() => {});
  const share = page.locator("button", { hasText: "Share" }).first();
  if (await share.count()) {
    await share.click(); await wait(1500);
    const link = await page.locator("#share-link").inputValue().catch(() => "");
    // The payload is deflated JSON in base64url: decoded here, so a well's name or record would be seen if it travelled.
    const payload = await page.evaluate(async (href) => {
      const match = /#deck=([A-Za-z0-9_-]+)$/.exec(href); if (!match) return null;
      const b64 = match[1].replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(b64 + "=".repeat((4 - b64.length % 4) % 4));
      const stream = new Blob([Uint8Array.from(bin, (c) => c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return JSON.parse(await new Response(stream).text());
    }, link);
    const text = JSON.stringify(payload ?? {});
    check("share link holds no well data", payload !== null && payload.carried === null && !/<img|<svg|onerror|__xss|javascript:/.test(text), `${link.length} characters; carried ${JSON.stringify(payload?.carried ?? null).slice(0, 40)}; site ${JSON.stringify(payload?.site ?? null).slice(0, 80)}`);
    await page.keyboard.press("Escape");
  }

  await page.locator(`.dock-item[data-id="sources"]`).click(); await wait(500);
  const dom = await domClean(page);
  const measured = await reading(page);
  check("__xss never called", measured.xssCalls === 0, `${measured.xssCalls} calls`);
  check("zero CSP violations", measured.cspViolations.length === 0, measured.cspViolations.slice(0, 3).join(" | "));
  check("no on* attributes from data", dom.handlers.length === 0, dom.handlers.join(","));
  check("no javascript: URLs, no injected elements", dom.scriptUrls === 0 && dom.injected === 0, `${dom.scriptUrls} urls, ${dom.injected} elements`);
  check("Object.prototype untouched", !dom.polluted);
  check("zero page errors", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
  check("still usable: title intact and a tool opens", /Subsurface/.test(dom.title) && (await page.locator('[data-module="sources"]').count()) > 0, dom.title);
} catch (error) {
  check("the run itself", false, String(error).slice(0, 400));
} finally {
  await browser.close().catch(() => {});
  await stand.stop();
}
mkdirSync(new URL("../../output/reports/", import.meta.url).pathname, { recursive: true });
writeFileSync(new URL("../../output/reports/xss.json", import.meta.url).pathname, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length} checks, ${failed} failed. Report: output/reports/xss.json`);
process.exit(failed ? 1 : 0);
