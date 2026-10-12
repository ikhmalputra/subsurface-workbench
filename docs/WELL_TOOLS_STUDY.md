# Well tools study — one sheet, every function a tool

Ikhmal's direction, 12 Oct 2026: *one big page. Analysis and the rest are tools I built for the
well. Like AutoCAD: a button to insert, and it opens its data if it exists. Everything is a tool
for the well, which is why there is view, create, edit and delete.*

This study takes that literally. The sheet is the well. There are no pages. Every capability the
repository has — and every one it should have — is a **tool**: a command with a verb (`view`,
`create`, `edit`, `delete`) acting on one **object** of the subsurface domain, opening as a panel
that floats or docks, reading the object's data when the host has it and offering to create it
when it does not. The navigation becomes a tool palette; the command line runs the same tools by
name. The routes are what we delete.

## 1. The model, from AutoCAD

AutoCAD has one drawing and a command set. `INSERT` places a block and asks for its definition if
it is not in the drawing; `OPEN` reads one that exists; `PROPERTIES` edits whatever is selected;
`ERASE` removes it. The user never leaves the drawing to do any of this: a command opens a palette
beside the drawing, does its work against the same selection, and the drawing updates as it goes.

Translated:

| AutoCAD | Here |
| --- | --- |
| the drawing | the well section on the sheet — the schematic, log and survey on one depth axis |
| a block | an **object**: a casing string, a survey, a formation top, a daily report, a study |
| `INSERT` | **create**: open the object's editor empty, with nothing invented, and insert on save |
| `OPEN` | **view**: open the object's data in its panel; the tool knows whether the host has it |
| `PROPERTIES` | **edit**: the same panel against the selection, writing through the host's callbacks |
| `ERASE` | **delete**: remove the object from the host's data through the same callback |
| the command line | the status-bar command line: `view survey`, `edit casing production-casing`, `create study` |
| palettes | panels: float, or dock left/right/top/bottom; same-side panels share the side |
| the selection | the store's `activeAsset` — well, component, depth — one for every tool |

Two rules carry over from the SDK's charter and do not bend:

- **The host owns the data.** A tool reads what the host registers for the well and writes back
  through the host's callbacks (`onChange`, `onBriefChange`, revisions). The SDK stores nothing
  and invents nothing: a tool whose data the host has not supplied says so and offers *create*.
- **Nothing is simulated.** *Create* starts empty. A survey is entered station by station or
  planned from a build-and-hold input the user types; a log is attached, never generated.

## 2. The domain: objects of a well

The subsurface domain, scoped to what a well-engineering workbench reasons about. Each object is
listed with the record it is keyed on and the depth axis it lives on, because every tool joins on
those two things. OSDU/PPDM names are given where the alignment is direct, so a host's records map
without translation layers.

### 2.1 Identity and reference

| Object | Keyed on | Axis | OSDU / PPDM | In the repo today |
| --- | --- | --- | --- | --- |
| **Well** — name, UWI/API, operator, field, spud, status | well id | — | `master-data--Well`; PPDM `WELL` | `WellDesign` identity; the well picker; fixtures `wells-data` |
| **Wellbore** — one hole under the well (sidetracks are wellbores) | wellbore id | — | `master-data--Wellbore` | implicit: one wellbore per well; no sidetrack model |
| **Reference** — surface location, CRS, depth datum (RKB/GL/MSL), elevation | well | — | `Meta`/`VerticalMeasurement`, `WELL_DIR_SRVY` datum | `depthDatum`, `groundTvdM`, `crs.ts`, `frames.ts` (registry built, not wired) |

### 2.2 Geometry

| Object | Keyed on | Axis | OSDU / PPDM | In the repo today |
| --- | --- | --- | --- | --- |
| **Trajectory / survey** — stations (MD, inc, azi) → positions by minimum curvature | wellbore | MD | `--WellboreTrajectory`; PPDM `WELL_DIR_SRVY_STATION` | `trajectory.ts` (compute, validate, plan), `TrajectoryLog`, plan/section views, `SurveyTable`, build-and-hold planner |
| **Trajectory plan** — build-and-hold input (KOP, build rate, target) | wellbore | MD | — (design) | `BuildHoldForm`, `planBuildHold` |

