# Subsurface Core

Framework-independent well data and calculations. Not an
engineering solver. Entry points: `.` (records, fixtures, assembly
catalogue), `/trajectory`, `/well-design`, `/offset-wells`, `/units`, `/records`
(operational history, runs, hole sections, LAS parser), `/seismic` (SEG-Y
parser, section projection), `/contracts` (validated parser-independent
contracts and interaction datasets), `/state` (instance-scoped interaction
store) and `/frames` (explicit coordinate transforms).

## Production and surveillance records

`/contracts` exports `ProductionSurveillanceDocument` and
`validateProductionSurveillanceDocument`. A document combines host-owned
`InteractionDataset` observations keyed by exact UTC Unix milliseconds with
dated production, injection, test, completion, workover, shut-in or surveillance
events. Observation column units and null handling remain explicit in the
dataset; optional event depth is metres MD, and optional component IDs are
host-owned. The validator enforces a time key, matching well identity, unique
event IDs, valid UTC timestamps and ordered event intervals. Provenance must be
declared as documented, synthetic or user-authored. No values are inferred,
filled across gaps, or treated as forecasts.

## Explicit typed quantities

`./units` and the package root export runtime-labelled quantity objects for
length, pressure, density and duration. Values must be finite, and constructors
make the units explicit at API boundaries rather than relying on TypeScript
number aliases (which disappear at runtime).

```ts
import {
  feet, toMetres, poundsPerSquareInch, toPascals,
  specificGravity, toPoundsPerGallon, days, toSeconds,
} from '@ikhmalputra/subsurface-core/units';

const measuredDepth = toMetres(feet(8_000));
const pressurePa = toPascals(poundsPerSquareInch(5_000));
const mudWeight = toPoundsPerGallon(specificGravity(1.2));
const elapsedSeconds = toSeconds(days(2));
```

Conversions are explicit and return a quantity carrying the output unit.
Length uses the exact international foot (`1 ft = 0.3048 m`); pressure uses
absolute unit conversions (`1 bar = 100,000 Pa`); duration uses seconds as its
canonical intermediate. Density converts ppg using the physical US liquid
gallon and avoirdupois pound, and specific gravity uses a stated reference
density of `1,000 kg/m3`. This physical conversion is intentionally distinct
from the rounded `8.345 ppg per SG` approximation used by some existing
well-design examples. The typed helpers are opt-in and do not yet change
existing numeric APIs; callers must convert at their own data/API boundaries.
They do not perform datum, CRS, gauge-pressure or temperature corrections.

## Horizontal GIS projections

The separate `/gis` entry provides `GisDocument`, `prepareGisDocument`,
`reprojectGisXY` and `selectGisStation`. Supported CRS are longitude-first WGS84
(`EPSG:4326`), Web Mercator (`EPSG:3857`), and WGS84 UTM zones 1-60 north/south
(`EPSG:32601`-`32660`, `EPSG:32701`-`32760`). Proj4 performs UTM transformations.
Other datums, including NAD83, are rejected rather than silently treated as WGS84.
The map extent is limited to Web Mercator latitudes; antimeridian-spanning
documents are rejected.

Wells declare projected XY **metres**, Float64 XYZ/MD arrays, a depth datum,
source and provenance. Z is TVD metres positive down. MD is finite, non-negative
and strictly increasing. Layers declare their own CRS, source and provenance;
only a LineString or single closed exterior Polygon ring is supported, without
holes. Outlines have `elevationDatum: null`; no elevation is inferred.
Preparation transforms horizontal display coordinates without mutating source
arrays or converting vertical datums. `selectGisStation` publishes an exact
source MD and source-frame XYZ to the supplied store, never geographic degrees
or 3D-local coordinates masquerading as projected metres.

```ts
import { reprojectGisXY, prepareGisDocument } from '@ikhmalputra/subsurface-core/gis';
const projected = reprojectGisXY([114.231, 5.412], 'EPSG:4326', 'EPSG:32650');
const geographicDisplay = prepareGisDocument(hostGisDocument);
```

## Coordinate frame registry

`./frames` provides an instance-scoped `CoordinateFrameRegistry` for the host
to declare named coordinate frames and register explicit affine transforms.
Frame metadata requires a CRS label, length unit, vertical datum and vertical
axis direction. The registry does **not** infer CRS conversions, datum shifts,
or axis orientation from labels; a host must supply the transform it has
validated. Matrices are column-major, map source coordinates into target
coordinates, and must be finite, affine and invertible. Inverse transforms and
unambiguous multi-frame paths are resolved by the registry. Conflicting paths
are rejected.

