# Stress test: a tenant's data at scale

*2026-10-17. Chromium at 1440 × 1000 on an Apple-silicon Mac; the tenant is synthetic and labelled so.*

## Why

The workbench is the front end on a tenant's own backend. A tenant may have hundreds of thousands of
wells. The deck must list them, open any field, and never take the tab down. Before this work it read
every well's path and tops at start, held them all, and drew a DOM label for every well.

## How to run it

```
# A tenant served the way a large one is: index pages of headers, one detail file per field
node tools/stress/tenant.mjs --index <dir>/stress 200000 300 200 20
# Point a build's config.json at it:
#   { "sources": [ { "type": "samples" }, { "type": "contract-json", "url": "stress/index.json" } ] }
PLAYWRIGHT=… node tools/stress/measure-browser.mjs http://localhost:<port>/ "Field 3"

# The data layer alone, in Node
node --expose-gc tools/stress/measure-node.mjs 1000 5000 15000
```

Each synthetic well has:
- a definitive survey of 300 stations to a 2–5 km TD;
- 20 tops and an RKB datum;
- 200 wells per field, fields spread over about 16° × 7.5°.

## Before

The old design read everything at start, held it all, and drew a label per well.

| Wells | JSON | Heap | Worst freeze | Data sources | One field in 3D |
|---|---|---|---|---|---|
| 1,000 (Node) | 31 MB | 190 MB | — | — | 0.2 s |
| 5,000 (browser) | 156 MB | 816 MB at start, 1.2 GB after a field | **5.1 s** at start | 5,126 rows drawn | about 10 s |
| 15,000 (Node) | 467 MB | 2.8 GB | 9 s to load | — | 20 s for all wells in one site |
| above about 17,000 | over V8's 512 MB string limit: **cannot be parsed at all** | | | | |

Memory grew about 160 KB per well. A browser tab gives out around 4 GB, so the deck would have
crashed at roughly 25,000 wells, and frozen for many seconds well before that.

## After

The new design reads headers first, a page at a time. Paths and tops are read per field when it is
opened, in batches and simplified for drawing. Labels and rows are drawn only for what is in view,
and wells are clustered on the globe.

| | 200,000 wells (browser) |
|---|---|
| Globe ready | **1.0 s** |
| Heap at start | **196–245 MB** |
| Worst freeze at start | **0.24 s** (one 5.7 MB index page parsed) |
| Data sources | 200,126 wells listed, **39 rows drawn**; jumping half-way down is immediate |
| Opening a field of 200 wells in 3D | read in batches; heap 282–349 MB; worst freeze **0.33 s** |
| A field whose detail file is missing | the tab carries on; Site in 3D says *None of its 200 wells could be read (HTTP 404)*, and its wells stay listed |

## What makes it hold

1. **Headers first.** A source pages through light well headers: identity, field and location,
   about 200 bytes a well. That is all the globe and the lists need. (`WellDataSource.headers`;
   OSDU Search pages with a cursor, and an ETP or PPDM API does the same.)
2. **Detail per field, on demand.** Paths and tops are read only when a field is opened:
   - in batches of 100, four at a time, yielding between batches;
   - cancelled if the deck moves to another field;
   - with the six most recent fields kept and older ones dropped.
   (`readDetail`, `openField`.)
3. **Simplified for drawing, full for the selected well.** Each path is drawn within 2 m of its survey
   (Douglas–Peucker, tested by brute force). A well's own calculations get its full path, read
   separately for the selected well (`openWell`).
4. **Caps, stated where they apply.**
   - At most 250,000 wells listed per source.
   - At most 1,500 wells drawn in 3D per field; the rest stay on the map, and the site's note says
     how many are drawn.
   - At most 64 MB per single file.
5. **Guarded requests** (`fetch-guard.ts`):
   - a time limit on every request;
   - two retries on server errors, waiting longer each time;
   - a byte cap enforced as the body streams in, so a server that hides its size is stopped all the same;
   - cancellation.
6. **A paged file format** for tenants who serve files: `subsurface-wells-index` pages of headers,
   each linking the next, plus one `subsurface-wells` file per field.
7. **Drawing only what is visible.**
   - Wells are clustered on the globe until zoom 10, with counts.
   - Site and well labels are made only for what is in view: at most 150 sites and 200 wells.
   - Data sources draws only the rows on screen.
   - Change notices are coalesced: at most every 120 ms, or every second while sources are read.

## Fuzzing the boundaries

