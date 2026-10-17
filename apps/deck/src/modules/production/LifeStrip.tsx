import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { scaleLinear, scaleTime } from "d3-scale";
import type { ProductionMonth, WellTest } from "@ikhmalputra/subsurface-core/production";
import type { forecastBand } from "../../data/nodal-model.ts";
import { fmt } from "../../format.ts";
import { useSize } from "../useSize.ts";

type Band = ReturnType<typeof forecastBand>;
type Run = Band["main"]["natural"];
const DAY = 86400000;

/**
 * The well's life in one strip: oil from the allocated months and the tests, then the forecast on
 * either case with its band across the tanks the pressures cannot tell apart. The playhead is the
 * deck's time cursor: drag it here or on the time rail, and the drawn well is the well on that date.
 */
export function LifeStrip({ production, tests, band, showLift, cursorMs, todayMs, onCursor }: {
  readonly production: readonly ProductionMonth[]; readonly tests: readonly WellTest[]; readonly band: Band | null; readonly showLift: boolean;
  readonly cursorMs: number; readonly todayMs: number; readonly onCursor: (ms: number) => void;
}) {
  const [box, size] = useSize<HTMLDivElement>();
  const W = Math.max(320, size.width), H = 112, m = { l: 46, r: 12, t: 10, b: 20 };
  const runs = band ? [band.main.natural, band.main.lifted].filter((r): r is Run => !!r) : [];
  const first = production[0] ? Date.parse(`${production[0].month}-01`) : Date.parse(tests[0]?.date ?? new Date(todayMs).toISOString());
  const last = Math.max(todayMs, ...runs.map((r) => Date.parse(r.endDate)));
  const x = scaleTime().domain([new Date(first), new Date(last)]).range([m.l, W - m.r]);
  const history = production.map((row) => { const a = Date.parse(`${row.month}-01`), end = new Date(a); end.setUTCMonth(end.getUTCMonth() + 1); return { t: a + (end.getTime() - a) / 2, oil: row.oil / ((end.getTime() - a) / DAY) }; });
  const oilMax = Math.max(1, ...history.map((h) => h.oil), ...tests.map((t) => t.liquidRate * (1 - t.waterCut)), ...runs.flatMap((r) => r.steps.map((s) => s.oil)));
  const y = scaleLinear().domain([0, oilMax * 1.08]).range([H - m.b, m.t]).nice();
  const line = (r: Run) => r.steps.map((s, i) => `${i ? "L" : "M"}${x(new Date(s.date)).toFixed(1)},${y(s.oil).toFixed(1)}`).join("");
  const area = (a: Run | null, b: Run | null) => {
    if (!a || !b) return null;
    const upper = a.steps.length >= b.steps.length ? a : b, lower = upper === a ? b : a;
    return upper.steps.map((s, i) => `${i ? "L" : "M"}${x(new Date(s.date)).toFixed(1)},${y(Math.max(s.oil, lower.steps[i]?.oil ?? 0)).toFixed(1)}`).join("") + upper.steps.map((s, i) => `L${x(new Date(s.date)).toFixed(1)},${y(Math.min(s.oil, lower.steps[i]?.oil ?? 0)).toFixed(1)}`).reverse().join("") + "Z";
  };
  const drag = useRef(false);
  const at = (event: ReactPointerEvent<SVGSVGElement>) => Math.round(x.invert(event.clientX - event.currentTarget.getBoundingClientRect().left).getTime() / DAY) * DAY;
  const clamp = (ms: number) => Math.max(first, Math.min(last, ms));
  return <div className="pw-life" ref={box}>
    <svg width={W} height={H} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = true; onCursor(clamp(at(event))); }} onPointerMove={(event) => { if (drag.current) onCursor(clamp(at(event))); }} onPointerUp={() => { drag.current = false; }}>
      {y.ticks(3).map((t) => <g key={t}><line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="nodal-grid" /><text x={m.l - 5} y={y(t) + 3} textAnchor="end" className="vol-tick">{fmt(t)}</text></g>)}
      {x.ticks(8).map((t) => <text key={t.getTime()} x={x(t)} y={H - 5} textAnchor="middle" className="vol-tick">{t.getUTCFullYear()}</text>)}
      <rect x={m.l} y={m.t} width={Math.max(0, x(new Date(todayMs)) - m.l)} height={H - m.b - m.t} className="nodal-fc-past" />
      {band && <path d={area(band.low.natural, band.high.natural) ?? ""} className="nodal-fc-band is-natural" />}
      {band && showLift && <path d={area(band.low.lifted, band.high.lifted) ?? ""} className="nodal-fc-band is-lift" />}
      {history.length > 0 && <path d={history.map((h, i) => `${i ? "L" : "M"}${x(new Date(h.t)).toFixed(1)},${y(h.oil).toFixed(1)}`).join("")} className="nodal-fc-history" />}
      {tests.map((t) => <circle key={t.date} cx={x(new Date(t.date))} cy={y(t.liquidRate * (1 - t.waterCut))} r={3} className="nodal-fc-test" />)}
      {band && <path d={line(band.main.natural)} className={`nodal-fc-run is-natural${showLift ? " is-dim" : ""}`} />}
      {band?.main.lifted && <path d={line(band.main.lifted)} className={`nodal-fc-run is-lift${showLift ? "" : " is-dim"}`} />}
      <line x1={x(new Date(todayMs))} x2={x(new Date(todayMs))} y1={m.t} y2={H - m.b} className="vol-mark" />
      <g transform={`translate(${x(new Date(cursorMs))},0)`} className="pw-playhead"><line y1={m.t - 4} y2={H - m.b} /><path d={`M-5,${m.t - 8} L5,${m.t - 8} L0,${m.t - 1} Z`} /></g>
    </svg>
  </div>;
}
