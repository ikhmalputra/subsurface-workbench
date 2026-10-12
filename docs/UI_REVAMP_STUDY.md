# Subsurface workflow study, and what the UI gets wrong

Written before changing any UI. The conclusion is that this application already contains a correct
architecture — it is just only used by three of the thirteen routes.

## 1. How subsurface work actually flows

Well work moves through seven stages. What matters for an interface is not the stage names but the
**index axis** each one reasons on, because that is the only thing that lets two views sit together
and mean something.

| Stage | The question being asked | Index axis |
| --- | --- | --- |
| Frame | Where are the wells, what does the seismic show? | XY + TVD |
| Correlate | How do these wells relate stratigraphically? | MD/TVD, flattened on a marker |
| Evaluate | What is the rock — porosity, saturation, net pay? | MD |
| Design | Where do we drill, what casing, what cement? | TVD + pressure |
| Drill | What happened, how fast, what went wrong? | **date and MD together** |
| Complete / produce | What is installed, what is it flowing? | time |
| Report | What do we actually know, and how well? | document |

Only four things ever link two views: **measured depth, XY position, time, and the selected
component**. Everything else is presentation.

## 2. The five axes present in this codebase

| Axis | Views | Note |
| --- | --- | --- |
| **MD metres** | `AssemblySchematic`, `TrajectoryLog`, `SeismicSection`, `WellScene`, `PetrophysicsLogView`, `WellReportView`, `SurveyTable`, `ComponentInventory` | the dominant cluster; all already expose `cursorMdM`/`mdWindow` |
| **MD feet** | `LogTracks`, `WellHistoryLog`, `ServiceRunLog`, `HoleSectionLog` | **unit-incompatible.** `FT_TO_M` is private at [records.tsx:16](../packages/react/src/records.tsx); the store's `depthLink.window` is metres-only |
| **TVD / pressure** | `PressureWindowPlot`, `GeologyPressureEditor`, `TrajectorySectionView` | keyed on `FormationLayer.topTvdM` |
| **XY** | `GisMap`, `MapHub`, `OffshoreScene`, `TrajectoryPlanView`, `WellCrossSection` | shared slot is `activeAsset.spatial_xyz` |
| **time** | `ProductionSurveillanceView`, `LinkedDatasetView`, `DaysVsDepthChart` | only the first two share `dataInteraction.timeRange` |

Three MD-indexed views **cannot follow a depth cursor at all** — `AssemblyScene`,
`CurvedAssemblySchematic` and `CurvedSchematic` expose only `selectedId`. The 3D and curved views
cannot participate in depth linking until those props exist.

## 3. What is actually wrong

### The architecture already exists, and three routes use it

`/map/`, `/correlation/` and `/cross-section/` have **zero local state**. Everything is hoisted into
`workspace-provider.tsx` (`fieldOptions`, `fieldWellIds`, `fieldGisState`, `fieldStore`), and the
three "routes" are tool modes over one project. They already behave like panels of one workspace.
**This is the target, and it is already in the repo.**

### The well routes are the same data, re-read five times

`/view-well/`, `/trajectory/`, `/edit-well/`, `/analysis/` and `/well-report/` read identical
`wells-data` + `forgeOperations` + the same LAS URL, and already share one store. Yet:

- the **LAS is fetched and parsed three times** by three different parsers
- the **survey is rendered by five different component sets** across four routes
- **operations tables exist in four forms** (well-file, analysis runs, analysis days, report)
- the seismic volume and the schematic are **mutually exclusive values of one `layout` state**, so
  even inside the richest route the facets are sequenced rather than combined

This is the "one on this page while the other is on another page" complaint, and it is purely a
composition problem. No data work is required to fix it.

### Duplication count

5 well selectors · **9 depth cursors** · 5 component inspectors · 7 records tables · 8 toolbars ·
7 status lines · 4 tab strips. One theme control (the only thing that is already singular).

### Gates that lie

- `/production/`'s document is keyed to `wellId === wells[1].design.id` — the s-profile well in the
  project — yet `WorkspaceRoute` still says "No compatible dataset registered for this well". The
  gate is a **route-name check, not a data check** ([workspace-routes.ts:52](../apps/demo/src/lib/workspace-routes.ts)).
- `/builder/` ignores the active well entirely **with no gate at all**, while the context bar and
  status bar keep asserting the active well over a canvas editing something unrelated.

