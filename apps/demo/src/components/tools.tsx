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
import { BuilderUsage } from "./builder-usage";
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
import { TrajectoryDemo } from "./trajectory-demo";
import { AnalysisWorkspace } from "./analysis-workspace";
import { DemoWellBuilder } from "./demo-well-builder";
import { WellReportDemo } from "./well-report-demo";
import { FieldWorkspace } from "./field-workspace";
import { EditWellDemo } from "./edit-well-demo";
import { CementVolumesTool, HydraulicsTool, KickToleranceTool, TimeBreakdownTool } from "./drilling-tools";

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
  readonly requests: Readonly<Record<string, number>>;
  readonly paletteOpen: boolean;
  readonly setPaletteOpen: (open: boolean) => void;
  readonly ribbonOpen: boolean;
  readonly setRibbonOpen: (open: boolean) => void;
  /** Open a sub-domain tool from the ribbon; returns the line to echo. */
  readonly launch: (tool: DomainTool) => string;
  readonly openPanel: (panel: ToolPanelId) => void;
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

/** The small calculators dock beside the inspector; the documents fill the sheet. */
const sidePanels: ReadonlySet<ToolPanelId> = new Set(["kick", "cement", "time", "hydraulics"]);

export function ToolsProvider({ children }: { readonly children: ReactNode }) {
  const { well } = useWorkspace();
  const [open, setOpen] = useState<ReadonlySet<ToolPanelId>>(() => new Set());
  const [requests, setRequests] = useState<Readonly<Record<string, number>>>({});
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [ribbonOpen, setRibbonOpen] = useState(true);
  const router = useRouter();
  // A phone has no room for a docked ribbon; it starts as a tray tab there.
  useEffect(() => { if (window.matchMedia("(max-width: 760px)").matches) setRibbonOpen(false); }, []);
  // One document at a time: opening one puts the others away, the way a drawing is the active
  // drawing. Side panels stack beside it; the well view's own panels are asked for by request.
  const openPanel = (panel: ToolPanelId) => {
    if (isDocument(panel)) setOpen((current) => { const next = new Set<ToolPanelId>(); for (const id of current) if (!isDocument(id)) next.add(id); next.add(panel); return next; });
    else if (sidePanels.has(panel)) setOpen((current) => current.has(panel) ? current : new Set([...current, panel]));
    else setRequests((current) => ({ ...current, [panel]: (current[panel] ?? 0) + 1 }));
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
    openPanel(action.panel);
    return `${verb} ${object.label}${action.where ? ` · ${action.where}` : ""} · ${supply.detail}`;
  };
  const launch = (tool: DomainTool): string => {
    if (!tool.open) return `${tool.label}: not built yet · needs ${tool.needs}`;
    if ("route" in tool.open) { router.push(tool.open.route); return `${tool.label}${tool.open.where ? ` · ${tool.open.where}` : ""}`; }
    openPanel(tool.open.panel);
    return `${tool.label}${tool.open.where ? ` · ${tool.open.where}` : ""}${tool.status === "partial" ? " · partial" : ""}`;
  };
  return <ToolsContext.Provider value={{ open, document, requests, paletteOpen, setPaletteOpen, ribbonOpen, setRibbonOpen, launch, openPanel, closePanel, run }}>
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
    if (pathname.replace(/\/$/, "") !== SHEET.replace(/\/$/, "")) return;
    const wanted = tool && isDocument(tool) ? tool : "section";
    if (tools.document !== wanted) tools.openPanel(wanted);
  }, [pathname, tool]); // tools.openPanel is stable per provider
  return null;
}

/**
 * The old routes forward to the sheet. The query comes along — a well, a component — because the
 * links that carried it still mean the same thing on the sheet.
 */
export function ForwardToSheet({ document }: { readonly document: ToolPanelId }) {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const query: Record<string, string> = {};
    params.forEach((value, key) => { query[key] = value; });
    router.replace(documentHref(document, query));
  }, [document, params, router]);
  return <p className="demo-forwarding" role="status" data-forwarding={document}>Opening {documentLabels[document]} on the sheet…</p>;
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
export function ToolsRibbon() {
  const tools = useTools();
  const [domain, setDomain] = useState<SubDomain>("drilling");
  const [echo, setEcho] = useState<string | null>(null);
  const visible = domainTools.filter((tool) => tool.domain === domain);
  const built = visible.filter((tool) => tool.status !== "planned").length;
  return <FloatingPanel id="ribbon" title="Tool ribbon" detail={echo ?? `${built} of ${visible.length} ${subDomains.find((entry) => entry.id === domain)?.label.toLowerCase()} tools built`} open={tools.ribbonOpen} onOpenChange={tools.setRibbonOpen} defaultDock="top" dockSize={138} defaultStyle={{ left: "calc(var(--dock-left, 0px) + 12px)", top: "calc(var(--dock-top, 0px) + 100px)", width: "min(1100px, calc(100vw - 24px))" }} className="demo-ribbon-float">
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
    case "trajectory": return <TrajectoryDemo />;
    case "study": return <AnalysisWorkspace />;
    case "brief": return <><DemoWellBuilder /><BuilderUsage /></>;
    case "report": return <WorkspaceRoute current="/well-report/"><WellReportDemo /></WorkspaceRoute>;
    case "field": return <FieldWorkspace tool="spatial" />;
    case "correlation": return <FieldWorkspace tool="correlation" />;
    case "cross-section": return <FieldWorkspace tool="section" />;
    case "edit-well": return <EditWellDemo />;
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
    const side = sidePanels.has(panel);
    return <FloatingPanel key={panel} id={`tool-${panel}`} title={panelTitles[panel]} tray={false} open onOpenChange={(open) => { if (!open) tools.closePanel(panel); }} defaultDock={side ? "right" : "fill"} dockSize={side ? 320 : undefined} defaultStyle={{ left: 40, top: 60, width: side ? 420 : "min(1200px, calc(100vw - 80px))" }} className={side ? "demo-tool-panel demo-tool-side" : `demo-tool-panel demo-document demo-document-${panel}`} scrollable={side || panel !== "section"} headless={panel === "section"}>
      <Suspense fallback={<p role="status">Loading…</p>}>
        <div className="demo-page demo-tool-page" data-document={isDocument(panel) ? panel : undefined}>
          {panel === "kick" && <KickToleranceTool />}
          {panel === "cement" && <CementVolumesTool />}
          {panel === "time" && <TimeBreakdownTool />}
          {panel === "hydraulics" && <HydraulicsTool />}
          {isDocument(panel) && <DocumentBody document={panel} />}
        </div>
      </Suspense>
    </FloatingPanel>;
  })}</>;
}

export { documentRoutes };
