import assert from "node:assert/strict";
import test from "node:test";
import { validateAssembly } from "./assembly.ts";
import {
  analyzeSection,
  designCoverage,
  kickToleranceVolume,
  regradeFailingStrings,
  sourMinimumTemperatureC,
  sourServiceConditions,
  yieldDerating,
  casingTable,
  designReadiness,
  designToAssembly,
  emptyWellBrief,
  exampleWellBrief,
  findPipe,
  formatOd,
  hydrostaticPsi,
  maximumSurfacePressure,
  pipeRatings,
  pressureAt,
  proposeCasingScheme,
  tvdAtMd,
  validateDesign,
} from "./well-design.ts";
import type { WellDesignBrief } from "./well-design.ts";

const within = (actual: number, expected: number, tolerance = 0.005) => assert.ok(Math.abs(actual - expected) <= expected * tolerance, `${actual} is not within ${tolerance * 100}% of ${expected}`);

test("API 5C3 ratings match published casing tables", () => {
  // [OD, wall, grade, burst psi, collapse psi, body yield klbf] from API TR 5C3 / API 5CT tables.
  const published: [number, number, string, number, number, number][] = [
    [9.625, 0.472, "N80", 6870, 4750, 1086],
    [7, 0.408, "P110", 11220, 8530, 929],
    [13.375, 0.48, "K55", 3450, 1950, 1069],
    [7, 0.362, "N80", 7240, 5410, 604],
    [5.5, 0.304, "N80", 7740, 6290, 397],
    [20, 0.438, "K55", 2110, 520, 1480],
    [9.625, 0.545, "P110", 10900, 7930, 1710],
  ];
  for (const [od, wall, grade, burst, collapse, body] of published) {
    const rating = pipeRatings(od, wall, grade);
    within(rating.burstPsi, burst);
    within(rating.collapsePsi, collapse);
    within(rating.bodyYieldLbf / 1000, body);
  }
  assert.equal(pipeRatings(20, 0.438, "K55").collapseRegime, "elastic");
  assert.equal(pipeRatings(9.625, 0.472, "N80").collapseRegime, "plastic");
  assert.throws(() => pipeRatings(7, 0.4, "X99"), /grade/);
});

test("casing table rows carry drift and coupling OD", () => {
  const row = findPipe(9.625, 47)!;
  assert.equal(row.idIn, 8.681);
  // API 5CT: 9-5/8 to 13-3/8 in drift at ID − 5/32 in (8.681 − 0.15625); smaller sizes at ID − 1/8 in.
  assert.equal(row.driftIn, 8.525);
  assert.equal(findPipe(7, 26)!.driftIn, 6.151);
  assert.equal(findPipe(13.375, 72)!.driftIn, 12.191);
  assert.equal(row.couplingOdIn, 10.625);
  assert.ok(casingTable.every((value) => value.idIn < value.odIn && value.driftIn < value.idIn));
  assert.equal(formatOd(13.375), '13-3/8"');
  assert.equal(formatOd(9.625), '9-5/8"');
  assert.equal(formatOd(7), '7"');
});

test("hydrostatics, pressure interpolation and TVD conversion", () => {
  within(hydrostaticPsi(1, 1000), 1422.33, 1e-4);
  const brief = exampleWellBrief();
  const midway = pressureAt(brief, (1850 + 2200) / 2);
  within(midway.porePressureSg, (1.18 + 1.48) / 2, 1e-6);
  assert.equal(pressureAt(brief, 10).porePressureSg, 1.03);
  assert.equal(pressureAt(brief, 5000).porePressureSg, 1.58);
  assert.equal(tvdAtMd(brief, 600), 600);
  assert.ok(tvdAtMd(brief, 3100) < 3100);
  assert.equal(tvdAtMd({ trajectory: null }, 1234), 1234);
});

