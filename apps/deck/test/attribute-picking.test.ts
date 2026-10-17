import assert from "node:assert/strict";
import test from "node:test";
import { instantaneous, perTrace } from "@ikhmalputra/subsurface-core/attributes";
import type { SeismicCube } from "@ikhmalputra/subsurface-core";
import { phaseFromBytes, track } from "../src/data/horizon-model.ts";
import { snapToRidge } from "../src/data/fault-model.ts";

/** A cube with one dipping reflector (a Ricker, peak at 100 + 0.25·a samples), dimmed to `dim` over traces 16–27, under seeded noise. */
function cube(dim: number, noise: number) {
  const A = 44, O = 6, S = 220, counts = new Int8Array(A * O * S);
  let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const ricker = (t: number) => { const x = (Math.PI * 0.09 * t) ** 2; return (1 - 2 * x) * Math.exp(-x); };
  for (let o = 0; o < O; o++) for (let a = 0; a < A; a++) {
    const z = 100 + 0.25 * a, amp = a >= 16 && a <= 27 ? dim : 1;
    for (let s = 0; s < S; s++) counts[(s * O + o) * A + a] = Math.max(-127, Math.min(127, Math.round(100 * (amp * ricker(s - z) + 0.4 * ricker(s - 170) + noise * rnd() * 2))));
  }
  const c: SeismicCube = { counts, alongCount: A, offsetCount: O, sampleCount: S, amplitudePerCount: 1, alongFromM: 0, offsetFromM: 0, spacingM: 25 };
  return { c, truth: (a: number) => 100 + 0.25 * a };
}
const phaseOf = (c: SeismicCube) => { const v = perTrace(c, (t) => instantaneous(t).phase); const bytes = new Uint8Array(v.length); for (let i = 0; i < v.length; i++) bytes[i] = Math.round((v[i]! + Math.PI) / (2 * Math.PI) * 255); return phaseFromBytes(bytes, c); };

test("Phase tracking follows a clean reflector as amplitude tracking does, to a fraction of a sample", () => {
  const { c, truth } = cube(1, 0.01), phase = phaseOf(c);
  const opts = { polarity: "peak" as const, search: 3, window: 5, minCorrelation: 0.7 };
  const amp = track(c, { a: 2, o: 2, s: 100 }, opts), ph = track(c, { a: 2, o: 2, s: 100 }, { ...opts, on: "phase" }, undefined, phase);
  for (let a = 0; a < c.alongCount; a++) {
    assert.ok(Math.abs(amp[2 * c.alongCount + a]! - truth(a)) < 0.6, `amplitude at ${a}: ${amp[2 * c.alongCount + a]}`);
    assert.ok(Math.abs(ph[2 * c.alongCount + a]! - truth(a)) < 0.6, `phase at ${a}: ${ph[2 * c.alongCount + a]}`);
  }
});

test("Phase tracking follows a zero crossing, which extremum tracking cannot; through a dim stretch it does no better", () => {
  // The trace is envelope × cos(phase): it is zero where the phase is ±90°. The Ricker's zero crossings are 2.5 samples either side of its peak.
  const { c, truth } = cube(1, 0.01), phase = phaseOf(c);
  const base = { polarity: "peak" as const, search: 3, window: 5, minCorrelation: 0.7, on: "phase" as const };
  const above = track(c, { a: 2, o: 2, s: 97 }, { ...base, phaseDeg: -90 }, undefined, phase), below = track(c, { a: 2, o: 2, s: 103 }, { ...base, phaseDeg: 90 }, undefined, phase);
  const zero = 1 / Math.sqrt(2) / (Math.PI * 0.09);
  for (let a = 0; a < c.alongCount; a++) {
    assert.ok(Math.abs(above[2 * c.alongCount + a]! - (truth(a) - zero)) < 0.5, `above at ${a}: ${above[2 * c.alongCount + a]} vs ${truth(a) - zero}`);
    assert.ok(Math.abs(below[2 * c.alongCount + a]! - (truth(a) + zero)) < 0.5, `below at ${a}`);
  }
  // Dimmed to 12% under noise, neither carries on much further than the other (what the doc comment says, checked).
  const dim = cube(0.12, 0.1), dimPhase = phaseOf(dim.c), opts = { polarity: "peak" as const, search: 3, window: 5, minCorrelation: 0.7 };
  const count = (g: Float32Array) => g.reduce((n, v) => n + (Number.isNaN(v) ? 0 : 1), 0);
  const amp = count(track(dim.c, { a: 2, o: 2, s: 100 }, opts)), ph = count(track(dim.c, { a: 2, o: 2, s: 100 }, { ...opts, on: "phase" }, undefined, dimPhase));
  assert.ok(Math.abs(amp - ph) < 0.1 * amp, `amplitude ${amp}, phase ${ph}`);
});

test("A stick point snaps onto the fault likelihood's ridge, and stays put where there is none", () => {
  const dims = { alongCount: 20, offsetCount: 1, sampleCount: 10 };
  const fl = new Uint8Array(200);
  for (let s = 0; s < 10; s++) { fl[s * 20 + 12] = 230; fl[s * 20 + 13] = 150; fl[s * 20 + 11] = 60; }
  const hit = snapToRidge(fl, dims, 255, 10, 0, 5)!;
  assert.ok(hit.a > 12 && hit.a < 12.5, `${hit.a}`);
  assert.equal(snapToRidge(fl, dims, 255, 3, 0, 5), null, "nothing within reach");
});
