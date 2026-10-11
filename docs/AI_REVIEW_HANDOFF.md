# Subsurface Workbench: Architecture, Implementation and AI Review Handoff

Prepared: 8 October 2026.

Implementation update: 9 October 2026. Core now exports typed quantities and
an explicit affine coordinate-frame registry (`/units` and `/frames`). The
registry validates metadata, matrix shape/invertibility, direct and chained
paths, and inverse-transpose plane-normal transforms. It is not yet wired into
every React renderer or store operation; hosts must still transform values
into their declared common state frame before publishing picks.

Implementation update: 9 October 2026. The React `/2d` entry and demo now
include a contract-driven multi-well correlation view. It supports explicit
shared-top flattening, linked tops with visible unmatched-tie warnings,
screen-bucket min/max log decimation that preserves null gaps, per-curve
domains, provenance labels, and optional shared-store depth picking. This is
the first flagship cross-well view, not a completed cross-section/map suite.

Implementation update: 9 October 2026. The `/2d` entry and demo also include
a projected vertical well cross-section between the first and last wellheads.
It requires consistent declared CRS/unit/datum metadata, shows positive-down
depth, reports off-curtain offsets, links only explicit adjacent top ties, and
can focus a well through the shared store. It does not interpolate a fence or
render a seismic backdrop.

Implementation update: 9 October 2026. The `/2d` entry and demo now expose a
linked map hub for well paths and host-projected seismic/surface outlines.
Inputs must share the same declared metre-based reference. A well-path click
publishes the nearest original trajectory station as XYZ and focuses that well
through the instance-scoped store. The outlines are visual-only XY context,
not volume/surface data or pick sources; this is not a reprojection engine or
map tile viewer. SVG paths are currently generated synchronously without
decimation; large-trajectory performance remains unmeasured.

Implementation update: 9 October 2026. Core now exports a validated
`InteractionDataset` contract with stable sample IDs, explicit measured-depth
(metres), UTC epoch-millisecond, or sample-index keys, aligned typed columns,
null policies, and optional frame-declared XYZ. The shared state has bounded
selected IDs, one hovered ID, depth/time ranges and stable brush endpoints;
data buffers stay outside reactive state. The React `/2d` entry and
`/linked-data/` demo link a min/max-decimated chart, virtualized keyboard data
table and XY spatial sample view through that store, including range brushing,
CSV copy/download, and exact XYZ picks.

The host still owns coordinates and must transform them into a common frame
before publishing spatial picks; the new view/state contract does not wire
`CoordinateFrameRegistry` through all existing WebGL/WebGPU renderers. Dataset
interaction state is ephemeral and not included in the URL codec. The view's
keyboard table and sample controls have automated browser/axe coverage; this
does not establish complete WCAG 2.2 AA compliance for all canvases.

This document explains the current implementation, why it is structured this
way, what its terminology means, what has been exercised, and where another AI
or maintainer should investigate before enhancing it.

It describes the repository as inspected at the time of writing. It is not an
independent engineering certification, performance benchmark, security audit,
or assertion that every proposed improvement is a confirmed defect.

## 1. Executive summary

Subsurface Workbench is a local, MIT-licensed TypeScript SDK workspace for
displaying, inspecting, assembling and linking subsurface well information.
It also contains a statically exported reference website.

The most useful mental model is:

> A host application owns data, routing and persistence. The core SDK supplies
> domain operations, validated visualization contracts and shared interaction
> state. The React SDK supplies optional views. The demo shows those pieces
> working together.

It is not currently a hosted data platform, production interpretation system,
complete CAD application, OSDU connector, or certified well-design solver.

### 1.1 What is implemented

- Well construction records and explicitly labelled synthetic examples.
- A schematic-first builder with component placement, property editing,
  validation, undo/redo and JSON export.
- A separate editor for a working copy of an existing well.
- Minimum-curvature trajectory calculations and build-and-hold planning.
- Well-design input forms, pressure plots, casing/cement/completion operations,
  preliminary checks and offset-well comparison.
- Well operational history, service runs, LAS logs and SEG-Y sections.
- React SVG/HTML/Canvas views and optional Three.js WebGL scenes.
- One instance-scoped reactive state/event engine linking selection, depth,
  camera, spatial picks, seismic cuts, oblique planes and log styling.
- Versioned URL serialization, hydration and browser-history binding.
- Runtime-labelled length, pressure, density and duration quantities with
  explicit conversion helpers.
- An instance-scoped coordinate-frame registry for host-registered affine
  transforms and plane normals.
- Side-by-side multi-well log correlation with explicit marker flattening and
  linked, gap-aware tops.
- Projected well cross-sections with explicit frame checks and visible
  off-curtain offsets.
- A linked XY map hub with host-projected outlines and exact trajectory-station
  spatial picks.
- Generic linked interaction datasets with typed columns, stable row IDs,
  virtualized table, chart brush and same-frame spatial samples.
- Strict JSON and typed-array contracts with runtime validation and JSON Schema
  exports.
- A Blender GLTF/GLB loader that validates and aliases custom vertex attributes.
- Offline deterministic synthetic seismic, trajectory and porosity generators.
- WebGL oblique seismic intersection planes.
- Optional WebGL float-framebuffer picking of surface coordinates and texture
  amplitudes.
- Log-driven colour and display-radius mapping along the well trajectory.
- An experimental, separate native WebGPU seismic volume/slice renderer.
- Unit, rendering-adapter, browser, accessibility, asset and package-consumer
  verification tooling.

### 1.2 Important non-claims

Do not describe the implementation as:

- Four published `@subsurface/*` npm packages. There are two existing SDK
  packages with modular entry points.
- A Zustand implementation. The store is a small native TypeScript engine.
- A universal D3 renderer. Views use different SVG/HTML/Canvas/Three techniques;
  D3 scale helpers are a dependency.
- Completely parser-free. New contracts are parser-independent, but existing
  LAS and SEG-Y parsers remain available.
- End-to-end zero-copy. Validators can retain typed arrays; GPU upload still
  transfers data into device memory.
- Full WebGPU parity with the WebGL well scene.
- A completed drag/drop proprietary-data workspace.
- A completed fence-diagram or automated horizon/fault interpretation engine.
- An engineering-certified reproduction of a well.
- Proof of high performance on industrial-size datasets.
- An npm release. Both SDK manifests currently identify version `0.0.1`, and
  publication has not been established.

## 2. Product intent and the decisions that shaped it

### 2.1 Schematic-first, not form-first

The original builder was difficult to understand because the user encountered
workflow/form complexity before seeing the well.

The revised approach follows an AutoCAD-inspired interaction principle:

1. Show the drawing immediately.
2. Make selected objects visually obvious.
3. Put properties beside the drawing.
4. Let the user manipulate the model directly.
5. Keep supporting design inputs available without making them a mandatory
   prelude to understanding the drawing.
6. Make destructive regeneration explicit.

This is an interaction philosophy, not a claim of AutoCAD feature parity.
There is no general drafting kernel, arbitrary solid modelling system, DWG
support, or complete command-line CAD workflow.

### 2.2 View, edit and create are different tasks

- **View well:** inspect supplied records and linked subsurface views.
- **Edit well:** modify a separate schematic working copy.
- **Builder:** author or explore a design/assembly.

The editor must not silently mutate documented source records. Export is the
current way to keep the schematic copy beyond its in-memory session.

### 2.3 Preserve the existing SDK

The user explicitly chose to improve the existing packages through modular
entry points instead of renaming/splitting them into four new npm packages.

Core, 2D, 3D and sandbox are architectural responsibilities, not four independent
published artifacts. Existing imports and CPU-default behavior were retained.

### 2.4 Data fidelity matters more than a visually complete fiction

The FORGE fixture has documented evidence boundaries. Unknown inner diameters,
wall thicknesses, equipment details and formation properties are not supposed
to be invented to make a scene look more complete.

Synthetic examples are useful, but must remain distinguishable from measured
or reported data.

## 3. Repository and build architecture

### 3.1 Workspace structure

```text
subsurface-workbench/
  package.json
  pnpm-workspace.yaml
  pnpm-lock.yaml
  tsconfig.sdk.json
  playwright.config.ts
  eslint.config.mjs
  .github/workflows/ci.yml
  packages/
    core/
      package.json
      README.md
      src/
      dist/                       generated build output
    react/
      package.json
      README.md
      src/
      test/
      assets/well-components/
      dist/                       generated build output
  apps/demo/
    src/app/
    src/components/
    public/
    out/                          generated static website
  docs/
    FORGE_SOURCE_RECORD.md
    AI_REVIEW_HANDOFF.md
  tools/
    serve.mjs
    sync-assets.mjs
    verify-packages.mjs
    blender/
    survey/
  e2e/
    builder.spec.ts
    edit-well.spec.ts
    showcase.spec.ts
    state-link.spec.ts
    rendering.spec.ts
```

Some generated folders are ignored by Git. Inspect the checkout rather than
assuming generated output exists or is current.

### 3.1a What is `apps/`?

In this repository, `apps/` is where runnable applications built *using* the
SDK live. It is not another npm package and is not the core of the SDK.
Currently the only application is:

```text
apps/demo/
```

`apps/demo` is the Subsurface Workbench Showcase: a Next.js 16 React application
that imports the two workspace packages, composes their views into usable
screens, supplies demonstration data, and shows small code examples. Its
purpose is to:

1. Demonstrate how a host can combine SDK capabilities.
2. Provide an interactive place to verify the views and rendering features.
3. Make the package entry points understandable through page-level examples.
4. Exercise the packages together in a real routed React application.

It is not a third distributable SDK package. The `demo` package is private,
depends on the workspace packages, and is not intended to be installed by
SDK consumers.

The SDK should remain independently useful without this application. A
consumer can import `@ikhmalputra/subsurface-core` and selected
`@ikhmalputra/subsurface-react/*` entry points without adopting the showcase
routes, page layout or application state.

#### What specifically belongs to the demo application?

| Path | App responsibility |
| --- | --- |
| `apps/demo/src/app/` | Next.js App Router layouts and route pages |
| `apps/demo/src/components/showcase.tsx` | Shared navigation, explanatory page header and demo wrapper |
| `apps/demo/src/components/view-well-demo.tsx` | View-well route composition and host-owned state |
| `apps/demo/src/components/edit-well-demo.tsx` | Working-copy editor route composition |
| `apps/demo/src/components/trajectory-demo.tsx` | Interactive trajectory route composition |
| `apps/demo/src/components/webgpu-sandbox.tsx` | Offline synthetic native-renderer test interface |
| `apps/demo/src/components/well-file.tsx` | FORGE operational, LAS and seismic records UI |
| `apps/demo/src/components/well-seismic.tsx` | Demo asset loading and adaptation for the specialized scene |
| `apps/demo/src/components/wells.tsx` | Demo well list and source-record inspection card |
| `apps/demo/src/components/interpretation-controls.tsx` | Host UI for slice/picking/log-style state |
| `apps/demo/src/app/showcase.css` | Application visual system and page layouts |
| `apps/demo/public/` | Static data and public assets served by the demo |
| `apps/demo/out/` | Generated static site output, not source |

The app's host code decides which record is active, owns much of the toolbar and
layout state, loads public demo data, validates deep links against the demo
records and supplies callbacks to the SDK. The packages supply reusable
capabilities; the app demonstrates one possible composition.

#### Static application lifecycle

`apps/demo/next.config.ts` configures a static export with trailing-slash routes.
The npm `start` script uses `tools/serve.mjs` to serve the generated export; it
is a static-file server, not an application API/backend.

The `prebuild`/`predev` hook synchronizes component assets into the demo's
public area. The app imports SDK CSS and IBM Plex fonts in its root layout.
The 3D scene and WebGPU entries are loaded dynamically where possible to avoid
requiring them for every page's initial render.

For an SDK change, rebuilding the packages and then the demo matters: the
static route is a consumer of compiled package output and generated assets.

### 3.2 Package responsibilities

| Package/application | Responsibility | Should not own |
| --- | --- | --- |
| `@ikhmalputra/subsurface-core` | Domain types and operations, validators, state/event engine, URL utilities, CRS helpers, generators | React lifecycle, application routing, database storage, a GPU context |
| `@ikhmalputra/subsurface-react` | Composable controls and views, React store hooks, optional Three rendering and Blender loading | A mandatory application shell, authoritative asset storage, server API |
| `demo` | Reference composition, route choices, example data loading, shared-store wiring, interpretation controls | A requirement for using the SDK |

### 3.3 Dependency direction

```text
host application or demo
  |
  +--> React SDK views -----> core contracts/domain/state
  |
  +--> core utilities directly
  |
  +--> host-owned data, persistence, navigation and errors

optional Three.js peer
  +--> WebGL / GLTF / WebGPU capability entries
```

