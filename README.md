# Subsurface Workbench

A subsurface visualisation and calculation toolkit by Ikhmal Putra Manan. The host owns data,
backend and persistence; the packages store nothing and fetch nothing. Original code is MIT. The
Utah FORGE data keeps its CC BY 4.0 attribution, and the world basemap is Natural Earth (public
domain); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

**State, October 2026.** The previous application and its UI were purged for a total redo. What
remains is the foundation the new application is built on: the calculations, the 2D and 3D views,
the map solution, the data, and a typed rewrite in progress. There is no application in the
repository until the new one is built.

## Packages

| Package | What it holds |
| --- | --- |
| `@ikhmalputra/subsurface-core` | Calculations and data: minimum-curvature trajectory and build-and-hold planner; casing scheme, API 5C3 ratings, load cases, cement and kick tolerance; Archie and Schlumberger M–N; LAS 2.0 and SEG-Y parsing; CRS and GIS (WGS84, Web Mercator, WGS84 and NAD83 UTM); validated contracts; state and URL deep links; the FORGE, S-profile and research wells |
| `@ikhmalputra/subsurface-react` | Views: the well section, construction schematic and curved construction, log tracks, trajectory plots, seismic section (`/2d`); well, assembly, offshore and site scenes (`/3d`); the wells map and field GIS map (`/gis`); the site adapters that place FORGE and the Equator field (root) |
| `@ikhmalputra/subsurface-fixtures` | The FORGE survey and its source files: mud log (LAS), PSDM section (SEG-Y) and the well-centred PSDM sub-volume, under `data/` |
| `kernel`, `calc`, `scene`, `render`, `views` | The typed rewrite: known/derived values and unit-tagged quantities, trajectory and hydraulics, headless placement of components on the survey, the three.js frame, a schematic view |

Neither package has been published.

## Build and check

Node 24.21.0 and pnpm 12.9.1:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
pnpm test                 # core, kernel, calc, scene, render
pnpm test:render-adapters # React views rendered to static markup
pnpm test:views
pnpm test:asset
pnpm test:packages        # packs both packages and renders them in a clean consumer
```

There are no browser end-to-end tests, by decision.

## Rendering

The 3D scenes run on three.js's WebGPU renderer, which falls back to WebGL 2 by itself. Shaders
are TSL, so both backends run the same seismic, slice and picking code. Every scene has a
26-view cube and a capped section plane, and labels are page text over the canvas. Seismic uses
the 2D section's colour map and clip in every view.

Component models are meshopt-compressed glTF. The decoder is WebAssembly, so a host with a
Content Security Policy must allow `'wasm-unsafe-eval'` in `script-src`. `pnpm render:catalog`
re-renders the models in Blender and compresses them; `pnpm build:world` rebuilds the basemap.

Depth views and the seismic section share one set of gestures: Ctrl/⌘ + wheel zooms about the
pointer, a wheel or a drag pans, Shift + drag zooms to a box, a click that does not move selects.

## Calculations

Checked by independent recalculation in October 2026:

- Minimum curvature, dogleg severity, closure, vertical section and the build-and-hold planner
  reproduce the published FORGE positions to 2.6 mm. Kickoff is the deepest station within 2°
  before a build sustained for 90 m (FORGE: 1,779 m MD).
- API TR 5C3 burst, collapse (all four regimes) and body yield match published tables; collapse
  is reduced under tension and yield is derated with temperature. Burst on a production string is
  a tubing leak on the packer fluid; collapse is full evacuation against the whole mud column.
- Archie water saturation; Schlumberger M–N with the CP-8 definitions.
- SEG-Y IBM float decoding, the FORGE seismic datum conversion and 3D volume placement.
- Unit constants, including the US survey foot (1200/3937 m) used by the FORGE survey.

Known approximations: net-to-gross counts whole sample-to-sample intervals, which runs low at
zone edges and gaps; kick tolerance volume is not capped at the open-hole length; maximum dogleg
severity is quoted per course, so short courses amplify noise. Not implemented: shale volume,
density porosity, annular pressure loss, ECD, cumulative production.

## Limitations

Not engineering software. The FORGE record supplies casing OD and specifications and shoe
depths, not a joint tally, wall IDs or manufacturer CAD; its strata are conceptual. Display
diameters are exaggerated, and the Blender models are nominal geometry. Ratings and checks are
textbook calculations without professional approval.

Source values, units, report pages and hashes are recorded in
[the FORGE source record](docs/FORGE_SOURCE_RECORD.md); planned tools are listed in
[the domain study](docs/SUBSURFACE_DOMAIN_STUDY.md).
