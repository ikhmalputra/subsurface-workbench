import { scaleLinear } from "d3-scale";
import type { WellDesignBrief } from "@ikhmalputra/subsurface-core";
import { FT_PER_M } from "../data/nodal-model.ts";
import type { LiftInputs, liftDesign } from "../data/nodal-model.ts";
import { fmt } from "../format.ts";
import { useSize } from "./useSize.ts";

/**
 * Continuous gas-lift design as a production engineer does it before ordering valves (API RP 11V6,
 * Brown's and Takacs' procedure): the deepest point the operating injection pressure can reach at
 * the gas available, the unloading valves spaced from the kickoff pressure and the load fluid down
 * to it with each valve's test-rack setting, and the gas-lift performance curve with the technical
 * maximum and the economic optimum (where one more Mscf of gas no longer pays for itself).
 */

export type LiftResult = ReturnType<typeof liftDesign>;
const psig = (psia: number) => psia - 14.7;
const m = (ft: number) => ft / FT_PER_M;
const toC = (f: number) => (f - 32) * 5 / 9;

/** The valve schedule a valve shop would build to, and whether the completion's mandrels sit where it needs them. */
export function ValveSchedule({ result, lift, brief, calibrated }: { readonly result: LiftResult; readonly lift: LiftInputs; readonly brief: WellDesignBrief; readonly calibrated: boolean }) {
  const { design } = result;
  // The completion's mandrels, where the well design spaces them (evenly, as placeholders until a lift design sets them).
  const installed = mandrelsMd(brief);
  const fits = design.valves.length <= installed.length && design.valves.every((v) => installed.some((md) => Math.abs(md - m(v.mdFt)) <= 30));
  return <>
    <section className="nodal-card">
        <header><b>Valve schedule</b><small>injection-pressure operated, nitrogen-charged, ¼ in ports · {calibrated ? "on the matched model" : "on assumed inputs: match the well first"}</small></header>
        {design.operating ? <table className="nodal-table nodal-valves">
          <thead><tr><th>Valve</th><th>MD<small>m</small></th><th>TVD<small>m</small></th><th>Temp<small>°C</small></th><th>Surface open<small>psig</small></th><th>Casing<small>psig at valve</small></th><th>Tubing<small>psig, design</small></th><th>Test rack<small>psig at 60 °F</small></th></tr></thead>
          <tbody>{design.valves.map((v, i) => <tr key={i} data-chosen={v.role === "operating" || undefined}>
            <td>{i + 1} · {v.role}</td><td>{fmt(Math.round(m(v.mdFt)))}</td><td>{fmt(Math.round(m(v.tvdFt)))}</td><td>{Math.round(toC(v.tempF))}</td>
            <td>{fmt(Math.round(v.surfaceOpeningPsig))}</td><td>{fmt(Math.round(psig(v.casingPsia)))}</td><td>{fmt(Math.round(psig(v.tubingPsia)))}</td><td>{v.ptroPsig === null ? "orifice" : fmt(Math.round(v.ptroPsig))}</td>
          </tr>)}</tbody>
        </table> : <p className="nodal-hint is-warn">{design.reason}</p>}
        {design.operating && <p className={`nodal-hint${fits ? "" : " is-warn"}`}>
          {fits ? "Every valve sits within 30 m of one of the completion's mandrels; the spare mandrels take dummy valves." : `The completion's ${installed.length} mandrels sit at ${installed.map((md) => fmt(Math.round(md))).join(", ")} m MD, spaced evenly as placeholders: run them at the depths above instead.`}
          {" "}Each unloading valve opens {lift.perValveDropPsi} psi below the one above it at the surface, so the casing pressure closes them from the top down as the well unloads; the operating valve is an orifice. Test-rack pressures use nitrogen&apos;s real-gas Z and the static geothermal temperature at each valve: a flowing well runs warmer, which a temperature survey would set (about 3 psi per °F at the top valve).
        </p>}
    </section>
  </>;
}

/** Where the well design puts its gas-lift mandrels, m MD: as its assembly does. */
export function mandrelsMd(brief: WellDesignBrief) {
  const c = brief.completion;
  if (!c || c.artificialLift !== "gas-lift") return [];
  const count = Math.max(1, c.gasLiftMandrels ?? 4);
  return Array.from({ length: count }, (_, i) => Math.round(c.packerMdM * (0.3 + 0.6 * i / Math.max(1, count - 1)) - 40));
}

