"use client";

import { getWellComponents } from "@ikhmalputra/subsurface-core";
import { useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";
import { useWorkspace } from "./workspace-provider";
import { WellPicker } from "./wells";
import { CommandButton } from "@ikhmalputra/subsurface-react/ui";
import { useTools } from "./tools";

/**
 * The workspace context in two parts: the well picker on the floating workspace toolbar, and the
 * read-outs — provenance, datum, selection, depth — on the status bar, where a CAD tool keeps its
 * coordinates. The Field routes have no picker; their read-outs describe the field.
 */
export function WorkspaceContextBar({ part }: { readonly part: "picker" | "readouts" }) {
  const { document } = useTools();
  const field = document === "field" || document === "correlation" || document === "cross-section";
  if (part === "picker") return field ? <strong className="demo-context-field">Equator field · synthetic</strong> : <WellPickerPart />;
  return field ? <FieldContextBar /> : <WellContextBar />;
}

function WellPickerPart() {
  const { well, chooseWell } = useWorkspace();
  return <WellPicker value={well.id} onChange={chooseWell} />;
}

function FieldContextBar() {
  const { fieldProject, fieldStore, fieldWellIds } = useWorkspace();
  const active = useSubsurfaceSelector(fieldStore, (state) => state.activeAsset);
  const well = fieldProject.records.find((record) => record.well.id === active.wellId);
  return <section className="demo-workspace-context" aria-label="Active field context" data-testid="workspace-context">
    <span>{fieldWellIds.length} of 4 wells included</span>
    <span>Selection: {well?.well.label ?? "No well selected"}</span>
    <span>Depth: {active.depth_md === null ? "not selected" : `${active.depth_md.toFixed(1)} m MD from seabed wellhead`}</span>
    <span>Horizontal CRS: EPSG:32650</span>
  </section>;
}

function WellContextBar() {
  const { store, well } = useWorkspace();
  const active = useSubsurfaceSelector(store, (state) => state.activeAsset);
  const depth = useSubsurfaceSelector(store, (state) => state.depthLink);
  const component = getWellComponents(well.design).find((item) => item.id === active.componentId);
  return <section className="demo-workspace-context" aria-label="Active well context" data-testid="workspace-context">
    <span className="demo-workspace-provenance">{well.design.provenance === "documented" ? "Documented record" : well.design.provenance === "user-authored" ? `User-authored revision ${well.design.revision}` : "Synthetic example"} · m MD</span>
    <span className="demo-context-datum">Datum: {well.design.depthDatum ?? "not reported"}</span>
    <span className="demo-context-selection" title={component?.name}>Selection: {component?.name ?? "No component selected"}</span>
    <span className="demo-context-depth">Depth: {depth.pinnedMdM === null ? "not selected" : `${depth.pinnedMdM.toLocaleString("en", { maximumFractionDigits: 1 })} m MD`}</span>
    {(active.componentId !== null || depth.pinnedMdM !== null) && <CommandButton icon="clear" type="button" onClick={() => {
      store.selectComponent(null, "workspace");
      store.pinDepth(well.design.id, null, "workspace");
    }}>Clear selection</CommandButton>}
  </section>;
}
