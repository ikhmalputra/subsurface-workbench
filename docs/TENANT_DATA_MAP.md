# Tenant data map: every tool against WITSML, OSDU and PPDM

*Surveyed 2026-10-17 on master fd434c9. Read-only: no code changed.*

## Why this exists

The workbench is a front end only. Each tenant hosts it in their own cloud, builds the backend, and serves their data in industry standards: WITSML, PPDM, OSDU and the rest.

The datasets bundled today are demo samples:
- Utah FORGE
- FORCE 2020 North Sea
- Sodir field production
- the synthetic Kestrel A-7 and Equator

For each of the 34 tools, this document gives:
1. what the tool reads today;
2. whether a tenant can already bring their own data;
3. the standard objects a tenant would serve for it;
4. what is wired to one site.

From that, it derives the deck's **data contract**: the canonical objects every tool reads. It then ranks the adapters by how many tools each one unlocks.

**Labels used in this document:**
- **WITSML** means 2.1. It is the current version: it requires ETP 1.2 and replaces 2.0.
- **PPDM** means 3.9.
- **OSDU** names are well-known-schema kinds (`osdu:wks:<group>--<Entity>:<version>`), at the highest version in the `data-definitions` E-R folder.
- Where a cell says **none verified**, no standard object was found or confirmed; nothing was forced to fit.
- `file:line` references are to this repository.

---

## 1. How data reaches the tools today

- **Bundled samples.** `packages/fixtures/data/*` is copied to `apps/deck/public/data/` by `tools/sync-assets.mjs:32-35`. The deck fetches it as `${BASE}data/…` through `useFetched` (`apps/deck/src/data/fetch.ts:10-26`). LAS and SEG-Y are parsed in a worker (`compute/jobs.ts:9-15`).
- **Bundled JSON compiled into core.** These are imported at build time, not fetched:
  - `packages/core/src/forge-data.json`: survey, formations and components.
  - `forge-operations.json`: daily reports, runs and hole sections.
  - `forge-seismic.json`: seismic geometry and datums.
  - `forge-offset-wells.json`, `forge-offset-construction.json` and `forge-survey-uncertainty.json`.
  - `forge-string-weights.json` and `forge-58-32-stress.json`.
- **One well shape.** `Place` (`apps/deck/src/data/place.ts:22-44`) holds siteId, kind, wellId, label, design, components, assembly, stations, survey, formations, totalDepthM, operations, petro and petroLas. It is built per site kind by `usePlace()` (`place.ts:159-191`).
  - Only Logs, Globe, Site 3D, Plan, Profile and the construction views read a tenant-style well through it.
  - The other tools read FORGE or FORCE structures directly.
- **Site kinds are string literals.** They are `"forge"`, `"equator"`, the prefix `"force-q"`, design sites and recorded `rec-*` sites (`modules/registry.ts:156,165`). `wire.ts:21` falls back to well id `"forge"`.
- **What a user can bring today.** Everything below lives in the browser only (localStorage, IndexedDB or memory). None of it is a connection to a backend.
  - A recorded well: identity, location, datum, stations, tops and components (`data/records.ts:22-32`, localStorage `deck-wells-v1`).
  - LAS logs (`data/logs.ts:63-84`, IndexedDB).
  - A survey pasted or imported as CSV (`data/entry.ts:47-86`).
  - Design briefs (`data/design.ts:50-83`).
  - For the current session only: a QuakeML catalogue, a DTS LAS and an annulus LAS (`data/standard-files.ts:20-24`).

---

## 2. Tool by tool

**Columns:**
- **Today:** what the tool reads now, and whether a tenant can bring their own (✓ yes, ◐ partly, ✗ no).
- **Needs:** the canonical objects from §3, written C1, C2 and so on.
- **Effort:** how much work to feed the tool from the data layer. S is wiring; M is new reading or transforms; L is new streaming, models or storage changes.

### Geology and geophysics