```ts
import {
  CoordinateFrameRegistry,
  type AffineTransform3,
} from '@ikhmalputra/subsurface-core/frames';

const frames = new CoordinateFrameRegistry();
frames.registerFrame({
  id: 'survey',
  crs: 'local: projected east/north',
  lengthUnit: 'm',
  verticalDatum: 'RKB',
  verticalDirection: 'down',
});
frames.registerFrame({
  id: 'scene',
  crs: 'local: projected east/north scene',
  lengthUnit: 'm',
  verticalDatum: 'RKB',
  verticalDirection: 'up',
});
const surveyToScene: AffineTransform3 = [
  1, 0, 0, 0,  0, 1, 0, 0,
  0, 0, -1, 0,  0, 0, 0, 1,
];
frames.registerTransform('survey', 'scene', surveyToScene);

const scenePick = frames.transformPoint([100, 200, 30], 'survey', 'scene');
const scenePlaneNormal = frames.transformNormal([0, 0, 1], 'survey', 'scene');
```

`pointInMetres` converts only the frame's coordinate length units (`ft` or
`m`); it does not reconcile coordinate reference systems or vertical datums.
For high-precision local rendering, transform world coordinates into a declared
local frame before GPU upload. Keep `SubsurfaceState.spatial_xyz` in one host
chosen common frame and transform picks into that frame before publishing:
the state itself intentionally has no implicit frame inference.

## Reactive state and deep links

Use one store per embedded workspace. There is no process-global singleton,
React dependency, Zustand dependency, implicit browser access or asset storage.
Multiple viewers and server-rendered requests remain isolated.

```ts
import { createSubsurfaceStore } from '@ikhmalputra/subsurface-core/state';
import { syncStateToUrl } from '@ikhmalputra/subsurface-core/state-url';

const store = createSubsurfaceStore();
store.focusAsset('well-1');
store.updateDepthHover('well-1', 1234.5, 'log-track');
store.pinDepth('well-1', 1230, '3d');
store.triggerSpatialPick([332800, 4260700, 1200], 'map');
store.setSeismicSlices({ inline: 300, crossline: 200, time_depth: 1200 }, 'slice-control');
store.setViewState({ position: [100, 200, -300], target: [0, 0, 1000], zoom: 1.5 }, 'camera');

const stopDepth = store.subscribeSelector(
  (state) => state.activeAsset.depth_md,
  (md, previous, event) => drawCursor(md),
  { ignoreSource: 'log-track' },
);
const stopPicks = store.on('spatial-pick', (event) => drawMapMarker(event.state.activeAsset.spatial_xyz));

// Call only in a browser lifecycle/effect; clean up when the workspace is destroyed.
const stopUrl = syncStateToUrl(store, {
  onError: reportError,
  validateState: (state) => assertKnownAsset(state.activeAsset.wellId),
});
// Later:
stopDepth(); stopPicks(); stopUrl();
```

- `activeAsset`: `wellId`, optional `componentId`, effective `depth_md` and
  `spatial_xyz`. MD is metres. Coordinates and camera vectors must use the
  host's declared common frame/datum; the store does not infer or convert CRS.
- `depthLink`: `linked`, visible `[top,base]` MD `window`, transient `hoverMdM`
  and persistent `pinnedMdM`. Hover falls back to the pin on pointer leave.
  Unlinking clears hover; switching wells clears component/depth/spatial
  selections and the MD window. Slice/camera resets remain host-owned.
- `seismicSlices`: nullable `inline`, `crossline`, `time_depth` positions.
  Use physical coordinates, not voxel indices. The host declares whether
  the third plane is a depth or time plane; do not mix time with metre-based
  data contracts.
- `viewState`: finite `position` and `target` XYZ vectors and positive `zoom`.
  Position and target must differ. Initial `[0,0,1000]` / `[0,0,0]` / `1`
  values are placeholders; a host can leave its renderer auto-framed until
  a real camera interaction or deep link supplies a view.
- `dataInteraction`: active dataset ID, transient hovered sample ID, up to 128
  selected IDs, optional MD-metre and UTC epoch-millisecond ranges, and a brush
  represented by stable endpoint IDs. It contains no dataset columns, typed
  arrays, or per-row buffers. `setDataInteraction` publishes a
  `"data-interaction"` event with a caller-supplied source; changing dataset
  context clears stale row selections and ranges. Equal writes are no-ops.
- Snapshots are immutable and unchanged branches retain identity. Equal
  writes emit nothing. `subscribeSelector` supports custom equality;
  `ignoreSource` suppresses a component's own echo while updating its cached
  selection. All subscription methods return an unsubscribe function.
- Publish from input handlers; subscribers **apply** state to views.
  Identical controlled echoes are allowed; synchronously publishing a
  different state from a subscriber throws instead of recursively looping.
  Listener failures are aggregated after every other listener is notified.
  The state is committed before notification; an observer error does not
  roll back a successful input action.
- Keep large arrays outside the store. There is no data-buffer cloning in
  event publication and no network, storage or persistence side effect.

`stateToUrl` / `stateFromUrl` are pure utilities. They use versioned `sw.*`
query parameters, preserve unrelated query keys and hashes, reject duplicate,
unknown, unsupported or invalid SDK parameters, and return `null` when no SDK
state is present. The serialized depth is the **pin**, not transient hover.
`syncStateToUrl` hydrates before subscribing, debounces `replaceState` by
150 ms, handles `popstate`, cancels pending writes/listeners on disposal, and
requires `onError` for parse/history errors. It does not add history entries
for cursor moves. Optional `prefix`, `debounceMs`, `StateUrlHost`,
`validateState` and `fallbackState` support embedded hosts, SSR tests, asset
validation and legacy links. Initial URLs without SDK state preserve the
host's initial selection; navigating to an unversioned URL restores defaults
(or `fallbackState`). URL contents are shareable metadata, never voxel/log
buffers; do not put sensitive identifiers or coordinates into a public link.
`dataInteraction` remains ephemeral and is not serialized by the current URL
codec.

