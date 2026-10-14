"use client";

import Link from "next/link";
import { useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";
import { CommandButton, CommandIcon } from "@ikhmalputra/subsurface-react/ui";
import { useWorkspace } from "./workspace-provider";
import { useTools } from "./tools";
import { FieldTrajectoryInspector } from "./field-trajectory-inspector";

/**
 * The field's tools, docked beside its documents: the well register (which wells are in the
 * comparison, which is inspected, and the three field documents) and the trajectory inspector for
 * the inspected well. The documents — map, correlation, cross-section — keep only their own plots.
 */

export function FieldRegisterTool() {
  const { fieldProject: project, fieldStore: store, fieldWellIds: ids, setFieldWellIds } = useWorkspace();
  const tools = useTools();
  const active = useSubsurfaceSelector(store, (state) => state.activeAsset);
  const activeRecord = project.records.find((record) => record.well.id === active.wellId);
  const selected = project.records.filter((record) => ids.includes(record.well.id));
  const current = tools.document;
  return <section className="demo-tool demo-field-tool demo-field-register-tool" aria-label="Field well register" data-testid="tool-field-register">
    <header className="demo-field-tool-head"><h3>Well register</h3><p>One project · four wells · shared selection and source stations</p><strong>SYNTHETIC ENGINEERING SCENARIO</strong></header>
    <p className="demo-gis-notice">Assumed UTM 50N locations, generated surveys/logs, synthetic casing and completion records, interpreted Sand R1 top/base and illustrative water depths. No measured bathymetry, production, pressure, saturation or reserves are supplied. Field selection is independent of the documented well workspace.</p>
    <nav aria-label="Field tools" className="demo-field-tools">
      <Link href="/view-well/?tool=field-gis" aria-current={current === "field-gis" ? "page" : undefined}><CommandIcon name="locate" />1 · Locate wells</Link>
      <Link href="/view-well/?tool=correlation" aria-current={current === "correlation" ? "page" : undefined}><CommandIcon name="layers" />2 · Compare intervals</Link>
      <Link href="/view-well/?tool=cross-section" aria-current={current === "cross-section" ? "page" : undefined}><CommandIcon name="view" />3 · Spatial section</Link>
    </nav>
    <div className="demo-field-register" role="group" aria-label="Field well selection">
      {project.records.map(({ well }) => <div key={well.id}>
        <label><input type="checkbox" checked={ids.includes(well.id)} onChange={(event) => setFieldWellIds(event.target.checked ? [...ids, well.id] : ids.filter((id) => id !== well.id))} />Include {well.label}</label>
        <CommandButton icon="inspect" aria-pressed={active.wellId === well.id} onClick={() => store.focusAsset(well.id, null, "field")}>Inspect {well.label}</CommandButton>
      </div>)}
    </div>
    <p role="status" className="demo-correlation-status">{activeRecord ? `${activeRecord.well.label} selected${active.depth_md !== null ? ` / ${active.depth_md.toFixed(1)} m MD below seabed wellhead` : ""}` : "Choose a well to inspect its location."} · {selected.length} wells included in comparison/section.</p>
  </section>;
}

export function FieldTrajectoryTool() {
  const { fieldProject: project, fieldStore: store } = useWorkspace();
  const active = useSubsurfaceSelector(store, (state) => state.activeAsset);
  const activeRecord = project.records.find((record) => record.well.id === active.wellId);
  return <section className="demo-tool demo-field-tool demo-field-trajectory-tool" aria-label="Field trajectory" data-testid="tool-field-trajectory">
    <section className="demo-offshore-details" data-testid="offshore-details" aria-label="Selected offshore well">
      <h3>{activeRecord?.well.label ?? "Select a well to inspect its location"}</h3>
      {activeRecord && <dl>
        <div><dt>Longitude / latitude</dt><dd>{activeRecord.stations[0]!.geographic.map((value) => `${value.toFixed(6)}°`).join(" / ")}</dd></div>
        <div><dt>Water depth</dt><dd>{project.waterDepthsM[activeRecord.well.id]} m below sea surface</dd></div>
        <div><dt>Terminal MD / TVD below wellhead</dt><dd>{activeRecord.stations.at(-1)!.mdM.toFixed(1)} m / {activeRecord.stations.at(-1)!.xyz[2].toFixed(1)} m</dd></div>
        <div><dt>Reference</dt><dd>EPSG:32650 · MD/TVD from seabed wellhead · section depth from sea surface</dd></div>
      </dl>}
    </section>
    {activeRecord ? <FieldTrajectoryInspector key={activeRecord.well.id} record={activeRecord} waterDepthM={project.waterDepthsM[activeRecord.well.id]!} mdM={active.depth_md} store={store} /> : <p className="demo-gis-notice">Select a well in the register, or click an embedded 3D path on the map, to inspect its trajectory.</p>}
  </section>;
}
