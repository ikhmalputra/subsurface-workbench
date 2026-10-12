"use client";

import { useMemo, useState } from "react";
import { positionAtMeasuredDepth } from "@ikhmalputra/subsurface-core";
import { kickToleranceVolume, minimumKickToleranceM3 } from "@ikhmalputra/subsurface-core/well-design";
import type { WellComponent } from "@ikhmalputra/subsurface-core";
import { useWorkspace } from "./workspace-provider";

/**
 * Drilling tools that compute from the host's records and the engineer's own inputs.
 *
 * Each one says where every number came from: a host record (the shoe depth, the bit size, the
 * daily reports) or a typed input (a fracture gradient, a flow rate). None of them invents a
 * value the host did not supply — a missing record is shown as missing and the result waits.
 */
const M3_PER_BBL = 0.158987;
const MM_PER_IN = 25.4;
const fmt = (value: number, digits = 1) => value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const num = (value: string) => { const n = Number(value); return value.trim() && Number.isFinite(n) ? n : null; };
/** TVD at an MD, with the MD held inside the well: a host section base can sit a decimetre past the design TD. */
function tvdAt(design: Parameters<typeof positionAtMeasuredDepth>[0], mdM: number): number {
  return positionAtMeasuredDepth(design, Math.min(Math.max(0, mdM), design.totalDepthM)).tvdM;
}

function Field({ label, value, onChange, unit, placeholder, step = "any" }: { label: string; value: string; onChange: (value: string) => void; unit: string; placeholder?: string; step?: string }) {
  return <label className="demo-tool-field"><span>{label}</span><span className="demo-tool-input"><input type="number" inputMode="decimal" step={step} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /><small>{unit}</small></span></label>;
}

/** The host's hole sections, from the operations record, or nothing. */
function useHoleSections() {
  const { well } = useWorkspace();
  return well.operations?.sections ?? [];
}

