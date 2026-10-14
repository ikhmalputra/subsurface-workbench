import forgeData from "./forge-data.json" with { type: "json" };
import { forgeOperations } from "./records.ts";
import { feetToMetres } from "./units.ts";
import {
  analyzeSection,
  defaultDesignBasis,
  PPG_PER_SG,
  mdAtTvd,
  pressureAt,
  temperatureAt,
  tvdAtMd,
  validateDesign,
  type CasingSection,
  type DesignChange,
  type DesignIssue,
  type InputSource,
  type IntegrityTest,
  type WellDesignBrief,
} from "./well-design.ts";

const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;
const ppgToSg = (ppg: number) => round2(ppg / PPG_PER_SG);

/** One documented event on an offset well: a test, loss, stuck pipe, failed run … with where it came from. */
export interface OffsetEvent {
  readonly kind: "integrity-test" | "losses" | "temperature" | "problem-run" | "failed-run";
  readonly text: string;
  readonly mdM: number | null;
  readonly date?: string;
  readonly source: string;
}

/** How a hole section was actually drilled on the offset: the evidence a reused design leans on. */
export interface OffsetSectionRecord {
  readonly sectionId: string;
  readonly holeSizeIn: number;
  readonly topMdM: number;
  readonly baseMdM: number;
  readonly days: number | null;
  readonly runCount: number | null;
  readonly problemRuns: number | null;
  readonly mudWeightSg: { readonly min: number; readonly max: number } | null;
  readonly avgRopMPerH: number | null;
  readonly events: readonly OffsetEvent[];
}

/**
 * A previous well that can be compared with and reused. `drilled` wells carry as-drilled evidence;
 * `design` wells are earlier plans. `documented` comes from published records, `user` from your own saves.
 */
export interface OffsetWell {
  readonly id: string;
  readonly name: string;
  readonly status: "drilled" | "design";
  readonly provenance: "documented" | "user";
  readonly source?: { readonly title: string; readonly url?: string; readonly license?: string; readonly attribution?: string };
  readonly brief: WellDesignBrief;
  readonly asDrilled: readonly OffsetSectionRecord[];
  /** What the record does not say, and what was assumed to make it usable. */
  readonly notes: readonly string[];
}

const pageRef = (source: "summary" | "daily", page: number) => `${forgeOperations.sources[source]?.title ?? source}, p. ${page}`;

