"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { scaleLinear } from "d3-scale";
import { AlertTriangle, CheckCircle2, Plus, Trash2, XCircle } from "lucide-react";
import { InfoTip } from "./info-tip.js";
import {
  analyzeSection,
  casingTable,
  defaultDesignBasis,
  defaultDesignFactors,
  designCoverage,
  designReadiness,
  designStages,
  formatOd,
  maximumSurfacePressure,
  mudlineDepthM,
  pressureAt,
  sgToPpg,
  sourServiceConditions,
  standardHoleSize,
  steelGrades,
  temperatureAt,
  tubingTable,
  tvdAtMd,
  validateDesign,
} from "@ikhmalputra/subsurface-core/well-design";
import type { ArtificialLift, CasingSection, CompletionPlan, DesignFactors, DesignIssue, DesignStage, Formation, InputSource, IntegrityTest, PressurePoint, ReservoirFluid, SectionRole, WellDesignBrief } from "@ikhmalputra/subsurface-core/well-design";
import { CommandButton } from "./ui.js";

/**
 * Data-first well design building blocks. Each one takes the whole `WellDesignBrief`, edits
 * only its own part through `onChange`, and works on its own. All engineering numbers come
 * from `@ikhmalputra/subsurface-core/well-design`; these components only display and edit them.
 */

export interface BriefEditorProps {
  readonly brief: WellDesignBrief;
  readonly onChange: (brief: WellDesignBrief) => void;
}

const fixed = (value: number, digits: number) => Number(value.toFixed(digits));
const metres = (value: number) => `${Math.round(value).toLocaleString("en-US")} m`;
const psi = (value: number) => `${Math.round(value).toLocaleString("en-US")} psi`;

function NumberInput({ value, onCommit, label, digits = 2, min, max, step = "any", disabled }: { readonly value: number | null; readonly onCommit: (value: number | null) => void; readonly label: string; readonly digits?: number; readonly min?: number; readonly max?: number; readonly step?: string; readonly disabled?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    if (draft.trim() === "") { if (value !== null) onCommit(null); return; }
    let next = Number(draft);
    if (!Number.isFinite(next)) return;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    if (next !== value) onCommit(next);
  };
  return <input type="number" inputMode="decimal" step={step} aria-label={label} disabled={disabled} value={draft ?? (value === null ? "" : fixed(value, digits))} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { commit(); (event.target as HTMLInputElement).blur(); } if (event.key === "Escape") setDraft(null); }} />;
}

function Field({ label, unit, hint, children, wide }: { readonly label: string; readonly unit?: string; readonly hint?: string; readonly children: ReactNode; readonly wide?: boolean }) {
  return <label className={`sw-wd-field${wide ? " is-wide" : ""}`}><span>{label}{unit && <small>{unit}</small>}{hint && <InfoTip label={`About ${label.toLowerCase()}`}>{hint}</InfoTip>}</span>{children}</label>;
}

function Panel({ title, kicker, info, children, actions, testId }: { readonly title: string; readonly kicker?: string; readonly info?: ReactNode; readonly children: ReactNode; readonly actions?: ReactNode; readonly testId?: string }) {
  return <section className="sw-wd-panel" aria-label={title} data-testid={testId}>
    <header><div>{kicker && <small>{kicker}</small>}<div className="sw-title"><h2>{title}</h2>{info && <InfoTip label={`About ${title.toLowerCase()}`}>{info}</InfoTip>}</div></div>{actions && <div className="sw-wd-actions">{actions}</div>}</header>
    {children}
  </section>;
}

const inputSources: readonly { readonly value: InputSource; readonly label: string }[] = [
  { value: "measured", label: "Measured" },
  { value: "offset", label: "Offset well" },
  { value: "estimated", label: "Estimated" },
  { value: "assumed", label: "Assumed" },
];

