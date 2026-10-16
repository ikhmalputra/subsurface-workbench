import { useMemo } from "react";
import { forgeSeismicSection } from "@ikhmalputra/subsurface-core";
import type { SiteSceneSurface, SiteTerrain } from "@ikhmalputra/subsurface-react/3d";
import { BASE } from "../base.ts";
import { useFetched } from "./fetch.ts";

/**
 * The ground at Utah FORGE: USGS 3DEP elevation draped with USDA NAIP aerial imagery (both public
 * domain), built by tools/build-forge-terrain.mjs, in the FORGE site's frame: east and north from
 * 16A's planned wellhead, depth below 16A's rig floor.
 */
interface TerrainMeta { readonly bbox: readonly [number, number, number, number]; readonly cols: number; readonly rows: number }
const json = (buffer: ArrayBuffer) => JSON.parse(new TextDecoder().decode(buffer)) as TerrainMeta;
const heights = (buffer: ArrayBuffer) => new Int16Array(buffer);

export function useForgeTerrain(enabled: boolean): SiteTerrain | null {
  const meta = useFetched(enabled ? `${BASE}data/forge-terrain.json` : null, json).value;
  const grid = useFetched(enabled ? `${BASE}data/forge-terrain.i16` : null, heights).value;
  return useMemo(() => {
    if (!meta || !grid || grid.length !== meta.cols * meta.rows) return null;
    const { eastingM, northingM } = forgeSeismicSection.wellhead, rkb = forgeSeismicSection.rkbElevationM;
    return {
      east: [meta.bbox[0] - eastingM, meta.bbox[2] - eastingM], north: [meta.bbox[1] - northingM, meta.bbox[3] - northingM],
      cols: meta.cols, rows: meta.rows,
      depthsM: Float32Array.from(grid, (dm) => dm === -32768 ? NaN : rkb - dm / 10),
      imageUrl: `${BASE}data/forge-terrain.jpg`, label: "Ground · USGS 3DEP and NAIP imagery",
    };
  }, [meta, grid]);
}

/** With the real ground drawn, the flat ground level would cut through it. */
export const withoutFlatGround = (surfaces: readonly SiteSceneSurface[], terrain: SiteTerrain | null) => terrain ? surfaces.filter((surface) => surface.id !== "ground") : surfaces;
