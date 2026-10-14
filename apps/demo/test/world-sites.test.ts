import assert from "node:assert/strict";
import test from "node:test";
import { forgeDesign, forgeSeismicSection } from "@ikhmalputra/subsurface-core";
import { equatorSite, forgeSite, unlocatedWells, RESERVOIR } from "../src/lib/world-sites.ts";
import { makeFieldProject } from "../src/lib/field-project.ts";

test("FORGE is placed from its own NAD83 / UTM 12N wellhead, with the seismic cut outlined around it", () => {
  const site = forgeSite();
  const [well] = site.map.wells;
  assert.ok(Math.abs(well!.head[0] - -112.89643) < 1e-4 && Math.abs(well!.head[1] - 38.50416) < 1e-4, `${well!.head}`);
  assert.equal(site.map.provenance, "documented");
  assert.equal(well!.path!.length, forgeDesign.survey!.length);
  const ring = site.map.footprints![0]!.ring;
  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], ring[4]);
  // The ring spans the declared sub-volume: about 2.75 km along and 1.53 km across.
  const toMetres = (a: readonly number[], b: readonly number[]) => Math.hypot((a[0]! - b[0]!) * 111320 * Math.cos(38.5 * Math.PI / 180), (a[1]! - b[1]!) * 110570);
  assert.ok(Math.abs(toMetres(ring[0]!, ring[1]!) - 2750) < 30);
  assert.ok(Math.abs(toMetres(ring[1]!, ring[2]!) - 1525) < 30);
});

test("FORGE in 3D keeps the record's own depths: survey TVD, shoes, and the granite top as a planar contact", () => {
  const site = forgeSite();
  const well = site.wells[0]!;
  const survey = forgeDesign.survey!;
  assert.equal(well.mdM.length, survey.length);
  assert.equal(well.xyz[well.xyz.length - 1], survey.at(-1)!.tvdM);
  assert.ok(well.markers!.some((marker) => /shoe/.test(marker.label)));
  const granite = forgeDesign.formations!.find((layer) => layer.id === "granite")!;
  const top = site.surfaces.find((surface) => surface.id === "granite-top")!;
  assert.deepEqual(top.geometry, { kind: "plane", depthM: granite.topTvdM });
  assert.equal(top.color, RESERVOIR.top);
  assert.match(top.note, /conceptual/);
  assert.equal(site.hasSeismic, true);
  assert.match(site.depthLabel, new RegExp(`${forgeSeismicSection.rkbElevationM.toFixed(0)} m ASL`));
});

test("the Equator field sits in open water, with R1 surfaces built only from the four wells' picks", () => {
  const project = makeFieldProject();
  const site = equatorSite(project);
  assert.equal(site.map.provenance, "synthetic");
  assert.equal(site.wells.length, 4);
  for (const [index, well] of site.wells.entries()) {
    const water = project.waterDepthsM[project.records[index]!.well.id]!;
    assert.equal(well.xyz[2], water, "wellhead depth is the water depth below the sea surface");
  }
  for (const id of ["r1-top", "r1-base"]) {
    const surface = site.surfaces.find((entry) => entry.id === id)!;
    assert.equal(surface.geometry.kind, "tin");
    if (surface.geometry.kind === "tin") assert.equal(surface.geometry.points.length, 4);
    assert.match(surface.note, /Not a mapped surface/);
  }
  const top = site.surfaces.find((entry) => entry.id === "r1-top")!, base = site.surfaces.find((entry) => entry.id === "r1-base")!;
  assert.ok(top.geometry.kind === "tin" && base.geometry.kind === "tin");
  const basePoints = base.geometry.kind === "tin" ? base.geometry.points : [];
  if (top.geometry.kind === "tin") top.geometry.points.forEach((point, index) => assert.ok(point[2] < basePoints[index]![2], "R1 base is below R1 top in every well"));
  assert.equal(site.hasSeismic, false);
  assert.match(site.seismicNote!, /No seismic/);
  for (const well of site.map.wells) assert.ok(well.head[0] > 118 && well.head[0] < 119.5 && Math.abs(well.head[1]) < 1);
});

test("wells without a declared location are listed, not placed", () => {
  const list = unlocatedWells();
  assert.deepEqual(list.map((well) => well.id).sort(), ["research", "s-profile"]);
  for (const well of list) assert.match(well.reason, /No surface location/);
});
