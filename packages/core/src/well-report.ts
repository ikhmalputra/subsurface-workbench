import { array, fail, literal, number, object, text } from "./contract-validation.ts";

export type WellReportProvenance = "documented" | "synthetic" | "user-authored";
export type WellReportValue = string | number | null;

export interface WellReportSource {
  readonly id: string;
  readonly title: string;
  readonly url: string | null;
  readonly license: string | null;
  readonly sha256: string | null;
}

export interface WellReportIdentity {
  readonly wellId: string;
  readonly name: string;
  readonly operator: string | null;
  readonly field: string | null;
  readonly uwi: string | null;
}

export interface WellReportDatum {
  readonly label: string;
  readonly value: WellReportValue;
  readonly unit: string | null;
  readonly sourceId: string | null;
}

export interface WellReportTableColumn {
  readonly key: string;
  readonly label: string;
  readonly unit: string | null;
}

export interface WellReportTableRow {
  readonly id: string;
  readonly mdM: number | null;
  readonly values: readonly WellReportValue[];
}

export interface WellReportTrajectoryPoint {
  readonly mdM: number;
  readonly tvdM: number;
  readonly eastingM: number | null;
  readonly northingM: number | null;
  readonly inclinationDeg?: number | null;
  readonly azimuthDeg?: number | null;
  readonly sourceRow?: number | null;
  readonly rawMdFt?: number | null;
  readonly rawTvdFt?: number | null;
}

export interface WellReportAppendixTable {
  readonly id: string;
  readonly title: string;
  readonly sourceId: string | null;
  readonly columns: readonly WellReportTableColumn[];
  readonly rows: readonly WellReportTableRow[];
}

export interface WellReportLogCurve {
  readonly id: string;
  readonly mnemonic: string;
  readonly unit: string | null;
  readonly color: string;
  readonly depthsMdM: readonly number[];
  readonly values: readonly (number | null)[];
}

export interface WellReportEvent {
  readonly id: string;
  readonly date: string;
  readonly label: string;
  readonly mdM: number | null;
  readonly sourceId: string | null;
  readonly sourcePage?: number | null;
}

export interface WellReportEvidence {
  readonly sourceId: string;
  readonly page: number | null;
}

export interface WellReportHighlight {
  readonly id: string;
  readonly title: string;
  readonly value: string;
  readonly detail: string;
  readonly tone: "note" | "attention";
  readonly evidence: readonly WellReportEvidence[];
}

export interface WellReportDrillingSection {
  readonly id: string;
  readonly name: string;
  readonly bitSizeIn: number;
  readonly topFt: number;
  readonly baseFt: number;
  readonly drilledFt: number;
  readonly runCount: number;
  readonly problemRuns: number;
  readonly avgRopFtPerHour: number | null;
  readonly casing: string;
  readonly sourceId: string;
}

export type WellReportStudyCategory =
  | "pressure"
  | "well-control"
  | "drilling-performance"
  | "temperature"
  | "logging"
  | "petrophysics"
  | "geomechanics"
  | "hydraulics-simulation"
  | "casing-design"
  | "reservoir-simulation"
  | "well-test"
  | "stimulation"
  | "other";

export type WellReportStudyStatus = "reported" | "incomplete" | "not-reported" | "not-computable";

export interface WellReportStudyTable {
  readonly caption: string;
  readonly columns: readonly WellReportTableColumn[];
  readonly rows: readonly WellReportTableRow[];
}

export interface WellReportStudy {
  readonly id: string;
  readonly title: string;
  readonly category: WellReportStudyCategory;
  readonly status: WellReportStudyStatus;
  readonly date: string | null;
  readonly depthMdM: number | null;
  readonly summary: string;
  readonly method: string | null;
  readonly inputs: readonly WellReportDatum[];
  readonly results: readonly WellReportDatum[];
  readonly table?: WellReportStudyTable;
  readonly limitations: readonly string[];
  readonly evidence: readonly WellReportEvidence[];
}

export interface WellReportExecutiveSummary {
  readonly text: string;
  readonly evidence: readonly WellReportEvidence[];
}

