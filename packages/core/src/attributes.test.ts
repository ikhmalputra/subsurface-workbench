import assert from "node:assert/strict";
import test from "node:test";
import { dips, faultLikelihood, instantaneous, rms, semblance } from "./attributes.ts";
import type { SeismicCube } from "./seismic.ts";

const near = (actual: number, expected: number, tolerance: number, what: string) => assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} vs ${expected} ± ${tolerance}`);

/** A cube of reflectors: depth sample of the event at each trace from `surface`, a Ricker-ish wavelet, as int8 counts. */
function cube(na: number, no: number, ns: number, surface: (a: number, o: number) => number, period = 12): SeismicCube {
  const counts = new Int8Array(na * no * ns);
  for (let s = 0; s < ns; s++) for (let o = 0; o < no; o++) for (let a = 0; a < na; a++) {
    const shift = surface(a, o);
    counts[(s * no + o) * na + a] = Math.round(100 * Math.cos(2 * Math.PI * (s - shift) / period));
  }
  return { counts, alongCount: na, offsetCount: no, sampleCount: ns, amplitudePerCount: 1, alongFromM: 0, offsetFromM: 0, spacingM: 25 };
}
const at = (c: SeismicCube, v: ArrayLike<number>, a: number, o: number, s: number) => v[(s * c.offsetCount + o) * c.alongCount + a]!;

test("instantaneous attributes: a cosine's envelope is flat, its phase advances 2πf a sample, its frequency is f", () => {
  const f = 1 / 16, n = 256, trace = Float32Array.from({ length: n }, (_, i) => 3 * Math.cos(2 * Math.PI * f * i));
  const { envelope, phase, frequency } = instantaneous(trace);
  for (let i = 40; i < n - 40; i += 7) { near(envelope[i]!, 3, 0.05, `envelope at ${i}`); near(frequency[i]!, f, 0.002, `frequency at ${i}`); }
  const step = Math.atan2(Math.sin(phase[101]! - phase[100]!), Math.cos(phase[101]! - phase[100]!));
  near(step, 2 * Math.PI * f, 1e-3, "phase step");
  near(rms(Float32Array.from({ length: 400 }, (_, i) => 2 * Math.sin(i / 3)), 60)[200]!, 2 / Math.SQRT2, 0.02, "RMS of a sine");
});

test("dip from the structure tensor: a dipping reflector's dip within a degree", () => {
  // 0.4 samples per trace along, −0.25 across: 25 m traces, 5 m samples, so 4.6° and 2.9°.
  const c = cube(24, 20, 160, (a, o) => 0.4 * a - 0.25 * o);
  const { pa, po } = dips(c);
  near(at(c, pa, 12, 10, 80), 0.4, 0.04, "dip along"); near(at(c, po, 12, 10, 80), -0.25, 0.04, "dip across");
  const deg = (p: number) => Math.atan(p * 5 / 25) * 180 / Math.PI;
  assert.ok(Math.abs(deg(at(c, pa, 12, 10, 80)) - deg(0.4)) < 1);
});

test("semblance holds on continuous beds, drops across a fault, and dip steering keeps dipping beds coherent", () => {
  // A fault at along 12: everything beyond it is thrown 5 samples down.
  const faulted = cube(24, 12, 120, (a) => (a >= 12 ? 5 : 0));
  const sem = semblance(faulted, 4);
  assert.ok(at(faulted, sem, 5, 6, 60) > 0.97, `${at(faulted, sem, 5, 6, 60)} away from the fault`);
  assert.ok(at(faulted, sem, 12, 6, 60) < 0.8, `${at(faulted, sem, 12, 6, 60)} at the fault`);
  // Fault likelihood peaks on the fault's trace.
  const fl = faultLikelihood(faulted, sem);
  assert.ok(at(faulted, fl, 12, 6, 60) > 0.5 && at(faulted, fl, 4, 6, 60) < 0.1, `${at(faulted, fl, 12, 6, 60)} / ${at(faulted, fl, 4, 6, 60)}`);
  // Steeply dipping but unbroken beds: plain semblance reads them as broken, dip-steered does not.
  const dipping = cube(20, 12, 160, (a) => 1.2 * a);
  const plain = semblance(dipping, 4), steered = semblance(dipping, 4, dips(dipping));
  assert.ok(at(dipping, steered, 10, 6, 80) > 0.95 && at(dipping, plain, 10, 6, 80) < 0.85, `steered ${at(dipping, steered, 10, 6, 80)} plain ${at(dipping, plain, 10, 6, 80)}`);
});
