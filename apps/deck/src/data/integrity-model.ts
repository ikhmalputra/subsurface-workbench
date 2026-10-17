import { casingTable, findPipe, pipeRatings, pressureAt, tubingTable, tvdAtMd } from "@ikhmalputra/subsurface-core/well-design";
import type { WellDesignBrief } from "@ikhmalputra/subsurface-core";
import { WATER, annulusCompliance, flowingTemperature, maasp, thermalApb } from "@ikhmalputra/subsurface-core/integrity";
import type { AnnulusInput, RameyInput } from "@ikhmalputra/subsurface-core/integrity";

/**
 * A designed well's annuli as integrity management reads them: A between the tubing and the
 * production casing down to the packer, B and C between the casings down to the inner string's
 * cement (or open to the formation at the outer string's shoe when the cement sits below it). Each
 * with its MAASP, and its pressure as the well warms up in production: lift gas in A while gas
 * lifting, thermal build-up in the trapped ones, none in one vented to the formation.
 */

const FT = 3.28084, PSI_PER_FT_PER_SG = 0.433;
export interface Annulus {
  readonly name: "A" | "B" | "C";
  readonly innerOdIn: number; readonly innerWallIn: number;
  readonly outerIdIn: number; readonly outerWallIn: number;
  readonly bottomMdM: number; readonly bottomTvdFt: number;
  readonly fluidSg: number;
  /** Trapped: sealed by cement (or the packer) below, so heat builds pressure; vented: open to the formation at a shoe. */
  readonly trapped: boolean;
  readonly input: AnnulusInput;
  readonly maasp: ReturnType<typeof maasp>;
  /** How much the annulus warms against the tubing's rise (heat crosses each string on its way out), assumed. */
  readonly heatShare: number;
}
/** The packer's differential rating where the design does not give one, psi (assumed). */
export const PACKER_RATING_PSI = 7500;

export function annuliOf(brief: WellDesignBrief): Annulus[] | string {
  const c = brief.completion;
  if (!c) return "No completion: the annuli need the tubing and packer from the Well designer's Completion stage.";
  const sections = [...brief.sections].sort((a, b) => b.shoeMdM - a.shoeMdM); // deepest first
  if (sections.length < 2) return "The design needs at least two casing strings for B.";
  const pipe = (od: number, weight: number, table = casingTable) => findPipe(od, weight, table);
  const tubing = pipe(c.tubingOdIn, c.tubingWeightLbFt, tubingTable);
  if (!tubing) return "The tubing is not in the API table.";
  const tvdFt = (md: number) => tvdAtMd(brief, md) * FT;
  const fracPsi = (md: number) => pressureAt(brief, tvdAtMd(brief, md)).fractureGradientSg * PSI_PER_FT_PER_SG * tvdFt(md);
  const ratings = (s: (typeof sections)[number]) => { const p = pipe(s.odIn, s.weightLbFt)!; return { p, r: pipeRatings(s.odIn, p.wallIn, s.grade) }; };
  const tubingRating = pipeRatings(c.tubingOdIn, tubing.wallIn, c.tubingGrade);
  const out: Annulus[] = [];
  // A: tubing inside the production casing, packer fluid to the packer.
  const prod = sections[0]!, inter = sections[1]!, surf = sections[2] ?? null;
  const prodR = ratings(prod), interR = ratings(inter);
  const packerFluid = c.packerFluidSg ?? prod.mudWeightSg;
  const aInput: AnnulusInput = { name: "A", bottomTvdFt: tvdFt(c.packerMdM), fluidGradient: packerFluid * PSI_PER_FT_PER_SG, outerBurstPsi: prodR.r.burstPsi, backupGradient: prod.mudWeightSg * PSI_PER_FT_PER_SG, innerCollapsePsi: tubingRating.collapsePsi, insideSurfacePsi: 0, insideGradient: 0.1, exposedShoe: null, packerRatingPsi: PACKER_RATING_PSI };
  out.push({ name: "A", innerOdIn: c.tubingOdIn, innerWallIn: tubing.wallIn, outerIdIn: prodR.p.idIn, outerWallIn: prodR.p.wallIn, bottomMdM: c.packerMdM, bottomTvdFt: aInput.bottomTvdFt, fluidSg: packerFluid, trapped: true, input: aInput, maasp: maasp(aInput), heatShare: 0.9 });
  // B and C: casing inside casing, the inner string's mud left above its cement.
  const casingAnnulus = (name: "B" | "C", inner: (typeof sections)[number], outer: (typeof sections)[number], outerR: ReturnType<typeof ratings>, innerR: ReturnType<typeof ratings>, backupSg: number, insideSg: number, heatShare: number) => {
    const toc = inner.cement?.topMdM ?? inner.shoeMdM;
    const exposed = toc > outer.shoeMdM;
    const bottomMd = exposed ? outer.shoeMdM : toc;
    const input: AnnulusInput = { name, bottomTvdFt: tvdFt(bottomMd), fluidGradient: inner.mudWeightSg * PSI_PER_FT_PER_SG, outerBurstPsi: outerR.r.burstPsi, backupGradient: backupSg * PSI_PER_FT_PER_SG, innerCollapsePsi: innerR.r.collapsePsi, insideSurfacePsi: 0, insideGradient: insideSg * PSI_PER_FT_PER_SG, exposedShoe: exposed ? { tvdFt: tvdFt(outer.shoeMdM), fracturePsi: fracPsi(outer.shoeMdM) } : null };
    out.push({ name, innerOdIn: inner.odIn, innerWallIn: innerR.p.wallIn, outerIdIn: outerR.p.idIn, outerWallIn: outerR.p.wallIn, bottomMdM: bottomMd, bottomTvdFt: input.bottomTvdFt, fluidSg: inner.mudWeightSg, trapped: !exposed, input, maasp: maasp(input), heatShare });
  };
  casingAnnulus("B", prod, inter, interR, prodR, inter.mudWeightSg, packerFluid, 0.65);
  if (surf) casingAnnulus("C", inter, surf, ratings(surf), interR, 1.03, prod.mudWeightSg, 0.45);
  return out;
}