interface WellReportSectionBase {
  readonly id: string;
  readonly title: string;
}

export interface WellReportSummarySection extends WellReportSectionBase {
  readonly kind: "summary";
  readonly fields: readonly WellReportDatum[];
}

export interface WellReportTrajectorySection extends WellReportSectionBase {
  readonly kind: "trajectory";
  readonly sourceId: string | null;
  readonly frame: string;
  readonly points: readonly WellReportTrajectoryPoint[];
}

export type WellReportTableSectionKind =
  | "casing"
  | "cement"
  | "completion"
  | "formation-tops"
  | "offsets"
  | "data-coverage";

export type WellReportTableSection = {
  [Kind in WellReportTableSectionKind]: WellReportSectionBase & {
    readonly kind: Kind;
    readonly sourceId: string | null;
    readonly columns: readonly WellReportTableColumn[];
    readonly rows: readonly WellReportTableRow[];
  }
}[WellReportTableSectionKind];

export interface WellReportOperationsSection extends WellReportSectionBase {
  readonly kind: "operations";
  readonly events: readonly WellReportEvent[];
}

export interface WellReportLogsSection extends WellReportSectionBase {
  readonly kind: "logs";
  readonly sourceId: string | null;
  readonly curves: readonly WellReportLogCurve[];
}

export type WellReportListSection = {
  [Kind in "provenance" | "assumptions" | "not-checked"]: WellReportSectionBase & {
    readonly kind: Kind;
    readonly items: readonly string[];
  }
}["provenance" | "assumptions" | "not-checked"];

export type WellReportSection =
  | WellReportSummarySection
  | WellReportTrajectorySection
  | WellReportTableSection
  | WellReportOperationsSection
  | WellReportLogsSection
  | WellReportListSection;

export const wellReportSectionKinds = [
  "summary",
  "trajectory",
  "casing",
  "cement",
  "completion",
  "operations",
  "logs",
  "formation-tops",
  "offsets",
  "data-coverage",
  "provenance",
  "assumptions",
  "not-checked",
] as const satisfies readonly WellReportSection["kind"][];
const wellReportSectionKindSet: ReadonlySet<string> = new Set(wellReportSectionKinds);

function isWellReportSectionKind(value: unknown): value is WellReportSection["kind"] {
  return typeof value === "string" && wellReportSectionKindSet.has(value);
}

export interface WellReportSpec {
  readonly version: 1;
  readonly id: string;
  readonly title: string;
  readonly provenance: WellReportProvenance;
  readonly identity: WellReportIdentity;
  readonly datum: {
    readonly name: string;
    readonly referenceElevationMslM: number | null;
  };
  readonly sources: readonly WellReportSource[];
  readonly sections: readonly WellReportSection[];
  readonly executiveSummary?: WellReportExecutiveSummary;
  readonly highlights?: readonly WellReportHighlight[];
  readonly drillingSections?: readonly WellReportDrillingSection[];
  readonly studies?: readonly WellReportStudy[];
  readonly appendices?: readonly WellReportAppendixTable[];
}

function nullableText(value: unknown, path: string): string | null {
  return value === null ? null : text(value, path);
}

function nullableNumber(value: unknown, path: string): number | null {
  return value === null ? null : number(value, path);
}

function objectWithOptional(value: unknown, path: string, requiredKeys: readonly string[], optionalKeys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "expected an object");
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of Object.keys(record)) if (!allowedKeys.has(key)) fail(`${path}.${key}`, "unknown field");
  for (const key of requiredKeys) if (!Object.hasOwn(record, key)) fail(`${path}.${key}`, "required field");
  return record;
}

function sourceId(value: unknown, path: string, sources: ReadonlySet<string>): string | null {
  if (value === null) return null;
  const id = text(value, path);
  if (!sources.has(id)) fail(path, `unknown source identifier "${id}"`);
  return id;
}

function reportValue(value: unknown, path: string): WellReportValue {
  if (value === null || typeof value === "string") return value;
  return number(value, path);
}

