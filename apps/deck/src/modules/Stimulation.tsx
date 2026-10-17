import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { FileUp, Pause, Play, RotateCcw, Wand2 } from "lucide-react";
import { scaleLinear } from "d3-scale";
import { bValue, completeness, exceedance, fractureRadius, frontDiffusivity, seismogenicIndex, stageRiser, stressAt, trafficLight } from "@ikhmalputra/subsurface-core/induced-seismicity";
import type { Fracture, PressureModel, SeismicEvent, Stage } from "@ikhmalputra/subsurface-core/induced-seismicity";
import { useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";
import { useForgeOpenHole } from "../data/openhole.ts";
import { loadOwn, useCatalogue } from "../data/standard-files.ts";
import { JOB_START_ISO } from "../data/synthetic.ts";
import type { ObservedCatalogue, ObservedEvent } from "../data/synthetic.ts";
import { stimulationView } from "../data/stimulation-store.ts";
import { signals } from "../deck/store.ts";
import { timeline } from "../deck/timeline.ts";
import { STAGES_2022, cloudAxis, defaultStimulation, neighbours, pointAt, stageColour, stimulationJob, well16a } from "../data/stimulation-model.ts";
import type { PathPoint, StimulationInputs } from "../data/stimulation-model.ts";
import { compute } from "../compute/run.ts";
import { Dial } from "./production/controls.tsx";
import { Frame, Inspector, Status } from "./frame/Frame.tsx";
import { fmt } from "../format.ts";
import { useSize } from "./useSize.ts";
import { useWire } from "./wire.ts";

/**
 * FORGE's April 2022 stimulation of 16A(78)-32, as a model you pump. The rock around the toe in 3D
 * with 16A, 16B and 58-32; each stage's hydraulic fracture growing along SHmax as the volume goes
 * in; the pressure spreading from it; and the natural fractures it brings to Coulomb failure, each
 * an event sized by its magnitude. Three lenses on that scene: Plan (the stresses, friction and the
 * Mohr circle the fractures sit on), Pump (play the job, with the traffic light) and Read (the
 * triggering front, Gutenberg–Richter and the seismogenic index, as a monitoring team reads them).
 */

const KEY = "deck-stimulation-v1";
type Lens = "plan" | "pump" | "read";
const read = (): Partial<StimulationInputs> => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<StimulationInputs>; } catch { return {}; } };
type Result = Awaited<ReturnType<typeof compute<"stimulate">>>;

