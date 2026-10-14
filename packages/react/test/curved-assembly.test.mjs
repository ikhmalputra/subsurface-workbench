import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createAssembly, placeComponent } from "../../core/dist/index.js";
import { CurvedAssemblySchematic } from "../dist/curved-assembly-schematic.js";

const blank = createAssembly({ id: "curved-test", name: "Survey test", totalDepthM: 1000 });
const assembly = placeComponent(blank, "surface-casing", 800).assembly;
const station = (mdM, eastingM = 0, tvdM = mdM) => ({
  mdM, eastingM, tvdM, northingM: 0, inclinationDeg: 0, azimuthDeg: 0,
});
const render = (survey) => renderToStaticMarkup(createElement(CurvedAssemblySchematic, { assembly, survey }));

test("no survey explicitly renders vertical construction with valid SVG titles", () => {
  const html = render();
  assert.match(html, /Vertical well \(no directional survey\)/);
  assert.match(html, /data-item-id="surface-casing-1"/);
  assert.match(html, /<title>Surface casing · 800 m MD<\/title>/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("short survey clips the construction path without changing the source interval", () => {
  const html = render([station(0), station(400, 200, 300)]);
  assert.match(html, /Survey coverage 0 m–400 m/);
  assert.match(html, /aria-label="Surface casing, .*0 m to 800 m"/);
  assert.doesNotMatch(html, /NaN|Infinity/);
  const path = html.match(/d="([^"]+)" class="sw-curved-centerline"/)?.[1];
  assert.ok(path);
  const coordinates = [...path.matchAll(/[ML]([\d.-]+),([\d.-]+)/g)].map((match) => [Number(match[1]), Number(match[2])]);
  assert.ok(coordinates.at(-1)[0] > coordinates[0][0], "Supplied departure must curve the construction");
  // The path reaches the plot's bottom edge: 570 px tall, less the 80 px that hold the departure axis.
  assert.equal(Math.max(...coordinates.map((point) => point[1])), 490);
});

test("survey outside assembly coverage does not fabricate a path or selectable parts", () => {
  const html = render([station(1200), station(1500)]);
  assert.match(html, /No survey coverage within the assembly depth/);
  assert.doesNotMatch(html, /class="sw-curved-centerline"|data-item-id=|NaN|Infinity/);
});

test("a single survey station remains finite and reports its exact coverage", () => {
  const html = render([station(400)]);
  assert.match(html, /Survey coverage 400 m–400 m/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("departure and TVD preserve equal physical scales rather than stretching the survey", () => {
  const survey = [station(0), station(1000, 100, 900)];
  const original = survey.map((point) => ({ ...point }));
  const html = render(survey);
  const path = html.match(/d="([^"]+)" class="sw-curved-centerline"/)?.[1];
  assert.ok(path);
  const points = [...path.matchAll(/[ML]([\d.-]+),([\d.-]+)/g)].map((match) => [Number(match[1]), Number(match[2])]);
  const first = points[0], last = points.at(-1);
  assert.ok(Math.abs((last[0] - first[0]) / (last[1] - first[1]) - 100 / 900) < 0.001);
  assert.deepEqual(survey, original);
});
