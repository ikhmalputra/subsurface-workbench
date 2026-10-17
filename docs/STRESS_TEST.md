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

## Not done yet

- Parsing an index page (about 5.7 MB) still happens on the main thread: about 0.24 s once per page.
  A worker would remove it. It was not needed to stay under a third of a second.
- Logs and seismic are not in the contract yet. When they are, the same rule applies: never a whole
  volume.
  - Logs come by curve and depth range (OSDU Wellbore DDMS bulk data).
  - Seismic comes in bricks (OpenVDS / OpenZGY through the Seismic DDMS).
- The OSDU, WITSML/ETP and PPDM adapters. The interface they implement is the one stressed here.
