// The stress and end-to-end suites' shared stand: the mock OSDU platform with its identity
// provider (tools/mock-osdu), and the built deck served with a config.json that points at them and
// a Content-Security-Policy whose connect-src admits exactly those two origins, as a deployment's
// would. Nothing here touches the network beyond 127.0.0.1.
//
//   const stand = await startStand({ profile: "clean", wells: 2000, ports: 4110 });
//   … stand.base, stand.admin("/faults", { route: "*", latencyMs: 50 }) …
//   await stand.stop();
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "parse5";
import { gzipSync } from "node:zlib";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUT = resolve(ROOT, "apps/deck/out");
// Compressed as any real deployment serves it, so a throttled link measures the deck, not the stand.
const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".txt", ".las", ".sgy", ".i8", ".xml"]);
const gzipped = new Map();
const gzipOf = (path, data) => { if (!gzipped.has(path)) gzipped.set(path, gzipSync(data, { level: 6 })); return gzipped.get(path); };
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".json": "application/json", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".txt": "text/plain", ".xml": "application/xml", ".las": "text/plain", ".sgy": "application/octet-stream", ".i8": "application/octet-stream" };

function scriptHashes(html) {
  const hashes = [];
  const visit = (node) => {
    if (node.nodeName === "script" && !node.attrs.some((a) => a.name === "src")) hashes.push(`'sha256-${createHash("sha256").update(node.childNodes.map((c) => c.value ?? "").join("")).digest("base64")}'`);
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(parse(html));
  return hashes;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, { timeoutMs = 30000, everyMs = 150, what = "condition" } = {}) {
  const t0 = Date.now();
  for (;;) {
    const value = await check().catch(() => null);
    if (value) return value;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await wait(everyMs);
  }
}

/**
 * Starts the platform, the provider and the deck. `ports` is the first of four consecutive ports:
 * deck, platform, admin, provider. `profile`, `wells`, `perField`, `stations`, `tokenTtlS`,
 * `clockSkewS`, `cursorTtlS` and `seed` go to the mock. `samples` adds the bundled samples source.
 */
export async function startStand({ profile = "clean", wells = 1000, perField = 200, stations = 300, tokenTtlS = 300, clockSkewS = 0, cursorTtlS = 60, seed = 7, ports = 4110, samples = false, gzip = false, log = () => {} } = {}) {
  const [deckPort, osduPort, adminPort, idpPort] = [ports, ports + 1, ports + 2, ports + 3];
  const base = `http://127.0.0.1:${deckPort}/`;
  const osdu = `http://127.0.0.1:${osduPort}`, adminUrl = `http://127.0.0.1:${adminPort}`, issuer = `http://127.0.0.1:${idpPort}`;
  const child = spawn(process.execPath, [resolve(ROOT, "tools/mock-osdu/server.mjs"), "--profile", profile, "--wells", String(wells), "--per-field", String(perField), "--stations", String(stations), "--port", String(osduPort), "--admin-port", String(adminPort), "--idp-port", String(idpPort), "--allow-origin", `http://127.0.0.1:${deckPort}`, "--token-ttl", String(tokenTtlS), "--clock-skew", String(clockSkewS), "--cursor-ttl", String(cursorTtlS), "--seed", String(seed), ...(gzip ? ["--gzip"] : [])], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => log(`[mock] ${String(d).trim()}`));
  child.stderr.on("data", (d) => log(`[mock!] ${String(d).trim()}`));
  const config = JSON.stringify({
    version: 1,
    sources: [...(samples ? [{ type: "samples" }] : []), { type: "osdu", label: `Mock OSDU (${profile})`, url: osdu, dataPartition: "opendes", auth: "mock" }],
    auth: { mock: { issuer, clientId: "deck", scopes: ["openid", "profile", "offline_access"] } },
    share: { mode: "reference" },
  });
  const csp = (hashes) => `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' ${hashes.join(" ")}; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self' ${osdu} ${issuer}; object-src 'none'; base-uri 'none'; frame-ancestors 'self'`;
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, base).pathname);
      if (pathname === "/config.json") { response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(config); return; }
      if (!pathname.endsWith("/") && !extname(pathname)) { response.writeHead(301, { Location: `${pathname}/` }).end(); return; }
      const path = resolve(OUT, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`);
      if (!path.startsWith(OUT + sep)) { response.writeHead(403).end(); return; }
      const raw = await readFile(path);
      const html = extname(path) === ".html";
      // Revalidated, as the static-hosting runbook has a deployment do: a reload (the sign-in redirect) re-fetches nothing unchanged.
      const etag = `"${createHash("sha1").update(raw).digest("base64url").slice(0, 20)}"`;
      if (pathname !== "/config.json" && request.headers["if-none-match"] === etag) { response.writeHead(304, { ETag: etag }).end(); return; }
      const gzip = COMPRESSIBLE.has(extname(path)) && /\bgzip\b/.test(request.headers["accept-encoding"] ?? "");
      const data = gzip ? gzipOf(path, raw) : raw;
      response.writeHead(200, { "Content-Type": `${TYPES[extname(path)] ?? "application/octet-stream"}; charset=utf-8`, "Content-Length": data.byteLength, ...(gzip ? { "Content-Encoding": "gzip" } : {}), Vary: "Accept-Encoding", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": csp(html ? scriptHashes(raw.toString()) : []), ETag: etag, "Cache-Control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : pathname === "/version.json" ? "no-store" : "no-cache" });
      response.end(request.method === "HEAD" ? undefined : data);
    } catch { response.writeHead(404).end("Not found"); }
  });
  await new Promise((r) => server.listen(deckPort, "127.0.0.1", r));
  const admin = async (path, body) => { const r = await fetch(`${adminUrl}/__admin${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}); if (!r.ok) throw new Error(`admin ${path}: HTTP ${r.status}`); return r.json(); };
  await until(() => admin("/health"), { what: "the mock platform", timeoutMs: 30000 });
  await until(() => fetch(`${issuer}/.well-known/openid-configuration`).then((r) => r.ok), { what: "the mock provider" });
  return {
    base, osdu, issuer, adminUrl, admin, profile,
    /** The platform's log: requests per route, status histogram, aborted, retryAfter, peak concurrency. */
    log: () => admin("/log"),
    reset: () => admin("/reset", {}),
    faults: (spec) => admin("/faults", spec),
    async stop() { child.kill("SIGTERM"); await new Promise((r) => server.close(r)); },
  };
}

