import * as THREE from "three";
import { intersectSliceBox, validateSlicePlane } from "@ikhmalputra/subsurface-core";
import type { SlicePlane } from "@ikhmalputra/subsurface-core/state";

/** GPU-sampled slice through the same volume texture. Geometry is at most six vertices; data is never resliced on CPU. */
export class SeismicSlice {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  constructor(texture: THREE.Data3DTexture, lut: THREE.DataTexture, gain: number) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial({
      side: THREE.DoubleSide, toneMapped: false,
      uniforms: { uVolume: { value: texture }, uLut: { value: lut }, uGain: { value: gain } },
      vertexShader: "varying vec3 vUvw; void main() { vUvw = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `
        precision highp sampler3D;
        uniform sampler3D uVolume;
        uniform sampler2D uLut;
        uniform float uGain;
        varying vec3 vUvw;
        void main() {
          float a = texture(uVolume, vUvw).r * uGain;
          gl_FragColor = vec4(texture(uLut, vec2(clamp(a, -1.0, 1.0)*0.5+0.5,0.5)).rgb, 1.0);
        }`,
    }));
    this.mesh.visible = false;
    this.mesh.name = "Arbitrary seismic slice";
  }

  /** Plane is scene-local east/north/depth metres; frame maps texture UVW into Three scene units. */
  update(input: SlicePlane | null, frame: THREE.Matrix4, min: THREE.Vector3, max: THREE.Vector3): number {
    if (!input) { this.mesh.visible = false; return 0; }
    const plane = validateSlicePlane(input);
    const origin = new THREE.Vector3(plane.origin[0] / 100, -plane.origin[2] / 100, -plane.origin[1] / 100);
    const normal = new THREE.Vector3(plane.normal[0], -plane.normal[2], -plane.normal[1]);
    const inverse = frame.clone().invert();
    const uvOrigin = origin.applyMatrix4(inverse);
    // A normal is a covector: texture-space normal = transpose(frame linear part) * world normal.
    const uvNormal = normal.applyMatrix3(new THREE.Matrix3().setFromMatrix4(frame).transpose()).normalize();
    const points = intersectSliceBox({ origin: [uvOrigin.x, uvOrigin.y, uvOrigin.z], normal: [uvNormal.x, uvNormal.y, uvNormal.z] }, [min.x, min.y, min.z], [max.x, max.y, max.z]);
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p)));
    const indices: number[] = [];
    for (let i = 1; i + 1 < points.length; i++) indices.push(0, i, i + 1);
    geometry.setIndex(indices);
    this.mesh.geometry.dispose();
    this.mesh.geometry = geometry;
    this.mesh.visible = points.length >= 3;
    return points.length;
  }

  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