/* ------------------------------------------------------------------ kick tolerance */
export function KickToleranceTool() {
  const { well } = useWorkspace();
  const sections = useHoleSections();
  const shoes = useMemo(() => well.components.filter((component) => component.kind === "Casing").sort((a, b) => a.bottomDepthM - b.bottomDepthM), [well.components]);
  // Default to the deepest shoe that has a hole section below it in the host's record — the one a
  // kick tolerance is asked of — and otherwise the deepest with real open hole beneath.
  const [shoeId, setShoeId] = useState(() => {
    const withSection = shoes.filter((shoe) => sections.some((section) => section.topM >= shoe.bottomDepthM - 5)).at(-1);
    return withSection?.id ?? shoes.filter((shoe) => shoe.bottomDepthM < well.design.totalDepthM - 100).at(-1)?.id ?? shoes.at(-1)?.id ?? "";
  });
  const [fracture, setFracture] = useState("");
  const [mud, setMud] = useState("");
  const [intensity, setIntensity] = useState("0.06");
  const [holeInput, setHoleInput] = useState("");
  const shoe = shoes.find((item) => item.id === shoeId) ?? null;
  const shoeTvdM = shoe ? tvdAt(well.design, shoe.bottomDepthM) : null;
  const next = shoe ? sections.find((section) => section.topM >= shoe.bottomDepthM - 5) ?? null : null;
  const holeIn = next?.bitSizeIn ?? num(holeInput);
  const nextTdTvdM = tvdAt(well.design, next ? next.baseM : well.design.totalDepthM);
  const fg = num(fracture), mw = num(mud), ki = num(intensity);
  const result = shoeTvdM !== null && holeIn && fg && mw && ki !== null && fg > mw ? kickToleranceVolume({ shoeTvdM, fractureSg: fg, nextMudSg: mw, kickIntensitySg: ki, nextTdTvdM, holeSizeIn: holeIn }) : null;
  const minimum = holeIn ? minimumKickToleranceM3(holeIn) : null;
  return <section className="demo-tool" aria-label="Kick tolerance" data-testid="tool-kick">
    <p className="demo-tool-lede">IADC two-condition kick tolerance below a casing shoe: the largest gas influx the open hole can take and still be circulated out without breaking down the shoe. Shoe depth, hole size and next section TD are the host&apos;s records; the fracture gradient and the mud weight are yours — the host has not supplied pressures for this well.</p>
    <div className="demo-tool-grid">
      <label className="demo-tool-field"><span>Casing shoe</span><select value={shoeId} onChange={(event) => setShoeId(event.target.value)}>{shoes.map((item) => <option key={item.id} value={item.id}>{item.name} · shoe {fmt(item.bottomDepthM, 0)} m MD</option>)}</select></label>
      <Field label="Fracture gradient at the shoe" value={fracture} onChange={setFracture} unit="SG" placeholder="from LOT / FIT" />
      <Field label="Next section mud weight" value={mud} onChange={setMud} unit="SG" placeholder="planned" />
      <Field label="Kick intensity" value={intensity} onChange={setIntensity} unit="SG" step="0.01" />
      {!next && <Field label="Hole size below the shoe" value={holeInput} onChange={setHoleInput} unit="in" placeholder="not in the host's sections" />}
    </div>
    <dl className="demo-tool-results">
      <div><dt>Shoe TVD</dt><dd>{shoeTvdM === null ? "no shoe" : `${fmt(shoeTvdM, 0)} m`}<small>host survey · {shoe?.name}</small></dd></div>
      <div><dt>Hole below</dt><dd>{holeIn ? `${holeIn} in` : "not supplied"}<small>{next ? `host section ${next.name} · ${fmt(next.topM, 0)}–${fmt(next.baseM, 0)} m` : "typed"}</small></dd></div>
      <div><dt>Next TD (TVD)</dt><dd>{fmt(nextTdTvdM, 0)} m<small>{next ? "host section base" : "well TD"}</small></dd></div>
      <div><dt>Max influx height</dt><dd>{result ? `${fmt(result.heightM, 0)} m` : "—"}<small>H = (D·(FG − MW) − KI·Dtd) / (MW − ρgas)</small></dd></div>
      <div data-testid="kick-volume" data-state={result && minimum !== null ? (result.volumeM3 >= minimum ? "meets" : "short") : "pending"}><dt>Kick tolerance</dt><dd>{result ? `${fmt(result.volumeM3, 1)} m³ · ${fmt(result.volumeM3 / M3_PER_BBL, 0)} bbl` : "enter the gradient and mud weight"}<small>{minimum !== null ? `operator minimum ${fmt(minimum, 2)} m³ (${fmt(minimum / M3_PER_BBL, 0)} bbl) for this hole${result ? result.volumeM3 >= minimum ? " · meets it" : " · short of it" : ""}` : ""}</small></dd></div>
    </dl>
    <p className="demo-tool-note">Lesser of the influx around the BHA at the bottom and the influx expanded to the shoe around drill pipe (Boyle&apos;s law), with the core&apos;s nominal collar and pipe sizes for this hole. A screening number, not a well-control plan.</p>
  </section>;
}

