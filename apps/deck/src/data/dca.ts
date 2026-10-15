import { arpsCumulative, arpsRate, arpsTimeToRate, daysInMonth, effectiveDecline, fitArps } from "@ikhmalputra/subsurface-core";
import type { ArpsFit } from "@ikhmalputra/subsurface-core";

/**
 * Decline curve analysis on Sodir's monthly field production, as plain functions: the analysis
 * itself (what the Decline module draws), a saved analysis's snapshot, its forecast as CSV, and the
 * file saved analyses travel in. No React and no storage, so the same code draws, saves and exports.
 */

export interface Field { readonly name: string; readonly npdid: number; readonly month: readonly number[]; readonly oil: readonly (number | null)[]; readonly gas: readonly (number | null)[]; readonly oe: readonly (number | null)[]; readonly water: readonly (number | null)[] }
export interface ProductionRecord { readonly source: { readonly url: string; readonly sha256: string; readonly retrieved: string; readonly publisher: string }; readonly licence: string; readonly fields: readonly Field[] }
export type Product = "oil" | "gas" | "oe";

/** Volumes are million Sm³ a month (gas: billion); rates are Sm³ a day. */
export const SCALE: Readonly<Record<Product, number>> = { oil: 1e6, gas: 1e9, oe: 1e6 };
export interface Units { readonly rate: string; readonly per: number; readonly volume: string; readonly volumePer: number }
export const UNIT: Readonly<Record<Product, Units>> = {
  oil: { rate: "Sm³/d", per: 1, volume: "MSm³", volumePer: 1e6 },
  gas: { rate: "MSm³/d", per: 1e6, volume: "GSm³", volumePer: 1e9 },
  oe: { rate: "Sm³ o.e./d", per: 1, volume: "MSm³ o.e.", volumePer: 1e6 },
};
export const NAME: Readonly<Record<Product, string>> = { oil: "Oil", gas: "Gas", oe: "Oil equivalent" };
export const yearOf = (month: number) => month / 12;
/** A month (year × 12 + month − 1) as YYYY-MM. */
export const label = (month: number) => `${Math.floor(month / 12)}-${String(month % 12 + 1).padStart(2, "0")}`;
/** Forecasts stop here even when the economic limit is further away. */
export const HORIZON_YEARS = 50;

/** What an analysis is made of: everything a user chooses. The limit is in the product's rate unit; null is the default (5 % of the last reported rate). */
export interface DcaInputs {
  readonly field: string;
  readonly product: Product;
  readonly window: readonly [number, number] | null;
  readonly bMax: number;
  readonly limit: number | null;
}

export interface Point { readonly month: number; readonly volume: number | null; readonly rate: number | null; readonly water: number | null; readonly oil: number | null }

export type Analysis =
  | { readonly kind: "no-field" }
  | { readonly kind: "no-product"; readonly field: Field; readonly series: readonly Point[] }
  | {
    readonly kind: "ok"; readonly field: Field; readonly product: Product; readonly series: readonly Point[];
    readonly span: readonly [number, number]; readonly chosen: readonly [number, number]; readonly fit: ArpsFit | null; readonly unit: Units;
    readonly last: Point; readonly limit: number | null; readonly limitIsDefault: boolean; readonly tLast: number; readonly toLimit: number | null;
    readonly produced: number; readonly remaining: number; readonly producing: boolean; readonly waterOil: number | null; readonly bMax: number;
  };

