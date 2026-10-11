import assert from "node:assert/strict";
import test from "node:test";
import { forgeDesign, forgeOperations, getWellComponents, sProfileDesign, wellComponentsToAssembly } from "@ikhmalputra/subsurface-core";
import { assertWellDesign, assertWellOperations, authoredRevision, editTrajectory, mergeAssembly, parseWellRevision } from "../src/lib/well-revision.ts";

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
