"use client";

import type { ReactNode } from "react";
import { Workbench } from "@ikhmalputra/subsurface-shell";
import { useWorkspace } from "./workspace-provider";
import { WorkspaceContextBar } from "./workspace-context-bar";

/**
 * The application frame. Every route renders inside one <Workbench>: host navigation in the sidebar,
 * the shared well/field context as the contextual options bar, the route in the single canvas host,
 * and a status line underneath.
 *
 * The canvas host is not keyed off the route, so route content swaps inside a frame that is never
 * rebuilt. Navigation, context bar and panel state therefore survive moving between destinations.
 */
export function DemoAppearance({ navigation, children }: { navigation: ReactNode; children: ReactNode }) {
  const { well, theme, density } = useWorkspace();
  return <Workbench
    sidebar={navigation}
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
