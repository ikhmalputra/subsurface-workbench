import type { ComponentKind, WellComponent } from "./index.ts";

/**
 * Plug-and-play well assembly model.
 *
 * Components are placed by dropping a catalog entry at a measured depth. Placement
 * rules snap the entry to a sensible host (casing hangs from the wellhead, cement
 * fills the annulus above a shoe, completion tools ride on tubing) and every edit
 * returns a new frozen revision. Hard impossibilities throw `AssemblyPlacementError`;
 * engineering concerns are reported by `validateAssembly` so users can keep working.
 * Default sizes are common nominal values for illustration, not a design basis.
 */

export type AssemblySlot = "surface" | "casing" | "liner" | "cement" | "tubing" | "tubing-tool" | "casing-tool" | "sandface" | "plug";
export type AssemblyCategory = "Wellhead & tree" | "Casing strings" | "Casing accessories" | "Cement" | "Upper completion" | "Artificial lift" | "Lower completion" | "Plugs & abandonment";
/** Palette order of the catalog categories. */
export const assemblyCategories: readonly AssemblyCategory[] = Object.freeze(["Wellhead & tree", "Casing strings", "Casing accessories", "Cement", "Upper completion", "Artificial lift", "Lower completion", "Plugs & abandonment"]);

export interface AssemblyCatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly category: AssemblyCategory;
  readonly slot: AssemblySlot;
  readonly kind: ComponentKind;
  readonly description: string;
  readonly placementHint: string;
  readonly odIn: number;
  readonly idIn: number | null;
  /** Tool length for point equipment, default interval length for liners, screens and plugs. */
  readonly lengthM: number;
  readonly color: string;
  readonly asset: { readonly thumbnail: string; readonly model?: string };
  /** Surface stack position from the ground up; equal values occupy the same position. */
  readonly stackOrder?: number;
  /** Catalog ids that must already be installed. */
  readonly requires?: readonly string[];
  /** Only one member of the group per assembly (surface) or per host string (casing accessories). */
  readonly exclusiveGroup?: string;
  /** Casing accessories: at the shoe, a fixed distance above it, liner top only, or anywhere on the string. */
  readonly attach?: "shoe" | "shoe-track" | "liner-top" | "anywhere";
  /** Shoe-track accessories: distance above the shoe. */
  readonly shoeTrackOffsetM?: number;
  /** Tubing tools that seal against the casing are sized to its inside diameter. */
  readonly sealsToCasing?: boolean;
  /** Tubing tools that must sit at the tubing tail. */
  readonly atTubingTail?: boolean;
  /** Lower completion: needs a cased interval (perforations) rather than open hole. */
  readonly needsCasing?: boolean;
  /** Advisory setting-depth limit. */
  readonly maxTypicalDepthM?: number;
  /** Typical position used for click-to-add: fraction of tubing length for tubing tools, of total depth for casing shoes. */
  readonly typicalDepthFraction?: number;
}

export interface AssemblyItem {
  readonly id: string;
  readonly catalogId: string;
  readonly label: string;
  readonly topM: number;
  readonly bottomM: number;
  readonly odIn: number;
  readonly idIn: number | null;
  readonly hostId?: string;
}

export interface WellAssembly {
  readonly id: string;
  readonly name: string;
  readonly totalDepthM: number;
  readonly revision: number;
  readonly items: readonly AssemblyItem[];
}

export interface AssemblyIssue {
  readonly severity: "error" | "warning" | "info";
  readonly itemId?: string;
  readonly code: string;
  readonly message: string;
}

export interface PlacementResult {
  readonly assembly: WellAssembly;
  readonly itemId: string;
  readonly note: string;
}

export interface AssemblyItemPatch {
  readonly label?: string;
  readonly topM?: number;
  readonly bottomM?: number;
  readonly odIn?: number;
  readonly idIn?: number | null;
}

export class AssemblyPlacementError extends Error {
  override readonly name = "AssemblyPlacementError";
}

type EntryInput = Omit<AssemblyCatalogEntry, "asset"> & { readonly model?: boolean };
const entry = ({ model = true, ...value }: EntryInput): AssemblyCatalogEntry => Object.freeze({ ...value, ...(value.requires ? { requires: Object.freeze([...value.requires]) } : {}), asset: Object.freeze({ thumbnail: `${value.id}.png`, ...(model ? { model: `${value.id}.glb` } : {}) }) });
const surfaceHint = "Snaps into the surface stack";
const toolHint = "Rides on tubing";
const W = "Wellhead & tree", CS = "Casing strings", CA = "Casing accessories", UC = "Upper completion", AL = "Artificial lift", LC = "Lower completion", PA = "Plugs & abandonment";

