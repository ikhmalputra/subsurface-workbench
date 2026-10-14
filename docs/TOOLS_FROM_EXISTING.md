# What was built, and the tool each piece becomes

Ikhmal, 12 Oct 2026: *do it all — but review what I had built first, and piece it up to become
tools.* This is that review: every component and calculation in the repository, read from the
exports, and the tool each one becomes on the one page. Nothing here is new capability; it is the
existing capability found, named, and placed.

The rule of placement, from the earlier studies: a thing with a depth axis is a **track on the
section**; a form that acts on the selection is **docked right**; a register or table is **docked
bottom**; a whole picture of its own (a map, a 3D scene, a report) is a **document** that fills the
sheet. Every tool reads the host's records through the workspace provider and the one store, and
says "not supplied" when they are not there.

## 1. The SDK's React components (`packages/react`)

| Component | What it is | Becomes | Placement |
| --- | --- | --- | --- |
| `AssemblySchematic` | the 2.5D construction schematic, framed as a track | **Well section** (construction track) · **Schematic** view | section |
| `CurvedAssemblySchematic`, `CurvedSchematic` | construction bent along the survey | **Curved** view of the section | document view |
| `AssemblyScene` | the 3D cutaway (GLB parts) | **3D cutaway** view | document view |
| `ExplodedParts` | the exploded component strip | part of the schematic view | section |
| `ComponentInventory` | searchable, paged component register | **Components** (inspector tab) | right |
| `AssemblyInspector`, `AssemblyIssueList` | properties editor and validation for the builder | **Component properties**, **Design checks** | right |
| `ComponentPalette` | the 55-part catalogue, drag to place | **Add parts** | right |
| `WellAssemblyBuilder` | the editor canvas + tools (palette, properties, checks) | **Edit well** document's canvas | document |
| `TrajectoryLog` | inc / azi / DLS vs MD, framed as a track | **Survey** track on the section | section |
| `TrajectoryPlanView`, `TrajectorySectionView` | plan view and vertical section with a draggable target | **Plan & section** view | document view |
| `TrajectorySummaryPanel` | TD, closure, KOP, max inclination, max DLS, verification | **Survey summary** | right |
| `SurveyTable` | editable station table with issues | **Station editor** | bottom |
| `BuildHoldForm` | build-and-hold planner inputs | **Trajectory planner** | right |
| `WellScene` | 3D well with formations, DLS colouring, seismic volume, probe | **3D well** view · **Seismic volume** | document view |
| `LogTracks` | LAS curves on tracks, framed as a track | **Mud log** track on the section · **Mud log** (well file) | section / bottom |
| `WellHistoryLog`, `DaysVsDepthChart` | daily reports with search, the time-depth curve | **Daily reports** · **Days vs depth** | bottom |
| `ServiceRunLog` | run register | **Runs and BHAs** | bottom |
| `HoleSectionLog` | hole sections strip | **Hole sections** | bottom |
| `SeismicSection`, `SegyHeaderPanel` | SEG-Y section with the well on it, header panel | **Seismic section** view · **Seismic** (well file) | document view / bottom |
| `WebGpuSeismicCanvas` | native WebGPU volume render | **WebGPU sandbox** | document |
| `GisMap`, `GisTools`, `MapHub`, `OffshoreScene` | the field map, GIS import, hub map, offshore 3D | **Field map** · **GIS import** | document / right |
| `MultiWellCorrelation`, `WellCrossSection` | wells on a datum; wells on a spatial line | **Correlation** · **Cross-section** | document |
| `OffsetWellLibrary` | offset wells, nine-factor match, adoption | **Offset wells** | right |
| `WellDesignWorkflow` | the ten-step brief with its own layout | split into the per-step tools below | — |
| `WellIdentityForm`, `WellLocationForm`, `DatumDiagram` | brief identity, location, datum | **Identity** · **Location & datum** | right |
| `GeologyPressureEditor`, `PressureWindowPlot` | pressures with provenance; the window plot | **Pressure window** (plot as a TVD track; editor right) | section / right |
| `CasingSchemeTable`, `CasingLoadCard` | casing scheme with API 5C3 loads | **Casing design** | right |
| `CementPlanTable` | cement plan | **Cement design** | right |
| `CompletionForm` | completion inputs | **Completion** | right |
| `WellProgrammeSummary`, `DesignReadinessPanel`, `DesignCoveragePanel`, `IssueList`, `SourceSelect` | review, readiness, coverage, issues | **Review** · **Design checks** | right |
| `PetrophysicsLogView` | log viewer with templates and zones | **Log viewer** | document / section |
| `PetrophysicsCrossplot`, `PetrophysicsHistogram`, `PetrophysicsZoneSummaryView`, `PetrophysicsCalculationReport`, `PetrophysicsFlattenView`, `PetrophysicsTemplateSelect` | analysis views | **Crossplot and histogram** · **Zonation** · **Net pay** · calculation report | right / bottom |
| `ProductionSurveillanceView` | rates, pressures, events over time | **Production history** | document |
| `LinkedDatasetView` | a dataset linked to the depth cursor | **Linked data** | bottom |
| `WellReportView` | the as-drilled report, sheet space | **Well report** | document |
| `AccessibleTable`, `InfoTip`, `ColorScaleLegend`, `SubsurfaceThemeProvider`, `InteractiveViewport`, `CommandButton` | primitives | used by every tool | — |

