import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { forgeDesign, getWellComponents } from "../../core/dist/index.js";
import { validateWellReportSpec } from "../../core/dist/contracts.js";
import { WellReportView } from "../dist/2d.js";

const report = validateWellReportSpec({
  version: 1,
  id: "well-report-01",
  title: "Well review report",
  provenance: "documented",
  identity: { wellId: "well-01", name: "Example well", operator: null, field: "Field A", uwi: null },
  datum: { name: "RKB", referenceElevationMslM: 125, },
  sources: [{ id: "survey", title: "Observed directional survey", url: "https://example.test/survey", license: "CC-BY-4.0", sha256: "a".repeat(64) }],
  executiveSummary: {
    text: "An observed survey and reported drilled TD are different measurements.",
    evidence: [{ sourceId: "survey", page: 4 }],
  },
  highlights: [{
    id: "survey-gap",
    title: "Survey coverage exception",
    value: "32 ft",
    detail: "The observed survey stops short of reported drilled TD.",
    tone: "attention",
    evidence: [{ sourceId: "survey", page: 4 }],
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
    casing: "7 in string to 10,787 ft",
    sourceId: "survey",
  }],
  studies: [{
    id: "fit-01",
    title: "Formation integrity test",
    category: "pressure",
    status: "reported",
    date: "2024-01-02",
    depthMdM: 400,
    summary: "A source-reported formation integrity result.",
    method: "Recorded test EMW; no gradient is inferred.",
    inputs: [{ label: "Test depth", value: 400, unit: "m MD", sourceId: "survey" }],
    results: [{ label: "Test EMW", value: 9.5, unit: "ppg", sourceId: "survey" }],
    table: {
      caption: "FIT results",
      columns: [{ key: "emw", label: "EMW", unit: "ppg" }],
      rows: [{ id: "fit-row-1", mdM: 400, values: [9.5] }],
    },
    limitations: ["No continuous fracture-gradient profile is supplied."],
    evidence: [{ sourceId: "survey", page: 4 }],
  }],
  sections: [
    { id: "summary", title: "Summary", kind: "summary", fields: [{ label: "Total depth", value: 1250, unit: "m MD", sourceId: "survey" }] },
    { id: "trajectory", title: "Trajectory", kind: "trajectory", sourceId: "survey", frame: "RKB · local frame", points: [{ mdM: 0, tvdM: 0, eastingM: 0, northingM: 0 }, { mdM: 1250, tvdM: 1100, eastingM: 450, northingM: -75 }] },
    { id: "casing", title: "Casing strings", kind: "casing", sourceId: "survey", columns: [{ key: "name", label: "String", unit: null }, { key: "shoe", label: "Shoe", unit: "m MD" }], rows: [{ id: "surface", mdM: 400, values: ["Surface", 400] }] },
    { id: "cement", title: "Cement", kind: "cement", sourceId: null, columns: [{ key: "status", label: "Status", unit: null }], rows: [] },
    { id: "completion", title: "Completion", kind: "completion", sourceId: null, columns: [], rows: [] },
    { id: "operations", title: "Operations timeline", kind: "operations", events: [{ id: "spud", date: "2024-01-01", label: "Spud", mdM: 10, sourceId: "survey" }] },
    { id: "logs", title: "Mud logs", kind: "logs", sourceId: "survey", curves: [{ id: "gr", mnemonic: "GR", unit: "API", color: "#247c59", depthsMdM: [100, 110, 120], values: [35, null, 48] }] },
    { id: "tops", title: "Formation tops", kind: "formation-tops", sourceId: null, columns: [{ key: "top", label: "Top", unit: "m TVD" }], rows: [{ id: "top-a", mdM: null, values: [500] }] },
    { id: "offsets", title: "Offsets", kind: "offsets", sourceId: null, columns: [{ key: "well", label: "Well", unit: null }], rows: [] },
    { id: "coverage", title: "Data coverage", kind: "data-coverage", sourceId: "survey", columns: [{ key: "record", label: "Record", unit: null }], rows: [] },
    { id: "provenance", title: "Provenance", kind: "provenance", items: ["Supplied by host."] },
    { id: "assumptions", title: "Assumptions", kind: "assumptions", items: ["No interpolation."] },
    { id: "not-checked", title: "Not checked", kind: "not-checked", items: ["Engineering approval."] },
  ],
});

