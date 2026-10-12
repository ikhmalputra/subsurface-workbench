"use client";

import Link from "next/link";
import { useState } from "react";
import { developerViews, workspaces, workspaceForRoute } from "../lib/workspace-routes";
import { CommandButton, CommandIcon } from "@ikhmalputra/subsurface-react/ui";

export function WorkspaceNavigation({ current }: { current?: string }) {
  const [expanded, setExpanded] = useState(false);
  const activeWorkspace = workspaceForRoute(current ?? "");
  // The brand and the appearance menu live on the command bar; this is the tool rail: the four
  // workspaces, the report, and the developer examples, as icons with a word under each.
  return <nav className="demo-nav" aria-label="Workbench navigation">
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
      <details className="demo-nav-secondary demo-nav-dev" open={developerViews.some((view) => view.href === current)}>
        <summary><CommandIcon name="settings" />Developer examples</summary>
        {developerViews.map((view) => <Link key={view.href} href={view.href} aria-current={current === view.href ? "page" : undefined} onClick={() => setExpanded(false)}>{view.label}</Link>)}
      </details>
      <p className="demo-nav-foot">Local workspace<span>Source records stay unchanged.</span></p>
    </div>
  </nav>;
}
