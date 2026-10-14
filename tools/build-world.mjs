// Builds the offline world basemap the map views draw: land and country borders from Natural Earth
// 1:50m (public domain), as packaged by world-atlas 2.0.2 (ISC). One same-origin GeoJSON file, so the
// map needs no tile server and no third-party request. Coordinates are rounded to 0.001° (≈100 m),
// well below what a 1:50m outline resolves.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { feature, mesh } from "topojson-client";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const read = (name) => JSON.parse(readFileSync(require.resolve(`world-atlas/${name}`), "utf8"));
const land = read("land-50m.json");
const countries = read("countries-50m.json");
const round = (value) => Math.round(value * 1000) / 1000;
const roundDeep = (coordinates) => typeof coordinates[0] === "number" ? coordinates.map(round) : coordinates.map(roundDeep);
const landFeature = feature(land, land.objects.land);
const borders = mesh(countries, countries.objects.countries, (a, b) => a !== b);
const out = {
  type: "FeatureCollection",
  attribution: "Natural Earth 1:50m (public domain) via world-atlas 2.0.2",
  features: [
    ...landFeature.features.map((item) => ({ type: "Feature", properties: { kind: "land" }, geometry: { type: item.geometry.type, coordinates: roundDeep(item.geometry.coordinates) } })),
    { type: "Feature", properties: { kind: "border" }, geometry: { type: borders.type, coordinates: roundDeep(borders.coordinates) } },
  ],
};
const target = join(root, "packages/react/assets/gis/world-50m.json");
writeFileSync(target, JSON.stringify(out));
console.log(`World basemap → ${target} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