test("well report renders all section data, units, sources, unknowns and static-SVG figures", () => {
  const html = renderToStaticMarkup(createElement(WellReportView, { report }));
  assert.match(html, /data-testid="well-report"/);
  assert.match(html, /Example well/);
  assert.match(html, /not reported/);
  assert.match(html, /Total depth/);
  assert.match(html, /1,250 m MD/);
  assert.match(html, /Observed directional survey/);
  assert.match(html, /CC-BY-4.0/);
  assert.match(html, /data-report-section="casing"/);
  assert.match(html, /data-report-section="not-checked"/);
  assert.match(html, /data-testid="well-report-trajectory"/);
  assert.match(html, /data-testid="well-report-trajectory-2-5d"/);
  assert.match(html, /data-testid="well-report-logs"/);
  assert.match(html, /Easting \(m\)/);
  assert.match(html, /Northing \(m\)/);
  assert.match(html, /API/);
  assert.match(html, /arrow keys browse supplied stations/);
  assert.match(html, /well report log samples/);
  assert.match(html, /Print \/ save as PDF/);
  assert.match(html, /MD \(m\)/);
  assert.match(html, /data-testid="well-report-briefing"/);
  assert.match(html, /data-testid="well-report-studies"/);
  assert.match(html, /Formation integrity test/);
  assert.match(html, /Source result reported/);
  assert.match(html, /9\.5 ppg/);
  assert.match(html, /No continuous fracture-gradient profile is supplied/);
  assert.match(html, /Evidence for Formation integrity test/);
  assert.match(html, /data-report-highlight="survey-gap"/);
  assert.match(html, /Survey coverage exception/);
  assert.match(html, /32 ft/);
  assert.match(html, /Evidence for Survey coverage exception/);
  assert.match(html, /p\. 4/);
  assert.match(html, /Drilling performance by hole section/);
  assert.match(html, /Average ROP \(ft\/h\)/);
  assert.match(html, /47/);
  assert.match(html, /28\.3/);
  assert.match(html, /7 in string to 10,787 ft/);
});

test("well report marks synthetic documents and explicitly empty report sections", () => {
  const synthetic = validateWellReportSpec({
    ...report,
    id: "synthetic-report",
    provenance: "synthetic",
    sections: report.sections.map((section) => section.kind === "summary"
      ? { ...section, fields: [{ label: "UWI", value: null, unit: null, sourceId: null }] }
      : section.kind === "trajectory" ? { ...section, points: [] }
        : section.kind === "logs" ? { ...section, curves: [] }
          : section.kind === "casing" ? { ...section, rows: [] }
            : section),
  });
  const html = renderToStaticMarkup(createElement(WellReportView, { report: synthetic }));
  assert.match(html, /SYNTHETIC EXAMPLE · not engineering data/);
  assert.match(html, /No records supplied for this section/);
  assert.match(html, /No log curves supplied; not reported/);
  assert.match(html, /Trajectory not reported/);
});

test("well report includes the actual construction schematic and source details", () => {
  const sourcedReport = validateWellReportSpec({
    ...report,
    sections: report.sections.map((section) => section.kind === "trajectory"
      ? { ...section, points: forgeDesign.survey }
      : section),
  });
  const html = renderToStaticMarkup(createElement(WellReportView, {
    report: sourcedReport,
    schematicDesign: forgeDesign,
    schematicComponents: getWellComponents(forgeDesign),
  }));
  assert.match(html, /data-testid="well-report-schematic"/);
  assert.match(html, /data-testid="well-report-assembly-pair"/);
  assert.match(html, /data-testid="assembly-schematic"/);
  assert.match(html, /data-testid="well-report-assembly-3d"/);
  assert.match(html, /Loading 3D well schematic/);
  assert.match(html, /Spatial survey projection of 422 supplied trajectory stations/);
  assert.match(html, /Construction schematic/);
  assert.match(html, /aria-label="Construction cutaway"/);
  assert.match(html, /Surface casing \/ 13 3\/8 in/);
  assert.match(html, /data-testid="well-report-component-list"/);
  assert.match(html, /What is installed, drilled, and cemented/);
  assert.match(html, /Drilled hole sections/);
  assert.match(html, /Installed casing strings/);
  assert.match(html, /Cement placement records/);
  assert.match(html, /Wellhead equipment/);
  assert.equal((html.match(/data-report-component=/g) ?? []).length, getWellComponents(forgeDesign).length);
  assert.match(html, /data-report-component="production-casing"/);
  assert.match(html, /data-report-component="production-hole"/);
  assert.match(html, /Shoe depth \(ft MD\)/);
  assert.match(html, /actual stick-up\/top depths and casing IDs are not reported/);
  assert.match(html, /Source record/);
  assert.match(html, /Well schematic/);
  assert.ok(html.indexOf('data-testid="well-report-schematic"') < html.indexOf('data-report-section="summary"'));
  assert.match(html, /Report contents/);
  assert.match(html, /observed survey and reported drilled TD are different measurements/i);
});

test("well report renders all appendix rows behind expandable, print-ready registers", () => {
  const detailed = validateWellReportSpec({
    ...report,
    appendices: [{
      id: "daily-register",
      title: "Daily operations source register",
      sourceId: "survey",
      columns: [{ key: "date", label: "Date", unit: null }, { key: "detail", label: "Recorded activity", unit: null }],
      rows: [
        { id: "day-1", mdM: null, values: ["2024-01-01", "Rig move and safety meeting"] },
        { id: "day-2", mdM: 250, values: ["2024-01-02", "Drilling commenced"] },
      ],
    }],
  });
  const html = renderToStaticMarkup(createElement(WellReportView, { report: detailed }));
  assert.match(html, /Detailed source registers/);
  assert.match(html, /Daily operations source register \(2 records\)/);
  assert.match(html, /Rig move and safety meeting/);
  assert.match(html, /Drilling commenced/);
});