export function analyse(record: ProductionRecord, inputs: DcaInputs): Analysis {
  const field = record.fields.find((entry) => entry.name === inputs.field);
  if (!field) return { kind: "no-field" };
  const product = inputs.product;
  const series: Point[] = field.month.map((month, i) => {
    const volume = field[product][i] ?? null;
    return { month, volume, rate: volume === null ? null : volume * SCALE[product] / daysInMonth(month), water: field.water[i] ?? null, oil: field.oil[i] ?? null };
  });
  const producedMonths = series.filter((entry) => entry.rate !== null && entry.rate > 0).map((entry) => entry.month);
  if (!series.length || !producedMonths.length) return { kind: "no-product", field, series };
  const span = [series[0]!.month, series.at(-1)!.month] as const;
  // By default, the last ten years in which the field produced this product.
  const chosen = inputs.window ?? [Math.max(producedMonths[0]!, producedMonths.at(-1)! - 119), producedMonths.at(-1)!] as const;
  const inside = series.filter((entry) => entry.month >= chosen[0] && entry.month <= chosen[1]);
  const fit = fitArps(inside.map((entry) => yearOf(entry.month - chosen[0]) + 1 / 24), inside.map((entry) => entry.rate), { bMax: inputs.bMax });
  const unit = UNIT[product];
  // The forecast runs on from the last month this product was produced, not the field's last month.
  const last = series.find((entry) => entry.month === producedMonths.at(-1))!;
  const lastRate = last.rate;
  const limitIsDefault = !(inputs.limit !== null && inputs.limit > 0);
  const limit = !limitIsDefault ? inputs.limit! * unit.per : lastRate !== null ? lastRate * 0.05 : null;
  const tLast = yearOf(last.month - chosen[0]) + 1 / 24;
  const toLimit = fit && limit !== null ? Math.min(HORIZON_YEARS, arpsTimeToRate(fit, limit)) : null;
  const produced = series.reduce((sum, entry) => sum + (entry.volume ?? 0), 0) * SCALE[product];
  const remaining = fit && toLimit !== null && toLimit > tLast ? arpsCumulative(fit, toLimit) - arpsCumulative(fit, tLast) : 0;
  const producing = last.month >= Math.max(...record.fields.map((entry) => entry.month.at(-1) ?? 0)) - 2;
  const fieldLast = series.at(-1)!;
  const lastYear = series.filter((entry) => entry.month > fieldLast.month - 12);
  const water = lastYear.reduce((sum, entry) => sum + (entry.water ?? 0), 0), oil = lastYear.reduce((sum, entry) => sum + (entry.oil ?? 0), 0);
  return { kind: "ok", field, product, series, span, chosen, fit, unit, last, limit, limitIsDefault, tLast, toLimit, produced, remaining, producing, waterOil: oil > 0 ? water / oil : null, bMax: inputs.bMax };
}

/** The numbers a saved analysis keeps, in the product's display units, as they were when it was saved. */
export interface DcaResults {
  readonly b: number; readonly diNominalPct: number; readonly diEffectivePct: number; readonly qi: number; readonly r2Log: number; readonly samples: number;
  readonly produced: number; readonly remaining: number; readonly eur: number;
  /** Years from the last reported month to the economic limit; null when it lies beyond the 50-year horizon. */
  readonly yearsToLimit: number | null;
  readonly limit: number; readonly limitIsDefault: boolean;
  readonly rateUnit: string; readonly volumeUnit: string;
}

export function resultsOf(analysis: Extract<Analysis, { kind: "ok" }>): DcaResults | null {
  const { fit, unit, toLimit, limit } = analysis;
  if (!fit || toLimit === null || limit === null) return null;
  return {
    b: fit.b, diNominalPct: fit.di * 100, diEffectivePct: effectiveDecline(fit) * 100, qi: fit.qi / unit.per, r2Log: fit.r2Log, samples: fit.samples,
    produced: analysis.produced / unit.volumePer, remaining: analysis.remaining / unit.volumePer, eur: (analysis.produced + analysis.remaining) / unit.volumePer,
    yearsToLimit: toLimit >= HORIZON_YEARS ? null : Math.max(0, toLimit - analysis.tLast),
    limit: limit / unit.per, limitIsDefault: analysis.limitIsDefault, rateUnit: unit.rate, volumeUnit: unit.volume,
  };
}

export interface SavedAnalysis {
  readonly id: string;
  readonly name: string;
  readonly note: string;
  readonly savedAt: number;
  readonly inputs: DcaInputs & { readonly window: readonly [number, number] };
  readonly results: DcaResults;
  /** The production table it was fitted on, so a reopened analysis can tell when the data has changed. */
  readonly source: { readonly publisher: string; readonly retrieved: string; readonly sha256: string };
}

/** Do two analyses differ in anything the user chose? */
export const sameInputs = (a: DcaInputs, b: DcaInputs) =>
  a.field === b.field && a.product === b.product && a.bMax === b.bMax && (a.limit ?? null) === (b.limit ?? null) && a.window?.[0] === b.window?.[0] && a.window?.[1] === b.window?.[1];

const csvCell = (value: string | number | null) => value === null ? "" : typeof value === "number" ? String(Number(value.toPrecision(8))) : /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/**
 * The analysis as a spreadsheet: a commented header with the field, the fit, the limit and the
 * source, then month by month the reported volume and rate, whether the month was in the fit, and
 * the fitted rate, carried on past the last report to the economic limit (at most 50 years).
 */
