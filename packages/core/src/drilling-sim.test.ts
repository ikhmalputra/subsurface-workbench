import assert from "node:assert/strict";
import test from "node:test";
import { DrillingSimulator, hazardsFromPlan } from "./drilling-sim.ts";
import type { DrillingSimulator as Sim, Hazard } from "./drilling-sim.ts";
import { exampleWellBrief, PSI_PER_M_PER_SG } from "./well-design.ts";

const brief = exampleWellBrief();
const PRODUCTION = 4; // the 8½″ hole for the 7″ production casing
const gasSand = (topMdM: number, extraSg: number): Hazard => ({ kind: "overpressure", topMdM, baseMdM: topMdM + 15, extraSg, gas: true, label: "Gas sand" });
const run = (sim: Sim, seconds: number, until?: (s: Sim) => boolean) => { for (let t = 0; t < seconds; t++) { sim.step(1); if (until?.(sim) || sim.now.mode === "blowout" || sim.now.mode === "section-td") break; } return sim.now; };

test("the plan's named hazards become hazards in the rock", () => {
  const hazards = hazardsFromPlan(brief, 1);
  assert.deepEqual(hazards.map((h) => h.kind).sort(), ["overpressure", "weak-zone"]);
  assert.ok(hazards.every((h) => /Shallow gas|Lost circulation/.test(h.label)));
});

test("drilled on the plan's mud weight, the production hole reaches TD without a kick", () => {
  const sim = new DrillingSimulator({ brief, sectionIndex: PRODUCTION, seed: 1 });
  let maxSpp = 0, maxEcd = 0;
  const rops: number[] = [];
  for (let h = 0; h < 120 && sim.now.mode !== "section-td"; h++) {
    const r = sim.step(3600, 5);
    if (r.mode === "drilling") { maxSpp = Math.max(maxSpp, r.sppPsi); maxEcd = Math.max(maxEcd, r.ecdBitSg); rops.push(r.ropMh); }
  }
  assert.equal(sim.now.mode, "section-td");
  assert.equal(sim.now.holeMdM, sim.targetMdM);
  assert.equal(sim.now.truth.influxInHoleBbl, 0);
  assert.ok(!sim.events.some((e) => e.level === "alarm" || e.level === "disaster"), sim.events.map((e) => e.text).join("\n"));
  assert.ok(maxEcd > sim.section.mudWeightSg && maxEcd < sim.section.mudWeightSg + 0.2, `ECD ${maxEcd}`);
  assert.ok(maxSpp > 1000 && maxSpp < 5000, `SPP ${maxSpp}`);
  const rop = rops.reduce((a, b) => a + b, 0) / rops.length;
  assert.ok(rop > 5 && rop < 40, `ROP ${rop}`);
});

test("a gas kick is seen at surface, shut in as gas, and killed with the textbook kill mud", () => {
  const sim = new DrillingSimulator({ brief, sectionIndex: PRODUCTION, seed: 3, hazards: [gasSand(2400, 0.25)] });
  run(sim, 40 * 3600, (s) => s.events.some((e) => e.level === "alarm"));
  assert.ok(sim.now.holeMdM >= 2400 && sim.now.holeMdM < 2420, `alarm at ${sim.now.holeMdM}`);
  sim.command({ kind: "flow-check" });
  run(sim, 600, (s) => s.now.flowOutGpm > 5);
  assert.ok(sim.now.flowOutGpm > 5, "the well flows with the pumps off");
  sim.command({ kind: "shut-in" });
  run(sim, 3600, (s) => s.killSheet() !== null);
  const sheet = sim.killSheet()!;
  assert.ok(sheet, "pressures settle and a kill sheet is ready");
  assert.ok(sheet.sicpPsi > sheet.sidppPsi, "gas in the annulus: casing above drill-pipe pressure");
  assert.equal(sheet.influxIs, "gas");
  const kmw = sheet.mudSg + sheet.sidppPsi / (PSI_PER_M_PER_SG * sheet.bitTvdM);
  assert.ok(sheet.killMudSg >= kmw && sheet.killMudSg - kmw < 0.011, `KMW ${sheet.killMudSg} vs ${kmw}`);
  assert.ok(Math.abs(sheet.fcpPsi - sheet.scrPsi * sheet.killMudSg / sheet.mudSg) < 1e-6);
  sim.command({ kind: "kill" });
  run(sim, 12 * 3600, (s) => s.now.mode === "killed");
  assert.equal(sim.now.mode, "killed");
  assert.ok(sim.now.truth.underbalancePsi < 0, "the kill mud holds the formation back");
  assert.ok(sim.events.some((e) => e.code === "influx-out"));
});

test("ignored, the same kick becomes a blowout", () => {
  const sim = new DrillingSimulator({ brief, sectionIndex: PRODUCTION, seed: 3, hazards: [gasSand(2400, 0.25)] });
  run(sim, 40 * 3600);
  assert.equal(sim.now.mode, "blowout");
  assert.ok(sim.events.findIndex((e) => e.level === "alarm") < sim.events.findIndex((e) => e.level === "disaster"), "the alarms came first");
});

test("a weak zone takes mud when the well pressure is above its fracture pressure", () => {
  const sim = new DrillingSimulator({ brief, sectionIndex: PRODUCTION, seed: 2, hazards: [{ kind: "weak-zone", topMdM: 2300, baseMdM: 2330, fractureSg: 1.55, label: "Fractured zone" }] });
  run(sim, 40 * 3600, (s) => s.now.lossRateBblMin > 0.5);
  assert.ok(sim.now.lossRateBblMin > 0.5, "losses start");
  assert.ok(sim.now.flowOutGpm < sim.now.flowInGpm, "flow out falls below flow in");
  assert.ok(sim.events.some((e) => e.code === "losses"));
});

test("the same seed drills the same well", () => {
  const a = new DrillingSimulator({ brief, sectionIndex: 3, seed: 9 }), b = new DrillingSimulator({ brief, sectionIndex: 3, seed: 9 });
  a.step(6 * 3600); b.step(6 * 3600);
  assert.deepEqual(a.history, b.history);
  const c = new DrillingSimulator({ brief, sectionIndex: 3, seed: 10 });
  c.step(6 * 3600);
  assert.notDeepEqual(a.now.holeMdM, c.now.holeMdM);
});

test("history keeps sampling every 10 simulated seconds whatever the step", () => {
  const sim = new DrillingSimulator({ brief, sectionIndex: PRODUCTION, seed: 4 });
  sim.step(7, 1); sim.step(600, 2); sim.step(600, 5); sim.step(33, 1); sim.step(600, 10);
  const times = sim.history.map((r) => r.timeS);
  const gaps = times.slice(1).map((t, i) => t - times[i]!);
  // At most one sample period plus one step (here 10 s steps): never the hundreds of seconds a misaligned step used to skip.
  assert.ok(Math.max(...gaps) <= 19, `largest gap ${Math.max(...gaps)} s`);
  assert.ok(times.at(-1)! >= sim.now.timeS - 10);
});

test("hole cleaning follows the trajectory: more annular velocity is needed in the tangent than in the vertical top hole", () => {
  const sim = new DrillingSimulator({ brief, sectionIndex: PRODUCTION, seed: 1 });
  const vertical = sim.cleaningVelocityAt(300), tangent = sim.cleaningVelocityAt(2400);
  assert.ok(Math.abs(vertical - 30) < 1, `vertical ${vertical}`);
  assert.ok(tangent > 50 && tangent < 60, `tangent ${tangent}`);
});
