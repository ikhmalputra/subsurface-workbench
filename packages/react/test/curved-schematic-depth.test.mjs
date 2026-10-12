import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { forgeDesign, getWellComponents, metresToFeet } from "../../core/dist/index.js";
import { CurvedSchematic } from "../dist/curved-schematic.js";

const components = getWellComponents(forgeDesign);
const render = (design, props = {}) => renderToStaticMarkup(createElement(CurvedSchematic, {
  design, components, selectedId: components[0].id, onSelect() {}, ...props,
}));

test("the depth unit comes from the source, not from who last edited the well", () => {
  // The unit used to be `provenance === "documented"`. Editing FORGE sets provenance to
  // "user-authored", which switched this drawing to metres while the interval base kept quoting
  // `rawBottomDepthFt` — so one component read "8.5 m MD to 1,629 ft report MD": two units 3.28x
  // apart in one sentence, from an edit that changed no depth.
  const quoted = (html) => [...html.matchAll(/([\d,.]+) (ft report MD|m MD|m planned MD)/g)].map((match) => match[2]);
  const documented = quoted(render(forgeDesign));
  const edited = quoted(render({ ...forgeDesign, provenance: "user-authored" }));
  assert.ok(documented.length > 0, "the selected component states its source depths");
  assert.deepEqual(edited, documented);
  assert.deepEqual(new Set(documented), new Set(["ft report MD"]));

  // A well with no reported feet depth is quoted in metres, which is what its source states.
  const planned = { ...forgeDesign, reportedTotalDepthFt: undefined, surveyCoverageFt: undefined, provenance: "synthetic" };
  assert.match(render(planned, { mode: "construction" }), /MD \/ m/);
});

test("the geology track is placed by TVD in metres, over the whole wellbore", () => {
  // A feet factor was applied to `topTvdM`, which is already metres, scaling FORGE's layers to
  // 0.3048 of their depth: the granite reservoir was drawn in the top quarter of a well it fills
  // the bottom half of. Invisible on the synthetic wells, where the factor was 1.
  const html = render(forgeDesign, { layersVisible: true, mode: "construction" });
  const bands = [...html.matchAll(/<rect [^>]*y="([\d.]+)" width="26" height="([\d.]+)"[^>]*opacity="0\.78"[^>]*><title>([^<]*)</g)]
    .map(([, y, height, title]) => ({ top: Number(y), bottom: Number(y) + Number(height), title }));
  assert.equal(bands.length, forgeDesign.formations.length);

  // The track occupies y 104–698. The two layers are contiguous and must span nearly all of it.
  const reservoir = bands.find((band) => band.title.includes("granite"));
  assert.ok(reservoir, "the reservoir layer is drawn");
  assert.ok(reservoir.bottom > 690, `reservoir base should reach the survey end, drawn at ${reservoir.bottom}`);
  assert.ok(reservoir.top > 300 && reservoir.top < 400, `reservoir top should sit mid-well, drawn at ${reservoir.top}`);
  assert.equal(bands[0].top < reservoir.top, true, "the overburden is above the reservoir");
  assert.ok(Math.abs(bands[0].bottom - reservoir.top) < 1, "the layers are contiguous, as their TVDs are");

  // And the depths are the surveyed MDs of those TVDs, not a scaled fraction of them.
  const station = forgeDesign.survey.find((point) => point.tvdM >= forgeDesign.formations[1].topTvdM);
  const expectedFt = metresToFeet(station.mdM);
  assert.ok(expectedFt > 4000 && expectedFt < 5500, `contact MD is ~4,700 ft, computed ${expectedFt}`);
});
