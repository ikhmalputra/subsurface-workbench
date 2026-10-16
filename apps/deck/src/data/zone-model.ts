import { densityPorosity, gammaRayLines, neutronDensityPorosity, shaleVolumeFromGamma } from "@ikhmalputra/subsurface-core";
import { tvdssAt } from "./force-model.ts";
import type { ForceLogs, ForceTop, ForceWell } from "./force-model.ts";
import type { Range } from "./volumetrics-model.ts";

/**
 * A zone in a field's wells: between a top and a base (the Directorate's tops, or the user's picks),
 * where each well meets it, how thick it is, and what its logs say of it: porosity from density
 * (with neutron where logged), shale volume from gamma ray, water saturation by Archie from deep
 * resistivity. Pure: runs anywhere.
 */

export interface ZoneWell {
  readonly well: ForceWell;
  /** UTM east and north where the well meets the top. */
  readonly x: number;
  readonly y: number;
  readonly topMd: number;
  readonly top: number;
  readonly baseMd: number | null;
  readonly base: number | null;
}

/** Where a well's path is at an MD: UTM east and north. */
export function positionAt(well: ForceWell, md: number): [number, number] {
  const s = well.survey, [e0, n0] = well.utm!;
  if (!s.length) return [e0, n0];
  let i = s.findIndex((station) => station[0] >= md);
  if (i <= 0) i = i < 0 ? s.length - 1 : 0;
  const a = s[Math.max(0, i - 1)]!, b = s[i]!;
  const t = b[0] > a[0] ? Math.min(1, Math.max(0, (md - a[0]) / (b[0] - a[0]))) : 0;
  return [e0 + a[1] + (b[1] - a[1]) * t, n0 + a[2] + (b[2] - a[2]) * t];
}

/** A named top in a well: the user's pick first, then the Directorate's group or formation top. */
export function topIn(well: ForceWell, name: string, picks: readonly { readonly name: string; readonly md: number }[] = []): { readonly md: number; readonly tvdss: number } | null {
  const mine = picks.find((pick) => pick.name === name);
  if (mine) return { md: mine.md, tvdss: tvdssAt(well, mine.md) };
  const theirs: ForceTop | undefined = well.groups.find((top) => top.name === name) ?? well.formations.find((top) => top.name === name);
  return theirs ? { md: theirs.md, tvdss: theirs.tvdss ?? tvdssAt(well, theirs.md) } : null;
}

/** The wells that meet the zone's top, with where they meet it and its base. */
export function zoneWells(wells: readonly ForceWell[], top: string, base: string | null, picksOf: (well: ForceWell) => readonly { readonly name: string; readonly md: number }[] = () => []): ZoneWell[] {
  return wells.filter((well) => well.utm).flatMap((well) => {
    const t = topIn(well, top, picksOf(well));
    if (!t) return [];
    const b = base ? topIn(well, base, picksOf(well)) : null;
    const [x, y] = positionAt(well, t.md);
    return [{ well, x, y, topMd: t.md, top: t.tvdss, baseMd: b && b.md > t.md ? b.md : null, base: b && b.md > t.md ? b.tvdss : null }];
  });
}

export interface ZonePetro {
  /** Logged metres of the zone with density. */
  readonly grossM: number;
  readonly netM: number;
  readonly ntg: number;
  /** Mean porosity of the net rock. */
  readonly porosity: number;
  /** Pore-volume-weighted water saturation of the net rock. */
  readonly sw: number;
  /** Net rock with water saturation under 0.6: what the logs read as hydrocarbon-bearing. */
  readonly payM: number;
  /** Water saturation of that pay, pore-volume weighted; null without pay. */
  readonly paySw: number | null;
}
export interface PetroCutoffs { readonly maxVsh: number; readonly minPorosity: number; readonly rw: number; readonly a: number; readonly m: number; readonly n: number }
export const defaultCutoffs: PetroCutoffs = { maxVsh: 0.4, minPorosity: 0.1, rw: 0.05, a: 1, m: 2, n: 2 };

/** The zone in one well's logs, between two MDs; null when the well has no density or gamma ray there. */
export function zonePetro(logs: ForceLogs, topMd: number, baseMd: number, cutoffs: PetroCutoffs = defaultCutoffs): ZonePetro | null {
  const { well, curves } = logs;
  const rhob = curves.RHOB, gr = curves.GR, nphi = curves.NPHI, rt = curves.RDEP;
  if (!rhob || !gr) return null;
  let lines: { clean: number; shale: number };
  try { lines = gammaRayLines(gr); } catch { return null; }
  let gross = 0, net = 0, pay = 0, phiSum = 0, pore = 0, water = 0, payPore = 0, payWater = 0;
  const from = Math.max(0, Math.ceil((topMd - well.mdTop) / well.step)), to = Math.min(well.n, Math.floor((baseMd - well.mdTop) / well.step));
  for (let k = from; k < to; k++) {
    const rho = rhob[k]!, g = gr[k]!;
    if (Number.isNaN(rho) || Number.isNaN(g)) continue;
    gross++;
    const phiD = densityPorosity(rho), n = nphi?.[k];
    const phi = Math.min(0.45, Math.max(0, n !== undefined && !Number.isNaN(n) ? neutronDensityPorosity(phiD, n) : phiD));
    if (shaleVolumeFromGamma(g, lines) > cutoffs.maxVsh || phi < cutoffs.minPorosity) continue;
    net++; phiSum += phi;
    const r = rt?.[k];
    const sw = r !== undefined && !Number.isNaN(r) && r > 0 ? Math.min(1, ((cutoffs.a * cutoffs.rw) / (phi ** cutoffs.m * r)) ** (1 / cutoffs.n)) : 1;
    pore += phi; water += phi * sw;
    if (sw < 0.6) { pay++; payPore += phi; payWater += phi * sw; }
  }
  if (!gross) return null;
  return { grossM: gross * well.step, netM: net * well.step, ntg: net / gross, porosity: net ? phiSum / net : 0, sw: pore ? water / pore : 1, payM: pay * well.step, paySw: payPore ? payWater / payPore : null };
}

/** A triangular range from wells' values: their 10th and 90th percentiles, and their median as the most likely. Null with fewer than three. */
export function rangeOf(values: readonly number[]): Range | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < 3) return null;
  const at = (f: number) => { const x = f * (v.length - 1), i = Math.floor(x), t = x - i; return v[i]! + (v[Math.min(v.length - 1, i + 1)]! - v[i]!) * t; };
  return { low: at(0.1), mode: at(0.5), high: at(0.9) };
}

