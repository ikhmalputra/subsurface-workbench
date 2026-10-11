import { validateSeismicVolumeHeader } from "./contracts.ts";
import { validateWellboreTrajectory, validateWellLogCurve } from "./columnar-contracts.ts";
import type { SubsurfaceSeismicVoxelCube, SubsurfaceWellboreTrajectory, SubsurfaceWellLogCurve } from "./columnar-contracts.ts";

const reference = { units: "m", crs: "local: east/north from wellhead", depthDatum: "surface" } as const;
function integer(value: number, min: number, max: number, field: string) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`${field} must be an integer in [${min},${max}].`);
}
function seedValue(seed: number) { integer(seed, 0, 0xffffffff, "Seed"); return seed; }
function hash(x: number, y: number, z: number, seed: number) {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ seed;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff * 2 - 1;
}
const smooth = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Seeded 3D smooth value noise, not a field-data or geophysical simulator. */
function noise(x: number, y: number, z: number, seed: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const tx = smooth(x - ix), ty = smooth(y - iy), tz = smooth(z - iz);
  const plane = (atZ: number) => mix(mix(hash(ix, iy, atZ, seed), hash(ix + 1, iy, atZ, seed), tx), mix(hash(ix, iy + 1, atZ, seed), hash(ix + 1, iy + 1, atZ, seed), tx), ty);
  return mix(plane(iz), plane(iz + 1), tz);
}

/** Generates bounded, deterministic x-fastest samples with tilted reflectors and a synthetic fault offset. */
export function createMockSeismicCube(options: { readonly dimensions?: readonly [number, number, number]; readonly seed?: number; readonly sampleType?: "float32" | "uint8" } = {}): SubsurfaceSeismicVoxelCube {
  const dimensions = options.dimensions ?? [32, 32, 32];
  const seed = seedValue(options.seed ?? 42);
  const header = validateSeismicVolumeHeader({
    version: 1, id: `mock-seismic-${seed}`, reference, dimensions,
    bounds: { xMin: -1000, xMax: 1000, yMin: -1000, yMax: 1000, zMin: 0, zMax: 3000 },
    sampleType: options.sampleType ?? "float32", byteOrder: "little-endian", layout: "x-fastest",
    amplitude: { scale: options.sampleType === "uint8" ? 2 / 255 : 1, offset: options.sampleType === "uint8" ? -1 : 0, unit: "synthetic relative amplitude" },
  });
  const [nx, ny, nz] = header.dimensions;
  const count = nx * ny * nz;
  if (count > 4_194_304) throw new RangeError("Sandbox cubes are limited to 4,194,304 voxels (16 MiB of samples).");
  const data = header.sampleType === "uint8" ? new Uint8Array(count) : new Float32Array(count);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const u = (x + 0.5) / nx, v = (y + 0.5) / ny, w = (z + 0.5) / nz;
    const fault = u > 0.5 + 0.12 * v ? 0.11 : 0;
    const amplitude = 0.75 * Math.sin((w + u * 0.1 + fault) * Math.PI * 24) + 0.25 * noise(u * 6, v * 6, w * 6, seed);
    data[(z * ny + y) * nx + x] = header.sampleType === "uint8" ? Math.round((amplitude + 1) * 255 / 2) : amplitude;
  }
  return { header, data };
}

export function createMockTrajectory(options: { readonly id?: string; readonly stations?: number; readonly totalDepthMdM?: number; readonly seed?: number } = {}): SubsurfaceWellboreTrajectory {
  const stations = options.stations ?? 128, total = options.totalDepthMdM ?? 2800, seed = seedValue(options.seed ?? 42);
  integer(stations, 2, 100_000, "Station count");
  if (!Number.isFinite(total) || total <= 0 || total > 100_000) throw new RangeError("Sandbox total MD must be in (0,100000] metres.");
  const xyz = new Float64Array(stations * 3), md = new Float64Array(stations);
  const inclinations = new Float32Array(stations), azimuths = new Float32Array(stations);
  const bearing = (seed % 360) * Math.PI / 180;
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < stations; i++) {
    const t = i / (stations - 1), inc = Math.max(0, t - 0.15) * 65 * Math.PI / 180;
    const az = bearing + Math.sin(t * Math.PI) * 0.3;
    const step = i === 0 ? 0 : total / (stations - 1);
    x += Math.sin(inc) * Math.sin(az) * step;
    y += Math.sin(inc) * Math.cos(az) * step;
    z += Math.cos(inc) * step;
    xyz.set([x, y, z], i * 3);
    md[i] = t * total;
    inclinations[i] = inc * 180 / Math.PI;
    // Float32 rounding must not turn a value just below 360 into the invalid endpoint.
    azimuths[i] = Math.fround((az * 180 / Math.PI + 360) % 360) % 360;
  }
  return validateWellboreTrajectory({ version: 1, id: options.id ?? `mock-well-${seed}`, reference, xyz, depthsMdM: md, inclinationsDeg: inclinations, azimuthsDeg: azimuths });
}

export function createMockLogCurve(trajectory: SubsurfaceWellboreTrajectory, options: { readonly seed?: number } = {}): SubsurfaceWellLogCurve {
  const path = validateWellboreTrajectory(trajectory), seed = seedValue(options.seed ?? 42);
  const values = Float32Array.from(path.depthsMdM, (md) => 0.16 + 0.07 * noise(md / 200, 0, 0, seed));
  return validateWellLogCurve({ version: 1, id: "porosity", wellId: path.id, unit: "v/v", depthsMdM: path.depthsMdM, values, nullValue: null });
}