## 2. The core's calculations (`packages/core`)

| Function(s) | Becomes | Note |
| --- | --- | --- |
| `computeMinimumCurvature`, `validateSurveyStations`, `summarizeTrajectory`, `surveyConsistency`, `interpolateSurveyPoint`, `surveyPointAtMd`, `planBuildHold`, `designWithTrajectory` | Survey track, Station editor, Trajectory planner, Survey summary | already the engine of those tools |
| `placeComponent`, `moveComponent`, `updateComponent`, `removeComponent`, `validateAssembly`, `stringsAtDepth`, `assemblyToWellComponents`, `wellComponentsToAssembly` | Add parts, Component properties, Design checks | the builder's engine |
| `proposeCasingScheme`, `selectPipe`, `pipeRatings`, `regradeFailingStrings`, `analyzeSection`, `maximumSurfacePressure`, `kickToleranceVolume`, `sourServiceConditions`, `pressureAt`, `tvdAtMd`, `mdAtTvd`, `mudlineDepthM` | Casing design, Kick tolerance, Review | kick tolerance is a tool now; the rest live in the brief's steps |
| `compareWells`, `adoptOffsetDesign`, `offsetFromBrief`, `newWellBesideOffset` | Offset wells | |
| `daysVsDepth`, `sectionAtDepth`, `runsInInterval`, `intervalsOverlap`, `parseLas`, `lasCurve` | Days vs depth, Hole sections, Runs, Mud log, Drilling study | |
| `parseSegy`, `projectOntoSection`, `seismicImage`, `wellPointAtMd`, `wellMdAtDepth`, `tvdToSeismicDepth`, `seismicDepthToTvd`, `amplitudeClip`, `seismicColour` | Seismic section, Seismic volume | |
| `slicePlaneFromAngles`, `intersectSliceBox`, `curtainBetweenWells`, `sampleWellLog`, `validateSlicePlane`, `validateWellLogStyle` | Seismic volume slices, Horizon interpretation (partial) | |
| `calculateArchieWaterSaturation`, `calculateSchlumbergerMN`, `calculatedSeriesToCurve`, `schlumbergerMNToCurves`, `petrophysicsValueAt`, `pairPetrophysicsCurves`, `petrophysicsHistogram`, `summarizePetrophysicsZones`, `flattenPetrophysicsWells` | Water saturation, Porosity (M-N), Crossplot, Histogram, Zonation | the calculations exist; they run on a fixture, not the active well's LAS — the gap |
| `importGisGeoJson`, `importGisGeoTiff`, `gisDistanceM`, `gisAreaM2`, `reprojectGisXY`, `prepareGisDocument`, `selectGisStation`, `geographicToWebMercator`, `toLocalCoordinates` … | Field map, GIS import, Reference and datum | |
| `validateWellReportSpec` | Well report | |
| `toMetres`, `toFeet`, `toPascals`, `toSpecificGravity`, `toPoundsPerGallon` … | Units | |
| `stateToUrl`, `stateFromUrl`, `syncStateToUrl`, `createSubsurfaceStore` | the shared link every tool writes to | |
| `createMockSeismicCube`, `createMockTrajectory`, `createMockLogCurve` | the sandbox only — synthetic by declaration, never a well's data | |