/* ------------------------------------------------------------------ cement volumes */
interface CementLeg { readonly label: string; readonly topM: number; readonly baseM: number; readonly outerMm: number | null; readonly innerMm: number; readonly source: string }
export function CementVolumesTool() {
  const { well } = useWorkspace();
  const sections = useHoleSections();
  const casings = useMemo(() => well.components.filter((component) => component.kind === "Casing").sort((a, b) => a.bottomDepthM - b.bottomDepthM), [well.components]);
  const [casingId, setCasingId] = useState(() => casings.at(-1)?.id ?? "");
  const [toc, setToc] = useState("");
  const [excess, setExcess] = useState("0");
  const casing = casings.find((item) => item.id === casingId) ?? null;
  const cementRecord = casing ? well.components.find((component) => component.kind === "Cement" && component.parentId === casing.id) ?? null : null;
  const tocM = num(toc) ?? cementRecord?.topDepthM ?? null;
  const previous = casing ? casings.filter((item) => item.bottomDepthM < casing.bottomDepthM).at(-1) ?? null : null;
  const section = casing ? sections.find((item) => item.casingComponentId === casing.id) ?? null : null;
  const legs: CementLeg[] = [];
  // The annulus is outside the string: its OD against the hole or the previous string's ID. The
  // string's own ID is not needed, and FORGE does not report it.
  if (casing && tocM !== null && casing.outerDiameterMm !== null && tocM < casing.bottomDepthM) {
    const shoe = casing.bottomDepthM;
    const cased = previous ? Math.min(previous.bottomDepthM, shoe) : tocM;
    if (previous && tocM < cased) legs.push({ label: `inside ${previous.name}`, topM: tocM, baseM: cased, outerMm: previous.innerDiameterMm, innerMm: casing.outerDiameterMm, source: previous.innerDiameterMm === null ? "previous casing ID not reported" : "previous casing ID · host record" });
    const openTop = Math.max(tocM, cased);
    if (openTop < shoe) legs.push({ label: "open hole", topM: openTop, baseM: shoe, outerMm: section ? section.bitSizeIn * MM_PER_IN : null, innerMm: casing.outerDiameterMm, source: section ? `bit ${section.bitSizeIn} in · host section` : "hole size not in the host's sections" });
  }
  const volume = (leg: CementLeg) => leg.outerMm === null || leg.outerMm <= leg.innerMm ? null : Math.PI / 4 * ((leg.outerMm / 1000) ** 2 - (leg.innerMm / 1000) ** 2) * (leg.baseM - leg.topM);
  const excessPct = num(excess) ?? 0;
  // The total is the sum of the legs that can be computed; a leg without a reported diameter is
  // named as left out rather than silently dropped or guessed.
  const computed = legs.map((leg) => ({ leg, v: volume(leg) }));
  const total = computed.some((entry) => entry.v !== null) ? computed.reduce((sum, { leg, v }) => sum + (v === null ? 0 : v * (leg.label === "open hole" ? 1 + excessPct / 100 : 1)), 0) : null;
  const leftOut = computed.filter((entry) => entry.v === null).map((entry) => entry.leg.label);
  return <section className="demo-tool" aria-label="Cement volumes" data-testid="tool-cement">
    <p className="demo-tool-lede">Annular cement volume for a string from its shoe up to the top of cement, split where it leaves open hole for the previous casing. Diameters and depths are the host&apos;s records; the top of cement and any open-hole excess are yours when the host has not reported them.</p>
    <div className="demo-tool-grid">
      <label className="demo-tool-field"><span>Casing string</span><select value={casingId} onChange={(event) => { setCasingId(event.target.value); setToc(""); }}>{casings.map((item) => <option key={item.id} value={item.id}>{item.name} · OD {item.outerDiameterMm === null ? "—" : fmt(item.outerDiameterMm / MM_PER_IN, 3)} in · shoe {fmt(item.bottomDepthM, 0)} m</option>)}</select></label>
      <Field label="Top of cement" value={toc} onChange={setToc} unit="m MD" placeholder={cementRecord ? `${fmt(cementRecord.topDepthM, 0)} · host record` : "not reported"} />
      <Field label="Open-hole excess" value={excess} onChange={setExcess} unit="%" step="5" />
    </div>
    <table className="demo-tool-table"><thead><tr><th>Leg</th><th>Interval</th><th>Annulus</th><th>Volume</th><th>Source</th></tr></thead><tbody>
      {legs.map((leg) => { const v = volume(leg); return <tr key={leg.label}><td>{leg.label}</td><td>{fmt(leg.topM, 0)}–{fmt(leg.baseM, 0)} m</td><td>{leg.outerMm === null ? "—" : `${fmt(leg.outerMm / MM_PER_IN, 2)} × ${fmt(leg.innerMm / MM_PER_IN, 3)} in`}</td><td>{v === null ? "not computable" : `${fmt(v, 2)} m³ · ${fmt(v / M3_PER_BBL, 0)} bbl`}</td><td>{leg.source}</td></tr>; })}
      {!legs.length && <tr><td colSpan={5}>{tocM === null ? "Enter a top of cement; the host has not reported one for this string." : "Nothing to cement: the top of cement is at or below the shoe, or a diameter is not reported."}</td></tr>}
    </tbody></table>
    <dl className="demo-tool-results"><div data-testid="cement-total" data-state={leftOut.length ? "partial" : total === null ? "pending" : "complete"}><dt>Total slurry</dt><dd>{total === null ? "—" : `${fmt(total, 2)} m³ · ${fmt(total / M3_PER_BBL, 0)} bbl`}<small>V = π/4 · (D² − d²) · L{excessPct ? ` · open hole × ${1 + excessPct / 100}` : " · no excess"}{leftOut.length ? ` · ${leftOut.join(", ")} left out: diameter not reported` : ""}</small></dd></div></dl>
    <p className="demo-tool-note">Nominal diameters: no caliper, no washout, no shoe track or rathole. Cased-hole volume uses the previous string&apos;s reported ID.</p>
  </section>;
}

