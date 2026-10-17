import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { scaleLinear, scaleLog } from "d3-scale";
import { monteCarloPay, payOf } from "@ikhmalputra/subsurface-core/petro-clastic";
import type { Interpretation, SaturationModel, ShaleMethod } from "@ikhmalputra/subsurface-core/petro-clastic";
import { forceWellByBusId, useForceLogs } from "../data/force.ts";
import { interpretZone, likeliestZone, rangesAbout, samplesIn, startingInterpretation, zonesOf } from "../data/petro-force-model.ts";
import type { Zone } from "../data/petro-force-model.ts";
import { forgetInterpretation, keepInterpretation, useInterpretations } from "../data/petro-interpretations.ts";
import { Dial } from "./production/controls.tsx";
import { Frame, Inspector, Status } from "./frame/Frame.tsx";
import { fmt } from "../format.ts";
import { useSize } from "./useSize.ts";
import { useWire } from "./wire.ts";

/**
 * Clastic petrophysics on a FORCE 2020 well's real logs. The surface is the rock as the
 * interpretation reads it: a virtual core, depth by depth, clay, sand grains and the pores filled
 * with water or hydrocarbon, beside the logs it came from and the computed curves. Everything is
 * moved by hand: cutoffs dragged on the tracks, the water line dragged and tilted on the Pickett
 * plot (Rw and m), the clay lines on the gamma ray, and the answer as P90, P50 and P10 from a
 * Monte Carlo over all of them. Four lenses: Clay, Porosity, Saturation, Pay.
 */

type Lens = "clay" | "porosity" | "saturation" | "pay";
type Row = ReturnType<typeof interpretZone>[number];
const MODEL_NAME: Readonly<Record<SaturationModel, string>> = { archie: "Archie", simandoux: "Simandoux", indonesia: "Indonesia" };

