import type { SpatialReference } from "./contracts.ts";
import { array, fail, literal, number, object, text } from "./contract-validation.ts";
import type { FloatColumn } from "./columnar-contracts.ts";

export type DatasetKey =
  | { readonly kind: "depth"; readonly unit: "m"; readonly reference: "MD" }
  | { readonly kind: "time"; readonly unit: "unix-ms"; readonly timeZone: "UTC" }
  | { readonly kind: "index"; readonly unit: "sample" };

export interface InteractionDatasetColumn {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly values: FloatColumn;
  /** NaN is a missing value only when nullValue is "nan". */
  readonly nullValue: "nan" | number | null;
}

/** Host-owned columnar observations for linked charts, tables, and spatial views. */
export interface InteractionDataset {
  readonly version: 1;
  readonly id: string;
  readonly assetId: string;
  /** Optional well identity for linking observations to well-specific views. */
  readonly wellId: string | null;
  readonly key: DatasetKey;
  /** Stable, unique row/sample IDs in the same order as keyValues and every column. */
  readonly sampleIds: readonly string[];
  /** MD in metres, UTC Unix epoch milliseconds, or strictly increasing sample indices. */
  readonly keyValues: FloatColumn;
  readonly columns: readonly InteractionDatasetColumn[];
  /** Optional interleaved [X,Y,Z,...] locations in reference frame units; GPU uploads are not zero-copy. */
  readonly reference: SpatialReference | null;
  readonly spatialXYZ: FloatColumn | null;
}

/** JSON transport representation. Convert numeric arrays to typed arrays before rendering. */
export const interactionDatasetSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Linked interaction dataset v1",
  type: "object",
  additionalProperties: false,
  required: ["version", "id", "assetId", "wellId", "key", "sampleIds", "keyValues", "columns", "reference", "spatialXYZ"],
  properties: {
    version: { const: 1 },
    id: { type: "string", minLength: 1, pattern: "\\S" },
    assetId: { type: "string", minLength: 1, pattern: "\\S" },
    wellId: { anyOf: [{ type: "string", minLength: 1, pattern: "\\S" }, { type: "null" }] },
    key: {
      oneOf: [
        { type: "object", additionalProperties: false, required: ["kind", "unit", "reference"], properties: { kind: { const: "depth" }, unit: { const: "m" }, reference: { const: "MD" } } },
        { type: "object", additionalProperties: false, required: ["kind", "unit", "timeZone"], properties: { kind: { const: "time" }, unit: { const: "unix-ms" }, timeZone: { const: "UTC" } } },
        { type: "object", additionalProperties: false, required: ["kind", "unit"], properties: { kind: { const: "index" }, unit: { const: "sample" } } },
      ],
    },
    sampleIds: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1, pattern: "\\S" } },
    keyValues: { type: "array", minItems: 1, items: { type: "number" } },
    columns: {
      type: "array", minItems: 1, items: {
        type: "object", additionalProperties: false,
        required: ["id", "label", "unit", "values", "nullValue"],
        properties: {
          id: { type: "string", minLength: 1, pattern: "\\S" },
          label: { type: "string", minLength: 1, pattern: "\\S" },
          unit: { type: "string", minLength: 1, pattern: "\\S" },
          values: { type: "array", minItems: 1, items: { type: ["number", "null"] } },
          nullValue: { anyOf: [{ const: "nan" }, { type: "number" }, { type: "null" }] },
        },
      },
    },
    reference: {
      anyOf: [
        { type: "object", additionalProperties: false, required: ["units", "crs", "depthDatum"], properties: { units: { const: "m" }, crs: { type: "string", minLength: 1 }, depthDatum: { type: "string", minLength: 1 } } },
        { type: "null" },
      ],
    },
    spatialXYZ: { anyOf: [{ type: "array", minItems: 3, items: { type: "number" }, description: "Flat XYZ triples; length equals sampleIds.length * 3." }, { type: "null" }] },
  },
  allOf: [
    { if: { properties: { key: { properties: { kind: { const: "depth" } } } } }, then: { properties: { keyValues: { items: { minimum: 0 } } } } },
    { if: { properties: { key: { properties: { kind: { const: "time" } } } } }, then: { properties: { keyValues: { items: { type: "integer", minimum: -8640000000000000, maximum: 8640000000000000 } } } } },
    { if: { properties: { key: { properties: { kind: { const: "index" } } } } }, then: { properties: { keyValues: { items: { type: "integer" } } } } },
  ],
} as const;

function floatColumn(value: unknown, path: string, length?: number): FloatColumn {
  if (!(value instanceof Float32Array || value instanceof Float64Array)) fail(path, "expected Float32Array or Float64Array");
  if (length !== undefined && value.length !== length) fail(path, `expected exactly ${length} values`);
  return value;
}

function checkedNullValue(value: unknown, values: FloatColumn, path: string): "nan" | number | null {
  const nullValue = value === "nan" || value === null ? value : number(value, path);
  if (typeof nullValue === "number" && values instanceof Float32Array && Math.fround(nullValue) !== nullValue) {
    fail(path, "sentinel must be exactly representable in the values column");
  }
  for (let index = 0; index < values.length; index += 1) {
    if (nullValue === "nan" && Number.isNaN(values[index])) continue;
    const sample = values[index];
    if (typeof nullValue === "number" && sample === nullValue) continue;
    number(sample, `${path}.values[${index}]`);
  }
  return nullValue;
}

