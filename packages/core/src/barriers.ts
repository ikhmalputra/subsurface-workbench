import type { WellComponent } from "./index.ts";

/**
 * Well-barrier envelopes: two independent sets of elements that each stop flow from the reservoir
 * (or any permeable, pressured formation) to surface — the primary, which meets the pressure first,
 * and the secondary behind it. The idea follows NORSOK D-010 (Standards Norway); its element
 * acceptance tables are not reproduced. Each element here carries what the records say about it, and
 * what they do not say is listed as a gap, never assumed to be in order.
 */

export type BarrierPhase = "drilling" | "producing" | "completed";
export type Evidence = "documented" | "planned" | "not reported";

export interface BarrierElement {
  readonly id: string;
  readonly name: string;
  readonly kind: "fluid" | "casing" | "cement" | "formation" | "wellhead" | "valve" | "bop" | "tubing" | "packer" | "safety-valve";
  readonly topM: number;
  readonly bottomM: number;
  /** The record's own words or numbers for it, with the source. */
  readonly evidence: string;
  readonly status: Evidence;
  readonly componentId?: string;
}

export interface BarrierEnvelopes {
  readonly phase: BarrierPhase;
  readonly primary: readonly BarrierElement[];
  readonly secondary: readonly BarrierElement[];
  /** Elements in both envelopes, which one failure would take from both. */
  readonly shared: readonly string[];
  /** What the records do not give for an element the envelope needs. */
  readonly gaps: readonly string[];
}

export interface BarrierInput {
  readonly components: readonly WellComponent[];
  readonly phase: BarrierPhase;
  readonly provenance: "documented" | "synthetic";
  /** The depth drilled, for the drilling phase. */
  readonly holeDepthM?: number;
  /** Drilling: the mud's weight and the formation pressure it holds back, as equivalent SG, with their sources. */
  readonly fluid?: { readonly mudSg: number | null; readonly poreSg: number | null; readonly source: string } | null;
  /** Drilling: the last BOP test, as the records give it. */
  readonly bopTest?: { readonly date: string | null; readonly source: string } | null;
  /** Top of the reservoir, MD m, for how much cement lies above it. */
  readonly reservoirTopMdM?: number | null;
}

const source = (component: WellComponent, provenance: BarrierInput["provenance"]) => component.sourcePage ? `record p. ${component.sourcePage}` : provenance === "synthetic" ? "design brief" : "source not reported";
const statusOf = (provenance: BarrierInput["provenance"]): Evidence => provenance === "synthetic" ? "planned" : "documented";

/** The cement in the annulus outside a casing: the record that names it, or the one whose interval matches its shoe. */
function cementOf(casing: WellComponent, components: readonly WellComponent[]) {
  const cements = components.filter((component) => component.kind === "Cement");
  return cements.find((cement) => (cement as WellComponent & { parentId?: string }).parentId === casing.id)
    ?? cements.find((cement) => Math.abs(cement.bottomDepthM - casing.bottomDepthM) < 1) ?? null;
}

function casingElement(casing: WellComponent, input: BarrierInput, part: string, topM = casing.topDepthM, bottomM = casing.bottomDepthM): BarrierElement {
  return { id: `${casing.id}:${part}`, name: casing.name, kind: "casing", topM, bottomM, componentId: casing.id, status: statusOf(input.provenance), evidence: `${casing.material ?? "material not reported"} · shoe ${Math.round(casing.bottomDepthM)} m MD · ${source(casing, input.provenance)}` };
}

