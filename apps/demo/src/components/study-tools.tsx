"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LogTracks } from "@ikhmalputra/subsurface-react/records";
import { metresToFeet } from "@ikhmalputra/subsurface-core";
import { CommandButton } from "@ikhmalputra/subsurface-react/ui";
import { useDepthLink } from "@ikhmalputra/subsurface-react/state";
import { useWorkspace } from "./workspace-provider";
import { useTools } from "./tools";
import { checkDrillingLog, intervalEvidence, parseStudies, studySignature, studyStorageKey, validateScope } from "../lib/drilling-study";
import { lasAttempt } from "../lib/well-data";
import { depthBridge, recordDepthToMetres } from "@ikhmalputra/subsurface-react/state";
import { useLas } from "./use-las";
import { continueStudy, newStudyDraft, restartStudy, studyPhases, type StudyDraft } from "../lib/study-draft";
import type { DrillingStudy } from "../lib/drilling-study";

/**
 * The drilling study as tools over the sheet's section. The study tool (docked right) carries the
 * four steps and the saved studies; the evidence tool (docked under the section) carries the
 * drilling log for the interval under review, its exact samples, and the runs and daily reports
 * that overlap it. Both read one draft per well from the workspace provider, and the section bands
 * the draft's two intervals, so typing a top or a base moves the band at once.
 */

const tracks = [
  { mnemonic: "ROP", label: "Penetration rate", color: "#147a65" },
  { mnemonic: "WOB", label: "Weight on bit", color: "#2c3f7a" },
  { mnemonic: "RPM", label: "Rotary speed", color: "#7a4f1f" },
  { mnemonic: "PP", label: "Pump pressure", color: "#4f2f7a" },
];
const limits = [
  "ROP mean is an arithmetic mean of valid sampled observations, not time-weighted drilling speed.",
  "Missing and negative ROP samples are excluded and counted. Zero ROP is retained.",
  "Intervals are top-inclusive and base-exclusive at sample depths; log gaps are not filled.",
  "Daily reports are matched by reported end-of-day MD; this does not locate every activity within the interval.",
  "Run overlap provides context, not proof that a run caused a change. No automated diagnosis or engineering certification.",
];

