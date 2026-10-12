"use client";

import { useEffect, useMemo, useState } from "react";
import { feetToMetres, parseSegy, projectOntoSection, seismicDepthToTvd, tvdToSeismicDepth, type FormationLayer, type ProjectedPoint, type SegyFile, type SegyTrace, type SeismicSectionMetadata, type SurveyPoint, type WellComponent } from "@ikhmalputra/subsurface-core";
import { SeismicSection, type MdWindow } from "@ikhmalputra/subsurface-react/seismic";
import type { SceneSeismicVolume } from "@ikhmalputra/subsurface-react/three";

export interface WellSeismicSource { readonly url: string; readonly meta: SeismicSectionMetadata }

const alongLine = (trace: SegyTrace) => trace.shotpoint;
const cache = new Map<string, Promise<SegyFile>>();

/** Fetches and parses a SEG-Y once per URL, shared by every view that shows it. */
export function useSegy(url: string | undefined) {
  const [state, setState] = useState<{ url: string; file: SegyFile | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    let request = cache.get(url);
    if (!request) {
      request = fetch(url).then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.arrayBuffer(); }).then(parseSegy);
      request.catch(() => cache.delete(url));
      cache.set(url, request);
    }
    request.then((file) => { if (live) setState({ url, file, error: null }); })
      .catch((error: unknown) => { if (live) setState({ url, file: null, error: error instanceof Error ? error.message : String(error) }); });
    return () => { live = false; };
  }, [url]);
  return state?.url === url ? state : null;
}

/** Survey stations in UTM, converted to seismic depth and projected onto the section line. */
export function useWellOnSection(survey: readonly SurveyPoint[], seismic: WellSeismicSource | undefined): ProjectedPoint[] {
  return useMemo(() => {
    if (!seismic) return [];
    const { wellhead, rkbElevationM, seismicDatumElevationM, section } = seismic.meta;
    return projectOntoSection(survey.map((point) => ({ mdM: point.mdM, eastingM: wellhead.eastingM + point.eastingM, northingM: wellhead.northingM + point.northingM, depthM: tvdToSeismicDepth(point.tvdM, rkbElevationM, seismicDatumElevationM) })), { originEastingM: wellhead.eastingM, originNorthingM: wellhead.northingM, azimuthDeg: section.azimuthDeg });
  }, [seismic, survey]);
}

const volumeCache = new Map<string, Promise<Int8Array>>();
function useInt8(url: string | undefined) {
  const [state, setState] = useState<{ url: string; values: Int8Array | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    let request = volumeCache.get(url);
    if (!request) {
      request = fetch(url).then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.arrayBuffer(); }).then((buffer) => new Int8Array(buffer));
      request.catch(() => volumeCache.delete(url));
      volumeCache.set(url, request);
    }
    request.then((values) => { if (live) setState({ url, values, error: null }); })
      .catch((error: unknown) => { if (live) setState({ url, values: null, error: error instanceof Error ? error.message : String(error) }); });
    return () => { live = false; };
  }, [url]);
  return state?.url === url ? state : null;
}

/** Colour saturates at p99 / SCENE_GAIN, the same clip as the 2D section, so reflectors stay bold in 3D. */
const SCENE_GAIN = 2;

