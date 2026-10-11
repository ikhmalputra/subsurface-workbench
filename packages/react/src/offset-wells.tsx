"use client";

import { useMemo, useRef, useState } from "react";
import { BookmarkPlus, FileUp, GitCompareArrows, Trash2 } from "lucide-react";
import { InfoTip } from "./info-tip.js";
import { adoptOffsetDesign, compareWells, newWellBesideOffset, offsetFromBrief } from "@ikhmalputra/subsurface-core/offset-wells";
import type { Adoption, AdoptOptions, OffsetWell, WellComparison } from "@ikhmalputra/subsurface-core/offset-wells";
import { analyzeSection, formatOd, regradeFailingStrings, tvdAtMd } from "@ikhmalputra/subsurface-core/well-design";
import type { DesignChange, WellDesignBrief } from "@ikhmalputra/subsurface-core/well-design";
import { IssueList } from "./well-design.js";
import { CommandButton } from "./ui.js";

export interface OffsetWellLibraryProps {
  readonly brief: WellDesignBrief;
  readonly onChange: (brief: WellDesignBrief) => void;
  /** Wells to compare against: documented ones such as `forgeOffsetWell` and the user's saved designs. */
  readonly offsets: readonly OffsetWell[];
  /** Called when the user saves the current design, imports a file, or removes a saved well. Omit to hide those controls. */
  readonly onOffsetsChange?: (offsets: readonly OffsetWell[]) => void;
  readonly selectedOffsetId?: string | null;
  readonly onSelectOffset?: (id: string) => void;
}

const verdictLabel: Readonly<Record<WellComparison["verdict"], string>> = { strong: "Strong analogue", partial: "Partial analogue", poor: "Poor analogue", "insufficient-data": "Not enough data" };
const metres = (value: number) => `${Math.round(value).toLocaleString("en-US")} m`;
const isBrief = (value: unknown): value is WellDesignBrief => Boolean(value && typeof value === "object" && "identity" in value && "geology" in value && "sections" in value);

/**
 * Compare this well with previous wells and reuse what fits: rank by likeness (location, depth,
 * pressure and temperature regime, rocks, hazards, profile, purpose), show the offset's design next
 * to how it was actually drilled, then adopt its geology and/or design onto this well with every
 * change logged and every check re-run.
 */
