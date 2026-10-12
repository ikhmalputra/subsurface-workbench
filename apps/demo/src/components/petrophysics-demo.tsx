"use client";

import { useMemo, useState } from "react";
import {
  calculateArchieWaterSaturation,
  calculateSchlumbergerMN,
  calculatedSeriesToCurve,
  schlumbergerMNToCurves,
  validatePetrophysicsTrackTemplate,
  validatePetrophysicsWell,
} from "@ikhmalputra/subsurface-core/contracts";
import { createSubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import {
  PetrophysicsCrossplot,
  PetrophysicsCalculationReport,
  PetrophysicsFlattenView,
  PetrophysicsHistogram,
  PetrophysicsLogView,
  PetrophysicsTemplateSelect,
  PetrophysicsZoneSummaryView,
} from "@ikhmalputra/subsurface-react/2d";
import { useDepthLink, useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";

const trackTemplates = [
  validatePetrophysicsTrackTemplate({
    version: 1, id: "standard", name: "Standard interpretation tracks",
    tracks: [
      { curveId: "curve-gr", label: "Gamma ray", color: "#247c59", min: 0, max: 150, fill: "left", cutoff: { id: "gr-high", label: "Display cutoff", value: 75, side: "above", color: "#c44735" } },
      { curveId: "curve-nphi", label: "Neutron porosity", color: "#4878b5", min: 0, max: 0.4, fill: "left" },
      { curveId: "curve-rhob", label: "Bulk density", color: "#8d5aa7", min: 1.8, max: 2.8 },
      { curveId: "curve-sw-archie", label: "Archie Sw", color: "#d07b26", min: 0, max: 1.2 },
    ],
  }),
  validatePetrophysicsTrackTemplate({
    version: 1, id: "porosity", name: "Porosity comparison",
    tracks: [
      { curveId: "curve-nphi", label: "Neutron porosity", color: "#4878b5", min: 0, max: 0.4, fill: "left" },
      { curveId: "curve-rhob", label: "Bulk density", color: "#8d5aa7", min: 1.8, max: 2.8 },
    ],
  }),
] as const;

function makeSyntheticWell(wellId = "synthetic-petro-01", depthOffsetM = 0) {
  const depthsMdM = Float64Array.from({ length: 121 }, (_, index) => 1000 + depthOffsetM + index * 5);
  const gammaRay = Float32Array.from(depthsMdM, (md, index) => index >= 55 && index <= 59 ? -999.25 : 52 + 28 * Math.sin(index / 9) + (index > 70 ? 34 : 0));
  const porosity = Float32Array.from(depthsMdM, (_, index) => index >= 88 && index <= 91 ? -999.25 : 0.19 + 0.07 * Math.sin(index / 13) - (index > 72 && index < 92 ? 0.025 : 0));
  const density = Float32Array.from(depthsMdM, (_, index) => 2.55 - 0.34 * Math.sin(index / 13) + (index > 72 && index < 92 ? 0.12 : 0));
  const resistivity = Float32Array.from(depthsMdM, (_, index) => 2 ** (2 + 1.8 * Math.sin(index / 15)));
  const sonic = Float32Array.from(depthsMdM, (_, index) => 78 + 16 * Math.sin(index / 15));
  const reference = { kind: "MD" as const, unit: "m" as const, datum: "RKB" };
  return validatePetrophysicsWell({
    version: 1,
    wellId,
    depthReference: reference,
    provenance: "synthetic",
    curves: [
      { version: 1, id: `curve-gr-${wellId}`, wellId, mnemonic: "GR", name: "Gamma ray", unit: "API", depthReference: reference, depthsMdM, values: gammaRay, nullValue: -999.25 },
      { version: 1, id: `curve-nphi-${wellId}`, wellId, mnemonic: "NPHI", name: "Neutron porosity", unit: "v/v", depthReference: reference, depthsMdM, values: porosity, nullValue: -999.25 },
      { version: 1, id: `curve-rhob-${wellId}`, wellId, mnemonic: "RHOB", name: "Bulk density", unit: "g/cm3", depthReference: reference, depthsMdM, values: density, nullValue: null },
      { version: 1, id: `curve-rt-${wellId}`, wellId, mnemonic: "RT", name: "Deep resistivity", unit: "ohm.m", depthReference: reference, depthsMdM, values: resistivity, nullValue: null },
      { version: 1, id: `curve-dt-${wellId}`, wellId, mnemonic: "DT", name: "Sonic slowness", unit: "us/ft", depthReference: reference, depthsMdM, values: sonic, nullValue: null },
    ],
    zones: [
      { id: `zone-upper-${wellId}`, name: "Upper interval", topMdM: 1000 + depthOffsetM, baseMdM: 1350 + depthOffsetM, lithology: "host-labelled zone", color: "#88a9bd" },
      { id: `zone-lower-${wellId}`, name: "Lower interval", topMdM: 1350 + depthOffsetM, baseMdM: 1600 + depthOffsetM, lithology: "host-labelled zone", color: "#ceb67a" },
    ],
    tops: [
      { id: "top-upper", name: "Top upper interval", mdM: 1000 + depthOffsetM },
      { id: "top-lower", name: "Top lower interval", mdM: 1350 + depthOffsetM },
    ],
    corePoints: [
      { id: `core-01-${wellId}`, mdM: 1180 + depthOffsetM, label: "Synthetic core point A", description: "Illustrative marker only", measurements: [{ id: `porosity-a-${wellId}`, mnemonic: "POR", value: 0.21, unit: "v/v" }, { id: `permeability-a-${wellId}`, mnemonic: "PERM", value: 125, unit: "mD" }] },
      { id: `core-02-${wellId}`, mdM: 1475 + depthOffsetM, label: "Synthetic core point B", description: null, measurements: [{ id: `porosity-b-${wellId}`, mnemonic: "POR", value: null, unit: "v/v" }] },
    ],
  });
}

export function PetrophysicsDemo() {
  const well = useMemo(makeSyntheticWell, []);
  const comparisonWell = useMemo(() => makeSyntheticWell("synthetic-petro-02", 100), []);
  const [templateId, setTemplateId] = useState<string>(trackTemplates[0].id);
  const [store] = useState(() => {
    const next = createSubsurfaceStore();
    next.focusAsset(well.wellId);
    return next;
  });
  const link = useDepthLink(true, store);
  const wellId = useSubsurfaceSelector(store, (state) => state.activeAsset.wellId);
  const range = useSubsurfaceSelector(store, (state) => state.depthLink.window);
  const selectedTemplate = trackTemplates.find((template) => template.id === templateId) ?? trackTemplates[0];
  const tracks = selectedTemplate.tracks.map((track) => ({
    ...track,
    curveId: `${track.curveId}-${well.wellId}`,
  }));
  const curves = new Map(well.curves.map((curve) => [curve.mnemonic, curve]));
  const nphi = curves.get("NPHI")!;
  const density = curves.get("RHOB")!;
  const gamma = curves.get("GR")!;
  const resistivity = curves.get("RT")!;
  const sonic = curves.get("DT")!;
  const calculations = useMemo(() => {
    const archie = calculateArchieWaterSaturation(nphi, resistivity, {
      a: 1, m: 2, n: 2, rwAtFormationTemperatureOhmM: 0.1,
    });
    const mn = calculateSchlumbergerMN(nphi, density, sonic, {
      matrixDensityGPerCm3: 2.65,
      fluidDensityGPerCm3: 1,
      matrixSlownessUsPerFt: 55,
      fluidSlownessUsPerFt: 189,
    });
    return { archie, mn };
  }, [density, nphi, resistivity, sonic]);
  const derivedCurves = useMemo(() => ({
    archie: calculatedSeriesToCurve(calculations.archie, {
      id: `curve-sw-archie-${well.wellId}`,
      wellId: well.wellId,
      mnemonic: "SW_ARCHIE",
      name: "Archie water saturation",
      depthReference: well.depthReference,
    }),
    mn: schlumbergerMNToCurves(calculations.mn, {
      wellId: well.wellId,
      depthReference: well.depthReference,
      idPrefix: `curve-mn-${well.wellId}`,
    }),
  }), [calculations, well]);
  const calculationWell = useMemo(() => ({
    ...well,
    curves: [...well.curves, derivedCurves.archie, derivedCurves.mn.m, derivedCurves.mn.n],
  }), [derivedCurves, well]);
  return <div className="demo-petro-workspace">
    <p className="demo-correlation-status" role="status" data-testid="petrophysics-link-status">
      {wellId ? `Linked well: ${wellId}` : "Depth link is not focused"}{range ? ` · brushed ${range[0].toFixed(1)}–${range[1].toFixed(1)} m MD` : " · no depth range"}
      {link.cursorMdM !== null ? ` · cursor ${link.cursorMdM.toFixed(1)} m MD` : ""}
    </p>
    {/* Controls above the data belong in one strip, the same one the well workspace uses, rather
        than stacking as three loose rows that push the log down the page. */}
    <div className="demo-template-row">
      <PetrophysicsTemplateSelect templates={trackTemplates} value={templateId} onChange={setTemplateId} />
      <details className="sw-petro-template-json"><summary>View or copy this JSON track template</summary><pre tabIndex={0}>{JSON.stringify(selectedTemplate, null, 2)}</pre></details>
    </div>
    <PetrophysicsLogView
      well={calculationWell}
      tracks={tracks}
      cursorMdM={link.cursorMdM}
      selectedMdM={link.pinnedMdM}
      onCursorMdChange={link.setCursorMdM}
      onSelectMd={link.pinCursor}
      depthRangeMdM={range}
      onBrushChange={link.setWindow}
    />
    <div className="sw-petro-analysis-grid">
      <PetrophysicsCrossplot xCurve={nphi} yCurve={density} depthRangeMdM={range} onBrushChange={link.setWindow} onSelectMd={link.pinCursor} title="Neutron-density crossplot" />
      <PetrophysicsCrossplot xCurve={nphi} yCurve={derivedCurves.archie} depthRangeMdM={range} onBrushChange={link.setWindow} onSelectMd={link.pinCursor} title="Calculated Archie water saturation vs porosity" />
      <PetrophysicsCrossplot xCurve={derivedCurves.mn.m} yCurve={derivedCurves.mn.n} depthRangeMdM={range} onBrushChange={link.setWindow} onSelectMd={link.pinCursor} title="Calculated Schlumberger M-N coordinates" />
      <PetrophysicsHistogram curve={gamma} onBrushChange={link.setWindow} onSelectMd={link.pinCursor} />
    </div>
    <p className="sw-petro-notice" role="note">All curves and calculated outputs in this demo are synthetic examples. Archie Sw uses the explicitly listed parameters below; Rw is supplied as formation-temperature-corrected. M-N coordinates are calculated from the listed neutron, density and sonic inputs. These parameterized screening calculations are not certified interpretations and do not infer lithology or fluid type.</p>
    <PetrophysicsCalculationReport archie={calculations.archie} mn={calculations.mn} />
    <PetrophysicsZoneSummaryView well={well} rule={{ curveId: nphi.id, cutoff: 0.18, side: "above", maxSampleGapM: 10 }} />
    <PetrophysicsFlattenView wells={[well, comparisonWell]} markerId="top-lower" />
  </div>;
}
