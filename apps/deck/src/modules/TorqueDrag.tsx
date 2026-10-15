import { useMemo } from "react";
import { scaleLinear } from "d3-scale";
import { calibrate, calibrationDays, dayString, feetToMetres, forgeStringWeights, metresToFeet, torqueDrag } from "@ikhmalputra/subsurface-core";
import type { CalibrationDay, Movement } from "@ikhmalputra/subsurface-core";
import { shoesOf } from "../data/place.ts";
import { fmt } from "../format.ts";
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
  const days = useMemo(() => calibrationDays(), []);
  const fit = useMemo(() => calibrate(survey, shoeFt, days), [survey, shoeFt, days]);
  const reported = forgeStringWeights.days.filter((day) => day.mdFt !== null && (day.puLb !== null || day.soLb !== null || day.rotLb !== null));
  const used = new Set(days.map((day) => day.date));
  const last = days.at(-1)!;
  const tdFt = metresToFeet(place.survey.at(-1)!.mdM);
  const curves = useMemo(() => {
    const at = (bitFt: number, movement: Movement, open: number) => fit.blockLb + torqueDrag({ survey, string: dayString({ ...last, mdFt: bitFt } as CalibrationDay, fit.pipeLbFt), bitMdFt: bitFt, mudWeightPpg: last.mudWeightPpg, frictionCased: fit.frictionCased, frictionOpen: open, shoeMdFt: shoeFt, stepFt: 60 }, movement).hookloadLb;
    const depths: number[] = [];
    for (let md = Math.ceil((last.bhaLengthFt + 100) / 100) * 100; md <= tdFt; md += 150) depths.push(md);
    depths.push(tdFt);
    const line = (movement: Movement, open: number) => depths.map((md) => ({ md, value: at(md, movement, open) }));
    return {
      fitted: { pickup: line("pickup", fit.frictionOpen), slackoff: line("slackoff", fit.frictionOpen), rotating: line("rotating", fit.frictionOpen) },
      ghosts: [0.2, 0.4].flatMap((open) => (["pickup", "slackoff"] as const).map((movement) => ({ open, movement, points: line(movement, open) }))),
    };
  }, [survey, fit, last, shoeFt, tdFt]);
  const [box, size] = useSize<HTMLDivElement>();
  const wide = size.width > 700;
  const excluded = reported.filter((day) => !used.has(day.date));
  return <div className="acx td" ref={box}>
    <header className="acx-head"><span><b>16A(78)-32</b> · soft-string torque and drag · calibrated on {fit.days} daily reports</span></header>
    <dl className="petro-summary geo-summary">
      <div><dt>Friction, cased · open hole</dt><dd>{fmt(fit.frictionCased, 2)} · {fmt(fit.frictionOpen, 2)}</dd></div>
      <div><dt>Drill pipe (fitted · nominal)</dt><dd>{fmt(fit.pipeLbFt, 1)} · 19.5 lb/ft</dd></div>
      <div><dt>Block and top drive (fitted)</dt><dd>{fmt(fit.blockLb / 1000, 1)} klb</dd></div>
      <div><dt>Misfit (rms)</dt><dd>rotating {fmt(fit.rmsRotLb / 1000, 1)} · PU/SO {fmt(fit.rmsPuSoLb / 1000, 1)} klb</dd></div>
      <div><dt>At TD, the model</dt><dd>PU {fmt(curves.fitted.pickup.at(-1)!.value / 1000)} · SO {fmt(curves.fitted.slackoff.at(-1)!.value / 1000)} · ROT {fmt(curves.fitted.rotating.at(-1)!.value / 1000)} klb</dd></div>
      <div><dt>Reports used · left out</dt><dd>{fit.days} · {excluded.length}</dd></div>
    </dl>
    <div className={`acx-plots${wide ? " is-wide" : ""}`}>
      <Broomstick curves={curves} reported={reported} used={used} tdFt={tdFt} cursorFt={wire.cursor === null ? null : metresToFeet(wire.cursor)} onHover={(ft) => wire.hover(ft === null ? null : feetToMetres(ft))} />
      <TorquePlot survey={survey} fit={fit} last={last} shoeFt={shoeFt} tdFt={tdFt} reported={reported} />
    </div>
    <p className="petro-note">
      <b>Source:</b> 16A&apos;s daily drilling reports (GDR 1283): rotating, pick-up and slack-off weights and torque as read at each day&apos;s reported depth, mud weight, and the BHA&apos;s length and weight in air. <b>Model:</b> soft string on the observed survey, buoyed by the day&apos;s mud (steel 65.5 ppg); the BHA as one segment of its reported weight, 5 in drill pipe above. <b>Calibration:</b> rotating removes axial friction, so the rotating weights give the block weight and pipe weight by least squares; then the cased and open-hole friction by grid search on the pick-up and slack-off weights. The fitted pipe weight sits near the nominal 19.5 lb/ft; the cased friction is weakly constrained, since most of the drag builds in the open 65° tangent.
      {" "}<b>Left out:</b> {excluded.length ? excluded.map((day) => `${day.date} (${day.mudWeightPpg === null ? "no mud weight" : day.bha.weightAirLb === null || day.bha.lengthFt === null ? "no BHA weight" : "BHA weight implausible for its length"})`).join(", ") : "none"}{forgeStringWeights.days.some((day) => day.flags.length) ? "; the two slack-off weights under 30 % of the rotating weight look like a dropped zero and are kept as reported, out of the fit" : ""}. The reported torque is mostly on-bottom drilling torque, which adds the bit&apos;s; the model gives off-bottom rotating torque, with the pipe OD as the contact radius (tool joints not reported).
      {" "}<b>Not used:</b> the Pason 10 s log in GDR 1283 records the 2022 stimulation re-entry, not the drilling, and no record here describes that string.
    </p>
  </div>;
}

type Curves = { fitted: Record<Movement, { md: number; value: number }[]>; ghosts: { open: number; movement: Movement; points: { md: number; value: number }[] }[] };

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

function TorquePlot({ survey, fit, last, shoeFt, tdFt, reported }: { readonly survey: readonly { mdFt: number; inclinationDeg: number; azimuthDeg: number }[]; readonly fit: ReturnType<typeof calibrate>; readonly last: CalibrationDay; readonly shoeFt: number; readonly tdFt: number; readonly reported: typeof forgeStringWeights.days }) {
  const [box, size] = useSize<HTMLDivElement>();
  const width = Math.max(200, size.width), height = Math.max(160, size.height);
  const m = { left: 54, right: 14, top: 22, bottom: 32 };
  const points = useMemo(() => {
    const out: { md: number; value: number }[] = [];
    for (let md = Math.ceil((last.bhaLengthFt + 100) / 100) * 100; md <= tdFt; md += 200) out.push({ md, value: torqueDrag({ survey, string: dayString({ ...last, mdFt: md } as CalibrationDay, fit.pipeLbFt), bitMdFt: md, mudWeightPpg: last.mudWeightPpg, frictionCased: fit.frictionCased, frictionOpen: fit.frictionOpen, shoeMdFt: shoeFt, stepFt: 60 }, "rotating").torqueFtLbf });
    return out;
  }, [survey, fit, last, shoeFt, tdFt]);
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
