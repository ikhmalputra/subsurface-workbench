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

9. ~~**Horizon picking**~~ — *built* 17 Oct 2026 on the FORGE PSDM sub-volume: click a reflector on
   any slice in 3D (or on the inline section) and it is tracked trace to trace, best-correlated
   step first, peak or trough, within a step and a correlation the user sets (a strong event tracks
   over ~90% of the volume in ~10 ms, so it re-tracks live). The surface is drawn depth-coloured in
   3D, as a contoured structure map and on the section, and joins Site in 3D. Kept in the browser.
   Faults followed the same day: sticks picked on inlines, joined into a surface; a horizon stops
   at a fault and is seeded again across it, which gives the throw (median step across its cut-offs)
   and the gap it opens on the structure map.
10. ~~**Maps & probabilistic volumetrics**~~ — *built* 17 Oct 2026 on the FORCE 2020 wells: a
   zone's top and thickness mapped between the wells by thin-plate spline; a contact you set makes
   a closure from the crest you click, up to its spill; N/G, porosity and pay Sw from each well's
   logs set the ranges; 4,000 Monte Carlo runs give P90/P50/P10 with a tornado. FORCE has no fluid
   contacts, so the contact is a what-if.
11. ~~**Nodal analysis + PVT**~~ — *built* 17 Oct 2026 on the planned wells (Kestrel A-7): black-oil
   PVT (Standing, Vasquez–Beggs, Beggs–Robinson, DAK Z, Lee–Gonzalez–Eakin), Darcy PI with Vogel
   below the bubble point, Beggs & Brill (Payne) up the design's path with lift gas above the
   deepest mandrel; operating point, flow pattern and holdup up the tubing, and sensitivities
   (tubing, lift gas — the gas-lift performance curve — water cut, wellhead pressure, depletion).
   Then reworked after reviewing how PROSPER and Pipesim are used: a model is not trusted until it
   is matched. Match view: well tests (rate, water, GOR, WHP, lift, gauge, build-up Pr), the lab PVT
   (gravities, Pb, Bo, viscosity) matched by factors, every tubing correlation (Beggs & Brill,
   Hagedorn & Brown) tuned to the gauges by holdup and friction and chosen by tuned error, PI read
   from each test; Predict runs on the matched model and plots the last test against it; History
   trends reservoir pressure, PI, skin (at a stated k), rates and water cut. Kestrel carries a
   labelled synthetic test history generated from a hidden truth, which the core tests check the
   match recovers. Gas-lift design (17 Oct 2026, after API RP 11V6 and Brown's/Takacs' procedure):
   casing pressure down the annulus from the static gas column; the deepest injection point the
   operating pressure reaches at the gas available while clearing the flowing tubing pressure by
   100 psi, above the packer; unloading valves spaced from the kickoff pressure down the load fluid
   and then from the design tubing line, surface opening pressures stepping down per valve, with
   each nitrogen-charged valve's test-rack setting at 60 °F; the gas-lift performance curve at that
   depth with the technical maximum and the economic optimum (oil netback against gas cost, within
   the supply); a check of the valve depths against the completion's mandrels; and the design taken
   into Predict. Forecast (17 Oct 2026, as IPM runs PROSPER into MBAL): a tank (solution gas, rock
   and water expansion, a pot aquifer; Tarner/Muskat with Corey curves below the bubble point)
   matched to the build-up pressures against monthly allocated production, every aquifer size with
   its STOIIP and the ones the pressures cannot tell apart shown for the engineer to pick; water from
   the ln(WOR)–Np trend (flagged as early below 50% water); lift curves tabulated from the matched
   tubing model; month by month to the horizon, economic limit or death, naturally and on gas lift.
   Kestrel's synthetic history now comes from a hidden 120 MMSTB tank produced by the true well.
   Next: real tests and production (Volve), multi-well gas allocation (equal slope under a field gas
   limit), operating limits (erosional velocity, heading, sandface below Pb).

