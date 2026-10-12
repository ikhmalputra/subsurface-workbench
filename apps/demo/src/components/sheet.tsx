"use client";

import { useTools } from "./tools";
import { documentLabels, domainTools, subDomains } from "../lib/tools";

const headless = new Set(["brief", "trajectory", "petrophysics", "production", "linked-data", "sandbox"]);

/** The empty sheet: what is on it when no document is open. */
export function Sheet() {
  const tools = useTools();
  // A document is the page's content, so the page carries its name as the heading — unless the
  // document has a heading of its own, as the editor, the study, the report and the field do.
  if (tools.document) return headless.has(tools.document) ? <h1 className="sw-sr-only">{documentLabels[tools.document]}</h1> : null;
  const built = domainTools.filter((tool) => tool.status !== "planned").length;
  return <section className="demo-sheet-empty" aria-label="Empty sheet">
    <h1>Nothing open</h1>
    <p>{built} tools across {subDomains.length} sub-domains are on the ribbon. Open one, or type a command — <code>view survey</code>, <code>create study</code>, <code>help</code>.</p>
  </section>;
}
