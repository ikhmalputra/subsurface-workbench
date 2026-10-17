#!/usr/bin/env node
// Sign-in end to end against the mock identity provider (tools/mock-osdu/idp.mjs): the code flow
// with PKCE, what the browser keeps, forged callbacks, refresh under a short token life, a clock
// four minutes off, the provider's session ending, and the silent-redirect loop guard.
//
//   node tools/e2e/auth.mjs                # report: output/reports/auth.json
import { mkdirSync, writeFileSync } from "node:fs";
import { authStatus, launch, openDeck, openSources, signIn, sourcesListed, startStand, wait } from "../stress/harness.mjs";

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const storageDump = (page) => page.evaluate(() => ({ local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage), url: location.href, history: history.length, cookies: document.cookie }));
const browser = await launch();
const tokenLike = /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/;
let stand;
try {
  // A. The flow, and what the browser keeps.
  stand = await startStand({ profile: "clean", wells: 100, perField: 50, stations: 30, ports: 4140, tokenTtlS: 6 });
  let context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
  let page = await openDeck(context, stand.base);
  const before = await authStatus(page);
  check("before sign-in the source needs it", /sign-in needed|not signed in/.test(before), before);
  const tokenCalls = [];
  page.on("request", (request) => { if (request.url().startsWith(stand.issuer) && request.url().endsWith("/token")) tokenCalls.push({ at: Date.now(), body: request.postData() ?? "" }); });
  await signIn(page);
  check("signed in through the provider", /signed in as/.test(await authStatus(page)), await authStatus(page));
  check("the code was exchanged with PKCE once", tokenCalls.filter((c) => /grant_type=authorization_code/.test(c.body)).length === 1 && tokenCalls.every((c) => !/client_secret/.test(c.body)) && /code_verifier=/.test(tokenCalls[0]?.body ?? ""), `${tokenCalls.length} token calls`);
  const kept = await storageDump(page);
  check("no token in storage, URL, cookie or history", !tokenLike.test(kept.local) && !tokenLike.test(kept.session) && !/code=|access_token|id_token/.test(kept.url) && !tokenLike.test(kept.cookies) && !/deck-auth:pending/.test(kept.session), `url ${kept.url.slice(-40)}, session ${kept.session.slice(0, 60)}`);
  check("the address bar was cleaned", /\/deck\/?$/.test(kept.url), kept.url);
  const listed = await sourcesListed(page);
  check("the platform is read with the person's token", /\b100\b/.test(listed.join(" ")), listed.join(" | "));

  // B. Refresh under a 6 s token: many refreshes, one at a time, no prompt.
  const t0 = Date.now();
  await wait(45000);
  const refreshes = tokenCalls.filter((c) => c.at > t0 && /grant_type=refresh_token/.test(c.body));
  const overlapping = refreshes.filter((c, i) => i > 0 && c.at - refreshes[i - 1].at < 30).length;
  check("refreshed on its own, repeatedly", refreshes.length >= 5, `${refreshes.length} refreshes in 45 s with a 6 s token`);
  check("one refresh at a time", overlapping === 0, `${overlapping} overlapping`);
  check("still signed in, no prompt", /signed in as/.test(await authStatus(page)), await authStatus(page));
  check("no page errors", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));

  // C. A reload loses the tokens by design; the provider's session restores them silently.
  // The provider answers /authorize with an immediate redirect, so the page never commits there: count the requests.
  const silentRequests = (target) => { const urls = []; target.on("request", (request) => { if (request.isNavigationRequest() && request.url().startsWith(stand.issuer) && /\/authorize\?.*prompt=none/.test(request.url())) urls.push(request.url()); }); return urls; };
  const reloads = silentRequests(page);
  await page.reload(); await page.waitForSelector("[data-testid='wells-map'][data-ready='true']", { timeout: 60000 });
  await openSources(page);
  await page.waitForFunction(() => /signed in as/.test(document.querySelector('[data-module="sources"] .ds-auth-row small')?.textContent ?? ""), null, { timeout: 30000 }).catch(() => {});
  check("silent sign-in after a reload", /signed in as/.test(await authStatus(page)) && reloads.length >= 1, `${reloads.length} silent redirect(s); ${await authStatus(page)}`);

  // D. A forged callback: a state this browser never made is refused, nothing exchanged.
  const exchangesBefore = tokenCalls.filter((c) => /authorization_code/.test(c.body)).length;
  await page.goto(`${stand.base}deck/?code=forged&state=not-ours`); await page.waitForSelector("[data-testid='wells-map'][data-ready='true']", { timeout: 60000 });
  await wait(1500);
  check("a forged callback is refused without an exchange", tokenCalls.filter((c) => /authorization_code/.test(c.body) && /code=forged/.test(c.body)).length === 0 && tokenCalls.filter((c) => /authorization_code/.test(c.body)).length === exchangesBefore + 0, `${tokenCalls.length} token calls`);
  check("the forged callback's address was cleaned", !/code=forged/.test(page.url()), page.url());

  // E. The provider's session ends: the next silent attempt fails, Sign in is offered, and the loop guard holds.
  await page.goto(`${stand.issuer}/logout?post_logout_redirect_uri=${encodeURIComponent(`${stand.base}`)}`); await wait(500);
  const navs = silentRequests(page);
  await page.goto(`${stand.base}deck/`); await page.waitForSelector("[data-testid='wells-map'][data-ready='true']", { timeout: 60000 });
  await openSources(page); await wait(2500);
  await page.reload(); await page.waitForSelector("[data-testid='wells-map'][data-ready='true']", { timeout: 60000 }); await openSources(page); await wait(2500);
  await page.reload(); await page.waitForSelector("[data-testid='wells-map'][data-ready='true']", { timeout: 60000 }); await openSources(page); await wait(2500);
  const silent = navs.length;
  const after = await authStatus(page);
  check("session ended: sign-in offered, not looped", /sign-in needed|Signed out|not signed in/.test(after) && silent >= 1 && silent <= 2 && (await page.locator('[data-module="sources"] .ds-auth-row button', { hasText: "Sign in" }).count()) === 1, `${silent} silent redirect(s) over three loads; ${after}`);
  await context.close();
  await stand.stop(); stand = null;

  // F. A clock four minutes off, either way, still signs in.
  for (const skew of [240, -240]) {
    // Two-minute tokens from a clock four minutes off: already expired, or issued in the future, by more
    // than the library's default 30 s tolerance; only the deck's five minutes lets them through.
    stand = await startStand({ profile: "clean", wells: 60, perField: 30, stations: 30, ports: 4140, tokenTtlS: 120, clockSkewS: skew });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
    page = await openDeck(context, stand.base);
    let ok = true, why = "";
    try { await signIn(page, { timeoutMs: 30000 }); } catch (error) { ok = false; why = String(error).slice(0, 120); }
    check(`clock skew ${skew > 0 ? "+" : ""}${skew} s: signed in`, ok && /signed in as/.test(await authStatus(page)), why || await authStatus(page));
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
writeFileSync(new URL("../../output/reports/auth.json", import.meta.url).pathname, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length} checks, ${failed} failed. Report: output/reports/auth.json`);
process.exit(failed ? 1 : 0);
