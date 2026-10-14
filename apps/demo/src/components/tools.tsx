"use client";

import { createContext, Suspense, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CommandButton } from "@ikhmalputra/subsurface-react/ui";
import type { CommandIconName } from "@ikhmalputra/subsurface-react/ui";
import { Activity, Anchor, AudioWaveform, Box, Boxes, Calculator, Calendar, ClipboardList, Columns3, Compass, Container, Crosshair, Cylinder, Database, Download, Droplets, FlaskConical, Flame, Gauge, GitBranch, Globe, Grid3x3, Hammer, Layers, ListOrdered, Map, Mountain, Printer, Radio, Route, Rows3, Ruler, Scale, Scan, ScatterChart, ShieldCheck, Sigma, Split, Target, Thermometer, Timer, TrendingDown, Waves, Wrench, Zap, type LucideIcon } from "lucide-react";
import { FloatingPanel } from "./floating";
import { useWorkspace } from "./workspace-provider";
import { SHEET, documentHref, documentLabels, documentRoutes, domainTools, findToolObject, isDocument, subDomains, toolGroupLabels, toolObjects, toolVerbs, type DomainTool, type SubDomain, type ToolGroup, type ToolPanelId, type ToolVerb } from "../lib/tools";
import { ViewWellDemo } from "./view-well-demo";
import { ViewWellUsage } from "./view-well-usage";
import { PetrophysicsDemo } from "./petrophysics-demo";
import { ProductionSurveillanceDemo } from "./production-surveillance-demo";
import { LinkedDataDemo } from "./linked-data-demo";
import { WebGpuSandbox } from "./webgpu-sandbox";
import { WorkspaceRoute } from "./workspace-route";

const ribbonIcons: Readonly<Record<string, LucideIcon>> = {
  Activity, Anchor, AudioWaveform, Box, Boxes, Calculator, Calendar, ClipboardList, Columns3, Compass, Container, Crosshair, Cylinder, Database, Download, Droplets,
  FlaskConical, Flame, Gauge, GitBranch, Globe, Grid3x3, Hammer, Layers, ListOrdered, Map, Mountain, Printer, Radio, Route, Rows3, Ruler, Scale, Scan, Scatter: ScatterChart,
  ShieldCheck, Sigma, Split, Target, Thermometer, Timer, TrendingDown, Waves, Wrench, Zap,
};
import { EvidenceTool, StudyTool } from "./study-tools";
import { WellReportDemo } from "./well-report-demo";
import { FieldWorkspace } from "./field-workspace";
import { ComponentRecordsTool, ConstructionTool, FormationsTool, RecordsDataTool, WellPropertiesTool } from "./edit-tools";
import { FieldRegisterTool, FieldTrajectoryTool } from "./field-tools";
import { DesignTool } from "./design-tools";
import { CementVolumesTool, HydraulicsTool, KickToleranceTool, TimeBreakdownTool } from "./drilling-tools";
import { StationEditorTool, SurveySummaryTool, TrajectoryPlannerTool } from "./survey-tools";

/**
 * Tools on the sheet.
 *
 * The palette lists every object of the well with its verbs; a verb opens the panel that holds
 * the object's data, docked to fill the sheet by default — a tab, in effect — and the reader can
 * dock it to a side or float it like any other panel. The route workspaces (trajectory, study,
 * design brief, report, field, editor) are those panels; the routes themselves stay until the
 * panels have replaced them. The inspector and the well file are the well view's own panels, so a
 * tool that opens them asks the view to, through a request counter it watches.
 */