## Interpretation state

The root entry exports `SlicePlane`, `WellLogStyle`, `slicePlaneFromAngles`,
`curtainBetweenWells`, `intersectSliceBox` and `sampleWellLog`.

```ts
import { slicePlaneFromAngles } from '@ikhmalputra/subsurface-core';

store.setSlicePlane(slicePlaneFromAngles([0, 0, 1500], 45, 70), 'plane-control');
store.setLogStyle({
  curveId: 'porosity', mode: 'color-radius',
  domain: [0, 0.4], radiusRange: [0.75, 2],
}, 'log-control');
store.on('interpretation', ({ state }) => drawInterpretation(state.interpretation));
// Return to normal volume and survey-path styling:
store.setSlicePlane(null);
store.setLogStyle(null);
```

`interpretation` is optional in older snapshots. Plane origins are XYZ metres
in the host frame; normals are validated and normalized. Azimuth is the normal's
clockwise angle from +Y; tilt 0 is horizontal and 90 is vertical.
`curtainBetweenWells` builds a vertical plane through two distinct horizontal
well locations, not an interpolated fence diagram. `intersectSliceBox` returns
an ordered convex polygon, or an empty array when there is no intersection.

Log styles normalize against an increasing `domain` and use display-only
`radiusRange` multipliers in (0,20]; they never change physical casing data.
`sampleWellLog` performs binary-search MD interpolation without extrapolation
or bridging null/NaN/sentinel gaps. Large log arrays still live outside state.

Deep links also serialize `sw.planeOrigin`, `sw.planeNormal`, `sw.logCurve`,
`sw.logMode`, `sw.logDomain` and `sw.logRadius`. Plane/log field groups must be
complete and valid. Hosts must validate linked curve identifiers against their
available logs, just as they validate linked well and component identifiers.

## Columnar and Blender contracts

The original JSON path and seismic header protocols remain unchanged.
`/contracts` additionally exports:

| Interface | Validator | Packing |
| --- | --- | --- |
| `SubsurfaceWellboreTrajectory` | `validateWellboreTrajectory` | `xyz[3*i..3*i+2]`, `depthsMdM[i]`, `inclinationsDeg[i]`, `azimuthsDeg[i]` |
| `SubsurfaceWellLogCurve` | `validateWellLogCurve` | one `values[i]` per strictly increasing `depthsMdM[i]` |
| `SubsurfaceSeismicVoxelCube` | `validateSeismicVoxelCube` | alias of `{header,data}` in the existing x-fastest cube protocol |
| `BlenderGeomHorizon` | `validateBlenderGeomHorizon` | GLB/GLTF source, explicit reference, transform and vertex mappings |

```ts
import { validateWellboreTrajectory, validateWellLogCurve } from '@ikhmalputra/subsurface-core/contracts';

const trajectory = validateWellboreTrajectory({
  version: 1, id: 'well-1',
  reference: { units: 'm', crs: 'local: east/north', depthDatum: 'RKB' },
  xyz: new Float64Array([0, 0, 0, 20, 0, 100]),
  depthsMdM: new Float64Array([0, 105]),
  inclinationsDeg: new Float32Array([0, 11.3]),
  azimuthsDeg: new Float32Array([0, 90]),
});
const log = validateWellLogCurve({
  version: 1, id: 'porosity', wellId: trajectory.id, unit: 'v/v',
  depthsMdM: trajectory.depthsMdM,
  values: new Float32Array([0.15, NaN]), nullValue: 'nan',
});
```

Both Float32 and Float64 columns (including subarrays) are retained by reference.
XYZ is metres, positive-down Z; MD is non-negative and strictly increasing.
Inclination is degrees from down vertical in `[0,180]`, azimuth is clockwise
from reference north in `[0,360)`. At least two aligned stations are required.
No geometric consistency or survey calculation is inferred from supplied
columns. Logs may sample independent MD grids; the host associates `wellId`
with a trajectory and enforces its depth interval. Missing samples use an
explicit finite sentinel, `"nan"`, or `nullValue: null` for no missing values.
Numeric sentinels must be exactly representable in the values column's float
type so direct equality comparisons work. Infinities are always rejected.

`wellboreTrajectorySchema`, `wellLogCurveSchema` and `blenderGeomHorizonSchema`
are JSON Schema 2020-12 transport definitions. JSON uses ordinary number arrays;
convert columns to typed arrays before runtime validation. When `nullValue`
is `"nan"`, convert JSON `null` samples to NaN explicitly rather than using
`Float32Array.from`'s null-to-zero coercion. Schemas cannot express aligned
lengths, strict MD ordering, affine invertibility or unique mappings; use the
runtime validators as well.

