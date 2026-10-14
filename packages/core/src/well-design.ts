import { createAssembly, placeComponent, updateComponent, validateAssembly } from "./assembly.ts";
import type { WellAssembly } from "./assembly.ts";
import { computeMinimumCurvature, planBuildHold, surveyPointAtMd } from "./trajectory.ts";
import type { BuildHoldInput, SurveyStationInput } from "./trajectory.ts";

/**
 * Data-first well design: the brief an engineer fills in before any equipment is drawn,
 * and the engineering checks that turn it into a casing and completion scheme.
 *
 * Units: depths in metres (MD along hole, TVD below the depth reference), pressure gradients
 * and fluid densities as specific gravity (SG, 1.0 = fresh water), pressures in psi,
 * pipe sizes in inches and weights in lb/ft, the units casing is catalogued in.
 * Pipe ratings follow API TR 5C3 / ISO 10400 (burst with the 87.5% wall tolerance, the four
 * collapse regimes, and pipe-body yield strength). Loads are simplified screening cases and
 * not a replacement for a full casing-design package.
 */

/** psi per metre of TVD for a 1.0 SG fluid (0.433 psi/ft). */
export const PSI_PER_M_PER_SG = 1.42233;
export const STEEL_SG = 7.85;
export const SEAWATER_SG = 1.03;
/** Gas gradient used in gas-to-surface loads, 0.1 psi/ft. */
export const GAS_GRADIENT_SG = 0.23;
export const M3_TO_BBL = 6.2898;
const IN2_M_TO_M3 = 0.00064516;
const FT_PER_M = 3.28084;
/**
 * Fractional loss of minimum yield strength per °C above 20 °C for carbon and low-alloy casing steels
 * (≈ 0.03 %/°F, the value commonly used when mill elevated-temperature data are not available).
 */
export const YIELD_DERATING_PER_C = 0.00054;
export const yieldDerating = (temperatureC: number) => Math.max(0.7, 1 - YIELD_DERATING_PER_C * Math.max(0, temperatureC - 20));

export const steelGrades: Readonly<Record<string, number>> = Object.freeze({ H40: 40000, J55: 55000, K55: 55000, N80: 80000, L80: 80000, C90: 90000, T95: 95000, P110: 110000, Q125: 125000 });

export interface PipeSize {
  readonly odIn: number;
  readonly weightLbFt: number;
  readonly wallIn: number;
  readonly idIn: number;
  /** API drift diameter: the largest bit or tool guaranteed to pass. */
  readonly driftIn: number;
  /** API 5CT alternate (special) drift, where the size has one; a bit up to this size passes special-drift pipe. */
  readonly alternateDriftIn?: number;
  readonly couplingOdIn: number;
}

// API 5CT drift mandrels: ID − 1/8 in below 9-5/8 in; ID − 5/32 in for 9-5/8 to 13-3/8 in; ID − 3/16 in from 16 in.
const casingDrift = (odIn: number, idIn: number) => idIn - (odIn < 9.625 ? 0.125 : odIn <= 13.375 ? 0.15625 : 0.1875);
const couplingOd: Readonly<Record<string, number>> = { "30": 31, "20": 21, "18.625": 20, "16": 17, "13.375": 14.375, "10.75": 11.75, "9.625": 10.625, "7.625": 8.5, "7": 7.656, "5.5": 6.05, "4.5": 5 };
const casingRow = (odIn: number, weightLbFt: number, wallIn: number, idIn: number, alternateDriftIn?: number): PipeSize => Object.freeze({ odIn, weightLbFt, wallIn, idIn, driftIn: Number(casingDrift(odIn, idIn).toFixed(3)), ...(alternateDriftIn ? { alternateDriftIn } : {}), couplingOdIn: couplingOd[String(odIn)] ?? odIn * 1.1 });

/** API 5CT casing sizes used by the scheme proposer (nominal OD, weight, wall and ID). */
export const casingTable: readonly PipeSize[] = Object.freeze([
  casingRow(30, 309.7, 1, 28),
  casingRow(20, 94, 0.438, 19.124), casingRow(20, 133, 0.635, 18.73),
  casingRow(18.625, 87.5, 0.435, 17.755),
  casingRow(16, 75, 0.438, 15.124), casingRow(16, 84, 0.495, 15.01),
  casingRow(13.375, 54.5, 0.38, 12.615), casingRow(13.375, 61, 0.43, 12.515), casingRow(13.375, 68, 0.48, 12.415), casingRow(13.375, 72, 0.514, 12.347, 12.25),
  casingRow(10.75, 45.5, 0.4, 9.95), casingRow(10.75, 51, 0.45, 9.85),
  casingRow(9.625, 36, 0.352, 8.921), casingRow(9.625, 40, 0.395, 8.835, 8.75), casingRow(9.625, 43.5, 0.435, 8.755), casingRow(9.625, 47, 0.472, 8.681), casingRow(9.625, 53.5, 0.545, 8.535, 8.5),
  casingRow(7.625, 29.7, 0.375, 6.875), casingRow(7.625, 33.7, 0.43, 6.765),
  casingRow(7, 23, 0.317, 6.366), casingRow(7, 26, 0.362, 6.276), casingRow(7, 29, 0.408, 6.184), casingRow(7, 32, 0.453, 6.094, 6), casingRow(7, 35, 0.498, 6.004), casingRow(7, 38, 0.54, 5.92),
  casingRow(5.5, 17, 0.304, 4.892), casingRow(5.5, 20, 0.361, 4.778), casingRow(5.5, 23, 0.415, 4.67),
  casingRow(4.5, 11.6, 0.25, 4), casingRow(4.5, 13.5, 0.29, 3.92),
]);

const tubingRow = (odIn: number, weightLbFt: number, wallIn: number, idIn: number, couplingOdIn: number): PipeSize => Object.freeze({ odIn, weightLbFt, wallIn, idIn, driftIn: Number((idIn - (odIn <= 2.875 ? 0.094 : 0.125)).toFixed(3)), couplingOdIn });
export const tubingTable: readonly PipeSize[] = Object.freeze([
  tubingRow(2.375, 4.7, 0.19, 1.995, 3.063), tubingRow(2.875, 6.5, 0.217, 2.441, 3.668), tubingRow(3.5, 9.3, 0.254, 2.992, 4.5), tubingRow(4.5, 12.6, 0.271, 3.958, 5.563),
]);

/** Bit size conventionally drilled for each casing OD. */
export const standardHoleSizes: Readonly<Record<string, number>> = Object.freeze({ "30": 36, "20": 26, "18.625": 22, "16": 20, "13.375": 17.5, "10.75": 14.75, "9.625": 12.25, "7.625": 9.875, "7": 8.5, "5.5": 7.875, "4.5": 6 });
export const standardHoleSize = (odIn: number) => standardHoleSizes[String(odIn)] ?? Math.round((odIn + 1.5) * 8) / 8;

export function findPipe(odIn: number, weightLbFt: number, table: readonly PipeSize[] = casingTable): PipeSize | undefined {
  return table.find((row) => Math.abs(row.odIn - odIn) < 1e-6 && Math.abs(row.weightLbFt - weightLbFt) < 1e-6);
}

export type CollapseRegime = "yield" | "plastic" | "transition" | "elastic";
export interface PipeRatings {
  readonly burstPsi: number;
  readonly collapsePsi: number;
  readonly collapseRegime: CollapseRegime;
  readonly bodyYieldLbf: number;
  readonly dOverT: number;
  readonly yieldPsi: number;
}

const round10 = (value: number) => Math.round(value / 10) * 10;
const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * API TR 5C3 burst (Barlow, 87.5% wall), four-regime collapse and pipe-body yield for one pipe.
 * `yieldPsi` replaces the grade's minimum yield: pass a temperature-derated yield, or the
 * axial-stress-reduced yield of API TR 5C3 for combined tension and collapse.
 */
export function pipeRatings(odIn: number, wallIn: number, grade: string, yieldPsi?: number): PipeRatings {
  const Yp = yieldPsi ?? steelGrades[grade];
  if (Yp === undefined) throw new RangeError(`Unknown steel grade: ${grade}`);
  if (!(Yp > 0)) throw new RangeError("Yield strength must be positive.");
  if (!(odIn > 0) || !(wallIn > 0) || wallIn * 2 >= odIn) throw new RangeError("Wall thickness must be positive and less than half the OD.");
  const r = odIn / wallIn;
  const A = 2.8762 + 0.10679e-5 * Yp + 0.21301e-10 * Yp ** 2 - 0.53132e-16 * Yp ** 3;
  const B = 0.026233 + 0.50609e-6 * Yp;
  const C = -465.93 + 0.030867 * Yp - 0.10483e-7 * Yp ** 2 + 0.36989e-13 * Yp ** 3;
  const ba = B / A;
  const k = 3 * ba / (2 + ba);
  const F = 46.95e6 * k ** 3 / (Yp * (k - ba) * (1 - k) ** 2);
  const G = F * ba;
  const yieldPlastic = (Math.sqrt((A - 2) ** 2 + 8 * (B + C / Yp)) + (A - 2)) / (2 * (B + C / Yp));
  const plasticTransition = Yp * (A - F) / (C + Yp * (B - G));
  const transitionElastic = (2 + ba) / (3 * ba);
  let collapse: number;
  let regime: CollapseRegime;
  if (r <= yieldPlastic) { collapse = 2 * Yp * (r - 1) / r ** 2; regime = "yield"; }
  else if (r <= plasticTransition) { collapse = Yp * (A / r - B) - C; regime = "plastic"; }
  else if (r <= transitionElastic) { collapse = Yp * (F / r - G); regime = "transition"; }
  else { collapse = 46.95e6 / (r * (r - 1) ** 2); regime = "elastic"; }
  const id = odIn - 2 * wallIn;
  return Object.freeze({ burstPsi: round10(0.875 * 2 * Yp * wallIn / odIn), collapsePsi: round10(collapse), collapseRegime: regime, bodyYieldLbf: Math.round(Yp * Math.PI / 4 * (odIn ** 2 - id ** 2) / 1000) * 1000, dOverT: round2(r), yieldPsi: Yp });
}

export const hydrostaticPsi = (densitySg: number, tvdM: number) => densitySg * PSI_PER_M_PER_SG * tvdM;
export const sgToPpg = (sg: number) => sg * 8.345;

export type WellEnvironment = "onshore" | "offshore-platform" | "offshore-subsea";
export type DepthReference = "RKB" | "DF" | "GL" | "MSL";
export type WellPurpose = "exploration" | "appraisal" | "development" | "injection" | "disposal" | "geothermal";
export type SectionRole = "conductor" | "surface" | "intermediate" | "production" | "liner" | "tieback";
export type ArtificialLift = "none" | "gas-lift" | "esp" | "rod-pump" | "pcp" | "jet-pump";

export interface Formation {
  readonly name: string;
  readonly topTvdM: number;
  readonly lithology: string;
  readonly reservoir?: boolean;
  /** Drilling hazard to plan for: shallow gas, losses, salt, H2S, unstable shale … */
  readonly hazard?: string;
}