function forgeBrief(): WellDesignBrief {
  const rkb = forgeData.referenceElevationMslM;
  const survey = forgeData.survey.map((station) => ({ mdM: station.mdM, inclinationDeg: station.inclinationDeg, azimuthDeg: station.azimuthDeg }));
  const [sediments, granite] = forgeData.formations;
  const shoe = (id: string) => forgeData.components.find((component) => component.id === id)!.bottomDepthM;
  const fit = (ppg: number, mdFt: number, page: number): IntegrityTest => ({ kind: "FIT", tvdM: round1(feetToMetres(mdFt)), emwSg: ppgToSg(ppg), reachedLeakOff: false, source: `16A(78)-32 FIT ${ppg} ppg at ${mdFt.toLocaleString("en-US")} ft MD, ${pageRef("daily", page)}` });
  const estimated: InputSource = "estimated";
  const pore = "Not reported; hydrostatic assumed — 8.5–9.1 ppg mud drilled the whole well without an influx, so pore pressure stays below ≈1.07 SG.";
  const frac = "Estimated regional stress gradient; FITs (lower bounds) and three failed XLOT attempts give no leak-off value for this well.";
  return {
    identity: { name: "Utah FORGE 16A(78)-32", field: "Utah FORGE", operator: "Energy & Geoscience Institute, University of Utah", country: "United States", purpose: "geothermal", uwi: "16A(78)-32" },
    location: { environment: "onshore", crs: "NAD83 / UTM 12N (EPSG:26912) → WGS 84", latitude: 38.50416, longitude: -112.89643, waterDepthM: null, groundElevationM: round2(rkb - forgeData.groundTvdM) },
    datum: { reference: "RKB", elevationAboveMslM: round2(rkb) },
    geology: {
      formations: [
        { name: sediments!.name, topTvdM: round1(sediments!.topTvdM), lithology: "Alluvium / sediments" },
        { name: granite!.name, topTvdM: round1(granite!.topTvdM), lithology: "Granite / granodiorite", reservoir: true, hazard: "Seepage losses at the granodiorite contact; hard abrasive drilling" },
      ],
      pressures: [
        { tvdM: round1(sediments!.topTvdM), porePressureSg: 1.0, fractureGradientSg: 1.6, poreSource: "assumed", fractureSource: estimated, note: frac },
        { tvdM: 500, porePressureSg: 1.0, fractureGradientSg: 1.6, poreSource: "assumed", fractureSource: estimated, note: `${pore} Fracture ≥ 1.55 SG: 12.92 ppg cement was circulated to surface with full returns (${pageRef("daily", 3)}); FIT 9.5 ppg held.` },
        { tvdM: round1(granite!.topTvdM), porePressureSg: 1.0, fractureGradientSg: 1.65, poreSource: "assumed", fractureSource: estimated, note: frac },
        { tvdM: round1(granite!.bottomTvdM), porePressureSg: 1.0, fractureGradientSg: 1.69, poreSource: "assumed", fractureSource: estimated, note: frac },
      ],
      surfaceTemperatureC: 10,
      geothermalGradientCPerKm: round1((161 - 10) / (tvdAtMd({ trajectory: survey }, feetToMetres(10987)) / 1000)),
      temperatureSource: "measured",
      temperatureNote: `Log BHT 322 °F (161 °C) near TD (10,987 ft MD) after circulating to cool (${pageRef("daily", 17)}) — understates static temperature. Surface 10 °C assumed.`,
      integrityTests: [fit(9.5, 1644, 5), fit(9.6, 5125, 9)],
    },
    fluids: { type: "geothermal", h2sMolPct: null, co2MolPct: null, source: "assumed" },
    basis: defaultDesignBasis,
    trajectory: survey,
    totalDepthMdM: round1(forgeData.totalDepthM),
    sections: [
      { id: "surface", role: "surface", label: "13-3/8\" surface casing", holeSizeIn: 17.5, odIn: 13.375, weightLbFt: 68, grade: "L80", topMdM: 0, shoeMdM: round2(shoe("surface-casing")), mudWeightSg: ppgToSg(8.9), cement: { topMdM: 0, leadDensitySg: ppgToSg(12.92), tailDensitySg: ppgToSg(12.92), tailLengthM: 0, excessPct: 100 } },
      { id: "intermediate", role: "intermediate", label: "9-5/8\" intermediate casing", holeSizeIn: 12.25, odIn: 9.625, weightLbFt: 40, grade: "L80", topMdM: 0, shoeMdM: round2(shoe("intermediate-casing")), mudWeightSg: ppgToSg(9.0), cement: { topMdM: 0, leadDensitySg: ppgToSg(12.92), tailDensitySg: ppgToSg(12.92), tailLengthM: 0, excessPct: 70 } },
      { id: "production", role: "production", label: "7\" production casing", holeSizeIn: 8.75, odIn: 7, weightLbFt: 38, grade: "T95", topMdM: 0, shoeMdM: round2(shoe("production-casing")), mudWeightSg: ppgToSg(9.0), cement: { topMdM: 0, leadDensitySg: ppgToSg(12.97), tailDensitySg: ppgToSg(12.97), tailLengthM: 0, excessPct: 90 } },
    ],
    completion: null,
  };
}

