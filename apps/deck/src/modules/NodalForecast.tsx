import { scaleLinear, scaleTime } from "d3-scale";
import { cumulativeOn, tankPressure } from "@ikhmalputra/subsurface-core/production";
import type { ProductionMonth, Tank, WellTest } from "@ikhmalputra/subsurface-core/production";
import { ROCK_RANGE, TANK_ASSUMED } from "../data/nodal-model.ts";
import type { ForecastInputs, NodalInputs, WellCase, forecastBand, forecastCases, injectionCheck, tankMatch } from "../data/nodal-model.ts";
import { fmt } from "../format.ts";
import { useSize } from "./useSize.ts";
import { Slider } from "./Nodal.tsx";

/**
 * The forecast as IPM runs it: a tank matched to the build-up pressures against the allocated
 * production (STOIIP and aquifer, with the fits the pressures cannot tell apart), the water from
 * the WOR trend, the well's lift curves from the matched tubing model, then month by month to the
 * horizon, naturally and on gas lift.
 */

type Matched = ReturnType<typeof tankMatch>;
type Cases = ReturnType<typeof forecastCases>;
type Band = ReturnType<typeof forecastBand>;
type Run = Cases["natural"];
const MM = 1e6;
const cumOil = (run: Run | null) => run ? run.steps.reduce((sum, s, i) => sum + s.oil * daysIn(s.date, run.steps[i + 1]?.date ?? run.endDate), 0) : 0;
const daysIn = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;
const year = (date: string) => date.slice(0, 7);

