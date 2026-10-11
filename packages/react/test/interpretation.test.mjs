import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { SeismicSlice } from "../dist/seismic-slice.js";
import { LogCylinder } from "../dist/log-cylinder.js";

test("slice geometry transforms a physical plane into a rotated, nonuniform volume frame", () => {
  const texture = new THREE.Data3DTexture(new Float32Array(8), 2, 2, 2);
  const lut = new THREE.DataTexture(new Uint8Array(8), 2, 1);
  const slice = new SeismicSlice(texture, lut, 1);
  const frame = new THREE.Matrix4().makeBasis(new THREE.Vector3(2, 0, -1), new THREE.Vector3(0.5, 0, 1), new THREE.Vector3(0, -3, 0)).setPosition(1, 0, 2);
  const count = slice.update({ origin: [0, 0, 150], normal: [0, 0, 1] }, frame, new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1));
  assert.equal(count, 4);
  assert.equal(slice.mesh.geometry.index.count, 6);
  const positions = slice.mesh.geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(frame);
    assert.ok(Math.abs(-point.y * 100 - 150) < 1e-5);
  }
  slice.update(null, frame, new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
  assert.equal(slice.mesh.visible, false);
  slice.dispose(); texture.dispose(); lut.dispose();
});

test("log cylinder maps colour and radius on actual MDs, not geometric path fractions", () => {
  const cylinder = new LogCylinder((md) => new THREE.Vector3(md / 100, -md / 100, 0), 100, 1);
  const curve = { version: 1, id: "porosity", wellId: "well", unit: "%", depthsMdM: new Float64Array([0, 50, 100]), values: new Float32Array([0, 1, 0]), nullValue: null };
  const style = { curveId: "porosity", mode: "color-radius", domain: [0, 1], radiusRange: [0.5, 2] };
  const triangles = cylinder.update(curve, style);
  assert.equal(triangles, 512 * 12 * 2);
  const positions = cylinder.mesh.geometry.attributes.position, colours = cylinder.mesh.geometry.attributes.color;
  const top = new THREE.Vector3().fromBufferAttribute(positions, 0), mid = new THREE.Vector3().fromBufferAttribute(positions, 256 * 13);
  assert.ok(Math.abs(top.length() - 0.5) < 1e-6);
  assert.ok(Math.abs(mid.distanceTo(new THREE.Vector3(0.5, -0.5, 0)) - 2) < 1e-6);
  assert.notEqual(colours.getX(0), colours.getX(256 * 13));
  assert.equal(cylinder.update(curve, { ...style, mode: "color" }), triangles);
  assert.ok(Math.abs(new THREE.Vector3().fromBufferAttribute(cylinder.mesh.geometry.attributes.position, 256 * 13).distanceTo(new THREE.Vector3(0.5, -0.5, 0)) - 1) < 1e-6);
  cylinder.update(null, null);
  assert.equal(cylinder.mesh.visible, false);
  cylinder.dispose();
});

test("log gaps stay gaps and switching settings disposes replaced geometry", () => {
  const cylinder = new LogCylinder((md) => new THREE.Vector3(0, -md, 0), 100, 1);
  const curve = { version: 1, id: "log", wellId: "well", unit: "%", depthsMdM: new Float64Array([0, 50, 100]), values: new Float32Array([1, NaN, 1]), nullValue: "nan" };
  const style = { curveId: "log", mode: "radius", domain: [0, 2], radiusRange: [0.5, 1] };
  let disposed = false;
  cylinder.mesh.geometry.addEventListener("dispose", () => { disposed = true; });
  assert.equal(cylinder.update(curve, style), 0);
  assert.equal(cylinder.mesh.visible, false);
  assert.equal(disposed, true);
  assert.throws(() => cylinder.update(curve, { ...style, curveId: "wrong" }), /curveId/);
  cylinder.dispose();
});
