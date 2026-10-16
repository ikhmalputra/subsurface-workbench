import { useSyncExternalStore } from "react";
import { forgeSeismicSection, seismicDepthToTvd } from "@ikhmalputra/subsurface-core";
import type { SeismicCube } from "@ikhmalputra/subsurface-core";
import type { SiteSceneSurface } from "@ikhmalputra/subsurface-react/3d";
import { depthColour, track } from "./horizon-model.ts";
import type { Polarity } from "./horizon-model.ts";

/**
 * Horizons the user picks on the FORGE PSDM. A horizon is its seed and its tracking settings, kept in
 * this browser; the surface is tracked again from them whenever it is needed (a few milliseconds), so
 * a changed setting is a changed surface at once, everywhere it is drawn.
 */

export interface Horizon {
  readonly id: string;
  readonly name: string;
  readonly colour: string;
  readonly polarity: Polarity;
  /** Along bin, offset bin and depth sample of the seed in the sub-volume. */
  readonly seed: { readonly a: number; readonly o: number; readonly s: number };
  readonly minCorrelation: number;
  readonly search: number;
  readonly visible: boolean;
  readonly createdAt: number;
}

const KEY = "deck-horizons-v1";
const COLOURS = ["#f59e0b", "#22d3ee", "#f472b6", "#a3e635", "#a78bfa", "#fb7185"];
let horizons: readonly Horizon[] = (() => { try { const value = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Horizon[]; return Array.isArray(value) ? value : []; } catch { return []; } })();
const listeners = new Set<() => void>();
function changed(next: readonly Horizon[]) {
  horizons = next;
  try { localStorage.setItem(KEY, JSON.stringify(horizons)); } catch { /* not kept */ }
  for (const listener of [...listeners]) listener();
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => horizons;
export const useHorizons = () => useSyncExternalStore(subscribe, snapshot, snapshot);

export function addHorizon(seed: Horizon["seed"], polarity: Polarity): Horizon {
  const horizon: Horizon = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: `Horizon ${horizons.length + 1}`, colour: COLOURS[horizons.length % COLOURS.length]!, polarity, seed, minCorrelation: 0.7, search: 3, visible: true, createdAt: Date.now() };
  changed([...horizons, horizon]);
  return horizon;
}
export const updateHorizon = (id: string, patch: Partial<Omit<Horizon, "id">>) => changed(horizons.map((entry) => entry.id === id ? { ...entry, ...patch } : entry));
export const removeHorizon = (id: string) => changed(horizons.filter((entry) => entry.id !== id));

const cut = forgeSeismicSection.subVolume!;
/** The FORGE sub-volume as a cube, from its counts. */
export const forgeCube = (counts: Int8Array): SeismicCube => ({ counts, alongCount: cut.alongCount, offsetCount: cut.offsetCount, sampleCount: cut.samples, amplitudePerCount: cut.amplitudePerCount, alongFromM: cut.alongFromM, offsetFromM: cut.offsetFromM, spacingM: cut.spacingM });

/** Tracked grids, by the settings that make them. */
const grids = new Map<string, Float32Array>();
export function gridOf(horizon: Horizon, cube: SeismicCube): Float32Array {
  const key = `${horizon.seed.a},${horizon.seed.o},${horizon.seed.s},${horizon.polarity},${horizon.minCorrelation},${horizon.search}`;
  let grid = grids.get(key);
  if (!grid) { grid = track(cube, horizon.seed, { polarity: horizon.polarity, search: horizon.search, window: 5, minCorrelation: horizon.minCorrelation }); grids.set(key, grid); }
  return grid;
}

/** Depths of a grid, in metres below the PSDM datum, and their range. */
export function depthsOf(grid: Float32Array) {
  let lo = Infinity, hi = -Infinity, n = 0;
  for (const s of grid) if (!Number.isNaN(s)) { lo = Math.min(lo, s * cut.sampleIntervalM); hi = Math.max(hi, s * cut.sampleIntervalM); n++; }
  return { lo, hi, coverage: n / grid.length };
}

/** Where a bin sits in the site's plan frame: east and north from the section origin. */
export function planOf(along: number, offset: number): [number, number] {
  const az = cut.azimuthDeg * Math.PI / 180;
  return [along * Math.sin(az) + offset * Math.cos(az), along * Math.cos(az) - offset * Math.sin(az)];
}

/** A horizon as the site draws it: one point per tracked trace, two triangles per fully tracked cell, coloured by depth. */
export function surfaceOf(horizon: Horizon, grid: Float32Array): SiteSceneSurface | null {
  const { lo, hi, coverage } = depthsOf(grid);
  if (!Number.isFinite(lo)) return null;
  const index = new Int32Array(grid.length).fill(-1);
  const points: [number, number, number][] = [], colours: [number, number, number][] = [];
  for (let o = 0; o < cut.offsetCount; o++) for (let a = 0; a < cut.alongCount; a++) {
    const s = grid[o * cut.alongCount + a]!;
    if (Number.isNaN(s)) continue;
    const depth = s * cut.sampleIntervalM;
    const [e, n] = planOf(cut.alongFromM + a * cut.spacingM, cut.offsetFromM + o * cut.spacingM);
    index[o * cut.alongCount + a] = points.length;
    points.push([e, n, seismicDepthToTvd(depth, forgeSeismicSection.rkbElevationM, forgeSeismicSection.seismicDatumElevationM)]);
    colours.push(depthColour((depth - lo) / Math.max(1, hi - lo)));
  }
  const triangles: number[] = [];
  for (let o = 0; o + 1 < cut.offsetCount; o++) for (let a = 0; a + 1 < cut.alongCount; a++) {
    const p = index[o * cut.alongCount + a]!, q = index[o * cut.alongCount + a + 1]!, r = index[(o + 1) * cut.alongCount + a]!, t = index[(o + 1) * cut.alongCount + a + 1]!;
    if (p >= 0 && q >= 0 && r >= 0) triangles.push(p, q, r);
    if (q >= 0 && t >= 0 && r >= 0) triangles.push(q, t, r);
  }
  if (!triangles.length) return null;
  return {
    id: `user-${horizon.id}`, label: horizon.name, provenance: "user-authored", role: "horizon", color: horizon.colour,
    note: `Picked on the FORGE PSDM and tracked trace to trace (${horizon.polarity}, correlation ≥ ${horizon.minCorrelation}): ${Math.round(coverage * 100)}% of the volume, ${Math.round(lo)}–${Math.round(hi)} m below the seismic datum.`,
    geometry: { kind: "tin", points, triangles }, pointColors: colours,
  };
}