interface ToolsState {
  readonly open: ReadonlySet<ToolPanelId>;
  /** The document filling the sheet, or none. */
  readonly document: ToolPanelId | null;
  /** The `?tool=` the sheet was opened with, which the navigation highlights — "trajectory" is the section with its survey tools. */
  readonly link: string | null;
  readonly setLink: (link: string | null) => void;
  /** Asks the section document to open one of its own panels: a nonce, and the tab it should show. */
  readonly requests: Readonly<Record<string, { readonly nonce: number; readonly tab?: string }>>;
  readonly paletteOpen: boolean;
  readonly setPaletteOpen: (open: boolean) => void;
  readonly ribbonOpen: boolean;
  /** A phone-width viewport: the ribbon floats, and the workspace bar stays a toolbar of its own. */
  readonly phone: boolean;
  /** Where the builder portals its parts and properties: the Construction tool's body while it is open. */
  readonly constructionHost: HTMLElement | null;
  readonly setConstructionHost: (element: HTMLElement | null) => void;
  /** Where the design workflow portals its tools: the Design brief tool's body while it is open. */
  readonly designHost: HTMLElement | null;
  readonly setDesignHost: (element: HTMLElement | null) => void;
  readonly setRibbonOpen: (open: boolean) => void;
  /** Open a sub-domain tool from the ribbon; returns the line to echo. */
  readonly launch: (tool: DomainTool) => string;
  readonly openPanel: (panel: ToolPanelId, tab?: string) => void;
  readonly closePanel: (panel: ToolPanelId) => void;
  /** Run `verb object` as the command line and the palette do; returns the line to echo. */
  readonly run: (verb: ToolVerb, object: string) => string;
}
const ToolsContext = createContext<ToolsState | null>(null);
export function useTools(): ToolsState {
  const tools = useContext(ToolsContext);
  if (!tools) throw new Error("useTools must be used inside <ToolsProvider>.");
  return tools;
}

/** The calculators and editors dock beside the inspector, the station table under the sheet; the documents fill it. */
const sidePanels: ReadonlySet<ToolPanelId> = new Set(["kick", "cement", "time", "hydraulics", "planner", "stations", "survey-summary", "study", "evidence", "construction", "well-properties", "component-records", "formations", "records-data", "field-register", "field-trajectory", "design"]);
const bottomPanels: ReadonlySet<ToolPanelId> = new Set(["stations", "evidence"]);
/** Side tools that need more than the inspector's width. */
const dockSizes: Readonly<Partial<Record<ToolPanelId, number>>> = { study: 380, construction: 380, "well-properties": 360, "component-records": 360, formations: 360, "records-data": 380, "field-register": 320, "field-trajectory": 400, design: 460 };

export function ToolsProvider({ children }: { readonly children: ReactNode }) {
  const { well } = useWorkspace();
  const [open, setOpen] = useState<ReadonlySet<ToolPanelId>>(() => new Set());
  const [requests, setRequests] = useState<Readonly<Record<string, { readonly nonce: number; readonly tab?: string }>>>({});
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [ribbonOpen, setRibbonOpen] = useState(true);
  const [link, setLink] = useState<string | null>(null);
  const [constructionHost, setConstructionHost] = useState<HTMLElement | null>(null);
  const [designHost, setDesignHost] = useState<HTMLElement | null>(null);
  const router = useRouter();
  // A phone has no room for a docked ribbon; it starts as a tray tab there, and the frame keeps
  // the workspace bar out of the ribbon's title row for as long as the viewport stays that narrow.
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    if (query.matches) setRibbonOpen(false);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  // One document at a time: opening one puts the others away, the way a drawing is the active
  // drawing. Side panels stack beside it; the well view's own panels are asked for by request.
  const openPanel = (panel: ToolPanelId, tab?: string) => {
    if (isDocument(panel)) {
      setOpen((current) => { const next = new Set<ToolPanelId>(); for (const id of current) if (!isDocument(id)) next.add(id); next.add(panel); return next; });
      if (tab) setRequests((current) => ({ ...current, [panel]: { nonce: (current[panel]?.nonce ?? 0) + 1, tab } }));
    }
    // A side tool works over the section: with the sheet empty, the section opens under it.
    else if (sidePanels.has(panel)) setOpen((current) => { if (current.has(panel)) return current; const next = new Set(current); if (![...current].some(isDocument)) next.add("section"); next.add(panel); return next; });
    else {
      // The inspector and the records belong to the section document: make sure it is the open
      // document, then ask it for the panel and the tab.
      setOpen((current) => { if (current.has("section")) return current; const next = new Set<ToolPanelId>(); for (const id of current) if (!isDocument(id)) next.add(id); next.add("section"); return next; });
      setRequests((current) => ({ ...current, [panel]: { nonce: (current[panel]?.nonce ?? 0) + 1, tab } }));
    }
  };
  const closePanel = (panel: ToolPanelId) => setOpen((current) => { if (!current.has(panel)) return current; const next = new Set(current); next.delete(panel); return next; });
  const document = [...open].find(isDocument) ?? null;
  const run = (verb: ToolVerb, name: string): string => {
    if (!name) return `${verb.toUpperCase()} needs an object: ${toolObjects.map((object) => object.id).join(", ")}`;
    const object = findToolObject(name);
    if (!object) return `No object "${name}" · objects: ${toolObjects.map((entry) => entry.id).join(", ")}`;
    const action = object.verbs[verb];
    if (!action) return `${object.label}: no ${verb} tool${object.hostOwned ? ` — ${object.hostOwned}` : ""}`;
    const supply = object.supply(well);
    if (verb !== "create" && supply.state === "missing") return `${object.label}: ${supply.detail} for ${well.label} · create ${object.id} to start one`;
    openPanel(action.panel, action.tab);
    for (const extra of action.also ?? []) openPanel(extra);
    return `${verb} ${object.label}${action.where ? ` · ${action.where}` : ""} · ${supply.detail}`;
  };
  const launch = (tool: DomainTool): string => {
    if (!tool.open) return `${tool.label}: not built yet · needs ${tool.needs}`;
    if ("route" in tool.open) { router.push(tool.open.route); return `${tool.label}${tool.open.where ? ` · ${tool.open.where}` : ""}`; }
    openPanel(tool.open.panel, tool.open.tab);
    for (const extra of tool.open.also ?? []) openPanel(extra);
    return `${tool.label}${tool.open.where ? ` · ${tool.open.where}` : ""}${tool.status === "partial" ? " · partial" : ""}`;
  };
  return <ToolsContext.Provider value={{ open, document, link, setLink, requests, paletteOpen, setPaletteOpen, ribbonOpen, setRibbonOpen, phone, constructionHost, setConstructionHost, designHost, setDesignHost, launch, openPanel, closePanel, run }}>
    <Suspense fallback={null}><ToolDeepLink /></Suspense>
    {children}
  </ToolsContext.Provider>;
}

