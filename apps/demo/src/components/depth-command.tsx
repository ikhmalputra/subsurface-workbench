"use client";

import { useState } from "react";
import { metresToFeet, sectionAtDepth } from "@ikhmalputra/subsurface-core";
import { useDepthLink } from "@ikhmalputra/subsurface-react";
import { CommandButton } from "@ikhmalputra/subsurface-react/ui";
import { useWorkspace } from "./workspace-provider";

/**
 * Go to a measured depth: pins it on every depth view and selects the hole section it falls in,
 * from the host's operations record. The same event as a click on the ruler or `go 1558` on
 * the command line; this is the typed form of it on the workspace bar.
 */
export function DepthCommand() {
  const { store, well } = useWorkspace();
  const link = useDepthLink(true, store);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const td = well.design.totalDepthM;
  return <form className="demo-drawing-status" onSubmit={(event) => {
    event.preventDefault();
    const mdM = Number(input);
    if (!input.trim() || !Number.isFinite(mdM) || mdM < 0 || mdM > td) { setError(`Enter an MD between 0 and ${td.toLocaleString("en")} m.`); return; }
    setError(null);
    const section = well.operations ? sectionAtDepth(well.operations, metresToFeet(mdM)) : null;
    if (section) store.selectComponent(section.holeComponentId, "depth-command");
    link.pinCursor(mdM);
  }}>
    <label>Go to MD <input type="number" step="any" value={input} onChange={(event) => setInput(event.target.value)} placeholder="metres" /></label>
    <CommandButton icon="locate" type="submit" className="demo-tool-button">Locate depth</CommandButton>
    <output aria-live="polite">{link.pinnedMdM === null ? "No pinned depth" : `Pinned ${link.pinnedMdM.toLocaleString("en", { maximumFractionDigits: 1 })} m MD`}</output>
    {error && <p className="demo-command-error" role="alert">{error}</p>}
  </form>;
}
