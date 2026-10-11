import { array, fail, literal, number, object, text } from "./contract-validation.ts";
import type { FloatColumn } from "./columnar-contracts.ts";

export interface PetrophysicsDepthReference {
  readonly kind: "MD";
  readonly unit: "m";
  readonly datum: string;
}

/** Missing values must be explicit. A numeric value is a raw-data sentinel, never a physical sample. */
export type PetrophysicsNullValue = "nan" | number | null;

export interface PetrophysicsLogCurve {
  readonly version: 1;
  readonly id: string;
  readonly wellId: string;
  readonly mnemonic: string;
  readonly name: string;
  readonly unit: string;
  readonly depthReference: PetrophysicsDepthReference;
  /** One strictly increasing MD value per sample, in metres. */
  readonly depthsMdM: FloatColumn;
  /** One raw sample per depth. NaN is permitted only when nullValue is "nan". */
  readonly values: FloatColumn;
  readonly nullValue: PetrophysicsNullValue;
}

export interface PetrophysicsZone {
  readonly id: string;
  readonly name: string;
  readonly topMdM: number;
  readonly baseMdM: number;
  readonly lithology: string;
  readonly color: string;
}

export interface PetrophysicsFormationTop {
  readonly id: string;
  readonly name: string;
  readonly mdM: number;
}

export interface PetrophysicsCorePoint {
  readonly id: string;
  readonly mdM: number;
  readonly label: string;
  readonly description: string | null;
  readonly measurements?: readonly PetrophysicsCoreMeasurement[];
}

export interface PetrophysicsCoreMeasurement {
  readonly id: string;
  readonly mnemonic: string;
  readonly value: number | null;
  readonly unit: string;
}

export interface PetrophysicsWell {
  readonly version: 1;
  readonly wellId: string;
  readonly depthReference: PetrophysicsDepthReference;
  readonly provenance: "documented" | "synthetic" | "user-authored";
  readonly curves: readonly PetrophysicsLogCurve[];
  readonly zones: readonly PetrophysicsZone[];
  readonly tops: readonly PetrophysicsFormationTop[];
  readonly corePoints: readonly PetrophysicsCorePoint[];
}

export interface PetrophysicsTrackCutoff {
  readonly id: string;
  readonly value: number;
  readonly side: "above" | "below";
  readonly color: string;
  readonly label: string;
}

export interface PetrophysicsTrackSpec {
  readonly curveId: string;
  readonly label?: string;
  readonly color: string;
  readonly min: number;
  readonly max: number;
  readonly fill?: "none" | "left" | "right";
  readonly cutoff?: PetrophysicsTrackCutoff;
}

export interface PetrophysicsTrackTemplate {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly tracks: readonly PetrophysicsTrackSpec[];
}

export function petrophysicsValueAt(curve: PetrophysicsLogCurve, index: number): number | null {
  if (!Number.isSafeInteger(index) || index < 0 || index >= curve.values.length) return null;
  const value = curve.values[index]!;
  if (Number.isNaN(value) && curve.nullValue === "nan") return null;
  if (curve.nullValue !== null && curve.nullValue !== "nan" && value === curve.nullValue) return null;
  return value;
}

function floats(value: unknown, path: string): FloatColumn {
  if (!(value instanceof Float32Array || value instanceof Float64Array)) fail(path, "expected Float32Array or Float64Array");
  return value;
}

function depthReference(value: unknown, path: string): PetrophysicsDepthReference {
  const record = object(value, path, ["kind", "unit", "datum"]);
  return {
    kind: literal(record.kind, "MD", `${path}.kind`),
    unit: literal(record.unit, "m", `${path}.unit`),
    datum: text(record.datum, `${path}.datum`),
  };
}

function nullValue(value: unknown, path: string): PetrophysicsNullValue {
  if (value === "nan" || value === null) return value;
  return number(value, path);
}

function color(value: unknown, path: string): string {
  const result = text(value, path);
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(result)) fail(path, "expected a CSS hex color such as #abc or #aabbcc");
  return result;
}