/** The gas-lift performance curve at the design's injection depth, with the technical maximum and the economic optimum. */
export function Performance({ result, lift, current, waterCut }: { readonly result: LiftResult; readonly lift: LiftInputs; readonly current: number; readonly waterCut: number }) {
  const [box, size] = useSize<HTMLDivElement>();
  const W = Math.max(280, size.width - 20), H = 190, mg = { l: 48, r: 14, t: 12, b: 30 };
  const { curve, optimum } = result;
  if (!curve.length || !optimum) return <section className="nodal-card nodal-lift-perf" ref={box}><header><b>Gas-lift performance</b></header><p className="nodal-hint">No injection point: nothing to draw.</p></section>;
  const x = scaleLinear().domain([0, Math.max(...curve.map((p) => p.gasScfD)) / 1000]).range([mg.l, W - mg.r]);
  const oils = curve.map((p) => p.oil);
  const y = scaleLinear().domain([Math.min(...oils) * 0.9, Math.max(...oils) * 1.04]).range([H - mg.b, mg.t]).nice();
  const e = optimum.economic, mx = optimum.maximum, slope = optimum.breakEvenSlope * 1000; // STB/d per Mscf/d
  const span = (x.domain()[1]! - x.domain()[0]!) * 0.18;
  return <section className="nodal-card nodal-lift-perf" ref={box}>
    <header><b>Gas-lift performance</b><small>oil against lift gas at the injection depth · {Math.round(waterCut * 100)}% water</small></header>
    <svg width={W} height={H}>
      {y.ticks(4).map((t) => <g key={t}><line x1={mg.l} x2={W - mg.r} y1={y(t)} y2={y(t)} className="nodal-grid" /><text x={mg.l - 5} y={y(t) + 3} textAnchor="end" className="vol-tick">{fmt(t)}</text></g>)}
      {x.ticks(5).map((t) => <text key={t} x={x(t)} y={H - mg.b + 13} textAnchor="middle" className="vol-tick">{fmt(t)}</text>)}
      <text x={(mg.l + W - mg.r) / 2} y={H - 3} textAnchor="middle" className="vol-tick">lift gas, Mscf/d</text>
      <text transform={`translate(11,${(mg.t + H - mg.b) / 2}) rotate(-90)`} textAnchor="middle" className="vol-tick">oil, STB/d</text>
      <rect x={x(Math.min(lift.availableMscfD, x.domain()[1]!))} y={mg.t} width={Math.max(0, W - mg.r - x(Math.min(lift.availableMscfD, x.domain()[1]!)))} height={H - mg.b - mg.t} className="nodal-lift-short" />
      <path d={curve.map((p, i) => `${i ? "L" : "M"}${x(p.gasScfD / 1000).toFixed(1)},${y(p.oil).toFixed(1)}`).join("")} className="nodal-sens-line" />
      {/* The break-even line touches the curve where its slope equals gas cost over oil netback. */}
      <line x1={x(Math.max(0, e.gasScfD / 1000 - span))} y1={y(e.oil - slope * Math.min(span, e.gasScfD / 1000))} x2={x(e.gasScfD / 1000 + span)} y2={y(e.oil + slope * span)} className="nodal-lift-tangent" />
      <line x1={x(Math.min(current, x.domain()[1]!))} x2={x(Math.min(current, x.domain()[1]!))} y1={mg.t} y2={H - mg.b} className="vol-mark" />
      <g transform={`translate(${x(mx.gasScfD / 1000)},${y(mx.oil)})`} className="nodal-lift-max"><circle r={4} /><text x={x(mx.gasScfD / 1000) > W * 0.7 ? -6 : 6} y={-8} textAnchor={x(mx.gasScfD / 1000) > W * 0.7 ? "end" : "start"}>{result.maximumFound ? `max ${fmt(Math.round(mx.gasScfD / 1000))}` : "still rising"}</text></g>
      <g transform={`translate(${x(e.gasScfD / 1000)},${y(e.oil)})`} className="nodal-lift-econ"><circle r={5} /><text x={-8} y={18} textAnchor={x(e.gasScfD / 1000) > W / 2 ? "end" : "start"}>{result.gasLimited ? "all gas available" : "optimum"} {fmt(Math.round(e.gasScfD / 1000))}</text></g>
    </svg>
  </section>;
}
