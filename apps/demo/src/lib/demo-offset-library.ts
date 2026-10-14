import { offsetFromBrief } from "@ikhmalputra/subsurface-core/offset-wells";
import type { OffsetWell } from "@ikhmalputra/subsurface-core/offset-wells";
import type { WellDesignBrief } from "@ikhmalputra/subsurface-core/well-design";

interface SavedOffset {
  readonly id: string;
  readonly name: string;
  readonly brief: WellDesignBrief;
  readonly notes: readonly string[];
}

interface SavedOffsetLibrary {
  readonly version: 1;
  readonly offsets: readonly SavedOffset[];
}

const sources = ["measured", "offset", "estimated", "assumed"] as const;
const purposes = ["exploration", "appraisal", "development", "injection", "disposal", "geothermal"] as const;
const roles = ["conductor", "surface", "intermediate", "production", "liner", "tieback"] as const;
const lifts = ["none", "gas-lift", "esp", "rod-pump", "pcp", "jet-pump"] as const;

function record(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be an object.`);
  const result = value as Record<string, unknown>;
  for (const key of required) if (!Object.hasOwn(result, key)) throw new TypeError(`${path}.${key} is required.`);
  for (const key of Object.keys(result)) if (!required.includes(key) && !optional.includes(key)) throw new TypeError(`${path}.${key} is not supported.`);
  return result;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string") throw new TypeError(`${path} must be text.`);
  return value;
}

function nonEmptyText(value: unknown, path: string): string {
  const result = text(value, path);
  if (!result.trim()) throw new TypeError(`${path} must not be empty.`);
  return result;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${path} must be a finite number.`);
  return value;
}

function nullableFinite(value: unknown, path: string): void {
  if (value !== null) finite(value, path);
}

function oneOf<const T extends readonly string[]>(value: unknown, choices: T, path: string): T[number] {
  if (typeof value !== "string" || !choices.includes(value)) throw new TypeError(`${path} is not a supported value.`);
  return value;
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return value;
}

