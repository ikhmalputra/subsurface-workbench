import sProfileData from "./s-profile-data.json" with { type: "json" };
import researchData from "./research-profile-data.json" with { type: "json" };
import forgeData from "./forge-data.json" with { type: "json" };
import { surveyPointAtMd } from "./trajectory.ts";
export * from "./contracts.ts";
export * from "./state.ts";
export * from "./state-url.ts";
export * from "./crs.ts";
export * from "./interpretation.ts";
export * from "./units.ts";
export * from "./frames.ts";

export interface SurveyPoint {
  readonly mdM: number;
  readonly tvdM: number;
  readonly eastingM: number;
  readonly northingM: number;
  readonly inclinationDeg: number;
  readonly azimuthDeg: number;
  readonly sourceRow?: number;
  readonly rawMdFt?: number;
  readonly rawTvdFt?: number;
}

export interface FormationLayer {
  readonly id: string;
  readonly name: string;
  readonly lithology: string;
  readonly topTvdM: number;
  readonly bottomTvdM: number;
  readonly densityKgM3: number | null;
  readonly porosityPct: number | null;
  readonly color: string;
  readonly sourceUrl?: string;
  readonly interpretation?: string;
}

export interface WellDesign {
  readonly id: string;
  readonly revision: number;
  readonly casingBottomM: number;
  readonly totalDepthM: number;
  readonly units: "m";
  readonly provenance: "synthetic" | "documented" | "user-authored";
  readonly wellName?: string;
  readonly surveyStatus?: "observed" | "planned";
  readonly trajectoryNote?: string;
  readonly survey?: readonly SurveyPoint[];
  readonly depthDatum?: string;
  readonly referenceElevationMslM?: number;
  readonly formations?: readonly FormationLayer[];
  readonly trajectoryName?: string;
  readonly trajectorySource?: string;
  readonly components?: readonly WellComponent[];
  readonly groundTvdM?: number;
  readonly reportedTotalDepthFt?: number;
  readonly surveyCoverageFt?: number;
  readonly coverageNote?: string;
  readonly attribution?: string;
  readonly license?: string;
}

const exampleFormations: readonly FormationLayer[] = Object.freeze([
  { id: "air", name: "Air gap", lithology: "Air", topTvdM: 0, bottomTvdM: 30, densityKgM3: 1.225, porosityPct: null, color: "#edf4f6" },
  { id: "water", name: "Water column", lithology: "Seawater", topTvdM: 30, bottomTvdM: 150, densityKgM3: 1025, porosityPct: null, color: "#c8e3ef" },
  { id: "shale", name: "Shale formation", lithology: "Shale", topTvdM: 150, bottomTvdM: 650, densityKgM3: 2500, porosityPct: 8, color: "#dce5dd" },
  { id: "sandstone", name: "Sandstone formation", lithology: "Sandstone", topTvdM: 650, bottomTvdM: 1300, densityKgM3: 2350, porosityPct: 22, color: "#e9dfba" },
  { id: "limestone", name: "Limestone formation", lithology: "Limestone", topTvdM: 1300, bottomTvdM: 1900, densityKgM3: 2700, porosityPct: 12, color: "#e1deeb" },
  { id: "basement", name: "Basement formation", lithology: "Crystalline basement", topTvdM: 1900, bottomTvdM: 2600, densityKgM3: 2800, porosityPct: 2, color: "#d8dddf" },
].map((layer) => Object.freeze(layer)));

const syntheticBase: Readonly<WellDesign> = Object.freeze({
  id: "synthetic-well-01",
  revision: 1,
  casingBottomM: 1800,
  totalDepthM: 2600,
  units: "m",
  provenance: "synthetic",
  depthDatum: "RKB",
  referenceElevationMslM: 30,
  formations: exampleFormations,
});

export const sProfileDesign: Readonly<WellDesign> = Object.freeze({
  ...syntheticBase,
  id: "synthetic-s-profile-01",
  trajectoryName: sProfileData.shape,
  trajectorySource: sProfileData.source,
  survey: Object.freeze(sProfileData.stations.map((station) => Object.freeze(station))),
});

