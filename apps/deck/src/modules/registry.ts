import type { LucideIcon } from "lucide-react";
import { Activity, AlignHorizontalSpaceAround, AudioLines, AudioWaveform, Layers, Map as MapIcon, Drill, FilePen, GitCompareArrows, PencilRuler, Mountain, TrendingDown, Anchor, ShieldCheck, Radar, Slice, Box, CalendarDays, Columns3, Compass, Cylinder, Droplets, Gauge, Layers2, ScatterChart, ShieldAlert, Waves, Globe2, Layers3, ListTree, Rotate3d } from "lucide-react";
import type { WellDesignBrief } from "@ikhmalputra/subsurface-core";
import type { MinSize, Rect } from "../deck/layout.ts";
import { designForSite, isDesignSite } from "../data/design.ts";
import { activeEditWell, editedValue, isRecordedSite, recordedForSite } from "../data/records.ts";
import type { WellRecordValue } from "../data/records.ts";
import { importedLogs } from "../data/logs.ts";

/** The six signals. Each has one colour, used for nothing else. */
export type Signal = "place" | "object" | "depth" | "time" | "view" | "whatif";
export const signalColour: Readonly<Record<Signal, string>> = {
  place: "var(--signal-place)", object: "var(--signal-object)", depth: "var(--signal-depth)",
  time: "var(--signal-time)", view: "var(--signal-view)", whatif: "var(--signal-whatif)",
};
export const signalName: Readonly<Record<Signal, string>> = { place: "Place", object: "Object", depth: "Depth", time: "Time", view: "View", whatif: "What-if" };

export type ModuleId =
  | "globe" | "site3d"
  | "designer" | "editor" | "section" | "well3d" | "construction" | "compare" | "cutaway" | "plan" | "profile" | "anticollision"
  | "logs" | "seismic" | "curtain" | "correlate" | "tie" | "horizons" | "volumetrics"
  | "drilling" | "rig" | "torquedrag"
  | "petro"
  | "strings" | "window" | "kick" | "cement" | "hydraulics" | "geomech" | "barriers"
  | "decline";

/** What kind of place a site is: FORGE's records, the Equator field, a FORCE 2020 area, a planned well (Kestrel A-7 or the user's), or a drilled well entered on the deck. */
type SiteKind = "forge" | "equator" | "force" | "design" | "recorded";
/** The subsurface disciplines the dock is grouped by, the same as the landing page's. */
export type ModuleGroup = "Geophysics & geology" | "Petrophysics" | "Geomechanics & pressure" | "Drilling" | "Well engineering & completions" | "Production" | "Your data";

export interface ModuleSpec {
  readonly id: ModuleId;
  readonly title: string;
  readonly icon: LucideIcon;
  readonly group: ModuleGroup;
  /** One line on what it shows, for the dock and the command bar. */
  readonly blurb: string;
  /** Signals the module reacts to, and the ones it sends. */
  readonly listens: readonly Signal[];
  readonly emits: readonly Signal[];
  /** The smallest tile, in grid cells, the module can still be read in, and the size it opens at. */
  readonly min: MinSize;
  readonly size: MinSize;
  /** Indexed by measured depth: it draws the depth cursor and can set it. */
  readonly depthIndexed: boolean;
  /** Opens as the deck's stage, the largest tile: for modules that need room to be used at all. */
  readonly opensOnStage?: boolean;
  /** Opens spread over the whole deck (Esc puts it back in its tile): for modules that read across many wells. */
  readonly opensFocused?: boolean;
}

