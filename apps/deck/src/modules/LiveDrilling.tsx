import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { pressureAt } from "@ikhmalputra/subsurface-core/well-design";
import { Maximize, Minimize, ZoomIn, ZoomOut } from "lucide-react";
import { RigView } from "./RigView.tsx";
// The 3D view brings three.js with it: fetched only when someone asks for it.
const RigView3D = lazy(() => import("./RigView3D.tsx").then((module) => ({ default: module.RigView3D })));
import { DrillingSimulator, defaultFlowGpm } from "@ikhmalputra/subsurface-core/simulation";
import type { DrillCommand, DrillEvent, DrillMode, DrillReading, Hazard } from "@ikhmalputra/subsurface-core/simulation";
import { useDesign } from "../data/design.ts";
import { fmt } from "../format.ts";
import { Frame, Inspector, Status } from "./frame/Frame.tsx";
import { useWire } from "./wire.ts";

/**
 * Live drilling: one hole section of the planned well, drilled second by second by the simulator in
 * the core package. The driller works the rig (WOB, RPM, flow, mud, the BOP) from what a rig floor
 * shows; the rock follows the plan, varied by a seed, with the plan's own hazards made real and any
 * disaster the user adds just ahead of the bit. Kicks, losses and blowouts come out of the physics,
 * never from a script. Simulators are kept per well, section and seed while the deck is open.
 */

const sims = new Map<string, DrillingSimulator>();
const SPEEDS = [1, 10, 60, 600, 3600] as const;
const WINDOWS = [[1800, "30 min"], [7200, "2 h"], [28800, "8 h"]] as const;
const MODE: Readonly<Record<DrillMode, string>> = {
  drilling: "Drilling", circulating: "Circulating off bottom", connection: "Connection", "flow-check": "Flow check", "shut-in": "Shut in",
  killing: "Killing the well", killed: "Well dead", tripping: "Tripping for a bit", "section-td": "Section TD", blowout: "Blowout",
};
const clock = (s: number) => `Day ${Math.floor(s / 86400) + 1} · ${String(Math.floor(s % 86400 / 3600)).padStart(2, "0")}:${String(Math.floor(s % 3600 / 60)).padStart(2, "0")}`;

