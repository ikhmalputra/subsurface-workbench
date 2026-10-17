#!/usr/bin/env node
// Fault injection against the deck on the mock platform (tools/mock-osdu, admin fault API):
// latency, 5xx, 429 with Retry-After, expired cursors, connection resets, trickled bodies, bodies
// that are not JSON, and a 401 storm. What must hold:
// - zero page errors throughout;
// - a 200-well field is ready within the budget at 50 ms latency, in a bounded number of requests,
//   never more than the source's concurrency in flight;
// - every failure is shown in Data sources within 5 s, in words;
// - 429s are retried after Retry-After, never before;
// - leaving a field aborts its reads;
// - a storm of 401s causes a single refresh at a time.
//
//   node tools/stress/faults.mjs            # report: output/reports/faults.json
import { mkdirSync, writeFileSync } from "node:fs";
import { BUDGETS } from "../budgets.mjs";
import { fieldButton, launch, openDeck, openField, openSection, problemLines, reading, signIn, sourcesListed, startStand, until, wait } from "./harness.mjs";

const B = BUDGETS.faults;
const PER_FIELD = 200;
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const stand = await startStand({ profile: "clean", wells: 1200, perField: PER_FIELD, stations: 120, ports: 4110, cursorTtlS: 60 });
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
let page;
try {
  page = await openDeck(context, stand.base);
  await signIn(page);
  const listed = await sourcesListed(page);
  check("listed on sign-in", /1,200/.test(listed.join(" ")), listed.join(" | "));

  // 1. A field at 50 ms latency: time, requests and concurrency against the budget.
  await stand.reset(); await stand.faults({ route: "*", latencyMs: 50 });
  const first = await openField(page, 0);
  const log = await stand.log();
  check("field ready in time", first.ms <= B.fieldReadyMs, `${first.ms} ms (budget ${B.fieldReadyMs})`);
  check("bounded requests", log.total.requests <= B.baseRequests + B.requestsPerWell * PER_FIELD, `${log.total.requests} requests for ${PER_FIELD} wells (budget ${B.baseRequests + B.requestsPerWell * PER_FIELD})`);
  check("in flight within the source's concurrency", log.concurrency.peak <= B.inFlight, `peak ${log.concurrency.peak} (budget ${B.inFlight})`);
  check("field read whole", !/could not|·\s*\d+ of/.test(first.text), first.text);

  // 2. Server errors on the bulk data: retried, and what still fails is said in words within 5 s.
  await stand.reset(); await stand.faults({ route: "trajectory", rate5xx: 0.3 });
  const second = await openField(page, 1);
  const log2 = await stand.log();
  check("5xx retried", (log2.routes.trajectory.statuses["200"] ?? 0) >= PER_FIELD * 0.9 && log2.routes.trajectory.requests > PER_FIELD, `${log2.routes.trajectory.requests} requests, ${log2.routes.trajectory.statuses["200"] ?? 0} ok`);
  // Each well whose path never came back is named in "Left out or flagged", one line each, in words.
  const pathsMissing = PER_FIELD - (log2.routes.trajectory.statuses["200"] ?? 0);
  const pathLines = (await problemLines(page)).filter((line) => /path could not be read/.test(line));
  check("each path that failed is said", pathLines.length === pathsMissing, `${pathsMissing} paths never served; ${pathLines.length} said, e.g. ${pathLines[0]?.slice(0, 120) ?? "—"}`);

  // 3. 429 with Retry-After on search: honoured, never jumped.
  await stand.reset(); await stand.faults({ route: "search", rate429: 0.5, retryAfterS: 1 });
  await (await openSection(page, "Sources")).locator(".ds-refresh", { hasText: "Read again" }).click();
  await sourcesListed(page, { timeoutMs: 120000 });
  const log3 = await stand.log();
  check("Retry-After honoured", log3.total.retryAfter.sent > 0 && log3.total.retryAfter.honoured > 0 && log3.total.retryAfter.ignored === 0, JSON.stringify(log3.total.retryAfter));
  const relisted = await sourcesListed(page);
  check("listed again after 429s", /1,200/.test(relisted.join(" ")), relisted.join(" | "));

  // 4. Expired cursors: the source says so within 5 s.
  await stand.reset(); await stand.faults({ route: "search", expireCursors: true });
  const t4 = Date.now();
  await (await openSection(page, "Sources")).locator(".ds-refresh", { hasText: "Read again" }).click();
  const said = await until(async () => { const text = (await problemLines(page)).join("\n"); return /cursor/i.test(text) ? text : null; }, { timeoutMs: B.shownWithinMs + 5000, what: "the cursor problem" }).catch(() => null);
  check("expired cursor shown within 5 s", said !== null && Date.now() - t4 <= B.shownWithinMs + 2000, said ? `${Date.now() - t4} ms: ${said.split("\n").find((l) => /cursor/i.test(l))}` : "not shown");
  await stand.reset(); await (await openSection(page, "Sources")).locator(".ds-refresh", { hasText: "Read again" }).click(); await sourcesListed(page, { timeoutMs: 120000 });

  // 5. Leaving a field aborts its reads: trickled bulk data, then another field.
  await stand.reset(); await stand.faults({ route: "trajectory", trickleBytesPerS: 400 });
  await (await fieldButton(page, 2)).click(); await wait(3000);
  await (await fieldButton(page, 3)).click(); await wait(3000);
  const log5 = await stand.log();
  check("leaving a field aborts its reads", log5.total.aborted > 0, `${log5.total.aborted} aborted`);
  await stand.reset();

  // 6. A storm of 401s: one refresh at a time, and the field still reads.
  // Refreshes in flight at once, from the browser's own request events: sequential ones may follow closely, concurrent ones must not exist.
  const tokenRequests = [];
  let tokenInFlight = 0, tokenPeak = 0;
  const isToken = (request) => request.url().startsWith(stand.issuer) && request.url().endsWith("/token");
  page.on("request", (request) => { if (isToken(request)) { tokenRequests.push(Date.now()); tokenInFlight++; tokenPeak = Math.max(tokenPeak, tokenInFlight); } });
  const settled = (request) => { if (isToken(request)) tokenInFlight--; };
  page.on("requestfinished", settled); page.on("requestfailed", settled);
  await stand.faults({ route: "*", storm401: 0.3 });
  const sixth = await openField(page, 4, { timeoutMs: 180000 });
  const log6 = await stand.log();
  // Refreshes may follow one another; two in flight at once would be two within the provider's round trip.
  const storm = log6.total.statuses["401"] ?? 0;
  check("401 storm: one refresh in flight at a time", tokenRequests.length > 0 && tokenPeak === 1, `${tokenRequests.length} refreshes, at most ${tokenPeak} in flight; ${storm} × 401`);
  // A 401 for a token already replaced is retried with the current one, not refreshed again.
  check("401 storm: fewer refreshes than 401s", tokenRequests.length < storm, `${tokenRequests.length} refreshes for ${storm} × 401`);
  // A persistent stream of 401s can cost whole batches; the deck must finish and say why, never hang or hide it.
  check("401 storm: the field finishes, and what failed is said", !/· reading/.test(sixth.text) && (!/could not/.test(sixth.text) || /could not be read \(Sign-in expired/.test(sixth.text)), sixth.text.replace(/\n/g, " "));
  await stand.reset();

  // 7. Bodies that are not JSON, and connections that drop half-way: every path of the field is said
  // to be unreadable, in words, and nothing throws.
  await stand.faults({ route: "trajectory", truncateJson: true, rateReset: 0.2 });
  const seventh = await openField(page, 5, { timeoutMs: 180000 });
  // Newest first: the top lines are this field's, above everything from before.
  const bad = (await problemLines(page)).slice(0, PER_FIELD).filter((line) => /path could not be read/.test(line));
  const allLines = await problemLines(page);
  check("bad bodies: every unreadable path is said", bad.length === PER_FIELD, `${bad.length} of ${PER_FIELD} said; ${allLines.length} lines shown, last: ${allLines.at(-1)?.slice(0, 80)}; field row: ${seventh.text.replace(/\n/g, " ")}`);
  check("bad bodies: said in words, not a stack", bad.length > 0 && bad.every((line) => /could not be read from the Wellbore DDMS: \S/.test(line) && !/\bat \S+ \(/.test(line)), bad[0]?.slice(0, 200));
  await stand.reset();

  const measured = await reading(page);
  check("zero page errors", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
  check("zero CSP violations", measured.cspViolations.length === 0, measured.cspViolations.slice(0, 3).join(" | "));
  check("heap within budget", measured.heapMB <= BUDGETS.network.heapMB, `${measured.heapMB} MB`);
} catch (error) {
  check("the run itself", false, String(error).slice(0, 400));
} finally {
  await browser.close().catch(() => {});
  await stand.stop();
}
mkdirSync(new URL("../../output/reports/", import.meta.url).pathname, { recursive: true });
writeFileSync(new URL("../../output/reports/faults.json", import.meta.url).pathname, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length} checks, ${failed} failed. Report: output/reports/faults.json`);
process.exit(failed ? 1 : 0);
