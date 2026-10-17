# Upgrading the deck in your cloud

The deck is delivered as signed, versioned releases that you pull into your own environment. Nothing
in it calls back to us: no telemetry, no licence check over the network, no update download. This
page says what a version number promises, how to take a release, and how to go back.

## One version for everything

The SDK packages (`@ikhmalputra/subsurface-core`, `@ikhmalputra/subsurface-react`), the deck
bundle and the deck image share one version (changesets, `fixed` group). The built deck carries it
in `version.json` beside its pages:

```json
{
  "version": "0.4.0",
  "commit": "9f1376612",
  "builtAt": "2026-10-17T15:40:00.000Z",
  "schemas": { "config": 1, "contract": "1.1" },
  "minUpgradeFrom": "0.0.1"
}
```

- `schemas.config` is the `config.json` schema the build reads (`docs/schemas/deck-config.v1.json`).
- `schemas.contract` is the data contract version your backend's files or adapter must speak.
- `minUpgradeFrom` is the oldest release this one upgrades from in a single step. Coming from an
  older one, step through a release in between.

The server answers `/version.json` with the same file, so a probe or a dashboard can read what is
deployed.

## What a version number promises

We stay on **0.x until the first production install**; from 1.0:

| Bump | When |
|---|---|
| **Major** | the `config.json` schema changes incompatibly; the data contract's major version changes; a browser-storage schema changes without a migration; an SDK export is removed |
| **Minor** | a new tool, source type, config key, adapter or SDK export; a storage migration that runs forward on its own |
| **Patch** | fixes only; no change to any schema or export |

Every change a client can notice is written for the person upgrading in `CHANGELOG.md` of each
package.

## Taking a release

1. **Pull** the release from the registry you were given access to, by tag, then record its digest:
   the image, and the static bundle, SBOMs and signatures published beside it as OCI artifacts.
2. **Verify** before anything is deployed, with our public key:
   ```
   cosign verify --key subsurface.pub <registry>/subsurface-deck@sha256:<digest>
   node tools/release/verify-release.mjs release-manifest.json --key subsurface.pub
   ```
   `verify-release.mjs` checks every checksum and signature in the manifest, that each SBOM
   belongs to the artifact beside it, and that the bundle's `version.json` names the release. A
   Kyverno policy that admits only images signed with the key is in `deploy/policy/` (with the
   container phase).
3. **Mirror** into your own registry and deploy by digest, never by tag, so what runs is what was
   verified.
4. **Check** `/version.json` and `/readyz` on the new deployment.

Open tabs learn of the new release on their own: the deck re-reads `version.json` on its origin
every five minutes and when the tab comes back into view, and shows **Updated to x.y.z · Reload**
in its lens bar. Nothing is forced; the person reloads when their work allows.

## Going back

Rolling back is redeploying the previous digest. Two things make it safe:

- Browser data a newer release migrated forward opens **read-only** under the older release, with a
  line saying so; nothing is deleted or rewritten (the storage registry; see "Not yet" below).
- `config.json` keys a newer release added are reported by the older one as unknown and ignored
  (or refused by the deployment's renderer in strict mode), never acted on silently.

## Support window

- The current release (N) and the one before it (N−1) receive fixes.
- N−2 receives security fixes only.
- A release's `minUpgradeFrom` is never older than N−3, so a client at N−3 reaches N in one step.

## Compatibility of your own pieces

| Yours | Checked by |
|---|---|
| `config.json` | `parseDeckConfig` at start; the Data sources tool lists what was ignored; the renderer refuses unknown keys in strict mode |
| contract-json files | `format` and `version` in each file; the contract validators per record, with reasons in Data sources |
| OSDU adapter | the record kinds and bulk-data layouts named in `docs/TENANT_DATA_MAP.md`; a change in the platform's schema shows up as stated problems, never as a crash (fuzzed; see `docs/STRESS_TEST.md`) |
| SDK imports | `tools/verify-packages.mjs` installs the packed release in a clean project and imports every entry point |

## Not yet (and said so)

- The container image, the Helm chart and the rendered CSP arrive with the container phase (P1);
  until then the release is the static bundle and the npm packages.
- The storage registry with migrations and the read-only rule under rollback arrives with the
  browser-state phase (P6). Until then, user-authored data in the browser is kept as it was written,
  and the workspace export is the safe copy.
- The signing key lives in a cloud KMS once the first production client is set up; releases made
  before that are marked `"signed": false` in their manifest and `verify-release.mjs` refuses them
  unless told `--allow-unsigned`.
