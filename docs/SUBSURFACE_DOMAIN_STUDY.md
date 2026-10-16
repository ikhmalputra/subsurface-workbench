# Subsurface domain study — what the deck has, what overlaps, what to build next

Rewritten 15 Oct 2026, after phase 3 of [the rebuild](REBUILD_PLAN.md) and a redundancy cleanup.
The rule that decides every row: a tool runs on real records, on the user's own input, or on data
labelled synthetic; nothing is invented. So the order to build in is set by **which real, openly
licensed data exists**, not by which tool is most famous.

## 1. What the deck has today

| Sub-domain | Modules on the deck | Runs on |
| --- | --- | --- |
| Place | Globe, Site in 3D | FORGE (documented), Equator (synthetic), Kestrel A-7 (synthetic design) |
| Well and drilling | Well section, Well in 3D, Construction (straight or along the path), Cutaway, Plan view, Vertical section, Drilling record (days vs depth, hole sections, runs, daily reports), time rail | FORGE records; Kestrel design |
| Data | Logs, Seismic section | FORGE open-hole logs (GDR 1292), mud log and PSDM; Equator synthetic open-hole logs |
| Petrophysics | Petrophysics. Crystalline on FORGE: porosity three ways, spectral-gamma mineralogy (Th/K), FMI fracture intensity against resistivity, Vp/Vs and Poisson's ratio, data-quality flags. Clastic on Equator: Vsh linear/Larionov, density and density–neutron porosity, Archie, net pay, crossplot, core plugs | FORGE 16A(78)-32 wireline logs (documented); Equator synthetic logs |
| Engineering | Strings (recorded ratings on FORGE; live loads on Kestrel), Pressure window, Kick tolerance, Cement, Hydraulics, what-if with apply and undo | Kestrel design brief |

After the cleanup the code is two packages (`core`, `react`) and a data folder; every calculation
has one implementation in core.

## 2. Overlaps between modules (merged 15 Oct 2026)

| Overlap | Why it overlapped | What was done |
| --- | --- | --- |
| Site card · Globe · lens | The site list and facts were on the globe, in ⌘K and in the lens | Site module dropped. The globe chooses the site, ⌘K chooses sites and wells, the lens carries provenance; flying to a site opens and stages the site in 3D |
| Schematic · Curved construction | Two projections of the same construction records | One **Construction** module with a Straight / Along the path switch (remembered per browser); selection, cursor and issues carry across |
| Days vs depth · Hole sections · Runs · Daily history | Four readings of one drilling record | One **Drilling record** tile with four tabs and one set of links |
| String · Loads | String was one row of Loads, in detail | One **Strings** module: on a design, the loads table with the selected row's pipe and derating; on a drilled well, the recorded string and its API ratings |
| Well section · Construction | The section carries the construction as a track | Kept apart: the section is the multi-track depth view, Construction the drawing with exploded and detail modes |

The SDK lost the components only tests used (`GisMap` and its import tools, trajectory layer and
bathymetry; `OffshoreScene`; `SurveyTable`, `BuildHoldForm`, `TrajectorySummaryPanel`;
`ComponentPalette`) and 177 CSS rules that only they used.

## 3. What working teams use, by sub-domain

Practitioner context, from the commercial and open suites (Landmark EDT, SLB DrillPlan/Techlog,
Petrel, Geolog, IP, PROSPER/PIPESIM, MBAL). Each line names what the tool needs.

- **Drilling.** Trajectory and survey (stations, CRS, declination) — *built*. **Anti-collision**
  (ISCWSA error models, separation factor; offset surveys and survey tool codes). **Torque and
  drag** (soft-string; surveys, string, mud, friction; recorded hookload and torque to calibrate).
  **Hydraulics with rheology** (Bingham, power law, Herschel–Bulkley: ECD, annular losses,
  surge/swab; Fann readings). Casing design — *built* (screening). Tubular thermal loads (WellCat;
  temperature profiles).
