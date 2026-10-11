# Subsurface React

Composable React 19 capability components for rendering and inspecting well
design data. The SDK does not require a workspace shell, router, application
state manager, persistence layer, or 3D runtime. Import only the views your host
application needs and compose their controls and state in the host.

```tsx
import { CurvedSchematic } from '@ikhmalputra/subsurface-react/schematic';
import { getWellComponents } from '@ikhmalputra/subsurface-core';
import '@ikhmalputra/subsurface-react/styles.css';

const components = getWellComponents(design);

<CurvedSchematic
  design={design}
  components={components}
  selectedId={selectedId}
  onSelect={setSelectedId}
/>
```

Import only the entry point you need:

| Entry | Exports |
| --- | --- |
| `.` | `ComponentInventory`, `CurvedSchematic`, `InteractiveViewport` |
| `/schematic` | `CurvedSchematic` |
| `/viewport` | `InteractiveViewport` |
| `/assembly` | `AssemblySchematic`, `CurvedAssemblySchematic`, `ComponentPalette`, `AssemblyInspector`, `AssemblyIssueList` |
| `/assembly-three` | `AssemblyScene` (needs `three`) |
| `/trajectory` | `TrajectoryPlanView`, `TrajectorySectionView`, `TrajectoryLog`, `TrajectorySummaryPanel`, `SurveyTable`, `BuildHoldForm` |
| `/three` | `WellScene` (needs `three`) |
| `/gis` | `GisMap` (lazy MapLibre, same-origin resources only) |
| `/gis.css` | MapLibre engine stylesheet; import alongside `/styles.css` |
| `/2d` | 2D schematic, log, trajectory, seismic, multi-well correlation, well cross-section, linked map, linked dataset, and petrophysics views; no Three dependency |
| `/production` | `ProductionSurveillanceView` — unit-labelled time-series observations and linked dated events |
| `/3d` | `WellScene`, `AssemblyScene`, `OffshoreScene`, `loadBlenderHorizon` (needs `three`) |
| `/state` | `useSubsurfaceSelector`, compatible `useDepthLink` shared-store binding |
| `/well-design` | `WellIdentityForm`, `WellLocationForm`, `DatumDiagram`, `GeologyPressureEditor`, `PressureWindowPlot`, `CasingSchemeTable`, `CasingLoadCard`, `CementPlanTable`, `CompletionForm`, `WellProgrammeSummary`, `DesignReadinessPanel`, `DesignCoveragePanel`, `SourceSelect` |
| `/offset-wells` | `OffsetWellLibrary` — rank offsets, compare design with as-drilled record, adopt, save, import |
| `/records` | `HoleSectionLog`, `WellHistoryLog`, `DaysVsDepthChart`, `ServiceRunLog`, `LogTracks` |
| `/seismic` | `SeismicSection`, `SegyHeaderPanel` |
| `/examples` | `WellAssemblyBuilder`, `WellDesignWorkflow` (reference compositions) |
| `/styles.css` | scoped stylesheet |
| `/ui` | `CommandButton`, `CommandIcon`, `CommandIconName`, `CommandButtonProps` |

Well data and domain operations come from `@ikhmalputra/subsurface-core`; the
React SDK does not create or persist designs for the host.

### Drawing-first workbench

`WellAssemblyBuilder` supports `workbench` for a central drawing with a side dock.
It opens in **Curved** mode; **Schematic**, **3D view**, and **Formations** remain directly above the
canvas. Pass `formations` to enable the 2D geology-layer toggle. Layers use TVD
in the curved view and are converted to MD along the survey in the straight view.
The curved SVG fits the actual container while preserving equal departure/TVD
scales, so the directional trajectory is not stretched horizontally. Only tubular
widths are exaggerated for legibility. Zoom, pan, and Fit operate on that drawing.
The vertical engineering overview uses a linear MD axis and proportional casing
diameters (diameter and depth use different scales). Casing annotations show full
names, OD/ID, top and shoe depths, and cement TOC on the drawing.
The well centerline is centered in the drawing. Every downhole component uses
its actual top-to-bottom MD interval, with no minimum visible height. Accessories
retain component-specific cutaway symbols; invisible hit targets remain larger
for selection without changing the visible geometry. Use **Detail** for short
tools that are too small to inspect in the full-depth overview. Surface equipment uses
the supplied catalog renders rather than generic coloured blocks.
Select a component and choose **Detail** to inspect its depth neighbourhood;
**Fit whole well** returns to the overview. Surface equipment is schematic,
not a dimensioned mechanical assembly. Narrow canvases scroll horizontally to
preserve legible annotations rather than shrinking the whole drawing.
Annotations connect directly to component depths; there is no duplicated
component list within the canvas. Click a selected component or its annotation
again, click empty drawing space, or press Escape to clear selection.
The drawing scrolls vertically when annotations need more space.
Pass `survey` to follow the supplied directional trajectory. Without a
survey, the curved canvas explicitly shows a vertical well. Tubular widths are
exaggerated; intervals outside supplied survey coverage are not extrapolated.
If the survey does not overlap the assembly depth, the canvas reports missing
coverage rather than fabricating a path or accepting a depth-based drop.
Both 2D views share component selection, property edits, and undo history.

Hosts can pass a mounted `toolsContainer` DOM node to place the construction dock
beside their other tools, plus `onToolsRequested` to reveal it when a component is
selected. Keep the editor and dock node mounted while switching host tools.
`WellDesignWorkflow` uses this layout; design inputs still require an explicit
rebuild to replace the working assembly.
Its side dock keeps phase navigation outside the scrolling tool body. Supporting
charts scroll with the form rather than sticking over it; narrow docks stack
fields and retain keyboard-accessible horizontal scrolling for engineering tables.

## Shared interaction design

All modules use the same screen-only control contract. Commands use a
16px decorative icon and an explicit label; icon-only commands require an
accessible name. Tabs and record selectors use `kind="selection"` and retain
their data-led layouts instead of adding arbitrary command icons.

```tsx
import { CommandButton } from '@ikhmalputra/subsurface-react/ui';

<CommandButton icon="fit" onClick={fitDrawing}>Fit drawing</CommandButton>
<CommandButton icon="close" aria-label="Close inspector" onClick={closeInspector} />
```

The primitive forwards native button attributes, defaults to `type="button"`,
and preserves explicitly requested submit behavior. Use native `disabled`,
`aria-pressed` and `aria-expanded` for their respective interaction states.
Links remain links; use a decorative icon for action links without changing
navigation semantics.

The scoped stylesheet provides shared `--sw-*` colour, typography, spacing
(4/8/12/16/20/24px), 4px control and 8px panel-radius tokens. Set
`data-sw-theme="light"`, `"dark"` or `"high-contrast"` and
`data-sw-density="comfortable"` or `"compact"` on a containing element.
Comfortable controls are 44px high; compact controls are 34px, with 44px
targets on coarse pointers. Keyboard focus, hover, selected and disabled
states remain explicit. Module-local assembly and design tokens alias this
shared palette; host overrides must preserve contrast in each theme.

Control sizing is screen-only: scientific geometry, colour scales, hatches,
and paginated report/PDF layout are not restyled as UI controls. The demo's
route audit checks themes, control geometry, keyboard focus, accessibility
and phone overflow, with additional expanded design and well-view coverage.

## Offline GIS and linked 3D

```tsx
import { GisMap } from '@ikhmalputra/subsurface-react/gis';
import '@ikhmalputra/subsurface-react/styles.css';
import '@ikhmalputra/subsurface-react/gis.css';

<GisMap
  document={hostGisDocument}
  store={fieldStore}
  workerUrl="/gis/maplibre-gl-csp-worker.js"
  rasterTiles={['/tiles/{z}/{x}/{y}.png']}
  rasterAttribution="Host imagery attribution"
/>
```

