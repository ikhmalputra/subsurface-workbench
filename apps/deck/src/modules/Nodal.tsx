import { useDeferredValue, useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { scaleLinear } from "d3-scale";
import type { FlowPattern } from "@ikhmalputra/subsurface-core/production";
import { useDesign } from "../data/design.ts";
import { useDeck } from "../deck/store.ts";
import { COMPARE_VALUES, FT_PER_M, SM3_PER_STB, chosenTank, defaultForecast, defaultLift, defaultNodal, forecastCases, liftDesign, runMatch, solve, tankMatch, wellCase, withValue } from "../data/nodal-model.ts";
import type { Calibration, Compare, ForecastInputs, LiftInputs, NodalInputs, Solved, WellCase } from "../data/nodal-model.ts";
import type { LabPvt, ProductionMonth, WellTest } from "@ikhmalputra/subsurface-core/production";
import { CORRELATIONS } from "@ikhmalputra/subsurface-core/production";
import { kestrelSynthetic } from "../data/kestrel-tests.ts";
import { HistoryView, MatchView } from "./NodalMatch.tsx";
import { LiftView } from "./NodalLift.tsx";
import { ForecastView } from "./NodalForecast.tsx";
import { fmt } from "../format.ts";
import { useSize } from "./useSize.ts";
import { useWire } from "./wire.ts";

/**
 * Nodal analysis on a designed well: what the reservoir can deliver (inflow) against what the
 * tubing can lift (outflow), where they meet, the pressure and flow pattern up the tubing there, and
 * how the rate moves with one thing changed — tubing size, lift gas, water cut or wellhead
 * pressure. Depths, path, tubing, perforations, pore pressure, temperature and lift come from the
 * design; the fluid and the rock's flow properties are inputs, marked as assumed until set.
 */

const KEY = "deck-nodal-v1";
type View = "match" | "predict" | "lift" | "forecast" | "history";
type Kept = {
  readonly inputs: NodalInputs; readonly compare: Compare; readonly view?: View;
  readonly tests?: readonly WellTest[]; readonly lab?: LabPvt | null; readonly synthetic?: boolean;
  /** The match, and the tests and lab it was made from (so an edit since shows it is out of date). */
  readonly calibration?: Calibration | null; readonly matchedKey?: string;
  /** The gas-lift design's inputs, and the injection depth it chose once used in Predict (m MD; else the deepest mandrel). */
  readonly lift?: LiftInputs; readonly injectionMdM?: number | null;
  /** Allocated monthly production; the forecast's settings and the tank picked among the matched ones (an aquifer size; null: the best fit). */
  readonly production?: readonly ProductionMonth[]; readonly forecast?: ForecastInputs; readonly tankAquifer?: number | null;
  /** Which synthetic sample this is: an older one is replaced. */
  readonly sampleVersion?: number;
};
const SAMPLE_VERSION = 2;
function readKept(): Record<string, Kept> { try { const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Kept>; return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; } }
const okKept = (k: Kept | undefined): k is Kept => !!k && !!k.inputs && typeof k.inputs === "object" && Object.keys(defaultNodal).every((key) => key in k.inputs) && ["tubing", "lift", "waterCut", "whp"].includes(k.compare);

const PATTERN_COLOUR: Readonly<Record<FlowPattern, string>> = { liquid: "#38bdf8", segregated: "#a78bfa", transition: "#f472b6", intermittent: "#f59e0b", distributed: "#34d399", gas: "#f87171" };
const PATTERN_NAME: Readonly<Record<FlowPattern, string>> = { liquid: "Liquid only", segregated: "Segregated", transition: "Transition", intermittent: "Slug (intermittent)", distributed: "Bubble (distributed)", gas: "Gas only" };
const COMPARE_NAME: Readonly<Record<Compare, string>> = { tubing: "Tubing size", lift: "Lift gas", waterCut: "Water cut", whp: "Wellhead pressure" };
const compareLabel = (compare: Compare, v: number) => compare === "tubing" ? `${v} in` : compare === "lift" ? `${fmt(v)} Mscf/d` : compare === "waterCut" ? `${Math.round(v * 100)}%` : `${fmt(v)} psi`;
const bar = (psi: number) => psi / 14.5038;
const VIEW_NAME: Readonly<Record<View, string>> = { match: "Match", predict: "Predict", lift: "Gas lift", forecast: "Forecast", history: "History" };

export function Nodal() {
  useWire("nodal");
  const siteId = useDeck((deck) => deck.siteId) ?? "";
  const { brief } = useDesign();
  const [kept, setKeptState] = useState<Kept>(() => {
    const k = readKept()[siteId];
    // Kestrel A-7 comes with a synthetic test history and lab report, so the match can be seen at work.
    const sample = () => { const synthetic = siteId === "kestrel" ? kestrelSynthetic(brief) : null; return { tests: synthetic?.tests ?? [], lab: synthetic?.lab ?? null, production: synthetic?.production ?? [], synthetic: !!synthetic, sampleVersion: SAMPLE_VERSION }; };
    if (okKept(k)) return k.tests === undefined || (k.synthetic && k.sampleVersion !== SAMPLE_VERSION) ? { ...k, ...sample(), view: "match" as const, calibration: null, tankAquifer: null } : k;
    return { inputs: defaultNodal, compare: "lift", view: "match", ...sample(), calibration: null };
  });
  const setKept = (change: (k: Kept) => Kept) => setKeptState((current) => { const next = change(current); try { localStorage.setItem(KEY, JSON.stringify({ ...readKept(), [siteId]: next })); } catch { /* not kept */ } return next; });
  const set = (patch: Partial<NodalInputs>) => setKept((k) => ({ ...k, inputs: { ...k.inputs, ...patch } }));
  const { inputs, compare } = kept, view = kept.view ?? "predict", tests = kept.tests ?? [], lab = kept.lab ?? null;
  const key = JSON.stringify([tests, lab]), calibration = kept.calibration ?? null, stale = !!calibration && kept.matchedKey !== key;

  const injectionMdM = kept.injectionMdM ?? null, lift = { ...defaultLift, ...kept.lift };
  const well = useMemo(() => { const w = wellCase(brief, inputs); return typeof w === "string" || injectionMdM === null || w.liftDepthMdM === null ? w : { ...w, liftDepthMdM: injectionMdM }; }, [brief, inputs, injectionMdM]);
  // The match runs when asked (it tunes every correlation: about a second), and again for its views when they are opened.
  const [matched, setMatched] = useState<{ key: string; result: ReturnType<typeof runMatch> } | null>(null);
  const result = useMemo(() => {
    if (typeof well === "string" || view === "predict" || view === "lift" || view === "forecast" || !calibration || !tests.length) return null;
    if (matched?.key === key) return matched.result;
    return runMatch(well, tests, lab);
  }, [well, view, calibration, tests, lab, matched, key]);
  const match = () => {
    if (typeof well === "string") return;
    const run = runMatch(well, tests, lab);
    setMatched({ key, result: run });
    const c = run.calibration;
    setKept((k) => ({ ...k, calibration: c, matchedKey: key, inputs: c ? { ...k.inputs, waterCut: c.lastTest.waterCut, whpPsi: Math.round(c.lastTest.whp - 14.7), liftMscfD: Math.round(c.lastTest.liftGasScfD / 1000), gor: c.lastTest.gor, depletion: 0 } : k.inputs }));
  };
  const solved = useMemo(() => typeof well === "string" ? null : solve(well, inputs, undefined, calibration), [well, inputs, calibration]);
  // The comparison: each value of the chosen input solved on the same rate grid, so the curves share an axis.
  const family = useMemo(() => {
    if (typeof well === "string" || !solved) return [];
    return COMPARE_VALUES[compare].map((value) => {
      const next = withValue(inputs, compare, value), w = wellCase(brief, next);
      return { value, solved: typeof w === "string" ? null : solve(w, next, solved.vlp.rates, calibration) };
    });
  }, [well, solved, compare, brief, inputs, calibration]);

  // The gas-lift design: about a quarter of a second, so it follows the sliders a beat behind.
  const liftLater = useDeferredValue(lift);
  const designed = useMemo(() => typeof well === "string" || view !== "lift" || well.liftDepthMdM === null ? null : liftDesign(brief, well, inputs, calibration, liftLater), [well, view, brief, inputs, calibration, liftLater]);

  // The forecast: the tank matched to the build-ups (a fifth of a second), then both cases month by month (a quarter).
  const production = kept.production ?? [], forecastInputs = { ...defaultForecast, ...kept.forecast }, tankAquifer = kept.tankAquifer ?? null;
  const usable = !!calibration && !stale && tests.length > 0;
  const tankFit = useMemo(() => typeof well === "string" || view !== "forecast" || !usable ? null : tankMatch(well, tests, production, calibration!), [well, view, usable, tests, production, calibration]);
  const later = useDeferredValue({ forecastInputs, inputs, tankAquifer });
  const cases = useMemo(() => {
    if (typeof well === "string" || !tankFit || !calibration) return null;
    return { tank: chosenTank(tankFit, later.tankAquifer), run: forecastCases(well, later.inputs, calibration, tests, production, chosenTank(tankFit, later.tankAquifer), later.forecastInputs) };
  }, [well, tankFit, calibration, tests, production, later]);

  if (typeof well === "string") return <p className="hz-empty nodal-empty">{well}</p>;
  if (!solved) return null;
  const point = solved.point, oilRate = point ? point.rate * (1 - inputs.waterCut) : 0;
  const status = !point ? { text: "Dead: the tubing cannot lift what the reservoir delivers", tone: "is-dead" }
    : well.lift === "gas-lift" && inputs.liftMscfD > 0 && !solve(well, { ...inputs, liftMscfD: 0 }, solved.vlp.rates, calibration).point ? { text: "Flowing on gas lift: dead without it", tone: "is-lift" }
    : { text: inputs.liftMscfD > 0 && well.lift === "gas-lift" ? "Flowing, with lift gas" : "Flowing naturally", tone: "is-flowing" };

  return <div className="nodal">
    <header className="tie-bar nodal-bar">
      <span className="tie-title"><b>{brief.identity.name || "This design"}</b><small>{fmt(Math.round(well.midPerfMdM))} m MD perforations · {well.tubingOdIn} in tubing · {well.lift === "gas-lift" ? "gas lift" : well.lift}</small></span>
      <span className="log-sets nodal-views" role="group" aria-label="View">
        {(["match", "predict", "lift", "forecast", "history"] as const).filter((v) => v !== "lift" || well.lift === "gas-lift").map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => setKept((k) => ({ ...k, view: v }))}>{VIEW_NAME[v]}</button>)}
      </span>
      <span className={`nodal-calibrated${calibration && !stale ? " is-on" : stale ? " is-stale" : ""}`} title={calibration ? `Matched ${calibration.at} on ${calibration.tests} tests` : "Prediction uses assumed inputs until the model is matched to the well's tests"}>
        {calibration ? <>{stale ? "Out of date: tests changed since the match" : "Calibrated"}<small>{calibration.tests} tests · ±{fmt(Math.round(calibration.flow.mae))} psi · {CORRELATIONS.find((c) => c.id === calibration.flow.correlation)?.name}</small></> : <>Uncalibrated<small>assumed inputs: match it to tests</small></>}
      </span>
      {view === "predict" && <span className={`nodal-status ${status.tone}`}>{status.text}</span>}
      {view === "predict" && point && <span className="vol-p nodal-p">
        <span><small>Oil</small><b>{fmt(Math.round(oilRate))}</b></span>
        <span><small>Liquid</small><b>{fmt(Math.round(point.rate))}</b></span>
        <span><small>Pwf</small><b>{fmt(Math.round(point.pwf))}</b></span>
        <span><small>Drawdown</small><b>{fmt(Math.round((solved.ipr.pwf(0) ?? well.reservoir.pressure) - point.pwf))}</b></span>
        <em>STB/d · psia<br />oil {fmt(Math.round(oilRate * SM3_PER_STB))} Sm³/d · Pwf {fmt(Math.round(bar(point.pwf)))} bar</em>
      </span>}
    </header>
    {view === "match" && <MatchView tests={tests} lab={lab} synthetic={!!kept.synthetic} result={result} stale={stale}
      onTests={(next) => setKept((k) => ({ ...k, tests: next, synthetic: false }))} onLab={(next) => setKept((k) => ({ ...k, lab: next }))} onMatch={match} />}
    {view === "lift" && designed && <LiftView result={designed} lift={lift} inputs={inputs} well={well} brief={brief} calibrated={!!calibration && !stale}
      onLift={(patch) => setKept((k) => ({ ...k, lift: { ...defaultLift, ...k.lift, ...patch } }))}
      inUse={!!designed.design.operating && !!designed.optimum && injectionMdM !== null && Math.abs(injectionMdM - designed.design.operating.mdFt / FT_PER_M) < 1 && Math.abs(inputs.liftMscfD - Math.round(designed.optimum.economic.gasScfD / 1000)) < 1}
      onUse={() => { const op = designed.design.operating, best = designed.optimum; if (!op || !best) return; setKept((k) => ({ ...k, view: "predict", injectionMdM: Math.round(op.mdFt / FT_PER_M), inputs: { ...k.inputs, liftMscfD: Math.round(best.economic.gasScfD / 1000) } })); }} />}
    {view === "lift" && !designed && <p className="hz-empty nodal-empty">The completion has no gas lift: choose it in the Well designer&apos;s Completion stage.</p>}
    {view === "forecast" && tankFit && cases && <ForecastView matched={tankFit} tank={cases.tank} aquifer={tankAquifer} onAquifer={(a) => setKept((k) => ({ ...k, tankAquifer: a }))}
      cases={cases.run} f={forecastInputs} onForecast={(patch) => setKept((k) => ({ ...k, forecast: { ...defaultForecast, ...k.forecast, ...patch } }))}
      inputs={inputs} onInputs={set} well={well} tests={tests} production={production} synthetic={!!kept.synthetic} />}
    {view === "forecast" && !usable && <p className="hz-empty nodal-empty">{stale ? "The tests changed since the match: match again, then forecast." : "Match the well to its tests first: the forecast runs on the matched model, and its tank is matched to the build-up pressures."}</p>}
    {view === "history" && <HistoryView result={result} well={well} inputs={inputs} />}
    {view === "predict" && <div className="nodal-stage">
      <NodalPlot solved={solved} family={family} compare={compare} well={well} test={calibration && Number.isFinite(calibration.lastPwf) ? { rate: calibration.lastTest.liquidRate, pwf: calibration.lastPwf, date: calibration.lastTest.date } : null} />
      <TraversePlot solved={solved} well={well} inputs={inputs} />
      <aside className="nodal-inputs">
        <h3>From the design</h3>
        <dl className="nodal-design">
          <div><dt>Reservoir</dt><dd>{fmt(Math.round(calibration ? calibration.reservoirPressure : well.reservoir.pressure))} psia{inputs.depletion > 0 ? ` (−${Math.round(inputs.depletion * 100)}%)` : ""}<small>{calibration ? `by the tests, ${calibration.lastTest.date}` : `${well.fromDesign.pressureSg.toFixed(2)} SG pore at ${fmt(Math.round(well.midPerfTvdM))} m TVD`}</small></dd></div>
          <div><dt>Temperature</dt><dd>{Math.round(well.fromDesign.tempC)} °C<small>geothermal gradient at the perforations</small></dd></div>
          <div><dt>Net pay</dt><dd>{Math.round(well.perfThicknessM)} m<small>the perforated interval, TVD</small></dd></div>
          <div><dt>Bubble point</dt><dd>{fmt(Math.round(solved.bubblePointPsi))} psia<small>{calibration?.pvt ? "Standing, matched to the lab" : "Standing, from the fluid below"}</small></dd></div>
        </dl>
        {calibration ? <>
          <h3>From the match <small>{calibration.tests} tests, last {calibration.lastTest.date}</small></h3>
          <dl className="nodal-design">
            <div><dt>Productivity index</dt><dd>{calibration.pi.toFixed(2)} STB/d/psi<small>the last test's</small></dd></div>
            <div><dt>Tubing</dt><dd>{CORRELATIONS.find((c) => c.id === calibration.flow.correlation)?.name}<small>holdup × {calibration.flow.holdupFactor.toFixed(2)} · friction × {calibration.flow.frictionFactor.toFixed(2)}</small></dd></div>
            <div><dt>Fluid</dt><dd>{calibration.fluid.api} °API · {calibration.fluid.gasSg}<small>{calibration.pvt ? `PVT factors ${calibration.pvt.pbFactor.toFixed(2)} / ${calibration.pvt.boFactor.toFixed(2)} / ${calibration.pvt.muFactor.toFixed(2)}` : "no lab report: unmatched"}</small></dd></div>
            <div><dt>Gauge error</dt><dd>±{fmt(Math.round(calibration.flow.mae))} psi<small>bias {calibration.flow.bias >= 0 ? "+" : ""}{fmt(Math.round(calibration.flow.bias))} psi</small></dd></div>
          </dl>
          <Slider label="Water cut" value={inputs.waterCut} min={0} max={0.95} step={0.01} show={(v) => `${Math.round(v * 100)}%`} onChange={(waterCut) => set({ waterCut })} />
        </> : <>
        <h3>Assumed <small>the design does not say</small><button type="button" className="cor-icon" aria-label="Back to the assumed values" onClick={() => setKept((k) => ({ ...k, inputs: defaultNodal }))}><RotateCcw size={11} /></button></h3>
        <Slider label="Oil gravity" value={inputs.api} min={15} max={50} step={1} show={(v) => `${v} °API`} onChange={(api) => set({ api })} />
        <Slider label="Gas–oil ratio" value={inputs.gor} min={50} max={2000} step={10} show={(v) => `${fmt(v)} scf/STB · ${fmt(Math.round(v * 0.178))} Sm³/Sm³`} onChange={(gor) => set({ gor })} />
        <Slider label="Water cut" value={inputs.waterCut} min={0} max={0.95} step={0.01} show={(v) => `${Math.round(v * 100)}%`} onChange={(waterCut) => set({ waterCut })} />
        <Slider label="Permeability" value={inputs.permeabilityMd} min={1} max={1000} step={1} log show={(v) => `${fmt(v)} mD`} onChange={(permeabilityMd) => set({ permeabilityMd })} />
        <Slider label="Skin" value={inputs.skin} min={-4} max={20} step={0.5} show={(v) => v.toFixed(1)} onChange={(skin) => set({ skin })} />
        </>}
        <h3>Operate</h3>
        <Slider label="Wellhead pressure" value={inputs.whpPsi} min={50} max={1500} step={10} show={(v) => `${fmt(v)} psig · ${Math.round(bar(v))} bar`} onChange={(whpPsi) => set({ whpPsi })} />
        {well.lift === "gas-lift" && <Slider label="Lift gas" value={inputs.liftMscfD} min={0} max={5000} step={50} show={(v) => `${fmt(v)} Mscf/d at ${fmt(Math.round(well.liftDepthMdM ?? 0))} m${injectionMdM !== null ? " (designed)" : ""}`} onChange={(liftMscfD) => set({ liftMscfD })} />}
        <Slider label={calibration ? "Further depletion" : "Depletion"} value={inputs.depletion} min={0} max={0.7} step={0.01} show={(v) => `${Math.round(v * 100)}% of ${calibration ? "today's" : "the initial"} pressure`} onChange={(depletion) => set({ depletion })} />
        <label className="nodal-field">Tubing<select id="nodal-tubing" value={inputs.tubingOdIn ?? ""} onChange={(event) => set({ tubingOdIn: event.target.value === "" ? null : Number(event.target.value) })}>
          <option value="">The design's ({well.tubingOdIn} in)</option>
          {COMPARE_VALUES.tubing.map((od) => <option key={od} value={od}>{od} in</option>)}
        </select></label>
        <h3>Compare</h3>
        <span className="log-sets nodal-compare" role="group" aria-label="Compare">
          {(["lift", "tubing", "waterCut", "whp"] as const).filter((c) => c !== "lift" || well.lift === "gas-lift").map((c) => <button key={c} type="button" aria-pressed={compare === c} onClick={() => setKept((k) => ({ ...k, compare: c }))}>{COMPARE_NAME[c]}</button>)}
        </span>
        <Sensitivity family={family} compare={compare} current={compare === "tubing" ? well.tubingOdIn : compare === "lift" ? inputs.liftMscfD : compare === "waterCut" ? inputs.waterCut : inputs.whpPsi} waterCut={inputs.waterCut} />
      </aside>
    </div>}
    <p className="petro-note">
      Inflow: Darcy pseudo-steady productivity index from the permeability, net pay and skin, Vogel below the bubble point, applied to total liquid. Outflow: Beggs &amp; Brill (Payne-corrected holdup) up the design&apos;s path, temperature along the geothermal gradient (cool for a flowing well, so conservative), lift gas joining just above the packer, or at the gas-lift design's operating valve once it is used.
      PVT: Standing, Vasquez–Beggs, Beggs–Robinson; gas Z by Dranchuk–Abou-Kassem. Rates are at stock-tank conditions.
    </p>
  </div>;
}

