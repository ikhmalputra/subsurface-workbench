import type { ProjectWell } from "./project";
import { wellCapabilities } from "./project";

/**
 * The tool registry: every object of the well and the verbs that act on it.
 *
 * This is the AutoCAD model from docs/WELL_TOOLS_STUDY.md. A tool is `verb object`. Opening one
 * opens the panel that holds that object's data for the active well — and says, before it does,
 * whether the host has supplied that data at all. Nothing here reads or writes data; it names
 * what exists, what the host owns, and which panel does the work.
 */
export type ToolVerb = "view" | "create" | "edit" | "delete";
export const toolVerbs: readonly ToolVerb[] = ["view", "create", "edit", "delete"];

/** The panels tools open. Route workspaces become panels on the sheet; the rest already are. */
export type ToolPanelId = "section" | "report" | "field" | "correlation" | "cross-section" | "petrophysics" | "production" | "linked-data" | "sandbox" | "inspector" | "well-file" | "kick" | "cement" | "time" | "hydraulics" | "planner" | "stations" | "survey-summary" | "study" | "evidence" | "construction" | "well-properties" | "component-records" | "formations" | "records-data" | "field-register" | "field-trajectory" | "design" | "scene-options";

/**
 * Documents: the workspaces that fill the sheet. One is open at a time, like the active drawing;
 * opening another puts the current one away. Each had a route of its own; the route now forwards
 * to the sheet with `?tool=<document>`, which is also the deep link.
 */
export const documents: readonly ToolPanelId[] = ["section", "report", "field", "correlation", "cross-section", "petrophysics", "production", "linked-data", "sandbox"];
export const documentLabels: Readonly<Record<string, string>> = {
  section: "Well section", trajectory: "Survey", study: "Drilling study", evidence: "Study evidence", planner: "Trajectory planner", stations: "Station editor", "survey-summary": "Survey summary", brief: "Design brief", report: "Well report", field: "Field",
  correlation: "Correlation", "cross-section": "Cross-section", "edit-well": "Edit well", construction: "Construction", "well-properties": "Well properties", "component-records": "Component records", formations: "Formations", "records-data": "Records & data", "field-register": "Well register", "field-trajectory": "Field trajectory", design: "Design brief", "scene-options": "Volume & interpretation tools", petrophysics: "Petrophysics", production: "Production", "linked-data": "Linked data", sandbox: "WebGPU sandbox",
};
/** The route each document used to be, for the forwarders and for anything still linking there. */
export const documentRoutes: Readonly<Record<string, string>> = {
  section: "/view-well/", trajectory: "/trajectory/", study: "/analysis/", brief: "/builder/", report: "/well-report/", field: "/map/",
  correlation: "/correlation/", "cross-section": "/cross-section/", "edit-well": "/edit-well/", petrophysics: "/petrophysics/", production: "/production/", "linked-data": "/linked-data/", sandbox: "/sandbox/",
};
export const SHEET = "/view-well/";
/** The sheet URL that opens a document, keeping any query the caller carries (a well, a component). */
export function documentHref(document: ToolPanelId | "trajectory" | "edit-well" | "brief", query?: Readonly<Record<string, string | undefined>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && key !== "tool") params.set(key, value);
  if (document !== "section") params.set("tool", document);
  const search = params.toString();
  return search ? `${SHEET}?${search}` : SHEET;
}
export function isDocument(id: string): id is ToolPanelId { return (documents as readonly string[]).includes(id); }

export type ToolGroup = "identity" | "geometry" | "construction" | "geology" | "measurements" | "operations" | "design" | "evidence" | "field";
export const toolGroupLabels: Readonly<Record<ToolGroup, string>> = {
  identity: "Identity and reference", geometry: "Geometry", construction: "Construction", geology: "Geology and pressure",
  measurements: "Measurements", operations: "Operations", design: "Design", evidence: "Evidence and output", field: "Field",
};