/** Where a number came from. Readiness and offset matching treat `assumed` as no data. */
export function SourceSelect({ value, onChange, label }: { readonly value: InputSource | undefined; readonly onChange: (value: InputSource) => void; readonly label: string }) {
  return <select className="sw-wd-source" data-source={value ?? "assumed"} aria-label={label} value={value ?? "assumed"} onChange={(event) => onChange(event.target.value as InputSource)}>{inputSources.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
}

export function IssueList({ issues, empty = "No issues.", onSelectSection }: { readonly issues: readonly DesignIssue[]; readonly empty?: string; readonly onSelectSection?: (id: string) => void }) {
  if (!issues.length) return <p className="sw-wd-ok"><CheckCircle2 size={14} aria-hidden="true" /> {empty}</p>;
  return <ul className="sw-wd-issues">{issues.map((issue, index) => <li key={`${issue.code}-${index}`} data-severity={issue.severity}>
    {issue.severity === "error" ? <XCircle size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
    <span><b>{issue.severity === "error" ? "Error" : issue.severity === "warning" ? "Warning" : "Note"}</b> {issue.sectionId && onSelectSection ? <CommandButton kind="selection" type="button" onClick={() => onSelectSection(issue.sectionId!)}>{issue.message}</CommandButton> : issue.message}</span>
  </li>)}</ul>;
}

/* ------------------------------------------------------------------ identity, location, datum */

const purposes = ["exploration", "appraisal", "development", "injection", "disposal", "geothermal"] as const;

/** Who, what and why: the identity block every permit, report and data store keys on. */
export function WellIdentityForm({ brief, onChange }: BriefEditorProps) {
  const set = (patch: Partial<WellDesignBrief["identity"]>) => onChange({ ...brief, identity: { ...brief.identity, ...patch } });
  const text = (label: string, key: "name" | "field" | "operator" | "country" | "uwi", hint: string) => <Field label={label} hint={hint}><input value={brief.identity[key] ?? ""} onChange={(event) => set({ [key]: event.target.value })} /></Field>;
  return <Panel title="Well identity" kicker="Step 1 · who and why" testId="wd-identity">
    <div className="sw-wd-fields">
      {text("Well name", "name", "Unique name used on permits and reports")}
      {text("Field", "field", "Field or prospect the well drains")}
      {text("Operator", "operator", "Accountable licence holder")}
      {text("Country", "country", "Sets the regulator and units on filings")}
      {text("Unique well identifier", "uwi", "API / UWI number once assigned")}
      <Field label="Purpose" hint="Changes the completion and the data to acquire"><select value={brief.identity.purpose} onChange={(event) => set({ purpose: event.target.value as WellDesignBrief["identity"]["purpose"] })}>{purposes.map((value) => <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>)}</select></Field>
    </div>
  </Panel>;
}

export interface WellLocationFormProps extends BriefEditorProps {
  /** Draw the datum diagram inside the form. Set false to place `DatumDiagram` elsewhere. Default true. */
  readonly showDiagram?: boolean;
}

/** Surface location, environment and the depth reference every depth hangs from. */
export function WellLocationForm({ brief, onChange, showDiagram = true }: WellLocationFormProps) {
  const location = (patch: Partial<WellDesignBrief["location"]>) => onChange({ ...brief, location: { ...brief.location, ...patch } });
  const datum = (patch: Partial<WellDesignBrief["datum"]>) => onChange({ ...brief, datum: { ...brief.datum, ...patch } });
  const offshore = brief.location.environment !== "onshore";
  const mudline = mudlineDepthM(brief);
  return <Panel title="Location and depth reference" kicker="Step 2 · where, and measured from what" testId="wd-location">
    <div className="sw-wd-fields">
      <Field label="Environment" hint="Rig type, conductor and wellhead system"><select value={brief.location.environment} onChange={(event) => location({ environment: event.target.value as WellDesignBrief["location"]["environment"] })}><option value="onshore">Onshore</option><option value="offshore-platform">Offshore · platform</option><option value="offshore-subsea">Offshore · subsea</option></select></Field>
      <Field label="Coordinate reference system" hint="EPSG name of the surface coordinates"><input value={brief.location.crs} onChange={(event) => location({ crs: event.target.value })} /></Field>
      <Field label="Latitude" unit="°"><NumberInput label="Latitude (degrees)" value={brief.location.latitude} digits={5} min={-90} max={90} onCommit={(latitude) => location({ latitude })} /></Field>
      <Field label="Longitude" unit="°"><NumberInput label="Longitude (degrees)" value={brief.location.longitude} digits={5} min={-180} max={180} onCommit={(longitude) => location({ longitude })} /></Field>
      {offshore
        ? <Field label="Water depth" unit="m" hint="MSL to seabed"><NumberInput label="Water depth (m)" value={brief.location.waterDepthM} digits={1} min={0} onCommit={(waterDepthM) => location({ waterDepthM })} /></Field>
        : <Field label="Ground elevation" unit="m AMSL"><NumberInput label="Ground elevation (m above MSL)" value={brief.location.groundElevationM} digits={1} onCommit={(groundElevationM) => location({ groundElevationM })} /></Field>}
      <Field label="Depth reference" hint="Zero for every MD and TVD"><select value={brief.datum.reference} onChange={(event) => datum({ reference: event.target.value as WellDesignBrief["datum"]["reference"] })}><option value="RKB">RKB · rotary kelly bushing</option><option value="DF">DF · drill floor</option><option value="GL">GL · ground level</option><option value="MSL">MSL · mean sea level</option></select></Field>
      <Field label={`${brief.datum.reference} elevation`} unit="m AMSL" hint="Height of the reference above mean sea level"><NumberInput label="Depth reference elevation (m above MSL)" value={brief.datum.elevationAboveMslM} digits={1} onCommit={(elevationAboveMslM) => datum({ elevationAboveMslM })} /></Field>
    </div>
    {showDiagram && <DatumDiagram brief={brief} />}
    <p className="sw-wd-derived">{offshore ? "Seabed" : "Ground level"} is <b>{metres(mudline)}</b> below {brief.datum.reference}. Pressure gradients are quoted as equivalent densities from {brief.datum.reference}.</p>
  </Panel>;
}

/** Elevation sketch of the depth reference, sea level and seabed or ground, to scale. */
export function DatumDiagram({ brief }: { readonly brief: WellDesignBrief }) {
  const offshore = brief.location.environment !== "onshore";
  const reference = brief.datum.elevationAboveMslM ?? 0;
  const water = offshore ? brief.location.waterDepthM ?? 0 : 0;
  const ground = offshore ? -water : brief.location.groundElevationM ?? 0;
  const top = Math.max(reference, ground, 0) + 10;
  const bottom = Math.min(ground, 0) - 30;
  const y = scaleLinear().domain([top, bottom]).range([16, 164]);
  const row = (value: number, label: string, colour: string, dashed?: boolean) => <g><line x1={60} x2={380} y1={y(value)} y2={y(value)} stroke={colour} strokeWidth={1.5} strokeDasharray={dashed ? "5 4" : undefined} /><text x={386} y={y(value) + 4} className="sw-wd-svg-label">{label} · {value.toFixed(1)} m</text></g>;
  return <svg className="sw-wd-datum" viewBox="0 0 520 180" role="img" aria-label={`Datum diagram: ${brief.datum.reference} ${reference} m above MSL, ${offshore ? `water depth ${water} m` : `ground ${ground} m`}`}>
    {offshore && <rect x={60} y={y(0)} width={320} height={y(ground) - y(0)} fill="#d8e9f3" />}
    <rect x={60} y={y(ground)} width={320} height={Math.max(0, 164 - y(ground))} fill="#e8dcc5" />
    <rect x={200} y={y(reference)} width={40} height={Math.max(0, y(ground) - y(reference) + 30)} fill="none" stroke="#20322a" strokeWidth={1.5} />
    {row(reference, brief.datum.reference, "#147a65")}
    {row(0, "MSL", "#2f5fb3", true)}
    {row(ground, offshore ? "Seabed" : "Ground", "#8a5a00")}
    <line x1={150} x2={150} y1={y(reference)} y2={y(ground)} stroke="#20322a" markerEnd="url(#sw-wd-arrow)" markerStart="url(#sw-wd-arrow)" />
    <text x={144} y={(y(reference) + y(ground)) / 2} textAnchor="end" className="sw-wd-svg-label">{(reference - ground).toFixed(1)} m</text>
    <defs><marker id="sw-wd-arrow" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 8 4 0 8z" fill="#20322a" /></marker></defs>
  </svg>;
}

/* ------------------------------------------------------------------ geology and pressures */

/** Fill colour for a lithology name, shared by the formation column and section views. */
export const lithologyColour = (lithology: string) => {
  const value = lithology.toLowerCase();
  if (value.includes("salt")) return "#f1f1ef";
  if (value.includes("sand")) return "#f1dfa4";
  if (value.includes("clay")) return "#dccfb6";
  if (value.includes("lime") || value.includes("carbon") || value.includes("dolo")) return "#cfe0ea";
  if (value.includes("granite") || value.includes("basement")) return "#e3c7c0";
  if (value.includes("shale")) return "#c8cfc4";
  return "#e4e8e2";
};

/** Formation tops, pore pressure / fracture gradient and temperature: the inputs that set mud weights and casing seats. */
export function GeologyPressureEditor({ brief, onChange }: BriefEditorProps) {
  const geology = brief.geology;
  const setGeology = (patch: Partial<WellDesignBrief["geology"]>) => onChange({ ...brief, geology: { ...geology, ...patch } });
  const formations = [...geology.formations].sort((a, b) => a.topTvdM - b.topTvdM);
  const pressures = [...geology.pressures].sort((a, b) => a.tvdM - b.tvdM);
  const setFormation = (index: number, patch: Partial<Formation>) => setGeology({ formations: formations.map((value, at) => (at === index ? { ...value, ...patch } : value)) });
  const setPressure = (index: number, patch: Partial<PressurePoint>) => setGeology({ pressures: pressures.map((value, at) => (at === index ? { ...value, ...patch } : value)) });
  const tests = geology.integrityTests ?? [];
  const setTest = (index: number, patch: Partial<IntegrityTest>) => setGeology({ integrityTests: tests.map((value, at) => (at === index ? { ...value, ...patch } : value)) });
  const hasPressure = pressures.length > 0;
  const fluids = brief.fluids ?? null;
  const setFluids = (patch: Partial<NonNullable<WellDesignBrief["fluids"]>>) => onChange({ ...brief, fluids: { type: "oil", h2sMolPct: null, co2MolPct: null, source: "assumed", ...fluids, ...patch } });
  const sour = sourServiceConditions(brief);
  const deepest = (values: readonly { tvdM?: number; topTvdM?: number }[]) => Math.max(0, ...values.map((value) => value.tvdM ?? value.topTvdM ?? 0));
  return <Panel title="Geology and pressures" kicker="Step 4 · what the bit will meet" testId="wd-geology">
    <h3 className="sw-wd-sub">Formation tops</h3>
    <div className="sw-wd-scroll"><table className="sw-wd-table">
      <thead><tr><th scope="col">Formation</th><th scope="col">Top <small>m TVD</small></th><th scope="col">Lithology</th><th scope="col">Reservoir</th><th scope="col">Hazard</th><th scope="col"><span className="sw-asm-sr">Remove</span></th></tr></thead>
      <tbody>{formations.map((formation, index) => <tr key={`${formation.name}-${index}`}>
        <td><span className="sw-wd-swatch" style={{ background: lithologyColour(formation.lithology) }} aria-hidden="true" /><input aria-label={`Formation ${index + 1} name`} value={formation.name} onChange={(event) => setFormation(index, { name: event.target.value })} /></td>
        <td><NumberInput label={`${formation.name} top (m TVD)`} value={formation.topTvdM} digits={0} min={0} onCommit={(value) => setFormation(index, { topTvdM: value ?? 0 })} /></td>
        <td><input aria-label={`${formation.name} lithology`} value={formation.lithology} onChange={(event) => setFormation(index, { lithology: event.target.value })} /></td>
        <td className="is-center"><input type="checkbox" aria-label={`${formation.name} is a reservoir`} checked={Boolean(formation.reservoir)} onChange={(event) => setFormation(index, { reservoir: event.target.checked })} /></td>
        <td><input aria-label={`${formation.name} drilling hazard`} placeholder="none" value={formation.hazard ?? ""} onChange={(event) => setFormation(index, { hazard: event.target.value || undefined })} /></td>
        <td><CommandButton type="button" className="sw-wd-icon" aria-label={`Remove ${formation.name}`} onClick={() => setGeology({ formations: formations.filter((_, at) => at !== index) })}><Trash2 size={14} /></CommandButton></td>
      </tr>)}</tbody>
    </table></div>
    <CommandButton type="button" className="sw-asm-button" onClick={() => setGeology({ formations: [...formations, { name: `Formation ${formations.length + 1}`, topTvdM: Math.round(deepest(formations) + 200), lithology: "Shale" }] })}><Plus size={14} /> Add formation</CommandButton>
    <h3 className="sw-wd-sub sw-title">Pore pressure and fracture gradient <InfoTip label="About the pressure sources"><p>Equivalent density from {brief.datum.reference}.</p><p><b>Measured</b> = RFT/MDT/LOT on this well or its pilot; <b>offset</b> = from a nearby well; <b>estimated</b> = model or regional trend; <b>assumed</b> = placeholder.</p><p>Readiness only counts a profile as calibrated when some of it is measured, from an offset, or backed by an integrity test.</p></InfoTip></h3>
    <div className="sw-wd-scroll"><table className="sw-wd-table">
      <thead><tr><th scope="col">TVD <small>m</small></th><th scope="col">Pore <small>SG</small></th><th scope="col">Pore from</th><th scope="col">Fracture <small>SG</small></th><th scope="col">Fracture from</th><th scope="col">Window <small>ppg</small></th><th scope="col">Pore <small>psi</small></th><th scope="col"><span className="sw-asm-sr">Remove</span></th></tr></thead>
      <tbody>{pressures.map((point, index) => <tr key={index} title={point.note} data-invalid={point.fractureGradientSg <= point.porePressureSg || undefined}>
        <td><NumberInput label={`Pressure point ${index + 1} TVD (m)`} value={point.tvdM} digits={0} min={0} onCommit={(value) => setPressure(index, { tvdM: value ?? 0 })} /></td>
        <td><NumberInput label={`Pore pressure at ${point.tvdM} m (SG)`} value={point.porePressureSg} min={0.8} max={2.6} onCommit={(value) => setPressure(index, { porePressureSg: value ?? 1.03 })} /></td>
        <td><SourceSelect label={`Pore pressure at ${point.tvdM} m source`} value={point.poreSource} onChange={(poreSource) => setPressure(index, { poreSource })} /></td>
        <td><NumberInput label={`Fracture gradient at ${point.tvdM} m (SG)`} value={point.fractureGradientSg} min={0.8} max={2.8} onCommit={(value) => setPressure(index, { fractureGradientSg: value ?? 1.6 })} /></td>
        <td><SourceSelect label={`Fracture gradient at ${point.tvdM} m source`} value={point.fractureSource} onChange={(fractureSource) => setPressure(index, { fractureSource })} /></td>
        <td className="is-mono">{sgToPpg(point.porePressureSg).toFixed(1)}–{sgToPpg(point.fractureGradientSg).toFixed(1)}</td>
        <td className="is-mono">{psi(point.porePressureSg * 1.42233 * point.tvdM)}</td>
        <td><CommandButton type="button" className="sw-wd-icon" aria-label={`Remove pressure point at ${point.tvdM} m`} onClick={() => setGeology({ pressures: pressures.filter((_, at) => at !== index) })}><Trash2 size={14} /></CommandButton></td>
      </tr>)}</tbody>
    </table></div>
    <CommandButton type="button" className="sw-asm-button" onClick={() => { const last = pressures.at(-1); setGeology({ pressures: [...pressures, { tvdM: Math.round(deepest(pressures) + 300), porePressureSg: last?.porePressureSg ?? 1.03, fractureGradientSg: last?.fractureGradientSg ?? 1.5, poreSource: "assumed", fractureSource: "assumed" }] }); }}><Plus size={14} /> Add pressure point</CommandButton>
    <h3 className="sw-wd-sub sw-title">Integrity tests <InfoTip label="About integrity tests">FIT / LOT / XLOT results calibrate the fracture gradient. A FIT that held is a lower bound; an LOT is the value itself.</InfoTip></h3>
    <div className="sw-wd-scroll" tabIndex={0} role="region" aria-label="Integrity tests"><table className="sw-wd-table">
      <thead><tr><th scope="col">Test</th><th scope="col">TVD <small>m</small></th><th scope="col">EMW <small>SG</small></th><th scope="col">Leak-off</th><th scope="col">Profile <small>frac SG</small></th><th scope="col">Source</th><th scope="col"><span className="sw-asm-sr">Remove</span></th></tr></thead>
      <tbody>{tests.map((test, index) => {
        const frac = pressureAt(brief, test.tvdM).fractureGradientSg;
        const conflict = hasPressure && (frac < test.emwSg - 0.005 || (test.reachedLeakOff && frac > test.emwSg + 0.005));
        return <tr key={index} data-invalid={conflict || undefined}>
          <td><select aria-label={`Integrity test ${index + 1} kind`} value={test.kind} onChange={(event) => setTest(index, { kind: event.target.value as IntegrityTest["kind"] })}><option value="FIT">FIT</option><option value="LOT">LOT</option><option value="XLOT">XLOT</option></select></td>
          <td><NumberInput label={`Integrity test ${index + 1} TVD (m)`} value={test.tvdM} digits={0} min={0} onCommit={(value) => setTest(index, { tvdM: value ?? 0 })} /></td>
          <td><NumberInput label={`Integrity test ${index + 1} EMW (SG)`} value={test.emwSg} min={0.8} max={2.8} onCommit={(value) => setTest(index, { emwSg: value ?? test.emwSg })} /></td>
          <td className="is-center"><input type="checkbox" aria-label={`Integrity test ${index + 1} reached leak-off`} checked={test.reachedLeakOff} onChange={(event) => setTest(index, { reachedLeakOff: event.target.checked })} /></td>
          <td className="is-mono">{hasPressure ? frac.toFixed(2) : "—"}{conflict && <small> {frac < test.emwSg ? "below test" : "above leak-off"}</small>}</td>
          <td><input aria-label={`Integrity test ${index + 1} source`} placeholder="report, date, page" value={test.source} onChange={(event) => setTest(index, { source: event.target.value })} /></td>
          <td><CommandButton type="button" className="sw-wd-icon" aria-label={`Remove integrity test ${index + 1}`} onClick={() => setGeology({ integrityTests: tests.filter((_, at) => at !== index) })}><Trash2 size={14} /></CommandButton></td>
        </tr>;
      })}</tbody>
    </table></div>
    {!tests.length && <p className="sw-wd-empty-note">No integrity tests. A FIT that held is a lower bound on the fracture gradient; an LOT is the value itself.</p>}
    <CommandButton type="button" className="sw-asm-button" onClick={() => setGeology({ integrityTests: [...tests, { kind: "FIT", tvdM: Math.round(brief.sections[0] ? tvdAtMd(brief, brief.sections[0].shoeMdM) + 5 : 500), emwSg: 1.3, reachedLeakOff: false, source: "" }] })}><Plus size={14} /> Add integrity test</CommandButton>
    <div className="sw-wd-fields is-compact">
      <Field label="Surface temperature" unit="°C"><NumberInput label="Surface temperature (°C)" value={geology.surfaceTemperatureC} digits={1} onCommit={(value) => setGeology({ surfaceTemperatureC: value ?? 25 })} /></Field>
      <Field label="Geothermal gradient" unit="°C/km"><NumberInput label="Geothermal gradient (°C per km)" value={geology.geothermalGradientCPerKm} digits={1} min={0} onCommit={(value) => setGeology({ geothermalGradientCPerKm: value ?? 0 })} /></Field>
      <Field label="Temperature from"><SourceSelect label="Temperature source" value={geology.temperatureSource} onChange={(temperatureSource) => setGeology({ temperatureSource })} /></Field>
      <Field label="Evidence" wide><input aria-label="Temperature evidence" placeholder="e.g. BHT 161 °C at 3,349 m MD, log run 2" value={geology.temperatureNote ?? ""} onChange={(event) => setGeology({ temperatureNote: event.target.value || undefined })} /></Field>
      <p className="sw-wd-derived">Bottom-hole static temperature ≈ <b>{Math.round(temperatureAt(brief, tvdAtMd(brief, brief.totalDepthMdM)))} °C</b> at {metres(tvdAtMd(brief, brief.totalDepthMdM))} TVD. Steel yield is derated with it.</p>
    </div>
    <h3 className="sw-wd-sub sw-title">Reservoir fluid <InfoTip label="About reservoir fluid">Sets the sour-service (ISO 15156) and CO2 checks.</InfoTip></h3>
    <div className="sw-wd-fields is-compact">
      <Field label="Fluid"><select aria-label="Reservoir fluid" value={fluids?.type ?? ""} onChange={(event) => (event.target.value ? setFluids({ type: event.target.value as ReservoirFluid }) : onChange({ ...brief, fluids: null }))}><option value="">Not known</option>{(["oil", "gas", "condensate", "water", "geothermal", "co2"] as const).map((value) => <option key={value} value={value}>{value === "co2" ? "CO2" : value[0]!.toUpperCase() + value.slice(1)}</option>)}</select></Field>
      <Field label="H2S" unit="mol %" hint="Blank = not sampled"><NumberInput label="H2S (mol %)" value={fluids?.h2sMolPct ?? null} digits={4} min={0} max={100} disabled={!fluids} onCommit={(h2sMolPct) => setFluids({ h2sMolPct })} /></Field>
      <Field label="CO2" unit="mol %"><NumberInput label="CO2 (mol %)" value={fluids?.co2MolPct ?? null} digits={3} min={0} max={100} disabled={!fluids} onCommit={(co2MolPct) => setFluids({ co2MolPct })} /></Field>
      <Field label="Fluid data from">{fluids ? <SourceSelect label="Fluid data source" value={fluids.source} onChange={(source) => setFluids({ source })} /> : <input disabled value="—" aria-label="Fluid data source" />}</Field>
      <p className="sw-wd-derived" data-testid="sour-status">{!sour.known ? "H2S not known — sour-service grade rules cannot be applied." : <>H2S partial pressure <b>{sour.h2sPartialKPa} kPa</b>{sour.co2PartialKPa !== null && <> · CO2 <b>{sour.co2PartialKPa} kPa</b></>} — {sour.sour ? <b className="is-bad">sour service (≥ 0.3 kPa)</b> : "sweet"}.</>}</p>
    </div>
  </Panel>;
}

export interface PressureWindowPlotProps {
  readonly brief: WellDesignBrief;
  readonly selectedSectionId?: string | null;
  readonly onSelectSection?: (id: string) => void;
  readonly height?: number;
  /** Kick margin drawn below the fracture gradient. Default 0.06 SG. */
  readonly kickMarginSg?: number;
  /**
   * What to draw over the pressure window: `"pressures"` only the rocks and pressures, `"programme"`
   * (default) casing seats and the mud-weight steps, `"cement"` cemented intervals and the cement
   * column's equivalent density at each shoe against the fracture gradient.
   */
  readonly overlay?: "pressures" | "programme" | "cement";
  /** An offset well drawn dashed behind this one: its pore/fracture profile and the mud it was drilled with. */
  readonly offset?: { readonly name: string; readonly brief: WellDesignBrief } | null;
}

/**
 * Pressure–depth plot: pore pressure, fracture gradient and the drillable mud window against TVD,
 * the stepped mud-weight programme, casing shoes and the stratigraphic column. Click a string to select it.
 */
export function PressureWindowPlot({ brief, selectedSectionId, onSelectSection, height = 600, kickMarginSg = 0.06, overlay = "programme", offset = null }: PressureWindowPlotProps) {
  const box = { left: 150, top: 52, right: 470, bottom: height - 18 };
  const width = Math.max(640, box.right + 22 + brief.sections.length * 13 + 104);
  const tdTvd = Math.max(100, tvdAtMd(brief, brief.totalDepthMdM));
  const samples = useMemo(() => Array.from({ length: 61 }, (_, index) => { const tvd = tdTvd * index / 60; return { tvd, ...pressureAt(brief, tvd) }; }), [brief, tdTvd]);
  const hasPressure = brief.geology.pressures.length > 0;
  const offsetSamples = useMemo(() => {
    if (!offset || !offset.brief.geology.pressures.length) return null;
    const depth = Math.min(tdTvd, tvdAtMd(offset.brief, offset.brief.totalDepthMdM));
    return Array.from({ length: 41 }, (_, index) => { const tvd = depth * index / 40; return { tvd, ...pressureAt(offset.brief, tvd) }; });
  }, [offset, tdTvd]);
  const tests = brief.geology.integrityTests ?? [];
  const extents = [...samples, ...(offsetSamples ?? [])];
  const sgMin = Math.floor(Math.min(1, ...extents.map((value) => value.porePressureSg)) * 10) / 10;
  const sgMax = Math.ceil((Math.max(1.6, ...extents.map((value) => value.fractureGradientSg), ...tests.map((test) => test.emwSg), ...brief.sections.map((value) => value.mudWeightSg)) + 0.05) * 10) / 10;
  const x = scaleLinear().domain([sgMin, sgMax]).range([box.left, box.right]);
  const y = scaleLinear().domain([0, tdTvd]).range([box.top, box.bottom]);
  const yTicks = y.ticks(8);
  const xTicks = x.ticks(Math.min(12, Math.round((sgMax - sgMin) * 10)));
  const line = (key: "porePressureSg" | "fractureGradientSg", offset = 0) => samples.map((value, index) => `${index ? "L" : "M"}${x(value[key] + offset).toFixed(1)} ${y(value.tvd).toFixed(1)}`).join(" ");
  const window = `${line("porePressureSg")} ${[...samples].reverse().map((value) => `L${x(value.fractureGradientSg).toFixed(1)} ${y(value.tvd).toFixed(1)}`).join(" ")} Z`;
  const sections = [...brief.sections].sort((a, b) => b.odIn - a.odIn);
  const shoes = [...brief.sections].sort((a, b) => a.shoeMdM - b.shoeMdM);
  const mudline = mudlineDepthM(brief);
  const formations = [...brief.geology.formations].sort((a, b) => a.topTvdM - b.topTvdM);
  const casingX = (index: number) => box.right + 22 + index * 13;
  const cementing = useMemo(() => (overlay === "cement" ? new Map(brief.sections.map((section, index) => [section.id, analyzeSection(brief, index).cement])) : null), [brief, overlay]);
  const showProgramme = overlay !== "pressures";
  const subtitle = overlay === "pressures" ? "pore and fracture pressure, mud window and formations" : overlay === "cement" ? "cement column at each shoe against the fracture gradient" : "casing seats and mud programme";
  return <figure className="sw-wd-plot" data-testid="pressure-window-plot">
    <figcaption><strong className="sw-title">Pressure window<InfoTip label="About the pressure window">Equivalent density (SG) against TVD from {brief.datum.reference}: {subtitle}.</InfoTip></strong><span>SG vs TVD {brief.datum.reference}</span></figcaption>
    <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`Pressure–depth plot to ${Math.round(tdTvd)} m TVD with ${brief.sections.length} casing strings`}>
      <text x={box.left} y={16} className="sw-wd-axis-title">EQUIVALENT DENSITY · SG (ppg)</text>
      {xTicks.map((tick) => <g key={tick}><line x1={x(tick)} x2={x(tick)} y1={box.top} y2={box.bottom} className="sw-wd-grid" /><text x={x(tick)} y={box.top - 20} textAnchor="middle" className="sw-wd-tick">{tick.toFixed(1)}</text><text x={x(tick)} y={box.top - 8} textAnchor="middle" className="sw-wd-tick is-sub">{sgToPpg(tick).toFixed(1)}</text></g>)}
      {yTicks.map((tick) => <g key={tick}><line x1={box.left} x2={box.right} y1={y(tick)} y2={y(tick)} className="sw-wd-grid" /><text x={44} y={y(tick) + 4} textAnchor="end" className="sw-wd-tick">{tick.toLocaleString("en-US")}</text></g>)}
      <text x={44} y={box.top - 8} textAnchor="end" className="sw-wd-axis-title">TVD m</text>
      {formations.map((formation, index) => {
        const top = y(Math.min(formation.topTvdM, tdTvd));
        const bottom = y(Math.min(formations[index + 1]?.topTvdM ?? tdTvd, tdTvd));
        if (bottom - top < 1) return null;
        return <g key={`${formation.name}-${index}`}>
          <rect x={50} y={top} width={92} height={bottom - top} fill={lithologyColour(formation.lithology)} stroke="#fff" />
          {formation.reservoir && <rect x={50} y={top} width={6} height={bottom - top} fill="#c2410c" />}
          {bottom - top > 13 && <text x={60} y={top + 12} className="sw-wd-formation">{formation.name.length > (formation.hazard ? 12 : 15) ? `${formation.name.slice(0, formation.hazard ? 11 : 14)}…` : formation.name}</text>}
          {formation.hazard && <g><title>{`${formation.name}: ${formation.hazard}`}</title><path d={`M${130} ${top + 3} l7 12 h-14z`} fill="#f2b705" stroke="#8a5a00" /><text x={130} y={top + 13} textAnchor="middle" className="sw-wd-hazard">!</text></g>}
        </g>;
      })}
      {mudline > 0 && mudline < tdTvd && <g><line x1={50} x2={box.right} y1={y(mudline)} y2={y(mudline)} className="sw-wd-mudline" /><text x={box.right - 4} y={y(mudline) - 4} textAnchor="end" className="sw-wd-tag is-water">{brief.location.environment === "onshore" ? "Ground" : "Seabed"} {metres(mudline)}</text></g>}
      {hasPressure && <>
        <path d={window} className="sw-wd-window" />
        <path d={line("fractureGradientSg", -kickMarginSg)} className="sw-wd-kick" />
        <path d={line("fractureGradientSg")} className="sw-wd-frac" />
        <path d={line("porePressureSg")} className="sw-wd-pore" />
      </>}
      {offsetSamples && offset && <g className="sw-wd-offset" data-testid="offset-overlay"><title>{`Offset ${offset.name}`}</title>
        <path d={offsetSamples.map((value, index) => `${index ? "L" : "M"}${x(value.porePressureSg).toFixed(1)} ${y(value.tvd).toFixed(1)}`).join(" ")} className="sw-wd-offset-pore" />
        <path d={offsetSamples.map((value, index) => `${index ? "L" : "M"}${x(value.fractureGradientSg).toFixed(1)} ${y(value.tvd).toFixed(1)}`).join(" ")} className="sw-wd-offset-frac" />
        {[...offset.brief.sections].sort((a, b) => a.shoeMdM - b.shoeMdM).map((section, index, list) => {
          const from = Math.min(tdTvd, tvdAtMd(offset.brief, index ? list[index - 1]!.shoeMdM : 0));
          const to = Math.min(tdTvd, tvdAtMd(offset.brief, section.shoeMdM));
          return to > from ? <line key={section.id} x1={x(section.mudWeightSg)} x2={x(section.mudWeightSg)} y1={y(from)} y2={y(to)} className="sw-wd-offset-mud" /> : null;
        })}
      </g>}
      {tests.filter((test) => test.tvdM <= tdTvd).map((test, index) => <g key={`test-${index}`} className="sw-wd-test" data-leakoff={test.reachedLeakOff || undefined}>
        <title>{`${test.kind} ${test.emwSg.toFixed(2)} SG at ${Math.round(test.tvdM)} m TVD${test.reachedLeakOff ? " (leak-off)" : " (held — lower bound)"}${test.source ? ` · ${test.source}` : ""}`}</title>
        <path d={`M${x(test.emwSg)} ${y(test.tvdM)} l-6 -8 h12z`} />
        <text x={x(test.emwSg) + 8} y={y(test.tvdM) + 4} className="sw-wd-tag">{test.kind} {test.emwSg.toFixed(2)}</text>
      </g>)}
      {showProgramme && shoes.map((section, index) => {
        const fromTvd = tvdAtMd(brief, index ? shoes[index - 1]!.shoeMdM : 0);
        const toTvd = tvdAtMd(brief, section.shoeMdM);
        const selected = section.id === selectedSectionId;
        return <g key={section.id}>
          <line x1={x(section.mudWeightSg)} x2={x(section.mudWeightSg)} y1={y(fromTvd)} y2={y(toTvd)} className={`sw-wd-mud${selected ? " is-selected" : ""}${cementing ? " is-faint" : ""}`} />
          {index > 0 && !cementing && <line x1={x(shoes[index - 1]!.mudWeightSg)} x2={x(section.mudWeightSg)} y1={y(fromTvd)} y2={y(fromTvd)} className="sw-wd-mud is-step" />}
          <line x1={box.left} x2={box.right + 18} y1={y(toTvd)} y2={y(toTvd)} className="sw-wd-shoe-line" />
        </g>;
      })}
      {cementing && shoes.map((section) => {
        const cement = cementing.get(section.id);
        if (!cement) return null;
        const yy = y(tvdAtMd(brief, section.shoeMdM));
        const over = cement.equivalentSgAtShoe > cement.fractureSgAtShoe;
        const selected = section.id === selectedSectionId;
        return <g key={`cement-${section.id}`} className="sw-wd-ecd" data-over={over || undefined}>
          <title>{`${section.label}: cement column ${cement.equivalentSgAtShoe.toFixed(2)} SG at the shoe against fracture ${cement.fractureSgAtShoe.toFixed(2)} SG`}</title>
          <line x1={x(cement.equivalentSgAtShoe)} x2={x(cement.fractureSgAtShoe)} y1={yy} y2={yy} className="sw-wd-ecd-gap" />
          <path d={`M${x(cement.equivalentSgAtShoe)} ${yy - 7} l7 7 l-7 7 l-7 -7z`} className={`sw-wd-ecd-mark${selected ? " is-selected" : ""}`} />
          <text x={x(cement.equivalentSgAtShoe) - 10} y={yy - 9} textAnchor="end" className="sw-wd-tag">{cement.equivalentSgAtShoe.toFixed(2)}</text>
        </g>;
      })}
      {showProgramme && sections.map((section, index) => {
        const xi = casingX(index);
        const top = y(tvdAtMd(brief, section.topMdM));
        const shoe = y(tvdAtMd(brief, section.shoeMdM));
        const selected = section.id === selectedSectionId;
        const colour = selected ? "#ff6a00" : "#20322a";
        return <g key={section.id} className={`sw-wd-string${selected ? " is-selected" : ""}`} role={onSelectSection ? "button" : undefined} tabIndex={onSelectSection ? 0 : undefined} aria-label={`${section.label}, shoe ${Math.round(section.shoeMdM)} m MD${selected ? ", selected" : ""}`} aria-pressed={onSelectSection ? selected : undefined} onClick={() => onSelectSection?.(section.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectSection?.(section.id); } }}>
          <rect x={xi - 6} y={top} width={12} height={Math.max(4, shoe - top)} fill="transparent" />
          {cementing && section.cement && <rect x={xi - 5} y={y(tvdAtMd(brief, Math.min(section.cement.topMdM, section.shoeMdM)))} width={10} height={Math.max(2, shoe - y(tvdAtMd(brief, Math.min(section.cement.topMdM, section.shoeMdM))))} rx={2} fill="#a9b0a6" />}
          <line x1={xi} x2={xi} y1={top} y2={shoe} stroke={colour} strokeWidth={selected ? 5 : 3} />
          <path d={`M${xi} ${shoe} l-6 0 l6 -9z`} fill={colour} />
          <text x={casingX(sections.length) + 2} y={shoe + 4} className={`sw-wd-shoe-label${selected ? " is-selected" : ""}`}>{formatOd(section.odIn)} · {metres(section.shoeMdM)}</text>
        </g>;
      })}
      <rect x={box.left} y={box.top} width={box.right - box.left} height={box.bottom - box.top} className="sw-wd-frame" />
      {!hasPressure && <text x={(box.left + box.right) / 2} y={(box.top + box.bottom) / 2} textAnchor="middle" className="sw-wd-empty">Add pore and fracture pressure points</text>}
    </svg>
    <ul className="sw-wd-legend" aria-label="Legend">
      <li><i className="is-pore" />Pore pressure</li><li><i className="is-frac" />Fracture gradient</li><li><i className="is-kick" />Kick margin ({kickMarginSg.toFixed(2)} SG)</li><li><i className="is-window" />Mud window</li>{overlay === "programme" && <li><i className="is-mud" />Mud weight</li>}{cementing && <><li><i className="is-ecd" />Cement column at shoe</li><li><i className="is-cemented" />Cemented interval</li></>}<li><i className="is-reservoir" />Reservoir</li>{tests.length > 0 && <li><i className="is-test" />FIT / LOT</li>}{offsetSamples && offset && <li><i className="is-offset" />Offset · {offset.name}</li>}
    </ul>
  </figure>;
}

