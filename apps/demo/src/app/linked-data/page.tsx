import type { Metadata } from "next";
import { DemoHeader, DemoPage } from "../../components/showcase";
import { LinkedDataDemo } from "../../components/linked-data-demo";

export const metadata: Metadata = { title: "Linked data interaction · Subsurface SDK" };

const code = `
import { LinkedDatasetView } from "@ikhmalputra/subsurface-react/2d";
import { validateInteractionDataset } from "@ikhmalputra/subsurface-core/contracts";

const dataset = validateInteractionDataset(hostColumnarObservations);
<LinkedDatasetView dataset={dataset} store={workspaceStore} valueColumnId="porosity" />
`;

export default function LinkedDataPage() {
  return <DemoPage current="/linked-data/">
    <DemoHeader
      eyebrow="Capability · linked chart, table, and spatial samples"
      title="Linked data interaction"
      lede="A dataset is a host-owned set of stable sample IDs, a strictly ordered measured-depth/time/index key, aligned typed columns, and optional frame-declared XYZ points. Chart, table, and spatial actions publish only compact IDs, ranges, and coordinates to the instance store."
      points={[
        "Hover a table row, chart sample, or spatial sample to highlight the same stable row everywhere.",
        "Drag the chart to brush a range and filter the table; click a sample to select it and publish its exact supplied XYZ.",
        "The table is virtualized, keyboard-navigable, sortable, filterable, and exports its currently filtered rows as CSV. Chart samples also support arrow-key navigation and selection.",
        "Use the demo selectors to inspect light, dark, and high-contrast themes with comfortable or compact density; the Cividis scale includes units.",
        "All data is synthetic and labelled; the host remains responsible for data ownership and transforming spatial points into its shared frame.",
      ]}
      uses={["InteractionDataset", "validateInteractionDataset", "LinkedDatasetView", "DataInteractionState"]}
      code={code}
    />
    <LinkedDataDemo />
  </DemoPage>;
}