export function OffsetWellLibrary({ brief, onChange, offsets, onOffsetsChange, selectedOffsetId, onSelectOffset }: OffsetWellLibraryProps) {
  const ranked = useMemo(() => offsets.map((offset) => ({ offset, comparison: compareWells(brief, offset) })).sort((a, b) => (b.comparison.verdict === "insufficient-data" ? -1 : b.comparison.score) - (a.comparison.verdict === "insufficient-data" ? -1 : a.comparison.score)), [brief, offsets]);
  const [localId, setLocalId] = useState<string | null>(null);
  const activeId = selectedOffsetId ?? localId ?? ranked[0]?.offset.id ?? null;
  const active = ranked.find((value) => value.offset.id === activeId) ?? ranked[0];
  const [result, setResult] = useState<{ readonly offsetId: string; readonly label: string; readonly adoption: Adoption; readonly regraded?: readonly DesignChange[] } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const select = (id: string) => { setLocalId(id); onSelectOffset?.(id); };

  const adopt = (offset: OffsetWell, options: AdoptOptions, label: string) => {
    const adoption = adoptOffsetDesign(brief, offset, options);
    onChange(adoption.brief);
    setResult({ offsetId: offset.id, label, adoption });
  };
  const startBeside = (offset: OffsetWell) => {
    const next = newWellBesideOffset(offset, { name: brief.identity.name && brief.identity.name !== offset.name ? brief.identity.name : `${offset.name} — new well` });
    onChange(next);
    setResult(null);
  };
  const regrade = () => {
    if (!result) return;
    const { brief: next, changes } = regradeFailingStrings(result.adoption.brief);
    onChange(next);
    setResult({ ...result, adoption: { ...result.adoption, brief: next, failingSections: next.sections.filter((_, index) => !analyzeSection(next, index).passes).map((section) => section.id) }, regraded: changes });
  };
  const save = () => {
    const saved = offsetFromBrief(brief, { notes: brief.origin ? [`Started from ${brief.origin.offsetName} (${brief.origin.parts.join(", ")}).`] : [] });
    onOffsetsChange?.([...offsets.filter((offset) => offset.id !== saved.id), saved]);
    select(saved.id);
  };
  const importFile = async (file: File) => {
    try {
      const value: unknown = JSON.parse(await file.text());
      const offset = isBrief(value) ? offsetFromBrief(value) : value && typeof value === "object" && "brief" in value && isBrief((value as OffsetWell).brief) ? offsetFromBrief((value as OffsetWell).brief, { name: (value as OffsetWell).name, notes: (value as OffsetWell).notes ?? [] }) : null;
      if (!offset) throw new Error("not a well design brief or offset well");
      setImportError(null);
      onOffsetsChange?.([...offsets.filter((item) => item.id !== offset.id), offset]);
      select(offset.id);
    } catch (error) { setImportError(`${file.name}: ${error instanceof Error ? error.message : String(error)}`); }
  };

  return <section className="sw-wd-panel sw-ow" aria-label="Offset wells" data-testid="offset-library">
    <header><div><small>Step 3 · start from what was drilled before</small><div className="sw-title"><h2>Offset wells</h2><InfoTip label="About offset wells" wide><p>Wells on the same pad or in the same basin usually see the same rocks and pressures. Rank them against this brief, read how they were actually drilled, then reuse their geology or design.</p><p>Reused data keeps its source (measured on the offset becomes <i>offset</i>), depths are moved to this well&apos;s reference, and every check is re-run on the result.</p></InfoTip></div></div>
      {onOffsetsChange && <div className="sw-wd-actions">
        <CommandButton type="button" className="sw-asm-button" onClick={save}><BookmarkPlus size={14} /> Save this design</CommandButton>
        <CommandButton type="button" className="sw-asm-button" onClick={() => fileRef.current?.click()}><FileUp size={14} /> Import JSON</CommandButton>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-label="Import offset well JSON" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ""; }} />
      </div>}
    </header>
    {importError && <p className="sw-wd-error" role="alert">{importError}</p>}
    <ul className="sw-ow-list" aria-label="Offset wells ranked by likeness">{ranked.map(({ offset, comparison }) => <li key={offset.id}>
      <CommandButton kind="selection" type="button" aria-pressed={offset.id === active?.offset.id} data-verdict={comparison.verdict} onClick={() => select(offset.id)}>
        <strong>{offset.name}</strong>
        <span>{offset.status === "drilled" ? "Drilled" : "Design"} · {offset.provenance === "documented" ? "documented record" : "your library"} · {offset.brief.sections.length} strings · TD {metres(offset.brief.totalDepthMdM)} MD</span>
        <b className="sw-ow-score">{comparison.verdict === "insufficient-data" ? "—" : `${Math.round(comparison.score * 100)}%`}<small>{verdictLabel[comparison.verdict]}</small></b>
      </CommandButton>
      {offset.provenance === "user" && onOffsetsChange && <CommandButton type="button" className="sw-wd-icon" aria-label={`Remove ${offset.name} from library`} onClick={() => onOffsetsChange(offsets.filter((item) => item.id !== offset.id))}><Trash2 size={14} /></CommandButton>}
    </li>)}</ul>
    {!ranked.length && <p className="sw-wd-empty-note">No offset wells yet. Save a finished design or import one.</p>}
    {active && <OffsetDetail brief={brief} offset={active.offset} comparison={active.comparison} onAdopt={adopt} onStartBeside={startBeside} />}
    {result && <div className="sw-ow-result" data-testid="adoption-result" aria-live="polite">
      <h3 className="sw-wd-sub">{result.label} <small>from {offsets.find((offset) => offset.id === result.offsetId)?.name}</small></h3>
      <ol className="sw-ow-changes">{[...result.adoption.changes, ...(result.regraded ?? [])].map((change, index) => <li key={index}><b>{change.sectionId ? `${change.sectionId} · ` : ""}{change.field}</b> <span className="is-mono">{change.from} → {change.to}</span><em>{change.reason}</em></li>)}</ol>
      {result.adoption.failingSections.length > 0
        ? <p className="sw-wd-error" role="status">{result.adoption.failingSections.length} string{result.adoption.failingSections.length > 1 ? "s" : ""} fail on this well ({result.adoption.failingSections.join(", ")}). The offset design does not carry over as-is. <CommandButton icon="apply" type="button" className="sw-asm-button" onClick={regrade}>Regrade failing strings</CommandButton></p>
        : <p className="sw-wd-ok" role="status">Every string passes its load checks on this well.</p>}
      <IssueList issues={result.adoption.issues.filter((issue) => issue.severity !== "info")} empty="No errors or warnings on the adopted design." />
    </div>}
  </section>;
}

