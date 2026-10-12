import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { forgeOperations, metresToFeet } from "../../core/dist/index.js";
import { DaysVsDepthChart } from "../dist/records.js";

const render = (props = {}) => renderToStaticMarkup(createElement(DaysVsDepthChart, { operations: forgeOperations, ...props }));

test("the drill-stage chart follows the shared depth cursor", () => {
  // The only view on the axis this stage reasons on — date and MD together — could neither accept
  // a depth nor emit one, so a depth had to be carried between four views in the reader's head.
  const without = render();
  assert.doesNotMatch(without, /sw-dvd-depth-cursor/);

  const at = 1500;
  const html = render({ cursorMdM: at });
  assert.match(html, /sw-dvd-depth-cursor/);
  // The Y axis is already measured depth, so the cursor is exact: the label is the converted depth,
  // not an interpolated position.
  assert.match(html, new RegExp(`data-cursor-ft="${metresToFeet(at).toFixed(1)}"`));

  // A cursor outside the plotted depth range is not drawn at the edge as if it were inside it.
  assert.doesNotMatch(render({ cursorMdM: 99_000 }), /sw-dvd-depth-cursor/);
  assert.doesNotMatch(render({ cursorMdM: null }), /sw-dvd-depth-cursor/);
});

test("runs that did not complete are marked at their depths, and nowhere else", () => {
  const html = render();
  const trouble = forgeOperations.runs.filter((run) => run.outcome !== "completed");
  assert.equal(trouble.length, 9, "FORGE has nine runs that ended with a problem or failure");
  const marks = [...html.matchAll(/class="sw-dvd-trouble" data-run-id="([^"]+)" data-outcome="([^"]+)" data-top-reported="([^"]+)"/g)];
  assert.deepEqual(marks.map(([, id]) => id), trouble.map((run) => run.id), "all nine are marked");
  assert.deepEqual([...new Set(marks.map(([, , outcome]) => outcome))].sort(), ["failed", "problem"]);

  // Five report a base depth and no top. A band would have to invent the top, so those are lines.
  const withoutTop = marks.filter(([, , , reported]) => reported === "false");
  assert.equal(withoutTop.length, 5);
  assert.equal(trouble.filter((run) => run.topFt === null).length, 5);
  assert.match(html, /base 10,987 ft, top not reported/);

  // The records carry depths but no dates, so nothing places them on the day axis, and the legend
  // says all of that rather than leaving the marks unexplained.
  assert.match(html, /9 of 54 runs ended with a problem or failure/);
  assert.match(html, /5 report a base and no top, drawn as a line rather than an interval/);
  assert.match(html, /carry no dates, so none is placed on the day axis/);
});
