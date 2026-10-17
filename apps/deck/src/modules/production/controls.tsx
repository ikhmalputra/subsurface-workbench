import { useRef } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, WheelEvent } from "react";
import { scaleLinear } from "d3-scale";
import type { NodalCurve } from "@ikhmalputra/subsurface-core/production";
import type { Inflow } from "@ikhmalputra/subsurface-core/production";
import { fmt } from "../../format.ts";
import { useSize } from "../useSize.ts";
import { depthScale } from "./scene.ts";

/**
 * A rotary dial, as on a panel: drag up or down (or sideways) to turn it, scroll, or step it with the
 * arrow keys (shift for ten steps). The arc shows where the value sits in its range.
 */
export function Dial({ label, value, min, max, step, show, onChange, tone = "#f59e0b", sub }: {
  readonly label: string; readonly value: number; readonly min: number; readonly max: number; readonly step: number;
  readonly show: (v: number) => string; readonly onChange: (v: number) => void; readonly tone?: string; readonly sub?: string;
}) {
  const start = useRef<{ x: number; y: number; v: number } | null>(null);
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const f = (value - min) / (max - min || 1), a0 = 0.75 * Math.PI, sweep = 1.5 * Math.PI, R = 22;
  const arc = (to: number) => { const a = a0 + sweep * to, x0 = 28 + R * Math.cos(a0), y0 = 28 + R * Math.sin(a0), x1 = 28 + R * Math.cos(a), y1 = 28 + R * Math.sin(a); return `M${x0},${y0} A${R},${R} 0 ${sweep * to > Math.PI ? 1 : 0} 1 ${x1},${y1}`; };
  const angle = a0 + sweep * f;
  const down = (event: ReactPointerEvent<HTMLDivElement>) => { event.currentTarget.setPointerCapture(event.pointerId); start.current = { x: event.clientX, y: event.clientY, v: value }; };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const d = (start.current.y - event.clientY) + (event.clientX - start.current.x);
    onChange(clamp(start.current.v + d / 160 * (max - min)));
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const k = event.shiftKey ? 10 : 1;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") { event.preventDefault(); onChange(clamp(value + step * k)); }
    else if (event.key === "ArrowDown" || event.key === "ArrowLeft") { event.preventDefault(); onChange(clamp(value - step * k)); }
  };
  const wheel = (event: WheelEvent<HTMLDivElement>) => onChange(clamp(value - Math.sign(event.deltaY) * step));
  return <div className="pw-dial" role="slider" tabIndex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={show(value)}
    onPointerDown={down} onPointerMove={move} onPointerUp={() => { start.current = null; }} onKeyDown={key} onWheel={wheel}>
    <svg width={50} height={50} viewBox="0 0 56 56" aria-hidden="true">
      <path d={arc(1)} className="pw-dial-track" />
      <path d={arc(Math.max(0.001, f))} style={{ stroke: tone }} className="pw-dial-value" />
      <circle cx={28} cy={28} r={14} className="pw-dial-cap" />
      <line x1={28 + 6 * Math.cos(angle)} y1={28 + 6 * Math.sin(angle)} x2={28 + 13 * Math.cos(angle)} y2={28 + 13 * Math.sin(angle)} style={{ stroke: tone }} className="pw-dial-needle" />
    </svg>
    <span className="pw-dial-text"><small>{label}</small><b>{show(value)}</b>{sub && <em>{sub}</em>}</span>
  </div>;
}

/** Pressure by depth beside the cutaway, on its scale: the tubing, the casing, the reservoir and the gauge. */
export function PressureLane({ mdMax, lines, points, cursorMdM, onHover, onPin, maxPsi }: {
  readonly mdMax: number;
  readonly lines: readonly { readonly key: string; readonly pts: readonly { readonly mdM: number; readonly psia: number }[]; readonly className: string; readonly label?: string }[];
  readonly points: readonly { readonly key: string; readonly mdM: number; readonly psia: number; readonly className: string; readonly label?: string }[];
  readonly cursorMdM: number | null; readonly onHover: (md: number | null) => void; readonly onPin: (md: number | null) => void; readonly maxPsi?: number;
}) {
  const [box, size] = useSize<HTMLDivElement>();
  const W = Math.max(120, size.width), H = Math.max(200, size.height), d = depthScale(H, mdMax);
  const all = [...lines.flatMap((l) => l.pts.map((p) => p.psia)), ...points.map((p) => p.psia)];
  const x = scaleLinear().domain([0, maxPsi ?? Math.max(500, ...all) * 1.06]).range([10, W - 12]).nice();
  const path = (pts: readonly { mdM: number; psia: number }[]) => pts.filter((p) => p.mdM <= mdMax).map((p, i) => `${i ? "L" : "M"}${x(p.psia - 14.7).toFixed(1)},${d.y(p.mdM).toFixed(1)}`).join("");
  const mdAt = (clientY: number, el: Element) => { const md = d.md(clientY - el.getBoundingClientRect().top); return md >= 0 && md <= mdMax ? md : null; };
  return <div className="pw-lane" ref={box}>
    <svg width={W} height={H} onPointerMove={(event) => onHover(mdAt(event.clientY, event.currentTarget))} onPointerLeave={() => onHover(null)} onClick={(event) => onPin(mdAt(event.clientY, event.currentTarget))}>
      <text x={10} y={16} className="pw-lane-title">Pressure, psig</text>
      {x.ticks(4).map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={d.top} y2={d.bottom} className="nodal-grid" /><text x={x(t)} y={d.top - 6} textAnchor="middle" className="vol-tick">{fmt(t)}</text></g>)}
      {lines.map((l) => <g key={l.key}><path d={path(l.pts)} className={l.className} />{l.label && l.pts.length > 0 && <text x={Math.min(W - 14, x(l.pts[0]!.psia - 14.7) + 6)} y={d.top + 14 + lines.indexOf(l) * 13} className={`pw-lane-label ${l.className}`}>{l.label}</text>}</g>)}
      {points.map((p) => <g key={p.key} transform={`translate(${x(p.psia - 14.7)},${d.y(p.mdM)})`} className={p.className}><circle r={4.5} />{p.label && <text x={-8} y={3.5} textAnchor="end">{p.label}</text>}</g>)}
      {cursorMdM !== null && cursorMdM <= mdMax && <line x1={0} x2={W} y1={d.y(cursorMdM)} y2={d.y(cursorMdM)} className="pw-cursor" />}
    </svg>
  </div>;
}

