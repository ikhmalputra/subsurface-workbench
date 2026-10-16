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

The offline world basemap `packages/react/assets/gis/world-50m.json` is built by
`tools/build-world.mjs` from Natural Earth 1:50m land and country boundaries
(public domain, https://www.naturalearthdata.com/), as packaged in world-atlas
2.0.2 (ISC). Coordinates are rounded to 0.001°. Country boundaries are Natural
Earth's de facto lines and carry no position on disputed borders.

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