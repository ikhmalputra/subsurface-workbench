# Threat model

STRIDE over the deck as deployed in a client's cloud (`DATA_FLOW.md`). Each row names what in the
code answers the threat, and the check that proves it. Rows marked *planned* name the phase.

## Assets

1. The client's subsurface data, read from their platform into the browser.
2. The person's tokens and identity.
3. The person's own entries in browser storage.
4. The integrity of the deck's code as served.

## Threats and answers

| | Threat | Answer in the code | Proved by |
|---|---|---|---|
| **S**poofing | A page pretending to be the deck captures the sign-in | The provider only redirects to the registered `https://<host><base>deck/`; the deck checks `state` and `nonce` and refuses a callback it did not start or one older than its TTL | `apps/deck/test/oidc.test.ts` (state and nonce mismatches refused) |
| | A forged `version.json` makes the deck "update" to something else | The file is read from the deck's own origin only and offers a reload of that origin; it never loads code from the file | `apps/deck/test/version.test.ts` |
| | A forged release | cosign signatures over every artifact and the manifest; the client verifies with our public key before deploying | `tools/release/verify-release.mjs`, `release.test.mjs` |
| **T**ampering | A hostile or drifted record from the platform (HTML in names, `__proto__` keys, NaN, wrong shapes, units named `constructor`) | Every record is validated at the boundary; names are rendered as text (no `innerHTML`); units and tables are read by own keys; a misshapen record costs itself, never the batch | fuzzing on every commit, `docs/STRESS_TEST.md`; `tools/e2e/xss.mjs` *planned* (P8, needs the mock) |
| | A tampered share link | base64url and deflate checked; the payload is shape-validated; a refused link says so in words | share codec fuzz properties |
| | A modified `config.json` adds a source outside the client | The CSP `connect-src` is rendered from the config at deployment; a source origin not in it is blocked by the browser; a credential in the config is refused | `deck-config.test.ts`; `deploy/render.test.mjs` *planned* (P1) |
| **R**epudiation | Who read what | Every platform request carries the person's own token: the platform's audit log is the record. The deck adds nothing and hides nothing | by design; no deck-side log of reads |
| **I**nformation disclosure | A token leaks through storage, the URL, history, an error message or a log | Tokens are held in memory; `sessionStorage` holds only `state`, `nonce`, `verifier` and `returnTo` until the callback; the URL is cleaned; `fetchGuarded` redacts; the diagnostics bundle carries kinds of error, not text | `oidc.test.ts` (no token in any storage), `fetch-guard.test.ts`, `diagnostics.test.ts` |
| | A client's well travels in a share link or a support bundle | `share.mode: "reference"` is the client default; the bundle holds counts and origins only | `diagnostics.test.ts`; `share.test.ts` *planned* (P6) |
| | Data reaches the vendor | The browser can connect only to the origins in the CSP; the host makes no outbound calls; there is no telemetry | `tools/e2e/csp-egress.mjs` *planned* (P8, needs the container); a static scan of `out/` for absolute URLs *planned* |
| | Another person at the same browser | Per-user storage namespacing *planned* (P6, keyed by a hash of `sub`), with "Clear local data on sign-out" | — |
| **D**enial of service | A platform that serves 200,000 wells, or a file that never ends | Headers first, detail per field on demand, batches with concurrency and abort, 250k-well and 64 MB caps, byte cap enforced as the body streams, clustering and virtual lists | `docs/STRESS_TEST.md` (200k wells measured), `fetch-guard.test.ts` |
| | A parser fed a crafted file | Every parser refuses in words; no negative or unbounded allocation; fuzzed with mutated real files | fuzz properties `las/*`, `quakeml/*`, `segy/*` |
| | A refresh storm against the provider | Single-flight refresh; silent renewal capped at two per five minutes | `oidc.test.ts` |
| **E**levation of privilege | The deck acting beyond the person | The deck holds no credential of its own; every request is the person's token with the person's entitlements; a 403 is shown with the partition and the group needed | `osdu.test.ts` (`describeOsduError`) |
| | Script injection through data | CSP `script-src 'self'` with hashes; no `innerHTML`, no `eval`; an ESLint rule *planned* bans `innerHTML` and `dangerouslySetInnerHTML` | lint; `xss.mjs` *planned* |

## Out of scope, and said so

- The client's platform, identity provider, network and endpoints are the client's.
- Write-back to client systems does not exist yet; when it does, it gets its own model.
- An external penetration test is planned before the first production client.