12. ~~**Stimulation and induced seismicity**~~ — *built* 17 Oct 2026 on FORGE's April 2022 stages of
   16A(78)-32 (open hole below 10,787 ft at 50 bpm; perforations at 10,560 and 10,120 ft at 35 bpm;
   10,054 bbl). 16A's IsoMechPro gradients give Sv, Shmin and pore pressure; the FMI's fracture
   intensity sets where natural fractures are dense; their sets, SHmax (N25°E, halfway from Shmin to
   Sv) and friction are assumed and set by dial. Each stage's hydraulic fracture grows along SHmax
   with the stored volume; pressure diffuses from its faces; a fracture slips when the rise reaches
   its Coulomb critical pressure (once: the Kaiser effect), its magnitude from its size, so
   Gutenberg–Richter b ≈ 1 emerges. Read as a monitoring team does: Aki's b, Shapiro's seismogenic
   index, the triggering front and the exceedance probability, under a traffic light. 3D scene with
   16A, 16B and 58-32, the Mohr circle with the fractures moving to failure, a job strip. Not yet:
   FORGE's event catalogue (public on the GDR; needs an OK to download), the time rail and Site in 3D.

13. ~~**Clastic petrophysics on real logs**~~ — *built* 17 Oct 2026 on the 118 FORCE 2020 wells: Vsh
   (linear or Larionov) between gamma-ray lines from each well's own percentiles, shale-corrected
   density–neutron porosity (root mean square, right in gas), Archie, Simandoux or Indonesia with Rw
   from the clean sands' Pickett line (FORCE has no temperature, so at formation temperature),
   Timur or Coates permeability from a Buckles irreducible saturation, cutoffs to net and pay, and a
   seeded Monte Carlo over Rw, m, n, Rsh and the cutoffs to P90/P50/P10 with a tornado. The surface
   is a virtual core (clay, grains, and pores water or hydrocarbon by Sw) beside the logs, with the
   cutoffs, the gamma-ray lines, the shale point and the Pickett water line all dragged by hand.
   Troll's Sognefjord in 31/2-7 reads 40 m of gas pay; Sleipner's Utsira, a water sand. No core, so
   permeability is a correlation and says so.

14. ~~**Seismic attributes**~~ — *built* 17 Oct 2026 on the FORGE PSDM volume (110 × 61 traces, 641
   samples): envelope, instantaneous phase and frequency from the analytic trace (FFT Hilbert), RMS
   in a window, local dip from the gradient structure tensor, dip-steered semblance over 3 × 3
   traces (Marfurt), and fault likelihood thinned to its ridge. Computed in the worker and cached
   (coherence ≈ 2.4 s once). Shown in a chair display you orbit, with the inline, crossline and
   depth slices swept by dragging their faces, the attribute in colour over the amplitude, 16A
   through the cube, Horizons' fault sticks drawn, and the depth cursor setting the depth slice.
   Not yet: fault sticks snapping to fault likelihood, and horizons tracking on phase.

15. ~~**Well integrity: annulus pressure and MAASP**~~ — *built* 17 Oct 2026 as the living well's
   Integrity lens, on Kestrel A-7's design (synthetic, labelled). A runs to the packer; B and C run
   to the inner string's cement, or are open to the formation when the cement sits below the outer
   shoe. MAASP follows ISO 16530-1: 80% of burst and collapse, the formation at an exposed shoe,
   and the packer (7,500 psi, assumed), with the binding limit named. Kestrel gives A 4,477 psi
   (packer), B 4,139 (collapse) and C 3,417 (burst). The flowing temperature comes from Ramey at
   the operating rate. Each annulus warms by an assumed share of the tubing's rise. The thermal APB
   is αΔT/(κ + C), with the strings ballooning elastically. The cutaway lights each annulus from
   green to red against its MAASP. A log clock plays the start-up from 6 minutes to a year. A
   bleeds while it builds again with further heat, and A holds the lift gas while gas lifting. Not
   yet:
   - a check against a published APB case;
   - the sustained-casing-pressure flag;
   - the deck's time rail driving the start-up;
   - Barriers showing the same annuli;
   - FORGE's measured temperatures (GDR 1421, a download awaiting an OK).

The Equator wells keep the earlier clastic module on their synthetic logs. Hydraulics with rheology waits for a source with Fann readings.

## 6. Libraries to know

Python: lasio (MIT), dlisio (LGPL-3.0), welly (Apache-2.0), segyio (LGPL-3.0), welleng
(Apache-2.0, ISCWSA error models), xtgeo (LGPL-3.0), petbox-dca (MIT), bruges (Apache-2.0).
Browser: @equinor/esv-intersection, @equinor/videx-wellog, @equinor/videx-3d (all MIT). Data
platform: OSDU (record shapes, not calculations).

Licence and availability claims above were checked on the publishers' pages on 15 Oct 2026 except
where marked "to confirm".
