import { interpret, payOf, pickettFit } from "@ikhmalputra/subsurface-core/petro-clastic";
import type { Interpretation, LogSample, Uncertainty } from "@ikhmalputra/subsurface-core/petro-clastic";
import { mdOf } from "./force-model.ts";
import type { ForceLogs, ForceWell } from "./force-model.ts";

/**
 * A FORCE well's logs read for clastic petrophysics: its zones from the Directorate's tops, the
 * samples in a zone, the starting parameters each well suggests (gamma-ray lines from its own
 * percentiles, shale points and Rsh from its shales, Rw from the Pickett water line of its clean
 * sands), and the ranges the Monte Carlo draws from.
 */

export interface Zone { readonly name: string; readonly topMdM: number; readonly baseMdM: number; readonly kind: "formation" | "group" }

/** Zones between consecutive tops: formations where the Directorate gives them, else groups. */
export function zonesOf(well: ForceWell): Zone[] {
  const tops = (well.formations.length >= 2 ? well.formations : well.groups).filter((t) => t.md >= well.mdTop && t.md < well.mdBase).sort((a, b) => a.md - b.md);
  return tops.map((t, i) => ({ name: t.name, topMdM: t.md, baseMdM: tops[i + 1]?.md ?? well.mdBase, kind: well.formations.length >= 2 ? "formation" as const : "group" as const })).filter((z) => z.baseMdM - z.topMdM >= 5);
}

/** The well's samples between two depths, where all four curves are logged. */
export function samplesIn(logs: ForceLogs, topMdM: number, baseMdM: number): LogSample[] {
  const { well, curves } = logs, gr = curves.GR, rt = curves.RDEP, rhob = curves.RHOB, nphi = curves.NPHI;
  if (!gr || !rt || !rhob || !nphi) return [];
  const out: LogSample[] = [];
  for (let k = 0; k < well.n; k++) {
    const md = mdOf(well, k);
    if (md < topMdM || md > baseMdM) continue;
    if ([gr[k], rt[k], rhob[k], nphi[k]].some((v) => !Number.isFinite(v!))) continue;
    out.push({ mdM: md, gr: gr[k]!, rt: rt[k]!, rhob: rhob[k]!, nphi: nphi[k]! });
  }
  return out;
}

const quantile = (xs: readonly number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]! : NaN; };

/** Where to start: the well's gamma-ray lines, its shale's density, neutron and resistivity, and Rw from its sands' Pickett line. */
export function startingInterpretation(logs: ForceLogs): Interpretation & { readonly source: Readonly<Record<string, string>> } {
  const all = samplesIn(logs, logs.well.mdTop, logs.well.mdBase);
  const grClean = quantile(all.map((s) => s.gr), 0.05), grShale = quantile(all.map((s) => s.gr), 0.95);
  const shales = all.filter((s) => s.gr >= quantile(all.map((x) => x.gr), 0.9));
  const rhoShale = quantile(shales.map((s) => s.rhob), 0.5), nphiShale = quantile(shales.map((s) => s.nphi), 0.5), rsh = quantile(shales.map((s) => s.rt), 0.5);
  const base: Interpretation = {
    grClean, grShale, shale: "larionov-older",
    porosity: { rhoMatrix: 2.65, rhoFluid: 1.0, rhoShale: Number.isFinite(rhoShale) ? rhoShale : 2.5, nphiShale: Number.isFinite(nphiShale) ? nphiShale : 0.35 },
    model: "simandoux", sat: { a: 1, m: 2, n: 2, rw: 0.05, rsh: Number.isFinite(rsh) ? rsh : 2 },
    cutoffs: { vsh: 0.4, phi: 0.08, sw: 0.5 }, perm: "timur", bvwIrr: 0.05,
  };
  // The clean sands' Pickett line: the lower envelope gives a·Rw and m.
  const clean = all.filter((s) => s.gr <= grClean + 0.25 * (grShale - grClean)).map((s) => ({ phi: interpret(s, base).phi, rt: s.rt }));
  const fit = pickettFit(clean);
  const rw = fit && fit.aRw > 0.005 && fit.aRw < 1 ? fit.aRw : 0.05, m = fit && fit.m > 1.4 && fit.m < 3 ? fit.m : 2;
  return {
    ...base, sat: { ...base.sat, rw, m },
    source: { gr: "the well's 5th and 95th percentile", shale: "median of its top-decile gamma ray", rw: fit ? "its clean sands' Pickett line" : "assumed 0.05 Ω·m" },
  };
}

/** Each sample interpreted, with its step for thickness. */
export const interpretZone = (samples: readonly LogSample[], p: Interpretation, stepM: number) => samples.map((s) => ({ ...interpret(s, p), stepM, gr: s.gr, rt: s.rt, rhob: s.rhob, nphi: s.nphi }));

/** The Monte Carlo ranges about the current parameters: ±spread on Rw and Rsh, ±0.2 on m and n, and the cutoffs ±. */
export function rangesAbout(p: Interpretation, spread: number): Uncertainty {
  const r = (mode: number, lo: number, hi: number) => ({ low: lo, mode, high: hi });
  return {
    rw: r(p.sat.rw, p.sat.rw * (1 - spread), p.sat.rw * (1 + spread)), m: r(p.sat.m, p.sat.m - 0.2 * spread * 2, p.sat.m + 0.2 * spread * 2), n: r(p.sat.n, p.sat.n - 0.2 * spread * 2, p.sat.n + 0.2 * spread * 2),
    rsh: r(p.sat.rsh, p.sat.rsh * (1 - spread), p.sat.rsh * (1 + spread)),
    vshCut: r(p.cutoffs.vsh, p.cutoffs.vsh - 0.1 * spread * 2, p.cutoffs.vsh + 0.1 * spread * 2), phiCut: r(p.cutoffs.phi, Math.max(0, p.cutoffs.phi - 0.03 * spread * 2), p.cutoffs.phi + 0.03 * spread * 2), swCut: r(p.cutoffs.sw, p.cutoffs.sw - 0.1 * spread * 2, Math.min(1, p.cutoffs.sw + 0.1 * spread * 2)),
  };
}

/** The zone that reads most like a reservoir: the largest hydrocarbon column, else the most net sand. */
export function likeliestZone(logs: ForceLogs, zones: readonly Zone[], p: Interpretation): Zone | null {
  let best: Zone | null = null, most = -1;
  for (const z of zones) { const s = interpretZone(samplesIn(logs, z.topMdM, z.baseMdM), p, logs.well.step); const out = payOf(s, p.cutoffs), score = out.column * 1e4 + out.net; if (score > most) { most = score; best = z; } }
  return best;
}