function validateSource(value: unknown, path: string): WellReportSource {
  const record = object(value, path, ["id", "title", "url", "license", "sha256"]);
  const sha256 = nullableText(record.sha256, `${path}.sha256`);
  if (sha256 !== null && !/^[\da-f]{64}$/i.test(sha256)) fail(`${path}.sha256`, "expected a 64-character hexadecimal SHA-256 digest");
  const url = nullableText(record.url, `${path}.url`);
  if (url !== null) {
    try {
      new URL(url);
    } catch {
      fail(`${path}.url`, "expected an absolute URL");
    }
  }
  return {
    id: text(record.id, `${path}.id`),
    title: text(record.title, `${path}.title`),
    url,
    license: nullableText(record.license, `${path}.license`),
    sha256,
  };
}

function validateDatum(value: unknown, path: string, sources: ReadonlySet<string>): WellReportDatum {
  const record = object(value, path, ["label", "value", "unit", "sourceId"]);
  return {
    label: text(record.label, `${path}.label`),
    value: reportValue(record.value, `${path}.value`),
    unit: nullableText(record.unit, `${path}.unit`),
    sourceId: sourceId(record.sourceId, `${path}.sourceId`, sources),
  };
}

function validateEvidence(value: unknown, path: string, sources: ReadonlySet<string>): WellReportEvidence[] {
  const evidence = array(value, path).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const record = object(item, itemPath, ["sourceId", "page"]);
    const id = sourceId(record.sourceId, `${itemPath}.sourceId`, sources);
    if (id === null) fail(`${itemPath}.sourceId`, "evidence requires a source identifier");
    const page = nullableNumber(record.page, `${itemPath}.page`);
    if (page !== null && (!Number.isSafeInteger(page) || page < 1)) fail(`${itemPath}.page`, "source page must be a positive integer or null");
    return { sourceId: id, page };
  });
  if (evidence.length === 0) fail(path, "at least one evidence reference is required");
  return evidence;
}

function validateHighlights(value: unknown, path: string, sources: ReadonlySet<string>): WellReportHighlight[] {
  const ids = new Set<string>();
  return array(value, path).map((highlight, index) => {
    const itemPath = `${path}[${index}]`;
    const record = object(highlight, itemPath, ["id", "title", "value", "detail", "tone", "evidence"]);
    const id = text(record.id, `${itemPath}.id`);
    if (ids.has(id)) fail(`${itemPath}.id`, "duplicate highlight identifier");
    ids.add(id);
    const tone = record.tone;
    if (tone !== "note" && tone !== "attention") fail(`${itemPath}.tone`, "expected note or attention");
    return {
      id,
      title: text(record.title, `${itemPath}.title`),
      value: text(record.value, `${itemPath}.value`),
      detail: text(record.detail, `${itemPath}.detail`),
      tone,
      evidence: validateEvidence(record.evidence, `${itemPath}.evidence`, sources),
    };
  });
}

function validateExecutiveSummary(value: unknown, path: string, sources: ReadonlySet<string>): WellReportExecutiveSummary {
  const record = object(value, path, ["text", "evidence"]);
  return {
    text: text(record.text, `${path}.text`),
    evidence: validateEvidence(record.evidence, `${path}.evidence`, sources),
  };
}