Copy `maplibre-gl/dist/maplibre-gl-csp-worker.js` from the installed engine to
the same-origin worker URL. The component lazily loads the CSP-specific engine;
it does not require blob workers or `unsafe-eval`. The demo's asset-sync script
copies that worker automatically. MapLibre 5.10.0 and its vt-pbf 4.0.3 dependency
are pinned to retain strict NodeNext declaration compatibility.

Omit `rasterTiles` when no basemap is available: the view states that only supplied
layers are shown. Tile templates/worker/resources must use the host origin, and
raster attribution is required. Host CSP must allow `worker-src 'self'`,
`connect-src 'self'` and inline `data:` images for engine control icons/image-format
detection; no external tile service or coordinate disclosure is enabled implicitly.
Preserve dependency license notices when distributing the worker and browser code.

`trajectories3d` optionally embeds Three.js paths in the map's own WebGL canvas
(requires the optional `three` peer). Each entry supplies a well-local
`WellDesign` survey, positive `waterDepthM` and optional `{ mdM, label }` markers.
IDs, MD coverage and positions must match the geographic document. Altitude is
`-(waterDepthM + TVD)`; no vertical datum conversion is inferred. The custom
camera retains map pan/orbit/zoom and extends the surface-derived far plane for
submerged paths. Fit controls account for complete 3D bounds. DLS colouring uses
the same helper as Well View, with a 3 degree/30 m illustrative colour reference.
Clicking a 3D path pins continuous interpolated MD and draws a probe in that
same scene. `children` can supply a host inspector inside the map component;
no second renderer or canvas is created. Labels identify seabed wellheads.
Path widths and markers are exaggerated; geology is not generated.
When `design.components` is supplied, the map renders selectable casing/cement
cutaway shells, tubing and equipment meshes using source OD and MD intervals.
Construction diameter exaggeration (200/400/800 times) changes display radius,
not survey positions or source dimensions. Short tool bodies/wellhead spacing
are display-only. Mesh picking publishes component ID and nearby survey MD;
the register provides exact source intervals. Component focus isolates a well
and shows its parent string inside the same canvas. The camera target moves
to the component's negative altitude; Fit field restores all wells and a
sea-surface camera target.
Without explicit component records, no construction is generated.
The host Field project supplies 14 explicitly synthetic construction records
per well; these are neither equipment specifications nor verified barriers.
The embedded scene also renders an illustrative offshore environment from the
supplied wellhead water depths: sea surface/500 m grid, transparent water sides,
inverse-distance seabed and open subsurface cutaway sides. Exact anchor depths
are preserved. Sea, water, seabed and subsurface layers have independent controls;
full-field framing includes the environment. The environment renders first and
the well pass clears depth, deliberately exposing buried construction. This is
a cutaway presentation, not measured bathymetry, geological interpretation or
physically accurate water rendering. No environmental files/network resources
are loaded implicitly.
The map projection remains Mercator, not a globe or bathymetric model.

Without `trajectories3d`, map picks select the nearest **supplied** survey station and publish its exact MD
and projected source XYZ. The station controls provide a keyboard alternative.
The host owns 3D composition: rebase the same survey to local grid east/north/TVD,
pass pinned MD to `WellScene`, and route 3D probe MD through `selectGisStation`.
The demo uses that contract in an isolated, explicitly synthetic field store.
Map perspective alone is not subsurface 3D. Footprints/outlines are not elevated
meshes. No vertical-datum conversion or geodetic tie for the documented FORGE
well is inferred.

### Local layers, inspection and measurement

`GisMap` includes a local file workflow. Supply `gisState` and
`onGisStateChange` to own its `GisWorkspaceState` in the host (initialize with
`emptyGisWorkspace` from the core `/gis` entry point); otherwise state lives in
the map component. The demo keeps it across client navigation and resets on
reload. Files are read locally and never uploaded.

- GeoJSON: FeatureCollection, Feature or bare Point/MultiPoint/LineString/
  MultiLineString/Polygon/MultiPolygon. Properties, IDs and polygon holes are
  preserved. Explicit source CRS: EPSG:4326, EPSG:3857 or WGS84 UTM zones 1–60,
  north/south. The importer normalizes XY to WGS84. Limits: 10,000 features,
  200,000 vertices and 64 MiB per file.
- GeoTIFF: north-up, explicit matching EPSG geokey, up to 64 MiB / 100 million
  source pixels. RGB imagery uses three 0–255 bands; grayscale uses one band
  with min/max display contrast. Numeric depth/elevation uses one band, metre
  units and a stated vertical datum. NoData remains transparent. Palette,
  alpha, matrix-georeferenced/rotated grids, unsupported datums, GeometryCollection, null/Z
  geometries, legacy GeoJSON CRS and antimeridian imports fail explicitly.
- Raster rendering inverse-warps nearest samples onto a uniform Mercator grid
  with at most 512 pixels on the longest source dimension. Identification is
  nearest **display** pixel, not full-resolution source interrogation.
  Raster canvas sources need no blob/data URLs or external resource requests.
- A numeric grid may become the same-canvas 3D seabed after the user confirms
  sea-surface datum zero and metre units. Its mesh samples at most 96 rows and
  columns and omits NoData triangles. It replaces synthetic seabed/water/rock
  curtains; the illustrative sea plane remains available. Visibility/opacity
  follow the layer. Well water depths remain unchanged assumptions.
- Layer stack: fit, raise, colour, opacity, visibility and removal. Vector
  attributes can be inspected on-map or through the first 1,000 feature IDs
  in a keyboard list (map picking covers all). Raster inspection shows datum,
  mode and sample or NoData.
- Distance/area tools use map clicks or coordinate entry, finish, undo and
  clear. Results are WGS84 spherical horizontal metres / square metres,
  excluding depth—not ellipsoidal survey measurements. Measurement mode does
  not select well components.

Core `/gis` also exports `importGisGeoJson`, `importGisGeoTiff`,
`gisDistanceM` and `gisAreaM2` for host-controlled imports and measurements.
Shapefile, GeoPackage, measured well imports, durable storage and vertical
datum transforms are outside this workflow.

## Continuous offshore scene

`OffshoreScene` accepts a prepared GIS `model`, a projected metre `origin`,
per-well `waterDepthsM`, controlled `selectedWellId` and `onSelectWell`. All wells
must use the same projected CRS. Survey Z is TVD positive down from the seabed
wellhead; rendered elevation is `-(waterDepth + TVD)`, relative to sea surface.
Well XYZ is never rewritten. This component is a regional 3D view, not a globe.

Surface markers, wellheads and exaggerated trajectory tubes are selectable.
Selection flies the same camera below sea surface to frame the well; surface
overview, zoom, orbit and well buttons provide keyboard alternatives. Reduced
motion skips the flight animation. Water/seabed layers can be hidden. The
seabed is an illustrative inverse-distance interpolation of supplied wellhead
water depths, not imported bathymetry. Dashed surface ties are illustrative,
not reported risers; tubes are not casing/construction geometry. The host must
label synthetic data and supply its own measured geographic/bathymetric evidence
before treating the view as a real offshore survey.

```tsx
import { OffshoreScene } from '@ikhmalputra/subsurface-react/3d';
<OffshoreScene model={preparedField} origin={projectedOrigin}
  waterDepthsM={wellheadWaterDepths} selectedWellId={selectedWell}
  onSelectWell={setSelectedWell} />;
```

## Shared report component selection

`WellReportView` also supports optional controlled `selectedComponentId` and
`onSelectComponent` props for linking its component register and schematic to
a host workspace. Omitting them preserves its standalone selection behaviour.

