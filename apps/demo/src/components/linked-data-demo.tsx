"use client";

import { useMemo } from "react";
import { validateInteractionDataset } from "@ikhmalputra/subsurface-core/contracts";
import { createMockLogCurve, createMockTrajectory } from "@ikhmalputra/subsurface-core/sandbox";
import { createSubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import { useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";
import { LinkedDatasetView } from "@ikhmalputra/subsurface-react/2d";

function makeDataset() {
  const trajectory = createMockTrajectory({ id: "linked-well-a", stations: 600, totalDepthMdM: 3000, seed: 107 });
  const curve = createMockLogCurve(trajectory, { seed: 22 });
  const values = new Float32Array(curve.values);
  for (const index of [41, 42, 190, 191, 442, 443]) values[index] = Number.NaN;
  return validateInteractionDataset({
    version: 1,
    id: "well-a-porosity-observations",
    assetId: "asset:linked-well-a",
    wellId: "linked-well-a",
    key: { kind: "depth", unit: "m", reference: "MD" },
    sampleIds: Array.from({ length: trajectory.depthsMdM.length }, (_, index) => `well-a:sample:${String(index + 1).padStart(4, "0")}`),
    keyValues: trajectory.depthsMdM,
    columns: [{
      id: "porosity",
      label: "Porosity",
      unit: "v/v",
      values,
      nullValue: "nan",
    }],
    reference: trajectory.reference,
    spatialXYZ: trajectory.xyz,
  });
}

export function LinkedDataDemo() {
  const dataset = useMemo(makeDataset, []);
  const store = useMemo(() => {
    const next = createSubsurfaceStore();
    next.setDataInteraction({ datasetId: dataset.id }, "linked-data-demo");
    return next;
  }, [dataset]);
  const selection = useSubsurfaceSelector(store, (state) => {
    const interaction = state.dataInteraction;
    const selected = interaction.selectedIds[0];
    const index = selected ? dataset.sampleIds.indexOf(selected) : -1;
    const xyz = index >= 0 && dataset.spatialXYZ
      ? Array.from(dataset.spatialXYZ.slice(index * 3, index * 3 + 3), (value) => value.toFixed(1)).join(", ")
      : null;
    const hover = interaction.hoveredId ? ` · hovered ${interaction.hoveredId}` : "";
    const spatial = xyz ? ` · XYZ ${xyz} m` : "";
    return `${interaction.selectedIds.length} selected${selected ? `: ${selected}` : ""}${spatial}${hover}`;
  });

  return <div className="demo-linked-data-workspace">
      <p className="demo-correlation-status" role="status">{selection}</p>
      <div className="demo-panel demo-linked-dataset"><LinkedDatasetView dataset={dataset} store={store} valueColumnId="porosity" tableHeight={340} /></div>
  </div>;
}