export const assemblyCatalog: readonly AssemblyCatalogEntry[] = Object.freeze([
  entry({ id: "wellhead", label: "Casing head (A-section)", category: W, slot: "surface", kind: "Wellhead", description: "Lowest wellhead section, landed on the surface casing; suspends the next casing and gives annulus A access.", placementHint: surfaceHint, odIn: 21.25, idIn: null, lengthM: 0, color: "#3f4a52", stackOrder: 1 }),
  entry({ id: "casing-spool", label: "Casing spool (B-section)", category: W, slot: "surface", kind: "Wellhead", description: "Intermediate spool that suspends the next casing string and isolates annulus B.", placementHint: surfaceHint, odIn: 20, idIn: null, lengthM: 0, color: "#4b5961", stackOrder: 2, requires: ["wellhead"] }),
  entry({ id: "tubing-head", label: "Tubing head spool", category: W, slot: "surface", kind: "Wellhead", description: "Top spool whose bowl lands the tubing hanger; outlets give tubing-casing annulus access.", placementHint: surfaceHint, odIn: 18, idIn: null, lengthM: 0, color: "#56646c", stackOrder: 3, requires: ["wellhead"] }),
  entry({ id: "tubing-hanger", label: "Tubing hanger", category: W, slot: "surface", kind: "Wellhead", description: "Suspends the tubing in the tubing head and seals the annulus; carries control-line feed-throughs.", placementHint: "Lands in the tubing head bowl", odIn: 11, idIn: 3.958, lengthM: 0, color: "#87949a", stackOrder: 3, requires: ["tubing-head"] }),
  entry({ id: "christmas-tree", label: "Christmas tree (vertical)", category: W, slot: "surface", kind: "Valve", description: "Master, wing and swab valves stacked above the tubing head; flow leaves through the wing.", placementHint: surfaceHint, odIn: 13.625, idIn: null, lengthM: 0, color: "#b4372b", stackOrder: 4, requires: ["wellhead"], exclusiveGroup: "top" }),
  entry({ id: "horizontal-tree", label: "Horizontal tree", category: W, slot: "surface", kind: "Valve", description: "Tree with valves on the side outlet so the tubing can be pulled without removing it.", placementHint: surfaceHint, odIn: 16, idIn: null, lengthM: 0, color: "#a33a2c", stackOrder: 4, requires: ["wellhead"], exclusiveGroup: "top" }),
  entry({ id: "bop-stack", label: "BOP stack (drilling)", category: W, slot: "surface", kind: "Valve", description: "Annular and ram preventers installed while drilling; replaced by the tree at completion.", placementHint: surfaceHint, odIn: 30, idIn: null, lengthM: 0, color: "#b8402e", stackOrder: 4, requires: ["wellhead"], exclusiveGroup: "top" }),

  entry({ id: "conductor", typicalDepthFraction: 0.03, label: "Conductor", category: CS, slot: "casing", kind: "Casing", description: "Large-bore structural pipe that supports the wellhead and prevents shallow washout.", placementHint: "Hangs from surface; drop depth sets the shoe", odIn: 30, idIn: 28, lengthM: 0, color: "#4b555c", model: false }),
  entry({ id: "surface-casing", typicalDepthFraction: 0.18, label: "Surface casing", category: CS, slot: "casing", kind: "Casing", description: "Protects shallow aquifers and carries the wellhead load.", placementHint: "Hangs from surface; drop depth sets the shoe", odIn: 20, idIn: 18.73, lengthM: 0, color: "#197c6e", model: false }),
  entry({ id: "intermediate-casing", typicalDepthFraction: 0.5, label: "Intermediate casing", category: CS, slot: "casing", kind: "Casing", description: "Isolates weak or overpressured intervals before the reservoir section.", placementHint: "Hangs from surface; drop depth sets the shoe", odIn: 13.375, idIn: 12.415, lengthM: 0, color: "#3c63a6", model: false }),
  entry({ id: "production-casing", typicalDepthFraction: 0.85, label: "Production casing", category: CS, slot: "casing", kind: "Casing", description: "Final pressure barrier through or above the reservoir.", placementHint: "Hangs from surface; drop depth sets the shoe", odIn: 9.625, idIn: 8.681, lengthM: 0, color: "#c25737", model: false }),
  entry({ id: "tieback-casing", label: "Tieback casing", category: CS, slot: "casing", kind: "Casing", description: "String run from surface down to a liner top to restore a full-bore pressure barrier.", placementHint: "Hangs from surface; drop depth sets the seal stem", odIn: 7, idIn: 6.184, lengthM: 0, color: "#b5653f", model: false }),
  entry({ id: "drilling-liner", label: "Drilling liner + hanger", category: CS, slot: "liner", kind: "Casing", description: "Intermediate liner hung below the previous shoe to isolate a problem zone without a full string.", placementHint: "Drop inside a casing; drop depth sets the hanger", odIn: 7.625, idIn: 6.875, lengthM: 800, color: "#4f6fae" }),
  entry({ id: "liner", label: "Production liner + hanger", category: CS, slot: "liner", kind: "Casing", description: "Short string hung inside the previous casing across the reservoir.", placementHint: "Drop inside a casing; drop depth sets the hanger", odIn: 7, idIn: 6.184, lengthM: 600, color: "#7c4a8e" }),

  entry({ id: "float-shoe", label: "Float shoe", category: CA, slot: "casing-tool", kind: "Casing", description: "Rounded guide nose with a check valve at the bottom of a string; stops cement U-tubing back.", placementHint: "Snaps to the nearest shoe", odIn: 10.5, idIn: null, lengthM: 0.6, color: "#a8aca7", attach: "shoe", exclusiveGroup: "shoe" }),
  entry({ id: "guide-shoe", label: "Guide shoe", category: CA, slot: "casing-tool", kind: "Casing", description: "Cement-nosed shoe without a valve that guides the string past ledges.", placementHint: "Snaps to the nearest shoe", odIn: 10.5, idIn: null, lengthM: 0.5, color: "#b1b4ae", attach: "shoe", exclusiveGroup: "shoe" }),
  entry({ id: "float-collar", label: "Float collar", category: CA, slot: "casing-tool", kind: "Casing", description: "Second check valve one to two joints above the shoe; the shoe track between them keeps contaminated cement off the shoe.", placementHint: "Snaps 24 m above the nearest shoe", odIn: 10.6, idIn: null, lengthM: 0.6, color: "#8f9893", attach: "shoe-track", shoeTrackOffsetM: 24, exclusiveGroup: "float-collar" }),
  entry({ id: "landing-collar", label: "Landing collar", category: CA, slot: "casing-tool", kind: "Casing", description: "Baffle that catches the wiper plug and gives the bump-pressure signal at the end of displacement.", placementHint: "Snaps 36 m above the nearest shoe", odIn: 10.6, idIn: null, lengthM: 0.5, color: "#7d8682", attach: "shoe-track", shoeTrackOffsetM: 36, exclusiveGroup: "landing-collar" }),
  entry({ id: "centralizer", label: "Bow-spring centralizer", category: CA, slot: "casing-tool", kind: "Centralizer", description: "Bow springs stand the casing off the wall so cement can surround it.", placementHint: "Clamps to the innermost casing at the drop depth", odIn: 12, idIn: null, lengthM: 1.2, color: "#87949a", attach: "anywhere" }),
  entry({ id: "rigid-centralizer", label: "Rigid centralizer", category: CA, slot: "casing-tool", kind: "Centralizer", description: "Solid spiral blades for deviated sections and inside previous casing.", placementHint: "Clamps to the innermost casing at the drop depth", odIn: 11.5, idIn: null, lengthM: 0.9, color: "#6f7b80", attach: "anywhere" }),
  entry({ id: "stage-tool", label: "Stage cementing tool (DV)", category: CA, slot: "casing-tool", kind: "Casing", description: "Ported collar opened by a plug to cement a second stage above weak zones.", placementHint: "Made up in the innermost casing at the drop depth", odIn: 11, idIn: null, lengthM: 1.5, color: "#5d6b72", attach: "anywhere" }),
  entry({ id: "cement-basket", label: "Cement basket", category: CA, slot: "casing-tool", kind: "Centralizer", description: "Petal basket that supports the cement column above a lost-circulation zone.", placementHint: "Clamps to the innermost casing at the drop depth", odIn: 14, idIn: null, lengthM: 1, color: "#a59f8c", attach: "anywhere" }),
  entry({ id: "liner-top-packer", label: "Liner top packer", category: CA, slot: "casing-tool", kind: "Packer", description: "Seals the liner lap so gas cannot migrate up the liner annulus.", placementHint: "Snaps to the top of the liner", odIn: 8.4, idIn: null, lengthM: 3, color: "#5c3a6e", attach: "liner-top", exclusiveGroup: "liner-top" }),

  entry({ id: "cement", label: "Cement sheath", category: "Cement", slot: "cement", kind: "Cement", description: "Annular cement from the top of cement down to the shoe; the primary barrier behind casing.", placementHint: "Drop beside a string; drop depth sets top of cement", odIn: 0, idIn: null, lengthM: 0, color: "#9ba3a0", model: false }),

  entry({ id: "tubing", label: "Production tubing", category: UC, slot: "tubing", kind: "Tubular", description: "Flow conduit hung from the tubing hanger.", placementHint: "Hangs from surface; drop depth sets the tail", odIn: 4.5, idIn: 3.958, lengthM: 0, color: "#c49320", model: false }),
  entry({ id: "safety-valve", label: "Safety valve (TRSSSV)", category: UC, slot: "tubing-tool", kind: "Safety valve", description: "Fail-safe flapper held open by control-line pressure; closes if surface control is lost.", placementHint: "Rides on tubing; typically set shallow", odIn: 5.97, idIn: 3.813, lengthM: 2.5, color: "#b4372b", maxTypicalDepthM: 600, typicalDepthFraction: 0.1 }),
  entry({ id: "landing-nipple", label: "Landing nipple (selective)", category: UC, slot: "tubing-tool", kind: "Landing nipple", description: "Seal-bore profile for wireline plugs, chokes or gauges.", placementHint: toolHint, odIn: 5.2, idIn: 3.813, lengthM: 0.6, color: "#87949a", typicalDepthFraction: 0.93 }),
  entry({ id: "no-go-nipple", label: "No-go nipple", category: UC, slot: "tubing-tool", kind: "Landing nipple", description: "Bottom nipple with a reduced no-go shoulder that stops tools falling out of the tubing.", placementHint: toolHint, odIn: 5.2, idIn: 3.725, lengthM: 0.6, color: "#7a878d", typicalDepthFraction: 0.985 }),
  entry({ id: "chemical-injection-mandrel", label: "Chemical injection mandrel", category: UC, slot: "tubing-tool", kind: "Gas lift mandrel", description: "Injects scale or corrosion inhibitor through a capillary line from surface.", placementHint: toolHint, odIn: 5.97, idIn: 3.958, lengthM: 2, color: "#2f7a6b", typicalDepthFraction: 0.85 }),
  entry({ id: "gauge", label: "Downhole gauge", category: UC, slot: "tubing-tool", kind: "Gauge", description: "Permanent pressure and temperature gauge on a cable to surface.", placementHint: toolHint, odIn: 5.5, idIn: 3.958, lengthM: 1.5, color: "#246b7a", typicalDepthFraction: 0.95 }),
  entry({ id: "sliding-sleeve", label: "Sliding sleeve (SSD)", category: UC, slot: "tubing-tool", kind: "Landing nipple", description: "Ported sleeve shifted on wireline to circulate between tubing and annulus.", placementHint: toolHint, odIn: 5.5, idIn: 3.813, lengthM: 1.5, color: "#5d7f8c", typicalDepthFraction: 0.9 }),
  entry({ id: "flow-coupling", label: "Flow coupling", category: UC, slot: "tubing-tool", kind: "Tubular", description: "Heavy-wall sub above and below nipples where turbulence causes erosion.", placementHint: toolHint, odIn: 5.2, idIn: 3.958, lengthM: 1.8, color: "#9a7a2a", typicalDepthFraction: 0.92 }),
  entry({ id: "blast-joint", label: "Blast joint", category: UC, slot: "tubing-tool", kind: "Tubular", description: "Hardened joint placed opposite perforations to resist jetting erosion.", placementHint: toolHint, odIn: 5.5, idIn: 3.958, lengthM: 6, color: "#6a5a33", typicalDepthFraction: 0.6 }),
  entry({ id: "expansion-joint", label: "Expansion joint", category: UC, slot: "tubing-tool", kind: "Tubular", description: "Telescoping joint that absorbs thermal length change between packer and hanger.", placementHint: toolHint, odIn: 5.97, idIn: 3.875, lengthM: 6, color: "#a68933", typicalDepthFraction: 0.7 }),
  entry({ id: "seal-assembly", label: "Seal assembly", category: UC, slot: "tubing-tool", kind: "Packer", description: "Seal stack that stings into a permanent packer bore or liner-top receptacle.", placementHint: toolHint, odIn: 5.5, idIn: 3.875, lengthM: 3, color: "#433a2e", typicalDepthFraction: 0.98 }),
  entry({ id: "packer", label: "Retrievable packer", category: UC, slot: "tubing-tool", kind: "Packer", description: "Mechanically or hydraulically set packer that seals the tubing-casing annulus and can be pulled.", placementHint: "Rides on tubing; sized to the casing ID", odIn: 8.25, idIn: 3.875, lengthM: 3, color: "#22272b", sealsToCasing: true, typicalDepthFraction: 0.97 }),
  entry({ id: "permanent-packer", label: "Permanent packer", category: UC, slot: "tubing-tool", kind: "Packer", description: "Packer set on wireline or tubing that is milled to remove; tubing seals into its bore.", placementHint: "Rides on tubing; sized to the casing ID", odIn: 8.25, idIn: 4, lengthM: 2.5, color: "#3a2a24", sealsToCasing: true, typicalDepthFraction: 0.99 }),
  entry({ id: "wireline-entry-guide", label: "Wireline entry guide", category: UC, slot: "tubing-tool", kind: "Tubular", description: "Bell-mouthed tubing tail that guides wireline tools back into the tubing.", placementHint: "Snaps to the tubing tail", odIn: 5, idIn: 3.958, lengthM: 0.4, color: "#8b8f87", atTubingTail: true, exclusiveGroup: "tail" }),

  entry({ id: "gas-lift-mandrel", label: "Gas lift mandrel", category: AL, slot: "tubing-tool", kind: "Gas lift mandrel", description: "Side-pocket mandrel holding a retrievable gas lift valve.", placementHint: toolHint, odIn: 5.97, idIn: 3.958, lengthM: 2.4, color: "#c49320", typicalDepthFraction: 0.45 }),
  entry({ id: "esp", label: "Electric submersible pump", category: AL, slot: "tubing-tool", kind: "Tubular", description: "Multistage centrifugal pump, intake, seal section and motor powered by a cable from surface.", placementHint: toolHint, odIn: 5.62, idIn: null, lengthM: 30, color: "#2c5f8a", typicalDepthFraction: 0.97 }),
  entry({ id: "rod-pump", label: "Sucker rod pump", category: AL, slot: "tubing-tool", kind: "Tubular", description: "Reciprocating plunger pump driven by a rod string from a surface pumping unit.", placementHint: toolHint, odIn: 4, idIn: null, lengthM: 7, color: "#6f5a3c", typicalDepthFraction: 0.97 }),
  entry({ id: "pcp", label: "Progressing cavity pump", category: AL, slot: "tubing-tool", kind: "Tubular", description: "Helical rotor turning in an elastomer stator; suits viscous and sandy oil.", placementHint: toolHint, odIn: 4.5, idIn: null, lengthM: 8, color: "#7b4b2a", typicalDepthFraction: 0.97 }),
  entry({ id: "jet-pump", label: "Jet pump", category: AL, slot: "tubing-tool", kind: "Tubular", description: "Hydraulic pump: power fluid through a nozzle and throat entrains well fluid.", placementHint: toolHint, odIn: 4.5, idIn: null, lengthM: 2, color: "#4f6b7a", typicalDepthFraction: 0.95 }),

  entry({ id: "perforations", label: "Perforations", category: LC, slot: "sandface", kind: "Hole", description: "Shaped-charge tunnels through casing and cement that connect the reservoir to the well.", placementHint: "Shoots across the drop interval of the innermost string", odIn: 7, idIn: null, lengthM: 20, color: "#d1342b", needsCasing: true }),
  entry({ id: "wire-wrap-screen", label: "Wire-wrapped screen", category: LC, slot: "sandface", kind: "Tubular", description: "Keystone wire wrapped on a perforated base pipe to hold back formation sand.", placementHint: "Spans the drop interval", odIn: 5, idIn: 3.958, lengthM: 60, color: "#9ea7aa" }),
  entry({ id: "premium-screen", label: "Premium mesh screen", category: LC, slot: "sandface", kind: "Tubular", description: "Woven metal mesh under a perforated shroud for finer sand control.", placementHint: "Spans the drop interval", odIn: 5.2, idIn: 3.958, lengthM: 60, color: "#7f8b90" }),
  entry({ id: "gravel-pack", label: "Gravel pack", category: LC, slot: "sandface", kind: "Tubular", description: "Sized gravel placed around a screen to filter formation sand.", placementHint: "Spans the drop interval", odIn: 6, idIn: 3.958, lengthM: 60, color: "#b99a63" }),
  entry({ id: "icd-screen", label: "ICD screen", category: LC, slot: "sandface", kind: "Tubular", description: "Screen with an inflow-control nozzle that evens out inflow along a horizontal well.", placementHint: "Spans the drop interval", odIn: 5.3, idIn: 3.958, lengthM: 12, color: "#5f7d86" }),
  entry({ id: "swell-packer", label: "Swellable packer", category: LC, slot: "sandface", kind: "Packer", description: "Elastomer that swells in oil or water to isolate open-hole compartments.", placementHint: "Spans the drop interval", odIn: 6, idIn: 3.958, lengthM: 6, color: "#2a2a2a" }),
  entry({ id: "frac-sleeve", label: "Frac sleeve", category: LC, slot: "sandface", kind: "Tubular", description: "Ball-activated ported sleeve that opens one fracturing stage at a time.", placementHint: "Spans the drop interval", odIn: 5.75, idIn: 3.5, lengthM: 1.5, color: "#3f5a7a" }),
  entry({ id: "slotted-liner", label: "Slotted liner", category: LC, slot: "sandface", kind: "Tubular", description: "Pipe with machined slots for open-hole completions in competent rock.", placementHint: "Spans the drop interval", odIn: 5.5, idIn: 4.892, lengthM: 100, color: "#7c4a8e" }),
  entry({ id: "icv", label: "Interval control valve", category: LC, slot: "tubing-tool", kind: "Safety valve", description: "Hydraulically choked valve that controls inflow from one zone in an intelligent completion.", placementHint: toolHint, odIn: 5.6, idIn: 3.688, lengthM: 3, color: "#36606f", typicalDepthFraction: 0.99 }),

  entry({ id: "bridge-plug", label: "Bridge plug", category: PA, slot: "plug", kind: "Packer", description: "Slips and an elastomer element that seal the casing bore below a zone.", placementHint: "Sets in the innermost string at the drop depth", odIn: 8.4, idIn: null, lengthM: 1, color: "#3b3f44", needsCasing: true }),
  entry({ id: "cement-plug", label: "Cement plug", category: PA, slot: "plug", kind: "Cement", description: "Balanced cement column placed inside the well as a permanent barrier.", placementHint: "Fills the bore from the drop depth down", odIn: 8.6, idIn: null, lengthM: 50, color: "#9ba3a0" }),
  entry({ id: "cement-retainer", label: "Cement retainer", category: PA, slot: "plug", kind: "Packer", description: "Drillable packer that lets cement be squeezed below it through a stinger.", placementHint: "Sets in the innermost string at the drop depth", odIn: 8.4, idIn: null, lengthM: 1, color: "#2c2e31", needsCasing: true }),
]);

