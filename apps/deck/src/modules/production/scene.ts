import { casingTable, findPipe, mdAtTvd, tubingTable } from "@ikhmalputra/subsurface-core/well-design";
import type { WellDesignBrief } from "@ikhmalputra/subsurface-core";
import type { FlowPattern, Traverse } from "@ikhmalputra/subsurface-core/production";
import { FT_PER_M } from "../../data/nodal-model.ts";

/**
 * The producing well as the cutaway draws it: the casing strings, the tubing and what flows in it
 * by depth, the valves on the tubing, the annulus, the perforations and the rock. Everything is by
 * measured depth in metres, the deck's depth unit, so the cutaway, the pressure lane beside it and
 * every other tile share one cursor.
 */

export interface SceneFlow {
  readonly mdM: number;
  readonly holdup: number;
  readonly pattern: FlowPattern;
  /** Mixture velocity, ft/s, and pressure, psia. */
  readonly vm: number;
  readonly p: number;
}
export type ValveState = "closed" | "open" | "operating" | "dummy";
export interface SceneValve { readonly mdM: number; readonly state: ValveState; readonly label: string }
export interface WellScene {
  readonly mdMax: number;
  readonly sections: readonly { readonly shoeMdM: number; readonly odIn: number; readonly idIn: number; readonly holeIn: number; readonly label: string }[];
  readonly tubing: { readonly odIn: number; readonly idIn: number; readonly tailMdM: number };
  readonly packerMdM: number | null;
  readonly perforations: readonly { readonly topMdM: number; readonly bottomMdM: number }[];
  readonly formations: readonly { readonly name: string; readonly topMdM: number; readonly lithology: string; readonly reservoir: boolean }[];
  readonly flow: readonly SceneFlow[];
  readonly waterCut: number;
  /** Liquid and oil at stock tank, STB/d; 0 when the well is dead. */
  readonly liquidRate: number;
  readonly oilRate: number;
  readonly reservoirPsia: number;
  readonly whpPsig: number;
  /** Lift gas going in, Mscf/d, and where; the annulus above the packer is gas when it is. */
  readonly liftMscfD: number;
  readonly liftMdM: number | null;
  readonly valves: readonly SceneValve[];
  /** While unloading: the top of the load fluid in the annulus (m MD); null when it has been unloaded. */
  readonly annulusLevelMdM: number | null;
  readonly gaugeMdM: number | null;
  /** The match lens: the gauge reading and the model there, psia. */
  readonly gauge: { readonly measured: number; readonly model: number | null } | null;
  /** The integrity lens: each annulus lit by its pressure against its MAASP (ratio 0–1, past 1 is over). */
  readonly annuli?: readonly { readonly name: string; readonly innerOdIn: number; readonly outerIdIn: number; readonly bottomMdM: number; readonly ratio: number; readonly label: string }[];
}

/** The casing strings, tubing, packer, perforations and rock from the well design, by MD. */
export function sceneFrame(brief: WellDesignBrief) {
  const completion = brief.completion;
  const sections = [...brief.sections].sort((a, b) => a.shoeMdM - b.shoeMdM).map((s) => {
    const pipe = findPipe(s.odIn, s.weightLbFt, casingTable);
    return { shoeMdM: s.shoeMdM, odIn: s.odIn, idIn: pipe?.idIn ?? s.odIn * 0.9, holeIn: s.holeSizeIn, label: s.label };
  });
  const tubingPipe = completion ? findPipe(completion.tubingOdIn, completion.tubingWeightLbFt, tubingTable) : null;
  const perforations = completion?.perforations ?? [];
  const bottom = Math.max(...perforations.map((p) => p.bottomMdM), completion?.packerMdM ?? 0, ...sections.map((s) => s.shoeMdM).slice(-1)) + 25;
  const formations = [...brief.geology.formations].sort((a, b) => a.topTvdM - b.topTvdM).map((f) => ({ name: f.name, topMdM: mdAtTvd(brief, f.topTvdM), lithology: f.lithology, reservoir: !!f.reservoir }));
  return {
    mdMax: bottom, sections, formations, perforations,
    tubing: { odIn: completion?.tubingOdIn ?? 3.5, idIn: tubingPipe?.idIn ?? (completion?.tubingOdIn ?? 3.5) * 0.85, tailMdM: completion ? Math.min(brief.totalDepthMdM - 1, completion.packerMdM + 30) : bottom },
    packerMdM: completion?.packerMdM ?? null,
  };
}

/** What flows in the tubing by depth, from a traverse (field units, ft) to the scene's metres. */
export const sceneFlow = (traverse: Traverse | null): SceneFlow[] => (traverse?.points ?? []).map((p) => ({ mdM: p.mdFt / FT_PER_M, holdup: p.holdup, pattern: p.pattern, vm: p.vsl + p.vsg, p: p.p }));

/** The vertical scale both the cutaway and the pressure lane draw on: the wellhead above, then MD to scale. */
export const HEAD_PX = 74;
export const depthScale = (height: number, mdMax: number) => {
  const plot = Math.max(80, height - HEAD_PX - 14);
  return { y: (md: number) => HEAD_PX + md / mdMax * plot, md: (y: number) => (y - HEAD_PX) / plot * mdMax, top: HEAD_PX, bottom: HEAD_PX + plot };
};

/**
 * Unloading, step by step: the load fluid in the annulus is pushed down by the injection gas until it
 * uncovers each valve in turn; gas enters the tubing there, lightening it, and the valve above closes
 * as the casing pressure falls to its setting. `t` runs 0–1 over the sequence.
 */
export function unloadingAt(t: number, valveMdM: readonly number[], kickoffPsig: number, settingsPsig: readonly number[]) {
  const stops = [0, ...valveMdM];
  const n = stops.length - 1;
  if (n <= 0) return { levelMdM: null as number | null, open: [] as number[], casingPsig: kickoffPsig, step: 0, of: 0 };
  const f = Math.max(0, Math.min(1, t)) * n, k = Math.min(n - 1, Math.floor(f)), within = f - k;
  const levelMdM = t >= 1 ? null : stops[k]! + (stops[k + 1]! - stops[k]!) * within;
  // Valve k (0-based) is uncovered once the level passes it; it stays open until the next is uncovered, then closes.
  const open: number[] = [];
  for (let v = 0; v < valveMdM.length; v++) {
    const uncovered = (levelMdM ?? Infinity) >= valveMdM[v]!;
    const nextUncovered = v + 1 < valveMdM.length && (levelMdM ?? Infinity) >= valveMdM[v + 1]! + 1;
    if (uncovered && (!nextUncovered || v === valveMdM.length - 1)) open.push(v);
  }
  const current = open.length ? open[open.length - 1]! : -1;
  const casingPsig = current < 0 ? kickoffPsig : settingsPsig[current] ?? settingsPsig.at(-1) ?? kickoffPsig;
  return { levelMdM, open, casingPsig, step: k + 1, of: n };
}