function validateCurve(value: unknown, path: string, wellId: string, reference: PetrophysicsDepthReference): PetrophysicsLogCurve {
  const r = object(value, path, ["version", "id", "wellId", "mnemonic", "name", "unit", "depthReference", "depthsMdM", "values", "nullValue"]);
  const version = literal(r.version, 1, `${path}.version`);
  const id = text(r.id, `${path}.id`);
  const curveWellId = text(r.wellId, `${path}.wellId`);
  if (curveWellId !== wellId) fail(`${path}.wellId`, "must match the containing wellId");
  const mnemonic = text(r.mnemonic, `${path}.mnemonic`);
  const name = text(r.name, `${path}.name`);
  const unit = text(r.unit, `${path}.unit`);
  const curveReference = depthReference(r.depthReference, `${path}.depthReference`);
  if (curveReference.datum !== reference.datum) fail(`${path}.depthReference.datum`, "must match the containing well depth datum");
  const depthsMdM = floats(r.depthsMdM, `${path}.depthsMdM`);
  const values = floats(r.values, `${path}.values`);
  if (depthsMdM.length === 0) fail(`${path}.depthsMdM`, "expected at least one sample");
  if (values.length !== depthsMdM.length) fail(`${path}.values`, `expected exactly ${depthsMdM.length} samples`);
  for (let i = 0; i < depthsMdM.length; i++) {
    const md = number(depthsMdM[i], `${path}.depthsMdM[${i}]`);
    if (md < 0 || (i > 0 && md <= depthsMdM[i - 1]!)) fail(`${path}.depthsMdM[${i}]`, "MD must be non-negative and strictly increasing");
  }
  const sentinel = nullValue(r.nullValue, `${path}.nullValue`);
  if (typeof sentinel === "number" && values instanceof Float32Array && Math.fround(sentinel) !== sentinel) {
    fail(`${path}.nullValue`, "sentinel must be exactly representable in the values column");
  }
  for (let i = 0; i < values.length; i++) {
    if (sentinel === "nan" && Number.isNaN(values[i])) continue;
    const sample = number(values[i], `${path}.values[${i}]`);
    if (typeof sentinel === "number" && sample === sentinel) continue;
  }
  return { version, id, wellId: curveWellId, mnemonic, name, unit, depthReference: curveReference, depthsMdM, values, nullValue: sentinel };
}