/**
 * Where a number came from. `measured` on this well or its pilot (RFT/MDT, LOT/FIT, logged temperature);
 * `offset` taken from an offset well; `estimated` from a model or regional trend; `assumed` a placeholder
 * nobody has checked. Readiness treats `assumed` as not yet provided.
 */
export type InputSource = "measured" | "offset" | "estimated" | "assumed";

export interface PressurePoint {
  readonly tvdM: number;
  readonly porePressureSg: number;
  readonly fractureGradientSg: number;
  readonly poreSource?: InputSource;
  readonly fractureSource?: InputSource;
  /** Evidence behind the point, e.g. "FIT 9.5 ppg at 1,644 ft, offset 16A". */
  readonly note?: string;
}

/** A formation integrity or leak-off test. A FIT that did not leak off is a lower bound on fracture strength. */
export interface IntegrityTest {
  readonly kind: "FIT" | "LOT" | "XLOT";
  readonly tvdM: number;
  readonly emwSg: number;
  /** True when the test reached leak-off (LOT/XLOT); false for a FIT held without breakdown. */
  readonly reachedLeakOff: boolean;
  readonly source: string;
}

export type ReservoirFluid = "oil" | "gas" | "condensate" | "water" | "geothermal" | "co2";
/** Produced or injected fluid: drives sour-service (NACE MR0175 / ISO 15156) and CO2 corrosion checks. */
export interface FluidData {
  readonly type: ReservoirFluid;
  /** H2S mole percent in the gas phase; null when not yet sampled. */
  readonly h2sMolPct: number | null;
  readonly co2MolPct: number | null;
  readonly source?: InputSource;
}

/** Design basis an engineer signs off: kick size the shoes must take and casing-wear allowance. */
export interface DesignBasis {
  /** Kick intensity above the next section's mud weight, SG. Typical 0.05–0.12 (0.5–1.0 ppg). */
  readonly kickIntensitySg: number;
  /** Wall loss allowed for strings that are drilled through, percent of nominal wall. */
  readonly casingWearPct: number;
}
export const defaultDesignBasis: DesignBasis = Object.freeze({ kickIntensitySg: 0.06, casingWearPct: 0 });

export interface CementPlan {
  readonly topMdM: number;
  readonly leadDensitySg: number;
  readonly tailDensitySg: number;
  readonly tailLengthM: number;
  /** Open-hole volume excess for washouts, percent. */
  readonly excessPct: number;
}

export interface CasingSection {
  readonly id: string;
  readonly role: SectionRole;
  readonly label: string;
  readonly holeSizeIn: number;
  readonly odIn: number;
  readonly weightLbFt: number;
  readonly grade: string;
  readonly topMdM: number;
  readonly shoeMdM: number;
  /** Mud weight used to drill the hole this string is run into. */
  readonly mudWeightSg: number;
  readonly cement: CementPlan | null;
}

export interface CompletionPlan {
  readonly tubingOdIn: number;
  readonly tubingWeightLbFt: number;
  readonly tubingGrade: string;
  readonly packerMdM: number;
  readonly sssvMdM: number | null;
  readonly perforations: readonly { readonly topMdM: number; readonly bottomMdM: number }[];
  readonly artificialLift: ArtificialLift;
  readonly gasLiftMandrels?: number;
  /** Fluid left in the tubing–casing annulus above the packer, SG. Unset: the production string's mud weight is assumed, and the load case says so. */
  readonly packerFluidSg?: number;
}

export interface WellDesignBrief {
  readonly identity: { readonly name: string; readonly field: string; readonly operator: string; readonly country: string; readonly purpose: WellPurpose; readonly uwi?: string };
  readonly location: { readonly environment: WellEnvironment; readonly crs: string; readonly latitude: number | null; readonly longitude: number | null; readonly waterDepthM: number | null; readonly groundElevationM: number | null };
  readonly datum: { readonly reference: DepthReference; readonly elevationAboveMslM: number | null };
  readonly geology: {
    readonly formations: readonly Formation[];
    readonly pressures: readonly PressurePoint[];
    readonly surfaceTemperatureC: number;
    readonly geothermalGradientCPerKm: number;
    /** Where the temperature profile came from; `assumed` until someone supplies data. */
    readonly temperatureSource?: InputSource;
    readonly temperatureNote?: string;
    readonly integrityTests?: readonly IntegrityTest[];
  };
  /** Produced or injected fluid; null until sampled or taken from offsets. */
  readonly fluids?: FluidData | null;
  readonly basis?: DesignBasis;
  /** Set when sections or geology were taken from an offset well. */
  readonly origin?: { readonly offsetId: string; readonly offsetName: string; readonly parts: readonly ("geology" | "casing" | "completion")[] };
  /** Directional plan; null for a vertical well. */
  readonly trajectory: readonly SurveyStationInput[] | null;
  readonly totalDepthMdM: number;
  readonly sections: readonly CasingSection[];
  readonly completion: CompletionPlan | null;
}

export interface DesignFactors { readonly burst: number; readonly collapse: number; readonly tension: number }
export const defaultDesignFactors: DesignFactors = Object.freeze({ burst: 1.1, collapse: 1.0, tension: 1.6 });

export interface DesignIssue {
  readonly severity: "error" | "warning" | "info";
  readonly stage: DesignStage;
  readonly code: string;
  readonly message: string;
  readonly sectionId?: string;
}

/** TVD below the depth reference at a measured depth; MD for a vertical well. */
const surveyCache = new WeakMap<readonly SurveyStationInput[], ReturnType<typeof computeMinimumCurvature>>();
export function tvdAtMd(brief: Pick<WellDesignBrief, "trajectory">, mdM: number): number {
  if (!brief.trajectory || brief.trajectory.length < 2) return mdM;
  let survey = surveyCache.get(brief.trajectory);
  if (!survey) { survey = computeMinimumCurvature(brief.trajectory); surveyCache.set(brief.trajectory, survey); }
  const last = survey[survey.length - 1]!;
  if (mdM <= last.mdM) return surveyPointAtMd(survey, mdM).tvdM;
  return last.tvdM + (mdM - last.mdM) * Math.cos(last.inclinationDeg * Math.PI / 180);
}

/** Pore pressure and fracture gradient (SG equivalent) at a TVD, linearly interpolated and held constant beyond the data. */
export function pressureAt(brief: Pick<WellDesignBrief, "geology">, tvdM: number): { readonly porePressureSg: number; readonly fractureGradientSg: number } {
  const points = [...brief.geology.pressures].sort((a, b) => a.tvdM - b.tvdM);
  if (!points.length) return { porePressureSg: SEAWATER_SG, fractureGradientSg: 1.6 };
  if (tvdM <= points[0]!.tvdM) return { porePressureSg: points[0]!.porePressureSg, fractureGradientSg: points[0]!.fractureGradientSg };
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!, b = points[index]!;
    if (tvdM <= b.tvdM) {
      const t = (tvdM - a.tvdM) / Math.max(b.tvdM - a.tvdM, 1e-9);
      return { porePressureSg: a.porePressureSg + (b.porePressureSg - a.porePressureSg) * t, fractureGradientSg: a.fractureGradientSg + (b.fractureGradientSg - a.fractureGradientSg) * t };
    }
  }
  const tail = points[points.length - 1]!;
  return { porePressureSg: tail.porePressureSg, fractureGradientSg: tail.fractureGradientSg };
}

export const temperatureAt = (brief: Pick<WellDesignBrief, "geology">, tvdM: number) => brief.geology.surfaceTemperatureC + brief.geology.geothermalGradientCPerKm * tvdM / 1000;

/** Highest pore pressure (SG) over an MD interval, sampled every 10 m. */
function maxPore(brief: WellDesignBrief, fromMdM: number, toMdM: number) {
  let value = 0;
  for (let md = fromMdM; md <= toMdM + 1e-6; md += Math.max(10, (toMdM - fromMdM) / 200)) value = Math.max(value, pressureAt(brief, tvdAtMd(brief, md)).porePressureSg);
  return Math.max(value, pressureAt(brief, tvdAtMd(brief, toMdM)).porePressureSg);
}

function minFrac(brief: WellDesignBrief, fromMdM: number, toMdM: number) {
  let value = Infinity;
  for (let md = fromMdM; md <= toMdM + 1e-6; md += Math.max(10, (toMdM - fromMdM) / 200)) value = Math.min(value, pressureAt(brief, tvdAtMd(brief, md)).fractureGradientSg);
  return value;
}

export interface SchemeOptions {
  /** Overbalance above the highest pore pressure in the open hole (swab/trip margin). Default 0.03 SG ≈ 0.25 ppg. */
  readonly tripMarginSg?: number;
  /** Kick margin kept below the weakest fracture gradient. Default 0.06 SG ≈ 0.5 ppg. */
  readonly kickMarginSg?: number;
  /** Minimum surface-casing setting depth below the reference (aquifers, shallow hazards). Default 350 m. */
  readonly minimumSurfaceShoeM?: number;
  /** Production casing OD; drives every larger size up the chain. Default 7 in. */
  readonly productionOdIn?: number;
  readonly factors?: DesignFactors;
}

const sizeChain = [30, 20, 13.375, 9.625, 7, 4.5];
const fullChain = [30, 20, 16, 13.375, 10.75, 9.625, 7.625, 7, 5.5, 4.5];
/** Relative cost per lb/ft used to pick the cheapest passing pipe; an ordering, not a price list. */
const gradeCost: Readonly<Record<string, number>> = { K55: 1, N80: 1.15, L80: 1.2, C90: 1.4, T95: 1.45, P110: 1.35, Q125: 1.55 };

/**
 * IADC two-condition kick tolerance. Maximum influx height H at the bottom of the next hole that the shoe can
 * take: H = (Dshoe·(FG − MW) − KI·Dtd) / (MW − ρgas). Its volume is the lesser of H around the BHA at the
 * bottom and H around drill pipe at the shoe, brought back to bottom-hole pressure (Boyle's law).
 */
export function kickToleranceVolume(input: { readonly shoeTvdM: number; readonly fractureSg: number; readonly nextMudSg: number; readonly kickIntensitySg: number; readonly nextTdTvdM: number; readonly holeSizeIn: number }): { readonly heightM: number; readonly volumeM3: number } {
  const { shoeTvdM, fractureSg: fg, nextMudSg: mw, kickIntensitySg: ki, nextTdTvdM, holeSizeIn: hole } = input;
  const height = (shoeTvdM * (fg - mw) - ki * nextTdTvdM) / Math.max(0.05, mw - GAS_GRADIENT_SG);
  if (!(height > 0)) return { heightM: Math.max(0, height), volumeM3: 0 };
  const collar = hole >= 12 ? 8 : hole >= 8.5 ? 6.5 : hole >= 6 ? 4.75 : 3.5;
  const pipeOd = hole >= 8.5 ? 5 : 3.5;
  const capacity = (od: number) => Math.PI / 4 * Math.max(0, hole ** 2 - od ** 2) * IN2_M_TO_M3;
  const bha = 150;
  const atBottom = height <= bha ? height * capacity(collar) : bha * capacity(collar) + (height - bha) * capacity(pipeOd);
  const atShoe = height * capacity(pipeOd) * (fg * shoeTvdM) / ((mw + ki) * nextTdTvdM);
  return { heightM: height, volumeM3: Math.min(atBottom, atShoe) };
}

