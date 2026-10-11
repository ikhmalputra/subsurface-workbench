"use client";

import Link from "next/link";
import { useState } from "react";
import { useWorkspace } from "./workspace-provider";
import { developerViews, workspaces, workspaceForRoute } from "../lib/workspace-routes";
import { CommandButton, CommandIcon } from "@ikhmalputra/subsurface-react/ui";

export function WorkspaceNavigation({ current }: { current?: string }) {
  const [expanded, setExpanded] = useState(false);
  const { theme, setTheme, density, setDensity } = useWorkspace();
  const activeWorkspace = workspaceForRoute(current ?? "");
  return <nav className="demo-nav" aria-label="Workbench navigation">
    <Link href="/" className="demo-brand" aria-label="Subsurface Workbench showcase home">
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 2v20M7 6h10M8 11h8M9 16h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /></svg>
      <span>Subsurface<small>WORKBENCH</small></span>
    </Link>
    <CommandButton icon={expanded ? "close" : "menu"} className="demo-nav-toggle" type="button" aria-expanded={expanded} aria-controls="workspace-navigation-items" onClick={() => setExpanded(!expanded)}>
      {expanded ? "Close navigation" : "Open navigation"}
    </CommandButton>
    <div id="workspace-navigation-items" className={`demo-nav-content${expanded ? " is-expanded" : ""}`}>
      <div className="demo-nav-group" role="group" aria-label="Workspaces">
        <span>Workspaces</span>
        {workspaces.map((item) => <Link key={item.id} href={item.entry} aria-current={activeWorkspace?.id === item.id ? "true" : undefined} onClick={() => setExpanded(false)}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d={item.icon} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>{item.label}<small aria-hidden="true">{item.detail}</small></span>
        </Link>)}
      </div>
      {activeWorkspace && <div className="demo-nav-views" role="group" aria-label={`${activeWorkspace.label} views`}>
        <span>{activeWorkspace.label} views</span>
        {activeWorkspace.views.map((view) => <Link key={view.href} href={view.href} aria-current={current === view.href ? "page" : undefined} onClick={() => setExpanded(false)}><CommandIcon name="view" />{view.label}</Link>)}
      </div>}
      <div className="demo-nav-secondary" role="group" aria-label="Outputs">
        <Link href="/well-report/" aria-current={current === "/well-report/" ? "page" : undefined} onClick={() => setExpanded(false)}><CommandIcon name="print" />Well report</Link>
      </div>
      <details className="demo-nav-secondary" open={developerViews.some((view) => view.href === current)}>
        <summary>Developer examples</summary>
        {developerViews.map((view) => <Link key={view.href} href={view.href} aria-current={current === view.href ? "page" : undefined} onClick={() => setExpanded(false)}>{view.label}</Link>)}
      </details>
      <details className="demo-nav-secondary">
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
      </details>
      <p className="demo-nav-foot">Local workspace<span>Source records stay unchanged.</span></p>
    </div>
  </nav>;
}
