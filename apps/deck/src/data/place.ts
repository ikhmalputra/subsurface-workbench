import { useMemo } from "react";
import { metresToFeet, tvdAtSurveyMd } from "@ikhmalputra/subsurface-core";
import type { ComputedStation, FormationLayer, SurveyPoint, WellAssembly, WellComponent, WellDesign } from "@ikhmalputra/subsurface-core";
import type { LasFile, WellOperations } from "@ikhmalputra/subsurface-core/records";
import type { SyntheticLogs } from "@ikhmalputra/subsurface-core/contracts";
import { equatorField, equatorPetrophysics } from "@ikhmalputra/subsurface-react";
import { useDeck } from "../deck/store.ts";
import { analyse, designForSite, useDesign } from "./design.ts";
import { assemblyOfRecord, baseRecord, designOfRecord, editedValue, layersOf, recordedForSite, same, surveyOf, useRecordsVersion } from "./records.ts";
import type { WellRecordValue } from "./records.ts";
import { forgeWell, surveyFrom } from "./sites.ts";
import { shoes as forgeShoes } from "./forge.ts";
import { areaWells, busId, forceArea, forceFormations, forceLas, forceLogsOf, forceStations, forceWellByBusId, isForceSite, requestForceLogs, useForceVersion } from "./force.ts";
import type { ForceLogs, ForceWell } from "./force.ts";

/**
 * The well the deck is on, in one shape whatever the site: FORGE (documented records), Kestrel A-7
 * (a live design), one Equator well (a synthetic trajectory with synthetic logs) or one FORCE 2020
 * well (the Norwegian Offshore Directorate's logs and tops). A module asks
 * the place for what it needs; what a place does not have is null, and the module says so.
 */
export interface Place {
  readonly siteId: string;
  /** What kind of place: FORGE's records, an Equator well, a planned well (Kestrel A-7 or one of the user's), or a drilled well the user entered. */
  readonly kind: "forge" | "equator" | "design" | "recorded" | "force";
  /** Changes the user made over the well's records; 0 for a well as recorded. */
  readonly edits: number;
  /** The id the signal bus knows the well by. */
  readonly wellId: string;
  readonly label: string;
  readonly provenance: "documented" | "synthetic" | "user-authored";
  readonly design: WellDesign | null;
  readonly components: readonly WellComponent[];
  readonly assembly: WellAssembly | null;
  readonly stations: readonly SurveyPoint[];
  readonly survey: readonly ComputedStation[];
  readonly formations: readonly FormationLayer[];
  readonly totalDepthM: number;
  readonly operations: WellOperations | null;
  /** Synthetic open-hole logs, for petrophysics. */
  readonly petro: SyntheticLogs | null;
  /** The petrophysical logs as a LAS indexed in feet, for the log tracks. */
  readonly petroLas: LasFile | null;
}

const project = equatorField();
const equatorLogs = equatorPetrophysics(project);

/** A LAS in metres re-indexed in feet: the log tracks read feet, as the FORGE mud log is recorded. */
function inFeet(las: LasFile): LasFile {
  const [index, ...rest] = las.curves;
  return { ...las, curves: [{ ...index!, unit: "ft", values: index!.values.map((value) => value === null ? null : metresToFeet(value)) }, ...rest] };
}

/** Inclination and azimuth between stations from positions, for a trajectory supplied as points. */
function stationsFromPoints(md: ArrayLike<number>, xyz: ArrayLike<number>, waterM: number): SurveyPoint[] {
  const points: SurveyPoint[] = [];
  for (let i = 0; i < md.length; i++) {
    const j = Math.max(1, i);
    const de = xyz[j * 3]! - xyz[(j - 1) * 3]!, dn = xyz[j * 3 + 1]! - xyz[(j - 1) * 3 + 1]!, dz = xyz[j * 3 + 2]! - xyz[(j - 1) * 3 + 2]!;
    const horizontal = Math.hypot(de, dn);
    points.push({ mdM: md[i]!, tvdM: xyz[i * 3 + 2]! + waterM, eastingM: xyz[i * 3]! - xyz[0]!, northingM: xyz[i * 3 + 1]! - xyz[1]!, inclinationDeg: Math.atan2(horizontal, dz) * 180 / Math.PI, azimuthDeg: (Math.atan2(de, dn) * 180 / Math.PI + 360) % 360 });
  }
  return points;
}

