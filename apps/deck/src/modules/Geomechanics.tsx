import { useMemo, useState } from "react";
import { scaleLinear } from "d3-scale";
import { breakdownPressure, collapsePressure, feetToMetres, forge5832Stress, metresToFeet, stressRegime } from "@ikhmalputra/subsurface-core";
import type { ComputedStation } from "@ikhmalputra/subsurface-core";
import { forgeOperations } from "@ikhmalputra/subsurface-core/records";
import { useForgeOpenHole, valueAt, type OpenHole } from "../data/openhole.ts";
import { fmt } from "../format.ts";
import { Loading } from "./Empty.tsx";
import { useSize } from "./useSize.ts";
import { useWire } from "./wire.ts";

const STEP_FT = 25;
/** 16A's RKB stands 30 ft above ground (5,444 ft against 5,414 ft, its survey workbook); 58-32's KB 21.5 ft (its log header). */
const RKB_ABOVE_GROUND_16A_FT = 30;
const KB_ABOVE_GROUND_5832_FT = 21.5;
const AZIMUTHS = Array.from({ length: 12 }, (_, k) => k * 15);
const ppg = (psi: number, tvdFt: number) => psi / (0.052 * tvdFt);
/** A breakout is predicted where the wall fails above pore pressure and the mud was lighter than that, by more than rounding. */
const breaksOut = (row: Row, which: 0 | 1) => row.mud !== null && row.collapse !== null && row.collapse[which] > row.pp + 1 && row.mud < ppg(row.collapse[which], row.tvdFt) - 0.05;
/** The wall parts in tension already at pore pressure: drilling-induced fractures, whatever the mud. */
const tensileAtPore = (row: Row) => row.breakdown !== null && row.breakdown[0] <= row.pp + 1;
type Source = "5832" | "16a";

interface Row {
  readonly mdM: number; readonly tvdFt: number;
  readonly pp: number; readonly sv: number; readonly sh: number; readonly sH: number; readonly sh16: number; readonly sh5832: number | null;
  readonly extrapolated: boolean;
  readonly collapse: readonly [number, number] | null; readonly breakdown: readonly [number, number] | null;
  readonly mud: number | null; readonly oval: boolean; readonly ucs: number;
}

/** 58-32's calibrated stresses at a depth below ground; past its TD, its granite gradient carried on. */
function stress5832(belowGroundFt: number) {
  const md = forge5832Stress.mdFt, kbFt = belowGroundFt + KB_ABOVE_GROUND_5832_FT;
  const pick = (values: readonly (number | null)[], i: number) => values[i] ?? null;
  if (kbFt >= md[0]! && kbFt <= md.at(-1)!) {
    const i = Math.min(md.length - 1, Math.max(0, Math.round((kbFt - md[0]!) / 5)));
    const sh = pick(forge5832Stress.shMinPsi, i), sH = pick(forge5832Stress.shMaxPsi, i);
    return sh === null || sH === null ? null : { sh, sH, extrapolated: false };
  }
  if (kbFt < md[0]!) return null;
  return { sh: GRANITE_GRADIENT.sh * belowGroundFt, sH: GRANITE_GRADIENT.sH * belowGroundFt, extrapolated: true };
}
/** 58-32's mean stress gradients below ground through its granite (4,500 ft to TD), for depths past its TD. */
const GRANITE_GRADIENT = (() => {
  let sh = 0, sH = 0, n = 0;
  forge5832Stress.mdFt.forEach((md, i) => {
    const below = md - KB_ABOVE_GROUND_5832_FT, a = forge5832Stress.shMinPsi[i], b = forge5832Stress.shMaxPsi[i];
    if (md >= 4500 && a != null && b != null) { sh += a / below; sH += b / below; n++; }
  });
  return { sh: sh / n, sH: sH / n };
})();
/** SHmax relative to Shmin in 58-32's granite, as (SHmax − Pp)/(Shmin − Pp) with hydrostatic Pp: carried to 16A's own Shmin. */
const SHMAX_RATIO = (() => {
  const ratios: number[] = [];
  forge5832Stress.mdFt.forEach((md, i) => {
    const pp = 0.433 * md, a = forge5832Stress.shMinPsi[i], b = forge5832Stress.shMaxPsi[i];
    if (md >= 4500 && a != null && b != null && a > pp) ratios.push((b - pp) / (a - pp));
  });
  ratios.sort((a, b) => a - b);
  return ratios[ratios.length >> 1]!;
})();