/** The draft and everything evaluated from it against the well's log and operations. */
function useStudy() {
  const { well, store, studyDrafts, updateStudyDraft } = useWorkspace();
  const td = well.design.totalDepthM;
  const draft = studyDrafts[well.design.id] ?? newStudyDraft(td);
  const patch = (changes: Partial<StudyDraft>) => updateStudyDraft(well.design.id, (current) => ({ ...(current ?? newStudyDraft(td)), ...changes }));
  const logUrl = well.logUrl;
  const source = useLas(logUrl);
  // The study insists on a depth-matched log, so it reads the shared parse through its own
  // validation rather than re-fetching: same file, same bytes, one extra check that is memoized.
  const checked = source.loaded ? lasAttempt(source.loaded.las, "drilling-study", checkDrillingLog) : null;
  const activeLog = checked?.ok && source.loaded ? { url: source.loaded.url, text: source.loaded.text, las: checked.value } : null;
  const logError = source.error ?? (checked && !checked.ok ? checked.error : null);
  const topM = draft.top.trim() ? Number(draft.top) : NaN, baseM = draft.base.trim() ? Number(draft.base) : NaN;
  const compareTopM = draft.compareTop.trim() ? Number(draft.compareTop) : NaN, compareBaseM = draft.compareBase.trim() ? Number(draft.compareBase) : NaN;
  const scope = useMemo(() => ({ topM, baseM }), [topM, baseM]);
  const comparison = useMemo(() => ({ topM: compareTopM, baseM: compareBaseM }), [compareTopM, compareBaseM]);
  let scopeError: string | null = null;
  try { validateScope(scope, td); validateScope(comparison, td); if (!draft.question.trim()) throw new Error("State an investigation question."); }
  catch (caught) { scopeError = caught instanceof Error ? caught.message : String(caught); }
  const ops = well.operations ?? null;
  const evaluation = useMemo(() => activeLog && !scopeError ? {
    target: intervalEvidence(activeLog.las, ops, scope),
    comparison: intervalEvidence(activeLog.las, ops, comparison),
  } : null, [activeLog, ops, scopeError, scope, comparison]);
  const signature = activeLog ? studySignature(activeLog.text, ops) : "";
  const basis = JSON.stringify({ signature, revision: well.design.revision, scope, comparison });
  const eligible = !!evaluation && evaluation.target.validCount > 0 && evaluation.comparison.validCount > 0;
  const focused = evaluation?.[draft.evidenceWindow] ?? null;
  const focusedScope = draft.evidenceWindow === "target" ? scope : comparison;
  const evidenceReady = draft.phase === 2 && !!evaluation && !!activeLog && !!focused;
  function attach(id: string, mdM?: number) {
    updateStudyDraft(well.design.id, (current) => { const base = current ?? newStudyDraft(td); return { ...base, evidenceIds: base.evidenceIds.includes(id) ? base.evidenceIds.filter((value) => value !== id) : [...base.evidenceIds, id] }; });
    if (mdM !== undefined) store.pinDepth(well.design.id, mdM, "analysis-study");
  }
  function snapshot(): DrillingStudy {
    if (scopeError || !eligible || !evaluation) throw new Error(scopeError ?? "Both intervals need valid ROP observations before saving findings.");
    if (draft.reviewedBasis !== basis) throw new Error("Review evidence for the current intervals and source revision before saving findings.");
    const availableIds = new Set(["comparison:rop", ...[evaluation.target, evaluation.comparison].flatMap((interval) => [...interval.rows.map((row) => row.id), ...interval.runs.map((run) => `run:${run.id}`), ...interval.days.map((day) => `day:${day.date}`)])]);
    if (draft.evidenceIds.some((id) => !availableIds.has(id))) throw new Error("Some attached evidence is outside the current scope or no longer available. Remove it and recheck the finding.");
    if (!draft.finding.trim() || !draft.uncertainty.trim() || !draft.evidenceIds.length) throw new Error("Record a finding, uncertainty and at least one evidence reference.");
    return { version: 1, id: draft.studyId ?? crypto.randomUUID(), wellId: well.design.id, wellRevision: well.design.revision, question: draft.question, scope, comparison, finding: draft.finding, uncertainty: draft.uncertainty, evidenceIds: draft.evidenceIds, sourceSignature: signature, savedAt: new Date().toISOString(), results: {
      target: { mean: evaluation.target.mean!, unit: evaluation.target.unit!, validCount: evaluation.target.validCount, excludedCount: evaluation.target.excludedCount },
      comparison: { mean: evaluation.comparison.mean!, unit: evaluation.comparison.unit!, validCount: evaluation.comparison.validCount, excludedCount: evaluation.comparison.excludedCount },
    } };
  }
  return { well, store, td, draft, patch, logUrl, activeLog, logError, scope, comparison, scopeError, ops, evaluation, signature, basis, eligible, focused, focusedScope, evidenceReady, attach, snapshot };
}

