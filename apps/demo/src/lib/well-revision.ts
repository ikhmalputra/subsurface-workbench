import { assemblyToWellComponents, computeMinimumCurvature, getWellComponents, validateSurveyStations } from "@ikhmalputra/subsurface-core";
import type { WellAssembly, WellDesign, WellOperations, SurveyStationInput } from "@ikhmalputra/subsurface-core";

export interface WellRevision {
  readonly design: WellDesign;
  readonly operations: WellOperations | null;
  readonly logUrl: string | null;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object.`);
  return value as Record<string, unknown>;
}

function finite(value: unknown, path: string, min = -Infinity, max = Infinity): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${path} must be a finite number from ${min} to ${max}.`);
}

function text(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") throw new Error(`${path} must be text.`);
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value;
}

function choice(value: unknown, options: readonly string[], path: string) {
  if (typeof value !== "string" || !options.includes(value)) throw new Error(`${path} must be one of ${options.join(", ")}.`);
}

function fields(value: Record<string, unknown>, strings: readonly string[], numbers: readonly string[], nullable: readonly string[], path: string) {
  for (const key of strings) text(value[key], `${path}.${key}`);
  for (const key of numbers) finite(value[key], `${path}.${key}`, 0);
  for (const key of nullable) if (value[key] !== null) finite(value[key], `${path}.${key}`);
}

function uniqueIds(values: unknown[], path: string) {
  const ids = new Set<string>();
  values.forEach((value, index) => {
    const id = record(value, `${path}[${index}]`).id;
    text(id, `${path}[${index}].id`);
    if (!id.trim() || ids.has(id)) throw new Error(`${path} contains an empty or duplicate ID.`);
    ids.add(id);
  });
}

function date(value: unknown, path: string) {
  text(value, path);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error(`${path} must be a valid YYYY-MM-DD date.`);
}