Blender inputs require `format: "glb" | "gltf"`, `source` (URL or blob URL),
and a 16-entry **column-major** invertible affine `meshToWorld`. Exported glTF
is Y-up; explicitly map it into the declared metres/Z-down reference, including
origin and scale. Custom semantics start with `_`, e.g. `_POROSITY`; each mapping
declares `layer`, `shaderInput`, `itemSize` and numeric `domain`. Export vertex
attributes in Blender (not only material names or object metadata) and preserve
them through the glTF exporter. See the React geological loader for aliases.

Buffer reuse is zero-copy **on the CPU**, not a promise of zero-copy CPU-to-GPU
memory: WebGL texture/buffer uploads still copy to device memory. Transfer an
ArrayBuffer to a Worker only when detaching all its views is safe; never
transfer a buffer still used by another log/trajectory. Treat validated buffers
as read-only and revalidate after mutation.

## Petrophysics contracts and analysis

`/contracts` exports `PetrophysicsWell`, `PetrophysicsLogCurve`,
`PetrophysicsZone`, `PetrophysicsFormationTop`, `PetrophysicsCorePoint`,
`PetrophysicsTrackSpec`, `PetrophysicsTrackTemplate`,
`PetrophysicsCoreMeasurement`, `petrophysicsWellSchema`,
`petrophysicsTrackTemplateSchema`, `validatePetrophysicsWell`,
`validatePetrophysicsTrackTemplate` and `petrophysicsValueAt`. The analysis
helpers include `pairPetrophysicsCurves`, `petrophysicsHistogram`,
`petrophysicsHistogramDepthRange`, `summarizePetrophysicsZones` and
`flattenPetrophysicsWells`.

Every well explicitly declares measured depth (`kind: "MD"`, `unit: "m"`)
and a datum. Every curve has a stable ID, mnemonic, name, value unit,
strictly-increasing Float32/Float64 MD column, matching raw-value column,
and a `nullValue` policy. Numeric sentinels such as `-999.25` stay in the
host's buffer and are read as unknown via `petrophysicsValueAt`; `"nan"`
permits NaN only, while `null` means the typed values contain no missing
samples. Buffers are retained by reference. Runtime validation checks sample
alignment, depth order, sentinel representability and well/datum agreement.

Zones, formation tops and core points are host-provided annotations with
stable IDs and explicit MD positions. Their presence does not imply the SDK
derived them from logs. `PetrophysicsTrackSpec` supplies display domains,
colors, optional fill side and explicit visual cutoff rules; a cutoff is not
an interpretation formula. `petrophysicsWellSchema` is a JSON transport
schema, not a typed-array runtime parser. Convert incoming arrays to typed
columns and normalize JSON null entries to the declared sentinel or NaN
policy before runtime validation.

Crossplots pair only samples with exactly equal MD keys. Unmatched depths and
null samples are omitted; no resampling or interpolation occurs.
Core also provides explicit, parameterized calculation functions:
`calculateArchieWaterSaturation` evaluates
`Sw = (a * Rw / (Rt * phi^m))^(1/n)` from v/v porosity and true formation
resistivity in ohm.m. The caller supplies Archie `a`, `m`, `n`, and `Rw`
already corrected to formation temperature. Values above one remain unclamped
and are marked `out-of-range`.

`calculateSchlumbergerMN` evaluates the classic Schlumberger M-N transforms
from neutron porosity (v/v), bulk density (g/cm3), and sonic slowness (us/ft),
with explicit matrix/fluid density and slowness. Both operations pair only
exact shared MD keys, do not interpolate gaps, and return per-sample quality
and reasons. `calculatedSeriesToCurve` and `schlumbergerMNToCurves` adapt
results to the existing log-curve views. These are transparent calculations,
not certified interpretations or lithology/fluid classifications; hosts must
select and disclose appropriate formation parameters and assumptions.
`petrophysicsHistogram` excludes values resolved as unknown and validates its
bin count. `petrophysicsHistogramDepthRange` resolves the source MD extent of a
bin, including constant-valued curves and single-sample bins. Zone summaries
expose their complete assumptions: arithmetic mean
over reported samples in `[top, base)`, plus sampled gross and net interval
thickness. Thickness includes only adjacent, reported endpoint samples fully
inside the zone and no farther apart than the host-specified maximum sample
gap. Both endpoints must pass the specified cutoff for net thickness. It does
not interpolate cutoff crossings or bridge null/large gaps. The resulting
net-to-gross is based on sampled intervals, not a geological interpretation.

Core measurements are optional, typed numeric observations with explicit
mnemonic, unit, stable measurement ID and `null` for unreported values.
Track templates are JSON-serializable view configuration; validation checks
their shape and track rules. The SDK does not save them. The host owns
persistence.

