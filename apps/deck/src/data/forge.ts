import { feetToMetres, findPipe, forge16aWellheads, forgeSeismicSection, mdAtSurveyTvd, millimetresToInches, pipeRatings, projectOntoSection, steelGrades, tvdToSeismicDepth, wellPointAtMd } from "@ikhmalputra/subsurface-core";
import type { PipeRatings, ProjectedPoint, SegyFile, WellComponent } from "@ikhmalputra/subsurface-core";
import { useFetched } from "./fetch.ts";
import { forgeWell } from "./sites.ts";
import { BASE } from "../base.ts";
import { compute } from "../compute/run.ts";

/**
 * What the deck derives from the FORGE records, each in one place: the shoes as reported, the
 * seismic section along the well, and a string's ratings. Every value says where it comes from;
 * anything the records do not hold is "not reported".
 */

const survey = forgeWell.design.survey ?? [];
const isString = (component: WellComponent) => component.kind === "Casing" || component.kind === "Tubular";
const casing = forgeWell.components.filter(isString);

/** Shoes at the depths the reports give, in feet converted once, with the string each belongs to. */
export const shoes = casing.filter((component) => component.rawBottomDepthFt).map((component) => ({ id: component.id, mdM: feetToMetres(component.rawBottomDepthFt as number), label: `${component.name.split(" / ").pop()?.trim()} shoe` }));

// ── Seismic along the well ───────────────────────────────────────────────────────────────────
const meta = forgeSeismicSection;
/** The FORGE PSDM section along the well, fetched and parsed once. */
export function useForgeSection(enabled: boolean): { file: SegyFile | null; error: string | null } {
  const loaded = useFetched(enabled ? `${BASE}data/${meta.section.file}` : null, (buffer) => compute("segyFromBuffer", buffer));
  return { file: loaded.value, error: loaded.error };
}

/** Survey stations in UTM, at seismic depth, projected onto the section line. */
export const wellOnSection: readonly ProjectedPoint[] = projectOntoSection(
  // 16A at its licensed as-built wellhead; the section line itself runs through the planned one.
  survey.map((point) => ({ mdM: point.mdM, eastingM: forge16aWellheads.asBuilt.eastingM + (point.eastingM ?? 0), northingM: forge16aWellheads.asBuilt.northingM + (point.northingM ?? 0), depthM: tvdToSeismicDepth(point.tvdM, meta.rkbElevationM, meta.seismicDatumElevationM) })),
  { originEastingM: meta.wellhead.eastingM, originNorthingM: meta.wellhead.northingM, azimuthDeg: meta.section.azimuthDeg },
);

/**
 * The section's amplitude where the well is at a depth: the nearest trace and sample, as a share of
 * the section's p99 clip. Also says how far the well is off the section line there, because the
 * section is a plane and the well is not.
 */
export function amplitudeAtMd(file: SegyFile | null, mdM: number): { value: number; offsetM: number } | null {
  if (!file || mdM < wellOnSection[0]!.mdM || mdM > wellOnSection.at(-1)!.mdM) return null;
  const point = wellPointAtMd(wellOnSection, mdM)!;
  const trace = file.traces.reduce((best, entry) => Math.abs(entry.shotpoint - point.alongM) < Math.abs(best.shotpoint - point.alongM) ? entry : best, file.traces[0]!);
  const sample = Math.round(point.depthM / meta.volume.sampleIntervalM);
  if (sample < 0 || sample >= file.sampleCount) return null;
  return { value: file.data[trace.index * file.sampleCount + sample]! / meta.section.p99AbsAmplitude, offsetM: point.offsetM };
}

/** Casing on the section as intervals, and the selected record when it is not casing. */
export function sectionIntervals(selected: WellComponent | undefined) {
  const strings = casing.map((component) => ({ id: component.id, label: component.name, topMdM: component.topDepthReported === false ? 0 : component.topDepthM, baseMdM: component.bottomDepthM, color: "#6d7fc4" }));
  return selected && !strings.some((item) => item.id === selected.id) ? [...strings, { id: selected.id, label: selected.name, topMdM: selected.topDepthReported === false ? 0 : selected.topDepthM, baseMdM: selected.bottomDepthM }] : strings;
}
export const sectionMarkers = [
  ...shoes.map(({ mdM, label }) => ({ mdM, label })),
  ...(forgeWell.design.formations ?? []).filter((layer) => layer.topTvdM > 50).flatMap((layer) => { const md = mdAtSurveyTvd(survey, layer.topTvdM); return md === null ? [] : [{ mdM: md, label: `${layer.name} top (well)` }]; }),
];

// ── A string's ratings ───────────────────────────────────────────────────────────────────────
export interface StringRatings {
  readonly grade: string | null;
  readonly weightLbFt: number | null;
  readonly connection: string | null;
  readonly odIn: number | null;
  /** API 5CT nominal wall and ID for the reported OD and weight; the record itself gives neither. */
  readonly pipe: { readonly wallIn: number; readonly idIn: number; readonly driftIn: number } | null;
  readonly ratings: PipeRatings | null;
  /** Why ratings could not be computed, when they could not. */
  readonly reason: string | null;
}

/** Grade, weight and connection as reported ("L80 / 68 lb/ft / BTC"), and API TR 5C3 ratings from them. */
export function stringRatings(component: WellComponent): StringRatings {
  const parts = component.material.split(" / ").map((part) => part.trim());
  const grade = parts[0] && /^[A-Z]{1,4}\d{2,3}$/.test(parts[0]) ? parts[0] : null;
  const weightMatch = parts.map((part) => /^([\d.]+)\s*lb\/ft$/.exec(part)).find(Boolean);
  const weightLbFt = weightMatch ? Number(weightMatch[1]) : null;
  const connection = parts.length > 2 ? parts.slice(2).join(" / ") : null;
  const odIn = component.outerDiameterMm === null ? null : Math.round(millimetresToInches(component.outerDiameterMm) * 1000) / 1000;
  const pipe = odIn !== null && weightLbFt !== null ? findPipe(odIn, weightLbFt) : undefined;
  const base = { grade, weightLbFt, connection, odIn, pipe: pipe ? { wallIn: pipe.wallIn, idIn: pipe.idIn, driftIn: pipe.driftIn } : null };
  if (!grade) return { ...base, ratings: null, reason: "The record does not report a grade." };
  if (!(grade in steelGrades)) return { ...base, ratings: null, reason: `${grade} is a manufacturer's grade, not an API 5CT grade in the table here, so no rating is computed.` };
  if (!pipe) return { ...base, ratings: null, reason: "The reported OD and weight are not a size in the API 5CT table, so the wall is unknown." };
  return { ...base, ratings: pipeRatings(pipe.odIn, pipe.wallIn, grade), reason: null };
}

/**
 * The formation tops as horizons across a seismic plane: each taken as planar at the depth the well
 * met it, which is what the records support (they call the regional extent conceptual).
 */
export const formationHorizons = (forgeWell.design.formations ?? []).filter((layer) => layer.topTvdM > 50).map((layer) => ({
  id: layer.id, label: `${layer.name} top · planar at the well's ${Math.round(layer.topTvdM).toLocaleString("en-US")} m TVD`,
  depth: tvdToSeismicDepth(layer.topTvdM, meta.rkbElevationM, meta.seismicDatumElevationM), color: "#f59e0b",
}));