export function LiveDrilling() {
  const wire = useWire("rig");
  const { brief } = useDesign();
  const sections = useMemo(() => [...brief.sections].sort((a, b) => a.shoeMdM - b.shoeMdM), [brief]);
  const [sectionIndex, setSectionIndex] = useState(() => Math.max(0, sections.length - 1));
  const [seed, setSeed] = useState(1);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(60);
  const [paused, setPaused] = useState(true);
  const [pauseOnAlarm, setPauseOnAlarm] = useState(true);
  const [windowS, setWindowS] = useState(7200);
  const [mudText, setMudText] = useState("");
  const [zoomed, setZoomed] = useState(false);
  const [view, setView] = useState<"2d" | "3d">("2d");
  const [full, setFull] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // Full screen takes the whole frame (toolbar, canvas, inspector and charts), found from the canvas.
  const frameOf = () => root.current?.closest<HTMLElement>(".mf") ?? null;
  useEffect(() => { const change = () => setFull(!!document.fullscreenElement && document.fullscreenElement === frameOf()); document.addEventListener("fullscreenchange", change); return () => document.removeEventListener("fullscreenchange", change); }, []);
  const toggleFull = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void frameOf()?.requestFullscreen?.(); };
  const [, setVersion] = useState(0);
  const repaint = () => setVersion((v) => v + 1);

  const key = `${brief.identity.name}|${sections.map((s) => `${s.shoeMdM}:${s.mudWeightSg}:${s.holeSizeIn}`).join(",")}|${sectionIndex}|${seed}`;
  const sim = useMemo(() => {
    if (!sections[sectionIndex]) return null;
    let found = sims.get(key);
    if (!found) { found = new DrillingSimulator({ brief, sectionIndex, seed }); sims.set(key, found); }
    return found;
  }, [key]);
  const simRef = useRef(sim); simRef.current = sim;

  // The clock: simulated seconds per real second at the chosen speed, painted ten times a second.
  useEffect(() => {
    if (paused) return;
    let frame = 0, last = performance.now(), painted = 0, carry = 0;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      const current = simRef.current;
      if (!current) return;
      const dt = speed <= 60 ? 1 : speed <= 600 ? 2 : 5;
      carry += Math.min(0.25, (now - last) / 1000) * speed; last = now;
      const seconds = Math.floor(carry / dt) * dt; carry -= seconds;
      if (seconds > 0) {
        const before = current.events.length;
        current.step(seconds, dt);
        const fresh = current.events.slice(before);
        if (fresh.some((e) => e.level === "disaster") || current.now.mode === "section-td" || (pauseOnAlarm && fresh.some((e) => e.level === "alarm"))) setPaused(true);
      }
      if (now - painted > 100) { painted = now; repaint(); }
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [paused, speed, pauseOnAlarm, key]);

  // The rest of the deck follows the bit.
  const lastPinned = useRef(0);
  const bit = sim?.now.bitMdM ?? 0;
  useEffect(() => { if (Math.abs(bit - lastPinned.current) >= 2) { lastPinned.current = bit; wire.pin(bit); } }, [Math.round(bit / 2)]);

  if (!sim) return <p className="eng-note">No casing sections in this plan yet. Add them in the Well designer to drill a hole section.</p>;
  const r = sim.now;
  const act = (command: DrillCommand) => { sim.command(command); repaint(); };
  const over = r.mode === "blowout" || r.mode === "section-td";
  const sheet = sim.killSheet();
  const ahead = (metres: number) => r.holeMdM + metres;
  const disasters: { label: string; hazard: () => Hazard }[] = [
    { label: "Gas sand ahead", hazard: () => { const top = ahead(15 + Math.random() * 25); const tvd = r.bitTvdM; const extra = r.mudSg + 0.06 + Math.random() * 0.08 - pressureAt(brief, tvd).porePressureSg; return { kind: "overpressure", topMdM: top, baseMdM: top + 12, extraSg: Math.max(0.05, extra), gas: true, label: `Gas sand ahead (added at ${Math.round(r.holeMdM)} m)` }; } },
    { label: "Weak zone ahead", hazard: () => { const top = ahead(10 + Math.random() * 20); return { kind: "weak-zone", topMdM: top, baseMdM: top + 25, fractureSg: Math.max(r.mudSg + 0.01, r.ecdBitSg - 0.03), label: `Weak, fractured zone ahead (added at ${Math.round(r.holeMdM)} m)` }; } },
    { label: "Drill-pipe washout", hazard: () => ({ kind: "washout", atS: r.timeS + 300 + Math.random() * 1200, label: "Drill-pipe washout (opens within 25 minutes)" }) },
    { label: "Abrasive sand ahead", hazard: () => { const top = ahead(5); return { kind: "abrasive", topMdM: top, baseMdM: top + 60, label: `Abrasive sand ahead (added at ${Math.round(r.holeMdM)} m)` }; } },
  ];
  const shown = sim.history.filter((point) => point.timeS >= r.timeS - windowS);
  // The banner shows what is happening now: the latest warning of the last 15 simulated minutes, or a disaster.
  const alarms = sim.events.filter((e) => e.level === "disaster" || (e.level !== "info" && r.timeS - e.timeS <= 900)).slice(-1);

  const shutIn = r.mode === "shut-in" || r.mode === "killing";
  const ended = r.mode === "blowout" || r.mode === "killed" || r.mode === "section-td";
  const killSheet = sheet ?? sim.lastKillSheet;
  const track = { points: shown, span: windowS, end: r.timeS };
  return <Frame name="rig" className={`rig-frame is-${r.mode}`} title={brief.identity.name} subtitle="Live drilling · simulated"
    tools={<>
      <label className="dca-field rig-section"><select aria-label="Hole section" value={sectionIndex} onChange={(event) => { setSectionIndex(Number(event.target.value)); setPaused(true); }}>
        {sections.map((s, i) => <option key={s.id} value={i}>{`${s.holeSizeIn}″ hole to ${Math.round(s.shoeMdM)} m · ${s.label}`}</option>)}
      </select></label>
      <span className="log-sets rig-speed" role="group" aria-label="Simulation speed">
        <button type="button" aria-pressed={paused} onClick={() => setPaused(!paused)} disabled={over}>{paused ? "▶ Run" : "❚❚ Pause"}</button>
        {SPEEDS.map((value) => <button key={value} type="button" aria-pressed={speed === value} onClick={() => setSpeed(value)}>{value}×</button>)}
      </span>
      <label className="rig-check"><input type="checkbox" checked={pauseOnAlarm} onChange={(event) => setPauseOnAlarm(event.target.checked)} /> pause on alarms</label>
      <span className="log-sets rig-speed" role="group" aria-label="View"><button type="button" aria-pressed={view === "2d"} onClick={() => setView("2d")}>2D</button><button type="button" aria-pressed={view === "3d"} onClick={() => setView("3d")}>3D path</button></span>
      {view === "2d" && <button type="button" className="dsg-tool" aria-pressed={zoomed} onClick={() => setZoomed(!zoomed)} title={zoomed ? "Show the whole well" : "Follow the bit: the last 170 m"}>{zoomed ? <ZoomOut size={14} /> : <ZoomIn size={14} />}<span className="rig-tool-text">{zoomed ? "Whole well" : "Near the bit"}</span></button>}
      <button type="button" className="dsg-tool" onClick={toggleFull} aria-label={full ? "Leave full screen" : "Full screen"}>{full ? <Minimize size={14} /> : <Maximize size={14} />}</button>
    </>}
    numbers={<>
      <span><small>{clock(r.timeS).split(" · ")[0]}</small><b>{clock(r.timeS).split(" · ")[1]}</b></span>
      <span className="rig-bit"><small>Bit MD</small><b>{fmt(r.bitMdM, 1)} m</b></span>
      <span className={`rig-status is-${r.mode}`} role="status">{MODE[r.mode]}</span>
    </>}
    canvas={<div className="rig-canvas" ref={root}>
      {alarms.length > 0 && <p className={`rig-alarm is-${alarms[0]!.level}`} role="alert">{alarms[0]!.text}</p>}
      <section className="rig-stage" aria-label="The rig and the hole">
        {view === "2d"
          ? <RigView simRef={simRef} running={!paused} zoomed={zoomed} rate={speed} />
          : <Suspense fallback={<p className="eng-note">Loading the 3D view…</p>}><RigView3D simRef={simRef} running={!paused} rate={speed} /></Suspense>}
      </section>
    </div>}
    strip={<section className="rig-charts" aria-label="Rig floor charts">
      <span className="log-sets rig-window" role="group" aria-label="Time window">{WINDOWS.map(([value, text]) => <button key={value} type="button" aria-pressed={windowS === value} onClick={() => setWindowS(value)}>{text}</button>)}</span>
      <Track {...track} lines={[{ value: (p) => p.ropMh, colour: "#34d399", label: "ROP", unit: "m/h", digits: 1 }]} />
      <Track {...track} lines={[{ value: (p) => p.wobKlbf, colour: "#818cf8", label: "WOB", unit: "klbf", digits: 0 }, { value: (p) => p.rpm, colour: "#94a3b8", label: "RPM", unit: "", digits: 0 }]} />
      <Track {...track} lines={[{ value: (p) => p.torqueKftLbf, colour: "#fbbf24", label: "Torque", unit: "kft·lbf", digits: 1 }, { value: (p) => p.hookloadKlb, colour: "#a8a29e", label: "Hookload", unit: "klb", digits: 0 }]} />
      <Track {...track} lines={[{ value: (p) => p.sppPsi, colour: "#60a5fa", label: "SPP", unit: "psi", digits: 0 }, { value: (p) => p.casingPsi, colour: "#ef4444", label: "Casing", unit: "psi", digits: 0 }]} />
      <Track {...track} lines={[{ value: (p) => p.flowInGpm, colour: "#94a3b8", label: "Flow in", unit: "gpm", digits: 0 }, { value: (p) => p.flowOutGpm, colour: "#ef4444", label: "Flow out", unit: "gpm", digits: 0 }]} />
      <Track {...track} lines={[{ value: (p) => p.pitGainBbl, colour: "#f59e0b", label: "Pit gain", unit: "bbl", digits: 1 }]} zero />
      <Track {...track} lines={[{ value: (p) => p.ecdBitSg, colour: "#e2e8f0", label: "ECD at bit", unit: "SG", digits: 3 }, { value: (p) => p.planPoreSg, colour: "#60a5fa", label: "plan pore", unit: "SG", digits: 2, dashed: true }, { value: (p) => p.planFractureSg, colour: "#f59e0b", label: "plan frac", unit: "SG", digits: 2, dashed: true }]} />
      <Track {...track} lines={[{ value: (p) => p.gasUnits, colour: "#a3a3a3", label: "Gas", unit: "units", digits: 0 }, { value: (p) => p.gammaApi, colour: "#4ade80", label: "MWD GR", unit: "gAPI", digits: 0 }]} />
    </section>}
    inspector={<Inspector id={ended ? "rig-debrief" : shutIn ? "rig-shut-in" : "rig"} initial={ended ? "debrief" : shutIn ? "kill" : "events"} head={<div className="rig-controls" aria-label="Driller's controls">
      <dl className="mf-facts">
        <div><dt>Bit</dt><dd>{fmt(r.bitMdM, 1)} m MD · {fmt(r.bitTvdM, 0)} m TVD</dd></div>
        <div><dt>Formation</dt><dd>{r.formation}</dd></div>
        <div><dt>ROP</dt><dd>{fmt(r.ropMh, 1)} m/h</dd></div>
      </dl>
      <Knob label="WOB" unit="klbf" min={0} max={60} step={1} initial={Math.min(55, Math.round(2.6 * sim.holeIn))} onChange={(wobKlbf) => act({ kind: "rig", wobKlbf })} k={key} />
      <Knob label="RPM" unit="rpm" min={0} max={220} step={5} initial={120} onChange={(rpm) => act({ kind: "rig", rpm })} k={key} />
      <Knob label="Flow" unit="gpm" min={0} max={1400} step={10} initial={defaultFlowGpm(sim.holeIn)} onChange={(flowGpm) => act({ kind: "rig", flowGpm })} k={key} />
      <form className="rig-mud" onSubmit={(event) => { event.preventDefault(); const sg = Number(mudText); if (sg > 0) act({ kind: "mud", sg }); setMudText(""); }}>
        <label>Mud <input type="number" step="0.01" min="0.9" max="2.4" value={mudText} placeholder={r.mudSg.toFixed(2)} onChange={(event) => setMudText(event.target.value)} aria-label="New mud weight, SG" /> SG</label>
        <button type="submit" className="dsg-tool" disabled={over || !mudText}>Change</button>
      </form>
      <div className="rig-buttons">
        <button type="button" onClick={() => act({ kind: "drill" })} disabled={over || ["shut-in", "killing", "tripping"].includes(r.mode) || r.mode === "drilling"}>Drill</button>
        <button type="button" onClick={() => act({ kind: "circulate" })} disabled={over || ["shut-in", "killing", "tripping"].includes(r.mode) || r.mode === "circulating"}>Circulate</button>
        <button type="button" onClick={() => act({ kind: "flow-check" })} disabled={over || ["shut-in", "killing", "tripping", "flow-check"].includes(r.mode)}>Flow check</button>
        <button type="button" className="is-danger" onClick={() => act({ kind: "shut-in" })} disabled={over || r.mode === "shut-in" || r.mode === "killing"}>Shut in</button>
        <button type="button" onClick={() => act({ kind: "kill" })} disabled={!sheet || r.mode !== "shut-in"} title={r.mode === "shut-in" && !sheet ? "Let the pressures settle (two minutes, no more flow)" : undefined}>Kill well</button>
        <button type="button" onClick={() => act({ kind: "open" })} disabled={!(r.mode === "killed" || (r.mode === "shut-in" && r.casingPsi < 1))}>Open well</button>
        <button type="button" onClick={() => act({ kind: "lcm" })} disabled={over}>LCM pill</button>
        <button type="button" onClick={() => act({ kind: "trip" })} disabled={over || ["shut-in", "killing", "tripping"].includes(r.mode)}>Trip for bit</button>
      </div>
    </div>} sections={[
      shutIn && { id: "kill", title: killSheet ? "Kill sheet" : "Shut in", summary: killSheet ? `kill mud ${killSheet.killMudSg.toFixed(2)} SG` : "pressures settling", body: <KillSheetCard sheet={killSheet} reading={r} /> },
      ended && { id: "debrief", title: "Debrief: what the rock was", body: <Debrief sim={sim} /> },
      { id: "events", title: "Events", summary: `${sim.events.length}`, body: <ol className="rig-log" aria-label="Events">{sim.events.slice(-9).reverse().map((e, i) => <li key={sim.events.length - i} className={`is-${e.level}`}><time>{clock(e.timeS).replace("Day ", "D")}</time>{e.text}</li>)}</ol> },
      { id: "disasters", title: "Rock and disasters", summary: `seed ${seed}`, body: <div className="rig-disasters">
        <p>New rock restarts this section on a new seed: the same plan, different rock.</p>
        <button type="button" className="dsg-tool" onClick={() => { sims.delete(key); setSeed(seed + 1); setPaused(true); }} title="Restart this section on a new seed: the same plan, different rock">New rock</button>
        <p>Disasters: put something the plan does not know about just ahead of the bit. What happens next is up to the physics and to you.</p>
        {disasters.map((d) => <button key={d.label} type="button" className="dsg-tool" disabled={over} onClick={() => act({ kind: "hazard", hazard: d.hazard() })}>{d.label}</button>)}
      </div> },
      { id: "model", title: "The simulator", summary: "simulated", body: <p className="mf-prose">Simulated. The rock is the plan&apos;s formations and pore and fracture pressures, varied by the seed by about ±0.02 SG, with the plan&apos;s named hazards made real and any you add. Bingham-plastic hydraulics (PV {sim.mud.pvCp} cP, YP {sim.mud.ypLbf100ft2} lbf/100 ft²), soft-string torque and drag, influx and losses in proportion to the under- or overbalance, Boyle&apos;s-law gas expansion, wait-and-weight kill. A planning and teaching simulator, not a certified well-control simulator.</p> },
    ]} />}
    status={<Status items={[paused && !over ? "Press Run, then work WOB, RPM and flow; shut in when the pit gains" : "Watch flow out and pit gain: shut in first, kill second", "Simulated: a planning and teaching simulator, not a certified well-control simulator"]} />} />;
}