export function ForcePetrophysics() {
  const wire = useWire("petro");
  const well = forceWellByBusId(wire.place?.wellId ?? null);
  const { logs: loaded } = useForceLogs(well ? [well] : []);
  const logs = well ? loaded.get(well.id) ?? null : null;
  const zones = useMemo(() => well ? zonesOf(well) : [], [well]);
  const start = useMemo(() => logs ? startingInterpretation(logs) : null, [logs]);
  const [p, setP] = useState<Interpretation | null>(null);
  const [zoneName, setZoneName] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>("saturation");
  const [spread, setSpread] = useState(0.3);
  // The user's own interpretation of this well, if they left one; else the well's starting point.
  const kept = useInterpretations();
  const mine = well ? kept[well.id] ?? null : null;
  const touched = useRef(false);
  useEffect(() => {
    if (!start || !logs) return;
    touched.current = false;
    const own = well ? kept[well.id] : undefined;
    setP(own ? own.interpretation : start);
    setZoneName(own && zones.some((z) => z.name === own.zone) ? own.zone : likeliestZone(logs, zones, start)?.name ?? zones[0]?.name ?? null);
  }, [start, logs, zones]); // kept is read once per well, not followed
  // Edits are kept (and read by Maps & volumetrics) a moment after they stop.
  useEffect(() => {
    if (!touched.current || !p || !well || !zoneName) return;
    const timer = window.setTimeout(() => keepInterpretation(well.id, { interpretation: p, zone: zoneName, wellName: well.name, savedAt: Date.now() }), 400);
    return () => window.clearTimeout(timer);
  }, [p, zoneName, well]);
  // Samples picked on a crossplot, by depth: shown on the tracks; the deck's brush, shown on the crossplots.
  const [picked, setPicked] = useState<{ from: string; mds: ReadonlySet<number> } | null>(null);
  useEffect(() => setPicked(null), [well?.id, zoneName]);
  const zone: Zone | null = zones.find((z) => z.name === zoneName) ?? null;
  const samples = useMemo(() => logs && zone ? samplesIn(logs, zone.topMdM - 15, zone.baseMdM + 15) : [], [logs, zone]);
  const rows = useMemo(() => p && logs ? interpretZone(samples, p, logs.well.step) : [], [samples, p, logs]);
  const inZone = useMemo(() => zone ? rows.filter((r) => r.mdM >= zone.topMdM && r.mdM <= zone.baseMdM) : [], [rows, zone]);
  const pay = p ? payOf(inZone, p.cutoffs) : null;
  const pLater = useDeferredValue(p), spreadLater = useDeferredValue(spread);
  const mc = useMemo(() => lens === "pay" && pLater && logs && zone ? monteCarloPay(samplesIn(logs, zone.topMdM, zone.baseMdM), logs.well.step, pLater, rangesAbout(pLater, spreadLater), 500) : null, [lens, pLater, logs, zone, spreadLater]);

  if (!well) return <p className="hz-empty">Choose a FORCE well on the globe or in Correlation.</p>;
  if (!logs || !p || !zone || !pay) return <p className="hz-empty">Loading {well.name}&apos;s logs…</p>;
  const set = (patch: Partial<Interpretation>) => { touched.current = true; setP((c) => c ? { ...c, ...patch } : c); };
  const setSat = (patch: Partial<Interpretation["sat"]>) => { touched.current = true; setP((c) => c ? { ...c, sat: { ...c.sat, ...patch } } : c); };
  const setCut = (patch: Partial<Interpretation["cutoffs"]>) => { touched.current = true; setP((c) => c ? { ...c, cutoffs: { ...c.cutoffs, ...patch } } : c); };
  const sel: Selection = { brush: wire.brush, picked: picked?.mds ?? null, onPick: (from, mds) => setPicked(mds && mds.size ? { from, mds } : null) };
  const kMean = inZone.filter((r) => r.vsh <= p.cutoffs.vsh && r.phi >= p.cutoffs.phi).map((r) => r.k);
  const kGeo = kMean.length ? Math.exp(kMean.reduce((s, k) => s + Math.log(Math.max(0.001, k)), 0) / kMean.length) : 0;

  const settings = lens === "clay" ? <>
    <div className="pw-actions">{(["linear", "larionov-tertiary", "larionov-older"] as const).map((m) => <button key={m} type="button" className={`tie-button${p.shale === m ? " is-primary" : ""}`} onClick={() => set({ shale: m as ShaleMethod })}>{m === "linear" ? "Linear" : m === "larionov-tertiary" ? "Larionov, Tertiary" : "Larionov, older"}</button>)}</div>
    <p className="nodal-hint">Drag the clean and shale lines on the gamma ray. They start at the well&apos;s {start?.source.gr}. The Vsh cutoff is dragged on the Vsh track.</p>
  </> : lens === "porosity" ? <>
    <div className="pw-dials">
      <Dial label="Matrix ρ, g/cm³" value={p.porosity.rhoMatrix} min={2.6} max={2.75} step={0.01} tone="#f59e0b" show={(v) => v.toFixed(2)} onChange={(rhoMatrix) => set({ porosity: { ...p.porosity, rhoMatrix } })} />
      <Dial label="Fluid ρ, g/cm³" value={p.porosity.rhoFluid} min={0.8} max={1.15} step={0.01} tone="#38bdf8" show={(v) => v.toFixed(2)} onChange={(rhoFluid) => set({ porosity: { ...p.porosity, rhoFluid } })} />
    </div>
    <p className="nodal-hint">Drag the shale point on the density–neutron plot: the shale correction follows. Effective porosity is the root mean square of the shale-corrected density and neutron porosities, which reads right in gas too.</p>
  </> : lens === "saturation" ? <>
    <div className="pw-actions">{(["archie", "simandoux", "indonesia"] as const).map((m) => <button key={m} type="button" className={`tie-button${p.model === m ? " is-primary" : ""}`} onClick={() => set({ model: m })}>{MODEL_NAME[m]}</button>)}</div>
    <div className="pw-dials">
      <Dial label="Rw, Ω·m" value={p.sat.rw} min={0.01} max={0.6} step={0.005} tone="#38bdf8" show={(v) => v.toFixed(3)} onChange={(rw) => setSat({ rw })} />
      <Dial label="m (cementation)" value={p.sat.m} min={1.4} max={2.8} step={0.02} tone="#a78bfa" show={(v) => v.toFixed(2)} onChange={(m) => setSat({ m })} />
      <Dial label="n (saturation)" value={p.sat.n} min={1.4} max={2.8} step={0.02} tone="#a78bfa" show={(v) => v.toFixed(2)} onChange={(n) => setSat({ n })} />
      <Dial label="Rsh, Ω·m" value={p.sat.rsh} min={0.3} max={10} step={0.05} tone="#f59e0b" show={(v) => v.toFixed(2)} onChange={(rsh) => setSat({ rsh })} />
    </div>
    <p className="nodal-hint">Drag the water line to move Rw; drag its end to tilt it (m). Rw started from {start?.source.rw}; FORCE carries no temperature, so this is Rw at formation temperature.</p>
  </> : <>
    <div className="pw-dials">
      <Dial label="Input spread, ±%" value={Math.round(spread * 100)} min={5} max={60} step={5} tone="#f472b6" show={(v) => `${v}`} onChange={(v) => setSpread(v / 100)} />
      <Dial label="BVW irreducible" value={p.bvwIrr} min={0.02} max={0.1} step={0.005} tone="#38bdf8" show={(v) => v.toFixed(3)} onChange={(bvwIrr) => set({ bvwIrr })} />
    </div>
    <div className="pw-actions">{(["timur", "coates"] as const).map((m) => <button key={m} type="button" className={`tie-button${p.perm === m ? " is-primary" : ""}`} onClick={() => set({ perm: m })}>{m === "timur" ? "Timur" : "Coates"}</button>)}</div>
  </>;
  const plot = lens === "clay" ? { title: "Gamma ray", summary: `clean ${Math.round(p.grClean)} · shale ${Math.round(p.grShale)}`, body: <GammaHistogram rows={rows} p={p} onLines={(grClean, grShale) => set({ grClean, grShale })} sel={sel} /> }
    : lens === "porosity" ? { title: "Density–neutron", summary: `shale ${p.porosity.rhoShale.toFixed(2)} / ${p.porosity.nphiShale.toFixed(2)}`, body: <NeutronDensity rows={rows} p={p} onShale={(rhoShale, nphiShale) => set({ porosity: { ...p.porosity, rhoShale, nphiShale } })} sel={sel} /> }
    : lens === "saturation" ? { title: "Pickett plot", summary: `Rw ${p.sat.rw.toFixed(3)} · m ${p.sat.m.toFixed(2)}`, body: <Pickett rows={inZone} p={p} onLine={(rw, m) => setSat({ rw, m })} sel={sel} /> }
    : { title: "Hydrocarbon column", summary: mc ? `P50 ${mc.column.p50.toFixed(2)} m` : "running…", body: mc ? <MonteCarlo mc={mc} /> : <p className="nodal-hint">Running the Monte Carlo…</p> };
  return <Frame name="petro" className="pf" title={`${well.name} · ${zone.name}`} subtitle={`${fmt(Math.round(zone.topMdM))}–${fmt(Math.round(zone.baseMdM))} m MD · FORCE 2020 logs · ${MODEL_NAME[p.model]} saturation · permeability from ${p.perm === "timur" ? "Timur" : "Coates"} (no core)`}
    tools={<>
      <select className="pf-zone" value={zone.name} onChange={(event) => { touched.current = touched.current || !!mine; setZoneName(event.target.value); }} aria-label="Zone">{zones.map((z) => <option key={z.name} value={z.name}>{z.name}</option>)}</select>
      <span className="pw-lenses" role="tablist" aria-label="Lens">
        {(["clay", "porosity", "saturation", "pay"] as const).map((l) => <button key={l} type="button" role="tab" aria-selected={lens === l} onClick={() => setLens(l)}>{l[0]!.toUpperCase() + l.slice(1)}</button>)}
      </span>
      <span className={`pw-badge${mine ? " is-on" : ""}`} title={mine ? `Kept ${new Date(mine.savedAt).toLocaleString()}; Maps & volumetrics reads this well through it` : "The well's own starting point; any change you make is kept and read by Maps & volumetrics"}>{mine ? "Yours" : "Starting point"}<small>{mine ? "used by Volumetrics" : "edit to keep"}</small></span>
      {mine && <button type="button" className="tie-button" onClick={() => { forgetInterpretation(well.id); touched.current = false; setP(start); }} title="Back to the well's starting point">Reset</button>}
    </>}
    numbers={<>
      <span><small>Net pay</small><b>{fmt(pay.pay, 1)}</b></span>
      <span><small>φ</small><b>{(pay.phiPay * 100).toFixed(0)}%</b></span>
      <span><small>Sw</small><b>{(pay.swPay * 100).toFixed(0)}%</b></span>
      <em>m · pay averages · column {pay.column.toFixed(2)} m</em>
    </>}
    canvas={<Tracks rows={rows} zone={zone} p={p} lens={lens} cursorMdM={wire.cursor} onHover={wire.hover} onPin={wire.pin} onCut={setCut} sel={sel} onBrush={wire.setBrush} />}
    inspector={<Inspector id={`petro-${lens}`} initial="plot"
      head={(picked || wire.brush) ? <p className="nodal-hint pf-sel">{picked ? `${fmt(picked.mds.size)} samples picked on the ${picked.from}: marked on the tracks. ` : ""}{wire.brush ? `Brushed ${fmt(Math.round(wire.brush[0]))}–${fmt(Math.round(wire.brush[1]))} m: lit on the crossplots. ` : ""}<button type="button" className="tie-button" onClick={() => { setPicked(null); wire.setBrush(null); }}>Clear</button></p> : undefined}
      sections={[
        { id: "plot", title: plot.title, summary: plot.summary, body: plot.body, same: true },
        { id: "settings", title: lens === "pay" ? "Spread and permeability" : lens === "saturation" ? "Model and parameters" : lens === "porosity" ? "Matrix and fluid" : "Shale volume", body: settings },
        lens === "pay" && { id: "totals", title: "Gross, net and pay", summary: `${fmt(pay.pay, 1)} m pay`, body: <div className="pw-facts">
          <span><small>Gross</small><b>{fmt(pay.gross, 1)}</b><em>m</em></span>
          <span><small>Net sand</small><b>{fmt(pay.net, 1)}</b><em>m · N/G {(pay.ntg * 100).toFixed(0)}%</em></span>
          <span><small>Net pay</small><b>{fmt(pay.pay, 1)}</b><em>m</em></span>
          <span><small>k, net sand</small><b>{kGeo >= 1 ? fmt(Math.round(kGeo)) : kGeo.toFixed(2)}</b><em>mD geometric mean</em></span>
        </div> },
      ]} />}
    status={<Status items={[
      `Cutoffs: Vsh ≤ ${p.cutoffs.vsh.toFixed(2)}, φ ≥ ${p.cutoffs.phi.toFixed(2)}, Sw ≤ ${p.cutoffs.sw.toFixed(2)} (drag them on the tracks)`,
      "Shift-drag on the tracks brushes an interval · drag a box on a crossplot to pick samples",
    ]} />} />;
}

