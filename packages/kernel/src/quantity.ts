/**
 * Numbers that carry their unit.
 *
 * Subsurface data arrives in whatever unit its source used: a survey workbook in US survey feet, a
 * drilling report in feet, a mud log in feet, a store in metres. The previous design converted at
 * the point of use, which meant `0.3048` appeared as a bare literal at roughly two dozen call sites
 * under five private names. A conversion written inline is invisible to a reader checking whether a
 * value crossing between two views was converted at all, and there is nothing to grep for when one
 * was missed.
 *
 * So a quantity is a number, a unit and a dimension together, and the dimension is in the type. You
 * cannot add a pressure to a length, you cannot pass feet where metres are expected, and the
 * conversion is one function with one table behind it.
 *
 * Every factor here is exact by definition, not measured: the international foot is 0.3048 m
 * exactly, and the US survey foot is 1200/3937 m exactly. They differ by two parts per million,
 * which is about 7 mm at the bottom of a 3,300 m well — never a disagreement about where the well
 * is, but quoting one with the other's factor misstates a sourced number, and both appear in the
 * same dataset.
 */

export type Dimension = "length" | "pressure" | "density" | "angle" | "duration" | "volume";

export type UnitOf<D extends Dimension> =
  D extends "length" ? "m" | "ft" | "ftUS" | "in"
  : D extends "pressure" ? "Pa" | "kPa" | "MPa" | "psi" | "bar"
  : D extends "density" ? "kg/m3" | "sg" | "ppg"
  : D extends "angle" ? "deg" | "rad"
  : D extends "duration" ? "s" | "min" | "h" | "d"
  : D extends "volume" ? "m3" | "bbl" | "L"
  : never;

/** A number that knows what it measures and in which unit. */
export interface Quantity<D extends Dimension> {
  readonly dimension: D;
  readonly unit: UnitOf<D>;
  readonly value: number;
}

/** Metres per international foot, exact by definition. */
export const METRES_PER_FOOT = 0.3048;
/** Metres per US survey foot, exact by definition: 1200/3937. */
export const METRES_PER_US_SURVEY_FOOT = 1200 / 3937;

/** How many canonical units one of each unit is worth. Canonical: m, Pa, kg/m3, deg, s, m3. */
const FACTOR: Readonly<Record<string, number>> = {
  m: 1, ft: METRES_PER_FOOT, ftUS: METRES_PER_US_SURVEY_FOOT, in: METRES_PER_FOOT / 12,
  Pa: 1, kPa: 1e3, MPa: 1e6, psi: 6894.757293168361, bar: 1e5,
  "kg/m3": 1, sg: 1000, ppg: 119.8264273,
  deg: 1, rad: 180 / Math.PI,
  s: 1, min: 60, h: 3600, d: 86400,
  m3: 1, bbl: 0.158987294928, L: 1e-3,
};

const CANONICAL: Readonly<Record<Dimension, string>> = {
  length: "m", pressure: "Pa", density: "kg/m3", angle: "deg", duration: "s", volume: "m3",
};

const make = <D extends Dimension>(dimension: D) => (value: number, unit: UnitOf<D>): Quantity<D> =>
  ({ dimension, unit, value });

export const length = make("length");
export const pressure = make("pressure");
export const density = make("density");
export const angle = make("angle");
export const duration = make("duration");
export const volume = make("volume");

/** The same quantity in another unit of the same dimension. The type stops a cross-dimension call. */
export function to<D extends Dimension>(quantity: Quantity<D>, unit: UnitOf<D>): Quantity<D> {
  if (quantity.unit === unit) return quantity;
  const from = FACTOR[quantity.unit], into = FACTOR[unit];
  if (from === undefined || into === undefined) throw new RangeError(`No conversion for ${quantity.unit} → ${unit}.`);
  return { dimension: quantity.dimension, unit, value: (quantity.value * from) / into };
}

/** The bare number in a named unit, for the one place that has to hand a number to a renderer. */
export const valueIn = <D extends Dimension>(quantity: Quantity<D>, unit: UnitOf<D>): number => to(quantity, unit).value;

/** The bare number in this dimension's canonical unit: metres, pascals, kg/m³, degrees, seconds, m³. */
export const canonical = <D extends Dimension>(quantity: Quantity<D>): number =>
  valueIn(quantity, CANONICAL[quantity.dimension] as UnitOf<D>);

/** Arithmetic that cannot silently mix units: both sides are converted to the left-hand unit first. */
export const add = <D extends Dimension>(a: Quantity<D>, b: Quantity<D>): Quantity<D> =>
  ({ dimension: a.dimension, unit: a.unit, value: a.value + to(b, a.unit).value });
export const subtract = <D extends Dimension>(a: Quantity<D>, b: Quantity<D>): Quantity<D> =>
  ({ dimension: a.dimension, unit: a.unit, value: a.value - to(b, a.unit).value });
export const compare = <D extends Dimension>(a: Quantity<D>, b: Quantity<D>): number => canonical(a) - canonical(b);

/** How a quantity is written down. Rounding is a display choice and never changes the value. */
export const format = <D extends Dimension>(quantity: Quantity<D>, unit: UnitOf<D>, digits = 1): string =>
  `${valueIn(quantity, unit).toLocaleString("en-US", { maximumFractionDigits: digits })} ${unit}`;