## Production and surveillance

`ProductionSurveillanceDocument` combines a time-keyed `InteractionDataset`
(exact UTC Unix milliseconds and host-declared measurement units) with dated
events. Event measured depths are metres MD; event-to-component links are
optional host identifiers. The validator rejects non-time datasets, mismatched
well IDs, duplicate event IDs, invalid UTC milliseconds, and reversed event
intervals. Provenance is explicit (`documented`, `synthetic`, or
`user-authored`); absent values remain null or use the dataset's declared null
policy.

`ProductionSurveillanceView` reuses `LinkedDatasetView` for its chart/table and
publishes event well, time, component, and reported depth selection to the
shared store. A supplied assembly must belong to the same well and requires an
`assetBaseUrl`; its schematic receives the active measured-depth cursor.
Without an assembly, the view states that construction context was not
supplied. This module visualizes supplied records only; it does not infer
rates, fill gaps, or calculate production forecasts.

```tsx
import { validateProductionSurveillanceDocument } from '@ikhmalputra/subsurface-core/contracts';
import { ProductionSurveillanceView } from '@ikhmalputra/subsurface-react/production';

const record = validateProductionSurveillanceDocument(hostProductionAndEvents);
<ProductionSurveillanceView document={record} store={workspaceStore} assembly={wellAssembly} />;
```

## Multi-well correlation

The demo host now combines this component, `WellCrossSection`, `GisMap` and
`OffshoreScene` in one Field project. These remain independent SDK capabilities;
the host is responsible for consistent well IDs, source station arrays, marker
IDs, datum conversion and shared store ownership. Host R1 log windows are copies
of exact source MD/value pairs, not depth-resampled logs. The host quality screen
is a separate, explicitly synthetic cutoff calculation, not an SDK reservoir solver.
`MultiWellCorrelation.minWidth` optionally sets the minimum rendered chart width;
the default preserves the existing per-well width. The host uses 900 pixels to
fit four wells on desktop while retaining readable horizontal scrolling on phones.
`WellCrossSection` highlights the active well from a supplied shared store and
labels horizontal tick distances as well as depth.

`MultiWellCorrelation` consumes host-owned, validated `SubsurfaceWellLogCurve`
columns and explicit correlated tops. Every log declares a display domain,
unit and colour; values are clipped to that domain instead of auto-rescaled.
Setting `flattenOn` subtracts that top's MD for display only. The control offers
only top IDs present in all wells, and missing ties break linked top lines.
Source MD arrays are never changed. Dense curves use screen-bucket min/max
decimation, preserving visible extrema and null gaps.

Each log track includes its own labelled value axis and declared display
limits; the depth axis has eleven labelled ticks by default. Supplied tops show
their source MD in each well. Below the plot, a coverage table reports the
observed MD range, valid/total and null sample counts, observed value range,
mean, and count outside the declared display limits. A tie-audit table lists
each supplied top MD and its relative offset from the chosen flattening top;
missing ties are explicitly shown as not reported. These are data summaries,
not correlation scores or geological evidence. The demo's wells are synthetic
and must not be presented as field measurements.

```tsx
import { MultiWellCorrelation } from '@ikhmalputra/subsurface-react/2d';
import type { CorrelationWell } from '@ikhmalputra/subsurface-react/2d';

const wells: readonly CorrelationWell[] = [
  {
    id: 'well-a',
    label: 'Well A',
    provenance: 'documented',
    tracks: [{
      curve: validatedPorosityCurve,
      label: 'Porosity',
      color: '#147a65',
      domain: [0, 0.4],
    }],
    tops: [{ id: 'top-alpha', label: 'Top Alpha', mdM: 1820 }],
  },
  // Include at least one other well with the same explicit top ID.
];

<MultiWellCorrelation
  wells={wells}
  flattenOn="top-alpha"
  store={workspaceStore}
  onFlattenOnChange={setFlattenOn}
/>;
```

Top IDs are host-owned stable correlation identities, not lithology or
stratigraphic interpretations inferred by the SDK. When flattened, cursor
projection to another well uses only the declared matching top; without
flattening, a depth cursor remains limited to its selected well because equal MD
does not imply equal geological position. Pointer selection and arrow-key
depth movement publish through the optional instance-scoped store. Do not put
the underlying typed arrays in reactive state.

## Well cross-section

`WellCrossSection` projects validated columnar trajectory stations onto a
vertical curtain defined by the first and last wellhead locations. All wells
must declare the same units, CRS label and depth datum; the component does not
guess or apply a CRS/datum transform. Each path reports its maximum
perpendicular distance to the curtain, and paths beyond `maxOffsetM` are
dashed. Matching top IDs are connected only between adjacent wells where both
ties exist. This is a projected section, not an interpolated fence surface or
seismic interpretation engine.

```tsx
import { WellCrossSection } from '@ikhmalputra/subsurface-react/2d';

<WellCrossSection
  wells={validatedTrajectoriesAndCorrelatedTops}
  store={workspaceStore}
  maxOffsetM={250}
/>;
```

Selecting a path focuses its well through the optional shared store. Trajectory
coordinates remain in the supplied frame and source measured-depth columns are
not mutated. Synthetic inputs are labelled in the view and should not be
presented as measured data.

## Linked chart, table, and spatial samples

`LinkedDatasetView` consumes a validated `InteractionDataset` and a shared
store. Chart points, table rows, and the optional XY spatial view share stable
sample IDs. Hover publishes only the dataset/sample ID and highlights each
view. Selecting a sample also publishes its supplied XYZ (and focuses its
well when `wellId` is declared). Dragging the chart records stable brush
endpoints plus an MD or UTC time range; the table filters to that range.

The table virtualizes rendered rows, supports a text filter, sortable key/value
columns, arrow-key row navigation, explicit units, `"not reported"` null text,
and CSV copy/download for the filtered row set. Selection IDs are capped at
128 in the store; use brush ranges for larger selections. Chart line geometry
is min/max decimated by screen-space key buckets and retains null gaps. The
sample contract keeps typed columns outside state. The host owns all data and
must transform XYZ into its chosen shared frame before passing it to views;
the store does not infer coordinate transforms.

```tsx
import { LinkedDatasetView, SubsurfaceThemeProvider } from '@ikhmalputra/subsurface-react/2d';
import { validateInteractionDataset } from '@ikhmalputra/subsurface-core/contracts';

const dataset = validateInteractionDataset(hostColumnarObservations);
<SubsurfaceThemeProvider theme="dark" density="comfortable">
  <LinkedDatasetView dataset={dataset} store={workspaceStore} valueColumnId="porosity" />
</SubsurfaceThemeProvider>;
```

This is a focused linked spatial view, not a 3D renderer or a generalized
interpretation engine. `SubsurfaceThemeProvider` exposes `light`, `dark`, and
`high-contrast` themes plus `compact` and `comfortable` density modes through
CSS custom properties. The default is light/comfortable. `sampleColorMap`
and `ColorScaleLegend` provide explicit-domain Viridis/Cividis ramps; the
linked chart uses Cividis and renders its unit-bearing scale. `categoryColor`
provides the shared qualitative palette; pair colour with labels, marker shape,
or line style rather than treating colour as the only signal.

The linked chart has a generated sample/value summary, a table alternative, and
roving keyboard focus with arrow/Home/End navigation. Reduced-motion and
visible-focus styles are provided. The showcase exposes the shared theme and
density selectors on each route. Correlation, cross-section and map SVG
surfaces consume the same semantic foreground, grid, selection, depth-top,
well-path and outline tokens. Domain features retain distinct line styles and
fills as well as colors.