/** The brush (an MD interval, the deck's) and the samples picked on a crossplot, and how a crossplot picks. */
interface Selection { readonly brush: readonly [number, number] | null; readonly picked: ReadonlySet<number> | null; readonly onPick: (from: string, mds: ReadonlySet<number> | null) => void }
/** Whether a sample is lit: in the brush or picked; null when nothing is selected (everything is). */
const litOf = (sel: Selection) => sel.brush || sel.picked ? (md: number) => (sel.brush !== null && md >= sel.brush[0] && md <= sel.brush[1]) || (sel.picked?.has(md) ?? false) : null;
/** A box dragged on a crossplot's empty ground: the samples inside it, by depth. */
function useBox(onDone: (box: { x0: number; x1: number; y0: number; y1: number } | null) => void) {
  // The box in progress lives in a ref (events can outrun renders); the state only draws it.
  const live = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const start = (event: ReactPointerEvent<SVGSVGElement>) => {
    const b = event.currentTarget.getBoundingClientRect(), x = event.clientX - b.left, y = event.clientY - b.top;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* a synthetic pointer */ }
    live.current = { x0: x, y0: y, x1: x, y1: y }; setBox(live.current); return true;
  };
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!live.current) return false;
    const b = event.currentTarget.getBoundingClientRect();
    live.current = { ...live.current, x1: event.clientX - b.left, y1: event.clientY - b.top }; setBox(live.current); return true;
  };
  const end = () => {
    const box = live.current;
    if (!box) return;
    live.current = null; setBox(null);
    const r = { x0: Math.min(box.x0, box.x1), x1: Math.max(box.x0, box.x1), y0: Math.min(box.y0, box.y1), y1: Math.max(box.y0, box.y1) };
    onDone(r.x1 - r.x0 < 4 && r.y1 - r.y0 < 4 ? null : r);
  };
  const shape = box ? <rect x={Math.min(box.x0, box.x1)} y={Math.min(box.y0, box.y1)} width={Math.abs(box.x1 - box.x0)} height={Math.abs(box.y1 - box.y0)} className="pf-box" /> : null;
  return { start, move, end, shape };
}

