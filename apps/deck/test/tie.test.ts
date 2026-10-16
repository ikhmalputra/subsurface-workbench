import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bestFit, correlation, impedance, onSeismic, reflectivity, ricker, synthetic, twoWayTime } from "../src/data/tie-model.ts";

/** A two-layer earth: slow, light rock over fast, dense rock at sample 200 of 400, 0.5 m apart. */
const n = 400, tvd = Float64Array.from({ length: n }, (_, k) => 1000 + k * 0.5);
const dt = Float64Array.from({ length: n }, (_, k) => k < 200 ? 80 : 60);
const rho = Float64Array.from({ length: n }, (_, k) => k < 200 ? 2.45 : 2.65);

test("impedance, reflectivity and time from the logs, in their units", () => {
  const ai = impedance(dt, rho);
  // 2.45 g/cm³ at 80 µs/ft: 2450 kg/m³ × 3810 m/s.
  assert.ok(Math.abs(ai[0]! - 2450 * 0.3048e6 / 80) < 1e-6);
  const r = reflectivity(ai);
  assert.ok(r[200]! > 0.15 && r[200]! < 0.2, `r ${r[200]}`);
  assert.equal(r[100], 0);
  // 100 µs/ft over 304.8 m is 0.1 s one way.
  const t = twoWayTime([0, 304.8], [100, 100]);
  assert.ok(Math.abs(t[1]! - 0.2) < 1e-12);
  // A gap in the sonic is bridged, not a jump in time.
  const bridged = twoWayTime([0, 1, 2], [100, NaN, 100]);
  assert.ok(Math.abs(bridged[2]! - 2 * 2 * 100e-6 / 0.3048) < 1e-12);
});

test("the synthetic peaks at the interface, positive where impedance rises, and the wavelet is zero phase", () => {
  const w = ricker(30, 0.001);
  assert.equal(w[(w.length - 1) / 2], 1);
  const syn = synthetic(reflectivity(impedance(dt, rho)), twoWayTime(tvd, dt), 30);
  const peak = syn.reduce((best, value, k) => Math.abs(value) > Math.abs(syn[best]!) ? k : best, 0);
  assert.ok(Math.abs(peak - 200) <= 1, `peak at ${peak}`);
  assert.ok(syn[peak]! > 0);
  assert.ok(synthetic(reflectivity(impedance(dt, rho)), twoWayTime(tvd, dt), 30, -1)[peak]! < 0);
});

test("the best fit finds a known shift and stretch", () => {
  const syn = synthetic(reflectivity(impedance(dt, rho)), twoWayTime(tvd, dt), 30);
  const at = Float64Array.from({ length: 80 }, (_, s) => 950 + s * 5);
  const seismic = onSeismic(syn, tvd, at, { shiftM: 23, stretch: 1.02 });
  const fit = bestFit(syn, tvd, seismic, at);
  assert.equal(fit.shiftM, 23);
  assert.ok(Math.abs(fit.stretch - 1.02) < 0.006, `stretch ${fit.stretch}`);
  assert.ok(fit.r > 0.99);
  assert.ok(Number.isNaN(correlation([1, 2], [1, 2])), "too few pairs to score");
});

test("at 58-32 the strongest reflection in the logs is the granite contact", () => {
  const file = JSON.parse(readFileSync(new URL("../../../packages/fixtures/data/forge-58-32-tie.json", import.meta.url), "utf8")) as { topMdM: number; stepM: number; curves: Record<string, { values: (number | null)[] }> };
  const v = (name: string) => Float64Array.from(file.curves[name]!.values, (value) => value ?? NaN);
  const r = reflectivity(impedance(v("DTCO"), v("RHOZ")));
  // Smoothed over 10 m, the way a seismic wavelet sees it.
  const smooth = Float64Array.from(r, (_, k) => { let s = 0; for (let j = -10; j <= 10; j++) s += r[k + j] ?? 0; return s; });
  const strongest = smooth.reduce((best, value, k) => value > smooth[best]! ? k : best, 0);
  const md = file.topMdM + strongest * file.stepM;
  // Sonic falls from about 80 to 59 µs/ft and density rises from 2.48 to 2.65 g/cm³ between 3,400 and 3,600 ft.
  assert.ok(md > 3400 * 0.3048 && md < 3650 * 0.3048, `strongest at ${md} m MD`);
});
