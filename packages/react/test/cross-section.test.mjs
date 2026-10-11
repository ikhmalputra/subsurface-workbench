import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WellCrossSection, projectCrossSectionPoint } from "../dist/cross-section.js";

const reference = { units: "m", crs: "local: east/north", depthDatum: "RKB" };

function well(id, x, y, tops = [{ id: "top-a", label: "Top A", mdM: 100 }]) {
  return {
    id,
    label: `Well ${id}`,
    provenance: "documented",
    trajectory: {
      version: 1,
      id,
      reference,
      xyz: new Float64Array([x, y, 0, x, y, 100, x, y, 200]),
      depthsMdM: new Float64Array([0, 100, 200]),
      inclinationsDeg: new Float32Array([0, 0, 0]),
      azimuthsDeg: new Float32Array([0, 0, 0]),
    },
    tops,
  };
}

test("cross-section projection reports along-curtain, signed offset, and positive-down depth", () => {
  assert.deepEqual(projectCrossSectionPoint([50, 20, 120], [0, 0], [1, 0]), {
    alongM: 50,
    offsetM: 20,
    depthM: 120,
  });
  assert.deepEqual(projectCrossSectionPoint([50, 20, 120], [0, 0], [0, 1]), {
    alongM: 20,
    offsetM: -50,
    depthM: 120,
  });
  assert.throws(() => projectCrossSectionPoint([Number.NaN, 0, 1], [0, 0], [1, 0]), /finite/);
});

test("cross-section draws explicit trajectory and top ties and discloses off-plane projection", () => {
  const html = renderToStaticMarkup(createElement(WellCrossSection, {
    wells: [well("a", 0, 0), well("b", 50, 20), well("c", 100, 0)],
    maxOffsetM: 5,
  }));

  assert.match(html, /data-testid="well-cross-section"/);
  assert.doesNotMatch(html, /data-linked-top="top-a"/, "an off-curtain top must not be linked into the section");
  const alignedHtml = renderToStaticMarkup(createElement(WellCrossSection, {
    wells: [well("a", 0, 0), well("b", 50, 0), well("c", 100, 0)],
    maxOffsetM: 5,
  }));
  assert.match(alignedHtml, /data-linked-top="top-a"/);
  assert.match(html, /outside the 5 m curtain tolerance are dashed/);
  assert.match(html, /Well b is 20 m from the curtain/);
  assert.match(html, /role="button" tabindex="0" aria-label="Focus Well a/);
});

test("cross-section breaks top ties across a missing well and refuses unlike references", () => {
  const wells = [
    well("a", 0, 0, [{ id: "top-a", label: "Top A", mdM: 100 }, { id: "top-b", label: "Top B", mdM: 150 }]),
    well("b", 50, 0, [{ id: "top-a", label: "Top A", mdM: 100 }]),
    well("c", 100, 0, [{ id: "top-a", label: "Top A", mdM: 100 }, { id: "top-b", label: "Top B", mdM: 160 }]),
  ];
  const html = renderToStaticMarkup(createElement(WellCrossSection, { wells }));
  const top = html.match(/<path[^>]*data-linked-top="top-b"[^>]*>/)?.[0];
  assert.equal(top, undefined, "the missing middle tie must prevent a connecting path");

  assert.throws(() => renderToStaticMarkup(createElement(WellCrossSection, {
    wells: [well("a", 0, 0), { ...well("b", 100, 0), trajectory: { ...well("b", 100, 0).trajectory, reference: { ...reference, depthDatum: "MSL" } } }],
  })), /same declared units, CRS, and depth datum/);
});

test("cross-section requires a real corridor and finite tolerance", () => {
  assert.throws(() => renderToStaticMarkup(createElement(WellCrossSection, { wells: [well("a", 0, 0)] })), /at least two wells/);
  assert.throws(() => renderToStaticMarkup(createElement(WellCrossSection, { wells: [well("a", 0, 0), well("b", 0, 0)] })), /distinct horizontal wellhead/);
  assert.throws(() => renderToStaticMarkup(createElement(WellCrossSection, { wells: [well("a", 0, 0), well("b", 100, 0)], maxOffsetM: -1 })), /offset must be finite/);
});
