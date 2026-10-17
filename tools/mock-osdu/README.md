# Mock OSDU platform and identity provider

A stand-in for a tenant's OSDU platform and its OpenID provider, for building and stress-testing
the OSDU adapter (`packages/core/src/osdu.ts`) and the deck's sign-in without a real tenant. Plain
Node `http` and `crypto`, no dependencies. Everything it serves is synthetic and labelled so.

```
pnpm mock:osdu                      # OSDU on :4100, admin on :4101, identity provider on :4102
pnpm test:mock-osdu                 # node --test tools/mock-osdu/mock.test.mjs
```

```
node tools/mock-osdu/server.mjs --wells 200000 --per-field 200 --profile quirky --port 4100 \
  --admin-port 4101 --allow-origin http://127.0.0.1:8080 --partition opendes \
  --idp http://127.0.0.1:4102 --seed 7
node tools/mock-osdu/idp.mjs --port 4102 --token-ttl 300 --clock-skew 0
```

Without `--idp` the platform starts an identity provider in its own process on `--idp-port`
(default 4102) and trusts only that one. Point a deck build at it with

```json
{ "sources": [ { "type": "osdu", "label": "Mock OSDU", "url": "http://127.0.0.1:4100", "dataPartition": "opendes", "auth": "mock" } ],
  "auth": { "mock": { "issuer": "http://127.0.0.1:4102", "clientId": "deck", "scopes": ["openid", "profile", "offline_access"] } } }
```

and serve the deck from the origin given as `--allow-origin`; any other origin is refused by CORS.

## Options

| Flag | Default | Meaning |
|---|---|---|
| `--wells` | 1000 (huge: 200000) | wells in the tenant |
| `--per-field` | 200 | wells per field; field f holds wells `t(f·perField)` … |
| `--stations` | 300 (huge: 2000) | survey stations per well |
| `--profile` | clean | `clean`, `quirky`, `hostile` or `huge` (below) |
| `--port` / `--admin-port` | 4100 / 4101 | the platform and its admin API |
| `--allow-origin` | http://127.0.0.1:8080 | the one origin CORS admits |
| `--partition` | opendes | the `data-partition-id` every request must carry |
| `--idp` | (embedded) | the identity provider whose tokens are accepted |
| `--idp-port`, `--token-ttl`, `--clock-skew` | 4102, 300, 0 | the embedded identity provider |
| `--seed` | 7 | the fault engine's seed |
| `--cursor-ttl` | 60 | seconds a search cursor lives idle |

## The data

The wells are the stress tenant of `tools/stress/tenant.mjs`: field f is `tenant({ seed: 7 + f })`
renamed and placed exactly as `writeTenant` does, so this platform and a contract-json stress
tenant written with the same numbers hold the same wells at the same places. Fields are generated
when first asked for and a few are cached; a 200,000-well tenant costs nothing until read.

Record kinds, with ids `opendes:<group>--<Entity>:<name>` and references ending in `:`:

| Kind | What it carries |
|---|---|
| `osdu:wks:master-data--Well:1.3.0` | FacilityName, one UWI alias, GeoContexts → Field, Wgs84Coordinates and AsIngestedCoordinates (ED50 / UTM 31N, EPSG::23031), OperatingEnvironment Offshore, CurrentOperatorID, a GL vertical measurement |
| `osdu:wks:master-data--Field:1.0.0` | FieldName |
| `osdu:wks:master-data--Wellbore:1.5.0` | WellID, RKB (Kelly Bushing above MSL) and TD (Measured Depth) measurements, DefaultVerticalMeasurementID RKB, DefinitiveTrajectoryID |
| `osdu:wks:work-product-component--WellboreTrajectory:1.3.0` | WellboreID, AzimuthReferenceType Grid North, AvailableTrajectoryStationProperties (MD, Inclination, AzimuthGN, TVD, DX, DY → columns MD, INCL, AZIM, TVD, DX, DY in m and dega) |
| `osdu:wks:work-product-component--WellboreMarkerSet:1.2.0` | WellboreID, 20 inline Markers (Formation Top), AvailableMarkerProperties |

## Endpoints

Every request needs `Authorization: Bearer <access token>` signed by the identity provider (ES256,
checked against its JWKS; otherwise 401) and `data-partition-id: <partition>` (otherwise 403 with
an entitlements message). Responses carry `x-request-id`.

- `POST /api/search/v2/query_with_cursor` `{ kind, query, limit ≤ 1000, returnedFields?, cursor? }`
  → `{ results: [{ id, kind, data }], cursor?, totalCount }`. The cursor is opaque and stateful,
  consumed by the page it serves, and gone after `--cursor-ttl` idle seconds: then
  `400 { code: 400, reason: "cursor expired" }`. The last page has no cursor. Kinds may be patterns
  (`*:*:master-data--Well:1.*.*`). The query is the slice of Lucene the adapter sends: `*`, empty,
  `id:("a" OR "b")`, `data.WellID:(…)`, `data.WellboreID:(…)`, values quoted or bare, with or
  without the trailing colon; anything else is a 400 as the real Search gives.
- `POST /api/search/v2/query` `{ kind, query, limit, offset, returnedFields? }` → the same without a
  cursor (offset + limit ≤ 10,000).
- `GET /api/os-wellbore-ddms/ddms/v3/wellboretrajectories/:id/data?curves=MD,INCL&orient=split|columns`
  → pandas JSON: `{ columns, index, data }` or `{ column: { row: value } }`; default `split`.
  Unknown curve → 400; unknown id → 404 OSDU-style.
