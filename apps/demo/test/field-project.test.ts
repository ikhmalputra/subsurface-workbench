import assert from "node:assert/strict";
import test from "node:test";
import { getWellComponents, positionAtMeasuredDepth } from "@ikhmalputra/subsurface-core";
import { defaultFieldCutoffs, fieldCorrelationWells, makeFieldProject, screenFieldInterval } from "../src/lib/field-project.ts";

test("all Field tools consume the same wells, station MDs and explicit vertical references", () => {
  const project = makeFieldProject();
  const ids = project.records.map((record) => record.well.id);
  const correlations = fieldCorrelationWells(project, ids, "gr");
  assert.deepEqual(correlations.map((well) => well.id), project.model.wells.map(({ well }) => well.id));
  project.records.forEach((record, index) => {
    assert.equal(record.section.trajectory.depthsMdM, record.well.depthsMdM);
    assert.equal(correlations[index]!.tops, record.tops);
    assert.equal(record.section.tops, record.tops);
    const water = project.waterDepthsM[record.well.id]!;
    for (let at = 0; at < record.stations.length; at++) {
      assert.equal(record.section.trajectory.xyz[at * 3], record.well.xyz[at * 3]);
      assert.equal(record.section.trajectory.xyz[at * 3 + 2], record.well.xyz[at * 3 + 2]! + water);
    }
    assert.ok(record.tops[0]!.mdM < record.tops[1]!.mdM);
    assert.ok(record.summary.net <= record.summary.tested);
    assert.ok(record.summary.tested <= record.summary.gross + 1e-8);
  });

  assert.ok(project.records[2]!.summary.tested < project.records[2]!.summary.gross * .85, "C acquisition gap must reduce tested coverage");
  assert.equal(project.records[0]!.summary.tested, project.records[0]!.summary.gross);
  assert.ok(project.records[0]!.summary.net > project.records[3]!.summary.net, "Quality screen must distinguish A and D responses");
});

test("focused correlation retains exact source MD/value pairs and leaves source columns unchanged", () => {
  const project = makeFieldProject();
  const record = project.records[0]!;
  const focused = fieldCorrelationWells(project, [record.well.id], "porosity", true)[0]!.tracks[0]!.curve;
  assert.ok(focused.values.length < record.tracks.porosity.curve.values.length);
  for (let index = 0; index < focused.values.length; index++) {
    const sourceIndex = record.well.depthsMdM.indexOf(focused.depthsMdM[index]!);
    assert.equal(focused.values[index], record.tracks.porosity.curve.values[sourceIndex]);
  }
  assert.equal(record.tracks.porosity.curve.values.length, 301);
  assert.throws(() => fieldCorrelationWells(project, ["unknown"], "gr"), /Unknown/);
});

test("Well View 3D adapter retains source stations and declares synthetic construction", () => {
  const project = makeFieldProject();
  for (const record of project.records) {
    const source = project.surveys[record.well.id]!;
    const design = record.sceneDesign;
    assert.equal(design.id, record.well.id);
    assert.equal(design.survey!.length, 301);
    assert.equal(design.totalDepthM, record.well.depthsMdM.at(-1));
    const components = getWellComponents(design);
    assert.equal(components.length, 14);
    assert.equal(components.filter((component) => component.kind === "Cement").length, 3);
    assert.ok(components.some((component) => component.kind === "Packer"));
    for (const component of components) {
      assert.ok(component.topDepthM >= 0 && component.bottomDepthM <= design.totalDepthM);
      assert.ok(component.outerDiameterMm! > 0);
      assert.ok(component.innerDiameterMm === null || component.innerDiameterMm < component.outerDiameterMm!);
      if (component.parentId) assert.ok(components.some((parent) => parent.id === component.parentId));
      assert.match(component.description, /synthetic/);
    }
    const perforations = components.find((component) => component.id === "r1-perforations")!;
    assert.equal(perforations.topDepthM, record.tops[0]!.mdM);
    assert.equal(perforations.bottomDepthM, record.tops[1]!.mdM);
    assert.ok(components.find((component) => component.id === "production-packer")!.bottomDepthM < perforations.topDepthM);
    record.stations.forEach((station, at) => {
      const point = positionAtMeasuredDepth(design, station.mdM);
      assert.equal(point.mdM, station.mdM);
      assert.equal(point.tvdM, station.xyz[2]);
      assert.equal(point.eastingM, source.xyz[at * 3]);
      assert.equal(point.northingM, source.xyz[at * 3 + 1]);
      assert.equal(point.inclinationDeg, source.inclinationsDeg[at]);
      assert.equal(point.azimuthDeg, source.azimuthsDeg[at]);
      assert.ok(Math.abs(point.eastingM + record.stations[0]!.xyz[0] - station.xyz[0]) < 1e-8);
      assert.ok(Math.abs(point.northingM + record.stations[0]!.xyz[1] - station.xyz[1]) < 1e-8);
    });
  }
});

test("quality cutoff changes recompute qualifying thickness, not coverage or source curves", () => {
  const project = makeFieldProject(), record = project.records[0]!;
  const baseline = screenFieldInterval(record, project.waterDepthsM[record.well.id]!, defaultFieldCutoffs);
  const strict = screenFieldInterval(record, project.waterDepthsM[record.well.id]!, { ...defaultFieldCutoffs, phiMin: 1 });
  assert.equal(strict.net, 0);
  assert.equal(strict.meanPhi, null);
  assert.equal(strict.tested, baseline.tested);
  assert.equal(strict.gross, 210);
  assert.ok(baseline.net > 180);
  assert.throws(() => screenFieldInterval(record, 800, { ...defaultFieldCutoffs, grMax: NaN }), /cutoffs/);
});