export function ForecastView({ matched, tank, aquifer, onAquifer, cases, band, entry, f, onForecast, inputs, onInputs, well, tests, production, synthetic }: {
  readonly matched: Matched; readonly tank: Tank; readonly aquifer: number | null; readonly onAquifer: (aquifer: number | null) => void;
  readonly cases: Cases; readonly band: Band; readonly entry: ReturnType<typeof injectionCheck>; readonly f: ForecastInputs; readonly onForecast: (patch: Partial<ForecastInputs>) => void;
  readonly inputs: NodalInputs; readonly onInputs: (patch: Partial<NodalInputs>) => void; readonly well: WellCase;
  readonly tests: readonly WellTest[]; readonly production: readonly ProductionMonth[]; readonly synthetic: boolean;
}) {
  const natural = cumOil(cases.natural), lifted = cases.lifted ? cumOil(cases.lifted) : null;
  const np0 = cases.start.np;
  // Across the tanks the pressures cannot tell apart.
  const span = (pick: (c: Cases) => Run | null) => { const v = [band.low, band.high, cases].map((c) => cumOil(pick(c))); return [Math.min(...v), Math.max(...v)] as const; };
  const natSpan = span((c) => c.natural), liftSpan = cases.lifted ? span((c) => c.lifted) : null;
  const k = (v: number) => fmt(Math.round(v / 1e3));
  const rf = (c: Cases, stoiip: number) => (np0 + Math.max(cumOil(c.natural), c.lifted ? cumOil(c.lifted) : 0)) / stoiip * 100;
  const rfs = [rf(band.low, band.tanks.low.stoiip), rf(band.high, band.tanks.high.stoiip), rf(cases, tank.stoiip)];
  const ends = (run: Run) => run.end === "horizon" ? `flows past ${year(run.endDate)}` : run.end === "dead" ? `dies ${year(run.endDate)}` : `below ${fmt(f.economicLimit)} STB/d ${year(run.endDate)}`;
  return <div className="nodal-forecast">
    <div className="nodal-forecast-left">
      <TankCard matched={matched} tank={tank} aquifer={aquifer} onAquifer={onAquifer} production={production} synthetic={synthetic} />
      <WorCard cases={cases} />
    </div>
    <ForecastChart cases={cases} band={band} production={production} tests={tests} />
    <aside className="nodal-inputs">
      <h3>Outlook <small>from {cases.natural.steps[0]?.date ?? "the last test"}</small></h3>
      <dl className="nodal-design">
        <div><dt>Natural flow</dt><dd>{k(natural)} kSTB<small>{k(natSpan[0])}–{k(natSpan[1])} across the tanks · {ends(cases.natural)}</small></dd></div>
        {cases.lifted && lifted !== null && liftSpan && <div><dt>On gas lift</dt><dd className={entry && !entry.ok ? "is-warn" : ""}>{k(lifted)} kSTB<small>{entry && !entry.ok ? `gas cannot enter at ${fmt(Math.round(well.liftDepthMdM ?? 0))} m: not a real case` : `${k(liftSpan[0])}–${k(liftSpan[1])} · ${fmt(inputs.liftMscfD)} Mscf/d at ${fmt(Math.round(well.liftDepthMdM ?? 0))} m · ${ends(cases.lifted)}`}</small></dd></div>}
        {lifted !== null && (!entry || entry.ok) && <div><dt>Gas lift adds</dt><dd className="is-gain">+{k(lifted - natural)} kSTB<small>over {f.years} years</small></dd></div>}
        <div><dt>Recovery</dt><dd>{Math.min(...rfs).toFixed(0)}–{Math.max(...rfs).toFixed(0)}%<small>of {fmt(Math.round(band.tanks.low.stoiip / MM))}–{fmt(Math.round(band.tanks.high.stoiip / MM))} MMSTB: as uncertain as the oil in place</small></dd></div>
      </dl>
      <h3>Forecast</h3>
      <Slider label="Horizon" value={f.years} min={2} max={25} step={1} show={(v) => `${v} years`} onChange={(years) => onForecast({ years })} />
      <Slider label="Economic limit" value={f.economicLimit} min={50} max={2000} step={25} show={(v) => `${fmt(v)} STB/d oil`} onChange={(economicLimit) => onForecast({ economicLimit })} />
      <Slider label="Facility liquid" value={f.maxLiquid} min={2000} max={30000} step={500} show={(v) => `${fmt(v)} STB/d`} onChange={(maxLiquid) => onForecast({ maxLiquid })} />
      <h3>Operate</h3>
      <Slider label="Wellhead pressure" value={inputs.whpPsi} min={50} max={1500} step={10} show={(v) => `${fmt(v)} psig`} onChange={(whpPsi) => onInputs({ whpPsi })} />
      {well.lift === "gas-lift" && <Slider label="Lift gas" value={inputs.liftMscfD} min={0} max={5000} step={50} show={(v) => `${fmt(v)} Mscf/d`} onChange={(liftMscfD) => onInputs({ liftMscfD })} />}
      <p className="nodal-hint">
        Held: the last test&apos;s productivity index (Vogel below the bubble point), the matched fluid and tubing correlation. Assumed: Swi {TANK_ASSUMED.swi}, cw {TANK_ASSUMED.cw * 1e6}×10⁻⁶ and cf {TANK_ASSUMED.cf * 1e6}×10⁻⁶ /psi, Corey gas–oil curves (Sgc 0.05). A tank: one pressure, so no coning, interference or layering.
      </p>
    </aside>
  </div>;
}

