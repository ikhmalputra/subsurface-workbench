// Plan a build-and-hold well and draw it. Drag the target in either view, or change the kickoff
// and build rate: the plan is solved again, and an unreachable target says why.
import { useMemo, useRef, useState } from "react";
import type { BuildHoldTarget, ComputedStation } from "@ikhmalputra/subsurface-core";
import { computeMinimumCurvature, planBuildHold } from "@ikhmalputra/subsurface-core/trajectory";
import { TrajectoryPlanView, TrajectorySectionView } from "@ikhmalputra/subsurface-react/trajectory";

export function PlanWell() {
  const [kickoffMdM, setKickoffMdM] = useState(600);
  const [buildRate, setBuildRate] = useState(2.5);
  const [target, setTarget] = useState<BuildHoldTarget>({ tvdM: 2400, northingM: 650, eastingM: 900 });
  const [selectedMdM, setSelectedMdM] = useState<number | null>(null);
  const lastGood = useRef<readonly ComputedStation[]>([]);

  // planBuildHold throws a RangeError naming the problem when the target cannot be reached.
  const result = useMemo(() => {
    try {
      const plan = planBuildHold({ kickoffMdM, buildRateDegPer30m: buildRate, target });
      return { plan, survey: computeMinimumCurvature(plan.stations), error: null };
    } catch (error) {
      return { plan: null, survey: null, error: (error as Error).message };
    }
  }, [kickoffMdM, buildRate, target]);
  if (result.survey) lastGood.current = result.survey;

  const { plan } = result;
  const views = {
    survey: lastGood.current, target, targetInvalid: !plan, onTargetChange: setTarget,
    selectedMdM, onSelectMd: setSelectedMdM, dlsLimitDegPer30m: 3, height: 360,
  };

  return <div className="ex-plan">
    <div className="ex-controls">
      <label>Kickoff
        <input type="range" min={100} max={1500} step={50} value={kickoffMdM}
          onChange={(event) => setKickoffMdM(Number(event.target.value))} />
        <output>{kickoffMdM} m MD</output>
      </label>
      <label>Build rate
        <input type="range" min={1} max={6} step={0.5} value={buildRate}
          onChange={(event) => setBuildRate(Number(event.target.value))} />
        <output>{buildRate}°/30 m</output>
      </label>
    </div>
    {plan
      ? <p className="ex-readout">
          Hold {plan.holdInclinationDeg.toFixed(1)}° toward {plan.azimuthDeg.toFixed(0)}°
          · end of build {plan.endOfBuildMdM.toFixed(0)} m MD
          · target at {plan.targetMdM.toFixed(0)} m MD, {plan.targetDisplacementM.toFixed(0)} m out
        </p>
      : <p className="ex-readout is-error" role="alert">{result.error}</p>}
    <div className="ex-pair">
      <TrajectoryPlanView {...views} />
      <TrajectorySectionView {...views} verticalSectionAzimuthDeg={plan?.azimuthDeg ?? 0} />
    </div>
  </div>;
}
