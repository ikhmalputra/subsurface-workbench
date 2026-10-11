import type { Metadata } from "next";
import { DemoHeader, DemoPage } from "../../components/showcase";
import { PetrophysicsDemo } from "../../components/petrophysics-demo";

export const metadata: Metadata = { title: "Petrophysics · Subsurface SDK" };

const code = `
import { calculateArchieWaterSaturation, calculateSchlumbergerMN, calculatedSeriesToCurve, schlumbergerMNToCurves, validatePetrophysicsWell, validatePetrophysicsTrackTemplate } from "@ikhmalputra/subsurface-core/contracts";
import { PetrophysicsCalculationReport, PetrophysicsCrossplot, PetrophysicsHistogram, PetrophysicsLogView, PetrophysicsZoneSummaryView } from "@ikhmalputra/subsurface-react/2d";

const well = validatePetrophysicsWell(hostPetrophysicsColumns);
const template = validatePetrophysicsTrackTemplate(hostTrackTemplateJson);
const sw = calculateArchieWaterSaturation(porosity, trueResistivity, {
  a: 1, m: 2, n: 2, rwAtFormationTemperatureOhmM: 0.1,
});
const mn = calculateSchlumbergerMN(neutron, bulkDensity, sonicSlowness, {
  matrixDensityGPerCm3: 2.65, fluidDensityGPerCm3: 1,
  matrixSlownessUsPerFt: 55, fluidSlownessUsPerFt: 189,
});
const swCurve = calculatedSeriesToCurve(sw, derivedCurveMetadata);
const { m, n } = schlumbergerMNToCurves(mn, curveMetadata);
<PetrophysicsCalculationReport archie={sw} mn={mn} />;
<PetrophysicsLogView
  well={well}
  tracks={template.tracks}
  cursorMdM={depthLink.cursorMdM}
  onCursorMdChange={depthLink.setCursorMdM}
  depthRangeMdM={depthLink.window}
  onBrushChange={depthLink.setWindow}
/>;
<PetrophysicsCrossplot xCurve={nphi} yCurve={density} onBrushChange={depthLink.setWindow} />;
<PetrophysicsHistogram curve={gammaRay} onBrushChange={depthLink.setWindow} />;
<PetrophysicsZoneSummaryView well={well} rule={{ curveId: "nphi", cutoff: 0.18, side: "above", maxSampleGapM: 10 }} />;
`;

export default function PetrophysicsPage() {
  return <DemoPage current="/petrophysics/">
    <DemoHeader
      eyebrow="Domain pack · petrophysics"
      title="Petrophysics"
      lede="Inspect host-supplied typed log curves against explicit measured depth, datum and units. Crossplots, histograms, formula-visible zone summaries, core measurements, JSON track templates and marker-flattened wells link through the shared depth range."
      points={[
        "Curves are strict, columnar contracts with mnemonics, units, stable IDs, aligned MD columns and explicit missing-value sentinels.",
        "Track domains and cutoff rules are supplied by the host; cutoffs are display rules, not hidden interpretation.",
        "Archie water saturation and Schlumberger M-N coordinates are calculated from explicit unit-checked input curves and caller-supplied parameters; outputs retain missing, invalid and out-of-range quality at exact matching MD keys.",
        "The demo labels source curves and calculated outputs synthetic; formulas, input IDs, units, parameters, per-sample quality and reasons are visible beside the linked plots. These are screening calculations, not certified interpretations.",
        "Zone mean and sampled net-to-gross formulas show their cutoff, inputs and maximum accepted sample gap; gaps are not bridged.",
        "Track templates are JSON display configuration; the host owns template persistence. Core measurements and tops are supplied, not inferred.",
        "The demo includes two explicitly synthetic wells with an explicit matching marker tie; the SDK does not infer picks or geology.",
      ]}
      uses={["PetrophysicsWell", "validatePetrophysicsWell", "calculateArchieWaterSaturation", "calculateSchlumbergerMN", "calculatedSeriesToCurve", "schlumbergerMNToCurves", "validatePetrophysicsTrackTemplate", "pairPetrophysicsCurves", "summarizePetrophysicsZones", "PetrophysicsCalculationReport", "PetrophysicsLogView", "PetrophysicsCrossplot", "PetrophysicsHistogram", "PetrophysicsFlattenView", "useDepthLink"]}
      code={code}
    />
    <PetrophysicsDemo />
  </DemoPage>;
}
