import { useSyncExternalStore } from "react";
import { analyzeSection, briefToWellDesign, defaultDesignFactors, formatOd, maximumSurfacePressure, validateDesign, wellComponentsToAssembly } from "@ikhmalputra/subsurface-core";
import type { DesignIssue, SectionAnalysis, WellAssembly, WellDesign, WellDesignBrief } from "@ikhmalputra/subsurface-core";
import { createEditHistory } from "@ikhmalputra/subsurface-core/state";
import type { EditState } from "@ikhmalputra/subsurface-core/state";
import { kestrelSite } from "@ikhmalputra/subsurface-react";

/**
 * The Kestrel A-7 design, live. One value holds everything the engineering modules can change —
 * the brief and the drilling-hydraulics inputs — under one edit history, so a what-if in any
 * module shows in every module, and one undo reverses it wherever it was made.
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
}

/** The hydraulics inputs a host would enter: they are not in the brief, so they start as the user's. */
const initialHydraulics: HydraulicsInputs = { sectionId: "production", flowGpm: 450, nozzles32nds: [12, 12, 12, 13], pipeOdIn: 5 };

export const designHistory = createEditHistory<DesignValue>({ brief: kestrel.brief, hydraulics: initialHydraulics });

const snapshot = () => designHistory.getState();
export function useDesignState(): EditState<DesignValue> {
  return useSyncExternalStore(designHistory.subscribe, snapshot, snapshot);
}
/** What every module draws: the what-if while there is one, else the committed design. */
export function useDesign(): DesignValue {
  const state = useDesignState();
  return state.pending?.value ?? state.committed;
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
