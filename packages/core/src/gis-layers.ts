import { reprojectGisXY } from "./gis.ts";
import type { GeographicXY } from "./gis.ts";

export type GisGeometry =
  | { type: "Point"; coordinates: number[] }
  | { type: "MultiPoint" | "LineString"; coordinates: number[][] }
  | { type: "MultiLineString" | "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };
export interface GisFeature { type: "Feature"; id: string | number; geometry: GisGeometry; properties: Record<string, unknown> }
export interface GisVectorData { type: "FeatureCollection"; features: GisFeature[] }
export interface GisImportedLayer {
  readonly id: string; readonly label: string; readonly sourceCrs: string; readonly source: string;
  readonly visible: boolean; readonly opacity: number; readonly color: string;
  readonly bounds: readonly [GeographicXY, GeographicXY];
  readonly vector?: GisVectorData;
  readonly raster?: GisRasterData;
}
export interface GisRasterData {
  readonly width: number; readonly height: number; readonly rgba: Uint8ClampedArray;
  readonly corners: readonly [GeographicXY, GeographicXY, GeographicXY, GeographicXY];
  readonly values: Float64Array | null; readonly nodata: number | null;
  readonly sourceBounds: readonly [number, number, number, number];
  readonly displayBounds: readonly [number, number, number, number];
  readonly mode: "imagery" | "elevation" | "depth";
  readonly verticalDatum: string | null; readonly min: number | null; readonly max: number | null;
}
export interface GisWorkspaceState {
  readonly layers: readonly GisImportedLayer[];
  readonly tool: "identify" | "distance" | "area";
  readonly points: readonly GeographicXY[];
  readonly bathymetryLayerId: string | null;
  readonly measurementFinished: boolean;
}
export const emptyGisWorkspace: GisWorkspaceState = { layers: [], tool: "identify", points: [], bathymetryLayerId: null, measurementFinished: false };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected a GeoJSON object.");
  return value as Record<string, unknown>;
}

export function importGisGeoJson(input: unknown, sourceCrs: string): { vector: GisVectorData; bounds: GisImportedLayer["bounds"] } {
  const root = object(input);
  if (root.crs !== undefined) throw new TypeError("Legacy GeoJSON crs members are not supported. Remove it and select the source CRS explicitly.");
  const raw = root.type === "FeatureCollection" ? root.features : root.type === "Feature" ? [root] : [{ type: "Feature", geometry: root, properties: {} }];
  if (!Array.isArray(raw) || !raw.length || raw.length > 10000) throw new RangeError("GeoJSON must contain 1–10,000 features.");
  const points: GeographicXY[] = [];
  let count = 0;
  function position(value: unknown): number[] {
    if (!Array.isArray(value) || value.length !== 2 || !value.every((item) => typeof item === "number" && Number.isFinite(item))) throw new TypeError("Only finite two-dimensional XY coordinates are supported; Z requires an explicit vertical model.");
    if (++count > 200000) throw new RangeError("GeoJSON exceeds 200,000 vertices.");
    const xy = reprojectGisXY(value, sourceCrs, "EPSG:4326");
    points.push(xy); return [...xy];
  }
  function list(value: unknown): unknown[] { if (!Array.isArray(value)) throw new TypeError("Invalid geometry coordinate array."); return value; }
  function line(value: unknown): number[][] {
    const result = list(value).map(position);
    if (result.length < 2) throw new TypeError("Lines require at least two positions.");
    return result;
  }
  function ring(value: unknown): number[][] {
    const result = line(value), first = result[0]!, last = result.at(-1)!;
    if (result.length < 4 || first[0] !== last[0] || first[1] !== last[1]) throw new TypeError("Polygon rings must contain at least four positions and close explicitly.");
    return result;
  }
  function polygon(value: unknown): number[][][] {
    const result = list(value).map(ring);
    if (!result.length) throw new TypeError("Polygon requires an exterior ring.");
    return result;
  }
  function geometry(value: unknown): GisGeometry {
    const item = object(value), c = item.coordinates;
    switch (item.type) {
      case "Point": return { type: "Point", coordinates: position(c) };
      case "MultiPoint": { const coordinates = list(c).map(position); if (!coordinates.length) throw new TypeError("Empty MultiPoint."); return { type: "MultiPoint", coordinates }; }
      case "LineString": return { type: "LineString", coordinates: line(c) };
      case "MultiLineString": { const coordinates = list(c).map(line); if (!coordinates.length) throw new TypeError("Empty MultiLineString."); return { type: "MultiLineString", coordinates }; }
      case "Polygon": return { type: "Polygon", coordinates: polygon(c) };
      case "MultiPolygon": { const coordinates = list(c).map(polygon); if (!coordinates.length) throw new TypeError("Empty MultiPolygon."); return { type: "MultiPolygon", coordinates }; }
      default: throw new TypeError("Supported GeoJSON: Point, MultiPoint, LineString, MultiLineString, Polygon and MultiPolygon.");
    }
  }
  const ids = new Set<string>();
  const features: GisFeature[] = raw.map((value, index) => {
    const item = object(value);
    if (item.type !== "Feature") throw new TypeError("FeatureCollection contains a non-feature.");
    const id = item.id ?? index;
    if ((typeof id !== "number" && typeof id !== "string") || (typeof id === "number" && !Number.isFinite(id)) || ids.has(String(id))) throw new TypeError("Feature IDs must be unique strings or finite numbers.");
    ids.add(String(id));
    return { type: "Feature", id, geometry: geometry(item.geometry), properties: item.properties === null || item.properties === undefined ? {} : { ...object(item.properties) } };
  });
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) { minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]); maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]); }
  if (maxX - minX > 180) throw new RangeError("Antimeridian-spanning imports require splitting before import.");
  return { vector: { type: "FeatureCollection", features }, bounds: [[minX, minY], [maxX, maxY]] };
}

