import assert from "node:assert/strict";
import test from "node:test";
import { adoptOffsetDesign, compareWells, forgeOffsetWell, newWellBesideOffset, offsetFromBrief } from "./offset-wells.ts";
import { analyzeSection, exampleWellBrief, pressureAt, validateDesign } from "./well-design.ts";

test("FORGE 16A(78)-32 offset is transcribed from the record and only fails real checks", () => {
  const { brief, asDrilled } = forgeOffsetWell;
  assert.deepEqual(brief.sections.map((s) => `${s.odIn} ${s.weightLbFt} ${s.grade} @${Math.round(s.shoeMdM)}`), ["13.375 68 L80 @497", "9.625 40 L80 @1558", "7 38 T95 @3288"]);
  assert.equal(brief.geology.integrityTests?.length, 2);
  assert.ok(brief.geology.integrityTests!.every((t) => !t.reachedLeakOff && /p\. \d+/.test(t.source)));
  assert.equal(validateDesign(brief).filter((i) => i.severity === "error").length, 0);
  assert.ok(validateDesign(brief).some((i) => i.code === "bit-drift"), "8.75\" bit through 9-5/8\" 40# needs special drift, as run");
  brief.sections.forEach((_, i) => assert.ok(analyzeSection(brief, i).passes));
  assert.deepEqual(asDrilled.map((s) => s.sectionId), ["surface", "intermediate", "production"]);
  assert.ok(asDrilled.every((s) => s.events.every((e) => e.source.length > 0)));
  assert.equal(asDrilled[2]!.events.filter((e) => e.kind === "failed-run" || e.kind === "problem-run").length, asDrilled[2]!.problemRuns);
});

test("compareWells scores real likeness and refuses to score missing data", () => {
  const far = compareWells(exampleWellBrief(), forgeOffsetWell);
  assert.equal(far.verdict, "poor");
  assert.equal(far.factors.find((f) => f.id === "distance")!.score, 0);
  const pad = newWellBesideOffset(forgeOffsetWell, { name: "16B(78)-32" });
  const near = compareWells(pad, forgeOffsetWell);
  assert.equal(near.verdict, "strong");
  assert.ok(near.score > 0.9);
  const blank = { ...pad, location: { ...pad.location, latitude: null, longitude: null }, geology: { ...pad.geology, formations: [], pressures: [], temperatureSource: "assumed" as const } };
  const unknown = compareWells(blank, forgeOffsetWell);
  for (const id of ["distance", "pressure", "temperature", "lithology"]) assert.equal(unknown.factors.find((f) => f.id === id)!.score, null);
  assert.ok(unknown.coverage < 0.6);
});

test("adopting an offset maps depths, logs every change and re-validates", () => {
  const pad = newWellBesideOffset(forgeOffsetWell, { name: "16B(78)-32", totalDepthMdM: 2400 });
  assert.equal(pad.sections.length, 0);
  assert.equal(pad.geology.pressures[0]!.fractureSource, "estimated");
  assert.equal(pad.geology.temperatureSource, "offset");
  const adopted = adoptOffsetDesign(pad, forgeOffsetWell);
  assert.deepEqual(adopted.brief.origin?.parts, ["geology", "casing", "completion"]);
  const production = adopted.brief.sections.at(-1)!;
  assert.equal(Math.round(production.shoeMdM), 2400 - Math.round(3339.1 - 3287.88));
  assert.ok(adopted.changes.some((c) => c.sectionId === "production" && c.field === "shoe"));
  assert.deepEqual(adopted.failingSections, []);

  // Datum: a pad 20 m higher puts every TVD 20 m deeper and keeps the same pressure in psi.
  const higher = { ...pad, datum: { ...pad.datum, elevationAboveMslM: pad.datum.elevationAboveMslM! + 20 } };
  const shifted = adoptOffsetDesign(higher, forgeOffsetWell, { casing: false });
  const original = forgeOffsetWell.brief.geology.pressures[2]!;
  const moved = shifted.brief.geology.pressures[2]!;
  assert.equal(moved.tvdM, Math.round((original.tvdM + 20) * 10) / 10);
  assert.ok(Math.abs(moved.fractureGradientSg * moved.tvdM - original.fractureGradientSg * original.tvdM) < 0.01 * moved.tvdM);

  // A poor analogue is carried over but its failures are reported, and mud is raised for this well's pore pressure.
  const kestrel = adoptOffsetDesign(exampleWellBrief(), forgeOffsetWell, { geology: false });
  const deepMud = kestrel.brief.sections.at(-1)!;
  assert.ok(deepMud.mudWeightSg >= pressureAt(kestrel.brief, 2600).porePressureSg);
  assert.ok(kestrel.changes.some((c) => c.field === "mud"));
  assert.ok(kestrel.issues.some((i) => i.severity === "error"));
});

test("any design can be saved as an offset for the next well", () => {
  const saved = offsetFromBrief(exampleWellBrief(), { name: "Kestrel-2 plan" });
  assert.equal(saved.provenance, "user");
  assert.equal(compareWells(exampleWellBrief(), saved).verdict, "strong");
});
