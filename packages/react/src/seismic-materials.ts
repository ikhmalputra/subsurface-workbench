import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type { Node, UniformNode } from "three/webgpu";
import { Break, Fn, If, Loop, abs, clamp, float, int, length, max, min, positionLocal, smoothstep, texture, texture3D, vec2, vec3, vec4 } from "three/tsl";

/**
 * The seismic volume's shaders, written once in TSL — three.js's node shading language — so the
 * same code runs on WebGPU and on its WebGL 2 fallback. They replace three GLSL ShaderMaterials:
 * the solid block whose faces show the data, the see-through volume render, and the arbitrary slice.
 *
 * The volume texture holds each signed count + 128 as an unsigned byte; `amplitudeOf` turns a sample
 * back into −1…1 of full scale (count / 127).
 *
 * Every sample is taken at an explicit mip level: the volume render samples inside a loop that
 * breaks early, which WGSL allows only for level-addressed sampling.
 */

export interface VolumeUniforms {
  readonly gain: UniformNode<"float", number>;
  /** The crop box in texture space (0–1 per axis). */
  readonly cropMin: UniformNode<"vec3", THREE.Vector3>;
  readonly cropMax: UniformNode<"vec3", THREE.Vector3>;
  readonly cropSize: UniformNode<"vec3", THREE.Vector3>;
  /** The camera in texture space; the volume render marches from it. */
  readonly eye: UniformNode<"vec3", THREE.Vector3>;
  /** Fraction of full colour below which the volume render is transparent. */
  readonly threshold: UniformNode<"float", number>;
}

/** A sample of the offset-byte volume (0–1) back to its signed count over 127. */
function amplitudeOf(sample: Node<"float">) {
  return sample.mul(255).sub(128).div(127);
}

/** Colour of an amplitude in −1…1 from the 256-entry look-up table. */
function lutColour(lut: THREE.Texture, amplitude: Node<"float">) {
  return texture(lut, vec2(clamp(amplitude, -1, 1).mul(0.5).add(0.5), 0.5)).level(float(0)).rgb;
}

/** The volume texture coordinate of this fragment on the unit box, offset into the crop. */
function cropCoordinate(uniforms: VolumeUniforms) {
  return uniforms.cropMin.add(positionLocal.mul(uniforms.cropSize));
}

/** An opaque block: each face shows the data at the crop, so cropping exposes inline, crossline and depth cuts. */
export function volumeSolidMaterial(volume: THREE.Data3DTexture, lut: THREE.Texture, uniforms: VolumeUniforms) {
  const material = new MeshBasicNodeMaterial({ side: THREE.DoubleSide, toneMapped: false });
  material.colorNode = lutColour(lut, amplitudeOf(texture3D(volume, cropCoordinate(uniforms)).level(float(0)).r).mul(uniforms.gain));
  return material;
}

/**
 * A see-through volume render: front-to-back compositing from where the eye ray enters the crop box
 * to this back face, one step per voxel crossed; weak amplitudes are transparent, strong ones opaque.
 */
export function volumeRenderMaterial(volume: THREE.Data3DTexture, lut: THREE.Texture, uniforms: VolumeUniforms, dims: THREE.Vector3) {
  const material = new MeshBasicNodeMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, premultipliedAlpha: true, toneMapped: false });
  const voxels = vec3(dims.x, dims.y, dims.z);
  material.fragmentNode = Fn(() => {
    const end = cropCoordinate(uniforms);
    const direction = end.sub(uniforms.eye);
    const inverse = vec3(1).div(direction);
    const near = min(uniforms.cropMin.sub(uniforms.eye).mul(inverse), uniforms.cropMax.sub(uniforms.eye).mul(inverse));
    const entry = clamp(max(max(near.x, near.y), near.z), 0, 1);
    const start = uniforms.eye.add(direction.mul(entry)).toVar();
    const span = end.sub(start).toVar();
    const steps = int(clamp(length(span.mul(voxels)), 1, 720)).toVar();
    const sum = vec4(0).toVar();
    Loop({ start: int(0), end: int(720), type: "int", condition: "<" }, ({ i }) => {
      If(i.greaterThanEqual(steps).or(sum.a.greaterThan(0.97)), () => { Break(); });
      const at = start.add(span.mul(float(i).add(0.5).div(float(steps))));
      const amplitude = amplitudeOf(texture3D(volume, at).level(float(0)).r).mul(uniforms.gain);
      const alpha = smoothstep(uniforms.threshold, 1, abs(amplitude)).mul(0.35);
      const weight = float(1).sub(sum.a).mul(alpha);
      sum.assign(vec4(sum.rgb.add(lutColour(lut, amplitude).mul(weight)), sum.a.add(weight)));
    });
    return sum;
  })();
  return material;
}

/**
 * The arbitrary slice: geometry is in texture space already, so the position is the sample coordinate.
 * The gain is a number, or a uniform when the host changes it live.
 */
export function sliceMaterial(volume: THREE.Data3DTexture, lut: THREE.Texture, gain: number | UniformNode<"float", number>) {
  const material = new MeshBasicNodeMaterial({ side: THREE.DoubleSide, toneMapped: false });
  material.colorNode = lutColour(lut, amplitudeOf(texture3D(volume, positionLocal).level(float(0)).r).mul(gain));
  return material;
}