| Tool | Today | Needs | WITSML 2.1 | OSDU | PPDM 3.9 | Other format | Effort |
|---|---|---|---|---|---|---|---|
| **globe** | Site index plus well heads and paths from every site builder (`data/sites.ts:19-34`). ✓ recorded wells and designs. Drilled-to-date path only for `"forge"` (`Globe.tsx:50`). | C1 C2 C3 | Well, Wellbore, Trajectory | master-data--Well, master-data--Wellbore, wpc--WellboreTrajectory (listed through Search) | WELL, WELL_DIR_SRVY_STATION | GeoJSON footprints | S |
| **site3d** | Wells from every builder; FORGE PSDM `.i8` cube, terrain `.i16`/`.jpg`, horizon and fault picks (`Site3D.tsx:32-78`, `sites.ts:65-92`, `terrain.ts:16-29`). ◐ wells only; no seismic or terrain import; picks drawn only at FORGE (`Site3D.tsx:54`). | C1 C2 C3 C5 C15 C16 C29 | Wellbore, Trajectory, WellboreMarkerSet | + wpc--SeismicTraceData, wpc--SeismicHorizon, wpc--FaultSystem | + SEIS_3D, SEIS_INTERP_SURFACE | RESQML Grid2dRepresentation / TriangulatedSetRepresentation; DEM as GeoTIFF (no subsurface standard) | M (L with seismic) |
| **seismic** | `forge-16a-psdm-section.sgy` (SEG-Y) plus the `.i8` cube; well overlay from `forgeDesign` (`DataModules.tsx:104-161`, `forge.ts:24-58`). ✗ whole module is FORGE. | C15 C2 C3 C5 C7 | none verified (well overlay only) | wpc--SeismicTraceData, wpc--SeismicBinGrid, served by the Seismic DDMS (Seismic Store, OpenVDS, OpenZGY) | SEIS_3D, SEIS_SET, SEIS_BIN_GRID | SEG-Y; RESQML 2.2 Seismic3dPostStackRepresentation, SeismicLatticeFeature | L |
| **attributes** | The FORGE `.i8` cube; attributes computed in the worker (`Attributes.tsx:29-38`, `compute/attributes.ts:13-33`). ✗ `spacingM: 25` fixed (`compute/attributes.ts:18`); cache keyed by `counts.length`, so it assumes one cube (`attribute-volumes.ts:38`). | C15 C16 | none verified | wpc--SeismicTraceData, wpc--SeismicFault, wpc--FaultSystem | SEIS_3D | OpenVDS bricks; RESQML FaultInterpretation, PolylineSetRepresentation | L |
| **curtain** | The `.i8` cube along a drawn line, plus the FORGE wells (`Curtain.tsx:14-68`). ✗ `FORGE_CRS = "EPSG:26912"` (`:15`), `siteById("forge")` (`:58`). | C15 C1 C2 C3 C5 C7 | Trajectory | wpc--SeismicTraceData, wpc--SeismicBinGrid | SEIS_3D, SEIS_BIN_GRID | SEG-Y / VDS | L |
| **correlate** | FORCE `wells.json` plus per-well `.i16` logs; user picks (`force.ts:32-63`, `picks.ts:9`). ◐ picks only; typed to `ForceWell`; GR fixed at 0–150 API (`Correlation.tsx:623`). | C1 C2 C3 C5 C6 C27 | Log, ChannelSet, Channel, WellboreMarkerSet, InterpretedGeology | wpc--WellLog, wpc--WellboreMarkerSet, wpc--WellboreTrajectory | WELL_LOG_CURVE, WELL_LOG_CURVE_VALUE, STRAT_WELL_SECTION, LITH_INTERVAL | LAS 2/3, DLIS | M |
| **tie** | `forge-58-32-tie.json` (DTCO, RHOZ, GR, HCAL) plus the cube; 58-32 survey and KB (`WellTie.tsx:29-67`). ✗ well, datum and file all fixed. | C6 C3 C2 C15 C17 | Log | wpc--WellLog, wpc--SeismicTraceData, wpc--VelocityModeling (time-domain data) | WELL_LOG_CURVE, SEIS_WELL, SEIS_VELOCITY | LAS plus SEG-Y | L |
| **horizons** | The cube; horizons and faults saved in the browser as **bin indices** of this one sub-volume (`horizons.ts:22,34`, `faults.ts:19,24`). ◐ the user's own picks, but tied to FORGE's grid. | C15 C16 | none verified | wpc--SeismicHorizon, wpc--SeismicFault, wpc--FaultSystem, wpc--HorizonInterpretation, wpc--FaultInterpretation | SEIS_PICK, SEIS_INTERP_SURFACE | RESQML HorizonInterpretation + Grid2dRepresentation, FaultInterpretation + PolylineSetRepresentation | L |
| **volumetrics** | FORCE wells, logs and tops; picks; the Petrophysics interpretation (`Volumetrics.tsx:45-189`, `zone-model.ts:69-74`). ◐ picks, ranges, contact. Zones keyed by `"force-q*"` with Norwegian names (`:45-47`). | C1 C2 C3 C5 C6, contacts | Log, WellboreMarkerSet (contacts as markers) | wpc--WellLog, wpc--WellboreMarkerSet, master-data--Reservoir / ReservoirSegment | STRAT_WELL_SECTION, WELL_LOG_CURVE, WELL_PAYZONE | LAS | M |
| **logs** | FORGE open-hole and mud-log LAS, synthetic Equator logs, FORCE `.i16`, or **imported LAS** (`DataModules.tsx:56-97`, `logs.ts:38-126`). ✓ LAS in the browser, index in m or ft, read as MD. The FORGE sets apply only when `siteId === "forge"`. | C6 C5 C7 | Log, ChannelSet, Channel; WellboreGeology (mud log) | wpc--WellLog, with curves from Wellbore DDMS `/ddms/v3/welllogs/{id}/data` | WELL_LOG, WELL_LOG_CURVE, WELL_LOG_CURVE_VALUE | LAS 2/3, DLIS | S |
| **petro** | FORGE: open-hole LAS (`PetroCrystalline.tsx:34-40`). FORCE: `.i16` (`PetroForce.tsx:31`). Equator: synthetic (`PetroModule.tsx:39-49`). ◐ parameters only (FORCE). Imported LAS is not read. Crashes on a null `place.petro` (`PetroModule.tsx:42-44`). | C6 C5 C28 | Log, WellboreMarkerSet | wpc--WellLog, wpc--WellboreMarkerSet, wpc--RockSampleAnalysis (core plugs) | WELL_LOG_CURVE, STRAT_WELL_SECTION, WELL_CORE_ANALYSIS | LAS | M |
| **stimulation** | FORGE open-hole stresses and P32; `STAGES_2022` constant; QuakeML catalogue (`stimulation-model.ts:15-110`, `standard-files.ts:42`). ◐ catalogue only, for the session, and it must fall in FORGE's frame. | C6 C12 C18 C3 | StimJob, StimJobStage, StimPerforationCluster | wpc--StimulationJob, wpc--StimulationStage, master-data--PerforationInterval | WELL_TREATMENT, WELL_PERFORATION | **QuakeML** for events (no WITSML, OSDU or PPDM event object verified) | M |

