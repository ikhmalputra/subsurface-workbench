# Third-party notices

Original code and synthetic Blender assets: proprietary, © 2026 Ikhmal Putra Manan, all rights reserved (see LICENSE). The notices below are for third-party software and data, which keep their own licences.
No F3 data, PPDM schemas or documentation are bundled.

The bundled FORGE fixtures are adapted from Utah FORGE public records,
licensed CC BY 4.0, https://creativecommons.org/licenses/by/4.0/:

- McLennan et al. (2021), Utah FORGE Well 16A(78)-32 drilling data, Energy and
	Geoscience Institute, University of Utah, DOI 10.15121/1776602, GDR 1283:
	https://gdr.openei.org/submissions/1283.
- Duane Winkler, Leroy Swearingen and John McLennan (March 2021), Drilling Summary
	of the Utah FORGE Well 16A(78)-32, GDR 1296:
	https://gdr.openei.org/submissions/1296.

- Bill Gilmour, Joseph Wooden, Fred Pulka, Brett Rose (Horizon Well Logging),
	Clifton Barker (Sanvean Technologies) and Erik Borchardt (Schlumberger),
	Utah FORGE: Well 16A(78)-32 Logs (2021), DOI 10.15121/1777912, GDR 1292:
	https://gdr.openei.org/submissions/1292. Adapted as
	`packages/fixtures/data/forge-16a-openhole-1ft.las`: selected curves binned to
	1 ft means, neutron porosity converted from percent to fraction.

- John McLennan et al. (2023), Utah FORGE: Well 16B(78)-32 Drilling Data,
	DOI 10.15121/1998591, GDR 1516: https://gdr.openei.org/submissions/1516.
- Greg Nash and Joe Moore (2018), Utah FORGE: Logs and Data from Deep Well 58-32
	(MU-ESW1), DOI 10.15121/1452735, GDR 1006: https://gdr.openei.org/submissions/1006.
- Ben Erickson, Utah Geological Survey (2021), Utah FORGE: Updated Well, Well Pad,
	and Seismic Station GPS Coordinates, DOI 10.15121/1838418, GDR 1358:
	https://gdr.openei.org/submissions/1358. Adapted with GDR 1516 and 1006 as
	`packages/core/src/forge-offset-wells.json`: survey stations as reported (the
	58-32 table transcribed from its PDF report), GPS wellheads.

- The daily drilling reports of 16A(78)-32 (GDR 1283, above) are also adapted as
	`packages/core/src/forge-string-weights.json`: string weights, torque, mud weight
	and BHA per day, as reported.
- The 58-32 logs of GDR 1006 (above) are also adapted as
	`packages/fixtures/data/forge-58-32-tie.json` by `tools/build-forge-tie.mjs`: compressional slowness
	from `D5RL-00187_University of  Utah_ME-ESW1_Run1_DSI Sonic.las` (SHA-256
	30cbc94a3596b6ccb061398fbb832793012795b360d5a452210696adf719e3ad) and bulk density, gamma ray and
	caliper from `58-32_logs.zip :: D5RL-00187_University of Utah_ME-ESW1_Run2_TCOM_Main.las` (SHA-256
	b3edbb093648df2dd8d66cc8bdf46017e50d7dfc8ec8c01bbe7b307af4feb97b), retrieved 17 Oct 2026, averaged
	into 0.5 m MD bins with readings outside physical ranges (cycle skips, casing) left out.
- John McLennan (2018), Utah FORGE: Stress Logging Data, DOI 10.15121/1452760,
	GDR 1032: https://gdr.openei.org/submissions/1032. Adapted as
	`packages/core/src/forge-58-32-stress.json`: the calibrated SHmax, Shmin and Sv
	profile binned to 5 ft means.
- Licensed as-built wellheads of 16A(78)-32 and 16B(78)-32 (Woolsey Land Surveying,
	2023), published in GDR 1283 and 1516; the 58-32 KB and ground elevations from
	the header of its DSI sonic LAS (GDR 1006). Position covariances in
	`packages/core/src/forge-survey-uncertainty.json` are computed offline with welleng
	0.29.1 (Apache-2.0) from the ISCWSA OWSG generic tool models it ships.

Changes: XLSX station extraction, explicit unit conversion, report-page record
transcription and approximate sediment/granite contact projection. No endorsement
by the authors or University is implied. The fixture data keeps its own licence and is not relicensed.
Source hashes, provenance and attribution remain in the distributed JSON and
core package README; see docs/FORGE_SOURCE_RECORD.md for evidence boundaries.

The bundled `packages/fixtures/data/sodir-field-production.json` holds the monthly
net production of every field on the Norwegian continental shelf from the Norwegian
Offshore Directorate (Sodir) FactPages, table field_production_monthly, retrieved
15 Oct 2026 (SHA-256 583818227ca0a3d073d77fcf65553c0b2098aa8f0fa80900b9f48972ca8280f9),
used under the Norwegian Licence for Open Government Data (NLOD); the FactPages do
not state the licence version. Source: Sodir, https://factpages.sodir.no. Changes:
regrouped by field; no value altered.