/* ------------------------------------------------------------------ casing */

const roles: readonly SectionRole[] = ["conductor", "surface", "intermediate", "production", "liner", "tieback"];
const roleName = (role: SectionRole) => (role === "conductor" ? "conductor" : role === "liner" ? "liner" : role === "tieback" ? "tieback" : `${role} casing`);
const casingOds = [...new Set(casingTable.map((row) => row.odIn))];
const casingGrades = Object.keys(steelGrades);

export interface CasingSchemeTableProps extends BriefEditorProps {
  readonly selectedId?: string | null;
  readonly onSelect?: (id: string) => void;
  readonly factors?: DesignFactors;
  /** Shown as a button; typically replaces the sections with `proposeCasingScheme(brief)`. */
  readonly onPropose?: () => void;
  /** Show the selected string's load card under the table. Set false to place `CasingLoadCard` elsewhere. Default true. */
  readonly showLoadCard?: boolean;
  /** Shown as a button while any string fails; typically `regradeFailingStrings(brief)`. */
  readonly onRegrade?: () => void;
}

/** Editable casing programme with API 5C3 ratings and burst / collapse / tension safety factors per string. */
export function CasingSchemeTable({ brief, onChange, selectedId, onSelect, factors = defaultDesignFactors, onPropose, showLoadCard = true, onRegrade }: CasingSchemeTableProps) {
  const basis = brief.basis ?? defaultDesignBasis;
  const setBasis = (patch: Partial<typeof basis>) => onChange({ ...brief, basis: { ...basis, ...patch } });
  const analyses = useMemo(() => brief.sections.map((_, index) => analyzeSection(brief, index, factors)), [brief, factors]);
  const setSection = (index: number, patch: Partial<CasingSection>) => onChange({ ...brief, sections: brief.sections.map((value, at) => {
    if (at !== index) return value;
    const next = { ...value, ...patch };
    return { ...next, label: `${formatOd(next.odIn)} ${roleName(next.role)}` };
  }) });
  const setOd = (index: number, odIn: number) => setSection(index, { odIn, weightLbFt: casingTable.find((row) => row.odIn === odIn)!.weightLbFt, holeSizeIn: standardHoleSize(odIn) });
  const add = () => {
    const last = [...brief.sections].sort((a, b) => a.odIn - b.odIn)[0];
    const odIn = last ? casingOds.find((value) => value < last.odIn) ?? 4.5 : 13.375;
    const shoe = Math.min(brief.totalDepthMdM, (last?.shoeMdM ?? 0) + 500);
    const role: SectionRole = last ? "liner" : "surface";
    const section: CasingSection = { id: `section-${Date.now().toString(36)}`, role, label: `${formatOd(odIn)} ${roleName(role)}`, holeSizeIn: standardHoleSize(odIn), odIn, weightLbFt: casingTable.find((row) => row.odIn === odIn)!.weightLbFt, grade: "N80", topMdM: last && role === "liner" ? Math.max(0, last.shoeMdM - 150) : 0, shoeMdM: shoe, mudWeightSg: last?.mudWeightSg ?? 1.1, cement: { topMdM: last ? Math.max(0, last.shoeMdM - 150) : 0, leadDensitySg: 1.5, tailDensitySg: 1.9, tailLengthM: 150, excessPct: 30 } };
    onChange({ ...brief, sections: [...brief.sections, section] });
    onSelect?.(section.id);
  };
  const selectedIndex = brief.sections.findIndex((section) => section.id === selectedId);
  const selected = selectedIndex >= 0 ? analyses[selectedIndex] : undefined;
  const sf = (value: number, limit: number, title: string) => <span className="sw-wd-sf" data-pass={value >= limit} title={title}>{value >= 99 ? "—" : value.toFixed(2)}<span className="sw-asm-sr">{value >= limit ? " passes" : " fails"}</span></span>;
  return <Panel title="Casing scheme" kicker="Step 6 · seats, sizes, weights and grades" testId="wd-casing" actions={<>{onRegrade && analyses.some((analysis) => !analysis.passes) && <CommandButton icon="apply" type="button" className="sw-asm-button" onClick={onRegrade}>Regrade failing strings</CommandButton>}{onPropose && <CommandButton icon="apply" type="button" className="sw-asm-button is-primary" onClick={onPropose}>Propose from pressures</CommandButton>}<CommandButton type="button" className="sw-asm-button" onClick={add}><Plus size={14} /> Add string</CommandButton></>}>
    <div className="sw-wd-fields is-compact" aria-label="Design basis">
      <Field label="Kick intensity" unit="SG over next mud" hint="Sets kick tolerance at each shoe (0.06 SG ≈ 0.5 ppg)"><NumberInput label="Kick intensity (SG)" value={basis.kickIntensitySg} min={0} max={0.3} onCommit={(value) => setBasis({ kickIntensitySg: value ?? defaultDesignBasis.kickIntensitySg })} /></Field>
      <Field label="Casing wear" unit="% wall" hint="Applied to strings that are drilled through"><NumberInput label="Casing wear (% wall)" value={basis.casingWearPct} digits={0} min={0} max={40} onCommit={(value) => setBasis({ casingWearPct: value ?? 0 })} /></Field>
    </div>
    <p className="sw-wd-basis">Design factors <span>burst <b>{factors.burst}</b></span><span>collapse <b>{factors.collapse}</b></span><span>tension <b>{factors.tension}</b></span><InfoTip label="About design factors">Against API TR 5C3 ratings derated for shoe temperature and wear; collapse is biaxial (reduced under tension). Safety factors in the table use those effective ratings.</InfoTip></p>
    <div className="sw-wd-scroll"><table className="sw-wd-table is-casing">
      <thead><tr><th scope="col">String</th><th scope="col">Hole <small>in</small></th><th scope="col">OD</th><th scope="col">lb/ft</th><th scope="col">Grade</th><th scope="col">Top <small>m MD</small></th><th scope="col">Shoe <small>m MD</small></th><th scope="col">Mud <small>SG</small></th><th scope="col">Burst <small>SF</small></th><th scope="col">Collapse <small>SF</small></th><th scope="col">Tension <small>SF</small></th><th scope="col"><span className="sw-asm-sr">Remove</span></th></tr></thead>
      <tbody>{brief.sections.map((section, index) => {
        const analysis = analyses[index]!;
        const weights = casingTable.filter((row) => row.odIn === section.odIn);
        return <tr key={section.id} aria-selected={section.id === selectedId} data-error={analysis.issues.some((issue) => issue.severity === "error" && issue.stage === "casing") || undefined} onClick={(event) => { if (!(event.target as HTMLElement).closest("input, select, button")) onSelect?.(section.id); }}>
          <td><CommandButton kind="selection" type="button" className="sw-wd-select" onClick={() => onSelect?.(section.id)} aria-label={`Select ${section.label}`}>{index + 1}</CommandButton><select aria-label={`String ${index + 1} role`} value={section.role} onChange={(event) => setSection(index, { role: event.target.value as SectionRole })}>{roles.map((role) => <option key={role} value={role}>{roleName(role)}</option>)}</select></td>
          <td><NumberInput label={`${section.label} hole size (in)`} value={section.holeSizeIn} digits={3} min={4} onCommit={(value) => setSection(index, { holeSizeIn: value ?? section.holeSizeIn })} /></td>
          <td><select aria-label={`${section.label} OD`} value={section.odIn} onChange={(event) => setOd(index, Number(event.target.value))}>{casingOds.map((od) => <option key={od} value={od}>{formatOd(od)}</option>)}</select></td>
          <td><select aria-label={`${section.label} weight`} value={section.weightLbFt} onChange={(event) => setSection(index, { weightLbFt: Number(event.target.value) })}>{weights.map((row) => <option key={row.weightLbFt} value={row.weightLbFt}>{row.weightLbFt}</option>)}</select></td>
          <td><select aria-label={`${section.label} grade`} value={section.grade} onChange={(event) => setSection(index, { grade: event.target.value })}>{casingGrades.map((grade) => <option key={grade} value={grade}>{grade}</option>)}</select></td>
          <td><NumberInput label={`${section.label} top (m MD)`} value={section.topMdM} digits={0} min={0} onCommit={(value) => setSection(index, { topMdM: value ?? 0 })} /></td>
          <td><NumberInput label={`${section.label} shoe (m MD)`} value={section.shoeMdM} digits={0} min={1} onCommit={(value) => setSection(index, { shoeMdM: value ?? section.shoeMdM })} /></td>
          <td><NumberInput label={`${section.label} mud weight (SG)`} value={section.mudWeightSg} min={0.8} max={2.6} onCommit={(value) => setSection(index, { mudWeightSg: value ?? section.mudWeightSg })} /></td>
          <td>{sf(analysis.safety.burst, factors.burst, `${psi(analysis.loads.burstPsi)} load / ${psi(analysis.ratings?.burstPsi ?? 0)} rating`)}</td>
          <td>{sf(analysis.safety.collapse, factors.collapse, `${psi(analysis.loads.collapsePsi)} load / ${psi(analysis.ratings?.collapsePsi ?? 0)} rating`)}</td>
          <td>{sf(analysis.safety.tension, factors.tension, `${Math.round(analysis.loads.tensionLbf / 1000)} klbf load / ${Math.round((analysis.ratings?.bodyYieldLbf ?? 0) / 1000)} klbf rating`)}</td>
          <td><CommandButton type="button" className="sw-wd-icon" aria-label={`Remove ${section.label}`} onClick={() => onChange({ ...brief, sections: brief.sections.filter((_, at) => at !== index) })}><Trash2 size={14} /></CommandButton></td>
        </tr>;
      })}</tbody>
    </table></div>
    {!brief.sections.length && <p className="sw-wd-empty-note">No strings yet. Propose a scheme from the pressure profile, or add strings by hand.</p>}
    {showLoadCard && selected && selectedIndex >= 0 && <SectionLoadCard section={brief.sections[selectedIndex]!} analysis={selected} factors={factors} />}
  </Panel>;
}

