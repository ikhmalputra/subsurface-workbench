import { useMemo } from "react";
import { clippedAt, correlation, geometricMean, neutronDensityPorosity, poissonFromVelocityRatio } from "@ikhmalputra/subsurface-core/contracts";
import { metresToFeet } from "@ikhmalputra/subsurface-core";
import { PetrophysicsCrossplot } from "@ikhmalputra/subsurface-react/2d";
import { useForgeOpenHole } from "../data/openhole.ts";
import { fmt } from "../format.ts";
import { Loading } from "./Empty.tsx";
import { useWire } from "./wire.ts";

const pct = (value: number | null) => value === null ? "not computed" : `${fmt(value * 100, 1)} %`;
const num = (value: number | null, digits = 0, unit = "") => value === null ? "not computed" : `${fmt(value, digits)}${unit}`;
const median = (values: readonly number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const mean = (values: readonly number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

/** Thorium-to-potassium ratios that bound the usual mineral fields on a Th–K crossplot (Schlumberger chart). */
const TH_K_LINES = [1, 3.5, 12, 25] as const;

/**
 * Petrophysics for crystalline rock on FORGE's own logs. In granite there is no shale to
 * subtract and no hydrocarbon to find: what the logs say is how tight the rock is, what it is made
 * of, and where it is fractured. So: porosity three independent ways (density, neutron, sonic) and
 * how far they agree; mineralogy from the spectral gamma ray (potassium, thorium, uranium, Th/K);
 * fracture intensity from the FMI against deep resistivity; the velocity ratio and its Poisson's
 * ratio against Schlumberger's. Every reading the data does not support is flagged, not used: the
 * interval inside casing, the induction curve pinned at its ceiling, washouts, negative uranium.
 */
export function CrystallinePetrophysics() {
  const wire = useWire("petro");
  const { openHole, error } = useForgeOpenHole(true);
  const interval = wire.brush ?? (openHole ? [openHole.shoeMdM, openHole.logBaseMdM] as const : null);
  const result = useMemo(() => {
    if (!openHole || !interval) return null;
    const c = (mnemonic: string) => openHole.curve(mnemonic).values;
    const md = openHole.curve("GR").depthsMdM;
    const [bs, c13, c24, dphi, nphi, sphi, rt10, rt90, k, th, u, p32, dtc, dts, pr] = ["BS", "C13", "C24", "DPHI", "NPHI_SAN", "SPHI", "RT10", "RT90", "K", "TH", "U", "P32", "DTC", "DTS", "PR"].map(c) as Float64Array[];
    const rt10Clip = clippedAt(rt10!);
    const rows: number[] = [];
    let cased = 0, washed = 0, oval = 0;
    for (let i = 0; i < md.length; i++) {
      if (md[i]! < interval[0] || md[i]! > interval[1]) continue;
      // Above the shoe the bit size is the casing's hole: those readings are through steel.
      if (md[i]! < openHole.shoeMdM || bs![i]! > 9) { cased++; continue; }
      // Both arm pairs over the bit: the hole is enlarged all round.
      if (Math.min(c13![i]!, c24![i]!) - bs![i]! > 0.5) washed++;
      rows.push(i);
    }
    // On FORGE the 1–3 arms read about half an inch over the bit through the whole open hole while
    // 2–4 read on gauge: a steady offset (the arms or the tool riding the low side), not breakouts.
    // So ovality counts only where the two arm pairs part by a quarter inch more than that baseline.
    const armGaps = rows.map((i) => Math.abs(c13![i]! - c24![i]!)).filter(Number.isFinite);
    const armOffset = median(armGaps);
    for (const gap of armGaps) if (armOffset !== null && gap > armOffset + 0.25) oval++;
    const pick = (values: Float64Array, keep: (value: number) => boolean = Number.isFinite) => rows.map((i) => values[i]!).filter(keep);
    const nd = rows.map((i) => Number.isFinite(dphi![i]!) && Number.isFinite(nphi![i]!) ? neutronDensityPorosity(dphi![i]!, nphi![i]!) : Number.NaN).filter(Number.isFinite);
    const ratio = rows.map((i) => k![i]! > 0 ? th![i]! / k![i]! : Number.NaN).filter(Number.isFinite);
    const vpvs = rows.map((i) => dts![i]! / dtc![i]!).filter((value) => Number.isFinite(value) && value > Math.SQRT2);
    const vpvsMean = mean(vpvs);
    return {
      samples: rows.length, cased, washed, oval, armOffset,
      phiD: mean(pick(dphi!)), phiN: mean(pick(nphi!)), phiS: mean(pick(sphi!)), phiND: mean(nd),
      rt90: geometricMean(pick(rt90!)), rt10Clip, rt10Clipped: rt10Clip === null ? 0 : rows.filter((i) => rt10![i] === rt10Clip).length,
      k: mean(pick(k!)), th: mean(pick(th!)), u: mean(pick(u!)), thk: mean(ratio), negativeU: rows.filter((i) => u![i]! < 0).length,
      p32: mean(pick(p32!)), p32Max: Math.max(...pick(p32!), -Infinity), fractured: rows.filter((i) => p32![i]! >= 2).length,
      p32VsRt: correlation(rows.map((i) => p32![i]!), rows.map((i) => rt90![i]! > 0 ? Math.log10(rt90![i]!) : Number.NaN)),
      vpvs: vpvsMean, nuDyn: vpvsMean === null ? null : poissonFromVelocityRatio(vpvsMean), prDelivered: mean(pick(pr!)),
      p32ByMd: new Map(rows.map((i) => [md[i]!, p32![i]!])),
    };
  }, [openHole, interval?.[0], interval?.[1]]);
  if (!openHole || !interval || !result) return <Loading>{error ? `The open-hole logs could not be read (${error}).` : "Reading the FORGE open-hole logs…"}</Loading>;
  const ft = (m: number) => fmt(metresToFeet(m));
  const p32Colour = (md: number) => { const value = result.p32ByMd.get(md); return value === undefined || !Number.isFinite(value) ? "var(--ink-3)" : `color-mix(in oklab, #f59e0b ${Math.round(Math.min(1, value / 4) * 100)}%, #60a5fa)`; };
  return <div className="petro">
    <header className="petro-head">
      <div><b>16A(78)-32</b> <span className="badge is-documented">documented logs</span></div>
      <div className="petro-interval">{fmt(interval[0])}–{fmt(interval[1])} m MD ({ft(interval[0])}–{ft(interval[1])} ft) · {wire.brush ? "brushed" : "granite, open hole"}
        {wire.brush ? <button type="button" onClick={() => wire.setBrush(null)}>Whole open hole</button> : null}</div>
    </header>
    <dl className="petro-summary">
      <div><dt>φ density</dt><dd>{pct(result.phiD)}</dd></div>
      <div><dt>φ neutron</dt><dd>{pct(result.phiN)}</dd></div>
      <div><dt>φ sonic</dt><dd>{pct(result.phiS)}</dd></div>
      <div><dt>φ neutron–density</dt><dd>{pct(result.phiND)}</dd></div>
      <div><dt>Rt (90 in), geometric</dt><dd>{num(result.rt90, 0, " Ω·m")}</dd></div>
      <div><dt>K · Th · U</dt><dd>{num(result.k, 1, "%")} · {num(result.th, 1)} · {num(result.u, 1)} ppm</dd></div>
      <div><dt>Th/K</dt><dd>{num(result.thk, 1)}</dd></div>
      <div><dt>Fractures, P32</dt><dd>{num(result.p32, 2, " /ft")} · max {num(Number.isFinite(result.p32Max) ? result.p32Max : null, 1)}</dd></div>
      <div><dt>Vp/Vs · ν</dt><dd>{num(result.vpvs, 2)} · {num(result.nuDyn, 3)}</dd></div>
      <div><dt>ν delivered (IsoMechPro)</dt><dd>{num(result.prDelivered, 3)}</dd></div>
      <div><dt>P32 vs log Rt</dt><dd>{result.p32VsRt === null ? "not computed" : `r = ${fmt(result.p32VsRt, 2)}`}</dd></div>
      <div><dt>Fractured ≥ 2/ft</dt><dd>{fmt(result.fractured)} of {fmt(result.samples)} ft</dd></div>
    </dl>
    <p className="petro-note">
      Granite: porosity reads a few percent by every method and is mostly the minerals talking (the neutron sees bound water in micas; the density uses a 2.65 g/cm³ sandstone matrix). Fluids move in fractures, so the fracture intensity, not the matrix porosity, is the reservoir.
      {result.cased > 0 && ` ${fmt(result.cased)} ft inside casing left out.`}
      {result.rt10Clip !== null && ` The 10 in induction is pinned at ${fmt(result.rt10Clip)} Ω·m on ${fmt(result.rt10Clipped)} of these feet: the tool's ceiling, not a reading; the 90 in curve is used.`}
      {result.washed > 0 && ` ${fmt(result.washed)} ft enlarged all round (both calipers over the bit by 0.5 in).`}
      {result.armOffset !== null && ` The two caliper arm pairs differ by ${fmt(result.armOffset, 2)} in as a rule, a steady offset rather than an oval hole;`}
      {result.armOffset !== null && ` they part by a further quarter inch on ${fmt(result.oval)} ft, the oval hole a breakout would make.`}
      {result.negativeU > 0 && ` Uranium reads below zero on ${fmt(result.negativeU)} ft, a spectral-processing artefact; it is kept as delivered.`}
    </p>
    <PetrophysicsCrossplot xCurve={openHole.curve("K")} yCurve={openHole.curve("TH")} depthRangeMdM={interval} onlyInRange maxPoints={900}
      xDomain={[0, 8]} yDomain={[0, 50]} title="Thorium against potassium (HNGS)" onSelectMd={wire.pin} onBrushChange={(range) => { if (range) wire.setBrush(range); }}
      pointColor={p32Colour} overlay={thKLines} />
    <PetrophysicsCrossplot xCurve={openHole.curve("RT90")} yCurve={openHole.curve("P32")} depthRangeMdM={interval} onlyInRange maxPoints={900} xScale="log"
      xDomain={[10, 3000]} yDomain={[0, 5]} title="Fracture intensity against deep resistivity" onSelectMd={wire.pin} onBrushChange={(range) => { if (range) wire.setBrush(range); }} pointColor={p32Colour} />
    <p className="xp-legend"><i style={{ background: "#60a5fa" }} />few fractures<i style={{ background: "#f59e0b" }} />many (P32 ≥ 4/ft) · hollow marks lie beyond the axes, pinned to the frame · drag a box over points to brush their depths · Th/K lines from the Schlumberger chart</p>
    <p className="petro-note">Source: Utah FORGE 16A(78)-32 logs, GDR 1292 (Schlumberger thru-bit combination, dipole sonic, HNGS, FMI), CC BY 4.0, binned to 1 ft.</p>
  </div>;
}

function thKLines({ x, y }: { readonly x: (value: number) => number; readonly y: (value: number) => number }) {
  return TH_K_LINES.map((ratio) => {
    const kEnd = Math.min(8, 50 / ratio);
    return <g key={ratio} className="lith-line">
      <line x1={x(0)} y1={y(0)} x2={x(kEnd)} y2={y(ratio * kEnd)} />
      <text x={x(kEnd) - 4} y={y(ratio * kEnd) - 4} textAnchor="end">Th/K {ratio}</text>
    </g>;
  });
}
