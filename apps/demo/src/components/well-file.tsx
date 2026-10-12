"use client";

import { useId, useState } from "react";
import { metresToFeet, sectionAtDepth, type FormationLayer, type SurveyPoint, type WellComponent, type WellOperations } from "@ikhmalputra/subsurface-core";
import type { DepthLink } from "@ikhmalputra/subsurface-react";
import { DaysVsDepthChart, HoleSectionLog, LogTracks, ServiceRunLog, WellHistoryLog } from "@ikhmalputra/subsurface-react/records";
import { SegyHeaderPanel } from "@ikhmalputra/subsurface-react/seismic";
import { SurveyTable } from "@ikhmalputra/subsurface-react/trajectory";
import { WellSeismicSection, useSegy, useWellOnSection, type WellSeismicSource } from "./well-seismic";
import { InfoTip } from "@ikhmalputra/subsurface-react";
import { CommandButton } from "@ikhmalputra/subsurface-react/ui";
import { useLas } from "./use-las";
import { depthBridge } from "../lib/depth";
import { computedSurvey } from "../lib/well-data";

const tabs = [
  { id: "history", label: "Daily history" },
  { id: "runs", label: "Service & BHA runs" },
  { id: "log", label: "Mud log" },
  { id: "survey", label: "Directional survey" },
  { id: "seismic", label: "Seismic (SEG-Y)" },
] as const;
type Tab = (typeof tabs)[number]["id"];

const tracks = [
  { mnemonic: "ROP", label: "ROP", color: "#147a65" },
  { mnemonic: "WOB", label: "WOB", color: "#2c3f7a" },
  { mnemonic: "RPM", label: "RPM", color: "#7a4f1f" },
  { mnemonic: "TORQUE", label: "Torque", color: "#8a2a1c" },
  { mnemonic: "PP", label: "Pump pressure", color: "#4f2f7a" },
  { mnemonic: "FLOWIN", label: "Flow in", color: "#235f74" },
  { mnemonic: "TEMPOUT", label: "Temp out", color: "#b4410c" },
];

export interface WellFileProps {
  readonly operations: WellOperations | null;
  readonly components: readonly WellComponent[];
  readonly selected: WellComponent | undefined;
  readonly onSelectComponent: (id: string) => void;
  readonly logUrl?: string;
  readonly survey?: readonly SurveyPoint[];
  readonly formations?: readonly FormationLayer[];
  readonly seismic?: WellSeismicSource;
  /** Shared MD window and cursor with the construction views. */
  readonly link: DepthLink;
}