/**
 * `?tool=<document>` on the sheet opens that document; the sheet with no tool opens the well
 * section. Read through useSearchParams inside its own Suspense boundary, which is what a
 * statically exported page needs to read the query on the client.
 */
function ToolDeepLink() {
  const tools = useTools();
  const pathname = usePathname();
  const params = useSearchParams();
  const tool = params.get("tool");
  useEffect(() => {
    if (pathname.replace(/\/$/, "") !== SHEET.replace(/\/$/, "")) { tools.setLink(null); return; }
    tools.setLink(tool);
    // The survey is the section with its summary and station editor beside it, not a document.
    if (tool === "trajectory") { if (tools.document !== "section") tools.openPanel("section"); tools.openPanel("survey-summary"); tools.openPanel("stations"); return; }
    // The study is the section with its steps beside it and its evidence under it.
    if (tool === "study") { if (tools.document !== "section") tools.openPanel("section"); tools.openPanel("study"); return; }
    // The editor is the section's Edit view with the construction tool beside it.
    if (tool === "edit-well") { tools.openPanel("section", "edit"); tools.openPanel("construction"); return; }
    // The brief is the section's Design view with the design tool beside it.
    if (tool === "brief") { tools.openPanel("section", "design"); tools.openPanel("design"); return; }
    const wanted = tool && isDocument(tool) ? tool : "section";
    if (tools.document !== wanted) tools.openPanel(wanted);
    // The field's documents come with the field's tools: the register and the trajectory inspector.
    // The correlation and the cross-section keep their width for the plots; the trajectory inspector stays a ribbon tool there.
    if (wanted === "field" || wanted === "correlation" || wanted === "cross-section") tools.openPanel("field-register");
    if (wanted === "field") tools.openPanel("field-trajectory");
  }, [pathname, tool]); // tools.openPanel is stable per provider
  return null;
}

/**
 * The old routes forward to the sheet. The query comes along — a well, a component — because the
 * links that carried it still mean the same thing on the sheet.
 */
export function ForwardToSheet({ document }: { readonly document: string }) {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const query: Record<string, string> = {};
    params.forEach((value, key) => { query[key] = value; });
    router.replace(documentHref(document as ToolPanelId, query));
  }, [document, params, router]);
  return <p className="demo-forwarding" role="status" data-forwarding={document}>Opening {documentLabels[document] ?? document} on the sheet…</p>;
}

