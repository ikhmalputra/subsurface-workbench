"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo } from "react";
import { GisMap } from "@ikhmalputra/subsurface-react/gis";
import { MultiWellCorrelation, WellCrossSection } from "@ikhmalputra/subsurface-react/2d";
import { useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";
import { defaultFieldCutoffs, fieldCorrelationWells, fieldLogs, screenFieldInterval } from "../lib/field-project";
import { useWorkspace } from "./workspace-provider";
import { FieldTrajectoryInspector } from "./field-trajectory-inspector";
import { CommandButton, CommandIcon } from "@ikhmalputra/subsurface-react/ui";

const OffshoreScene = dynamic(() => import("@ikhmalputra/subsurface-react/3d").then((module) => module.OffshoreScene), { ssr: false });
export type FieldTool = "spatial" | "correlation" | "section";

export function FieldWorkspace({ tool }: { tool: FieldTool }) {
  const { fieldProject: project, fieldStore: store, fieldWellIds: ids, setFieldWellIds, fieldOptions, updateFieldOptions, fieldGisState, setFieldGisState } = useWorkspace();
  const active = useSubsurfaceSelector(store, (state) => state.activeAsset);
  const { log, flatten, focusInterval, view, offset, endpoints, cutoffs } = fieldOptions;
  const selected = project.records.filter((record) => ids.includes(record.well.id));
  const activeRecord = project.records.find((record) => record.well.id === active.wellId);
  const trajectories3d = useMemo(() => project.records.map((record) => ({ design: record.sceneDesign, waterDepthM: project.waterDepthsM[record.well.id]!, markers: record.tops })), [project]);
  const startHead = project.records.find((record) => record.well.id === endpoints[0])?.stations[0]!.xyz;
  const endHead = project.records.find((record) => record.well.id === endpoints[1])?.stations[0]!.xyz;
  const dx = startHead && endHead ? endHead[0] - startHead[0] : 0;
  const dy = startHead && endHead ? endHead[1] - startHead[1] : 0;
  const ordered = [...selected].sort((a, b) => {
    if (a.well.id === endpoints[0] || b.well.id === endpoints[1]) return -1;
    if (a.well.id === endpoints[1] || b.well.id === endpoints[0]) return 1;
    return (a.stations[0]!.xyz[0] - b.stations[0]!.xyz[0]) * dx + (a.stations[0]!.xyz[1] - b.stations[0]!.xyz[1]) * dy;
  });
  const validSection = selected.length >= 2 && endpoints[0] !== endpoints[1] && endpoints.every((id) => ids.includes(id));
  function focusWell(id: string) { store.focusAsset(id, null, "field"); }
  return <section className="demo-field-workspace" aria-label="Connected Field workspace" data-testid="field-workspace">
    <header className="demo-field-header"><div><h1>Equator field</h1><p>One project · four wells · shared selection and source stations</p></div><strong>SYNTHETIC ENGINEERING SCENARIO</strong></header>
    <p className="demo-gis-notice">Assumed UTM 50N locations, generated surveys/logs, synthetic casing and completion records, interpreted Sand R1 top/base and illustrative water depths. No measured bathymetry, production, pressure, saturation or reserves are supplied. Field selection is independent of the documented well workspace.</p>
    <nav aria-label="Field tools" className="demo-field-tools">
      <Link href="/map/" aria-current={tool === "spatial" ? "page" : undefined}><CommandIcon name="locate" />1 · Locate wells</Link>
      <Link href="/correlation/" aria-current={tool === "correlation" ? "page" : undefined}><CommandIcon name="layers" />2 · Compare intervals</Link>
      <Link href="/cross-section/" aria-current={tool === "section" ? "page" : undefined}><CommandIcon name="view" />3 · Spatial section</Link>
    </nav>
    <div className="demo-field-register" role="group" aria-label="Field well selection">
      {project.records.map(({ well }) => <div key={well.id}>
        <label><input type="checkbox" checked={ids.includes(well.id)} onChange={(event) => setFieldWellIds(event.target.checked ? [...ids, well.id] : ids.filter((id) => id !== well.id))} />Include {well.label}</label>
        <CommandButton icon="inspect" aria-pressed={active.wellId === well.id} onClick={() => focusWell(well.id)}>Inspect {well.label}</CommandButton>
      </div>)}
    </div>
    <p role="status" className="demo-correlation-status">{activeRecord ? `${activeRecord.well.label} selected${active.depth_md !== null ? ` / ${active.depth_md.toFixed(1)} m MD below seabed wellhead` : ""}` : "Choose a well to inspect its location."} · {selected.length} wells included in comparison/section.</p>
    {tool === "spatial" && <>
      <div className="demo-field-controls"><label>Spatial view <select value={view} onChange={(event) => updateFieldOptions({ view: event.target.value === "map" ? "map" : "3d" })}><option value="map">3D geographic map</option><option value="3d">Offshore overview</option></select></label></div>
      {view === "3d" ? <OffshoreScene model={project.model} origin={project.origin} waterDepthsM={project.waterDepthsM} selectedWellId={active.wellId} onSelectWell={focusWell} /> : <GisMap document={project.model.document} store={store} workerUrl="/gis/maplibre-gl-worker.mjs" trajectories3d={trajectories3d} gisState={fieldGisState} onGisStateChange={setFieldGisState}>
        {activeRecord ? <FieldTrajectoryInspector key={activeRecord.well.id} record={activeRecord} waterDepthM={project.waterDepthsM[activeRecord.well.id]!} mdM={active.depth_md} store={store} /> : <p className="demo-gis-notice">Select a well or click an embedded 3D path to inspect its trajectory.</p>}
      </GisMap>}
      <section className="demo-offshore-details" data-testid="offshore-details" aria-label="Selected offshore well">
        <h2>{activeRecord?.well.label ?? "Select a well to inspect its location"}</h2>
        {activeRecord && <dl>
          <div><dt>Longitude / latitude</dt><dd>{activeRecord.stations[0]!.geographic.map((value) => `${value.toFixed(6)}°`).join(" / ")}</dd></div>
          <div><dt>Water depth</dt><dd>{project.waterDepthsM[activeRecord.well.id]} m below sea surface</dd></div>
          <div><dt>Terminal MD / TVD below wellhead</dt><dd>{activeRecord.stations.at(-1)!.mdM.toFixed(1)} m / {activeRecord.stations.at(-1)!.xyz[2].toFixed(1)} m</dd></div>
          <div><dt>Reference</dt><dd>EPSG:32650 · MD/TVD from seabed wellhead · section depth from sea surface</dd></div>
        </dl>}
      </section>
    </>}
    {tool === "correlation" && <>
      <h2>Compare Sand R1 intervals—not map distance</h2>
      <p>MD is measured along each borehole from its seabed wellhead. Flattening aligns the interpreted top for interval comparison; it is not structural elevation. Switch log type to assess shale response, pore volume or resistivity separately.</p>
      <div className="demo-field-controls"><label>Log response <select value={log} onChange={(event) => {
        const value = event.target.value;
        if (value !== "gr" && value !== "porosity" && value !== "resistivity") throw new TypeError("Unknown field log response.");
        updateFieldOptions({ log: value });
      }}>{Object.entries(fieldLogs).map(([id, item]) => <option key={id} value={id}>{item.label} ({item.unit})</option>)}</select></label>
      <label><input type="checkbox" checked={focusInterval} onChange={(event) => updateFieldOptions({ focusInterval: event.target.checked })} />Focus R1 interval ±100 m MD</label></div>
      {selected.length >= 2 ? <MultiWellCorrelation wells={fieldCorrelationWells(project, ids, log, focusInterval)} store={store} flattenOn={flatten} onFlattenOnChange={(value) => updateFieldOptions({ flatten: value })} height={700} minWidth={900} title={`${fieldLogs[log].label} / shared Sand R1 markers`} /> : <p role="alert">Include at least two field wells to compare logs.</p>}
      <section className="demo-field-quality"><h2>R1 interval quality screen</h2><p>Current screening cutoffs: GR &lt; {cutoffs.grMax} API, effective porosity ≥ {cutoffs.phiMin} v/v, deep resistivity ≥ {cutoffs.rtMin} ohm.m. Thickness is vertical, clipped to top/base. Adjacent valid samples are averaged per segment; segments touching missing data are excluded. This is a quality screen, <strong>not net pay, hydrocarbon volume or reserves</strong>. Equator C contains a deliberate acquisition gap.</p>
        <div className="demo-field-controls">
          <label>GR maximum (API)<select value={cutoffs.grMax} onChange={(event) => updateFieldOptions({ cutoffs: { ...cutoffs, grMax: Number(event.target.value) } })}>{[45, 60, 75, 90, 120].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Porosity minimum (v/v)<select value={cutoffs.phiMin} onChange={(event) => updateFieldOptions({ cutoffs: { ...cutoffs, phiMin: Number(event.target.value) } })}>{[0.08, 0.12, 0.16, 0.2, 0.24].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Resistivity minimum (ohm.m)<select value={cutoffs.rtMin} onChange={(event) => updateFieldOptions({ cutoffs: { ...cutoffs, rtMin: Number(event.target.value) } })}>{[2, 5, 10, 15, 25].map((value) => <option key={value}>{value}</option>)}</select></label>
          <CommandButton icon="reset" onClick={() => updateFieldOptions({ cutoffs: defaultFieldCutoffs })}>Reset cutoffs</CommandButton>
        </div>
        <div className="demo-table-scroll"><table><caption>Vertical interval coverage and qualifying thickness</caption><thead><tr><th>Well</th><th>Gross (m TVD)</th><th>Tested (m)</th><th>Coverage</th><th>Qualifying (m)</th><th>Thickness-weighted φ</th></tr></thead><tbody>{selected.map((record) => {
          const s = screenFieldInterval(record, project.waterDepthsM[record.well.id]!, cutoffs);
          return <tr key={record.well.id}><th>{record.well.label}</th><td>{s.gross.toFixed(1)}</td><td>{s.tested.toFixed(1)}</td><td>{(s.tested / s.gross * 100).toFixed(1)}%</td><td data-testid={`qualifying-${record.well.id}`}>{s.net.toFixed(1)}</td><td>{s.meanPhi === null ? "Not available" : s.meanPhi.toFixed(3)}</td></tr>;
        })}</tbody></table></div>
      </section>
    </>}
    {tool === "section" && <>
      <h2>Where R1 sits in space</h2><p>Vertical curtain between chosen endpoint wellheads, using the same trajectories and R1 markers. Depth is metres below the synthetic sea surface: water depth + TVD below wellhead. Off-plane wells/markers are disclosed; connecting top ties are not a geological surface model.</p>
      <div className="demo-field-controls">
        {(["Start", "End"] as const).map((name, index) => <label key={name}>{name} well <select value={endpoints[index]} onChange={(event) => updateFieldOptions({ endpoints: index === 0 ? [event.target.value, endpoints[1]] : [endpoints[0], event.target.value] })}>{project.records.map(({ well }) => <option key={well.id} value={well.id}>{well.label}</option>)}</select></label>)}
        <label>Curtain tolerance <select value={offset} onChange={(event) => updateFieldOptions({ offset: Number(event.target.value) })}>{[250, 500, 1000, 3000].map((value) => <option key={value} value={value}>{value} m</option>)}</select></label>
      </div>
      {validSection ? <>
        <p>Endpoint distance: {Math.hypot(dx, dy).toFixed(0)} m · grid bearing: {((Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360).toFixed(1)}° · tolerance: {offset} m. Horizontal and depth axes are scaled independently; do not infer true dip from display angles.</p>
        <WellCrossSection wells={ordered.map((record) => record.section)} store={store} maxOffsetM={offset} height={700} title="R1 spatial section / depth below sea surface" />
        <div className="demo-field-quality"><div className="demo-table-scroll"><table><caption>R1 structural depths from the common synthetic sea-surface reference</caption><thead><tr><th>Well</th><th>R1 top (m below sea)</th><th>R1 base (m below sea)</th><th>Gross vertical thickness (m)</th></tr></thead><tbody>{ordered.map((record) => <tr key={record.well.id}><th>{record.well.label}</th><td>{record.reservoirTopDepth.toFixed(1)}</td><td>{record.reservoirBaseDepth.toFixed(1)}</td><td>{record.summary.gross.toFixed(1)}</td></tr>)}</tbody></table></div></div>
      </> : <p role="alert">Include two distinct endpoint wells and choose different start/end wells.</p>}
    </>}
  </section>;
}
