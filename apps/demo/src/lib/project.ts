import { forgeDesign, forgeOperations, forgeSeismicSection, getWellComponents, researchDesign, sProfileDesign } from "@ikhmalputra/subsurface-core";
import type { SeismicSectionMetadata, WellComponent, WellDesign, WellOperations } from "@ikhmalputra/subsurface-core";
import { validatePetrophysicsWell } from "@ikhmalputra/subsurface-core/contracts";
import type { PetrophysicsWell, ProductionSurveillanceDocument } from "@ikhmalputra/subsurface-core/contracts";

/**
 * One project; wells that declare what data they carry.
 *
 * Datasets used to live inside route components — the petrophysics curves inside
 * petrophysics-demo, the production document inside production-surveillance-demo — which is why
 * those views could not be combined with anything: their data was not well data. Here a well owns
 * its data and a view is offered when the well has what the view needs.
 *
 * Availability is therefore a property of the data, never of the route name. Today /production/ is
 * hidden behind "no compatible dataset for this well" even though its document is keyed to the
 * s-profile well in this very list, and /builder/ silently ignores the active well with no notice
 * at all. Both are routing accidents, and `wellCapabilities` replaces both with a fact.
 */

/** Something a well can support. Each maps to views that need that data to mean anything. */
export type Capability =
  | "construction"   // components and an assembly: schematic, 3D cutaway, inventory
  | "survey"         // stations: trajectory plan/section/log, curved schematic, 3D well
  | "formations"     // TVD-keyed layers: geology on drawings and sections
  | "operations"     // daily reports, service runs, hole sections, days-vs-depth
  | "mudLog"         // a LAS file, indexed in FEET
  | "seismic"        // a SEG-Y section, and optionally a sub-volume for the 3D scene
  | "petrophysics"   // validated curves: log view, crossplot, histogram, zones
  | "production"     // a time-indexed surveillance document
  | "report";        // enough sourced records to assemble an as-drilled report

export interface ProjectWell {
  readonly id: string;
  readonly label: string;
  readonly design: WellDesign;
  readonly components: readonly WellComponent[];
  readonly operations?: WellOperations;
  /** LAS, depth-indexed in feet. The depth bridge converts at the host boundary. */
  readonly logUrl?: string;
  readonly seismic?: { readonly url: string; readonly meta: SeismicSectionMetadata };
  readonly petrophysics?: PetrophysicsWell;
  readonly production?: ProductionSurveillanceDocument;
}

/**
 * Derived from the data, so a view can never be offered for a well that cannot supply it, and can
 * never be withheld from one that can.
 */
export function wellCapabilities(well: ProjectWell): Readonly<Record<Capability, boolean>> {
  return Object.freeze({
    construction: well.components.length > 0,
    survey: (well.design.survey?.length ?? 0) > 1,
    formations: (well.design.formations?.length ?? 0) > 0,
    operations: Boolean(well.operations && well.operations.days.length > 0),
    mudLog: Boolean(well.logUrl),
    seismic: Boolean(well.seismic),
    petrophysics: Boolean(well.petrophysics),
    production: Boolean(well.production),
    // The report renders cited source records; a synthetic well has none to cite.
    report: well.design.provenance === "documented" && well.components.length > 0,
  });
}

export function hasCapability(well: ProjectWell, capability: Capability): boolean {
  return wellCapabilities(well)[capability];
}

/** Lifted verbatim from petrophysics-demo so the curves belong to a well rather than a page. */
function syntheticPetrophysics(wellId: string, depthOffsetM = 0): PetrophysicsWell {
  const depthsMdM = Float64Array.from({ length: 121 }, (_, index) => 1000 + depthOffsetM + index * 5);
  const gammaRay = Float32Array.from(depthsMdM, (_, index) => index >= 55 && index <= 59 ? -999.25 : 52 + 28 * Math.sin(index / 9) + (index > 70 ? 34 : 0));
  const porosity = Float32Array.from(depthsMdM, (_, index) => index >= 88 && index <= 91 ? -999.25 : 0.19 + 0.07 * Math.sin(index / 13) - (index > 72 && index < 92 ? 0.025 : 0));
  const density = Float32Array.from(depthsMdM, (_, index) => 2.55 - 0.34 * Math.sin(index / 13) + (index > 72 && index < 92 ? 0.12 : 0));
  const resistivity = Float32Array.from(depthsMdM, (_, index) => 2 ** (2 + 1.8 * Math.sin(index / 15)));
  const sonic = Float32Array.from(depthsMdM, (_, index) => 78 + 16 * Math.sin(index / 15));
  const reference = { kind: "MD" as const, unit: "m" as const, datum: "RKB" };
  return validatePetrophysicsWell({
    version: 1, wellId, depthReference: reference, provenance: "synthetic",
    curves: [
      { version: 1, id: `curve-gr-${wellId}`, wellId, mnemonic: "GR", name: "Gamma ray", unit: "API", depthReference: reference, depthsMdM, values: gammaRay, nullValue: -999.25 },
      { version: 1, id: `curve-nphi-${wellId}`, wellId, mnemonic: "NPHI", name: "Neutron porosity", unit: "v/v", depthReference: reference, depthsMdM, values: porosity, nullValue: -999.25 },
      { version: 1, id: `curve-rhob-${wellId}`, wellId, mnemonic: "RHOB", name: "Bulk density", unit: "g/cm3", depthReference: reference, depthsMdM, values: density, nullValue: null },
      { version: 1, id: `curve-rt-${wellId}`, wellId, mnemonic: "RT", name: "Deep resistivity", unit: "ohm.m", depthReference: reference, depthsMdM, values: resistivity, nullValue: null },
      { version: 1, id: `curve-dt-${wellId}`, wellId, mnemonic: "DT", name: "Sonic slowness", unit: "us/ft", depthReference: reference, depthsMdM, values: sonic, nullValue: null },
    ],
    zones: [
      { id: `zone-upper-${wellId}`, name: "Upper interval", topMdM: 1000 + depthOffsetM, baseMdM: 1350 + depthOffsetM, lithology: "host-labelled zone", color: "#88a9bd" },
      { id: `zone-lower-${wellId}`, name: "Lower interval", topMdM: 1350 + depthOffsetM, baseMdM: 1600 + depthOffsetM, lithology: "host-labelled zone", color: "#ceb67a" },
    ],
    tops: [
      { id: "top-upper", name: "Top upper interval", mdM: 1000 + depthOffsetM },
      { id: "top-lower", name: "Top lower interval", mdM: 1350 + depthOffsetM },
    ],
    corePoints: [
      { id: `core-01-${wellId}`, mdM: 1180 + depthOffsetM, label: "Synthetic core point A", description: "Illustrative marker only", measurements: [{ id: `porosity-a-${wellId}`, mnemonic: "POR", value: 0.21, unit: "v/v" }, { id: `permeability-a-${wellId}`, mnemonic: "PERM", value: 125, unit: "mD" }] },
      { id: `core-02-${wellId}`, mdM: 1475 + depthOffsetM, label: "Synthetic core point B", description: null, measurements: [{ id: `porosity-b-${wellId}`, mnemonic: "POR", value: null, unit: "v/v" }] },
    ],
  });
}

