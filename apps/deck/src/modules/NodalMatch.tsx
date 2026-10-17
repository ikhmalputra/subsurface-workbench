import { useState } from "react";
import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { scaleLinear, scaleTime } from "d3-scale";
import { CORRELATIONS, skinFromPi } from "@ikhmalputra/subsurface-core/production";
import type { LabPvt, WellTest } from "@ikhmalputra/subsurface-core/production";
import { FT_PER_M, SM3_PER_STB } from "../data/nodal-model.ts";
import type { NodalInputs, WellCase, runMatch } from "../data/nodal-model.ts";
import { fmt } from "../format.ts";
import { useSize } from "./useSize.ts";

/**
 * The match, as PROSPER and Pipesim run it before trusting a well model: the well's tests, the lab
 * PVT against the correlations, every tubing correlation against the gauges (untuned and tuned),
 * and the gauges measured against the model. Then its history: reservoir pressure, productivity,
 * skin and water, test by test.
 */

export type MatchResult = ReturnType<typeof runMatch>;
const psig = (psia: number) => psia - 14.7;
const correlationName = (id: string) => CORRELATIONS.find((c) => c.id === id)?.name ?? id;

export function MatchView({ tests, lab, synthetic, result, onTests, onLab, onMatch, stale }: {
  readonly tests: readonly WellTest[]; readonly lab: LabPvt | null; readonly synthetic: boolean; readonly result: MatchResult | null; readonly stale: boolean;
  readonly onTests: (tests: WellTest[]) => void; readonly onLab: (lab: LabPvt | null) => void; readonly onMatch: () => void;
}) {
  return <div className="nodal-match">
    <section className="nodal-card nodal-tests">
      <header><b>Well tests</b>{synthetic && <span className="nodal-synthetic" title="Generated from a hidden well model with measurement noise, to show the match. Replace with the well's own tests.">synthetic</span>}<small>{tests.length} tests · gauge and separator readings</small>
        <button type="button" className="tie-button" onClick={() => onTests([...tests, blankTest(tests.at(-1))])}><Plus size={12} aria-hidden="true" />Add test</button></header>
      <TestTable tests={tests} onTests={onTests} result={result} />
    </section>
    <section className="nodal-card nodal-lab">
      <header><b>PVT</b><small>lab report against the correlations</small></header>
      <LabTable lab={lab} result={result} onLab={onLab} />
    </section>
    <section className="nodal-card nodal-correlations">
      <header><b>Tubing correlations</b><small>against the gauges, before and after tuning</small></header>
      {result ? <table className="nodal-table">
        <thead><tr><th>Correlation</th><th>Untuned</th><th>Tuned</th><th>Holdup ×</th><th>Friction ×</th><th /></tr></thead>
        <tbody>{result.flow.all.map((c) => <tr key={c.id} data-chosen={c.id === result.flow.best.correlation || undefined}>
          <td>{c.name}</td><td>±{fmt(Math.round(c.untunedMae))} psi</td><td>±{fmt(Math.round(c.mae))} psi</td><td>{c.holdupFactor.toFixed(2)}</td><td>{c.frictionFactor.toFixed(2)}</td>
          <td>{c.id === result.flow.best.correlation ? "chosen" : ""}</td>
        </tr>)}</tbody>
      </table> : <p className="nodal-hint">Press Match to compare them.</p>}
      {result && <p className="nodal-hint">Chosen by tuned error; within 2 psi, the one whose factors stay nearest 1. Factors far from 1 mean the correlation, or the data, does not suit this well.</p>}
    </section>
    <section className="nodal-card nodal-fit">
      <header><b>Gauge: measured against model</b><small>each test with a gauge reading</small>
        <button type="button" className={`tie-button${stale || !result ? " is-primary" : ""}`} onClick={onMatch} disabled={!tests.length}>{result && !stale ? "Match again" : "Match"}</button></header>
      {result ? <GaugeFit result={result} /> : <p className="nodal-hint">Match fits the PVT to the lab, tunes every correlation to the gauges, and reads the inflow from each test. Prediction then uses the matched model.</p>}
    </section>
  </div>;
}

function blankTest(last?: WellTest): WellTest {
  return last ? { ...last, date: new Date().toISOString().slice(0, 10), reservoirPressure: null } : { date: new Date().toISOString().slice(0, 10), liquidRate: 1000, waterCut: 0.2, gor: 450, whp: 264.7, liftGasScfD: 0, gaugeMdFt: null, gaugePressure: null, reservoirPressure: null };
}