### State that does not survive

- `activeAsset.componentId` is nulled by **every** `/view-well/?well=` entry, so the selection
  carried out to `/edit-well/` is dropped on the way back. Selection is one-way.
- `viewState` is written only by `/view-well/`; `/trajectory/`'s `WellScene` is given no
  `cameraView`, so **two 3D views of the same well never share a camera**.
- `dataInteraction` is **never written on the shared store at all** — only on the private stores of
  `/linked-data/` and `/production/`.
- A browser **Back** while `/view-well/` is mounted hydrates `createInitialSubsurfaceState()` — a
  full wipe of pinned depth, window, slices, camera and interpretation.
- The application frame itself remounts on every navigation, because `DemoAppearance` is rendered
  inside each page rather than in `layout.tsx`.

## 4. Genuinely incompatible versus merely duplicated

**Genuinely incompatible — needs data work, not layout work:**

- **Field wells** measure MD from the *seabed wellhead* against a synthetic sea surface in
  EPSG:32650; project wells measure MD from RKB in a well-local frame. Two datums. Combining them
  means reconciling datums, and inventing that reconciliation would be fabricating evidence.
- **`/petrophysics/` and `/linked-data/`** reference well ids that do not exist in the project.
  There is no FORGE density, neutron, resistivity or sonic data anywhere — the report says so
  explicitly. They are wells in their own right, not views of an existing well.
- **`/sandbox/`** is a synthetic cube with no well association at all.

**Merely duplicated — pure composition:** the five well routes above.

**Falsely gated:** `/production/`.

**Unflagged:** `/builder/`.

## 5. Target architecture

### One project, wells that declare what they have

Data moves off pages and onto wells. A well carries its design, components, survey, formations and
then optionally operations, a mud log, seismic, petrophysics, production and a geographic position.
`makeSyntheticWell()` and `makeDocument()`, currently defined inside route components, become
project wells — which also makes `/petrophysics/` and `/production/` honest: those wells really do
have that data, and FORGE really does not.

**View availability is derived from data presence, never from route name.** A view is offered when
the active well has what it needs, and says "not reported" when it does not. That is how the rest of
this repo already treats missing data.

### One workspace, panes instead of pages

The five well routes become view presets over a single workspace. The frame moves to `layout.tsx` so
it genuinely survives navigation. Each pane hosts one view; panes synchronise through the store that
already exists.

Presets follow the workflow in §1: **Frame · Correlate · Evaluate · Design · Drill · Report.**

### One cursor, one selection, one camera

Nine depth cursors collapse to the store's `depthLink`. The feet-indexed operations views get a
single documented conversion at the host boundary — one bridge, not four ad-hoc ones. `viewState` is
threaded into every 3D view so the camera is shared. `componentId` stops being cleared on re-entry.

### What stays separate, and is labelled as such

The Field project keeps its own store and datum until the datums are reconciled. Saying so in the
interface is more honest than merging two depth references and hoping.

## 6. Build order

1. **Project model** — wells with declared datasets; lift the two embedded fixtures. Unblocks
   everything, commits to no particular UI.
2. **Load once** — one LAS parse, one SEG-Y parse, one computed survey per well, shared by panes.
3. ~~**Frame to `layout.tsx`**~~ — done. The frame was rendered inside every page and handed the
   route as a prop, so it was part of each route's own tree and navigating replaced it; `Workbench`'s
   claim that the canvas host "is never keyed off the route" was true of the component and false of
   the application. It now mounts once in `layout.tsx` — Next caches a layout across navigation and
   does not re-render it — and reads the active route through `usePathname` in a client component,
   which does re-render, so the highlight follows while the frame stays put. Proved by an e2e test
   that stamps the live sidebar and status nodes and walks five destinations; it fails against the
   previous wiring on the first navigation.
4. ~~**Depth bridge**~~ — done. `0.3048` was a bare literal at roughly two dozen call sites and five
   private constants under four names; the store side stays metres and
   `apps/demo/src/lib/depth.ts` is now the only thing that knows both units, with the two feet this
   project's own data uses — international (0.3048) and US survey (1200/3937) — named in
   `core/units.ts`. The audit found two live defects in `curved-schematic`, both from using
   `provenance` as a unit: an edited FORGE well stated one component's extent as "8.5 m MD to
   1,629 ft report MD", and a feet factor applied to `topTvdM` drew FORGE's granite reservoir in the
   top quarter of a well it fills the bottom half of. Both fixed, both pinned by tests verified to
   fail against the previous code.
