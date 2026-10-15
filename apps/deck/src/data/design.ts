import { useSyncExternalStore } from "react";
import { analyzeSection, briefToWellDesign, defaultDesignFactors, exampleBuildHold, formatOd, maximumSurfacePressure, validateDesign, wellComponentsToAssembly } from "@ikhmalputra/subsurface-core";
import type { BuildHoldInput, DesignIssue, SectionAnalysis, WellAssembly, WellDesign, WellDesignBrief } from "@ikhmalputra/subsurface-core";
import { createEditHistory } from "@ikhmalputra/subsurface-core/state";
import type { EditHistory, EditState } from "@ikhmalputra/subsurface-core/state";
import { designSite, kestrelSite } from "@ikhmalputra/subsurface-react";
import type { WorldSite } from "@ikhmalputra/subsurface-react";

/**
 * Planned wells, live. Each design is one value — the brief and the drilling-hydraulics inputs —
 * under its own edit history, so a what-if in any module shows in every module and one undo
 * reverses it wherever it was made. Kestrel A-7 is the built-in example; every well a user creates
 * sits beside it. The deck works on one at a time: the design of the site it is on (`active`).
 * Designs are kept in this browser (localStorage) and travel as .json files.
 */

export const kestrel = kestrelSite();

export interface HydraulicsInputs {
  /** The hole section being drilled: its mud weight, hole size and the pipe in it. */
  readonly sectionId: string;
  readonly flowGpm: number;
  /** Bit nozzles, 32nds of an inch. */
  readonly nozzles32nds: readonly number[];
  /** Drill pipe OD, inches. */
  readonly pipeOdIn: number;
}

export interface DesignValue {
  readonly brief: WellDesignBrief;
  readonly hydraulics: HydraulicsInputs;
  /** The build-and-hold plan the trajectory was made from, so it can be edited again; absent for a vertical well or hand-made stations. */
  readonly buildHold?: BuildHoldInput | null;
}

/** The hydraulics inputs a host would enter: they are not in the brief, so they start as the user's. */
export const initialHydraulics: HydraulicsInputs = { sectionId: "production", flowGpm: 450, nozzles32nds: [12, 12, 12, 13], pipeOdIn: 5 };

export interface DesignRecord {
  readonly id: string;
  /** The site and well ids the deck knows it by. */
  readonly siteId: string;
  readonly wellId: string;
  /** The SDK's example: kept with the user's edits, but it cannot be deleted. */
  readonly builtIn: boolean;
  readonly createdAt: number;
  readonly history: EditHistory<DesignValue>;
}

const STORE_KEY = "deck-designs-v1";
interface Stored { readonly id: string; readonly createdAt: number; readonly value: DesignValue }
const readStore = (): readonly Stored[] => {
  try {
    const value = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]") as Stored[];
    return Array.isArray(value) ? value.filter((entry) => entry && typeof entry.id === "string" && entry.value?.brief?.identity) : [];
  } catch { return []; }
};

let version = 0;
const listeners = new Set<() => void>();
const changed = () => { version++; for (const listener of [...listeners]) listener(); };

function make(id: string, value: DesignValue, createdAt: number, builtIn: boolean): DesignRecord {
  const ids = builtIn ? { siteId: "kestrel", wellId: "kestrel-a7" } : { siteId: `design-${id}`, wellId: `design-${id}-well` };
  const history = createEditHistory<DesignValue>(value);
  history.subscribe(() => { save(); changed(); });
  return { id, ...ids, builtIn, createdAt, history };
}

const stored = readStore();
let records: readonly DesignRecord[] = [
  make("kestrel", stored.find((entry) => entry.id === "kestrel")?.value ?? { brief: kestrel.brief, hydraulics: initialHydraulics, buildHold: exampleBuildHold }, 0, true),
  ...stored.filter((entry) => entry.id !== "kestrel").map((entry) => make(entry.id, entry.value, entry.createdAt, false)),
];

function save() {
  try {
    // The example is kept only once it has been edited.
    const entries = records.filter((record) => !record.builtIn || record.history.getState().committed.brief !== kestrel.brief)
      .map((record): Stored => ({ id: record.id, createdAt: record.createdAt, value: record.history.getState().committed }));
    localStorage.setItem(STORE_KEY, JSON.stringify(entries));
  } catch { /* not kept: private window or storage full */ }
}

let active: DesignRecord = records[0]!;
const activeRecord = () => active;

