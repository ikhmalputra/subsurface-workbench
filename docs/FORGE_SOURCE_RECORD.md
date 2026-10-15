# Utah FORGE 16A(78)-32 Source Record

## Sources and Licence

1. McLennan et al. (2021), University of Utah, DOI 10.15121/1776602,
   https://gdr.openei.org/submissions/1283. The survey workbook supplies 422
   observed stations. Dataset description supplies approximate sediment/granite
   context, not a measured lateral contact surface.
2. Winkler, Swearingen and McLennan (March 2021), *Drilling Summary of the Utah
   FORGE Well 16A(78)-32*, https://gdr.openei.org/submissions/1296.

3. Utah FORGE daily operations, *Summary of Daily Operations, 20 Oct 2020 to
   3 Jan 2021* (`Composite-C (1).pdf`, 19 pages), and the Horizon Well Logging
   final mud log (`16A(78)-32 Final mud log.las`, LAS 2.0, 1 ft), both in
   https://gdr.openei.org/submissions/1283.

4. Utah FORGE, *Seismic Reflection Data* (2018-19 reprocessing by Land Seismic
   Noise Specialists), DOI 10.15121/1542059, https://gdr.openei.org/submissions/1141,
   and the wellhead location from the planned-trajectory CSV in
   https://gdr.openei.org/submissions/1216.

All records identify CC BY 4.0, https://creativecommons.org/licenses/by/4.0/.
The adapted fixture retains attribution and licence. Original SDK code is MIT.

## Directly Reported Records

| Record | Specification | Bottom MD, report ft | PDF page |
| --- | --- | ---: | ---: |
| Surface casing | 13 3/8 in, 68 lb/ft, L80, BTC | 1629 | 10 |
| Intermediate casing | 9 5/8 in, 40 lb/ft, HCL80 | 5110 after pickup from 5113 | 21 |
| Production casing | 7 in, 38 lb/ft, T95, JFELION | 10787 | 67 |
| Surface hole | 17 1/2 in, from 28 ft | 1629 | 10 |
| Intermediate hole | 12 1/4 in, from 1629 ft | 5113 | 12 |
| Production hole | 8 3/4 in, from 5113 ft | 10987 | 22 |
| Surface cement | Cement to surface; floats failed | 1629 | 10 |
| Production cement | RC ThermaLite-HT, 12.97 ppg; 433 bbl pumped, 15 returned | 10787 | 67 |
| Thread-on wellhead and master valve | Installed when securing the well; dimensions unreported | Unreported | 71 |

The planned liner hanger was removed and a full production casing string was
run. The temporary DFIT packer failed to set and was retrieved (pages 68-69).
Neither is depicted as installed. No permanent tubing, gas-lift or safety-valve
equipment is manufactured to populate this example.

## Survey, Units and Coverage

- Last workbook station: 10955 ft MD, 8558.83 ft TVD, easting 3901.17 ft,
  northing -1039.83 ft, inclination 68.6 degrees, azimuth 101.44 degrees.
- Workbook explicitly declares US survey feet: 1200/3937 metres.
- Workbook datum: MSL, GE + RKB; GL 5414 and KB 5444 US survey ft.
  Ground is 30 US survey ft below RKB, not 30 metres above MSL.
- Report drilling depths are labelled feet, converted using 0.3048 metres;
  their original feet remain attached to each record. This is an explicit
  conversion assumption, not confirmation of an unlabelled survey-foot standard.
- Reported TD is 10987 ft. The final uncovered interval is not extrapolated.
  The 8 3/4-inch hole record preserves reported TD but its displayed interval
  ends at the last observed station. Total plotted MD is survey coverage.
- Display interpolation is linear between observed XYZ stations, not a new
  survey computation. The 3D polyline no longer introduces Catmull-Rom overshoot.

## Derived and Conceptual Geometry

- Approximate contact at 4700 report ft MD is linearly projected to TVD through
  the observed survey. It is not an exact formation pick or measured regional
  horizon. Only sedimentary overburden and crystalline host-rock context are used.
- Planar geology blocks and their lateral extents are conceptual. Density,
  porosity, faults, fracture-network extent and water table remain unreported.
- Casing tops use depth-reference zero for depiction, not a measured stick-up.
  Casing OD is reported, but casing ID/wall thickness is null; open outer surfaces
  expose nested strings without fabricating wall thickness. Diameters are x150.
