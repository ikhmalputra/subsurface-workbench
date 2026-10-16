import { torqueDrag } from "./torque-drag.ts";
import type { StringSegment, TorqueDragStation } from "./torque-drag.ts";
import { findPipe, mdAtTvd, PPG_PER_SG, PSI_PER_M_PER_SG, pressureAt, tvdAtMd } from "./well-design.ts";
import type { CasingSection, Formation, WellDesignBrief } from "./well-design.ts";

/**
 * A live drilling simulator: one hole section of a planned well, drilled second by second.
 *
 * The rock is the plan's own geology (formations, pore and fracture pressure) varied by a seeded
 * random wobble of about ±0.02 SG, plus hazards: the ones the plan names (shallow gas, losses) made
 * real at a seeded strength, and any the user adds. The driller only sees what a rig sees (pit
 * volume, flow out, standpipe pressure, torque, hookload, gas, ROP); what the rock really is stays
 * in `truth`, for the debrief.
 *
 * Models, in oilfield units: Bingham-plastic pipe and annulus friction, laminar or turbulent by the
 * Reynolds number (Bourgoyne et al., Applied Drilling Engineering, 1986, ch. 4); bit pressure drop
 * MW·Q²/(10858·TFA²); soft-string torque and drag; ROP from WOB, RPM, overbalance and bit wear on a
 * drillability per lithology; influx and losses proportional to the under- or overbalance; gas
 * expanding by Boyle's law as it rises; shut-in pressure build-up, gas migration, and a
 * wait-and-weight kill. A teaching and planning simulator, not a certified well-control simulator.
 */

const FT = 3.28084;
const GPM_PER_BBL_MIN = 42;
/** Annular capacity, bbl per metre, for diameters in inches. */
const capacityBblPerM = (outerIn: number, innerIn: number) => (outerIn ** 2 - innerIn ** 2) / 1029.4 * FT;

export type Hazard =
  | { readonly kind: "overpressure"; readonly topMdM: number; readonly baseMdM: number; readonly extraSg: number; readonly gas: boolean; readonly label: string }
  | { readonly kind: "weak-zone"; readonly topMdM: number; readonly baseMdM: number; readonly fractureSg: number; readonly label: string }
  | { readonly kind: "washout"; readonly atS: number; readonly label: string }
  | { readonly kind: "abrasive"; readonly topMdM: number; readonly baseMdM: number; readonly label: string };

export interface Mud { readonly pvCp: number; readonly ypLbf100ft2: number }
export interface DrillString { readonly pipeOdIn: number; readonly pipeIdIn: number; readonly pipeWeightLbFt: number; readonly bhaLengthM: number; readonly bhaOdIn: number; readonly bhaIdIn: number; readonly bhaWeightLbFt: number }

export interface DrillingSimSetup {
  readonly brief: WellDesignBrief;
  /** Which casing section's hole to drill: from the shoe above it to its own shoe. */
  readonly sectionIndex: number;
  readonly seed?: number;
  readonly mud?: Mud;
  readonly string?: DrillString;
  readonly nozzles32nds?: readonly number[];
  readonly pitBbl?: number;
  /** Hazards in addition to those the plan names; `hazardsFromPlan` gives the plan's. */
  readonly hazards?: readonly Hazard[];
  /** Pump off and pick up for a connection every 28.5 m drilled (default true). */
  readonly connections?: boolean;
}

export type DrillMode = "drilling" | "circulating" | "connection" | "flow-check" | "shut-in" | "killing" | "killed" | "tripping" | "section-td" | "blowout";

export interface DrillEvent { readonly timeS: number; readonly level: "info" | "warning" | "alarm" | "disaster"; readonly code: string; readonly text: string }

export interface KillSheet {
  readonly sidppPsi: number; readonly sicpPsi: number; readonly bitTvdM: number; readonly mudSg: number; readonly killMudSg: number;
  readonly killFlowGpm: number; readonly scrPsi: number; readonly icpPsi: number; readonly fcpPsi: number;
  readonly stringBbl: number; readonly annulusBbl: number; readonly influxBbl: number;
  /** From the gap between casing and drill-pipe pressure over the influx height. */
  readonly influxGradientPsiFt: number | null; readonly influxIs: "gas" | "oil or condensate" | "water" | "not known";
}

export interface DrillReading {
  readonly timeS: number; readonly mode: DrillMode;
  readonly bitMdM: number; readonly holeMdM: number; readonly bitTvdM: number; readonly formation: string;
  readonly onBottom: boolean; readonly pumpsOn: boolean; readonly rotating: boolean;
  readonly ropMh: number; readonly wobKlbf: number; readonly rpm: number; readonly torqueKftLbf: number; readonly hookloadKlb: number;
  readonly flowInGpm: number; readonly flowOutGpm: number; readonly sppPsi: number; readonly pitBbl: number; readonly pitGainBbl: number; readonly gasUnits: number;
  /** MWD gamma ray, 12 m behind the bit. */
  readonly gammaApi: number | null;
  readonly mudSg: number; readonly ecdBitSg: number; readonly ecdShoeSg: number;
  /** The plan's window at the bit, which is what the driller has to go on. */
  readonly planPoreSg: number; readonly planFractureSg: number; readonly shoeFractureSg: number;
  readonly casingPsi: number; readonly drillPipePsi: number; readonly chokePsi: number;
  readonly bitWear: number; readonly lossRateBblMin: number;
  readonly killProgress: number | null;
  /** How far the kill mud has got: down the string, then up the annulus (0–1 each), and its weight. */
  readonly kill: { readonly stringFraction: number; readonly annulusFraction: number; readonly killMudSg: number } | null;
  /** Metres drilled on the current stand, and how far through a connection (0–1) the rig is. */
  readonly standDrilledM: number;
  readonly connectionProgress: number | null;
  /** How far through a round trip for a new bit (0–1): out of the hole by 0.5, back on bottom at 1. */
  readonly tripProgress: number | null;
  /** What the rock really did. Not on any rig gauge: for the debrief, and for drawing the hole. */
  readonly truth: {
    readonly porePsi: number; readonly bhpPsi: number; readonly underbalancePsi: number; readonly influxRateBblMin: number; readonly influxInHoleBbl: number; readonly lossesBbl: number;
    /** Where the influx is (its bottom, MD m) and how much hole it fills (MD m); where it came in; where mud is being lost. */
    readonly influxMdM: number | null; readonly influxLengthM: number; readonly influxSourceMdM: number | null; readonly influxGas: boolean; readonly lossMdM: number | null;
  };
}