const verbIcons: Readonly<Record<ToolVerb, CommandIconName>> = { view: "view", create: "add", edit: "edit", delete: "remove" };

/** The palette: objects by group, the host's supply of each, and a button per verb. */
export function ToolsPalette() {
  const tools = useTools();
  const { well } = useWorkspace();
  const [echo, setEcho] = useState<string | null>(null);
  const groups = Array.from(new Set(toolObjects.map((object) => object.group))) as ToolGroup[];
  return <FloatingPanel id="tools" title="Tools" detail={well.label} tray={false} open={tools.paletteOpen} onOpenChange={tools.setPaletteOpen} defaultDock="left" defaultStyle={{ left: "calc(var(--dock-left, 0px) + 12px)", top: "calc(var(--dock-top, 0px) + 56px)", width: 360 }} className="demo-tools-float" scrollable>
    <div className="demo-tools" data-testid="tools-palette">
      {groups.map((group) => <section key={group} className="demo-tools-group" aria-label={toolGroupLabels[group]}>
        <h3>{toolGroupLabels[group]}</h3>
        {toolObjects.filter((object) => object.group === group).map((object) => {
          const supply = object.supply(well);
          return <div key={object.id} className="demo-tools-row" data-supply={supply.state} data-object={object.id}>
            <div className="demo-tools-name"><span>{object.label}</span><small>{supply.detail}</small></div>
            <div className="demo-tools-verbs" role="group" aria-label={`${object.label} tools`}>
              {toolVerbs.map((verb) => {
                const action = object.verbs[verb];
                const blocked = !action || (verb !== "create" && supply.state === "missing");
                return <CommandButton key={verb} icon={verbIcons[verb]} aria-label={`${verb} ${object.label}`} disabled={blocked}
                  title={action ? `${verb} · ${action.where ?? action.panel}` : object.hostOwned ?? `no ${verb} tool`}
                  onClick={() => setEcho(tools.run(verb, object.id))} />;
              })}
            </div>
          </div>;
        })}
      </section>)}
      <p className="demo-tools-echo" aria-live="polite">{echo ?? "View, create, edit or delete an object of the well. A tool opens the object's data when the host has supplied it."}</p>
    </div>
  </FloatingPanel>;
}

/**
 * The ribbon: a tab per sub-domain, an icon per tool. Built tools open; partial tools open the
 * nearest thing they have and say so; planned tools are greyed with what they need as the tooltip,
 * so the whole scope of docs/SUBSURFACE_DOMAIN_STUDY.md is on the sheet, not in a document.
 */
export function ToolsRibbon({ headExtra }: { readonly headExtra?: ReactNode }) {
  const tools = useTools();
  const [domain, setDomain] = useState<SubDomain>("drilling");
  const [echo, setEcho] = useState<string | null>(null);
  const visible = domainTools.filter((tool) => tool.domain === domain);
  const built = visible.filter((tool) => tool.status !== "planned").length;
  return <FloatingPanel id="ribbon" title="Tool ribbon" detail={echo ?? `${built} of ${visible.length} ${subDomains.find((entry) => entry.id === domain)?.label.toLowerCase()} tools built`} open={tools.ribbonOpen} onOpenChange={tools.setRibbonOpen} defaultDock="top" dockSize={138} defaultStyle={{ left: "calc(var(--dock-left, 0px) + 12px)", top: "calc(var(--dock-top, 0px) + 100px)", width: "min(1100px, calc(100vw - 24px))" }} className="demo-ribbon-float" headExtra={headExtra}>
    <div className="demo-ribbon" data-testid="tool-ribbon">
      <div className="demo-ribbon-tabs" role="tablist" aria-label="Sub-domains">
        {subDomains.map((entry) => <CommandButton key={entry.id} kind="selection" role="tab" aria-selected={domain === entry.id} className="demo-ribbon-tab" onClick={() => setDomain(entry.id)}>{entry.label}</CommandButton>)}
      </div>
      <div className="demo-ribbon-tools" role="group" aria-label={`${subDomains.find((entry) => entry.id === domain)?.label} tools`}>
        {visible.map((tool) => {
          const Icon = ribbonIcons[tool.icon] ?? Layers;
          return <CommandButton key={tool.id} kind="selection" className="demo-ribbon-tool" data-status={tool.status} aria-label={tool.label}
            title={tool.status === "planned" ? `${tool.label} — not built yet. Needs ${tool.needs}.` : `${tool.does}${tool.status === "partial" ? " (partial)" : ""}`}
            aria-disabled={tool.status === "planned" || undefined} onClick={() => setEcho(tools.launch(tool))}>
            <span className="demo-ribbon-icon"><Icon size={20} strokeWidth={1.6} aria-hidden="true" /></span>
            <span>{tool.label}</span>
          </CommandButton>;
        })}
      </div>
    </div>
  </FloatingPanel>;
}