function validateBrief(value: unknown, path: string): WellDesignBrief {
  const brief = record(value, path, ["identity", "location", "datum", "geology", "trajectory", "totalDepthMdM", "sections", "completion"], ["fluids", "basis", "origin"]);
  const identity = record(brief.identity, `${path}.identity`, ["name", "field", "operator", "country", "purpose"], ["uwi"]);
  for (const key of ["name", "field", "operator", "country"] as const) text(identity[key], `${path}.identity.${key}`);
  oneOf(identity.purpose, purposes, `${path}.identity.purpose`);
  if (identity.uwi !== undefined) text(identity.uwi, `${path}.identity.uwi`);

  const location = record(brief.location, `${path}.location`, ["environment", "crs", "latitude", "longitude", "waterDepthM", "groundElevationM"]);
  oneOf(location.environment, ["onshore", "offshore-platform", "offshore-subsea"], `${path}.location.environment`);
  text(location.crs, `${path}.location.crs`);
  for (const key of ["latitude", "longitude", "waterDepthM", "groundElevationM"] as const) nullableFinite(location[key], `${path}.location.${key}`);

  const datum = record(brief.datum, `${path}.datum`, ["reference", "elevationAboveMslM"]);
  oneOf(datum.reference, ["RKB", "DF", "GL", "MSL"], `${path}.datum.reference`);
  nullableFinite(datum.elevationAboveMslM, `${path}.datum.elevationAboveMslM`);

  const geology = record(brief.geology, `${path}.geology`, ["formations", "pressures", "surfaceTemperatureC", "geothermalGradientCPerKm"], ["temperatureSource", "temperatureNote", "integrityTests"]);
  list(geology.formations, `${path}.geology.formations`).forEach((value, index) => {
    const itemPath = `${path}.geology.formations[${index}]`;
    const formation = record(value, itemPath, ["name", "topTvdM", "lithology"], ["reservoir", "hazard"]);
    text(formation.name, `${itemPath}.name`);
    finite(formation.topTvdM, `${itemPath}.topTvdM`);
    text(formation.lithology, `${itemPath}.lithology`);
    if (formation.reservoir !== undefined && typeof formation.reservoir !== "boolean") throw new TypeError(`${itemPath}.reservoir must be boolean.`);
    if (formation.hazard !== undefined) text(formation.hazard, `${itemPath}.hazard`);
  });
  list(geology.pressures, `${path}.geology.pressures`).forEach((value, index) => {
    const itemPath = `${path}.geology.pressures[${index}]`;
    const point = record(value, itemPath, ["tvdM", "porePressureSg", "fractureGradientSg"], ["poreSource", "fractureSource", "note"]);
    for (const key of ["tvdM", "porePressureSg", "fractureGradientSg"] as const) finite(point[key], `${itemPath}.${key}`);
    for (const key of ["poreSource", "fractureSource"] as const) if (point[key] !== undefined) oneOf(point[key], sources, `${itemPath}.${key}`);
    if (point.note !== undefined) text(point.note, `${itemPath}.note`);
  });
  finite(geology.surfaceTemperatureC, `${path}.geology.surfaceTemperatureC`);
  finite(geology.geothermalGradientCPerKm, `${path}.geology.geothermalGradientCPerKm`);
  if (geology.temperatureSource !== undefined) oneOf(geology.temperatureSource, sources, `${path}.geology.temperatureSource`);
  if (geology.temperatureNote !== undefined) text(geology.temperatureNote, `${path}.geology.temperatureNote`);
  if (geology.integrityTests !== undefined) list(geology.integrityTests, `${path}.geology.integrityTests`).forEach((value, index) => {
    const itemPath = `${path}.geology.integrityTests[${index}]`;
    const test = record(value, itemPath, ["kind", "tvdM", "emwSg", "reachedLeakOff", "source"]);
    oneOf(test.kind, ["FIT", "LOT", "XLOT"], `${itemPath}.kind`);
    finite(test.tvdM, `${itemPath}.tvdM`);
    finite(test.emwSg, `${itemPath}.emwSg`);
    if (typeof test.reachedLeakOff !== "boolean") throw new TypeError(`${itemPath}.reachedLeakOff must be boolean.`);
    text(test.source, `${itemPath}.source`);
  });

  if (brief.fluids !== undefined && brief.fluids !== null) {
    const fluids = record(brief.fluids, `${path}.fluids`, ["type", "h2sMolPct", "co2MolPct"], ["source"]);
    oneOf(fluids.type, ["oil", "gas", "condensate", "water", "geothermal", "co2"], `${path}.fluids.type`);
    nullableFinite(fluids.h2sMolPct, `${path}.fluids.h2sMolPct`);
    nullableFinite(fluids.co2MolPct, `${path}.fluids.co2MolPct`);
    if (fluids.source !== undefined) oneOf(fluids.source, sources, `${path}.fluids.source`);
  }
  if (brief.basis !== undefined) {
    const basis = record(brief.basis, `${path}.basis`, ["kickIntensitySg", "casingWearPct"]);
    finite(basis.kickIntensitySg, `${path}.basis.kickIntensitySg`);
    finite(basis.casingWearPct, `${path}.basis.casingWearPct`);
  }
  if (brief.origin !== undefined) {
    const origin = record(brief.origin, `${path}.origin`, ["offsetId", "offsetName", "parts"]);
    text(origin.offsetId, `${path}.origin.offsetId`);
    text(origin.offsetName, `${path}.origin.offsetName`);
    list(origin.parts, `${path}.origin.parts`).forEach((part, index) => oneOf(part, ["geology", "casing", "completion"], `${path}.origin.parts[${index}]`));
  }
  if (brief.trajectory !== null) {
    const trajectory = list(brief.trajectory, `${path}.trajectory`);
    if (trajectory.length < 2) throw new TypeError(`${path}.trajectory must contain at least two stations.`);
    let previousMd = -1;
    trajectory.forEach((value, index) => {
      const itemPath = `${path}.trajectory[${index}]`;
      const station = record(value, itemPath, ["mdM", "inclinationDeg", "azimuthDeg"]);
      const md = finite(station.mdM, `${itemPath}.mdM`);
      const inclination = finite(station.inclinationDeg, `${itemPath}.inclinationDeg`);
      const azimuth = finite(station.azimuthDeg, `${itemPath}.azimuthDeg`);
      if (md < 0 || md <= previousMd) throw new TypeError(`${itemPath}.mdM must be non-negative and strictly increasing.`);
      if (inclination < 0 || inclination > 180) throw new TypeError(`${itemPath}.inclinationDeg must be in [0, 180].`);
      if (azimuth < 0 || azimuth >= 360) throw new TypeError(`${itemPath}.azimuthDeg must be in [0, 360).`);
      previousMd = md;
    });
  }
  if (finite(brief.totalDepthMdM, `${path}.totalDepthMdM`) <= 0) throw new TypeError(`${path}.totalDepthMdM must be positive.`);
  list(brief.sections, `${path}.sections`).forEach((value, index) => {
    const itemPath = `${path}.sections[${index}]`;
    const section = record(value, itemPath, ["id", "role", "label", "holeSizeIn", "odIn", "weightLbFt", "grade", "topMdM", "shoeMdM", "mudWeightSg", "cement"]);
    text(section.id, `${itemPath}.id`);
    oneOf(section.role, roles, `${itemPath}.role`);
    text(section.label, `${itemPath}.label`);
    for (const key of ["holeSizeIn", "odIn", "weightLbFt", "topMdM", "shoeMdM", "mudWeightSg"] as const) finite(section[key], `${itemPath}.${key}`);
    text(section.grade, `${itemPath}.grade`);
    if (section.cement !== null) {
      const cement = record(section.cement, `${itemPath}.cement`, ["topMdM", "leadDensitySg", "tailDensitySg", "tailLengthM", "excessPct"]);
      for (const key of ["topMdM", "leadDensitySg", "tailDensitySg", "tailLengthM", "excessPct"] as const) finite(cement[key], `${itemPath}.cement.${key}`);
    }
  });
  if (brief.completion !== null) {
    const completion = record(brief.completion, `${path}.completion`, ["tubingOdIn", "tubingWeightLbFt", "tubingGrade", "packerMdM", "sssvMdM", "perforations", "artificialLift"], ["gasLiftMandrels", "packerFluidSg"]);
    if (completion.packerFluidSg !== undefined && (!Number.isFinite(completion.packerFluidSg) || (completion.packerFluidSg as number) <= 0)) throw new TypeError(`${path}.completion.packerFluidSg must be a positive finite number.`);
    for (const key of ["tubingOdIn", "tubingWeightLbFt", "packerMdM"] as const) finite(completion[key], `${path}.completion.${key}`);
    text(completion.tubingGrade, `${path}.completion.tubingGrade`);
    nullableFinite(completion.sssvMdM, `${path}.completion.sssvMdM`);
    list(completion.perforations, `${path}.completion.perforations`).forEach((value, index) => {
      const itemPath = `${path}.completion.perforations[${index}]`;
      const interval = record(value, itemPath, ["topMdM", "bottomMdM"]);
      finite(interval.topMdM, `${itemPath}.topMdM`);
      finite(interval.bottomMdM, `${itemPath}.bottomMdM`);
    });
    oneOf(completion.artificialLift, lifts, `${path}.completion.artificialLift`);
    if (completion.gasLiftMandrels !== undefined) finite(completion.gasLiftMandrels, `${path}.completion.gasLiftMandrels`);
  }

  return value as WellDesignBrief;
}

