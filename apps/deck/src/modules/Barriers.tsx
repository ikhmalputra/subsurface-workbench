import { useMemo, useState } from "react";
import { scaleLinear } from "d3-scale";
import { barrierEnvelopes, forgeStringWeights, mdAtTvd, pressureAt, tvdAtMd } from "@ikhmalputra/subsurface-core";
import type { BarrierElement, BarrierEnvelopes, BarrierPhase, WellComponent } from "@ikhmalputra/subsurface-core";
import { useDesign } from "../data/design.ts";
import { annuliOf, bseeLimits } from "../data/integrity-model.ts";
import { useIntegrityStatus } from "../data/integrity-store.ts";
import { actions } from "../deck/store.ts";
import { formatDate, useMoment } from "../data/history.ts";
import { useForgeOpenHole, valueAt } from "../data/openhole.ts";
import { fmt } from "../format.ts";
import { Frame, Inspector, Status } from "./frame/Frame.tsx";
import { useSize } from "./useSize.ts";
import { useWire } from "./wire.ts";

const PRIMARY = "#3b82f6", SECONDARY = "#ef4444";
const SG_PER_PPG = 1 / 8.345;

/** The last BOP test a report states, kept only if it is not later than the report itself. */
function bopTestOn(date: string) {
  const day = [...forgeStringWeights.days].reverse().find((entry) => entry.date <= date);
  if (!day) return null;
  const stated = day.lastBopTest ?? null;
  if (!stated) return { date: null, source: `report of ${day.date}` };
  const [m, d, y] = stated.split("/").map(Number);
  const iso = `20${String(y).padStart(2, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return iso <= day.date ? { date: iso, source: `report of ${day.date}` } : { date: null, source: `report of ${day.date} states ${stated}, after the report itself: not used` };
}

/**
 * Well-barrier envelopes on the construction: the primary and the secondary, each element with
 * what the records say about it, and what they do not. FORGE follows the time cursor — a fluid
 * column while drilling, the production casing once completed; Kestrel A-7 is its design, drilling
 * or producing.
 */
export function Barriers() {
  const wire = useWire("barriers");
  const place = wire.place!;
  const moment = useMoment();
  const { brief } = useDesign();
  const forge = place.siteId === "forge";
  const [kestrelPhase, setKestrelPhase] = useState<BarrierPhase>("producing");
  const { openHole } = useForgeOpenHole(forge);
  const model = useMemo((): { envelopes: BarrierEnvelopes; components: readonly WellComponent[]; depthM: number; caption: string } => {
    // FORGE from its records (as of the time cursor), a well entered on the deck as entered.
    if (forge || place.kind === "recorded") {
      const components = moment ? moment.asOf.components : place.components;
      const production = place.components.filter((component) => component.kind === "Casing").sort((a, b) => b.bottomDepthM - a.bottomDepthM)[0];
      const completed = !moment || (production !== undefined && moment.asOf.completeIds.includes(production.id));
      const depthM = moment ? moment.asOf.drilledM : place.totalDepthM;
      if (completed) return { envelopes: barrierEnvelopes({ components, phase: "completed", provenance: "documented" }), components, depthM, caption: moment ? `${formatDate(moment.date)} · completed` : "as finally recorded · completed" };
      const date = moment!.date;
      const mudPpg = moment!.asOf.report?.mudWeightPpg ?? [...forgeStringWeights.days].reverse().find((day) => day.date <= date && day.mudWeightPpg !== null)?.mudWeightPpg ?? null;
      const ppGradient = openHole ? valueAt(openHole, "PP_G", depthM) : null;
      const fluid = { mudSg: mudPpg === null ? null : mudPpg * SG_PER_PPG, poreSg: ppGradient === null ? null : ppGradient / 0.4335, source: `mud ${mudPpg ?? "not reported"} ppg (report of ${date}); formation ${ppGradient === null ? "pressure not logged at this depth (IsoMechPro from 6,000 ft)" : `${fmt(ppGradient, 3)} psi/ft (IsoMechPro)`}` };
      return { envelopes: barrierEnvelopes({ components, phase: "drilling", provenance: "documented", holeDepthM: depthM, fluid, bopTest: bopTestOn(date) }), components, depthM, caption: `${formatDate(date)} · drilling at ${fmt(depthM)} m MD` };
    }
    // Kestrel A-7: its design, drilling the last hole section or producing.
    const reservoir = brief.geology.formations.filter((formation) => formation.reservoir).map((formation) => formation.topTvdM).sort((a, b) => a - b)[0];
    const reservoirTopMdM = reservoir === undefined ? null : mdAtTvd(brief, reservoir);
    if (kestrelPhase === "drilling") {
      const last = brief.sections.at(-1)!;
      const components = place.components.filter((component) => component.id !== last.id && !["Tubular", "Packer", "Safety valve", "Gas lift mandrel", "Valve"].includes(component.kind) && !(component.kind === "Cement" && (component as WellComponent & { parentId?: string }).parentId === last.id));
      const pore = pressureAt(brief, tvdAtMd(brief, last.shoeMdM)).porePressureSg;
      return { envelopes: barrierEnvelopes({ components, phase: "drilling", provenance: "synthetic", holeDepthM: last.shoeMdM, fluid: { mudSg: last.mudWeightSg, poreSg: pore, source: "design brief" }, bopTest: { date: null, source: "the design brief specifies no BOP" } }), components, depthM: last.shoeMdM, caption: `design · drilling the ${last.label.replace(/ casing$/, "")} hole to ${fmt(last.shoeMdM)} m` };
    }
    return { envelopes: barrierEnvelopes({ components: place.components, phase: "producing", provenance: "synthetic", reservoirTopMdM }), components: place.components, depthM: place.totalDepthM, caption: "design · producing through the completion" };
  }, [forge, moment, place, brief, kestrelPhase, openHole]);
  const { envelopes } = model;
  // The producing design's annuli, and whether Nodal's integrity lens has seen one leak.
  const annuli = useAnnuli(place.siteId);
  const showAnnuli = !forge && kestrelPhase === "producing" && annuli !== null;
  const leaking = showAnnuli && annuli.live?.annuli.some((x) => x.sustained) === true;
  const row = (envelope: "primary" | "secondary") => (element: BarrierElement) => <tr key={`${envelope}${element.id}`} className={element.status === "not reported" ? "is-gap" : undefined}>
    <td><i style={{ background: envelope === "primary" ? PRIMARY : SECONDARY }} />{element.name}</td>
    <td>{element.kind === "wellhead" || element.kind === "valve" || element.kind === "bop" ? "surface" : `${fmt(element.topM)}–${fmt(element.bottomM)} m`}</td>
    <td>{element.status}</td>
    <td>{element.evidence}</td>
  </tr>;
  const table = (envelope: "primary" | "secondary") => <table className="acx-table bar-table">
    <thead><tr><th>Element</th><th>MD</th><th>Status</th><th>Evidence</th></tr></thead>
    <tbody>{envelopes[envelope].map(row(envelope))}</tbody>
  </table>;
  const unreported = (elements: readonly BarrierElement[]) => elements.filter((element) => element.status === "not reported").length;
  return <Frame name="barriers" title={place.label} subtitle={`Well barriers · ${model.caption}`}
    tools={!forge && <span className="log-sets" role="group" aria-label="Phase">
      <button type="button" aria-pressed={kestrelPhase === "drilling"} onClick={() => setKestrelPhase("drilling")}>Drilling</button>
      <button type="button" aria-pressed={kestrelPhase === "producing"} onClick={() => setKestrelPhase("producing")}>Producing</button>
    </span>}
    numbers={<>
      <span><small>Primary</small><b>{envelopes.primary.length}</b></span>
      <span><small>Secondary</small><b>{envelopes.secondary.length}</b></span>
      <span><small>Gaps in records</small><b>{envelopes.gaps.length}</b></span>
    </>}
    canvas={<div className="mf-plot"><Drawing envelopes={envelopes} components={model.components} depthM={model.depthM} cursor={wire.cursor} /></div>}
    inspector={<Inspector id="barriers" initial="primary" head={<>
      {leaking && <div className="bar-alert" role="alert"><p className="mf-prose"><b>A barrier is leaking.</b> An annulus that builds back after a bleed has a path through the cement or casing between envelopes.</p><button type="button" className="tie-button" onClick={() => actions.open("nodal")}>Open the integrity lens</button></div>}
      <dl className="mf-facts">
        <div className="mf-facts-title"><dt>{model.caption}</dt><dd>{forge ? "documented" : "synthetic design"}</dd></div>
        <div><dt><i className="bar-swatch" style={{ background: PRIMARY }} />Primary envelope</dt><dd>{envelopes.primary.length} elements{unreported(envelopes.primary) ? ` · ${unreported(envelopes.primary)} not reported` : ""}</dd></div>
        <div><dt><i className="bar-swatch" style={{ background: SECONDARY }} />Secondary envelope</dt><dd>{envelopes.secondary.length} elements{unreported(envelopes.secondary) ? ` · ${unreported(envelopes.secondary)} not reported` : ""}</dd></div>
        <div><dt>In both envelopes</dt><dd>{envelopes.shared.length ? envelopes.shared.join(", ") : "none"}</dd></div>
      </dl>
    </>} sections={[
      { id: "primary", title: "Primary envelope", summary: `${envelopes.primary.length} elements`, body: table("primary") },
      { id: "secondary", title: "Secondary envelope", summary: `${envelopes.secondary.length} elements`, body: table("secondary") },
      envelopes.shared.length > 0 && { id: "shared", title: "Shared elements", summary: `${envelopes.shared.length}`, body: <p className="mf-prose"><b>In both envelopes:</b> {envelopes.shared.join(", ")} — one failure there would take both.</p> },
      { id: "gaps", title: "Gaps in the records", summary: `${envelopes.gaps.length}`, body: envelopes.gaps.length ? <ul className="bar-gaps">{envelopes.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul> : <p className="mf-prose">None.</p> },
      showAnnuli && { id: "annuli", title: "Annuli", summary: annuli.live ? `${Math.round(annuli.live.hours / 24)} days on production` : "limits only", body: <Annuli annuli={annuli} /> },
      { id: "norsok", title: "About the envelopes", summary: "NORSOK D-010", body: <>
        <p className="mf-prose">Two envelopes, each able to stop flow on its own, after the well-barrier idea of NORSOK D-010 (Standards Norway); its element acceptance tables are copyrighted and not reproduced, so this lists what each element&apos;s records say rather than judging them against those tables.</p>
        <p className="mf-prose">{forge ? "FORGE follows the time cursor: a fluid column while the hole is being drilled, the production casing once it is cemented. Mud weights and BOP test dates are the daily reports'; a stated test date later than its report is not used." : "Kestrel A-7 is a design: every element is planned, none tested."}</p>
      </> },
    ]} />}
    status={<Status items={[forge ? "FORGE follows the time cursor: move it to see the envelopes while drilling" : "Kestrel A-7 is a design: every element planned, none tested", "After NORSOK D-010; its acceptance tables are not reproduced"]} />} />;
}

/** The construction to depth scale, the envelopes traced over it. */
function Drawing({ envelopes, components, depthM, cursor }: { readonly envelopes: BarrierEnvelopes; readonly components: readonly WellComponent[]; readonly depthM: number; readonly cursor: number | null }) {
  const [box, size] = useSize<HTMLDivElement>();
  const width = Math.max(200, size.width), height = Math.max(160, size.height);
  const top = 70, bottom = height - 24, cx = width / 2;
  const deepest = Math.max(depthM, ...components.map((component) => component.bottomDepthM));
  const y = scaleLinear().domain([0, deepest]).range([top, bottom]);
  const ods = components.map((component) => component.outerDiameterMm ?? 0).filter((od) => od > 0);
  const r = scaleLinear().domain([0, Math.max(...ods, 300)]).range([0, Math.min(width * 0.36, 150)]);
  const casings = components.filter((component) => component.kind === "Casing");
  const holes = components.filter((component) => component.kind === "Hole");
  const holeAt = (casing: WellComponent) => holes.find((hole) => Math.abs(hole.bottomDepthM - casing.bottomDepthM) < 2)?.outerDiameterMm ?? (casing.outerDiameterMm ?? 0) * 1.25;
  const tubing = components.find((component) => component.kind === "Tubular");
  const envelopeOf = (id: string | undefined) => !id ? null : envelopes.primary.some((element) => element.componentId === id) ? "primary" : envelopes.secondary.some((element) => element.componentId === id) ? "secondary" : null;
  const colour = (which: "primary" | "secondary" | null) => which === "primary" ? PRIMARY : which === "secondary" ? SECONDARY : "var(--ink-3)";
  const overlay = (elements: readonly BarrierElement[], stroke: string, offset: number) => elements.map((element) => {
    const casing = element.componentId ? components.find((component) => component.id === element.componentId) : undefined;
    const dash = element.status === "not reported" ? "6 4" : undefined;
    if (element.kind === "casing" && casing) { const rr = r(casing.outerDiameterMm ?? 0) + offset; return <g key={element.id} stroke={stroke} strokeWidth={4} strokeDasharray={dash} opacity={0.9}><line x1={cx - rr} x2={cx - rr} y1={y(element.topM)} y2={y(element.bottomM)} /><line x1={cx + rr} x2={cx + rr} y1={y(element.topM)} y2={y(element.bottomM)} /></g>; }
    if (element.kind === "cement") { const owner = casings.find((c) => element.id.startsWith(c.id)); const inner = r(owner?.outerDiameterMm ?? 0), outer = r(owner ? holeAt(owner) : 0); return <g key={element.id} fill={stroke} opacity={element.status === "not reported" ? 0.12 : 0.35} stroke={stroke} strokeDasharray={dash}><rect x={cx - outer} width={outer - inner} y={y(element.topM)} height={Math.max(1, y(element.bottomM) - y(element.topM))} /><rect x={cx + inner} width={outer - inner} y={y(element.topM)} height={Math.max(1, y(element.bottomM) - y(element.topM))} /></g>; }
    if (element.kind === "fluid") { const rr = r(Math.min(...holes.map((h) => h.outerDiameterMm ?? Infinity), 250)) * 0.9; return <rect key={element.id} x={cx - rr} width={rr * 2} y={y(0)} height={y(element.bottomM) - y(0)} fill={stroke} opacity={0.18} stroke={stroke} strokeDasharray={dash} />; }
    if (element.kind === "packer") { const rr = r(casings.at(-1)?.outerDiameterMm ?? 180); return <rect key={element.id} x={cx - rr} width={rr * 2} y={y(element.topM) - 4} height={10} fill={stroke} />; }
    if (element.kind === "tubing" && tubing) { const rr = r(tubing.outerDiameterMm ?? 90); return <g key={element.id} stroke={stroke} strokeWidth={4}><line x1={cx - rr} x2={cx - rr} y1={y(element.topM)} y2={y(element.bottomM)} /><line x1={cx + rr} x2={cx + rr} y1={y(element.topM)} y2={y(element.bottomM)} /></g>; }
    if (element.kind === "safety-valve") { const rr = r(tubing?.outerDiameterMm ?? 90); return <path key={element.id} d={`M${cx - rr},${y(element.topM) - 6} L${cx + rr},${y(element.topM) + 6} M${cx + rr},${y(element.topM) - 6} L${cx - rr},${y(element.topM) + 6}`} stroke={stroke} strokeWidth={4} />; }
    if (element.kind === "formation") { const owner = casings.find((c) => element.id.startsWith(c.id)); const outer = r(owner ? holeAt(owner) : 300); return <ellipse key={element.id} cx={cx} cy={y(element.bottomM)} rx={outer + 12} ry={10} fill="none" stroke={stroke} strokeWidth={2.5} strokeDasharray={dash} />; }
    return null;
  });
  const surface = [...envelopes.primary.map((element) => ({ element, envelope: "primary" as const })), ...envelopes.secondary.map((element) => ({ element, envelope: "secondary" as const }))].filter(({ element }) => element.kind === "wellhead" || element.kind === "valve" || element.kind === "bop");
  const seen = new Set<string>();
  return <div className="acx-plot barrier-drawing">
    <div ref={box} className="plot-area"><svg width={width} height={height} role="img" aria-label="Construction with the primary (blue) and secondary (red) barrier envelopes">
      {[...new Set(casings.map((c) => c.bottomDepthM))].map((md) => <g key={md} className="acx-grid"><text x={6} y={y(md) + 3}>{fmt(md)} m</text></g>)}
      {holes.map((hole) => <g key={hole.id} stroke="var(--ink-3)" strokeOpacity={0.35} strokeDasharray="3 3"><line x1={cx - r(hole.outerDiameterMm ?? 0)} x2={cx - r(hole.outerDiameterMm ?? 0)} y1={y(hole.topDepthM)} y2={y(hole.bottomDepthM)} /><line x1={cx + r(hole.outerDiameterMm ?? 0)} x2={cx + r(hole.outerDiameterMm ?? 0)} y1={y(hole.topDepthM)} y2={y(hole.bottomDepthM)} /></g>)}
      {casings.map((casing) => { const rr = r(casing.outerDiameterMm ?? 0); return <g key={casing.id} stroke={colour(envelopeOf(casing.id))} strokeOpacity={0.3} strokeWidth={1.5}><line x1={cx - rr} x2={cx - rr} y1={y(casing.topDepthM)} y2={y(casing.bottomDepthM)} /><line x1={cx + rr} x2={cx + rr} y1={y(casing.topDepthM)} y2={y(casing.bottomDepthM)} /><path d={`M${cx - rr},${y(casing.bottomDepthM)} l-6,0 l6,-8 Z M${cx + rr},${y(casing.bottomDepthM)} l6,0 l-6,-8 Z`} fill="var(--ink-3)" /></g>; })}
      {overlay(envelopes.secondary, SECONDARY, 3)}
      {overlay(envelopes.primary, PRIMARY, -3)}
      {surface.map(({ element, envelope }, index) => {
        const key = element.id;
        if (seen.has(key)) return null;
        seen.add(key);
        const both = envelopes.primary.some((p) => p.id === key) && envelopes.secondary.some((s) => s.id === key);
        const yy = top - 16 - index * 21;
        // The box fits its words: about 7 px a character at the label's 11 px mono.
        const label = `${element.kind === "bop" ? "BOP" : element.kind === "valve" ? "valve" : "wellhead"}${both ? " · both" : ""}`, w = label.length * 7 + 16;
        return <g key={key}><rect x={cx - w / 2} width={w} y={yy - 12} height={17} rx={4} fill="none" stroke={both ? "var(--ink)" : colour(envelope)} strokeWidth={2} strokeDasharray={element.status === "not reported" ? "4 3" : undefined} /><text className="acx-label" x={cx} y={yy} textAnchor="middle">{label}</text></g>;
      })}
      {cursor !== null && cursor <= deepest && <line className="acx-cursor" x1={20} x2={width - 10} y1={y(cursor)} y2={y(cursor)} />}
      <text className="acx-axis" x={width - 8} y={height - 6} textAnchor="end">MD to scale · widths not</text>
    </svg></div>
    <p className="xp-legend"><i style={{ background: PRIMARY }} />primary<i style={{ background: SECONDARY }} />secondary · dashed: not in the records</p>
  </div>;
}


/**
 * The producing well's annuli beside its envelopes: each one's MAASP and the limit that sets it,
 * BSEE's MAWOP, and, once Nodal's integrity lens has read them, its pressure and whether its record
 * shows sustained casing pressure (a leak in the envelope it sits between).
 */
function useAnnuli(siteId: string) {
  const { brief } = useDesign();
  const status = useIntegrityStatus();
  const annuli = useMemo(() => annuliOf(brief), [brief]);
  if (typeof annuli === "string") return null;
  return { annuli, limits: bseeLimits(annuli, false), live: status?.siteId === siteId ? status : null };
}

function Annuli({ annuli: { annuli, limits, live } }: { readonly annuli: NonNullable<ReturnType<typeof useAnnuli>> }) {
  return <>
    <p className="mf-prose">{live ? `As Nodal's integrity lens reads them, ${Math.round(live.hours / 24)} days on production.` : "Limits only: open Nodal analysis › Integrity for their pressures."}</p>
    <table className="acx-table bar-table">
      <thead><tr><th>Annulus</th><th>MAASP</th><th>MAWOP</th><th>Now</th><th>Record</th></tr></thead>
      <tbody>{annuli.map((a) => {
        const l = limits.find((x) => x.name === a.name), s = live?.annuli.find((x) => x.name === a.name);
        return <tr key={a.name} className={s?.sustained ? "is-gap" : undefined}>
          <td>{a.name}</td>
          <td>{fmt(Math.round(a.maasp.maaspPsi))} psi<small> · {a.maasp.governing}</small></td>
          <td>{l ? `${fmt(Math.round(l.mawopPsi))} psi` : "–"}</td>
          <td>{s ? `${fmt(Math.round(s.psi))} psi${s.measuredPsi !== null ? ` (measured ${fmt(Math.round(s.measuredPsi))})` : ""}` : "–"}</td>
          <td>{s?.sustained === true ? "sustained casing pressure" : s?.sustained === false ? "bleeds off: thermal" : "no diagnostic yet"}</td>
        </tr>;
      })}</tbody>
    </table>
  </>;
}