Browser axe tests exercise the linked-data and flagship routes in all three
themes. Correlation, cross-section and map views expose paged table
alternatives. Trajectory plan/section/log charts, daily depth progress, LAS log
tracks and SEG-Y sections also expose 50-row table pages with their supplied
values and units; each page is generated on demand, so opening a table does not
materialize every row in a large source dataset.

WebGL well and WebGPU volume canvases have keyboard camera controls and
announced camera state. The WebGL well scene also has a keyboard-operable
component list; seismic-section and depth-log cursors can be moved with arrow
keys and activated with Enter. Exact pixel-coordinate picking in GPU canvases
still has no keyboard equivalent, and no generated text description can
replace inspecting all rendered pixels. Many remaining view surfaces retain
hard-coded colors. Automated axe and keyboard tests cover the linked,
flagship, trajectory, log and seismic examples; they do not establish WCAG 2.2
AA conformance for the complete SDK or replace manual keyboard and
screen-reader testing.

Manual check for the current linked-data slice:

1. On `/linked-data/`, `/correlation/`, `/cross-section/`, and `/map/`, switch
   through all themes; verify focus indicators, selected/hover patterns,
   legends, and consistent chart/surface contrast. On `/linked-data/`, switch
   both density settings and check table sizing.
2. Keyboard-tab to the first plotted sample, navigate with arrows/Home/End,
   and press Enter; confirm the selected ID, table row, and spatial sample
   agree. Then use the table filter and arrow-key rows to inspect a sample.
3. With a screen reader, confirm chart summary, sample labels, live selection
   status, table units, and `"not reported"` values are announced.
4. Enable reduced motion in the OS/browser and confirm the linked view does not
   animate state changes.
5. On `/trajectory/`, Tab to the survey log, use Arrow keys/Home/End to move
   the cursor, and press Enter to select a station. Open the 3D component
   picker and select a component using only the keyboard; verify the record
   inspector follows selection.
6. On `/view-well/`, focus the seismic section and use Shift+Arrow keys to
   move the depth cursor, then Enter to select the corresponding component.
   Switch to the mud-log tab and use Arrow keys/Enter to inspect and select a
   depth without interacting with the canvas.

## Linked map hub

`MapHub` displays well trajectories and optional host-projected seismic or
surface outlines in one shared XY frame. Wells and outlines must declare
matching metre units, CRS and depth datum; the view does not reproject inputs.
`MapOutline.xy` is a flat interleaved XY array in map-frame metres. Closed
seismic footprints are filled; surface outlines remain linework unless their
`closed` flag is set.

Selecting a well path focuses that well and publishes the nearest supplied
trajectory station as an exact XYZ spatial pick through the optional
instance-scoped store. Keyboard selection chooses the middle supplied station.
Outlines are visual context only: they do not contain seismic samples or
surface elevation, and they do not generate picks. Host-supplied and synthetic
data remain host-owned. The current SVG path generation is synchronous and is
not yet decimated or benchmarked for industrial-size trajectories.

```tsx
import { MapHub } from '@ikhmalputra/subsurface-react/2d';

<MapHub
  wells={validatedWellTrajectories}
  outlines={hostProjectedSeismicAndSurfaceOutlines}
  store={workspaceStore}
/>;
```

## Petrophysics

`PetrophysicsLogView` consumes a validated `PetrophysicsWell` contract from
`@ikhmalputra/subsurface-core/contracts`. Track order, axis domains, units,
colors, optional fill direction and optional cutoff are explicit props; the
view does not infer track ranges or geological meaning. Host-supplied zones,
tops and core points are displayed as context. Log gaps remain gaps and are
not interpolated. The view exposes a keyboard depth cursor, select-depth
callback, vertical range brush, shared depth link props, value readout, and
an on-demand paged raw-sample table.

```tsx
import { validatePetrophysicsWell } from '@ikhmalputra/subsurface-core/contracts';
import { PetrophysicsLogView } from '@ikhmalputra/subsurface-react/2d';

const well = validatePetrophysicsWell(hostPetrophysicsColumns);
<PetrophysicsLogView
  well={well}
  tracks={[
    { curveId: 'gamma-ray', label: 'Gamma ray', color: '#247c59', min: 0, max: 150,
      cutoff: { id: 'gr-display-cutoff', value: 75, side: 'above',
        color: '#c44735', label: 'Display cutoff' } },
  ]}
  cursorMdM={depthLink.cursorMdM}
  onCursorMdChange={depthLink.setCursorMdM}
  depthRangeMdM={depthLink.window}
  onBrushChange={depthLink.setWindow}
/>;
```

The `/petrophysics/` showcase route uses explicitly labelled synthetic
Gamma-ray, neutron-porosity and density curves to demonstrate contracts,
null sentinels, zones/tops/core markers, linked depth cursor/range and table
alternatives. The `/2d` entry also exports `PetrophysicsCrossplot`,
`PetrophysicsHistogram`, `PetrophysicsZoneSummaryView`,
`PetrophysicsFlattenView`, `PetrophysicsTemplateSelect` and
`PetrophysicsCalculationReport`.

`PetrophysicsCrossplot` joins samples by exact MD key and exposes a table
alternative; brushing plotted samples updates the host's shared MD range. The
generic x/y component can render neutron-density, Archie-derived water
saturation versus porosity, or calculated Schlumberger M-N coordinates.
Core calculates Archie Sw and classic M-N coordinates from explicit,
unit-checked curves and caller-supplied parameters. The report displays the
equations, input curve IDs, units, parameters, per-sample quality and reasons.
The demo's input curves and outputs are synthetic, and the calculations are
transparent screening outputs rather than certified interpretation or
lithology/fluid classification. Keyboard users can focus a crossplot, browse exact
sample pairs with arrow/Home/End, and select the focused MD with Enter.
`PetrophysicsHistogram` omits unknown values and lets a user select a bin to
link the MD extent of its samples; selecting a bin with one sample pins that
MD instead of attempting an invalid zero-width range. Its SVG bin controls and
adjacent HTML buttons support keyboard activation. Both features
intentionally avoid hidden resampling. The zone summary shows its formula,
curve, unit, threshold side,
cutoff and maximum sample gap. Means exclude nulls; sampled gross thickness
counts only adjacent reported endpoints fully inside the zone and within the
configured gap; net thickness requires both endpoints to meet the cutoff.
Unknown or unsampled intervals are not extrapolated. These values are
descriptive calculations, not net-pay interpretation.

Core measurements are optional host-supplied values with stable IDs,
mnemonics, explicit units and null-as-unknown rendering. A track template is a
validated JSON display configuration; the React SDK does not persist it.
`PetrophysicsFlattenView` displays relative MD using an explicit matching top
ID in each well; the core helper rejects missing ties and retains source
columns unchanged. Demo examples are labelled synthetic and do not imply
measured geology. Buffers stay outside the shared interaction state.

## Well report view

The `/2d` entry exports `WellReportView`. It consumes a validated
`WellReportSpec` from core and renders the same declarative data as accessible
HTML tables, source captions, and the same paired 2.5D `AssemblySchematic` and
3D `AssemblyScene` used in Well View. Both are built from the supplied design
and component records, and clicks select the corresponding report component.
The trajectory section also provides linked SVG measured-depth/true-vertical-depth and local
Easting/Northing figures, gap-aware logs, assumptions, and explicit
not-checked disclosures. Trajectory coordinates remain in the declared input
frame; trajectory figures do not reproject the source coordinates. The 3D
assembly scene is lazy-loaded, keeping the 2D entry independent of the optional
Three.js peer; import failures are reported explicitly. Set
`assemblyAssetBaseUrl` to the host's published well-component assets path
(defaults to `/well-components`). Table, timeline and profile depth actions,
plus component selection in the 2.5D schematic, invoke `onSelectMd` in metres
so a host can publish picks through its existing instance-scoped depth link.