const catalogIndex = new Map(assemblyCatalog.map((value) => [value.id, value]));

export function getCatalogEntry(catalogId: string): AssemblyCatalogEntry {
  const value = catalogIndex.get(catalogId);
  if (!value) throw new AssemblyPlacementError(`Unknown catalog component: ${catalogId}`);
  return value;
}

const isString = (item: AssemblyItem) => { const slot = getCatalogEntry(item.catalogId).slot; return slot === "casing" || slot === "liner"; };
const round = (value: number) => Math.round(value * 10) / 10;
const freezeItem = (item: AssemblyItem): AssemblyItem => Object.freeze({ ...item, topM: round(item.topM), bottomM: round(item.bottomM) });

function revise(assembly: WellAssembly, items: readonly AssemblyItem[]): WellAssembly {
  return Object.freeze({ ...assembly, revision: assembly.revision + 1, items: Object.freeze(reconcile(items).map(freezeItem)) });
}

function nextId(items: readonly AssemblyItem[], catalogId: string): string {
  const used = new Set(items.map((item) => item.id));
  let index = 1;
  while (used.has(`${catalogId}-${index}`)) index += 1;
  return `${catalogId}-${index}`;
}

function finiteDepth(value: number, label: string) {
  if (!Number.isFinite(value)) throw new AssemblyPlacementError(`${label} must be a finite depth.`);
}

