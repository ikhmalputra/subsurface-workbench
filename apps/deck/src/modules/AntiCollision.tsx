import { useMemo, useState } from "react";
import { scaleLinear, scaleLog } from "d3-scale";
import { closestApproach, forge16aPlaced, forge16aWellheads, forgeNeighbours, forgeSurveyUncertainty, ISCWSA_RULE, separations } from "@ikhmalputra/subsurface-core";
import type { PlacedWell, Separation } from "@ikhmalputra/subsurface-core";
import { fmt } from "../format.ts";
import { Frame, Inspector, Status } from "./frame/Frame.tsx";
import { useSize } from "./useSize.ts";
import { useWire } from "./wire.ts";

/** The 3D site's colours, so a well is the same colour in every view. */
const COLOURS: Readonly<Record<string, string>> = { forge: "#1f6fb2", "16b": "#c2410c", "58-32": "#0f766e" };
const STEP_M = 10;
type Measure = "sf" | "distance";
/** The usual reading of the ISCWSA rule: below 1 the ellipsoids overlap; 1 to 1.5 calls for care. */
const band = (sf: number) => sf < 1 ? "is-stop" : sf < 1.5 ? "is-care" : "is-clear";
const sfText = (sf: number | null) => sf === null ? "not computed" : sf >= 100 ? "> 100" : fmt(sf, 2);

/**
 * Anti-collision on FORGE: 16A(78)-32 against its neighbours from the three published surveys.
 * Positions stand on licensed as-built wellheads; each survey run carries the OWSG generic error
 * model for the tool it reports, so the ISCWSA separation factor is computed alongside the
 * centre-to-centre distance. The ladder plots either down 16A; the travelling cylinder shows where
 * the neighbour lies around 16A, looking down the hole.
 */