function validateDrillingSections(value: unknown, path: string, sources: ReadonlySet<string>): WellReportDrillingSection[] {
  const ids = new Set<string>();
  return array(value, path).map((section, index) => {
    const itemPath = `${path}[${index}]`;
    const record = object(section, itemPath, [
      "id", "name", "bitSizeIn", "topFt", "baseFt", "drilledFt", "runCount",
      "problemRuns", "avgRopFtPerHour", "casing", "sourceId",
    ]);
    const id = text(record.id, `${itemPath}.id`);
    if (ids.has(id)) fail(`${itemPath}.id`, "duplicate drilling section identifier");
    ids.add(id);
    const bitSizeIn = number(record.bitSizeIn, `${itemPath}.bitSizeIn`);
    const topFt = number(record.topFt, `${itemPath}.topFt`);
    const baseFt = number(record.baseFt, `${itemPath}.baseFt`);
    const drilledFt = number(record.drilledFt, `${itemPath}.drilledFt`);
    const runCount = number(record.runCount, `${itemPath}.runCount`);
    const problemRuns = number(record.problemRuns, `${itemPath}.problemRuns`);
    const avgRopFtPerHour = nullableNumber(record.avgRopFtPerHour, `${itemPath}.avgRopFtPerHour`);
    if (bitSizeIn <= 0 || topFt < 0 || baseFt < topFt || drilledFt < 0) fail(itemPath, "bit size and depths must be positive/ordered and footage non-negative");
    if (!Number.isSafeInteger(runCount) || runCount < 0 || !Number.isSafeInteger(problemRuns) || problemRuns < 0 || problemRuns > runCount) {
      fail(itemPath, "run counts must be non-negative integers and problem runs cannot exceed total runs");
    }
    if (avgRopFtPerHour !== null && avgRopFtPerHour <= 0) fail(`${itemPath}.avgRopFtPerHour`, "average ROP must be positive or null");
    const source = sourceId(record.sourceId, `${itemPath}.sourceId`, sources);
    if (source === null) fail(`${itemPath}.sourceId`, "drilling section requires a source identifier");
    return {
      id,
      name: text(record.name, `${itemPath}.name`),
      bitSizeIn,
      topFt,
      baseFt,
      drilledFt,
      runCount,
      problemRuns,
      avgRopFtPerHour,
      casing: text(record.casing, `${itemPath}.casing`),
      sourceId: source,
    };
  });
}

function validateStudyCategory(value: unknown, path: string): WellReportStudyCategory {
  const categories: readonly WellReportStudyCategory[] = [
    "pressure", "well-control", "drilling-performance", "temperature", "logging",
    "petrophysics", "geomechanics", "hydraulics-simulation", "casing-design",
    "reservoir-simulation", "well-test", "stimulation", "other",
  ];
  if (typeof value !== "string" || !categories.includes(value as WellReportStudyCategory)) {
    fail(path, "unknown study category");
  }
  return value as WellReportStudyCategory;
}

function validateStudyStatus(value: unknown, path: string): WellReportStudyStatus {
  if (value !== "reported" && value !== "incomplete" && value !== "not-reported" && value !== "not-computable") {
    fail(path, "expected reported, incomplete, not-reported, or not-computable");
  }
  return value;
}

function validateStudyDate(value: unknown, path: string): string | null {
  const date = nullableText(value, path);
  if (date !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) {
    fail(path, "expected a valid ISO date in YYYY-MM-DD form or null");
  }
  return date;
}

function validateStudyTable(value: unknown, path: string): WellReportStudyTable {
  const record = object(value, path, ["caption", "columns", "rows"]);
  const columns = validateColumns(record.columns, `${path}.columns`);
  return {
    caption: text(record.caption, `${path}.caption`),
    columns,
    rows: validateRows(record.rows, `${path}.rows`, columns),
  };
}

function validateStudies(value: unknown, path: string, sources: ReadonlySet<string>): WellReportStudy[] {
  const ids = new Set<string>();
  return array(value, path).map((study, index) => {
    const itemPath = `${path}[${index}]`;
    const record = objectWithOptional(study, itemPath, [
      "id", "title", "category", "status", "date", "depthMdM", "summary",
      "method", "inputs", "results", "limitations", "evidence",
    ], ["table"]);
    const id = text(record.id, `${itemPath}.id`);
    if (ids.has(id)) fail(`${itemPath}.id`, "duplicate study identifier");
    ids.add(id);
    const depthMdM = nullableNumber(record.depthMdM, `${itemPath}.depthMdM`);
    if (depthMdM !== null && depthMdM < 0) fail(`${itemPath}.depthMdM`, "MD must be non-negative");
    return {
      id,
      title: text(record.title, `${itemPath}.title`),
      category: validateStudyCategory(record.category, `${itemPath}.category`),
      status: validateStudyStatus(record.status, `${itemPath}.status`),
      date: validateStudyDate(record.date, `${itemPath}.date`),
      depthMdM,
      summary: text(record.summary, `${itemPath}.summary`),
      method: nullableText(record.method, `${itemPath}.method`),
      inputs: array(record.inputs, `${itemPath}.inputs`).map((input, inputIndex) => validateDatum(input, `${itemPath}.inputs[${inputIndex}]`, sources)),
      results: array(record.results, `${itemPath}.results`).map((result, resultIndex) => validateDatum(result, `${itemPath}.results[${resultIndex}]`, sources)),
      ...(record.table === undefined ? {} : { table: validateStudyTable(record.table, `${itemPath}.table`) }),
      limitations: array(record.limitations, `${itemPath}.limitations`).map((item, limitationIndex) => text(item, `${itemPath}.limitations[${limitationIndex}]`)),
      evidence: validateEvidence(record.evidence, `${itemPath}.evidence`, sources),
    };
  });
}

