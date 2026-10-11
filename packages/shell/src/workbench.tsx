"use client";

import { createContext, useContext, type ReactNode } from "react";
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
  tools = [], activeToolId, onActivateTool, options, status, children,
}: WorkbenchProps) {
  const registry = usePanelHost();
  const activeDocument = documents.find((entry) => entry.id === activeDocumentId);
  return <PanelHostProvider registry={registry}>
    <div className="swb" data-active-tool={activeToolId}>
      <header className="swb-commandbar">
        {/* The page is about the open document; the brand is chrome, so the heading names the document. */}
        <h1 className="sw-sr-only">{activeDocument ? `${activeDocument.title} · Subsurface Workbench` : "Subsurface Workbench"}</h1>
        {brand ? <div className="swb-brand">{brand}</div> : null}
        {commands ? <div className="swb-commands">{commands}</div> : null}
      </header>

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

const CanvasStackContext = createContext<string | null>(null);

/**
 * Keeps every canvas mode mounted and toggles visibility instead of swapping elements. Switching modes
 * in the current demo remounts and silently discards zoom, depth window and camera; this does not.
 */
export function CanvasStack({ active, children }: { readonly active: string; readonly children: ReactNode }) {
  return <CanvasStackContext.Provider value={active}>
    <div className="swb-canvas-stack" data-active-layer={active}>{children}</div>
  </CanvasStackContext.Provider>;
}

export function CanvasLayer({ id, children }: { readonly id: string; readonly children: ReactNode }) {
  const active = useContext(CanvasStackContext);
  if (active === null) throw new Error("<CanvasLayer> must be rendered inside <CanvasStack>.");
  const shown = active === id;
  return <div className="swb-canvas-layer" data-layer={id} data-active={shown || undefined} hidden={!shown}>{children}</div>;
}

export type { PanelRegistry };