export interface ToolSupply {
  /** `supplied`: the host registered it for this well. `derived`: computed from other supplied data. `missing`: not supplied. */
  readonly state: "supplied" | "derived" | "missing";
  /** What there is, in the host's own counts — "422 stations", "76 daily reports", "not supplied". */
  readonly detail: string;
}

export interface ToolAction {
  readonly panel: ToolPanelId;
  /** Panels that open with it — the survey opens the summary and the station editor beside the section. */
  readonly also?: readonly ToolPanelId[];
  /** Where in the panel the verb happens, for the reader and the command line's echo. */
  readonly where?: string;
  /** The tab the panel opens on — the records' "days", the inspector's "components". */
  readonly tab?: string;
}

export interface ToolObject {
  readonly id: string;
  readonly label: string;
  readonly group: ToolGroup;
  readonly aliases?: readonly string[];
  readonly supply: (well: ProjectWell) => ToolSupply;
  readonly verbs: Partial<Readonly<Record<ToolVerb, ToolAction>>>;
  /** Why a verb is absent when it is absent by design — the host owns that side of the object. */
  readonly hostOwned?: string;
}

const count = (n: number, noun: string) => `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`;
const supplied = (detail: string): ToolSupply => ({ state: "supplied", detail });
const derived = (detail: string): ToolSupply => ({ state: "derived", detail });
const missing = (detail = "not supplied"): ToolSupply => ({ state: "missing", detail });

