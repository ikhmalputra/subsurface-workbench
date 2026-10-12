"use client";

import { useState } from "react";
import { FloatingPanel } from "./floating";

/**
 * The route's "usage and SDK details" — the lede, the points, the imports and the code — as a
 * panel in the tray rather than a header above the sheet. Its tab carries the name the copy
 * always had, so the one way to reach it is the way it was always reached.
 */
export function UsagePanel({ id = "usage", lede, points, uses, code }: { readonly id?: string; readonly lede: string; readonly points: readonly string[]; readonly uses: readonly string[]; readonly code: string }) {
  const [open, setOpen] = useState(false);
  return <FloatingPanel id={id} title="Usage and SDK details" open={open} onOpenChange={setOpen} defaultStyle={{ right: 12, bottom: 44, width: "min(760px, calc(100vw - 24px))" }} className="demo-usage-float demo-workbench-usage" scrollable>
    <div className="demo-header-body">
      <div className="demo-header-copy">
        <p className="demo-lede">{lede}</p>
        <ul className="demo-points">{points.map((point) => <li key={point}>{point}</li>)}</ul>
        <ul className="demo-uses" aria-label="SDK imports used on this page">{uses.map((use) => <li key={use}><code>{use}</code></li>)}</ul>
      </div>
      <div className="demo-code"><pre tabIndex={0} aria-label="Usage example"><code>{code.trim()}</code></pre></div>
    </div>
  </FloatingPanel>;
}
