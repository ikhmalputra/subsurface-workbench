import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeForceLogs } from "../src/data/force-model.ts";
import type { ForceIndex, ForceWell } from "../src/data/force-model.ts";
import { rangeOf, zonePetro, zoneWells } from "../src/data/zone-model.ts";

const folder = new URL("../../../packages/fixtures/data/force2020/", import.meta.url);
const index = JSON.parse(readFileSync(new URL("wells.json", folder), "utf8")) as ForceIndex;
const logsOf = (entry: ForceWell) => { const bytes = readFileSync(new URL(entry.file, folder)); return decodeForceLogs(entry, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); };

test("the Brent zone in quadrants 33–34: the wells that meet it, where, and how thick", () => {
  const zone = zoneWells(index.wells.filter((well) => well.area === "force-q33"), "Baat Gp.", "Dunlin Gp.");
  assert.equal(zone.length, 17);
  assert.equal(zone.filter((entry) => entry.base !== null).length, 16);
  for (const entry of zone) {
    assert.ok(entry.x > 400_000 && entry.x < 700_000 && entry.y > 6_500_000 && entry.y < 6_900_000, `${entry.well.name} in ED50 / UTM 31N`);
    if (entry.base !== null) assert.ok(entry.base > entry.top, `${entry.well.name} base below top`);
  }
});

test("the Statfjord discovery well reads as a thick, porous, oil-bearing Brent; the zone's ranges are ordered", () => {
  const zone = zoneWells(index.wells.filter((well) => well.area === "force-q33"), "Baat Gp.", "Dunlin Gp.");
  const discovery = zone.find((entry) => entry.well.name === "33/9-1")!;
  const petro = zonePetro(logsOf(discovery.well), discovery.topMd, discovery.baseMd!)!;
  assert.ok(petro.porosity > 0.25 && petro.ntg > 0.6, `φ ${petro.porosity}, N/G ${petro.ntg}`);
  assert.ok(petro.payM > 100 && petro.paySw! < 0.3, `pay ${petro.payM} m at Sw ${petro.paySw}`);
  const all = zone.flatMap((entry) => entry.baseMd ? [zonePetro(logsOf(entry.well), entry.topMd, entry.baseMd)] : []).filter((p) => p !== null);
  const porosity = rangeOf(all.map((p) => p.porosity))!;
  assert.ok(porosity.low < porosity.mode && porosity.mode < porosity.high);
  assert.equal(rangeOf([0.2, 0.3]), null);
});
