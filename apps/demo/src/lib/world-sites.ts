import { forgeDesign, forgeSeismicSection, getWellComponents } from "@ikhmalputra/subsurface-core";
import { reprojectGisXY } from "@ikhmalputra/subsurface-core/gis";
import type { GeographicXY } from "@ikhmalputra/subsurface-core/gis";
import type { WellsMapSite } from "@ikhmalputra/subsurface-react/gis";
import type { SiteSceneSurface, SiteSceneWell } from "@ikhmalputra/subsurface-react/3d";
import type { FieldProject } from "./field-project.ts";
import { projectWells } from "./project.ts";

/**
 * The project's wells as sites on a map of the world, and each site as one 3D frame.
 *
 * A site is drawn from what its records declare and nothing else: the FORGE wellhead and seismic
 * grid in NAD83 / UTM 12N, the Equator field's assumed UTM 50N locations. Wells that declare no
 * location are listed as such, not placed. The reservoir colour is the same in every site, so a
 * reservoir reads as one thing wherever it is.
 */

export const RESERVOIR = { top: "#d97706", base: "#92400e" } as const;

export interface WorldSite {
  readonly map: WellsMapSite;
  /** The project well a reader can open in the well workspace, when the site is one of them. */
  readonly projectWellId: string | null;
  /** Documents that work on this site as a whole, opened from its header. */
  readonly documents?: readonly { readonly id: "field-gis" | "correlation" | "cross-section"; readonly label: string }[];
  readonly depthLabel: string;
  readonly originLabel: string;
  readonly wells: readonly SiteSceneWell[];
  readonly surfaces: readonly SiteSceneSurface[];
  readonly hasSeismic: boolean;
  readonly seismicNote?: string;
  /** What the reader should know before reading the site's geometry. */
  readonly caveat: string;
}

const FORGE_CRS = "EPSG:26912";

/** Utah FORGE 16A(78)-32: the documented well, its observed survey and the PSDM volume around it. */
export function forgeSite(): WorldSite {
  const meta = forgeSeismicSection, head = meta.wellhead;
  const survey = forgeDesign.survey ?? [];
  const toLonLat = (east: number, north: number) => reprojectGisXY([head.eastingM + east, head.northingM + north], FORGE_CRS, "EPSG:4326");
  const cut = meta.subVolume;
  if (!cut) throw new Error("The FORGE seismic record declares no sub-volume to place.");
  const azimuth = cut.azimuthDeg * Math.PI / 180, sin = Math.sin(azimuth), cos = Math.cos(azimuth);
  const planOf = (along: number, offset: number) => [along * sin + offset * cos, along * cos - offset * sin] as const;
  const half = cut.spacingM / 2;
  const ring: GeographicXY[] = [[cut.alongFromM - half, cut.offsetFromM - half], [cut.alongToM + half, cut.offsetFromM - half], [cut.alongToM + half, cut.offsetToM + half], [cut.alongFromM - half, cut.offsetToM + half], [cut.alongFromM - half, cut.offsetFromM - half]]
    .map(([a, o]) => { const [e, n] = planOf(a!, o!); return toLonLat(e, n); });
  const components = getWellComponents(forgeDesign);
  const shoes = components.filter((component) => component.kind === "Casing").map((component) => ({ mdM: component.bottomDepthM, label: `${component.name.split(" / ").pop()?.trim()} shoe` }));
  const granite = forgeDesign.formations?.find((layer) => layer.id === "granite");
  const mdAtTvd = (tvd: number) => {
    for (let i = 1; i < survey.length; i++) {
      const a = survey[i - 1]!, b = survey[i]!;
      if (tvd >= a.tvdM && tvd <= b.tvdM) return a.mdM + (tvd - a.tvdM) / (b.tvdM - a.tvdM || 1) * (b.mdM - a.mdM);
    }
    return null;
  };
  const topMd = granite ? mdAtTvd(granite.topTvdM) : null;
  const well: SiteSceneWell = {
    id: "forge", label: "16A(78)-32", provenance: "documented",
    xyz: Float64Array.from(survey.flatMap((point) => [point.eastingM ?? 0, point.northingM ?? 0, point.tvdM])),
    mdM: Float64Array.from(survey.map((point) => point.mdM)),
    markers: [...shoes, ...(topMd !== null && granite ? [{ mdM: topMd, label: "Granite top (well)" }] : [])],
    intervals: topMd !== null && granite ? [{ topMdM: topMd, baseMdM: survey.at(-1)!.mdM, label: granite.name, color: RESERVOIR.top }] : [],
  };
  const surfaces: SiteSceneSurface[] = [
    { id: "ground", label: "Ground level", provenance: "documented", role: "reference", color: "#7d8f55", note: `Flat at ${forgeDesign.groundTvdM?.toFixed(1)} m TVD below RKB. Terrain is not supplied.`, geometry: { kind: "plane", depthM: forgeDesign.groundTvdM ?? 0 } },
    ...(granite ? [{ id: "granite-top", label: "Granite reservoir top", provenance: "documented" as const, role: "horizon" as const, color: RESERVOIR.top, note: `Planar at the well's ${granite.topTvdM.toFixed(0)} m TVD contact. The record calls its regional extent conceptual; no dip or faulting is inferred.`, geometry: { kind: "plane" as const, depthM: granite.topTvdM } }] : []),
  ];
  return {
    map: {
      id: "forge", label: "Utah FORGE 16A(78)-32", provenance: "documented",
      summary: "1 well · observed survey · 3D PSDM volume · 2 formations",
      wells: [{ id: "forge", label: "16A(78)-32", head: toLonLat(0, 0), path: survey.map((point) => toLonLat(point.eastingM ?? 0, point.northingM ?? 0)) }],
      footprints: [{ id: "forge-psdm", label: "PSDM volume cut", ring }],
    },
    projectWellId: "forge",
    depthLabel: `m TVD below RKB (${meta.rkbElevationM.toFixed(0)} m ASL)`,
    originLabel: "wellhead · NAD83 / UTM 12N grid",
    wells: [well], surfaces, hasSeismic: true,
    caveat: "Documented: observed survey, casing shoes and the 3D PSDM volume from the Utah FORGE records. Seismic depth is converted from the 1,800 m ASL datum to TVD below RKB; PSDM depths are not tied to check-shots. NAD83 is taken as WGS84 on the map (within about 2 m).",
  };
}

