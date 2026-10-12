"use client";

import { UsagePanel } from "./usage-panel";

/** The design brief's usage notes — the copy its route carried — as the tray panel beside the document. */
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
export function BuilderUsage() {
  return <UsagePanel id="usage-brief" lede="The curved construction is the starting canvas. Select parts to edit, or open planning, design and review tools in the side dock. Design inputs require an explicit rebuild to replace component edits." points={["The curved construction is the starting canvas; planning, design and review tools are in the side dock", "Design inputs require an explicit rebuild to replace component edits", "Offset wells are compared on nine weighted factors and adopted into the brief with their provenance"]} uses={["proposeCasingScheme", "validateDesign", "designCoverage", "compareWells", "adoptOffsetDesign", "OffsetWellLibrary", "WellDesignWorkflow"]} code={code} />;
}