export const modules: readonly ModuleSpec[] = [
  { id: "globe", title: "Globe", icon: Globe2, group: "Geophysics & geology", blurb: "Every located well on an offline globe; draw a section line on it", listens: ["place", "depth", "view"], emits: ["place", "view"], min: { w: 3, h: 3 }, size: { w: 5, h: 8 }, depthIndexed: false },
  { id: "site3d", title: "Site in 3D", icon: Box, group: "Geophysics & geology", blurb: "Wells, horizons and seismic in one frame", listens: ["place", "depth", "view"], emits: ["place", "view"], min: { w: 3, h: 4 }, size: { w: 5, h: 8 }, depthIndexed: false },
  { id: "seismic", title: "Seismic section", icon: AudioWaveform, group: "Geophysics & geology", blurb: "PSDM along the well, or the inline or crossline moved in the 3D site", listens: ["place", "object", "depth", "view"], emits: ["depth", "view"], min: { w: 3, h: 4 }, size: { w: 5, h: 6 }, depthIndexed: true },
  { id: "curtain", title: "Section line", icon: Slice, group: "Geophysics & geology", blurb: "The PSDM along a line drawn on the globe, with the wells that pass near it", listens: ["place", "depth", "view"], emits: ["depth"], min: { w: 4, h: 4 }, size: { w: 6, h: 5 }, depthIndexed: true },
  { id: "correlate", title: "Correlation", icon: AlignHorizontalSpaceAround, group: "Geophysics & geology", blurb: "A field's wells side by side on their logs and tops: flatten on a top, pick your own", listens: ["place", "depth"], emits: ["place", "depth"], min: { w: 5, h: 5 }, size: { w: 8, h: 8 }, depthIndexed: false, opensFocused: true },
  { id: "tie", title: "Well tie", icon: AudioLines, group: "Geophysics & geology", blurb: "The seismic the logs predict, tied to the PSDM: shift, stretch and fit, scored by correlation", listens: ["place", "depth"], emits: ["depth"], min: { w: 5, h: 5 }, size: { w: 8, h: 8 }, depthIndexed: false, opensFocused: true },
  { id: "horizons", title: "Horizons & faults", icon: Layers, group: "Geophysics & geology", blurb: "Click a reflector in 3D and it is tracked through the PSDM; pick faults as sticks and the horizon stops at them, with the throw", listens: ["place"], emits: [], min: { w: 5, h: 5 }, size: { w: 8, h: 8 }, depthIndexed: false, opensFocused: true },
  { id: "volumetrics", title: "Maps & volumetrics", icon: MapIcon, group: "Geophysics & geology", blurb: "A zone mapped between the wells, a contact you set, and the in-place volume as P90, P50 and P10 from the wells' own logs", listens: ["place"], emits: [], min: { w: 5, h: 5 }, size: { w: 8, h: 8 }, depthIndexed: false, opensFocused: true },
  { id: "logs", title: "Logs", icon: ListTree, group: "Petrophysics", blurb: "The well's LAS curves; Shift-drag to brush an interval", listens: ["place", "object", "depth", "time"], emits: ["depth"], min: { w: 3, h: 4 }, size: { w: 4, h: 8 }, depthIndexed: true },
  { id: "petro", title: "Petrophysics", icon: ScatterChart, group: "Petrophysics", blurb: "Porosity, saturation and pay over the brushed interval", listens: ["place", "object", "depth"], emits: ["object", "depth"], min: { w: 4, h: 4 }, size: { w: 5, h: 8 }, depthIndexed: false },
  { id: "geomech", title: "Geomechanics", icon: Mountain, group: "Geomechanics & pressure", blurb: "A 1D mechanical earth model: stresses, collapse and breakdown against the mud used", listens: ["place", "depth"], emits: ["depth"], min: { w: 4, h: 6 }, size: { w: 5, h: 8 }, depthIndexed: true },
  { id: "window", title: "Pressure window", icon: Layers2, group: "Geomechanics & pressure", blurb: "Pore, fracture and the mud weights between them", listens: ["place", "depth", "whatif"], emits: ["depth", "whatif"], min: { w: 3, h: 4 }, size: { w: 4, h: 8 }, depthIndexed: true },
  { id: "drilling", title: "Drilling record", icon: CalendarDays, group: "Drilling", blurb: "Days vs depth, hole sections, runs and the daily reports", listens: ["place", "object", "depth", "time"], emits: ["object", "depth", "time"], min: { w: 3, h: 4 }, size: { w: 4, h: 6 }, depthIndexed: true },
  { id: "rig", title: "Live drilling", icon: Drill, group: "Drilling", blurb: "Drill the planned well in simulation, second by second: kicks, losses, washouts and well control", listens: ["place", "depth"], emits: ["depth"], min: { w: 4, h: 6 }, size: { w: 8, h: 8 }, depthIndexed: false, opensOnStage: true },
  { id: "torquedrag", title: "Torque & drag", icon: Anchor, group: "Drilling", blurb: "Soft-string hookload and torque, calibrated on the daily reports' string weights", listens: ["place", "depth"], emits: ["depth"], min: { w: 4, h: 6 }, size: { w: 6, h: 8 }, depthIndexed: true },
  { id: "hydraulics", title: "Hydraulics", icon: Waves, group: "Drilling", blurb: "Bit pressure drop, jet velocity and annular velocity", listens: ["place", "whatif"], emits: ["whatif"], min: { w: 3, h: 3 }, size: { w: 4, h: 4 }, depthIndexed: false },
  { id: "kick", title: "Kick tolerance", icon: ShieldAlert, group: "Drilling", blurb: "The influx each shoe can take while drilling on", listens: ["place", "object", "whatif"], emits: ["object", "whatif"], min: { w: 3, h: 3 }, size: { w: 4, h: 4 }, depthIndexed: false },
  { id: "anticollision", title: "Anti-collision", icon: Radar, group: "Drilling", blurb: "Distance to the neighbouring wells down the hole: ladder and travelling cylinder", listens: ["place", "depth"], emits: ["depth"], min: { w: 4, h: 5 }, size: { w: 5, h: 7 }, depthIndexed: true },
  { id: "plan", title: "Plan view", icon: Compass, group: "Drilling", blurb: "The path from above: north, east, closure", listens: ["place", "depth"], emits: ["depth"], min: { w: 3, h: 3 }, size: { w: 4, h: 4 }, depthIndexed: true },
  { id: "profile", title: "Vertical section", icon: Activity, group: "Drilling", blurb: "Departure against TVD, with formations", listens: ["place", "depth"], emits: ["depth"], min: { w: 3, h: 3 }, size: { w: 4, h: 4 }, depthIndexed: true },
  { id: "designer", title: "Well designer", icon: PencilRuler, group: "Well engineering & completions", blurb: "Plan a well stage by stage: place, datum, geology and pressures, trajectory, casing, cement and completion, checked live", listens: ["place", "whatif"], emits: ["whatif"], min: { w: 4, h: 6 }, size: { w: 5, h: 8 }, depthIndexed: false },
  { id: "construction", title: "Construction", icon: Columns3, group: "Well engineering & completions", blurb: "The construction drawing: straight on a depth axis, or along the surveyed path", listens: ["place", "object", "depth", "time", "whatif"], emits: ["object", "depth"], min: { w: 4, h: 4 }, size: { w: 4, h: 8 }, depthIndexed: true },
  { id: "section", title: "Well section", icon: Layers3, group: "Well engineering & completions", blurb: "Construction, mud log and survey on one depth axis", listens: ["place", "object", "depth", "time", "whatif"], emits: ["object", "depth"], min: { w: 3, h: 4 }, size: { w: 4, h: 8 }, depthIndexed: true },
  { id: "well3d", title: "Well in 3D", icon: Rotate3d, group: "Well engineering & completions", blurb: "The well, its strings and the PSDM volume", listens: ["place", "object", "depth", "time", "whatif"], emits: ["object", "depth", "view"], min: { w: 3, h: 4 }, size: { w: 5, h: 8 }, depthIndexed: true },
  { id: "cutaway", title: "Cutaway", icon: Cylinder, group: "Well engineering & completions", blurb: "The construction as a 3D cutaway", listens: ["place", "object", "time", "whatif"], emits: ["object"], min: { w: 3, h: 4 }, size: { w: 4, h: 6 }, depthIndexed: false },
  { id: "strings", title: "Strings", icon: Gauge, group: "Well engineering & completions", blurb: "Each string's record and API ratings; on a design, burst, collapse and tension against them, live", listens: ["place", "object", "time", "whatif"], emits: ["object", "whatif"], min: { w: 4, h: 4 }, size: { w: 5, h: 6 }, depthIndexed: false },
  { id: "cement", title: "Cement", icon: Droplets, group: "Well engineering & completions", blurb: "Slurry volumes and the column against fracture", listens: ["place", "object", "whatif"], emits: ["object", "whatif"], min: { w: 3, h: 4 }, size: { w: 4, h: 5 }, depthIndexed: false },
  { id: "barriers", title: "Well barriers", icon: ShieldCheck, group: "Well engineering & completions", blurb: "Primary and secondary barrier envelopes on the construction, with what the records say of each element", listens: ["place", "depth", "time", "whatif"], emits: [], min: { w: 4, h: 6 }, size: { w: 6, h: 8 }, depthIndexed: false },
  { id: "decline", title: "Decline curves", icon: TrendingDown, group: "Production", blurb: "Arps decline on any Norwegian field's monthly production (Sodir)", listens: [], emits: [], min: { w: 4, h: 5 }, size: { w: 6, h: 7 }, depthIndexed: false },
  { id: "editor", title: "Well editor", icon: FilePen, group: "Your data", blurb: "A drilled well's records: survey, formation tops, casing, hole and cement, and LAS logs; enter them, paste or import them, or edit an existing well's", listens: ["place", "object"], emits: ["object"], min: { w: 4, h: 6 }, size: { w: 5, h: 8 }, depthIndexed: false },
  { id: "compare", title: "Compare wells", icon: GitCompareArrows, group: "Your data", blurb: "Several wells' construction side by side, on one depth scale and one diameter scale, string by string", listens: ["place", "depth", "whatif"], emits: ["depth"], min: { w: 4, h: 5 }, size: { w: 7, h: 8 }, depthIndexed: false },
];
/**
 * Fusing: a tile dropped on the middle of another hands it its data, and the target draws it in its
 * own way; the target's head then carries a chip to change or pull the fusion off.
 */
