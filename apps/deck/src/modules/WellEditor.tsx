import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ClipboardPaste, Download, FilePen, FileUp, Plus, Redo2, RotateCcw, Trash2, Undo2, X } from "lucide-react";
import type { DepthReference, WellComponent, WellEnvironment, ComponentKind } from "@ikhmalputra/subsurface-core";
import { AssemblySchematic, formatInches } from "@ikhmalputra/subsurface-react/2d";
import { DEPTH_UNITS, readStations } from "../data/entry.ts";
import type { DepthUnit, EnteredStation } from "../data/entry.ts";
import { importLas, removeLog, useImportedLogs } from "../data/logs.ts";
import { basePlace, baseOf, tvdOn } from "../data/place.ts";
import { commitRecord, deleteRecordedWell, editOf, recordedForSite, same, surveyOf, useRecordState } from "../data/records.ts";
import type { EnteredTop, RecordEntry, WellRecordValue } from "../data/records.ts";
import { actions, useDeck } from "../deck/store.ts";
import { fmt } from "../format.ts";
import { BASE } from "../base.ts";
import { CellNumber, NumberField, Segmented, SelectField, TextField } from "./fields.tsx";
import { Frame, Inspector, Status } from "./frame/Frame.tsx";
import { Empty } from "./Empty.tsx";
import { useWire } from "./wire.ts";

const ASSETS = `${BASE}well-components`;

/**
 * The Well editor: a drilled well's records. For a well entered on the deck it is where everything is
 * entered — the well, its survey (typed, pasted from a spreadsheet or imported from a file), formation
 * tops, casing, hole and cement, and LAS logs. For a well already in the deck (FORGE 16A, an Equator
 * well) it edits over the record without changing it: each row says whether it is the record's or
 * yours, any edit can be reverted, and the whole deck draws the edited well. Every change is one
 * named, undoable step.
 */

type Stage = "well" | "survey" | "tops" | "construction" | "logs";
const STAGES: readonly { readonly id: Stage; readonly label: string; readonly purpose: string }[] = [
  { id: "well", label: "Well", purpose: "Name, place and the depth reference every MD and TVD hangs from." },
  { id: "survey", label: "Survey", purpose: "Measured depth, inclination and azimuth at each station; positions and TVD follow by minimum curvature." },
  { id: "tops", label: "Formation tops", purpose: "Where each formation starts, by measured depth; TVD follows from the survey." },
  { id: "construction", label: "Casing & hole", purpose: "Strings, hole sections and cement as run: sizes, depths, grade and weight, and where each record came from." },
  { id: "logs", label: "Logs", purpose: "LAS files for this well: imported, kept in this browser and drawn in the Logs module." },
];

