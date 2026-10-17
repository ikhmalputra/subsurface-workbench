import { lazy, Suspense, useMemo, useState } from "react";
import { useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";
import { forge16aWellheads, forgeSeismicSection } from "@ikhmalputra/subsurface-core";
import type { SitePointCloud } from "@ikhmalputra/subsurface-react/3d";
import { useStimulationView } from "../data/stimulation-store.ts";
import { STAGES_2022 } from "../data/stimulation-model.ts";
import { siteById, useForgeCube, useForgeVolume } from "../data/sites.ts";
import { attributeAsSeismic, useAttributeVolume } from "../data/attribute-volumes.ts";
import { shoes } from "../data/forge.ts";
import { actions, signals, useDeck } from "../deck/store.ts";
import { useMoment } from "../data/history.ts";
import { Loading } from "./Empty.tsx";
import { useWire } from "./wire.ts";
import { sectionLineOnSite } from "./Curtain.tsx";
import { forgeCube, gridOf, surfaceOf, useHorizons } from "../data/horizons.ts";
import { useForgeTerrain, withoutFlatGround } from "../data/terrain.ts";
import { allSticks, faultSurfaceOf, faultsKey, useFaults } from "../data/faults.ts";

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
  // On FORGE, the horizons and faults picked in Horizons sit with the site's own surfaces.
  const horizons = useHorizons();
  const faults = useFaults();
  const terrain = useForgeTerrain(siteId === "forge");
  const surfaces = useMemo(() => {
    const own = withoutFlatGround(site?.surfaces ?? [], siteId === "forge" ? terrain : null);
    if (!site || siteId !== "forge" || !seismic.volume) return own;
    const cube = forgeCube(seismic.volume.counts), sticks = allSticks(faults), key = faultsKey(faults);
    return [...own, ...horizons.filter((entry) => entry.visible).map((entry) => surfaceOf(entry, gridOf(entry, cube, sticks, key))).filter((surface) => surface !== null),
      ...faults.filter((entry) => entry.visible).map(faultSurfaceOf).filter((surface) => surface !== null)];
  }, [site, siteId, seismic.volume, horizons, faults, terrain]);
  // The stimulation, while its module is open: the stages on 16A and the events, model and catalogue, in the site's frame.
  const stim = useStimulationView();
  const atForge = siteId === "forge" && stim !== null;
  const shift = { e: forge16aWellheads.asBuilt.eastingM - forgeSeismicSection.wellhead.eastingM, n: forge16aWellheads.asBuilt.northingM - forgeSeismicSection.wellhead.northingM, d: forgeSeismicSection.rkbElevationM };
  const points = useMemo((): SitePointCloud[] | null => !atForge ? null : [
    { id: "stim-model", label: "Model events", color: "#f59e0b", points: stim.model.map((e) => ({ e: e.x + shift.e, n: e.y + shift.n, d: shift.d - e.z, size: 10 ** (0.3 * (e.mw + 1)), color: e.colour })) },
    { id: "stim-observed", label: stim.observedLabel ?? "Catalogue", color: "#e2e8f0", opacity: 0.55, points: stim.observed.map((e) => ({ e: e.x + shift.e, n: e.y + shift.n, d: shift.d - e.z, size: 10 ** (0.3 * (e.mw + 1)) })) },
  ], [atForge, stim, shift.e, shift.n, shift.d]);
  // Keyed by the stages pumped, not the clock: the wells rebuild the scene, the points do not.
  const stagesKey = atForge ? stim.stages.map((s) => s.id).join(",") : "";
  const wells = useMemo(() => !site ? [] : !stagesKey ? site.wells : site.wells.map((well) => well.id !== "forge" ? well : { ...well, intervals: [...(well.intervals ?? []), ...STAGES_2022.filter((s) => stagesKey.split(",").includes(s.id)).map((s) => ({ topMdM: s.topFt * 0.3048, baseMdM: s.baseFt * 0.3048, label: s.label, color: s.colour }))] }), [site, stagesKey]);
  // At FORGE the slices can show an attribute of the same cube instead of the amplitude.
  const [show, setShow] = useState<"amplitude" | "coherence" | "fault" | "phase">("amplitude");
  const { cube } = useForgeCube(siteId === "forge" && show !== "amplitude");
  const attr = useAttributeVolume(cube, show === "amplitude" ? null : show);
  const volume = useMemo(() => seismic.volume && attr && show !== "amplitude" ? attributeAsSeismic(seismic.volume, attr, show) : seismic.volume, [seismic.volume, attr, show]);
  if (!site) return null;
  return <Suspense fallback={<Loading>Starting the 3D site…</Loading>}>
    <SiteScene key={site.map.id} title={`${site.map.label} in 3D`} depthLabel={site.depthLabel} originLabel={site.originLabel} wells={wells} surfaces={surfaces} points={points} terrain={siteId === "forge" ? terrain : null}
      seismic={site.hasSeismic ? volume : null} seismicClip={site.hasSeismic ? volume && volume !== seismic.volume ? 127 * volume.amplitudePerCount : forgeSeismicSection.section.p99AbsAmplitude : undefined} seismicNote={site.seismicNote}
      selectedWellId={wire.place?.wellId ?? wellId ?? (site.wells.length === 1 ? site.wells[0]!.id : null)} onSelectWell={(id) => actions.selectSite(site.map.id, id, "site3d")} cursor={cursor} reach={reach} hiddenMarkers={hiddenMarkers} highlight={highlight}
      tools={site.hasSeismic && <label className="sw-site-select s3-show">Slices<select value={show} onChange={(event) => setShow(event.target.value as typeof show)} aria-label="What the seismic slices show">
      <option value="amplitude">Amplitude</option><option value="coherence">Discontinuity</option><option value="fault">Fault likelihood</option><option value="phase">Phase</option>
    </select>{show !== "amplitude" && !attr && <small>computing…</small>}</label>} curtain={curtain} slices={site.hasSeismic ? slices : null} onSlicesChange={(next) => signals.setSeismicSlices({ inline: next.inline, crossline: next.crossline, time_depth: next.depth }, wire.source)} />
  </Suspense>;
}
