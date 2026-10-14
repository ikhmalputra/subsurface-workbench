"use client";

import { useEffect } from "react";
import { useTools } from "./tools";

/**
 * The design brief as a tool over the sheet: the sheet's Design view draws the brief's schematic
 * canvas and the design workflow portals its phases, steps, forms and the builder's parts and
 * properties into this panel. Opening it opens the Design view; closing it leaves the view where
 * it is — the workflow keeps its brief until the view changes.
 */
export function DesignTool() {
  const tools = useTools();
  useEffect(() => { tools.openPanel("section", "design"); }, []);
  return <section className="demo-tool demo-design-tool" aria-label="Design brief" data-testid="tool-design">
    <p className="demo-tool-note">Independent draft · export the brief before leaving to keep it. The sheet's Design view draws it.</p>
    <div className="demo-design-host" ref={tools.setDesignHost} />
  </section>;
}