/** Lifted verbatim from production-surveillance-demo. Its wellId already matched the s-profile well. */
function syntheticProduction(wellId: string, wellLabel: string): ProductionSurveillanceDocument {
  const start = Date.UTC(2025, 0, 1);
  const day = 86_400_000;
  const rates = [
    [18.2, 2.1, 1250], [18.8, 2.2, 1290], [19.1, 2.4, 1310], [null, null, null],
    [18.6, 2.5, 1270], [17.9, 2.8, 1210], [17.4, 3.1, 1190], [17.8, 3.0, 1205],
    [18.1, 2.9, 1235], [18.5, 2.8, 1260], [18.9, 2.7, 1300], [19.2, 2.6, 1330],
    [18.7, 2.5, 1295], [18.3, 2.4, 1275],
  ] as const;
  return {
    version: 1, id: `${wellId}-production`, wellId, wellLabel, provenance: "synthetic",
    source: "Generated demonstration fixture; not measured production history",
    dataset: {
      version: 1, id: `${wellId}-production-observations`, assetId: `asset:${wellId}`, wellId,
      key: { kind: "time", unit: "unix-ms", timeZone: "UTC" },
      sampleIds: rates.map((_, index) => `synthetic-daily-observation-${index + 1}`),
      keyValues: Float64Array.from(rates.map((_, index) => start + index * day)),
      columns: [
        { id: "oil-rate", label: "Oil rate", unit: "m3/d", values: Float32Array.from(rates.map((row) => row[0] ?? Number.NaN)), nullValue: "nan" },
        { id: "water-rate", label: "Water rate", unit: "m3/d", values: Float32Array.from(rates.map((row) => row[1] ?? Number.NaN)), nullValue: "nan" },
        { id: "gas-rate", label: "Gas rate", unit: "m3/d", values: Float32Array.from(rates.map((row) => row[2] ?? Number.NaN)), nullValue: "nan" },
      ],
      reference: null, spatialXYZ: null,
    },
    events: [
      { id: "synthetic-production-start", kind: "production", startTimeMs: start, endTimeMs: null, mdM: 1730, componentId: null, summary: "Production observations begin", source: "Synthetic demonstration fixture" },
      { id: "synthetic-test", kind: "production-test", startTimeMs: start + 4 * day, endTimeMs: start + 5 * day, mdM: 1840, componentId: null, summary: "Production test", source: "Synthetic demonstration fixture" },
      { id: "synthetic-shutin", kind: "shut-in", startTimeMs: start + 8 * day, endTimeMs: start + 9 * day, mdM: null, componentId: null, summary: "Well shut in for surveillance", source: "Synthetic demonstration fixture" },
      { id: "synthetic-survey", kind: "surveillance", startTimeMs: start + 12 * day, endTimeMs: null, mdM: 1765, componentId: null, summary: "Downhole surveillance observation", source: "Synthetic demonstration fixture" },
    ],
  };
}

function wellOf(id: string, label: string, design: WellDesign, extra: Partial<ProjectWell> = {}): ProjectWell {
  return Object.freeze({ id, label, design, components: getWellComponents(design), ...extra });
}

/**
 * The project. FORGE is the only documented well; the rest are explicitly synthetic, and the
 * capability table makes the unevenness visible rather than hiding it behind route gates.
 */
export const projectWells: readonly ProjectWell[] = Object.freeze([
  wellOf("forge", "Utah FORGE 16A(78)-32 · documented", forgeDesign, {
    operations: forgeOperations,
    logUrl: "/data/forge-16a-mudlog-10ft.las",
    seismic: { url: `/data/${forgeSeismicSection.section.file}`, meta: forgeSeismicSection },
  }),
  wellOf("s-profile", "S-profile completion · synthetic", sProfileDesign, {
    petrophysics: syntheticPetrophysics(sProfileDesign.id),
    production: syntheticProduction(sProfileDesign.id, "S-profile completion · synthetic"),
  }),
  wellOf("research", "Open research reference · synthetic", researchDesign, {
    petrophysics: syntheticPetrophysics(researchDesign.id, 100),
  }),
]);

export function projectWell(id: string): ProjectWell {
  const found = projectWells.find((well) => well.id === id || well.design.id === id);
  if (!found) throw new Error(`Unknown project well: ${id}`);
  return found;
}
