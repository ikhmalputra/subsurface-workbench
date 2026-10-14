import type { PetrophysicsDepthReference, PetrophysicsLogCurve } from "./petrophysics.ts";

export type PetrophysicsCalculationQuality = "valid" | "out-of-range" | "missing" | "invalid";

export interface PetrophysicsCalculatedPoint {
  readonly mdM: number;
  readonly value: number | null;
  readonly quality: PetrophysicsCalculationQuality;
  readonly reason: string | null;
}

export interface ArchieWaterSaturationParameters {
  /** Archie tortuosity coefficient. */
  readonly a: number;
  /** Cementation exponent. */
  readonly m: number;
  /** Saturation exponent. */
  readonly n: number;
  /** Formation-water resistivity corrected to formation temperature, in ohm.m. */
  readonly rwAtFormationTemperatureOhmM: number;
}

export interface ArchieWaterSaturationCalculation {
  readonly method: "archie-water-saturation";
  readonly formula: "Sw = (a * Rw / (Rt * phi^m))^(1/n)";
  readonly parameters: ArchieWaterSaturationParameters;
  readonly inputCurveIds: { readonly porosity: string; readonly resistivity: string };
  readonly unit: "fraction";
  readonly points: readonly PetrophysicsCalculatedPoint[];
}

/**
 * Schlumberger M–N (Log Interpretation Charts, CP-8):
 *   M = 0.01 · (Δtf − Δt) / (ρb − ρf)      N = (φNf − φN) / (ρb − ρf)
 * Only the fluid values enter the transform, which is what makes M and N independent of porosity.
 * The matrix values are not used per sample: they give the matrix reference point to read the
 * samples against (pure sandstone, limestone, dolomite each plot at their own M, N).
 */
export interface SchlumbergerMNParameters {
  readonly matrixDensityGPerCm3: number;
  readonly fluidDensityGPerCm3: number;
  readonly matrixSlownessUsPerFt: number;
  readonly fluidSlownessUsPerFt: number;
  /** Neutron porosity of the pore fluid, v/v. 1.0 for fresh water (the default). */
  readonly fluidNeutronPorosity?: number;
  /** Neutron porosity read on the matrix, v/v, in the log's calibration; 0 for limestone units (the default). */
  readonly matrixNeutronPorosity?: number;
}

export interface SchlumbergerMNPoint extends PetrophysicsCalculatedPoint {
  readonly m: number | null;
  readonly n: number | null;
}

export interface SchlumbergerMNCrossplot {
  readonly method: "schlumberger-m-n";
  readonly formula: "M = 0.01 * (DTf - DT) / (rhob - rhof); N = (phiNf - phiN) / (rhob - rhof)";
  readonly parameters: SchlumbergerMNParameters;
  /** Where the declared matrix plots, for reading the samples against it. */
  readonly matrixPoint: { readonly m: number; readonly n: number };
  readonly inputCurveIds: {
    readonly neutronPorosity: string;
    readonly bulkDensity: string;
    readonly sonicSlowness: string;
  };
  readonly units: { readonly m: "dimensionless"; readonly n: "dimensionless" };
  readonly points: readonly SchlumbergerMNPoint[];
}

function requireUnit(curve: PetrophysicsLogCurve, unit: string, role: string): void {
  if (curve.unit !== unit) throw new TypeError(`${role} curve "${curve.id}" must use ${unit}; received "${curve.unit}".`);
}

