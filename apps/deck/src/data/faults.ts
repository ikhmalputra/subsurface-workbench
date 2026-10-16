import { useSyncExternalStore } from "react";
import { forgeSeismicSection, seismicDepthToTvd } from "@ikhmalputra/subsurface-core";
import type { SiteSceneSurface } from "@ikhmalputra/subsurface-react/3d";
import { faultMesh } from "./fault-model.ts";
import type { Stick, StickPoint } from "./fault-model.ts";
import { planOf } from "./horizons.ts";

/**
 * Faults the user picks on the FORGE PSDM, as sticks on inlines, kept in this browser. Horizons are
 * tracked against them, so a horizon stops at a fault and can be seeded again across it.
 */

export interface Fault {
  readonly id: string;
  readonly name: string;
  readonly colour: string;
  readonly sticks: readonly Stick[];
  /** The points in the order they were picked, last last: what an undo takes off. */
  readonly history: readonly { readonly o: number; readonly a: number; readonly s: number }[];
  readonly visible: boolean;
  readonly createdAt: number;
}

const KEY = "deck-faults-v1";
const COLOURS = ["#ef4444", "#f97316", "#e11d48", "#dc2626"];
let faults: readonly Fault[] = (() => { try { const value = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Fault[]; return Array.isArray(value) ? value : []; } catch { return []; } })();
const listeners = new Set<() => void>();
function changed(next: readonly Fault[]) {
  faults = next;
  try { localStorage.setItem(KEY, JSON.stringify(faults)); } catch { /* not kept */ }
  for (const listener of [...listeners]) listener();
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => faults;
export const useFaults = () => useSyncExternalStore(subscribe, snapshot, snapshot);

export function addFault(): Fault {
  const fault: Fault = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: `Fault ${faults.length + 1}`, colour: COLOURS[faults.length % COLOURS.length]!, sticks: [], history: [], visible: true, createdAt: Date.now() };
  changed([...faults, fault]);
  return fault;
}
export const updateFault = (id: string, patch: Partial<Pick<Fault, "name" | "visible">>) => changed(faults.map((entry) => entry.id === id ? { ...entry, ...patch } : entry));
export const removeFault = (id: string) => changed(faults.filter((entry) => entry.id !== id));

/** Adds a point to the fault's stick on inline `o`, starting the stick if there is none; points stay in depth order. */
export function addStickPoint(id: string, o: number, point: StickPoint) {
  changed(faults.map((fault) => {
    if (fault.id !== id) return fault;
    const stick = fault.sticks.find((entry) => entry.o === o);
    const next: Stick = { o, points: [...(stick?.points ?? []), point].sort((x, y) => x.s - y.s) };
    return { ...fault, history: [...fault.history, { o, ...point }].slice(-200), sticks: [...fault.sticks.filter((entry) => entry.o !== o), next].sort((x, y) => x.o - y.o) };
  }));
}
/** Takes the last point picked off the fault, and its stick with it when that was the stick's only point. */
export function undoStickPoint(id: string) {
  changed(faults.map((fault) => {
    const last = fault.id === id ? fault.history.at(-1) : undefined;
    if (!last) return fault;
    const sticks = fault.sticks.flatMap((stick) => {
      if (stick.o !== last.o) return [stick];
      const at = stick.points.findIndex((p) => p.a === last.a && p.s === last.s);
      const points = stick.points.filter((_, i) => i !== at);
      return points.length ? [{ ...stick, points }] : [];
    });
    return { ...fault, sticks, history: fault.history.slice(0, -1) };
  }));
}

/** Every fault's sticks, for tracking against. */
export const allSticks = (list: readonly Fault[]) => list.filter((fault) => fault.sticks.length).map((fault) => fault.sticks);
/** A short key for a set of faults: grids tracked against them are cached by it. */
export const faultsKey = (list: readonly Fault[]) => list.map((fault) => fault.sticks.map((stick) => `${stick.o}:${stick.points.map((p) => `${p.a.toFixed(1)}/${p.s.toFixed(1)}`).join(",")}`).join(";")).join("|");

const cut = forgeSeismicSection.subVolume!;
/** A point in bin space as the site draws it: east, north and TVD below RKB. */
export function siteOf(a: number, o: number, s: number): [number, number, number] {
  const [e, n] = planOf(cut.alongFromM + a * cut.spacingM, cut.offsetFromM + o * cut.spacingM);
  return [e, n, seismicDepthToTvd(s * cut.sampleIntervalM, forgeSeismicSection.rkbElevationM, forgeSeismicSection.seismicDatumElevationM)];
}

/** A fault as the site draws it: its sticks joined into a surface; null until it has two sticks. */
export function faultSurfaceOf(fault: Fault): SiteSceneSurface | null {
  const mesh = faultMesh(fault.sticks);
  if (!mesh.triangles.length) return null;
  return {
    id: `fault-${fault.id}`, label: fault.name, provenance: "user-authored", role: "horizon", color: fault.colour,
    note: `Picked on the FORGE PSDM as ${fault.sticks.length} sticks on inlines and joined between them. Your interpretation; not a mapped fault.`,
    geometry: { kind: "tin", points: mesh.points.map(([a, o, s]) => siteOf(a, o, s)), triangles: mesh.triangles },
  };
}
/** Each fault's sticks as lines in the site, over its surface (or alone, while it has one stick); a lone point is a short tick. The fault is named on its first stick. */
export function stickLinesOf(list: readonly Fault[]) {
  return list.filter((fault) => fault.visible).flatMap((fault) => fault.sticks.map((stick, i) => ({
    label: i === 0 ? fault.name : "", color: fault.colour, emphasis: true,
    points: (stick.points.length === 1 ? [{ ...stick.points[0]!, s: stick.points[0]!.s - 3 }, { ...stick.points[0]!, s: stick.points[0]!.s + 3 }] : stick.points).map((p) => siteOf(p.a, stick.o, p.s)),
  })));
}