Core does not depend on React or Next.js. The React package depends on core.
The demo depends on both.

### 3.4 Toolchain

Manifest/configuration values at inspection:

| Item | Version/configuration |
| --- | --- |
| Declared Node | `24.21.0` |
| pnpm | `12.9.1` |
| TypeScript | `5.9.3` |
| React / React DOM | `19.3.0` |
| Next.js demo | `16.3.8` |
| Three.js | `0.186.1` |
| Playwright | `1.63.0` |
| Compiler target | ES2022 |
| Module/resolution | NodeNext |
| SDK output | Native ESM plus declarations |
| Demo output | Next static export, trailing-slash routes |

The last local verification used available Node `24.18.0`, not the declared
`24.21.0`. This is a reproducibility distinction: future validation should
prefer the declared versions.

### 3.5 Why there is no new Turborepo/TSup/Vite layer

The existing pnpm workspace was retained. Each SDK package compiles with `tsc`;
the demo builds with Next.js. There is no newly introduced Turborepo task graph,
TSup SDK bundler or Vite documentation application.

The shared compiler configuration enables:

- Strict checking.
- Declaration emission.
- `verbatimModuleSyntax`.
- `noUncheckedIndexedAccess`.
- Relative import extension rewriting.
- Native ESM-compatible output.

This preserves per-module output for consumer bundlers. Core declares
`sideEffects: false`; the React package marks CSS as side-effectful.

That supports tree-shaking, but does not prove that every import path produces
an optimal bundle. The core root also imports fixture JSON. Bundle analysis
should verify whether consumers inadvertently retain fixtures or unrelated
capabilities. Prefer narrow entries when possible.

### 3.6 Public entry points

Core:

| Entry | Main purpose |
| --- | --- |
| Root | Well record types/fixtures, adapters and re-exported capabilities |
| `/assembly` | Catalogue, placement, assembly operations and validation |
| `/trajectory` | Survey calculations and planning |
| `/well-design` | Design briefs, casing/cement/completion calculations |
| `/offset-wells` | Offset comparison and adoption |
| `/records` | Operations, history and LAS |
| `/seismic` | SEG-Y and section utilities |
| `/contracts` | JSON/columnar/voxel/Blender contracts and schemas |
| `/state` | Native reactive store and typed events |
| `/state-url` | Pure URL helpers and opt-in browser binding |
| `/crs` | Geographic/local-frame conversion helpers |
| `/sandbox` | Procedural synthetic data |

React:

| Entry | Main purpose |
| --- | --- |
| Root | Small general capability exports; inspect exact export list |
| `/schematic` | Curved schematic |
| `/viewport` | Interactive viewport |
| `/assembly` | Schematic, palette and inspectors |
| `/assembly-three` | Assembly 3D view |
| `/trajectory` | Plan/section/log/table/form views |
| `/well-design` | Controlled design input and analysis views |
| `/offset-wells` | Offset library UI |
| `/records` | History, runs and log-track views |
| `/seismic` | Section and header views |
| `/2d` | Non-Three facade |
| `/3d` | Well/assembly scenes, Blender loader, reusable GPU picker |
| `/three` | Existing specialized well scene entry |
| `/state` | Shared React hooks |
| `/webgpu` | Experimental native seismic backend |
| `/examples` | Opt-in builder and workflow compositions |
| `/styles.css` | Scoped stylesheet |
| `/assets/*` | Shipped catalogue assets |

The facades do not create new npm packages. The `/3d` entry needs Three;
`/2d` and `/state` are intended to work without Three.

## 4. Domain terminology and separate models

These models are related but are not interchangeable.

### 4.1 Glossary

| Term | Meaning here |
| --- | --- |
| Wellbore | The drilled path through the subsurface |
| Trajectory/survey | Stations describing MD, position, inclination and azimuth |
| MD | Measured depth along the well path |
| TVD | True vertical depth below the declared depth reference |
| TD | Total depth; always inspect whether a field is MD or TVD |
| RKB | Rotary kelly bushing depth reference |
| GL / MSL | Ground level / mean sea level references |
| OD / ID | Outside / inside diameter |
| Casing | Structural tubular string lining a drilled interval |
| Tubing | Inner production/injection tubular string |
| Annulus | Space between tubulars or between a tubular and the hole |
| Cement TOC | Top of cement |
| DLS | Dogleg severity; curvature measure, not inclination alone |
| Log curve | A measured or synthetic scalar column indexed by depth |
| Seismic amplitude | A stored/derived signal sample, not automatically a rock property |
| Voxel | One sample in a 3D regular grid |
| Inline/crossline | Survey-oriented directions; semantics depend on the dataset/frame |
| Horizon | Geological surface |
| Fault | Discontinuity surface; not automatically detected by rendering |
| GLTF / GLB | JSON-based scene format / binary scene container |
| FBO | Framebuffer object used to render off-screen GPU results |
| CRS | Coordinate reference system |
| Datum | The reference from which coordinates/depths are defined |

MD is not normally equal to TVD. A depth cursor in one view must be mapped
through the correct trajectory before becoming a spatial marker elsewhere.
Depth-migrated seismic and time-domain seismic are not interchangeable without
an explicit conversion model.

### 4.2 `WellDesign`: displayable construction record

Defined in [core index](../packages/core/src/index.ts).

It contains:

- Identity and revision.
- Total depth and metre units.
- Provenance: synthetic, documented or user-authored.
- Optional observed/planned survey information.
- Depth-datum/reference elevation metadata.
- Formation context.
- Construction components.
- Coverage/source/attribution fields.

`WellComponent` records include labels, kind, material, OD/ID, top/bottom
depths, optional parent and source references.

Nullable physical dimensions are meaningful. `null` must not be converted to a
plausible-looking diameter just to render a closed tube.

`getWellComponents` adapts the design into component records. Synthetic designs
can include illustrative joint-level detail. A documented design should not
receive fabricated installed components when those records are missing.

### 4.3 `WellDesignBrief`: planning inputs

Defined in [well-design operations](../packages/core/src/well-design.ts).

This is a planning model, containing:

- Identity: name, field, operator, country, purpose.
- Location/environment/CRS information.
- Datum information.
- Geology, pressure and temperature assumptions.
- Optional fluids and design basis.
- Optional offset origin/adoption metadata.
- Planned directional trajectory.
- Total MD.
- Casing sections, mud weights and cement plans.
- Completion plan.

Its casing section model uses MD intervals and nominal pipe selection
properties. Its functions produce preliminary analysis/readiness information.
It is not equivalent to a measured as-drilled construction record.

### 4.4 `WellAssembly`: editable schematic assembly

Defined in [assembly operations](../packages/core/src/assembly.ts).

```ts
interface WellAssembly {
  readonly id: string;
  readonly name: string;
  readonly totalDepthM: number;
  readonly revision: number;
  readonly items: readonly AssemblyItem[];
}
```

An item references a catalogue entry and includes:

- Instance ID and label.
- Top/bottom MD in metres.
- OD/ID in inches; ID can be null.
- Optional host string ID.

The catalogue defines categories, slots, dependencies, exclusivity, attachment
rules and nominal assets.

Placement/update/remove operations maintain a new assembly value rather than
requiring views to directly mutate the item list.

Examples of implemented operations include:

- `placeComponent`.
- `moveComponent`.
- `updateComponent`.
- `removeComponent`.
- `setAssemblyTotalDepth`.
- `validateAssembly`.
- `wellComponentsToAssembly`.
- `designToAssembly`.

Removing a host can remove attached dependants. Placement rules are
application-domain rules, not certified mechanical compatibility.

### 4.5 `WellOperations`: historical/operational data

[Records operations](../packages/core/src/records.ts) supplies daily history,
hole sections, service/BHA runs, interval lookup and LAS parsing.

Some operational interfaces retain source feet. Do not assume that every
number anywhere in core is metres just because the new visualization contracts
are metre-based.

### 4.6 Why model boundaries must stay explicit

There are adapter paths from a brief or record to an assembly. There is not an
established lossless round trip from arbitrary edited assembly JSON back into
the original scientific record or full design brief.

An enhanced editor should define exactly which model is authoritative and how
edits affect provenance, planning inputs, construction records and exports.

## 5. Current user-facing routes and workflows

### 5.1 `/`: capability index

The landing page explains independent capabilities and links to their reference
compositions. It is not a mandatory SDK workspace shell.

### 5.2 `/view-well/`: inspect a supplied well

[View-well consumer](../apps/demo/src/components/view-well-demo.tsx) combines:

- Well selector.
- 2.5D schematic and construction inspection.
- Optional 3D cutaway/follow-trajectory views.
- Searchable component inventory.
- Survey log views.
- Well file: history, hole sections, runs, mud logs and seismic.
- Linked hover/pinned depth and visible depth interval.
- Shared component selection.
- Shared seismic cuts and camera.
- Oblique-plane controls.
- Explicit CPU/GPU picking choice.
- Explicitly synthetic porosity styling.
- URL hydration and legacy well-link fallback.

Layout and view-display settings are still partly local React state. Shared
interaction state does not mean every UI choice is currently serialized.

### 5.3 `/edit-well/`: edit a working copy

[Edit-well consumer](../apps/demo/src/components/edit-well-demo.tsx):

1. Reads `well` and optional `component` query parameters.
2. Finds the selected source fixture.
3. Adapts its components into an assembly.
4. Opens `WellAssemblyBuilder` on the working copy.
5. Preserves the original record.
6. Allows JSON export.

Unknown well/component references produce explicit messages.

Reloading reconstructs the original working copy. It does not restore a saved
edit from a database. Editing catalogue-compatible schematic items also does
not create verified manufacturer or as-drilled information.

### 5.4 `/builder/`: schematic-first creation

[Workflow composition](../packages/react/src/well-design-workflow.tsx) exposes
five phases:

| Phase | What it contains |
| --- | --- |
| Schematic | Immediate editable assembly |
| Define | Identity, location/datum and offsets |
| Plan | Geology/pressure and trajectory |
| Design | Casing, cement and completion |
| Review | Programme, readiness and checks |

The default example is labelled as an example. Blank creation is available.

The assembly editor stays mounted across phase navigation, preserving edits and
history. Brief changes do not silently rebuild it. Explicit rebuilding replaces
component edits and clears that assembly history after confirmation when needed.

[Builder composition](../packages/react/src/well-assembly-builder.tsx) provides:

- Component palette and placement.
- Drawing selection and property inspector.
- Optional lazily loaded 3D assembly.
- Status/error messages.
- Undo/redo with snapshot history.
- Keyboard undo/redo shortcuts.
- Blank/example reset.
- JSON download using a Blob URL.

Normal commits retain up to 80 past snapshots. Reset/redo paths should be
reviewed if a strict global history/memory cap is required.

### 5.5 `/trajectory/`: trajectory tools

This route demonstrates plan/section views, editable station tables,
build-and-hold inputs and an interactive path.

Minimum curvature computes position from survey station angles/MD. Observed
XYZ fixtures are different: display interpolation should preserve their
reported path and coverage rather than silently recomputing it.

### 5.6 `/sandbox/`: explicit native WebGPU testing

[Sandbox consumer](../apps/demo/src/components/webgpu-sandbox.tsx):

- Generates a small synthetic cube locally.
- Requires an explicit Start action.
- Shows unsupported/error states.
- Provides opacity and amplitude-threshold controls.
- Switches Float32/Uint8 representation.
- Regenerates synthetic samples.
- Switches to an oblique slice and changes its tilt/depth.
- Uses shared camera/plane state and URL binding.
- Offers an offline WebGL FBO diagnostic.

This is a development capability demonstration, not a complete data-loading or
interpretation workspace.

### 5.7 Page inventory at a glance

The current App Router source contains these six authored content pages:

| URL | Page purpose | Primary demo content |
| --- | --- | --- |
| `/` | Explain the SDK and help developers navigate the examples | Capability cards, package-entry-point catalogue and component thumbnails |
| `/view-well/` | Inspect a selected existing well across linked views | Construction schematic, cutaway, trajectory-following view, well file |
| `/edit-well/` | Edit an existing well's schematic as a separate working copy | Reusable assembly editor with selected well/component context |
| `/builder/` | Demonstrate schematic-first well authoring and engineering planning | Editable assembly plus optional Define/Plan/Design/Review workflow |
| `/trajectory/` | Demonstrate survey computation and trajectory planning/editing | 3D well scene, plan/section/log plots, station table and course calculations |
| `/sandbox/` | Exercise the opt-in experimental WebGPU renderer safely | Locally generated seismic cube, raymarched volume, oblique slice and GPU diagnostic |