/** Validates the parser-independent petrophysics contract without copying curve or depth columns. */
export function validatePetrophysicsWell(value: unknown): PetrophysicsWell {
  const r = object(value, "$", ["version", "wellId", "depthReference", "provenance", "curves", "zones", "tops", "corePoints"]);
  const version = literal(r.version, 1, "$.version");
  const wellId = text(r.wellId, "$.wellId");
  const reference = depthReference(r.depthReference, "$.depthReference");
  const provenance = r.provenance;
  if (provenance !== "documented" && provenance !== "synthetic" && provenance !== "user-authored") fail("$.provenance", "expected documented, synthetic, or user-authored");
  const curves = array(r.curves, "$.curves").map((curve, index) => validateCurve(curve, `$.curves[${index}]`, wellId, reference));
  const zones = array(r.zones, "$.zones").map((zone, index): PetrophysicsZone => {
    const path = `$.zones[${index}]`;
    const z = object(zone, path, ["id", "name", "topMdM", "baseMdM", "lithology", "color"]);
    const id = text(z.id, `${path}.id`);
    const name = text(z.name, `${path}.name`);
    const topMdM = number(z.topMdM, `${path}.topMdM`);
    const baseMdM = number(z.baseMdM, `${path}.baseMdM`);
    if (topMdM < 0 || baseMdM <= topMdM) fail(`${path}.baseMdM`, "zone base must be greater than non-negative top MD");
    return { id, name, topMdM, baseMdM, lithology: text(z.lithology, `${path}.lithology`), color: color(z.color, `${path}.color`) };
  });
  const tops = array(r.tops, "$.tops").map((top, index): PetrophysicsFormationTop => {
    const path = `$.tops[${index}]`;
    const t = object(top, path, ["id", "name", "mdM"]);
    const mdM = number(t.mdM, `${path}.mdM`);
    if (mdM < 0) fail(`${path}.mdM`, "top MD must be non-negative");
    return { id: text(t.id, `${path}.id`), name: text(t.name, `${path}.name`), mdM };
  });
  const corePoints = array(r.corePoints, "$.corePoints").map((point, index): PetrophysicsCorePoint => {
    const path = `$.corePoints[${index}]`;
    const hasMeasurements = typeof point === "object" && point !== null && Object.hasOwn(point, "measurements");
    const c = object(point, path, ["id", "mdM", "label", "description", ...(hasMeasurements ? ["measurements"] : [])]);
    const mdM = number(c.mdM, `${path}.mdM`);
    if (mdM < 0) fail(`${path}.mdM`, "core point MD must be non-negative");
    const measurements = c.measurements === undefined ? undefined : array(c.measurements, `${path}.measurements`).map((measurement, measurementIndex): PetrophysicsCoreMeasurement => {
      const measurementPath = `${path}.measurements[${measurementIndex}]`;
      const m = object(measurement, measurementPath, ["id", "mnemonic", "value", "unit"]);
      return {
        id: text(m.id, `${measurementPath}.id`),
        mnemonic: text(m.mnemonic, `${measurementPath}.mnemonic`),
        value: m.value === null ? null : number(m.value, `${measurementPath}.value`),
        unit: text(m.unit, `${measurementPath}.unit`),
      };
    });
    if (measurements) {
      const measurementIds = new Set<string>();
      for (let measurementIndex = 0; measurementIndex < measurements.length; measurementIndex++) {
        const measurementId = measurements[measurementIndex]!.id;
        if (measurementIds.has(measurementId)) fail(`${path}.measurements[${measurementIndex}].id`, "duplicate identifier");
        measurementIds.add(measurementId);
      }
    }
    return {
      id: text(c.id, `${path}.id`), mdM, label: text(c.label, `${path}.label`),
      description: c.description === null ? null : text(c.description, `${path}.description`),
      ...(measurements === undefined ? {} : { measurements }),
    };
  });
  for (const [path, entities] of [["$.curves", curves], ["$.zones", zones], ["$.tops", tops], ["$.corePoints", corePoints]] as const) {
    const ids = new Set<string>();
    for (let i = 0; i < entities.length; i++) {
      const id = entities[i]!.id;
      if (ids.has(id)) fail(`${path}[${i}].id`, "duplicate identifier");
      ids.add(id);
    }
  }
  return { version, wellId, depthReference: reference, provenance, curves, zones, tops, corePoints };
}

/** JSON Schema describes JSON arrays; convert numeric columns to typed arrays before calling the validator. */
export const petrophysicsWellSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Petrophysics well v1",
  type: "object",
  additionalProperties: false,
  required: ["version", "wellId", "depthReference", "provenance", "curves", "zones", "tops", "corePoints"],
  properties: {
    version: { const: 1 },
    wellId: { type: "string", minLength: 1 },
    depthReference: {
      type: "object", additionalProperties: false, required: ["kind", "unit", "datum"],
      properties: { kind: { const: "MD" }, unit: { const: "m" }, datum: { type: "string", minLength: 1 } },
    },
    provenance: { enum: ["documented", "synthetic", "user-authored"] },
    curves: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["version", "id", "wellId", "mnemonic", "name", "unit", "depthReference", "depthsMdM", "values", "nullValue"],
        properties: {
          version: { const: 1 }, id: { type: "string", minLength: 1 }, wellId: { type: "string", minLength: 1 },
          mnemonic: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 }, unit: { type: "string", minLength: 1 },
          depthReference: { $ref: "#/properties/depthReference" },
          depthsMdM: { type: "array", minItems: 1, items: { type: "number", minimum: 0 } },
          values: { type: "array", minItems: 1, items: { type: ["number", "null"] } },
          nullValue: { anyOf: [{ const: "nan" }, { type: "number" }, { type: "null" }] },
        },
      },
    },
    zones: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["id", "name", "topMdM", "baseMdM", "lithology", "color"],
        properties: { id: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 }, topMdM: { type: "number", minimum: 0 }, baseMdM: { type: "number", exclusiveMinimum: 0 }, lithology: { type: "string", minLength: 1 }, color: { type: "string", pattern: "^#(?:[A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$" } },
      },
    },
    tops: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["id", "name", "mdM"],
        properties: { id: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 }, mdM: { type: "number", minimum: 0 } },
      },
    },
    corePoints: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["id", "mdM", "label", "description"],
        properties: {
          id: { type: "string", minLength: 1 }, mdM: { type: "number", minimum: 0 }, label: { type: "string", minLength: 1 }, description: { type: ["string", "null"] },
          measurements: {
            type: "array", items: {
              type: "object", additionalProperties: false, required: ["id", "mnemonic", "value", "unit"],
              properties: { id: { type: "string", minLength: 1 }, mnemonic: { type: "string", minLength: 1 }, value: { type: ["number", "null"] }, unit: { type: "string", minLength: 1 } },
            },
          },
        },
      },
    },
  },
} as const;