test("casing seats keep every hole inside its mud window", () => {
  const brief = exampleWellBrief();
  const scheme = brief.sections;
  assert.deepEqual(scheme.map((section) => section.role), ["conductor", "surface", "intermediate", "intermediate", "production"]);
  for (let index = 1; index < scheme.length; index++) {
    assert.ok(scheme[index]!.shoeMdM > scheme[index - 1]!.shoeMdM);
    assert.ok(scheme[index]!.odIn < scheme[index - 1]!.odIn);
    const analysis = analyzeSection(brief, index);
    assert.ok(analysis.passes, `${scheme[index]!.label} fails its design factors`);
    assert.ok(analysis.mudWindow.mudSg >= analysis.mudWindow.minimumSg && analysis.mudWindow.mudSg <= analysis.mudWindow.maximumSg);
    if (analysis.kickTolerance) assert.ok(analysis.kickTolerance.volumeM3 >= analysis.kickTolerance.requiredM3, `${scheme[index]!.label} kick tolerance`);
  }
  assert.equal(scheme.at(-1)!.shoeMdM, brief.totalDepthMdM);
  assert.deepEqual(validateDesign(brief).filter((issue) => issue.severity === "error"), []);
  // A steeper pressure ramp needs more strings.
  const hot = proposeCasingScheme({ ...brief, geology: { ...brief.geology, pressures: [{ tvdM: 100, porePressureSg: 1.03, fractureGradientSg: 1.3 }, { tvdM: 1000, porePressureSg: 1.1, fractureGradientSg: 1.6 }, { tvdM: 1600, porePressureSg: 1.45, fractureGradientSg: 1.75 }, { tvdM: 2400, porePressureSg: 1.75, fractureGradientSg: 1.95 }, { tvdM: 3000, porePressureSg: 1.85, fractureGradientSg: 2.05 }] } });
  assert.ok(hot.length > scheme.length);
});

test("design checks flag underbalance, failing pipe, cement losses and completion errors", () => {
  const brief = exampleWellBrief();
  const production = brief.sections.length - 1;
  const weak: WellDesignBrief = { ...brief, sections: brief.sections.map((section, index) => (index === production ? { ...section, mudWeightSg: 1.3, weightLbFt: 23, grade: "K55", cement: { ...section.cement!, leadDensitySg: 1.9, tailDensitySg: 2.1, topMdM: 0 } } : section)) };
  const codes = new Set(validateDesign(weak).map((issue) => issue.code));
  for (const code of ["underbalanced", "burst", "cement-losses"]) assert.ok(codes.has(code), `missing ${code}`);
  const badCompletion: WellDesignBrief = { ...brief, completion: { ...brief.completion!, packerMdM: 3200, perforations: [{ topMdM: 2600, bottomMdM: 3150 }] } };
  const completionCodes = new Set(validateDesign(badCompletion).map((issue) => issue.code));
  for (const code of ["packer-depth", "perforations-above-packer", "perforations-open-hole"]) assert.ok(completionCodes.has(code), `missing ${code}`);
});

test("cement volumes follow annular geometry", () => {
  const brief = exampleWellBrief();
  const index = brief.sections.findIndex((section) => section.role === "intermediate");
  const section = brief.sections[index]!;
  const previous = brief.sections[index - 1]!;
  const analysis = analyzeSection(brief, index);
  const openHole = Math.PI / 4 * (section.holeSizeIn ** 2 - section.odIn ** 2) * (section.shoeMdM - previous.shoeMdM) * 0.00064516 * (1 + section.cement!.excessPct / 100);
  within(analysis.cement!.openHoleM3, openHole, 0.01);
  assert.ok(analysis.cement!.casedOverlapM3 > 0);
  within(analysis.cement!.totalM3, analysis.cement!.leadM3 + analysis.cement!.tailM3, 0.01);
  assert.ok(analysis.cement!.equivalentSgAtShoe <= analysis.cement!.fractureSgAtShoe);
});

test("MASP selects an API 6A pressure class", () => {
  const masp = maximumSurfacePressure(exampleWellBrief());
  within(masp.maspPsi, masp.reservoirPsi - 0.23 * 1.42233 * masp.reservoirTvdM, 0.002);
  assert.equal(masp.wellheadRatingPsi, 10000);
});

test("readiness lists missing data per stage", () => {
  const complete = designReadiness(exampleWellBrief());
  assert.equal(complete.percentComplete, 100);
  assert.ok(complete.ready);
  const empty: WellDesignBrief = { ...exampleWellBrief(), identity: { name: "", field: "", operator: "", country: "", purpose: "development" }, geology: { formations: [], pressures: [], surfaceTemperatureC: 25, geothermalGradientCPerKm: 0 }, sections: [], completion: null };
  const readiness = designReadiness(empty);
  assert.ok(!readiness.ready);
  const missing = new Set(readiness.requirements.filter((value) => value.status === "missing").map((value) => value.id));
  for (const id of ["name", "formations", "pressures", "scheme", "tubing"]) assert.ok(missing.has(id), `missing ${id}`);
  assert.ok(readiness.requirements.every((value) => value.why.length > 10));
});

