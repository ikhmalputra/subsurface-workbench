import { fail } from "./contract-validation.ts";
import type { WellDesign, WellOperations } from "./index.ts";

/**
 * Runtime validation for the two records this package is built around.
 *
 * `WellDesign` is the SDK's flagship type and, until this module, the package could not check one.
 * Every other contract here has a validator — well paths, seismic volumes, log curves, petrophysics
 * wells — but a host accepting a design from a file, a form or another service had nothing to call,
 * and the only implementation lived inside a private demo application.
 *
 * These follow the package's validation contract: they return the value on success and throw a
 * `ContractValidationError` naming the path and the reason on failure. They do not repair, coerce
 * or fill in anything — a design that does not describe a well is refused, not rounded off.
 *
 * Note that the checks are deliberately laxer than `object()` elsewhere in this package: a design
 * carries provenance, hashes and source fields that differ between hosts, so unknown keys are
 * allowed through and empty strings are tolerated where a record legitimately has none. What is
 * checked is what would make a drawing wrong: depth ordering, depth bounds, diameters that nest,
 * component parents that exist and do not loop, and dates that are real.
 */

const record = (value: unknown, path: string): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fail(path, "expected an object");

function finite(value: unknown, path: string, min = -Infinity, max = Infinity): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    fail(path, min === -Infinity && max === Infinity ? "expected a finite number" : `expected a finite number from ${min} to ${max}`);
  }
}

/** Strings may be empty here: a component with no description is a record, not a defect. */
function str(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") fail(path, "expected text");
}

const list = (value: unknown, path: string): unknown[] => Array.isArray(value) ? value : fail(path, "expected an array");

function choice(value: unknown, options: readonly string[], path: string) {
  if (typeof value !== "string" || !options.includes(value)) fail(path, `expected one of ${options.join(", ")}`);
}

function fields(value: Record<string, unknown>, strings: readonly string[], numbers: readonly string[], nullable: readonly string[], path: string) {
  for (const key of strings) str(value[key], `${path}.${key}`);
  for (const key of numbers) finite(value[key], `${path}.${key}`, 0);
  for (const key of nullable) if (value[key] !== null) finite(value[key], `${path}.${key}`);
}

function uniqueIds(values: unknown[], path: string) {
  const ids = new Set<string>();
  values.forEach((value, index) => {
    const id = record(value, `${path}[${index}]`).id;
    str(id, `${path}[${index}].id`);
    if (!id.trim() || ids.has(id)) fail(`${path}[${index}].id`, "expected a unique, non-empty id");
    ids.add(id);
  });
}

/** A calendar date the way the records state it, and one that actually exists. */
function date(value: unknown, path: string) {
  str(value, path);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    fail(path, "expected a valid YYYY-MM-DD date");
  }
}

const COMPONENT_KINDS = ["Cement", "Casing", "Tubular", "Connection", "Wellhead", "Coupling", "Casing joint", "Tubing joint", "Casing coupling", "Tubing coupling", "Centralizer", "Packer", "Safety valve", "Gas lift mandrel", "Gauge", "Landing nipple", "Hole", "Valve"] as const;
const DAY_CATEGORIES = ["drilling", "tripping", "casing", "rig", "circulating", "logging", "coring", "testing", "repair", "other"] as const;
const RUN_KINDS = ["drilling", "coring", "cleanout", "reaming", "survey", "cooldown", "test", "fishing", "logging", "plugback", "milling"] as const;
const RUN_OUTCOMES = ["completed", "problem", "failed"] as const;

