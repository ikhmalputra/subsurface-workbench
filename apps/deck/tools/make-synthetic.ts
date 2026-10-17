/**
 * The deck's synthetic stand-ins for data not yet downloaded, written in the formats the real data
 * comes in, so a real file drops in where each one is read:
 *
 * - FORGE 16A's April 2022 microseismic catalogue, QuakeML 1.2 (as the GDR's Geo-Energie Suisse
 *   catalogue is exchanged): from a hidden stimulation model whose diffusivity, SHmax, fracture
 *   sizes and stress drop are not the module's defaults, seen through a geophone array in 58-32
 *   that misses the small far events, with location and magnitude noise.
 * - Kestrel A-7's first-month distributed temperature survey along the tubing, LAS 2.0: Ramey's
 *   profile with a rock conductivity the integrity lens does not assume, and gauge noise.
 * - Kestrel A-7's annulus pressures for the first 120 days, hourly, LAS 2.0 (time-indexed), as a
 *   SCADA historian exports them: thermal build-up from a hidden heat share, a diagnostic bleed of B
 *   and C on day 45, and a leak behind B's cement from day 25 that the thermal model cannot explain.
 *
 *   node apps/deck/tools/make-synthetic.ts
 *
 * Seeded: the same files every run.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { exampleWellBrief, forge16aWellheads, forgeSeismicSection } from "@ikhmalputra/subsurface-core";
import { reprojectGisXY } from "@ikhmalputra/subsurface-core/gis";
import { formatLas, parseLas } from "@ikhmalputra/subsurface-core/records";
import { writeQuakeML } from "@ikhmalputra/subsurface-core/quakeml";
import type { QuakeEvent } from "@ikhmalputra/subsurface-core/quakeml";
import { WATER, annulusCompliance, flowingTemperature, thermalApb } from "@ikhmalputra/subsurface-core/integrity";
import { tvdAtMd } from "@ikhmalputra/subsurface-core/well-design";
import { stimulate } from "../src/compute/stimulation.ts";
import { defaultStimulation, neighbours, stimulationJob } from "../src/data/stimulation-model.ts";
import { annuliOf, rameyOf } from "../src/data/integrity-model.ts";
import { kestrelSynthetic } from "../src/data/kestrel-tests.ts";
import { JOB_START_ISO, KESTREL_FIRST_PRODUCTION, SYNTHETIC_FILES } from "../src/data/synthetic.ts";

const out = new URL("../../../packages/fixtures/data/synthetic/", import.meta.url);
mkdirSync(out, { recursive: true });
const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r());

// ── FORGE: the catalogue ─────────────────────────────────────────────────────────────────────
{
  const las = parseLas(readFileSync(new URL("../../../packages/fixtures/data/forge-16a-openhole-1ft.las", import.meta.url), "utf8"));
  // The hidden truth: not the module's defaults.
  const truth = { ...defaultStimulation, diffusivity: 0.11, shmaxAzimuthDeg: 31, shmaxRatio: 0.58, sizeExponent: 3.25, stressDropMPa: 1.6, frictionMean: 0.63, netPressurePsi: 380 };
  const job = { ...stimulationJob(las, truth), seed: 7919 };
  const { events } = stimulate(job);
  const r = rng(42);
  // The array: geophones down 58-32 from 1,800 to 2,300 m; the smallest event it detects grows with distance.
  const array = neighbours.find((w) => w.id !== "16b")!.points.filter((p) => p.mdM >= 1800 && p.mdM <= 2300);
  const head = forge16aWellheads.asBuilt, t0 = Date.parse(JOB_START_ISO);
  const picked: QuakeEvent[] = [];
  for (const e of events) {
    const d = Math.min(...array.map((p) => Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z)));
    const mwMin = -1.55 + 1.6 * Math.log10(Math.max(100, d) / 300);
    const mw = e.mw + 0.1 * gauss(r);
    if (mw < mwMin) continue;
    const hErr = 8 + d * 0.02, zErr = 14 + d * 0.035;
    const x = e.x + hErr * gauss(r), y = e.y + hErr * gauss(r), z = e.z + zErr * gauss(r);
    const [longitude, latitude] = reprojectGisXY([head.eastingM + x, head.northingM + y], "EPSG:26912", "EPSG:4326");
    const time = new Date(t0 + (e.tS + 0.02 * gauss(r)) * 1000).toISOString();
    picked.push({ id: `smi:subsurface-workbench/forge-16a-2022-synthetic/event/${picked.length + 1}`, time, timeUncertaintyS: 0.02, latitude: latitude!, longitude: longitude!, depthM: -z, horizontalUncertaintyM: Math.round(hErr), depthUncertaintyM: Math.round(zErr), magnitude: Math.round(mw * 100) / 100, magnitudeType: "Mw", evaluationMode: "automatic", type: "induced or triggered event" });
  }
  const xml = writeQuakeML({
    publicId: "smi:subsurface-workbench/forge-16a-2022-synthetic", agency: "SW-SYNTHETIC", creationTime: "2026-10-17T00:00:00Z",
    description: `SYNTHETIC catalogue standing in for FORGE 16A(78)-32's April 2022 stimulation microseismicity (the Geo-Energie Suisse catalogue on the GDR, not downloaded). Generated from a hidden model (D ${truth.diffusivity} m2/s, SHmax N${truth.shmaxAzimuthDeg}E, size exponent ${truth.sizeExponent}, stress drop ${truth.stressDropMPa} MPa), detected by an assumed geophone array in 58-32, with location and magnitude noise. Depths below sea level. Job start ${JOB_START_ISO} is approximate (the record gives 14-24 April 2022).`,
    events: picked,
  });
  writeFileSync(new URL(SYNTHETIC_FILES.catalogue, out), xml);
  console.log(`catalogue: ${picked.length} of ${events.length} model events detected, ${(xml.length / 1e6).toFixed(2)} MB`);
  void forgeSeismicSection;
}

// ── Kestrel A-7: the temperature survey and the annulus record ──────────────────────────────────
{
  const brief = exampleWellBrief();
  const annuli = annuliOf(brief);
  if (typeof annuli === "string") throw new Error(annuli);
  const sample = kestrelSynthetic(brief)!;
  const first = sample.tests[0]!;
  const producingMdM = brief.completion!.packerMdM + 60;
  // The hidden rock: a conductivity the lens does not assume (it starts from 1.4 Btu/hr·ft·°F).
  const truthRamey = { ...rameyOf(brief, first.liquidRate, first.waterCut, producingMdM), earthConductivity: 2.05 };
  const r = rng(7);
  // DTS along the tubing after 30 days, every 2 m MD.
  const hours = 30 * 24;
  const md: number[] = [], temp: number[] = [];
  for (let m = 0; m <= producingMdM; m += 2) { md.push(m); temp.push(flowingTemperature(truthRamey, tvdAtMd(brief, m) * 3.28084, hours) + 0.35 * gauss(r)); }
  writeFileSync(new URL(SYNTHETIC_FILES.dts, out), formatLas({
    comments: ["SYNTHETIC distributed temperature survey for Kestrel A-7 (a design, not a drilled well).", "Generated from Ramey's flowing temperature with a hidden rock conductivity and 0.35 degF gauge noise."],
    well: [
      { mnemonic: "WELL", unit: "", value: "Kestrel A-7", description: "Well name" },
      { mnemonic: "FLD", unit: "", value: "Kestrel", description: "Field" },
      { mnemonic: "COMP", unit: "", value: "Example Energy", description: "Operator" },
      { mnemonic: "SRVC", unit: "", value: "SYNTHETIC DTS", description: "Service company" },
      { mnemonic: "DATE", unit: "", value: new Date(Date.parse(KESTREL_FIRST_PRODUCTION) + hours * 3.6e6).toISOString().slice(0, 10), description: "Survey date" },
    ],
    parameters: [
      { mnemonic: "TPROD", unit: "H", value: String(hours), description: "Time on production at the survey" },
      { mnemonic: "QLIQ", unit: "STB/D", value: first.liquidRate.toFixed(0), description: "Liquid rate during the survey" },
      { mnemonic: "WCUT", unit: "FRAC", value: first.waterCut.toFixed(3), description: "Water cut during the survey" },
      { mnemonic: "PRODMD", unit: "M", value: String(producingMdM), description: "Producing depth, MD" },
      { mnemonic: "FIBER", unit: "", value: "tubing-conveyed", description: "Fibre deployment" },
    ],
    curves: [
      { mnemonic: "DEPT", unit: "M", value: "", description: "Measured depth", values: md, digits: 1 },
      { mnemonic: "TEMP", unit: "DEGF", value: "", description: "Fibre temperature, tubing", values: temp, digits: 2 },
    ],
  }));

  // Annulus pressures, hourly, 120 days. Heat shares the lens does not assume; a leak behind B's cement.
  const share: Readonly<Record<string, number>> = { A: 0.85, B: 0.6, C: 0.5 };
  const thermalAt = (name: string, h: number) => {
    const a = annuli.find((x) => x.name === name)!, steps = 24;
    let rise = 0;
    for (let k = 0; k <= steps; k++) { const z = a.bottomTvdFt * k / steps; rise += flowingTemperature(truthRamey, z, h) - (truthRamey.surfaceF + truthRamey.gradientFPerFt * z); }
    return thermalApb(share[name]! * rise / (steps + 1), WATER.alphaPerF, WATER.kappaPerPsi, annulusCompliance(a.outerIdIn, a.outerWallIn, a.innerOdIn, a.innerWallIn));
  };
  const N = 120 * 24, etim: number[] = [], series: Record<string, number[]> = { A: [], B: [], C: [] };
  const bleedFrom = 45 * 24, bleedFor = 8, leakFrom = 25 * 24, leakSource = 2650, leakTau = 70, valveTau = 1.4;
  const p: Record<string, number> = { A: 0, B: 0, C: 0 };
  for (let h = 0; h <= N; h++) {
    for (const name of ["A", "B", "C"]) {
      const dTh = h === 0 ? 0 : thermalAt(name, Math.max(0.1, h)) - thermalAt(name, Math.max(0.1, h - 1));
      let next = p[name]! + dTh;
      if (name === "B" && h >= leakFrom) next += (leakSource - next) / leakTau;
      if ((name === "B" || name === "C") && h >= bleedFrom && h < bleedFrom + bleedFor) next *= Math.exp(-1 / valveTau);
      p[name] = Math.max(0, next);
    }
    etim.push(h);
    for (const name of ["A", "B", "C"]) series[name]!.push(Math.max(0, p[name]! + 4 * gauss(r)));
  }
  writeFileSync(new URL(SYNTHETIC_FILES.annulus, out), formatLas({
    comments: ["SYNTHETIC annulus pressure record for Kestrel A-7, hourly from first production, as a SCADA historian exports it.", "B and C bled through a 1/2-inch needle valve on day 45 (8 hours); B has a leak behind its cement from day 25."],
    well: [
      { mnemonic: "WELL", unit: "", value: "Kestrel A-7", description: "Well name" },
      { mnemonic: "FLD", unit: "", value: "Kestrel", description: "Field" },
      { mnemonic: "SRVC", unit: "", value: "SYNTHETIC SCADA", description: "Source" },
      { mnemonic: "DATE", unit: "", value: KESTREL_FIRST_PRODUCTION, description: "First production, ETIM zero" },
    ],
    parameters: [
      { mnemonic: "BLEED", unit: "H", value: `${bleedFrom}`, description: "Diagnostic bleed of B and C starts (ETIM)" },
      { mnemonic: "BLDUR", unit: "H", value: `${bleedFor}`, description: "Bleed duration, 1/2-inch needle valve" },
    ],
    curves: [
      { mnemonic: "ETIM", unit: "H", value: "", description: "Elapsed time on production", values: etim, digits: 0 },
      { mnemonic: "PA_A", unit: "PSIG", value: "", description: "A annulus (tubing x production casing) pressure", values: series.A!, digits: 1 },
      { mnemonic: "PA_B", unit: "PSIG", value: "", description: "B annulus pressure", values: series.B!, digits: 1 },
      { mnemonic: "PA_C", unit: "PSIG", value: "", description: "C annulus pressure", values: series.C!, digits: 1 },
    ],
  }));
  console.log(`kestrel: DTS ${md.length} samples, annulus ${etim.length} hours; B before bleed ${series.B![bleedFrom - 1]!.toFixed(0)} psi, 24 h after ${series.B![bleedFrom + bleedFor + 24]!.toFixed(0)} psi; C ${series.C![bleedFrom - 1]!.toFixed(0)} → ${series.C![bleedFrom + bleedFor + 24]!.toFixed(0)}`);
}
