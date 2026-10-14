import type { LasCurve, LasFile } from "./records.ts";
import type { PetrophysicsCorePoint, PetrophysicsLogCurve, PetrophysicsWell, PetrophysicsZone } from "./petrophysics.ts";

/**
 * Synthetic open-hole logs for a clastic reservoir, built from a rock and fluid model rather than
 * drawn: every curve is what the tool would read on that rock with that fluid, so the logs agree
 * with one another and with the physics the calculations assume.
 *
 * The model, per sample:
 *  - Lithology. Background shale (Vsh 0.75–0.95) with thin silty stringers; the reservoir sand is
 *    two or three stacked fining-upward units (shale fraction rising toward each unit's top)
 *    separated by thin shale breaks. Porosity falls with shale fraction and with depth.
 *  - Fluids, by depth below the sea surface, from field-wide contacts: gas above the GOC, oil to
 *    the OWC, water below, with a capillary transition zone over the OWC. Irreducible saturation
 *    rises with shale fraction.
 *  - Invasion. Density and neutron read the flushed zone: mud filtrate plus residual hydrocarbon.
 *    Gas therefore shows the density–neutron crossover; oil barely does.
 *  - Tools. GR from shale fraction; RHOB and NPHI by volume mixing (NPHI in limestone units, so
 *    clean sandstone reads −0.035 at zero porosity); DT by Wyllie with a shale compaction trend; RT
 *    by Archie on the sand with shale in parallel; caliper on gauge in sand (mudcake) and washed
 *    out in some shales, where RHOB reads low and DRHO says so. Each curve is smoothed to its
 *    tool's vertical resolution and carries seeded noise.
 *
 * Everything returned is labelled synthetic. The same seed always gives the same well.
 */

export interface SyntheticLogInput {
  readonly wellId: string;
  /** Stations along the well: measured depth and depth below the sea surface (TVDSS), metres. */
  readonly stations: readonly { readonly mdM: number; readonly tvdssM: number }[];
  /** The logged interval, MD metres. */
  readonly loggedFromMdM: number;
  readonly loggedToMdM: number;
  /** The reservoir sand's top and base picks, MD metres. */
  readonly sand: { readonly topMdM: number; readonly baseMdM: number; readonly name: string };
  /** Field-wide fluid contacts, TVDSS metres; null where the field has none. */
  readonly contacts: { readonly gocTvdssM: number | null; readonly owcTvdssM: number | null };
  readonly bitSizeIn?: number;
  /** Formation-water resistivity at formation temperature, ohm.m. */
  readonly rwOhmM?: number;
  readonly stepM?: number;
  readonly seed: number;
}

export interface SyntheticLogs {
  readonly well: PetrophysicsWell;
  readonly las: LasFile;
  /** The model behind the logs, per sample, for checking them: shale fraction, porosity, water saturation, fluid. */
  readonly truth: { readonly mdM: Float64Array; readonly vsh: Float64Array; readonly phi: Float64Array; readonly sw: Float64Array; readonly fluid: readonly ("gas" | "oil" | "water")[] };
  /** Archie parameters the resistivity was built with. */
  readonly archie: { readonly a: number; readonly m: number; readonly n: number; readonly rwOhmM: number };
  /** MD of each contact the well crosses inside the sand. */
  readonly contactsMdM: { readonly goc: number | null; readonly owc: number | null };
}

