import { validateWellboreTrajectory, validateWellLogCurve } from "@ikhmalputra/subsurface-core/contracts";
import type { CorrelationWell, CrossSectionWell } from "@ikhmalputra/subsurface-react/2d";
import type { GisStation } from "@ikhmalputra/subsurface-core/gis";
import type { WellDesign } from "@ikhmalputra/subsurface-core";
import { makeOffshoreFixture } from "./offshore-fixture.ts";
import { makeFieldConstruction } from "./field-construction.ts";

export type FieldLog = "gr" | "porosity" | "resistivity";
export interface FieldCutoffs { readonly grMax: number; readonly phiMin: number; readonly rtMin: number }
export const defaultFieldCutoffs: FieldCutoffs = { grMax: 75, phiMin: 0.12, rtMin: 5 };
export interface FieldOptions {
  readonly log: FieldLog;
  readonly flatten: string | null;
  readonly focusInterval: boolean;
  readonly view: "3d" | "map";
  readonly offset: number;
  readonly endpoints: readonly [string, string];
  readonly cutoffs: FieldCutoffs;
}
export const fieldLogs = {
  gr: { label: "Gamma ray", unit: "API", color: "#9a5b00", domain: [0, 150] as const },
  porosity: { label: "Effective porosity", unit: "v/v", color: "#147a65", domain: [0, 0.3] as const },
  resistivity: { label: "Deep resistivity", unit: "ohm.m", color: "#235faa", domain: [0, 50] as const },
};

function mdAtDepth(xyz: Float64Array, depths: Float64Array, depth: number): number {
  for (let i = 1; i < depths.length; i++) {
    const a = xyz[(i - 1) * 3 + 2]!, b = xyz[i * 3 + 2]!;
    if (depth >= a && depth <= b) return depths[i - 1]! + (depth - a) / (b - a) * (depths[i]! - depths[i - 1]!);
  }
  throw new RangeError("Synthetic field marker is outside the supplied trajectory.");
}

function screenSamples(stations: readonly GisStation[], values: Record<FieldLog, ArrayLike<number>>, waterDepth: number, top: number, base: number, cutoffs: FieldCutoffs) {
  if (![cutoffs.grMax, cutoffs.phiMin, cutoffs.rtMin].every(Number.isFinite) || cutoffs.grMax < 0 || cutoffs.phiMin < 0 || cutoffs.phiMin > 1 || cutoffs.rtMin < 0) throw new RangeError("Quality cutoffs require non-negative finite GR/resistivity and porosity between 0 and 1.");
  let tested = 0, net = 0, phiThickness = 0;
  const gross = base - top;
  for (let at = 1; at < stations.length; at++) {
    const a = stations[at - 1]!.xyz[2] + waterDepth, b = stations[at]!.xyz[2] + waterDepth;
    const thickness = Math.max(0, Math.min(b, base) - Math.max(a, top));
    if (!thickness) continue;
    const samples = [values.gr[at - 1]!, values.porosity[at - 1]!, values.resistivity[at - 1]!, values.gr[at]!, values.porosity[at]!, values.resistivity[at]!];
    if (!samples.every(Number.isFinite)) continue;
    tested += thickness;
    const gr = (samples[0]! + samples[3]!) / 2, phi = (samples[1]! + samples[4]!) / 2, rt = (samples[2]! + samples[5]!) / 2;
    if (gr < cutoffs.grMax && phi >= cutoffs.phiMin && rt >= cutoffs.rtMin) { net += thickness; phiThickness += phi * thickness; }
  }
  return { gross, tested, net, meanPhi: net > 0 ? phiThickness / net : null };
}

