"use client";

import type { ReactNode } from "react";
import { WorkspaceContextBar } from "./workspace-context-bar";

export function DemoAppearance({ navigation, children }: { navigation: ReactNode; children: ReactNode }) {
  return <div className="demo-workbench-shell">
    {navigation}
    <div className="demo-workbench-main">
      <WorkspaceContextBar />
      <main className="demo-page">{children}</main>
    </div>
  </div>;
}
