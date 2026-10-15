# The rebuild — a live subsurface deck

## What it has to be

In Ikhmal's words: *futuristic, and full of interaction between the user and multiple modules at
the same time.* Their standing taste: Apple-modern and lightweight, with the SolidWorks/AutoCAD
feel of an engineering tool; fun, young colour rather than corporate graphite; everything fits the
screen; desktop only, judged at 1440×1000.

So the product is not a set of pages, and not one view with tools around it. It is **one live
deck where several modules are open at once and every one of them reacts to every other** — and
the reacting is visible. Touch a depth in the logs and you watch it arrive in the 3D well, the
schematic, the seismic and the map in the same frame.

## What it is built from

Everything below already exists, was audited, and survived the purge:

| Module | From | Signals it can carry today |
| --- | --- | --- |
| Globe | `WellsMap` + `forgeSite` / `equatorSite` | site, well |
| Site 3D | `SiteScene` | well, picked point, slice positions |
| Well 3D | `WellScene` (seismic volume, DLS path, picking) | component, MD probe, depth window, camera, slice plane |
| Assembly 3D | `AssemblyScene` (cutaway, explode, section) | component |
| Section | `WellSection` (construction, mud log, survey on one depth axis) | component, MD cursor, depth window |
| Schematic | `AssemblySchematic` (recorded holes, cement, labels) | component, depth window, cursor |
| Curved | `CurvedAssemblySchematic` | component |
| Logs | `LogTracks`, `WellHistoryLog`, `DaysVsDepthChart`, `ServiceRunLog` | MD cursor, depth window, time |
| Trajectory | plan, section, survey log, `BuildHoldForm`, `SurveyTable` | MD, station |
| Seismic | `SeismicSection` | MD cursor, depth window |
| Petrophysics | Archie, M–N, zone summary, crossplot, histogram | brushed samples |
| Engineering | core `well-design` (loads, kick tolerance, cement), `calc` hydraulics | — (no UI yet) |

The bus exists too. Core's store already carries selection, hovered and pinned depth, the depth
window, a time range, seismic slices, the camera and brushed samples, and stamps every event with
its source. **But only `GisMap` listens to it.** Every other view takes props and callbacks, so
today a host wires each pair by hand. Closing that gap is the foundation of the whole rebuild.

## The interaction model: signals

Six signals, each with one colour that never means anything else, everywhere in the app:

| Signal | Meaning | Colour |
| --- | --- | --- |
| **Place** | which site and well | electric violet |
| **Object** | the selected component, horizon or sample set | AutoCAD orange |
| **Depth** | the hovered and pinned MD, and the depth window | cyan |
| **Time** | the moment in the well's history | lime |
| **View** | the camera and the seismic slices | white |
| **What-if** | an edited design value not yet applied | magenta |

Every module declares which signals it **listens to** and which it **emits**. That declaration
drives three things: the wiring, the layout presets, and the visible links.

**Visible links.** When a signal leaves one module and lands in others, a thin pulse travels along
a connector between the tiles in the signal's colour (200 ms, eased) and the receiving tiles flash
their edge once. The deck shows its own causality. Hold ⌥ to see every live connection at once,
like a patch bay.

## The deck

```
┌ command bar ────────────────────────────────────────────── site · well · signals ┐
│                                                                                  │
│   ┌──────────────┐  ┌────────────────────────────────┐  ┌───────────────────┐    │
│   │  Globe       │  │                                │  │  Section          │    │
│   │              │  │        STAGE (focused module)   │  │  (depth-locked)   │    │
│   └──────────────┘  │        3D site / well           │  │                   │    │
│   ┌──────────────┐  │                                │  │                   │    │
│   │  Seismic     │  │                                │  │                   │    │
│   └──────────────┘  └────────────────────────────────┘  └───────────────────┘    │
│                                                                                  │
├ depth rail ──────────────────────── time rail (spud → TD, scrubbable) ───────────┤
└ lens: what the current signals mean here — values, sources, "not reported" ──────┘
```

- **Tiles, not pages.** Modules are tiles on a magnetic grid: drag, resize, snap, stack. One tile
  can be the **stage** (large, centre). Double-click promotes a tile to the stage with a shared
  layout animation; the old stage slides into its place.
