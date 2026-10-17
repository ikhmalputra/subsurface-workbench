import { briefToWellDesign, exampleWellBrief, forge16aWellheads, forgeDesign, forgeNeighbours, forgeSeismicSection, getWellComponents, mdAtSurveyTvd, mdAtTvd, researchDesign, sProfileDesign, surveyPointAtMd } from "@ikhmalputra/subsurface-core";
import type { WellDesign, WellDesignBrief } from "@ikhmalputra/subsurface-core";
import { prepareGisDocument, reprojectGisXY } from "@ikhmalputra/subsurface-core/gis";
import type { GeographicXY } from "@ikhmalputra/subsurface-core/gis";
import { createMockTrajectory } from "@ikhmalputra/subsurface-core/sandbox";
import { syntheticReservoirLogs } from "@ikhmalputra/subsurface-core/contracts";
import type { SyntheticLogs } from "@ikhmalputra/subsurface-core/contracts";
import { catalogueWell, gridConvergenceDeg, trueToGrid } from "@ikhmalputra/subsurface-core/data-contract";
import type { CanonicalMarker, CataloguedWell, CataloguedWellbore, Provenance, TrajectoryStation, WellBundle } from "@ikhmalputra/subsurface-core/data-contract";
import type { WellsMapSite } from "./wells-map.js";
import type { SiteSceneSurface, SiteSceneWell } from "./site-scene.js";

/**
 * Wells as sites on a map of the world (`WellsMap`), and each site as one 3D frame (`SiteScene`).
 *
 * Every site is built the same way: from wells in the data contract
 * (`@ikhmalputra/subsurface-core/data-contract`), whatever source served them. A tenant's OSDU,
 * WITSML or PPDM wells and the bundled samples go through one builder, `siteOfWells`. What a sample
 * site adds goes on top as options: FORGE's seismic outline and frame, Equator's picked surfaces, a
 * design's reservoir.
 *
 * A site is drawn from what its records declare and nothing else. Wells that declare no location
 * are listed as such, not placed. The reservoir colour is the same in every site, so a reservoir
 * reads as one thing wherever it is.
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

// ── The generic builder ───────────────────────────────────────────────────────────────────────

/** How a site of catalogued wells is drawn: its name, its frame, what it says about itself, and what it adds. */
export interface WellsSiteOptions {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  readonly provenance: "documented" | "synthetic" | "user-authored";
  readonly caveat: string;
  readonly seismicNote: string;
  /**
   * The frame the wells are drawn in. By default:
   * - the grid is the WGS84 / UTM zone of the wells' centre;
   * - the origin is the wellheads' mean;
   * - depth is below sea level when every wellbore gives its datum's elevation, else below each
   *   wellbore's own datum.
   * A site with something else in the same frame (FORGE's seismic) fixes all three.
   */
  readonly frame?: {
    readonly crs?: string;
    readonly origin?: readonly [number, number];
    /** "sea": below mean sea level. "datum": below the (one) well's own datum. A number: below that elevation above sea level. */
    readonly depth?: "sea" | "datum" | number;
  };
  /** The id the deck's signal bus knows a wellbore by; the wellbore's own id by default. */
  readonly busId?: (entry: CataloguedWell, wellbore: CataloguedWellbore) => string;
  /** Which picks are marked on the wells in 3D; every kind by default. */
  readonly markerKinds?: readonly CanonicalMarker["kind"][];
  /** Picks triangulated between the wells as surfaces, for display: the kinds, their colour, how many wells must share a pick, and their ids and labels. */
  readonly surfaces?: {
    readonly kinds: readonly CanonicalMarker["kind"][];
    readonly colour: (name: string) => string;
    readonly minWells?: number;
    readonly id?: (name: string) => string;
    readonly label?: (name: string) => string;
  };
  /** Sea, seabed and ground as flat planes from what the wells give. On by default. */
  readonly referencePlanes?: boolean;
  /** The seabed triangulated between the wellheads, for subsea wells whose heads sit on it. */
  readonly seabedFromHeads?: boolean;
  /** Surfaces of the site's own, added after the wells' (FORGE's granite plane, a design's reservoir). */
  readonly extraSurfaces?: readonly SiteSceneSurface[];
  /** Marks the contract does not carry yet (casing shoes), by wellbore. */
  readonly extraMarkers?: (wellbore: CataloguedWellbore) => readonly { readonly mdM: number; readonly label: string }[];
  /** Coloured intervals along a well (a reservoir), by wellbore. */
  readonly intervals?: (wellbore: CataloguedWellbore) => SiteSceneWell["intervals"];
  readonly footprints?: WellsMapSite["footprints"];
  readonly projectWellId?: string | null;
  readonly hasSeismic?: boolean;
  readonly depthLabel?: string;
  readonly originLabel?: string;
}

