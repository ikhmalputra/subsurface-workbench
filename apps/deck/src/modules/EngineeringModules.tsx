import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { scaleLinear } from "d3-scale";
import { casingTable, findPipe, formatOd, M3_TO_BBL, mdAtTvd, pressureAt, sgToPpg, steelGrades, tvdAtMd } from "@ikhmalputra/subsurface-core";
import type { SectionAnalysis, WellDesignBrief } from "@ikhmalputra/subsurface-core";
import { annularVelocity, bitHydraulics } from "@ikhmalputra/subsurface-core/hydraulics";
import { derived, reported } from "@ikhmalputra/subsurface-core/known";
import type { Known } from "@ikhmalputra/subsurface-core/known";
import { analyse, designHistory, edits, factors, useDesign, useDesignState } from "../data/design.ts";
import { fmt } from "../format.ts";
import { pulse } from "../deck/store.ts";
import type { ModuleId } from "./registry.ts";
import { Frame, Inspector, Status } from "./frame/Frame.tsx";
import { useSize } from "./useSize.ts";
import { useWire } from "./wire.ts";

const BRIEF = "Kestrel A-7 design brief";

/** A what-if sent from a module: the edit, then a pulse from that tile (a few a second while dragging). */
let lastPulse = 0;
function propose(from: ModuleId, edit: () => void) {
  edit();
  const now = performance.now();
  if (now - lastPulse > 260) { lastPulse = now; pulse("whatif", from); }
}

/** Mud weight against the window it must sit in: pore pressure below, fracture above, on one track. */
function MudSlider({ analysis, from, label }: { readonly analysis: SectionAnalysis; readonly from: ModuleId; readonly label: string }) {
  const { minimumSg, maximumSg, mudSg } = analysis.mudWindow;
  const low = Math.max(0.95, Math.floor((minimumSg - 0.2) * 20) / 20), high = Math.ceil((maximumSg + 0.15) * 20) / 20;
  const at = (value: number) => `${(value - low) / (high - low) * 100}%`;
  return <label className="mud" title={`${label}: pore ${minimumSg.toFixed(2)} SG, fracture ${maximumSg.toFixed(2)} SG over the open hole`}>
    <span className="mud-track" style={{ ["--pore" as string]: at(minimumSg), ["--frac" as string]: at(maximumSg) }}>
      <input type="range" min={low} max={high} step={0.01} value={mudSg} aria-label={`${label} mud weight, SG`}
        onChange={(event) => propose(from, () => edits.mudWeight(analysis.sectionId, Number(event.target.value)))} />
    </span>
    <b>{mudSg.toFixed(2)}</b><small>SG</small>
  </label>;
}

/** A safety factor as a bar against its design factor; the scale stops at 3. */
export function FactorBar({ name, value, required, load, rating, unit }: { readonly name: string; readonly value: number; readonly required: number; readonly load: number; readonly rating: number | null; readonly unit: string }) {
  const fails = value < required;
  return <div className={`factor${fails ? " is-failing" : ""}`} title={rating === null ? `${name}: rating not available` : `${name}: ${fmt(load)} ${unit} load on a ${fmt(rating)} ${unit} rating`}>
    <span className="factor-name">{name}</span>
    <span className="factor-bar"><i style={{ width: `${Math.min(value, 3) / 3 * 100}%` }} /><em style={{ left: `${required / 3 * 100}%` }} /></span>
    <span className="factor-value">{value >= 99 ? "—" : value.toFixed(2)}</span>
  </div>;
}

/** Strings that can replace a section's pipe: the same OD in every weight the table has, in every API grade. */
const pipeOptions = (odIn: number) => casingTable.filter((row) => Math.abs(row.odIn - odIn) < 1e-6).flatMap((row) => Object.keys(steelGrades).map((grade) => ({ grade, weight: row.weightLbFt })));

/** The pipe the brief picks, by API 5CT nominal dimensions. */
const pipeLine = (odIn: number, weightLbFt: number) => {
  const pipe = findPipe(odIn, weightLbFt);
  return pipe ? `OD ${fmt(pipe.odIn, 3)} · ID ${fmt(pipe.idIn, 3)} · drift ${fmt(pipe.driftIn, 3)} · wall ${fmt(pipe.wallIn, 3)} in (API 5CT). ` : "";
};

