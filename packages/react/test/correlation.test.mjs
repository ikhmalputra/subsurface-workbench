import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MultiWellCorrelation, decimateCorrelationSamples } from "../dist/correlation.js";

function curve(wellId, id, depths, values) {
  return {
    version: 1,
    id,
    wellId,
    unit: "v/v",
    depthsMdM: Float32Array.from(depths),
    values: Float32Array.from(values),
    nullValue: "nan",
  };
}

function well(id, tops) {
  return {
    id,
    label: `Well ${id}`,
    provenance: "synthetic",
    tracks: [{
      curve: curve(id, `${id}-porosity`, [0, 100, 200, 300, 400, 500], [0.1, 0.12, 0.3, Number.NaN, 0.14, 0.11]),
      label: "Porosity",
      color: "#147a65",
      domain: [0, 0.4],
    }],
    tops,
  };
}

test("correlation decimation preserves screen-bucket extrema and missing-data breaks", () => {
  const values = new Float32Array(1000);
  for (let index = 0; index < values.length; index += 1) values[index] = 0.1;
  values[237] = 0.9;
  values[502] = Number.NaN;
  values[783] = -0.4;
  const output = decimateCorrelationSamples({
    version: 1,
    id: "dense",
    wellId: "well",
    unit: "v/v",
    depthsMdM: Float32Array.from({ length: 1000 }, (_, index) => index),
    values,
    nullValue: "nan",
  }, 0, 0, 999, 10, 1);

  assert.ok(output.length < 80, `expected decimation, received ${output.length} points`);
  assert.ok(output.some((sample) => sample.mdM === 237 && Math.abs(sample.value - 0.9) < 1e-6));
  assert.ok(output.some((sample) => sample.mdM === 783 && Math.abs(sample.value + 0.4) < 1e-6));
  assert.ok(output.some((sample) => sample.mdM === 502 && sample.value === null));
});

test("correlation view renders labelled provenance, explicit flattening, linked tops and keyboard depth controls", () => {
  const wells = [
    well("a", [{ id: "top-1", label: "Top One", mdM: 100 }, { id: "top-2", label: "Top Two", mdM: 300 }]),
    well("b", [{ id: "top-1", label: "Top One", mdM: 150 }, { id: "top-2", label: "Top Two", mdM: 350 }]),
  ];
  const html = renderToStaticMarkup(createElement(MultiWellCorrelation, {
    wells,
    flattenOn: "top-1",
    onFlattenOnChange: () => {},
  }));

  assert.match(html, /data-testid="multiwell-correlation"/);
  assert.match(html, /Flattened on Top One/);
  assert.match(html, /SYNTHETIC/);
  assert.match(html, /data-linked-top="top-2"/);
  assert.match(html, /role="slider"/);
  assert.match(html, /Synthetic inputs are for visualization testing only/);
  assert.match(html, /What the plot is based on/);
  assert.match(html, /Per-track sample coverage and observed values/);
  assert.match(html, /Top tie audit: supplied measured depths and relative offsets from Top One/);
  assert.match(html, /100 \/ 0 m/);
  assert.match(html, /150 \/ 0 m/);
  assert.match(html, /Observed min–max/);
  assert.match(html, /Outside display limits/);
  assert.match(html, /5 \/ 6/);
  assert.match(html, /0\.1–0\.3 v\/v/);
  assert.match(html, /0\.154 v\/v/);
  assert.match(html, /Top One · 100 m MD/);
});

test("correlation links stop at missing tops instead of bridging unknown ties", () => {
  const wells = [
    well("a", [{ id: "top-1", label: "Top One", mdM: 100 }, { id: "top-2", label: "Top Two", mdM: 300 }]),
    well("b", [{ id: "top-1", label: "Top One", mdM: 150 }]),
    well("c", [{ id: "top-1", label: "Top One", mdM: 120 }, { id: "top-2", label: "Top Two", mdM: 360 }]),
  ];
  const html = renderToStaticMarkup(createElement(MultiWellCorrelation, { wells, flattenOn: "top-1" }));
  const linkedTop = html.match(/<path[^>]*data-linked-top="top-2"[^>]*>/)?.[0];

  assert.ok(linkedTop);
  assert.equal((linkedTop.match(/M/g) ?? []).length, 2, "missing middle tie must break the correlation line");
  assert.match(html, /Top Two missing in Well b/);
});

test("correlation tie audit does not imply relative depths when flattening is disabled", () => {
  const html = renderToStaticMarkup(createElement(MultiWellCorrelation, {
    wells: [
      well("a", [{ id: "top-1", label: "Top One", mdM: 100 }]),
      well("b", [{ id: "top-1", label: "Top One", mdM: 150 }]),
    ],
  }));

  assert.match(html, /no flattening reference is selected/);
  assert.match(html, /100 m MD/);
  assert.doesNotMatch(html, /100 \/ 0 m/);
});

test("correlation view rejects implicit marker alignment and mismatched curve ownership", () => {
  const tied = well("a", [{ id: "top-1", label: "Top One", mdM: 100 }]);
  const untied = well("b", []);
  assert.throws(
    () => renderToStaticMarkup(createElement(MultiWellCorrelation, { wells: [tied, untied], flattenOn: "top-1" })),
    /not present in every well/,
  );

  const wrongOwner = { ...well("b", []), tracks: [{ ...well("b", []).tracks[0], curve: curve("other", "log", [0, 10], [1, 2]) }] };
  assert.throws(
    () => renderToStaticMarkup(createElement(MultiWellCorrelation, { wells: [tied, wrongOwner] })),
    /does not belong to well/,
  );
});