const earthRadiusM = 6371008.8;
export function gisDistanceM(points: readonly GeographicXY[]) {
  let distance = 0;
  for (let index = 1; index < points.length; index++) {
    const a = reprojectGisXY(points[index - 1]!, "EPSG:4326", "EPSG:4326"), b = reprojectGisXY(points[index]!, "EPSG:4326", "EPSG:4326");
    const rad = Math.PI / 180, dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
    distance += 2 * earthRadiusM * Math.asin(Math.sqrt(Math.min(1, h)));
  }
  return distance;
}
export function gisAreaM2(points: readonly GeographicXY[]) {
  if (points.length < 3) return 0;
  const checked = points.map((point) => reprojectGisXY(point, "EPSG:4326", "EPSG:4326"));
  let sum = 0;
  for (let index = 0; index < checked.length; index++) {
    const a = checked[index]!, b = checked[(index + 1) % checked.length]!;
    const delta = (b[0] - a[0]) * Math.PI / 180;
    if (Math.abs(delta) > Math.PI) throw new RangeError("Measurement across the antimeridian is not supported.");
    sum += delta * (2 + Math.sin(a[1] * Math.PI / 180) + Math.sin(b[1] * Math.PI / 180));
  }
  return Math.abs(sum) * earthRadiusM ** 2 / 2;
}