export interface FusionRule { readonly from: ModuleId; readonly to: ModuleId; readonly verb: string; readonly sites: readonly SiteKind[] }
export const fusionRules: readonly FusionRule[] = [
  { from: "logs", to: "well3d", verb: "Wrap the open-hole log around the well", sites: ["forge"] },
  { from: "section", to: "seismic", verb: "Draw the formation tops across the seismic", sites: ["forge"] },
  { from: "section", to: "curtain", verb: "Draw the formation tops across the section line", sites: ["forge"] },
];
export const fusionKey = (from: ModuleId, to: ModuleId) => `${from}>${to}`;
export const fusionRule = (from: ModuleId, to: ModuleId, siteId: string | null) => fusionRules.find((rule) => rule.from === from && rule.to === to && rule.sites.includes(siteId as SiteKind)) ?? null;

export const moduleById = Object.fromEntries(modules.map((spec) => [spec.id, spec])) as Readonly<Record<ModuleId, ModuleSpec>>;
export const moduleIds = modules.map((spec) => spec.id);
export const minSizes = Object.fromEntries(modules.map((spec) => [spec.id, spec.min])) as Readonly<Record<ModuleId, MinSize>>;
export const groups: readonly ModuleGroup[] = ["Geophysics & geology", "Petrophysics", "Geomechanics & pressure", "Drilling", "Well engineering & completions", "Production", "Your data"];

