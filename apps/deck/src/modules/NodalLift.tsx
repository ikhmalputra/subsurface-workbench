import { scaleLinear } from "d3-scale";
import type { WellDesignBrief } from "@ikhmalputra/subsurface-core";
import { FT_PER_M, defaultLift } from "../data/nodal-model.ts";
import type { LiftInputs, NodalInputs, WellCase, liftDesign } from "../data/nodal-model.ts";
import { fmt } from "../format.ts";
import { useSize } from "./useSize.ts";
import { Slider } from "./Nodal.tsx";

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

export function LiftView({ result, lift, onLift, inputs, well, brief, calibrated, onUse, inUse }: {
  readonly result: LiftResult; readonly lift: LiftInputs; readonly onLift: (patch: Partial<LiftInputs>) => void; readonly inputs: NodalInputs; readonly well: WellCase;
  readonly brief: WellDesignBrief; readonly calibrated: boolean; readonly onUse: () => void; readonly inUse: boolean;
}) {
  const { design, optimum } = result;
  // The completion's mandrels, where the well design spaces them (evenly, as placeholders until a lift design sets them).
  const installed = mandrelsMd(brief);
  const fits = design.valves.length <= installed.length && design.valves.every((v) => installed.some((md) => Math.abs(md - m(v.mdFt)) <= 30));
  return <div className="nodal-lift">
    <DesignChart result={result} lift={lift} well={well} brief={brief} />
    <div className="nodal-lift-mid">
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
          {" "}Each unloading valve opens {lift.perValveDropPsi} psi below the one above it at the surface, so the casing pressure closes them from the top down as the well unloads; the operating valve is an orifice.
        </p>}
      </section>
      <Performance result={result} lift={lift} current={inputs.liftMscfD} waterCut={inputs.waterCut} />
      <p className="nodal-lift-act">
        {optimum && design.operating && <>
          <span><small>Inject at</small><b>{fmt(Math.round(m(design.operating.mdFt)))} m</b></span>
          <span><small>Economic</small><b>{fmt(Math.round(optimum.economic.gasScfD / 1000))}</b><em>Mscf/d</em></span>
          <span><small>Oil</small><b>{fmt(Math.round(optimum.economic.oil))}</b><em>STB/d</em></span>
          <span><small>Gain</small><b>{(optimum.economic.oil - (result.curve[0]?.oil ?? 0) >= 0 ? "+" : "") + fmt(Math.round(optimum.economic.oil - (result.curve[0]?.oil ?? 0)))}</b><em>vs no gas</em></span>
          <button type="button" className={`tie-button${inUse ? "" : " is-primary"}`} onClick={onUse} disabled={inUse}>{inUse ? "In Predict" : "Use in Predict"}</button>
        </>}
      </p>
    </div>
    <aside className="nodal-inputs">
      <h3>Gas supply <small>the compressor and the line</small></h3>
      <Slider label="Kickoff pressure" value={lift.kickoffPsig} min={600} max={3000} step={10} show={(v) => `${fmt(v)} psig · ${Math.round(v / 14.5)} bar`} onChange={(kickoffPsig) => onLift({ kickoffPsig, operatingPsig: Math.min(lift.operatingPsig, kickoffPsig) })} />
      <Slider label="Operating pressure" value={lift.operatingPsig} min={500} max={3000} step={10} show={(v) => `${fmt(v)} psig · ${Math.round(v / 14.5)} bar`} onChange={(operatingPsig) => onLift({ operatingPsig, kickoffPsig: Math.max(lift.kickoffPsig, operatingPsig) })} />
      <Slider label="Gas available" value={lift.availableMscfD} min={200} max={8000} step={50} show={(v) => `${fmt(v)} Mscf/d · ${fmt(Math.round(v * 28.3168))} Sm³/d`} onChange={(availableMscfD) => onLift({ availableMscfD })} />
      <h3>Unloading <small>what the well is unloaded from</small></h3>
      <Slider label="Load fluid" value={lift.loadFluidSg} min={0.85} max={1.4} step={0.01} show={(v) => `${v.toFixed(2)} SG · ${(v * 0.433).toFixed(3)} psi/ft`} onChange={(loadFluidSg) => onLift({ loadFluidSg })} />
      <Slider label="Unloading wellhead" value={lift.unloadingWhpPsig} min={0} max={600} step={10} show={(v) => `${fmt(v)} psig`} onChange={(unloadingWhpPsig) => onLift({ unloadingWhpPsig })} />
      <Slider label="Drop per valve" value={lift.perValveDropPsi} min={10} max={50} step={5} show={(v) => `${v} psi`} onChange={(perValveDropPsi) => onLift({ perValveDropPsi })} />
      <Slider label="Closest spacing" value={lift.minSpacingM} min={30} max={300} step={10} show={(v) => `${v} m`} onChange={(minSpacingM) => onLift({ minSpacingM })} />
      <h3>Economics <small>for the optimum gas rate</small><button type="button" className="cor-icon" aria-label="Back to the default gas-lift inputs" onClick={() => onLift(defaultLift)}>↺</button></h3>
      <Slider label="Oil netback" value={lift.oilNetback} min={10} max={120} step={1} show={(v) => `$${v}/bbl`} onChange={(oilNetback) => onLift({ oilNetback })} />
      <Slider label="Lift gas cost" value={lift.gasCost} min={0} max={15} step={0.25} show={(v) => `$${v.toFixed(2)}/Mscf`} onChange={(gasCost) => onLift({ gasCost })} />
      <p className="nodal-hint">The gas cost is compression fuel and upkeep, or what the gas would sell for. Break-even: {optimum ? `${(optimum.breakEvenSlope * 1000).toFixed(0)} STB/d of oil per extra MMscf/d` : "–"}.</p>
    </aside>
  </div>;
}