/** Every designed string with its pipe, its mud and its burst, collapse and tension factors, live. */
export function Loads() {
  const wire = useWire("strings");
  const { brief } = useDesign();
  const analysis = analyse(brief);
  const state = useDesignState();
  const at = brief.sections.findIndex((section) => section.id === wire.componentId);
  const chosen = at >= 0 ? { section: brief.sections[at]!, result: analysis.sections[at]! } : null;
  return <Frame name="strings" title={brief.identity.name || "This design"} subtitle="Casing loads · burst, collapse and tension against API TR 5C3"
    numbers={<>
      <span><small>MASP</small><b>{fmt(analysis.masp.maspPsi)} psi</b></span>
      <span><small>Below a factor</small><b>{brief.sections.filter((section) => analysis.failing.includes(section.id)).length} of {brief.sections.length}</b></span>
    </>}
    canvas={<ol className="eng-rows">
      {brief.sections.map((section, index) => {
        const result = analysis.sections[index]!;
        const failing = analysis.failing.includes(section.id);
        const selected = wire.componentId === section.id;
        return <li key={section.id} className={`eng-row${selected ? " is-selected" : ""}${failing ? (state.pending ? " is-whatif-fail" : " is-failing") : ""}`}>
          <button type="button" className="eng-title" onClick={() => wire.select(selected ? null : section.id)}>
            <b>{section.label}</b><small>{formatOd(section.holeSizeIn)} hole · shoe {fmt(section.shoeMdM)} m MD · {fmt(result.shoeTvdM)} m TVD</small>
          </button>
          <select aria-label={`${section.label} pipe`} value={`${section.grade}|${section.weightLbFt}`} onChange={(event) => { const [grade, weight] = event.target.value.split("|"); propose("strings", () => edits.pipe(section.id, grade!, Number(weight))); }}>
            {pipeOptions(section.odIn).map((option) => <option key={`${option.grade}|${option.weight}`} value={`${option.grade}|${option.weight}`}>{option.grade} {option.weight}#</option>)}
          </select>
          {section.role !== "conductor" ? <MudSlider analysis={result} from="strings" label={`${formatOd(section.holeSizeIn)} hole`} /> : <span className="eng-note">drilled with seawater</span>}
          {result.effective ? <div className="factors">
            <FactorBar name="Burst" value={result.safety.burst} required={factors.burst} load={result.loads.burstPsi} rating={result.effective.burstPsi} unit="psi" />
            <FactorBar name="Collapse" value={result.safety.collapse} required={factors.collapse} load={result.loads.collapsePsi} rating={result.effective.collapsePsi} unit="psi" />
            <FactorBar name="Tension" value={result.safety.tension} required={factors.tension} load={result.loads.tensionLbf} rating={result.effective.bodyYieldLbf} unit="lbf" />
          </div> : <span className="eng-note">No rating: {result.issues[0]?.message ?? "pipe not in the table"}</span>}
          {failing && <p className="eng-detail is-why">{result.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message).join(" ")}</p>}
        </li>;
      })}
    </ol>}
    inspector={<Inspector id="strings" initial="factors" head={chosen ? <>
      <dl className="mf-facts">
        <div className="mf-facts-title"><dt>{chosen.section.label}</dt><dd>{chosen.section.grade} {chosen.section.weightLbFt}#</dd></div>
        <div><dt>Shoe</dt><dd>{fmt(chosen.section.shoeMdM)} m MD · {fmt(chosen.result.shoeTvdM)} m TVD</dd></div>
        {chosen.result.effective && <>
          <div><dt>Burst · load / rating</dt><dd>{fmt(chosen.result.loads.burstPsi)} / {fmt(chosen.result.effective.burstPsi)} psi</dd></div>
          <div><dt>Collapse · load / rating</dt><dd>{fmt(chosen.result.loads.collapsePsi)} / {fmt(chosen.result.effective.collapsePsi)} psi</dd></div>
          <div><dt>Tension · load / rating</dt><dd>{fmt(chosen.result.loads.tensionLbf)} / {fmt(chosen.result.effective.bodyYieldLbf)} lbf</dd></div>
        </>}
      </dl>
      <p className="mf-prose">{pipeLine(chosen.section.odIn, chosen.section.weightLbFt)}{chosen.result.loads.burstCase}. {chosen.result.effective ? `Rated at ${fmt(chosen.result.effective.temperatureC)} °C (yield × ${chosen.result.effective.yieldDerating.toFixed(2)}); collapse checked biaxially at ${fmt(chosen.result.effective.collapseAtMdM)} m.` : ""} {chosen.result.issues.map((issue) => issue.message).join(" ")}</p>
    </> : <p className="mf-prose">Click a string to read its loads against its ratings, its pipe and the burst case it is loaded with.</p>} sections={[
      { id: "factors", title: "Design factors", summary: `${factors.burst.toFixed(2)} · ${factors.collapse.toFixed(2)} · ${factors.tension.toFixed(2)}`, body: <dl className="mf-facts">
        <div><dt>Burst</dt><dd>{factors.burst.toFixed(2)}</dd></div>
        <div><dt>Collapse</dt><dd>{factors.collapse.toFixed(2)}</dd></div>
        <div><dt>Tension</dt><dd>{factors.tension.toFixed(2)}</dd></div>
        <div><dt>MASP</dt><dd>{fmt(analysis.masp.maspPsi)} psi</dd></div>
        {analysis.masp.wellheadRatingPsi ? <div><dt>Wellhead</dt><dd>{fmt(analysis.masp.wellheadRatingPsi)} psi</dd></div> : null}
      </dl> },
      { id: "method", title: "Method", body: <p className="mf-prose">Screening loads per API TR 5C3 from the {BRIEF}. Each bar is the safety factor against its design factor (the tick); the scale stops at 3. Synthetic design; not engineering approval.</p> },
    ]} />}
    status={<Status items={["Pick a pipe or drag a mud weight to try it · click a string to read it", "Synthetic design; not engineering approval"]} />} />;
}

/** Pore and fracture gradient with every hole's mud weight between them; drag a mud line to try another. */
export function PressureWindow() {
  const wire = useWire("window");
  const { brief } = useDesign();
  const state = useDesignState();
  const analysis = analyse(brief);
  const committed = analyse(state.committed.brief);
  const [box, size] = useSize<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<string | null>(null);
  const width = Math.max(240, size.width), height = Math.max(240, size.height);
  const tdTvd = tvdAtMd(brief, brief.totalDepthMdM);
  const left = 54, right = width - 12, top = 44, bottom = height - 34;
  const x = scaleLinear().domain([0.9, 2.1]).range([left, right]);
  const y = scaleLinear().domain([0, Math.ceil(tdTvd / 250) * 250]).range([top, bottom]);
  const curve = useMemo(() => {
    const points = Array.from({ length: 121 }, (_, i) => (i / 120) * tdTvd).map((tvd) => ({ tvd, ...pressureAt(brief, tvd) }));
    return { pore: points.map((p, i) => `${i ? "L" : "M"}${x(p.porePressureSg).toFixed(1)},${y(p.tvd).toFixed(1)}`).join(""), frac: points.map((p, i) => `${i ? "L" : "M"}${x(p.fractureGradientSg).toFixed(1)},${y(p.tvd).toFixed(1)}`).join("") };
  }, [brief, width, height]);
  const holes = (source: WellDesignBrief) => source.sections.filter((section) => section.role !== "conductor").map((section) => {
    const outer = source.sections.filter((value) => value.shoeMdM < section.shoeMdM && value.odIn > section.odIn).sort((a, b) => b.shoeMdM - a.shoeMdM)[0];
    return { section, from: tvdAtMd(source, outer?.shoeMdM ?? 0), to: tvdAtMd(source, section.shoeMdM) };
  });
  const sgAt = (clientX: number) => { const point = new DOMPoint(clientX, 0).matrixTransform(svg.current!.getScreenCTM()!.inverse()); return Math.min(2.1, Math.max(0.9, x.invert(point.x))); };
  const tvdAtPointer = (clientY: number) => { const point = new DOMPoint(0, clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse()); return Math.min(tdTvd, Math.max(0, y.invert(point.y))); };
  const cursorTvd = wire.cursor === null ? null : tvdAtMd(brief, wire.cursor);
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (drag.current) { propose("window", () => edits.mudWeight(drag.current!, sgAt(event.clientX))); return; }
    wire.hover(mdAtTvd(brief, tvdAtPointer(event.clientY)));
  };
  // Each hole's mud against the window over its open hole: the margin to the nearer side.
  const windows = brief.sections.map((section, index) => ({ section, result: analysis.sections[index]! })).filter(({ section }) => section.role !== "conductor")
    .map(({ section, result }) => ({ section, window: result.mudWindow, margin: Math.min(result.mudWindow.mudSg - result.mudWindow.minimumSg, result.mudWindow.maximumSg - result.mudWindow.mudSg), failing: analysis.failing.includes(section.id) }));
  const tightest = windows.reduce<(typeof windows)[number] | null>((least, entry) => !least || entry.margin < least.margin ? entry : least, null);
  const here = cursorTvd !== null && cursorTvd <= tdTvd ? { tvd: cursorTvd, ...pressureAt(brief, cursorTvd), hole: holes(brief).find((hole) => cursorTvd >= hole.from && cursorTvd <= hole.to) ?? null,
    formation: brief.geology.formations.filter((formation) => formation.topTvdM <= cursorTvd).sort((a, b) => b.topTvdM - a.topTvdM)[0] ?? null } : null;
  const signed = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`;
  return <Frame name="window" title={brief.identity.name || "This design"} subtitle="Pressure window · pore to fracture, the mud in every hole"
    numbers={<>
      <span><small>Tightest margin</small><b>{tightest ? `${signed(tightest.margin)} SG` : "—"}</b></span>
      {tightest && <em>{formatOd(tightest.section.holeSizeIn)} hole</em>}
      <span><small>TD</small><b>{fmt(tdTvd)} m</b></span>
    </>}
    canvas={<div className="plot-fill window" ref={box}>
      <svg ref={svg} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Pressure window: pore pressure, fracture gradient and planned mud weights against true vertical depth"
        onPointerMove={move} onPointerLeave={() => { if (!drag.current) wire.hover(null); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <text x={left} y={14} className="axis-title">Equivalent density, SG</text>
        {x.ticks(6).map((tick) => <g key={tick}><line x1={x(tick)} x2={x(tick)} y1={top} y2={bottom} className="grid-line" /><text x={x(tick)} y={top - 6} textAnchor="middle" className="axis">{tick.toFixed(1)}</text></g>)}
        {y.ticks(8).map((tick) => <g key={tick}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className="grid-line" /><text x={left - 6} y={y(tick) + 3} textAnchor="end" className="axis">{fmt(tick)}</text></g>)}
        <text transform={`translate(12 ${(top + bottom) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">TVD below RKB, m</text>
        <path d={`${curve.pore}L${x(0.9)},${y(tdTvd)}L${x(0.9)},${y(0)}Z`} className="pore-fill" />
        <path d={`${curve.frac}L${x(2.1)},${y(tdTvd)}L${x(2.1)},${y(0)}Z`} className="frac-fill" />
        <path d={curve.pore} className="pore-line" /><path d={curve.frac} className="frac-line" />
        {state.pending && holes(state.committed.brief).map(({ section, from, to }) => <line key={`was-${section.id}`} x1={x(section.mudWeightSg)} x2={x(section.mudWeightSg)} y1={y(from)} y2={y(to)} className="mud-was" />)}
        {holes(brief).map(({ section, from, to }) => {
          const failing = analysis.failing.includes(section.id);
          return <g key={section.id} className={`mud-step${failing ? (state.pending ? " is-whatif-fail" : " is-failing") : ""}${wire.componentId === section.id ? " is-selected" : ""}`}
            onPointerDown={(event) => { event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId); drag.current = section.id; wire.select(section.id); }}>
            <line x1={x(section.mudWeightSg)} x2={x(section.mudWeightSg)} y1={y(from)} y2={y(to)} className="mud-hit" />
            <line x1={x(section.mudWeightSg)} x2={x(section.mudWeightSg)} y1={y(from)} y2={y(to)} className="mud-line" />
            <line x1={left} x2={x(section.mudWeightSg)} y1={y(to)} y2={y(to)} className="shoe-line" />
            <text x={x(section.mudWeightSg) + 5} y={y(to) - 5} className="mud-label">{formatOd(section.odIn)} · {section.mudWeightSg.toFixed(2)}</text>
          </g>;
        })}
        {/* In a narrow tile the names would sit on the mud-weight labels: the tops' lines stay, the names give way. */}
        {width >= 400 && brief.geology.formations.filter((formation) => formation.topTvdM < tdTvd).map((formation) => <text key={formation.name} x={right - 4} y={y(formation.topTvdM) + 11} textAnchor="end" className={`formation${formation.reservoir ? " is-reservoir" : ""}`}>{formation.name}</text>)}
        {cursorTvd !== null && cursorTvd <= tdTvd && <g className="cursor"><line x1={left} x2={right} y1={y(cursorTvd)} y2={y(cursorTvd)} /><text x={left + 4} y={y(cursorTvd) - 4}>{fmt(cursorTvd)} m TVD · pore {pressureAt(brief, cursorTvd).porePressureSg.toFixed(2)} · frac {pressureAt(brief, cursorTvd).fractureGradientSg.toFixed(2)}</text></g>}
      </svg>
      <p className="window-legend"><i className="is-pore" />Pore pressure<i className="is-frac" />Fracture gradient<i className="is-mud" />Mud weight (drag){committed !== analysis && state.pending ? <><i className="is-was" />Committed</> : null}</p>
    </div>}
    inspector={<Inspector id="window" initial="holes" head={here ? <dl className="mf-facts">
      <div className="mf-facts-title"><dt>At {fmt(here.tvd)} m TVD</dt><dd>{here.formation?.name ?? ""}</dd></div>
      <div><dt>Measured depth</dt><dd>{fmt(wire.cursor!)} m MD</dd></div>
      <div><dt>Pore pressure</dt><dd>{here.porePressureSg.toFixed(2)} SG · {sgToPpg(here.porePressureSg).toFixed(1)} ppg</dd></div>
      <div><dt>Fracture gradient</dt><dd>{here.fractureGradientSg.toFixed(2)} SG · {sgToPpg(here.fractureGradientSg).toFixed(1)} ppg</dd></div>
      <div><dt>Mud in this hole</dt><dd>{here.hole ? `${here.hole.section.mudWeightSg.toFixed(2)} SG · ${formatOd(here.hole.section.holeSizeIn)} hole` : "none planned"}</dd></div>
    </dl> : <p className="mf-prose">Hover the window to read pore pressure, fracture gradient and the mud at any depth.</p>} sections={[
      { id: "holes", title: "Mud by hole", summary: "mud in pore–fracture · margin, SG", body: <dl className="mf-facts">
        {windows.map(({ section, window, margin, failing }) => <div key={section.id} className={`${failing ? "is-failing" : ""}${wire.componentId === section.id ? " is-selected" : ""}`.trim() || undefined}>
          <dt>{formatOd(section.holeSizeIn)} hole</dt>
          <dd>{window.mudSg.toFixed(2)} in {window.minimumSg.toFixed(2)}–{window.maximumSg.toFixed(2)} · {signed(margin)}</dd>
        </div>)}
      </dl> },
      { id: "method", title: "Method", body: <p className="mf-prose">Pore pressure and fracture gradient from the {BRIEF}&apos;s geology, as equivalent density against true vertical depth below RKB. Each hole&apos;s mud runs from the shoe above to its own shoe; the window it must sit in is the pore pressure and fracture gradient over that open hole, and the margin is to the nearer side. While a what-if is pending, the committed weights are dashed.</p> },
    ]} />}
    status={<Status items={["Drag a mud line to try another weight · hover to read any depth", `Synthetic plan: the ${BRIEF}`]} />} />;
}

