import assert from "node:assert/strict";
import test from "node:test";
import { forgeDesign, positionAtMeasuredDepth } from "./index.ts";
import { computeMinimumCurvature, designWithTrajectory, doglegAngleDeg, interpolateSurveyPoint, planBuildHold, summarizeTrajectory, surveyConsistency, validateSurveyStations } from "./trajectory.ts";

const close = (actual: number, expected: number, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} ± ${tolerance}`);

test("minimum curvature reproduces the published Utah FORGE 16A(78)-32 coordinates", () => {
  const check = surveyConsistency(forgeDesign.survey!);
  assert.ok(check.maxDeviationM < 0.005, `max deviation ${check.maxDeviationM} m`);
  const recomputed = computeMinimumCurvature(forgeDesign.survey!);
  const last = recomputed.at(-1)!;
  close(last.tvdM, forgeDesign.survey!.at(-1)!.tvdM, 0.005);
  const summary = summarizeTrajectory(recomputed);
  close(summary.closureDistanceM, Math.hypot(last.northingM, last.eastingM));
  assert.ok(summary.maxInclinationDeg > 60 && summary.maxDlsDegPer30m > 0);
});

test("a quarter-circle build lands exactly at radius R horizontally and vertically", () => {
  const radius = 30 * 180 / Math.PI / 3;
  const length = radius * Math.PI / 2;
  const [, end] = computeMinimumCurvature([{ mdM: 0, inclinationDeg: 0, azimuthDeg: 45 }, { mdM: length, inclinationDeg: 90, azimuthDeg: 45 }]);
  close(end!.tvdM, radius);
  close(Math.hypot(end!.northingM, end!.eastingM), radius);
  close(end!.northingM, end!.eastingM);
  close(end!.dlsDegPer30m, 3);
  close(end!.buildRateDegPer30m, 3);
  close(end!.closureAzimuthDeg, 45);
});

test("straight slant courses use a unit ratio factor", () => {
  const [, end] = computeMinimumCurvature([{ mdM: 0, inclinationDeg: 30, azimuthDeg: 90 }, { mdM: 1000, inclinationDeg: 30, azimuthDeg: 90 }]);
  close(end!.tvdM, 1000 * Math.cos(Math.PI / 6));
  close(end!.eastingM, 500);
  close(end!.northingM, 0);
  close(end!.doglegDeg, 0);
});

test("dogleg and turn rate use the short way round north", () => {
  close(doglegAngleDeg({ inclinationDeg: 90, azimuthDeg: 350 }, { inclinationDeg: 90, azimuthDeg: 10 }), 20);
  const [, end] = computeMinimumCurvature([{ mdM: 0, inclinationDeg: 90, azimuthDeg: 350 }, { mdM: 300, inclinationDeg: 90, azimuthDeg: 10 }]);
  close(end!.turnRateDegPer30m, 2);
  const middle = interpolateSurveyPoint({ ...end!, mdM: 0, tvdM: 0, northingM: 0, eastingM: 0, azimuthDeg: 350 }, end!, 150);
  close(middle.azimuthDeg, 0, 1e-6);
  close(middle.inclinationDeg, 90);
});

test("interpolation stays on the minimum-curvature arc", () => {
  const radius = 30 * 180 / Math.PI / 3;
  const stations = computeMinimumCurvature([{ mdM: 0, inclinationDeg: 0, azimuthDeg: 0 }, { mdM: radius * Math.PI / 2, inclinationDeg: 90, azimuthDeg: 0 }]);
  const half = interpolateSurveyPoint(stations[0]!, stations[1]!, radius * Math.PI / 4);
  close(half.inclinationDeg, 45);
  close(half.tvdM, radius * Math.sin(Math.PI / 4));
  close(half.northingM, radius * (1 - Math.cos(Math.PI / 4)));
  const design = { ...forgeDesign, totalDepthM: stations[1]!.mdM, survey: stations };
  close(positionAtMeasuredDepth(design, radius * Math.PI / 4).tvdM, half.tvdM);
});

test("build-and-hold planner passes exactly through the target", () => {
  const target = { tvdM: 2200, northingM: -400, eastingM: 900 };
  const plan = planBuildHold({ kickoffMdM: 600, buildRateDegPer30m: 2.5, target, extensionM: 120 });
  const computed = computeMinimumCurvature(plan.stations);
  const atTarget = computed.find((station) => Math.abs(station.mdM - plan.targetMdM) < 1e-6)!;
  close(atTarget.tvdM, target.tvdM, 1e-6);
  close(atTarget.northingM, target.northingM, 1e-6);
  close(atTarget.eastingM, target.eastingM, 1e-6);
  close(computed.at(-1)!.mdM, plan.targetMdM + 120);
  close(Math.max(...computed.map((station) => station.dlsDegPer30m)), 2.5, 1e-6);
  close(plan.endOfBuildMdM - 600, plan.holdInclinationDeg / 2.5 * 30);
  const summary = summarizeTrajectory(computed);
  assert.equal(summary.kickoffMdM, 600);
});

test("planner rejects geometrically impossible targets", () => {
  assert.throws(() => planBuildHold({ kickoffMdM: 1000, buildRateDegPer30m: 2, target: { tvdM: 900, northingM: 0, eastingM: 100 } }), /deeper than the kickoff/);
  assert.throws(() => planBuildHold({ kickoffMdM: 1000, buildRateDegPer30m: 1, target: { tvdM: 1100, northingM: 0, eastingM: 5000 } }), /inclination/);
  assert.throws(() => planBuildHold({ kickoffMdM: 1000, buildRateDegPer30m: 1, target: { tvdM: 1200, northingM: 0, eastingM: 1600 } }), /build radius/);
  const vertical = planBuildHold({ kickoffMdM: 500, buildRateDegPer30m: 2, target: { tvdM: 1500, northingM: 0, eastingM: 0 } });
  close(vertical.holdInclinationDeg, 0);
  close(vertical.targetMdM, 1500);
});

test("validation separates input errors from dogleg warnings", () => {
  const issues = validateSurveyStations([{ mdM: 0, inclinationDeg: 0, azimuthDeg: 0 }, { mdM: 0, inclinationDeg: 200, azimuthDeg: 360 }]);
  assert.deepEqual(issues.map((issue) => issue.field), ["mdM", "inclinationDeg", "azimuthDeg"]);
  const warnings = validateSurveyStations([{ mdM: 0, inclinationDeg: 0, azimuthDeg: 0 }, { mdM: 30, inclinationDeg: 6, azimuthDeg: 0 }], { maxDlsDegPer30m: 5 });
  assert.equal(warnings[0]?.severity, "warning");
  assert.throws(() => computeMinimumCurvature([{ mdM: 10, inclinationDeg: 0, azimuthDeg: 0 }, { mdM: 5, inclinationDeg: 0, azimuthDeg: 0 }]), /increase/);
});

test("trajectory edits create a planned revision and trim construction below TD", () => {
  const plan = planBuildHold({ kickoffMdM: 400, buildRateDegPer30m: 3, target: { tvdM: 1200, northingM: 300, eastingM: 300 } });
  const edited = designWithTrajectory(forgeDesign, plan.stations, { name: "J plan" });
  assert.equal(edited.provenance, "user-authored");
  assert.equal(edited.surveyStatus, "planned");
  assert.equal(edited.revision, forgeDesign.revision + 1);
  close(edited.totalDepthM, plan.totalDepthMdM);
  assert.ok(edited.components!.every((component) => component.bottomDepthM <= edited.totalDepthM));
  assert.ok(!("hashes" in edited));
  assert.equal(forgeDesign.provenance, "documented");
});
