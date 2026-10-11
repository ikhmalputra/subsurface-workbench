import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { validateInteractionDataset } from "../../core/dist/dataset.js";
import { createSubsurfaceStore } from "../../core/dist/state.js";
import { LinkedDatasetView } from "../dist/linked-dataset.js";
import { SubsurfaceThemeProvider } from "../dist/visual-provider.js";

function dataset(size = 80) {
  const keyValues = Float64Array.from({ length: size }, (_, index) => index * 10);
  const spatialXYZ = Float64Array.from({ length: size * 3 }, (_, index) => index % 3 === 0 ? Math.floor(index / 3) : index % 3 === 1 ? Math.sin(index / 9) : index);
  const values = Float32Array.from({ length: size }, (_, index) => index === 3 ? Number.NaN : Math.sin(index / 8));
  return validateInteractionDataset({
    version: 1,
    id: "test-dataset",
    assetId: "asset:well-a",
    wellId: "well-a",
    key: { kind: "depth", unit: "m", reference: "MD" },
    sampleIds: Array.from({ length: size }, (_, index) => `sample-${index}`),
    keyValues,
    columns: [{ id: "gamma", label: "Gamma Ray", unit: "API", values, nullValue: "nan" }],
    reference: { units: "m", crs: "local:test", depthDatum: "RKB" },
    spatialXYZ,
  });
}

test("linked dataset renders explicit units, missing-value wording and one virtual table window", () => {
  const store = createSubsurfaceStore();
  store.setDataInteraction({ datasetId: "test-dataset" });
  const html = renderToStaticMarkup(createElement(LinkedDatasetView, { dataset: dataset(500), store, tableHeight: 180 }));
  assert.match(html, /Measured depth \(m MD\)/);
  assert.match(html, /Gamma Ray \(API\)/);
  assert.match(html, /not reported/);
  assert.match(html, /role="grid"/);
  assert.match(html, /Spatial samples/);
  assert.match(html, /aria-describedby=/);
  assert.match(html, /colour scale from/);
  assert.equal((html.match(/role="button" tabindex="0"/g) ?? []).length, 1, "chart points use roving tab focus");
  assert.ok((html.match(/<tr[^>]*data-sample-id=/g) ?? []).length < 30, "table rows should be windowed instead of rendering the full dataset");
});

test("theme and density provider updates visual tokens and virtual row height", () => {
  const html = renderToStaticMarkup(createElement(
    SubsurfaceThemeProvider,
    { theme: "high-contrast", density: "compact" },
    createElement(LinkedDatasetView, { dataset: dataset(20) }),
  ));
  assert.match(html, /data-sw-theme="high-contrast"/);
  assert.match(html, /data-sw-density="compact"/);
  assert.match(html, /style="height:36px"/);
});

test("linked dataset brush narrows the table to stable endpoint IDs", () => {
  const store = createSubsurfaceStore();
  store.setDataInteraction({
    datasetId: "test-dataset",
    brush: { datasetId: "test-dataset", startId: "sample-5", endId: "sample-9" },
    depthRange: [50, 90],
  });
  const html = renderToStaticMarkup(createElement(LinkedDatasetView, { dataset: dataset(20), store }));
  assert.match(html, /<tr[^>]*data-sample-id="sample-5"/);
  assert.match(html, /<tr[^>]*data-sample-id="sample-9"/);
  assert.doesNotMatch(html, /<tr[^>]*data-sample-id="sample-4"/);
  assert.doesNotMatch(html, /<tr[^>]*data-sample-id="sample-10"/);
  assert.match(html, /5 of 20 rows visible/);
});

test("linked dataset rejects an unknown value column and discloses empty plotted data", () => {
  const data = dataset(10);
  assert.throws(() => renderToStaticMarkup(createElement(LinkedDatasetView, { dataset: data, valueColumnId: "missing" })), /has no value column/);
  const empty = validateInteractionDataset({
    ...data,
    columns: [{ ...data.columns[0], values: new Float32Array(10).fill(Number.NaN), nullValue: "nan" }],
  });
  const html = renderToStaticMarkup(createElement(LinkedDatasetView, { dataset: empty }));
  assert.match(html, /role="alert"/);
  assert.match(html, /has no reported values to plot/);
});
