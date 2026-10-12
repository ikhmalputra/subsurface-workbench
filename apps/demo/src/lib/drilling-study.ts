import { METRES_PER_INTERNATIONAL_FOOT, feetToMetres, metresToFeet, parseLas, runsInInterval } from "@ikhmalputra/subsurface-core";
import type { LasFile, WellOperations } from "@ikhmalputra/subsurface-core";

export interface StudyScope { readonly topM: number; readonly baseM: number }
export interface StudyResult { readonly mean: number; readonly unit: string; readonly validCount: number; readonly excludedCount: number }
export interface DrillingStudy {
  readonly version: 1;
  readonly id: string;
  readonly wellId: string;
  readonly wellRevision: number;
  readonly question: string;
  readonly scope: StudyScope;
  readonly comparison: StudyScope;
  readonly finding: string;
  readonly uncertainty: string;
  readonly evidenceIds: readonly string[];
  readonly sourceSignature: string;
  readonly results: { readonly target: StudyResult; readonly comparison: StudyResult };
  readonly savedAt: string;
}

export function validateScope(scope: StudyScope, tdM: number): void {
  if (!Number.isFinite(scope.topM) || !Number.isFinite(scope.baseM) || scope.topM < 0 || scope.baseM <= scope.topM || scope.baseM > tdM) throw new Error(`Use an increasing MD interval within 0–${tdM.toFixed(1)} m.`);
}

/** Parse and check in one step. Kept for callers that hold only the source text. */
export function readDrillingLog(text: string): LasFile {
  return checkDrillingLog(parseLas(text));
}

/**
 * The study's own admission check on an already-parsed log.
 *
 * Separate from parsing so the study can share the one parse every other view uses and still
 * refuse a file it cannot analyse — a log whose depths are not strictly increasing has not been
 * depth-matched, and averaging over it would report a number for an interval it does not cover.
 */
export function checkDrillingLog(las: LasFile): LasFile {
  const depth = las.curves[0];
  if (!depth || depth.mnemonic !== "DEPTH" || !["ft", "m"].includes(depth.unit.toLowerCase())) throw new Error("The drilling log needs a first DEPTH curve in ft or m.");
  const factor = depth.unit.toLowerCase() === "ft" ? METRES_PER_INTERNATIONAL_FOOT : 1;
  let previous = -Infinity;
  for (const value of depth.values) {
    if (value === null || !Number.isFinite(value) || value * factor < 0 || value <= previous) throw new Error("Log depth must be finite, nonnegative and strictly increasing; depth-match the source before analysis.");
    previous = value;
  }
  return las;
}

export function intervalEvidence(las: LasFile, operations: WellOperations | null, scope: StudyScope) {
  const depth = las.curves[0]!;
  const factor = depth.unit.toLowerCase() === "ft" ? METRES_PER_INTERNATIONAL_FOOT : 1;
  const rows = depth.values.flatMap((value, index) => value !== null && value * factor >= scope.topM && value * factor < scope.baseM
    ? [{ id: `log:${index}`, mdM: value * factor, values: Object.fromEntries(las.curves.slice(1).map((curve) => [curve.mnemonic, curve.values[index] ?? null])) }] : []);
  const rop = las.curves.find((curve) => curve.mnemonic === "ROP");
  const supported = rop && ["ft/h", "m/h"].includes(rop.unit.toLowerCase());
  const valid = supported ? rows.flatMap((row) => {
    const value = row.values.ROP;
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? [value] : [];
  }) : [];
  const mean = valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
  const runs = operations ? runsInInterval(operations, metresToFeet(scope.topM), metresToFeet(scope.baseM)) : [];
  const days = operations?.days.filter((day) => day.mdFt !== null && feetToMetres(day.mdFt) >= scope.topM && feetToMetres(day.mdFt) < scope.baseM) ?? [];
  return { rows, mean, unit: rop?.unit ?? null, validCount: valid.length, excludedCount: rows.length - valid.length, runs, days };
}

export function studySignature(logText: string, operations: WellOperations | null): string {
  // A deterministic change detector, not a cryptographic source authenticity claim.
  let hash = 2166136261;
  for (const character of `${logText}\n${JSON.stringify(operations)}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}

export function parseStudies(input: string): readonly DrillingStudy[] {
  const value: unknown = JSON.parse(input);
  if (!Array.isArray(value)) throw new Error("Saved studies must be an array.");
  const ids = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("Invalid saved study.");
    const study = item as Record<string, unknown>;
    if (study.version !== 1) throw new Error("Unsupported study version.");
    for (const key of ["id", "wellId", "question", "finding", "uncertainty", "sourceSignature", "savedAt"]) if (typeof study[key] !== "string") throw new Error(`Study ${key} must be text.`);
    if (typeof study.wellRevision !== "number" || !Number.isSafeInteger(study.wellRevision) || study.wellRevision < 0) throw new Error("Invalid study well revision.");
    if (!study.id || !study.wellId || !study.question || ids.has(String(study.id))) throw new Error("Study IDs and questions must be nonempty; IDs must be unique.");
    ids.add(String(study.id));
    if (!Array.isArray(study.evidenceIds) || study.evidenceIds.some((id) => typeof id !== "string")) throw new Error("Invalid evidence references.");
    for (const key of ["scope", "comparison"]) {
      const scope = study[key];
      if (!scope || typeof scope !== "object" || !("topM" in scope) || !("baseM" in scope) || typeof scope.topM !== "number" || typeof scope.baseM !== "number") throw new Error("Invalid saved interval.");
      validateScope({ topM: scope.topM, baseM: scope.baseM }, Infinity);
    }
    if (!Number.isFinite(Date.parse(String(study.savedAt)))) throw new Error("Invalid saved date.");
    const results = study.results;
    if (!results || typeof results !== "object") throw new Error("Saved study results are required.");
    const savedResult = (key: "target" | "comparison"): StudyResult => {
      const result = key === "target" ? ("target" in results ? results.target : null) : ("comparison" in results ? results.comparison : null);
      if (!result || typeof result !== "object" || !("mean" in result) || !("unit" in result) || !("validCount" in result) || !("excludedCount" in result) || typeof result.mean !== "number" || !Number.isFinite(result.mean) || typeof result.unit !== "string" || typeof result.validCount !== "number" || !Number.isSafeInteger(result.validCount) || result.validCount < 1 || typeof result.excludedCount !== "number" || !Number.isSafeInteger(result.excludedCount) || result.excludedCount < 0) throw new Error("Invalid saved interval result.");
      return { mean: result.mean, unit: result.unit, validCount: result.validCount, excludedCount: result.excludedCount };
    };
    const savedScope = (key: string): StudyScope => {
      const scope = study[key];
      if (!scope || typeof scope !== "object" || !("topM" in scope) || !("baseM" in scope) || typeof scope.topM !== "number" || typeof scope.baseM !== "number") throw new Error("Invalid saved interval.");
      return { topM: scope.topM, baseM: scope.baseM };
    };
    return {
      version: 1, id: String(study.id), wellId: String(study.wellId), wellRevision: study.wellRevision,
      question: String(study.question), scope: savedScope("scope"), comparison: savedScope("comparison"),
      finding: String(study.finding), uncertainty: String(study.uncertainty), evidenceIds: study.evidenceIds.map(String),
      sourceSignature: String(study.sourceSignature), savedAt: String(study.savedAt),
      results: { target: savedResult("target"), comparison: savedResult("comparison") },
    };
  });
}

export const studyStorageKey = "subsurface:drilling-studies:v1";