/** Which sites have the data each module draws; a site missing from a list gets that module's reason. */
const availability: Readonly<Partial<Record<ModuleId, { readonly sites: readonly SiteKind[]; readonly why: string }>>> = {
  section: { sites: ["forge", "design", "recorded"], why: "No construction records: the Equator wells are synthetic trajectories with logs and picks. Add casing records in the Well editor to draw one." },
  well3d: { sites: ["forge", "design", "recorded"], why: "No construction to draw: open the site in 3D for the Equator wells' paths and picks." },
  construction: { sites: ["forge", "design", "recorded"], why: "No construction records for the Equator wells. Add casing records in the Well editor to draw one." },
  cutaway: { sites: ["forge", "design", "recorded"], why: "No construction records for the Equator wells. Add casing records in the Well editor to draw one." },
  plan: { sites: ["forge", "design", "equator", "force", "recorded"], why: "" },
  anticollision: { sites: ["forge"], why: "Anti-collision needs real neighbouring surveys; only Utah FORGE has them (16B(78)-32 and 58-32 beside 16A(78)-32)." },
  profile: { sites: ["forge", "design", "equator", "force", "recorded"], why: "" },
  logs: { sites: ["forge", "equator", "force", "recorded"], why: "A planned well has not been drilled, so it has no logs." },
  horizons: { sites: ["forge"], why: "Horizons are picked on seismic; at Utah FORGE there is a PSDM volume to pick on. Fly to Utah FORGE." },
  volumetrics: { sites: ["force"], why: "Volumetrics maps a zone between wells that have tops and logs: the FORCE 2020 wells in the Norwegian North Sea. Fly to one of their areas from the globe or ⌘K." },
  tie: { sites: ["forge"], why: "A well tie needs sonic, density and seismic at one well; at Utah FORGE, 58-32 has all three. Fly to Utah FORGE." },
  correlate: { sites: ["force"], why: "Correlation reads logs and tops across a field's wells. The FORCE 2020 wells in the Norwegian North Sea have both: fly to one of their areas from the globe or ⌘K." },
  seismic: { sites: ["forge"], why: "Only Utah FORGE has seismic: the PSDM volume around 16A(78)-32." },
  curtain: { sites: ["forge"], why: "A section line cuts the PSDM volume; only Utah FORGE has one." },
  torquedrag: { sites: ["forge"], why: "Torque and drag is calibrated on reported string weights; only Utah FORGE 16A(78)-32 has them, in its daily reports." },
  drilling: { sites: ["forge"], why: "Only Utah FORGE has been drilled: daily reports, hole sections and runs exist only for it." },
  petro: { sites: ["forge", "equator"], why: "A planned well has not been drilled, so it has no logs." },
  strings: { sites: ["forge", "design", "recorded"], why: "The Equator wells have no casing records. Add them in the Well editor." },
  window: { sites: ["design"], why: "A pressure window needs pore and fracture pressures; only planned wells (Kestrel A-7 or one you create with + New well) carry them." },
  kick: { sites: ["design"], why: "Kick tolerance needs fracture gradients at the shoes; only planned wells carry them." },
  rig: { sites: ["design"], why: "The simulator drills a planned well: it needs the plan's pore and fracture pressures, formations and casing. Open Kestrel A-7 or plan one with + New well." },
  cement: { sites: ["design"], why: "Cement design needs planned slurries and fracture gradients; only planned wells carry them." },
  barriers: { sites: ["forge", "design", "recorded"], why: "Barrier envelopes are drawn on a construction; the Equator wells have none. Add casing records in the Well editor." },
  geomech: { sites: ["forge"], why: "A mechanical earth model needs logged rock strength and stresses; only Utah FORGE has them (16A's IsoMechPro and 58-32's calibrated stresses)." },
  hydraulics: { sites: ["design"], why: "Hydraulics need a hole section, mud and drill string; a planned well supplies them, with flow and nozzles you set." },
};

