---
"@ikhmalputra/subsurface-core": minor
"@ikhmalputra/subsurface-react": minor
"deck": minor
---

The deck runs on a tenant's own backend: the data contract (`./data-contract`), runtime
`config.json` (`./deck-config`, schema 1), guarded fetches (`./fetch-guard`), the OSDU adapter
(`./osdu`), sign-in with the tenant's OpenID Connect provider, any EPSG CRS (`./gis`), the Data
sources tool, header-first reading measured at 200,000 wells, fuzzing of every parser, and
`version.json` with an in-deck update notice.