const equatorPlaces = new Map(project.records.map((record, index) => {
  const water = project.waterDepthsM[record.well.id]!;
  const stations = stationsFromPoints(record.well.depthsMdM, record.well.xyz, water);
  const logs = equatorLogs[index]!.logs;
  const place: Place = {
    siteId: "equator", kind: "equator", edits: 0, wellId: record.well.id, label: record.well.label, provenance: "synthetic",
    design: null, components: [], assembly: null, stations, survey: surveyFrom(stations),
    formations: [], totalDepthM: stations.at(-1)!.mdM, operations: null, petro: logs, petroLas: inFeet(logs.las),
  };
  return [record.well.id, place] as const;
}));
const equatorWellIds = project.records.map((record) => record.well.id);
/** The Equator wells by name, for lists that must say why they cannot draw one. */
export const equatorWells = project.records.map((record) => ({ id: record.well.id, label: record.well.label }));

const forgePlace: Place = {
  siteId: "forge", kind: "forge", edits: 0, wellId: "forge", label: "16A(78)-32", provenance: "documented",
  design: forgeWell.design, components: forgeWell.components, assembly: forgeWell.assembly, stations: forgeWell.design.survey ?? [], survey: forgeWell.survey,
  formations: forgeWell.design.formations ?? [], totalDepthM: forgeWell.design.totalDepthM, operations: forgeWell.operations, petro: null, petroLas: null,
};

/** The store's id for a site's well: FORGE and Kestrel have one; on Equator, the chosen well or the first. */
export function wellIdFor(siteId: string | null, wellId: string | null): string | null {
  if (siteId === "forge") return "forge";
  const design = designForSite(siteId);
  if (design) return design.wellId;
  const recorded = recordedForSite(siteId);
  if (recorded) return recorded.wellId;
  if (siteId === "equator") return wellId && equatorPlaces.has(wellId) ? wellId : equatorWellIds[0]!;
  if (isForceSite(siteId)) {
    const wells = areaWells(siteId!);
    const chosen = wells.find((well) => busId(well) === wellId) ?? wells[0];
    return chosen ? busId(chosen) : null;
  }
  return null;
}

/** A FORCE well as a place: built once, and again when its logs arrive. */
const forcePlaces = new Map<string, { readonly logs: ForceLogs | null; readonly place: Place }>();
function forcePlace(well: ForceWell): Place {
  const logs = forceLogsOf(well);
  const kept = forcePlaces.get(well.id);
  if (kept && kept.logs === logs) return kept.place;
  if (!logs) requestForceLogs(well);
  const stations = forceStations(well);
  const place: Place = {
    siteId: well.area, kind: "force", edits: 0, wellId: busId(well), label: well.name, provenance: "documented",
    design: null, components: [], assembly: null, stations, survey: surveyFrom(stations), formations: forceFormations(well),
    totalDepthM: well.mdBase, operations: null, petro: null, petroLas: logs ? forceLas(logs) : null,
  };
  forcePlaces.set(well.id, { logs, place });
  return place;
}

/** A well already in the deck, as its records give it, before any edit: what the editor edits. */
export function basePlace(siteId: string | null, wellId: string | null): Place | null {
  if (siteId === "forge") return forgePlace;
  if (siteId === "equator") return equatorPlaces.get(wellIdFor(siteId, wellId)!) ?? null;
  if (isForceSite(siteId) && forceArea(siteId)) { const well = forceWellByBusId(wellIdFor(siteId, wellId)); return well ? forcePlace(well) : null; }
  return null;
}
const bases = new WeakMap<Place, WellRecordValue>();
/** That well as an editable record. */
export function baseOf(place: Place): WellRecordValue {
  let base = bases.get(place);
  if (!base) {
    base = baseRecord({ name: place.label, field: place.kind === "forge" ? "Utah FORGE" : place.kind === "force" ? forceArea(place.siteId)?.label ?? "" : "Equator", stations: place.stations, formations: place.formations, tops: place.petro?.well.tops, components: place.components, totalDepthM: place.totalDepthM, surveySource: place.design?.trajectorySource ?? "" });
    bases.set(place, base);
  }
  return base;
}