/** One synthetic geological scenario shared by geographic, log and section adapters. */
export function makeFieldProject() {
  const offshore = makeOffshoreFixture();
  const records = offshore.model.wells.map(({ well, stations }, index) => {
    const waterDepth = offshore.waterDepthsM[well.id]!;
    const head = stations[0]!.xyz;
    const structuralShift = (head[0] - offshore.origin[0]) * 0.025 + (head[1] - offshore.origin[1]) * 0.035;
    const reservoirTopDepth = 2200 + structuralShift;
    const reservoirBaseDepth = reservoirTopDepth + 210 - index * 20;
    const tops = [
      { id: "reservoir-top", label: "Sand R1 top", mdM: mdAtDepth(well.xyz, well.depthsMdM, reservoirTopDepth - waterDepth) },
      { id: "reservoir-base", label: "Sand R1 base", mdM: mdAtDepth(well.xyz, well.depthsMdM, reservoirBaseDepth - waterDepth) },
    ];
    const values = { gr: new Float32Array(stations.length), porosity: new Float32Array(stations.length), resistivity: new Float32Array(stations.length) };
    stations.forEach((station, at) => {
      const depth = station.xyz[2] + waterDepth;
      const sand = depth >= reservoirTopDepth && depth <= reservoirBaseDepth;
      const texture = Math.sin(at * 1.7 + index) * 0.5 + Math.cos(at * 0.45) * 0.5;
      values.gr[at] = sand ? 40 + index * 6 + texture * 15 : 110 + texture * 20;
      values.porosity[at] = sand ? 0.22 - index * 0.025 + texture * 0.025 : 0.065 + texture * 0.02;
      values.resistivity[at] = sand ? 18 - index * 4 + texture * 5 : 2.5 + texture;
      // A declared acquisition gap intersects R1 in Equator C.
      if (index === 2 && depth > reservoirTopDepth + 40 && depth < reservoirTopDepth + 105) {
        values.gr[at] = NaN; values.porosity[at] = NaN; values.resistivity[at] = NaN;
      }
    });
    const makeTrack = (key: FieldLog): CorrelationWell["tracks"][number] => ({
      ...fieldLogs[key],
      curve: validateWellLogCurve({ version: 1, id: `${well.id}-${key}`, wellId: well.id, unit: fieldLogs[key].unit, depthsMdM: well.depthsMdM, values: values[key], nullValue: "nan" }),
    });
    const tracks = { gr: makeTrack("gr"), porosity: makeTrack("porosity"), resistivity: makeTrack("resistivity") };
    const sectionXyz = Float64Array.from(well.xyz, (value, at) => at % 3 === 2 ? value + waterDepth : value);
    const section: CrossSectionWell = {
      id: well.id, label: well.label, provenance: "synthetic", tops,
      trajectory: validateWellboreTrajectory({ version: 1, id: well.id,
        reference: { units: "m", crs: well.crs, depthDatum: "synthetic sea surface; depth positive down" },
        xyz: sectionXyz, depthsMdM: well.depthsMdM,
        inclinationsDeg: offshore.surveys[well.id]!.inclinationsDeg,
        azimuthsDeg: offshore.surveys[well.id]!.azimuthsDeg }),
    };
    const source = offshore.surveys[well.id]!;
    const sceneDesign: WellDesign = {
      id: well.id, revision: 1, wellName: well.label, units: "m", provenance: "synthetic",
      totalDepthM: well.depthsMdM.at(-1)!, casingBottomM: well.depthsMdM.at(-1)!,
      components: makeFieldConstruction(well.depthsMdM.at(-1)!, tops[0]!.mdM, tops[1]!.mdM),
      depthDatum: well.depthDatum, trajectorySource: well.source,
      survey: stations.map((station, at) => ({
        mdM: station.mdM, tvdM: station.xyz[2],
        eastingM: source.xyz[at * 3]!, northingM: source.xyz[at * 3 + 1]!,
        inclinationDeg: source.inclinationsDeg[at]!, azimuthDeg: source.azimuthsDeg[at]!,
      })),
    };
    return { well, stations, tracks, tops, section, sceneDesign, reservoirTopDepth, reservoirBaseDepth,
      summary: screenSamples(stations, values, waterDepth, reservoirTopDepth, reservoirBaseDepth, defaultFieldCutoffs) };
  });
  return { ...offshore, records };
}

export type FieldProject = ReturnType<typeof makeFieldProject>;

export function screenFieldInterval(record: FieldProject["records"][number], waterDepth: number, cutoffs: FieldCutoffs) {
  return screenSamples(record.stations, { gr: record.tracks.gr.curve.values, porosity: record.tracks.porosity.curve.values, resistivity: record.tracks.resistivity.curve.values }, waterDepth, record.reservoirTopDepth, record.reservoirBaseDepth, cutoffs);
}

export function fieldCorrelationWells(project: FieldProject, ids: readonly string[], log: FieldLog, focusInterval = false): CorrelationWell[] {
  return ids.map((id) => {
    const record = project.records.find((item) => item.well.id === id);
    if (!record) throw new TypeError(`Unknown field well "${id}".`);
    const track = record.tracks[log];
    const low = record.tops[0]!.mdM - 100, high = record.tops[1]!.mdM + 100;
    const start = track.curve.depthsMdM.findIndex((md) => md >= low);
    const after = track.curve.depthsMdM.findIndex((md) => md > high);
    const end = after === -1 ? track.curve.depthsMdM.length : after;
    const displayed = focusInterval ? { ...track, curve: validateWellLogCurve({ ...track.curve, depthsMdM: track.curve.depthsMdM.slice(start, end), values: track.curve.values.slice(start, end) }) } : track;
    return { id, label: record.well.label, provenance: "synthetic", tracks: [displayed], tops: record.tops };
  });
}