export function Slider({ label, value, min, max, step, show, onChange, log }: { readonly label: string; readonly value: number; readonly min: number; readonly max: number; readonly step: number; readonly show: (v: number) => string; readonly onChange: (v: number) => void; readonly log?: boolean }) {
  // A logarithmic slider for spans of decades (permeability): the thumb moves in log space.
  const to = (v: number) => log ? Math.log10(v) : v, from = (v: number) => log ? Math.round(10 ** v) : v;
  return <label className="nodal-slider"><span>{label}<b>{show(value)}</b></span>
    <input type="range" min={to(min)} max={to(max)} step={log ? 0.01 : step} value={to(value)} onChange={(event) => onChange(from(Number(event.target.value)))} aria-label={label} />
  </label>;
}

/** Inflow against outflow, with the compared family of outflow curves and where each meets the inflow. */
function NodalPlot({ solved, family, compare, well, test }: { readonly solved: Solved; readonly family: readonly { readonly value: number; readonly solved: Solved | null }[]; readonly compare: Compare; readonly well: WellCase; readonly test: { readonly rate: number; readonly pwf: number; readonly date: string } | null }) {
  const [box, size] = useSize<HTMLDivElement>();
  const W = Math.max(300, size.width), H = Math.max(240, size.height - 26), m = { l: 58, r: 16, t: 14, b: 34 };
  // The reservoir pressure the inflow is drawn from: the design's, or the match's.
  const { ipr } = solved, pr = ipr.pwf(0) ?? well.reservoir.pressure;
  const x = scaleLinear().domain([0, ipr.aof]).range([m.l, W - m.r]).nice();
  const y = scaleLinear().domain([0, pr * 1.08]).range([H - m.b, m.t]).nice();
  const iprPath = Array.from({ length: 80 }, (_, i) => { const q = ipr.aof * i / 79; return `${i ? "L" : "M"}${x(q).toFixed(1)},${y(ipr.pwf(q) ?? 0).toFixed(1)}`; }).join("");
  const curve = (s: Solved) => { let d = "", open = false; s.vlp.rates.forEach((q, i) => { const p = s.vlp.pressures[i]!; if (!Number.isFinite(p) || p > y.domain()[1]! * 1.2) { open = false; return; } d += `${open ? "L" : "M"}${x(q).toFixed(1)},${y(Math.min(p, y.domain()[1]!)).toFixed(1)}`; open = true; }); return d; };
  return <figure className="hz-section nodal-plot" ref={box}>
    <figcaption><b>Nodal</b><span>inflow (reservoir) against outflow (tubing) · bottom-hole pressure at the perforations</span></figcaption>
    <svg width={W} height={H}>
      <defs><clipPath id="nodal-clip"><rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} /></clipPath></defs>
      {y.ticks(6).map((t) => <g key={t}><line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="nodal-grid" /><text x={m.l - 6} y={y(t) + 3} textAnchor="end" className="vol-tick">{fmt(t)}</text></g>)}
      {x.ticks(6).map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={m.t} y2={H - m.b} className="nodal-grid" /><text x={x(t)} y={H - m.b + 14} textAnchor="middle" className="vol-tick">{fmt(t)}</text></g>)}
      <text x={(m.l + W - m.r) / 2} y={H - 4} textAnchor="middle" className="vol-tick">liquid rate, STB/d</text>
      <text transform={`translate(12,${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle" className="vol-tick">Pwf, psia</text>
      <g clipPath="url(#nodal-clip)">
        <line x1={m.l} x2={W - m.r} y1={y(solved.bubblePointPsi)} y2={y(solved.bubblePointPsi)} className="nodal-pb" />
        <text x={W - m.r - 4} y={y(solved.bubblePointPsi) - 4} textAnchor="end" className="nodal-pb-label">bubble point {fmt(Math.round(solved.bubblePointPsi))} psia</text>
        {family.map(({ value, solved: s }, i) => s && <g key={value} className="nodal-family" style={{ opacity: 0.35 + 0.65 * i / Math.max(1, family.length - 1) }}>
          <path d={curve(s)} className="nodal-vlp-alt" />
          {s.point && <circle cx={x(s.point.rate)} cy={y(s.point.pwf)} r={3.5} className="nodal-alt-point" />}
          {s.point && <text x={x(s.point.rate) + 5} y={y(s.point.pwf) - 5} className="vol-tick">{compareLabel(compare, value)}</text>}
        </g>)}
        <path d={iprPath} className="nodal-ipr" />
        <path d={curve(solved)} className="nodal-vlp" />
        {test && <g transform={`translate(${x(test.rate)},${y(test.pwf)})`} className="nodal-test-point"><path d="M-6,-6 L6,6 M-6,6 L6,-6" /><text x={9} y={14}>test {test.date}</text></g>}
        {solved.point && <g transform={`translate(${x(solved.point.rate)},${y(solved.point.pwf)})`} className="nodal-point"><circle r={6} /><text x={9} y={-9}>{fmt(Math.round(solved.point.rate))} STB/d</text></g>}
      </g>
      <g className="nodal-legend" transform={`translate(${W - m.r - 150},${m.t + 8})`}>
        <line x1={0} x2={18} y1={0} y2={0} className="nodal-ipr" /><text x={24} y={3}>Inflow (IPR)</text>
        <line x1={0} x2={18} y1={14} y2={14} className="nodal-vlp" /><text x={24} y={17}>Outflow (VLP)</text>
      </g>
      <text x={x(ipr.aof)} y={y(0) - 6} textAnchor="end" className="vol-tick">open flow {fmt(Math.round(ipr.aof))}</text>
    </svg>
  </figure>;
}

/** Pressure and temperature up the tubing at the operating rate, beside the well drawn by flow pattern and liquid holdup. */
function TraversePlot({ solved, well, inputs }: { readonly solved: Solved; readonly well: WellCase; readonly inputs: NodalInputs }) {
  const [box, size] = useSize<HTMLDivElement>();
  const W = Math.max(260, size.width), H = Math.max(240, size.height - 26), m = { l: 46, r: 14, t: 16, b: 34 }, strip = 46;
  const points = solved.traverse?.points ?? [];
  const tvdMax = well.midPerfTvdM;
  const y = scaleLinear().domain([0, tvdMax]).range([m.t, H - m.b]);
  const pr = solved.ipr.pwf(0) ?? well.reservoir.pressure, pMax = Math.max(pr, ...points.map((p) => p.p));
  const x = scaleLinear().domain([0, pMax]).range([m.l + strip + 14, W - m.r]).nice();
  const tAxis = scaleLinear().domain([60, well.reservoir.tempF + 20]).range([m.l + strip + 14, W - m.r]);
  const line = (value: (p: (typeof points)[number]) => number, scale: (v: number) => number) => points.map((p, i) => `${i ? "L" : "M"}${scale(value(p)).toFixed(1)},${y(p.tvdFt / FT_PER_M).toFixed(1)}`).join("");
  const pbDepth = points.find((p) => p.p >= solved.bubblePointPsi);
  const patterns = [...new Set(points.map((p) => p.pattern))];
  return <figure className="hz-section nodal-traverse" ref={box}>
    <figcaption><b>Up the tubing</b><span>{solved.point ? `at ${fmt(Math.round(solved.point.rate))} STB/d` : "no flow to draw"}</span></figcaption>
    <svg width={W} height={H}>
      {y.ticks(6).map((t) => <g key={t}><line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="nodal-grid" /><text x={m.l - 6} y={y(t) + 3} textAnchor="end" className="vol-tick">{fmt(t)}</text></g>)}
      <text transform={`translate(12,${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle" className="vol-tick">TVD, m</text>
      {x.ticks(4).map((t) => <text key={t} x={x(t)} y={H - m.b + 14} textAnchor="middle" className="vol-tick">{fmt(t)}</text>)}
      <text x={(x.range()[0]! + x.range()[1]!) / 2} y={H - 4} textAnchor="middle" className="vol-tick">pressure, psia</text>
      {/* The well: each step coloured by its flow pattern, filled by its liquid holdup. */}
      <g transform={`translate(${m.l + 6},0)`}>
        <rect x={0} y={y(0)} width={strip} height={y(tvdMax) - y(0)} rx={4} className="nodal-tube" />
        {points.slice(0, -1).map((p, i) => { const next = points[i + 1]!, top = y(p.tvdFt / FT_PER_M), h = Math.max(0.6, y(next.tvdFt / FT_PER_M) - top); return <g key={i}>
          <rect x={2} y={top} width={strip - 4} height={h} fill={PATTERN_COLOUR[p.pattern]} opacity={0.22} />
          <rect x={2} y={top} width={(strip - 4) * p.holdup} height={h} fill={PATTERN_COLOUR[p.pattern]} opacity={0.85} />
        </g>; })}
        {well.liftDepthMdM !== null && inputs.liftMscfD > 0 && (() => { const lt = points.reduce((best, p) => Math.abs(p.mdFt / FT_PER_M - well.liftDepthMdM!) < Math.abs(best.mdFt / FT_PER_M - well.liftDepthMdM!) ? p : best, points[0] ?? { mdFt: 0, tvdFt: 0 } as never); return <g transform={`translate(${strip + 2},${y(lt.tvdFt / FT_PER_M)})`} className="nodal-valve"><path d="M0,0 L8,-5 L8,5 Z" /><text x={11} y={3}>lift gas in</text></g>; })()}
      </g>
      {pbDepth && pbDepth.tvdFt > 0 && <g className="nodal-breakout"><line x1={m.l} x2={W - m.r} y1={y(pbDepth.tvdFt / FT_PER_M)} y2={y(pbDepth.tvdFt / FT_PER_M)} /><text x={W - m.r - 2} y={y(pbDepth.tvdFt / FT_PER_M) - 4} textAnchor="end">gas leaves the oil above {fmt(Math.round(pbDepth.tvdFt / FT_PER_M))} m</text></g>}
      <path d={line((p) => p.tempF, tAxis)} className="nodal-temp" />
      <path d={line((p) => p.p, x)} className="nodal-pressure" />
      <circle cx={x(pr)} cy={y(tvdMax)} r={4} className="nodal-pr" /><text x={x(pr) - 6} y={y(tvdMax) - 6} textAnchor="end" className="vol-tick">reservoir</text>
    </svg>
    <ul className="nodal-patterns">{patterns.map((p) => <li key={p}><i style={{ background: PATTERN_COLOUR[p] }} />{PATTERN_NAME[p]}</li>)}<li><i className="is-temp" />temperature</li><li className="nodal-holdup-key">bar width = liquid holdup</li></ul>
  </figure>;
}

/** How the rate moves with the compared input: for lift gas, the gas-lift performance curve. */
function Sensitivity({ family, compare, current, waterCut }: { readonly family: readonly { readonly value: number; readonly solved: Solved | null }[]; readonly compare: Compare; readonly current: number; readonly waterCut: number }) {
  const W = 268, H = 120, m = { l: 40, r: 8, t: 10, b: 26 };
  const oilOf = (s: Solved | null, value: number) => s?.point ? s.point.rate * (1 - (compare === "waterCut" ? value : waterCut)) : 0;
  const values = family.map((f) => f.value), rates = family.map((f) => oilOf(f.solved, f.value));
  const x = scaleLinear().domain([Math.min(...values), Math.max(...values)]).range([m.l, W - m.r]);
  const y = scaleLinear().domain([0, Math.max(1, ...rates) * 1.1]).range([H - m.b, m.t]).nice();
  const best = rates.indexOf(Math.max(...rates));
  return <figure className="nodal-sens">
    <figcaption>Oil rate against {COMPARE_NAME[compare].toLowerCase()}{compare === "lift" ? " · the gas-lift performance curve" : ""}</figcaption>
    <svg width={W} height={H}>
      {y.ticks(3).map((t) => <g key={t}><line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="nodal-grid" /><text x={m.l - 4} y={y(t) + 3} textAnchor="end" className="vol-tick">{fmt(t)}</text></g>)}
      <path d={values.map((v, i) => `${i ? "L" : "M"}${x(v).toFixed(1)},${y(rates[i]!).toFixed(1)}`).join("")} className="nodal-sens-line" />
      {values.map((v, i) => <g key={v}><circle cx={x(v)} cy={y(rates[i]!)} r={i === best ? 4.5 : 3} className={rates[i] ? "nodal-sens-dot" : "nodal-sens-dead"} />
        <text x={x(v)} y={H - m.b + 13} textAnchor="middle" className="vol-tick">{compare === "tubing" ? v : compare === "waterCut" ? `${Math.round(v * 100)}%` : fmt(v)}</text></g>)}
      <line x1={x(Math.min(Math.max(current, x.domain()[0]!), x.domain()[1]!))} x2={x(Math.min(Math.max(current, x.domain()[0]!), x.domain()[1]!))} y1={m.t} y2={H - m.b} className="vol-mark" />
    </svg>
  </figure>;
}