export function forecastCsv(analysis: Extract<Analysis, { kind: "ok" }>, record: ProductionRecord, name: string): string {
  const { field, product, series, chosen, fit, unit, last, limit, toLimit } = analysis;
  const results = resultsOf(analysis);
  const lines = [
    `# ${name}`,
    `# Field ${field.name} (Sodir npdid ${field.npdid}) · ${NAME[product]} · fit window ${label(chosen[0])} to ${label(chosen[1])} · b ≤ ${analysis.bMax}`,
    results
      ? `# Arps b ${results.b.toFixed(2)} · Di ${results.diNominalPct.toFixed(2)} %/yr nominal (${results.diEffectivePct.toFixed(2)} effective) · qi ${results.qi.toPrecision(5)} ${unit.rate} at ${label(chosen[0])} · R² (log) ${results.r2Log.toFixed(3)} · ${results.samples} months`
      : "# Not enough months in the window to fit",
    results ? `# Economic limit ${results.limit.toPrecision(4)} ${unit.rate}${results.limitIsDefault ? " (default: 5 % of the last reported rate)" : ""} · produced ${results.produced.toFixed(3)} · remaining ${results.remaining.toFixed(3)} · EUR ${results.eur.toFixed(3)} ${unit.volume}` : "#",
    `# Source: ${record.source.publisher}, retrieved ${record.source.retrieved}, sha256 ${record.source.sha256}; ${record.licence}. Net saleable volumes; months the table does not list are gaps, not zeros.`,
    ["month", `reported volume (${unit.volume})`, `reported rate (${unit.rate})`, "in fit window", `fitted rate (${unit.rate})`, "phase"].map(csvCell).join(","),
  ];
  const fitted = (month: number) => fit && month >= chosen[0] ? arpsRate(fit, yearOf(month - chosen[0]) + 1 / 24) / unit.per : null;
  for (const point of series) {
    lines.push([label(point.month), point.volume === null ? null : point.volume * SCALE[product] / unit.volumePer, point.rate === null ? null : point.rate / unit.per,
      point.month >= chosen[0] && point.month <= chosen[1] ? "yes" : "no", fitted(point.month), point.month <= last.month ? "history" : "after last report"].map(csvCell).join(","));
  }
  if (fit && toLimit !== null && limit !== null) {
    const stop = chosen[0] + Math.floor(toLimit * 12);
    for (let month = series.at(-1)!.month + 1; month <= stop; month++) lines.push([label(month), null, null, "no", fitted(month), "forecast"].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export const FILE_FORMAT = "subsurface-deck-dca";

export function analysesFile(analyses: readonly SavedAnalysis[]): string {
  return JSON.stringify({ format: FILE_FORMAT, version: 1, analyses }, null, 1);
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isProduct = (value: unknown): value is Product => value === "oil" || value === "gas" || value === "oe";

/** Reads a saved-analyses file, checking every analysis; throws naming the first thing that is wrong. */
export function parseAnalysesFile(text: string): readonly SavedAnalysis[] {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Not a JSON file."); }
  const file = value as { format?: unknown; version?: unknown; analyses?: unknown };
  if (file?.format !== FILE_FORMAT) throw new Error("Not a saved decline analysis file from the deck.");
  if (file.version !== 1) throw new Error(`Version ${String(file.version)} is not one this deck reads.`);
  if (!Array.isArray(file.analyses)) throw new Error("The file holds no analyses.");
  return file.analyses.map((entry: unknown, index: number) => {
    const a = entry as SavedAnalysis;
    const where = `Analysis ${index + 1}`;
    if (typeof a?.name !== "string" || !a.name.trim()) throw new Error(`${where} has no name.`);
    const inputs = a.inputs;
    if (typeof inputs?.field !== "string" || !isProduct(inputs.product)) throw new Error(`${where} (${a.name}) has no field or product.`);
    if (!Array.isArray(inputs.window) || inputs.window.length !== 2 || !inputs.window.every(isNumber) || inputs.window[0] > inputs.window[1]) throw new Error(`${where} (${a.name}) has no valid fit window.`);
    if (!isNumber(inputs.bMax) || inputs.bMax < 0 || inputs.bMax > 1) throw new Error(`${where} (${a.name}) has an Arps exponent limit outside 0 to 1.`);
    if (inputs.limit !== null && !(isNumber(inputs.limit) && inputs.limit > 0)) throw new Error(`${where} (${a.name}) has an economic limit that is not a positive number.`);
    if (!a.results || !isNumber(a.results.eur) || !isNumber(a.results.b)) throw new Error(`${where} (${a.name}) has no results.`);
    return {
      id: typeof a.id === "string" && a.id ? a.id : `dca-${Date.now().toString(36)}-${index}`,
      name: a.name.trim(), note: typeof a.note === "string" ? a.note : "", savedAt: isNumber(a.savedAt) ? a.savedAt : Date.now(),
      inputs: { field: inputs.field, product: inputs.product, window: [inputs.window[0], inputs.window[1]], bMax: inputs.bMax, limit: inputs.limit },
      results: a.results, source: a.source ?? { publisher: "not reported", retrieved: "not reported", sha256: "" },
    };
  });
}
