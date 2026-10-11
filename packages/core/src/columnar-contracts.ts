import type { SeismicVolumeInput, SpatialReference } from "./contracts.ts";
import { validateSeismicVolume } from "./contracts.ts";
import { array, fail, literal, number, object, reference, text } from "./contract-validation.ts";
export { wellboreTrajectorySchema, wellLogCurveSchema, blenderGeomHorizonSchema } from "./columnar-schemas.ts";

export type FloatColumn = Float32Array | Float64Array;

export interface SubsurfaceWellboreTrajectory {
  readonly version: 1;
  readonly id: string;
  readonly reference: SpatialReference;
  /** Interleaved [X0,Y0,Z0,X1,Y1,Z1,...], metres, Z positive down. Preserve Float64 projected coordinates until origin rebasing. */
  readonly xyz: FloatColumn;
  /** Station i uses xyz[3*i..3*i+2] and each of the following columns at index i. */
  readonly depthsMdM: FloatColumn;
  readonly inclinationsDeg: FloatColumn;
  /** Degrees clockwise from reference north, in [0,360). Inclination is [0,180] from down vertical. */
  readonly azimuthsDeg: FloatColumn;
}

export interface SubsurfaceWellLogCurve {
  readonly version: 1;
  readonly id: string;
  readonly wellId: string;
  readonly unit: string;
  readonly depthsMdM: FloatColumn;
  /** One float per depth. Validators retain these buffers; GPU uploads still copy to device memory. */
  readonly values: FloatColumn;
  /** NaN is accepted only when nullValue === "nan"; infinities are never accepted. */
  readonly nullValue: "nan" | number | null;
}

/** Existing cube protocol: x-fastest, positive-down Z, cell-edge bounds, sample * scale + offset. */
export type SubsurfaceSeismicVoxelCube = SeismicVolumeInput;

export interface BlenderVertexAttribute {
  /** Blender/glTF custom vertex semantic, e.g. "_POROSITY" (not a standard attribute). */
  readonly semantic: string;
  readonly layer: string;
  readonly shaderInput: string;
  readonly itemSize: 1 | 2 | 3 | 4;
  readonly domain: readonly [number, number];
}

export interface BlenderGeomHorizon {
  readonly version: 1;
  readonly id: string;
  readonly reference: SpatialReference;
  readonly format: "glb" | "gltf";
  readonly source: string;
  /** Column-major affine matrix from glTF Y-up mesh space into reference XYZ/Z-down; includes axis and unit conversion. */
  readonly meshToWorld: readonly number[];
  readonly attributes: readonly BlenderVertexAttribute[];
}

function floats(value: unknown, path: string): FloatColumn {
  if (!(value instanceof Float32Array || value instanceof Float64Array)) fail(path, "expected Float32Array or Float64Array");
  return value;
}
function mdColumn(value: unknown, path: string, minimum: number): FloatColumn {
  const column = floats(value, path);
  if (column.length < minimum) fail(path, `expected at least ${minimum} samples`);
  for (let i = 0; i < column.length; i++) {
    const md = number(column[i], `${path}[${i}]`);
    if (md < 0 || (i > 0 && md <= column[i - 1]!)) fail(`${path}[${i}]`, "MD must be non-negative and strictly increasing");
  }
  return column;
}
function matchingColumn(value: unknown, path: string, count: number): FloatColumn {
  const column = floats(value, path);
  if (column.length !== count) fail(path, `expected exactly ${count} samples`);
  return column;
}

/** Strict metadata checks and aligned column validation; retains the exact caller-owned typed arrays. */
export function validateWellboreTrajectory(value: unknown): SubsurfaceWellboreTrajectory {
  const r = object(value, "$", ["version", "id", "reference", "xyz", "depthsMdM", "inclinationsDeg", "azimuthsDeg"]);
  const version = literal(r.version, 1, "$.version");
  const id = text(r.id, "$.id");
  const frame = reference(r.reference, "$.reference");
  const md = mdColumn(r.depthsMdM, "$.depthsMdM", 2);
  const xyz = matchingColumn(r.xyz, "$.xyz", md.length * 3);
  for (let i = 0; i < xyz.length; i++) number(xyz[i], `$.xyz[${i}]`);
  const inclinations = matchingColumn(r.inclinationsDeg, "$.inclinationsDeg", md.length);
  const azimuths = matchingColumn(r.azimuthsDeg, "$.azimuthsDeg", md.length);
  for (let i = 0; i < md.length; i++) {
    const inclination = number(inclinations[i], `$.inclinationsDeg[${i}]`);
    const azimuth = number(azimuths[i], `$.azimuthsDeg[${i}]`);
    if (inclination < 0 || inclination > 180) fail(`$.inclinationsDeg[${i}]`, "expected degrees in [0,180]");
    if (azimuth < 0 || azimuth >= 360) fail(`$.azimuthsDeg[${i}]`, "expected degrees in [0,360)");
  }
  return { version, id, reference: frame, xyz, depthsMdM: md, inclinationsDeg: inclinations, azimuthsDeg: azimuths };
}

