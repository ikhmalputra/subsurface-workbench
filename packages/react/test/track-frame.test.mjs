import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { computeMinimumCurvature, forgeDesign, getWellComponents, parseLas, wellComponentsToAssembly } from "../../core/dist/index.js";
import { AssemblySchematic } from "../dist/assembly-schematic.js";
import { LogTracks } from "../dist/records.js";
import { TrajectoryLog } from "../dist/trajectory.js";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

/**
 * The track contract: given the same `frame` and the same window, three different components put
 * the same depth at the same pixel. This is what lets a container lay them side by side on one
 * ruler. Each is checked at the midpoint of a window, where any drift in inset or domain shows.
 */
const frame = { top: 96, bottom: 28, chromeless: true };
const height = 500;
const midpoint = frame.top + (height - frame.bottom - frame.top) / 2; // 284

// The patterns allow either attribute order, so the value may land in either capture group.
const attr = (html, pattern) => { const match = html.match(pattern); assert.ok(match, `expected ${pattern}`); return Number(match[1] ?? match[2]); };

test("a framed log maps the shared window into the shared inset, even beyond its own samples", () => {
  const las = parseLas(readFileSync(new URL("../../../apps/demo/public/data/forge-16a-mudlog-10ft.las", import.meta.url), "utf8"));
  // The window starts at 0 ft although the log's first sample is 130 ft: unframed, the log clamps to
  // its own extent and its mapping shifts by 130 ft against every track beside it.
  const html = renderToStaticMarkup(createElement(LogTracks, {
    las, tracks: [{ mnemonic: "ROP", label: "ROP" }], height, frame,
    depthWindowFt: [0, 1000], cursorFt: 500,
  }));
  assert.equal(attr(html, /class="sw-logs-cursor"[^>]*y1="([\d.]+)"|y1="([\d.]+)"[^>]*class="sw-logs-cursor"/), midpoint);
  assert.doesNotMatch(html, /sw-rec-head/, "chromeless: no header of its own");
  assert.match(html, /data-track="true"/);
});

test("a framed survey log follows the shared window as its domain, not only as a band", () => {
  const survey = computeMinimumCurvature(forgeDesign.survey, { tieIn: forgeDesign.survey[0] });
  const html = renderToStaticMarkup(createElement(TrajectoryLog, {
    survey, height, frame, domainMdM: [0, 1000], cursorMdM: 500,
  }));
  const cursor = html.match(/data-testid="traj-cursor"[\s\S]*?<line[^>]*y1="([\d.]+)"/);
  assert.ok(cursor, "the cursor is drawn");
  assert.equal(Number(cursor[1]), midpoint);
  assert.doesNotMatch(html, /<figcaption/, "chromeless: no caption of its own");
});

test("a framed schematic takes the dictated inset instead of growing for its annotations", () => {
  const components = getWellComponents(forgeDesign);
  const assembly = wellComponentsToAssembly({ id: forgeDesign.id, name: forgeDesign.wellName ?? forgeDesign.id, totalDepthM: forgeDesign.totalDepthM, components });
  const html = renderToStaticMarkup(createElement(AssemblySchematic, {
    assembly, assetBaseUrl: "/well-components", frame, depthWindow: [0, assembly.totalDepthM],
  }));
  // Server-side the box is the default 940px tall; the TD line must sit exactly `bottom` above it,
  // where an unframed schematic would have put it 32px up and grown the box for its labels.
  assert.equal(attr(html, /class="sw-asm-td-line"[^>]*y1="([\d.]+)"|y1="([\d.]+)"[^>]*class="sw-asm-td-line"/), 940 - frame.bottom);
  assert.doesNotMatch(html, /sw-asm-panel-head/, "chromeless: no panel header");
  assert.doesNotMatch(html, /sw-asm-scale-note/, "chromeless: no footer note either, it was stealing 55px of the shared height");
  assert.doesNotMatch(html, /MD \(m\)/, "the container owns the depth axis");
});