export function createAssembly(input: { readonly name: string; readonly totalDepthM: number; readonly id?: string }): WellAssembly {
  if (!input.name.trim()) throw new RangeError("Assembly name is required.");
  if (!Number.isFinite(input.totalDepthM) || input.totalDepthM < 50) throw new RangeError("Total depth must be at least 50 m.");
  return Object.freeze({ id: input.id ?? `assembly-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`, name: input.name.trim(), totalDepthM: input.totalDepthM, revision: 1, items: Object.freeze([]) });
}

/** Strings (casing and liner) covering a depth, innermost (smallest OD) first. */
export function stringsAtDepth(assembly: WellAssembly, depthM: number): readonly AssemblyItem[] {
  return assembly.items.filter((item) => isString(item) && item.topM <= depthM && item.bottomM >= depthM).sort((a, b) => a.odIn - b.odIn);
}

function tubingAt(items: readonly AssemblyItem[], depthM: number) {
  return items.find((item) => item.catalogId === "tubing" && item.topM <= depthM && item.bottomM >= depthM);
}

function nearestShoe(assembly: WellAssembly, depthM: number) {
  const strings = assembly.items.filter(isString);
  return strings.sort((a, b) => Math.abs(a.bottomM - depthM) - Math.abs(b.bottomM - depthM))[0];
}

function nearestLinerTop(assembly: WellAssembly, depthM: number) {
  return assembly.items.filter((item) => getCatalogEntry(item.catalogId).slot === "liner").sort((a, b) => Math.abs(a.topM - depthM) - Math.abs(b.topM - depthM))[0];
}

function cementHost(assembly: WellAssembly, depthM: number) {
  const covering = assembly.items.filter((item) => isString(item) && item.topM <= depthM + 1 && item.bottomM >= depthM);
  return covering.sort((a, b) => (a.bottomM - depthM) - (b.bottomM - depthM))[0];
}

/** Host string for a casing accessory, chosen from its attach rule. */
function accessoryHost(assembly: WellAssembly, spec: AssemblyCatalogEntry, depthM: number) {
  switch (spec.attach) {
    case "shoe":
    case "shoe-track": return nearestShoe(assembly, depthM + (spec.shoeTrackOffsetM ?? 0));
    case "liner-top": return nearestLinerTop(assembly, depthM);
    default: return stringsAtDepth(assembly, depthM)[0];
  }
}

/** Interval an accessory occupies on its host string. */
function accessoryInterval(spec: AssemblyCatalogEntry, host: AssemblyItem, depthM: number, length = spec.lengthM): { topM: number; bottomM: number } {
  switch (spec.attach) {
    case "shoe": return { topM: host.bottomM - length, bottomM: host.bottomM };
    case "shoe-track": { const top = Math.max(host.topM, host.bottomM - (spec.shoeTrackOffsetM ?? 0)); return { topM: top, bottomM: top + length }; }
    case "liner-top": return { topM: host.topM, bottomM: host.topM + length };
    default: { const top = Math.max(host.topM, Math.min(depthM, host.bottomM - length)); return { topM: top, bottomM: top + length }; }
  }
}

function accessoryOd(spec: AssemblyCatalogEntry, host: AssemblyItem, items: readonly AssemblyItem[]) {
  if (spec.attach === "shoe" || spec.attach === "shoe-track") return host.odIn;
  if (spec.attach === "liner-top") {
    const outer = items.find((item) => item.id === host.hostId);
    return round(Math.max(host.odIn + 0.5, (outer?.idIn ?? host.odIn + 1.4) - 0.3));
  }
  return round(host.odIn + Math.max(0.5, spec.odIn - 9.625));
}

const sameGroup = (left: AssemblyCatalogEntry, right: AssemblyCatalogEntry) => left.id === right.id || (left.exclusiveGroup !== undefined && left.exclusiveGroup === right.exclusiveGroup);

export interface PlacementOptions {
  /** Attach to this string instead of resolving the host from the drop depth (cement, accessories, sandface, plugs). */
  readonly hostId?: string;
}

