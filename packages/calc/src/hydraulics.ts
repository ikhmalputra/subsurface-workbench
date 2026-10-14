import { type Known, absent, derived, fromAll } from "@ikhmalputra/subsurface-kernel";

/**
 * Bit and annular hydraulics, in the field units the correlations are written in.
 *
 * These existed nowhere in the previous SDK. They lived inside a React component in a private demo
 * application — five correlations and an annular velocity, trapped in JSX, shipped to nobody. They
 * are the clearest case for this layer: real engineering with no home.
 *
 * API RP 13D field units throughout: flow in gallons per minute, mud weight in pounds per gallon,
 * nozzles in 32nds of an inch, diameters in inches, pressure in psi. The constants are the
 * standard's, not derived here, and the formula is carried on each result so a reader can check it.
 *
 * What this does not do: annular pressure loss and equivalent circulating density. Both need the
 * mud's rheology — plastic viscosity and yield point at minimum — and a host that has not supplied
 * a rheogram cannot have them. They are absent rather than approximated.
 */

export interface BitInput {
  /** Flow rate, gallons per minute. */
  readonly flowGpm: Known<number>;
  /** Mud weight, pounds per gallon. */
  readonly mudPpg: Known<number>;
  /** Nozzle sizes in 32nds of an inch, as the bit record lists them. */
  readonly nozzles32nds: Known<readonly number[]>;
}

export interface BitHydraulics {
  /** Total flow area, square inches. */
  readonly totalFlowAreaIn2: Known<number>;
  readonly nozzleVelocityFtPerSec: Known<number>;
  readonly pressureDropPsi: Known<number>;
  readonly hydraulicHorsepower: Known<number>;
  readonly impactForceLbf: Known<number>;
}

const FORMULA = {
  tfa: "Σ π/4 · (n/32)²",
  velocity: "0.32086 · Q / TFA",
  drop: "MW · Q² / (10858 · TFA²)",
  power: "ΔP · Q / 1714",
  impact: "0.000516 · MW · Q · Vn",
  annular: "24.51 · Q / (D² − d²)",
} as const;

/** Total flow area from the nozzle sizes a bit record lists. */
export function totalFlowArea(nozzles32nds: Known<readonly number[]>): Known<number> {
  if (nozzles32nds.state === "absent") return nozzles32nds as Known<number>;
  const sizes = nozzles32nds.value.filter((n) => Number.isFinite(n) && n > 0);
  if (sizes.length === 0) return absent("the bit record lists no nozzles");
  const area = sizes.reduce((total, n) => total + (Math.PI / 4) * (n / 32) ** 2, 0);
  return derived(area, FORMULA.tfa);
}

export function bitHydraulics(input: BitInput): BitHydraulics {
  const tfa = totalFlowArea(input.nozzles32nds);
  const { flowGpm, mudPpg } = input;

  const velocity = fromAll([flowGpm, tfa], (q, area) => (0.32086 * q) / area, FORMULA.velocity);
  const drop = fromAll([mudPpg, flowGpm, tfa], (mw, q, area) => (mw * q ** 2) / (10858 * area ** 2), FORMULA.drop);
  const power = fromAll([drop, flowGpm], (dp, q) => (dp * q) / 1714, FORMULA.power);
  const impact = fromAll([mudPpg, flowGpm, velocity], (mw, q, v) => 0.000516 * mw * q * v, FORMULA.impact);

  return { totalFlowAreaIn2: tfa, nozzleVelocityFtPerSec: velocity, pressureDropPsi: drop, hydraulicHorsepower: power, impactForceLbf: impact };
}

export interface AnnulusInput {
  readonly flowGpm: Known<number>;
  /** Hole or casing inner diameter, inches. */
  readonly holeIn: Known<number>;
  /** Pipe outer diameter, inches. */
  readonly pipeIn: Known<number>;
}

/**
 * Annular velocity up one section, feet per minute.
 *
 * Assumes the pipe is drill pipe over the whole section; collars are shorter and the fluid moves
 * faster past them. A host that knows its bottom-hole assembly should call this per component.
 */
export function annularVelocity({ flowGpm, holeIn, pipeIn }: AnnulusInput): Known<number> {
  const sized = fromAll([holeIn, pipeIn], (hole, pipe) => hole > pipe, "diameters compared");
  if (sized.state !== "absent" && !sized.value) return absent("the pipe is not smaller than the hole it is in");
  return fromAll([flowGpm, holeIn, pipeIn], (q, hole, pipe) => (24.51 * q) / (hole ** 2 - pipe ** 2), FORMULA.annular);
}

/** What this layer deliberately does not compute, so a host can say so rather than leave a blank. */
export const NOT_COMPUTED = Object.freeze({
  annularPressureLoss: "needs the mud's rheology, which the host has not supplied",
  equivalentCirculatingDensity: "needs the annular pressure loss, which needs the mud's rheology",
});
