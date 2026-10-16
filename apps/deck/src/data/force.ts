import { useEffect, useSyncExternalStore } from "react";
import { metresToFeet } from "@ikhmalputra/subsurface-core";
import type { LasFile } from "@ikhmalputra/subsurface-core/records";
import type { WorldSite } from "@ikhmalputra/subsurface-react";
import type { SiteSceneSurface, SiteSceneWell } from "@ikhmalputra/subsurface-react/3d";
import { BASE } from "../base.ts";
import { busId, decodeForceLogs, groupColour, mdOf, tvdssAt } from "./force-model.ts";
import type { ForceArea, ForceIndex, ForceLogs, ForceWell } from "./force-model.ts";
export * from "./force-model.ts";

/**
 * FORCE 2020: 118 Norwegian North Sea wells, their logs, the Norwegian Offshore Directorate's group
 * and formation tops and casing shoes, and the competition's interpreted lithology (Zenodo 4351156,
 * CC BY 4.0; the Directorate's data under NLOD 2.0). Built by tools/build-force2020.mjs.
 *
 * The index (headers, tops, shoes, paths) loads once the deck starts; each well's logs load when a
 * module first asks for them. Wells are grouped into sites by licence quadrant.
 */

export const FORCE_SOURCE = "FORCE 2020 well log and lithofacies dataset (Zenodo 4351156, CC BY 4.0): logs, tops and casing shoes from the Norwegian Offshore Directorate (NLOD 2.0)";

// ── The index ────────────────────────────────────────────────────────────────────────────────
let index: ForceIndex | null = null;
let loading: Promise<ForceIndex | null> | null = null;
let version = 0;
const listeners = new Set<() => void>();
const changed = () => { version++; for (const listener of [...listeners]) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Loads the index once; resolves to null if it cannot be had (the FORCE sites then stay off the globe). */
export function loadForce(): Promise<ForceIndex | null> {
  loading ??= fetch(`${BASE}data/force2020/wells.json`)
    .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() as Promise<ForceIndex>; })
    .then((value) => { index = value; byArea.clear(); changed(); return value; }, () => { loading = null; return null; });
  return loading;
}
const versionSnapshot = () => version;
/** Re-renders when the index or any well's logs arrive. */
export const useForceVersion = () => useSyncExternalStore(subscribe, versionSnapshot, versionSnapshot);
export const forceWells = (): readonly ForceWell[] => index?.wells ?? [];
export const forceAreas = (): readonly ForceArea[] => index?.areas ?? [];

export const isForceSite = (siteId: string | null) => !!siteId && siteId.startsWith("force-q");
export const forceArea = (siteId: string | null) => forceAreas().find((area) => area.id === siteId) ?? null;
export const areaWells = (areaId: string) => forceWells().filter((well) => well.area === areaId);
export const forceWellByBusId = (id: string | null) => forceWells().find((well) => busId(well) === id) ?? null;

// ── Logs ─────────────────────────────────────────────────────────────────────────────────────
const logs = new Map<string, ForceLogs>();
const pending = new Map<string, Promise<void>>();
const failed = new Map<string, string>();
/** Asks for a well's logs; the store changes when they arrive. */
export function requestForceLogs(well: ForceWell) {
  if (logs.has(well.id) || pending.has(well.id)) return;
  failed.delete(well.id);
  pending.set(well.id, fetch(`${BASE}data/force2020/${well.file}`)
    .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.arrayBuffer(); })
    .then((buffer) => { logs.set(well.id, decodeForceLogs(well, buffer)); }, (cause: unknown) => { failed.set(well.id, cause instanceof Error ? cause.message : String(cause)); })
    .finally(() => { pending.delete(well.id); changed(); }));
}
export const forceLogsOf = (well: ForceWell) => logs.get(well.id) ?? null;
/** The logs of several wells, as they arrive. */
export function useForceLogs(wells: readonly ForceWell[]): { readonly logs: ReadonlyMap<string, ForceLogs>; readonly errors: ReadonlyMap<string, string> } {
  useForceVersion();
  const key = wells.map((well) => well.id).join(",");
  useEffect(() => { for (const well of wells) requestForceLogs(well); }, [key]);
  return {
    logs: new Map(wells.flatMap((well) => logs.has(well.id) ? [[well.id, logs.get(well.id)!] as const] : [])),
    errors: new Map(wells.flatMap((well) => failed.has(well.id) ? [[well.id, failed.get(well.id)!] as const] : [])),
  };
}

