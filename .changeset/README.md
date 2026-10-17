# Changesets

One version for the SDK packages and the deck (the `fixed` group): a release of any of them is a
release of all three, and `version.json` in the built deck carries that version.

- Every change a client can notice gets a changeset: `pnpm changeset`, then describe it for the
  person upgrading, not for the person who wrote it.
- `pnpm version` (changeset version) bumps the three packages together and writes the changelogs.
- What counts as a major bump, and the support window, are in `docs/UPGRADING.md`.
- The deck stays on 0.x until the first production install.