/** Where the well design puts its gas-lift mandrels, m MD: as its assembly does. */
function mandrelsMd(brief: WellDesignBrief) {
  const c = brief.completion;
  if (!c || c.artificialLift !== "gas-lift") return [];
  const count = Math.max(1, c.gasLiftMandrels ?? 4);
  return Array.from({ length: count }, (_, i) => Math.round(c.packerMdM * (0.3 + 0.6 * i / Math.max(1, count - 1)) - 40));
}

/** The pressure–depth design chart: casing lines, the design tubing line, the unloading staircase down the load fluid, and the valves. */
function DesignChart({ result, lift, well, brief }: { readonly result: LiftResult; readonly lift: LiftInputs; readonly well: WellCase; readonly brief: WellDesignBrief }) {
  const [box, size] = useSize<HTMLDivElement>();
  const W = Math.max(300, size.width), H = Math.max(280, size.height - 56), mg = { l: 48, r: 16, t: 14, b: 34 };
  const { design, input, tubingLine } = result;
  const path = well.path, tvdMaxFt = path.tvdFt.at(-1)!;
  const tvdOf = (md: number) => { const a = path.mdFt, t = path.tvdFt; for (let i = 1; i < a.length; i++) if (md <= a[i]!) return t[i - 1]! + (t[i]! - t[i - 1]!) * (md - a[i - 1]!) / (a[i]! - a[i - 1]! || 1); return t.at(-1)!; };
  const casingAt = (surface: number) => {
    // The gas column, read off the valve casing pressures where the design has them, else the gas gradient.
    const g = (design.operating ? (design.operating.casingAt - input.operatingPsia) / tvdOf(design.operating.mdFt) : 0.025) || 0.025;
    return [0, tvdMaxFt].map((d) => [surface + g * d, d] as const);
  };
  const tubingPts = tubingLine?.points ?? [];
  const pMax = Math.max(input.kickoffPsia, ...tubingPts.map((p) => p.p), ...design.valves.map((v) => v.casingPsia)) * 1.08;
  const x = scaleLinear().domain([0, psig(pMax)]).range([mg.l, W - mg.r]).nice();
  const y = scaleLinear().domain([0, m(tvdMaxFt)]).range([mg.t, H - mg.b]);
  const P = (psia: number, tvdFt: number) => `${x(psig(psia)).toFixed(1)},${y(m(tvdFt)).toFixed(1)}`;
  const line = (pts: readonly (readonly [number, number])[]) => pts.map(([p, d], i) => `${i ? "L" : "M"}${P(p, d)}`).join("");
  const gs = lift.loadFluidSg * 0.433, opTvd = design.operating ? tvdOf(design.operating.mdFt) : null;
  // The unloading staircase: load fluid from the unloading wellhead pressure to the first valve, then from each valve's design tubing pressure to the next.
  const stairs: [number, number][][] = [];
  let from: [number, number] = [input.unloadingWhp, 0];
  for (const v of design.valves) { stairs.push([from, [from[0] + gs * (v.tvdFt - from[1]), v.tvdFt]]); from = [v.tubingPsia, v.tvdFt]; }
  const top = input.whp + 0.2 * (input.operatingPsia - input.whp);
  const packerTvd = tvdOf((brief.completion?.packerMdM ?? 0) * FT_PER_M);
  const mandrels = mandrelsMd(brief).map((md) => tvdOf(md * FT_PER_M));
  return <figure className="hz-section nodal-lift-chart" ref={box}>
    <figcaption><b>Design</b><span>pressure against depth · casing lines from the gas column, load fluid {lift.loadFluidSg.toFixed(2)} SG</span></figcaption>
    <svg width={W} height={H}>
      {y.ticks(6).map((t) => <g key={t}><line x1={mg.l} x2={W - mg.r} y1={y(t)} y2={y(t)} className="nodal-grid" /><text x={mg.l - 6} y={y(t) + 3} textAnchor="end" className="vol-tick">{fmt(t)}</text></g>)}
      {x.ticks(6).map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={mg.t} y2={H - mg.b} className="nodal-grid" /><text x={x(t)} y={H - mg.b + 14} textAnchor="middle" className="vol-tick">{fmt(t)}</text></g>)}
      <text transform={`translate(12,${(mg.t + H - mg.b) / 2}) rotate(-90)`} textAnchor="middle" className="vol-tick">TVD, m</text>
      <text x={(mg.l + W - mg.r) / 2} y={H - 4} textAnchor="middle" className="vol-tick">pressure, psig</text>
      <line x1={mg.l} x2={W - mg.r} y1={y(m(packerTvd))} y2={y(m(packerTvd))} className="nodal-lift-packer" /><text x={W - mg.r - 4} y={y(m(packerTvd)) - 4} textAnchor="end" className="vol-tick">packer</text>
      {mandrels.map((d, i) => <path key={i} d={`M${W - mg.r},${y(m(d))} l-7,-3 v6 Z`} className="nodal-lift-mandrel"><title>Installed mandrel {i + 1}, {fmt(Math.round(m(d)))} m TVD</title></path>)}
      <path d={line(casingAt(input.kickoffPsia))} className="nodal-lift-kickoff" />
      <path d={line(casingAt(input.operatingPsia))} className="nodal-lift-casing" />
      {opTvd !== null && <path d={line([[top, 0], [design.operating!.tubingAt, opTvd]])} className="nodal-lift-design" />}
      {stairs.map((s, i) => <path key={i} d={line(s)} className="nodal-lift-load" />)}
      {tubingPts.length > 1 && <path d={tubingPts.map((p, i) => `${i ? "L" : "M"}${P(p.p, p.tvdFt)}`).join("")} className="nodal-pressure" />}
      {design.valves.map((v, i) => <g key={i} transform={`translate(${P(v.casingPsia, v.tvdFt)})`} className={`nodal-lift-valve${v.role === "operating" ? " is-operating" : ""}`}>
        <line x1={x(psig(v.tubingPsia)) - x(psig(v.casingPsia))} x2={0} y1={0} y2={0} />
        <circle r={v.role === "operating" ? 5 : 4} />
        <text x={8} y={3}>{i + 1} · {fmt(Math.round(m(v.mdFt)))} m MD{v.role === "operating" ? " · operating" : ""}</text>
      </g>)}
    </svg>
    <ul className="nodal-patterns">
      <li><i className="is-kickoff" />kickoff casing</li><li><i className="is-casing" />operating casing</li><li><i className="is-design" />design tubing</li>
      <li><i className="is-load" />load fluid, unloading</li><li><i className="is-flowing" />flowing tubing at the optimum</li><li><i className="is-mandrel" />installed mandrels</li>
    </ul>
  </figure>;
}

