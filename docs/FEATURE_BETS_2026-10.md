# Next feature bets — October 2026

All eleven tools in the domain study's list are built (`SUBSURFACE_DOMAIN_STUDY.md` §5). This
document picks the next four from the gaps that remain in §3 (what working teams use), checked
against the data already on disk (§4), and sets out each one's todo before any code is written.

## How every feature is built

These are the rules each feature is held to; each todo ends with them as its checks.

**Vision.** Subsurface, not a well tool: the four span geomechanics, petrophysics, geophysics and
well integrity. Each is a tool a working team uses, built the way the industry runs it, on real
data where it exists and on labelled synthetic data where it does not.

**Design language** (set by Live drilling and the living-well Production module):
- The physical thing is the main surface, drawn and moving as the model says: the rock, the well,
  the fracture cloud, the annuli. Charts sit beside it, never instead of it.
- Act on the drawing: drag, dial, scrub and play. Every control changes the scene at once, with
  heavy work in the compute worker so it never stalls the frame.
- Lenses on one scene instead of tabs of different pages.
- Shared rails: depth (hover and pin), time (scrub and play), selection. A feature with dates puts
  them on the time rail; a feature with depth reads and sets the depth cursor.
- Glance layout in a tile and full stage when focused; drawers for tables. The audit (no element
  spilling the tile, no chart labels overlapping) passes in both.
- Fun and young, not corporate. Mono numerals for readouts, one accent per meaning.

**Honesty** (the false-positive audit, 17 Oct):
- Equations checked against published worked values and independent implementations.
- Every test can fail: tolerances exclude the wrong or untuned answer, and a check shows it.
- Synthetic truths do not share the model's assumptions.
- What the data cannot resolve is shown as a range, a band or "not resolved", never as a point.

**Architecture:**
- Calculation in `packages/core`, one implementation, with tests.
- Deck module in `modules/registry.ts`, lazy in `bodies.tsx`, listed on the landing page and in the
  developers' reference (`pnpm --filter deck sdk:reference`).
- Data in `packages/fixtures/data`, pinned by SHA-256, with its source and licence recorded in the
  source record.
- Heavy loops in `apps/deck/src/compute`.
- All checks: core, deck, render adapters, asset, packages, typecheck, lint and budgets. The feature
  is verified in the browser at 1440×1000, focused and in a tile.

---

## 1. Stimulation and induced seismicity at FORGE

**What a person is trying to do:** plan or replay a hydraulic stimulation of an enhanced
geothermal well. That means seeing where the pressure goes, which fractures it slips, how big the
events may get, and when the traffic light says slow down or stop.

**How the industry runs it.** Pressure diffuses from the stage into the fractured granite. A
pre-existing fracture slips when the pore pressure brings it to Coulomb failure under the in-situ
stresses (Mohr–Coulomb with friction μ and the critical-stress state). Events lie behind a
triggering front r = √(4πDt) (Shapiro). The seismicity rate scales with the injected volume
through the seismogenic index Σ; magnitudes follow Gutenberg–Richter with b ≈ 1. A traffic-light
protocol on the largest magnitude (green, amber, red) sets the operator's response; events trail
on after shut-in. Real-time systems update b, Σ and the exceedance probability as events arrive.

**Real data:**
- FORGE 16A(78)-32 logs on disk: Sv, Shmin and pore-pressure gradients, UCS, friction angle,
  cohesion, and FMI fracture intensity P32 (GDR 1292).
- The April 2022 stimulation: three stages at the toe. Stage 1 in the 200 ft of open hole below
  10,787 ft MD at 50 bpm (≈677 m³ over 4 h); stage 2 perforated at 10,560–10,580 ft and stage 3
  at 10,120–10,140 ft at 35 bpm; 10,054 bbl in all; monitored from 58-32, 78B-32 and 56-32.
- The microseismic catalogue (Geo-Energie Suisse: times, locations, depths, Mw per stage) is
  public on the GDR. It is **not downloaded**: fetching it needs Ikhmal's OK. Until then the module
  runs the model alone and says so.

