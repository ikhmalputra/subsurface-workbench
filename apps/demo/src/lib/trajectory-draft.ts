import { computeMinimumCurvature, planBuildHold, summarizeTrajectory } from "@ikhmalputra/subsurface-core";
import type { BuildHoldInput, BuildHoldPlan, SurveyStationInput, WellDesign } from "@ikhmalputra/subsurface-core";

/**
 * A trajectory the engineer is working on but has not applied: the planner's build-and-hold, or
 * stations under edit. The workspace keeps one per well; the sheet's section draws it as a
 * preview, and the planner and the station editor are tools over that one section. Applying it
 * writes a user-authored revision through the host's callback; discarding it leaves the source
 * untouched. Nothing here is persisted by the SDK.
 */
export interface TrajectoryDraft {
  readonly mode: "plan" | "edit";
  readonly plan: BuildHoldInput;
  readonly stations: readonly SurveyStationInput[];
  readonly dlsLimitDegPer30m: number;
}

export const stationInputs = (survey: readonly { mdM: number; inclinationDeg: number; azimuthDeg: number }[]): SurveyStationInput[] =>
  survey.map(({ mdM, inclinationDeg, azimuthDeg }) => ({ mdM, inclinationDeg, azimuthDeg }));

export function tryPlan(input: BuildHoldInput): { plan: BuildHoldPlan | null; error: string | null } {
  try { return { plan: planBuildHold(input), error: null }; } catch (error) { return { plan: null, error: error instanceof Error ? error.message : String(error) }; }
}

/** A solvable starting plan that aims at the reference well's TD. */
export function defaultPlan(design: WellDesign): BuildHoldInput {
  const stations = design.survey ?? [];
  const last = stations.at(-1);
  if (!last) return { kickoffMdM: 300, buildRateDegPer30m: 3, target: { tvdM: 1500, northingM: 300, eastingM: 300 }, extensionM: 0 };
  const computed = computeMinimumCurvature(stationInputs(stations), { tieIn: stations[0] });
  const kickoff = Math.round(summarizeTrajectory(computed).kickoffMdM ?? 300);
  const target = { tvdM: Math.round(last.tvdM), northingM: Math.round(last.northingM), eastingM: Math.round(last.eastingM) };
  for (const buildRateDegPer30m of [2, 3, 4, 6, 8]) {
    const input = { kickoffMdM: kickoff, buildRateDegPer30m, target, extensionM: 0 };
    if (tryPlan(input).plan) return input;
  }
  return { kickoffMdM: 300, buildRateDegPer30m: 3, target: { tvdM: 1500, northingM: 300, eastingM: 300 }, extensionM: 0 };
}

/** The draft a planner input makes, or null when the input does not solve. */
export function planDraft(input: BuildHoldInput, previous: TrajectoryDraft | undefined): TrajectoryDraft | null {
  const { plan } = tryPlan(input);
  return plan ? { mode: "plan", plan: input, stations: plan.stations, dlsLimitDegPer30m: previous?.dlsLimitDegPer30m ?? 3 } : null;
}