export function validateWellLogCurve(value: unknown): SubsurfaceWellLogCurve {
  const r = object(value, "$", ["version", "id", "wellId", "unit", "depthsMdM", "values", "nullValue"]);
  const version = literal(r.version, 1, "$.version");
  const id = text(r.id, "$.id"), wellId = text(r.wellId, "$.wellId"), unit = text(r.unit, "$.unit");
  const md = mdColumn(r.depthsMdM, "$.depthsMdM", 1);
  const values = matchingColumn(r.values, "$.values", md.length);
  const nullValue = r.nullValue === "nan" || r.nullValue === null ? r.nullValue : number(r.nullValue, "$.nullValue");
  if (typeof nullValue === "number" && values instanceof Float32Array && Math.fround(nullValue) !== nullValue) fail("$.nullValue", "sentinel must be exactly representable in the values column");
  for (let i = 0; i < values.length; i++) {
    if (nullValue === "nan" && Number.isNaN(values[i])) continue;
    number(values[i], `$.values[${i}]`);
  }
  return { version, id, wellId, unit, depthsMdM: md, values, nullValue };
}

export function validateSeismicVoxelCube(value: unknown): SubsurfaceSeismicVoxelCube {
  const r = object(value, "$", ["header", "data"]);
  return validateSeismicVolume(r.header, r.data);
}

export function validateBlenderGeomHorizon(value: unknown): BlenderGeomHorizon {
  const r = object(value, "$", ["version", "id", "reference", "format", "source", "meshToWorld", "attributes"]);
  const version = literal(r.version, 1, "$.version"), id = text(r.id, "$.id");
  const frame = reference(r.reference, "$.reference");
  if (r.format !== "glb" && r.format !== "gltf") fail("$.format", 'expected "glb" or "gltf"');
  const source = text(r.source, "$.source");
  const matrix = array(r.meshToWorld, "$.meshToWorld").map((entry, i) => number(entry, `$.meshToWorld[${i}]`));
  if (matrix.length !== 16) fail("$.meshToWorld", "expected 16 column-major matrix entries");
  if (matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1) fail("$.meshToWorld", "expected an affine matrix");
  const determinant = matrix[0]! * (matrix[5]! * matrix[10]! - matrix[9]! * matrix[6]!) - matrix[4]! * (matrix[1]! * matrix[10]! - matrix[9]! * matrix[2]!) + matrix[8]! * (matrix[1]! * matrix[6]! - matrix[5]! * matrix[2]!);
  if (!Number.isFinite(determinant) || determinant === 0) fail("$.meshToWorld", "mesh transform must be invertible");
  const semantics = new Set<string>(), shaderInputs = new Set<string>();
  const attributes = array(r.attributes, "$.attributes").map((entry, i): BlenderVertexAttribute => {
    const path = `$.attributes[${i}]`;
    const a = object(entry, path, ["semantic", "layer", "shaderInput", "itemSize", "domain"]);
    const semantic = text(a.semantic, `${path}.semantic`);
    if (!/^_[A-Z][A-Z0-9_]*$/.test(semantic)) fail(`${path}.semantic`, "expected a glTF custom semantic such as _POROSITY");
    const shaderInput = text(a.shaderInput, `${path}.shaderInput`);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(shaderInput)) fail(`${path}.shaderInput`, "expected a shader attribute identifier");
    if (semantics.has(semantic) || shaderInputs.has(shaderInput)) fail(path, "duplicate semantic or shader input");
    semantics.add(semantic); shaderInputs.add(shaderInput);
    const itemSize = a.itemSize;
    if (itemSize !== 1 && itemSize !== 2 && itemSize !== 3 && itemSize !== 4) fail(`${path}.itemSize`, "expected 1, 2, 3 or 4");
    const domain = array(a.domain, `${path}.domain`);
    if (domain.length !== 2) fail(`${path}.domain`, "expected two range endpoints");
    const low = number(domain[0], `${path}.domain[0]`), high = number(domain[1], `${path}.domain[1]`);
    if (high <= low || !Number.isFinite(high - low)) fail(`${path}.domain`, "maximum must exceed minimum with a finite extent");
    return { semantic, layer: text(a.layer, `${path}.layer`), shaderInput, itemSize, domain: [low, high] };
  });
  return { version, id, reference: frame, format: r.format, source, meshToWorld: matrix, attributes };
}