### Drilling

| Tool | Today | Needs | WITSML 2.1 | OSDU | PPDM 3.9 | Other format | Effort |
|---|---|---|---|---|---|---|---|
| **geomech** | FORGE open-hole LAS (SV_G, SHMIN_G, PP_G, UCS, FANG, TSTR, PR, calipers); `forge-58-32-stress.json`; `forgeOperations` mud (`compute/geomech.ts:13-99`). ✗ RKB/KB constants, depth loop fixed at 6000–10940 ft (`:96`). | C6 C13 C12 C8 C11 C3 | Log (rock-mechanics channels), PPFGLog / PPFGChannelSet, FluidsReport, OpsReport | wpc--WellLog, wpc--PPFGDataset (Wellbore DDMS `/ppfgdataset`), master-data--FluidsReport; **no geomechanics-model WKS found** | WELL_LOG_CURVE, WELL_DRILL_MUD_WEIGHT | LAS | L |
| **window** | Design brief pressures (`EngineeringModules.tsx:119-203`, `well-design.ts:154-163`). ◐ planned wells only; SG axis clipped at 0.9–2.1 (`:131`). | C12 C26 C7 | PPFGLog, PPFGChannelSet, PPFGChannel | wpc--PPFGDataset, master-data--WellPlanningWellbore, master-data--CasingDesign | none verified | none | M |
| **drilling** | `forgeOperations`: 76 days, 54 runs, 3 sections (`DrillingModules.tsx:10`). ✗ there is no operations field in a recorded well (`records.ts:22-32`). The chart components themselves are generic. | C8 C9 C7 | OpsReport, DrillReport, BhaRun, WellboreGeometry | master-data--OperationsReport, wpc--WellOperationsReport, master-data--BHARun, master-data--HoleSection, master-data--WellActivity | WELL_DRILL_REPORT, WELL_DRILL_PERIOD, WELL_DRILL_ASSEMBLY, WELL_DRILL_BIT_INTERVAL, WELL_ACTIVITY | none | M |
| **rig** | A simulator driven by the design brief (`LiveDrilling.tsx:33-57`, `drilling-sim.ts:206-380`). ◐ designs; mud rheology, string and nozzles use defaults. | C26 C11 C9; live mode: real-time channels | live: Log channels over **ETP 1.2 ChannelSubscribe (21) / ChannelStreaming (1)** | n/a while it is a simulator | n/a | ETP 1.2 | M (L for live mode) |
| **torquedrag** | `forgeStringWeights` (hookload, torque, BHA by day), survey, shoe by regex `/9 5\/8/` (`TorqueDrag.tsx:29-61`, `compute/torque.ts:14`). ✗ for string weights. | C3 C7 C10 C9 C11 | Log (time or depth channels: hookload, torque), BhaRun, Tubular, OpsReport | wpc--WellLog or wpc--TimeSeries, master-data--BHARun, master-data--TubularAssembly | none verified for string weights | none | M |
| **hydraulics** | Design plus hydraulics inputs (450 gpm, nozzles 12/12/12/13) (`design.ts:19-37`, `EngineeringModules.tsx:308-366`). ◐ designs. | C7 C11 C9 C26 | BhaRun (nozzles), Tubular, FluidsReport | master-data--BHARun, master-data--FluidsReport | WELL_MUD_PROPERTY | none | S |
| **kick** | Design brief: shoes, fracture gradient, next hole, kick intensity (`well-design.ts:561,680-691`). ◐ designs. | C12 C14 C7 C26 | PPFGLog, WellboreGeometry | wpc--PPFGDataset, wpc--FormationIntegrityTest, master-data--HoleSection | none verified | none | S |
| **anticollision** | FORGE 16A plus 16B and 58-32 surveys, wellheads, **precomputed** covariances and hole radii (`anticollision.ts:237-299`). ✗ no error model runs in the browser. | C1 C3 (many wells) C4 C7 | Trajectory, ToolErrorModel, ErrorTerm, SurveyProgram | wpc--WellboreTrajectory; **no error-model WKS found** | WELL_DIR_SRVY_STATION | none | L |
| **plan** | `place.survey` from any site; shoes (`WellModules.tsx:135-138`). ✓ any well with stations. The FORGE `shoesOf` branch ignores casing edits (`place.ts:202`). | C3 C2 C7 | Trajectory | wpc--WellboreTrajectory (Wellbore DDMS `/wellboretrajectories/{id}/data`) | WELL_DIR_SRVY, WELL_DIR_SRVY_STATION | none | S |
| **profile** | As plan, plus formations (`WellModules.tsx:142-146`). ✓. | C3 C2 C5 C7 | Trajectory, WellboreMarkerSet | wpc--WellboreTrajectory, wpc--WellboreMarkerSet | WELL_DIR_SRVY_STATION, STRAT_WELL_SECTION | none | S |
| **designer** | Design briefs in the browser; Kestrel built in (`Designer.tsx:35-372`, `well-design.ts:230-254`). ✓ typed in, or JSON. | C26 (all of it) | none verified for plans | master-data--WellPlanningWell, master-data--WellPlanningWellbore, master-data--WellActivityProgram, master-data--CasingDesign, master-data--PlannedCementJob, wpc--PPFGDataset, wpc--PlannedLithology | none verified | none | M |

