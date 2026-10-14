import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { computeMinimumCurvature, forgeDesign, getWellComponents, wellComponentsToAssembly } from "@ikhmalputra/subsurface-core";
import { WellSection } from "../dist/well-section.js";

const components = getWellComponents(forgeDesign);
const assembly = wellComponentsToAssembly({ id: forgeDesign.id, name: "FORGE", totalDepthM: forgeDesign.totalDepthM, components });
const survey = computeMinimumCurvature(forgeDesign.survey.map(({ mdM, inclinationDeg, azimuthDeg }) => ({ mdM, inclinationDeg, azimuthDeg })), { tieIn: forgeDesign.survey[0] });

const link = (window = null) => ({
  linked: true, setLinked() {}, window, setWindow() {},
  cursorMdM: null, setCursorMdM() {}, pinnedMdM: null, pinCursor() {},
});
const render = (props) => renderToStaticMarkup(createElement(WellSection, {
  assembly, components, survey, stations: forgeDesign.survey, formations: forgeDesign.formations,
  totalDepthM: forgeDesign.totalDepthM, selectedId: null, onSelect() {}, onSelectMd() {},
  link: link(), assetBaseUrl: "/well-components", ...props,
}));

test("every track the well has data for sits on the one depth axis", () => {
  const html = render({});
  for (const head of ["MD", "Construction", "Survey"]) assert.match(html, new RegExp(`>${head}<`));
  assert.match(html, /sw-section-ruler/);
  assert.match(html, /sw-section-construction/);
  assert.match(html, /sw-section-survey/);
  // No log was supplied, so there is no log track at all — not an empty one.
  assert.doesNotMatch(html, /sw-section-log/);
});

test("the log track says what it is waiting for rather than drawing nothing", () => {
  const loading = render({ log: null, logState: { status: "loading" } });
  assert.match(loading, /sw-section-log/);
  assert.match(loading, /Loading mud log/);
  const failed = render({ log: null, logState: { status: "error", message: "404" } });
  assert.match(failed, /Mud log could not be loaded \(404\)/);
});

test("the visible depth window is published on the element, so a host can read it", () => {
  assert.match(render({}), new RegExp(`data-window="0,${Math.round(forgeDesign.totalDepthM)}"`));
  assert.match(renderToStaticMarkup(createElement(WellSection, {
    assembly, components, survey, totalDepthM: forgeDesign.totalDepthM, selectedId: null,
    onSelect() {}, onSelectMd() {}, link: link([500, 1500]), assetBaseUrl: "/x",
  })), /data-window="500,1500"/);
});

test("the ruler is readable rather than dense: a label about every 110px", () => {
  const labels = render({}).match(/sw-ruler-label/g) ?? [];
  assert.ok(labels.length >= 3 && labels.length <= 9, `expected a handful of depth labels, got ${labels.length}`);
});