export const toolObjects: readonly ToolObject[] = [
  { id: "well", label: "Well", group: "identity", supply: (well) => supplied(`${well.design.wellName ?? well.label} · ${well.design.provenance}`),
    verbs: { view: { panel: "inspector", where: "This well", tab: "tools" }, edit: { panel: "well-properties", where: "Well properties" } } },
  { id: "reference", label: "Reference and datum", group: "identity", aliases: ["datum", "crs"],
    supply: (well) => well.design.depthDatum ? supplied(`datum ${well.design.depthDatum}`) : missing("datum not reported"),
    verbs: { view: { panel: "inspector", where: "This well", tab: "tools" }, edit: { panel: "well-properties", where: "Well properties · location and datum" } } },
  { id: "survey", label: "Survey", group: "geometry", aliases: ["trajectory", "stations"],
    supply: (well) => wellCapabilities(well).survey ? supplied(count(well.design.survey!.length, "station")) : missing(),
    verbs: { view: { panel: "section", where: "Survey track, summary and stations", also: ["survey-summary", "stations"] }, create: { panel: "planner", where: "Plan build & hold" }, edit: { panel: "stations", where: "Edit stations" } } },
  { id: "hole", label: "Hole sections", group: "construction", aliases: ["holes"],
    supply: (well) => { const n = well.components.filter((c) => c.kind === "Hole").length; return n ? supplied(count(n, "section")) : missing(); },
    verbs: { view: { panel: "inspector", where: "Components", tab: "components" }, create: { panel: "construction", where: "Add parts" }, edit: { panel: "construction", where: "Properties" }, delete: { panel: "construction", where: "Properties · remove" } } },
  { id: "casing", label: "Casing and tubing", group: "construction", aliases: ["tubular", "string", "liner", "tubing"],
    supply: (well) => { const n = well.components.filter((c) => c.kind === "Casing" || c.kind === "Tubular").length; return n ? supplied(count(n, "string")) : missing(); },
    verbs: { view: { panel: "inspector", where: "Components", tab: "components" }, create: { panel: "construction", where: "Add parts" }, edit: { panel: "construction", where: "Properties" }, delete: { panel: "construction", where: "Properties · remove" } } },
  { id: "completion", label: "Completion equipment", group: "construction", aliases: ["equipment", "packer"],
    supply: (well) => { const n = well.components.filter((c) => c.kind !== "Hole" && c.kind !== "Casing" && c.kind !== "Tubular" && c.kind !== "Cement").length; return n ? supplied(count(n, "item")) : missing(); },
    verbs: { view: { panel: "inspector", where: "Components", tab: "components" }, create: { panel: "construction", where: "Add parts" }, edit: { panel: "construction", where: "Properties" }, delete: { panel: "construction", where: "Properties · remove" } } },
  { id: "formations", label: "Formations", group: "geology", aliases: ["formation", "tops", "layers"],
    supply: (well) => wellCapabilities(well).formations ? supplied(count(well.design.formations!.length, "layer")) : missing(),
    verbs: { view: { panel: "inspector", where: "Formations on the section", tab: "tools" }, create: { panel: "formations", where: "Formations" }, edit: { panel: "formations", where: "Formations" }, delete: { panel: "formations", where: "Formations" } } },
  { id: "pressure", label: "Pressure window", group: "geology", aliases: ["pore", "fracture"],
    supply: () => derived("in the design brief"),
    verbs: { view: { panel: "design", where: "Geology & pressure" }, edit: { panel: "design", where: "Geology & pressure" } } },
  { id: "log", label: "Mud log (LAS)", group: "measurements", aliases: ["las", "mudlog", "logs"],
    supply: (well) => wellCapabilities(well).mudLog ? supplied("attached, depth in feet") : missing(),
    verbs: { view: { panel: "well-file", where: "Mud log", tab: "log" }, create: { panel: "records-data", where: "Records & data · attach" }, delete: { panel: "records-data", where: "Records & data · detach" } } },
  { id: "seismic", label: "Seismic", group: "measurements", aliases: ["segy", "volume"],
    supply: (well) => wellCapabilities(well).seismic ? supplied("section and volume") : missing(),
    verbs: { view: { panel: "well-file", where: "Seismic (SEG-Y)", tab: "seismic" } }, hostOwned: "seismic is registered by the host for the field" },
  { id: "reports", label: "Daily reports", group: "operations", aliases: ["days", "history"],
    supply: (well) => wellCapabilities(well).operations ? supplied(count(well.operations!.days.length, "daily report")) : missing(),
    verbs: { view: { panel: "well-file", where: "Daily history", tab: "history" } }, hostOwned: "reports are written in the host's reporting system; this reads them with their page citations" },
  { id: "runs", label: "Runs and BHAs", group: "operations", aliases: ["bha", "run"],
    supply: (well) => wellCapabilities(well).operations ? supplied(count(well.operations!.runs.length, "run")) : missing(),
    verbs: { view: { panel: "well-file", where: "Service & BHA runs", tab: "runs" } }, hostOwned: "runs are reported, not authored here" },
  { id: "brief", label: "Design brief", group: "design", aliases: ["design", "builder"],
    supply: () => derived("design draft"),
    verbs: { view: { panel: "design", where: "Schematic" }, create: { panel: "design", where: "New design" }, edit: { panel: "design", where: "Define · Plan · Design" } } },
  { id: "checks", label: "Design checks", group: "design",
    supply: () => derived("computed from the brief"),
    verbs: { view: { panel: "design", where: "Review" } } },
  { id: "offsets", label: "Offset wells", group: "design", aliases: ["offset"],
    supply: () => derived("offset library"),
    verbs: { view: { panel: "design", where: "Offset wells" }, create: { panel: "design", where: "Offset wells · register" } } },
  { id: "study", label: "Drilling study", group: "evidence", aliases: ["analysis", "studies"],
    supply: (well) => wellCapabilities(well).mudLog ? derived("log and operations in scope") : missing("needs a drilling log"),
    verbs: { view: { panel: "study", where: "Saved studies" }, create: { panel: "study", where: "New study" }, edit: { panel: "study", where: "Scope · Check inputs · Review evidence · Findings" } } },
  { id: "report", label: "Well report", group: "evidence", aliases: ["as-drilled"],
    supply: (well) => wellCapabilities(well).report ? supplied("sourced records") : missing("no sourced report for this well"),
    verbs: { view: { panel: "report" } }, hostOwned: "the report spec is the host's" },
  { id: "field", label: "Field", group: "field", aliases: ["map", "gis"],
    supply: () => derived("Equator field · synthetic"),
    verbs: { view: { panel: "field", where: "Locate wells" }, create: { panel: "field", where: "GIS import" }, edit: { panel: "field", where: "Layers" } } },
  { id: "correlation", label: "Correlation and cross-section", group: "field", aliases: ["cross-section", "section"],
    supply: () => derived("field wells"),
    verbs: { view: { panel: "field", where: "Compare intervals · Spatial section" } } },
];