/**
 * Propose casing seats bottom-up from the pore/fracture window, then size and grade each string.
 * Starting at TD, the mud needed is the highest pore pressure in the open hole plus the trip margin;
 * walking up, the hole stays open while the fracture gradient less the kick margin can hold that mud.
 * Where it cannot, a casing shoe is set. A surface string and a conductor are always added.
 */
export function proposeCasingScheme(brief: Omit<WellDesignBrief, "sections" | "completion">, options: SchemeOptions = {}): readonly CasingSection[] {
  const full: WellDesignBrief = { ...brief, sections: [], completion: null };
  const trip = options.tripMarginSg ?? 0.03;
  const kick = options.kickMarginSg ?? 0.06;
  const basis = brief.basis ?? defaultDesignBasis;
  const td = brief.totalDepthMdM;
  const mudline = mudlineDepthM(brief);
  const minimumSurface = Math.max(options.minimumSurfaceShoeM ?? 350, mudline + 250);
  const seats: { shoe: number; mud: number }[] = [];
  let bottom = td;
  for (let guard = 0; guard < 8 && bottom > minimumSurface; guard++) {
    const bottomTvd = tvdAtMd(full, bottom);
    // Hole drilled below this seat, estimated from the size chain counted up from the production string.
    const upChain = sizeChain.slice(0, sizeChain.indexOf(options.productionOdIn ?? 7) + 1).reverse();
    const hole = standardHoleSize(upChain[guard] ?? upChain[upChain.length - 1] ?? 7);
    // Walk up while the mud stays inside the window and the shoe can take the design kick. Where no seat
    // reaches the minimum kick volume, settle for any positive tolerance; the analysis then warns.
    const walk = (strict: boolean) => {
      let top = bottom;
      let mud = maxPore(full, bottom, bottom) + trip;
      for (let md = bottom; md >= minimumSurface; md -= 10) {
        const needed = round2(maxPore(full, md, bottom) + trip);
        const mdTvd = tvdAtMd(full, md);
        const fg = pressureAt(full, mdTvd).fractureGradientSg;
        if (needed > fg - kick) break;
        if (md < bottom) {
          const tolerance = kickToleranceVolume({ shoeTvdM: mdTvd, fractureSg: fg, nextMudSg: needed, kickIntensitySg: basis.kickIntensitySg, nextTdTvdM: bottomTvd, holeSizeIn: hole });
          if (strict ? tolerance.volumeM3 < minimumKickToleranceM3(hole) : tolerance.heightM <= 0) break;
        }
        mud = needed;
        top = md;
      }
      return { top, mud };
    };
    let { top, mud } = walk(true);
    if (bottom - top < 100) ({ top, mud } = walk(false));
    seats.unshift({ shoe: bottom, mud: round2(mud) });
    if (top <= minimumSurface + 10 || top >= bottom) break;
    bottom = Math.ceil(top / 10) * 10;
  }
  // A short top interval is cheaper as a deeper surface shoe than as one more string.
  let surfaceShoe = minimumSurface;
  if (seats.length > 1 && seats[0]!.shoe - minimumSurface < 300) surfaceShoe = seats.shift()!.shoe;
  const surfaceMud = round2(Math.max(maxPore(full, mudline, surfaceShoe) + trip, SEAWATER_SG + 0.02));
  const strings: { shoe: number; mud: number; role: SectionRole }[] = [
    { shoe: Math.max(mudline + 60, Math.min(120, minimumSurface / 3)), mud: SEAWATER_SG, role: "conductor" },
    { shoe: surfaceShoe, mud: surfaceMud, role: "surface" },
    ...seats.map((seat, index) => ({ ...seat, role: (index === seats.length - 1 ? "production" : "intermediate") as SectionRole })),
  ];
  const productionOd = options.productionOdIn ?? 7;
  const downTo = (chain: readonly number[]) => chain.slice(0, chain.indexOf(productionOd) + 1);
  const needed = strings.length;
  const chain = downTo(sizeChain).length >= needed ? downTo(sizeChain) : downTo(fullChain);
  const sizes = [chain[0]!, ...chain.slice(1).slice(-(needed - 1))];
  const sections: CasingSection[] = [];
  strings.forEach((value, index) => {
    const odIn = sizes[index] ?? productionOd;
    const shoe = Math.round(value.shoe);
    const label = `${formatOd(odIn)} ${value.role === "conductor" ? "conductor" : `${value.role} casing`}`;
    const draft: CasingSection = { id: value.role === "intermediate" ? `intermediate-${index - 1}` : value.role, role: value.role, label, holeSizeIn: standardHoleSize(odIn), odIn, weightLbFt: 0, grade: "K55", topMdM: 0, shoeMdM: shoe, mudWeightSg: round2(value.mud), cement: null };
    sections.push(draft);
  });
  const reservoirTop = Math.min(...brief.geology.formations.filter((formation) => formation.reservoir).map((formation) => formation.topTvdM), Infinity);
  const factors = options.factors ?? defaultDesignFactors;
  return Object.freeze(sections.map((section, index) => {
    const previous = sections[index - 1];
    // Offshore conductors are driven or jetted; returns to seabed mean surface strings are cemented to the mudline.
    const cement = section.role === "conductor" ? (offshoreLike(full) ? null : { topMdM: 0, leadDensitySg: 1.8, tailDensitySg: 1.8, tailLengthM: 0, excessPct: 100 })
      : section.role === "surface" ? { topMdM: Math.round(mudline), leadDensitySg: 1.5, tailDensitySg: 1.9, tailLengthM: Math.round(Math.min(150, (section.shoeMdM - mudline) / 3)), excessPct: 100 }
      : { topMdM: Math.max(0, Math.round(Math.min((previous?.shoeMdM ?? 0) - 150, Number.isFinite(reservoirTop) && reservoirTop < tvdAtMd(full, section.shoeMdM) ? mdAtTvd(full, reservoirTop) - 150 : Infinity))), leadDensitySg: 1.6, tailDensitySg: 1.9, tailLengthM: 200, excessPct: 30 };
    const sized = { ...section, cement };
    const scheme = sections.map((value, at) => (at === index ? sized : value));
    const piped = selectPipe({ ...full, sections: scheme }, index, factors);
    if (!piped.cement) return Object.freeze(piped);
    // Lightest standard slurry design whose column stays below the fracture gradient (extended / foamed leads go to ~1.3 SG).
    const base = piped.cement;
    for (const tail of [base.tailDensitySg, 1.8, 1.7, 1.6]) for (const lead of [base.leadDensitySg, 1.5, 1.45, 1.4, 1.35, 1.3]) for (const tailLength of [base.tailLengthM, Math.round(base.tailLengthM / 2)]) {
      if (lead > tail) continue;
      const trial = { ...piped, cement: { ...base, leadDensitySg: lead, tailDensitySg: tail, tailLengthM: tailLength } };
      const issues = analyzeSection({ ...full, sections: scheme.map((value, at) => (at === index ? trial : value)) }, index, factors).issues;
      if (!issues.some((issue) => issue.code === "cement-losses")) return Object.freeze(trial);
    }
    return Object.freeze(piped);
  }));
}

/**
 * Cheapest weight and grade of the section's OD that passes every casing check (burst, biaxial collapse,
 * tension, temperature derating, wear and sour service). Falls back to the strongest pipe when none pass.
 */
export function selectPipe(brief: WellDesignBrief, index: number, factors: DesignFactors = defaultDesignFactors): CasingSection {
  const section = brief.sections[index];
  if (!section) throw new RangeError(`No casing section at index ${index}.`);
  // Prefer weights whose standard drift passes the next bit, then API alternate drift, then anything.
  const bit = brief.sections.filter((value) => value.shoeMdM > section.shoeMdM && value.odIn < section.odIn && value.role !== "tieback").sort((a, b) => a.shoeMdM - b.shoeMdM)[0]?.holeSizeIn ?? 0;
  const driftClass = (row: PipeSize) => (row.driftIn + 1e-6 >= bit ? 0 : (row.alternateDriftIn ?? 0) + 1e-6 >= bit ? 1 : 2);
  const candidates = casingTable.filter((row) => row.odIn === section.odIn).flatMap((row) => Object.keys(gradeCost).map((grade) => ({ row, grade, cost: row.weightLbFt * gradeCost[grade]! }))).sort((a, b) => driftClass(a.row) - driftClass(b.row) || a.cost - b.cost);
  if (!candidates.length) return section;
  for (const candidate of candidates) {
    const trial = { ...section, weightLbFt: candidate.row.weightLbFt, grade: candidate.grade };
    if (analyzeSection({ ...brief, sections: brief.sections.map((value, at) => (at === index ? trial : value)) }, index, factors).passes) return trial;
  }
  const heaviest = [...candidates].sort((a, b) => b.row.weightLbFt * (steelGrades[b.grade] ?? 0) - a.row.weightLbFt * (steelGrades[a.grade] ?? 0))[0]!;
  return { ...section, weightLbFt: heaviest.row.weightLbFt, grade: heaviest.grade };
}

export interface DesignChange { readonly sectionId?: string; readonly field: string; readonly from: string; readonly to: string; readonly reason: string }

/** Re-pick weight/grade for every string that fails its load checks; sizes, shoes and cement are left alone. */
export function regradeFailingStrings(brief: WellDesignBrief, factors: DesignFactors = defaultDesignFactors): { readonly brief: WellDesignBrief; readonly changes: readonly DesignChange[] } {
  let current = brief;
  const changes: DesignChange[] = [];
  current.sections.forEach((section, index) => {
    const analysis = analyzeSection(current, index, factors);
    if (analysis.passes) return;
    const chosen = selectPipe(current, index, factors);
    if (chosen.weightLbFt === section.weightLbFt && chosen.grade === section.grade) return;
    const reasons = analysis.issues.filter((issue) => issue.severity === "error" && ["burst", "collapse", "tension", "sour-grade", "pipe-unknown", "grade-unknown"].includes(issue.code)).map((issue) => issue.code);
    changes.push(Object.freeze({ sectionId: section.id, field: "pipe", from: `${section.weightLbFt}# ${section.grade}`, to: `${chosen.weightLbFt}# ${chosen.grade}`, reason: reasons.length ? `Failed ${reasons.join(", ")}` : "Did not meet the design factors" }));
    current = { ...current, sections: current.sections.map((value, at) => (at === index ? Object.freeze(chosen) : value)) };
  });
  return Object.freeze({ brief: Object.freeze(current), changes: Object.freeze(changes) });
}

/** Depth of the seabed (offshore) or ground level (onshore) below the depth reference. */
export function mudlineDepthM(brief: Pick<WellDesignBrief, "location" | "datum">): number {
  const above = brief.datum.elevationAboveMslM ?? 0;
  if (brief.location.environment === "onshore") return Math.max(0, above - (brief.location.groundElevationM ?? above));
  return Math.max(0, above) + (brief.location.waterDepthM ?? 0);
}

