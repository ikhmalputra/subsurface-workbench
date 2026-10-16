import type { FormationLayer, SurveyPoint } from "@ikhmalputra/subsurface-core";

/**
 * The FORCE 2020 wells as data: their shape, depth along each path, the colours they are drawn in,
 * and the logs decoded from their files. No fetching here, so it runs anywhere (the tests read it).
 */

export interface ForceTop { readonly name: string; readonly md: number; readonly tvdss: number | null }
export interface ForceShoe { readonly label: string; readonly odIn: number | null; readonly md: number; readonly tvdss: number | null }
export interface ForceCurveSpec { readonly m: string; readonly unit: string; readonly min: number; readonly max: number; readonly log?: boolean }
export interface ForceWell {
  readonly id: string;
  readonly name: string;
  readonly area: string;
  /** Which part of the competition the lithology came from: all of it is the organisers' interpretation. */
  readonly split: "train" | "leaderboard" | "hidden";
  readonly file: string;
  /** The top of the logs, WGS84 longitude/latitude. */
  readonly lonLat: readonly [number, number] | null;
  readonly utm: readonly [number, number] | null;
  /** Rig floor above sea level, derived: MD minus TVDSS where the hole is vertical. */
  readonly datumElevationM: number | null;
  readonly datumFrom: "tops" | "logs" | null;
  readonly mdTop: number;
  readonly mdBase: number;
  readonly step: number;
  readonly n: number;
  readonly curves: readonly ForceCurveSpec[];
  readonly lithology: boolean;
  readonly groups: readonly ForceTop[];
  readonly formations: readonly ForceTop[];
  readonly shoes: readonly ForceShoe[];
  /** [MD, east, north, TVDSS], metres; east and north from the top of the logs. */
  readonly survey: readonly (readonly [number, number, number, number])[];
}
export interface ForceArea { readonly id: string; readonly quadrants: readonly number[]; readonly label: string }
export interface ForceIndex { readonly source: string; readonly crs: string; readonly lithology: readonly number[]; readonly areas: readonly ForceArea[]; readonly wells: readonly ForceWell[] }


/** The signal bus knows a FORCE well as "force-<id>". */
export const busId = (well: ForceWell) => `force-${well.id}`;

// ── Depth along a path ──────────────────────────────────────────────────────────────────────
/** A well's path as the deck's survey stations: TVD below the rig floor, east and north from the top of the logs. */
export function forceStations(well: ForceWell): readonly SurveyPoint[] {
  const datum = well.datumElevationM ?? 0;
  const s = well.survey;
  return s.map(([md, e, n, tvdss], i) => {
    const j = Math.max(1, i);
    const de = s[j]![1] - s[j - 1]![1], dn = s[j]![2] - s[j - 1]![2], dz = s[j]![3] - s[j - 1]![3];
    return { mdM: md, tvdM: tvdss + datum, eastingM: e, northingM: n, inclinationDeg: Math.atan2(Math.hypot(de, dn), dz) * 180 / Math.PI, azimuthDeg: (Math.atan2(de, dn) * 180 / Math.PI + 360) % 360 };
  });
}
/** TVDSS at an MD, along the path; outside it, straight on from the nearest station. */
export function tvdssAt(well: ForceWell, md: number): number {
  const s = well.survey;
  if (!s.length) return md - (well.datumElevationM ?? 0);
  if (md <= s[0]![0]) return s[0]![3] - (s[0]![0] - md);
  for (let i = 1; i < s.length; i++) if (md <= s[i]![0]) { const t = (md - s[i - 1]![0]) / (s[i]![0] - s[i - 1]![0] || 1); return s[i - 1]![3] + t * (s[i]![3] - s[i - 1]![3]); }
  const a = s.at(-2) ?? s.at(-1)!, b = s.at(-1)!;
  const slope = b[0] > a[0] ? (b[3] - a[3]) / (b[0] - a[0]) : 1;
  return b[3] + (md - b[0]) * slope;
}
/** MD at a TVDSS: the first place the path reaches it. */
export function mdAtTvdss(well: ForceWell, tvdss: number): number {
  const s = well.survey;
  if (!s.length) return tvdss + (well.datumElevationM ?? 0);
  if (tvdss <= s[0]![3]) return s[0]![0] - (s[0]![3] - tvdss);
  for (let i = 1; i < s.length; i++) if (tvdss <= s[i]![3]) { const t = (tvdss - s[i - 1]![3]) / (s[i]![3] - s[i - 1]![3] || 1); return s[i - 1]![0] + t * (s[i]![0] - s[i - 1]![0]); }
  const a = s.at(-2) ?? s.at(-1)!, b = s.at(-1)!;
  const slope = b[3] > a[3] ? (b[0] - a[0]) / (b[3] - a[3]) : 1;
  return b[0] + (tvdss - b[3]) * slope;
}

