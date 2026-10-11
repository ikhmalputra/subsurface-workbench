import proj4 from "proj4";
import { geographicToWebMercator, webMercatorToGeographic } from "./crs.ts";
import type { SpatialXYZ, SubsurfaceStore } from "./state.ts";
export * from "./gis-layers.ts";

export type GeographicXY = readonly [longitude: number, latitude: number];
export type GisCrs = "EPSG:4326" | "EPSG:3857" | `EPSG:326${string}` | `EPSG:327${string}`;

function projection(crs: string): string {
  if (crs === "EPSG:4326" || crs === "EPSG:3857") return crs;
  const match = /^EPSG:(326|327)(\d{2})$/.exec(crs);
  const zone = match ? Number(match[2]) : 0;
  if (!match || zone < 1 || zone > 60) throw new TypeError(`Unsupported GIS CRS "${crs}". Supply WGS84, Web Mercator or WGS84 UTM; other datums require an explicit host transform.`);
  return `+proj=utm +zone=${zone} ${match[1] === "327" ? "+south" : ""} +datum=WGS84 +units=m +no_defs`;
}

/** Longitude-first XY only. No vertical-datum transformation is performed. */
export function reprojectGisXY(xy: readonly number[], from: string, to: string): GeographicXY {
  if (xy.length !== 2 || !xy.every(Number.isFinite)) throw new TypeError("GIS XY must contain two finite coordinates.");
  const source = projection(from), target = projection(to);
  let geographic: GeographicXY;
  if (from === "EPSG:4326") geographic = [xy[0]!, xy[1]!];
  else if (from === "EPSG:3857") {
    const result = webMercatorToGeographic([xy[0]!, xy[1]!, 0]);
    geographic = [result[0], result[1]];
  } else {
    const result = proj4(source, "EPSG:4326", [xy[0]!, xy[1]!]);
    geographic = [result[0]!, result[1]!];
  }
  if (!geographic.every(Number.isFinite) || Math.abs(geographic[0]) > 180 || Math.abs(geographic[1]) > 85.0511287798066) {
    throw new RangeError("GIS coordinate is outside the supported geographic map extent.");
  }
  if (to === "EPSG:4326") return geographic;
  if (to === "EPSG:3857") {
    const result = geographicToWebMercator([geographic[0], geographic[1], 0]);
    return [result[0], result[1]];
  }
  const result = proj4("EPSG:4326", target, [geographic[0], geographic[1]]);
  if (!result.every(Number.isFinite)) throw new RangeError("GIS projection produced non-finite coordinates.");
  return [result[0]!, result[1]!];
}

export interface GisLayer {
  readonly id: string;
  readonly label: string;
  readonly crs: string;
  readonly kind: "seismic-footprint" | "surface-outline";
  readonly geometry: "LineString" | "Polygon";
  /** One line or one exterior ring. Polygon rings must be explicitly closed. */
  readonly coordinates: readonly GeographicXY[];
  readonly source: string;
  readonly provenance: "documented" | "synthetic" | "user-authored";
  /** Null means the outline contains no elevation values; it is not a 3D surface. */
  readonly elevationDatum: null;
}

export interface GisWell {
  readonly id: string;
  readonly label: string;
  readonly crs: string;
  readonly depthDatum: string;
  readonly source: string;
  readonly provenance: "documented" | "synthetic" | "user-authored";
  /** Source XY in declared projected CRS, Z = TVD in metres positive down. */
  readonly xyz: Float64Array;
  readonly depthsMdM: Float64Array;
}

export interface GisDocument {
  readonly version: 1;
  readonly id: string;
  readonly wells: readonly GisWell[];
  readonly layers: readonly GisLayer[];
}

export interface GisStation {
  readonly index: number;
  readonly mdM: number;
  readonly xyz: SpatialXYZ;
  readonly geographic: GeographicXY;
}
export interface GeographicGisModel {
  readonly document: GisDocument;
  readonly wells: readonly { readonly well: GisWell; readonly stations: readonly GisStation[] }[];
  readonly layers: readonly { readonly layer: GisLayer; readonly coordinates: readonly GeographicXY[] }[];
  readonly bounds: readonly [GeographicXY, GeographicXY];
}

function metadata(id: string, label: string, source: string, provenance: string) {
  if (![id, label, source].every((value) => typeof value === "string" && value.trim())) throw new TypeError("GIS records require non-empty ID, label and source.");
  if (!["documented", "synthetic", "user-authored"].includes(provenance)) throw new TypeError(`Invalid GIS provenance for "${id}".`);
}

