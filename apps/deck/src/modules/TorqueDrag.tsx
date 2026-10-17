import { useMemo } from "react";
import { scaleLinear } from "d3-scale";
import { feetToMetres, forgeStringWeights, metresToFeet } from "@ikhmalputra/subsurface-core";
import type { Movement } from "@ikhmalputra/subsurface-core";
import { useComputed } from "../compute/run.ts";
import type { Curve } from "../compute/torque.ts";
import { Loading } from "./Empty.tsx";
import { shoesOf } from "../data/place.ts";
import { fmt } from "../format.ts";
import { Frame, Inspector, Status } from "./frame/Frame.tsx";
import { useSize } from "./useSize.ts";
import { useWire } from "./wire.ts";

const COLOUR: Readonly<Record<Movement, string>> = { pickup: "#f59e0b", slackoff: "#60a5fa", rotating: "#94a3b8" };
const LABEL: Readonly<Record<Movement, string>> = { pickup: "pick-up", slackoff: "slack-off", rotating: "rotating" };

/**
 * Torque and drag for FORGE 16A(78)-32, calibrated on its own daily reports: a soft-string model
 * (Johancsik et al. 1984) on the observed survey, with the block weight and drill-pipe weight fitted
 * to the rotating weights and the friction factors to the pick-up and slack-off weights. The
 * broomstick shows the model down the hole for the TD string, the reports' weights where they were
 * read.
 */
export function TorqueDrag() {
  const wire = useWire("torquedrag");
  const place = wire.place!;
  const survey = useMemo(() => place.survey.map((station) => ({ mdFt: metresToFeet(station.mdM), inclinationDeg: station.inclinationDeg, azimuthDeg: station.azimuthDeg })), [place.survey]);
  // The 9 5/8 in shoe: the last casing while the 8 3/4 in hole was drilled.
  const shoeFt = useMemo(() => metresToFeet(shoesOf(place).find((shoe) => /9 5\/8/.test(shoe.label))?.mdM ?? feetToMetres(5110)), [place]);
  const reported = forgeStringWeights.days.filter((day) => day.mdFt !== null && (day.puLb !== null || day.soLb !== null || day.rotLb !== null));
  const tdFt = metresToFeet(place.survey.at(-1)!.mdM);
  // The fit and every curve are worked out in the compute worker, off the main thread.
  const { value: model, error } = useComputed(`${place.wellId}|${survey.length}|${shoeFt}|${tdFt}`, "torqueAndDrag", () => [survey, shoeFt, tdFt]);
  if (!model) return <Loading>{error ? `Torque and drag could not be worked out (${error}).` : "Fitting torque and drag to the daily reports…"}</Loading>;
  const { fit, curves } = model;
  const used = new Set(model.usedDates);
  const excluded = reported.filter((day) => !used.has(day.date));
  // The model at the cursor's bit depth, or at TD when no depth is placed.
  const cursorFt = wire.cursor === null ? null : metresToFeet(wire.cursor);
  const atFt = cursorFt !== null && cursorFt >= 0 && cursorFt <= tdFt ? cursorFt : null;
  const near = (curve: Curve) => atFt === null ? curve.at(-1)! : curve.reduce((best, point) => Math.abs(point.md - atFt) < Math.abs(best.md - atFt) ? point : best, curve[0]!);
  const here = near(curves.fitted.pickup);
  return <Frame name="torquedrag" title="16A(78)-32" subtitle={`Soft-string torque and drag · calibrated on ${fit.days} daily reports`}
    numbers={<>
      <span><small>Friction cased · open</small><b>{fmt(fit.frictionCased, 2)} · {fmt(fit.frictionOpen, 2)}</b></span>
      <span><small>Pipe, fitted</small><b>{fmt(fit.pipeLbFt, 1)} lb/ft</b></span>
      <span><small>Misfit PU/SO</small><b>{fmt(fit.rmsPuSoLb / 1000, 1)} klb</b></span>
    </>}
    canvas={<div className="td-split">
      <div className="mf-plot"><Broomstick curves={curves} reported={reported} used={used} tdFt={tdFt} cursorFt={cursorFt} onHover={(ft) => wire.hover(ft === null ? null : feetToMetres(ft))} /></div>
      <div className="mf-plot"><TorquePlot points={model.torque} tdFt={tdFt} reported={reported} /></div>
    </div>}
    inspector={<Inspector id="torquedrag" initial="fit" head={<dl className="mf-facts">
      <div className="mf-facts-title"><dt>{atFt === null ? "At TD" : "At bit depth"} · {fmt(here.md)} ft MD</dt><dd>the model</dd></div>
      <div><dt>Pick-up · slack-off</dt><dd>{fmt(near(curves.fitted.pickup).value / 1000)} · {fmt(near(curves.fitted.slackoff).value / 1000)} klb</dd></div>
      <div><dt>Rotating</dt><dd>{fmt(near(curves.fitted.rotating).value / 1000)} klb</dd></div>
      {model.torque.length > 0 && <div><dt>Off-bottom torque</dt><dd>{fmt(near(model.torque).value / 1000, 1)} k ft-lbf</dd></div>}
    </dl>} sections={[
      { id: "fit", title: "Calibration", summary: `${fit.days} reports used`, body: <dl className="mf-facts">
        <div><dt>Friction, cased · open hole</dt><dd>{fmt(fit.frictionCased, 2)} · {fmt(fit.frictionOpen, 2)}</dd></div>
        <div><dt>Drill pipe (fitted · nominal)</dt><dd>{fmt(fit.pipeLbFt, 1)} · 19.5 lb/ft</dd></div>
        <div><dt>Block and top drive (fitted)</dt><dd>{fmt(fit.blockLb / 1000, 1)} klb</dd></div>
        <div><dt>Misfit (rms)</dt><dd>rotating {fmt(fit.rmsRotLb / 1000, 1)} · PU/SO {fmt(fit.rmsPuSoLb / 1000, 1)} klb</dd></div>
        <div><dt>At TD, the model</dt><dd>PU {fmt(curves.fitted.pickup.at(-1)!.value / 1000)} · SO {fmt(curves.fitted.slackoff.at(-1)!.value / 1000)} · ROT {fmt(curves.fitted.rotating.at(-1)!.value / 1000)} klb</dd></div>
        <div><dt>Reports used · left out</dt><dd>{fit.days} · {excluded.length}</dd></div>
      </dl> },
      { id: "source", title: "Source", summary: "GDR 1283", body: <>
        <p className="mf-prose">16A&apos;s daily drilling reports (GDR 1283): rotating, pick-up and slack-off weights and torque as read at each day&apos;s reported depth, mud weight, and the BHA&apos;s length and weight in air.</p>
        <p className="mf-prose"><b>Not used:</b> the Pason 10 s log in GDR 1283 records the 2022 stimulation re-entry, not the drilling, and no record here describes that string.</p>
      </> },
      { id: "method", title: "Method", summary: "Johancsik et al. 1984", body: <>
        <p className="mf-prose"><b>Model:</b> soft string on the observed survey, buoyed by the day&apos;s mud (steel 65.5 ppg); the BHA as one segment of its reported weight, 5 in drill pipe above.</p>
        <p className="mf-prose"><b>Calibration:</b> rotating removes axial friction, so the rotating weights give the block weight and pipe weight by least squares; then the cased and open-hole friction by grid search on the pick-up and slack-off weights. The fitted pipe weight sits near the nominal 19.5 lb/ft; the cased friction is weakly constrained, since most of the drag builds in the open 65° tangent.</p>
      </> },
      { id: "check", title: "Left out and caveats", summary: `${excluded.length} left out`, body: <>
        <p className="mf-prose"><b>Left out:</b> {excluded.length ? excluded.map((day) => `${day.date} (${day.mudWeightPpg === null ? "no mud weight" : day.bha.weightAirLb === null || day.bha.lengthFt === null ? "no BHA weight" : "BHA weight implausible for its length"})`).join(", ") : "none"}{forgeStringWeights.days.some((day) => day.flags.length) ? "; the two slack-off weights under 30 % of the rotating weight look like a dropped zero and are kept as reported, out of the fit" : ""}.</p>
        <p className="mf-prose"><b>Torque:</b> the reported torque is mostly on-bottom drilling torque, which adds the bit&apos;s; the model gives off-bottom rotating torque, with the pipe OD as the contact radius (tool joints not reported).</p>
      </> },
    ]} />}
    status={<Status items={["Hover the broomstick to read any bit depth", "Reported torque is mostly on-bottom; the model's is off-bottom"]} />} />;
}