/** The logs as a LAS indexed in feet, with the mnemonics the log tracks read (RT for deep resistivity, DT for sonic). */
const lasCache = new WeakMap<ForceLogs, LasFile>();
export function forceLas(entry: ForceLogs): LasFile {
  let las = lasCache.get(entry);
  if (las) return las;
  const { well } = entry;
  const values = (array: Float32Array) => Array.from(array, (value) => Number.isNaN(value) ? null : value);
  const rename: Readonly<Record<string, string>> = { RDEP: "RT", DTC: "DT" };
  const item = (mnemonic: string, unit: string, value: string, description: string) => ({ mnemonic, unit, value, description });
  las = {
    version: "2.0", nullValue: -999.25, parameters: {},
    well: { WELL: item("WELL", "", well.name, "Well"), SRVC: item("SRVC", "", "FORCE 2020 / Norwegian Offshore Directorate", "Source") },
    curves: [
      { mnemonic: "DEPT", unit: "ft", value: "", description: "Measured depth", values: Array.from({ length: well.n }, (_, k) => metresToFeet(mdOf(well, k))) },
      ...well.curves.map((spec) => ({ mnemonic: rename[spec.m] ?? spec.m, unit: spec.unit, value: "", description: spec.m, values: values(entry.curves[spec.m]!) })),
    ],
  };
  lasCache.set(entry, las);
  return las;
}

// ── Sites ────────────────────────────────────────────────────────────────────────────────────
const byArea = new Map<string, WorldSite>();
/** A quadrant area as a site: its wells in one east, north and TVDSS frame, and each group top triangulated between them. */
export function forceSite(areaId: string): WorldSite | null {
  const cached = byArea.get(areaId);
  if (cached) return cached;
  const area = forceArea(areaId);
  const wells = areaWells(areaId).filter((well) => well.utm && well.lonLat);
  if (!area || !wells.length) return null;
  const ox = wells.reduce((sum, well) => sum + well.utm![0], 0) / wells.length, oy = wells.reduce((sum, well) => sum + well.utm![1], 0) / wells.length;
  const scene: SiteSceneWell[] = wells.map((well) => {
    const xyz = new Float64Array(well.survey.length * 3);
    well.survey.forEach(([, e, n, tvdss], i) => { xyz[i * 3] = well.utm![0] + e - ox; xyz[i * 3 + 1] = well.utm![1] + n - oy; xyz[i * 3 + 2] = tvdss; });
    return { id: busId(well), label: well.name, provenance: "documented", xyz, mdM: well.survey.map((station) => station[0]), markers: well.groups.map((top) => ({ mdM: top.md, label: top.name })) };
  });
  const at = (well: ForceWell, md: number): [number, number, number] => {
    const s = well.survey;
    let i = s.findIndex((station) => station[0] >= md);
    if (i < 0) i = s.length - 1;
    const station = s[Math.max(0, i)]!;
    return [well.utm![0] + station[1] - ox, well.utm![1] + station[2] - oy, tvdssAt(well, md)];
  };
  const names = [...new Set(wells.flatMap((well) => well.groups.map((top) => top.name)))];
  const surfaces: SiteSceneSurface[] = [
    { id: "sea", label: "Sea level", provenance: "documented", role: "reference", color: "#3f8fc0", note: "0 m, the depth reference of the Directorate's TVDSS.", geometry: { kind: "plane", depthM: 0 } },
    ...names.flatMap((name) => {
      const points = wells.flatMap((well) => { const top = well.groups.find((entry) => entry.name === name); return top && top.md > well.survey[0]![0] - 1 ? [at(well, top.md)] : []; });
      return points.length >= 3 ? [{ id: `top-${name}`, label: `${name} top`, provenance: "documented" as const, role: "horizon" as const, color: groupColour(name),
        note: `The Directorate's ${name} top in ${points.length} wells, triangulated between them for display. Not a mapped surface.`, geometry: { kind: "tin" as const, points } }] : [];
    }),
  ];
  const plan = (well: ForceWell) => {
    const [lon, lat] = well.lonLat!;
    const k = Math.cos(lat * Math.PI / 180);
    return well.survey.map(([, e, n]) => [lon + e / (111_320 * k), lat + n / 110_574] as [number, number]);
  };
  const site: WorldSite = {
    map: {
      id: area.id, label: area.label, provenance: "documented",
      summary: `${wells.length} wells · logs, Directorate tops, lithology · FORCE 2020`,
      wells: wells.map((well) => ({ id: busId(well), label: well.name, head: well.lonLat!, path: plan(well) })),
    },
    projectWellId: null,
    depthLabel: "m TVD below sea level",
    originLabel: "centre of the area's wells · ED50 / UTM 31N grid",
    wells: scene, surfaces, hasSeismic: false,
    seismicNote: "FORCE 2020 carries no seismic.",
    caveat: "Logs, group tops and casing shoes as the Norwegian Offshore Directorate published them, via FORCE 2020. Each well is placed at the top of its logs. Surfaces between wells are triangulated between the Directorate's picks for display; they are not mapped horizons.",
  };
  byArea.set(areaId, site);
  return site;
}
export function forceSites(): readonly WorldSite[] {
  return forceAreas().map((area) => forceSite(area.id)).filter((site): site is WorldSite => site !== null);
}
