"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { designWithTrajectory, getWellComponents, metresToFeet, positionAtMeasuredDepth, sectionAtDepth, summarizeTrajectory, validateWellboreTrajectory, wellComponentsToAssembly } from "@ikhmalputra/subsurface-core";
import { designSurvey } from "../lib/well-data";
import { createMockLogCurve } from "@ikhmalputra/subsurface-core/sandbox";
import { createInitialSubsurfaceState } from "@ikhmalputra/subsurface-core/state";
import { browserStateUrlHost, syncStateToUrl } from "@ikhmalputra/subsurface-core/state-url";
import { useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";
import { ComponentInventory, useDepthLink } from "@ikhmalputra/subsurface-react";
import { AssemblySchematic } from "@ikhmalputra/subsurface-react/assembly";
import { CurvedAssemblySchematic } from "@ikhmalputra/subsurface-react/assembly";
import { CurvedSchematic } from "@ikhmalputra/subsurface-react/schematic";
import { InteractiveViewport } from "@ikhmalputra/subsurface-react/viewport";
import { TrajectoryLog, TrajectoryPlanView, TrajectorySectionView } from "@ikhmalputra/subsurface-react/trajectory";
import { WellFile } from "./well-file";
import { WellSection } from "./well-section";
import { FloatingPanel, FloatingToolbar } from "./floating";
import { useTools } from "./tools";
import { planDraft, tryPlan } from "../lib/trajectory-draft";
import { studyHighlights } from "../lib/study-draft";
import { mergeAssembly } from "../lib/well-revision";
import { WellAssemblyBuilder } from "@ikhmalputra/subsurface-react/examples";
import type { BuildHoldInput } from "@ikhmalputra/subsurface-core";
import { WellSeismicSection, useSceneSeismic, useSegy, useWellOnSection } from "./well-seismic";
import { RecordCard, useWell, wells } from "./wells";
import { InterpretationControls } from "./interpretation-controls";
import { useWorkspace } from "./workspace-provider";
import { CommandButton } from "@ikhmalputra/subsurface-react/ui";
import { Pane, PaneGrid } from "@ikhmalputra/subsurface-shell";

const AssemblyScene = dynamic(() => import("@ikhmalputra/subsurface-react/assembly-three"), { ssr: false, loading: () => <div className="sw-scene-loading">Loading Blender assembly…</div> });
const WellScene = dynamic(() => import("@ikhmalputra/subsurface-react/three"), { ssr: false, loading: () => <div className="sw-scene-loading">Loading 3D well…</div> });

/** Percent of each volume axis kept, from its start: 100 is uncut. */
interface VolumeCuts { readonly along: number; readonly offset: number; readonly depth: number }
const FULL_VOLUME: VolumeCuts = { along: 100, offset: 100, depth: 100 };
const cutAt = (start: number, end: number, percent: number) => start + (end - start) * Math.max(percent, 2) / 100;

type Layout = "section" | "edit" | "split" | "seismic" | "earth" | "schematic" | "scene" | "curved" | "profile" | "trajectory" | "well3d";

/** The seven panes this route can show. A preset is a set of them, not an alternative to them. */
type PaneId = "wellsection" | "edit" | "curved" | "profile" | "schematic" | "seismic" | "earth" | "survey" | "well3d" | "cutaway" | "plan" | "section";

/**
 * Which panes each preset shows.
 *
 * These were seven mutually exclusive `&&` branches, so every change of view unmounted the drawing,
 * the 3D scene and the seismic section and rebuilt them: zoom, depth window, camera and the lazily
 * imported renderer all discarded, and the SEG-Y refetched. The sets were always sets — "2.5D + 3D"
 * is two panes — the interface just could not say so.
 */
const panesFor: Readonly<Record<Layout, readonly PaneId[]>> = {
  // One depth axis with the construction, the mud log and the survey as tracks on it. The other
  // presets are alternatives; this is the one where the depth link can actually be seen.
  section: ["wellsection"],
  // The builder over the active revision: its parts and properties are the Construction tool.
  edit: ["edit"],
  curved: ["curved"],
  profile: ["profile"],
  schematic: ["schematic"],
  split: ["schematic", "cutaway"],
  seismic: ["schematic", "seismic"],
  earth: ["earth", "survey"],
  scene: ["cutaway"],
  // The directional picture of the well that is already active, in the workspace that owns it.
  // The surveyed path was rendered by five different component sets across four routes; a reader
  // asking where this well goes had to leave the well to find out.
  trajectory: ["plan", "section", "survey"],
  // The well alone in 3D: path coloured by dogleg severity, formations, the planner's target, a
  // probe that pins depth. What the trajectory workspace's 3D view was.
  well3d: ["well3d"],
};

const layouts: readonly { value: Layout; label: string }[] = [
  { value: "section", label: "Well section · construction, log & survey" },
  { value: "edit", label: "Edit · builder canvas" },
  { value: "split", label: "2.5D + 3D" },
  { value: "seismic", label: "2.5D + seismic" },
  { value: "earth", label: "3D well + seismic + survey" },
  { value: "schematic", label: "2.5D schematic" },
  { value: "scene", label: "3D cutaway" },
  { value: "curved", label: "Curved construction" },
  { value: "profile", label: "Survey & interval data" },
  { value: "trajectory", label: "Trajectory plan & section" },
  { value: "well3d", label: "3D well · path, DLS & formations" },
];

export function ViewWellDemo() {
  const { store, well: workspaceWell, revisions } = useWorkspace();
  const active = useSubsurfaceSelector(store, (state) => state.activeAsset);
  const slices = useSubsurfaceSelector(store, (state) => state.seismicSlices);
  const interpretation = useSubsurfaceSelector(store, (state) => state.interpretation);
  const [picking, setPicking] = useState<"cpu" | "gpu">("cpu");
  const camera = useSubsurfaceSelector(store, (state) => state.viewState);
  const [automaticCamera] = useState(() => createInitialSubsurfaceState().viewState);
  const cameraIsAutomatic = camera.zoom === automaticCamera.zoom && camera.position.every((value, i) => value === automaticCamera.position[i]) && camera.target.every((value, i) => value === automaticCamera.target[i]);
  const wellId = workspaceWell.id;
  const [linkError, setLinkError] = useState<string | null>(null);
  // The link validation reads the live revisions through a ref: re-running the URL sync on every
  // revision re-read the URL's state and clobbered a selection the builder had just made.
  const revisionsRef = useRef(revisions);
  revisionsRef.current = revisions;
  useLayoutEffect(() => {
    const url = new URL(window.location.href);
    const requestedId = url.searchParams.has("sw.v") ? null : url.searchParams.get("well");
    const requested = wells.find((entry) => entry.id === requestedId || entry.design.id === requestedId);
    if (requestedId && !requested) {
      setLinkError(`Unknown linked well: ${requestedId}`);
    }
    // The URL names the well once; this runs again on every revision (to re-validate the linked
    // component against it), and must not clear a selection the builder just made.
    if (requested && requested.design.id !== store.getState().activeAsset.wellId) {
      store.focusAsset(requested.design.id, null, "url");
    }
    const host = browserStateUrlHost();
    return syncStateToUrl(store, {
    host: {
      ...host,
      replace: (value) => {
        const link = new URL(value);
        const selected = wells.find((entry) => entry.design.id === store.getState().activeAsset.wellId);
        if (selected) link.searchParams.set("well", selected.id);
        host.replace(link.href);
      },
      read: () => {
        const link = new URL(host.read());
        const ids = link.searchParams.getAll("sw.well");
        const entry = ids.length === 1 ? wells.find((well) => well.id === ids[0]) : undefined;
        if (entry) link.searchParams.set("sw.well", entry.design.id);
        return link.href;
      },
    },
    onError: (error) => setLinkError(error instanceof Error ? error.message : String(error)),
    validateState: (state) => {
      const { wellId, componentId } = state.activeAsset;
      const well = wells.find((entry) => entry.design.id === wellId);
      if (wellId !== null && !well) throw new Error(`Unknown linked well: ${wellId}`);
      if (componentId !== null && well && !getWellComponents(revisionsRef.current[well.design.id]?.design ?? well.design).some((component) => component.id === componentId)) throw new Error(`Unknown linked component: ${componentId}`);
      const curveId = state.interpretation?.logStyle?.curveId;
      if (curveId && curveId !== "synthetic-porosity") throw new Error(`Unknown linked log: ${curveId}`);
    },
    fallbackState: () => {
      const initial = createInitialSubsurfaceState();
      const wellId = new URL(window.location.href).searchParams.get("well");
      const requested = wells.find((well) => well.id === wellId || well.design.id === wellId);
      return { ...initial, activeAsset: { ...initial.activeAsset, wellId: requested?.design.id ?? store.getState().activeAsset.wellId } };
    },
    });
  }, [store]);
  // The section opens first. It is the view in which the schematic is the centre and every other
  // record is read against it; the drawings and the 3D views are alternative renderings of the
  // same construction and sit one click away in the same strip.
  const [layoutChoice, setLayout] = useState<Layout>("section");
  const [showFormations, setShowFormations] = useState(false);
  const [sectionMode, setSectionMode] = useState<"construction" | "depth" | "trajectory">("trajectory");
  const { design: sourceDesign, components, operations, logUrl, seismic } = useWell(wellId);
  // A trajectory draft — the planner's or the station editor's — is drawn in place of the source
  // survey until it is applied or discarded, with the construction unchanged.
  const { trajectoryDrafts, updateTrajectoryDraft, studyDrafts, applyRevision, assemblyDrafts, updateAssemblyDraft } = useWorkspace();
  const draft = trajectoryDrafts[sourceDesign.id];
  const design = useMemo(() => draft ? designWithTrajectory(sourceDesign, draft.stations, draft.mode === "plan" ? { name: "Build & hold plan", note: "Planned trajectory, shown as a preview; not applied." } : { name: "Edited stations", note: "Edited stations, shown as a preview; not applied." }) : sourceDesign, [sourceDesign, draft]);
  const plan = useMemo(() => draft?.mode === "plan" ? tryPlan(draft.plan).plan : null, [draft]);
  const planMarkers = useMemo(() => plan && draft ? [{ mdM: draft.plan.kickoffMdM, label: "KOP" }, { mdM: plan.endOfBuildMdM, label: "EOB" }, { mdM: plan.targetMdM, label: "Target" }].filter((marker) => marker.mdM >= 0) : [], [plan, draft]);
  const moveTarget = (target: BuildHoldInput["target"]) => { if (!draft) return; const next = planDraft({ ...draft.plan, target }, draft); if (next) updateTrajectoryDraft(sourceDesign.id, next); };
  const layout: Layout = (layoutChoice === "seismic" || layoutChoice === "earth") && !seismic ? "schematic" : layoutChoice;
  const link = useDepthLink(true, store);
  const panes = panesFor[layout];
  // A pane that has been opened keeps its data as well as its DOM: the fetch gates stay open once
  // a pane has been shown, so returning to it does not put it back into a loading state. The loads
  // are cached per URL, so this costs nothing after the first time.
  const opened = useRef(new Set<PaneId>());
  for (const pane of panes) opened.current.add(pane);
  const everOpened = (pane: PaneId) => opened.current.has(pane);
  const segy = useSegy(everOpened("seismic") ? seismic?.url : undefined);
  const wellPath = useWellOnSection(design.survey ?? [], seismic);
  const earth = useSceneSeismic(seismic, everOpened("earth"));
  const [volumeMode, setVolumeMode] = useState<"solid" | "render">("solid");
  const cuts: VolumeCuts = useMemo(() => {
    const volume = earth.volume;
    if (!volume) return FULL_VOLUME;
    const percent = (value: number | null, min: number, max: number) => value === null ? 100 : Math.max(2, Math.min(100, (value - min) / (max - min) * 100));
    return {
      along: percent(slices.inline, volume.alongStartM, volume.alongEndM),
      offset: percent(slices.crossline, volume.offsetStartM, volume.offsetEndM),
      depth: percent(slices.time_depth, design.groundTvdM ?? 0, volume.baseTvdM),
    };
  }, [earth.volume, slices, design.groundTvdM]);
  const [threshold, setThreshold] = useState(50);
  const volumeView = useMemo(() => earth.volume ? {
    mode: volumeMode,
    threshold: threshold / 100,
    alongM: [earth.volume.alongStartM, cutAt(earth.volume.alongStartM, earth.volume.alongEndM, cuts.along)] as const,
    offsetM: [earth.volume.offsetStartM, cutAt(earth.volume.offsetStartM, earth.volume.offsetEndM, cuts.offset)] as const,
    tvdM: [design.groundTvdM ?? 0, cutAt(design.groundTvdM ?? 0, earth.volume.baseTvdM, cuts.depth)] as const,
  } : undefined, [earth.volume, volumeMode, threshold, cuts, design.groundTvdM]);
  const survey = designSurvey(design);
  const porosity = useMemo(() => {
    const stations = design.survey?.length ? design.survey : [positionAtMeasuredDepth(design, 0), positionAtMeasuredDepth(design, design.totalDepthM)];
    const path = validateWellboreTrajectory({
      version: 1, id: design.id, reference: { units: "m", crs: "local: east/north from wellhead", depthDatum: "well reference" },
      xyz: Float64Array.from(stations.flatMap((s) => [s.eastingM, s.northingM, s.tvdM])),
      depthsMdM: Float64Array.from(stations, (s) => s.mdM),
      inclinationsDeg: Float32Array.from(stations, (s) => s.inclinationDeg),
      azimuthsDeg: Float64Array.from(stations, (s) => (s.azimuthDeg + 360) % 360),
    });
    return { ...createMockLogCurve(path), id: "synthetic-porosity" };
  }, [design]);
  const assembly = useMemo(() => wellComponentsToAssembly({ id: design.id, name: design.wellName ?? design.id, totalDepthM: design.totalDepthM, components }), [design, components]);
  const selectedId = active.componentId;
  const setSelectedId = (id: string | null) => {
    store.selectComponent(id, "view-well");
    // In the Edit view the builder's own properties are the inspector; the sheet's stays where it is.
    if (id && layout !== "edit") { setInspectorVisible(true); setInspectorTab("properties"); }
  };
  const picked = components.find((component) => component.id === selectedId);
  const highlighted = !picked ? null : assembly.items.some((item) => item.id === picked.id) ? picked.id : picked.parentId ?? null;
  const [exploded, setExploded] = useState(false);
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [fileOpen, setFileOpen] = useState(false);
  const [fileTab, setFileTab] = useState<{ readonly tab?: string; readonly nonce: number } | null>(null);
  // A tool that names the inspector or the records opens it here, on the tab it asked for.
  const tools = useTools();
  // The study's two intervals are bands across every track while the study tool is open.
  const studyDraft = studyDrafts[sourceDesign.id];
  // Coming back to a well in the Edit view finds the builder's draft where it was left, selection included.
  const draftSelection = assemblyDrafts[sourceDesign.id]?.selectedId ?? null;
  useEffect(() => {
    if (layout === "edit" && draftSelection && store.getState().activeAsset.componentId === null) store.selectComponent(draftSelection, "edit-draft");
  }, [sourceDesign.id, layout]);
  const studyBands = useMemo(() => tools.open.has("study") && studyDraft ? studyHighlights(studyDraft) : undefined, [tools.open, studyDraft]);
  const inspectorRequest = tools.requests.inspector, fileRequest = tools.requests["well-file"];
  const sectionRequest = tools.requests.section;
  useEffect(() => {
    if (!sectionRequest?.tab) return;
    const next = layouts.find((item) => item.value === sectionRequest.tab);
    if (next) setLayout(next.value);
  }, [sectionRequest]);
  useEffect(() => {
    if (!inspectorRequest) return;
    setInspectorVisible(true);
    const tab = inspectorRequest.tab;
    if (tab === "tools" || tab === "properties" || tab === "components" || tab === "basis") setInspectorTab(tab);
  }, [inspectorRequest]);
  useEffect(() => {
    if (!fileRequest) return;
    setFileOpen(true);
    setFileTab({ tab: fileRequest.tab, nonce: fileRequest.nonce });
  }, [fileRequest]);
  const [sceneOptionsOpen, setSceneOptionsOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<"properties" | "components" | "basis" | "tools">("tools");
  const lastSurvey = design.survey?.at(-1);

  function clearInspection() {
    store.selectComponent(null, "view-well");
    link.pinCursor(null);
  }

  function focusComponent() {
    if (!picked || picked.topDepthReported === false) return;
    const padding = Math.max(20, (picked.bottomDepthM - picked.topDepthM) * 0.1);
    link.setWindow([Math.max(0, picked.topDepthM - padding), Math.min(design.totalDepthM, picked.bottomDepthM + padding)]);
    link.pinCursor(picked.topDepthM);
    setLayout("schematic");
    link.setLinked(true);
  }

  function selectAtMd(mdM: number) {
    const section = operations ? sectionAtDepth(operations, metresToFeet(mdM)) : null;
    if (section) setSelectedId(section.holeComponentId);
    link.pinCursor(mdM);
  }
  const schematicLink = link.linked ? { depthWindow: link.window, onDepthWindowChange: link.setWindow, cursorDepthM: link.cursorMdM, onCursorDepthChange: link.setCursorMdM } : {};
  // One shoe list for every trajectory pane: the plan view, the vertical section and the survey log
  // mark the same casing shoes, and three copies of the same derivation is how they drift apart.
  const shoeMarkers = useMemo(() => components
    .filter((component) => component.kind === "Casing")
    .map((component) => ({ mdM: component.bottomDepthM, label: `${component.name.split(" / ").pop()?.trim()} shoe` })), [components]);
  // The section needs a plane to project onto; the closure azimuth is the one the survey implies.
  const sectionAzimuthDeg = useMemo(() => survey.length > 1 ? summarizeTrajectory(survey).closureAzimuthDeg : 0, [survey]);

  return <section className="demo-stage demo-inspection demo-fullbleed" aria-label="View well example" onKeyDown={(event) => {
    if (event.key === "Escape" && !(event.target as HTMLElement).closest("input, select, textarea")) {
      event.preventDefault();
      clearInspection();
    }
  }}>
    <h1 className="sw-sr-only">View a well in 2.5D and 3D</h1>
    {draft && <p className="demo-preview-banner" role="status" data-testid="trajectory-preview">{draft.mode === "plan" ? "Trajectory preview · build & hold plan" : "Trajectory preview · edited stations"} — apply or discard it from the planner or the station editor.</p>}
    {linkError && <p role="alert" className="demo-fullbleed-alert">The shared view link could not be applied: {linkError}</p>}
    {/* The sheet is the window. The view tools float over it at the top left under the workspace
        toolbar; the inspector and the well file are panels from the tray; the depth command line
        floats at the foot. Everything can be dragged where it is useful. */}
    <FloatingToolbar id="view-well-tools" label="view tools" defaultStyle={{ left: "calc(var(--dock-left, 0px) + 8px)", top: "calc(var(--dock-top, 0px) + var(--band-row, 50px))" }} className="demo-toolbar">
      <div className="sw-asm-canvas-modes" role="group" aria-label="Canvas view">
        <CommandButton kind="selection" aria-pressed={layout === "section"} onClick={() => setLayout("section")}>Section</CommandButton>
        <CommandButton kind="selection" aria-pressed={layout === "curved"} onClick={() => setLayout("curved")}>Curved</CommandButton>
        <CommandButton kind="selection" aria-pressed={layout === "schematic"} onClick={() => setLayout("schematic")}>Schematic</CommandButton>
        <CommandButton kind="selection" aria-pressed={layout === "scene"} onClick={() => setLayout("scene")}>3D view</CommandButton>
        <CommandButton kind="selection" aria-pressed={layout === "edit"} onClick={() => { setLayout("edit"); if (!tools.open.has("construction")) tools.openPanel("construction"); }}>Edit</CommandButton>
        <CommandButton kind="selection" aria-pressed={showFormations} disabled={!design.formations?.length || (layout !== "section" && layout !== "curved" && layout !== "schematic" && layout !== "edit")} onClick={() => setShowFormations((value) => !value)}>Formations</CommandButton>
      </div>
      <CommandButton icon="link" type="button" className="demo-toggle" aria-pressed={link.linked} onClick={() => link.setLinked(!link.linked)} title="Zoom, pan and the depth cursor follow across the schematic, seismic section and mud log">{link.linked ? "Depth views linked" : "Depth views independent"}</CommandButton>
      <CommandButton icon="view" type="button" className="demo-tool-button" aria-expanded={inspectorVisible} aria-controls="well-inspector" onClick={() => setInspectorVisible(!inspectorVisible)}>{inspectorVisible ? "Hide inspector" : "Show inspector"}</CommandButton>
      <Link className="demo-edit-action" href={`/view-well/?well=${encodeURIComponent(wellId)}${highlighted ? `&component=${encodeURIComponent(highlighted)}` : ""}&tool=edit-well`}>Edit well</Link>
      {/* The volume tools are a panel of their own, docked under the inspector by default: inside
          the toolbar they unfolded over the scene's own controls. */}
      {layout === "earth" && earth.volume && <FloatingPanel id="scene-options" title="Volume & interpretation tools" open={sceneOptionsOpen} onOpenChange={setSceneOptionsOpen} defaultDock="right" defaultStyle={{ left: "calc(var(--dock-left, 0px) + 12px)", top: 100, width: 360 }} className="demo-scene-options">
        <div className="demo-scene-options-body">
        <InterpretationControls store={store} volume={earth.volume} curve={porosity} picking={picking} onPickingChange={setPicking} />
        <div className="demo-segment" role="group" aria-label="Seismic volume display">
          {([["solid", "Solid cube"], ["render", "Volume render"]] as const).map(([value, label]) => <CommandButton kind="selection" key={value} type="button" aria-pressed={volumeMode === value} onClick={() => setVolumeMode(value)}>{label}</CommandButton>)}
        </div>
        <div className="demo-cuts" role="group" aria-label="Cut the volume">
          {([["along", "Along well", earth.volume.alongStartM, earth.volume.alongEndM], ["offset", "Across well", earth.volume.offsetStartM, earth.volume.offsetEndM], ["depth", "Depth", design.groundTvdM ?? 0, earth.volume.baseTvdM]] as const).map(([key, label, start, end]) =>
            <label key={key}>{label}<input type="range" min={0} max={100} value={cuts[key]} onChange={(event) => store.setSeismicSlices({ [key === "along" ? "inline" : key === "offset" ? "crossline" : "time_depth"]: cutAt(start, end, Number(event.target.value)) }, "volume-controls")} /><output>{Math.round(cutAt(start, end, cuts[key])).toLocaleString("en-US")} m</output></label>)}
          {volumeMode === "render" && <label>Transparent below<input type="range" min={0} max={95} value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} /><output>{threshold}% amplitude</output></label>}
          <CommandButton icon="clear" type="button" className="demo-toggle" onClick={() => store.setSeismicSlices({ inline: null, crossline: null, time_depth: null }, "volume-controls")} disabled={cuts.along === 100 && cuts.offset === 100 && cuts.depth === 100}>Uncut</CommandButton>
        </div>
        </div>
      </FloatingPanel>}
    </FloatingToolbar>
    <PaneGrid active={panes} className={`demo-view-grid demo-view-fullbleed demo-view-${layout}`}>
      {/* The section has nothing to keep: its window, cursor and selection are the store's, and
          its data loads are cached. Keeping it mounted behind another preset would leave a second
          copy of the schematic in the document for anything that queries the page as a whole. */}
      <Pane id="wellsection" deferUntilShown keep={false} className="demo-fill demo-section-pane">
        <WellSection assembly={assembly} components={components} survey={survey} stations={design.survey} formations={design.formations} totalDepthM={design.totalDepthM}
          operations={operations} logUrl={logUrl} selectedId={highlighted ?? null} onSelect={(id) => setSelectedId(id)} onSelectMd={selectAtMd} link={link} showFormations={showFormations} markers={planMarkers} dlsLimitDegPer30m={draft?.dlsLimitDegPer30m} highlights={studyBands} />
      </Pane>
      {/* The builder over the active revision. Its parts and properties portal into the Construction
          tool; a construction change becomes the revision, so every other view draws it at once. */}
      <Pane id="edit" deferUntilShown keep={false} className="demo-fill demo-edit-pane"><WellAssemblyBuilder embedded workbench survey={sourceDesign.survey} formations={sourceDesign.formations} formationsVisible={showFormations} toolsContainer={tools.constructionHost} onToolsRequested={() => { if (!tools.open.has("construction")) tools.openPanel("construction"); }} assetBaseUrl="/well-components"
        editorState={{ ...(assemblyDrafts[sourceDesign.id] ?? { past: [], present: assembly, future: [] }), selectedId: highlighted ?? null }}
        onEditorStateChange={(state) => {
          const previous = assemblyDrafts[sourceDesign.id]?.present ?? assembly;
          if (state.present !== previous) applyRevision(sourceDesign.id, { ...(revisions[sourceDesign.id] ?? { design: sourceDesign, operations, logUrl: logUrl ?? null }), design: mergeAssembly(sourceDesign, previous, state.present) });
          if (state.selectedId !== (highlighted ?? null)) setSelectedId(state.selectedId);
          updateAssemblyDraft(sourceDesign.id, state);
        }} /></Pane>
      <Pane id="curved" deferUntilShown className="demo-fill demo-section-view"><CurvedAssemblySchematic assembly={assembly} survey={design.survey} formations={showFormations ? design.formations : undefined} assetBaseUrl="/well-components" selectedId={highlighted} onSelect={setSelectedId} /></Pane>
      <Pane id="profile" deferUntilShown className="demo-fill demo-section-view"><InteractiveViewport name="Curved well section"><CurvedSchematic key={design.id} design={design} components={components} selectedId={picked?.id ?? ""} onSelect={setSelectedId} mode={sectionMode} onModeChange={setSectionMode} layersVisible /></InteractiveViewport></Pane>
      <Pane id="schematic" deferUntilShown className="demo-fill"><AssemblySchematic assembly={assembly} survey={design.survey} formations={showFormations ? design.formations : undefined} assetBaseUrl="/well-components" selectedId={highlighted} onSelect={(id) => setSelectedId(id)} exploded={exploded} onExplodedChange={setExploded} title="Construction schematic" {...schematicLink} /></Pane>
      <Pane id="seismic" className="demo-fill demo-seismic-view" deferUntilShown>{seismic && (segy?.file ? <WellSeismicSection file={segy.file} meta={seismic.meta} wellPath={wellPath} components={components} formations={design.formations ?? []} survey={design.survey ?? []} selected={picked}
        onSelectMd={selectAtMd} cursorMdM={link.cursorMdM} onCursorMdChange={link.linked ? link.setCursorMdM : undefined} mdWindow={link.linked ? link.window : undefined} onMdWindowChange={link.linked ? link.setWindow : undefined} title="Seismic along the well · FORGE 3D PSDM" />
        : <p className="sw-scene-loading" role="status">{segy?.error ? `SEG-Y could not be loaded (${segy.error}).` : "Loading SEG-Y…"}</p>)}</Pane>
      <Pane id="well3d" className="demo-fill demo-earth-view" deferUntilShown>
        <WellScene design={design} selectedId={picked?.id ?? ""} onSelect={setSelectedId} layersVisible={showFormations} colorBy="dls" dlsLimitDegPer30m={draft?.dlsLimitDegPer30m ?? 3} target={plan && draft ? draft.plan.target : null} probeMdM={link.pinnedMdM} onProbe={selectAtMd}
          cursorMdM={link.linked ? link.cursorMdM : null} onCursorMdChange={link.linked ? link.setCursorMdM : undefined} mdWindow={link.linked ? link.window : null} /></Pane>
      <Pane id="earth" className="demo-fill demo-earth-view" deferUntilShown>{earth.error && <p className="sw-scene-loading" role="status">Seismic could not be loaded ({earth.error}); the well is shown without it.</p>}
        <WellScene design={design} selectedId={picked?.id ?? ""} onSelect={setSelectedId} volume={earth.volume} volumeView={volumeView} colorBy="dls" dlsLimitDegPer30m={3} probeMdM={link.pinnedMdM} onProbe={selectAtMd}
          slicePlane={interpretation?.slicePlane ?? null} onSlicePlaneChange={(plane) => store.setSlicePlane(plane, "plane-gizmo")} picking={picking} logCurve={porosity} logStyle={interpretation?.logStyle ?? null}
          cameraView={cameraIsAutomatic ? null : camera} onCameraViewChange={(view) => store.setViewState(view, "well-scene")} onSpatialPick={(xyz) => store.triggerSpatialPick(xyz, "well-scene")}
          cursorMdM={link.linked ? link.cursorMdM : null} onCursorMdChange={link.linked ? link.setCursorMdM : undefined} mdWindow={link.linked ? link.window : null} /></Pane>
      <Pane id="plan" deferUntilShown className="demo-fill demo-survey-view"><TrajectoryPlanView survey={survey} selectedMdM={link.pinnedMdM} onSelectMd={selectAtMd} markers={[...shoeMarkers, ...planMarkers]} height={620} dlsLimitDegPer30m={draft?.dlsLimitDegPer30m} target={plan && draft ? draft.plan.target : null} onTargetChange={plan ? moveTarget : undefined} onTargetCommit={plan ? () => undefined : undefined} /></Pane>
      <Pane id="section" deferUntilShown className="demo-fill demo-survey-view"><TrajectorySectionView survey={survey} selectedMdM={link.pinnedMdM} onSelectMd={selectAtMd} markers={[...shoeMarkers, ...planMarkers]} formations={design.formations} dlsLimitDegPer30m={draft?.dlsLimitDegPer30m} target={plan && draft ? draft.plan.target : null} onTargetChange={plan ? moveTarget : undefined} onTargetCommit={plan ? () => undefined : undefined} verticalSectionAzimuthDeg={sectionAzimuthDeg} height={620} /></Pane>
      <Pane id="survey" deferUntilShown className="demo-fill demo-survey-view"><TrajectoryLog survey={survey} selectedMdM={link.pinnedMdM} onSelectMd={selectAtMd} height={900}
        cursorMdM={link.linked ? link.cursorMdM : null} onCursorMdChange={link.linked ? link.setCursorMdM : undefined} mdWindow={link.linked ? link.window : null}
        markers={shoeMarkers} /></Pane>
      <Pane id="cutaway" className="demo-fill" deferUntilShown><AssemblyScene assembly={assembly} assetBaseUrl="/well-components" selectedId={highlighted} onSelect={(id) => setSelectedId(id)} exploded={exploded} onExplodedChange={setExploded} title="Construction cutaway" /></Pane>
    </PaneGrid>
    <FloatingPanel id="inspector" title="Inspector" detail={`${components.length} source records`} open={inspectorVisible} onOpenChange={setInspectorVisible} defaultStyle={{ right: 12, top: 104, width: 320 }} defaultDock="right" className="demo-inspector-float">
      <aside id="well-inspector" className="demo-side" aria-label="Component inspector">
        <div className="demo-inspector-tabs" role="group" aria-label="Inspector panels">
          {([["tools", "Tools"], ["properties", "Properties"], ["components", "Components"], ["basis", "Evidence"]] as const).map(([value, label]) => <CommandButton kind="selection" key={value} type="button" aria-pressed={inspectorTab === value} onClick={() => setInspectorTab(value)}>{label}</CommandButton>)}
        </div>
        <label className="demo-view-picker"><span>Show the well as</span><select aria-label="View" value={layout} onChange={(event) => {
            const next = layouts.find((item) => item.value === event.currentTarget.value);
            if (next) setLayout(next.value);
          }}>
            <optgroup label="Construction">{layouts.filter((item) => item.value !== "seismic" && item.value !== "earth").map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</optgroup>
            {seismic && <optgroup label="Subsurface context">{layouts.filter((item) => item.value === "seismic" || item.value === "earth").map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</optgroup>}
        </select></label>
        {/* The inspector panes scroll inside the docked column, so each is keyboard-focusable: a
            scrolling region the keyboard cannot reach is a region whose lower half is mouse-only. */}
        <section className="demo-inspection-tools" aria-label="Well view tools" hidden={inspectorTab !== "tools"} tabIndex={0}>
          {/* With nothing selected this pane was one sentence in a 400px column. An inspector with
              no selection should describe the thing being inspected, and every fact here was
              already on the page — scattered across the context bar, the status line and the
              drawing caption — or buried in the Evidence tab. */}
          <h2>This well</h2>
          <dl className="demo-well-facts">
            <div><dt>Total depth</dt><dd>{design.totalDepthM.toLocaleString("en", { maximumFractionDigits: 0 })} m MD</dd></div>
            <div><dt>Survey</dt><dd>{survey.length > 1 ? `${survey.length} stations · ${survey.at(-1)!.mdM.toLocaleString("en", { maximumFractionDigits: 0 })} m` : "Not reported"}</dd></div>
            <div><dt>Construction</dt><dd>{components.length} records · {assembly.items.length} drawn</dd></div>
            <div><dt>Formations</dt><dd>{design.formations?.length ? `${design.formations.length} layers` : "Not reported"}</dd></div>
            <div><dt>Operations</dt><dd>{operations ? `${operations.days.length} daily · ${operations.runs.length} runs` : "Not attached"}</dd></div>
            <div><dt>Mud log</dt><dd>{logUrl ? "Attached" : "Not attached"}</dd></div>
            <div><dt>Seismic</dt><dd>{seismic ? "Section & volume" : "Not attached"}</dd></div>
            <div><dt>Depth datum</dt><dd>{design.depthDatum ?? "Not reported"}</dd></div>
          </dl>
          <h2>This view</h2>
          <p>{layout === "section" ? "One depth axis. The construction, the mud log and the survey are tracks on it: hover anywhere for the depth cursor across all of them, pick a component or a depth in any one and the others follow."
            : layout === "earth" ? "3D well, seismic volume and trajectory survey share the selected well and depth."
            : layout === "seismic" ? "Compare the construction schematic with the seismic section along this well."
            : layout === "trajectory" ? "Plan view and vertical section of the surveyed path, marking every casing shoe."
            : layout === "profile" ? "Interval tracks beside the measured-depth schematic."
            : layout === "split" ? "The 2.5D construction schematic beside the lit 3D cutaway."
            : layout === "scene" ? "The lit 3D cutaway of the assembled construction."
            : layout === "schematic" ? "The straight 2.5D construction schematic, by measured depth."
            : "Follow the measured trajectory in a schematic section."}</p>
        </section>
        <div hidden={inspectorTab !== "properties"} role="region" aria-label="Selected record" tabIndex={0}>
          <RecordCard component={picked} design={design} />
          {!picked && <div className="demo-inspector-empty"><p>Pick a part in the drawing, or search the component register.</p><CommandButton icon="inspect" type="button" className="demo-tool-button" onClick={() => setInspectorTab("components")}>Browse components</CommandButton></div>}
          {picked && <div className="demo-component-actions">
            <CommandButton icon="focus" type="button" className="demo-tool-button" disabled={picked.topDepthReported === false} onClick={focusComponent}>Focus selected interval</CommandButton>
            <CommandButton icon="clear" type="button" className="demo-tool-button" onClick={clearInspection}>Clear picked component</CommandButton>
            {picked.topDepthReported === false && <p>Interval focus unavailable: top MD not reported.</p>}
          </div>}
        </div>
        <div className="demo-component-register" hidden={inspectorTab !== "components"} tabIndex={0}>
          <ComponentInventory key={design.id} components={components} selectedId={picked?.id ?? null} onSelect={setSelectedId} pageSize={10} />
        </div>
        <section className="demo-inspection-basis" aria-label="Drawing basis" hidden={inspectorTab !== "basis"} tabIndex={0}>
          <h2>Drawing basis</h2>
          <dl><div><dt>Observed survey end</dt><dd>{lastSurvey ? `${lastSurvey.mdM.toLocaleString("en", { maximumFractionDigits: 1 })} m MD` : "not reported"}</dd></div>
            <div><dt>Rendered assembly</dt><dd>{assembly.items.length} parts</dd></div>
            <div><dt>Source</dt><dd>{design.provenance === "documented" ? "Published records" : design.provenance === "user-authored" ? "User-authored revision; original source preserved" : "Synthetic fixture"}</dd></div></dl>
          <p>Construction widths are exaggerated for readability. Unknown dimensions are not certified design values.</p>
        </section>
      </aside>
    </FloatingPanel>
    <FloatingPanel id="well-file" title="Well file" detail={operations ? `${operations.days.length} daily reports / ${operations.runs.length} service runs / logs & survey` : "No operational records attached"} open={fileOpen} onOpenChange={setFileOpen} defaultDock="bottom" defaultStyle={{ left: "calc(var(--dock-left, 0px) + 12px)", bottom: "calc(var(--dock-bottom, 0px) + 84px)", width: "min(1120px, calc(100vw - 24px))" }} className="demo-records-drawer">
      <WellFile key={design.id} operations={operations} components={components} selected={picked} onSelectComponent={setSelectedId} logUrl={logUrl} survey={design.survey} formations={design.formations} seismic={seismic} link={link} openTab={fileTab} />
    </FloatingPanel>
  </section>;
}
