"use client";

import Link from "next/link";
import { useState } from "react";
import { developerViews, workspaces, workspaceForRoute } from "../lib/workspace-routes";
import { CommandButton, CommandIcon } from "@ikhmalputra/subsurface-react/ui";
import { FloatingPanel } from "./floating";

/**
 * The navigation: a toggle on the workspace toolbar and a floating panel it opens — the four
 * workspaces and the active one's views, the report, the developer examples and the appearance
 * controls. It closes when a destination is chosen, so the sheet is clear again.
 */
export function WorkspaceNavigation({ current }: { current?: string }) {
  const [expanded, setExpanded] = useState(false);
  const activeWorkspace = workspaceForRoute(current ?? "");
  const close = () => setExpanded(false);
  return <>
    <CommandButton icon={expanded ? "close" : "menu"} className="demo-nav-toggle" type="button" aria-expanded={expanded} aria-controls="workspace-navigation-items" onClick={() => setExpanded(!expanded)}>
      {expanded ? "Close navigation" : "Open navigation"}
    </CommandButton>
    <FloatingPanel id="navigation" title="Navigation" tray={false} open={expanded} onOpenChange={setExpanded} defaultStyle={{ left: "calc(var(--dock-left, 0px) + 12px)", top: "calc(var(--dock-top, 0px) + 56px)", width: 300 }} className="demo-nav-float" scrollable>
      <nav className="demo-nav" aria-label="Workbench navigation">
        <div id="workspace-navigation-items" className="demo-nav-content is-expanded">
          <Link href="/" className="demo-brand" aria-label="Subsurface Workbench showcase home" onClick={close}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 2v20M7 6h10M8 11h8M9 16h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /></svg>
            <span>Subsurface<small>WORKBENCH</small></span>
          </Link>
          <div className="demo-nav-group" role="group" aria-label="Workspaces">
            <span>Workspaces</span>
            {workspaces.map((item) => <Link key={item.id} href={item.entry} aria-current={activeWorkspace?.id === item.id ? "true" : undefined} onClick={close}>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d={item.icon} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span>{item.label}<small aria-hidden="true">{item.detail}</small></span>
            </Link>)}
          </div>
          {activeWorkspace && <div className="demo-nav-views" role="group" aria-label={`${activeWorkspace.label} views`}>
            <span>{activeWorkspace.label} views</span>
            {activeWorkspace.views.map((view) => <Link key={view.href} href={view.href} aria-current={current === view.href ? "page" : undefined} onClick={close}><CommandIcon name="view" />{view.label}</Link>)}
          </div>}
          <div className="demo-nav-secondary" role="group" aria-label="Outputs">
            <Link href="/well-report/" aria-current={current === "/well-report/" ? "page" : undefined} onClick={close}><CommandIcon name="print" />Well report</Link>
          </div>
          <details className="demo-nav-secondary demo-nav-dev" open={developerViews.some((view) => view.href === current)}>
            <summary><CommandIcon name="settings" />Developer examples</summary>
            {developerViews.map((view) => <Link key={view.href} href={view.href} aria-current={current === view.href ? "page" : undefined} onClick={close}>{view.label}</Link>)}
          </details>
          <p className="demo-nav-foot">Local workspace<span>Source records stay unchanged.</span></p>
        </div>
      </nav>
    </FloatingPanel>
  </>;
}
