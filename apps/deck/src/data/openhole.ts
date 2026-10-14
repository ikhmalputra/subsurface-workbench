import { feetToMetres, metresToFeet } from "@ikhmalputra/subsurface-core";
import { lasCurve, parseLas } from "@ikhmalputra/subsurface-core/records";
import type { LasFile } from "@ikhmalputra/subsurface-core/records";
import type { PetrophysicsLogCurve, PetrophysicsWell } from "@ikhmalputra/subsurface-core/contracts";
import { useFetched } from "./fetch.ts";
import { forgeWell } from "./sites.ts";

/**
 * FORGE 16A(78)-32's open-hole logs (GDR 1292, CC BY 4.0): Schlumberger's thru-bit combination,
 * dipole-sonic deliverables, HNGS spectral gamma ray and the FMI fracture intensity, binned to
 * 1 ft by tools/survey/build_forge_openhole.py. Depth is MD in feet as logged, converted once here.
 */
export interface OpenHole {
  readonly las: LasFile;
  readonly well: PetrophysicsWell;
  readonly curve: (mnemonic: string) => PetrophysicsLogCurve;
  /** The intermediate shoe: above it the tools were inside 9 5/8 in casing. MD metres. */
  readonly shoeMdM: number;
  readonly logBaseMdM: number;
}

const URL = "/data/forge-16a-openhole-1ft.las";
const shoe = forgeWell.components.find((component) => component.id === "intermediate-casing");
const SHOE_MD = shoe?.rawBottomDepthFt ? feetToMetres(shoe.rawBottomDepthFt) : shoe?.bottomDepthM ?? 0;

function build(buffer: ArrayBuffer): OpenHole {
  const las = parseLas(new TextDecoder().decode(buffer));
  const depthsMdM = Float64Array.from(las.curves[0]!.values, (ft) => feetToMetres(ft ?? Number.NaN));
  const depthReference = { kind: "MD", unit: "m", datum: "RKB" } as const;
  const curves: PetrophysicsLogCurve[] = las.curves.slice(1).map((curve) => ({
    version: 1, id: `forge-${curve.mnemonic.toLowerCase()}`, wellId: "forge", mnemonic: curve.mnemonic, name: curve.description || curve.mnemonic, unit: curve.unit,
    depthReference, depthsMdM, values: Float64Array.from(curve.values, (value) => value ?? Number.NaN), nullValue: "nan",
  }));
  const base = depthsMdM[depthsMdM.length - 1]!;
  const well: PetrophysicsWell = {
    version: 1, wellId: "forge", depthReference, provenance: "documented", curves,
    zones: [
      { id: "cased", name: "Inside 9 5/8 in casing", topMdM: depthsMdM[0]!, baseMdM: SHOE_MD, lithology: "Granite behind casing", color: "#7c849e" },
      { id: "granite", name: "Granite, open hole", topMdM: SHOE_MD, baseMdM: base, lithology: "Crystalline granite", color: "#c9a9a6" },
    ],
    tops: [{ id: "shoe", name: "9 5/8 in shoe", mdM: SHOE_MD }],
    corePoints: [],
  };
  const byMnemonic = new Map(curves.map((curve) => [curve.mnemonic, curve]));
  return { las, well, curve: (mnemonic) => byMnemonic.get(mnemonic) ?? (() => { throw new RangeError(`No ${mnemonic} in the FORGE open-hole set.`); })(), shoeMdM: SHOE_MD, logBaseMdM: base };
}

export function useForgeOpenHole(enabled: boolean): { readonly openHole: OpenHole | null; readonly error: string | null } {
  const loaded = useFetched(enabled ? URL : null, build);
  return { openHole: loaded.value, error: loaded.error };
}

/** A curve's value at a depth: the 1 ft sample containing it, null if not reported. */
export function valueAt(openHole: OpenHole, mnemonic: string, mdM: number): number | null {
  const curve = lasCurve(openHole.las, mnemonic);
  if (!curve) return null;
  // The set is a regular 1 ft grid, so the sample is found by its offset from the first depth.
  const first = openHole.las.curves[0]!.values[0] ?? 0;
  const index = Math.floor(metresToFeet(mdM) - first);
  return index < 0 || index >= curve.values.length ? null : curve.values[index] ?? null;
}
