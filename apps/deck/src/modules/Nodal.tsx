import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import { useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";
import { CORRELATIONS, pressureAtDate } from "@ikhmalputra/subsurface-core/production";
import type { LabPvt, ProductionMonth, WellTest } from "@ikhmalputra/subsurface-core/production";
import { useDesign } from "../data/design.ts";
import { signals, useDeck } from "../deck/store.ts";
import { timeline } from "../deck/timeline.ts";
import { COMPARE_VALUES, FT_PER_M, SM3_PER_STB, casingProfile, chosenTank, defaultForecast, defaultLift, defaultNodal, forecastBand, injectionCheck, liftDesign, modelOf, runMatch, solve, tankMatch, wellCase, wellTraverse, whpForRate, conditionsOn } from "../data/nodal-model.ts";
import type { Calibration, Compare, ForecastInputs, LiftInputs, NodalInputs } from "../data/nodal-model.ts";
import { KESTREL_INJECTION_MD_M, kestrelSynthetic } from "../data/kestrel-tests.ts";
import { HistoryView, MatchView } from "./NodalMatch.tsx";
import { Performance, ValveSchedule, mandrelsMd } from "./NodalLift.tsx";
import { TankCard, WorCard, cumOil } from "./NodalForecast.tsx";
import { ProducingWell } from "./production/ProducingWell.tsx";
import { Dial, NodalInstrument, PressureLane, Slider } from "./production/controls.tsx";
import { LifeStrip } from "./production/LifeStrip.tsx";
import { sceneFlow, sceneFrame, unloadingAt } from "./production/scene.ts";
import type { SceneValve, WellScene } from "./production/scene.ts";
import { fmt } from "../format.ts";
import { useWire } from "./wire.ts";

/**
 * Production on a designed well, as the well itself: the cutaway of the producing well is the
 * surface, drawn from the design and flowing as the model says, with its pressure beside it on the
 * same depth. Four lenses on that one well: Match (the tests against the model at the gauge),
 * Operate (choke, lift gas and water by dial, or drag the operating point), Lift (the valves, and
 * the well unloading valve by valve) and Life (history and forecast, on the deck's time rail).
 * Its depth is the deck's depth cursor; its dates are the deck's time.
 */

const KEY = "deck-nodal-v1";
type Lens = "match" | "operate" | "lift" | "life";
type Drawer = "inputs" | "tests" | "valves" | "tank" | null;
type Kept = {
  readonly inputs: NodalInputs; readonly compare: Compare; readonly view?: string; readonly lens?: Lens;
  readonly tests?: readonly WellTest[]; readonly lab?: LabPvt | null; readonly synthetic?: boolean;
  /** The match, and the tests and lab it was made from (so an edit since shows it is out of date). */
  readonly calibration?: Calibration | null; readonly matchedKey?: string;
  /** The gas-lift design's inputs, and the injection depth in use (m MD; else just above the packer). */
  readonly lift?: LiftInputs; readonly injectionMdM?: number | null;
  /** Allocated monthly production; the forecast's settings and the tank picked among the matched ones (an aquifer size; null: the best fit). */
  readonly production?: readonly ProductionMonth[]; readonly forecast?: ForecastInputs; readonly tankAquifer?: number | null;
  /** Which synthetic sample this is: an older one is replaced. */
  readonly sampleVersion?: number;
  /** The test the Match lens shows, and which case the Life lens draws. */
  readonly testDate?: string; readonly lifeCase?: "natural" | "lift";
};
const SAMPLE_VERSION = 3;
function readKept(): Record<string, Kept> { try { const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Kept>; return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; } }
const okKept = (k: Kept | undefined): k is Kept => !!k && !!k.inputs && typeof k.inputs === "object" && Object.keys(defaultNodal).every((key) => key in k.inputs);
const LENS_NAME: Readonly<Record<Lens, string>> = { match: "Match", operate: "Operate", lift: "Lift", life: "Life" };
const lensOf = (k: Kept): Lens => k.lens ?? (k.view === "match" ? "match" : k.view === "lift" ? "lift" : k.view === "forecast" || k.view === "history" ? "life" : "operate");

export function Nodal() {
  const wire = useWire("nodal");
  const siteId = useDeck((deck) => deck.siteId) ?? "";
  const { brief } = useDesign();
  const [kept, setKeptState] = useState<Kept>(() => {
    const k = readKept()[siteId];
    // Kestrel A-7 comes with a synthetic test history, lab report and allocated production, so the match can be seen at work.
    const sample = () => { const synthetic = siteId === "kestrel" ? kestrelSynthetic(brief) : null; return { tests: synthetic?.tests ?? [], lab: synthetic?.lab ?? null, production: synthetic?.production ?? [], synthetic: !!synthetic, sampleVersion: SAMPLE_VERSION, ...(synthetic ? { injectionMdM: KESTREL_INJECTION_MD_M } : {}) }; };
    if (okKept(k)) return k.tests === undefined || (k.synthetic && k.sampleVersion !== SAMPLE_VERSION) ? { ...k, ...sample(), lens: "match" as const, calibration: null, tankAquifer: null } : k;
    return { inputs: defaultNodal, compare: "lift", lens: "match", ...sample(), calibration: null };
  });
  const setKept = (change: (k: Kept) => Kept) => setKeptState((current) => { const next = change(current); try { localStorage.setItem(KEY, JSON.stringify({ ...readKept(), [siteId]: next })); } catch { /* not kept */ } return next; });
  const set = (patch: Partial<NodalInputs>) => setKept((k) => ({ ...k, inputs: { ...k.inputs, ...patch } }));
  const [drawer, setDrawer] = useState<Drawer>(null);
  const lens = lensOf(kept), inputs = kept.inputs, tests = kept.tests ?? [], lab = kept.lab ?? null, production = kept.production ?? [];
  const key = JSON.stringify([tests, lab]), calibration = kept.calibration ?? null, stale = !!calibration && kept.matchedKey !== key;
  const usable = !!calibration && !stale && tests.length > 0;
  const injectionMdM = kept.injectionMdM ?? null, lift = { ...defaultLift, ...kept.lift };
  const forecastInputs = { ...defaultForecast, ...kept.forecast }, tankAquifer = kept.tankAquifer ?? null;
  const frame = useMemo(() => sceneFrame(brief), [brief]);
  const well = useMemo(() => { const w = wellCase(brief, inputs); return typeof w === "string" || injectionMdM === null || w.liftDepthMdM === null ? w : { ...w, liftDepthMdM: injectionMdM }; }, [brief, inputs, injectionMdM]);

  // ---- the match: run when asked (it tunes every correlation, about a second); its tables when the drawer opens ----
  const [matched, setMatched] = useState<{ key: string; result: ReturnType<typeof runMatch> } | null>(null);
  const result = useMemo(() => {
    if (typeof well === "string" || drawer !== "tests" || !calibration || !tests.length) return null;
    return matched?.key === key ? matched.result : runMatch(well, tests, lab);
  }, [well, drawer, calibration, tests, lab, matched, key]);
  const match = () => {
    if (typeof well === "string") return;
    const run = runMatch(well, tests, lab);
    setMatched({ key, result: run });
    const c = run.calibration;
    setKept((k) => ({ ...k, calibration: c, matchedKey: key, inputs: c ? { ...k.inputs, waterCut: c.lastTest.waterCut, whpPsi: Math.round(c.lastTest.whp - 14.7), liftMscfD: Math.round(c.lastTest.liftGasScfD / 1000), gor: c.lastTest.gor, depletion: 0 } : k.inputs }));
  };

  // ---- operate ----
  const solved = useMemo(() => typeof well === "string" ? null : solve(well, inputs, undefined, calibration), [well, inputs, calibration]);

  // ---- lift: the design a beat behind its dials, and the unloading playback ----
  const liftLater = useDeferredValue(lift);
  const designed = useMemo(() => typeof well === "string" || lens !== "lift" || well.liftDepthMdM === null ? null : liftDesign(brief, well, inputs, calibration, liftLater), [well, lens, brief, inputs, calibration, liftLater]);
  const [unload, setUnload] = useState({ t: 1, playing: false });
  useEffect(() => {
    if (!unload.playing) return;
    let frameId = 0, last = performance.now();
    const tick = (now: number) => { const dt = (now - last) / 1000; last = now; setUnload((u) => { const t = Math.min(1, u.t + dt / 9); return { t, playing: t < 1 }; }); frameId = requestAnimationFrame(tick); };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [unload.playing]);

  // ---- life: the tank matched to the build-ups, then both cases month by month across the indistinguishable tanks ----
  const tankFit = useMemo(() => typeof well === "string" || lens !== "life" || !usable ? null : tankMatch(well, tests, production, calibration!), [well, lens, usable, tests, production, calibration]);
  const later = useDeferredValue({ forecastInputs, inputs, tankAquifer });
  const cases = useMemo(() => {
    if (typeof well === "string" || !tankFit || !calibration) return null;
    const tank = chosenTank(tankFit, later.tankAquifer);
    return { tank, band: forecastBand(well, later.inputs, calibration, tests, production, tankFit, tank, later.forecastInputs) };
  }, [well, tankFit, calibration, tests, production, later]);
  const lastTest = [...tests].sort((a, b) => Date.parse(a.date) - Date.parse(b.date)).at(-1);
  const todayMs = lastTest ? Date.parse(lastTest.date) : Date.now();
  const cursorMs = useSubsurfaceSelector(signals, (state) => state.time?.cursorMs ?? null);
  // The well's life on the deck's time rail: offered whenever there is a history, with the forecast once there is one.
  useEffect(() => {
    if (!tests.length && !production.length) return;
    const run = cases ? (kept.lifeCase === "natural" || !cases.band.main.lifted ? cases.band.main.natural : cases.band.main.lifted) : null;
    const start = production[0] ? Date.parse(`${production[0].month}-01`) : Date.parse(tests[0]!.date);
    const end = Math.max(todayMs, run ? Date.parse(run.endDate) : todayMs);
    const samples = 120, oilOn = (ms: number) => {
      if (ms <= todayMs) { const c = conditionsOn(tests, new Date(ms).toISOString().slice(0, 10)); return c ? c.liquidRate * (1 - c.waterCut) : 0; }
      const step = run?.steps.find((s) => Date.parse(s.date) >= ms); return step?.oil ?? 0;
    };
    const values = Array.from({ length: samples }, (_, i) => oilOn(start + (end - start) * i / (samples - 1))), top = Math.max(1, ...values);
    timeline.set({ siteId, label: `${brief.identity.name || "This well"}'s life`, startMs: start, endMs: end, todayMs, profile: values.map((v) => v / top), marks: tests.map((t) => ({ ms: Date.parse(t.date), label: `Test ${t.date}` })) });
  }, [siteId, tests, production, cases, kept.lifeCase, todayMs, brief.identity.name]);
  useEffect(() => () => { if (timeline.get()?.siteId === siteId) timeline.set(null); }, [siteId]);

  if (typeof well === "string") return <p className="hz-empty nodal-empty">{well}</p>;
  if (!solved) return null;

  // ---- the scene for the lens ----
  const point = solved.point;
  const entry = inputs.liftMscfD > 0 ? injectionCheck(well, solved.traverse, lift) : null;
  const mandrels = mandrelsMd(brief);
  const liftOn = (mscf: number) => well.lift === "gas-lift" && mscf > 0;
  const operatingValves = (mscf: number): SceneValve[] => {
    const at = well.liftDepthMdM;
    const valves: SceneValve[] = mandrels.filter((md) => at === null || Math.abs(md - at) > 15).map((md) => ({ mdM: md, state: "dummy", label: "" }));
    if (at !== null && well.lift === "gas-lift") valves.push({ mdM: at, state: liftOn(mscf) ? "operating" : "closed", label: liftOn(mscf) ? "gas in" : "" });
    return valves;
  };
  const prOf = solved.ipr.pwf(0) ?? well.reservoir.pressure;
  const base = { ...frame, waterCut: inputs.waterCut, reservoirPsia: prOf, whpPsig: inputs.whpPsi, annulusLevelMdM: null, gaugeMdM: null, gauge: null };
  let scene: WellScene, laneLines: Parameters<typeof PressureLane>[0]["lines"] = [], lanePoints: Parameters<typeof PressureLane>[0]["points"] = [], subtitle: string;
  const tubingLine = (traverse: { points: readonly { mdFt: number; p: number }[] } | null, label: string) => ({ key: "tubing", pts: (traverse?.points ?? []).map((p) => ({ mdM: p.mdFt / FT_PER_M, psia: p.p })), className: "pw-line-tubing", label });
  const casingLine = (surfacePsig: number, toMdM: number, label: string, className = "pw-line-casing") => ({ key: `casing-${label}`, pts: casingProfile(well, surfacePsig, lift.liftGasSg, toMdM), className, label });
  const perfMid = well.midPerfMdM;

  if (lens === "match") {
    const test = tests.find((t) => t.date === kept.testDate) ?? lastTest ?? null;
    if (test) {
      const traverse = wellTraverse(well, inputs, calibration, { whpPsia: test.whp, liquidRate: test.liquidRate, waterCut: test.waterCut, gor: test.gor, liftMscfD: test.liftGasScfD / 1000 });
      const gaugeMd = test.gaugeMdFt === null ? null : test.gaugeMdFt / FT_PER_M;
      const modelAtGauge = gaugeMd === null ? null : traverse.points.reduce((best, p) => Math.abs(p.mdFt / FT_PER_M - gaugeMd) < Math.abs(best.mdFt / FT_PER_M - gaugeMd) ? p : best, traverse.points[0]!).p;
      const pr = pressureAtDate(modelOf(well), tests, test.date).pressure;
      scene = { ...base, flow: sceneFlow(traverse), waterCut: test.waterCut, liquidRate: test.liquidRate, oilRate: test.liquidRate * (1 - test.waterCut), reservoirPsia: pr, whpPsig: test.whp - 14.7, liftMscfD: test.liftGasScfD / 1000, liftMdM: well.liftDepthMdM, valves: operatingValves(test.liftGasScfD / 1000), gaugeMdM: gaugeMd, gauge: test.gaugePressure === null ? null : { measured: test.gaugePressure, model: modelAtGauge } };
      laneLines = [tubingLine(traverse, calibration ? "model, matched" : "model, assumed")];
      if (gaugeMd !== null && test.gaugePressure !== null) lanePoints = [{ key: "measured", mdM: gaugeMd, psia: test.gaugePressure, className: "pw-pt-measured", label: `gauge ${fmt(Math.round(test.gaugePressure - 14.7))}` }, ...(modelAtGauge !== null ? [{ key: "model", mdM: gaugeMd, psia: modelAtGauge, className: "pw-pt-model" }] : [])];
      lanePoints = [...lanePoints, ...(test.reservoirPressure !== null ? [{ key: "pr", mdM: perfMid, psia: test.reservoirPressure, className: "pw-pt-pr", label: "build-up" }] : [])];
      subtitle = `Test ${test.date} · ${fmt(Math.round(test.liquidRate))} STB/d at ${fmt(Math.round(test.whp - 14.7))} psig`;
    } else { scene = { ...base, flow: [], liquidRate: 0, oilRate: 0, liftMscfD: 0, liftMdM: null, valves: [] }; subtitle = "No tests yet"; }
  } else if (lens === "lift" && designed && designed.design.operating) {
    const valves = designed.design.valves, md = valves.map((v) => v.mdFt / FT_PER_M);
    const u = unloadingAt(unload.t, md, lift.kickoffPsig, valves.map((v) => v.surfaceOpeningPsig));
    const done = unload.t >= 1, best = designed.optimum;
    const rate = done && best ? best.economic.oil / Math.max(0.01, 1 - inputs.waterCut) : 0;
    scene = { ...base, flow: done ? sceneFlow(designed.tubingLine) : [], liquidRate: rate, oilRate: done && best ? best.economic.oil : 0, whpPsig: inputs.whpPsi,
      liftMscfD: done && best ? best.economic.gasScfD / 1000 : 1, liftMdM: md.at(-1)!, annulusLevelMdM: u.levelMdM,
      valves: valves.map((v, i) => ({ mdM: md[i]!, state: u.open.includes(i) ? (v.role === "operating" ? "operating" : "open") : "closed", label: `${i + 1}` })) };
    // The annulus while unloading: the injection gas down to the fluid level, the load fluid's weight below it (the U-tube the valves are spaced on).
    const annulus = u.levelMdM === null ? [] : (() => {
      const gas = casingProfile(well, u.casingPsig, lift.liftGasSg, u.levelMdM), atLevel = gas.at(-1)!.psia;
      const below = Array.from({ length: 9 }, (_, i) => { const mdM = u.levelMdM! + (md.at(-1)! - u.levelMdM!) * i / 8; return { mdM, psia: atLevel + lift.loadFluidSg * 0.433 * (mdM - u.levelMdM!) * FT_PER_M }; });
      return [{ key: "annulus", pts: [...gas, ...below], className: "pw-line-annulus", label: "annulus" }];
    })();
    laneLines = [casingLine(lift.kickoffPsig, md.at(-1)!, "kickoff", "pw-line-kickoff"), casingLine(u.casingPsig, md.at(-1)!, "casing"), ...annulus, ...(done ? [tubingLine(designed.tubingLine, "tubing, lifted")] : [])];
    subtitle = done ? `Unloaded: gas in at ${fmt(Math.round(md.at(-1)!))} m, ${fmt(Math.round((best?.economic.gasScfD ?? 0) / 1000))} Mscf/d` : `Unloading: valve ${u.step} of ${u.of} · casing ${fmt(Math.round(u.casingPsig))} psig`;
  } else if (lens === "life") {
    const at = cursorMs ?? todayMs, date = new Date(at).toISOString().slice(0, 10);
    const run = cases ? (kept.lifeCase === "natural" || !cases.band.main.lifted ? cases.band.main.natural : cases.band.main.lifted) : null;
    const liftMscf = run === cases?.band.main.lifted ? inputs.liftMscfD : 0;
    if (at <= todayMs || !run) {
      const c = conditionsOn(tests, date);
      const traverse = c ? wellTraverse(well, inputs, calibration, { whpPsia: c.whp, liquidRate: c.liquidRate, waterCut: c.waterCut, gor: c.gor, liftMscfD: c.liftGasScfD / 1000 }) : null;
      scene = { ...base, flow: sceneFlow(traverse), waterCut: c?.waterCut ?? 0, liquidRate: c?.liquidRate ?? 0, oilRate: (c?.liquidRate ?? 0) * (1 - (c?.waterCut ?? 0)), reservoirPsia: pressureAtDate(modelOf(well), tests, date).pressure, whpPsig: (c?.whp ?? 14.7) - 14.7, liftMscfD: (c?.liftGasScfD ?? 0) / 1000, liftMdM: well.liftDepthMdM, valves: operatingValves((c?.liftGasScfD ?? 0) / 1000) };
      laneLines = [tubingLine(traverse, "tubing")];
      subtitle = `${date.slice(0, 7)} · history`;
    } else {
      const step = run.steps.find((s) => Date.parse(s.date) >= at) ?? null;
      const liquid = step ? step.oil + step.water : 0;
      const traverse = step ? wellTraverse(well, inputs, calibration, { whpPsia: inputs.whpPsi + 14.7, liquidRate: liquid, waterCut: step.waterCut, gor: step.gor, liftMscfD: liftMscf }) : null;
      scene = { ...base, flow: sceneFlow(traverse), waterCut: step?.waterCut ?? inputs.waterCut, liquidRate: liquid, oilRate: step?.oil ?? 0, reservoirPsia: step?.pressure ?? prOf, liftMscfD: liftMscf, liftMdM: well.liftDepthMdM, valves: operatingValves(liftMscf) };
      laneLines = [tubingLine(traverse, "tubing")];
      subtitle = step ? `${date.slice(0, 7)} · forecast, ${liftMscf > 0 ? "on gas lift" : "natural flow"}` : `${date.slice(0, 7)} · ${run.end === "dead" ? "not flowing" : "shut in below the economic limit"}`;
    }
    lanePoints = [{ key: "pr", mdM: perfMid, psia: scene.reservoirPsia, className: "pw-pt-pr", label: "reservoir" }];
  } else {
    scene = { ...base, flow: sceneFlow(solved.traverse), liquidRate: point?.rate ?? 0, oilRate: point ? point.rate * (1 - inputs.waterCut) : 0, liftMscfD: inputs.liftMscfD, liftMdM: well.liftDepthMdM, valves: operatingValves(inputs.liftMscfD) };
    laneLines = [tubingLine(solved.traverse, "tubing"), ...(liftOn(inputs.liftMscfD) && well.liftDepthMdM !== null ? [casingLine(lift.operatingPsig, well.liftDepthMdM, "casing")] : [])];
    lanePoints = [{ key: "pr", mdM: perfMid, psia: prOf, className: "pw-pt-pr", label: "reservoir" }, ...(point ? [{ key: "pwf", mdM: perfMid, psia: point.pwf, className: "pw-pt-pwf", label: "flowing" }] : [])];
    subtitle = !point ? "Not flowing: the tubing cannot lift what the reservoir delivers" : entry && !entry.ok ? `Lift gas cannot enter at ${fmt(Math.round(well.liftDepthMdM ?? 0))} m: casing ${fmt(Math.round(entry.casing - 14.7))} against tubing ${fmt(Math.round(entry.tubing - 14.7))} psig` : liftOn(inputs.liftMscfD) ? "Flowing on gas lift" : "Flowing naturally";
  }

  const lensButtons = (["match", "operate", "lift", "life"] as const).filter((l) => l !== "lift" || well.lift === "gas-lift");
  const correlation = calibration ? CORRELATIONS.find((c) => c.id === calibration.flow.correlation)?.name : null;
  return <div className="pw" data-lens={lens}>
    <header className="pw-bar">
      <span className="pw-title"><b>{brief.identity.name || "This design"}</b><small>{subtitle}</small></span>
      <span className="pw-lenses" role="tablist" aria-label="Lens">
        {lensButtons.map((l) => <button key={l} type="button" role="tab" aria-selected={lens === l} onClick={() => { setKept((k) => ({ ...k, lens: l })); setDrawer(null); }}>{LENS_NAME[l]}</button>)}
      </span>
      <span className={`pw-badge${calibration && !stale ? " is-on" : stale ? " is-stale" : ""}`} title={calibration ? `Matched ${calibration.at} on ${calibration.tests} tests` : "Assumed inputs until matched to the well's tests"}>
        {calibration ? <>{stale ? "Out of date" : kept.synthetic ? "Matched · synthetic tests" : "Matched"}<small>±{fmt(Math.round(calibration.flow.mae))} psi · {correlation}</small></> : <>Uncalibrated<small>assumed inputs</small></>}
      </span>
      <span className="pw-readout">
        <span><small>Oil</small><b>{fmt(Math.round(scene.oilRate))}</b></span>
        <span><small>Liquid</small><b>{fmt(Math.round(scene.liquidRate))}</b></span>
        <span><small>Water</small><b>{Math.round(scene.waterCut * 100)}%</b></span>
        <em>STB/d · oil {fmt(Math.round(scene.oilRate * SM3_PER_STB))} Sm³/d</em>
      </span>
    </header>
    <div className="pw-stage">
      <ProducingWell scene={scene} cursorMdM={wire.cursor} onHover={wire.hover} onPin={wire.pin} />
      <PressureLane mdMax={scene.mdMax} lines={laneLines} points={lanePoints} cursorMdM={wire.cursor} onHover={wire.hover} onPin={wire.pin} />
      <aside className="pw-side">
        {lens === "operate" && <>
          <NodalInstrument ipr={solved.ipr} vlp={solved.vlp} point={point} test={calibration && Number.isFinite(calibration.lastPwf) ? { rate: calibration.lastTest.liquidRate, pwf: calibration.lastPwf } : null}
            onRate={(rate) => { const whp = whpForRate(well, inputs, calibration, rate); if (whp !== null) set({ whpPsi: Math.max(20, Math.round(whp)) }); }} />
          <div className="pw-dials">
            <Dial label="Wellhead, psig" value={inputs.whpPsi} min={20} max={1500} step={5} show={(v) => fmt(v)} onChange={(whpPsi) => set({ whpPsi })} />
            {well.lift === "gas-lift" && <Dial label="Lift gas, Mscf/d" value={inputs.liftMscfD} min={0} max={5000} step={50} tone="#38bdf8" show={(v) => fmt(v)} sub={entry && !entry.ok ? "cannot enter" : undefined} onChange={(liftMscfD) => set({ liftMscfD })} />}
            <Dial label="Water cut" value={Math.round(inputs.waterCut * 100)} min={0} max={95} step={1} tone="#60a5fa" show={(v) => `${v}%`} onChange={(v) => set({ waterCut: v / 100 })} />
            <Dial label={calibration ? "Depletion from now" : "Depletion"} value={Math.round(inputs.depletion * 100)} min={0} max={70} step={1} tone="#a78bfa" show={(v) => `${v}%`} onChange={(v) => set({ depletion: v / 100 })} />
          </div>
          <div className="pw-facts">
            <span><small>Reservoir</small><b>{fmt(Math.round(prOf))}</b><em>psia</em></span>
            <span><small>Flowing BHP</small><b>{point ? fmt(Math.round(point.pwf)) : "–"}</b><em>psia</em></span>
            <span><small>PI</small><b>{solved.ipr.pi.toFixed(2)}</b><em>STB/d/psi</em></span>
            <span><small>Bubble point</small><b>{fmt(Math.round(solved.bubblePointPsi))}</b><em>psia</em></span>
          </div>
          <button type="button" className="tie-button" onClick={() => setDrawer("inputs")}>Inputs and assumptions</button>
        </>}
        {lens === "match" && <>
          <div className="pw-tests" role="listbox" aria-label="Tests">
            {[...tests].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).map((t) => {
              const chosen = (kept.testDate ?? lastTest?.date) === t.date;
              return <button key={t.date} type="button" role="option" aria-selected={chosen} onClick={() => setKept((k) => ({ ...k, testDate: t.date }))}>
                <b>{t.date}</b><span>{fmt(Math.round(t.liquidRate))} STB/d · {Math.round(t.waterCut * 100)}% water{t.liftGasScfD > 0 ? " · lifted" : ""}</span>
                {t.gaugePressure !== null && <i>gauge {fmt(Math.round(t.gaugePressure - 14.7))} psig</i>}
              </button>;
            })}
          </div>
          {scene.gauge && scene.gauge.model !== null && <p className={`pw-gaugefit${Math.abs(scene.gauge.model - scene.gauge.measured) > 30 ? " is-warn" : ""}`}>Model {fmt(Math.round(scene.gauge.model - 14.7))} psig against the gauge&apos;s {fmt(Math.round(scene.gauge.measured - 14.7))}: {scene.gauge.model >= scene.gauge.measured ? "+" : ""}{fmt(Math.round(scene.gauge.model - scene.gauge.measured))} psi</p>}
          <div className="pw-actions">
            <button type="button" className={`tie-button${!calibration || stale ? " is-primary" : ""}`} onClick={match} disabled={!tests.length}>{calibration && !stale ? "Match again" : "Match"}</button>
            <button type="button" className="tie-button" onClick={() => setDrawer("tests")}>Tests, lab and correlations</button>
          </div>
          {calibration && <p className="nodal-hint">{correlation}: holdup × {calibration.flow.resolved?.holdup === false ? "1 (not resolved)" : calibration.flow.holdupFactor.toFixed(2)}, friction × {calibration.flow.resolved?.friction === false ? "1 (not resolved)" : calibration.flow.frictionFactor.toFixed(2)}; PI {calibration.pi.toFixed(2)} STB/d/psi at the last test.</p>}
        </>}
        {lens === "lift" && (designed ? <>
          {designed.design.operating ? <div className="pw-unload">
            <button type="button" className="rail-button" aria-label={unload.playing ? "Pause unloading" : "Play unloading"} onClick={() => setUnload((u) => ({ t: u.t >= 1 ? 0 : u.t, playing: !u.playing }))}>{unload.playing ? <Pause size={13} /> : <Play size={13} />}</button>
            <input type="range" min={0} max={1} step={0.001} value={unload.t} aria-label="Unloading" onChange={(event) => setUnload({ t: Number(event.target.value), playing: false })} />
            <span>{unload.t >= 1 ? "unloaded" : "unloading"}</span>
          </div> : <p className="nodal-hint is-warn">{designed.design.reason}</p>}
          <div className="pw-dials">
            <Dial label="Kickoff, psig" value={lift.kickoffPsig} min={600} max={3000} step={10} tone="#38bdf8" show={(v) => fmt(v)} onChange={(kickoffPsig) => setKept((k) => ({ ...k, lift: { ...lift, kickoffPsig, operatingPsig: Math.min(lift.operatingPsig, kickoffPsig) } }))} />
            <Dial label="Operating, psig" value={lift.operatingPsig} min={500} max={3000} step={10} tone="#38bdf8" show={(v) => fmt(v)} onChange={(operatingPsig) => setKept((k) => ({ ...k, lift: { ...lift, operatingPsig, kickoffPsig: Math.max(lift.kickoffPsig, operatingPsig) } }))} />
            <Dial label="Gas available, Mscf/d" value={lift.availableMscfD} min={200} max={8000} step={50} tone="#f59e0b" show={(v) => fmt(v)} onChange={(availableMscfD) => setKept((k) => ({ ...k, lift: { ...lift, availableMscfD } }))} />
            <Dial label="Drop per valve, psi" value={lift.perValveDropPsi} min={10} max={50} step={5} tone="#a78bfa" show={(v) => `${v}`} onChange={(perValveDropPsi) => setKept((k) => ({ ...k, lift: { ...lift, perValveDropPsi } }))} />
          </div>
          <Performance result={designed} lift={lift} current={inputs.liftMscfD} waterCut={inputs.waterCut} />
          <div className="pw-actions">
            {designed.design.operating && designed.optimum && <button type="button" className="tie-button is-primary" onClick={() => { const op = designed.design.operating!, best = designed.optimum!; setKept((k) => ({ ...k, lens: "operate", injectionMdM: Math.round(op.mdFt / FT_PER_M), inputs: { ...k.inputs, liftMscfD: Math.round(best.economic.gasScfD / 1000) } })); }}>Operate at this design</button>}
            <button type="button" className="tie-button" onClick={() => setDrawer("valves")}>Valve schedule</button>
          </div>
        </> : <p className="nodal-hint">The completion has no gas lift: choose it in the Well designer&apos;s Completion stage.</p>)}
        {lens === "life" && (usable ? (cases ? <LifeSide cases={cases} f={forecastInputs} lifeCase={kept.lifeCase ?? "lift"} onCase={(c) => setKept((k) => ({ ...k, lifeCase: c }))}
          onForecast={(patch) => setKept((k) => ({ ...k, forecast: { ...defaultForecast, ...k.forecast, ...patch } }))} onTank={() => setDrawer("tank")} entryOk={!entry || entry.ok} liftMscfD={inputs.liftMscfD} />
          : <p className="nodal-hint">Matching the tank to the build-ups…</p>)
          : <p className="nodal-hint">{stale ? "The tests changed since the match: match again, then the forecast follows." : "Match the well to its tests first (the Match lens): the forecast runs on the matched model."} The history is on the time rail already.</p>)}
      </aside>
    </div>
    {lens === "life" && <LifeStrip production={production} tests={tests} band={cases?.band ?? null} showLift={(kept.lifeCase ?? "lift") === "lift"} cursorMs={cursorMs ?? todayMs} todayMs={todayMs}
      onCursor={(ms) => signals.setTimeCursor(ms, wire.source)} />}
    {drawer && <div className="pw-drawer" role="dialog" aria-label="Details">
      <header><b>{drawer === "inputs" ? "Inputs and assumptions" : drawer === "tests" ? "Tests, lab and correlations" : drawer === "valves" ? "Valve schedule" : "Tank match"}</b>
        <button type="button" className="cor-icon" aria-label="Close" onClick={() => setDrawer(null)}><X size={13} /></button></header>
      <div className="pw-drawer-body">
        {drawer === "tests" && <>
          <MatchView tests={tests} lab={lab} synthetic={!!kept.synthetic} result={result} stale={stale} onTests={(next) => setKept((k) => ({ ...k, tests: next, synthetic: false }))} onLab={(next) => setKept((k) => ({ ...k, lab: next }))} onMatch={match} />
          {result && <HistoryView result={result} well={well} inputs={inputs} />}
        </>}
        {drawer === "valves" && designed && <ValveSchedule result={designed} lift={lift} brief={brief} calibrated={usable} />}
        {drawer === "tank" && cases && tankFit && <>
          <TankCard matched={tankFit} tank={cases.tank} aquifer={tankAquifer} onAquifer={(a) => setKept((k) => ({ ...k, tankAquifer: a }))} production={production} synthetic={!!kept.synthetic} />
          <WorCard cases={cases.band.main} />
        </>}
        {drawer === "inputs" && <InputsDrawer inputs={inputs} set={set} calibration={calibration} onReset={() => setKept((k) => ({ ...k, inputs: defaultNodal }))} tubingOdIn={well.tubingOdIn}
          liftDepthMdM={well.liftDepthMdM} designed={injectionMdM !== null} onLiftDepth={(mdM) => setKept((k) => ({ ...k, injectionMdM: mdM }))} packerMdM={brief.completion?.packerMdM ?? null} />}
      </div>
    </div>}
  </div>;
}

/** Outlook and forecast controls for the Life lens. */
function LifeSide({ cases, f, lifeCase, onCase, onForecast, onTank, entryOk, liftMscfD }: {
  readonly cases: { readonly tank: { readonly stoiip: number }; readonly band: ReturnType<typeof forecastBand> }; readonly f: ForecastInputs; readonly lifeCase: "natural" | "lift";
  readonly onCase: (c: "natural" | "lift") => void; readonly onForecast: (patch: Partial<ForecastInputs>) => void; readonly onTank: () => void; readonly entryOk: boolean; readonly liftMscfD: number;
}) {
  const { band } = cases, k = (v: number) => fmt(Math.round(v / 1e3));
  const span = (pick: (c: typeof band.main) => Parameters<typeof cumOil>[0]) => { const v = [band.low, band.high, band.main].map((c) => cumOil(pick(c))); return [Math.min(...v), Math.max(...v)] as const; };
  const nat = span((c) => c.natural), lifted = band.main.lifted ? span((c) => c.lifted) : null;
  const ends = (r: typeof band.main.natural) => r.end === "horizon" ? `flows past ${r.endDate.slice(0, 7)}` : r.end === "dead" ? `dies ${r.endDate.slice(0, 7)}` : `limit ${r.endDate.slice(0, 7)}`;
  return <>
    <div className="pw-cases" role="radiogroup" aria-label="Case">
      <button type="button" role="radio" aria-checked={lifeCase === "natural"} onClick={() => onCase("natural")}><small>Natural flow</small><b>{k(cumOil(band.main.natural))} kSTB</b><em>{k(nat[0])}–{k(nat[1])} · {ends(band.main.natural)}</em></button>
      {band.main.lifted && lifted && <button type="button" role="radio" aria-checked={lifeCase === "lift"} onClick={() => onCase("lift")} data-warn={!entryOk || undefined}><small>Gas lift · {fmt(liftMscfD)} Mscf/d</small><b>{k(cumOil(band.main.lifted))} kSTB</b><em>{entryOk ? `${k(lifted[0])}–${k(lifted[1])} · ${ends(band.main.lifted)}` : "gas cannot enter at this depth"}</em></button>}
    </div>
    {band.main.lifted && entryOk && <p className="pw-gain">Gas lift adds <b>+{k(cumOil(band.main.lifted) - cumOil(band.main.natural))} kSTB</b> over {f.years} years</p>}
    <div className="pw-dials">
      <Dial label="Horizon" value={f.years} min={2} max={25} step={1} tone="#94a3b8" show={(v) => `${v} yr`} onChange={(years) => onForecast({ years })} />
      <Dial label="Economic limit, STB/d" value={f.economicLimit} min={50} max={2000} step={25} tone="#f87171" show={(v) => fmt(v)} onChange={(economicLimit) => onForecast({ economicLimit })} />
      <Dial label="Facility liquid, STB/d" value={f.maxLiquid} min={2000} max={30000} step={500} tone="#94a3b8" show={(v) => `${fmt(v)}`} onChange={(maxLiquid) => onForecast({ maxLiquid })} />
    </div>
    <p className="nodal-hint">Oil in place {fmt(Math.round(band.tanks.low.stoiip / 1e6))}–{fmt(Math.round(band.tanks.high.stoiip / 1e6))} MMSTB fits the build-ups equally: the band on the strip. Drag the strip or the time rail to see the well on any date.</p>
    <button type="button" className="tie-button" onClick={onTank}>Tank match and water trend</button>
  </>;
}

/** What the design does not say, and the depth the lift gas goes in. */
function InputsDrawer({ inputs, set, calibration, onReset, tubingOdIn, liftDepthMdM, designed, onLiftDepth, packerMdM }: {
  readonly inputs: NodalInputs; readonly set: (patch: Partial<NodalInputs>) => void; readonly calibration: Calibration | null; readonly onReset: () => void; readonly tubingOdIn: number;
  readonly liftDepthMdM: number | null; readonly designed: boolean; readonly onLiftDepth: (mdM: number | null) => void; readonly packerMdM: number | null;
}) {
  return <div className="pw-inputs">
    {calibration ? <p className="nodal-hint">The fluid, productivity and tubing correlation come from the match ({calibration.tests} tests, last {calibration.lastTest.date}); assumed values are not used while it holds.</p> : <>
      <h3>Assumed <small>the design does not say</small><button type="button" className="cor-icon" aria-label="Back to the assumed values" onClick={onReset}><RotateCcw size={11} /></button></h3>
      <Slider label="Oil gravity" value={inputs.api} min={15} max={50} step={1} show={(v) => `${v} °API`} onChange={(api) => set({ api })} />
      <Slider label="Gas–oil ratio" value={inputs.gor} min={50} max={2000} step={10} show={(v) => `${fmt(v)} scf/STB`} onChange={(gor) => set({ gor })} />
      <Slider label="Permeability" value={inputs.permeabilityMd} min={1} max={1000} step={1} log show={(v) => `${fmt(v)} mD`} onChange={(permeabilityMd) => set({ permeabilityMd })} />
      <Slider label="Skin" value={inputs.skin} min={-4} max={20} step={0.5} show={(v) => v.toFixed(1)} onChange={(skin) => set({ skin })} />
    </>}
    <label className="nodal-field">Tubing<select value={inputs.tubingOdIn ?? ""} onChange={(event) => set({ tubingOdIn: event.target.value === "" ? null : Number(event.target.value) })}>
      <option value="">The design&apos;s ({tubingOdIn} in)</option>
      {COMPARE_VALUES.tubing.map((od) => <option key={od} value={od}>{od} in</option>)}
    </select></label>
    {liftDepthMdM !== null && <p className="nodal-hint">Lift gas goes in at {fmt(Math.round(liftDepthMdM))} m MD{designed ? " (set by the lift design or the well's records)" : packerMdM !== null ? ", just above the packer, until a lift design sets it" : ""}.
      {designed && <button type="button" className="tie-button" onClick={() => onLiftDepth(null)}>Back to above the packer</button>}</p>}
  </div>;
}
