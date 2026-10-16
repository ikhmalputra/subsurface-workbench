import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SeismicCube } from "@ikhmalputra/subsurface-core";
import { coverage, depthColour, snap, track } from "../src/data/horizon-model.ts";

/** A cube with one dipping reflector: a Ricker peak at sample 40 + 0.1·along + 0.05·offset. */
function dipping(na = 40, no = 20, ns = 120): SeismicCube {
  const counts = new Int8Array(na * no * ns);
  for (let a = 0; a < na; a++) for (let o = 0; o < no; o++) {
    const centre = 40 + 0.1 * a + 0.05 * o;
    for (let s = 0; s < ns; s++) { const x = (s - centre) / 2.5; counts[(s * no + o) * na + a] = Math.round(100 * (1 - 2 * x * x) * Math.exp(-x * x)); }
  }
  return { counts, alongCount: na, offsetCount: no, sampleCount: ns, amplitudePerCount: 0.01, alongFromM: 0, offsetFromM: 0, spacingM: 25 };
}

test("a seed snaps to the nearest peak, to a fraction of a sample", () => {
  const cube = dipping();
  const s = snap(cube, 10, 4, 39, "peak")!;
  assert.ok(Math.abs(s - (40 + 1 + 0.2)) < 0.15, `snapped to ${s}`);
  // A trough lies either side of a Ricker peak, not on it.
  assert.ok(Math.abs(snap(cube, 10, 4, 41, "trough")! - 41.2) > 1);
});

test("tracking follows a dipping reflector across the whole cube", () => {
  const cube = dipping();
  const grid = track(cube, { a: 5, o: 5, s: 41 });
  assert.equal(coverage(grid), 1);
  for (const [a, o] of [[0, 0], [39, 19], [20, 10]] as const) assert.ok(Math.abs(grid[o * 40 + a]! - (40 + 0.1 * a + 0.05 * o)) < 0.25, `at ${a},${o}: ${grid[o * 40 + a]}`);
});

test("tracking stops where the reflector stops", () => {
  const cube = dipping();
  // Wipe out the reflector beyond along bin 25: nothing there to follow.
  for (let a = 26; a < 40; a++) for (let o = 0; o < 20; o++) for (let s = 0; s < 120; s++) cube.counts[(s * 20 + o) * 40 + a] = 0;
  const grid = track(cube, { a: 5, o: 5, s: 41 });
  assert.ok(Math.abs(coverage(grid) - 26 / 40) < 1e-9);
  assert.ok(Number.isNaN(grid[30]!));
});

test("on the FORGE PSDM, a strong reflector tracks over most of the volume", () => {
  const meta = JSON.parse(readFileSync(new URL("../../../packages/core/src/forge-seismic.json", import.meta.url), "utf8")) as { subVolume: { file: string; alongCount: number; offsetCount: number; samples: number; amplitudePerCount: number; alongFromM: number; offsetFromM: number; spacingM: number } };
  const cut = meta.subVolume;
  const bytes = readFileSync(new URL(`../../../packages/fixtures/data/${cut.file}`, import.meta.url));
  const cube: SeismicCube = { counts: new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), alongCount: cut.alongCount, offsetCount: cut.offsetCount, sampleCount: cut.samples, amplitudePerCount: cut.amplitudePerCount, alongFromM: cut.alongFromM, offsetFromM: cut.offsetFromM, spacingM: cut.spacingM };
  // At 58-32 the strongest PSDM event near the granite contact is a peak at about 1,225 m (sample 245).
  const grid = track(cube, { a: 66, o: 38, s: 245 });
  assert.ok(coverage(grid) > 0.5, `coverage ${coverage(grid)}`);
  assert.ok(Math.abs(grid[38 * cut.alongCount + 66]! - 245) < 2);
  assert.deepEqual(depthColour(0).map((v) => Math.round(v * 100)), [99, 84, 35]);
});
