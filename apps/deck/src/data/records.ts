import { useSyncExternalStore } from "react";
import { computeMinimumCurvature, mdAtSurveyTvd, tvdAtSurveyMd, wellComponentsToAssembly } from "@ikhmalputra/subsurface-core";
import type { DepthReference, FormationLayer, SurveyPoint, WellComponent, WellDesign, WellEnvironment } from "@ikhmalputra/subsurface-core";
import { createEditHistory } from "@ikhmalputra/subsurface-core/state";
import type { EditHistory, EditState } from "@ikhmalputra/subsurface-core/state";
import { reprojectGisXY } from "@ikhmalputra/subsurface-core/gis";
import { utmZoneOf } from "@ikhmalputra/subsurface-react";
import type { WorldSite } from "@ikhmalputra/subsurface-react";
import type { EnteredStation } from "./entry.ts";

/**
 * Drilled wells as a user records them, and the user's edits to the wells already in the deck.
 *
 * A recorded well is the user's own: identity, place, datum, survey stations, formation tops and
 * construction records, every value entered here. An edit to an existing well (FORGE 16A, an
 * Equator well) never overwrites the record: the edited well is kept beside its base, and the deck
 * draws the edited one while every row says whether it is the record's or yours. Both are kept in
 * this browser; each has its own named, undoable history.
 */

export interface EnteredTop { readonly id: string; readonly name: string; readonly topMdM: number; readonly lithology: string; readonly source: string }
export interface WellRecordValue {
  readonly identity: { readonly name: string; readonly field: string; readonly operator: string; readonly country: string; readonly uwi: string };
  readonly location: { readonly environment: WellEnvironment; readonly latitude: number | null; readonly longitude: number | null; readonly groundElevationM: number | null; readonly waterDepthM: number | null };
  readonly datum: { readonly reference: DepthReference; readonly elevationMslM: number | null };
  readonly totalDepthM: number;
  readonly stations: readonly EnteredStation[];
  /** Where the stations came from, as the user says: "Gyro survey, contractor report 12 Mar 2023". */
  readonly surveySource: string;
  readonly tops: readonly EnteredTop[];
  readonly components: readonly WellComponent[];
}

export interface RecordEntry {
  /** A recorded well's own id, or for an edit the id of the well it edits. */
  readonly id: string;
  readonly kind: "recorded" | "edit";
  readonly siteId: string;
  readonly wellId: string;
  readonly createdAt: number;
  readonly history: EditHistory<WellRecordValue>;
  /** For an edit: the well as its records give it. */
  readonly base: WellRecordValue | null;
}

const KEY = "deck-wells-v1";
interface Stored { readonly recorded: readonly { readonly id: string; readonly createdAt: number; readonly value: WellRecordValue }[]; readonly edits: readonly { readonly wellId: string; readonly siteId: string; readonly value: WellRecordValue }[] }
const stored: Stored = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null") as Stored | null;
    return value && Array.isArray(value.recorded) && Array.isArray(value.edits) ? value : { recorded: [], edits: [] };
  } catch { return { recorded: [], edits: [] }; }
})();