5. **Panes and presets** — the five well routes become one workspace.
6. **Cursor props for the three blind views** — `AssemblyScene`, `CurvedAssemblySchematic`,
   `CurvedSchematic`.
7. **Retire the route gates** in favour of capability checks.

---

# Second pass: what belongs on screen together

The first pass asked what is duplicated. This one asks the harder question — **which views are
useless apart** — by taking each stage's actual decision and asking what evidence a person needs in
front of them to make it. Written after step 1 (project model) and step 2 (load once) landed.

## 7. Stage by stage: the decision, and what it needs simultaneously

A pairing earns its place only if the decision **cannot** be made by looking at one view and then the
other. Everything else is a tab.

| Stage | The decision | Must be simultaneous | Shared key | Status here |
| --- | --- | --- | --- | --- |
| Frame | Is this well where I think it is? | map · section through it · trajectory plan | XY | **works** (`/map`) |
| Correlate | Is this the same rock in both wells? | N logs side by side, flattened on one marker, tops joined | MD, flattened | **works** (`/correlation`) |
| Evaluate | Is this interval pay? | multitrack log · crossplot · histogram · zone summary — *one dataset, three projections* | MD **and sample identity** | partly — see §9.1 |
| Design | Where does the shoe go? | mud-weight window · casing scheme · cement plan · trajectory TVD | TVD | **broken** — see §9.3 |
| Drill | Why did this interval take so long? | days-vs-depth · daily records · service runs · the mud log at that depth | **date and MD together** | **broken** — see §9.2 |
| Complete | What is installed and what is it flowing? | schematic · production history · events | MD + time | separate routes, two stores |
| Report | What do we actually know? | the document, with every number's source | document | **works** (`/well-report`) |

Three stages already work. Three are broken in a specific, fixable way, and each one is broken for
the same underlying reason: **the shared key the views need is finer than the key the store carries.**

## 8. What the reference apps got right, and what they got wrong

**Petrel's "perspectives" are presets, and they are per-discipline.** Petrel 2014 moved to a ribbon
with a different ribbon per discipline — geology/geophysics, reservoir, production, drilling — and
reported *click counts per task and mouse mileage* as the measure of whether the reorganisation
worked, with a route back to the old interface for people it did not suit. Three lessons, in order of
importance: presets are **named after the discipline, not the view**; the claim is **measurable**, so
measure it; and there is **a way out** for someone the preset does not fit. Our §5 presets are named
after the workflow stages, which is the same idea arrived at independently — and we have no measure
and no escape hatch yet.

**Interactive Petrophysics and Techlog link crossplots to depth by the sample, not by the range.**
The practitioner workflow is: brush the shale cloud on a crossplot, and *those samples* light up on
the log beside it — hover a point, the depth highlights; drag a box, the samples mark along the
borehole, with the log placed immediately beside the crossplot at a matching depth scale. Our
crossplot brushes, computes exactly that set — and then throws it away, emitting only its MD extent
([petrophysics-analysis-view.tsx:74](../packages/react/src/petrophysics-analysis-view.tsx)). §9.1.

**Core-to-log work starts with a depth shift.** The standard practice is that core depth is adjusted
to log depth *before* any comparison, and then the comparison is made three ways at once — overlay
versus depth, crossplot, histogram. We render core points as fixed MD markers with no shift
affordance, which means our core-to-log view begins one step after the step that matters.

**Drilling performance is read as plan versus actual, with every event at the depth and time it
happened.** Days-vs-depth is the canonical chart, and what makes it useful is NPT and bit runs marked
on it, then benchmarked against offsets. Ours draws the actual curve, alone. §9.2.

**The mistake we should not copy — and have:** a *wizard per decision*. Our well design is a
ten-step `switch (step)` that shows exactly one panel at a time
([well-design-workflow.tsx:140](../packages/react/src/well-design-workflow.tsx)), and its own help
text admits the coupling it then hides: *"Every pressure load downstream uses TVD from this plan.
Changing it moves TD; re-propose the casing scheme afterwards."* The interface knows two panels
depend on each other and asks the engineer to remember the dependency instead of showing it. That is
the same error as the mutually-exclusive `layout` variable in §3, in a different file.

## 9. Three modules worth building

