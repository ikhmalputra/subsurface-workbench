import { useMemo } from "react";
import { computeMinimumCurvature, forgeDesign, forgeSeismicSection, getWellComponents, seismicDepthToTvd, wellComponentsToAssembly } from "@ikhmalputra/subsurface-core";
import type { ComputedStation, SeismicCube, SurveyPoint } from "@ikhmalputra/subsurface-core";
import { forgeOperations } from "@ikhmalputra/subsurface-core/records";
import type { LasFile } from "@ikhmalputra/subsurface-core/records";
import { RESERVOIR, equatorField, equatorSite, forgeSite, siteOfWells, unlocatedWells } from "@ikhmalputra/subsurface-react";
import type { WorldSite } from "@ikhmalputra/subsurface-react";
import type { SceneSeismicVolume } from "@ikhmalputra/subsurface-react/3d";
import { designForSite, siteOfDesign, useDesigns } from "./design.ts";
import { recordedForSite, siteOfRecord, useRecordedWells } from "./records.ts";
import { forceSite, isForceSite, useForceVersion } from "./force.ts";
import { catalogueField, catalogueFields, catalogueState, sourceEnabled, useCatalogueVersion } from "./catalogue-state.ts";
import type { CatalogueField } from "./catalogue-state.ts";
// Loading the catalogue puts the samples in it before the first site is asked for.
import "./catalogue.ts";
import type { Provenance } from "@ikhmalputra/subsurface-core/data-contract";
import { useFetched } from "./fetch.ts";
import { BASE } from "../base.ts";
import { compute } from "../compute/run.ts";

const equatorProject = equatorField();
/** Tops between a tenant's wells, one colour each in pick order; the first is the reservoir colour every site shares. */
const TOPS_PALETTE = [RESERVOIR.top, "#60a5fa", "#a78bfa", "#34d399", "#f472b6", "#facc15", "#94a3b8"];
const asSiteProvenance = (kind: Provenance["kind"]): WorldSite["map"]["provenance"] => kind === "synthetic" ? "synthetic" : kind === "user-authored" ? "user-authored" : "documented";

/**
 * The sites the catalogue's wells make, one per field:
 * - FORGE and Equator keep what their samples add (the seismic frame, the picked surfaces);
 * - a FORCE quadrant is built from its wells;
 * - any other field, a tenant's, is built from its wells the same generic way.
 * Designs and entered wells are left to their own live sites.
 */
/** The most wells a tenant's field draws in 3D at once; the rest stay on the map, and the site says how many are drawn. */
const DRAW_LIMIT = 1500;
const fieldSites = new Map<string, { readonly version: number; readonly site: WorldSite | null }>();
function siteOfField(field: CatalogueField): WorldSite | null {
  const kept = fieldSites.get(field.key);
  if (kept && kept.version === field.version) return kept.site;
  const { sourceId, fieldId, wells } = field;
  let site: WorldSite | null;
  if (sourceId === "samples" && fieldId === "forge") site = forgeSite(wells);
  else if (sourceId === "samples" && fieldId === "equator") site = equatorSite(equatorProject, wells);
  else if (sourceId === "samples" && isForceSite(fieldId)) site = forceSite(fieldId);
  else {
    const source = catalogueState().sources.find((entry) => entry.id === sourceId);
    const status = catalogueState().fields.get(field.key);
    // Past the limit, the extra wells keep their place on the map but are not drawn in 3D.
    let pathed = 0;
    const drawn = wells.map((entry) => entry.wellbores.length && pathed++ >= DRAW_LIMIT ? { ...entry, wellbores: [] } : entry);
    const names = [...new Set(drawn.flatMap((entry) => entry.wellbores.flatMap((bore) => bore.markers.map((marker) => marker.name))))];
    const reading = status?.reading ? `Reading paths and tops: ${status.read.toLocaleString("en-US")} of ${status.total.toLocaleString("en-US")} wells.` : status?.error ? `Paths could not all be read: ${status.error}.` : "";
    site = siteOfWells(drawn, {
      id: field.key, label: field.name, provenance: asSiteProvenance(wells[0]?.well.provenance.kind ?? "tenant"),
      summary: `${wells.length.toLocaleString("en-US")} well${wells.length === 1 ? "" : "s"} · ${source?.label ?? sourceId}`,
      surfaces: { kinds: ["formation", "group"], colour: (name) => TOPS_PALETTE[names.indexOf(name) % TOPS_PALETTE.length]! },
      seismicNote: "No seismic from this source yet: the deck reads wells, trajectories and tops from it so far.",
      caveat: [`From ${source?.label ?? sourceId} (${source?.standard ?? "its own format"}): wells, trajectories and tops as served, paths drawn within ${2} m of their surveys.`,
        pathed > DRAW_LIMIT ? `${DRAW_LIMIT.toLocaleString("en-US")} of its ${pathed.toLocaleString("en-US")} wells are drawn in 3D; all are on the map.` : "",
        reading, "Surfaces between wells are triangulated between their picks for display; they are not mapped horizons."].filter(Boolean).join(" "),
    });
  }
  fieldSites.set(field.key, { version: field.version, site });
  return site;
}