let version = 0;
const listeners = new Set<() => void>();
const changed = () => { version++; for (const listener of [...listeners]) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function make(kind: RecordEntry["kind"], id: string, siteId: string, wellId: string, value: WellRecordValue, base: WellRecordValue | null, createdAt: number): RecordEntry {
  const history = createEditHistory<WellRecordValue>(value);
  history.subscribe(() => { save(); changed(); });
  return { id, kind, siteId, wellId, createdAt, history, base };
}

let recorded: readonly RecordEntry[] = stored.recorded.map((entry) => make("recorded", entry.id, `rec-${entry.id}`, `rec-${entry.id}-well`, entry.value, null, entry.createdAt));
/** Edits, by the id of the well they edit; made when the well is first opened in the editor. */
const edits = new Map<string, RecordEntry>();

function save() {
  try {
    const value: Stored = {
      recorded: recorded.map((entry) => ({ id: entry.id, createdAt: entry.createdAt, value: entry.history.getState().committed })),
      edits: [...edits.values()].filter((entry) => !same(entry.history.getState().committed, entry.base))
        .map((entry) => ({ wellId: entry.wellId, siteId: entry.siteId, value: entry.history.getState().committed })),
    };
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch { /* not kept: private window or storage full */ }
}

/** The well the deck is on, for what is decided without a place at hand (module availability). */
let activeWell = "";
export const setActiveEditWell = (wellId: string | null) => { activeWell = wellId ?? ""; };
export const activeEditWell = () => activeWell;

export const recordedForSite = (siteId: string | null) => recorded.find((entry) => entry.siteId === siteId) ?? null;
export const isRecordedSite = (siteId: string | null) => recordedForSite(siteId) !== null;

/** The edit of an existing well: the stored one, or a fresh one from its base the first time it is opened. */
export function editOf(wellId: string, siteId: string, base: WellRecordValue): RecordEntry {
  let entry = edits.get(wellId);
  if (!entry) {
    const kept = stored.edits.find((edit) => edit.wellId === wellId)?.value;
    entry = make("edit", wellId, siteId, wellId, kept ?? base, base, Date.now());
    edits.set(wellId, entry);
  }
  return entry;
}
/** A kept edit's value, without creating one: what the deck draws for an existing well. */
export function editedValue(wellId: string): WellRecordValue | null {
  const entry = edits.get(wellId);
  if (entry) { const state = entry.history.getState(); return state.pending?.value ?? state.committed; }
  return stored.edits.find((edit) => edit.wellId === wellId)?.value ?? null;
}

export function addRecordedWell(value: WellRecordValue): RecordEntry {
  if (value.location.latitude === null || value.location.longitude === null) throw new RangeError("A recorded well needs a surface location.");
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const entry = make("recorded", id, `rec-${id}`, `rec-${id}-well`, value, null, Date.now());
  recorded = [...recorded, entry];
  save(); changed();
  return entry;
}
export function deleteRecordedWell(id: string) {
  recorded = recorded.filter((entry) => entry.id !== id);
  save(); changed();
}

/** One named, undoable step on a well's record. */
export function commitRecord(entry: RecordEntry, label: string, change: (value: WellRecordValue) => WellRecordValue) {
  const next = change(entry.history.getState().committed);
  entry.history.propose(label, next);
  entry.history.apply();
}

/** Every recorded well with what it now holds, and the version, for lists and places. */
export interface RecordListing { readonly entry: RecordEntry; readonly value: WellRecordValue }
let listingAt = -1, listing: readonly RecordListing[] = [];
const listingSnapshot = () => {
  if (listingAt !== version) { listingAt = version; listing = recorded.map((entry) => ({ entry, value: entry.history.current() })); }
  return listing;
};
export const useRecordedWells = (): readonly RecordListing[] => useSyncExternalStore(subscribe, listingSnapshot, listingSnapshot);
const versionSnapshot = () => version;
/** Re-renders on any change to any record or edit. */
export const useRecordsVersion = () => useSyncExternalStore(subscribe, versionSnapshot, versionSnapshot);
export function useRecordState(entry: RecordEntry | null): EditState<WellRecordValue> | null {
  useRecordsVersion();
  return entry ? entry.history.getState() : null;
}

/* ---- from a record to what the deck draws ---- */

const LAYER_COLOURS = ["#d9c9a7", "#b4bec4", "#c8b8d8", "#a8c8b0", "#d8b0a0", "#b0c0d8"];

/**
 * Positions by minimum curvature from entered stations; empty with fewer than two. With a total
 * depth below the last station, the survey is projected to TD along the last station's inclination
 * and azimuth, the usual practice, and `projectedFromM` says from where.
 */
export function surveyOf(entered: readonly EnteredStation[], totalDepthM?: number): readonly SurveyPoint[] {
  const last = entered.at(-1);
  const stations = last && totalDepthM !== undefined && totalDepthM > last.mdM + 0.5 ? [...entered, { ...last, mdM: totalDepthM }] : entered;
  if (stations.length < 2) return [];
  return computeMinimumCurvature(stations.map((station) => ({ mdM: station.mdM, inclinationDeg: station.inclinationDeg, azimuthDeg: station.azimuthDeg })))
    .map((point) => ({ mdM: point.mdM, tvdM: point.tvdM, eastingM: point.eastingM, northingM: point.northingM, inclinationDeg: point.inclinationDeg, azimuthDeg: point.azimuthDeg }));
}
const tvdOr = (survey: readonly SurveyPoint[], mdM: number) => survey.length ? tvdAtSurveyMd(survey, mdM) ?? mdM : mdM;
/** Formation layers from tops by MD: each runs to the next top, the last to TD. */
export function layersOf(tops: readonly EnteredTop[], survey: readonly SurveyPoint[], totalDepthM: number): readonly FormationLayer[] {
  const sorted = [...tops].sort((a, b) => a.topMdM - b.topMdM);
  return sorted.map((top, index) => ({
    id: top.id, name: top.name, lithology: top.lithology || "not reported", topTvdM: tvdOr(survey, top.topMdM), bottomTvdM: tvdOr(survey, sorted[index + 1]?.topMdM ?? totalDepthM),
    densityKgM3: null, porosityPct: null, color: LAYER_COLOURS[index % LAYER_COLOURS.length]!, interpretation: top.source || "Entered on the deck",
  }));
}

/** A recorded well as the views read a design: its survey, construction and formations. */
export function designOfRecord(wellId: string, value: WellRecordValue): WellDesign {
  const survey = surveyOf(value.stations, value.totalDepthM);
  const last = value.stations.at(-1);
  return {
    id: wellId, revision: 1, units: "m", provenance: "user-authored", wellName: value.identity.name || "Unnamed well",
    casingBottomM: Math.max(0, ...value.components.filter((component) => component.kind === "Casing").map((component) => component.bottomDepthM)),
    totalDepthM: value.totalDepthM, surveyStatus: "observed", survey, depthDatum: value.datum.reference,
    ...(value.datum.elevationMslM !== null ? { referenceElevationMslM: value.datum.elevationMslM } : {}),
    formations: layersOf(value.tops, survey, value.totalDepthM), components: value.components,
    trajectorySource: value.surveySource || "Entered on the deck",
    ...(last && value.totalDepthM > last.mdM + 0.5 ? { trajectoryNote: `Projected from the last station at ${Math.round(last.mdM)} m to TD at ${Math.round(value.totalDepthM)} m along its inclination and azimuth.` } : {}),
  };
}
export const assemblyOfRecord = (wellId: string, value: WellRecordValue) => wellComponentsToAssembly({ id: wellId, name: value.identity.name || "Unnamed well", totalDepthM: value.totalDepthM, components: value.components });

/** A recorded well's site: its head and path on the globe, the well in 3D, the ground or sea. */
const siteCache = new WeakMap<WellRecordValue, WorldSite>();
export function siteOfRecord(entry: RecordEntry, value: WellRecordValue): WorldSite | null {
  const cached = siteCache.get(value);
  if (cached) return cached;
  const { latitude, longitude } = value.location;
  if (latitude === null || longitude === null) return null;
  const crs = utmZoneOf(longitude, latitude);
  const head = reprojectGisXY([longitude, latitude], "EPSG:4326", crs);
  const survey = surveyOf(value.stations, value.totalDepthM);
  const name = value.identity.name || "Unnamed well";
  const rkb = value.datum.elevationMslM ?? 0;
  const offshore = value.location.environment !== "onshore";
  const ground = value.location.groundElevationM;
  const shoes = value.components.filter((component) => component.kind === "Casing").map((component) => ({ mdM: component.bottomDepthM, label: `${component.name.split(" / ")[0]} shoe` }));
  const site: WorldSite = {
    map: {
      id: entry.siteId, label: `${name} (entered)`, provenance: "user-authored",
      summary: `1 drilled well · ${value.stations.length} stations · ${value.components.filter((component) => component.kind === "Casing").length} strings · entered on the deck`,
      wells: [{ id: entry.wellId, label: name, head: [longitude, latitude], path: survey.map((point) => reprojectGisXY([head[0] + point.eastingM, head[1] + point.northingM], crs, "EPSG:4326")) }],
    },
    projectWellId: null,
    depthLabel: `m TVD below ${value.datum.reference}${value.datum.elevationMslM !== null ? ` (${value.datum.elevationMslM} m above MSL)` : ""}`,
    originLabel: `wellhead · ${crs}`,
    wells: [{ id: entry.wellId, label: name, provenance: "user-authored", xyz: Float64Array.from(survey.flatMap((point) => [point.eastingM, point.northingM, point.tvdM])), mdM: Float64Array.from(survey.map((point) => point.mdM)), markers: shoes }],
    surfaces: offshore
      ? [{ id: "sea", label: "Sea surface", provenance: "user-authored", role: "reference", color: "#3f8fc0", note: `Mean sea level, ${rkb} m below the ${value.datum.reference}.`, geometry: { kind: "plane", depthM: rkb } },
        ...(value.location.waterDepthM !== null ? [{ id: "seabed", label: "Seabed", provenance: "user-authored" as const, role: "reference" as const, color: "#6b7f6a", note: `Flat at the entered ${value.location.waterDepthM} m water depth. Not bathymetry.`, geometry: { kind: "plane" as const, depthM: rkb + value.location.waterDepthM } }] : [])]
      : ground !== null && value.datum.elevationMslM !== null ? [{ id: "ground", label: "Ground", provenance: "user-authored", role: "reference", color: "#8a7a5c", note: `Flat at the entered ${ground} m ground elevation.`, geometry: { kind: "plane", depthM: rkb - ground } }] : [],
    hasSeismic: false,
    seismicNote: "No seismic: none has been entered for this well.",
    caveat: `Entered on the deck. ${name}'s survey, tops and construction are what was typed, pasted or imported here, with the sources noted beside them; nothing was taken from elsewhere.`,
  };
  siteCache.set(value, site);
  return site;
}

/** A well already in the deck, as an editable record: what the editor starts an edit from. */
export function baseRecord(input: { readonly name: string; readonly field: string; readonly stations: readonly SurveyPoint[]; readonly formations: readonly FormationLayer[]; readonly tops?: readonly { readonly name: string; readonly mdM: number }[]; readonly components: readonly WellComponent[]; readonly totalDepthM: number; readonly surveySource: string }): WellRecordValue {
  const tops: EnteredTop[] = input.formations.length
    ? input.formations.map((layer) => ({ id: layer.id, name: layer.name, topMdM: Math.round((mdAtSurveyTvd(input.stations, layer.topTvdM) ?? layer.topTvdM) * 10) / 10, lithology: layer.lithology, source: layer.interpretation ?? "" }))
    : (input.tops ?? []).map((top, index) => ({ id: `top-${index}`, name: top.name, topMdM: Math.round(top.mdM * 10) / 10, lithology: "", source: "The field's picks" }));
  return {
    identity: { name: input.name, field: input.field, operator: "", country: "", uwi: "" },
    location: { environment: "onshore", latitude: null, longitude: null, groundElevationM: null, waterDepthM: null },
    datum: { reference: "RKB", elevationMslM: null },
    totalDepthM: input.totalDepthM,
    stations: input.stations.map((station) => ({ mdM: station.mdM, inclinationDeg: station.inclinationDeg, azimuthDeg: station.azimuthDeg })),
    surveySource: input.surveySource, tops, components: input.components,
  };
}
