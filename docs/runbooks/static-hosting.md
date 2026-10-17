# Runbook: hosting the deck as static files

The deck is static files: `index.html`, `deck/`, `developers/`, `assets/`, the data and model
folders, `config.json` and `version.json`. Any host that serves files with the right headers runs
it. The container image (with `/healthz`, `/readyz` and the rendered CSP) arrives with the
container phase; this page covers plain file hosting now.

## What you need

- The release's `subsurface-deck-<version>.tgz`, verified (`docs/UPGRADING.md`).
- Your `config.json` (the schema: `docs/schemas/deck-config.v1.json`): your sources and your
  identity provider. No secret ever goes in it.
- The deck's origin registered on your identity provider (redirect `https://<host><base>deck/`) and
  allowed by your platform's CORS (`docs/IDP_GUIDE.md`).

## Headers every host must send

For every HTML page (the three `index.html`):

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval' <script hashes>; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self' <your platform origin> <your identity provider origins>; object-src 'none'; base-uri 'none'; frame-ancestors 'self'
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cross-Origin-Opener-Policy: same-origin
```

- `<script hashes>` are the `sha256-…` of the inline module-preload scripts Vite writes into each
  page. `node tools/serve.mjs` (with `out/` built) serves the pages with them computed:
  `curl -sI http://127.0.0.1:3100/deck/ | grep -i content-security-policy` shows the exact line
  to copy. The container phase renders the whole header from your `config.json`.
- `connect-src` lists your platform's origin and your provider's issuer origin (and token endpoint
  origin when it differs, as on Cognito). Nothing else. Until the container phase, add them to the
  copied line by hand; `connectOrigins()` in `@ikhmalputra/subsurface-core/deck-config` lists them
  for a parsed config.
- `version.json` and `config.json`: `Cache-Control: no-store`. Hashed assets under `assets/`:
  `Cache-Control: public, max-age=31536000, immutable`. The HTML pages: `no-cache`.
- `.well-known/security.txt` is in the bundle; keep it at the site root.

## Base path

The bundle is built for the site root (`/`). To serve under a path (`https://host/apps/deck/`),
rebuild with `DECK_BASE=/apps/deck/` or wait for the container phase, which serves any base path
from one image.

## Amazon S3 + CloudFront

1. Upload the bundle's contents to the bucket; keep the bucket private, with CloudFront's origin
   access control.
2. Add a **response headers policy** with the headers above (CSP as a custom header), attached to
   the distribution's default behaviour.
3. Cache behaviours: `assets/*` cached long; `*.json` at the root `no-store`; `index.html` short.
4. Error pages: none needed; the deck has no client-side routes beyond its three pages.
5. Put your `config.json` in the bucket beside `index.html`; update it without a new deployment.

Check: `curl -sI https://<host>/deck/ | grep -i content-security-policy` shows your platform's
origin, and `https://<host>/version.json` shows the release.

## Azure Static Web Apps

1. Deploy the bundle's contents as the app artifact (no API, no build step).
2. `staticwebapp.config.json` at the root:
   ```json
   {
     "globalHeaders": {
       "Content-Security-Policy": "…as above…",
       "Referrer-Policy": "no-referrer",
       "X-Content-Type-Options": "nosniff"
     },
     "routes": [
       { "route": "/assets/*", "headers": { "Cache-Control": "public, max-age=31536000, immutable" } },
       { "route": "/config.json", "headers": { "Cache-Control": "no-store" } },
       { "route": "/version.json", "headers": { "Cache-Control": "no-store" } }
     ],
     "navigationFallback": { "rewrite": "/index.html", "exclude": ["/assets/*", "/data/*", "/*.json"] }
   }
   ```
3. Authentication stays with the deck (your OIDC provider), not with Static Web Apps' built-in
   auth: do not put the deck behind a provider-level login that strips the redirect.

## nginx

```nginx
location / {
  root /srv/deck;
  add_header Content-Security-Policy "…as above…" always;
  add_header Referrer-Policy no-referrer always;
  add_header X-Content-Type-Options nosniff always;
  location ~* ^/(config|version)\.json$ { add_header Cache-Control no-store always; }
  location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable" always; }
}
```

## After deploying

1. `/version.json` names the release you verified.
2. Open the deck: the lens bar shows "The world"; the Data sources tool lists your sources and,
   with an `auth` profile, a Sign in button.
3. Sign in, open a field, copy the diagnostics from Data sources and keep them with the deployment
   record: they name the build, the browser and the sources, nothing else.
4. Rolling back is redeploying the previous bundle.