/** Mulberry32: small, fast and deterministic. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smooth(values: Float64Array, stepM: number, windowM: number): Float64Array {
  const half = Math.max(0, Math.round(windowM / stepM / 2));
  if (half === 0) return values;
  const out = new Float64Array(values.length);
  let sum = 0, count = 0;
  for (let i = 0; i < Math.min(values.length, half); i++) { sum += values[i]!; count++; }
  for (let i = 0; i < values.length; i++) {
    const add = i + half, drop = i - half - 1;
    if (add < values.length) { sum += values[add]!; count++; }
    if (drop >= 0) { sum -= values[drop]!; count--; }
    out[i] = sum / count;
  }
  return out;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function syntheticReservoirLogs(input: SyntheticLogInput): SyntheticLogs {
  const step = input.stepM ?? 0.25;
  const bit = input.bitSizeIn ?? 8.5;
  const rw = input.rwOhmM ?? 0.045;
  const archie = { a: 1, m: 2, n: 2, rwOhmM: rw };
  if (!(input.loggedToMdM > input.loggedFromMdM)) throw new RangeError("The logged interval must have a base below its top.");
  if (!(input.sand.baseMdM > input.sand.topMdM)) throw new RangeError("The sand base must be below its top.");
  if (input.stations.length < 2) throw new RangeError("At least two stations are needed to place the logs in depth.");
  const rand = random(input.seed);
  const gauss = () => { const u = Math.max(1e-12, rand()), v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const tvdssAt = (md: number) => {
    const s = input.stations;
    if (md <= s[0]!.mdM) return s[0]!.tvdssM;
    for (let i = 1; i < s.length; i++) if (md <= s[i]!.mdM) { const t = (md - s[i - 1]!.mdM) / (s[i]!.mdM - s[i - 1]!.mdM || 1); return s[i - 1]!.tvdssM + t * (s[i]!.tvdssM - s[i - 1]!.tvdssM); }
    return s.at(-1)!.tvdssM;
  };
  /** Where the well crosses a depth inside an interval; null if it is wholly above or below it. */
  const mdAtTvdss = (tvdss: number, from: number, to: number): number | null => {
    if (tvdssAt(from) >= tvdss) return null;
    for (let md = from; md <= to; md += step) if (tvdssAt(md) >= tvdss) return md;
    return null;
  };

  // The sand's architecture: stacked units and the breaks between them, seeded per well.
  const breaks = (rand() < 0.5 ? [0.36 + rand() * 0.06] : [0.3 + rand() * 0.05, 0.62 + rand() * 0.06]).map((at) => ({ at, thickM: 0.6 + rand() * 1.2 }));
  // Thin silty stringers in the shales, and the shale beds that are washed out.
  const stringers: { top: number; base: number }[] = [];
  for (let md = input.loggedFromMdM + 10 + rand() * 25; md < input.loggedToMdM; md += 25 + rand() * 45) stringers.push({ top: md, base: md + 0.4 + rand() * 1.6 });
  const washouts: { top: number; base: number; extraIn: number }[] = [];
  for (let md = input.loggedFromMdM + rand() * 40; md < input.loggedToMdM; md += 30 + rand() * 70) washouts.push({ top: md, base: md + 2 + rand() * 9, extraIn: 0.8 + rand() * 2.4 });

  const count = Math.floor((input.loggedToMdM - input.loggedFromMdM) / step) + 1;
  const md = new Float64Array(count), vsh = new Float64Array(count), phi = new Float64Array(count), sw = new Float64Array(count);
  const fluid: ("gas" | "oil" | "water")[] = [];
  const raw = { GR: new Float64Array(count), RHOB: new Float64Array(count), NPHI: new Float64Array(count), DT: new Float64Array(count), RT: new Float64Array(count), CALI: new Float64Array(count), DRHO: new Float64Array(count) };
  const { gocTvdssM: goc, owcTvdssM: owc } = input.contacts;
  const sandThick = input.sand.baseMdM - input.sand.topMdM;
  let shaleWander = 0;
  for (let i = 0; i < count; i++) {
    const depth = input.loggedFromMdM + i * step;
    md[i] = depth;
    const tvdss = tvdssAt(depth);
    shaleWander = shaleWander * 0.995 + gauss() * 0.01;
    // Lithology and porosity.
    let v: number, porosity: number;
    const inSand = depth >= input.sand.topMdM && depth < input.sand.baseMdM;
    if (inSand) {
      const u = (depth - input.sand.topMdM) / sandThick;
      const brk = breaks.find((entry) => Math.abs((u - entry.at) * sandThick) < entry.thickM / 2);
      if (brk) { v = 0.82 + gauss() * 0.04; porosity = 0.05; }
      else {
        // Units between breaks fine upward: the shale fraction rises toward each unit's top.
        const edges = [0, ...breaks.map((entry) => entry.at), 1];
        const unit = edges.findIndex((edge, index) => u >= edge && u < (edges[index + 1] ?? 1.01));
        const local = (u - edges[unit]!) / ((edges[unit + 1] ?? 1) - edges[unit]!); // 0 at the unit's top
        v = clamp(0.05 + 0.24 * (1 - local) ** 2.2 + gauss() * 0.025, 0.02, 0.6);
        porosity = clamp(0.29 - 0.42 * v - 0.00005 * (tvdss - 2200) + gauss() * 0.012, 0.04, 0.33);
      }
    } else {
      const stringer = stringers.find((entry) => depth >= entry.top && depth < entry.base);
      v = clamp((stringer ? 0.42 : 0.86) + shaleWander + gauss() * 0.035, 0.3, 0.98);
      porosity = stringer ? 0.12 : 0.04;
    }
    // Fluids, by depth below sea, from the field's contacts.
    const fl: "gas" | "oil" | "water" = goc !== null && tvdss < goc ? "gas" : owc !== null && tvdss < owc ? "oil" : (owc === null && goc !== null ? "oil" : "water");
    const swi = clamp(0.1 + 0.55 * v, 0.1, 1);
    let saturation = 1;
    if (inSand && fl !== "water" && owc !== null) {
      const height = owc - tvdss;
      saturation = clamp(swi + (1 - swi) * Math.exp(-height / 3.2), swi, 1);
    } else if (inSand && fl !== "water") saturation = swi;
    if (!inSand) saturation = 1;
    const fluidHere: "gas" | "oil" | "water" = saturation >= 0.999 ? "water" : fl;
    vsh[i] = v; phi[i] = porosity; sw[i] = saturation; fluid.push(fluidHere);
    // The flushed zone: filtrate replaces most movable hydrocarbon.
    const sxo = 1 - 0.3 * (1 - saturation);
    const hcDensity = fluidHere === "gas" ? 0.22 : 0.78, hcHi = fluidHere === "gas" ? 0.32 : 0.95;
    const rhoFluid = sxo * 1.05 + (1 - sxo) * hcDensity, hiFluid = sxo * 1 + (1 - sxo) * hcHi;
    const sandRho = porosity * rhoFluid + (1 - porosity) * 2.65;
    const sandN = porosity * hiFluid - 0.035 - (fluidHere === "gas" ? 0.02 * (1 - sxo) / 0.3 : 0);
    const shaleDt = 128 - 0.008 * (tvdss - 1500);
    const sandDt = 55.5 * (1 - porosity) + 189 * porosity + (fluidHere === "gas" ? 6 : 0);
    const rSand = archie.a * rw / (Math.max(porosity, 0.02) ** archie.m * saturation ** archie.n);
    const rShale = 1.6 + 0.6 * Math.sin(depth / 37) + gauss() * 0.1;
    // Caliper: mudcake across permeable sand, washouts in some shales.
    const washout = !inSand ? washouts.find((entry) => depth >= entry.top && depth < entry.base) : undefined;
    const caliper = inSand && v < 0.4 ? bit - 0.12 : bit + (washout ? washout.extraIn * Math.sin(Math.PI * (depth - washout.top) / (washout.base - washout.top)) : 0) + 0.05;
    const badHole = Math.max(0, caliper - (bit + 0.8));
    raw.GR[i] = 24 + v * (122 - 24) + gauss() * 3.5;
    raw.RHOB[i] = v * 2.54 + (1 - v) * sandRho - 0.11 * badHole + gauss() * 0.012;
    raw.DRHO[i] = 0.012 + 0.07 * badHole + gauss() * 0.006;
    raw.NPHI[i] = v * 0.37 + (1 - v) * sandN + 0.03 * badHole + gauss() * 0.012;
    raw.DT[i] = v * shaleDt + (1 - v) * sandDt + gauss() * 1.5;
    raw.RT[i] = Math.min(2000, 1 / ((1 - v) / rSand + v / Math.max(0.5, rShale)));
    raw.CALI[i] = caliper + gauss() * 0.03;
  }
  // Each tool's vertical resolution.
  const curves = {
    GR: { values: smooth(raw.GR, step, 0.6), unit: "gAPI", name: "Gamma ray" },
    CALI: { values: smooth(raw.CALI, step, 0.4), unit: "in", name: "Caliper" },
    RHOB: { values: smooth(raw.RHOB, step, 0.45), unit: "g/cm3", name: "Bulk density" },
    DRHO: { values: smooth(raw.DRHO, step, 0.45), unit: "g/cm3", name: "Density correction" },
    NPHI: { values: smooth(raw.NPHI, step, 0.6), unit: "v/v", name: "Neutron porosity (limestone units)" },
    DT: { values: smooth(raw.DT, step, 0.6), unit: "us/ft", name: "Compressional slowness" },
    RT: { values: smooth(raw.RT, step, 1.2), unit: "ohm.m", name: "Deep resistivity" },
  } as const;
  const depthReference = { kind: "MD", unit: "m", datum: "synthetic seabed wellhead" } as const;
  const logCurves: PetrophysicsLogCurve[] = Object.entries(curves).map(([mnemonic, curve]) => Object.freeze({
    version: 1 as const, id: `${input.wellId}-${mnemonic.toLowerCase()}`, wellId: input.wellId, mnemonic, name: curve.name, unit: curve.unit,
    depthReference, depthsMdM: md, values: curve.values, nullValue: null,
  }));
  const gocMd = goc === null ? null : mdAtTvdss(goc, input.sand.topMdM, input.sand.baseMdM);
  const owcMd = owc === null ? null : mdAtTvdss(owc, input.sand.topMdM, input.sand.baseMdM);
  const zones: PetrophysicsZone[] = [
    { id: "upper-shale", name: "Upper shale", topMdM: input.loggedFromMdM, baseMdM: input.sand.topMdM, lithology: "Shale", color: "#9aa7a0" },
    { id: "sand", name: input.sand.name, topMdM: input.sand.topMdM, baseMdM: input.sand.baseMdM, lithology: "Sandstone", color: "#e3cf8f" },
    { id: "lower-shale", name: "Lower shale", topMdM: input.sand.baseMdM, baseMdM: input.loggedToMdM, lithology: "Shale", color: "#9aa7a0" },
  ];
  const tops = [
    { id: "reservoir-top", name: `${input.sand.name} top`, mdM: input.sand.topMdM },
    ...(gocMd !== null ? [{ id: "goc", name: "Gas–oil contact", mdM: gocMd }] : []),
    ...(owcMd !== null ? [{ id: "owc", name: "Oil–water contact", mdM: owcMd }] : []),
    { id: "reservoir-base", name: `${input.sand.name} base`, mdM: input.sand.baseMdM },
  ];
  // Core plugs from the cleanest parts of the sand, with Timur permeability from the model.
  const corePoints: PetrophysicsCorePoint[] = [];
  for (let k = 0; k < 5; k++) {
    const at = input.sand.topMdM + sandThick * (0.12 + 0.18 * k);
    const index = Math.min(count - 1, Math.max(0, Math.round((at - input.loggedFromMdM) / step)));
    if (vsh[index]! > 0.4) continue;
    const swirr = clamp(0.1 + 0.55 * vsh[index]!, 0.1, 1);
    const permeability = 0.136 * (phi[index]! * 100) ** 4.4 / (swirr * 100) ** 2;
    corePoints.push({ id: `plug-${k + 1}`, mdM: md[index]!, label: `Plug ${k + 1}`, description: "Synthetic core plug drawn from the rock model.", measurements: [
      { id: `plug-${k + 1}-phi`, mnemonic: "CPOR", value: Math.round(phi[index]! * 1000) / 1000, unit: "v/v" },
      { id: `plug-${k + 1}-k`, mnemonic: "CPERM", value: Math.round(permeability * 10) / 10, unit: "mD" },
    ] });
  }
  const well: PetrophysicsWell = Object.freeze({ version: 1, wellId: input.wellId, depthReference, provenance: "synthetic", curves: Object.freeze(logCurves), zones: Object.freeze(zones), tops: Object.freeze(tops), corePoints: Object.freeze(corePoints) });
  const header = (mnemonic: string, unit: string, value: string, description: string) => ({ mnemonic, unit, value, description });
  const lasCurves: LasCurve[] = [
    { ...header("DEPT", "m", "", "Measured depth"), values: Array.from(md) },
    ...Object.entries(curves).map(([mnemonic, curve]) => ({ ...header(mnemonic, curve.unit, "", curve.name), values: Array.from(curve.values, (value) => Math.round(value * 10000) / 10000) })),
  ];
  const las: LasFile = Object.freeze({
    version: "2.0",
    well: { WELL: header("WELL", "", input.wellId, "Well"), STRT: header("STRT", "m", String(input.loggedFromMdM), "Start"), STOP: header("STOP", "m", String(md[count - 1]), "Stop"), STEP: header("STEP", "m", String(step), "Step"), NULL: header("NULL", "", "-999.25", "Null"), SRVC: header("SRVC", "", "synthetic", "Synthetic rock-model logs; not measured") },
    parameters: { BS: header("BS", "in", String(bit), "Bit size"), RW: header("RW", "ohm.m", String(rw), "Formation water resistivity at formation temperature") },
    curves: lasCurves,
    nullValue: -999.25,
  });
  return { well, las, truth: { mdM: md, vsh, phi, sw, fluid }, archie, contactsMdM: { goc: gocMd, owc: owcMd } };
}
