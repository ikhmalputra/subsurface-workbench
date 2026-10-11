import assert from "node:assert/strict";
import test from "node:test";
import {
  bar, days, feet, hours, kilogramsPerCubicMetre, kilopascals, megapascals, metres, minutes,
  pascals, poundsPerGallon, poundsPerSquareInch, seconds, specificGravity, toBar,
  toDays, toFeet, toHours, toKilogramsPerCubicMetre, toKilopascals, toMegapascals,
  toMetres, toMinutes, toPascals, toPoundsPerGallon, toPoundsPerSquareInch,
  toSeconds, toSpecificGravity,
} from "./units.ts";

function close(actual: number, expected: number, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test("length conversions preserve explicit units and round-trip metre/foot values", () => {
  assert.equal(toMetres(feet(100)).unit, "m");
  close(toMetres(feet(100)).value, 30.48, 1e-12);
  close(toFeet(metres(30.48)).value, 100);
  close(toMetres(metres(12)).value, 12);
  close(toFeet(feet(12)).value, 12);
});

test("pressure conversions use explicit absolute pressure units and round-trip", () => {
  close(toPascals(poundsPerSquareInch(14.6959488)).value, 101325, 0.001);
  close(toPoundsPerSquareInch(pascals(101325)).value, 14.6959488, 1e-7);
  close(toPascals(kilopascals(100)).value, 100_000);
  close(toPascals(megapascals(1)).value, 1_000_000);
  close(toPascals(bar(1)).value, 100_000);
  close(toKilopascals(poundsPerSquareInch(1)).value, 6.894757293168);
  close(toMegapascals(bar(1)).value, 0.1);
  close(toBar(kilopascals(250)).value, 2.5);
});

test("density conversions distinguish specific gravity, mass density, and pounds per gallon", () => {
  close(toKilogramsPerCubicMetre(specificGravity(1.2)).value, 1200);
  close(toSpecificGravity(kilogramsPerCubicMetre(1200)).value, 1.2);
  close(toKilogramsPerCubicMetre(poundsPerGallon(8.345)).value, 8.345 * 0.45359237 / 0.003785411784);
  close(toPoundsPerGallon(kilogramsPerCubicMetre(1000)).value, 1000 * 0.003785411784 / 0.45359237);
  close(toSpecificGravity(poundsPerGallon(8.345)).value, (8.345 * 0.45359237 / 0.003785411784) / 1000);
});

test("time conversions use seconds as the canonical duration", () => {
  close(toSeconds(minutes(2.5)).value, 150);
  close(toSeconds(hours(1.5)).value, 5400);
  close(toSeconds(days(2)).value, 172800);
  close(toMinutes(hours(1.5)).value, 90);
  close(toHours(minutes(90)).value, 1.5);
  close(toDays(hours(48)).value, 2);
  close(toSeconds(seconds(4)).value, 4);
});

test("quantity constructors and conversions reject non-finite values", () => {
  assert.throws(() => metres(Number.NaN), /must be finite/);
  assert.throws(() => toPascals(poundsPerSquareInch(Infinity)), /must be finite/);
  assert.throws(() => kilogramsPerCubicMetre(-Infinity), /must be finite/);
  assert.throws(() => minutes(Number.POSITIVE_INFINITY), /must be finite/);
});