export function findToolObject(name: string): ToolObject | undefined {
  const needle = name.trim().toLowerCase();
  return toolObjects.find((object) => object.id === needle || object.label.toLowerCase() === needle || object.aliases?.includes(needle));
}

/* ---------------------------------------------------------------------------
   The sub-domain inventory — docs/SUBSURFACE_DOMAIN_STUDY.md as data
   --------------------------------------------------------------------------- */

export type SubDomain = "drilling" | "geology" | "geophysics" | "petrophysics" | "reservoir" | "completions" | "production" | "integrity" | "geomechanics" | "field";
export const subDomains: readonly { readonly id: SubDomain; readonly label: string }[] = [
  { id: "drilling", label: "Drilling" }, { id: "geology", label: "Geology" }, { id: "geophysics", label: "Geophysics" },
  { id: "petrophysics", label: "Petrophysics" }, { id: "reservoir", label: "Reservoir" }, { id: "completions", label: "Completions" },
  { id: "production", label: "Production" }, { id: "integrity", label: "Integrity" }, { id: "geomechanics", label: "Geomechanics" },
  { id: "field", label: "Field & data" },
];

export type ToolStatus = "built" | "partial" | "planned";
/** What a ribbon icon opens: a panel, the well sheet itself, or one of the well view's own panels. */
export type ToolOpen = { readonly panel: ToolPanelId; readonly where?: string; readonly tab?: string; readonly also?: readonly ToolPanelId[] } | { readonly route: string; readonly where?: string };

export interface DomainTool {
  readonly id: string;
  readonly label: string;
  readonly domain: SubDomain;
  readonly status: ToolStatus;
  /** A lucide icon name from the ribbon's own set (see tools.tsx). */
  readonly icon: string;
  /** What it does, one line. */
  readonly does: string;
  /** What the host must supply; for a planned tool, why it is grey. */
  readonly needs: string;
  readonly open?: ToolOpen;
}

const T = (id: string, label: string, domain: SubDomain, status: ToolStatus, icon: string, does: string, needs: string, open?: ToolOpen): DomainTool => ({ id, label, domain, status, icon, does, needs, open });