Each one is backed by data already in the repo, and each closes a specific gap above.

### 9.1 A shared **sample** selection, not just a depth window

`dataInteraction` in the store already has `hoveredId`, `selectedIds`, `depthRange`, `timeRange` and
`brush` — the exact shape this needs — and §3 found it **is never written on the shared store at
all**. Meanwhile the crossplot reduces a brushed cloud to `[minMd, maxMd]`.

Why that reduction is not merely coarse: the synthetic well's porosity curve dips between samples 72
and 92 and the gamma ray steps up after 70, so brushing the low-porosity cloud returns samples from
*both* ends of the logged interval. Their MD extent is then almost the whole well, and every sample
in between — including the five nulls at 55–59 — is presented as selected. The view's own caption is
honest about this ("link their measured-depth extent"), which is the tell: a correct statement about
the wrong quantity.

The fix is small and additive. `onBrushChange` keeps its range; a new `onBrushSamples(ids, mdMs)`
reports the set, the workspace writes it to `dataInteraction.selectedIds`, and the log view, the
sample table and the zone summary read it. The histogram gets it for free. **This also makes
`/petrophysics/` and `/linked-data/` panes of a workspace** rather than isolated examples — they
become the first two views that share a selection finer than a depth.

### 9.2 A drill-stage pane: one chart on the date **and** MD axes

`DaysVsDepthChart` takes `focusDate` and `onSelectDay` and nothing else — the only view on the axis
§1 calls "date and MD together" cannot accept or emit a depth. So the question "why did this interval
take so long" is answered by reading four views in sequence and holding the depth in your head.

Everything needed is already in `forgeOperations`, and the counts are worth stating because they
decide whether this is a visualization or a fabrication:

- **76 daily reports**, each already classified into one of ten activity categories — `drilling` 15,
  `tripping` 16, `rig` 12, `casing` 9, `circulating` 7, `logging` 6, `coring` 6, `testing` 3,
  `repair` 1, `other` 1. That is enough to colour the curve by what was actually happening, which is
  the thing a drilling engineer reads first.
- **9 of 54 service runs** ended `problem` or `failed`. **Correction:** this first said "each has a
  depth interval and dates". The records carry neither dates nor, in five of the nine cases, a top
  depth — they report a base and nothing above it. So they are placeable on the depth axis only, and
  five of them as a line rather than an interval, because a band would have to invent the top. All
  nine are now marked, with the legend stating which is which. The same check killed a second idea:
  colouring the curve by whether a day made hole looked attractive until the data showed 37 days
  reporting footage and **39 reporting none at all** — so that colouring would have shown reporting
  completeness while claiming to show progress.
- **66 of 76 days carry a mud weight**, so the weight actually used can be drawn against the designed
  pressure window, with the other 10 days shown as not reported.

What is **not** there: a planned depth-versus-days curve. `WellDay.planned` is the day's narrative
text, not a plan. So plan-versus-actual is a host-supplied addition to the operations contract, and
until a host supplies one we draw actual only and say so. Colouring by category, marking the nine
bad runs, and giving the chart `cursorMdM` / `onSelectMd` needs no new data at all.

### 9.3 Unlock the design panels from the wizard

Eleven design views are individually exported, individually props-driven, and mounted in exactly one
place each — inside `WellDesignWorkflow`: `WellIdentityForm`, `WellLocationForm`,
`GeologyPressureEditor`, `PressureWindowPlot`, `CasingSchemeTable`, `CasingLoadCard`,
`CementPlanTable`, `CompletionForm`, `DesignCoveragePanel`, `DesignReadinessPanel`,
`WellProgrammeSummary`.

**Correction to this section as first written.** It claimed `PressureWindowPlot` is "reachable
through exactly one step of one wizard". That is wrong, and reading the workflow rather than the
mount count shows why: each step renders a `main` *and* an `aside`, and the pressure plot is the
aside for the offsets, geology, casing and cement steps. The casing scheme and the mud-weight window
are therefore already side by side — the pairing §7 says the shoe-depth decision needs. The
construction canvas is likewise always present, which is what `canvas-workbench`'s no-remount test
already asserts.

What survives the correction is narrower and still worth fixing:

- **One mount site means a host cannot compose them.** Using the pressure window beside its own
  casing table requires copying a 236-line reference composition. That is a packaging problem, not a
  layout one, and it is the same shape as `MapHub` having no caller at all.
