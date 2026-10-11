"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { LasFile } from "@ikhmalputra/subsurface-core";
import { LogTracks } from "@ikhmalputra/subsurface-react/records";
import { CommandButton } from "@ikhmalputra/subsurface-react/ui";
import { useDepthLink } from "@ikhmalputra/subsurface-react/state";
import { useWorkspace } from "./workspace-provider";
import { intervalEvidence, parseStudies, readDrillingLog, studySignature, studyStorageKey, validateScope } from "../lib/drilling-study";
import type { DrillingStudy } from "../lib/drilling-study";

const phases = ["Scope", "Check inputs", "Review evidence", "Findings"] as const;
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

export function AnalysisWorkspace() {
  const { well } = useWorkspace();
  return <WellStudy key={well.id} />;
}

function WellStudy() {
  const { well, store } = useWorkspace();
  const link = useDepthLink(true, store);
  const [phase, setPhase] = useState(0);
  const [question, setQuestion] = useState("What changed in drilling performance across these intervals, and what recorded evidence could explain it?");
  const td = well.design.totalDepthM;
  const [top, setTop] = useState(String(Math.round(td * 0.6)));
  const [base, setBase] = useState(String(Math.floor(td)));
  const [compareTop, setCompareTop] = useState(String(Math.round(td * 0.3)));
  const [compareBase, setCompareBase] = useState(String(Math.round(td * 0.6)));
  const [finding, setFinding] = useState("");
  const [uncertainty, setUncertainty] = useState("");
  const [evidenceIds, setEvidenceIds] = useState<readonly string[]>([]);
  const [studies, setStudies] = useState<readonly DrillingStudy[]>([]);
  const [studyId, setStudyId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<DrillingStudy | null>(null);
  const [reviewedBasis, setReviewedBasis] = useState("");
  const [acknowledgedBasis, setAcknowledgedBasis] = useState("");
  const [samplePage, setSamplePage] = useState(0);
  const [evidenceWindow, setEvidenceWindow] = useState<"target" | "comparison">("target");
  const [recordView, setRecordView] = useState<"runs" | "days">("runs");
  const [preview, setPreview] = useState<{ basis: string; windowFt: readonly [number, number] | null } | null>(null);
  const [notice, setNotice] = useState("Define the investigation before reviewing evidence.");
  const [error, setError] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [log, setLog] = useState<{ url: string; text: string; las: LasFile } | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const logUrl = well.logUrl;
  useEffect(() => {
    try { const saved = localStorage.getItem(studyStorageKey); setStudies(saved ? parseStudies(saved) : []); setStorageReady(true); }
    catch (caught) { setError(`Saved studies could not be loaded: ${caught instanceof Error ? caught.message : String(caught)}`); }
  }, []);
  useEffect(() => {
    if (!logUrl) return;
    const controller = new AbortController();
    setLogError(null);
    fetch(logUrl, { signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    }).then((text) => { if (!controller.signal.aborted) setLog({ url: logUrl, text, las: readDrillingLog(text) }); })
      .catch((caught: unknown) => { if (!controller.signal.aborted) setLogError(caught instanceof Error ? caught.message : String(caught)); });
    return () => controller.abort();
  }, [logUrl]);
  const activeLog = log?.url === logUrl ? log : null;
  const scope = { topM: top.trim() ? Number(top) : NaN, baseM: base.trim() ? Number(base) : NaN };
  const comparison = { topM: compareTop.trim() ? Number(compareTop) : NaN, baseM: compareBase.trim() ? Number(compareBase) : NaN };
  let scopeError: string | null = null;
  try { validateScope(scope, td); validateScope(comparison, td); if (!question.trim()) throw new Error("State an investigation question."); }
  catch (caught) { scopeError = caught instanceof Error ? caught.message : String(caught); }
  const ops = well.operations ?? null;
  const evaluation = activeLog && !scopeError ? {
    target: intervalEvidence(activeLog.las, ops, scope),
    comparison: intervalEvidence(activeLog.las, ops, comparison),
  } : null;
  const signature = activeLog ? studySignature(activeLog.text, ops) : "";
  const basis = JSON.stringify({ signature, revision: well.design.revision, scope, comparison });
  const stale = loaded && (loaded.wellRevision !== well.design.revision || (!!activeLog && loaded.sourceSignature !== signature));
  const eligible = evaluation && evaluation.target.validCount > 0 && evaluation.comparison.validCount > 0;
  const focused = evaluation?.[evidenceWindow];
  const focusedScope = evidenceWindow === "target" ? scope : comparison;
  const previewBasis = `${basis}:${evidenceWindow}`;
  const previewWindowFt = preview?.basis === previewBasis ? preview.windowFt : [focusedScope.topM / 0.3048, focusedScope.baseM / 0.3048] as const;
  const change = evaluation?.target.mean !== null && evaluation?.comparison.mean !== null && evaluation ? evaluation.target.mean! - evaluation.comparison.mean! : null;
  function attach(id: string, mdM?: number) {
    setEvidenceIds((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]);
    if (mdM !== undefined) store.pinDepth(well.design.id, mdM, "analysis-study");
  }
  function snapshot(): DrillingStudy {
    if (scopeError || !eligible) throw new Error(scopeError ?? "Both intervals need valid ROP observations before saving findings.");
    if (reviewedBasis !== basis) throw new Error("Review evidence for the current intervals and source revision before saving findings.");
    const availableIds = new Set(["comparison:rop", ...[evaluation.target, evaluation.comparison].flatMap((interval) => [...interval.rows.map((row) => row.id), ...interval.runs.map((run) => `run:${run.id}`), ...interval.days.map((day) => `day:${day.date}`)])]);
    if (evidenceIds.some((id) => !availableIds.has(id))) throw new Error("Some attached evidence is outside the current scope or no longer available. Remove it and recheck the finding.");
    if (!finding.trim() || !uncertainty.trim() || !evidenceIds.length) throw new Error("Record a finding, uncertainty and at least one evidence reference.");
    return { version: 1, id: studyId ?? crypto.randomUUID(), wellId: well.design.id, wellRevision: well.design.revision, question, scope, comparison, finding, uncertainty, evidenceIds, sourceSignature: signature, savedAt: new Date().toISOString(), results: {
      target: { mean: evaluation.target.mean!, unit: evaluation.target.unit!, validCount: evaluation.target.validCount, excludedCount: evaluation.target.excludedCount },
      comparison: { mean: evaluation.comparison.mean!, unit: evaluation.comparison.unit!, validCount: evaluation.comparison.validCount, excludedCount: evaluation.comparison.excludedCount },
    } };
  }
  function save() {
    try {
      if (!storageReady) throw new Error("Study storage is unavailable; existing saved studies will not be overwritten.");
      const next = snapshot();
      const saved = localStorage.getItem(studyStorageKey);
      const current = saved ? parseStudies(saved) : [];
      const all = [...current.filter((item) => item.id !== next.id), next];
      localStorage.setItem(studyStorageKey, JSON.stringify(all));
      setStudies(all); setStudyId(next.id); setLoaded(next); setError(null); setNotice("Study saved on this device.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  }
  function exportStudy() {
    try {
      const next = snapshot();
      const content = { study: next, evaluation, assumptions: limits, sources: { logUrl, logParameters: activeLog?.las.parameters, operationalSources: ops?.sources }, provenance: well.design.provenance };
      const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${well.id}-drilling-study.json`; anchor.click(); URL.revokeObjectURL(url);
      setError(null); setNotice("Exported study with evaluated observations, sources, assumptions and findings.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  }
  function openStudy(id: string) {
    const next = studies.find((item) => item.id === id);
    if (!next) return;
    setLoaded(next); setStudyId(next.id); setQuestion(next.question); setTop(String(next.scope.topM)); setBase(String(next.scope.baseM));
    setCompareTop(String(next.comparison.topM)); setCompareBase(String(next.comparison.baseM)); setFinding(next.finding); setUncertainty(next.uncertainty); setEvidenceIds(next.evidenceIds); setReviewedBasis(""); setPhase(1);
  }
  return <section className="demo-analysis" aria-label="Engineering study workspace">
    <header className="demo-edit-commandbar"><div className="demo-edit-identity"><span className="demo-eyebrow">ANALYSIS · ENGINEERING STUDIES</span><h1>Drilling performance review</h1></div><div className="demo-edit-actions"><CommandButton icon="save" onClick={save}>Save study</CommandButton><CommandButton icon="download" onClick={exportStudy}>Export study</CommandButton></div></header>
    {error && <p role="alert" className="demo-storage-error">{error}</p>}
    <div className="demo-study-layout">
      <aside className="demo-study-navigator" aria-label="Study navigator">
        <h2>Investigation</h2><p>{well.design.wellName ?? well.label}</p><small>{well.design.provenance} · revision {well.design.revision}</small>
        <ol>{phases.map((label, index) => <li key={label}><CommandButton kind="selection" aria-current={phase === index ? "step" : undefined} onClick={() => setPhase(index)}><span>{index + 1}</span>{label}</CommandButton></li>)}</ol>
        <label>Saved studies<select aria-label="Saved studies" value={studyId ?? ""} onChange={(event) => openStudy(event.target.value)}><option value="">Select a saved study</option>{studies.filter((item) => item.wellId === well.design.id).map((item) => <option value={item.id} key={item.id}>{item.question}</option>)}</select></label>
        <CommandButton icon="create" onClick={() => { setStudyId(null); setLoaded(null); setFinding(""); setUncertainty(""); setEvidenceIds([]); setPhase(0); setNotice("New study started; saved studies remain unchanged."); }}>New study</CommandButton>
        <details><summary>Other disciplines</summary><p>Formation evaluation needs appropriate wireline/LWD logs and calibration. Production/injection surveillance needs rate, pressure and event history. These workflows are not implemented here; no substitute data or results are invented.</p></details>
      </aside>
      <div className="demo-study-main">
        {stale && <p role="alert" className="demo-storage-error">The well revision or source evidence changed since this study was saved. Recheck inputs and review findings before saving a new basis.</p>}
        {loaded && <details><summary>Saved result basis · revision {loaded.wellRevision} · {loaded.savedAt.slice(0, 10)}</summary><p>Original saved sampled mean ROP: target {loaded.results.target.mean.toFixed(2)} {loaded.results.target.unit}; comparison {loaded.results.comparison.mean.toFixed(2)} {loaded.results.comparison.unit}. These saved values are retained separately from current evaluation.</p></details>}
        {phase === 0 && <section className="demo-study-panel"><h2>1 · Define the question and scope</h2><p>Compare sampled drilling behaviour in two explicit MD intervals. Use recorded operations to investigate possible explanations—not to infer causation.</p><label>Investigation question<textarea value={question} onChange={(event) => setQuestion(event.target.value)} /></label><div className="demo-study-scopes">{[["Target interval", top, base, setTop, setBase], ["Comparison interval", compareTop, compareBase, setCompareTop, setCompareBase]].map(([label, from, to, setFrom, setTo]) => <fieldset key={String(label)}><legend>{String(label)}</legend><label>Top (m MD)<input aria-label={`${label} top (m MD)`} type="number" value={String(from)} onChange={(event) => { if (typeof setFrom === "function") setFrom(event.target.value); }} /></label><label>Base (m MD)<input aria-label={`${label} base (m MD)`} type="number" value={String(to)} onChange={(event) => { if (typeof setTo === "function") setTo(event.target.value); }} /></label></fieldset>)}</div>{scopeError && <p role="alert">{scopeError}</p>}<CommandButton icon="next" disabled={!!scopeError} onClick={() => { store.setDepthWindow([scope.topM, scope.baseM], "analysis-study"); setPhase(1); }}>Check inputs</CommandButton></section>}
        {phase === 1 && <section className="demo-study-panel"><h2>2 · Check the evidence basis</h2><p>Data quality is part of the result. A plotted value is not automatically a trustworthy engineering measurement.</p>
          <dl className="demo-study-qc"><div><dt>Drilling log</dt><dd>{!logUrl ? "Not attached" : logError ? `Failed: ${logError}` : !activeLog ? "Loading…" : `${activeLog.las.curves[0]!.values.length} samples · ${activeLog.las.curves.length - 1} measurements`}</dd></div><div><dt>Depth reference</dt><dd>{well.design.depthDatum ?? "Not reported"} · study scope in m MD; source log {activeLog?.las.curves[0]?.unit ?? "unavailable"}</dd></div><div><dt>ROP eligibility</dt><dd>{evaluation ? `${evaluation.target.validCount}/${evaluation.target.rows.length} target samples; ${evaluation.comparison.validCount}/${evaluation.comparison.rows.length} comparison samples · ${evaluation.target.unit ?? "unit not reported"}` : "Check intervals and load the drilling log"}</dd></div><div><dt>Operations</dt><dd>{ops ? `${ops.days.length} daily reports · ${ops.runs.length} runs` : "Not attached; operational explanations cannot be reviewed"}</dd></div></dl>
          <p>Source depth datum is not independently verified. Compare the source header and well reference before using the result.</p><details><summary>Source metadata and assumptions</summary><pre>{JSON.stringify({ file: logUrl, well: activeLog?.las.well, parameters: activeLog?.las.parameters, sources: ops?.sources }, null, 2)}</pre><ul>{limits.map((item) => <li key={item}>{item}</li>)}</ul></details>
          {!eligible && <p role="alert">{logError ?? (!logUrl ? "Attach a drilling LAS log through Edit well. No synthetic replacement is used." : "Both intervals require valid ROP samples in ft/h or m/h.")}</p>}
          <label className="demo-study-ack"><input type="checkbox" checked={acknowledgedBasis === basis} onChange={(event) => setAcknowledgedBasis(event.target.checked ? basis : "")} />I reviewed source units, depth reference and sampling limitations</label>
          <CommandButton icon="next" disabled={!eligible || acknowledgedBasis !== basis} onClick={() => { setReviewedBasis(basis); setSamplePage(0); setPhase(2); }}>Review evidence</CommandButton><Link href={`/edit-well/?well=${well.id}`}>Edit well data sources</Link>
        </section>}
        {phase === 2 && evaluation && activeLog && focused && <section className="demo-study-panel"><h2>3 · Review linked evidence</h2><p>Target {top}–{base} m MD vs comparison {compareTop}–{compareBase} m MD.</p>
          <div className="demo-study-metrics"><div><span>Target sampled mean ROP</span><strong>{evaluation.target.mean?.toFixed(2) ?? "Unavailable"} {evaluation.target.unit}</strong></div><div><span>Comparison sampled mean ROP</span><strong>{evaluation.comparison.mean?.toFixed(2) ?? "Unavailable"} {evaluation.comparison.unit}</strong></div><div><span>Target minus comparison</span><strong>{change?.toFixed(2) ?? "Unavailable"} {evaluation.target.unit}</strong></div></div>
          <p className="demo-edit-hint">{evaluation.target.excludedCount} target ROP samples excluded; {evaluation.target.rows.length} log samples in scope. The difference is descriptive—not an efficiency, formation or failure diagnosis.</p>
          <CommandButton icon="add" aria-pressed={evidenceIds.includes("comparison:rop")} onClick={() => attach("comparison:rop")}>Attach interval comparison</CommandButton>
          <label>Evidence interval<select value={evidenceWindow} onChange={(event) => {
            const value = event.target.value;
            if (value === "target" || value === "comparison") { setEvidenceWindow(value); setSamplePage(0); }
          }}><option value="target">Target interval</option><option value="comparison">Comparison interval</option></select></label>
          <p className="demo-edit-hint">Log zoom changes the preview only. Calculations and attached samples remain scoped to the selected study interval.</p>
          <LogTracks title={`${evidenceWindow === "target" ? "Target" : "Comparison"} drilling evidence`} las={{ ...activeLog.las, curves: activeLog.las.curves.map((curve, index) => index === 0 && curve.unit.toLowerCase() === "m" ? { ...curve, unit: "ft", values: curve.values.map((value) => value === null ? null : value / 0.3048) } : curve) }} tracks={tracks.filter((track) => activeLog.las.curves.some((curve) => curve.mnemonic === track.mnemonic))} selectedRange={{ topFt: focusedScope.topM / 0.3048, baseFt: focusedScope.baseM / 0.3048 }} depthWindowFt={previewWindowFt} onDepthWindowChange={(windowFt) => setPreview({ basis: previewBasis, windowFt })} cursorFt={link.pinnedMdM === null ? null : link.pinnedMdM / 0.3048} onSelectDepth={(depth) => link.pinCursor(depth * 0.3048)} />
          <details><summary>Inspect and attach exact log samples</summary><div className="demo-study-table"><table><caption>{evidenceWindow} log samples · source units retained</caption><thead><tr><th>MD (m)</th><th>ROP ({focused.unit})</th><th>ROP quality</th><th>Evidence</th></tr></thead><tbody>{focused.rows.slice(samplePage * 20, (samplePage + 1) * 20).map((row) => <tr key={row.id}><td>{row.mdM.toFixed(2)}</td><td>{row.values.ROP ?? "Missing"}</td><td>{row.values.ROP === null || row.values.ROP === undefined ? "Missing" : row.values.ROP < 0 ? "Excluded: negative" : "Included"}</td><td><CommandButton icon="add" aria-label={`Attach sample ${row.mdM.toFixed(2)} m`} aria-pressed={evidenceIds.includes(row.id)} onClick={() => attach(row.id, row.mdM)} /></td></tr>)}</tbody></table></div><div className="demo-edit-actions"><CommandButton icon="previous" disabled={samplePage === 0} onClick={() => setSamplePage(samplePage - 1)}>Previous samples</CommandButton><span>Page {samplePage + 1}</span><CommandButton icon="next" disabled={(samplePage + 1) * 20 >= focused.rows.length} onClick={() => setSamplePage(samplePage + 1)}>Next samples</CommandButton></div></details>
          <section className="demo-study-context" aria-label="Operational evidence">
            <header className="demo-study-context-header">
              <h3>Operational evidence</h3>
              <div className="demo-study-context-switch" role="group" aria-label="Record type">
                <CommandButton kind="selection" aria-pressed={recordView === "runs"} onClick={() => setRecordView("runs")}>Runs <span>{focused.runs.length}</span></CommandButton>
                <CommandButton kind="selection" aria-pressed={recordView === "days"} onClick={() => setRecordView("days")}>Daily reports <span>{focused.days.length}</span></CommandButton>
              </div>
            </header>
            <p className="demo-study-context-note">{recordView === "runs" ? "Runs overlapping the selected interval." : "Reports matched by end-of-day MD, not the depth of every activity."} Source depths in ft; attach a record to pin its reported MD.</p>
            <div className="demo-study-table demo-study-context-table" role="region" aria-label={`${recordView === "runs" ? "Runs" : "Daily reports"} register`} tabIndex={0} key={`${evidenceWindow}:${recordView}`}>
              {recordView === "runs" ? <table>
                <caption className="sw-sr-only">{evidenceWindow} overlapping runs</caption>
                <thead><tr><th scope="col">Run</th><th scope="col">Interval (ft MD)</th><th scope="col">Record</th><th scope="col">Page</th><th scope="col">Evidence</th></tr></thead>
                <tbody>{focused.runs.map((run) => {
                  const id = `run:${run.id}`;
                  const attached = evidenceIds.includes(id);
                  const depthFt = run.topFt ?? run.baseFt;
                  return <tr key={id} data-attached={attached || undefined}>
                    <th scope="row">{run.id}</th><td className="demo-study-depth" data-label="ft MD">{run.topFt ?? "?"}–{run.baseFt ?? "?"}</td>
                    <td><details><summary>{run.kind} · {run.outcome}</summary><p>{run.summary}</p></details></td><td>{run.page}</td>
                    <td><CommandButton icon={attached ? "apply" : "add"} aria-label={`${attached ? "Detach" : "Attach"} run ${run.id}`} aria-pressed={attached} onClick={() => attach(id, depthFt == null ? undefined : depthFt * 0.3048)}>{attached ? "Attached" : "Attach"}</CommandButton></td>
                  </tr>;
                })}{!focused.runs.length && <tr><td colSpan={5}>No overlapping run intervals reported.</td></tr>}</tbody>
              </table> : <table>
                <caption className="sw-sr-only">{evidenceWindow} daily reports by end-of-day MD</caption>
                <thead><tr><th scope="col">Date</th><th scope="col">End MD (ft)</th><th scope="col">Record</th><th scope="col">Page</th><th scope="col">Evidence</th></tr></thead>
                <tbody>{focused.days.map((day) => {
                  const id = `day:${day.date}`;
                  const attached = evidenceIds.includes(id);
                  return <tr key={id} data-attached={attached || undefined}>
                    <th scope="row">{day.date}</th><td className="demo-study-depth" data-label="End MD (ft)">{day.mdFt}</td>
                    <td><details><summary>{day.category}</summary><p>{day.headline}</p></details></td><td>{day.page}</td>
                    <td><CommandButton icon={attached ? "apply" : "add"} aria-label={`${attached ? "Detach" : "Attach"} daily report ${day.date}`} aria-pressed={attached} onClick={() => attach(id, day.mdFt === null ? undefined : day.mdFt * 0.3048)}>{attached ? "Attached" : "Attach"}</CommandButton></td>
                  </tr>;
                })}{!focused.days.length && <tr><td colSpan={5}>No reported end-of-day MD in this interval.</td></tr>}</tbody>
              </table>}
            </div>
          </section>
          <CommandButton icon="next" onClick={() => setPhase(3)}>Record findings</CommandButton>
        </section>}
        {phase === 2 && !evaluation && <p role="alert">No eligible evidence. Return to Check inputs.</p>}
        {phase === 3 && <section className="demo-study-panel"><h2>4 · Record an evidence-backed finding</h2><p>Separate what was observed from possible explanations. Saving does not certify the interpretation.</p><label>Finding<textarea value={finding} onChange={(event) => setFinding(event.target.value)} placeholder="What changed? Which evidence supports the observation?" /></label><label>Uncertainty and next check<textarea value={uncertainty} onChange={(event) => setUncertainty(event.target.value)} placeholder="What cannot be concluded? What additional evidence is needed?" /></label><h3>Attached evidence · {evidenceIds.length}</h3><ul>{evidenceIds.map((id) => <li key={id}>{id}<CommandButton icon="remove" aria-label={`Remove ${id}`} onClick={() => attach(id)} /></li>)}</ul>{!evidenceIds.length && <p>Return to Review evidence and attach the comparison or recorded context.</p>}<CommandButton icon="save" onClick={save}>Save finding</CommandButton></section>}
      </div>
    </div>
    <footer className="demo-edit-statusbar"><span role="status">{notice}</span><span>Local studies · original records unchanged · no automatic diagnosis</span></footer>
  </section>;
}
