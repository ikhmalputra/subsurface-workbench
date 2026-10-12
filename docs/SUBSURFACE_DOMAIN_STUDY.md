# Subsurface domain study — the sub-domains and the tools each needs

Ikhmal, 12 Oct 2026: *every page we built was there to show several functions. Now there is one
giant page, and every tool is an icon you click. Study the subsurface domain and its sub-domains,
and build all the tools for it.*

`WELL_TOOLS_STUDY.md` modelled the tool — `verb object`, opening the object's data if the host has
it. This study supplies the inventory: the subsurface domain as the industry divides it, the tools
each sub-domain works with day to day, and for each tool what it needs from the host and what the
repository has. The ribbon on the sheet is this document rendered as icons: a tab per sub-domain,
an icon per tool, live when built and greyed when not — so the scope is on screen, not in a plan.

Status key: **built** (opens today), **partial** (the calculation or a view exists but not as a
tool), **planned** (nothing yet; the row says what the host must supply before it can be built).
Nothing in a planned tool will be simulated when it is built: each one reads host records or the
user's own input, and says "not supplied" otherwise.

## 1. Drilling engineering

The well as it is drilled: geometry, construction, loads, time.

| Tool | Does | Needs from the host | Status |
| --- | --- | --- | --- |
| Well section | the schematic, the log and the survey on one depth axis | components, survey, LAS | **built** |
| Survey | stations → positions by minimum curvature, plan/section/log views, verification against published positions | survey stations | **built** |
| Trajectory planner | build-and-hold design through a target, DLS limit | kick-off, target | **built** |
| Station editor | edit MD/inc/azi, recompute positions | survey | **built** |
| Anti-collision | separation factor against offset wellbores, ellipses of uncertainty | offset surveys, tool error models | planned |
| Casing design | strings, setting depths, API 5C3 burst/collapse/tension with derating | casing scheme, pressures | **built** (design brief) |
| Pressure window | pore, fracture, mud weight vs TVD with provenance per point | pressure data | **built** (design brief) |
| Kick tolerance | IADC two-condition kick tolerance below a chosen shoe: shoe TVD, hole size and next TD from the host; fracture gradient, mud weight and kick intensity typed; against the operator minimum | shoe, hole sections; pressures typed | **built** (ribbon · Drilling) |
| Cement volumes | annular volume per string from the shoe to the top of cement, split at the previous shoe; a leg without a reported diameter is named as left out | casing OD, bit sizes; top of cement if not reported | **built** (ribbon · Drilling) |
| Hydraulics | annular velocity by hole section and bit hydraulics (TFA, nozzle velocity, pressure drop, HHP, impact) from typed flow, mud and nozzles; ECD not computed without rheology | hole sections; flow, mud, nozzles typed | **built** (ribbon · Drilling) |
| Torque and drag | hookload and torque vs depth for the string in the hole | string weights, friction factors | planned |
| Drilling performance | ROP/WOB/RPM vs depth from the mud log, interval statistics | LAS | **built** (section log track, drilling study) |
| Days vs depth | the time-depth curve with runs and trouble marked | daily reports, runs | **built** |
| Daily reports | the operational record with citations | daily reports | **built** (view only — host-authored) |
| Runs and BHAs | run intervals, outcomes, footage | runs | **built** (view only — host-authored) |
| Time breakdown | days by activity category and per hole section from the daily reports, trouble from run outcomes; NPT proper needs the host's NPT coding | daily reports, runs | **built** (ribbon · Drilling) |
| Drilling study | question, two intervals, evidence, finding with uncertainty | LAS, operations | **built** |

## 2. Geology

The rock the well goes through, and the correlation between wells.

