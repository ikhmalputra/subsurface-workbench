# Signing the deck in with your identity provider

The deck signs users in with your own OpenID Connect provider, as a **public client** using the authorization code flow with PKCE. It never holds a client secret, keeps tokens in memory only, and sends each request to your OSDU platform with the user's own bearer token. Nothing about the sign-in leaves your cloud.

## What the deck needs from you

1. **Register a public (SPA) client** on your provider, with:
   - Redirect URI: `https://<your-deck-host><base path>deck/` (for a deck at the domain root, `https://deck.example.com/deck/`).
   - Post-logout redirect URI: `https://<your-deck-host><base path>`.
   - PKCE required; no client secret issued.
   - Refresh tokens allowed for SPAs if your provider supports it (so a session survives the token's life without a redirect).
2. **Grant the scopes** the platform needs. For OSDU that is usually `openid profile offline_access` plus the platform's own resource scope.
3. **Put the profile in `config.json`** beside the deck:
   ```json
   {
     "version": 1,
     "sources": [ { "type": "osdu", "label": "Our OSDU", "url": "https://osdu.example.com", "dataPartition": "opendes", "auth": "corp" } ],
     "auth": { "corp": { "issuer": "https://login.example.com/tenant", "clientId": "11111111-…", "scopes": ["openid", "profile", "offline_access", "api://osdu/.default"] } }
   }
   ```
   A config that holds a secret is refused.
4. **Allow the deck's origin on the platform (CORS).** The browser calls your OSDU directly, so the platform's allowed origins must include the deck's origin, with the `authorization`, `data-partition-id` and `content-type` headers. This is the most common cause of "could not reach the platform". Also **expose `Retry-After`** (`Access-Control-Expose-Headers: Retry-After`): without it the browser hides how long a rate-limited platform asked the deck to wait, and the deck has to guess (from one second, doubling).
5. **Compress JSON on the platform's ingress** (gzip or Brotli for `application/json`; on ingress-nginx, `use-gzip: "true"`, which is off by default). A 200-well field's detail is about 2.8 MB uncompressed; over a slow VPN or a site link that is the difference between seconds and a minute. The browser decompresses on its own; the deck needs nothing.
6. **Entitlements.** The users need the platform's groups for the partition (e.g. `users.datalake.viewers` and the data groups). A 403 in the Data sources tool names the partition.

The deployment's Content-Security-Policy `connect-src` is rendered from the config: the platform's origin and the provider's origins are added automatically. Only when a provider's token endpoint is on **another host** than its issuer (Cognito, some Entra configurations) do you need to name it: `"metadata": { "tokenEndpoint": "https://…" }`, or add the origin under `"csp": { "connectSrc": [...] }`.

## Provider notes

### Microsoft Entra ID
- Issuer: `https://login.microsoftonline.com/<tenant-id>/v2.0`.
- App registration → Authentication → Single-page application platform → the redirect URI above. PKCE is on by default for SPAs; "Allow public client flows" is **not** needed.
- Scopes: `openid profile offline_access` plus the OSDU app's exposed scope, e.g. `api://<osdu-app-id>/.default` (or the delegated scope name the platform publishes). Grant admin consent if your tenant requires it.
- Tokens are issued by `login.microsoftonline.com`; no extra `metadata` is needed.

### Okta
- Issuer: `https://<org>.okta.com/oauth2/default` (or a custom authorization server's issuer).
- Create an **OIDC Single-Page Application** with Authorization Code + Refresh Token grants, the redirect and sign-out URIs above, and the deck's origin under Security → API → Trusted Origins (CORS and Redirect).
- Scopes: `openid profile offline_access` plus the custom scope your OSDU accepts.

### Keycloak
- Issuer: `https://<host>/realms/<realm>`.
- Client: type OpenID Connect, Client authentication **off**, Standard flow on, PKCE method `S256` (Advanced → Proof Key for Code Exchange), Valid redirect URIs and Valid post logout redirect URIs as above, Web origins = the deck's origin.
- Scopes: `openid profile offline_access`; add an audience mapper so the access token carries the platform's audience.

### Amazon Cognito
- Issuer: `https://cognito-idp.<region>.amazonaws.com/<user-pool-id>`.
- App client: public (no secret), Authorization code grant, the callback and sign-out URLs above, PKCE on.
- The token endpoint is on the Cognito **domain** (`https://<domain>.auth.<region>.amazoncognito.com/oauth2/token`), not on the issuer's host: set `"metadata": { "tokenEndpoint": "…", "endSessionEndpoint": "https://<domain>.auth.<region>.amazoncognito.com/logout" }` in the profile so the CSP allows it.
- Scopes: `openid profile email` plus a resource-server scope for the platform. Cognito does not issue `offline_access`; refresh tokens come with the authorization code grant regardless.

### Google
- Google issues refresh tokens to confidential clients only, and its SPA flow does not fit a public client with PKCE as the deck uses it. Put an OIDC provider that supports public clients in front of it (Keycloak with a Google identity provider, for example).

## How the deck behaves

- **Sign in** sends the user to the provider; on return the deck exchanges the code once, checks the state and nonce, and cleans the address bar.
- **Tokens are kept in memory.** Reloading the page loses them; the deck then goes silently through the provider's session (`prompt=none`), which takes about a second. At most two such silent redirects happen in five minutes; after that the Data sources tool shows a Sign in button.
- **Refresh** happens once, for everyone who needs it, at 80 % of the token's life or when the platform answers 401.
- **Sign out** clears the tokens in every open tab and ends the provider's session (`end_session_endpoint`) with the id token hint.
- The samples and the wells kept in the user's browser work without signing in.

## Checking it

Run the deck against the mock provider and platform in `tools/mock-osdu/` (see its README) before pointing it at the real ones. `tools/e2e/auth.mjs` in the nightly tier walks the whole flow, including a revoked refresh token and a clock skew of a few minutes.