/* ------------------------------------------------------------------ time breakdown */
export function TimeBreakdownTool() {
  const { well } = useWorkspace();
  const operations = well.operations ?? null;
  const byCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const day of operations?.days ?? []) counts.set(day.category, (counts.get(day.category) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [operations]);
  const total = operations?.days.length ?? 0;
  if (!operations) return <section className="demo-tool" aria-label="Time breakdown" data-testid="tool-time"><p className="demo-tool-lede">No daily reports supplied for {well.label}; the breakdown reads the host&apos;s reports and nothing else.</p></section>;
  return <section className="demo-tool" aria-label="Time breakdown" data-testid="tool-time">
    <p className="demo-tool-lede">Days by activity category from the host&apos;s {total} daily reports, and each hole section&apos;s span, runs and trouble. One report is one day; categories are as reported. Non-productive time needs the host&apos;s NPT coding, which these reports do not carry — trouble is counted from run outcomes instead.</p>
    <table className="demo-tool-table" aria-label="Days by activity"><thead><tr><th>Activity</th><th>Days</th><th>Share</th></tr></thead><tbody>
      {byCategory.map(([category, days]) => <tr key={category}><td>{category}</td><td>{days}</td><td><span className="demo-tool-bar" style={{ width: `${(days / total) * 100}%` }} aria-hidden="true" />{fmt((days / total) * 100, 0)}%</td></tr>)}
    </tbody></table>
    <table className="demo-tool-table" aria-label="Hole sections"><thead><tr><th>Section</th><th>Bit</th><th>Interval</th><th>Days</th><th>Runs</th><th>Trouble runs</th><th>Avg ROP</th></tr></thead><tbody>
      {operations.sections.map((section) => { const days = section.firstDate && section.lastDate ? Math.round((Date.parse(section.lastDate) - Date.parse(section.firstDate)) / 86_400_000) + 1 : null; return <tr key={section.id}><td>{section.name}</td><td>{section.bitSizeIn} in</td><td>{fmt(section.topM, 0)}–{fmt(section.baseM, 0)} m</td><td>{days ?? "—"}</td><td>{section.runCount}</td><td>{section.problemRuns}</td><td>{section.avgRopFph === null ? "—" : `${fmt(section.avgRopFph, 1)} ft/h`}</td></tr>; })}
    </tbody></table>
    <p className="demo-tool-note">{operations.attribution} · {operations.license}</p>
  </section>;
}