/** The synthetic Equator field: four wells, their Sand R1 picks, and the sea and seabed above them. */
export function equatorSite(project: FieldProject): WorldSite {
  const [ox, oy] = project.origin;
  const wells: SiteSceneWell[] = project.records.map((record) => {
    const water = project.waterDepthsM[record.well.id]!;
    const xyz = new Float64Array(record.well.xyz.length);
    for (let i = 0; i < record.well.xyz.length; i += 3) { xyz[i] = record.well.xyz[i]! - ox; xyz[i + 1] = record.well.xyz[i + 1]! - oy; xyz[i + 2] = record.well.xyz[i + 2]! + water; }
    const top = record.tops.find((pick) => pick.id === "reservoir-top")!, base = record.tops.find((pick) => pick.id === "reservoir-base")!;
    return {
      id: record.well.id, label: record.well.label, provenance: "synthetic", xyz, mdM: record.well.depthsMdM,
      markers: record.tops.map((pick) => ({ mdM: pick.mdM, label: pick.label })),
      intervals: [{ topMdM: top.mdM, baseMdM: base.mdM, label: "Sand R1", color: RESERVOIR.top }],
    };
  });
  const pickPoint = (well: SiteSceneWell, md: number): [number, number, number] => {
    for (let i = 1; i < well.mdM.length; i++) if (md <= well.mdM[i]!) {
      const t = (md - well.mdM[i - 1]!) / (well.mdM[i]! - well.mdM[i - 1]! || 1);
      return [0, 1, 2].map((k) => well.xyz[(i - 1) * 3 + k]! + t * (well.xyz[i * 3 + k]! - well.xyz[(i - 1) * 3 + k]!)) as [number, number, number];
    }
    return [well.xyz[well.xyz.length - 3]!, well.xyz[well.xyz.length - 2]!, well.xyz[well.xyz.length - 1]!];
  };
  const picks = (id: string) => wells.map((well, index) => pickPoint(well, project.records[index]!.tops.find((pick) => pick.id === id)!.mdM));
  const heads = wells.map((well) => [well.xyz[0]!, well.xyz[1]!, well.xyz[2]!] as [number, number, number]);
  const surfaces: SiteSceneSurface[] = [
    { id: "sea", label: "Sea surface", provenance: "synthetic", role: "reference", color: "#3f8fc0", note: "0 m, the field's depth reference.", geometry: { kind: "plane", depthM: 0 } },
    { id: "seabed", label: "Seabed (illustrative)", provenance: "synthetic", role: "reference", color: "#6b7f6a", note: "Interpolated between the four assumed wellhead water depths. Not bathymetry.", geometry: { kind: "tin", points: heads } },
    { id: "r1-top", label: "Sand R1 top", provenance: "synthetic", role: "horizon", color: RESERVOIR.top, note: "Interpolated between the four wells' picks. Not a mapped surface.", geometry: { kind: "tin", points: picks("reservoir-top") } },
    { id: "r1-base", label: "Sand R1 base", provenance: "synthetic", role: "horizon", color: RESERVOIR.base, note: "Interpolated between the four wells' picks. Not a mapped surface.", geometry: { kind: "tin", points: picks("reservoir-base") } },
  ];
  return {
    map: {
      id: "equator", label: "Equator field", provenance: "synthetic",
      summary: `${project.records.length} wells · Sand R1 picks · no seismic`,
      wells: project.records.map((record) => ({ id: record.well.id, label: record.well.label, head: record.stations[0]!.geographic, path: record.stations.map((station) => station.geographic) })),
    },
    projectWellId: null,
    documents: [{ id: "field-gis", label: "Field GIS" }, { id: "correlation", label: "Correlation" }, { id: "cross-section", label: "Cross-section" }],
    depthLabel: "m below sea surface",
    originLabel: "field origin · WGS84 / UTM 50N, assumed location",
    wells, surfaces, hasSeismic: false,
    seismicNote: "No seismic is supplied for this field.",
    caveat: "Synthetic: generated trajectories at assumed locations, illustrative water depths and interpreted Sand R1 picks. Surfaces between wells are interpolated for display only.",
  };
}

/** Project wells that declare no surface location, so cannot be placed on the map. */
export function unlocatedWells() {
  return projectWells.filter((well) => well.id !== "forge").map((well) => ({ id: well.id, label: well.label, provenance: well.design.provenance, reason: "No surface location or coordinate reference is supplied." }));
}
