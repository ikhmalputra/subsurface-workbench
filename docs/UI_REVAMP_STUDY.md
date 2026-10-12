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
3. **Frame to `layout.tsx`** — make the no-remount claim true.
4. **Depth bridge** — metres store ↔ feet props, in one place.
5. **Panes and presets** — the five well routes become one workspace.
6. **Cursor props for the three blind views** — `AssemblyScene`, `CurvedAssemblySchematic`,
   `CurvedSchematic`.
7. **Retire the route gates** in favour of capability checks.
