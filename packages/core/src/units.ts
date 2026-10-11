export type QuantityDimension = "length" | "pressure" | "density" | "time";

export interface Quantity<Dimension extends QuantityDimension, Unit extends string> {
  readonly dimension: Dimension;
  readonly unit: Unit;
  readonly value: number;
}

export type Metres = Quantity<"length", "m">;
export type Feet = Quantity<"length", "ft">;
export type Pascals = Quantity<"pressure", "Pa">;
export type Kilopascals = Quantity<"pressure", "kPa">;
export type Megapascals = Quantity<"pressure", "MPa">;
export type PoundsPerSquareInch = Quantity<"pressure", "psi">;
export type Bar = Quantity<"pressure", "bar">;
export type KilogramsPerCubicMetre = Quantity<"density", "kg/m3">;
export type SpecificGravity = Quantity<"density", "sg">;
export type PoundsPerGallon = Quantity<"density", "ppg">;
export type Seconds = Quantity<"time", "s">;
export type Minutes = Quantity<"time", "min">;
export type Hours = Quantity<"time", "h">;
export type Days = Quantity<"time", "d">;

export type Length = Metres | Feet;
export type Pressure = Pascals | Kilopascals | Megapascals | PoundsPerSquareInch | Bar;
export type Density = KilogramsPerCubicMetre | SpecificGravity | PoundsPerGallon;
export type Duration = Seconds | Minutes | Hours | Days;

const FEET_PER_METRE = 1 / 0.3048;
const PASCALS_PER_PSI = 6_894.757293168;
const KILOGRAMS_PER_CUBIC_METRE_PER_PPG = 0.45359237 / 0.003785411784;
const WATER_DENSITY_KG_PER_CUBIC_METRE = 1_000;

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite.`);
  return value;
}

function quantity<Dimension extends QuantityDimension, Unit extends string>(
  dimension: Dimension,
  unit: Unit,
  value: number,
): Quantity<Dimension, Unit> {
  return Object.freeze({ dimension, unit, value: finite(value, `${dimension} quantity`) });
}

export const metres = (value: number): Metres => quantity("length", "m", value);
export const feet = (value: number): Feet => quantity("length", "ft", value);
export const pascals = (value: number): Pascals => quantity("pressure", "Pa", value);
export const kilopascals = (value: number): Kilopascals => quantity("pressure", "kPa", value);
export const megapascals = (value: number): Megapascals => quantity("pressure", "MPa", value);
export const poundsPerSquareInch = (value: number): PoundsPerSquareInch => quantity("pressure", "psi", value);
export const bar = (value: number): Bar => quantity("pressure", "bar", value);
export const kilogramsPerCubicMetre = (value: number): KilogramsPerCubicMetre => quantity("density", "kg/m3", value);
export const specificGravity = (value: number): SpecificGravity => quantity("density", "sg", value);
export const poundsPerGallon = (value: number): PoundsPerGallon => quantity("density", "ppg", value);
export const seconds = (value: number): Seconds => quantity("time", "s", value);
export const minutes = (value: number): Minutes => quantity("time", "min", value);
export const hours = (value: number): Hours => quantity("time", "h", value);
export const days = (value: number): Days => quantity("time", "d", value);

export function toMetres(value: Length): Metres {
  return metres(value.unit === "m" ? value.value : value.value / FEET_PER_METRE);
}

export function toFeet(value: Length): Feet {
  return feet(value.unit === "ft" ? value.value : value.value * FEET_PER_METRE);
}

export function toPascals(value: Pressure): Pascals {
  switch (value.unit) {
    case "Pa": return pascals(value.value);
    case "kPa": return pascals(value.value * 1_000);
    case "MPa": return pascals(value.value * 1_000_000);
    case "psi": return pascals(value.value * PASCALS_PER_PSI);
    case "bar": return pascals(value.value * 100_000);
  }
}

export function toKilopascals(value: Pressure): Kilopascals {
  return kilopascals(toPascals(value).value / 1_000);
}

export function toMegapascals(value: Pressure): Megapascals {
  return megapascals(toPascals(value).value / 1_000_000);
}

export function toPoundsPerSquareInch(value: Pressure): PoundsPerSquareInch {
  return poundsPerSquareInch(toPascals(value).value / PASCALS_PER_PSI);
}

export function toBar(value: Pressure): Bar {
  return bar(toPascals(value).value / 100_000);
}

export function toKilogramsPerCubicMetre(value: Density): KilogramsPerCubicMetre {
  switch (value.unit) {
    case "kg/m3": return kilogramsPerCubicMetre(value.value);
    case "sg": return kilogramsPerCubicMetre(value.value * WATER_DENSITY_KG_PER_CUBIC_METRE);
    case "ppg": return kilogramsPerCubicMetre(value.value * KILOGRAMS_PER_CUBIC_METRE_PER_PPG);
  }
}

export function toSpecificGravity(value: Density): SpecificGravity {
  return specificGravity(toKilogramsPerCubicMetre(value).value / WATER_DENSITY_KG_PER_CUBIC_METRE);
}

export function toPoundsPerGallon(value: Density): PoundsPerGallon {
  return poundsPerGallon(toKilogramsPerCubicMetre(value).value / KILOGRAMS_PER_CUBIC_METRE_PER_PPG);
}

export function toSeconds(value: Duration): Seconds {
  switch (value.unit) {
    case "s": return seconds(value.value);
    case "min": return seconds(value.value * 60);
    case "h": return seconds(value.value * 3_600);
    case "d": return seconds(value.value * 86_400);
  }
}

export function toHours(value: Duration): Hours {
  return hours(toSeconds(value).value / 3_600);
}

export function toMinutes(value: Duration): Minutes {
  return minutes(toSeconds(value).value / 60);
}

export function toDays(value: Duration): Days {
  return days(toSeconds(value).value / 86_400);
}
