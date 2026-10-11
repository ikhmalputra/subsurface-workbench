import { feet, toMetres } from "./units.ts";
import type { SpatialXYZ } from "./state.ts";

export type CoordinateFrameId = string;

export interface CoordinateFrame {
  readonly id: CoordinateFrameId;
  readonly crs: string;
  readonly lengthUnit: "m" | "ft";
  readonly verticalDatum: string;
  readonly verticalDirection: "up" | "down";
}

/** Column-major affine matrix mapping source-frame coordinates into target-frame coordinates. */
export type AffineTransform3 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

const IDENTITY: AffineTransform3 = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);
const MATRIX_TOLERANCE = 1e-10;

function checkedFrame(frame: CoordinateFrame): CoordinateFrame {
  if (!frame.id.trim() || !frame.crs.trim() || !frame.verticalDatum.trim()) {
    throw new TypeError("Coordinate frame id, CRS, and vertical datum must be non-empty.");
  }
  if (frame.lengthUnit !== "m" && frame.lengthUnit !== "ft") {
    throw new TypeError("Coordinate frame length unit must be m or ft.");
  }
  if (frame.verticalDirection !== "up" && frame.verticalDirection !== "down") {
    throw new TypeError("Coordinate frame vertical direction must be up or down.");
  }
  return Object.freeze({ ...frame });
}

function checkedMatrix(input: readonly number[]): AffineTransform3 {
  if (input.length !== 16 || !input.every(Number.isFinite)) {
    throw new TypeError("Affine transforms require exactly 16 finite column-major values.");
  }
  if (
    Math.abs(input[3]!) > MATRIX_TOLERANCE
    || Math.abs(input[7]!) > MATRIX_TOLERANCE
    || Math.abs(input[11]!) > MATRIX_TOLERANCE
    || Math.abs(input[15]! - 1) > MATRIX_TOLERANCE
  ) {
    throw new TypeError("Coordinate transforms must be affine, with final row [0, 0, 0, 1].");
  }
  const matrix = Object.freeze([...input]) as AffineTransform3;
  invert(matrix);
  return matrix;
}

function invert(matrix: AffineTransform3): AffineTransform3 {
  const magnitude = Math.max(
    Math.abs(matrix[0]!), Math.abs(matrix[4]!), Math.abs(matrix[8]!),
    Math.abs(matrix[1]!), Math.abs(matrix[5]!), Math.abs(matrix[9]!),
    Math.abs(matrix[2]!), Math.abs(matrix[6]!), Math.abs(matrix[10]!),
  );
  if (magnitude === 0) throw new RangeError("Coordinate transform must have an invertible spatial component.");
  const a = matrix[0]! / magnitude, b = matrix[4]! / magnitude, c = matrix[8]! / magnitude;
  const d = matrix[1]! / magnitude, e = matrix[5]! / magnitude, f = matrix[9]! / magnitude;
  const g = matrix[2]! / magnitude, h = matrix[6]! / magnitude, i = matrix[10]! / magnitude;
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= Number.EPSILON * 16) {
    throw new RangeError("Coordinate transform must have an invertible spatial component.");
  }
  const r = 1 / (determinant * magnitude);
  const i00 = (e * i - f * h) * r;
  const i01 = (c * h - b * i) * r;
  const i02 = (b * f - c * e) * r;
  const i10 = (f * g - d * i) * r;
  const i11 = (a * i - c * g) * r;
  const i12 = (c * d - a * f) * r;
  const i20 = (d * h - e * g) * r;
  const i21 = (b * g - a * h) * r;
  const i22 = (a * e - b * d) * r;
  const x = matrix[12]!, y = matrix[13]!, z = matrix[14]!;
  const result: AffineTransform3 = [
    i00, i10, i20, 0,
    i01, i11, i21, 0,
    i02, i12, i22, 0,
    -(i00 * x + i01 * y + i02 * z),
    -(i10 * x + i11 * y + i12 * z),
    -(i20 * x + i21 * y + i22 * z),
    1,
  ];
  if (!result.every(Number.isFinite)) throw new RangeError("Inverse coordinate transform must remain finite.");
  return Object.freeze(result);
}

function multiply(a: AffineTransform3, b: AffineTransform3): AffineTransform3 {
  const result = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let k = 0; k < 4; k += 1) {
        result[column * 4 + row]! += a[k * 4 + row]! * b[column * 4 + k]!;
      }
    }
  }
  return checkedMatrix(result);
}

function approximatelyEqual(a: AffineTransform3, b: AffineTransform3): boolean {
  return a.every((value, index) => Math.abs(value - b[index]!) <= MATRIX_TOLERANCE * Math.max(1, Math.abs(value), Math.abs(b[index]!)));
}

