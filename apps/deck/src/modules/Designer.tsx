import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Circle, Download, Plus, Sparkles, Trash2, Wand2, X } from "lucide-react";
import {
  casingTable, designReadiness, designStages, mdAtTvd, planBuildHold, proposeCasingScheme, regradeFailingStrings, standardHoleSize, standardHoleSizes, steelGrades, tubingTable, validateDesign,
} from "@ikhmalputra/subsurface-core";
import type {
  ArtificialLift, BuildHoldInput, CasingSection, CompletionPlan, DepthReference, DesignIssue, DesignStage, Formation, InputSource, PressurePoint, ReservoirFluid, SectionRole, WellDesignBrief, WellEnvironment, WellPurpose,
} from "@ikhmalputra/subsurface-core";
import { formatInches } from "@ikhmalputra/subsurface-react/2d";
import { utmZoneOf } from "@ikhmalputra/subsurface-react";
import { activeDesign, analyse, commitDesign, deleteDesign, exportDesign, factors, useDesign } from "../data/design.ts";
import type { DesignAnalysis, DesignValue } from "../data/design.ts";
import { actions } from "../deck/store.ts";
import { fmt } from "../format.ts";
import { NumberField, Segmented, SelectField, TextField } from "./fields.tsx";

/**
 * The Well designer: a planned well, stage by stage — who and where, the depth reference, geology
 * and pressures, the trajectory, casing, cement and completion. Every field is one named, undoable
 * step (⌘Z), and every other module redraws from it as it changes. What each stage still needs comes
 * from the core's readiness checks; the casing can be proposed from the pressures and then edited
 * string by string, each string checked live for burst, collapse, tension and kick tolerance.
 */

const setBrief = (label: string, change: (brief: WellDesignBrief) => WellDesignBrief) => commitDesign(label, (value) => ({ ...value, brief: change(value.brief) }));
const STAGE_ICON = { complete: Check, attention: AlertTriangle, missing: Circle } as const;

