"use client";

import { useEffect, useMemo, useState } from "react";
import {
  forgeDesign,
  forgeOperations,
  getWellComponents,
  lasCurve,
  parseLas,
  validateWellReportSpec,
} from "@ikhmalputra/subsurface-core";
import type { WellReportDrillingSection, WellReportHighlight, WellReportLogCurve, WellReportSpec, WellReportStudy, WellReportStudyTable, WellReportTableColumn, WellReportTableRow } from "@ikhmalputra/subsurface-core/contracts";
import { useDepthLink, useSubsurfaceSelector, WellReportView } from "@ikhmalputra/subsurface-react/2d";
import { useWorkspace } from "./workspace-provider";
import { useWell } from "./wells";
import type { WellDesign, WellOperations } from "@ikhmalputra/subsurface-core";

const FOOT_TO_METRE = 0.3048;
const reportNumberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const reportPercentFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const logDefinitions = [
  { mnemonic: "ROP", color: "#197c6e" },
  { mnemonic: "WOB", color: "#3c63a6" },
  { mnemonic: "RPM", color: "#8d5aa7" },
  { mnemonic: "TORQUE", color: "#a84b2f" },
  { mnemonic: "PP", color: "#8a5a00" },
  { mnemonic: "FLOWIN", color: "#236f83" },
  { mnemonic: "TEMPOUT", color: "#a13d72" },
] as const;

interface MudLogReportData {
  readonly curves: readonly WellReportLogCurve[];
  readonly mdStartM: number | null;
  readonly mdEndM: number | null;
}

function toReportLogs(lasText: string): MudLogReportData {
  const las = parseLas(lasText);
  const depthCurve = lasCurve(las, "DEPTH");
  if (!depthCurve) throw new Error("The mud log has no DEPTH curve; report log depths cannot be linked safely.");
  const sourceIndexes: number[] = [];
  const depthsMdM: number[] = [];
  depthCurve.values.forEach((depthFt, index) => {
    if (depthFt === null) return;
    const mdM = depthFt * FOOT_TO_METRE;
    const previous = depthsMdM.at(-1);
    if (previous !== undefined && mdM <= previous) throw new RangeError(`Mud-log MD is not strictly increasing at sample ${index}.`);
    sourceIndexes.push(index);
    depthsMdM.push(mdM);
  });
  const curves = logDefinitions.flatMap(({ mnemonic, color }) => {
    const curve = lasCurve(las, mnemonic);
    if (!curve) return [];
    return [{
      id: `mudlog-${mnemonic.toLowerCase()}`,
      mnemonic: curve.mnemonic,
      unit: curve.unit.trim() || null,
      color,
      depthsMdM,
      values: sourceIndexes.map((index) => curve.values[index] ?? null),
    }];
  });
  return { curves, mdStartM: depthsMdM[0] ?? null, mdEndM: depthsMdM.at(-1) ?? null };
}

const casingColumns: readonly WellReportTableColumn[] = [
  { key: "string", label: "Casing string", unit: null },
  { key: "size", label: "Nominal size", unit: null },
  { key: "shoe", label: "Shoe depth", unit: "ft MD" },
  { key: "material", label: "Grade / weight / connection", unit: null },
  { key: "record", label: "Source detail and limitation", unit: null },
  { key: "page", label: "Source page", unit: null },
];
const cementColumns: readonly WellReportTableColumn[] = [
  { key: "record", label: "Cement record", unit: null },
  { key: "material", label: "Material / density", unit: null },
  { key: "shoe", label: "Reference shoe", unit: "ft MD" },
  { key: "placement", label: "Reported placement / limitation", unit: null },
  { key: "page", label: "Source page", unit: null },
];
const completionColumns: readonly WellReportTableColumn[] = [
  { key: "equipment", label: "Reported surface equipment", unit: null },
  { key: "material", label: "Material", unit: null },
  { key: "record", label: "Source detail and limitation", unit: null },
  { key: "page", label: "Source page", unit: null },
];

function componentRows(kind: "Casing" | "Cement" | "Completion"): readonly WellReportTableRow[] {
  return getWellComponents(forgeDesign).filter((component) => {
    if (kind === "Casing") return component.kind === "Casing";
    if (kind === "Cement") return component.kind === "Cement";
    return component.kind !== "Casing" && component.kind !== "Cement" && component.kind !== "Hole";
  }).map((component) => ({
    id: component.id,
    mdM: component.topDepthReported === false ? null : component.topDepthM,
    values: kind === "Casing" ? [
      component.name.split("/")[0]?.trim() ?? component.name,
      component.name.split("/")[1]?.trim() ?? null,
      component.rawBottomDepthFt ?? null,
      component.material,
      component.description,
      component.sourcePage ?? null,
    ] : kind === "Cement" ? [
      component.name,
      component.material,
      component.rawBottomDepthFt ?? null,
      component.description,
      component.sourcePage ?? null,
    ] : [
      component.name,
      component.material,
      component.description,
      component.sourcePage ?? null,
    ],
  }));
}

function sourceRecord(id: string, source: { readonly title: string; readonly url: string; readonly sha256: string }, license: string) {
  return { id, title: source.title, url: source.url, sha256: source.sha256, license };
}

