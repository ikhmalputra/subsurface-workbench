import proj4 from "proj4";
import { geographicToWebMercator, webMercatorToGeographic } from "./crs.ts";
import type { SpatialXYZ, SubsurfaceStore } from "./state.ts";
export * from "./gis-layers.ts";

export type GeographicXY = readonly [longitude: number, latitude: number];
/** An EPSG code such as "EPSG:23031", or a code registered with `registerCrs`. */
export type GisCrs = string;

/**
 * Which coordinate reference systems can be used, and how.
 *
 * - WGS 84 (EPSG:4326), Web Mercator (EPSG:3857), every WGS 84 UTM zone (EPSG:326xx / 327xx) and
 *   NAD83 UTM zones 1–23 (EPSG:269xx) are built in and always available.
 * - Several hundred more, on the datums oil-and-gas records use, are in a table generated from the
 *   EPSG dataset (packages/core/src/crs-defs.json). The table is loaded on demand: a reader that
 *   will meet other CRSs (a backend's records) calls `ensureCrs` with the codes first, so the
 *   table never sits in a page that does not need it.
 * - A local or engineering CRS a tenant defines is added with `registerCrs(code, proj4)`.
 *
 * Datum shifts between a CRS and WGS 84 are Helmert transformations (`+towgs84`), as the EPSG
 * dataset or a published fallback gives them; grid-file shifts are not available in a browser.
 * `datumShiftOf` says which kind a CRS carries, and roughly how good it is, so the reader can be told.
 */
export interface CrsDefinition {
  readonly name: string;
  readonly kind: "projected" | "geographic";
  readonly unit: string;
  readonly proj4: string;
  /** "towgs84": a Helmert shift; "identity": the datum is WGS 84 or treated as it; "none": no shift is known, and positions converted to WGS 84 may be off by tens of metres. */
  readonly datumShift: "towgs84" | "identity" | "none";
  readonly shiftAccuracyM?: number;
  readonly shiftNote?: string;
  readonly bbox?: readonly number[];
}
const registered = new Map<string, CrsDefinition>();
let table: Readonly<Record<string, CrsDefinition>> | null = null;
let loading: Promise<void> | null = null;

/** Adds (or replaces) a CRS by code; the proj4 string must at least name a projection. */
export function registerCrs(code: string, proj4: string, options: Partial<Omit<CrsDefinition, "proj4">> = {}): void {
  if (!/^[A-Z][A-Z0-9_-]*:[A-Za-z0-9._-]+$/.test(code)) throw new TypeError(`A CRS code looks like "EPSG:23031" or "LOCAL:field-grid", not "${code}".`);
  if (!/\+proj=[a-z]+/.test(proj4)) throw new TypeError(`The definition of ${code} must be a proj4 string with +proj=.`);
  registered.set(code, { name: options.name ?? code, kind: options.kind ?? (/\+proj=longlat/.test(proj4) ? "geographic" : "projected"), unit: options.unit ?? "metre", proj4, datumShift: options.datumShift ?? (/\+towgs84=/.test(proj4) ? "towgs84" : /\+datum=WGS84/.test(proj4) ? "identity" : "none"), ...(options.shiftAccuracyM !== undefined ? { shiftAccuracyM: options.shiftAccuracyM } : {}), ...(options.shiftNote ? { shiftNote: options.shiftNote } : {}) });
}

/**
 * Makes the named CRSs usable, loading the EPSG table the first time one of them needs it. Codes
 * that are built in or registered cost nothing. Returns the codes that are still unknown, so the
 * caller can say so rather than fail later.
 */
export async function ensureCrs(codes: readonly string[]): Promise<readonly string[]> {
  const wanted = codes.filter((code) => !isBuiltIn(code) && !registered.has(code));
  if (!wanted.length) return [];
  if (!table) {
    loading ??= import("./crs-defs.json", { with: { type: "json" } }).then((module) => { table = (module.default as unknown as { entries: Record<string, CrsDefinition> }).entries; });
    await loading;
  }
  return wanted.filter((code) => !table![code]);
}

/** The definition of a CRS the reader can use now, or null. */
export function knownCrs(code: string): CrsDefinition | null {
  if (registered.has(code)) return registered.get(code)!;
  if (table?.[code]) return table[code]!;
  if (code === "EPSG:4326") return { name: "WGS 84", kind: "geographic", unit: "degree", proj4: "+proj=longlat +datum=WGS84 +no_defs", datumShift: "identity" };
  if (code === "EPSG:3857") return { name: "WGS 84 / Pseudo-Mercator", kind: "projected", unit: "metre", proj4: "+proj=merc +datum=WGS84", datumShift: "identity" };
  const nad83 = /^EPSG:269(\d{2})$/.exec(code), wgs = /^EPSG:(326|327)(\d{2})$/.exec(code);
  if (nad83 && Number(nad83[1]) >= 1 && Number(nad83[1]) <= 23) return { name: `NAD83 / UTM zone ${Number(nad83[1])}N`, kind: "projected", unit: "metre", proj4: builtInProjection(code)!, datumShift: "identity", shiftNote: "NAD83 taken as WGS 84, within about 2 m" };
  if (wgs && Number(wgs[2]) >= 1 && Number(wgs[2]) <= 60) return { name: `WGS 84 / UTM zone ${Number(wgs[2])}${wgs[1] === "327" ? "S" : "N"}`, kind: "projected", unit: "metre", proj4: builtInProjection(code)!, datumShift: "identity" };
  return null;
}

