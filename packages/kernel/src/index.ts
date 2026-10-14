/**
 * The logic a subsurface application needs before any of it can be drawn or calculated.
 *
 * Three ideas, each of which existed in the previous design as a convention that every view had to
 * remember, and each of which is now something the type system enforces:
 *
 * - **What is known** (`./known`) — a value is reported, derived or absent, and reading one means
 *   saying what an absence becomes. Nothing can be invented by forgetting a null check.
 * - **What it measures** (`./quantity`) — a number carries its unit and dimension, so feet cannot
 *   be passed where metres are wanted and the conversion factors live in one table.
 * - **Where it is** (`./depth`) — measured depth, true vertical depth and elevation are different
 *   kinds counted from a named datum, and comparing across either fails rather than guessing.
 *
 * It computes nothing. The trajectory maths, the casing ratings and the parsers sit above this.
 */
export * from "./known.ts";
export * from "./quantity.ts";
export * from "./depth.ts";
export * from "./selection.ts";