function validateColumns(value: unknown, path: string): WellReportTableColumn[] {
  const seen = new Set<string>();
  return array(value, path).map((column, index) => {
    const itemPath = `${path}[${index}]`;
    const record = object(column, itemPath, ["key", "label", "unit"]);
    const key = text(record.key, `${itemPath}.key`);
    if (seen.has(key)) fail(`${itemPath}.key`, "duplicate column key");
    seen.add(key);
    return { key, label: text(record.label, `${itemPath}.label`), unit: nullableText(record.unit, `${itemPath}.unit`) };
  });
}

function validateRows(value: unknown, path: string, columns: readonly WellReportTableColumn[]): WellReportTableRow[] {
  const seen = new Set<string>();
  return array(value, path).map((row, index) => {
    const itemPath = `${path}[${index}]`;
    const record = object(row, itemPath, ["id", "mdM", "values"]);
    const id = text(record.id, `${itemPath}.id`);
    if (seen.has(id)) fail(`${itemPath}.id`, "duplicate row identifier");
    seen.add(id);
    const mdM = nullableNumber(record.mdM, `${itemPath}.mdM`);
    if (mdM !== null && mdM < 0) fail(`${itemPath}.mdM`, "MD must be non-negative");
    const values = array(record.values, `${itemPath}.values`).map((cell, cellIndex) => reportValue(cell, `${itemPath}.values[${cellIndex}]`));
    if (values.length !== columns.length) fail(`${itemPath}.values`, `expected ${columns.length} cells, received ${values.length}`);
    return { id, mdM, values };
  });
}

function validateTrajectoryPoints(value: unknown, path: string): WellReportTrajectoryPoint[] {
  let previousMd = -Infinity;
  return array(value, path).map((point, index) => {
    const itemPath = `${path}[${index}]`;
    const record = objectWithOptional(
      point,
      itemPath,
      ["mdM", "tvdM", "eastingM", "northingM"],
      ["inclinationDeg", "azimuthDeg", "sourceRow", "rawMdFt", "rawTvdFt"],
    );
    const mdM = number(record.mdM, `${itemPath}.mdM`);
    if (mdM < 0 || mdM <= previousMd) fail(`${itemPath}.mdM`, "MD must be non-negative and strictly increasing");
    previousMd = mdM;
    const eastingM = nullableNumber(record.eastingM, `${itemPath}.eastingM`);
    const northingM = nullableNumber(record.northingM, `${itemPath}.northingM`);
    if ((eastingM === null) !== (northingM === null)) fail(itemPath, "eastingM and northingM must both be reported or both be null");
    const inclinationDeg = record.inclinationDeg === undefined ? null : nullableNumber(record.inclinationDeg, `${itemPath}.inclinationDeg`);
    const azimuthDeg = record.azimuthDeg === undefined ? null : nullableNumber(record.azimuthDeg, `${itemPath}.azimuthDeg`);
    if (inclinationDeg !== null && (inclinationDeg < 0 || inclinationDeg > 180)) fail(`${itemPath}.inclinationDeg`, "inclination must be between 0 and 180 degrees");
    if (azimuthDeg !== null && (azimuthDeg < 0 || azimuthDeg >= 360)) fail(`${itemPath}.azimuthDeg`, "azimuth must be in [0, 360) degrees");
    const sourceRow = record.sourceRow === undefined ? null : nullableNumber(record.sourceRow, `${itemPath}.sourceRow`);
    if (sourceRow !== null && (!Number.isSafeInteger(sourceRow) || sourceRow < 1)) fail(`${itemPath}.sourceRow`, "source row must be a positive integer");
    const rawMdFt = record.rawMdFt === undefined ? null : nullableNumber(record.rawMdFt, `${itemPath}.rawMdFt`);
    const rawTvdFt = record.rawTvdFt === undefined ? null : nullableNumber(record.rawTvdFt, `${itemPath}.rawTvdFt`);
    return { mdM, tvdM: number(record.tvdM, `${itemPath}.tvdM`), eastingM, northingM, inclinationDeg, azimuthDeg, sourceRow, rawMdFt, rawTvdFt };
  });
}