/** How a CRS's positions reach WGS 84, in words for the reader; null for a CRS that is not known. */
export function datumShiftOf(code: string): string | null {
  const crs = knownCrs(code);
  if (!crs) return null;
  if (crs.datumShift === "identity") return crs.shiftNote ?? "on the WGS 84 datum";
  if (crs.datumShift === "towgs84") return `datum shift approximated by a Helmert transformation${crs.shiftAccuracyM !== undefined ? `, about ${crs.shiftAccuracyM} m` : ""}${crs.shiftNote ? ` (${crs.shiftNote})` : ""}`;
  return "no datum shift to WGS 84 is known: positions may be off by tens of metres";
}

/**
 * The EPSG code in a reference as the standards write it:
 * - an OSDU reference-data id, "…:reference-data--CoordinateReferenceSystem:Projected:EPSG::23031:" (also "BoundProjected:EPSG::23031_1311:");
 * - an OGC URN, "urn:ogc:def:crs:EPSG::23031", or "urn:ogc:def:crs:EPSG:8.9:23031";
 * - "EPSG:23031" itself, or a bare "23031".
 * Null when none is found.
 */
export function crsFromReference(reference: string | null | undefined): string | null {
  if (!reference) return null;
  const osdu = /EPSG::(\d+)(?:_\d+)?:?$/.exec(reference) ?? /EPSG::(\d+)/.exec(reference);
  if (osdu) return `EPSG:${osdu[1]}`;
  const urn = /urn:ogc:def:crs:EPSG:(?:[\d.]*):(\d+)/i.exec(reference);
  if (urn) return `EPSG:${urn[1]}`;
  const plain = /^EPSG:(\d+)$/i.exec(reference.trim()) ?? /^(\d{4,6})$/.exec(reference.trim());
  return plain ? `EPSG:${plain[1]}` : null;
}

const isBuiltIn = (code: string) => code === "EPSG:4326" || code === "EPSG:3857" || /^EPSG:269(0[1-9]|1\d|2[0-3])$/.test(code) || /^EPSG:(326|327)(0[1-9]|[1-5]\d|60)$/.test(code);
function builtInProjection(crs: string): string | null {
  if (crs === "EPSG:4326" || crs === "EPSG:3857") return crs;
  // NAD83 / UTM zones 1N–23N (EPSG:26901–26923), North American records such as Utah FORGE.
  // EPSG's own proj definition: GRS80 with a null shift to WGS84, i.e. NAD83 is taken as WGS84 to
  // within the ~1–2 m the two realisations differ by. No grid-based datum shift is applied.
  const nad83 = /^EPSG:269(\d{2})$/.exec(crs);
  if (nad83) { const zone = Number(nad83[1]); return zone >= 1 && zone <= 23 ? `+proj=utm +zone=${zone} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs` : null; }
  const match = /^EPSG:(326|327)(\d{2})$/.exec(crs);
  const zone = match ? Number(match[2]) : 0;
  return match && zone >= 1 && zone <= 60 ? `+proj=utm +zone=${zone} ${match[1] === "327" ? "+south" : ""} +datum=WGS84 +units=m +no_defs` : null;
}
function projection(crs: string): string {
  const own = registered.get(crs)?.proj4 ?? table?.[crs]?.proj4 ?? builtInProjection(crs);
  if (own) return own;
  throw new TypeError(`Unsupported GIS CRS "${crs}". WGS84, Web Mercator and WGS84 or NAD83 UTM are built in; other EPSG codes need \`await ensureCrs(["${crs}"])\` first, and a local CRS \`registerCrs\`.`);
}

/**
 * Grid convergence at a point in a projected CRS: the angle from true north to grid north, positive
 * when grid north lies east of true north, in degrees. Found by projecting a short step along the
 * meridian, so it holds for any projection the CRS uses, not just a transverse Mercator. A survey
 * referenced to true north is turned onto the grid by it.
 */
export function gridConvergenceAtDeg(crs: string, longitude: number, latitude: number): number {
  const step = 1e-4;
  const here = reprojectGisXY([longitude, latitude], "EPSG:4326", crs), north = reprojectGisXY([longitude, Math.min(89.99, latitude + step)], "EPSG:4326", crs);
  // The meridian's heading on the grid is the bearing of true north; grid north is that much the other way.
  return -Math.atan2(north[0] - here[0], north[1] - here[1]) * 180 / Math.PI;
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
