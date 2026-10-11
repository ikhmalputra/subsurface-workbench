import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { validateBlenderGeomHorizon } from "@ikhmalputra/subsurface-core/contracts";
import type { BlenderGeomHorizon } from "@ikhmalputra/subsurface-core/contracts";

/**
 * Opt-in URL/blob loader. A host may configure URL resolution/decoders for .gltf dependencies.
 * Attribute aliases retain the loaded BufferAttribute; assigning a shader/material remains host-owned.
 */
export async function loadBlenderHorizon(input: BlenderGeomHorizon, options: {
  readonly manager?: THREE.LoadingManager;
  readonly configureLoader?: (loader: GLTFLoader) => void;
} = {}): Promise<GLTF> {
  const contract = validateBlenderGeomHorizon(input);
  const loader = new GLTFLoader(options.manager);
  options.configureLoader?.(loader);
  const gltf = await loader.loadAsync(contract.source);
  // Validate all primitives before mutating geometry or scene transforms.
  const mappings: { geometry: THREE.BufferGeometry; name: string; attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute }[] = [];
  const scenes = new Set([gltf.scene, ...gltf.scenes]);
  try {
    let meshes = 0;
    for (const scene of scenes) scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      meshes++;
      for (const mapping of contract.attributes) {
        const attribute = object.geometry.getAttribute(mapping.semantic.toLowerCase());
        if (!attribute || attribute.itemSize !== mapping.itemSize || attribute.count !== object.geometry.getAttribute("position")?.count) {
          throw new TypeError(`${contract.id}: mesh "${object.name}" is missing an aligned ${mapping.semantic} attribute with itemSize ${mapping.itemSize}.`);
        }
        const existing = object.geometry.getAttribute(mapping.shaderInput);
        if (existing && existing !== attribute) throw new TypeError(`${contract.id}: shader input "${mapping.shaderInput}" would overwrite an existing geometry attribute.`);
        mappings.push({ geometry: object.geometry, name: mapping.shaderInput, attribute });
      }
    });
    if (meshes === 0) throw new TypeError(`${contract.id}: the geological asset contains no mesh primitives.`);
    for (const mapping of mappings) mapping.geometry.setAttribute(mapping.name, mapping.attribute);
    for (const scene of scenes) scene.applyMatrix4(new THREE.Matrix4().fromArray(contract.meshToWorld));
    return gltf;
  } catch (error) {
    const textures = new Set<THREE.Texture>();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    for (const scene of scenes) scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    throw error;
  }
}