Reports may include optional, validated `highlights` with source/page evidence
and `drillingSections` with per-hole-section footage, run counts, problem-run
counts, average ROP and casing descriptions. The view presents them as a
brief and comparison table after the schematic; it does not reclassify source
outcomes. `executiveSummary` supplies a short narrative plus required source
evidence. Optional event `sourcePage` values retain page citations in the
milestone timeline. Hosts should label arithmetic derived from source records
and keep unresolved coverage or terminology limitations visible.

Optional `studies` add a source-cited register for pressure tests, drilling
step tests, logging and temperature acquisition, petrophysics, geomechanics,
and engineering or reservoir simulations. Each entry carries its category,
status (`reported`, `incomplete`, `not-reported`, or `not-computable`), method,
inputs, results, optional aligned result table, limitations, and source/page
evidence. Use `reported` only for values present in the cited source; use
`incomplete` where an operation was attempted but no complete interpretation
is available; distinguish absent results from analyses that cannot be run
because inputs are missing. These entries do not run a simulator or fill in
unobserved results.

The `Print / save as PDF` action calls the browser print dialog. Scoped
`@media print` rules hide interactive controls but preserve the report values
and lay the document out for A4 landscape with compact paired schematics,
print-width tables, repeating table headers and natural page breaks. HTML
text and tables remain document content and SVG figures remain vector; the
WebGL 3D view is printed by the browser as a canvas. When `schematicDesign` and
`schematicComponents` are supplied, the view includes the source-aligned
well-construction schematic and its component register. Optional source
appendices render as expandable full-record tables on screen and are expanded
by print styles and paginate as tables rather than being clipped to the screen
viewport. Very large sample buffers should remain in the dedicated log view
rather than being duplicated as HTML rows. This is not a PDF-generation
dependency or a report persistence layer. The `/well-report/` demo uses documented FORGE
records, labels absent operator/UWI/offset data as not reported, and exposes
LAS loading failures rather than substituting synthetic values. It places the
2.5D/3D schematic directly after the identity header, then gives a cited
overview, a survey-versus-drilled-TD exception, core footage arithmetic and
source-recorded casing/float events. Its study register includes reported
BOP/casing test pressures, two FIT EMW results, incomplete XLOT attempts,
WOB/ROP step-test values, temperature and logging acquisition records, and
explicit unavailability of missing simulation and evaluation outputs. It
does not infer a continuous pressure window or claim unavailable design or
reservoir simulation results. The report distinguishes 10,987 ft
reported drilled TD from 10,955 ft of observed survey coverage; it does not
label design depth as measured trajectory. Its construction register groups
drilled holes, installed casing, cement records and wellhead equipment
separately, with group-specific depth/diameter labels and explicit schematic
limitations. Selecting a record highlights it in both schematic views. Empty
offset, production-result and identification records are described as source
gaps, not as empty data tables without context. Detailed source registers remain
available below the readable report body.

## Shared state integration

Existing controlled props remain supported. For linked hosts, create one core
store per mounted workspace and pass it to every component binding. Do not
construct a store during every render or share one singleton between SSR
requests.

```tsx
import { useEffect, useState } from 'react';
import { createSubsurfaceStore } from '@ikhmalputra/subsurface-core/state';
import { syncStateToUrl } from '@ikhmalputra/subsurface-core/state-url';
import { useDepthLink, useSubsurfaceSelector } from '@ikhmalputra/subsurface-react/state';
import { AssemblySchematic, TrajectoryLog } from '@ikhmalputra/subsurface-react/2d';

const [store] = useState(() => {
  const store = createSubsurfaceStore();
  store.focusAsset('well-1');
  return store;
});
const selectedId = useSubsurfaceSelector(store, (state) => state.activeAsset.componentId);
const link = useDepthLink(true, store);
useEffect(() => syncStateToUrl(store, { onError: reportError }), [store]);

<AssemblySchematic assembly={assembly} selectedId={selectedId}
  onSelect={(id) => store.selectComponent(id, 'schematic')}
  depthWindow={link.linked ? link.window : undefined}
  onDepthWindowChange={link.linked ? link.setWindow : undefined}
  cursorDepthM={link.linked ? link.cursorMdM : null}
  onCursorDepthChange={link.linked ? link.setCursorMdM : undefined} />
<TrajectoryLog survey={survey} selectedMdM={link.pinnedMdM}
  onSelectMd={link.pinCursor}
  cursorMdM={link.linked ? link.cursorMdM : null}
  onCursorMdChange={link.linked ? link.setCursorMdM : undefined}
  mdWindow={link.linked ? link.window : null} />
```

`useSubsurfaceSelector` uses `useSyncExternalStore`; select immutable branches
or scalars, or supply a third-argument equality function for derived objects.
`useDepthLink()` without a store preserves the original standalone API and
rounded-metre cursor behavior. With a store, its initial-linked argument is
ignored in favour of store state; focus a well before publishing a non-null
MD. Rendering callbacks should apply state, not publish a different state
synchronously from a subscription.

The View well consumer demonstrates shared component selection, log/schematic/
seismic/3D depth synchronization, persistent pins, volume-cut positions,
camera control and versioned URL rehydration. These are opt-in SDK primitives,
not a required router or global workspace shell.

## Optional 3D capability

Three.js is an optional peer. Install `three@0.186.1` and import the viewer only
where it is needed:

```tsx
import WellScene from '@ikhmalputra/subsurface-react/three';

<WellScene design={design} selectedId={selectedId} onSelect={setSelectedId} />
```

The scene draws lit, cutaway casing strings with an exaggerated display radius,
a wellhead stack, and an optional formation diorama. The well path has a wide
invisible hit tube: hovering or clicking it probes measured depth, selects the
deepest string at that depth through `onSelect`, and reports the probe in
`<output data-testid="well-scene-readout">`. Depth labels are screen-space so
they stay readable at any zoom.

Optional trajectory props: `colorBy="dls"` with `dlsLimitDegPer30m` colours
the path by dogleg severity and shows a legend; `target` draws a target marker;
`probeMdM`/`onProbe` sync the probe with other views. A heading dial shows the
camera heading, and a plan shadow and plumb line tie the path to the ground.

### Well and seismic together in 3D

Pass `volume` (a regular int8 seismic cube on a grid aligned with an azimuth)
and optionally `sections` (vertical SEG-Y panels such as a single inline) to
build a 3D interpretation window around the well, in well-local metres
(east/north of the wellhead, TVD below the well reference). The cube is
uploaded once as a GPU 3D texture. `volumeView` sets the mode and the crop
without rebuilding the scene: `"solid"` draws an opaque block whose faces show
the data, so cropping `alongM`, `offsetM` or `tvdM` exposes inline, crossline
and depth-slice cuts anywhere in the cube; `"render"` raymarches the cube so
amplitudes below `threshold` are transparent and strong reflectors stay
opaque. The earth and seismic render first and the well renders on top, so
casing, DLS colouring, MD labels and formation tops stay visible. Hovering the
seismic reads along-line distance, offset, TVD, amplitude and the MD where the
well reaches that TVD; clicking pins that MD through `onProbe`.
`cursorMdM`/`onCursorMdChange` and `mdWindow` link the scene to
`useDepthLink`: the cursor is a ring on the well plus an outline around the
cube (or a line across each panel) at that TVD, and the window is a
highlighted well segment plus a band.