function reportHighlights(): WellReportHighlight[] {
  const surveyEndFt = forgeDesign.surveyCoverageFt;
  const reportedTdFt = forgeDesign.reportedTotalDepthFt;
  const unsurveyedFt = reportedTdFt === undefined || surveyEndFt === undefined ? null : reportedTdFt - surveyEndFt;
  const coreResults = forgeOperations.runs.flatMap((run) => {
    const match = run.summary.match(/Core \d+:\s*([\d.]+) ft cut,\s*([\d.]+) ft recovered/);
    if (!match) return [];
    return [{ cutFt: Number(match[1]), recoveredFt: Number(match[2]), page: run.page }];
  });
  const cutFt = coreResults.reduce((total, core) => total + core.cutFt, 0);
  const recoveredFt = coreResults.reduce((total, core) => total + core.recoveredFt, 0);
  const recoveryPct = cutFt === 0 ? null : (recoveredFt / cutFt) * 100;
  const floatRuns = ["BHA 01", "BHA 02", "BHA 07"].map((id) => forgeOperations.runs.find((run) => run.id === id));
  if (reportedTdFt === undefined || surveyEndFt === undefined || unsurveyedFt === null || coreResults.length === 0 || recoveryPct === null || floatRuns.some((run) => !run)) {
    throw new Error("The FORGE report cannot build source-backed highlights because required source records are missing.");
  }
  return [
    {
      id: "survey-coverage-gap",
      title: "Trajectory coverage does not reach reported TD",
      value: `${reportNumberFormat.format(unsurveyedFt)} ft / ${reportPercentFormat.format(unsurveyedFt * FOOT_TO_METRE)} m`,
      detail: `The daily report gives drilled TD as ${reportNumberFormat.format(reportedTdFt)} ft MD; the observed survey ends at ${reportNumberFormat.format(surveyEndFt)} ft MD across ${forgeDesign.survey?.length ?? 0} stations. The final ${reportNumberFormat.format(unsurveyedFt)} ft have no observed trajectory and are not extrapolated.`,
      tone: "attention",
      evidence: [
        { sourceId: "daily", page: 17 },
        { sourceId: "survey", page: null },
      ],
    },
    {
      id: "core-recovery",
      title: "Reported core recovery",
      value: `${reportNumberFormat.format(recoveredFt)} of ${reportNumberFormat.format(cutFt)} ft · ${reportPercentFormat.format(recoveryPct)}%`,
      detail: `Arithmetic total across ${coreResults.length} reported core cuts: recovered footage ÷ cut footage (${reportNumberFormat.format(recoveredFt)} ÷ ${reportNumberFormat.format(cutFt)}). This combined ratio does not describe any individual interval.`,
      tone: "note",
      evidence: coreResults.map((core) => ({ sourceId: "daily", page: core.page })),
    },
    {
      id: "casing-events",
      title: "Casing installation history includes float / plug issues",
      value: "Surface float failure · intermediate plug not bumped",
      detail: `The 13 3/8 in surface casing was cemented with floats reported failed (BHA 01, p. ${floatRuns[0]!.page}). A later PDC/RSS assembly could not drill the float equipment (BHA 02, p. ${floatRuns[1]!.page}). The 9 5/8 in casing was run, then picked up to 5,110 ft before cementing; the source notes the plug was not bumped (gyro run, p. ${floatRuns[2]!.page}). This historical record does not establish present barrier integrity.`,
      tone: "attention",
      evidence: [
        { sourceId: "summary", page: floatRuns[0]!.page },
        { sourceId: "summary", page: floatRuns[1]!.page },
        { sourceId: "summary", page: floatRuns[2]!.page },
      ],
    },
  ];
}

function reportDrillingSections(): WellReportDrillingSection[] {
  return forgeOperations.sections.map((section) => ({
    id: section.id,
    name: section.name,
    bitSizeIn: section.bitSizeIn,
    topFt: section.topFt,
    baseFt: section.baseFt,
    drilledFt: section.drilledFt,
    runCount: section.runCount,
    problemRuns: section.problemRuns,
    avgRopFtPerHour: section.avgRopFph,
    casing: section.casing,
    sourceId: "summary",
  }));
}

