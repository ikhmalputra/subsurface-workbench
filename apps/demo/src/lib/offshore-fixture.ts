import { createMockTrajectory } from "@ikhmalputra/subsurface-core/sandbox";
import { prepareGisDocument, reprojectGisXY } from "@ikhmalputra/subsurface-core/gis";
import type { SubsurfaceWellboreTrajectory } from "@ikhmalputra/subsurface-core/contracts";

export function makeOffshoreFixture() {
  // An assumed location in open water in the Makassar Strait, inside UTM zone 50N. It used to sit
  // inland on Borneo, which a basemap made plain; the field is synthetic either way.
  const origin = reprojectGisXY([118.7, 0.4], "EPSG:4326", "EPSG:32650");
  const offsets = [[-1800, -1000], [1200, 800], [-1000, 1800], [2400, -1600]] as const;
  const waterDepthsM: Record<string, number> = {};
  const surveys: Record<string, SubsurfaceWellboreTrajectory> = {};
  const wells = offsets.map(([east, north], index) => {
    const id = `offshore-${index + 1}`;
    const path = createMockTrajectory({ id, stations: 301, totalDepthMdM: 2400 + index * 250, seed: 75 + index * 67 });
    surveys[id] = path;
    waterDepthsM[id] = 800 + index * 180;
    return {
      id, label: `Equator ${String.fromCharCode(65 + index)}`, crs: "EPSG:32650",
      depthDatum: "synthetic seabed wellhead", source: "Generated offshore trajectory; assumed WGS84 UTM 50N location", provenance: "synthetic" as const,
      xyz: Float64Array.from(path.xyz, (value, at) => at % 3 === 0 ? value + origin[0] + east : at % 3 === 1 ? value + origin[1] + north : value),
      depthsMdM: Float64Array.from(path.depthsMdM),
    };
  });
  const model = prepareGisDocument({ version: 1, id: "synthetic-equator-offshore", wells, layers: [] });
  return { model, origin, waterDepthsM, surveys };
}
