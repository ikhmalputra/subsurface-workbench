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

## Not done yet

- Parsing an index page (about 5.7 MB) still happens on the main thread: about 0.24 s once per page.
  A worker would remove it. It was not needed to stay under a third of a second.
- Logs and seismic are not in the contract yet. When they are, the same rule applies: never a whole
  volume.
  - Logs come by curve and depth range (OSDU Wellbore DDMS bulk data).
  - Seismic comes in bricks (OpenVDS / OpenZGY through the Seismic DDMS).
- The OSDU, WITSML/ETP and PPDM adapters. The interface they implement is the one stressed here.