/** Measured depth at a true vertical depth along the brief's trajectory (bisection on `tvdAtMd`). */
export function mdAtTvd(brief: Pick<WellDesignBrief, "trajectory" | "totalDepthMdM">, tvdM: number) {
  let low = 0, high = Math.max(brief.totalDepthMdM, tvdM);
  for (let step = 0; step < 40; step++) { const mid = (low + high) / 2; if (tvdAtMd(brief, mid) < tvdM) low = mid; else high = mid; }
  return (low + high) / 2;
}

export function formatOd(odIn: number): string {
  const whole = Math.floor(odIn + 1e-9);
  const eighths = Math.round((odIn - whole) * 8);
  if (!eighths) return `${whole}"`;
  const [n, d] = eighths % 4 === 0 ? [eighths / 4, 2] : eighths % 2 === 0 ? [eighths / 2, 4] : [eighths, 8];
  return `${whole}-${n}/${d}"`;
}

export interface CementVolumes {
  readonly openHoleM3: number;
  readonly casedOverlapM3: number;
  readonly shoeTrackM3: number;
  readonly totalM3: number;
  readonly totalBbl: number;
  readonly leadM3: number;
  readonly tailM3: number;
  /** Equivalent density at the shoe with mud above TOC, lead, then tail; compare to the fracture gradient. */
  readonly equivalentSgAtShoe: number;
  readonly fractureSgAtShoe: number;
}

/**
 * Kick tolerance: the largest gas influx (bottom-hole volume) the open hole below a shoe can take and
 * still be circulated out without exceeding the shoe's fracture pressure. Lesser of the influx at
 * the bottom around the BHA and the influx expanded to the shoe around drill pipe (Boyle's law).
 */
export interface KickTolerance {
  readonly nextSectionId: string;
  readonly kickIntensitySg: number;
  readonly maxInfluxHeightM: number;
  readonly volumeM3: number;
  readonly volumeBbl: number;
  readonly requiredM3: number;
  readonly fractureSgAtShoe: number;
  readonly nextMudSg: number;
  readonly nextTdTvdM: number;
}

/** Ratings the screening loads are compared against: derated for temperature, worn wall, and tension in collapse. */
export interface EffectiveRatings {
  readonly temperatureC: number;
  readonly yieldDerating: number;
  readonly wearPct: number;
  readonly burstPsi: number;
  /** Biaxial (API TR 5C3 reduced-yield) collapse rating where the collapse safety factor is lowest. */
  readonly collapsePsi: number;
  readonly collapseAtMdM: number;
  readonly axialStressAtCollapsePsi: number;
  readonly bodyYieldLbf: number;
}

export interface SourService {
  /** False when H2S or the reservoir pressure is unknown: sour service cannot be judged. */
  readonly known: boolean;
  readonly h2sPartialKPa: number | null;
  readonly co2PartialKPa: number | null;
  /** ISO 15156-2: sour service applies at 0.3 kPa (0.05 psia) H2S partial pressure or more. */
  readonly sour: boolean;
}

/** Lowest temperature (°C) at which ISO 15156-2 Table A.3 accepts the grade in sour service; Infinity if never. */
export const sourMinimumTemperatureC: Readonly<Record<string, number>> = Object.freeze({ H40: -Infinity, J55: -Infinity, K55: -Infinity, L80: -Infinity, C90: -Infinity, T95: -Infinity, N80: 65, P110: 80, Q125: 107 });

/** H2S and CO2 partial pressures at reservoir pressure and whether sour-service rules apply. */
export function sourServiceConditions(brief: WellDesignBrief): SourService {
  const fluids = brief.fluids;
  const reservoirPsi = brief.geology.pressures.length ? maximumSurfacePressure(brief).reservoirPsi : null;
  const partial = (molPct: number | null | undefined) => (molPct == null || reservoirPsi === null ? null : round2(molPct / 100 * reservoirPsi * 6.89476));
  const h2s = partial(fluids?.h2sMolPct);
  return Object.freeze({ known: h2s !== null, h2sPartialKPa: h2s, co2PartialKPa: partial(fluids?.co2MolPct), sour: h2s !== null && h2s >= 0.3 });
}

/** Typical operator minimum kick tolerance: 50 bbl for holes over 8¾", 25 bbl for smaller holes. */
export const minimumKickToleranceM3 = (holeSizeIn: number) => (holeSizeIn > 8.75 ? 7.95 : 3.97);

export interface SectionAnalysis {
  readonly sectionId: string;
  readonly shoeTvdM: number;
  /** Nominal API ratings at room temperature and full wall. */
  readonly ratings: PipeRatings | null;
  readonly effective: EffectiveRatings | null;
  readonly kickTolerance: KickTolerance | null;
  readonly pipe: PipeSize | null;
  readonly loads: { readonly burstPsi: number; readonly collapsePsi: number; readonly tensionLbf: number; readonly burstCase: string };
  readonly safety: { readonly burst: number; readonly collapse: number; readonly tension: number };
  readonly passes: boolean;
  readonly mudWindow: { readonly minimumSg: number; readonly maximumSg: number; readonly mudSg: number };
  readonly holeClearanceIn: number | null;
  readonly cement: CementVolumes | null;
  readonly issues: readonly DesignIssue[];
}

const fmtM = (value: number) => `${Math.round(value).toLocaleString("en-US")} m`;
const fmtSg = (value: number) => `${value.toFixed(2)} SG`;

