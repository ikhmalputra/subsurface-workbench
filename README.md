# Subsurface Workbench

Local MIT-licensed subsurface SDK by Ikhmal Putra Manan. The packages provide
well-domain operations and optional React capabilities; the Next.js site is a
reference demo showing how a host can compose them. It is not a product
application or backend. Original code is MIT; the FORGE data fixture retains
CC BY 4.0 attribution.

## Run

Use Node 24.21.0 and pnpm 12.9.1:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm exec playwright install chromium
pnpm test
pnpm test:render-adapters
pnpm test:asset
pnpm test:e2e
pnpm test:packages
node tools/serve.mjs
```

The static preview is http://127.0.0.1:3100. The local test server only serves
exported files; integrators can use their own static host and security headers.

## Scope

- Core package (`@ikhmalputra/subsurface-core`): well records and cited or
	labelled synthetic fixtures, minimum-curvature trajectory math, well-design
	calculations (casing scheme, API 5C3 ratings, cement), the assembly
	catalogue with placement rules, and operational records (daily history,
	service runs, hole sections, LAS 2.0 parser) and a SEG-Y parser.
- Parser-independent `/contracts` inputs define validated JSON spatial well
  paths with depth-mapped logs and seismic voxel headers with Float32Array or
  Uint8Array storage. JSON Schema exports and runtime cross-field validation
  are documented in [the core guide](packages/core/README.md#parser-independent-visual-contracts).
- React package (`@ikhmalputra/subsurface-react`): optional schematic,
	assembly, inventory, trajectory, well-design, records, seismic, viewport and lazy 3D
	capabilities. Hosts choose which pieces to render and own application state,
	navigation, persistence, and workflow.
- `apps/demo` is the private Next.js static showcase application, not a third
	SDK package or a backend. Its routes consume the two SDK packages and show
	one possible app composition. `/` is the capability index; each example page
	includes a "Usage and SDK details" snippet: `/view-well/` (a well section —
	the construction schematic, mud log and survey as tracks on one depth axis —
	with the 2.5D schematic, 3D cutaway and curved section as other views, plus a
	searchable record inventory, and a well file with hole sections, daily
	history, days vs depth, service runs, mud-log tracks and a SEG-Y seismic
	section along the well), `/edit-well/` (full-well revision editor),
	`/builder/` (schematic-first design workflow), `/trajectory/` (survey and
	plan tools) and `/sandbox/` (opt-in native WebGPU seismic test).
- Documented record: Utah FORGE 16A(78)-32 (pick it on `/view-well/`), 422
	observed survey stations and ten cited construction/installation records from
	GDR 1283 and 1296. Unknown dimensions remain null and are never invented.
- `/builder/`: schematic-first well design and plug-and-play assembly example.
	Opens directly on the editable well schematic; Define, Plan, Design and
	Review are available alongside it as workflow phases. Edit properties
	opens a component editor beside the drawing; edits and undo history survive
	phase navigation. Rebuilding from the brief explicitly replaces those edits.
- `/edit-well/`: edit the selected well's properties and datum, trajectory
  stations or build-and-hold plan, construction, individual component records,
  formation intervals and operational records. Applied changes become the active
  user-authored revision in View well, 3D, trajectory and report; the original
  source is never overwritten and can be explicitly restored. Survey edits use
  minimum curvature with the original first-station tie-in, retain unsurveyed TD
  and do not silently delete construction. Source geometry omitted by the assembly
  adapter (for example drilled holes) remains available in Component records.
  The editor uses a single command bar and shared selection tabs. Properties,
  component records and formations keep the active drawing beside the inspector;
  trajectory charts and 3D share one canvas row. Advanced registers are collapsed
  by default, with revision and storage information in the status bar.
  Daily reports, service runs, hole sections and milestones have selectable
  structured record forms with explicit units. Advanced JSON panels support
  additional records, citations, all record fields and complete revision import.
  Construction undo/redo is scoped to assembly changes; other applied edits
  regenerate that assembly history. Operational history retains reported values
  and is not recalculated from geometry; retained citations refer to the original
  source, not engineering verification of user edits.
  Export full well includes geometry, formations, operational records and the
  linked same-origin mud-log path. Revisions survive client navigation in memory,
  not reload; export is required for durable storage. Imported seismic voxel
  files remain source assets, not editable geometry. Editing a well does not run
  or certify engineering simulations; the active revision report does not reuse
  original-well simulation conclusions as results for modified geometry.
	Blender-rendered
	components are dragged onto a schematic or a 3D cutaway, snapped to a host
	and checked. The pieces are separate capabilities; the builder page is only
	a composition.
- Reference compositions under `/examples` are opt-in, not SDK requirements.
- `/edit-well/`: separate editor for the well selected on View well. The
  contextual Edit well action carries the well and selected rendered component
  into an editable schematic copy. Original records stay unchanged. Export
  JSON for durable storage; reloading restores the original record. The host
  retains each well's assembly draft, selection and undo/redo history across
  client navigation and well switches; it never replaces reported source data.
- Host persistence is explicit through the compositions' change callbacks
	(`onChange`, `onBriefChange`); the static demo has no product database.
- The demo host provides a schematic-first shared workspace with task navigation
  in four groups (Well, Design, Field, Analysis), with contextual views in a
  responsive sidebar and one shared well selector. Report is an output action,
  not a fifth workspace. Legacy route URLs remain supported. Route ownership
  and independent-example availability come from one host registry.
  Appearance and developer
  examples are secondary disclosures. View well opens on the well section —
  the schematic as a track beside the mud log and the survey on one depth axis,
  so a depth picked anywhere is drawn on all of them — without loading a 3D
  canvas; its View selector exposes cutaway, comparison, curved and subsurface
  projections. The well file docks under the canvas instead of below the fold. The inspector starts without an assumed
  component. Properties, the searchable component register and drawing evidence
  are inspector panels. The inspector can be hidden to reclaim drawing width;
  sourced component intervals can be focused, exact MD can be located numerically,
  and Escape clears component/pinned-depth selection outside input controls.
  Operations/logs/survey live
  in an explicit Well file drawer. Editing is a contextual action, not a duplicate
  navigation entry. These navigation changes retain the active well's canonical ID,
  component selection, pinned measured depth, theme and density during client
  navigation. The observed trajectory and FORGE report share inspection state.
  Changing wells clears incompatible selection, dataset, camera and
  interpretation state. This context is in memory, not saved project storage;
  View well continues to support explicit URL deep links.
- Analysis opens `/analysis/`, an active-well drilling study on the well section:
  the target and comparison intervals are drawn as zones across the construction,
  mud log and survey tracks as they are typed; the four steps (question and
  scopes, input QC, linked evidence, findings) sit beside the section, and the
  evidence — the interval's drilling log beside the run and daily-report
  registers — docks under it at step three. Both intervals require
  valid ROP observations in ft/h or m/h. Means are arithmetic sample means,
  not time-weighted speed or causal diagnoses. Missing/negative ROP is excluded
  with counts; zero is retained; intervals are top-inclusive/base-exclusive.
  Native source units and citations are retained, with explicit ft-to-m depth
  conversion. End-of-day MD links daily reports; it does not locate all activities.
  Log zoom/full-log controls change only the evidence preview; calculation scopes
  and attached sample eligibility remain tied to the selected study intervals.
  Operational evidence uses one compact Runs/Daily reports register with counts,
  expandable record details, source pages and explicit attach/detach controls.
  Narrow registers reflow into flat rows so record identity, depth, source page
  and attachment actions remain visible without horizontal scrolling. The bounded
  register supports keyboard scrolling and retains its column header.
  Studies save in localStorage with original evaluated means, source change
  detector, well revision and evidence IDs. Changed scopes or source revisions
  require renewed evidence review. Corrupt/blocked storage is reported and not
  overwritten. JSON export includes observations, findings, sources and assumptions.
  This is local study persistence, not project storage or engineering certification.
  Formation evaluation and production/injection studies are not implemented.
  The legacy `/petrophysics/` and `/production/` SDK compositions remain under
  Developer examples, explicitly separate from active-well studies.
- Field is one host-owned project, not three unrelated demos. The sidebar has
  one Field workspace entry; legacy `/map/`, `/correlation/` and `/cross-section/`
  URLs open its Locate wells, Compare intervals and Spatial section tools.
  All tools use the same four Equator wells, 301 source stations per well and
  Sand R1 markers. Included wells, active well/depth, log type, flattening,
  screening cutoffs and section endpoints persist during client navigation.
  This separate synthetic Field project never changes the documented source-well
  workspace. Reload resets in-memory settings.
- Locate wells defaults to a geographic MapLibre map with embedded underwater
  3D trajectories in the map's own canvas; an offshore overview is optional.
  Click a rendered well to inspect its location.
  Map station picks retain exact source MD; the 3D view flies to the selected
  well. No external coordinates or tile requests are enabled. Imagery is not
  bundled; same-origin raster basemaps remain an optional SDK capability.
  The unrelated local Map Hub and S-profile inspector host demos were removed;
  their public SDK components remain supported.
- The map's Three.js custom layer uses Well View's survey interpolation and DLS
  colours, not a separate 3D viewport. It supports orbit/zoom, path probing, an
  MD slider, numeric MD navigation and R1 marker picks. Full-field and selected
  trajectory framing account for the submerged paths, not only surface XY.
  The map and comparison tools share well/depth selection. Original MD and
  seabed-wellhead TVD are unchanged; rendered altitude is negative water depth
  minus TVD. The four Field wells now have explicitly assumed synthetic
  construction records: conductor, surface/intermediate/production casing,
  cement intervals, production tubing, safety valve, packer, gauge, R1
  perforations and subsea wellhead/tree. These are not installed equipment or
  verified barrier evidence. No measured seabed geometry is invented. Continuous MD
  picks place a 3D probe at the interpolated survey position; the station
  register separately labels its nearest source station. The 2D-only SDK map
  retains nearest-station markers.
- Construction cutaway is the default in-map display. Nested shells use the
  Well View cutaway helper; source OD/ID and MD intervals are available in the
  selectable register. Diameters are display-exaggerated by 200/400/800 times
  without stretching the survey. Short tool bodies and wellhead spacing are
  display-only. Click a mesh to select its component, or use the register;
  Inspect selected component isolates its well, dims enclosing shells and
  centers the equipment at its submerged elevation in the same map canvas.
  Equipment close-up shows its parent string for context and hides unrelated
  components. Fit field restores all wells and the sea-surface camera target.
  Turn off Construction cutaway to inspect the original DLS trajectory.
- The same map canvas includes sea surface and a 500 m reference grid,
  transparent water-column sides, an illustrative seabed interpolated from
  assumed wellhead water depths, and open below-seabed cutaway sides. All four
  environmental layers can be toggled independently. Fit field includes the
  environment bounds. Wells are drawn after an environmental depth clear so
  buried components remain inspectable: this is an intentional technical
  cutaway, not opaque terrain occlusion. Seabed values exactly match the
  supplied anchors; no measured bathymetry or interpreted geology is claimed.
- Offline GIS tools import local GeoJSON and north-up GeoTIFF files with an
  explicitly selected WGS84, Web Mercator or WGS84 UTM CRS. The layer stack
  supports visibility, opacity, vector colour, ordering, fit and removal.
  Map identification shows vector attributes or nearest display raster samples;
  coordinate entry and feature lists provide keyboard alternatives.
  Distance/area tools support map vertices, coordinate entry, finish, undo and
  clear, with labelled spherical horizontal measurements (not survey-certified).
  Layers and measurements survive Field client navigation, not a page reload.
- GeoTIFFs are inverse-warped onto a Mercator display grid (maximum 512 pixels
  per axis); NoData stays transparent. Numeric depth/elevation rasters require
  metre units and a stated vertical datum. After explicit confirmation that
  datum zero matches sea surface, a raster can replace the illustrative seabed
  and side curtains with a same-canvas 3D mesh (maximum 96 rows/columns).
  NoData triangles are omitted. Well water depths are **not** retied to the
  imported grid. This is a technical cutaway, not terrain occlusion.
  Files stay local; there is no implicit online basemap, file upload or terrain
  service. No measured files ship with the synthetic scenario.
- Compare intervals opens a focused R1 log window (top/base plus 100 m MD) and
  lets users switch gamma ray (API), effective porosity (v/v), or deep resistivity
  (ohm.m). These generated responses distinguish shale, reservoir quality and
  resistivity; they are not measured logs or proof of fluid content. The same
  interpreted top/base IDs drive correlation and section. Flattening aligns MD
  relative to a marker, not geological elevation. Full log coverage is optional.
- The R1 quality screen calculates gross vertical thickness, tested thickness,
  valid coverage, qualifying thickness and thickness-weighted porosity under
  editable GR/porosity/resistivity cutoffs. Each segment uses adjacent sample
  averages and is clipped to R1 top/base; a segment touching missing data is
  excluded, not counted as failed rock or filled. Equator C deliberately includes
  an acquisition gap. Default cutoffs are GR < 75 API, porosity >= 0.12 v/v and
  resistivity >= 5 ohm.m. This screen is not net pay, saturation, hydrocarbon
  volume, reserves, pressure or production analysis.
- Spatial section uses selected endpoint wellheads and the same source
  trajectories/markers, discloses horizontal distance, grid bearing and
  off-plane tolerance, and labels both distance and positive-down depth axes.
  Section Z is water depth + wellhead TVD, below a common synthetic sea surface;
  source MD/XYZ remain unchanged. Marker depths and gross vertical thickness
  are tabulated. Scales are independent: displayed angles are not true dip.
  Top ties are not interpolated geological surfaces.
- All geographic positions, seabed depths, trajectories, logs and markers in
  this project are explicitly synthetic/assumed. No measured FORGE geographic
  alignment, bathymetry, vertical-datum shift, full-Earth globe or measured construction
  schematic is implied. New-well designer/trajectory-planner session ownership,
  measured-well dataset imports, durable project persistence and richer Analysis datasets remain
  unfinished.
- The React capability API and optional reference compositions are documented
	in [the React package guide](packages/react/README.md).
- Blender component catalogue (`pnpm render:catalog`) shipped as hashed PNG/GLB
	assets.

## Modular SDK architecture

The existing pnpm workspace is retained; these are independent **entry points**,
not four renamed npm packages. Existing imports remain supported.

| Responsibility | Entry points |
| --- | --- |
| Framework-independent state / Event Bus | `@ikhmalputra/subsurface-core/state` |
| Browser deep links, hydration and history cleanup | `@ikhmalputra/subsurface-core/state-url` |
| Explicit geographic and local-frame conversions | `@ikhmalputra/subsurface-core/crs` |
| CRS-aware horizontal GIS layers and exact source-station selection | `@ikhmalputra/subsurface-core/gis` |
| Offline geographic map (lazy MapLibre) | `@ikhmalputra/subsurface-react/gis` |
| Strict JSON, typed-array and Blender contracts | `@ikhmalputra/subsurface-core/contracts` |
| 2D schematics, logs, trajectory plots and seismic sections | `@ikhmalputra/subsurface-react/2d` |
| Optional Three.js scenes and geological GLTF attribute loader | `@ikhmalputra/subsurface-react/3d` |
| React subscription and shared depth hooks | `@ikhmalputra/subsurface-react/state` |
| Seeded offline trajectories, porosity logs and seismic cubes | `@ikhmalputra/subsurface-core/sandbox` |

```text
pnpm-workspace.yaml
tsconfig.sdk.json                 shared strict ES2022/NodeNext configuration
packages/core/src/
  state.ts                        instance-scoped state + typed events
  state-url.ts                    opt-in browser/host URL binding
  crs.ts                          EPSG:4326/3857 and origin rebasing
  contracts.ts                    existing JSON contracts + additive exports
  columnar-contracts.ts            typed-array / geological mesh validators
  contract-schemas.ts             existing JSON Schema 2020-12 exports
  columnar-schemas.ts             new JSON transport schemas
  sandbox.ts                     bounded deterministic generators
