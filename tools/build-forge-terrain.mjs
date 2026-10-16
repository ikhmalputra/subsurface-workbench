// Builds the ground the FORGE scenes stand on: USGS 3DEP elevation and USDA NAIP aerial imagery over
// the PSDM volume and the wells, both public domain (US federal), fetched from The National Map's
// image services in NAD83 / UTM 12N, the FORGE site's own grid.
//
//   node tools/build-forge-terrain.mjs
//
// Writes packages/fixtures/data/forge-terrain.json (extent, grid size, provenance), forge-terrain.i16
// (elevation in decimetres above sea level, rows north to south) and forge-terrain.jpg (the imagery).
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { fromArrayBuffer } = createRequire(join(root, "packages/core/package.json"))("geotiff");

// The PSDM volume's outline around 16A's planned wellhead, padded by 300 m, rounded to 10 m.
const bbox = [333420, 4261920, 337040, 4264680];
const cols = 362, rows = 276; // 10 m cells
const query = `bbox=${bbox.join(",")}&bboxSR=26912&imageSR=26912&size=${cols},${rows}`;
const dem = `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?${query}&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image`;
const naip = `https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?bbox=${bbox.join(",")}&bboxSR=26912&imageSR=26912&size=${cols * 4},${rows * 4}&format=jpg&compressionQuality=82&f=image`;

const get = async (url) => { const response = await fetch(url); if (!response.ok) throw new Error(`${response.status} ${url}`); return new Uint8Array(await response.arrayBuffer()); };
const demBytes = await get(dem);
const tiff = await fromArrayBuffer(demBytes.buffer.slice(demBytes.byteOffset, demBytes.byteOffset + demBytes.byteLength));
const image = await tiff.getImage();
const [raster] = await image.readRasters();
if (image.getWidth() !== cols || image.getHeight() !== rows) throw new Error(`DEM came back ${image.getWidth()} × ${image.getHeight()}`);
const decimetres = Int16Array.from(raster, (metres) => Number.isFinite(metres) && metres > -1000 && metres < 3276 ? Math.round(metres * 10) : -32768);
const imagery = await get(naip);
if (imagery.length < 20_000) throw new Error(`The imagery came back too small (${imagery.length} bytes): the service may have returned an empty tile.`);

const out = join(root, "packages/fixtures/data");
writeFileSync(join(out, "forge-terrain.i16"), Buffer.from(decimetres.buffer));
writeFileSync(join(out, "forge-terrain.jpg"), imagery);
const valid = Array.from(decimetres).filter((value) => value !== -32768);
writeFileSync(join(out, "forge-terrain.json"), JSON.stringify({
  crs: "NAD83 / UTM zone 12N (EPSG:26912)",
  bbox, cols, rows, cellM: (bbox[2] - bbox[0]) / cols,
  elevation: { file: "forge-terrain.i16", unit: "decimetres above sea level, rows north to south", source: "USGS 3D Elevation Program (3DEP), The National Map, public domain", url: dem, sha256: createHash("sha256").update(demBytes).digest("hex"), minM: Math.min(...valid) / 10, maxM: Math.max(...valid) / 10 },
  imagery: { file: "forge-terrain.jpg", source: "USDA Farm Service Agency National Agriculture Imagery Program (NAIP), via The National Map, public domain", url: naip, sha256: createHash("sha256").update(imagery).digest("hex") },
  retrieved: new Date().toISOString().slice(0, 10),
}));
console.log(`FORGE terrain: ${cols} × ${rows} at ${((bbox[2] - bbox[0]) / cols).toFixed(1)} m, ${Math.min(...valid) / 10}–${Math.max(...valid) / 10} m ASL; imagery ${(imagery.length / 1024).toFixed(0)} KB`);
