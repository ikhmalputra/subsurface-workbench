import assert from "node:assert/strict";
import test from "node:test";
import { initialLayout, minSizes, moduleById, moduleIds } from "../src/modules/registry.ts";
import type { Layout } from "../src/deck/layout.ts";
import { COLS, ROWS, freeRects, without, isLayout, overlapArea, planDropIn, planMove, planOpen, planResize } from "../src/deck/layout.ts";

const opening = initialLayout as Layout;
/** A working deck: a small plan view over the 3D site on the left, the globe staged, the section right. */
const deck: Layout = { plan: { col: 0, row: 0, w: 3, h: 4 }, site3d: { col: 0, row: 4, w: 3, h: 4 }, globe: { col: 3, row: 0, w: 5, h: 8 }, section: { col: 8, row: 0, w: 4, h: 8 } };

test("the opening layout fills the grid without overlaps and respects every module's smallest size", () => {
  assert.ok(isLayout(opening, moduleIds, minSizes));
  const cells = Object.values(opening).reduce((sum, rect) => sum + rect.w * rect.h, 0);
  assert.equal(cells, COLS * ROWS);
  assert.ok(isLayout(deck, moduleIds, minSizes));
});

test("every module opens at a size it can be read at", () => {
  for (const spec of Object.values(moduleById)) assert.ok(spec.size.w >= spec.min.w && spec.size.h >= spec.min.h, spec.id);
});

test("a move into free cells lands where it was dropped", () => {
  const tiles = { ...deck, plan: { col: 0, row: 0, w: 3, h: 3 } };
  const drop = planMove(tiles, "site3d", { col: 0, row: 3.4, w: 3, h: 4 }, minSizes);
  assert.ok(drop);
  assert.deepEqual(drop.landed, { col: 0, row: 3, w: 3, h: 4 });
  assert.equal(drop.swappedWith, null);
});

test("a drop mostly over another tile swaps the two", () => {
  const drop = planMove(deck, "section", { col: 0, row: 0, w: 4, h: 8 }, minSizes);
  assert.ok(drop);
  assert.equal(drop.swappedWith, "plan");
  assert.deepEqual(drop.tiles.section, deck.plan);
  assert.deepEqual(drop.tiles.plan, deck.section);
});

test("a drop that only grazes a tile is refused", () => {
  assert.equal(planMove(deck, "plan", { col: 0, row: 1, w: 3, h: 4 }, minSizes), null);
});

test("a swap that would squeeze a module below its smallest size is refused", () => {
  const tiles = { globe: { col: 3, row: 0, w: 5, h: 8 }, plan: { col: 0, row: 0, w: 3, h: 3 }, site3d: { col: 0, row: 3, w: 3, h: 5 }, section: { col: 8, row: 0, w: 4, h: 8 } };
  // The 3D site needs four rows; the plan view's tile has three.
  assert.equal(planMove(tiles, "site3d", { col: 0, row: 0, w: 3, h: 5 }, minSizes), null);
});

test("a resize snaps, stops at the module's smallest size and never covers a neighbour", () => {
  const shrunk = planResize(deck, "section", { col: 8, row: 0, w: 1, h: 2 }, minSizes);
  assert.ok(shrunk);
  assert.deepEqual(shrunk.landed, { col: 8, row: 0, w: 3, h: 4 });
  assert.equal(planResize(deck, "plan", { col: 0, row: 0, w: 3, h: 6 }, minSizes), null);
});

test("opening a module takes free cells first, up to its preferred size", () => {
  const rest = without(deck, "section");
  const opened = planOpen(rest, "seismic", minSizes, moduleById.seismic.size, "globe");
  assert.ok(opened);
  assert.deepEqual(opened.landed, { col: 8, row: 0, w: 4, h: 6 });
  assert.equal(opened.split, null);
  assert.equal(opened.replaced, null);
});

test("on a full grid, opening trims a neighbour back along a clean edge, keeping every tile readable", () => {
  for (const id of ["strings", "seismic", "logs", "drilling"] as const) {
    const opened = planOpen(deck, id, minSizes, moduleById[id].size, "globe");
    assert.ok(opened, id);
    assert.equal(opened.replaced, null, id);
    assert.ok(opened.split, id);
    assert.ok(isLayout(opened.tiles, moduleIds, minSizes), id);
    assert.ok(opened.landed.w >= minSizes[id].w && opened.landed.h >= minSizes[id].h, id);
    const stage = opened.tiles.globe!;
    assert.ok(stage.w >= 4 && stage.h >= 5, `${id}: the stage stays a stage`);
  }
});

test("free cells beside a tile are used by trimming it, not by replacing it", () => {
  // Strings fills the top of the left half, with two free rows beneath it; the right half is full.
  const tiles: Layout = { strings: { col: 0, row: 0, w: 5, h: 6 }, window: { col: 5, row: 0, w: 3, h: 4 }, plan: { col: 5, row: 4, w: 3, h: 4 }, section: { col: 8, row: 0, w: 4, h: 8 } };
  const opened = planOpen(tiles, "well3d", minSizes, moduleById.well3d.size, "section");
  assert.ok(opened);
  assert.equal(opened.replaced, null);
  assert.ok(opened.tiles.strings, "strings stays open");
  assert.ok(isLayout(opened.tiles, moduleIds, minSizes));
});

test("when no tile can spare room, the module takes the place of the tile used longest ago, never the stage", () => {
  // Eight modules at their smallest (3 × 4) fill the grid; none can give a strip.
  const ids = ["site3d", "section", "well3d", "profile", "drilling", "cutaway", "logs", "seismic"];
  const full: Layout = Object.fromEntries(ids.map((id, index) => [id, { col: (index % 4) * 3, row: Math.floor(index / 4) * 4, w: 3, h: 4 }]));
  const opened = planOpen(full, "kick", minSizes, moduleById.kick.size, "section", { site3d: 30, section: 1, well3d: 20, profile: 5, drilling: 40, cutaway: 50, logs: 60, seismic: 70 });
  assert.ok(opened);
  assert.equal(opened.replaced, "profile");
  assert.deepEqual(opened.landed, full.profile);
  assert.equal(opened.tiles.profile, undefined);
});

test("a module dropped from the dock onto a tile takes its place; onto free cells, the room around the cell", () => {
  const over = planDropIn(deck, "seismic", { col: 9.5, row: 2.2 }, minSizes, moduleById.seismic.size);
  assert.ok(over);
  assert.equal(over.replaced, "section");
  const rest = without(deck, "section");
  const free = planDropIn(rest, "plan", { col: 10.2, row: 6.5 }, minSizes, moduleById.plan.size);
  assert.ok(free);
  assert.ok(overlapArea(free.landed, { col: 10, row: 6, w: 1, h: 1 }) > 0);
  assert.equal(free.replaced, null);
  assert.ok(freeRects(free.tiles, { w: 1, h: 1 }).length > 0);
});

test("a stored layout with an overlap, an unknown module or a squeezed tile is not used", () => {
  assert.equal(isLayout({ ...deck, plan: deck.globe }, moduleIds, minSizes), false);
  assert.equal(isLayout({ ...opening, nowhere: { col: 0, row: 0, w: 1, h: 1 } }, moduleIds, minSizes), false);
  assert.equal(isLayout({ ...deck, plan: { col: 0, row: 0, w: 2, h: 4 } }, moduleIds, minSizes), false);
  assert.equal(isLayout({ ...deck, site: deck.plan }, moduleIds, minSizes), false, "a module that no longer exists");
  assert.equal(isLayout({}, moduleIds, minSizes), false);
  assert.equal(isLayout(null, moduleIds, minSizes), false);
});