### Well engineering and production

| Tool | Today | Needs | WITSML 2.1 | OSDU | PPDM 3.9 | Other format | Effort |
|---|---|---|---|---|---|---|---|
| **construction** | `place.components` or the design analysis; FORGE as-of components follow the time cursor (`WellModules.tsx:29-42,97-118`). ✓ through the Well editor. | C7 C3 C5 | WellboreGeometry, Tubular, CementJob, WellboreCompletion | master-data--HoleSection, master-data--TubularAssembly, master-data--TubularComponent, wpc--CementJob, master-data--WellboreArchitecture | WELL_TUBULAR, WELL_EQUIPMENT, WELL_CEMENT | none | S |
| **section** | As construction, plus the FORGE mud-log LAS and operations (`WellModules.tsx:48-59`). ◐ imported LAS is not shown. | C7 C3 C5 C6 C8 | + Log, WellboreGeology, OpsReport | + wpc--WellLog, wpc--WellOperationsReport | + WELL_LOG_CURVE, WELL_DRILL_REPORT | LAS | S |
| **well3d** | `place.design`; for FORGE the PSDM cube and open-hole LAS wrap (`WellModules.tsx:62-86`). ◐ wells yes; seismic and log wrap FORGE only. | C3 C7 C2 (+C15 C6) | Trajectory, WellboreGeometry, Log | wpc--WellboreTrajectory, master-data--HoleSection, (wpc--SeismicTraceData, wpc--WellLog) | WELL_DIR_SRVY_STATION, WELL_TUBULAR | none | M |
| **cutaway** | The construction assembly (`WellModules.tsx:121-132`). ✓. | C7 | WellboreGeometry, Tubular | master-data--TubularComponent, master-data--HoleSection | WELL_TUBULAR, WELL_EQUIPMENT | none | S |
| **strings** | Recorded string: ratings parsed from a `material` string such as "L80 / 47 lb/ft / BTC" (`forge.ts:74-87`). Design: loads (`EngineeringModules.tsx:60-116`). ◐ only if the material string follows that convention. | C7 (grade, weight, connection as fields) C12 | Tubular | master-data--TubularComponent | WELL_TUBULAR | API 5CT tables (bundled) | S |
| **cement** | Design brief cement plans only (`EngineeringModules.tsx:259-302`). ◐ designs; a drilled well's Cement components are not read. | C7 C12 C26 | CementJob, CementJobEvaluation | wpc--CementJob, master-data--PlannedCementJob | WELL_CEMENT | none | M |
| **barriers** | Components; FORGE BOP test and mud from `forge-string-weights.json`; FORGE PP_G; design annuli plus Nodal's integrity status (`Barriers.tsx:20-116`). ◐ components only. | C7 C8 C11 C12 C23 C25 | Tubular, WellboreCompletion, OpsReport | master-data--WellBarrierElementTest, wpc--TimeSeries | WELL_EQUIPMENT, WELL_COMPLETION | none | M |
| **decline** | `sodir-field-production.json`: 136 fields, monthly volumes (`Decline.tsx:35`, `dca.ts:10-80`). ✗ no production import; saved analyses are rejected if the field is not in Sodir's table (`Decline.tsx:54`). | C19 | none (PRODML instead) | wpc--ProductionValues 2.0.0, served by the Production DDMS historian (pddms-timeseries) | PDEN, PDEN_VOL_SUMMARY; saved fits could live in PDEN_DECLINE_CASE / PDEN_DECLINE_SEGMENT | **PRODML** ProductVolume, AssetProductionVolumes, ReportingEntity | S |
| **nodal** | Design brief; tests, lab results and production entered by hand and saved per site; synthetic Kestrel tests; DTS and annulus LAS (`Nodal.tsx:39-74`, `nodal-model.ts:17-92`, `standard-files.ts:43-44`). ◐ tests and lab typed in; DTS and annulus files for the session only; no way to load monthly production. | C20 C21 C19 C22 C23 C24 C12 | none (PRODML instead) | wpc--FlowTest, wpc--WellPressureTestRawMeasurement / Interpretation, wpc--SamplesAnalysis (Rock & Fluid Sample DDMS), wpc--ProductionValues, wpc--TimeSeries | WELL_TEST, WELL_TEST_FLOW, WELL_TEST_PRESSURE, PDEN_VOL_SUMMARY | **PRODML** ProductionWellTests, FlowTestActivity, FluidAnalysis, FluidCharacterization, DtsMeasurement, TimeSeriesData; LAS | L |
| **editor** | Recorded wells and edits in the browser (`WellEditor.tsx`, `records.ts:22-142`). ✓ this is how data gets in today. | C1 C2 C3 C5 C6 C7 | Well, Wellbore, Trajectory, WellboreMarkerSet, Log, WellboreGeometry | master-data--Well, master-data--Wellbore, wpc--WellboreTrajectory, wpc--WellboreMarkerSet, wpc--WellLog, master-data--HoleSection | WELL, WELL_DIR_SRVY_STATION, STRAT_WELL_SECTION, WELL_TUBULAR | `.well.json` | S (open decision below) |
| **compare** | FORGE 16A plus five neighbours from bundled JSON; recorded wells; designs (`wells.ts:39-93`). ◐ Equator wells always listed as unavailable (`wells.ts:56`); FORCE wells not offered. | C1 C2 C3 C5 C7 (many wells) | Well, Wellbore, Trajectory, WellboreGeometry | master-data--Well, master-data--Wellbore, wpc--WellboreTrajectory, master-data--HoleSection | WELL, WELL_TUBULAR | none | S |

