import { forgeDesign, forgeSeismicSection, getWellComponents } from "@ikhmalputra/subsurface-core";
import { reprojectGisXY } from "@ikhmalputra/subsurface-core/gis";
import type { GeographicXY } from "@ikhmalputra/subsurface-core/gis";
import { createMockTrajectory } from "@ikhmalputra/subsurface-core/sandbox";
import { prepareGisDocument } from "@ikhmalputra/subsurface-core/gis";
import { briefToWellDesign, exampleWellBrief, mdAtSurveyTvd, mdAtTvd, researchDesign, sProfileDesign } from "@ikhmalputra/subsurface-core";
import type { WellDesign, WellDesignBrief } from "@ikhmalputra/subsurface-core";
import { syntheticReservoirLogs } from "@ikhmalputra/subsurface-core/contracts";
import type { SyntheticLogs } from "@ikhmalputra/subsurface-core/contracts";
import type { WellsMapSite } from "./wells-map.js";
import type { SiteSceneSurface, SiteSceneWell } from "./site-scene.js";

/**
 * Wells as sites on a map of the world (`WellsMap`), and each site as one 3D frame (`SiteScene`).
 *
 * A site is drawn from what its records declare and nothing else: the FORGE wellhead and seismic
 * grid in NAD83 / UTM 12N, the Equator field's assumed UTM 50N locations. Wells that declare no
 * location are listed as such, not placed. The reservoir colour is the same in every site, so a
 * reservoir reads as one thing wherever it is.
 */

export const RESERVOIR = { top: "#d97706", base: "#92400e" } as const;

export interface WorldSite {
  readonly map: WellsMapSite;
  /** The project well a host can open in its well workspace, when the site is one of them. */
  readonly projectWellId: string | null;
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
  const topMd = granite ? mdAtSurveyTvd(survey, granite.topTvdM) : null;
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

/**
 * The synthetic Equator field: four generated wells at assumed WGS84 / UTM 50N locations in the
 * Makassar Strait, illustrative water depths, and interpreted Sand R1 top and base picks. The
 * reservoir is 2,200 m below sea, shifted 0.025 m/m east and 0.035 m/m north across the field;
 * the base is 210 m below the top, less 20 m per well. All of it is labelled synthetic.
 */
export function equatorField() {
  const origin = reprojectGisXY([118.7, 0.4], "EPSG:4326", "EPSG:32650");
  const offsets = [[-1800, -1000], [1200, 800], [-1000, 1800], [2400, -1600]] as const;
  const waterDepthsM: Record<string, number> = {};
  const wells = offsets.map(([east, north], index) => {
    const id = `offshore-${index + 1}`;
    const path = createMockTrajectory({ id, stations: 301, totalDepthMdM: 2400 + index * 250, seed: 75 + index * 67 });
    waterDepthsM[id] = 800 + index * 180;
    return {
      id, label: `Equator ${String.fromCharCode(65 + index)}`, crs: "EPSG:32650",
      depthDatum: "synthetic seabed wellhead", source: "Generated offshore trajectory; assumed WGS84 UTM 50N location", provenance: "synthetic" as const,
      xyz: Float64Array.from(path.xyz, (value, at) => at % 3 === 0 ? value + origin[0] + east : at % 3 === 1 ? value + origin[1] + north : value),
      depthsMdM: Float64Array.from(path.depthsMdM),
    };
  });
  const model = prepareGisDocument({ version: 1, id: "synthetic-equator-offshore", wells, layers: [] });
  const mdAtDepth = (xyz: Float64Array, depths: Float64Array, depth: number) => {
    for (let i = 1; i < depths.length; i++) {
      const a = xyz[(i - 1) * 3 + 2]!, b = xyz[i * 3 + 2]!;
      if (depth >= a && depth <= b) return depths[i - 1]! + (depth - a) / (b - a) * (depths[i]! - depths[i - 1]!);
    }
    throw new RangeError("Synthetic field marker is outside the supplied trajectory.");
  };
  const records = model.wells.map(({ well, stations }, index) => {
    const water = waterDepthsM[well.id]!;
    const head = stations[0]!.xyz;
    const reservoirTopDepth = 2200 + (head[0] - origin[0]) * 0.025 + (head[1] - origin[1]) * 0.035;
    const reservoirBaseDepth = reservoirTopDepth + 210 - index * 20;
    const tops = [
      { id: "reservoir-top", label: "Sand R1 top", mdM: mdAtDepth(well.xyz, well.depthsMdM, reservoirTopDepth - water) },
      { id: "reservoir-base", label: "Sand R1 base", mdM: mdAtDepth(well.xyz, well.depthsMdM, reservoirBaseDepth - water) },
    ];
    return { well, stations, tops, reservoirTopDepth, reservoirBaseDepth };
  });
  return { model, origin, waterDepthsM, records };
}

export type EquatorField = ReturnType<typeof equatorField>;

/** The Equator field as a site: four wells, their Sand R1 picks, and the sea and seabed above them. */
export function equatorSite(project: EquatorField = equatorField()): WorldSite {
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
    depthLabel: "m below sea surface",
    originLabel: "field origin · WGS84 / UTM 50N, assumed location",
    wells, surfaces, hasSeismic: false,
    seismicNote: "No seismic is supplied for this field.",
    caveat: "Synthetic: generated trajectories at assumed locations, illustrative water depths and interpreted Sand R1 picks. Surfaces between wells are interpolated for display only.",
  };
}