function forgeAsDrilled(): readonly OffsetSectionRecord[] {
  const days = forgeOperations.days;
  const runs = forgeOperations.runs;
  const extra: Record<string, OffsetEvent[]> = {
    surface: [],
    intermediate: [
      { kind: "integrity-test", text: "FIT 9.5 ppg (1.14 SG) below the 13-3/8\" shoe — held, no leak-off.", mdM: round1(feetToMetres(1644)), date: "2020-11-05", source: pageRef("daily", 5) },
      { kind: "losses", text: "9 bbl seepage in 6 h at the granodiorite contact drilling with 9.1 ppg.", mdM: round1(feetToMetres(4552)), date: "2020-11-07", source: pageRef("daily", 6) },
    ],
    production: [
      { kind: "integrity-test", text: "FIT 9.6 ppg (1.15 SG) below the 9-5/8\" shoe — held, no leak-off.", mdM: round1(feetToMetres(5125)), date: "2020-11-15", source: pageRef("daily", 9) },
      { kind: "temperature", text: "Log BHT 322 °F (161 °C) after circulating to cool; static temperature is higher.", mdM: round1(feetToMetres(10987)), date: "2020-12-27", source: pageRef("daily", 17) },
    ],
  };
  return Object.freeze(forgeOperations.sections.map((section) => {
    const inSection = days.filter((day) => section.firstDate !== null && section.lastDate !== null && day.date >= section.firstDate && day.date <= section.lastDate);
    const muds = days.filter((day) => day.mudWeightPpg && day.mdM !== null && day.mdM > section.topM + 1 && day.mdM <= section.baseM + 1).map((day) => day.mudWeightPpg!);
    const problemRuns = runs.filter((run) => run.holeSection === section.id && run.outcome !== "completed").map((run): OffsetEvent => ({ kind: run.outcome === "failed" ? "failed-run" : "problem-run", text: `${run.id}: ${run.summary}`, mdM: run.topM ?? null, source: pageRef("summary", run.page) }));
    return Object.freeze({
      sectionId: section.id,
      holeSizeIn: section.bitSizeIn,
      topMdM: section.topM,
      baseMdM: section.baseM,
      days: inSection.length || null,
      runCount: section.runCount,
      problemRuns: section.problemRuns,
      mudWeightSg: muds.length ? { min: ppgToSg(Math.min(...muds)), max: ppgToSg(Math.max(...muds)) } : null,
      avgRopMPerH: section.avgRopFph ? round1(feetToMetres(section.avgRopFph)) : null,
      events: Object.freeze([...(extra[section.id] ?? []), ...problemRuns].sort((a, b) => (a.mdM ?? 0) - (b.mdM ?? 0))),
    });
  }));
}

/** Utah FORGE 16A(78)-32 (2020–21), a drilled, documented deviated geothermal well, as a reusable offset (CC BY 4.0). */
export const forgeOffsetWell: OffsetWell = Object.freeze({
  id: "utah-forge-16a",
  name: "Utah FORGE 16A(78)-32",
  status: "drilled",
  provenance: "documented",
  source: { title: forgeOperations.sources.summary?.title ?? "Drilling Summary Well 16A(78)-32", url: forgeOperations.sources.summary?.url, license: forgeData.license, attribution: forgeOperations.attribution },
  brief: Object.freeze(forgeBrief()),
  asDrilled: forgeAsDrilled(),
  notes: Object.freeze([
    "Casing, hole sizes, shoes, mud weights, survey, FITs, losses and run outcomes are transcribed from the operator's reports.",
    "Pore pressure is not reported: hydrostatic (1.00 SG) is assumed, bounded by the 8.5–9.1 ppg mud that drilled without an influx.",
    "Fracture gradients are estimates: at least the 1.55 SG cement column that returned to surface without losses, rising to a regional ≈0.73 psi/ft in granite. The two FITs are lower bounds; the three XLOT attempts failed on packers.",
    "9-5/8\" HCL80 is rated as L80 here (HCL80 has the same yield with higher collapse — conservative).",
    "Cement: single 12.92–12.97 ppg RC ThermaLite-HT slurry on every string. Excess is back-calculated from pumped volume over gauge annulus (surface 410 bbl, 212 bbl returned; intermediate 428 bbl, returns not stated, TOC taken as surface; production 433 bbl, 15 bbl returned).",
    "H2S/CO2 are not in the record. No completion string: the well is an injector completed with 7\" casing only.",
  ]),
});

/** Save any brief, typically a design you finished earlier, as an offset for later wells. */
export function offsetFromBrief(brief: WellDesignBrief, meta: { readonly id?: string; readonly name?: string; readonly status?: OffsetWell["status"]; readonly notes?: readonly string[] } = {}): OffsetWell {
  const name = meta.name ?? (brief.identity.name || "Untitled design");
  return Object.freeze({ id: meta.id ?? `user-${name.toLowerCase().replace(/\W+/g, "-")}`, name, status: meta.status ?? "design", provenance: "user", brief, asDrilled: Object.freeze([]), notes: Object.freeze([...(meta.notes ?? [])]) });
}

