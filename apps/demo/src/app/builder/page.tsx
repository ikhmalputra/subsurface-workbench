import type { Metadata } from "next";
import { DemoPage } from "../../components/showcase";
import { DemoWellBuilder } from "../../components/demo-well-builder";

export const metadata: Metadata = { title: "Well design & builder · Subsurface SDK" };

const code = `
import { proposeCasingScheme, validateDesign, designCoverage } from "@ikhmalputra/subsurface-core/well-design";
import { forgeOffsetWell, compareWells, adoptOffsetDesign } from "@ikhmalputra/subsurface-core/offset-wells";
import { OffsetWellLibrary } from "@ikhmalputra/subsurface-react/offset-wells";
import { WellDesignWorkflow } from "@ikhmalputra/subsurface-react/examples";

// Every pressure, test and temperature carries its source: measured, offset, interpreted or assumed.
const match = compareWells(brief, forgeOffsetWell);           // 9 weighted factors; missing data scores nothing
const { brief: reused, changes, failingSections } = adoptOffsetDesign(brief, forgeOffsetWell, { geology: true, casing: true });
const issues = validateDesign(reused);                        // derated, biaxial, kick tolerance, sour service
const { checked, assumptions, notChecked } = designCoverage(reused);

// The host validates and persists user offsets; the SDK receives controlled data and callbacks.
<DemoWellBuilder />
`;

export default function BuilderPage() {
  return <DemoPage current="/builder/">
      <header className="demo-design-heading"><h1>Well design</h1></header>
      <DemoWellBuilder />
      <details className="demo-workbench-usage"><summary>Usage and SDK details</summary>
        <p>The curved construction is the starting canvas. Select parts to edit, or open planning, design and review tools in the side dock. Design inputs require an explicit rebuild to replace component edits.</p>
        <div className="demo-code"><pre tabIndex={0} aria-label="Usage example"><code>{code.trim()}</code></pre></div>
      </details>
  </DemoPage>;
}
