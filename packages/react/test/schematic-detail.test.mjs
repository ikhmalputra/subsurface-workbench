import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { forgeDesign, getWellComponents, wellComponentsToAssembly } from "@ikhmalputra/subsurface-core";
import { AssemblySchematic } from "../dist/assembly-schematic.js";
import { CurvedAssemblySchematic } from "../dist/curved-assembly-schematic.js";

const components = getWellComponents(forgeDesign);
const assembly = wellComponentsToAssembly({ id: forgeDesign.id, name: "FORGE", totalDepthM: forgeDesign.totalDepthM, components });

test("the schematic draws the recorded hole sections and quotes the records, unknowns included", () => {
  const html = renderToStaticMarkup(createElement(AssemblySchematic, { assembly, assetBaseUrl: "/well-components", records: components, survey: forgeDesign.survey, formationColumn: forgeDesign.formations }));
  for (const id of ["surface-hole", "intermediate-hole", "production-hole"]) assert.match(html, new RegExp(`data-hole-id="${id}"`));
  assert.match(html, /L80 · 68 lb\/ft · BTC · p\. 10/);
  assert.match(html, /Reported 1,629 ft · top not reported/);
  assert.match(html, /ID not reported/);
  assert.match(html, /In 8¾″ hole to 3,339 m · 51 m below shoe/);
  // The slurry line wraps at this width; both halves are quoted.
  assert.match(html, /RC ThermaLite-HT/);
  assert.match(html, /12\.97 ppg/);
  assert.match(html, /slurry not reported/);
  assert.match(html, /TD 3,339 m MD · 2,609 m TVD/);
  assert.match(html, /data-testid="formation-column"/);
  assert.match(html, /Crystalline granite reservoir/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("without records the schematic keeps its compact labels and draws no hole it was not given", () => {
  const html = renderToStaticMarkup(createElement(AssemblySchematic, { assembly, assetBaseUrl: "/well-components" }));
  assert.doesNotMatch(html, /data-hole-id=/);
  assert.doesNotMatch(html, /data-testid="formation-column"/);
  assert.match(html, /Shoe 497 m MD · Top 0 m/);
});

test("the curved construction labels every shoe in MD and TVD and states TD with its inclination", () => {
  const html = renderToStaticMarkup(createElement(CurvedAssemblySchematic, { assembly, assetBaseUrl: "/well-components", records: components, survey: forgeDesign.survey }));
  assert.match(html, /data-shoe-for="surface-casing"/);
  assert.match(html, /Shoe 3,288 m MD · 2,590 m TVD/);
  assert.match(html, /Reported 10,787 ft · T95/);
  assert.match(html, /TD 3,339 m MD · 2,609 m TVD · inc 68\.6°/);
  assert.match(html, /data-hole-id="production-hole"/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});