`flattenPetrophysicsWells` requires the same stable top ID in each well and
matching MD unit/depth datum. It returns display-only relative-MD columns
(`source MD - tied marker MD`) and retains the original curve value columns by
reference. It rejects absent ties rather than inventing them. The
`/petrophysics/` showcase composes the log, exact-depth NPHI/RHOB crossplot,
Gamma-ray histogram, cutoff zone summary, core measurements, JSON track
templates and two explicitly synthetic marker-tied wells. Brushes update the
shared depth range; no curve buffers enter interaction state.

## Declarative well reports

`/contracts` exports `WellReportSpec`, its section/value/source types, the
`wellReportSectionKinds` list, and `validateWellReportSpec`. A report is a
JSON-compatible view model, not a storage format: it carries well identity,
datum and reference elevation, provenance, sources, and one section for each
summary, trajectory, casing, cement, completion, operations, logs, formation
tops, offsets, data coverage, provenance, assumptions and not-checked.
Unavailable sections use empty arrays and render as not reported; validation
does not derive values, fill gaps, or interpret missing records.

Table columns declare display-unit labels, cells preserve explicit `null`,
source references must resolve to the report's source list, and numeric MD
fields are named in metres. Trajectory stations carry MD, TVD, and paired
Easting/Northing values (or paired nulls) in their explicitly named frame;
the renderer does not reproject them. Trajectory and log samples require
strictly increasing MD; null log samples remain gaps. Unit strings are
metadata, not a dimensional compatibility checker or conversion engine. Other
displayed measures retain explicit units in their columns, so formation TVD
is not mistaken for MD. The React host owns screen linking and print/PDF
behavior; report persistence remains with the host. Optional `appendices`
retain complete source registers with their own stable IDs, explicit columns,
null values, and resolved source references. Survey stations can preserve
inclination, azimuth, source row and reported feet values alongside their
normalized metric MD/TVD and local coordinates.

## CRS and offline sandbox

`/crs` exports `geographicToWebMercator` and `webMercatorToGeographic`
(EPSG:4326 longitude/latitude degrees and EPSG:3857 metres), plus
`toLocalCoordinates` / `fromLocalCoordinates` for explicit projected-origin
rebasing before Float32 upload. Z passes through unchanged; these are not
vertical-datum, UTM or arbitrary EPSG transformations. Unsupported geographic
extents and non-finite inputs throw rather than silently clamp.

```ts
import { createMockTrajectory, createMockLogCurve, createMockSeismicCube }
  from '@ikhmalputra/subsurface-core/sandbox';

const path = createMockTrajectory({ id: 'prototype', stations: 128, seed: 42 });
const porosity = createMockLogCurve(path, { seed: 42 });
const cube = createMockSeismicCube({ dimensions: [32, 32, 32], seed: 42 });
const bytes = createMockSeismicCube({ dimensions: [32, 32, 32], seed: 42, sampleType: 'uint8' });
```

The sandbox is opt-in, dependency-free and offline. Its deterministic seismic
data uses 3D smooth **value noise**, tilted reflectors and a synthetic fault
offset, not a scientific seismic model or Perlin/Simplex implementation.
Cubes are limited to 4,194,304 voxels (16 MiB of Float32 samples); trajectories
to 100,000 stations and 100,000 m MD. Seeds are unsigned 32-bit integers.
Generated porosity shares the trajectory's MD buffer. These generic contracts
are not automatically adapted to the existing int8, azimuth-aligned renderer.
Float32 is the default. Uint8 samples encode the same amplitudes using header
scale `2/255` and offset `-1`, with a maximum quantization error of `1/255`.

## Parser-independent visual contracts

```ts
import {
  validateWellPath, validateSeismicVolume, seismicVolumeFromBuffer,
  wellPathSchema, seismicVolumeHeaderSchema, ContractValidationError,
} from '@ikhmalputra/subsurface-core/contracts';

const well = validateWellPath({
  version: 1,
  id: 'my-well',
  reference: { units: 'm', crs: 'EPSG:32612', depthDatum: 'RKB' },
  points: [[332800, 4260700, 0], [332850, 4260750, 100]],
  measuredDepthsM: [0, 130],
  logs: [{ id: 'porosity', unit: '%', depthsMdM: [0, 130], values: [12, null] }],
});

const header = {
  version: 1, id: 'my-volume',
  reference: { units: 'm', crs: 'EPSG:32612', depthDatum: 'RKB' },
  dimensions: [2, 2, 2],
  bounds: { xMin: 332700, xMax: 332900, yMin: 4260600, yMax: 4260800, zMin: 0, zMax: 200 },
  sampleType: 'float32', byteOrder: 'little-endian', layout: 'x-fastest',
  amplitude: { scale: 1, offset: 0, unit: 'relative amplitude' },
};
const volume = validateSeismicVolume(header, new Float32Array(8));
// Or pass raw bytes supplied by your own loader (no SEG-Y headers):
const decoded = seismicVolumeFromBuffer(header, new ArrayBuffer(8 * 4));
```

- `WellPathInput` is JSON: each point is `[X, Y, Depth]`. X is easting or
  local X, Y is northing or local Y, and Depth is positive down from the named
  datum. All spatial and measured depths use metres. CRS and datum are
  required descriptions, not automatic coordinate transformations.