/** The tests, each value editable in place; metric beside the field units the correlations use. */
function TestTable({ tests, onTests, result }: { readonly tests: readonly WellTest[]; readonly onTests: (tests: WellTest[]) => void; readonly result: MatchResult | null }) {
  const set = (i: number, patch: Partial<WellTest>) => onTests(tests.map((test, k) => k === i ? { ...test, ...patch } : test));
  const num = (raw: string) => raw.trim() === "" ? null : Number(raw);
  const cell = (i: number, value: number | null, onChange: (v: number | null) => void, label: string, step = 1) =>
    <input type="number" step={step} value={value === null ? "" : Math.round(value * 100) / 100} aria-label={label} onChange={(event) => { const v = num(event.target.value); if (v === null || Number.isFinite(v)) onChange(v); }} />;
  return <div className="nodal-scroll"><table className="nodal-table is-edit">
    <thead><tr><th>Date</th><th>Liquid<small>STB/d</small></th><th>Water<small>%</small></th><th>GOR<small>scf/STB</small></th><th>WHP<small>psig</small></th><th>Lift gas<small>Mscf/d</small></th><th>Gauge<small>m MD</small></th><th>Gauge<small>psia</small></th><th>Build-up Pr<small>psia</small></th><th>PI<small>STB/d/psi</small></th><th /></tr></thead>
    <tbody>{tests.map((test, i) => <tr key={i}>
      <td><input type="date" value={test.date} aria-label="Test date" onChange={(event) => set(i, { date: event.target.value })} /></td>
      <td>{cell(i, test.liquidRate, (v) => set(i, { liquidRate: v ?? 0 }), "Liquid rate")}</td>
      <td>{cell(i, test.waterCut * 100, (v) => set(i, { waterCut: Math.min(0.99, Math.max(0, (v ?? 0) / 100)) }), "Water cut")}</td>
      <td>{cell(i, test.gor, (v) => set(i, { gor: v ?? 0 }), "Gas–oil ratio")}</td>
      <td>{cell(i, psig(test.whp), (v) => set(i, { whp: (v ?? 0) + 14.7 }), "Wellhead pressure")}</td>
      <td>{cell(i, test.liftGasScfD / 1000, (v) => set(i, { liftGasScfD: (v ?? 0) * 1000 }), "Lift gas")}</td>
      <td>{cell(i, test.gaugeMdFt === null ? null : test.gaugeMdFt / FT_PER_M, (v) => set(i, { gaugeMdFt: v === null ? null : v * FT_PER_M }), "Gauge depth")}</td>
      <td>{cell(i, test.gaugePressure, (v) => set(i, { gaugePressure: v }), "Gauge pressure")}</td>
      <td>{cell(i, test.reservoirPressure, (v) => set(i, { reservoirPressure: v }), "Build-up reservoir pressure")}</td>
      <td className="nodal-derived">{result?.byTest[i]?.pi ? result.byTest[i]!.pi!.toFixed(2) : "–"}</td>
      <td><button type="button" className="cor-icon" aria-label={`Delete the test of ${test.date}`} onClick={() => onTests(tests.filter((_, k) => k !== i))}><Trash2 size={11} /></button></td>
    </tr>)}</tbody>
  </table></div>;
}