function savedOffset(value: unknown, path: string, legacy = false): SavedOffset {
  const offset = record(value, path, ["id", "name", "brief", "notes"], legacy ? ["status", "provenance", "asDrilled"] : []);
  const id = nonEmptyText(offset.id, `${path}.id`);
  const name = nonEmptyText(offset.name, `${path}.name`);
  const brief = validateBrief(offset.brief, `${path}.brief`);
  const notes = list(offset.notes, `${path}.notes`).map((note, index) => text(note, `${path}.notes[${index}]`));
  if ((legacy && offset.status !== "design") || (offset.status !== undefined && offset.status !== "design")) throw new TypeError(`${path}.status must be "design".`);
  if ((legacy && offset.provenance !== "user") || (offset.provenance !== undefined && offset.provenance !== "user")) throw new TypeError(`${path}.provenance must be "user".`);
  if (legacy && !Array.isArray(offset.asDrilled)) throw new TypeError(`${path}.asDrilled must be an empty array.`);
  if (offset.asDrilled !== undefined && (!Array.isArray(offset.asDrilled) || offset.asDrilled.length !== 0)) throw new TypeError(`${path}.asDrilled must be empty for a saved user design.`);
  return { id, name, brief, notes };
}

function toOffsetWell(saved: SavedOffset): OffsetWell {
  return offsetFromBrief(saved.brief, { id: saved.id, name: saved.name, status: "design", notes: saved.notes });
}