export interface CasingLoadCardProps {
  readonly brief: WellDesignBrief;
  readonly sectionId: string | null | undefined;
  readonly factors?: DesignFactors;
}

/** Burst, collapse and tension load against API 5C3 rating for one string, with the load cases behind them. */
export function CasingLoadCard({ brief, sectionId, factors = defaultDesignFactors }: CasingLoadCardProps) {
  const index = brief.sections.findIndex((section) => section.id === sectionId);
  const analysis = useMemo(() => (index >= 0 ? analyzeSection(brief, index, factors) : null), [brief, index, factors]);
  if (!analysis) return <p className="sw-wd-empty-note">Select a string to see its loads against its ratings.</p>;
  return <SectionLoadCard section={brief.sections[index]!} analysis={analysis} factors={factors} />;
}

function LoadBar({ label, load, rating, unit, factor }: { readonly label: string; readonly load: number; readonly rating: number; readonly unit: string; readonly factor: number }) {
  const max = Math.max(load * factor, rating, 1) * 1.08;
  const pass = rating >= load * factor;
  return <div className="sw-wd-loadbar" data-pass={pass}>
    <span>{label}</span>
    <svg viewBox="0 0 300 26" role="img" aria-label={`${label}: load ${Math.round(load)} ${unit} times design factor ${factor} against rating ${Math.round(rating)} ${unit}, ${pass ? "passes" : "fails"}`}>
      <rect x={0} y={4} width={300} height={18} rx={3} fill="#eef2ef" />
      <rect x={0} y={4} width={300 * rating / max} height={18} rx={3} fill={pass ? "#cfe8dd" : "#f6d4d1"} />
      <rect x={0} y={9} width={300 * load / max} height={8} rx={2} fill={pass ? "#147a65" : "#b3261e"} />
      <line x1={300 * load * factor / max} x2={300 * load * factor / max} y1={1} y2={25} stroke="#20322a" strokeDasharray="3 2" />
    </svg>
    <b>{Math.round(load).toLocaleString("en-US")} / {Math.round(rating).toLocaleString("en-US")} {unit}</b>
  </div>;
}

