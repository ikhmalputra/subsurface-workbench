import { useMemo, useState } from "react";
import { calculateArchieWaterSaturation, densityPorosity, gammaRayLines, netPaySummary, neutronDensityPorosity, shaleVolumeFromGamma } from "@ikhmalputra/subsurface-core/contracts";
import type { PetrophysicsLogCurve, ShaleVolumeMethod } from "@ikhmalputra/subsurface-core/contracts";
import { PetrophysicsCrossplot } from "@ikhmalputra/subsurface-react/2d";
import { Frame, Inspector, Status } from "./frame/Frame.tsx";
import { useWire } from "./wire.ts";
import { CrystallinePetrophysics } from "./PetroCrystalline.tsx";
import { ForcePetrophysics } from "./PetroForce.tsx";

import { fmt } from "../format.ts";
const pct = (value: number | null) => value === null ? "not computed" : `${fmt(value * 100, 1)} %`;

/** Matrix points in limestone-unit neutron and density, joined to fresh water at (1, 1). */
const LITHOLOGIES = [
  { name: "Sandstone", neutron: -0.035, density: 2.65 },
  { name: "Limestone", neutron: 0, density: 2.71 },
  { name: "Dolomite", neutron: 0.005, density: 2.87 },
] as const;

interface Parameters {
  readonly a: number; readonly m: number; readonly n: number; readonly rw: number;
  readonly vshCut: number; readonly phiCut: number; readonly swCut: number;
  readonly method: "density" | "density-neutron";
  readonly vshMethod: ShaleVolumeMethod;
}

/**
 * Porosity, saturation and pay over the brushed interval (or the sand, unbrushed), recomputed as the
 * interval or a parameter changes. Shale fraction from gamma ray between the well's clean and shale
 * lines; porosity from density, or density–neutron where gas suppresses the neutron; water
 * saturation by Archie (core's calculation). Samples flagged by DRHO are left out of porosity and
 * counted. The core plugs read against the log porosity at their depths.
 */
export function Petrophysics() {
  const wire = useWire("petro");
  return wire.place?.siteId === "forge" ? <CrystallinePetrophysics /> : wire.place?.kind === "force" ? <ForcePetrophysics /> : <ClasticPetrophysics />;
}

