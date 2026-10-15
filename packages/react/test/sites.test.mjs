import assert from "node:assert/strict";
import test from "node:test";
import { forgeDesign, forgeSeismicSection } from "@ikhmalputra/subsurface-core";
import { equatorField, equatorSite, forgeSite, unlocatedWells, RESERVOIR } from "../dist/sites.js";

test("FORGE 16A stands on its licensed as-built wellhead, with the seismic cut outlined around it", () => {
  const site = forgeSite();
  const [well] = site.map.wells;
  // 38°30′14.44783″ N, 112°53′47.06681″ W (Woolsey Land Surveying, 2023), within a metre or so on the map.
  assert.ok(Math.abs(well.head[0] - -112.896407) < 2e-5 && Math.abs(well.head[1] - 38.504013) < 2e-5, `${well.head}`);
  assert.deepEqual(site.map.wells.map((entry) => entry.label), ["16A(78)-32", "16B(78)-32", "58-32 (MU-ESW1)"]);
  assert.equal(site.map.provenance, "documented");
  assert.equal(well.path.length, forgeDesign.survey.length);
  const ring = site.map.footprints[0].ring;
  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], ring[4]);
  // The ring spans the declared sub-volume: about 2.75 km along and 1.53 km across.
  const toMetres = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(38.5 * Math.PI / 180), (a[1] - b[1]) * 110570);
  assert.ok(Math.abs(toMetres(ring[0], ring[1]) - 2750) < 30);
  assert.ok(Math.abs(toMetres(ring[1], ring[2]) - 1525) < 30);
});

test("FORGE in 3D keeps the record's own depths: survey TVD, shoes, and the granite top as a planar contact", () => {
  const site = forgeSite();
  const well = site.wells[0];
  const survey = forgeDesign.survey;
  assert.equal(well.mdM.length, survey.length);
  assert.equal(well.xyz[well.xyz.length - 1], survey.at(-1).tvdM);
  assert.ok(well.markers.some((marker) => /shoe/.test(marker.label)));
  const granite = forgeDesign.formations.find((layer) => layer.id === "granite");
  const top = site.surfaces.find((surface) => surface.id === "granite-top");
  assert.deepEqual(top.geometry, { kind: "plane", depthM: granite.topTvdM });
  assert.equal(top.color, RESERVOIR.top);
  assert.match(top.note, /conceptual/);
  assert.equal(site.hasSeismic, true);
  assert.match(site.depthLabel, new RegExp(`${forgeSeismicSection.rkbElevationM.toFixed(0)} m ASL`));
});

test("the Equator field sits in open water, with R1 surfaces built only from the four wells' picks", () => {
  const project = equatorField();
  const site = equatorSite(project);
  assert.equal(site.map.provenance, "synthetic");
  assert.equal(site.wells.length, 4);
  for (const [index, well] of site.wells.entries()) {
    const water = project.waterDepthsM[project.records[index].well.id];
    assert.equal(well.xyz[2], water, "wellhead depth is the water depth below the sea surface");
  }
  for (const id of ["r1-top", "r1-base"]) {
    const surface = site.surfaces.find((entry) => entry.id === id);
    assert.equal(surface.geometry.kind, "tin");
    if (surface.geometry.kind === "tin") assert.equal(surface.geometry.points.length, 4);
    assert.match(surface.note, /Not a mapped surface/);
  }
  const top = site.surfaces.find((entry) => entry.id === "r1-top"), base = site.surfaces.find((entry) => entry.id === "r1-base");
  assert.ok(top.geometry.kind === "tin" && base.geometry.kind === "tin");
  const basePoints = base.geometry.kind === "tin" ? base.geometry.points : [];
  if (top.geometry.kind === "tin") top.geometry.points.forEach((point, index) => assert.ok(point[2] < basePoints[index][2], "R1 base is below R1 top in every well"));
  assert.equal(site.hasSeismic, false);
  assert.match(site.seismicNote, /No seismic/);
  for (const well of site.map.wells) assert.ok(well.head[0] > 118 && well.head[0] < 119.5 && Math.abs(well.head[1]) < 1);
});

test("wells without a declared location are listed, not placed", () => {
  const list = unlocatedWells();
  assert.deepEqual(list.map((well) => well.id).sort(), ["research", "s-profile"]);
  for (const well of list) assert.match(well.reason, /No surface location/);
});

test("Kestrel A-7 is a planned, synthetic site: its well, shoes, reservoir and the sea are where the brief puts them", async () => {
  const { kestrelSite } = await import("../dist/sites.js");
  const site = kestrelSite();
  assert.equal(site.map.provenance, "synthetic");
  assert.match(site.caveat, /Nothing here was drilled/);
  assert.ok(Math.abs(site.wells[0].mdM.at(-1) - site.brief.totalDepthMdM) < 0.5);
  assert.ok(site.wells[0].markers.some((marker) => marker.label === "7\" shoe"));
  assert.deepEqual(site.surfaces.map((surface) => surface.id), ["sea", "seabed", "reservoir-top"]);
  assert.equal(site.surfaces[1].geometry.depthM, 115);
  const [lon, lat] = site.map.wells[0].head;
  assert.ok(Math.abs(lon - 114.231) < 1e-9 && Math.abs(lat - 5.412) < 1e-9);
  assert.equal(site.map.wells[0].path.length, site.design.survey.length);
});

test("every Equator well gets logs across its own Sand R1, and the field's contacts decide its fluids", async () => {
  const { equatorPetrophysics, equatorField, EQUATOR_CONTACTS } = await import("../dist/sites.js");
  const project = equatorField();
  const wells = equatorPetrophysics(project);
  assert.equal(wells.length, 4);
  for (const [index, entry] of wells.entries()) {
    const record = project.records[index];
    const top = record.tops.find((pick) => pick.id === "reservoir-top").mdM;
    assert.equal(entry.logs.well.provenance, "synthetic");
    assert.equal(entry.logs.well.tops[0].mdM, top);
    // A well whose sand top is above the GOC has a gas cap; every well reaches the OWC.
    assert.equal(entry.logs.contactsMdM.goc !== null, record.reservoirTopDepth < EQUATOR_CONTACTS.gocTvdssM, record.well.label);
    assert.ok(entry.logs.contactsMdM.owc !== null, record.well.label);
  }
});