/** Drop a catalog entry at a measured depth. Returns the new revision and the id of the placed item. */
export function placeComponent(assembly: WellAssembly, catalogId: string, depthM: number, options: PlacementOptions = {}): PlacementResult {
  const spec = getCatalogEntry(catalogId);
  finiteDepth(depthM, "Drop depth");
  const td = assembly.totalDepthM;
  const depth = Math.min(Math.max(depthM, 0), td);
  const items = [...assembly.items];
  const base = { id: nextId(items, catalogId), catalogId, label: spec.label, odIn: spec.odIn, idIn: spec.idIn };
  const forced = options.hostId === undefined ? undefined : items.find((value) => value.id === options.hostId && isString(value));
  if (options.hostId !== undefined && !forced) throw new AssemblyPlacementError(`Unknown host string: ${options.hostId}`);
  let item: AssemblyItem;
  let note: string;
  switch (spec.slot) {
    case "surface": {
      const clash = items.find((value) => sameGroup(spec, getCatalogEntry(value.catalogId)));
      if (clash?.catalogId === catalogId) throw new AssemblyPlacementError(`${spec.label} is already installed; select it to edit instead.`);
      if (clash) throw new AssemblyPlacementError(`${clash.label} already occupies that position in the stack; remove it before installing the ${spec.label}.`);
      for (const required of spec.requires ?? []) {
        if (!items.some((value) => value.catalogId === required)) throw new AssemblyPlacementError(`${spec.label} sits on the wellhead stack; install the ${getCatalogEntry(required).label} first.`);
      }
      item = { ...base, topM: 0, bottomM: 0 };
      note = `${spec.label} snapped into the surface stack.`;
      break;
    }
    case "casing": {
      const shoe = Math.max(depth, 10);
      item = { ...base, topM: 0, bottomM: shoe };
      note = `${spec.label} hung from surface with shoe at ${round(shoe)} m MD.`;
      break;
    }
    case "liner": {
      const host = stringsAtDepth(assembly, depth)[0];
      if (!host) throw new AssemblyPlacementError("A liner must hang inside an existing casing string; drop it within a cased interval.");
      const hostId = host.idIn ?? host.odIn;
      const fits = spec.odIn < hostId;
      const od = fits ? spec.odIn : Math.max(2.375, Math.floor((hostId - 1) * 8) / 8);
      const bottom = Math.min(td, Math.max(host.bottomM + 100, depth + spec.lengthM));
      item = { ...base, topM: depth, bottomM: bottom, odIn: od, idIn: fits ? spec.idIn : round(od * 0.88), hostId: host.id };
      note = `${spec.label} hung in ${host.label} at ${round(depth)} m with shoe at ${round(bottom)} m.`;
      break;
    }
    case "cement": {
      const host = forced ?? cementHost(assembly, depth);
      if (!host) throw new AssemblyPlacementError("Cement needs a casing or liner annulus; drop it beside a string above its shoe.");
      const existing = items.findIndex((value) => value.catalogId === "cement" && value.hostId === host.id);
      const top = Math.min(depth, host.bottomM - 1);
      if (existing >= 0) {
        items[existing] = { ...items[existing]!, topM: top };
        return { assembly: revise(assembly, items), itemId: items[existing]!.id, note: `Top of cement for ${host.label} moved to ${round(top)} m.` };
      }
      item = { ...base, label: `Cement · ${host.label}`, topM: top, bottomM: host.bottomM, odIn: host.odIn, idIn: host.odIn, hostId: host.id };
      note = `Cemented ${host.label} from ${round(top)} m to the shoe.`;
      break;
    }
    case "tubing": {
      const existing = items.findIndex((value) => value.catalogId === "tubing");
      const tail = Math.max(depth, 10);
      if (existing >= 0) {
        items[existing] = { ...items[existing]!, bottomM: tail };
        return { assembly: revise(assembly, items), itemId: items[existing]!.id, note: `Tubing tail moved to ${round(tail)} m.` };
      }
      item = { ...base, topM: 0, bottomM: tail };
      note = `Tubing hung from surface to ${round(tail)} m.`;
      break;
    }
    case "tubing-tool": {
      const host = spec.atTubingTail ? items.find((value) => value.catalogId === "tubing") : tubingAt(items, depth);
      if (!host) throw new AssemblyPlacementError(`${spec.label} rides on tubing; add production tubing that reaches ${round(depth)} m first.`);
      if (spec.exclusiveGroup && items.some((value) => value.hostId === host.id && sameGroup(spec, getCatalogEntry(value.catalogId)))) throw new AssemblyPlacementError(`The tubing already has a ${spec.label}.`);
      const top = spec.atTubingTail ? host.bottomM - spec.lengthM : Math.max(host.topM, Math.min(depth, host.bottomM - spec.lengthM));
      let od = spec.odIn;
      if (spec.sealsToCasing) {
        const casing = stringsAtDepth(assembly, top)[0];
        if (casing?.idIn) od = round(casing.idIn - 0.4);
      }
      item = { ...base, topM: top, bottomM: top + spec.lengthM, odIn: od, hostId: host.id };
      note = spec.atTubingTail ? `${spec.label} snapped to the tubing tail at ${round(host.bottomM)} m.` : `${spec.label} made up in the tubing at ${round(top)} m.`;
      break;
    }
    case "casing-tool": {
      const host = forced ?? accessoryHost(assembly, spec, depth);
      if (!host) throw new AssemblyPlacementError(spec.attach === "liner-top" ? `${spec.label} needs a liner; hang a liner first.` : `${spec.label} attaches to casing; drop it on a cased interval.`);
      if (spec.exclusiveGroup) {
        const clash = items.find((value) => value.hostId === host.id && sameGroup(spec, getCatalogEntry(value.catalogId)));
        if (clash) throw new AssemblyPlacementError(`${host.label} already has a ${clash.label.toLowerCase()}.`);
      }
      const interval = accessoryInterval(spec, host, depth);
      item = { ...base, ...interval, odIn: accessoryOd(spec, host, items), hostId: host.id };
      note = spec.attach === "shoe" ? `${spec.label} snapped to the ${host.label} shoe at ${round(host.bottomM)} m.`
        : spec.attach === "shoe-track" ? `${spec.label} made up ${spec.shoeTrackOffsetM} m above the ${host.label} shoe.`
        : spec.attach === "liner-top" ? `${spec.label} set at the ${host.label} top, ${round(host.topM)} m.`
        : `${spec.label} on ${host.label} at ${round(interval.topM)} m.`;
      break;
    }
    case "sandface": {
      const host = forced ?? stringsAtDepth(assembly, depth)[0];
      if (spec.needsCasing && !host) throw new AssemblyPlacementError(`${spec.label} are shot through casing; drop them on a cased interval.`);
      const floor = host && spec.needsCasing ? host.bottomM : td;
      const top = Math.max(host?.topM ?? 0, Math.min(depth, floor - spec.lengthM));
      const od = host ? (spec.needsCasing ? host.odIn : round(Math.min(spec.odIn, (host.idIn ?? host.odIn) - 0.5))) : spec.odIn;
      item = { ...base, topM: top, bottomM: Math.min(floor, top + spec.lengthM), odIn: od, idIn: spec.idIn !== null && spec.idIn < od ? spec.idIn : null, ...(host ? { hostId: host.id } : {}) };
      note = `${spec.label} across ${round(top)}–${round(item.bottomM)} m${host ? ` in ${host.label}` : " in open hole"}.`;
      break;
    }
    case "plug": {
      const host = forced ?? stringsAtDepth(assembly, depth)[0];
      if (spec.needsCasing && !host) throw new AssemblyPlacementError(`${spec.label} seals against casing; drop it on a cased interval.`);
      const top = Math.min(depth, td - spec.lengthM);
      const od = host?.idIn ? round(host.idIn - (spec.needsCasing ? 0.25 : 0)) : spec.odIn;
      item = { ...base, topM: top, bottomM: top + spec.lengthM, odIn: od, ...(host ? { hostId: host.id } : {}) };
      note = `${spec.label} set at ${round(top)} m${host ? ` in ${host.label}` : " in open hole"}.`;
      break;
    }
  }
  items.push(item);
  return { assembly: revise(assembly, items), itemId: item.id, note };
}