type Curves = { fitted: Record<Movement, Curve>; ghosts: { open: number; movement: Movement; points: Curve }[] };

function Broomstick({ curves, reported, used, tdFt, cursorFt, onHover }: { readonly curves: Curves; readonly reported: typeof forgeStringWeights.days; readonly used: ReadonlySet<string>; readonly tdFt: number; readonly cursorFt: number | null; readonly onHover: (ft: number | null) => void }) {
  const [box, size] = useSize<HTMLDivElement>();
  const width = Math.max(200, size.width), height = Math.max(160, size.height);
  const m = { left: 54, right: 14, top: 22, bottom: 32 };
  const x = scaleLinear().domain([100, 500]).range([m.left, width - m.right]).clamp(true);
  const y = scaleLinear().domain([0, tdFt]).range([m.top, height - m.bottom]);
  const path = (points: readonly { md: number; value: number }[]) => points.map((point, i) => `${i ? "L" : "M"}${x(point.value / 1000).toFixed(1)},${y(point.md).toFixed(1)}`).join("");
  const mdAt = (event: { readonly currentTarget: Element; readonly clientY: number }) => { const ft = y.invert(event.clientY - event.currentTarget.getBoundingClientRect().top); return ft >= 0 && ft <= tdFt ? ft : null; };
  return <div className="acx-plot td-plot">
    <div ref={box} className="plot-area"><svg width={width} height={height} role="img" aria-label="Broomstick: modelled pick-up, slack-off and rotating hookload by bit depth, with the reports' weights" onPointerMove={(event) => onHover(mdAt(event))} onPointerLeave={() => onHover(null)}>
      {[100, 200, 300, 400, 500].map((tick) => <g key={tick} className="acx-grid"><line x1={x(tick)} x2={x(tick)} y1={m.top} y2={height - m.bottom} /><text x={x(tick)} y={height - m.bottom + 14} textAnchor="middle">{tick}</text></g>)}
      {y.ticks(6).map((tick) => <g key={tick} className="acx-grid"><line x1={m.left} x2={width - m.right} y1={y(tick)} y2={y(tick)} /><text x={m.left - 6} y={y(tick) + 3} textAnchor="end">{fmt(tick)}</text></g>)}
      {curves.ghosts.map((ghost) => <path key={`${ghost.movement}${ghost.open}`} d={path(ghost.points)} fill="none" stroke={COLOUR[ghost.movement]} strokeWidth={1} strokeDasharray="4 3" opacity={0.5} />)}
      {(["pickup", "slackoff", "rotating"] as const).map((movement) => <path key={movement} d={path(curves.fitted[movement])} fill="none" stroke={COLOUR[movement]} strokeWidth={2.4} />)}
      {reported.flatMap((day) => (["pickup", "slackoff", "rotating"] as const).map((movement) => {
        const value = movement === "pickup" ? day.puLb : movement === "slackoff" ? day.soLb : day.rotLb;
        if (value === null || day.mdFt === null) return null;
        const kept = used.has(day.date) && !(movement === "slackoff" && day.flags.length);
        return <circle key={`${day.date}${movement}`} cx={x(value / 1000)} cy={y(day.mdFt)} r={3.6} fill={kept ? COLOUR[movement] : "none"} stroke={COLOUR[movement]} strokeWidth={1.4}><title>{`${day.date} · ${LABEL[movement]} ${fmt(value / 1000)} klb at ${fmt(day.mdFt)} ft${kept ? "" : " · left out"}`}</title></circle>;
      }))}
      {cursorFt !== null && cursorFt <= tdFt && <line className="acx-cursor" x1={m.left} x2={width - m.right} y1={y(cursorFt)} y2={y(cursorFt)} />}
      <text className="acx-axis" x={(m.left + width - m.right) / 2} y={height - 4} textAnchor="middle">hookload (klb) · solid: fitted friction · dashed: open hole 0.2 and 0.4</text>
      <text className="acx-axis" x={12} y={m.top - 8}>bit MD (ft)</text>
    </svg></div>
    <p className="xp-legend"><i style={{ background: COLOUR.pickup }} />pick-up<i style={{ background: COLOUR.slackoff }} />slack-off<i style={{ background: COLOUR.rotating }} />rotating · dots: the reports · hollow: left out</p>
  </div>;
}