function SectionLoadCard({ section, analysis, factors }: { readonly section: CasingSection; readonly analysis: ReturnType<typeof analyzeSection>; readonly factors: DesignFactors }) {
  const ratings = analysis.ratings;
  const effective = analysis.effective;
  const kick = analysis.kickTolerance;
  return <div className="sw-wd-loadcard" data-testid="section-load-card">
    <header><strong className="sw-title">{section.label}{ratings && analysis.pipe && <InfoTip label="About the load cases"><p><b>Burst case:</b> {analysis.loads.burstCase}; seawater backup.</p><p><b>Collapse:</b> full evacuation against {section.mudWeightSg.toFixed(2)} SG mud.</p><p><b>Tension:</b> buoyed weight, buoyancy factor {(1 - section.mudWeightSg / 7.85).toFixed(3)}.</p><p>Dashed line = load × design factor.</p></InfoTip>}</strong><span>{section.weightLbFt} lb/ft {section.grade} · {section.holeSizeIn}" hole · shoe {metres(section.shoeMdM)} MD / {metres(analysis.shoeTvdM)} TVD</span></header>
    {ratings && analysis.pipe ? <>
      <dl className="sw-wd-facts">
        <div><dt>Wall / ID / drift</dt><dd>{analysis.pipe.wallIn}" / {analysis.pipe.idIn}" / {analysis.pipe.driftIn}"</dd></div>
        <div><dt>D/t · collapse regime</dt><dd>{ratings.dOverT} · {ratings.collapseRegime}</dd></div>
        <div><dt>Coupling clearance</dt><dd>{analysis.holeClearanceIn}"</dd></div>
        <div><dt>Mud window</dt><dd>{analysis.mudWindow.minimumSg.toFixed(2)}–{analysis.mudWindow.maximumSg.toFixed(2)} SG</dd></div>
      </dl>
      <LoadBar label="Burst" load={analysis.loads.burstPsi} rating={effective?.burstPsi ?? ratings.burstPsi} unit="psi" factor={factors.burst} />
      <LoadBar label="Collapse" load={analysis.loads.collapsePsi} rating={effective?.collapsePsi ?? ratings.collapsePsi} unit="psi" factor={factors.collapse} />
      <LoadBar label="Tension" load={analysis.loads.tensionLbf / 1000} rating={(effective?.bodyYieldLbf ?? ratings.bodyYieldLbf) / 1000} unit="klbf" factor={factors.tension} />
      {effective && <div className="sw-wd-scroll" tabIndex={0} role="region" aria-label="Effective casing ratings"><table className="sw-wd-table is-ratings" data-testid="effective-ratings">
        <caption>Nominal API rating → effective rating used</caption>
        <tbody>
          <tr><th scope="row">Burst</th><td className="is-mono">{psi(ratings.burstPsi)}</td><td className="is-mono">{psi(effective.burstPsi)}</td><td>× {effective.yieldDerating.toFixed(3)} yield at {Math.round(effective.temperatureC)} °C{effective.wearPct ? `, ${effective.wearPct}% wear` : ""}</td></tr>
          <tr><th scope="row">Collapse</th><td className="is-mono">{psi(ratings.collapsePsi)}</td><td className="is-mono">{psi(effective.collapsePsi)}</td><td>biaxial at {metres(effective.collapseAtMdM)} MD, axial {psi(effective.axialStressAtCollapsePsi)}</td></tr>
          <tr><th scope="row">Tension</th><td className="is-mono">{Math.round(ratings.bodyYieldLbf / 1000)} klbf</td><td className="is-mono">{Math.round(effective.bodyYieldLbf / 1000)} klbf</td><td>pipe body, derated yield</td></tr>
        </tbody>
      </table></div>}
      {kick && <div className="sw-wd-kickcard" data-pass={kick.volumeM3 >= kick.requiredM3} data-testid="kick-tolerance">
        <strong>Kick tolerance {kick.volumeM3.toFixed(1)} m³ ({kick.volumeBbl} bbl)</strong>
        <span>for the next hole to {metres(kick.nextTdTvdM)} TVD on {kick.nextMudSg.toFixed(2)} SG mud, {kick.kickIntensitySg.toFixed(2)} SG intensity · shoe fracture {kick.fractureSgAtShoe.toFixed(2)} SG · max influx height {metres(kick.maxInfluxHeightM)} · minimum {kick.requiredM3} m³</span>
      </div>}
    </> : <p className="sw-wd-note">Pick a size from the casing table to rate this string.</p>}
    <IssueList issues={analysis.issues.filter((issue) => issue.stage === "casing")} empty="This string meets every casing check." />
  </div>;
}

