"use client";

import { getWellComponents } from "@ikhmalputra/subsurface-core";
import { useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";
import { useWorkspace } from "./workspace-provider";
import { WellPicker } from "./wells";
import { usePathname } from "next/navigation";
import { CommandButton } from "@ikhmalputra/subsurface-react/ui";

export function WorkspaceContextBar() {
  const pathname = usePathname();
  if (["/map", "/correlation", "/cross-section"].includes(pathname.replace(/\/$/, ""))) return <FieldContextBar />;
  return <WellContextBar />;
}

function FieldContextBar() {
  const { fieldProject, fieldStore, fieldWellIds } = useWorkspace();
  const active = useSubsurfaceSelector(fieldStore, (state) => state.activeAsset);
  const well = fieldProject.records.find((record) => record.well.id === active.wellId);
  return <section className="demo-workspace-context" aria-label="Active field context" data-testid="workspace-context">
    <strong>Equator field · synthetic</strong><span>{fieldWellIds.length} of 4 wells included</span>
    <span>Selection: {well?.well.label ?? "No well selected"}</span>
    <span>Depth: {active.depth_md === null ? "not selected" : `${active.depth_md.toFixed(1)} m MD from seabed wellhead`}</span>
    <span>Horizontal CRS: EPSG:32650</span>
  </section>;
}

function WellContextBar() {
  const { store, well, chooseWell } = useWorkspace();
  const active = useSubsurfaceSelector(store, (state) => state.activeAsset);
  const depth = useSubsurfaceSelector(store, (state) => state.depthLink);
  const component = getWellComponents(well.design).find((item) => item.id === active.componentId);
  return <section className="demo-workspace-context" aria-label="Active well context" data-testid="workspace-context">
    <WellPicker value={well.id} onChange={chooseWell} />
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
