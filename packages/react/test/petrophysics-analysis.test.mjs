import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PetrophysicsCrossplot,
  PetrophysicsCalculationReport,
  PetrophysicsFlattenView,
  PetrophysicsHistogram,
  PetrophysicsTemplateSelect,
  PetrophysicsLogView,
  PetrophysicsZoneSummaryView,
} from "../dist/2d.js";
import {
  calculateArchieWaterSaturation,
  calculateSchlumbergerMN,
  validatePetrophysicsWell,
} from "../../core/dist/contracts.js";

const reference = { kind: "MD", unit: "m", datum: "RKB" };
function createWell(wellId, depthShift = 0) {
  const depthsMdM = Float64Array.from([0, 2, 4, 20, 22], (depth) => depth + depthShift);
  const curve = (id, mnemonic, unit, values, nullValue = null) => ({
    version: 1, id: `${id}-${wellId}`, wellId, mnemonic, name: mnemonic, unit,
    depthReference: reference, depthsMdM, values: Float32Array.from(values), nullValue,
  });
  return validatePetrophysicsWell({
    version: 1, wellId, depthReference: reference, provenance: "documented",
    curves: [
      curve("phi", "PHI", "v/v", [0.1, 0.2, 0.8, 0.9, 0.9]),
      curve("density", "RHOB", "g/cm3", [2.6, 2.5, 2.3, 2.2, 2.1]),
      curve("gr", "GR", "API", [10, -999.25, 80, 90, 100], -999.25),
    ],
    zones: [{ id: `zone-${wellId}`, name: "Sand", topMdM: depthShift, baseMdM: depthShift + 22, lithology: "host supplied", color: "#d9c28f" }],
    tops: [{ id: "top-marker", name: "Marker", mdM: depthShift + 4 }],
    corePoints: [{
      id: `core-${wellId}`, mdM: depthShift + 2, label: "Plug", description: null,
      measurements: [{ id: "porosity", mnemonic: "POR", value: 0.22, unit: "v/v" }, { id: "permeability", mnemonic: "PERM", value: null, unit: "mD" }],
    }],
  });
}

const first = createWell("well-a");
const second = createWell("well-b", 10);
const nphi = first.curves[0];
const density = first.curves[1];
const resistivity = { ...nphi, id: "rt-well-a", mnemonic: "RT", name: "Deep resistivity", unit: "ohm.m", values: Float32Array.from([0.1, 5, 1, 10, 10]), nullValue: null };
const sonic = { ...nphi, id: "dt-well-a", mnemonic: "DT", name: "Sonic slowness", unit: "us/ft", values: Float32Array.from([80, 85, 90, 95, 100]), nullValue: null };
const archie = calculateArchieWaterSaturation(nphi, resistivity, { a: 1, m: 2, n: 2, rwAtFormationTemperatureOhmM: 0.1 });
const mn = calculateSchlumbergerMN(nphi, density, sonic, {
  matrixDensityGPerCm3: 2.65, fluidDensityGPerCm3: 1,
  matrixSlownessUsPerFt: 55, fluidSlownessUsPerFt: 189,
});

test("Petrophysics crossplot renders exact-MD data table, units, and keyboard selection instructions", () => {
  const html = renderToStaticMarkup(createElement(PetrophysicsCrossplot, {
    xCurve: first.curves[0], yCurve: first.curves[1], onSelectMd: () => {}, onBrushChange: () => {},
  }));
  assert.match(html, /Exact-MD sample pairs only/);
  assert.match(html, /PHI \(v\/v\)/);
  assert.match(html, /RHOB \(g\/cm3\)/);
  assert.match(html, /arrow keys browse, Enter selects one sample/);
  assert.match(html, /paired samples/);
  assert.equal((html.match(/<circle/g) ?? []).length, 5);
});

test("Petrophysics histogram renders accessible bin controls and reports null-free bins", () => {
  const html = renderToStaticMarkup(createElement(PetrophysicsHistogram, {
    curve: first.curves[2], binCount: 2, onBrushChange: () => {}, onSelectMd: () => {},
  }));
  assert.match(html, /GR histogram in API/);
  assert.match(html, /role="button"/);
  assert.match(html, /Click a bin to link the depth interval/);
  assert.match(html, /10–55/);
  assert.match(html, /View .*paired|GR histogram/);
});

test("Petrophysics zone summary renders formulas, explicit cutoff and sampled measurements", () => {
  const html = renderToStaticMarkup(createElement(PetrophysicsZoneSummaryView, {
    well: first,
    rule: { curveId: first.curves[0].id, cutoff: 0.5, side: "above", maxSampleGapM: 3 },
  }));
  assert.match(html, /Mean = sum\(reported samples/);
  assert.match(html, /no farther apart than 3 m/);
  assert.match(html, /above 0.5 v\/v/);
  assert.match(html, /Gross sampled/);
  assert.match(html, /Net \/ gross/);
  assert.match(html, /4 \/ 4/);
});

test("Petrophysics calculation report exposes formulas, units, parameters and per-sample results", () => {
  const html = renderToStaticMarkup(createElement(PetrophysicsCalculationReport, { archie, mn }));
  assert.match(html, /Sw = \(a \* Rw \/ \(Rt \* phi\^m\)\)\^\(1\/n\)/);
  assert.match(html, /M = 0\.01 \* \(DTf - DT\) \/ \(rhob - rhof\)/);
  assert.match(html, /formation-temperature-corrected Rw|caller must temperature-correct Rw/i);
  assert.match(html, /0\.1 ohm\.m/);
  assert.match(html, /exact MD keys/);
  assert.match(html, /Archie water saturation calculation/);
  assert.match(html, /Schlumberger M-N calculation/);
  assert.match(html, /out-of-range/);
});

test("Petrophysics flatten view shows explicit tie depths and relative-MD data", () => {
  const html = renderToStaticMarkup(createElement(PetrophysicsFlattenView, { wells: [first, second], markerId: "top-marker" }));
  assert.match(html, /relative MD 0 m/);
  assert.match(html, /Source marker ties/);
  assert.match(html, /well-a/);
  assert.match(html, /well-b/);
});

test("Petrophysics template selector and log view render core values and explicit unknowns", () => {
  const template = { id: "basic", name: "Basic", tracks: [{ curveId: first.curves[0].id, color: "#247c59", min: 0, max: 1 }] };
  const selectHtml = renderToStaticMarkup(createElement(PetrophysicsTemplateSelect, { templates: [template], value: "basic", onChange: () => {} }));
  assert.match(selectHtml, /Track template/);
  assert.match(selectHtml, /Basic/);
  const logHtml = renderToStaticMarkup(createElement(PetrophysicsLogView, {
    well: first, tracks: template.tracks,
  }));
  assert.match(logHtml, /data-testid="petrophysics-core-measurements"/);
  assert.match(logHtml, /0.22/);
  assert.match(logHtml, /not reported/);
  assert.match(logHtml, /View well-a petrophysics samples as a table/);
});
