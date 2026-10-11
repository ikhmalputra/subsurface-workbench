import type { ReactNode } from "react";
import { DemoAppearance } from "./demo-appearance";
import { WorkspaceRoute } from "./workspace-route";
import { WorkspaceNavigation } from "./workspace-navigation";

export function SiteNav({ current }: { current?: string }) {
  return <WorkspaceNavigation current={current} />;
}

export function DemoHeader({ eyebrow, title, lede, points, uses, code, children }: { eyebrow: string; title: string; lede: string; points: readonly string[]; uses: readonly string[]; code: string; children?: ReactNode }) {
  return <header className="demo-header">
    <span className="demo-eyebrow">{eyebrow}</span>
    <div className="demo-header-line"><h1>{title}</h1></div>
    <details className="demo-about">
      <summary>Usage and SDK details</summary>
      <div className="demo-header-body">
        <div className="demo-header-copy">
          <p className="demo-lede">{lede}</p>
          <ul className="demo-points">{points.map((point) => <li key={point}>{point}</li>)}</ul>
          <ul className="demo-uses" aria-label="SDK imports used on this page">{uses.map((use) => <li key={use}><code>{use}</code></li>)}</ul>
          {children}
        </div>
        <div className="demo-code"><pre tabIndex={0} aria-label="Usage example"><code>{code.trim()}</code></pre></div>
      </div>
    </details>
  </header>;
}

export function DemoPage({ current, children }: { current: string; children: ReactNode }) {
  return <DemoAppearance navigation={<SiteNav current={current} />}>
    <WorkspaceRoute key={current} current={current}>{children}</WorkspaceRoute>
  </DemoAppearance>;
}