export async function importGisGeoTiff(buffer: ArrayBuffer, options: { sourceCrs: string; mode: GisRasterData["mode"]; verticalDatum?: string }) {
  if (buffer.byteLength > 64 * 1024 * 1024) throw new RangeError("GeoTIFF file limit is 64 MiB.");
  if (options.mode !== "imagery" && !options.verticalDatum?.trim()) throw new TypeError("Bathymetry requires its vertical datum and metre units to be stated.");
  const { fromArrayBuffer } = await import("geotiff");
  const tiff = await fromArrayBuffer(buffer);
  try {
    const image = await tiff.getImage();
    const directory = image.getFileDirectory();
    if (directory.getValue("ModelTransformation")) throw new TypeError("Matrix-georeferenced / rotated GeoTIFFs are not supported. Export a north-up pixel-scale / tiepoint grid first.");
    const keys = image.getGeoKeys();
    const declared: unknown = keys?.ProjectedCSTypeGeoKey ?? keys?.GeographicTypeGeoKey;
    if (typeof declared !== "number" || `EPSG:${declared}` !== options.sourceCrs) throw new TypeError("Selected source CRS must match the GeoTIFF's explicit EPSG geokey.");
    if (options.mode !== "imagery" && keys?.VerticalUnitsGeoKey !== undefined && keys.VerticalUnitsGeoKey !== 9001) throw new TypeError("Bathymetry must use metre vertical units.");
    const resolution = image.getResolution();
    if (resolution[0]! <= 0 || resolution[1]! >= 0) throw new TypeError("GeoTIFF requires a north-up grid with positive X and negative Y resolution.");
    const sourceWidth = image.getWidth(), sourceHeight = image.getHeight();
    if (sourceWidth * sourceHeight > 100000000) throw new RangeError("GeoTIFF exceeds 100 million source pixels.");
    const tiepoint = directory.getValue("ModelTiepoint");
    if (!tiepoint || tiepoint.length !== 6 || !Array.from(tiepoint).every(Number.isFinite)) throw new TypeError("GeoTIFF requires one finite pixel / model tiepoint.");
    const rasterType = keys?.GTRasterTypeGeoKey ?? 1;
    if (rasterType !== 1 && rasterType !== 2) throw new TypeError("Unsupported GeoTIFF pixel area / point convention.");
    const offset = rasterType === 2 ? 0.5 : 0;
    const originX = tiepoint[3]! - (tiepoint[0]! + offset) * resolution[0]!, originY = tiepoint[4]! - (tiepoint[1]! + offset) * resolution[1]!;
    const bbox = [originX, originY + sourceHeight * resolution[1]!, originX + sourceWidth * resolution[0]!, originY];
    if (bbox.length !== 4 || !bbox.every(Number.isFinite) || bbox[2]! <= bbox[0]! || bbox[3]! <= bbox[1]!) throw new TypeError("GeoTIFF requires a valid north-up georeferenced extent.");
    const sourceBounds: GisRasterData["sourceBounds"] = [bbox[0]!, bbox[1]!, bbox[2]!, bbox[3]!];
    const edgePoints: GeographicXY[] = [];
    for (let i = 0; i <= 64; i++) {
      const x = bbox[0]! + (bbox[2]! - bbox[0]!) * i / 64, y = bbox[1]! + (bbox[3]! - bbox[1]!) * i / 64;
      for (const xy of [[x, bbox[1]!], [x, bbox[3]!], [bbox[0]!, y], [bbox[2]!, y]]) edgePoints.push(reprojectGisXY(xy, options.sourceCrs, "EPSG:4326"));
    }
    if (Math.max(...edgePoints.map((point) => point[0])) - Math.min(...edgePoints.map((point) => point[0])) > 180) throw new RangeError("Antimeridian rasters must be split before import.");
    const projected = edgePoints.map((xy) => reprojectGisXY(xy, "EPSG:4326", "EPSG:3857"));
    const displayBounds: GisRasterData["displayBounds"] = [Math.min(...projected.map((xy) => xy[0])), Math.min(...projected.map((xy) => xy[1])), Math.max(...projected.map((xy) => xy[0])), Math.max(...projected.map((xy) => xy[1]))];
    const corners: GisRasterData["corners"] = [
      reprojectGisXY([displayBounds[0], displayBounds[3]], "EPSG:3857", "EPSG:4326"), reprojectGisXY([displayBounds[2], displayBounds[3]], "EPSG:3857", "EPSG:4326"),
      reprojectGisXY([displayBounds[2], displayBounds[1]], "EPSG:3857", "EPSG:4326"), reprojectGisXY([displayBounds[0], displayBounds[1]], "EPSG:3857", "EPSG:4326"),
    ];
    const ratio = Math.min(1, 512 / Math.max(sourceWidth, sourceHeight)), width = Math.max(1, Math.round(sourceWidth * ratio)), height = Math.max(1, Math.round(sourceHeight * ratio));
    const count = image.getSamplesPerPixel(), rgb = options.mode === "imagery" && count >= 3;
    if (options.mode !== "imagery" && count !== 1) throw new TypeError("Numeric bathymetry requires one sample band.");
    const photometric = directory.getValue("PhotometricInterpretation");
    if (options.mode === "imagery" && (rgb ? photometric !== 2 || count !== 3 : photometric !== 1 || count !== 1)) throw new TypeError("Imagery supports RGB (three bands) or black-is-zero grayscale (one band); convert palette, alpha and other photometric formats before import.");
    const data = await image.readRasters({ width, height, samples: rgb ? [0, 1, 2] : [0], interleave: true, resampleMethod: "nearest" });
    const nodata = image.getGDALNoData(), values = rgb ? null : new Float64Array(width * height);
    let min = Infinity, max = -Infinity;
    for (let index = 0; index < width * height; index++) {
      const value = Number(data[index * (rgb ? 3 : 1)]);
      if (values) values[index] = !Number.isFinite(value) || value === nodata ? NaN : value;
      if (values && Number.isFinite(values[index])) { min = Math.min(min, value); max = Math.max(max, value); }
    }
    if (values && !Number.isFinite(min)) throw new TypeError("GeoTIFF has no valid samples.");
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index++) {
      if (values) {
        const value = values[index]!;
        const t = max === min ? 0.5 : (value - min) / (max - min);
        rgba.set(options.mode === "imagery" ? [t * 255, t * 255, t * 255, Number.isFinite(value) ? 255 : 0] : [20 + t * 120, 80 + t * 120, 160 + t * 70, Number.isFinite(value) ? 255 : 0], index * 4);
      } else {
        const samples = [Number(data[index * 3]), Number(data[index * 3 + 1]), Number(data[index * 3 + 2])];
        if (samples.some((value) => !Number.isFinite(value) || value < 0 || value > 255)) throw new TypeError("RGB imagery supports only 0–255 samples.");
        rgba.set([...samples, samples.every((value) => value === nodata) ? 0 : 255], index * 4);
      }
    }
    // Inverse-warp to a uniform Mercator grid; corner stretching is incorrect for UTM and geographic rasters.
    const warpedRgba = new Uint8ClampedArray(rgba.length), warpedValues = values ? new Float64Array(values.length).fill(NaN) : null;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const xy = reprojectGisXY([displayBounds[0] + (x + 0.5) / width * (displayBounds[2] - displayBounds[0]), displayBounds[3] - (y + 0.5) / height * (displayBounds[3] - displayBounds[1])], "EPSG:3857", options.sourceCrs);
      const sx = Math.floor((xy[0] - sourceBounds[0]) / (sourceBounds[2] - sourceBounds[0]) * width), sy = Math.floor((sourceBounds[3] - xy[1]) / (sourceBounds[3] - sourceBounds[1]) * height);
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
      const from = sy * width + sx, to = y * width + x;
      warpedRgba.set(rgba.subarray(from * 4, from * 4 + 4), to * 4);
      if (warpedValues && values) warpedValues[to] = values[from]!;
    }
    return { raster: { width, height, rgba: warpedRgba, corners, values: warpedValues, nodata, sourceBounds, displayBounds, mode: options.mode, verticalDatum: options.mode === "imagery" ? null : options.verticalDatum!.trim(), min: values ? min : null, max: values ? max : null } satisfies GisRasterData,
      bounds: [[Math.min(...corners.map((point) => point[0])), Math.min(...corners.map((point) => point[1]))], [Math.max(...corners.map((point) => point[0])), Math.max(...corners.map((point) => point[1]))]] as GisImportedLayer["bounds"] };
  } finally { await tiff.close(); }
}
