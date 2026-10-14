import assert from "node:assert/strict";
import test from "node:test";
import { designWithTrajectory, forgeDesign, forgeOperations, getWellComponents, sProfileDesign, wellComponentsToAssembly } from "@ikhmalputra/subsurface-core";
import { assertWellDesign, assertWellOperations, authoredRevision, editTrajectory, mergeAssembly, parseWellRevision, previewTrajectory } from "../src/lib/well-revision.ts";

test("source wells and operational records are valid editable baselines", () => {
  assertWellDesign(forgeDesign);
  assertWellDesign(sProfileDesign);
  assertWellOperations(forgeOperations);
  const revision = parseWellRevision(JSON.stringify({ design: forgeDesign, operations: forgeOperations, logUrl: "/data/test.las" }), forgeDesign.id);
  assert.equal(revision.design.id, forgeDesign.id);
  assert.throws(() => parseWellRevision(JSON.stringify({ ...revision, logUrl: "https://example.com/test.las" }), forgeDesign.id), /same-origin/);
  assert.throws(() => assertWellDesign({ ...forgeDesign, totalDepthM: -1 }), /finite number/);
});

test("trajectory revisions retain the source tie-in and do not delete construction or shorten reported TD", () => {
  const before = JSON.stringify(forgeDesign);
  const stations = forgeDesign.survey!.map(({ mdM, inclinationDeg, azimuthDeg }) => ({ mdM, inclinationDeg, azimuthDeg }));
  stations[5] = { ...stations[5]!, inclinationDeg: stations[5]!.inclinationDeg + 1 };
  const next = editTrajectory(forgeDesign, stations);
  assert.equal(next.id, forgeDesign.id);
  assert.equal(next.totalDepthM, forgeDesign.totalDepthM);
  assert.equal(next.survey![0]!.northingM, forgeDesign.survey![0]!.northingM);
  assert.notEqual(next.survey![5]!.tvdM, forgeDesign.survey![5]!.tvdM);
  assert.deepEqual(next.components, forgeDesign.components);
  assert.equal(JSON.stringify(forgeDesign), before);
  const active = authoredRevision({ design: next, operations: forgeOperations, logUrl: null }, forgeDesign);
  assert.equal(active.design.provenance, "user-authored");
  assert.equal(active.design.revision, forgeDesign.revision + 1);
  assert.throws(() => editTrajectory(forgeDesign, [{ ...stations[0]!, mdM: stations[0]!.mdM + 1 }, ...stations.slice(1)]), /tie-in/);
});

test("assembly edits preserve unrepresented hole records and untouched dimensions, materials and source evidence", () => {
  const assembly = wellComponentsToAssembly({ id: forgeDesign.id, name: "FORGE", totalDepthM: forgeDesign.totalDepthM, components: getWellComponents(forgeDesign) });
  const next = { ...assembly, items: assembly.items.map((item) => item.id === "production-casing" ? { ...item, label: "Edited casing" } : item) };
  const design = mergeAssembly(forgeDesign, assembly, next);
  assert.equal(design.components!.length, forgeDesign.components!.length);
  assert.deepEqual(design.components!.find((item) => item.id === "production-hole"), forgeDesign.components!.find((item) => item.id === "production-hole"));
  assert.equal(design.components!.find((item) => item.id === "production-casing")!.material, forgeDesign.components!.find((item) => item.id === "production-casing")!.material);
  assert.equal(design.components!.find((item) => item.id === "production-casing")!.name, "Edited casing");
  assertWellDesign(design);
});

test("validation rejects cyclic component hosts and invalid operational dates or intervals", () => {
  const components = getWellComponents(forgeDesign);
  assert.throws(() => assertWellDesign({ ...forgeDesign, components: components.map((item, index) => index < 2 ? { ...item, parentId: components[1 - index]!.id } : item) }), /cycle/);
  assert.throws(() => assertWellOperations({ ...forgeOperations, days: [{ ...forgeOperations.days[0], date: "2024-02-30" }] }), /valid YYYY-MM-DD/);
  assert.throws(() => assertWellOperations({ ...forgeOperations, runs: [{ ...forgeOperations.runs[0], topM: 100, baseM: 50 }] }), /base depth/);
  assert.throws(() => authoredRevision({ design: { ...forgeDesign, id: "different" }, operations: null, logUrl: null }, forgeDesign), /immutable/);
});

test("assembly rename retains unknown dimensions and deleting a host removes omitted descendants", () => {
  const source = { ...forgeDesign, components: getWellComponents(forgeDesign).map((item) => item.id === "production-casing" ? { ...item, innerDiameterMm: null } : item) };
  const assembly = wellComponentsToAssembly({ id: source.id, name: "FORGE", totalDepthM: source.totalDepthM, components: source.components });
  const renamed = mergeAssembly(source, assembly, { ...assembly, items: assembly.items.map((item) => item.id === "production-casing" ? { ...item, label: "Rename only" } : item) });
  assert.equal(renamed.components!.find((item) => item.id === "production-casing")!.innerDiameterMm, null);
  const withChild = { ...source, components: [...source.components, { ...source.components[0]!, id: "omitted-joint", kind: "Casing joint" as const, parentId: "production-casing" }] };
  const removed = mergeAssembly(withChild, assembly, { ...assembly, items: assembly.items.filter((item) => item.id !== "production-casing" && item.hostId !== "production-casing") });
  assert.equal(removed.components!.some((item) => item.id === "omitted-joint"), false);
});

test("the previewed trajectory is the one that gets applied", () => {
  // The sheet drew the draft with one function and applied it with another. Trimming eighty
  // stations off FORGE previewed a well 938 m shallower than applying it produced, and the
  // preview also dropped the source tie-in and trimmed components the edit never touched.
  const stations = (forgeDesign.survey ?? []).map(({ mdM, inclinationDeg, azimuthDeg }) => ({ mdM, inclinationDeg, azimuthDeg }));
  const trimmed = stations.slice(0, -80);
  const preview = previewTrajectory(forgeDesign, trimmed, { name: "Edited stations", note: "preview" });
  const applied = editTrajectory(forgeDesign, trimmed);
  assert.equal(preview.totalDepthM, applied.totalDepthM, "the preview must show the depth the revision will have");
  assert.equal(preview.components?.length, applied.components?.length);
  assert.deepEqual(preview.survey, applied.survey, "the preview must show the positions the revision will have");
  assert.equal(preview.id, applied.id);
  // Trimming the survey does not shorten the well: coverage and total depth are separate facts.
  assert.equal(applied.totalDepthM, forgeDesign.totalDepthM);
  assert.equal(applied.components?.length, forgeDesign.components?.length);
  // The core helper the sheet used to call answers differently on the same input. It is a valid
  // operation — fork a planned design from stations — but it is not what applying an edit does,
  // and this is the gap that put a well 938 m shallower on screen than the one being saved.
  const forked = designWithTrajectory(forgeDesign, trimmed);
  assert.notEqual(forked.totalDepthM, applied.totalDepthM);
  assert.ok(applied.totalDepthM - forked.totalDepthM > 900);
});

test("a draft that could not be applied draws the source, not an impossible well", () => {
  const broken = [{ mdM: 0, inclinationDeg: 0, azimuthDeg: 0 }];
  assert.throws(() => editTrajectory(forgeDesign, broken), /at least two/);
  assert.equal(previewTrajectory(forgeDesign, broken), forgeDesign);
});