## 3. The demo's workspaces, and what each is made of

| Workspace (lines) | Inside it | Becomes |
| --- | --- | --- |
| `view-well-demo` (379) | view presets, toolbar, inspector (Tools / Properties / Components / Evidence), depth command line, well file, scene options | the **section document** — already on the sheet; its inspector tabs and the well file's tabs are the targets the ribbon's icons open |
| `well-file` (138) | Daily history (days-vs-depth + history), Service & BHA runs, Mud log (7 curves), Directional survey, Seismic | one **Records** panel docked bottom with five tabs; **Daily reports**, **Runs**, **Days vs depth**, **Mud log**, **Seismic** open it on the right tab |
| `trajectory-demo` (245) | mode (survey / plan / edit), planner input, edited stations, preview section with markers, plan & section views, 3D, summary, course math, station table, explainer | the preview trajectory moves into the workspace as a **draft** the sheet's section draws; **Trajectory planner** (right), **Station editor** (bottom), **Survey summary** and **Course math** (right), **Plan & section** and **3D well** as views of the section; the separate document goes |
| `analysis-workspace` (248) | four steps, the section with interval bands, evidence log, operational registers, saved studies | the study's intervals stay bands on the sheet's section; **Study** steps docked right; **Evidence** docked bottom; the separate document goes |
| `edit-well-demo` (283) | Construction (builder), Well properties, Trajectory, Component records, Formations, Records & data; undo/redo; section view | **Well properties**, **Formations**, **Records & data**, **Component records** as right-docked tools over the sheet's section; the builder canvas as the **Edit** view of the section |
| `demo-well-builder` (58) + `WellDesignWorkflow` | ten steps in five phases around a curved canvas | the brief's canvas as a **Design** view of the section; each step a right-docked tool |
| `field-workspace` (101) + `field-trajectory-inspector` (69) | spatial / correlation / section tools, well register, inspector | **Field map**, **Correlation**, **Cross-section** documents; **Well register** and **Field trajectory** docked right |
| `well-report-demo` (840) | the report with its registers (casing, cement, completion, formations, logs, runs, daily, offsets, provenance, coverage) | **Well report** document, sheet space; its registers are the same records the bottom tools show |
| `petrophysics-demo` (163), `production-surveillance-demo` (67), `linked-data-demo` (58), `webgpu-sandbox` (50) | developer examples on fixtures | **Log viewer**, **Crossplot**, **Production history**, **Linked data**, **WebGPU sandbox** — keyed to the active well where its data allows, fixtures declared as such otherwise |
| `well-seismic` (107), `interpretation-controls` (48) | seismic section beside the schematic; volume slices | **Seismic section** view; **Volume & interpretation tools** (right) |
| `well-section` | the section itself: ruler, tracks, bands, zoom, toggles | the sheet |
| `drilling-tools` | kick tolerance, cement volumes, time breakdown, hydraulics | right-docked tools (built this week) |

## 4. The order of piecing

1. **Targets, not panels.** The ribbon's and palette's actions name the tab they mean, and the
   section document opens its inspector or its records on that tab. (Daily reports → records on
   Daily history; Components → inspector on Components.) Small, and it is what makes the icons
   honest.
