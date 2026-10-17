#!/usr/bin/env node
// A mock OpenID provider for the deck's sign-in and for the mock OSDU's token check. Discovery,
// authorization code with PKCE (S256 required), refresh tokens that rotate and whose replay revokes
// the family, an ephemeral ES256 key published at /jwks, end-session, and two knobs for tests: the
// token lifetime and a clock skew applied to every token's times.
//
//   node tools/mock-osdu/idp.mjs --port 4102 [--token-ttl 300] [--clock-skew 0] [--issuer http://127.0.0.1:4102]
//
// Everyone who arrives is signed in as one synthetic user (auto-consent): sub "mock-user", or the
// login_hint. Nothing here is a real identity. Plain node:http and node:crypto, no dependencies.
import { createServer } from "node:http";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { randomToken, sha256b64url, signJwt } from "./jwt.mjs";

const CODE_TTL_S = 60, SESSION_COOKIE = "mock_idp_session";

export function createIdp({ port = 4102, host = "127.0.0.1", issuer, tokenTtlS = 300, clockSkewS = 0, audience = "osdu", log = () => {} } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const kid = randomUUID();
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "ES256" };
  const codes = new Map(), refreshTokens = new Map(), families = new Map(), sessions = new Set();
  let base = issuer ?? null, server = null;
  const nowS = () => Math.floor(Date.now() / 1000) + clockSkewS;

  const accessToken = (sub, scope, clientId) => signJwt({ iss: base, sub, aud: [audience, clientId], iat: nowS(), nbf: nowS() - 5, exp: nowS() + tokenTtlS, scope, jti: randomUUID(), name: "Mock User", email: `${sub}@example.invalid` }, privateKey, kid);
  const idToken = (sub, clientId, nonce, authTime) => signJwt({ iss: base, sub, aud: clientId, iat: nowS(), exp: nowS() + tokenTtlS, auth_time: authTime, nonce, name: "Mock User", preferred_username: sub, email: `${sub}@example.invalid` }, privateKey, kid);
  const issueRefresh = (family, grant) => { const token = randomToken(); refreshTokens.set(token, { family, used: false, ...grant }); return token; };
  const tokenResponse = (grant, family) => ({ access_token: accessToken(grant.sub, grant.scope, grant.clientId), token_type: "Bearer", expires_in: tokenTtlS, scope: grant.scope, id_token: idToken(grant.sub, grant.clientId, grant.nonce, grant.authTime), refresh_token: issueRefresh(family, grant) });

  const json = (response, status, body, headers = {}) => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", pragma: "no-cache", ...headers }); response.end(JSON.stringify(body)); };
  const redirect = (response, url) => { response.writeHead(302, { location: url, "cache-control": "no-store" }); response.end(); };
  const cookieOf = (request) => (request.headers.cookie ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  const readForm = (request) => new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; if (body.length > 65536) { reject(new Error("body too large")); request.destroy(); } });
    request.on("end", () => resolve(new URLSearchParams(body)));
    request.on("error", reject);
  });
  const cors = (request, response) => {
    // Public endpoints answer any origin: a browser deck on any host may fetch discovery, the keys and tokens.
    if (request.headers.origin) response.setHeader("access-control-allow-origin", "*");
    if (request.method === "OPTIONS") { response.writeHead(204, { "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, authorization", "access-control-max-age": "600" }); response.end(); return true; }
    return false;
  };

  async function handle(request, response) {
    const url = new URL(request.url, base);
    log(`${request.method} ${url.pathname}`);
    if (cors(request, response)) return;
    const path = url.pathname;
    if (path === "/.well-known/openid-configuration" && request.method === "GET") {
      return json(response, 200, {
        issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, jwks_uri: `${base}/jwks`, end_session_endpoint: `${base}/logout`, userinfo_endpoint: `${base}/userinfo`,
        response_types_supported: ["code"], response_modes_supported: ["query"], grant_types_supported: ["authorization_code", "refresh_token"], subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["ES256"], scopes_supported: ["openid", "profile", "email", "offline_access"], token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"], claims_supported: ["sub", "name", "email", "nonce"],
      });
    }
    if (path === "/jwks" && request.method === "GET") return json(response, 200, { keys: [jwk] }, { "cache-control": "public, max-age=60" });
    if (path === "/authorize" && request.method === "GET") {
      const q = url.searchParams;
      const redirectUri = q.get("redirect_uri"), state = q.get("state");
      let target;
      try { target = new URL(redirectUri); if (!/^https?:$/.test(target.protocol)) throw new Error(); } catch { return json(response, 400, { error: "invalid_request", error_description: "redirect_uri must be an absolute http(s) URL" }); }
      const fail = (error, description) => { target.searchParams.set("error", error); target.searchParams.set("error_description", description); if (state) target.searchParams.set("state", state); return redirect(response, target.href); };
      if (q.get("response_type") !== "code") return fail("unsupported_response_type", "only response_type=code is supported");
      if (!q.get("client_id")) return fail("invalid_request", "client_id is required");
      if (!(q.get("scope") ?? "").split(/\s+/).includes("openid")) return fail("invalid_scope", "scope must include openid");
      if (q.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(q.get("code_challenge") ?? "")) return fail("invalid_request", "PKCE with code_challenge_method=S256 is required");
      const session = cookieOf(request);
      const signedIn = session !== undefined && sessions.has(session);
      if (q.get("prompt") === "none" && !signedIn) return fail("login_required", "no session: interactive sign-in is required");
      const sub = q.get("login_hint")?.trim() || "mock-user";
      const code = randomToken(24);
      codes.set(code, { clientId: q.get("client_id"), redirectUri, codeChallenge: q.get("code_challenge"), nonce: q.get("nonce") ?? undefined, scope: q.get("scope"), sub, authTime: nowS(), expiresAt: Date.now() + CODE_TTL_S * 1000 });
      target.searchParams.set("code", code);
      if (state) target.searchParams.set("state", state);
      if (!signedIn) { const id = randomToken(16); sessions.add(id); response.setHeader("set-cookie", `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax`); }
      return redirect(response, target.href);
    }
    if (path === "/token" && request.method === "POST") {
      if (!/^application\/x-www-form-urlencoded/.test(request.headers["content-type"] ?? "")) return json(response, 400, { error: "invalid_request", error_description: "the token request is application/x-www-form-urlencoded" });
      const form = await readForm(request);
      const grantType = form.get("grant_type");
      if (grantType === "authorization_code") {
        const code = form.get("code"), verifier = form.get("code_verifier");
        const grant = code ? codes.get(code) : undefined;
        if (grant) codes.delete(code);
        if (!grant || grant.expiresAt < Date.now()) return json(response, 400, { error: "invalid_grant", error_description: "the authorization code is unknown, used or expired" });
        if (form.get("redirect_uri") !== grant.redirectUri) return json(response, 400, { error: "invalid_grant", error_description: "redirect_uri does not match the authorization request" });
        if (form.get("client_id") && form.get("client_id") !== grant.clientId) return json(response, 400, { error: "invalid_client", error_description: "client_id does not match the authorization request" });
        if (!verifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || sha256b64url(verifier) !== grant.codeChallenge) return json(response, 400, { error: "invalid_grant", error_description: "PKCE code_verifier does not match code_challenge" });
        const family = randomUUID();
        families.set(family, { revoked: false, sub: grant.sub });
        return json(response, 200, tokenResponse(grant, family));
      }
      if (grantType === "refresh_token") {
        const presented = form.get("refresh_token");
        const entry = presented ? refreshTokens.get(presented) : undefined;
        if (!entry) return json(response, 400, { error: "invalid_grant", error_description: "unknown refresh token" });
        const family = families.get(entry.family);
        if (!family || family.revoked) return json(response, 400, { error: "invalid_grant", error_description: "the refresh token's family was revoked" });
        if (entry.used) {
          // A rotated token presented again: someone holds a stolen copy. The whole family dies.
          family.revoked = true;
          for (const [token, other] of refreshTokens) if (other.family === entry.family) refreshTokens.delete(token);
          return json(response, 400, { error: "invalid_grant", error_description: "refresh token reuse detected: the token family was revoked" });
        }
        entry.used = true;
        return json(response, 200, tokenResponse(entry, entry.family));
      }
      return json(response, 400, { error: "unsupported_grant_type", error_description: "authorization_code or refresh_token" });
    }
    if (path === "/logout" && (request.method === "GET" || request.method === "POST")) {
      const q = request.method === "GET" ? url.searchParams : await readForm(request);
      const session = cookieOf(request);
      if (session) sessions.delete(session);
      response.setHeader("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      const after = q.get("post_logout_redirect_uri");
      if (after) {
        try { const target = new URL(after); if (q.get("state")) target.searchParams.set("state", q.get("state")); return redirect(response, target.href); } catch { /* fall through to the page */ }
      }
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      return response.end("Signed out of the mock identity provider.\n");
    }
    if (path === "/userinfo" && request.method === "GET") {
      const sub = "mock-user";
      return json(response, 200, { sub, name: "Mock User", preferred_username: sub, email: `${sub}@example.invalid` });
    }
    json(response, 404, { error: "not_found", error_description: `${request.method} ${path} is not an endpoint of the mock identity provider` });
  }

  return {
    get issuer() { return base; },
    get kid() { return kid; },
    jwks: () => ({ keys: [jwk] }),
    /** A token signed here outside any flow, for tests that need one in a line. */
    mintAccessToken: (claims = {}) => signJwt({ iss: base, sub: "mock-user", aud: [audience, "test"], iat: nowS(), exp: nowS() + tokenTtlS, scope: "openid", ...claims }, privateKey, kid),
    listen: () => new Promise((resolve, reject) => {
      server = createServer((request, response) => handle(request, response).catch((error) => { if (!response.headersSent) json(response, 500, { error: "server_error", error_description: error.message }); else response.destroy(); }));
      server.on("error", reject);
      server.listen(port, host, () => { const address = server.address(); base ??= `http://${host}:${address.port}`; resolve({ port: address.port, issuer: base }); });
    }),
    close: () => new Promise((resolve) => { if (!server) return resolve(); server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

export function parseIdpArgs(argv) {
  const flag = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
  return { port: Number(flag("--port", "4102")), tokenTtlS: Number(flag("--token-ttl", "300")), clockSkewS: Number(flag("--clock-skew", "0")), issuer: flag("--issuer", undefined) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseIdpArgs(process.argv.slice(2));
  const idp = createIdp({ ...options, log: (line) => console.log(`[idp] ${line}`) });
  idp.listen().then(({ issuer }) => console.log(`Mock identity provider at ${issuer} (token ttl ${options.tokenTtlS} s, clock skew ${options.clockSkewS} s)\n  discovery ${issuer}/.well-known/openid-configuration`));
}