// ── Colours ──────────────────────────────────────────────────────────────────────────────────
/** Groups coloured by age, after the ICS chronostratigraphic chart: Neogene yellow down to Permian red. */
const GROUP_COLOUR: Readonly<Record<string, string>> = {
  "Nordland Gp.": "#f2df4b", "Hordaland Gp.": "#f9b56e", "Rogaland Gp.": "#f0955a",
  "Shetland Gp.": "#9fcf62", "Cromer Knoll Gp.": "#73b956",
  "Viking Gp.": "#9ad9e8", "Tyne Gp.": "#9ad9e8", "Boknfjord Gp.": "#9ad9e8",
  "Vestland Gp.": "#5fbfd4", "Dunlin Gp.": "#3f9fca", "Baat Gp.": "#3f9fca",
  "Hegre Gp.": "#a873b8", "Zechstein Gp.": "#e2624a", "Rotliegendes Gp.": "#d07d63",
};
export const groupColour = (name: string) => GROUP_COLOUR[name] ?? "#8b95ad";
/** The competition's lithology classes, in the order the files store them. */
export const LITHOLOGY: readonly { readonly name: string; readonly colour: string }[] = [
  { name: "Sandstone", colour: "#f1cf45" }, { name: "Sandstone/shale", colour: "#c8b25a" }, { name: "Shale", colour: "#6f7d7e" },
  { name: "Marl", colour: "#9fc1b8" }, { name: "Dolomite", colour: "#ad97d6" }, { name: "Limestone", colour: "#5aa7dc" },
  { name: "Chalk", colour: "#cfe4f2" }, { name: "Halite", colour: "#f2b0a9" }, { name: "Anhydrite", colour: "#d5807a" },
  { name: "Tuff", colour: "#7fd8a3" }, { name: "Coal", colour: "#2a2a2a" }, { name: "Basement", colour: "#c85e52" },
];

// ── Logs ─────────────────────────────────────────────────────────────────────────────────────
export interface ForceLogs {
  readonly well: ForceWell;
  /** Each curve on the well's 0.5 m grid, NaN where not logged; resistivity in ohm·m. */
  readonly curves: Readonly<Record<string, Float32Array>>;
  /** Lithology class index per sample, -1 where none was interpreted. */
  readonly litho: Int8Array | null;
}
export const mdOf = (well: ForceWell, i: number) => well.mdTop + i * well.step;
export const sampleAt = (well: ForceWell, md: number) => Math.round((md - well.mdTop) / well.step);

export function decodeForceLogs(well: ForceWell, buffer: ArrayBuffer): ForceLogs {
  const data = new Int16Array(buffer);
  const curves: Record<string, Float32Array> = {};
  well.curves.forEach((spec, c) => {
    const out = new Float32Array(well.n), span = spec.max - spec.min;
    for (let k = 0; k < well.n; k++) {
      const q = data[c * well.n + k]!;
      if (q === -32768) { out[k] = NaN; continue; }
      const value = spec.min + (q + 32767) / 65534 * span;
      out[k] = spec.log ? 10 ** value : value;
    }
    curves[spec.m] = out;
  });
  const litho = well.lithology ? Int8Array.from(data.subarray(well.curves.length * well.n, (well.curves.length + 1) * well.n)) : null;
  return { well, curves, litho };
}

