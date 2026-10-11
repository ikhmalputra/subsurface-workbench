import type { Metadata } from "next";
import { DemoHeader, DemoPage } from "../../components/showcase";
import { WellReportDemo } from "../../components/well-report-demo";

export const metadata: Metadata = { title: "Well report · Subsurface SDK" };

const code = `
import { validateWellReportSpec } from "@ikhmalputra/subsurface-core/contracts";
import { WellReportView } from "@ikhmalputra/subsurface-react/2d";

const report = validateWellReportSpec(hostWellReportDocument);
<WellReportView
  report={report}
  selectedMdM={depthLink.pinnedMdM}
  cursorMdM={depthLink.cursorMdM}
  onSelectMd={depthLink.pinCursor}
/>;
`;

export default function WellReportPage() {
  return <DemoPage current="/well-report/">
    <DemoHeader
      eyebrow="Capability · report as a view"
      title="Well report"
      lede="Render a declarative, host-owned report document interactively on screen and as paginated HTML/SVG when printed. The browser prints the WebGL 3D view as a canvas. Depth picks publish into the shared instance-scoped store; the SDK does not store report data or generate missing values."
      points={[
        "The validated report spec is JSON-compatible and requires identity, datum, provenance, source references, assumptions, and not-checked disclosures.",
        "A cited study register presents reported pressure tests, drilling step tests, survey acquisitions, and explicit simulation-result gaps.",
        "Trajectory and log figures keep their stated metre-based MD and units; unknown samples remain gaps or read not reported.",
        "Tables and milestone depths can focus the same shared MD link used by other views.",
        "Print / save as PDF uses a compact A4 landscape layout with flowing tables, not a screenshot of the page.",
        "Browser print keeps HTML tables and SVG figures as document content; the WebGL 3D view is a canvas.",
        "The demo uses documented FORGE records; unavailable operator/UWI/offset fields are explicitly not reported.",
        "This is a visualization/reporting surface, not engineering certification or data persistence.",
      ]}
      uses={["WellReportSpec", "validateWellReportSpec", "WellReportView", "useDepthLink"]}
      code={code}
    />
    <WellReportDemo />
  </DemoPage>;
}
