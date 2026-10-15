import { useMemo } from "react";
import { Slice } from "lucide-react";
import { cubeAlongLine, forgeSeismicSection, projectOntoSection, tvdToSeismicDepth } from "@ikhmalputra/subsurface-core";
import type { LineTrace, ProjectedPoint } from "@ikhmalputra/subsurface-core";
import { reprojectGisXY } from "@ikhmalputra/subsurface-core/gis";
import { SeismicSection } from "@ikhmalputra/subsurface-react/2d";
import { formationHorizons, sectionIntervals, sectionMarkers } from "../data/forge.ts";
import { siteById, useForgeCube } from "../data/sites.ts";
import { useDeck } from "../deck/store.ts";
import { fmt } from "../format.ts";
import { Empty, Loading } from "./Empty.tsx";
import { useWire } from "./wire.ts";

const meta = forgeSeismicSection;
const FORGE_CRS = "EPSG:26912";
/** A well belongs on the curtain where it passes within two bins of the plane. */
const NEAR_M = 2 * (meta.subVolume?.spacingM ?? 25);
const COLOURS: Readonly<Record<string, string>> = { forge: "#1f6fb2", "16b": "#c2410c", "58-32": "#0f766e" };
const byDistance = (trace: LineTrace) => trace.distanceM;

/** Map ends (longitude, latitude) to site metres from 16A's wellhead, and to the cube's axes. */
export function sectionLineOnSite(line: readonly [readonly [number, number], readonly [number, number]]) {
  const head = meta.wellhead;
  const ends = line.map(([lon, lat]) => { const [e, n] = reprojectGisXY([lon, lat], "EPSG:4326", FORGE_CRS); return { e, n }; });
  const cube = projectOntoSection(ends.map((end) => ({ mdM: 0, eastingM: end.e, northingM: end.n, depthM: 0 })), { originEastingM: head.eastingM, originNorthingM: head.northingM, azimuthDeg: meta.section.azimuthDeg });
  return { ends, site: ends.map((end) => [end.e - head.eastingM, end.n - head.northingM] as const), cube };
}

/** The stretches of a projected path within `near` metres of the plane, each kept whole. */
function runsNear(path: readonly ProjectedPoint[], near: number) {
  const runs: ProjectedPoint[][] = [];
  let current: ProjectedPoint[] = [];
  for (const point of path) {
    if (Math.abs(point.offsetM) <= near) current.push(point);
    else if (current.length) { runs.push(current); current = []; }
  }
  if (current.length) runs.push(current);
  return runs.filter((run) => run.length > 1);
}

/**
 * The PSDM along a line drawn on the globe: nearest-bin traces every 25 m, clipped to the volume.
 * Every FORGE well that passes within two bins of the plane is drawn where it does; 16A's stretch
 * is linked to the depth cursor and carries its strings and tops.
 */
export function Curtain() {
  const wire = useWire("curtain");
  const line = useDeck((deck) => deck.sectionLine);
  const fusedTops = useDeck((deck) => "section>curtain" in deck.fusions);
  const { cube, error } = useForgeCube(line !== null);
  const result = useMemo(() => {
    if (!line || !cube) return null;
    const { ends, cube: ends2 } = sectionLineOnSite(line);
    const cut = cubeAlongLine(cube, ends2[0]!, ends2[1]!, cube.spacingM);
    const azimuth = (Math.atan2(ends[1]!.e - ends[0]!.e, ends[1]!.n - ends[0]!.n) * 180 / Math.PI + 360) % 360;
    const onLine = { originEastingM: ends[0]!.e, originNorthingM: ends[0]!.n, azimuthDeg: azimuth };
    const head = meta.wellhead;
    const wells = (siteById("forge")?.wells ?? []).map((well) => {
      const points = Array.from({ length: well.mdM.length }, (_, i) => ({ mdM: well.mdM[i]!, eastingM: head.eastingM + well.xyz[i * 3]!, northingM: head.northingM + well.xyz[i * 3 + 1]!, depthM: tvdToSeismicDepth(well.xyz[i * 3 + 2]!, meta.rkbElevationM, meta.seismicDatumElevationM) }));
      return { well, runs: runsNear(projectOntoSection(points, onLine), NEAR_M) };
    });
    return { cut, azimuth, wells };
  }, [line, cube]);
  if (!line) return <Empty icon={Slice} title="No section line">On the globe, choose Draw section and drag a line, from one well to another or anywhere across the dashed PSDM outline. Its ends snap to wellheads.</Empty>;
  if (!result) return <Loading>{error ? `The volume could not be read (${error}).` : "Reading the PSDM volume…"}</Loading>;
  const { cut, azimuth, wells } = result;
  if (!cut.inside || cut.traces.traceCount < 2) return <Empty icon={Slice} title="The line misses the volume">{`The line is ${fmt(cut.lengthM)} m long and does not cross the PSDM cut (the dashed outline on the globe). Draw it across the outline.`}</Empty>;
  const own = [...(wells.find((entry) => entry.well.id === "forge")?.runs ?? [])].sort((a, b) => b.length - a.length)[0] ?? [];
  const others = wells.flatMap(({ well, runs }) => runs.filter((run) => run !== own).map((run, index) => ({ id: `${well.id}-${index}`, label: well.label, color: COLOURS[well.id] ?? "#94a3b8", path: run })));
  const near = wells.filter((entry) => entry.runs.length).map((entry) => entry.well.label);
  const intervals = [...sectionIntervals(wire.selected), ...(wire.brush ? [{ id: "brush", label: "Brushed interval", topMdM: wire.brush[0], baseMdM: wire.brush[1], color: "#ff8a3d" }] : [])];
  return <div className="construction">
    <p className="curtain-head">{fmt(cut.lengthM)} m at {fmt(azimuth)}° grid · {fmt(cut.inside[1] - cut.inside[0])} m inside the PSDM ({fmt(cut.inside[0])}–{fmt(cut.inside[1])} m along) · {near.length ? `near the plane: ${near.join(", ")}` : `no well passes within ${NEAR_M} m`}</p>
    <div className="construction-body">
      <SeismicSection file={cut.traces} traceX={byDistance} xLabel="Along the line from its first end (m)" depthStep={meta.volume.sampleIntervalM} depthLabel="m below datum"
        wellPath={own} otherWells={others} horizons={fusedTops ? formationHorizons : []} intervals={own.length ? intervals : []} markers={own.length ? sectionMarkers : []}
        selectedId={wire.componentId} cursorMdM={wire.cursor} onSelectMd={wire.pin} onCursorMdChange={wire.hover}
        title={`Section line · nearest-bin traces every ${meta.subVolume?.spacingM ?? 25} m · wells within ${NEAR_M} m of the plane`} />
    </div>
  </div>;
}
