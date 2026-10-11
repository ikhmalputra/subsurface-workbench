// Copies the React package's Blender-rendered well components into each app's public folder.
// Both apps consume the same catalogue during the migration, so the source of truth stays
// packages/react/assets and every app gets a generated, git-ignored copy.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "packages/react/assets/well-components");
const worker = join(root, "packages/react/node_modules/maplibre-gl/dist/maplibre-gl-csp-worker.js");

for (const app of ["demo"]) {
  const appRoot = join(root, "apps", app);
  if (!existsSync(appRoot)) continue;

  const target = join(appRoot, "public/well-components");
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
  console.log(`Synced well components → ${target}`);

  // Only the demo mounts the MapLibre GIS views today; skip the worker where nothing imports it.
  if (app === "demo") {
    const gisTarget = join(appRoot, "public/gis");
    mkdirSync(gisTarget, { recursive: true });
    cpSync(worker, join(gisTarget, "maplibre-gl-csp-worker.js"));
  }
}
