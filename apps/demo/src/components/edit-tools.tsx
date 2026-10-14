"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getWellComponents, wellComponentsToAssembly } from "@ikhmalputra/subsurface-core";
import type { WellDesign, WellComponent, FormationLayer, WellOperations } from "@ikhmalputra/subsurface-core";
import { CommandButton } from "@ikhmalputra/subsurface-react/ui";
import { wells } from "./wells-data";
import { useWorkspace } from "./workspace-provider";
import { useTools } from "./tools";
import { assertWellDesign, assertWellOperations, localLogUrl, parseWellRevision } from "../lib/well-revision";
import type { WellRevision } from "../lib/well-revision";

/**
 * The well editor as tools over the sheet. What was one route with six tabs is five tools that
 * each edit the active well's revision in the workspace provider: Construction (the builder's
 * parts, properties and undo over the sheet's Edit view), Well properties, Component records,
 * Formations and Records & data. The sheet draws the revision, so an edit is on the section, the
 * drawings and the report at once; the original source is kept and can be restored.
 */

function JsonEditor({ label, value, onApply }: { label: string; value: unknown; onApply: (value: unknown) => void }) {
  const [input, setInput] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);
  return <section className="demo-panel demo-well-json">
    <label>{label}<textarea value={input} onChange={(event) => setInput(event.target.value)} spellCheck={false} /></label>
    {error && <p role="alert">{error}</p>}
    <CommandButton icon="apply" onClick={() => {
      try { onApply(JSON.parse(input)); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    }}>Apply {label}</CommandButton>
  </section>;
}