/** The mud each depth was drilled with, from the daily reports: the depth reached each day, and that day's mud weight. */
function mudByDepth() {
  const steps: { fromFt: number; toFt: number; ppg: number }[] = [];
  let reached = 0;
  for (const day of forgeOperations.days) {
    if (day.mdFt === null || day.mdFt <= reached) continue;
    if (day.mudWeightPpg !== null) steps.push({ fromFt: reached, toFt: day.mdFt, ppg: day.mudWeightPpg });
    reached = day.mdFt;
  }
  return (mdFt: number) => steps.find((step) => mdFt > step.fromFt && mdFt <= step.toFt)?.ppg ?? null;
}

function stationAt(survey: readonly ComputedStation[], mdM: number) {
  const i = Math.max(1, survey.findIndex((station) => station.mdM >= mdM));
  const a = survey[i - 1]!, b = survey[i] ?? a, t = b.mdM > a.mdM ? (mdM - a.mdM) / (b.mdM - a.mdM) : 0;
  let dAz = b.azimuthDeg - a.azimuthDeg; if (dAz > 180) dAz -= 360; if (dAz < -180) dAz += 360;
  return { tvdM: a.tvdM + t * (b.tvdM - a.tvdM), inclinationDeg: a.inclinationDeg + t * (b.inclinationDeg - a.inclinationDeg), azimuthDeg: (a.azimuthDeg + t * dAz + 360) % 360 };
}

function build(openHole: OpenHole, survey: readonly ComputedStation[], source: Source): Row[] {
  const mud = mudByDepth();
  const gaps = (() => { const c13 = openHole.curve("C13").values, c24 = openHole.curve("C24").values; const g: number[] = []; for (let i = 0; i < c13.length; i++) if (Number.isFinite(c13[i]!) && Number.isFinite(c24[i]!)) g.push(Math.abs(c13[i]! - c24[i]!)); g.sort((a, b) => a - b); return g[g.length >> 1] ?? 0; })();
  const rows: Row[] = [];
  for (let mdFt = 6000; mdFt <= 10940; mdFt += STEP_FT) {
    const mdM = feetToMetres(mdFt);
    const v = (mnemonic: string) => valueAt(openHole, mnemonic, mdM);
    const [svG, shG, ppG, ucs, fang, tstr, pr, c13, c24] = ["SV_G", "SHMIN_G", "PP_G", "UCS", "FANG", "TSTR", "PR", "C13", "C24"].map(v);
    if (svG == null || shG == null || ppG == null || ucs == null || fang == null || tstr == null || pr == null) continue;
    const at = stationAt(survey, mdM), tvdFt = metresToFeet(at.tvdM), below = tvdFt - RKB_ABOVE_GROUND_16A_FT;
    const pp = ppG * tvdFt, sv = svG * tvdFt, sh16 = shG * tvdFt;
    const other = stress5832(below);
    const sh = source === "5832" && other ? other.sh : sh16;
    const sH = source === "5832" && other ? other.sH : pp + SHMAX_RATIO * (sh16 - pp);
    const rock = { ucsPsi: ucs, frictionDeg: fang, tensilePsi: tstr, poisson: pr };
    const hole = { inclinationDeg: at.inclinationDeg, azimuthDeg: at.azimuthDeg };
    const collapses: number[] = [], breakdowns: number[] = [];
    for (const azimuth of AZIMUTHS) {
      const stress = { svPsi: sv, shMaxPsi: sH, shMinPsi: sh, shMaxAzimuthDeg: azimuth };
      const top = 2 * sv;
      const b = breakdownPressure(stress, hole, rock, pp, top);
      const c = collapsePressure(stress, hole, rock, pp, pp, b ?? top);
      if (c !== null) collapses.push(c);
      if (b !== null) breakdowns.push(b);
    }
    const range = (values: number[]) => values.length ? [Math.min(...values), Math.max(...values)] as const : null;
    rows.push({
      mdM, tvdFt, pp, sv, sh, sH, sh16, sh5832: other?.sh ?? null, extrapolated: other?.extrapolated ?? false,
      collapse: range(collapses), breakdown: range(breakdowns), mud: mud(mdFt),
      oval: c13 != null && c24 != null && Math.abs(c13 - c24) > gaps + 0.25, ucs,
    });
  }
  return rows;
}

