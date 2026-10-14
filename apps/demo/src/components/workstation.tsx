"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@ikhmalputra/subsurface-react/ui";
import { Layers } from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { useTools, ribbonIcons } from "./tools";
import { useDocks, type DockSide } from "./floating";
import { WorkspaceContextBar } from "./workspace-context-bar";
import { documentHref, domainTools, ribbonDomains, ribbonGroups, subDomains, toolGroupLabels, toolObjects, type DomainTool, type SubDomain, type ToolGroup } from "../lib/tools";

/**
 * The workstation chrome.
 *
 * Every modern engineering application — SolidWorks, Fusion, Onshape — has settled on the same
 * three regions: a browser of the model, the drawing, and one inspector that follows the
 * selection. This is that shape. The ribbon slab, the four-sided docking and the toolbars that
 * sat on top of the drawing are gone: tools are a single row of icons in the top bar, the well's
 * own objects are the browser, and a tool that opens takes the inspector column rather than a
 * piece of the sheet.
 */

/**
 * The top bar: who you are looking at, and the way to find anything. One row, 44px.
 *
 * It deliberately carries no tool buttons. A strip of seventeen unlabelled icons says nothing
 * about what any of them does; the tools live in the browser, where there is room to name them.
 */
export function TopBar({ onFind, rail, onRail }: { readonly onFind: () => void; readonly rail: boolean; readonly onRail: () => void }) {
  const tools = useTools();
  const router = useRouter();
  return <header className="swx-bar" data-testid="workstation-bar">
    <CommandButton icon="layers" className="swx-rail-toggle" aria-pressed={rail} aria-label={rail ? "Hide the well browser" : "Show the well browser"} onClick={onRail} />
    <span className="swx-brand"><span className="swx-mark" aria-hidden="true">S</span>Subsurface</span>
    <CommandButton icon="globe" className="swx-map" kind="selection" aria-pressed={tools.document === "field"} onClick={() => router.push(documentHref("field"))}>Map</CommandButton>
    <span className="swx-sep" aria-hidden="true" />
    <WorkspaceContextBar part="picker" />
    {/* What the sheet is showing. The open document fills this; it is view state, so it belongs
        with the well's identity rather than on a pill resting over the drawing. */}
    <div className="swx-bar-slot" ref={tools.setBarHost} />
    <div className="swx-bar-end">
      <CommandButton icon="inspect" className="swx-find" onClick={onFind}>Find a tool <kbd>⌘K</kbd></CommandButton>
      <AppearanceMenu />
    </div>
  </header>;
}

/** Theme and density, where a CAD tool keeps its display toggles. */
function AppearanceMenu() {
  const { theme, setTheme, density, setDensity } = useWorkspace();
  const [open, setOpen] = useState(false);
  return <details className="demo-nav-secondary demo-appearance swx-appearance" open={open}>
    <summary onClick={(event) => { event.preventDefault(); setOpen((value) => !value); }}>Appearance</summary>
    <div className="demo-appearance-controls" role="group" aria-label="Visualization appearance">
      <label>Theme<select value={theme} onChange={(event) => setTheme(event.currentTarget.value as typeof theme)}>
        <option value="light">Light</option><option value="dark">Dark</option><option value="high-contrast">High contrast</option>
      </select></label>
      <label>Density<select value={density} onChange={(event) => setDensity(event.currentTarget.value as typeof density)}>
        <option value="comfortable">Comfortable</option><option value="compact">Compact</option>
      </select></label>
    </div>
  </details>;
}

/**
 * The browser: what this well is, and what can be done to it.
 *
 * Two tabs, because they answer two different questions. **Well** is the well's own objects, with
 * a dot for what the host actually supplied, so the record is readable before anything is opened.
 * **Tools** is every working tool of a sub-domain, named and described — a vertical list has the
 * room to say what a thing does, which a row of icons never had.
 */
export function WellBrowser() {
  const [tab, setTab] = useState<"well" | "tools">("well");
  return <nav className="swx-rail" aria-label="Well browser">
    <div className="swx-rail-tabs" role="tablist" aria-label="Browser">
      {([["well", "Well"], ["tools", "Tools"]] as const).map(([id, label]) =>
        <CommandButton key={id} kind="selection" role="tab" className="swx-rail-tab" aria-selected={tab === id}
          onClick={() => setTab(id)}>{label}</CommandButton>)}
    </div>
    {tab === "well" ? <WellTree /> : <ToolCatalogue />}
  </nav>;
}

const VERB_ICONS = { view: "view", create: "add", edit: "edit", delete: "remove" } as const;