- `GET /api/os-wellbore-ddms/ddms/v3/wellboremarkersets/:id/data` likewise.
- `OPTIONS` preflight: only `--allow-origin`, methods GET and POST, headers `authorization`,
  `data-partition-id`, `content-type`; exposes `x-request-id`.

## Profiles

| Profile | What changes |
|---|---|
| `clean` | OSDU as the well-known schemas describe it (above). |
| `quirky` | A real tenant's habits: lengths in feet (`UnitOfMeasure:ft`), azimuths to true north (`AzimuthTN`, `AzimuthReferenceType: True North`), no `Wgs84Coordinates` (AsIngestedCoordinates only, so the adapter must reproject), datums chained DF → GL → MSL, bulk columns named MeasuredDepth, Inclination, AZIM_TN, TVD, DispNS, DispEW, markers in bulk only (no inline Markers), references without the trailing colon, one well in ten with no GeoContexts. |
| `hostile` | Names, fields, operators and markers containing `<img src=x onerror=__xss()>`, `"><svg onload=__xss()>`, `javascript:__xss()`, `{{constructor.constructor('__xss()')()}}`, right-to-left override and zero-width characters; a 100,000-character well name (field 0, well 3); wells with ids `__proto__` and `constructor` (field 0, wells 1 and 2); a trajectory (field 0, well 4) whose MD column holds `NaN`, `Infinity` and `1e308` written as Python's `json.dumps` writes them, which is not JSON. |
| `huge` | `clean` at 200,000 wells and 2,000 stations (overridable). |

## Admin API (on `--admin-port`)

- `GET /__admin/health` — profile, size, partition, issuer, cached fields, open cursors.
- `POST /__admin/faults` — a fault spec (below); fields left out keep their values on that route. Returns the current faults.
- `GET /__admin/faults` — the current faults by route.
- `GET /__admin/log` — per route (`search`, `trajectory`, `markers`, `other`) and in total: requests, a status histogram, connections the client closed before the response ended (`aborted`), and `retryAfter: { sent, honoured, ignored }` (the next request on a route after a 429 is honoured when it waited at least `Retry-After`); peak and current concurrency.
- `POST /__admin/reset` — clear faults, the log and open cursors, and rewind the fault generator so the same requests meet the same faults again.

### The fault matrix

```
POST /__admin/faults  { "route": "search" | "trajectory" | "markers" | "*", ... }
```

| Field | Effect |
|---|---|
| `latencyMs`, `jitterMs` | every response waits `latencyMs` plus up to `jitterMs` |
| `rate5xx` | that share of requests answered 500, 502 or 503 |
| `rate429`, `retryAfterS` | that share answered 429 with `Retry-After: retryAfterS` |
| `rateReset` | that share has the connection destroyed half-way through the body |
| `trickleBytesPerS` | the body is written at that rate (a 1.5 KB table at 100 B/s takes 15 s) |
| `truncateJson` | the body is cut at half its length with a matching Content-Length: a complete transfer that is not JSON |
| `oversizeBytes` | a `padding` string of that many bytes is appended inside the JSON (for the fetch guard's size limit) |
| `expireCursors` | every cursor presented is expired |
| `storm401` | that share of requests answered 401 despite a valid token (a key rotation) |
| `clockSkewS` | the platform's clock is moved by that many seconds when checking token lifetimes |

Faults are drawn from one generator seeded by `--seed` in request order: the same seed, the same
faults, the same requests give the same outcomes. `*` applies to every route; a route's own spec
overrides it field by field. Rates are 0–1; the gatekeeping (401 for a bad token, 403 for a wrong
partition) is never faulted away.

## The identity provider (`idp.mjs`)

An OpenID provider that signs everyone in as one synthetic user (`sub` `mock-user`, or the
`login_hint`) with auto-consent.

- `GET /.well-known/openid-configuration`, `GET /jwks` (an ES256 key generated at start).
- `GET /authorize`: `response_type=code` with PKCE S256 required; `prompt=none` returns
  `error=login_required` when no session cookie is presented; sets the session cookie on an
  interactive sign-in; `state` is echoed.
- `POST /token`: `authorization_code` (code once, `code_verifier` checked, `redirect_uri` matched)
  and `refresh_token` with rotation. Presenting a rotated refresh token again revokes its whole
  family: every later use answers `invalid_grant`.
- `GET|POST /logout`: ends the session and honours `post_logout_redirect_uri` (with `state`).
- ID tokens carry `sub`, `name`, `nonce`; access tokens are JWTs with `iss`, `sub`, `aud`, `exp`,
  `scope`, which the platform verifies.
- `--token-ttl` seconds of life; `--clock-skew` seconds added to every `iat`, `nbf` and `exp`, for
  skew tests.

## Tests

`node --test tools/mock-osdu/mock.test.mjs` starts providers and platforms on ephemeral ports and
checks: the PKCE flow end to end with a scripted client, refresh rotation and reuse detection,
`prompt=none`, logout; cursor paging over 2,500 wells summing to `totalCount` and ending without a
cursor; expired cursors; 403 and 401 cases (missing, forged, expired, foreign-key, `alg: none`);
CORS preflight; bulk in both orientations with a curves filter; the quirky and hostile profiles,
each also read through the core OSDU adapter; deterministic faults; Retry-After accounting; a
client disconnecting mid-trickle counted as aborted; and that the records are the stress tenant's.