**Todo:**
- [x] Research, in part. The schedule (stage depths, rates, total and stage 1's volume) is from
      FORGE's summary; the split between stages 2 and 3 and the days between stages are assumed.
      SHmax N25°E and the diffusivity are set by dial. FORGE's own Σ and b wait for the catalogue.
- [x] Core `induced-seismicity.ts`:
  - [x] stresses at depth from the 16A curves, with SHmax from a stress ratio;
  - [x] a natural fracture population seeded by depth from P32: orientations from a Fisher
        distribution about the FMI-reported sets, sizes by power law;
  - [x] each fracture's normal and shear stress and its Coulomb failure stress change for a
        pressure change;
  - [x] pressure diffusion from a line source along the stage, analytic and radial, with storage;
  - [x] events: a fracture fails when ΔCFS ≥ 0 and the front has reached it; magnitude from the
        slipped patch, capped by fracture size, plus the Gutenberg–Richter background;
  - [x] rate model: seismogenic index Σ and b;
  - [x] traffic light on the largest magnitude, with the response (reduce rate, stop, bleed off);
  - [x] shut-in: the pressure relaxes, events trail (Kaiser effect: no new events until the
        pressure exceeds the previous maximum).
- [x] Tests:
  - [x] the triggering front matches √(4πDt) within 5%;
  - [x] Coulomb against a hand-worked Mohr circle;
  - [x] b recovered from a synthetic catalogue (maximum likelihood, Aki) within 0.05;
  - [x] Σ recovered from synthetic rate vs volume;
  - [x] the Kaiser effect holds on re-injection;
  - [x] a test that fails if the front or b is mis-scaled.
- [x] Compute: the event generation for a stage (thousands of fractures × time steps) in the worker.
- [x] Deck module `stimulation`, "Stimulation", in Geomechanics & pressure:
  - [x] **Scene:** a 3D view around 16A's toe. The well and the stage intervals; the monitoring
        wells' geophone strings; the pressure front as a translucent shell; events as spheres sized
        by magnitude and coloured by time; the fracture planes that slipped. Orbit and zoom. Joining Site in 3D is *not done*.
  - [x] **Lenses:**
    - Plan: stage, rate and volume by dial; stresses and friction.
    - Pump: play the schedule; the pressure and the events grow live; a traffic light with its
      response.
    - Read: the r–t plot with the front, Gutenberg–Richter with b, rate against volume with Σ, and
      the Mohr circle with the fractures as points moving to failure.
  - [ ] **Shared rails:** the time rail plays the stimulation (April 2022 hours) — *not done*: FORGE's rail is its drilling record; the module has its own job clock. The depth cursor shows on 16A.
  - [x] **Honesty:** "model" badge; the catalogue-comparison panel says it is not loaded. b carries its ±σ.
- [x] Verify in the browser (tile and stage); run all checks; record in the study and the source record.

## 2. Clastic petrophysics on real logs (FORCE 2020)

**What a person is trying to do:** turn a well's logs into pay, meaning the clay, porosity, water
saturation and permeability of each zone. The answer should be a range, not a single line, because
Rw, m, n and the clay parameters are uncertain.

**How the industry runs it** (Techlog, IP, Geolog):
- Vsh from gamma ray (linear, Larionov) or density–neutron.
- Porosity from density–neutron, shale-corrected.
- Rw from a water zone, read off the Pickett plot: log Rt against log φ, where the water line has
  slope −m and lines of constant Sw sit parallel to it. The petrophysicist drags the water line
  and the m slope.
- Sw by Archie in clean sand, Simandoux or Indonesia in shaly sand.
- Permeability by Timur or Coates from φ and irreducible Sw, checked on core where there is any.
- Cutoffs (Vsh, φ, Sw) give net reservoir and net pay.
- Monte Carlo on Rw, m, n, a, Rsh and the cutoffs gives P90/P50/P10 net pay and HCPV per zone.

**Real data.** 118 FORCE 2020 wells on disk: GR, RHOB, NPHI, RDEP/RMED, DTC, PEF and CALI, with
labelled lithology and formation tops (CC BY 4.0, NLOD). No core.

**Todo:**
- [x] Research: FORCE's curves and units per well (which wells carry RDEP, NPHI, RHOB through the
      reservoir); the Norwegian North Sea's usual ranges (Rw at formation temperature, m 1.8–2.2,
      Rsh); Simandoux and Indonesia forms; Timur and Coates constants.