**Counts:**
- ✓ for every input: 8 tools (globe, logs, plan, profile, construction, cutaway, designer, editor).
- ◐ some inputs: 17 tools.
- ✗ wired to one site: 9 tools (seismic, attributes, curtain, tie, geomech, drilling, torquedrag, anticollision, decline).

---

## 3. The data contract: canonical objects the deck needs

These are the objects every tool would read through one data layer, whatever backend sits behind it. The deck already has the start of most of them in its own types; the third column names those.

| # | Object | Minimum fields | Deck type today | WITSML 2.1 | OSDU | PPDM 3.9 | Other |
|---|---|---|---|---|---|---|---|
| C1 | **Well** | id, name, field, operator, country, UWI, surface location (lat/lon, CRS), environment | `WellRecordValue.identity/location` (`records.ts:22`) | Well | master-data--Well 1.5.0 | WELL | none |
| C2 | **Wellbore and datum** | id, parent well, depth reference (RKB/DF/GL/MSL), elevation, water depth, ground elevation, TD | `datum` in `WellRecordValue`; `WellDesign.depthDatum` (`core index.ts:38`) | Wellbore (datum in Energistics Common) | master-data--Wellbore 1.5.1 | WELL | RESQML MdDatum |
| C3 | **Trajectory** | stations (MD, inc, azi; TVD/N/E derived), CRS, source, definitive or planned | `SurveyPoint` (`core index.ts:13`) | Trajectory | wpc--WellboreTrajectory 1.4.0 (Wellbore DDMS bulk) | WELL_DIR_SRVY, WELL_DIR_SRVY_STATION | RESQML WellboreTrajectoryRepresentation; CSV |
| C4 | **Survey uncertainty** | per station: error model, or covariance (NN…VV) | precomputed JSON only | ToolErrorModel, ErrorTerm, SurveyProgram | none verified | none verified | ISCWSA / OWSG models |
| C5 | **Markers / tops** | name, MD (and TVD/TVDSS), kind (formation, contact), source | `tops` (`records.ts`), `FormationLayer` | WellboreMarkerSet, WellboreMarker | wpc--WellboreMarkerSet 1.5.1 | STRAT_WELL_SECTION | none |
| C6 | **Log curves** | mnemonic, unit, index (MD or time) and its unit, values, null value, curve family | LAS via `parseLas`; `PetrophysicsLogCurve` | Log, ChannelSet, Channel | wpc--WellLog 1.5.0 (`/welllogs/{id}/data`) | WELL_LOG, WELL_LOG_CURVE, WELL_LOG_CURVE_VALUE | LAS 2/3, DLIS |
| C7 | **Construction** | per item: kind (casing, liner, tubing, hole, cement, packer, valve, wellhead), OD, ID, weight, grade, connection, top, base, TOC, parent | `WellComponent` (`core index.ts:104`) | WellboreGeometry, Tubular, CementJob, WellboreCompletion | master-data--HoleSection, TubularAssembly, TubularComponent, WellboreArchitecture; wpc--CementJob | WELL_TUBULAR, WELL_EQUIPMENT, WELL_CEMENT | none |
| C8 | **Daily operations** | date, depth MD/TVD, activities with codes and times, mud weight, milestones, BOP test date | `WellOperations` (`core records.ts:75`) | OpsReport, DrillReport | master-data--OperationsReport, wpc--WellOperationsReport, master-data--WellActivity | WELL_DRILL_REPORT, WELL_DRILL_PERIOD, WELL_ACTIVITY | none |
| C9 | **BHA runs** | id, hole section, top/base, components, bit, nozzles, outcome | `ServiceRun` | BhaRun | master-data--BHARun 2.1.0 | WELL_DRILL_ASSEMBLY, WELL_DRILL_BIT_INTERVAL | none |
| C10 | **Drilling parameters** | time or depth indexed: hookload (rotating, pick-up, slack-off), torque, WOB, RPM, flow, SPP, pit volume | `forgeStringWeights` days | Log / ChannelSet channels; live over ETP | wpc--WellLog or wpc--TimeSeries | none verified | WITS0 (legacy) |
| C11 | **Fluids** | mud type, density, PV, YP, by date or depth | `mudWeightPpg` on days | FluidsReport | master-data--FluidsReport, wpc--WellFluidsReport | WELL_MUD_SAMPLE, WELL_MUD_PROPERTY | none |
| C12 | **Pressures (PPFG)** | pore, fracture and overburden (and Shmin, SHmax) by TVD; source and uncertainty | `geology.pressures` (`well-design.ts:154`) | PPFGLog, PPFGChannelSet, PPFGChannel | wpc--PPFGDataset 1.2.0 (`/ppfgdataset`) | none verified | none |
| C13 | **Rock mechanics** | UCS, friction angle, tensile strength, Poisson's ratio, stresses as logs | LAS curves | Log channels | wpc--WellLog; no geomechanics-model WKS | WELL_LOG_CURVE | none |
| C14 | **Integrity tests** | kind (LOT/FIT), TVD, equivalent mud weight, leak-off reached | `integrityTests` in the brief | none verified | wpc--FormationIntegrityTest 1.2.0 | none verified | none |
| C15 | **Seismic** | trace data (bricked or streamed), bin grid (origin, azimuth, spacing), CRS, sample axis and its datum, amplitude scaling | `forgeSeismicSection` (`core seismic.ts:299-319`) | none | wpc--SeismicTraceData 1.8.0, wpc--SeismicBinGrid; Seismic DDMS | SEIS_3D, SEIS_SET, SEIS_BIN_GRID | SEG-Y, OpenVDS, OpenZGY; RESQML Seismic3dPostStackRepresentation |
| C16 | **Interpretations** | horizons as grids or surfaces, fault sticks or surfaces, **in world coordinates** | picks stored as **bin indices** (`horizons.ts:22`) | none | wpc--SeismicHorizon, SeismicFault, FaultSystem, HorizonInterpretation, FaultInterpretation | SEIS_PICK, SEIS_INTERP_SURFACE | RESQML HorizonInterpretation / FaultInterpretation + Grid2d / TriangulatedSet / PolylineSet |
| C17 | **Time–depth** | checkshots or velocity model (only when seismic is in time) | none (PSDM depth only) | none | wpc--VelocityModeling | SEIS_VELOCITY | RESQML LocalTime3dCrs |
| C18 | **Stimulation and events** | stages (top, base, rate, volume, times); microseismic events (time, location, depth, magnitude and type, uncertainties) | `STAGES_2022`; `QuakeEvent` (`core quakeml.ts`) | StimJob, StimJobStage, StimPerforationCluster | wpc--StimulationJob, wpc--StimulationStage; events: none verified | WELL_TREATMENT, WELL_PERFORATION | **QuakeML 1.2** |
| C19 | **Production volumes** | reporting entity (well or field), period, oil, gas, water, condensate, units | Sodir JSON (`dca.ts:10`), `ProductionMonth` | none | wpc--ProductionValues 2.0.0; Production DDMS | PDEN, PDEN_VOL_SUMMARY | **PRODML** ProductVolume, AssetProductionVolumes |
| C20 | **Well tests** | date, rates, water cut, GOR, WHP, gauge depth and pressure, reservoir pressure | `WellTest` (`core production.ts:471`) | none | wpc--FlowTest, wpc--WellPressureTestRawMeasurement / Interpretation | WELL_TEST, WELL_TEST_FLOW, WELL_TEST_PRESSURE | **PRODML** ProductionWellTests, FlowTestActivity |
| C21 | **PVT** | bubble point, Rsb, Bo, viscosity, API, gas SG | `LabPvt` (`core production.ts:496`) | none | wpc--SamplesAnalysis (Rock & Fluid Sample DDMS) | none verified | **PRODML** FluidAnalysis, FluidCharacterization |
| C22 | **Distributed temperature** | depth, temperature, time, plus rate, water cut and depth context | `surveyFromLas` (`synthetic.ts:60`) | none | none verified (WellLog or TimeSeries) | none verified | **PRODML** DtsMeasurement, DtsInstalledSystem; LAS |
| C23 | **Annulus pressures** | A/B/C pressure against time; bleed events | `AnnulusRecord` (`synthetic.ts:70`) | none | wpc--TimeSeries | none verified | PRODML TimeSeriesData; LAS |
| C24 | **Completion** | tubing, packer, SSSV, perforations, lift | `CompletionPlan` (`well-design.ts:217`) | WellCompletion, WellboreCompletion | master-data--PerforationJob, master-data--PerforationInterval | WELL_COMPLETION, WELL_PERFORATION, PROD_STRING | none |
| C25 | **Barrier tests** | element, test date, result | BOP date from string weights | none verified | master-data--WellBarrierElementTest 1.3.0 | none verified | none |
| C26 | **Well plan** | every field of `WellDesignBrief` | `WellDesignBrief` (`well-design.ts:230-254`) | none verified | WellPlanningWell, WellPlanningWellbore, WellActivityProgram, CasingDesign, PlannedCementJob, PPFGDataset, PlannedLithology | none verified | `subsurface-deck-design` JSON |
| C27 | **Lithology** | intervals with lithology class (from cuttings or interpreted) | FORCE lithology channel | WellboreGeology, CuttingsGeology, InterpretedGeology | wpc--PlannedLithology (plans only) | LITH_LOG, LITH_INTERVAL | none |
| C28 | **Core analysis** | depth, porosity, permeability, grain density | Equator core plugs | none | wpc--RockSampleAnalysis 1.3.1 | WELL_CORE_ANALYSIS | none |
| C29 | **Terrain and basemap** | elevation grid, imagery | FORGE `.i16` and `.jpg` | none | none | none | GeoTIFF / COG, map tiles |