export function WellEditor() {
  const siteId = useDeck((deck) => deck.siteId), wellId = useDeck((deck) => deck.wellId);
  const entry = useMemo((): RecordEntry | null => {
    const recorded = recordedForSite(siteId);
    if (recorded) return recorded;
    const base = basePlace(siteId, wellId);
    return base ? editOf(base.wellId, base.siteId, baseOf(base)) : null;
  }, [siteId, wellId]);
  const state = useRecordState(entry);
  const wire = useWire("editor");
  const place = wire.place;
  const [confirm, setConfirm] = useState<"delete" | "revert" | null>(null);
  // The station table is a page of its own; the open construction row is the one picked here or in the drawing.
  const [table, setTable] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  // Next, or a click on the drawing, opens a stage's section without resetting the inspector.
  const [reveal, setReveal] = useState<{ readonly section: string; readonly at: number } | null>(null);
  const openStage = (stage: Stage) => setReveal({ section: stage, at: Date.now() });
  // ⌘Z / ⇧⌘Z step this well's history while the editor is open (the designer's bar has its own).
  useEffect(() => {
    if (!entry) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest("input, textarea, select")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) entry.history.redo(); else entry.history.undo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entry]);
  if (!entry || !state) return null;
  const value = state.committed;
  const base = entry.base;
  const edit = (label: string, change: (value: WellRecordValue) => WellRecordValue) => commitRecord(entry, label, change);
  const editCount = base ? countEdits(value, base) : 0;
  const lastUndo = state.undo.at(-1), lastRedo = state.redo.at(-1);
  const download = () => {
    const blob = new Blob([JSON.stringify({ format: "subsurface-deck-well", version: 1, exportedAt: new Date().toISOString(), value }, null, 1)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${(value.identity.name || "well").replace(/[^\w.-]+/g, "_")}.well.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  // Picking a string or hole in the drawing opens its row.
  const select = (id: string | null) => { wire.select(id); if (id && value.components.some((component) => component.id === id)) { setOpenRow(id); openStage("construction"); } };
  const openTable = (row: number | null) => { setEditing(row); setTable(true); };

  const md = wire.cursor;
  const tvd = md !== null && place ? tvdOn(place, md) : null;
  const topHere = md !== null ? [...value.tops].filter((top) => top.topMdM <= md).sort((a, b) => b.topMdM - a.topMdM)[0] : undefined;
  const stringHere = md !== null ? value.components.filter((component) => component.kind === "Casing" && component.topDepthM <= md && component.bottomDepthM >= md).sort((a, b) => (a.outerDiameterMm ?? 0) - (b.outerDiameterMm ?? 0))[0] : undefined;
  const holeHere = md !== null ? value.components.filter((component) => component.kind === "Hole" && component.topDepthM <= md && component.bottomDepthM >= md).sort((a, b) => (a.outerDiameterMm ?? 0) - (b.outerDiameterMm ?? 0))[0] : undefined;
  const forms: Readonly<Record<Stage, ReactNode>> = {
    well: <WellStage value={value} base={base} edit={edit} />,
    survey: <SurveyStage value={value} base={base} edit={edit} onTable={openTable} />,
    tops: <TopsStage value={value} base={base} edit={edit} />,
    construction: <ConstructionStage value={value} base={base} edit={edit} open={openRow} setOpen={setOpenRow} />,
    logs: <LogsStage wellId={entry.wellId} name={value.identity.name} />,
  };

  return <Frame name="editor" className="wed" title={value.identity.name || "Unnamed well"}
    subtitle={entry.kind === "recorded" ? "Drilled well · entered on the deck" : editCount ? `Documented record · ${editCount} edit${editCount === 1 ? "" : "s"} over it, kept in this browser` : "Documented record · as recorded"}
    tools={<>
      <button type="button" className="dsg-tool" disabled={!lastUndo} title={lastUndo ? `Undo: ${lastUndo.label} (⌘Z)` : "Nothing to undo"} aria-label="Undo" onClick={() => entry.history.undo()}><Undo2 size={14} /></button>
      <button type="button" className="dsg-tool" disabled={!lastRedo} title={lastRedo ? `Redo: ${lastRedo.label} (⇧⌘Z)` : "Nothing to redo"} aria-label="Redo" onClick={() => entry.history.redo()}><Redo2 size={14} /></button>
      {entry.kind === "recorded" && <button type="button" className="dsg-tool" onClick={download} title="Download this well as a .json file (import it with + New well)"><Download size={14} />Export</button>}
      {confirm === "revert" ? <span className="dsg-confirm">Undo all {editCount} edits?<button type="button" className="is-danger" onClick={() => { edit("Revert every edit to the record", () => base!); setConfirm(null); }}>Revert all</button><button type="button" onClick={() => setConfirm(null)}>Keep</button></span>
        : base && editCount > 0 && <button type="button" className="dsg-tool" onClick={() => setConfirm("revert")}><RotateCcw size={14} />Back to the record</button>}
      {entry.kind === "recorded" && (confirm === "delete"
        ? <span className="dsg-confirm">Delete it?<button type="button" className="is-danger" onClick={() => { deleteRecordedWell(entry.id); actions.selectSite(null); }}>Delete</button><button type="button" onClick={() => setConfirm(null)}>Keep</button></span>
        : <button type="button" className="dsg-tool" aria-label="Delete this well" onClick={() => setConfirm("delete")}><Trash2 size={14} /></button>)}
    </>}
    numbers={<>
      <span><small>Total depth</small><b>{fmt(value.totalDepthM)} m</b></span>
      <span><small>Stations</small><b>{value.stations.length}</b></span>
      {base ? <span><small>Edits</small><b>{editCount}</b></span> : <span><small>Records</small><b>{value.components.length}</b></span>}
    </>}
    canvas={place?.assembly && value.components.length
      ? <div className="construction-body wed-canvas"><AssemblySchematic assembly={place.assembly} survey={place.stations} formations={place.formations} formationColumn={place.formations} records={place.components} assetBaseUrl={ASSETS}
        selectedId={wire.componentId} onSelect={select} depthWindow={wire.window} onDepthWindowChange={wire.setWindow}
        cursorDepthM={wire.cursor} onCursorDepthChange={wire.hover} title={`${value.identity.name || "Well"} as ${base ? "recorded" : "entered"}`} /></div>
      : <Empty icon={FilePen} title="No construction yet" action={{ label: "Open Casing & hole", run: () => openStage("construction") }}>The well is drawn here once its strings, hole sections and cement are entered in Casing &amp; hole.</Empty>}
    inspector={<Inspector reveal={reveal} id="editor" initial={entry.kind === "recorded" ? "survey" : "construction"} head={<dl className="mf-facts">
      <div className="mf-facts-title"><dt>{md === null ? "Hover the drawing" : `At ${fmt(md)} m MD${tvd !== null ? ` · ${fmt(tvd)} m TVD` : ""}`}</dt><dd>{lastUndo ? "edited" : base ? "as recorded" : "entered"}</dd></div>
      <div><dt>Formation</dt><dd>{md === null ? "—" : topHere ? topHere.name : "above the first top"}</dd></div>
      <div><dt>Innermost string · hole</dt><dd>{md === null ? "—" : `${stringHere ? stringHere.name : "no casing"} · ${holeHere?.outerDiameterMm ? formatInches(holeHere.outerDiameterMm / 25.4) : "—"}`}</dd></div>
    </dl>} sections={STAGES.map((stage) => {
      const count = stageCount(stage.id, value);
      const changed = base ? stageEdited(stage.id, value, base) : false;
      return { id: stage.id, title: stage.label, summary: <span className="wed-sum">{count ? <small className="wed-count">{count}</small> : null}{changed && <><i className="wed-dot" />edited</>}</span>, body: <div className="dsg-form">
        <p className="dsg-purpose">{stage.purpose}</p>
        {forms[stage.id]}
      </div> };
    })} links={[value.stations.length > 0 && { label: `Survey stations (${value.stations.length})`, onOpen: () => openTable(null) }]} />}
    page={table ? { title: "Survey stations", context: `${value.identity.name || "Unnamed well"} · ${value.stations.length} station${value.stations.length === 1 ? "" : "s"}${value.surveySource ? ` · ${value.surveySource}` : ""}`, onBack: () => { setTable(false); setEditing(null); },
      body: <SurveyTable value={value} edit={edit} editing={editing} setEditing={setEditing} /> } : null}
    status={<Status items={[lastUndo ? <>Last change: <b>{lastUndo.label}</b></> : "Every change is one named step (⌘Z)", base ? "Edits are kept in this browser; the record itself is unchanged" : "Kept in this browser; export it to keep a copy"]} />} />;
}

type Edit = (label: string, change: (value: WellRecordValue) => WellRecordValue) => void;

function countEdits(value: WellRecordValue, base: WellRecordValue) {
  let count = same(value.stations, base.stations) ? 0 : 1;
  if (value.totalDepthM !== base.totalDepthM) count++;
  if (!same(value.identity, base.identity)) count++;
  const rows = <T extends { readonly id: string }>(now: readonly T[], was: readonly T[]) => now.filter((row) => !same(row, was.find((old) => old.id === row.id))).length + was.filter((old) => !now.some((row) => row.id === old.id)).length;
  return count + rows(value.components, base.components) + rows(value.tops, base.tops);
}
const stageCount = (stage: Stage, value: WellRecordValue) => stage === "survey" ? value.stations.length : stage === "tops" ? value.tops.length : stage === "construction" ? value.components.length : 0;
const stageEdited = (stage: Stage, value: WellRecordValue, base: WellRecordValue) =>
  stage === "well" ? !same(value.identity, base.identity) || value.totalDepthM !== base.totalDepthM : stage === "survey" ? !same(value.stations, base.stations) || value.surveySource !== base.surveySource
    : stage === "tops" ? !same(value.tops, base.tops) : stage === "construction" ? !same(value.components, base.components) : false;

/** Whether a row is the record's, edited, or added; with what reverting it means. */
function Provenance({ row, base, onRevert }: { readonly row: { readonly id: string; readonly sourcePage?: number }; readonly base: readonly { readonly id: string }[] | null; readonly onRevert: () => void }) {
  if (!base) return <span className="wed-badge is-entered">Entered</span>;
  const was = base.find((entry) => entry.id === row.id);
  if (!was) return <span className="wed-badge is-entered">Added</span>;
  if (same(was, row)) return <span className="wed-badge is-record">Record{row.sourcePage ? ` · p. ${row.sourcePage}` : ""}</span>;
  return <span className="wed-badge is-edited">Edited<button type="button" onClick={onRevert} title="Put back the record's values">Revert</button></span>;
}

const ENVIRONMENTS: readonly { readonly value: WellEnvironment; readonly label: string }[] = [{ value: "onshore", label: "Onshore" }, { value: "offshore-platform", label: "Offshore platform" }, { value: "offshore-subsea", label: "Subsea" }];
const REFERENCES: readonly { readonly value: DepthReference; readonly label: string }[] = [{ value: "RKB", label: "RKB" }, { value: "DF", label: "DF" }, { value: "GL", label: "GL" }, { value: "MSL", label: "MSL" }];

function WellStage({ value, base, edit }: { readonly value: WellRecordValue; readonly base: WellRecordValue | null; readonly edit: Edit }) {
  const id = value.identity, loc = value.location;
  const setId = (field: keyof WellRecordValue["identity"], label: string) => (next: string) => edit(`${label} → ${next || "blank"}`, (v) => ({ ...v, identity: { ...v.identity, [field]: next } }));
  const setLoc = (label: string, change: Partial<WellRecordValue["location"]>) => edit(label, (v) => ({ ...v, location: { ...v.location, ...change } }));
  const offshore = loc.environment !== "onshore";
  return <>
    <div className="dsg-grid">
      <TextField label="Well name" value={id.name} onCommit={setId("name", "Name")} wide />
      <TextField label="Field" value={id.field} onCommit={setId("field", "Field")} />
      <TextField label="Operator" value={id.operator} onCommit={setId("operator", "Operator")} />
      <TextField label="Country" value={id.country} onCommit={setId("country", "Country")} />
      <TextField label="UWI / API" value={id.uwi} onCommit={setId("uwi", "UWI")} />
      <NumberField label="Total depth" unit="m MD" value={value.totalDepthM} min={1} max={15000} onCommit={(td) => edit(`Total depth → ${td} m`, (v) => ({ ...v, totalDepthM: td! }))} hint={base && value.totalDepthM !== base.totalDepthM ? `Record: ${fmt(base.totalDepthM, 1)} m` : undefined} />
    </div>
    {base ? <p className="dsg-note">The place and depth reference of a documented well stay as recorded: its map position, neighbours and seismic are tied to them.</p> : <>
      <h5>Where</h5>
      <Segmented label="Environment" value={loc.environment} options={ENVIRONMENTS} onChange={(environment) => setLoc(`Environment → ${environment}`, { environment, ...(environment === "onshore" ? { waterDepthM: null } : { groundElevationM: null }) })} />
      <div className="dsg-grid">
        <NumberField label="Latitude" unit="°" value={loc.latitude} min={-84} max={84} onCommit={(latitude) => setLoc(`Latitude → ${latitude}°`, { latitude })} hint="WGS 84; south is negative" />
        <NumberField label="Longitude" unit="°" value={loc.longitude} min={-180} max={180} onCommit={(longitude) => setLoc(`Longitude → ${longitude}°`, { longitude })} hint="West is negative" />
        {offshore ? <NumberField label="Water depth" unit="m" value={loc.waterDepthM} min={1} optional onCommit={(waterDepthM) => setLoc(`Water depth → ${waterDepthM ?? "not set"} m`, { waterDepthM })} />
          : <NumberField label="Ground elevation" unit="m" value={loc.groundElevationM} optional onCommit={(groundElevationM) => setLoc(`Ground elevation → ${groundElevationM ?? "not set"} m`, { groundElevationM })} />}
      </div>
      <h5>Depth reference</h5>
      <div className="dsg-grid">
        <SelectField label="Measured from" value={value.datum.reference} options={REFERENCES} onCommit={(reference) => edit(`Depth reference → ${reference}`, (v) => ({ ...v, datum: { ...v.datum, reference } }))} />
        <NumberField label={`${value.datum.reference} elevation`} unit="m above MSL" value={value.datum.elevationMslM} optional onCommit={(elevationMslM) => edit(`${value.datum.reference} elevation → ${elevationMslM ?? "not set"} m`, (v) => ({ ...v, datum: { ...v.datum, elevationMslM } }))} />
      </div>
    </>}
  </>;
}

function SurveyStage({ value, base, edit, onTable }: { readonly value: WellRecordValue; readonly base: WellRecordValue | null; readonly edit: Edit; readonly onTable: (row: number | null) => void }) {
  const survey = useMemo(() => surveyOf(value.stations), [value.stations]);
  const lastStation = value.stations.at(-1);
  const projected = lastStation && value.totalDepthM > lastStation.mdM + 0.5;
  const [pasting, setPasting] = useState(value.stations.length === 0);
  const deepest = survey.at(-1);
  const maxInc = survey.reduce((best, point) => Math.max(best, point.inclinationDeg), 0);
  const changed = base ? !same(value.stations, base.stations) : false;
  return <>
    <div className="dsg-actions">
      <button type="button" className="dsg-primary" onClick={() => setPasting((open) => !open)}><ClipboardPaste size={14} />{value.stations.length ? "Replace or add from a paste or file" : "Paste or import stations"}</button>
      <button type="button" className="dsg-secondary" onClick={() => { const last = value.stations.at(-1); edit("Add a station", (v) => ({ ...v, stations: [...v.stations, last ? { ...last, mdM: last.mdM + 30 } : { mdM: 0, inclinationDeg: 0, azimuthDeg: 0 }] })); onTable(value.stations.length); }}><Plus size={14} />Add a station</button>
      {changed && <button type="button" className="dsg-secondary" onClick={() => edit("Survey back to the record", (v) => ({ ...v, stations: base!.stations, surveySource: base!.surveySource }))}><RotateCcw size={14} />Survey back to the record</button>}
    </div>
    {pasting && <PastePanel count={value.stations.length} onDone={(stations, mode, note) => { edit(`${mode === "replace" ? "Survey replaced" : "Stations added"}: ${stations.length} from ${note}`, (v) => ({ ...v, stations: mode === "replace" ? stations : [...v.stations, ...stations].sort((a, b) => a.mdM - b.mdM) })); setPasting(false); }} onCancel={() => setPasting(false)} />}
    <TextField label="Source of the survey" value={value.surveySource} placeholder="e.g. Gyro survey, contractor report 26 Jun 2023" onCommit={(surveySource) => edit("Survey source", (v) => ({ ...v, surveySource }))} wide />
    {value.stations.length > 0 && <dl className="dsg-facts">
      <div><dt>Stations</dt><dd>{value.stations.length}{changed ? ` (record ${base!.stations.length})` : ""}</dd></div>
      <div><dt>Deepest</dt><dd>{deepest ? `${fmt(deepest.mdM)} m MD · ${fmt(deepest.tvdM)} m TVD` : "—"}</dd></div>
      <div><dt>Most inclined</dt><dd>{fmt(maxInc, 1)}°</dd></div>
      <div><dt>Closure</dt><dd>{deepest ? `${fmt(Math.hypot(deepest.northingM, deepest.eastingM))} m` : "—"}</dd></div>
    </dl>}
    {projected && <p className="dsg-note">TD ({fmt(value.totalDepthM)} m) is below the last station ({fmt(lastStation!.mdM)} m): the deck projects the survey to TD along the last station&apos;s inclination and azimuth, and says so wherever the path is drawn.</p>}
    {value.stations.length > 0 && <button type="button" className="dsg-secondary" onClick={() => onTable(null)}>Open the station table: edit any row</button>}
  </>;
}

/** Every station, a row that opens to edit its MD, inclination and azimuth; TVD and position follow. */
function SurveyTable({ value, edit, editing, setEditing }: { readonly value: WellRecordValue; readonly edit: Edit; readonly editing: number | null; readonly setEditing: (row: number | null) => void }) {
  const survey = useMemo(() => surveyOf(value.stations), [value.stations]);
  const setStation = (index: number, label: string, change: Partial<EnteredStation>) => edit(label, (v) => ({ ...v, stations: v.stations.map((station, position) => position === index ? { ...station, ...change } : station) }));
  if (!value.stations.length) return <p className="dsg-note">No stations yet: paste or import them in the Survey section.</p>;
  return <div className="wed-table-wrap">
    <table className="wed-table">
      <thead><tr><th>#</th><th>MD m</th><th>Inc °</th><th>Azi °</th><th>TVD m</th><th>N m</th><th>E m</th><th /></tr></thead>
      <tbody>{value.stations.map((station, index) => {
        const point = survey[index];
        const open = editing === index;
        return <tr key={index} className={open ? "is-open" : undefined} onClick={() => { if (!open) setEditing(index); }}>
          <td>{index + 1}</td>
          {open ? <>
            <td><CellNumber label={`Station ${index + 1} MD`} value={station.mdM} min={0} onCommit={(mdM) => setStation(index, `Station ${index + 1} MD → ${mdM} m`, { mdM })} /></td>
            <td><CellNumber label={`Station ${index + 1} inclination`} value={station.inclinationDeg} min={0} max={180} onCommit={(inclinationDeg) => setStation(index, `Station ${index + 1} inclination → ${inclinationDeg}°`, { inclinationDeg })} /></td>
            <td><CellNumber label={`Station ${index + 1} azimuth`} value={station.azimuthDeg} min={0} max={360} onCommit={(azimuthDeg) => setStation(index, `Station ${index + 1} azimuth → ${azimuthDeg}°`, { azimuthDeg })} /></td>
          </> : <><td>{fmt(station.mdM, 2)}</td><td>{fmt(station.inclinationDeg, 2)}</td><td>{fmt(station.azimuthDeg, 2)}</td></>}
          <td>{point ? fmt(point.tvdM, 1) : "—"}</td><td>{point ? fmt(point.northingM, 1) : "—"}</td><td>{point ? fmt(point.eastingM, 1) : "—"}</td>
          <td><button type="button" className="dsg-remove" aria-label={`Remove station ${index + 1}`} onClick={(event) => { event.stopPropagation(); setEditing(null); edit(`Remove station ${index + 1} (${fmt(station.mdM)} m)`, (v) => ({ ...v, stations: v.stations.filter((_, position) => position !== index) })); }}><X size={13} /></button></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

/** Paste or a file in, a preview of exactly what was read, then replace or add. */
function PastePanel({ count, onDone, onCancel }: { readonly count: number; readonly onDone: (stations: readonly EnteredStation[], mode: "replace" | "append", note: string) => void; readonly onCancel: () => void }) {
  const [text, setText] = useState("");
  const [unit, setUnit] = useState<DepthUnit>("m");
  const [source, setSource] = useState("a paste");
  const file = useRef<HTMLInputElement>(null);
  const read = useMemo(() => text.trim() ? readStations(text, unit) : null, [text, unit]);
  return <div className="wed-paste">
    <p className="wed-paste-help">Paste stations from a spreadsheet or a survey report, one a line: measured depth, inclination, azimuth. A header row (“MD Inc Azi”) sets the column order; without one the first three numbers on each line are read.</p>
    <textarea value={text} onChange={(event) => { setText(event.target.value); setSource("a paste"); }} placeholder={"MD\tInc\tAzi\n0\t0\t0\n500\t1.2\t45\n…"} rows={7} spellCheck={false} aria-label="Stations to read" />
    <div className="dsg-actions">
      <button type="button" className="dsg-secondary" onClick={() => file.current?.click()}><FileUp size={14} />Read a CSV or text file…</button>
      <input ref={file} type="file" accept=".csv,.txt,.tsv,.dat,text/plain,text/csv" hidden onChange={async (event) => { const chosen = event.target.files?.[0]; if (chosen) { setText(await chosen.text()); setSource(chosen.name); } event.target.value = ""; }} />
      <SelectField label="Depths are in" value={unit} options={DEPTH_UNITS.map((entry) => ({ value: entry.value, label: entry.label }))} onCommit={setUnit} />
    </div>
    {read && <div className="wed-read">
      <p><b>{read.stations.length} station{read.stations.length === 1 ? "" : "s"}</b> read{read.columns.fromHeader ? ", columns named by the header" : ", the first three numbers of each line as MD, inclination, azimuth"}{read.stations.length ? ` · ${fmt(read.stations[0]!.mdM, 1)}–${fmt(read.stations.at(-1)!.mdM, 1)} m MD` : ""}.</p>
      {read.headerUnit && read.headerUnit !== unit && <p className="is-warning">The header says the depths are in {DEPTH_UNITS.find((entry) => entry.value === read.headerUnit)!.label}; they are being read as {DEPTH_UNITS.find((entry) => entry.value === unit)!.label}. <button type="button" className="dsg-link" onClick={() => setUnit(read.headerUnit!)}>Read them as {DEPTH_UNITS.find((entry) => entry.value === read.headerUnit)!.label}</button></p>}
      {read.skipped.length > 0 && <p className="is-quiet">{read.skipped.length} line{read.skipped.length === 1 ? "" : "s"} left out: {read.skipped.slice(0, 4).map((line) => `line ${line.line} (“${line.text.slice(0, 28)}”)`).join(", ")}{read.skipped.length > 4 ? "…" : ""}</p>}
      {read.problems.map((problem) => <p key={problem} className="is-warning">{problem}</p>)}
    </div>}
    <div className="dsg-actions">
      <button type="button" className="dsg-primary" disabled={!read?.stations.length || read.problems.length > 0} onClick={() => onDone(read!.stations, "replace", source)}>{count ? `Replace the ${count} stations` : "Use these stations"}</button>
      {count > 0 && <button type="button" className="dsg-secondary" disabled={!read?.stations.length || read.problems.length > 0} onClick={() => onDone(read!.stations, "append", source)}>Add them to the survey</button>}
      <button type="button" className="dsg-link" onClick={onCancel}>Cancel</button>
    </div>
  </div>;
}

function TopsStage({ value, base, edit }: { readonly value: WellRecordValue; readonly base: WellRecordValue | null; readonly edit: Edit }) {
  const survey = useMemo(() => surveyOf(value.stations), [value.stations]);
  const sorted = [...value.tops].sort((a, b) => a.topMdM - b.topMdM);
  const setTop = (id: string, label: string, change: Partial<EnteredTop>) => edit(label, (v) => ({ ...v, tops: v.tops.map((top) => top.id === id ? { ...top, ...change } : top) }));
  const removed = base ? base.tops.filter((old) => !value.tops.some((top) => top.id === old.id)) : [];
  return <>
    <div className="dsg-rows">
      {sorted.map((top) => {
        const tvd = survey.length ? survey.find((point) => point.mdM >= top.topMdM) : null;
        return <div key={top.id} className="dsg-row">
          <TextField label="Formation" value={top.name} onCommit={(name) => setTop(top.id, `Top ${top.name} → ${name}`, { name })} />
          <NumberField label="Top" unit="m MD" value={top.topMdM} min={0} onCommit={(topMdM) => setTop(top.id, `${top.name} top → ${topMdM} m MD`, { topMdM: topMdM! })} hint={tvd ? `≈ ${fmt(tvd.tvdM)} m TVD` : undefined} />
          <TextField label="Lithology" value={top.lithology} onCommit={(lithology) => setTop(top.id, `${top.name} lithology`, { lithology })} />
          <TextField label="Source" value={top.source} placeholder="e.g. mud log pick" onCommit={(source) => setTop(top.id, `${top.name} source`, { source })} />
          <Provenance row={top} base={base?.tops ?? null} onRevert={() => edit(`${top.name} back to the record`, (v) => ({ ...v, tops: v.tops.map((entry) => entry.id === top.id ? base!.tops.find((old) => old.id === top.id)! : entry) }))} />
          <button type="button" className="dsg-remove" aria-label={`Remove ${top.name}`} onClick={() => edit(`Remove top ${top.name}`, (v) => ({ ...v, tops: v.tops.filter((entry) => entry.id !== top.id) }))}><X size={14} /></button>
        </div>;
      })}
    </div>
    <button type="button" className="dsg-add" onClick={() => { const last = sorted.at(-1); edit("Add a formation top", (v) => ({ ...v, tops: [...v.tops, { id: `top-${Date.now().toString(36)}`, name: `Formation ${v.tops.length + 1}`, topMdM: last ? Math.min(v.totalDepthM, last.topMdM + 200) : 0, lithology: "", source: "" }] })); }}><Plus size={14} />Add a top</button>
    {removed.length > 0 && <Removed rows={removed.map((top) => ({ id: top.id, name: top.name }))} onRestore={(id) => edit("Restore a recorded top", (v) => ({ ...v, tops: [...v.tops, base!.tops.find((old) => old.id === id)!] }))} />}
  </>;
}

const KINDS: readonly ComponentKind[] = ["Casing", "Hole", "Cement", "Tubular", "Packer", "Safety valve", "Wellhead", "Valve"];
const KIND_LABEL: Partial<Record<ComponentKind, string>> = { Tubular: "Tubing", Hole: "Hole section", Casing: "Casing / liner" };
const inchesOf = (mm: number | null) => mm === null ? null : Math.round(mm / 25.4 * 1000) / 1000;

function ConstructionStage({ value, base, edit, open, setOpen }: { readonly value: WellRecordValue; readonly base: WellRecordValue | null; readonly edit: Edit; readonly open: string | null; readonly setOpen: (id: string | null) => void }) {
  const order: Partial<Record<ComponentKind, number>> = { Wellhead: 0, Valve: 1, Casing: 2, Hole: 3, Cement: 4, Tubular: 5, Packer: 6, "Safety valve": 7 };
  const rows = [...value.components].sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.topDepthM - b.topDepthM || a.bottomDepthM - b.bottomDepthM);
  const setRow = (id: string, label: string, change: Partial<WellComponent>) => edit(label, (v) => ({ ...v, components: v.components.map((component) => component.id === id ? { ...component, ...change } : component) }));
  const add = (kind: ComponentKind) => {
    const id = `entered-${Date.now().toString(36)}`;
    const deepest = Math.max(0, ...value.components.filter((component) => component.kind === "Casing").map((component) => component.bottomDepthM));
    const surface = kind === "Wellhead" || kind === "Valve";
    edit(`Add ${(KIND_LABEL[kind] ?? kind).toLowerCase()}`, (v) => ({ ...v, components: [...v.components, {
      id, kind, name: kind === "Casing" ? "New casing" : kind === "Hole" ? "Hole section" : kind === "Cement" ? "Cement" : kind === "Tubular" ? "Tubing" : kind,
      material: "", outerDiameterMm: surface ? null : kind === "Casing" ? 177.8 : kind === "Hole" ? 215.9 : kind === "Tubular" ? 88.9 : null, innerDiameterMm: null,
      topDepthM: 0, bottomDepthM: surface ? 0 : Math.min(v.totalDepthM, Math.max(deepest, 0) + 300), description: "",
    }] }));
    setOpen(id);
  };
  const removed = base ? base.components.filter((old) => !value.components.some((component) => component.id === old.id)) : [];
  return <>
    <div className="dsg-actions">{(["Casing", "Hole", "Cement", "Tubular", "Wellhead"] as const).map((kind) => <button key={kind} type="button" className="dsg-add" onClick={() => add(kind)}><Plus size={14} />{KIND_LABEL[kind] ?? kind}</button>)}</div>
    {!rows.length && <p className="dsg-note">No records yet. Add the strings as run, the hole sections drilled and the cement placed, each with where its numbers came from.</p>}
    <div className="dsg-cards">
      {rows.map((row) => {
        const surface = row.kind === "Wellhead" || row.kind === "Valve";
        const isOpen = open === row.id;
        const set = (label: string, change: Partial<WellComponent>) => setRow(row.id, `${row.name} · ${label}`, change);
        return <article key={row.id} className={`dsg-card wed-card${isOpen ? " is-open" : ""}`}>
          <header onClick={() => setOpen(isOpen ? null : row.id)}>
            <b>{row.name}</b>
            <span className="wed-summary">{KIND_LABEL[row.kind] ?? row.kind}{row.outerDiameterMm !== null ? ` · ${formatInches(row.outerDiameterMm / 25.4)}` : ""}{surface ? "" : ` · ${fmt(row.topDepthM)}–${fmt(row.bottomDepthM)} m MD`}{row.material ? ` · ${row.material}` : ""}</span>
            <Provenance row={row} base={base?.components ?? null} onRevert={() => edit(`${row.name} back to the record`, (v) => ({ ...v, components: v.components.map((component) => component.id === row.id ? base!.components.find((old) => old.id === row.id)! : component) }))} />
            <button type="button" className="dsg-remove" aria-label={`Remove ${row.name}`} onClick={(event) => { event.stopPropagation(); edit(`Remove ${row.name}`, (v) => ({ ...v, components: v.components.filter((component) => component.id !== row.id) })); }}><X size={14} /></button>
          </header>
          {isOpen && <div className="dsg-grid">
            <TextField label="Name" value={row.name} onCommit={(name) => set(`name → ${name}`, { name })} />
            <SelectField label="Kind" value={row.kind} options={KINDS.map((kind) => ({ value: kind, label: KIND_LABEL[kind] ?? kind }))} onCommit={(kind) => set(`kind → ${kind}`, { kind })} />
            {!surface && <NumberField label={row.kind === "Hole" ? "Bit size" : row.kind === "Cement" ? "Outer diameter (hole)" : "OD"} unit="in" value={inchesOf(row.outerDiameterMm)} min={0.5} max={60} optional onCommit={(od) => set(`OD → ${od ?? "not reported"} in`, { outerDiameterMm: od === null ? null : od * 25.4 })} />}
            {!surface && row.kind !== "Hole" && <NumberField label={row.kind === "Cement" ? "Inner diameter (pipe OD)" : "ID"} unit="in" value={inchesOf(row.innerDiameterMm)} min={0.5} max={60} optional onCommit={(id) => set(`ID → ${id ?? "not reported"} in`, { innerDiameterMm: id === null ? null : id * 25.4 })} hint="Empty: not reported" />}
            {!surface && <NumberField label="Top" unit="m MD" value={row.topDepthM} min={0} onCommit={(top) => set(`top → ${top} m`, { topDepthM: top! })} />}
            {!surface && <NumberField label={row.kind === "Casing" ? "Shoe" : "Bottom"} unit="m MD" value={row.bottomDepthM} min={0} onCommit={(bottom) => set(`${row.kind === "Casing" ? "shoe" : "bottom"} → ${bottom} m`, { bottomDepthM: bottom! })} />}
            <TextField label={row.kind === "Cement" ? "Slurry" : surface ? "Rating" : "Grade · weight · connection"} value={row.material} placeholder="e.g. L80 / 47 lb/ft / BTC" onCommit={(material) => set("specification", { material })} wide />
            <TextField label="Where it came from" value={row.description} placeholder="e.g. Casing tally, daily report 7 Aug 2017" onCommit={(description) => set("source", { description })} wide />
          </div>}
        </article>;
      })}
    </div>
    {removed.length > 0 && <Removed rows={removed.map((component) => ({ id: component.id, name: component.name }))} onRestore={(id) => edit("Restore a recorded component", (v) => ({ ...v, components: [...v.components, base!.components.find((old) => old.id === id)!] }))} />}
  </>;
}

function Removed({ rows, onRestore }: { readonly rows: readonly { readonly id: string; readonly name: string }[]; readonly onRestore: (id: string) => void }) {
  return <div className="wed-removed"><h5>Removed from the record</h5>{rows.map((row) => <span key={row.id}>{row.name}<button type="button" className="dsg-link" onClick={() => onRestore(row.id)}>Restore</button></span>)}</div>;
}

function LogsStage({ wellId, name }: { readonly wellId: string; readonly name: string }) {
  const logs = useImportedLogs(wellId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const read = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setError(null);
    const failures: string[] = [];
    for (const chosen of [...files]) { try { await importLas(wellId, chosen); } catch (reason) { failures.push(`${chosen.name}: ${(reason as Error).message}`); } }
    setBusy(false);
    if (failures.length) setError(failures.join(" · "));
  };
  return <>
    <div className="dsg-actions">
      <button type="button" className="dsg-primary" disabled={busy} onClick={() => file.current?.click()}><FileUp size={14} />{busy ? "Reading…" : "Import LAS files…"}</button>
      <input ref={file} type="file" accept=".las,.LAS" multiple hidden onChange={(event) => { void read(event.target.files); event.target.value = ""; }} />
      {logs.length > 0 && <button type="button" className="dsg-link" onClick={() => actions.open("logs")}>Show them in Logs</button>}
    </div>
    {error && <p className="dsg-error-line" role="alert">{error}</p>}
    {!logs.length && <p className="dsg-note">LAS 2.0 files, depth index in metres or feet. Each file becomes a log set in the Logs module, its curves on the ranges their own values span.</p>}
    <div className="dsg-cards">{logs.map((log) => <article key={log.id} className="dsg-card">
      <header><b>{log.fileName}</b><span className="wed-summary">{fmt(log.topM)}–{fmt(log.baseM)} m · {fmt(log.samples)} samples · index {log.index.mnemonic} in {log.index.unit || "?"} · {fmt(log.bytes / 1024)} kB</span>
        <button type="button" className="dsg-remove" aria-label={`Remove ${log.fileName}`} onClick={() => void removeLog(log.id)}><X size={14} /></button></header>
      <p className="wed-curves">{log.curves.map((curve) => <span key={curve.mnemonic} title={curve.description}>{curve.mnemonic}{curve.unit ? <small> {curve.unit}</small> : null}</span>)}</p>
      {log.lasWell && name && !log.lasWell.toLowerCase().includes(name.toLowerCase().slice(0, 4)) && <p className="is-warning wed-warn">The file names its well “{log.lasWell}”. Check it belongs to {name}.</p>}
    </article>)}</div>
  </>;
}