export type DrillCommand =
  | { readonly kind: "rig"; readonly wobKlbf?: number; readonly rpm?: number; readonly flowGpm?: number }
  | { readonly kind: "mud"; readonly sg: number }
  | { readonly kind: "drill" } | { readonly kind: "circulate" } | { readonly kind: "flow-check" }
  | { readonly kind: "shut-in" } | { readonly kind: "kill" } | { readonly kind: "open" }
  | { readonly kind: "lcm" } | { readonly kind: "trip" }
  | { readonly kind: "hazard"; readonly hazard: Hazard };

/** Seeded uniform random numbers in [0, 1) (mulberry32). */
function random(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

interface Rock { readonly drillability: number; readonly abrasiveness: number; readonly gammaApi: number; readonly permeable: boolean }
/** Rock behaviour by the lithology the plan writes, in words. A drillability of 1 drills about 18 m/h at 20 klbf on an 8½″ bit and 120 RPM. */
export function rockOf(formation: Formation | undefined): Rock {
  const words = (formation?.lithology ?? "").toLowerCase();
  if (/granite|basement|igneous|metamorph/.test(words)) return { drillability: 0.25, abrasiveness: 3, gammaApi: 150, permeable: /wash/.test(words) };
  if (/lime|carbonate|dolom|chalk/.test(words)) return { drillability: 0.6, abrasiveness: 1.2, gammaApi: 20, permeable: true };
  if (/sand/.test(words) && /shale|clay|mud/.test(words)) return { drillability: 1.2, abrasiveness: 1.6, gammaApi: 65, permeable: true };
  if (/sand/.test(words)) return { drillability: 1.5, abrasiveness: 2, gammaApi: 35, permeable: true };
  if (/clay|unconsolidated/.test(words)) return { drillability: 2.5, abrasiveness: 0.5, gammaApi: 75, permeable: false };
  if (/shale|mud/.test(words)) return { drillability: 1, abrasiveness: 0.6, gammaApi: 100, permeable: false };
  return { drillability: 1, abrasiveness: 1, gammaApi: 60, permeable: false };
}

const formationAt = (brief: WellDesignBrief, tvdM: number) => [...brief.geology.formations].sort((a, b) => a.topTvdM - b.topTvdM).filter((f) => f.topTvdM <= tvdM).at(-1);

/** The plan's named hazards, made real: shallow gas as an overpressured gas pocket, losses as a weak zone. Strength is seeded. */
export function hazardsFromPlan(brief: WellDesignBrief, seed = 1): Hazard[] {
  const next = random(seed * 7919 + 17);
  const hazards: Hazard[] = [];
  for (const formation of brief.geology.formations) {
    const note = (formation.hazard ?? "").toLowerCase();
    if (!note) continue;
    const topMdM = mdAtTvd(brief, formation.topTvdM) + 10 + next() * 40;
    if (/gas/.test(note)) hazards.push({ kind: "overpressure", topMdM, baseMdM: topMdM + 8 + next() * 12, extraSg: 0.05 + next() * 0.1, gas: true, label: `${formation.name}: ${formation.hazard}` });
    else if (/loss|lost/.test(note)) {
      const frac = pressureAt(brief, formation.topTvdM).fractureGradientSg;
      hazards.push({ kind: "weak-zone", topMdM, baseMdM: topMdM + 20 + next() * 30, fractureSg: frac - 0.12 - next() * 0.15, label: `${formation.name}: ${formation.hazard}` });
    }
  }
  return hazards;
}

/** Bingham-plastic friction, psi per ft (Bourgoyne et al. 1986, eqs. 4.57–4.67): laminar, or turbulent by the Reynolds number. */
function frictionPsiFt(flowGpm: number, ppg: number, mud: Mud, outerIn: number, innerIn: number, annulus: boolean): number {
  if (flowGpm <= 0) return 0;
  const d = annulus ? outerIn - innerIn : outerIn;
  const v = flowGpm / (2.448 * (annulus ? outerIn ** 2 - innerIn ** 2 : outerIn ** 2));
  const apparent = mud.pvCp + (annulus ? 5 : 6.66) * mud.ypLbf100ft2 * d / v;
  const reynolds = (annulus ? 757 : 928) * ppg * v * d / apparent;
  if (reynolds < 2100) return annulus ? mud.pvCp * v / (1000 * d ** 2) + mud.ypLbf100ft2 / (200 * d) : mud.pvCp * v / (1500 * d ** 2) + mud.ypLbf100ft2 / (225 * d);
  const f = 0.0791 / reynolds ** 0.25;
  return f * ppg * v ** 2 / ((annulus ? 21.1 : 25.8) * d);
}

const defaultString = (holeIn: number): DrillString => holeIn >= 16
  ? { pipeOdIn: 5.5, pipeIdIn: 4.67, pipeWeightLbFt: 24.7, bhaLengthM: 180, bhaOdIn: 9.5, bhaIdIn: 3, bhaWeightLbFt: 217 }
  : holeIn >= 10.5
    ? { pipeOdIn: 5, pipeIdIn: 4.276, pipeWeightLbFt: 22, bhaLengthM: 180, bhaOdIn: 8, bhaIdIn: 2.8125, bhaWeightLbFt: 150 }
    : { pipeOdIn: 5, pipeIdIn: 4.276, pipeWeightLbFt: 22, bhaLengthM: 180, bhaOdIn: 6.5, bhaIdIn: 2.8125, bhaWeightLbFt: 92 };
/** Typical pump rate for a hole size, gpm. */
export const defaultFlowGpm = (holeIn: number) => holeIn >= 20 ? 1200 : holeIn >= 16 ? 1100 : holeIn >= 10.5 ? 1000 : 500;
const defaultNozzles = (holeIn: number) => holeIn >= 16 ? [18, 18, 18, 18] : holeIn >= 10.5 ? [13, 13, 13, 13, 13, 13] : [12, 12, 12, 12, 12];

export class DrillingSimulator {
  readonly brief: WellDesignBrief;
  readonly section: CasingSection;
  readonly sectionIndex: number;
  readonly mud: Mud;
  readonly string: DrillString;
  readonly holeIn: number;
  readonly shoeMdM: number;
  readonly casingIdIn: number;
  readonly targetMdM: number;
  readonly hazards: Hazard[];
  readonly events: DrillEvent[] = [];
  readonly history: DrillReading[] = [];
  /** A reading every this many simulated seconds goes into `history`. */
  sampleEveryS = 10;
  private readonly next: () => number;
  private readonly tfaIn2: number;
  private readonly pit0: number;
  private readonly connections: boolean;
  private readonly phase: readonly [number, number, number];
  private t = 0;
  private nextSampleAt = 0;
  private bitMd: number; private holeMd: number; private lastConnectionMd: number;
  private mode: DrillMode = "drilling";
  private resumeAt = 0; private resumeMode: DrillMode = "drilling"; private tripStart = 0;
  private wob = 20; private rpm = 120; private flow = 600;
  private holeSg: number; private targetSg: number;
  private wear = 0;
  private influxBottomBbl = 0; private influxEntryPsi = 0; private influxMd = 0; private influxGas = false;
  /** Pressure at the influx, from the end of the last step: the influx's own height depends on it, so it lags one step rather than loop. */
  private influxPsi = 0;
  private influxSourceMd: number | null = null;
  private lossMd: number | null = null;
  private losses = 0; private lossRate = 0; private influxRate = 0;
  private sicp = 0; private shutAt = 0;
  private leakIn2 = 0;
  private lcmAt: number | null = null;
  private kill: { readonly sheet: KillSheet; progress: number } | null = null;
  private lastSheet: KillSheet | null = null;
  private tdCache = new Map<string, { rotTorque: number; rotHook: number }>();
  private alarms = new Set<string>();
  private reading: DrillReading;
  /** TVD at every metre of MD, so the hot loop never searches the survey. */
  private readonly tvdTable: Float64Array;
  private readonly topMds: readonly number[];

  constructor(setup: DrillingSimSetup) {
    const { brief, sectionIndex } = setup;
    const sections = [...brief.sections].sort((a, b) => a.shoeMdM - b.shoeMdM);
    const section = sections[sectionIndex];
    if (!section) throw new RangeError(`The plan has no casing section ${sectionIndex + 1}.`);
    const above = sections[sectionIndex - 1];
    this.brief = brief; this.section = section; this.sectionIndex = sectionIndex;
    this.holeIn = section.holeSizeIn;
    this.shoeMdM = above?.shoeMdM ?? 0;
    this.casingIdIn = above ? findPipe(above.odIn, above.weightLbFt)?.idIn ?? above.odIn - 0.75 : section.holeSizeIn;
    this.targetMdM = section.shoeMdM;
    this.mud = setup.mud ?? { pvCp: 18, ypLbf100ft2: 14 };
    this.string = setup.string ?? defaultString(this.holeIn);
    const nozzles = setup.nozzles32nds ?? defaultNozzles(this.holeIn);
    this.tfaIn2 = nozzles.reduce((sum, n) => sum + Math.PI / 4 * (n / 32) ** 2, 0);
    this.pit0 = setup.pitBbl ?? 500;
    this.connections = setup.connections ?? true;
    const seed = setup.seed ?? 1;
    this.next = random(seed);
    this.phase = [this.next() * 6.28, this.next() * 6.28, this.next() * 6.28];
    this.hazards = [...hazardsFromPlan(brief, seed), ...(setup.hazards ?? [])];
    this.tvdTable = new Float64Array(Math.ceil(Math.max(brief.totalDepthMdM, this.targetMdM)) + 2);
    for (let md = 0; md < this.tvdTable.length; md++) this.tvdTable[md] = tvdAtMd(brief, md);
    this.topMds = brief.geology.formations.map((f) => mdAtTvd(brief, f.topTvdM) + 2);
    this.bitMd = this.holeMd = this.lastConnectionMd = this.shoeMdM + 3;
    this.holeSg = this.targetSg = section.mudWeightSg;
    // Typical pump rates by hole size: 26″ 1,200, 17½″ 1,100, 12¼″ 1,000, 8½″ 500 gpm.
    this.flow = defaultFlowGpm(this.holeIn);
    this.wob = Math.min(55, Math.round(2.6 * this.holeIn));
    this.event("info", "spud", `Drilling out of the ${above ? above.label : "surface"} shoe at ${Math.round(this.shoeMdM)} m on ${section.mudWeightSg.toFixed(2)} SG mud, for the ${section.label} at ${Math.round(this.targetMdM)} m.`);
    this.reading = this.read();
    this.history.push(this.reading);
    this.nextSampleAt = this.sampleEveryS;
  }

  // ---- the rock ----
  private tvd(md: number) {
    const x = Math.max(0, Math.min(this.tvdTable.length - 1.001, md)), i = Math.floor(x);
    return this.tvdTable[i]! + (this.tvdTable[i + 1]! - this.tvdTable[i]!) * (x - i);
  }
  /** Inclination, degrees, from the survey through the TVD table: cos i = dTVD / dMD. */
  private inclination(md: number) { const d = this.tvd(md + 1) - this.tvd(md); return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI; }
  /**
   * Annular velocity (m/min) that keeps cuttings moving, as a field rule of thumb (not a cuttings-
   * transport model): about 30 m/min vertical in 8½–12¼″ hole, less in big top holes drilled with
   * viscous mud and sweeps (20 at 17½″, 12 at 26″), and more with inclination, most at 40–60° where
   * cuttings slide back down the low side. Pipe rotation helps; see `cleaningNeed`.
   */
  cleaningVelocityAt(md: number) {
    const i = this.inclination(md) * Math.PI / 180, hole = this.holeIn;
    const base = hole <= 12.25 ? 30 : hole <= 17.5 ? 30 - (hole - 12.25) / 5.25 * 10 : Math.max(12, 20 - (hole - 17.5) / 8.5 * 8);
    return base * (1 + 0.67 * Math.sin(2 * Math.min(i, Math.PI / 2)) + 0.33 * Math.sin(i));
  }
  /** What the driller has to beat: rotating at 120 RPM or more takes about 15 % off. */
  private cleaningNeed(md: number) { return this.cleaningVelocityAt(md) * (this.rpm >= 120 ? 0.85 : 1); }
  private wobble(tvd: number) { return 0.012 * Math.sin(tvd / 137 + this.phase[0]) + 0.008 * Math.sin(tvd / 53 + this.phase[1]); }
  private poreSg(md: number) {
    const tvd = this.tvd(md);
    let sg = pressureAt(this.brief, tvd).porePressureSg + this.wobble(tvd);
    for (const h of this.hazards) if (h.kind === "overpressure" && md >= h.topMdM && md <= h.baseMdM) sg = Math.max(sg, pressureAt(this.brief, tvd).porePressureSg + h.extraSg);
    return sg;
  }
  private fractureSg(md: number) {
    const tvd = this.tvd(md);
    let sg = pressureAt(this.brief, tvd).fractureGradientSg + this.wobble(tvd + 400) * 1.5;
    for (const h of this.hazards) if (h.kind === "weak-zone" && md >= h.topMdM && md <= h.baseMdM) sg = Math.min(sg, h.fractureSg + (this.lcmCured(h) ? 0.12 : 0));
    return sg;
  }
  private lcmCured(h: Hazard) { return this.lcmAt !== null && this.t >= this.lcmAt && h.kind === "weak-zone" && h.topMdM <= this.holeMd; }
  private permeable(md: number) {
    if (this.hazards.some((h) => h.kind === "overpressure" && md >= h.topMdM && md <= h.baseMdM)) return { permeable: true, gas: true, pi: 0.012 };
    const formation = formationAt(this.brief, this.tvd(md));
    const rock = rockOf(formation);
    const fluid = this.brief.fluids?.type;
    return { permeable: rock.permeable, gas: formation?.reservoir ? fluid === "gas" || fluid === "condensate" : /gas/i.test(formation?.hazard ?? ""), pi: formation?.reservoir ? 0.006 : 0.003 };
  }

  // ---- the well ----
  private pipePsi(flow: number, ppg: number) {
    const bitFt = this.bitMd * FT, bhaFt = Math.min(bitFt, this.string.bhaLengthM * FT);
    const surface = 0.00012 * ppg * flow ** 1.8 / 10;
    const bitArea = this.tfaIn2 + this.leakIn2;
    const bit = flow > 0 ? ppg * flow ** 2 / (10858 * bitArea ** 2) : 0;
    return { string: surface + frictionPsiFt(flow, ppg, this.mud, this.string.pipeIdIn, 0, false) * (bitFt - bhaFt) + frictionPsiFt(flow, ppg, this.mud, this.string.bhaIdIn, 0, false) * bhaFt, bit };
  }
  /** Annular friction between two measured depths (m), the string hanging with the bit at `bitMd`. */
  private annulusPsi(flow: number, ppg: number, fromMd: number, toMd: number) {
    if (flow <= 0 || toMd <= fromMd) return 0;
    const bhaTop = this.bitMd - this.string.bhaLengthM;
    const cuts = [fromMd, toMd, this.shoeMdM, bhaTop].filter((x) => x > fromMd && x < toMd).sort((a, b) => a - b);
    const marks = [fromMd, ...cuts, toMd];
    let psi = 0;
    for (let i = 0; i < marks.length - 1; i++) {
      const mid = (marks[i]! + marks[i + 1]!) / 2;
      const outer = mid < this.shoeMdM ? this.casingIdIn : this.holeIn, inner = mid > bhaTop ? this.string.bhaOdIn : this.string.pipeOdIn;
      psi += frictionPsiFt(flow, ppg, this.mud, outer, inner, true) * (marks[i + 1]! - marks[i]!) * FT;
    }
    return psi;
  }
  /** Annular velocity, m/min, where it is slowest in the open hole: round the drill pipe above the BHA (or the BHA, if that is all the open hole holds). */
  private annularVelocity(flowGpm: number) {
    const openAbove = this.holeMd - this.string.bhaLengthM > this.shoeMdM;
    return flowGpm / GPM_PER_BBL_MIN / capacityBblPerM(this.holeIn, openAbove ? this.string.pipeOdIn : this.string.bhaOdIn);
  }
  private annularCapacity(md: number) { return capacityBblPerM(md < this.shoeMdM ? this.casingIdIn : this.holeIn, md > this.bitMd - this.string.bhaLengthM ? this.string.bhaOdIn : this.string.pipeOdIn); }
  private volumes() {
    const bha = Math.min(this.bitMd, this.string.bhaLengthM);
    const stringBbl = (this.string.pipeIdIn ** 2 * (this.bitMd - bha) + this.string.bhaIdIn ** 2 * bha) / 1029.4 * FT;
    const bhaTop = this.bitMd - bha, shoe = Math.min(this.shoeMdM, this.bitMd);
    const lengths = (from: number, to: number) => Math.max(0, to - from);
    const annulusBbl = capacityBblPerM(this.casingIdIn, this.string.pipeOdIn) * lengths(0, Math.min(shoe, bhaTop)) + capacityBblPerM(this.casingIdIn, this.string.bhaOdIn) * lengths(bhaTop, shoe)
      + capacityBblPerM(this.holeIn, this.string.pipeOdIn) * lengths(shoe, bhaTop) + capacityBblPerM(this.holeIn, this.string.bhaOdIn) * lengths(Math.max(shoe, bhaTop), this.bitMd);
    return { stringBbl, annulusBbl };
  }
  /** Height (TVD, m) the influx occupies, and the pressure reduction it makes in the annulus. */
  private influxColumn() {
    if (this.influxBottomBbl <= 0) return { insituBbl: 0, heightM: 0, reliefPsi: 0 };
    const pressure = Math.max(200, this.influxPsi || this.influxEntryPsi);
    const insituBbl = this.influxGas ? this.influxBottomBbl * this.influxEntryPsi / pressure : this.influxBottomBbl;
    const heightMd = insituBbl / this.annularCapacity(this.influxMd);
    // Its vertical height, from the survey: the relief depends on TVD, and a slug in a 40° hole is far shorter than its length.
    const heightM = this.tvd(this.influxMd) - this.tvd(Math.max(0, this.influxMd - heightMd));
    const density = this.influxGas ? 0.25 : this.brief.fluids?.type === "water" ? 1.03 : 0.8;
    return { insituBbl, heightM, reliefPsi: Math.max(0, this.holeSg - density) * PSI_PER_M_PER_SG * heightM };
  }
  /** Annulus mud: what is in the hole, or during a kill the kill mud that has come round. */
  private annulusSg() {
    if (!this.kill) return this.holeSg;
    const { stringBbl, annulusBbl } = this.volumes();
    const pumped = this.kill.progress * (stringBbl + annulusBbl);
    const fraction = Math.max(0, Math.min(1, (pumped - stringBbl) / annulusBbl));
    return this.holeSg + (this.kill.sheet.killMudSg - this.holeSg) * fraction;
  }
  private stringSg() {
    if (!this.kill) return this.holeSg;
    const { stringBbl, annulusBbl } = this.volumes();
    const fraction = Math.min(1, this.kill.progress * (stringBbl + annulusBbl) / stringBbl);
    return this.holeSg + (this.kill.sheet.killMudSg - this.holeSg) * fraction;
  }
  private killFractions() {
    if (!this.kill) return null;
    const { stringBbl, annulusBbl } = this.volumes();
    const pumped = this.kill.progress * (stringBbl + annulusBbl);
    return { stringFraction: Math.min(1, pumped / stringBbl), annulusFraction: Math.max(0, Math.min(1, (pumped - stringBbl) / annulusBbl)), killMudSg: this.kill.sheet.killMudSg };
  }
  private flowNow() { return this.mode === "drilling" || this.mode === "circulating" || this.mode === "killing" ? (this.mode === "killing" ? this.kill?.sheet.killFlowGpm ?? 0 : this.flow) : 0; }
  /** Wellbore pressure, psi, at a measured depth. */
  private pressureAt(md: number, withInflux = true) {
    const tvd = this.tvd(Math.min(md, this.bitMd));
    const sg = this.annulusSg();
    // The influx lightens the column above any depth it sits at or above.
    const relief = withInflux && this.influxBottomBbl > 0 && this.influxMd <= md + 1 ? this.influxColumn().reliefPsi : 0;
    const flow = this.flowNow();
    const friction = this.annulusPsi(flow, sg * PPG_PER_SG, 0, Math.min(md, this.bitMd));
    const back = this.mode === "shut-in" ? this.sicp : this.mode === "killing" ? this.chokePsi() : 0;
    return sg * PSI_PER_M_PER_SG * tvd - relief + friction + back;
  }
  private killTargetPsi() { return this.kill ? (this.kill.sheet.sidppPsi + this.kill.sheet.mudSg * PSI_PER_M_PER_SG * this.kill.sheet.bitTvdM) + 50 : 0; }
  private chokePsi() {
    if (!this.kill) return 0;
    const tvd = this.tvd(this.bitMd), sg = this.annulusSg();
    const relief = this.influxBottomBbl > 0 ? this.influxColumn().reliefPsi : 0;
    const friction = this.annulusPsi(this.kill.sheet.killFlowGpm, sg * PPG_PER_SG, 0, this.bitMd);
    return Math.max(0, this.killTargetPsi() - (sg * PSI_PER_M_PER_SG * tvd - relief + friction));
  }
  private torqueHook() {
    const key = `${Math.round(this.bitMd / 5)}:${this.holeSg.toFixed(2)}`;
    const cached = this.tdCache.get(key);
    if (cached) return cached;
    const stations: TorqueDragStation[] = this.brief.trajectory?.length
      ? this.brief.trajectory.map((s) => ({ mdFt: s.mdM * FT, inclinationDeg: s.inclinationDeg, azimuthDeg: s.azimuthDeg }))
      : [{ mdFt: 0, inclinationDeg: 0, azimuthDeg: 0 }, { mdFt: this.brief.totalDepthMdM * FT, inclinationDeg: 0, azimuthDeg: 0 }];
    const bha = Math.min(this.bitMd, this.string.bhaLengthM);
    const segments: StringSegment[] = [{ lengthFt: bha * FT, weightLbFt: this.string.bhaWeightLbFt, odIn: this.string.bhaOdIn }, { lengthFt: Math.max(0, this.bitMd - bha) * FT, weightLbFt: this.string.pipeWeightLbFt, odIn: this.string.pipeOdIn }];
    const result = torqueDrag({ survey: stations, string: segments, bitMdFt: this.bitMd * FT, mudWeightPpg: this.holeSg * PPG_PER_SG, frictionCased: 0.25, frictionOpen: 0.35, shoeMdFt: this.shoeMdM * FT, stepFt: 60 }, "rotating");
    const value = { rotTorque: result.torqueFtLbf, rotHook: result.hookloadLb };
    if (this.tdCache.size > 2000) this.tdCache.clear();
    this.tdCache.set(key, value);
    return value;
  }

  private event(level: DrillEvent["level"], code: string, text: string) { this.events.push({ timeS: this.t, level, code, text }); }
  private alarm(code: string, on: boolean, level: DrillEvent["level"], text: string) {
    if (on && !this.alarms.has(code)) { this.alarms.add(code); this.event(level, code, text); }
    if (!on) this.alarms.delete(code);
  }

  // ---- commands ----
  command(command: DrillCommand): void {
    const busy = this.mode === "blowout" || this.mode === "section-td";
    if (busy && command.kind !== "hazard") return;
    switch (command.kind) {
      case "rig":
        if (command.wobKlbf !== undefined) this.wob = Math.max(0, Math.min(60, command.wobKlbf));
        if (command.rpm !== undefined) this.rpm = Math.max(0, Math.min(220, command.rpm));
        if (command.flowGpm !== undefined) this.flow = Math.max(0, Math.min(1400, command.flowGpm));
        return;
      case "mud":
        this.targetSg = Math.max(0.9, Math.min(2.4, command.sg));
        this.event("info", "mud", `Mud weight up to ${this.targetSg.toFixed(2)} SG: it reaches the hole as it is circulated in.`);
        return;
      case "drill": if (this.canMove()) { this.mode = "drilling"; this.event("info", "drill", "Back on bottom, drilling."); } return;
      case "circulate": if (this.canMove()) { this.mode = "circulating"; this.event("info", "circulate", "Off bottom, circulating."); } return;
      case "flow-check": if (this.canMove()) { this.mode = "flow-check"; this.event("info", "flow-check", "Pumps off, off bottom: flow check."); } return;
      case "shut-in":
        if (this.mode === "shut-in" || this.mode === "killing") return;
        this.mode = "shut-in"; this.shutAt = this.t; this.sicp = 0;
        this.event("warning", "shut-in", `Well shut in at ${Math.round(this.bitMd)} m with ${this.pitGain().toFixed(1)} bbl gained.`);
        return;
      case "kill": {
        if (this.mode !== "shut-in") return;
        const sheet = this.killSheet();
        if (!sheet) { this.event("info", "kill-wait", "Let the pressures settle before starting the kill."); return; }
        this.kill = { sheet, progress: 0 }; this.mode = "killing"; this.lastSheet = sheet;
        this.event("warning", "kill", `Kill started: ${sheet.killMudSg.toFixed(2)} SG kill mud at ${Math.round(sheet.killFlowGpm)} gpm, ICP ${Math.round(sheet.icpPsi)} psi falling to FCP ${Math.round(sheet.fcpPsi)} psi.`);
        return;
      }
      case "open":
        if (this.mode === "killed" || (this.mode === "shut-in" && this.sicp < 1)) { this.mode = "circulating"; this.event("info", "open", "Well open, circulating."); }
        return;
      case "lcm":
        if (this.lcmAt !== null && this.t < this.lcmAt) return;
        this.lcmAt = this.t + this.volumes().stringBbl / Math.max(1, this.flow / GPM_PER_BBL_MIN) + 600;
        this.event("info", "lcm", "Lost-circulation pill pumped: it reaches the open hole in about one string volume.");
        return;
      case "trip":
        if (!this.canMove()) return;
        this.mode = "tripping"; this.resumeMode = "circulating"; this.tripStart = this.t;
        this.resumeAt = this.t + (this.bitMd * 2) / 300 * 3600;
        this.event("info", "trip", `Tripping for a new bit: about ${((this.bitMd * 2) / 300).toFixed(1)} h out and back.`);
        return;
      case "hazard":
        this.hazards.push(command.hazard);
        this.event("info", "hazard", `Added: ${command.hazard.label}.`);
        return;
    }
  }
  private canMove() { return !["shut-in", "killing", "blowout", "section-td", "tripping"].includes(this.mode); }
  private pitGain() { return this.influxColumn().insituBbl - this.losses; }

  /** The kill sheet once the shut-in pressures have settled (two minutes, and the well no longer flowing). */
  killSheet(): KillSheet | null {
    if (this.mode === "killing" && this.kill) return this.kill.sheet;
    if (this.mode !== "shut-in" || this.t - this.shutAt < 120 || this.influxRate > 0.05) return null;
    const bitTvdM = this.tvd(this.bitMd);
    const bhp = this.pressureAt(this.bitMd);
    const sidpp = Math.max(0, bhp - this.holeSg * PSI_PER_M_PER_SG * bitTvdM);
    const killMudSg = Math.ceil((this.holeSg + sidpp / (PSI_PER_M_PER_SG * bitTvdM)) * 100) / 100;
    const killFlowGpm = Math.round(this.flow / 3 / 10) * 10 || 150;
    const ppg = this.holeSg * PPG_PER_SG;
    const pipe = this.pipePsi(killFlowGpm, ppg);
    const scrPsi = pipe.string + pipe.bit + this.annulusPsi(killFlowGpm, ppg, 0, this.bitMd);
    const { stringBbl, annulusBbl } = this.volumes();
    const column = this.influxColumn();
    const gradient = column.heightM > 5 ? (this.holeSg * PSI_PER_M_PER_SG * column.heightM - (this.sicp - sidpp)) / (column.heightM * FT) : null;
    return {
      sidppPsi: sidpp, sicpPsi: this.sicp, bitTvdM, mudSg: this.holeSg, killMudSg, killFlowGpm, scrPsi, icpPsi: sidpp + scrPsi, fcpPsi: scrPsi * killMudSg / this.holeSg,
      stringBbl, annulusBbl, influxBbl: column.insituBbl, influxGradientPsiFt: gradient,
      influxIs: gradient === null ? "not known" : gradient < 0.25 ? "gas" : gradient < 0.4 ? "oil or condensate" : "water",
    };
  }

  // ---- time ----
  /**
   * Advance the simulation by `seconds`, in internal steps of `dt` simulated seconds (1, 2, 5 or 10;
   * larger steps run faster at high speed). Every rate in the model is per second, so a step scales
   * linearly; influx, losses and the kill stay well resolved up to 10 s.
   */
  step(seconds: number, dt: 1 | 2 | 5 | 10 = 1): DrillReading {
    for (let done = 0; done < seconds; done += dt) {
      if (this.mode === "blowout" || this.mode === "section-td") break;
      this.tick(dt);
      // Sample on a schedule rather than on multiples of the step, which a change of step would skip.
      if (this.t >= this.nextSampleAt) { this.history.push(this.read()); this.nextSampleAt = this.t - (this.t % this.sampleEveryS) + this.sampleEveryS; }
    }
    this.reading = this.read();
    return this.reading;
  }
  get now(): DrillReading { return this.reading; }

  private tick(dt: number) {
    this.t += dt;
    // Timed modes end on their own.
    if ((this.mode === "connection" || this.mode === "tripping") && this.t >= this.resumeAt) {
      if (this.mode === "tripping") { this.wear = 0; this.event("info", "new-bit", "New bit on bottom."); }
      this.mode = this.mode === "tripping" ? this.resumeMode : "drilling";
    }
    for (const h of this.hazards) if (h.kind === "washout" && this.t >= h.atS && this.t - dt < h.atS) { this.leakIn2 = Math.max(this.leakIn2, 0.02); this.event("info", "washout-start", "(debrief) A washout opened in the drill pipe."); }
    if (this.leakIn2 > 0) this.leakIn2 += 0.06 / 3600 * dt;

    const flow = this.flowNow();
    const onBottom = this.mode === "drilling";
    // Mud weight changes reach the hole as it is circulated.
    if (flow > 0 && this.holeSg !== this.targetSg && !this.kill) {
      const { stringBbl, annulusBbl } = this.volumes();
      const exchange = (flow / GPM_PER_BBL_MIN / 60) * dt / (stringBbl + annulusBbl);
      this.holeSg += (this.targetSg - this.holeSg) * Math.min(1, exchange);
      if (Math.abs(this.holeSg - this.targetSg) < 0.002) this.holeSg = this.targetSg;
    }

    // Drill.
    if (onBottom && this.wob > 0 && this.rpm > 0 && flow > 0) {
      const tvd = this.tvd(this.holeMd);
      const rock = rockOf(formationAt(this.brief, tvd));
      const overbalance = Math.max(0, this.pressureAt(this.holeMd) - this.poreSg(this.holeMd) * PSI_PER_M_PER_SG * tvd);
      // Annular velocity, m/min: below about 30 the cuttings are not carried and the bit balls.
      const cleaning = this.annularVelocity(flow) >= this.cleaningNeed(this.holeMd - 1) ? 1 : 0.6;
      const rop = 18 * rock.drillability * ((this.wob / this.holeIn) / (20 / 8.5)) * (this.rpm / 120) ** 0.6 * Math.exp(-0.0006 * overbalance) * (1 - 0.7 * this.wear / 8) * cleaning * (0.9 + 0.2 * this.next());
      this.holeMd += Math.max(0, rop) / 3600 * dt;
      this.bitMd = this.holeMd;
      const abrasive = this.hazards.some((h) => h.kind === "abrasive" && this.holeMd >= h.topMdM && this.holeMd <= h.baseMdM) ? 4 : 1;
      this.wear = Math.min(8, this.wear + 0.04 / 3600 * dt * (this.rpm / 120) * (this.wob / 20) * rock.abrasiveness * abrasive);
      if (this.holeMd >= this.targetMdM) { this.holeMd = this.bitMd = this.targetMdM; this.mode = "section-td"; this.event("info", "td", `Section TD at ${Math.round(this.targetMdM)} m: ready to run the ${this.section.label}.`); }
      else if (this.connections && this.holeMd - this.lastConnectionMd >= 28.5) {
        this.lastConnectionMd = this.holeMd; this.mode = "connection"; this.resumeAt = this.t + 180;
      }
    }

    // Influx: from every permeable depth exposed where the well pressure is below the pore pressure.
    this.influxRate = 0;
    this.influxSourceMd = null;
    if (this.mode !== "killing") {
      for (const md of this.exposedDepths()) {
        const zone = this.permeable(md);
        if (!zone.permeable) continue;
        const pore = this.poreSg(md) * PSI_PER_M_PER_SG * this.tvd(md);
        const under = pore - this.pressureAt(md);
        if (under <= 0) continue;
        const rate = Math.min(30, zone.pi * under);
        if (rate > this.influxRate) { this.influxRate = rate; this.influxSourceMd = md; if (this.influxBottomBbl <= 0) { this.influxMd = md; this.influxEntryPsi = this.influxPsi = pore; this.influxGas = zone.gas; } }
      }
    }
    if (this.influxRate > 0) {
      const add = this.influxRate / 60 * dt;
      if (this.mode === "shut-in") this.sicp += add * 120;
      this.influxBottomBbl += add;
    }
    // Influx moves: carried by circulation, or migrating up a shut-in well if it is gas.
    if (this.influxBottomBbl > 0) {
      if (flow > 0) this.influxMd -= (flow / GPM_PER_BBL_MIN / 60) / this.annularCapacity(this.influxMd) * dt;
      else if (this.influxGas && (this.mode === "shut-in" || this.mode === "flow-check" || this.mode === "connection")) {
        const rise = 300 / 3600 * dt, before = this.tvd(this.influxMd);
        this.influxMd -= rise;
        // Shut in, gas rising keeps its pressure, so the well pressure grows by the mud column it rose through, in TVD.
        if (this.mode === "shut-in") this.sicp += this.holeSg * PSI_PER_M_PER_SG * Math.max(0, before - this.tvd(this.influxMd));
      }
      if (this.influxMd <= 0) {
        const surfaced = this.influxColumn().insituBbl;
        if (this.mode === "killing") this.event("info", "influx-out", `Influx out through the choke (${surfaced.toFixed(1)} bbl at surface).`);
        else if (surfaced > 25 && this.influxGas) { this.mode = "blowout"; this.event("disaster", "blowout", `Blowout: gas reached the rig floor with the well open, after ${this.influxBottomBbl.toFixed(0)} bbl of influx (at bottom-hole pressure) had been let in.`); }
        else this.event("warning", "gas-at-surface", `Gas-cut mud at surface (${surfaced.toFixed(1)} bbl).`);
        this.influxBottomBbl = 0; this.influxMd = 0;
      }
    }

    // Losses: wherever the well pressure is above the fracture pressure.
    this.lossRate = 0;
    this.lossMd = null;
    let worst = 0;
    for (const md of this.exposedDepths(true)) {
      const frac = this.fractureSg(md) * PSI_PER_M_PER_SG * this.tvd(md);
      const over = this.pressureAt(md) - frac;
      if (over <= 0) continue;
      const rate = (this.hazards.some((h) => h.kind === "weak-zone" && md >= h.topMdM && md <= h.baseMdM) ? 0.02 : 0.004) * over;
      this.lossRate += rate;
      if (rate > worst) { worst = rate; this.lossMd = md; }
    }
    this.lossRate = Math.min(40, this.lossRate);
    this.losses += this.lossRate / 60 * dt;

    // Shut in: pressure stops building once the well pressure meets the rock's.
    if (this.mode === "shut-in" && this.influxRate === 0 && this.influxBottomBbl === 0 && this.t - this.shutAt > 60) this.sicp = Math.max(0, this.sicp - 5 * dt);

    // The kill: pump the volumes round, then the well is dead.
    if (this.kill) {
      const { stringBbl, annulusBbl } = this.volumes();
      this.kill.progress = Math.min(1, this.kill.progress + (this.kill.sheet.killFlowGpm / GPM_PER_BBL_MIN / 60) * dt / (stringBbl + annulusBbl));
      if (this.kill.progress >= 1) {
        this.holeSg = this.targetSg = this.kill.sheet.killMudSg; this.kill = null; this.sicp = 0; this.influxBottomBbl = 0;
        this.mode = "killed";
        this.event("info", "killed", `Well dead on ${this.holeSg.toFixed(2)} SG. Open it and carry on.`);
      }
    }

    if (this.influxBottomBbl > 0) this.influxPsi = this.pressureAt(this.influxMd);
    this.watch();
  }

  /** Depths to check for influx and losses: the bit, the shoe, and every hazard the hole has reached. */
  private exposedDepths(includeShoe = false) {
    const depths = new Set<number>([this.holeMd - 1]);
    if (includeShoe && this.shoeMdM > 0) depths.add(this.shoeMdM + 1);
    for (const h of this.hazards) if ("topMdM" in h && h.topMdM <= this.holeMd) depths.add(Math.min(this.holeMd - 0.5, (h.topMdM + h.baseMdM) / 2));
    for (const md of this.topMds) if (md > this.shoeMdM && md < this.holeMd) depths.add(md);
    return [...depths].filter((md) => md >= this.shoeMdM);
  }

  /** The alarms a rig's monitoring raises from surface readings alone. */
  private watch() {
    const r = this.read();
    const pumping = r.flowInGpm > 0;
    this.alarm("pit-gain", r.pitGainBbl > 5 && this.mode !== "shut-in" && this.mode !== "killing", "alarm", `Pit gain ${r.pitGainBbl.toFixed(1)} bbl: stop and flow check.`);
    this.alarm("flow-out", pumping && r.flowOutGpm > r.flowInGpm * 1.1, "alarm", `Flow out ${Math.round(r.flowOutGpm / r.flowInGpm * 100)} % of flow in.`);
    this.alarm("flowing", !pumping && r.flowOutGpm > 5 && this.mode !== "shut-in" && this.mode !== "killing", "alarm", "The well is flowing with the pumps off: shut it in.");
    this.alarm("losses", r.lossRateBblMin > 0.5, "alarm", `Losses: ${r.lossRateBblMin.toFixed(1)} bbl/min going to the formation.`);
    this.alarm("ecd", r.ecdShoeSg > r.shoeFractureSg - 0.02 && pumping, "warning", `ECD at the shoe ${r.ecdShoeSg.toFixed(2)} SG is near its fracture gradient of ${r.shoeFractureSg.toFixed(2)} SG.`);
    this.alarm("spp", this.leakIn2 > 0.05, "warning", "Standpipe pressure falling at a steady flow: check for a washout.");
    this.alarm("wear", this.wear > 6, "warning", "Bit worn: ROP is falling. Trip for a new bit.");
    const need = this.cleaningNeed(this.holeMd - 1), have = this.annularVelocity(this.flowNow());
    this.alarm("cleaning", this.mode === "drilling" && have < need, "warning", `Hole cleaning: ${Math.round(have)} m/min annular velocity at ${Math.round(this.inclination(this.holeMd - 1))}° needs about ${Math.round(need)}. Raise the flow.`);
    this.alarm("gas", r.gasUnits > 150, "warning", `Background gas ${Math.round(r.gasUnits)} units.`);
    this.alarm("migration", this.mode === "shut-in" && this.influxGas && this.influxBottomBbl > 0 && this.t - this.shutAt > 600, "warning", "Shut-in pressures still rising: gas is migrating. Start the kill.");
  }

  private read(): DrillReading {
    const flow = this.flowNow();
    const bitTvd = this.tvd(this.bitMd);
    const shoeTvd = this.tvd(this.shoeMdM);
    const column = this.influxColumn();
    const pipe = this.pipePsi(flow, this.stringSg() * PPG_PER_SG);
    const annulus = this.annulusPsi(flow, this.annulusSg() * PPG_PER_SG, 0, this.bitMd);
    const bhp = this.pressureAt(this.bitMd);
    const killing = this.mode === "killing" && this.kill;
    const drillPipe = this.mode === "shut-in" ? Math.max(0, bhp - this.holeSg * PSI_PER_M_PER_SG * bitTvd) : killing ? Math.max(0, this.killTargetPsi() + pipe.string + pipe.bit - this.stringSg() * PSI_PER_M_PER_SG * bitTvd) : 0;
    const spp = this.mode === "shut-in" ? drillPipe : killing ? drillPipe : flow > 0 ? pipe.string + pipe.bit + annulus : 0;
    const td = this.torqueHook();
    const rotating = this.mode === "drilling" || this.mode === "circulating";
    const onBottom = this.mode === "drilling";
    const torque = rotating ? td.rotTorque + (onBottom ? 0.25 * this.wob * 1000 * (this.holeIn / 12) / 3 : 0) : 0;
    const rock = rockOf(formationAt(this.brief, bitTvd));
    const reservoirGas = formationAt(this.brief, bitTvd)?.reservoir ? 60 : 0;
    const influxGas = column.insituBbl > 0 && this.influxMd < 300 ? column.insituBbl * 40 : 0;
    const expansion = this.influxGas && flow > 0 && column.insituBbl > 0 ? column.insituBbl * 0.002 * GPM_PER_BBL_MIN : 0;
    const flowOut = this.mode === "shut-in" || this.mode === "killing" ? (killing ? flow : 0) : Math.max(0, flow + (this.influxRate - this.lossRate) * GPM_PER_BBL_MIN + expansion);
    const sensorMd = this.bitMd - 12;
    const recentRop = this.history.length > 6 ? (this.holeMd - this.history.at(-6)!.holeMdM) / ((this.t - this.history.at(-6)!.timeS) / 3600 || 1) : 0;
    return {
      timeS: this.t, mode: this.mode, bitMdM: this.bitMd, holeMdM: this.holeMd, bitTvdM: bitTvd, formation: formationAt(this.brief, bitTvd)?.name ?? "—",
      onBottom, pumpsOn: flow > 0, rotating, ropMh: onBottom ? Math.max(0, recentRop) : 0, wobKlbf: onBottom ? this.wob : 0, rpm: rotating ? this.rpm : 0,
      // Hookload carries the travelling block too, taken as 60 klb.
      torqueKftLbf: torque / 1000, hookloadKlb: (td.rotHook - (onBottom ? this.wob * 1000 : 0)) / 1000 + 60,
      flowInGpm: flow, flowOutGpm: flowOut, sppPsi: spp, pitBbl: this.pit0 + column.insituBbl - this.losses, pitGainBbl: column.insituBbl - this.losses,
      gasUnits: (flow > 0 ? 8 + rock.gammaApi * 0.05 + reservoirGas : 2) + influxGas, gammaApi: sensorMd > this.shoeMdM ? rockOf(formationAt(this.brief, this.tvd(sensorMd))).gammaApi * (0.92 + 0.16 * this.next()) : null,
      mudSg: this.holeSg, ecdBitSg: bitTvd > 0 ? bhp / (PSI_PER_M_PER_SG * bitTvd) : this.holeSg, ecdShoeSg: shoeTvd > 0 ? this.pressureAt(this.shoeMdM) / (PSI_PER_M_PER_SG * shoeTvd) : this.holeSg,
      planPoreSg: pressureAt(this.brief, bitTvd).porePressureSg, planFractureSg: pressureAt(this.brief, bitTvd).fractureGradientSg,
      shoeFractureSg: pressureAt(this.brief, Math.max(1, shoeTvd)).fractureGradientSg,
      casingPsi: this.mode === "shut-in" ? this.sicp : killing ? this.chokePsi() : 0, drillPipePsi: drillPipe, chokePsi: killing ? this.chokePsi() : 0,
      bitWear: this.wear, lossRateBblMin: this.lossRate, killProgress: this.kill ? this.kill.progress : null, kill: this.killFractions(),
      standDrilledM: this.holeMd - this.lastConnectionMd, connectionProgress: this.mode === "connection" ? Math.max(0, Math.min(1, 1 - (this.resumeAt - this.t) / 180)) : null,
      tripProgress: this.mode === "tripping" ? Math.max(0, Math.min(1, (this.t - this.tripStart) / Math.max(1, this.resumeAt - this.tripStart))) : null,
      truth: {
        porePsi: this.poreSg(this.bitMd) * PSI_PER_M_PER_SG * bitTvd, bhpPsi: bhp, underbalancePsi: this.poreSg(this.bitMd) * PSI_PER_M_PER_SG * bitTvd - bhp, influxRateBblMin: this.influxRate, influxInHoleBbl: column.insituBbl, lossesBbl: this.losses,
        influxMdM: this.influxBottomBbl > 0 ? this.influxMd : null, influxLengthM: column.insituBbl > 0 ? column.insituBbl / this.annularCapacity(this.influxMd) : 0,
        influxSourceMdM: this.influxSourceMd, influxGas: this.influxGas, lossMdM: this.lossRate > 0.05 ? this.lossMd : null,
      },
    };
  }

  /** The kill sheet worked out when the kill began, for the debrief. */
  get lastKillSheet(): KillSheet | null { return this.lastSheet; }
}