// ── Driving the deck in Playwright ────────────────────────────────────────────────────────────
export async function launch() {
  const playwright = await import(process.env.PLAYWRIGHT ?? "@playwright/test").catch(() => null);
  if (!playwright) { console.error("Playwright is not installed here."); process.exit(2); }
  return playwright.chromium.launch({ args: ["--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--enable-precise-memory-info"] });
}

/** A page at the deck with the long-task and error recorders in, storage cleared, the globe ready. */
export async function openDeck(context, base, { ready = true } = {}) {
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (error) => page.errors.push(error.message));
  page.on("crash", () => page.errors.push("THE PAGE CRASHED"));
  await page.addInitScript(() => {
    window.__stalls = []; window.__cspViolations = []; window.__xssCalls = 0; window.__xss = () => { window.__xssCalls += 1; };
    window.__stallsAt = []; window.__marks = [];
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) { window.__stalls.push(entry.duration); window.__stallsAt.push([Math.round(entry.startTime), Math.round(entry.duration)]); } }).observe({ type: "longtask", buffered: true });
    document.addEventListener("securitypolicyviolation", (event) => window.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`));
  });
  await page.goto(`${base}deck/`);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${base}deck/`);
  if (ready) await page.waitForSelector("[data-testid='wells-map'][data-ready='true']", { timeout: 60000 });
  return page;
}

/** Names the moment, so a stall can be put down to the step that caused it. */
export const mark = (page, name) => page.evaluate((label) => window.__marks.push([Math.round(performance.now()), label]), name).catch(() => {});
/** The worst stalls, each with the step that was running when it began. */
export const worstStalls = (page, n = 5) => page.evaluate((count) => [...window.__stallsAt].sort((a, b) => b[1] - a[1]).slice(0, count).map(([at, ms]) => { const step = [...window.__marks].reverse().find(([t]) => t <= at); return `${ms} ms at ${at} ms (${step ? step[1] : "load"})`; }), n).catch(() => []);
export const reading = (page) => page.evaluate(() => ({ heapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576), stalls: window.__stalls.length, worstStallMs: Math.round(Math.max(0, ...window.__stalls)), cspViolations: window.__cspViolations, xssCalls: window.__xssCalls }));

/** Opens the Data sources tool, expanded, and returns its locator. */
export async function openSources(page) {
  if (!(await page.locator('[data-module="sources"]').count())) { await page.locator('.dock-item[data-id="sources"]').click(); await page.waitForTimeout(800); }
  const tool = page.locator('[data-module="sources"]');
  const expand = tool.locator(".tile-action[aria-pressed='false']").first();
  if (await expand.count()) { await expand.click(); await page.waitForTimeout(600); }
  return tool;
}

/** Opens one of Data sources' inspector sections by its title (they are an accordion: one open at a time). */
export async function openSection(page, title) {
  const tool = await openSources(page);
  const head = tool.locator(".mf-section-head", { hasText: title }).first();
  if (await head.count() && (await head.getAttribute("aria-expanded")) !== "true") { await head.click(); await wait(150); }
  return tool;
}

/** Every line of "Left out or flagged" in Data sources. */
export async function problemLines(page) {
  const tool = await openSection(page, "Left out or flagged");
  return tool.locator(".ds-problems li").allInnerTexts();
}

