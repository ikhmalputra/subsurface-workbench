import type { SpatialXYZ } from "./state.ts";
import type { SubsurfaceWellLogCurve } from "./columnar-contracts.ts";

/** Plane in the host's XYZ/metre frame: dot(normal, xyz - origin) = 0. */
export interface SlicePlane {
  readonly origin: SpatialXYZ;
  readonly normal: SpatialXYZ;
}

export interface WellLogStyle {
  readonly curveId: string;
  readonly mode: "color" | "radius" | "color-radius";
  readonly domain: readonly [number, number];
  /** Display-radius multipliers, not physical well diameters. */
  readonly radiusRange: readonly [number, number];
}

export function validateSlicePlane(plane: SlicePlane): SlicePlane {
  for (const v of [plane.origin, plane.normal]) {
    if (!Array.isArray(v) || v.length !== 3 || ![v[0], v[1], v[2]].every(Number.isFinite)) throw new TypeError("Slice vectors must have exactly three finite coordinates.");
  }
  const length = Math.hypot(...plane.normal);
  if (!Number.isFinite(length) || length < 1e-12) throw new RangeError("Slice normal must have finite, non-zero length.");
  const divisor = Math.abs(length - 1) <= 1e-12 ? 1 : length;
  return Object.freeze({
    origin: Object.freeze([...plane.origin] as [number, number, number]),
    normal: Object.freeze(plane.normal.map((v) => v / divisor) as [number, number, number]),
  });
}

export function validateWellLogStyle(style: WellLogStyle): WellLogStyle {
  if (!style.curveId.trim()) throw new TypeError("Log style requires a curve identifier.");
  if (!["color", "radius", "color-radius"].includes(style.mode)) throw new TypeError("Unknown log styling mode.");
  for (const range of [style.domain, style.radiusRange]) {
    if (range.length !== 2 || !range.every(Number.isFinite) || range[1] <= range[0] || !Number.isFinite(range[1] - range[0])) throw new RangeError("Log style ranges require finite increasing endpoints.");
  }
  if (style.radiusRange[0] <= 0 || style.radiusRange[1] > 20) throw new RangeError("Log display radius multipliers must be in (0,20].");
  return Object.freeze({ ...style, domain: Object.freeze([...style.domain] as [number, number]), radiusRange: Object.freeze([...style.radiusRange] as [number, number]) });
}

/** Azimuth of the plane normal clockwise from +Y; tilt 0 = horizontal, 90 = vertical. */
export function slicePlaneFromAngles(origin: SpatialXYZ, azimuthDeg: number, tiltDeg: number): SlicePlane {
  if (![azimuthDeg, tiltDeg].every(Number.isFinite) || tiltDeg < 0 || tiltDeg > 180) throw new RangeError("Plane angles must be finite, tilt in [0,180].");
  const a = azimuthDeg * Math.PI / 180, t = tiltDeg * Math.PI / 180;
  return validateSlicePlane({ origin, normal: [Math.sin(a) * Math.sin(t), Math.cos(a) * Math.sin(t), Math.cos(t)] });
}

/** A vertical curtain through two distinct horizontal locations; no sampling or interpolation is performed. */
export function curtainBetweenWells(a: SpatialXYZ, b: SpatialXYZ): SlicePlane {
  return validateSlicePlane({ origin: a, normal: [b[1] - a[1], a[0] - b[0], 0] });
}

const dot = (a: SpatialXYZ, b: SpatialXYZ) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: SpatialXYZ, b: SpatialXYZ): SpatialXYZ => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: SpatialXYZ, b: SpatialXYZ): SpatialXYZ => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Ordered convex polygon cut through an axis-aligned box. Corner/edge tangencies return an empty polygon. */
export function intersectSliceBox(input: SlicePlane, min: SpatialXYZ, max: SpatialXYZ): readonly SpatialXYZ[] {
  const plane = validateSlicePlane(input);
  if (![...min, ...max].every(Number.isFinite) || min.some((v, i) => max[i]! <= v)) throw new RangeError("Slice box extents must be finite and increasing.");
  const extent = Math.max(...max.map((v, i) => v - min[i]!));
  const epsilon = extent * 1e-9;
  const vertices: SpatialXYZ[] = [];
  for (let i = 0; i < 8; i++) vertices.push([i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);
  const points: SpatialXYZ[] = [];
  const append = (point: SpatialXYZ) => {
    if (!points.some((p) => Math.hypot(...sub(p, point)) < epsilon)) points.push(point);
  };
  for (let i = 0; i < 8; i++) for (const axis of [1, 2, 4]) {
    const j = i ^ axis;
    if (i >= j) continue;
    const a = vertices[i]!, b = vertices[j]!;
    const da = dot(plane.normal, sub(a, plane.origin)), db = dot(plane.normal, sub(b, plane.origin));
    if (Math.abs(da) <= epsilon) append(a);
    if (Math.abs(db) <= epsilon) append(b);
    if ((da < -epsilon && db > epsilon) || (db < -epsilon && da > epsilon)) {
      const t = da / (da - db);
      append([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  if (points.length < 3) return [];
  const centre: SpatialXYZ = [0, 1, 2].map((axis) => points.reduce((sum, p) => sum + p[axis]!, 0) / points.length) as [number, number, number];
  const u = sub(points[0]!, centre), v = cross(plane.normal, u);
  points.sort((a, b) => Math.atan2(dot(sub(a, centre), v), dot(sub(a, centre), u)) - Math.atan2(dot(sub(b, centre), v), dot(sub(b, centre), u)));
  return points;
}

/** Binary-search sampling on explicit MD keys. No extrapolation, interpolation across missing values, or implicit zero. */
export function sampleWellLog(curve: SubsurfaceWellLogCurve, md: number): number | null {
  if (!Number.isFinite(md)) throw new TypeError("Log sample MD must be finite.");
  const depths = curve.depthsMdM;
  if (md < depths[0]! || md > depths[depths.length - 1]!) return null;
  let lo = 0, hi = depths.length - 1;
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (depths[mid]! < md) lo = mid + 1; else hi = mid; }
  const valid = (v: number) => Number.isFinite(v) && v !== curve.nullValue;
  const b = curve.values[lo]!;
  if (depths[lo] === md) return valid(b) ? b : null;
  const a = curve.values[lo - 1]!;
  if (!valid(a) || !valid(b)) return null;
  const value = a + (b - a) * ((md - depths[lo - 1]!) / (depths[lo]! - depths[lo - 1]!));
  if (!Number.isFinite(value)) throw new RangeError("Log interpolation overflow.");
  return value;
}
