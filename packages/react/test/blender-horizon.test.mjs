import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { loadBlenderHorizon } from "../dist/blender-horizon.js";

const contract = {
  version: 1, id: "horizon", reference: { units: "m", crs: "local: east/north", depthDatum: "surface" },
  source: "blob:local", format: "glb",
  meshToWorld: [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 10, 20, 30, 1],
  attributes: [{ semantic: "_POROSITY", layer: "porosity", shaderInput: "porosity", itemSize: 1, domain: [0, 0.4] }],
};
function fixture() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute("_porosity", new THREE.Float32BufferAttribute([0.1, 0.2, 0.3], 1));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.name = "fault primitive";
  const scene = new THREE.Group();
  scene.add(mesh);
  return { geometry, mesh, scene, gltf: { scene, scenes: [scene], animations: [], cameras: [], asset: { version: "2.0" }, userData: {} } };
}
const options = (gltf) => ({ configureLoader: (loader) => { loader.loadAsync = async () => gltf; } });

test("Blender loader aliases the original attribute, applies explicit axes/origin, and allows shader use", async () => {
  const f = fixture();
  const result = await loadBlenderHorizon(contract, options(f.gltf));
  assert.equal(result, f.gltf);
  assert.equal(f.geometry.getAttribute("porosity"), f.geometry.getAttribute("_porosity"));
  assert.deepEqual(f.scene.matrix.toArray(), contract.meshToWorld);
  assert.deepEqual(new THREE.Vector3(0, 1, 0).applyMatrix4(f.scene.matrix).toArray(), [10, 20, 31]);
});

test("Blender loader validates all primitives before mutating any aliases", async () => {
  const f = fixture(), second = fixture();
  second.geometry.deleteAttribute("_porosity");
  f.scene.add(second.mesh);
  let disposed = 0;
  for (const object of [f.mesh, second.mesh]) object.geometry.addEventListener("dispose", () => disposed++);
  await assert.rejects(loadBlenderHorizon(contract, options(f.gltf)), /missing an aligned _POROSITY/);
  assert.equal(f.geometry.getAttribute("porosity"), undefined);
  assert.equal(disposed, 2);
});

test("Blender attribute mappings and transforms apply consistently to every GLTF scene", async () => {
  const first = fixture(), second = fixture();
  first.gltf.scenes.push(second.scene);
  await loadBlenderHorizon(contract, options(first.gltf));
  for (const f of [first, second]) {
    assert.equal(f.geometry.getAttribute("porosity"), f.geometry.getAttribute("_porosity"));
    assert.deepEqual(f.scene.matrix.toArray(), contract.meshToWorld);
  }
});

test("Blender loader rejects shader collisions, wrong arity and unaligned counts", async () => {
  for (const [mode, pattern] of [["collision", /overwrite/], ["arity", /itemSize/], ["count", /aligned/]]) {
    const f = fixture();
    if (mode === "collision") f.geometry.setAttribute("porosity", new THREE.Float32BufferAttribute([1, 2, 3], 1));
    if (mode === "arity") f.geometry.setAttribute("_porosity", new THREE.Float32BufferAttribute([1, 2, 3, 4, 5, 6], 2));
    if (mode === "count") f.geometry.setAttribute("_porosity", new THREE.Float32BufferAttribute([1, 2], 1));
    await assert.rejects(loadBlenderHorizon(contract, options(f.gltf)), pattern);
  }
});

test("Blender loader propagates fetch/decoder failures and rejects assets without meshes", async () => {
  const failure = new Error("Decoder unavailable");
  await assert.rejects(loadBlenderHorizon(contract, { configureLoader: (loader) => { loader.loadAsync = async () => { throw failure; }; } }), (error) => error === failure);
  const scene = new THREE.Group();
  await assert.rejects(loadBlenderHorizon(contract, options({ scene, scenes: [scene] })), /no mesh primitives/);
});

test("Blender validation failure disposes shared geometry, materials and textures exactly once", async () => {
  const f = fixture(), second = new THREE.Group(), texture = new THREE.Texture();
  f.mesh.material.map = texture;
  f.geometry.deleteAttribute("_porosity");
  second.add(new THREE.Mesh(f.geometry, f.mesh.material));
  f.gltf.scenes.push(second);
  const disposed = [0, 0, 0];
  [f.geometry, f.mesh.material, texture].forEach((resource, index) => resource.addEventListener("dispose", () => disposed[index]++));
  await assert.rejects(loadBlenderHorizon(contract, options(f.gltf)), /missing an aligned/);
  assert.deepEqual(disposed, [1, 1, 1]);
});