export function assertWellDesign(value: unknown): asserts value is WellDesign {
  const design = record(value, "design");
  text(design.id, "design.id");
  if (!design.id.trim()) throw new Error("Well ID cannot be empty.");
  finite(design.revision, "design.revision", 0);
  if (!Number.isSafeInteger(design.revision)) throw new Error("Revision must be a safe integer.");
  finite(design.totalDepthM, "design.totalDepthM", 50);
  const totalDepthM = design.totalDepthM;
  finite(design.casingBottomM, "design.casingBottomM", 0, design.totalDepthM);
  choice(design.units, ["m"], "design.units");
  choice(design.provenance, ["synthetic", "documented", "user-authored"], "design.provenance");
  if (design.surveyStatus !== undefined) choice(design.surveyStatus, ["observed", "planned"], "design.surveyStatus");
  for (const key of ["wellName", "trajectoryNote", "depthDatum", "trajectoryName", "trajectorySource", "coverageNote", "attribution", "license"]) {
    if (design[key] !== undefined) text(design[key], `design.${key}`);
  }
  for (const key of ["referenceElevationMslM", "groundTvdM", "reportedTotalDepthFt", "surveyCoverageFt"]) {
    if (design[key] !== undefined) finite(design[key], `design.${key}`);
  }
  if (design.survey !== undefined) {
    const survey = list(design.survey, "design.survey");
    let previous = -Infinity;
    survey.forEach((entry, index) => {
      const station = record(entry, `survey[${index}]`);
      finite(station.mdM, `survey[${index}].mdM`, 0, totalDepthM);
      if (station.mdM <= previous) throw new Error("Survey MD must be strictly increasing.");
      previous = station.mdM;
      finite(station.inclinationDeg, `survey[${index}].inclinationDeg`, 0, 180);
      finite(station.azimuthDeg, `survey[${index}].azimuthDeg`, 0, 360);
      for (const key of ["tvdM", "eastingM", "northingM"]) finite(station[key], `survey[${index}].${key}`);
      for (const key of ["sourceRow", "rawMdFt", "rawTvdFt"]) if (station[key] !== undefined) finite(station[key], `survey[${index}].${key}`);
    });
    if (survey.length === 1) throw new Error("Supply at least two survey stations, or an empty survey.");
  }
  if (design.components !== undefined) {
    const components = list(design.components, "design.components");
    uniqueIds(components, "components");
    components.forEach((entry, index) => {
      const component = record(entry, `components[${index}]`);
      fields(component, ["id", "name", "material", "description"], ["topDepthM", "bottomDepthM"], ["outerDiameterMm", "innerDiameterMm"], `components[${index}]`);
      choice(component.kind, ["Cement", "Casing", "Tubular", "Connection", "Wellhead", "Coupling", "Casing joint", "Tubing joint", "Casing coupling", "Tubing coupling", "Centralizer", "Packer", "Safety valve", "Gas lift mandrel", "Gauge", "Landing nipple", "Hole", "Valve"], "component.kind");
      finite(component.topDepthM, "component.topDepthM", 0, totalDepthM);
      finite(component.bottomDepthM, "component.bottomDepthM", component.topDepthM, totalDepthM);
      for (const key of ["outerDiameterMm", "innerDiameterMm"]) if (component[key] !== null) finite(component[key], `component.${key}`, 0);
      if (typeof component.outerDiameterMm === "number" && typeof component.innerDiameterMm === "number" && component.innerDiameterMm > component.outerDiameterMm) throw new Error("Component ID cannot exceed OD.");
      for (const key of ["parentId", "sourceUrl"]) if (component[key] !== undefined) text(component[key], `component.${key}`);
      if (component.sourcePage !== undefined) finite(component.sourcePage, "component.sourcePage", 0);
      if (component.rawBottomDepthFt !== undefined && component.rawBottomDepthFt !== null) finite(component.rawBottomDepthFt, "component.rawBottomDepthFt");
      if (component.topDepthReported !== undefined && typeof component.topDepthReported !== "boolean") throw new Error("topDepthReported must be boolean.");
    });
    const ids = new Set(components.map((entry) => record(entry, "component").id));
    for (const entry of components) {
      const component = record(entry, "component");
      if (component.parentId !== undefined && (!ids.has(component.parentId) || component.parentId === component.id)) throw new Error("Component parent must refer to another component in this well.");
      const visited = new Set<unknown>([component.id]);
      let parent = component.parentId;
      while (parent !== undefined) {
        if (visited.has(parent)) throw new Error("Component parent links cannot contain a cycle.");
        visited.add(parent);
        parent = record(components.find((item) => record(item, "component").id === parent), "parent").parentId;
      }
    }
  }
  if (design.formations !== undefined) {
    const formations = list(design.formations, "design.formations");
    uniqueIds(formations, "formations");
    formations.forEach((entry) => {
      const layer = record(entry, "formation");
      fields(layer, ["id", "name", "lithology", "color"], [], ["densityKgM3", "porosityPct"], "formation");
      finite(layer.topTvdM, "formation.topTvdM");
      finite(layer.bottomTvdM, "formation.bottomTvdM", layer.topTvdM);
      if (layer.densityKgM3 !== null) finite(layer.densityKgM3, "formation.densityKgM3", 0);
      if (layer.porosityPct !== null) finite(layer.porosityPct, "formation.porosityPct", 0, 100);
      if (!/^#[\da-f]{6}$/i.test(String(layer.color))) throw new Error("Formation color must be a six-digit hex color.");
      for (const key of ["sourceUrl", "interpretation"]) if (layer[key] !== undefined) text(layer[key], `formation.${key}`);
    });
  }
}

export function assertWellOperations(value: unknown): asserts value is WellOperations {
  const ops = record(value, "operations");
  fields(ops, ["wellId", "license", "attribution"], [], [], "operations");
  for (const [key, source] of Object.entries(record(ops.sources, "operations.sources"))) fields(record(source, key), ["url", "sha256", "title"], [], [], key);
  list(ops.notes, "operations.notes").forEach((note) => text(note, "operation note"));
  for (const key of ["milestones", "days", "runs", "sections"]) list(ops[key], `operations.${key}`);
  uniqueIds(list(ops.milestones, "milestones"), "milestones");
  uniqueIds(list(ops.runs, "runs"), "runs");
  uniqueIds(list(ops.sections, "sections"), "sections");
  for (const entry of list(ops.milestones, "milestones")) {
    const milestone = record(entry, "milestone");
    fields(milestone, ["id", "label", "date", "source"], ["page"], ["mdFt"], "milestone");
    date(milestone.date, "milestone.date");
  }
  for (const entry of list(ops.days, "days")) {
    const day = record(entry, "day");
    fields(day, ["date", "headline", "planned"], ["page"], ["mdFt", "mdM", "tvdFt", "footageFt", "mudWeightPpg"], "day");
    finite(day.dayFromSpud, "day.dayFromSpud");
    date(day.date, "day.date");
    choice(day.category, ["drilling", "tripping", "casing", "rig", "circulating", "logging", "coring", "testing", "repair", "other"], "day.category");
    list(day.activities, "day.activities").forEach((activity) => text(activity, "activity"));
  }
  for (const entry of list(ops.runs, "runs")) {
    const run = record(entry, "run");
    fields(run, ["id", "holeSection", "sourceHeading", "summary"], ["page"], ["topFt", "baseFt", "topM", "baseM", "footageFt", "avgRopFph"], "run");
    choice(run.kind, ["drilling", "coring", "cleanout", "reaming", "survey", "cooldown", "test", "fishing", "logging", "plugback", "milling"], "run.kind");
    choice(run.outcome, ["completed", "problem", "failed"], "run.outcome");
  }
  for (const entry of list(ops.sections, "sections")) {
    const section = record(entry, "section");
    fields(section, ["id", "name", "casing", "holeComponentId", "casingComponentId"], ["bitSizeIn", "topFt", "baseFt", "topM", "baseM", "runCount", "problemRuns", "drilledFt"], ["avgRopFph"], "section");
    for (const key of ["firstDate", "lastDate"]) if (section[key] !== null) date(section[key], `section.${key}`);
  }
  for (const key of ["runs", "sections"]) for (const item of list(ops[key], key)) {
    const interval = record(item, key);
    for (const unit of ["Ft", "M"]) {
      const top = interval[`top${unit}`], base = interval[`base${unit}`];
      if (typeof top === "number" && typeof base === "number" && base < top) throw new Error(`${key} base depth cannot be above top depth.`);
    }
  }
}

export function localLogUrl(value: unknown): string | null {
  if (value === null || value === "") return null;
  text(value, "logUrl");
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("?") || value.includes("#")) throw new Error("Mud-log URL must be a same-origin absolute file path.");
  return value;
}

