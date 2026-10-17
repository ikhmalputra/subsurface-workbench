# Security

The deck runs inside each client's own cloud, on the client's own backend, with the client's own
identity provider. We never hold a client's data, and the software never calls back to us.

## Reporting a vulnerability

Report privately through GitHub's advisory form for this repository:
https://github.com/ikhmalputra/subsurface-workbench/security/advisories/new

Please do not open a public issue for a security problem. Include the release (`/version.json` on
the deployment, or the `version` in `release-manifest.json`), the browser, and the steps. The same
address is published by every deployment at `/.well-known/security.txt`.

## What to expect

| Step | Within |
|---|---|
| Acknowledgement | 2 working days |
| Assessment and severity (CVSS 3.1) | 5 working days |
| Fix for a critical or high finding, as a patch release of N and N−1 (security fix for N−2) | 14 days |
| Fix for a medium or low finding | the next minor release |
| Credit in the release notes, if wanted | on release |

Supported releases are N, N−1 and (security fixes only) N−2: see `docs/UPGRADING.md`.

## What the deck does and does not do

- **No data leaves the client's cloud.** The browser talks only to the deck's own origin, the
  client's data platform and the client's identity provider; a deployment's Content-Security-Policy
  `connect-src` is rendered from its `config.json` and allows nothing else. There is no telemetry.
- **No secrets in the deck.** The deck is a public OpenID Connect client with PKCE. A `config.json`
  holding a credential is refused. Tokens live in memory only, never in storage or the URL.
- **Read-only toward client systems.** The deck reads; it never writes to the platform.
- **Share links carry references, not data**, in the client default (`share.mode: "reference"`).
- **Every record is checked at the boundary**, and the parsers are fuzzed on every commit
  (`docs/STRESS_TEST.md`); hostile names and misshapen records are reported, never executed or
  trusted. There is no `innerHTML` in the deck.
- **Releases are signed** (cosign) with SBOMs (CycloneDX); clients verify before deploying
  (`tools/release/verify-release.mjs`).

Details, with the threat model: `docs/compliance/THREAT_MODEL.md` and `docs/compliance/DATA_FLOW.md`.