| Tool | Does | Needs from the host | Status |
| --- | --- | --- | --- |
| Formation tops | tops and bases on TVD, drawn on every depth view | formations / marker set | **built** (view, edit in the editor) |
| Lithology column | lithology by interval beside the section | lithology log | planned |
| Well correlation | wells side by side on a datum, tops linked | several wells' tops | **built** (field tool) |
| Cross-section | wells on a spatial line with tops and the surface | locations, tops, surface | **built** (field tool) |
| Structure map | contours of a top across the field | tops at ≥3 wells, or a surface grid | planned |
| Isopach map | thickness of an interval across the field | tops at ≥3 wells | planned |
| Core description | core intervals and descriptions on depth | core records | planned |
| Facies | facies by interval from logs or core | facies log | planned |

## 3. Geophysics

The seismic image and the well's place in it.

| Tool | Does | Needs from the host | Status |
| --- | --- | --- | --- |
| Seismic section | SEG-Y section along the well, well projected on it, linked by depth | SEG-Y, section geometry | **built** |
| Seismic volume | the cube around the well, cut along, across and by depth; volume render | sub-volume | **built** |
| Horizon interpretation | pick and edit horizons on the section | interpretation records | **partial** (`interpretation.ts`, slices only) |
| Fault picking | fault sticks on the section | fault records | planned |
| Well-to-seismic tie | synthetic seismogram from sonic and density, matched to the trace | sonic, density, wavelet | planned |
| Velocity model / time-depth | TWT ↔ depth from checkshot or velocity | checkshot / VSP | planned |
| Attributes | amplitude, phase, frequency extracted along a horizon | volume + horizon | planned |

## 4. Petrophysics

What the logs say about the rock and its fluids.

| Tool | Does | Needs from the host | Status |
| --- | --- | --- | --- |
| Log viewer | curves on tracks by depth, templates, zones | LAS / curves | **built** (developer example; well-keyed is the gap) |
| Depth shift and QC | align runs, flag bad hole | curves, caliper | planned |
| Shale volume | Vsh from gamma ray (linear / Larionov) | GR | **partial** (`petrophysics-calculations`) |
| Porosity | density, neutron, sonic porosity | RHOB, NPHI, DT | **partial** |
| Water saturation | Archie and variants with a, m, n and Rw | RT, porosity, Rw | **partial** |
| Permeability | from porosity transforms or core | porosity, core | planned |
| Net pay and cutoffs | net/gross by cutoffs on Vsh, porosity, Sw | computed curves | **partial** (analysis view) |
| Crossplot and histogram | curve vs curve, distributions, by zone | curves | **built** (developer example) |
| Zonation | zones from tops or picked on logs | tops | **partial** |

## 5. Reservoir engineering

The volumes and the pressures.

| Tool | Does | Needs from the host | Status |
| --- | --- | --- | --- |
| Volumetrics | GRV × N/G × φ × (1−Sw) / Bo, with each term's source | surfaces or GRV, petrophysical averages, PVT | planned |
| Fluid properties (PVT) | Bo, Rs, viscosity vs pressure | PVT report | planned |
| Material balance | p/z and drive indices | production, pressures, PVT | planned |
| Well test analysis | pressure transient diagnostic (log-log, derivative) | PTA data | planned |
| Decline curve | Arps fit and forecast on production | production rates | planned |
| Pressure history | reservoir pressure vs time by zone | pressure surveys | planned |

## 6. Completions and intervention

How the well is equipped to produce, and what has been done to it.

| Tool | Does | Needs from the host | Status |
| --- | --- | --- | --- |
| Completion schematic | tubing, packers, SSSV, nipples, mandrels, gauges on the section and in 3D | completion components | **built** |
| Completion builder | drag parts from the catalogue, placement rules | catalogue | **built** |
| Perforations | perforated intervals with date, gun, shots per foot | perforation records | planned |
| Sand control | screens, gravel pack intervals | completion records | planned |
| Stimulation | fracture / acid treatments by stage | treatment records | planned |
| Intervention history | workovers and interventions by date and depth | intervention records | planned |

## 7. Production and surveillance

