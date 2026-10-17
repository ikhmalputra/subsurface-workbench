import { useEffect, useSyncExternalStore } from "react";
import type { SeismicCube } from "@ikhmalputra/subsurface-core";
import type { SceneSeismicVolume } from "@ikhmalputra/subsurface-react/3d";
import { compute } from "../compute/run.ts";
import type { AttributeName } from "../compute/attributes.ts";

/**
 * Attribute volumes of the FORGE PSDM, shared by every view that shows or uses one: Attributes'
 * chair, Horizons' slices and section, its fault-stick snapping and phase tracking, and Site in
 * 3D's slices. Computed once in the worker, kept for the session, as bytes 0–255 standing for lo–hi.
 */
export interface AttributeVolume { readonly bytes: Uint8Array; readonly lo: number; readonly hi: number }
export const ATTRIBUTE_NAMES: readonly { readonly id: AttributeName | "amplitude"; readonly label: string; readonly note: string }[] = [
  { id: "amplitude", label: "Amplitude", note: "The PSDM as delivered." },
  { id: "envelope", label: "Envelope", note: "Reflection strength: bright where the impedance contrast is strong, whatever the phase." },
  { id: "phase", label: "Phase", note: "Instantaneous phase: event continuity, independent of amplitude; faults and pinch-outs show as breaks in the bands." },
  { id: "frequency", label: "Frequency", note: "Instantaneous frequency, cycles per km of depth: softer, thicker or fractured intervals shift it." },
  { id: "rms", label: "RMS", note: "RMS amplitude in a 65 m window." },
  { id: "coherence", label: "Coherence", note: "Dip-steered semblance over 3 × 3 traces and 45 m: dark where the reflectors stop carrying on (faults, fracture zones)." },
  { id: "fault", label: "Fault likelihood", note: "Discontinuity sharpened and thinned to its ridge across the fault: a guide for picking fault sticks in Horizons." },
];

/** Colour maps, 0–1 to RGB. */
const ramp = (stops: readonly [number, number, number][]) => (t: number): [number, number, number] => { const x = Math.max(0, Math.min(1, t)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i, a = stops[i]!, b = stops[i + 1]!; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; };
export const ATTRIBUTE_MAPS: Readonly<Record<string, (t: number) => [number, number, number]>> = {
  envelope: ramp([[0, 0, 4], [80, 18, 123], [183, 55, 121], [252, 137, 97], [252, 253, 191]]),
  phase: (t) => { const h = t * 6, c = 220, x = c * (1 - Math.abs((h % 2) - 1)); const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x]; return [r + 30, g + 30, b + 30]; },
  frequency: ramp([[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]]),
  rms: ramp([[0, 0, 4], [87, 16, 110], [188, 55, 84], [249, 142, 9], [252, 255, 164]]),
  coherence: ramp([[10, 10, 14], [60, 60, 70], [170, 170, 180], [245, 245, 250]]),
  fault: ramp([[0, 0, 0], [120, 20, 10], [230, 70, 20], [255, 200, 40], [255, 255, 200]]),
};

const made = new Map<string, AttributeVolume>(), pending = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const key = (cube: SeismicCube, name: string) => `${cube.counts.length}:${name}`;

/** An attribute of the cube, started in the worker the first time anything asks; null until it is ready. */
export function useAttributeVolume(cube: SeismicCube | null, name: AttributeName | null): AttributeVolume | null {
  useSyncExternalStore(subscribe, () => version);
  useEffect(() => {
    if (!cube || !name) return;
    const k = key(cube, name);
    if (made.has(k) || pending.has(k)) return;
    pending.add(k);
    compute("attribute", name, cube.counts, { alongCount: cube.alongCount, offsetCount: cube.offsetCount, sampleCount: cube.sampleCount })
      .then((v) => { made.set(k, v); }).catch(() => undefined)
      .finally(() => { pending.delete(k); version++; for (const listener of [...listeners]) listener(); });
  }, [cube, name]);
  return cube && name ? made.get(key(cube, name)) ?? null : null;
}

/**
 * An attribute as a volume the 3D scenes draw on their slices, grey with high values dark (as the
 * amplitude's peaks are): fault likelihood dark on the fault, coherence turned to discontinuity so
 * faults are dark too, phase as its cycle. The volume's frame is the amplitude's.
 */
export function attributeAsSeismic(base: SceneSeismicVolume, attr: AttributeVolume, name: AttributeName): SceneSeismicVolume {
  const counts = new Int8Array(attr.bytes.length), flip = name === "coherence";
  for (let i = 0; i < counts.length; i++) counts[i] = (flip ? 255 - attr.bytes[i]! : attr.bytes[i]!) - 128;
  const label = ATTRIBUTE_NAMES.find((n) => n.id === name)?.label ?? name;
  return { ...base, counts, amplitudePerCount: (attr.hi - attr.lo) / 255, gain: 1, label: `${flip ? "Discontinuity (1 − coherence)" : label} · from the FORGE PSDM` };
}
