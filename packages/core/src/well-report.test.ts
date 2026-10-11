import assert from "node:assert/strict";
import test from "node:test";
import { ContractValidationError, validateWellReportSpec } from "./contracts.ts";
import type { WellReportSpec } from "./contracts.ts";

const report: WellReportSpec = {
  version: 1,
  id: "report-01",
  title: "Well review",
  provenance: "documented",
  identity: { wellId: "well-01", name: "Example well", operator: null, field: "Field A", uwi: null },
  datum: { name: "RKB", referenceElevationMslM: null },
  sources: [{
    id: "survey-source",
    title: "Measured survey",
    url: "https://example.test/survey",
    license: "CC-BY-4.0",
    sha256: "a".repeat(64),
  }],
  executiveSummary: {
    text: "A concise source-backed well overview.",
    evidence: [{ sourceId: "survey-source", page: 4 }],
  },
  highlights: [{
    id: "survey-gap",
    title: "Survey coverage",
    value: "32 ft",
    detail: "Observed survey ends short of reported drilled TD.",
    tone: "attention",
    evidence: [{ sourceId: "survey-source", page: 4 }],
  }],
  drillingSections: [{
    id: "production",
    name: "Production",
    bitSizeIn: 8.75,
    topFt: 5113,
    baseFt: 10987,
    drilledFt: 5865,
    runCount: 47,
    problemRuns: 8,
    avgRopFtPerHour: 28.3,
    casing: "7 in string",
    sourceId: "survey-source",
  }],
  studies: [{
    id: "fit-01",
    title: "Formation integrity test",
    category: "pressure",
    status: "reported",
    date: "2024-01-02",
    depthMdM: 400,
    summary: "The source reports an equivalent mud weight result.",
    method: "Source-reported FIT result; not interpreted as a continuous gradient.",
    inputs: [{ label: "Test depth", value: 400, unit: "m MD", sourceId: "survey-source" }],
    results: [{ label: "Test EMW", value: 9.5, unit: "ppg", sourceId: "survey-source" }],
    table: {
      caption: "Pressure step results",
      columns: [{ key: "emw", label: "EMW", unit: "ppg" }],
      rows: [{ id: "step-1", mdM: 400, values: [9.5] }],
    },
    limitations: ["The result does not define a continuous pressure profile."],
    evidence: [{ sourceId: "survey-source", page: 8 }],
  }],
  sections: [
    { id: "summary", title: "Summary", kind: "summary", fields: [
      { label: "Total depth", value: 1250, unit: "m MD", sourceId: "survey-source" },
      { label: "Offset count", value: null, unit: null, sourceId: null },
    ] },
    { id: "trajectory", title: "Trajectory", kind: "trajectory", sourceId: "survey-source", frame: "local XYZ · RKB", points: [{ mdM: 0, tvdM: 0, eastingM: 0, northingM: 0 }, { mdM: 1250, tvdM: 1100, eastingM: 450, northingM: -75 }] },
    { id: "casing", title: "Casing", kind: "casing", sourceId: "survey-source", columns: [{ key: "name", label: "String", unit: null }, { key: "shoe", label: "Shoe", unit: "m MD" }], rows: [{ id: "surface", mdM: 400, values: ["Surface", 400] }] },
    { id: "cement", title: "Cement", kind: "cement", sourceId: null, columns: [{ key: "status", label: "Status", unit: null }], rows: [] },
    { id: "completion", title: "Completion", kind: "completion", sourceId: null, columns: [], rows: [] },
    { id: "operations", title: "Operations", kind: "operations", events: [{ id: "spud", date: "2024-01-01", label: "Spud", mdM: null, sourceId: "survey-source", sourcePage: 7 }] },
    { id: "logs", title: "Logs", kind: "logs", sourceId: "survey-source", curves: [{ id: "gr", mnemonic: "GR", unit: "API", color: "#247c59", depthsMdM: [100, 110, 120], values: [35, null, 48] }] },
    { id: "tops", title: "Formation tops", kind: "formation-tops", sourceId: null, columns: [{ key: "top", label: "Top", unit: "m TVD" }], rows: [] },
    { id: "offsets", title: "Offsets", kind: "offsets", sourceId: null, columns: [{ key: "well", label: "Well", unit: null }], rows: [] },
    { id: "coverage", title: "Data coverage", kind: "data-coverage", sourceId: "survey-source", columns: [{ key: "record", label: "Record", unit: null }], rows: [] },
    { id: "provenance", title: "Provenance", kind: "provenance", items: ["Survey supplied by host."] },
    { id: "assumptions", title: "Assumptions", kind: "assumptions", items: ["No interpolation is applied."] },
    { id: "not-checked", title: "Not checked", kind: "not-checked", items: ["Engineering design verification."] },
  ],
};