/** The design a site holds, if it is a design site. */
export const designForSite = (siteId: string | null): DesignRecord | null => records.find((record) => record.siteId === siteId) ?? null;
export const isDesignSite = (siteId: string | null) => designForSite(siteId) !== null;
/** The deck moved: the design of the site it is on becomes the one every module edits. */
export function setActiveSite(siteId: string | null) {
  const record = designForSite(siteId);
  if (record && record !== active) { active = record; changed(); }
}
export const activeDesign = () => active;

/**
 * The active design's history, as one object: every module, the what-if bar and the command bar
 * talk to it without knowing which design is active.
 */
export const designHistory: EditHistory<DesignValue> = {
  getState: () => activeRecord().history.getState(),
  current: () => activeRecord().history.current(),
  subscribe(listener) { const call = () => listener(activeRecord().history.getState()); listeners.add(call); return () => { listeners.delete(call); }; },
  propose: (label, value) => activeRecord().history.propose(label, value),
  apply: () => activeRecord().history.apply(),
  discard: () => activeRecord().history.discard(),
  undo: () => activeRecord().history.undo(),
  redo: () => activeRecord().history.redo(),
  reset: (value) => activeRecord().history.reset(value),
};

/** A designer edit: one named, undoable step on the committed design (a pending what-if gives way). */
export function commitDesign(label: string, change: (value: DesignValue) => DesignValue) {
  const history = activeRecord().history;
  const next = change(history.getState().committed);
  history.propose(label, next);
  history.apply();
}

