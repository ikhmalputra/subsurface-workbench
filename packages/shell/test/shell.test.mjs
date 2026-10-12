import assert from "node:assert/strict";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasLayer, CanvasStack, LayerManager, Pane, PaneGrid } from "../dist/index.js";

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

test("a stack can show several panes at once, so facets are not alternatives", () => {
  const html = renderToStaticMarkup(h(CanvasStack, { active: ["schematic", "seismic"] },
    h(CanvasLayer, { id: "schematic" }, "SCHEMATIC"),
    h(CanvasLayer, { id: "seismic" }, "SEISMIC"),
    h(CanvasLayer, { id: "cutaway" }, "CUTAWAY")));

  assert.match(html, /data-layer="schematic" data-active="true"/);
  assert.match(html, /data-layer="seismic" data-active="true"/);
  assert.match(html, /data-layer="cutaway"[^>]*hidden=""/);
  assert.match(html, /data-layer-count="2"/);
});

test("an expensive pane waits for its first showing, and is kept once mounted", () => {
  // Rendered while hidden: the cost of a lazily imported renderer or a volume fetch is not paid
  // for a pane nobody has opened.
  const hidden = renderToStaticMarkup(h(CanvasStack, { active: "schematic" },
    h(CanvasLayer, { id: "schematic" }, "SCHEMATIC"),
    h(CanvasLayer, { id: "earth", deferUntilShown: true }, "EARTH")));
  assert.match(hidden, /data-layer="earth"/);
  assert.doesNotMatch(hidden, /EARTH/);
  assert.doesNotMatch(hidden, /data-layer="earth"[^>]*data-mounted/);

  // Shown: it mounts. A pane without the flag renders either way, which is what a cheap 2D view
  // should do — it is instantly available on the first switch to it.
  const shown = renderToStaticMarkup(h(CanvasStack, { active: ["schematic", "earth"] },
    h(CanvasLayer, { id: "schematic" }, "SCHEMATIC"),
    h(CanvasLayer, { id: "earth", deferUntilShown: true }, "EARTH")));
  assert.match(shown, /EARTH/);
  assert.match(shown, /data-layer="earth"[^>]*data-mounted="true"/);
});

test("a pane grid keeps the host's layout and the group's keep-alive semantics", () => {
  const html = renderToStaticMarkup(h(PaneGrid, { active: ["schematic", "seismic"], className: "demo-view-grid demo-view-seismic" },
    h(Pane, { id: "schematic", className: "demo-fill" }, "SCHEMATIC"),
    h(Pane, { id: "seismic", className: "demo-fill demo-seismic-view" }, "SEISMIC"),
    h(Pane, { id: "earth", className: "demo-fill", deferUntilShown: true }, "EARTH"),
    h("aside", { className: "demo-side" }, "INSPECTOR")));

  // The host's classes survive, so an application's existing geometry keeps working.
  assert.match(html, /class="demo-view-grid demo-view-seismic" data-active-panes="schematic seismic"/);
  assert.match(html, /class="demo-fill demo-seismic-view" data-pane="seismic" data-active="true"/);
  // A pane that is not shown is hidden rather than discarded, and an expensive one is not mounted.
  assert.doesNotMatch(html, /EARTH/);
  // Children that are not panes pass through untouched.
  assert.match(html, /<aside class="demo-side">INSPECTOR<\/aside>/);
});

test("a pane outside a grid names the wrapper it needs", () => {
  assert.throws(() => renderToStaticMarkup(h(Pane, { id: "orphan" }, "x")), /<Pane> must be rendered inside <PaneGrid>/);
});