/** Reservoir pressure against cumulative oil, measured and by the tank; and the candidate tanks. */
function TankCard({ matched, tank, aquifer, onAquifer, production, synthetic }: { readonly matched: Matched; readonly tank: Tank; readonly aquifer: number | null; readonly onAquifer: (a: number | null) => void; readonly production: readonly ProductionMonth[]; readonly synthetic: boolean }) {
  const [box, size] = useSize<HTMLDivElement>();
  const W = Math.max(260, size.width - 20), H = 150, m = { l: 44, r: 10, t: 10, b: 28 };
  // The tank's pressure along the production as it happened: the allocated volumes month by month.
  const path = production.length ? production.map((row) => cumulativeOn(production, `${row.month}-28`)) : [];
  const line = [{ np: 0, wp: 0, gp: 0 }, ...path].map((c) => ({ np: c.np, p: tankPressure(tank, c) }));
  const pts = matched.points;
  const npMax = Math.max(1, ...line.map((l) => l.np), ...pts.map((p) => p.np));
  const ps = [...line.map((l) => l.p), ...pts.map((p) => p.measured)];
  const x = scaleLinear().domain([0, npMax / MM]).range([m.l, W - m.r]).nice();
  const y = scaleLinear().domain([Math.min(...ps) - 100, Math.max(...ps) + 50]).range([H - m.b, m.t]).nice();
  const err = Math.sqrt(pts.reduce((sum, p) => sum + (tankPressure(tank, p) - p.measured) ** 2, 0) / Math.max(1, pts.length));
  return <section className="nodal-card" ref={box}>
    <header><b>Tank match</b>{synthetic && <span className="nodal-synthetic">synthetic</span>}<small>{production.length ? `${production.length} months allocated` : "volumes from the tests"} · {pts.length} build-ups · RMS {Math.round(err)} psi</small></header>
    <svg width={W} height={H}>
      {y.ticks(4).map((t) => <g key={t}><line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="nodal-grid" /><text x={m.l - 5} y={y(t) + 3} textAnchor="end" className="vol-tick">{fmt(t)}</text></g>)}
      {x.ticks(5).map((t) => <text key={t} x={x(t)} y={H - m.b + 13} textAnchor="middle" className="vol-tick">{t}</text>)}
      <text x={(m.l + W - m.r) / 2} y={H - 2} textAnchor="middle" className="vol-tick">cumulative oil, MMSTB</text>
      <text transform={`translate(10,${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle" className="vol-tick">Pr, psia</text>
      <path d={line.map((l, i) => `${i ? "L" : "M"}${x(l.np / MM).toFixed(1)},${y(l.p).toFixed(1)}`).join("")} className="nodal-fc-tank" />
      {pts.map((p) => <circle key={p.date} cx={x(p.np / MM)} cy={y(p.measured)} r={4} className="nodal-fc-meas"><title>{p.date}: {fmt(p.measured)} psia measured, {fmt(Math.round(tankPressure(tank, p)))} by the tank</title></circle>)}
    </svg>
    <table className="nodal-table nodal-tanks">
      <thead><tr><th>Aquifer<small>× oil pore volume</small></th><th>STOIIP<small>MMSTB</small></th><th>Fit<small>RMS psi</small></th><th /></tr></thead>
      <tbody>{[{ ...matched.best, within: true }, ...matched.all.filter((a) => Math.abs(a.aquifer - matched.best.aquifer) > 1e-6)].sort((a, b) => a.aquifer - b.aquifer).map((a) => {
        const isBest = Math.abs(a.aquifer - matched.best.aquifer) < 1e-9, picked = Math.abs(a.aquifer - tank.aquifer) < 1e-6;
        return <tr key={a.aquifer} data-chosen={picked || undefined} data-out={!a.within || undefined} onClick={() => onAquifer(isBest ? null : a.aquifer)} className="nodal-tank-row">
          <td>{a.aquifer === 0 ? "none" : `${Number(a.aquifer.toFixed(2))}×`}</td><td>{fmt(Math.round(a.stoiip / MM))}</td><td>{a.mae.toFixed(0)}</td>
          <td>{isBest ? "best fit" : a.within ? "within 95%" : "ruled out"}{picked && aquifer !== null ? " · picked" : ""}</td>
        </tr>;
      })}</tbody>
    </table>
    <p className="nodal-hint">
      {matched.range.stoiip[1] / matched.range.stoiip[0] > 1.15
        ? `Within the build-ups' accuracy (±${Math.round(matched.sigma)} psi) the pressures fit ${fmt(Math.round(matched.range.stoiip[0] / MM))}–${fmt(Math.round(matched.range.stoiip[1] / MM))} MMSTB, oil in place traded against aquifer: the forecast is drawn across that range. More pressure history, a volumetric STOIIP or the aquifer's geology narrows it.`
        : "The pressures pin the oil in place: the other tanks fit clearly worse."}
      {" "}The rock is assumed: across pore compressibility {ROCK_RANGE[0] * 1e6}–{ROCK_RANGE[1] * 1e6}×10⁻⁶ /psi the best fit moves {fmt(Math.round(Math.min(...matched.rock.map((r) => r.stoiip)) / MM))}–{fmt(Math.round(Math.max(...matched.rock.map((r) => r.stoiip)) / MM))} MMSTB.
      {" "}Initial pressure {fmt(Math.round(matched.initialPressure))} psia, {matched.initialMeasured ? "the first build-up" : "from the design's pore pressure (no initial build-up)"}.
    </p>
  </section>;
}

/** ln(WOR) against cumulative oil, and the trend the forecast carries on. */
function WorCard({ cases }: { readonly cases: Cases }) {
  const [box, size] = useSize<HTMLDivElement>();
  const W = Math.max(260, size.width - 20), H = 120, m = { l: 44, r: 10, t: 10, b: 28 };
  const wor = cases.wor, run = cases.lifted ?? cases.natural;
  const npEnd = Math.max(...wor.points.map((p) => p.x), run.final.np);
  const x = scaleLinear().domain([0, npEnd / MM]).range([m.l, W - m.r]).nice();
  const ys = [...wor.points.map((p) => p.y), wor.intercept + wor.slope * npEnd];
  const y = scaleLinear().domain([Math.min(-3, ...ys), Math.max(1, ...ys)]).range([H - m.b, m.t]).nice();
  const half = wor.slope > 0 ? -wor.intercept / wor.slope : null;
  return <section className="nodal-card" ref={box}>
    <header><b>Water</b><small>ln(WOR) against cumulative oil · the trend carries the forecast</small></header>
    <svg width={W} height={H}>
      {y.ticks(4).map((t) => <g key={t}><line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="nodal-grid" /><text x={m.l - 5} y={y(t) + 3} textAnchor="end" className="vol-tick">{t}</text></g>)}
      {x.ticks(5).map((t) => <text key={t} x={x(t)} y={H - m.b + 13} textAnchor="middle" className="vol-tick">{t}</text>)}
      <text x={(m.l + W - m.r) / 2} y={H - 2} textAnchor="middle" className="vol-tick">cumulative oil, MMSTB</text>
      <line x1={m.l} x2={W - m.r} y1={y(0)} y2={y(0)} className="nodal-fc-half" /><text x={W - m.r - 2} y={y(0) - 3} textAnchor="end" className="vol-tick">50% water</text>
      <line x1={x(0)} y1={y(wor.intercept)} x2={x(npEnd / MM)} y2={y(wor.intercept + wor.slope * npEnd)} className="nodal-fc-trend" />
      {wor.points.map((p, i) => <circle key={i} cx={x(p.x / MM)} cy={y(p.y)} r={3.5} className="nodal-fc-meas" />)}
    </svg>
    <p className={`nodal-hint${wor.early ? " is-warn" : ""}`}>{wor.early ? "The water cut has not reached 50%: the WOR trend is early and usually steepens; read the water forecast as optimistic." : "Fitted on the tests above 0% water; the straight line is the industry's extrapolation, not a model."}{half !== null && half > 0 ? ` 50% water at ${(half / MM).toFixed(1)} MMSTB.` : ""}</p>
  </section>;
}

/** Oil rate through time: the allocated history, the tests, and both forecasts; reservoir pressure and water cut beneath. */
function ForecastChart({ cases, band, production, tests }: { readonly cases: Cases; readonly band: Band; readonly production: readonly ProductionMonth[]; readonly tests: readonly WellTest[] }) {
  const [box, size] = useSize<HTMLDivElement>();
  const W = Math.max(320, size.width), total = Math.max(320, size.height - 64), H1 = Math.round(total * 0.62), H2 = total - H1, m = { l: 52, r: 44, t: 12, b: 26 };
  const runs = [cases.natural, cases.lifted].filter((r): r is Run => !!r);
  const first = production[0] ? `${production[0].month}-01` : tests[0]?.date ?? cases.natural.steps[0]?.date ?? "2024-01-01";
  const last = runs.reduce((d, r) => r.endDate > d ? r.endDate : d, cases.natural.steps.at(-1)?.date ?? first);
  const x = scaleTime().domain([new Date(first), new Date(last)]).range([m.l, W - m.r]);
  const history = production.map((row) => { const a = `${row.month}-01`, end = new Date(a); end.setUTCMonth(end.getUTCMonth() + 1); return { date: a, mid: new Date(Date.parse(a) + (end.getTime() - Date.parse(a)) / 2), oil: row.oil / daysIn(a, end.toISOString().slice(0, 10)) }; });
  const oilMax = Math.max(1, ...history.map((h) => h.oil), ...tests.map((t) => t.liquidRate * (1 - t.waterCut)), ...runs.flatMap((r) => r.steps.map((s) => s.oil)));
  const y = scaleLinear().domain([0, oilMax * 1.08]).range([H1 - m.b, m.t]).nice();
  const pAll = [...tests.flatMap((t) => t.reservoirPressure === null ? [] : [t.reservoirPressure]), ...runs.flatMap((r) => r.steps.map((s) => s.pressure))];
  const yp = scaleLinear().domain([Math.min(...pAll) - 100, Math.max(...pAll) + 100]).range([H2 - m.b, m.t]).nice();
  const yw = scaleLinear().domain([0, 1]).range([H2 - m.b, m.t]);
  const now = cases.natural.steps[0]?.date ?? first;
  const pathOf = (r: Run, value: (s: Run["steps"][number]) => number, scale: (v: number) => number) => r.steps.map((s, i) => `${i ? "L" : "M"}${x(new Date(s.date)).toFixed(1)},${scale(value(s)).toFixed(1)}`).join("");
  const cls = (r: Run) => r === cases.lifted ? "is-lift" : "is-natural";
  return <figure className="hz-section nodal-forecast-chart" ref={box}>
    <figcaption><b>Forecast</b><span>oil rate, monthly · history from the allocated volumes and the tests</span></figcaption>
    <svg width={W} height={H1}>
      {y.ticks(5).map((t) => <g key={t}><line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="nodal-grid" /><text x={m.l - 6} y={y(t) + 3} textAnchor="end" className="vol-tick">{fmt(t)}</text></g>)}
      {x.ticks(8).map((t) => <text key={t.getTime()} x={x(t)} y={H1 - m.b + 14} textAnchor="middle" className="vol-tick">{t.getUTCFullYear()}</text>)}
      <text transform={`translate(12,${(m.t + H1 - m.b) / 2}) rotate(-90)`} textAnchor="middle" className="vol-tick">oil, STB/d</text>
      <rect x={m.l} y={m.t} width={Math.max(0, x(new Date(now)) - m.l)} height={H1 - m.b - m.t} className="nodal-fc-past" />
      <line x1={x(new Date(now))} x2={x(new Date(now))} y1={m.t} y2={H1 - m.b} className="vol-mark" /><text x={x(new Date(now)) + 4} y={m.t + 10} className="vol-tick">last test</text>
      {history.length > 0 && <path d={history.map((h, i) => `${i ? "L" : "M"}${x(h.mid).toFixed(1)},${y(h.oil).toFixed(1)}`).join("")} className="nodal-fc-history" />}
      {tests.map((t) => <circle key={t.date} cx={x(new Date(t.date))} cy={y(t.liquidRate * (1 - t.waterCut))} r={3.5} className="nodal-fc-test"><title>Test {t.date}: {fmt(Math.round(t.liquidRate * (1 - t.waterCut)))} STB/d oil</title></circle>)}
      {/* The band: the same case on the smallest and largest tank the pressures allow. */}
      {([["natural", band.low.natural, band.high.natural], ["lift", band.low.lifted, band.high.lifted]] as const).map(([name, a, b]) => {
        if (!a || !b) return null;
        const upper = a.steps.length >= b.steps.length ? a : b, lower = upper === a ? b : a;
        const top = upper.steps.map((s, i) => `${i ? "L" : "M"}${x(new Date(s.date)).toFixed(1)},${y(Math.max(s.oil, lower.steps[i]?.oil ?? 0)).toFixed(1)}`).join("");
        const under = upper.steps.map((s, i) => `L${x(new Date(s.date)).toFixed(1)},${y(Math.min(s.oil, lower.steps[i]?.oil ?? 0)).toFixed(1)}`).reverse().join("");
        return <path key={name} d={`${top}${under}Z`} className={`nodal-fc-band is-${name}`} />;
      })}
      {runs.map((r) => <path key={cls(r)} d={pathOf(r, (s) => s.oil, y)} className={`nodal-fc-run ${cls(r)}`} />)}
      {runs.filter((r) => r.end !== "horizon").map((r) => <g key={cls(r)} transform={`translate(${x(new Date(r.endDate))},${y(r.steps.at(-1)?.oil ?? 0)})`} className={`nodal-fc-end ${cls(r)}`}><circle r={4} /><text x={-6} y={-8} textAnchor="end">{r.end === "dead" ? "dies" : "economic limit"} {year(r.endDate)}</text></g>)}
    </svg>
    <svg width={W} height={H2}>
      {yp.ticks(3).map((t) => <g key={t}><line x1={m.l} x2={W - m.r} y1={yp(t)} y2={yp(t)} className="nodal-grid" /><text x={m.l - 6} y={yp(t) + 3} textAnchor="end" className="vol-tick">{fmt(t)}</text></g>)}
      {[0, 0.5, 1].map((t) => <text key={t} x={W - m.r + 6} y={yw(t) + 3} className="vol-tick">{t * 100}%</text>)}
      {x.ticks(8).map((t) => <text key={t.getTime()} x={x(t)} y={H2 - m.b + 14} textAnchor="middle" className="vol-tick">{t.getUTCFullYear()}</text>)}
      <text transform={`translate(12,${(m.t + H2 - m.b) / 2}) rotate(-90)`} textAnchor="middle" className="vol-tick">Pr, psia</text>
      <line x1={x(new Date(now))} x2={x(new Date(now))} y1={m.t} y2={H2 - m.b} className="vol-mark" />
      {runs.map((r) => <path key={`p-${cls(r)}`} d={pathOf(r, (s) => s.pressure, yp)} className={`nodal-fc-run is-thin ${cls(r)}`} />)}
      {runs.map((r) => <path key={`w-${cls(r)}`} d={pathOf(r, (s) => s.waterCut, yw)} className={`nodal-fc-water ${cls(r)}`} />)}
      {tests.filter((t) => t.reservoirPressure !== null).map((t) => <circle key={t.date} cx={x(new Date(t.date))} cy={yp(t.reservoirPressure!)} r={3.5} className="nodal-fc-meas" />)}
      {tests.map((t) => <rect key={`w${t.date}`} x={x(new Date(t.date)) - 2.5} y={yw(t.waterCut) - 2.5} width={5} height={5} className="nodal-fc-wtest" />)}
    </svg>
    <ul className="nodal-patterns">
      <li><i className="is-history" />allocated history</li><li><i className="is-test" />tests</li><li><i className="is-natural" />natural flow</li>{cases.lifted && <li><i className="is-flowing" />gas lift</li>}
      <li><i className="is-band" />range across the tanks</li><li><i className="is-meas" />build-up Pr</li><li><i className="is-water" />water cut (right axis)</li>
    </ul>
  </figure>;
}
