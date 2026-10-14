import { useMemo } from "react";
import { metresToFeet, tvdAtSurveyMd } from "@ikhmalputra/subsurface-core";
import type { ComputedStation, FormationLayer, SurveyPoint, WellAssembly, WellComponent, WellDesign } from "@ikhmalputra/subsurface-core";
import type { LasFile, WellOperations } from "@ikhmalputra/subsurface-core/records";
import type { SyntheticLogs } from "@ikhmalputra/subsurface-core/contracts";
import { equatorField, equatorPetrophysics } from "@ikhmalputra/subsurface-react";
import { useDeck } from "../deck/store.ts";
import { analyse, kestrel, useDesign } from "./design.ts";
import { forgeWell, surveyFrom } from "./sites.ts";
import { shoes as forgeShoes } from "./forge.ts";

/**
 * The well the deck is on, in one shape whatever the site: FORGE (documented records), Kestrel A-7
 * (a live design) or one Equator well (a synthetic trajectory with synthetic logs). A module asks
 * the place for what it needs; what a place does not have is null, and the module says so.
 */
export interface Place {
  readonly siteId: "forge" | "kestrel" | "equator";
  /** The id the signal bus knows the well by. */
  readonly wellId: string;
  readonly label: string;
  readonly provenance: "documented" | "synthetic";
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
    siteId: "equator", wellId: record.well.id, label: record.well.label, provenance: "synthetic",
    design: null, components: [], assembly: null, stations, survey: surveyFrom(stations),
    formations: [], totalDepthM: stations.at(-1)!.mdM, operations: null, petro: logs, petroLas: inFeet(logs.las),
  };
  return [record.well.id, place] as const;
}));
const equatorWellIds = project.records.map((record) => record.well.id);

const forgePlace: Place = {
  siteId: "forge", wellId: "forge", label: "16A(78)-32", provenance: "documented",
  design: forgeWell.design, components: forgeWell.components, assembly: forgeWell.assembly, stations: forgeWell.design.survey ?? [], survey: forgeWell.survey,
  formations: forgeWell.design.formations ?? [], totalDepthM: forgeWell.design.totalDepthM, operations: forgeWell.operations, petro: null, petroLas: null,
};

/** The store's id for a site's well: FORGE and Kestrel have one; on Equator, the chosen well or the first. */
export function wellIdFor(siteId: string | null, wellId: string | null): string | null {
  if (siteId === "forge") return "forge";
  if (siteId === "kestrel") return "kestrel-a7";
  if (siteId === "equator") return wellId && equatorPlaces.has(wellId) ? wellId : equatorWellIds[0]!;
  return null;
}

/** The place the deck is on; Kestrel's follows the live design, what-if included. */
export function usePlace(): Place | null {
  const siteId = useDeck((deck) => deck.siteId), wellId = useDeck((deck) => deck.wellId);
  const { brief } = useDesign();
  return useMemo(() => {
    if (siteId === "forge") return forgePlace;
    if (siteId === "equator") return equatorPlaces.get(wellIdFor(siteId, wellId)!) ?? null;
    if (siteId === "kestrel") {
      const analysis = analyse(brief);
      const stations = analysis.design.survey ?? [];
      return {
        siteId: "kestrel", wellId: "kestrel-a7", label: kestrel.brief.identity.name, provenance: "synthetic",
        design: analysis.design, components: analysis.design.components ?? [], assembly: analysis.assembly, stations,
        survey: surveyFrom(stations),
        formations: analysis.design.formations ?? [], totalDepthM: brief.totalDepthMdM, operations: null, petro: null, petroLas: null,
      } satisfies Place;
    }
    return null;
  }, [siteId, wellId, brief]);
}

/** TVD at an MD on a place's path; null outside its stations. */
export const tvdOn = (place: Place, mdM: number): number | null => tvdAtSurveyMd(place.stations, mdM);

const isString = (component: WellComponent) => component.kind === "Casing" || component.kind === "Tubular";
/** The strings a place has: casing and tubing. */
export const stringsOf = (place: Place) => place.components.filter(isString);

/** Shoes to mark: FORGE's at the reported depths, a design's at its strings' planned shoes. */
export function shoesOf(place: Place): readonly { readonly id: string; readonly mdM: number; readonly label: string }[] {
  if (place.siteId === "forge") return forgeShoes;
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