function TorquePlot({ points, tdFt, reported }: { readonly points: Curve; readonly tdFt: number; readonly reported: typeof forgeStringWeights.days }) {
  const [box, size] = useSize<HTMLDivElement>();
  const width = Math.max(200, size.width), height = Math.max(160, size.height);
  const m = { left: 54, right: 14, top: 22, bottom: 32 };
  const measured = reported.filter((day) => day.torqueFtLbf !== null && day.mdFt !== null);
  const x = scaleLinear().domain([0, Math.max(16000, ...measured.map((day) => day.torqueFtLbf!), ...points.map((point) => point.value))]).range([m.left, width - m.right]).nice();
  const y = scaleLinear().domain([0, tdFt]).range([m.top, height - m.bottom]);
  return <div className="acx-plot td-plot">
    <div ref={box} className="plot-area"><svg width={width} height={height} role="img" aria-label="Torque by bit depth: modelled off-bottom rotating torque and the reports' torque">
      {x.ticks(4).map((tick) => <g key={tick} className="acx-grid"><line x1={x(tick)} x2={x(tick)} y1={m.top} y2={height - m.bottom} /><text x={x(tick)} y={height - m.bottom + 14} textAnchor="middle">{fmt(tick / 1000)}</text></g>)}
      {y.ticks(6).map((tick) => <g key={tick} className="acx-grid"><line x1={m.left} x2={width - m.right} y1={y(tick)} y2={y(tick)} /><text x={m.left - 6} y={y(tick) + 3} textAnchor="end">{fmt(tick)}</text></g>)}
      <path d={points.map((point, i) => `${i ? "L" : "M"}${x(point.value).toFixed(1)},${y(point.md).toFixed(1)}`).join("")} fill="none" stroke="#c084fc" strokeWidth={2.4} />
      {measured.map((day) => <circle key={day.date} cx={x(day.torqueFtLbf!)} cy={y(day.mdFt!)} r={3.6} fill="#c084fc" opacity={0.85}><title>{`${day.date} · ${fmt(day.torqueFtLbf!)} ft-lbf at ${fmt(day.mdFt!)} ft`}</title></circle>)}
      <text className="acx-axis" x={(m.left + width - m.right) / 2} y={height - 4} textAnchor="middle">torque (k ft-lbf) · line: off bottom · dots: reported</text>
    </svg></div>
  </div>;
}