/** Operational well file: hole sections, daily history, runs and mud log, all linked to the construction selection by depth. */
export function WellFile({ operations, components, selected, onSelectComponent, logUrl, survey = [], formations = [], seismic, link }: WellFileProps) {
  const id = useId();
  const [tab, setTab] = useState<Tab>("history");
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const [focusRunId, setFocusRunId] = useState<string | null>(null);
  const bridge = depthBridge(link);
  const { cursorFt } = bridge;
  const log = useLas(tab === "log" ? logUrl : undefined);
  const segy = useSegy(tab === "seismic" ? seismic?.url : undefined);
  const wellPath = useWellOnSection(survey, seismic);
  const stations = computedSurvey(survey);

  if (!operations) return <section className="demo-file" aria-label="Well file" data-testid="well-file">
    <h2 className="demo-file-title">Well file</h2>
    <p className="demo-file-empty" data-testid="well-file-empty">No operational records are attached to this synthetic well, so no history, runs or logs are shown. Nothing is invented. Pass a <code>WellOperations</code> object (for example <code>forgeOperations</code>) and a LAS file to the same components to fill this panel.</p>
  </section>;

  const ops = operations;
  const range = bridge.rangeOf(selected);
  const selectAtDepth = (depthFt: number) => { const section = sectionAtDepth(ops, depthFt); if (section) onSelectComponent(section.holeComponentId); };
  // Metre-indexed views (the survey table, the seismic section) pin and select through the bridge
  // rather than converting at the call site.
  const selectAtMetres = (mdM: number) => { bridge.pinFt(metresToFeet(mdM)); selectAtDepth(metresToFeet(mdM)); };
  const markers = components.filter((component) => component.kind === "Casing" && component.rawBottomDepthFt).map((component) => ({ depthFt: component.rawBottomDepthFt as number, label: `${component.name.split(" / ").pop()?.trim()} shoe` }));
  const intervals = ops.runs.filter((run) => run.topFt !== null && run.baseFt !== null && run.baseFt > run.topFt).map((run) => ({ id: run.id, label: `${run.id} · ${run.kind}`, topFt: run.topFt as number, baseFt: run.baseFt as number, tone: run.outcome === "completed" ? "neutral" as const : run.outcome }));

  return <section className="demo-file" aria-label="Well file" data-testid="well-file">
    <div className="demo-file-bar">
      <h2 className="demo-file-title">Well file</h2>
      <p className="demo-file-note">{ops.days.length} daily reports · {ops.runs.length} service runs · {ops.milestones.length} milestones{selected ? <> · linked to <strong>{selected.name}</strong> ({Math.round(range?.topFt ?? 0).toLocaleString("en-US")}–{Math.round(range?.baseFt ?? 0).toLocaleString("en-US")} ft)</> : null}</p>
    </div>
    <HoleSectionLog operations={ops} selectedComponentId={selected?.id ?? null} onSelectSection={(section) => { onSelectComponent(section.holeComponentId); bridge.pinFt(null); }} title="Hole section log" />
    <div className="demo-file-tabs" role="tablist" aria-label="Well file records">
      {tabs.map((item) => <CommandButton kind="selection" key={item.id} type="button" role="tab" id={`${id}-${item.id}-tab`} aria-controls={`${id}-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={(event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        const next = tabs[(tabs.findIndex((value) => value.id === tab) + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!;
        setTab(next.id);
        document.getElementById(`${id}-${next.id}-tab`)?.focus();
      }}>{item.label}</CommandButton>)}
    </div>
    <div role="tabpanel" id={`${id}-${tab}`} aria-labelledby={`${id}-${tab}-tab`} className={`demo-file-panel is-${tab}`}>
      {tab === "history" && <>
        <DaysVsDepthChart operations={ops} focusDate={focusDate} cursorMdM={link.cursorMdM}
          onSelectDay={(day) => { setFocusDate(day.date); if (day.mdFt !== null) { bridge.pinFt(day.mdFt); selectAtDepth(day.mdFt); } }}
          /* A pointer pick carries a depth as well as a day, and it is applied after the day, so
             picking in the plot pins where the pointer is while the milestone buttons — which have
             no pointer position — pin the day's own reported depth. */
          onSelectMd={link.pinCursor} />
        <WellHistoryLog operations={ops} selectedRange={range} focusDate={focusDate} onSelectDay={(day) => { setFocusDate(day.date); if (day.mdFt !== null) { bridge.pinFt(day.mdFt); selectAtDepth(day.mdFt); } }} />
      </>}
      {tab === "runs" && <ServiceRunLog operations={ops} selectedRange={range} focusRunId={focusRunId} onSelectRun={(run) => {
        setFocusRunId(run.id);
        const depthFt = run.baseFt ?? run.topFt;
        if (depthFt !== null) bridge.pinFt(depthFt);
        const section = ops.sections.find((item) => item.id === run.holeSection);
        if (section) onSelectComponent(section.holeComponentId);
      }} />}
      {tab === "log" && (log.loaded ? <LogTracks las={log.loaded.las} tracks={tracks} markers={markers} intervals={intervals} selectedRange={range} cursorFt={cursorFt} title="Mud log · 10 ft means"
        depthWindowFt={link.linked ? bridge.windowFt : undefined}
        onDepthWindowChange={link.linked ? bridge.setWindowFt : undefined}
        onCursorChange={link.linked ? bridge.setCursorFt : undefined} onSelectDepth={(depthFt) => {
        bridge.pinFt(depthFt);
        selectAtDepth(depthFt);
        setFocusRunId(intervals.find((item) => depthFt >= item.topFt && depthFt <= item.baseFt)?.id ?? null);
      }} /> : <p className="demo-file-empty" role="status">{log.error ? `Mud log could not be loaded (${log.error}).` : "Loading mud log…"}</p>)}
      {tab === "survey" && (stations.length ? <>
        <SurveyTable survey={stations} selectedMdM={link.pinnedMdM} onSelectMd={(md) => selectAtMetres(md)} maxHeight={420} />
        <p className="demo-tipline">{stations.length} stations · minimum curvature <InfoTip wide label="About the survey">{stations.length} stations, recomputed by minimum curvature from MD, inclination and azimuth (tied in at the first station). Read-only here; pass <code>onChange</code> to make the same table editable. Selecting a row pins the depth in every linked view.</InfoTip></p>
      </> : <p className="demo-file-empty">No directional survey is attached to this well.</p>)}
      {tab === "seismic" && (!seismic ? <p className="demo-file-empty">No seismic is attached to this well.</p> : segy?.file ? (() => {
        const file = segy.file;
        const meta = seismic.meta;
        const focusMd = link.pinnedMdM ?? selected?.bottomDepthM ?? 0;
        const focusAlong = wellPath.reduce((best, point) => (Math.abs(point.mdM - focusMd) < Math.abs(best.mdM - focusMd) ? point : best), wellPath[0] ?? { mdM: 0, alongM: 0, offsetM: 0, depthM: 0 }).alongM;
        const traceIndex = file.traces.reduce((best, trace) => (Math.abs(trace.shotpoint - focusAlong) < Math.abs((file.traces[best]?.shotpoint ?? 0) - focusAlong) ? trace.index : best), 0);
        const maxOff = Math.max(0, ...wellPath.map((point) => Math.abs(point.offsetM)));
        return <>
          <WellSeismicSection file={file} meta={meta} wellPath={wellPath} components={components} formations={formations} survey={survey} selected={selected} cursorMdM={link.cursorMdM}
            onSelectMd={(md) => selectAtMetres(md)} onCursorMdChange={link.linked ? link.setCursorMdM : undefined}
            mdWindow={link.linked ? link.window : undefined} onMdWindowChange={link.linked ? link.setWindow : undefined} />
          <SegyHeaderPanel file={file} traceIndex={traceIndex} title={`SEG-Y headers · trace nearest ${Math.round(focusMd).toLocaleString("en-US")} m MD`} />
          <p className="demo-tipline">Datum {meta.seismicDatumElevationM} m ASL · well projected ≤ {Math.round(maxOff)} m <InfoTip wide label="About the seismic tie">Depth is metres below the {meta.seismicDatumElevationM} m ASL seismic datum; well TVD converts as TVD + {(meta.seismicDatumElevationM - meta.rkbElevationM).toFixed(2)} m (RKB {meta.rkbElevationM.toFixed(2)} m ASL). The well is projected onto a straight line through the wellhead and toe; stations sit at most {Math.round(maxOff)} m off it. Traces are unmodified nearest {meta.volume.binM} m bins of the source volume (grid fit residual {meta.volume.gridFitResidualM} m). PSDM depths are not tied to well check-shots. Source: <a className="demo-link" href="https://gdr.openei.org/submissions/1141" target="_blank" rel="noreferrer">{meta.source.title} ↗</a>, member <code>{meta.source.member.split("/").pop()}</code>, SHA-256 <code>{meta.source.sha256.slice(0, 12)}…</code>. {meta.attribution} {meta.license}.</InfoTip></p>
        </>;
      })() : <p className="demo-file-empty" role="status">{segy?.error ? `SEG-Y could not be loaded (${segy.error}).` : "Loading SEG-Y…"}</p>)}
    </div>
    <p className="demo-footnote">Sources: {Object.values(ops.sources).map((source, index) => <span key={source.url}>{index ? " · " : ""}<a className="demo-link" href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a></span>)}. {ops.attribution} {ops.license}. Daily text is the operator&apos;s wording extracted from the PDF; run figures are text-stated values with page citations; the mud log is 10 ft means of the 1 ft LAS.</p>
  </section>;
}
