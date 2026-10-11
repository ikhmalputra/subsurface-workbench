"use client";

import { useMemo } from "react";
import { getWellComponents } from "@ikhmalputra/subsurface-core";
import type { WellComponent, WellDesign } from "@ikhmalputra/subsurface-core";
import { wells } from "./wells-data";
import { useWorkspace } from "./workspace-provider";
export { wells } from "./wells-data";

export function WellPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return <label className="demo-picker">
    <span>Well</span>
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {wells.map((well) => <option key={well.id} value={well.id}>{well.label}</option>)}
    </select>
  </label>;
}

const metres = (value: number) => `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })} m`;
const inches = (mm: number | null) => mm === null ? "Not reported" : `${(mm / 25.4).toLocaleString("en-US", { maximumFractionDigits: 3 })} in`;

export function RecordCard({ component, design }: { component: WellComponent | undefined; design: WellDesign }) {
  if (!component) return <aside className="demo-record" aria-label="Selected record"><p className="demo-record-note">Select a component to inspect it.</p></aside>;
  return <aside className="demo-record" aria-label="Selected record" data-testid="demo-record" data-component-id={component.id}>
    <p className="demo-eyebrow">{component.kind}</p>
    <h2>{component.name}</h2>
    <dl>
      <div><dt>Top MD</dt><dd>{component.topDepthReported === false ? "Not reported" : metres(component.topDepthM)}</dd></div>
      <div><dt>Bottom MD</dt><dd>{metres(component.bottomDepthM)}</dd></div>
      <div><dt>Outside diameter</dt><dd>{inches(component.outerDiameterMm)}</dd></div>
      <div><dt>Inside diameter</dt><dd>{inches(component.innerDiameterMm)}</dd></div>
      <div><dt>Material</dt><dd>{component.material}</dd></div>
    </dl>
    <p className="demo-record-note">{component.description}</p>
    {design.provenance === "user-authored" && <p className="demo-record-note">User-authored revision. Retained source citations describe the original record, not verification of these edits.</p>}
    {component.sourceUrl ? <a className="demo-link" href={component.sourceUrl} target="_blank" rel="noreferrer">Source{component.sourcePage ? ` · page ${component.sourcePage}` : ""} ↗</a> : <p className="demo-record-note">{design.provenance === "documented" ? "Documented record." : design.provenance === "user-authored" ? "No source citation for this record." : "Synthetic example record — not engineering data."}</p>}
  </aside>;
}

export function useWell(id: string) {
  const { revisions } = useWorkspace();
  const source = wells.find((well) => well.id === id);
  if (!source) throw new Error(`Unknown well: ${id}`);
  const revision = revisions[source.design.id];
  const design = revision?.design ?? source.design;
  const operations = revision ? revision.operations : source.operations ?? null;
  const logUrl = revision ? revision.logUrl ?? undefined : source.logUrl;
  const seismic = source.seismic;
  const components = useMemo(() => getWellComponents(design), [design]);
  return { design, components, operations, logUrl, seismic };
}