export function Designer() {
  const value = useDesign();
  const brief = value.brief;
  const readiness = useMemo(() => designReadiness(brief), [brief]);
  const analysis = useMemo(() => analyse(brief), [brief]);
  const issues = useMemo(() => validateDesign(brief, factors), [brief]);
  const statusOf = (stage: DesignStage) => {
    const list = readiness.requirements.filter((requirement) => requirement.stage === stage);
    return list.some((requirement) => requirement.status === "missing") ? "missing" : list.some((requirement) => requirement.status === "attention") ? "attention" : "complete";
  };
  const [stage, setStage] = useState<DesignStage>(() => designStages.find((entry) => statusOf(entry.id) !== "complete")?.id ?? "identity");
  const record = activeDesign();
  // A different well on the deck starts the designer at its first unfinished stage.
  const [shownFor, setShownFor] = useState(record.id);
  if (shownFor !== record.id) { setShownFor(record.id); setStage(designStages.find((entry) => statusOf(entry.id) !== "complete")?.id ?? "identity"); }
  const index = designStages.findIndex((entry) => entry.id === stage);
  const current = designStages[index]!;
  const next = designStages[index + 1];
  const [confirmDelete, setConfirmDelete] = useState(false);

  const download = () => {
    const blob = new Blob([exportDesign(record)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${(brief.identity.name || "well").replace(/[^\w.-]+/g, "_")}.design.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  return <div className="dsg">
    <header className="dsg-head">
      <div className="dsg-title">
        <b>{brief.identity.name || "Unnamed well"}</b>
        <small>Planned well{record.builtIn ? " · the deck's example" : ""} · {readiness.percentComplete}% ready{readiness.ready ? " · every check passes" : ""}</small>
        <span className="dsg-meter" aria-hidden="true"><i style={{ width: `${readiness.percentComplete}%` }} /></span>
      </div>
      <button type="button" className="dsg-tool" onClick={download} title="Download this design as a .json file (import it with + New well)"><Download size={14} />Export</button>
      {!record.builtIn && (confirmDelete
        ? <span className="dsg-confirm">Delete it?<button type="button" className="is-danger" onClick={() => { deleteDesign(record.id); actions.selectSite(null); }}>Delete</button><button type="button" onClick={() => setConfirmDelete(false)}>Keep</button></span>
        : <button type="button" className="dsg-tool" onClick={() => setConfirmDelete(true)} aria-label="Delete this design"><Trash2 size={14} /></button>)}
    </header>
    <div className="dsg-body">
      <nav className="dsg-rail" aria-label="Design stages">
        {designStages.map((entry, position) => {
          const status = statusOf(entry.id);
          const Icon = STAGE_ICON[status];
          return <button key={entry.id} type="button" className={`dsg-step is-${status}`} aria-current={entry.id === stage ? "step" : undefined} onClick={() => setStage(entry.id)}>
            <span className="dsg-step-n">{status === "complete" ? <Icon size={12} strokeWidth={3} /> : position + 1}</span><span className="dsg-step-label">{entry.label}</span>{status === "attention" && <Icon size={12} className="dsg-step-warn" />}
          </button>;
        })}
      </nav>
      <section className="dsg-stage" aria-labelledby="dsg-stage-title">
        <h3 id="dsg-stage-title">{current.label}</h3>
        <p className="dsg-purpose">{current.purpose}</p>
        {stage === "identity" && <Identity brief={brief} />}
        {stage === "location" && <Location brief={brief} />}
        {stage === "datum" && <Datum brief={brief} />}
        {stage === "geology" && <Geology brief={brief} />}
        {stage === "trajectory" && <Trajectory value={value} />}
        {stage === "casing" && <Casing brief={brief} analysis={analysis} />}
        {stage === "cement" && <Cement brief={brief} analysis={analysis} />}
        {stage === "completion" && <Completion brief={brief} />}
        <Needs stage={stage} readiness={readiness} issues={issues} />
        {next && <button type="button" className="dsg-next" onClick={() => setStage(next.id)}>Next: {next.label}<ArrowRight size={14} /></button>}
      </section>
    </div>
  </div>;
}

/** What this stage still needs, from the core's readiness checks and design issues. */
function Needs({ stage, readiness, issues }: { readonly stage: DesignStage; readonly readiness: ReturnType<typeof designReadiness>; readonly issues: readonly DesignIssue[] }) {
  const requirements = readiness.requirements.filter((requirement) => requirement.stage === stage);
  const own = issues.filter((issue) => issue.stage === stage && issue.severity !== "info");
  return <div className="dsg-needs">
    <h4>Checks</h4>
    <ul>
      {requirements.map((requirement) => {
        const Icon = STAGE_ICON[requirement.status];
        return <li key={requirement.id} className={`is-${requirement.status}`} title={requirement.why}><Icon size={13} aria-hidden="true" /><span><b>{requirement.label}</b> {requirement.detail}</span></li>;
      })}
      {own.map((issue, position) => <li key={`${issue.code}-${position}`} className={issue.severity === "error" ? "is-missing" : "is-attention"}><AlertTriangle size={13} aria-hidden="true" /><span>{issue.message}</span></li>)}
    </ul>
  </div>;
}

const m = (value: number) => `${fmt(value)} m`;
const sg = (value: number) => `${value.toFixed(2)} SG`;

/* ---- stages ---- */

const PURPOSES: readonly WellPurpose[] = ["exploration", "appraisal", "development", "injection", "disposal", "geothermal"];
function Identity({ brief }: { readonly brief: WellDesignBrief }) {
  const id = brief.identity;
  const set = (field: keyof typeof id, label: string) => (next: string) => setBrief(`${label} → ${next || "blank"}`, (b) => ({ ...b, identity: { ...b.identity, [field]: next } }));
  return <div className="dsg-grid">
    <TextField label="Well name" value={id.name} onCommit={set("name", "Name")} wide />
    <TextField label="Field" value={id.field} onCommit={set("field", "Field")} />
    <TextField label="Operator" value={id.operator} onCommit={set("operator", "Operator")} />
    <TextField label="Country" value={id.country} onCommit={set("country", "Country")} />
    <TextField label="UWI / API (optional)" value={id.uwi ?? ""} onCommit={set("uwi", "UWI")} />
    <SelectField label="Purpose" value={id.purpose} options={PURPOSES.map((purpose) => ({ value: purpose, label: purpose[0]!.toUpperCase() + purpose.slice(1) }))} onCommit={(purpose) => setBrief(`Purpose → ${purpose}`, (b) => ({ ...b, identity: { ...b.identity, purpose } }))} />
  </div>;
}

const ENVIRONMENTS: readonly { readonly value: WellEnvironment; readonly label: string }[] = [{ value: "onshore", label: "Onshore" }, { value: "offshore-platform", label: "Offshore platform" }, { value: "offshore-subsea", label: "Subsea" }];
function Location({ brief }: { readonly brief: WellDesignBrief }) {
  const location = brief.location;
  const offshore = location.environment !== "onshore";
  const setLoc = (label: string, change: Partial<WellDesignBrief["location"]>) => setBrief(label, (b) => ({ ...b, location: { ...b.location, ...change } }));
  return <>
    <Segmented label="Environment" value={location.environment} options={ENVIRONMENTS} onChange={(environment) => setLoc(`Environment → ${environment}`, { environment, ...(environment === "onshore" ? { waterDepthM: null } : { groundElevationM: null }) })} />
    <div className="dsg-grid">
      <NumberField label="Latitude" unit="°" value={location.latitude} min={-84} max={84} onCommit={(value) => setLoc(`Latitude → ${value}°`, { latitude: value })} hint="WGS 84; south is negative" />
      <NumberField label="Longitude" unit="°" value={location.longitude} min={-180} max={180} onCommit={(value) => setLoc(`Longitude → ${value}°`, { longitude: value })} hint="West is negative" />
      {offshore
        ? <NumberField label="Water depth" unit="m" value={location.waterDepthM} min={1} optional onCommit={(value) => setLoc(`Water depth → ${value ?? "not set"} m`, { waterDepthM: value })} />
        : <NumberField label="Ground elevation" unit="m" value={location.groundElevationM} optional onCommit={(value) => setLoc(`Ground elevation → ${value ?? "not set"} m`, { groundElevationM: value })} hint="Above mean sea level" />}
    </div>
    {location.latitude !== null && location.longitude !== null && <p className="dsg-note">Plans are drawn in {utmZoneOf(location.longitude, location.latitude).replace("EPSG:326", "WGS 84 / UTM ").replace("EPSG:327", "WGS 84 / UTM ")}{location.latitude >= 0 ? "N" : "S"}, the zone the wellhead falls in.</p>}
  </>;
}

const REFERENCES: readonly { readonly value: DepthReference; readonly label: string }[] = [{ value: "RKB", label: "RKB (rotary kelly bushing)" }, { value: "DF", label: "DF (drill floor)" }, { value: "GL", label: "GL (ground level)" }, { value: "MSL", label: "MSL (mean sea level)" }];
function Datum({ brief }: { readonly brief: WellDesignBrief }) {
  const datum = brief.datum;
  const offshore = brief.location.environment !== "onshore";
  const above = datum.elevationAboveMslM === null ? null : offshore ? datum.elevationAboveMslM : brief.location.groundElevationM === null ? null : datum.elevationAboveMslM - brief.location.groundElevationM;
  return <>
    <div className="dsg-grid">
      <SelectField label="Depth reference" value={datum.reference} options={REFERENCES} onCommit={(reference) => setBrief(`Depth reference → ${reference}`, (b) => ({ ...b, datum: { ...b.datum, reference } }))} wide />
      <NumberField label={`${datum.reference} elevation`} unit="m above MSL" value={datum.elevationAboveMslM} optional onCommit={(value) => setBrief(`${datum.reference} elevation → ${value ?? "not set"} m`, (b) => ({ ...b, datum: { ...b.datum, elevationAboveMslM: value } }))} />
    </div>
    <p className="dsg-note">{above === null ? `Every MD and TVD is measured down from the ${datum.reference}.` : `The ${datum.reference} is ${fmt(above, 1)} m above the ${offshore ? "sea" : "ground"}; every MD and TVD is measured down from it.`}</p>
  </>;
}

const SOURCES: readonly { readonly value: InputSource; readonly label: string }[] = [{ value: "measured", label: "Measured" }, { value: "offset", label: "Offset well" }, { value: "estimated", label: "Estimated" }, { value: "assumed", label: "Assumed" }];
const FLUIDS: readonly ReservoirFluid[] = ["oil", "gas", "condensate", "water", "geothermal", "co2"];
function Geology({ brief }: { readonly brief: WellDesignBrief }) {
  const geology = brief.geology;
  const setGeo = (label: string, change: (g: WellDesignBrief["geology"]) => WellDesignBrief["geology"]) => setBrief(label, (b) => ({ ...b, geology: change(b.geology) }));
  const setFormation = (index: number, label: string, change: Partial<Formation>) => setGeo(label, (g) => ({ ...g, formations: g.formations.map((formation, position) => position === index ? { ...formation, ...change } : formation).sort((a, b) => a.topTvdM - b.topTvdM) }));
  const setPoint = (index: number, label: string, change: Partial<PressurePoint>) => setGeo(label, (g) => ({ ...g, pressures: g.pressures.map((point, position) => position === index ? { ...point, ...change } : point).sort((a, b) => a.tvdM - b.tvdM) }));
  const lastFormation = geology.formations.at(-1), lastPoint = geology.pressures.at(-1);
  const fluids = brief.fluids ?? null;
  return <>
    <h5>Formation tops <small>TVD below the {brief.datum.reference}</small></h5>
    <div className="dsg-rows">
      {geology.formations.map((formation, index) => <div key={index} className="dsg-row">
        <TextField label="Name" value={formation.name} onCommit={(name) => setFormation(index, `Formation ${index + 1} name → ${name}`, { name })} />
        <NumberField label="Top" unit="m TVD" value={formation.topTvdM} min={0} onCommit={(value) => setFormation(index, `${formation.name} top → ${value} m TVD`, { topTvdM: value! })} />
        <TextField label="Lithology" value={formation.lithology} onCommit={(lithology) => setFormation(index, `${formation.name} lithology → ${lithology}`, { lithology })} />
        <TextField label="Hazard" value={formation.hazard ?? ""} placeholder="none" onCommit={(hazard) => setFormation(index, `${formation.name} hazard → ${hazard || "none"}`, { hazard: hazard || undefined })} />
        <label className="dsg-check"><input type="checkbox" checked={!!formation.reservoir} onChange={(event) => setFormation(index, `${formation.name} ${event.target.checked ? "is" : "is not"} the reservoir`, { reservoir: event.target.checked || undefined })} />Reservoir</label>
        <button type="button" className="dsg-remove" aria-label={`Remove ${formation.name}`} onClick={() => setGeo(`Remove formation ${formation.name}`, (g) => ({ ...g, formations: g.formations.filter((_, position) => position !== index) }))}><X size={14} /></button>
      </div>)}
    </div>
    <button type="button" className="dsg-add" onClick={() => setGeo("Add a formation", (g) => ({ ...g, formations: [...g.formations, { name: `Formation ${g.formations.length + 1}`, topTvdM: lastFormation ? lastFormation.topTvdM + 300 : 0, lithology: "" }] }))}><Plus size={14} />Add a formation</button>

    <h5>Pore pressure and fracture gradient <small>equivalent SG at a TVD</small></h5>
    <div className="dsg-rows">
      {geology.pressures.map((point, index) => <div key={index} className="dsg-row">
        <NumberField label="TVD" unit="m" value={point.tvdM} min={0} onCommit={(value) => setPoint(index, `Pressure point ${index + 1} → ${value} m TVD`, { tvdM: value! })} />
        <NumberField label="Pore" unit="SG" value={point.porePressureSg} min={0.8} max={2.6} onCommit={(value) => setPoint(index, `Pore pressure at ${fmt(point.tvdM)} m → ${value} SG`, { porePressureSg: value! })} />
        <NumberField label="Fracture" unit="SG" value={point.fractureGradientSg} min={0.8} max={3} onCommit={(value) => setPoint(index, `Fracture gradient at ${fmt(point.tvdM)} m → ${value} SG`, { fractureGradientSg: value! })} />
        <SelectField label="From" value={point.poreSource ?? "assumed"} options={SOURCES} onCommit={(source) => setPoint(index, `Pressures at ${fmt(point.tvdM)} m from ${source}`, { poreSource: source, fractureSource: source })} />
        <TextField label="Evidence" value={point.note ?? ""} placeholder="e.g. FIT 1.62 SG, offset A-3" onCommit={(note) => setPoint(index, `Evidence at ${fmt(point.tvdM)} m`, { note: note || undefined })} />
        <button type="button" className="dsg-remove" aria-label={`Remove the point at ${fmt(point.tvdM)} m`} onClick={() => setGeo(`Remove the pressure point at ${fmt(point.tvdM)} m`, (g) => ({ ...g, pressures: g.pressures.filter((_, position) => position !== index) }))}><X size={14} /></button>
      </div>)}
    </div>
    <button type="button" className="dsg-add" onClick={() => setGeo("Add a pressure point", (g) => ({ ...g, pressures: [...g.pressures, lastPoint ? { ...lastPoint, tvdM: lastPoint.tvdM + 500, note: undefined } : { tvdM: 0, porePressureSg: 1.03, fractureGradientSg: 1.4, poreSource: "assumed", fractureSource: "assumed" }] }))}><Plus size={14} />Add a pressure point</button>
    {geology.pressures.length > 0 && <button type="button" className="dsg-link" onClick={() => actions.open("window")}>See them as a pressure window</button>}

    <h5>Temperature</h5>
    <div className="dsg-grid">
      <NumberField label="At surface" unit="°C" value={geology.surfaceTemperatureC} onCommit={(value) => setGeo(`Surface temperature → ${value} °C`, (g) => ({ ...g, surfaceTemperatureC: value! }))} />
      <NumberField label="Gradient" unit="°C/km" value={geology.geothermalGradientCPerKm} min={0} max={150} onCommit={(value) => setGeo(`Geothermal gradient → ${value} °C/km`, (g) => ({ ...g, geothermalGradientCPerKm: value! }))} />
      <SelectField label="From" value={geology.temperatureSource ?? "assumed"} options={SOURCES} onCommit={(temperatureSource) => setGeo(`Temperature from ${temperatureSource}`, (g) => ({ ...g, temperatureSource }))} />
    </div>

    <h5>Reservoir fluid</h5>
    <div className="dsg-grid">
      <SelectField label="Fluid" value={fluids?.type ?? "none"} options={[{ value: "none", label: "Not known yet" }, ...FLUIDS.map((fluid) => ({ value: fluid, label: fluid === "co2" ? "CO₂" : fluid[0]!.toUpperCase() + fluid.slice(1) }))]}
        onCommit={(type) => setBrief(`Reservoir fluid → ${type}`, (b) => ({ ...b, fluids: type === "none" ? null : { type: type as ReservoirFluid, h2sMolPct: b.fluids?.h2sMolPct ?? null, co2MolPct: b.fluids?.co2MolPct ?? null } }))} />
      {fluids && <NumberField label="H₂S" unit="mol %" value={fluids.h2sMolPct} min={0} max={100} optional onCommit={(value) => setBrief(`H₂S → ${value ?? "unknown"} mol %`, (b) => ({ ...b, fluids: { ...b.fluids!, h2sMolPct: value } }))} hint="Empty: not sampled" />}
      {fluids && <NumberField label="CO₂" unit="mol %" value={fluids.co2MolPct} min={0} max={100} optional onCommit={(value) => setBrief(`CO₂ → ${value ?? "unknown"} mol %`, (b) => ({ ...b, fluids: { ...b.fluids!, co2MolPct: value } }))} hint="Empty: not sampled" />}
    </div>
  </>;
}

function Trajectory({ value }: { readonly value: DesignValue }) {
  const brief = value.brief;
  const mode = brief.trajectory === null ? "vertical" : value.buildHold ? "build-hold" : "stations";
  const [error, setError] = useState<string | null>(null);
  const plan = useMemo(() => { try { return value.buildHold ? planBuildHold(value.buildHold) : null; } catch { return null; } }, [value.buildHold]);
  const applyPlan = (label: string, input: BuildHoldInput) => {
    try {
      const next = planBuildHold(input);
      setError(null);
      commitDesign(label, (v) => ({ ...v, buildHold: input, brief: { ...v.brief, trajectory: next.stations, totalDepthMdM: Math.round(next.totalDepthMdM) } }));
    } catch (reason) { setError((reason as Error).message); }
  };
  const defaults: BuildHoldInput = value.buildHold ?? { kickoffMdM: Math.max(300, Math.round(brief.totalDepthMdM * 0.25 / 10) * 10), buildRateDegPer30m: 2, target: { tvdM: Math.round(brief.totalDepthMdM * 0.8 / 10) * 10, northingM: 0, eastingM: 500 }, extensionM: 100 };
  const input = value.buildHold ?? defaults;
  const edit = (label: string, change: Omit<Partial<BuildHoldInput>, "target"> & { target?: Partial<BuildHoldInput["target"]> }) => applyPlan(label, { ...input, ...change, target: { ...input.target, ...change.target } });
  return <>
    <Segmented label="Trajectory" value={mode === "stations" ? "build-hold" : mode} options={[{ value: "vertical", label: "Vertical" }, { value: "build-hold", label: "Build and hold to a target" }]}
      onChange={(next) => next === "vertical" ? commitDesign("Trajectory → vertical", (v) => ({ ...v, buildHold: null, brief: { ...v.brief, trajectory: null } })) : applyPlan("Trajectory → build and hold", defaults)} />
    {mode === "vertical" && <div className="dsg-grid">
      <NumberField label="Total depth" unit="m MD" value={brief.totalDepthMdM} min={50} max={12000} onCommit={(td) => setBrief(`Total depth → ${td} m`, (b) => ({ ...b, totalDepthMdM: td! }))} hint="Vertical: MD and TVD are the same" />
    </div>}
    {mode === "stations" && <p className="dsg-note">{brief.trajectory!.length} survey stations entered by hand. Choosing build and hold replaces them with a plan you can edit.</p>}
    {mode === "build-hold" && <>
      <div className="dsg-grid">
        <NumberField label="Kick-off" unit="m MD" value={input.kickoffMdM} min={0} onCommit={(kickoffMdM) => edit(`Kick-off → ${kickoffMdM} m`, { kickoffMdM: kickoffMdM! })} />
        <NumberField label="Build rate" unit="°/30 m" value={input.buildRateDegPer30m} min={0.1} max={15} onCommit={(rate) => edit(`Build rate → ${rate}°/30 m`, { buildRateDegPer30m: rate! })} />
        <NumberField label="Target TVD" unit="m" value={input.target.tvdM} min={1} onCommit={(tvdM) => edit(`Target → ${tvdM} m TVD`, { target: { tvdM: tvdM! } })} />
        <NumberField label="Target north" unit="m" value={input.target.northingM} onCommit={(northingM) => edit(`Target north → ${northingM} m`, { target: { northingM: northingM! } })} hint="From the wellhead" />
        <NumberField label="Target east" unit="m" value={input.target.eastingM} onCommit={(eastingM) => edit(`Target east → ${eastingM} m`, { target: { eastingM: eastingM! } })} />
        <NumberField label="Drill past the target" unit="m" value={input.extensionM ?? 0} min={0} onCommit={(extensionM) => edit(`Past the target → ${extensionM} m`, { extensionM: extensionM! })} />
      </div>
      {error && <p className="dsg-error-line" role="alert">{error}</p>}
      {plan && <dl className="dsg-facts">
        <div><dt>Hold</dt><dd>{fmt(plan.holdInclinationDeg, 1)}° toward {fmt(plan.azimuthDeg, 0)}°</dd></div>
        <div><dt>End of build</dt><dd>{m(plan.endOfBuildMdM)} MD · {m(plan.endOfBuildTvdM)} TVD</dd></div>
        <div><dt>Target reached</dt><dd>{m(plan.targetMdM)} MD · {m(plan.targetDisplacementM)} away</dd></div>
        <div><dt>Total depth</dt><dd>{m(plan.totalDepthMdM)} MD</dd></div>
      </dl>}
    </>}
  </>;
}

const ROLES: readonly SectionRole[] = ["conductor", "surface", "intermediate", "production", "liner", "tieback"];
const ODS = [...new Set(casingTable.map((pipe) => pipe.odIn))];
const GRADES = Object.keys(steelGrades);
const HOLES = [...new Set([...Object.values(standardHoleSizes), 8.75, 6.125])].sort((a, b) => b - a);
const ROLE_COLOUR: Readonly<Record<SectionRole, string>> = { conductor: "#8b95ad", surface: "#2bb39a", intermediate: "#4f7cf0", production: "#d9603b", liner: "#c9a227", tieback: "#c9a227" };

function Casing({ brief, analysis }: { readonly brief: WellDesignBrief; readonly analysis: DesignAnalysis }) {
  const pressures = brief.geology.pressures.length >= 2;
  const [replacing, setReplacing] = useState(false);
  const failing = analysis.failing.length;
  const setSection = (id: string, label: string, change: (section: CasingSection) => CasingSection) => setBrief(label, (b) => ({ ...b, sections: b.sections.map((section) => section.id === id ? change(section) : section) }));
  const propose = () => { setReplacing(false); setBrief("Propose casing from the pressures", (b) => ({ ...b, sections: proposeCasingScheme(b) })); };
  const add = () => setBrief("Add a casing string", (b) => {
    const deepest = [...b.sections].sort((x, y) => y.shoeMdM - x.shoeMdM)[0];
    const odIn = deepest ? ODS.find((od) => od < deepest.odIn) ?? deepest.odIn : 9.625;
    const pipe = casingTable.find((entry) => entry.odIn === odIn)!;
    const shoeMdM = Math.min(b.totalDepthMdM, Math.round(((deepest?.shoeMdM ?? 0) + 500) / 10) * 10);
    const id = `string-${Date.now().toString(36)}`;
    return { ...b, sections: [...b.sections, { id, role: deepest ? "intermediate" : "surface", label: `${formatInches(odIn).replace("″", '"')} casing`, holeSizeIn: standardHoleSize(odIn), odIn, weightLbFt: pipe.weightLbFt, grade: "L80", topMdM: 0, shoeMdM, mudWeightSg: 1.1, cement: { topMdM: Math.max(0, shoeMdM - 300), leadDensitySg: 1.5, tailDensitySg: 1.9, tailLengthM: 150, excessPct: 30 } }] };
  });
  return <>
    <div className="dsg-actions">
      {replacing
        ? <span className="dsg-confirm">Replace the {brief.sections.length} strings with a proposal?<button type="button" className="is-primary" onClick={propose}>Replace</button><button type="button" onClick={() => setReplacing(false)}>Keep mine</button></span>
        : <button type="button" className="dsg-primary" disabled={!pressures} title={pressures ? "Set shoes bottom-up from the pore and fracture window, then size and grade each string" : "Needs at least two pressure points: add them in Geology & pressures"} onClick={() => brief.sections.length ? setReplacing(true) : propose()}><Wand2 size={14} />Propose from the pressures</button>}
      <button type="button" className="dsg-secondary" disabled={!failing} onClick={() => { const result = regradeFailingStrings(brief, factors); setBrief(`Regrade ${result.changes.length} failing string${result.changes.length === 1 ? "" : "s"}`, () => result.brief); }} title="Re-pick weight and grade for strings below the design factors"><Sparkles size={14} />Regrade failing{failing ? ` (${failing})` : ""}</button>
      <button type="button" className="dsg-secondary" onClick={add}><Plus size={14} />Add a string</button>
    </div>
    {!pressures && !brief.sections.length && <p className="dsg-note">Add pore and fracture pressures first (Geology & pressures) and the designer can propose the shoes and pipe for you; or add strings by hand.</p>}
    <div className="dsg-cards">
      {brief.sections.map((section, index) => {
        const result = analysis.sections[index];
        const weights = casingTable.filter((pipe) => pipe.odIn === section.odIn).map((pipe) => pipe.weightLbFt);
        const own = result?.issues.filter((issue) => issue.stage === "casing" && issue.severity !== "info") ?? [];
        const sf = (name: "burst" | "collapse" | "tension") => result ? <span className={`dsg-sf ${result.safety[name] >= factors[name] ? "is-ok" : "is-fail"}`} title={`Design factor ${factors[name]}`}>{name[0]!.toUpperCase()} {Number.isFinite(result.safety[name]) ? result.safety[name].toFixed(2) : "∞"}</span> : null;
        return <article key={section.id} className={`dsg-card${result && !result.passes ? " is-failing" : ""}`}>
          <header><i style={{ background: ROLE_COLOUR[section.role] }} /><b>{section.label}</b>
            <span className="dsg-sfs">{sf("burst")}{sf("collapse")}{sf("tension")}{result?.kickTolerance && <span className={`dsg-sf ${result.kickTolerance.volumeM3 >= result.kickTolerance.requiredM3 ? "is-ok" : "is-fail"}`} title="Kick tolerance at this shoe">KT {fmt(result.kickTolerance.volumeBbl)} bbl</span>}</span>
            <button type="button" className="dsg-remove" aria-label={`Remove ${section.label}`} onClick={() => setBrief(`Remove ${section.label}`, (b) => ({ ...b, sections: b.sections.filter((entry) => entry.id !== section.id) }))}><X size={14} /></button>
          </header>
          <div className="dsg-grid">
            <TextField label="Name" value={section.label} onCommit={(label) => setSection(section.id, `Rename ${section.label} → ${label}`, (s) => ({ ...s, label }))} />
            <SelectField label="Role" value={section.role} options={ROLES.map((role) => ({ value: role, label: role[0]!.toUpperCase() + role.slice(1) }))} onCommit={(role) => setSection(section.id, `${section.label} role → ${role}`, (s) => ({ ...s, role }))} />
            <SelectField label="Casing OD" value={section.odIn} options={ODS.map((od) => ({ value: od, label: formatInches(od) }))} onCommit={(odIn) => setSection(section.id, `${section.label} OD → ${formatInches(odIn)}`, (s) => ({ ...s, odIn, weightLbFt: casingTable.find((pipe) => pipe.odIn === odIn)!.weightLbFt, holeSizeIn: standardHoleSize(odIn) }))} />
            <SelectField label="Weight" value={section.weightLbFt} options={weights.map((weight) => ({ value: weight, label: `${weight} lb/ft` }))} onCommit={(weightLbFt) => setSection(section.id, `${section.label} weight → ${weightLbFt} lb/ft`, (s) => ({ ...s, weightLbFt }))} />
            <SelectField label="Grade" value={section.grade} options={GRADES.map((grade) => ({ value: grade, label: grade }))} onCommit={(grade) => setSection(section.id, `${section.label} grade → ${grade}`, (s) => ({ ...s, grade }))} />
            <SelectField label="Hole" value={section.holeSizeIn} options={[...new Set([section.holeSizeIn, ...HOLES])].sort((a, b) => b - a).map((hole) => ({ value: hole, label: formatInches(hole) }))} onCommit={(holeSizeIn) => setSection(section.id, `${section.label} hole → ${formatInches(holeSizeIn)}`, (s) => ({ ...s, holeSizeIn }))} />
            <NumberField label="Top" unit="m MD" value={section.topMdM} min={0} onCommit={(topMdM) => setSection(section.id, `${section.label} top → ${topMdM} m`, (s) => ({ ...s, topMdM: topMdM! }))} />
            <NumberField label="Shoe" unit="m MD" value={section.shoeMdM} min={1} max={brief.totalDepthMdM} onCommit={(shoeMdM) => setSection(section.id, `${section.label} shoe → ${shoeMdM} m`, (s) => ({ ...s, shoeMdM: shoeMdM! }))} />
            <NumberField label="Mud to drill it" unit="SG" value={section.mudWeightSg} min={0.8} max={2.6} onCommit={(mud) => setSection(section.id, `${section.label} mud → ${mud} SG`, (s) => ({ ...s, mudWeightSg: mud! }))} hint={result ? `Window ${result.mudWindow.minimumSg.toFixed(2)}–${result.mudWindow.maximumSg.toFixed(2)} SG` : undefined} />
          </div>
          {own.length > 0 && <ul className="dsg-issues">{own.map((issue, position) => <li key={position} className={`is-${issue.severity}`}>{issue.message}</li>)}</ul>}
        </article>;
      })}
    </div>
  </>;
}

function Cement({ brief, analysis }: { readonly brief: WellDesignBrief; readonly analysis: DesignAnalysis }) {
  if (!brief.sections.length) return <p className="dsg-note">No casing yet: cement is planned per string, once the strings exist (Casing).</p>;
  const setPlan = (section: CasingSection, label: string, plan: CasingSection["cement"]) => setBrief(label, (b) => ({ ...b, sections: b.sections.map((entry) => entry.id === section.id ? { ...entry, cement: plan } : entry) }));
  return <div className="dsg-cards">
    {brief.sections.map((section, index) => {
      const plan = section.cement;
      const volumes = analysis.sections[index]?.cement ?? null;
      const own = analysis.sections[index]?.issues.filter((issue) => issue.stage === "cement" && issue.severity !== "info") ?? [];
      const set = (field: keyof NonNullable<CasingSection["cement"]>, name: string, unit: string) => (next: number | null) => setPlan(section, `${section.label} ${name} → ${next} ${unit}`, { ...plan!, [field]: next! });
      return <article key={section.id} className="dsg-card">
        <header><i style={{ background: ROLE_COLOUR[section.role] }} /><b>{section.label}</b>
          <span className="dsg-sfs">{volumes && <span className={`dsg-sf ${volumes.equivalentSgAtShoe <= volumes.fractureSgAtShoe ? "is-ok" : "is-fail"}`} title="Equivalent density at the shoe against the fracture gradient">{sg(volumes.equivalentSgAtShoe)} vs {sg(volumes.fractureSgAtShoe)}</span>}{volumes && <span className="dsg-sf">{fmt(volumes.totalBbl)} bbl</span>}</span>
          <label className="dsg-check"><input type="checkbox" checked={!!plan} onChange={(event) => setPlan(section, `${section.label} ${event.target.checked ? "cemented" : "not cemented"}`, event.target.checked ? { topMdM: Math.max(0, section.shoeMdM - 300), leadDensitySg: 1.5, tailDensitySg: 1.9, tailLengthM: Math.min(150, section.shoeMdM), excessPct: 30 } : null)} />Cemented</label>
        </header>
        {plan && <div className="dsg-grid">
          <NumberField label="Top of cement" unit="m MD" value={plan.topMdM} min={0} max={section.shoeMdM} onCommit={set("topMdM", "top of cement", "m")} />
          <NumberField label="Lead" unit="SG" value={plan.leadDensitySg} min={1} max={2.4} onCommit={set("leadDensitySg", "lead slurry", "SG")} />
          <NumberField label="Tail" unit="SG" value={plan.tailDensitySg} min={1} max={2.4} onCommit={set("tailDensitySg", "tail slurry", "SG")} />
          <NumberField label="Tail length" unit="m" value={plan.tailLengthM} min={0} onCommit={set("tailLengthM", "tail length", "m")} />
          <NumberField label="Open-hole excess" unit="%" value={plan.excessPct} min={0} max={300} onCommit={set("excessPct", "excess", "%")} />
        </div>}
        {own.length > 0 && <ul className="dsg-issues">{own.map((issue, position) => <li key={position} className={`is-${issue.severity}`}>{issue.message}</li>)}</ul>}
      </article>;
    })}
  </div>;
}

const LIFTS: readonly { readonly value: ArtificialLift; readonly label: string }[] = [{ value: "none", label: "Natural flow" }, { value: "gas-lift", label: "Gas lift" }, { value: "esp", label: "ESP" }, { value: "rod-pump", label: "Rod pump" }, { value: "pcp", label: "PCP" }, { value: "jet-pump", label: "Jet pump" }];
function Completion({ brief }: { readonly brief: WellDesignBrief }) {
  const completion = brief.completion;
  const production = [...brief.sections].sort((a, b) => a.odIn - b.odIn)[0];
  const set = (label: string, change: Partial<CompletionPlan>) => setBrief(label, (b) => ({ ...b, completion: { ...b.completion!, ...change } }));
  const start = () => setBrief("Start a completion", (b) => {
    const reservoir = b.geology.formations.find((formation) => formation.reservoir);
    const bottom = Math.min(b.totalDepthMdM, production?.shoeMdM ?? b.totalDepthMdM) - 10;
    const top = reservoir ? Math.min(bottom - 10, Math.round(mdAtTvd(b, reservoir.topTvdM))) : bottom - 30;
    const offshore = b.location.environment !== "onshore";
    return { ...b, completion: { tubingOdIn: 3.5, tubingWeightLbFt: 9.3, tubingGrade: "L80", packerMdM: Math.max(10, Math.round((top - 60) / 10) * 10), sssvMdM: offshore ? 250 : null, perforations: top < bottom ? [{ topMdM: Math.round(top), bottomMdM: Math.round(bottom) }] : [], artificialLift: "none" } };
  });
  if (!completion) return <>
    <p className="dsg-note">No completion yet. Starting one fills in a 3½″ tubing, a packer above the reservoir{brief.location.environment !== "onshore" ? ", a safety valve at 250 m" : ""} and perforations across the reservoir: defaults you then edit.</p>
    <button type="button" className="dsg-primary" onClick={start} disabled={!production} title={production ? undefined : "Needs casing first"}><Plus size={14} />Start a completion</button>
  </>;
  return <>
    <div className="dsg-grid">
      <SelectField label="Tubing" value={`${completion.tubingOdIn}|${completion.tubingWeightLbFt}`} options={tubingTable.map((pipe) => ({ value: `${pipe.odIn}|${pipe.weightLbFt}`, label: `${formatInches(pipe.odIn)} ${pipe.weightLbFt} lb/ft` }))}
        onCommit={(pick) => { const [od, weight] = pick.split("|").map(Number); set(`Tubing → ${formatInches(od!)} ${weight} lb/ft`, { tubingOdIn: od!, tubingWeightLbFt: weight! }); }} />
      <SelectField label="Tubing grade" value={completion.tubingGrade} options={GRADES.map((grade) => ({ value: grade, label: grade }))} onCommit={(tubingGrade) => set(`Tubing grade → ${tubingGrade}`, { tubingGrade })} />
      <NumberField label="Packer" unit="m MD" value={completion.packerMdM} min={1} onCommit={(packerMdM) => set(`Packer → ${packerMdM} m`, { packerMdM: packerMdM! })} />
      <NumberField label="Safety valve" unit="m MD" value={completion.sssvMdM} min={1} optional onCommit={(sssvMdM) => set(`Safety valve → ${sssvMdM ?? "none"}`, { sssvMdM })} hint="Empty: none" />
      <SelectField label="Lift" value={completion.artificialLift} options={LIFTS} onCommit={(artificialLift) => set(`Lift → ${artificialLift}`, { artificialLift, ...(artificialLift === "gas-lift" ? { gasLiftMandrels: completion.gasLiftMandrels ?? 3 } : {}) })} />
      {completion.artificialLift === "gas-lift" && <NumberField label="Gas-lift mandrels" value={completion.gasLiftMandrels ?? 0} min={0} max={12} step={1} onCommit={(count) => set(`Gas-lift mandrels → ${count}`, { gasLiftMandrels: Math.round(count!) })} />}
      <NumberField label="Packer fluid" unit="SG" value={completion.packerFluidSg ?? null} min={0.8} max={2.2} optional onCommit={(fluid) => set(`Packer fluid → ${fluid ?? "the mud"}`, { packerFluidSg: fluid ?? undefined })} hint="Empty: the production mud" />
    </div>
    <h5>Perforations</h5>
    <div className="dsg-rows">
      {completion.perforations.map((interval, index) => <div key={index} className="dsg-row">
        <NumberField label="From" unit="m MD" value={interval.topMdM} min={0} onCommit={(topMdM) => set(`Perforations ${index + 1} from ${topMdM} m`, { perforations: completion.perforations.map((entry, position) => position === index ? { ...entry, topMdM: topMdM! } : entry) })} />
        <NumberField label="To" unit="m MD" value={interval.bottomMdM} min={0} onCommit={(bottomMdM) => set(`Perforations ${index + 1} to ${bottomMdM} m`, { perforations: completion.perforations.map((entry, position) => position === index ? { ...entry, bottomMdM: bottomMdM! } : entry) })} />
        <button type="button" className="dsg-remove" aria-label="Remove this interval" onClick={() => set("Remove a perforated interval", { perforations: completion.perforations.filter((_, position) => position !== index) })}><X size={14} /></button>
      </div>)}
    </div>
    <div className="dsg-actions">
      <button type="button" className="dsg-add" onClick={() => { const last = completion.perforations.at(-1); set("Add a perforated interval", { perforations: [...completion.perforations, last ? { topMdM: last.bottomMdM + 10, bottomMdM: last.bottomMdM + 30 } : { topMdM: completion.packerMdM + 50, bottomMdM: completion.packerMdM + 80 }] }); }}><Plus size={14} />Add an interval</button>
      <button type="button" className="dsg-link" onClick={() => setBrief("Remove the completion", (b) => ({ ...b, completion: null }))}>Remove the completion</button>
    </div>
  </>;
}