*2026-10-17.* Everything that reads data into the deck is fuzzed with properties (`tools/fuzz/run.mjs`,
fast-check): 500 runs per property on every commit (t0), 10,000 nightly (t1). A failing seed is kept in
`tools/fuzz/replays.json` and replayed first on every later run, so a bug found once is checked for ever.

| Target | What must hold for any input |
|---|---|
| `validateWell/Wellbore/Trajectory/MarkerSet` | never throw; problems are worded, with string ids |
| `resolveTrajectory` | a path that passes its checks resolves to as many finite stations, MD rising, no station deeper than the hole drilled to it, supplied positions kept |
| `simplifyPath` | a subsequence with both ends kept, every original within the tolerance of the simplified line |
| `catalogueWell` | never throws, even on the test fixture with fields deleted, retyped or replaced by `__proto__` objects; `Object.prototype` untouched |
| `parseDeckConfig` | never throws; what comes out holds no secret; a secret in the input is named; origins are https |
| share codec | encode → decode is the identity; garbage and tampered links are refused with a message about the link |
| OSDU mappers | never throw on any record or table shape; out comes the contract's shape; `describeOsduError` never prints `[object Object]` |
| `parseLas` | the FORGE and Kestrel fixtures with lines dropped, swapped, joined, cut or corrupted: a LAS file with finite-or-null values, or a `RangeError` naming LAS; `formatLas` → `parseLas` round-trips |
| `readQuakeML` | the stimulation catalogue mutated likewise: finite events, or a `SyntaxError` naming QuakeML; `writeQuakeML` → `readQuakeML` round-trips |
| `parseSegy` | the FORGE section with header bytes flipped, zeroed, truncated or grown, and random headers claiming formats, sample counts and extended headers the body lacks: a file whose data matches its counts, or an `Error` naming SEG-Y, never a typed-array crash |

The first runs (500, then 10,000 per property) found nine defects, each now a regression test
("found by fuzzing"):

1. A well record outside the contract's shape (a missing `name`, `wellbores` not a list, `stations`
   null) threw inside `catalogueWell` and so lost the whole batch it came in. A shape check now
   leaves out that one well with the reason (`bundleShapeProblem`).
2. A well whose id was not a string put a non-string id on its problems.
3. `describeOsduError` turned a non-Error rejection into `[object Object]`.
4. A length or angle unit named `__proto__` or `constructor` read a factor off `Object.prototype`
   and gave NaN instead of "unknown unit".
5. A bulk-data row that was `null` crashed the marker reader.
6. A QuakeML value that was not a number (`38.5x`) came through as a NaN latitude, to be drawn
   nowhere. Such a value now counts as missing and the event is skipped.
7. A SEG-Y header claiming extended textual headers beyond the file's end made a negative trace
   count and a typed-array `RangeError`. It is now refused in words, and a short body yields the
   whole traces it holds.
8. A station with a negative MD (above the datum) passed `validateTrajectory`, then threw inside
   the minimum-curvature maths. The validator now refuses it in words; only the 10,000-run tier
   reached it.
9. A LAS `NULL` header that was not a number made every null marker a reading. It now falls back
   to the LAS 2.0 default, −999.25.

Not fuzzed yet: the contract-json index reader and the OIDC callback (both need the mock server,
P2b), and the deck's own stores (P6).

## The deck on the mock platform: sign-in, faults, slow links, hostile data

*2026-10-18.* Four suites run the built deck in Chromium at 1440 × 1000 against the mock OSDU platform
and identity provider (`tools/mock-osdu`), served with a CSP whose `connect-src` admits exactly those
two origins (`tools/stress/harness.mjs`). They are t1 steps in `tools/ci/run.mjs`; budgets are the
`faults` and `network` blocks of `tools/budgets.mjs`.

| Suite | What it does | Result |
|---|---|---|
| `tools/e2e/auth.mjs` | code flow with PKCE; storage, URL, cookie and history checked for tokens; 45 s of 6 s tokens; a reload; a forged callback; the provider's session ending; clocks ±4 minutes off | 16 of 16 |
| `tools/stress/faults.mjs` | 50 ms latency; 30 % 5xx; 429 with Retry-After; expired cursors; trickled bodies then leaving the field; a 30 % 401 storm; truncated JSON with dropped connections | 19 of 19 |
| `tools/stress/throttle.mjs` | CPU 4×; a VPN (5 Mbit/s, 80 ms); a poor link (400 kbit/s, 400 ms), with the platform compressing and without | 21 of 22 (below) |
| `tools/e2e/xss.mjs` | the `hostile` tenant: HTML and SVG handlers in every name, `__proto__` ids, a 100,000-character name, numbers that are not JSON; list, fields, 3D, search, share | 14 of 14 |