function validateTrackSpec(value: unknown, path: string): PetrophysicsTrackSpec {
  const has = (key: string) => typeof value === "object" && value !== null && Object.hasOwn(value, key);
  const optional = ["label", "fill", "cutoff"].filter(has);
  const record = object(value, path, ["curveId", "color", "min", "max", ...optional]);
  const min = number(record.min, `${path}.min`);
  const max = number(record.max, `${path}.max`);
  if (max <= min) fail(`${path}.max`, "track maximum must be greater than minimum");
  const fill = record.fill === undefined ? undefined : record.fill;
  if (fill !== undefined && fill !== "none" && fill !== "left" && fill !== "right") fail(`${path}.fill`, "expected none, left, or right");
  let cutoff: PetrophysicsTrackCutoff | undefined;
  if (record.cutoff !== undefined) {
    const c = object(record.cutoff, `${path}.cutoff`, ["id", "value", "side", "color", "label"]);
    const side = c.side;
    if (side !== "above" && side !== "below") fail(`${path}.cutoff.side`, "expected above or below");
    cutoff = {
      id: text(c.id, `${path}.cutoff.id`),
      value: number(c.value, `${path}.cutoff.value`),
      side,
      color: color(c.color, `${path}.cutoff.color`),
      label: text(c.label, `${path}.cutoff.label`),
    };
  }
  return {
    curveId: text(record.curveId, `${path}.curveId`),
    ...(record.label === undefined ? {} : { label: text(record.label, `${path}.label`) }),
    color: color(record.color, `${path}.color`),
    min,
    max,
    ...(fill === undefined ? {} : { fill }),
    ...(cutoff === undefined ? {} : { cutoff }),
  };
}

/** Validates a JSON-serializable display template; persistence remains host-owned. */
export function validatePetrophysicsTrackTemplate(value: unknown): PetrophysicsTrackTemplate {
  const record = object(value, "$", ["version", "id", "name", "tracks"]);
  const tracks = array(record.tracks, "$.tracks").map((track, index) => validateTrackSpec(track, `$.tracks[${index}]`));
  if (tracks.length === 0) fail("$.tracks", "expected at least one configured track");
  const curveIds = new Set<string>();
  for (let index = 0; index < tracks.length; index++) {
    const curveId = tracks[index]!.curveId;
    if (curveIds.has(curveId)) fail(`$.tracks[${index}].curveId`, "duplicate track curve identifier");
    curveIds.add(curveId);
  }
  return {
    version: literal(record.version, 1, "$.version"),
    id: text(record.id, "$.id"),
    name: text(record.name, "$.name"),
    tracks,
  };
}

export const petrophysicsTrackTemplateSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Petrophysics track template v1",
  type: "object",
  additionalProperties: false,
  required: ["version", "id", "name", "tracks"],
  properties: {
    version: { const: 1 },
    id: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    tracks: {
      type: "array", minItems: 1, items: {
        type: "object", additionalProperties: false, required: ["curveId", "color", "min", "max"],
        properties: {
          curveId: { type: "string", minLength: 1 }, label: { type: "string", minLength: 1 },
          color: { type: "string", pattern: "^#(?:[A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$" },
          min: { type: "number" }, max: { type: "number" }, fill: { enum: ["none", "left", "right"] },
          cutoff: {
            type: "object", additionalProperties: false, required: ["id", "value", "side", "color", "label"],
            properties: {
              id: { type: "string", minLength: 1 }, value: { type: "number" }, side: { enum: ["above", "below"] },
              color: { type: "string", pattern: "^#(?:[A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$" }, label: { type: "string", minLength: 1 },
            },
          },
        },
      },
    },
  },
} as const;
