import type { SpatialXYZ } from "./state.ts";

const radius = 6378137;
const maxLatitude = 85.0511287798066;
function finite(values: readonly number[]) {
  if (!values.every(Number.isFinite)) throw new TypeError("CRS coordinates must be finite.");
}

/** EPSG:4326 longitude/latitude degrees to EPSG:3857 metres. Z is passed through, not transformed. */
export function geographicToWebMercator([longitude, latitude, z]: SpatialXYZ): SpatialXYZ {
  finite([longitude, latitude, z]);
  if (Math.abs(longitude) > 180 || Math.abs(latitude) > maxLatitude) throw new RangeError("Coordinates are outside Web Mercator's supported longitude/latitude range.");
  return [radius * longitude * Math.PI / 180, radius * Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360)), z];
}

export function webMercatorToGeographic([x, y, z]: SpatialXYZ): SpatialXYZ {
  finite([x, y, z]);
  if (Math.abs(x) > radius * Math.PI + 1e-8 || Math.abs(y) > radius * Math.PI + 1e-8) throw new RangeError("Coordinates are outside the Web Mercator world extent.");
  return [x / radius * 180 / Math.PI, (2 * Math.atan(Math.exp(y / radius)) - Math.PI / 2) * 180 / Math.PI, z];
}

/** Subtract a projected origin before Float32 GPU upload to preserve local precision. */
export function toLocalCoordinates(point: SpatialXYZ, origin: SpatialXYZ): SpatialXYZ {
  finite([...point, ...origin]);
  const result: SpatialXYZ = [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]];
  finite(result);
  return result;
}

export function fromLocalCoordinates(point: SpatialXYZ, origin: SpatialXYZ): SpatialXYZ {
  finite([...point, ...origin]);
  const result: SpatialXYZ = [point[0] + origin[0], point[1] + origin[1], point[2] + origin[2]];
  finite(result);
  return result;
}