/** The influx each shoe can take while the next hole is drilled, against the operator minimum. */
export function KickTolerance() {
  const wire = useWire("kick");
  const { brief } = useDesign();
  const analysis = analyse(brief);
  const state = useDesignState();
  const intensity = brief.basis?.kickIntensitySg ?? 0.06;
  const shoes = analysis.sections.filter((result) => result.kickTolerance).map((result) => {
    const kick = result.kickTolerance!;
    return { result, kick, section: brief.sections.find((entry) => entry.id === result.sectionId)!, next: brief.sections.find((entry) => entry.id === kick.nextSectionId)!, short: kick.volumeM3 < kick.requiredM3 };
  });
  const least = shoes.reduce<(typeof shoes)[number] | null>((low, entry) => !low || entry.kick.volumeM3 < low.kick.volumeM3 ? entry : low, null);
  const chosen = shoes.find((entry) => entry.section.id === wire.componentId) ?? null;
  const shoeName = (label: string) => `${label.replace(/ casing$/, "")} shoe`;
  return <Frame name="kick" title={brief.identity.name || "This design"} subtitle="Kick tolerance · the influx each shoe can take"
    tools={<label className="inline-slider">Kick intensity <input type="range" min={0} max={0.25} step={0.01} value={intensity} aria-label="Kick intensity, SG"
      onChange={(event) => propose("kick", () => edits.kickIntensity(Number(event.target.value)))} /><b>{intensity.toFixed(2)} SG</b><small>({(intensity * 8.345).toFixed(1)} ppg)</small></label>}
    numbers={<>
      <span><small>Least</small><b>{least ? `${fmt(least.kick.volumeBbl)} bbl` : "—"}</b></span>
      {least && <em>{shoeName(least.section.label)}</em>}
      <span><small>Short of minimum</small><b>{shoes.filter((entry) => entry.short).length} of {shoes.length}</b></span>
    </>}
    canvas={<ol className="eng-rows">
      {shoes.map(({ result, kick, section, next, short }) => {
        const ratio = kick.volumeM3 / kick.requiredM3;
        return <li key={result.sectionId} className={`eng-row${wire.componentId === section.id ? " is-selected" : ""}${short ? (state.pending ? " is-whatif-fail" : " is-failing") : ""}`}>
          <button type="button" className="eng-title" onClick={() => wire.select(section.id)}>
            <b>{shoeName(section.label)}</b><small>{fmt(result.shoeTvdM)} m TVD · fracture {kick.fractureSgAtShoe.toFixed(2)} SG · drilling {formatOd(next.holeSizeIn)} to {fmt(kick.nextTdTvdM)} m TVD on {kick.nextMudSg.toFixed(2)} SG</small>
          </button>
          <div className="kick-bar" title={`${fmt(kick.volumeM3, 1)} m³ against a ${fmt(kick.requiredM3, 2)} m³ minimum`}>
            <i style={{ width: `${Math.min(ratio, 4) / 4 * 100}%` }} /><em style={{ left: "25%" }} />
          </div>
          <span className="kick-value"><b>{fmt(kick.volumeM3, 1)} m³</b> · {fmt(kick.volumeBbl)} bbl<small> · min {fmt(kick.requiredM3 * M3_TO_BBL)} bbl · influx up to {fmt(kick.maxInfluxHeightM)} m</small></span>
        </li>;
      })}
    </ol>}
    inspector={<Inspector id="kick" initial="method" head={chosen ? <dl className="mf-facts">
      <div className="mf-facts-title"><dt>{shoeName(chosen.section.label)}</dt><dd>{chosen.short ? "short of minimum" : "meets minimum"}</dd></div>
      <div><dt>Shoe</dt><dd>{fmt(chosen.result.shoeTvdM)} m TVD</dd></div>
      <div><dt>Fracture at the shoe</dt><dd>{chosen.kick.fractureSgAtShoe.toFixed(2)} SG</dd></div>
      <div><dt>Next hole</dt><dd>{formatOd(chosen.next.holeSizeIn)} to {fmt(chosen.kick.nextTdTvdM)} m TVD</dd></div>
      <div><dt>Next hole&apos;s mud</dt><dd>{chosen.kick.nextMudSg.toFixed(2)} SG</dd></div>
      <div><dt>Tolerance</dt><dd>{fmt(chosen.kick.volumeM3, 1)} m³ · {fmt(chosen.kick.volumeBbl)} bbl</dd></div>
      <div><dt>Minimum</dt><dd>{fmt(chosen.kick.requiredM3, 2)} m³ · {fmt(chosen.kick.requiredM3 * M3_TO_BBL)} bbl</dd></div>
      <div><dt>Influx height, up to</dt><dd>{fmt(chosen.kick.maxInfluxHeightM)} m</dd></div>
    </dl> : <p className="mf-prose">Click a shoe to read its tolerance against the minimum, and the hole drilled below it.</p>} sections={[
      { id: "inputs", title: "Inputs", summary: `${intensity.toFixed(2)} SG kick`, body: <p className="mf-prose">Kick intensity {intensity.toFixed(2)} SG ({(intensity * 8.345).toFixed(1)} ppg), from the brief&apos;s basis; 0.06 SG where it sets none. Fracture gradients, shoes, holes and muds from the {BRIEF}.</p> },
      { id: "method", title: "Method", body: <p className="mf-prose">Lesser of the influx at the bit and expanded to the shoe (Boyle). Minimum: 50 bbl over 8½ in hole, 25 bbl at or below. The bar runs to four times the minimum; the tick is the minimum. {BRIEF}.</p> },
    ]} />}
    status={<Status items={["Drag the kick intensity to try another · click a shoe to read it", "Minimum: 50 bbl over 8½ in hole, 25 bbl at or below"]} />} />;
}

