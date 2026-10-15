import { lazy, Suspense, useMemo } from "react";
import { useSites } from "../data/sites.ts";
import type { WorldSite } from "@ikhmalputra/subsurface-react";

type WellsMapSite = WorldSite["map"];
import { fmt } from "../format.ts";
import { actions, useDeck } from "../deck/store.ts";
import { useMoment } from "../data/history.ts";
import type { GeographicXY } from "@ikhmalputra/subsurface-core/gis";
import type { Place } from "../data/place.ts";
import { Loading } from "./Empty.tsx";
import { useWire } from "./wire.ts";
import { BASE } from "../base.ts";

const WellsMap = lazy(() => import("@ikhmalputra/subsurface-react/gis").then((module) => ({ default: module.WellsMap })));
/** A well's path in plan as drilled by a depth: the stations above it and the point at it. */
function sitesDrilledTo(mapSites: readonly WellsMapSite[], place: Place, drilledM: number) {
  return mapSites.map((site) => site.id !== place.siteId ? site : { ...site, wells: site.wells.map((well) => {
    if (well.id !== place.wellId) return well;
    const kept = (well.path ?? []).filter((_, index) => (place.stations[index]?.mdM ?? Infinity) <= drilledM);
    const end = pointOnMap(mapSites, place, drilledM);
    return { ...well, path: drilledM <= 0 ? [] : end ? [...kept, end] : kept };
  }) });
}

/** Every located well on an offline globe. Choosing a site is the Place signal; the depth cursor rides the path. */
/** Where a depth on a well lies in plan, on the map's own path for it (one point per station). */
function pointOnMap(mapSites: readonly WellsMapSite[], place: Place, mdM: number): GeographicXY | null {
  const path = mapSites.find((site) => site.id === place.siteId)?.wells.find((well) => well.id === place.wellId)?.path;
  const stations = place.stations;
  if (!path || path.length !== stations.length || mdM < stations[0]!.mdM || mdM > stations.at(-1)!.mdM) return null;
  for (let i = 1; i < stations.length; i++) if (mdM <= stations[i]!.mdM) {
    const t = (mdM - stations[i - 1]!.mdM) / (stations[i]!.mdM - stations[i - 1]!.mdM || 1);
    return [path[i - 1]![0] + t * (path[i]![0] - path[i - 1]![0]), path[i - 1]![1] + t * (path[i]![1] - path[i - 1]![1])];
  }
  return path.at(-1) ?? null;
}

export function Globe() {
  const siteId = useDeck((deck) => deck.siteId), wellId = useDeck((deck) => deck.wellId);
  const line = useDeck((deck) => deck.sectionLine);
  const wire = useWire("globe");
  const sites = useSites();
  const mapSites = useMemo(() => sites.map((site) => site.map), [sites]);
  const place = wire.place;
  const md = place ? wire.cursor : null;
  const at = md === null || !place ? null : pointOnMap(mapSites, place, md);
  const cursor = useMemo(() => at && md !== null ? { at, label: `${fmt(md)} m MD` } : null, [at?.[0], at?.[1], md]);
  const moment = useMoment();
  const drilled = moment && siteId === "forge" ? moment.asOf.drilledM : null;
  const shownSites = useMemo(() => drilled === null || !place ? mapSites : sitesDrilledTo(mapSites, place, drilled), [drilled, place, mapSites]);
  return <Suspense fallback={<Loading>Starting the globe…</Loading>}>
    <WellsMap sites={shownSites} workerUrl={`${BASE}gis/maplibre-gl-worker.mjs`} basemapUrl={`${BASE}gis/world-50m.json`} basemapAttribution="Natural Earth"
      selectedSiteId={siteId} selectedWellId={wellId} onSelect={(site, well) => actions.selectSite(site, well, "globe")} cursor={cursor}
      sectionLine={line} onSectionLineChange={(next) => actions.setSectionLine(next, "globe")} />
  </Suspense>;
}
