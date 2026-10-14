import assert from "node:assert/strict";
import test from "node:test";
import { calculateArchieWaterSaturation, summarizePetrophysicsZones } from "./contracts.ts";
import { syntheticReservoirLogs } from "./petrophysics-synthetic.ts";

// A deviated well through a sand with a gas cap, an oil leg and water below.
const stations = Array.from({ length: 61 }, (_, i) => ({ mdM: i * 50, tvdssM: 800 + i * 50 * 0.9 }));
const tvdssToMd = (tvdss: number) => (tvdss - 800) / 0.9;
const input = {
  wellId: "test-well", stations, loggedFromMdM: tvdssToMd(1900), loggedToMdM: tvdssToMd(2420),
  sand: { topMdM: tvdssToMd(2150), baseMdM: tvdssToMd(2360), name: "Sand R1" },
  contacts: { gocTvdssM: 2235, owcTvdssM: 2310 }, seed: 75,
};
const logs = syntheticReservoirLogs(input);
const curve = (mnemonic: string) => logs.well.curves.find((entry) => entry.mnemonic === mnemonic)!;
const mean = (mnemonic: string, top: number, base: number, where: (i: number) => boolean = () => true) => {
  const c = curve(mnemonic); let sum = 0, n = 0;
  for (let i = 0; i < c.depthsMdM.length; i++) if (c.depthsMdM[i]! >= top && c.depthsMdM[i]! < base && where(i)) { sum += c.values[i]!; n++; }
  return sum / n;
};
const clean = (i: number) => logs.truth.vsh[i]! < 0.25;

test("the same seed gives the same well, and every curve is labelled, unit-tagged and complete", () => {
  const again = syntheticReservoirLogs(input);
  assert.deepEqual(Array.from(again.well.curves[0]!.values.slice(0, 50)), Array.from(logs.well.curves[0]!.values.slice(0, 50)));
  assert.equal(logs.well.provenance, "synthetic");
  assert.deepEqual(logs.well.curves.map((c) => `${c.mnemonic}:${c.unit}`), ["GR:gAPI", "CALI:in", "RHOB:g/cm3", "DRHO:g/cm3", "NPHI:v/v", "DT:us/ft", "RT:ohm.m"]);
  for (const c of logs.well.curves) assert.ok(Array.from(c.values).every(Number.isFinite), c.mnemonic);
  assert.equal(logs.las.curves[0]!.mnemonic, "DEPT");
  assert.equal(logs.las.well.SRVC!.value, "synthetic");
});

test("the sand reads clean and porous against the shale above it", () => {
  assert.ok(mean("GR", input.sand.topMdM, input.sand.baseMdM, clean) < 50);
  assert.ok(mean("GR", input.loggedFromMdM, input.sand.topMdM - 5) > 95);
  assert.ok(mean("RHOB", input.sand.topMdM, input.sand.baseMdM, clean) < mean("RHOB", input.loggedFromMdM, input.sand.topMdM - 5));
});

test("contacts sit where the field says, and the fluids read as fluids do", () => {
  assert.ok(Math.abs(logs.contactsMdM.goc! - tvdssToMd(2235)) < 0.5);
  assert.ok(Math.abs(logs.contactsMdM.owc! - tvdssToMd(2310)) < 0.5);
  const gas = (i: number) => clean(i) && logs.truth.fluid[i] === "gas";
  const oil = (i: number) => clean(i) && logs.truth.fluid[i] === "oil" && tvdssToMd(2305) > logs.truth.mdM[i]!;
  const water = (i: number) => clean(i) && logs.truth.fluid[i] === "water";
  // Gas: neutron reads below density porosity (the crossover); water: it does not.
  const dPhi = (i: number) => (2.65 - curve("RHOB").values[i]!) / (2.65 - 1.05);
  const crossover = (where: (i: number) => boolean) => { let sum = 0, n = 0; for (let i = 0; i < logs.truth.mdM.length; i++) if (where(i)) { sum += dPhi(i) - curve("NPHI").values[i]!; n++; } return sum / n; };
  assert.ok(crossover(gas) > 0.06, `gas crossover ${crossover(gas)}`);
  assert.ok(crossover(water) < 0.06, `water crossover ${crossover(water)}`);
  assert.ok(mean("RT", input.sand.topMdM, input.sand.baseMdM, oil) > 10 * mean("RT", input.sand.topMdM, input.sand.baseMdM, water));
});

test("Archie on the logs gives back the model's saturations, within what the tools allow", () => {
  const phiCurve = { ...curve("RHOB"), id: "phid", mnemonic: "PHID", unit: "v/v", values: Float64Array.from(curve("RHOB").values, (rho) => (2.65 - rho) / (2.65 - 1.0)) };
  const archie = calculateArchieWaterSaturation(phiCurve, curve("RT"), { a: 1, m: 2, n: 2, rwAtFormationTemperatureOhmM: logs.archie.rwOhmM });
  let waterSum = 0, waterN = 0, oilSum = 0, oilN = 0;
  archie.points.forEach((point, i) => {
    if (point.value === null || !clean(i)) return;
    if (logs.truth.fluid[i] === "water") { waterSum += point.value; waterN++; }
    if (logs.truth.fluid[i] === "oil" && logs.truth.sw[i]! < 0.4) { oilSum += point.value; oilN++; }
  });
  assert.ok(waterN > 10 && oilN > 10);
  assert.ok(Math.abs(waterSum / waterN - 1) < 0.25, `water leg Sw ${waterSum / waterN}`);
  assert.ok(oilSum / oilN < 0.45, `oil leg Sw ${oilSum / oilN}`);
});

test("washouts spoil the density and DRHO flags them; the zones and core plugs describe the sand", () => {
  const cali = curve("CALI"), drho = curve("DRHO");
  const washed = Array.from(cali.values).map((value, i) => value > 10 ? i : -1).filter((i) => i >= 0);
  assert.ok(washed.length > 0, "some shale is washed out");
  assert.ok(washed.every((i) => drho.values[i]! > 0.05), "DRHO flags every washout");
  assert.deepEqual(logs.well.zones.map((zone) => zone.id), ["upper-shale", "sand", "lower-shale"]);
  assert.deepEqual(logs.well.tops.map((top) => top.id), ["reservoir-top", "goc", "owc", "reservoir-base"]);
  assert.ok(logs.well.corePoints.length >= 3);
  const [summary] = summarizePetrophysicsZones([logs.well.zones[1]!], curve("GR"), { curveId: curve("GR").id, cutoff: 60, side: "below", maxSampleGapM: 1 });
  assert.ok(summary!.netToGross! > 0.6 && summary!.netToGross! < 1, `net to gross ${summary!.netToGross}`);
  assert.throws(() => syntheticReservoirLogs({ ...input, loggedToMdM: input.loggedFromMdM }), /logged interval/);
});
