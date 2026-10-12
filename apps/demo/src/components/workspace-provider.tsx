"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { createInitialSubsurfaceState, createSubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import type { SubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import { useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";
import { SubsurfaceThemeProvider } from "@ikhmalputra/subsurface-react/2d";
import type { SubsurfaceDensity, SubsurfaceThemeName } from "@ikhmalputra/subsurface-react/2d";
import { wells } from "./wells-data";
import type { WellAssemblyEditorState } from "@ikhmalputra/subsurface-react/examples";
import { makeFieldProject, defaultFieldCutoffs } from "../lib/field-project";
import type { FieldProject, FieldOptions } from "../lib/field-project";
import { emptyGisWorkspace } from "@ikhmalputra/subsurface-core/gis";
import type { GisWorkspaceState } from "@ikhmalputra/subsurface-core/gis";
import { authoredRevision } from "../lib/well-revision";
import type { TrajectoryDraft } from "../lib/trajectory-draft";
import type { StudyDraft } from "../lib/study-draft";
import type { WellRevision } from "../lib/well-revision";

interface Workspace {
  readonly revisions: Readonly<Record<string, WellRevision>>;
  readonly applyRevision: (wellId: string, revision: WellRevision) => void;
  readonly restoreSource: (wellId: string) => void;
  readonly fieldGisState: GisWorkspaceState;
  readonly setFieldGisState: (state: GisWorkspaceState) => void;
  readonly fieldProject: FieldProject;
  readonly fieldStore: SubsurfaceStore;
  readonly fieldWellIds: readonly string[];
  readonly setFieldWellIds: (ids: readonly string[]) => void;
  readonly fieldOptions: FieldOptions;
  readonly updateFieldOptions: (options: Partial<FieldOptions>) => void;
  readonly store: SubsurfaceStore;
  readonly well: (typeof wells)[number];
  readonly chooseWell: (id: string) => void;
  readonly theme: SubsurfaceThemeName;
  readonly setTheme: (theme: SubsurfaceThemeName) => void;
  readonly density: SubsurfaceDensity;
  readonly setDensity: (density: SubsurfaceDensity) => void;
  readonly assemblyDrafts: Readonly<Record<string, WellAssemblyEditorState>>;
  readonly updateAssemblyDraft: (wellId: string, state: WellAssemblyEditorState) => void;
  /** The trajectory being planned or edited per well, drawn by the section as a preview until applied. */
  readonly trajectoryDrafts: Readonly<Record<string, TrajectoryDraft>>;
  readonly updateTrajectoryDraft: (wellId: string, draft: TrajectoryDraft | null) => void;
  /** The drilling study in progress per well: the study and evidence tools edit it, the section bands its intervals. */
  readonly studyDrafts: Readonly<Record<string, StudyDraft>>;
  readonly updateStudyDraft: (wellId: string, update: (current: StudyDraft | null) => StudyDraft | null) => void;
}