---

## 4. Which adapters to build first

They are ranked by how many tools each one unlocks. One adapter here means one canonical object read from every backend: OSDU, WITSML/ETP, a PPDM-backed API, files, and the samples.

1. **Well, wellbore, datum, trajectory and markers (C1–C3, C5).** These feed nearly every tool: globe, site3d, plan, profile, section, well3d, construction, compare, correlate, volumetrics, anticollision (reference well), editor, and every well overlay on seismic. Effort is mostly S: `Place` already carries these. The work is to make site kind a property of the data instead of a string literal (`registry.ts:156,165`, `wire.ts:21`).
2. **Log curves (C6, with C13 as mnemonic families).** Feeds logs, petro (all three views), correlate, volumetrics, tie, geomech, stimulation, and section's mud log. Needs a **mnemonic and family map**: tools ask for "deep resistivity", not RDEP or RT90. Today FORCE is renamed by hand (`force.ts:80`) and every view names its own curves.
3. **Construction (C7).** Feeds construction, section, cutaway, well3d, strings, barriers, compare, and the torque & drag shoe. Grade, weight and connection should be separate fields, not parsed from a `material` string (`forge.ts:74-87`).
4. **Pressures (C12) and integrity tests (C14).** Feed window, kick, cement, rig, geomech and barriers. With these, the five design-only tools can also run on **drilled** wells; today they are gated to design sites (`registry.ts:128-136`).
5. **Operations, BHA runs, fluids and drilling parameters (C8–C11).** Feed drilling, torquedrag, geomech mud, the barriers BOP test, section, and hydraulics on drilled wells.
6. **Seismic and interpretations (C15, C16).** Feed seismic, attributes, curtain, horizons, tie, and the seismic in site3d and well3d. This is the biggest single job:
   - Seismic must be **streamed** (Seismic DDMS / OpenVDS bricks), not a whole cube in memory.
   - The bin grid must come from the data, not the 25 m / 5 m constants (`compute/attributes.ts:18`).
   - Picks must be stored in world coordinates, not bin indices (`horizons.ts:22`).
