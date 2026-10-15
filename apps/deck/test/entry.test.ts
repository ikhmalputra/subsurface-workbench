import assert from "node:assert/strict";
import test from "node:test";
import { readStations } from "../src/data/entry.ts";

test("a pasted spreadsheet: tabs, a header naming the columns in its own order, feet", () => {
  const read = readStations("Azimuth\tMD (ft)\tInc\n0\t0\t0\n55.82\t1,892.0\t1.36\n71.72\t1986\t1.27\n", "ft");
  assert.deepEqual(read.columns, { md: 1, inc: 2, azi: 0, fromHeader: true });
  assert.equal(read.headerUnit, "ft");
  assert.equal(read.stations.length, 3);
  assert.ok(Math.abs(read.stations[1]!.mdM - 1892 * 0.3048) < 1e-9);
  assert.equal(read.stations[1]!.azimuthDeg, 55.82);
  assert.deepEqual(read.problems, []);
});

test("CSV and space-separated text with thousands separators read alike", () => {
  const csv = readStations("md,inc,azi\n0,0,0\n1000,2.5,90\n", "m");
  const text = readStations("TieIn 0 0 0\nMWD  1,000.0   2.50   90.00 \n", "m");
  assert.deepEqual(csv.stations, [{ mdM: 0, inclinationDeg: 0, azimuthDeg: 0 }, { mdM: 1000, inclinationDeg: 2.5, azimuthDeg: 90 }]);
  assert.deepEqual(text.stations, csv.stations, "a label before the numbers is a cell like any other");
});

test("lines that are not stations are listed, not dropped silently; bad stations are named", () => {
  const read = readStations("Survey report\nMD Inc Azi\n0 0 0\n500 1 400\n400 2 10\nend of file\n", "m");
  assert.equal(read.stations.length, 3);
  assert.deepEqual(read.skipped.map((entry) => entry.line), [1, 6]);
  assert.ok(read.problems.some((problem) => /azimuth 400/.test(problem)));
  assert.ok(read.problems.some((problem) => /does not deepen/.test(problem)));
});