export function Stimulation() {
  const wire = useWire("stimulation");
  const { openHole, error } = useForgeOpenHole(true);
  const [inputs, setInputs] = useState<StimulationInputs>(() => ({ ...defaultStimulation, ...read() }));
  const set = (patch: Partial<StimulationInputs>) => setInputs((current) => { const next = { ...current, ...patch }; try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* not kept */ } return next; });
  const [lens, setLens] = useState<Lens>("pump");
  const later = useDeferredValue(inputs);
  const [result, setResult] = useState<{ key: string; value: Result } | null>(null);
  const [busy, setBusy] = useState(false);
  const job = useMemo(() => openHole ? stimulationJob(openHole.las, later) : null, [openHole, later]);
  const key = JSON.stringify(later);
  useEffect(() => {
    if (!job) return;
    let alive = true; setBusy(true);
    const timer = window.setTimeout(() => { compute("stimulate", job).then((value) => { if (alive) { setResult({ key, value }); setBusy(false); } }).catch(() => { if (alive) setBusy(false); }); }, 120);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [job, key]);

  // ---- the job's clock: the stages' windows end to end, so the days between stages do not swamp the play ----
  const stages = job?.stages ?? [];
  const windows = useMemo(() => stages.map((s) => ({ stage: s, from: s.startS - 0.08 * (s.endS - s.startS), to: s.endS + 10 * (s.endS - s.startS) })), [stages]);
  const span = windows.reduce((sum, w) => sum + (w.to - w.from), 0) || 1;
  const timeAt = (u: number) => { let left = Math.max(0, Math.min(1, u)) * span; for (const w of windows) { const d = w.to - w.from; if (left <= d) return w.from + left; left -= d; } return windows.at(-1)?.to ?? 0; };
  const [clock, setClock] = useState({ u: 1, playing: false, speed: 1 });
  useEffect(() => {
    if (!clock.playing) return;
    let frame = 0, last = performance.now();
    const tick = (now: number) => { const dt = (now - last) / 1000; last = now; setClock((c) => { const u = Math.min(1, c.u + dt / (24 / c.speed)); return { ...c, u, playing: u < 1 }; }); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clock.playing]);
  const t = timeAt(clock.u);
  /** The clock position of a job time: inside a stage's window, or the end of the window before it. */
  const uAt = (tt: number) => { let acc = 0; for (const w of windows) { if (tt < w.from) return acc / span; if (tt <= w.to) return (acc + tt - w.from) / span; acc += w.to - w.from; } return 1; };

  // ---- the catalogue: QuakeML, the synthetic stand-in until FORGE's is loaded ----
  const catalogue = useCatalogue();
  const observed = catalogue.value;
  const seen = useMemo(() => observed ? observed.events.filter((e) => e.tS <= t) : [], [observed, t]);
  const [matching, setMatching] = useState<string | null>(null);

  // ---- the deck's time rail: the job on it, scrubbed there or here ----
  const jobStart = Date.parse(JOB_START_ISO);
  const cursorMs = useSubsurfaceSelector(signals, (state) => state.time?.cursorMs ?? null);
  const wrote = useRef<number | null>(null), driven = useRef(false);
  const first = windows[0]?.from ?? 0, last = windows.at(-1)?.to ?? 0;
  useEffect(() => {
    if (!windows.length) return;
    const all = result?.value.events ?? [], bins = 160, counts = Array.from({ length: bins }, () => 0);
    for (const e of all) counts[Math.min(bins - 1, Math.max(0, Math.floor((e.tS - first) / (last - first) * bins)))]! += 1;
    const top = Math.max(1, ...counts);
    timeline.set({
      siteId: "forge", label: "Stimulation, April 2022", short: "Stimulation", startMs: jobStart + first * 1000, endMs: jobStart + last * 1000, todayMs: jobStart + last * 1000, stepMs: 60000,
      profile: counts.map((c) => Math.sqrt(c / top)), marks: windows.map((w) => ({ ms: jobStart + w.stage.startS * 1000, label: w.stage.label })),
      describe: (ms) => `${new Date(ms).toISOString().slice(5, 16).replace("T", " ")} UTC · ${hours((ms - jobStart) / 1000)} into the job`,
    });
  }, [windows, result, jobStart, first, last]);
  useEffect(() => () => { if (timeline.get()?.siteId === "forge") timeline.set(null); stimulationView.set(null); }, []);
  // From the rail: a cursor inside the job moves the clock here (unless it is the one this module wrote).
  useEffect(() => {
    if (cursorMs === null || cursorMs === wrote.current || !windows.length) return;
    const tt = (cursorMs - jobStart) / 1000;
    if (tt >= first && tt <= last) setClock((c) => ({ ...c, u: uAt(tt), playing: false }));
  }, [cursorMs]); 
  // To the rail: once the clock has been moved here, the cursor follows it, a few times a second.
  useEffect(() => {
    if (!driven.current) return;
    const ms = Math.round((jobStart + t * 1000) / 1000) * 1000;
    if (ms === wrote.current) return;
    const timer = window.setTimeout(() => { wrote.current = ms; signals.setTimeCursor(ms, "deck:stimulation"); }, 90);
    return () => window.clearTimeout(timer);
  }, [t, jobStart]);
  const drive = (patch: Partial<typeof clock>) => { driven.current = true; setClock((c) => ({ ...c, ...patch })); };

  const value = result?.value ?? null;
  const events = useMemo(() => (value?.events ?? []).filter((e) => e.tS <= t), [value, t]);
  const all = value?.events ?? [];
  const mags = events.map((e) => Math.round(e.mw * 10) / 10);
  const mc = mags.length ? completeness(mags) : NaN;
  const b = mags.length >= 30 ? bValue(mags, mc) : null;
  const pumped = stages.reduce((sum, s) => sum + s.rateM3s * Math.max(0, Math.min(t, s.endS) - s.startS), 0), planned = stages.reduce((sum, s) => sum + s.rateM3s * (s.endS - s.startS), 0);
  const sigma = b && Number.isFinite(b.b) && pumped > 0 ? seismogenicIndex(mags.filter((m) => m >= mc).length, pumped, b.b, mc) : null;
  const maxMw = events.reduce((m, e) => Math.max(m, e.mw), -Infinity);
  const light = trafficLight(Number.isFinite(maxMw) ? maxMw : -9, inputs.amber, inputs.red);
  const firstOver = (threshold: number) => all.find((e) => e.mw >= threshold) ?? null;
  const amberAt = firstOver(inputs.amber), redAt = firstOver(inputs.red);
  const pRed = sigma !== null && b ? exceedance(sigma, b.b, inputs.red, Math.max(0, planned - pumped)) : null;

  useEffect(() => {
    stimulationView.set({
      tS: t, model: events.map((e) => ({ x: e.x, y: e.y, z: e.z, mw: e.mw, colour: stageColour(e.stage) })), observed: seen.map((e) => ({ x: e.x, y: e.y, z: e.z, mw: e.mw })),
      observedLabel: observed ? observed.synthetic ? "Catalogue (synthetic QuakeML)" : `Catalogue (${observed.name})` : null,
      stages: STAGES_2022.filter((s) => inputs.stages[s.id]).map((s) => ({ id: s.id, label: s.label, colour: s.colour, topMdM: s.topFt * 0.3048, baseMdM: s.baseFt * 0.3048 })),
    });
  }, [events, seen, observed, t, inputs.stages]);

  /**
   * Match the model to the catalogue as a monitoring team would: SHmax from the cloud's long axis in
   * plan, then the diffusivity whose model front reads like the catalogue's front (stage 1, the same
   * envelope fit on both), from runs at eight diffusivities in the worker.
   */
  const match = async () => {
    if (!observed || !openHole || !stages.length) return;
    const s1 = stages.find((s) => s.id === "1") ?? stages[0]!;
    const axis = cloudAxis(aboutStages(observed.events, stages));
    const frontOf = (list: readonly { tS: number; x: number; y: number; z: number }[]) => frontDiffusivity(list.filter((e) => e.tS >= s1.startS && e.tS <= s1.endS * 11).map((e) => ({ tS: e.tS - s1.startS, r: Math.hypot(e.x - s1.center.x, e.y - s1.center.y, e.z - s1.center.z) })));
    const target = frontOf(observed.events);
    if (!Number.isFinite(target)) { setMatching("The catalogue has too few events at stage 1 to read a front."); return; }
    const azimuth = axis ? Math.round(axis.azimuthDeg / 5) * 5 : inputs.shmaxAzimuthDeg;
    const candidates = [0.015, 0.025, 0.04, 0.06, 0.09, 0.13, 0.19, 0.28];
    let best = { d: inputs.diffusivity, miss: Infinity, front: NaN };
    for (const [i, d] of candidates.entries()) {
      setMatching(`Running the model at D = ${d} m²/s (${i + 1} of ${candidates.length})…`);
      const run = await compute("stimulate", stimulationJob(openHole.las, { ...inputs, diffusivity: d, shmaxAzimuthDeg: azimuth }));
      const front = frontOf(run.events), miss = Math.abs(Math.log(front / target));
      if (Number.isFinite(miss) && miss < best.miss) best = { d, miss, front };
    }
    set({ diffusivity: best.d, shmaxAzimuthDeg: azimuth });
    setMatching(`Matched: SHmax N${azimuth}°E from the long axis of each stage's cloud${axis ? ` (${axis.elongation.toFixed(1)}× longer than wide)` : ""}; D ${best.d} m²/s, whose model front (${best.front.toFixed(3)}) reads closest to the catalogue's (${target.toFixed(3)}).`);
  };

  if (error) return <p className="hz-empty">The FORGE logs did not load: {error}</p>;
  const model: PressureModel | null = job ? job.model : null;

  const lensTabs = <span className="pw-lenses" role="tablist" aria-label="Lens">
    {(["plan", "pump", "read"] as const).map((l) => <button key={l} type="button" role="tab" aria-selected={lens === l} onClick={() => setLens(l)}>{l === "plan" ? "Plan" : l === "pump" ? "Pump" : "Read"}</button>)}
  </span>;
  const clockControls = <div className="pw-unload">
    <button type="button" className="rail-button" aria-label={clock.playing ? "Pause" : "Pump"} onClick={() => drive({ u: clock.u >= 1 ? 0 : clock.u, playing: !clock.playing })}>{clock.playing ? <Pause size={13} /> : <Play size={13} />}</button>
    <input type="range" min={0} max={1} step={0.001} value={clock.u} aria-label="Job time" onChange={(event) => drive({ u: Number(event.target.value), playing: false })} />
    <button type="button" className="rail-button" aria-label="Speed" onClick={() => setClock((c) => ({ ...c, speed: c.speed >= 4 ? 1 : c.speed * 2 }))}>{clock.speed}×</button>
  </div>;
  const inspector = lens === "plan" ? <Inspector id="stimulation-plan" initial="mohr" sections={[
    { id: "mohr", title: "Stress state", summary: `SHmax N${inputs.shmaxAzimuthDeg}°E · μ ${inputs.frictionMean.toFixed(2)}`, body: <Mohr result={value} model={model} stages={stages} t={t} /> },
    { id: "assumed", title: "What is assumed", summary: inputs.mode === "fracture" ? "hydraulic fracture" : "diffusion only", body: <PlanDials inputs={inputs} set={set} /> },
  ]} />
    : lens === "pump" ? <Inspector id="stimulation-pump" initial="job" head={clockControls} sections={[
      { id: "job", title: "The job so far", summary: `${fmt(events.length)} events · ${light.light}`, body: <>
        <div className="pw-facts">
          <span><small>Pumped</small><b>{fmt(Math.round(pumped / 0.158987))}</b><em>bbl of {fmt(Math.round(planned / 0.158987))}</em></span>
          <span><small>Events</small><b>{fmt(events.length)}</b><em>{observed ? `catalogue ${fmt(seen.length)} · ` : ""}Mc {Number.isFinite(mc) ? mc.toFixed(1) : "–"}</em></span>
          <span><small>b-value</small><b>{b ? b.b.toFixed(2) : "–"}</b><em>{b ? `± ${b.sigma.toFixed(2)}, ${b.n} events` : "needs 30 events"}</em></span>
          <span><small>Seismogenic index</small><b>{sigma !== null ? sigma.toFixed(1) : "–"}</b><em>Σ, Shapiro</em></span>
        </div>
        <p className={`st-response is-${light.light}`}><b>{light.response}</b>{redAt ? ` · red at ${hours(redAt.tS)} into the job (${stageLabel(redAt.stage)})` : amberAt ? ` · amber at ${hours(amberAt.tS)} (${stageLabel(amberAt.stage)})` : " · the model stays green"}
          {pRed !== null && ` · P(Mw ≥ ${inputs.red} in the volume still to pump) ${(pRed * 100).toFixed(pRed < 0.1 ? 1 : 0)}%`}</p>
      </> },
      { id: "limits", title: "Rate and traffic light", summary: `amber ${inputs.amber.toFixed(1)} · red ${inputs.red.toFixed(1)}`, body: <div className="pw-dials">
        <Dial label="Rate, × reported" value={inputs.rateScale} min={0.25} max={2} step={0.05} tone="#f59e0b" show={(v) => v.toFixed(2)} onChange={(rateScale) => set({ rateScale })} />
        <Dial label="Diffusivity, m²/s" value={Math.log10(inputs.diffusivity)} min={-3} max={0} step={0.05} tone="#38bdf8" show={(v) => (10 ** v).toFixed(v < -1.5 ? 3 : 2)} onChange={(v) => set({ diffusivity: 10 ** v })} />
        <Dial label="Amber at Mw" value={inputs.amber} min={-0.5} max={2.5} step={0.1} tone="#fbbf24" show={(v) => v.toFixed(1)} onChange={(amber) => set({ amber, red: Math.max(inputs.red, amber + 0.1) })} />
        <Dial label="Red at Mw" value={inputs.red} min={0} max={3} step={0.1} tone="#f87171" show={(v) => v.toFixed(1)} onChange={(red) => set({ red, amber: Math.min(inputs.amber, red - 0.1) })} />
      </div> },
      { id: "stages", title: "Stages", summary: `${STAGES_2022.filter((x) => inputs.stages[x.id]).length} of ${STAGES_2022.length} pumped`, body: <div className="pw-cases st-stages" role="group" aria-label="Stages">
        {STAGES_2022.map((x) => <button key={x.id} type="button" role="checkbox" aria-checked={!!inputs.stages[x.id]} onClick={() => set({ stages: { ...inputs.stages, [x.id]: !inputs.stages[x.id] } })} style={{ ["--tint" as string]: x.colour }}>
          <small>{x.label}</small><b>{fmt(x.volumeBbl)} bbl</b><em>{x.rateBpm} bpm · {fmt(x.topFt)}–{fmt(x.baseFt)} ft MD</em></button>)}
      </div> },
    ]} />
    : <Inspector id="stimulation-read" initial="catalogue" sections={[
      { id: "catalogue", title: "Catalogue against the model", summary: observed ? `${fmt(seen.length)} of ${fmt(observed.events.length)}` : "–", body: <CatalogueCard observed={observed} own={catalogue.own} error={catalogue.error} seen={seen} events={events} stages={stages} matching={matching} onMatch={() => { void match(); }} inputs={inputs} /> },
      { id: "charts", title: "Front and magnitudes", summary: b ? `b ${b.b.toFixed(2)}` : "–", body: <ReadSide events={events} all={all} seen={seen} stages={stages} model={model} mc={mc} b={b} /> },
    ]} />;
  return <Frame name="stimulation" className="st" title="Stimulation · FORGE 16A(78)-32" subtitle={`April 2022 schedule, 16A's stresses and fracture intensity · ${busy ? "computing…" : `${fmt(all.length)} events in the model`}`}
    tools={<>{lensTabs}<span className={`pw-badge${observed?.synthetic ? " is-synthetic" : ""}`} title={observed ? observed.description || observed.name : catalogue.error ?? "Loading the catalogue…"}>{observed ? observed.synthetic ? "Synthetic catalogue" : "Catalogue" : "Model"}<small>{observed ? `QuakeML · ${fmt(observed.events.length)} events` : catalogue.error ? "catalogue did not load" : "loading catalogue…"}</small></span></>}
    numbers={<>
      <span className={`st-light is-${light.light}`} title={light.response}><i /><span><b>{light.light}</b><small>max Mw {Number.isFinite(maxMw) ? maxMw.toFixed(1) : "–"}</small></span></span>
      <span><small>Events</small><b>{fmt(events.length)}</b></span>
      <span><small>b</small><b>{b ? b.b.toFixed(2) : "–"}</b></span>
    </>}
    canvas={<Scene result={value} events={events} observed={seen} stages={stages} model={model} t={t} lens={lens} inputs={inputs} cursorMdM={wire.cursor} onPin={wire.pin} />}
    inspector={inspector}
    strip={<JobStrip windows={windows} events={all} observed={observed?.events ?? []} u={clock.u} span={span} onU={(u) => drive({ u, playing: false })} red={inputs.red} amber={inputs.amber} />}
    status={<Status items={[
      "Drag to orbit · wheel to zoom · double-click to reset",
      "Stresses and fracture intensity from 16A's logs; SHmax, the fracture sets, diffusivity and stress drop assumed or matched",
      observed?.synthetic ? "Synthetic QuakeML catalogue from a hidden model: load FORGE's (Geo-Energie Suisse, GDR) in Read" : observed ? `Catalogue ${observed.name}` : null,
    ]} />} />;
}

/** Events as offsets from the stage that was pumping (or last pumped) when each happened: the cloud's shape, not the well's. */
const aboutStages = (list: readonly { readonly tS: number; readonly x: number; readonly y: number }[], stages: readonly Stage[]) => list.flatMap((e) => {
  const s = [...stages].sort((a, b) => b.startS - a.startS).find((x) => x.startS <= e.tS);
  return s ? [{ x: e.x - s.center.x, y: e.y - s.center.y }] : [];
});

/** The catalogue beside the model: what each says, the file it came from, and the match. */
function CatalogueCard({ observed, own, error, seen, events, stages, matching, onMatch, inputs }: {
  readonly observed: ObservedCatalogue | null; readonly own: boolean; readonly error: string | null; readonly seen: readonly ObservedEvent[]; readonly events: readonly SeismicEvent[];
  readonly stages: readonly Stage[]; readonly matching: string | null; readonly onMatch: () => void; readonly inputs: StimulationInputs;
}) {
  const input = useRef<HTMLInputElement>(null);
  const stat = (list: readonly { mw: number; x: number; y: number; tS: number }[]) => {
    const mags = list.map((e) => Math.round(e.mw * 10) / 10), mc = mags.length ? completeness(mags) : NaN, b = mags.length >= 30 ? bValue(mags, mc) : null, axis = cloudAxis(aboutStages(list, stages));
    return { n: list.length, max: list.reduce((m, e) => Math.max(m, e.mw), -Infinity), b, axis };
  };
  const m = stat(events), o = stat(seen);
  const cell = (v: number | null | undefined, digits: number) => v === null || v === undefined || !Number.isFinite(v) ? "–" : v.toFixed(digits);
  return <section className="nodal-card st-cat">
    <header><small>{observed ? `${observed.synthetic ? "synthetic stand-in" : observed.name} · QuakeML 1.2 · ${observed.magnitudeTypes.join(", ")}` : error ?? "loading…"}</small></header>
    {observed && <table className="nodal-table st-compare">
      <thead><tr><th /><th>Model</th><th>Catalogue</th></tr></thead>
      <tbody>
        <tr><td>Events so far</td><td>{fmt(m.n)}</td><td>{fmt(o.n)}</td></tr>
        <tr><td>Largest, Mw</td><td>{cell(m.max, 1)}</td><td>{cell(o.max, 1)}</td></tr>
        <tr><td>b-value</td><td>{cell(m.b?.b, 2)}</td><td>{cell(o.b?.b, 2)}</td></tr>
        <tr><td>Long axis, about each stage</td><td>{m.axis ? `N${Math.round(m.axis.azimuthDeg)}°E` : "–"}</td><td>{o.axis ? `N${Math.round(o.axis.azimuthDeg)}°E` : "–"}</td></tr>
      </tbody>
    </table>}
    <div className="pw-actions">
      <button type="button" className="tie-button is-primary" disabled={!observed || matching?.startsWith("Running") === true} onClick={onMatch}><Wand2 size={11} /> Match to the catalogue</button>
      <button type="button" className="tie-button" onClick={() => input.current?.click()}><FileUp size={11} /> Load QuakeML…</button>
      {own && <button type="button" className="tie-button" onClick={() => { void loadOwn("catalogue", null); }}>Back to the stand-in</button>}
      <input ref={input} type="file" accept=".xml,.qml,.quakeml" hidden onChange={(event) => { const f = event.target.files?.[0]; if (f) void loadOwn("catalogue", f); event.target.value = ""; }} />
    </div>
    {matching && <p className="nodal-hint">{matching}</p>}
    <p className="nodal-hint">Set now: SHmax N{inputs.shmaxAzimuthDeg}°E, D {inputs.diffusivity.toFixed(3)} m²/s. Rings in the scene are the catalogue&apos;s events, at their located positions.</p>
  </section>;
}

const hours = (s: number) => s < 86400 ? `${(s / 3600).toFixed(1)} h` : `day ${Math.floor(s / 86400) + 1}, ${((s % 86400) / 3600).toFixed(1)} h`;
const stageLabel = (id: string) => STAGES_2022.find((s) => s.id === id)?.label ?? `stage ${id}`;

/** Plan: the stress state and the fractures on the Mohr circle; dials for what is assumed. */
function PlanDials({ inputs, set }: { readonly inputs: StimulationInputs; readonly set: (p: Partial<StimulationInputs>) => void }) {
  return <>
    <div className="pw-dials">
      <Dial label="SHmax ratio" value={inputs.shmaxRatio} min={0} max={1} step={0.05} tone="#a78bfa" sub="0 Shmin · 1 Sv" show={(v) => v.toFixed(2)} onChange={(shmaxRatio) => set({ shmaxRatio })} />
      <Dial label="SHmax azimuth, °" value={inputs.shmaxAzimuthDeg} min={0} max={180} step={5} tone="#a78bfa" show={(v) => `N${v}°E`} onChange={(shmaxAzimuthDeg) => set({ shmaxAzimuthDeg })} />
      <Dial label="Friction μ" value={inputs.frictionMean} min={0.3} max={0.9} step={0.02} tone="#38bdf8" show={(v) => v.toFixed(2)} onChange={(frictionMean) => set({ frictionMean })} />
      <Dial label="Net pressure, psi" value={inputs.netPressurePsi} min={0} max={1500} step={25} tone="#f59e0b" show={(v) => fmt(v)} onChange={(netPressurePsi) => set({ netPressurePsi })} />
      <Dial label="Fluid efficiency" value={inputs.efficiency} min={0.05} max={0.8} step={0.05} tone="#f59e0b" show={(v) => v.toFixed(2)} onChange={(efficiency) => set({ efficiency })} />
      <Dial label="Stress drop, MPa" value={inputs.stressDropMPa} min={0.1} max={10} step={0.1} tone="#f472b6" show={(v) => v.toFixed(1)} onChange={(stressDropMPa) => set({ stressDropMPa })} />
    </div>
    <div className="pw-actions">
      <button type="button" className={`tie-button${inputs.mode === "fracture" ? " is-primary" : ""}`} onClick={() => set({ mode: "fracture" })}>Hydraulic fracture</button>
      <button type="button" className={`tie-button${inputs.mode === "point" ? " is-primary" : ""}`} onClick={() => set({ mode: "point" })}>Diffusion only</button>
      <button type="button" className="tie-button" onClick={() => set(defaultStimulation)}><RotateCcw size={11} /> Defaults</button>
    </div>
  </>;
}

/**
 * The Mohr diagram at the stages' depth: the three circles of effective stress, the failure line
 * τ = μσ', and the fractures as points. As the pressure rises each fracture's point moves left by
 * the rise where it is; those that reach the line have slipped.
 */
function Mohr({ result, model, stages, t }: { readonly result: Result | null; readonly model: PressureModel | null; readonly stages: readonly Stage[]; readonly t: number }) {
  const [box, size] = useSize<HTMLDivElement>();
  const risers = useMemo(() => model ? stages.map((stage) => stageRiser(model, stage)) : [], [model, stages]);
  const W = Math.max(240, size.width - 16), H = 170, m = { l: 34, r: 8, t: 10, b: 24 };
  if (!result || !model) return <section className="nodal-card" ref={box}><header><b>Mohr circle</b></header><p className="nodal-hint">Computing…</p></section>;
  const z = result.fractures.length ? result.fractures.reduce((s, f) => s + f.z, 0) / result.fractures.length : 0;
  const st = stressAt(model.field, z), toMpa = (pa: number) => pa / 1e6;
  const s1 = toMpa(st.sv - st.pp), s2 = toMpa(st.sH - st.pp), s3 = toMpa(st.sh - st.pp);
  const x = scaleLinear().domain([0, s1 * 1.05]).range([m.l, W - m.r]), y = scaleLinear().domain([0, (s1 - s3) / 2 * 1.25]).range([H - m.b, m.t]);
  const circle = (a: number, c: number) => { const cx = (a + c) / 2, r = Math.abs(a - c) / 2; return `M${x(cx - r)},${y(0)} A${x(cx + r) - x(cx)},${y(0) - y(r)} 0 0 1 ${x(cx + r)},${y(0)}`; };
  const mu = result.fractures.length ? result.fractures.reduce((s, f) => s + f.mu, 0) / result.fractures.length : 0.6;
  const slipped = new Set(result.events.filter((e) => e.tS <= t).map((e) => e.fracture));
  const sample = result.fractures.filter((_, i) => i % Math.max(1, Math.floor(result.fractures.length / 700)) === 0 || slipped.has(i)).slice(0, 1400);
  const riseOf = (f: Fracture) => risers.reduce((sum, r) => sum + r(f, t), 0);
  return <section className="nodal-card st-mohr" ref={box}>
    <header><b>Mohr circle</b><small>effective stress at the stages · points move left as the pressure reaches them</small></header>
    <svg width={W} height={H}>
      {x.ticks(5).map((v) => <text key={v} x={x(v)} y={H - 8} textAnchor="middle" className="vol-tick">{v}</text>)}
      {y.ticks(3).map((v) => <g key={v}><line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} className="nodal-grid" /><text x={m.l - 4} y={y(v) + 3} textAnchor="end" className="vol-tick">{v}</text></g>)}
      <text x={W - m.r} y={m.t + 8} textAnchor="end" className="vol-tick">σ′n, τ in MPa</text>
      <path d={circle(s1, s3)} className="st-circle" /><path d={circle(s1, s2)} className="st-circle is-inner" /><path d={circle(s2, s3)} className="st-circle is-inner" />
      <line x1={x(0)} y1={y(0)} x2={x(s1 * 1.05)} y2={y(mu * s1 * 1.05)} className="st-failure" />
      {sample.map((f) => { const i = result.fractures.indexOf(f), on = slipped.has(i), sn = toMpa(f.sigmaN - f.pp - riseOf(f)), tau = toMpa(f.tau); return <circle key={i} cx={x(Math.max(0, sn))} cy={y(tau)} r={on ? 2.6 : 1.4} className={on ? "st-pt is-slipped" : "st-pt"} />; })}
    </svg>
  </section>;
}
/** Read: the triggering front, Gutenberg–Richter and the rate against volume. */
function ReadSide({ events, all, seen, stages, model, mc, b }: { readonly events: readonly SeismicEvent[]; readonly all: readonly SeismicEvent[]; readonly seen: readonly ObservedEvent[]; readonly stages: readonly Stage[]; readonly model: PressureModel | null; readonly mc: number; readonly b: ReturnType<typeof bValue> | null }) {
  const [box, size] = useSize<HTMLDivElement>();
  const W = Math.max(240, size.width - 16), H = 150, m = { l: 38, r: 8, t: 8, b: 22 };
  const pts = events.map((e) => { const s = stages.find((x) => x.id === e.stage)!; return { e, t: (e.tS - s.startS) / 3600, r: Math.hypot(e.x - s.center.x, e.y - s.center.y, e.z - s.center.z) }; });
  const D = frontDiffusivity(pts.map((p) => ({ tS: p.t * 3600, r: p.r })));
  // The catalogue's events, each against the stage pumping (or last pumped) when it happened.
  const seenPts = seen.map((e) => { const s = [...stages].reverse().find((x) => x.startS <= e.tS) ?? stages[0]; return s ? { t: (e.tS - s.startS) / 3600, r: Math.hypot(e.x - s.center.x, e.y - s.center.y, e.z - s.center.z), id: s.id } : null; }).filter((p) => p !== null);
  const tMax = Math.max(1, ...pts.map((p) => p.t), ...seenPts.map((p) => p.t)), rMax = Math.max(50, ...pts.map((p) => p.r), ...seenPts.map((p) => p.r));
  const x = scaleLinear().domain([0, tMax]).range([m.l, W - m.r]), y = scaleLinear().domain([0, rMax * 1.05]).range([H - m.b, m.t]);
  const front = Number.isFinite(D) ? Array.from({ length: 40 }, (_, i) => { const tt = tMax * (i + 1) / 40; return `${i ? "L" : "M"}${x(tt)},${y(Math.min(rMax * 1.05, Math.sqrt(4 * Math.PI * D * tt * 3600)))}`; }).join("") : "";
  // Gutenberg–Richter: log N(≥M).
  const mags = [...events.map((e) => e.mw)].sort((a, c) => a - c), Ms = Array.from({ length: 31 }, (_, i) => -2 + i * 0.15);
  const counts = Ms.map((M) => ({ M, n: mags.filter((v) => v >= M).length })).filter((c) => c.n > 0);
  const gx = scaleLinear().domain([-2, 2.5]).range([m.l, W - m.r]), gy = scaleLinear().domain([0, Math.max(1, Math.log10(Math.max(1, mags.length)) + 0.3)]).range([H - m.b, m.t]);
  const nAtMc = mags.filter((v) => v >= mc).length;
  const seenMags = seen.map((e) => e.mw), seenCounts = Ms.map((M) => ({ M, n: seenMags.filter((v) => v >= M).length })).filter((c) => c.n > 0);
  return <>
    <section className="nodal-card" ref={box}>
      <header><b>Triggering front</b><small>distance from the stage against time · r = √(4πDt), D {Number.isFinite(D) ? D.toFixed(3) : "–"} m²/s{model ? ` (set ${model.diffusivity.toFixed(3)})` : ""}{seenPts.length ? " · catalogue ○" : ""}</small></header>
      <svg width={W} height={H}>
        {y.ticks(3).map((v) => <g key={v}><line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} className="nodal-grid" /><text x={m.l - 4} y={y(v) + 3} textAnchor="end" className="vol-tick">{fmt(v)}</text></g>)}
        {x.ticks(4).map((v) => <text key={v} x={x(v)} y={H - 6} textAnchor="middle" className="vol-tick">{v} h</text>)}
        {pts.map((p, i) => <circle key={i} cx={x(p.t)} cy={y(p.r)} r={1.8} style={{ fill: stageColour(p.e.stage) }} />)}
        {seenPts.map((p, i) => <circle key={`o${i}`} cx={x(p.t)} cy={y(p.r)} r={2.6} className="st-obs" style={{ stroke: stageColour(p.id) }} />)}
        {front && <path d={front} className="st-front" />}
      </svg>
    </section>
    <section className="nodal-card">
      <header><b>Gutenberg–Richter</b><small>log N(≥M) · model ● b {b ? `${b.b.toFixed(2)} ± ${b.sigma.toFixed(2)}` : "–"} above Mc {Number.isFinite(mc) ? mc.toFixed(1) : "–"}{seen.length ? " · catalogue ■" : ""}</small></header>
      <svg width={W} height={H}>
        {gy.ticks(3).map((v) => <g key={v}><line x1={m.l} x2={W - m.r} y1={gy(v)} y2={gy(v)} className="nodal-grid" /><text x={m.l - 4} y={gy(v) + 3} textAnchor="end" className="vol-tick">{10 ** v >= 1 ? fmt(Math.round(10 ** v)) : ""}</text></g>)}
        {gx.ticks(5).map((v) => <text key={v} x={gx(v)} y={H - 6} textAnchor="middle" className="vol-tick">{v}</text>)}
        {counts.map((c) => <circle key={c.M} cx={gx(c.M)} cy={gy(Math.log10(c.n))} r={2.5} className="st-gr" />)}
        {seenCounts.map((c) => <rect key={`o${c.M}`} x={gx(c.M) - 2.6} y={gy(Math.log10(c.n)) - 2.6} width={5.2} height={5.2} className="st-gr-obs" />)}
        {b && Number.isFinite(b.b) && <line x1={gx(mc)} y1={gy(Math.log10(nAtMc))} x2={gx(2.5)} y2={gy(Math.max(0, Math.log10(nAtMc) - b.b * (2.5 - mc)))} className="st-front" />}
        {Number.isFinite(mc) && <line x1={gx(mc)} x2={gx(mc)} y1={m.t} y2={H - m.b} className="vol-mark" />}
      </svg>
    </section>
    <p className="nodal-hint">{all.length} events in the whole job; the b-value comes out of the fracture sizes (n(r) ∝ r⁻³ gives b ≈ 1), not set. The fitted D is Shapiro&apos;s envelope, a lower bound on the rock&apos;s diffusivity.</p>
  </>;
}

