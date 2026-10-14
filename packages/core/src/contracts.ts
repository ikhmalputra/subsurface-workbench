/** Parser-independent input contracts. Coordinates are metres, Z is depth positive down. */
export { wellPathSchema, seismicVolumeHeaderSchema } from "./contract-schemas.ts";
export { ContractValidationError } from "./contract-validation.ts";
export type { ContractIssue } from "./contract-validation.ts";
export * from "./columnar-contracts.ts";
export * from "./petrophysics.ts";
export * from "./petrophysics-analysis.ts";
export * from "./petrophysics-calculations.ts";
export * from "./well-report.ts";
export * from "./dataset.ts";
export * from "./production-surveillance.ts";
export * from "./well-validation.ts";
import { array, fail, literal, number, object, reference, text, triple } from "./contract-validation.ts";

export interface SpatialReference {
  readonly units: "m";
  /** CRS identifier or explicit local-frame description; no coordinate transformation is performed. */
  readonly crs: string;
  readonly depthDatum: string;
}

export interface DepthLog {
  readonly id: string;
  readonly unit: string;
  readonly depthsMdM: readonly number[];
  /** Null explicitly represents missing data. */
  readonly values: readonly (number | null)[];
}

export interface WellPathInput {
  readonly version: 1;
  readonly id: string;
  readonly reference: SpatialReference;
  readonly points: readonly (readonly [number, number, number])[];
  /** MD increases along the path, even when Z decreases or stays constant. */
  readonly measuredDepthsM: readonly number[];
  readonly logs: readonly DepthLog[];
}

export interface SeismicVolumeHeader {
  readonly version: 1;
  readonly id: string;
  readonly reference: SpatialReference;
  readonly dimensions: readonly [number, number, number];
  /** Axis-aligned voxel cell edges, not first/last sample centres. */
  readonly bounds: {
    readonly xMin: number; readonly xMax: number;
    readonly yMin: number; readonly yMax: number;
    readonly zMin: number; readonly zMax: number;
  };
  readonly sampleType: "float32" | "uint8";
  readonly byteOrder: "little-endian";
  readonly layout: "x-fastest";
  /** Physical amplitude = stored sample * scale + offset. */
  readonly amplitude: { readonly scale: number; readonly offset: number; readonly unit: string };
}

export interface SeismicVolumeInput {
  readonly header: SeismicVolumeHeader;
  readonly data: Float32Array | Uint8Array;
}

function depths(value: unknown, path: string): number[] {
  const entries = array(value, path);
  if (!entries.length) fail(path, "expected at least one depth");
  return entries.map((entry, index) => {
    const depth = number(entry, `${path}[${index}]`);
    if (depth < 0) fail(`${path}[${index}]`, "measured depth must be non-negative");
    if (index > 0 && depth <= number(entries[index - 1], `${path}[${index - 1}]`)) fail(`${path}[${index}]`, "depths must be strictly increasing");
    return depth;
  });
}

/** Validate unknown JSON and return an independent, typed snapshot. Throws at the first invalid field. */
export function validateWellPath(value: unknown): WellPathInput {
  const record = object(value, "$", ["version", "id", "reference", "points", "measuredDepthsM", "logs"]);
  const version = literal(record.version, 1, "$.version");
  const id = text(record.id, "$.id");
  const frame = reference(record.reference, "$.reference");
  const points = array(record.points, "$.points").map((point, index) => triple(point, `$.points[${index}]`));
  if (points.length < 2) fail("$.points", "expected at least two spatial points");
  const md = depths(record.measuredDepthsM, "$.measuredDepthsM");
  if (md.length !== points.length) fail("$.measuredDepthsM", "must have one depth per spatial point");
  const ids = new Set<string>();
  const logs = array(record.logs, "$.logs").map((entry, index): DepthLog => {
    const path = `$.logs[${index}]`;
    const log = object(entry, path, ["id", "unit", "depthsMdM", "values"]);
    const logId = text(log.id, `${path}.id`);
    if (ids.has(logId)) fail(`${path}.id`, "duplicate log identifier");
    ids.add(logId);
    const unit = text(log.unit, `${path}.unit`);
    const logDepths = depths(log.depthsMdM, `${path}.depthsMdM`);
    if (logDepths[0]! < md[0]! || logDepths.at(-1)! > md.at(-1)!) fail(`${path}.depthsMdM`, "log depths must be within the measured-depth interval");
    const values = array(log.values, `${path}.values`).map((sample, at) => sample === null ? null : number(sample, `${path}.values[${at}]`));
    if (values.length !== logDepths.length) fail(`${path}.values`, "must have one value per log depth");
    return { id: logId, unit, depthsMdM: logDepths, values };
  });
  return { version, id, reference: frame, points, measuredDepthsM: md, logs };
}