/**
 * The tracks on one depth axis: gamma ray with Vsh, resistivity, density and neutron with their
 * crossover, the virtual core, then φ, Sw and k, with the pay flag. Cutoffs are handles on their
 * tracks; hover moves the deck's depth cursor.
 */
function Tracks({ rows, zone, p, lens, cursorMdM, onHover, onPin, onCut, sel, onBrush }: {
  readonly rows: readonly Row[]; readonly zone: Zone; readonly p: Interpretation; readonly lens: Lens; readonly cursorMdM: number | null;
  readonly onHover: (md: number | null) => void; readonly onPin: (md: number | null) => void; readonly onCut: (patch: Partial<Interpretation["cutoffs"]>) => void;
  readonly sel: Selection; readonly onBrush: (range: readonly [number, number] | null) => void;
}) {
  const [box, size] = useSize<HTMLDivElement>();
  const W = Math.max(400, size.width), H = Math.max(300, size.height), top = 34, bottom = H - 8;
  const md0 = rows[0]?.mdM ?? zone.topMdM, md1 = rows.at(-1)?.mdM ?? zone.baseMdM;
  const y = scaleLinear().domain([md0, md1]).range([top, bottom]);
  const cols = [
    { key: "gr", title: "GR · Vsh", w: 1 }, { key: "rt", title: "Rt, Ω·m", w: 1 }, { key: "nd", title: "ρb · φN", w: 1 },
    { key: "core", title: "The rock", w: 1.25 }, { key: "phi", title: "φ · BVW", w: 1 }, { key: "sw", title: "Sw", w: 0.9 }, { key: "k", title: "k, mD", w: 0.9 },
  ];
  const total = cols.reduce((s, c) => s + c.w, 0), unit = (W - 46) / total;
  let acc = 40;
  const at = cols.map((c) => { const x0 = acc; acc += c.w * unit; return { ...c, x0, x1: acc - 6 }; });
  const col = (key: string) => at.find((c) => c.key === key)!;
  const line = (key: string, value: (r: Row) => number, scale: (v: number) => number) => rows.map((r, i) => { const v = value(r); return Number.isFinite(v) ? `${i ? "L" : "M"}${scale(v).toFixed(1)},${y(r.mdM).toFixed(1)}` : ""; }).join("");
  const gr = col("gr"), rt = col("rt"), nd = col("nd"), phiC = col("phi"), sw = col("sw"), k = col("k"), core = col("core");
  const xGr = scaleLinear().domain([0, 150]).range([gr.x0, gr.x1]), xV = scaleLinear().domain([0, 1]).range([gr.x0, gr.x1]);
  const xRt = scaleLog().domain([0.2, 200]).range([rt.x0, rt.x1]).clamp(true);
  const xRho = scaleLinear().domain([1.95, 2.95]).range([nd.x0, nd.x1]), xN = scaleLinear().domain([0.45, -0.15]).range([nd.x0, nd.x1]);
  const xPhi = scaleLinear().domain([0.5, 0]).range([phiC.x0, phiC.x1]), xSw = scaleLinear().domain([0, 1]).range([sw.x0, sw.x1]), xK = scaleLog().domain([0.01, 10000]).range([k.x0, k.x1]).clamp(true);
  const pay = (r: Row) => r.vsh <= p.cutoffs.vsh && r.phi >= p.cutoffs.phi && r.sw <= p.cutoffs.sw;
  const net = (r: Row) => r.vsh <= p.cutoffs.vsh && r.phi >= p.cutoffs.phi;
  const drag = useRef<null | "vsh" | "phi" | "sw">(null);
  const brushing = useRef<number | null>(null);
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect(), x = event.clientX - box.left, yy = event.clientY - box.top;
    if (brushing.current !== null) { const md = y.invert(Math.max(top, Math.min(bottom, yy))); onBrush([Math.min(brushing.current, md), Math.max(brushing.current, md)]); return; }
    if (drag.current === "vsh") onCut({ vsh: Math.max(0.05, Math.min(0.9, xV.invert(x))) });
    else if (drag.current === "phi") onCut({ phi: Math.max(0, Math.min(0.35, xPhi.invert(x))) });
    else if (drag.current === "sw") onCut({ sw: Math.max(0.1, Math.min(1, xSw.invert(x))) });
    else onHover(yy >= top && yy <= bottom ? y.invert(yy) : null);
  };
  const handle = (which: "vsh" | "phi" | "sw", x: number, colour: string) => <g className="pf-cut" onPointerDown={(event) => { event.stopPropagation(); (event.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(event.pointerId); drag.current = which; }}>
    <line x1={x} x2={x} y1={top} y2={bottom} style={{ stroke: colour }} /><rect x={x - 6} y={top - 12} width={12} height={12} rx={3} style={{ fill: colour }} /><line x1={x} x2={x} y1={top} y2={bottom} className="pf-cut-hit" />
  </g>;
  return <div className="pf-tracks" ref={box}>
    <VirtualCore rows={rows} p={p} x0={core.x0} x1={core.x1} y={y} top={top} bottom={bottom} width={W} height={H} lens={lens} />
    <svg width={W} height={H} onPointerMove={move} onPointerUp={() => { drag.current = null; brushing.current = null; }} onPointerLeave={() => { if (!drag.current) onHover(null); }}
      onPointerDown={(event) => { if (!event.shiftKey || drag.current) return; const yy = event.clientY - event.currentTarget.getBoundingClientRect().top; if (yy < top || yy > bottom) return; try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* a synthetic pointer */ } brushing.current = y.invert(yy); onBrush(null); }}
      onClick={(event) => { if (!drag.current && !event.shiftKey) { const yy = event.clientY - event.currentTarget.getBoundingClientRect().top; onPin(yy >= top && yy <= bottom ? y.invert(yy) : null); } }}>
      {y.ticks(8).map((t) => <g key={t}><line x1={36} x2={W - 4} y1={y(t)} y2={y(t)} className="nodal-grid" /><text x={32} y={y(t) + 3} textAnchor="end" className="vol-tick">{fmt(t)}</text></g>)}
      {at.map((c) => <g key={c.key}><rect x={c.x0} y={top} width={c.x1 - c.x0} height={bottom - top} className="pf-track" /><text x={(c.x0 + c.x1) / 2} y={14} textAnchor="middle" className="pf-title">{c.title}</text></g>)}
      <rect x={36} y={y(zone.topMdM)} width={W - 40} height={y(zone.baseMdM) - y(zone.topMdM)} className="pf-zone-band" />
      <text x={W - 6} y={y(zone.topMdM) - 3} textAnchor="end" className="pf-zone-label">{zone.name}</text>
      {/* Gamma ray with the shale fill (Vsh). */}
      <path d={rows.map((r, i) => `${i ? "L" : "M"}${xV(r.vsh).toFixed(1)},${y(r.mdM).toFixed(1)}`).join("") + `L${gr.x0},${y(md1)}L${gr.x0},${y(md0)}Z`} className="pf-vsh" />
      <path d={line("gr", (r) => r.gr, xGr)} className="pf-gr" />
      {/* Resistivity, log scale. */}
      <path d={line("rt", (r) => r.rt, xRt)} className="pf-rt" />
      {/* Density and neutron with their crossover shaded (gas or clean sand where density moves left of neutron). */}
      {rows.map((r, i) => i && xRho(r.rhob) < xN(r.nphi) ? <rect key={i} x={xRho(r.rhob)} y={y(rows[i - 1]!.mdM)} width={xN(r.nphi) - xRho(r.rhob)} height={Math.max(0.6, y(r.mdM) - y(rows[i - 1]!.mdM))} className="pf-cross" /> : null)}
      <path d={line("rho", (r) => r.rhob, xRho)} className="pf-rho" /><path d={line("nphi", (r) => r.nphi, xN)} className="pf-nphi" />
      {/* Porosity with the water in it (BVW), Sw, permeability. */}
      <path d={rows.map((r, i) => `${i ? "L" : "M"}${xPhi(r.phi).toFixed(1)},${y(r.mdM).toFixed(1)}`).join("") + `L${phiC.x1},${y(md1)}L${phiC.x1},${y(md0)}Z`} className="pf-phi" />
      <path d={rows.map((r, i) => `${i ? "L" : "M"}${xPhi(r.bvw).toFixed(1)},${y(r.mdM).toFixed(1)}`).join("") + `L${phiC.x1},${y(md1)}L${phiC.x1},${y(md0)}Z`} className="pf-bvw" />
      <path d={line("sw", (r) => r.sw, xSw)} className="pf-sw" />
      <path d={line("k", (r) => Math.max(0.01, r.k), xK)} className="pf-k" />
      {/* Net and pay flags down the k track's edge. */}
      {rows.map((r, i) => i && net(r) ? <rect key={i} x={k.x1 - 6} y={y(rows[i - 1]!.mdM)} width={6} height={Math.max(0.6, y(r.mdM) - y(rows[i - 1]!.mdM))} className={pay(r) ? "pf-pay" : "pf-net"} /> : null)}
      {sel.brush && <rect x={36} y={y(Math.max(md0, sel.brush[0]))} width={W - 40} height={Math.max(1, y(Math.min(md1, sel.brush[1])) - y(Math.max(md0, sel.brush[0])))} className="pf-brush" />}
      {sel.picked && rows.map((r, i) => sel.picked!.has(r.mdM) ? <line key={`p${i}`} x1={36} x2={W - 4} y1={y(r.mdM)} y2={y(r.mdM)} className="pf-picked" /> : null)}
      {handle("vsh", xV(p.cutoffs.vsh), "#a78bfa")}{handle("phi", xPhi(p.cutoffs.phi), "#f59e0b")}{handle("sw", xSw(p.cutoffs.sw), "#38bdf8")}
      {cursorMdM !== null && cursorMdM >= md0 && cursorMdM <= md1 && <line x1={36} x2={W - 4} y1={y(cursorMdM)} y2={y(cursorMdM)} className="pw-cursor" />}
    </svg>
  </div>;
}