- **Depth lock.** Depth-indexed tiles placed side by side align their depth axes automatically
  and share one glowing cursor line across the gap between them. That makes the well section, the
  seismic and the logs read as one instrument.
- **Rails.** A depth rail and a time rail span the bottom. Scrub either, and every listening
  module follows.
- **Lens.** A strip that says what the current signals mean: the MD under the cursor in MD and
  TVD, the component there, its record values with source page, the amplitude, the day. Unknown
  values say "not reported".
- **Command bar (⌘K).** Every action is a command, typed or clicked: `fly to forge`,
  `select production casing`, `depth 2500`, `replay drilling`, `layout interpret`. The bar also
  shows the current site, well and signal states as chips you can clear.
- **Presets.** *Field* (globe staged, site 3D, correlation of picks), *Drill* (well 3D staged,
  section, time rail, days-vs-depth, runs), *Interpret* (site 3D staged, seismic, logs,
  petrophysics), *Design* (schematic staged, loads, kick tolerance, pressure window). A preset is
  a layout, not a mode: every module stays live.

## Interactions across modules — the scenarios that define done

1. **Depth everywhere.** Hover any depth in any depth module. A cyan cursor shows in the section,
   schematic, logs and seismic; a ring rides the 3D well; a dot moves along the well's path on the
   globe; the lens reads MD, TVD, component and amplitude. Click to pin it.
2. **Select once, see it everywhere.** Click the production casing in the schematic. The 3D camera
   flies to its shoe, the runs list filters to that hole section, the time rail jumps to the day it
   was run, and the loads module shows its burst, collapse and tension.
3. **Fly between sites.** Click Utah on the globe. The whole deck re-binds to FORGE with one
   animation: the stage swings to the site in 3D, tiles cross-fade to the new well's data, and a
   tile with nothing to show says what is missing instead of going blank.
4. **Replay the well.** Drag the time rail from spud to TD. The 3D path draws down day by day,
   casing strings appear in the schematic and the cutaway as they were run, the days-vs-depth
   cursor moves, and the lens reads that day's report.
5. **Brush an interval.** Shift-drag an interval in the logs. It lights up on the 3D well and the
   schematic, petrophysics recomputes the zone summary live, and the seismic shows the band.
6. **Move the slice, see the section.** Drag the inline slice in the 3D site. The seismic tile
   becomes that inline and its well overlay follows.
7. **Draw a section on the globe.** Drag a line between two wells on the map. A new tile spawns
   with the curtain section along it, and on the stage the line becomes a cutting plane.
8. **Fuse modules.** Drop the logs tile onto the 3D well, and the log wraps the well as a coloured
   cylinder. Drop a formation onto the seismic, and its top draws as a horizon. Pull it back off
   to undo.
9. **What-if, live.** Drag the mud weight in the loads module. The pressure window, kick tolerance
   and every safety factor update as you drag, and strings that fail pulse magenta in the
   schematic and in 3D. Nothing is committed until you apply it, and undo reverses the whole edit.
10. **Compare two wells.** Pin two wells. Their sections stack depth-locked, one cursor drives
    both, and differences are highlighted.

## Look and feel

- **Night deck by default, day deck available.** Deep blue-black canvas, glass tiles with a hairline
  edge and a soft inner light, so modules float above a dim ambient scene. In day mode the tiles are
  white glass on a pale ground. High-contrast mode stays.
- **Colour.** Neutral chrome. Colour is reserved for the six signals and for data, so a colour on
  screen always means something. Contrast is checked for every signal colour in both decks.
- **Motion with meaning.** Springs for layout, eased camera flights, signal pulses. Nothing moves
  without a cause. `prefers-reduced-motion` turns flights into cuts and pulses into flashes.
- **Type.** Inter for UI, a monospace for values; one seven-step type scale. Nothing smaller than
  11 px.
- **Engineering, not a game.** Units on every value, provenance on every record, "not reported"
  for every unknown. The futurism is in the responsiveness, not in fake data.

## Architecture

- **`apps/deck`**: a new Vite single-page app (one screen, so a router and server rendering buy
  nothing). It holds the shell, the tiles, the
  rails, the lens and the command bar. All data reaches it through the site adapters and fixtures,
  copied to `public/` at build time.
