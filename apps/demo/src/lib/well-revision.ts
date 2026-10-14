import { assemblyToWellComponents, computeMinimumCurvature, getWellComponents, validateSurveyStations } from "@ikhmalputra/subsurface-core";
import { validateWellDesign, validateWellOperations } from "@ikhmalputra/subsurface-core/contracts";
import type { WellAssembly, WellDesign, WellOperations, SurveyStationInput } from "@ikhmalputra/subsurface-core";

export interface WellRevision {
  readonly design: WellDesign;
  readonly operations: WellOperations | null;
  readonly logUrl: string | null;
}

const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object.`);
  return value as Record<string, unknown>;
};

/**
 * The design and operations validators now live in the SDK, where the types do.
 *
 * They were 150 lines here, and `WellDesign` is the package's flagship record — a host reading one
 * from a file or a form had nothing to call, because the only implementation was inside this
 * private application. `validateWellDesign` returns the value in the package's own validation
 * style; these two keep the assertion ergonomics the editors here are written against.
 */
export function assertWellDesign(value: unknown): asserts value is WellDesign { validateWellDesign(value); }
export function assertWellOperations(value: unknown): asserts value is WellOperations { validateWellOperations(value); }

export function localLogUrl(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("logUrl must be text.");
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("?") || value.includes("#")) throw new Error("Mud-log URL must be a same-origin absolute file path.");
  return value;
}

export function parseWellRevision(input: string, sourceId: string): WellRevision {
  const value = record(JSON.parse(input), "well revision");
  assertWellDesign(value.design);
  if (value.design.id !== sourceId) throw new Error("Well ID is immutable; import into the matching source well.");
  if (value.operations !== null) {
    assertWellOperations(value.operations);
    if (value.operations.wellId !== sourceId) throw new Error("Operational records must belong to this well.");
  }
  return { design: value.design, operations: value.operations, logUrl: localLogUrl(value.logUrl) };
}

export function authoredRevision(value: WellRevision, previous: WellDesign): WellRevision {
  assertWellDesign(value.design);
  if (value.design.id !== previous.id) throw new Error("Well ID is immutable.");
  if (value.operations !== null) {
    assertWellOperations(value.operations);
    if (value.operations.wellId !== previous.id) throw new Error("Operational records must belong to this well.");
  }
  return { ...value, logUrl: localLogUrl(value.logUrl), design: { ...value.design, revision: previous.revision + 1, provenance: "user-authored" } };
}

/**
 * Recompute a design from edited or planned survey stations.
 *
 * This is the only place the recomputation happens. The sheet's preview and the applied revision
 * both come through here, because they used to come through two different functions with three
 * differences — the preview took the last station's MD as the total depth, trimmed components past
 * it, and recomputed without the source tie-in. Trimming eighty stations off FORGE drew a preview
 * 938 m shallower than applying it produced, so the drawing was not a picture of the pending edit.
 *
 * The rules, and why:
 * - **Total depth is never reduced.** A survey covers part of a well; the well's depth is a
 *   separate fact. FORGE's own record reaches 10,987 ft with the final interval unsurveyed.
 *   Editing a survey must not silently shorten the well.
 * - **Components are left alone.** Trimming the construction because the survey got shorter would
 *   change a record the engineer did not touch.
 * - **The source tie-in is always honoured.** Positions are tied to the well's first station; a
 *   plan starts from the same point the well does.
 */
export function editTrajectory(design: WellDesign, stations: readonly SurveyStationInput[], details: { readonly name?: string; readonly note?: string } = {}): WellDesign {
  const invalid = validateSurveyStations(stations).find((issue) => issue.severity === "error");
  if (invalid) throw new Error(`Station ${invalid.index + 1}: ${invalid.message}`);
  if (stations.length < 2) throw new Error("A trajectory needs at least two survey stations.");
  const tieIn = design.survey?.[0];
  if (tieIn && Math.abs(stations[0]!.mdM - tieIn.mdM) > 1e-6) throw new Error(`First station must retain the source tie-in at ${tieIn.mdM} m MD.`);
  const survey = computeMinimumCurvature(stations, { tieIn });
  const totalDepthM = Math.max(design.totalDepthM, survey.at(-1)!.mdM);
  return { ...design, totalDepthM, survey: survey.map(({ mdM, tvdM, northingM, eastingM, inclinationDeg, azimuthDeg }) => ({ mdM, tvdM, northingM, eastingM, inclinationDeg, azimuthDeg })), surveyStatus: "planned", trajectoryName: details.name ?? "Edited trajectory", trajectoryNote: details.note ?? "User-authored survey; positions recomputed by minimum curvature using the original first-station tie-in.", surveyCoverageFt: undefined };
}

/**
 * The same recomputation, for drawing a draft that has not been applied.
 *
 * Stations under edit pass through states that `editTrajectory` rejects, and the sheet must not
 * throw while someone is typing. When the edit would be refused the source is drawn unchanged:
 * showing a well that could never be applied would be the same lie in the other direction. The
 * station editor is where the reason is reported.
 */
export function previewTrajectory(design: WellDesign, stations: readonly SurveyStationInput[], details: { readonly name?: string; readonly note?: string } = {}): WellDesign {
  try { return editTrajectory(design, stations, details); } catch { return design; }
}

export function mergeAssembly(design: WellDesign, before: WellAssembly, after: WellAssembly): WellDesign {
  const originals = getWellComponents(design);
  const converted = assemblyToWellComponents(after);
  const beforeIds = new Set(before.items.map((item) => item.id));
  const afterIds = new Set(after.items.map((item) => item.id));
  const removed = new Set(before.items.filter((item) => !afterIds.has(item.id)).map((item) => item.id));
  let found = true;
  while (found) {
    found = false;
    for (const component of originals) if (component.parentId && removed.has(component.parentId) && !removed.has(component.id)) {
      removed.add(component.id); found = true;
    }
  }
  const changed = converted.map((component) => {
    const old = originals.find((entry) => entry.id === component.id);
    const previous = before.items.find((entry) => entry.id === component.id);
    const next = after.items.find((entry) => entry.id === component.id)!;
    if (old && previous && JSON.stringify(previous) === JSON.stringify(next)) return old;
    return old && previous ? {
      ...old, name: component.name,
      ...(previous.topM !== next.topM ? { topDepthM: component.topDepthM, topDepthReported: true } : {}),
      ...(previous.bottomM !== next.bottomM ? { bottomDepthM: component.bottomDepthM, rawBottomDepthFt: undefined } : {}),
      ...(previous.odIn !== next.odIn ? { outerDiameterMm: component.outerDiameterMm } : {}),
      ...(previous.idIn !== next.idIn ? { innerDiameterMm: component.innerDiameterMm } : {}),
      ...(previous.hostId !== next.hostId ? { parentId: next.hostId } : {}),
    } : component;
  });
  const components = [...originals.filter((component) => !beforeIds.has(component.id) && !removed.has(component.id)), ...changed];
  return { ...design, wellName: after.name, totalDepthM: after.totalDepthM, casingBottomM: Math.max(0, ...components.filter((component) => component.kind === "Casing").map((component) => component.bottomDepthM)), components };
}