7. **Production, tests, PVT, DTS and annulus pressures (C19–C23).** Feed decline and nodal, plus the annuli in barriers. Decline is quick once C19 exists; nodal is the larger piece.
8. **Survey uncertainty and offset wells (C4 plus C3 for many wells).** Feed anticollision. This needs an error model computed in the browser (ISCWSA / OWSG), since a tenant serves surveys, not FORGE's precomputed covariances.
9. **Stimulation stages and microseismic events (C18).** Feed stimulation. QuakeML already parses (`core quakeml.ts`). Stages need StimJob or StimulationStage; the frame must come from the well, not EPSG:26912 plus a FORGE job start (`synthetic.ts:22,44`).

**What the standards leave open, so the contract must allow other formats:**
- No verified object in WITSML, OSDU or PPDM for microseismic event catalogues (QuakeML fills the gap).
- None for survey error covariances in OSDU or PPDM.
- None for PPFG in PPDM.
- None for distributed temperature in OSDU or PPDM.
- No geomechanics-model WKS in OSDU.

### Status

**The contract.** C1–C3 and C5 are in `@ikhmalputra/subsurface-core/data-contract`:
- well, wellbore and datum, trajectory, markers;
- checks at the boundary;
- a path from angles, positions or both;
- grid convergence;
- `loadWellCatalogue` over many sources.

**Every site is built through it.** One builder, `siteOfWells` in `@ikhmalputra/subsurface-react`, builds every site. What a sample adds goes on top as options:
- FORGE keeps its seismic frame: NAD83 / UTM 12N, origin at the section, depths below 16A's RKB.
- Equator keeps its picked surfaces.
- A design keeps its reservoir and its own datum.
- The samples' converters (`forgeBundles`, `equatorBundles`, `designBundle`) are in the React package; FORCE and entered wells convert in the deck.

**Runtime sources.** The deck reads `config.json` beside it when it starts (`apps/deck/public/config.json`; the default is `samples` and `browser`).
- `contract-json` reads a file of wells in the contract's JSON (`format: "subsurface-wells"`): the first way a tenant can connect without code.
- `osdu`, `witsml-etp` and `ppdm-api` are recognised. They are reported as having no adapter yet rather than guessed at.
- A tenant's field becomes a site with id `<source>:<field>`. Site in 3D, Plan view and Vertical section draw it; every other tool says it does not read backend wells yet.
- The **Data sources** tool shows each source, what it served, and what was left out and why.

