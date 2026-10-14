"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { computeMinimumCurvature, designReadiness, designToAssembly, emptyWellBrief, exampleBuildHold, exampleWellBrief, forgeOffsetWell, planBuildHold, proposeCasingScheme, regradeFailingStrings, summarizeTrajectory, tvdAtMd, validateDesign } from "@ikhmalputra/subsurface-core";
import type { BuildHoldInput, DesignStage, FormationLayer, OffsetWell, WellAssembly, WellDesignBrief } from "@ikhmalputra/subsurface-core";
import { ArrowLeft, ArrowRight, Download, FilePlus2, Hammer, Sparkles } from "lucide-react";
import { BuildHoldForm, TrajectorySectionView } from "./trajectory.js";
import { CasingLoadCard, CasingSchemeTable, CementPlanTable, CompletionForm, DatumDiagram, DesignCoveragePanel, DesignReadinessPanel, GeologyPressureEditor, PressureWindowPlot, WellIdentityForm, WellLocationForm, WellProgrammeSummary, lithologyColour } from "./well-design.js";
import { WellAssemblyBuilder } from "./well-assembly-builder.js";
import { OffsetWellLibrary } from "./offset-wells.js";
import { InfoTip } from "./info-tip.js";
import { AssemblySchematic } from "./assembly-schematic.js";
import { CommandButton } from "./ui.js";

type Step = DesignStage | "offsets" | "review" | "assemble";
type Phase = "define" | "plan" | "design" | "review" | "assemble";
const defaultOffsets: readonly OffsetWell[] = [forgeOffsetWell];
function formationLayers(brief: WellDesignBrief): FormationLayer[] {
  const sorted = [...brief.geology.formations].sort((a, b) => a.topTvdM - b.topTvdM);
  const bottom = tvdAtMd(brief, brief.totalDepthMdM) + 200;
  return sorted.map((formation, at) => ({ id: `${formation.name}-${at}`, name: formation.name, lithology: formation.lithology, topTvdM: formation.topTvdM, bottomTvdM: sorted[at + 1]?.topTvdM ?? bottom, densityKgM3: null, porosityPct: null, color: lithologyColour(formation.lithology) }));
}

const steps: readonly { readonly id: Step; readonly label: string; readonly stages: readonly DesignStage[] }[] = [
  { id: "identity", label: "Identity", stages: ["identity"] },
  { id: "location", label: "Location & datum", stages: ["location", "datum"] },
  { id: "offsets", label: "Offset wells", stages: [] },
  { id: "geology", label: "Geology & pressure", stages: ["geology"] },
  { id: "trajectory", label: "Trajectory", stages: ["trajectory"] },
  { id: "casing", label: "Casing", stages: ["casing"] },
  { id: "cement", label: "Cement", stages: ["cement"] },
  { id: "completion", label: "Completion", stages: ["completion"] },
  { id: "review", label: "Review", stages: [] },
  { id: "assemble", label: "Assemble", stages: [] },
];
const phases: readonly { readonly id: Phase; readonly label: string; readonly steps: readonly Step[] }[] = [
  { id: "assemble", label: "Schematic", steps: ["assemble"] },
  { id: "define", label: "Define", steps: ["identity", "location", "offsets"] },
  { id: "plan", label: "Plan", steps: ["geology", "trajectory"] },
  { id: "design", label: "Design", steps: ["casing", "cement", "completion"] },
  { id: "review", label: "Review", steps: ["review"] },
];

export interface WellDesignWorkflowProps {
  /** URL where the package's `assets/well-components` folder is served. */
  readonly assetBaseUrl: string;
  readonly initialBrief?: WellDesignBrief;
  /** Build-and-hold plan behind `initialBrief.trajectory`; null keeps the well vertical. */
  readonly initialBuildHold?: BuildHoldInput | null;
  readonly onBriefChange?: (brief: WellDesignBrief) => void;
  readonly onAssemblyChange?: (assembly: WellAssembly) => void;
  /** Wells offered for comparison and reuse. Default: the documented Utah FORGE 16A(78)-32. */
  readonly offsets?: readonly OffsetWell[];
  /** Receives saved, imported, and removed user offsets. The host owns persistence and validation. */
  readonly onOffsetsChange?: (offsets: readonly OffsetWell[]) => void;
  /** Where to render the design tools (phases, steps, forms, the builder's parts and properties) instead of beside the canvas: a host's own dock. */
  readonly toolsContainer?: HTMLElement | null;
  /** Go to a step when this changes (by nonce): a host's tool that names a step of the brief. */
  readonly requestedStep?: { readonly step: string; readonly nonce: number };
}