The bundled `packages/fixtures/data/force2020/` (one `wells.json` and one `.i16`
log file per well) is adapted from Peter Bormann, Peder Aursand, Fahad Dilib,
Surrender Manral and Peter Dischington (2020), FORCE 2020 Well well log and
lithofacies dataset for machine learning competition, Zenodo,
DOI 10.5281/zenodo.4351156, licensed CC BY 4.0,
https://creativecommons.org/licenses/by/4.0/. Its logs, lithostratigraphic tops and
casing depths are the Norwegian Offshore Directorate's, under the Norwegian Licence
for Open Government Data (NLOD 2.0); its lithology is the competition's
interpretation. Files used, retrieved 16 Oct 2026 (SHA-256): train.zip
e996c8466f2d0dc7116daa71485cc90c31fcfac6345a5bb33165026478b642e9,
leaderboard_test_features.csv 4688d93728feab7e86855b9315ddfc8b498387927954235f7dbbfa2216550781,
leaderboard_test_target.csv 4fe5e59809d98eb9b8b0a3836776bd52e5c7e63ffefa31476fa17011a27ef382 and
hidden_test.csv c75e817bfefcabd2bacdefd9e1c74dbd829d24543646bf0b85ef8fbf5c06f069 (the same
wells as the record's LAS files, from the competition repository
github.com/bolgebrygg/Force-2020-Machine-Learning-competition), and the record's
NPD_Lithostratigraphy_groups_all_wells.xlsx f0be5f3061aa0e63b8692f71264635ccb7d52cb148b00beaf7a59cd495c49025,
NPD_Lithostratigraphy_member_formations_all_wells.xlsx 2dd953073c459db341e6cf3243a9dbfa5a46b4bb567dddcaec2a1db4e5879518 and
NPD_Casing_depth_most_wells.xlsx d36564dd821f892c58f35d1ef86fe4ca68422e133d1b9cc14cc1deb32461aeb6.
Changes (tools/build-force2020.mjs): logs averaged into 0.5 m MD bins and quantised to
16 bits per curve (resistivity in log10), lithology as the most common class per bin,
paths kept every 50 m MD, ED50 / UTM 31N positions converted to WGS84 with the EPSG
three-parameter shift, rig floor elevation derived from MD and TVDSS. No endorsement
by the authors, FORCE or the Directorate is implied.

The offline world basemap `packages/react/assets/gis/world-50m.json` is built by
`tools/build-world.mjs` from Natural Earth 1:50m land and country boundaries
(public domain, https://www.naturalearthdata.com/), as packaged in world-atlas
2.0.2 (ISC). Coordinates are rounded to 0.001°. Country boundaries are Natural
Earth's de facto lines and carry no position on disputed borders.

The globe's imagery `packages/react/assets/gis/world-imagery.jpg` is NASA's Blue
Marble Next Generation, December 2004 with topography and bathymetry (Reto Stöckli,
NASA Earth Observatory, public domain, https://visibleearth.nasa.gov/images/73909),
reprojected to Web Mercator at 4096 × 4096 by `tools/build-world-imagery.py`.

The FORGE ground `packages/fixtures/data/forge-terrain.*` is built by
`tools/build-forge-terrain.mjs` from the USGS 3D Elevation Program (3DEP) and the
USDA Farm Service Agency's National Agriculture Imagery Program (NAIP), both public
domain and fetched from The National Map image services in NAD83 / UTM 12N.
Elevation is resampled to a 10 m grid and kept in decimetres; the imagery is a
JPEG export of the same extent. No endorsement by NASA, USGS or USDA is implied.

Runtime packages include Next.js/React (MIT), D3 Scale (ISC), Lucide (ISC),
and IBM Plex font files (SIL Open Font License 1.1). Their full license notices
remain in the installed dependency packages; retain them when redistributing
bundles. Development tooling includes TypeScript and Playwright (Apache-2.0),
ESLint/typescript-eslint/parse5 (MIT), and axe-core (MPL-2.0).

This is a direct-dependency inventory, not a complete transitive license audit.
An SPDX inventory and notice aggregation remain release gates before publishing.

Optional offline survey generator: welleng 0.29.1 (Apache-2.0, Jonathan Corcutt),
https://github.com/jonnymaserati/welleng. It and its Python dependencies are not
shipped as browser runtimes. The generated synthetic station fixture is included;
the fixture is not a verified real-well survey or an engineering certification.

react-zoom-pan-pinch 4.2.0 (MIT) provides gesture navigation. Optional Three.js
0.186.1 (MIT) provides real WebGL orbit controls and display geometry. The reproduced
curved design credits Jonathan Corcutt's Apache-2.0 welleng example; S-profile
station values are an explicitly separate synthetic adaptation.

Offline GIS uses MapLibre GL JS 5.10.0 (BSD-3-Clause) and Proj4js 2.22.0
(MIT). MapLibre's CSP worker is copied into the demo's public GIS assets;
its embedded license banner is retained. Proj4 declaration compatibility
includes GeoTIFF.js 3.0.5 (MIT), and GeoJSON types 7946.0.16 are MIT.
Full notices remain in installed dependency packages. No third-party basemap
imagery, terrain or geocoded well positions are bundled.