- Supply explicit `measuredDepthsM`, one per point, strictly increasing and
  non-negative. Depth/Z need not increase: horizontal or upward segments are
  valid. These are supplied spatial paths, not directional survey stations;
  validators do not calculate inclination, azimuth or enforce MD/chord geometry.
- Logs have unique IDs, explicit units, strictly increasing MDs inside the path
  interval, and one finite value or `null` per MD. `logs: []` is valid.
  Missing values are not interpolated or replaced.
- Seismic dimensions are `[nx, ny, nz]`, each a positive safe integer. Bounds
  are finite voxel **cell edges**, with min < max on every axis. A voxel centre
  is `min + (index + 0.5) * (max - min) / count`.
- Storage is `data[(z * ny + y) * nx + x]`: X changes fastest, then Y, then Z.
  Indices increase toward each maximum; Z is depth in metres, not time.
  Raw `float32` bytes are IEEE-754 little-endian; `uint8` uses one byte per
  voxel. Payload length must match exactly, with no binary header or padding.
- Physical amplitude is `sample * scale + offset`; scale must be finite and
  non-zero, offset finite, and all decoded amplitudes finite. Use scale/offset
  to represent signed amplitudes stored as uint8.
- Runtime validators accept `unknown`, reject missing/extra fields, wrong
  types, non-finite numbers and cross-field inconsistencies, and throw
  `ContractValidationError` with `issues: [{ path, message }]` at the first
  invalid field. There is no coercion or inferred metadata.
- `wellPathSchema` and `seismicVolumeHeaderSchema` are JSON Schema 2020-12
  objects; serialize them for non-TypeScript consumers. JSON Schema validates
  structure; **also use the runtime validators** for ordering, equal array
  lengths, unique log IDs, interval bounds, min/max relationships and binary
  lengths/types.
- Validation copies JSON metadata but not typed voxel storage. Treat the
  returned arrays as read-only; revalidate after changing input buffers.
  Float32 raw decoding allocates a decoded array; uint8 wraps the buffer.
  Hosts should enforce their own byte/voxel budgets before allocating buffers.
- These contracts are additive core APIs. They do not change existing
  `WellDesign`, SEG-Y parsers or the renderer's specialized int8,
  azimuth-aligned `SceneSeismicVolume`. Rendering adapters and file-loading UI
  are separate roadmap work; the contract API does not upload data.

```ts
import { forgeDesign, sProfileDesign, researchDesign, getWellComponents, wellComponentsToAssembly, validateAssembly } from '@ikhmalputra/subsurface-core';

const components = getWellComponents(forgeDesign);       // records with depths, sizes and sources
const assembly = wellComponentsToAssembly(components);  // feed AssemblySchematic / AssemblyScene
validateAssembly(assembly);                              // placement and host-rule issues
```

- `forgeDesign` is the observed Utah FORGE 16A(78)-32 survey (422 stations)
  with report-cited construction records. Unknown dimensions remain null and are
  never filled from the synthetic generator.
- `sProfileDesign` and `researchDesign` are labelled synthetic fixtures generated
  by `tools/survey/generate.py` (welleng) and cross-checked against this
  package's minimum curvature in the tests.
- Internal coordinates are metres; original report feet and survey US feet are
  preserved separately.

## Linked interaction dataset

`/contracts` also exports `InteractionDataset`, `DatasetKey`,
`InteractionDatasetColumn`, `validateInteractionDataset` and
`interactionDatasetSchema`. A dataset has a stable dataset/asset identity,
ordered stable sample IDs, one explicit key semantic, aligned typed value
columns, and optional spatial points with a declared `SpatialReference`.
Validation retains the host's typed-array buffers; these remain host-owned and
must be treated as immutable while a view consumes them. GPU upload is still a
copy to device memory.

```ts
import {
  validateInteractionDataset,
  type InteractionDataset,
} from '@ikhmalputra/subsurface-core/contracts';

const observations: InteractionDataset = validateInteractionDataset({
  version: 1,
  id: 'well-a-porosity',
  assetId: 'asset:well-a',
  wellId: 'well-a',
  key: { kind: 'depth', unit: 'm', reference: 'MD' },
  sampleIds: ['sample-a', 'sample-b'],
  keyValues: new Float64Array([1200, 1201]),
  columns: [{
    id: 'porosity',
    label: 'Porosity',
    unit: 'v/v',
    values: new Float32Array([0.18, Number.NaN]),
    nullValue: 'nan',
  }],
  reference: { units: 'm', crs: 'EPSG:32612', depthDatum: 'RKB' },
  spatialXYZ: new Float64Array([332800, 4260700, 1200, 332801, 4260702, 1201]),
});
```

Depth keys are non-negative, strictly increasing measured depth in metres.
Time keys are strictly increasing safe UTC Unix epoch milliseconds, never
local-time strings or a depth value with a different label. Index keys are
strictly increasing safe integer sample indices. Every value column uses its
own explicit unit and missing-value policy; for `"nan"` values, JSON transport
uses `null` and the host converts those cells to `NaN` before validation.
Spatial points are optional flat XYZ triples; they require a matching metre
reference and must already be in the host's chosen shared frame before a
spatial pick is published.

