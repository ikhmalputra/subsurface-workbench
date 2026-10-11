"use client";

import { useMemo } from "react";
import { getWellComponents, sProfileDesign } from "@ikhmalputra/subsurface-core";
import type { ProductionSurveillanceDocument } from "@ikhmalputra/subsurface-core/contracts";
import { createSubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import { wellComponentsToAssembly } from "@ikhmalputra/subsurface-core/assembly";
import { ProductionSurveillanceView } from "@ikhmalputra/subsurface-react/production";

function makeDocument(): ProductionSurveillanceDocument {
  const start = Date.UTC(2025, 0, 1);
  const day = 86_400_000;
  const rates = [
    [18.2, 2.1, 1250], [18.8, 2.2, 1290], [19.1, 2.4, 1310], [null, null, null],
    [18.6, 2.5, 1270], [17.9, 2.8, 1210], [17.4, 3.1, 1190], [17.8, 3.0, 1205],
    [18.1, 2.9, 1235], [18.5, 2.8, 1260], [18.9, 2.7, 1300], [19.2, 2.6, 1330],
    [18.7, 2.5, 1295], [18.3, 2.4, 1275],
  ] as const;
  return {
    version: 1,
    id: "synthetic-s-profile-production",
    wellId: sProfileDesign.id,
    wellLabel: "S-profile completion · synthetic",
    provenance: "synthetic",
    source: "Generated demonstration fixture; not measured production history",
    dataset: {
      version: 1,
      id: "synthetic-s-profile-production-observations",
      assetId: `asset:${sProfileDesign.id}`,
      wellId: sProfileDesign.id,
      key: { kind: "time", unit: "unix-ms", timeZone: "UTC" },
      sampleIds: rates.map((_, index) => `synthetic-daily-observation-${index + 1}`),
      keyValues: Float64Array.from(rates.map((_, index) => start + index * day)),
      columns: [
        { id: "oil-rate", label: "Oil rate", unit: "m3/d", values: Float32Array.from(rates.map((row) => row[0] ?? Number.NaN)), nullValue: "nan" },
        { id: "water-rate", label: "Water rate", unit: "m3/d", values: Float32Array.from(rates.map((row) => row[1] ?? Number.NaN)), nullValue: "nan" },
        { id: "gas-rate", label: "Gas rate", unit: "m3/d", values: Float32Array.from(rates.map((row) => row[2] ?? Number.NaN)), nullValue: "nan" },
      ],
      reference: null,
      spatialXYZ: null,
    },
    events: [
      { id: "synthetic-production-start", kind: "production", startTimeMs: start, endTimeMs: null, mdM: 1730, componentId: null, summary: "Production observations begin", source: "Synthetic demonstration fixture" },
      { id: "synthetic-test", kind: "production-test", startTimeMs: start + 4 * day, endTimeMs: start + 5 * day, mdM: 1840, componentId: null, summary: "Production test", source: "Synthetic demonstration fixture" },
      { id: "synthetic-shutin", kind: "shut-in", startTimeMs: start + 8 * day, endTimeMs: start + 9 * day, mdM: null, componentId: null, summary: "Well shut in for surveillance", source: "Synthetic demonstration fixture" },
      { id: "synthetic-survey", kind: "surveillance", startTimeMs: start + 12 * day, endTimeMs: null, mdM: 1765, componentId: null, summary: "Downhole surveillance observation", source: "Synthetic demonstration fixture" },
    ],
  };
}

export function ProductionSurveillanceDemo() {
  const document = useMemo(makeDocument, []);
  const components = useMemo(() => getWellComponents(sProfileDesign), []);
  const assembly = useMemo(() => wellComponentsToAssembly({
    id: sProfileDesign.id,
    name: sProfileDesign.wellName ?? sProfileDesign.id,
    totalDepthM: sProfileDesign.totalDepthM,
    components,
  }), [components]);
  const store = useMemo(() => {
    const next = createSubsurfaceStore();
    next.setDataInteraction({ datasetId: document.dataset.id }, "production-surveillance-demo");
    return next;
  }, [document]);

  return <ProductionSurveillanceView document={document} store={store} assembly={assembly} assetBaseUrl="/well-components" />;
}
