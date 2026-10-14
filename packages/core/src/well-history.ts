import { feetToMetres } from "./units.ts";
import type { WellComponent } from "./index.ts";
import type { WellDay, WellMilestone, WellOperations } from "./records.ts";

/**
 * A well as it stood on a day of its history: how deep it had been drilled, what had been run and
 * cemented, and that day's report. Everything comes from dated records; a component whose install
 * the daily reports do not date says so in its event's note, and nothing between two reports is
 * interpolated: the well changes when a report says it did.
 */

/** When a component went into the well, and where the record says so. */
export interface InstallEvent {
  readonly componentId: string;
  /** Report date, YYYY-MM-DD. */
  readonly date: string;
  readonly page: number;
  readonly label: string;
  /** A string run part of the way that day: its depth then, in feet as reported. */
  readonly runToFt?: number;
  readonly note?: string;
}

/**
 * Utah FORGE 16A(78)-32: casing runs and cement jobs as the daily drilling reports (GDR 1283)
 * record them. The wellhead and master valve are reported only in the summary, undated; they are
 * shown from rig release.
 */
export const forgeInstalls: readonly InstallEvent[] = Object.freeze([
  { componentId: "surface-casing", date: "2020-11-01", page: 3, label: "13 3/8 in surface casing run to 1,629 ft" },
  { componentId: "surface-cement", date: "2020-11-01", page: 3, label: "Surface casing cemented to surface" },
  { componentId: "intermediate-casing", date: "2020-11-12", page: 8, label: "9 5/8 in intermediate casing run to 5,113 ft" },
  { componentId: "production-casing", date: "2021-01-01", page: 18, label: "7 in casing run to 5,936 ft", runToFt: 5936 },
  { componentId: "production-casing", date: "2021-01-02", page: 19, label: "7 in casing run to bottom (229 joints)" },
  { componentId: "production-cement", date: "2021-01-03", page: 19, label: "7 in casing cemented" },
  { componentId: "wellhead", date: "2021-01-12", page: 71, label: "Thread-on wellhead on the 7 in casing", note: "Undated in the daily reports; shown from rig release." },
  { componentId: "master-valve", date: "2021-01-12", page: 71, label: "Master valve installed securing the well", note: "Undated in the daily reports; shown from rig release." },
].map((event) => Object.freeze(event)));

const DAY_MS = 86_400_000;
/** A report date as UTC midnight, epoch milliseconds. */
export const dateToMs = (date: string): number => {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms)) throw new RangeError(`Not a date: ${date}`);
  return ms;
};
/** The report date (YYYY-MM-DD) a moment falls on. */
export const msToDate = (ms: number): string => new Date(Math.floor(ms / DAY_MS) * DAY_MS).toISOString().slice(0, 10);

/** The span a history covers: first report to the last dated event, with spud and every report date. */
export function historySpan(operations: WellOperations, installs: readonly InstallEvent[] = []) {
  const dates = [...operations.days.map((day) => day.date), ...operations.milestones.map((milestone) => milestone.date), ...installs.map((event) => event.date)].sort();
  const spud = operations.milestones.find((milestone) => milestone.id === "spud")?.date ?? null;
  return { first: dates[0]!, last: dates.at(-1)!, spud, reportDates: operations.days.map((day) => day.date) };
}

export interface WellAsOf {
  readonly date: string;
  /** Days from spud, null before a spud milestone exists. */
  readonly dayFromSpud: number | null;
  /** That date's daily report, or null when there is none for the date. */
  readonly report: WellDay | null;
  /** Deepest measured depth reported by that date, feet as reported and metres. */
  readonly drilledFt: number;
  readonly drilledM: number;
  /** The well's components as they stood: holes to the depth drilled, strings run, cement placed. */
  readonly components: readonly WellComponent[];
  /** Ids of every component present, including strings run part of the way. */
  readonly installedIds: readonly string[];
  /** Ids of components whose install was complete (not part-run). */
  readonly completeIds: readonly string[];
  /** What happened on that date: installs and milestones. */
  readonly events: readonly InstallEvent[];
  readonly milestones: readonly WellMilestone[];
}

/** The well on a date, from its records and dated installs. */
export function wellAsOf(operations: WellOperations, components: readonly WellComponent[], installs: readonly InstallEvent[], date: string): WellAsOf {
  dateToMs(date);
  const reached = [
    ...operations.milestones.filter((milestone) => milestone.date <= date && milestone.mdFt !== null).map((milestone) => milestone.mdFt as number),
    ...operations.days.filter((day) => day.date <= date && day.mdFt !== null).map((day) => day.mdFt as number),
  ];
  const drilledFt = reached.length ? Math.max(...reached) : 0;
  const drilledM = feetToMetres(drilledFt);
  const known = new Set(components.map((component) => component.id as string));
  const latest = new Map<string, InstallEvent>();
  for (const event of installs) {
    if (!known.has(event.componentId)) throw new RangeError(`Install event names an unknown component: ${event.componentId}`);
    if (event.date <= date && (!latest.has(event.componentId) || latest.get(event.componentId)!.date <= event.date)) latest.set(event.componentId, event);
  }
  const dated = new Set(installs.map((event) => event.componentId));
  const asOf: WellComponent[] = [];
  for (const component of components) {
    if (component.kind === "Hole") {
      if (drilledM <= component.topDepthM) continue;
      asOf.push(drilledM >= component.bottomDepthM ? component : { ...component, bottomDepthM: drilledM, rawBottomDepthFt: drilledFt });
      continue;
    }
    // Components without a dated install appear only when the well is complete: never invented earlier.
    const event = latest.get(component.id);
    if (!event) { if (!dated.has(component.id) && date >= historySpan(operations, installs).last) asOf.push(component); continue; }
    asOf.push(event.runToFt === undefined ? component : { ...component, bottomDepthM: Math.min(component.bottomDepthM, feetToMetres(event.runToFt)), rawBottomDepthFt: event.runToFt });
  }
  const spud = operations.milestones.find((milestone) => milestone.id === "spud")?.date;
  return {
    date,
    dayFromSpud: spud ? Math.round((dateToMs(date) - dateToMs(spud)) / DAY_MS) : null,
    report: operations.days.find((day) => day.date === date) ?? null,
    drilledFt, drilledM,
    components: asOf,
    installedIds: asOf.filter((component) => component.kind !== "Hole").map((component) => component.id),
    completeIds: asOf.filter((component) => component.kind !== "Hole" && latest.get(component.id)?.runToFt === undefined).map((component) => component.id),
    events: installs.filter((event) => event.date === date),
    milestones: operations.milestones.filter((milestone) => milestone.date === date),
  };
}