export function prepareGisDocument(document: GisDocument): GeographicGisModel {
  if (document.version !== 1 || !document.id.trim() || !document.wells.length) throw new TypeError("GIS document requires version 1, ID and at least one well.");
  const ids = [...document.wells, ...document.layers].map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new TypeError("GIS well and layer IDs must be globally unique.");
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const include = (xy: GeographicXY) => {
    minLng = Math.min(minLng, xy[0]); minLat = Math.min(minLat, xy[1]);
    maxLng = Math.max(maxLng, xy[0]); maxLat = Math.max(maxLat, xy[1]);
    return xy;
  };
  const wells = document.wells.map((well) => {
    metadata(well.id, well.label, well.source, well.provenance);
    if (!well.depthDatum.trim()) throw new TypeError(`GIS well "${well.id}" requires a depth datum.`);
    if (well.crs === "EPSG:4326") throw new TypeError("GIS well XYZ requires a projected metre-based CRS; geographic degrees must be transformed before constructing the well.");
    projection(well.crs);
    if (!(well.xyz instanceof Float64Array) || !(well.depthsMdM instanceof Float64Array) || well.depthsMdM.length < 2 || well.xyz.length !== well.depthsMdM.length * 3) throw new TypeError("GIS well requires aligned Float64 XYZ and MD arrays with at least two stations.");
    const stations = Array.from(well.depthsMdM, (mdM, index): GisStation => {
      const xyz: SpatialXYZ = [well.xyz[index * 3]!, well.xyz[index * 3 + 1]!, well.xyz[index * 3 + 2]!];
      if (!xyz.every(Number.isFinite) || !Number.isFinite(mdM) || mdM < 0 || (index > 0 && mdM <= well.depthsMdM[index - 1]!)) throw new TypeError(`GIS well "${well.id}" contains invalid or non-increasing stations.`);
      return { index, mdM, xyz, geographic: include(reprojectGisXY([xyz[0], xyz[1]], well.crs, "EPSG:4326")) };
    });
    return { well, stations };
  });
  const layers = document.layers.map((layer) => {
    metadata(layer.id, layer.label, layer.source, layer.provenance);
    if (!["seismic-footprint", "surface-outline"].includes(layer.kind) || !["LineString", "Polygon"].includes(layer.geometry)) throw new TypeError(`GIS layer "${layer.id}" has unsupported geometry or kind.`);
    if (layer.elevationDatum !== null) throw new TypeError("GIS outlines carry no elevation; elevationDatum must be null.");
    if (layer.coordinates.length < (layer.geometry === "Polygon" ? 4 : 2)) throw new TypeError(`GIS layer "${layer.id}" has too few coordinates.`);
    if (layer.geometry === "Polygon") {
      const first = layer.coordinates[0]!, last = layer.coordinates.at(-1)!;
      if (first[0] !== last[0] || first[1] !== last[1]) throw new TypeError(`GIS polygon "${layer.id}" must have an explicitly closed ring.`);
    }
    return { layer, coordinates: layer.coordinates.map((xy) => include(reprojectGisXY(xy, layer.crs, "EPSG:4326"))) };
  });
  if (maxLng - minLng > 180) throw new RangeError("Antimeridian-spanning GIS documents are not supported in this slice.");
  return { document, wells, layers, bounds: [[minLng, minLat], [maxLng, maxLat]] };
}

/** Both map and 3D adapters publish the same exact supplied station, never mixed-frame XYZ. */
export function selectGisStation(store: SubsurfaceStore, well: GisWell, index: number, source = "gis"): void {
  if (!Number.isInteger(index) || index < 0 || index >= well.depthsMdM.length) throw new RangeError("GIS station index is outside the supplied trajectory.");
  const mdM = well.depthsMdM[index]!;
  const xyz: SpatialXYZ = [well.xyz[index * 3]!, well.xyz[index * 3 + 1]!, well.xyz[index * 3 + 2]!];
  if (!xyz.every(Number.isFinite) || !Number.isFinite(mdM) || mdM < 0) throw new TypeError("GIS selection requires a finite supplied XYZ/MD station.");
  store.focusAsset(well.id, null, source);
  store.pinDepth(well.id, mdM, source);
  store.triggerSpatialPick(xyz, source);
}
