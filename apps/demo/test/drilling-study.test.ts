import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { forgeOperations } from "@ikhmalputra/subsurface-core";
import { intervalEvidence, parseStudies, readDrillingLog, studySignature, validateScope } from "../src/lib/drilling-study.ts";

const source = readFileSync(new URL("../public/data/forge-16a-mudlog-10ft.las", import.meta.url), "utf8");
test("drilling evidence uses exact MD scope and excludes invalid ROP without inventing data", () => {
  const las = readDrillingLog(source);
  const result = intervalEvidence(las, forgeOperations, { topM: 130 * 0.3048, baseM: 150 * 0.3048 });
  assert.equal(result.rows.length, 2);
  assert.equal(result.validCount, 2);
  assert.ok(Math.abs(result.mean! - 81.6) < 0.0001);
  const invalid = { ...las, curves: las.curves.map((curve) => curve.mnemonic === "ROP" ? { ...curve, values: curve.values.map((value, index) => index === 0 ? -1 : index === 1 ? null : value) } : curve) };
  const empty = intervalEvidence(invalid, null, { topM: 130 * 0.3048, baseM: 150 * 0.3048 });
  assert.equal(empty.mean, null);
  assert.equal(empty.excludedCount, 2);
  assert.deepEqual(empty.runs, []);
});
test("study basis detects source edits; persisted studies validate and roundtrip", () => {
  assert.notEqual(studySignature(source, forgeOperations), studySignature(`${source}\n`, forgeOperations));
  const study = { version: 1, id: "study", wellId: forgeOperations.wellId, wellRevision: 1, question: "What changed?", scope: { topM: 100, baseM: 200 }, comparison: { topM: 0, baseM: 100 }, finding: "Observation", uncertainty: "Unknown cause", evidenceIds: ["comparison:rop"], sourceSignature: "123", savedAt: "2026-10-10T00:00:00Z", results: { target: { mean: 10, unit: "ft/h", validCount: 10, excludedCount: 2 }, comparison: { mean: 20, unit: "ft/h", validCount: 10, excludedCount: 0 } } };
  assert.deepEqual(parseStudies(JSON.stringify([study])), [study]);
  assert.throws(() => parseStudies(JSON.stringify([study, study])), /unique/);
  assert.throws(() => parseStudies(JSON.stringify([{ ...study, scope: { topM: 300, baseM: 200 } }])), /interval/);
  assert.throws(() => validateScope({ topM: 0, baseM: 400 }, 300), /interval/);
  assert.throws(() => readDrillingLog(source.replace("DEPTH.ft", "DEPTH.psi")), /DEPTH/);
});