- Hole envelopes are nominal drilled diameters, not measured caliper geometry.
  Surface cement uses nominal hole/casing bounds. Production cement has no outer
  envelope: the earlier casing IDs are unknown, so the reservoir hole diameter
  cannot define the annulus all the way to surface.
- Wire symbols at casing ends denote interval termination, not shoe CAD.
  Wellhead/valve symbols are offset location markers at the surface reference,
  not actual physical geometry, measured elevations or relative separation.
- Ten records are evidence categories, not ten total installed physical parts.
  No joint tally or rated manufacturer geometry is supplied by these sources.

## Reproduce the Import

Download these small source documents, then run the pinned importer:

```sh
curl -fL 'https://gdr.openei.org/files/1283/16A(78)-32%20Survey.xlsx' -o /tmp/subsurface-forge16a-survey.xlsx
curl -fL 'https://gdr.openei.org/files/1296/Drilling%20Summary%20Well%2016A(78)-32.pdf' -o /tmp/subsurface-forge16a-summary.pdf
.venv/bin/python -m pip install -r tools/survey/requirements.txt
.venv/bin/python tools/survey/import_forge.py
```

Expected SHA-256 values, also retained in the fixture:

- Workbook: `ad03773329769f702f748c96244a9e1cba16cd1d762d4e8b93b8c8fea9d36b8d`
- PDF: `2b1886f8fceb8c83cbbb524bc27beaeb2e832116b4496bdf53cfa26bc65cdceb`

The importer checks hashes, station count, monotonic MD and endpoint raw values.
Report records are manually transcribed with page references, not extracted by
guessing dimensions from images. Tests check independently transcribed source
values, preserved nulls, absence of invented equipment and coverage rejection.
These checks establish fixture fidelity, not engineering certification.

## Operational Records (`/records`)

`tools/survey/import_forge_operations.py` builds `packages/core/src/forge-operations.json`
and `apps/demo/public/data/forge-16a-mudlog-10ft.las` from the summary PDF, the
daily-operations PDF and the mud-log LAS:

```sh
curl -fL 'https://gdr.openei.org/files/1283/Composite-C%20(1).pdf' -o /tmp/subsurface-forge16a-daily.pdf
curl -fL 'https://gdr.openei.org/files/1283/16A(78)-32%20Final%20mud%20log.las' -o /tmp/subsurface-forge16a-mudlog.las
.venv/bin/python tools/survey/import_forge_operations.py   # prints "76 days 54 runs 1086 log rows"
```

Expected SHA-256: daily PDF `12f911d3b2092671ac054fb4b14fb3f23a9aff485d8c3016a9d834d929391531`,
mud log `3883add7fe1a6ab745b32b059f191ff519b895be2008409bf87fec60ec84acde`
(summary PDF as above).

- **Daily history (76 days).** Machine-extracted from the PDF text layer:
  date, MD, TVD, footage, mud weight, the present-operations headline, the
  activity list (split on `;`, PJSM-only items dropped) and the planned
  activity. Wording is the operator's, with whitespace normalised. The activity
  category is derived from the headline by keyword rules, so it is a
  convenience label rather than a reported field.
- **Service and BHA runs (54).** Transcribed from the drilling summary. Each run
  keeps its kind, interval, stated footage and ROP, outcome and summary page. The
  importer asserts that every run's evidence strings appear in that page's text.
  Footage is the stated value; where no footage is stated it is base minus top.
  Bit grades and per-run dates appear in report images and are not transcribed.
- **Hole sections (3).** Derived from the runs and casing points: interval, bit
  size, casing, run count, footage, footage-weighted average ROP and report
  days. Each section links to the `forge-data.json` hole and casing component ids.
- **Milestones (7).** Spud and rig release come from summary page 7; kickoff,
  casing points and TD come from the daily reports.
- **Mud log.** The demo copy keeps DEPTH, ROP, WOB, RPM, TORQUE, PP, FLOWIN,
  TEMPIN and TEMPOUT as 10 ft bin means (1,086 rows, 130–10,980 ft). The `~P`
  section records the source URL, SHA-256, decimation rule and licence.
  TEMPIN and TEMPOUT have no declared unit in the source.

## Seismic (`/seismic`)

