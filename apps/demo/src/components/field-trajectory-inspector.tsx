"use client";

import { useState } from "react";
import { positionAtMeasuredDepth } from "@ikhmalputra/subsurface-core";
import type { SubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import type { FieldProject } from "../lib/field-project";
import { useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";
import { CommandButton } from "@ikhmalputra/subsurface-react/ui";

export function FieldTrajectoryInspector({ record, waterDepthM, mdM, store }: {
  record: FieldProject["records"][number]; waterDepthM: number; mdM: number | null; store: SubsurfaceStore;
}) {
  const [depthInput, setDepthInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const design = record.sceneDesign;
  const selectedId = useSubsurfaceSelector(store, (state) => state.activeAsset.componentId);
  const selected = design.components?.find((component) => component.id === selectedId);
  const position = mdM === null ? null : positionAtMeasuredDepth(design, mdM);
  function pin(depth: number) {
    store.pinDepth(record.well.id, depth, "field-trajectory");
    setError(null);
  }
  return <section className="demo-field-trajectory" aria-label="Selected map trajectory inspector" data-testid="field-trajectory-inspector" data-well-id={record.well.id}>
    <header><h2>{record.well.label} · well construction inspector</h2><p>Synthetic construction scenario. Click a casing, tubing or equipment mesh inside the map to inspect it. Comparison tools follow the same well and MD.</p></header>
    <label>Construction component<select aria-label="Construction component" value={selectedId ?? ""} onChange={(event) => {
      const component = design.components?.find((item) => item.id === event.target.value);
      if (component) { pin((component.topDepthM + component.bottomDepthM) / 2); store.selectComponent(component.id, "field-construction"); }
      else store.selectComponent(null, "field-construction");
    }}><option value="">Select a component</option>{design.components?.map((component) => <option key={component.id} value={component.id}>{component.name}</option>)}</select></label>
    {selected && <section data-testid="field-component-record" className="demo-field-component-record">
      <h3>{selected.name}</h3><dl>
        <div><dt>Component / material</dt><dd>{selected.kind} / {selected.material}</dd></div>
        <div><dt>MD interval below wellhead</dt><dd>{selected.topDepthM.toFixed(1)}–{selected.bottomDepthM.toFixed(1)} m</dd></div>
        <div><dt>Outside / inside diameter</dt><dd>{selected.outerDiameterMm} / {selected.innerDiameterMm ?? "not supplied"} mm</dd></div>
      </dl><p>{selected.description}</p>
    </section>}
    <details><summary>Construction register · {design.components?.length} synthetic records</summary><div className="demo-table-scroll"><table>
      <thead><tr><th>Component</th><th>MD interval (m)</th><th>OD / ID (mm)</th></tr></thead>
      <tbody>{design.components?.map((component) => <tr key={component.id}><td><CommandButton kind="selection" aria-pressed={selectedId === component.id} onClick={() => { pin((component.topDepthM + component.bottomDepthM) / 2); store.selectComponent(component.id, "field-construction"); }}>{component.name}</CommandButton></td><td>{component.topDepthM.toFixed(1)}–{component.bottomDepthM.toFixed(1)}</td><td>{component.outerDiameterMm} / {component.innerDiameterMm ?? "—"}</td></tr>)}</tbody>
    </table></div></details>
    <div className="demo-field-controls">
      {record.tops.map((top) => <CommandButton kind="selection" key={top.id} onClick={() => pin(top.mdM)}>{top.label}</CommandButton>)}
      <CommandButton icon="clear" disabled={mdM === null} onClick={() => store.pinDepth(record.well.id, null, "field-trajectory")}>Clear depth</CommandButton>
    </div>
    <label className="demo-field-depth-slider">Trajectory MD (m)<input aria-label="Trajectory measured depth" type="range" min={0} max={design.totalDepthM} step="any" value={mdM ?? 0} onChange={(event) => pin(Number(event.target.value))} /></label>
    <form className="demo-field-controls" onSubmit={(event) => {
      event.preventDefault();
      const depth = Number(depthInput);
      if (!depthInput.trim() || !Number.isFinite(depth) || depth < 0 || depth > design.totalDepthM) {
        setError(`Enter an MD between 0 and ${design.totalDepthM} m.`);
        return;
      }
      pin(depth);
    }}>
      <label>Go to trajectory MD<input type="number" step="any" value={depthInput} onChange={(event) => setDepthInput(event.target.value)} placeholder="metres" /></label><CommandButton icon="locate" type="submit">Go to depth</CommandButton>
    </form>
    {error && <p role="alert">{error}</p>}
    <output className="demo-field-position" data-testid="field-trajectory-position" aria-live="polite">
      {position ? <dl>
        <div><dt>Pinned MD</dt><dd>{position.mdM.toFixed(1)} m</dd></div>
        <div><dt>TVD below seabed wellhead</dt><dd>{position.tvdM.toFixed(1)} m</dd></div>
        <div><dt>Depth below sea surface</dt><dd>{(waterDepthM + position.tvdM).toFixed(1)} m</dd></div>
        <div><dt>East / north from wellhead</dt><dd>{position.eastingM.toFixed(1)} / {position.northingM.toFixed(1)} m</dd></div>
        <div><dt>Inclination / grid azimuth</dt><dd>{position.inclinationDeg.toFixed(1)}° / {position.azimuthDeg.toFixed(1)}°</dd></div>
      </dl> : <p>Select a depth on the path, slider or R1 markers to inspect its position.</p>}
    </output>
    <p>Well-local coordinates in metres; TVD starts at the seabed wellhead. Construction dimensions and component MDs are assumed synthetic records, not installed equipment. Display diameters and short tools are exaggerated for legibility. No pressure readings, barrier verification or seismic supplied.</p>
  </section>;
}