function rejects(value: unknown, path: string) {
  assert.throws(() => validateWellReportSpec(value), (error: unknown) => {
    assert.ok(error instanceof ContractValidationError);
    assert.equal(error.issues[0]?.path, path);
    assert.ok(error.issues[0]?.message);
    return true;
  });
}

test("well report validates a complete declarative document and preserves unknown values", () => {
  const validated = validateWellReportSpec(JSON.parse(JSON.stringify(report)));
  assert.equal(validated.identity.operator, null);
  assert.equal(validated.executiveSummary?.evidence[0]?.page, 4);
  const operations = validated.sections.find((section) => section.kind === "operations");
  assert.equal(operations?.kind, "operations");
  if (operations?.kind === "operations") assert.equal(operations.events[0]?.sourcePage, 7);
  assert.equal(validated.highlights?.[0]?.evidence[0]?.page, 4);
  assert.equal(validated.drillingSections?.[0]?.problemRuns, 8);
  assert.equal(validated.studies?.[0]?.status, "reported");
  assert.equal(validated.studies?.[0]?.table?.rows[0]?.values[0], 9.5);
  assert.equal(validated.sections.find((section) => section.kind === "summary")?.kind, "summary");
  const logs = validated.sections.find((section) => section.kind === "logs");
  assert.equal(logs?.kind, "logs");
  if (logs?.kind === "logs") assert.deepEqual(logs.curves[0]?.values, [35, null, 48]);
});

test("well report requires cited executive summaries and validates milestone source pages", () => {
  rejects({
    ...report,
    executiveSummary: { text: "Unsupported source.", evidence: [{ sourceId: "missing-source", page: null }] },
  }, "$.executiveSummary.evidence[0].sourceId");
  const sections = report.sections.map((section) => section.kind === "operations"
    ? { ...section, events: [{ ...section.events[0]!, sourcePage: 0 }] }
    : section);
  rejects({ ...report, sections }, "$.sections[5].events[0].sourcePage");
});

test("well report validates evidence-backed highlights and drilling performance", () => {
  rejects({
    ...report,
    highlights: [{ ...report.highlights![0]!, evidence: [{ sourceId: "missing", page: 4 }] }],
  }, "$.highlights[0].evidence[0].sourceId");
  rejects({
    ...report,
    highlights: [{ ...report.highlights![0]!, evidence: [{ sourceId: "survey-source", page: 0 }] }],
  }, "$.highlights[0].evidence[0].page");
  rejects({
    ...report,
    drillingSections: [{ ...report.drillingSections![0]!, problemRuns: 48 }],
  }, "$.drillingSections[0]");
  rejects({
    ...report,
    drillingSections: [{ ...report.drillingSections![0]!, avgRopFtPerHour: 0 }],
  }, "$.drillingSections[0].avgRopFtPerHour");
});

