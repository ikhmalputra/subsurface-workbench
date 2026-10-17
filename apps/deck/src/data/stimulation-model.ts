import { forge16aWellheads, forgeDesign, forgeNeighbours, forgeSeismicSection, wellPoints } from "@ikhmalputra/subsurface-core";
import type { FractureSet, PressureModel, Stage, StressField } from "@ikhmalputra/subsurface-core/induced-seismicity";
import { lasCurve } from "@ikhmalputra/subsurface-core/records";
import type { LasFile } from "@ikhmalputra/subsurface-core/records";
import type { StimulationJob } from "../compute/stimulation.ts";

/**
 * FORGE's April 2022 stimulation of 16A(78)-32 as the model takes it: the wells in one local frame
 * (metres east and north of 16A's as-built wellhead, elevation above sea level), the three stages
 * where the reports put them, the stresses and fracture intensity from 16A's own logs, and what is
 * assumed, said as such.
 */

const FT = 0.3048;
const RKB = forgeSeismicSection.rkbElevationM;
const head = forge16aWellheads.asBuilt;
export interface PathPoint { readonly mdM: number; readonly x: number; readonly y: number; readonly z: number }

/** 16A from its survey; 16B and 58-32 from their licensed wellheads and surveys, all in the frame. */
export const well16a: readonly PathPoint[] = (forgeDesign.survey ?? []).map((s) => ({ mdM: s.mdM, x: s.eastingM ?? 0, y: s.northingM ?? 0, z: RKB - s.tvdM }));
export const neighbours = forgeNeighbours.map((w) => ({ id: w.id, label: w.label, points: wellPoints(w).map((p) => ({ mdM: p.mdM, x: p.e - head.eastingM, y: p.n - head.northingM, z: p.z })) }));

/** The point on a path at a measured depth, straight between stations (the last beyond the end). */
export function pointAt(path: readonly PathPoint[], mdM: number): PathPoint {
  if (mdM <= path[0]!.mdM) return path[0]!;
  for (let i = 1; i < path.length; i++) if (mdM <= path[i]!.mdM) { const a = path[i - 1]!, b = path[i]!, f = (mdM - a.mdM) / (b.mdM - a.mdM || 1); return { mdM, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f }; }
  const a = path.at(-2)!, b = path.at(-1)!, f = (mdM - b.mdM) / (b.mdM - a.mdM || 1);
  return { mdM, x: b.x + (b.x - a.x) * f, y: b.y + (b.y - a.y) * f, z: b.z + (b.z - a.z) * f };
}

/**
 * The 2022 stages (FORGE's summary): stage 1 in the open hole below 10,787 ft at 50 bpm, about
 * 677 m³; stages 2 and 3 through perforations at 10,560–10,580 ft and 10,120–10,140 ft at 35 bpm.
 * 10,054 bbl in all, so the remainder is split evenly between 2 and 3. The days between stages are
 * approximate.
 */
export const STAGES_2022 = [
  { id: "1", label: "Stage 1 · open hole", topFt: 10787, baseFt: 10987, rateBpm: 50, volumeBbl: 4258, startH: 0, colour: "#f59e0b" },
  { id: "2", label: "Stage 2 · perforated", topFt: 10560, baseFt: 10580, rateBpm: 35, volumeBbl: 2898, startH: 96, colour: "#38bdf8" },
  { id: "3", label: "Stage 3 · perforated", topFt: 10120, baseFt: 10140, rateBpm: 35, volumeBbl: 2898, startH: 120, colour: "#f472b6" },
] as const;
const BPM = 0.158987 / 60;

export interface StimulationInputs {
  /** Which stages are pumped and each one's rate as a share of the reported rate. */
  readonly stages: Readonly<Record<string, boolean>>;
  readonly rateScale: number;
  /** Diffusivity (m²/s), net pressure over Shmin (psi), fluid efficiency, fracture width (mm). */
  readonly diffusivity: number;
  readonly netPressurePsi: number;
  readonly efficiency: number;
  readonly widthMm: number;
  readonly mode: "fracture" | "point";
  /** SHmax: where it sits between Shmin and Sv, and its azimuth. */
  readonly shmaxRatio: number;
  readonly shmaxAzimuthDeg: number;
  readonly frictionMean: number;
  readonly stressDropMPa: number;
  readonly sizeExponent: number;
  /** Traffic-light thresholds, moment magnitude. */
  readonly amber: number;
  readonly red: number;
}
export const defaultStimulation: StimulationInputs = {
  stages: { 1: true, 2: true, 3: true }, rateScale: 1, diffusivity: 0.05, netPressurePsi: 300, efficiency: 0.35, widthMm: 4, mode: "fracture",
  shmaxRatio: 0.5, shmaxAzimuthDeg: 25, frictionMean: 0.6, stressDropMPa: 1, sizeExponent: 3, amber: 1, red: 2,
};
/**
 * Natural fracture sets, assumed: two steep sets (about N15°E and N100°E) and a few gently dipping
 * joints, the pattern FORGE's image logs and DFN reports describe. FMI picks would replace these.
 */