/** A well with the user's edits over its records: only what changed is rebuilt, the rest is the record's own. */
function edited(place: Place, value: WellRecordValue): Place {
  const base = baseOf(place);
  let edits = 0;
  const changed = <K extends keyof WellRecordValue>(key: K) => { const differs = !same(value[key], base[key]); if (differs) edits++; return differs; };
  const stationsChanged = changed("stations"), componentsChanged = changed("components"), topsChanged = changed("tops"), depthChanged = changed("totalDepthM"), nameChanged = changed("identity");
  if (!edits) return place;
  const stations = stationsChanged || depthChanged ? surveyOf(value.stations, value.totalDepthM) : place.stations;
  const components = componentsChanged ? value.components : place.components;
  const formations = topsChanged || stationsChanged ? layersOf(value.tops, stations, value.totalDepthM) : place.formations;
  const totalDepthM = depthChanged ? value.totalDepthM : place.totalDepthM;
  const label = nameChanged ? value.identity.name || place.label : place.label;
  return {
    ...place, edits, label, stations, survey: stationsChanged || depthChanged ? surveyFrom(stations) : place.survey, components, formations, totalDepthM,
    assembly: componentsChanged || depthChanged ? assemblyOfRecord(place.wellId, { ...value, totalDepthM }) : place.assembly,
    design: place.design ? { ...place.design, survey: stations, components, formations, totalDepthM } : null,
  };
}

/** The place the deck is on; a planned well follows its live design, what-if included; an edited well shows the edits. */
export function usePlace(): Place | null {
  const siteId = useDeck((deck) => deck.siteId), wellId = useDeck((deck) => deck.wellId);
  const { brief } = useDesign();
  const records = useRecordsVersion();
  const force = useForceVersion();
  return useMemo(() => {
    const base = basePlace(siteId, wellId);
    if (base) { const value = editedValue(base.wellId); return value ? edited(base, value) : base; }
    const entry = recordedForSite(siteId);
    if (entry) {
      const value = entry.history.current();
      const design = designOfRecord(entry.wellId, value);
      const stations = design.survey ?? [];
      return {
        siteId: entry.siteId, kind: "recorded", edits: 0, wellId: entry.wellId, label: value.identity.name || "Unnamed well", provenance: "user-authored",
        design, components: value.components, assembly: assemblyOfRecord(entry.wellId, value), stations, survey: surveyFrom(stations),
        formations: design.formations ?? [], totalDepthM: value.totalDepthM, operations: null, petro: null, petroLas: null,
      } satisfies Place;
    }
    const record = designForSite(siteId);
    if (record) {
      const analysis = analyse(brief);
      const stations = analysis.design.survey ?? [];
      return {
        siteId: record.siteId, kind: "design", edits: 0, wellId: record.wellId, label: brief.identity.name || "Unnamed well", provenance: "synthetic",
        design: analysis.design, components: analysis.design.components ?? [], assembly: analysis.assembly, stations,
        survey: surveyFrom(stations),
        formations: analysis.design.formations ?? [], totalDepthM: brief.totalDepthMdM, operations: null, petro: null, petroLas: null,
      } satisfies Place;
    }
    return null;
  }, [siteId, wellId, brief, records, force]);
}

/** TVD at an MD on a place's path; null outside its stations. */
export const tvdOn = (place: Place, mdM: number): number | null => tvdAtSurveyMd(place.stations, mdM);

const isString = (component: WellComponent) => component.kind === "Casing" || component.kind === "Tubular";
/** The strings a place has: casing and tubing. */
export const stringsOf = (place: Place) => place.components.filter(isString);

/** Shoes to mark: FORGE's at the reported depths, a design's at its strings' planned shoes. */
export function shoesOf(place: Place): readonly { readonly id: string; readonly mdM: number; readonly label: string }[] {
  if (place.siteId === "forge") return forgeShoes;
  if (place.kind === "force") return (forceWellByBusId(place.wellId)?.shoes ?? []).map((shoe, i) => ({ id: `${place.wellId}-shoe-${i}`, mdM: shoe.md, label: `${shoe.odIn === null ? shoe.label : `${shoe.odIn} in`} shoe` }));
  return place.components.filter((component) => component.kind === "Casing").map((component) => ({ id: component.id, mdM: component.bottomDepthM, label: `${component.name.split(" / ")[0]} shoe` }));
}

/** What is at a depth on a place: strings (innermost first), the hole, the formation. */
export function placeAt(place: Place, mdM: number) {
  const strings = stringsOf(place).filter((component) => component.topDepthM <= mdM && component.bottomDepthM >= mdM).sort((a, b) => (a.outerDiameterMm ?? 0) - (b.outerDiameterMm ?? 0));
  const hole = place.components.find((component) => component.kind === "Hole" && component.topDepthM <= mdM && component.bottomDepthM >= mdM) ?? null;
  const tvd = tvdOn(place, mdM);
  const formation = tvd === null ? null : place.formations.find((layer) => layer.topTvdM <= tvd && layer.bottomTvdM > tvd) ?? null;
  const zone = place.petro?.well.zones.find((entry) => entry.topMdM <= mdM && entry.baseMdM > mdM) ?? null;
  return { strings, hole, formation, tvd, zone };
}