2. **The trajectory draft.** The planner's and editor's preview trajectory becomes a draft held
   by the workspace provider per well, drawn by the sheet's section as a preview with its own
   badge until applied. Then the planner, the station editor, the summary and the course math
   are tools over the one section, and the survey document is deleted.
3. **The study.** Its steps and evidence become right and bottom tools over the section, whose
   bands they already drive; the study document is deleted.
4. **The editor.** Well properties, formations, records & data and component records become
   right tools; the builder canvas is the Edit view of the section; the editor document is deleted.
5. **The brief.** Each step a right tool; the brief's curved canvas a Design view; the brief
   document is deleted.
6. **The field.** Register and trajectory inspector as right tools over the field documents.
7. **Petrophysics on the well.** The calculations run on the active well's LAS when it has the
   curves, and the developer example stays a fixture only where the well has none.
8. **The report** stays a document — it is sheet space by design.

## 5. Where the piecing has reached

- **1. Targets** — done. Every ribbon and palette action carries `panel`, `tab` and `also`; the
  section document opens the inspector or the well file on the named tab.
- **2. The trajectory draft** — done. `lib/trajectory-draft.ts` holds the draft per well in the
  workspace provider; the section draws it as a preview behind a "Trajectory preview" banner;
  **Trajectory planner** (right), **Station editor** (bottom, read-only until "Edit these
  stations") and **Survey summary** (right, with the verification and course math) are tools
  over the one section. The survey document and `trajectory-demo.tsx` are gone; `?tool=trajectory`
  opens the section with the summary and stations.
- **The workspace bar** moved onto the ribbon's title row (navigation, tools, the well, Go to MD),
  so the sheet's band is one row of view tools while the ribbon is open; with the ribbon put away
  the bar floats as before. Go to MD is `DepthCommand`: it pins the depth on every linked view and
  selects the hole section it falls in, from the host's operations record.
- **3. The study** — done. `lib/study-draft.ts` holds the study per well (phase, question,
  intervals as typed, finding, evidence, saved basis); **Drilling study** (right, 380px) carries the
  four steps, save/export and the saved studies; **Study evidence** (bottom) carries the drilling
  log, its samples and the runs/daily registers for the interval under review, opened by step 2's
  "Review evidence". The sheet's section bands the draft's two intervals while the study tool is
  open. `?tool=study` opens the section with the study tool; `analysis-workspace.tsx` is gone.
- **4. The editor** — done. The builder draws in the sheet's **Edit** view (a view like Section or
  Curved) over the active revision; its parts, properties and undo portal into the **Construction**
  tool (right, with Export full well and Restore original). **Well properties**, **Component
  records**, **Formations** (ribbon: Formation tops) and **Records & data** (ribbon: Data sources)
  are right tools of their own; each edits the revision through `useRevisionEditor`. The trajectory
  tab is gone — the Station editor and the planner are the trajectory's tools. `?tool=edit-well`
  opens the Edit view with the Construction tool; `edit-well-demo.tsx` is gone. Applying a revision
  no longer clears the selection, the pinned depth or the depth window unless they no longer hold.
- **6. The field** — done. **Well register** (right: include/inspect per well, the field's three
  documents, the status line) and **Field trajectory** (right: the inspected well's position and
  the construction/MD inspector) are tools in `field-tools.tsx`; the map, correlation and
  cross-section documents keep only their plots and a one-line header. The map opens with both
  tools, the correlation and cross-section with the register only (their plots need the width).
- **7. Petrophysics on the well** — the module's availability note now reads the active well's
  own log and names which of GR, NPHI, RHOB, RT and DT it carries and which are not supplied
  (`WorkspaceRoute`); FORGE's mud log carries drilling curves only, so the synthetic example stays a
  fixture and nothing is substituted.
- **5. The brief** and **8. The report** — not started (the report stays a document by design).