function WellTree() {
  const tools = useTools();
  const { well } = useWorkspace();
  const groups = Array.from(new Set(toolObjects.map((object) => object.group))) as ToolGroup[];
  return <div className="swx-tree" data-testid="well-browser">
    {groups.map((group) => <section key={group} className="swx-tree-group" aria-label={toolGroupLabels[group]}>
      <h3>{toolGroupLabels[group]}</h3>
      {toolObjects.filter((object) => object.group === group).map((object) => {
        const supply = object.supply(well);
        const target = object.verbs.view;
        return <div key={object.id} className="swx-node-row" data-object={object.id} data-supply={supply.state}>
          <CommandButton kind="selection" className="swx-node"
            aria-current={target && tools.open.has(target.panel) ? "true" : undefined}
            disabled={!target || supply.state === "missing"}
            title={target ? `View ${object.label.toLowerCase()} · ${supply.detail}` : object.hostOwned ?? "no view tool"}
            onClick={() => tools.run("view", object.id)}>
            <span className="swx-dot" aria-hidden="true" />
            <span className="swx-node-text">
              <span className="swx-node-name">{object.label}</span>
              <small className="swx-node-detail">{target ? supply.detail : object.hostOwned ?? "no view tool"}</small>
            </span>
          </CommandButton>
          {/* Create, edit and delete, where the object declares them. The model carries 45 actions
              across these 19 objects and this browser offered only the 19 views, so two thirds of
              what the well can have done to it had no control anywhere. A verb is shown only when
              the object has it, and disabled when the host has supplied nothing to act on. */}
          <span className="swx-node-verbs" role="group" aria-label={`${object.label} actions`}>
            {(["create", "edit", "delete"] as const).filter((verb) => object.verbs[verb]).map((verb) => <CommandButton
              key={verb} icon={VERB_ICONS[verb]} className="swx-verb" aria-label={`${verb} ${object.label.toLowerCase()}`}
              title={`${verb[0]!.toUpperCase()}${verb.slice(1)} · ${object.verbs[verb]!.where ?? object.verbs[verb]!.panel}`}
              disabled={verb !== "create" && supply.state === "missing"}
              onClick={() => tools.run(verb, object.id)} />)}
          </span>
        </div>;
      })}
    </section>)}
  </div>;
}

function ToolCatalogue() {
  const tools = useTools();
  const [domain, setDomain] = useState<SubDomain>("drilling");
  const live = domainTools.filter((tool) => tool.domain === domain && tool.status !== "planned");
  const planned = domainTools.filter((tool) => tool.domain === domain && tool.status === "planned").length;
  // The clusters the domain study gives each tool, in the order the tools arrive.
  const clusters = live.reduce<{ name: string; members: DomainTool[] }[]>((all, tool) => {
    const name = ribbonGroups[tool.id] ?? subDomains.find((entry) => entry.id === domain)?.label ?? "Tools";
    const found = all.find((entry) => entry.name === name);
    if (found) found.members.push(tool); else all.push({ name, members: [tool] });
    return all;
  }, []);
  return <div className="swx-tree" data-testid="tool-catalogue">
    <label className="swx-rail-domain">
      <span className="sw-sr-only">Sub-domain</span>
      <select aria-label="Sub-domain" value={domain} onChange={(event) => setDomain(event.currentTarget.value as SubDomain)}>
        {ribbonDomains.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
      </select>
    </label>
    {clusters.map(({ name, members }) => <section key={name} className="swx-tree-group" aria-label={`${name} tools`}>
      <h3>{name}</h3>
      {members.map((tool) => {
        const Icon = ribbonIcons[tool.icon] ?? Layers;
        return <CommandButton key={tool.id} kind="selection" className="swx-node swx-tool-node" data-status={tool.status}
          aria-label={tool.label} onClick={() => tools.launch(tool)}>
          <Icon size={16} strokeWidth={1.7} aria-hidden="true" className="swx-node-icon" />
          <span className="swx-node-text">
            <span className="swx-node-name">{tool.label}</span>
            <small className="swx-node-detail">{tool.does}</small>
          </span>
        </CommandButton>;
      })}
    </section>)}
    {planned > 0 && <p className="swx-rail-note">{planned} more {subDomains.find((entry) => entry.id === domain)?.label.toLowerCase()} tools are planned. They are listed in the domain study, not shown here as buttons that open nothing.</p>}
  </div>;
}

/**
 * A docked region: a tab per panel on that side, and the host the panels render into.
 *
 * One component for both regions, taking the side as a prop. It was written twice before, hardcoding
 * "right", which meant a shelf tab would have called `activate("right", id)` — and the registry
 * silently ignores an activate for the wrong side, so they would have been dead buttons with no
 * error anywhere.
 */
function DockRegion({ side, label, className, setHost }: { readonly side: DockSide; readonly label: string; readonly className: string; readonly setHost: (element: HTMLElement | null) => void }) {
  const registry = useDocks();
  const open = Array.from(registry.docks.entries()).filter(([, entry]) => entry.dock === side);
  const active = registry.active[side] ?? open[open.length - 1]?.[0];
  return <aside className={className} aria-label={label}>
    {open.length > 1 && <div className="swx-region-tabs demo-float-tabs" role="tablist" aria-label={`${label} tools`}>
      {open.map(([id, entry]) => <CommandButton key={id} kind="selection" role="tab" className="swx-region-tab"
        aria-selected={active === id} title={entry.title} onClick={() => registry.activate(side, id)}>{entry.title}</CommandButton>)}
    </div>}
    <div className="swx-region-body" ref={setHost} />
  </aside>;
}

/** Forms that act on the selection. */
export function InspectorColumn({ setHost }: { readonly setHost: (element: HTMLElement | null) => void }) {
  return <DockRegion side="right" label="Inspector" className="swx-insp" setHost={setHost} />;
}

/** Registers, tables and charts, at window width under the sheet. */
export function Shelf({ setHost }: { readonly setHost: (element: HTMLElement | null) => void }) {
  return <DockRegion side="bottom" label="Records" className="swx-shelf" setHost={setHost} />;
}

/** The status line: the command line, then the read-outs, where a drafting tool keeps them. */
export function StatusLine({ command }: { readonly command: ReactNode }) {
  return <footer className="swx-foot" data-testid="workstation-status">
    {command}
    <div className="swx-foot-end"><WorkspaceContextBar part="readouts" /></div>
  </footer>;
}
