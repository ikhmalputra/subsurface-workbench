import assert from "node:assert/strict";
import test from "node:test";
import { briefToWellDesign, exampleWellBrief, forgeDesign, getWellComponents } from "./index.ts";
import { barrierEnvelopes } from "./barriers.ts";

const forge = getWellComponents(forgeDesign);
const kestrel = getWellComponents(briefToWellDesign(exampleWellBrief(), "synthetic"));

test("FORGE completed, no tubing: the 7 in casing and its cement are primary; what the records lack is a gap", () => {
  const result = barrierEnvelopes({ components: forge, phase: "completed", provenance: "documented" });
  assert.deepEqual(result.primary.map((element) => element.kind), ["casing", "cement", "wellhead", "valve"]);
  assert.match(result.primary[0]!.name, /7 in/);
  assert.match(result.primary[1]!.evidence, /ThermaLite/);
  assert.deepEqual(result.secondary.map((element) => element.kind), ["casing", "cement", "wellhead"]);
  assert.match(result.secondary[0]!.name, /9 5\/8/);
  assert.equal(result.secondary[1]!.status, "not reported", "the intermediate string's cement is not in the records");
  assert.deepEqual(result.shared, ["Thread-on wellhead"]);
  assert.ok(result.gaps.some((gap) => /no second valve/.test(gap)));
});

test("FORGE drilling: the mud column is primary; behind it the last shoe, its cement, the wellhead and a tested BOP", () => {
  const result = barrierEnvelopes({ components: forge.filter((component) => component.bottomDepthM <= 1560 || component.kind === "Wellhead"), phase: "drilling", provenance: "documented", holeDepthM: 2000,
    fluid: { mudSg: 1.08, poreSg: 1.04, source: "report of 2020-11-20" }, bopTest: { date: "11/14/20", source: "report of 2020-11-20" } });
  assert.equal(result.primary[0]!.kind, "fluid");
  assert.match(result.primary[0]!.evidence, /\+0\.04 SG/);
  assert.equal(result.secondary.find((element) => element.kind === "casing")!.name, "Intermediate casing / 9 5/8 in");
  assert.equal(result.secondary.find((element) => element.kind === "bop")!.status, "documented");
  assert.ok(result.gaps.some((gap) => /no cement record/.test(gap)));
  const under = barrierEnvelopes({ components: forge, phase: "drilling", provenance: "documented", holeDepthM: 3000, fluid: { mudSg: 1.0, poreSg: 1.05, source: "x" }, bopTest: null });
  assert.ok(under.gaps.some((gap) => /does not exceed/.test(gap)) && under.gaps.some((gap) => /BOP/.test(gap)));
});

test("Kestrel A-7 producing: casing below the packer, packer, tubing and safety valve primary; tree and casing above secondary", () => {
  const result = barrierEnvelopes({ components: kestrel, phase: "producing", provenance: "synthetic", reservoirTopMdM: 2900 });
  assert.deepEqual(result.primary.map((element) => element.kind), ["casing", "cement", "packer", "tubing", "safety-valve"]);
  assert.deepEqual(result.secondary.map((element) => element.kind), ["casing", "cement", "wellhead", "valve"]);
  assert.ok(result.primary.every((element) => element.status === "planned"));
  assert.match(result.primary[1]!.evidence, /above the reservoir top/);
  assert.ok(result.gaps.some((gap) => /gas-lift mandrels/.test(gap)));
});
