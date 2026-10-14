"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Workbench } from "@ikhmalputra/subsurface-shell";
import { useWorkspace } from "./workspace-provider";
import { WorkspaceContextBar } from "./workspace-context-bar";
import { WorkspaceNavigation } from "./workspace-navigation";
import { DepthCommand } from "./depth-command";
import { FloatProvider, FloatingToolbar, useDockRegistry } from "./floating";
import { wells } from "./wells-data";
import { ToolPanels, ToolsPalette, ToolsProvider, ToolsRibbon, useTools } from "./tools";
import { SHEET, toolVerbs, type ToolVerb } from "../lib/tools";
import { CommandButton } from "@ikhmalputra/subsurface-react/ui";

/**
 * The application frame, mounted once by `layout.tsx` and never again.
 *
 * It used to be rendered inside every page and handed the route as a prop, which meant the frame
 * was part of the route's own tree: navigating replaced it, and the claim in `Workbench` that the
 * canvas host "is never keyed off the route" was true of the component and false of the
 * application. Panel state, dock collapse and scroll position were rebuilt on every move.
 *
 * Next caches a layout across navigation and does not re-render it, so the frame now outlives the
 * pages inside it. The route still has to reach the navigation, and the way to get it without
 * making the frame a function of the route is `usePathname` — a client component inside the layout
 * does re-render on navigation, so the highlight follows while the frame stays put.
 *
 * There is no header and no sidebar: the sheet is the window. The one strip of chrome is the
 * status bar — a command line, the tray of closed panels, and the depth read-out. The workspace
 * context (the well, its datum, the selection, the navigation toggle) is a toolbar floating over
 * the sheet, and the navigation itself is a panel it opens.
 */
export function WorkbenchFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  const [tray, setTray] = useState<HTMLElement | null>(null);
  const registry = useDockRegistry();
  // Docked panels cost the sheet their edge. The insets are CSS variables on the root so the
  // sheet's padding and every default toolbar position can read them.
  useEffect(() => {
    const root = document.documentElement.style;
    for (const side of ["left", "right", "top", "bottom"] as const) root.setProperty(`--dock-${side}`, `${registry.insets[side]}px`);
  }, [registry.insets.left, registry.insets.right, registry.insets.top, registry.insets.bottom]);
  // One marker saying React is mounted and effects have run.
  //
  // Every route is prerendered, so the markup is interactive-looking before hydration attaches a
  // single handler: a control is present, visible and stable, and an interaction in that window is
  // silently dropped. Controlled inputs make it worse — a <select> changed before hydration is
  // reset to its React value afterwards, so the change does not fail, it disappears.
  //
  // This is for tests and diagnostics, not behaviour: nothing in the application reads it.
  useEffect(() => { document.documentElement.dataset.swHydrated = "true"; }, []);
  // Routes are declared with trailing slashes (`trailingSlash: true`), so normalise rather than
  // letting the active-route highlight silently fail to match.
  const path = pathname === "/" || pathname.endsWith("/") ? pathname : `${pathname}/`;
  return <FloatProvider value={{ layer, tray, registry }}><ToolsProvider>
    <FrameBody path={path} setLayer={setLayer} setTray={setTray}>{children}</FrameBody>
  </ToolsProvider></FloatProvider>;
}

/** The frame proper, inside the tools provider so the navigation can highlight the open document. */
function FrameBody({ path, setLayer, setTray, children }: { readonly path: string; readonly setLayer: (element: HTMLElement | null) => void; readonly setTray: (element: HTMLElement | null) => void; readonly children: ReactNode }) {
  const tools = useTools();
  const current = path === SHEET && tools.link ? `${SHEET}?tool=${tools.link}` : path;
  // The landing page is a page, not the sheet: it gets the navigation and nothing else of the chrome.
  const onSheet = path === SHEET;
  const barInRibbon = onSheet && tools.ribbonOpen && !tools.phone;
  return <>
    <Workbench status={<>
      <CommandLine />
      <div className="demo-tray" ref={setTray} role="group" aria-label="Panels" />
      <WorkspaceContextBar part="readouts" />
      <AppearanceMenu />
    </>}>
      {/* `data-ribbon` lets the sheet's band and the view toolbars size to one row or two in CSS. */}
      <div className="demo-frame-body" data-ribbon={tools.ribbonOpen ? "open" : "closed"}>
        <div className="demo-page">{children}</div>
        <div className="demo-float-layer" ref={setLayer} />
      </div>
    </Workbench>
    {/* The workspace bar — navigation, tools, the well, go-to-depth — rides on the ribbon's title
        row, so it costs the sheet nothing; with the ribbon put away it floats over the sheet. */}
    {!barInRibbon && <FloatingToolbar id="workspace" label="workspace toolbar" defaultStyle={{ left: "calc(var(--dock-left, 0px) + 8px)", top: "calc(var(--dock-top, 0px) + 6px)" }} className="demo-workspace-toolbar">
      {onSheet ? <WorkspaceBar current={current} /> : <WorkspaceNavigation current={current} />}
    </FloatingToolbar>}
    {onSheet && <ToolsRibbon headExtra={barInRibbon ? <div className="demo-workspace-toolbar demo-workspace-bar"><WorkspaceBar current={current} /></div> : undefined} />}
    <ToolsPalette />
    <ToolPanels />
  </>;
}


function WorkspaceBar({ current }: { readonly current: string }) {
  return <>
    <WorkspaceNavigation current={current} />
    <ToolsToggle />
    <WorkspaceContextBar part="picker" />
    <DepthCommand />
  </>;
}

