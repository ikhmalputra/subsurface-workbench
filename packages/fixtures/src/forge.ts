import type { Source } from "@ikhmalputra/subsurface-kernel";
import data from "./forge-data.json" with { type: "json" };

/**
 * Utah FORGE 16A(78)-32, as the public record states it.
 *
 * One real well, cited to the document and page it came from, so every claim this toolkit makes can
 * be traced to something a reader can go and check. It is the fixture every layer is verified
 * against: the trajectory must reproduce these positions, the placement must land parts where this
 * survey puts them, and the views must draw what this record actually contains and nothing it does
 * not.
 *
 * It lives in its own package for two reasons. A library should not carry a well — importing a unit
 * conversion should not pull 127 KB of one operator's survey. And a fixture that ships separately
 * can be replaced by a host's own data without touching anything that computes.
 *
 * The data is CC BY 4.0 from the DOE Geothermal Data Repository and keeps its attribution. The
 * original code around it is MIT. The two licences are not the same and the fixture is not
 * relicensed.
 */

export const FORGE_SOURCE: Source = {
  document: "Utah FORGE 16A(78)-32 directional survey",
  at: "GDR submission 1283",
  url: data.trajectorySource,
  sha256: data.hashes?.surveyXlsx,
};

export const FORGE_REPORT: Source = {
  document: "Drilling Summary of the Utah FORGE Well 16A(78)-32",
  at: "GDR submission 1296",
  sha256: data.hashes?.drillingReportPdf,
};

export const FORGE_LICENCE = Object.freeze({
  licence: data.license,
  attribution: data.attribution,
  /** Which foot each number was written in. Both appear, and they differ by two parts per million. */
  units: data.sourceUnits,
  note: "CC BY 4.0 data. Not relicensed with the MIT code around it.",
});

/** What was measured at each station: depth along the hole, inclination, azimuth. */
export interface ForgeStation {
  readonly mdM: number;
  readonly inclinationDeg: number;
  readonly azimuthDeg: number;
}

/** What the source publishes as the position of each station, for checking a computation against. */
export interface ForgePublishedPosition extends ForgeStation {
  readonly tvdM: number;
  readonly northingM: number;
  readonly eastingM: number;
}

export const forgeStations: readonly ForgeStation[] = Object.freeze(
  data.survey.map(({ mdM, inclinationDeg, azimuthDeg }) => Object.freeze({ mdM, inclinationDeg, azimuthDeg })),
);

export const forgePublishedPath: readonly ForgePublishedPosition[] = Object.freeze(
  data.survey.map((station) => Object.freeze({
    mdM: station.mdM, inclinationDeg: station.inclinationDeg, azimuthDeg: station.azimuthDeg,
    tvdM: station.tvdM, northingM: station.northingM, eastingM: station.eastingM,
  })),
);

export const forgeWell = Object.freeze({
  id: data.id,
  trajectoryName: data.trajectoryName,
  totalDepthM: data.totalDepthM,
  depthDatum: data.depthDatum,
  /** Reported total depth exceeds survey coverage: the last interval was never surveyed, and is
   *  not extrapolated anywhere in this toolkit. */
  reportedTotalDepthFt: data.reportedTotalDepthFt,
  surveyCoverageFt: data.surveyCoverageFt,
  coverageNote: data.coverageNote,
});