/** Field-wide fluid contacts of the synthetic Sand R1, metres below the sea surface. */
export const EQUATOR_CONTACTS = Object.freeze({ gocTvdssM: 2235, owcTvdssM: 2310 });

/**
 * Synthetic open-hole logs for each Equator well, from the rock-and-fluid model in core: logged
 * from 250 m above its Sand R1 top pick to 80 m below its base pick, on its own trajectory, with
 * the field's contacts by depth below sea. The structurally high wells (A and D) carry a gas cap;
 * every well has an oil leg over water. All of it is synthetic and labelled so.
 */
export function equatorPetrophysics(project: EquatorField = equatorField()): readonly { readonly wellId: string; readonly label: string; readonly logs: SyntheticLogs }[] {
  return project.records.map((record, index) => {
    const water = project.waterDepthsM[record.well.id]!;
    const depths = record.well.depthsMdM;
    const stations = Array.from(depths, (mdM, i) => ({ mdM, tvdssM: record.well.xyz[i * 3 + 2]! + water }));
    const top = record.tops.find((pick) => pick.id === "reservoir-top")!.mdM, base = record.tops.find((pick) => pick.id === "reservoir-base")!.mdM;
    const logs = syntheticReservoirLogs({
      wellId: record.well.id, stations,
      loggedFromMdM: Math.max(depths[0]!, top - 250), loggedToMdM: Math.min(depths[depths.length - 1]!, base + 80),
      sand: { topMdM: top, baseMdM: base, name: "Sand R1" }, contacts: EQUATOR_CONTACTS, seed: 75 + index * 67,
    });
    return { wellId: record.well.id, label: record.well.label, logs };
  });
}

/**
 * Kestrel A-7, the SDK's example development well, as a site: a planned J-profile from an offshore
 * Malaysian platform with offset-derived pressures, a proposed casing scheme, cement and a gas-lift
 * completion. It is a design, not a drilled well, and every part of it says so.
 */