/** Slurry volumes per string and the cement column's equivalent density against the fracture gradient at the shoe. */
export function Cement() {
  const wire = useWire("cement");
  const { brief } = useDesign();
  const analysis = analyse(brief);
  const state = useDesignState();
  const jobs = brief.sections.flatMap((section, index) => {
    const result = analysis.sections[index]!;
    if (!section.cement || !result.cement) return [];
    return [{ section, result, cement: result.cement, plan: section.cement, over: result.cement.equivalentSgAtShoe > result.cement.fractureSgAtShoe, issues: result.issues.filter((issue) => issue.stage === "cement") }];
  });
  const chosen = jobs.find((job) => job.section.id === wire.componentId) ?? null;
  return <Frame name="cement" title={brief.identity.name || "This design"} subtitle="Cement · slurry volumes and the column against fracture"
    numbers={<>
      <span><small>Slurry</small><b>{fmt(jobs.reduce((sum, job) => sum + job.cement.totalBbl, 0))} bbl</b></span>
      <span><small>Over fracture</small><b>{jobs.filter((job) => job.over).length} of {jobs.length}</b></span>
    </>}
    canvas={<ol className="eng-rows">
      {jobs.map(({ section, cement, plan, over, issues }) => <li key={section.id} className={`eng-row${wire.componentId === section.id ? " is-selected" : ""}${over ? (state.pending ? " is-whatif-fail" : " is-failing") : ""}`}>
        <button type="button" className="eng-title" onClick={() => wire.select(section.id)}>
          <b>{section.label}</b><small>TOC {fmt(plan.topMdM)} m MD · {plan.excessPct}% open-hole excess · tail {fmt(plan.tailLengthM)} m</small>
        </button>
        <div className="cement-sliders">
          <label>Lead <input type="range" min={1.2} max={2.0} step={0.01} value={plan.leadDensitySg} aria-label={`${section.label} lead slurry density, SG`} onChange={(event) => propose("cement", () => edits.cement(section.id, "leadDensitySg", Number(event.target.value)))} /><b>{plan.leadDensitySg.toFixed(2)}</b></label>
          <label>Tail <input type="range" min={1.5} max={2.2} step={0.01} value={plan.tailDensitySg} aria-label={`${section.label} tail slurry density, SG`} onChange={(event) => propose("cement", () => edits.cement(section.id, "tailDensitySg", Number(event.target.value)))} /><b>{plan.tailDensitySg.toFixed(2)}</b></label>
        </div>
        <div className="cement-numbers">
          <span>Lead <b>{fmt(cement.leadM3, 1)} m³</b></span><span>Tail <b>{fmt(cement.tailM3, 1)} m³</b></span><span>Total <b>{fmt(cement.totalBbl)} bbl</b></span>
          <span className={over ? "is-over" : ""}>Column at shoe <b>{cement.equivalentSgAtShoe.toFixed(2)}</b> vs fracture <b>{cement.fractureSgAtShoe.toFixed(2)} SG</b></span>
        </div>
        {issues.length > 0 && <p className="eng-detail">{issues.map((issue) => issue.message).join(" ")}</p>}
      </li>)}
    </ol>}
    inspector={<Inspector id="cement" initial="method" head={chosen ? <dl className="mf-facts">
      <div className="mf-facts-title"><dt>{chosen.section.label}</dt><dd>{fmt(chosen.cement.totalBbl)} bbl</dd></div>
      <div><dt>Top of cement</dt><dd>{fmt(chosen.plan.topMdM)} m MD</dd></div>
      <div><dt>Open-hole excess</dt><dd>{chosen.plan.excessPct}%</dd></div>
      <div><dt>Lead</dt><dd>{chosen.plan.leadDensitySg.toFixed(2)} SG · {fmt(chosen.cement.leadM3, 1)} m³</dd></div>
      <div><dt>Tail</dt><dd>{chosen.plan.tailDensitySg.toFixed(2)} SG · {fmt(chosen.cement.tailM3, 1)} m³ · {fmt(chosen.plan.tailLengthM)} m</dd></div>
      <div><dt>Column at the shoe</dt><dd>{chosen.cement.equivalentSgAtShoe.toFixed(2)} vs {chosen.cement.fractureSgAtShoe.toFixed(2)} SG fracture</dd></div>
    </dl> : <p className="mf-prose">Click a string to read its cement job: top, excess, lead and tail, and the column at the shoe.</p>} sections={[
      { id: "method", title: "Method", body: <p className="mf-prose">Volumes from the planned hole and casing sizes with the brief&apos;s excess; equivalent density of mud, lead and tail at the shoe, against the fracture gradient there. {BRIEF}.</p> },
    ]} />}
    status={<Status items={["Drag a lead or tail density to try it · click a string to read it", `Synthetic plan: the ${BRIEF}`]} />} />;
}