/**
 * A site from catalogued wells, whatever source served them: how a tenant's field reaches the
 * globe and the 3D site, and how the samples do.
 *
 * - **Placement:** each wellhead is placed by its position in the frame's grid. That is the source's
 *   own projected position when it is in the same grid; otherwise its WGS84 location reprojected.
 * - **North:** a survey to true north is turned onto grid north by the convergence at its wellhead.
 * - **Depth:** a station's depth is `reference − (datum elevation − TVD)`, so wells measured from
 *   different datums line up.
 * - **On the map:** every located well. **In 3D:** the wells with a path.
 *
 * Returns null when no well has a location.
 */
export function siteOfWells(wells: readonly CataloguedWell[], options: WellsSiteOptions): WorldSite | null {
  // A well listed by its header alone has no wellbore yet: it stands in with its own id and no path.
  const placed = wells.flatMap((entry) => {
    const bore = entry.wellbores.find((candidate) => candidate.path.length >= 2) ?? entry.wellbores[0] ?? headerOnly(entry);
    return entry.well.location ? [{ entry, bore, location: entry.well.location }] : [];
  });
  if (!placed.length) return null;
  // Headers only, no paths yet (a field still being read): the wells go on the map as they are, with
  // nothing to place in a frame. This keeps a source of many fields quick to list.
  if (!placed.some((item) => item.bore && item.bore.path.length >= 2) && !options.frame && !options.extraSurfaces?.length && !options.footprints) {
    return {
      map: { id: options.id, label: options.label, provenance: options.provenance, summary: options.summary, wells: placed.map((item) => ({ id: options.busId?.(item.entry, item.bore) ?? item.bore.wellbore.id, label: item.entry.well.name, head: [item.location.longitude, item.location.latitude] as GeographicXY, path: [] })) },
      projectWellId: options.projectWellId ?? null, depthLabel: options.depthLabel ?? "m TVD", originLabel: options.originLabel ?? "wells listed; paths not read yet",
      wells: [], surfaces: [], hasSeismic: options.hasSeismic ?? false, seismicNote: options.seismicNote, caveat: options.caveat,
    };
  }
  const centre: GeographicXY = [placed.reduce((sum, item) => sum + item.location.longitude, 0) / placed.length, placed.reduce((sum, item) => sum + item.location.latitude, 0) / placed.length];
  const crs = options.frame?.crs ?? utmZoneOf(centre[0], centre[1]);
  const utm = /^EPSG:(?:326|327|269)(\d{2})$/.exec(crs);
  const meridian = utm ? -183 + 6 * Number(utm[1]) : null;
  const heads = placed.map((item) => {
    const own = item.location.projected;
    return own && own.crs === crs ? [own.easting, own.northing] as const : reprojectGisXY([item.location.longitude, item.location.latitude], "EPSG:4326", crs);
  });
  const [ox, oy] = options.frame?.origin ?? [heads.reduce((sum, head) => sum + head[0], 0) / heads.length, heads.reduce((sum, head) => sum + head[1], 0) / heads.length];
  // The frame's depth reference comes from the wells with a path; a well still listed by its header alone has no datum to give.
  const pathed = placed.filter((item) => item.bore.path.length >= 2);
  const known = pathed.every((item) => item.bore.wellbore.datum.elevationM !== null);
  const depth = options.frame?.depth ?? (known ? "sea" : "datum");
  // The elevation depths are measured below; "datum" is the first well's own datum.
  const firstDatum = (pathed[0] ?? placed[0]!).bore.wellbore.datum;
  const reference = typeof depth === "number" ? depth : depth === "sea" ? 0 : firstDatum.elevationM ?? 0;
  const unknownNorth = pathed.filter((item) => item.bore.trajectory?.azimuthReference === "unknown").length;
  const kinds = options.markerKinds;

  const all = placed.map((item, index) => {
    const head = heads[index]!, path = item.bore.path;
    // A station's depth in the frame: how far below the reference elevation it lies.
    const datum = depth === "datum" ? reference : item.bore.wellbore.datum.elevationM ?? 0;
    const turn = item.bore.trajectory?.azimuthReference === "true" && meridian !== null ? gridConvergenceDeg(item.location.longitude, item.location.latitude, meridian) : 0;
    const frame = (point: { readonly tvdM: number; readonly northingM: number; readonly eastingM: number }): [number, number, number] => {
      const grid = turn ? trueToGrid(point.northingM, point.eastingM, turn) : { northM: point.northingM, eastM: point.eastingM };
      return [head[0] - ox + grid.eastM, head[1] - oy + grid.northM, reference - datum + point.tvdM];
    };
    const inside = (md: number) => path.length >= 2 && md >= path[0]!.mdM && md <= path.at(-1)!.mdM;
    const id = options.busId?.(item.entry, item.bore) ?? item.bore.wellbore.id;
    const markers = [
      ...item.bore.markers.filter((marker) => (!kinds || kinds.includes(marker.kind)) && inside(marker.mdM)).map((marker) => ({ mdM: marker.mdM, label: marker.name })),
      ...(options.extraMarkers?.(item.bore) ?? []),
    ];
    const intervals = options.intervals?.(item.bore) ?? [];
    const scene: SiteSceneWell = { id, label: item.entry.well.name, provenance: options.provenance, xyz: Float64Array.from(path.flatMap((point) => frame(point))), mdM: Float64Array.from(path.map((point) => point.mdM)), markers, ...(intervals.length ? { intervals } : {}) };
    const toLonLat = (point: { readonly northingM: number; readonly eastingM: number }) => { const [e, n] = frame({ ...point, tvdM: 0 }); return reprojectGisXY([e + ox, n + oy], crs, "EPSG:4326"); };
    const map = { id, label: item.entry.well.name, head: [item.location.longitude, item.location.latitude] as GeographicXY, path: path.map(toLonLat) };
    return { item, scene, map, inside, at: (md: number) => frame(surveyPointAtMd(path, md)), head: frame({ tvdM: 0, northingM: 0, eastingM: 0 }), hasPath: path.length >= 2 };
  });
  const drawn = all.filter((well) => well.hasPath);

  const surfaces: SiteSceneSurface[] = [];
  const offshore = placed.some((item) => item.entry.well.environment === "offshore");
  const referenceName = depth === "sea" ? "mean sea level" : depth === "datum" ? `the ${firstDatum.reference}` : `${reference} m above sea level`;
  if (options.referencePlanes !== false) {
    if (offshore) surfaces.push({ id: "sea", label: depth === "sea" ? "Sea level" : "Sea surface", provenance: options.provenance, role: "reference", color: "#3f8fc0",
      note: depth === "sea" ? "0 m, mean sea level: the depth reference of every well here." : `Mean sea level, ${reference} m below ${referenceName}.`, geometry: { kind: "plane", depthM: reference } });
    if (placed.length === 1 && !options.seabedFromHeads) {
      const { entry } = placed[0]!;
      if (entry.well.environment === "offshore" && entry.well.waterDepthM !== null)
        surfaces.push({ id: "seabed", label: "Seabed", provenance: options.provenance, role: "reference", color: "#6b7f6a", note: `Flat at the ${entry.well.waterDepthM} m water depth given. Not bathymetry.`, geometry: { kind: "plane", depthM: reference + entry.well.waterDepthM } });
      if (entry.well.environment === "onshore" && entry.well.groundElevationM !== null)
        surfaces.push({ id: "ground", label: "Ground", provenance: options.provenance, role: "reference", color: "#8a7a5c", note: `Flat at the ${entry.well.groundElevationM} m ground elevation given, ${Math.round((reference - entry.well.groundElevationM) * 10) / 10} m below ${referenceName}.`, geometry: { kind: "plane", depthM: reference - entry.well.groundElevationM } });
    }
  }
  if (options.seabedFromHeads) surfaces.push({ id: "seabed", label: "Seabed (illustrative)", provenance: options.provenance, role: "reference", color: "#6b7f6a", note: `Interpolated between the ${drawn.length} wellheads' water depths. Not bathymetry.`, geometry: { kind: "tin", points: drawn.map((well) => [well.scene.xyz[0]!, well.scene.xyz[1]!, well.scene.xyz[2]!] as [number, number, number]) } });
  if (options.surfaces) {
    const { kinds: surfaceKinds, colour, minWells = 3 } = options.surfaces;
    const names = [...new Set(drawn.flatMap((well) => well.item.bore.markers.filter((marker) => surfaceKinds.includes(marker.kind)).map((marker) => marker.name)))];
    for (const name of names) {
      const points = drawn.flatMap((well) => { const pick = well.item.bore.markers.find((marker) => marker.name === name && surfaceKinds.includes(marker.kind)); return pick && well.inside(pick.mdM) ? [well.at(pick.mdM)] : []; });
      if (points.length >= minWells) surfaces.push({ id: options.surfaces.id?.(name) ?? `top-${name}`, label: options.surfaces.label?.(name) ?? `${name} top`, provenance: options.provenance, role: "horizon", color: colour(name),
        note: `The ${name} pick in ${points.length} wells, triangulated between them for display. Not a mapped surface.`, geometry: { kind: "tin", points } });
    }
  }
  surfaces.push(...(options.extraSurfaces ?? []));

  const caveats = [
    options.caveat,
    unknownNorth ? `${unknownNorth === pathed.length ? "The" : `${unknownNorth} of the`} surveys do not say whether azimuths are to grid or true north; they are drawn as grid.` : "",
    depth === "sea" && !known ? "Some wellbores give no datum elevation; their depths are taken from sea level." : "",
    depth === "datum" && placed.length > 1 ? "Each well's depths are from its own datum and do not line up between wells." : "",
  ].filter(Boolean);
  const zone = utm ? `${crs.startsWith("EPSG:269") ? "NAD83" : "WGS84"} / UTM ${utm[1]}${crs.startsWith("EPSG:327") ? "S" : "N"}` : crs;
  return {
    map: { id: options.id, label: options.label, provenance: options.provenance, summary: options.summary, wells: all.map((well) => well.map), ...(options.footprints ? { footprints: options.footprints } : {}) },
    projectWellId: options.projectWellId ?? null,
    depthLabel: options.depthLabel ?? (depth === "sea" ? "m TVD below sea level" : depth === "datum" ? `m TVD below ${firstDatum.reference}${firstDatum.elevationM !== null ? ` (${firstDatum.elevationM} m above MSL)` : ""}` : `m below ${reference} m above sea level`),
    originLabel: options.originLabel ?? `${placed.length === 1 ? "wellhead" : "centre of the wells"} · ${zone} grid`,
    wells: drawn.map((well) => well.scene), surfaces, hasSeismic: options.hasSeismic ?? false,
    seismicNote: options.seismicNote,
    caveat: caveats.join(" "),
  };
}

