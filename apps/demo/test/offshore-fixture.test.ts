import assert from "node:assert/strict";
import test from "node:test";
import { makeOffshoreFixture } from "../src/lib/offshore-fixture.ts";

test("offshore field supplies four distinct projected near-equatorial wells with explicit seabed datum", () => {
  const { model, waterDepthsM, origin } = makeOffshoreFixture();
  assert.equal(model.wells.length, 4);
  assert.equal(new Set(model.wells.map(({ well }) => well.id)).size, 4);
  for (const { well, stations } of model.wells) {
    assert.equal(well.crs, "EPSG:32650");
    assert.equal(well.provenance, "synthetic");
    assert.equal(well.depthDatum, "synthetic seabed wellhead");
    assert.equal(stations[0]!.mdM, 0);
    assert.equal(stations[0]!.xyz[2], 0);
    assert.ok(Math.abs(stations[0]!.geographic[1]) < 1);
    assert.ok(waterDepthsM[well.id]! > 0);
    assert.ok(stations.at(-1)!.xyz[2] > 2000);
    assert.ok(Math.abs(stations[0]!.xyz[0] - origin[0]) < 3000);
  }
  assert.deepEqual(makeOffshoreFixture().model.wells[2]!.stations, model.wells[2]!.stations);
});
