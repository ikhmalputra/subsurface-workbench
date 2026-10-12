"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { PanelDock, PanelHostProvider, usePanelHost, type PanelRegistry } from "./panel-host.js";
import { CommandButton, type CommandIconName } from "./ui.js";

export interface WorkbenchDocument {
  readonly id: string;
  readonly title: string;
  readonly detail?: string;
  /** Shown as an unsaved marker; the shell never persists anything itself. */
  readonly dirty?: boolean;
}

export interface WorkbenchTool {
  readonly id: string;
  readonly label: string;
  readonly icon: CommandIconName;
  readonly disabled?: boolean;
}

export interface WorkbenchProps {
  readonly brand?: ReactNode;
  /** Top command bar content, to the right of the brand. */
  readonly commands?: ReactNode;
  readonly documents?: readonly WorkbenchDocument[];
  readonly activeDocumentId?: string;
  readonly onActivateDocument?: (id: string) => void;
  readonly tools?: readonly WorkbenchTool[];
  readonly activeToolId?: string;
  readonly onActivateTool?: (id: string) => void;
  /**
   * Host-owned navigation for the left region, used instead of the icon rail when an application
   * already has its own task navigation. Rendered once and never keyed off the route, so moving
   * between destinations does not rebuild it.
   */
  readonly sidebar?: ReactNode;
  /** Contextual options for the active tool. */
  readonly options?: ReactNode;
  readonly status?: ReactNode;
  readonly children: ReactNode;
}

/**
 * One invariant frame: command bar, document tabs, contextual options, tool rail, a single persistent
 * canvas host, dockable panel groups and a status bar.
 *
 * The canvas host is rendered unconditionally and is never keyed off the active tool, document tab or
 * panel, so switching any of them cannot remount it.
 */
export function Workbench({
  brand, commands, documents = [], activeDocumentId, onActivateDocument,
  tools = [], activeToolId, onActivateTool, sidebar, options, status, children,
}: WorkbenchProps) {
  const registry = usePanelHost();
  const activeDocument = documents.find((entry) => entry.id === activeDocumentId);
  return <PanelHostProvider registry={registry}>
    <div className="swb" data-active-tool={activeToolId}>
      {/* Chrome is never reserved when unused: an empty command bar would push the canvas down for
          nothing, which matters most on the drawing-first routes. */}
      {brand || commands ? <header className="swb-commandbar">
        {activeDocument ? <h1 className="sw-sr-only">{`${activeDocument.title} · Subsurface Workbench`}</h1> : null}
        {brand ? <div className="swb-brand">{brand}</div> : null}
        {commands ? <div className="swb-commands">{commands}</div> : null}
      </header> : null}

      {/* A landmark wraps the strip: an element cannot be both a nav landmark and a tablist, and
          content outside landmarks fails the region check. */}
      {documents.length ? <nav className="swb-tabs" aria-label="Open documents" data-testid="workbench-tabs">
        <div className="swb-tabstrip" role="tablist" aria-label="Open documents">
          {documents.map((document) => <CommandButton key={document.id} kind="selection" role="tab"
            aria-selected={document.id === activeDocumentId} data-document-id={document.id}
            onClick={() => onActivateDocument?.(document.id)}>
            <span>{document.title}{document.dirty ? <em aria-label="unsaved changes"> •</em> : null}</span>
            {document.detail ? <small>{document.detail}</small> : null}
          </CommandButton>)}
        </div>
      </nav> : null}

      {options ? <section className="swb-options" aria-label="Tool options" data-testid="workbench-options">{options}</section> : null}

      <div className="swb-body">
        {sidebar ? <div className="swb-sidebar" data-testid="workbench-sidebar">{sidebar}</div> : null}
        {tools.length ? <nav className="swb-rail" aria-label="Tools" data-testid="workbench-rail">
          {tools.map((tool) => <CommandButton key={tool.id} kind="selection" icon={tool.icon}
            aria-pressed={tool.id === activeToolId} aria-label={tool.label} disabled={tool.disabled}
            data-tool-id={tool.id} onClick={() => onActivateTool?.(tool.id)} />)}
        </nav> : null}

        <PanelDock side="left" />
        <main className="swb-canvas" data-testid="workbench-canvas">{children}</main>
        <PanelDock side="right" />
      </div>

      <footer className="swb-status" data-testid="workbench-status">{status}</footer>
    </div>
  </PanelHostProvider>;
}