What the well does over time.

| Tool | Does | Needs from the host | Status |
| --- | --- | --- | --- |
| Production history | rates, pressures, events over time | surveillance document | **built** (developer example; well-keyed is the gap) |
| Well tests | rate and pressure tests over time | test records | planned |
| Artificial lift | lift system and its settings | lift records | planned |
| Production log (PLT) | flow contribution by depth | PLT | planned |
| Injection | injection rates and pressures | injection records | planned |
| Allocation | well production allocated from measured streams | allocation factors | planned |

## 8. Well integrity

Whether the well is sound.

| Tool | Does | Needs from the host | Status |
| --- | --- | --- | --- |
| Barrier schematic | primary and secondary barrier envelopes on the construction (NORSOK D-010) | barrier definitions | planned (the construction schematic is the canvas) |
| Annulus pressures | A/B/C annulus pressure history against limits | annulus monitoring | planned |
| Cement evaluation | CBL/VDL on the section against cemented intervals | cement bond log | planned |
| Casing wear and corrosion | wall loss by depth from calipers | caliper logs | planned |
| Integrity status | current status and open anomalies | integrity register | planned |

## 9. Geomechanics

Whether the hole stays open.

| Tool | Does | Needs from the host | Status |
| --- | --- | --- | --- |
| Stress regime | Sv, SHmax, Shmin vs depth | density log, LOT/FIT, image logs | planned |
| Wellbore stability | collapse and fracture mud weights vs trajectory | stresses, rock strength | planned |
| Fracture gradient | LOT/FIT points and the fitted gradient | LOT/FIT records | **partial** (pressure window) |
| Sand production risk | critical drawdown by depth | rock strength | planned |

## 10. Field, data and reference

The things every sub-domain stands on.

| Tool | Does | Needs from the host | Status |
| --- | --- | --- | --- |
| Field map | wells on a map with layers, bathymetry, 3D offshore scene | locations, layers | **built** |
| GIS import | vector and raster layers added to the field | files | **built** |
| Offset well library | comparable wells, nine-factor match, adoption into a brief | offset records | **built** |
| Reference and datum | CRS, depth datum, elevation, units; the frame registry | reference metadata | **partial** (`frames.ts` built, not wired) |
| Data sources | every dataset registered for the well, its provenance and citation | the host registry | **partial** (well file, inspector facts) |
| Well report | the as-drilled report from sourced records, print-ready | report spec | **built** |
| Export | brief, study, revision as JSON for the host | — | **built** |
| Units and conversions | metres/feet, both feet, pressure and density units | — | **built** (`units.ts`) |

## 11. The count

| Sub-domain | built | partial | planned |
| --- | --- | --- | --- |
| Drilling engineering | 14 | 0 | 2 |
| Geology | 3 | 0 | 5 |
| Geophysics | 2 | 1 | 4 |
| Petrophysics | 2 | 5 | 2 |
| Reservoir engineering | 0 | 0 | 6 |
| Completions and intervention | 2 | 0 | 4 |
| Production and surveillance | 1 | 0 | 5 |
| Well integrity | 0 | 0 | 5 |
| Geomechanics | 0 | 1 | 3 |
| Field, data and reference | 6 | 2 | 0 |
| **Total** | **30** | **9** | **36** |

The repository is a drilling-engineering and field tool with the beginnings of petrophysics and
geophysics. Reservoir engineering, integrity and geomechanics are empty. That is the order the
planned tools should be built in once the host data exists: each planned row names what it needs.

## 12. How this reaches the sheet

The tool registry (`apps/demo/src/lib/tools.ts`) carries every row above with its sub-domain,
status and icon. The ribbon docked at the top of the sheet shows a tab per sub-domain and an icon
per tool; a built tool opens its panel, a partial tool opens the nearest thing it has, a planned
tool is greyed with its "needs" line as the tooltip. The palette keeps the verb matrix.
