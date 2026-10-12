"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { computeMinimumCurvature, getWellComponents, planBuildHold, summarizeTrajectory, wellComponentsToAssembly } from "@ikhmalputra/subsurface-core";
import type { BuildHoldInput, WellDesign, WellComponent, FormationLayer, WellOperations } from "@ikhmalputra/subsurface-core";
import { WellAssemblyBuilder } from "@ikhmalputra/subsurface-react/examples";
import { BuildHoldForm, SurveyTable, TrajectoryPlanView, TrajectorySectionView, TrajectorySummaryPanel } from "@ikhmalputra/subsurface-react/trajectory";
import { CommandButton, CommandIcon } from "@ikhmalputra/subsurface-react/ui";
import { wells } from "./wells-data";
import { useWorkspace } from "./workspace-provider";
import { WellSection } from "./well-section";
import { Pane, PaneGrid } from "@ikhmalputra/subsurface-shell";
import { useDepthLink } from "@ikhmalputra/subsurface-react";
import { assertWellDesign, assertWellOperations, editTrajectory, localLogUrl, mergeAssembly, parseWellRevision } from "../lib/well-revision";
import type { WellRevision } from "../lib/well-revision";

type EditTab = "construction" | "properties" | "trajectory" | "components" | "formations" | "records";
const tabs: readonly { id: EditTab; label: string }[] = [
  { id: "construction", label: "Construction" }, { id: "properties", label: "Well properties" },
  { id: "trajectory", label: "Trajectory" }, { id: "components", label: "Component records" },
  { id: "formations", label: "Formations" }, { id: "records", label: "Records & data" },
];

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
    <div className="demo-toolbar">
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

export function EditWellDemo() {
  const params = useSearchParams();
  const { well } = useWorkspace();
  const source = wells.find((entry) => entry.id === (params.get("well") ?? well.id));
  if (!source) return <section><h1>Edit well</h1><p role="alert">The requested well was not found. Select a well from View well to edit it.</p><Link className="sw-asm-button" href="/view-well/">Back to View well</Link></section>;
  return <WellEditor key={source.id} source={source} componentId={params.get("component")} />;
}

