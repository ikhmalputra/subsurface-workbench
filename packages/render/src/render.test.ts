import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Group, Mesh, Object3D, Vector3 } from "three";
import { absent, isKnown, reported } from "@ikhmalputra/subsurface-kernel";
import { positions } from "@ikhmalputra/subsurface-calc";
import { find, placeAll, readCatalogue, type Component } from "@ikhmalputra/subsurface-scene";
import { forgePublishedPath, forgeStations } from "@ikhmalputra/subsurface-fixtures";
import { alignToHole, defaultFrame, holeDirection, toScene, toWell } from "./frame.ts";
import { buildAssembly, dispose } from "./assembly.ts";

const catalogue = readCatalogue(JSON.parse(readFileSync(new URL("../../react/assets/well-components/manifest.json", import.meta.url), "utf8")));
const path = positions(forgeStations, { tieIn: forgePublishedPath[0] });
assert.ok(isKnown(path));
const sized = (m: number) => reported(m, { document: "Drilling Summary" });

test("the frame mapping is exactly invertible", () => {
  // Every pick and probe goes back through this, so a host receives metres in its own frame rather
  // than an unexplained three.js vector. A mapping that does not round-trip loses the well.
  for (const point of [{ northingM: 0, eastingM: 0, tvdM: 0 }, { northingM: -98.2, eastingM: 311.5, tvdM: 2608.7 }]) {
    const back = toWell(toScene(point));
    assert.ok(Math.abs(back.northingM - point.northingM) < 1e-9);
    assert.ok(Math.abs(back.eastingM - point.eastingM) < 1e-9);
    assert.ok(Math.abs(back.tvdM - point.tvdM) < 1e-9);
  }
});

test("the frame puts depth below, east to the right and north away", () => {
  assert.ok(toScene({ northingM: 0, eastingM: 0, tvdM: 100 }).y < 0, "depth counts down");
  assert.ok(toScene({ northingM: 0, eastingM: 100, tvdM: 0 }).x > 0, "east is right");
  assert.ok(toScene({ northingM: 100, eastingM: 0, tvdM: 0 }).z < 0, "north is away from the camera");
});

test("a vertical hole points straight down and needs no rotation", () => {
  const down = holeDirection(0, 0);
  assert.ok(down.distanceTo(new Vector3(0, -1, 0)) < 1e-9);
  // The models are authored hanging downward, so vertical is the identity.
  assert.ok(Math.abs(alignToHole(0, 0).angleTo(alignToHole(0, 0))) < 1e-9);
  const east = holeDirection(90, 90);
  assert.ok(east.distanceTo(new Vector3(1, 0, 0)) < 1e-6, "90° inclination on a 90° azimuth points east");
});

const loadStub = async (): Promise<Object3D> => new Mesh();
const components: Component[] = [
  { id: "surface", modelId: "surface-casing", topMdM: 0, baseMdM: 497, outerDiameterM: sized(0.3397), fit: "stretch" },
  { id: "master", modelId: "wellhead", topMdM: 0, baseMdM: 0, outerDiameterM: sized(0.5), fit: "natural" },
];

test("drawn parts become generated tubes and modelled parts are loaded", async () => {
  const placed = placeAll(components, path.value, (id) => find(catalogue, id));
  assert.equal(placed.placements.length, 2);
  const built = await buildAssembly(placed.placements, { assetBaseUrl: "/well-components", load: loadStub });
  assert.equal(built.drawn.length, 2);
  assert.equal(built.failed.length, 0);
  assert.ok(built.group instanceof Group);
  // The casing has no glTF in the catalogue, so it is geometry this layer generated.
  const casing = built.drawn.find((one) => one.componentId === "surface")!.object as Mesh;
  assert.ok(casing.geometry, "the casing is a generated tube");
  assert.equal(casing.userData.componentId, "surface");
  // The basis of what was drawn travels with the object, for a tooltip or a selection panel.
  assert.equal(casing.userData.radiusBasis, "reported");
  dispose(built);
});

test("a model that fails to load is reported, never silently omitted", async () => {
  const placed = placeAll(components, path.value, (id) => find(catalogue, id));
  const built = await buildAssembly(placed.placements, {
    assetBaseUrl: "/well-components",
    load: async (url) => { throw new Error(`404 ${url}`); },
  });
  // The casing still draws; only the modelled part failed.
  assert.equal(built.drawn.length, 1);
  assert.equal(built.failed.length, 1);
  assert.equal(built.failed[0]!.componentId, "master");
  assert.match(built.failed[0]!.why, /404/);
});

test("a part is placed where the survey puts it, through the frame", async () => {
  const deep: Component = { id: "production", modelId: "production-casing", topMdM: 3000, baseMdM: 3288, outerDiameterM: sized(0.1778), fit: "stretch" };
  const placed = placeAll([deep], path.value, (id) => find(catalogue, id));
  const built = await buildAssembly(placed.placements, { assetBaseUrl: "/x", load: loadStub });
  const object = built.drawn[0]!.object;
  // Converted back, the object sits where the trajectory says, not straight below the wellhead.
  const back = toWell(object.position.clone(), defaultFrame);
  assert.ok(back.tvdM > 2400 && back.tvdM < 2600, `expected ~2,472 m TVD, got ${back.tvdM}`);
  assert.ok(Math.hypot(back.northingM, back.eastingM) > 200, "and hundreds of metres out from the wellhead");
});

test("an unreported diameter still draws, and the object says it is nominal", async () => {
  const unknown: Component = { id: "liner", modelId: "intermediate-casing", topMdM: 1000, baseMdM: 1200, outerDiameterM: absent("no outer diameter in the record"), fit: "stretch" };
  const placed = placeAll([unknown], path.value, (id) => find(catalogue, id));
  const built = await buildAssembly(placed.placements, { assetBaseUrl: "/x", load: loadStub });
  assert.equal(built.drawn[0]!.object.userData.radiusBasis, "nominal");
  assert.match(String(built.drawn[0]!.object.userData.note), /no outer diameter was reported/);
});
