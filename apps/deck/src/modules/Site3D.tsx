import { lazy, Suspense, useMemo } from "react";
import { useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";
import { forgeSeismicSection } from "@ikhmalputra/subsurface-core";
import { siteById, useForgeVolume } from "../data/sites.ts";
import { shoes } from "../data/forge.ts";
import { actions, signals, useDeck } from "../deck/store.ts";
import { useMoment } from "../data/history.ts";
import { Loading } from "./Empty.tsx";
import { useWire } from "./wire.ts";
import { sectionLineOnSite } from "./Curtain.tsx";

const SiteScene = lazy(() => import("@ikhmalputra/subsurface-react/3d").then((module) => ({ default: module.SiteScene })));

/** The chosen site in one east, north and depth frame: wells, horizons, datum levels, seismic, and the depth cursor. */
export function Site3D() {
  const siteId = useDeck((deck) => deck.siteId), wellId = useDeck((deck) => deck.wellId);
  const site = siteById(siteId);
  const wire = useWire("site3d");
  const seismic = useForgeVolume(site?.hasSeismic === true);
  const md = wire.place ? wire.cursor : null;
  const cursorWell = wire.place?.wellId ?? null;
  const cursor = useMemo(() => md === null || !cursorWell ? null : { wellId: cursorWell, mdM: md }, [md, cursorWell]);
  // On a past day the FORGE well is drawn only as deep as it had been drilled.
  const moment = useMoment();
  const drilled = siteId === "forge" && moment ? moment.asOf.drilledM : null;
  const reach = useMemo(() => drilled === null ? null : { forge: drilled }, [drilled]);
  // A shoe is a pick only once its string is in to bottom.
  const unset = siteId === "forge" && moment ? shoes.filter((shoe) => !moment.asOf.completeIds.includes(shoe.id)).map((shoe) => shoe.label).join("|") : "";
  const brush = wire.brush;
  const highlight = useMemo(() => brush && cursorWell ? { wellId: cursorWell, topMdM: brush[0], baseMdM: brush[1], color: "#ff8a3d" } : null, [brush?.[0], brush?.[1], cursorWell]);
  const hiddenMarkers = useMemo(() => unset ? { forge: unset.split("|") } : null, [unset]);
  // Slices are shared: moved here they turn the seismic tile; stepped there they move here.
  const stored = useSubsurfaceSelector(signals, (state) => state.seismicSlices);
  const line = useDeck((deck) => deck.sectionLine);
  const curtain = useMemo(() => {
    if (!line || siteId !== "forge" || !seismic.volume) return null;
    const { site: ends } = sectionLineOnSite(line);
    return { from: ends[0]!, to: ends[1]!, baseM: seismic.volume.baseTvdM, label: "Section line" };
  }, [line, siteId, seismic.volume]);
  const slices = useMemo(() => ({ inline: stored.inline ?? undefined, crossline: stored.crossline ?? undefined, depth: stored.time_depth ?? undefined }), [stored]);
  if (!site) return null;
  return <Suspense fallback={<Loading>Starting the 3D site…</Loading>}>
    <SiteScene key={site.map.id} title={`${site.map.label} in 3D`} depthLabel={site.depthLabel} originLabel={site.originLabel} wells={site.wells} surfaces={site.surfaces}
      seismic={site.hasSeismic ? seismic.volume : null} seismicClip={site.hasSeismic ? forgeSeismicSection.section.p99AbsAmplitude : undefined} seismicNote={site.seismicNote}
      selectedWellId={wire.place?.wellId ?? wellId ?? (site.wells.length === 1 ? site.wells[0]!.id : null)} onSelectWell={(id) => actions.selectSite(site.map.id, id, "site3d")} cursor={cursor} reach={reach} hiddenMarkers={hiddenMarkers} highlight={highlight}
      curtain={curtain} slices={site.hasSeismic ? slices : null} onSlicesChange={(next) => signals.setSeismicSlices({ inline: next.inline, crossline: next.crossline, time_depth: next.depth }, wire.source)} />
  </Suspense>;
}