- **Geology.** Correlation and tops. **Structure and isopach maps** (gridding tops at ≥ 3 wells).
  Faults and 3D grids. Facies.
- **Geophysics.** **Well tie / synthetic seismogram** (sonic, density, checkshot, wavelet). Horizon
  tracking. Time–depth conversion. Attributes (RMS, coherence). AVO and inversion.
- **Petrophysics.** Vsh, porosity, Archie — *built*. **Shaly-sand saturation** (Simandoux,
  Indonesia, dual water). **Permeability** (Timur, Coates, core poro-perm). **Pickett plot**.
  **Monte Carlo** on parameters.
- **Reservoir.** **Probabilistic volumetrics** (GRV × NTG × φ × (1−Sw) / Bo). **Decline curves**
  (Arps; rates by well). **Material balance** (p/z, Havlena–Odeh). **PVT correlations** (Standing,
  Vasquez–Beggs; z-factor).
- **Production.** **IPR and VLP, nodal analysis** (reservoir pressure, PI, tubing, PVT); gas-lift
  design.
- **Integrity.** **Barrier schematic** (NORSOK D-010 envelopes on the construction). Annulus
  pressure and MAASP. Cement evaluation (CBL/VDL, ultrasonic).
- **Geomechanics.** **1D mechanical earth model** (Sv from density; pore pressure by Eaton; Shmin
  from LOT/FIT; SHmax from breakouts). Wellbore-stability mud window.

## 4. Real, openly licensed data, and what each unlocks

