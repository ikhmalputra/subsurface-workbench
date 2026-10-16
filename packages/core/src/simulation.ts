/**
 * Simulators that run a well forward in time: drilling first (`DrillingSimulator`). Each is
 * deterministic for a seed, labels its rock and events as simulated, and keeps what the rock really
 * did apart from what a rig would see.
 */
export { DrillingSimulator, defaultFlowGpm, hazardsFromPlan, rockOf } from "./drilling-sim.ts";
export type { DrillCommand, DrillEvent, DrillMode, DrillReading, DrillString, DrillingSimSetup, Hazard, KillSheet, Mud } from "./drilling-sim.ts";