Next also produces a not-found route for unmatched URLs. There is no separate
hand-authored `not-found.tsx` page in the current app source; do not document a
custom 404 experience unless one is added.

The shared top navigation lists five destinations: View well, Edit well,
Well builder, 3D trajectory and WebGPU sandbox. The landing page's larger
capability cards focus on View well, Well builder and 3D trajectory. The Edit
well action is contextual from View well, though it also appears in the common
navigation.

### 5.8 `/`: landing page, SDK explanation and route directory

Source: [landing page](../apps/demo/src/app/page.tsx).

This is primarily a developer-facing front door, not a well viewer:

1. **Hero:** describes the project as reusable well-engineering visuals.
2. **Primary actions:** “See a well” opens `/view-well/`; “Assemble one” opens
   `/builder/`.
3. **Install snippet:** shows the core, React and optional Three package names.
   The text is illustrative; local workspace installation and actual published
   npm availability are separate concerns.
4. **Rendered component thumbnails:** a small sample of wellhead, tree, valve,
   packer and other catalogue assets.
5. **Capability cards:** links to View well, Well builder and Trajectory.
6. **Entry-point table:** describes core/react package subpaths and their
   broad responsibilities.
7. **Provenance disclaimer:** distinguishes synthetic examples from cited FORGE
   records.

The page does not create a design, save a project, host user data, or execute a
backend workflow. Its purpose is orientation and navigation.

### 5.9 `/view-well/`: every panel and layout

Source: [View well page](../apps/demo/src/app/view-well/page.tsx) and
[ViewWellDemo](../apps/demo/src/components/view-well-demo.tsx).

This is the main *inspection* example. It adapts a selected `WellDesign` and
its source-linked records into multiple views. It deliberately does not mean
that every view uses the same internal model or renderer.

#### Available wells

The demo currently offers:

| Selector ID | Displayed record | Supplied information |
| --- | --- | --- |
| `forge` | Utah FORGE 16A(78)-32 · documented | Observed survey, reported construction, operation records, mud log and seismic assets |
| `s-profile` | S-profile completion · synthetic | Synthetic survey/construction example |
| `research` | Open research reference · synthetic | Research-profile trajectory fixture; the selector labels this demo entry synthetic |

FORGE is the only entry wired with the demo `WellOperations`, LAS mud-log URL
and seismic metadata. For the other entries, the well-file UI explicitly says
records are unavailable rather than fabricating them.

#### Main toolbar

- **Well selector:** changes the active demo record.
- **Edit well:** navigates to `/edit-well/?well=...`; if an installed/selected
  compatible component is highlighted, its ID is passed as `component=...`.
- **Layout buttons:** choose a schematic/scene/seismic composition (listed
  below).
- **Depth views linked/independent:** controls whether cursor and MD-window
  interaction is shared across linked components.
- **Exploded view:** available in non-curved, non-earth layouts. Selected
  components remain linked between the 2D schematic and 3D assembly.
- **Summary:** displayed-part count, source-record count, TD and a documented
  record explanation when relevant.

When the active well changes, the host resets seismic cuts, camera, oblique
plane and log style. This prevents stale interpretation state from one well
being presented as if it belonged to another.

#### Six layout choices

| UI label | Internal key | What appears |
| --- | --- | --- |
| `2.5D + 3D` | `split` | Construction schematic beside a Blender-asset 3D assembly cutaway, plus selected-record card, component inventory and well-file content |
| `2.5D + seismic` | `seismic` | Construction schematic and a seismic section projected along the well; selecting/picking can update depth and construction selection |
| `3D well + seismic + survey` | `earth` | Specialized WebGL well/volume scene beside a trajectory survey log; this layout exposes slicing, picking and synthetic log-style controls |
| `2.5D schematic` | `schematic` | Construction drawing without the 3D assembly panel |
| `3D cutaway` | `scene` | Blender component assembly cutaway without the 2D schematic |
| `Follow trajectory` | `curved` | Construction drawn along the surveyed well path in a pannable/zoomable viewport |

The seismic layouts are omitted or redirected to the default split layout when
the selected well has no demo seismic asset. SEG-Y and 3D seismic sources are
loaded on demand rather than for every page/layout.

#### Layout-specific controls

`earth` includes:

- **Seismic slice/layout:** volume or arbitrary plane.
- **Plane azimuth, tilt and offset:** controls the plane in the volume's physical
  frame; it is visible as a sampled slice.
- **Picking:** CPU raycast (default) or GPU framebuffer path.
- **Synthetic porosity style:** off, colour, display radius or both.
- **Solid cube / Volume render:** switch between opaque textured faces and
  thresholded volume rendering in the existing WebGL scene.
- **Along well / Across well / Depth:** crop the volume along three axes.
- **Uncut:** reset the three crop ranges.
- **Transparent below:** visible for volume-render mode.
- **Survey log:** a depth-linked trajectory panel, with casing-shoe markers.

The view-well WebGL volume is the specialized existing int8, azimuth-aligned
protocol. It is not the generic Float32/Uint8 WebGPU contract.

#### Main view and side panels

- **Construction schematic:** selects a component and can show an exploded
  arrangement.
- **Assembly 3D scene:** uses catalogue Blender-rendered components as display
  assets, not manufacturer CAD.
- **Curved schematic:** maps the construction along the survey; SVG/viewport
  rendering is available without requiring the WebGL path for the drawing.
- **Seismic section:** uses the demo's well/seismic projection and displays a
  source/projection note. It is a section view, not a 3D interpretation editor.
- **3D well scene:** displays the well trajectory, construction, geology and
  optional seismic; supports camera, probe and spatial-pick callbacks.
- **Survey log:** displays trajectory properties over measured depth.
- **Selected-record card:** selected construction item name, type, top/bottom MD,
  diameters, material, description and source page/link when known.
- **Component inventory:** searchable/type-filterable/paged records; selecting
  a row syncs the active component.

The `2.5D + 3D`, `2.5D + seismic`, `2.5D schematic` and `3D cutaway` views share
the selected component where their corresponding component IDs exist.

#### Well file beneath the visualization

When the selected well has operational records, the page shows a hole-section
log and a tab set:

| Tab | Contents and behavior |
| --- | --- |
| Daily history | Days-vs-depth chart and daily report log; selecting a day pins depth and can select the matching hole section |
| Service & BHA runs | Run intervals/outcomes and selected run; can navigate to the related hole section/depth |
| Mud log | LAS curve tracks such as ROP, WOB, RPM, torque, pump pressure, flow and temperature; source LAS is fetched and parsed when this tab is selected |
| Directional survey | Survey station table/details for the record |
| Seismic (SEG-Y) | Source SEG-Y header information and a well-tied seismic section, loaded on demand |

The mud-log tracks include source depth intervals and component/hole-section
markers. Native source records retain their report units where the underlying
record model uses feet; the host converts to/from metre MD for linked
construction views.

With a synthetic well, the demo shows an explicit “no operational records”
message. It does not substitute the FORGE operation record onto an unrelated
well.

#### State, URL and assets on this page

The page creates its own store for the view, initializes focus from a well
query where appropriate, and binds state to `sw.*` query fields. It validates
well/component/log identifiers before applying a link. A legacy `?well=` link
has a fallback path.

Shared URL state includes interaction metadata—not the whole UI configuration,
project file or raw seismic/LAS buffers. Layout selection, renderer mode,
threshold, opacity and GPU-vs-CPU choice are not all part of the shared
snapshot.

### 5.10 `/edit-well/`: what the separate editor contains

Source: [Edit well page](../apps/demo/src/app/edit-well/page.tsx) and
[EditWellDemo](../apps/demo/src/components/edit-well-demo.tsx).

This page exists because inspection and editing are distinct user tasks.

1. The contextual View well action supplies a well ID and optionally a selected
   component ID through the query.
2. The page resolves the demo well from the fixed list.
3. It adapts the well's components into a `WellAssembly`.
4. A valid requested component becomes selected in the editor.
5. The editor displays a return link to View well.
6. If the well is unknown, the page shows an error and return action.
7. If the component ID is unknown for that well, an explicit warning is shown.
8. Changes affect the in-memory working assembly and can be exported as JSON.

The page warns that changes do not alter the original record and that reload
starts from the original. This is not a persistent project editor: there is no
database save, shared project ID or restoration of the exported JSON built into
this route.

The same `WellAssemblyBuilder` capability is reused by the builder page; the
separate route provides its own navigation/context and keeps editing separate
from read-only inspection.

### 5.11 `/builder/`: exact phases and authoring controls

Sources: [Builder page](../apps/demo/src/app/builder/page.tsx),
[workflow](../packages/react/src/well-design-workflow.tsx) and
[assembly editor](../packages/react/src/well-assembly-builder.tsx).

The first content is a complete editable **schematic**, not a sequence of
mandatory forms. The route is a reference composition of editable assembly
plus design brief; those are related but separate state models.

#### Workflow header

- Current design name and data-completeness/readiness percentage.
- Error count from design checks.
- `New design`, `Example well`, `Export brief` and `Rebuild schematic/View
  schematic` actions.
- Five phase buttons: Schematic, Define, Plan, Design and Review.
- Phase substeps and completion/missing/attention status.
- Back/next step buttons.

#### Schematic phase

- Starts with an example assembly.
- Component library/palette.
- Schematic drawing where parts can be selected, added, moved and removed.
- Inspector for labels, intervals, sizes and selected component properties.
- Validation issues and selection links.
- Optional 3D view.
- Undo/redo and keyboard shortcuts.
- Blank-well and example-well reset buttons.
- JSON assembly export.

Assembly edits/history are kept mounted when navigating away to other phases.
Changing the brief does not silently replace the assembly. When inputs and
assembly diverge, the app marks the change and provides an explicit rebuild
action. Rebuilding may require confirmation and clears assembly edit history.

#### Define phase and steps

- **Identity:** well name, field/operator/country/purpose and identity metadata.
- **Location & datum:** environment, coordinates, water depth, ground elevation,
  CRS and reference datum; a datum diagram makes depth reference visible.
- **Offset wells:** compare design candidates against offset wells, inspect
  comparison factors and reported records, adopt selected geology/casing/design
  portions, and record what was adopted. A pressure/programme plot is shown
  alongside.

The demo offers the FORGE offset fixture as a starting offset. The React
workflow exposes user offsets through controlled props and does not access
browser storage. The demo host owns its optional localStorage library, validates
its versioned document, reports read/write errors, and migrates valid legacy
unversioned arrays. This local library does not equal a remote multi-user
database.

#### Plan phase and steps

- **Geology & pressure:** edit formation/pressure/temperature inputs and their
  source/assumption metadata; inspect pressure plots.
- **Trajectory:** choose vertical or build-and-hold; edit kickoff/build rate and
  target; display computed MD/TVD, closure/departure, maximum inclination and
  dogleg; show a section plot and pressure context.

The planning functions may change total MD/trajectory and affect downstream
checks. The UI notes when casing scheme re-proposal is appropriate.

#### Design phase and steps

- **Casing:** create/propose a casing scheme, edit sections, select a string,
  inspect casing load/safety-factor analysis and pressure programme, and try
  regrading a failing string.
- **Cement:** edit cement plans and inspect the cement/pressure overlay.
- **Completion:** edit tubing/completion, packer, safety valve, perforations and
  artificial-lift information; a schematic preview is shown when the brief can
  be assembled.

These are preliminary/domain-model calculations and input checks. They are not
professional engineering approval.

#### Review phase

- One-page well programme summary.
- Design-readiness panel with links back to incomplete design steps.
- Design-coverage panel separating checked items, assumptions and not-checked
  items.
- `Export brief` for the design brief; this is distinct from assembly JSON
  export in the schematic editor.

#### Two exports, two data objects

| Export action | Contains |
| --- | --- |
| `Export brief` | The planning/design brief |
| `Export JSON` in the assembly editor | The component assembly |

Do not imply one export automatically serializes a single complete project
containing both objects, source provenance, all app UI state and history.

### 5.12 `/trajectory/`: exact modes, plots and data

Sources: [Trajectory page](../apps/demo/src/app/trajectory/page.tsx) and
[trajectory consumer](../apps/demo/src/components/trajectory-demo.tsx).

This page demonstrates survey math and user-authored planning/editing while
showing a live 3D context. The well selector chooses the reference fixture.

#### Three modes

| Mode | Behavior |
| --- | --- |
| View survey | Uses the selected fixture's survey as the reference, recomputes stations by minimum curvature for calculation/plots, and shows comparison with published/fixture positions where available |
| Plan build & hold | Creates a build-and-hold plan through a target; the target can be moved in plan/section or typed, and the displayed 3D planned revision updates on commit/release |
| Edit stations | Copies the current station inputs into a working array; changes to MD, inclination or azimuth are validated and positions/DLS are recomputed; physically invalid edits are rejected visibly |

