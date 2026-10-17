import { useSyncExternalStore } from "react";
import * as oauth from "oauth4webapi";
import type { AuthProfile, DeckConfig } from "@ikhmalputra/subsurface-core/deck-config";
import type { GuardAuth } from "@ikhmalputra/subsurface-core/fetch-guard";

/**
 * Signing in with the tenant's own identity provider: OpenID Connect, authorization code with
 * PKCE, as a public client. There is no secret anywhere.
 *
 * - **Tokens live in memory only.** Nothing of them reaches localStorage, sessionStorage, IndexedDB,
 *   the URL or the logs. Reloading the page loses them by design; the deck then bounces silently
 *   through the provider's own session (`prompt=none`), which takes about a second.
 * - sessionStorage holds only the pending request (state, nonce, PKCE verifier, where to return),
 *   keyed by state, deleted the moment the callback runs, and ignored after ten minutes.
 * - The access token is refreshed once, in flight for everyone, at 80 % of its life or on a 401.
 *   With no refresh token (or a revoked one) the deck redirects silently; a loop guard allows two
 *   automatic redirects in five minutes, then asks the person to sign in.
 * - Sign-out clears the tokens here, tells the other tabs, and ends the provider's session.
 *
 * The provider is reached through a `Transport`; the one built on oauth4webapi is the default, and
 * the tests supply their own, so the lifecycle is checked without a browser or a provider.
 */

export interface TokenSet { readonly accessToken: string; readonly refreshToken: string | null; readonly expiresIn: number; readonly idToken: string | null; readonly claims: { readonly sub: string; readonly name?: string; readonly nonce?: string } }
export interface ProviderMetadata { readonly issuer: string; readonly authorizationEndpoint: string; readonly tokenEndpoint: string; readonly endSessionEndpoint: string | null }
export interface Transport {
  discover(profile: AuthProfile): Promise<ProviderMetadata>;
  exchange(metadata: ProviderMetadata, profile: AuthProfile, callback: URL, redirectUri: string, state: string, verifier: string, nonce: string): Promise<TokenSet>;
  refresh(metadata: ProviderMetadata, profile: AuthProfile, refreshToken: string): Promise<TokenSet>;
}
/** What the module needs from the page, so the tests can stand in for it. */
export interface Browser {
  href(): string;
  origin(): string;
  /** Navigate away (to the provider). */
  assign(url: string): void;
  /** Rewrite the address bar without navigating. */
  replace(url: string): void;
  readonly session: Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
  broadcast(message: unknown): void;
  onBroadcast(listener: (message: unknown) => void): void;
  now(): number;
}

export type AuthStatus = "signed-out" | "signing-in" | "signed-in" | "needs-sign-in" | "error";
export interface ProfileView { readonly status: AuthStatus; readonly sub: string | null; readonly name: string | null; readonly expiresAt: number | null; readonly error: string | null }
export interface AuthView { readonly profiles: Readonly<Record<string, ProfileView>> }

interface Pending { readonly profile: string; readonly state: string; readonly nonce: string; readonly verifier: string; readonly returnTo: string; readonly createdAt: number }
interface Live { tokens: TokenSet | null; metadata: ProviderMetadata | null; refreshing: Promise<TokenSet | null> | null; timer: ReturnType<typeof setTimeout> | null; receivedAt: number; status: AuthStatus; error: string | null }

/** RESUME holds a profile's name, never a token: this tab signed in to it, so a reload may go back through the provider's session. */
const PENDING = "deck-auth:pending:", SILENT = "deck-auth:silent", RESUME = "deck-auth:resume:", PENDING_TTL_MS = 10 * 60_000, SILENT_WINDOW_MS = 5 * 60_000, SILENT_MAX = 2;

/** The page as the module sees it in a browser. */
const realBrowser = (): Browser => {
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("deck-auth");
  return {
    href: () => location.href, origin: () => location.origin,
    assign: (url) => location.assign(url), replace: (url) => history.replaceState(history.state, "", url),
    session: sessionStorage,
    broadcast: (message) => channel?.postMessage(message),
    onBroadcast: (listener) => channel?.addEventListener("message", (event) => listener(event.data)),
    now: () => Date.now(),
  };
};

