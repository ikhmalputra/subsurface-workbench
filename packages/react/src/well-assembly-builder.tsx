"use client";

import { lazy, Suspense, useMemo, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { KeyboardEvent } from "react";
import { createAssembly, exampleAssembly, moveComponent, placeComponent, removeComponent, setAssemblyTotalDepth, suggestPlacementDepth, updateComponent, validateAssembly } from "@ikhmalputra/subsurface-core";
import type { AssemblyItemPatch, FormationLayer, SurveyPoint, WellAssembly } from "@ikhmalputra/subsurface-core";
import { Download, FilePlus2, Pencil, Redo2, Sparkles, Undo2 } from "lucide-react";
import { ComponentPalette } from "./assembly-palette.js";
import { AssemblySchematic } from "./assembly-schematic.js";
import { CurvedAssemblySchematic } from "./curved-assembly-schematic.js";
import { AssemblyInspector, AssemblyIssueList } from "./assembly-inspector.js";
import { CommandButton } from "./ui.js";

const AssemblyScene = lazy(() => import("./assembly-scene.js"));

export interface WellAssemblyEditorState {
  readonly past: readonly WellAssembly[];
  readonly present: WellAssembly;
  readonly future: readonly WellAssembly[];
  readonly selectedId: string | null;
}
type Action = { type: "commit"; value: WellAssembly; selectedId?: string | null } | { type: "undo" } | { type: "redo" } | { type: "reset"; value: WellAssembly } | { type: "select"; id: string | null };

function reducer(state: WellAssemblyEditorState, action: Action): WellAssemblyEditorState {
  switch (action.type) {
    case "commit": return action.value === state.present ? state : { past: [...state.past, state.present].slice(-80), present: action.value, future: [], selectedId: action.selectedId === undefined ? state.selectedId : action.selectedId };
    case "undo": return state.past.length ? { ...state, past: state.past.slice(0, -1), present: state.past.at(-1)!, future: [state.present, ...state.future] } : state;
    case "redo": return state.future.length ? { ...state, past: [...state.past, state.present], present: state.future[0]!, future: state.future.slice(1) } : state;
    case "reset": return { past: [...state.past, state.present].slice(-80), present: action.value, future: [], selectedId: null };
    case "select": return state.selectedId === action.id ? state : { ...state, selectedId: action.id };
  }
}

export interface WellAssemblyBuilderProps {
  /** URL where the package's `assets/well-components` folder is served. */
  readonly assetBaseUrl: string;
  readonly initialAssembly?: WellAssembly;
  readonly initialSelectedId?: string | null;
  readonly onChange?: (assembly: WellAssembly) => void;
  /** Host-owned working copy, selection and undo/redo history. Supply both controlled props together. */
  readonly editorState?: WellAssemblyEditorState;
  readonly onEditorStateChange?: (state: WellAssemblyEditorState) => void;
  /** Embed in a host editor that owns well identity, source restoration and full-well export. */
  readonly embedded?: boolean;
  /** Drawing-first layout with construction tools in a side dock. */
  readonly workbench?: boolean;
  readonly survey?: readonly SurveyPoint[];
  readonly formations?: readonly FormationLayer[];
  /** Optional host dock, kept mounted while switching tools. */
  readonly toolsContainer?: HTMLElement | null;
  readonly onToolsRequested?: () => void;
}

/** Reference composition of the assembly capabilities. Copy it, or compose the pieces yourself. */
export function WellAssemblyBuilder({ assetBaseUrl, initialAssembly, initialSelectedId = null, onChange, editorState, onEditorStateChange, embedded = false, workbench = false, survey, formations, toolsContainer, onToolsRequested }: WellAssemblyBuilderProps) {
  const [localHistory, dispatch] = useReducer(reducer, undefined, () => ({ past: [], present: initialAssembly ?? exampleAssembly(), future: [], selectedId: initialSelectedId }));
  const history = editorState ?? localHistory;
  const selectedId = history.present.items.some((item) => item.id === history.selectedId) ? history.selectedId : null;
  const componentSelect = useRef<HTMLSelectElement>(null);
  const [show3d, setShow3d] = useState(false);
  const [canvasMode, setCanvasMode] = useState<"curved" | "schematic">("curved");
  const [showFormations, setShowFormations] = useState(false);
  const [tool, setTool] = useState<"properties" | "library" | "checks">("properties");
  const [status, setStatus] = useState<{ text: string; tone: "ok" | "error" }>({ text: "Select a component in the drawing or Edit properties to change its label, depths and sizes. Add new parts from the library.", tone: "ok" });
  const assembly = history.present;
  const issues = useMemo(() => validateAssembly(assembly), [assembly]);
  const errors = issues.filter((issue) => issue.severity === "error").length;
  if ((editorState === undefined) !== (onEditorStateChange === undefined)) throw new Error("WellAssemblyBuilder requires editorState and onEditorStateChange together.");

  function apply(action: Action) {
    const next = reducer(history, action);
    if (next === history) return;
    if (editorState === undefined) dispatch(action);
    onEditorStateChange?.(next);
    if (next.present !== history.present) onChange?.(next.present);
  }
  const setSelectedId = (id: string | null) => apply({ type: "select", id });
  function commit(value: WellAssembly, text: string, selection = history.selectedId) {
    apply({ type: "commit", value, selectedId: selection });
    setStatus({ text, tone: "ok" });
  }
  function attempt(work: () => void) {
    try { work(); } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), tone: "error" }); }
  }
  const place = (catalogId: string, depthM: number) => attempt(() => {
    const result = placeComponent(assembly, catalogId, depthM);
    commit(result.assembly, result.note, result.itemId);
    if (workbench) { setTool("properties"); onToolsRequested?.(); }
  });
  const move = (itemId: string, depthM: number) => attempt(() => {
    const next = moveComponent(assembly, itemId, depthM);
    const item = next.items.find((value) => value.id === itemId)!;
    commit(next, `${item.label} moved: ${Math.round(item.topM)}–${Math.round(item.bottomM)} m MD.`);
  });
  const remove = (itemId: string) => attempt(() => {
    const label = assembly.items.find((value) => value.id === itemId)?.label ?? itemId;
    const next = removeComponent(assembly, itemId);
    const dependents = assembly.items.length - next.items.length - 1;
    commit(next, `${label} removed${dependents > 0 ? ` with ${dependents} attached component${dependents > 1 ? "s" : ""}` : ""}.`, null);
  });
  const update = (itemId: string, patch: AssemblyItemPatch) => {
    const next = updateComponent(assembly, itemId, patch);
    commit(next, `${next.items.find((value) => value.id === itemId)!.label} updated.`);
  };
  function exportJson() {
    const blob = new Blob([JSON.stringify(assembly, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${assembly.name.replace(/[^\w-]+/g, "-").toLowerCase()}-r${assembly.revision}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    setStatus({ text: `Exported revision ${assembly.revision} as JSON.`, tone: "ok" });
  }
  function shortcuts(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("input, textarea")) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      apply({ type: event.shiftKey ? "redo" : "undo" });
      setStatus({ text: event.shiftKey ? "Redone." : "Undone.", tone: "ok" });
    }
  }

  const inspector = <aside className="sw-asm-side">
    <label className="sw-asm-edit-select">Component to edit
      <select ref={componentSelect} value={selectedId ?? ""} onChange={(event) => setSelectedId(event.target.value || null)}>
        <option value="">Select a component</option>
        {assembly.items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    </label>
    <AssemblyInspector assembly={assembly} assetBaseUrl={assetBaseUrl} selectedId={selectedId} issues={issues} onUpdate={update} onRemove={remove} />
    <AssemblyIssueList issues={issues} onSelect={setSelectedId} />
    <p className="sw-asm-disclaimer">Illustrative Blender renders and nominal sizes. Rule checks are teaching aids, not an engineering approval.</p>
  </aside>;
  const palette = <ComponentPalette assetBaseUrl={assetBaseUrl} onAdd={(catalogId) => place(catalogId, suggestPlacementDepth(assembly, catalogId, selectedId ?? undefined))} />;
  const tools = <div className="sw-asm-dock">
    {!embedded && <details className="sw-asm-draft-tools"><summary>Draft &amp; export</summary>
      <label>Well name<input value={assembly.name} onChange={(event) => { if (event.target.value.trim()) apply({ type: "commit", value: { ...assembly, name: event.target.value } }); }} /></label>
      <label>TD (m MD)<input key={assembly.totalDepthM} type="number" defaultValue={assembly.totalDepthM} min={50} step={10} onBlur={(event) => attempt(() => { const value = Number(event.target.value); if (value !== assembly.totalDepthM) commit(setAssemblyTotalDepth(assembly, value), `Total depth set to ${value} m.`); })} /></label>
      <CommandButton onClick={() => { apply({ type: "reset", value: createAssembly({ name: "New well", totalDepthM: assembly.totalDepthM }) }); setStatus({ text: "Blank well. Add parts from the side dock.", tone: "ok" }); }}><FilePlus2 size={15} />Blank well</CommandButton>
      <CommandButton onClick={() => apply({ type: "reset", value: exampleAssembly(assembly.totalDepthM) })}><Sparkles size={15} />Example</CommandButton>
      <CommandButton onClick={exportJson}><Download size={15} />Export JSON</CommandButton>
    </details>}
    <div className="sw-asm-dock-tabs" role="group" aria-label="Construction tools">
      {(["properties", "library", "checks"] as const).map((value) => <CommandButton kind="selection" key={value} aria-pressed={tool === value} onClick={() => setTool(value)}>{value === "properties" ? "Properties" : value === "library" ? "Add parts" : "Checks"}</CommandButton>)}
    </div>
    <div hidden={tool !== "properties"}>{inspector}</div>
    <div hidden={tool !== "library"}>{palette}</div>
    {tool === "checks" && <AssemblyIssueList issues={issues} onSelect={(id) => { setSelectedId(id); setTool("properties"); }} />}
  </div>;
  const selectInCanvas = (id: string | null) => { setSelectedId(id); if (id !== null) { setTool("properties"); onToolsRequested?.(); } };
  return <div className={`sw-asm${embedded ? " sw-asm-embedded" : ""}${workbench ? " sw-asm-workbench" : ""}${toolsContainer ? " sw-asm-host-dock" : ""}`} onKeyDown={shortcuts}>
    <header className="sw-asm-bar">
      {!embedded && !workbench && <><div className="sw-asm-title"><small>WELL BUILDER · PLUG-AND-PLAY ASSEMBLY</small>
        <label><span className="sw-asm-sr">Well name</span><input value={assembly.name} onChange={(event) => { if (event.target.value.trim()) apply({ type: "commit", value: { ...assembly, name: event.target.value } }); }} /></label>
      </div>
      <label className="sw-asm-td">TD (m MD)<input key={assembly.totalDepthM} type="number" defaultValue={assembly.totalDepthM} min={50} step={10} onBlur={(event) => attempt(() => { const value = Number(event.target.value); if (value !== assembly.totalDepthM) commit(setAssemblyTotalDepth(assembly, value), `Total depth set to ${value} m.`); })} onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }} /></label></>}
      <span className="sw-asm-rev" data-testid="assembly-revision">Rev {assembly.revision} · {assembly.items.length} parts · {errors ? `${errors} errors` : "no errors"}</span>
      <div className="sw-asm-bar-actions">
        {workbench && <div className="sw-asm-canvas-modes" role="group" aria-label="Canvas view">
          <CommandButton kind="selection" aria-pressed={!show3d && canvasMode === "curved"} onClick={() => { setShow3d(false); setCanvasMode("curved"); }}>Curved</CommandButton>
          <CommandButton kind="selection" aria-pressed={!show3d && canvasMode === "schematic"} onClick={() => { setShow3d(false); setCanvasMode("schematic"); }}>Schematic</CommandButton>
          <CommandButton kind="selection" aria-pressed={show3d} onClick={() => setShow3d(true)}>3D view</CommandButton>
          <CommandButton kind="selection" aria-pressed={showFormations} disabled={show3d || !formations?.length} onClick={() => setShowFormations((value) => !value)} title={show3d ? "Formation layers are available in the 2D views" : !formations?.length ? "No formation data supplied" : "Show or hide formation layers"}>Formations</CommandButton>
        </div>}
        <CommandButton type="button" className="sw-asm-button" onClick={() => { setTool("properties"); onToolsRequested?.(); setSelectedId(assembly.items.some((item) => item.id === selectedId) ? selectedId : assembly.items[0]?.id ?? null); requestAnimationFrame(() => componentSelect.current?.focus()); }} disabled={!assembly.items.length}><Pencil size={15} /> Edit properties</CommandButton>
        {!workbench && <CommandButton icon="view" type="button" className="sw-asm-button" aria-pressed={show3d} onClick={() => setShow3d((value) => !value)}>3D view</CommandButton>}
        <CommandButton type="button" className="sw-asm-button" onClick={() => apply({ type: "undo" })} disabled={!history.past.length} aria-label="Undo"><Undo2 size={15} /></CommandButton>
        <CommandButton type="button" className="sw-asm-button" onClick={() => apply({ type: "redo" })} disabled={!history.future.length} aria-label="Redo"><Redo2 size={15} /></CommandButton>
        {!embedded && !workbench && <><CommandButton type="button" className="sw-asm-button" onClick={() => { apply({ type: "reset", value: createAssembly({ name: "New well", totalDepthM: assembly.totalDepthM }) }); setStatus({ text: "Blank well. Start with a wellhead, then drag casing strings in from the library.", tone: "ok" }); }}><FilePlus2 size={15} /> Blank well</CommandButton>
        <CommandButton type="button" className="sw-asm-button" onClick={() => { apply({ type: "reset", value: exampleAssembly(assembly.totalDepthM) }); setStatus({ text: "Loaded the example producer.", tone: "ok" }); }}><Sparkles size={15} /> Example</CommandButton>
        <CommandButton type="button" className="sw-asm-button is-primary" onClick={exportJson}><Download size={15} /> Export JSON</CommandButton></>}
      </div>
    </header>
    <p className={`sw-asm-status${status.tone === "error" ? " is-error" : ""}`} role="status" aria-live="polite" data-testid="assembly-status">{status.text}</p>
    <div className={`sw-asm-grid${show3d ? " has-3d" : ""}`}>
      {!workbench && palette}
      {workbench && !show3d && canvasMode === "curved" ? <CurvedAssemblySchematic assembly={assembly} survey={survey} formations={showFormations ? formations : undefined} assetBaseUrl={assetBaseUrl} selectedId={selectedId} issues={issues} onSelect={selectInCanvas} onDropComponent={place} onMoveComponent={move} onRemoveComponent={remove} />
        : (!workbench || !show3d) && <AssemblySchematic assembly={assembly} survey={survey} formations={showFormations ? formations : undefined} assetBaseUrl={assetBaseUrl} selectedId={selectedId} issues={issues} onSelect={selectInCanvas} onDropComponent={place} onMoveComponent={move} onRemoveComponent={remove} />}
      {!workbench && inspector}
      {workbench && (toolsContainer ? createPortal(tools, toolsContainer) : tools)}
      {show3d && <Suspense fallback={<section className="sw-asm-scene" aria-label="3D assembly"><p className="sw-asm-scene-failure">Loading 3D…</p></section>}>
        <AssemblyScene assembly={assembly} assetBaseUrl={assetBaseUrl} selectedId={selectedId} onSelect={selectInCanvas} onDropComponent={place} onMoveComponent={move} />
      </Suspense>}
    </div>
  </div>;
}