/** The production's thermal input: the flowing rate and fluid, the rock, and the depth it comes from. */
export function rameyOf(brief: WellDesignBrief, liquidStbD: number, waterCut: number, producingMdM: number): RameyInput {
  const g = brief.geology, toF = (cDeg: number) => cDeg * 9 / 5 + 32;
  const sg = 0.85 * (1 - waterCut) + 1.03 * waterCut, lbmPerBbl = 350 * sg;
  return {
    surfaceF: toF(g.surfaceTemperatureC), gradientFPerFt: g.geothermalGradientCPerKm * 1.8 / 3280.84, depthFt: tvdAtMd(brief, producingMdM) * FT,
    massRateLbmS: liquidStbD * lbmPerBbl / 86400, heatCapacity: 0.5 * (1 - waterCut) + 1 * waterCut,
    earthConductivity: 1.4, earthDiffusivity: 0.04, wellRadiusFt: 0.35,
  };
}

/**
 * Each annulus's pressure after some hours on production: the lift gas's pressure in A while gas
 * lifting; otherwise, for a trapped annulus, the thermal build-up from its average temperature rise
 * over its length (the tubing's rise times its heat share), less what has been bled off. A vented
 * annulus leaks to the formation and builds nothing.
 */
export function annulusPressures(annuli: readonly Annulus[], ramey: RameyInput, hours: number, liftPsig: number | null, bled: Readonly<Record<string, number>>) {
  return annuli.map((a) => {
    const steps = 24;
    let rise = 0;
    for (let k = 0; k <= steps; k++) { const z = a.bottomTvdFt * k / steps; rise += flowingTemperature(ramey, z, hours) - (ramey.surfaceF + ramey.gradientFPerFt * z); }
    const deltaT = a.heatShare * rise / (steps + 1);
    const compliance = annulusCompliance(a.outerIdIn, a.outerWallIn, a.innerOdIn, a.innerWallIn);
    const thermal = a.trapped ? thermalApb(deltaT, WATER.alphaPerF, WATER.kappaPerPsi, compliance) : 0;
    const gas = a.name === "A" && liftPsig !== null;
    const psi = gas ? liftPsig! : Math.max(0, thermal - (bled[a.name] ?? 0));
    return { annulus: a, deltaT, thermal, psi, source: gas ? "lift gas" as const : a.trapped ? "thermal" as const : "vented" as const, ratio: a.maasp.maaspPsi > 0 ? psi / a.maasp.maaspPsi : Infinity };
  });
}