/**
 * A 1D mechanical earth model for FORGE 16A(78)-32 through its logged granite: pore pressure,
 * stresses and rock strength from Schlumberger's IsoMechPro deliverable, the horizontal stresses
 * either from 58-32's injection-calibrated profile (GDR 1032) or from 16A's own model, and from
 * them the collapse (breakout) and breakdown pressures of 16A's inclined hole, against the mud it
 * was drilled with and the oval hole its calipers saw.
 */
export function Geomechanics() {
  const wire = useWire("geomech");
  const place = wire.place!;
  const { openHole, error } = useForgeOpenHole(true);
  const [source, setSource] = useState<Source>("5832");
  const rows = useMemo(() => openHole ? build(openHole, place.survey, source) : null, [openHole, place.survey, source]);
  const [box] = useSize<HTMLDivElement>();
  if (!rows) return <Loading>{error ? `The open-hole logs could not be read (${error}).` : "Reading 16A's geomechanical logs…"}</Loading>;
  const near = (md: number | null) => md === null ? null : rows.reduce<Row | null>((best, row) => !best || Math.abs(row.mdM - md) < Math.abs(best.mdM - md) ? row : best, null);
  const here = near(wire.cursor) ?? rows[Math.floor(rows.length * 0.6)]!;
  const withMud = rows.filter((row) => row.mud !== null && row.collapse);
  const anyAzimuth = withMud.filter((row) => breaksOut(row, 0)).length;
  const someAzimuth = withMud.filter((row) => breaksOut(row, 1)).length;
  const ovals = rows.filter((row) => row.oval).length;
  const ovalWhereSome = withMud.filter((row) => row.oval && breaksOut(row, 1)).length;
  const fractures = rows.filter(tensileAtPore).length;
  const regime = stressRegime(here.sv, here.sH, here.sh);
  return <div className="geo" ref={box}>
    <header className="acx-head">
      <span><b>16A(78)-32</b> · 1D mechanical earth model · {fmt(metresToFeet(rows[0]!.mdM))}–{fmt(metresToFeet(rows.at(-1)!.mdM))} ft MD</span>
      <span className="log-sets" role="group" aria-label="Horizontal stresses from">
        <button type="button" aria-pressed={source === "5832"} onClick={() => setSource("5832")}>58-32 calibrated <small>GDR 1032</small></button>
        <button type="button" aria-pressed={source === "16a"} onClick={() => setSource("16a")}>16A model <small>IsoMechPro</small></button>
      </span>
    </header>
    <dl className="petro-summary geo-summary">
      <div><dt>At {fmt(here.mdM)} m MD · {fmt(here.tvdFt)} ft TVD</dt><dd>{regime} faulting</dd></div>
      <div><dt>Pp · Shmin · SHmax · Sv (ppg)</dt><dd>{[here.pp, here.sh, here.sH, here.sv].map((p) => fmt(ppg(p, here.tvdFt), 1)).join(" · ")}</dd></div>
      <div><dt>Collapse (any SHmax azimuth)</dt><dd>{!here.collapse ? "fails at every pressure" : here.collapse[1] <= here.pp + 1 ? "stands at pore pressure" : `${fmt(ppg(here.collapse[0], here.tvdFt), 1)}–${fmt(ppg(here.collapse[1], here.tvdFt), 1)} ppg`}</dd></div>
      <div><dt>Breakdown (any SHmax azimuth)</dt><dd>{!here.breakdown ? "not reached below 2 Sv" : `${tensileAtPore(here) ? "at pore pressure" : fmt(ppg(here.breakdown[0], here.tvdFt), 1)}–${fmt(ppg(here.breakdown[1], here.tvdFt), 1)} ppg`}</dd></div>
      <div><dt>Mud drilled with</dt><dd>{here.mud === null ? "not reported" : `${fmt(here.mud, 1)} ppg`}</dd></div>
      <div><dt>Breakouts predicted · oval hole seen</dt><dd>{fmt(anyAzimuth * STEP_FT)}–{fmt(someAzimuth * STEP_FT)} ft · {fmt(ovals * STEP_FT)} ft{ovalWhereSome ? ` (${fmt(ovalWhereSome * STEP_FT)} ft where predicted)` : ""}</dd></div>
      <div><dt>Tensile at the wall at pore pressure</dt><dd>{fmt(fractures * STEP_FT)} of {fmt(rows.length * STEP_FT)} ft, for some SHmax azimuth</dd></div>
    </dl>
    <WindowPlot rows={rows} cursor={wire.cursor} onHover={wire.hover} onPick={wire.pin} />
    <p className="petro-note">
      <b>Inputs.</b> Pore pressure, vertical stress, UCS, friction angle, tensile strength and Poisson&apos;s ratio: Schlumberger&apos;s IsoMechPro for 16A (GDR 1292), by the 1 ft bins of the open-hole set. Horizontal stresses: {source === "5832"
        ? <>58-32&apos;s profile (GDR 1032; its Biot coefficient calibrated to its injection tests), taken at the same depth below ground, 900 m away in the same granite; below 58-32&apos;s TD its granite gradients carry on ({fmt(GRANITE_GRADIENT.sh, 3)} and {fmt(GRANITE_GRADIENT.sH, 3)} psi/ft below ground).</>
        : <>16A&apos;s own IsoMechPro Shmin (isotropic, not calibrated here); SHmax from it at 58-32&apos;s granite ratio, (SHmax − Pp) = {fmt(SHMAX_RATIO, 2)} × (Shmin − Pp).</>}
      {" "}<b>Method.</b> Wall stresses of the inclined hole (Fjær et al.; Peška &amp; Zoback 1995), Mohr–Coulomb for collapse, the tensile strength for breakdown. No record here gives SHmax&apos;s azimuth, so each is computed for every azimuth and drawn as the band it spans.
      {" "}<b>Check.</b> Predicted breakouts are where the wall fails above pore pressure and the mud was lighter than that; &ldquo;tens.&rdquo; marks depths where, for some SHmax azimuth, the inclined wall is already in tension at pore pressure (drilling-induced fractures whatever the mud); oval hole is where the two caliper pairs part by a quarter inch more than their usual gap. The two Shmin sources disagree: 16A&apos;s model reads {fmt(here.sh16 / here.tvdFt, 2)} psi/ft here{here.sh5832 !== null ? `, 58-32's calibrated profile ${fmt(here.sh5832 / (here.tvdFt - RKB_ABOVE_GROUND_16A_FT), 2)} psi/ft below ground` : ""}.
    </p>
  </div>;
}

