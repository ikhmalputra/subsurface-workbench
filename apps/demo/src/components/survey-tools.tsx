"use client";

import { useEffect, useMemo, useState } from "react";
import { computeMinimumCurvature, ratioFactor, summarizeTrajectory, surveyConsistency, validateSurveyStations } from "@ikhmalputra/subsurface-core";
import type { BuildHoldInput, ComputedStation, SurveyStationInput } from "@ikhmalputra/subsurface-core";
import { BuildHoldForm, SurveyTable, TrajectorySummaryPanel } from "@ikhmalputra/subsurface-react/trajectory";
import { InfoTip, useDepthLink } from "@ikhmalputra/subsurface-react";
import { CommandButton } from "@ikhmalputra/subsurface-react/ui";
import { useWorkspace } from "./workspace-provider";
import { defaultPlan, planDraft, stationInputs, tryPlan } from "../lib/trajectory-draft";
import { editTrajectory } from "../lib/well-revision";

/**
 * The survey tools: the pieces of what was the trajectory workspace, each a panel over the
 * sheet's own section. They share one thing — the trajectory draft the workspace keeps per well —
 * and the section draws that draft as a preview until it is applied or discarded.
 */
const fmt = (value: number, digits = 2) => value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** The survey the tools work on: the draft when there is one, the host's record otherwise. */
function useWorkingSurvey() {
  const { well, trajectoryDrafts, updateTrajectoryDraft, applyRevision } = useWorkspace();
  const reference = well.design;
  const draft = trajectoryDrafts[reference.id];
  const stations = useMemo(() => draft?.stations ?? stationInputs(reference.survey ?? []), [draft, reference]);
  // One tie-in rule everywhere: the table, the sheet and the applied revision all tie to the
  // well's own first station. Plan mode used to drop it here while applying kept it, so the
  // positions in this table could differ from the positions that were saved.
  const survey = useMemo(() => computeMinimumCurvature(stations, { tieIn: reference.survey?.[0] }), [stations, reference]);
  const summary = useMemo(() => summarizeTrajectory(survey), [survey]);
  const dlsLimit = draft?.dlsLimitDegPer30m ?? 3;
  const issues = useMemo(() => validateSurveyStations(stations, { maxDlsDegPer30m: dlsLimit }), [stations, dlsLimit]);
  const apply = (): string | null => {
    if (!draft) return null;
    try {
      applyRevision(reference.id, { design: editTrajectory(reference, draft.stations), operations: well.operations ?? null, logUrl: well.logUrl ?? null });
      updateTrajectoryDraft(reference.id, null);
      return null;
    } catch (error) { return error instanceof Error ? error.message : String(error); }
  };
  const discard = () => updateTrajectoryDraft(reference.id, null);
  return { well, reference, draft, stations, survey, summary, issues, dlsLimit, apply, discard, update: (next: typeof draft | null) => updateTrajectoryDraft(reference.id, next ?? null) };
}

function PreviewActions({ onApply, onDiscard, note }: { onApply: () => string | null; onDiscard: () => void; note: string }) {
  const [rejected, setRejected] = useState<string | null>(null);
  return <div className="demo-preview-actions" role="group" aria-label="Trajectory preview">
    <p>{note}</p>
    <CommandButton icon="apply" onClick={() => setRejected(onApply())}>Apply to active well</CommandButton>
    <CommandButton icon="reset" onClick={() => { setRejected(null); onDiscard(); }}>Discard preview</CommandButton>
    {rejected && <p role="alert" className="demo-reject">{rejected}</p>}
  </div>;
}

/* ------------------------------------------------------------------ planner */
export function TrajectoryPlannerTool() {
  const { reference, draft, apply, discard, update } = useWorkingSurvey();
  const [input, setInput] = useState<BuildHoldInput>(() => draft?.mode === "plan" ? draft.plan : defaultPlan(reference));
  const live = tryPlan(input);
  // Opening the planner starts a plan preview from the well's own TD, so the section shows at
  // once what the planner is for. A solved input replaces the draft as it is typed.
  useEffect(() => { if (!draft || draft.mode !== "plan") { const next = planDraft(input, draft); if (next) update(next); } }, []); // once, on open
  // A target dragged on the plan view comes back through the draft; keep the form on it.
  useEffect(() => { if (draft?.mode === "plan" && draft.plan !== input) setInput(draft.plan); }, [draft]);
  return <section className="demo-tool demo-survey-tool" aria-label="Trajectory planner" data-testid="tool-planner">
    <p className="demo-tool-lede">A build-and-hold profile solved exactly through the target from the kick-off at the build rate, with a DLS limit. The section, the plan and the vertical section draw it as a preview; drag the target on the plan view or type it here.</p>
    <BuildHoldForm value={input} onChange={(next) => { setInput(next); const made = planDraft(next, draft); if (made) update(made); }} plan={live.plan} error={live.error} />
    {draft && <PreviewActions onApply={apply} onDiscard={discard} note={draft.mode === "plan" ? "Planned trajectory shown as a preview. Applying makes it a user-authored revision of this well; the observed source is kept." : "Edited stations are the current preview; applying them replaces this plan."} />}
  </section>;
}