/** The lab's numbers, editable, against the plain correlations and the factors the match puts between them. */
function LabTable({ lab, result, onLab }: { readonly lab: LabPvt | null; readonly result: MatchResult | null; readonly onLab: (lab: LabPvt | null) => void }) {
  const value: LabPvt = lab ?? { bubblePoint: 2500, rsb: 450, boAtPb: 1.3, muAtPb: 0.7, api: 35, gasSg: 0.75 };
  const set = (patch: Partial<LabPvt>) => onLab({ ...value, ...patch });
  const field = (key: keyof LabPvt, step: number) => <input type="number" step={step} value={value[key] ?? ""} aria-label={`Lab ${key}`} onChange={(event) => { const v = Number(event.target.value); if (event.target.value.trim() !== "" && Number.isFinite(v)) set({ [key]: v }); }} />;
  const pvt = result?.pvt;
  if (!lab) return <div className="nodal-hint">No lab report: the correlations stand unmatched. <button type="button" className="tie-button" onClick={() => onLab(value)}>Enter lab values</button></div>;
  return <table className="nodal-table is-edit">
    <thead><tr><th /><th>Lab</th><th>Correlation</th><th>Factor</th></tr></thead>
    <tbody>
      <tr><td>Oil gravity, °API</td><td>{field("api", 0.1)}</td><td colSpan={2} className="nodal-derived">replaces the assumed value</td></tr>
      <tr><td>Gas gravity</td><td>{field("gasSg", 0.01)}</td><td colSpan={2} className="nodal-derived">replaces the assumed value</td></tr>
      <tr><td>Solution GOR at Pb, scf/STB</td><td>{field("rsb", 1)}</td><td colSpan={2} className="nodal-derived">sets the bubble point the correlation is read at</td></tr>
      <tr><td>Bubble point, psia</td><td>{field("bubblePoint", 1)}</td><td>{pvt ? fmt(Math.round(pvt.correlation.bubblePoint)) : "–"}</td><td>{pvt ? pvt.tuning.pbFactor.toFixed(3) : "–"}</td></tr>
      <tr><td>Bo at Pb, rb/STB</td><td>{field("boAtPb", 0.001)}</td><td>{pvt ? pvt.correlation.boAtPb.toFixed(3) : "–"}</td><td>{pvt ? pvt.tuning.boFactor.toFixed(3) : "–"}</td></tr>
      <tr><td>Oil viscosity at Pb, cp</td><td>{field("muAtPb", 0.01)}</td><td>{pvt ? pvt.correlation.muAtPb.toFixed(2) : "–"}</td><td>{pvt ? pvt.tuning.muFactor.toFixed(3) : "–"}</td></tr>
    </tbody>
  </table>;
}

/** Each gauge reading against the model's, before tuning (plain Beggs & Brill) and after (the chosen correlation, tuned). */
function GaugeFit({ result }: { readonly result: MatchResult }) {
  const [box, size] = useSize<HTMLDivElement>();
  const W = Math.max(240, size.width), H = Math.max(200, Math.min(320, size.width * 0.75)), m = 40;
  const points = (rows: MatchResult["after"]["rows"]) => rows.filter((r) => r.model !== null).map((r) => ({ measured: r.test.gaugePressure!, model: r.model! }));
  const before = points(result.before.rows), after = points(result.after.rows), all = [...before, ...after].flatMap((p) => [p.measured, p.model]);
  if (!all.length) return <p className="nodal-hint">No test has a gauge reading: the tubing cannot be matched, only assumed.</p>;
  const lo = Math.min(...all) * 0.98, hi = Math.max(...all) * 1.02;
  const x = scaleLinear().domain([lo, hi]).range([m, W - 10]).nice(), y = scaleLinear().domain(x.domain()).range([H - m + 10, 10]);
  const band = result.flow.best.mae;
  return <div ref={box} className="nodal-fit-plot">
    <svg width={W} height={H}>
      {x.ticks(4).map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={10} y2={H - m + 10} className="nodal-grid" /><text x={x(t)} y={H - m + 24} textAnchor="middle" className="vol-tick">{fmt(t)}</text>
        <line x1={m} x2={W - 10} y1={y(t)} y2={y(t)} className="nodal-grid" /><text x={m - 4} y={y(t) + 3} textAnchor="end" className="vol-tick">{fmt(t)}</text></g>)}
      <path d={`M${x(lo)},${y(lo + band)} L${x(hi)},${y(hi + band)} L${x(hi)},${y(hi - band)} L${x(lo)},${y(lo - band)} Z`} className="nodal-fit-band" />
      <line x1={x(lo)} x2={x(hi)} y1={y(lo)} y2={y(hi)} className="nodal-fit-line" />
      {before.map((p, i) => <circle key={`b${i}`} cx={x(p.measured)} cy={y(p.model)} r={3.5} className="nodal-fit-before" />)}
      {after.map((p, i) => <circle key={`a${i}`} cx={x(p.measured)} cy={y(p.model)} r={4.5} className="nodal-fit-after" />)}
      <text x={(m + W - 10) / 2} y={H - 4} textAnchor="middle" className="vol-tick">measured, psia</text>
      <text transform={`translate(10,${(10 + H - m) / 2}) rotate(-90)`} textAnchor="middle" className="vol-tick">model, psia</text>
    </svg>
    <ul className="nodal-patterns"><li><i className="nodal-key-before" />Beggs &amp; Brill untuned · ±{fmt(Math.round(result.before.mae))} psi</li><li><i className="nodal-key-after" />{correlationName(result.flow.best.correlation)} tuned · ±{fmt(Math.round(band))} psi (band)</li></ul>
  </div>;
}

