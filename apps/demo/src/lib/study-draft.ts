import type { DrillingStudy } from "./drilling-study";

/**
 * A drilling study in progress, held per well by the workspace provider so the study tool, the
 * evidence tool and the sheet's section (which bands the two intervals) all read one draft. The
 * depth fields are kept as typed text: a half-typed number must not snap back while typing, and
 * the scope check names what is wrong with it.
 */
export interface StudyDraft {
  readonly phase: 0 | 1 | 2 | 3;
  readonly question: string;
  readonly top: string;
  readonly base: string;
  readonly compareTop: string;
  readonly compareBase: string;
  readonly finding: string;
  readonly uncertainty: string;
  readonly evidenceIds: readonly string[];
  /** The saved study this draft continues, if any. */
  readonly studyId: string | null;
  readonly loaded: DrillingStudy | null;
  /** The basis (source signature, revision, intervals) the evidence was reviewed on; saving needs it current. */
  readonly reviewedBasis: string;
  readonly acknowledgedBasis: string;
  readonly samplePage: number;
  readonly evidenceWindow: "target" | "comparison";
  readonly recordView: "runs" | "days";
  readonly preview: { readonly basis: string; readonly windowFt: readonly [number, number] | null } | null;
  readonly notice: string;
}

export const studyPhases = ["Scope", "Check inputs", "Review evidence", "Findings"] as const;

/** A fresh study over the well: the target is its lower part, the comparison the part above it. */
export function newStudyDraft(totalDepthM: number): StudyDraft {
  return {
    phase: 0,
    question: "What changed in drilling performance across these intervals, and what recorded evidence could explain it?",
    top: String(Math.round(totalDepthM * 0.6)), base: String(Math.floor(totalDepthM)),
    compareTop: String(Math.round(totalDepthM * 0.3)), compareBase: String(Math.round(totalDepthM * 0.6)),
    finding: "", uncertainty: "", evidenceIds: [], studyId: null, loaded: null,
    reviewedBasis: "", acknowledgedBasis: "", samplePage: 0, evidenceWindow: "target", recordView: "runs", preview: null,
    notice: "Define the investigation before reviewing evidence.",
  };
}

/** Continue a saved study: its question, intervals, finding and evidence, reviewed afresh. */
export function continueStudy(draft: StudyDraft, study: DrillingStudy): StudyDraft {
  return {
    ...draft, loaded: study, studyId: study.id, question: study.question,
    top: String(study.scope.topM), base: String(study.scope.baseM), compareTop: String(study.comparison.topM), compareBase: String(study.comparison.baseM),
    finding: study.finding, uncertainty: study.uncertainty, evidenceIds: study.evidenceIds, reviewedBasis: "", phase: 1,
  };
}

/** Start over without touching what is saved. */
export function restartStudy(draft: StudyDraft): StudyDraft {
  return { ...draft, studyId: null, loaded: null, finding: "", uncertainty: "", evidenceIds: [], phase: 0, notice: "New study started; saved studies remain unchanged." };
}

/** The interval bands the section draws for a draft; NaN where a depth is not yet typed. */
export function studyHighlights(draft: StudyDraft) {
  const reviewing = draft.phase === 2;
  return [
    { id: "target", label: `Target ${draft.top}–${draft.base} m MD`, topM: Number(draft.top.trim() || NaN), baseM: Number(draft.base.trim() || NaN), focused: reviewing && draft.evidenceWindow === "target" },
    { id: "comparison", label: `Comparison ${draft.compareTop}–${draft.compareBase} m MD`, topM: Number(draft.compareTop.trim() || NaN), baseM: Number(draft.compareBase.trim() || NaN), focused: reviewing && draft.evidenceWindow === "comparison" },
  ];
}
