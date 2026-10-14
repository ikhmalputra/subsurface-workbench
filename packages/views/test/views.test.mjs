import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { absent, createSelectionStore, cursorMdM, isKnown, reported } from "@ikhmalputra/subsurface-kernel";
import { positions } from "@ikhmalputra/subsurface-calc";
import { find, placeAll, readCatalogue } from "@ikhmalputra/subsurface-scene";
import { forgePublishedPath, forgeStations } from "@ikhmalputra/subsurface-fixtures";
import { WellSchematic } from "../dist/schematic.js";

const catalogue = readCatalogue(JSON.parse(readFileSync(join(import.meta.dirname, "../../react/assets/well-components/manifest.json"), "utf8")));
const path = positions(forgeStations, { tieIn: forgePublishedPath[0] });
assert.ok(isKnown(path));
const sized = (m) => reported(m, { document: "Drilling Summary" });
const components = [
  { id: "surface", modelId: "surface-casing", topMdM: 0, baseMdM: 497, outerDiameterM: sized(0.3397), fit: "stretch" },
  { id: "intermediate", modelId: "intermediate-casing", topMdM: 0, baseMdM: 1558, outerDiameterM: absent("no outer diameter in the record"), fit: "stretch" },
  { id: "production", modelId: "production-casing", topMdM: 0, baseMdM: 3288, outerDiameterM: sized(0.1778), fit: "stretch" },
];
const placements = placeAll(components, path.value, (id) => find(catalogue, id)).placements;
const draw = (props = {}) => renderToStaticMarkup(createElement(WellSchematic, { placements, fromMdM: 0, toMdM: 3339, ...props }));

test("the schematic draws every placement it was given", () => {
  const html = draw();
  assert.equal(placements.length, 3);
  for (const component of ["surface", "intermediate", "production"]) {
    assert.match(html, new RegExp(`data-component="${component}"`), `${component} is drawn`);
  }
});

test("a part drawn at a nominal radius is dashed, not quietly solid", () => {
  const html = draw();
  // The difference between measured and assumed has to be visible in the drawing itself, not only
  // in a tooltip nobody opens.
  assert.match(html, /data-basis="nominal"[^>]*>[\s\S]{0,400}?stroke-dasharray/);
  assert.match(html, /data-basis="reported"/);
});

test("the basis travels into the title, so hovering says why", () => {
  const html = draw();
  assert.match(html, /no outer diameter was reported/);
  assert.match(html, /widths exaggerated ×150/);
});

test("the widest string is drawn first so a nested one is not hidden by it", () => {
  const html = draw();
  const order = [...html.matchAll(/data-component="([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(order, ["surface", "intermediate", "production"], "widest to narrowest");
});

test("two views sharing a store share a selection; one without keeps its own", () => {
  const store = createSelectionStore();
  store.set({ componentId: "production" }, "test");
  const linked = draw({ store });
  assert.match(linked, /data-component="production"[^>]*data-selected="true"/);
  // The same markup without a store shows nothing selected, which is what a host that wants to own
  // everything should get.
  assert.doesNotMatch(draw(), /data-selected/);
});

test("the store announces only real changes, and names what moved", () => {
  const store = createSelectionStore();
  const seen = [];
  store.subscribe((change) => seen.push(`${change.origin}:${change.changed.join(",")}`));
  store.set({ componentId: "surface" }, "schematic");
  store.set({ componentId: "surface" }, "schematic");   // no change, so no event
  store.hover(1558, "section");
  store.hover(1558, "section");                          // likewise
  store.set({ window: [0, 500] }, "ruler");
  store.set({ window: [0, 500] }, "ruler");              // array compared by value, not identity
  assert.deepEqual(seen, ["schematic:componentId", "section:hoverMdM", "ruler:window"]);
});

test("the cursor is what was picked, falling back to what is under the pointer", () => {
  const store = createSelectionStore();
  store.hover(900, "section");
  assert.equal(cursorMdM(store.get()), 900);
  store.set({ pinnedMdM: 1558 }, "ruler");
  assert.equal(cursorMdM(store.get()), 1558, "a pick outranks a hover");
  assert.match(draw({ store }), /sw-schematic-cursor/);
});
