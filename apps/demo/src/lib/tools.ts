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
export type ToolPanelId = "trajectory" | "study" | "brief" | "report" | "field" | "edit-well" | "inspector" | "well-file";

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
  /** Where in the panel the verb happens, for the reader and the command line's echo. */
  readonly where?: string;
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
    verbs: { view: { panel: "inspector", where: "This well" }, edit: { panel: "edit-well", where: "Well properties" } } },
  { id: "reference", label: "Reference and datum", group: "identity", aliases: ["datum", "crs"],
    supply: (well) => well.design.depthDatum ? supplied(`datum ${well.design.depthDatum}`) : missing("datum not reported"),
    verbs: { view: { panel: "inspector", where: "This well" }, edit: { panel: "edit-well", where: "Well properties · location and datum" } } },
  { id: "survey", label: "Survey", group: "geometry", aliases: ["trajectory", "stations"],
    supply: (well) => wellCapabilities(well).survey ? supplied(count(well.design.survey!.length, "station")) : missing(),
    verbs: { view: { panel: "trajectory", where: "View survey" }, create: { panel: "trajectory", where: "Plan build & hold" }, edit: { panel: "trajectory", where: "Edit stations" } } },
  { id: "hole", label: "Hole sections", group: "construction", aliases: ["holes"],
    supply: (well) => { const n = well.components.filter((c) => c.kind === "Hole").length; return n ? supplied(count(n, "section")) : missing(); },
    verbs: { view: { panel: "inspector", where: "Components" }, create: { panel: "edit-well", where: "Add parts" }, edit: { panel: "edit-well", where: "Properties" }, delete: { panel: "edit-well", where: "Properties · remove" } } },
  { id: "casing", label: "Casing and tubing", group: "construction", aliases: ["tubular", "string", "liner", "tubing"],
    supply: (well) => { const n = well.components.filter((c) => c.kind === "Casing" || c.kind === "Tubular").length; return n ? supplied(count(n, "string")) : missing(); },
    verbs: { view: { panel: "inspector", where: "Components" }, create: { panel: "edit-well", where: "Add parts" }, edit: { panel: "edit-well", where: "Properties" }, delete: { panel: "edit-well", where: "Properties · remove" } } },
  { id: "completion", label: "Completion equipment", group: "construction", aliases: ["equipment", "packer"],
    supply: (well) => { const n = well.components.filter((c) => c.kind !== "Hole" && c.kind !== "Casing" && c.kind !== "Tubular" && c.kind !== "Cement").length; return n ? supplied(count(n, "item")) : missing(); },
    verbs: { view: { panel: "inspector", where: "Components" }, create: { panel: "edit-well", where: "Add parts" }, edit: { panel: "edit-well", where: "Properties" }, delete: { panel: "edit-well", where: "Properties · remove" } } },
  { id: "formations", label: "Formations", group: "geology", aliases: ["formation", "tops", "layers"],
    supply: (well) => wellCapabilities(well).formations ? supplied(count(well.design.formations!.length, "layer")) : missing(),
    verbs: { view: { panel: "inspector", where: "Formations on the section" }, create: { panel: "edit-well", where: "Formations" }, edit: { panel: "edit-well", where: "Formations" }, delete: { panel: "edit-well", where: "Formations" } } },
  { id: "pressure", label: "Pressure window", group: "geology", aliases: ["pore", "fracture"],
    supply: () => derived("in the design brief"),
    verbs: { view: { panel: "brief", where: "Geology & pressure" }, edit: { panel: "brief", where: "Geology & pressure" } } },
  { id: "log", label: "Mud log (LAS)", group: "measurements", aliases: ["las", "mudlog", "logs"],
    supply: (well) => wellCapabilities(well).mudLog ? supplied("attached, depth in feet") : missing(),
    verbs: { view: { panel: "well-file", where: "Mud log" }, create: { panel: "edit-well", where: "Records & data · attach" }, delete: { panel: "edit-well", where: "Records & data · detach" } } },
  { id: "seismic", label: "Seismic", group: "measurements", aliases: ["segy", "volume"],
    supply: (well) => wellCapabilities(well).seismic ? supplied("section and volume") : missing(),
    verbs: { view: { panel: "well-file", where: "Seismic (SEG-Y)" } }, hostOwned: "seismic is registered by the host for the field" },
  { id: "reports", label: "Daily reports", group: "operations", aliases: ["days", "history"],
    supply: (well) => wellCapabilities(well).operations ? supplied(count(well.operations!.days.length, "daily report")) : missing(),
    verbs: { view: { panel: "well-file", where: "Daily history" } }, hostOwned: "reports are written in the host's reporting system; this reads them with their page citations" },
  { id: "runs", label: "Runs and BHAs", group: "operations", aliases: ["bha", "run"],
    supply: (well) => wellCapabilities(well).operations ? supplied(count(well.operations!.runs.length, "run")) : missing(),
    verbs: { view: { panel: "well-file", where: "Service & BHA runs" } }, hostOwned: "runs are reported, not authored here" },
  { id: "brief", label: "Design brief", group: "design", aliases: ["design", "builder"],
    supply: () => derived("design draft"),
    verbs: { view: { panel: "brief", where: "Schematic" }, create: { panel: "brief", where: "New design" }, edit: { panel: "brief", where: "Define · Plan · Design" } } },
  { id: "checks", label: "Design checks", group: "design",
    supply: () => derived("computed from the brief"),
    verbs: { view: { panel: "brief", where: "Review" } } },
  { id: "offsets", label: "Offset wells", group: "design", aliases: ["offset"],
    supply: () => derived("offset library"),
    verbs: { view: { panel: "brief", where: "Offset wells" }, create: { panel: "brief", where: "Offset wells · register" } } },
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