function cementElement(casing: WellComponent, input: BarrierInput, gaps: string[], from?: number): BarrierElement {
  const cement = cementOf(casing, input.components);
  if (!cement) {
    gaps.push(`${casing.name}: no cement record for its annulus`);
    return { id: `${casing.id}:cement`, name: `Cement outside ${casing.name}`, kind: "cement", topM: from ?? casing.topDepthM, bottomM: casing.bottomDepthM, status: "not reported", evidence: "No cement record for this annulus" };
  }
  const above = input.reservoirTopMdM != null && cement.topDepthM < input.reservoirTopMdM && casing.bottomDepthM > input.reservoirTopMdM ? ` · ${Math.round(input.reservoirTopMdM - cement.topDepthM)} m of it above the reservoir top` : "";
  return { id: `${casing.id}:cement`, name: cement.name, kind: "cement", topM: Math.max(cement.topDepthM, from ?? 0), bottomM: cement.bottomDepthM, componentId: cement.id, status: statusOf(input.provenance), evidence: `${cement.material ?? "slurry not reported"} · top ${Math.round(cement.topDepthM)} m MD${above} · ${source(cement, input.provenance)}` };
}

function surfaceElement(kind: "wellhead" | "valve", components: readonly WellComponent[], input: BarrierInput, gaps: string[], name: string): BarrierElement {
  const found = components.find((component) => component.kind === (kind === "wellhead" ? "Wellhead" : "Valve"));
  if (!found) { gaps.push(`${name}: not in the records`); return { id: kind, name, kind, topM: 0, bottomM: 0, status: "not reported", evidence: "Not in the records" }; }
  if (found.material === "Not reported") gaps.push(`${found.name}: rating and pressure test not reported`);
  return { id: found.id, name: found.name, kind, topM: 0, bottomM: 0, componentId: found.id, status: statusOf(input.provenance), evidence: `${found.material && found.material !== "Not reported" ? found.material : "rating not reported"} · ${source(found, input.provenance)}` };
}

/**
 * The two envelopes for a well's construction in one phase.
 *
 * - Drilling: the mud column holds the formation (primary); behind it the last cemented casing and
 *   its cement, the wellhead and the BOP (secondary).
 * - Producing, with tubing: the production casing and its cement below the packer, the packer, the
 *   tubing and the subsurface safety valve (primary); the production casing above the packer and
 *   its cement, the wellhead and the tree (secondary).
 * - Completed without tubing: the production casing, its cement, the wellhead and the master valve
 *   (primary); the next casing out and its cement, with the wellhead (secondary).
 */