/** A well listed by its header alone, standing in as a wellbore with no path. */
const headerOnly = (entry: CataloguedWell): CataloguedWellbore => ({
  wellbore: { id: entry.well.id, wellId: entry.well.id, name: entry.well.name, status: "drilled", datum: { reference: "other", elevationM: null }, totalDepthMdM: null, provenance: entry.well.provenance },
  trajectory: null, path: [], markers: [],
});

/** Bundles checked and made ready to draw; a bundle that fails its checks is left out. */
const catalogued = (bundles: readonly WellBundle[], sourceId: string) => bundles.flatMap((bundle) => catalogueWell(bundle, sourceId).entry ?? []);

// ── Utah FORGE ────────────────────────────────────────────────────────────────────────────────

const FORGE_CRS = "EPSG:26912";
const forgeProvenance = (source: string): Provenance => ({ kind: "documented", source: `Utah FORGE, ${source}`, licence: "CC BY 4.0" });
const located = (easting: number, northing: number, crs: string) => { const [longitude, latitude] = reprojectGisXY([easting, northing], crs, "EPSG:4326"); return { longitude, latitude, projected: { crs, easting, northing } }; };

/** 16A(78)-32 and the neighbours surveyed around it, in the data contract, each at its own licensed or GPS wellhead. */
export function forgeBundles(): readonly WellBundle[] {
  const field = { id: "forge", name: "Utah FORGE" };
  const survey = forgeDesign.survey ?? [];
  const rkb = forgeSeismicSection.rkbElevationM;
  const markers: CanonicalMarker[] = (forgeDesign.formations ?? []).flatMap((layer) => {
    const md = mdAtSurveyTvd(survey, layer.topTvdM);
    return md === null ? [] : [{ id: layer.id, name: layer.name, mdM: md, tvdM: layer.topTvdM, kind: "formation" as const, lithology: layer.lithology }];
  });
  const head = forge16aWellheads.asBuilt;
  const main: WellBundle = {
    well: { id: "forge", name: "16A(78)-32", field, country: "United States", operator: "Utah FORGE (University of Utah)", location: located(head.eastingM, head.northingM, FORGE_CRS), environment: "onshore", waterDepthM: null,
      groundElevationM: forgeDesign.groundTvdM === undefined ? null : rkb - forgeDesign.groundTvdM, provenance: forgeProvenance(head.source) },
    wellbores: [{
      wellbore: { id: "forge", wellId: "forge", name: "16A(78)-32", status: "drilled", datum: { reference: "RKB", elevationM: rkb, description: "RKB 5,444 ft (the survey workbook)" }, totalDepthMdM: forgeDesign.totalDepthM, provenance: forgeProvenance("GDR 1283") },
      trajectories: [{ id: "forge-survey", wellboreId: "forge", name: forgeDesign.trajectoryName ?? "Final survey", kind: "definitive", azimuthReference: "unknown",
        stations: survey.map((point): TrajectoryStation => ({ mdM: point.mdM, inclinationDeg: point.inclinationDeg, azimuthDeg: point.azimuthDeg, tvdM: point.tvdM, northM: point.northingM, eastM: point.eastingM })),
        provenance: forgeProvenance(forgeDesign.trajectorySource ?? "GDR 1283") }],
      markerSets: markers.length ? [{ id: "forge-tops", wellboreId: "forge", name: "Formation tops", markers, provenance: forgeProvenance("GDR 1283") }] : [],
    }],
  };
  const neighbours = forgeNeighbours.map((placed): WellBundle => ({
    well: { id: placed.id, name: placed.label, field, country: "United States", location: located(placed.eastingM, placed.northingM, FORGE_CRS), environment: "onshore", waterDepthM: null, groundElevationM: null, provenance: forgeProvenance(placed.datumNote) },
    wellbores: [{
      wellbore: { id: placed.id, wellId: placed.id, name: placed.label, status: "drilled", datum: { reference: "KB", elevationM: placed.depthZeroElevationM, description: placed.datumNote }, totalDepthMdM: placed.stations.at(-1)?.mdM ?? null, provenance: forgeProvenance(placed.datumNote) },
      trajectories: [{ id: `${placed.id}-survey`, wellboreId: placed.id, name: "Survey", kind: "definitive", azimuthReference: "unknown",
        stations: placed.stations.map((station) => ({ mdM: station.mdM, tvdM: station.tvdM, northM: station.northingM, eastM: station.eastingM })), provenance: forgeProvenance(placed.datumNote) }],
      markerSets: [],
    }],
  }));
  return [main, ...neighbours];
}

