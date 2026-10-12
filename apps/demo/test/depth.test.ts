import assert from "node:assert/strict";
import test from "node:test";
import { METRES_PER_INTERNATIONAL_FOOT, METRES_PER_US_SURVEY_FOOT, feetToMetres, forgeDesign, getWellComponents, metresToFeet, usSurveyFeetToMetres } from "@ikhmalputra/subsurface-core";
import type { DepthLink } from "@ikhmalputra/subsurface-react";
import { depthBridge, recordDepthToMetres } from "../src/lib/depth.ts";

/** A DepthLink standing in for the store, recording what the bridge writes to it. */
function fakeLink(initial: { cursorMdM?: number | null; pinnedMdM?: number | null; window?: readonly [number, number] | null } = {}) {
  const writes: { cursor: (number | null)[]; pinned: (number | null)[]; windows: (readonly [number, number] | null)[] } = { cursor: [], pinned: [], windows: [] };
  const link = {
    linked: true, setLinked() {},
    window: initial.window ?? null,
    setWindow: (next: readonly [number, number] | null) => { writes.windows.push(next); },
    cursorMdM: initial.cursorMdM ?? null,
    setCursorMdM: (next: number | null) => { writes.cursor.push(next); },
    pinnedMdM: initial.pinnedMdM ?? null,
    pinCursor: (next: number | null) => { writes.pinned.push(next); },
  } as unknown as DepthLink;
  return { link, writes };
}

test("the bridge converts both ways and never loses the depth it was given", () => {
  const { link, writes } = fakeLink({ cursorMdM: 1000, pinnedMdM: 500, window: [100, 200] });
  const bridge = depthBridge(link);
  assert.equal(bridge.cursorFt, metresToFeet(1000));
  assert.equal(bridge.pinnedFt, metresToFeet(500));
  assert.deepEqual(bridge.windowFt, [metresToFeet(100), metresToFeet(200)]);
  // A depth that goes out to a feet view and comes back must be the same depth, or a view that
  // echoes the cursor would walk it a little further every time the pointer crossed the boundary.
  bridge.pinFt(bridge.pinnedFt!);
  assert.equal(writes.pinned[0], 500);
  bridge.setCursorFt(bridge.cursorFt!);
  assert.equal(writes.cursor[0], 1000);
});

test("null is a depth too: nothing is converted into a zero", () => {
  const { link, writes } = fakeLink();
  const bridge = depthBridge(link);
  assert.equal(bridge.cursorFt, null);
  assert.equal(bridge.pinnedFt, null);
  assert.equal(bridge.windowFt, null);
  bridge.setCursorFt(null);
  bridge.pinFt(null);
  bridge.setWindowFt(null);
  assert.deepEqual(writes, { cursor: [null], pinned: [null], windows: [null] });
  assert.equal(recordDepthToMetres(null), undefined);
  assert.equal(recordDepthToMetres(undefined), undefined);
  assert.equal(recordDepthToMetres(1000), feetToMetres(1000));
});

test("a window is rounded to whole metres, a cursor is not", () => {
  const { link, writes } = fakeLink();
  const bridge = depthBridge(link);
  bridge.setWindowFt([1000, 2000]);
  assert.deepEqual(writes.windows[0], [305, 610]);
  // The cursor is a measurement the views quote back, so it keeps its precision.
  bridge.setCursorFt(1000);
  assert.equal(writes.cursor[0], feetToMetres(1000));
});

test("a component's range starts at surface when its top is unreported", () => {
  const bridge = depthBridge(fakeLink().link);
  const components = getWellComponents(forgeDesign);
  const unreported = components.find((component) => component.topDepthReported === false);
  assert.ok(unreported, "FORGE has a component with an unreported top");
  // Plotted from surface, never guessed at: the drawings make the same choice and say so.
  assert.equal(bridge.rangeOf(unreported)!.topFt, 0);
  const reported = components.find((component) => component.topDepthReported !== false && component.topDepthM > 0)!;
  assert.equal(bridge.rangeOf(reported)!.topFt, metresToFeet(reported.topDepthM));
  assert.equal(bridge.rangeOf(undefined), null);
});

test("the two feet this project's data uses are both named, and differ as the standards say", () => {
  assert.equal(METRES_PER_INTERNATIONAL_FOOT, 0.3048);
  assert.equal(METRES_PER_US_SURVEY_FOOT, 1200 / 3937);
  // 2 ppm apart: ~7 mm at the FORGE survey end. Never a disagreement about where the well is, but
  // the survey workbook declares US survey feet and the drilling report declares feet, and quoting
  // one with the other's factor misstates a sourced number.
  const differenceM = usSurveyFeetToMetres(10955) - feetToMetres(10955);
  assert.ok(differenceM > 0.006 && differenceM < 0.007, `expected ~7 mm, got ${differenceM}`);
  // The survey was ingested with the US survey foot; this is the value the core tests pin.
  assert.ok(Math.abs(forgeDesign.survey!.at(-1)!.mdM - usSurveyFeetToMetres(10955)) < 1e-9);
});
