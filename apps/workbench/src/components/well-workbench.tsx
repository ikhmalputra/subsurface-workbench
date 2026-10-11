"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  forgeDesign, getWellComponents, researchDesign, sProfileDesign, wellComponentsToAssembly,
} from "@ikhmalputra/subsurface-core";
import type { WellComponent, WellDesign } from "@ikhmalputra/subsurface-core";
import { getCatalogEntry } from "@ikhmalputra/subsurface-core/assembly";
import type { AssemblySlot, WellAssembly } from "@ikhmalputra/subsurface-core/assembly";
import { createSubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import { useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";
import { AssemblySchematic, CurvedAssemblySchematic } from "@ikhmalputra/subsurface-react/assembly";
import { ComponentInventory } from "@ikhmalputra/subsurface-react";
import { SubsurfaceThemeProvider } from "@ikhmalputra/subsurface-react/2d";
import type { SubsurfaceDensity, SubsurfaceThemeName } from "@ikhmalputra/subsurface-react/2d";
import {
  CanvasLayer, CanvasStack, CommandButton, LayerManager, Panel, Workbench, usePanelRegistry,
  type WorkbenchLayer,
} from "@ikhmalputra/subsurface-shell";

// Three.js stays out of the initial payload; the 3D mode pulls it in on first use.
const AssemblyScene = dynamic(
  () => import("@ikhmalputra/subsurface-react/assembly-three").then((module) => module.AssemblyScene),
  { ssr: false, loading: () => <p className="swb-empty" role="status">Loading the 3D cutaway…</p> },
);

const documents: readonly { readonly id: string; readonly title: string; readonly design: WellDesign }[] = [
  { id: "forge", title: "Utah FORGE 16A(78)-32", design: forgeDesign },
  { id: "s-profile", title: "S-profile completion", design: sProfileDesign },
  { id: "research", title: "Open research reference", design: researchDesign },
];

const canvasModes = [
  { id: "curved", label: "Curved" },
  { id: "schematic", label: "Schematic" },
  { id: "cutaway", label: "3D cutaway" },
] as const;
type CanvasMode = (typeof canvasModes)[number]["id"];

const provenanceDetail: Readonly<Record<WellDesign["provenance"], string>> = {
  documented: "cited source records",
  synthetic: "synthetic example",
  "user-authored": "your revision",
};

const metres = (value: number) => `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })} m`;
const inches = (mm: number | null) => (mm === null ? "not reported" : `${(mm / 25.4).toFixed(3).replace(/\.?0+$/, "")} in`);

function slotOf(catalogId: string): AssemblySlot | null {
  try { return getCatalogEntry(catalogId).slot; } catch { return null; }
}

function countSlots(assembly: WellAssembly, slots: readonly AssemblySlot[]) {
  return assembly.items.filter((item) => {
    const slot = slotOf(item.catalogId);
    return slot !== null && slots.includes(slot);
  }).length;
}

/**
 * Derived from the record, not hand-written. Provenance is per layer rather than per well: the FORGE
 * construction is sourced, but its strata are conceptual context, so they must not claim the same
 * standing. Layers the current SVG views cannot hide separately say so instead of offering a dead toggle.
 */
function buildLayers(design: WellDesign, assembly: WellAssembly, formationsVisible: boolean): readonly WorkbenchLayer[] {
  const notSeparable = "Per-layer visibility arrives with the render engine; this view draws construction as one drawing.";
  return [
    { id: "wellhead", label: "Wellhead & tree", count: countSlots(assembly, ["surface"]), provenance: design.provenance, visible: true, toggleable: false, toggleHint: notSeparable },
    { id: "casing", label: "Casing & liners", count: countSlots(assembly, ["casing", "liner"]), provenance: design.provenance, visible: true, toggleable: false, toggleHint: notSeparable },
    { id: "cement", label: "Cement", count: countSlots(assembly, ["cement"]), provenance: design.provenance, visible: true, toggleable: false, toggleHint: notSeparable },
    { id: "completion", label: "Completion", count: countSlots(assembly, ["tubing", "tubing-tool", "sandface", "casing-tool", "plug"]), provenance: design.provenance, visible: true, toggleable: false, toggleHint: notSeparable },
    {
      id: "formations", label: "Formations", visible: formationsVisible,
      count: design.formations?.length ?? null,
      // FORGE strata are conceptual in the source record; never present them as measured.
      provenance: "synthetic",
      detail: design.formations?.length ? `${design.formations.length} intervals · conceptual` : "not reported",
    },
    {
      id: "survey", label: "Survey path", visible: true, toggleable: false, toggleHint: notSeparable,
      count: design.survey?.length ?? null, provenance: design.provenance,
      detail: design.survey?.length ? `${design.survey.length} stations · ${design.surveyStatus ?? "unstated"}` : "not reported",
    },
  ];
}

function RecordProperties({ record }: { readonly record: WellComponent }) {
  return <dl className="wb-props">
    <dt>Name</dt><dd>{record.name}</dd>
    <dt>Kind</dt><dd>{record.kind}</dd>
    <dt>Material</dt><dd>{record.material || "not reported"}</dd>
    {/* A record whose top was never reported must not render a confident 0 m. */}
    <dt>Top MD</dt><dd>{record.topDepthReported === false ? "not reported" : metres(record.topDepthM)}</dd>
    <dt>Base MD</dt><dd>{metres(record.bottomDepthM)}</dd>
    <dt>Outside diameter</dt><dd>{inches(record.outerDiameterMm)}</dd>
    <dt>Inside diameter</dt><dd>{inches(record.innerDiameterMm)}</dd>
    {record.rawBottomDepthFt != null ? <><dt>Reported base</dt><dd>{record.rawBottomDepthFt.toLocaleString()} ft</dd></> : null}
    <dt>Source</dt><dd>{record.sourcePage ? `page ${record.sourcePage}` : "not reported"}</dd>
    <dt>Description</dt><dd>{record.description || "not reported"}</dd>
  </dl>;
}

/** Lives inside <Workbench> so it can use the panel registry. */
function Body({
  design, components, assembly, mode, formationsVisible, onToggleFormations, selectedId, onSelect,
}: {
  readonly design: WellDesign;
  readonly components: readonly WellComponent[];
  readonly assembly: WellAssembly;
  readonly mode: CanvasMode;
  readonly formationsVisible: boolean;
  readonly onToggleFormations: () => void;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
}) {
  const { reveal } = usePanelRegistry();
  const [layerId, setLayerId] = useState<string | null>(null);
  const layers = useMemo(() => buildLayers(design, assembly, formationsVisible), [design, assembly, formationsVisible]);
  const formations = formationsVisible ? design.formations : undefined;

  // Selection is held as a source-record id. Not every record becomes a drawing item (joints and
  // couplings do not), so the drawing highlights the item itself or its parent string.
  const record = components.find((component) => component.id === selectedId) ?? null;
  const highlighted = !record ? null
    : assembly.items.some((item) => item.id === record.id) ? record.id : record.parentId ?? null;

  // Depends on the stable reveal only, so switching panels while a component stays selected sticks.
  useEffect(() => {
    if (selectedId) reveal("properties");
  }, [selectedId, reveal]);

  return <>
    <CanvasStack active={mode}>
      <CanvasLayer id="curved">
        <CurvedAssemblySchematic assembly={assembly} survey={design.survey} formations={formations}
          assetBaseUrl="/well-components" selectedId={highlighted} onSelect={onSelect} />
      </CanvasLayer>
      <CanvasLayer id="schematic">
        <AssemblySchematic assembly={assembly} survey={design.survey} formations={formations}
          assetBaseUrl="/well-components" selectedId={highlighted} onSelect={onSelect}
          title="Construction schematic" />
      </CanvasLayer>
      <CanvasLayer id="cutaway">
        <AssemblyScene assembly={assembly} assetBaseUrl="/well-components"
          selectedId={highlighted} onSelect={onSelect} title="Construction cutaway" />
      </CanvasLayer>
    </CanvasStack>

    <Panel id="layers" title="Layers" order={0}>
      <LayerManager layers={layers} selectedId={layerId} onSelect={setLayerId}
        onToggleVisible={(id) => { if (id === "formations") onToggleFormations(); }} />
    </Panel>

    <Panel id="properties" title="Properties" order={1}>
      {record ? <RecordProperties record={record} />
        : <p className="swb-empty">Select a component in the drawing, or find one in Records.</p>}
    </Panel>

    <Panel id="records" title="Records" order={2}>
      <ComponentInventory components={components} selectedId={selectedId} onSelect={onSelect} pageSize={10} />
    </Panel>

    <Panel id="sources" title="Sources" order={3}>
      <dl className="wb-props">
        <dt>Record</dt><dd>{design.wellName ?? design.id}</dd>
        <dt>Provenance</dt><dd>{design.provenance} · {provenanceDetail[design.provenance]}</dd>
        <dt>Depth datum</dt><dd>{design.depthDatum ?? "not reported"}</dd>
        <dt>Reported TD</dt><dd>{design.reportedTotalDepthFt ? `${design.reportedTotalDepthFt.toLocaleString()} ft` : "not reported"}</dd>
        <dt>Records</dt><dd>{components.length}</dd>
        <dt>Attribution</dt><dd>{design.attribution ?? "not reported"}</dd>
        <dt>Licence</dt><dd>{design.license ?? "not reported"}</dd>
      </dl>
      <p className="swb-empty">The host owns this data. Nothing here is stored by the workbench.</p>
    </Panel>

    <Panel id="history" title="History" order={4}>
      <p className="swb-empty">
        A single named command history across every panel arrives with the command stack. Until then this
        document is read-only, so there is nothing to undo.
      </p>
    </Panel>
  </>;
}

export function WellWorkbench() {
  const [documentId, setDocumentId] = useState("forge");
  const [mode, setMode] = useState<CanvasMode>("curved");
  const [formationsVisible, setFormationsVisible] = useState(true);
  const [theme, setTheme] = useState<SubsurfaceThemeName>("light");
  const [density, setDensity] = useState<SubsurfaceDensity>("comfortable");

  const entry = documents.find((candidate) => candidate.id === documentId) ?? documents[0]!;
  const design = entry.design;

  const [store] = useState(() => {
    const created = createSubsurfaceStore();
    created.focusAsset(forgeDesign.id, null, "workbench");
    return created;
  });
  useEffect(() => { store.focusAsset(design.id, null, "workbench"); }, [store, design.id]);
  const selectedId = useSubsurfaceSelector(store, (state) => state.activeAsset.componentId);

  const components = useMemo(() => getWellComponents(design), [design]);
  const assembly = useMemo(() => wellComponentsToAssembly({
    id: design.id, name: design.wellName ?? design.id,
    totalDepthM: design.totalDepthM, components,
  }), [design, components]);

  return <SubsurfaceThemeProvider theme={theme} density={density} className="wb-theme">
    <Workbench
      brand={<span>Subsurface<small>Workbench</small></span>}
      commands={<>
        <label>Theme <select value={theme} onChange={(event) => {
          const value = event.currentTarget.value;
          if (value === "light" || value === "dark" || value === "high-contrast") setTheme(value);
        }}>
          <option value="light">Light</option><option value="dark">Dark</option><option value="high-contrast">High contrast</option>
        </select></label>
        <label>Density <select value={density} onChange={(event) => {
          const value = event.currentTarget.value;
          if (value === "compact" || value === "comfortable") setDensity(value);
        }}>
          <option value="comfortable">Comfortable</option><option value="compact">Compact</option>
        </select></label>
      </>}
      documents={documents.map((candidate) => ({
        id: candidate.id, title: candidate.title, detail: provenanceDetail[candidate.design.provenance],
      }))}
      activeDocumentId={documentId}
      onActivateDocument={setDocumentId}
      tools={[
        { id: "select", label: "Select", icon: "inspect" },
        { id: "measure", label: "Measure (not implemented)", icon: "measure", disabled: true },
      ]}
      activeToolId="select"
      options={<>
        <span>View</span>
        <div className="swb-segment" role="group" aria-label="Canvas view">
          {canvasModes.map((candidate) => <CommandButton key={candidate.id} kind="selection"
            aria-pressed={mode === candidate.id} onClick={() => setMode(candidate.id)}>{candidate.label}</CommandButton>)}
        </div>
      </>}
      status={<>
        <span>Well <strong>{design.wellName ?? design.id}</strong></span>
        <span>Source <strong>{design.provenance}</strong></span>
        <span>Records <strong>{components.length}</strong></span>
        <span>Component <strong>{selectedId ?? "none selected"}</strong></span>
        <span>View <strong>{mode}</strong></span>
      </>}
    >
      <Body design={design} components={components} assembly={assembly} mode={mode}
        formationsVisible={formationsVisible} onToggleFormations={() => setFormationsVisible((value) => !value)}
        selectedId={selectedId} onSelect={(id) => store.selectComponent(id, "workbench")} />
    </Workbench>
  </SubsurfaceThemeProvider>;
}