export function barrierEnvelopes(input: BarrierInput): BarrierEnvelopes {
  const gaps: string[] = [];
  const casings = input.components.filter((component) => component.kind === "Casing").sort((a, b) => a.bottomDepthM - b.bottomDepthM);
  const primary: BarrierElement[] = [], secondary: BarrierElement[] = [];
  if (input.phase === "drilling") {
    const fluid = input.fluid;
    const over = fluid?.mudSg != null && fluid.poreSg != null ? fluid.mudSg - fluid.poreSg : null;
    if (over === null) gaps.push(`Fluid column: ${fluid?.mudSg == null ? "mud weight" : "formation pressure"} not reported, so its margin is unknown`);
    else if (over <= 0) gaps.push(`Fluid column: mud ${fluid!.mudSg!.toFixed(2)} SG does not exceed the formation's ${fluid!.poreSg!.toFixed(2)} SG`);
    primary.push({ id: "fluid", name: "Drilling fluid column", kind: "fluid", topM: 0, bottomM: input.holeDepthM ?? 0, status: over === null ? "not reported" : statusOf(input.provenance),
      evidence: over === null ? `${fluid?.mudSg != null ? `${fluid.mudSg.toFixed(2)} SG mud; formation pressure not reported` : fluid?.poreSg != null ? `Formation ${fluid.poreSg.toFixed(2)} SG; mud weight not reported` : "Mud weight and formation pressure not reported"} · ${fluid?.source ?? "no source"}` : `${fluid!.mudSg!.toFixed(2)} SG mud against ${fluid!.poreSg!.toFixed(2)} SG formation: ${over >= 0 ? "+" : ""}${over.toFixed(2)} SG · ${fluid!.source}` });
    const last = casings.filter((casing) => casing.bottomDepthM <= (input.holeDepthM ?? Infinity) + 1).at(-1);
    if (!last) gaps.push("No casing set yet: nothing behind the fluid column");
    else {
      secondary.push({ id: `${last.id}:shoe`, name: `Formation at the ${last.name} shoe`, kind: "formation", topM: last.bottomDepthM - 10, bottomM: last.bottomDepthM, status: "not reported", evidence: "Leak-off or formation integrity at this shoe not in the records used" });
      gaps.push(`Formation at the ${last.name} shoe: no leak-off or integrity test in the records used`);
      secondary.push(cementElement(last, input, gaps), casingElement(last, input, "body"));
    }
    secondary.push(surfaceElement("wellhead", input.components, input, gaps, "Wellhead"));
    const bop = input.bopTest;
    if (!bop?.date) gaps.push("BOP: no test date in the records for this day");
    secondary.push({ id: "bop", name: "Blowout preventer", kind: "bop", topM: 0, bottomM: 0, status: bop?.date ? statusOf(input.provenance) : "not reported", evidence: bop?.date ? `Last tested ${bop.date} · ${bop.source}` : `No test date · ${bop?.source ?? "not reported"}` });
    return { phase: input.phase, primary, secondary, shared: [], gaps };
  }
  const production = casings.at(-1);
  if (!production) return { phase: input.phase, primary, secondary, shared: [], gaps: ["No casing in the records"] };
  const packer = input.components.find((component) => component.kind === "Packer");
  const tubing = input.components.find((component) => component.kind === "Tubular");
  const ssv = input.components.find((component) => component.kind === "Safety valve");
  if (input.phase === "producing" && packer && tubing) {
    primary.push(casingElement(production, input, "below-packer", packer.bottomDepthM, production.bottomDepthM), cementElement(production, input, gaps, packer.bottomDepthM));
    primary.push({ id: packer.id, name: packer.name, kind: "packer", topM: packer.topDepthM, bottomM: packer.bottomDepthM, componentId: packer.id, status: statusOf(input.provenance), evidence: `${packer.material ?? "not reported"} · ${source(packer, input.provenance)}` });
    const top = ssv ? ssv.topDepthM : 0;
    primary.push({ id: tubing.id, name: tubing.name, kind: "tubing", topM: top, bottomM: packer.topDepthM, componentId: tubing.id, status: statusOf(input.provenance), evidence: `${tubing.material ?? "not reported"} · ${source(tubing, input.provenance)}` });
    const mandrels = input.components.filter((component) => component.kind === "Gas lift mandrel");
    if (mandrels.length) gaps.push(`Tubing: ${mandrels.length} gas-lift mandrels open it to the annulus through their valves, whose check function is not specified`);
    if (ssv) primary.push({ id: ssv.id, name: ssv.name, kind: "safety-valve", topM: ssv.topDepthM, bottomM: ssv.bottomDepthM, componentId: ssv.id, status: statusOf(input.provenance), evidence: `${ssv.material ?? "not reported"} · ${source(ssv, input.provenance)}` });
    else gaps.push("Subsurface safety valve: not in the records");
    secondary.push(casingElement(production, input, "above-packer", 0, packer.topDepthM), cementElement(production, input, gaps));
    secondary.push(surfaceElement("wellhead", input.components, input, gaps, "Wellhead"), surfaceElement("valve", input.components, input, gaps, "Christmas tree"));
    return { phase: input.phase, primary, secondary, shared: [], gaps };
  }
  // No tubing: the casing itself carries the well's pressure.
  primary.push(casingElement(production, input, "body"), cementElement(production, input, gaps));
  const head = surfaceElement("wellhead", input.components, input, gaps, "Wellhead");
  const valves = input.components.filter((component) => component.kind === "Valve");
  primary.push(head, surfaceElement("valve", input.components, input, gaps, "Master valve"));
  if (valves.length < 2) gaps.push(`Surface: ${valves.length} valve${valves.length === 1 ? "" : "s"} on record, so no second valve stands behind the master valve`);
  const outer = casings.at(-2);
  if (outer) secondary.push(casingElement(outer, input, "body"), cementElement(outer, input, gaps));
  else gaps.push("No casing outside the production casing");
  secondary.push(head);
  return { phase: input.phase, primary, secondary, shared: [head.name], gaps };
}