Measured (200-well field, 120 stations a well, 20 tops):

| | Field ready | Worst main-thread stall | Heap |
|---|---|---|---|
| 50 ms latency | 2.8–3.4 s (budget 8 s), 216 requests (budget 406), 6 in flight (budget 6) | | 211–280 MB |
| CPU 4× | 2.4–3.2 s (budget 15 s); globe 1.1 s (budget 4 s) | **460 ms (budget 400)** | 86–125 MB |
| VPN, compressed | 4.1 s (budget 15 s) | 134 ms | 83 MB |
| Poor link, compressed | 25 s (budget 45 s), progress shown while reading | 126 ms | 92 MB |
| Poor link, uncompressed | 76 s (measured, not budgeted: 2.8 MB at 400 kbit/s) | 137 ms | 75 MB |

What the suites found, each fixed with a test that fails without the fix:

1. **A token that lives a minute or less was never "fresh".** The deck renewed any token in its last
   minute, so a 6 s token was renewed on every request, rotating the refresh token each time.
   Renewal is now in the last fifth of a token's life, at most a minute (`oidc.test.ts`).
2. **The mock identity provider issued rotated refresh tokens already marked used**, so the second
   refresh looked like a replay and revoked the session. Its own test rotated only once; it now
   rotates three times (`mock.test.mjs`).
3. **A reload did not go back through the provider's session**, as `IDP_GUIDE.md` said it would.
   A tab that signed in now keeps the profile's name (never a token) in `sessionStorage`, and a
   reload tries `prompt=none` under the loop guard; `login_required` or signing out ends it.
4. **Each 401 forced a refresh**, even for a token another request had already replaced: 18
   refreshes for 40 × 401. The guard now passes the refused token; a stale one is retried with the
   current token (12 refreshes for 40 × 401, never two at once).
5. **Retry-After was invisible to the deck**: it is not a CORS-safelisted header. The mock now
   exposes it, `IDP_GUIDE.md` asks platforms to, and a 429 without a readable one waits from 1 s.
6. **A site scene closed before its renderer started left an unhandled rejection** (a tenant field
   with nothing to draw yet).
7. **"Left out or flagged" showed the oldest 300 lines**: the failures of the field just opened were
   hidden under older ones. Newest first now.
8. **The fetch guard's 30 s limit covered the whole response**: a 1.7 MB page of headers on a slow
   link was cut off while arriving, then fetched again twice. 30 s now means nothing arriving for
   30 s; a whole response may take 10 minutes.
9. **Scene labels forced a layout per label per frame** (read a size, write a transform, read the
   next): 1,000 layouts for 1,000 labels. Read, compute, then write: at most 3 (`scene-labels.test.mjs`).
10. **Every well marker had its own sphere geometry and material**, 4,000 GPU uploads and pipelines
    on a field's first draw; every wellhead cap its own cylinder. Shared now.
11. **Horizons were triangulated twice each**, by a Bowyer–Watson that recomputed every circumcircle
    per point: once per surface now, circles computed once (same triangles as before, tested
    against the old algorithm).
12. **OSDU detail searches fetched whole records.** They ask for the fields the mappers read
    (`DETAIL_FIELDS`), proven equivalent on the mock's clean and quirky records: 3.08 → 2.81 MB a
    field.

At CPU 4× the worst stall went from 1,172 ms to about 460 ms, the field from 6.2 s to 2.4–3.2 s
and the heap from 143 MB to under 130 MB. The stall budget (400 ms) is still broken and the check
stays red: what remains is the site scene built in one task when a field's paths arrive. Spreading
that build across frames is the next step.

Also seen, not changed here:
- A first load is 4.2 MB, 2.5 MB of it the globe's imagery (`gis/world-imagery.jpg`): the globe
  takes 8 s on the VPN and 84 s on the poor link before any tenant data.
- `data/force2020/wells.json` loads even when the config lists no samples (P6: samples only when
  listed).
- A field's detail re-fetches the well records the header pages already delivered (347 kB of 2.8 MB).

## Not done yet

- Parsing an index page (about 5.7 MB) still happens on the main thread: about 0.24 s once per page.
  A worker would remove it. It was not needed to stay under a third of a second.
- Logs and seismic are not in the contract yet. When they are, the same rule applies: never a whole
  volume.
  - Logs come by curve and depth range (OSDU Wellbore DDMS bulk data).
  - Seismic comes in bricks (OpenVDS / OpenZGY through the Seismic DDMS).
- The OSDU, WITSML/ETP and PPDM adapters. The interface they implement is the one stressed here.