/** The well-centred FORGE sub-volume as a 3D scene volume: well-local metres, TVD below RKB. Fetched only when enabled. */
export function useSceneSeismic(seismic: WellSeismicSource | undefined, enabled: boolean) {
  const meta = seismic?.meta, cut = meta?.subVolume;
  const url = enabled && seismic && cut ? seismic.url.slice(0, seismic.url.lastIndexOf("/") + 1) + cut.file : undefined;
  const loaded = useInt8(url);
  const counts = loaded?.values;
  const volume = useMemo((): SceneSeismicVolume | null => {
    if (!meta || !cut || !counts || counts.length !== cut.alongCount * cut.offsetCount * cut.samples) return null;
    const toTvd = (depthM: number) => seismicDepthToTvd(depthM, meta.rkbElevationM, meta.seismicDatumElevationM);
    const half = cut.spacingM / 2;
    return {
      counts, alongCount: cut.alongCount, offsetCount: cut.offsetCount, sampleCount: cut.samples, amplitudePerCount: cut.amplitudePerCount, azimuthDeg: cut.azimuthDeg,
      alongStartM: cut.alongFromM - half, alongEndM: cut.alongToM + half, offsetStartM: cut.offsetFromM - half, offsetEndM: cut.offsetToM + half,
      topTvdM: toTvd(-cut.sampleIntervalM / 2), baseTvdM: toTvd((cut.samples - 0.5) * cut.sampleIntervalM),
      gain: SCENE_GAIN * cut.amplitudePerCount * 127 / meta.section.p99AbsAmplitude,
      label: `FORGE PSDM volume · ${((cut.alongToM - cut.alongFromM + cut.spacingM) / 1000).toFixed(2)} × ${((cut.offsetToM - cut.offsetFromM + cut.spacingM) / 1000).toFixed(2)} km`,
    };
  }, [meta, cut, counts]);
  return { volume, error: loaded?.error ?? null, loading: !!url && !loaded };
}

export interface WellSeismicSectionProps {
  readonly file: SegyFile;
  readonly meta: SeismicSectionMetadata;
  readonly wellPath: readonly ProjectedPoint[];
  readonly components: readonly WellComponent[];
  readonly formations: readonly FormationLayer[];
  readonly survey: readonly SurveyPoint[];
  readonly selected: WellComponent | undefined;
  readonly onSelectMd: (mdM: number) => void;
  readonly cursorMdM: number | null;
  readonly onCursorMdChange?: (mdM: number | null) => void;
  readonly mdWindow?: MdWindow | null;
  readonly onMdWindowChange?: (window: MdWindow | null) => void;
  readonly title?: string;
}

/** The FORGE section with casing, shoes, formation tops and the selected record drawn on the well. */
export function WellSeismicSection({ file, meta, wellPath, components, formations, survey, selected, onSelectMd, cursorMdM, onCursorMdChange, mdWindow, onMdWindowChange, title = "3D anisotropic PSDM · section along 16A(78)-32" }: WellSeismicSectionProps) {
  const casing = components.filter((component) => component.kind === "Casing").map((component) => ({ id: component.id, label: component.name, topMdM: component.topDepthReported === false ? 0 : component.topDepthM, baseMdM: component.bottomDepthM, color: "#2c3f7a" }));
  const intervals = selected && !casing.some((item) => item.id === selected.id) ? [...casing, { id: selected.id, label: selected.name, topMdM: selected.topDepthReported === false ? 0 : selected.topDepthM, baseMdM: selected.bottomDepthM }] : casing;
  const shoes = components.filter((component) => component.kind === "Casing" && component.rawBottomDepthFt).map((component) => ({ mdM: feetToMetres(component.rawBottomDepthFt as number), label: `${component.name.split(" / ").pop()?.trim()} shoe` }));
  const tops = formations.filter((layer) => layer.topTvdM > 50).flatMap((layer) => { const station = survey.find((point) => point.tvdM >= layer.topTvdM); return station ? [{ mdM: station.mdM, label: `${layer.name} top (well)` }] : []; });
  return <SeismicSection file={file} traceX={alongLine} xLabel={`Distance along section from wellhead (m) · azimuth ${meta.section.azimuthDeg.toFixed(1)}° grid`} depthStep={meta.volume.sampleIntervalM} depthLabel="m below datum" wellPath={wellPath} intervals={intervals} markers={[...shoes, ...tops]} selectedId={selected?.id ?? null} cursorMdM={cursorMdM} title={title} onSelectMd={onSelectMd} onCursorMdChange={onCursorMdChange} mdWindow={mdWindow} onMdWindowChange={onMdWindowChange} />;
}