The original survey fixture is not modified by editing/planning.

#### Toolbar and visible panels

- Well picker.
- Mode selector.
- DLS threshold (`degrees / 30 m`) for warning/colour context.
- Optional vertical-section azimuth; blank uses a derived/default azimuth.
- Formation visibility checkbox.
- 3D scene displaying the chosen/reference/planned/edited survey and formation
  context, with a probe that selects depth/component.
- Trajectory summary panel.
- Course calculation panel showing interval length, two inclinations/azimuths,
  dogleg angle, ratio factor, delta TVD/N/E, DLS, build and turn rate.
- Plan view with target/markers.
- Vertical section with formations and target/markers.
- Trajectory log with depth cursor and markers (KOP/EOB/target in planning mode).
- Survey station table; editable only in Edit stations mode.
- Selected construction record card.
- Mathematical explainer showing minimum-curvature equations and assumptions.

The computed position is a circular-arc interpolation between stations. It is
not a measurement between actual survey stations. A planning result is not
certified directional-drilling software.

### 5.13 `/sandbox/`: exact controls and purpose

Source: [sandbox page](../apps/demo/src/app/sandbox/page.tsx) and
[sandbox composition](../apps/demo/src/components/webgpu-sandbox.tsx).

The page isolates the native seismic WebGPU backend from the more complex
specialized WebGL well viewer. It generates a small cube locally, so users can
exercise the renderer without importing proprietary data.

Controls and content:

- **Start WebGPU / Stop WebGPU:** explicit opt-in/out; unsupported/failing
  implementations show errors instead of pretending to render.
- **Regenerate seismic:** deterministic seed changes the generated sample
  pattern.
- **Voxel format:** Float32 or calibrated Uint8 sample storage.
- **Opacity:** changes volume accumulation opacity.
- **Transparent below:** changes the amplitude threshold.
- **Oblique slice:** toggles between volume rendering and plane sampling.
- **Plane tilt / Slice depth:** change the shared oblique plane.
- **Use the WebGL well viewer:** link to `/view-well/`; it is a different backend
  and uses a different seismic protocol.
- **Run WebGL picking check:** performs a small known-plane coordinate/amplitude
  diagnostic to exercise GPU FBO picking independently.

Plane and camera state use a page-local store and optional URL synchronization.
The synthetic cube is bounded and offline. This page is not a file picker,
arbitrary-volume loader, geological mesh viewer or WebGPU well-scene version.

### 5.14 Shared page shell and page-level code examples

[Showcase components](../apps/demo/src/components/showcase.tsx) provide:

- A common navigation bar with the five route links.
- Current-page indication.
- A reusable `DemoPage` wrapper.
- `DemoHeader`: title, capability description, interactive “What this does”
  tooltip, “How to use it” disclosure, list of SDK entry points, and source/code
  example.

The “How to use it” sections are explanatory snippets. They are not each
separate executable SDK playgrounds, and some snippets are intentionally
abbreviated.

`apps/demo/src/app/layout.tsx` loads application fonts, SDK CSS and the
application stylesheet. `apps/demo/src/app/showcase.css` controls the
showcase-specific layout/theme.

## 6. Source fidelity and the FORGE fixture

Read [the source record](./FORGE_SOURCE_RECORD.md) before modifying documented
geometry or using it to validate scientific accuracy.

### 6.1 What comes from evidence

The Utah FORGE 16A(78)-32 fixture includes:

- 422 observed survey stations.
- Ten construction/installation evidence records.
- Source-page references and attribution.
- Daily operations, service/BHA records and mud-log derivatives.
- Seismic-derived demo assets with documented preprocessing.

The ten records are evidence categories, not a total count of physical installed
parts.

### 6.2 Important interpretation boundaries

- Survey workbook units are US survey feet, converted using `1200/3937`.
- Report depths labelled feet use the explicit `0.3048` metre conversion
  assumption and retain source values.
- Reported TD extends beyond the final observed station.
- The uncovered trajectory interval is not extrapolated as measured evidence.
- Casing ID/wall thickness is unknown where sources do not report it.
- Formation/contact blocks are contextual, not measured regional horizons.
- Diameter exaggeration makes inspection possible; it is not physical scale.
- Retrieved/failed temporary equipment is not depicted as permanently installed.
- Nominal catalogue equipment is not manufacturer CAD.

Original SDK code is MIT. Adapted FORGE data retains CC BY 4.0 attribution.
Read [third-party notices](../THIRD_PARTY_NOTICES.md); the fixture is not
relicensed as MIT.

## 7. Parser-independent ingestion contracts

Relevant files:

- [JSON contracts](../packages/core/src/contracts.ts).
- [Columnar contracts](../packages/core/src/columnar-contracts.ts).
- [JSON schemas](../packages/core/src/contract-schemas.ts).
- [Columnar transport schemas](../packages/core/src/columnar-schemas.ts).
- [Validation helpers](../packages/core/src/contract-validation.ts).

### 7.1 Why contracts exist

An embedding application may already decode DLIS, SEG-Y, databases, OSDU
responses or research arrays.

The visualization layer should not require that application's raw format.
It needs a strict description of the geometry/samples/reference frame it can
consume.

The contract is the boundary between format-specific upstream processing and
format-agnostic rendering. Existing parsers are optional upstream utilities,
not a requirement for the new contracts.

### 7.2 Shared spatial reference

```ts
interface SpatialReference {
  readonly units: "m";
  readonly crs: string;
  readonly depthDatum: string;
}
```

The CRS/datum strings describe the input. Validators do not infer a projection,
transform coordinates, correct vertical datums or reconcile conflicting frames.

The generic contract convention is XYZ metres with Z positive down.

### 7.3 JSON `WellPathInput`

Contains:

- `version: 1`.
- `id`.
- `reference`.
- An array of `[X,Y,Z]` point tuples.
- An increasing `measuredDepthsM` array, one MD per point.
- Depth-indexed log arrays.

Logs use explicit null values for missing JSON samples. Log depth keys must be
inside the path's MD coverage.

The JSON validator returns independent array/metadata values. This format is
convenient for transport and small examples, not the most compact representation
for millions of samples.

### 7.4 Columnar `SubsurfaceWellboreTrajectory`

Contains typed arrays:

```text
xyz                [X0,Y0,Z0,X1,Y1,Z1,...]
depthsMdM          [MD0,MD1,...]
inclinationsDeg    [INC0,INC1,...]
azimuthsDeg        [AZ0,AZ1,...]
```

Each column accepts Float32Array or Float64Array.

Invariants:

- At least two stations.
- `xyz.length === 3 * depthsMdM.length`.
- Angle columns match the station count.
- MD is finite, non-negative and strictly increasing.
- XYZ is finite.
- Inclination is in `[0,180]`, measured from down vertical.
- Azimuth is in `[0,360)`, clockwise from reference north.

Validators retain the exact supplied typed-array objects, including subarray
views. They do not freeze the contents of caller-owned buffers.

Keep large projected coordinates in Float64 until rebasing for GPU upload.

### 7.5 Columnar `SubsurfaceWellLogCurve`

Contains:

- Version, curve ID, well ID and unit.
- Increasing `depthsMdM`.
- One float value per depth.
- `nullValue`: `"nan"`, a finite numeric sentinel, or null.

NaN is accepted only with the `"nan"` policy. Infinity is rejected.
A numeric sentinel for Float32 values must be representable exactly.

This standalone log contract does not have a trajectory argument. Cross-asset
coverage/well association must therefore be checked by the host or renderer.
The scene verifies `wellId` against the supplied design.

### 7.6 `SubsurfaceSeismicVoxelCube`

This is an alias of the existing generic voxel input:

```ts
{
  header: SeismicVolumeHeader;
  data: Float32Array | Uint8Array;
}
```

Header:

| Field | Meaning |
| --- | --- |
| `version`, `id`, `reference` | Identity and spatial metadata |
| `dimensions` | `[nx,ny,nz]` positive integer sample counts |
| `bounds` | Finite increasing X/Y/Z cell-edge limits |
| `sampleType` | `float32` or `uint8`, matching the array |
| `byteOrder` | `little-endian` |
| `layout` | `x-fastest` |
| `amplitude` | Scale, offset and physical unit |

Flat indexing:

```text
index(x,y,z) = (z * ny + y) * nx + x
physicalAmplitude = storedSample * scale + offset
```

Bounds describe cell edges, not the first and last voxel centres.
For axis X:

```text
spacingX = (xMax - xMin) / nx
centreX(i) = xMin + (i + 0.5) * spacingX
```

Validation checks sample count, array type and finite stored/scaled amplitudes.
The full validation scan is synchronous and linear in voxel count.

`seismicVolumeFromBuffer` reads this raw binary contract, not a SEG-Y file.
Uint8 wraps the supplied buffer; Float32 explicitly decodes little-endian bytes
through DataView into a new typed array for portable byte-order semantics.

### 7.7 JSON Schema versus runtime validation

JSON Schema exports describe JSON transport values. A typed array is not a
normal JSON numeric array, and `JSON.stringify(typedArray)` is not the intended
wire representation for these contracts.

Runtime validators enforce additional relationships such as aligned lengths,
monotonic depth, valid transforms and finite scaled samples. Do not assume a
schema-only validation step proves every runtime invariant.

### 7.8 Ownership and the actual meaning of zero-copy

| Stage | Current behavior |
| --- | --- |
| Validate supplied typed arrays | Retains original arrays |
| Create typed subarray | Can share the original backing buffer |
| Validate JSON path arrays | Builds independent values |
| Decode little-endian Float32 bytes | Allocates a decoded Float32Array |
| Alias GLTF vertex attributes | Reuses BufferAttribute |
| Publish interaction state | Small metadata only, no voxel cloning |
| Upload texture/geometry to GPU | Device-memory transfer/copy still occurs |
| Rebuild log-cylinder geometry | Allocates CPU arrays and GPU geometry |

Caller mutation after validation is currently possible. A future API should
state whether supplied buffers are immutable-by-contract, revisioned, copied,
or explicitly transferred to worker ownership.

## 8. Coordinate systems and spatial precision

### 8.1 There are multiple coordinate spaces

1. Source record units/reference frame.
2. Core generic contract XYZ metres/Z-down.
3. Well-local east/north/TVD metres.
4. Specialized seismic along/offset/depth coordinates.
5. Normalized voxel texture coordinates.
6. Three display coordinates.
7. Camera/screen/drawing-buffer coordinates.

Many visualization errors arise from treating two of these as the same.

### 8.2 WebGL well-scene mapping

The specialized well scene maps:

```text
[east, north, TVD] metres
  -> [east/100, -TVD/100, -north/100] Three coordinates
```

Depth points downward while Three uses its own display axes. The scene also
exaggerates inspection diameters.

Shared camera and spatial picks are converted back to the host's metre frame,
not exposed as unexplained Three coordinates.

### 8.3 Specialized seismic frame

The WebGL volume is azimuth-aligned:

- Along-line coordinate.
- Cross-line offset.
- Depth/TVD.

Its affine frame maps normalized volume coordinates into the display scene.
The uploaded texture is indexed along-fastest, then offset, then depth.

This is distinct from the generic axis-aligned Float32/Uint8 cube. There is no
automatic adapter making either protocol interchangeable with the other.

### 8.4 Plane normals are not ordinary direction vectors

A plane follows:

```text
dot(normal, point - origin) = 0
```

When scene coordinates are expressed by `scenePoint = A * texturePoint + t`,
the plane normal in texture coordinates is proportional to:

```text
transpose(A) * sceneNormal
```

This covector transformation is necessary for non-uniform/rotated frames.
Treating the normal as an ordinary transformed direction produces incorrect
slice geometry.

### 8.5 WebGPU rebasing

The native backend subtracts cube origin and scales by the largest extent
before rendering. Camera state remains in contract XYZ metres.

It maps normalized XYZ/depth into a Three-compatible X/-depth/-Y orientation.
This reduces large-coordinate GPU precision problems but is not a complete
regional/multi-asset coordinate system.

### 8.6 CRS helpers

[CRS helpers](../packages/core/src/crs.ts) provide explicit EPSG:4326/3857
conversion and local-origin rebasing.

They are not a general projection registry, UTM converter, vertical-datum
transformation engine or unit-inference system.

Before adding a map component, define:

- The authoritative scene frame.
- Horizontal axis orientation.
- Vertical sign.
- Depth datum versus elevation.
- Conversion ownership.
- Rebase origin and precision requirements.
- How geographically separated assets share that frame.

## 9. Reactive state and Event Bus

Relevant files:

