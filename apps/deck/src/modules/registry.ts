import type { LucideIcon } from "lucide-react";
import { Activity, AudioWaveform, Box, CalendarDays, Columns3, Compass, Cylinder, Droplets, Gauge, Layers2, ScatterChart, ShieldAlert, Waves, Globe2, Layers3, ListTree, Rotate3d } from "lucide-react";
import type { MinSize, Rect } from "../deck/layout.ts";

/** The six signals. Each has one colour, used for nothing else. */
export type Signal = "place" | "object" | "depth" | "time" | "view" | "whatif";
export const signalColour: Readonly<Record<Signal, string>> = {
  place: "var(--signal-place)", object: "var(--signal-object)", depth: "var(--signal-depth)",
  time: "var(--signal-time)", view: "var(--signal-view)", whatif: "var(--signal-whatif)",
};
export const signalName: Readonly<Record<Signal, string>> = { place: "Place", object: "Object", depth: "Depth", time: "Time", view: "View", whatif: "What-if" };

export type ModuleId =
  | "globe" | "site3d"
  | "section" | "well3d" | "construction" | "cutaway" | "plan" | "profile"
  | "logs" | "seismic"
  | "drilling"
  | "petro"
  | "strings" | "window" | "kick" | "cement" | "hydraulics";

export type ModuleGroup = "Place" | "Well" | "Data" | "Drilling" | "Engineering";

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
}

const place = ["place"] as const;
export const modules: readonly ModuleSpec[] = [
  { id: "globe", title: "Globe", icon: Globe2, group: "Place", blurb: "Every located well on an offline globe", listens: ["place", "depth"], emits: place, min: { w: 3, h: 3 }, size: { w: 5, h: 8 }, depthIndexed: false },
  { id: "site3d", title: "Site in 3D", icon: Box, group: "Place", blurb: "Wells, horizons and seismic in one frame", listens: ["place", "depth"], emits: ["place", "view"], min: { w: 3, h: 4 }, size: { w: 5, h: 8 }, depthIndexed: false },
  { id: "section", title: "Well section", icon: Layers3, group: "Well", blurb: "Construction, mud log and survey on one depth axis", listens: ["place", "object", "depth", "time", "whatif"], emits: ["object", "depth"], min: { w: 3, h: 4 }, size: { w: 4, h: 8 }, depthIndexed: true },
  { id: "well3d", title: "Well in 3D", icon: Rotate3d, group: "Well", blurb: "The well, its strings and the PSDM volume", listens: ["place", "object", "depth", "time", "whatif"], emits: ["object", "depth", "view"], min: { w: 3, h: 4 }, size: { w: 5, h: 8 }, depthIndexed: true },
  { id: "construction", title: "Construction", icon: Columns3, group: "Well", blurb: "The construction drawing: straight on a depth axis, or along the surveyed path", listens: ["place", "object", "depth", "time", "whatif"], emits: ["object", "depth"], min: { w: 4, h: 4 }, size: { w: 4, h: 8 }, depthIndexed: true },
  { id: "cutaway", title: "Cutaway", icon: Cylinder, group: "Well", blurb: "The construction as a 3D cutaway", listens: ["place", "object", "time", "whatif"], emits: ["object"], min: { w: 3, h: 4 }, size: { w: 4, h: 6 }, depthIndexed: false },
  { id: "plan", title: "Plan view", icon: Compass, group: "Well", blurb: "The path from above: north, east, closure", listens: ["place", "depth"], emits: ["depth"], min: { w: 3, h: 3 }, size: { w: 4, h: 4 }, depthIndexed: true },
  { id: "profile", title: "Vertical section", icon: Activity, group: "Well", blurb: "Departure against TVD, with formations", listens: ["place", "depth"], emits: ["depth"], min: { w: 3, h: 3 }, size: { w: 4, h: 4 }, depthIndexed: true },
  { id: "logs", title: "Logs", icon: ListTree, group: "Data", blurb: "The well's LAS curves; Shift-drag to brush an interval", listens: ["place", "object", "depth", "time"], emits: ["depth"], min: { w: 3, h: 4 }, size: { w: 4, h: 8 }, depthIndexed: true },
  { id: "seismic", title: "Seismic section", icon: AudioWaveform, group: "Data", blurb: "PSDM along the well, with its strings", listens: ["place", "object", "depth"], emits: ["depth"], min: { w: 3, h: 4 }, size: { w: 5, h: 6 }, depthIndexed: true },
  { id: "drilling", title: "Drilling record", icon: CalendarDays, group: "Drilling", blurb: "Days vs depth, hole sections, runs and the daily reports", listens: ["place", "object", "depth", "time"], emits: ["object", "depth", "time"], min: { w: 3, h: 4 }, size: { w: 4, h: 6 }, depthIndexed: true },
  { id: "petro", title: "Petrophysics", icon: ScatterChart, group: "Data", blurb: "Porosity, saturation and pay over the brushed interval", listens: ["place", "object", "depth"], emits: ["object", "depth"], min: { w: 4, h: 4 }, size: { w: 5, h: 8 }, depthIndexed: false },
  { id: "strings", title: "Strings", icon: Gauge, group: "Engineering", blurb: "Each string's record and API ratings; on a design, burst, collapse and tension against them, live", listens: ["place", "object", "time", "whatif"], emits: ["object", "whatif"], min: { w: 4, h: 4 }, size: { w: 5, h: 6 }, depthIndexed: false },
  { id: "window", title: "Pressure window", icon: Layers2, group: "Engineering", blurb: "Pore, fracture and the mud weights between them", listens: ["place", "depth", "whatif"], emits: ["depth", "whatif"], min: { w: 3, h: 4 }, size: { w: 4, h: 8 }, depthIndexed: true },
  { id: "kick", title: "Kick tolerance", icon: ShieldAlert, group: "Engineering", blurb: "The influx each shoe can take while drilling on", listens: ["place", "object", "whatif"], emits: ["object", "whatif"], min: { w: 3, h: 3 }, size: { w: 4, h: 4 }, depthIndexed: false },
  { id: "cement", title: "Cement", icon: Droplets, group: "Engineering", blurb: "Slurry volumes and the column against fracture", listens: ["place", "object", "whatif"], emits: ["object", "whatif"], min: { w: 3, h: 4 }, size: { w: 4, h: 5 }, depthIndexed: false },
  { id: "hydraulics", title: "Hydraulics", icon: Waves, group: "Engineering", blurb: "Bit pressure drop, jet velocity and annular velocity", listens: ["place", "whatif"], emits: ["whatif"], min: { w: 3, h: 3 }, size: { w: 4, h: 4 }, depthIndexed: false },
];
export const moduleById = Object.fromEntries(modules.map((spec) => [spec.id, spec])) as Readonly<Record<ModuleId, ModuleSpec>>;
export const moduleIds = modules.map((spec) => spec.id);
export const minSizes = Object.fromEntries(modules.map((spec) => [spec.id, spec.min])) as Readonly<Record<ModuleId, MinSize>>;
export const groups: readonly ModuleGroup[] = ["Place", "Well", "Data", "Drilling", "Engineering"];

