import { petrophysicsValueAt } from "./petrophysics.ts";
import type { PetrophysicsLogCurve, PetrophysicsWell, PetrophysicsZone } from "./petrophysics.ts";

export interface PetrophysicsCrossplotPoint {
  readonly mdM: number;
  readonly x: number;
  readonly y: number;
}

/** Pairs samples only when their MD keys are exactly equal; no resampling is performed. */
export function pairPetrophysicsCurves(
  xCurve: PetrophysicsLogCurve,
  yCurve: PetrophysicsLogCurve,
): readonly PetrophysicsCrossplotPoint[] {
  if (xCurve.wellId !== yCurve.wellId) throw new TypeError("Petrophysics crossplots require curves from the same well.");
  const points: PetrophysicsCrossplotPoint[] = [];
  let xIndex = 0;
  let yIndex = 0;
  while (xIndex < xCurve.depthsMdM.length && yIndex < yCurve.depthsMdM.length) {
    const xMdM = xCurve.depthsMdM[xIndex]!;
    const yMdM = yCurve.depthsMdM[yIndex]!;
    if (xMdM < yMdM) { xIndex++; continue; }
    if (yMdM < xMdM) { yIndex++; continue; }
    const x = petrophysicsValueAt(xCurve, xIndex);
    const y = petrophysicsValueAt(yCurve, yIndex);
    if (x !== null && y !== null) points.push({ mdM: xMdM, x, y });
    xIndex++;
    yIndex++;
  }
  return points;
}

export interface PetrophysicsHistogramBin {
  readonly lower: number;
  readonly upper: number;
  readonly count: number;
}

export interface PetrophysicsHistogram {
  readonly min: number | null;
  readonly max: number | null;
  readonly bins: readonly PetrophysicsHistogramBin[];
}

export function petrophysicsHistogram(curve: PetrophysicsLogCurve, binCount = 16): PetrophysicsHistogram {
  if (!Number.isSafeInteger(binCount) || binCount < 1 || binCount > 512) {
    throw new RangeError("Petrophysics histogram binCount must be an integer between 1 and 512.");
  }
  let min = Infinity;
  let max = -Infinity;
  let validCount = 0;
  for (let index = 0; index < curve.values.length; index++) {
    const value = petrophysicsValueAt(curve, index);
    if (value === null) continue;
    validCount++;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: null, max: null, bins: [] };
  const counts = Array.from({ length: binCount }, () => 0);
  if (min === max) counts[0] = validCount;
  else {
    for (let index = 0; index < curve.values.length; index++) {
      const value = petrophysicsValueAt(curve, index);
      if (value === null) continue;
      const bin = Math.min(binCount - 1, Math.floor(((value - min) / (max - min)) * binCount));
      counts[bin] = counts[bin]! + 1;
    }
  }
  const width = min === max ? 0 : (max - min) / binCount;
  return {
    min,
    max,
    bins: counts.map((count, index) => ({
      lower: min === max ? min : min + index * width,
      upper: min === max ? max : index === binCount - 1 ? max : min + (index + 1) * width,
      count,
    })),
  };
}

/** Returns the MD extent of the reported samples assigned to a histogram bin. */
export function petrophysicsHistogramDepthRange(
  curve: PetrophysicsLogCurve,
  histogram: PetrophysicsHistogram,
  binIndex: number,
): readonly [number, number] | null {
  if (!Number.isSafeInteger(binIndex) || binIndex < 0 || binIndex >= histogram.bins.length) {
    throw new RangeError("Histogram bin index is outside the supplied histogram.");
  }
  const bin = histogram.bins[binIndex]!;
  let minDepth = Infinity;
  let maxDepth = -Infinity;
  for (let sample = 0; sample < curve.values.length; sample++) {
    const value = petrophysicsValueAt(curve, sample);
    if (value === null) continue;
    const inBin = histogram.min === histogram.max
      ? binIndex === 0 && value === bin.lower
      : value >= bin.lower && (binIndex === histogram.bins.length - 1 ? value <= bin.upper : value < bin.upper);
    if (!inBin) continue;
    const depth = curve.depthsMdM[sample]!;
    minDepth = Math.min(minDepth, depth);
    maxDepth = Math.max(maxDepth, depth);
  }
  return Number.isFinite(minDepth) ? [minDepth, maxDepth] : null;
}

export interface PetrophysicsZoneSummaryRule {
  readonly curveId: string;
  readonly cutoff: number;
  readonly side: "above" | "below";
  /** Adjacent samples farther apart than this are not treated as a measured interval. */
  readonly maxSampleGapM: number;
}