/**
 * The sites the catalogue's fields make, one per field:
 * - FORGE and Equator keep what their samples add (the seismic frame, the picked surfaces);
 * - a FORCE quadrant is built from its wells;
 * - any other field, a tenant's, is built from its wells the same generic way.
 * Designs and entered wells are left to their own live sites. A site is rebuilt only when its field changed.
 */
function catalogueSites(): readonly WorldSite[] {
  return catalogueFields().flatMap((field) => field.sourceId === "browser" || designForSite(field.fieldId) ? [] : [siteOfField(field)].filter((site): site is WorldSite => site !== null));
}

/** Every site the deck can place: the catalogue's fields, then each planned and entered well as it now stands, as the config allows. */
export function useSites(): readonly WorldSite[] {
  const designs = useDesigns();
  const entered = useRecordedWells();
  const force = useForceVersion();
  const catalogue = useCatalogueVersion();
  return useMemo(() => [
    ...catalogueSites(),
    ...designs.filter((entry) => sourceEnabled(entry.record.builtIn ? "samples" : "browser")).map((entry) => siteOfDesign(entry.record, entry.value.brief)),
    ...(sourceEnabled("browser") ? entered.map((entry) => siteOfRecord(entry.entry, entry.value)).filter((site): site is WorldSite => site !== null) : []),
  ], [designs, entered, force, catalogue]);
}
export const siteById = (id: string | null): WorldSite | null => {
  if (!id) return null;
  const field = catalogueField(id);
  if (field && field.sourceId !== "browser" && !designForSite(field.fieldId)) { const site = siteOfField(field); if (site) return site; }
  if (isForceSite(id) && sourceEnabled("samples")) return forceSite(id);
  const design = designForSite(id);
  if (design && sourceEnabled(design.builtIn ? "samples" : "browser")) return siteOfDesign(design, design.history.current().brief);
  const entered = recordedForSite(id);
  return entered && sourceEnabled("browser") ? siteOfRecord(entered, entered.history.current()) : null;
};
export const unlocated = unlocatedWells();

/** Positions, dogleg and closure by minimum curvature from stations' MD, inclination and azimuth. */
export const surveyFrom = (points: readonly SurveyPoint[]): readonly ComputedStation[] => points.length < 2 ? [] :
  computeMinimumCurvature(points.map((point) => ({ mdM: point.mdM, inclinationDeg: point.inclinationDeg, azimuthDeg: point.azimuthDeg })));

export const FORGE_NAME = forgeDesign.wellName ?? "Utah FORGE 16A(78)-32";