/** The gas-lift performance curve at the design's injection depth, with the technical maximum and the economic optimum. */
function Performance({ result, lift, current, waterCut }: { readonly result: LiftResult; readonly lift: LiftInputs; readonly current: number; readonly waterCut: number }) {
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
      <text x={x(Math.min(lift.availableMscfD, x.domain()[1]!)) + 4} y={mg.t + 10} className="vol-tick">beyond the gas available</text>
      <path d={curve.map((p, i) => `${i ? "L" : "M"}${x(p.gasScfD / 1000).toFixed(1)},${y(p.oil).toFixed(1)}`).join("")} className="nodal-sens-line" />
      {/* The break-even line touches the curve where its slope equals gas cost over oil netback. */}
      <line x1={x(Math.max(0, e.gasScfD / 1000 - span))} y1={y(e.oil - slope * Math.min(span, e.gasScfD / 1000))} x2={x(e.gasScfD / 1000 + span)} y2={y(e.oil + slope * span)} className="nodal-lift-tangent" />
      <line x1={x(Math.min(current, x.domain()[1]!))} x2={x(Math.min(current, x.domain()[1]!))} y1={mg.t} y2={H - mg.b} className="vol-mark" />
      <g transform={`translate(${x(mx.gasScfD / 1000)},${y(mx.oil)})`} className="nodal-lift-max"><circle r={4} /><text x={6} y={-8}>technical maximum · {fmt(Math.round(mx.gasScfD / 1000))}</text></g>
      <g transform={`translate(${x(e.gasScfD / 1000)},${y(e.oil)})`} className="nodal-lift-econ"><circle r={5} /><text x={-8} y={18} textAnchor={x(e.gasScfD / 1000) > W / 2 ? "end" : "start"}>economic optimum · {fmt(Math.round(e.gasScfD / 1000))}</text></g>
    </svg>
  </section>;
}
