import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { analyse, analysesFile, forecastCsv, label, parseAnalysesFile, resultsOf, sameInputs } from "../src/data/dca.ts";
import type { DcaInputs, ProductionRecord, SavedAnalysis } from "../src/data/dca.ts";

// Saved decline analyses: the analysis they keep is the one the module draws, they survive a trip
// through a file unchanged, a bad file is refused with a reason, and the CSV holds the history and
// the forecast to the economic limit.
const record = JSON.parse(readFileSync(new URL("../../../packages/fixtures/data/sodir-field-production.json", import.meta.url), "utf8")) as ProductionRecord;
const statfjord: DcaInputs = { field: "STATFJORD", product: "oil", window: null, bMax: 1, limit: null };
const ok = (inputs: DcaInputs) => { const analysis = analyse(record, inputs); assert.equal(analysis.kind, "ok"); return analysis as Extract<ReturnType<typeof analyse>, { kind: "ok" }>; };

test("the default Statfjord oil analysis gives the module's numbers", () => {
  const analysis = ok(statfjord);
  const results = resultsOf(analysis)!;
  assert.equal(label(analysis.chosen[0]), "2016-08");
  assert.equal(label(analysis.chosen[1]), "2026-07");
  assert.equal(results.b, 1);
  assert.ok(Math.abs(results.eur - 589.86) < 0.01, `EUR ${results.eur}`);
  assert.ok(Math.abs(results.diNominalPct - 15.7) < 0.05, `Di ${results.diNominalPct}`);
  assert.equal(results.limitIsDefault, true);
});

test("a saved analysis survives a file unchanged, and reopens to the same numbers", () => {
  const analysis = ok({ ...statfjord, window: [2000 * 12, 2010 * 12 + 11], bMax: 0.5, limit: 200 });
  const results = resultsOf(analysis)!;
  const entry: SavedAnalysis = { id: "dca-test", name: "Statfjord, 2000s", note: "test", savedAt: 1, inputs: { ...statfjord, window: analysis.chosen, bMax: 0.5, limit: 200 }, results,
    source: { publisher: record.source.publisher, retrieved: record.source.retrieved, sha256: record.source.sha256 } };
  const [back] = parseAnalysesFile(analysesFile([entry]));
  assert.deepEqual(back, entry);
  const reopened = resultsOf(ok(back!.inputs))!;
  assert.deepEqual(reopened, results);
  assert.equal(results.limit, 200);
  assert.ok(sameInputs(back!.inputs, entry.inputs));
  assert.ok(!sameInputs(back!.inputs, { ...entry.inputs, bMax: 1 }));
});

test("a file that is not a saved analysis, or holds a broken one, is refused with a reason", () => {
  const good = JSON.parse(analysesFile([{ id: "a", name: "A", note: "", savedAt: 1, inputs: { ...statfjord, window: [24000, 24100] }, results: resultsOf(ok(statfjord))!, source: { publisher: "", retrieved: "", sha256: "" } }]));
  assert.throws(() => parseAnalysesFile("{"), /Not a JSON file/);
  assert.throws(() => parseAnalysesFile(JSON.stringify({ format: "something-else" })), /Not a saved decline analysis/);
  assert.throws(() => parseAnalysesFile(JSON.stringify({ ...good, version: 2 })), /Version 2/);
  const broken = (change: (a: { inputs: Record<string, unknown> }) => void) => { const copy = structuredClone(good); change(copy.analyses[0]); return JSON.stringify(copy); };
  assert.throws(() => parseAnalysesFile(broken((a) => { a.inputs.window = [24100, 24000]; })), /fit window/);
  assert.throws(() => parseAnalysesFile(broken((a) => { a.inputs.product = "water"; })), /field or product/);
  assert.throws(() => parseAnalysesFile(broken((a) => { a.inputs.limit = -3; })), /economic limit/);
  assert.equal(parseAnalysesFile(JSON.stringify(good)).length, 1);
});

test("the CSV holds every reported month, then the forecast to the economic limit", () => {
  // A limit the curve reaches within the 50-year horizon.
  const analysis = ok({ ...statfjord, limit: 1000 });
  assert.ok(analysis.toLimit! > analysis.tLast && analysis.toLimit! < 50);
  const lines = forecastCsv(analysis, record, "Statfjord oil").trimEnd().split("\n");
  const header = lines.findIndex((line) => line.startsWith("month,"));
  assert.ok(lines.slice(0, header).every((line) => line.startsWith("#")));
  assert.match(lines[header - 1]!, /Sodir|Norwegian Offshore Directorate/);
  const rows = lines.slice(header + 1).map((line) => line.split(","));
  const history = rows.filter((row) => row[5] !== "forecast"), forecast = rows.filter((row) => row[5] === "forecast");
  assert.equal(history.length, analysis.series.length);
  assert.equal(rows.filter((row) => row[3] === "yes").length, analysis.series.filter((point) => point.month >= analysis.chosen[0] && point.month <= analysis.chosen[1]).length);
  assert.ok(forecast.length > 0);
  const lastFitted = Number(forecast.at(-1)![4]);
  assert.ok(lastFitted >= analysis.limit! * 0.97 && lastFitted <= analysis.limit! * 1.1, `last forecast rate ${lastFitted} vs limit ${analysis.limit}`);
  for (const row of forecast.slice(1)) assert.ok(Number(row[4]) <= Number(forecast[0]![4]) + 1e-9);
});

test("past the 50-year horizon the forecast stops there, above the limit, as the module says", () => {
  const analysis = ok(statfjord);
  assert.equal(analysis.toLimit, 50);
  assert.equal(resultsOf(analysis)!.yearsToLimit, null);
  const rows = forecastCsv(analysis, record, "Statfjord oil").trimEnd().split("\n").filter((line) => line.endsWith(",forecast"));
  assert.equal(rows.at(-1)!.split(",")[0], label(analysis.chosen[0] + 50 * 12));
  assert.ok(Number(rows.at(-1)!.split(",")[4]) > analysis.limit!);
});