export const domainTools: readonly DomainTool[] = [
  // Drilling engineering
  T("section", "Section", "drilling", "built", "Layers", "The schematic, the log and the survey on one depth axis", "components, survey, LAS", { panel: "section", tab: "section" }),
  T("survey", "Survey", "drilling", "built", "Route", "Stations to positions by minimum curvature on the section, with the summary and the station table", "survey stations", { panel: "section", tab: "section", where: "Survey", also: ["survey-summary", "stations"] }),
  T("planner", "Planner", "drilling", "built", "Target", "Build-and-hold design through a target with a DLS limit, previewed on the section", "kick-off, target", { panel: "planner", also: ["stations"] }),
  T("stations", "Stations", "drilling", "built", "ListOrdered", "Edit MD, inclination, azimuth; positions recomputed and previewed on the section", "survey", { panel: "stations" }),
  T("construction", "Construction", "drilling", "built", "Hammer", "The builder's parts and properties over the sheet's Edit view, with undo; export and restore the revision", "components", { panel: "construction" }),
  T("well-properties", "Properties", "drilling", "built", "Compass", "Name, datum, depths, elevation, units and the trajectory description of the active revision", "design", { panel: "well-properties" }),
  T("component-records", "Components", "drilling", "built", "ClipboardList", "Every component's name, material, depths and diameters as records", "components", { panel: "component-records" }),
  T("casing-design", "Casing", "drilling", "built", "Cylinder", "Strings, setting depths, API 5C3 ratings with derating — the brief's Casing step", "casing scheme, pressures", { panel: "design", tab: "casing", where: "Design · Casing" }),
  T("pressure-window", "Pressures", "drilling", "built", "Gauge", "Pore, fracture and mud weight vs TVD with provenance — the brief's Geology & pressure step", "pressure data", { panel: "design", tab: "geology", where: "Plan · Geology & pressure" }),
  T("kick-tolerance", "Kick", "drilling", "built", "Flame", "IADC kick tolerance below a shoe from the host's shoe and hole records and your gradient and mud weight", "shoe, hole size; fracture gradient and mud weight typed", { panel: "kick" }),
  T("cement-design", "Cement", "drilling", "built", "Container", "Annular cement volume per string from the host's diameters, split at the previous shoe", "casing and hole geometry; top of cement if not reported", { panel: "cement" }),
  T("hydraulics", "Hydraulics", "drilling", "built", "Waves", "Annular velocity by section and bit hydraulics from typed flow, mud and nozzles", "hole sections; flow, mud and nozzles typed", { panel: "hydraulics" }),
  T("performance", "Performance", "drilling", "built", "Activity", "ROP, WOB, RPM vs depth from the mud log", "LAS", { panel: "well-file", where: "Mud log", tab: "log" }),
  T("reports", "Daily", "drilling", "built", "Calendar", "The operational record with its citations, day by day", "daily reports", { panel: "well-file", where: "Daily history", tab: "history" }),
  T("runs", "Runs", "drilling", "built", "Wrench", "Run intervals, outcomes and footage", "runs", { panel: "well-file", where: "Service & BHA runs", tab: "runs" }),
  T("time", "Time", "drilling", "built", "Timer", "Days by activity and per hole section from the daily reports; trouble from run outcomes", "daily reports, runs", { panel: "time" }),
  T("study", "Study", "drilling", "built", "FlaskConical", "Two intervals compared on evidence, with a finding and its uncertainty", "LAS, operations", { panel: "study" }),
  T("anticollision", "Anti-collision", "drilling", "planned", "Crosshair", "Separation factor against offset wellbores", "offset surveys, tool error models"),
  T("torque-drag", "Torque and drag", "drilling", "planned", "Anchor", "Hookload and torque vs depth for the string in the hole", "string weights, friction factors"),
  // Geology
  T("tops", "Tops", "geology", "built", "Mountain", "Tops and bases on TVD, edited here and drawn on every depth view", "formations", { panel: "formations", where: "Formations" }),
  T("correlation", "Correlation", "geology", "built", "GitBranch", "Wells side by side on a datum, tops linked", "several wells' tops", { panel: "correlation", also: ["field-register"] }),
  T("cross-section", "Cross-section", "geology", "built", "Split", "Wells on a spatial line with tops and the surface", "locations, tops, surface", { panel: "cross-section", also: ["field-register"] }),
  T("lithology", "Lithology column", "geology", "planned", "Columns3", "Lithology by interval beside the section", "lithology log"),
  T("structure-map", "Structure map", "geology", "planned", "Map", "Contours of a top across the field", "tops at three or more wells"),
  T("isopach", "Isopach map", "geology", "planned", "Grid3x3", "Thickness of an interval across the field", "tops at three or more wells"),
  T("core", "Core description", "geology", "planned", "Box", "Core intervals and descriptions on depth", "core records"),
  T("facies", "Facies", "geology", "planned", "Boxes", "Facies by interval from logs or core", "facies log"),
  // Geophysics
  T("seismic-section", "Section", "geophysics", "built", "AudioWaveform", "SEG-Y along the well, the well projected on it, linked by depth", "SEG-Y, section geometry", { panel: "well-file", where: "Seismic (SEG-Y)", tab: "seismic" }),
  T("seismic-volume", "Volume", "geophysics", "built", "Box", "The cube around the well in 3D with the survey, cut along, across and by depth", "sub-volume", { panel: "section", tab: "earth", where: "3D well + seismic + survey" }),
  T("horizons", "Interpretation", "geophysics", "partial", "Scan", "The volume and interpretation tools: slice plane, picking and the log style, over the 3D view", "interpretation records", { panel: "scene-options", tab: "earth", where: "Volume & interpretation tools" }),
  T("faults", "Fault picking", "geophysics", "planned", "Zap", "Fault sticks on the section", "fault records"),
  T("seismic-tie", "Well-to-seismic tie", "geophysics", "planned", "Radio", "Synthetic seismogram matched to the trace", "sonic, density, wavelet"),
  T("velocity", "Velocity model", "geophysics", "planned", "Sigma", "Two-way time to depth from checkshot or velocity", "checkshot / VSP"),
  T("attributes", "Attributes", "geophysics", "planned", "Scale", "Amplitude, phase and frequency along a horizon", "volume and horizon"),
  // Petrophysics
  T("petrophysics", "Petrophysics", "petrophysics", "built", "Rows3", "Log viewer with templates and zones, neutron-density and M-N crossplots, Archie water saturation, histogram, zone summary and flattening — on the well's curves when it has them", "GR, NPHI, RHOB, RT, DT", { panel: "petrophysics" }),
  T("depth-shift", "Depth shift and QC", "petrophysics", "planned", "Ruler", "Align runs and flag bad hole", "curves, caliper"),
  T("vsh", "Shale volume", "petrophysics", "planned", "Droplets", "Vsh from gamma ray", "GR"),
  T("permeability", "Permeability", "petrophysics", "planned", "Compass", "From porosity transforms or core", "porosity, core"),
  T("net-pay", "Net pay and cutoffs", "petrophysics", "planned", "Calculator", "Net to gross by cutoffs on Vsh, porosity and Sw", "computed curves"),
  // Reservoir engineering
  T("volumetrics", "Volumetrics", "reservoir", "planned", "Calculator", "GRV × N/G × φ × (1−Sw) / Bo, each term with its source", "surfaces or GRV, petrophysical averages, PVT"),
  T("pvt", "Fluid properties", "reservoir", "planned", "FlaskConical", "Bo, Rs and viscosity against pressure", "PVT report"),
  T("material-balance", "Material balance", "reservoir", "planned", "Scale", "p/z and drive indices", "production, pressures, PVT"),
  T("pta", "Well test analysis", "reservoir", "planned", "Activity", "Pressure transient diagnostics", "PTA data"),
  T("decline", "Decline curve", "reservoir", "planned", "TrendingDown", "Arps fit and forecast on production", "production rates"),
  T("pressure-history", "Pressure history", "reservoir", "planned", "Gauge", "Reservoir pressure against time by zone", "pressure surveys"),
  // Completions and intervention
  T("completion", "Schematic", "completions", "built", "Cylinder", "Tubing, packers, valves, nipples, mandrels and gauges on the 2.5D schematic", "completion components", { panel: "section", tab: "schematic", where: "2.5D schematic" }),
  T("completion-builder", "Builder", "completions", "built", "Hammer", "Parts from the catalogue placed on the brief's schematic with placement rules", "catalogue", { panel: "design", tab: "assemble", where: "Schematic · Add parts" }),
  T("perforations", "Perforations", "completions", "planned", "Crosshair", "Perforated intervals with date, gun and shot density", "perforation records"),
  T("sand-control", "Sand control", "completions", "planned", "Grid3x3", "Screens and gravel-pack intervals", "completion records"),
  T("stimulation", "Stimulation", "completions", "planned", "Zap", "Fracture and acid treatments by stage", "treatment records"),
  T("interventions", "Intervention history", "completions", "planned", "Wrench", "Workovers and interventions by date and depth", "intervention records"),
  // Production and surveillance
  T("production-history", "History", "production", "built", "Activity", "Rates, pressures and events over time", "surveillance document", { panel: "production" }),
  T("well-tests", "Well tests", "production", "planned", "FlaskConical", "Rate and pressure tests over time", "test records"),
  T("lift", "Artificial lift", "production", "planned", "Zap", "The lift system and its settings", "lift records"),
  T("plt", "Production log", "production", "planned", "Rows3", "Flow contribution by depth", "PLT"),
  T("injection", "Injection", "production", "planned", "Droplets", "Injection rates and pressures", "injection records"),
  T("allocation", "Allocation", "production", "planned", "Sigma", "Well production allocated from measured streams", "allocation factors"),
  // Well integrity
  T("barriers", "Barrier schematic", "integrity", "planned", "ShieldCheck", "Primary and secondary barrier envelopes on the construction", "barrier definitions"),
  T("annulus", "Annulus pressures", "integrity", "planned", "Gauge", "A, B and C annulus pressure history against limits", "annulus monitoring"),
  T("cement-eval", "Cement evaluation", "integrity", "planned", "AudioWaveform", "Bond log on the section against cemented intervals", "cement bond log"),
  T("casing-wear", "Casing wear and corrosion", "integrity", "planned", "Ruler", "Wall loss by depth from calipers", "caliper logs"),
  T("integrity-status", "Integrity status", "integrity", "planned", "ClipboardList", "Current status and open anomalies", "integrity register"),
  // Geomechanics
  T("stress", "Stress regime", "geomechanics", "planned", "Compass", "Sv, SHmax and Shmin against depth", "density log, LOT/FIT, image logs"),
  T("stability", "Wellbore stability", "geomechanics", "planned", "ShieldCheck", "Collapse and fracture mud weights along the trajectory", "stresses, rock strength"),
  T("fracture-gradient", "Fracture gradient", "geomechanics", "planned", "Gauge", "LOT/FIT points and the fitted gradient (the brief's pressure window carries the typed gradient today)", "LOT/FIT records"),
  T("sand-risk", "Sand production risk", "geomechanics", "planned", "TrendingDown", "Critical drawdown by depth", "rock strength"),
  // Field, data and reference
  T("map", "Map", "field", "built", "Map", "Wells on a map with layers, bathymetry, GIS import and the offshore scene", "locations, layers", { panel: "field", where: "1 · Locate wells", also: ["field-register", "field-trajectory"] }),
  T("offsets", "Offsets", "field", "built", "Database", "Comparable wells, nine-factor match, adoption into a brief — the brief's Offset wells step", "offset records", { panel: "design", tab: "offsets", where: "Define · Offset wells" }),
  T("sources", "Sources", "field", "built", "Database", "The mud log path and the operational records registered for the well, editable with their citations", "the host registry", { panel: "records-data", where: "Records & data" }),
  T("report", "Report", "field", "built", "Printer", "The as-drilled report from sourced records", "report spec", { panel: "report" }),
];