- [x] Core `petro-clastic.ts`:
  - [x] Vsh (linear, Larionov tertiary and older) and density–neutron porosity with the shale
        correction;
  - [x] Archie, Simandoux and Indonesia;
  - [x] Rw from temperature (Arps) and from the Pickett water line;
  - [x] Timur and Coates permeability;
  - [x] cutoffs to net reservoir and net pay;
  - [x] Monte Carlo on the parameters (seeded) to P90/P50/P10 per zone, with a tornado.
- [x] Tests:
  - [x] Archie, Simandoux and Indonesia against Asquith's worked examples;
  - [x] a Pickett line round trip (Rw and m back from synthetic points);
  - [x] Monte Carlo percentiles converge, and a fixed seed reproduces;
  - [x] Simandoux and Indonesia equal Archie when Vsh = 0, and each test fails if they don't.
- [x] Deck: extend Petrophysics on FORCE wells, chosen from Correlation or the globe.
  - [x] **Scene:** the well's logs as tracks, with the zone tops from FORCE, beside an interactive
        Pickett plot.
  - [x] **On the Pickett plot:** drag the water line to set Rw, drag its slope to set m, and see the
        Sw lines move.
  - [x] **Results:** Vsh, φ, Sw and k tracks redraw live, the pay flags shade, and dragging cutoffs
        on the tracks moves them.
  - [x] **Lenses:** Clay, Porosity, Saturation (Pickett), Pay (cutoffs and Monte Carlo).
  - [ ] **Shared rails and links:** the depth cursor (hover and pin) is done; a brushed interval and P90/P50/P10 pay feeding Volumetrics' ranges are *not done*.
  - [x] **Honesty:** no core, so permeability is labelled as from a correlation. The parameter
        ranges are the user's and shown.
- [x] Verify; all checks; record in the study.

## 3. Seismic attributes and fault likelihood (FORGE PSDM)

**What a person is trying to do:** see in the seismic what the amplitude alone hides: faults and
fracture zones as discontinuities, bright events, and phase continuity. Then pick faults and
horizons faster with that guide.

**How the industry runs it** (Petrel, OpendTect):
- Instantaneous attributes from the analytic trace: envelope, phase and frequency.
- RMS amplitude in a window.
- Coherence or semblance (Marfurt), and variance, across a small trace neighbourhood for
  discontinuities.
- Dip and azimuth from the structure tensor.
- A fault-likelihood attribute that thins the discontinuity.
- Attributes co-rendered on slices with the amplitude, and fault picks snapping to them.

**Real data.** The FORGE PSDM sub-volume on disk (int8, from the published PSDM).

**Todo:**
- [x] Research: Marfurt semblance, its window sizes and dip steering; Hilbert by FFT; structure
      tensor smoothing; what FORGE's PSDM can show (the Opal Mound fault zone, the granite top).
- [x] Core `attributes.ts`:
  - [x] Hilbert transform (FFT) to envelope, phase and frequency;
  - [x] RMS in a window;
  - [x] semblance (3×3 traces × a vertical window), with dip steering from the structure tensor;
  - [x] variance;
  - [x] fault likelihood: semblance thinned along the dip, smoothed.
- [x] Tests:
  - [x] the envelope of a cosine is constant and its phase linear;
  - [x] semblance is 1 on identical traces and drops across a synthetic fault;
  - [x] the dip of a synthetic dipping reflector is recovered within 1°;
  - [x] each test fails if the window or dip is wrong.
- [x] Compute: attribute volumes in the worker, in chunks, cached per attribute, with progress shown.
- [x] Deck:
  - [x] **Scene:** attributes in the 3D cube, in their own chair display (inside Horizons and Site in 3D: *not done*) on the inline, crossline and
        time slices. Co-rendering: amplitude grey with the attribute in colour, opacity by dial.
  - [x] **Interaction:**
    - Choose an attribute by lens: Amplitude, Envelope, Phase, Coherence, Fault likelihood.
    - Sweep a slice and the attribute follows.
    - Fault sticks snapping to fault likelihood, and horizon tracking on phase: *not done*.
  - [x] **Shared rails:** the depth cursor sets the depth slice.
