// A directional survey through minimum curvature. Core only: no DOM, no React, so the same file
// runs in Node, a worker or a server route. In Node, call main() and it prints to the console.
import { computeMinimumCurvature, summarizeTrajectory } from "@ikhmalputra/subsurface-core/trajectory";

export function main(print: (line: string) => void = console.log) {
  // MD in metres, inclination from vertical, azimuth clockwise from grid north.
  const survey = computeMinimumCurvature([
    { mdM: 0, inclinationDeg: 0, azimuthDeg: 0 },
    { mdM: 500, inclinationDeg: 0, azimuthDeg: 0 },
    { mdM: 800, inclinationDeg: 18, azimuthDeg: 45 },
    { mdM: 1400, inclinationDeg: 32, azimuthDeg: 52 },
    { mdM: 2000, inclinationDeg: 32, azimuthDeg: 52 },
  ]);

  const column = (value: number, width: number) => value.toFixed(1).padStart(width);
  for (const s of survey) {
    print(`${s.mdM.toFixed(0).padStart(5)} m MD   TVD ${column(s.tvdM, 7)}   N ${column(s.northingM, 6)}`
      + `   E ${column(s.eastingM, 6)}   DLS ${s.dlsDegPer30m.toFixed(2)}°/30 m`);
  }

  const summary = summarizeTrajectory(survey, { verticalSectionAzimuthDeg: 45 });
  print(`TD ${summary.totalDepthTvdM.toFixed(1)} m TVD · closure ${summary.closureDistanceM.toFixed(1)} m`
    + ` at ${summary.closureAzimuthDeg.toFixed(1)}° · max DLS ${summary.maxDlsDegPer30m.toFixed(2)}°/30 m`);
}