/** The profile's status line in Data sources ("signed in as …", "sign-in needed", …). */
export const authStatus = async (page) => (await openSection(page, "Sources")).locator(".ds-auth-row small").first().innerText().catch(() => "");

/**
 * Signs in through the provider: the Sign in button, the provider's auto-consent, and the return
 * to the deck. Resolves once Data sources says "signed in".
 */
export async function signIn(page, { timeoutMs = 30000 } = {}) {
  const tool = await openSection(page, "Sources");
  const button = tool.locator(".ds-auth-row button", { hasText: "Sign in" });
  await button.waitFor({ timeout: timeoutMs });
  await Promise.all([page.waitForURL(/deck\/?(\?.*)?$/, { timeout: timeoutMs, waitUntil: "commit" }), button.click()]);
  await page.waitForSelector("[data-testid='wells-map'][data-ready='true']", { timeout: 60000 });
  await page.waitForFunction(() => /signed in as/.test(document.querySelector('[data-module="sources"] .ds-auth-row small')?.textContent ?? ""), null, { timeout: timeoutMs }).catch(async () => { await openSection(page, "Sources"); await page.waitForFunction(() => /signed in as/.test(document.querySelector('[data-module="sources"] .ds-auth-row small')?.textContent ?? ""), null, { timeout: timeoutMs }); });
}

/** Waits until the mock source has been listed (its row in Sources no longer says "reading"). */
export async function sourcesListed(page, { timeoutMs = 60000 } = {}) {
  await openSection(page, "Sources");
  await page.waitForFunction(() => { const rows = [...document.querySelectorAll('[data-module="sources"] .mf-facts dd')]; return rows.length > 0 && rows.every((dd) => !/reading/.test(dd.textContent ?? "")); }, null, { timeout: timeoutMs });
  return page.locator('[data-module="sources"] .mf-facts dd').allInnerTexts();
}

/** Where each field's row was found in the list, so a later read scrolls straight back to it. */
const fieldScroll = new WeakMap();
/** `index` is a number (the field named `Field <index>`) or `{ nth }` (the nth field from the top, whatever its name: a hostile tenant's names are not "Field n"). */
const fieldOpen = (tool, index) => typeof index === "number" ? tool.locator(".ds-field .ds-open", { hasText: new RegExp(`^Field ${index}$`) }) : tool.locator(".ds-field .ds-open").nth(index.nth);

/**
 * Scrolls the (virtualised) Data sources list until the field named `Field <index>` is drawn, and
 * returns its open button. The position is remembered per page.
 */
export async function fieldButton(page, index) {
  const tool = await openSources(page);
  const button = fieldOpen(tool, index);
  const list = tool.locator(".ds-list");
  await tool.locator(".ds-field .ds-open").first().waitFor({ timeout: 120000 });
  const key = typeof index === "number" ? index : `nth:${index.nth}`;
  const known = fieldScroll.get(page)?.get(key) ?? (typeof index === "number" ? undefined : 0);
  await list.evaluate((el, top) => { el.scrollTop = top; }, known ?? 0);
  await wait(30);
  for (let step = 0; step < 4000 && !(await button.count()); step++) {
    const moved = await list.evaluate((el) => { const before = el.scrollTop; el.scrollTop += Math.max(200, el.clientHeight - 40); return el.scrollTop !== before; });
    await wait(30);
    if (!moved) break;
  }
  if (!(await button.count())) throw new Error(`Field ${typeof index === "number" ? index : `#${index.nth}`} is not in the Data sources list`);
  if (!fieldScroll.has(page)) fieldScroll.set(page, new Map());
  fieldScroll.get(page).set(key, await list.evaluate((el) => el.scrollTop));
  return button;
}

/** The text of `Field <index>`'s row in Data sources ("Field 3 · 200 wells · source · reading 40 of 200"). */
export async function fieldText(page, index) {
  const button = await fieldButton(page, index);
  return button.locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' ds-row ')][1]").innerText();
}

/** Opens `Field <index>` from Data sources and waits until its detail has been read (or failed). Returns the row's text and the time taken. */
export async function openField(page, index = 0, { timeoutMs = 120000 } = {}) {
  const button = await fieldButton(page, index);
  const t0 = Date.now();
  await button.click();
  let text = "";
  for (;;) {
    text = await fieldText(page, index).catch(() => "");
    if (text && !/· reading/.test(text) && Date.now() - t0 > 300) break;
    if (Date.now() - t0 > timeoutMs) throw new Error(`Field ${index} still reading after ${timeoutMs} ms: ${text}`);
    await wait(150);
  }
  return { ms: Date.now() - t0, text };
}

/** `Field <index>`'s row text as it changes, sampled until `ms` have passed: proof that progress was visible. */
export async function watchField(page, index, ms, everyMs = 250) {
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const text = await fieldText(page, index).catch(() => ""); if (text) seen.add(text.replace(/\d[\d,]*/g, "#")); await wait(everyMs); }
  return [...seen];
}

export { wait, until };