/** What the FORCE 2020 wells carry, for the modules that need more. */
const FORCE_HAS = "The FORCE 2020 wells carry logs, the Directorate's tops, interpreted lithology and casing shoe depths, not the records this module reads.";
const forceWhy: Readonly<Partial<Record<ModuleId, string>>> = {
  petro: "Petrophysics runs on FORGE and the Equator field. The FORCE wells' curves are in Logs and Correlation.",
  section: "The FORCE wells carry casing shoe depths, not a construction record. Their shoes are marked in Logs and Correlation.",
  construction: "The FORCE wells carry casing shoe depths, not a construction record.",
  seismic: "FORCE 2020 carries no seismic.", curtain: "FORCE 2020 carries no seismic.", tie: "FORCE 2020 carries no seismic to tie to.", horizons: "FORCE 2020 carries no seismic to pick horizons on.",
};

/** What a module needs that the place does not have; null when it can show something. */
export function missing(id: ModuleId, siteId: string | null): string | null {
  // The globe chooses places; decline curves run on the Norwegian fields' own production, and a
  // comparison holds its own wells, from any site, wherever the deck is.
  if (id === "globe" || id === "decline" || id === "compare") return null;
  if (id === "designer") return isDesignSite(siteId) ? null : "The designer plans wells. Press + New well to start one, or fly to Kestrel A-7, the example design.";
  if (!siteId) return "Choose a site on the globe or press ⌘K.";
  const kind: SiteKind | null = siteId === "forge" || siteId === "equator" ? siteId : siteId.startsWith("force-q") ? "force" : isDesignSite(siteId) ? "design" : isRecordedSite(siteId) ? "recorded" : null;
  if (id === "editor") return kind === "design" ? "A planned well is edited in the Well designer." : null;
  // An imported log is drawn wherever it was imported.
  if (id === "logs" && importedLogs(activeEditWell()).length) return null;
  // An Equator well the user gave casing records draws its construction.
  const editedCasing = kind === "equator" && (editedValue(activeEditWell())?.components.some((component) => component.kind === "Casing") ?? false);
  const rule = availability[id];
  if (kind === "force" && rule && !rule.sites.includes("force")) return forceWhy[id] ?? FORCE_HAS;
  if (rule && !(kind && rule.sites.includes(kind)) && !(editedCasing && ["section", "construction", "cutaway", "strings", "barriers"].includes(id))) return rule.why;
  const design = designForSite(siteId);
  if (design) return designGap(id, design.history.current().brief);
  const recorded = recordedForSite(siteId);
  return recorded ? recordGap(id, recorded.history.current(), recorded.wellId) : null;
}

