"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useWorkspace } from "./workspace-provider";
import { isIndependentExample } from "../lib/workspace-routes";
import { CommandButton } from "@ikhmalputra/subsurface-react/ui";

export function WorkspaceRoute({ current, children }: { current: string; children: ReactNode }) {
  const { well } = useWorkspace();
  const [showExample, setShowExample] = useState(false);
  if (isIndependentExample(current)) {
    return <>
      <section className="demo-workspace-availability" aria-label="Data availability">
        <h2>{showExample ? "Independent example mode" : "No compatible dataset registered for this well"}</h2>
        <p>{well.label} remains your active workspace well. This module&apos;s existing fixture is a separate synthetic example, not evidence for that well. Its selections do not change workspace selection.</p>
        <CommandButton icon="create" type="button" onClick={() => setShowExample(!showExample)}>{showExample ? "Close independent example" : "Open independent synthetic example"}</CommandButton>
        <Link href="/view-well/">Return to well schematic</Link>
      </section>
      {showExample && children}
    </>;
  }
  if (current === "/well-report/" && well.id !== "forge") {
    return <section className="demo-workspace-availability" aria-label="Data availability">
      <h2>Report not supplied for this well</h2>
      <p>The report currently contains sourced FORGE records only. It cannot be shown as the report for {well.label}.</p>
      <Link href="/view-well/">Inspect this well&apos;s schematic</Link>
    </section>;
  }
  return <>
    {children}
  </>;
}
