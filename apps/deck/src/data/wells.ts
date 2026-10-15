import { useMemo } from "react";
import { forgeConstructionWells } from "@ikhmalputra/subsurface-core";
import type { FormationLayer, SurveyPoint, WellComponent } from "@ikhmalputra/subsurface-core";
import { analyse, useDesigns } from "./design.ts";
import { basePlace, baseOf } from "./place.ts";
import { designOfRecord, editedValue, same, surveyOf, useRecordedWells, useRecordsVersion } from "./records.ts";
import { equatorWells } from "./place.ts";
import { FORGE_NAME, forgeWell } from "./sites.ts";

/**
 * Every well the deck can draw a construction for, whatever site the deck is on, in one shape:
 * what a comparison needs and nothing it would have to guess. A well without construction records
 * is listed apart, with the reason.
 */
export interface ComparableWell {
  readonly id: string;
  readonly label: string;
  readonly site: string;
  readonly provenance: "documented" | "synthetic" | "user-authored";
  /** "As drilled", "Design", "Design · what-if". */
  readonly status: string;
  readonly components: readonly WellComponent[];
  readonly stations: readonly SurveyPoint[];
  readonly formations: readonly FormationLayer[];
  readonly totalDepthM: number;
  /** What MD and TVD are measured from, and its height above mean sea level when reported. */
  readonly datum: { readonly name: string; readonly elevationMslM: number | null };
  readonly source: string;
  /** What the well was drilled for, as its report says. */
  readonly purpose?: string;
  /** How its survey was read, or why there is none. */
  readonly surveyNote?: string;
  /** Where its report disagrees with itself, with the page of the figure not used. */
  readonly notes?: readonly { readonly text: string; readonly page: number | null }[];
}

export interface UnavailableWell { readonly id: string; readonly label: string; readonly site: string; readonly why: string }

const forge: ComparableWell = {
  id: "forge", label: "16A(78)-32", site: "Utah FORGE", provenance: "documented", status: "As drilled",
  components: forgeWell.components, stations: forgeWell.design.survey ?? [], formations: forgeWell.design.formations ?? [],
  totalDepthM: forgeWell.design.totalDepthM,
  datum: { name: "RKB", elevationMslM: forgeWell.design.referenceElevationMslM ?? null },
  source: `${FORGE_NAME}: GDR 1283 well records and survey (CC BY 4.0); the record page is quoted on each string`,
};

/** FORGE's other deep wells, from their end-of-well reports (core forgeConstructionWells). */
const forgeNeighbours: readonly ComparableWell[] = forgeConstructionWells.map((well) => ({
  id: `forge-${well.id}`, label: well.label, site: "Utah FORGE", provenance: well.provenance, status: `As drilled ${well.drilled}`,
  components: well.components, stations: well.stations, formations: [], totalDepthM: well.totalDepthM,
  datum: { name: well.datum.kind, elevationMslM: well.datum.elevationMslM },
  source: `${well.label}: ${well.source.label} (${well.source.licence.replace("CC-BY-", "CC BY ")}), the page quoted on each string`,
  purpose: well.purpose, surveyNote: well.surveyNote, notes: [...(well.datum.note ? [{ text: well.datum.note, page: well.datum.page }] : []), ...well.notes],
}));

const unavailable: readonly UnavailableWell[] = equatorWells.map((well) => ({ ...well, site: "Equator", why: "A synthetic trajectory with logs and picks: no construction records." }));

/** The wells with a construction; every planned well is its live design, a pending what-if included. */
export function useComparableWells(): { readonly wells: readonly ComparableWell[]; readonly unavailable: readonly UnavailableWell[] } {
  const designs = useDesigns();
  const entered = useRecordedWells();
  const records = useRecordsVersion();
  return useMemo(() => {
    // FORGE 16A as the deck draws it: with the user's edits over the record, if any.
    const forgeEdit = editedValue("forge");
    const forgeBase = baseOf(basePlace("forge", null)!);
    const forgeShown: ComparableWell = forgeEdit && !same(forgeEdit, forgeBase) ? {
      ...forge, status: "As drilled · edited here", components: forgeEdit.components, totalDepthM: forgeEdit.totalDepthM,
      stations: same(forgeEdit.stations, forgeBase.stations) ? forge.stations : surveyOf(forgeEdit.stations),
      source: `${forge.source}; with edits made on this deck over the record`,
    } : forge;
    const recorded = entered.map(({ entry, value }): ComparableWell => {
      const design = designOfRecord(entry.wellId, value);
      return {
        id: entry.wellId, label: value.identity.name || "Unnamed well", site: value.identity.field || "Entered on the deck", provenance: "user-authored", status: "As drilled · entered here",
        components: value.components, stations: design.survey ?? [], formations: design.formations ?? [], totalDepthM: value.totalDepthM,
        datum: { name: value.datum.reference, elevationMslM: value.datum.elevationMslM },
        source: `${value.identity.name || "Unnamed well"}: records entered on this deck${value.surveySource ? ` (survey: ${value.surveySource})` : ""}`,
      };
    });
    const planned = designs.map(({ record, value, pending }): ComparableWell => {
      const brief = value.brief, design = analyse(brief).design;
      const name = brief.identity.name || "Unnamed well";
      return {
        id: record.wellId, label: name, site: brief.identity.field ? `${brief.identity.field} (design)` : "Planned well", provenance: "synthetic", status: pending ? "Design · what-if" : "Design",
        components: design.components ?? [], stations: design.survey ?? [], formations: design.formations ?? [], totalDepthM: brief.totalDepthMdM,
        datum: { name: brief.datum.reference, elevationMslM: brief.datum.elevationAboveMslM ?? null },
        source: record.builtIn ? `${name}: the example design brief (synthetic, not a real well)` : `${name}: a design made in this deck (synthetic, not a real well)`,
      };
    });
    return { wells: [forgeShown, ...forgeNeighbours, ...recorded, ...planned], unavailable };
  }, [designs, entered, records]);
}