- [State engine](../packages/core/src/state.ts).
- [URL utilities](../packages/core/src/state-url.ts).
- [React hook](../packages/react/src/state-hooks.ts).
- [Depth binding](../packages/react/src/depth-link.ts).

### 9.1 Scope and lifecycle

Create one store per workspace/viewer group. There is no process-global
singleton. Independent viewers and SSR requests can remain isolated.

The store is framework-independent, synchronous and native TypeScript.
It does not require Zustand, RxJS, a router or browser globals on import.

### 9.2 Snapshot shape

```ts
interface SubsurfaceState {
  readonly activeAsset: {
    readonly wellId: string | null;
    readonly componentId: string | null;
    readonly depth_md: number | null;
    readonly spatial_xyz: readonly [number, number, number] | null;
  };
  readonly seismicSlices: {
    readonly inline: number | null;
    readonly crossline: number | null;
    readonly time_depth: number | null;
  };
  readonly viewState: {
    readonly position: readonly [number, number, number];
    readonly target: readonly [number, number, number];
    readonly zoom: number;
  };
  readonly depthLink: {
    readonly linked: boolean;
    readonly window: readonly [number, number] | null;
    readonly hoverMdM: number | null;
    readonly pinnedMdM: number | null;
  };
  readonly interpretation?: {
    readonly slicePlane: SlicePlane | null;
    readonly logStyle: WellLogStyle | null;
  };
}
```

`interpretation` is optional for backward compatibility.

The initial camera `[0,0,1000]` aimed at `[0,0,0]` is a placeholder. A renderer
must auto-frame or the host must provide a suitable view.

### 9.3 Published operations

- `focusAsset`.
- `selectComponent`.
- `updateDepthHover`.
- `pinDepth`.
- `triggerSpatialPick`.
- `setSeismicSlices`.
- `setViewState`.
- `setDepthWindow`.
- `setDepthLinked`.
- `setSlicePlane`.
- `setLogStyle`.
- `hydrate`.

Event categories include asset, depth-hover, depth-pick, spatial-pick, slices,
camera, depth-window, depth-link, interpretation and hydrate.

### 9.4 How depth linking works

Effective active depth is:

```text
hoverMdM ?? pinnedMdM
```

A hover temporarily moves linked cursors. Pointer leave clears hover and returns
to the pin. Picking explicitly changes the pin.

Unlinking clears transient hover. Asset changes clear selection/depth/spatial
state and depth window. Slice/camera/interpretation reset policies remain
host-owned and should be deliberate.

### 9.5 Loop prevention

- Equal writes emit nothing.
- Snapshots and their small metadata branches are frozen.
- Unchanged branches retain identity.
- Selector subscriptions support equality functions.
- A source label identifies the publisher.
- `ignoreSource` can suppress a consumer's own event echo.
- A different synchronous write from inside a subscriber throws.

Intended flow:

```text
user input -> publish -> subscribers apply state -> redraw
```

Not:

```text
subscriber redraw -> publish another changed state -> recursive redraw
```

Repeated plane normalization preserves already-unit normals within tolerance,
avoiding tiny floating-point changes that would defeat controlled no-op echoes.

### 9.6 Error semantics

Invalid input is rejected before it becomes a valid snapshot.
Listener failures are aggregated after other listeners are notified.

A successful state commit is not rolled back because an observer failed.
Hosts should distinguish an input validation failure from a post-commit
notification failure.

### 9.7 React integration

`useSubsurfaceSelector` uses `useSyncExternalStore`.

Select a scalar or stable immutable branch, or provide equality for derived
objects. Do not construct a new store on every render.

`useDepthLink()` without a store retains the previous standalone API. Its
shared-store mode is opt-in and requires focusing a well before publishing
non-null MD.

### 9.8 What the store intentionally does not contain

- Voxel/log buffers.
- GLTF scenes.
- GPU contexts/materials.
- Complete design/assembly history.
- A remote asset cache.
- Database records.
- All local toolbar/layout choices.

The store is an interaction intermediary, not the entire application model.

## 10. Deep links and persistence

### 10.1 URL format

The reserved namespace is `sw.*`, version `sw.v=1`.

Fields include:

```text
well, component, md, xyz
inline, crossline, depth
camera, target, zoom
window, linked
planeOrigin, planeNormal
logCurve, logMode, logDomain, logRadius
```

The serializer preserves unrelated query parameters and hash fragments.
It removes old keys in its owned namespace before writing new state.

The parser rejects:

- Unknown SDK keys.
- Duplicate SDK keys.
- Unsupported version.
- Invalid/non-finite numeric values.
- Incorrect tuple lengths.
- Invalid state relationships.
- Incomplete plane or log-style field groups.

### 10.2 Browser binding

`syncStateToUrl`:

1. Hydrates first.
2. Runs optional host-level asset validation.
3. Subscribes to state.
4. Debounces `replaceState`, normally 150 ms.
5. Handles `popstate`.
6. Reports errors through required `onError`.
7. Cancels timers/listeners on cleanup.

Hover depth is not serialized. A pin is.
The current binding uses `replaceState`, not a new history entry for every
cursor movement.

### 10.3 Host validation is essential

Syntactically valid state can still reference an unavailable well, component,
curve or coordinate frame.

The demo checks well/component IDs and rejects unknown synthetic-log IDs.
Other hosts must validate against their own assets.

### 10.4 Sharing a URL is not saving a project

A URL contains view metadata, not:

- Raw seismic arrays.
- User file contents.
- GLTF geometry.
- Unsaved assembly edits.
- A complete design revision.
- Access permissions or encrypted data.

A recipient must have compatible assets/IDs to reproduce the view.
Currently layout, volume mode, opacity, threshold and picking-engine choices
are not all globally serialized.

### 10.5 Privacy implications

Even without a data upload, URLs can expose asset IDs and coordinates through
copying, browser history, screenshots or host logging.

Do not claim that URL state is confidential simply because voxel buffers stay
local. An enhanced host should support an explicit share policy, redaction and
possibly opaque local/project references.

## 11. 2D visualization

### 11.1 Different views serve different purposes

- `CurvedSchematic`: construction around a trajectory.
- `AssemblySchematic`: editable catalogue-based assembly.
- `TrajectoryPlanView`: horizontal path.
- `TrajectorySectionView`: vertical-section projection.
- `TrajectoryLog`: survey properties indexed by MD.
- `LogTracks`: depth-indexed log columns.
- `SeismicSection`: raster seismic section plus overlays.
- `HoleSectionLog`, `ServiceRunLog`, `WellHistoryLog`: operational context.
- `DaysVsDepthChart`: progress through time.
- Pressure/programme/cement plots: planning context.

The package uses SVG/HTML/Canvas according to the component. It is not one
unified chart engine, nor a completed fence-diagram system.

### 11.2 Shared depth behavior

Views can consume:

- A cursor MD.
- A persistent selected MD.
- A visible MD window.
- Component selection.

A host can wire these through the shared store or keep components independently
controlled. The SDK does not force all views to be linked.

### 11.3 Enhancement opportunity

Unify track metadata and rendering adapters around columnar curves while
retaining existing LAS/interval APIs. Add pixel-aware decimation and gap-aware
rendering for very large logs. Do not sacrifice units, missing-value semantics
or precise depth mapping for a generic chart abstraction.

## 12. WebGL well and seismic rendering

### 12.1 Existing specialized scene

[Well scene](../packages/react/src/well-scene.tsx) builds:

- Survey-following well geometry.
- Casing/construction inspection proxies.
- Wellhead and contextual geology.
- MD labels and depth probes.
- Orbit/focus/fit camera controls.
- Optional seismic sections.
- An int8 regular seismic volume.
- Linked cursor/window overlays.
- Optional oblique plane, GPU picking and log tube.

Scene display geometry is intentionally not a physical-diameter engineering
model.

### 12.2 Specialized int8 volume protocol

The scene takes `SceneSeismicVolume`, not directly the generic cube contract.
It describes dimensions, along/offset/depth extents, azimuth, Int8 counts and
amplitude-per-count.

Its texture uses signed normalized samples. GPU picking compensates through a
scale of `127 * amplitudePerCount` for that binding.

The generic Float32/Uint8 renderer is currently the separate WebGPU backend.

### 12.3 Volume modes

- **Solid:** textured opaque block faces; cropping exposes new sampled faces.
- **Render:** ray-marched volume, hiding amplitudes below a threshold.
- **Oblique slice:** sampled plane intersection; hides the volume/proxy.

Changing crop/view state updates existing scene objects instead of requiring a
full asset rebuild.

Memoize volume and section objects in hosts. Changes to their identity can
trigger scene reconstruction even if their content is equivalent.

### 12.4 Layer visibility versus visual prominence

The well/geology/seismic render ordering is designed for inspection, including
keeping the well readable over seismic.

A future interpretation application must decide whether picking should follow
the nearest physical surface or the same visibility/render-order policy as the
display. These are not always equivalent.

## 13. Arbitrary-angle seismic slicing

Files:

- [Plane mathematics](../packages/core/src/interpretation.ts).
- [WebGL slice adapter](../packages/react/src/seismic-slice.ts).
- [Interpretation controls](../apps/demo/src/components/interpretation-controls.tsx).

### 13.1 Plane contract

```ts
interface SlicePlane {
  readonly origin: readonly [number, number, number];
  readonly normal: readonly [number, number, number];
}
```

Validation checks finite triples and a non-zero normal.

`slicePlaneFromAngles` defines:

- Azimuth of the normal clockwise from +Y.
- Tilt 0: horizontal plane.
- Tilt 90: vertical plane.
- Tilt range `[0,180]`.

`curtainBetweenWells` creates a vertical plane through two horizontal locations.
It does not generate an interpolated fence or a sampled 2D cross-section export.

### 13.2 Exact geometry

`intersectSliceBox` computes the plane/box polygon.
For a normal box intersection, a plane has at most six polygon vertices.

It handles:

- Horizontal/vertical/oblique planes.
- Non-cubic/cropped boxes.
- Face-coincident intersections.
- Disjoint/tangent degeneracies.
- Duplicate-point removal and ordered polygon construction.

### 13.3 Live texture sampling

The WebGL adapter transforms the physical plane into normalized texture space,
builds the polygon and samples the already-uploaded 3D seismic texture.

It does not build a CPU resampled seismic image for every slider movement.
Small geometry is replaced as the plane changes; the source volume stays loaded.

### 13.4 Interaction

- Toolbar azimuth, tilt and offset controls.
- Three TransformControls translation along local plane-normal Z.
- Orbit disabled during handle dragging.
- Controlled plane-change callback to the store.
- Plane origin/normal serialized into a deep link.

### 13.5 Deliberate limitations

- Intersection visualization, not general half-space clipping of all layers.
- No multi-plane editing collection.
- No scientific interpolation-quality controls.
- No persisted interpretation annotation objects.
- No full cross-section/fence generation.
- Slider/URL rotation and offset were browser-tested; automated tests do not
  establish every translation-gizmo gesture across touch/keyboard devices.

## 14. GPU framebuffer picking

File: [GPU picker](../packages/react/src/gpu-picker.ts).

### 14.1 What a pick returns

- Bound target mesh.
- GPU-rendered scene-space XYZ.
- Physical texture amplitude when a volume binding exists.
- Null on background/no hit.

The scene converts XYZ back into its metre frame and emits callbacks.

This finds a surface or boundary. It does not identify an internal reflector
integrated by the volume raymarch.

### 14.2 How it works

1. Check `EXT_color_buffer_float`.
2. Clone the perspective camera.
3. Apply a one-pixel drawing-buffer view offset.
4. Build proxies using source geometry and world matrices.
5. Render XYZ plus an object ID into a 1x1 float target.
6. Render texture amplitude plus ID into a second 1x1 float target.
7. Restore renderer state.
8. Asynchronously read both targets.
9. Decode ID/XYZ/amplitude.

The matrices map scene coordinates to normalized texture coordinates.
Amplitude uses the supplied scale/offset after GPU sampling.

Sampling quality follows the texture's configured filters. The exported result
comment calls it trilinear; that is only true when the binding texture supports
and uses the corresponding filtering. A future documentation/API cleanup should
avoid promising a filter independently of the texture configuration.

### 14.3 Concurrency and cleanup

- One active pick per picker instance.
- Hover events are coalesced.
- Clicks take priority.
- Obsolete hover results are invalidated.
- Switching away from GPU mode suppresses stale results.
- Miss/pointer leave clears transient readout.
- Hidden ancestors are respected.
- Camera layers are preserved.
- Shader errors are reported.
- Pending readback delays FBO disposal.
- Caller-owned geometry/textures are not disposed by the picker.

### 14.4 Numerical limitations

