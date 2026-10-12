import { projectWells } from "../lib/project";
import type { ProjectWell } from "../lib/project";

/**
 * The workspace's well list, which is now a view of the project rather than a second copy of it.
 *
 * This file used to declare its own three wells, so a well's datasets were described twice and the
 * petrophysics and production fixtures were described nowhere — they lived inside route components.
 * `projectWells` is the one declaration; this shape stays because the workspace reads it widely,
 * and keeping it narrow makes clear that the workspace does not care what else a well carries.
 */
export const wells: readonly ProjectWell[] = projectWells;
export type { ProjectWell };
