/**
 * React views over the layers beneath.
 *
 * Every view takes an optional selection store. Given one it subscribes itself, so two views on a
 * page are linked with no host code between them; given none it keeps its own state and behaves as
 * an ordinary controlled component. That default is the difference between a toolkit of parts and a
 * box of pieces, and it is the thing the previous package left to the host.
 *
 * No view fetches. No view computes where anything goes — the scene layer did that, and the 2D and
 * 3D views read the same placements so they cannot drift apart.
 */
export * from "./use-selection.ts";
export * from "./schematic.tsx";