Float32 framebuffer coordinates have limited precision at large coordinate
magnitudes. Rebase large projected coordinates.

Object IDs are bounded to a float-exact integer range. Drawing-buffer pixels,
not CSS pixels, are the public input coordinates.

### 14.5 Performance and fidelity review targets

The current picker creates proxy materials/objects per pick and renders two
passes. This is functional but not an established high-throughput solution.

Investigate:

- Proxy/material caching and invalidation.
- Picking latency under many meshes.
- Combining outputs through multiple render targets where supported.
- Scissor/view offsets in custom host renderers.
- Renderer state restoration beyond the tested target/clear/autoClear/XR paths.
- Instanced, skinned, morphed, displaced or alpha-cut geometry.
- Matching display clipping/material behavior.
- Pixel coordinate boundaries on high-DPI and resized canvases.
- Context loss while readback is pending.
- Whether IDs from both passes should be explicitly cross-checked.
- Cleanup if proxy construction throws before the main rendering try/finally.

These are bounded review tasks, not claims that arbitrary advanced meshes are
currently supported correctly.

## 15. Dynamic log co-axial mapping

Files:

- [Log sampler/style](../packages/core/src/interpretation.ts).
- [Log cylinder](../packages/react/src/log-cylinder.ts).

### 15.1 Style contract

```ts
interface WellLogStyle {
  readonly curveId: string;
  readonly mode: "color" | "radius" | "color-radius";
  readonly domain: readonly [number, number];
  readonly radiusRange: readonly [number, number];
}
```

Domain/radius ranges must be finite and increasing. Radius multipliers must be
positive and no greater than 20.

### 15.2 Depth sampling

`sampleWellLog` uses binary search and linear interpolation between explicit MD
samples.

It does not:

- Extrapolate beyond log coverage.
- Interpolate across missing values.
- Replace missing values with zero.

Value-domain limits are different from MD coverage. Values outside the colour
domain are clamped to its endpoints; MD outside coverage creates gaps.

### 15.3 Tube construction

The current implementation uses:

- 512 longitudinal intervals, giving 513 rings.
- 12 sides with a duplicated seam vertex.
- Positions from the actual trajectory at each ring's MD.
- Locally transported perpendicular orientation.
- Vertex colours from a blue-to-yellow scale.
- Display radius from the normalized log value.
- No connecting triangles across missing samples.

Updating replaces and disposes the previous geometry.
The tube replaces the thin survey/DLS path when enabled; it does not alter
casing geometry or engineering dimensions.

### 15.4 Demo semantics

The porosity curve is generated from actual survey depth keys but its values are
synthetic. It is not a measured FORGE porosity log.

`curve.wellId` must match the design ID, not merely a selector alias.
`style.curveId` must match the supplied curve ID.

### 15.5 Enhancement targets

- Adaptive rings based on curvature, depth resolution and screen error.
- A stable frame fallback for tangents parallel to the current fallback axis.
- Preserve abrupt changes and short missing intervals that uniform rings could
  undersample.
- Configurable colour maps, legends, units and missing-data treatment.
- Style-only updates without rebuilding all positions.
- Generic columnar log selection rather than one synthetic demo curve.
- Separate options for retaining the DLS path and displaying a log overlay.
- Multiple simultaneous curves/encodings with clear perceptual rules.

## 16. Native WebGPU seismic backend

Files:

- [Renderer](../packages/react/src/webgpu-volume.ts).
- [React canvas](../packages/react/src/webgpu.tsx).

### 16.1 Public surface

- `WebGpuSeismicCanvas`.
- `WebGpuVolumeRenderer`.
- `WebGpuVolumeOptions`.

Options include store, positive amplitude limit, threshold, opacity and required
error callback.

The native host lifecycle is:

```text
construct -> await init() -> setSettings()/store updates -> dispose()
```

### 16.2 Backend choice

It constructs a Three renderer with an explicit WebGPU backend.
This avoids silently selecting a WebGL fallback.

Unavailable devices, initialization failure, GPU validation and device loss
produce errors rather than success-shaped empty scenes.

The implementation accesses the acquired native device through a guarded
backend runtime boundary because the public backend typings do not describe
everything required. This dependency on backend details should be reviewed on
Three upgrades.

### 16.3 Texture formats

- Float32: single-channel float texture, unfiltered `texture3DLoad`.
- Uint8: normalized single-channel texture, converted back to stored counts
  before header scale/offset.
- Dimensions checked against acquired device 3D texture-axis limits.

Axis limits do not equal a complete GPU-memory budget. A cube that fits each
axis can still be too large for available device memory or acceptable latency.

### 16.4 Shader behavior

Three's node/TSL system generates WGSL.

The volume:

1. Computes a ray through the voxel box.
2. Intersects it with the current cropped extent.
3. Marches 192 fixed steps.
4. Loads amplitudes.
5. Applies magnitude threshold and opacity.
6. Accumulates front-to-back colour/alpha.

The slice:

1. Computes the oblique plane/box polygon.
2. Loads the same texture at polygon coordinates.
3. Applies the amplitude colour scale.

The last implementation cycle exposed a real WGSL bug: a vector condition's
select behaved collectively rather than producing per-axis ray signs.
Scalar sign selection fixed it. This is why compiling and reporting ready are
not adequate shader validation.

### 16.5 Shared state

The backend consumes camera, interpretation, slice and hydration changes.
Camera input publishes using a source label so the backend does not echo itself.

Current `seismicSlices` interpretation:

- `inline`: upper X cut in physical cube coordinates.
- `crossline`: upper Y cut.
- `time_depth`: upper Z cut.

These are not automatically geological survey inline numbers or milliseconds.
The contract is metre-based; a time conversion belongs upstream.

### 16.6 Lifecycle and error behavior

- ResizeObserver resizes the canvas.
- Pixel ratio is capped.
- Initialization waits for backend/shader compilation.
- Uncaptured GPU errors reach the host.
- Device loss reaches the host.
- Failed drawing must not resolve into a ready state.
- Disposal cleans subscriptions, controls, geometry, materials and textures.
- Renderer disposal is deferred when asynchronous initialization is pending.

Further device-loss/error-injection tests are advisable. Start/stop tests do
not simulate every driver failure or compile-time cancellation point.

### 16.7 Experimental limitations

- Separate seismic canvas, not the existing complete well scene.
- No WebGPU construction/assembly renderer.
- No integrated WebGPU Blender geology view.
- No native WebGPU picking implementation.
- Fixed ray steps and fixed transfer function.
- No progressive loading, bricking, LOD or out-of-core volume streaming.
- No measured industrial hardware performance baseline.
- Nearest loads are not equivalent to WebGL filtered sampling.
- Host must supply a suitable camera and non-zero container size.

## 17. Blender pipelines

### 17.1 Two distinct Blender uses

1. **Component catalogue:** shipped nominal equipment PNG/GLB assets generated
   through offline Blender tools.
2. **Geological importer:** arbitrary host-supplied horizon/layer/fault GLTF
   meshes with declared custom attributes.

One should not be mistaken for the other.

### 17.2 Geological metadata contract

`BlenderGeomHorizon` declares:

- Identity/version/reference.
- GLB or GLTF format.
- Source URL, including host-managed blob URLs.
- A column-major affine `meshToWorld` matrix.
- Attribute mappings.

Each attribute mapping declares:

- Custom GLTF semantic, such as `_POROSITY`.
- Logical layer name.
- Shader input alias.
- Item size 1-4.
- Numeric domain.

The transform must have 16 finite values, be affine and invertible.

### 17.3 Loader behavior

[Blender loader](../packages/react/src/blender-horizon.ts):

- Uses Three GLTFLoader.
- Allows a LoadingManager and loader configuration.
- Supports host-configured decoder dependencies.
- Validates every mesh primitive before adding aliases.
- Finds lowercase custom semantics exposed by GLTFLoader.
- Checks item size and position-aligned attribute count.
- Rejects shader-input collisions.
- Reuses the original BufferAttribute.
- Applies the explicit transform to all loaded scenes.
- Disposes shared resources after post-load validation failure.

It returns a successful GLTF object for the host to own and dispose.

### 17.4 Responsibilities still owned by the host

- Assign geological materials/shaders.
- Choose normalization and colour maps.
- Resolve GLTF sibling buffers/textures.
- Install/configure DRACO, KTX2 or meshopt if needed.
- Ensure Blender exported the custom attributes.
- Convert contract space into a specialized scene's display frame.
- Revoke blob URLs when no longer needed.
- Decide whether source URLs/decoders may make network requests.

The loader does not upload assets, but that does not make every source load
offline. Remote URLs and external dependencies can generate requests.

### 17.5 Improvement direction

Build a documented Blender export example containing:

- Known coordinate axes/units.
- A preserved custom scalar attribute.
- Named horizon/fault identity.
- A minimal geological material adapter.
- A self-contained GLB and optional GLTF sibling example.
- Pixel/attribute/transform tests after import.

This would make the bridge reproducible rather than requiring integrators to
infer shader and exporter behavior.

## 18. Procedural sandbox

[Sandbox generators](../packages/core/src/sandbox.ts) are dependency-free and
offline.

### 18.1 Seismic

- Deterministic seed.
- Default `32 x 32 x 32` grid.
- Tilted sinusoidal reflectors.
- Synthetic discontinuity/fault offset.
- Smooth 3D value noise.
- X-fastest layout.
- Generic validated header.
- Maximum 4,194,304 voxels.

This is value noise, not Perlin/Simplex and not a scientific wave-propagation
simulation.

Float32 stores the generated amplitude directly.
Uint8 uses:

```text
scale = 2/255
offset = -1
maximum quantization error approximately 1/255
```

### 18.2 Trajectory and log

- Bounded station count and total MD.
- Deterministic curved path.
- Aligned XYZ/MD/inclination/azimuth columns.
- Synthetic porosity with a shared MD buffer.

Current generation/validation runs on the calling thread. Worker-based
generation is a future improvement, not a current capability.

## 19. Tests, CI and actual verification evidence

### 19.1 Available commands