- **Only two panels at a time, chosen for you.** The coupling the wizard's own help text states —
  *"Every pressure load downstream uses TVD from this plan. Changing it moves TD; re-propose the
  casing scheme afterwards"* — is between the trajectory step and the casing step, which are in
  different phases and never visible together. The phases already group the steps, so a phase is a
  pane set waiting to be used.

(`MapHub` is mounted nowhere at all — not in the SDK, not in the app. It is the only view in the
package with no caller, and should be either placed in the Frame preset or deleted, not left in the
third state.)

## 10. Build order, revised

1. ~~**Project model**~~ — done (`apps/demo/src/lib/project.ts`, 6 tests).
2. ~~**Load once**~~ — done (`apps/demo/src/lib/well-data.ts`, 5 tests): one LAS fetch and parse per
   well shared by three views, projections memoized per parse, minimum curvature once per station
   list, and `wells-data` reduced to a view of the project.
3. ~~**Frame to `layout.tsx`**~~ — done. The frame was rendered inside every page and handed the
   route as a prop, so it was part of each route's own tree and navigating replaced it; `Workbench`'s
   claim that the canvas host "is never keyed off the route" was true of the component and false of
   the application. It now mounts once in `layout.tsx` — Next caches a layout across navigation and
   does not re-render it — and reads the active route through `usePathname` in a client component,
   which does re-render, so the highlight follows while the frame stays put. Proved by an e2e test
   that stamps the live sidebar and status nodes and walks five destinations; it fails against the
   previous wiring on the first navigation.
4. ~~**Depth bridge**~~ — done. `0.3048` was a bare literal at roughly two dozen call sites and five
   private constants under four names; the store side stays metres and
   `apps/demo/src/lib/depth.ts` is now the only thing that knows both units, with the two feet this
   project's own data uses — international (0.3048) and US survey (1200/3937) — named in
   `core/units.ts`. The audit found two live defects in `curved-schematic`, both from using
   `provenance` as a unit: an edited FORGE well stated one component's extent as "8.5 m MD to
   1,629 ft report MD", and a feet factor applied to `topTvdM` drew FORGE's granite reservoir in the
   top quarter of a well it fills the bottom half of. Both fixed, both pinned by tests verified to
   fail against the previous code.
5. **Panes and presets** — the five well routes become one workspace. Includes §9.3, because the
   Design preset cannot exist while the design panels have one mount site.
   - **5a done.** `/view-well/`'s seven mutually exclusive `&&` branches are now a keep-alive pane
     group: `PaneGrid`/`Pane` in the shell hold the membership and the host keeps its own geometry.
     The sets were always sets — "2.5D + 3D" is two panes — the interface just could not say so, and
     every change of view destroyed the drawing, the 3D scene and the section, discarding zoom,
     camera and the lazily imported renderer and refetching the SEG-Y. Panes now mount on first use
     and are kept. Proved by a test that stamps the live nodes and cycles five presets; it fails
     against the previous wiring. Found while doing it: `hidden` does not guarantee a pane takes no
     space — the UA rule loses to any class that sets `display`, and a 3D pane's `display: grid` kept
     a 700px invisible pane in flow, pushing the depth controls below the fold.
   - **5b done.** The active well's directional picture is a preset of its own workspace: a plan
     view and a vertical section as panes of `/view-well/`, sharing the one pinned depth and one
     derivation of the casing-shoe markers. The surveyed path was rendered by five component sets
     across four routes, so asking where a well goes meant leaving the well.
   - Still to do: the remaining well routes as presets, and §9.3 as corrected above — a host-facing
     composition of the design panels, and phases as pane sets.
6. **Cursor props for the blind views** — `AssemblyScene`, `CurvedAssemblySchematic`,
   `CurvedSchematic`. `DaysVsDepthChart` is **done**: it takes `cursorMdM` and emits `onSelectMd`,
   so the one view on the drill stage's own axis finally joins the shared depth. Its Y axis was
   already measured depth, so the cursor is exact.
7. **Retire the route gates** in favour of capability checks.
8. **Shared sample selection** (§9.1) — additive to the store's existing `dataInteraction`, and the
   thing that makes Evaluate a workspace rather than a page.

Steps 3–7 are composition over existing components. Step 8 and the §9.2 colouring are the only new
capability, and both are built from data the repo already holds.
