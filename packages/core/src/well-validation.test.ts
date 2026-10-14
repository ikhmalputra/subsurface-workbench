import assert from "node:assert/strict";
import test from "node:test";
import { forgeDesign, forgeOperations, researchDesign, sProfileDesign } from "./index.ts";
import { ContractValidationError } from "./contract-validation.ts";
import { validateWellDesign, validateWellOperations } from "./well-validation.ts";

test("the wells this package ships are valid designs", () => {
  for (const design of [forgeDesign, sProfileDesign, researchDesign]) {
    assert.equal(validateWellDesign(design), design);
  }
  assert.equal(validateWellOperations(forgeOperations), forgeOperations);
});

test("a design that would draw a well wrongly is refused, by path", () => {
  const cases: readonly [unknown, string][] = [
    [{ ...forgeDesign, totalDepthM: -1 }, "design.totalDepthM"],
    [{ ...forgeDesign, totalDepthM: 10 }, "design.totalDepthM"],
    [{ ...forgeDesign, id: "   " }, "design.id"],
    [{ ...forgeDesign, revision: 1.5 }, "design.revision"],
    [{ ...forgeDesign, units: "ft" }, "design.units"],
    [{ ...forgeDesign, provenance: "guessed" }, "design.provenance"],
    [{ ...forgeDesign, casingBottomM: forgeDesign.totalDepthM + 1 }, "design.casingBottomM"],
    [null, "design"],
  ];
  for (const [value, path] of cases) {
    assert.throws(() => validateWellDesign(value), (error: unknown) => {
      assert.ok(error instanceof ContractValidationError, `${path} should raise a ContractValidationError`);
      assert.equal(error.issues[0]?.path, path);
      return true;
    }, `expected ${path} to be refused`);
  }
});

test("survey depths must be ordered and inside the well", () => {
  const survey = forgeDesign.survey ?? [];
  const reversed = [survey[0]!, { ...survey[2]! }, { ...survey[1]! }];
  assert.throws(() => validateWellDesign({ ...forgeDesign, survey: reversed }), /strictly increasing/);
  assert.throws(() => validateWellDesign({ ...forgeDesign, survey: [survey[0]!] }), /at least two stations/);
  assert.throws(() => validateWellDesign({ ...forgeDesign, survey: [survey[0]!, { ...survey[1]!, inclinationDeg: 200 }] }), /inclinationDeg/);
  // An empty survey is a well whose path was never run, which is a fact, not an error.
  assert.doesNotThrow(() => validateWellDesign({ ...forgeDesign, survey: [] }));
});

test("components must nest, and their parents must exist without looping", () => {
  const components = forgeDesign.components ?? [];
  const [first, second] = components as [Record<string, unknown>, Record<string, unknown>];
  assert.throws(() => validateWellDesign({ ...forgeDesign, components: [{ ...first, parentId: "nothing-like-this" }, second] }), /another component/);
  assert.throws(() => validateWellDesign({ ...forgeDesign, components: [{ ...first, parentId: first.id }, second] }), /another component/);
  assert.throws(() => validateWellDesign({ ...forgeDesign, components: [{ ...first, parentId: second.id }, { ...second, parentId: first.id }] }), /cycle/);
  assert.throws(() => validateWellDesign({ ...forgeDesign, components: [first, { ...second, id: first.id }] }), /unique/);
  const sized = components.find((component) => typeof component.outerDiameterMm === "number")!;
  assert.throws(() => validateWellDesign({ ...forgeDesign, components: [{ ...sized, innerDiameterMm: (sized.outerDiameterMm as number) + 1 }] }), /inner diameter/);
});

test("operational records keep real dates and intervals that run downward", () => {
  const runs = forgeOperations.runs;
  const first = runs[0] as Record<string, unknown>;
  assert.throws(() => validateWellOperations({ ...forgeOperations, runs: [{ ...first, topFt: 900, baseFt: 100 }] }), /base depth/);
  const days = forgeOperations.days;
  assert.throws(() => validateWellOperations({ ...forgeOperations, days: [{ ...days[0], date: "2021-02-30" }] }), /YYYY-MM-DD/);
  assert.throws(() => validateWellOperations({ ...forgeOperations, days: [{ ...days[0], category: "pondering" }] }), /category/);
});