/* ------------------------------------------------------------------ cement */

export interface CementPlanTableProps extends BriefEditorProps {
  readonly selectedId?: string | null;
  readonly onSelect?: (id: string) => void;
}

/** Top of cement, slurry design and excess per string, with volumes and the cement column's equivalent density against the fracture gradient. */
export function CementPlanTable({ brief, onChange, selectedId, onSelect }: CementPlanTableProps) {
  const analyses = useMemo(() => brief.sections.map((_, index) => analyzeSection(brief, index)), [brief]);
  const setCement = (index: number, patch: Partial<NonNullable<CasingSection["cement"]>> | null) => onChange({ ...brief, sections: brief.sections.map((section, at) => {
    if (at !== index) return section;
    if (patch === null) return { ...section, cement: null };
    const base = section.cement ?? { topMdM: Math.max(0, section.shoeMdM - 300), leadDensitySg: 1.5, tailDensitySg: 1.9, tailLengthM: 150, excessPct: 30 };
    return { ...section, cement: { ...base, ...patch } };
  }) });
  const total = analyses.reduce((sum, analysis) => sum + (analysis.cement?.totalM3 ?? 0), 0);
  return <Panel title="Cement" kicker="Step 7 · zonal isolation" testId="wd-cement" info={<><p>Volumes = open-hole annulus × (1 + excess) + cased overlap + 24 m shoe track.</p><p>The column (mud or seawater above the top of cement, then lead, then tail) must stay below the fracture gradient at the shoe and below the previous shoe.</p></>}>
    <div className="sw-wd-scroll"><table className="sw-wd-table is-cement">
      <thead><tr><th scope="col">String</th><th scope="col">Cemented</th><th scope="col">TOC <small>m MD</small></th><th scope="col">Lead <small>SG</small></th><th scope="col">Tail <small>SG</small></th><th scope="col">Tail <small>m</small></th><th scope="col">Excess <small>%</small></th><th scope="col">Volume <small>m³ (bbl)</small></th><th scope="col">Column at shoe <small>vs frac SG</small></th></tr></thead>
      <tbody>{brief.sections.map((section, index) => {
        const cement = analyses[index]!.cement;
        const plan = section.cement;
        const over = cement ? cement.equivalentSgAtShoe > cement.fractureSgAtShoe : false;
        return <tr key={section.id} aria-selected={section.id === selectedId} onClick={(event) => { if (!(event.target as HTMLElement).closest("input, select, button")) onSelect?.(section.id); }}>
          <th scope="row"><CommandButton kind="selection" type="button" className="sw-wd-select" onClick={() => onSelect?.(section.id)}>{section.label}</CommandButton></th>
          <td className="is-center"><input type="checkbox" aria-label={`${section.label} is cemented`} checked={Boolean(plan)} onChange={(event) => setCement(index, event.target.checked ? {} : null)} /></td>
          <td><NumberInput disabled={!plan} label={`${section.label} top of cement (m MD)`} value={plan?.topMdM ?? null} digits={0} min={0} max={section.shoeMdM - 1} onCommit={(value) => setCement(index, { topMdM: value ?? 0 })} /></td>
          <td><NumberInput disabled={!plan} label={`${section.label} lead slurry (SG)`} value={plan?.leadDensitySg ?? null} min={1} max={2.4} onCommit={(value) => setCement(index, { leadDensitySg: value ?? 1.5 })} /></td>
          <td><NumberInput disabled={!plan} label={`${section.label} tail slurry (SG)`} value={plan?.tailDensitySg ?? null} min={1} max={2.4} onCommit={(value) => setCement(index, { tailDensitySg: value ?? 1.9 })} /></td>
          <td><NumberInput disabled={!plan} label={`${section.label} tail length (m)`} value={plan?.tailLengthM ?? null} digits={0} min={0} onCommit={(value) => setCement(index, { tailLengthM: value ?? 0 })} /></td>
          <td><NumberInput disabled={!plan} label={`${section.label} excess (%)`} value={plan?.excessPct ?? null} digits={0} min={0} max={300} onCommit={(value) => setCement(index, { excessPct: value ?? 0 })} /></td>
          <td className="is-mono">{cement ? `${cement.totalM3.toFixed(1)} (${cement.totalBbl})` : "—"}</td>
          <td className="is-mono" data-over={over || undefined}>{cement ? <>{cement.equivalentSgAtShoe.toFixed(2)} <small>/ {cement.fractureSgAtShoe.toFixed(2)}</small>{over && <span className="sw-asm-sr"> exceeds fracture gradient</span>}</> : "—"}</td>
        </tr>;
      })}</tbody>
      {brief.sections.length > 0 && <tfoot><tr><th scope="row" colSpan={7}>Total slurry</th><td className="is-mono">{total.toFixed(1)} ({Math.round(total * 6.2898)})</td><td /></tr></tfoot>}
    </table></div>
    <CementSketch brief={brief} selectedId={selectedId} onSelect={onSelect} />
    <IssueList issues={analyses.flatMap((analysis) => analysis.issues).filter((issue) => issue.stage === "cement")} empty="Every string has cement with enough overlap and stays inside the fracture gradient." onSelectSection={onSelect} />
  </Panel>;
}

