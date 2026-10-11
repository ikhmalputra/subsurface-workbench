import assert from "node:assert/strict";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasLayer, CanvasStack, LayerManager } from "../dist/index.js";

const layers = [
  { id: "casing", label: "Casing & liners", visible: true, provenance: "documented", count: 3, toggleable: false, toggleHint: "Not separable yet." },
  { id: "formations", label: "Formations", visible: true, provenance: "synthetic", count: 2 },
  { id: "survey", label: "Survey path", visible: true, provenance: "documented", count: null },
];

test("layer rows carry their own provenance rather than the well's", () => {
  const html = renderToStaticMarkup(h(LayerManager, { layers, onToggleVisible: () => {} }));
  assert.match(html, /data-layer-id="casing"[\s\S]*?data-provenance="documented"/);
  assert.match(html, /data-layer-id="formations"[\s\S]*?data-provenance="synthetic"/);
  // Sourced construction and conceptual strata must not share a badge.
  assert.notEqual(html.indexOf('data-provenance="documented"'), html.indexOf('data-provenance="synthetic"'));
});

test("a layer the renderer cannot hide offers a disabled control with a reason, not a dead toggle", () => {
  const html = renderToStaticMarkup(h(LayerManager, { layers, onToggleVisible: () => {} }));
  const casingRow = html.slice(html.indexOf('data-layer-id="casing"'), html.indexOf('data-layer-id="formations"'));
  assert.match(casingRow, /disabled=""/);
  assert.match(casingRow, /Not separable yet\./);

  const formationRow = html.slice(html.indexOf('data-layer-id="formations"'), html.indexOf('data-layer-id="survey"'));
  assert.doesNotMatch(formationRow, /disabled=""/);
});

test("an unreported count renders as not reported rather than zero", () => {
  const html = renderToStaticMarkup(h(LayerManager, { layers, onToggleVisible: () => {} }));
  const surveyRow = html.slice(html.indexOf('data-layer-id="survey"'));
  assert.match(surveyRow, /not reported/);
  assert.doesNotMatch(surveyRow, /0 items/);
});

test("visibility state is exposed on the row, and hidden layers stay operable", () => {
  const hidden = layers.map((layer) => (layer.id === "formations" ? { ...layer, visible: false } : layer));
  const html = renderToStaticMarkup(h(LayerManager, { layers: hidden, onToggleVisible: () => {} }));
  assert.match(html, /data-layer-id="formations"[^>]*data-visible="false"/);
  assert.match(html, /Show Formations/);
});

test("every canvas mode stays mounted and only the active one is shown", () => {
  const html = renderToStaticMarkup(h(CanvasStack, { active: "curved" },
    h(CanvasLayer, { id: "curved" }, "CURVED"),
    h(CanvasLayer, { id: "schematic" }, "SCHEMATIC"),
    h(CanvasLayer, { id: "cutaway" }, "CUTAWAY")));

  // All three are present: switching modes must not discard a view's state.
  for (const id of ["curved", "schematic", "cutaway"]) assert.match(html, new RegExp(`data-layer="${id}"`));
  for (const body of ["CURVED", "SCHEMATIC", "CUTAWAY"]) assert.match(html, new RegExp(body));

  assert.match(html, /data-layer="curved" data-active="true"/);
  assert.match(html, /data-layer="schematic"[^>]*hidden=""/);
  assert.match(html, /data-layer="cutaway"[^>]*hidden=""/);
  assert.doesNotMatch(html, /data-layer="curved"[^>]*hidden=""/);
});

test("a canvas layer outside a stack fails loudly instead of rendering nowhere", () => {
  assert.throws(() => renderToStaticMarkup(h(CanvasLayer, { id: "orphan" }, "x")), /CanvasStack/);
});
