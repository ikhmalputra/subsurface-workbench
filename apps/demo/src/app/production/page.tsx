import type { Metadata } from "next";
import { DemoHeader, DemoPage } from "../../components/showcase";
import { ProductionSurveillanceDemo } from "../../components/production-surveillance-demo";

export const metadata: Metadata = { title: "Production & surveillance · Subsurface SDK" };

const code = `
import { validateProductionSurveillanceDocument } from "@ikhmalputra/subsurface-core/contracts";
import { ProductionSurveillanceView } from "@ikhmalputra/subsurface-react/production";

const record = validateProductionSurveillanceDocument(hostProductionAndEvents);
<ProductionSurveillanceView document={record} store={workspaceStore} assembly={wellAssembly} />
`;

export default function ProductionPage() {
  return <DemoPage current="/production/">
    <DemoHeader
      eyebrow="Capability · production and surveillance"
      title="Production & surveillance"
      lede="Explore supplied time-series observations, null gaps, and dated well events together. Event selection publishes the well and any reported measured depth to the shared store; brushing the chart filters the event list by UTC time."
      points={[
        "Choose a rate column and inspect the linked, unit-labelled chart and observations table.",
        "Brush a UTC interval to filter events, then clear the time filter to restore the full event list.",
        "Select an event to focus the well and, when reported, place its measured-depth cursor on the construction schematic.",
        "Null observations remain gaps; the SDK does not fill missing dates or calculate inferred production.",
        "All values and events in this page are synthetic and are not reported well performance.",
      ]}
      uses={["ProductionSurveillanceDocument", "validateProductionSurveillanceDocument", "ProductionSurveillanceView", "InteractionDataset", "SubsurfaceStore"]}
      code={code}
    />
    <ProductionSurveillanceDemo />
  </DemoPage>;
}
