import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { payOf } from "@ikhmalputra/subsurface-core/petro-clastic";
import { decodeForceLogs } from "../src/data/force-model.ts";
import type { ForceIndex } from "../src/data/force-model.ts";
import { interpretZone, likeliestZone, samplesIn, startingInterpretation, zoneThroughInterpretation, zonesOf } from "../src/data/petro-force-model.ts";
import { zonePetro } from "../src/data/zone-model.ts";

const dir = new URL("../../../packages/fixtures/data/force2020/", import.meta.url);
const index = JSON.parse(readFileSync(new URL("wells.json", dir), "utf8")) as ForceIndex;
const load = (name: string) => { const well = index.wells.find((w) => w.name === name)!; return decodeForceLogs(well, readFileSync(new URL(well.file, dir)).buffer); };

test("FORCE petrophysics: Troll's Sognefjord reads as pay, the Utsira aquifer as water", () => {
  const troll = load("31/2-7"), p = startingInterpretation(troll), zones = zonesOf(troll.well);
  const zone = likeliestZone(troll, zones, p)!;
  assert.match(zone.name, /Sognefjord/);
  const out = payOf(interpretZone(samplesIn(troll, zone.topMdM, zone.baseMdM), p, troll.well.step), p.cutoffs);
  assert.ok(out.pay > 20 && out.swPay < 0.3 && out.phiPay > 0.2, JSON.stringify(out));
  // The Utsira is a regional aquifer (CO₂ is stored in it at Sleipner): sand, but no pay.
  const sleipner = load("15/9-13"), q = startingInterpretation(sleipner), utsira = zonesOf(sleipner.well).find((z) => /Utsira/.test(z.name))!;
  const water = payOf(interpretZone(samplesIn(sleipner, utsira.topMdM, utsira.baseMdM), q, sleipner.well.step), q.cutoffs);
  assert.ok(water.net > 100 && water.pay < 5, JSON.stringify(water));
});

test("The interpretation Volumetrics reads: the same pay as Petrophysics, and it moves when the interpretation does", () => {
  const troll = load("31/2-7"), p = startingInterpretation(troll), zone = likeliestZone(troll, zonesOf(troll.well), p)!;
  const mine = zoneThroughInterpretation(troll, zone.topMdM, zone.baseMdM, p)!;
  const pay = payOf(interpretZone(samplesIn(troll, zone.topMdM, zone.baseMdM), p, troll.well.step), p.cutoffs);
  assert.ok(Math.abs(mine.payM - pay.pay) < 1e-9 && Math.abs(mine.ntg - pay.ntg) < 1e-9, `${mine.payM} vs ${pay.pay}`);
  assert.ok(mine.paySw !== null && Math.abs(mine.paySw - pay.swPay) < 1e-9);
  // A stricter porosity cutoff takes net rock away; a lower Rw lowers the water saturation.
  assert.ok(zoneThroughInterpretation(troll, zone.topMdM, zone.baseMdM, { ...p, cutoffs: { ...p.cutoffs, phi: 0.25 } })!.netM < mine.netM);
  assert.ok(zoneThroughInterpretation(troll, zone.topMdM, zone.baseMdM, { ...p, sat: { ...p.sat, rw: p.sat.rw / 2 } })!.sw < mine.sw);
  // The quick-look reads the same sand as a reservoir too, by its own simpler route.
  const quick = zonePetro(troll, zone.topMdM, zone.baseMdM)!;
  assert.ok(quick.ntg > 0.5 && mine.ntg > 0.5, `${quick.ntg} ${mine.ntg}`);
});
