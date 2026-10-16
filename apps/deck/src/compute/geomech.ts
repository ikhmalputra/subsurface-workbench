import { breakdownPressure, collapsePressure, feetToMetres, forge5832Stress, metresToFeet } from "@ikhmalputra/subsurface-core";
import type { ComputedStation } from "@ikhmalputra/subsurface-core";
import { forgeOperations, lasCurve } from "@ikhmalputra/subsurface-core/records";
import type { LasFile } from "@ikhmalputra/subsurface-core/records";

/**
 * FORGE 16A(78)-32's 1D mechanical earth model as plain functions, without React, so the compute
 * worker can run it: stresses from 58-32's calibrated profile or 16A's own model, and the collapse
 * and breakdown pressures of 16A's inclined hole for twelve SHmax azimuths at every 25 ft.
 */
export const STEP_FT = 25;
/** 16A's RKB stands 30 ft above ground (5,444 ft against 5,414 ft, its survey workbook); 58-32's KB 21.5 ft (its log header). */
export const RKB_ABOVE_GROUND_16A_FT = 30;
export const KB_ABOVE_GROUND_5832_FT = 21.5;
export const AZIMUTHS = Array.from({ length: 12 }, (_, k) => k * 15);
export const ppg = (psi: number, tvdFt: number) => psi / (0.052 * tvdFt);
/** A breakout is predicted where the wall fails above pore pressure and the mud was lighter than that, by more than rounding. */
export const breaksOut = (row: Row, which: 0 | 1) => row.mud !== null && row.collapse !== null && row.collapse[which] > row.pp + 1 && row.mud < ppg(row.collapse[which], row.tvdFt) - 0.05;
/** The wall parts in tension already at pore pressure: drilling-induced fractures, whatever the mud. */
export const tensileAtPore = (row: Row) => row.breakdown !== null && row.breakdown[0] <= row.pp + 1;
export type Source = "5832" | "16a";

export interface Row {
  readonly mdM: number; readonly tvdFt: number;
  readonly pp: number; readonly sv: number; readonly sh: number; readonly sH: number; readonly sh16: number; readonly sh5832: number | null;
  readonly extrapolated: boolean;
  readonly collapse: readonly [number, number] | null; readonly breakdown: readonly [number, number] | null;
  readonly mud: number | null; readonly oval: boolean; readonly ucs: number;
}

/** 58-32's calibrated stresses at a depth below ground; past its TD, its granite gradient carried on. */
function stress5832(belowGroundFt: number) {
  const md = forge5832Stress.mdFt, kbFt = belowGroundFt + KB_ABOVE_GROUND_5832_FT;
  const pick = (values: readonly (number | null)[], i: number) => values[i] ?? null;
  if (kbFt >= md[0]! && kbFt <= md.at(-1)!) {
    const i = Math.min(md.length - 1, Math.max(0, Math.round((kbFt - md[0]!) / 5)));
    const sh = pick(forge5832Stress.shMinPsi, i), sH = pick(forge5832Stress.shMaxPsi, i);
    return sh === null || sH === null ? null : { sh, sH, extrapolated: false };
  }
  if (kbFt < md[0]!) return null;
  return { sh: GRANITE_GRADIENT.sh * belowGroundFt, sH: GRANITE_GRADIENT.sH * belowGroundFt, extrapolated: true };
}
/** 58-32's mean stress gradients below ground through its granite (4,500 ft to TD), for depths past its TD. */
export const GRANITE_GRADIENT = (() => {
  let sh = 0, sH = 0, n = 0;
  forge5832Stress.mdFt.forEach((md, i) => {
    const below = md - KB_ABOVE_GROUND_5832_FT, a = forge5832Stress.shMinPsi[i], b = forge5832Stress.shMaxPsi[i];
    if (md >= 4500 && a != null && b != null) { sh += a / below; sH += b / below; n++; }
  });
  return { sh: sh / n, sH: sH / n };
})();
/** SHmax relative to Shmin in 58-32's granite, as (SHmax − Pp)/(Shmin − Pp) with hydrostatic Pp: carried to 16A's own Shmin. */
export const SHMAX_RATIO = (() => {
  const ratios: number[] = [];
  forge5832Stress.mdFt.forEach((md, i) => {
    const pp = 0.433 * md, a = forge5832Stress.shMinPsi[i], b = forge5832Stress.shMaxPsi[i];
    if (md >= 4500 && a != null && b != null && a > pp) ratios.push((b - pp) / (a - pp));
  });
  ratios.sort((a, b) => a - b);
  return ratios[ratios.length >> 1]!;
})();

