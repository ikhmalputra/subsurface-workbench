import assert from "node:assert/strict";
import test from "node:test";
import type { DeckConfig } from "@ikhmalputra/subsurface-core/deck-config";
import { accessToken, authState, completeSignInIfCallback, configureAuth, guardAuthFor, holdsTokens, resetAuth, signIn, signOut } from "../src/auth/oidc.ts";
import type { Browser, TokenSet, Transport } from "../src/auth/oidc.ts";

const CONFIG: DeckConfig = { version: 1, sources: [], auth: { corp: { issuer: "https://login.example.com/t", clientId: "deck", scopes: ["openid", "offline_access"], extraParams: { audience: "osdu" } } } };
const META = { issuer: "https://login.example.com/t", authorizationEndpoint: "https://login.example.com/t/authorize", tokenEndpoint: "https://token.example.com/t/token", endSessionEndpoint: "https://login.example.com/t/logout" };

/** A page in memory: an address, a session store, the navigations it was sent on, a broadcast channel, a clock. */
function fakeBrowser(href = "https://deck.example.com/x/deck/#deck=abc") {
  const store = new Map<string, string>();
  const browser: Browser & { assigned: string[]; replaced: string[]; listeners: ((m: unknown) => void)[]; time: number; store: Map<string, string> } = {
    assigned: [], replaced: [], listeners: [], time: 1_700_000_000_000, store,
    href: () => href, origin: () => "https://deck.example.com",
    assign: (url) => { browser.assigned.push(url); }, replace: (url) => { browser.replaced.push(url); href = new URL(url, "https://deck.example.com").href; },
    session: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => { store.set(key, value); }, removeItem: (key) => { store.delete(key); }, key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } },
    broadcast: (message) => { for (const listener of browser.listeners) listener(message); }, onBroadcast: (listener) => { browser.listeners.push(listener); },
    now: () => browser.time,
  };
  return { browser, goto: (url: string) => { href = url; } };
}
/** A provider in memory: counts its calls, hands out numbered tokens, can be told to refuse a refresh. */
function fakeTransport(options: { nonceMismatch?: boolean; refuseRefresh?: boolean } = {}) {
  let n = 0;
  const transport: Transport & { exchanges: { state: string; verifier: string; nonce: string; redirectUri: string }[]; refreshes: string[] } = {
    exchanges: [], refreshes: [],
    discover: async () => META,
    exchange: async (_meta, _profile, _callback, redirectUri, state, verifier, nonce) => { transport.exchanges.push({ state, verifier, nonce, redirectUri }); n++; return { accessToken: `AT${n}`, refreshToken: `RT${n}`, expiresIn: 100, idToken: `ID${n}`, claims: { sub: "u1", name: "Ada", nonce: options.nonceMismatch ? "other" : nonce } } satisfies TokenSet; },
    refresh: async (_meta, _profile, refreshToken) => { transport.refreshes.push(refreshToken); if (options.refuseRefresh) throw new Error("invalid_grant"); n++; await new Promise((resolve) => setTimeout(resolve, 5)); return { accessToken: `AT${n}`, refreshToken: `RT${n}`, expiresIn: 100, idToken: null, claims: { sub: "u1" } }; },
  };
  return transport;
}
/** Every string in the page's stores, joined: a token must never appear in it. */
const stored = (browser: ReturnType<typeof fakeBrowser>["browser"]) => [...browser.store.entries()].flat().join("\n");

test("signing in sends the person to the provider with PKCE, state and nonce, keeping only the pending request in sessionStorage", async () => {
  resetAuth();
  const { browser } = fakeBrowser();
  const transport = fakeTransport();
  configureAuth(CONFIG, "/x/", { browser, transport });
  await signIn("corp");
  assert.equal(browser.assigned.length, 1);
  const url = new URL(browser.assigned[0]!);
  assert.equal(url.origin + url.pathname, META.authorizationEndpoint);
  const q = url.searchParams;
  assert.equal(q.get("response_type"), "code");
  assert.equal(q.get("client_id"), "deck");
  assert.equal(q.get("redirect_uri"), "https://deck.example.com/x/deck/");
  assert.equal(q.get("scope"), "openid offline_access");
  assert.equal(q.get("code_challenge_method"), "S256");
  assert.equal(q.get("audience"), "osdu");
  assert.ok(q.get("state")!.length >= 20 && q.get("nonce")!.length >= 20 && q.get("code_challenge")!.length >= 40);
  const pending = JSON.parse(browser.store.get(`deck-auth:pending:${q.get("state")}`)!);
  assert.equal(pending.profile, "corp");
  assert.equal(pending.returnTo, "/x/deck/#deck=abc", "where to come back to, same-origin, fragment kept");
  assert.equal(authState().profiles.corp!.status, "signing-in");
});