/** The four steps and the saved studies, docked beside the section. */
export function StudyTool() {
  const study = useStudy();
  const { well, store, draft, patch, logUrl, activeLog, logError, scope, comparison, scopeError, ops, evaluation, signature, basis, eligible, attach, snapshot } = study;
  const tools = useTools();
  const [studies, setStudies] = useState<readonly DrillingStudy[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  // The draft exists from the moment the tool opens, so the section bands the default intervals at once.
  const { updateStudyDraft } = useWorkspace();
  const td = study.td;
  useEffect(() => { updateStudyDraft(well.design.id, (current) => current ?? newStudyDraft(td)); }, [updateStudyDraft, well.design.id, td]);
  useEffect(() => {
    try { const saved = localStorage.getItem(studyStorageKey); setStudies(saved ? parseStudies(saved) : []); setStorageReady(true); }
    catch (caught) { setError(`Saved studies could not be loaded: ${caught instanceof Error ? caught.message : String(caught)}`); }
  }, []);
  const stale = draft.loaded && (draft.loaded.wellRevision !== well.design.revision || (!!activeLog && draft.loaded.sourceSignature !== signature));
  const change = evaluation && evaluation.target.mean !== null && evaluation.comparison.mean !== null ? evaluation.target.mean - evaluation.comparison.mean : null;
  function save() {
    try {
      if (!storageReady) throw new Error("Study storage is unavailable; existing saved studies will not be overwritten.");
      const next = snapshot();
      const saved = localStorage.getItem(studyStorageKey);
      const current = saved ? parseStudies(saved) : [];
      const all = [...current.filter((item) => item.id !== next.id), next];
      localStorage.setItem(studyStorageKey, JSON.stringify(all));
      setStudies(all); setError(null); patch({ studyId: next.id, loaded: next, notice: "Study saved on this device." });
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  }
  function exportStudy() {
    try {
      const next = snapshot();
      const content = { study: next, evaluation, assumptions: limits, sources: { logUrl, logParameters: activeLog?.las.parameters, operationalSources: ops?.sources }, provenance: well.design.provenance };
      const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${well.id}-drilling-study.json`; anchor.click(); URL.revokeObjectURL(url);
      setError(null); patch({ notice: "Exported study with evaluated observations, sources, assumptions and findings." });
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  }
  function openStudy(id: string) {
    const next = studies.find((item) => item.id === id);
    if (next) patch(continueStudy(draft, next));
  }
  const intervals = [["Target interval", "top", "base"], ["Comparison interval", "compareTop", "compareBase"]] as const;
  return <section className="demo-tool demo-analysis demo-study-side demo-study-tool" aria-label="Drilling study" data-testid="tool-study">
    <header className="demo-study-head">
      <div><h3>Drilling performance review</h3><p>{well.design.wellName ?? well.label}</p><small>{well.design.provenance} · revision {well.design.revision}</small></div>
      <div className="demo-edit-actions"><CommandButton icon="save" onClick={save}>Save study</CommandButton><CommandButton icon="download" onClick={exportStudy}>Export study</CommandButton></div>
    </header>
    <p role="status" className="demo-study-notice">{draft.notice}</p>
    {error && <p role="alert" className="demo-storage-error">{error}</p>}
    <div className="demo-study-navigator">
      <ol>{studyPhases.map((label, index) => <li key={label}><CommandButton kind="selection" aria-current={draft.phase === index ? "step" : undefined} onClick={() => patch({ phase: index as StudyDraft["phase"] })}><span>{index + 1}</span>{label}</CommandButton></li>)}</ol>
    </div>
    {stale && <p role="alert" className="demo-storage-error">The well revision or source evidence changed since this study was saved. Recheck inputs and review findings before saving a new basis.</p>}
    {draft.loaded && <details className="demo-study-saved"><summary>Saved result basis · revision {draft.loaded.wellRevision} · {draft.loaded.savedAt.slice(0, 10)}</summary><p>Original saved sampled mean ROP: target {draft.loaded.results.target.mean.toFixed(2)} {draft.loaded.results.target.unit}; comparison {draft.loaded.results.comparison.mean.toFixed(2)} {draft.loaded.results.comparison.unit}. These saved values are retained separately from current evaluation.</p></details>}
    {draft.phase === 0 && <section className="demo-study-panel"><h3>1 · Define the question and scope</h3><p>Compare sampled drilling behaviour in two explicit MD intervals; both are banded on the section as you type. Use recorded operations to investigate possible explanations—not to infer causation.</p>
      <label>Investigation question<textarea value={draft.question} onChange={(event) => patch({ question: event.target.value })} /></label>
      <div className="demo-study-scopes">{intervals.map(([label, fromKey, toKey]) => <fieldset key={label} data-interval={fromKey === "top" ? "target" : "comparison"}><legend>{label}</legend>
        <label>Top (m MD)<input aria-label={`${label} top (m MD)`} type="number" value={draft[fromKey]} onChange={(event) => patch({ [fromKey]: event.target.value })} /></label>
        <label>Base (m MD)<input aria-label={`${label} base (m MD)`} type="number" value={draft[toKey]} onChange={(event) => patch({ [toKey]: event.target.value })} /></label>
      </fieldset>)}</div>
      {scopeError && <p role="alert">{scopeError}</p>}
      <CommandButton icon="next" disabled={!!scopeError} onClick={() => { store.setDepthWindow([Math.min(scope.topM, comparison.topM), Math.max(scope.baseM, comparison.baseM)], "analysis-study"); patch({ phase: 1 }); }}>Check inputs</CommandButton>
    </section>}
    {draft.phase === 1 && <section className="demo-study-panel"><h3>2 · Check the evidence basis</h3><p>Data quality is part of the result. A plotted value is not automatically a trustworthy engineering measurement.</p>
      <dl className="demo-study-qc"><div><dt>Drilling log</dt><dd>{!logUrl ? "Not attached" : logError ? `Failed: ${logError}` : !activeLog ? "Loading…" : `${activeLog.las.curves[0]!.values.length} samples · ${activeLog.las.curves.length - 1} measurements`}</dd></div><div><dt>Depth reference</dt><dd>{well.design.depthDatum ?? "Not reported"} · study scope in m MD; source log {activeLog?.las.curves[0]?.unit ?? "unavailable"}</dd></div><div><dt>ROP eligibility</dt><dd>{evaluation ? `${evaluation.target.validCount}/${evaluation.target.rows.length} target samples; ${evaluation.comparison.validCount}/${evaluation.comparison.rows.length} comparison samples · ${evaluation.target.unit ?? "unit not reported"}` : "Check intervals and load the drilling log"}</dd></div><div><dt>Operations</dt><dd>{ops ? `${ops.days.length} daily reports · ${ops.runs.length} runs` : "Not attached; operational explanations cannot be reviewed"}</dd></div></dl>
      <p>Source depth datum is not independently verified. Compare the source header and well reference before using the result.</p><details><summary>Source metadata and assumptions</summary><pre>{JSON.stringify({ file: logUrl, well: activeLog?.las.well, parameters: activeLog?.las.parameters, sources: ops?.sources }, null, 2)}</pre><ul>{limits.map((item) => <li key={item}>{item}</li>)}</ul></details>
      {!eligible && <p role="alert">{logError ?? (!logUrl ? "Attach a drilling LAS log through Edit well. No synthetic replacement is used." : "Both intervals require valid ROP samples in ft/h or m/h.")}</p>}
      <label className="demo-study-ack"><input type="checkbox" checked={draft.acknowledgedBasis === basis} onChange={(event) => patch({ acknowledgedBasis: event.target.checked ? basis : "" })} />I reviewed source units, depth reference and sampling limitations</label>
      <CommandButton icon="next" disabled={!eligible || draft.acknowledgedBasis !== basis} onClick={() => { patch({ reviewedBasis: basis, samplePage: 0, phase: 2 }); tools.openPanel("evidence"); }}>Review evidence</CommandButton><Link href={`/view-well/?well=${well.id}&tool=edit-well`}>Edit well data sources</Link>
    </section>}
    {study.evidenceReady && evaluation && <section className="demo-study-panel"><h3>3 · Review linked evidence</h3><p>Target {draft.top}–{draft.base} m MD vs comparison {draft.compareTop}–{draft.compareBase} m MD.</p>
      <div className="demo-study-metrics"><div><span>Target sampled mean ROP</span><strong>{evaluation.target.mean?.toFixed(2) ?? "Unavailable"} {evaluation.target.unit}</strong></div><div><span>Comparison sampled mean ROP</span><strong>{evaluation.comparison.mean?.toFixed(2) ?? "Unavailable"} {evaluation.comparison.unit}</strong></div><div><span>Target minus comparison</span><strong>{change?.toFixed(2) ?? "Unavailable"} {evaluation.target.unit}</strong></div></div>
      <p className="demo-edit-hint">{evaluation.target.excludedCount} target ROP samples excluded; {evaluation.target.rows.length} log samples in scope. The difference is descriptive—not an efficiency, formation or failure diagnosis.</p>
      <CommandButton icon="add" aria-pressed={draft.evidenceIds.includes("comparison:rop")} onClick={() => attach("comparison:rop")}>Attach interval comparison</CommandButton>
      <label>Evidence interval<select value={draft.evidenceWindow} onChange={(event) => {
        const value = event.target.value;
        if (value === "target" || value === "comparison") patch({ evidenceWindow: value, samplePage: 0 });
      }}><option value="target">Target interval</option><option value="comparison">Comparison interval</option></select></label>
      <p className="demo-edit-hint">The evidence tool under the section holds the drilling log, its samples and the operational registers for this interval. Log zoom changes the preview only; calculations and attached samples stay scoped to the study interval.</p>
      {!tools.open.has("evidence") && <CommandButton icon="layers" onClick={() => tools.openPanel("evidence")}>Open evidence</CommandButton>}
      <CommandButton icon="next" onClick={() => patch({ phase: 3 })}>Record findings</CommandButton>
    </section>}
    {draft.phase === 2 && !evaluation && <p role="alert">No eligible evidence. Return to Check inputs.</p>}
    {draft.phase === 3 && <section className="demo-study-panel"><h3>4 · Record an evidence-backed finding</h3><p>Separate what was observed from possible explanations. Saving does not certify the interpretation.</p>
      <label>Finding<textarea value={draft.finding} onChange={(event) => patch({ finding: event.target.value })} placeholder="What changed? Which evidence supports the observation?" /></label>
      <label>Uncertainty and next check<textarea value={draft.uncertainty} onChange={(event) => patch({ uncertainty: event.target.value })} placeholder="What cannot be concluded? What additional evidence is needed?" /></label>
      <h4>Attached evidence · {draft.evidenceIds.length}</h4><ul>{draft.evidenceIds.map((id) => <li key={id}>{id}<CommandButton icon="remove" aria-label={`Remove ${id}`} onClick={() => attach(id)} /></li>)}</ul>{!draft.evidenceIds.length && <p>Return to Review evidence and attach the comparison or recorded context.</p>}
      <CommandButton icon="save" onClick={save}>Save finding</CommandButton>
    </section>}
    <div className="demo-study-library">
      <label>Saved studies<select aria-label="Saved studies" value={draft.studyId ?? ""} onChange={(event) => openStudy(event.target.value)}><option value="">Select a saved study</option>{studies.filter((item) => item.wellId === well.design.id).map((item) => <option value={item.id} key={item.id}>{item.question}</option>)}</select></label>
      <CommandButton icon="create" onClick={() => patch(restartStudy(draft))}>New study</CommandButton>
      <details><summary>Other disciplines</summary><p>Formation evaluation needs appropriate wireline/LWD logs and calibration. Production/injection surveillance needs rate, pressure and event history. These workflows are not implemented here; no substitute data or results are invented.</p></details>
      <p className="demo-study-footnote">Local studies · original records unchanged · no automatic diagnosis</p>
    </div>
  </section>;
}

/** The drilling log, its samples and the operational registers for the interval under review, docked under the section. */
export function EvidenceTool() {
  const { store, draft, patch, activeLog, focused, focusedScope, basis, evidenceReady, attach } = useStudy();
  const link = useDepthLink(true, store);
  const bridge = depthBridge(link);
  const previewBasis = `${basis}:${draft.evidenceWindow}`;
  const previewWindowFt = draft.preview?.basis === previewBasis ? draft.preview.windowFt : [metresToFeet(focusedScope.topM), metresToFeet(focusedScope.baseM)] as const;
  const window = draft.evidenceWindow;
  return <section className="demo-tool demo-analysis demo-study-evidence demo-evidence-tool" aria-label="Study evidence" data-testid="tool-evidence">
    {evidenceReady && activeLog && focused ? <>
      <div className="demo-study-evidence-log" tabIndex={0}>
        <LogTracks title={`${window === "target" ? "Target" : "Comparison"} drilling evidence`} height={200} las={{ ...activeLog.las, curves: activeLog.las.curves.map((curve, index) => index === 0 && curve.unit.toLowerCase() === "m" ? { ...curve, unit: "ft", values: curve.values.map((value) => value === null ? null : metresToFeet(value)) } : curve) }} tracks={tracks.filter((track) => activeLog.las.curves.some((curve) => curve.mnemonic === track.mnemonic))} selectedRange={{ topFt: metresToFeet(focusedScope.topM), baseFt: metresToFeet(focusedScope.baseM) }} depthWindowFt={previewWindowFt} onDepthWindowChange={(windowFt) => patch({ preview: { basis: previewBasis, windowFt } })} cursorFt={bridge.pinnedFt} onSelectDepth={bridge.pinFt} />
        <details><summary>Inspect and attach exact log samples</summary><div className="demo-study-table"><table><caption>{window} log samples · source units retained</caption><thead><tr><th>MD (m)</th><th>ROP ({focused.unit})</th><th>ROP quality</th><th>Evidence</th></tr></thead><tbody>{focused.rows.slice(draft.samplePage * 20, (draft.samplePage + 1) * 20).map((row) => <tr key={row.id}><td>{row.mdM.toFixed(2)}</td><td>{row.values.ROP ?? "Missing"}</td><td>{row.values.ROP === null || row.values.ROP === undefined ? "Missing" : row.values.ROP < 0 ? "Excluded: negative" : "Included"}</td><td><CommandButton icon="add" aria-label={`Attach sample ${row.mdM.toFixed(2)} m`} aria-pressed={draft.evidenceIds.includes(row.id)} onClick={() => attach(row.id, row.mdM)} /></td></tr>)}</tbody></table></div><div className="demo-edit-actions"><CommandButton icon="previous" disabled={draft.samplePage === 0} onClick={() => patch({ samplePage: draft.samplePage - 1 })}>Previous samples</CommandButton><span>Page {draft.samplePage + 1}</span><CommandButton icon="next" disabled={(draft.samplePage + 1) * 20 >= focused.rows.length} onClick={() => patch({ samplePage: draft.samplePage + 1 })}>Next samples</CommandButton></div></details>
      </div>
      <section className="demo-study-context" aria-label="Operational evidence">
        <header className="demo-study-context-header">
          <h3>Operational evidence</h3>
          <div className="demo-study-context-switch" role="group" aria-label="Record type">
            <CommandButton kind="selection" aria-pressed={draft.recordView === "runs"} onClick={() => patch({ recordView: "runs" })}>Runs <span>{focused.runs.length}</span></CommandButton>
            <CommandButton kind="selection" aria-pressed={draft.recordView === "days"} onClick={() => patch({ recordView: "days" })}>Daily reports <span>{focused.days.length}</span></CommandButton>
          </div>
        </header>
        <p className="demo-study-context-note">{draft.recordView === "runs" ? "Runs overlapping the selected interval." : "Reports matched by end-of-day MD, not the depth of every activity."} Source depths in ft; attach a record to pin its reported MD.</p>
        <div className="demo-study-table demo-study-context-table" role="region" aria-label={`${draft.recordView === "runs" ? "Runs" : "Daily reports"} register`} tabIndex={0} key={`${window}:${draft.recordView}`}>
          {draft.recordView === "runs" ? <table>
            <caption className="sw-sr-only">{window} overlapping runs</caption>
            <thead><tr><th scope="col">Run</th><th scope="col">Interval (ft MD)</th><th scope="col">Record</th><th scope="col">Page</th><th scope="col">Evidence</th></tr></thead>
            <tbody>{focused.runs.map((run) => {
              const id = `run:${run.id}`;
              const attached = draft.evidenceIds.includes(id);
              const depthFt = run.topFt ?? run.baseFt;
              return <tr key={id} data-attached={attached || undefined}>
                <th scope="row">{run.id}</th><td className="demo-study-depth" data-label="ft MD">{run.topFt ?? "?"}–{run.baseFt ?? "?"}</td>
                <td><details><summary>{run.kind} · {run.outcome}</summary><p>{run.summary}</p></details></td><td>{run.page}</td>
                <td><CommandButton icon={attached ? "apply" : "add"} aria-label={`${attached ? "Detach" : "Attach"} run ${run.id}`} aria-pressed={attached} onClick={() => attach(id, recordDepthToMetres(depthFt))}>{attached ? "Attached" : "Attach"}</CommandButton></td>
              </tr>;
            })}{!focused.runs.length && <tr><td colSpan={5}>No overlapping run intervals reported.</td></tr>}</tbody>
          </table> : <table>
            <caption className="sw-sr-only">{window} daily reports by end-of-day MD</caption>
            <thead><tr><th scope="col">Date</th><th scope="col">End MD (ft)</th><th scope="col">Record</th><th scope="col">Page</th><th scope="col">Evidence</th></tr></thead>
            <tbody>{focused.days.map((day) => {
              const id = `day:${day.date}`;
              const attached = draft.evidenceIds.includes(id);
              return <tr key={id} data-attached={attached || undefined}>
                <th scope="row">{day.date}</th><td className="demo-study-depth" data-label="End MD (ft)">{day.mdFt}</td>
                <td><details><summary>{day.category}</summary><p>{day.headline}</p></details></td><td>{day.page}</td>
                <td><CommandButton icon={attached ? "apply" : "add"} aria-label={`${attached ? "Detach" : "Attach"} daily report ${day.date}`} aria-pressed={attached} onClick={() => attach(id, recordDepthToMetres(day.mdFt))}>{attached ? "Attached" : "Attach"}</CommandButton></td>
              </tr>;
            })}{!focused.days.length && <tr><td colSpan={5}>No reported end-of-day MD in this interval.</td></tr>}</tbody>
          </table>}
        </div>
      </section>
    </> : <p className="demo-track-empty">The drilling log, its samples and the operational registers appear here once the inputs are checked and the evidence is under review — the study tool's step 3.</p>}
  </section>;
}