packages/react/src/
  2d.ts                          non-Three facade over existing views
  3d.ts                          opt-in Three facade
  state.ts                       shared React state entry
  depth-link.ts                  compatible useDepthLink(true, store)
  blender-horizon.ts             GLTF loader with attribute aliases
apps/demo/                       static Next.js reference consumer
```

Both SDK packages use the shared TypeScript config, emit native ESM and `.d.ts`
files, and retain per-module output and explicit export maps. Core declares
`sideEffects: false`; React marks only CSS as side-effectful. React and Three
remain peers, and importing `/2d` or `/state` does not require Three. This
already supports consumer tree-shaking without adding a duplicate TSup/Vite
build pipeline or bundling host React/Three runtimes into the SDK.

View well now shares selection, hover/pinned MD, visible depth window, volume
cut positions, spatial ray picks and the well-scene camera through one store.
Selections and picked state are automatically encoded in `sw.*` URL parameters;
reloads restore them. Transient hover does not rewrite the URL. The host still
owns layout, styling, volume display mode, opacity and all asset/file I/O.
See the [core state guide](packages/core/README.md#reactive-state-and-deep-links)
and [React integration guide](packages/react/README.md#shared-state-integration).

## Architecture and AI review handoff

For an in-depth explanation of the models, workflows, state/deep links,
coordinate frames, rendering backends, verified scope and proposed improvement
roadmap, read [the AI review handoff](docs/AI_REVIEW_HANDOFF.md). It includes
source-file navigation and a copy-paste prompt for another reviewer.

## Checks

`pnpm test` (core unit tests), `pnpm test:asset` (asset hashes), `pnpm lint`,
`pnpm test:e2e` (Playwright and axe against the static export) and
`pnpm test:packages` (packs both packages and renders them in a clean consumer
without Next.js or three.js). `pnpm test:render-adapters` validates Blender loading, slice transforms and
log-cylinder geometry against built SDK output. CI runs all of them, plus
`WEBGPU_TEST=1 pnpm exec playwright test e2e/rendering.spec.ts --grep "native WebGPU"`
with a native software WebGPU adapter. That check requires an adapter and verifies
rendered-pixel changes, not just a supported API or a ready label.

## Limitations

Not engineering software. The FORGE record supplies casing OD/specifications and
shoe depths, not a full joint tally, wall IDs or manufacturer CAD; its strata are
conceptual. Synthetic wells, geology and equipment are illustrative. Display
diameters are exaggerated, and the Blender models are nominal geometry. Ratings
and checks are textbook calculations without professional approval. No package
has been published.

The WebGL well scene now supports arbitrary-angle GPU-textured intersection
planes, optional float-framebuffer surface/amplitude picking and log-driven
co-axial colour/display-radius styling. CPU ray picking remains the default.
Plane and log settings share the reactive store and deep links; the demo log is
explicitly synthetic, not measured FORGE porosity.

The separate, experimental `/webgpu` entry renders generic Float32/Uint8 cubes
as ray-marched volumes or oblique slices with native WebGPU. Try it at
`/sandbox/`; it never silently downgrades to WebGL. It is not full WebGPU parity
for well construction, Blender surfaces or GPU picking. The existing WebGL
well scene still uses its specialized int8 seismic protocol. Picking finds the
visible surface/boundary, not a buried reflector inside a ray-marched volume.
Fence diagrams and a drag/drop data workspace are not implemented. The Blender
loader maps attributes but does not choose geological shader materials.

Source values, units, report pages, hashes and rendering limits are recorded in
[the FORGE source record](docs/FORGE_SOURCE_RECORD.md).