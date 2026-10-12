"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Workbench } from "@ikhmalputra/subsurface-shell";
import { useWorkspace } from "./workspace-provider";
import { WorkspaceContextBar } from "./workspace-context-bar";
import { WorkspaceNavigation } from "./workspace-navigation";
import { wells } from "./wells-data";
import { workspaceForRoute, workspaces } from "../lib/workspace-routes";

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
 * The frame is the Adobe/AutoCAD one: a command bar with the brand and the appearance menu, a
 * document tab strip for the active workspace's views, the tool rail down the left, the drafting
 * canvas in the middle, and a status bar with a command line and the coordinate read-outs. The
 * chrome is graphite in every theme; the canvas and the panels take the theme.
 */
export function WorkbenchFrame({ children }: { children: ReactNode }) {
  const { well, theme, density } = useWorkspace();
  const pathname = usePathname();
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
  const current = pathname === "/" || pathname.endsWith("/") ? pathname : `${pathname}/`;
  const workspace = workspaceForRoute(current);
  return <Workbench
    brand={<Link href="/" className="demo-brand" aria-label="Subsurface Workbench showcase home">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 2v20M7 6h10M8 11h8M9 16h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /></svg>
      <span>Subsurface<small>WORKBENCH</small></span>
    </Link>}
    commands={<AppearanceMenu />}
    sidebar={<WorkspaceNavigation current={current} />}
    options={<>
      {workspace && <DocumentTabs workspace={workspace} current={current} />}
      <WorkspaceContextBar />
    </>}
    status={<>
      <CommandLine />
      <span>Well <strong>{well.label}</strong></span>
      <span>Source <strong>{well.design.provenance}</strong></span>
      <span>Appearance <strong>{theme} · {density}</strong></span>
    </>}
  >
    <div className="demo-page">{children}</div>
  </Workbench>;
}

/**
 * The active workspace's views as document tabs, the way an editor shows its open documents. They
 * are links, not buttons: each is a route, and the navigation's own list of the same views stays
 * in the DOM for the phone menu, hidden on wide screens so the two never both answer to a name.
 */
function DocumentTabs({ workspace, current }: { readonly workspace: (typeof workspaces)[number]; readonly current: string }) {
  return <nav className="demo-doc-tabs" aria-label={`${workspace.label} documents`}>
    {workspace.views.map((view) => <Link key={view.href} href={view.href} aria-current={current === view.href ? "page" : undefined}>{view.label}</Link>)}
  </nav>;
}

/** Theme and density, as a menu on the command bar rather than a disclosure at the foot of the navigation. */
function AppearanceMenu() {
  const { theme, setTheme, density, setDensity } = useWorkspace();
  return <details className="demo-nav-secondary demo-appearance">
    <summary>Appearance</summary>
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

const HELP = "go <m MD> · zoom in | out | fit · well <name> · theme light | dark | high-contrast · density compact | comfortable · clear";

/**
 * The command line, as AutoCAD has it: every verb here is something the interface also does with a
 * control, written to the same store, so a typed `go 1558` and a click on the ruler are the same
 * event. Nothing is persisted and nothing is invented: a depth outside the well is refused with the
 * well's own range.
 */
function CommandLine() {
  const { store, well, chooseWell, setTheme, setDensity } = useWorkspace();
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