/** Check a well design. Returns it on success; throws `ContractValidationError` otherwise. */
export function validateWellDesign(value: unknown): WellDesign {
  const design = record(value, "design");
  str(design.id, "design.id");
  if (!design.id.trim()) fail("design.id", "expected a non-empty id");
  finite(design.revision, "design.revision", 0);
  if (!Number.isSafeInteger(design.revision)) fail("design.revision", "expected a safe integer");
  finite(design.totalDepthM, "design.totalDepthM", 50);
  const totalDepthM = design.totalDepthM;
  finite(design.casingBottomM, "design.casingBottomM", 0, totalDepthM);
  choice(design.units, ["m"], "design.units");
  choice(design.provenance, ["synthetic", "documented", "user-authored"], "design.provenance");
  if (design.surveyStatus !== undefined) choice(design.surveyStatus, ["observed", "planned"], "design.surveyStatus");
  for (const key of ["wellName", "trajectoryNote", "depthDatum", "trajectoryName", "trajectorySource", "coverageNote", "attribution", "license"]) {
    if (design[key] !== undefined) str(design[key], `design.${key}`);
  }
  for (const key of ["referenceElevationMslM", "groundTvdM", "reportedTotalDepthFt", "surveyCoverageFt"]) {
    if (design[key] !== undefined) finite(design[key], `design.${key}`);
  }
  if (design.survey !== undefined) {
    const survey = list(design.survey, "design.survey");
    let previous = -Infinity;
    survey.forEach((entry, index) => {
      const station = record(entry, `design.survey[${index}]`);
      finite(station.mdM, `design.survey[${index}].mdM`, 0, totalDepthM);
      // Minimum curvature integrates station to station; a repeated or reversed depth has no course.
      if (station.mdM <= previous) fail(`design.survey[${index}].mdM`, "expected strictly increasing measured depth");
      previous = station.mdM;
      finite(station.inclinationDeg, `design.survey[${index}].inclinationDeg`, 0, 180);
      finite(station.azimuthDeg, `design.survey[${index}].azimuthDeg`, 0, 360);
      for (const key of ["tvdM", "eastingM", "northingM"]) finite(station[key], `design.survey[${index}].${key}`);
      for (const key of ["sourceRow", "rawMdFt", "rawTvdFt"]) if (station[key] !== undefined) finite(station[key], `design.survey[${index}].${key}`);
    });
    if (survey.length === 1) fail("design.survey", "expected at least two stations, or an empty survey");
  }
  if (design.components !== undefined) {
    const components = list(design.components, "design.components");
    uniqueIds(components, "design.components");
    components.forEach((entry, index) => {
      const at = `design.components[${index}]`;
      const component = record(entry, at);
      fields(component, ["id", "name", "material", "description"], ["topDepthM", "bottomDepthM"], ["outerDiameterMm", "innerDiameterMm"], at);
      choice(component.kind, COMPONENT_KINDS, `${at}.kind`);
      finite(component.topDepthM, `${at}.topDepthM`, 0, totalDepthM);
      finite(component.bottomDepthM, `${at}.bottomDepthM`, component.topDepthM, totalDepthM);
      for (const key of ["outerDiameterMm", "innerDiameterMm"]) if (component[key] !== null) finite(component[key], `${at}.${key}`, 0);
      if (typeof component.outerDiameterMm === "number" && typeof component.innerDiameterMm === "number" && component.innerDiameterMm > component.outerDiameterMm) {
        fail(`${at}.innerDiameterMm`, "expected an inner diameter no greater than the outer diameter");
      }
      for (const key of ["parentId", "sourceUrl"]) if (component[key] !== undefined) str(component[key], `${at}.${key}`);
      if (component.sourcePage !== undefined) finite(component.sourcePage, `${at}.sourcePage`, 0);
      if (component.rawBottomDepthFt !== undefined && component.rawBottomDepthFt !== null) finite(component.rawBottomDepthFt, `${at}.rawBottomDepthFt`);
      if (component.topDepthReported !== undefined && typeof component.topDepthReported !== "boolean") fail(`${at}.topDepthReported`, "expected a boolean");
    });
    // A component nests inside its parent; a dangling or looping link would draw a well that cannot exist.
    const ids = new Set(components.map((entry) => record(entry, "design.components").id));
    components.forEach((entry, index) => {
      const at = `design.components[${index}]`;
      const component = record(entry, at);
      if (component.parentId !== undefined && (!ids.has(component.parentId) || component.parentId === component.id)) {
        fail(`${at}.parentId`, "expected another component of this well");
      }
      const visited = new Set<unknown>([component.id]);
      let parent = component.parentId;
      while (parent !== undefined) {
        if (visited.has(parent)) fail(`${at}.parentId`, "expected parent links without a cycle");
        visited.add(parent);
        parent = record(components.find((item) => record(item, at).id === parent), `${at}.parentId`).parentId;
      }
    });
  }
  if (design.formations !== undefined) {
    const formations = list(design.formations, "design.formations");
    uniqueIds(formations, "design.formations");
    formations.forEach((entry, index) => {
      const at = `design.formations[${index}]`;
      const layer = record(entry, at);
      fields(layer, ["id", "name", "lithology", "color"], [], ["densityKgM3", "porosityPct"], at);
      finite(layer.topTvdM, `${at}.topTvdM`);
      finite(layer.bottomTvdM, `${at}.bottomTvdM`, layer.topTvdM);
      if (layer.densityKgM3 !== null) finite(layer.densityKgM3, `${at}.densityKgM3`, 0);
      if (layer.porosityPct !== null) finite(layer.porosityPct, `${at}.porosityPct`, 0, 100);
      if (!/^#[\da-f]{6}$/i.test(String(layer.color))) fail(`${at}.color`, "expected a six-digit hex colour");
      for (const key of ["sourceUrl", "interpretation"]) if (layer[key] !== undefined) str(layer[key], `${at}.${key}`);
    });
  }
  return design as unknown as WellDesign;
}

/** Check a well's operational records. Returns them on success; throws `ContractValidationError` otherwise. */
export function validateWellOperations(value: unknown): WellOperations {
  const ops = record(value, "operations");
  fields(ops, ["wellId", "license", "attribution"], [], [], "operations");
  for (const [key, source] of Object.entries(record(ops.sources, "operations.sources"))) {
    fields(record(source, `operations.sources.${key}`), ["url", "sha256", "title"], [], [], `operations.sources.${key}`);
  }
  list(ops.notes, "operations.notes").forEach((note, index) => str(note, `operations.notes[${index}]`));
  for (const key of ["milestones", "days", "runs", "sections"]) list(ops[key], `operations.${key}`);
  for (const key of ["milestones", "runs", "sections"]) uniqueIds(list(ops[key], `operations.${key}`), `operations.${key}`);
  list(ops.milestones, "operations.milestones").forEach((entry, index) => {
    const at = `operations.milestones[${index}]`;
    const milestone = record(entry, at);
    fields(milestone, ["id", "label", "date", "source"], ["page"], ["mdFt"], at);
    date(milestone.date, `${at}.date`);
  });
  list(ops.days, "operations.days").forEach((entry, index) => {
    const at = `operations.days[${index}]`;
    const day = record(entry, at);
    fields(day, ["date", "headline", "planned"], ["page"], ["mdFt", "mdM", "tvdFt", "footageFt", "mudWeightPpg"], at);
    finite(day.dayFromSpud, `${at}.dayFromSpud`);
    date(day.date, `${at}.date`);
    choice(day.category, DAY_CATEGORIES, `${at}.category`);
    list(day.activities, `${at}.activities`).forEach((activity, line) => str(activity, `${at}.activities[${line}]`));
  });
  list(ops.runs, "operations.runs").forEach((entry, index) => {
    const at = `operations.runs[${index}]`;
    const run = record(entry, at);
    fields(run, ["id", "holeSection", "sourceHeading", "summary"], ["page"], ["topFt", "baseFt", "topM", "baseM", "footageFt", "avgRopFph"], at);
    choice(run.kind, RUN_KINDS, `${at}.kind`);
    choice(run.outcome, RUN_OUTCOMES, `${at}.outcome`);
  });
  list(ops.sections, "operations.sections").forEach((entry, index) => {
    const at = `operations.sections[${index}]`;
    const section = record(entry, at);
    fields(section, ["id", "name", "casing", "holeComponentId", "casingComponentId"], ["bitSizeIn", "topFt", "baseFt", "topM", "baseM", "runCount", "problemRuns", "drilledFt"], ["avgRopFph"], at);
    for (const key of ["firstDate", "lastDate"]) if (section[key] !== null) date(section[key], `${at}.${key}`);
  });
  // An interval whose base is above its top would draw upward.
  for (const key of ["runs", "sections"]) {
    list(ops[key], `operations.${key}`).forEach((item, index) => {
      const at = `operations.${key}[${index}]`;
      const interval = record(item, at);
      for (const unit of ["Ft", "M"]) {
        const top = interval[`top${unit}`], base = interval[`base${unit}`];
        if (typeof top === "number" && typeof base === "number" && base < top) fail(`${at}.base${unit}`, "expected a base depth at or below the top depth");
      }
    });
  }
  return ops as unknown as WellOperations;
}