test("the callback exchanges the code once, keeps the tokens in memory only, cleans the address bar, and the state shows who is signed in", async () => {
  resetAuth();
  const { browser, goto } = fakeBrowser();
  const transport = fakeTransport();
  configureAuth(CONFIG, "/x/", { browser, transport });
  await signIn("corp");
  const state = new URL(browser.assigned[0]!).searchParams.get("state")!;
  goto(`https://deck.example.com/x/deck/?code=C1&state=${state}&session_state=zzz`);
  assert.equal(await completeSignInIfCallback(), true);
  assert.equal(transport.exchanges.length, 1);
  assert.equal(transport.exchanges[0]!.state, state);
  assert.equal(transport.exchanges[0]!.redirectUri, "https://deck.example.com/x/deck/");
  assert.equal(browser.replaced.at(-1), "/x/deck/#deck=abc", "code and state gone, the deck's own link restored");
  assert.equal(await accessToken("corp"), "AT1");
  const shown = authState().profiles.corp!;
  assert.deepEqual([shown.status, shown.sub, shown.name], ["signed-in", "u1", "Ada"]);
  assert.ok(holdsTokens("corp"));
  assert.doesNotMatch(stored(browser), /AT1|RT1|ID1/, "no token in sessionStorage");
  assert.equal(browser.store.size, 0, "the pending request is gone");
  assert.equal(await completeSignInIfCallback(), false, "an ordinary load is not a callback");
});

test("a callback whose state matches no request, or whose nonce does not match, is refused without a token", async () => {
  resetAuth();
  const { browser, goto } = fakeBrowser();
  const transport = fakeTransport();
  configureAuth(CONFIG, "/x/", { browser, transport });
  goto("https://deck.example.com/x/deck/?code=C1&state=forged");
  await completeSignInIfCallback();
  assert.equal(transport.exchanges.length, 0, "nothing exchanged for an unknown state");
  assert.equal(authState().profiles.corp!.status, "signed-out");
  const mismatch = fakeTransport({ nonceMismatch: true });
  configureAuth(CONFIG, "/x/", { browser, transport: mismatch });
  await signIn("corp");
  goto(`https://deck.example.com/x/deck/?code=C2&state=${new URL(browser.assigned.at(-1)!).searchParams.get("state")}`);
  await completeSignInIfCallback();
  assert.equal(authState().profiles.corp!.status, "error");
  assert.match(authState().profiles.corp!.error!, /nonce/);
  assert.ok(!holdsTokens("corp"));
  // A stale request (older than ten minutes) is refused too.
  configureAuth(CONFIG, "/x/", { browser, transport: fakeTransport() });
  await signIn("corp");
  const state = new URL(browser.assigned.at(-1)!).searchParams.get("state")!;
  browser.time += 11 * 60_000;
  goto(`https://deck.example.com/x/deck/?code=C3&state=${state}`);
  await completeSignInIfCallback();
  assert.match(authState().profiles.corp!.error!, /too old/);
});