Use the repository's declared Node/pnpm versions:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm test
pnpm test:render-adapters
pnpm test:asset
pnpm test:packages
pnpm exec playwright install chromium
pnpm test:e2e
WEBGPU_TEST=1 pnpm exec playwright test e2e/rendering.spec.ts --grep "native WebGPU"
```

Build before tests that import SDK `dist` or serve demo `out`. Otherwise a test
may exercise stale output.

### 19.2 Test layers

| Layer | Purpose |
| --- | --- |
| Core Node tests | Maths, contracts, state invariants, URL behavior and generators |
| Rendering adapter tests | Built Blender/slice/log geometry behavior and disposal |
| Browser tests | User workflows, links, real canvas/GPU execution |
| axe checks | Automated DOM accessibility checks |
| Asset tests | Manifest/hash consistency |
| Packed consumer smoke | Tarball contents, peers, SSR-safe public imports and rendering |
| Native WebGPU flag run | Require an adapter and verify pixel-level changes |

The package consumer smoke installs React without Next/Three for the non-3D
paths. It checks the presence of new rendering files in the tarball but is not
full packed-browser coverage for every Three/WebGPU export.

### 19.3 Last rendering implementation verification

The immediately preceding implementation work reported successful:

- Core and React declaration/build output.
- Static demo build.
- Lint.
- 78 selected core/state/URL/columnar tests.
- 9 rendering-adapter tests.
- Packed package-consumer smoke.
- 18 distinct selected browser checks across final runs.

The browser checks included:

- Plane rotation/translation through controls and URL restoration.
- Log style changes and deep-link reload.
- Known FBO coordinate/amplitude results.
- Background miss, hidden ancestor, pending disposal and renderer restoration.
- Picking XYZ on an oblique plane and publishing it.
- Explicit unavailable-WebGPU behavior.
- Float32 and calibrated Uint8 rendered-pixel changes.
- Native slice movement, regeneration and stop/restart.
- Mobile sandbox layout and accessibility.
- Existing linked-depth/camera/history behavior.
- Separate editor source preservation.
- Existing mobile/lazy-loading behavior.

Known reference diagnostic values included an amplitude of `1.5` and XYZ near
`[0.03125,-0.03125,0]` in its small diagnostic scene.

These counts are historical scoped evidence, not the current full-suite size.
This handoff-writing task did not rerun all tests or add implementation changes.
An incoming reviewer should rerun relevant commands in their own environment.

### 19.4 Native versus hardware GPU evidence

`WEBGPU_TEST=1` launches Chromium with:

```text
--enable-unsafe-webgpu
--use-angle=swiftshader
```

This exercises the native WebGPU API and generated WGSL using the software GPU
test path. It is not a discrete-GPU benchmark.

Normal unsupported-browser tests remain separate. The flagged test requires an
adapter rather than skipping when one is missing.

### 19.5 CI configuration versus observed CI execution

[CI workflow](../.github/workflows/ci.yml) is configured for:

- Install.
- Core/asset tests and lint.
- Dependency audit.
- Build.
- Rendering-adapter tests.
- Package-consumer smoke.
- Chromium installation and e2e.
- Dedicated native WebGPU verification.
- Output artifact upload.

This document establishes what the workflow says, not that a specific remote
GitHub Actions run succeeded. Software-WebGPU support on the Linux runner
should be verified in actual CI.

### 19.6 Validation gaps worth filling

- Hardware/browser matrix beyond Chromium software rendering.
- Sustained FPS/frame-time and GPU/CPU memory measurements.
- Long pointer-picking sessions.
- Touch/keyboard plane-gizmo manipulation.
- Renderer/device/context-loss injection.
- Typed-array mutation after validation.
- Extreme projected-coordinate precision.
- Very large/irregular/log-gap datasets.
- Packed 3D/WebGPU consumer application.
- Post-export asset references under a real static deployment.
- Repeated resize, unmount/remount and multi-view resource accounting.

## 20. Current limitations and review concerns

The following is a review queue, not a completed independent bug audit.

| Area | Current boundary or concern | Why it matters |
| --- | --- | --- |
| Persistence | Editor exports a working copy; no project database/save lifecycle | Users may mistake edits for durable source updates |
| Model reconciliation | Brief/record/assembly are separate; edits are not a lossless round trip | Silent divergence between plan and drawing is possible without explicit policy |
| Shared state scope | Camera/depth/planes/log style linked; many display choices remain local | A link may reproduce interaction state but not the same screen |
| CRS | Limited explicit conversions, no general vertical-datum engine | Combining regional data can put assets in wrong places |
| Typed arrays | Validated buffers remain caller-owned and mutable | Post-validation changes can invalidate assumptions |
| Large inputs | Full scans and generators are synchronous | Main-thread stalls for large volumes/logs |
| WebGL renderer | Large scene setup/effects and coupled pointer/resource logic | Harder to reason about lifecycle and add capabilities safely |
| GPU picking | Per-pick objects/materials and two passes | Allocation pressure and latency at scale |
| Pick/display agreement | Picking proxies do not reproduce every visual shader/material | A displayed feature may not match the picked surface |
| Log tube | Fixed resolution and frame fallback | Short features/gaps or degenerate tangents need stronger coverage |
| WebGPU | Separate experimental backend and backend-runtime boundary | Upgrade/lifecycle risk and no full scene parity |
| Sampling | WebGL filtering and WebGPU nearest loads differ | Cross-backend amplitude/appearance can diverge |
| Volume scale | No streaming/bricking/LOD or measured memory budget | Industrial cubes can exceed browser/device capacity |
| Blender | Attributes loaded, geology materials host-owned | Workflow still requires custom integration |
| Offline claim | Remote URLs, assets and dependencies may request network | No blanket proprietary-data isolation guarantee |
| Demo persistence | Host-only localStorage library is versioned; local-storage availability and future schema migrations still depend on the host | Persistence is opt-in host behavior, not an SDK guarantee |
| Export/versioning | Assembly revision/JSON exists; no general project migration protocol | Long-lived files need clear compatibility contracts |
| Packaging | No npm publication/release gate completed | Local behavior is not release readiness |
| Accessibility | DOM axe/mobile checks do not make GPU canvases fully accessible | Non-pointer users need equivalent workflows |

Examples of source-grounded follow-up questions:

1. Can a log frame become degenerate when its tangent aligns with the fallback
   axis? Add adversarial trajectories before changing frame math.
2. Are renderer init/draw errors always prevented from being overwritten by a
   React ready transition? Inject delayed failures.
3. Is every object created before an asynchronous operation guaranteed disposal
   if that operation throws?
4. Do linked well changes reset interpretation atomically and consistently?
5. Do malformed persisted or imported offsets produce visible diagnostics
   rather than entering the comparison/adoption pipeline?
6. Do picking proxies correctly handle supported source geometry classes, or
   should unsupported geometry be rejected explicitly?
7. Does a native volume crop retain enough sampling fidelity at shallow angles
   and extreme aspect ratios?
8. Are errors recoverable without leaving stale overlays or status messages?

## 21. Recommended enhancement roadmap

Priority means suggested sequence, not permission to implement everything at
once. Preserve the schematic-first UX and current public API unless a deliberate
migration is approved.

### Phase A: strengthen correctness and lifecycle boundaries

Work:

- Add adversarial trajectory/log-frame tests.
- Add delayed shader/device error and init-cancellation tests.
- Document buffer ownership and mutation policy.
- Keep saved-offset persistence host-owned, validate its versioned document and
  surface storage failures.
- Validate imported offset data before it enters comparison/adoption.
- Define picker support for geometry/material variants.
- Test pick/display clipping and visibility agreement.
- Add resource counters for repeated mount/pick/resize cycles.

Acceptance:

- Every invalid input path has a visible/host-reported error.
- React views do not access localStorage or other host persistence APIs.
- No ready state after an injected initialization/rendering failure.
- No changed-state subscription loop.
- No incorrect interpolation across missing logs.
- Repeated teardown returns known renderer/resource counts to baseline.
- Existing builder/editor/link tests remain green.

### Phase B: clarify model editing and durable local projects

Work:

- Define a versioned project/document model.
- Keep original source evidence separate from user-authored revisions.
- Define brief-to-assembly reconciliation/conflict behavior.
- Add import of exported assembly/project files with validation.
- Provide explicit Save/Open and unsaved-change indicators.
- Consider IndexedDB for opt-in local persistence.
- Add a provenance/change log rather than changing documented values silently.

Acceptance:

- Export/import round trip preserves schema, identity, units and nulls.
- Reload restores only when persistence is explicitly enabled.
- Original fixture remains unchanged.
- Rebuild conflict is clear and undo behavior is specified.
- Invalid/unsupported files never render a partial success silently.

### Phase C: coordinate and renderer adapter unification

Work:

- Route the new core frame registry through scenes, maps, state publication and
  picking; until then, hosts must transform picks into their common state frame.
- Define metre/depth/time semantics per dataset.
- Support an explicit rotated generic voxel transform if required.
- Adapt generic cubes into WebGL without unsafe quantization by default.
- Keep the int8 legacy protocol supported through an explicit adapter.
- Add columnar trajectory/log adapters to existing record-oriented views.

Acceptance:

- Known fiducial XYZ/MD points agree across 2D, WebGL and WebGPU.
- Non-uniform/rotated transforms and plane normals have numerical tests.
- Backends state their sampling/filter differences.
- No unit/datum inference from ambiguous metadata.
- Large projected coordinates satisfy a published precision tolerance.

### Phase D: measured performance work

Work:

- Create reproducible fixtures at multiple sizes.
- Record initialization time, input latency, frame-time percentiles and memory.
- Move validation/generation/resampling to bounded workers where appropriate.
- Cache picker proxies/materials.
- Add adaptive log geometry and pixel-aware log decimation.
- Explore progressive texture upload, bricking and LOD.
- Add early ray termination and configurable quality if scientifically acceptable.

Proposed benchmark targets, not current results:

| Scenario | Proposed measurement/target |
| --- | --- |
| Reference desktop interaction | p95 frame time within 16.7 ms for a defined baseline scene |
| Mobile baseline | p95 frame time within 33.3 ms on declared devices |
| Hover pick | p95 input-to-readout below 100 ms on the defined reference scene |
| CPU validation | No unbounded main-thread task over 50 ms for supported large-input workflow |
| Teardown | Stable resource/memory baseline after repeated scene cycles |

Calibrate targets against real devices before making them release requirements.
Do not advertise 60 FPS based on a small synthetic cube or a software GPU.

### Phase E: interpretation features

Work:

- Multiple named clipping/slice objects.
- Inline/crossline identifiers with explicit survey geometry.
- Fence diagrams and two-well curtains with worker interpolation.
- Horizon/fault point/segment collections.
- Pick uncertainty/precision metadata.
- Annotation undo/redo and export.
- Shared selection across annotations, surfaces, logs and maps.

Acceptance:

- An annotation is an explicit versioned data object, not just a transient XYZ.
- Picking/filtering behavior is documented.
- Interpretation units/frame/asset references round trip.
- No claim of automated fault detection unless an actual algorithm is added
  and independently validated.

### Phase F: Blender-first geological workflow

Work:

- Publish a complete Blender export fixture and instructions.
- Add reusable attribute-driven geological materials.
- Add layer/opacity/colour-map controls.
- Add geological object selection and provenance.
- Support host-controlled dependency resolution for GLTF folders.

Acceptance:

- Exported attributes survive and match expected vertices.
- Known mesh fiducials land at expected world coordinates.
- Shared geometry/material disposal occurs once.
- Pure local loading can be demonstrated with external network requests blocked.

### Phase G: developer and release experience

Work:

- Add interactive examples or Storybook if the maintenance benefit is justified.
- Generate an API reference.
- Add clean consumer examples for narrow 2D and optional 3D/WebGPU paths.
- Measure bundle sizes and enforce no-Three leakage into 2D.
- Define supported browsers, hardware capabilities and React/Three versions.
- Add versioning/changelog/release automation.
- Complete license inventory and release notices.
- Verify actual static hosting headers/assets.

Acceptance:

- A developer can embed one view without the demo shell.
- Public examples type-check against packed artifacts.
- Packages contain only intended code/assets.
- Supported browser/capability failures are explicit.
- Published claims match actual benchmark and CI evidence.

## 22. Suggested internal architecture refactoring

Do not begin with a wholesale renderer rewrite. Extract boundaries while
preserving behavior.

Potential responsibilities:

```text
scene frame / coordinate adapter
scene asset lifetime
well geometry adapter
seismic texture and volume adapter
slice geometry adapter
log geometry adapter
camera controller
pointer/picking controller
depth/selection overlays
render scheduling
React lifecycle wrapper
```

A good extraction:

- Owns a clear set of resources.
- Has explicit init/update/dispose behavior.
- Accepts domain inputs rather than reading unrelated React state.
- Reports errors to a defined channel.
- Can be tested without mounting the entire application.
- Does not introduce duplicate shared-state stores.

A bad extraction:

- Merely splits a large file into files with shared mutable globals.
- Introduces a second uncontrolled camera/depth system.
- Hides fallback behavior behind a generic renderer interface.
- Copies scientific arrays on every event.
- Changes provenance or units during rendering.

A unified backend interface may eventually help, but it should state actual
capabilities rather than promising unsupported WebGPU well/picking features.

## 23. Guardrails for the next AI

1. Read source and tests before changing architecture.
2. Preserve existing package names and supported import paths by default.
3. Keep Three optional for non-3D consumers.
4. Keep the default CPU picking behavior unless intentionally migrated.
5. Preserve the original documented record.
6. Keep unknown source dimensions null.
7. Label synthetic logs/geology/equipment.
8. Keep MD, TVD, elevation, time and unit conversions explicit.
9. Do not call GPU upload zero-copy.
10. Do not put large arrays in interaction state.
11. Do not add a global store shared across SSR requests.
12. Publish from input and apply state in subscribers.
13. Surface unsupported/error conditions rather than silently falling back.
14. Test actual output values/pixels, not merely ready flags.
15. Rebuild dist/static output before adapter/browser validation.
16. Treat the demo as a consumer, not an SDK prerequisite.
17. Keep offline/privacy claims scoped to the real data path.
18. Do not turn preliminary design calculations into certification claims.
19. Do not replace functional code with aspirational TODO scaffolding.
20. Separate verified findings from recommendations and hypotheses.

## 24. Reading order for another AI

For fastest accurate understanding:

1. [Root README](../README.md).
2. [Core guide](../packages/core/README.md).
3. [React guide](../packages/react/README.md).
4. [Source fidelity](./FORGE_SOURCE_RECORD.md).
5. [Package manifests](../packages/core/package.json) and
   [React export map](../packages/react/package.json).
6. [State](../packages/core/src/state.ts) and
   [URL state](../packages/core/src/state-url.ts).
7. [Contracts](../packages/core/src/contracts.ts) and
   [columnar validators](../packages/core/src/columnar-contracts.ts).
8. [View-well composition](../apps/demo/src/components/view-well-demo.tsx).
9. [Builder composition](../packages/react/src/well-assembly-builder.tsx) and
   [workflow](../packages/react/src/well-design-workflow.tsx).
10. [WebGL scene](../packages/react/src/well-scene.tsx).
11. [Slice](../packages/react/src/seismic-slice.ts),
    [picker](../packages/react/src/gpu-picker.ts) and
    [log tube](../packages/react/src/log-cylinder.ts).
12. [Native backend](../packages/react/src/webgpu-volume.ts) and
    [React lifecycle](../packages/react/src/webgpu.tsx).
13. [Blender importer](../packages/react/src/blender-horizon.ts).
14. [Rendering browser tests](../e2e/rendering.spec.ts),
    [state-link tests](../e2e/state-link.spec.ts) and
    [render-adapter tests](../packages/react/test/).
15. [Package verification](../tools/verify-packages.mjs) and
    [CI configuration](../.github/workflows/ci.yml).

Use package docs for public API context, implementation for behavior, tests for
exercised cases and the source-record document for scientific evidence limits.

## 25. Copy-paste prompt for the reviewing AI

```text
Act as a Principal Frontend Architect, geoscience visualization engineer and
open-source SDK maintainer reviewing Subsurface Workbench.