/** Plain http is allowed to a provider on this machine only (a mock while developing and testing); everywhere else it is https. */
const insecure = (issuer: string) => /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(?=[/?#]|$)/i.test(issuer) ? { [oauth.allowInsecureRequests]: true } : {};
/** Token lifetimes are checked with five minutes of tolerance: a client's clock a few minutes off still signs in. */
const CLOCK_TOLERANCE_S = 300;
/** The provider through oauth4webapi: discovery, PKCE, the code exchange with nonce and issuer checks, refresh. */
const realTransport: Transport = {
  async discover(profile) {
    const issuer = new URL(profile.issuer);
    const meta = profile.metadata ?? {};
    const as = meta.authorizationEndpoint && meta.tokenEndpoint
      ? { issuer: issuer.href, authorization_endpoint: meta.authorizationEndpoint, token_endpoint: meta.tokenEndpoint, ...(meta.jwksUri ? { jwks_uri: meta.jwksUri } : {}), ...(meta.endSessionEndpoint ? { end_session_endpoint: meta.endSessionEndpoint } : {}) }
      : await oauth.processDiscoveryResponse(issuer, await oauth.discoveryRequest(issuer, { algorithm: "oidc", ...insecure(profile.issuer) }));
    servers.set(profile.issuer, as);
    if (!as.authorization_endpoint || !as.token_endpoint) throw new Error("The provider's discovery document names no authorization or token endpoint.");
    return { issuer: as.issuer, authorizationEndpoint: as.authorization_endpoint, tokenEndpoint: meta.tokenEndpoint ?? as.token_endpoint, endSessionEndpoint: meta.endSessionEndpoint ?? as.end_session_endpoint ?? null };
  },
  async exchange(metadata, profile, callback, redirectUri, state, verifier, nonce) {
    const as = servers.get(profile.issuer)!, client: oauth.Client = { client_id: profile.clientId, [oauth.clockTolerance]: CLOCK_TOLERANCE_S };
    const params = oauth.validateAuthResponse(as, client, callback, state);
    const response = await oauth.authorizationCodeGrantRequest(as, client, oauth.None(), params, redirectUri, verifier, insecure(profile.issuer));
    const result = await oauth.processAuthorizationCodeResponse(as, client, response, { expectedNonce: nonce, requireIdToken: true });
    return tokensOf(result);
  },
  async refresh(metadata, profile, refreshToken) {
    const as = servers.get(profile.issuer)!, client: oauth.Client = { client_id: profile.clientId, [oauth.clockTolerance]: CLOCK_TOLERANCE_S };
    const response = await oauth.refreshTokenGrantRequest(as, client, oauth.None(), refreshToken, insecure(profile.issuer));
    return tokensOf(await oauth.processRefreshTokenResponse(as, client, response));
  },
};
const servers = new Map<string, oauth.AuthorizationServer>();
const tokensOf = (result: oauth.TokenEndpointResponse): TokenSet => {
  const claims = oauth.getValidatedIdTokenClaims(result);
  return { accessToken: result.access_token, refreshToken: result.refresh_token ?? null, expiresIn: result.expires_in ?? 300, idToken: result.id_token ?? null, claims: { sub: claims?.sub ?? "", ...(typeof claims?.name === "string" ? { name: claims.name } : {}), ...(claims?.nonce ? { nonce: claims.nonce } : {}) } };
};

// ── State ─────────────────────────────────────────────────────────────────────────────────────
let browser: Browser | null = null, transport: Transport = realTransport;
let profiles: Readonly<Record<string, AuthProfile>> = {};
const live = new Map<string, Live>();
let view: AuthView = { profiles: {} };
let redirectBase = "";
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => view;
/** The sign-in state the UI reads: never a token. */
export const useAuth = () => useSyncExternalStore(subscribe, snapshot, snapshot);
export const subscribeAuth = subscribe;
export const authState = () => view;

const page = () => { browser ??= realBrowser(); return browser; };
const entry = (profile: string) => { let state = live.get(profile); if (!state) { state = { tokens: null, metadata: null, refreshing: null, timer: null, receivedAt: 0, status: "signed-out", error: null }; live.set(profile, state); } return state; };
function publish() {
  view = { profiles: Object.fromEntries(Object.keys(profiles).map((name) => { const state = entry(name); return [name, { status: state.status, sub: state.tokens?.claims.sub ?? null, name: state.tokens?.claims.name ?? null, expiresAt: state.tokens ? state.receivedAt + state.tokens.expiresIn * 1000 : null, error: state.error }]; })) };
  for (const listener of [...listeners]) listener();
}
const set = (profile: string, patch: Partial<Live>) => { Object.assign(entry(profile), patch); publish(); };

/**
 * Installs the profiles from the deck's config, and where the deck lives (its redirect URI is
 * `<origin><base>deck/`). With `browser` and `transport` the tests stand in for the page and the
 * provider. Safe to call again with a new config.
 */
export function configureAuth(config: DeckConfig, base: string, options: { readonly browser?: Browser; readonly transport?: Transport } = {}) {
  if (options.browser) browser = options.browser;
  if (options.transport) transport = options.transport;
  profiles = config.auth ?? {};
  redirectBase = base;
  for (const name of Object.keys(profiles)) entry(name);
  for (const name of [...live.keys()]) if (!profiles[name]) { clearTimeout(live.get(name)!.timer ?? undefined); live.delete(name); }
  page().onBroadcast((message) => { if (isObject(message) && message.kind === "signed-out" && typeof message.profile === "string" && live.has(message.profile)) forget(message.profile, "signed-out"); });
  publish();
}
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
export const redirectUri = () => `${page().origin()}${redirectBase}deck/`;
export const authProfile = (name: string): AuthProfile | null => profiles[name] ?? null;

const metadataOf = async (name: string) => { const state = entry(name); state.metadata ??= await transport.discover(profiles[name]!); return state.metadata; };

/** A same-origin path, with its fragment, to return to after the provider; never another site. */
const safeReturn = (href: string) => { try { const url = new URL(href, page().origin()); return url.origin === page().origin() ? `${url.pathname}${url.search}${url.hash}` : `${redirectBase}deck/`; } catch { return `${redirectBase}deck/`; } };

/** Sends the person to the provider to sign in to a profile; `silent` tries the provider's session without a prompt. */
export async function signIn(name: string, options: { readonly returnTo?: string; readonly silent?: boolean } = {}): Promise<void> {
  const profile = profiles[name];
  if (!profile) throw new Error(`No auth profile "${name}" in the config.`);
  const metadata = await metadataOf(name);
  const state = oauth.generateRandomState(), nonce = oauth.generateRandomNonce(), verifier = oauth.generateRandomCodeVerifier();
  const challenge = await oauth.calculatePKCECodeChallenge(verifier);
  const pending: Pending = { profile: name, state, nonce, verifier, returnTo: safeReturn(options.returnTo ?? page().href()), createdAt: page().now() };
  page().session.setItem(`${PENDING}${state}`, JSON.stringify(pending));
  const url = new URL(metadata.authorizationEndpoint);
  const params: Record<string, string> = { response_type: "code", client_id: profile.clientId, redirect_uri: redirectUri(), scope: profile.scopes.join(" "), code_challenge: challenge, code_challenge_method: "S256", state, nonce, ...(options.silent ? { prompt: "none" } : {}), ...profile.extraParams };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  set(name, { status: "signing-in", error: null });
  page().assign(url.href);
}

/** Silent sign-in, at most twice in five minutes: past that the person is asked. */
async function silentSignIn(name: string): Promise<void> {
  const now = page().now();
  const stamps = ((): number[] => { try { return (JSON.parse(page().session.getItem(SILENT) ?? "[]") as number[]).filter((at) => now - at < SILENT_WINDOW_MS); } catch { return []; } })();
  if (stamps.length >= SILENT_MAX) { set(name, { status: "needs-sign-in", error: "Signed out: the provider did not renew the session on its own." }); return; }
  page().session.setItem(SILENT, JSON.stringify([...stamps, now]));
  await signIn(name, { silent: true });
}

/** Called once, before the app mounts: finishes a sign-in the provider sent back, if this load is its callback. */
export async function completeSignInIfCallback(): Promise<boolean> {
  const url = new URL(page().href());
  const state = url.searchParams.get("state");
  if (!state || (!url.searchParams.has("code") && !url.searchParams.has("error"))) return false;
  const raw = page().session.getItem(`${PENDING}${state}`);
  page().session.removeItem(`${PENDING}${state}`);
  const pending = raw ? JSON.parse(raw) as Pending : null;
  const clean = (to: string) => page().replace(to);
  if (!pending || page().now() - pending.createdAt > PENDING_TTL_MS || !profiles[pending.profile]) { clean(`${redirectBase}deck/`); if (pending?.profile) set(pending.profile, { status: "error", error: "The sign-in did not match a request this browser made, or it was too old. Try again." }); return true; }
  const name = pending.profile;
  if (url.searchParams.has("error")) {
    const error = url.searchParams.get("error")!;
    clean(pending.returnTo);
    // The provider's session is gone: no more silent attempts from this tab until the person signs in.
    if (error === "login_required" || error === "interaction_required" || error === "consent_required") { page().session.removeItem(`${RESUME}${name}`); set(name, { status: "needs-sign-in", error: null }); }
    else set(name, { status: "error", error: `The provider refused the sign-in: ${error}${url.searchParams.get("error_description") ? ` (${url.searchParams.get("error_description")})` : ""}.` });
    return true;
  }
  try {
    const metadata = await metadataOf(name);
    const tokens = await transport.exchange(metadata, profiles[name]!, url, redirectUri(), pending.state, pending.verifier, pending.nonce);
    if (tokens.claims.nonce && tokens.claims.nonce !== pending.nonce) throw new Error("The identity token's nonce does not match the request.");
    receive(name, tokens);
  } catch (cause) {
    set(name, { status: "error", error: `The sign-in could not be completed: ${cause instanceof Error ? cause.message : String(cause)}` });
  }
  clean(pending.returnTo);
  return true;
}

function receive(name: string, tokens: TokenSet) {
  const state = entry(name);
  clearTimeout(state.timer ?? undefined);
  state.tokens = tokens; state.receivedAt = page().now(); state.status = "signed-in"; state.error = null;
  page().session.setItem(`${RESUME}${name}`, "1");
  // Renewed at 80 % of its life, before anything notices.
  state.timer = setTimeout(() => { void refresh(name); }, Math.max(1000, tokens.expiresIn * 800));
  publish();
}
function forget(name: string, status: AuthStatus) {
  const state = entry(name);
  clearTimeout(state.timer ?? undefined);
  state.tokens = null; state.timer = null; state.status = status; state.refreshing = null;
  if (status === "signed-out") page().session.removeItem(`${RESUME}${name}`);
  publish();
}

/** A fresh token set from the refresh token, once however many ask at the same time; null when there is none to be had here. */
async function refresh(name: string): Promise<TokenSet | null> {
  const state = entry(name);
  if (state.refreshing) return state.refreshing;
  if (!state.tokens?.refreshToken) { await silentSignIn(name); return null; }
  const refreshToken = state.tokens.refreshToken;
  state.refreshing = (async () => {
    try {
      const tokens = await transport.refresh(await metadataOf(name), profiles[name]!, refreshToken);
      receive(name, tokens);
      return tokens;
    } catch (cause) {
      // A revoked or expired refresh token: the provider's own session may still be alive.
      forget(name, "signing-in");
      state.error = cause instanceof Error ? cause.message : String(cause);
      await silentSignIn(name);
      return null;
    } finally { state.refreshing = null; }
  })();
  return state.refreshing;
}

/**
 * The access token for a profile, renewed in its last fifth of life (at most the last minute); null
 * when not signed in. The margin scales with the token: a fixed minute would make a token that lives
 * a minute or less never fresh, and every request would rotate the refresh token (found by
 * tools/e2e/auth.mjs with 6 s tokens).
 */
export async function accessToken(name: string, options: { readonly force?: boolean } = {}): Promise<string | null> {
  const state = entry(name);
  if (!profiles[name]) return null;
  const marginS = state.tokens ? Math.min(60, state.tokens.expiresIn * 0.2) : 0;
  const fresh = state.tokens && !options.force && page().now() < state.receivedAt + (state.tokens.expiresIn - marginS) * 1000;
  if (fresh) return state.tokens!.accessToken;
  if (!state.tokens) return null;
  return (await refresh(name))?.accessToken ?? null;
}

/**
 * The fetch guard's hook for a profile: its token, and a refresh when the backend says 401 to the
 * current one. A 401 for a token another request has already replaced is simply retried with the
 * new one: a burst of 401s (a key rotation) costs one refresh, not one each (found by
 * tools/stress/faults.mjs).
 */
export const guardAuthFor = (name: string): GuardAuth => ({
  token: () => accessToken(name),
  onUnauthorized: async (rejected) => {
    const state = entry(name);
    if (state.refreshing) { await state.refreshing; return; }
    if (rejected && state.tokens && state.tokens.accessToken !== rejected) return;
    await accessToken(name, { force: true });
  },
});

/** Signs out of a profile here and in the other tabs, then ends the provider's session when it offers to. */
export async function signOut(name: string): Promise<void> {
  const state = entry(name), idToken = state.tokens?.idToken;
  forget(name, "signed-out");
  page().broadcast({ kind: "signed-out", profile: name });
  const metadata = state.metadata ?? (profiles[name] ? await metadataOf(name).catch(() => null) : null);
  if (metadata?.endSessionEndpoint) {
    const url = new URL(metadata.endSessionEndpoint);
    if (idToken) url.searchParams.set("id_token_hint", idToken);
    url.searchParams.set("post_logout_redirect_uri", `${page().origin()}${redirectBase}`);
    page().assign(url.href);
  }
}

/**
 * Called once on an ordinary load, after `completeSignInIfCallback`: a reload loses the tokens (they
 * live in memory only), so a profile this tab was signed in to goes back through the provider's
 * session without a prompt, under the silent loop guard. True when the page is being sent to the
 * provider, so the caller need not draw it.
 */
export async function resumeSessions(): Promise<boolean> {
  for (const name of Object.keys(profiles)) {
    const state = entry(name);
    if (state.tokens || page().session.getItem(`${RESUME}${name}`) !== "1") continue;
    await silentSignIn(name);
    if (entry(name).status === "signing-in") return true;
  }
  return false;
}

/** For the tests: forgets every profile and token, as a fresh page would. */
export function resetAuth() { for (const state of live.values()) clearTimeout(state.timer ?? undefined); live.clear(); profiles = {}; view = { profiles: {} }; }

/** For the tests and diagnostics: whether any token is held, without revealing it. */
export const holdsTokens = (name: string) => entry(name).tokens !== null;