export interface ComparisonFactor {
  readonly id: "distance" | "environment" | "depth" | "pressure" | "temperature" | "lithology" | "hazards" | "inclination" | "purpose";
  readonly label: string;
  readonly weight: number;
  /** 0–1 likeness; null when either well lacks the data (or it is only assumed). */
  readonly score: number | null;
  readonly target: string;
  readonly offset: string;
  readonly note: string;
}

export interface WellComparison {
  readonly offsetId: string;
  readonly factors: readonly ComparisonFactor[];
  /** Weighted mean over comparable factors. */
  readonly score: number;
  /** Share of the total weight that could be compared. */
  readonly coverage: number;
  readonly verdict: "strong" | "partial" | "poor" | "insufficient-data";
  readonly summary: string;
}

const haversineKm = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => {
  const rad = Math.PI / 180;
  const h = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
};
const tdTvd = (brief: WellDesignBrief) => tvdAtMd(brief, brief.totalDepthMdM);
const maxInclination = (brief: WellDesignBrief) => Math.max(0, ...(brief.trajectory ?? []).map((station) => station.inclinationDeg));
const words = (text: string) => new Set(text.toLowerCase().split(/[^a-z]+/).filter((word) => word.length > 3).map((word) => word.replace(/s$/, "")));
const overlaps = (a: Set<string>, b: Set<string>) => [...a].some((word) => b.has(word));
const lithologyAt = (brief: WellDesignBrief, tvd: number) => [...brief.geology.formations].sort((a, b) => a.topTvdM - b.topTvdM).filter((formation) => formation.topTvdM <= tvd).at(-1);
const usablePressures = (brief: WellDesignBrief) => brief.geology.pressures.length >= 2 && !brief.geology.pressures.every((point) => point.poreSource === "assumed" && point.fractureSource === "assumed");
const related: Readonly<Record<string, string>> = { injection: "fluid-in", disposal: "fluid-in", geothermal: "fluid-in", exploration: "hydrocarbon", appraisal: "hydrocarbon", development: "hydrocarbon" };

/**
 * How alike two wells are where it matters for reusing a design: location, depth, the pressure and
 * temperature regime, the rocks and their hazards, profile and purpose. Missing data is not scored.
 */