### View/domain extension contract

Third-party views should accept validated contracts and an optional
instance-scoped `SubsurfaceStore`. Keep data buffers in host-owned contracts;
publish only stable IDs, small ranges, camera/slice values, and explicit
coordinates. Use source labels for user actions, subscribe with
`subscribeSelector` or typed `on` events, ignore your own source when applying
state, and always dispose subscriptions with the view lifecycle. A subscriber
applies state; it must not synchronously publish a different state from its
notification callback.

Before linking frames, the host must register and apply validated transforms
with `CoordinateFrameRegistry`; the store does not infer CRS, unit, axis
direction, or datum conversions. Depth is explicitly MD in metres and time is
UTC epoch milliseconds in interaction datasets. Preserve unknown values as
null/sentinels, show their absence, and label synthetic data. New public
contracts and views should ship with runtime validation, actual-value tests,
an example route, docs, and a stated acceptance criterion. Existing package
entry points remain additive compatibility boundaries.

## Operational records

```ts
import { forgeOperations, sectionAtDepth, runsInInterval, daysVsDepth, parseLas, lasCurve } from '@ikhmalputra/subsurface-core/records';

forgeOperations.days;                       // 76 daily reports: MD, footage, MW, headline, activities, page
forgeOperations.runs;                       // 54 BHA/service runs: interval, footage, ROP, outcome, page
sectionAtDepth(forgeOperations, 3000);      // intermediate 12 1/4 in section -> holeComponentId
runsInInterval(forgeOperations, 5113, 6000);
const las = parseLas(text);                 // LAS 2.0 (unwrapped); NULL values become null
lasCurve(las, 'ROP');
```

`WellOperations` is a plain typed object, so you can supply your own records.
See [the FORGE source record](../../docs/FORGE_SOURCE_RECORD.md) for provenance.

## Seismic (SEG-Y)

```ts
import { parseSegy, segyTrace, amplitudeClip, seismicImage, projectOntoSection, tvdToSeismicDepth, seismicDepthToTvd, wellPointAtMd, wellMdAtDepth, forgeSeismicSection, forgePsdmVolumeLayout } from '@ikhmalputra/subsurface-core/seismic';

const file = parseSegy(await (await fetch(url)).arrayBuffer());
file.textHeader;            // 40 EBCDIC/ASCII card images
file.binary;                // sample interval, count, format, revision, units, …
file.traces[0];             // inline, crossline, CDP, scaled X/Y, shotpoint
segyTrace(file, 0);         // Float32Array samples (IBM, IEEE, int32/16/8 decoded)
parseSegy(buffer, { layout: forgePsdmVolumeLayout });   // non-standard header bytes
const z = tvdToSeismicDepth(tvdM, rkbElevationM, 1800);
const path = projectOntoSection(stations, { originEastingM, originNorthingM, azimuthDeg });
wellPointAtMd(path, 1500);  // { mdM, alongM, depthM } interpolated on the section
wellMdAtDepth(path, 2000);  // first MD where the well reaches that section depth (or null)
seismicImage(file, { colorMap: 'red-blue', clip });   // RGBA pixels (trace × sample), no DOM needed
seismicDepthToTvd(z, rkbElevationM, 1800);            // inverse of tvdToSeismicDepth
```

Byte order is detected from the format code. Fixed-length traces only; trace
headers beyond geometry are not decoded.

## Trajectory (minimum curvature)

```ts
import { computeMinimumCurvature, summarizeTrajectory, planBuildHold, designWithTrajectory } from '@ikhmalputra/subsurface-core/trajectory';

const survey = computeMinimumCurvature([
  { mdM: 0, inclinationDeg: 0, azimuthDeg: 0 },
  { mdM: 500, inclinationDeg: 0, azimuthDeg: 0 },
  { mdM: 800, inclinationDeg: 18, azimuthDeg: 45 },
]); // TVD, north, east, dogleg and DLS (°/30 m) per station
const summary = summarizeTrajectory(survey, { verticalSectionAzimuthDeg: 45 });
const plan = planBuildHold({ kickoffMdM: 400, buildRateDegPer30m: 3, target: { tvdM: 2000, northingM: 300, eastingM: 900 } });
const edited = designWithTrajectory(sProfileDesign, plan.stations); // user-authored copy with the new path
```

- Minimum curvature (SPE/ISCWSA convention): inclination from vertical,
  azimuth clockwise from grid north, DLS in °/30 m. Reproduces the published
  FORGE 16A(78)-32 survey to within 3 mm over 422 stations (`surveyConsistency`).
- `validateSurveyStations` rejects non-increasing MD and out-of-range angles
  (errors) and flags DLS over a limit (warnings); `computeMinimumCurvature`
  throws `RangeError` on errors.
- `planBuildHold` solves the hold inclination and azimuth that hit a target
  exactly from a kickoff point and build rate, or reports why it is unreachable.
- `interpolateSurveyPoint` and `surveyPointAtMd` interpolate along the arc,
  not linearly.

## Well design (data first)

