import assert from "node:assert/strict";
import test from "node:test";
import { computeMinimumCurvature, forgeDesign, getWellComponents, positionAtMeasuredDepth, researchDesign, sProfileDesign } from "./index.ts";

test("synthetic stress-test tally exposes hundreds of artificial instances", () => {
  const components = getWellComponents(sProfileDesign);
  assert.ok(components.length > 100);
  assert.equal(new Set(components.map((component) => component.id)).size, components.length);
  const joint = components.find((component) => component.name === "Casing joint 100");
  assert.ok(joint);
  assert.equal(joint.topDepthM, 1188);
  assert.equal(joint.bottomDepthM, 1200);
  assert.ok(new Set(components.map((component) => component.kind)).size >= 10);
  assert.ok(components.every((component) => component.topDepthM <= component.bottomDepthM && component.bottomDepthM <= sProfileDesign.totalDepthM));
});

test("MD to TVD display interpolation preserves independent straight-course values", () => {
  const design = { ...sProfileDesign, totalDepthM: 1000, survey: [
    { mdM: 0, tvdM: 0, eastingM: 0, northingM: 0, inclinationDeg: 60, azimuthDeg: 90 },
    { mdM: 1000, tvdM: 500, eastingM: 866.0254037844386, northingM: 0, inclinationDeg: 60, azimuthDeg: 90 },
  ] };
  const point = positionAtMeasuredDepth(design, 600);
  assert.equal(point.mdM, 600);
  assert.ok(Math.abs(point.tvdM - 300) < 1e-9);
  assert.ok(Math.abs(point.eastingM - 519.6152422706632) < 1e-9);
  assert.throws(() => positionAtMeasuredDepth(design, 1001), /outside/);
  assert.throws(() => positionAtMeasuredDepth(design, Number.NaN), /outside/);
});

test("Python-generated curved fixtures have an explicit datum and agree with the SDK's minimum curvature", () => {
  const survey = sProfileDesign.survey!;
  assert.equal(sProfileDesign.depthDatum, "RKB");
  assert.equal(sProfileDesign.referenceElevationMslM, 30);
  assert.equal(survey.length, 105);
  for (let index = 1; index < survey.length; index++) {
    assert.ok(survey[index]!.mdM > survey[index - 1]!.mdM);
    assert.ok(survey[index]!.tvdM > survey[index - 1]!.tvdM);
  }
  for (const design of [sProfileDesign, researchDesign]) {
    const recomputed = computeMinimumCurvature(design.survey!).at(-1)!;
    const end = design.survey!.at(-1)!;
    assert.ok(Math.abs(recomputed.tvdM - end.tvdM) < 0.01, design.id);
    assert.ok(Math.abs(recomputed.eastingM - end.eastingM) < 0.01, design.id);
    assert.ok(Math.abs(recomputed.northingM - end.northingM) < 0.01, design.id);
  }
});

test("source component records are authoritative and missing equipment is not invented", () => {
  const noRecords = { ...sProfileDesign, components: [] };
  assert.deepEqual(getWellComponents(noRecords), []);
  const sourced = { ...sProfileDesign, components: [{ id: "documented-casing", name: "Documented casing", kind: "Casing" as const, material: "Not reported", outerDiameterMm: 244.475, innerDiameterMm: 216.79, topDepthM: 0, bottomDepthM: 1500, description: "Recorded interval only." }] };
  assert.deepEqual(getWellComponents(sourced).map((component) => component.id), ["documented-casing"]);
});

test("FORGE observed survey preserves independently transcribed workbook values and its datum", () => {
  assert.equal(forgeDesign.provenance, "documented");
  assert.equal(forgeDesign.survey?.length, 422);
  const last = forgeDesign.survey!.at(-1)!;
  assert.ok(Math.abs(last.mdM - 10955 * 1200 / 3937) < 1e-9);
  assert.ok(Math.abs(last.tvdM - 8558.83 * 1200 / 3937) < 1e-9);
  assert.ok(Math.abs(last.eastingM - 3901.17 * 1200 / 3937) < 1e-9);
  assert.ok(Math.abs(last.northingM - -1039.83 * 1200 / 3937) < 1e-9);
  assert.equal(last.inclinationDeg, 68.6);
  assert.equal(last.azimuthDeg, 101.44);
  assert.equal(forgeDesign.depthDatum, "GE + RKB / MSL");
  assert.ok(Math.abs(forgeDesign.referenceElevationMslM! - 5444 * 1200 / 3937) < 1e-9);
  assert.equal(forgeDesign.reportedTotalDepthFt, 10987);
  assert.throws(() => positionAtMeasuredDepth(forgeDesign, 10987 * 0.3048), /outside/);
});

test("FORGE as-built strings match report pages and unknown dimensions remain unknown", () => {
  const components = getWellComponents(forgeDesign);
  assert.equal(components.length, 10);
  const strings = components.filter((component) => component.kind === "Casing");
  assert.deepEqual(strings.map((component) => [component.rawBottomDepthFt, component.sourcePage, component.material]), [
    [1629, 10, "L80 / 68 lb/ft / BTC"],
    [5110, 21, "HCL80 / 40 lb/ft"],
    [10787, 67, "T95 / 38 lb/ft / JFELION"],
  ]);
  assert.ok(strings.every((component) => component.innerDiameterMm === null && component.topDepthReported === false));
  assert.equal(components.find((component) => component.id === "production-cement")!.outerDiameterMm, null);
  assert.equal(components.find((component) => component.id === "wellhead")!.outerDiameterMm, null);
  assert.ok(!components.some((component) => ["Gas lift mandrel", "Packer", "Safety valve", "Tubing joint"].includes(component.kind)));
  assert.ok(forgeDesign.formations!.every((layer) => layer.densityKgM3 === null && layer.porosityPct === null));
  assert.deepEqual(getWellComponents({ ...forgeDesign, components: undefined }), []);
});