export function parseWellRevision(input: string, sourceId: string): WellRevision {
  const value = record(JSON.parse(input), "well revision");
  assertWellDesign(value.design);
  if (value.design.id !== sourceId) throw new Error("Well ID is immutable; import into the matching source well.");
  if (value.operations !== null) {
    assertWellOperations(value.operations);
    if (value.operations.wellId !== sourceId) throw new Error("Operational records must belong to this well.");
  }
  return { design: value.design, operations: value.operations, logUrl: localLogUrl(value.logUrl) };
}

export function authoredRevision(value: WellRevision, previous: WellDesign): WellRevision {
  assertWellDesign(value.design);
  if (value.design.id !== previous.id) throw new Error("Well ID is immutable.");
  if (value.operations !== null) {
    assertWellOperations(value.operations);
    if (value.operations.wellId !== previous.id) throw new Error("Operational records must belong to this well.");
  }
  return { ...value, logUrl: localLogUrl(value.logUrl), design: { ...value.design, revision: previous.revision + 1, provenance: "user-authored" } };
}

export function editTrajectory(design: WellDesign, stations: readonly SurveyStationInput[]): WellDesign {
  const invalid = validateSurveyStations(stations).find((issue) => issue.severity === "error");
  if (invalid) throw new Error(`Station ${invalid.index + 1}: ${invalid.message}`);
  if (stations.length < 2) throw new Error("A trajectory needs at least two survey stations.");
  const tieIn = design.survey?.[0];
  if (tieIn && Math.abs(stations[0]!.mdM - tieIn.mdM) > 1e-6) throw new Error(`First station must retain the source tie-in at ${tieIn.mdM} m MD.`);
  const survey = computeMinimumCurvature(stations, { tieIn });
  const totalDepthM = Math.max(design.totalDepthM, survey.at(-1)!.mdM);
  return { ...design, totalDepthM, survey: survey.map(({ mdM, tvdM, northingM, eastingM, inclinationDeg, azimuthDeg }) => ({ mdM, tvdM, northingM, eastingM, inclinationDeg, azimuthDeg })), surveyStatus: "planned", trajectoryName: "Edited trajectory", trajectoryNote: "User-authored survey; positions recomputed by minimum curvature using the original first-station tie-in.", surveyCoverageFt: undefined };
}

export function mergeAssembly(design: WellDesign, before: WellAssembly, after: WellAssembly): WellDesign {
  const originals = getWellComponents(design);
  const converted = assemblyToWellComponents(after);
  const beforeIds = new Set(before.items.map((item) => item.id));
  const afterIds = new Set(after.items.map((item) => item.id));
  const removed = new Set(before.items.filter((item) => !afterIds.has(item.id)).map((item) => item.id));
  let found = true;
  while (found) {
    found = false;
    for (const component of originals) if (component.parentId && removed.has(component.parentId) && !removed.has(component.id)) {
      removed.add(component.id); found = true;
    }
  }
  const changed = converted.map((component) => {
    const old = originals.find((entry) => entry.id === component.id);
    const previous = before.items.find((entry) => entry.id === component.id);
    const next = after.items.find((entry) => entry.id === component.id)!;
    if (old && previous && JSON.stringify(previous) === JSON.stringify(next)) return old;
    return old && previous ? {
      ...old, name: component.name,
      ...(previous.topM !== next.topM ? { topDepthM: component.topDepthM, topDepthReported: true } : {}),
      ...(previous.bottomM !== next.bottomM ? { bottomDepthM: component.bottomDepthM, rawBottomDepthFt: undefined } : {}),
      ...(previous.odIn !== next.odIn ? { outerDiameterMm: component.outerDiameterMm } : {}),
      ...(previous.idIn !== next.idIn ? { innerDiameterMm: component.innerDiameterMm } : {}),
      ...(previous.hostId !== next.hostId ? { parentId: next.hostId } : {}),
    } : component;
  });
  const components = [...originals.filter((component) => !beforeIds.has(component.id) && !removed.has(component.id)), ...changed];
  return { ...design, wellName: after.name, totalDepthM: after.totalDepthM, casingBottomM: Math.max(0, ...components.filter((component) => component.kind === "Casing").map((component) => component.bottomDepthM)), components };
}
