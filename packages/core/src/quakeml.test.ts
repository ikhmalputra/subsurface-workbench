import assert from "node:assert/strict";
import test from "node:test";
import { readQuakeML, writeQuakeML } from "./quakeml.ts";
import type { QuakeCatalogue } from "./quakeml.ts";
import { formatLas, lasCurve, parseLas } from "./records.ts";

// A document laid out the way ObsPy writes QuakeML 1.2: default namespace on <quakeml>, a
// creationInfo inside the origin, two origins with the second preferred, a comment, an event type.
const OBSPY_STYLE = `<?xml version='1.0' encoding='utf-8'?>
<q:quakeml xmlns:q="http://quakeml.org/xmlns/quakeml/1.2" xmlns="http://quakeml.org/xmlns/bed/1.2">
  <eventParameters publicID="smi:local/catalog/forge-2022">
    <description>Test catalogue</description>
    <event publicID="smi:local/event/7">
      <preferredOriginID>smi:local/origin/7b</preferredOriginID>
      <preferredMagnitudeID>smi:local/magnitude/7</preferredMagnitudeID>
      <type>induced or triggered event</type>
      <comment><text>relocated &amp; reviewed</text></comment>
      <origin publicID="smi:local/origin/7a">
        <time><value>2022-04-17T03:00:00.000000Z</value></time>
        <latitude><value>38.5</value></latitude><longitude><value>-112.9</value></longitude>
        <depth><value>2000</value></depth>
      </origin>
      <origin publicID="smi:local/origin/7b">
        <time><value>2022-04-17T03:12:45.250000Z</value><uncertainty>0.01</uncertainty></time>
        <latitude><value>38.50412</value></latitude>
        <longitude><value>-112.89811</value></longitude>
        <depth><value>2385.5</value><uncertainty>22.0</uncertainty></depth>
        <originUncertainty><horizontalUncertainty>12.5</horizontalUncertainty></originUncertainty>
        <evaluationMode>manual</evaluationMode>
        <creationInfo><agencyID>GES</agencyID></creationInfo>
      </origin>
      <magnitude publicID="smi:local/magnitude/7">
        <mag><value>-0.84</value></mag>
        <type>Mw</type>
      </magnitude>
    </event>
  </eventParameters>
</q:quakeml>`;

test("QuakeML: reads an ObsPy-style document, preferring the preferred origin and keeping uncertainties", () => {
  const c = readQuakeML(OBSPY_STYLE);
  assert.equal(c.publicId, "smi:local/catalog/forge-2022");
  assert.equal(c.description, "Test catalogue");
  assert.equal(c.events.length, 1);
  const e = c.events[0]!;
  assert.equal(e.time, "2022-04-17T03:12:45.250000Z");
  assert.equal(e.latitude, 38.50412); assert.equal(e.longitude, -112.89811);
  assert.equal(e.depthM, 2385.5); assert.equal(e.depthUncertaintyM, 22); assert.equal(e.horizontalUncertaintyM, 12.5); assert.equal(e.timeUncertaintyS, 0.01);
  assert.equal(e.magnitude, -0.84); assert.equal(e.magnitudeType, "Mw");
  assert.equal(e.evaluationMode, "manual"); assert.equal(e.type, "induced or triggered event"); assert.equal(e.comment, "relocated & reviewed");
  assert.throws(() => readQuakeML("<catalogue/>"), /eventParameters/);
});

test("QuakeML: what is written reads back the same", () => {
  const catalogue: QuakeCatalogue = {
    publicId: "smi:subsurface-workbench/synthetic", description: "Synthetic <test> catalogue", creationTime: "2026-10-17T00:00:00Z", agency: "SW",
    events: [
      { id: "smi:subsurface-workbench/synthetic/event/1", time: "2022-04-16T18:00:01.500Z", latitude: 38.504, longitude: -112.898, depthM: 2410.2, magnitude: 0.31, magnitudeType: "Mw", horizontalUncertaintyM: 15, depthUncertaintyM: 25, evaluationMode: "automatic", type: "induced or triggered event", comment: "synthetic" },
      { id: "smi:subsurface-workbench/synthetic/event/2", time: "2022-04-16T18:03:00Z", latitude: 38.5041, longitude: -112.8979, depthM: 2399, magnitude: -1.2, magnitudeType: "Mw" },
    ],
  };
  const back = readQuakeML(writeQuakeML(catalogue));
  assert.deepEqual(back, catalogue);
});

test("LAS 2.0: a time-indexed and a depth-indexed file written here read back, nulls and all", () => {
  const text = formatLas({
    comments: ["Synthetic"],
    well: [{ mnemonic: "WELL", unit: "", value: "Kestrel A-7", description: "Well name" }, { mnemonic: "DATE", unit: "", value: "2026-03-01", description: "Start" }],
    parameters: [{ mnemonic: "AMB", unit: "DEGF", value: "80", description: "Ambient" }],
    curves: [
      { mnemonic: "ETIM", unit: "H", value: "", description: "Elapsed time", values: [0, 1, 2, 3], digits: 2 },
      { mnemonic: "PA_B", unit: "PSI", value: "", description: "B annulus pressure", values: [0, 120.5, null, 300], digits: 1 },
    ],
  });
  const las = parseLas(text);
  assert.equal(las.version, "2.0");
  assert.equal(las.well.STEP?.value, "1"); assert.equal(las.well.WELL?.value, "Kestrel A-7");
  assert.deepEqual(lasCurve(las, "PA_B")!.values, [0, 120.5, null, 300]);
  assert.equal(lasCurve(las, "ETIM")!.unit, "H");
  assert.equal(las.parameters.AMB?.value, "80");
  // Irregular sampling is declared with STEP 0.
  const irregular = parseLas(formatLas({ well: [], curves: [{ mnemonic: "DEPT", unit: "M", value: "", description: "Depth", values: [100, 101, 105] }] }));
  assert.equal(irregular.well.STEP?.value, "0");
  assert.throws(() => formatLas({ well: [], curves: [{ mnemonic: "DEPT", unit: "M", value: "", description: "", values: [1, 2] }, { mnemonic: "X", unit: "", value: "", description: "", values: [1] }] }), /one value/);
});

test("QuakeML: a value that is not a number counts as missing, and its event is skipped rather than drawn at NaN (found by fuzzing)", () => {
  const good = { id: "smi:x/event/1", time: "2022-04-16T18:00:01Z", latitude: 38.5, longitude: -112.9, depthM: 2400, magnitude: 0.3, magnitudeType: "Mw" };
  const xml = writeQuakeML({ publicId: "smi:x", events: [good, { ...good, id: "smi:x/event/2" }] }).replace("<latitude><value>38.5</value>", "<latitude><value>38.5\u{26B3B}</value>");
  const back = readQuakeML(xml);
  assert.equal(back.events.length, 1);
  assert.equal(back.events[0]!.id, "smi:x/event/2");
  assert.ok(back.events.every((e) => Number.isFinite(e.latitude)));
});
