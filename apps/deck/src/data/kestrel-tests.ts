import { bubblePoint, oilFvf, oilViscosity, syntheticWellTests } from "@ikhmalputra/subsurface-core/production";
import type { LabPvt, WellTest } from "@ikhmalputra/subsurface-core/production";
import type { WellDesignBrief } from "@ikhmalputra/subsurface-core";
import { FT_PER_M, defaultNodal, modelOf, wellCase } from "./nodal-model.ts";

/**
 * A synthetic test history for Kestrel A-7, so the match has something to match: generated from a
 * hidden "true" well (Hagedorn & Brown with its holdup and friction off the plain correlation, a
 * fluid whose lab values sit off Standing's, pressure falling, skin growing, water cut rising, lift
 * gas from mid-2025) with gauge, meter and build-up noise. Shown as synthetic wherever it appears.
 * The truth is kept here, apart from the module, so the match is a real test of the method.
 */
export const SYNTHETIC_NOTE = "Synthetic: generated from a hidden well model with measurement noise, to show the match. Replace with the well's own tests.";

export function kestrelSynthetic(brief: WellDesignBrief): { readonly tests: WellTest[]; readonly lab: LabPvt } | null {
  const truthInputs = { ...defaultNodal, api: 33, gasSg: 0.78, gor: 480, permeabilityMd: 42, skin: 1.5 };
  const well = wellCase(brief, truthInputs);
  if (typeof well === "string") return null;
  const tuning = { pbFactor: 1.06, boFactor: 1.015, muFactor: 1.2 };
  const model = modelOf(well, tuning);
  const start = Date.parse("2024-03-01");
  const days = (date: string) => (Date.parse(date) - start) / 86400000;
  const reservoirAt = (date: string) => ({ ...well.reservoir, pressure: well.reservoir.pressure - 1.1 * days(date), skin: 1.5 + 3.5 * days(date) / 900 });
  const dates = ["2024-03-01", "2024-07-01", "2024-11-01", "2025-03-01", "2025-07-01", "2025-11-01", "2026-03-01", "2026-07-01", "2026-09-15"];
  const plan = dates.map((date, i) => ({ date, whp: 330 - 10 * i, waterCut: Math.min(0.55, 0.05 + 0.055 * i), gor: 480, liftGasScfD: date >= "2025-07-01" ? 1_000_000 : 0, buildUp: i % 3 === 0 }));
  const tests = syntheticWellTests({ model, flow: { correlation: "hagedorn-brown", holdupFactor: 1.08, frictionFactor: 1.25 }, reservoirAt, plan, gaugeMdFt: Math.max(100, (brief.completion?.packerMdM ?? 2800) - 20) * FT_PER_M, gaugeNoisePsi: 8, rateNoise: 0.02, seed: 47 });
  const t = well.reservoir.tempF, fluid = { ...model.fluid, gor: 480 }, pb = bubblePoint(fluid, t);
  // The lab's numbers, rounded as a report prints them.
  const lab: LabPvt = { bubblePoint: Math.round(pb), rsb: 480, boAtPb: Math.round(oilFvf(fluid, pb, t) * 1000) / 1000, muAtPb: Math.round(oilViscosity(fluid, pb, t) * 100) / 100, api: 33, gasSg: 0.78 };
  return { tests, lab };
}