`tools/survey/import_forge_seismic.py` writes
`apps/demo/public/data/forge-16a-psdm-section.sgy` (SEG-Y rev 1, IBM float,
110 traces × 801 samples, 373 KiB), `packages/core/src/forge-seismic.json`
(geometry and provenance) and `packages/core/test-fixtures/forge3d-psdm-first3.segy`
(the source file's first three traces, verbatim).

```sh
.venv/bin/python -m pip install -r tools/survey/requirements.lock.txt
.venv/bin/python tools/survey/import_forge_seismic.py
# 110 traces x 801 samples, azimuth 104.92, grid residual 0.50 m, plan-vs-survey 1.6 m, 382440 bytes
```

- **Source.** Member `3D Survey/Forge3d_ANI_PSDM_Stack_UnEnh.segy` of
  `2018-19 Reflection Processing.zip` (886 MB). If `/tmp/subsurface-forge3d-psdm.segy`
  is absent the importer fetches only that member with HTTP range requests,
  using the sizes and CRC-32 from the zip central directory (the member uses a
  data descriptor), and checks CRC and size. Expected SHA-256 of the
  153,678,840-byte volume: `d1e07eb1c0bf27ea28ada3a5c30102cf92f3689083857f6d96031c4a1e39ad62`.
  The enhanced stack in the same zip fails to inflate, so the unenhanced stack is used.
- **Volume.** Anisotropic PSDM, 170 inlines × 213 crosslines, 25 m bins, 1,001
  depth samples at 5 m, NAD83 UTM 12N. Depth is metres below the 1,800 m ASL
  seismic datum. The volume stores geometry at non-standard bytes: inline and
  crossline in the high 16 bits of bytes 9 and 13, CMP X/Y as IBM floats at
  189/193 (bytes 181/185 are zero). `forgePsdmVolumeLayout` reads that layout.
  Its textual header misnumbers one card (no `C11`); it is kept verbatim.
- **Section.** A straight line through the wellhead (E 334,637.9, N 4,263,458.9,
  GDR 1216) and the observed toe, azimuth 104.92° grid, from −750 m to 1,975 m
  at 25 m spacing. Each output trace is the unmodified nearest bin (an affine
  inline/crossline grid fitted to all 36,210 headers, max residual 0.50 m),
  cropped to 0–4,000 m. The importer re-reads the output and asserts each trace
  equals its source samples. Output SHA-256 is pinned in `forge-seismic.json`.
- **Sub-volume.** From the same volume and bin grid, a well-centred cube on
  the section azimuth: 110 along (−750 m to 1,975 m) × 61 offset (−750 m to
  750 m, right of the azimuth) at 25 m, 641 samples (0–3,200 m below datum,
  covering well TD). Unmodified nearest bins, quantised to int8 with one count
  = p99.9 |amplitude| / 127 (0.1% of samples clip), stored along-fastest, then
  offset, then depth. The importer asserts the offset-0 row equals the section
  traces and re-reads the file to check the quantisation error is at most
  half a count. SHA-256 is pinned in `forge-seismic.json`.
- **Well tie.** Seismic depth = TVD below RKB + (1,800 − 1,659.33) m. The
  planned toe (UTM) and the observed survey offsets agree within 1.6 m at the
  same MD, so the survey's north is treated as UTM grid north. Survey stations
  sit at most ~50 m off the straight section. PSDM depths come from the
  processor's velocity model and are not tied to check-shots or sonic logs, so
  the well and the image can disagree in depth.

## Open-hole logs (petrophysics)

`tools/survey/build_forge_openhole.py` writes
`packages/fixtures/data/forge-16a-openhole-1ft.las` (LAS 2.0, 5,951 depths at
1 ft from 5,000 to 10,950 ft MD, 24 curves, about 1 MB). The deck's Logs
module ("Open hole") and the Petrophysics module read it on FORGE; the lens
reads it at the depth cursor.

```sh
python3 -I tools/survey/build_forge_openhole.py /tmp/subsurface-forge16a-openhole
# fetched R08_TB_TCOM.las … FMI_P32.las
# packages/fixtures/data/forge-16a-openhole-1ft.las: 5951 depths, 24 curves, 1,048,430 bytes
```

- **Source.** GDR 1292, *Utah FORGE: Well 16A(78)-32 Logs* (2021-03-08,
  DOI 10.15121/1777912, CC BY 4.0), https://gdr.openei.org/submissions/1292.
  The Schlumberger package `16A(78)-32 Schlumberger.zip` is 6.34 GB; the
  script reads only its central directory (about 18 KB) and four members by
  HTTP range request (about 2 MB compressed), and downloads the separate
  spectral gamma-ray LAS whole. Any source already in the folder is reused.

  | Saved as | Member or file | Bytes | SHA-256 |
  | --- | --- | ---: | --- |
  | `R08_TB_TCOM.las` | `Wireline Field Data/A1008700.01_University_of_Utah_Forge_R08_L001Up_TB_TCOM.las` | 2,160,162 | `65d81e34ebaf02570e270cbf9f664c928fc72e054bb0294445360445eecfc25e` |
  | `PNS.las` | `Processed Deliverables/…_ThrubitDipole_PNS_result_5000-10940ft.las` | 1,718,599 | `0918c3f07cf46d2a2bc4bf013e7114fd4d627e6b32f008393082b175464db44a` |
  | `IsoMechPro.las` | `Processed Deliverables/…_ThrubitDipole_IsoMechPro_result_6000-10942ft.las` | 2,738,052 | `00d9160483224b46dda9dce387f23a12effaba087e63b722d1579e67bb7a868b` |
  | `FMI_P32.las` | `Processed Deliverables/…_TBFMI_Interpretation_5040-10870ft_FracAnalysis_P32.las` | 211,174 | `c80244cfb5f98b6c4fe8d8f7e8eda19ac5d22d3b5ad0ee5e09ffc920f1d403fe` |
  | `Spectral.las` | `UnivUtah_Forge-16A-78-32_Spectral.las` (plain file) | 5,282,127 | `77fcf0b6fb503310a33302ce8dcc3b79b072411b96dd690792d24d5bab989a80` |

  Member paths sit under `16A(78)-32 Schlumberger/` in the zip; the script
  holds them in full. It stops if any SHA-256 differs.
- **Curves.** GR (thru-bit), CGR, K, TH, U (HNGS), NPHI and NPHI_SAN (thermal
  neutron, percent ÷ 100), DPHI and SPHI (as delivered), DTC, DTS, RT10 and
  RT90 (array induction), C13 and C24 (calipers), BS, DEVI, P32 (FMI fracture
  intensity), UCS, YME_STA, PR and the SV/SHMIN/PP gradients (IsoMechPro). Each
  value is the mean of the source samples in [depth, depth + 1) ft with nulls
  excluded: nothing interpolated, smoothed or recomputed. The `~P` section
  carries each source's path and SHA-256, the decimation rule and the licence.
- **No bulk density.** The package holds no RHOB curve; DPHI comes as the
  processor delivered it (sandstone matrix, 2.65 g/cm³). In granite that matrix
  is wrong by design, so the deck labels it and reads porosity three ways.
- **What the data does not support, and how the deck treats it.**
  - Above the 9 5/8 in shoe, and wherever BS reads over 9 in, the tools logged
    through casing: those feet are left out.
  - RT10 is pinned at 1,950 Ω·m on most of the open hole, the tool's ceiling:
    the 90 in curve is used and the clipped feet are counted.
  - C13 reads a steady ~0.5 in over the 8 3/4 in bit through the whole open hole
    while C24 reads on gauge. Ovality is therefore counted only where the arm
    pairs part by 0.25 in more than their median gap; enlargement only where
    both pairs read over the bit by 0.5 in.
  - Uranium below zero (a spectral-processing artefact) is kept as delivered
    and counted.
  - The logs were run on 29 Dec 2020; on earlier days of the time replay the
    deck shows them as not logged yet.

## Neighbouring wells (anti-collision)

`tools/survey/build_forge_offset_wells.py` writes `packages/core/src/forge-offset-wells.json`
(27 KB): the surveys of 16B(78)-32 and 58-32 and the GPS wellheads, in the units the sources give.

```sh
.venv/bin/python -I tools/survey/build_forge_offset_wells.py /tmp/subsurface-forge-offset-wells
.venv/bin/python -I tools/survey/build_forge_survey_uncertainty.py /tmp/subsurface-forge-offset-wells
# packages/core/src/forge-offset-wells.json: 16B 428 stations (worst 0.007 ft), 58-32 59 stations (worst 0.049 ft)
```

| Saved as | Source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `16b-survey.zip` | GDR 1516, `16B(78)-32 Well Survey.zip` (member `16B(78)-32 Final Survey Report.txt`) | 608,878 | `38c59c9452da709fa971448699eb46fb13f452d2aa8c08fbe88fe73f08ce5302` |
| `58-32-survey.zip` | GDR 1006, `Directional_Survey_well_58_32.zip` (member `DirectionalSurveyRpt_171027103004.pdf`) | 425,858 | `b705a123a89ef619c305ee25d42dfbebd34ed2a51f1b39e914acd9f5e14b518d` |
| `locations.csv` | GDR 1358, `Utah FORGE Well and Seismic Locations.csv` | 4,438 | `7bfc9cf730b8521a71a878ab38381a772ea06821e20f07c06c7ee5e3a5351471` |
| `16a-survey-final.pdf` | GDR 1283, `U OF U WELL No. FORGE 16A (78)-32 SURVEY FINAL.pdf` | 103,444 | `15a051818f36be9d3d95d56472151326221fcf52003871961ba425b7c60979ae` |
| `16b-location.pdf` | GDR 1516, `WELL 16B (78)-32 LOCATION Survey.pdf` | 226,908 | `23378e6a0dec9f52c1358498ce51e5fce381a978c8a357f44161ada7cae251f5` |
| `58-32-sonic-head.las` | GDR 1006, `D5RL-00187_…_DSI Sonic.las`, bytes 0–16,383 only | 16,384 | `c7d6edd538b155b6056519cd438b69fe50e0b44e0c435d513160910eab12bab0` |
| `16a-survey.xlsx` | GDR 1283, `16A(78)-32 Survey.xlsx` (tool codes per station; for the uncertainty build) | 48,839 | `ad03773329769f702f748c96244a9e1cba16cd1d762d4e8b93b8c8fea9d36b8d` |

- **16B(78)-32.** The text survey report: NAD83 Utah HARN, UTM 12N in US survey feet, grid north,
  minimum curvature; wellhead E 1,097,907.09 / N 13,987,765.96 ft; KB 5,447.65 ft, GL 5,415.65 ft;
  428 stations to 10,947 ft MD. The submission calls it a post-drilling gyro survey; no tool error
  model is given.
- **58-32 (MU-ESW1).** Only a PDF report exists (Geothermal Resource Group, printed 27 Oct 2017).
  Its 59 rows (MSS, MMS and MWD stations to 7,357 ft MD) are transcribed in the script exactly as
  printed. North reference is not reported; at this longitude grid and true north differ by about
  1.2°, about 1 m at the well's 51 m offset. Its depth reference is settled below.
- **Check.** The script recomputes every survey by minimum curvature from MD, inclination and
  azimuth and compares it with the TVD, N and E the report prints: 16B within 0.007 ft, 58-32 within
  0.049 ft (printed to 0.1 ft). A mistyped 58-32 row cannot pass.
- **Wellheads, settled.** 16A had three published positions. A licensed as-built survey (Woolsey
  Land Surveying, P.L.S. 4938769, 23 Mar 2023; GDR 1283 `U OF U WELL No. FORGE 16A (78)-32 SURVEY
  FINAL.pdf`, 103,444 bytes, SHA-256 `15a05181…79ae`) puts the top of the steel wellhead at
  38°30′14.44783″ N, 112°53′47.06681″ W (NAD83), 5,420.367 ft NAVD88: E 334,639.62, N 4,263,442.82 m.
  The survey workbook's own reference point (E 1,097,896.92 / N 13,987,645.19 US ft) agrees to
  0.07 m and the UGS GPS survey (GDR 1358) to 1.8 m; the planned-trajectory CSV (GDR 1216) is
  16.2 m off. 16A now stands on the as-built position everywhere; the frame's origin stays at the
  GDR 1216 point because the seismic section and sub-volume were cut through it, so the well is about
  16 m off the published section near surface. 16B's licensed as-located survey (GDR 1516 `WELL 16B
  (78)-32 LOCATION Survey.pdf`, 226,908 bytes, SHA-256 `23378e6a…251f5`) agrees with its survey
  report's wellhead to 1 mm. The two wellheads are 36.9 m apart.
- **58-32 datum, settled.** The header of its DSI sonic LAS (GDR 1006, the first 16,384 bytes read by
  range request, SHA-256 `c7d6edd5…bab0`): drilling and logging measured from KB, EKB 5,557.5 ft,
  EGL 5,536 ft. The KB height (21.5 ft) is added to the GPS ground elevation; the header's own ground
  elevation differs from the GPS survey's by 2.6 m.
- **Uncertainty.** `tools/survey/build_forge_survey_uncertainty.py` writes
  `packages/core/src/forge-survey-uncertainty.json`: covariance at every station from the ISCWSA OWSG
  generic model of each reported tool, tied on run to run (welleng 0.29.1). 16A's workbook names its
  tools per station: a gyro (`GYD_G003_GC+DROP+OH`) to 8,406 ft and MWD with a high-resolution field
  model (`B001Mb_MWD+HRGM`) below; 16B's plot shows gyro to 10,400 ft and MWD below; 58-32's rows
  are typed MSS, MMS and MWD. Gyro runs use the generic gyro multishot `CB_Film_GMS`: welleng's
  `GYRO-NS` family gives 120–200 m 1σ at TD on these surveys (two terms it cannot evaluate), against
  15 m for MWD. HRGM has no OWSG model; `MWD+SRGM` claims less accuracy, not more. Field: 49,966.2 nT,
  dip 64.01°, declination 11.29° (16A's workbook).
- **Results.** Centre to centre, 16B comes within 30.6 m of 16A at about 1,760 m MD; the ISCWSA
  separation factor (k 3.5, σpa 0.5 m, surface margin 0.3 m) falls to 0.79 at 1,780 m, so the two
  wells' uncertainty ellipsoids overlap there. 58-32's least separation factor is 7.4 near 2,740 m.
  The app's own implementation matches welleng's to within 3%. Hole radii are each well's reported
  hole sizes: 16A's from its records; 16B's (22 in, 14 3/4 in, 9 1/2 in) and 58-32's (36, 17 1/2,
  12 1/4, 8 3/4 in) from their end-of-well reports (see "Neighbouring wells' construction" below),
  replacing an earlier 8.75 in stand-in. The least separation factors are unchanged at this
  precision (0.79 and 7.4): the radii are a 0.1–0.5 m term against 30 m and more.

## Stresses (1D geomechanics)

`tools/survey/build_forge_stress.py` writes `packages/core/src/forge-58-32-stress.json` (28 KB)
from GDR 1032, `58-32 stress logging data.xlsx` (833,706 bytes, SHA-256
`ad34490ecfe2dc52cc432ba465c6e46fef2e2e7b424f795b89e2e876d79a8e3f`), sheet `logging`: SHmax and
Shmin computed from 58-32's dipole sonic with a Biot coefficient calibrated to its injection tests,
and Sv, every 0.5 ft from 2,155 ft to TD, binned to 5 ft means. In the granite (4,500 ft to TD) they
run about 0.59, 0.74 and 1.115 psi/ft below ground: normal faulting. The zone table on the workbook's
other sheet is hand-made (one row reads "74122") and is not used.

The open-hole set adds three IsoMechPro curves for the model: friction angle (FANG), cohesion (COHE,
from ISHE) and tensile strength (TSTR). 16A's IsoMechPro Shmin reads about 0.76 psi/ft at 8,000 ft,
well above 58-32's calibrated 0.59; the deck's Geomechanics module shows both and lets the reader
choose which drives the window. No record here gives SHmax's azimuth, so collapse and breakdown are
computed for every azimuth and shown as bands.

## String weights (torque and drag)

`tools/survey/build_forge_string_weights.py` writes `packages/core/src/forge-string-weights.json`
(110 KB) from GDR 1283, `16A(78)-32_Daily_Reports.zip` (13,946,322 bytes, SHA-256
`d2b5bf21cc5b2ef3fe811f06f5bea7f88401c569d14513c5444fb0000e0ad66c`): each drilling report's date and
depth, mud weight, rotating, pick-up and slack-off weights, torque, and its BHA (components with OD,
ID and length; the BHA's length and weight in air and mud). The reports are WellEz PDFs with a text
layer, read by a small PDF text reader in the script itself.

- **As reported.** Weights given in klb ("200") are brought to lb; nothing else is changed. Two
  slack-off weights under 30 % of the rotating weight (18,000 lb on 29 Nov, 15,000 lb on 18 Dec 2020)
  look like a dropped zero and are flagged, not corrected. Where a day has several report versions,
  the last one is kept. The weights are taken as read at that day's reported depth.
- **Calibration** (core `calibrate`): 23 days have a depth, all three weights, a mud weight and a BHA
  whose reported weight is plausible for its length (20–150 lb/ft); 12 are left out, each with its
  reason in the module. Rotating weights give the block weight (74.5 klb) and the drill pipe's weight
  (18.2 lb/ft against 19.5 nominal) by least squares; the pick-up and slack-off weights give friction
  factors of 0.06 cased and 0.54 open hole (rms misfit 25.8 klb). The cased value is weakly
  constrained: most of the drag builds in the open 65° tangent.
- **BOP tests.** Each report's "LAST BOP TEST" is kept as written. Some state a date after the
  report itself (2 Dec on 4 Nov, 14 Dec on 16 Nov 2020); the barrier module does not use those.
- **Not used.** `16A(78)-32_Pason_Data.zip` (7,007,784 bytes, SHA-256
  `4ccc8647a8827a8edbed9aa96933fd9d8d814ab2cdd68f1e3392065cd849b096`) holds a 10 s Pason log of the
  14–24 April 2022 stimulation re-entry, not the 2020 drilling; no record here describes that string,
  so it calibrates nothing. The 2020 drilling's own 1 s and 10 s data (1.2 GB and 113 MB CSVs) were
  not fetched.

## Neighbouring wells' construction (well comparison)

`tools/survey/build_forge_construction.py` writes `packages/core/src/forge-offset-construction.json`
(38 KB): how FORGE's other deep wells were built, for the deck's Compare wells module. Five
end-of-well reports, all GDR, CC BY 4.0, each pinned by SHA-256:

| Well | GDR | File | Bytes | SHA-256 |
| --- | --- | --- | --- | --- |
| 16B(78)-32 (2023) | 1516 | `End of Well Report-16B78-32-May_2024.pdf` | 68,573,668 | `b35f25ed…f18f5d` |
| 58-32 / MU-ESW1 (2017) | 1006 | `58-32_EOWR.zip` (uses `58-32_EOWR_DOE.pdf`, `CasingReports_All.pdf`) | 27,211,479 | `b702fa9e…337654` |
| 56-32 (2021) | 1295 | `56-32 EOWR - Final 22 July 2021.pdf` | 4,826,997 | `95be3fe8…04b3` |
| 78-32 (2019) | 1153 | `Monitoring Wells  78-32 - EOWR.pdf` | 16,746,906 | `7dc4d3e9…efa46` |
| 78B-32 (2021) | 1330 | `78B-32 EOWR with appendices.zip` (uses the 68-page report) | 22,534,258 | `e4d84ced…cb17` |

(Full hashes are in the script. 58-32's `..._BinderComplete (1).pdf`, 28,620,220 bytes, was also
fetched: it is a PDF portfolio, so the plain zip was used instead.)

- **Transcribed, then checked.** Each casing string, hole, cement statement, datum, wellhead item and
  contradiction is written in the script with the words of the page it comes from; the script reads
  every cited page's text layer through Apple PDFKit (`tools/survey/pdf_pages.swift`, so macOS) and
  refuses to write unless every quote is on its page. The as-constructed table is kept where a report
  contradicts itself; the other figure is kept as a note with its page (16B's intermediate grade
  JFE110T vs JFE125T, 58-32's 9 5/8 in L-80 vs K-55, 56-32's shoe 9,135 vs 9,105 ft, and others).
- **Not filled in.** A cement top no page gives is no cement interval (58-32 gives none; the cement
  reports are images). A hole depth no page gives is drawn to its string's shoe and says so. 16B's
  conductor is not described on the pages read. 78-32's "Elevation: 5509.5 ft ASL" does not say of
  what, so no datum elevation is taken; it has single-shot inclinations without azimuths, so no TVD.
  16B's 7 in cement top is the bond log's "~3,000 ft", marked approximate.
- **Surveys.** 16B and 58-32 use the survey files above (`forge-offset-wells.json`); 56-32 and 78B-32
  are parsed from their reports' tables (78B-32's prints decimal commas) and checked by recomputing
  TVD by minimum curvature: within 0.05 ft and 0.09 ft of the printed TVD.
- **Units.** Feet as reported, converted with 1200/3937 m per ft, as the 16A records are.

```sh
python3 -I tools/survey/build_forge_construction.py <folder with the five downloads>
# 16B(78)-32: 3 strings, every quote found … 78B-32: 4 strings, every quote found, 100 survey stations
```