/**
 * Ribbon groups, Office-style: the tools of a sub-domain in labelled clusters with a caption
 * under each, so seventeen drilling tools read as six ideas. Tools not named here sit in a
 * cluster named after the sub-domain.
 */
export const ribbonGroups: Readonly<Record<string, string>> = {
  section: "Well", survey: "Well",
  planner: "Trajectory", stations: "Trajectory",
  construction: "Edit well", "well-properties": "Edit well", "component-records": "Edit well",
  "casing-design": "Brief", "pressure-window": "Brief",
  "kick-tolerance": "Calculate", "cement-design": "Calculate", hydraulics: "Calculate", time: "Calculate",
  performance: "Records", reports: "Records", runs: "Records", study: "Records",
  tops: "Formations", correlation: "Field", "cross-section": "Field",
  "seismic-section": "Seismic", "seismic-volume": "Seismic", horizons: "Seismic",
  completion: "Completion", "completion-builder": "Completion",
  map: "Field", offsets: "Brief", sources: "Well data", report: "Well data",
};
/** The sub-domains with at least one working tool: what the ribbon shows. The rest are counted in the study. */
export const ribbonDomains = subDomains.filter((domain) => domainTools.some((tool) => tool.domain === domain.id && tool.status !== "planned"));

export function domainToolCounts(): Readonly<Record<SubDomain, Readonly<Record<ToolStatus, number>>>> {
  const counts = Object.fromEntries(subDomains.map((domain) => [domain.id, { built: 0, partial: 0, planned: 0 }])) as Record<SubDomain, Record<ToolStatus, number>>;
  for (const tool of domainTools) counts[tool.domain][tool.status] += 1;
  return counts;
}
