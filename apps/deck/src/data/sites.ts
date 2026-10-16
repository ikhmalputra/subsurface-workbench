import { useMemo } from "react";
import { computeMinimumCurvature, forgeDesign, forgeSeismicSection, getWellComponents, seismicDepthToTvd, wellComponentsToAssembly } from "@ikhmalputra/subsurface-core";
import type { ComputedStation, SeismicCube, SurveyPoint } from "@ikhmalputra/subsurface-core";
import { forgeOperations, parseLas } from "@ikhmalputra/subsurface-core/records";
import type { LasFile } from "@ikhmalputra/subsurface-core/records";
import { equatorSite, forgeSite, unlocatedWells } from "@ikhmalputra/subsurface-react";
import type { WorldSite } from "@ikhmalputra/subsurface-react";
import type { SceneSeismicVolume } from "@ikhmalputra/subsurface-react/3d";
import { designForSite, siteOfDesign, useDesigns } from "./design.ts";
import { recordedForSite, siteOfRecord, useRecordedWells } from "./records.ts";
import { forceSite, forceSites, isForceSite, useForceVersion } from "./force.ts";
import { useFetched } from "./fetch.ts";
import { BASE } from "../base.ts";

/** The sites with records, built once. */
const recordedSites: readonly WorldSite[] = [forgeSite(), equatorSite()];
/** Every site the deck can place: the recorded ones, then each planned well as it now stands. */
export function useSites(): readonly WorldSite[] {
  const designs = useDesigns();
  const entered = useRecordedWells();
  const force = useForceVersion();
  return useMemo(() => [...recordedSites, ...forceSites(), ...designs.map((entry) => siteOfDesign(entry.record, entry.value.brief)),
    ...entered.map((entry) => siteOfRecord(entry.entry, entry.value)).filter((site): site is WorldSite => site !== null)], [designs, entered, force]);
}
export const siteById = (id: string | null): WorldSite | null => {
  const recorded = recordedSites.find((site) => site.map.id === id);
  if (recorded) return recorded;
  if (isForceSite(id)) return forceSite(id!);
  const design = designForSite(id);
  if (design) return siteOfDesign(design, design.history.current().brief);
  const entered = recordedForSite(id);
  return entered ? siteOfRecord(entered, entered.history.current()) : null;
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

const decodeLas = (buffer: ArrayBuffer) => parseLas(new TextDecoder().decode(buffer));
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