export function AntiCollision() {
  const wire = useWire("anticollision");
  const place = wire.place!;
  const [measure, setMeasure] = useState<Measure>("sf");
  const reference = useMemo(() => forge16aPlaced(place.stations), [place.stations]);
  const runs = useMemo(() => forgeNeighbours.map((well) => {
    const samples = separations(reference, well, STEP_M);
    const least = samples.reduce<Separation | null>((best, sample) => sample.separationFactor !== null && (!best || sample.separationFactor < best.separationFactor!) ? sample : best, null);
    return { well, samples, closest: closestApproach(samples), least };
  }), [reference]);
  const at = (samples: readonly Separation[], md: number | null) => md === null || !samples.length ? null : samples[Math.max(0, Math.min(samples.length - 1, Math.round((md - samples[0]!.referenceMdM) / STEP_M)))]!;
  const models = (well: PlacedWell) => well.errorModel ?? "none";
  const offBy = (head: { readonly eastingM: number; readonly northingM: number }) => fmt(Math.hypot(head.eastingM - forge16aWellheads.asBuilt.eastingM, head.northingM - forge16aWellheads.asBuilt.northingM), 1);
  const short = (well: PlacedWell) => well.label.split(/[ (]/)[0];
  return <Frame name="anticollision" title="16A(78)-32" subtitle={`Anti-collision against ${runs.length} neighbours · ISCWSA separation rule, k ${ISCWSA_RULE.k}`}
    tools={<span className="log-sets" role="group" aria-label="Ladder plots">
      <button type="button" aria-pressed={measure === "sf"} aria-label="Separation factor" onClick={() => setMeasure("sf")}><span className="ac-full">Separation factor</span><span className="ac-brief">SF</span></button>
      <button type="button" aria-pressed={measure === "distance"} aria-label="Centre to centre" onClick={() => setMeasure("distance")}><span className="ac-full">Centre to centre</span><span className="ac-brief">Distance</span></button>
    </span>}
    numbers={<>{runs.map(({ well, least }) => <span key={well.id}><small>{short(well)} least SF</small><b className={least ? `acx-sf ${band(least.separationFactor!)}` : undefined}>{least ? sfText(least.separationFactor) : "–"}</b></span>)}</>}
    canvas={<div className="ac-split">
      <div className="mf-plot"><Ladder runs={runs} measure={measure} totalMd={place.stations.at(-1)?.mdM ?? 0} cursor={wire.cursor} onHover={wire.hover} onPick={wire.pin} /></div>
      <div className="mf-plot"><Cylinder runs={runs} cursor={wire.cursor} at={at} /></div>
    </div>}
    inspector={<Inspector id="anticollision" initial="neighbours" head={<dl className="mf-facts">
      <div className="mf-facts-title"><dt>{wire.cursor === null ? "No depth placed" : `At 16A ${fmt(wire.cursor)} m MD`}</dt><dd>{wire.cursor === null ? "hover the ladder" : "distance · SF"}</dd></div>
      {runs.map(({ well, samples }) => { const sample = at(samples, wire.cursor); return <div key={well.id}><dt><i className="ac-swatch" style={{ background: COLOURS[well.id] }} />{well.label}</dt><dd>{wire.cursor === null ? "–" : sample ? <>{fmt(sample.centreToCentreM, 1)} m · SF <span className={sample.separationFactor === null ? undefined : `acx-sf ${band(sample.separationFactor)}`}>{sfText(sample.separationFactor)}</span></> : "beyond 16A's survey"}</dd></div>; })}
    </dl>} sections={[
      { id: "neighbours", title: "Neighbours", summary: `${runs.length} wells`, body: <>{runs.map(({ well, closest, least }) => <dl key={well.id} className="mf-facts">
        <div className="mf-facts-title"><dt><i className="ac-swatch" style={{ background: COLOURS[well.id] }} />{well.label}</dt><dd /></div>
        <div><dt>Least SF · at 16A MD</dt><dd>{least ? <><b className={`acx-sf ${band(least.separationFactor!)}`}>{sfText(least.separationFactor)}</b> · {fmt(least.referenceMdM)} m</> : "not computed"}</dd></div>
        <div><dt>Closest · 16A MD → its MD</dt><dd>{closest ? `${fmt(closest.centreToCentreM, 1)} m · ${fmt(closest.referenceMdM)} → ${fmt(closest.offsetMdM)} m` : "—"}</dd></div>
        <div><dt>Around 16A</dt><dd>{closest ? `${fmt(closest.bearingDeg)}° from ${closest.bearingFrom}` : "—"}</dd></div>
      </dl>)}</> },
      { id: "wellheads", title: "Wellheads", summary: "as-built, 2023", body: <p className="mf-prose">Licensed as-built surveys for 16A and 16B (Woolsey Land Surveying, 2023). 16A&apos;s agrees with its own survey workbook to 0.07 m and with the UGS GPS survey to {offBy(forge16aWellheads.gps)} m; the planned position the seismic section was cut through is {offBy(forge16aWellheads.plan)} m off. 58-32: {forgeNeighbours.find((well) => well.id === "58-32")?.datumNote.split(". Wellhead")[0]}.</p> },
      { id: "uncertainty", title: "Uncertainty", summary: "OWSG generic models", body: <p className="mf-prose">No survey publishes its tool&apos;s error model, but each names its tools, so each run carries the ISCWSA OWSG generic model for that tool type (welleng {forgeSurveyUncertainty.source.welleng}), tied on run to run — 16A: {models(reference)}; {forgeNeighbours.map((well) => `${well.label}: ${models(well)}`).join("; ")}. Gyro runs use the generic gyro multishot (CB_Film_GMS), which claims less accuracy than the gyros used. Field {fmt(forgeSurveyUncertainty.source.field.b_total, 1)} nT, dip {forgeSurveyUncertainty.source.field.dip}°, declination {forgeSurveyUncertainty.source.field.declination}° (16A&apos;s workbook).</p> },
      { id: "rule", title: "Rule", summary: `k ${ISCWSA_RULE.k}`, body: <p className="mf-prose">SF = (D − Rr − Ro − {ISCWSA_RULE.surfaceMarginM} m) / ({ISCWSA_RULE.k} · √(σ² along the centre line + {ISCWSA_RULE.sigmaPaM}²)), checked against welleng&apos;s own result to within 3%. Hole radii are each well&apos;s reported hole sizes, section by section: 16A&apos;s from its records, 16B&apos;s and 58-32&apos;s from their end-of-well reports (GDR 1516, 1006) — a 0.1–0.5 m term against distances of 30 m and more. Below 1 the ellipsoids overlap; 1 to 1.5 calls for care.</p> },
    ]} />}
    status={<Status items={["Hover the ladder to place 16A's depth · click to pin it", "Error models are the OWSG generic ones for each tool type"]} />} />;
}

interface Run { readonly well: PlacedWell; readonly samples: readonly Separation[]; readonly closest: Separation | null; readonly least: Separation | null }

/** SF or distance against 16A's measured depth, depth down the page like every depth view; log scale. */
function Ladder({ runs, measure, totalMd, cursor, onHover, onPick }: { readonly runs: readonly Run[]; readonly measure: Measure; readonly totalMd: number; readonly cursor: number | null; readonly onHover: (md: number | null) => void; readonly onPick: (md: number | null) => void }) {
  const [box, size] = useSize<HTMLDivElement>();
  const width = Math.max(200, size.width), height = Math.max(160, size.height);
  const m = { left: 50, right: 14, top: 22, bottom: 30 };
  const sf = measure === "sf";
  const x = scaleLog().domain(sf ? [0.3, 100] : [5, 2000]).range([m.left, width - m.right]).clamp(true);
  const y = scaleLinear().domain([0, totalMd]).range([m.top, height - m.bottom]);
  const value = (sample: Separation) => sf ? sample.separationFactor : sample.centreToCentreM;
  const mdAt = (event: { readonly currentTarget: Element; readonly clientY: number }) => { const rect = event.currentTarget.getBoundingClientRect(); const md = y.invert(event.clientY - rect.top); return md >= 0 && md <= totalMd ? md : null; };
  return <div className="acx-plot">
    <div ref={box} className="plot-area"><svg width={width} height={height} role="img" aria-label={`Ladder plot: ${sf ? "ISCWSA separation factor" : "centre-to-centre distance"} from 16A(78)-32 to each neighbour, by 16A measured depth`}
      onPointerMove={(event) => onHover(mdAt(event))} onPointerLeave={() => onHover(null)} onClick={(event) => onPick(mdAt(event))}>
      {sf && <g className="acx-bands"><rect className="is-stop" x={x(0.3)} width={x(1) - x(0.3)} y={m.top} height={height - m.top - m.bottom} /><rect className="is-care" x={x(1)} width={x(1.5) - x(1)} y={m.top} height={height - m.top - m.bottom} /></g>}
      {(sf ? [0.5, 1, 1.5, 3, 10, 30, 100] : [10, 30, 100, 300, 1000]).map((tick) => <g key={tick} className="acx-grid"><line x1={x(tick)} x2={x(tick)} y1={m.top} y2={height - m.bottom} /><text x={x(tick)} y={height - m.bottom + 14} textAnchor="middle">{fmt(tick, tick < 1 || tick === 1.5 ? 1 : 0)}</text></g>)}
      {y.ticks(6).map((tick) => <g key={tick} className="acx-grid"><line x1={m.left} x2={width - m.right} y1={y(tick)} y2={y(tick)} /><text x={m.left - 6} y={y(tick) + 3} textAnchor="end">{fmt(tick)}</text></g>)}
      <text className="acx-axis" x={(m.left + width - m.right) / 2} y={height - 4} textAnchor="middle">{sf ? "separation factor (log) · below 1 the ellipsoids overlap" : "centre to centre (m, log)"}</text>
      <text className="acx-axis" x={12} y={m.top - 8}>16A MD (m)</text>
      {runs.map(({ well, samples, closest, least }) => {
        const mark = sf ? least : closest;
        const shown = samples.filter((sample) => value(sample) !== null);
        return <g key={well.id}>
          <path d={shown.map((sample, index) => `${index ? "L" : "M"}${x(value(sample)!).toFixed(1)},${y(sample.referenceMdM).toFixed(1)}`).join("")} fill="none" stroke={COLOURS[well.id]} strokeWidth={2} />
          {mark && value(mark) !== null && <g><circle cx={x(value(mark)!)} cy={y(mark.referenceMdM)} r={4.5} fill={COLOURS[well.id]} /><text className="acx-label" x={x(value(mark)!) + 8} y={y(mark.referenceMdM) + 4}>{well.label.split(" ")[0]} {sf ? `SF ${sfText(value(mark))}` : `${fmt(value(mark)!, 1)} m`}</text></g>}
        </g>;
      })}
      {cursor !== null && cursor <= totalMd && <line className="acx-cursor" x1={m.left} x2={width - m.right} y1={y(cursor)} y2={y(cursor)} />}
    </svg></div>
  </div>;
}

/** Looking down 16A: where each neighbour lies around it, by distance and angle from the high side (north where 16A is near vertical). */
function Cylinder({ runs, cursor, at }: { readonly runs: readonly Run[]; readonly cursor: number | null; readonly at: (samples: readonly Separation[], md: number | null) => Separation | null }) {
  const [box, size] = useSize<HTMLDivElement>();
  const side = Math.max(160, Math.min(size.width, size.height));
  const R = side / 2 - 26, cx = side / 2, cy = side / 2;
  const reach = 150;
  const r = scaleLinear().domain([0, reach]).range([0, R]).clamp(true);
  const point = (sample: Separation) => { const a = sample.bearingDeg * Math.PI / 180, d = r(sample.centreToCentreM); return [cx + d * Math.sin(a), cy - d * Math.cos(a)] as const; };
  const beyond = runs.filter((run) => run.closest && run.closest.centreToCentreM > reach);
  return <div className="acx-plot">
    <div ref={box} className="plot-area"><svg width={side} height={side} role="img" aria-label={`Travelling cylinder around 16A(78)-32 out to ${reach} m`}>
      {[30, 60, 90, 120, 150].map((ring) => <g key={ring} className="acx-grid"><circle cx={cx} cy={cy} r={r(ring)} fill="none" /><text x={cx + 3} y={cy - r(ring) + 11}>{ring} m</text></g>)}
      {[0, 90, 180, 270].map((angle) => <text key={angle} className="acx-axis" x={cx + (R + 14) * Math.sin(angle * Math.PI / 180)} y={cy - (R + 14) * Math.cos(angle * Math.PI / 180) + 4} textAnchor="middle">{angle === 0 ? "HS / N" : `${angle}°`}</text>)}
      {runs.map(({ well, samples }) => {
        const inside = samples.filter((sample) => sample.centreToCentreM <= reach);
        const now = at(samples, cursor);
        return <g key={well.id}>
          <path d={inside.map((sample, index) => { const [px, py] = point(sample); return `${index ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`; }).join("")} fill="none" stroke={COLOURS[well.id]} strokeWidth={1.5} opacity={0.75} />
          {now && now.centreToCentreM <= reach && (() => { const [px, py] = point(now); return <circle cx={px} cy={py} r={6} fill={COLOURS[well.id]} stroke="var(--ink)" strokeWidth={1.5} />; })()}
        </g>;
      })}
      <circle cx={cx} cy={cy} r={4} fill={COLOURS.forge} />
    </svg></div>
    <p className="acx-caption">{cursor === null ? "Hover the ladder or any depth view to place 16A's depth." : `At 16A ${fmt(cursor)} m MD.`}{beyond.length ? ` ${beyond.map((run) => run.well.label.split(" ")[0]).join(", ")} never comes within ${reach} m.` : ""}</p>
  </div>;
}