/** Drag a placed item. The dragged handle depends on the slot: shoes for strings/tubing, top for everything else. */
export function moveComponent(assembly: WellAssembly, itemId: string, depthM: number): WellAssembly {
  finiteDepth(depthM, "Move depth");
  const current = assembly.items.find((item) => item.id === itemId);
  if (!current) throw new AssemblyPlacementError(`Unknown assembly item: ${itemId}`);
  const spec = getCatalogEntry(current.catalogId);
  const depth = Math.min(Math.max(depthM, 0), assembly.totalDepthM);
  const length = current.bottomM - current.topM;
  let next: AssemblyItem;
  switch (spec.slot) {
    case "surface": return assembly;
    case "casing":
    case "tubing": next = { ...current, bottomM: Math.max(depth, 10) }; break;
    case "cement": next = { ...current, topM: Math.min(depth, current.bottomM - 1) }; break;
    case "liner": {
      const top = Math.min(depth, assembly.totalDepthM - length);
      next = { ...current, topM: top, bottomM: top + length };
      break;
    }
    case "tubing-tool": {
      if (spec.atTubingTail) return assembly;
      const host = tubingAt(assembly.items, depth) ?? assembly.items.find((item) => item.id === current.hostId);
      const top = host ? Math.min(Math.max(depth, host.topM), host.bottomM - length) : depth;
      next = { ...current, topM: top, bottomM: top + length, hostId: host?.id };
      break;
    }
    case "casing-tool": {
      const others = { ...assembly, items: assembly.items.filter((item) => item.id !== itemId) };
      const host = accessoryHost(others, spec, depth);
      const clash = host && spec.exclusiveGroup && others.items.some((value) => value.hostId === host.id && sameGroup(spec, getCatalogEntry(value.catalogId)));
      next = host && !clash ? { ...current, hostId: host.id, ...accessoryInterval(spec, host, depth, length), odIn: accessoryOd(spec, host, others.items) } : current;
      break;
    }
    case "sandface":
    case "plug": {
      const host = stringsAtDepth(assembly, depth)[0];
      if (spec.needsCasing && !host) return assembly;
      const floor = host && spec.needsCasing ? host.bottomM : assembly.totalDepthM;
      const top = Math.max(0, Math.min(depth, floor - length));
      const rest: AssemblyItem = { ...current };
      delete (rest as { hostId?: string }).hostId;
      next = { ...rest, topM: top, bottomM: top + length, ...(host ? { hostId: host.id } : {}) };
      break;
    }
  }
  return revise(assembly, assembly.items.map((item) => (item.id === itemId ? next : item)));
}