### 2.3 Construction

| Object | Keyed on | Axis | OSDU / PPDM | In the repo today |
| --- | --- | --- | --- | --- |
| **Hole section** — bit size, top/base | wellbore | MD | PPDM `WELL_TUBULAR` (hole) | `HoleSectionLog`, hole components in `WellDesign` |
| **Casing / liner / tubing string** — OD, ID, weight, grade, top/shoe, cement TOC | wellbore | MD | `--WellboreTubular`?; PPDM `WELL_TUBULAR` | `WellComponent`, `wellComponentsToAssembly`, builder, schematic, cutaway |
| **Cement** — interval, TOC, slurry | string | MD | PPDM `WELL_CEMENT` | cement in design brief and schematic (TOC) |
| **Completion equipment** — packers, nipples, valves, mandrels, gauges | wellbore | MD | PPDM `WELL_EQUIPMENT` | component catalogue (55 parts), palette, placement rules |
| **Surface equipment** — wellhead, tree | well | above 0 | — | surface stack in the schematic |

### 2.4 Geology and pressure

| Object | Keyed on | Axis | OSDU / PPDM | In the repo today |
| --- | --- | --- | --- | --- |
| **Formation / top** — name, top, base, lithology | wellbore | TVD (MD via survey) | `--WellboreMarkerSet`; PPDM `WELL_STRAT` | `FormationLayer`, formations on schematic/scene/section |
| **Pressure window** — pore, fracture, mud weight by depth, with provenance | wellbore | TVD | PPDM `WELL_PRESSURE` | `GeologyPressureEditor`, `PressureWindowPlot` in the design brief |
| **Interpretation** — horizons, picks on seismic | field | TWT/depth | `--SeismicHorizon` | `interpretation.ts`, `InterpretationControls` (volume slices) |

### 2.5 Measurements

| Object | Keyed on | Axis | OSDU / PPDM | In the repo today |
| --- | --- | --- | --- | --- |
| **Log** — LAS curves (ROP, WOB, RPM, PP; wireline) | wellbore | MD (ft or m, as reported) | `--WellLog`; PPDM `WELL_LOG` | `parseLas`, `LogTracks`, `PetrophysicsView`, `useLas` |
| **Seismic section / volume** — SEG-Y along the well, PSDM cube | field | depth/TWT | `--SeismicTraceData`, `--SeismicBinGrid` | `parseSegy`, `SeismicSection`, `WellScene` volume, WebGPU sandbox |
| **Petrophysical analysis** — templates, cutoffs, histograms | wellbore | MD | — | `petrophysics-analysis.ts`, `PetrophysicsAnalysisView` (developer example) |

### 2.6 Operations

| Object | Keyed on | Axis | OSDU / PPDM | In the repo today |
| --- | --- | --- | --- | --- |
| **Daily report** — date, activity, end-of-day MD, headline, page | wellbore | date → MD | PPDM `WELL_ACTIVITY` | `WellHistoryLog`, `DaysVsDepthChart` (76 FORGE reports) |
| **Run / BHA** — kind, interval, footage, outcome, page | wellbore | MD | PPDM `WELL_BA_SERVICE` | `ServiceRunLog` (54 runs), trouble marks |
| **Operational sources** — report citations (page) | well | — | — | `sources` on `WellOperations`; shown everywhere |

### 2.7 Design