/**
 * Reference composition of a schematic-first well-design flow. The live assembly is the starting
 * workspace; the design brief, checks and review remain available as separate workflow phases.
 */
export function WellDesignWorkflow({ assetBaseUrl, initialBrief, initialBuildHold, onBriefChange, onAssemblyChange, offsets = defaultOffsets, onOffsetsChange, toolsContainer, requestedStep }: WellDesignWorkflowProps) {
  const [offsetId, setOffsetId] = useState<string | null>(null);
  const library = offsets;
  const [brief, setBriefState] = useState<WellDesignBrief>(() => initialBrief ?? exampleWellBrief());
  const [buildHold, setBuildHold] = useState<BuildHoldInput | null>(() => (initialBuildHold === undefined ? (initialBrief ? null : exampleBuildHold) : initialBuildHold));
  const [step, setStep] = useState<Step>("assemble");
  const [isExample, setIsExample] = useState(!initialBrief);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trajectoryError, setTrajectoryError] = useState<string | null>(null);
  const [assemblyKey, setAssemblyKey] = useState(0);
  const [assemblyBrief, setAssemblyBrief] = useState(brief);
  const [assemblyEdited, setAssemblyEdited] = useState(false);
  const [constructionTools, setConstructionTools] = useState<HTMLDivElement | null>(null);
  const toolContent = useRef<HTMLDivElement>(null);
  useEffect(() => { if (toolContent.current) toolContent.current.scrollTop = 0; }, [step]);
  useEffect(() => { if (requestedStep && steps.some((value) => value.id === requestedStep.step)) setStep(requestedStep.step as Step); }, [requestedStep]);
  const readiness = useMemo(() => designReadiness(brief), [brief]);
  const errorCount = useMemo(() => validateDesign(brief).filter((issue) => issue.severity === "error").length, [brief]);
  const setBrief = (next: WellDesignBrief) => { setBriefState(next); setIsExample(false); onBriefChange?.(next); };

  const applyBuildHold = (input: BuildHoldInput | null, base = brief) => {
    setBuildHold(input);
    if (!input) { setTrajectoryError(null); setBrief({ ...base, trajectory: null }); return; }
    try {
      const plan = planBuildHold(input);
      setTrajectoryError(null);
      setBrief({ ...base, trajectory: plan.stations, totalDepthMdM: Math.round(plan.totalDepthMdM) });
    } catch (error) { setTrajectoryError(error instanceof Error ? error.message : String(error)); }
  };
  const propose = () => { const sections = proposeCasingScheme(brief); setBrief({ ...brief, sections }); setSelectedId(sections.at(-1)?.id ?? null); };
  const stepStatus = (value: (typeof steps)[number]) => {
    if (value.id === "offsets") return brief.origin ? "complete" : null;
    if (!value.stages.length) return value.id === "review" ? (readiness.ready && !errorCount ? "complete" : "attention") : null;
    const items = readiness.requirements.filter((item) => value.stages.includes(item.stage));
    return items.some((item) => item.status === "missing") ? "missing" : items.some((item) => item.status === "attention") ? "attention" : "complete";
  };
  const index = steps.findIndex((value) => value.id === step);
  const activePhase = phases.find((phase) => phase.steps.includes(step)) ?? phases[0]!;
  const phaseIndex = phases.findIndex((phase) => phase.id === activePhase.id);
  const go = (next: Step) => setStep(next);
  const startBlank = () => { const next = emptyWellBrief(); setBrief(next); setAssemblyBrief(next); setAssemblyEdited(false); setBuildHold(null); setSelectedId(null); setAssemblyKey((value) => value + 1); setStep("identity"); };
  const startExample = () => { const next = exampleWellBrief(); setBrief(next); setAssemblyBrief(next); setAssemblyEdited(false); setIsExample(true); setBuildHold(exampleBuildHold); setSelectedId(null); setAssemblyKey((value) => value + 1); setStep("assemble"); };
  const rebuildAssembly = () => {
    if (assemblyEdited && !window.confirm("Rebuild the schematic from the design brief? This replaces your component edits and clears undo history.")) return;
    setAssemblyBrief(brief);
    setAssemblyEdited(false);
    setAssemblyKey((value) => value + 1);
    setStep("assemble");
  };
  const assembled = useMemo(() => {
    try { return { assembly: designToAssembly(assemblyBrief), error: null }; } catch (error) { return { assembly: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [assemblyBrief]);

  const survey = useMemo(() => (brief.trajectory && brief.trajectory.length >= 2 ? computeMinimumCurvature(brief.trajectory) : null), [brief.trajectory]);
  const assemblySurvey = useMemo(() => (assemblyBrief.trajectory && assemblyBrief.trajectory.length >= 2 ? computeMinimumCurvature(assemblyBrief.trajectory) : undefined), [assemblyBrief.trajectory]);
  const summary = useMemo(() => (survey ? summarizeTrajectory(survey) : null), [survey]);
  const layers = useMemo(() => formationLayers(brief), [brief]);
  const assemblyLayers = useMemo(() => formationLayers(assemblyBrief), [assemblyBrief]);

  function exportBrief() {
    const blob = new Blob([JSON.stringify(brief, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${(brief.identity.name || "well").replace(/[^\w-]+/g, "-").toLowerCase()}-design.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const gotoStage = (stage: DesignStage) => go(steps.find((value) => value.stages.includes(stage))!.id);
  const shownOffset = library.find((well) => well.id === (step === "offsets" ? offsetId ?? library[0]?.id : brief.origin?.offsetId)) ?? null;
  const pressurePlot = (overlay: "pressures" | "programme" | "cement", height = 600) => <PressureWindowPlot brief={brief} selectedSectionId={selectedId} onSelectSection={setSelectedId} overlay={overlay} height={height} offset={shownOffset && overlay !== "cement" ? { name: shownOffset.name, brief: shownOffset.brief } : null} />;
  const loadCardId = step === "casing" ? (brief.sections.some((section) => section.id === selectedId) ? selectedId : brief.sections.at(-1)?.id ?? null) : null;
  const preview = useMemo(() => {
    if (step !== "completion") return null;
    try { return designToAssembly(brief); } catch { return null; }
  }, [step, brief]);
  let main: ReactNode;
  let aside: ReactNode = null;
  switch (step) {
    case "identity":
      main = <WellIdentityForm brief={brief} onChange={setBrief} />;
      aside = null;
      break;
    case "location": main = <WellLocationForm brief={brief} onChange={setBrief} showDiagram={false} />; aside = <section className="sw-wd-panel" aria-label="Depth reference"><header><div><small>To scale</small><h2>Depth reference</h2></div></header><DatumDiagram brief={brief} /></section>; break;
    case "offsets": main = <OffsetWellLibrary brief={brief} onChange={(next) => { setBrief(next); setBuildHold(null); setSelectedId(next.sections[0]?.id ?? null); }} offsets={library} onOffsetsChange={onOffsetsChange} selectedOffsetId={offsetId} onSelectOffset={setOffsetId} />; aside = pressurePlot("programme"); break;
    case "geology": main = <GeologyPressureEditor brief={brief} onChange={setBrief} />; aside = pressurePlot("pressures"); break;
    case "trajectory":
      main = <section className="sw-wd-panel" aria-label="Trajectory" data-testid="wd-trajectory">
        <header><div><small>Step 5 · how the well reaches the target</small><div className="sw-title"><h2>Trajectory</h2><InfoTip label="About the trajectory">Every pressure load downstream uses TVD from this plan (minimum curvature). Changing it moves TD; re-propose the casing scheme afterwards.</InfoTip></div></div><div className="sw-wd-actions" role="group" aria-label="Profile">
          <CommandButton kind="selection" type="button" className="sw-asm-button" aria-pressed={!buildHold} onClick={() => applyBuildHold(null)}>Vertical</CommandButton>
          <CommandButton kind="selection" type="button" className="sw-asm-button" aria-pressed={Boolean(buildHold)} onClick={() => applyBuildHold(buildHold ?? { kickoffMdM: 500, buildRateDegPer30m: 2, target: { tvdM: Math.max(800, tvdAtMd(brief, brief.totalDepthMdM) - 200), northingM: 300, eastingM: 300 }, extensionM: 150 })}>Build &amp; hold</CommandButton>
        </div></header>
        {buildHold ? <BuildHoldForm value={buildHold} onChange={(value) => applyBuildHold(value)} plan={(() => { try { return planBuildHold(buildHold); } catch { return null; } })()} error={trajectoryError} />
          : <label className="sw-wd-field"><span>Total depth<small>m MD = TVD</small></span><input type="number" aria-label="Total depth (m)" defaultValue={brief.totalDepthMdM} key={brief.totalDepthMdM} min={100} step={10} onBlur={(event) => { const value = Number(event.target.value); if (value >= 100 && value !== brief.totalDepthMdM) setBrief({ ...brief, totalDepthMdM: value }); }} /></label>}
        {summary && <dl className="sw-wd-facts is-wide">
          <div><dt>TD</dt><dd>{Math.round(summary.totalDepthMdM)} m MD · {Math.round(summary.totalDepthTvdM)} m TVD</dd></div>
          <div><dt>Departure</dt><dd>{Math.round(summary.closureDistanceM)} m @ {summary.closureAzimuthDeg.toFixed(1)}°</dd></div>
          <div><dt>Max inclination</dt><dd>{summary.maxInclinationDeg.toFixed(1)}°</dd></div>
          <div><dt>Max dogleg</dt><dd>{summary.maxDlsDegPer30m.toFixed(2)}°/30 m</dd></div>
        </dl>}
      </section>;
      aside = pressurePlot("pressures");
      if (survey && summary) aside = <TrajectorySectionView survey={survey} verticalSectionAzimuthDeg={summary.closureAzimuthDeg} formations={layers} target={buildHold?.target} onTargetChange={(target) => buildHold && applyBuildHold({ ...buildHold, target })} height={600} />;
      break;
    case "casing":
      main = <CasingSchemeTable brief={brief} onChange={setBrief} selectedId={selectedId} onSelect={setSelectedId} onPropose={propose} showLoadCard={false} onRegrade={() => setBrief(regradeFailingStrings(brief).brief)} />;
      aside = <div className="sw-wd-stack"><CasingLoadCard brief={brief} sectionId={loadCardId} />{pressurePlot("programme", 520)}</div>;
      break;
    case "cement": main = <CementPlanTable brief={brief} onChange={setBrief} selectedId={selectedId} onSelect={setSelectedId} />; aside = pressurePlot("cement"); break;
    case "completion":
      main = <CompletionForm brief={brief} onChange={setBrief} />;
      aside = preview ? <AssemblySchematic assembly={preview} assetBaseUrl={assetBaseUrl} title="Preview · what Assemble will build" /> : <p className="sw-wd-empty-note">Complete the casing scheme to preview the assembled well.</p>;
      break;
    case "review": main = <WellProgrammeSummary brief={brief} selectedId={selectedId} onSelect={setSelectedId} />; aside = <div className="sw-wd-stack"><DesignReadinessPanel brief={brief} onGoTo={gotoStage} showChecks={false} /><DesignCoveragePanel brief={brief} /></div>; break;
    case "assemble": main = null; aside = null; break;
  }

  const tools = (
      <aside className="sw-wd-tools" aria-label="Well design tools">
        <div className="sw-wd-tool-navigation">
        <nav className="sw-wd-steps" aria-label="Design phases"><ol>{phases.map((phase, at) => {
          const phaseSteps = steps.filter((value) => phase.steps.includes(value.id));
          const statuses = phaseSteps.map(stepStatus);
          const status = statuses.includes("missing") ? "missing" : statuses.includes("attention") ? "attention" : statuses.some((value) => value === "complete") && statuses.every((value) => value === "complete" || value === null) ? "complete" : undefined;
          return <li key={phase.id}><CommandButton kind="selection" type="button" aria-current={phase.id === activePhase.id ? "step" : undefined} data-status={status} onClick={() => go(phase.steps[0]!)} aria-label={`${at + 1}. ${phase.label}`}>
            <i>{at + 1}</i><span>{phase.label}</span>
          </CommandButton></li>;
        })}</ol></nav>
        {activePhase.steps.length > 1 && <nav className="sw-wd-substeps" aria-label={`${activePhase.label} steps`}>
          {activePhase.steps.map((id) => {
            const value = steps.find((candidate) => candidate.id === id)!;
            const status = stepStatus(value);
            return <CommandButton kind="selection" key={id} type="button" aria-current={id === step ? "step" : undefined} data-status={status ?? undefined} onClick={() => go(id)}>{value.label}</CommandButton>;
          })}
        </nav>}
        <p className="sw-wd-step-context" aria-live="polite">Phase {phaseIndex + 1} of {phases.length} <span>·</span> {activePhase.label}</p>
        </div>
        <div className="sw-wd-tool-content" ref={toolContent} role="region" aria-label="Active design tools" tabIndex={0}>
          <div ref={setConstructionTools} hidden={step !== "assemble"} />
          {step === "assemble" ? <section className="sw-wd-tool-intro">
            <h2>Schematic tools</h2>
            <p>Add components from the library, select parts in the drawing, and edit their properties. Your changes stay here while you review design inputs.</p>
          </section> : <>
            <div className="sw-wd-main">{main}
              <div className="sw-wd-nav">
                <CommandButton type="button" className="sw-asm-button" disabled={index === 0} onClick={() => go(steps[index - 1]!.id)}><ArrowLeft size={15} /> {steps[index - 1]?.label ?? "Back"}</CommandButton>
                <CommandButton type="button" className="sw-asm-button is-primary" onClick={() => go(steps[index + 1]!.id)}>{steps[index + 1]!.label} <ArrowRight size={15} /></CommandButton>
              </div>
            </div>
            {aside && <div className="sw-wd-aside">{aside}</div>}
          </>}
        </div>
      </aside>
  );
  return <div className={`sw-wd${toolsContainer ? " sw-wd-host-dock" : ""}`} data-testid="well-design-workflow">
    <header className="sw-wd-bar">
      <div className="sw-wd-title"><small>{isExample ? "EXAMPLE WELL · SCHEMATIC" : "WELL SCHEMATIC"}</small><div className="sw-title"><strong>{brief.identity.name || "Untitled well"}</strong><InfoTip label="About the well schematic">Select a component or use Edit properties to change its label, depths and sizes. Edits and undo history stay intact when switching tools. Design inputs are separate: rebuilding from the brief replaces component edits.</InfoTip></div></div>
      <span className="sw-wd-status" data-testid="design-readiness">{readiness.percentComplete}% data · {errorCount ? `${errorCount} errors` : "no errors"}</span>
      <span className="sw-wd-draft-note">Independent draft · export before leaving to keep it</span>
      <div className="sw-wd-bar-actions">
        <CommandButton type="button" className="sw-asm-button" onClick={startBlank}><FilePlus2 size={15} /> New design</CommandButton>
        <CommandButton type="button" className="sw-asm-button" onClick={startExample}><Sparkles size={15} /> Example well</CommandButton>
        <CommandButton type="button" className="sw-asm-button" onClick={exportBrief}><Download size={15} /> Export brief</CommandButton>
        <CommandButton type="button" className="sw-asm-button is-primary" onClick={() => step === "assemble" ? rebuildAssembly() : go("assemble")}><Hammer size={15} /> {step === "assemble" ? "Rebuild schematic" : "View schematic"}</CommandButton>
      </div>
    </header>
    <div className="sw-wd-workspace">
      <section className="sw-wd-canvas" aria-label="Well construction canvas">
        <div className="sw-wd-assemble">
          {assemblyBrief !== brief && <p className="sw-wd-note" role="status">Design inputs have changed. Your schematic edits are preserved. <CommandButton icon="reset" type="button" className="sw-asm-button" onClick={rebuildAssembly}>Rebuild from design</CommandButton></p>}
          {assembled.assembly ? <WellAssemblyBuilder key={assemblyKey} workbench survey={assemblySurvey} formations={assemblyLayers} toolsContainer={constructionTools} onToolsRequested={() => setStep("assemble")} assetBaseUrl={assetBaseUrl} initialAssembly={assembled.assembly} onChange={(assembly) => { setAssemblyEdited(true); onAssemblyChange?.(assembly); }} />
            : <p className="sw-wd-error" role="alert">This design cannot be assembled yet: {assembled.error}</p>}
        </div>
      </section>
      {toolsContainer ? createPortal(tools, toolsContainer) : tools}
    </div>
  </div>;
}
