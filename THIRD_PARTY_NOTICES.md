# Third-party notices

Original code and synthetic Blender asset: MIT, Ikhmal Putra Manan.
No F3 data, PPDM schemas or documentation are bundled.

The bundled `forge-data.json` fixture is adapted from Utah FORGE public records,
licensed CC BY 4.0, https://creativecommons.org/licenses/by/4.0/:

- McLennan et al. (2021), Utah FORGE Well 16A(78)-32 drilling data, Energy and
	Geoscience Institute, University of Utah, DOI 10.15121/1776602, GDR 1283:
	https://gdr.openei.org/submissions/1283.
- Duane Winkler, Leroy Swearingen and John McLennan (March 2021), Drilling Summary
	of the Utah FORGE Well 16A(78)-32, GDR 1296:
	https://gdr.openei.org/submissions/1296.

Changes: XLSX station extraction, explicit unit conversion, report-page record
transcription and approximate sediment/granite contact projection. No endorsement
by the authors or University is implied. The fixture data is not relicensed MIT.
Source hashes, provenance and attribution remain in the distributed JSON and
core package README; see docs/FORGE_SOURCE_RECORD.md for evidence boundaries.

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