What a well design actually needs, how it is checked, and how it becomes an
assembly. Every function is pure and independent.

```ts
import { exampleWellBrief, designReadiness, proposeCasingScheme, analyzeSection, validateDesign, maximumSurfacePressure, designToAssembly } from '@ikhmalputra/subsurface-core/well-design';

const brief = exampleWellBrief();            // identity, location, datum, geology, pressures, trajectory, casing, cement, completion
designReadiness(brief);                      // which inputs are present, missing or need attention, and why each matters
const sections = proposeCasingScheme(brief); // seats from the pore/frac window (trip 0.03, kick 0.06 SG), cheapest passing weight × grade
analyzeSection({ ...brief, sections }, 2);   // burst/collapse/tension loads and safety factors, clearance, drift, cement volume & ECD
validateDesign(brief);                       // DesignIssue[] across casing, cement, completion and MASP
maximumSurfacePressure(brief);               // gas-to-surface MASP and the API 6A wellhead class
designToAssembly(brief);                     // WellAssembly for the plug-and-play builder
```

| Stage | Inputs | Drives |
| --- | --- | --- |
| Identity | name, operator, purpose, field | naming, permits |
| Location & datum | coordinates, CRS, onshore/offshore, water depth, RKB/ground elevation | conductor, depth references |
| Geology & pressure | formation tops, lithology, reservoir/hazards, pore & fracture gradient (SG vs TVD), temperature | every load case, casing seats |
| Trajectory | survey or build-and-hold plan, TD | TVD for all pressures |
| Casing | role, hole, OD, weight, grade, top, shoe, mud weight | burst, collapse, tension, window, clearance |
| Cement | TOC, lead/tail density, tail length, excess | volumes, losses, zonal isolation |
| Completion | tubing, packer, safety valve, lift, perforations | barrier envelope, MASP |

- Pipe ratings follow API TR 5C3: Barlow burst at 87.5% wall, four-regime
  collapse (yield, plastic, transition, elastic) and pipe-body yield. Tests
  reproduce published ratings (for example 9-5/8" 47# N80 = 6,870 psi burst,
  4,750 psi collapse) within 0.5%.
- Default design factors: burst 1.1, collapse 1.0, tension 1.6 (`DesignFactors`).
- Burst: gas to surface, limited to fracture at the shoe for non-production
  strings, seawater backup. Collapse: full evacuation. Tension: buoyed weight.
- Ratings are derated for temperature at the string (yield −0.054 % per °C
  above 20 °C, `YIELD_DERATING_PER_C`) and casing wear; collapse is biaxial (API 5C3 ellipse under the
  buoyed axial load). Kick tolerance (IADC volume method) is checked at each
  shoe for the next hole. Sour-service grade rules apply when H2S is known.
- Every pressure point, integrity test, temperature and fluid input carries a
  source: `measured`, `offset`, `interpreted` or `assumed`. Readiness only
  counts a profile as calibrated when part of it is measured, from an offset or
  backed by a FIT/LOT, and `designCoverage(brief)` lists what was checked, what
  was assumed to check it, and what was not checked at all.
- Engineering screening only; it does not replace a qualified well design.

## Offset wells (reuse previous designs)

```ts
import { forgeOffsetWell, offsetFromBrief, compareWells, adoptOffsetDesign, newWellBesideOffset } from '@ikhmalputra/subsurface-core/offset-wells';

compareWells(brief, forgeOffsetWell);   // 9 weighted factors (distance, environment, depth, pressure, temperature,
                                        // stratigraphy, hazards, profile, purpose); missing or assumed data scores nothing
const { brief: next, changes, issues, failingSections } =
  adoptOffsetDesign(brief, forgeOffsetWell, { geology: true, casing: true, completion: true });
newWellBesideOffset(forgeOffsetWell, { name: 'Pad well 2' }); // same pad, datum and geology; vertical to the offset TD
offsetFromBrief(myFinishedBrief);       // save your own design as an offset for the next well
```

`forgeOffsetWell` is Utah FORGE 16A(78)-32 transcribed from the cited
operator reports: casing, shoes, mud used, both FITs, the seepage at the
granodiorite contact, the BHT, the cement jobs and the failed XLOT runs, each
with its page. Pore pressure was not reported and is marked assumed. Adoption
moves depths to the new datum, maps shoes by formation, raises mud weight to
the new pore pressure where needed, logs every change and re-runs every check.


This is a planning aid, not anti-collision, uncertainty or a certified
directional-drilling package.

FORGE fixture data is adapted from McLennan et al. (2021), DOI
https://doi.org/10.15121/1776602, and Winkler, Swearingen and McLennan (2021),
Energy and Geoscience Institute, University of Utah, GDR 1296:
https://gdr.openei.org/submissions/1296. Source data is licensed CC BY 4.0:
https://creativecommons.org/licenses/by/4.0/. Adaptations are unit conversion,
station extraction, page-cited record transcription and approximate contact
projection. Original code is proprietary (see LICENSE). This is not an engineering solver,
complete equipment tally, manufacturer model or regulatory approval.