function validateAppendices(value: unknown, path: string, sources: ReadonlySet<string>): WellReportAppendixTable[] {
  const ids = new Set<string>();
  return array(value, path).map((appendix, index) => {
    const itemPath = `${path}[${index}]`;
    const record = object(appendix, itemPath, ["id", "title", "sourceId", "columns", "rows"]);
    const id = text(record.id, `${itemPath}.id`);
    if (ids.has(id)) fail(`${itemPath}.id`, "duplicate appendix identifier");
    ids.add(id);
    const columns = validateColumns(record.columns, `${itemPath}.columns`);
    return {
      id,
      title: text(record.title, `${itemPath}.title`),
      sourceId: sourceId(record.sourceId, `${itemPath}.sourceId`, sources),
      columns,
      rows: validateRows(record.rows, `${itemPath}.rows`, columns),
    };
  });
}

function validateLogCurves(value: unknown, path: string): WellReportLogCurve[] {
  const curveIds = new Set<string>();
  return array(value, path).map((curve, index) => {
    const itemPath = `${path}[${index}]`;
    const record = object(curve, itemPath, ["id", "mnemonic", "unit", "color", "depthsMdM", "values"]);
    const id = text(record.id, `${itemPath}.id`);
    if (curveIds.has(id)) fail(`${itemPath}.id`, "duplicate curve identifier");
    curveIds.add(id);
    const depths = array(record.depthsMdM, `${itemPath}.depthsMdM`).map((depth, sampleIndex) => {
      const mdM = number(depth, `${itemPath}.depthsMdM[${sampleIndex}]`);
      if (mdM < 0 || (sampleIndex > 0 && mdM <= number((record.depthsMdM as unknown[])[sampleIndex - 1], `${itemPath}.depthsMdM[${sampleIndex - 1}]`))) {
        fail(`${itemPath}.depthsMdM[${sampleIndex}]`, "MD must be non-negative and strictly increasing");
      }
      return mdM;
    });
    const values = array(record.values, `${itemPath}.values`).map((sample, sampleIndex) => sample === null ? null : number(sample, `${itemPath}.values[${sampleIndex}]`));
    if (values.length !== depths.length) fail(`${itemPath}.values`, `expected ${depths.length} samples, received ${values.length}`);
    const color = text(record.color, `${itemPath}.color`);
    if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color)) fail(`${itemPath}.color`, "expected a CSS hex color");
    return {
      id,
      mnemonic: text(record.mnemonic, `${itemPath}.mnemonic`),
      unit: nullableText(record.unit, `${itemPath}.unit`),
      color,
      depthsMdM: depths,
      values,
    };
  });
}

