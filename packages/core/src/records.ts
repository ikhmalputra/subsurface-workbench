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
  // A NULL header that is not a number (a corrupted file) falls back to the LAS 2.0 default, so the null marker still nulls (found by fuzzing).
  const declaredNull = Number(well.NULL?.value ?? -999.25);
  const nullValue = Number.isFinite(declaredNull) ? declaredNull : -999.25;
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

/**
 * Writes an unwrapped LAS 2.0 file that `parseLas` (and any LAS 2.0 reader) reads back: ~Version,
 * ~Well with STRT, STOP, STEP and NULL taken from the index curve, ~Curve, ~Parameter and ~ASCII.
 * The index is the first curve: depth (DEPT, M or FT) or time (TIME or ETIM, any time unit).
 */
export function formatLas(file: {
  readonly well: readonly LasHeaderItem[];
  readonly parameters?: readonly LasHeaderItem[];
  readonly curves: readonly (LasHeaderItem & { readonly values: readonly (number | null)[]; readonly digits?: number })[];
  readonly nullValue?: number;
  readonly comments?: readonly string[];
}): string {
  const nullValue = file.nullValue ?? -999.25;
  const index = file.curves[0];
  if (!index) throw new RangeError("A LAS file needs an index curve.");
  const n = index.values.length;
  if (file.curves.some((curve) => curve.values.length !== n)) throw new RangeError("Every curve needs one value per index sample.");
  const indexValues = index.values.filter((v): v is number => v !== null);
  const step = n > 1 && indexValues.length === n ? (indexValues[n - 1]! - indexValues[0]!) / (n - 1) : 0;
  const regular = n > 1 && indexValues.length === n && indexValues.every((v, i) => Math.abs(v - (indexValues[0]! + i * step)) < Math.abs(step) * 1e-6 + 1e-9);
  const pad = (s: string, w: number) => s.length >= w ? `${s} ` : s.padEnd(w);
  const line = (item: LasHeaderItem) => `${pad(` ${item.mnemonic}.${item.unit}`, 16)}${pad(item.value, 28)}: ${item.description}`;
  const reserved = new Set(["STRT", "STOP", "STEP", "NULL"]);
  const fixed: LasHeaderItem[] = [
    { mnemonic: "STRT", unit: index.unit, value: String(indexValues[0] ?? 0), description: "First index value" },
    { mnemonic: "STOP", unit: index.unit, value: String(indexValues.at(-1) ?? 0), description: "Last index value" },
    { mnemonic: "STEP", unit: index.unit, value: regular ? String(Number(step.toFixed(6))) : "0", description: regular ? "Step" : "Irregular sampling" },
    { mnemonic: "NULL", unit: "", value: String(nullValue), description: "Null value" },
  ];
  const value = (v: number | null, digits: number) => v === null || !Number.isFinite(v) ? String(nullValue) : v.toFixed(digits);
  const rows: string[] = [];
  for (let i = 0; i < n; i++) rows.push(file.curves.map((curve) => value(curve.values[i] ?? null, curve.digits ?? 4).padStart(12)).join(" "));
  return [
    ...(file.comments ?? []).map((c) => `# ${c}`),
    "~Version Information",
    line({ mnemonic: "VERS", unit: "", value: "2.0", description: "CWLS LOG ASCII STANDARD - VERSION 2.0" }),
    line({ mnemonic: "WRAP", unit: "", value: "NO", description: "One line per index step" }),
    "~Well Information",
    ...fixed.map(line),
    ...file.well.filter((item) => !reserved.has(item.mnemonic.toUpperCase())).map(line),
    "~Curve Information",
    ...file.curves.map(line),
    ...(file.parameters?.length ? ["~Parameter Information", ...file.parameters.map(line)] : []),
    `~ASCII ${file.curves.map((curve) => curve.mnemonic).join(" ")}`,
    ...rows,
    "",
  ].join("\n");
}

/** Finds a curve by mnemonic, ignoring case and any vendor prefix such as `MUDL_`. */
export function lasCurve(las: LasFile, mnemonic: string): LasCurve | undefined {
  const wanted = mnemonic.toUpperCase();
  return las.curves.find((curve) => curve.mnemonic.toUpperCase() === wanted) ?? las.curves.find((curve) => curve.mnemonic.toUpperCase().endsWith(`_${wanted}`));
}

export * from "./well-history.ts";