- **Signal layer in `packages/react`**: every view takes an optional `store` and listens and emits
  through it, keeping its existing props, so a host that wants control still has it. The pattern is
  `useSignal(store, selector)` plus an `emit(type, value, source)` helper. The three.js views read
  signals through refs in their render loops, as they do with props today.
- **Core store additions**: a time cursor; a focused site; two-well compare; a pending what-if edit
  with apply and discard; and an undo/redo history of labelled commands covering every module.
- **Module registry**: each module declares its id, title, the signals it listens to and emits,
  the data it needs (and says what is missing), its minimum tile size, and whether it is
  depth-indexed. Layout presets, the link overlay and the command bar all read from it.
- **Layout state** is separate from the signal bus: tile positions, stage, presets. It persists
  per browser, and the URL carries the signals so a link reopens the same moment.
- **Libraries**: `motion` for layout springs and shared-element transitions and `cmdk` for the command
  bar. Tile drag and snap is the deck's own code on the grid maths, so `@dnd-kit` was not needed. Everything else is already in the repo: three.js
  (WebGPU), MapLibre, d3.
- **Performance budget**: 60 fps while scrubbing with six tiles live. Off-stage 3D tiles render on
  demand at reduced resolution; only the stage animates continuously.

## Phases

Each phase ends with something visibly new, screenshotted at 1440×1000 in both decks.

| Phase | What lands | Done when |
| --- | --- | --- |
| **0 · The deck** | `apps/deck`, theme tokens, glass tiles on the magnetic grid, stage promotion, command bar, rails as placeholders. Three live modules: globe, site 3D, section. | The deck opens on the globe; clicking FORGE stages its site in 3D; tiles drag, snap and promote. |
| **1 · Signals** | Signal layer in every kept view; module registry; link pulses and the ⌥ patch-bay view; lens. All modules available as tiles. | Scenarios 1, 2 and 3 work. |
| **2 · Time** | Time cursor in the store; time rail; replay in 3D, schematic, cutaway and logs. | Scenario 4 works end to end on FORGE's 76 days. |
| **3 · Engineering live** | Loads, kick tolerance, cement, hydraulics and petrophysics as modules; what-if edits with apply, discard and undo. | Scenarios 5 and 9 work. |
| **4 · Spatial tools** | Slice to section, draw a section on the globe, fusing modules. | Scenarios 6, 7 and 8 work. |
| **5 · Workflows** | Presets, two-well compare, URL state, keyboard routes for every interaction. | Scenario 10 works; every scenario can be done from the keyboard. |
| **6 · Finish** | Motion and contrast pass, performance budget, empty and "not reported" states for every module. | 60 fps with six live tiles; reduced motion verified; no tile ever blank without a reason. |

## Phase 0 as built (October 2026)

- `apps/deck`: night and day decks; four modules (globe, site in 3D, site card, well section) in
  glass tiles on the 12 × 8 grid. Drag a head to move, the corner to resize; a drop mostly over a
  tile swaps the two; double-click or the expand button stages a tile.
- Every module declares its smallest readable size. A drop or resize that would squeeze a tile
  below it, or half-cover a neighbour, is refused: the guide and the lifted tile turn grey.
- The layout is kept per browser and validated on load; the deck always opens on the globe.
- ⌘K command bar; depth rail on FORGE (hover reads MD and TVD, click pins); lens; signal dots and
  edge flashes on the tiles that listen. Motion follows `prefers-reduced-motion`.
- Not built, on purpose: the time rail. A rail with nothing to scrub would be a control for a thing
  that does not exist yet; it lands with phase 2.
- Carried into phase 1: the construction track's record labels run past a narrow column, because
  the SDK lays them out for a wider drawing. Modules have to adapt to their tile, not only refuse
  small ones.

## Phase 1 as built (October 2026)

- **All modules are tiles.** Seventeen modules in five groups (Place, Well, Data, Drilling,
  Engineering): globe, site, site in 3D, well section, well in 3D, schematic, curved construction,
  cutaway, plan view, vertical section, mud log, seismic section, days vs depth, hole sections,
  runs, daily history, and the string. A dock on the left lists them: click to open (or to stage an
  open one), drag onto the deck to put one exactly where it is wanted, over a tile to replace it.
  Opening finds room in free cells, then carves a strip from the largest tile that can spare one
  (the stage keeps at least 4 × 5), and only then replaces the tile used longest ago.