| Dataset | Licence | Inside | Unlocks |
| --- | --- | --- | --- |
| **Utah FORGE** (GDR / OEDI) | CC BY 4.0 — commercial use with attribution | 16A(78)-32 wireline logs ([GDR 1292](https://gdr.openei.org/submissions/1292): GR, spectral density, neutron, induction resistivity, sonic, FMI, UBI, CBL, temperature; LAS/DLIS); 1 s and 10 s drilling data ([1283](https://gdr.openei.org/submissions/1283)); temperature surveys ([1421](https://gdr.openei.org/submissions/1421)); wells 58-32 ([1006](https://gdr.openei.org/submissions/1006)) and 16B(78)-32 ([1531](https://gdr.openei.org/submissions/1531), [1516](https://gdr.openei.org/submissions/1516)); field trajectories ([1440](https://gdr.openei.org/submissions/1440)); stress logging ([1032](https://gdr.openei.org/submissions/1032)) | Real petrophysics on FORGE; anti-collision across 16A, 16B, 58-32; torque and drag calibrated on 1 s hookload and torque; 1D MEM; thermal loads; cement evaluation |
| **FORCE 2020** ([Zenodo 4351156](https://zenodo.org/records/4351156)) | CC BY 4.0 (underlying data NLOD 2.0) | LAS for 118 Norwegian wells with labelled lithology, casing depths, tops | Correlation (*built*), logs and 3D on real North Sea wells (*built*); clastic petrophysics on real logs, facies |
| **Sodir FactPages** | NLOD 2.0 — commercial use with attribution | Wellbore headers and coordinates, tops, monthly production by field | Field decline curves, map layers |
| **BOEM Gulf of America** | US federal, normally public domain | Directional surveys for released wellbores; production by lease and well | Anti-collision at real pad density; decline curves |
| **Groningen** ([YoDa](https://public.yoda.uu.nl/geo/UU01/1QH0MW.html)) | CC BY 4.0 (to confirm on the record) | 371 wells, > 6,000 logs, tops, PSDM, faults, pressure data | Mapping, volumetrics, gas p/z material balance |
| **Equinor Volve** | Equinor Open Data Licence (CC BY-based; no selling; share-alike-like) | Logs for 24 wells, 3D/4D seismic, WITSML drilling, production 2008–2016 | Decline, material balance, well tie — needs a legal read before shipping |
| NLOG, KGS, F3, Teapot Dome | Terms unclear or availability unconfirmed | — | Not until the terms are confirmed |

## 5. Recommended next tools, in order

Each is a real tool on real data, with no overlap with what is built.

1. ~~**Real petrophysics on FORGE**~~ — *built* 15 Oct 2026 (see
   [the source record](FORGE_SOURCE_RECORD.md#open-hole-logs-petrophysics)).
2. ~~**Anti-collision**~~ — *built* 15 Oct 2026: centre-to-centre distance and the ISCWSA
   separation factor (ladder and travelling cylinder) from the 16B (GDR 1516) and 58-32 (GDR 1006)
   surveys, licensed as-built wellheads, and OWSG generic error models for each reported tool.
3. ~~**Torque and drag**~~ — *built* 15 Oct 2026: a soft-string model (Johancsik et al. 1984) on
   16A's survey, calibrated on the pick-up, slack-off and rotating weights of its daily reports
   (block weight, pipe weight, cased and open-hole friction). The Pason log in GDR 1283 turned out
   to be the 2022 re-entry; the 2020 1 s data (1.2 GB) was not fetched.
4. ~~**1D mechanical earth model**~~ — *built* 15 Oct 2026: 16A's IsoMechPro pore pressure, Sv and
   rock strength with horizontal stresses from 58-32's injection-calibrated profile (GDR 1032) or
   16A's own model; collapse and breakdown of the inclined hole for every SHmax azimuth, against the
   mud used and the oval hole seen.
5. ~~**Decline curves**~~ — *built* 15 Oct 2026: Arps (b 0–1, fitted in log rate) on any of the
   136 Norwegian fields' monthly production from Sodir (NLOD), with a draggable fit window, an
   economic limit, remaining volume and EUR. Field level only: Sodir publishes no per-well rates.
6. ~~**Barrier schematic**~~ — *built* 15 Oct 2026: primary and secondary envelopes on the
   construction, each element with its record and every missing record listed as a gap. FORGE
   follows the time rail (fluid column and BOP while drilling, production casing once completed);
   Kestrel A-7's design, drilling or producing. NORSOK D-010's idea, none of its tables.

7. ~~**Correlation**~~ — *built* 16 Oct 2026: the 118 FORCE 2020 wells in six quadrant areas,
   side by side on GR, resistivity, density–neutron or sonic and the competition's lithology;
   the Directorate's group and formation tops joined between neighbouring wells; hung on sea
   level or flattened on any top; the user's own picks beside the Directorate's, with the
   difference. The wells also open in Logs, Site in 3D (each group top triangulated between
   them), Plan view and Vertical section.

8. ~~**Well tie**~~ — *built* 17 Oct 2026, at FORGE 58-32 rather than 16A: 16A's open-hole logs
   start at 5,000 ft MD, below its granite top at 4,700 ft, while 58-32 has sonic (2,150–7,569 ft)
   and density across its contact and sits inside the PSDM sub-volume (894 m along the 16A section,
   197 m off it). Impedance, reflectivity, a sonic time–depth relation and a Ricker wavelet make the
   synthetic; the person drags it onto an event and Fit refines shift and stretch locally, because a
   wide search locks onto other cycles. Near the 1,225 m PSDM event: +57 m, 3% stretch, r 0.52.

Shaly-sand saturation, permeability and Monte Carlo extend the clastic petrophysics, which still
runs on synthetic logs; FORCE 2020 would give it real ones. Hydraulics with rheology waits for a source with Fann readings.

## 6. Libraries to know

Python: lasio (MIT), dlisio (LGPL-3.0), welly (Apache-2.0), segyio (LGPL-3.0), welleng
(Apache-2.0, ISCWSA error models), xtgeo (LGPL-3.0), petbox-dca (MIT), bruges (Apache-2.0).
Browser: @equinor/esv-intersection, @equinor/videx-wellog, @equinor/videx-3d (all MIT). Data
platform: OSDU (record shapes, not calculations).

Licence and availability claims above were checked on the publishers' pages on 15 Oct 2026 except
where marked "to confirm".
