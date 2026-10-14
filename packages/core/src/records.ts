import operationsData from "./forge-operations.json" with { type: "json" };

export type DayCategory = "drilling" | "tripping" | "casing" | "rig" | "circulating" | "logging" | "coring" | "testing" | "repair" | "other";
export type RunKind = "drilling" | "coring" | "cleanout" | "reaming" | "survey" | "cooldown" | "test" | "fishing" | "logging" | "plugback" | "milling";
export type RunOutcome = "completed" | "problem" | "failed";

/** One daily operations report (24 h ending at report time). Depths in feet as reported. */
export interface WellDay {
  readonly date: string;
  readonly dayFromSpud: number;
  readonly page: number;
  readonly mdFt: number | null;
  readonly mdM: number | null;
  readonly tvdFt: number | null;
  readonly footageFt: number | null;
  readonly mudWeightPpg: number | null;
  readonly category: DayCategory;
  readonly headline: string;
  readonly activities: readonly string[];
  readonly planned: string;
}

/** One bottom-hole-assembly or service run. */
export interface ServiceRun {
  readonly id: string;
  readonly kind: RunKind;
  readonly holeSection: string;
  readonly page: number;
  readonly sourceHeading: string;
  readonly topFt: number | null;
  readonly baseFt: number | null;
  readonly topM: number | null;
  readonly baseM: number | null;
  readonly footageFt: number | null;
  readonly avgRopFph: number | null;
  readonly outcome: RunOutcome;
  readonly summary: string;
}

export interface HoleSectionRecord {
  readonly id: string;
  readonly name: string;
  readonly bitSizeIn: number;
  readonly topFt: number;
  readonly baseFt: number;
  readonly topM: number;
  readonly baseM: number;
  readonly casing: string;
  readonly holeComponentId: string;
  readonly casingComponentId: string;
  readonly runCount: number;
  readonly problemRuns: number;
  readonly drilledFt: number;
  readonly avgRopFph: number | null;
  readonly firstDate: string | null;
  readonly lastDate: string | null;
}

export interface WellMilestone {
  readonly id: string;
  readonly label: string;
  readonly date: string;
  readonly mdFt: number | null;
  readonly page: number;
  readonly source: string;
}

export interface RecordSource {
  readonly url: string;
  readonly sha256: string;
  readonly title: string;
}

/** Operational history for one well: daily reports, service runs, hole sections and milestones. */
export interface WellOperations {
  readonly wellId: string;
  readonly license: string;
  readonly attribution: string;
  readonly sources: Readonly<Record<string, RecordSource>>;
  readonly notes: readonly string[];
  readonly milestones: readonly WellMilestone[];
  readonly days: readonly WellDay[];
  readonly runs: readonly ServiceRun[];
  readonly sections: readonly HoleSectionRecord[];
}

/** Utah FORGE 16A(78)-32 records transcribed from GDR 1283 and 1296 (CC BY 4.0). */
export const forgeOperations = operationsData as unknown as Readonly<WellOperations>;

/** Daily depth progress (days from spud vs reported MD) for a days-vs-depth chart. */
export function daysVsDepth(operations: WellOperations): readonly { readonly date: string; readonly day: number; readonly mdFt: number }[] {
  return operations.days.filter((day) => day.mdFt !== null && day.dayFromSpud >= 0).map((day) => ({ date: day.date, day: day.dayFromSpud, mdFt: day.mdFt as number }));
}

export function sectionAtDepth(operations: WellOperations, mdFt: number): HoleSectionRecord | undefined {
  return operations.sections.find((section) => mdFt >= section.topFt && mdFt <= section.baseFt) ?? (mdFt < (operations.sections[0]?.topFt ?? 0) ? operations.sections[0] : undefined);
}

/**
 * Depth overlap with a tolerance (ft, default 1) for unit-conversion rounding.
 * Intervals that only touch at a boundary, such as a run ending at a casing
 * point and the next hole section, do not overlap. A point record (top equals
 * base) overlaps when it lies within the range.
 */
export function intervalsOverlap(top: number, base: number, rangeTop: number, rangeBase: number, toleranceFt = 1): boolean {
  if (base - top < toleranceFt) return top >= rangeTop - toleranceFt && top <= rangeBase + toleranceFt;
  return Math.min(base, rangeBase) - Math.max(top, rangeTop) > toleranceFt;
}

