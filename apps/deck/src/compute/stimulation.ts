import { generateFractures, jobTimes, simulateStimulation } from "@ikhmalputra/subsurface-core/induced-seismicity";
import type { FractureSet, PressureModel, Stage, StressField } from "@ikhmalputra/subsurface-core/induced-seismicity";

/**
 * The stimulation run in the compute worker: the fracture population around the stages (density by
 * elevation from the FMI's fracture intensity, carried as plain arrays), then every fracture through
 * the job's time steps. Thousands of fractures × hundreds of steps × the stages: a few hundred
 * milliseconds, so it never stalls a frame.
 */
export interface StimulationJob {
  readonly field: StressField;
  readonly center: { readonly x: number; readonly y: number; readonly z: number };
  readonly half: { readonly x: number; readonly y: number; readonly z: number };
  readonly count: number;
  readonly sets: readonly FractureSet[];
  readonly radiusMinM: number; readonly radiusMaxM: number; readonly sizeExponent: number;
  readonly muMean: number; readonly muSd: number;
  /** Relative fracture density by elevation (0–1), as parallel arrays sorted by elevation. */
  readonly density: { readonly zM: readonly number[]; readonly value: readonly number[] };
  readonly stages: readonly Stage[];
  readonly model: PressureModel;
  readonly untilS: number;
  readonly stressDropPa: number;
  readonly seed: number;
}

export function stimulate(job: StimulationJob) {
  const { zM, value } = job.density;
  const densityAt = (z: number) => {
    if (!zM.length) return 1;
    if (z <= zM[0]!) return value[0]!;
    for (let i = 1; i < zM.length; i++) if (z <= zM[i]!) { const f = (z - zM[i - 1]!) / (zM[i]! - zM[i - 1]!); return value[i - 1]! + (value[i]! - value[i - 1]!) * f; }
    return value.at(-1)!;
  };
  const fractures = generateFractures({ field: job.field, center: job.center, half: job.half, count: job.count, sets: job.sets, radiusMinM: job.radiusMinM, radiusMaxM: job.radiusMaxM, sizeExponent: job.sizeExponent, muMean: job.muMean, muSd: job.muSd, densityAt, seed: job.seed });
  const times = jobTimes(job.stages, job.untilS);
  const { events, peak } = simulateStimulation(fractures, job.stages, job.model, { times, stressDropPa: job.stressDropPa });
  return { fractures, events, peak: Array.from(peak), times };
}
