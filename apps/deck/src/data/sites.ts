import { useMemo } from "react";
import { computeMinimumCurvature, forgeDesign, forgeSeismicSection, getWellComponents, seismicDepthToTvd, wellComponentsToAssembly } from "@ikhmalputra/subsurface-core";
import type { ComputedStation, SurveyPoint } from "@ikhmalputra/subsurface-core";
import { forgeOperations, parseLas } from "@ikhmalputra/subsurface-core/records";
import type { LasFile } from "@ikhmalputra/subsurface-core/records";
import { equatorSite, forgeSite, unlocatedWells } from "@ikhmalputra/subsurface-react";
import type { WorldSite } from "@ikhmalputra/subsurface-react";
import type { SceneSeismicVolume } from "@ikhmalputra/subsurface-react/3d";
import { kestrel } from "./design.ts";
import { useFetched } from "./fetch.ts";

/** The sites the deck can place, built once from the records. */
export const sites: readonly WorldSite[] = [forgeSite(), equatorSite(), kestrel];
export const siteById = (id: string | null) => sites.find((site) => site.map.id === id) ?? null;
export const unlocated = unlocatedWells();

/** Positions, dogleg and closure by minimum curvature from stations' MD, inclination and azimuth. */
export const surveyFrom = (points: readonly SurveyPoint[]): readonly ComputedStation[] =>
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
  const loaded = useFetched(enabled ? "/data/forge-16a-mudlog-10ft.las" : null, decodeLas);
  return { log: loaded.value, status: !enabled ? "idle" : loaded.loading ? "loading" : loaded.error ? "error" : "ready", error: loaded.error };
}

/** The well-centred FORGE PSDM sub-volume, placed in the well's own frame (TVD below RKB). */
export function useForgeVolume(enabled: boolean): { volume: SceneSeismicVolume | null; loading: boolean; error: string | null } {
  const meta = forgeSeismicSection, cut = meta.subVolume;
  const loaded = useFetched(enabled && cut ? `/data/${cut.file}` : null, asCounts);
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