/** Validates alignment and metadata while retaining the caller's typed-array buffers. */
export function validateInteractionDataset(input: unknown): InteractionDataset {
  const value = object(input, "$", ["version", "id", "assetId", "wellId", "key", "sampleIds", "keyValues", "columns", "reference", "spatialXYZ"]);
  const version = literal(value.version, 1, "$.version");
  const id = text(value.id, "$.id");
  const assetId = text(value.assetId, "$.assetId");
  const wellId = value.wellId === null ? null : text(value.wellId, "$.wellId");
  const rawKey = object(value.key, "$.key", value.key && typeof value.key === "object" && "kind" in value.key
    ? value.key.kind === "depth" ? ["kind", "unit", "reference"] : value.key.kind === "time" ? ["kind", "unit", "timeZone"] : ["kind", "unit"]
    : ["kind"]);
  let key: DatasetKey;
  if (rawKey.kind === "depth") key = { kind: "depth", unit: literal(rawKey.unit, "m", "$.key.unit"), reference: literal(rawKey.reference, "MD", "$.key.reference") };
  else if (rawKey.kind === "time") key = { kind: "time", unit: literal(rawKey.unit, "unix-ms", "$.key.unit"), timeZone: literal(rawKey.timeZone, "UTC", "$.key.timeZone") };
  else if (rawKey.kind === "index") key = { kind: "index", unit: literal(rawKey.unit, "sample", "$.key.unit") };
  else fail("$.key.kind", 'expected "depth", "time", or "index"');

  const sampleIds = array(value.sampleIds, "$.sampleIds").map((entry, index) => text(entry, `$.sampleIds[${index}]`));
  if (!sampleIds.length) fail("$.sampleIds", "expected at least one stable sample ID");
  if (new Set(sampleIds).size !== sampleIds.length) fail("$.sampleIds", "sample IDs must be unique");
  const keyValues = floatColumn(value.keyValues, "$.keyValues", sampleIds.length);
  if (key.kind === "time" && !(keyValues instanceof Float64Array)) {
    fail("$.keyValues", "UTC epoch milliseconds require Float64Array precision");
  }
  for (let index = 0; index < keyValues.length; index += 1) {
    const current = number(keyValues[index], `$.keyValues[${index}]`);
    if (key.kind === "depth" && current < 0) fail(`$.keyValues[${index}]`, "measured depth must be non-negative");
    if (key.kind === "time" && (!Number.isSafeInteger(current) || Math.abs(current) > 8.64e15)) fail(`$.keyValues[${index}]`, "UTC Unix milliseconds must be an exact, valid epoch millisecond");
    if (key.kind === "index" && !Number.isSafeInteger(current)) fail(`$.keyValues[${index}]`, "sample index must be a safe integer");
    if (index > 0 && current <= keyValues[index - 1]!) fail(`$.keyValues[${index}]`, "keys must be strictly increasing");
  }

  const rawColumns = array(value.columns, "$.columns");
  if (!rawColumns.length) fail("$.columns", "expected at least one value column");
  const columnIds = new Set<string>();
  const columns = rawColumns.map((entry, index): InteractionDatasetColumn => {
    const path = `$.columns[${index}]`;
    const column = object(entry, path, ["id", "label", "unit", "values", "nullValue"]);
    const columnId = text(column.id, `${path}.id`);
    if (columnIds.has(columnId)) fail(`${path}.id`, "column IDs must be unique");
    columnIds.add(columnId);
    const label = text(column.label, `${path}.label`);
    const unit = text(column.unit, `${path}.unit`);
    const values = floatColumn(column.values, `${path}.values`, sampleIds.length);
    const nullValue = checkedNullValue(column.nullValue, values, path);
    return { id: columnId, label, unit, values, nullValue };
  });

  const reference = value.reference === null ? null : validateSpatialReference(value.reference);
  const spatialXYZ = value.spatialXYZ === null ? null : floatColumn(value.spatialXYZ, "$.spatialXYZ", sampleIds.length * 3);
  if ((reference === null) !== (spatialXYZ === null)) fail("$", "reference and spatialXYZ must either both be supplied or both be null");
  if (spatialXYZ) for (let index = 0; index < spatialXYZ.length; index += 1) number(spatialXYZ[index], `$.spatialXYZ[${index}]`);
  return {
    version, id, assetId, wellId,
    key: Object.freeze(key),
    sampleIds: Object.freeze(sampleIds),
    keyValues,
    columns: Object.freeze(columns.map((column) => Object.freeze(column))),
    reference: reference === null ? null : Object.freeze(reference),
    spatialXYZ,
  };
}

function validateSpatialReference(input: unknown): SpatialReference {
  const value = object(input, "$.reference", ["units", "crs", "depthDatum"]);
  return {
    units: literal(value.units, "m", "$.reference.units"),
    crs: text(value.crs, "$.reference.crs"),
    depthDatum: text(value.depthDatum, "$.reference.depthDatum"),
  };
}
