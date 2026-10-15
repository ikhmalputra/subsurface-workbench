import constructionData from "./forge-offset-construction.json" with { type: "json" };
import forgeOffsetWellsData from "./forge-offset-wells.json" with { type: "json" };
import type { SurveyPoint, WellComponent } from "./index.ts";
import { computeMinimumCurvature } from "./trajectory.ts";
import { usSurveyFeetToMetres } from "./units.ts";

/**
 * How Utah FORGE's other deep wells were built — 16B(78)-32, 58-32, 56-32, 78-32 and 78B-32 — as
 * their end-of-well reports give it (tools/survey/build_forge_construction.py checks every value
 * against the words of its page). Feet become metres with 1200/3937, as 16A(78)-32's records do.
 * What a report does not give stays out: a cement whose top is not reported is no cement interval
 * (the string's description says what the report does say), a hole whose bottom is not reported
 * is drawn to its string's shoe and says so.
 */

interface Cite { readonly doc: string; readonly page: number; readonly quote: string }
interface Transcribed {
  readonly id: string;
  readonly label: string;
  readonly purpose: string;
  readonly drilled: string;
  readonly datum: { readonly kind: string; readonly aboveGroundFt: number | null; readonly elevationFt: number | null; readonly groundElevationFt: number | null; readonly cite: readonly Cite[]; readonly note: string | null };
  readonly totalDepthFt: number;
  readonly tdCite: readonly Cite[];
  readonly survey: { readonly from: string; readonly id: string } | { readonly stations: readonly (readonly number[])[]; readonly pages: readonly number[]; readonly check: string } | null;
  readonly surveyNote?: string;
  readonly strings: readonly {
    readonly role: string; readonly name: string; readonly odIn: number; readonly idIn: number | null; readonly spec: string; readonly topFt: number; readonly shoeFt: number; readonly cite: readonly Cite[];
    readonly hole: { readonly sizeIn: number; readonly bottomFt: number | null; readonly cite: readonly Cite[] } | null;
    readonly cement: { readonly topFt: number | null; readonly approximate?: boolean; readonly text: string; readonly cite: readonly Cite[] } | null;
  }[];
  readonly openHole: { readonly fromFt: number; readonly toFt: number; readonly sizeIn: number; readonly cite: readonly Cite[] } | null;
  readonly surface: readonly { readonly kind: string; readonly name: string; readonly cite: readonly Cite[] }[];
  readonly notes: readonly { readonly text: string; readonly cite: readonly Cite[] }[];
}
interface Source { readonly gdr: number; readonly name: string; readonly url: string; readonly sha256: string; readonly members?: Readonly<Record<string, string>> }
interface ConstructionRecord { readonly licence: string; readonly note: string; readonly sources: Readonly<Record<string, Source>>; readonly wells: readonly Transcribed[] }

export interface ForgeConstructionWell {
  readonly id: string;
  readonly label: string;
  readonly purpose: string;
  readonly drilled: string;
  readonly provenance: "documented";
  readonly source: { readonly label: string; readonly url: string; readonly gdr: number; readonly licence: string };
  /** What MD is measured from, its height above ground and above mean sea level where the report gives them. */
  readonly datum: { readonly kind: string; readonly aboveGroundM: number | null; readonly elevationMslM: number | null; readonly note: string | null; readonly page: number };
  readonly totalDepthM: number;
  readonly components: readonly WellComponent[];
  /** Survey stations, positions by minimum curvature; empty when the records have no survey with azimuths. */
  readonly stations: readonly SurveyPoint[];
  readonly surveyNote: string;
  /** Where the report disagrees with itself, with the page of the figure not used. */
  readonly notes: readonly { readonly text: string; readonly page: number | null }[];
}

const record = constructionData as unknown as ConstructionRecord;
const offsets = forgeOffsetWellsData as unknown as { readonly wells: readonly { readonly id: string; readonly source: string; readonly stations: readonly (readonly number[])[] }[] };
const m = usSurveyFeetToMetres;
const mm = (inches: number) => inches * 25.4;
const pageOf = (cites: readonly Cite[]) => cites.find((cite) => cite.doc === "eowr")?.page ?? cites[0]?.page;
const inchesName = (inches: number) => {
  const whole = Math.floor(inches), eighths = Math.round((inches - whole) * 8);
  const fraction = ["", "1/8", "1/4", "3/8", "1/2", "5/8", "3/4", "7/8"][eighths];
  return `${whole}${fraction ? ` ${fraction}` : ""} in`;
};

function stationsOf(well: Transcribed): { stations: readonly SurveyPoint[]; note: string } {
  const survey = well.survey;
  if (!survey) return { stations: [], note: well.surveyNote ?? "No survey in the records." };
  const [rows, note] = "from" in survey
    ? (() => { const found = offsets.wells.find((entry) => entry.id === survey.id)!; return [found.stations, `Survey: ${found.source}.`] as const; })()
    : [survey.stations, `Survey: the report's table, pp. ${survey.pages[0]}–${survey.pages.at(-1)}; ${survey.check}.`] as const;
  const computed = computeMinimumCurvature(rows.map(([md, inc, azi]) => ({ mdM: m(md!), inclinationDeg: inc!, azimuthDeg: azi! })));
  return { stations: computed.map((station) => ({ mdM: station.mdM, tvdM: station.tvdM, eastingM: station.eastingM, northingM: station.northingM, inclinationDeg: station.inclinationDeg, azimuthDeg: station.azimuthDeg })), note };
}