export function kestrelSite(brief: WellDesignBrief = exampleWellBrief()): WorldSite & { readonly brief: WellDesignBrief; readonly design: WellDesign } {
  const design = briefToWellDesign(brief, "synthetic");
  const survey = design.survey ?? [];
  const { latitude, longitude } = brief.location;
  if (latitude === null || longitude === null) throw new RangeError("Kestrel A-7 needs a surface location.");
  const head = reprojectGisXY([longitude, latitude], "EPSG:4326", "EPSG:32650");
  const toLonLat = (east: number, north: number) => reprojectGisXY([head[0] + east, head[1] + north], "EPSG:32650", "EPSG:4326");
  const reservoir = brief.geology.formations.find((formation) => formation.reservoir);
  const reservoirMd = reservoir ? mdAtTvd(brief, reservoir.topTvdM) : null;
  const shoes = brief.sections.filter((section) => section.role !== "conductor").map((section) => ({ mdM: section.shoeMdM, label: `${section.label.split(" ")[0]} shoe` }));
  const well: SiteSceneWell = {
    id: "kestrel-a7", label: brief.identity.name, provenance: "synthetic",
    xyz: Float64Array.from(survey.flatMap((point) => [point.eastingM, point.northingM, point.tvdM])),
    mdM: Float64Array.from(survey.map((point) => point.mdM)),
    markers: [...shoes, ...(reservoir && reservoirMd !== null ? [{ mdM: reservoirMd, label: `${reservoir.name} top` }] : [])],
    intervals: reservoir && reservoirMd !== null ? [{ topMdM: reservoirMd, baseMdM: brief.totalDepthMdM, label: reservoir.name, color: RESERVOIR.top }] : [],
  };
  const rkb = brief.datum.elevationAboveMslM ?? 0;
  const mudline = rkb + (brief.location.waterDepthM ?? 0);
  const surfaces: SiteSceneSurface[] = [
    { id: "sea", label: "Sea surface", provenance: "synthetic", role: "reference", color: "#3f8fc0", note: `Mean sea level, ${rkb} m below the rig floor.`, geometry: { kind: "plane", depthM: rkb } },
    { id: "seabed", label: "Seabed", provenance: "synthetic", role: "reference", color: "#6b7f6a", note: `Flat at the brief's ${brief.location.waterDepthM} m water depth. Not bathymetry.`, geometry: { kind: "plane", depthM: mudline } },
    ...(reservoir ? [{ id: "reservoir-top", label: `${reservoir.name} top`, provenance: "synthetic" as const, role: "horizon" as const, color: RESERVOIR.top, note: `Flat at the brief's ${reservoir.topTvdM} m TVD top. The brief gives one depth per formation, not a mapped surface.`, geometry: { kind: "plane" as const, depthM: reservoir.topTvdM } }] : []),
  ];
  return {
    map: {
      id: "kestrel", label: `${brief.identity.name} (design)`, provenance: "synthetic",
      summary: `1 planned well · ${brief.sections.length} strings · pressures, cement, completion`,
      wells: [{ id: "kestrel-a7", label: brief.identity.name, head: [longitude, latitude], path: survey.map((point) => toLonLat(point.eastingM, point.northingM)) }],
    },
    projectWellId: null,
    depthLabel: `m TVD below RKB (${rkb} m above MSL)`,
    originLabel: `wellhead · ${brief.location.crs}`,
    wells: [well], surfaces, hasSeismic: false,
    seismicNote: "No seismic: this is a planned well from a design brief.",
    caveat: `Synthetic design. ${brief.identity.name} is the SDK's example development well in the ${brief.identity.field} field: a planned trajectory, offset-derived pore and fracture pressures, a proposed casing scheme, cement and a gas-lift completion. Nothing here was drilled.`,
    brief, design,
  };
}

/** The bundled wells that declare no surface location, so cannot be placed on the map. */
export function unlocatedWells() {
  return [{ id: "s-profile", design: sProfileDesign, label: "S-profile completion" }, { id: "research", design: researchDesign, label: "Open research reference" }]
    .map(({ id, design, label }) => ({ id, label: `${label} · ${design.provenance}`, provenance: design.provenance, reason: "No surface location or coordinate reference is supplied." }));
}
