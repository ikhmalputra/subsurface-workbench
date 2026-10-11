import * as THREE from "three";
import type { MercatorCoordinate } from "maplibre-gl";
import { reprojectGisXY } from "@ikhmalputra/subsurface-core/gis";
import type { GisRasterData } from "@ikhmalputra/subsurface-core/gis";

export function makeGisBathymetry(raster: GisRasterData, Mercator: typeof MercatorCoordinate, origin: MercatorCoordinate, scale: number) {
  if (!raster.values || raster.mode === "imagery" || !raster.verticalDatum) throw new TypeError("3D bathymetry requires numeric metre samples and a confirmed sea-surface datum.");
  const columns = Math.min(raster.width, 96), rows = Math.min(raster.height, 96);
  if (columns < 2 || rows < 2) throw new TypeError("3D bathymetry requires at least two rows and columns.");
  const vertices: number[] = [], colors: number[] = [], valid: boolean[] = [], indices: number[] = [];
  const b = raster.displayBounds;
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const sx = Math.round(x / (columns - 1) * (raster.width - 1)), sy = Math.round(y / (rows - 1) * (raster.height - 1));
    const index = sy * raster.width + sx, value = raster.values[index]!;
    valid.push(Number.isFinite(value));
    const xy = reprojectGisXY([b[0] + (sx + 0.5) / raster.width * (b[2] - b[0]), b[3] - (sy + 0.5) / raster.height * (b[3] - b[1])], "EPSG:3857", "EPSG:4326");
    const point = Mercator.fromLngLat([...xy], Number.isFinite(value) ? raster.mode === "depth" ? -value : value : 0);
    vertices.push((point.x - origin.x) / scale, (point.y - origin.y) / scale, (point.z - origin.z) / scale);
    const color = new THREE.Color().setRGB(raster.rgba[index * 4]! / 255, raster.rgba[index * 4 + 1]! / 255, raster.rgba[index * 4 + 2]! / 255, THREE.SRGBColorSpace);
    colors.push(color.r, color.g, color.b);
  }
  for (let y = 0; y < rows - 1; y++) for (let x = 0; x < columns - 1; x++) {
    const a = y * columns + x, b = a + 1, c = a + columns, d = c + 1;
    if (valid[a] && valid[b] && valid[c]) indices.push(a, c, b);
    if (valid[b] && valid[c] && valid[d]) indices.push(b, c, d);
  }
  if (!indices.length) throw new TypeError("Bathymetry contains no complete valid mesh triangles.");
  const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3)).setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.8, roughness: 0.9, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  const bounds = new THREE.Box3().setFromObject(mesh);
  return { mesh, bounds, triangles: indices.length / 3, dispose() { geometry.dispose(); material.dispose(); } };
}