function validateEvents(value: unknown, path: string, sources: ReadonlySet<string>): WellReportEvent[] {
  const ids = new Set<string>();
  return array(value, path).map((event, index) => {
    const itemPath = `${path}[${index}]`;
    const record = objectWithOptional(event, itemPath, ["id", "date", "label", "mdM", "sourceId"], ["sourcePage"]);
    const id = text(record.id, `${itemPath}.id`);
    if (ids.has(id)) fail(`${itemPath}.id`, "duplicate event identifier");
    ids.add(id);
    const date = text(record.date, `${itemPath}.date`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
      fail(`${itemPath}.date`, "expected a valid ISO date in YYYY-MM-DD form");
    }
    const mdM = nullableNumber(record.mdM, `${itemPath}.mdM`);
    if (mdM !== null && mdM < 0) fail(`${itemPath}.mdM`, "MD must be non-negative");
    const sourcePage = record.sourcePage === undefined ? undefined : nullableNumber(record.sourcePage, `${itemPath}.sourcePage`);
    if (sourcePage !== undefined && sourcePage !== null && (!Number.isSafeInteger(sourcePage) || sourcePage < 1)) {
      fail(`${itemPath}.sourcePage`, "source page must be a positive integer or null");
    }
    return {
      id,
      date,
      label: text(record.label, `${itemPath}.label`),
      mdM,
      sourceId: sourceId(record.sourceId, `${itemPath}.sourceId`, sources),
      ...(sourcePage === undefined ? {} : { sourcePage }),
    };
  });
}

function validateSection(value: unknown, path: string, sources: ReadonlySet<string>): WellReportSection {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "expected an object");
  const kind = (value as { kind?: unknown }).kind;
  if (!isWellReportSectionKind(kind)) {
    fail(`${path}.kind`, "unknown report section kind");
  }
  const sectionKind = kind;
  const base = { id: "", title: "" };
  switch (sectionKind) {
    case "summary": {
      const record = object(value, path, ["id", "title", "kind", "fields"]);
      return {
        ...base,
        id: text(record.id, `${path}.id`),
        title: text(record.title, `${path}.title`),
        kind: sectionKind,
        fields: array(record.fields, `${path}.fields`).map((field, index) => validateDatum(field, `${path}.fields[${index}]`, sources)),
      };
    }
    case "trajectory": {
      const record = object(value, path, ["id", "title", "kind", "sourceId", "frame", "points"]);
      return {
        ...base,
        id: text(record.id, `${path}.id`),
        title: text(record.title, `${path}.title`),
        kind: sectionKind,
        sourceId: sourceId(record.sourceId, `${path}.sourceId`, sources),
        frame: text(record.frame, `${path}.frame`),
        points: validateTrajectoryPoints(record.points, `${path}.points`),
      };
    }
    case "casing":
    case "cement":
    case "completion":
    case "formation-tops":
    case "offsets":
    case "data-coverage": {
      const record = object(value, path, ["id", "title", "kind", "sourceId", "columns", "rows"]);
      const columns = validateColumns(record.columns, `${path}.columns`);
      return {
        ...base,
        id: text(record.id, `${path}.id`),
        title: text(record.title, `${path}.title`),
        kind: sectionKind,
        sourceId: sourceId(record.sourceId, `${path}.sourceId`, sources),
        columns,
        rows: validateRows(record.rows, `${path}.rows`, columns),
      };
    }
    case "operations": {
      const record = object(value, path, ["id", "title", "kind", "events"]);
      return {
        ...base,
        id: text(record.id, `${path}.id`),
        title: text(record.title, `${path}.title`),
        kind: sectionKind,
        events: validateEvents(record.events, `${path}.events`, sources),
      };
    }
    case "logs": {
      const record = object(value, path, ["id", "title", "kind", "sourceId", "curves"]);
      return {
        ...base,
        id: text(record.id, `${path}.id`),
        title: text(record.title, `${path}.title`),
        kind: sectionKind,
        sourceId: sourceId(record.sourceId, `${path}.sourceId`, sources),
        curves: validateLogCurves(record.curves, `${path}.curves`),
      };
    }
    case "provenance":
    case "assumptions":
    case "not-checked": {
      const record = object(value, path, ["id", "title", "kind", "items"]);
      return {
        ...base,
        id: text(record.id, `${path}.id`),
        title: text(record.title, `${path}.title`),
        kind: sectionKind,
        items: array(record.items, `${path}.items`).map((item, index) => text(item, `${path}.items[${index}]`)),
      };
    }
  }
}