function ClasticPetrophysics() {
  const wire = useWire("petro");
  const place = wire.place!;
  const logs = place.petro!;
  const curve = (mnemonic: string) => logs.well.curves.find((entry) => entry.mnemonic === mnemonic)!;
  const sand = logs.well.zones.find((zone) => zone.id === "sand")!;
  const [params, setParams] = useState<Parameters>({ a: logs.archie.a, m: logs.archie.m, n: logs.archie.n, rw: logs.archie.rwOhmM, vshCut: 0.4, phiCut: 0.1, swCut: 0.5, method: "density-neutron", vshMethod: "larionov-tertiary" });
  const interval = wire.brush ?? [sand.topMdM, sand.baseMdM] as const;
  const result = useMemo(() => {
    const md = curve("GR").depthsMdM;
    const gr = curve("GR").values, rhob = curve("RHOB").values, nphi = curve("NPHI").values, rt = curve("RT").values, drho = curve("DRHO").values;
    const lines = gammaRayLines(gr);
    const index: number[] = [];
    for (let i = 0; i < md.length; i++) if (md[i]! >= interval[0] && md[i]! <= interval[1]) index.push(i);
    // DRHO above 0.05 g/cm³ flags a density the pad could not trust: no porosity there.
    const bad = (i: number) => drho[i]! > 0.05;
    const porosityAt = (i: number) => {
      const phiD = densityPorosity(rhob[i]!);
      return Math.min(0.45, Math.max(0.001, params.method === "density" ? phiD : neutronDensityPorosity(phiD, nphi[i]!)));
    };
    const depths = Float64Array.from(index, (i) => md[i]!);
    const base = { version: 1 as const, wellId: logs.well.wellId, depthReference: logs.well.depthReference, depthsMdM: depths };
    const phiCurve: PetrophysicsLogCurve = { ...base, id: "phi", mnemonic: "PHIE", name: "Porosity", unit: "v/v", values: Float64Array.from(index, (i) => bad(i) ? Number.NaN : porosityAt(i)), nullValue: "nan" };
    const rtCurve: PetrophysicsLogCurve = { ...base, id: "rt", mnemonic: "RT", name: "Deep resistivity", unit: "ohm.m", values: Float64Array.from(index, (i) => rt[i]!), nullValue: "nan" };
    const archie = index.length ? calculateArchieWaterSaturation(phiCurve, rtCurve, { a: params.a, m: params.m, n: params.n, rwAtFormationTemperatureOhmM: params.rw }) : null;
    const samples = index.map((i, k) => ({ mdM: md[i]!, vsh: shaleVolumeFromGamma(gr[i]!, lines, params.vshMethod), porosity: bad(i) ? null : porosityAt(i), sw: archie?.points[k]?.value ?? null }));
    const summary = netPaySummary(samples, { vshMax: params.vshCut, porosityMin: params.phiCut, swMax: params.swCut });
    const swByMd = new Map(samples.map((sample) => [sample.mdM, sample.sw]));
    return { samples, summary, swByMd, lines, count: index.length };
  }, [logs, interval[0], interval[1], params]);
  const contacts = logs.well.tops.filter((top) => top.id === "goc" || top.id === "owc");
  const plugs = logs.well.corePoints.map((plug) => {
    const nearest = result.samples.reduce<(typeof result.samples)[number] | null>((best, sample) => !best || Math.abs(sample.mdM - plug.mdM) < Math.abs(best.mdM - plug.mdM) ? sample : best, null);
    return { plug, core: plug.measurements?.find((entry) => entry.mnemonic === "CPOR")?.value ?? null, perm: plug.measurements?.find((entry) => entry.mnemonic === "CPERM")?.value ?? null, inside: plug.mdM >= interval[0] && plug.mdM <= interval[1], nearest };
  });
  const set = (change: Partial<Parameters>) => setParams((current) => ({ ...current, ...change }));
  const number = (label: string, key: "a" | "m" | "n" | "rw", stepValue: number) => <label className="petro-param">{label}<input type="number" step={stepValue} min={stepValue} value={params[key]} onChange={(event) => { const value = Number(event.target.value); if (value > 0) set({ [key]: value }); }} /></label>;
  return <Frame name="petro" className="petro pc" title={place.label} subtitle={`Petrophysics · ${fmt(interval[0])}–${fmt(interval[1])} m MD · ${wire.brush ? "brushed" : "Sand R1 (Shift-drag on the logs to brush)"}`}
    tools={<>
      <span className="badge is-synthetic">synthetic logs</span>
      {wire.brush ? <button type="button" className="tie-button" onClick={() => wire.setBrush(null)}>Whole sand</button> : <button type="button" className="tie-button" onClick={() => wire.setBrush([sand.topMdM, sand.baseMdM])}>Brush the sand</button>}
    </>}
    numbers={<>
      <span><small>Net pay</small><b>{fmt(result.summary.payM, 1)} m</b></span>
      <span><small>φ, net</small><b>{pct(result.summary.porosityNet)}</b></span>
      <span><small>Sw, pay</small><b>{pct(result.summary.swPay)}</b></span>
    </>}
    canvas={<div className="mf-plot pc-plots">
      <div className="pc-grid is-one">
        <PetrophysicsCrossplot xCurve={curve("NPHI")} yCurve={curve("RHOB")} depthRangeMdM={interval} onlyInRange maxPoints={900}
          xDomain={[-0.05, 0.45]} yDomain={[2.95, 1.9]} title="Density–neutron, coloured by Sw" onSelectMd={wire.pin} onBrushChange={(range) => { if (range) wire.setBrush(range); }}
          pointColor={(md) => swColour(result.swByMd.get(md) ?? null)} overlay={lithologyLines} />
      </div>
      <p className="xp-legend"><i style={{ background: "#f59e0b" }} />low Sw<i style={{ background: "#60a5fa" }} />high Sw · gas plots up and left of the sandstone line · drag a box over points to brush their depths</p>
    </div>}
    inspector={<Inspector id="petro-clastic" initial="params" head={<dl className="mf-facts">
      <div className="mf-facts-title"><dt>{fmt(interval[0])}–{fmt(interval[1])} m MD</dt><dd>{wire.brush ? "brushed" : "Sand R1"}</dd></div>
      <div><dt>Gross</dt><dd>{fmt(result.summary.grossM, 1)} m</dd></div>
      <div><dt>Net sand</dt><dd>{fmt(result.summary.netM, 1)} m</dd></div>
      <div><dt>Net pay</dt><dd>{fmt(result.summary.payM, 1)} m</dd></div>
      <div><dt>Net / gross</dt><dd>{pct(result.summary.netToGross)}</dd></div>
      <div><dt>φ, net</dt><dd>{pct(result.summary.porosityNet)}</dd></div>
      <div><dt>Sw, pay</dt><dd>{pct(result.summary.swPay)}</dd></div>
      <div><dt>φ·(1−Sw)·h</dt><dd>{fmt(result.summary.hydrocarbonColumnM, 2)} m</dd></div>
      <div><dt>Bad hole</dt><dd>{result.summary.unusableSamples} of {result.count} samples</dd></div>
    </dl>} sections={[
      { id: "params", title: "Archie and methods", summary: `m ${params.m} · n ${params.n}`, body: <div className="pc-params">
        {number("a", "a", 0.05)}{number("m", "m", 0.05)}{number("n", "n", 0.05)}{number("Rw Ω·m", "rw", 0.005)}
        <label className="petro-param">Vsh<select value={params.vshMethod} onChange={(event) => set({ vshMethod: event.target.value as ShaleVolumeMethod })}><option value="linear">linear</option><option value="larionov-tertiary">Larionov, Tertiary</option><option value="larionov-older">Larionov, older</option></select></label>
        <label className="petro-param">φ from<select value={params.method} onChange={(event) => set({ method: event.target.value as Parameters["method"] })}><option value="density-neutron">density–neutron</option><option value="density">density</option></select></label>
      </div> },
      { id: "cutoffs", title: "Cutoffs", summary: `Vsh ${params.vshCut.toFixed(2)} · φ ${params.phiCut.toFixed(2)} · Sw ${params.swCut.toFixed(2)}`, body: <div className="pc-cuts">
        <label className="petro-cut">Vsh ≤ <input type="range" min={0.1} max={0.7} step={0.05} value={params.vshCut} onChange={(event) => set({ vshCut: Number(event.target.value) })} /><b>{params.vshCut.toFixed(2)}</b></label>
        <label className="petro-cut">φ ≥ <input type="range" min={0.02} max={0.25} step={0.01} value={params.phiCut} onChange={(event) => set({ phiCut: Number(event.target.value) })} /><b>{params.phiCut.toFixed(2)}</b></label>
        <label className="petro-cut">Sw ≤ <input type="range" min={0.2} max={0.9} step={0.05} value={params.swCut} onChange={(event) => set({ swCut: Number(event.target.value) })} /><b>{params.swCut.toFixed(2)}</b></label>
      </div> },
      { id: "plugs", title: "Core plugs", summary: `${plugs.length}`, body: <table className="petro-plugs">
        <thead><tr><th>Core plug</th><th>MD, m</th><th>Core φ</th><th>Log φ</th><th>k, mD</th></tr></thead>
        <tbody>{plugs.map(({ plug, core, perm, inside, nearest }) => <tr key={plug.id} className={inside ? "" : "is-outside"}>
          <td>{plug.label}</td><td>{fmt(plug.mdM, 1)}</td><td>{core === null ? "not reported" : pct(core)}</td>
          <td>{inside && nearest ? pct(nearest.porosity) : "outside the interval"}</td>
          <td>{perm === null ? "not reported" : fmt(perm, 1)}</td>
        </tr>)}</tbody>
      </table> },
      { id: "method", title: "Method", body: <p className="mf-prose">Vsh ({params.vshMethod.replace("-", " ")}) from GR between {fmt(result.lines.clean)} and {fmt(result.lines.shale)} gAPI (the well&apos;s 5th and 95th percentile). {contacts.length ? `Contacts: ${contacts.map((top) => `${top.name} ${fmt(top.mdM)} m`).join(", ")}.` : "No contact in this well."}</p> },
    ]} />}
    status={<Status items={["Drag a box over points to brush their depths · click one to pin it", "Synthetic logs"]} />} />;
}

const swColour = (sw: number | null) => sw === null ? "var(--ink-3)" : `color-mix(in oklab, #60a5fa ${Math.round(Math.min(1, sw) * 100)}%, #f59e0b)`;

/** Each matrix joined to fresh water at (1, 1), with porosity ticks at 10, 20 and 30 %. */
function lithologyLines({ x, y }: { readonly x: (value: number) => number; readonly y: (value: number) => number }) {
  return LITHOLOGIES.map((lith) => {
    const t = (lith.density - 1.9) / (lith.density - 1);
    return <g key={lith.name} className="lith-line">
      <line x1={x(lith.neutron)} y1={y(lith.density)} x2={x(lith.neutron + (1 - lith.neutron) * t)} y2={y(1.9)} />
      {[0.1, 0.2, 0.3].map((phi) => <circle key={phi} cx={x(lith.neutron + (1 - lith.neutron) * phi)} cy={y(lith.density + (1 - lith.density) * phi)} r={2} />)}
      <text x={x(lith.neutron) + 4} y={y(lith.density) - 4}>{lith.name}</text>
    </g>;
  });
}