export function compareWells(target: WellDesignBrief, offset: OffsetWell): WellComparison {
  const other = offset.brief;
  const factors: ComparisonFactor[] = [];
  const add = (id: ComparisonFactor["id"], label: string, weight: number, score: number | null, targetText: string, offsetText: string, note: string) => factors.push(Object.freeze({ id, label, weight, score: score === null ? null : round2(Math.max(0, Math.min(1, score))), target: targetText, offset: offsetText, note }));
  const fmtLoc = (brief: WellDesignBrief) => (brief.location.latitude !== null && brief.location.longitude !== null ? `${brief.location.latitude.toFixed(3)}, ${brief.location.longitude.toFixed(3)}` : "—");
  const a = target.location, b = other.location;
  const distance = a.latitude !== null && a.longitude !== null && b.latitude !== null && b.longitude !== null ? haversineKm(a as { latitude: number; longitude: number }, b as { latitude: number; longitude: number }) : null;
  add("distance", "Distance", 2, distance === null ? null : Math.exp(-distance / 10), fmtLoc(target), fmtLoc(other), distance === null ? "Coordinates missing" : `${distance < 10 ? distance.toFixed(2) : Math.round(distance).toLocaleString("en-US")} km apart`);
  const sameEnv = a.environment === b.environment;
  const waterScore = a.environment !== "onshore" && a.waterDepthM !== null && b.waterDepthM !== null ? 1 - Math.abs(a.waterDepthM - b.waterDepthM) / Math.max(a.waterDepthM, b.waterDepthM, 1) : 1;
  add("environment", "Environment", 1, sameEnv ? waterScore : 0, a.environment + (a.waterDepthM ? ` · ${a.waterDepthM} m water` : ""), b.environment + (b.waterDepthM ? ` · ${b.waterDepthM} m water` : ""), sameEnv ? "Same setting" : "Different rig, wellhead and conductor practice");
  const ta = tdTvd(target), tb = tdTvd(other);
  add("depth", "Total depth (TVD)", 1.5, target.totalDepthMdM > 0 ? Math.min(ta, tb) / Math.max(ta, tb) : null, `${Math.round(ta)} m`, `${Math.round(tb)} m`, `${Math.round(Math.abs(ta - tb))} m difference`);
  let pressureScore: number | null = null, pressureNote = "Pressure profile missing or only assumed";
  if (usablePressures(target) && usablePressures(other)) {
    const deepest = Math.min(Math.max(...target.geology.pressures.map((p) => p.tvdM)), Math.max(...other.geology.pressures.map((p) => p.tvdM)));
    let sum = 0, count = 0, worst = 0;
    for (let step = 1; step <= 20; step++) {
      const tvd = deepest * step / 20;
      const x = pressureAt(target, tvd), y = pressureAt(other, tvd);
      const d = Math.max(Math.abs(x.porePressureSg - y.porePressureSg), Math.abs(x.fractureGradientSg - y.fractureGradientSg));
      sum += d * d; count++; worst = Math.max(worst, d);
    }
    const rms = Math.sqrt(sum / count);
    pressureScore = Math.exp(-rms / 0.08);
    pressureNote = `RMS ${rms.toFixed(2)} SG, worst ${worst.toFixed(2)} SG over 0–${Math.round(deepest)} m TVD`;
  }
  const window = (brief: WellDesignBrief) => (brief.geology.pressures.length ? `${Math.min(...brief.geology.pressures.map((p) => p.porePressureSg)).toFixed(2)}–${Math.max(...brief.geology.pressures.map((p) => p.porePressureSg)).toFixed(2)} pore` : "—");
  add("pressure", "Pore / fracture profile", 2, pressureScore, window(target), window(other), pressureNote);
  const temperatureKnown = (brief: WellDesignBrief) => brief.geology.geothermalGradientCPerKm > 0 && brief.geology.temperatureSource !== "assumed";
  const ga = target.geology.geothermalGradientCPerKm, gb = other.geology.geothermalGradientCPerKm;
  add("temperature", "Geothermal gradient", 1, temperatureKnown(target) && temperatureKnown(other) ? 1 - Math.abs(ga - gb) / Math.max(ga, gb) : null, `${ga} °C/km`, `${gb} °C/km`, temperatureKnown(target) && temperatureKnown(other) ? `${Math.round(temperatureAt(target, ta))} vs ${Math.round(temperatureAt(other, tb))} °C at TD` : "Temperature missing or assumed");
  let lithologyScore: number | null = null, lithologyNote = "Formation tops missing";
  if (target.geology.formations.length && other.geology.formations.length) {
    let match = 0;
    const span = Math.min(ta, tb);
    for (let step = 1; step <= 20; step++) {
      const x = lithologyAt(target, span * step / 20), y = lithologyAt(other, span * step / 20);
      if (x && y && overlaps(words(`${x.lithology} ${x.name}`), words(`${y.lithology} ${y.name}`))) match++;
    }
    lithologyScore = match / 20;
    lithologyNote = `${match * 5}% of the column has the same rock type at the same depth`;
  }
  const column = (brief: WellDesignBrief) => brief.geology.formations.map((formation) => formation.lithology).join(" → ") || "—";
  add("lithology", "Stratigraphy", 1.5, lithologyScore, column(target), column(other), lithologyNote);
  const hazards = (brief: WellDesignBrief) => brief.geology.formations.map((formation) => formation.hazard).filter((value): value is string => Boolean(value));
  const ha = hazards(target), hb = hazards(other);
  const hazardScore = !ha.length && !hb.length ? null : ha.length && hb.length ? (overlaps(words(ha.join(" ")), words(hb.join(" "))) ? 1 : 0.3) : 0.5;
  add("hazards", "Drilling hazards", 0.5, hazardScore, ha.join("; ") || "None listed", hb.join("; ") || "None listed", hazardScore === null ? "Neither well lists hazards" : hazardScore === 1 ? "Shared hazards — reuse the offset's mitigations" : "Hazards differ");
  const ia = maxInclination(target), ib = maxInclination(other);
  add("inclination", "Profile", 0.5, 1 - Math.abs(ia - ib) / 90, ia ? `max ${Math.round(ia)}°` : "vertical", ib ? `max ${Math.round(ib)}°` : "vertical", "Inclination drives casing wear, drag and cement placement");
  const pa = target.identity.purpose, pb = other.identity.purpose;
  add("purpose", "Purpose", 0.5, pa === pb ? 1 : related[pa] === related[pb] ? 0.5 : 0, pa, pb, pa === pb ? "Same purpose" : "Completion and loads differ by purpose");
  const total = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const known = factors.filter((factor) => factor.score !== null);
  const knownWeight = known.reduce((sum, factor) => sum + factor.weight, 0);
  const score = knownWeight ? known.reduce((sum, factor) => sum + factor.weight * factor.score!, 0) / knownWeight : 0;
  const coverage = knownWeight / total;
  const verdict: WellComparison["verdict"] = coverage < 0.5 ? "insufficient-data" : score >= 0.75 ? "strong" : score >= 0.5 ? "partial" : "poor";
  const weakest = [...known].sort((x, y) => x.score! - y.score!).slice(0, 2).filter((factor) => factor.score! < 0.6).map((factor) => factor.label.toLowerCase());
  const summary = verdict === "insufficient-data" ? `Only ${Math.round(coverage * 100)}% of the comparison has data — enter location, depth and geology first.`
    : verdict === "strong" ? `Strong analogue (${Math.round(score * 100)}%). Its design and as-drilled record are a sound starting point.`
    : verdict === "partial" ? `Partial analogue (${Math.round(score * 100)}%)${weakest.length ? `; differs in ${weakest.join(" and ")}` : ""}. Reuse with re-validation.`
    : `Poor analogue (${Math.round(score * 100)}%)${weakest.length ? `; differs in ${weakest.join(" and ")}` : ""}. Use for reference only.`;
  return Object.freeze({ offsetId: offset.id, factors: Object.freeze(factors), score: round2(score), coverage: round2(coverage), verdict, summary });
}