function WellEditor({ source, componentId }: { source: (typeof wells)[number]; componentId: string | null }) {
  const { store, revisions, applyRevision, restoreSource, assemblyDrafts, updateAssemblyDraft, chooseWell } = useWorkspace();
  // The editor's canvas is the builder; the section is its context view — the same spine as View
  // well and Trajectory, over the live revision, so an edit shows up against the log and the
  // survey one click away rather than on another page.
  const [view, setView] = useState<"edit" | "section">("edit");
  const link = useDepthLink(true, store);
  const revision = revisions[source.design.id] ?? { design: source.design, operations: source.operations ?? null, logUrl: source.logUrl ?? null };
  const { design } = revision;
  const [tab, setTab] = useState<EditTab>("construction");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [recordId, setRecordId] = useState(componentId ?? getWellComponents(design)[0]?.id ?? "");
  const [layerId, setLayerId] = useState(design.formations?.[0]?.id ?? "");
  const [probe, setProbe] = useState<number | null>(null);
  const [constructionTools, setConstructionTools] = useState<HTMLDivElement | null>(null);
  const appliedSelectionRequest = useRef<string | null>(null);
  useEffect(() => { chooseWell(source.id); }, [source.id, chooseWell]);
  const assembly = useMemo(() => wellComponentsToAssembly({ id: design.id, name: design.wellName ?? source.label, totalDepthM: design.totalDepthM, components: getWellComponents(design) }), [design, source.label]);
  const draft = assemblyDrafts[design.id];
  const selectedId = assembly.items.some((item) => item.id === componentId) ? componentId : null;
  useEffect(() => {
    const request = `${source.id}:${componentId ?? ""}`;
    if (appliedSelectionRequest.current === request) return;
    appliedSelectionRequest.current = request;
    if (draft && selectedId && draft.selectedId !== selectedId) updateAssemblyDraft(design.id, { ...draft, selectedId });
  }, [source.id, componentId, draft, selectedId, design.id, updateAssemblyDraft]);

  function apply(next: WellRevision, message: string, keepAssembly = false) {
    try {
      assertWellDesign(next.design);
      applyRevision(source.design.id, next);
      if (!keepAssembly) updateAssemblyDraft(design.id, { past: [], present: wellComponentsToAssembly({ id: design.id, name: next.design.wellName ?? source.label, totalDepthM: next.design.totalDepthM, components: getWellComponents(next.design) }), future: [], selectedId: null });
      setError(null);
      setStatus(message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      throw caught;
    }
  }
  function changeDesign(next: WellDesign) {
    try { apply({ ...revision, design: next }, "Applied to the active well revision."); } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  }
  function updateComponent(next: WellComponent) {
    changeDesign({ ...design, components: getWellComponents(design).map((component) => component.id === next.id ? next : component) });
  }
  function updateLayer(next: FormationLayer) {
    changeDesign({ ...design, formations: design.formations?.map((layer) => layer.id === next.id ? next : layer) });
  }
  const component = getWellComponents(design).find((item) => item.id === recordId) ?? getWellComponents(design)[0];
  const formation = design.formations?.find((item) => item.id === layerId) ?? design.formations?.[0];
  const stations = design.survey ?? [];
  const survey = useMemo(() => stations.length >= 2 ? computeMinimumCurvature(stations, { tieIn: stations[0] }) : [], [stations]);
  const summary = useMemo(() => survey.length >= 2 ? summarizeTrajectory(survey) : null, [survey]);
  const [planInput, setPlanInput] = useState<BuildHoldInput>({ kickoffMdM: 300, buildRateDegPer30m: 3, target: { tvdM: 1500, northingM: 300, eastingM: 300 }, extensionM: 0 });
  const [showPlan, setShowPlan] = useState(false);
  const plan = useMemo(() => {
    try { return { value: planBuildHold(planInput), error: null }; } catch (caught) { return { value: null, error: caught instanceof Error ? caught.message : String(caught) }; }
  }, [planInput]);
  return <div className="demo-edit-workspace">
    <header className="demo-edit-commandbar">
      <div className="demo-edit-identity"><span className="demo-eyebrow">WELL EDITOR</span><h1>Edit {design.wellName ?? source.label}</h1></div>
      <div className="demo-edit-actions">
        <div className="sw-asm-canvas-modes" role="group" aria-label="Editor view">
          <CommandButton kind="selection" type="button" aria-pressed={view === "edit"} onClick={() => setView("edit")}>Edit</CommandButton>
          <CommandButton kind="selection" type="button" aria-pressed={view === "section"} onClick={() => setView("section")}>Section</CommandButton>
        </div>
        <Link className="demo-edit-back" href={`/view-well/?well=${encodeURIComponent(source.id)}`}><CommandIcon name="previous" />Back to View well</Link>
        <CommandButton icon="download" onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(revision, null, 2)], { type: "application/json" }));
          const link = document.createElement("a"); link.href = url; link.download = `${source.id}-full-well-r${design.revision}.json`; link.click(); URL.revokeObjectURL(url);
          setStatus("Exported complete well, including trajectory, component records, formations and operational data.");
        }}>Export full well</CommandButton>
        <CommandButton icon="reset" aria-label="Restore original well" title="Restore original well" disabled={!revisions[design.id]} onClick={() => {
          if (!window.confirm("Restore the original well? This clears all active edits for this well.")) return;
          restoreSource(design.id); setError(null); setStatus("Original source restored.");
        }} />
      </div>
    </header>
    <section role="tabpanel" id="well-edit-panel" aria-labelledby={`well-edit-${tab}`} className={`demo-well-editor demo-edit-${tab}`}>
      <div className="demo-edit-workbench">
        <PaneGrid active={[view]} className="demo-edit-canvas">
          <Pane id="edit" className="demo-edit-canvas-pane"><WellAssemblyBuilder embedded workbench survey={design.survey} formations={design.formations} toolsContainer={constructionTools} onToolsRequested={() => setTab("construction")} assetBaseUrl="/well-components"
            editorState={draft ?? { past: [], present: assembly, future: [], selectedId }}
            onEditorStateChange={(state) => {
              const previous = draft?.present ?? assembly;
              if (state.present !== previous) apply({ ...revision, design: mergeAssembly(design, previous, state.present) }, "Construction applied to active well.", true);
              if (state.selectedId !== (draft?.selectedId ?? selectedId)) { setRecordId(state.selectedId ?? ""); setTab("construction"); }
              updateAssemblyDraft(design.id, state);
            }} /></Pane>
          <Pane id="section" deferUntilShown keep={false} className="demo-fill demo-section-pane">
            <WellSection assembly={draft?.present ?? assembly} components={getWellComponents(design)} survey={survey} stations={design.survey} formations={design.formations} totalDepthM={design.totalDepthM}
              operations={revision.operations} logUrl={revision.logUrl ?? undefined}
              selectedId={draft?.selectedId ?? selectedId} onSelect={(id) => { if (id) { setRecordId(id); if (draft) updateAssemblyDraft(design.id, { ...draft, selectedId: id }); } }}
              onSelectMd={(mdM) => link.pinCursor(mdM)} link={link} showFormations={false} />
          </Pane>
        </PaneGrid>
        <aside className="demo-edit-tool-panel" aria-label="Well editing tools">
          <div className="demo-edit-tabs" role="tablist" aria-label="Well editor">
            {tabs.map((item, index) => <CommandButton key={item.id} kind="selection" role="tab" id={`well-edit-${item.id}`} tabIndex={tab === item.id ? 0 : -1} aria-selected={tab === item.id} aria-controls="well-edit-panel" onClick={() => setTab(item.id)} onKeyDown={(event) => {
              const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % tabs.length : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
              if (next === null) return;
              event.preventDefault(); setTab(tabs[next]!.id);
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
            }}>{item.label}</CommandButton>)}
          </div>
          {error && <p role="alert" className="demo-reject demo-edit-error">{error}</p>}
          <div className="demo-edit-tool-content">
          <div ref={setConstructionTools} hidden={tab !== "construction"} />
          {tab === "properties" && <div className="demo-edit-inspector">
        <div className="demo-edit-panehead"><h2>Well properties</h2><span>m · MD / TVD</span></div>
        <p className="demo-edit-hint">Apply a field with Enter or by leaving it. The drawing updates immediately.</p>
        <section className="demo-panel demo-well-fields" aria-label="Well properties">
          <h3 className="demo-edit-fieldgroup">Identity &amp; datum</h3>
          <EditField label="Well name" value={design.wellName ?? source.label} onChange={(wellName) => changeDesign({ ...design, wellName })} />
          <EditField label="Depth datum" value={design.depthDatum} onChange={(depthDatum) => changeDesign({ ...design, depthDatum })} />
          <h3 className="demo-edit-fieldgroup">Depth &amp; elevation</h3>
          <EditField label="Total depth (m MD)" type="number" value={design.totalDepthM} onChange={(value) => changeDesign({ ...design, totalDepthM: value.trim() ? Number(value) : NaN })} />
          <EditField label="Casing bottom (m MD)" type="number" value={design.casingBottomM} onChange={(value) => changeDesign({ ...design, casingBottomM: value.trim() ? Number(value) : NaN })} />
          <EditField label="Reference elevation (m MSL)" type="number" value={design.referenceElevationMslM} onChange={(value) => changeDesign({ ...design, referenceElevationMslM: value.trim() ? Number(value) : undefined })} />
          <EditField label="Ground depth (m TVD)" type="number" value={design.groundTvdM} onChange={(value) => changeDesign({ ...design, groundTvdM: value.trim() ? Number(value) : undefined })} />
          <h3 className="demo-edit-fieldgroup">Trajectory description</h3>
          <EditField label="Trajectory name" value={design.trajectoryName} onChange={(trajectoryName) => changeDesign({ ...design, trajectoryName })} />
          <EditField label="Trajectory note" value={design.trajectoryNote} onChange={(trajectoryNote) => changeDesign({ ...design, trajectoryNote })} />
        </section>
        <details className="demo-edit-advanced"><summary>All well fields and source metadata</summary><JsonEditor key={design.revision} label="well fields" value={design} onApply={(value) => { assertWellDesign(value); if (value.id !== design.id) throw new Error("Well ID is immutable."); apply({ ...revision, design: value }, "All well fields applied."); }} /></details>
          </div>}
      {tab === "trajectory" && <>
        <div className="demo-edit-panehead"><h2>Trajectory</h2><CommandButton icon="create" aria-expanded={showPlan} onClick={() => setShowPlan(!showPlan)}>Plan build &amp; hold</CommandButton></div>
        <p className="demo-edit-hint">Edit MD, inclination and azimuth to recompute the path. Original tie-in retained; construction is not trimmed.</p>
        {showPlan && <section className="demo-panel"><BuildHoldForm value={planInput} onChange={setPlanInput} plan={plan.value} error={plan.error} /><CommandButton icon="apply" disabled={!plan.value} onClick={() => {
          try {
            if (!plan.value) return;
            const first = design.survey?.[0];
            if (first && first.mdM !== 0) throw new Error("Build & hold starts at 0 m MD. Edit the existing stations to retain this non-zero source tie-in.");
            apply({ ...revision, design: editTrajectory(design, plan.value.stations) }, "Build & hold trajectory applied.");
          } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
        }}>Apply trajectory plan</CommandButton></section>}
        {summary && <><div className="demo-edit-trajectory-charts"><TrajectoryPlanView survey={survey} selectedMdM={probe} onSelectMd={setProbe} /><TrajectorySectionView survey={survey} selectedMdM={probe} onSelectMd={setProbe} verticalSectionAzimuthDeg={summary.closureAzimuthDeg} formations={design.formations} /></div>
          <TrajectorySummaryPanel summary={summary} /><SurveyTable survey={survey} selectedMdM={probe} onSelectMd={setProbe} onChange={(next) => {
            try { apply({ ...revision, design: editTrajectory(design, next) }, "Survey stations applied to active trajectory."); } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
          }} /></>}
        {!summary && <p>No survey supplied. Create a trajectory with the planner.</p>}
      </>}
      {tab === "components" && <div className="demo-edit-inspector"><div className="demo-edit-panehead"><h2>Component records</h2><span>{getWellComponents(design).length} records</span></div>
        <section className="demo-panel"><label><span>Component record</span><select aria-label="Component record" value={component?.id ?? ""} onChange={(event) => setRecordId(event.target.value)}>{getWellComponents(design).map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label>
          {component && <div className="demo-well-fields">
            {(["name", "material", "description"] as const).map((key) => <EditField key={key} label={`Component ${key}`} value={component[key]} onChange={(value) => updateComponent({ ...component, [key]: value })} />)}
            {([{ key: "topDepthM", label: "Top depth (m MD)" }, { key: "bottomDepthM", label: "Bottom depth (m MD)" }, { key: "outerDiameterMm", label: "Outside diameter (mm)" }, { key: "innerDiameterMm", label: "Inside diameter (mm)" }] as const).map(({ key, label }) => <EditField key={key} label={label} type="number" value={component[key]} onChange={(value) => updateComponent({ ...component, [key]: value.trim() ? Number(value) : key.includes("Diameter") ? null : NaN })} />)}
          </div>}
        </section>
        <details className="demo-edit-advanced"><summary>All component fields, parent links and provenance</summary><JsonEditor key={design.revision} label="component records" value={getWellComponents(design)} onApply={(components) => {
          const next = { ...design, components }; assertWellDesign(next); apply({ ...revision, design: next }, "Component register applied.");
        }} /></details>
      </div>}
      {tab === "formations" && <div className="demo-edit-inspector"><div className="demo-edit-panehead"><h2>Formations</h2><span>TVD intervals</span></div>
        <section className="demo-panel"><label><span>Formation</span><select aria-label="Formation" value={formation?.id ?? ""} onChange={(event) => setLayerId(event.target.value)}>{design.formations?.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select></label>
          {formation && <div className="demo-well-fields">
            {(["name", "lithology", "interpretation"] as const).map((key) => <EditField key={key} label={`Formation ${key}`} value={formation[key]} onChange={(value) => updateLayer({ ...formation, [key]: value })} />)}
            {([{ key: "topTvdM", label: "Top depth (m TVD)" }, { key: "bottomTvdM", label: "Bottom depth (m TVD)" }, { key: "densityKgM3", label: "Density (kg/m3)" }, { key: "porosityPct", label: "Porosity (%)" }] as const).map(({ key, label }) => <EditField key={key} label={label} type="number" value={formation[key]} onChange={(value) => updateLayer({ ...formation, [key]: value.trim() ? Number(value) : key === "densityKgM3" || key === "porosityPct" ? null : NaN })} />)}
            <EditField label="Formation color" type="color" value={formation.color} onChange={(color) => updateLayer({ ...formation, color })} />
          </div>}
        </section>
        <details className="demo-edit-advanced"><summary>Advanced formation register</summary><JsonEditor key={design.revision} label="formation register" value={design.formations ?? []} onApply={(formations) => {
          const next = { ...design, formations }; assertWellDesign(next); apply({ ...revision, design: next }, "Formation register applied.");
        }} /></details>
      </div>}
      {tab === "records" && <>
        <section className="demo-panel"><EditField label="Mud-log file path (same origin)" value={revision.logUrl} onChange={(value) => {
          try { apply({ ...revision, logUrl: localLogUrl(value) }, "Mud-log data source applied."); } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
        }} /><p>Operational tables retain their reported units and source citations. Edit them below; unknown values remain null. Raw seismic files remain immutable source assets, not editable voxel data.</p></section>
        {revision.operations && <OperationalEditor operations={revision.operations} onChange={(operations) => {
          try { apply({ ...revision, operations }, "Operational record applied."); } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
        }} />}
        <details><summary>Advanced operational register, citations and new records</summary>
        <JsonEditor key={`operations-${design.revision}`} label="operational records" value={revision.operations} onApply={(operations) => {
          if (operations !== null) { assertWellOperations(operations); if (operations.wellId !== design.id) throw new Error("Records must belong to this well."); }
          apply({ ...revision, operations }, "Operational records applied.");
        }} />
        </details>
        <details><summary>Import or edit a complete well revision</summary><JsonEditor key={`full-${design.revision}`} label="full well revision" value={revision} onApply={(value) => apply(parseWellRevision(JSON.stringify(value), design.id), "Complete well revision applied.")} /></details>
      </>}
          </div>
        </aside>
      </div>
    </section>
    <footer className="demo-edit-statusbar"><span className="demo-edit-revision">{revisions[design.id] ? `User-authored revision ${design.revision}` : "Original source"}</span><span role="status">{status ?? "Ready · edits apply to the active well"}</span><details><summary>Revision &amp; storage</summary><p>The original source is preserved. Edits stay in memory across navigation; export the full well to keep them after reload. Construction undo/redo covers assembly edits only.</p></details></footer>
  </div>;
}