- **One bus, stamped by sender.** Each module talks to the core store through one adapter
  (`useWire`), which stamps everything it sends with the module's id. The SDK views keep their
  props; the deck wires each one to the store once, rather than every view taking a store.
  Four SDK views gained what they lacked: `WellsMap` a `cursor` point, `SiteScene` a `cursor`
  ring, `WellScene` `focusOnSelect`, and `CurvedAssemblySchematic` a depth cursor with hover and
  pick.
- **Visible links.** Every pick, selection, window change and camera move becomes a pulse from
  the sending tile to each tile that listens, in the signal's colour; the receiving edge lights as
  it lands. Hovering is shown by the cursor itself, not by pulses. Holding ⌥ (or the links button)
  shows the patch bay: one line per pair and signal between every open module.
- **Lens.** MD, TVD, the strings and hole at that depth, the formation, the PSDM amplitude where
  the well is (and how far off the section it is), and the selected record with its source page.
  "TVD not surveyed", "hole not reported" and the like where the record is silent.
- **The string.** Grade, weight and connection as reported; API TR 5C3 burst, collapse and body
  yield from the API 5CT nominal wall for that OD and weight, said to be nominal. HCL80 is not an
  API grade, so the intermediate string says why it has no rating.
- **Command bar.** Open, stage or close any module; select any record; `depth 2500` pins a depth.
  Matching is by words, not letters.
- **Scenarios.** 1 works end to end. 2 works except the time rail (phase 2) and loads against the
  ratings (phase 3). 3 works: Equator re-binds the deck and every tile without data says why.
- **Not yet:** depth lock between adjacent tiles (one cursor line across the gap) moves to
  phase 5 with presets; off-stage 3D tiles still render live (phase 6 budget).

## Phase 2 as built (October 2026)

- **Time in the store.** The core store carries a time cursor (UTC epoch milliseconds, null for the
  well as finally recorded) with its own `time` event and `setTimeCursor`; links carry it as
  `sw.time`. Older snapshots without it still hydrate.
- **The well on a day.** Core's `wellAsOf` builds the well as its reports left it: drilled depth
  from the daily reports and milestones (never interpolated between reports), holes clipped to it,
  and strings and cement from dated install events. `forgeInstalls` transcribes them with report
  pages: surface casing and cement on 1 Nov 2020; intermediate casing on 12 Nov; the 7 in string
  part-run to 5,936 ft on 1 Jan 2021 and to bottom on 2 Jan; its cement on 3 Jan. The wellhead
  and master valve are undated in the dailies and are shown from rig release, and say so.
- **Time rail**, beside the depth rail: the drilled-depth profile over 85 days, each report's
  category, milestones and installs, a thumb, hover read-out, drag to scrub, ←/→ by day (⇧ by
  week), Home/End, space to play, Esc for "as recorded". Play runs one day per 170 ms.
- **Replay.** The 3D well draws its path, and each hole, down to the depth drilled, and each string
  down to the depth it had been run, its shoe only once it is in to bottom (`WellScene` `reachMdM`,
  `installedIds` and `runToMdM`, applied without a rebuild). The site in 3D draws the well, its
  reservoir interval and picks to the depth drilled and hides a shoe until its string is in
  (`SiteScene` `reach` and `hiddenMarkers`). The globe draws the path in plan to the depth drilled.
  The depth rail greys what was not yet drilled. Flying to another site returns to the finished
  record. The section, schematic, curved construction and cutaway show the construction of the
  day; the cutaway's borehole ends at the depth drilled; the mud log is drawn only above it, on an
  unchanged axis. Days vs depth and the daily history follow the cursor, and choosing a day in
  either moves it. The string module says when a string was not yet run, or how far it was run.
- **Lens and bar.** A lime chip for the day; the lens reads day from spud, date, report category
  and headline, mud weight ("not reported" where missing), report page and the day's events.
- **Commands.** `day 23`, `2020-11-22`, every milestone, the first report, and "as recorded".
- **Scenario 4** works end to end on FORGE's 76 reports, in every module that draws the well.

## Phase 3 as built (October 2026)