type SiteId = "forge" | "kestrel" | "equator";
/** Which sites have the data each module draws; a site missing from a list gets that module's reason. */
const availability: Readonly<Partial<Record<ModuleId, { readonly sites: readonly SiteId[]; readonly why: string }>>> = {
  section: { sites: ["forge", "kestrel"], why: "No construction records: the Equator wells are synthetic trajectories with logs and picks." },
  well3d: { sites: ["forge", "kestrel"], why: "No construction to draw: open the site in 3D for the Equator wells' paths and picks." },
  construction: { sites: ["forge", "kestrel"], why: "No construction records for the Equator wells." },
  cutaway: { sites: ["forge", "kestrel"], why: "No construction records for the Equator wells." },
  plan: { sites: ["forge", "kestrel", "equator"], why: "" },
  profile: { sites: ["forge", "kestrel", "equator"], why: "" },
  logs: { sites: ["forge", "equator"], why: "Kestrel A-7 is a design: it has not been drilled, so it has no logs." },
  seismic: { sites: ["forge"], why: "Only Utah FORGE has seismic: the PSDM volume around 16A(78)-32." },
  drilling: { sites: ["forge"], why: "Only Utah FORGE has been drilled: daily reports, hole sections and runs exist only for it." },
  petro: { sites: ["forge", "equator"], why: "Kestrel A-7 is a design: it has not been drilled, so it has no logs." },
  strings: { sites: ["forge", "kestrel"], why: "The Equator wells have no casing records." },
  window: { sites: ["kestrel"], why: "A pressure window needs pore and fracture pressures; only Kestrel A-7's design brief has them." },
  kick: { sites: ["kestrel"], why: "Kick tolerance needs fracture gradients at the shoes; only Kestrel A-7's design brief has them." },
  cement: { sites: ["kestrel"], why: "Cement design needs planned slurries and fracture gradients; only Kestrel A-7's design brief has them." },
  hydraulics: { sites: ["kestrel"], why: "Hydraulics need a hole section, mud and drill string; Kestrel A-7's design supplies them, with flow and nozzles you set." },
};

/** What a module needs that the place does not have; null when it can show something. */
export function missing(id: ModuleId, siteId: string | null): string | null {
  if (id === "globe") return null;
  if (!siteId) return "Choose a site on the globe or press ⌘K.";
  const rule = availability[id];
  if (!rule) return null;
  return rule.sites.includes(siteId as SiteId) ? null : rule.why;
}

/** The deck opens on the globe, staged, where every site is chosen; choosing one stages it in 3D. */
export type Tiles = Readonly<Partial<Record<ModuleId, Rect>>>;
export const initialLayout: Tiles = {
  globe: { col: 0, row: 0, w: 8, h: 8 },
  section: { col: 8, row: 0, w: 4, h: 8 },
};
export const initialStage: ModuleId = "globe";