/**
 * Utah FORGE as a site: 16A(78)-32, its neighbours and the PSDM volume around them. The frame is
 * the seismic section's: NAD83 / UTM 12N, origin at the section's wellhead, depths below 16A's RKB.
 * That way the volume, cut in that frame, sits where the wells are.
 */
export function forgeSite(wells: readonly CataloguedWell[] = catalogued(forgeBundles(), "samples")): WorldSite {
  const meta = forgeSeismicSection, head = meta.wellhead, cut = meta.subVolume;
  if (!cut) throw new Error("The FORGE seismic record declares no sub-volume to place.");
  const azimuth = cut.azimuthDeg * Math.PI / 180, sin = Math.sin(azimuth), cos = Math.cos(azimuth);
  const planOf = (along: number, offset: number) => [along * sin + offset * cos, along * cos - offset * sin] as const;
  const half = cut.spacingM / 2;
  const ring: GeographicXY[] = [[cut.alongFromM - half, cut.offsetFromM - half], [cut.alongToM + half, cut.offsetFromM - half], [cut.alongToM + half, cut.offsetToM + half], [cut.alongFromM - half, cut.offsetToM + half], [cut.alongFromM - half, cut.offsetFromM - half]]
    .map(([a, o]) => { const [e, n] = planOf(a!, o!); return reprojectGisXY([head.eastingM + e, head.northingM + n], FORGE_CRS, "EPSG:4326"); });
  const components = getWellComponents(forgeDesign);
  const shoes = components.filter((component) => component.kind === "Casing").map((component) => ({ mdM: component.bottomDepthM, label: `${component.name.split(" / ").pop()?.trim()} shoe` }));
  const granite = forgeDesign.formations?.find((layer) => layer.id === "granite");
  const graniteMd = (bore: CataloguedWellbore) => bore.markers.find((marker) => marker.id === "granite")?.mdM ?? null;
  const surfaces: SiteSceneSurface[] = [
    { id: "ground", label: "Ground level", provenance: "documented", role: "reference", color: "#7d8f55", note: `Flat at ${forgeDesign.groundTvdM?.toFixed(1)} m TVD below RKB. Terrain is not supplied.`, geometry: { kind: "plane", depthM: forgeDesign.groundTvdM ?? 0 } },
    ...(granite ? [{ id: "granite-top", label: "Granite reservoir top", provenance: "documented" as const, role: "horizon" as const, color: RESERVOIR.top, note: `Planar at the well's ${granite.topTvdM.toFixed(0)} m TVD contact. The record calls its regional extent conceptual; no dip or faulting is inferred.`, geometry: { kind: "plane" as const, depthM: granite.topTvdM } }] : []),
  ];
  return siteOfWells(wells, {
    id: "forge", label: "Utah FORGE 16A(78)-32", provenance: "documented",
    summary: "16A(78)-32 with its records · 16B(78)-32 and 58-32 surveys · 3D PSDM volume · 2 formations",
    frame: { crs: FORGE_CRS, origin: [head.eastingM, head.northingM], depth: meta.rkbElevationM },
    markerKinds: [], referencePlanes: false, extraSurfaces: surfaces, footprints: [{ id: "forge-psdm", label: "PSDM volume cut", ring }],
    extraMarkers: (bore) => { if (bore.wellbore.id !== "forge") return []; const md = graniteMd(bore); return [...shoes, ...(md !== null ? [{ mdM: md, label: "Granite top (well)" }] : [])]; },
    intervals: (bore) => { const md = graniteMd(bore); return bore.wellbore.id === "forge" && md !== null && granite ? [{ topMdM: md, baseMdM: bore.path.at(-1)!.mdM, label: granite.name, color: RESERVOIR.top }] : []; },
    projectWellId: "forge", hasSeismic: true, seismicNote: "",
    depthLabel: `m TVD below RKB (${meta.rkbElevationM.toFixed(0)} m ASL)`,
    originLabel: "seismic section origin (16A plan wellhead) · NAD83 / UTM 12N grid",
    caveat: "Documented: observed survey, casing shoes and the 3D PSDM volume from the Utah FORGE records. 16A and 16B stand at their licensed as-built wellheads (GDR 1283, 1516), 58-32 at its GPS-surveyed one (GDR 1358), 36.9 m and about 900 m apart; 58-32's depths are from its KB, 21.5 ft above ground (its log header). The seismic section runs through 16A's planned wellhead, 16.2 m north of where it was built. Seismic depth is converted from the 1,800 m ASL datum to TVD below RKB; PSDM depths are not tied to check-shots. NAD83 is taken as WGS84 on the map (within about 2 m).",
  })!;
}