/* ------------------------------------------------------------------ station editor */
export function StationEditorTool() {
  const { reference, draft, stations, survey, issues, dlsLimit, apply, discard, update } = useWorkingSurvey();
  const { store } = useWorkspace();
  const link = useDepthLink(true, store);
  const [rejected, setRejected] = useState<string | null>(null);
  // Editing is a deliberate step: the table reads the host's survey, or the planner's stations,
  // until "Edit these stations" copies them into an edit draft. Then every cell is an input.
  const editing = draft?.mode === "edit";
  const startEditing = () => { setRejected(null); update({ mode: "edit", plan: draft?.plan ?? defaultPlan(reference), stations: [...stations], dlsLimitDegPer30m: dlsLimit }); };
  const editSurvey = (next: readonly SurveyStationInput[]) => {
    const error = validateSurveyStations(next).find((issue) => issue.severity === "error");
    if (error) { setRejected(`Edit rejected — station ${error.index + 1}: ${error.message}`); return; }
    setRejected(null);
    update({ mode: "edit", plan: draft?.plan ?? defaultPlan(reference), stations: [...next], dlsLimitDegPer30m: dlsLimit });
  };
  return <section className="demo-tool demo-survey-tool demo-station-editor" aria-label="Station editor" data-testid="tool-stations">
    <div className="demo-tool-grid demo-station-head">
      <p className="demo-tool-lede">{stations.length} stations{editing ? " · editable — every position, DLS and the section's survey track recompute as a station changes; impossible edits are rejected and the previous value kept." : draft ? " · the planner's stations" : " · the host's survey, positions always computed"}</p>
      {!editing && <CommandButton icon="edit" className="demo-small-button" onClick={startEditing}>Edit these stations</CommandButton>}
      <label className="demo-tool-field"><span>DLS limit</span><span className="demo-tool-input"><input type="number" min="0.5" max="30" step="0.5" value={dlsLimit} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value > 0) update({ mode: draft?.mode ?? "edit", plan: draft?.plan ?? defaultPlan(reference), stations: [...stations], dlsLimitDegPer30m: value }); }} /><small>°/30 m</small></span></label>
    </div>
    {rejected && <p className="demo-reject" role="alert">{rejected}</p>}
    <div className="demo-traj-table" tabIndex={0}>
      <SurveyTable survey={survey} onChange={editing ? editSurvey : undefined} issues={issues} selectedMdM={link.pinnedMdM} onSelectMd={link.pinCursor} dlsLimitDegPer30m={dlsLimit} maxHeight={220} />
    </div>
    {draft && <PreviewActions onApply={apply} onDiscard={discard} note={draft.mode === "edit" ? "Edited stations shown as a preview on the section." : "The planner's stations; edit any to take over the preview."} />}
  </section>;
}

/* ------------------------------------------------------------------ summary and course math */
export function SurveySummaryTool() {
  const { reference, draft, survey, summary, dlsLimit } = useWorkingSurvey();
  const { store } = useWorkspace();
  const link = useDepthLink(true, store);
  const consistency = useMemo(() => !draft && reference.survey ? surveyConsistency(reference.survey) : null, [draft, reference]);
  return <section className="demo-tool demo-survey-tool" aria-label="Survey summary" data-testid="tool-survey-summary">
    <TrajectorySummaryPanel summary={summary} dlsLimitDegPer30m={dlsLimit} footer={consistency && <p className="demo-verify" data-testid="trajectory-verification"><b>✓ Verified</b> Recomputed positions match the {reference.provenance === "documented" ? "published" : "fixture"} survey within {fmt(consistency.maxDeviationM * 1000, 1)} mm over {reference.survey!.length} stations.</p>} />
    {draft && <p className="demo-tool-note" role="status">{draft.mode === "plan" ? "Preview: the planner's trajectory." : "Preview: edited stations."} Apply or discard it from the planner or the station editor.</p>}
    <CourseMath survey={survey} selectedMdM={link.pinnedMdM} />
    <details className="demo-traj-explainer"><summary>How every number here is computed</summary><Explainer /></details>
  </section>;
}