/** A drilled well being entered: which part of the editor supplies what a module needs. */
function recordGap(id: ModuleId, value: WellRecordValue, wellId: string): string | null {
  if (["well3d", "plan", "profile", "site3d"].includes(id) && value.stations.length < 2) return "No survey yet. In the Well editor, open Survey and paste, import or type the stations.";
  if (["section", "construction", "cutaway", "strings", "barriers"].includes(id) && !value.components.some((component) => component.kind === "Casing")) return "No casing records yet. In the Well editor, open Casing & hole and add them.";
  if (id === "logs" && !importedLogs(wellId).length) return "No logs yet. In the Well editor, open Logs and import a LAS file.";
  return null;
}

/** A planned well still being designed: which stage of the designer supplies what a module needs. */
function designGap(id: ModuleId, brief: WellDesignBrief): string | null {
  const pressures = brief.geology.pressures.length >= 2;
  if ((id === "window" || id === "kick" || id === "cement" || id === "rig") && !pressures) return "No pore and fracture pressures yet. In the Well designer, open Geology & pressures to add them.";
  if (["section", "construction", "cutaway", "strings", "barriers", "kick", "cement", "hydraulics", "rig"].includes(id) && !brief.sections.length) return "No casing yet. In the Well designer, open Casing and propose a scheme from the pressures, or add strings yourself.";
  if (id === "hydraulics" && !brief.sections.some((section) => section.role !== "conductor")) return "Hydraulics need a hole section below the conductor. In the Well designer, open Casing and add one.";
  return null;
}
/** Whether a reason points at the designer or the editor, so the empty tile can offer to open it. */
export const pointsToDesigner = (reason: string) => /Well designer/.test(reason);
export const pointsToEditor = (reason: string) => /Well editor/.test(reason);

/** The deck opens on the globe, staged, where every site is chosen; choosing one stages it in 3D. */
export type Tiles = Readonly<Partial<Record<ModuleId, Rect>>>;
export const initialLayout: Tiles = {
  globe: { col: 0, row: 0, w: 8, h: 8 },
  section: { col: 8, row: 0, w: 4, h: 8 },
};
export const initialStage: ModuleId = "globe";
