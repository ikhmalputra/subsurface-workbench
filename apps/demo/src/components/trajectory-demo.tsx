"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
import { computeMinimumCurvature, designWithTrajectory, getWellComponents, planBuildHold, ratioFactor, summarizeTrajectory, surveyConsistency, validateSurveyStations } from "@ikhmalputra/subsurface-core";
import type { BuildHoldInput, BuildHoldPlan, ComputedStation, SurveyStationInput, WellDesign } from "@ikhmalputra/subsurface-core";
import { BuildHoldForm, SurveyTable, TrajectoryLog, TrajectoryPlanView, TrajectorySectionView, TrajectorySummaryPanel } from "@ikhmalputra/subsurface-react/trajectory";
import type { TrajectoryMarker } from "@ikhmalputra/subsurface-react/trajectory";
import { RecordCard, useWell } from "./wells";
import { InfoTip } from "@ikhmalputra/subsurface-react";
import { useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";
import { useWorkspace } from "./workspace-provider";
import { CommandButton } from "@ikhmalputra/subsurface-react/ui";
import { editTrajectory } from "../lib/well-revision";

const WellScene = dynamic(() => import("@ikhmalputra/subsurface-react/three"), { ssr: false, loading: () => <div className="sw-scene-loading">Loading 3D scene…</div> });

type Mode = "survey" | "plan" | "edit";
const modes: readonly { id: Mode; label: string }[] = [
  { id: "survey", label: "View survey" },
  { id: "plan", label: "Plan build & hold" },
  { id: "edit", label: "Edit stations" },
];

const fmt = (value: number, digits = 2) => value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const inputsOf = (survey: readonly { mdM: number; inclinationDeg: number; azimuthDeg: number }[]): SurveyStationInput[] => survey.map(({ mdM, inclinationDeg, azimuthDeg }) => ({ mdM, inclinationDeg, azimuthDeg }));

function tryPlan(input: BuildHoldInput): { plan: BuildHoldPlan | null; error: string | null } {
  try { return { plan: planBuildHold(input), error: null }; } catch (error) { return { plan: null, error: error instanceof Error ? error.message : String(error) }; }
}

/** A solvable starting plan that aims at the reference well's TD. */
function defaultPlan(design: WellDesign): BuildHoldInput {
  const stations = design.survey ?? [];
  const last = stations.at(-1);
  if (!last) return { kickoffMdM: 300, buildRateDegPer30m: 3, target: { tvdM: 1500, northingM: 300, eastingM: 300 }, extensionM: 0 };
  const computed = computeMinimumCurvature(inputsOf(stations), { tieIn: stations[0] });
  const kickoff = Math.round(summarizeTrajectory(computed).kickoffMdM ?? 300);
  const target = { tvdM: Math.round(last.tvdM), northingM: Math.round(last.northingM), eastingM: Math.round(last.eastingM) };
  for (const buildRateDegPer30m of [2, 3, 4, 6, 8]) {
    const input = { kickoffMdM: kickoff, buildRateDegPer30m, target, extensionM: 0 };
    if (tryPlan(input).plan) return input;
  }
  return { kickoffMdM: 300, buildRateDegPer30m: 3, target: { tvdM: 1500, northingM: 300, eastingM: 300 }, extensionM: 0 };
}

export function TrajectoryDemo() {
  const { store, well } = useWorkspace();
  if (!well.design.survey?.length) return <section className="demo-panel"><h1>Trajectory</h1><p>No survey is supplied for this well. Open Edit well and use the Trajectory planner to create one.</p><Link href={`/edit-well/?well=${encodeURIComponent(well.id)}`}>Edit well</Link></section>;
  return <TrajectoryWellDemo key={well.id} wellId={well.id} store={store} />;
}

function TrajectoryWellDemo({ wellId, store }: {
  wellId: string;
  store: ReturnType<typeof useWorkspace>["store"];
}) {
  const { design: reference, operations, logUrl } = useWell(wellId);
  const { applyRevision } = useWorkspace();
  const [mode, setMode] = useState<Mode>("survey");
  const [layers, setLayers] = useState(true);
  const [dlsLimit, setDlsLimit] = useState(3);
  const [sectionAzimuth, setSectionAzimuth] = useState<number | null>(null);
  const sharedDepth = useSubsurfaceSelector(store, (state) => state.depthLink.pinnedMdM);
  const sharedComponent = useSubsurfaceSelector(store, (state) => state.activeAsset.componentId);
  const [workingDepth, setWorkingDepth] = useState<number | null>(null);
  const [workingComponent, setWorkingComponent] = useState<string | null>(null);
  const selectedMdM = mode === "survey" ? sharedDepth : workingDepth;
  const selectedId = mode === "survey" ? sharedComponent : workingComponent;
  const setSelectedMdM = (depth: number | null) => {
    if (mode === "survey") store.pinDepth(reference.id, depth, "trajectory");
    else setWorkingDepth(depth);
  };
  const setSelectedId = (id: string) => {
    if (mode === "survey") store.selectComponent(id, "trajectory");
    else setWorkingComponent(id);
  };
  const [planInput, setPlanInput] = useState<BuildHoldInput>(() => defaultPlan(reference));
  const [committedPlan, setCommittedPlan] = useState<BuildHoldInput>(planInput);
  const livePlan = useRef(planInput);
  const [editStations, setEditStations] = useState<SurveyStationInput[]>([]);
  const [rejected, setRejected] = useState<string | null>(null);

  const referenceStations = useMemo(() => inputsOf(reference.survey ?? []), [reference]);
  const live = useMemo(() => tryPlan(planInput), [planInput]);
  const committed = useMemo(() => tryPlan(committedPlan), [committedPlan]);
  const plan = live.plan ?? committed.plan;

  const stations = mode === "survey" ? referenceStations : mode === "plan" ? (plan?.stations ?? referenceStations) : editStations;
  const sceneStations = mode === "survey" ? null : mode === "plan" ? (committed.plan?.stations ?? null) : editStations;
  const autoAzimuth = useMemo(() => summarizeTrajectory(computeMinimumCurvature(stations, { tieIn: reference.survey?.[0] })).closureAzimuthDeg, [stations, reference]);
  const vsAzimuth = sectionAzimuth ?? (mode === "plan" && plan ? plan.azimuthDeg : autoAzimuth);
  const survey = useMemo(() => computeMinimumCurvature(stations, { verticalSectionAzimuthDeg: vsAzimuth, tieIn: mode === "plan" ? undefined : reference.survey?.[0] }), [stations, vsAzimuth, mode, reference]);
  const summary = useMemo(() => summarizeTrajectory(survey, { verticalSectionAzimuthDeg: vsAzimuth }), [survey, vsAzimuth]);
  const issues = useMemo(() => validateSurveyStations(stations, { maxDlsDegPer30m: dlsLimit }), [stations, dlsLimit]);
  const sceneDesign = useMemo(() => sceneStations ? designWithTrajectory(reference, sceneStations, mode === "plan" ? { name: "Build & hold plan", note: "Planned by planBuildHold; positions by minimum curvature." } : { name: "Edited survey" }) : reference, [reference, sceneStations, mode]);
  const components = useMemo(() => getWellComponents(sceneDesign), [sceneDesign]);
  const selected = components.find((component) => component.id === selectedId) ?? components[0];
  const consistency = useMemo(() => reference.survey ? surveyConsistency(reference.survey) : null, [reference]);

  const markers = useMemo(() => {
    const list: TrajectoryMarker[] = [];
    if (mode === "plan" && plan) list.push({ mdM: (live.plan ? planInput : committedPlan).kickoffMdM, label: "KOP" }, { mdM: plan.endOfBuildMdM, label: "EOB" }, { mdM: plan.targetMdM, label: "Target" });
    else if (summary.kickoffMdM != null) list.push({ mdM: summary.kickoffMdM, label: "KOP" });
    return list.filter((marker) => marker.mdM >= 0 && marker.mdM <= summary.totalDepthMdM);
  }, [mode, plan, summary, live.plan, planInput, committedPlan]);

  const changeMode = (next: Mode) => {
    if (next === "plan" && mode !== "plan") {
      const initial = defaultPlan(reference);
      livePlan.current = initial;
      setPlanInput(initial);
      setCommittedPlan(initial);
    }
    if (next === "edit") setEditStations(inputsOf(survey));
    setRejected(null);
    setMode(next);
    setWorkingDepth(null);
    setWorkingComponent(null);
  };
  const updatePlan = (input: BuildHoldInput, commit: boolean) => {
    livePlan.current = input;
    setPlanInput(input);
    if (commit) setCommittedPlan(input);
  };
  const commitPlan = () => {
    const next = livePlan.current;
    if (tryPlan(next).plan) setCommittedPlan(next);
    else { livePlan.current = committedPlan; setPlanInput(committedPlan); }
  };
  const editSurvey = (next: readonly SurveyStationInput[]) => {
    const error = validateSurveyStations(next).find((issue) => issue.severity === "error");
    if (error) { setRejected(`Edit rejected — station ${error.index + 1}: ${error.message}`); return; }
    setRejected(null);
    setEditStations([...next]);
  };

  return <section className="demo-stage" aria-label="Trajectory engineering example">
    {mode !== "survey" && <div className="demo-workspace-availability"><p>Trajectory preview: apply it to use this user-authored revision throughout the workspace. The original observed source is preserved.</p>
      <CommandButton icon="apply" onClick={() => {
        try {
          applyRevision(reference.id, { design: editTrajectory(reference, stations), operations, logUrl: logUrl ?? null });
          setMode("survey"); setRejected(null);
        } catch (error) { setRejected(error instanceof Error ? error.message : String(error)); }
      }}>Apply to active well</CommandButton>
      {rejected && <p role="alert">{rejected}</p>}
    </div>}
    <div className="demo-toolbar">
      <div className="demo-segment" role="group" aria-label="Trajectory mode">{modes.map((item) => <CommandButton kind="selection" key={item.id} type="button" aria-pressed={mode === item.id} onClick={() => changeMode(item.id)}>{item.label}</CommandButton>)}</div>
      <span className="demo-mode-tip" data-testid="trajectory-mode-note"><InfoTip wide label="About this mode">{mode === "survey" ? (reference.provenance === "documented" ? "Published survey, read-only. Positions below are recomputed from MD, inclination and azimuth by minimum curvature and checked against the published values." : "Synthetic survey fixture. Positions are recomputed from MD, inclination and azimuth by minimum curvature.") : mode === "plan" ? "Drag the blue target in the plan or section view, or type values. The build-and-hold profile is solved exactly through the target; the 3D scene updates when you release." : "Every station is editable. Change MD, inclination or azimuth and every position, DLS and the 3D path are recomputed. Physically impossible edits are rejected."}</InfoTip></span>
      <label className="demo-inline-field"><span>DLS limit</span><input type="number" min="0.5" max="30" step="0.5" value={dlsLimit} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value > 0) setDlsLimit(value); }} /><small>°/30 m</small></label>
      <label className="demo-inline-field"><span>VS azimuth</span><input type="number" min="0" max="359.9" step="1" placeholder={`auto ${vsAzimuth.toFixed(1)}`} value={sectionAzimuth ?? ""} onChange={(event) => { const raw = event.target.value; const value = Number(raw); setSectionAzimuth(raw === "" || !Number.isFinite(value) ? null : ((value % 360) + 360) % 360); }} /><small>°</small></label>
      <label className="demo-check"><input type="checkbox" checked={layers} onChange={(event) => setLayers(event.target.checked)} /> Formations</label>
    </div>


    <div className="demo-traj-top">
      <div className="demo-panel demo-panel-flush demo-traj-scene">{selected && <WellScene design={sceneDesign} selectedId={selected.id} onSelect={setSelectedId} layersVisible={layers} colorBy="dls" dlsLimitDegPer30m={dlsLimit} target={mode === "plan" ? committedPlan.target : null} probeMdM={selectedMdM} onProbe={setSelectedMdM} />}</div>
      <div className="demo-traj-side">
        <TrajectorySummaryPanel summary={summary} dlsLimitDegPer30m={dlsLimit} footer={consistency && mode === "survey" && <p className="demo-verify" data-testid="trajectory-verification"><b>✓ Verified</b> Recomputed positions match the {reference.provenance === "documented" ? "published" : "fixture"} survey within {fmt(consistency.maxDeviationM * 1000, 1)} mm over {reference.survey!.length} stations.</p>} />
        {mode === "plan" && <BuildHoldForm value={planInput} onChange={(input) => updatePlan(input, true)} plan={live.plan} error={live.error} />}
        <CourseMath survey={survey} selectedMdM={selectedMdM} />
      </div>
    </div>

    <div className="demo-traj-views">
      <TrajectoryPlanView survey={survey} selectedMdM={selectedMdM} onSelectMd={setSelectedMdM} dlsLimitDegPer30m={dlsLimit} markers={markers} target={mode === "plan" ? planInput.target : null} targetInvalid={!!live.error} onTargetChange={mode === "plan" ? (target) => updatePlan({ ...livePlan.current, target }, false) : undefined} onTargetCommit={commitPlan} />
      <TrajectorySectionView survey={survey} selectedMdM={selectedMdM} onSelectMd={setSelectedMdM} dlsLimitDegPer30m={dlsLimit} markers={markers} verticalSectionAzimuthDeg={vsAzimuth} formations={layers ? reference.formations : undefined} target={mode === "plan" ? planInput.target : null} targetInvalid={!!live.error} onTargetChange={mode === "plan" ? (target) => updatePlan({ ...livePlan.current, target }, false) : undefined} onTargetCommit={commitPlan} />
    </div>

    <div className="demo-traj-data">
      <TrajectoryLog survey={survey} selectedMdM={selectedMdM} onSelectMd={setSelectedMdM} dlsLimitDegPer30m={dlsLimit} markers={markers} height={460} />
      <div className="demo-traj-table">
        <div className="demo-traj-table-head"><strong>Survey stations</strong><span>{survey.length} stations · {mode === "edit" ? "editable — positions are always computed" : "computed by minimum curvature"}</span>{mode !== "edit" && <CommandButton icon="edit" type="button" className="demo-small-button" onClick={() => changeMode("edit")}>Edit these stations</CommandButton>}</div>
        {rejected && <p className="demo-reject" role="alert">{rejected}</p>}
        <SurveyTable survey={survey} onChange={mode === "edit" ? editSurvey : undefined} issues={issues} selectedMdM={selectedMdM} onSelectMd={setSelectedMdM} dlsLimitDegPer30m={dlsLimit} maxHeight={420} />
      </div>
    </div>

    <div className="demo-traj-bottom">
      <Explainer />
      <RecordCard component={selected} design={sceneDesign} />
    </div>
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
    <h2 className="sw-title">How every number on this page is computed<InfoTip wide label="Scope and limits">Positions between stations (3D probe, markers) are interpolated along the same arc. Planned and edited trajectories are new user-authored revisions; the published survey is never modified. Planning aid only — not certified directional-drilling software.</InfoTip></h2>
    <p>Each survey station gives measured depth (MD, along-hole), inclination I (0° = vertical down) and azimuth A (clockwise from grid north). Between two stations the hole is assumed to follow a circular arc — the <b>minimum-curvature</b> method, the industry standard (SPE 84246).</p>
    <ol>
      <li><span>Dogleg — total angle change</span><code>β = arccos[cos(I₂−I₁) − sin I₁ · sin I₂ · (1 − cos(A₂−A₁))]</code></li>
      <li><span>Ratio factor — bends the straight average onto the arc</span><code>RF = (2/β) · tan(β/2)   (RF → 1 as β → 0)</code></li>
      <li><span>Position change over the course</span><code>ΔN = ΔMD/2 · (sin I₁ cos A₁ + sin I₂ cos A₂) · RF{"\n"}ΔE = ΔMD/2 · (sin I₁ sin A₁ + sin I₂ sin A₂) · RF{"\n"}ΔTVD = ΔMD/2 · (cos I₁ + cos I₂) · RF</code></li>
      <li><span>Dogleg severity, normalised to 30 m</span><code>DLS = β · 30 / ΔMD   [°/30 m]</code></li>
      <li><span>Vertical section and closure</span><code>VS = N · cos(VSaz) + E · sin(VSaz){"\n"}closure = √(N² + E²) @ atan2(E, N)</code></li>
      <li><span>Build & hold through a target</span><code>R = 30 · 180 / (π · BUR){"\n"}θ = atan2(D − R, Z) + asin(R / √((D − R)² + Z²)){"\n"}hold = √((D − R)² + Z² − R²)</code></li>
    </ol>
  </section>;
}