```tsx
const volume = useMemo(() => ({
  counts: new Int8Array(buffer),              // along fastest, then offset, then depth sample
  alongCount: 110, offsetCount: 61, sampleCount: 641, amplitudePerCount: 0.0158, azimuthDeg: 104.9,
  alongStartM: -762.5, alongEndM: 1987.5, offsetStartM: -762.5, offsetEndM: 762.5, topTvdM, baseTvdM,
}), [buffer]);
<WellScene design={design} selectedId={id} onSelect={setId} volume={volume}
  volumeView={{ mode: 'solid', offsetM: [-762.5, 0], tvdM: [0, 2800] }}
  colorBy="dls" probeMdM={link.pinnedMdM} onProbe={link.pinCursor}
  cursorMdM={link.cursorMdM} onCursorMdChange={link.setCursorMdM} mdWindow={link.window} />
```

Memoise `volume` and `sections`; the scene rebuilds when their identity
changes. `volumeView` is compared by value and applied in place.

`cameraView` accepts `{position,target,zoom}` using well-local
`[east,north,TVD]` metres; leave it null/undefined for automatic framing.
`onCameraViewChange` emits after orbit/zoom or Fit/Focus input, not when a
controlled view is applied, preventing camera feedback loops. Wire it to
`store.setViewState`; applying a changed camera does not rebuild scene assets.
`onSpatialPick` emits the CPU ray-intersection XYZ in the same local frame,
including a seismic surface below the well's TD. This default CPU mode is not
a promise of exact voxel sampling; opt into GPU picking as described below.

### Oblique slices, framebuffer picking and log cylinders

`WellScene` retains its existing props and WebGL renderer. New optional props:

```tsx
<WellScene
  design={design}
  volume={volume}
  slicePlane={state.interpretation?.slicePlane}
  onSlicePlaneChange={(plane) => store.setSlicePlane(plane, '3d-gizmo')}
  picking="gpu"
  onGpuPick={({ xyz, amplitude }) => {
    store.triggerSpatialPick(xyz, '3d');
    showAmplitude(amplitude);
  }}
  logCurve={porosity}
  logStyle={state.interpretation?.logStyle}
/>
```

The host still subscribes to the shared store and supplies controlled props.
The plane samples the existing 3D texture on its exact box intersection; rotate
it with `slicePlaneFromAngles`, or translate it along its normal using the
scene gizmo and `onSlicePlaneChange`. `null` restores the volume/axis-cut view.
This is an intersection slice, not arbitrary half-space removal of geology.
Origins/normals use local east/north/positive-down TVD metres, not Three's
scaled display coordinates. Cropping and seismic data/scene identity are
preserved while adjusting a slice.

`picking="cpu"` remains the default. GPU mode requires WebGL2
`EXT_color_buffer_float`; failures appear explicitly, without silently changing
modes. Surface XYZ/object ID and normalized seismic amplitude are rendered
into separate one-pixel float FBOs and read asynchronously. Values use the
uploaded texture's sampling, scaled back to physical amplitude; they are not
CPU-rounded voxel approximations. Picking identifies a surface or a visible
volume boundary, not an internal ray-marched reflector. XYZ is float32
precision in renderer coordinates; rebase large projected coordinates.
Pointer motion is coalesced, clicks take priority, hidden ancestors are
respected and disposal waits for pending readback.

`GpuFramebufferPicker`, `GpuPickTarget` and `GpuSurfacePick` are exported from
`/3d` for host-owned Three scenes. Inputs are drawing-buffer pixels from the
top-left; allow only one pending pick per instance. Volume bindings provide
`texture`, `worldToTexture`, `scale` and `offset`. The host owns source meshes
and textures; dispose the picker independently.

Log curves use the columnar contract. `curve.wellId` must match `design.id` and
`logStyle.curveId` must match `curve.id`. Modes are `color`, `radius` and
`color-radius`. MD-aligned rings follow the actual survey; missing samples
create gaps and values do not extrapolate. The tube replaces the thin survey
path only; radius multipliers exaggerate display geometry, never casing
dimensions. The demo's porosity is labelled synthetic, not measured FORGE data.

### Experimental native WebGPU seismic canvas

```tsx
import { WebGpuSeismicCanvas } from '@ikhmalputra/subsurface-react/webgpu';
import '@ikhmalputra/subsurface-react/styles.css';

<WebGpuSeismicCanvas
  cube={cube}
  store={store}
  amplitudeLimit={1}
  threshold={0.4}
  opacity={0.2}
  onError={reportError}
/>
```

The opt-in entry accepts the generic validated Float32/Uint8 voxel contract,
uses native WebGPU with WGSL generated by Three's node system, and uploads the
host's array without a CPU repack. GPU upload is still a copy. Float32 textures
use unfiltered loads, so `float32-filterable` is not required. Uint8 normalized
loads are converted to stored counts before applying amplitude scale/offset.
Texture axis limits are checked against the acquired device.

The canvas ray-marches 192 samples front-to-back, supports live opacity and
amplitude-threshold controls, and listens to shared camera, interpretation and
slice state. `seismicSlices` cuts the cube's upper physical X/Y/Z bounds through
`inline`/`crossline`/`time_depth`; oblique planes sample the remaining extent.
Camera/plane coordinates use the cube's XYZ/metre frame. Configure a camera
appropriate to its bounds before rendering; the store's default camera is a
placeholder. The `/sandbox/` demo supplies one and generates all data offline.

`WebGpuVolumeRenderer` and `WebGpuVolumeOptions` are also exported for native
hosts (`init`, `setSettings`, `dispose`). Mount its host element at a non-zero
size and always dispose on teardown. Unsupported browsers, shader validation
errors and device loss are reported through required `onError` and the React
error UI. There is no implicit WebGL fallback. This backend is experimental,
not WebGPU parity for well construction, Blender meshes or FBO picking; those
remain in the existing WebGL scene.

The native browser test runs with `WEBGPU_TEST=1`, using Chromium's SwiftShader
WebGPU/ANGLE path. It requires an adapter and checks rendered-pixel changes for
volume opacity and slice translation, regeneration and stop/restart cleanup.

### Blender geological surfaces

```ts
import { loadBlenderHorizon } from '@ikhmalputra/subsurface-react/3d';

const gltf = await loadBlenderHorizon({
  version: 1, id: 'horizon-1',
  reference: { units: 'm', crs: 'local: east/north', depthDatum: 'surface' },
  format: 'glb', source: localBlobUrl,
  // Example: glTF X -> east, Y -> depth, Z -> -north; select axes matching your own export.
  meshToWorld: [1,0,0,0, 0,0,1,0, 0,-1,0,0, 0,0,0,1],
  attributes: [{ semantic: '_POROSITY', layer: 'porosity',
    shaderInput: 'porosity', itemSize: 1, domain: [0,0.4] }],
});
scene.add(gltf.scene); // Assign a geological shader/material that consumes `attribute float porosity`.
```

The loader uses native Three GLTFLoader and supports `manager` and
`configureLoader` for URL resolution, resource paths and optional
DRACO/KTX2/meshopt decoders. No decoder dependency is installed automatically.
A `.glb` blob can be self-contained; `.gltf` may reference sibling buffers/
textures that must be supplied by the host's LoadingManager. The loader does
not upload files anywhere; remote `source` URLs and decoders can make
host-configured network requests.

glTFLoader exposes custom semantics as lowercase geometry names (e.g.
`_porosity`). Every mesh primitive must contain each declared, vertex-aligned
attribute with the declared item size. The loader validates all primitives,
aliases the original BufferAttribute to `shaderInput` without copying, rejects
collisions, then applies `meshToWorld` once. Failures propagate; post-load
validation failures dispose loaded resources. The host owns successful
scene/geometry/material/texture disposal and blob-URL revocation. Shader
materials and normalization by `domain` remain host-owned; metadata alone
cannot restore custom attributes lost during Blender export.