function Knob({ label, unit, min, max, step, initial, onChange, k }: { readonly label: string; readonly unit: string; readonly min: number; readonly max: number; readonly step: number; readonly initial: number; readonly onChange: (value: number) => void; readonly k: string }) {
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [k]);
  return <label className="rig-knob">{label}<input type="range" min={min} max={max} step={step} value={value} onChange={(event) => { const next = Number(event.target.value); setValue(next); onChange(next); }} /><output>{value} {unit}</output></label>;
}

interface Line { readonly value: (p: DrillReading) => number | null; readonly colour: string; readonly label: string; readonly unit: string; readonly digits: number; readonly dashed?: boolean }
/** One strip-chart track: values against time over the chosen window, newest on the right. */
function Track({ points, span, end, lines, zero }: { readonly points: readonly DrillReading[]; readonly span: number; readonly end: number; readonly lines: readonly Line[]; readonly zero?: boolean }) {
  const step = Math.max(1, Math.floor(points.length / 360));
  const sampled = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  const values = sampled.flatMap((p) => lines.map((line) => line.value(p))).filter((v): v is number => v !== null && Number.isFinite(v));
  let low = Math.min(...values, zero ? 0 : Infinity), high = Math.max(...values, zero ? 0 : -Infinity);
  if (!values.length) { low = 0; high = 1; }
  if (high - low < 1e-6) { high += Math.max(1, Math.abs(high) * 0.05); low -= Math.max(1, Math.abs(low) * 0.05); }
  const pad = (high - low) * 0.08; low -= pad; high += pad;
  const x = (t: number) => 100 - (end - t) / span * 100, y = (v: number) => 100 - (v - low) / (high - low) * 100;
  const latest = points.at(-1);
  return <div className="rig-track">
    <div className="rig-track-head">{lines.map((line) => { const v = latest ? line.value(latest) : null; return <span key={line.label} style={{ ["--c" as string]: line.colour }}><i className={line.dashed ? "is-dashed" : undefined} />{line.label} <b>{v === null ? "—" : fmt(v, line.digits)}</b> {line.unit}</span>; })}</div>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {zero && low < 0 && high > 0 && <line x1={0} x2={100} y1={y(0)} y2={y(0)} className="rig-zero" vectorEffect="non-scaling-stroke" />}
      {lines.map((line) => {
        const d = sampled.map((p, i) => { const v = line.value(p); return v === null ? null : `${i && sampled[i - 1] && line.value(sampled[i - 1]!) !== null ? "L" : "M"}${x(p.timeS).toFixed(2)},${y(v).toFixed(2)}`; }).filter(Boolean).join("");
        return <path key={line.label} d={d} stroke={line.colour} strokeDasharray={line.dashed ? "4 3" : undefined} vectorEffect="non-scaling-stroke" />;
      })}
    </svg>
  </div>;
}