/** The mud each depth was drilled with, from the daily reports: the depth reached each day, and that day's mud weight. */
function mudByDepth() {
  const steps: { fromFt: number; toFt: number; ppg: number }[] = [];
  let reached = 0;
  for (const day of forgeOperations.days) {
    if (day.mdFt === null || day.mdFt <= reached) continue;
    if (day.mudWeightPpg !== null) steps.push({ fromFt: reached, toFt: day.mdFt, ppg: day.mudWeightPpg });
    reached = day.mdFt;
  }
  return (mdFt: number) => steps.find((step) => mdFt > step.fromFt && mdFt <= step.toFt)?.ppg ?? null;
}

function stationAt(survey: readonly ComputedStation[], mdM: number) {
  const i = Math.max(1, survey.findIndex((station) => station.mdM >= mdM));
  const a = survey[i - 1]!, b = survey[i] ?? a, t = b.mdM > a.mdM ? (mdM - a.mdM) / (b.mdM - a.mdM) : 0;
  let dAz = b.azimuthDeg - a.azimuthDeg; if (dAz > 180) dAz -= 360; if (dAz < -180) dAz += 360;
  return { tvdM: a.tvdM + t * (b.tvdM - a.tvdM), inclinationDeg: a.inclinationDeg + t * (b.inclinationDeg - a.inclinationDeg), azimuthDeg: (a.azimuthDeg + t * dAz + 360) % 360 };
}

/** The open-hole log's value at a depth: the 1 ft sample containing it, null if not reported (as data/openhole.ts reads it). */
function valueAt(las: LasFile, mnemonic: string, mdM: number): number | null {
  const curve = lasCurve(las, mnemonic);
  if (!curve) return null;
  const first = las.curves[0]!.values[0] ?? 0, index = Math.floor(metresToFeet(mdM) - first);
  return index < 0 || index >= curve.values.length ? null : curve.values[index] ?? null;
}

/** The earth model down 16A's logged granite, every 25 ft: the heavy part, run in the compute worker. */
export function geomechanicsRows(las: LasFile, survey: readonly ComputedStation[], source: Source): Row[] {
  const curveValues = (mnemonic: string) => (lasCurve(las, mnemonic)?.values ?? []).map((value) => value ?? Number.NaN);
  const mud = mudByDepth();
  const gaps = (() => { const c13 = curveValues("C13"), c24 = curveValues("C24"); const g: number[] = []; for (let i = 0; i < c13.length; i++) if (Number.isFinite(c13[i]!) && Number.isFinite(c24[i]!)) g.push(Math.abs(c13[i]! - c24[i]!)); g.sort((a, b) => a - b); return g[g.length >> 1] ?? 0; })();
  const rows: Row[] = [];
  for (let mdFt = 6000; mdFt <= 10940; mdFt += STEP_FT) {
    const mdM = feetToMetres(mdFt);
    const v = (mnemonic: string) => valueAt(las, mnemonic, mdM);
    const [svG, shG, ppG, ucs, fang, tstr, pr, c13, c24] = ["SV_G", "SHMIN_G", "PP_G", "UCS", "FANG", "TSTR", "PR", "C13", "C24"].map(v);
    if (svG == null || shG == null || ppG == null || ucs == null || fang == null || tstr == null || pr == null) continue;
    const at = stationAt(survey, mdM), tvdFt = metresToFeet(at.tvdM), below = tvdFt - RKB_ABOVE_GROUND_16A_FT;
    const pp = ppG * tvdFt, sv = svG * tvdFt, sh16 = shG * tvdFt;
    const other = stress5832(below);
    const sh = source === "5832" && other ? other.sh : sh16;
    const sH = source === "5832" && other ? other.sH : pp + SHMAX_RATIO * (sh16 - pp);
    const rock = { ucsPsi: ucs, frictionDeg: fang, tensilePsi: tstr, poisson: pr };
    const hole = { inclinationDeg: at.inclinationDeg, azimuthDeg: at.azimuthDeg };
    const collapses: number[] = [], breakdowns: number[] = [];
    for (const azimuth of AZIMUTHS) {
      const stress = { svPsi: sv, shMaxPsi: sH, shMinPsi: sh, shMaxAzimuthDeg: azimuth };
      const top = 2 * sv;
      const b = breakdownPressure(stress, hole, rock, pp, top);
      const c = collapsePressure(stress, hole, rock, pp, pp, b ?? top);
      if (c !== null) collapses.push(c);
      if (b !== null) breakdowns.push(b);
    }
    const range = (values: number[]) => values.length ? [Math.min(...values), Math.max(...values)] as const : null;
    rows.push({
      mdM, tvdFt, pp, sv, sh, sH, sh16, sh5832: other?.sh ?? null, extrapolated: other?.extrapolated ?? false,
      collapse: range(collapses), breakdown: range(breakdowns), mud: mud(mdFt),
      oval: c13 != null && c24 != null && Math.abs(c13 - c24) > gaps + 0.25, ucs,
    });
  }
  return rows;
}