The existing well-scene uses scaled Three display coordinates, while this
loader produces contract-space metres. When adding its result to that
specialized scene, an explicit renderer-frame conversion is still required.
This loader is also usable directly in a host-owned Three canvas.

The viewer disposes its renderer, geometries, materials, and controls when
unmounted. Equipment meshes are display proxies along the survey, not complete
engineering CAD or certified models. Reported casing outside diameters are
shown; unknown IDs and wall thicknesses are not presented as fact.

## Trajectory views

```tsx
import { TrajectoryPlanView, TrajectorySectionView, TrajectoryLog, TrajectorySummaryPanel, SurveyTable, BuildHoldForm } from '@ikhmalputra/subsurface-react/trajectory';
import '@ikhmalputra/subsurface-react/styles.css';

<TrajectoryPlanView survey={survey} selectedMdM={md} onSelectMd={setMd} dlsLimitDegPer30m={3} />
<TrajectorySectionView survey={survey} verticalSectionAzimuthDeg={105} target={target} onTargetChange={setTarget} />
<SurveyTable survey={survey} onChange={setStations} /> {/* editable when onChange is given */}
```

Plain SVG and HTML, no extra dependencies. Each component is independent and
takes a `ComputedStation[]` from `@ikhmalputra/subsurface-core/trajectory`.
Plan and section views draw scaled grids, north arrows, DLS-coloured paths and
an optional target that can be dragged or moved with the arrow keys.

## Well design steps

```tsx
import { WellIdentityForm, WellLocationForm, DatumDiagram, GeologyPressureEditor, PressureWindowPlot, CasingSchemeTable, CasingLoadCard, CementPlanTable, CompletionForm, WellProgrammeSummary, DesignReadinessPanel } from '@ikhmalputra/subsurface-react/well-design';

<WellLocationForm brief={brief} onChange={setBrief} showDiagram={false} />
<DatumDiagram brief={brief} />
<GeologyPressureEditor brief={brief} onChange={setBrief} />
<PressureWindowPlot brief={brief} overlay="pressures" />
<PressureWindowPlot brief={brief} selectedSectionId={id} onSelectSection={setId} />
<CasingSchemeTable brief={brief} onChange={setBrief} selectedId={id} onSelect={setId} showLoadCard={false} onPropose={() => setBrief({ ...brief, sections: proposeCasingScheme(brief) })} />
<CasingLoadCard brief={brief} sectionId={id} />
<CementPlanTable brief={brief} onChange={setBrief} selectedId={id} onSelect={setId} />
<PressureWindowPlot brief={brief} overlay="cement" />
<WellProgrammeSummary brief={brief} selectedId={id} onSelect={setId} />
<DesignReadinessPanel brief={brief} onGoTo={setStage} showChecks={false} />
```

Each step is a controlled component over a `WellDesignBrief` from
`@ikhmalputra/subsurface-core/well-design`; use any subset in any order. The
pressure plot always shows pore, fracture, kick margin, mud window and
formations. Its `overlay` adds casing seats and mud weight steps
(`"programme"`, the default), the cement column's equivalent density at each
shoe against the fracture gradient (`"cement"`), or nothing (`"pressures"`).
The casing table shows API 5C3 safety factors per string. It also shows a load
card for the selected string, unless you place `CasingLoadCard` yourself.
`WellProgrammeSummary` is the one-page programme: hole sections, casing, mud,
TOC, slurry volumes, safety factors, completion and open checks.

```tsx
import { OffsetWellLibrary } from '@ikhmalputra/subsurface-react/offset-wells';
import { forgeOffsetWell } from '@ikhmalputra/subsurface-core/offset-wells';

<OffsetWellLibrary brief={brief} onChange={setBrief} offsets={[forgeOffsetWell, ...mine]} onOffsetsChange={setMine} />
<PressureWindowPlot brief={brief} offset={{ name: forgeOffsetWell.name, brief: forgeOffsetWell.brief }} />
<DesignCoveragePanel brief={brief} />
```

`OffsetWellLibrary` ranks offsets by likeness, shows each factor, the offset
design beside its as-drilled record and cited events, and adopts its geology,
casing or full design with a change log and a re-check. `WellDesignWorkflow`
includes it as the "Offset wells" step. Pass the host-owned `offsets` and
`onOffsetsChange` props to control saved/imported wells; the SDK does not read
or write browser storage.

```tsx
import { WellDesignWorkflow } from '@ikhmalputra/subsurface-react/examples';
import { forgeOffsetWell } from '@ikhmalputra/subsurface-core/offset-wells';

<WellDesignWorkflow
  assetBaseUrl="/well-components"
  offsets={[forgeOffsetWell, ...savedOffsets]}
  onOffsetsChange={saveOffsets}
/>
```

The host is responsible for validating imported or persisted values, choosing
where to store them, and reporting storage failures to the user. `saveOffsets`
should validate and persist the next list before updating the host's `savedOffsets`
state.

## Well file: history, runs and logs

```tsx
import { DaysVsDepthChart, HoleSectionLog, LogTracks, ServiceRunLog, WellHistoryLog } from '@ikhmalputra/subsurface-react/records';

<HoleSectionLog operations={ops} selectedComponentId={id} onSelectSection={(s) => setId(s.holeComponentId)} />
<DaysVsDepthChart operations={ops} onSelectDay={(day) => setCursor(day.mdFt)} />
<WellHistoryLog operations={ops} selectedRange={{ topFt, baseFt }} />
<ServiceRunLog operations={ops} selectedRange={{ topFt, baseFt }} />
<LogTracks las={parseLas(text)} tracks={[{ mnemonic: 'ROP', label: 'ROP', color: '#147a65' }]}
  markers={[{ depthFt: 1629, label: '13 3/8 in shoe' }]} onSelectDepth={setCursor} />
```

Each component takes a `selectedRange` (ft) and/or emits depths, so the host can
link them to `AssemblySchematic` selection. History search and filtering, run
filtering and the log cursor (arrow keys, Shift for a 10x step, Enter to select)
are built in.

## Seismic section (SEG-Y)

```tsx
import { SegyHeaderPanel, SeismicSection } from '@ikhmalputra/subsurface-react/seismic';

<SeismicSection file={parseSegy(buffer)} traceX={(t) => t.shotpoint} depthStep={5} depthLabel="m below datum"
  wellPath={projectOntoSection(stations, line)} intervals={[{ id, label, topMdM, baseMdM }]}
  markers={[{ mdM: 496.5, label: '13 3/8 in shoe' }]} selectedId={id} onSelectMd={(md) => select(md)} />
<SegyHeaderPanel file={file} traceIndex={52} />
```

Variable-density canvas image (grey or red–white–blue, gain slider, 99th
percentile clip) under an SVG overlay with axes, well path, intervals, markers
and a crosshair readout of trace headers and amplitude. Clicking the well path,
or arrow keys then Enter, reports the measured depth. `SegyHeaderPanel` lists
the textual, binary and one trace header. Ctrl/⌘ + wheel or +/− zooms, drag or
wheel pans, `0` fits; `wellPointAtMd` / `wellMdAtDepth` (core) map between MD
and section depth.

### Linking depth views

`SeismicSection`, `AssemblySchematic` and `LogTracks` each navigate on their own
by default. Give them a shared measured-depth window and cursor to drive them
together — zoom or hover one and the others follow through the well path:

```tsx
import { useDepthLink } from '@ikhmalputra/subsurface-react';

const link = useDepthLink();               // { linked, window, cursorMdM, pinnedMdM, … }
const on = link.linked;
<AssemblySchematic assembly={assembly} depthWindow={on ? link.window : undefined} onDepthWindowChange={on ? link.setWindow : undefined}
  cursorDepthM={on ? link.cursorMdM : null} onCursorDepthChange={on ? link.setCursorMdM : undefined} />
<SeismicSection file={file} wellPath={wellPath} mdWindow={on ? link.window : undefined} onMdWindowChange={on ? link.setWindow : undefined}
  cursorMdM={link.cursorMdM} onCursorMdChange={on ? link.setCursorMdM : undefined} onSelectMd={link.pinCursor} />
<LogTracks las={las} tracks={tracks} depthWindowFt={on ? (link.window && [link.window[0] / 0.3048, link.window[1] / 0.3048]) : undefined}
  onDepthWindowChange={on ? (ft) => link.setWindow(ft && [ft[0] * 0.3048, ft[1] * 0.3048]) : undefined} />
```

`TrajectoryLog` (survey log) and `WellScene` take the same `cursorMdM`,
`onCursorMdChange` and `mdWindow`, so the survey and the 3D well join the link.

Passing `undefined` for the window leaves a view uncontrolled, so unlinking is
just a flag. The hover cursor falls back to the pinned depth (`pinCursor`) when
the pointer leaves.

## Plug-and-play well assembly

The assembly capabilities let a host build or edit a well by dragging rendered
components onto a schematic or a 3D cutaway. The model, placement rules and
checks live in `@ikhmalputra/subsurface-core/assembly`; each React piece is
optional and stateless, so a host can use only the palette and schematic, only
the 3D view, or its own UI on top of the core functions.

```tsx
import { exampleAssembly, placeComponent, moveComponent, validateAssembly } from '@ikhmalputra/subsurface-core/assembly';
import { ComponentPalette, AssemblySchematic, AssemblyInspector, AssemblyIssueList } from '@ikhmalputra/subsurface-react/assembly';
import AssemblyScene from '@ikhmalputra/subsurface-react/assembly-three'; // optional, needs three

const [assembly, setAssembly] = useState(exampleAssembly());
const place = (catalogId, depthM) => setAssembly(placeComponent(assembly, catalogId, depthM).assembly);

<ComponentPalette assetBaseUrl="/well-components" onAdd={(id) => place(id, 500)} />
<AssemblySchematic assembly={assembly} assetBaseUrl="/well-components" issues={validateAssembly(assembly)}
  onDropComponent={place} onMoveComponent={(id, depthM) => setAssembly(moveComponent(assembly, id, depthM))} />
<AssemblyScene assembly={assembly} assetBaseUrl="/well-components" onDropComponent={place} />
```

- Placement snaps to a host: casing and tubing hang from the wellhead and the
  drop depth sets the shoe or tail; liners hang inside the innermost casing;
  cement fills the annulus from the drop depth to the shoe; completion tools
  ride on tubing; packers size to the casing ID. Impossible drops throw
  `AssemblyPlacementError` with a readable reason; soft engineering findings
  come from `validateAssembly`.
- Drag data uses the `application/x-well-component` MIME type
  (`WELL_COMPONENT_MIME`), so hosts can make their own drag sources.
- The schematic supports pointer drag of shoes and tools, arrow-key moves,
  Delete, and Ctrl/Cmd+wheel depth zoom. The 3D view supports orbit,
  zoom-to-cursor, click to select, dragging a selected part, and focus/fit.

### Selection, isolate and exploded views

Every schematic, scene and list marks the selected component in one vivid
selection colour and fades the rest, so the pick is unmistakable. Override it
on any ancestor:

```css
.my-host { --sw-select: #ff6a00; --sw-select-strong: #c2410c; /* fill behind white text (WCAG AA) */ }
```

- `AssemblySchematic` outlines the pick, shades its depth band, brackets it on
  the MD ruler and fills its label.
- `AssemblyScene` glows the pick, ghosts the rest, rings its top and bottom,
  and pins a name tag that stays inside the canvas. **Isolate** shows only the
  selected component and frames it.
- Both take `exploded`, `defaultExploded` and `onExplodedChange` (controlled or
  uncontrolled) and add an **Exploded** toolbar toggle. The schematic swaps to a
  card sheet of every rendered part, grouped by role with size and depth. The 3D
  view pulls strings, cement sheaths and tools apart into columns on a shared
  depth ladder.

### Rendered component assets

`assets/well-components/` ships a Cycles-rendered transparent PNG for every
catalog entry plus a GLB model for each point tool and surface item, with
SHA-256 hashes in `manifest.json`. Serve the folder from your static host and
pass its URL as `assetBaseUrl` (the package also exports it as
`@ikhmalputra/subsurface-react/assets/*`). Regenerate with
`pnpm render:catalog` (Blender 5.2; `-- <id> ...` renders a subset). The models
are original illustrative geometry with nominal sizes, not manufacturer CAD or a
design basis.

## Reference compositions

The plug-and-play builder (`WellAssemblyBuilder`) and the design flow (`WellDesignWorkflow`) are example
compositions, not required SDK surfaces. Import them explicitly from the
`/examples` entry point if a host wants to start from them. To show a recorded
well, compose the capabilities directly: `wellComponentsToAssembly` feeds
`AssemblySchematic`/`AssemblyScene`, and `CurvedSchematic` draws the same record
along its survey. `ComponentInventory` (main entry) lists every record with
search, type filter and paging, and follows a selection made in any view.

`WellDesignWorkflow` opens on the editable schematic generated by
`designToAssembly(brief)`. Define, Plan, Design and Review expose the identity,
location, offsets, geology, trajectory, casing, cement, completion and checks.
Component edits, selection and undo history survive phase navigation. Design
inputs and component edits are separate: changed inputs display a notice, and
**Rebuild schematic** applies the brief explicitly. Rebuilding asks for
confirmation if the assembly was edited, then replaces those edits and clears
undo history. New design and Example well also reset the drawing.

```tsx
import { WellDesignWorkflow } from '@ikhmalputra/subsurface-react/examples';

<WellDesignWorkflow assetBaseUrl="/well-components" onBriefChange={save} />
```

`WellAssemblyBuilder` places the component library, schematic and property
editor alongside each other on desktop. Click **Edit properties**, choose
**Component to edit**, or select a part in the drawing to change its label,
depths and diameters. **Apply changes** validates the edit and shows errors
inline. **3D view** opens an optional linked view. **Edit properties** returns
to the drawing-and-properties layout.
Undo/redo, well name, TD, blank/example and JSON export operate on the edited
assembly; `onChange` reports all assembly changes, including undo/redo and
resets. JSON export contains component edits; brief export does not. Hosts
remain responsible for persistence across reloads.
Use `embedded` when a host full-well editor owns identity, source restoration
and export. This removes the standalone name/TD, blank/example and assembly-only
export controls, while retaining the library, drawing, inspector and undo/redo.
The default standalone behavior is unchanged.
Pass `initialAssembly` to edit an existing assembly and `initialSelectedId`
to open its component properties immediately. Remount the composition when
switching to a different initial well.

For a host-owned editing session, supply `editorState` and
`onEditorStateChange` together. `WellAssemblyEditorState` contains `present`,
`past`, `future` and `selectedId`; the host retains this state across navigation.
Selection-only changes notify `onEditorStateChange`, but not `onChange`.
Undo/redo and assembly changes notify both. The controlled pair is required;
partial configuration throws an explicit error. Without either controlled prop,
the original local-state behavior remains unchanged. Undo/redo may retain a
removed component ID in history; the inspector displays no selection until that
component exists again.

```tsx
import { WellAssemblyBuilder } from '@ikhmalputra/subsurface-react/examples';

<WellAssemblyBuilder assetBaseUrl="/well-components" onChange={save} />;
```

CSS is scoped to SDK class names. The host can self-host IBM Plex Sans/Mono or
accept the font fallbacks. No package has been published.