export function validateSeismicVolumeHeader(value: unknown): SeismicVolumeHeader {
  const record = object(value, "$", ["version", "id", "reference", "dimensions", "bounds", "sampleType", "byteOrder", "layout", "amplitude"]);
  const version = literal(record.version, 1, "$.version");
  const id = text(record.id, "$.id");
  const frame = reference(record.reference, "$.reference");
  const dimensions = triple(record.dimensions, "$.dimensions");
  dimensions.forEach((count, index) => { if (!Number.isSafeInteger(count) || count < 1) fail(`$.dimensions[${index}]`, "expected a positive safe integer"); });
  if (!Number.isSafeInteger(dimensions[0] * dimensions[1] * dimensions[2])) fail("$.dimensions", "voxel count exceeds safe integer precision");
  const b = object(record.bounds, "$.bounds", ["xMin", "xMax", "yMin", "yMax", "zMin", "zMax"]);
  const bounds = { xMin: number(b.xMin, "$.bounds.xMin"), xMax: number(b.xMax, "$.bounds.xMax"), yMin: number(b.yMin, "$.bounds.yMin"), yMax: number(b.yMax, "$.bounds.yMax"), zMin: number(b.zMin, "$.bounds.zMin"), zMax: number(b.zMax, "$.bounds.zMax") };
  for (const axis of ["x", "y", "z"] as const) {
    const span = bounds[`${axis}Max`] - bounds[`${axis}Min`];
    if (!(span > 0) || !Number.isFinite(span)) fail(`$.bounds.${axis}Max`, "must exceed the minimum with a finite extent");
  }
  const sampleType = record.sampleType;
  if (sampleType !== "float32" && sampleType !== "uint8") fail("$.sampleType", 'expected "float32" or "uint8"');
  const a = object(record.amplitude, "$.amplitude", ["scale", "offset", "unit"]);
  const scale = number(a.scale, "$.amplitude.scale");
  if (scale === 0) fail("$.amplitude.scale", "must be non-zero");
  return { version, id, reference: frame, dimensions, bounds, sampleType, byteOrder: literal(record.byteOrder, "little-endian", "$.byteOrder"), layout: literal(record.layout, "x-fastest", "$.layout"), amplitude: { scale, offset: number(a.offset, "$.amplitude.offset"), unit: text(a.unit, "$.amplitude.unit") } };
}

/** Validate an already decoded typed array without copying its voxel storage. */
export function validateSeismicVolume(headerValue: unknown, data: unknown): SeismicVolumeInput {
  const header = validateSeismicVolumeHeader(headerValue);
  if (!(data instanceof Float32Array || data instanceof Uint8Array)) fail("$.data", "expected Float32Array or Uint8Array");
  if (header.sampleType === "float32" ? !(data instanceof Float32Array) : !(data instanceof Uint8Array)) fail("$.data", "typed array does not match header sampleType");
  const count = header.dimensions[0] * header.dimensions[1] * header.dimensions[2];
  if (data.length !== count) fail("$.data", `expected ${count} samples, received ${data.length}`);
  for (let index = 0; index < data.length; index += 1) {
    const sample = data[index]!;
    if (!Number.isFinite(sample) || !Number.isFinite(sample * header.amplitude.scale + header.amplitude.offset)) fail(`$.data[${index}]`, "sample and scaled amplitude must be finite");
  }
  return { header, data };
}

/** Read raw contract bytes, not SEG-Y. Explicit little-endian decoding works on any host. */
export function seismicVolumeFromBuffer(headerValue: unknown, buffer: ArrayBuffer): SeismicVolumeInput {
  const header = validateSeismicVolumeHeader(headerValue);
  const count = header.dimensions[0] * header.dimensions[1] * header.dimensions[2];
  const expectedBytes = count * (header.sampleType === "float32" ? 4 : 1);
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== expectedBytes) fail("$.data", `expected exactly ${expectedBytes} bytes`);
  if (header.sampleType === "uint8") return validateSeismicVolume(header, new Uint8Array(buffer));
  const view = new DataView(buffer);
  const samples = new Float32Array(count);
  for (let index = 0; index < count; index += 1) samples[index] = view.getFloat32(index * 4, true);
  return validateSeismicVolume(header, samples);
}