const CanvasStackContext = createContext<readonly string[] | null>(null);

/**
 * Keeps every canvas mode mounted and toggles visibility instead of swapping elements. Switching modes
 * in the current demo remounts and silently discards zoom, depth window and camera; this does not.
 *
 * `active` is a set, not a single id, because the facets of a well are not alternatives: a reader
 * comparing a construction drawing with the seismic section along the same well needs both at once,
 * and making that a choice between them is what turns one workspace into several pages.
 */
export function CanvasStack({ active, children }: { readonly active: string | readonly string[]; readonly children: ReactNode }) {
  const ids = typeof active === "string" ? [active] : active;
  return <CanvasStackContext.Provider value={ids}>
    <div className="swb-canvas-stack" data-active-layer={ids.join(" ")} data-layer-count={ids.length}>{children}</div>
  </CanvasStackContext.Provider>;
}

/**
 * Membership of a keep-alive group: is this pane shown, and has it ever been?
 *
 * `deferUntilShown` is for a pane whose mount is expensive — a lazily imported 3D renderer, a
 * multi-megabyte volume fetch. It is not rendered until it is first shown, and then it stays
 * mounted: the saving is on first paint, and the state is kept for every switch after that. Panes
 * without it mount immediately, which is what a cheap 2D view should do.
 */
function useKeepAlive(id: string, deferUntilShown: boolean, child: string, parent: string) {
  const active = useContext(CanvasStackContext);
  // Naming the parent matters: the failure is always a missing wrapper, and the fix is to add that one.
  if (active === null) throw new Error(`<${child}> must be rendered inside <${parent}>.`);
  const shown = active.includes(id);
  const [mounted, setMounted] = useState(!deferUntilShown || shown);
  if (shown && !mounted) setMounted(true);
  return { shown, mounted };
}

/** One pane of an overlay stack: every mode in the same cell, `hidden` choosing which paints. */
export function CanvasLayer({ id, children, deferUntilShown = false }: { readonly id: string; readonly children: ReactNode; readonly deferUntilShown?: boolean }) {
  const { shown, mounted } = useKeepAlive(id, deferUntilShown, "CanvasLayer", "CanvasStack");
  return <div className="swb-canvas-layer" data-layer={id} data-active={shown || undefined} data-mounted={mounted || undefined} hidden={!shown}>
    {mounted ? children : null}
  </div>;
}

/**
 * A keep-alive group whose layout belongs to the host.
 *
 * `CanvasStack` overlays its layers in one cell, which is right for alternative renderings of the
 * same thing and wrong for panes meant to sit beside each other. A `PaneGrid` keeps the same
 * membership semantics — a set of shown panes, each mounted once and kept — and imposes no geometry:
 * the host supplies the class, so an application's existing grid keeps working while its panes stop
 * being destroyed every time the reader changes what they are looking at.
 *
 * Children that are not panes (an inspector, a toolbar) pass through untouched.
 */
export function PaneGrid({ active, className, children }: { readonly active: string | readonly string[]; readonly className?: string; readonly children: ReactNode }) {
  const ids = typeof active === "string" ? [active] : active;
  return <CanvasStackContext.Provider value={ids}>
    <div className={className} data-active-panes={ids.join(" ")}>{children}</div>
  </CanvasStackContext.Provider>;
}

export function Pane({ id, className, children, deferUntilShown = false }: { readonly id: string; readonly className?: string; readonly children: ReactNode; readonly deferUntilShown?: boolean }) {
  const { shown, mounted } = useKeepAlive(id, deferUntilShown, "Pane", "PaneGrid");
  return <div className={className} data-pane={id} data-active={shown || undefined} data-mounted={mounted || undefined} hidden={!shown}>
    {mounted ? children : null}
  </div>;
}

export type { PanelRegistry };
