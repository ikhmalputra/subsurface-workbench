import { wellComponentsToAssembly } from "@ikhmalputra/subsurface-core";
import type { WellAssembly } from "@ikhmalputra/subsurface-core";
import { dateToMs, forgeInstalls, historySpan, msToDate, wellAsOf } from "@ikhmalputra/subsurface-core/records";
import type { LasFile, WellAsOf } from "@ikhmalputra/subsurface-core/records";
import { useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";
import { signals } from "../deck/store.ts";
import { FORGE_NAME, forgeWell } from "./sites.ts";

/**
 * FORGE through time. The time cursor is a moment; the well on that moment is the well as its
 * reports left it that day. Each day is computed once and kept, so scrubbing back and forth is
 * free after the first pass.
 */

const { operations, components, design } = forgeWell;
export const span = historySpan(operations, forgeInstalls);
const spanMs = { first: dateToMs(span.first), last: dateToMs(span.last), spud: span.spud ? dateToMs(span.spud) : null };
export const installs = forgeInstalls;

export interface Moment {
  readonly date: string;
  readonly asOf: WellAsOf;
  readonly assembly: WellAssembly;
  /** Every component present that day, holes included. */
  readonly present: readonly string[];
  /** Strings run part of the way that day: the depth each had reached, metres MD. */
  readonly runTo: Readonly<Record<string, number>>;
}

const moments = new Map<string, Moment>();
export function momentOn(date: string): Moment {
  let moment = moments.get(date);
  if (!moment) {
    const asOf = wellAsOf(operations, components, installs, date);
    const assembly = wellComponentsToAssembly({ id: design.id, name: FORGE_NAME, totalDepthM: design.totalDepthM, components: asOf.components });
    const runTo = Object.fromEntries(asOf.components.filter((component) => component.kind !== "Hole" && !asOf.completeIds.includes(component.id)).map((component) => [component.id, component.bottomDepthM]));
    moment = { date, asOf, assembly, present: asOf.components.map((component) => component.id), runTo };
    moments.set(date, moment);
  }
  return moment;
}

/** The moment the deck is on, or null for the well as finally recorded. */
export function useMoment(): Moment | null {
  const cursorMs = useSubsurfaceSelector(signals, (state) => state.time?.cursorMs ?? null);
  return cursorMs === null ? null : momentOn(msToDate(cursorMs));
}

/** Every date the rail can stand on: one per calendar day from the first report to rig release. */
export const allDates: readonly string[] = (() => {
  const dates: string[] = [];
  for (let ms = spanMs.first; ms <= spanMs.last; ms += 86_400_000) dates.push(msToDate(ms));
  return dates;
})();

const clipped = new WeakMap<LasFile, Map<number, LasFile>>();
/** The log as recorded by a depth: samples below it are not yet drilled, so not drawn; the axis stays whole. */
export function logTo(las: LasFile, drilledFt: number): LasFile {
  let byDepth = clipped.get(las);
  if (!byDepth) { byDepth = new Map(); clipped.set(las, byDepth); }
  const known = byDepth.get(drilledFt);
  if (known) return known;
  const index = las.curves[0]!.values;
  const next: LasFile = { ...las, curves: las.curves.map((curve, at) => at === 0 ? curve : { ...curve, values: curve.values.map((value, row) => (index[row] ?? Infinity) <= drilledFt ? value : null) }) };
  byDepth.set(drilledFt, next);
  return next;
}

export const formatDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