export interface AdoptOptions {
  /** Take formations, pressures, tests, temperature and fluids. Default true. */
  readonly geology?: boolean;
  /** Take the casing scheme and cement, mapped onto this well's formations and TD. Default true. */
  readonly casing?: boolean;
  /** Take the completion, mapped to the new production shoe. Default true. */
  readonly completion?: boolean;
}

export interface Adoption {
  readonly brief: WellDesignBrief;
  readonly changes: readonly DesignChange[];
  /** Every check on the result: adopting a design never hides a failure. */
  readonly issues: readonly DesignIssue[];
  readonly failingSections: readonly string[];
}

const sourceAfterTransfer = (source: InputSource | undefined): InputSource => (source === "measured" || source === "offset" ? "offset" : source ?? "estimated");

/** Offset geology re-expressed below the target's depth reference. */
function transferGeology(target: WellDesignBrief, offset: OffsetWell, changes: DesignChange[]): WellDesignBrief["geology"] {
  const from = offset.brief;
  const known = target.datum.elevationAboveMslM !== null && from.datum.elevationAboveMslM !== null;
  const shift = known ? target.datum.elevationAboveMslM! - from.datum.elevationAboveMslM! : 0;
  changes.push(Object.freeze({ field: "datum", from: `${from.datum.reference} ${from.datum.elevationAboveMslM ?? "?"} m`, to: `${target.datum.reference} ${target.datum.elevationAboveMslM ?? "?"} m`, reason: known ? `Offset depths shifted ${shift >= 0 ? "+" : ""}${round1(shift)} m to this well's reference; gradients re-expressed at the new TVD.` : "A depth-reference elevation is missing — depths copied unshifted." }));
  const regrade = (sg: number, tvd: number) => (tvd + shift > 1 ? round2(sg * tvd / (tvd + shift)) : sg);
  const label = `offset ${offset.name}`;
  return {
    formations: from.geology.formations.map((formation) => ({ ...formation, topTvdM: round1(Math.max(0, formation.topTvdM + shift)) })),
    pressures: from.geology.pressures.map((point) => ({ tvdM: round1(Math.max(0, point.tvdM + shift)), porePressureSg: regrade(point.porePressureSg, point.tvdM), fractureGradientSg: regrade(point.fractureGradientSg, point.tvdM), poreSource: sourceAfterTransfer(point.poreSource), fractureSource: sourceAfterTransfer(point.fractureSource), note: `From ${label}${point.note ? `: ${point.note}` : ""}` })),
    surfaceTemperatureC: from.geology.surfaceTemperatureC,
    geothermalGradientCPerKm: from.geology.geothermalGradientCPerKm,
    temperatureSource: from.geology.temperatureSource === "assumed" ? "assumed" : "offset",
    temperatureNote: `From ${label}${from.geology.temperatureNote ? `: ${from.geology.temperatureNote}` : ""}`,
    integrityTests: (from.geology.integrityTests ?? []).map((test) => ({ ...test, tvdM: round1(test.tvdM + shift), emwSg: regrade(test.emwSg, test.tvdM), source: `Offset ${offset.name}: ${test.source}` })),
  };
}