test("design converts into a valid drag-and-drop assembly", () => {
  const brief = exampleWellBrief();
  const assembly = designToAssembly(brief);
  assert.deepEqual(validateAssembly(assembly).filter((issue) => issue.severity === "error"), []);
  const ids = assembly.items.map((item) => item.catalogId);
  for (const id of ["wellhead", "tubing-head", "christmas-tree", "packer", "safety-valve", "perforations", "float-shoe"]) assert.ok(ids.includes(id), `missing ${id}`);
  const production = assembly.items.find((item) => item.catalogId === "production-casing")!;
  assert.equal(production.odIn, 7);
  assert.match(production.label, /7" \d\d# [A-Z]\d+ production casing/);
  const productionCement = assembly.items.find((item) => item.catalogId === "cement" && item.hostId === production.id)!;
  assert.equal(productionCement.topM, brief.sections.at(-1)!.cement!.topMdM);
  assert.ok(designToAssembly({ ...brief, completion: null }).items.some((item) => item.catalogId === "bop-stack"));
});

test("an empty brief is not ready and does not throw", () => {
  const readiness = designReadiness(emptyWellBrief());
  assert.ok(!readiness.ready);
  assert.ok(readiness.percentComplete < 40);
  assert.deepEqual(validateDesign(emptyWellBrief()).filter((issue) => issue.severity === "error"), []);
});

test("yield derates with temperature and collapse reduces under tension (API TR 5C3)", () => {
  assert.equal(yieldDerating(20), 1);
  within(yieldDerating(120), 1 - 0.00054 * 100, 1e-9);
  const cold = pipeRatings(9.625, 0.472, "L80");
  const hot = pipeRatings(9.625, 0.472, "L80", 80000 * yieldDerating(150));
  assert.ok(hot.burstPsi < cold.burstPsi && hot.collapsePsi <= cold.collapsePsi);
  const brief = exampleWellBrief();
  for (const [index] of brief.sections.entries()) {
    const analysis = analyzeSection(brief, index);
    assert.ok(analysis.effective!.collapsePsi <= analysis.ratings!.collapsePsi, "biaxial collapse cannot exceed the uniaxial rating");
    assert.ok(analysis.effective!.burstPsi <= analysis.ratings!.burstPsi);
  }
});

test("kick tolerance follows the IADC two-condition method", () => {
  // Shoe 1500 m TVD at 1.70 SG fracture, next hole to 2500 m TVD in 1.30 SG mud, 0.06 SG kick.
  const result = kickToleranceVolume({ shoeTvdM: 1500, fractureSg: 1.7, nextMudSg: 1.3, kickIntensitySg: 0.06, nextTdTvdM: 2500, holeSizeIn: 8.5 });
  const height = (1500 * 0.4 - 0.06 * 2500) / (1.3 - 0.23);
  within(result.heightM, height, 1e-9);
  const cap = (od: number) => Math.PI / 4 * (8.5 ** 2 - od ** 2) * 0.00064516;
  const atBottom = 150 * cap(6.5) + (height - 150) * cap(5);
  const atShoe = height * cap(5) * (1.7 * 1500) / (1.36 * 2500);
  within(result.volumeM3, Math.min(atBottom, atShoe), 1e-9);
  assert.equal(kickToleranceVolume({ shoeTvdM: 500, fractureSg: 1.2, nextMudSg: 1.18, kickIntensitySg: 0.1, nextTdTvdM: 2000, holeSizeIn: 12.25 }).volumeM3, 0);
  // A shallow shoe under a deep, heavy next section is flagged.
  const brief = exampleWellBrief();
  const shallow: WellDesignBrief = { ...brief, sections: brief.sections.map((section) => (section.role === "surface" ? { ...section, shoeMdM: 250 } : section)) };
  assert.ok(validateDesign(shallow).some((issue) => issue.code === "kick-tolerance"));
});

test("sour service restricts grades and readiness is honest about assumptions", () => {
  const brief = exampleWellBrief();
  assert.equal(sourServiceConditions(brief).sour, false);
  const sour: WellDesignBrief = { ...brief, fluids: { type: "gas", h2sMolPct: 2, co2MolPct: 5 }, sections: brief.sections.map((section) => (section.role === "production" ? { ...section, grade: "P110" } : section)), completion: { ...brief.completion!, tubingGrade: "N80" } };
  const conditions = sourServiceConditions(sour);
  assert.ok(conditions.sour && conditions.h2sPartialKPa! > 0.3);
  const codes = new Set(validateDesign(sour).map((issue) => issue.code));
  for (const code of ["sour-grade", "sour-tubing", "co2-corrosion"]) assert.ok(codes.has(code), `missing ${code}`);
  const regraded = regradeFailingStrings(sour);
  const production = regraded.brief.sections.find((section) => section.role === "production")!;
  assert.ok(sourMinimumTemperatureC[production.grade]! < 0, `${production.grade} should be sour-capable at any temperature`);
  assert.ok(regraded.changes.some((change) => change.sectionId === production.id));
  // Unknown H2S and assumed temperatures do not count as complete data.
  const unknown = designReadiness({ ...brief, fluids: null, geology: { ...brief.geology, temperatureSource: "assumed" } });
  const status = new Map(unknown.requirements.map((value) => [value.id, value.status]));
  assert.equal(status.get("fluids"), "missing");
  assert.equal(status.get("temperature"), "attention");
  const uncalibrated = designReadiness({ ...brief, geology: { ...brief.geology, pressures: brief.geology.pressures.map(({ tvdM, porePressureSg, fractureGradientSg }) => ({ tvdM, porePressureSg, fractureGradientSg, poreSource: "estimated" as const, fractureSource: "estimated" as const })) } });
  assert.equal(uncalibrated.requirements.find((value) => value.id === "pressures")!.status, "attention");
  const coverage = designCoverage(brief);
  assert.ok(coverage.checked.length >= 6 && coverage.notChecked.some((value) => /triaxial/i.test(value)));
});

test("a liner's collapse load is the full mud column outside an evacuated string, not the column below its top", () => {
  const brief = exampleWellBrief();
  const index = brief.sections.findIndex((section) => section.odIn === 7);
  assert.ok(index >= 0, "the example has a 7 in string");
  const liner = { ...brief, sections: brief.sections.map((section, at) => at === index ? { ...section, role: "liner" as const, topMdM: section.shoeMdM - 800 } : section) };
  const section = liner.sections[index]!;
  const analysis = analyzeSection(liner, index);
  const expected = hydrostaticPsi(section.mudWeightSg, tvdAtMd(liner, section.shoeMdM));
  assert.ok(Math.abs(analysis.loads.collapsePsi - expected) < 1, `${analysis.loads.collapsePsi} vs ${expected}`);
  // Hung from surface or as a liner, the same string at the same shoe carries the same collapse load.
  assert.ok(Math.abs(analysis.loads.collapsePsi - analyzeSection(brief, index).loads.collapsePsi) < 1);
});

test("a production string's burst is a tubing leak on the packer fluid, growing with depth down to the packer", () => {
  const brief = exampleWellBrief();
  const index = brief.sections.findIndex((section) => section.role === "production");
  assert.ok(index >= 0 && brief.completion);
  const masp = maximumSurfacePressure(brief).maspPsi;
  const withBrine = { ...brief, completion: { ...brief.completion!, packerFluidSg: 1.2 } };
  const analysis = analyzeSection(withBrine, index);
  const packerTvd = tvdAtMd(withBrine, Math.min(withBrine.completion!.packerMdM, withBrine.sections[index]!.shoeMdM));
  // Hand calculation: SITP + (packer fluid − seawater backup) × depth at the packer.
  const expected = masp + hydrostaticPsi(1.2 - 1.03, packerTvd);
  assert.ok(Math.abs(analysis.loads.burstPsi - expected) < 3, `${analysis.loads.burstPsi} vs ${Math.round(expected)}`);
  assert.ok(analysis.loads.burstPsi > masp, "with brine heavier than the backup the load exceeds the surface pressure");
  assert.match(analysis.loads.burstCase, /Tubing leak: .* on 1\.20 SG packer fluid/);
  const unset = { ...brief, completion: { ...brief.completion!, packerFluidSg: undefined } };
  assert.match(analyzeSection(unset, index).loads.burstCase, /packer fluid not set: mud weight assumed/);
});
