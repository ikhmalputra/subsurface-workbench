import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { exampleWellBrief } from "@ikhmalputra/subsurface-core";
import { tvdAtMd } from "@ikhmalputra/subsurface-core/well-design";
import { bValue, completeness, frontDiffusivity } from "@ikhmalputra/subsurface-core/induced-seismicity";
import { bleedTests, calibrateConductivity } from "@ikhmalputra/subsurface-core/integrity";
import { SYNTHETIC_FILES, annulusFromLas, catalogueInFrame, surveyFromLas } from "../src/data/synthetic.ts";
import { annuliOf, annulusPressures, rameyOf } from "../src/data/integrity-model.ts";
import { STAGES_2022, defaultStimulation, stagesFor } from "../src/data/stimulation-model.ts";

const file = (name: string) => readFileSync(new URL(`../../../packages/fixtures/data/synthetic/${name}`, import.meta.url), "utf8");

test("The synthetic FORGE catalogue reads as QuakeML into the model's frame, around the stages, in their hours", () => {
  const c = catalogueInFrame(file(SYNTHETIC_FILES.catalogue), "synthetic");
  assert.ok(c.synthetic, "it says it is synthetic");
  assert.ok(c.events.length > 150, `${c.events.length}`);
  assert.equal(c.skipped, 0);
  assert.deepEqual(c.magnitudeTypes, ["Mw"]);
  const stages = stagesFor(defaultStimulation);
  // Every event within 700 m of a stage and after the job starts.
  for (const e of c.events) {
    assert.ok(e.tS >= 0, `${e.tS}`);
    assert.ok(Math.min(...stages.map((s) => Math.hypot(e.x - s.center.x, e.y - s.center.y, e.z - s.center.z))) < 700);
  }
  // The detected events' b is near 1. The r–t front is measured from the stage, and the hydraulic
  // fracture carries the pressure out along SHmax before it diffuses, so the front reads a larger D
  // than the rock's (0.11 m²/s hidden): only its order is checked.
  const mags = c.events.map((e) => Math.round(e.mw * 10) / 10);
  const b = bValue(mags, completeness(mags)).b;
  assert.ok(b > 0.7 && b < 1.5, `b ${b}`);
  const s1 = stages.find((s) => s.id === "1")!;
  const D = frontDiffusivity(c.events.filter((e) => e.tS < STAGES_2022[1]!.startH * 3600).map((e) => ({ tS: e.tS - s1.startS, r: Math.hypot(e.x - s1.center.x, e.y - s1.center.y, e.z - s1.center.z) })));
  assert.ok(D > 0.02 && D < 2, `D ${D}`);
});

test("Kestrel's synthetic DTS calibrates the rock: the hidden conductivity (2.05) inside the range found, not the assumed 1.4", () => {
  const brief = exampleWellBrief();
  const s = surveyFromLas(file(SYNTHETIC_FILES.dts), "synthetic");
  assert.ok(s.synthetic && s.hours === 720 && s.rate! > 0);
  const base = rameyOf(brief, s.rate!, s.waterCut!, s.producingMdM!);
  const fit = calibrateConductivity(base, s.hours!, s.mdM.map((m, i) => ({ tvdFt: tvdAtMd(brief, m) * 3.28084, tempF: s.tempF[i]! })));
  assert.ok(fit.range[0] <= 2.05 && fit.range[1] >= 2.05, `k ${fit.k}, range ${fit.range}`);
  assert.ok(!(fit.range[0] <= 1.4 && fit.range[1] >= 1.4), `the assumed 1.4 should be excluded: ${fit.range}`);
  assert.ok(fit.rmsF < 0.6, `${fit.rmsF}`);
});

test("Kestrel's synthetic annulus record: B builds back beyond heat after its bleed (SCP), C does not", () => {
  const brief = exampleWellBrief();
  const annuli = annuliOf(brief);
  assert.ok(typeof annuli !== "string");
  const rec = annulusFromLas(file(SYNTHETIC_FILES.annulus), "synthetic");
  assert.equal(rec.start, "2024-03-01");
  assert.deepEqual(Object.keys(rec.psi).sort(), ["A", "B", "C"]);
  const s = surveyFromLas(file(SYNTHETIC_FILES.dts), "synthetic");
  const ramey = rameyOf(brief, s.rate!, s.waterCut!, s.producingMdM!);
  const thermal = (name: string) => (h: number) => annulusPressures(annuli, ramey, Math.max(0.1, h), null, {}).find((r) => r.annulus.name === name)!.thermal;
  const b = bleedTests(rec.hours, rec.psi.B!, thermal("B")), c = bleedTests(rec.hours, rec.psi.C!, thermal("C"));
  assert.equal(b.length, 1); assert.equal(c.length, 1);
  assert.ok(Math.abs(b[0]!.startH - 1080) <= 1, `${b[0]!.startH}`);
  assert.ok(b[0]!.bledToZero && b[0]!.sustained, JSON.stringify(b[0]));
  assert.ok(c[0]!.bledToZero && !c[0]!.sustained, JSON.stringify(c[0]));
  assert.equal(bleedTests(rec.hours, rec.psi.A!, thermal("A")).length, 0, "A was never bled");
});
