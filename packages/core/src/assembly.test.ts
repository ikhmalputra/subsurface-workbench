import assert from "node:assert/strict";
import test from "node:test";
import { AssemblyPlacementError, assemblyCatalog, assemblyToWellComponents, createAssembly, exampleAssembly, moveComponent, placeComponent, removeComponent, suggestPlacementDepth, updateComponent, validateAssembly, wellComponentsToAssembly, getCatalogEntry } from "./assembly.ts";

const blank = () => createAssembly({ id: "test", name: "Test well", totalDepthM: 3000 });

test("every catalog entry ships a Blender thumbnail and point equipment ships a model", () => {
  for (const value of assemblyCatalog) {
    assert.match(value.asset.thumbnail, /\.png$/);
    if (value.slot === "tubing-tool" || value.id === "wellhead") assert.match(value.asset.model ?? "", /\.glb$/);
  }
});

test("casing hangs from surface and the drop depth sets the shoe", () => {
  const { assembly, itemId } = placeComponent(blank(), "surface-casing", 612.34);
  const casing = assembly.items.find((item) => item.id === itemId)!;
  assert.equal(casing.topM, 0);
  assert.equal(casing.bottomM, 612.3);
  assert.equal(assembly.revision, 2);
  assert.equal(Object.isFrozen(assembly), true);
  assert.equal(Object.isFrozen(casing), true);
});

test("hard impossibilities throw placement errors instead of corrupting the assembly", () => {
  assert.throws(() => placeComponent(blank(), "packer", 900), AssemblyPlacementError);
  assert.throws(() => placeComponent(blank(), "christmas-tree", 0), /wellhead/);
  assert.throws(() => placeComponent(blank(), "liner", 900), /inside an existing casing/);
  assert.throws(() => placeComponent(blank(), "cement", 900), /annulus/);
  const withHead = placeComponent(blank(), "wellhead", 0).assembly;
  assert.throws(() => placeComponent(withHead, "wellhead", 0), /already installed/);
});

test("cement fills from the drop depth to the nearest shoe below and follows the shoe", () => {
  let value = placeComponent(blank(), "surface-casing", 600).assembly;
  value = placeComponent(value, "intermediate-casing", 1500).assembly;
  const cemented = placeComponent(value, "cement", 300);
  const cement = cemented.assembly.items.find((item) => item.id === cemented.itemId)!;
  assert.equal(cement.hostId, "surface-casing-1");
  assert.deepEqual([cement.topM, cement.bottomM], [300, 600]);
  const moved = moveComponent(cemented.assembly, "surface-casing-1", 750);
  assert.equal(moved.items.find((item) => item.id === cement.id)!.bottomM, 750);
});

test("completion tools ride on tubing and packers size to the casing ID", () => {
  let value = placeComponent(blank(), "production-casing", 2500).assembly;
  value = placeComponent(value, "tubing", 2200).assembly;
  const packer = placeComponent(value, "packer", 2150);
  const item = packer.assembly.items.find((entry) => entry.id === packer.itemId)!;
  assert.equal(item.hostId, "tubing-1");
  assert.equal(item.odIn, 8.3);
  const clamped = moveComponent(packer.assembly, item.id, 2900);
  assert.equal(clamped.items.find((entry) => entry.id === item.id)!.bottomM, 2200);
});

test("removing a string removes its cement, shoe and hosted tools", () => {
  let value = placeComponent(blank(), "production-casing", 2500).assembly;
  value = placeComponent(value, "cement", 1800).assembly;
  value = placeComponent(value, "float-shoe", 2490).assembly;
  value = placeComponent(value, "centralizer", 2400).assembly;
  assert.equal(removeComponent(value, "production-casing-1").items.length, 0);
});

test("validation reports strings that cannot pass and tools off the tubing", () => {
  let value = placeComponent(blank(), "production-casing", 1200).assembly;
  value = placeComponent(value, "intermediate-casing", 2000).assembly;
  value = placeComponent(value, "tubing", 1000).assembly;
  value = placeComponent(value, "landing-nipple", 800).assembly;
  value = updateComponent(value, "tubing-1", { bottomM: 500 });
  const codes = validateAssembly(value).map((issue) => issue.code);
  assert.ok(codes.includes("does-not-pass") === false);
  assert.ok(codes.includes("shoe-order"));
  assert.ok(codes.includes("tool-off-tubing"));
  assert.throws(() => updateComponent(value, "tubing-1", { idIn: 9 }), /Inside diameter/);
});

test("the example assembly is complete and has no errors", () => {
  const value = exampleAssembly();
  assert.equal(value.items.length, 20);
  assert.deepEqual(validateAssembly(value).filter((issue) => issue.severity === "error"), []);
  const components = assemblyToWellComponents(value);
  assert.equal(components.find((item) => item.id === "production-casing-1")!.outerDiameterMm, 244.5);
});

test("suggested depths place every catalog entry on the example without errors", () => {
  let value = createAssembly({ id: "k", name: "Keyboard", totalDepthM: 3000 });
  for (const id of ["wellhead", "christmas-tree", "conductor", "surface-casing", "cement", "intermediate-casing", "production-casing", "float-shoe", "centralizer", "liner", "tubing", "packer", "safety-valve", "landing-nipple", "gas-lift-mandrel", "gauge"]) {
    value = placeComponent(value, id, suggestPlacementDepth(value, id)).assembly;
  }
  assert.equal(value.items.length, 16);
  assert.deepEqual(validateAssembly(value).filter((issue) => issue.severity === "error").map((issue) => issue.message), []);
});

