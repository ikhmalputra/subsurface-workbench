import { wellPathSchema } from "./contract-schemas.ts";

const text = { type: "string", pattern: "\\S" } as const;
const floats = { type: "array", minItems: 1, items: { type: "number" } } as const;
const md = { ...floats, items: { type: "number", minimum: 0 } } as const;

/** JSON transport shapes use ordinary arrays. Convert them to typed columns before runtime validation. */
export const wellboreTrajectorySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Columnar wellbore trajectory v1",
  type: "object", additionalProperties: false,
  required: ["version", "id", "reference", "xyz", "depthsMdM", "inclinationsDeg", "azimuthsDeg"],
  properties: {
    version: { const: 1 }, id: text, reference: wellPathSchema.properties.reference,
    xyz: { ...floats, minItems: 6 }, depthsMdM: { ...md, minItems: 2 },
    inclinationsDeg: { ...floats, minItems: 2, items: { type: "number", minimum: 0, maximum: 180 } },
    azimuthsDeg: { ...floats, minItems: 2, items: { type: "number", minimum: 0, exclusiveMaximum: 360 } },
  },
} as const;

export const wellLogCurveSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Columnar well log transport v1",
  type: "object", additionalProperties: false,
  required: ["version", "id", "wellId", "unit", "depthsMdM", "values", "nullValue"],
  properties: {
    version: { const: 1 }, id: text, wellId: text, unit: text, depthsMdM: md,
    // JSON cannot encode NaN; a host converts null samples to NaN when nullValue is "nan".
    values: { type: "array", minItems: 1, items: { type: ["number", "null"] } },
    nullValue: { anyOf: [{ const: "nan" }, { type: "number" }, { type: "null" }] },
  },
  allOf: [{
    if: { properties: { nullValue: { not: { const: "nan" } } } },
    then: { properties: { values: floats } },
  }],
} as const;

export const blenderGeomHorizonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Blender geological horizon v1",
  type: "object", additionalProperties: false,
  required: ["version", "id", "reference", "format", "source", "meshToWorld", "attributes"],
  properties: {
    version: { const: 1 }, id: text, reference: wellPathSchema.properties.reference,
    format: { enum: ["glb", "gltf"] }, source: text,
    meshToWorld: { type: "array", minItems: 16, maxItems: 16, items: { type: "number" } },
    attributes: {
      type: "array", items: {
        type: "object", additionalProperties: false,
        required: ["semantic", "layer", "shaderInput", "itemSize", "domain"],
        properties: {
          semantic: { type: "string", pattern: "^_[A-Z][A-Z0-9_]*$" }, layer: text,
          shaderInput: { type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_]*$" },
          itemSize: { enum: [1, 2, 3, 4] }, domain: { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } },
        },
      },
    },
  },
} as const;