function KillSheetCard({ sheet, reading }: { readonly sheet: ReturnType<DrillingSimulator["killSheet"]>; readonly reading: DrillReading }) {
  if (!sheet) return <div className="rig-sheet"><b>Shut in</b><p>Drill pipe {fmt(reading.drillPipePsi, 0)} psi · casing {fmt(reading.casingPsi, 0)} psi. Waiting for the pressures to settle…</p></div>;
  return <div className="rig-sheet">
    <b>Kill sheet</b>
    <dl>
      <div><dt>SIDPP</dt><dd>{fmt(sheet.sidppPsi, 0)} psi</dd></div><div><dt>SICP</dt><dd>{fmt(sheet.sicpPsi, 0)} psi</dd></div>
      <div><dt>Kill mud</dt><dd>{sheet.killMudSg.toFixed(2)} SG</dd></div><div><dt>Influx</dt><dd>{fmt(sheet.influxBbl, 1)} bbl · {sheet.influxIs}</dd></div>
      <div><dt>ICP → FCP</dt><dd>{fmt(sheet.icpPsi, 0)} → {fmt(sheet.fcpPsi, 0)} psi</dd></div><div><dt>Kill rate</dt><dd>{sheet.killFlowGpm} gpm · SCR {fmt(sheet.scrPsi, 0)} psi</dd></div>
    </dl>
    {reading.killProgress !== null && <div className="rig-progress" aria-label={`Kill ${Math.round(reading.killProgress * 100)} % pumped`}><i style={{ width: `${reading.killProgress * 100}%` }} /><span>{Math.round(reading.killProgress * 100)} % pumped · drill pipe {fmt(reading.drillPipePsi, 0)} psi · choke {fmt(reading.chokePsi, 0)} psi</span></div>}
  </div>;
}

