import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MapHub } from "../dist/map-hub.js";

const reference = { units: "m", crs: "local: east/north", depthDatum: "RKB" };

function well(id, x, y, referenceOverride = reference) {
  return {
    id,
    label: `Well ${id}`,
    provenance: "documented",
    trajectory: {
      version: 1,
      id,
      reference: referenceOverride,
      xyz: new Float64Array([x, y, 0, x + 10, y + 5, 50, x + 20, y + 8, 100]),
      depthsMdM: new Float64Array([0, 50, 100]),
      inclinationsDeg: new Float32Array([0, 10, 20]),
      azimuthsDeg: new Float32Array([0, 90, 90]),
    },
  };
}

test("map hub renders source well paths and host-projected outlines in the declared frame", () => {
  const html = renderToStaticMarkup(createElement(MapHub, {
    wells: [well("a", 0, 0), well("b", 100, 20)],
    outlines: [{
      id: "survey",
      label: "Survey",
      kind: "seismic",
      reference,
      xy: new Float64Array([-20, -10, 140, -10, 140, 60, -20, 60]),
    }],
    store: undefined,
  }));

  assert.match(html, /data-testid="map-hub"/);
  assert.match(html, /local: east\/north · X\/Y in metres · Z down/);
  assert.match(html, /data-well-id="a"/);
  assert.match(html, /data-outline-id="survey"/);
  assert.match(html, /Seismic footprint/);
});

test("map hub refuses unlike spatial references and invalid outline arrays", () => {
  assert.throws(() => renderToStaticMarkup(createElement(MapHub, {
    wells: [well("a", 0, 0), well("b", 100, 20, { ...reference, crs: "other-frame" })],
  })), /same declared units, CRS, and depth datum/);
  assert.throws(() => renderToStaticMarkup(createElement(MapHub, {
    wells: [well("a", 0, 0)],
    outlines: [{ id: "bad", label: "Bad", kind: "surface", reference, xy: new Float64Array([0, 1, 2, 3]) }],
  })), /at least three flat XY points/);
});