// ── The Equator field (synthetic) ─────────────────────────────────────────────────────────────

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

/** The Equator field in the data contract: four generated wells, depths below sea level, Sand R1 picks. */
export function equatorBundles(project: EquatorField = equatorField()): readonly WellBundle[] {
  const field = { id: "equator", name: "Equator field" };
  const provenance: Provenance = { kind: "synthetic", source: "Generated offshore trajectories at assumed WGS84 / UTM 50N locations; Sand R1 picks interpreted on synthetic logs" };
  return project.records.map((record): WellBundle => {
    const water = project.waterDepthsM[record.well.id]!;
    const xyz = record.well.xyz, md = record.well.depthsMdM;
    const [longitude, latitude] = record.stations[0]!.geographic;
    const stations = Array.from(md, (mdM, i): TrajectoryStation => ({ mdM, tvdM: xyz[i * 3 + 2]! + water, northM: xyz[i * 3 + 1]! - xyz[1]!, eastM: xyz[i * 3]! - xyz[0]! }));
    return {
      well: { id: record.well.id, name: record.well.label, field, location: { longitude, latitude, projected: { crs: "EPSG:32650", easting: xyz[0]!, northing: xyz[1]! } }, environment: "offshore", waterDepthM: water, groundElevationM: null, provenance },
      wellbores: [{
        wellbore: { id: record.well.id, wellId: record.well.id, name: record.well.label, status: "drilled", datum: { reference: "MSL", elevationM: 0, description: "Sea surface (synthetic seabed wellhead)" }, totalDepthMdM: md[md.length - 1]!, provenance },
        trajectories: [{ id: `${record.well.id}-path`, wellboreId: record.well.id, name: "Generated trajectory", kind: "definitive", azimuthReference: "grid", stations, provenance }],
        markerSets: [{ id: `${record.well.id}-picks`, wellboreId: record.well.id, name: "Sand R1 picks", provenance,
          markers: record.tops.map((top) => ({ id: top.id, name: top.label, mdM: top.mdM, kind: "formation" as const })) }],
      }],
    };
  });
}