/** Burst, collapse and tension screening loads, mud window, clearances and cement for one section. */
export function analyzeSection(brief: WellDesignBrief, index: number, factors: DesignFactors = defaultDesignFactors): SectionAnalysis {
  const section = brief.sections[index];
  if (!section) throw new RangeError(`No casing section at index ${index}.`);
  const issues: DesignIssue[] = [];
  const add = (severity: DesignIssue["severity"], code: string, message: string) => issues.push(Object.freeze({ severity, stage: code.startsWith("cement") || code.startsWith("toc") ? "cement" : "casing", code, message, sectionId: section.id }));
  const previous = [...brief.sections.slice(0, index)].reverse().find((value) => value.shoeMdM < section.shoeMdM && value.odIn > section.odIn);
  const next = brief.sections[index + 1];
  const shoeTvd = tvdAtMd(brief, section.shoeMdM);
  const topTvd = tvdAtMd(brief, section.topMdM);
  const pipe = findPipe(section.odIn, section.weightLbFt) ?? null;
  const ratings = pipe && steelGrades[section.grade] ? pipeRatings(pipe.odIn, pipe.wallIn, section.grade) : null;
  if (!pipe) add("error", "pipe-unknown", `${section.label}: ${formatOd(section.odIn)} ${section.weightLbFt} lb/ft is not in the casing table.`);
  if (!steelGrades[section.grade]) add("error", "grade-unknown", `${section.label}: unknown grade ${section.grade}.`);
  const basis = brief.basis ?? defaultDesignBasis;
  const below = brief.sections.filter((value) => value.shoeMdM > section.shoeMdM + 1e-6 && value.odIn < section.odIn && value.role !== "tieback").sort((a, b) => a.shoeMdM - b.shoeMdM);

  // Burst: gas to surface from the deepest pore pressure the string will be exposed to.
  const exposedTo = next ? Math.max(next.shoeMdM, section.shoeMdM) : brief.totalDepthMdM;
  const exposedTvd = tvdAtMd(brief, exposedTo);
  const formationPsi = hydrostaticPsi(maxPore(brief, section.shoeMdM, exposedTo), exposedTvd);
  const gas = (fromTvd: number, toTvd: number) => GAS_GRADIENT_SG * PSI_PER_M_PER_SG * (fromTvd - toTvd);
  const fracShoePsi = hydrostaticPsi(pressureAt(brief, shoeTvd).fractureGradientSg, shoeTvd);
  const isProduction = section.role === "production" || section.role === "tieback" || (section.role === "liner" && !next);
  let internalShoe = formationPsi - gas(exposedTvd, shoeTvd);
  let burstCase = isProduction ? "Tubing leak / gas to surface at reservoir pressure" : "Gas kick to surface from the next hole section";
  if (!isProduction && internalShoe > fracShoePsi) { internalShoe = fracShoePsi; burstCase = "Gas to surface, limited by the fracture pressure at the shoe"; }
  const gasColumnAt = (tvd: number) => internalShoe - gas(shoeTvd, tvd);
  const backup = (tvd: number) => hydrostaticPsi(SEAWATER_SG, tvd);
  // A production string's governing case is a tubing leak near surface: shut-in tubing pressure
  // (reservoir pressure less a gas column to surface) lands on top of the packer fluid, so the
  // load grows with depth down to the packer whenever the packer fluid is heavier than the backup.
  // Below the packer the casing sees the gas column from the reservoir, as before.
  const packerMd = isProduction && brief.completion ? Math.min(Math.max(brief.completion.packerMdM, section.topMdM), section.shoeMdM) : null;
  const packerTvd = packerMd === null ? null : tvdAtMd(brief, packerMd);
  const packerFluidSg = brief.completion?.packerFluidSg ?? section.mudWeightSg;
  const sitp = Math.max(0, formationPsi - gas(exposedTvd, 0));
  const internalAt = (tvd: number) => packerTvd !== null && tvd <= packerTvd + 1e-9 ? sitp + hydrostaticPsi(packerFluidSg, tvd) : gasColumnAt(tvd);
  if (packerTvd !== null) burstCase = `Tubing leak: ${Math.round(sitp).toLocaleString("en-US")} psi shut-in tubing pressure on ${packerFluidSg.toFixed(2)} SG packer fluid${brief.completion?.packerFluidSg === undefined ? " (packer fluid not set: mud weight assumed)" : ""}, gas below the packer`;
  // The load is linear between these depths, so its largest value sits at one of them.
  const burstDepths = [topTvd, shoeTvd, ...(packerTvd !== null ? [packerTvd] : [])];
  const burstLoad = Math.max(0, ...burstDepths.map((tvd) => internalAt(tvd) - backup(tvd)));
  // Tension: buoyed air weight hanging from the top of the string.
  const buoyancy = 1 - section.mudWeightSg / STEEL_SG;
  const lengthFt = (section.shoeMdM - section.topMdM) * FT_PER_M;
  const tensionLoad = section.weightLbFt * lengthFt * buoyancy;

  // Ratings at the shoe temperature, on the worn wall for strings that are drilled through,
  // and collapse with the API TR 5C3 reduced yield under the axial tension at each depth.
  // Full evacuation: nothing inside, the mud column from surface outside. A liner (or a string hung
  // below the rig floor) is no exception: the annulus above its top still carries mud to surface.
  const collapseLoadAt = (tvd: number) => hydrostaticPsi(section.mudWeightSg, tvd);
  let effective: EffectiveRatings | null = null;
  let collapseLoad = collapseLoadAt(shoeTvd);
  if (pipe && ratings) {
    const temperatureC = temperatureAt(brief, shoeTvd);
    const derating = yieldDerating(temperatureC);
    const wearPct = below.length ? Math.min(50, Math.max(0, basis.casingWearPct)) : 0;
    const wall = pipe.wallIn * (1 - wearPct / 100);
    const hotYield = ratings.yieldPsi * derating;
    const hot = pipeRatings(pipe.odIn, wall, section.grade, hotYield);
    const area = Math.PI / 4 * (pipe.odIn ** 2 - (pipe.odIn - 2 * wall) ** 2);
    let worst = { sf: Infinity, rating: hot.collapsePsi, load: collapseLoad, md: section.shoeMdM, axial: 0 };
    for (let step = 0; step <= 24; step++) {
      const md = section.topMdM + (section.shoeMdM - section.topMdM) * step / 24;
      const load = collapseLoadAt(tvdAtMd(brief, md));
      if (load <= 0) continue;
      const axial = section.weightLbFt * (section.shoeMdM - md) * FT_PER_M * buoyancy / area;
      const r = Math.min(0.99, Math.max(0, axial / hotYield));
      const reduced = Math.max(1000, hotYield * (Math.sqrt(1 - 0.75 * r * r) - 0.5 * r));
      const rating = pipeRatings(pipe.odIn, wall, section.grade, reduced).collapsePsi;
      if (rating / load < worst.sf) worst = { sf: rating / load, rating, load, md, axial };
    }
    collapseLoad = worst.load;
    effective = Object.freeze({ temperatureC: round1(temperatureC), yieldDerating: round2(derating * 100) / 100, wearPct, burstPsi: hot.burstPsi, collapsePsi: worst.rating, collapseAtMdM: Math.round(worst.md), axialStressAtCollapsePsi: Math.round(worst.axial), bodyYieldLbf: Math.round(ratings.bodyYieldLbf * derating * (1 - wearPct / 100) / 1000) * 1000 });
  }
  const safety = {
    burst: effective && burstLoad > 0 ? round2(effective.burstPsi / burstLoad) : effective ? 99 : 0,
    collapse: effective && collapseLoad > 0 ? round2(effective.collapsePsi / collapseLoad) : effective ? 99 : 0,
    tension: effective && tensionLoad > 0 ? round2(effective.bodyYieldLbf / tensionLoad) : effective ? 99 : 0,
  };
  const derated = effective && (effective.yieldDerating < 1 || effective.wearPct > 0) ? ` (rated at ${Math.round(effective.temperatureC)} °C${effective.wearPct ? `, ${effective.wearPct}% wear` : ""})` : "";
  if (effective) {
    if (safety.burst < factors.burst) add("error", "burst", `${section.label}: burst safety factor ${safety.burst} is below ${factors.burst} (${Math.round(burstLoad).toLocaleString("en-US")} psi load on a ${effective.burstPsi.toLocaleString("en-US")} psi rating${derated}).`);
    if (safety.collapse < factors.collapse) add("error", "collapse", `${section.label}: collapse safety factor ${safety.collapse} is below ${factors.collapse} (${Math.round(collapseLoad).toLocaleString("en-US")} psi load on a ${effective.collapsePsi.toLocaleString("en-US")} psi biaxial rating at ${fmtM(effective.collapseAtMdM)}${derated}).`);
    if (safety.tension < factors.tension) add("error", "tension", `${section.label}: tension safety factor ${safety.tension} is below ${factors.tension}${derated}.`);
  }

  // Sour service: strings that can see reservoir fluid must use a grade accepted at their coolest point.
  const sour = sourServiceConditions(brief);
  const reservoirTop = Math.min(...brief.geology.formations.filter((formation) => formation.reservoir).map((formation) => formation.topTvdM), Infinity);
  const seesReservoir = isProduction || exposedTvd >= reservoirTop;
  const coolest = temperatureAt(brief, topTvd);
  const sourFails = sour.sour && seesReservoir && coolest < (sourMinimumTemperatureC[section.grade] ?? Infinity);
  if (sourFails) add("error", "sour-grade", `${section.label}: ${section.grade} is not accepted for sour service below ${sourMinimumTemperatureC[section.grade] ?? "any"} °C (ISO 15156-2); the string top is ${Math.round(coolest)} °C at ${sour.h2sPartialKPa} kPa H2S partial pressure.`);

  // Kick tolerance of this shoe while drilling the next hole.
  let kickTolerance: KickTolerance | null = null;
  const nextHole = below[0];
  if (nextHole && section.role !== "conductor") {
    const nextTd = tvdAtMd(brief, nextHole.shoeMdM);
    const fg = pressureAt(brief, shoeTvd).fractureGradientSg;
    const mw = nextHole.mudWeightSg;
    const ki = basis.kickIntensitySg;
    const hole = nextHole.holeSizeIn;
    const { heightM: height, volumeM3: volume } = kickToleranceVolume({ shoeTvdM: shoeTvd, fractureSg: fg, nextMudSg: mw, kickIntensitySg: ki, nextTdTvdM: nextTd, holeSizeIn: hole });
    kickTolerance = Object.freeze({ nextSectionId: nextHole.id, kickIntensitySg: ki, maxInfluxHeightM: round1(Math.max(0, height)), volumeM3: round1(volume), volumeBbl: Math.round(volume * M3_TO_BBL), requiredM3: minimumKickToleranceM3(hole), fractureSgAtShoe: round2(fg), nextMudSg: mw, nextTdTvdM: round1(nextTd) });
    if (height <= 0) add("error", "kick-tolerance", `${section.label}: zero kick tolerance — a ${ki.toFixed(2)} SG kick at ${nextHole.label} TD (${fmtM(nextTd)} TVD, ${fmtSg(mw)} mud) would break down the shoe (fracture ${fmtSg(fg)}). Set the shoe deeper or plan a shallower next section.`);
    else if (volume < kickTolerance.requiredM3) add("warning", "kick-tolerance", `${section.label}: kick tolerance ${kickTolerance.volumeM3} m³ (${kickTolerance.volumeBbl} bbl) for the ${hole}" hole is below the ${kickTolerance.requiredM3} m³ (${Math.round(kickTolerance.requiredM3 * M3_TO_BBL)} bbl) minimum.`);
  }

  // Mud window over the open hole this string is run into.
  const openFrom = previous?.shoeMdM ?? 0;
  const minimumSg = round2(maxPore(brief, openFrom, section.shoeMdM));
  const maximumSg = round2(minFrac(brief, Math.max(openFrom, 1), section.shoeMdM));
  if (section.role === "conductor") { /* drilled riserless with seawater, returns to seabed */ }
  else if (section.mudWeightSg < minimumSg) add("error", "underbalanced", `${section.label} hole: mud ${fmtSg(section.mudWeightSg)} is below the ${fmtSg(minimumSg)} pore pressure — the well would flow.`);
  else if (section.mudWeightSg < minimumSg + 0.02) add("warning", "trip-margin", `${section.label} hole: mud ${fmtSg(section.mudWeightSg)} leaves almost no trip margin over the ${fmtSg(minimumSg)} pore pressure.`);
  if (section.role !== "conductor" && section.mudWeightSg > maximumSg) add("error", "losses", `${section.label} hole: mud ${fmtSg(section.mudWeightSg)} exceeds the ${fmtSg(maximumSg)} fracture gradient — expect losses.`);

  // Clearances.
  let clearance: number | null = null;
  if (pipe) {
    clearance = round2(section.holeSizeIn - pipe.couplingOdIn);
    if (clearance < 0.5) add("error", "hole-clearance", `${section.label}: ${section.holeSizeIn}" hole leaves ${clearance}" around the ${pipe.couplingOdIn}" couplings.`);
    else if (clearance < 0.75) add("warning", "hole-clearance", `${section.label}: only ${clearance}" between hole and couplings; 0.75" or more helps cement placement.`);
  }
  const previousPipe = previous ? findPipe(previous.odIn, previous.weightLbFt) : undefined;
  if (previous && previousPipe && section.holeSizeIn > previousPipe.driftIn + 1e-6) {
    if (previousPipe.alternateDriftIn && section.holeSizeIn <= previousPipe.alternateDriftIn + 1e-6) add("warning", "bit-drift", `${section.label}: the ${section.holeSizeIn}" bit needs ${previous.label} ordered with the ${previousPipe.alternateDriftIn}" API alternate (special) drift.`);
    else add("error", "bit-drift", `${section.label}: the ${section.holeSizeIn}" bit does not drift through ${previous.label} (${previousPipe.driftIn}" drift); an underreamer or different weight is needed.`);
  }
  if (previous && previousPipe && pipe && pipe.couplingOdIn >= previousPipe.driftIn) add("error", "casing-drift", `${section.label} couplings (${pipe.couplingOdIn}") do not pass ${previous.label} (${previousPipe.driftIn}" drift).`);

  // Cement.
  let cement: CementVolumes | null = null;
  if (section.cement && pipe) {
    const plan = section.cement;
    const toc = Math.min(plan.topMdM, section.shoeMdM);
    const prevShoe = previous?.shoeMdM ?? 0;
    const prevId = previousPipe?.idIn ?? section.holeSizeIn;
    const annulus = (outer: number, length: number) => Math.PI / 4 * (outer ** 2 - section.odIn ** 2) * Math.max(0, length) * IN2_M_TO_M3;
    const openHole = annulus(section.holeSizeIn, section.shoeMdM - Math.max(toc, prevShoe)) * (1 + plan.excessPct / 100);
    const cased = previous ? annulus(prevId, Math.min(prevShoe, section.shoeMdM) - toc) : 0;
    const shoeTrack = Math.PI / 4 * pipe.idIn ** 2 * Math.min(24, section.shoeMdM - toc) * IN2_M_TO_M3;
    const total = openHole + cased + shoeTrack;
    const tailLength = Math.min(plan.tailLengthM, section.shoeMdM - toc);
    const tailShare = (section.shoeMdM - toc) > 0 ? tailLength / (section.shoeMdM - toc) : 1;
    const tailTopTvd = tvdAtMd(brief, section.shoeMdM - tailLength);
    const tocTvd = tvdAtMd(brief, toc);
    const mudlineTvd = Math.min(mudlineDepthM(brief), tocTvd);
    const fluidAbove = (tvd: number) => hydrostaticPsi(SEAWATER_SG, Math.min(tvd, mudlineTvd)) + hydrostaticPsi(section.mudWeightSg, Math.max(0, Math.min(tvd, tocTvd) - mudlineTvd));
    const columnPsi = (tvd: number) => fluidAbove(tvd) + hydrostaticPsi(plan.leadDensitySg, Math.max(0, Math.min(tvd, tailTopTvd) - tocTvd)) + hydrostaticPsi(plan.tailDensitySg, Math.max(0, tvd - Math.max(tailTopTvd, tocTvd)));
    const equivalentAt = (tvd: number) => (tvd > 0 ? columnPsi(tvd) / (PSI_PER_M_PER_SG * tvd) : 0);
    const equivalent = equivalentAt(shoeTvd);
    const fracSg = pressureAt(brief, shoeTvd).fractureGradientSg;
    const openTopTvd = tvdAtMd(brief, Math.max(prevShoe, 1));
    const openTopExcess = previous ? equivalentAt(openTopTvd) - pressureAt(brief, openTopTvd).fractureGradientSg : -1;
    if (openTopExcess > 0) add("error", "cement-losses", `${section.label}: the cement column is ${fmtSg(equivalentAt(openTopTvd))} equivalent below the ${previous!.label} shoe, above the ${fmtSg(pressureAt(brief, openTopTvd).fractureGradientSg)} fracture gradient.`);
    cement = Object.freeze({ openHoleM3: round1(openHole), casedOverlapM3: round1(cased), shoeTrackM3: round1(shoeTrack), totalM3: round1(total), totalBbl: Math.round(total * M3_TO_BBL), leadM3: round1((openHole + cased) * (1 - tailShare)), tailM3: round1((openHole + cased) * tailShare + shoeTrack), equivalentSgAtShoe: round2(equivalent), fractureSgAtShoe: round2(fracSg) });
    if (equivalent > fracSg) add("error", "cement-losses", `${section.label}: the cement column is ${fmtSg(equivalent)} equivalent at the shoe, above the ${fmtSg(fracSg)} fracture gradient; use a lighter lead or a stage tool.`);
    if (previous && toc > prevShoe - 150 && section.role !== "surface" && section.role !== "conductor") add("warning", "toc-overlap", `${section.label}: top of cement ${fmtM(toc)} overlaps the ${previous.label} shoe by ${fmtM(Math.max(0, prevShoe - toc))}; 150 m is the usual minimum.`);
    if (section.role !== "conductor") for (const zone of brief.geology.formations.filter((formation) => formation.reservoir || formation.hazard)) {
      const zoneMd = mdAtTvd(brief, zone.topTvdM);
      if (zoneMd > Math.max(prevShoe, 0) && zoneMd < section.shoeMdM && toc > zoneMd - 150) add("warning", "toc-zone", `${section.label}: top of cement ${fmtM(toc)} is not 150 m above ${zone.name} (${fmtM(zoneMd)} MD).`);
    }
  } else if (!section.cement && section.role !== "conductor") add("warning", "cement-missing", `${section.label} has no cement plan.`);

  const passes = Boolean(effective) && !sourFails && safety.burst >= factors.burst && safety.collapse >= factors.collapse && safety.tension >= factors.tension;
  return Object.freeze({ sectionId: section.id, shoeTvdM: round1(shoeTvd), ratings, effective, kickTolerance, pipe, loads: Object.freeze({ burstPsi: Math.round(burstLoad), collapsePsi: Math.round(collapseLoad), tensionLbf: Math.round(tensionLoad), burstCase }), safety: Object.freeze(safety), passes, mudWindow: Object.freeze({ minimumSg, maximumSg, mudSg: section.mudWeightSg }), holeClearanceIn: clearance, cement, issues: Object.freeze(issues) });
}

