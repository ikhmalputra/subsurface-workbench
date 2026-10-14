import type { ReactNode } from "react";
import { WorkspaceRoute } from "./workspace-route";
export { UsagePanel } from "./usage-panel";

export function DemoPage({ current, children }: { current: string; children: ReactNode }) {
  return <WorkspaceRoute key={current} current={current}>{children}</WorkspaceRoute>;
}