/** The job: each stage's window side by side, its rate and its events by magnitude; the playhead. */
function JobStrip({ windows, events, observed, u, span, onU, red, amber }: { readonly windows: readonly { stage: Stage; from: number; to: number }[]; readonly events: readonly SeismicEvent[]; readonly observed: readonly ObservedEvent[]; readonly u: number; readonly span: number; readonly onU: (u: number) => void; readonly red: number; readonly amber: number }) {
  const [box, size] = useSize<HTMLDivElement>();
  const W = Math.max(320, size.width - 12), H = 92, m = { l: 34, r: 6, t: 8, b: 16 };
  const y = scaleLinear().domain([-2, Math.max(1.5, red + 0.3)]).range([H - m.b, m.t]);
  let acc = 0;
  const cols = windows.map((w) => { const x0 = m.l + acc / span * (W - m.l - m.r); acc += w.to - w.from; return { ...w, x0, x1: m.l + acc / span * (W - m.l - m.r) }; });
  const xOf = (stage: string, t: number) => { const c = cols.find((col) => col.stage.id === stage); return c ? c.x0 + (t - c.from) / (c.to - c.from) * (c.x1 - c.x0) : -10; };
  /** A time anywhere: in a stage's window, or -10 (off the strip) between them. */
  const xAt = (t: number) => { const c = cols.find((col) => t >= col.from && t <= col.to); return c ? c.x0 + (t - c.from) / (c.to - c.from) * (c.x1 - c.x0) : -10; };
  const drag = useRef(false);
  const at = (event: ReactPointerEvent<SVGSVGElement>) => Math.max(0, Math.min(1, (event.clientX - event.currentTarget.getBoundingClientRect().left - m.l) / (W - m.l - m.r)));
  return <div className="pw-life st-strip" ref={box}>
    <svg width={W} height={H} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = true; onU(at(event)); }} onPointerMove={(event) => { if (drag.current) onU(at(event)); }} onPointerUp={() => { drag.current = false; }}>
      {[-1, 0, 1, 2].filter((v) => v <= red + 0.3).map((v) => <g key={v}><line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} className="nodal-grid" /><text x={m.l - 4} y={y(v) + 3} textAnchor="end" className="vol-tick">M{v}</text></g>)}
      <line x1={m.l} x2={W - m.r} y1={y(amber)} y2={y(amber)} className="st-amber" /><line x1={m.l} x2={W - m.r} y1={y(red)} y2={y(red)} className="st-red" />
      {cols.map((c) => <g key={c.stage.id}>
        <rect x={xOf(c.stage.id, c.stage.startS)} y={H - m.b - 4} width={Math.max(2, xOf(c.stage.id, c.stage.endS) - xOf(c.stage.id, c.stage.startS))} height={4} style={{ fill: stageColour(c.stage.id) }} />
        <line x1={c.x1} x2={c.x1} y1={m.t} y2={H - m.b} className="st-gap" />
        <text x={(c.x0 + c.x1) / 2} y={H - 3} textAnchor="middle" className="vol-tick">{c.stage.label}</text>
      </g>)}
      {events.map((e, i) => <line key={i} x1={xOf(e.stage, e.tS)} x2={xOf(e.stage, e.tS)} y1={y(-2)} y2={y(e.mw)} style={{ stroke: stageColour(e.stage) }} className="st-stem" />)}
      {observed.map((e, i) => { const xx = xAt(e.tS); return xx < 0 ? null : <circle key={`o${i}`} cx={xx} cy={y(e.mw)} r={2.2} className="st-obs-dot" />; })}
      <g transform={`translate(${m.l + u * (W - m.l - m.r)},0)`} className="pw-playhead"><line y1={m.t - 4} y2={H - m.b} /><path d={`M-5,${m.t - 8} L5,${m.t - 8} L0,${m.t - 1} Z`} /></g>
    </svg>
  </div>;
}

