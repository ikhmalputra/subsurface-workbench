import type { CanonicalMarker, DepthDatum, Provenance, WellBundle } from "@ikhmalputra/subsurface-core/data-contract";
import { busId } from "../force-model.ts";
import type { ForceWell } from "../force-model.ts";
import type { RecordEntry, WellRecordValue } from "../records.ts";

/**
 * Converters from the deck's own records to the data contract. They are pure, with no imports back
 * into the stores that call them, so the stores and the tests can use them directly. FORGE, Equator
 * and the designs convert in the React package (`forgeBundles`, `equatorBundles`, `designBundle`),
 * beside the sites built from them; they are re-exported here.
 *
 * The bundled samples, served through the data contract like any tenant's backend:
 * - FORGE's 16A(78)-32 and its two surveyed neighbours (documented);
 * - the Equator field (synthetic);
 * - the FORCE 2020 North Sea wells (documented);
 * - Kestrel A-7, the example design (synthetic).
 * Every converter here is a pure function of a record, so the deck can also use them
 * synchronously, and the tests can hold each one to the site it used to build.
 *
 * The user's own wells (entered, imported, designed) are a second source, "This browser", built
 * from the same converters.
 */

export { designBundle, equatorBundles, forgeBundles } from "@ikhmalputra/subsurface-react";

/** The FORCE 2020 index gives positions in ED50 / UTM 31N, and longitude and latitude already shifted to WGS84. */
const FORCE_CRS = "EPSG:23031";

/**
 * A FORCE 2020 well. The index gives each path as MD, east, north and TVDSS from the top of the
 * logs, in ED50 / UTM 31N grid; the rig floor's height comes from MD − TVDSS where the hole is
 * vertical. The Directorate's group and formation tops become markers.
 */
export function forceBundle(well: ForceWell, areaLabel: string): WellBundle {
  const provenance: Provenance = { kind: "documented", source: "FORCE 2020 (Zenodo 4351156), the Norwegian Offshore Directorate's logs and tops", licence: "CC BY 4.0; NLOD 2.0" };
  const elevation = well.datumElevationM;
  const datum: DepthDatum = elevation === null ? { reference: "MSL", elevationM: 0, description: "Rig floor height not derivable: depths kept below sea level" }
    : { reference: "RKB", elevationM: elevation, description: `Rig floor ${elevation.toFixed(1)} m above sea level, derived from MD − TVDSS where the hole is vertical (${well.datumFrom})` };
  const below = elevation ?? 0;
  const id = busId(well);
  const markers = [...well.groups.map((top) => ({ top, kind: "group" as const })), ...well.formations.map((top) => ({ top, kind: "formation" as const }))]
    .map(({ top, kind }, i): CanonicalMarker => ({ id: `${id}-${kind}-${i}`, name: top.name, mdM: top.md, ...(top.tvdss === null ? {} : { tvdM: top.tvdss + below }), kind }));
  return {
    well: { id, name: well.name, field: { id: well.area, name: areaLabel }, country: "Norway",
      location: well.lonLat ? { longitude: well.lonLat[0], latitude: well.lonLat[1], ...(well.utm ? { projected: { crs: FORCE_CRS, easting: well.utm[0], northing: well.utm[1] } } : {}) } : null,
      environment: "offshore", waterDepthM: null, groundElevationM: null, provenance },
    wellbores: [{
      // The index gives the logs' base, not the well's total depth (the Directorate's tops run deeper): TD is left unstated.
      wellbore: { id, wellId: id, name: well.name, status: "drilled", datum, totalDepthMdM: null, provenance },
      trajectories: well.survey.length >= 2 ? [{ id: `${id}-path`, wellboreId: id, name: "Path from the logs' index", kind: "definitive", azimuthReference: "grid",
        stations: well.survey.map(([md, e, n, tvdss]) => ({ mdM: md, tvdM: tvdss + below, northM: n, eastM: e })), provenance }] : [],
      markerSets: markers.length ? [{ id: `${id}-tops`, wellboreId: id, name: "Directorate tops", markers, provenance }] : [],
    }],
  };
}

/**
 * A drilled well entered on the deck. The stations are as typed; with a total depth below the last
 * one, the path is carried on to TD along the last station's direction, the usual practice.
 */
export function recordBundle(entry: Pick<RecordEntry, "siteId" | "wellId">, value: WellRecordValue): WellBundle {
  const provenance: Provenance = { kind: "user-authored", source: value.surveySource || "Entered on the deck" };
  const name = value.identity.name || "Unnamed well";
  const last = value.stations.at(-1);
  const stations = last && value.totalDepthM > last.mdM + 0.5 ? [...value.stations, { ...last, mdM: value.totalDepthM }] : value.stations;
  const { latitude, longitude, environment, waterDepthM, groundElevationM } = value.location;
  return {
    well: { id: entry.wellId, name, field: { id: entry.siteId, name: value.identity.field || name }, ...(value.identity.operator ? { operator: value.identity.operator } : {}), ...(value.identity.country ? { country: value.identity.country } : {}), ...(value.identity.uwi ? { uwi: value.identity.uwi } : {}),
      location: latitude === null || longitude === null ? null : { longitude, latitude }, environment: environment === "onshore" ? "onshore" : "offshore", waterDepthM, groundElevationM, provenance },
    wellbores: [{
      wellbore: { id: entry.wellId, wellId: entry.wellId, name, status: "drilled", datum: { reference: value.datum.reference, elevationM: value.datum.elevationMslM }, totalDepthMdM: value.totalDepthM > 0 ? value.totalDepthM : null, provenance },
      trajectories: stations.length >= 2 ? [{ id: `${entry.wellId}-survey`, wellboreId: entry.wellId, name: "Entered survey", kind: "definitive", azimuthReference: "unknown",
        stations: stations.map((station) => ({ mdM: station.mdM, inclinationDeg: station.inclinationDeg, azimuthDeg: station.azimuthDeg })), provenance }] : [],
      markerSets: value.tops.length ? [{ id: `${entry.wellId}-tops`, wellboreId: entry.wellId, name: "Entered tops", provenance,
        markers: value.tops.map((top) => ({ id: top.id, name: top.name, mdM: top.topMdM, kind: "formation" as const, ...(top.lithology ? { lithology: top.lithology } : {}) })) }] : [],
    }],
  };
}