function reportStudies(): WellReportStudy[] {
  const day = (date: string) => {
    const record = forgeOperations.days.find((entry) => entry.date === date);
    if (!record) throw new Error(`The FORGE study register is missing daily report ${date}.`);
    return record;
  };
  const dayOn = (date: string, expression: RegExp) => {
    const record = day(date);
    if (!expression.test([record.headline, ...record.activities, record.planned].join(" "))) {
      throw new Error(`The FORGE study register no longer matches the source record for ${date}.`);
    }
    return record;
  };
  const datum = (label: string, value: string | number | null, unit: string | null = null) => ({
    label, value, unit, sourceId: "daily",
  });
  const table = (caption: string, columns: WellReportTableColumn[], rows: WellReportTableRow[]): WellReportStudyTable => ({
    caption, columns, rows,
  });
  const bopTest = dayOn("2020-11-04", /Test blinds to 250 psi low, 5,000 psi high[\s\S]*All tests were good/i);
  const laterBopTest = dayOn("2020-11-15", /Test BOPE 250 psi low 5000 psi high, test casing 1500 psi/i);
  const surfaceFit = dayOn("2020-11-05", /Perform FIT at 1,644' MD to emw of 9\.5 ppg/i);
  const productionFit = dayOn("2020-11-15", /Drill 12' of new formation and perform FIT to 9\.6 ppg EMW/i);
  const xlotStart = dayOn("2020-12-11", /Started the XLOT establish circulation to annulus, stop test/i);
  const temperatureSurvey = dayOn("2020-11-19", /12 hour temperature build up test at 5,501' bit depth, 5,499' tool depth/i);
  const evaluationLogRun = dayOn("2020-12-27", /Density Neutron, Induction Resistivity, Sonic, FMI/i);
  const xlotRuns = forgeOperations.runs.filter((run) => /XLOT/i.test(run.sourceHeading));
  if (xlotRuns.length !== 3) throw new Error(`Expected three documented XLOT attempts; found ${xlotRuns.length}.`);

  return [
    {
      id: "bop-casing-integrity-test",
      title: "BOP, choke-system, mud-line and casing pressure tests",
      category: "well-control",
      status: "reported",
      date: bopTest.date,
      depthMdM: null,
      summary: "The 4 November daily report says all listed tests were good. A later 15 November entry lists retest pressures but does not record a pass/fail outcome.",
      method: "Field pressure tests as transcribed in the daily drilling reports; no independent certification or chart is attached.",
      inputs: [],
      results: [
        datum("Blind preventers and pipe rams", "250 low / 5,000 high", "psi"),
        datum("Choke manifold, choke lines and valves", "250 low / 5,000 high", "psi"),
        datum("Mud lines to pumps", "80% of 3,600 psi liner rating", null),
        datum("Casing", 1500, "psi"),
        datum("4 November reported outcome", "All tests were good", null),
        datum("15 November retest outcome", "Not stated in the cited entry", null),
      ],
      limitations: ["The stated test result is historical and does not verify current wellhead, casing, or barrier integrity."],
      evidence: [{ sourceId: "daily", page: bopTest.page }, { sourceId: "daily", page: laterBopTest.page }],
    },
    {
      id: "formation-integrity-tests",
      title: "Formation integrity tests (FIT)",
      category: "pressure",
      status: "reported",
      date: null,
      depthMdM: null,
      summary: "Two FIT equivalent-mud-weight results are reported at casing transitions. These are source test outcomes, not a continuous pore-pressure or fracture-gradient profile.",
      method: "Field FIT results transcribed as equivalent mud weight. The second test location is derived from the reported 5,113 ft MD shoe plus 12 ft drilled into new formation.",
      inputs: [],
      results: [],
      table: table("Reported FIT results", [
        { key: "date", label: "Date", unit: null },
        { key: "location", label: "Test location", unit: "ft MD" },
        { key: "emw", label: "Reported test EMW", unit: "ppg" },
        { key: "basis", label: "Depth / outcome basis", unit: null },
      ], [
        { id: "surface-fit", mdM: 1644 * FOOT_TO_METRE, values: [surfaceFit.date, 1644, 9.5, "Exact location and target EMW stated in daily report."] },
        { id: "production-fit", mdM: (5113 + 12) * FOOT_TO_METRE, values: [productionFit.date, "≈5,125 (derived)", 9.6, "Daily report records 12 ft of new formation before FIT; shoe reference is 5,113 ft MD."] },
      ]),
      limitations: [
        "Raw pressure/volume charts, leak-off points, and explicit test acceptance statements are not included.",
        "Do not interpret these two test values as a calibrated fracture-gradient curve or extrapolate between them.",
      ],
      evidence: [{ sourceId: "daily", page: surfaceFit.page }, { sourceId: "daily", page: laterBopTest.page }, { sourceId: "daily", page: productionFit.page }],
    },
    {
      id: "extended-lot-xlot",
      title: "Extended leak-off / XLOT attempts",
      category: "pressure",
      status: "incomplete",
      date: xlotStart.date,
      depthMdM: null,
      summary: "The extended test reached a reported maximum allowable surface pressure without a numeric limit or interpretable formation-pressure result. Three subsequent XLOT attempts record packer failures; the final attempt was started and stopped.",
      method: "Test-packer operations and XLOT attempt summaries transcribed from daily and service-run records.",
      inputs: [datum("Pump-line pressure test", 5000, "psi"), datum("Surface-pressure ceiling", null, "psi · numeric limit not reported")],
      results: [
        datum("Ball-seat pressure hold", "957 for 5 minutes", "psi"),
        datum("Packer setting pressure", "2,100 (pinned at 1,897)", "psi"),
        datum("Landing-collar opening pressure", "2,700 (pinned at 2,705)", "psi"),
        datum("Interpretable XLOT / fracture result", null, null),
      ],
      table: table("XLOT attempt register", [
        { key: "run", label: "Run / test", unit: null },
        { key: "depth", label: "Packer depth", unit: "ft MD" },
        { key: "outcome", label: "Recorded outcome", unit: null },
        { key: "page", label: "Service-run source page", unit: null },
      ], xlotRuns.map((run) => ({
        id: run.id.toLowerCase().replaceAll(" ", "-"),
        mdM: run.baseFt === null ? null : run.baseFt * FOOT_TO_METRE,
        values: [run.sourceHeading, run.baseFt, run.summary, run.page],
      }))),
      limitations: [
        "Tool-setting and line-test pressures are not formation breakdown or closure pressures.",
        "The source pack does not include a completed pressure-volume schedule, interpreted leak-off point, closure pressure, or stress result.",
      ],
      evidence: [
        { sourceId: "daily", page: day("2020-12-04").page },
        { sourceId: "daily", page: xlotStart.page },
        ...xlotRuns.map((run) => ({ sourceId: "summary", page: run.page })),
      ],
    },
    {
      id: "intermediate-hole-step-test",
      title: "Drilling WOB step test · intermediate hole",
      category: "drilling-performance",
      status: "incomplete",
      date: surfaceFit.date,
      depthMdM: null,
      summary: "A five-minute WOB step test reported rate of penetration and differential pressure through 12 klbf. The 15 klbf step was stopped after bit balling; its ROP and differential pressure are not reported.",
      method: "Source-reported five-minute weight-on-bit steps; no model fit or extrapolation is applied.",
      inputs: [datum("Reported flow rate", 660, "gpm"), datum("Reported rotary speed", 46, "rpm")],
      results: [],
      table: table("Intermediate-hole WOB step results", [
        { key: "wob", label: "WOB", unit: "klbf" },
        { key: "rop", label: "ROP", unit: "ft/h" },
        { key: "diff", label: "Differential pressure", unit: "psi" },
        { key: "duration", label: "Step duration", unit: "min" },
        { key: "note", label: "Source note", unit: null },
      ], [
        { id: "wob-3", mdM: null, values: [3, 66, 40, 5, null] },
        { id: "wob-6", mdM: null, values: [6, 69.6, 80, 5, null] },
        { id: "wob-9", mdM: null, values: [9, 103.2, 130, 5, null] },
        { id: "wob-12", mdM: null, values: [12, 157.8, 205, 5, null] },
        { id: "wob-15", mdM: null, values: [15, null, null, 5, "Bit balled; test stopped."] },
      ]),
      limitations: ["Do not treat this short field step test as a calibrated drilling simulator or predict ROP outside the recorded points."],
      evidence: [{ sourceId: "daily", page: surfaceFit.page }],
    },
    {
      id: "production-hole-step-test",
      title: "Drilling WOB step test · production hole",
      category: "drilling-performance",
      status: "reported",
      date: productionFit.date,
      depthMdM: 5200 * FOOT_TO_METRE,
      summary: "The daily record reports three five-minute WOB steps with corresponding ROP. Differential pressure, flow and rotary speed by step are not provided.",
      method: "Source-reported field step test; no fitted response curve or interpolated values are added.",
      inputs: [],
      results: [],
      table: table("Production-hole WOB step results", [
        { key: "wob", label: "WOB", unit: "klbf" },
        { key: "rop", label: "ROP", unit: "ft/h" },
        { key: "duration", label: "Step duration", unit: "min" },
      ], [
        { id: "wob-35", mdM: null, values: [35, 54.5, 5] },
        { id: "wob-40", mdM: null, values: [40, 55.2, 5] },
        { id: "wob-45", mdM: null, values: [45, 69.6, 5] },
      ]),
      limitations: ["These are recorded operating points, not simulated or normalized drilling performance."],
      evidence: [{ sourceId: "daily", page: productionFit.page }],
    },
    {
      id: "temperature-and-image-logging",
      title: "Temperature buildup and borehole image logging",
      category: "temperature",
      status: "incomplete",
      date: temperatureSurvey.date,
      depthMdM: 5499 * FOOT_TO_METRE,
      summary: "The source records a 12-hour shut-in temperature survey and later logs MWD/tool temperatures. UBI and through-bit formation-evaluation logging runs are documented, but the temperature trace, image, and processed formation curves are not in the supplied digital pack.",
      method: "Acquisition details and spot readings transcribed from daily reports; measurements from different tools, depths, and operating conditions are kept distinct.",
      inputs: [datum("Temperature build-up duration", 12, "h"), datum("Temperature tool depth", 5499, "ft MD")],
      results: [
        datum("MWD temperature", 185, "°F · reported 2020-11-25"),
        datum("UBI tool bottom-hole temperature", 322, "°F · reported 2020-12-27"),
        datum("UBI operating / maximum tool temperatures", "330 / 350", "°F"),
        datum("Through-bit logging suite", "Density-neutron, induction resistivity, sonic, FMI", null),
        datum("Processed formation-evaluation log outputs attached", 0, "files"),
      ],
      limitations: [
        "Spot temperatures are not a static geothermal gradient; the reported values have different dates and tool/flow conditions.",
        "Acquisition is not equivalent to receiving or interpreting the UBI/FMI images and formation-evaluation curves.",
      ],
      evidence: [
        { sourceId: "daily", page: temperatureSurvey.page },
        { sourceId: "daily", page: day("2020-11-25").page },
        { sourceId: "daily", page: evaluationLogRun.page },
      ],
    },
    {
      id: "formation-pressure-window",
      title: "Continuous pore-pressure / fracture-gradient window",
      category: "pressure",
      status: "not-computable",
      date: null,
      depthMdM: null,
      summary: "The two FIT values and incomplete XLOT attempts do not define a continuous pressure window. No interpreted pore-pressure profile, fracture-gradient profile, or final mud-window study is supplied.",
      method: "No pressure-window model is run because the report inputs do not include calibrated pressure picks or an interpreted profile.",
      inputs: [],
      results: [],
      limitations: ["Requires interpreted pressure data with depth and datum, test charts/outcomes, and documented uncertainty; do not interpolate FIT values into a gradient curve."],
      evidence: [{ sourceId: "daily", page: surfaceFit.page }, { sourceId: "daily", page: xlotStart.page }],
    },
    {
      id: "hydraulics-ecd-simulation",
      title: "Hydraulics / ECD simulation",
      category: "hydraulics-simulation",
      status: "not-computable",
      date: null,
      depthMdM: null,
      summary: "No hydraulics simulation output is supplied. Daily reports contain selected flow, standpipe-pressure and differential-pressure observations, but not a complete rheology, temperature, and geometry model.",
      method: null,
      inputs: [],
      results: [],
      limitations: ["No ECD, annular pressure-loss, surge/swab, or pump operating-envelope result is calculated from incomplete input data."],
      evidence: [{ sourceId: "daily", page: productionFit.page }],
    },
    {
      id: "casing-design-simulation",
      title: "Casing load / strength simulation",
      category: "casing-design",
      status: "not-computable",
      date: null,
      depthMdM: null,
      summary: "The as-drilled source pack records casing sizes and shoe depths but does not supply a complete grade, weight, wall, connection, and design-load basis for a reproducible casing-strength analysis.",
      method: null,
      inputs: [],
      results: [],
      limitations: ["No burst, collapse, tension, triaxial, safety-factor, or kick-tolerance result is asserted. The schematic is not a design verification."],
      evidence: [{ sourceId: "summary", page: 7 }],
    },
    {
      id: "petrophysics-study",
      title: "Petrophysics and reservoir characterization",
      category: "petrophysics",
      status: "not-computable",
      date: null,
      depthMdM: null,
      summary: "The supplied LAS is a drilling-parameter mud log (ROP, WOB, RPM, torque, pump pressure, flow-in and temperature-out). Density/neutron/resistivity/sonic formation curves and core laboratory analyses are not supplied as digital results.",
      method: null,
      inputs: [],
      results: [],
      limitations: ["No porosity, water saturation, permeability, net pay, lithology classification, or reservoir quality is calculated from drilling curves."],
      evidence: [{ sourceId: "mudlog", page: null }, { sourceId: "daily", page: evaluationLogRun.page }],
    },
    {
      id: "geomechanics-study",
      title: "Geomechanics and stress model",
      category: "geomechanics",
      status: "not-computable",
      date: null,
      depthMdM: null,
      summary: "No calibrated in-situ stress, rock-strength, elastic-property, or interpreted fracture data set is present for a geomechanical model.",
      method: null,
      inputs: [],
      results: [],
      limitations: ["No stress orientation/magnitude, wellbore-stability window, fracture-mechanics, or induced-seismicity result is inferred."],
      evidence: [{ sourceId: "summary", page: 7 }],
    },
    {
      id: "reservoir-simulation",
      title: "Reservoir / production simulation",
      category: "reservoir-simulation",
      status: "not-reported",
      date: null,
      depthMdM: null,
      summary: "No reservoir model, numerical simulation, forecast, or production history is included in the supplied drilling record.",
      method: null,
      inputs: [],
      results: [],
      limitations: ["The as-drilled well record cannot support a forecast without a model, fluid/reservoir properties, boundary conditions, and production or injection data."],
      evidence: [{ sourceId: "summary", page: 67 }],
    },
    {
      id: "well-test-results",
      title: "Well test, flowback and production results",
      category: "well-test",
      status: "not-reported",
      date: null,
      depthMdM: null,
      summary: "No post-drill flow test, injectivity test, pressure-transient interpretation, or production/injection result is present in the supplied records.",
      method: null,
      inputs: [],
      results: [],
      limitations: ["Drilling circulation and FIT/XLOT operations are not substitutes for a reservoir deliverability or well test."],
      evidence: [{ sourceId: "summary", page: 67 }],
    },
    {
      id: "stimulation-and-dfit",
      title: "Stimulation / DFIT results",
      category: "stimulation",
      status: "not-reported",
      date: null,
      depthMdM: null,
      summary: "The service-run register records a tapered mill run before DFIT, but no completed DFIT or stimulation schedule/result is supplied.",
      method: null,
      inputs: [],
      results: [],
      limitations: ["No injection volume, rate schedule, ISIP, closure pressure, treatment pressure, or stimulated-reservoir result is asserted."],
      evidence: [{ sourceId: "summary", page: 68 }],
    },
  ];
}

function makeReport(logData: MudLogReportData): WellReportSpec {
  const sources = [
    {
      id: "survey",
      title: forgeDesign.trajectoryName ?? "Observed well survey",
      url: forgeDesign.trajectorySource ?? null,
      license: forgeOperations.license,
      sha256: null,
    },
    sourceRecord("summary", forgeOperations.sources.summary!, forgeOperations.license),
    sourceRecord("daily", forgeOperations.sources.daily!, forgeOperations.license),
    sourceRecord("mudlog", forgeOperations.sources.mudlog!, forgeOperations.license),
  ];
  const logs = logData.curves;
  const design = forgeDesign;
  const components = getWellComponents(design);
  const survey = design.survey ?? [];
  const provenance = [
    forgeOperations.attribution,
    `License: ${forgeOperations.license}.`,
    ...forgeOperations.notes,
  ];
  return validateWellReportSpec({
    version: 1,
    id: `well-review-${design.id}`,
    title: "Utah FORGE 16A(78)-32 — As-drilled record",
    provenance: "documented",
    identity: {
      wellId: design.id,
      name: design.wellName ?? "Utah FORGE 16A(78)-32",
      operator: null,
      field: null,
      uwi: null,
    },
    datum: {
      name: design.depthDatum ?? "not reported",
      referenceElevationMslM: design.referenceElevationMslM ?? null,
    },
    sources,
    executiveSummary: {
      text: "The drilling record reports spud on 30 October 2020, drilled total depth of 10,987 ft MD on 24 December 2020, and rig release on 12 January 2021. The supplied survey has 422 observed stations and ends at 10,955 ft MD, leaving the final 32 ft without measured trajectory. The records include three casing strings, cement placement, six core cuts, drilling-parameter step tests, two FIT results (9.5 and 9.6 ppg EMW), BOP/casing pressure tests and incomplete XLOT attempts. Temperature and formation-evaluation logging runs are recorded, but the measured survey curves are absent. The supplied source pack does not document a production tubing string, completed fracture-pressure interpretation, engineering simulation, post-drill flow/production result, UWI, or offset-well records.",
      evidence: [
        { sourceId: "summary", page: 7 },
        { sourceId: "daily", page: 17 },
        { sourceId: "survey", page: null },
        { sourceId: "summary", page: 67 },
      ],
    },
    highlights: reportHighlights(),
    drillingSections: reportDrillingSections(),
    studies: reportStudies(),
    sections: [
      {
        id: "summary",
        title: "Well overview",
        kind: "summary",
        fields: [
          { label: "Spud date", value: "2020-10-30", unit: null, sourceId: "summary" },
          { label: "Reported drilled TD", value: design.reportedTotalDepthFt ?? null, unit: "ft MD", sourceId: "daily" },
          { label: "Last observed survey MD", value: design.surveyCoverageFt ?? null, unit: "ft MD", sourceId: "survey" },
          { label: "Observed survey stations", value: survey.length, unit: "stations", sourceId: "survey" },
          { label: "Casing shoe depths", value: "13 3/8 in: 1,629 · 9 5/8 in: 5,110 · 7 in: 10,787", unit: "ft MD", sourceId: "summary" },
          { label: "Rig release", value: "2021-01-12", unit: null, sourceId: "summary" },
        ],
      },
      {
        id: "trajectory",
        title: "Trajectory",
        kind: "trajectory",
        sourceId: "survey",
        frame: `${design.depthDatum ?? "datum not reported"} · local North/East in metres`,
        points: survey.map(({ mdM, tvdM, eastingM, northingM, inclinationDeg, azimuthDeg, sourceRow, rawMdFt, rawTvdFt }) => ({
          mdM, tvdM, eastingM, northingM, inclinationDeg, azimuthDeg, sourceRow, rawMdFt, rawTvdFt,
        })),
      },
      { id: "casing", title: "Casing strings", kind: "casing", sourceId: "summary", columns: casingColumns, rows: componentRows("Casing") },
      { id: "cement", title: "Cementing records", kind: "cement", sourceId: "summary", columns: cementColumns, rows: componentRows("Cement") },
      { id: "completion", title: "Wellhead equipment and completion data", kind: "completion", sourceId: "summary", columns: completionColumns, rows: componentRows("Completion") },
      {
        id: "operations",
        title: "Operations timeline",
        kind: "operations",
        events: [...forgeOperations.milestones].sort((left, right) => left.date.localeCompare(right.date)).map((event) => ({
          id: event.id,
          date: event.date,
          label: event.label,
          mdM: event.mdFt === null ? null : event.mdFt * FOOT_TO_METRE,
          sourceId: event.source in forgeOperations.sources ? event.source : null,
          sourcePage: event.page,
        })),
      },
      { id: "logs", title: "Mud log", kind: "logs", sourceId: "mudlog", curves: logs },
      {
        id: "formation-tops",
        title: "Formation tops and intervals",
        kind: "formation-tops",
        sourceId: "summary",
        columns: [
          { key: "name", label: "Formation", unit: null },
          { key: "lithology", label: "Lithology", unit: null },
          { key: "top", label: "Top", unit: "m TVD" },
          { key: "base", label: "Base", unit: "m TVD" },
          { key: "density", label: "Density", unit: "kg/m³" },
          { key: "porosity", label: "Porosity", unit: "%" },
          { key: "interpretation", label: "Source interpretation / limitation", unit: null },
          { key: "source", label: "Source URL", unit: null },
        ],
        rows: (design.formations ?? []).map((formation) => ({
          id: formation.id,
          mdM: null,
          values: [
            formation.name, formation.lithology, formation.topTvdM, formation.bottomTvdM,
            formation.densityKgM3, formation.porosityPct, formation.interpretation ?? null, formation.sourceUrl ?? null,
          ],
        })),
      },
      {
        id: "offsets",
        title: "Offset-well data",
        kind: "offsets",
        sourceId: null,
        columns: [{ key: "well", label: "Offset well", unit: null }, { key: "distance", label: "Distance", unit: "m" }, { key: "source", label: "Source", unit: null }],
        rows: [],
      },
      {
        id: "coverage",
        title: "Records supplied and gaps",
        kind: "data-coverage",
        sourceId: "summary",
        columns: [{ key: "record", label: "Record type", unit: null }, { key: "extent", label: "Extent / limitation", unit: null }, { key: "count", label: "Records", unit: null }],
        rows: [
          { id: "trajectory", mdM: null, values: ["Observed directional survey", survey.length ? `${survey[0]!.rawMdFt}–${survey.at(-1)!.rawMdFt} ft MD` : null, survey.length] },
          { id: "components", mdM: null, values: ["Construction records", "3 drilled hole sections · 3 casing strings · 2 cement records · 2 wellhead items", components.length] },
          { id: "operations", mdM: null, values: ["Operations milestones", `${forgeOperations.milestones.length} events`, forgeOperations.milestones.length] },
          { id: "daily", mdM: null, values: ["Daily operations reports", forgeOperations.days.length ? `${forgeOperations.days[0]!.date} to ${forgeOperations.days.at(-1)!.date}` : null, forgeOperations.days.length] },
          { id: "mudlog", mdM: null, values: ["Mud log", logData.mdStartM === null || logData.mdEndM === null ? null : `${(logData.mdStartM / FOOT_TO_METRE).toFixed(0)}–${(logData.mdEndM / FOOT_TO_METRE).toFixed(0)} ft MD`, logs.length] },
          { id: "pressure-tests", mdM: null, values: ["FIT, BOP/casing pressure tests and XLOT attempts", "2 FIT tests · 2 BOP/casing tests · 3 XLOT attempts", 7] },
          { id: "drilling-step-tests", mdM: null, values: ["WOB / ROP step tests", "Two source-reported field tests; first stopped at 15 klbf after bit balling", 2] },
          { id: "temperature-and-image-logs", mdM: null, values: ["Temperature buildup, UBI and through-bit log acquisitions", "Acquisition events reported; raw temperature / image / formation evaluation curves not in this pack", null] },
          { id: "engineering-simulations", mdM: null, values: ["Hydraulics, casing design, geomechanics and reservoir simulation", "No simulation result supplied; required inputs are incomplete or absent", null] },
          { id: "well-identifiers", mdM: null, values: ["Operator / UWI", "Not present in the supplied source records", null] },
          { id: "offsets", mdM: null, values: ["Offset wells", "No offset-well records supplied", 0] },
          { id: "production-results", mdM: null, values: ["Post-drill production / flow results", "Not present in the supplied source records", null] },
        ],
      },
      { id: "provenance", title: "Provenance", kind: "provenance", items: provenance },
      {
        id: "assumptions",
        title: "Data handling notes",
        kind: "assumptions",
        items: [
          "The source LAS depth curve is reported in feet and is converted to metres using 0.3048 m/ft for the report MD axis and shared depth link.",
          "LAS null sentinels are decoded by the existing parser and remain unknown; curves are not interpolated.",
          "Formation interval depths are reported as TVD and are not converted to MD.",
          "The report presents supplied records; no unprovided offset, completion, or engineering values are inferred.",
        ],
      },
      {
        id: "not-checked",
        title: "Not assessed by this report",
        kind: "not-checked",
        items: [
          "Engineering certification, barrier verification, cement quality, casing design ratings, and operational approval.",
          "Formation-top correlation, geological interpretation, and offset-well equivalence.",
          "Current well status, production performance, and any data not included in the referenced records.",
        ],
      },
    ],
    appendices: [
      {
        id: "survey-source-stations",
        title: "Observed survey station register",
        sourceId: "survey",
        columns: [
          { key: "md", label: "MD", unit: "m" }, { key: "tvd", label: "TVD", unit: "m" },
          { key: "easting", label: "Local Easting", unit: "m" }, { key: "northing", label: "Local Northing", unit: "m" },
          { key: "inc", label: "Inclination", unit: "deg" }, { key: "azi", label: "Azimuth", unit: "deg" },
          { key: "sourceRow", label: "Source row", unit: null }, { key: "rawMdFt", label: "Raw MD", unit: "ft" },
          { key: "rawTvdFt", label: "Raw TVD", unit: "ft" },
        ],
        rows: survey.map((station, index) => ({
          id: `survey-${station.sourceRow ?? index + 1}`,
          mdM: station.mdM,
          values: [
            station.mdM, station.tvdM, station.eastingM, station.northingM, station.inclinationDeg,
            station.azimuthDeg, station.sourceRow, station.rawMdFt, station.rawTvdFt,
          ],
        })),
      },
      {
        id: "hole-section-register",
        title: "Hole section and drilling interval register",
        sourceId: "summary",
        columns: [
          { key: "name", label: "Section", unit: null }, { key: "bit", label: "Bit size", unit: "in" },
          { key: "topFt", label: "Top", unit: "ft MD" }, { key: "baseFt", label: "Base", unit: "ft MD" },
          { key: "topM", label: "Top", unit: "m MD" }, { key: "baseM", label: "Base", unit: "m MD" },
          { key: "casing", label: "Casing", unit: null }, { key: "runs", label: "Runs", unit: null },
          { key: "problems", label: "Problem runs", unit: null }, { key: "footage", label: "Drilled", unit: "ft" },
          { key: "rop", label: "Avg ROP", unit: "ft/h" }, { key: "first", label: "First date", unit: null },
          { key: "last", label: "Last date", unit: null }, { key: "holeId", label: "Hole record ID", unit: null },
          { key: "casingId", label: "Casing record ID", unit: null },
        ],
        rows: forgeOperations.sections.map((section) => ({
          id: section.id, mdM: section.topM,
          values: [
            section.name, section.bitSizeIn, section.topFt, section.baseFt, section.topM, section.baseM,
            section.casing, section.runCount, section.problemRuns, section.drilledFt, section.avgRopFph,
            section.firstDate, section.lastDate, section.holeComponentId, section.casingComponentId,
          ],
        })),
      },
      {
        id: "service-run-register",
        title: "Service and bottom-hole assembly run register",
        sourceId: "daily",
        columns: [
          { key: "run", label: "Run", unit: null }, { key: "kind", label: "Kind", unit: null },
          { key: "section", label: "Hole section", unit: null }, { key: "heading", label: "Source heading", unit: null },
          { key: "topFt", label: "Top", unit: "ft MD" }, { key: "baseFt", label: "Base", unit: "ft MD" },
          { key: "topM", label: "Top", unit: "m MD" }, { key: "baseM", label: "Base", unit: "m MD" },
          { key: "footage", label: "Footage", unit: "ft" }, { key: "rop", label: "Avg ROP", unit: "ft/h" },
          { key: "outcome", label: "Outcome", unit: null }, { key: "summary", label: "Reported summary", unit: null },
          { key: "page", label: "Source page", unit: null },
        ],
        rows: forgeOperations.runs.map((run) => ({
          id: run.id, mdM: run.topM,
          values: [
            run.id, run.kind, run.holeSection, run.sourceHeading, run.topFt, run.baseFt, run.topM,
            run.baseM, run.footageFt, run.avgRopFph, run.outcome, run.summary, run.page,
          ],
        })),
      },
      {
        id: "daily-operations-register",
        title: "Daily operations report register",
        sourceId: "daily",
        columns: [
          { key: "date", label: "Date", unit: null }, { key: "day", label: "Day from spud", unit: "day" },
          { key: "category", label: "Category", unit: null }, { key: "mdFt", label: "MD", unit: "ft" },
          { key: "mdM", label: "MD", unit: "m" }, { key: "tvdFt", label: "TVD", unit: "ft" },
          { key: "footage", label: "Footage", unit: "ft" }, { key: "mudWeight", label: "Mud weight", unit: "ppg" },
          { key: "headline", label: "Headline", unit: null }, { key: "activities", label: "Recorded activities", unit: null },
          { key: "planned", label: "Planned activity", unit: null }, { key: "page", label: "Source page", unit: null },
        ],
        rows: forgeOperations.days.map((day, index) => ({
          id: `daily-${day.date}-${index}`, mdM: day.mdM,
          values: [
            day.date, day.dayFromSpud, day.category, day.mdFt, day.mdM, day.tvdFt, day.footageFt,
            day.mudWeightPpg, day.headline, day.activities.join("\n"), day.planned, day.page,
          ],
        })),
      },
    ],
  });
}

function revisionReport(design: WellDesign, operations: WellOperations | null, logs: MudLogReportData): WellReportSpec {
  const components = getWellComponents(design);
  return validateWellReportSpec({
    version: 1, id: `${design.id}-r${design.revision}`, title: `${design.wellName ?? design.id} — ${design.provenance === "user-authored" ? "User-authored revision" : "Well record"}`,
    provenance: design.provenance,
    identity: { wellId: design.id, name: design.wellName ?? design.id, operator: null, field: null, uwi: null },
    datum: { name: design.depthDatum ?? "Not supplied", referenceElevationMslM: design.referenceElevationMslM ?? null },
    sources: operations ? Object.entries(operations.sources).map(([id, source]) => sourceRecord(id, source, operations.license)) : [],
    sections: [
      { id: "summary", title: "Active well revision", kind: "summary", fields: [
        { label: "Revision", value: design.revision, unit: null, sourceId: null },
        { label: "Total depth", value: design.totalDepthM, unit: "m MD", sourceId: null },
        { label: "Casing bottom", value: design.casingBottomM, unit: "m MD", sourceId: null },
        { label: "Trajectory status", value: design.surveyStatus ?? "Not supplied", unit: null, sourceId: null },
      ] },
      { id: "trajectory", title: "Active trajectory", kind: "trajectory", sourceId: null, frame: `Local N/E; TVD below ${design.depthDatum ?? "well reference"}`, points: design.survey ?? [] },
      ...(["casing", "cement", "completion"] as const).map((kind) => ({
        id: kind, title: kind === "casing" ? "Casing" : kind === "cement" ? "Cement" : "Other construction records", kind, sourceId: null,
        columns: [{ key: "name", label: "Record", unit: null }, { key: "top", label: "Top", unit: "m MD" }, { key: "base", label: "Base", unit: "m MD" }, { key: "od", label: "OD", unit: "mm" }, { key: "id", label: "ID", unit: "mm" }, { key: "material", label: "Material", unit: null }, { key: "note", label: "Description", unit: null }],
        rows: components.filter((component) => kind === "casing" ? component.kind === "Casing" : kind === "cement" ? component.kind === "Cement" : component.kind !== "Casing" && component.kind !== "Cement").map((component) => ({ id: component.id, mdM: component.topDepthM, values: [component.name, component.topDepthReported === false ? null : component.topDepthM, component.bottomDepthM, component.outerDiameterMm, component.innerDiameterMm, component.material, component.description] })),
      })),
      { id: "formations", title: "Formation intervals", kind: "formation-tops", sourceId: null,
        columns: [{ key: "name", label: "Formation", unit: null }, { key: "lithology", label: "Lithology", unit: null }, { key: "top", label: "Top", unit: "m TVD" }, { key: "base", label: "Base", unit: "m TVD" }, { key: "density", label: "Density", unit: "kg/m3" }, { key: "porosity", label: "Porosity", unit: "%" }],
        rows: (design.formations ?? []).map((layer) => ({ id: layer.id, mdM: null, values: [layer.name, layer.lithology, layer.topTvdM, layer.bottomTvdM, layer.densityKgM3, layer.porosityPct] })) },
      { id: "logs", title: "Linked mud-log curves", kind: "logs", sourceId: null, curves: logs.curves },
      { id: "operations", title: "Operational milestones", kind: "operations", events: (operations?.milestones ?? []).map((milestone) => ({ id: milestone.id, date: milestone.date, label: milestone.label, mdM: milestone.mdFt === null ? null : milestone.mdFt * FOOT_TO_METRE, sourceId: null, sourcePage: milestone.page })) },
      { id: "offsets", title: "Offset-well data", kind: "offsets", sourceId: null, columns: [{ key: "well", label: "Well", unit: null }], rows: [] },
      { id: "coverage", title: "Data coverage", kind: "data-coverage", sourceId: null, columns: [{ key: "type", label: "Record type", unit: null }, { key: "count", label: "Records", unit: null }], rows: [
        { id: "survey", mdM: null, values: ["Survey stations", design.survey?.length ?? 0] },
        { id: "components", mdM: null, values: ["Component records", components.length] },
        { id: "days", mdM: null, values: ["Daily reports", operations?.days.length ?? 0] },
      ] },
      { id: "assumptions", title: "Data handling notes", kind: "assumptions", items: ["User-authored geometry is not source-observed geometry. Survey positions use minimum curvature.", "Operational and log measurements retain their supplied units and are not recalculated when geometry changes."] },
      { id: "not-checked", title: "Not assessed", kind: "not-checked", items: ["Engineering certification, pressure modelling, casing strength, barrier integrity, petrophysics and reservoir simulation."] },
      { id: "provenance", title: "Revision and evidence", kind: "provenance", items: [
        "This report uses the active well revision. The immutable original remains available through Restore original well.",
        "Editing geometry does not re-run pressure, casing-strength, petrophysics or reservoir simulations. Source findings are not represented as results for the edited well.",
        ...(operations?.notes ?? []),
      ] },
    ],
    appendices: operations ? [
      { id: "daily", title: "Daily operations register", sourceId: null, columns: [{ key: "date", label: "Date", unit: null }, { key: "depth", label: "MD", unit: "m" }, { key: "headline", label: "Headline", unit: null }, { key: "activities", label: "Activities", unit: null }], rows: operations.days.map((day, index) => ({ id: `day-${index}`, mdM: day.mdM, values: [day.date, day.mdM, day.headline, day.activities.join("; ")] })) },
      { id: "runs", title: "Service run register", sourceId: null, columns: [{ key: "id", label: "Run", unit: null }, { key: "top", label: "Top", unit: "m MD" }, { key: "base", label: "Base", unit: "m MD" }, { key: "summary", label: "Summary", unit: null }, { key: "outcome", label: "Outcome", unit: null }], rows: operations.runs.map((run) => ({ id: run.id, mdM: run.topM, values: [run.id, run.topM, run.baseM, run.summary, run.outcome] })) },
    ] : [],
  });
}

export function WellReportDemo() {
  const { store, well } = useWorkspace();
  const { design, operations, logUrl } = useWell(well.id);
  const selectedComponentId = useSubsurfaceSelector(store, (state) => state.activeAsset.componentId);
  const link = useDepthLink(true, store);
  const window = useSubsurfaceSelector(store, (state) => state.depthLink.window);
  const [logState, setLogState] = useState<{ readonly status: "loading" | "ready" | "error"; readonly data: MudLogReportData; readonly error: string | null }>({
    status: "loading", data: { curves: [], mdStartM: null, mdEndM: null }, error: null,
  });
  const schematicComponents = useMemo(() => getWellComponents(design), [design]);
  useEffect(() => {
    let active = true;
    if (!logUrl) {
      setLogState({ status: "ready", data: { curves: [], mdStartM: null, mdEndM: null }, error: null });
      return;
    }
    setLogState({ status: "loading", data: { curves: [], mdStartM: null, mdEndM: null }, error: null });
    fetch(logUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load mud log: HTTP ${response.status}`);
        return response.text();
      })
      .then((text) => {
        const data = toReportLogs(text);
        if (active) setLogState({ status: "ready", data, error: null });
      })
      .catch((error: unknown) => {
        if (active) setLogState({ status: "error", data: { curves: [], mdStartM: null, mdEndM: null }, error: error instanceof Error ? error.message : String(error) });
      });
    return () => { active = false; };
  }, [logUrl]);
  const report = useMemo(() => design === forgeDesign ? makeReport(logState.data) : revisionReport(design, operations, logState.data), [design, operations, logState.data]);
  return <div className="demo-well-report-workspace">
    <p className="demo-correlation-status" role="status" data-testid="well-report-link-status">
      Shared well: {design.id}{window ? ` · depth window ${window[0].toFixed(1)}–${window[1].toFixed(1)} m MD` : " · no depth window"}
      {link.cursorMdM !== null ? ` · cursor ${link.cursorMdM.toFixed(1)} m MD` : ""}
      {link.pinnedMdM !== null ? ` · selected ${link.pinnedMdM.toFixed(1)} m MD` : ""}
    </p>
    {logState.status === "loading" && <p role="status">Loading the referenced LAS file for the report log view…</p>}
    {logState.status === "error" && <p className="demo-storage-error" role="alert">Report log unavailable: {logState.error}</p>}
    <WellReportView
      report={report}
      schematicDesign={design}
      schematicComponents={schematicComponents}
      assemblyAssetBaseUrl="/well-components"
      selectedMdM={link.pinnedMdM}
      selectedComponentId={selectedComponentId}
      onSelectComponent={(id) => store.selectComponent(id, "well-report")}
      cursorMdM={link.cursorMdM}
      onSelectMd={link.pinCursor}
    />
  </div>;
}
