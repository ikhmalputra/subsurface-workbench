import { bubblePoint, inflow, oilFvf, oilViscosity, operatingPoint, outflowCurve, rateGrid, syntheticWellTests, tankStep, traverse } from "@ikhmalputra/subsurface-core/production";
import type { ProductionMonth, Tank, TankState } from "@ikhmalputra/subsurface-core/production";
import type { LabPvt, WellTest } from "@ikhmalputra/subsurface-core/production";
import type { WellDesignBrief } from "@ikhmalputra/subsurface-core";
import { FT_PER_M, defaultNodal, modelOf, wellCase } from "./nodal-model.ts";

/**
 * A synthetic test history for Kestrel A-7, so the match has something to match: generated from a
 * hidden "true" well (Hagedorn & Brown with its holdup and friction off the plain correlation, a
 * fluid whose lab values sit off Standing's, pressure falling, skin growing, water cut rising, lift
 * gas from mid-2025; the reservoir pressure from a hidden tank of 120 MMSTB with a small aquifer,
 * drawn down by what the true well produces month by month) with gauge, meter and build-up noise. Shown as synthetic wherever it appears.
 * The truth is kept here, apart from the module, so the match is a real test of the method.
 */
export const SYNTHETIC_NOTE = "Synthetic: generated from a hidden well model with measurement noise, to show the match. Replace with the well's own tests.";

/** The hidden tank's size and aquifer: what the forecast's pressure match should find. */
export const TRUE_STOIIP = 120e6, TRUE_AQUIFER = 1;

export function kestrelSynthetic(brief: WellDesignBrief): { readonly tests: WellTest[]; readonly lab: LabPvt; readonly production: ProductionMonth[] } | null {
  const truthInputs = { ...defaultNodal, api: 33, gasSg: 0.78, gor: 480, permeabilityMd: 42, skin: 1.5 };
  const well = wellCase(brief, truthInputs);
  if (typeof well === "string") return null;
  const tuning = { pbFactor: 1.06, boFactor: 1.015, muFactor: 1.2 };
  const model = modelOf(well, tuning);
  const start = Date.parse("2024-03-01");
  const days = (date: string) => (Date.parse(date) - start) / 86400000;
  const dates = ["2024-03-01", "2024-07-01", "2024-11-01", "2025-03-01", "2025-07-01", "2025-11-01", "2026-03-01", "2026-07-01", "2026-09-15"];
  const plan = dates.map((date, i) => ({ date, whp: 330 - 10 * i, waterCut: Math.min(0.55, 0.05 + 0.055 * i), gor: 480, liftGasScfD: date >= "2025-07-01" ? 1_000_000 : 0, buildUp: i % 2 === 0 }));
  const skinAt = (date: string) => 1.5 + 3.5 * days(date) / 900;
  // The hidden tank, produced month by month by the true well (the plan's conditions held between tests, water cut and wellhead pressure eased between them).
  const tank: Tank = { stoiip: TRUE_STOIIP, initialPressure: well.reservoir.pressure, tempF: well.reservoir.tempF, fluid: { ...model.fluid, gor: 480 }, swi: 0.2, cw: 3e-6, cf: 5e-6, aquifer: TRUE_AQUIFER };
  const flow = { correlation: "hagedorn-brown" as const, holdupFactor: 1.08, frictionFactor: 1.25 };
  const conditions = (date: string) => {
    const i = Math.max(0, plan.findLastIndex((p) => p.date <= date)), a = plan[i]!, b = plan[Math.min(plan.length - 1, i + 1)]!;
    const f = b === a ? 0 : (Date.parse(date) - Date.parse(a.date)) / (Date.parse(b.date) - Date.parse(a.date));
    return { whp: a.whp + (b.whp - a.whp) * f, waterCut: a.waterCut + (b.waterCut - a.waterCut) * f, liftGasScfD: a.liftGasScfD };
  };
  const track: { t: number; p: number }[] = [], production: ProductionMonth[] = [];
  let state: TankState = { p: tank.initialPressure, np: 0, wp: 0, gp: 0 };
  for (let t = start; t <= Date.parse(dates.at(-1)!) + 86400000 * 31;) {
    const date = new Date(t).toISOString().slice(0, 10), c = conditions(date);
    track.push({ t, p: state.p });
    const ipr = inflow({ ...well.reservoir, pressure: state.p, skin: skinAt(date) }, tank.fluid);
    const point = operatingPoint(ipr, outflowCurve(rateGrid(ipr.aof, 16), (q) => traverse({ whp: c.whp + 14.7, fluid: tank.fluid, liquidRate: q, waterCut: c.waterCut, tubing: { ...model.tubing, liftGasScfD: c.liftGasScfD }, path: model.path, tempAt: model.tempAt, stepFt: 300, ...flow }).bottomPressure));
    const next = new Date(t); next.setUTCMonth(next.getUTCMonth() + 1);
    const d = (next.getTime() - t) / 86400000, q = point?.rate ?? 0;
    const after = tankStep(tank, state, q * (1 - c.waterCut) * d, q * c.waterCut * d);
    // Allocation is good to a few per cent: the meters are the well's tests, the field's export is shared out by them.
    const noise = 1 + 0.03 * Math.sin(production.length * 12.9898 + 4.1);
    if (t <= Date.parse(dates.at(-1)!)) production.push({ month: date.slice(0, 7), oil: Math.round((after.np - state.np) * noise), water: Math.round((after.wp - state.wp) * noise), gas: Math.round((after.gp - state.gp) * noise) });
    state = after;
    t = next.getTime();
  }
  const pressureOn = (date: string) => { const t = Date.parse(date), i = Math.max(0, track.findLastIndex((r) => r.t <= t)), a = track[i]!, b = track[Math.min(track.length - 1, i + 1)]!; return b === a ? a.p : a.p + (b.p - a.p) * (t - a.t) / (b.t - a.t); };
  const reservoirAt = (date: string) => ({ ...well.reservoir, pressure: pressureOn(date), skin: skinAt(date) });
  const tests = syntheticWellTests({ model, flow, reservoirAt, plan, gaugeMdFt: Math.max(100, (brief.completion?.packerMdM ?? 2800) - 20) * FT_PER_M, gaugeNoisePsi: 8, rateNoise: 0.02, seed: 47 });
  const t = well.reservoir.tempF, fluid = { ...model.fluid, gor: 480 }, pb = bubblePoint(fluid, t);
  // The lab's numbers, rounded as a report prints them.
  const lab: LabPvt = { bubblePoint: Math.round(pb), rsb: 480, boAtPb: Math.round(oilFvf(fluid, pb, t) * 1000) / 1000, muAtPb: Math.round(oilViscosity(fluid, pb, t) * 100) / 100, api: 33, gasSg: 0.78 };
  return { tests, lab, production };
}
