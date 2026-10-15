/**
 * What each entry point is for, in one line. The export lists beside them are generated
 * (sdk-exports.json); test/developers.test.ts fails if an entry point has no line here or a line
 * names an entry point that no longer exists.
 */
export const ENTRY_NOTES: Readonly<Record<string, string>> = {
  "@ikhmalputra/subsurface-core": "Everything framework-free in one import: well records, the FORGE and Equator fixtures, the assembly catalogue, trajectory, well design, petrophysics, geomechanics, decline curves and units.",
  "@ikhmalputra/subsurface-core/assembly": "The component catalogue and a well's assembly: place, move and remove parts, check placements, find the strings at a depth.",
  "@ikhmalputra/subsurface-core/contracts": "Validators for untrusted input (well paths, seismic volumes, petrophysics wells, production documents) and the petrophysics calculations: Vsh, porosity, Archie, M–N, net pay.",
  "@ikhmalputra/subsurface-core/crs": "Geographic, Web Mercator and local grid coordinates, converted explicitly.",
  "@ikhmalputra/subsurface-core/dataset": "The linked interaction dataset: one table of observations keyed by depth or time, with its validator.",
  "@ikhmalputra/subsurface-core/frames": "A registry of named coordinate frames, so a transform is always between two frames you declared.",
  "@ikhmalputra/subsurface-core/gis": "GeoJSON and GeoTIFF import, reprojection between WGS84, Web Mercator and UTM, distances and areas.",
  "@ikhmalputra/subsurface-core/hydraulics": "Bit hydraulics, total flow area and annular velocity, with values that cannot be computed marked as such.",
  "@ikhmalputra/subsurface-core/known": "Values that may be unknown: reported, derived or absent with a reason, combined without inventing anything.",
  "@ikhmalputra/subsurface-core/offset-wells": "Score an offset well against a new one, adopt its casing, geology and completion, and see what changed and what fails.",
  "@ikhmalputra/subsurface-core/records": "Operational history: daily reports, BHA and service runs, hole sections, days vs depth, the well as of a date, and a LAS 2.0 parser.",
  "@ikhmalputra/subsurface-core/sandbox": "Mock trajectories, log curves and seismic cubes for tests and demos, labelled synthetic.",
  "@ikhmalputra/subsurface-core/seismic": "SEG-Y parsing (IBM and IEEE floats, integers), traces, amplitude clipping, section images and well projection onto a section.",
  "@ikhmalputra/subsurface-core/state": "The interaction store: one well, depth, pick, slice and camera per workspace, with sources on every change and undo history.",
  "@ikhmalputra/subsurface-core/state-url": "Deep links: write the store to the URL and read it back, with your own validation.",
  "@ikhmalputra/subsurface-core/trajectory": "Minimum curvature, survey validation, build-and-hold planning, interpolation along the arc and trajectory summaries.",
  "@ikhmalputra/subsurface-core/units": "Typed quantities for length, pressure, density and time, with explicit conversions: feet, psi, ppg, SG, bar.",
  "@ikhmalputra/subsurface-core/well-design": "The design brief and its checks: pore and fracture window, casing proposal, API TR 5C3 ratings, burst, collapse, tension, kick tolerance, cement and MASP.",
  "@ikhmalputra/subsurface-react": "The interactive viewport, depth linking, info tips and the site adapters that turn FORGE, Equator or your design into map and scene inputs.",
  "@ikhmalputra/subsurface-react/2d": "Depth views without three.js: the well section, construction schematics, log tracks, trajectory plots, the seismic section and petrophysics views.",
  "@ikhmalputra/subsurface-react/3d": "three.js scenes on WebGPU with a WebGL 2 fallback: the site with seismic and horizons, a well in its rock, and the construction cutaway.",
  "@ikhmalputra/subsurface-react/assembly-three": "The construction cutaway on its own, for a page that needs only that scene.",
  "@ikhmalputra/subsurface-react/gis": "The offline globe: located wells, paths in plan, seismic footprints and section lines, with no third-party tiles.",
  "@ikhmalputra/subsurface-react/records": "Operational views: well history, days vs depth, service runs, hole sections and log tracks.",
  "@ikhmalputra/subsurface-react/seismic": "The seismic section with wells projected onto it, and the SEG-Y header panel.",
  "@ikhmalputra/subsurface-react/state": "React bindings for the store: selectors that re-render on one slice, the depth link, and depth conversion between records.",
  "@ikhmalputra/subsurface-react/three": "The single-well scene on its own, as the module's default export.",
  "@ikhmalputra/subsurface-react/trajectory": "Plan view, vertical section and the inclination, azimuth and dogleg log, at true scale with a draggable target.",
  "@ikhmalputra/subsurface-react/ui": "The command button and icon the views use, for toolbars that match them.",
  "@ikhmalputra/subsurface-react/viewport": "The pan-and-zoom viewport the 2D views sit in.",
};
