"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Workbench } from "@ikhmalputra/subsurface-shell";
import { useWorkspace } from "./workspace-provider";
import { WorkspaceContextBar } from "./workspace-context-bar";
import { WorkspaceNavigation } from "./workspace-navigation";

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
 */
export function WorkbenchFrame({ children }: { children: ReactNode }) {
  const { well, theme, density } = useWorkspace();
  const pathname = usePathname();
  // Routes are declared with trailing slashes (`trailingSlash: true`), so normalise rather than
  // letting the active-route highlight silently fail to match.
  const current = pathname === "/" || pathname.endsWith("/") ? pathname : `${pathname}/`;
  return <Workbench
    sidebar={<WorkspaceNavigation current={current} />}
    options={<WorkspaceContextBar />}
    status={<>
      <span>Well <strong>{well.label}</strong></span>
      <span>Source <strong>{well.design.provenance}</strong></span>
      <span>Appearance <strong>{theme} · {density}</strong></span>
    </>}
  >
    <div className="demo-page">{children}</div>
  </Workbench>;
}