/** Half-section sketch of strings and cement sheaths to scale in depth. */
function CementSketch({ brief, selectedId, onSelect }: { readonly brief: WellDesignBrief; readonly selectedId?: string | null; readonly onSelect?: (id: string) => void }) {
  const sections = [...brief.sections].sort((a, b) => b.odIn - a.odIn);
  if (!sections.length) return null;
  const width = 640, height = 220;
  const td = Math.max(brief.totalDepthMdM, ...sections.map((section) => section.shoeMdM));
  const x = scaleLinear().domain([0, td]).range([40, width - 20]);
  const lane = (index: number) => 40 + index * (150 / sections.length);
  return <svg className="sw-wd-cement-sketch" viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Cement coverage along measured depth">
    {x.ticks(8).map((tick) => <g key={tick}><line x1={x(tick)} x2={x(tick)} y1={20} y2={height - 24} className="sw-wd-grid" /><text x={x(tick)} y={height - 8} textAnchor="middle" className="sw-wd-tick">{tick.toLocaleString("en-US")}</text></g>)}
    <text x={width - 20} y={12} textAnchor="end" className="sw-wd-axis-title">MEASURED DEPTH / m</text>
    {sections.map((section, index) => {
      const yy = lane(index);
      const h = Math.max(8, 150 / sections.length - 22);
      const selected = section.id === selectedId;
      return <g key={section.id} className="sw-wd-string" role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} aria-label={`${section.label}${section.cement ? `, cement from ${Math.round(section.cement.topMdM)} m` : ", not cemented"}`} aria-pressed={onSelect ? selected : undefined} onClick={() => onSelect?.(section.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect?.(section.id); } }}>
        {section.cement && <>
          <rect x={x(section.cement.topMdM)} y={yy} width={Math.max(0, x(section.shoeMdM - Math.min(section.cement.tailLengthM, section.shoeMdM - section.cement.topMdM)) - x(section.cement.topMdM))} height={h} fill="#cfd3cc" />
          <rect x={x(section.shoeMdM - Math.min(section.cement.tailLengthM, section.shoeMdM - section.cement.topMdM))} y={yy} width={Math.max(0, x(section.shoeMdM) - x(section.shoeMdM - Math.min(section.cement.tailLengthM, section.shoeMdM - section.cement.topMdM)))} height={h} fill="#8f978e" />
        </>}
        <line x1={x(section.topMdM)} x2={x(section.shoeMdM)} y1={yy + h} y2={yy + h} stroke={selected ? "#ff6a00" : "#20322a"} strokeWidth={selected ? 5 : 3} />
        <path d={`M${x(section.shoeMdM)} ${yy + h} l0 -9 l9 9z`} fill={selected ? "#ff6a00" : "#20322a"} />
        <text x={x(section.topMdM)} y={yy - 4} className={`sw-wd-shoe-label${selected ? " is-selected" : ""}`}>{section.label}{section.cement ? ` · TOC ${Math.round(section.cement.topMdM)} m` : " · not cemented"}</text>
      </g>;
    })}
    <g className="sw-wd-sketch-key"><rect x={40} y={4} width={10} height={8} fill="#cfd3cc" /><text x={54} y={11} className="sw-wd-tick">Lead</text><rect x={90} y={4} width={10} height={8} fill="#8f978e" /><text x={104} y={11} className="sw-wd-tick">Tail</text></g>
  </svg>;
}

/* ------------------------------------------------------------------ completion */

const lifts: readonly { value: ArtificialLift; label: string }[] = [{ value: "none", label: "Natural flow" }, { value: "gas-lift", label: "Gas lift" }, { value: "esp", label: "Electric submersible pump" }, { value: "rod-pump", label: "Sucker-rod pump" }, { value: "pcp", label: "Progressing cavity pump" }, { value: "jet-pump", label: "Jet pump" }];