/**
 * The rock as the interpretation reads it, sample by sample: clay brown, sand grains as stippled
 * quartz, and the pores (porosity's share of the width) water blue or hydrocarbon amber by Sw.
 * Change Rw or m and the pores change colour where you look.
 */
function VirtualCore({ rows, p, x0, x1, y, top, bottom, width, height, lens }: { readonly rows: readonly Row[]; readonly p: Interpretation; readonly x0: number; readonly x1: number; readonly y: (md: number) => number; readonly top: number; readonly bottom: number; readonly width: number; readonly height: number; readonly lens: Lens }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current, ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = Math.round(width * dpr); el.height = Math.round(height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const w = x1 - x0;
    ctx.save(); ctx.beginPath(); ctx.roundRect(x0, top, w, bottom - top, 10); ctx.clip();
    ctx.fillStyle = "#1c1a17"; ctx.fillRect(x0, top, w, bottom - top);
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]!, y0 = y(rows[i - 1]!.mdM), y1 = y(r.mdM), h = Math.max(0.8, y1 - y0);
      const clay = Math.min(1, r.vsh), pore = Math.min(1 - clay, Math.max(0, r.phi)), grain = Math.max(0, 1 - clay - pore);
      let x = x0;
      ctx.fillStyle = "#6b4f3a"; ctx.fillRect(x, y0, clay * w, h); x += clay * w;
      ctx.fillStyle = "#c9b48a"; ctx.fillRect(x, y0, grain * w, h);
      // Grain texture: a few darker specks.
      ctx.fillStyle = "rgba(90, 70, 40, 0.35)"; for (let k = 0; k < grain * 6; k++) ctx.fillRect(x + rnd() * grain * w, y0 + rnd() * h, 1.2, 1.2);
      x += grain * w;
      const water = pore * r.sw, oil = pore - water;
      ctx.fillStyle = lens === "saturation" || lens === "pay" ? "#f59e0b" : "#d9a441"; ctx.fillRect(x, y0, oil * w, h); x += oil * w;
      ctx.fillStyle = "#3b82f6"; ctx.fillRect(x, y0, water * w, h);
    }
    // Cylinder shading, as a core in a tray.
    const g = ctx.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, "rgba(0,0,0,0.45)"); g.addColorStop(0.35, "rgba(255,255,255,0.08)"); g.addColorStop(0.6, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = g; ctx.fillRect(x0, top, w, bottom - top);
    ctx.restore();
  }, [rows, p, x0, x1, y, top, bottom, width, height, lens]);
  return <canvas ref={canvas} className="pf-core" style={{ width, height }} aria-hidden="true" />;
}

