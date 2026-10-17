// An annulus screened the way integrity management does it: its MAASP and the limit that sets it
// (ISO 16530-1), BSEE's MAWOP and diagnose-above pressure, the heat it takes to build pressure in it,
// and a bleed-down judged for sustained casing pressure. Core only: runs in Node as it is.
import { WATER, annulusCompliance, bleedTests, casingPressureLimits, maasp, thermalApb } from "@ikhmalputra/subsurface-core/integrity";

export function main(print: (line: string) => void = console.log) {
  // B annulus: 7 in 29 lb/ft inside 9 5/8 in 47 lb/ft, mud 1.2 SG, cement top at 6,500 ft TVD.
  const b = maasp({
    name: "B", bottomTvdFt: 6500, fluidGradient: 1.2 * 0.433,
    outerBurstPsi: 6870, backupGradient: 0.465,          // 9 5/8 in N80, brine behind it
    innerCollapsePsi: 8530, insideSurfacePsi: 0, insideGradient: 1.03 * 0.433,
    exposedShoe: null,                                   // the outer shoe is cemented over
  });
  print(`MAASP ${b.maaspPsi.toFixed(0)} psi, set by ${b.governing}`);
  for (const limit of b.limits) print(`  ${limit.limit.padEnd(9)} ${limit.psi.toFixed(0).padStart(6)} psi`);

  const bsee = casingPressureLimits({ annulus: "B", miypPsi: 6870, nextOuterMiypPsi: 3450, innerCollapsePsi: 8530 });
  print(`MAWOP ${bsee.mawopPsi.toFixed(0)} psi (${bsee.mawopBy}); diagnose above ${bsee.diagnoseAbovePsi!.toFixed(0)} psi`);

  // Trapped water warming by 1 °F: rigid, then with both strings ballooning.
  const c = annulusCompliance(8.681, 0.472, 7, 0.408);
  print(`APB per °F: ${thermalApb(1, WATER.alphaPerF, WATER.kappaPerPsi, 0).toFixed(0)} psi rigid, ${thermalApb(1, WATER.alphaPerF, WATER.kappaPerPsi, c).toFixed(0)} psi as built`);

  // A day's hourly record: bled at hour 30 through a 1/2 in needle valve, then it builds back.
  const hours = Array.from({ length: 80 }, (_, h) => h);
  const heat = (h: number) => 1500 + 3 * h;              // the thermal build-up the model gives
  const psi = hours.map((h) => h < 30 ? heat(h) : h < 36 ? heat(h) * Math.exp(-(h - 29)) : 40 * (h - 36));
  for (const test of bleedTests(hours, psi, heat)) {
    print(`Bled ${test.fromPsi.toFixed(0)} → ${test.toPsi.toFixed(0)} psi in ${test.hoursToBleed} h; built back ${test.rebuildPsi?.toFixed(0)} psi in 24 h, heat explains ${test.thermalPsi.toFixed(0)}: ${test.sustained ? "sustained casing pressure" : "thermal"}`);
  }
}