const snapshot = () => designHistory.getState();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useDesignState(): EditState<DesignValue> {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
/** What every module draws: the what-if while there is one, else the committed design. */
export function useDesign(): DesignValue {
  const state = useDesignState();
  return state.pending?.value ?? state.committed;
}

/** Every design with what it currently shows, for lists (the globe, the comparison, the command bar). */
export interface DesignEntry { readonly record: DesignRecord; readonly value: DesignValue; readonly pending: boolean }
let entriesAt = -1, entries: readonly DesignEntry[] = [];
const entriesSnapshot = () => {
  if (entriesAt !== version) {
    entriesAt = version;
    entries = records.map((record) => { const state = record.history.getState(); return { record, value: state.pending?.value ?? state.committed, pending: state.pending !== null }; });
  }
  return entries;
};
export function useDesigns(): readonly DesignEntry[] {
  return useSyncExternalStore(subscribe, entriesSnapshot, entriesSnapshot);
}
export const designEntries = () => entriesSnapshot();

/** A design's site, built once per brief. */
const siteCache = new WeakMap<WellDesignBrief, WorldSite & { readonly brief: WellDesignBrief; readonly design: WellDesign }>();
export function siteOfDesign(record: DesignRecord, brief: WellDesignBrief) {
  let site = siteCache.get(brief);
  if (!site || site.map.id !== record.siteId) {
    site = record.builtIn ? { ...kestrelSite(brief) } : designSite(brief, { siteId: record.siteId, wellId: record.wellId });
    siteCache.set(brief, site);
  }
  return site;
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** Adds a design and returns it; the deck then flies to its site. */
export function addDesign(value: DesignValue): DesignRecord {
  if (value.brief.location.latitude === null || value.brief.location.longitude === null) throw new RangeError("A new well needs a surface location.");
  const record = make(newId(), value, Date.now(), false);
  records = [...records, record];
  save(); changed();
  return record;
}
export function deleteDesign(id: string) {
  const record = records.find((entry) => entry.id === id);
  if (!record || record.builtIn) return;
  records = records.filter((entry) => entry !== record);
  if (active === record) active = records[0]!;
  save(); changed();
}
/** A design as a file: what it is, and the value. */
export function exportDesign(record: DesignRecord): string {
  return JSON.stringify({ format: "subsurface-deck-design", version: 1, exportedAt: new Date().toISOString(), value: record.history.getState().committed }, null, 1);
}
/** Reads a design file; throws with the reason when it is not one. */
export function parseDesignFile(text: string): DesignValue {
  const file = JSON.parse(text) as { format?: string; value?: DesignValue };
  if (file.format !== "subsurface-deck-design" || !file.value?.brief?.identity || !Array.isArray(file.value.brief.sections)) throw new TypeError("Not a design file exported from this deck.");
  return { brief: file.value.brief, hydraulics: file.value.hydraulics ?? initialHydraulics, buildHold: file.value.buildHold ?? null };
}

export interface DesignAnalysis {
  readonly brief: WellDesignBrief;
  readonly sections: readonly SectionAnalysis[];
  readonly issues: readonly DesignIssue[];
  readonly failing: readonly string[];
  readonly masp: ReturnType<typeof maximumSurfacePressure>;
  readonly design: WellDesign;
  readonly assembly: WellAssembly;
}

const analyses = new WeakMap<WellDesignBrief, DesignAnalysis>();
/** Every section's loads, ratings, kick tolerance and cement, and the drawable well, once per brief. */
export function analyse(brief: WellDesignBrief): DesignAnalysis {
  let analysis = analyses.get(brief);
  if (!analysis) {
    const sections = brief.sections.map((_, index) => analyzeSection(brief, index, defaultDesignFactors));
    const design = briefToWellDesign(brief, "synthetic");
    analysis = {
      brief, sections,
      issues: validateDesign(brief, defaultDesignFactors),
      failing: sections.filter((section) => !section.passes || section.issues.some((issue) => issue.severity === "error")).map((section) => section.sectionId),
      masp: maximumSurfacePressure(brief),
      design,
      assembly: wellComponentsToAssembly({ id: design.id, name: design.wellName ?? brief.identity.name, totalDepthM: design.totalDepthM, components: design.components ?? [] }),
    };
    analyses.set(brief, analysis);
  }
  return analysis;
}

export const factors = defaultDesignFactors;
const holeName = (brief: WellDesignBrief, sectionId: string) => {
  const section = brief.sections.find((entry) => entry.id === sectionId);
  return section ? `${formatOd(section.holeSizeIn)} hole` : sectionId;
};

/** The edits a module can propose. Each makes a new brief and names itself for the history. */
const withSection = (value: DesignValue, sectionId: string, change: (section: WellDesignBrief["sections"][number]) => WellDesignBrief["sections"][number]): DesignValue => ({
  ...value, brief: { ...value.brief, sections: value.brief.sections.map((section) => section.id === sectionId ? change(section) : section) },
});
const committedSection = (sectionId: string) => designHistory.getState().committed.brief.sections.find((section) => section.id === sectionId)!;

export const edits = {
  mudWeight(sectionId: string, sg: number) {
    const before = committedSection(sectionId).mudWeightSg;
    const value = withSection(designHistory.current(), sectionId, (section) => ({ ...section, mudWeightSg: Math.round(sg * 100) / 100 }));
    designHistory.propose(`Mud weight · ${holeName(value.brief, sectionId)} ${before.toFixed(2)} → ${sg.toFixed(2)} SG`, value);
  },
  pipe(sectionId: string, grade: string, weightLbFt: number) {
    const before = committedSection(sectionId);
    const value = withSection(designHistory.current(), sectionId, (section) => ({ ...section, grade, weightLbFt }));
    designHistory.propose(`${before.label} · ${before.grade} ${before.weightLbFt}# → ${grade} ${weightLbFt}#`, value);
  },
  kickIntensity(sg: number) {
    const current = designHistory.current();
    const before = designHistory.getState().committed.brief.basis?.kickIntensitySg ?? 0.06;
    designHistory.propose(`Kick intensity ${before.toFixed(2)} → ${sg.toFixed(2)} SG`, { ...current, brief: { ...current.brief, basis: { kickIntensitySg: Math.round(sg * 100) / 100, casingWearPct: current.brief.basis?.casingWearPct ?? 0 } } });
  },
  cement(sectionId: string, field: "leadDensitySg" | "tailDensitySg" | "topMdM", value: number) {
    const before = committedSection(sectionId);
    const next = withSection(designHistory.current(), sectionId, (section) => section.cement ? { ...section, cement: { ...section.cement, [field]: field === "topMdM" ? Math.round(value) : Math.round(value * 100) / 100 } } : section);
    const name = field === "topMdM" ? "top of cement" : field === "leadDensitySg" ? "lead slurry" : "tail slurry";
    const from = before.cement ? before.cement[field] : 0;
    designHistory.propose(`${before.label} · ${name} ${field === "topMdM" ? `${Math.round(from)} → ${Math.round(value)} m` : `${from.toFixed(2)} → ${value.toFixed(2)} SG`}`, next);
  },
  hydraulics(change: Partial<HydraulicsInputs>, label: string) {
    const current = designHistory.current();
    designHistory.propose(label, { ...current, hydraulics: { ...current.hydraulics, ...change } });
  },
};