function savedOffsetFromWell(value: OffsetWell, path: string): SavedOffset {
  if (value.provenance !== "user") throw new TypeError(`${path}.provenance must be "user".`);
  if (value.status !== "design") throw new TypeError(`${path}.status must be "design".`);
  if (value.asDrilled.length !== 0) throw new TypeError(`${path}.asDrilled must be empty for a saved user design.`);
  return {
    id: nonEmptyText(value.id, `${path}.id`),
    name: nonEmptyText(value.name, `${path}.name`),
    brief: validateBrief(value.brief, `${path}.brief`),
    notes: list(value.notes, `${path}.notes`).map((note, index) => text(note, `${path}.notes[${index}]`)),
  };
}

export function parseSavedOffsetLibrary(serialized: string | null): readonly OffsetWell[] {
  return loadSavedOffsetLibrary(serialized).offsets;
}

export function loadSavedOffsetLibrary(serialized: string | null): { readonly offsets: readonly OffsetWell[]; readonly migratedDocument: string | null } {
  if (serialized === null) return { offsets: [], migratedDocument: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new TypeError("Saved well library is not valid JSON.", { cause: error });
  }

  let saved: SavedOffset[];
  let isLegacy = false;
  if (Array.isArray(parsed)) {
    isLegacy = true;
    saved = parsed.map((value, index) => savedOffset(value, `legacyOffsets[${index}]`, true));
  } else {
    const document = record(parsed, "savedLibrary", ["version", "offsets"]);
    if (document.version !== 1) throw new TypeError(`Saved well library version ${String(document.version)} is not supported.`);
    saved = list(document.offsets, "savedLibrary.offsets").map((value, index) => savedOffset(value, `savedLibrary.offsets[${index}]`));
  }
  const ids = new Set<string>();
  for (const offset of saved) {
    if (ids.has(offset.id)) throw new TypeError(`Saved well library contains duplicate ID "${offset.id}".`);
    ids.add(offset.id);
  }
  const offsets = saved.map(toOffsetWell);
  return { offsets, migratedDocument: isLegacy ? serializeSavedOffsetLibrary(offsets) : null };
}

export function serializeSavedOffsetLibrary(offsets: readonly OffsetWell[]): string {
  const saved = offsets.filter((offset) => offset.provenance === "user").map((offset, index) => savedOffsetFromWell(offset, `offsets[${index}]`));
  const ids = new Set<string>();
  for (const offset of saved) {
    if (ids.has(offset.id)) throw new TypeError(`Saved well library contains duplicate ID "${offset.id}".`);
    ids.add(offset.id);
  }
  const document: SavedOffsetLibrary = { version: 1, offsets: saved };
  return JSON.stringify(document);
}
