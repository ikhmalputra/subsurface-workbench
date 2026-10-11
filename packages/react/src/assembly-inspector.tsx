"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { getCatalogEntry } from "@ikhmalputra/subsurface-core";
import type { AssemblyIssue, AssemblyItemPatch, WellAssembly } from "@ikhmalputra/subsurface-core";
import { AlertTriangle, CircleX, Info, Trash2 } from "lucide-react";
import { assetUrl } from "./assembly-palette.js";
import { formatDepth, formatInches } from "./assembly-format.js";
import { CommandButton } from "./ui.js";

export interface AssemblyInspectorProps {
  readonly assembly: WellAssembly;
  readonly assetBaseUrl: string;
  readonly selectedId: string | null;
  readonly issues?: readonly AssemblyIssue[];
  /** Throwing handlers surface their message inline. */
  readonly onUpdate?: (itemId: string, patch: AssemblyItemPatch) => void;
  readonly onRemove?: (itemId: string) => void;
}

export function AssemblyInspector({ assembly, assetBaseUrl, selectedId, issues = [], onUpdate, onRemove }: AssemblyInspectorProps) {
  const item = assembly.items.find((value) => value.id === selectedId);
  if (!item) return <section className="sw-asm-inspector is-empty" aria-label="Component inspector"><h2>Edit properties</h2><p>Select a component in the drawing or the component selector to edit its label, depths and sizes.</p></section>;
  return <InspectorForm key={`${item.id}:${assembly.revision}`} {...{ assembly, assetBaseUrl, issues, onUpdate, onRemove }} itemId={item.id} />;
}

function InspectorForm({ assembly, assetBaseUrl, itemId, issues = [], onUpdate, onRemove }: Omit<AssemblyInspectorProps, "selectedId"> & { itemId: string }) {
  const item = assembly.items.find((value) => value.id === itemId)!;
  const spec = getCatalogEntry(item.catalogId);
  const host = assembly.items.find((value) => value.id === item.hostId);
  const [error, setError] = useState("");
  const own = issues.filter((issue) => issue.itemId === item.id);
  const editable = Boolean(onUpdate);
  const snapped = (spec.attach !== undefined && spec.attach !== "anywhere") || spec.atTubingTail === true;
  const fixedTop = spec.slot === "casing" || spec.slot === "tubing" || spec.slot === "surface" || snapped;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onUpdate) return;
    const data = new FormData(event.currentTarget);
    const number = (name: string) => Number(data.get(name));
    const id = String(data.get("idIn") ?? "").trim();
    const patch: AssemblyItemPatch = {
      label: String(data.get("label") ?? ""),
      ...(fixedTop ? {} : { topM: number("topM") }),
      ...(spec.slot === "surface" || snapped ? {} : { bottomM: number("bottomM") }),
      ...(spec.slot === "cement" ? {} : { odIn: number("odIn"), idIn: id === "" ? null : Number(id) }),
    };
    try { onUpdate(item.id, patch); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  }
  return <section className="sw-asm-inspector" aria-label="Component inspector" data-testid="assembly-inspector">
    <header>
      <img src={assetUrl(assetBaseUrl, spec.asset.thumbnail)} alt="" width={72} height={72} />
      <div><small>{spec.category} · {spec.kind}</small><h2>{item.label}</h2><p>{spec.description}</p></div>
    </header>
    <form onSubmit={submit} className="sw-asm-form">
      <label className="sw-asm-wide">Label<input name="label" defaultValue={item.label} disabled={!editable} /></label>
      {spec.slot !== "surface" && <>
        <label>Top MD (m)<input name="topM" type="number" step="0.1" defaultValue={item.topM} disabled={!editable || fixedTop} aria-describedby={fixedTop ? `${item.id}-top-note` : undefined} /></label>
        <label>Bottom MD (m)<input name="bottomM" type="number" step="0.1" defaultValue={item.bottomM} disabled={!editable || snapped} /></label>
      </>}
      {spec.slot !== "cement" && <>
        <label>OD (in)<input name="odIn" type="number" step="0.001" defaultValue={item.odIn} disabled={!editable} /></label>
        <label>ID (in)<input name="idIn" type="number" step="0.001" defaultValue={item.idIn ?? ""} placeholder="Not set" disabled={!editable} /></label>
      </>}
      {fixedTop && spec.slot !== "surface" && <p className="sw-asm-note sw-asm-wide" id={`${item.id}-top-note`}>{snapped ? `Position follows the host: ${spec.placementHint.toLowerCase()}.` : "Hung from surface; drag the shoe or edit the bottom depth."}</p>}
      <dl className="sw-asm-facts sw-asm-wide">
        <div><dt>Interval</dt><dd>{spec.slot === "surface" ? "Surface" : `${formatDepth(item.topM)} → ${formatDepth(item.bottomM)}`}</dd></div>
        <div><dt>Size</dt><dd>{spec.slot === "cement" ? "Annulus" : `${formatInches(item.odIn)} OD · ${formatInches(item.idIn)} ID`}</dd></div>
        <div><dt>Attached to</dt><dd>{host?.label ?? (spec.slot === "casing" || spec.slot === "tubing" ? "Wellhead" : spec.slot === "sandface" || spec.slot === "plug" ? "Open hole" : "—")}</dd></div>
      </dl>
      {error && <p className="sw-asm-error sw-asm-wide" role="alert">{error}</p>}
      {own.length > 0 && <ul className="sw-asm-own-issues sw-asm-wide">{own.map((issue) => <li key={issue.code + issue.message} data-severity={issue.severity}>{issue.message}</li>)}</ul>}
      {editable && <div className="sw-asm-actions sw-asm-wide">
        <CommandButton icon="apply" type="submit" className="sw-asm-button is-primary">Apply changes</CommandButton>
        {onRemove && <CommandButton type="button" className="sw-asm-button is-danger" onClick={() => onRemove(item.id)}><Trash2 size={14} /> Remove</CommandButton>}
      </div>}
    </form>
  </section>;
}

export interface AssemblyIssueListProps {
  readonly issues: readonly AssemblyIssue[];
  readonly onSelect?: (itemId: string) => void;
}

export function AssemblyIssueList({ issues, onSelect }: AssemblyIssueListProps) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  const icon = { error: <CircleX size={14} />, warning: <AlertTriangle size={14} />, info: <Info size={14} /> };
  return <section className="sw-asm-issues" aria-label="Design checks" data-testid="assembly-issues">
    <header><h2>Design checks</h2><span data-severity="error">{counts.error} errors</span><span data-severity="warning">{counts.warning} warnings</span><span data-severity="info">{counts.info} notes</span></header>
    {issues.length === 0 ? <p className="sw-asm-ok">No findings. Rule checks are illustrative and do not replace engineering review.</p> :
      <ul>{issues.map((issue, index) => <li key={`${issue.code}-${index}`} data-severity={issue.severity}>
        {issue.itemId && onSelect ? <CommandButton kind="selection" type="button" onClick={() => onSelect(issue.itemId!)}>{icon[issue.severity]}<span>{issue.message}</span></CommandButton> : <p>{icon[issue.severity]}<span>{issue.message}</span></p>}
      </li>)}</ul>}
  </section>;
}