/** The gamma ray's distribution with the clean and shale lines as handles. */
function GammaHistogram({ rows, p, onLines, sel }: { readonly rows: readonly Row[]; readonly p: Interpretation; readonly onLines: (clean: number, shale: number) => void; readonly sel: Selection }) {
  const [box, size] = useSize<HTMLDivElement>();
  const W = Math.max(240, size.width - 16), H = 130, m = { l: 8, r: 8, t: 10, b: 22 };
  const bins = Array.from({ length: 30 }, () => 0);
  for (const r of rows) bins[Math.min(29, Math.max(0, Math.floor(r.gr / 5)))]!++;
  const x = scaleLinear().domain([0, 150]).range([m.l, W - m.r]), yh = scaleLinear().domain([0, Math.max(1, ...bins)]).range([H - m.b, m.t]);
  const drag = useRef<null | "clean" | "shale">(null);
  const lit = litOf(sel), litBins = Array.from({ length: 30 }, () => 0);
  if (lit) for (const r of rows) if (lit(r.mdM)) litBins[Math.min(29, Math.max(0, Math.floor(r.gr / 5)))]!++;
  const pick = useBox((b) => { if (!b) { sel.onPick("gamma ray", null); return; } const lo = x.invert(b.x0), hi = x.invert(b.x1); sel.onPick("gamma ray", new Set(rows.filter((r) => r.gr >= lo && r.gr <= hi).map((r) => r.mdM))); });
  return <section className="nodal-card" ref={box}>
    <header><b>Gamma ray</b><small>clean {Math.round(p.grClean)} · shale {Math.round(p.grShale)} gAPI · drag across bins to pick</small></header>
    <svg width={W} height={H} onPointerDown={(event) => { pick.start(event); }} onPointerMove={(event) => { if (pick.move(event) || !drag.current) return; const v = x.invert(event.clientX - event.currentTarget.getBoundingClientRect().left); if (drag.current === "clean") onLines(Math.min(v, p.grShale - 5), p.grShale); else onLines(p.grClean, Math.max(v, p.grClean + 5)); }} onPointerUp={() => { drag.current = null; pick.end(); }}>
      {bins.map((n, i) => <rect key={i} x={x(i * 5) + 0.5} y={yh(n)} width={x(5) - x(0) - 1} height={H - m.b - yh(n)} className={`pf-bin${lit ? " is-dim" : ""}`} />)}
      {lit && litBins.map((n, i) => n ? <rect key={`l${i}`} x={x(i * 5) + 0.5} y={yh(n)} width={x(5) - x(0) - 1} height={H - m.b - yh(n)} className="pf-bin is-lit" /> : null)}
      {pick.shape}
      {x.ticks(6).map((t) => <text key={t} x={x(t)} y={H - 6} textAnchor="middle" className="vol-tick">{t}</text>)}
      {(["clean", "shale"] as const).map((which) => { const v = which === "clean" ? p.grClean : p.grShale; return <g key={which} className="pf-cut" onPointerDown={(event) => { event.stopPropagation(); (event.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(event.pointerId); drag.current = which; }}>
        <line x1={x(v)} x2={x(v)} y1={m.t} y2={H - m.b} style={{ stroke: which === "clean" ? "#fbbf24" : "#a16207" }} /><rect x={x(v) - 6} y={m.t - 8} width={12} height={12} rx={3} style={{ fill: which === "clean" ? "#fbbf24" : "#a16207" }} /><line x1={x(v)} x2={x(v)} y1={m.t} y2={H - m.b} className="pf-cut-hit" />
      </g>; })}
    </svg>
  </section>;
}

/** Density against neutron with the sandstone line and the shale point as a handle. */
function NeutronDensity({ rows, p, onShale, sel }: { readonly rows: readonly Row[]; readonly p: Interpretation; readonly onShale: (rho: number, nphi: number) => void; readonly sel: Selection }) {
  const [box, size] = useSize<HTMLDivElement>();
  const W = Math.max(240, size.width - 16), H = 200, m = { l: 34, r: 8, t: 10, b: 24 };
  const x = scaleLinear().domain([-0.05, 0.5]).range([m.l, W - m.r]), y = scaleLinear().domain([2.9, 1.9]).range([H - m.b, m.t]);
  const drag = useRef(false);
  const sample = rows.filter((_, i) => i % Math.max(1, Math.floor(rows.length / 900)) === 0);
  const lit = litOf(sel);
  const pick = useBox((b) => sel.onPick("density–neutron", b ? new Set(rows.filter((r) => { const px = x(r.nphi), py = y(r.rhob); return px >= b.x0 && px <= b.x1 && py >= b.y0 && py <= b.y1; }).map((r) => r.mdM)) : null));
  return <section className="nodal-card" ref={box}>
    <header><b>Density–neutron</b><small>coloured by Vsh · the shale point is a handle · drag a box to pick</small></header>
    <svg width={W} height={H} onPointerDown={(event) => { pick.start(event); }} onPointerMove={(event) => { if (pick.move(event) || !drag.current) return; const b = event.currentTarget.getBoundingClientRect(); onShale(Math.max(2.2, Math.min(2.8, y.invert(event.clientY - b.top))), Math.max(0.15, Math.min(0.55, x.invert(event.clientX - b.left)))); }} onPointerUp={() => { drag.current = false; pick.end(); }}>
      {x.ticks(5).map((t) => <text key={t} x={x(t)} y={H - 8} textAnchor="middle" className="vol-tick">{t}</text>)}
      {y.ticks(4).map((t) => <g key={t}><line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="nodal-grid" /><text x={m.l - 4} y={y(t) + 3} textAnchor="end" className="vol-tick">{t.toFixed(1)}</text></g>)}
      <line x1={x(0)} y1={y(p.porosity.rhoMatrix)} x2={x(0.45)} y2={y(p.porosity.rhoMatrix - 0.45 * (p.porosity.rhoMatrix - p.porosity.rhoFluid))} className="pf-sandline" />
      {sample.map((r, i) => <circle key={i} cx={x(r.nphi)} cy={y(r.rhob)} r={1.8} className={lit ? lit(r.mdM) ? "pf-pt is-lit" : "pf-pt is-dim" : "pf-pt"} style={{ fill: `color-mix(in oklab, #6b4f3a ${Math.round(r.vsh * 100)}%, #fbbf24)` }} />)}
      {lit && rows.filter((r) => lit(r.mdM)).map((r, i) => <circle key={`l${i}`} cx={x(r.nphi)} cy={y(r.rhob)} r={2.4} className="pf-pt-lit" />)}
      {pick.shape}
      <g className="pf-shale" transform={`translate(${x(p.porosity.nphiShale)},${y(p.porosity.rhoShale)})`} onPointerDown={(event) => { event.stopPropagation(); (event.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(event.pointerId); drag.current = true; }}><circle r={7} /><text x={10} y={4}>shale</text></g>
    </svg>
  </section>;
}

/** Pickett: log Rt against log φ, the water line (Rw, m) dragged and tilted, constant-Sw lines at n. */
function Pickett({ rows, p, onLine, sel }: { readonly rows: readonly Row[]; readonly p: Interpretation; readonly onLine: (rw: number, m: number) => void; readonly sel: Selection }) {
  const [box, size] = useSize<HTMLDivElement>();
  const W = Math.max(240, size.width - 16), H = 220, m = { l: 34, r: 10, t: 10, b: 24 };
  const x = scaleLog().domain([0.2, 2000]).range([m.l, W - m.r]).clamp(true), y = scaleLog().domain([0.02, 0.5]).range([H - m.b, m.t]).clamp(true);
  const aRw = p.sat.a * p.sat.rw, mm = p.sat.m;
  const rtAt = (phi: number, sw: number) => aRw / (phi ** mm * sw ** p.sat.n);
  const drag = useRef<null | "shift" | "tilt">(null);
  const pivotPhi = 0.3;
  const sample = rows.filter((r) => r.phi > 0.02 && r.vsh < 0.5).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 800)) === 0);
  const lineAt = (sw: number) => { const a = 0.02, b = 0.5; return `M${x(rtAt(b, sw))},${y(b)} L${x(rtAt(a, sw))},${y(a)}`; };
  const lit = litOf(sel);
  const usable = rows.filter((r) => r.phi > 0.02 && r.vsh < 0.5);
  const pick = useBox((b) => sel.onPick("Pickett plot", b ? new Set(usable.filter((r) => { const px = x(r.rt), py = y(r.phi); return px >= b.x0 && px <= b.x1 && py >= b.y0 && py <= b.y1; }).map((r) => r.mdM)) : null));
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (pick.move(event) || !drag.current) return;
    const b = event.currentTarget.getBoundingClientRect(), rt = x.invert(event.clientX - b.left), phi = y.invert(event.clientY - b.top);
    if (drag.current === "shift") onLine(Math.max(0.005, Math.min(1, rt * pivotPhi ** mm / p.sat.a)), mm);
    else { const rtPivot = rtAt(pivotPhi, 1); const slope = Math.log10(rt / rtPivot) / Math.log10(pivotPhi / phi); if (Number.isFinite(slope)) onLine(p.sat.rw, Math.max(1.3, Math.min(3, slope))); }
  };
  return <section className="nodal-card" ref={box}>
    <header><b>Pickett plot</b><small>Rw {p.sat.rw.toFixed(3)} · m {mm.toFixed(2)} · n {p.sat.n.toFixed(2)} · points coloured by Vsh · drag a box to pick</small></header>
    <svg width={W} height={H} onPointerDown={(event) => { pick.start(event); }} onPointerMove={move} onPointerUp={() => { drag.current = null; pick.end(); }}>
      {[0.2, 2, 20, 200, 2000].map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={m.t} y2={H - m.b} className="nodal-grid" /><text x={x(t)} y={H - 8} textAnchor="middle" className="vol-tick">{t}</text></g>)}
      {[0.02, 0.05, 0.1, 0.2, 0.5].map((t) => <g key={t}><line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="nodal-grid" /><text x={m.l - 4} y={y(t) + 3} textAnchor="end" className="vol-tick">{t}</text></g>)}
      {sample.map((r, i) => <circle key={i} cx={x(r.rt)} cy={y(r.phi)} r={2} className={lit ? lit(r.mdM) ? "pf-pt is-lit" : "pf-pt is-dim" : "pf-pt"} style={{ fill: `color-mix(in oklab, #6b4f3a ${Math.round(r.vsh * 100)}%, #38bdf8)` }} />)}
      {lit && usable.filter((r) => lit(r.mdM)).map((r, i) => <circle key={`l${i}`} cx={x(r.rt)} cy={y(r.phi)} r={2.6} className="pf-pt-lit" />)}
      {pick.shape}
      {[0.75, 0.5, 0.3, 0.2].map((sw) => <g key={sw}><path d={lineAt(sw)} className="pf-swline" /><text x={x(rtAt(0.45, sw)) + 4} y={y(0.45) + 3} className="vol-tick">{Math.round(sw * 100)}%</text></g>)}
      <path d={lineAt(1)} className="pf-water" />
      <path d={lineAt(1)} className="pf-water-hit" onPointerDown={(event) => { event.stopPropagation(); (event.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(event.pointerId); drag.current = "shift"; }} />
      <g className="pf-shale" transform={`translate(${x(rtAt(0.05, 1))},${y(0.05)})`} onPointerDown={(event) => { event.stopPropagation(); (event.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(event.pointerId); drag.current = "tilt"; }}><circle r={6} /><text x={9} y={4}>m</text></g>
      <text x={m.l + 4} y={H - m.b - 4} className="vol-tick">Rt, Ω·m → · φ ↑</text>
    </svg>
  </section>;
}

/** P90, P50 and P10 of the hydrocarbon column and net pay, their spread, and what drives it. */
function MonteCarlo({ mc }: { readonly mc: ReturnType<typeof monteCarloPay> }) {
  const [box, size] = useSize<HTMLDivElement>();
  const W = Math.max(240, size.width - 16), H = 110, m = { l: 8, r: 8, t: 6, b: 20 };
  const lo = Math.min(...mc.columns), hi = Math.max(...mc.columns, lo + 1e-6), bins = Array.from({ length: 24 }, () => 0);
  for (const c of mc.columns) bins[Math.min(23, Math.floor((c - lo) / (hi - lo) * 24))]!++;
  const x = scaleLinear().domain([lo, hi]).range([m.l, W - m.r]), yh = scaleLinear().domain([0, Math.max(...bins)]).range([H - m.b, m.t]);
  const swing = Math.max(1e-6, ...mc.tornado.map((t) => Math.max(Math.abs(t.high - mc.base), Math.abs(t.low - mc.base))));
  const label: Readonly<Record<string, string>> = { rw: "Rw", m: "m", n: "n", rsh: "Rsh", vshCut: "Vsh cutoff", phiCut: "φ cutoff", swCut: "Sw cutoff" };
  return <>
    <section className="nodal-card" ref={box}>
      <header><b>Hydrocarbon column</b><small>Σφ(1−Sw)h over {mc.columns.length} runs, m</small></header>
      <div className="pf-pcts">{(["p90", "p50", "p10"] as const).map((k) => <span key={k}><small>{k.toUpperCase()}</small><b>{mc.column[k].toFixed(2)}</b><em>pay {mc.pay[k].toFixed(1)} m</em></span>)}</div>
      <svg width={W} height={H}>
        {bins.map((n, i) => <rect key={i} x={x(lo + (hi - lo) * i / 24) + 0.5} y={yh(n)} width={Math.max(1, x(lo + (hi - lo) / 24) - x(lo) - 1)} height={H - m.b - yh(n)} className="pf-bin is-mc" />)}
        {(["p90", "p50", "p10"] as const).map((k) => <g key={k}><line x1={x(mc.column[k])} x2={x(mc.column[k])} y1={m.t} y2={H - m.b} className="vol-mark" /><text x={x(mc.column[k])} y={H - 6} textAnchor="middle" className="vol-tick">{k.toUpperCase()}</text></g>)}
      </svg>
    </section>
    <section className="nodal-card">
      <header><b>Tornado</b><small>each input alone at its low and high</small></header>
      <div className="pf-tornado">{mc.tornado.map((t) => <div key={t.key}><span>{label[t.key]}</span><i><b style={{ left: `${50 + Math.min(0, t.low - mc.base, t.high - mc.base) / swing * 50}%`, width: `${Math.abs(t.high - t.low) / swing * 50}%` }} /></i></div>)}</div>
    </section>
  </>;
}