/**
 * The well over time, from its tests: reservoir pressure (build-ups and the trend between them),
 * productivity index, the skin it implies at an assumed permeability, water cut, and the rates.
 * A falling PI with steady pressure is damage (skin); with falling pressure, depletion.
 */
export function HistoryView({ result, well, inputs }: { readonly result: MatchResult | null; readonly well: WellCase; readonly inputs: NodalInputs }) {
  const [k, setK] = useState(inputs.permeabilityMd);
  if (!result) return <p className="hz-empty">Match the tests first: the history is read from them.</p>;
  const rows = result.byTest.filter((row) => row.pi !== null).sort((a, b) => Date.parse(a.test.date) - Date.parse(b.test.date));
  const dates = rows.map((row) => new Date(row.test.date));
  const skin = rows.map((row) => skinFromPi(row.pi!, { ...well.reservoir, pressure: row.reservoirPressure, permeabilityMd: k }, result.model.fluid));
  return <div className="nodal-history">
    <Trend title="Reservoir pressure" unit="psia" dates={dates} series={[{ values: rows.map((r) => r.reservoirPressure), className: "is-pressure", dots: rows.map((r) => r.pressureMeasured) }]} note="filled: build-up · open: between build-ups" />
    <Trend title="Productivity index" unit="STB/d/psi" dates={dates} series={[{ values: rows.map((r) => r.pi!), className: "is-pi" }]} note="from each test's rate and flowing pressure" />
    <Trend title="Skin" unit="" dates={dates} series={[{ values: skin, className: "is-skin" }]} note={<label className="nodal-k">at k <input type="number" min={0.1} step={1} value={k} onChange={(event) => { const v = Number(event.target.value); if (v > 0) setK(v); }} aria-label="Permeability for skin" /> mD — rate alone cannot tell k from skin</label>} />
    <Trend title="Rates" unit="STB/d" dates={dates} series={[{ values: rows.map((r) => r.test.liquidRate), className: "is-liquid" }, { values: rows.map((r) => r.test.liquidRate * (1 - r.test.waterCut)), className: "is-oil" }]} note={`liquid and oil · last oil ${fmt(Math.round(rows.at(-1)!.test.liquidRate * (1 - rows.at(-1)!.test.waterCut) * SM3_PER_STB))} Sm³/d`} />
    <Trend title="Water cut" unit="%" dates={dates} series={[{ values: rows.map((r) => r.test.waterCut * 100), className: "is-water" }]} note="" />
  </div>;
}

function Trend({ title, unit, dates, series, note }: { readonly title: string; readonly unit: string; readonly dates: readonly Date[]; readonly series: readonly { readonly values: readonly number[]; readonly className: string; readonly dots?: readonly boolean[] }[]; readonly note: ReactNode }) {
  const [box, size] = useSize<HTMLDivElement>();
  const W = Math.max(220, size.width), H = 150, m = { l: 46, r: 10, t: 10, b: 22 };
  const values = series.flatMap((s) => s.values).filter(Number.isFinite);
  const x = scaleTime().domain([dates[0]!, dates.at(-1)!]).range([m.l, W - m.r]);
  const y = scaleLinear().domain([Math.min(0, ...values), Math.max(...values) * 1.08]).range([H - m.b, m.t]).nice();
  return <figure className="nodal-card nodal-trend" ref={box}>
    <figcaption><b>{title}</b>{unit && <small>{unit}</small>}</figcaption>
    <svg width={W} height={H}>
      {y.ticks(3).map((t) => <g key={t}><line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="nodal-grid" /><text x={m.l - 4} y={y(t) + 3} textAnchor="end" className="vol-tick">{fmt(t)}</text></g>)}
      {x.ticks(4).map((t) => <text key={t.toISOString()} x={x(t)} y={H - 6} textAnchor="middle" className="vol-tick">{t.toISOString().slice(0, 7)}</text>)}
      {series.map((s) => <g key={s.className} className={`nodal-trend-series ${s.className}`}>
        <path d={s.values.map((v, i) => `${i ? "L" : "M"}${x(dates[i]!).toFixed(1)},${y(v).toFixed(1)}`).join("")} />
        {s.values.map((v, i) => <circle key={i} cx={x(dates[i]!)} cy={y(v)} r={3.2} data-open={s.dots && !s.dots[i] ? "" : undefined} />)}
      </g>)}
    </svg>
    {note && <p className="nodal-hint">{note}</p>}
  </figure>;
}