test("refresh is single-flight, happens on demand near expiry and on a 401, and the new token is used from then on", async () => {
  resetAuth();
  const { browser, goto } = fakeBrowser();
  const transport = fakeTransport();
  configureAuth(CONFIG, "/x/", { browser, transport });
  await signIn("corp");
  goto(`https://deck.example.com/x/deck/?code=C1&state=${new URL(browser.assigned[0]!).searchParams.get("state")}`);
  await completeSignInIfCallback();
  // Four callers at once with a token near its end: one refresh, all four get the new token.
  browser.time += 50_000;
  const tokens = await Promise.all([accessToken("corp"), accessToken("corp"), accessToken("corp"), accessToken("corp")]);
  assert.deepEqual(tokens, ["AT2", "AT2", "AT2", "AT2"]);
  assert.deepEqual(transport.refreshes, ["RT1"]);
  // The guard's hook: a 401 forces a refresh, and the token afterwards is the newer one.
  const guard = guardAuthFor("corp");
  assert.equal(await guard.token(), "AT2");
  await guard.onUnauthorized!();
  assert.equal(await guard.token(), "AT3");
  assert.deepEqual(transport.refreshes, ["RT1", "RT2"]);
});

test("a revoked refresh token sends the deck silently through the provider's session; the third time in five minutes it asks instead", async () => {
  resetAuth();
  const { browser, goto } = fakeBrowser();
  configureAuth(CONFIG, "/x/", { browser, transport: fakeTransport() });
  await signIn("corp");
  goto(`https://deck.example.com/x/deck/?code=C1&state=${new URL(browser.assigned[0]!).searchParams.get("state")}`);
  await completeSignInIfCallback();
  const refusing = fakeTransport({ refuseRefresh: true });
  configureAuth(CONFIG, "/x/", { browser, transport: refusing });
  assert.equal(await accessToken("corp", { force: true }), null);
  assert.equal(browser.assigned.length, 2, "sent to the provider");
  assert.equal(new URL(browser.assigned[1]!).searchParams.get("prompt"), "none");
  assert.ok(!holdsTokens("corp"));
  // The provider answers login_required: the person is asked.
  goto(`https://deck.example.com/x/deck/?error=login_required&state=${new URL(browser.assigned[1]!).searchParams.get("state")}`);
  await completeSignInIfCallback();
  assert.equal(authState().profiles.corp!.status, "needs-sign-in");
  // Two silent attempts already in the window: a third is not made.
  await signIn("corp", { silent: true }); // counts as the second
  const before = browser.assigned.length;
  configureAuth(CONFIG, "/x/", { browser, transport: refusing });
  await signIn("corp");
  goto(`https://deck.example.com/x/deck/?code=C9&state=${new URL(browser.assigned.at(-1)!).searchParams.get("state")}`);
  await completeSignInIfCallback();
  browser.store.set("deck-auth:silent", JSON.stringify([browser.time - 1000, browser.time - 500]));
  assert.equal(await accessToken("corp", { force: true }), null);
  assert.equal(browser.assigned.length, before + 1, "no third silent redirect");
  assert.equal(authState().profiles.corp!.status, "needs-sign-in");
});

test("sign-out clears the tokens, tells the other tabs, and ends the provider's session with the id token hint", async () => {
  resetAuth();
  const { browser, goto } = fakeBrowser();
  configureAuth(CONFIG, "/x/", { browser, transport: fakeTransport() });
  await signIn("corp");
  goto(`https://deck.example.com/x/deck/?code=C1&state=${new URL(browser.assigned[0]!).searchParams.get("state")}`);
  await completeSignInIfCallback();
  const heard: unknown[] = [];
  browser.listeners.push((message) => heard.push(message));
  await signOut("corp");
  assert.ok(!holdsTokens("corp"));
  assert.equal(await accessToken("corp"), null);
  assert.deepEqual(heard.at(-1), { kind: "signed-out", profile: "corp" });
  const url = new URL(browser.assigned.at(-1)!);
  assert.equal(url.origin + url.pathname, META.endSessionEndpoint);
  assert.equal(url.searchParams.get("id_token_hint"), "ID1");
  assert.equal(url.searchParams.get("post_logout_redirect_uri"), "https://deck.example.com/x/");
  // A sign-out broadcast from another tab is honoured here too.
  configureAuth(CONFIG, "/x/", { browser, transport: fakeTransport() });
  await signIn("corp");
  goto(`https://deck.example.com/x/deck/?code=C2&state=${new URL(browser.assigned.at(-1)!).searchParams.get("state")}`);
  await completeSignInIfCallback();
  assert.ok(holdsTokens("corp"));
  browser.broadcast({ kind: "signed-out", profile: "corp" });
  assert.ok(!holdsTokens("corp"));
});