- [x] Verify; all checks; record.

## 4. Well integrity: annulus pressure and MAASP

**What a person is trying to do:** know each annulus's maximum allowable pressure (MAASP) and what
the annuli will do when the well heats up in production. Trapped fluid expands and its pressure
builds (APB). The person decides when to bleed off and whether the casings survive.

**How the industry runs it** (ISO 16530-1, API RP 90; WellCat for APB):
- Each annulus's MAASP is the least of three: the burst of its outer string and the collapse of its
  inner string, each derated, and the formation's strength at its shoe. Each is carried to surface
  with the annulus fluid column.
- Thermal APB: the fluid temperature change from the producing profile (Ramey) and the fluid's
  expansion against the annulus volume's compliance (casing ballooning), with α and κ of the fluid.
- An annulus pressure management plan: the operating envelope, a bleed-off, and a sustained casing
  pressure test (it builds back after a bleed, so it is not thermal).

**Data.** Kestrel A-7's design: strings, cement, fluids, shoes and fracture gradient. Synthetic,
labelled. FORGE's temperature surveys (GDR 1421) would give a real temperature profile; that needs
a download and an OK.

**Todo:**
- [x] Research: ISO 16530-1's MAASP method for A, B and C annuli; Ramey's flowing temperature;
      the APB equation (Oudeman and Bacarreza; Halal and Mitchell) and the water/brine α and κ.
- [x] Core `integrity.ts`, with the design-specific part in the deck's `integrity-model.ts`:
  - [x] the annuli of a design (inner and outer strings, top of cement, fluid);
  - [x] MAASP per annulus, from the three limits (plus the packer for A) and the fluid column,
        with which one governs;
  - [x] the flowing temperature profile from rate and time (Ramey);
  - [x] APB per annulus from ΔT, fluid expansion and the annulus's elastic compliance over its free
        length (from the top of cement up);
  - [x] bleed-off and build-up;
  - [ ] a sustained-casing-pressure flag when the pressure builds back above the thermal
        prediction: *not done* (there is no measured build-up to compare; the panel explains the
        test).
- [x] Tests (core `integrity.test.ts`, deck `integrity.test.ts`):
  - [x] MAASP against a hand-worked annulus;
  - [ ] APB against a published case (Oudeman) within 10%: *not done*, no published case at hand
        to quote; the rigid limit and the compliance ordering are tested instead;
  - [x] a rigid annulus gives the incompressible limit, and a compliant one less;
  - [x] Ramey's limits (no flow, very high rate, at the perforations) and warming with time;
  - [x] each test fails if the governing limit is wrong.
- [x] Deck: an integrity lens on the living well.
  - [x] **Scene:** the cutaway with the annuli lit by pressure against their MAASP (green to amber
        to red, blinking past it), each labelled at its packer or cement with pressure / MAASP.
        The governing limit is named in the gauge and the limits drawer, not on the scene.
  - [x] **Play production:** a log clock plays the start-up from 6 minutes to a year and the
        pressures climb. Bleed is a button on each trapped annulus's gauge, not a valve on the
        scene. The annuli are tinted by pressure, not temperature; ΔT is in the gauge.
  - [x] **Readout:** a gauge per annulus with its pressure, MAASP and governing limit, and the
        pressure lane drawing each annulus's column; a drawer with every limit.
  - [ ] **Shared rails:** *not done*. The start-up has its own clock, not the deck's time rail,
        and Barriers does not show the annuli yet.
  - [x] **Honesty:** design data, assumed packer rating, fluids and heat shares, labelled in the
        panel. Kestrel's temperature is from the design's gradient.
- [x] Verify; all checks; record.

## Order and hand-over

The features are built in this order, each finished before the next. Each one ends with its
checks, its browser verification, a commit on `feature-bets` and a line in the domain study.

| Download | Size | Feature that needs it |
|---|---|---|
| FORGE stimulation catalogue | GDR, a few MB | 1 |
| FORGE temperature surveys | GDR 1421 | 4 |

Both need Ikhmal's OK before they are fetched. Until then, each feature runs on what is on disk
and says what it is missing.