/** The Equator field as a site: four wells, their Sand R1 picks, and the sea and seabed above them. */
export function equatorSite(project: EquatorField = equatorField(), wells: readonly CataloguedWell[] = catalogued(equatorBundles(project), "samples")): WorldSite {
  const pick = (bore: CataloguedWellbore, id: string) => bore.markers.find((marker) => marker.id === id)?.mdM ?? null;
  return siteOfWells(wells, {
    id: "equator", label: "Equator field", provenance: "synthetic",
    summary: `${wells.length} wells · Sand R1 picks · no seismic`,
    frame: { crs: "EPSG:32650", origin: project.origin, depth: "sea" }, seabedFromHeads: true,
    surfaces: { kinds: ["formation"], colour: (name) => /base/.test(name) ? RESERVOIR.base : RESERVOIR.top, minWells: 3, id: (name) => /base/.test(name) ? "r1-base" : "r1-top", label: (name) => name },
    intervals: (bore) => { const top = pick(bore, "reservoir-top"), base = pick(bore, "reservoir-base"); return top !== null && base !== null ? [{ topMdM: top, baseMdM: base, label: "Sand R1", color: RESERVOIR.top }] : []; },
    seismicNote: "No seismic is supplied for this field.",
    depthLabel: "m below sea surface",
    originLabel: "field origin · WGS84 / UTM 50N, assumed location",
    caveat: "Synthetic: generated trajectories at assumed locations, illustrative water depths and interpreted Sand R1 picks. Surfaces between wells are interpolated for display only.",
  })!;
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

// ── Planned wells ─────────────────────────────────────────────────────────────────────────────

/** The WGS 84 / UTM zone a longitude and latitude fall in, as an EPSG code. */
export function utmZoneOf(longitude: number, latitude: number): string {
  const zone = Math.min(60, Math.max(1, Math.floor((longitude + 180) / 6) + 1));
  return `EPSG:${latitude >= 0 ? 326 : 327}${String(zone).padStart(2, "0")}`;
}

/** A design brief in the data contract: a planned well with its location, datum, planned path and formation tops. */
export function designBundle(record: { readonly siteId: string; readonly wellId: string; readonly builtIn: boolean }, brief: WellDesignBrief, design: WellDesign = briefToWellDesign(brief, "synthetic")): WellBundle {
  const provenance: Provenance = record.builtIn
    ? { kind: "synthetic", source: "Kestrel A-7, the SDK's example design brief" }
    : { kind: "user-authored", source: "Designed on the deck" };
  const name = brief.identity.name || "Unnamed well";
  const { latitude, longitude, environment, waterDepthM, groundElevationM } = brief.location;
  const markers = brief.geology.formations.flatMap((formation, i): CanonicalMarker[] => {
    const md = mdAtTvd(brief, formation.topTvdM);
    return md === null ? [] : [{ id: formation.reservoir ? `${record.wellId}-reservoir` : `${record.wellId}-top-${i}`, name: formation.name, mdM: md, tvdM: formation.topTvdM, kind: "formation", ...(formation.lithology ? { lithology: formation.lithology } : {}) }];
  });
  return {
    well: { id: record.wellId, name, field: { id: record.siteId, name: brief.identity.field || name }, ...(brief.identity.operator ? { operator: brief.identity.operator } : {}), ...(brief.identity.country ? { country: brief.identity.country } : {}),
      location: latitude === null || longitude === null ? null : { longitude, latitude }, environment: environment === "onshore" ? "onshore" : "offshore", waterDepthM, groundElevationM, provenance },
    wellbores: [{
      wellbore: { id: record.wellId, wellId: record.wellId, name, status: "planned", datum: { reference: brief.datum.reference, elevationM: brief.datum.elevationAboveMslM }, totalDepthMdM: brief.totalDepthMdM, provenance },
      trajectories: (design.survey ?? []).length >= 2 ? [{ id: `${record.wellId}-plan`, wellboreId: record.wellId, name: "Planned trajectory", kind: "planned", azimuthReference: "grid",
        stations: design.survey!.map((point) => ({ mdM: point.mdM, inclinationDeg: point.inclinationDeg, azimuthDeg: point.azimuthDeg, tvdM: point.tvdM, northM: point.northingM, eastM: point.eastingM })), provenance }] : [],
      markerSets: markers.length ? [{ id: `${record.wellId}-tops`, wellboreId: record.wellId, name: "Planned formation tops", markers, provenance }] : [],
    }],
  };
}

/**
 * A planned well from a design brief, placed as a site through the data contract:
 * - its path on the globe from the planned trajectory, in the location's own UTM zone;
 * - its depths below its own datum;
 * - the reference planes the brief gives: the sea and a flat seabed offshore, the ground onshore;
 * - the reservoir top it names.
 */
export function designSite(brief: WellDesignBrief, ids: { readonly siteId: string; readonly wellId: string }, builtIn = false): WorldSite & { readonly brief: WellDesignBrief; readonly design: WellDesign } {
  const design = briefToWellDesign(brief, "synthetic");
  if (brief.location.latitude === null || brief.location.longitude === null) throw new RangeError(`${brief.identity.name || "The well"} needs a surface location.`);
  const name = brief.identity.name || "Unnamed well";
  const reservoir = brief.geology.formations.find((formation) => formation.reservoir);
  const reservoirMd = (bore: CataloguedWellbore) => bore.markers.find((marker) => marker.id === `${ids.wellId}-reservoir`)?.mdM ?? null;
  const shoes = brief.sections.filter((section) => section.role !== "conductor").map((section) => ({ mdM: section.shoeMdM, label: `${section.label.split(" ")[0]} shoe` }));
  const wells = catalogued([designBundle({ ...ids, builtIn }, brief, design)], builtIn ? "samples" : "browser");
  const site = siteOfWells(wells, {
    id: ids.siteId, label: `${name} (design)`, provenance: "synthetic",
    summary: `1 planned well · ${brief.sections.length} string${brief.sections.length === 1 ? "" : "s"}${brief.geology.pressures.length ? " · pressures" : ""}${brief.completion ? " · completion" : ""}`,
    frame: { depth: "datum" }, markerKinds: [],
    extraMarkers: (bore) => { const md = reservoirMd(bore); return [...shoes, ...(reservoir && md !== null ? [{ mdM: md, label: `${reservoir.name} top` }] : [])]; },
    intervals: (bore) => { const md = reservoirMd(bore); return reservoir && md !== null ? [{ topMdM: md, baseMdM: brief.totalDepthMdM, label: reservoir.name, color: RESERVOIR.top }] : []; },
    extraSurfaces: reservoir ? [{ id: "reservoir-top", label: `${reservoir.name} top`, provenance: "synthetic", role: "horizon", color: RESERVOIR.top, note: `Flat at the brief's ${reservoir.topTvdM} m TVD top. The brief gives one depth per formation, not a mapped surface.`, geometry: { kind: "plane", depthM: reservoir.topTvdM } }] : [],
    depthLabel: `m TVD below ${brief.datum.reference} (${brief.datum.elevationAboveMslM ?? 0} m above MSL)`,
    seismicNote: "No seismic: this is a planned well from a design brief.",
    caveat: `Synthetic design. ${name} is a planned well: its trajectory, pressures, casing, cement and completion are the brief's, not records. Nothing here was drilled.`,
  });
  if (!site) throw new RangeError(`${name} could not be placed.`);
  return { ...site, brief, design };
}

/** The SDK's example design, Kestrel A-7, as a site. */
export function kestrelSite(brief: WellDesignBrief = exampleWellBrief()): WorldSite & { readonly brief: WellDesignBrief; readonly design: WellDesign } {
  const site = designSite(brief, { siteId: "kestrel", wellId: "kestrel-a7" }, true);
  return { ...site, caveat: `Synthetic design. ${brief.identity.name} is the SDK's example development well in the ${brief.identity.field} field: a planned trajectory, offset-derived pore and fracture pressures, a proposed casing scheme, cement and a gas-lift completion. Nothing here was drilled.` };
}

/** The bundled wells that declare no surface location, so cannot be placed on the map. */
export function unlocatedWells() {
  return [{ id: "s-profile", design: sProfileDesign, label: "S-profile completion" }, { id: "research", design: researchDesign, label: "Open research reference" }]
    .map(({ id, design, label }) => ({ id, label: `${label} · ${design.provenance}`, provenance: design.provenance, reason: "No surface location or coordinate reference is supplied." }));
}
