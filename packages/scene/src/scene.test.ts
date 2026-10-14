import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { absent, isKnown, reported } from "@ikhmalputra/subsurface-kernel";
import { positions } from "@ikhmalputra/subsurface-calc";
import { forgePublishedPath, forgeStations } from "@ikhmalputra/subsurface-fixtures";
import { find, modelHeight, readCatalogue } from "./catalogue.ts";
import { place, placeAll, type Component } from "./place.ts";

const manifest = readCatalogue(JSON.parse(readFileSync(new URL("../../react/assets/well-components/manifest.json", import.meta.url), "utf8")));
const path = positions(forgeStations, { tieIn: forgePublishedPath[0] });
assert.ok(isKnown(path));
const where = path.value;
const sized = (metres: number) => reported(metres, { document: "Drilling Summary", at: "p10" });

test("the shipped catalogue satisfies its own contract", () => {
  assert.equal(manifest.components.length, 55);
  assert.equal(manifest.provenance, "synthetic");
  // Seven of them are casing strings and hole sections: tubes generated from two diameters and an
  // interval rather than sculpted, so they ship a thumbnail for the palette and no glTF.
  assert.equal(manifest.components.filter((entry) => entry.kind === "drawn").length, 7);
  // Every file that does ship carries a digest, so a host can check what it loaded was published.
  for (const entry of manifest.components) {
    assert.match(entry.thumbnailSha256, /^[0-9a-f]{64}$/, `${entry.id} thumbnail digest`);
    if (entry.kind === "modelled") assert.match(entry.modelSha256!, /^[0-9a-f]{64}$/, `${entry.id} model digest`);
    assert.ok(modelHeight(entry) > 0, `${entry.id} has height`);
  }
  // And it states what it may not be used to claim, which a view is expected to show.
  assert.match(manifest.compatibility, /not manufacturer CAD/i);
});

test("a manifest that breaks the contract is refused, by field", () => {
  assert.throws(() => readCatalogue({ ...manifest, components: [] }), /non-empty/);
  const [first] = manifest.components;
  assert.throws(() => readCatalogue({ ...manifest, components: [first, first] }), /appears twice/);
  assert.throws(() => readCatalogue({ ...manifest, components: [{ ...first, bounds: { radius: 1, top: -1, bottom: 1 } }] }), /top must be above/);
  // A model named without its digest could not be verified, which defeats shipping digests at all.
  assert.throws(() => readCatalogue({ ...manifest, components: [{ ...first, modelSha256: undefined }] }), /modelSha256/);
  assert.equal(find(manifest, "no-such-part").state, "absent");
});

test("a reported diameter is drawn at that diameter and says so", () => {
  const entry = find(manifest, "casing-spool");
  assert.ok(isKnown(entry));
  const casing: Component = { id: "surface", modelId: "casing-spool", topMdM: 0, baseMdM: 497, outerDiameterM: sized(0.3397), fit: "stretch" };
  const placed = place(casing, where, entry.value);
  assert.ok(isKnown(placed));
  assert.equal(placed.value.radiusBasis, "reported");
  assert.match(placed.value.note, /13\.374 in, reported/);
  // Stretched over its run: 497 m of hole across the model's own height.
  assert.ok(Math.abs(placed.value.lengthScale - 497 / modelHeight(entry.value)) < 1e-9);
});

test("an unreported diameter is nominal, labelled, and never invented", () => {
  const entry = find(manifest, "casing-spool");
  assert.ok(isKnown(entry));
  const unknown: Component = { id: "liner", modelId: "casing-spool", topMdM: 1000, baseMdM: 1200, outerDiameterM: absent("no outer diameter in the record"), fit: "stretch" };
  const placed = place(unknown, where, entry.value);
  assert.ok(isKnown(placed));
  assert.equal(placed.value.radiusBasis, "nominal");
  assert.match(placed.value.note, /no outer diameter was reported/);
});

test("every placement carries the exaggeration, so no reader assumes true scale", () => {
  const entry = find(manifest, "casing-spool");
  assert.ok(isKnown(entry));
  const casing: Component = { id: "surface", modelId: "casing-spool", topMdM: 0, baseMdM: 497, outerDiameterM: sized(0.3397), fit: "stretch" };
  const drawn = place(casing, where, entry.value);
  const true_ = place(casing, where, entry.value, { exaggeration: 1 });
  assert.ok(isKnown(drawn) && isKnown(true_));
  assert.match(drawn.value.note, /widths exaggerated ×150/);
  assert.ok(drawn.value.radiusScale > true_.value.radiusScale * 149);
});

test("a discrete part keeps its modelled proportions in a long section", () => {
  const entry = find(manifest, "wellhead");
  assert.ok(isKnown(entry));
  const valve: Component = { id: "master", modelId: "wellhead", topMdM: 0, baseMdM: 0, outerDiameterM: sized(0.5), fit: "natural" };
  const placed = place(valve, where, entry.value);
  assert.ok(isKnown(placed));
  assert.equal(placed.value.lengthScale, placed.value.radiusScale, "a valve is not stretched into a tube");
});

test("what cannot be placed comes back with the reason, never silently dropped", () => {
  const components: Component[] = [
    { id: "surface", modelId: "casing-spool", topMdM: 0, baseMdM: 497, outerDiameterM: sized(0.3397), fit: "stretch" },
    { id: "ghost", modelId: "not-in-the-catalogue", topMdM: 0, baseMdM: 10, outerDiameterM: sized(0.2), fit: "stretch" },
    { id: "upside-down", modelId: "casing-spool", topMdM: 900, baseMdM: 400, outerDiameterM: sized(0.2), fit: "stretch" },
  ];
  const result = placeAll(components, where, (id) => find(manifest, id));
  assert.equal(result.placements.length, 1);
  assert.equal(result.omitted.length, 2);
  assert.match(result.omitted[0]!.why, /no entry for "not-in-the-catalogue"/);
  assert.match(result.omitted[1]!.why, /ends above it starts/);
});

test("a component is placed where the survey actually puts it, not straight down", () => {
  const entry = find(manifest, "casing-spool");
  assert.ok(isKnown(entry));
  const deep: Component = { id: "production", modelId: "casing-spool", topMdM: 3000, baseMdM: 3288, outerDiameterM: sized(0.1778), fit: "stretch" };
  const placed = place(deep, where, entry.value);
  assert.ok(isKnown(placed));
  // FORGE is at 65° by 3,000 m: the top of this string is half a kilometre shallower than its
  // measured depth and hundreds of metres out from the wellhead.
  assert.ok(placed.value.top.tvdM < 2600, `expected TVD well above MD, got ${placed.value.top.tvdM}`);
  assert.ok(Math.hypot(placed.value.top.northingM, placed.value.top.eastingM) > 200);
  assert.ok(placed.value.along.inclinationDeg > 50);
});

test("a component running below the last survey station is refused, not clamped to it", () => {
  const entry = find(manifest, "casing-spool");
  assert.ok(isKnown(entry));
  const last = where.at(-1)!.mdM;
  const below: Component = { id: "deep", modelId: "casing-spool", topMdM: last + 11, baseMdM: last + 13, outerDiameterM: absent("not reported"), fit: "stretch" };
  const across: Component = { id: "across", modelId: "casing-spool", topMdM: last - 39, baseMdM: last + 61, outerDiameterM: absent("not reported"), fit: "stretch" };
  for (const component of [below, across]) {
    const result = place(component, where, entry.value);
    assert.equal(result.state, "absent");
    assert.match(result.state === "absent" ? result.why : "", /outside the surveyed/);
  }
});
