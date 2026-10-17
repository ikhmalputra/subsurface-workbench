import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseLas } from "@ikhmalputra/subsurface-core/records";
import { bValue, completeness } from "@ikhmalputra/subsurface-core/induced-seismicity";
import { defaultStimulation, fieldFrom, stagesFor, stimulationJob, well16a } from "../src/data/stimulation-model.ts";
import { stimulate } from "../src/compute/stimulation.ts";

const las = parseLas(readFileSync(new URL("../../../packages/fixtures/data/forge-16a-openhole-1ft.las", import.meta.url), "utf8"));

test("FORGE stimulation: 16A's stresses, the 2022 stages on its path, and a cloud with b ≈ 1 along SHmax", () => {
  const field = fieldFrom(las, defaultStimulation);
  // 16A's IsoMechPro gradients over the toe: Sv above Shmin above pore, as a normal-to-strike-slip granite.
  assert.ok(field.svGrad > field.shminGrad && field.shminGrad > field.ppGrad, JSON.stringify(field));
  assert.ok(field.svGrad > 1 && field.svGrad < 1.2 && field.ppGrad > 0.4 && field.ppGrad < 0.5);
  const stages = stagesFor(defaultStimulation);
  assert.equal(stages.length, 3);
  // The stages sit on 16A, deepest first, below 2,600 m TVD (16A's toe is about 2,600 m below its RKB).
  assert.ok(stages[0]!.center.z < stages[2]!.center.z, "stage 1 is the deepest");
  assert.ok(Math.abs(stages[0]!.center.z - well16a.at(-1)!.z) < 60);
  // 4,258 bbl at 50 bpm is about 85 minutes.
  assert.ok(Math.abs((stages[0]!.endS - stages[0]!.startS) / 60 - 85) < 2);
  const result = stimulate(stimulationJob(las, defaultStimulation));
  assert.ok(result.events.length > 100, `${result.events.length} events`);
  const mags = result.events.map((e) => Math.round(e.mw * 10) / 10);
  const b = bValue(mags, completeness(mags)).b;
  assert.ok(b > 0.8 && b < 1.3, `b ${b}`);
  // Each stage's cloud is longer along SHmax (N25°E) than across it.
  const a = 25 * Math.PI / 180;
  for (const id of ["1", "3"]) {
    const ev = result.events.filter((e) => e.stage === id), s = stages.find((x) => x.id === id)!;
    const sd = (u: (e: { x: number; y: number }) => number) => { const v = ev.map(u), m = v.reduce((x, y) => x + y, 0) / v.length; return Math.sqrt(v.reduce((x, y) => x + (y - m) ** 2, 0) / v.length); };
    const along = sd((e) => (e.x - s.center.x) * Math.sin(a) + (e.y - s.center.y) * Math.cos(a)), across = sd((e) => (e.x - s.center.x) * Math.cos(a) - (e.y - s.center.y) * Math.sin(a));
    assert.ok(along > 1.3 * across, `stage ${id}: along ${along} across ${across}`);
  }
});