export function updateComponent(assembly: WellAssembly, itemId: string, patch: AssemblyItemPatch): WellAssembly {
  const current = assembly.items.find((item) => item.id === itemId);
  if (!current) throw new AssemblyPlacementError(`Unknown assembly item: ${itemId}`);
  const next = { ...current, ...patch, label: patch.label?.trim() || current.label };
  for (const [key, value] of [["Top", next.topM], ["Bottom", next.bottomM], ["Outside diameter", next.odIn]] as const) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${key} must be a finite, non-negative number.`);
  }
  if (next.idIn !== null && (!Number.isFinite(next.idIn) || next.idIn <= 0 || next.idIn >= next.odIn)) throw new RangeError("Inside diameter must be positive and smaller than the outside diameter.");
  if (next.bottomM < next.topM) throw new RangeError("Bottom depth must be at or below the top depth.");
  if (next.bottomM > assembly.totalDepthM) throw new RangeError(`Depths must stay within total depth (${assembly.totalDepthM} m).`);
  return revise(assembly, assembly.items.map((item) => (item.id === itemId ? next : item)));
}

/** Remove an item and everything hosted on it (cement, shoes, tools). */
export function removeComponent(assembly: WellAssembly, itemId: string): WellAssembly {
  if (!assembly.items.some((item) => item.id === itemId)) throw new AssemblyPlacementError(`Unknown assembly item: ${itemId}`);
  const removed = new Set([itemId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of assembly.items) {
      const orphan = (getCatalogEntry(item.catalogId).requires ?? []).some((required) => !assembly.items.some((value) => value.catalogId === required && !removed.has(value.id)));
      if (!removed.has(item.id) && ((item.hostId && removed.has(item.hostId)) || orphan)) { removed.add(item.id); grew = true; }
    }
  }
  return revise(assembly, assembly.items.filter((item) => !removed.has(item.id)));
}

export function setAssemblyTotalDepth(assembly: WellAssembly, totalDepthM: number): WellAssembly {
  if (!Number.isFinite(totalDepthM) || totalDepthM < 50) throw new RangeError("Total depth must be at least 50 m.");
  const deepest = Math.max(0, ...assembly.items.map((item) => item.bottomM));
  if (totalDepthM < deepest) throw new RangeError(`Total depth cannot be above the deepest component (${deepest} m).`);
  return Object.freeze({ ...assembly, totalDepthM, revision: assembly.revision + 1 });
}

function reconcile(items: readonly AssemblyItem[]): AssemblyItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return items.map((item) => {
    const host = item.hostId ? byId.get(item.hostId) : undefined;
    if (!host) return item;
    if (item.catalogId === "cement") return { ...item, bottomM: host.bottomM, topM: Math.min(item.topM, host.bottomM - 1), odIn: host.odIn, idIn: host.odIn, label: `Cement · ${host.label}` };
    const spec = getCatalogEntry(item.catalogId);
    const length = item.bottomM - item.topM;
    if (spec.slot === "casing-tool" && spec.attach && spec.attach !== "anywhere") return { ...item, ...accessoryInterval(spec, host, item.topM, length), ...(spec.attach === "liner-top" ? {} : { odIn: host.odIn }) };
    if (spec.atTubingTail) return { ...item, topM: host.bottomM - length, bottomM: host.bottomM };
    return item;
  });
}

const fmt = (value: number) => `${round(value)} m`;
const inch = (value: number) => `${Number(value.toFixed(3))} in`;

export function validateAssembly(assembly: WellAssembly): readonly AssemblyIssue[] {
  const issues: AssemblyIssue[] = [];
  const items = assembly.items;
  const strings = items.filter(isString);
  const add = (severity: AssemblyIssue["severity"], code: string, message: string, itemId?: string) => issues.push(Object.freeze({ severity, code, message, ...(itemId ? { itemId } : {}) }));
  if (!items.some((item) => item.catalogId === "wellhead") && strings.some((item) => item.topM === 0)) add("warning", "no-wellhead", "Strings hang from surface but no wellhead is installed.");
  const surface = items.filter((item) => getCatalogEntry(item.catalogId).slot === "surface");
  for (const item of surface) {
    const spec = getCatalogEntry(item.catalogId);
    for (const required of spec.requires ?? []) {
      if (!items.some((value) => value.catalogId === required)) add("error", item.catalogId === "christmas-tree" ? "tree-without-wellhead" : "surface-prerequisite", `${item.label} has no ${getCatalogEntry(required).label} to sit on.`, item.id);
    }
    const clash = surface.find((value) => value.id < item.id && sameGroup(spec, getCatalogEntry(value.catalogId)));
    if (clash) add("error", "stack-conflict", `${item.label} and ${clash.label} cannot both occupy the top of the stack.`, item.id);
  }
  for (const item of items) {
    if (item.bottomM > assembly.totalDepthM + 1e-6) add("error", "beyond-td", `${item.label} extends below total depth.`, item.id);
  }
  for (const outer of strings) {
    for (const inner of strings) {
      if (outer === inner || inner.odIn > outer.odIn) continue;
      const overlap = Math.min(outer.bottomM, inner.bottomM) - Math.max(outer.topM, inner.topM);
      if (overlap <= 0) continue;
      if (inner.odIn === outer.odIn && inner.id < outer.id) { add("error", "same-size", `${inner.label} and ${outer.label} share a ${inch(inner.odIn)} OD over the same interval.`, inner.id); continue; }
      if (inner.odIn === outer.odIn) continue;
      if (outer.idIn !== null && inner.odIn >= outer.idIn) add("error", "does-not-pass", `${inner.label} (${inch(inner.odIn)} OD) cannot pass through ${outer.label} (${inch(outer.idIn)} ID).`, inner.id);
      if (inner.bottomM < outer.bottomM && inner.topM === 0) add("warning", "shoe-order", `${inner.label} shoe (${fmt(inner.bottomM)}) is shallower than the larger ${outer.label} shoe (${fmt(outer.bottomM)}).`, inner.id);
    }
  }
  for (const liner of items.filter((item) => getCatalogEntry(item.catalogId).slot === "liner")) {
    const host = items.find((item) => item.id === liner.hostId);
    if (!host) { add("error", "liner-host", `${liner.label} is not hung in any casing.`, liner.id); continue; }
    const lap = host.bottomM - liner.topM;
    if (lap <= 0) add("error", "liner-lap", `${liner.label} top is below the ${host.label} shoe; there is no lap to hang from.`, liner.id);
    else if (lap < 30) add("warning", "liner-lap", `${liner.label} lap is only ${fmt(lap)}; 30 m or more is typical.`, liner.id);
  }
  for (const cement of items.filter((item) => item.catalogId === "cement")) {
    if (!items.some((item) => item.id === cement.hostId)) add("error", "cement-host", `${cement.label} has no string to cement.`, cement.id);
  }
  const tubing = items.find((item) => item.catalogId === "tubing");
  if (tubing) {
    const host = stringsAtDepth(assembly, tubing.bottomM)[0];
    if (!host) add("warning", "tubing-open-hole", `Tubing tail at ${fmt(tubing.bottomM)} is in open hole.`, tubing.id);
    const narrowest = strings.filter((item) => item.topM < tubing.bottomM && item.bottomM > tubing.topM && item.idIn !== null).sort((a, b) => a.idIn! - b.idIn!)[0];
    if (narrowest && tubing.odIn >= narrowest.idIn!) add("error", "tubing-fit", `Tubing (${inch(tubing.odIn)} OD) does not fit ${narrowest.label} (${inch(narrowest.idIn!)} ID).`, tubing.id);
  }
  for (const tool of items.filter((item) => getCatalogEntry(item.catalogId).slot === "tubing-tool")) {
    const host = items.find((item) => item.id === tool.hostId);
    if (!host || tool.topM < host.topM || tool.bottomM > host.bottomM) { add("error", "tool-off-tubing", `${tool.label} at ${fmt(tool.topM)} is not on the tubing string.`, tool.id); continue; }
    const casing = stringsAtDepth(assembly, tool.topM)[0];
    const spec = getCatalogEntry(tool.catalogId);
    if (spec.sealsToCasing) {
      if (!casing) add("error", "packer-open-hole", `${tool.label} at ${fmt(tool.topM)} has no casing to seal against.`, tool.id);
      else if (casing.idIn !== null && tool.odIn >= casing.idIn) add("error", "packer-fit", `${tool.label} (${inch(tool.odIn)} OD) does not fit ${casing.label} (${inch(casing.idIn)} ID).`, tool.id);
    } else if (casing?.idIn != null && tool.odIn >= casing.idIn) add("error", "tool-fit", `${tool.label} (${inch(tool.odIn)} OD) does not fit inside ${casing.label} (${inch(casing.idIn)} ID).`, tool.id);
    if (spec.maxTypicalDepthM !== undefined && tool.topM > spec.maxTypicalDepthM) add("warning", tool.catalogId === "safety-valve" ? "sssv-depth" : "typical-depth", `${tool.label} at ${fmt(tool.topM)} is deeper than the typical ${fmt(spec.maxTypicalDepthM)} setting.`, tool.id);
    if (spec.atTubingTail && Math.abs(tool.bottomM - host.bottomM) > 0.5) add("warning", "tail-position", `${tool.label} should be at the tubing tail.`, tool.id);
  }
  const pumps = items.filter((item) => getCatalogEntry(item.catalogId).category === "Artificial lift" && item.catalogId !== "gas-lift-mandrel");
  if (pumps.length > 1) add("warning", "multiple-lift", `${pumps.length} downhole pumps are installed; a well normally runs one lift method.`, pumps[1]!.id);
  for (const tool of items.filter((item) => getCatalogEntry(item.catalogId).slot === "casing-tool")) {
    if (!items.some((item) => item.id === tool.hostId)) add("error", "accessory-host", `${tool.label} is not attached to any string.`, tool.id);
  }
  const packers = items.filter((item) => getCatalogEntry(item.catalogId).slot === "tubing-tool" && getCatalogEntry(item.catalogId).sealsToCasing);
  const deepestPacker = Math.max(-1, ...packers.map((item) => item.bottomM));
  for (const zone of items.filter((item) => getCatalogEntry(item.catalogId).slot === "sandface")) {
    const spec = getCatalogEntry(zone.catalogId);
    const host = items.find((item) => item.id === zone.hostId);
    if (spec.needsCasing && !host) add("error", "sandface-host", `${zone.label} at ${fmt(zone.topM)} has no casing to shoot through.`, zone.id);
    if (spec.needsCasing && packers.length && zone.topM < deepestPacker) add("warning", "perforations-above-packer", `${zone.label} top (${fmt(zone.topM)}) is above the production packer; reservoir pressure would reach the A-annulus.`, zone.id);
  }
  for (const plug of items.filter((item) => getCatalogEntry(item.catalogId).slot === "plug")) {
    if (getCatalogEntry(plug.catalogId).needsCasing && !items.some((item) => item.id === plug.hostId)) add("error", "plug-host", `${plug.label} has no casing to set in.`, plug.id);
    if (tubing && tubing.bottomM > plug.topM) add("error", "plug-in-tubing", `${plug.label} at ${fmt(plug.topM)} is across the tubing; pull or cut the tubing above it first.`, plug.id);
  }
  if (tubing && packers.length === 0) add("info", "no-packer", "No packer isolates the tubing-casing annulus.");
  const deepestShoe = Math.max(0, ...strings.map((item) => item.bottomM));
  if (strings.length && deepestShoe < assembly.totalDepthM) add("info", "open-hole", `Open hole from ${fmt(deepestShoe)} to TD ${fmt(assembly.totalDepthM)}.`);
  for (const value of strings) {
    if (!items.some((item) => item.catalogId === "cement" && item.hostId === value.id) && value.catalogId !== "conductor") add("info", "uncemented", `${value.label} is not cemented.`, value.id);
  }
  return Object.freeze(issues);
}

/** Bridge an assembly into the `WellComponent` records used by the schematic and 3D capabilities. */
export function assemblyToWellComponents(assembly: WellAssembly): readonly WellComponent[] {
  return Object.freeze(assembly.items.map((item) => {
    const spec = getCatalogEntry(item.catalogId);
    return Object.freeze({ id: item.id, name: item.label, kind: spec.kind, material: "User-authored assembly (illustrative)", outerDiameterMm: item.odIn ? round(item.odIn * 25.4) : null, innerDiameterMm: item.idIn ? round(item.idIn * 25.4) : null, topDepthM: item.topM, bottomDepthM: item.bottomM, description: spec.description, ...(item.hostId ? { parentId: item.hostId } : {}) });
  }));
}

const toolCatalog: Partial<Record<ComponentKind, string>> = { Packer: "packer", "Safety valve": "safety-valve", "Gas lift mandrel": "gas-lift-mandrel", Gauge: "gauge", "Landing nipple": "landing-nipple" };
const toInches = (millimetres: number | null) => millimetres === null ? null : Math.round(millimetres / 25.4 * 1000) / 1000;

/**
 * Present existing `WellComponent` records (documented, planned or synthetic) as a read-only
 * assembly so they render with the same Blender-asset schematic and cutaway as the builder.
 * Item ids equal the source component ids. Only installed equipment is mapped: holes, joints,
 * couplings and connections are omitted, and nothing absent from the records is invented.
 * The catalog id only chooses the visual style; sizes and depths come from the records.
 */
export function wellComponentsToAssembly(input: { readonly id: string; readonly name: string; readonly totalDepthM: number; readonly components: readonly WellComponent[] }): WellAssembly {
  const records = input.components;
  const items: AssemblyItem[] = [];
  const strings = records.filter((component) => component.kind === "Casing" && !component.parentId && component.outerDiameterMm !== null).sort((a, b) => b.outerDiameterMm! - a.outerDiameterMm!);
  const conductors = strings.filter((component) => component.outerDiameterMm! >= 26 * 25.4);
  const liners = strings.filter((component) => !conductors.includes(component) && component.topDepthM > 0 && component.topDepthReported !== false);
  const full = strings.filter((component) => !conductors.includes(component) && !liners.includes(component));
  const styleFor = (index: number) => full.length === 1 ? "production-casing" : index === 0 ? "surface-casing" : index === full.length - 1 ? "production-casing" : "intermediate-casing";
  const item = (component: WellComponent, catalogId: string, extra: Partial<AssemblyItem> = {}): AssemblyItem => Object.freeze({ id: component.id, catalogId, label: component.name, topM: component.topDepthM, bottomM: Math.min(component.bottomDepthM, input.totalDepthM), odIn: toInches(component.outerDiameterMm) ?? getCatalogEntry(catalogId).odIn, idIn: toInches(component.innerDiameterMm), ...extra });
  for (const component of conductors) items.push(item(component, "conductor"));
  full.forEach((component, index) => items.push(item(component, styleFor(index), { topM: 0 })));
  const hostFor = (depthM: number, odIn: number) => items.filter((entry) => entry.topM <= depthM && entry.bottomM >= depthM && entry.odIn > odIn).sort((a, b) => a.odIn - b.odIn)[0];
  for (const component of liners) {
    const odIn = toInches(component.outerDiameterMm)!;
    items.push(item(component, "liner", { ...(hostFor(component.topDepthM, odIn) ? { hostId: hostFor(component.topDepthM, odIn)!.id } : {}) }));
  }
  const stringItems = [...items];
  for (const component of records) {
    if (component.kind === "Wellhead") items.push(item(component, "wellhead", { topM: 0, bottomM: 0 }));
    else if (component.kind === "Valve") items.push(item(component, "christmas-tree", { topM: 0, bottomM: 0 }));
    else if (component.kind === "Tubular" && !component.parentId) items.push(item(component, "tubing", { topM: 0 }));
    else if (component.kind === "Cement") {
      const host = stringItems.find((entry) => entry.id === component.parentId) ?? [...stringItems].sort((a, b) => Math.abs(a.bottomM - component.bottomDepthM) - Math.abs(b.bottomM - component.bottomDepthM))[0];
      if (host) items.push(item(component, "cement", { hostId: host.id, topM: Math.min(component.topDepthM, host.bottomM - 1), bottomM: host.bottomM, odIn: host.odIn, idIn: host.odIn }));
    }
  }
  const tubing = items.find((entry) => entry.catalogId === "tubing");
  for (const component of records) {
    const catalogId = component.kind === "Centralizer" ? "centralizer" : toolCatalog[component.kind];
    if (!catalogId) continue;
    const spec = getCatalogEntry(catalogId);
    const length = Math.max(component.bottomDepthM - component.topDepthM, spec.lengthM);
    const host = catalogId === "centralizer" ? (stringItems.find((entry) => entry.id === component.parentId) ?? hostFor(component.topDepthM, 0)) : tubing;
    items.push(item(component, catalogId, { bottomM: Math.min(component.topDepthM + length, input.totalDepthM), ...(host ? { hostId: host.id } : {}) }));
  }
  return Object.freeze({ id: input.id, name: input.name, totalDepthM: input.totalDepthM, revision: 1, items: Object.freeze(items) });
}

/** A complete, valid example sequence: useful for demos and as a starting point. */
export function exampleAssembly(totalDepthM = 3200): WellAssembly {
  let value = createAssembly({ id: "example-assembly", name: "Example producer", totalDepthM });
  const steps: readonly [string, number][] = [
    ["wellhead", 0], ["christmas-tree", 0], ["conductor", 0.03], ["surface-casing", 0.18], ["intermediate-casing", 0.5], ["production-casing", 0.82],
    ["liner", 0.78], ["cement", 0.12], ["cement", 0.42], ["cement", 0.7], ["cement", 0.92], ["float-shoe", 0.82], ["centralizer", 0.79],
    ["tubing", 0.76], ["safety-valve", 0.08], ["gas-lift-mandrel", 0.35], ["gas-lift-mandrel", 0.55], ["landing-nipple", 0.72], ["gauge", 0.735], ["packer", 0.745],
  ];
  for (const [catalogId, fraction] of steps) value = placeComponent(value, catalogId, fraction * totalDepthM).assembly;
  return Object.freeze({ ...value, revision: 1 });
}

/** A sensible drop depth for click/keyboard placement when no pointer position exists. */
export function suggestPlacementDepth(assembly: WellAssembly, catalogId: string, selectedId?: string): number {
  const spec = getCatalogEntry(catalogId);
  const td = assembly.totalDepthM;
  const strings = assembly.items.filter(isString);
  const deepest = Math.max(0, ...strings.map((item) => item.bottomM));
  const tubing = assembly.items.find((item) => item.catalogId === "tubing");
  const selected = assembly.items.find((item) => item.id === selectedId);
  switch (spec.slot) {
    case "surface": return 0;
    case "casing": {
      if (catalogId === "tieback-casing") return round(nearestLinerTop(assembly, td)?.topM ?? Math.max(10, deepest * 0.5));
      const typical = (spec.typicalDepthFraction ?? 0) * td;
      return round(typical > deepest + 10 ? typical : deepest + (td - deepest) * (strings.length ? 0.55 : 0.2));
    }
    case "liner": return round(Math.max(0, deepest - 120));
    case "cement": {
      const target = (selected && isString(selected) ? selected : undefined) ?? strings.find((item) => !assembly.items.some((value) => value.catalogId === "cement" && value.hostId === item.id)) ?? strings[0];
      if (!target) return td * 0.3;
      const previousShoe = Math.max(target.topM, ...strings.filter((item) => item.bottomM < target.bottomM && item.odIn > target.odIn).map((item) => item.bottomM));
      return round(previousShoe + (target.bottomM - previousShoe) * 0.4);
    }
    case "tubing": return round(Math.max(10, deepest - 150));
    case "tubing-tool": {
      if (!tubing) return td * 0.5;
      return round(spec.atTubingTail ? tubing.bottomM : tubing.bottomM * (spec.typicalDepthFraction ?? 0.5));
    }
    case "casing-tool": {
      if (spec.attach === "liner-top") return round(nearestLinerTop(assembly, td)?.topM ?? Math.max(0, deepest - 120));
      const free = strings.filter((item) => !spec.exclusiveGroup || !assembly.items.some((value) => value.hostId === item.id && sameGroup(spec, getCatalogEntry(value.catalogId))));
      const host = (selected && isString(selected) ? selected : undefined) ?? [...free].sort((a, b) => b.bottomM - a.bottomM)[0] ?? [...strings].sort((a, b) => b.bottomM - a.bottomM)[0];
      if (!host) return td * 0.5;
      if (spec.attach === "shoe") return round(host.bottomM);
      if (spec.attach === "shoe-track") return round(host.bottomM - (spec.shoeTrackOffsetM ?? 0));
      return round(host.bottomM - 40);
    }
    case "sandface":
    case "plug": {
      const host = [...strings].sort((a, b) => b.bottomM - a.bottomM)[0];
      if (!spec.needsCasing && spec.slot === "sandface" && deepest < td - spec.lengthM) return round(deepest + 5);
      if (!host) return td * 0.5;
      const below = (tubing?.bottomM ?? host.topM) + 10;
      return round(Math.max(host.topM, Math.min(below, host.bottomM - spec.lengthM - 40)));
    }
  }
}