export interface PetrophysicsZoneSummary {
  readonly zoneId: string;
  readonly curveId: string;
  readonly sampleCount: number;
  readonly reportedSampleCount: number;
  readonly mean: number | null;
  readonly grossSampledThicknessM: number;
  readonly netSampledThicknessM: number;
  readonly netToGross: number | null;
}

/** Mean uses reported samples inside [top, base); thickness uses only fully sampled adjacent intervals. */
export function summarizePetrophysicsZones(
  zones: readonly PetrophysicsZone[],
  curve: PetrophysicsLogCurve,
  rule: PetrophysicsZoneSummaryRule,
): readonly PetrophysicsZoneSummary[] {
  if (curve.id !== rule.curveId) throw new TypeError("Zone summary rule curveId must match the supplied curve.");
  if (!Number.isFinite(rule.cutoff)) throw new RangeError("Zone summary cutoff must be finite.");
  if (!Number.isFinite(rule.maxSampleGapM) || rule.maxSampleGapM <= 0) throw new RangeError("Zone summary maxSampleGapM must be positive.");
  return zones.map((zone) => {
    let sampleCount = 0;
    let sum = 0;
    let reportedSampleCount = 0;
    for (let index = 0; index < curve.depthsMdM.length; index++) {
      const mdM = curve.depthsMdM[index]!;
      if (mdM < zone.topMdM || mdM >= zone.baseMdM) continue;
      sampleCount++;
      const value = petrophysicsValueAt(curve, index);
      if (value !== null) {
        sum += value;
        reportedSampleCount++;
      }
    }
    let grossSampledThicknessM = 0;
    let netSampledThicknessM = 0;
    for (let index = 1; index < curve.depthsMdM.length; index++) {
      const startMdM = curve.depthsMdM[index - 1]!;
      const endMdM = curve.depthsMdM[index]!;
      const intervalM = endMdM - startMdM;
      if (startMdM < zone.topMdM || endMdM > zone.baseMdM || intervalM > rule.maxSampleGapM) continue;
      const startValue = petrophysicsValueAt(curve, index - 1);
      const endValue = petrophysicsValueAt(curve, index);
      if (startValue === null || endValue === null) continue;
      grossSampledThicknessM += intervalM;
      const startPass = rule.side === "above" ? startValue >= rule.cutoff : startValue <= rule.cutoff;
      const endPass = rule.side === "above" ? endValue >= rule.cutoff : endValue <= rule.cutoff;
      if (startPass && endPass) netSampledThicknessM += intervalM;
    }
    return {
      zoneId: zone.id,
      curveId: curve.id,
      sampleCount,
      reportedSampleCount,
      mean: reportedSampleCount === 0 ? null : sum / reportedSampleCount,
      grossSampledThicknessM,
      netSampledThicknessM,
      netToGross: grossSampledThicknessM === 0 ? null : netSampledThicknessM / grossSampledThicknessM,
    };
  });
}

export interface PetrophysicsFlattenedCurve {
  readonly curve: PetrophysicsLogCurve;
  /** Relative MD = supplied source MD - the explicitly tied marker MD. */
  readonly relativeDepthsM: Float64Array;
}

export interface PetrophysicsFlattenedWell {
  readonly well: PetrophysicsWell;
  readonly markerId: string;
  readonly markerMdM: number;
  readonly curves: readonly PetrophysicsFlattenedCurve[];
}

/** Builds display-only relative MD columns from the same explicitly identified top in every well. */
export function flattenPetrophysicsWells(
  wells: readonly PetrophysicsWell[],
  markerId: string,
): readonly PetrophysicsFlattenedWell[] {
  if (!markerId.trim()) throw new TypeError("Flatten markerId must be non-empty.");
  if (wells.length < 2) throw new RangeError("Petrophysics flattening requires at least two wells.");
  const wellIds = new Set<string>();
  const datum = wells[0]!.depthReference.datum;
  const flattened: PetrophysicsFlattenedWell[] = [];
  for (const well of wells) {
    if (wellIds.has(well.wellId)) throw new TypeError(`Duplicate well ID "${well.wellId}" in flatten input.`);
    wellIds.add(well.wellId);
    if (well.depthReference.unit !== "m" || well.depthReference.datum !== datum) {
      throw new TypeError("Petrophysics flattening requires matching MD units and depth datums.");
    }
    const marker = well.tops.find((top) => top.id === markerId);
    if (!marker) throw new TypeError(`Well "${well.wellId}" has no explicit top tie "${markerId}".`);
    flattened.push({
      well,
      markerId,
      markerMdM: marker.mdM,
      curves: well.curves.map((curve) => ({
        curve,
        relativeDepthsM: Float64Array.from(curve.depthsMdM, (mdM) => mdM - marker.mdM),
      })),
    });
  }
  return flattened;
}