/**
 * The scene: the toe of 16A in 3D, orbited with the pointer and zoomed with the wheel. Wells as
 * lines, the stages in their colours, each stage's hydraulic fracture as a disc along SHmax growing
 * with the volume pumped and its pressure envelope around it, and the events as spheres sized by
 * magnitude, newest brightest. In Plan, the natural fractures near the stages, coloured by how much
 * pressure they need to slip.
 */
function Scene({ result, events, observed, stages, model, t, lens, inputs, cursorMdM, onPin }: {
  readonly result: Result | null; readonly events: readonly SeismicEvent[]; readonly observed: readonly ObservedEvent[]; readonly stages: readonly Stage[]; readonly model: PressureModel | null; readonly t: number;
  readonly lens: Lens; readonly inputs: StimulationInputs; readonly cursorMdM: number | null; readonly onPin: (md: number | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef({ yaw: -0.9, pitch: 0.35, zoom: 1, drag: null as null | { x: number; y: number; yaw: number; pitch: number } });
  const live = useRef({ result, events, observed, stages, model, t, lens, inputs, cursorMdM });
  live.current = { result, events, observed, stages, model, t, lens, inputs, cursorMdM };
  useEffect(() => {
    const el = canvas.current, ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    let w = 0, h = 0, frame = 0;
    const resize = () => { const b = el.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1); w = Math.max(200, b.width); h = Math.max(200, b.height); el.width = Math.round(w * dpr); el.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const { result: r, events: ev, observed: obs, stages: st, model: md, t: now, lens: ln, inputs: inp, cursorMdM: cursor } = live.current;
      const v = view.current;
      const target = st.length ? { x: st.reduce((s, a) => s + a.center.x, 0) / st.length, y: st.reduce((s, a) => s + a.center.y, 0) / st.length, z: st.reduce((s, a) => s + a.center.z, 0) / st.length } : pointAt(well16a, 3250);
      const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw), cp = Math.cos(v.pitch), sp = Math.sin(v.pitch);
      const scale = Math.min(w, h) / 900 * v.zoom;
      const project = (p: { x: number; y: number; z: number }) => {
        const dx = p.x - target.x, dy = p.y - target.y, dz = p.z - target.z;
        const xr = dx * cy - dy * sy, yr = dx * sy + dy * cy; // yaw about the vertical
        const depth = yr * cp + dz * sp, up = dz * cp - yr * sp; // pitch
        return { sx: w / 2 + xr * scale, sy: h / 2 - up * scale, depth };
      };
      // Ground: a dark field with a grid at the stages' level.
      const bg = ctx.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, "#0b1222"); bg.addColorStop(1, "#141b2e");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(148, 163, 184, 0.08)"; ctx.lineWidth = 1;
      for (let k = -6; k <= 6; k++) {
        const a = project({ x: target.x + k * 100, y: target.y - 600, z: target.z }), b = project({ x: target.x + k * 100, y: target.y + 600, z: target.z });
        const c = project({ x: target.x - 600, y: target.y + k * 100, z: target.z }), d = project({ x: target.x + 600, y: target.y + k * 100, z: target.z });
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.moveTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy); ctx.stroke();
      }
      // SHmax: arrows pressing in along its azimuth.
      const az = inp.shmaxAzimuthDeg * Math.PI / 180, ux = Math.sin(az), uy = Math.cos(az);
      for (const side of [-1, 1]) {
        const tip = project({ x: target.x + side * ux * 420, y: target.y + side * uy * 420, z: target.z }), tail = project({ x: target.x + side * ux * 560, y: target.y + side * uy * 560, z: target.z });
        ctx.strokeStyle = "#a78bfa"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(tail.sx, tail.sy); ctx.lineTo(tip.sx, tip.sy); ctx.stroke();
        const ang = Math.atan2(tip.sy - tail.sy, tip.sx - tail.sx); ctx.fillStyle = "#a78bfa"; ctx.beginPath(); ctx.moveTo(tip.sx, tip.sy); ctx.lineTo(tip.sx - 10 * Math.cos(ang - 0.4), tip.sy - 10 * Math.sin(ang - 0.4)); ctx.lineTo(tip.sx - 10 * Math.cos(ang + 0.4), tip.sy - 10 * Math.sin(ang + 0.4)); ctx.fill();
        if (side > 0) { ctx.font = "600 10.5px 'IBM Plex Sans', sans-serif"; ctx.textAlign = "left"; ctx.fillText(`SHmax N${inp.shmaxAzimuthDeg}°E`, tail.sx + 6, tail.sy); }
      }
      // Natural fractures (Plan): near the stages, coloured by the pressure they need.
      if (ln === "plan" && r) {
        const step = Math.max(1, Math.floor(r.fractures.length / 2500));
        for (let i = 0; i < r.fractures.length; i += step) {
          const f = r.fractures[i]!, near = Math.hypot(f.x - target.x, f.y - target.y, f.z - target.z);
          if (near > 380) continue;
          const p = project(f), need = Math.min(1, f.criticalPa / 20e6);
          ctx.fillStyle = `hsla(${need * 220}, 85%, 60%, 0.55)`; ctx.fillRect(p.sx - 1, p.sy - 1, 2, 2);
        }
      }
      // Wells.
      const drawWell = (pts: readonly PathPoint[], colour: string, label: string, width: number) => {
        const near = pts.filter((p) => p.z < target.z + 900);
        if (near.length < 2) return;
        ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.beginPath();
        near.forEach((p, i) => { const s = project(p); if (i) ctx.lineTo(s.sx, s.sy); else ctx.moveTo(s.sx, s.sy); }); ctx.stroke();
        const end = project(near.at(-1)!); ctx.fillStyle = colour; ctx.font = "600 11px 'IBM Plex Sans', sans-serif"; ctx.textAlign = "left"; ctx.fillText(label, end.sx + 6, end.sy + 4);
      };
      drawWell(well16a, "#e2e8f0", "16A(78)-32", 2.5);
      for (const n of neighbours) drawWell(n.points, n.id === "16b" ? "#22d3ee" : "#c4b5fd", n.label, 1.8);
      // The depth cursor on 16A.
      if (cursor !== null) { const c = project(pointAt(well16a, cursor)); ctx.fillStyle = "#f472b6"; ctx.beginPath(); ctx.arc(c.sx, c.sy, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillText(`${Math.round(cursor).toLocaleString()} m`, c.sx + 7, c.sy - 6); }
      // Each stage: its interval, its hydraulic fracture disc and the pressure envelope around it.
      for (const s of st) {
        const def = STAGES_2022.find((x) => x.id === s.id)!, a = project(pointAt(well16a, def.topFt * 0.3048)), b = project(pointAt(well16a, def.baseFt * 0.3048));
        ctx.strokeStyle = def.colour; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
        if (!md || now <= s.startS) continue;
        const radius = md.mode === "fracture" ? fractureRadius(md, s, now) : 0;
        const envelope = radius + 2 * Math.sqrt(md.diffusivity * Math.max(0, Math.min(now, s.endS + 10 * (s.endS - s.startS)) - s.startS));
        const ring = (rr: number) => Array.from({ length: 49 }, (_, k) => { const th = k / 48 * Math.PI * 2; return project({ x: s.center.x + ux * Math.cos(th) * rr, y: s.center.y + uy * Math.cos(th) * rr, z: s.center.z + Math.sin(th) * rr }); });
        if (envelope > 1) { ctx.fillStyle = `${def.colour}14`; ctx.strokeStyle = `${def.colour}55`; ctx.lineWidth = 1; ctx.beginPath(); ring(envelope).forEach((p, k) => k ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)); ctx.closePath(); ctx.fill(); ctx.stroke(); }
        if (radius > 1) { const pumping = now < s.endS; ctx.fillStyle = `${def.colour}${pumping ? "55" : "30"}`; ctx.strokeStyle = def.colour; ctx.lineWidth = pumping ? 1.8 : 1; ctx.beginPath(); ring(radius).forEach((p, k) => k ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      }
      // Events, far first, sized by magnitude; the newest flash.
      const shown = ev.map((e) => ({ e, p: project(e) })).sort((a, b) => b.p.depth - a.p.depth);
      for (const { e, p } of shown) {
        const age = now - e.tS, fresh = Math.max(0, 1 - age / 1800), size = Math.max(1.6, 2.2 * 10 ** (0.25 * (e.mw + 1)));
        if (fresh > 0) { ctx.fillStyle = `rgba(255, 255, 255, ${0.35 * fresh})`; ctx.beginPath(); ctx.arc(p.sx, p.sy, size * (1 + 2 * fresh), 0, Math.PI * 2); ctx.fill(); }
        const g = ctx.createRadialGradient(p.sx - size * 0.3, p.sy - size * 0.3, size * 0.1, p.sx, p.sy, size);
        g.addColorStop(0, "#ffffff"); g.addColorStop(0.35, stageColour(e.stage)); g.addColorStop(1, "rgba(0,0,0,0.6)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.sx, p.sy, size, 0, Math.PI * 2); ctx.fill();
        if (e.mw >= inp.amber) { ctx.strokeStyle = e.mw >= inp.red ? "#f87171" : "#fbbf24"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.sx, p.sy, size + 3, 0, Math.PI * 2); ctx.stroke(); }
      }
      // The catalogue's events: open rings at their located positions, the newest brightest.
      for (const e of obs) {
        const p = project(e), age = now - e.tS, fresh = Math.max(0, 1 - age / 1800), size = Math.max(2.4, 2.6 * 10 ** (0.25 * (e.mw + 1)));
        ctx.strokeStyle = `rgba(226, 232, 240, ${0.55 + 0.45 * fresh})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(p.sx, p.sy, size, 0, Math.PI * 2); ctx.stroke();
      }
      // Compass.
      const o = { x: 46, y: h - 46 }, axes = [{ v: { x: target.x + 60, y: target.y, z: target.z }, l: "E" }, { v: { x: target.x, y: target.y + 60, z: target.z }, l: "N" }, { v: { x: target.x, y: target.y, z: target.z + 60 }, l: "Up" }];
      const c0 = project(target);
      for (const a of axes) { const p = project(a.v); const dx = (p.sx - c0.sx) / (60 * scale) * 26, dy = (p.sy - c0.sy) / (60 * scale) * 26; ctx.strokeStyle = "rgba(226,232,240,0.7)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + dx, o.y + dy); ctx.stroke(); ctx.fillStyle = "rgba(226,232,240,0.9)"; ctx.font = "600 10px 'IBM Plex Sans', sans-serif"; ctx.textAlign = "center"; ctx.fillText(a.l, o.x + dx * 1.25, o.y + dy * 1.25 + 3); }
      ctx.fillStyle = "rgba(226,232,240,0.55)"; ctx.font = "500 10px 'IBM Plex Sans', sans-serif"; ctx.textAlign = "right"; ctx.fillText(hours(now), w - 10, h - 10);
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);
  return <canvas ref={canvas} className="st-canvas" aria-label="The stimulation in 3D: drag to orbit, wheel to zoom"
    onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); const v = view.current; v.drag = { x: event.clientX, y: event.clientY, yaw: v.yaw, pitch: v.pitch }; }}
    onPointerMove={(event) => { const v = view.current; if (!v.drag) return; v.yaw = v.drag.yaw + (event.clientX - v.drag.x) / 160; v.pitch = Math.max(-1.4, Math.min(1.4, v.drag.pitch + (event.clientY - v.drag.y) / 200)); }}
    onPointerUp={() => { view.current.drag = null; }}
    onWheel={(event) => { const v = view.current; v.zoom = Math.max(0.3, Math.min(6, v.zoom * Math.exp(-event.deltaY / 600))); }}
    onDoubleClick={() => { Object.assign(view.current, { yaw: -0.9, pitch: 0.35, zoom: 1 }); onPin(null); }} />;
}
