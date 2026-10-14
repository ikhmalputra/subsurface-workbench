"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * Show one of several panes, and keep the hidden ones mounted.
 *
 * The sheet switches between a dozen views of the same well. Unmounting a view throws away a 3D
 * scene, a parsed seismic volume and a scroll position, and remounting it costs seconds; keeping
 * every view mounted from the start costs the same seconds up front. So a pane mounts the first
 * time it is shown and then stays, hidden, unless it says it has nothing worth keeping.
 *
 * This was the only part of a 746-line workspace-shell package the application still used after
 * the workstation replaced its frame, so it lives here now and the package is gone.
 */
const PaneGridContext = createContext<readonly string[] | null>(null);

export function PaneGrid({ active, className, children }: { readonly active: string | readonly string[]; readonly className?: string; readonly children: ReactNode }) {
  const ids = typeof active === "string" ? [active] : active;
  return <PaneGridContext.Provider value={ids}>
    <div className={className} data-active-panes={ids.join(" ")}>{children}</div>
  </PaneGridContext.Provider>;
}

export function Pane({ id, className, children, deferUntilShown = false, keep = true }: { readonly id: string; readonly className?: string; readonly children: ReactNode; readonly deferUntilShown?: boolean; readonly keep?: boolean }) {
  const active = useContext(PaneGridContext);
  // Naming the parent matters: the failure is always a missing wrapper, and the fix is to add it.
  if (active === null) throw new Error("<Pane> must be rendered inside <PaneGrid>.");
  const shown = active.includes(id);
  const [everShown, setEverShown] = useState(!deferUntilShown || shown);
  if (shown && !everShown) setEverShown(true);
  // A pane whose state lives entirely in the shared store has nothing to keep, and keeping it means
  // every drawing it contains stays in the document — twice over, once hidden — for anything that
  // queries the page as a whole.
  const mounted = shown || (keep && everShown);
  return <div className={className} data-pane={id} data-active={shown || undefined} data-mounted={mounted || undefined} hidden={!shown}>
    {mounted ? children : null}
  </div>;
}