export const researchDesign: Readonly<WellDesign> = Object.freeze({
  ...syntheticBase,
  id: "open-research-reference-01",
  totalDepthM: researchData.stations.at(-1)!.mdM,
  trajectoryName: researchData.shape,
  trajectorySource: researchData.source,
  survey: Object.freeze(researchData.stations.map((station) => Object.freeze(station))),
});

export type ComponentId = string;
export type ComponentKind = "Cement" | "Casing" | "Tubular" | "Connection" | "Wellhead" | "Coupling" | "Casing joint" | "Tubing joint" | "Casing coupling" | "Tubing coupling" | "Centralizer" | "Packer" | "Safety valve" | "Gas lift mandrel" | "Gauge" | "Landing nipple" | "Hole" | "Valve";

export interface WellComponent {
  readonly id: ComponentId;
  readonly name: string;
  readonly kind: ComponentKind;
  readonly material: string;
  readonly outerDiameterMm: number | null;
  readonly innerDiameterMm: number | null;
  readonly topDepthM: number;
  readonly bottomDepthM: number;
  readonly description: string;
  readonly parentId?: ComponentId;
  readonly sourceUrl?: string;
  readonly sourcePage?: number;
  readonly rawBottomDepthFt?: number | null;
  readonly topDepthReported?: boolean;
}

export const forgeDesign: Readonly<WellDesign> = Object.freeze({
  ...forgeData,
  units: "m",
  provenance: "documented",
  components: Object.freeze(forgeData.components.map((component) => Object.freeze({ ...component, kind: component.kind as ComponentKind }))),
  survey: Object.freeze(forgeData.survey.map((station) => Object.freeze(station))),
  formations: Object.freeze(forgeData.formations.map((layer) => Object.freeze(layer))),
});

