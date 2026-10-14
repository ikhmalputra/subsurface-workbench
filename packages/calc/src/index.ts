/**
 * What the subsurface domain computes, on top of the kernel's logic.
 *
 * Every result is a `Known<T>`: it says whether it was reported, derived or absent, and a derived
 * value names the formula it came from. That is what lets a view show a number and its basis in the
 * same breath, and what stops an estimate being presented with the authority of a measurement.
 *
 * It renders nothing and fetches nothing.
 */
export * from "./angle.ts";
export * from "./interpolate.ts";
export * from "./trajectory.ts";
export * from "./hydraulics.ts";