**At scale.** Sources are read header-first and per field on demand, as `docs/STRESS_TEST.md` sets out. That design was stress-tested at 200,000 synthetic wells: the globe was ready in 1 s, the heap stayed under 350 MB, and the worst freeze was about 0.3 s. The old design froze for 5 s at 5,000 wells, and could not parse a tenant above about 17,000.

**CRS.** `@ikhmalputra/subsurface-core/gis` reprojects between 2,372 coordinate reference systems on the datums oil-and-gas records use (a table generated from the EPSG dataset by `tools/build-crs-defs.mjs`, loaded on demand with `ensureCrs`), plus any local CRS a tenant defines in `config.json` `crs.definitions`. Datum shifts are Helmert transformations and `datumShiftOf` says how good each is; grid convergence is found by projection, for any grid. Checked against IOGP Guidance Note 7-2 worked examples and against FORCE's published positions.

**Next:**
- the OSDU adapter: Search plus Wellbore DDMS for wells, wellbores, trajectories and marker sets;
- the logs object (C6), which lets Logs, Petrophysics and Correlation read a tenant's wells;
- `Place` for edits to a tenant's well;
- the site-kind literals left in `registry.ts`.

---

## 5. Decisions this raises

- **Do tools write back to the tenant?** The editor, designer, picks, saved decline fits and Petrophysics interpretations all save to the browser today. Since we are front end only, each must either:
  - write through the tenant's API (OSDU Storage, WITSML Store over ETP PutDataObjects, or the tenant's PPDM service), or
  - stay as a personal scratchpad that is clearly labelled as one.
- **Units and CRS.** The deck mostly works in metres with feet in some places. Tenant data arrives in many unit systems and CRSs. The adapters should convert to one internal system, keeping the source unit for display and provenance.
- **Provenance.** Every reading the deck shows names its source today. The contract must carry source and licence on each object: OSDU `ancestry` and `meta`, WITSML `Citation`, and the PPDM source columns.
- **Runtime configuration.** Endpoints, the identity provider, and which adapters are on must be read from a config file that the tenant's deployment serves, not from build-time constants (`DECK_BASE` is build-time today).

---

## 6. Problems found along the way

These are worth fixing whatever is decided about the contract:
- **barriers:** an Equator well with entered casing takes the "Kestrel A-7" branch and uses the active design's brief (`Barriers.tsx:58-67`). Annuli from the active design also show on recorded wells (`:71-72`).
- **petro:** `ClasticPetrophysics` crashes when `place.petro` is null (`PetroModule.tsx:42-44`).
- **compare:** Equator wells are always unavailable, even with entered casing (`wells.ts:56`). FORCE wells are never offered.
- **Casing edits:** `shoesOf` ignores casing edits on FORGE (`place.ts:202`). This affects plan, profile, logs and torquedrag.
- **Global state:**
  - The integrity status is a single global, not kept per well (`integrity-store.ts:19`).
  - The attribute cache is keyed only by `counts.length`, so a second cube of the same size would collide (`attribute-volumes.ts:38`).
- **Stale FORGE time state:** `installs` and the time cursor drive strings for any non-design well whenever a cursor is set (`StringModule.tsx:41-44`).
- **Unused validators:** the core already has `validateWellPath`, `validateWellDesign`, `validateWellOperations` and `validateProductionSurveillanceDocument` (`core contracts.ts:75`, `well-validation.ts:73,162`, `production-surveillance.ts:62`), but the deck never calls them. They are the natural check at each adapter's boundary.

---

## 7. Sources and what was not verified

**Sources for the standards' names**, all public and read online:
- **WITSML 2.0:** the Energistics schema overview, energistics.org/sites/default/files/witsml_schema_overview.html, and the docs.energistics.org WITSML topics, including the 1.4.1.1→2.0 changes.
- **WITSML 2.1, PRODML 2.2/2.3, RESQML 2.0.1/2.2 and the ETP 1.2 protocol IDs:** types generated from the official XSD and Avro files in the OSDU Reservoir DDMS repositories (open-etp-client, open-etp-server) on community.opengroup.org. Energistics publishes these versions as downloads only.
- **OSDU:** the `osdu/data/data-definitions` repository, E-R folder (master-data and work-product-component), and the Wellbore DDMS OpenAPI spec (v0.29, `/api/os-wellbore-ddms`).
- **PPDM 3.9:** table names from a public PostgreSQL port of the PPDM 3.9 DDL (github.com/rbhughes/pg_ppdm). PPDM's own definitions are members-only.

**Not verified:**
- WITSML 2.1 renames as stated by Energistics: inferred from comparing the schema lists.
- Whether WellboreMarkerSet first appeared in 2.0 or 2.1.
- ETP 1.2 protocol IDs against the Energistics specification.
- PRODML 2.0/2.1 names.
- Every PPDM table name, against a PPDM Association publication.
- The OSDU versions a given platform release actually serves.
- The REST routes of the Seismic and Production DDMSs.