function ToolsToggle() {
  const tools = useTools();
  return <CommandButton icon="layers" className="demo-tools-toggle" aria-expanded={tools.paletteOpen} onClick={() => tools.setPaletteOpen(!tools.paletteOpen)}>{tools.paletteOpen ? "Close finder" : "Find a tool"}</CommandButton>;
}

/**
 * Theme and density as a menu on the status bar, where a CAD tool keeps its display toggles. It
 * opens upward over the corner of the sheet and nothing else, so changing the theme never leaves
 * a panel over the drawing. The click is handled rather than the toggle event: React restores a
 * controlled `open` before the toggle event is dispatched, so a handler reading it there sees
 * the old value.
 */
function AppearanceMenu() {
  const { theme, setTheme, density, setDensity } = useWorkspace();
  const [open, setOpen] = useState(false);
  return <details className="demo-nav-secondary demo-appearance" open={open}>
    <summary onClick={(event) => { event.preventDefault(); setOpen((value) => !value); }}>Appearance</summary>
    <div className="demo-appearance-controls" role="group" aria-label="Visualization appearance">
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
    </div>
  </details>;
}

const HELP = "view | create | edit | delete <object> · go <m MD> · zoom in | out | fit · well <name> · theme light | dark | high-contrast · density compact | comfortable · clear";

/**
 * The command line, as AutoCAD has it: every verb here is something the interface also does with a
 * control, written to the same store, so a typed `go 1558` and a click on the ruler are the same
 * event. Nothing is persisted and nothing is invented: a depth outside the well is refused with the
 * well's own range.
 */
function CommandLine() {
  const { store, well, chooseWell, setTheme, setDensity } = useWorkspace();
  const tools = useTools();
  const [text, setText] = useState("");
  const [echo, setEcho] = useState("Command line · type help");
  function run(line: string): string {
    const [verb = "", ...rest] = line.trim().split(/\s+/);
    const arg = rest.join(" ").trim();
    const v = verb.toLowerCase();
    const td = well.design.totalDepthM;
    const fmt = (value: number) => Math.round(value).toLocaleString("en-US");
    try {
      if (!v) return "";
      if (v === "help" || v === "?") return HELP;
      if ((toolVerbs as readonly string[]).includes(v)) return tools.run(v as ToolVerb, arg);
      if (v === "go" || v === "md") {
        const md = Number(arg);
        if (!arg || !Number.isFinite(md) || md < 0 || md > td) throw new Error(`GO needs an MD between 0 and ${fmt(td)} m`);
        store.pinDepth(well.design.id, md, "command-line");
        return `Depth ${md.toLocaleString("en-US", { maximumFractionDigits: 1 })} m MD`;
      }
      if (v === "zoom") {
        const a = arg.toLowerCase();
        const depth = store.getState().depthLink;
        const current = depth.window ?? ([0, td] as const);
        const span = current[1] - current[0];
        if (a === "fit" || a === "all" || a === "extents" || a === "e") { store.setDepthWindow(null, "command-line"); return "Whole well"; }
        const factor = a === "in" ? 0.6 : a === "out" ? 1 / 0.6 : NaN;
        if (!Number.isFinite(factor)) throw new Error("ZOOM in, out or fit");
        const next = Math.min(td, Math.max(20, span * factor));
        if (next >= td) { store.setDepthWindow(null, "command-line"); return "Whole well"; }
        const pivot = depth.pinnedMdM ?? current[0] + span / 2;
        const ratio = Math.min(1, Math.max(0, (pivot - current[0]) / span));
        const start = Math.min(Math.max(0, pivot - ratio * next), td - next);
        store.setDepthWindow([start, start + next], "command-line");
        return `Window ${fmt(start)}–${fmt(start + next)} m MD`;
      }
      if (v === "well") {
        const q = arg.toLowerCase();
        const match = q ? wells.find((entry) => entry.id === q || entry.label.toLowerCase().includes(q)) : undefined;
        if (!match) throw new Error(`WELL needs one of: ${wells.map((entry) => entry.id).join(", ")}`);
        chooseWell(match.id);
        return `Well ${match.label}`;
      }
      if (v === "theme") {
        if (arg === "light" || arg === "dark" || arg === "high-contrast") { setTheme(arg); return `Theme ${arg}`; }
        throw new Error("THEME light, dark or high-contrast");
      }
      if (v === "density") {
        if (arg === "compact" || arg === "comfortable") { setDensity(arg); return `Density ${arg}`; }
        throw new Error("DENSITY compact or comfortable");
      }
      if (v === "clear" || v === "esc") {
        store.selectComponent(null, "command-line");
        store.pinDepth(well.design.id, null, "command-line");
        return "Selection cleared";
      }
      throw new Error(`Unknown command "${verb}" · type help`);
    } catch (caught) { return caught instanceof Error ? caught.message : String(caught); }
  }
  return <form className="demo-cmdline" onSubmit={(event) => { event.preventDefault(); const result = run(text); if (result) setEcho(result); setText(""); }}>
    <span className="demo-cmdline-prompt" aria-hidden="true">›</span>
    <input aria-label="Command line" value={text} onChange={(event) => setText(event.target.value)} placeholder="Command (help)" autoComplete="off" spellCheck={false} />
    <span className="demo-cmdline-echo" aria-live="polite">{echo}</span>
  </form>;
}