/** Tubing, packer, safety valve, lift and perforations: the producing barrier envelope. */
export function CompletionForm({ brief, onChange }: BriefEditorProps) {
  const completion = brief.completion;
  const production = [...brief.sections].sort((a, b) => a.odIn - b.odIn)[0];
  const set = (patch: Partial<CompletionPlan>) => completion && onChange({ ...brief, completion: { ...completion, ...patch } });
  const masp = maximumSurfacePressure(brief);
  const tdTvd = tvdAtMd(brief, brief.totalDepthMdM);
  if (!completion) return <Panel title="Completion" kicker="Step 8 · how it will produce" testId="wd-completion">
    <p className="sw-wd-empty-note">No completion: the well is drilled and suspended under a BOP. Add a completion to design the producing string.</p>
    <CommandButton type="button" className="sw-asm-button is-primary" onClick={() => onChange({ ...brief, completion: { tubingOdIn: 3.5, tubingWeightLbFt: 9.3, tubingGrade: "L80", packerMdM: Math.max(100, Math.round((production?.shoeMdM ?? brief.totalDepthMdM) - 200)), sssvMdM: 250, perforations: [], artificialLift: "none" } })}><Plus size={14} /> Add completion</CommandButton>
  </Panel>;
  return <Panel title="Completion" kicker="Step 8 · how it will produce" testId="wd-completion" actions={<CommandButton icon="stop" type="button" className="sw-asm-button is-danger" onClick={() => onChange({ ...brief, completion: null })}>Suspend instead</CommandButton>}>
    <div className="sw-wd-fields">
      <Field label="Tubing" hint={`Drift ${tubingTable.find((row) => row.odIn === completion.tubingOdIn)?.driftIn ?? "?"}" — every wireline tool must pass`}><select value={`${completion.tubingOdIn}|${completion.tubingWeightLbFt}`} onChange={(event) => { const [od, weight] = event.target.value.split("|").map(Number); set({ tubingOdIn: od!, tubingWeightLbFt: weight! }); }}>{tubingTable.map((row) => <option key={row.odIn} value={`${row.odIn}|${row.weightLbFt}`}>{formatOd(row.odIn)} {row.weightLbFt} lb/ft · ID {row.idIn}"</option>)}</select></Field>
      <Field label="Tubing grade" hint="Sour service needs L80 or C90"><select value={completion.tubingGrade} onChange={(event) => set({ tubingGrade: event.target.value })}>{["J55", "N80", "L80", "C90", "P110"].map((grade) => <option key={grade}>{grade}</option>)}</select></Field>
      <Field label="Production packer" unit="m MD" hint={production ? `Inside ${production.label}, above the perforations` : "Needs a production string"}><NumberInput label="Packer depth (m MD)" value={completion.packerMdM} digits={0} min={50} onCommit={(value) => set({ packerMdM: value ?? completion.packerMdM })} /></Field>
      <Field label="Safety valve" unit="m MD" hint="Below seabed and hydrate zone; blank for none"><NumberInput label="Safety valve depth (m MD)" value={completion.sssvMdM} digits={0} min={10} onCommit={(value) => set({ sssvMdM: value })} /></Field>
      <Field label="Artificial lift"><select value={completion.artificialLift} onChange={(event) => set({ artificialLift: event.target.value as ArtificialLift })}>{lifts.map((lift) => <option key={lift.value} value={lift.value}>{lift.label}</option>)}</select></Field>
      {completion.artificialLift === "gas-lift" && <Field label="Gas-lift mandrels" hint="Unloading valves plus operating valve"><NumberInput label="Gas lift mandrels" value={completion.gasLiftMandrels ?? 3} digits={0} min={1} max={8} onCommit={(value) => set({ gasLiftMandrels: value ?? 3 })} /></Field>}
    </div>
    <h3 className="sw-wd-sub">Perforations</h3>
    <div className="sw-wd-scroll"><table className="sw-wd-table">
      <thead><tr><th scope="col">Top <small>m MD</small></th><th scope="col">Bottom <small>m MD</small></th><th scope="col">Length</th><th scope="col">TVD</th><th scope="col"><span className="sw-asm-sr">Remove</span></th></tr></thead>
      <tbody>{completion.perforations.map((interval, index) => <tr key={index}>
        <td><NumberInput label={`Perforation ${index + 1} top (m MD)`} value={interval.topMdM} digits={0} onCommit={(value) => set({ perforations: completion.perforations.map((item, at) => (at === index ? { ...item, topMdM: value ?? item.topMdM } : item)) })} /></td>
        <td><NumberInput label={`Perforation ${index + 1} bottom (m MD)`} value={interval.bottomMdM} digits={0} onCommit={(value) => set({ perforations: completion.perforations.map((item, at) => (at === index ? { ...item, bottomMdM: value ?? item.bottomMdM } : item)) })} /></td>
        <td className="is-mono">{metres(interval.bottomMdM - interval.topMdM)}</td>
        <td className="is-mono">{metres(tvdAtMd(brief, interval.topMdM))}–{metres(tvdAtMd(brief, interval.bottomMdM))}</td>
        <td><CommandButton type="button" className="sw-wd-icon" aria-label={`Remove perforation ${index + 1}`} onClick={() => set({ perforations: completion.perforations.filter((_, at) => at !== index) })}><Trash2 size={14} /></CommandButton></td>
      </tr>)}</tbody>
    </table></div>
    <CommandButton type="button" className="sw-asm-button" onClick={() => set({ perforations: [...completion.perforations, { topMdM: completion.packerMdM + 50, bottomMdM: Math.min(completion.packerMdM + 90, (production?.shoeMdM ?? brief.totalDepthMdM) - 20) }] })}><Plus size={14} /> Add interval</CommandButton>
    <dl className="sw-wd-facts is-wide">
      <div><dt>Reservoir pressure</dt><dd>{psi(masp.reservoirPsi)}</dd></div>
      <div><dt>MASP · gas to surface</dt><dd>{psi(masp.maspPsi)}</dd></div>
      <div><dt>Wellhead / tree class</dt><dd>{masp.wellheadRatingPsi ? `API 6A ${masp.wellheadRatingPsi / 1000}K` : "Above 20K"}</dd></div>
      <div><dt>Bottom-hole temperature</dt><dd>{Math.round(temperatureAt(brief, tdTvd))} °C</dd></div>
    </dl>
    <IssueList issues={validateDesign(brief).filter((issue) => issue.stage === "completion")} empty="Completion is consistent with the casing scheme." />
  </Panel>;
}

/* ------------------------------------------------------------------ programme */

export interface WellProgrammeSummaryProps {
  readonly brief: WellDesignBrief;
  readonly factors?: DesignFactors;
  readonly selectedId?: string | null;
  readonly onSelect?: (id: string) => void;
}

/** One-page well programme: every hole section with its casing, mud, cement and safety factors, then the completion and the open checks. */
export function WellProgrammeSummary({ brief, factors = defaultDesignFactors, selectedId, onSelect }: WellProgrammeSummaryProps) {
  const analyses = useMemo(() => brief.sections.map((_, index) => analyzeSection(brief, index, factors)), [brief, factors]);
  const issues = useMemo(() => validateDesign(brief, factors), [brief, factors]);
  const masp = maximumSurfacePressure(brief);
  const tdTvd = tvdAtMd(brief, brief.totalDepthMdM);
  const completion = brief.completion;
  const reservoir = brief.geology.formations.find((formation) => formation.reservoir);
  const order = brief.sections.map((section, index) => ({ section, analysis: analyses[index]! })).sort((a, b) => b.section.odIn - a.section.odIn);
  const totalCement = analyses.reduce((sum, analysis) => sum + (analysis.cement?.totalM3 ?? 0), 0);
  const factorCell = (value: number, limit: number) => <span className="sw-wd-sf" data-pass={value >= limit}>{value >= 99 ? "—" : value.toFixed(2)}<span className="sw-asm-sr">{value >= limit ? " passes" : " fails"}</span></span>;
  return <Panel title="Well programme" kicker={`${brief.identity.name || "Untitled well"} · ${brief.identity.purpose}`} testId="wd-programme">
    <dl className="sw-wd-facts is-wide">
      <div><dt>Total depth</dt><dd>{metres(brief.totalDepthMdM)} MD · {metres(tdTvd)} TVD</dd></div>
      <div><dt>Target</dt><dd>{reservoir ? `${reservoir.name} @ ${metres(reservoir.topTvdM)} TVD` : "—"}</dd></div>
      <div><dt>Reservoir pressure</dt><dd>{psi(masp.reservoirPsi)}</dd></div>
      <div><dt>MASP · gas to surface</dt><dd>{psi(masp.maspPsi)}</dd></div>
      <div><dt>Wellhead class</dt><dd>{masp.wellheadRatingPsi ? `API 6A ${masp.wellheadRatingPsi / 1000}K` : "Above 20K"}</dd></div>
    </dl>
    <h3 className="sw-wd-sub">Hole sections</h3>
    <div className="sw-wd-scroll"><table className="sw-wd-table is-programme">
      <thead><tr><th scope="col">Hole</th><th scope="col">Casing</th><th scope="col">Interval <small>m MD</small></th><th scope="col">Shoe <small>m TVD</small></th><th scope="col">Mud <small>SG</small></th><th scope="col">TOC <small>m MD</small></th><th scope="col">Cement <small>m³</small></th><th scope="col">SF <small>B · C · T</small></th></tr></thead>
      <tbody>{order.map(({ section, analysis }) => <tr key={section.id} aria-selected={section.id === selectedId} onClick={() => onSelect?.(section.id)}>
        <td className="is-mono">{section.holeSizeIn}&quot;</td>
        <th scope="row"><CommandButton kind="selection" type="button" className="sw-wd-select" onClick={() => onSelect?.(section.id)}>{section.label}</CommandButton><small>{section.weightLbFt} lb/ft {section.grade}</small></th>
        <td className="is-mono">{Math.round(section.topMdM).toLocaleString("en-US")}–{Math.round(section.shoeMdM).toLocaleString("en-US")}</td>
        <td className="is-mono">{Math.round(analysis.shoeTvdM).toLocaleString("en-US")}</td>
        <td className="is-mono">{section.mudWeightSg.toFixed(2)}</td>
        <td className="is-mono">{section.cement ? Math.round(section.cement.topMdM).toLocaleString("en-US") : "none"}</td>
        <td className="is-mono">{analysis.cement ? analysis.cement.totalM3.toFixed(1) : "—"}</td>
        <td><span className="sw-wd-sfs">{factorCell(analysis.safety.burst, factors.burst)}{factorCell(analysis.safety.collapse, factors.collapse)}{factorCell(analysis.safety.tension, factors.tension)}</span></td>
      </tr>)}</tbody>
      {order.length > 0 && <tfoot><tr><th scope="row" colSpan={6}>Total slurry</th><td className="is-mono">{totalCement.toFixed(1)}</td><td /></tr></tfoot>}
    </table></div>
    {!order.length && <p className="sw-wd-empty-note">No casing strings yet.</p>}
    <h3 className="sw-wd-sub">Completion</h3>
    {completion ? <dl className="sw-wd-facts is-wide">
      <div><dt>Tubing</dt><dd>{formatOd(completion.tubingOdIn)} {completion.tubingWeightLbFt} lb/ft {completion.tubingGrade}</dd></div>
      <div><dt>Packer · safety valve</dt><dd>{metres(completion.packerMdM)} · {completion.sssvMdM ? metres(completion.sssvMdM) : "none"}</dd></div>
      <div><dt>Lift</dt><dd>{lifts.find((lift) => lift.value === completion.artificialLift)?.label ?? completion.artificialLift}</dd></div>
      <div><dt>Perforations</dt><dd>{completion.perforations.length ? completion.perforations.map((interval) => `${Math.round(interval.topMdM)}–${Math.round(interval.bottomMdM)} m`).join(", ") : "none"}</dd></div>
    </dl> : <p className="sw-wd-empty-note">Suspended: no completion string.</p>}
    <h3 className="sw-wd-sub">Engineering checks</h3>
    <IssueList issues={issues} empty="No engineering errors or warnings." onSelectSection={onSelect} />
  </Panel>;
}

/* ------------------------------------------------------------------ readiness */

export interface DesignReadinessPanelProps {
  readonly brief: WellDesignBrief;
  /** Called with the stage to edit when the user follows a missing item. */
  readonly onGoTo?: (stage: DesignStage) => void;
  /** List the engineering checks under the stages. Default true. */
  readonly showChecks?: boolean;
}

/** What a well design needs, stage by stage, why each item matters, and whether this brief provides it. */
export function DesignReadinessPanel({ brief, onGoTo, showChecks = true }: DesignReadinessPanelProps) {
  const readiness = useMemo(() => designReadiness(brief), [brief]);
  const issues = useMemo(() => validateDesign(brief), [brief]);
  const errors = issues.filter((issue) => issue.severity === "error");
  return <Panel title="Design readiness" kicker="What the design needs and why" testId="wd-readiness">
    <div className="sw-wd-progress" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={readiness.percentComplete} aria-label="Design data complete">
      <b>{readiness.percentComplete}%</b><span><i style={{ width: `${readiness.percentComplete}%` }} /></span><small>{readiness.ready ? (errors.length ? `${errors.length} engineering error${errors.length > 1 ? "s" : ""} to resolve` : "Ready to assemble") : `${readiness.requirements.filter((value) => value.status !== "complete").length} item(s) need data or attention`}</small>
    </div>
    <ol className="sw-wd-stages">{designStages.map((stage) => {
      const items = readiness.requirements.filter((value) => value.stage === stage.id);
      const state = items.some((value) => value.status === "missing") ? "missing" : items.some((value) => value.status === "attention") ? "attention" : "complete";
      return <li key={stage.id} data-status={state}>
        <header><strong className="sw-title">{stage.label}<InfoTip label={`Why ${stage.label.toLowerCase()} matters`}>{stage.purpose}</InfoTip></strong>{onGoTo && state !== "complete" && <CommandButton icon="locate" type="button" className="sw-asm-button" onClick={() => onGoTo(stage.id)}>Go to step</CommandButton>}</header>
        <ul>{items.map((item) => <li key={item.id} data-status={item.status}>
          {item.status === "complete" ? <CheckCircle2 size={14} aria-hidden="true" /> : item.status === "attention" ? <AlertTriangle size={14} aria-hidden="true" /> : <XCircle size={14} aria-hidden="true" />}
          <span><b>{item.label}</b><span className="sw-asm-sr"> — {item.status}</span> <em>{item.detail}</em> <InfoTip label={`Why ${item.label.toLowerCase()} is needed`}>{item.why}</InfoTip></span>
        </li>)}</ul>
      </li>;
    })}</ol>
    {showChecks && <><h3 className="sw-wd-sub">Engineering checks</h3>
    <IssueList issues={issues} empty="No engineering errors or warnings." /></>}
  </Panel>;
}

/** What the SDK checked on this brief, what it assumed to do so, and what an engineer must still check. */
export function DesignCoveragePanel({ brief, factors = defaultDesignFactors }: { readonly brief: WellDesignBrief; readonly factors?: DesignFactors }) {
  const coverage = useMemo(() => designCoverage(brief, factors), [brief, factors]);
  const list = (title: string, items: readonly string[], tone: string) => <div className="sw-wd-coverage-group" data-tone={tone}><h3 className="sw-wd-sub">{title} <small>{items.length}</small></h3><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></div>;
  return <Panel title="What was checked" kicker="Screening scope — not a sign-off" testId="wd-coverage">
    {list("Checked", coverage.checked, "ok")}
    {list("Assumed to check it", coverage.assumptions, "warn")}
    {list("Not checked — needs a full casing-design package or an engineer", coverage.notChecked, "bad")}
  </Panel>;
}
