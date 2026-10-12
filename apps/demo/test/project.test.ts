import assert from "node:assert/strict";
import test from "node:test";
import { hasCapability, projectWell, projectWells, wellCapabilities } from "../src/lib/project.ts";

test("every well declares what it carries, and the project is uneven on purpose", () => {
  const byId = Object.fromEntries(projectWells.map((well) => [well.id, wellCapabilities(well)]));

  // FORGE is the documented well: sourced construction, operations, mud log and seismic.
  assert.equal(byId.forge!.construction, true);
  assert.equal(byId.forge!.operations, true);
  assert.equal(byId.forge!.mudLog, true);
  assert.equal(byId.forge!.seismic, true);
  // And it genuinely has no petrophysics curves anywhere in this repo.
  assert.equal(byId.forge!.petrophysics, false);
  assert.equal(byId.forge!.production, false);

  // The synthetic wells are the opposite: curves but no cited operations or seismic.
  assert.equal(byId["s-profile"]!.petrophysics, true);
  assert.equal(byId["s-profile"]!.operations, false);
  assert.equal(byId["s-profile"]!.seismic, false);
  assert.equal(byId.research!.petrophysics, true);
});

test("the report is offered only where there are cited records to report", () => {
  // A synthetic well has nothing to cite, so offering a sourced report would be a false claim.
  assert.equal(hasCapability(projectWell("forge"), "report"), true);
  assert.equal(hasCapability(projectWell("s-profile"), "report"), false);
  assert.equal(hasCapability(projectWell("research"), "report"), false);
});

test("production belongs to the well its document names", () => {
  // This is the bug the route gate hid: the document was always keyed to this well, but
  // /production/ claimed "no compatible dataset" because the check was on the route name.
  const sProfile = projectWell("s-profile");
  assert.equal(sProfile.production?.wellId, sProfile.design.id);
  assert.equal(hasCapability(sProfile, "production"), true);
});

test("petrophysics curves belong to the well that owns them", () => {
  for (const id of ["s-profile", "research"]) {
    const well = projectWell(id);
    assert.equal(well.petrophysics?.wellId, well.design.id);
    for (const curve of well.petrophysics!.curves) assert.equal(curve.wellId, well.design.id);
  }
  // The two synthetic wells must not share curve identities, or a crossplot would pair them.
  const a = projectWell("s-profile").petrophysics!.curves.map((curve) => curve.id);
  const b = projectWell("research").petrophysics!.curves.map((curve) => curve.id);
  assert.equal(a.some((id) => b.includes(id)), false);
});

test("wells resolve by either host id or canonical design id", () => {
  assert.equal(projectWell("forge").id, "forge");
  assert.equal(projectWell(projectWell("forge").design.id).id, "forge");
  assert.throws(() => projectWell("missing"), /Unknown project well/);
});

test("capabilities come from the data, so counts match the records", () => {
  const forge = projectWell("forge");
  assert.equal(forge.components.length, 10);
  assert.equal(forge.operations?.days.length, 76);
  assert.equal(forge.operations?.runs.length, 54);
  assert.equal(forge.design.survey?.length, 422);
  // Survey needs more than one station to be an axis at all.
  assert.equal(hasCapability(forge, "survey"), true);
});