/** Runs whose reported interval overlaps [topFt, baseFt]. Runs without an interval are excluded. */
export function runsInInterval(operations: WellOperations, topFt: number, baseFt: number): readonly ServiceRun[] {
  return operations.runs.filter((run) => {
    const top = run.topFt ?? run.baseFt;
    const base = run.baseFt ?? run.topFt;
    return top !== null && base !== null && intervalsOverlap(top, base, topFt, baseFt);
  });
}

export interface LasHeaderItem {
  readonly mnemonic: string;
  readonly unit: string;
  readonly value: string;
  readonly description: string;
}

export interface LasCurve extends LasHeaderItem {
  /** Samples aligned with the index curve; the file's NULL value becomes `null`. */
  readonly values: readonly (number | null)[];
}

export interface LasFile {
  readonly version: string;
  readonly well: Readonly<Record<string, LasHeaderItem>>;
  readonly parameters: Readonly<Record<string, LasHeaderItem>>;
  readonly curves: readonly LasCurve[];
  readonly nullValue: number;
}

// The delimiter is the last colon: values such as URLs or "LAT: 38" may contain colons.
const headerLine = /^\s*([^.\s]+)\s*\.(\S*)\s+(.*)\s*:\s*([^:]*?)\s*$/;

function headerItem(line: string): LasHeaderItem | undefined {
  const match = headerLine.exec(line) ?? /^\s*([^.\s]+)\s*\.(\S*)()\s*:\s*([^:]*?)\s*$/.exec(line);
  if (!match) return undefined;
  return { mnemonic: match[1] ?? "", unit: match[2] ?? "", value: (match[3] ?? "").trim(), description: match[4] ?? "" };
}

/** Parses an unwrapped LAS 2.0 file (~V, ~W, ~C, ~P, ~A sections). */
export function parseLas(text: string): LasFile {
  const sections = new Map<string, string[]>();
  let current = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (line.trimStart().startsWith("~")) {
      current = line.trimStart().charAt(1).toUpperCase();
      sections.set(current, []);
      continue;
    }
    sections.get(current)?.push(line);
  }
  const items = (key: string) => (sections.get(key) ?? []).map(headerItem).filter((item): item is LasHeaderItem => item !== undefined);
  const record = (list: readonly LasHeaderItem[]) => Object.freeze(Object.fromEntries(list.map((item) => [item.mnemonic.toUpperCase(), item])));
  const version = items("V");
  const wrap = version.find((item) => item.mnemonic.toUpperCase() === "WRAP")?.value.toUpperCase();
  if (wrap === "YES") throw new RangeError("Wrapped LAS files are not supported.");
  const well = record(items("W"));
  const nullValue = Number(well.NULL?.value ?? -999.25);
  const curveHeaders = items("C");
  if (!curveHeaders.length) throw new RangeError("LAS file has no ~Curve section.");
  const columns: (number | null)[][] = curveHeaders.map(() => []);
  for (const row of sections.get("A") ?? []) {
    const values = row.trim().split(/\s+/);
    if (values.length !== curveHeaders.length) throw new RangeError(`LAS data row has ${values.length} values; expected ${curveHeaders.length}.`);
    values.forEach((value, index) => {
      const number = Number(value);
      columns[index]?.push(!Number.isFinite(number) || Math.abs(number - nullValue) < 1e-9 ? null : number);
    });
  }
  return Object.freeze({
    version: version.find((item) => item.mnemonic.toUpperCase() === "VERS")?.value ?? "",
    well,
    parameters: record(items("P")),
    curves: Object.freeze(curveHeaders.map((header, index) => Object.freeze({ ...header, values: Object.freeze(columns[index] ?? []) }))),
    nullValue,
  });
}

/** Finds a curve by mnemonic, ignoring case and any vendor prefix such as `MUDL_`. */
export function lasCurve(las: LasFile, mnemonic: string): LasCurve | undefined {
  const wanted = mnemonic.toUpperCase();
  return las.curves.find((curve) => curve.mnemonic.toUpperCase() === wanted) ?? las.curves.find((curve) => curve.mnemonic.toUpperCase().endsWith(`_${wanted}`));
}

export * from "./well-history.ts";