function point(matrix: AffineTransform3, xyz: SpatialXYZ): SpatialXYZ {
  if (xyz.length !== 3 || !xyz.every(Number.isFinite)) {
    throw new TypeError("Spatial coordinates must contain exactly three finite values.");
  }
  const [x, y, z] = xyz;
  const result: SpatialXYZ = [
    matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
    matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
    matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
  ];
  if (!result.every(Number.isFinite)) throw new RangeError("Coordinate transform produced non-finite coordinates.");
  return result;
}

export class CoordinateFrameRegistry {
  readonly #frames = new Map<CoordinateFrameId, CoordinateFrame>();
  readonly #edges = new Map<CoordinateFrameId, Map<CoordinateFrameId, AffineTransform3>>();

  registerFrame(input: CoordinateFrame): void {
    const frame = checkedFrame(input);
    const existing = this.#frames.get(frame.id);
    if (existing && (
      existing.crs !== frame.crs
      || existing.lengthUnit !== frame.lengthUnit
      || existing.verticalDatum !== frame.verticalDatum
      || existing.verticalDirection !== frame.verticalDirection
    )) {
      throw new Error(`Coordinate frame "${frame.id}" is already registered with different metadata.`);
    }
    if (existing) return;
    this.#frames.set(frame.id, frame);
    this.#edges.set(frame.id, new Map());
  }

  getFrame(id: CoordinateFrameId): CoordinateFrame {
    const frame = this.#frames.get(id);
    if (!frame) throw new Error(`Coordinate frame "${id}" is not registered.`);
    return frame;
  }

  registerTransform(from: CoordinateFrameId, to: CoordinateFrameId, input: AffineTransform3): void {
    this.getFrame(from);
    this.getFrame(to);
    if (from === to) throw new Error("A transform must connect two different coordinate frames.");
    const transform = checkedMatrix(input);
    const existingPath = this.#resolve(from, to);
    if (existingPath && !approximatelyEqual(existingPath, transform)) {
      throw new Error(`Transform "${from}" to "${to}" conflicts with the existing frame path.`);
    }
    this.#edges.get(from)!.set(to, transform);
    this.#edges.get(to)!.set(from, invert(transform));
  }

  getTransform(from: CoordinateFrameId, to: CoordinateFrameId): AffineTransform3 {
    this.getFrame(from);
    this.getFrame(to);
    const matrix = this.#resolve(from, to);
    if (!matrix) throw new Error(`No registered transform connects "${from}" to "${to}".`);
    return matrix;
  }

  transformPoint(xyz: SpatialXYZ, from: CoordinateFrameId, to: CoordinateFrameId): SpatialXYZ {
    return point(this.getTransform(from, to), xyz);
  }

  /** Transforms a plane normal as a covector; nonuniform scale is handled correctly. */
  transformNormal(normal: SpatialXYZ, from: CoordinateFrameId, to: CoordinateFrameId): SpatialXYZ {
    if (normal.length !== 3 || !normal.every(Number.isFinite)) {
      throw new TypeError("Plane normal must contain exactly three finite values.");
    }
    const inverse = invert(this.getTransform(from, to));
    const [x, y, z] = normal;
    const transformed: SpatialXYZ = [
      inverse[0]! * x + inverse[1]! * y + inverse[2]! * z,
      inverse[4]! * x + inverse[5]! * y + inverse[6]! * z,
      inverse[8]! * x + inverse[9]! * y + inverse[10]! * z,
    ];
    const length = Math.hypot(...transformed);
    if (!Number.isFinite(length) || length < 1e-15) {
      throw new RangeError("Coordinate transform produced a degenerate plane normal.");
    }
    return [transformed[0] / length, transformed[1] / length, transformed[2] / length];
  }

  /** Converts numeric coordinates to metres only; CRS, datum and axis transforms remain explicit. */
  pointInMetres(xyz: SpatialXYZ, frameId: CoordinateFrameId): SpatialXYZ {
    const frame = this.getFrame(frameId);
    const coordinates = point(IDENTITY, xyz);
    if (frame.lengthUnit === "m") return coordinates;
    return [
      toMetres(feet(coordinates[0])).value,
      toMetres(feet(coordinates[1])).value,
      toMetres(feet(coordinates[2])).value,
    ];
  }

  #resolve(from: CoordinateFrameId, to: CoordinateFrameId): AffineTransform3 | null {
    if (from === to) return IDENTITY;
    const queue: { id: CoordinateFrameId; transform: AffineTransform3 }[] = [{ id: from, transform: IDENTITY }];
    const visited = new Set([from]);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor]!;
      for (const [next, edge] of this.#edges.get(current.id) ?? []) {
        if (visited.has(next)) continue;
        const transform = multiply(edge, current.transform);
        if (next === to) return transform;
        visited.add(next);
        queue.push({ id: next, transform });
      }
    }
    return null;
  }
}