function EditField({ label, value, type = "text", onChange }: { label: string; value: string | number | null | undefined; type?: "text" | "number" | "color"; onChange: (value: string) => void }) {
  return <label className="demo-well-field">{label}<input key={`${label}:${value}`} type={type} defaultValue={value ?? ""} step={type === "number" ? "any" : undefined} onBlur={(event) => {
    if (event.target.value !== String(value ?? "")) onChange(event.target.value);
  }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>;
}

function OperationalEditor({ operations, onChange }: { operations: WellOperations; onChange: (value: WellOperations) => void }) {
  const [group, setGroup] = useState<"days" | "runs" | "sections" | "milestones">("days");
  const [index, setIndex] = useState(0);
  const entries = operations[group];
  const entry = entries[index];
  function update(key: string, value: string | number | null | readonly string[]) {
    onChange({ ...operations, [group]: entries.map((item, position) => position === index ? { ...item, [key]: value } : item) });
  }
  const labels: Readonly<Record<string, string>> = {
    mdFt: "Measured depth (ft)", mdM: "Measured depth (m)", tvdFt: "True vertical depth (ft)",
    topFt: "Top depth (ft)", baseFt: "Base depth (ft)", topM: "Top depth (m)", baseM: "Base depth (m)",
    footageFt: "Footage (ft)", drilledFt: "Drilled length (ft)", mudWeightPpg: "Mud weight (ppg)",
    avgRopFph: "Average ROP (ft/h)", bitSizeIn: "Bit size (in)", dayFromSpud: "Day from spud",
    holeSection: "Hole section", sourceHeading: "Source heading", holeComponentId: "Hole component ID",
    casingComponentId: "Casing component ID", runCount: "Run count", problemRuns: "Problem runs",
    firstDate: "First date", lastDate: "Last date",
  };
  const enums: Readonly<Record<string, readonly string[]>> = {
    category: ["drilling", "tripping", "casing", "rig", "circulating", "logging", "coring", "testing", "repair", "other"],
    kind: ["drilling", "coring", "cleanout", "reaming", "survey", "cooldown", "test", "fishing", "logging", "plugback", "milling"],
    outcome: ["completed", "problem", "failed"],
  };
  return <section className="demo-panel" aria-label="Operational record editor">
    <div className="demo-toolbar demo-edit-record-pick">
      <label>Record collection<select aria-label="Record collection" value={group} onChange={(event) => {
        const next = event.target.value;
        if (next === "days" || next === "runs" || next === "sections" || next === "milestones") { setGroup(next); setIndex(0); }
      }}><option value="days">Daily reports</option><option value="runs">Service runs</option><option value="sections">Hole sections</option><option value="milestones">Milestones</option></select></label>
      <label>Operational record<select aria-label="Operational record" value={index} onChange={(event) => setIndex(Number(event.target.value))}>{entries.map((item, position) => <option key={position} value={position}>{"date" in item ? item.date : item.id} · {"headline" in item ? item.headline : "summary" in item ? item.summary : "name" in item ? item.name : item.label}</option>)}</select></label>
    </div>
    {!entry ? <p>No records in this collection. Use the advanced register to add records.</p> : <div className="demo-well-fields">
      {Object.entries(entry).filter(([key]) => key !== "id").map(([key, value]) => {
        const label = labels[key] ?? `${key[0]!.toUpperCase()}${key.slice(1)}`;
        if (Array.isArray(value)) return <label key={key} className="demo-well-field">{label}<textarea key={JSON.stringify(value)} defaultValue={value.join("\n")} onBlur={(event) => update(key, event.target.value.split("\n").filter((line) => line.trim()))} /></label>;
        const options = enums[key];
        if (options) return <label key={key} className="demo-well-field">{label}<select value={String(value)} onChange={(event) => update(key, event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
        const numeric = typeof value === "number" || (value === null && !key.endsWith("Date"));
        return <EditField key={`${group}:${index}:${key}`} label={label} value={value} type={numeric ? "number" : "text"} onChange={(input) => update(key, numeric ? input.trim() ? Number(input) : value === null ? null : NaN : input || (value === null ? null : ""))} />;
      })}
    </div>}
  </section>;
}

/** The active well's revision and the one way every tool changes it. */
function useRevisionEditor() {
  const { well, revisions, applyRevision, restoreSource, updateAssemblyDraft } = useWorkspace();
  const source = wells.find((entry) => entry.id === well.id) ?? wells[0]!;
  const revision: WellRevision = revisions[source.design.id] ?? { design: source.design, operations: source.operations ?? null, logUrl: source.logUrl ?? null };
  const { design } = revision;
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  /** Validate and apply; throws so a caller inside a form can keep the typed value. */
  function apply(next: WellRevision, message: string, keepAssembly = false) {
    try {
      assertWellDesign(next.design);
      applyRevision(source.design.id, next);
      // A change outside the builder resets the builder's undo: its history is of the construction
      // it was given, and that construction is now derived from the new revision.
      if (!keepAssembly) updateAssemblyDraft(design.id, { past: [], present: wellComponentsToAssembly({ id: design.id, name: next.design.wellName ?? source.label, totalDepthM: next.design.totalDepthM, components: getWellComponents(next.design) }), future: [], selectedId: null });
      setError(null);
      setStatus(message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      throw caught;
    }
  }
  function tryApply(next: WellRevision, message: string) {
    try { apply(next, message); } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  }
  function changeDesign(next: WellDesign) { tryApply({ ...revision, design: next }, "Applied to the active well revision."); }
  const edited = !!revisions[design.id];
  return { source, revision, design, error, setError, status, setStatus, apply, tryApply, changeDesign, edited, restore: () => { restoreSource(design.id); setError(null); setStatus("Original source restored."); } };
}

/** What every editing tool says at its foot: which revision is live, what just happened. */
function RevisionFoot({ editor }: { readonly editor: ReturnType<typeof useRevisionEditor> }) {
  return <footer className="demo-edit-foot">
    {editor.error && <p role="alert" className="demo-reject demo-edit-error">{editor.error}</p>}
    <span className="demo-edit-revision">{editor.edited ? `User-authored revision ${editor.design.revision}` : "Original source"}</span>
    <span role="status">{editor.status ?? "Ready · edits apply to the active well"}</span>
  </footer>;
}

/**
 * The builder's parts, properties and undo, over the sheet's Edit view. The builder draws in the
 * sheet and portals its tools here; this tool also carries the export and the restore, which act
 * on the whole revision.
 */
export function ConstructionTool() {
  const editor = useRevisionEditor();
  const tools = useTools();
  const { store, assemblyDrafts, updateAssemblyDraft } = useWorkspace();
  const params = useSearchParams();
  const componentId = params.get("component");
  const { design, source, revision } = editor;
  // The sheet opens its Edit view while this tool is open, and the builder's tools land here.
  useEffect(() => { tools.openPanel("section", "edit"); }, []);
  // A deep link names a component: it is the builder's selection and the sheet's.
  useEffect(() => {
    if (!componentId || !getWellComponents(design).some((component) => component.id === componentId)) return;
    store.selectComponent(componentId, "edit-link");
    const draft = assemblyDrafts[design.id];
    if (draft && draft.selectedId !== componentId) updateAssemblyDraft(design.id, { ...draft, selectedId: componentId });
  }, [componentId, design.id]);
  return <section className="demo-tool demo-edit-tool demo-construction-tool" aria-label="Construction" data-testid="tool-construction">
    <p className="demo-edit-hint">Pick a part on the sheet's Edit view or add one here; properties apply to the active well revision. Undo covers construction edits.</p>
    <div className="demo-edit-tools-host" ref={tools.setConstructionHost} />
    <div className="demo-edit-actions">
      <CommandButton icon="download" onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(revision, null, 2)], { type: "application/json" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${source.id}-full-well-r${design.revision}.json`; anchor.click(); URL.revokeObjectURL(url);
        editor.setStatus("Exported complete well, including trajectory, component records, formations and operational data.");
      }}>Export full well</CommandButton>
      <CommandButton icon="reset" aria-label="Restore original well" title="Restore original well" disabled={!editor.edited} onClick={() => {
        if (!window.confirm("Restore the original well? This clears all active edits for this well.")) return;
        editor.restore();
      }}>Restore original</CommandButton>
    </div>
    <RevisionFoot editor={editor} />
  </section>;
}

export function WellPropertiesTool() {
  const editor = useRevisionEditor();
  const { design, source, revision, changeDesign, apply } = editor;
  return <section className="demo-tool demo-edit-tool demo-edit-inspector" aria-label="Well properties" data-testid="tool-well-properties">
    <div className="demo-edit-panehead"><h3>Edit {design.wellName ?? source.label}</h3><span>m · MD / TVD</span></div>
    <p className="demo-edit-hint">Apply a field with Enter or by leaving it. The sheet updates immediately.</p>
    <div className="demo-panel demo-well-fields">
      <h4 className="demo-edit-fieldgroup">Identity &amp; datum</h4>
      <EditField label="Well name" value={design.wellName ?? source.label} onChange={(wellName) => changeDesign({ ...design, wellName })} />
      <EditField label="Depth datum" value={design.depthDatum} onChange={(depthDatum) => changeDesign({ ...design, depthDatum })} />
      <h4 className="demo-edit-fieldgroup">Depth &amp; elevation</h4>
      <EditField label="Total depth (m MD)" type="number" value={design.totalDepthM} onChange={(value) => changeDesign({ ...design, totalDepthM: value.trim() ? Number(value) : NaN })} />
      <EditField label="Casing bottom (m MD)" type="number" value={design.casingBottomM} onChange={(value) => changeDesign({ ...design, casingBottomM: value.trim() ? Number(value) : NaN })} />
      <EditField label="Reference elevation (m MSL)" type="number" value={design.referenceElevationMslM} onChange={(value) => changeDesign({ ...design, referenceElevationMslM: value.trim() ? Number(value) : undefined })} />
      <EditField label="Ground depth (m TVD)" type="number" value={design.groundTvdM} onChange={(value) => changeDesign({ ...design, groundTvdM: value.trim() ? Number(value) : undefined })} />
      <h4 className="demo-edit-fieldgroup">Trajectory description</h4>
      <EditField label="Trajectory name" value={design.trajectoryName} onChange={(trajectoryName) => changeDesign({ ...design, trajectoryName })} />
      <EditField label="Trajectory note" value={design.trajectoryNote} onChange={(trajectoryNote) => changeDesign({ ...design, trajectoryNote })} />
    </div>
    <details className="demo-edit-advanced"><summary>All well fields and source metadata</summary><JsonEditor key={design.revision} label="well fields" value={design} onApply={(value) => { assertWellDesign(value); if (value.id !== design.id) throw new Error("Well ID is immutable."); apply({ ...revision, design: value }, "All well fields applied."); }} /></details>
    <RevisionFoot editor={editor} />
  </section>;
}

export function ComponentRecordsTool() {
  const editor = useRevisionEditor();
  const { store } = useWorkspace();
  const { design, revision, changeDesign, apply } = editor;
  const components = getWellComponents(design);
  // The record under edit follows the sheet's selection, and choosing one here selects it there.
  const [recordId, setRecordId] = useState(() => store.getState().activeAsset.componentId ?? components[0]?.id ?? "");
  const component = components.find((item) => item.id === recordId) ?? components[0];
  function updateComponent(next: WellComponent) { changeDesign({ ...design, components: components.map((item) => item.id === next.id ? next : item) }); }
  return <section className="demo-tool demo-edit-tool demo-edit-inspector" aria-label="Component records" data-testid="tool-component-records">
    <div className="demo-edit-panehead"><h3>Component records</h3><span>{components.length} records</span></div>
    <section className="demo-panel"><label><span>Component record</span><select aria-label="Component record" value={component?.id ?? ""} onChange={(event) => { setRecordId(event.target.value); store.selectComponent(event.target.value, "component-records"); }}>{components.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label>
      {component && <div className="demo-well-fields">
        {(["name", "material", "description"] as const).map((key) => <EditField key={key} label={`Component ${key}`} value={component[key]} onChange={(value) => updateComponent({ ...component, [key]: value })} />)}
        {([{ key: "topDepthM", label: "Top depth (m MD)" }, { key: "bottomDepthM", label: "Bottom depth (m MD)" }, { key: "outerDiameterMm", label: "Outside diameter (mm)" }, { key: "innerDiameterMm", label: "Inside diameter (mm)" }] as const).map(({ key, label }) => <EditField key={key} label={label} type="number" value={component[key]} onChange={(value) => updateComponent({ ...component, [key]: value.trim() ? Number(value) : key.includes("Diameter") ? null : NaN })} />)}
      </div>}
    </section>
    <details className="demo-edit-advanced"><summary>All component fields, parent links and provenance</summary><JsonEditor key={design.revision} label="component records" value={components} onApply={(next) => {
      const candidate = { ...design, components: next }; assertWellDesign(candidate); apply({ ...revision, design: candidate }, "Component register applied.");
    }} /></details>
    <RevisionFoot editor={editor} />
  </section>;
}

export function FormationsTool() {
  const editor = useRevisionEditor();
  const { design, revision, changeDesign, apply } = editor;
  const [layerId, setLayerId] = useState(design.formations?.[0]?.id ?? "");
  const formation = design.formations?.find((item) => item.id === layerId) ?? design.formations?.[0];
  function updateLayer(next: FormationLayer) { changeDesign({ ...design, formations: design.formations?.map((layer) => layer.id === next.id ? next : layer) }); }
  return <section className="demo-tool demo-edit-tool demo-edit-inspector" aria-label="Formations" data-testid="tool-formations">
    <div className="demo-edit-panehead"><h3>Formations</h3><span>TVD intervals</span></div>
    {formation ? <section className="demo-panel"><label><span>Formation</span><select aria-label="Formation" value={formation.id} onChange={(event) => setLayerId(event.target.value)}>{design.formations?.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select></label>
      <div className="demo-well-fields">
        {(["name", "lithology", "interpretation"] as const).map((key) => <EditField key={key} label={`Formation ${key}`} value={formation[key]} onChange={(value) => updateLayer({ ...formation, [key]: value })} />)}
        {([{ key: "topTvdM", label: "Top depth (m TVD)" }, { key: "bottomTvdM", label: "Bottom depth (m TVD)" }, { key: "densityKgM3", label: "Density (kg/m3)" }, { key: "porosityPct", label: "Porosity (%)" }] as const).map(({ key, label }) => <EditField key={key} label={label} type="number" value={formation[key]} onChange={(value) => updateLayer({ ...formation, [key]: value.trim() ? Number(value) : key === "densityKgM3" || key === "porosityPct" ? null : NaN })} />)}
        <EditField label="Formation color" type="color" value={formation.color} onChange={(color) => updateLayer({ ...formation, color })} />
      </div>
    </section> : <p className="demo-edit-hint">No formations are supplied for this well. Add them through the register below.</p>}
    <details className="demo-edit-advanced"><summary>Advanced formation register</summary><JsonEditor key={design.revision} label="formation register" value={design.formations ?? []} onApply={(formations) => {
      const candidate = { ...design, formations }; assertWellDesign(candidate); apply({ ...revision, design: candidate }, "Formation register applied.");
    }} /></details>
    <RevisionFoot editor={editor} />
  </section>;
}

export function RecordsDataTool() {
  const editor = useRevisionEditor();
  const { design, revision, apply, tryApply } = editor;
  return <section className="demo-tool demo-edit-tool demo-edit-inspector" aria-label="Records & data" data-testid="tool-records-data">
    <div className="demo-edit-panehead"><h3>Records &amp; data</h3><span>sources &amp; operations</span></div>
    <section className="demo-panel"><EditField label="Mud-log file path (same origin)" value={revision.logUrl} onChange={(value) => {
      try { apply({ ...revision, logUrl: localLogUrl(value) }, "Mud-log data source applied."); } catch (caught) { editor.setError(caught instanceof Error ? caught.message : String(caught)); }
    }} /><p className="demo-edit-hint">Operational tables retain their reported units and source citations. Edit them below; unknown values remain null. Raw seismic files remain immutable source assets, not editable voxel data.</p></section>
    {revision.operations && <OperationalEditor operations={revision.operations} onChange={(operations) => tryApply({ ...revision, operations }, "Operational record applied.")} />}
    <details><summary>Advanced operational register, citations and new records</summary>
      <JsonEditor key={`operations-${design.revision}`} label="operational records" value={revision.operations} onApply={(operations) => {
        if (operations !== null) { assertWellOperations(operations); if (operations.wellId !== design.id) throw new Error("Records must belong to this well."); }
        apply({ ...revision, operations }, "Operational records applied.");
      }} />
    </details>
    <details><summary>Import or edit a complete well revision</summary><JsonEditor key={`full-${design.revision}`} label="full well revision" value={revision} onApply={(value) => apply(parseWellRevision(JSON.stringify(value), design.id), "Complete well revision applied.")} /></details>
    <RevisionFoot editor={editor} />
  </section>;
}
