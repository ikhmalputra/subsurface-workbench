import assert from "node:assert/strict";
import test from "node:test";
import { exampleWellBrief } from "@ikhmalputra/subsurface-core";
import { tvdAtMd } from "@ikhmalputra/subsurface-core/well-design";
import { PACKER_RATING_PSI, annuliOf, annulusPressures, rameyOf } from "../src/data/integrity-model.ts";

const FT = 3.28084;

test("Kestrel's annuli: A to the packer, B and C to the cement; each MAASP the least of its limits", () => {
  const brief = exampleWellBrief();
  const annuli = annuliOf(brief);
  assert.ok(typeof annuli !== "string", String(annuli));
  assert.deepEqual(annuli.map((a) => a.name), ["A", "B", "C"]);
  const [a, b, c] = annuli;
  assert.equal(a!.bottomMdM, brief.completion!.packerMdM);
  assert.ok(a!.trapped);
  // A's packer limit by hand: rating − packer fluid over the packer's TVD + gas inside the tubing (0.1 psi/ft).
  const tvdFt = tvdAtMd(brief, brief.completion!.packerMdM) * FT;
  const fluid = (brief.completion!.packerFluidSg ?? [...brief.sections].sort((x, y) => y.shoeMdM - x.shoeMdM)[0]!.mudWeightSg) * 0.433;
  const packer = a!.maasp.limits.find((l) => l.limit === "packer")!.psi;
  assert.ok(Math.abs(packer - (PACKER_RATING_PSI - fluid * tvdFt + 0.1 * tvdFt)) < 1e-6, `${packer}`);
  for (const an of annuli) {
    assert.equal(an.maasp.maaspPsi, Math.max(0, Math.min(...an.maasp.limits.map((l) => l.psi))), `${an.name} MAASP is its least limit`);
    assert.ok(an.maasp.maaspPsi > 0 && an.maasp.maaspPsi < 10000, `${an.name}: ${an.maasp.maaspPsi}`);
  }
  // The casing annuli end shallower going out.
  assert.ok(b!.bottomMdM < a!.bottomMdM && c!.bottomMdM < b!.bottomMdM);
  // No completion: nothing to read.
  assert.equal(typeof annuliOf({ ...brief, completion: undefined }), "string");
});

test("Annulus pressure: grows as the well warms, bleeds off and builds again, lift gas holds A, a vented annulus builds nothing", () => {
  const brief = exampleWellBrief();
  const annuli = annuliOf(brief);
  assert.ok(typeof annuli !== "string");
  const ramey = rameyOf(brief, 5000, 0.4, brief.completion!.packerMdM + 50);
  const at = (hours: number, bled: Record<string, number> = {}, lift: number | null = null) => annulusPressures(annuli, ramey, hours, lift, bled);
  const early = at(1), day = at(24), year = at(24 * 365);
  for (let k = 0; k < annuli.length; k++) {
    assert.ok(early[k]!.psi < day[k]!.psi && day[k]!.psi < year[k]!.psi, `${annuli[k]!.name}: ${early[k]!.psi} → ${day[k]!.psi} → ${year[k]!.psi}`);
    assert.ok(year[k]!.deltaT > 0 && year[k]!.deltaT < ramey.gradientFPerFt * ramey.depthFt, "warmer than the rock, never past the bottom-hole rise");
  }
  // Hotter flow, more pressure.
  const fast = annulusPressures(annuli, rameyOf(brief, 9000, 0.4, brief.completion!.packerMdM + 50), 24, null, {});
  assert.ok(fast[0]!.psi > day[0]!.psi);
  // Bleed B at a day: zero now, building again with more time, by the extra heat alone.
  const bledB = { B: day[1]!.thermal };
  assert.equal(at(24, bledB)[1]!.psi, 0);
  const later = at(24 * 30, bledB)[1]!;
  assert.ok(Math.abs(later.psi - (later.thermal - day[1]!.thermal)) < 1e-9 && later.psi > 0);
  assert.equal(at(24 * 30, bledB)[0]!.psi, at(24 * 30)[0]!.psi, "bleeding B leaves A alone");
  // Gas lifting: A holds the lift gas's pressure whatever the heat.
  assert.equal(at(24 * 365, {}, 1500)[0]!.psi, 1500);
  assert.equal(at(24 * 365, {}, 1500)[0]!.source, "lift gas");
  // A vented annulus (cement below the outer shoe) builds nothing.
  const vented = annulusPressures([{ ...annuli[1]!, trapped: false }], ramey, 24 * 365, null, {});
  assert.equal(vented[0]!.psi, 0);
  assert.equal(vented[0]!.source, "vented");
});
