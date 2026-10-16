import { calibrate, calibrationDays, dayString, torqueDrag } from "@ikhmalputra/subsurface-core";
import type { CalibrationDay, Movement } from "@ikhmalputra/subsurface-core";

/**
 * FORGE 16A(78)-32's torque and drag as a plain function, so the compute worker can run it: the
 * friction factors, block and pipe weight fitted to the daily reports, the broomstick (pick-up,
 * slack-off and rotating hookload down the hole, and the curves at two other open-hole frictions),
 * and the off-bottom rotating torque.
 */
export interface TorqueStation { readonly mdFt: number; readonly inclinationDeg: number; readonly azimuthDeg: number }
export type Curve = { md: number; value: number }[];

export function torqueAndDrag(survey: readonly TorqueStation[], shoeFt: number, tdFt: number) {
  const days = calibrationDays();
  const fit = calibrate(survey, shoeFt, days);
  const last = days.at(-1)!;
  const run = (bitFt: number, movement: Movement, open: number) => torqueDrag({ survey, string: dayString({ ...last, mdFt: bitFt } as CalibrationDay, fit.pipeLbFt), bitMdFt: bitFt, mudWeightPpg: last.mudWeightPpg, frictionCased: fit.frictionCased, frictionOpen: open, shoeMdFt: shoeFt, stepFt: 60 }, movement);
  const depths: number[] = [];
  for (let md = Math.ceil((last.bhaLengthFt + 100) / 100) * 100; md <= tdFt; md += 150) depths.push(md);
  depths.push(tdFt);
  const line = (movement: Movement, open: number): Curve => depths.map((md) => ({ md, value: fit.blockLb + run(md, movement, open).hookloadLb }));
  const torque: Curve = [];
  for (let md = Math.ceil((last.bhaLengthFt + 100) / 100) * 100; md <= tdFt; md += 200) torque.push({ md, value: run(md, "rotating", fit.frictionOpen).torqueFtLbf });
  return {
    fit, lastMudWeightPpg: last.mudWeightPpg, usedDates: days.map((day) => day.date),
    curves: {
      fitted: { pickup: line("pickup", fit.frictionOpen), slackoff: line("slackoff", fit.frictionOpen), rotating: line("rotating", fit.frictionOpen) } as Record<Movement, Curve>,
      ghosts: [0.2, 0.4].flatMap((open) => (["pickup", "slackoff"] as const).map((movement) => ({ open, movement, points: line(movement, open) }))),
    },
    torque,
  };
}
