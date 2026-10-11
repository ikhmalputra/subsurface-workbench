/** JSON Schema 2020-12 shapes. Cross-field and binary checks are performed by the runtime validators. */
const text = { type: "string", pattern: "\\S" } as const;
const number = { type: "number" } as const;
const reference = {
  type: "object", additionalProperties: false, required: ["units", "crs", "depthDatum"],
  properties: { units: { const: "m" }, crs: text, depthDatum: text },
} as const;
const depths = { type: "array", minItems: 1, items: { type: "number", minimum: 0 } } as const;

export const wellPathSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Subsurface well path v1",
  type: "object", additionalProperties: false,
  required: ["version", "id", "reference", "points", "measuredDepthsM", "logs"],
  properties: {
    version: { const: 1 }, id: text, reference,
    points: { type: "array", minItems: 2, items: { type: "array", minItems: 3, maxItems: 3, items: number } },
    measuredDepthsM: depths,
    logs: {
      type: "array", items: {
        type: "object", additionalProperties: false, required: ["id", "unit", "depthsMdM", "values"],
        properties: { id: text, unit: text, depthsMdM: depths, values: { type: "array", minItems: 1, items: { type: ["number", "null"] } } },
      },
    },
  },
} as const;

export const seismicVolumeHeaderSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Subsurface seismic volume header v1",
  type: "object", additionalProperties: false,
  required: ["version", "id", "reference", "dimensions", "bounds", "sampleType", "byteOrder", "layout", "amplitude"],
  properties: {
    version: { const: 1 }, id: text, reference,
    dimensions: { type: "array", minItems: 3, maxItems: 3, items: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER } },
    bounds: {
      type: "object", additionalProperties: false, required: ["xMin", "xMax", "yMin", "yMax", "zMin", "zMax"],
      properties: { xMin: number, xMax: number, yMin: number, yMax: number, zMin: number, zMax: number },
    },
    sampleType: { enum: ["float32", "uint8"] }, byteOrder: { const: "little-endian" }, layout: { const: "x-fastest" },
    amplitude: {
      type: "object", additionalProperties: false, required: ["scale", "offset", "unit"],
      properties: { scale: { type: "number", not: { const: 0 } }, offset: number, unit: text },
    },
  },
} as const;