export const apiPressureRatings = Object.freeze([2000, 3000, 5000, 10000, 15000, 20000]);

/** Maximum anticipated surface pressure (gas to surface from the deepest reservoir) and the API 6A rating that covers it. */
export function maximumSurfacePressure(brief: WellDesignBrief): { readonly maspPsi: number; readonly reservoirPsi: number; readonly reservoirTvdM: number; readonly wellheadRatingPsi: number | null } {
  const tdTvd = tvdAtMd(brief, brief.totalDepthMdM);
  const reservoirs = brief.geology.formations.filter((formation) => formation.reservoir && formation.topTvdM <= tdTvd);
  const tvd = reservoirs.length ? Math.max(...reservoirs.map((formation) => formation.topTvdM)) : tdTvd;
  const pore = Math.max(pressureAt(brief, tvd).porePressureSg, pressureAt(brief, tdTvd).porePressureSg);
  const reservoirPsi = hydrostaticPsi(pore, tdTvd);
  const masp = Math.max(0, reservoirPsi - GAS_GRADIENT_SG * PSI_PER_M_PER_SG * tdTvd);
  return Object.freeze({ maspPsi: Math.round(masp), reservoirPsi: Math.round(reservoirPsi), reservoirTvdM: round1(tdTvd), wellheadRatingPsi: apiPressureRatings.find((rating) => rating >= masp) ?? null });
}

export type DesignStage = "identity" | "location" | "datum" | "geology" | "trajectory" | "casing" | "cement" | "completion";
export const designStages: readonly { readonly id: DesignStage; readonly label: string; readonly purpose: string }[] = Object.freeze([
  { id: "identity", label: "Identity", purpose: "Who owns the well and why it is drilled; drives regulatory filing and naming." },
  { id: "location", label: "Location", purpose: "Surface coordinates, CRS and water depth; set the conductor, rig type and wellhead system." },
  { id: "datum", label: "Datum", purpose: "Depth reference and its elevation; every depth, pressure and survey hangs from it." },
  { id: "geology", label: "Geology & pressures", purpose: "Formation tops, pore pressure, fracture gradient and temperature; set the mud window and casing seats." },
  { id: "trajectory", label: "Trajectory", purpose: "Directional plan to the targets; converts MD to TVD for every pressure load." },
  { id: "casing", label: "Casing", purpose: "Shoe depths, sizes, weights and grades checked against burst, collapse and tension." },
  { id: "cement", label: "Cement", purpose: "Top of cement, slurry densities and volumes; zonal isolation without breaking the formation." },
  { id: "completion", label: "Completion", purpose: "Tubing, packer, safety valve, lift and perforations; the producing barrier envelope." },
]);

export interface DesignRequirement {
  readonly id: string;
  readonly stage: DesignStage;
  readonly label: string;
  readonly why: string;
  readonly status: "complete" | "missing" | "attention";
  readonly detail: string;
}