| Object | Keyed on | Axis | OSDU / PPDM | In the repo today |
| --- | --- | --- | --- | --- |
| **Design brief** — identity, location, offsets, geology, trajectory, casing scheme, cement, completion | well (draft) | MD/TVD | — | `well-design.ts`, `WellDesignWorkflow` (ten steps, five phases) |
| **Design checks** — API 5C3 ratings, kick tolerance, sour service, coverage | brief | — | — | `validateDesign`, `designCoverage` |
| **Offset wells** — comparable wells, nine-factor match, adoption | field | — | — | `offset-wells.ts`, `OffsetWellLibrary` |

### 2.8 Evidence and output

| Object | Keyed on | Axis | OSDU / PPDM | In the repo today |
| --- | --- | --- | --- | --- |
| **Study** — question, target/comparison intervals, evidence ids, finding, uncertainty | well + revision | MD | — | `drilling-study.ts`, `AnalysisWorkspace` (local storage, by Ikhmal's charter should be host-persisted) |
| **Report** — host-owned spec with sourced figures | well | — | — | `well-report.ts`, `WellReportView` (sheet space) |

### 2.9 Field

| Object | Keyed on | Axis | OSDU / PPDM | In the repo today |
| --- | --- | --- | --- | --- |
| **Field / project** — wells, CRS, layers | field | XY | — | `field-project.ts`, `FieldWorkspace` |
| **Map layers** — vector, raster, bathymetry | field | XY | — | `gis.ts`, `GisMap`, `gis-tools` |
| **Correlation / cross-section** — wells side by side on one datum | field | TVD | — | `Correlation`, `WellCrossSection` |
| **Production surveillance** — rates, pressures, events | well | time | PPDM `PDEN` | `production-surveillance.ts` (developer example) |

## 3. The tools: object × verb

A tool is `verb object`. **Bold** cells exist as a route or panel today; *italic* cells exist as
code without a user-facing tool; blank cells are missing. "Exists?" is what the tool checks before
it opens: the host has supplied the object for this well or it has not.

| Object | view | create | edit | delete | Exists? today |
| --- | --- | --- | --- | --- | --- |
| Well | **well picker, facts in inspector** | — | **edit well identity (Edit well → Well properties)** | — | host registry (`wells`) |
| Reference / datum | **read-out in status bar** | *frames.ts* | **edit well (location, datum)** | — | `depthDatum`, `crs` |
| Survey | **section track, plan/section views, table** | **planner (build & hold)** | **station editor** | — | `design.survey` |
| Hole section | **hole-section log, section track** | *builder adds hole components* | **builder** | **builder** | components |
| Casing / tubing | **schematic, cutaway, inventory, properties** | **builder palette (drag in)** | **builder properties** | **builder remove** | components |
| Cement | **TOC on schematic, brief cement step** | **brief cement step** | **brief** | — | brief / component |
| Completion equipment | **schematic, cutaway, inventory** | **builder palette** | **builder properties** | **builder remove** | components |
| Formations | **schematic/scene layers, section bands** | **edit well → formations** | **edit well → formations** | **edit well → formations** | `design.formations` |
| Pressure window | **brief geology step** | **brief** | **brief** | — | brief |
| Log (LAS) | **section track, well file, petrophysics** | **edit well → data sources (attach)** | — | **detach** | `logUrl` |
| Seismic | **seismic preset, 3D volume, sandbox** | — (host registers) | *interpretation slices* | — | `seismic` on the well |
| Daily reports | **well file, days-vs-depth** | — | — | — | `operations.days` |
| Runs | **well file, run marks on log** | — | — | — | `operations.runs` |
| Design brief | **builder** | **builder → New design** | **builder steps** | — | builder draft (localStorage, host-persisted by charter) |
| Design checks | **builder → Checks** | — | — | — | computed |
| Offset wells | **builder → Offset wells** | **register offset** | **adopt** | — | offset library |
| Study | **analysis → saved studies** | **analysis → New study** | **analysis steps** | — | localStorage (host-persisted by charter) |
| Report | **well report** | — (host spec) | — | — | report spec |
| Field / map | **field workspace** | **GIS import** | **layers** | **remove layer** | field project |
| Correlation / cross-section | **field tools 2 and 3** | — | — | — | field project |
| Production | **developer example only** | — | — | — | synthetic fixture |
| Petrophysical analysis | **developer example only** | **templates** | **cutoffs** | — | synthetic fixture |

What the matrix says: **view is nearly complete; create/edit/delete exist for construction, survey,
formations and design, and are absent for operations, logs beyond attach, seismic and studies'
persistence.** The gaps are mostly *host-side* by design (daily reports are reported, not authored
in a schematic tool), but a tool must still *say* that: "Daily reports: 76 from the host · this tool
reads them; add reports through your reporting system" — the AutoCAD block that is "in the
drawing" versus "not in this drawing".

## 4. Command vocabulary

Every tool is reachable from the command line with the same words as its button, so a test, a
script and a user all drive the same thing:

```
view <object> [id]        open the object's panel; e.g. view survey · view casing production-casing
create <object>           open the object's editor empty; e.g. create study · create well
edit <object> [id]        the editor against the selection; e.g. edit casing (uses the selection)
delete <object> <id>      remove through the host callback, after a confirm line in the status bar
go <m MD> · zoom in|out|fit · well <name> · theme · density · clear · help   (already there)
```

Objects: `well reference survey plan hole casing cement completion formation pressure log seismic
report run brief checks offsets study report field layer correlation section production petro`.
A verb without an object lists objects; an object the host has not supplied answers
"not supplied for <well> · create <object> to start one" — never a silent empty panel.

## 5. Panels and placement

The tools reuse the one-sheet mechanism just built (`floating.tsx`): a tool opens as a panel in the
tray, docks or floats, and shares a side with its neighbours. Defaults that follow the drawing:

- **view** tools with a depth axis (survey, log, operations) open as **tracks on the section** when
  they can — the section is the drawing — and as a docked panel (bottom) when they are tables.
- **create / edit** tools open **docked right** under the inspector, so the editor sits beside the
  thing it edits and the drawing updates as the form changes (the section already redraws from
  the draft in the editor's section view).
- **field** tools open on their own sheet mode (the map replaces the section), since they are not
  keyed on one well; the well tools stay in the tray.

The tool palette replaces the navigation: one floating/dockable panel listing objects as rows with
their four verbs as buttons, greyed where the verb does not apply and labelled "not supplied" where
the host has no data. The command line is the same list by name.

## 6. Build order

1. **Tool registry** (`apps/demo/src/lib/tools.ts`): `{ id, object, verb, label, exists(well), open(host) }`
   for every row in §3, with `exists` reading the well's registered data. The command line's verbs
   dispatch through it; the palette renders it. No new tools yet — the registry wraps what exists.
2. **Palette panel** on the sheet, replacing the navigation's workspaces: objects × verbs, with
   the "not supplied" state visible. Routes become `open` handlers that mount the existing route
   component in a panel (trajectory, analysis, builder, report, field each become a tool panel).
   This is the point at which `/trajectory/` and `/analysis/` stop being pages.
3. **Depth-axis views as section tracks**: survey, log and operations already are; the study's
   evidence and the pressure window join them (pressure on TVD through the survey).
4. **Editors docked right**: survey station editor, builder properties and formation editor as
   `edit` tools against the selection; the brief's steps as `edit brief <step>`.
5. **Create and delete with host callbacks**: `create well`, `create survey` (planner), `create
   casing` (palette), `create formation`, `create study`; `delete` for components, formations,
   layers and studies — each through the revision/callback path, each confirmed on the command
   line, none persisted by the SDK.
6. **The gaps that are host data**: operations, seismic, report spec — tools that state what the
   host supplied and how to add more, with the citation they carry.
7. **Delete the routes.** One page, the tools, the command line.

## 7. What this is not

No database, no file custody, no OSDU client. No simulation: `create` starts empty. No PPDM schema
files; the names above are semantics for a host's mapping. No claim that a tool exists until its
row in §3 is bold.
