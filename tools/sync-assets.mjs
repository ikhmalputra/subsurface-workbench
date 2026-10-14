// Copies the React package's Blender-rendered components, the map worker and basemap, and the
// FORGE source files into each app's public folder.
// The source of truth stays in packages/react/assets and packages/fixtures/data; every app gets
// a generated, git-ignored copy.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "packages/react/assets/well-components");
const worker = join(root, "packages/react/node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs");

for (const app of ["deck"]) {
  const appRoot = join(root, "apps", app);
  if (!existsSync(appRoot)) continue;

  const target = join(appRoot, "public/well-components");
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
  console.log(`Synced well components → ${target}`);

  // The MapLibre worker, the offline basemap, and the FORGE source files the views fetch.
  {
    const gisTarget = join(appRoot, "public/gis");
    // Cleared, not merged: a renamed engine file would otherwise linger and be served forever.
    rmSync(gisTarget, { recursive: true, force: true });
    mkdirSync(gisTarget, { recursive: true });
    cpSync(worker, join(gisTarget, "maplibre-gl-worker.mjs"));
    // The offline world basemap (Natural Earth land and borders), built by tools/build-world.mjs.
    cpSync(join(root, "packages/react/assets/gis"), gisTarget, { recursive: true });
    const dataTarget = join(appRoot, "public/data");
    rmSync(dataTarget, { recursive: true, force: true });
    cpSync(join(root, "packages/fixtures/data"), dataTarget, { recursive: true });
  }
}