/** What a well design needs, stage by stage, and whether this brief provides it. */
export function designReadiness(brief: WellDesignBrief): { readonly requirements: readonly DesignRequirement[]; readonly percentComplete: number; readonly ready: boolean } {
  const list: DesignRequirement[] = [];
  const req = (stage: DesignStage, id: string, label: string, why: string, ok: boolean | "attention", detail: string) => list.push(Object.freeze({ id, stage, label, why, status: ok === "attention" ? "attention" : ok ? "complete" : "missing", detail }));
  const { identity, location, datum, geology } = brief;
  req("identity", "name", "Well name", "Unique identifier on permits, reports and the data store.", identity.name.trim().length > 0, identity.name || "Not entered");
  req("identity", "operator", "Operator and field", "Accountable party and the field the well drains.", Boolean(identity.operator.trim() && identity.field.trim()), [identity.operator, identity.field].filter(Boolean).join(" · ") || "Not entered");
  req("identity", "purpose", "Well purpose", "Exploration, development or injection changes the completion and the data to acquire.", Boolean(identity.purpose), identity.purpose);
  req("location", "coordinates", "Surface coordinates + CRS", "Anti-collision, permits and the trajectory tie-in all start from the surface location.", location.latitude !== null && location.longitude !== null && location.crs.trim().length > 0, location.latitude !== null && location.longitude !== null ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} (${location.crs})` : "Not entered");
  const offshore = location.environment !== "onshore";
  req("location", "elevation", offshore ? "Water depth" : "Ground elevation", offshore ? "Sets the mudline, conductor depth and riser/wellhead system." : "Ties the depth reference to the ground and the cellar.", offshore ? location.waterDepthM !== null && location.waterDepthM > 0 : location.groundElevationM !== null, offshore ? (location.waterDepthM !== null ? `${location.waterDepthM} m` : "Not entered") : (location.groundElevationM !== null ? `${location.groundElevationM} m` : "Not entered"));
  req("datum", "datum", "Depth reference elevation", "MD/TVD are measured from it; pressure gradients need the true vertical height of fluid.", datum.elevationAboveMslM !== null, datum.elevationAboveMslM !== null ? `${datum.reference} ${datum.elevationAboveMslM} m above MSL` : `${datum.reference} elevation not entered`);
  const tdTvd = tvdAtMd(brief, brief.totalDepthMdM);
  req("geology", "formations", "Formation tops", "Casing seats, cement tops and hazards are positioned against the stratigraphy.", geology.formations.length >= 2, `${geology.formations.length} formations`);
  req("geology", "reservoir", "Target reservoir", "Production casing, cement cover and perforations are designed around it.", geology.formations.some((formation) => formation.reservoir), geology.formations.filter((formation) => formation.reservoir).map((formation) => formation.name).join(", ") || "No formation flagged as reservoir");
  const deepest = Math.max(0, ...geology.pressures.map((point) => point.tvdM));
  const inverted = geology.pressures.filter((point) => point.fractureGradientSg <= point.porePressureSg);
  const sources = geology.pressures.flatMap((point) => [point.poreSource, point.fractureSource]);
  const tests = geology.integrityTests ?? [];
  const calibrated = tests.length > 0 || sources.some((source) => source === "measured" || source === "offset");
  const allAssumed = geology.pressures.length > 0 && sources.every((source) => source === "assumed");
  req("geology", "pressures", "Pore pressure + fracture gradient to TD", "Mud weights, casing seats and every burst/collapse load come from the pressure profile.", geology.pressures.length < 2 ? false : inverted.length ? "attention" : deepest < tdTvd - 1 ? "attention" : allAssumed ? false : calibrated ? true : "attention", geology.pressures.length < 2 ? "Needs at least two depth points" : inverted.length ? `${inverted.length} point(s) with fracture ≤ pore pressure` : deepest < tdTvd - 1 ? `Data stops at ${Math.round(deepest)} m TVD; TD is ${Math.round(tdTvd)} m TVD` : allAssumed ? "Every point is an unchecked assumption" : calibrated ? `${geology.pressures.length} points to ${Math.round(deepest)} m TVD${tests.length ? ` · ${tests.length} FIT/LOT` : ""}` : "No measured, offset or FIT/LOT data behind the profile — calibrate before trusting the seats");
  const temperatureSource = geology.temperatureSource;
  req("geology", "temperature", "Temperature profile", "Elastomers, cement retarders, steel yield (derating) and gauges are rated by temperature.", !(geology.geothermalGradientCPerKm > 0) ? false : temperatureSource === "assumed" ? "attention" : true, `${geology.surfaceTemperatureC} °C + ${geology.geothermalGradientCPerKm} °C/km → ${Math.round(temperatureAt(brief, tdTvd))} °C at TD${temperatureSource === "assumed" ? " (assumed — not from data)" : temperatureSource ? ` (${temperatureSource})` : ""}`);
  const fluids = brief.fluids;
  const sour = sourServiceConditions(brief);
  req("geology", "fluids", "Reservoir fluid, H2S, CO2", "Sour service (ISO 15156) restricts casing and tubing grades; CO2 drives corrosion-resistant alloy selection.", !fluids ? false : fluids.h2sMolPct === null || fluids.co2MolPct === null ? "attention" : true, !fluids ? "Not entered" : `${fluids.type} · H2S ${fluids.h2sMolPct ?? "unknown"} mol% · CO2 ${fluids.co2MolPct ?? "unknown"} mol%${sour.sour ? ` · sour (${sour.h2sPartialKPa} kPa H2S)` : ""}`);
  req("trajectory", "trajectory", "Directional plan or vertical", "TVD for each MD; drag and dogleg affect casing wear and running loads.", brief.trajectory === null || brief.trajectory.length >= 2, brief.trajectory === null ? "Vertical well" : `${brief.trajectory.length} stations`);
  req("trajectory", "td", "Total depth", "Sets the last hole section and the casing it needs.", brief.totalDepthMdM > 0, `${Math.round(brief.totalDepthMdM)} m MD · ${Math.round(tdTvd)} m TVD`);
  const analyses = brief.sections.map((_, index) => analyzeSection(brief, index));
  const deepestShoe = Math.max(0, ...brief.sections.map((section) => section.shoeMdM));
  req("casing", "scheme", "Casing scheme to TD", "Every open-hole interval must be covered before the well is completed.", brief.sections.length === 0 ? false : deepestShoe >= brief.totalDepthMdM - 1 ? true : "attention", brief.sections.length === 0 ? "No casing sections" : `${brief.sections.length} strings, deepest shoe ${Math.round(deepestShoe)} m`);
  const failing = analyses.filter((analysis) => !analysis.passes);
  const kicks = analyses.filter((analysis) => analysis.kickTolerance);
  const shortKick = kicks.filter((analysis) => analysis.kickTolerance!.volumeM3 < analysis.kickTolerance!.requiredM3);
  req("casing", "kick", "Kick tolerance at every shoe", "Each shoe must take the design kick from the bottom of the next hole without breaking down.", brief.sections.length === 0 ? false : shortKick.length ? "attention" : true, shortKick.length ? `${shortKick.length} shoe(s) below the minimum kick tolerance` : kicks.length ? `${kicks.length} shoe(s) · smallest ${Math.min(...kicks.map((analysis) => analysis.kickTolerance!.volumeBbl))} bbl` : "No shoes to check");
  req("casing", "loads", "Burst, collapse and tension checked", "Each string must survive the worst credible pressure and its own weight with margin.", brief.sections.length === 0 ? false : failing.length ? "attention" : true, failing.length ? `${failing.length} string(s) below the design factors` : `${analyses.length} strings meet B ${defaultDesignFactors.burst} · C ${defaultDesignFactors.collapse} · T ${defaultDesignFactors.tension} (derated, biaxial)`);
  const uncemented = brief.sections.filter((section) => section.role !== "conductor" && !section.cement);
  const cementProblems = analyses.flatMap((analysis) => analysis.issues).filter((issue) => issue.stage === "cement" && issue.severity !== "info");
  req("cement", "cement", "Cement plan for every string", "Zonal isolation behind casing is the primary barrier outside the pipe.", brief.sections.length === 0 ? false : uncemented.length ? false : cementProblems.length ? "attention" : true, uncemented.length ? `${uncemented.length} string(s) without cement` : cementProblems.length ? `${cementProblems.length} cement warning(s)` : "All strings cemented with overlap");
  const completion = brief.completion;
  req("completion", "tubing", "Tubing size", "Flow rate, lift method and the tools that must pass through it.", Boolean(completion && findPipe(completion.tubingOdIn, completion.tubingWeightLbFt, tubingTable)), completion ? `${formatOd(completion.tubingOdIn)} ${completion.tubingWeightLbFt} lb/ft ${completion.tubingGrade}` : "No completion");
  const production = [...brief.sections].sort((a, b) => a.odIn - b.odIn)[0];
  const packerOk = completion && production ? completion.packerMdM < production.shoeMdM && completion.packerMdM > 0 : false;
  req("completion", "packer", "Packer depth", "Isolates the annulus; must sit in competent casing above the perforations.", completion ? (packerOk ? true : "attention") : false, completion ? `${Math.round(completion.packerMdM)} m MD` : "No completion");
  req("completion", "sssv", "Safety valve depth", "Fail-safe barrier below the mudline / hydrate zone.", completion ? completion.sssvMdM !== null : false, completion?.sssvMdM != null ? `${Math.round(completion.sssvMdM)} m MD` : "Not set");
  req("completion", "perforations", "Perforated intervals", "Connects the reservoir; must be below the packer and inside cemented casing.", completion ? completion.perforations.length > 0 : false, completion ? `${completion.perforations.length} interval(s)` : "No completion");
  const complete = list.filter((value) => value.status === "complete").length;
  return Object.freeze({ requirements: Object.freeze(list), percentComplete: Math.round(complete / list.length * 100), ready: list.every((value) => value.status === "complete") });
}

export interface DesignCoverage {
  readonly checked: readonly string[];
  readonly assumptions: readonly string[];
  readonly notChecked: readonly string[];
}

/**
 * What this SDK actually verifies for the brief, what it assumed to do so, and what still needs a full
 * casing-design package or an engineer. Screening only: not a substitute for a stress-check sign-off.
 */
export function designCoverage(brief: WellDesignBrief, factors: DesignFactors = defaultDesignFactors): DesignCoverage {
  const basis = brief.basis ?? defaultDesignBasis;
  const sour = sourServiceConditions(brief);
  const assumptions = [
    `Burst: gas to surface (${GAS_GRADIENT_SG} SG gradient) from the deepest exposed pore pressure, capped at the shoe fracture pressure; seawater-gradient backup.`,
    "Collapse: full evacuation inside, mud gradient outside; no cement or formation support credited.",
    "Tension: buoyed string weight only — no overpull, shock, bending or pressure-test load.",
    `Yield derated ${(YIELD_DERATING_PER_C * 100).toFixed(3)} %/°C above 20 °C at the shoe temperature.`,
    `Kick tolerance: ${basis.kickIntensitySg.toFixed(2)} SG kick intensity, 150 m BHA, 5" drill pipe (3½" in small holes).`,
    `Casing wear ${basis.casingWearPct}% on strings that are drilled through.`,
    `Design factors: burst ${factors.burst}, collapse ${factors.collapse}, tension ${factors.tension} on pipe body.`,
  ];
  if (brief.geology.temperatureSource === "assumed") assumptions.push("Temperature profile is an unverified assumption.");
  const sources = brief.geology.pressures.flatMap((point) => [point.poreSource, point.fractureSource]);
  if (sources.some((source) => source === "assumed" || source === "estimated" || source === undefined)) assumptions.push("Some pore/fracture points are estimated or of unstated origin.");
  if (!sour.known) assumptions.push("H2S content unknown: sour-service grade rules are not applied.");
  return Object.freeze({
    checked: Object.freeze([
      "Mud window: trip margin over pore pressure and losses against fracture gradient for every open hole.",
      "Burst, biaxial collapse (API TR 5C3 reduced yield along the string) and pipe-body tension against design factors.",
      "Steel yield derating at temperature and wall loss from wear.",
      "Kick tolerance (IADC two-condition) at every shoe for the next hole.",
      "Sour-service grade acceptance (ISO 15156-2 Table A.3) for strings and tubing exposed to reservoir fluid; CO2 corrosion flag.",
      "Bit and coupling drift through the previous string, API alternate drift, hole/coupling clearance.",
      "Cement volumes, equivalent density against fracture gradient, TOC overlap and cover over reservoirs/hazards.",
      "Completion geometry: packer, perforations, safety valve, tubing clearance; MASP and API 6A wellhead rating.",
    ]),
    assumptions: Object.freeze(assumptions),
    notChecked: Object.freeze([
      "Triaxial (von Mises) stress and thermal / annular-pressure-build-up loads during production or injection.",
      "Running, shock, overpull and dogleg bending loads; buckling.",
      "Connection ratings (only pipe body is rated) and connection sealability.",
      "Cement-sheath integrity under cyclic loads; elastomer and cement compatibility with H2S/CO2.",
      "Drilling hydraulics and ECD, hole cleaning, torque and drag.",
      "Wellbore stability (collapse/breakout) beyond the supplied fracture gradient.",
      "Anti-collision with nearby wellbores and the regulator's own design rules.",
    ]),
  });
}

/** Every engineering issue for the brief: section checks plus well-level ones. */
export function validateDesign(brief: WellDesignBrief, factors: DesignFactors = defaultDesignFactors): readonly DesignIssue[] {
  const issues: DesignIssue[] = brief.sections.flatMap((_, index) => analyzeSection(brief, index, factors).issues);
  const add = (severity: DesignIssue["severity"], stage: DesignStage, code: string, message: string) => issues.push(Object.freeze({ severity, stage, code, message }));
  const sorted = [...brief.sections].sort((a, b) => b.odIn - a.odIn);
  for (let index = 1; index < sorted.length; index++) {
    const outer = sorted[index - 1]!, inner = sorted[index]!;
    if (inner.role !== "tieback" && inner.shoeMdM <= outer.shoeMdM) add("error", "casing", "shoe-order", `${inner.label} shoe (${fmtM(inner.shoeMdM)}) is not below ${outer.label} (${fmtM(outer.shoeMdM)}).`);
  }
  if (brief.sections.some((section) => section.shoeMdM > brief.totalDepthMdM + 1e-6)) add("error", "casing", "below-td", "A casing shoe is below total depth.");
  if (brief.completion && brief.sections.length) {
    const c = brief.completion;
    const tubing = findPipe(c.tubingOdIn, c.tubingWeightLbFt, tubingTable);
    const production = [...brief.sections].sort((a, b) => a.odIn - b.odIn)[0]!;
    const productionPipe = findPipe(production.odIn, production.weightLbFt);
    if (!tubing) add("error", "completion", "tubing-unknown", `${formatOd(c.tubingOdIn)} ${c.tubingWeightLbFt} lb/ft tubing is not in the tubing table.`);
    else if (productionPipe && tubing.couplingOdIn >= productionPipe.driftIn - 1) add("warning", "completion", "tubing-clearance", `${formatOd(c.tubingOdIn)} tubing couplings leave under 1" to the ${production.label} drift; washover and fishing would be impossible.`);
    const sour = sourServiceConditions(brief);
    if (sour.sour && temperatureAt(brief, 0) < (sourMinimumTemperatureC[c.tubingGrade] ?? Infinity)) add("error", "completion", "sour-tubing", `${c.tubingGrade} tubing is not accepted for sour service at the wellhead temperature (ISO 15156-2, ${sour.h2sPartialKPa} kPa H2S).`);
    if (sour.co2PartialKPa !== null && sour.co2PartialKPa > 200) add("warning", "completion", "co2-corrosion", `CO2 partial pressure ${Math.round(sour.co2PartialKPa)} kPa is above 200 kPa: carbon-steel tubing will corrode; consider 13Cr or inhibition.`);
    if (c.packerMdM >= production.shoeMdM) add("error", "completion", "packer-depth", `Packer at ${fmtM(c.packerMdM)} is below the ${production.label} shoe.`);
    for (const interval of c.perforations) {
      if (interval.topMdM < c.packerMdM) add("warning", "completion", "perforations-above-packer", `Perforations at ${fmtM(interval.topMdM)} are above the packer.`);
      if (interval.bottomMdM > production.shoeMdM) add("error", "completion", "perforations-open-hole", `Perforations to ${fmtM(interval.bottomMdM)} extend below the ${production.label} shoe.`);
      const cemented = brief.sections.some((section) => section.cement && section.cement.topMdM <= interval.topMdM && section.shoeMdM >= interval.bottomMdM);
      if (!cemented) add("warning", "completion", "perforations-uncemented", `Perforations ${fmtM(interval.topMdM)}–${fmtM(interval.bottomMdM)} are not behind cement; zonal isolation is not assured.`);
    }
    if (c.sssvMdM !== null) {
      const mudline = mudlineDepthM(brief);
      if (offshoreLike(brief) && c.sssvMdM < mudline + 30) add("warning", "completion", "sssv-mudline", `Safety valve at ${fmtM(c.sssvMdM)} should be at least 30 m below the mudline (${fmtM(mudline)}).`);
      if (c.sssvMdM > 900) add("warning", "completion", "sssv-depth", `Safety valve at ${fmtM(c.sssvMdM)} is deep for a control-line operated valve.`);
    } else if (offshoreLike(brief)) add("warning", "completion", "sssv-missing", "Offshore wells normally require a surface-controlled subsurface safety valve.");
  }
  for (const test of brief.geology.integrityTests ?? []) {
    if (!brief.geology.pressures.length) break;
    const fg = pressureAt(brief, test.tvdM).fractureGradientSg;
    if (fg + 0.005 < test.emwSg) add("warning", "geology", "fracture-below-test", `Fracture gradient ${fmtSg(fg)} at ${fmtM(test.tvdM)} TVD is below the ${test.kind} of ${fmtSg(test.emwSg)} (${test.source}); the profile contradicts a measured test.`);
    else if (test.reachedLeakOff && fg > test.emwSg + 0.05) add("warning", "geology", "fracture-above-leakoff", `Fracture gradient ${fmtSg(fg)} at ${fmtM(test.tvdM)} TVD is above the ${test.kind} leak-off of ${fmtSg(test.emwSg)} (${test.source}).`);
  }
  const masp = maximumSurfacePressure(brief);
  if (masp.wellheadRatingPsi === null) add("error", "casing", "masp", `MASP ${masp.maspPsi.toLocaleString("en-US")} psi exceeds every API 6A rating.`);
  return Object.freeze(issues);
}