/** Target TVD of an offset depth: same fractional position inside the same-named (or same-rock) formation, else scaled by TD. */
function mapTvd(target: WellDesignBrief, offset: WellDesignBrief, tvd: number): number {
  const sorted = (brief: WellDesignBrief) => [...brief.geology.formations].sort((a, b) => a.topTvdM - b.topTvdM);
  const from = sorted(offset), to = sorted(target).filter((formation) => formation.topTvdM < tdTvd(target) - 50);
  const index = from.filter((formation) => formation.topTvdM <= tvd).length - 1;
  const host = from[index];
  if (host) {
    const base = from[index + 1]?.topTvdM ?? tdTvd(offset);
    const fraction = (tvd - host.topTvdM) / Math.max(1, base - host.topTvdM);
    const matchAt = to.findIndex((formation) => formation.name === host.name) >= 0 ? to.findIndex((formation) => formation.name === host.name) : to.findIndex((formation) => overlaps(words(formation.lithology), words(host.lithology)));
    const match = to[matchAt];
    if (match) {
      const matchBase = to[matchAt + 1]?.topTvdM ?? tdTvd(target);
      return match.topTvdM + fraction * Math.max(1, matchBase - match.topTvdM);
    }
  }
  return tvd * tdTvd(target) / Math.max(1, tdTvd(offset));
}

/**
 * Reuse an offset well's geology and/or design on a new well. Shoes are carried to the same position in
 * the same formations, the deepest string keeps the offset's distance off bottom, mud is raised where this
 * well's pore pressure needs it, and the result is re-checked. Every change and every failure is returned.
 */