/** The window down 16A: pressures as equivalent mud weight against MD, depth down the page like every depth view. */
function WindowPlot({ rows, cursor, onHover, onPick }: { readonly rows: readonly Row[]; readonly cursor: number | null; readonly onHover: (md: number | null) => void; readonly onPick: (md: number | null) => void }) {
  const [box, size] = useSize<HTMLDivElement>();
  const width = Math.max(200, size.width), height = Math.max(160, size.height);
  const m = { left: 54, right: 104, top: 34, bottom: 32 };
  const x = scaleLinear().domain([7, 22]).range([m.left, width - m.right]).clamp(true);
  const y = scaleLinear().domain([rows[0]!.mdM, rows.at(-1)!.mdM]).range([m.top, height - m.bottom]);
  const line = (value: (row: Row) => number | null) => rows.map((row) => { const v = value(row); return v === null ? null : [x(ppg(v, row.tvdFt)), y(row.mdM)] as const; })
    .reduce((path, point, index, all) => point ? `${path}${index && all[index - 1] ? "L" : "M"}${point[0].toFixed(1)},${point[1].toFixed(1)}` : path, "");
  const band = (value: (row: Row) => readonly [number, number] | null) => {
    const kept = rows.filter((row) => value(row));
    if (kept.length < 2) return "";
    const left = kept.map((row) => `${x(ppg(value(row)![0], row.tvdFt)).toFixed(1)},${y(row.mdM).toFixed(1)}`);
    const right = [...kept].reverse().map((row) => `${x(ppg(value(row)![1], row.tvdFt)).toFixed(1)},${y(row.mdM).toFixed(1)}`);
    return `M${left.join("L")}L${right.join("L")}Z`;
  };
  const mud = rows.map((row) => row.mud === null ? null : [x(row.mud), y(row.mdM)] as const).reduce((path, point, index, all) => point ? `${path}${index && all[index - 1] ? "L" : "M"}${point[0].toFixed(1)},${point[1].toFixed(1)}` : path, "");
  const mdAt = (event: { readonly currentTarget: Element; readonly clientY: number }) => { const md = y.invert(event.clientY - event.currentTarget.getBoundingClientRect().top); return md >= rows[0]!.mdM && md <= rows.at(-1)!.mdM ? md : null; };
  const track = width - m.right + 10;
  return <div className="acx-plot geo-plot">
    <div ref={box} className="plot-area"><svg width={width} height={height} role="img" aria-label="Pressure window of 16A(78)-32: pore pressure, collapse band, Shmin, breakdown band and vertical stress as equivalent mud weight, with the mud used, by measured depth"
      onPointerMove={(event) => onHover(mdAt(event))} onPointerLeave={() => onHover(null)} onClick={(event) => onPick(mdAt(event))}>
      {[8, 10, 12, 14, 16, 18, 20, 22].map((tick) => <g key={tick} className="acx-grid"><line x1={x(tick)} x2={x(tick)} y1={m.top} y2={height - m.bottom} /><text x={x(tick)} y={height - m.bottom + 14} textAnchor="middle">{tick}</text></g>)}
      {y.ticks(6).map((tick) => <g key={tick} className="acx-grid"><line x1={m.left} x2={width - m.right} y1={y(tick)} y2={y(tick)} /><text x={m.left - 6} y={y(tick) + 3} textAnchor="end">{fmt(tick)}</text></g>)}
      <path d={band((row) => row.collapse)} className="geo-collapse" />
      <path d={band((row) => row.breakdown)} className="geo-breakdown" />
      <path d={line((row) => row.pp)} className="geo-pp" />
      <path d={line((row) => row.sh)} className="geo-sh" />
      <path d={line((row) => row.sh16)} className="geo-sh-other" />
      <path d={line((row) => row.sv)} className="geo-sv" />
      <path d={mud} className="geo-mud" />
      {rows.filter((row) => row.oval).map((row) => <line key={`o${row.mdM}`} className="geo-oval" x1={track} x2={track + 22} y1={y(row.mdM)} y2={y(row.mdM)} />)}
      {rows.filter((row) => breaksOut(row, 1)).map((row) => <line key={`p${row.mdM}`} className={breaksOut(row, 0) ? "geo-pred is-all" : "geo-pred"} x1={track + 32} x2={track + 54} y1={y(row.mdM)} y2={y(row.mdM)} />)}
      {rows.filter(tensileAtPore).map((row) => <line key={`t${row.mdM}`} className="geo-tensile" x1={track + 64} x2={track + 86} y1={y(row.mdM)} y2={y(row.mdM)} />)}
      {[["oval", 11], ["break-", 43], ["tensile", 75]].map(([label, at]) => <text key={label} className="acx-axis" x={track + Number(at)} y={m.top - 18} textAnchor="middle">{label}</text>)}
      {[["seen", 11], ["outs", 43], ["at Pp", 75]].map(([label, at]) => <text key={label} className="acx-axis" x={track + Number(at)} y={m.top - 6} textAnchor="middle">{label}</text>)}
      <text className="acx-axis" x={(m.left + width - m.right) / 2} y={height - 4} textAnchor="middle">equivalent mud weight (ppg)</text>
      <text className="acx-axis" x={12} y={m.top - 18}>MD (m)</text>
      {cursor !== null && cursor >= rows[0]!.mdM && cursor <= rows.at(-1)!.mdM && <line className="acx-cursor" x1={m.left} x2={width - m.right} y1={y(cursor)} y2={y(cursor)} />}
    </svg></div>
    <p className="xp-legend"><i style={{ background: "#60a5fa" }} />pore pressure<i style={{ background: "#f59e0b" }} />collapse band<i style={{ background: "#4ade80" }} />Shmin<i style={{ background: "#86efac", opacity: 0.5 }} />other Shmin<i style={{ background: "#c084fc" }} />breakdown band<i style={{ background: "#94a3b8" }} />Sv<i style={{ background: "var(--ink)" }} />mud used</p>
  </div>;
}