const offshoreLike = (brief: WellDesignBrief) => brief.location.environment !== "onshore";

const roleCatalog: Readonly<Record<SectionRole, string>> = { conductor: "conductor", surface: "surface-casing", intermediate: "intermediate-casing", production: "production-casing", liner: "liner", tieback: "tieback-casing" };
const liftCatalog: Readonly<Record<Exclude<ArtificialLift, "none" | "gas-lift">, string>> = { esp: "esp", "rod-pump": "rod-pump", pcp: "pcp", "jet-pump": "jet-pump" };

/**
 * Translate the engineered brief into the drag-and-drop assembly: wellhead stack, every string at its
 * engineered size, cement to the planned tops, shoe tracks, centralizers, and the completion string.
 */
export function designToAssembly(brief: WellDesignBrief): WellAssembly {
  let value = createAssembly({ id: `design-${brief.identity.name.replace(/\W+/g, "-").toLowerCase() || "well"}`, name: brief.identity.name || "Untitled well", totalDepthM: brief.totalDepthMdM });
  const ids = new Map<string, string>();
  const place = (catalogId: string, depth: number, hostId?: string) => { const result = placeComponent(value, catalogId, depth, hostId ? { hostId } : {}); value = result.assembly; return result.itemId; };
  const sections = [...brief.sections].sort((a, b) => b.odIn - a.odIn);
  for (const section of sections) {
    const catalogId = roleCatalog[section.role];
    const pipe = findPipe(section.odIn, section.weightLbFt);
    const itemId = place(catalogId, section.role === "liner" ? section.topMdM : section.shoeMdM);
    ids.set(section.id, itemId);
    value = updateComponent(value, itemId, { label: `${formatOd(section.odIn)} ${section.weightLbFt}# ${section.grade} ${section.role === "conductor" ? "conductor" : section.role === "liner" ? "liner" : `${section.role} casing`}`, odIn: section.odIn, idIn: pipe?.idIn ?? section.odIn * 0.9, topM: section.topMdM, bottomM: section.shoeMdM });
  }
  const full = sections.filter((section) => section.topMdM === 0 && section.role !== "conductor");
  place("wellhead", 0);
  if (full.length >= 3) place("casing-spool", 0);
  for (const section of sections) {
    const host = ids.get(section.id)!;
    if (section.cement) place("cement", Math.min(section.cement.topMdM, section.shoeMdM - 1), host);
    if (section.role === "conductor") continue;
    place(section.role === "surface" ? "guide-shoe" : "float-shoe", section.shoeMdM, host);
    place("float-collar", section.shoeMdM - 24, host);
    if (section.role === "production" || section.role === "liner") place("landing-collar", section.shoeMdM - 36, host);
    place("centralizer", section.shoeMdM - 12, host);
    if (section.role === "liner") place("liner-top-packer", section.topMdM, host);
  }
  const c = brief.completion;
  if (c) {
    const tubing = findPipe(c.tubingOdIn, c.tubingWeightLbFt, tubingTable);
    place("tubing-head", 0);
    const tail = Math.min(brief.totalDepthMdM - 1, c.packerMdM + 30);
    const tubingId = place("tubing", tail);
    value = updateComponent(value, tubingId, { label: `${formatOd(c.tubingOdIn)} ${c.tubingWeightLbFt}# ${c.tubingGrade} tubing`, odIn: c.tubingOdIn, idIn: tubing?.idIn ?? c.tubingOdIn * 0.85 });
    place("tubing-hanger", 0);
    place("christmas-tree", 0);
    if (c.sssvMdM !== null) place("safety-valve", c.sssvMdM);
    if (c.artificialLift === "gas-lift") {
      const count = Math.max(1, c.gasLiftMandrels ?? 4);
      for (let index = 0; index < count; index++) place("gas-lift-mandrel", c.packerMdM * (0.3 + 0.6 * index / Math.max(1, count - 1)) - 40);
    } else if (c.artificialLift !== "none") place(liftCatalog[c.artificialLift], c.packerMdM - 120);
    place("gauge", c.packerMdM - 45);
    place("landing-nipple", c.packerMdM - 25);
    place("packer", c.packerMdM);
    place("no-go-nipple", tail - 8);
    place("wireline-entry-guide", tail);
    for (const interval of c.perforations) {
      const id = place("perforations", interval.topMdM);
      value = updateComponent(value, id, { topM: interval.topMdM, bottomM: interval.bottomMdM });
    }
  } else place("bop-stack", 0);
  const errors = validateAssembly(value).filter((issue) => issue.severity === "error");
  if (errors.length) throw new RangeError(`Design does not assemble: ${errors.map((issue) => issue.message).join(" ")}`);
  return value;
}

/** A blank brief: everything a new well still needs is reported by `designReadiness`. */
export function emptyWellBrief(): WellDesignBrief {
  const brief: WellDesignBrief = {
    identity: { name: "", field: "", operator: "", country: "", purpose: "development" },
    location: { environment: "onshore", crs: "WGS 84", latitude: null, longitude: null, waterDepthM: null, groundElevationM: null },
    datum: { reference: "RKB", elevationAboveMslM: null },
    geology: { formations: [], pressures: [], surfaceTemperatureC: 25, geothermalGradientCPerKm: 30, temperatureSource: "assumed", integrityTests: [] },
    fluids: null,
    basis: defaultDesignBasis,
    trajectory: null,
    totalDepthMdM: 2000,
    sections: [],
    completion: null,
  };
  return Object.freeze(brief);
}

/** Build-and-hold plan of the example well: kick off at 700 m, 2°/30 m, to a K-10 target 900 m away at 65°. */
export const exampleBuildHold: BuildHoldInput = Object.freeze({ kickoffMdM: 700, buildRateDegPer30m: 2, target: Object.freeze({ tvdM: 2620, northingM: 380, eastingM: 815 }), extensionM: 260 });

/** Offshore platform development well with a J-profile, used by the examples and tests. */
export function exampleWellBrief(): WellDesignBrief {
  const geology: WellDesignBrief["geology"] = {
    formations: [
      { name: "Seabed clays", topTvdM: 115, lithology: "Unconsolidated clay", hazard: "Shallow gas pockets" },
      { name: "Upper Miocene shale", topTvdM: 600, lithology: "Shale" },
      { name: "Middle Miocene sands", topTvdM: 1250, lithology: "Interbedded sand / shale", hazard: "Lost circulation" },
      { name: "Overpressured shale", topTvdM: 1850, lithology: "Shale" },
      { name: "K-10 reservoir", topTvdM: 2620, lithology: "Sandstone", reservoir: true },
      { name: "Basement", topTvdM: 2900, lithology: "Granite wash" },
    ],
    pressures: ([
      [115, 1.03, 1.22], [600, 1.04, 1.5], [1250, 1.06, 1.66], [1850, 1.18, 1.76], [2200, 1.48, 1.88], [2620, 1.56, 1.94], [3000, 1.58, 1.96],
    ] as const).map(([tvdM, porePressureSg, fractureGradientSg]) => ({ tvdM, porePressureSg, fractureGradientSg, poreSource: "offset" as const, fractureSource: "offset" as const })),
    surfaceTemperatureC: 26,
    geothermalGradientCPerKm: 32,
    temperatureSource: "offset",
    integrityTests: [],
  };
  const plan = planBuildHold(exampleBuildHold);
  const base: Omit<WellDesignBrief, "sections" | "completion"> = {
    identity: { name: "Kestrel A-7", field: "Kestrel", operator: "Example Energy", country: "Malaysia", purpose: "development", uwi: "MY-KST-A7" },
    location: { environment: "offshore-platform", crs: "WGS 84 / UTM 50N", latitude: 5.412, longitude: 114.231, waterDepthM: 85, groundElevationM: null },
    datum: { reference: "RKB", elevationAboveMslM: 30 },
    geology,
    fluids: { type: "oil", h2sMolPct: 0, co2MolPct: 3, source: "offset" },
    basis: defaultDesignBasis,
    trajectory: plan.stations,
    totalDepthMdM: Math.round(plan.totalDepthMdM),
  };
  const sections = proposeCasingScheme(base);
  const production = sections[sections.length - 1]!;
  const reservoirMd = mdAtTvd({ ...base, sections } as WellDesignBrief, 2620);
  const completion: CompletionPlan = { tubingOdIn: 3.5, tubingWeightLbFt: 9.3, tubingGrade: "L80", packerMdM: Math.round(reservoirMd - 60), sssvMdM: 250, perforations: [{ topMdM: Math.round(reservoirMd + 10), bottomMdM: Math.min(Math.round(reservoirMd + 70), production.shoeMdM - 40) }], artificialLift: "gas-lift", gasLiftMandrels: 3, packerFluidSg: 1.06 };
  // The production string was picked before the completion existed; the tubing-leak load above the
  // packer only applies now, so any string that no longer passes is re-graded, as a designer would.
  return regradeFailingStrings(Object.freeze({ ...base, sections, completion })).brief;
}