test("existing well records present as a read-only assembly without invented equipment", async () => {
  const { forgeDesign, sProfileDesign, getWellComponents } = await import("./index.ts");
  const forge = wellComponentsToAssembly({ id: forgeDesign.id, name: "FORGE", totalDepthM: forgeDesign.totalDepthM, components: getWellComponents(forgeDesign) });
  assert.deepEqual(forge.items.map((item) => item.catalogId), ["surface-casing", "intermediate-casing", "production-casing", "cement", "cement", "wellhead", "christmas-tree"]);
  assert.equal(forge.items.find((item) => item.id === "production-casing")?.idIn, null, "unreported IDs stay unreported");
  assert.equal(forge.items.find((item) => item.id === "surface-cement")?.hostId, "surface-casing");
  assert.ok(!forge.items.some((item) => ["tubing", "packer"].includes(item.catalogId)));
  assert.deepEqual(validateAssembly(forge).filter((issue) => issue.severity === "error"), []);
  const synthetic = wellComponentsToAssembly({ id: "s", name: "S", totalDepthM: sProfileDesign.totalDepthM, components: getWellComponents(sProfileDesign) });
  assert.ok(!synthetic.items.some((item) => /joint|coupling|connection/.test(item.id)), "joint-level detail is omitted");
  assert.ok(synthetic.items.filter((item) => getCatalogEntry(item.catalogId).slot === "tubing-tool").every((item) => item.hostId === "tubular"));
  assert.ok(Object.isFrozen(synthetic.items[0]));
});

test("the full catalog assembles with suggested depths and no errors", () => {
  let value = createAssembly({ id: "full", name: "Full", totalDepthM: 3600 });
  const order = ["wellhead", "casing-spool", "tubing-head", "christmas-tree", "conductor", "surface-casing", "intermediate-casing", "production-casing", "drilling-liner", "liner", "cement", "cement", "cement",
    "float-shoe", "float-collar", "landing-collar", "centralizer", "rigid-centralizer", "stage-tool", "cement-basket", "liner-top-packer", "tubing", "tubing-hanger",
    "safety-valve", "landing-nipple", "no-go-nipple", "chemical-injection-mandrel", "gauge", "sliding-sleeve", "flow-coupling", "blast-joint", "expansion-joint", "seal-assembly", "packer", "wireline-entry-guide",
    "gas-lift-mandrel", "esp", "icv", "perforations", "wire-wrap-screen", "premium-screen", "gravel-pack", "icd-screen", "swell-packer", "frac-sleeve", "slotted-liner"];
  for (const id of order) value = placeComponent(value, id, suggestPlacementDepth(value, id)).assembly;
  assert.equal(value.items.length, order.length);
  assert.deepEqual(validateAssembly(value).filter((issue) => issue.severity === "error").map((issue) => issue.message), []);
  const covered = new Set(order);
  const alternates = ["horizontal-tree", "bop-stack", "guide-shoe", "tieback-casing", "permanent-packer", "rod-pump", "pcp", "jet-pump", "bridge-plug", "cement-plug", "cement-retainer"];
  assert.deepEqual(assemblyCatalog.map((entry) => entry.id).filter((id) => !covered.has(id) && !alternates.includes(id)), []);
  assert.ok(assemblyCatalog.length >= 55);
});

test("surface stack positions and shoe accessories are exclusive", () => {
  let value = placeComponent(blank(), "wellhead", 0).assembly;
  value = placeComponent(value, "christmas-tree", 0).assembly;
  assert.throws(() => placeComponent(value, "horizontal-tree", 0), /already occupies/);
  assert.throws(() => placeComponent(value, "tubing-hanger", 0), /Tubing head spool/);
  value = placeComponent(value, "production-casing", 2500).assembly;
  value = placeComponent(value, "float-shoe", 2400).assembly;
  assert.throws(() => placeComponent(value, "guide-shoe", 2500), /already has a float shoe/);
  const collar = placeComponent(value, "float-collar", 1000);
  const item = collar.assembly.items.find((entry) => entry.id === collar.itemId)!;
  assert.deepEqual([item.topM, item.hostId], [2476, "production-casing-1"]);
  const moved = moveComponent(collar.assembly, "production-casing-1", 2600);
  assert.equal(moved.items.find((entry) => entry.id === collar.itemId)!.topM, 2576, "shoe track follows the shoe");
  assert.equal(removeComponent(value, "wellhead-1").items.some((entry) => entry.catalogId === "christmas-tree"), false);
});

test("liner-top packers, perforations and plugs follow their hosts", () => {
  let value = placeComponent(blank(), "production-casing", 2000).assembly;
  assert.throws(() => placeComponent(value, "liner-top-packer", 1900), /needs a liner/);
  value = placeComponent(value, "liner", 1900).assembly;
  const ltp = placeComponent(value, "liner-top-packer", 100);
  assert.equal(ltp.assembly.items.find((entry) => entry.id === ltp.itemId)!.topM, 1900);
  assert.throws(() => placeComponent(blank(), "perforations", 1000), /cased interval/);
  const perfs = placeComponent(value, "perforations", 2490);
  const perf = perfs.assembly.items.find((entry) => entry.id === perfs.itemId)!;
  assert.equal(perf.hostId, "liner-1");
  assert.ok(perf.bottomM <= 2500 && perf.topM === 2480);
  value = placeComponent(value, "tubing", 1800).assembly;
  const plug = placeComponent(value, "bridge-plug", 1500).assembly;
  assert.ok(validateAssembly(plug).some((issue) => issue.code === "plug-in-tubing"));
  const packer = placeComponent(placeComponent(value, "packer", 1700).assembly, "perforations", 1200).assembly;
  assert.ok(validateAssembly(packer).some((issue) => issue.code === "perforations-above-packer"));
});
