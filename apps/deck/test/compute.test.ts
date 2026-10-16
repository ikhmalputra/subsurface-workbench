import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { computeMinimumCurvature, forgeDesign, metresToFeet } from "@ikhmalputra/subsurface-core";
import { compute } from "../src/compute/run.ts";
import { transferables } from "../src/compute/transfer.ts";

// The compute worker's jobs, run here (Node has no module workers, so `compute` runs them inline,
// exactly as a browser without workers would): on the real FORGE files, with their results checked.
const buffer = (name: string) => { const b = readFileSync(new URL(`../../../packages/fixtures/data/${name}`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const survey = computeMinimumCurvature(forgeDesign.survey!.map((s) => ({ mdM: s.mdM, inclinationDeg: s.inclinationDeg, azimuthDeg: s.azimuthDeg })));

test("LAS and SEG-Y parse through compute", async () => {
  const las = await compute("lasFromBuffer", buffer("forge-16a-openhole-1ft.las"));
  assert.ok(las.curves.length > 10 && las.curves[0]!.values.length > 4000);
  const segy = await compute("segyFromBuffer", buffer("forge-16a-psdm-section.sgy"));
  assert.equal(segy.data.length, segy.traceCount * segy.sampleCount);
});

test("the earth model runs as a job: 16A's granite every 25 ft, with collapse and breakdown", async () => {
  const las = await compute("lasFromBuffer", buffer("forge-16a-openhole-1ft.las"));
  const rows = await compute("geomechanicsRows", las, survey, "5832");
  assert.ok(rows.length > 150, `${rows.length} rows`);
  assert.ok(rows.every((row) => row.sv > row.pp && Number.isFinite(row.tvdFt)));
  assert.ok(rows.some((row) => row.collapse !== null) && rows.some((row) => row.breakdown !== null));
});

test("torque and drag runs as a job: fitted on the reports, pick-up above slack-off at TD", async () => {
  const stations = survey.map((s) => ({ mdFt: metresToFeet(s.mdM), inclinationDeg: s.inclinationDeg, azimuthDeg: s.azimuthDeg }));
  const tdFt = metresToFeet(survey.at(-1)!.mdM);
  const model = await compute("torqueAndDrag", stations, 5110, tdFt);
  assert.ok(model.fit.days > 10);
  assert.ok(model.curves.fitted.pickup.at(-1)!.value > model.curves.fitted.rotating.at(-1)!.value);
  assert.ok(model.curves.fitted.rotating.at(-1)!.value > model.curves.fitted.slackoff.at(-1)!.value);
  assert.ok(model.torque.length > 20 && model.torque.every((point) => point.value >= 0));
});

test("results hand their buffers over once each; views into a larger buffer are copied", () => {
  const shared = new Float64Array(8), part = new Float32Array(new ArrayBuffer(64), 0, 4);
  const found = transferables({ a: shared, b: { c: shared, d: [new Uint8Array(3)] }, e: part });
  assert.equal(found.length, 2);
  assert.ok(found.includes(shared.buffer as ArrayBuffer) && !found.includes(part.buffer as ArrayBuffer));
});
