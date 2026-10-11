// Copies the React package's Blender-rendered well components into the demo's public folder.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "packages/react/assets/well-components");
const target = join(root, "apps/demo/public/well-components");
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`Synced well components → ${target}`);
const gisTarget = join(root, "apps/demo/public/gis");
mkdirSync(gisTarget, { recursive: true });
for (const file of ["maplibre-gl-csp-worker.js"]) {
  cpSync(join(root, "packages/react/node_modules/maplibre-gl/dist", file), join(gisTarget, file));
}