export function getWellComponents(design: WellDesign): readonly WellComponent[] {
  if (design.components) return Object.freeze(design.components.map((component) => Object.freeze({ ...component })));
  if (design.provenance === "documented") return Object.freeze([]);
  const collars: WellComponent[] = [0, 0.32, 0.64, 0.99].map((fraction, index) => {
    const center = Math.round(design.casingBottomM * fraction);
    return { id: `connection-${index + 1}` as ComponentId, name: `Connection ${index + 1}`, kind: "Connection", material: "P110 steel / threaded", outerDiameterMm: 269.9, innerDiameterMm: 220.5, topDepthM: Math.max(0, center - 5), bottomDepthM: Math.min(design.casingBottomM, center + 5), description: "Illustrative threaded collar joining adjacent casing joints. Rating and torque values are not certified." };
  });
  const components: WellComponent[] = [
    { id: "cement", name: "Cement sheath", kind: "Cement", material: "Class G cement", outerDiameterMm: 311.2, innerDiameterMm: 244.5, topDepthM: 120, bottomDepthM: design.casingBottomM, description: "Synthetic annular cement interval for casing support and isolation. No bond-log or placement-quality evidence is supplied." },
    { id: "casing", name: "Casing section", kind: "Casing", material: "P110 steel", outerDiameterMm: 244.5, innerDiameterMm: 220.5, topDepthM: 0, bottomDepthM: design.casingBottomM, description: "Synthetic 9 5/8-inch casing interval. Burst, collapse and installation checks are not calculated." },
    { id: "tubular", name: "Inner tubular", kind: "Tubular", material: "L80 steel", outerDiameterMm: 114.3, innerDiameterMm: 100.5, topDepthM: 0, bottomDepthM: design.totalDepthM - 100, description: "Synthetic 4 1/2-inch inner string. Displayed dimensions are example values, not a manufacturer specification." },
    ...collars,
    { id: "wellhead", name: "Wellhead flange", kind: "Wellhead", material: "Forged steel", outerDiameterMm: 420, innerDiameterMm: 114.3, topDepthM: 0, bottomDepthM: 0, description: "Surface flange reference. No pressure rating, seal test or barrier certification is attached." },
    { id: "coupling", name: "Top coupling", kind: "Coupling", material: "P110 steel / threaded", outerDiameterMm: 193.7, innerDiameterMm: 114.3, topDepthM: 0, bottomDepthM: 0, description: "Illustrative top tubular connection. Reference geometry is exaggerated for inspection." },
  ];
  for (const string of [
    { parentId: "casing", prefix: "Casing", end: design.casingBottomM, outside: 244.5, inside: 220.5, material: "P110 steel" },
    { parentId: "tubular", prefix: "Tubing", end: design.totalDepthM - 100, outside: 114.3, inside: 100.5, material: "L80 steel" },
  ]) {
    const quantity = Math.ceil(string.end / 12);
    for (let index = 0; index < quantity; index++) {
      const top = index * 12;
      const bottom = Math.min(top + 12, string.end);
      components.push({ id: `${string.parentId}-joint-${index + 1}`, name: `${string.prefix} joint ${index + 1}`, kind: string.prefix === "Casing" ? "Casing joint" : "Tubing joint", material: string.material, outerDiameterMm: string.outside, innerDiameterMm: string.inside, topDepthM: top, bottomDepthM: bottom, parentId: string.parentId, description: "Individual synthetic tally interval; nominal joint length 12 m, final interval trimmed at string end. No actual manufacturing serial or inspection record." });
      if (index < quantity - 1) components.push({ id: `${string.parentId}-coupling-${index + 1}`, name: `${string.prefix} coupling ${index + 1}`, kind: string.prefix === "Casing" ? "Casing coupling" : "Tubing coupling", material: `${string.material} / threaded`, outerDiameterMm: string.outside + 12, innerDiameterMm: string.inside, topDepthM: bottom - 0.2, bottomDepthM: bottom + 0.2, parentId: string.parentId, description: "Synthetic connection instance at this joint boundary. No certified pressure or make-up torque data." });
    }
  }
  for (let position = 120; position < design.casingBottomM; position += 120) {
    components.push({ id: `centralizer-${position}`, name: `Centralizer at ${position} m`, kind: "Centralizer", material: "Spring steel", outerDiameterMm: 300, innerDiameterMm: 244.5, topDepthM: position - 0.5, bottomDepthM: position + 0.5, parentId: "casing", description: "Synthetic bow-spring centralizer instance, not a cement-placement verification." });
  }
  const tools: { id: string; name: string; kind: ComponentKind; depth: number; material: string }[] = [
    { id: "safety-valve", name: "Subsurface safety valve", kind: "Safety valve", depth: 180, material: "13Cr steel" },
    { id: "packer", name: "Production packer", kind: "Packer", depth: 1650, material: "Steel / elastomer" },
    { id: "mandrel-1", name: "Gas lift mandrel 1", kind: "Gas lift mandrel", depth: 600, material: "L80 steel" },
    { id: "mandrel-2", name: "Gas lift mandrel 2", kind: "Gas lift mandrel", depth: 1000, material: "L80 steel" },
    { id: "mandrel-3", name: "Gas lift mandrel 3", kind: "Gas lift mandrel", depth: 1400, material: "L80 steel" },
    { id: "pressure-gauge", name: "Downhole pressure gauge", kind: "Gauge", depth: 1700, material: "Inconel housing" },
    { id: "landing-nipple", name: "Landing nipple", kind: "Landing nipple", depth: 1750, material: "L80 steel" },
  ];
  for (const tool of tools) {
    if (tool.depth + 1 <= design.totalDepthM - 100) components.push({ id: tool.id, name: tool.name, kind: tool.kind, material: tool.material, outerDiameterMm: 150, innerDiameterMm: 90, topDepthM: tool.depth, bottomDepthM: tool.depth + 1, parentId: "tubular", description: "Synthetic equipment instance for selection and tally workflows; no operational rating or barrier approval." });
  }
  return Object.freeze(components.map((component) => Object.freeze(component)));
}

export function positionAtMeasuredDepth(design: WellDesign, mdM: number): SurveyPoint {
  if (!Number.isFinite(mdM) || mdM < 0 || mdM > design.totalDepthM) throw new RangeError("Measured depth outside the well interval.");
  if (!design.survey) return { mdM, tvdM: mdM, eastingM: 0, northingM: 0, inclinationDeg: 0, azimuthDeg: 0 };
  return surveyPointAtMd(design.survey, mdM);
}
export * from "./assembly.ts";
export * from "./trajectory.ts";
export * from "./well-design.ts";
export * from "./records.ts";
export * from "./offset-wells.ts";
export * from "./seismic.ts";
