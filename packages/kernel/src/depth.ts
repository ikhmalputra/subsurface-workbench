import { type Quantity, type UnitOf, canonical, length, to } from "./quantity.ts";

/**
 * Depths, and the fact that there are several kinds of them.
 *
 * Measured depth is distance along the hole. True vertical depth is distance straight down.
 * Elevation is height above a datum, counted the other way. They are all lengths, so the previous
 * design held them all as plain numbers and relied on variable names — `mdM`, `tvdM`, `topTvdM` —
 * to keep them apart. That works until two of them meet: a cursor at 1,558 m MD is not at 1,558 m
 * TVD in any deviated well, and the only thing stopping a view from treating one as the other was
 * someone reading the name carefully.
 *
 * Here the kind is in the type. A `Depth<"md">` cannot be passed where a `Depth<"tvd">` is wanted,
 * and getting from one to the other requires a trajectory, which is the only thing that knows the
 * relationship. That conversion lives in the calculation layer, not here: this module's job is to
 * make the distinction unforgettable, not to do the geometry.
 *
 * A depth also names the datum it is counted from. Two wells measured from their own rotary tables
 * are not comparable without reconciling those, and a field that mixes a seabed wellhead with a
 * rig floor has to say so rather than quietly subtract.
 */

export type DepthKind = "md" | "tvd" | "elevation";

export interface Depth<K extends DepthKind> {
  readonly kind: K;
  readonly along: Quantity<"length">;
  /** What this is counted from: "RKB", "MSL", "ground", a seabed wellhead. Never assumed. */
  readonly datum: string;
}

const depth = <K extends DepthKind>(kind: K) =>
  (value: number, unit: UnitOf<"length">, datum: string): Depth<K> => ({ kind, along: length(value, unit), datum });

/** Distance along the hole from the datum. */
export const md = depth("md");
/** Distance straight down from the datum. */
export const tvd = depth("tvd");
/** Height above the datum, counted upward. */
export const elevation = depth("elevation");

export const metres = (depth: Depth<DepthKind>): number => canonical(depth.along);
export const feet = (depth: Depth<DepthKind>): number => to(depth.along, "ft").value;

/**
 * Two depths are comparable only when they are the same kind and counted from the same datum.
 * Everything that subtracts, sorts or windows depths goes through this first, so a comparison
 * across datums fails loudly instead of returning a number nobody can interpret.
 */
export function comparable(a: Depth<DepthKind>, b: Depth<DepthKind>): boolean {
  return a.kind === b.kind && a.datum === b.datum;
}

export function requireComparable(a: Depth<DepthKind>, b: Depth<DepthKind>): void {
  if (a.kind !== b.kind) throw new TypeError(`Cannot compare ${a.kind} with ${b.kind}: they measure different things.`);
  if (a.datum !== b.datum) throw new TypeError(`Cannot compare depths from "${a.datum}" and "${b.datum}" without reconciling the datums.`);
}

/** Difference along the same axis, from the same datum. Throws rather than guess. */
export function between<K extends DepthKind>(a: Depth<K>, b: Depth<K>): Quantity<"length"> {
  requireComparable(a, b);
  return length(metres(b) - metres(a), "m");
}

/** An interval of one kind of depth: a casing run, a hole section, a zone, a visible window. */
export interface Interval<K extends DepthKind> {
  readonly top: Depth<K>;
  readonly base: Depth<K>;
}

export function interval<K extends DepthKind>(top: Depth<K>, base: Depth<K>): Interval<K> {
  requireComparable(top, base);
  // An interval whose base is above its top would draw upward, so it is refused at construction
  // rather than discovered by a renderer.
  if (metres(base) < metres(top)) throw new RangeError(`An interval cannot end above it starts: ${metres(top)} to ${metres(base)}.`);
  return { top, base };
}

export const thickness = <K extends DepthKind>(span: Interval<K>): Quantity<"length"> => between(span.top, span.base);
export const contains = <K extends DepthKind>(span: Interval<K>, at: Depth<K>): boolean => {
  requireComparable(span.top, at);
  return metres(at) >= metres(span.top) && metres(at) <= metres(span.base);
};
export const overlaps = <K extends DepthKind>(a: Interval<K>, b: Interval<K>): boolean => {
  requireComparable(a.top, b.top);
  return metres(a.top) <= metres(b.base) && metres(b.top) <= metres(a.base);
};
