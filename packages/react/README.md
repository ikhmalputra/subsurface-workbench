# Subsurface React

React views and three.js scenes for well and subsurface data. Every view is controlled: the host
supplies validated records from `@ikhmalputra/subsurface-core` and owns selection, persistence
and fetching. Unknown values render as "not reported"; provenance text is never hidden.

```sh
pnpm add @ikhmalputra/subsurface-core @ikhmalputra/subsurface-react react react-dom
pnpm add three maplibre-gl   # only for the /3d and /gis entries
```

```ts
import "@ikhmalputra/subsurface-react/styles.css";
import "@ikhmalputra/subsurface-react/gis.css";      // with /gis
```

## Entry points

| Entry | What it exports |
| --- | --- |
| `/2d` | `WellSection` (construction, mud log and survey as tracks on one depth axis), `AssemblySchematic`, `CurvedAssemblySchematic`, `LogTracks`, `TrajectoryPlanView`, `TrajectorySectionView`, `TrajectoryLog`, `SeismicSection`, the petrophysics analysis views (crossplot, histogram, zone summary, flatten, Archie and M–N calculation report), `ComponentPalette`, `AccessibleTable`, `useDepthZoom`, `usePlotZoom`. No three.js. |
| `/3d` | `WellScene`, `AssemblyScene`, `SiteScene`, `triangulatePlan`, `GpuFramebufferPicker` |
| `/gis` | `WellsMap` (offline globe of located wells) |
| `/records` | `WellHistoryLog`, `DaysVsDepthChart`, `ServiceRunLog`, `HoleSectionLog`, `LogTracks` |
| `/trajectory` | the trajectory plots and survey log |
| `/seismic` | `SeismicSection`, `SegyHeaderPanel` |
| `/three`, `/assembly-three` | `WellScene` and `AssemblyScene` on their own |
| `/state` | `useSubsurfaceSelector`, shared depth hooks over a core store |
| `/ui` | `CommandButton`, `CommandIcon` |
| root | `InteractiveViewport`, `useDepthLink`, `InfoTip`, `AccessibleTable`, and the site adapters `forgeSite`, `equatorSite`, `equatorField`, `equatorPetrophysics`, `kestrelSite`, `unlocatedWells` |
| `/assets/*` | Blender-rendered component models and thumbnails (`well-components/`), the Natural Earth basemap (`gis/world-50m.json`) |

## 2D

- **Construction schematic.** Pass the well's `records` (its `WellComponent`s) as well as the
  assembly, and the drawing shows what the records hold: drilled hole sections by bit size, cement
  to the recorded hole, grade, weight and connection, depths as reported in feet, source pages. A
  survey adds a TVD ruler; `formationColumn` adds a lithology column. `frame` turns it into a
  track on a shared depth axis with compact labels.
- **Curved construction.** The same assembly along the surveyed path in vertical section, with
  hole walls, cement, shoe labels in MD and TVD, MD ticks and a departure axis. `cursorMdM`,
  `onCursorMdChange` and `onSelectMd` link it to other depth views.
- **Brushing.** `LogTracks` takes `onBrush`: Shift + drag then selects an interval instead of
  zooming to it. `AssemblySchematic` takes `highlights` to mark intervals across the drawing; a log
  track can be read on a logarithmic grid (`scale: "log"`).
- **Gestures.** Depth views and the seismic section share d3-zoom gestures: Ctrl/⌘ + wheel zooms
  about the pointer, a wheel or a drag pans, Shift + drag zooms to a box, a click that does not
  move selects. A controlled `depthWindow` / `onDepthWindowChange` pair links views.
- **Trajectory plots** take `fill` to draw at their element's pixel size instead of scaling.

## 3D

Scenes run on three.js's WebGPU renderer with automatic WebGL 2 fallback; the backend is written
to `data-backend`. Each has a 26-view cube, a capped section plane and page-text labels.
`SiteScene` places one site's wells, horizons, datum levels and seismic slices in one east, north
and depth frame inside a labelled axes box; every surface carries the host's note on what it is.
Its `cursor` (`{ wellId, mdM }`) rides a ring along that well, `highlight` lights an interval; `reach` (MD by well id) draws each
well only as deep as it had been drilled, and `hiddenMarkers` hides picks such as a shoe not yet set. `WellScene` takes `focusOnSelect`
to fly to a selection made in another view, and `reachMdM`, `installedIds` and `runToMdM` to show the
well as it stood on a day: path and holes to the depth drilled, strings to the depth run, without a
rebuild; `alertIds` makes components pulse, e.g. strings that fail a what-if.

Models are meshopt-compressed glTF. The decoder is WebAssembly, so a Content Security Policy must
allow `'wasm-unsafe-eval'` in `script-src`.

## Map

`WellsMap` takes sites (`WellsMapSite`), a self-hosted MapLibre worker URL and an optional
same-origin basemap GeoJSON with attribution. It opens as a globe, flies to a chosen site and
shows each well's surface location, its path in plan and any seismic footprint. It makes no
third-party request. A `cursor` (`{ at, label }`) marks a point the host chooses, such as a linked
depth on a well's path. The root's `forgeSite()` and `equatorSite()` produce both the map site and
the matching `SiteScene` inputs.
