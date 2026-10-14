import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { lasCurve, parseLas } from "./records.ts";

// The 1 ft open-hole set built by tools/survey/build_forge_openhole.py from GDR 1292 (CC BY 4.0).
const las = parseLas(readFileSync(new URL("../../fixtures/data/forge-16a-openhole-1ft.las", import.meta.url), "utf8"));
const at = (mnemonic: string, depthFt: number) => {
  const index = las.curves[0]!.values.indexOf(depthFt);
  return lasCurve(las, mnemonic)!.values[index];
};

test("the FORGE open-hole set keeps its sources, licence and curves", () => {
  assert.equal(las.parameters.LIC?.value, "CC-BY-4.0");
  for (const source of ["R08_TB_TCOM", "PNS", "ISOMECHPRO", "SPECTRAL", "FMI_P32"]) {
    assert.match(las.parameters[`SHA_${source}`]?.value ?? "", /^[0-9a-f]{64}$/, source);
    assert.match(las.parameters[`SRC_${source}`]?.value ?? "", /gdr\.openei\.org\/files\/1292/, source);
  }
  assert.deepEqual(las.curves.map((curve) => curve.mnemonic), ["DEPTH", "GR", "CGR", "K", "TH", "U", "NPHI", "NPHI_SAN", "DPHI", "SPHI", "DTC", "DTS", "RT10", "RT90", "C13", "C24", "BS", "DEVI", "P32", "UCS", "YME_STA", "PR", "SV_G", "SHMIN_G", "PP_G"]);
  assert.equal(las.curves[0]!.values.length, 5951);
});

test("values are the source's, binned to 1 ft, with nulls kept as nulls", () => {
  assert.equal(at("GR", 5001), 105.39);
  assert.equal(at("BS", 5001), 12.25, "above the 9 5/8 in shoe the tools are inside casing");
  assert.equal(at("BS", 6000), 8.75);
  assert.equal(at("UCS", 5500), null, "IsoMechPro starts at 6,000 ft");
  assert.ok((at("DPHI", 8000) ?? 1) < 0.1, "granite: a few percent porosity at most");
});