- **Where engineering runs.** FORGE's records carry no pore or fracture pressures, so loads cannot
  be computed on it without inventing them. With Ikhmal's agreement the engineering modules run on
  **Kestrel A-7**, the SDK's example design brief, added as a third site on the globe (offshore
  Malaysia, labelled synthetic design): a planned J-profile, offset-derived pressures, five strings,
  cement plans and a gas-lift completion. Core's `briefToWellDesign` turns the brief into a well
  every view can draw, the planned path held straight to TD, each string keeping its section id.
- **Five engineering modules**, all live on one design: *Loads* (burst, collapse and tension
  safety factors against the design factors for every string, with the pipe and the mud weight as
  what-ifs and the mud slider drawn over the pore-to-fracture window); *Pressure window* (pore and
  fracture against TVD with every hole's mud weight, draggable); *Kick tolerance* (influx volume per
  shoe against the 50/25 bbl minimum, with kick intensity as a what-if); *Cement* (lead and tail
  volumes and the column's equivalent density at the shoe against fracture, slurries as what-ifs);
  *Hydraulics* (API RP 13D bit and annular hydraulics from the design's mud and hole with flow,
  nozzles and drill pipe set by the user; annular pressure loss and ECD are said to need rheology).
  The *String* module shows a designed string's derated ratings, loads and factors.
- **What-if, apply, discard, undo.** Core's `createEditHistory` holds the design and the hydraulics
  inputs as one value: a proposal shows everywhere at once and commits nothing; one drag is one
  step; apply, discard, undo and redo (⌘↵, Esc, ⌘Z, ⇧⌘Z, or the bar and ⌘K). While a what-if is
  pending the bar says what it does ("1 string fail · was 0"), and failing strings pulse magenta in
  the loads, the pressure window, the schematic (as errors) and the 3D well (`WellScene`
  `alertIds`). Edits are held in the page only: the SDK stores nothing.
- **Petrophysics on synthetic logs.** Core's `syntheticReservoirLogs` builds open-hole logs from a
  rock and fluid model (stacked fining-upward sand units, shale breaks and silty stringers; field
  contacts by TVDSS; flushed-zone fluids, so gas shows the density–neutron crossover; Archie
  resistivity with a transition zone; washouts that spoil the density, flagged by DRHO; tool
  resolution and seeded noise; Timur-permeability core plugs). Tests check the physics back:
  Archie on the logs recovers the model's saturations. Each Equator well gets logs across its own
  Sand R1 picks with the field's GOC (2,235 m TVDSS) and OWC (2,310 m TVDSS); wells A and D carry a
  gas cap. The *Petrophysics* module computes Vsh, porosity (density or density–neutron), Archie Sw,
  net sand, net pay, averages and φ·(1−Sw)·h over the brushed interval, with editable a, m, n, Rw
  and cutoffs, a density–neutron crossplot with lithology lines, and the core plugs against the log.
- **Brushing.** Shift-drag on the logs (`LogTracks` `onBrush`, from the shared depth gestures) or
  on the depth rail sets the store's depth range. It lights the section and schematic
  (`AssemblySchematic` `highlights`), the 3D well, the seismic section, the site in 3D
  (`SiteScene` `highlight`), the depth rail, the bar and the lens; the petrophysics recompute on it.
- **The deck is per place.** Every module reads one place (FORGE, Kestrel A-7 or an Equator well);
  what a place does not have, the module says, with the reason. A module that throws shows its error
  and a retry instead of blanking the deck. Opening a module trims neighbours back along clean edges
  to make room before it ever replaces one.
- **Scenarios 5 and 9** work: 5 on FORGE (logs, section, schematic, 3D well, seismic) and on the
  Equator wells (logs, site in 3D, petrophysics); 9 on Kestrel A-7.

## After phase 3: consolidation and real FORGE petrophysics (October 2026)

- **Fewer, fuller modules (17).** Site card dropped (the globe, ⌘K and the lens already carry it;
  flying to a site opens and stages the site in 3D). Schematic and Curved construction became
  **Construction** with a Straight / Along the path switch. Days vs depth, Hole sections, Runs
  and Daily history became **Drilling record** with four tabs. String and Loads became
  **Strings**: live loads on a design, recorded string and API ratings on FORGE. Layouts are kept
  under `deck-layout-v3`, so a layout kept with the old modules is not reused.
- **SDK trimmed** to what the deck and its tests use: `GisMap` (and its tools, trajectory layer,
  bathymetry), `OffshoreScene`, `SurveyTable`, `BuildHoldForm`, `TrajectorySummaryPanel` and
  `ComponentPalette` deleted, with 177 CSS rules only they used. `/gis` now points at `WellsMap`.
- **Real petrophysics on FORGE** from the 16A(78)-32 wireline logs (GDR 1292); see
  [the source record](FORGE_SOURCE_RECORD.md#open-hole-logs-petrophysics). The Logs module has an
  Open hole set; the lens reads φD, RT90, P32, K and Th at the cursor.


## Phase 4 as built (October 2026)

- **Scenario 6, slice to section.** The 3D site's slices report and follow the store's
  `seismicSlices`; each slice has a handle to drag in 3D (orbiting stays free elsewhere). The
  Seismic tile shows the published SEG-Y along the well, or the inline or crossline last moved, cut
  from the same PSDM sub-volume by core `cubeSection` (nearest bin, dequantised; the offset-0 inline
  matches the published section to within half a count). Its ◀ ▶ step the slice in 3D too.
- **Scenario 7, draw a section on the globe.** `WellsMap` has Draw section (ends snap to wellheads,
  Esc cancels). The line opens a Section line tile: core `cubeAlongLine` cuts the volume along it,
  clipped to the volume, and every FORGE well within two bins of the plane is drawn where it passes
  (16A linked to the depth cursor, with its strings and tops). The 3D site shows the line as a
  cutting plane.
- **Scenario 8, fuse modules.** Dropping a tile on the middle of a fusable target fuses instead of
  swapping: Logs onto Well in 3D wraps an open-hole curve around the well (gamma ray, fracture
  intensity, resistivity or density porosity); Well section onto Seismic or Section line draws the
  formation tops across it as horizons, planar at the well's contact. A chip on the target changes
  the curve or pulls the fusion off.
- **Anti-collision** (the first of the next tools), from the 16B and 58-32 surveys and GPS wellheads:
  a module with a ladder and a travelling cylinder, the neighbours on the globe and in the 3D site.
  See [the source record](FORGE_SOURCE_RECORD.md#neighbouring-wells-anti-collision).
- **Fixed on the way.** The command bar now matches hyphenated names; a 3D scene closed before its
  renderer started no longer reports an error over its successor; seismic marker text reads on the
  dark deck.

## The next tools, one by one (October 2026)

- **Anti-collision, gaps closed.** Licensed as-built wellheads for 16A and 16B (16A moved 16.2 m from
  the planned position it had been drawn on), 58-32's KB from its log header, and ISCWSA separation
  factors from OWSG generic error models per reported tool (checked against welleng). 16A–16B
  falls to SF 0.79 at about 1,780 m MD.
- **Geomechanics** (1D mechanical earth model): see [the source record](FORGE_SOURCE_RECORD.md#stresses-1d-geomechanics).
- **Torque & drag**: a Drilling module on FORGE, calibrated on 16A's daily reports; see [the source record](FORGE_SOURCE_RECORD.md#string-weights-torque-and-drag).
- **Well barriers**: primary and secondary envelopes (core `barriers.ts`) drawn on the construction,
  with each element's evidence and the records' gaps. On FORGE as built: one surface valve on record,
  no cement record outside the 9 5/8 in string, no wellhead rating or test.
- **Decline curves**: a Production module that works wherever the deck is (like the globe), on
  Sodir's monthly production of every Norwegian field, built by `tools/survey/build_sodir_production.py`.
  Fields are not on the globe: the production table has no locations, and placing them needs
  Sodir's field outlines, a further download.

## Checks

Unit tests for the store, the signal helpers, the registry and the what-if history. Static-render
tests for every module's empty, partial and full states. Phase screenshots taken by hand with a
headless browser script. No browser end-to-end suite, by decision.

## Decisions taken in this plan (say if any is wrong)

1. Night deck is the default; day deck and high contrast remain.
2. A tiled deck with a stage, rather than a fixed layout.
3. Six fixed signals with fixed colours.
4. A new app, `apps/deck`, rather than reusing the old demo's name.
5. `motion` and `cmdk` as the only new runtime libraries (`@dnd-kit` proved unnecessary).