/** Validate a JSON-compatible, parser-independent report document without deriving or filling values. */
export function validateWellReportSpec(value: unknown): WellReportSpec {
  const record = objectWithOptional(
    value,
    "$",
    ["version", "id", "title", "provenance", "identity", "datum", "sources", "sections"],
    ["executiveSummary", "highlights", "drillingSections", "studies", "appendices"],
  );
  const version = literal(record.version, 1, "$.version");
  const provenanceValue = record.provenance;
  if (provenanceValue !== "documented" && provenanceValue !== "synthetic" && provenanceValue !== "user-authored") {
    fail("$.provenance", "expected documented, synthetic, or user-authored");
  }
  const identityRecord = object(record.identity, "$.identity", ["wellId", "name", "operator", "field", "uwi"]);
  const datumRecord = object(record.datum, "$.datum", ["name", "referenceElevationMslM"]);
  const elevation = nullableNumber(datumRecord.referenceElevationMslM, "$.datum.referenceElevationMslM");
  const sources = array(record.sources, "$.sources").map((source, index) => validateSource(source, `$.sources[${index}]`));
  const sourceIds = new Set<string>();
  sources.forEach((source, index) => {
    if (sourceIds.has(source.id)) fail(`$.sources[${index}].id`, "duplicate source identifier");
    sourceIds.add(source.id);
  });
  const sections = array(record.sections, "$.sections").map((section, index) => validateSection(section, `$.sections[${index}]`, sourceIds));
  const executiveSummary = record.executiveSummary === undefined ? undefined : validateExecutiveSummary(record.executiveSummary, "$.executiveSummary", sourceIds);
  const highlights = record.highlights === undefined ? undefined : validateHighlights(record.highlights, "$.highlights", sourceIds);
  const drillingSections = record.drillingSections === undefined ? undefined : validateDrillingSections(record.drillingSections, "$.drillingSections", sourceIds);
  const studies = record.studies === undefined ? undefined : validateStudies(record.studies, "$.studies", sourceIds);
  const appendices = record.appendices === undefined ? [] : validateAppendices(record.appendices, "$.appendices", sourceIds);
  const sectionKinds = new Set<string>();
  const sectionIds = new Set<string>();
  sections.forEach((section, index) => {
    if (sectionKinds.has(section.kind)) fail(`$.sections[${index}].kind`, "duplicate section kind");
    if (sectionIds.has(section.id)) fail(`$.sections[${index}].id`, "duplicate section identifier");
    sectionKinds.add(section.kind);
    sectionIds.add(section.id);
  });
  appendices.forEach((appendix, index) => {
    if (sectionIds.has(appendix.id)) fail(`$.appendices[${index}].id`, "duplicate report section or appendix identifier");
    sectionIds.add(appendix.id);
  });
  for (const requiredKind of wellReportSectionKinds) {
    if (!sectionKinds.has(requiredKind)) fail("$.sections", `missing required "${requiredKind}" section`);
  }
  if (sections.length !== wellReportSectionKinds.length) fail("$.sections", "unexpected section count");
  return {
    version,
    id: text(record.id, "$.id"),
    title: text(record.title, "$.title"),
    provenance: provenanceValue,
    identity: {
      wellId: text(identityRecord.wellId, "$.identity.wellId"),
      name: text(identityRecord.name, "$.identity.name"),
      operator: nullableText(identityRecord.operator, "$.identity.operator"),
      field: nullableText(identityRecord.field, "$.identity.field"),
      uwi: nullableText(identityRecord.uwi, "$.identity.uwi"),
    },
    datum: {
      name: text(datumRecord.name, "$.datum.name"),
      referenceElevationMslM: elevation,
    },
    sources,
    sections,
    ...(executiveSummary === undefined ? {} : { executiveSummary }),
    ...(highlights === undefined ? {} : { highlights }),
    ...(drillingSections === undefined ? {} : { drillingSections }),
    ...(studies === undefined ? {} : { studies }),
    appendices,
  };
}
