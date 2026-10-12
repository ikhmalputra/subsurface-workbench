"use client";

import { createContext, Suspense, useContext, useState, type ReactNode } from "react";
import { CommandButton } from "@ikhmalputra/subsurface-react/ui";
import type { CommandIconName } from "@ikhmalputra/subsurface-react/ui";
import { FloatingPanel } from "./floating";
import { useWorkspace } from "./workspace-provider";
import { findToolObject, toolGroupLabels, toolObjects, toolVerbs, type ToolGroup, type ToolPanelId, type ToolVerb } from "../lib/tools";
import { TrajectoryDemo } from "./trajectory-demo";
import { AnalysisWorkspace } from "./analysis-workspace";
import { DemoWellBuilder } from "./demo-well-builder";
import { WellReportDemo } from "./well-report-demo";
import { FieldWorkspace } from "./field-workspace";
import { EditWellDemo } from "./edit-well-demo";

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
  readonly requests: Readonly<Record<string, number>>;
  readonly paletteOpen: boolean;
  readonly setPaletteOpen: (open: boolean) => void;
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

const routePanels: ReadonlySet<ToolPanelId> = new Set(["trajectory", "study", "brief", "report", "field", "edit-well"]);

export function ToolsProvider({ children }: { readonly children: ReactNode }) {
  const { well } = useWorkspace();
  const [open, setOpen] = useState<ReadonlySet<ToolPanelId>>(() => new Set());
  const [requests, setRequests] = useState<Readonly<Record<string, number>>>({});
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPanel = (panel: ToolPanelId) => {
    if (routePanels.has(panel)) setOpen((current) => current.has(panel) ? current : new Set([...current, panel]));
    else setRequests((current) => ({ ...current, [panel]: (current[panel] ?? 0) + 1 }));
  };
  const closePanel = (panel: ToolPanelId) => setOpen((current) => { if (!current.has(panel)) return current; const next = new Set(current); next.delete(panel); return next; });
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
  return <ToolsContext.Provider value={{ open, requests, paletteOpen, setPaletteOpen, openPanel, closePanel, run }}>{children}</ToolsContext.Provider>;
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

const panelTitles: Readonly<Record<ToolPanelId, string>> = {
  trajectory: "Survey", study: "Drilling study", brief: "Design brief", report: "Well report", field: "Field", "edit-well": "Edit well", inspector: "Inspector", "well-file": "Well file",
};

/** The route workspaces as panels, mounted when a tool opens them. */
export function ToolPanels() {
  const tools = useTools();
  const panels = Array.from(tools.open);
  return <>{panels.map((panel) => <FloatingPanel key={panel} id={`tool-${panel}`} title={panelTitles[panel]} tray={false} open onOpenChange={(open) => { if (!open) tools.closePanel(panel); }} defaultDock="fill" defaultStyle={{ left: 40, top: 60, width: "min(1200px, calc(100vw - 80px))" }} className="demo-tool-panel" scrollable>
    <Suspense fallback={<p role="status">Loading…</p>}>
      <div className="demo-page demo-tool-page">
        {panel === "trajectory" && <TrajectoryDemo />}
        {panel === "study" && <AnalysisWorkspace />}
        {panel === "brief" && <DemoWellBuilder />}
        {panel === "report" && <WellReportDemo />}
        {panel === "field" && <FieldWorkspace tool="spatial" />}
        {panel === "edit-well" && <EditWellDemo />}
      </div>
    </Suspense>
  </FloatingPanel>)}</>;
}
