import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { validateProductionSurveillanceDocument } from "../../core/dist/contracts.js";
import { sProfileDesign, getWellComponents } from "../../core/dist/index.js";
import { createSubsurfaceStore } from "../../core/dist/state.js";
import { wellComponentsToAssembly } from "../../core/dist/assembly.js";
import { ProductionSurveillanceView } from "../dist/production-surveillance.js";

const start = Date.UTC(2025, 0, 1);

function makeDocument() {
  return validateProductionSurveillanceDocument({
    version: 1,
    id: "synthetic-well-production",
    wellId: "synthetic-well",
    wellLabel: "Synthetic Well",
    provenance: "synthetic",
    source: "Synthetic fixture",
    dataset: {
      version: 1,
      id: "synthetic-production-data",
      assetId: "asset:synthetic-well",
      wellId: "synthetic-well",
      key: { kind: "time", unit: "unix-ms", timeZone: "UTC" },
      sampleIds: ["day-1", "day-2", "day-3"],
      keyValues: new Float64Array([start, start + 86_400_000, start + 172_800_000]),
      columns: [{ id: "oil", label: "Oil rate", unit: "m3/d", values: new Float32Array([4, Number.NaN, 5]), nullValue: "nan" }],
      reference: null,
      spatialXYZ: null,
    },
    events: [
      { id: "event-1", kind: "production-test", startTimeMs: start, endTimeMs: start + 1000, mdM: 1200, componentId: null, summary: "Production test", source: null },
      { id: "event-2", kind: "shut-in", startTimeMs: start + 172_800_000, endTimeMs: null, mdM: null, componentId: null, summary: "Shut-in", source: "Daily report" },
    ],
  });
}

test("production view shows provenance, measurement units, event dates, nulls and missing construction data", () => {
  const html = renderToStaticMarkup(createElement(ProductionSurveillanceView, { document: makeDocument() }));
  assert.match(html, /Synthetic example — not reported well performance/);
  assert.match(html, /Oil rate \(m3\/d\)/);
  assert.match(html, /Jan 1, 2025/);
  assert.match(html, /Depth not reported/);
  assert.match(html, /Source: not reported/);
  assert.match(html, /Construction schematic not supplied/);
  assert.match(html, /not reported/);
});

test("production view filters its events from shared UTC time-range state", () => {
  const document = makeDocument();
  const store = createSubsurfaceStore();
  store.setDataInteraction({
    datasetId: document.dataset.id,
    timeRange: [start, start + 10_000],
  });
  const html = renderToStaticMarkup(createElement(ProductionSurveillanceView, { document, store }));
  assert.match(html, /Production test/);
  assert.doesNotMatch(html, />Shut-in</);
  assert.match(html, /Clear time filter/);
});

test("production view accepts and renders the shared well assembly schematic", () => {
  const components = getWellComponents(sProfileDesign);
  const assembly = wellComponentsToAssembly({
    id: sProfileDesign.id,
    name: sProfileDesign.wellName ?? sProfileDesign.id,
    totalDepthM: sProfileDesign.totalDepthM,
    components,
  });
  const original = makeDocument();
  const document = validateProductionSurveillanceDocument({
    ...original,
    wellId: sProfileDesign.id,
    dataset: { ...original.dataset, wellId: sProfileDesign.id },
  });
  const html = renderToStaticMarkup(createElement(ProductionSurveillanceView, {
    document,
    assembly,
    assetBaseUrl: "/well-components",
  }));
  assert.match(html, /Well construction context/);
  assert.match(html, /Well construction schematic/);
  assert.doesNotMatch(html, /Construction schematic not supplied/);
  assert.throws(() => renderToStaticMarkup(createElement(ProductionSurveillanceView, {
    document: makeDocument(),
    assembly,
    assetBaseUrl: "/well-components",
  })), /does not belong to well/);
  assert.throws(() => renderToStaticMarkup(createElement(ProductionSurveillanceView, {
    document,
    assembly,
  })), /assetBaseUrl is required/);
});