/** The minimum-curvature calculation for the course ending at the selected station, with real numbers. */
function CourseMath({ survey, selectedMdM }: { survey: readonly ComputedStation[]; selectedMdM: number | null }) {
  let index = survey.findIndex((station) => selectedMdM != null && station.mdM >= selectedMdM - 1e-6);
  if (index < 1) index = selectedMdM == null ? Math.max(1, survey.findIndex((station) => station.dlsDegPer30m === Math.max(...survey.map((item) => item.dlsDegPer30m)))) : 1;
  const from = survey[index - 1];
  const to = survey[index];
  if (!from || !to) return null;
  const beta = to.doglegDeg * Math.PI / 180;
  const rf = ratioFactor(beta);
  return <section className="demo-course" aria-label="Course calculation" data-testid="course-math">
    <header><strong className="sw-title">Course {index} → {index + 1}<InfoTip label="About the course">The course between two survey stations, computed by minimum curvature. Click any plot, the 3D probe or a survey row to pick a course; until then the highest-DLS course is shown.</InfoTip></strong><span>{selectedMdM == null ? "highest DLS" : `MD ${fmt(selectedMdM, 1)} m`}</span></header>
    <dl>
      <div><dt>ΔMD</dt><dd>{fmt(to.courseLengthM)} m</dd></div>
      <div><dt>I₁ → I₂</dt><dd>{fmt(from.inclinationDeg)}° → {fmt(to.inclinationDeg)}°</dd></div>
      <div><dt>A₁ → A₂</dt><dd>{fmt(from.azimuthDeg)}° → {fmt(to.azimuthDeg)}°</dd></div>
      <div><dt>Dogleg β</dt><dd>{fmt(to.doglegDeg, 3)}°</dd></div>
      <div><dt>Ratio factor RF</dt><dd>{rf.toFixed(6)}</dd></div>
      <div><dt>ΔTVD · ΔN · ΔE</dt><dd>{fmt(to.tvdM - from.tvdM)} · {fmt(to.northingM - from.northingM)} · {fmt(to.eastingM - from.eastingM)} m</dd></div>
      <div><dt>DLS = β·30/ΔMD</dt><dd>{fmt(to.dlsDegPer30m)}°/30 m</dd></div>
      <div><dt>Build · turn</dt><dd>{fmt(to.buildRateDegPer30m)} · {fmt(to.turnRateDegPer30m)}°/30 m</dd></div>
    </dl>
  </section>;
}

function Explainer() {
  return <section className="demo-explainer" aria-label="How the trajectory is computed">
    <p>Each survey station gives measured depth (MD, along-hole), inclination I (0° = vertical down) and azimuth A (clockwise from grid north). Between two stations the hole is assumed to follow a circular arc — minimum curvature.</p>
    <ol>
      <li><span>Dogleg — total angle change</span><code>β = arccos[cos(I₂−I₁) − sin I₁ · sin I₂ · (1 − cos(A₂−A₁))]</code></li>
      <li><span>Ratio factor — bends the straight average onto the arc</span><code>RF = (2/β) · tan(β/2)   (RF → 1 as β → 0)</code></li>
      <li><span>Position change over the course</span><code>ΔN = ΔMD/2 · (sin I₁ cos A₁ + sin I₂ cos A₂) · RF{"\n"}ΔE = ΔMD/2 · (sin I₁ sin A₁ + sin I₂ sin A₂) · RF{"\n"}ΔTVD = ΔMD/2 · (cos I₁ + cos I₂) · RF</code></li>
      <li><span>Dogleg severity, normalised to 30 m</span><code>DLS = β · 30 / ΔMD   [°/30 m]</code></li>
      <li><span>Vertical section and closure</span><code>VS = N · cos(VSaz) + E · sin(VSaz){"\n"}closure = √(N² + E²) @ atan2(E, N)</code></li>
      <li><span>Build & hold through a target</span><code>R = 30 · 180 / (π · BUR){"\n"}θ = atan2(D − R, Z) + asin(R / √((D − R)² + Z²)){"\n"}hold = √((D − R)² + Z² − R²)</code></li>
    </ol>
    <p>Positions between stations (3D probe, markers) are interpolated along the same arc. Planned profiles are exact through the target; a plan that cannot reach its target at the build rate is reported, not forced.</p>
  </section>;
}