/** FORGE as the views read it: assembly from the records, the survey by minimum curvature. */
export const forgeWell = (() => {
  const components = getWellComponents(forgeDesign);
  return {
    design: forgeDesign,
    components,
    assembly: wellComponentsToAssembly({ id: forgeDesign.id, name: FORGE_NAME, totalDepthM: forgeDesign.totalDepthM, components }),
    survey: surveyFrom(forgeDesign.survey ?? []),
    operations: forgeOperations,
  };
})();

const decodeLas = (buffer: ArrayBuffer) => compute("lasFromBuffer", buffer);
const asCounts = (buffer: ArrayBuffer) => new Int8Array(buffer);

/** The FORGE mud log, fetched once. */
export function useForgeLog(enabled: boolean): { log: LasFile | null; status: "idle" | "loading" | "error" | "ready"; error: string | null } {
  const loaded = useFetched(enabled ? `${BASE}data/forge-16a-mudlog-10ft.las` : null, decodeLas);
  return { log: loaded.value, status: !enabled ? "idle" : loaded.loading ? "loading" : loaded.error ? "error" : "ready", error: loaded.error };
}

/** The well-centred FORGE PSDM sub-volume, placed in the well's own frame (TVD below RKB). */
export function useForgeVolume(enabled: boolean): { volume: SceneSeismicVolume | null; loading: boolean; error: string | null } {
  const meta = forgeSeismicSection, cut = meta.subVolume;
  const loaded = useFetched(enabled && cut ? `${BASE}data/${cut.file}` : null, asCounts);
  const counts = loaded.value;
  const volume = useMemo((): SceneSeismicVolume | null => {
    if (!cut || !counts || counts.length !== cut.alongCount * cut.offsetCount * cut.samples) return null;
    const toTvd = (depthM: number) => seismicDepthToTvd(depthM, meta.rkbElevationM, meta.seismicDatumElevationM);
    const half = cut.spacingM / 2;
    return {
      counts, alongCount: cut.alongCount, offsetCount: cut.offsetCount, sampleCount: cut.samples, amplitudePerCount: cut.amplitudePerCount, azimuthDeg: cut.azimuthDeg,
      alongStartM: cut.alongFromM - half, alongEndM: cut.alongToM + half, offsetStartM: cut.offsetFromM - half, offsetEndM: cut.offsetToM + half,
      topTvdM: toTvd(-cut.sampleIntervalM / 2), baseTvdM: toTvd((cut.samples - 0.5) * cut.sampleIntervalM),
      gain: cut.amplitudePerCount * 127 / meta.section.p99AbsAmplitude,
      label: `FORGE PSDM volume · ${((cut.alongToM - cut.alongFromM + cut.spacingM) / 1000).toFixed(2)} × ${((cut.offsetToM - cut.offsetFromM + cut.spacingM) / 1000).toFixed(2)} km`,
    };
  }, [cut, counts, meta]);
  return { volume, loading: loaded.loading, error: loaded.error };
}

/** The same PSDM sub-volume as a cube on the section's axes, for cutting inlines and crosslines. */
export function useForgeCube(enabled: boolean): { cube: SeismicCube | null; loading: boolean; error: string | null } {
  const cut = forgeSeismicSection.subVolume;
  const loaded = useFetched(enabled && cut ? `${BASE}data/${cut.file}` : null, asCounts);
  const counts = loaded.value;
  const cube = useMemo((): SeismicCube | null => !cut || !counts || counts.length !== cut.alongCount * cut.offsetCount * cut.samples ? null
    : { counts, alongCount: cut.alongCount, offsetCount: cut.offsetCount, sampleCount: cut.samples, amplitudePerCount: cut.amplitudePerCount, alongFromM: cut.alongFromM, offsetFromM: cut.offsetFromM, spacingM: cut.spacingM }, [cut, counts]);
  return { cube, loading: loaded.loading, error: loaded.error };
}
