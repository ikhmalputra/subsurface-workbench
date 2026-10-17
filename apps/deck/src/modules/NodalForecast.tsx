import { scaleLinear } from "d3-scale";
import { cumulativeOn, tankPressure } from "@ikhmalputra/subsurface-core/production";
import type { ProductionMonth, Tank } from "@ikhmalputra/subsurface-core/production";
import { ROCK_RANGE } from "../data/nodal-model.ts";
import type { forecastCases, tankMatch } from "../data/nodal-model.ts";
import { fmt } from "../format.ts";
import { useSize } from "./useSize.ts";

/**
 * The forecast as IPM runs it: a tank matched to the build-up pressures against the allocated
 * production (STOIIP and aquifer, with the fits the pressures cannot tell apart), the water from
 * the WOR trend, the well's lift curves from the matched tubing model, then month by month to the
 * horizon, naturally and on gas lift.
 */

type Matched = ReturnType<typeof tankMatch>;
type Cases = ReturnType<typeof forecastCases>;
type Run = Cases["natural"];
const MM = 1e6;
export const cumOil = (run: Run | null) => run ? run.steps.reduce((sum, s, i) => sum + s.oil * daysIn(s.date, run.steps[i + 1]?.date ?? run.endDate), 0) : 0;
const daysIn = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;

/** Reservoir pressure against cumulative oil, measured and by the tank; and the candidate tanks. */
export function TankCard({ matched, tank, aquifer, onAquifer, production, synthetic }: { readonly matched: Matched; readonly tank: Tank; readonly aquifer: number | null; readonly onAquifer: (a: number | null) => void; readonly production: readonly ProductionMonth[]; readonly synthetic: boolean }) {
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
export function WorCard({ cases }: { readonly cases: Cases }) {
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
