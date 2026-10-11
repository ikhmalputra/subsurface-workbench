import type { Metadata } from "next";
import { DemoHeader, DemoPage } from "../../components/showcase";
import { TrajectoryDemo } from "../../components/trajectory-demo";

export const metadata: Metadata = { title: "Trajectory engineering · Subsurface SDK" };

const code = `
import { computeMinimumCurvature, planBuildHold, summarizeTrajectory,
  validateSurveyStations, designWithTrajectory } from "@ikhmalputra/subsurface-core";
import { TrajectoryPlanView, TrajectorySectionView, TrajectoryLog,
  SurveyTable, BuildHoldForm } from "@ikhmalputra/subsurface-react/trajectory";
import WellScene from "@ikhmalputra/subsurface-react/three";

const plan = planBuildHold({ kickoffMdM: 600, buildRateDegPer30m: 3,
  target: { tvdM: 2400, northingM: -300, eastingM: 1100 } });
const survey = computeMinimumCurvature(plan.stations);   // TVD, N, E, DLS, VS…

<TrajectoryPlanView survey={survey} target={input.target}
  onTargetChange={(target) => setInput({ ...input, target })} />
<SurveyTable survey={survey} onChange={setStations}
  issues={validateSurveyStations(stations, { maxDlsDegPer30m: 3 })} />
<WellScene design={designWithTrajectory(design, plan.stations)}
  colorBy="dls" probeMdM={md} onProbe={setMd} />
`;

export default function TrajectoryPage() {
  return <DemoPage current="/trajectory/">
    <DemoHeader eyebrow="Capability · directional survey math" title="Trajectory engineering" lede="Minimum-curvature survey calculation, a build-and-hold planner and an editable station table, drawn as a plan view, vertical section, survey log and 3D path coloured by dogleg severity. Pick a depth anywhere and every view follows it." points={["Minimum-curvature survey math and a build-and-hold planner", "Editable station table, validated as you type", "Plan view, vertical section, survey log and 3D path coloured by dogleg severity", "Pick a depth anywhere — every view follows it"]} uses={["computeMinimumCurvature", "planBuildHold", "validateSurveyStations", "TrajectoryPlanView", "TrajectorySectionView", "TrajectoryLog", "SurveyTable", "WellScene"]} code={code} />
    <TrajectoryDemo />
  </DemoPage>;
}