export function adoptOffsetDesign(target: WellDesignBrief, offset: OffsetWell, options: AdoptOptions = {}): Adoption {
  const takeGeology = options.geology ?? true, takeCasing = options.casing ?? true, takeCompletion = options.completion ?? true;
  const changes: DesignChange[] = [];
  let brief: WellDesignBrief = target;
  if (takeGeology) {
    brief = { ...brief, geology: transferGeology(target, offset, changes), fluids: target.fluids ?? (offset.brief.fluids ? { ...offset.brief.fluids, source: sourceAfterTransfer(offset.brief.fluids.source) } : null) };
    changes.push(Object.freeze({ field: "geology", from: `${target.geology.formations.length} formations · ${target.geology.pressures.length} pressure points`, to: `${brief.geology.formations.length} formations · ${brief.geology.pressures.length} pressure points`, reason: `Geology, pressures, integrity tests and temperature taken from ${offset.name}.` }));
  }
  const from = offset.brief;
  if (takeCasing && from.sections.length) {
    const offsetTd = from.totalDepthMdM;
    const deepest = Math.max(...from.sections.map((section) => section.shoeMdM));
    const offBottom = Math.max(0, offsetTd - deepest);
    const mapped: CasingSection[] = [];
    let previousShoe = 0;
    for (const section of [...from.sections].sort((a, b) => a.shoeMdM - b.shoeMdM)) {
      const isDeepest = section.shoeMdM === deepest;
      const shoeTvd = mapTvd(brief, from, tvdAtMd(from, section.shoeMdM));
      let shoe = Math.round(isDeepest ? brief.totalDepthMdM - offBottom : Math.min(brief.totalDepthMdM - 50, mdAtTvd(brief, shoeTvd)));
      if (shoe <= previousShoe + 30) shoe = Math.round(previousShoe + 30);
      const scale = section.shoeMdM > 0 ? shoe / section.shoeMdM : 1;
      const top = section.topMdM > 0 ? Math.round(section.topMdM * scale) : 0;
      const openFrom = previousShoe;
      let pore = 0;
      for (let md = openFrom; md <= shoe; md += Math.max(10, (shoe - openFrom) / 100)) pore = Math.max(pore, pressureAt(brief, tvdAtMd(brief, md)).porePressureSg);
      const needed = round2(pore + 0.03);
      const mud = section.role === "conductor" ? section.mudWeightSg : Math.max(section.mudWeightSg, needed);
      if (mud > section.mudWeightSg) changes.push(Object.freeze({ sectionId: section.id, field: "mud", from: `${section.mudWeightSg.toFixed(2)} SG`, to: `${mud.toFixed(2)} SG`, reason: `This well's pore pressure reaches ${pore.toFixed(2)} SG in the ${section.label} hole.` }));
      if (Math.abs(shoe - section.shoeMdM) >= 1) changes.push(Object.freeze({ sectionId: section.id, field: "shoe", from: `${Math.round(section.shoeMdM)} m MD`, to: `${shoe} m MD`, reason: isDeepest ? `Kept ${Math.round(offBottom)} m off bottom as on the offset.` : "Same position in the same formation on this well." }));
      const cement = section.cement ? { ...section.cement, topMdM: section.cement.topMdM <= 0 ? 0 : Math.max(0, Math.round(shoe - (section.shoeMdM - section.cement.topMdM))) } : null;
      mapped.push({ ...section, shoeMdM: shoe, topMdM: top, mudWeightSg: mud, cement });
      previousShoe = shoe;
    }
    changes.push(Object.freeze({ field: "casing", from: `${target.sections.length} strings`, to: `${mapped.length} strings`, reason: `Casing sizes, weights, grades and cement from ${offset.name}.` }));
    brief = { ...brief, sections: mapped };
    if (takeCompletion && from.completion) {
      const production = [...from.sections].sort((a, b) => a.odIn - b.odIn)[0]!;
      const newProduction = mapped.find((section) => section.id === production.id)!;
      const shift = newProduction.shoeMdM - production.shoeMdM;
      const c = from.completion;
      brief = { ...brief, completion: { ...c, packerMdM: Math.round(c.packerMdM + shift), perforations: c.perforations.map((interval) => ({ topMdM: Math.round(interval.topMdM + shift), bottomMdM: Math.round(interval.bottomMdM + shift) })) } };
      changes.push(Object.freeze({ field: "completion", from: target.completion ? "existing" : "none", to: `${c.tubingOdIn}" ${c.tubingGrade} tubing`, reason: `Completion moved ${shift >= 0 ? "+" : ""}${Math.round(shift)} m with the production shoe.` }));
    } else if (takeCompletion && !from.completion) {
      brief = { ...brief, completion: null };
      changes.push(Object.freeze({ field: "completion", from: target.completion ? "existing" : "none", to: "none", reason: `${offset.name} has no completion string on record.` }));
    }
  }
  const parts = [takeGeology && "geology", takeCasing && "casing", takeCompletion && takeCasing && "completion"].filter((value): value is "geology" | "casing" | "completion" => Boolean(value));
  brief = Object.freeze({ ...brief, origin: { offsetId: offset.id, offsetName: offset.name, parts } });
  const issues = validateDesign(brief);
  const failingSections = brief.sections.filter((_, index) => !analyzeSection(brief, index).passes).map((section) => section.id);
  return Object.freeze({ brief, changes: Object.freeze(changes), issues, failingSections: Object.freeze(failingSections) });
}

/** A new pad well beside the offset: same location, datum and geology (marked as offset data), no design yet. */
export function newWellBesideOffset(offset: OffsetWell, options: { readonly name: string; readonly totalDepthMdM?: number }): WellDesignBrief {
  const from = offset.brief;
  const changes: DesignChange[] = [];
  const geology = transferGeology(from, offset, changes);
  return Object.freeze({
    ...from,
    identity: { ...from.identity, name: options.name, uwi: undefined },
    trajectory: null,
    totalDepthMdM: options.totalDepthMdM ?? Math.round(tdTvd(from)),
    geology,
    fluids: from.fluids ? { ...from.fluids, source: sourceAfterTransfer(from.fluids.source) } : null,
    sections: [],
    completion: null,
    origin: { offsetId: offset.id, offsetName: offset.name, parts: ["geology"] as const },
  });
}