/** The Directorate's groups as formation layers, depths below the rig floor. */
export function forceFormations(well: ForceWell): readonly FormationLayer[] {
  const datum = well.datumElevationM ?? 0;
  const tops = well.groups.filter((top) => top.md >= 0);
  const td = tvdssAt(well, well.mdBase) + datum;
  return tops.map((top, i) => {
    const topTvd = (top.tvdss ?? tvdssAt(well, top.md)) + datum;
    const next = tops[i + 1];
    const bottom = next ? (next.tvdss ?? tvdssAt(well, next.md)) + datum : Math.max(td, topTvd + 1);
    return { id: `${well.id}-${top.name}`, name: top.name, lithology: "", topTvdM: topTvd, bottomTvdM: bottom, densityKgM3: null, porosityPct: null, color: groupColour(top.name), interpretation: "Norwegian Offshore Directorate" };
  });
}


// ── Tops on a correlation ────────────────────────────────────────────────────────────────────
/** A top as the panel uses it: whose it is, and where it sits. */
export interface Top { readonly name: string; readonly md: number; readonly tvdss: number; readonly kind: "group" | "formation" | "yours"; readonly colour: string }
export function topsOf(well: ForceWell, mine: readonly { readonly name: string; readonly md: number }[], yours = "var(--yours)"): readonly Top[] {
  const at = (top: ForceTop) => top.tvdss ?? tvdssAt(well, top.md);
  // A formation is drawn in the colour of the group it sits in.
  const groupAt = (md: number) => [...well.groups].reverse().find((group) => group.md <= md + 0.01);
  return [
    ...well.groups.map((top) => ({ name: top.name, md: top.md, tvdss: at(top), kind: "group" as const, colour: groupColour(top.name) })),
    ...well.formations.map((top) => { const group = groupAt(top.md); return { name: top.name, md: top.md, tvdss: at(top), kind: "formation" as const, colour: group ? groupColour(group.name) : "var(--ink-3)" }; }),
    ...mine.map((pick) => ({ name: pick.name, md: pick.md, tvdss: tvdssAt(well, pick.md), kind: "yours" as const, colour: yours })),
  ];
}
/** The level a top hangs the well on: yours first, then the Directorate's. */
export const flattenAt = (tops: readonly Top[], name: string | null) => {
  if (!name) return 0;
  const top = tops.find((entry) => entry.name === name && entry.kind === "yours") ?? tops.find((entry) => entry.name === name);
  return top ? top.tvdss : null;
};


// ── Suggesting a pick from the logs ──────────────────────────────────────────────────────────
export interface Match { readonly index: number; readonly r: number }
/**
 * Where a reference well's log pattern around a pick best repeats in another well: the window of
 * `half` samples either side of `at` in the reference slid over `search` samples either side of
 * `around` in the target, scored by Pearson correlation of the two windows (samples missing in
 * either are skipped; a position needs two thirds of its pairs). A small pull toward `around`
 * settles near-ties. Same thickness assumed: no stretch or squeeze. Null when nothing scores.
 */
export function matchPick(reference: Float32Array, at: number, target: Float32Array, around: number, half: number, search: number): Match | null {
  let best: Match | null = null, bestScore = -Infinity;
  for (let lag = Math.max(half, around - search); lag <= Math.min(target.length - 1 - half, around + search); lag++) {
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let k = -half; k <= half; k++) {
      const x = reference[at + k], y = target[lag + k];
      if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) continue;
      n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    }
    if (n < (2 * half + 1) * 2 / 3) continue;
    const vx = sxx - sx * sx / n, vy = syy - sy * sy / n;
    if (vx <= 1e-9 || vy <= 1e-9) continue;
    const r = (sxy - sx * sy / n) / Math.sqrt(vx * vy);
    const score = r - 0.05 * Math.abs(lag - around) / Math.max(1, search);
    if (score > bestScore) { bestScore = score; best = { index: lag, r }; }
  }
  return best;
}
