import { forge16aWellheads } from "@ikhmalputra/subsurface-core";
import { reprojectGisXY } from "@ikhmalputra/subsurface-core/gis";
import { lasCurve, parseLas } from "@ikhmalputra/subsurface-core/records";
import type { LasFile } from "@ikhmalputra/subsurface-core/records";
import { readQuakeML } from "@ikhmalputra/subsurface-core/quakeml";
import type { QuakeCatalogue } from "@ikhmalputra/subsurface-core/quakeml";

/**
 * The deck's standard-format data that is not downloaded yet, and how each is read: a QuakeML 1.2
 * catalogue, a depth-indexed LAS 2.0 temperature survey and a time-indexed LAS 2.0 annulus record.
 * The files under data/synthetic are generated (apps/deck/tools/make-synthetic.ts) and say so in
 * their headers; a real file in the same format is read the same way, from the module's "Load".
 * Pure: no Vite, so the tests and the generator read it too.
 */

export const SYNTHETIC_FILES = {
  catalogue: "forge-16a-stimulation-2022.synthetic.quakeml.xml",
  dts: "kestrel-a7-dts-day30.synthetic.las",
  annulus: "kestrel-a7-annulus-pressures.synthetic.las",
} as const;
/** When the model's job clock starts: approximate, inside the 14–24 April 2022 re-entry the record gives. */
export const JOB_START_ISO = "2022-04-16T15:00:00.000Z";
/** Kestrel A-7's first production (its synthetic history starts here). */
export const KESTREL_FIRST_PRODUCTION = "2024-03-01";

/** Whether a file says it is synthetic (its own header or description). */
export const isSynthetic = (text: string) => /SYNTHETIC/.test(text.slice(0, 4000));

// ── The catalogue, in the stimulation model's frame ─────────────────────────────────────────────
export interface ObservedEvent { readonly tS: number; readonly x: number; readonly y: number; readonly z: number; readonly mw: number; readonly hErr: number; readonly zErr: number; readonly id: string }
export interface ObservedCatalogue { readonly name: string; readonly synthetic: boolean; readonly events: readonly ObservedEvent[]; readonly magnitudeTypes: readonly string[]; readonly description: string; readonly skipped: number }

/**
 * A QuakeML catalogue in the model's frame: metres east and north of 16A's as-built wellhead
 * (UTM 12N, NAD83), elevation above sea level (QuakeML depths are below it), and seconds after the
 * job's start. Events outside 2 km of the toe are dropped and counted.
 */
export function catalogueInFrame(text: string, name: string, jobStartIso = JOB_START_ISO): ObservedCatalogue {
  const catalogue: QuakeCatalogue = readQuakeML(text);
  const head = forge16aWellheads.asBuilt, t0 = Date.parse(jobStartIso);
  const events: ObservedEvent[] = [];
  let skipped = 0;
  for (const e of catalogue.events) {
    const [east, north] = reprojectGisXY([e.longitude, e.latitude], "EPSG:4326", "EPSG:26912");
    const x = east! - head.eastingM, y = north! - head.northingM, z = -e.depthM, tS = (Date.parse(e.time) - t0) / 1000;
    if (!Number.isFinite(tS) || Math.hypot(x, y) > 2000 || z > 1000 || z < -3000) { skipped++; continue; }
    events.push({ tS, x, y, z, mw: e.magnitude, hErr: e.horizontalUncertaintyM ?? 0, zErr: e.depthUncertaintyM ?? 0, id: e.id });
  }
  events.sort((a, b) => a.tS - b.tS);
  return { name, synthetic: isSynthetic(text), events, magnitudeTypes: [...new Set(catalogue.events.map((e) => e.magnitudeType))], description: catalogue.description ?? "", skipped };
}

// ── LAS records ────────────────────────────────────────────────────────────────────────────────
const toF = (value: number, unit: string) => /DEGC|^C$/i.test(unit) ? value * 9 / 5 + 32 : value;
const toM = (value: number, unit: string) => /^F|FT/i.test(unit) ? value * 0.3048 : value;
const param = (las: LasFile, key: string) => { const v = Number(las.parameters[key]?.value); return Number.isFinite(v) ? v : null; };

export interface TemperatureSurvey { readonly name: string; readonly synthetic: boolean; readonly date: string; readonly mdM: readonly number[]; readonly tempF: readonly number[]; readonly hours: number | null; readonly rate: number | null; readonly waterCut: number | null; readonly producingMdM: number | null }
/** A depth-indexed temperature log (DTS, PLT or a gradient survey): DEPT and TEMP, any of °F or °C, m or ft. */
export function surveyFromLas(text: string, name: string): TemperatureSurvey {
  const las = parseLas(text);
  const depth = las.curves[0], temp = lasCurve(las, "TEMP") ?? las.curves.find((c) => /TEMP|DTS/i.test(c.mnemonic));
  if (!depth || !temp) throw new RangeError("The LAS file has no depth index and temperature curve (TEMP).");
  if (/TIME|ETIM/i.test(depth.mnemonic)) throw new RangeError("This LAS file is indexed by time; a temperature survey is indexed by depth.");
  const mdM: number[] = [], tempF: number[] = [];
  depth.values.forEach((d, i) => { const t = temp.values[i]; if (d !== null && t !== null && t !== undefined) { mdM.push(toM(d, depth.unit)); tempF.push(toF(t, temp.unit)); } });
  return { name, synthetic: isSynthetic(text), date: las.well.DATE?.value ?? "", mdM, tempF, hours: param(las, "TPROD"), rate: param(las, "QLIQ"), waterCut: param(las, "WCUT"), producingMdM: param(las, "PRODMD") };
}

export interface AnnulusRecord { readonly name: string; readonly synthetic: boolean; readonly start: string; readonly hours: readonly number[]; readonly psi: Readonly<Record<string, readonly (number | null)[]>> }
/** A time-indexed annulus pressure log: ETIM (or TIME) and one curve per annulus, PA_A, PA_B, PA_C… in psi(g), kPa or bar. */
export function annulusFromLas(text: string, name: string): AnnulusRecord {
  const las = parseLas(text);
  const index = las.curves[0];
  if (!index || !/TIME|ETIM/i.test(index.mnemonic)) throw new RangeError("An annulus record is indexed by time (ETIM or TIME) in its first curve.");
  const perHour = /^S$|SEC/i.test(index.unit) ? 1 / 3600 : /^MIN/i.test(index.unit) ? 1 / 60 : /^D$|DAY/i.test(index.unit) ? 24 : 1;
  const toPsi = (v: number | null, unit: string) => v === null ? null : /KPA/i.test(unit) ? v * 0.145038 : /BAR/i.test(unit) ? v * 14.5038 : v;
  const psi: Record<string, (number | null)[]> = {};
  for (const curve of las.curves.slice(1)) { const m = /^(?:PA|P|ANN)_?([A-D])$/i.exec(curve.mnemonic); if (m) psi[m[1]!.toUpperCase()] = curve.values.map((v) => toPsi(v, curve.unit)); }
  if (!Object.keys(psi).length) throw new RangeError("No annulus curves found (PA_A, PA_B, PA_C…).");
  return { name, synthetic: isSynthetic(text), start: las.well.DATE?.value ?? "", hours: index.values.map((v) => (v ?? NaN) * perHour), psi };
}