export const FRACTURE_SETS: readonly FractureSet[] = [
  { strikeDeg: 15, dipDeg: 72, kappa: 18, weight: 0.55 },
  { strikeDeg: 100, dipDeg: 62, kappa: 14, weight: 0.33 },
  { strikeDeg: 200, dipDeg: 22, kappa: 10, weight: 0.12 },
];

/** A curve's value at a depth on 16A's regular 1 ft log grid; null where not reported. */
function valueAt(las: LasFile, mnemonic: string, mdM: number): number | null {
  const curve = lasCurve(las, mnemonic), first = las.curves[0]?.values[0];
  if (!curve || first === undefined || first === null) return null;
  const i = Math.floor(mdM / FT - first);
  return i < 0 || i >= curve.values.length ? null : curve.values[i] ?? null;
}

/** The stages at their places on 16A and their times and rates. */
export function stagesFor(inputs: StimulationInputs): Stage[] {
  return STAGES_2022.filter((s) => inputs.stages[s.id]).map((s) => {
    const c = pointAt(well16a, (s.topFt + s.baseFt) / 2 * FT), rate = s.rateBpm * BPM * inputs.rateScale, start = s.startH * 3600;
    return { id: s.id, label: s.label, center: { x: c.x, y: c.y, z: c.z }, startS: start, endS: start + s.volumeBbl * 0.158987 / rate, rateM3s: rate };
  });
}

/** The stress field from 16A's own logs (IsoMechPro gradients) averaged over the stimulated toe, with SHmax as set. */
export function fieldFrom(las: LasFile, inputs: StimulationInputs): StressField & { readonly source: string } {
  const mean = (mnemonic: string, fallback: number) => {
    const values: number[] = [];
    for (let ft = 10100; ft <= 10950; ft += 10) { const v = valueAt(las, mnemonic, ft * FT); if (v !== null && Number.isFinite(v) && v > 0) values.push(v); }
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : fallback;
  };
  return { svGrad: mean("SV_G", 1.13), shminGrad: mean("SHMIN_G", 0.74), ppGrad: mean("PP_G", 0.433), shmaxRatio: inputs.shmaxRatio, shmaxAzimuthDeg: inputs.shmaxAzimuthDeg, datumElevationM: RKB, source: "16A IsoMechPro gradients, 10,100–10,950 ft" };
}

/** Fracture density by elevation from the FMI's fracture intensity (P32) along 16A, normalised. */
export function densityFrom(las: LasFile) {
  const zM: number[] = [], raw: number[] = [];
  for (let ft = 9000; ft <= 10980; ft += 20) {
    const v = valueAt(las, "P32", ft * FT);
    if (v === null || !Number.isFinite(v)) continue;
    zM.push(pointAt(well16a, ft * FT).z); raw.push(Math.max(0, v));
  }
  // Elevation decreases with depth: sort upward, smooth over five samples, floor so no band is empty.
  const order = zM.map((_, i) => i).sort((a, b) => zM[a]! - zM[b]!);
  const z = order.map((i) => zM[i]!), r = order.map((i) => raw[i]!);
  const smooth = r.map((_, i) => { const w = r.slice(Math.max(0, i - 2), i + 3); return w.reduce((a, b) => a + b, 0) / w.length; });
  const top = Math.max(1e-6, ...smooth);
  return { zM: z, value: smooth.map((v) => Math.max(0.15, v / top)) };
}

/** The job the worker runs. */
export function stimulationJob(las: LasFile, inputs: StimulationInputs): StimulationJob {
  const stages = stagesFor(inputs);
  const all = STAGES_2022.map((s) => pointAt(well16a, (s.topFt + s.baseFt) / 2 * FT));
  const center = { x: all.reduce((a, p) => a + p.x, 0) / all.length, y: all.reduce((a, p) => a + p.y, 0) / all.length, z: all.reduce((a, p) => a + p.z, 0) / all.length };
  const field = fieldFrom(las, inputs);
  const model: PressureModel = { field, diffusivity: inputs.diffusivity, netPressurePa: inputs.netPressurePsi * 6894.757, efficiency: inputs.efficiency, widthM: inputs.widthMm / 1000, mode: inputs.mode };
  const until = Math.max(0, ...stages.map((s) => s.endS + (s.endS - s.startS) * 10));
  return {
    field, center, half: { x: 420, y: 420, z: 300 }, count: 90000, sets: FRACTURE_SETS, radiusMinM: 1.5, radiusMaxM: 80, sizeExponent: inputs.sizeExponent,
    muMean: inputs.frictionMean, muSd: 0.05, density: densityFrom(las), stages, model, untilS: until, stressDropPa: inputs.stressDropMPa * 1e6, seed: 2022,
  };
}
export const stageColour = (id: string) => STAGES_2022.find((s) => s.id === id)?.colour ?? "#e2e8f0";