Read docs/AI_REVIEW_HANDOFF.md and inspect the actual repository. The document
is a handoff, not proof that every feature is production-ready.

Goals:
1. Verify that the documented capabilities match the code.
2. Identify high-confidence correctness, lifecycle, coordinate, data-fidelity,
   API, performance and UX issues.
3. Recommend an incremental enhancement plan.
4. Preserve the schematic-first builder and separate working-copy editor.
5. Preserve existing package names, optional Three boundaries and controlled
   component APIs unless you justify a versioned migration.

Important distinctions:
- Two existing SDK packages with modular entries, not four new packages.
- Native instance-scoped TypeScript store, not Zustand.
- Parser-independent contracts coexist with LAS/SEG-Y parsers.
- Generic Float32/Uint8 cubes differ from the specialized int8 WebGL volume.
- WebGPU is a separate experimental seismic backend, not full scene parity.
- GPU picking identifies surfaces/boundaries, not buried volume reflectors.
- The demo porosity is synthetic.
- FORGE unknown dimensions and evidence boundaries must remain intact.
- URL state is interaction metadata, not a saved project or confidential data.

Start with review only. Do not rewrite the repository or add dependencies
before reporting a bounded plan.

For each finding provide:
- File and precise location.
- What the code does now.
- A reproducible scenario or failing test.
- Expected behavior.
- Impact and confidence.
- Minimal root-cause correction.
- Verification that would establish the correction.

Separate:
A. Confirmed defects.
B. Unverified risks needing tests.
C. Feature gaps.
D. Optional architectural improvements.

Review priorities:
- MD/TVD/XYZ, axis transforms, plane-normal transforms and unit/datum handling.
- Typed-array ownership, null/sentinel/gap semantics and scientific provenance.
- Shared-state no-op/source/reentrancy behavior and URL hydration.
- Async renderer/picker initialization, cancellation, disposal and device loss.
- Pick/display geometry/material agreement and hidden layers.
- Fixed log-tube resolution and frame degeneracy.
- Large-input validation/generation and GPU memory/performance limits.
- Editing/persistence/reconciliation between record, brief and assembly.
- Public export maps, bundle boundaries and packed-consumer behavior.
- Accessibility and mobile alternatives to canvas/pointer-only controls.

Run the smallest relevant tests first. Build core, React and demo before tests
that consume dist/out. Treat historical test counts as scoped evidence; obtain
fresh results. Native software-WebGPU success is not a hardware FPS benchmark.

Deliver:
1. Current architecture summary.
2. Evidence-based findings table.
3. Prioritized roadmap with acceptance criteria.
4. Proposed first implementation slice.
5. Explicit limitations and unanswered questions.

Do not claim universal offline privacy, zero-copy GPU upload, engineering
certification or production-scale performance without evidence.
```

## 26. Final takeaway

The project already has substantial working capability: well-domain operations,
schematic-first editing, linked visualization state, strict input contracts,
multiple 2D views, a specialized WebGL scene, Blender attribute loading and an
experimental native seismic backend.

The strongest next step is not adding more impressive feature names. It is
making the existing boundaries reliable and measurable:

- Explicit coordinate/model ownership.
- Durable and provenance-aware editing.
- Reproducible Blender/data ingestion.
- Consistent sampling and selection.
- Resource-safe rendering.
- Performance evidence.
- Clear public API and release guarantees.

Enhance those foundations incrementally while retaining the direct, understandable
drawing-first workflow that motivated the changes.

## 27. Design and accessibility slice in progress

The verified vertical slice began on the linked chart/table/spatial view and
has since added table alternatives and keyboard camera controls across the
showcase:

- React `SubsurfaceThemeProvider` provides typed light, dark and high-contrast
  themes plus compact and comfortable density modes. Shared CSS variables now
  cover the linked view and selected flagship SVG surfaces.
- The linked table's row height and virtual-scroll calculations follow density.
- Viridis and Cividis ramp anchors, OKLab interpolation, explicit value-domain
  validation, a qualitative category palette, and a unit-bearing
  `ColorScaleLegend` are exported from the React 2D entry point. Linked chart
  samples use the Cividis map; selected/hovered points also change size/stroke
  pattern so state is not communicated by colour alone.
- The linked chart has a generated accessible description and roving keyboard
  focus (arrows, Home, End, Enter/Space); its virtualized table remains the
  exact-sample keyboard alternative. Reduced-motion and visible-focus tokens
  are present.
- Focused tests check actual palette endpoints, virtual row sizing, keyboard
  selection, linked values, and axe results in all three themes.
- The correlation, cross-section and map views have paged accessible tables.
  Trajectory plan/section/log, daily depth progress, LAS tracks and SEG-Y
  section views now expose 50-row table pages. Row generation is bounded to
  the requested page; raw sample arrays stay outside state and are not all
  copied into a second table array.
- WebGL well and WebGPU volume views expose keyboard camera controls and
  camera-position announcements. The seismic section and depth-log controls
  also support keyboard depth movement and selection. The WebGL well scene
  exposes a keyboard-operable list of well components to select and inspect
  without using GPU point picking. Focused browser coverage checks actual table
  rows/units/page boundaries, keyboard component selection, shared camera
  updates, three-theme axe results on flagship views, and reduced-motion
  behavior.

The next incremental extension makes the same appearance selector available
across the showcase and tokens the flagship correlation, cross-section, and
map SVG styling. Theme-sensitive axis/label text, top and well features,
selection, map outlines, panels, controls, and focus colors are semantic CSS
properties. The geology series remain visually distinguishable through stroke
patterns/fills rather than being flattened to one theme accent. Browser checks
assert actual computed SVG surface and view text colors and run axe on all
three flagship routes in light, dark and high-contrast themes. The appearance
controls are kept inside the page main landmark.

This remains partial implementation of Step 2, not a claim of WCAG 2.2 AA
conformance. Exact GPU pixel-coordinate component/seismic amplitude picking still lacks a
keyboard equivalent; component selection in the well scene uses the adjacent
accessible component list. Map/trajectory views have table alternatives but
are not fully keyboard-operable point-by-point. Theme tokens do not yet cover
every view or prove perceptual/contrast quality for each data series. Manual
keyboard, touch-target and screen-reader validation is still needed. Axe tests
are automated checks, not a substitute for manual assistive-technology
validation.

## 28. Petrophysics Step 3

Petrophysics now has a parser-independent strict `PetrophysicsWell` aggregate
with explicit MD metres and datum, typed log columns, sentinel/null policy,
zone/top annotations and optional core measurement observations. Validation
retains source typed arrays, enforces sample/depth alignment and rejects
unknown values except where the null policy permits them. JSON Schema covers
transport shape; runtime validation remains necessary after converting JSON
arrays to typed columns. See
[`packages/core/src/petrophysics.ts`](../packages/core/src/petrophysics.ts).

The core analysis module pairs curves only at identical MD keys, bins
non-null samples, computes mean plus explicitly gap-bounded sampled net/gross
zone thickness, and returns display-only relative-MD columns for wells tied on
the same explicit top ID. The zone calculation does not interpolate cutoff
crossings; the result is a sampled statistic, not a geological pay
interpretation. Flattened output reuses source value arrays but creates
relative-depth columns. See
[`packages/core/src/petrophysics-analysis.ts`](../packages/core/src/petrophysics-analysis.ts)
and [`packages/core/src/petrophysics-analysis.test.ts`](../packages/core/src/petrophysics-analysis.test.ts).

React `/2d` exports the multi-track log plus crossplot, histogram, zone-summary
and marker-flatten views. Log/crossplot brushes and histogram-bin picks publish
depth ranges through the host's shared depth link. A raw sample table remains
available. Template objects are strict JSON display configuration; the SDK
does not own their persistence. The `/petrophysics/` route exercises these
views with two synthetic, explicitly labelled wells, including a supplied
shared marker ID, null sentinels, core measurements, and switchable templates.
The core also exposes parameterized Archie water saturation and classic
Schlumberger M-N calculations. Archie requires v/v porosity, true formation
resistivity in ohm.m and caller-supplied `a`, `m`, `n`, plus formation-
temperature-corrected `Rw`. M-N requires neutron porosity (v/v), density
(g/cm3), sonic slowness (us/ft), and explicit matrix/fluid endpoints. Both
match exact MD keys only, retain gaps with quality/reason output, and perform
no interpolation. The demo plots these calculated outputs and reports their
equations, input curve IDs, units and parameters. Inputs and results are
synthetic screening examples, not certified interpretations or lithology/
fluid classifications. No raw format parser or persistence layer was added.

Calculation code and numeric tests are in
[`packages/core/src/petrophysics-calculations.ts`](../packages/core/src/petrophysics-calculations.ts)
and [`packages/core/src/petrophysics-calculations.test.ts`](../packages/core/src/petrophysics-calculations.test.ts).
The calculation report is exported from the React `/2d` entry.

Tests check actual crossplot pairs, histogram counts and bin-to-depth extents
(including a constant-valued curve), gap-aware zone thickness, flattened
relative depths and identity of unchanged value columns, validation of
templates and core measurements, each React analysis view's rendered output,
and browser flows for keyboard selection, linked brushing, component
visibility and axe checks. Core, React, and demo builds and demo typecheck
pass; the full core and React render-adapter suites pass. The sample plots
still render synchronously and have no documented large-input performance
benchmark; review performance before using them on very large log columns.
Automated axe checks are not a substitute for manual screen-reader testing.

## 29. Well report Step 4

Core `/contracts` now defines `WellReportSpec` and `validateWellReportSpec`.
The JSON-compatible report document has explicit identity, datum, provenance,
source records and one section per requested report category: summary,
trajectory, casing, cement, completion, operations, logs, formation tops,
offsets, data coverage, provenance, assumptions and not-checked. It rejects
unknown fields, incomplete/duplicate section sets, duplicate source/row/curve
IDs, unresolved source references, malformed dates, misaligned log samples and
non-increasing MD. Numeric MD fields are metres; missing values remain null.
Trajectory stations retain paired local Easting/Northing values or paired nulls
in their declared frame and can preserve inclination, azimuth, source row, and
source MD/TVD in feet. Optional validated appendices retain complete host-owned
source tables such as survey stations and daily drilling operations. Unit
strings are display metadata, not physical dimension validation. Empty data
sections are retained and rendered as not reported. The contract is a view
model only; it does not store or derive report data.

React `/2d` exports `WellReportView`. It renders optional actual well
construction schematics, sourced component detail, tables, source captions,
MD/TVD profile and local Easting/Northing plan figures, gap-aware log charts,
operations milestones and disclosure sections. Validated appendix tables
preserve survey orientations/raw reported values, hole sections, service runs,
and daily-operation records. Table and timeline depth actions plus
keyboard/pointer chart navigation publish exact source MDs to the host callback.
Browser print uses scoped CSS, hides controls, expands full source registers,
retains static SVG figures, and adds print page margins/page numbering; the SDK
does not generate PDF files.

The `/well-report/` demo uses the documented FORGE well, actual construction
schematic, source operations, all 422 available survey stations and referenced
LAS mud log. The LAS depth curve is explicitly converted from feet to metres
(`0.3048 m/ft`); nulls remain gaps. Formation intervals are shown in their
supplied TVD reference, not converted to MD. Operator, UWI, offsets and other
unavailable fields remain not reported. Hole-section, run and daily-report
registers retain source values and page references. The page is interactive and
links depth picks through the instance-scoped store. Print/browser and contract
tests verify source values, record counts, source labels, missing values,
schematic visibility, and linked MDs.

Limitations: browser print output depends on the host browser's print-to-PDF
implementation; this is not a controlled PDF renderer. Browser print layout
does not prove identical pagination across engines. The report does not
calculate engineering findings, verify source truth, or establish WCAG
conformance beyond the automated checks.