const knownText = (value: Known<number>, digits = 0, unit = "") => value.state === "absent" ? `not computed (${value.why})` : `${fmt(value.value, digits)}${unit}`;
const knownShort = (value: Known<number>, digits = 0) => value.state === "absent" ? "—" : fmt(value.value, digits);

/** Bit and annular hydraulics for one hole section, from the design's mud and the flow and nozzles you set. */
export function Hydraulics() {
  useWire("hydraulics");
  const { brief, hydraulics } = useDesign();
  const holes = brief.sections.filter((section) => section.role !== "conductor");
  const section = holes.find((entry) => entry.id === hydraulics.sectionId) ?? holes.at(-1)!;
  const outer = brief.sections.filter((value) => value.shoeMdM < section.shoeMdM && value.odIn > section.odIn).sort((a, b) => b.shoeMdM - a.shoeMdM)[0];
  const outerId = outer ? casingTable.find((row) => Math.abs(row.odIn - outer.odIn) < 1e-6 && row.weightLbFt === outer.weightLbFt)?.idIn ?? null : null;
  const userSource = { document: "Entered on the deck" };
  const mudPpg = sgToPpg(section.mudWeightSg);
  const bit = bitHydraulics({ flowGpm: reported(hydraulics.flowGpm, userSource), mudPpg: derived(mudPpg, `${section.mudWeightSg.toFixed(2)} SG × 8.345`), nozzles32nds: reported(hydraulics.nozzles32nds, userSource) });
  const openHole = annularVelocity({ flowGpm: reported(hydraulics.flowGpm, userSource), holeIn: reported(section.holeSizeIn, { document: BRIEF }), pipeIn: reported(hydraulics.pipeOdIn, userSource) });
  const cased = outerId === null ? null : annularVelocity({ flowGpm: reported(hydraulics.flowGpm, userSource), holeIn: derived(outerId, `API 5CT ID of ${outer!.label}`), pipeIn: reported(hydraulics.pipeOdIn, userSource) });
  const hsi = bit.hydraulicHorsepower.state !== "absent" ? bit.hydraulicHorsepower.value / (Math.PI / 4 * section.holeSizeIn ** 2) : null;
  const setNozzles = (next: readonly number[]) => propose("hydraulics", () => edits.hydraulics({ nozzles32nds: next }, `Nozzles ${hydraulics.nozzles32nds.join("-")} → ${next.join("-")} /32 in`));
  return <Frame name="hydraulics" title={brief.identity.name || "This design"} subtitle="Hydraulics · at the bit and in the annulus"
    tools={<span className="hyd-inputs"><label>Section <select value={section.id} onChange={(event) => propose("hydraulics", () => edits.hydraulics({ sectionId: event.target.value }, `Hydraulics for the ${holes.find((entry) => entry.id === event.target.value)?.label}`))}>
      {holes.map((entry) => <option key={entry.id} value={entry.id}>{formatOd(entry.holeSizeIn)} hole · {entry.mudWeightSg.toFixed(2)} SG</option>)}
    </select></label></span>}
    numbers={<>
      <span><small>Bit Δp</small><b>{knownShort(bit.pressureDropPsi)} psi</b></span>
      <span><small>HSI</small><b>{hsi !== null ? fmt(hsi, 2) : "—"}</b></span>
      <span><small>Jet</small><b>{knownShort(bit.nozzleVelocityFtPerSec)} ft/s</b></span>
    </>}
    canvas={<div className="hyd-board">
      <section aria-label="At the bit"><h4>At the bit</h4><dl>
        <div><dt>Total flow area</dt><dd>{knownText(bit.totalFlowAreaIn2, 3, " in²")}</dd></div>
        <div><dt>Jet velocity</dt><dd>{knownText(bit.nozzleVelocityFtPerSec, 0, " ft/s")}</dd></div>
        <div><dt>Bit pressure drop</dt><dd>{knownText(bit.pressureDropPsi, 0, " psi")}</dd></div>
        <div><dt>Hydraulic power at the bit</dt><dd>{knownText(bit.hydraulicHorsepower, 0, " hp")}{hsi !== null ? ` · ${fmt(hsi, 2)} hp/in²` : ""}</dd></div>
        <div><dt>Jet impact force</dt><dd>{knownText(bit.impactForceLbf, 0, " lbf")}</dd></div>
      </dl></section>
      <section aria-label="In the annulus"><h4>In the annulus</h4><dl>
        <div><dt>Annular velocity, open hole</dt><dd>{knownText(openHole, 0, " ft/min")}</dd></div>
        <div><dt>Annular velocity, in {outer ? outer.label.replace(/ casing$/, "") : "casing"}</dt><dd>{cased ? knownText(cased, 0, " ft/min") : "not reported"}</dd></div>
        <div className="is-absent"><dt>Annular pressure loss · ECD</dt><dd>not computed: needs the mud&apos;s rheology (PV, YP)</dd></div>
      </dl></section>
    </div>}
    inspector={<Inspector id="hydraulics" initial="inputs" head={<dl className="mf-facts">
      <div className="mf-facts-title"><dt>{formatOd(section.holeSizeIn)} hole</dt><dd>{section.label}</dd></div>
      <div><dt>Mud</dt><dd>{section.mudWeightSg.toFixed(2)} SG · {fmt(mudPpg, 1)} ppg</dd></div>
      <div><dt>Shoe</dt><dd>{fmt(section.shoeMdM)} m MD</dd></div>
      <div><dt>Cased above</dt><dd>{outer ? outer.label.replace(/ casing$/, "") : "not reported"}</dd></div>
      {outer && <div><dt>Its ID, API 5CT</dt><dd>{outerId !== null ? `${fmt(outerId, 3)} in` : "not reported"}</dd></div>}
    </dl>} sections={[
      { id: "inputs", title: "Inputs", summary: `${hydraulics.flowGpm} gpm · ${hydraulics.nozzles32nds.length} nozzles`, body: <div className="hyd-inputs hyd-form">
        <label className="inline-slider">Flow <input type="range" min={150} max={1200} step={10} value={hydraulics.flowGpm} aria-label="Flow rate, gallons per minute" onChange={(event) => propose("hydraulics", () => edits.hydraulics({ flowGpm: Number(event.target.value) }, `Flow ${designHistory.getState().committed.hydraulics.flowGpm} → ${event.target.value} gpm`))} /><b>{hydraulics.flowGpm} gpm</b></label>
        <label>Drill pipe <select value={hydraulics.pipeOdIn} onChange={(event) => propose("hydraulics", () => edits.hydraulics({ pipeOdIn: Number(event.target.value) }, `Drill pipe ${hydraulics.pipeOdIn} → ${event.target.value} in`))}>
          {[3.5, 4, 4.5, 5, 5.5, 5.875].map((od) => <option key={od} value={od}>{od} in</option>)}
        </select></label>
        <span className="nozzles" role="group" aria-label="Bit nozzles, 32nds of an inch"><span className="hyd-label">Nozzles, /32 in</span>
          {hydraulics.nozzles32nds.map((size, index) => <span key={index} className="nozzle">
            <button type="button" aria-label={`Nozzle ${index + 1} smaller`} onClick={() => setNozzles(hydraulics.nozzles32nds.map((value, at) => at === index ? Math.max(7, value - 1) : value))}>−</button>
            <b>{size}</b>
            <button type="button" aria-label={`Nozzle ${index + 1} larger`} onClick={() => setNozzles(hydraulics.nozzles32nds.map((value, at) => at === index ? Math.min(28, value + 1) : value))}>+</button>
          </span>)}
          <button type="button" className="nozzle-count" aria-label="Add a nozzle" disabled={hydraulics.nozzles32nds.length >= 9} onClick={() => setNozzles([...hydraulics.nozzles32nds, hydraulics.nozzles32nds.at(-1) ?? 12])}>+1</button>
          <button type="button" className="nozzle-count" aria-label="Remove a nozzle" disabled={hydraulics.nozzles32nds.length <= 1} onClick={() => setNozzles(hydraulics.nozzles32nds.slice(0, -1))}>−1</button>
        </span>
      </div> },
      { id: "method", title: "Method", body: <p className="mf-prose">API RP 13D field-unit correlations. Mud and hole from the {BRIEF}; flow, nozzles and pipe are yours. Annular pressure loss and ECD are not computed: they need the mud&apos;s rheology (PV, YP).</p> },
    ]} />}
    status={<Status items={["Set flow, drill pipe and nozzles under Inputs · the hole in the toolbar", "API RP 13D field-unit correlations"]} />} />;
}