function OffsetDetail({ brief, offset, comparison, onAdopt, onStartBeside }: { readonly brief: WellDesignBrief; readonly offset: OffsetWell; readonly comparison: WellComparison; readonly onAdopt: (offset: OffsetWell, options: AdoptOptions, label: string) => void; readonly onStartBeside: (offset: OffsetWell) => void }) {
  const record = new Map(offset.asDrilled.map((section) => [section.sectionId, section]));
  const sections = [...offset.brief.sections].sort((a, b) => a.shoeMdM - b.shoeMdM);
  const events = offset.asDrilled.flatMap((section) => section.events.map((event) => ({ ...event, sectionId: section.sectionId })));
  return <div className="sw-ow-detail" data-testid="offset-detail">
    <p className="sw-ow-summary" data-verdict={comparison.verdict}><GitCompareArrows size={15} aria-hidden="true" /> {comparison.summary} <small>{Math.round(comparison.coverage * 100)}% of the comparison has data on both wells.</small></p>
    <div className="sw-wd-scroll" tabIndex={0} role="region" aria-label="Likeness by factor"><table className="sw-wd-table is-compare" aria-label="Likeness by factor">
      <thead><tr><th scope="col">Factor</th><th scope="col">This well</th><th scope="col">{offset.name}</th><th scope="col">Likeness</th><th scope="col">Why</th></tr></thead>
      <tbody>{comparison.factors.map((factor) => <tr key={factor.id} data-missing={factor.score === null || undefined}>
        <th scope="row">{factor.label}<small>weight {factor.weight}</small></th>
        <td>{factor.target}</td><td>{factor.offset}</td>
        <td>{factor.score === null ? <span className="sw-ow-na">no data</span> : <span className="sw-ow-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(factor.score * 100)} aria-label={`${factor.label} likeness`}><i style={{ width: `${Math.round(factor.score * 90)}px` }} data-level={factor.score >= 0.75 ? "high" : factor.score >= 0.5 ? "mid" : "low"} /><b>{Math.round(factor.score * 100)}%</b></span>}</td>
        <td>{factor.note}</td>
      </tr>)}</tbody>
    </table></div>
    <h3 className="sw-wd-sub">Design and how it was drilled <small>{offset.status === "drilled" ? "as-drilled record" : "plan only — no drilling record"}</small></h3>
    <div className="sw-wd-scroll" tabIndex={0} role="region" aria-label={`${offset.name} programme and as-drilled record`}><table className="sw-wd-table is-compare" aria-label={`${offset.name} programme`}>
      <thead><tr><th scope="col">Hole</th><th scope="col">Casing</th><th scope="col">Shoe <small>m MD / TVD</small></th><th scope="col">Mud plan <small>SG</small></th><th scope="col">Mud used <small>SG</small></th><th scope="col">Days</th><th scope="col">Runs <small>problem</small></th><th scope="col">ROP <small>m/h</small></th><th scope="col">Cement</th></tr></thead>
      <tbody>{sections.map((section) => {
        const drilled = record.get(section.id);
        return <tr key={section.id}>
          <td className="is-mono">{section.holeSizeIn}&quot;</td>
          <th scope="row">{formatOd(section.odIn)} {section.weightLbFt}# {section.grade}<small>{section.role}</small></th>
          <td className="is-mono">{Math.round(section.shoeMdM).toLocaleString("en-US")} / {Math.round(tvdAtMd(offset.brief, section.shoeMdM)).toLocaleString("en-US")}</td>
          <td className="is-mono">{section.mudWeightSg.toFixed(2)}</td>
          <td className="is-mono">{drilled?.mudWeightSg ? `${drilled.mudWeightSg.min.toFixed(2)}–${drilled.mudWeightSg.max.toFixed(2)}` : "—"}</td>
          <td className="is-mono">{drilled?.days ?? "—"}</td>
          <td className="is-mono" data-bad={(drilled?.problemRuns ?? 0) > 0 || undefined}>{drilled?.runCount ?? "—"}{drilled?.problemRuns ? ` (${drilled.problemRuns})` : ""}</td>
          <td className="is-mono">{drilled?.avgRopMPerH ?? "—"}</td>
          <td>{section.cement ? `${section.cement.topMdM <= 0 ? "to surface" : `TOC ${metres(section.cement.topMdM)}`} · ${section.cement.leadDensitySg.toFixed(2)} SG` : "none on record"}</td>
        </tr>;
      })}</tbody>
    </table></div>
    {events.length > 0 && <>
      <h3 className="sw-wd-sub">Evidence and trouble on the offset <small>{events.length} events, each with its source</small></h3>
      <ul className="sw-ow-events">{events.map((event, index) => <li key={index} data-kind={event.kind}>
        <b>{event.mdM !== null ? metres(event.mdM) : event.sectionId}</b>
        <span>{event.text}</span>
        <cite>{event.date ? `${event.date} · ` : ""}{event.source}</cite>
      </li>)}</ul>
    </>}
    {offset.notes.length > 0 && <>
      <h3 className="sw-wd-sub">Gaps and assumptions in this record</h3>
      <ul className="sw-ow-notes">{offset.notes.map((note) => <li key={note}>{note}</li>)}</ul>
    </>}
    {offset.source && <p className="sw-wd-note">Source: {offset.source.url ? <a href={offset.source.url} target="_blank" rel="noreferrer">{offset.source.title}</a> : offset.source.title}{offset.source.license ? ` · ${offset.source.license}` : ""}{offset.source.attribution ? ` · ${offset.source.attribution}` : ""}</p>}
    <div className="sw-ow-adopt" role="group" aria-label={`Reuse ${offset.name}`}>
      <CommandButton icon="create" type="button" className="sw-asm-button" onClick={() => onStartBeside(offset)} title="Same pad location, datum and geology; vertical to the offset's TD; no casing yet">Start new well beside it</CommandButton>
      <CommandButton icon="apply" type="button" className="sw-asm-button" onClick={() => onAdopt(offset, { geology: true, casing: false, completion: false }, "Adopted geology")}>Adopt geology</CommandButton>
      <CommandButton icon="apply" type="button" className="sw-asm-button" disabled={!offset.brief.sections.length} onClick={() => onAdopt(offset, { geology: false, casing: true, completion: true }, "Adopted casing design")}>Adopt casing design</CommandButton>
      <CommandButton icon="apply" type="button" className="sw-asm-button is-primary" disabled={!offset.brief.sections.length} onClick={() => onAdopt(offset, { geology: true, casing: true, completion: true }, "Adopted full design")}>Adopt full design</CommandButton>
    </div>
    {brief.origin?.offsetId === offset.id && <p className="sw-wd-note">This brief already uses {offset.name} ({brief.origin.parts.join(", ")}).</p>}
  </div>;
}
