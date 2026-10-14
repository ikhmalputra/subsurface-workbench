import assert from "node:assert/strict";
import test from "node:test";
import { absent, isKnown, reported } from "@ikhmalputra/subsurface-kernel";
import { annularVelocity, bitHydraulics, totalFlowArea } from "./hydraulics.ts";

const source = { document: "daily report" };

test("bit hydraulics computes the API RP 13D correlations", () => {
  const result = bitHydraulics({
    flowGpm: reported(600, source),
    mudPpg: reported(10, source),
    nozzles32nds: reported([12, 12, 12], source),
  });
  assert.ok(isKnown(result.totalFlowAreaIn2));
  assert.ok(Math.abs(result.totalFlowAreaIn2.value - 0.3313) < 1e-3);
  assert.ok(isKnown(result.nozzleVelocityFtPerSec) && result.nozzleVelocityFtPerSec.value > 500);
  assert.ok(isKnown(result.pressureDropPsi) && result.pressureDropPsi.value > 0);
  // Every result names the formula it came from, so a reader can check it without the source.
  assert.equal(result.pressureDropPsi.state === "derived" ? result.pressureDropPsi.from : "", "MW · Q² / (10858 · TFA²)");
});

test("a missing input makes the result absent, not zero, and says what is missing", () => {
  const result = bitHydraulics({
    flowGpm: reported(600, source),
    mudPpg: absent("no mud weight recorded for this run"),
    nozzles32nds: reported([12, 12, 12], source),
  });
  // Velocity needs no mud weight, so it still computes; pressure drop does, so it does not.
  assert.ok(isKnown(result.nozzleVelocityFtPerSec));
  assert.equal(result.pressureDropPsi.state, "absent");
  assert.equal(result.pressureDropPsi.state === "absent" ? result.pressureDropPsi.why : "", "no mud weight recorded for this run");
  // And anything downstream of it inherits the absence rather than inventing a zero.
  assert.equal(result.hydraulicHorsepower.state, "absent");
});

test("a bit with no nozzles listed has no flow area", () => {
  assert.equal(totalFlowArea(reported([], source)).state, "absent");
  assert.equal(totalFlowArea(absent("bit record not attached")).state, "absent");
});

test("annular velocity refuses geometry that cannot exist", () => {
  const impossible = annularVelocity({ flowGpm: reported(600, source), holeIn: reported(5, source), pipeIn: reported(8.5, source) });
  assert.equal(impossible.state, "absent");
  assert.match(impossible.state === "absent" ? impossible.why : "", /not smaller than the hole/);
  const real = annularVelocity({ flowGpm: reported(600, source), holeIn: reported(8.5, source), pipeIn: reported(5, source) });
  assert.ok(isKnown(real) && real.value > 0);
});