function requirePositive(value: number, path: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${path} must be finite and greater than zero.`);
}

function assertCompatibleCurves(curves: readonly PetrophysicsLogCurve[]): void {
  if (curves.some((curve) => curve.wellId !== curves[0]!.wellId)) {
    throw new TypeError("Petrophysics calculations require input curves from the same well.");
  }
  if (curves.some((curve) => curve.depthReference.datum !== curves[0]!.depthReference.datum
    || curve.depthReference.kind !== curves[0]!.depthReference.kind
    || curve.depthReference.unit !== curves[0]!.depthReference.unit)) {
    throw new TypeError("Petrophysics calculations require matching depth references and datums.");
  }
}

function missingPoint(mdM: number, reason = "One or more input samples are not reported."): PetrophysicsCalculatedPoint {
  return { mdM, value: null, quality: "missing", reason };
}

/** Archie (1942) saturation calculation; Rw must already be corrected to formation temperature. */
export function calculateArchieWaterSaturation(
  porosityCurve: PetrophysicsLogCurve,
  resistivityCurve: PetrophysicsLogCurve,
  parameters: ArchieWaterSaturationParameters,
): ArchieWaterSaturationCalculation {
  assertCompatibleCurves([porosityCurve, resistivityCurve]);
  requireUnit(porosityCurve, "v/v", "Porosity");
  requireUnit(resistivityCurve, "ohm.m", "True formation resistivity");
  requirePositive(parameters.a, "Archie a");
  requirePositive(parameters.m, "Archie m");
  requirePositive(parameters.n, "Archie n");
  requirePositive(parameters.rwAtFormationTemperatureOhmM, "Formation-temperature-corrected Rw (ohm.m)");
  const points: PetrophysicsCalculatedPoint[] = [];
  let porosityIndex = 0;
  let resistivityIndex = 0;
  while (porosityIndex < porosityCurve.depthsMdM.length && resistivityIndex < resistivityCurve.depthsMdM.length) {
    const phiMdM = porosityCurve.depthsMdM[porosityIndex]!;
    const rtMdM = resistivityCurve.depthsMdM[resistivityIndex]!;
    if (phiMdM < rtMdM) {
      points.push(missingPoint(phiMdM, "No resistivity sample exists at this exact MD."));
      porosityIndex++;
      continue;
    }
    if (rtMdM < phiMdM) {
      points.push(missingPoint(rtMdM, "No porosity sample exists at this exact MD."));
      resistivityIndex++;
      continue;
    }
    const phi = porosityCurve.values[porosityIndex]!;
    const rt = resistivityCurve.values[resistivityIndex]!;
    const phiMissing = (Number.isNaN(phi) && porosityCurve.nullValue === "nan")
      || (typeof porosityCurve.nullValue === "number" && phi === porosityCurve.nullValue);
    const rtMissing = (Number.isNaN(rt) && resistivityCurve.nullValue === "nan")
      || (typeof resistivityCurve.nullValue === "number" && rt === resistivityCurve.nullValue);
    if (phiMissing || rtMissing) {
      points.push(missingPoint(phiMdM));
    } else if (!Number.isFinite(phi) || phi <= 0 || phi > 1 || !Number.isFinite(rt) || rt <= 0) {
      points.push({ mdM: phiMdM, value: null, quality: "invalid", reason: "Porosity must be in (0, 1] v/v and Rt must be positive finite ohm.m." });
    } else {
      const saturation = (parameters.a * parameters.rwAtFormationTemperatureOhmM / (rt * phi ** parameters.m)) ** (1 / parameters.n);
      points.push(!Number.isFinite(saturation)
        ? { mdM: phiMdM, value: null, quality: "invalid", reason: "Archie calculation produced a non-finite result." }
        : saturation <= 1
        ? { mdM: phiMdM, value: saturation, quality: "valid", reason: null }
        : { mdM: phiMdM, value: saturation, quality: "out-of-range", reason: "Calculated Sw exceeds 1; retained without clamping for review." });
    }
    porosityIndex++;
    resistivityIndex++;
  }
  for (; porosityIndex < porosityCurve.depthsMdM.length; porosityIndex++) {
    points.push(missingPoint(porosityCurve.depthsMdM[porosityIndex]!, "No resistivity sample exists at this exact MD."));
  }
  for (; resistivityIndex < resistivityCurve.depthsMdM.length; resistivityIndex++) {
    points.push(missingPoint(resistivityCurve.depthsMdM[resistivityIndex]!, "No porosity sample exists at this exact MD."));
  }
  points.sort((a, b) => a.mdM - b.mdM);
  return {
    method: "archie-water-saturation",
    formula: "Sw = (a * Rw / (Rt * phi^m))^(1/n)",
    parameters: Object.freeze({ ...parameters }),
    inputCurveIds: { porosity: porosityCurve.id, resistivity: resistivityCurve.id },
    unit: "fraction",
    points,
  };
}

/** Schlumberger M–N transform. Inputs must share exact MD keys and declared units. */
export function calculateSchlumbergerMN(
  neutronPorosityCurve: PetrophysicsLogCurve,
  bulkDensityCurve: PetrophysicsLogCurve,
  sonicSlownessCurve: PetrophysicsLogCurve,
  parameters: SchlumbergerMNParameters,
): SchlumbergerMNCrossplot {
  assertCompatibleCurves([neutronPorosityCurve, bulkDensityCurve, sonicSlownessCurve]);
  requireUnit(neutronPorosityCurve, "v/v", "Neutron porosity");
  requireUnit(bulkDensityCurve, "g/cm3", "Bulk density");
  requireUnit(sonicSlownessCurve, "us/ft", "Sonic slowness");
  requirePositive(parameters.matrixDensityGPerCm3, "Matrix density (g/cm3)");
  requirePositive(parameters.fluidDensityGPerCm3, "Fluid density (g/cm3)");
  requirePositive(parameters.matrixSlownessUsPerFt, "Matrix slowness (us/ft)");
  requirePositive(parameters.fluidSlownessUsPerFt, "Fluid slowness (us/ft)");
  if (parameters.matrixDensityGPerCm3 === parameters.fluidDensityGPerCm3) {
    throw new RangeError("Matrix and fluid density must differ for the M–N transform.");
  }
  const fluidNeutron = parameters.fluidNeutronPorosity ?? 1;
  const matrixNeutron = parameters.matrixNeutronPorosity ?? 0;
  if (!Number.isFinite(fluidNeutron) || !Number.isFinite(matrixNeutron)) throw new RangeError("Fluid and matrix neutron porosity must be finite.");
  if (parameters.matrixSlownessUsPerFt === parameters.fluidSlownessUsPerFt) {
    throw new RangeError("Matrix and fluid slowness must differ for the M–N transform.");
  }
  const curves = [neutronPorosityCurve, bulkDensityCurve, sonicSlownessCurve] as const;
  const indexes = [0, 0, 0];
  const points: SchlumbergerMNPoint[] = [];
  while (indexes.every((index, curveIndex) => index < curves[curveIndex]!.depthsMdM.length)) {
    const depths = indexes.map((index, curveIndex) => curves[curveIndex]!.depthsMdM[index]!);
    const mdM = Math.min(...depths);
    if (depths.some((depth) => depth !== mdM)) {
      points.push({ mdM, m: null, n: null, value: null, quality: "missing", reason: "Input curves do not share this exact MD key." });
      indexes.forEach((index, curveIndex) => { if (depths[curveIndex] === mdM) indexes[curveIndex] = index + 1; });
      continue;
    }
    const phi = neutronPorosityCurve.values[indexes[0]!]!;
    const rhoBulk = bulkDensityCurve.values[indexes[1]!]!;
    const dt = sonicSlownessCurve.values[indexes[2]!]!;
    const nullSample = indexes.some((index, curveIndex) => {
      const curve = curves[curveIndex]!;
      const value = curve.values[index]!;
      return (Number.isNaN(value) && curve.nullValue === "nan")
        || (typeof curve.nullValue === "number" && value === curve.nullValue);
    });
    if (nullSample) {
      points.push({ mdM, m: null, n: null, value: null, quality: "missing", reason: "One or more input samples are not reported." });
    } else if (!Number.isFinite(phi) || phi <= 0 || phi > 1
      || !Number.isFinite(rhoBulk) || rhoBulk <= 0 || !Number.isFinite(dt) || dt <= 0) {
      points.push({ mdM, m: null, n: null, value: null, quality: "invalid", reason: "Neutron porosity must be in (0, 1] v/v; density and slowness must be positive finite values." });
    } else {
      const denominator = rhoBulk - parameters.fluidDensityGPerCm3;
      if (denominator <= 0) {
        points.push({ mdM, m: null, n: null, value: null, quality: "invalid", reason: "Bulk density must exceed the fluid density for the M–N transform." });
      } else {
        const m = 0.01 * (parameters.fluidSlownessUsPerFt - dt) / denominator;
        const n = (fluidNeutron - phi) / denominator;
        points.push(Number.isFinite(m) && Number.isFinite(n)
          ? { mdM, m, n, value: null, quality: "valid", reason: null }
          : { mdM, m: null, n: null, value: null, quality: "invalid", reason: "M–N transform produced a non-finite result." });
      }
    }
    indexes.forEach((index, curveIndex) => { indexes[curveIndex] = index + 1; });
  }
  const remaining = new Map<number, { readonly mdM: number; readonly curveIndex: number }>();
  indexes.forEach((index, curveIndex) => {
    for (let sample = index; sample < curves[curveIndex]!.depthsMdM.length; sample++) {
      const mdM = curves[curveIndex]!.depthsMdM[sample]!;
      remaining.set(mdM, { mdM, curveIndex });
    }
  });
  for (const { mdM } of [...remaining.values()].sort((a, b) => a.mdM - b.mdM)) {
    points.push({ mdM, m: null, n: null, value: null, quality: "missing", reason: "One or more input curves have no sample at this MD." });
  }
  points.sort((a, b) => a.mdM - b.mdM);
  return {
    method: "schlumberger-m-n",
    formula: "M = 0.01 * (DTf - DT) / (rhob - rhof); N = (phiNf - phiN) / (rhob - rhof)",
    matrixPoint: {
      m: 0.01 * (parameters.fluidSlownessUsPerFt - parameters.matrixSlownessUsPerFt) / (parameters.matrixDensityGPerCm3 - parameters.fluidDensityGPerCm3),
      n: (fluidNeutron - matrixNeutron) / (parameters.matrixDensityGPerCm3 - parameters.fluidDensityGPerCm3),
    },
    parameters: Object.freeze({ ...parameters }),
    inputCurveIds: { neutronPorosity: neutronPorosityCurve.id, bulkDensity: bulkDensityCurve.id, sonicSlowness: sonicSlownessCurve.id },
    units: { m: "dimensionless", n: "dimensionless" },
    points,
  };
}

/** Converts a calculated scalar result to a renderable curve; invalid and unknown rows remain NaN gaps. */
export function calculatedSeriesToCurve(
  calculation: ArchieWaterSaturationCalculation,
  metadata: { readonly id: string; readonly wellId: string; readonly name: string; readonly mnemonic: string; readonly depthReference: PetrophysicsDepthReference },
): PetrophysicsLogCurve {
  if (!metadata.id.trim() || !metadata.wellId.trim() || !metadata.name.trim() || !metadata.mnemonic.trim()) {
    throw new TypeError("Calculated curve metadata requires non-empty IDs, name, and mnemonic.");
  }
  const points = calculation.points;
  return {
    version: 1,
    ...metadata,
    unit: calculation.unit,
    depthsMdM: Float64Array.from(points, (point) => point.mdM),
    values: Float64Array.from(points, (point) => point.value ?? Number.NaN),
    nullValue: "nan",
  };
}

/** Converts M–N coordinates to scalar curves for generic chart components; only valid pairs are reported. */
export function schlumbergerMNToCurves(
  calculation: SchlumbergerMNCrossplot,
  metadata: { readonly wellId: string; readonly depthReference: PetrophysicsDepthReference; readonly idPrefix: string },
): { readonly m: PetrophysicsLogCurve; readonly n: PetrophysicsLogCurve } {
  const curve = (axis: "m" | "n"): PetrophysicsLogCurve => ({
    version: 1,
    id: `${metadata.idPrefix}-${axis}`,
    wellId: metadata.wellId,
    mnemonic: axis.toUpperCase(),
    name: `Schlumberger ${axis.toUpperCase()} coordinate`,
    unit: "dimensionless",
    depthReference: metadata.depthReference,
    depthsMdM: Float64Array.from(calculation.points, (point) => point.mdM),
    values: Float64Array.from(calculation.points, (point) => point.quality === "valid" ? point[axis]! : Number.NaN),
    nullValue: "nan",
  });
  if (!metadata.wellId.trim() || !metadata.idPrefix.trim()) throw new TypeError("M–N curve metadata requires a well ID and non-empty ID prefix.");
  return { m: curve("m"), n: curve("n") };
}

// ── Interpretation: shale volume, porosity and pay ───────────────────────────────────────────

/**
 * Clean and shale gamma-ray lines for a logged interval: by default its 5th and 95th percentiles,
 * the way an interpreter reads them off a histogram when no core or zone picks are given.
 */
export function gammaRayLines(values: ArrayLike<number>, lowFraction = 0.05, highFraction = 0.95): { readonly clean: number; readonly shale: number } {
  const finite = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length < 2) throw new RangeError("Gamma-ray lines need at least two reported samples.");
  if (!(lowFraction >= 0 && highFraction <= 1 && lowFraction < highFraction)) throw new RangeError("Gamma-ray line fractions must satisfy 0 ≤ low < high ≤ 1.");
  const at = (fraction: number) => finite[Math.min(finite.length - 1, Math.floor(fraction * finite.length))]!;
  const clean = at(lowFraction), shale = at(highFraction);
  if (!(shale > clean)) throw new RangeError("The shale line must read above the clean line.");
  return { clean, shale };
}

export type ShaleVolumeMethod = "linear" | "larionov-tertiary" | "larionov-older";

/**
 * Shale volume from gamma ray, 0–1. Linear is the gamma-ray index itself; Larionov's corrections
 * lower it for unconsolidated (Tertiary) and consolidated (older) rocks:
 *   IGR = (GR − GRclean) / (GRshale − GRclean)
 *   Tertiary: Vsh = 0.083 · (2^(3.7·IGR) − 1)      Older: Vsh = 0.33 · (2^(2·IGR) − 1)
 */
export function shaleVolumeFromGamma(gammaRay: number, lines: { readonly clean: number; readonly shale: number }, method: ShaleVolumeMethod = "linear"): number {
  const index = Math.min(1, Math.max(0, (gammaRay - lines.clean) / (lines.shale - lines.clean)));
  const vsh = method === "linear" ? index : method === "larionov-tertiary" ? 0.083 * (2 ** (3.7 * index) - 1) : 0.33 * (2 ** (2 * index) - 1);
  return Math.min(1, Math.max(0, vsh));
}

/** Density porosity, v/v: (ρma − ρb) / (ρma − ρf). Sandstone matrix and fresh filtrate by default. */
export function densityPorosity(bulkDensity: number, matrixDensity = 2.65, fluidDensity = 1.0): number {
  if (!(matrixDensity > fluidDensity)) throw new RangeError("Matrix density must exceed fluid density.");
  return (matrixDensity - bulkDensity) / (matrixDensity - fluidDensity);
}

/**
 * Porosity from density and neutron (both v/v, neutron in matrix units). Where gas makes the
 * neutron read low (density porosity above neutron: the crossover), the root-mean-square of the
 * two; otherwise their mean.
 */
export function neutronDensityPorosity(densityPorosityValue: number, neutronPorosity: number): number {
  return densityPorosityValue > neutronPorosity
    ? Math.sqrt((densityPorosityValue ** 2 + neutronPorosity ** 2) / 2)
    : (densityPorosityValue + neutronPorosity) / 2;
}

export interface NetPayCutoffs {
  readonly vshMax: number;
  readonly porosityMin: number;
  readonly swMax: number;
}

export interface NetPaySample {
  readonly mdM: number;
  readonly vsh: number;
  /** Null where the porosity is not usable (bad hole, missing input). */
  readonly porosity: number | null;
  readonly sw: number | null;
}

export interface NetPaySummary {
  readonly grossM: number;
  /** Shale volume and porosity pass. */
  readonly netM: number;
  /** Net, and water saturation passes too. */
  readonly payM: number;
  readonly netToGross: number | null;
  /** Thickness-weighted means over net (porosity) and pay (saturation). */
  readonly porosityNet: number | null;
  readonly swPay: number | null;
  /** Σ φ·(1 − Sw)·h over pay, metres: the hydrocarbon column. */
  readonly hydrocarbonColumnM: number;
  readonly unusableSamples: number;
}

/**
 * Gross, net sand and net pay over a run of samples, each standing for the depth halfway to its
 * neighbours. A sample without a usable porosity counts in gross but can be neither net nor pay.
 */
export function netPaySummary(samples: readonly NetPaySample[], cutoffs: NetPayCutoffs): NetPaySummary {
  let gross = 0, net = 0, pay = 0, porositySum = 0, swSum = 0, column = 0, unusable = 0;
  samples.forEach((sample, index) => {
    // Each sample stands for the depth halfway to its neighbours; the end samples, half a step inward.
    const before = samples[index - 1]?.mdM ?? sample.mdM, after = samples[index + 1]?.mdM ?? sample.mdM;
    const h = Math.max(0, (after - before) / 2);
    gross += h;
    if (sample.porosity === null) { unusable++; return; }
    if (sample.vsh > cutoffs.vshMax || sample.porosity < cutoffs.porosityMin) return;
    net += h; porositySum += sample.porosity * h;
    if (sample.sw === null || sample.sw > cutoffs.swMax) return;
    pay += h; swSum += sample.sw * h; column += sample.porosity * (1 - sample.sw) * h;
  });
  return {
    grossM: gross, netM: net, payM: pay, netToGross: gross > 0 ? net / gross : null,
    porosityNet: net > 0 ? porositySum / net : null, swPay: pay > 0 ? swSum / pay : null,
    hydrocarbonColumnM: column, unusableSamples: unusable,
  };
}

// ── Crystalline-rock and quality helpers ─────────────────────────────────────────────────────

/** Dynamic Poisson's ratio from the velocity ratio Vp/Vs (= shear over compressional slowness): ν = (r² − 2) / (2(r² − 1)). */
export function poissonFromVelocityRatio(vpOverVs: number): number {
  if (!(vpOverVs > Math.SQRT2)) throw new RangeError("Vp/Vs must exceed √2 for a positive Poisson's ratio.");
  const r2 = vpOverVs ** 2;
  return (r2 - 2) / (2 * (r2 - 1));
}

/** Geometric mean, the right average for resistivity; null with no positive values. */
export function geometricMean(values: ArrayLike<number>): number | null {
  let sum = 0, count = 0;
  for (let i = 0; i < values.length; i++) { const value = values[i]!; if (value > 0 && Number.isFinite(value)) { sum += Math.log(value); count++; } }
  return count ? Math.exp(sum / count) : null;
}

/** Pearson correlation of two equal-length series over the pairs where both are finite; null below three pairs. */
export function correlation(x: ArrayLike<number>, y: ArrayLike<number>): number | null {
  if (x.length !== y.length) throw new RangeError("Correlation needs two series of the same length.");
  const pairs: [number, number][] = [];
  for (let i = 0; i < x.length; i++) if (Number.isFinite(x[i]!) && Number.isFinite(y[i]!)) pairs.push([x[i]!, y[i]!]);
  if (pairs.length < 3) return null;
  const mx = pairs.reduce((sum, [a]) => sum + a, 0) / pairs.length, my = pairs.reduce((sum, [, b]) => sum + b, 0) / pairs.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [a, b] of pairs) { sxy += (a - mx) * (b - my); sxx += (a - mx) ** 2; syy += (b - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/**
 * A reading pinned at a tool's limit is not a measurement: induction tools clip at their highest
 * resistivity, for one. True where the value is within `tolerance` of the limit.
 */
export const atToolLimit = (value: number, limit: number, tolerance = 1e-3 * Math.abs(limit)) => Math.abs(value - limit) <= tolerance;

/**
 * The value a curve is clipped at, if it is: its maximum, when at least `share` of the reported
 * samples sit on it. An induction log pinned at its ceiling across much of a resistive granite is
 * the case this is for. Null when the curve does not repeat its maximum that often.
 */
export function clippedAt(values: ArrayLike<number>, share = 0.01): number | null {
  let max = -Infinity, count = 0, total = 0;
  for (let i = 0; i < values.length; i++) { const value = values[i]!; if (!Number.isFinite(value)) continue; total++; if (value > max) { max = value; count = 1; } else if (value === max) count++; }
  return total > 0 && count / total >= share && count > 1 ? max : null;
}