const panelTitles: Readonly<Record<ToolPanelId, string>> = {
  ...documentLabels as Record<ToolPanelId, string>,
  inspector: "Inspector", "well-file": "Well file",
  kick: "Kick tolerance", cement: "Cement volumes", time: "Time breakdown", hydraulics: "Hydraulics",
};

function DocumentBody({ document }: { readonly document: ToolPanelId }) {
  switch (document) {
    case "section": return <><ViewWellDemo /><ViewWellUsage /></>;
    case "report": return <WorkspaceRoute current="/well-report/"><WellReportDemo /></WorkspaceRoute>;
    case "field": return <FieldWorkspace tool="spatial" />;
    case "correlation": return <FieldWorkspace tool="correlation" />;
    case "cross-section": return <FieldWorkspace tool="section" />;
    case "petrophysics": return <WorkspaceRoute current="/petrophysics/"><PetrophysicsDemo /></WorkspaceRoute>;
    case "production": return <WorkspaceRoute current="/production/"><ProductionSurveillanceDemo /></WorkspaceRoute>;
    case "linked-data": return <WorkspaceRoute current="/linked-data/"><LinkedDataDemo /></WorkspaceRoute>;
    case "sandbox": return <WorkspaceRoute current="/sandbox/"><WebGpuSandbox /></WorkspaceRoute>;
    default: return null;
  }
}

/** The documents and calculators as panels, mounted when a tool opens them. */
export function ToolPanels() {
  const tools = useTools();
  const panels = Array.from(tools.open);
  return <>{panels.map((panel) => {
    const side = sidePanels.has(panel), bottom = bottomPanels.has(panel);
    return <FloatingPanel key={panel} id={`tool-${panel}`} title={panelTitles[panel]} tray={false} open onOpenChange={(open) => { if (!open) tools.closePanel(panel); }} defaultDock={bottom ? "bottom" : side ? "right" : "fill"} dockSize={bottom ? 330 : side ? dockSizes[panel] ?? 320 : undefined} defaultStyle={{ left: side ? "max(8px, min(40px, 100vw - 428px))" : 40, top: 60, width: side ? "min(420px, calc(100vw - 16px))" : "min(1200px, calc(100vw - 80px))" }} className={side ? "demo-tool-panel demo-tool-side" : `demo-tool-panel demo-document demo-document-${panel}`} scrollable={side || panel !== "section"} headless={panel === "section"}>
      <Suspense fallback={<p role="status">Loading…</p>}>
        <div className="demo-page demo-tool-page" data-document={isDocument(panel) ? panel : undefined}>
          {panel === "kick" && <KickToleranceTool />}
          {panel === "cement" && <CementVolumesTool />}
          {panel === "time" && <TimeBreakdownTool />}
          {panel === "hydraulics" && <HydraulicsTool />}
          {panel === "planner" && <TrajectoryPlannerTool />}
          {panel === "stations" && <StationEditorTool />}
          {panel === "survey-summary" && <SurveySummaryTool />}
          {panel === "study" && <StudyTool />}
          {panel === "evidence" && <EvidenceTool />}
          {panel === "construction" && <ConstructionTool />}
          {panel === "well-properties" && <WellPropertiesTool />}
          {panel === "component-records" && <ComponentRecordsTool />}
          {panel === "formations" && <FormationsTool />}
          {panel === "records-data" && <RecordsDataTool />}
          {panel === "field-register" && <FieldRegisterTool />}
          {panel === "field-trajectory" && <FieldTrajectoryTool />}
          {panel === "design" && <DesignTool />}
          {isDocument(panel) && <DocumentBody document={panel} />}
        </div>
      </Suspense>
    </FloatingPanel>;
  })}</>;
}

export { documentRoutes };