/* ------------------------------------------------------------------ hydraulics */
export function HydraulicsTool() {
  const { well } = useWorkspace();
  const sections = useHoleSections();
  const [flow, setFlow] = useState("");
  const [mudPpg, setMudPpg] = useState("");
  const [nozzles, setNozzles] = useState("");
  const [pipeOd, setPipeOd] = useState("5");
  const q = num(flow), mw = num(mudPpg), dp = num(pipeOd);
  const jets = nozzles.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  const tfa = jets.reduce((sum, n) => sum + Math.PI / 4 * (n / 32) ** 2, 0);
  const bit = q && mw && tfa > 0 ? { velocityFps: 0.32086 * q / tfa, dropPsi: (mw * q * q) / (10858 * tfa * tfa) } : null;
  const hhp = bit && q ? bit.dropPsi * q / 1714 : null;
  const impact = bit && q && mw ? 0.000516 * mw * q * bit.velocityFps : null;
  return <section className="demo-tool" aria-label="Hydraulics" data-testid="tool-hydraulics">
    <p className="demo-tool-lede">Annular velocity around drill pipe in each of the host&apos;s hole sections, and bit hydraulics from the nozzles. Flow rate, mud weight, nozzles and pipe size are yours — the host&apos;s reports do not carry them. Annular pressure loss and ECD are not computed: they need the mud&apos;s rheology.</p>
    <div className="demo-tool-grid">
      <Field label="Flow rate" value={flow} onChange={setFlow} unit="gpm" />
      <Field label="Mud weight" value={mudPpg} onChange={setMudPpg} unit="ppg" />
      <label className="demo-tool-field"><span>Nozzles</span><span className="demo-tool-input"><input value={nozzles} placeholder="e.g. 12, 12, 13" onChange={(event) => setNozzles(event.target.value)} /><small>/32 in</small></span></label>
      <Field label="Drill pipe OD" value={pipeOd} onChange={setPipeOd} unit="in" step="0.5" />
    </div>
    <table className="demo-tool-table" aria-label="Annular velocity by section"><thead><tr><th>Section</th><th>Hole</th><th>Annular velocity</th></tr></thead><tbody>
      {sections.map((section) => { const av = q && dp && section.bitSizeIn > dp ? 24.51 * q / (section.bitSizeIn ** 2 - dp ** 2) : null; return <tr key={section.id}><td>{section.name}</td><td>{section.bitSizeIn} in · host</td><td>{av === null ? "—" : `${fmt(av, 0)} ft/min`}</td></tr>; })}
      {!sections.length && <tr><td colSpan={3}>No hole sections supplied for {well.label}.</td></tr>}
    </tbody></table>
    <dl className="demo-tool-results">
      <div><dt>Total flow area</dt><dd>{tfa > 0 ? `${fmt(tfa, 3)} in²` : "—"}<small>{jets.length} nozzle{jets.length === 1 ? "" : "s"}</small></dd></div>
      <div><dt>Nozzle velocity</dt><dd>{bit ? `${fmt(bit.velocityFps, 0)} ft/s` : "—"}<small>0.32086 · Q / TFA</small></dd></div>
      <div data-testid="bit-drop"><dt>Bit pressure drop</dt><dd>{bit ? `${fmt(bit.dropPsi, 0)} psi` : "—"}<small>MW · Q² / (10858 · TFA²)</small></dd></div>
      <div><dt>Hydraulic horsepower</dt><dd>{hhp === null ? "—" : `${fmt(hhp, 0)} hhp`}<small>ΔP · Q / 1714</small></dd></div>
      <div><dt>Impact force</dt><dd>{impact === null ? "—" : `${fmt(impact, 0)} lbf`}<small>0.000516 · MW · Q · Vn</small></dd></div>
    </dl>
    <p className="demo-tool-note">Field-unit correlations (API RP 13D). Annular velocity assumes the pipe is drill pipe over the whole section; collars are shorter and faster.</p>
  </section>;
}

export type { WellComponent };