/**
 * Inflow against outflow, small, with the operating point as a handle: drag it along the inflow
 * curve to a rate, and the wellhead pressure that delivers it is set (the well follows).
 */
export function NodalInstrument({ ipr, vlp, point, onRate, test }: {
  readonly ipr: Inflow; readonly vlp: NodalCurve; readonly point: { readonly rate: number; readonly pwf: number } | null;
  readonly onRate: (rate: number) => void; readonly test?: { readonly rate: number; readonly pwf: number } | null;
}) {
  const [box, size] = useSize<HTMLDivElement>();
  const W = Math.max(200, size.width), H = 150, m = { l: 34, r: 8, t: 8, b: 20 };
  const rates = Array.from(vlp.rates), pr = ipr.pwf(0) ?? 0;
  const x = scaleLinear().domain([0, ipr.aof]).range([m.l, W - m.r]);
  const y = scaleLinear().domain([0, Math.max(pr, ...Array.from(vlp.pressures).filter(Number.isFinite)) * 1.05]).range([H - m.b, m.t]).nice();
  const iprPath = Array.from({ length: 41 }, (_, i) => ipr.aof * i / 40).map((q, i) => `${i ? "L" : "M"}${x(q).toFixed(1)},${y(ipr.pwf(q) ?? 0).toFixed(1)}`).join("");
  const vlpPath = rates.map((q, i) => ({ q, p: vlp.pressures[i]! })).filter((v) => Number.isFinite(v.p)).map((v, i) => `${i ? "L" : "M"}${x(v.q).toFixed(1)},${y(v.p).toFixed(1)}`).join("");
  const drag = useRef(false);
  const rateAt = (event: ReactPointerEvent<SVGSVGElement>) => Math.max(ipr.aof * 0.02, Math.min(ipr.aof * 0.98, x.invert(event.clientX - event.currentTarget.getBoundingClientRect().left)));
  return <div className="pw-nodal" ref={box}>
    <svg width={W} height={H} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = true; onRate(rateAt(event)); }} onPointerMove={(event) => { if (drag.current) onRate(rateAt(event)); }} onPointerUp={() => { drag.current = false; }}>
      {y.ticks(3).map((t) => <g key={t}><line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="nodal-grid" /><text x={m.l - 4} y={y(t) + 3} textAnchor="end" className="vol-tick">{fmt(t)}</text></g>)}
      {x.ticks(4).map((t) => <text key={t} x={x(t)} y={H - 6} textAnchor="middle" className="vol-tick">{fmt(t)}</text>)}
      <path d={iprPath} className="pw-ipr" /><path d={vlpPath} className="pw-vlp" />
      {test && <g transform={`translate(${x(test.rate)},${y(test.pwf)})`} className="nodal-test"><path d="M-4,-4L4,4M-4,4L4,-4" /></g>}
      {point && <g transform={`translate(${x(point.rate)},${y(point.pwf)})`} className="pw-handle"><circle r={9} className="pw-handle-halo" /><circle r={5} /></g>}
    </svg>
    <small className="pw-nodal-hint">inflow · outflow · drag the point to a rate: the choke follows</small>
  </div>;
}

/** A labelled slider with its value, for the inputs drawer. */
export function Slider({ label, value, min, max, step, show, onChange, log }: { readonly label: string; readonly value: number; readonly min: number; readonly max: number; readonly step: number; readonly show: (v: number) => string; readonly onChange: (v: number) => void; readonly log?: boolean }) {
  // A logarithmic slider for spans of decades (permeability): the thumb moves in log space.
  const to = (v: number) => log ? Math.log10(v) : v, from = (v: number) => log ? Math.round(10 ** v) : v;
  return <label className="nodal-slider"><span>{label}<b>{show(value)}</b></span>
    <input type="range" min={to(min)} max={to(max)} step={log ? 0.01 : step} value={to(value)} onChange={(event) => onChange(from(Number(event.target.value)))} aria-label={label} />
  </label>;
}