/** What happened, with what the rock really was: the hazards, when the influx began, when it was seen, when the well was shut in. */
function Debrief({ sim }: { readonly sim: DrillingSimulator }) {
  const firstInflux = sim.history.find((p) => p.truth.influxRateBblMin > 0);
  const firstAlarm = sim.events.find((e) => e.level === "alarm");
  const shutIn = sim.events.find((e) => e.code === "shut-in");
  const peakInflux = Math.max(0, ...sim.history.map((p) => p.truth.influxInHoleBbl));
  const events: DrillEvent[] = sim.events.filter((e) => e.level === "disaster" || e.code === "killed" || e.code === "td");
  const minutes = (a: number, b: number) => `${fmt((b - a) / 60, 0)} min`;
  return <section className="rig-debrief" aria-label="Debrief">
    <b>Debrief: what the rock was</b>
    <ul>
      {sim.hazards.map((h, i) => <li key={i}>{h.label}{"topMdM" in h ? ` · ${Math.round(h.topMdM)}–${Math.round(h.baseMdM)} m` : ""}{h.kind === "overpressure" ? ` · pore pressure ${h.extraSg.toFixed(2)} SG above the plan` : h.kind === "weak-zone" ? ` · fracture gradient ${h.fractureSg.toFixed(2)} SG` : ""}</li>)}
      {firstInflux && <li>First influx at {clock(firstInflux.timeS)}{firstAlarm ? `; first alarm ${minutes(firstInflux.timeS, firstAlarm.timeS)} later` : ""}{shutIn ? `; shut in ${minutes(firstInflux.timeS, shutIn.timeS)} after the influx began` : "; never shut in"}. Largest influx in the hole: {fmt(peakInflux, 1)} bbl.</li>}
      <li>Mud lost to the formation: {fmt(sim.now.truth.lossesBbl, 1)} bbl.</li>
      {events.map((e, i) => <li key={`e${i}`}>{e.text}</li>)}
    </ul>
  </section>;
}