function componentsOf(well: Transcribed, url: string): WellComponent[] {
  const components: WellComponent[] = [];
  const strings = [...well.strings].sort((a, b) => a.shoeFt - b.shoeFt);
  let holeTopFt = 0;
  for (const string of strings) {
    const id = `${well.id}-${string.role}`;
    const cement = string.cement;
    components.push({
      id, name: string.name, kind: "Casing", material: string.spec, outerDiameterMm: mm(string.odIn), innerDiameterMm: string.idIn === null ? null : mm(string.idIn),
      topDepthM: m(string.topFt), bottomDepthM: m(string.shoeFt), sourceUrl: url, sourcePage: pageOf(string.cite), rawBottomDepthFt: string.shoeFt,
      description: cement ? `Cement: ${cement.text} (p. ${pageOf(cement.cite)}).` : "Cement: not described in the report.",
    });
    if (string.hole) {
      const bottomFt = string.hole.bottomFt ?? string.shoeFt;
      components.push({
        id: `${id}-hole`, name: `${inchesName(string.hole.sizeIn)} hole`, kind: "Hole", material: "Drilled hole", outerDiameterMm: mm(string.hole.sizeIn), innerDiameterMm: null,
        topDepthM: m(holeTopFt), bottomDepthM: m(bottomFt), sourceUrl: url, sourcePage: pageOf(string.hole.cite),
        description: [string.hole.bottomFt === null ? "Hole depth not reported: drawn to the string's shoe." : "", string.hole.cite.every((cite) => cite.doc !== "eowr") ? `Size from the RIMBase casing report in the same archive, p. ${string.hole.cite[0]!.page}.` : ""].filter(Boolean).join(" "),
      });
      // The next hole starts below this string's shoe even where a report puts the shoe a little below its casing point (56-32: 381 ft in 380.5).
      holeTopFt = Math.max(bottomFt, string.shoeFt);
    } else {
      holeTopFt = Math.max(holeTopFt, string.shoeFt);
    }
    if (cement && cement.topFt !== null) {
      components.push({
        id: `${id}-cement`, name: cement.approximate ? `Cement outside the ${inchesName(string.odIn)} (top ≈ ${cement.topFt.toLocaleString("en-US")} ft)` : `Cement outside the ${inchesName(string.odIn)}`,
        kind: "Cement", material: cement.text, outerDiameterMm: string.hole ? mm(string.hole.sizeIn) : null, innerDiameterMm: mm(string.odIn),
        topDepthM: m(cement.topFt), bottomDepthM: m(string.shoeFt), parentId: id, sourceUrl: url, sourcePage: pageOf(cement.cite), description: cement.text,
      });
    }
  }
  const open = well.openHole;
  if (open && holeTopFt < open.toFt - 0.5) {
    components.push({
      id: `${well.id}-open-hole`, name: `${inchesName(open.sizeIn)} open hole`, kind: "Hole", material: "Open hole", outerDiameterMm: mm(open.sizeIn), innerDiameterMm: null,
      topDepthM: m(Math.max(holeTopFt, open.fromFt)), bottomDepthM: m(open.toFt), sourceUrl: url, sourcePage: pageOf(open.cite), description: "",
    });
  }
  well.surface.forEach((item, index) => components.push({
    id: `${well.id}-surface-${index}`, name: item.name, kind: item.kind === "Valve" ? "Valve" : "Wellhead", material: "As named in the report", outerDiameterMm: null, innerDiameterMm: null,
    topDepthM: 0, bottomDepthM: 0, sourceUrl: url, sourcePage: pageOf(item.cite), description: "",
  }));
  return components;
}

/** Utah FORGE's other deep wells, built as their end-of-well reports say. */
export const forgeConstructionWells: readonly ForgeConstructionWell[] = record.wells.map((well) => {
  const source = record.sources[well.id]!;
  const { stations, note } = stationsOf(well);
  const datum = well.datum;
  return {
    id: well.id, label: well.label, purpose: well.purpose, drilled: well.drilled, provenance: "documented",
    source: { label: `GDR ${source.gdr} · ${source.members?.eowr ?? source.name}`, url: source.url, gdr: source.gdr, licence: record.licence },
    datum: { kind: datum.kind, aboveGroundM: datum.aboveGroundFt === null ? null : m(datum.aboveGroundFt), elevationMslM: datum.elevationFt === null ? null : m(datum.elevationFt), note: datum.note, page: pageOf(datum.cite)! },
    totalDepthM: m(well.totalDepthFt), components: componentsOf(well, source.url), stations, surveyNote: note,
    notes: well.notes.map((entry) => ({ text: entry.text, page: pageOf(entry.cite) ?? null })),
  };
});