test("well report validates study statuses, dated evidence, result tables, and source links", () => {
  rejects({
    ...report,
    studies: [{ ...report.studies![0]!, status: "complete" }],
  }, "$.studies[0].status");
  rejects({
    ...report,
    studies: [{ ...report.studies![0]!, date: "2024-02-30" }],
  }, "$.studies[0].date");
  rejects({
    ...report,
    studies: [{ ...report.studies![0]!, category: "reservoir-simulator" }],
  }, "$.studies[0].category");
  rejects({
    ...report,
    studies: [{ ...report.studies![0]!, evidence: [{ sourceId: "missing-source", page: null }] }],
  }, "$.studies[0].evidence[0].sourceId");
  rejects({
    ...report,
    studies: [{ ...report.studies![0]!, table: { ...report.studies![0]!.table!, rows: [{ id: "bad", mdM: null, values: [] }] } }],
  }, "$.studies[0].table.rows[0].values");
  rejects({
    ...report,
    studies: [report.studies![0]!, report.studies![0]!],
  }, "$.studies[1].id");
});

test("well report rejects unknown fields, duplicate or missing sections and bad source references", () => {
  rejects({ ...report, unexpected: true }, "$.unexpected");
  rejects({ ...report, sections: report.sections.slice(1) }, "$.sections");
  rejects({ ...report, sections: [...report.sections, report.sections[0]!] }, "$.sections[13].kind");
  const sections = report.sections.map((section) => section.kind === "summary"
    ? { ...section, fields: [{ label: "Total depth", value: 1, unit: "m", sourceId: "missing-source" }] }
    : section);
  rejects({ ...report, sections }, "$.sections[0].fields[0].sourceId");
});

test("well report rejects invalid row depths, sample alignment, coordinate pairs and impossible dates", () => {
  const badColumns = report.sections.map((section) => section.kind === "casing"
    ? { ...section, rows: [{ id: "bad", mdM: -1, values: ["row", 1] }] }
    : section);
  rejects({ ...report, sections: badColumns }, "$.sections[2].rows[0].mdM");
  const badCurve = report.sections.map((section) => section.kind === "logs"
    ? { ...section, curves: [{ ...section.curves[0]!, depthsMdM: [100, 100], values: [1, null] }] }
    : section);
  rejects({ ...report, sections: badCurve }, "$.sections[6].curves[0].depthsMdM[1]");
  const badEvent = report.sections.map((section) => section.kind === "operations"
    ? { ...section, events: [{ id: "bad-date", date: "2024-02-30", label: "Bad", mdM: null, sourceId: null }] }
    : section);
  rejects({ ...report, sections: badEvent }, "$.sections[5].events[0].date");
  const incompleteCoordinates = report.sections.map((section) => section.kind === "trajectory"
    ? { ...section, points: [{ mdM: 0, tvdM: 0, eastingM: 0, northingM: null }] }
    : section);
  rejects({ ...report, sections: incompleteCoordinates }, "$.sections[1].points[0]");
});

test("well report validates complete source appendices, column alignment, and unique IDs", () => {
  const appendix = {
    id: "survey-register",
    title: "Survey source register",
    sourceId: "survey-source",
    columns: [{ key: "raw-md", label: "Raw MD", unit: "ft" }],
    rows: [{ id: "station-1", mdM: 0, values: [80] }],
  };
  const validated = validateWellReportSpec({ ...report, appendices: [appendix] });
  assert.equal(validated.appendices?.[0]?.rows[0]?.values[0], 80);
  rejects({ ...report, appendices: [{ ...appendix, sourceId: "missing" }] }, "$.appendices[0].sourceId");
  rejects({ ...report, appendices: [{ ...appendix, rows: [{ id: "bad", mdM: null, values: [] }] }] }, "$.appendices[0].rows[0].values");
  rejects({ ...report, appendices: [appendix, appendix] }, "$.appendices[1].id");
  rejects({ ...report, appendices: [{ ...appendix, id: "summary" }] }, "$.appendices[0].id");
});
