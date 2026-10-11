import type { WellComponent } from "@ikhmalputra/subsurface-core";

export function makeFieldConstruction(totalDepthM: number, reservoirTopMdM: number, reservoirBaseMdM: number): readonly WellComponent[] {
  const intermediateShoe = Math.min(900, reservoirTopMdM - 150);
  const tubingEnd = reservoirTopMdM - 10;
  const packerMd = reservoirTopMdM - 60;
  const records: WellComponent[] = [];
  function add(id: string, name: string, kind: WellComponent["kind"], od: number, inner: number | null, top: number, bottom: number, material: string, parentId?: string) {
    records.push({ id, name, kind, outerDiameterMm: od, innerDiameterMm: inner, topDepthM: top, bottomDepthM: bottom,
      material, parentId, topDepthReported: true, description: "Assumed synthetic Field construction. Not an installed-well record, equipment specification or verified barrier." });
  }
  add("conductor", "30-inch conductor", "Casing", 762, 711.2, 0, 120, "Steel");
  add("surface-casing", "20-inch surface casing", "Casing", 508, 473.1, 0, 350, "Steel");
  add("intermediate-casing", "13 3/8-inch intermediate casing", "Casing", 339.7, 315.3, 0, intermediateShoe, "Steel");
  add("production-casing", "9 5/8-inch production casing", "Casing", 244.5, 220.5, 0, totalDepthM, "Steel");
  add("surface-cement", "Surface casing cement", "Cement", 609.6, 508, 0, 350, "Cement", "surface-casing");
  add("intermediate-cement", "Intermediate casing cement", "Cement", 406.4, 339.7, 100, intermediateShoe, "Cement", "intermediate-casing");
  add("production-cement", "Production casing cement", "Cement", 311.2, 244.5, 300, totalDepthM, "Cement", "production-casing");
  add("production-tubing", "4 1/2-inch production tubing", "Tubular", 114.3, 100.5, 0, tubingEnd, "Steel");
  add("safety-valve", "Subsurface safety valve", "Safety valve", 160, 100.5, 175, 185, "Steel", "production-tubing");
  add("production-packer", "Production packer above R1", "Packer", 215, 114.3, packerMd - 5, packerMd + 5, "Steel / elastomer", "production-tubing");
  add("pressure-gauge", "Downhole gauge (no readings)", "Gauge", 150, null, packerMd - 30, packerMd - 27, "Steel", "production-tubing");
  add("r1-perforations", "R1 perforated casing interval", "Casing", 244.5, 220.5, reservoirTopMdM, reservoirBaseMdM, "Steel", "production-casing");
  add("subsea-wellhead", "Subsea wellhead housing", "Wellhead", 1050, 473.1, 0, 0, "Forged steel");
  add("tree-valve", "Subsea tree valve", "Valve", 650, 100.5, 0, 0, "Forged steel", "subsea-wellhead");
  for (const record of records) {
    if (record.topDepthM < 0 || record.bottomDepthM > totalDepthM || record.bottomDepthM < record.topDepthM) throw new RangeError("Synthetic Field construction lies outside survey coverage.");
  }
  return records;
}