const WorkspaceContext = createContext<Workspace | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [fieldProject] = useState(makeFieldProject);
  const [fieldGisState, setFieldGisState] = useState(emptyGisWorkspace);
  const [fieldStore] = useState(createSubsurfaceStore);
  const [fieldWellIds, setFieldWellIds] = useState<readonly string[]>(() => fieldProject.records.map((record) => record.well.id));
  const [fieldOptions, setFieldOptions] = useState<FieldOptions>({ log: "gr", flatten: "reservoir-top", focusInterval: true, view: "map", offset: 500, endpoints: ["offshore-1", "offshore-4"], cutoffs: defaultFieldCutoffs });
  function updateFieldOptions(options: Partial<FieldOptions>) {
    setFieldOptions((current) => ({ ...current, ...options }));
  }
  const [store] = useState(() => {
    const next = createSubsurfaceStore();
    next.focusAsset(wells[0].design.id, null, "workspace");
    return next;
  });
  const wellId = useSubsurfaceSelector(store, (state) => state.activeAsset.wellId);
  const sourceWell = wells.find((entry) => entry.design.id === wellId);
  const [revisions, setRevisions] = useState<Readonly<Record<string, WellRevision>>>({});
  const well = sourceWell && revisions[sourceWell.design.id]
    ? { ...sourceWell, design: revisions[sourceWell.design.id]!.design, operations: revisions[sourceWell.design.id]!.operations ?? undefined, logUrl: revisions[sourceWell.design.id]!.logUrl ?? undefined }
    : sourceWell;
  const [theme, setTheme] = useState<SubsurfaceThemeName>("light");
  const [density, setDensity] = useState<SubsurfaceDensity>("comfortable");
  const [assemblyDrafts, setAssemblyDrafts] = useState<Readonly<Record<string, WellAssemblyEditorState>>>({});
  const [trajectoryDrafts, setTrajectoryDrafts] = useState<Readonly<Record<string, TrajectoryDraft>>>({});
  const updateTrajectoryDraft = useCallback((id: string, draft: TrajectoryDraft | null) => setTrajectoryDrafts((current) => {
    if (draft === null) { if (!(id in current)) return current; const next = { ...current }; delete next[id]; return next; }
    return { ...current, [id]: draft };
  }), []);
  const [studyDrafts, setStudyDrafts] = useState<Readonly<Record<string, StudyDraft>>>({});
  const updateStudyDraft = useCallback((id: string, update: (current: StudyDraft | null) => StudyDraft | null) => setStudyDrafts((current) => {
    const next = update(current[id] ?? null);
    if (next === null) { if (!(id in current)) return current; const rest = { ...current }; delete rest[id]; return rest; }
    return { ...current, [id]: next };
  }), []);
  if (!well) throw new Error(`Unknown workspace well: ${wellId}`);

  const chooseWell = useCallback((id: string) => {
    const next = wells.find((entry) => entry.id === id || entry.design.id === id);
    if (!next) throw new Error(`Unknown workspace well: ${id}`);
    if (next.design.id === store.getState().activeAsset.wellId) return;
    store.focusAsset(next.design.id, null, "workspace");
    store.clearDataInteraction("workspace");
    store.setSeismicSlices({ inline: null, crossline: null, time_depth: null }, "workspace");
    store.setSlicePlane(null, "workspace");
    store.setLogStyle(null, "workspace");
    store.setViewState(createInitialSubsurfaceState().viewState, "workspace");
  }, [store]);
  function updateAssemblyDraft(id: string, state: WellAssemblyEditorState) {
    const source = wells.find((entry) => entry.design.id === id);
    if (!source) throw new Error(`Unknown draft well: ${id}`);
    setAssemblyDrafts((current) => ({ ...current, [id]: state }));
  }
  function applyRevision(id: string, revision: WellRevision) {
    const source = wells.find((entry) => entry.design.id === id);
    if (!source) throw new Error(`Unknown revision well: ${id}`);
    const next = authoredRevision(revision, revisions[id]?.design ?? source.design);
    setRevisions((current) => ({ ...current, [id]: next }));
    if (store.getState().activeAsset.wellId === id) {
      store.selectComponent(null, "well-revision");
      store.pinDepth(id, null, "well-revision");
      store.setDepthWindow(null, "well-revision");
    }
  }
  function restoreSource(id: string) {
    if (!wells.some((entry) => entry.design.id === id)) throw new Error(`Unknown source well: ${id}`);
    setRevisions((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setAssemblyDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    store.selectComponent(null, "restore-source");
    store.pinDepth(id, null, "restore-source");
  }

  return <WorkspaceContext.Provider value={{ revisions, applyRevision, restoreSource, fieldGisState, setFieldGisState, fieldProject, fieldStore, fieldWellIds, setFieldWellIds, fieldOptions, updateFieldOptions, store, well, chooseWell, theme, setTheme, density, setDensity, assemblyDrafts, updateAssemblyDraft, trajectoryDrafts, updateTrajectoryDraft, studyDrafts, updateStudyDraft }}>
    <SubsurfaceThemeProvider theme={theme} density={density} className="demo-theme-shell">
      {children}
    </SubsurfaceThemeProvider>
  </WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("WorkspaceProvider is required for demo workspace views.");
  return workspace;
}
