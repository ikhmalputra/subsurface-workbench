import assert from "node:assert/strict";
import test from "node:test";
import { computeMinimumCurvature, surveyPointAtMd } from "@ikhmalputra/subsurface-core";
import { forgePublishedPath, forgeStations } from "@ikhmalputra/subsurface-fixtures";
import { isKnown } from "@ikhmalputra/subsurface-kernel";
import { at, positions, summarize } from "./trajectory.ts";

/** The 422 observed stations of Utah FORGE 16A(78)-32, with the positions the source publishes. */
const source = forgePublishedPath;
const stations = forgeStations;

test("the rewritten minimum curvature is identical to the implementation it carries", () => {
  // The point of carrying the maths rather than rewriting it: the new structure must land on the
  // same numbers, exactly, as the implementation that was checked against the source. Not close —
  // the same. Any difference here is a change to the geometry, whatever it was meant to be.
  const path = positions(stations, { tieIn: source[0] });
  assert.ok(isKnown(path));
  const carried = computeMinimumCurvature(stations, { tieIn: source[0] });
  assert.equal(path.value.length, carried.length);
  path.value.forEach((computed, index) => {
    const before = carried[index]!;
    assert.equal(computed.tvdM, before.tvdM, `station ${index + 1} true vertical depth`);
    assert.equal(computed.northingM, before.northingM, `station ${index + 1} northing`);
    assert.equal(computed.eastingM, before.eastingM, `station ${index + 1} easting`);
  });
});

test("and it agrees with the positions the source publishes", () => {
  // To 1.5 mm over 3,339 m. That gap is the Python importer's arithmetic against this one and
  // predates both implementations; the published depths are quoted in feet to 0.01 ft, which is
  // 3 mm, so this is agreement rather than drift.
  const path = positions(stations, { tieIn: source[0] });
  assert.ok(isKnown(path));
  let worst = 0;
  path.value.forEach((computed, index) => { worst = Math.max(worst, Math.abs(computed.tvdM - source[index]!.tvdM)); });
  assert.ok(worst < 0.002, `true vertical depth differs by ${worst} m from the published survey`);
});

test("a survey that cannot be integrated is refused, and says which station", () => {
  assert.equal(positions([stations[0]!]).state, "absent");
  const reversed = [stations[0]!, stations[2]!, stations[1]!];
  const refused = positions(reversed);
  assert.equal(refused.state, "absent");
  assert.match(refused.state === "absent" ? refused.why : "", /station 3 does not go deeper/);
});

test("a depth past the last station is clamped, never extrapolated", () => {
  const path = positions(stations, { tieIn: source[0] });
  assert.ok(isKnown(path));
  const beyond = at(path.value, 99_999);
  assert.ok(isKnown(beyond));
  assert.equal(beyond.value.mdM, path.value.at(-1)!.mdM, "the survey stops where it stops");
  assert.equal(beyond.state === "derived" ? beyond.from : "", "clamped to the last station");
});

test("an interpolated position says it was interpolated", () => {
  const path = positions(stations, { tieIn: source[0] });
  assert.ok(isKnown(path));
  const mid = at(path.value, 2500);
  assert.ok(isKnown(mid));
  assert.equal(mid.state, "derived");
  assert.match(mid.state === "derived" ? mid.from : "", /interpolated/);
  // Measured depth is not true vertical depth in a deviated well, which is why the kernel keeps
  // them as different kinds. FORGE is at 65° here: 2,500 m along the hole is 2,267 m down, a gap
  // of 234 m. A view that treated one as the other would put the cursor a quarter of a kilometre
  // from where it belongs.
  assert.ok(Math.abs(mid.value.tvdM - 2500) > 200, `expected a large MD/TVD gap, got ${Math.abs(mid.value.tvdM - 2500)}`);
});

test("a summary knows when the well never leaves vertical", () => {
  const vertical = positions([
    { mdM: 0, inclinationDeg: 0, azimuthDeg: 0 },
    { mdM: 1000, inclinationDeg: 0, azimuthDeg: 0 },
  ]);
  assert.ok(isKnown(vertical));
  const summary = summarize(vertical.value);
  assert.ok(isKnown(summary));
  assert.equal(summary.value.kickoffMdM.state, "absent");
  assert.equal(summary.value.closureM, 0);
});

test("between stations the position lies on the minimum-curvature arc, as core computes it", () => {
  const path = positions(stations, { tieIn: source[0] });
  assert.ok(isKnown(path));
  const computed = computeMinimumCurvature(stations, { tieIn: source[0] });
  for (const mdM of [500, 1800.3, 2714.5, 3100]) {
    const mine = at(path.value, mdM), theirs = surveyPointAtMd(computed, mdM);
    assert.ok(isKnown(mine));
    const gap = Math.hypot(mine.value.tvdM - theirs.tvdM, mine.value.northingM - theirs.northingM, mine.value.eastingM - theirs.eastingM);
    assert.ok(gap < 1e-6, `${mdM} m MD differs from core by ${gap} m`);
  }
  // Through vertical the azimuth turns at the bottom of the arc, not halfway round the compass.
  const through = positions([{ mdM: 0, inclinationDeg: 0.5, azimuthDeg: 10 }, { mdM: 30, inclinationDeg: 0.5, azimuthDeg: 190 }]);
  assert.ok(isKnown(through));
  const middle = at(through.value, 15);
  assert.ok(isKnown(middle) && middle.value.inclinationDeg < 1e-6);
});

test("FORGE kicks off where the build starts, not at near-vertical noise", () => {
  const path = positions(stations, { tieIn: source[0] });
  assert.ok(isKnown(path));
  const summary = summarize(path.value);
  assert.ok(isKnown(summary) && isKnown(summary.value.kickoffMdM));
  assert.ok(Math.abs(summary.value.kickoffMdM.value - 1779.12) < 0.05, String(summary.value.kickoffMdM.value));
});
