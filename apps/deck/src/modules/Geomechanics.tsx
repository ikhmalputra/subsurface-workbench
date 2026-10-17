import { useState } from "react";
import { scaleLinear } from "d3-scale";
import { metresToFeet, stressRegime } from "@ikhmalputra/subsurface-core";
import { useForgeOpenHole } from "../data/openhole.ts";
import { useComputed } from "../compute/run.ts";
import { breaksOut, GRANITE_GRADIENT, ppg, RKB_ABOVE_GROUND_16A_FT, SHMAX_RATIO, STEP_FT, tensileAtPore, type Row, type Source } from "../compute/geomech.ts";
import { fmt } from "../format.ts";
import { Loading } from "./Empty.tsx";
import { Frame, Inspector, Status } from "./frame/Frame.tsx";
import { useSize } from "./useSize.ts";
import { useWire } from "./wire.ts";

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
  // Twelve SHmax azimuths at every 25 ft: worked out in the compute worker, off the main thread.
  const { value: rows, error: modelError } = useComputed(openHole ? `${place.wellId}|${place.survey.length}|${source}` : null, "geomechanicsRows", () => [openHole!.las, place.survey, source]);
  const [box] = useSize<HTMLDivElement>();
  if (!rows) return <Loading>{error ? `The open-hole logs could not be read (${error}).` : modelError ? `The earth model could not be built (${modelError}).` : openHole ? "Building the earth model…" : "Reading 16A's geomechanical logs…"}</Loading>;
  const near = (md: number | null) => md === null ? null : rows.reduce<Row | null>((best, row) => !best || Math.abs(row.mdM - md) < Math.abs(best.mdM - md) ? row : best, null);
  const here = near(wire.cursor) ?? rows[Math.floor(rows.length * 0.6)]!;
  const withMud = rows.filter((row) => row.mud !== null && row.collapse);
  const anyAzimuth = withMud.filter((row) => breaksOut(row, 0)).length;
  const someAzimuth = withMud.filter((row) => breaksOut(row, 1)).length;
  const ovals = rows.filter((row) => row.oval).length;
  const ovalWhereSome = withMud.filter((row) => row.oval && breaksOut(row, 1)).length;
  const fractures = rows.filter(tensileAtPore).length;
  const regime = stressRegime(here.sv, here.sH, here.sh);
  const collapse = !here.collapse ? "fails at every pressure" : here.collapse[1] <= here.pp + 1 ? "stands at pore pressure" : `${fmt(ppg(here.collapse[0], here.tvdFt), 1)}–${fmt(ppg(here.collapse[1], here.tvdFt), 1)} ppg`;
  const breakdown = !here.breakdown ? "not reached below 2 Sv" : `${tensileAtPore(here) ? "at pore pressure" : fmt(ppg(here.breakdown[0], here.tvdFt), 1)}–${fmt(ppg(here.breakdown[1], here.tvdFt), 1)} ppg`;
  return <Frame name="geomech" title="16A(78)-32" subtitle={`1D mechanical earth model · ${fmt(metresToFeet(rows[0]!.mdM))}–${fmt(metresToFeet(rows.at(-1)!.mdM))} ft MD`}
    tools={<span className="log-sets" role="group" aria-label="Horizontal stresses from">
      <button type="button" aria-pressed={source === "5832"} onClick={() => setSource("5832")}>58-32 calibrated <small>GDR 1032</small></button>
      <button type="button" aria-pressed={source === "16a"} onClick={() => setSource("16a")}>16A model <small>IsoMechPro</small></button>
    </span>}
    numbers={<>
      <span><small>Breakouts predicted</small><b>{fmt(anyAzimuth * STEP_FT)}–{fmt(someAzimuth * STEP_FT)} ft</b></span>
      <span><small>Oval hole seen</small><b>{fmt(ovals * STEP_FT)} ft</b></span>
    </>}
    canvas={<div className="mf-plot" ref={box}><WindowPlot rows={rows} cursor={wire.cursor} onHover={wire.hover} onPick={wire.pin} /></div>}
    inspector={<Inspector id="geomech" initial="inputs" head={<dl className="mf-facts">
      <div className="mf-facts-title"><dt>At {fmt(here.mdM)} m MD · {fmt(here.tvdFt)} ft TVD</dt><dd>{regime} faulting</dd></div>
      <div><dt>Pp · Shmin · SHmax · Sv</dt><dd>{[here.pp, here.sh, here.sH, here.sv].map((p) => fmt(ppg(p, here.tvdFt), 1)).join(" · ")} ppg</dd></div>
      <div><dt>Collapse, any SHmax azimuth</dt><dd>{collapse}</dd></div>
      <div><dt>Breakdown, any SHmax azimuth</dt><dd>{breakdown}</dd></div>
      <div><dt>Mud drilled with</dt><dd>{here.mud === null ? "not reported" : `${fmt(here.mud, 1)} ppg`}</dd></div>
    </dl>} sections={[
      { id: "well", title: "Down the whole hole", summary: `${fmt(rows.length * STEP_FT)} ft`, body: <dl className="mf-facts">
        <div><dt>Breakouts predicted</dt><dd>{fmt(anyAzimuth * STEP_FT)}–{fmt(someAzimuth * STEP_FT)} ft</dd></div>
        <div><dt>Oval hole seen</dt><dd>{fmt(ovals * STEP_FT)} ft{ovalWhereSome ? ` (${fmt(ovalWhereSome * STEP_FT)} ft where predicted)` : ""}</dd></div>
        <div><dt>Tensile at the wall at pore pressure</dt><dd>{fmt(fractures * STEP_FT)} ft, for some SHmax azimuth</dd></div>
      </dl> },
      { id: "inputs", title: "Inputs", summary: source === "5832" ? "58-32 stresses" : "16A stresses", body: <p className="mf-prose">
        Pore pressure, vertical stress, UCS, friction angle, tensile strength and Poisson&apos;s ratio: Schlumberger&apos;s IsoMechPro for 16A (GDR 1292), by the 1 ft bins of the open-hole set. Horizontal stresses: {source === "5832"
          ? <>58-32&apos;s profile (GDR 1032; its Biot coefficient calibrated to its injection tests), taken at the same depth below ground, 900 m away in the same granite; below 58-32&apos;s TD its granite gradients carry on ({fmt(GRANITE_GRADIENT.sh, 3)} and {fmt(GRANITE_GRADIENT.sH, 3)} psi/ft below ground).</>
          : <>16A&apos;s own IsoMechPro Shmin (isotropic, not calibrated here); SHmax from it at 58-32&apos;s granite ratio, (SHmax − Pp) = {fmt(SHMAX_RATIO, 2)} × (Shmin − Pp).</>}
      </p> },
      { id: "method", title: "Method", body: <p className="mf-prose">Wall stresses of the inclined hole (Fjær et al.; Peška &amp; Zoback 1995), Mohr–Coulomb for collapse, the tensile strength for breakdown. No record here gives SHmax&apos;s azimuth, so each is computed for every azimuth and drawn as the band it spans.</p> },
      { id: "check", title: "Check against the hole", body: check(here) },
    ]} />}
    status={<Status items={["Hover the window to read any depth · click to pin it", "No record gives SHmax's azimuth: bands span every azimuth"]} />} />;
}

const check = (here: Row) => <p className="mf-prose">Predicted breakouts are where the wall fails above pore pressure and the mud was lighter than that; &ldquo;tens.&rdquo; marks depths where, for some SHmax azimuth, the inclined wall is already in tension at pore pressure (drilling-induced fractures whatever the mud); oval hole is where the two caliper pairs part by a quarter inch more than their usual gap. The two Shmin sources disagree: 16A&apos;s model reads {fmt(here.sh16 / here.tvdFt, 2)} psi/ft here{here.sh5832 !== null ? `, 58-32's calibrated profile ${fmt(here.sh5832 / (here.tvdFt - RKB_ABOVE_GROUND_16A_FT), 2)} psi/ft below ground` : ""}.</p>;

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
