import { dips, faultLikelihood, instantaneous, percentile, perTrace, rms, semblance, toBytes } from "@ikhmalputra/subsurface-core/attributes";
import type { SeismicCube } from "@ikhmalputra/subsurface-core";

/**
 * Attribute volumes in the compute worker, as bytes 0–255 with the values the ends stand for. The
 * worker keeps what it has made (one cube in the deck), so changing back to an attribute is instant;
 * coherence takes a couple of seconds the first time, the rest well under one.
 */
export type AttributeName = "envelope" | "phase" | "frequency" | "rms" | "coherence" | "fault";
const made = new Map<string, { bytes: Uint8Array; lo: number; hi: number }>();
let steering: ReturnType<typeof dips> | null = null, sem: Float32Array | null = null, cubeKey = "";

export function attribute(name: AttributeName, counts: Int8Array, dims: { alongCount: number; offsetCount: number; sampleCount: number }) {
  const key = `${counts.length}:${dims.alongCount}x${dims.offsetCount}x${dims.sampleCount}`;
  if (key !== cubeKey) { made.clear(); steering = null; sem = null; cubeKey = key; }
  const hit = made.get(name);
  if (hit) return { ...hit, bytes: hit.bytes.slice() };
  const cube: SeismicCube = { counts, ...dims, amplitudePerCount: 1, alongFromM: 0, offsetFromM: 0, spacingM: 25 };
  let v: Float32Array, lo: number, hi: number;
  if (name === "envelope") { v = perTrace(cube, (t) => instantaneous(t).envelope); lo = 0; hi = percentile(v, 0.99); }
  else if (name === "phase") { v = perTrace(cube, (t) => instantaneous(t).phase); lo = -Math.PI; hi = Math.PI; }
  else if (name === "frequency") { v = perTrace(cube, (t) => instantaneous(t).frequency); lo = 0; hi = percentile(v, 0.98); }
  else if (name === "rms") { v = perTrace(cube, (t) => rms(t, 6)); lo = 0; hi = percentile(v, 0.99); }
  else {
    steering ??= dips(cube);
    sem ??= semblance(cube, 4, steering);
    if (name === "coherence") { v = sem; lo = percentile(sem, 0.01); hi = 1; }
    else { v = faultLikelihood(cube, sem); lo = 0; hi = 1; }
  }
  const out = { bytes: toBytes(v, lo, hi), lo, hi };
  made.set(name, out);
  return { ...out, bytes: out.bytes.slice() };
}
