import * as THREE from "three";
import { MeshBasicNodeMaterial, RenderTarget } from "three/webgpu";
import type { WebGPURenderer } from "three/webgpu";
import { clamp, float, positionWorld, texture3D, uniform, vec4 } from "three/tsl";

export interface GpuPickTarget {
  readonly mesh: THREE.Mesh;
  /** Optional 3D texture readback. Matrix converts scene XYZ into normalized texture coordinates. */
  readonly volume?: {
    readonly texture: THREE.Data3DTexture;
    readonly worldToTexture: THREE.Matrix4;
    readonly scale: number;
    readonly offset: number;
  };
}

export interface GpuSurfacePick {
  readonly target: GpuPickTarget;
  readonly point: THREE.Vector3;
  /** Trilinearly sampled physical amplitude; null for surfaces without a volume binding. */
  readonly amplitude: number | null;
}

/**
 * Two 1-pixel float render passes through three's WebGPU renderer (WebGPU, or its WebGL 2
 * fallback): the first writes scene XYZ and an object ID, the second the amplitude the GPU samples
 * from the volume texture at that point. Both are read back asynchronously.
 */
export class GpuFramebufferPicker {
  private readonly target = new RenderTarget(1, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  private readonly values = new RenderTarget(1, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  private busy = false;
  private disposed = false;
  private released = false;

  constructor(private readonly renderer: WebGPURenderer) {}

  /** x/y are drawing-buffer pixels from the top-left, not CSS pixels. One pick at a time per instance. */
  async pick(camera: THREE.PerspectiveCamera, targets: readonly GpuPickTarget[], x: number, y: number): Promise<GpuSurfacePick | null> {
    if (this.disposed) throw new Error("GPU picker has been disposed.");
    if (this.busy) throw new Error("A GPU pick is already pending; coalesce pointer input before calling pick.");
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x >= size.x || y >= size.y) throw new RangeError("GPU pick pixel is outside the drawing buffer.");
    if (targets.length > 16_777_214) throw new RangeError("GPU pick IDs exceed exact float precision.");
    if (camera.view?.enabled) throw new Error("GPU picker expects an unsplit camera without an active view offset.");
    this.busy = true;
    const pickScene = new THREE.Scene();
    const meshes: { mesh: THREE.Mesh; position: MeshBasicNodeMaterial; value: MeshBasicNodeMaterial }[] = [];
    const localCamera = camera.clone();
    localCamera.setViewOffset(size.x, size.y, Math.floor(x), Math.floor(y), 1, 1);
    localCamera.updateMatrixWorld(true);
    targets.forEach((binding, index) => {
      binding.mesh.updateWorldMatrix(true, false);
      const id = float(index + 1);
      const common = { side: THREE.DoubleSide, toneMapped: false, blending: THREE.NoBlending, transparent: false } as const;
      const position = new MeshBasicNodeMaterial(common);
      position.fragmentNode = vec4(positionWorld, id);
      const value = new MeshBasicNodeMaterial(common);
      if (binding.volume) {
        const toTexture = uniform(binding.volume.worldToTexture);
        const uvw = clamp(toTexture.mul(vec4(positionWorld, 1)).xyz, 0, 1);
        const amplitude = texture3D(binding.volume.texture, uvw).level(float(0)).r.mul(binding.volume.scale).add(binding.volume.offset);
        value.fragmentNode = vec4(amplitude, 0, 0, id);
      } else value.fragmentNode = vec4(0, 0, 0, id);
      const mesh = new THREE.Mesh(binding.mesh.geometry, position);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(binding.mesh.matrixWorld);
      // Pick proxies may intentionally have invisible display materials; object visibility still applies.
      mesh.visible = true;
      for (let ancestor: THREE.Object3D | null = binding.mesh; ancestor; ancestor = ancestor.parent) {
        if (!ancestor.visible) { mesh.visible = false; break; }
      }
      mesh.layers.mask = binding.mesh.layers.mask;
      pickScene.add(mesh);
      meshes.push({ mesh, position, value });
    });
    const renderer = this.renderer, previous = renderer.getRenderTarget();
    const color = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
    const autoClear = renderer.autoClear;
    try {
      try {
        renderer.autoClear = true;
        renderer.setClearColor(0, 0);
        renderer.setRenderTarget(this.target);
        renderer.render(pickScene, localCamera);
        for (const { mesh, value } of meshes) mesh.material = value;
        renderer.setRenderTarget(this.values);
        renderer.render(pickScene, localCamera);
      } finally {
        renderer.setRenderTarget(previous);
        renderer.setClearColor(color, alpha);
        renderer.autoClear = autoClear;
      }
      const [coordinates, values] = await Promise.all([
        renderer.readRenderTargetPixelsAsync(this.target, 0, 0, 1, 1),
        renderer.readRenderTargetPixelsAsync(this.values, 0, 0, 1, 1),
      ]) as [Float32Array, Float32Array];
      if (this.disposed) return null;
      const id = Math.round(coordinates[3]!);
      if (id === 0) return null;
      const binding = targets[id - 1];
      if (!binding || ![...coordinates.slice(0, 4), ...values.slice(0, 4)].every(Number.isFinite)) throw new Error("GPU pick returned invalid framebuffer data.");
      return { target: binding, point: new THREE.Vector3(coordinates[0], coordinates[1], coordinates[2]), amplitude: binding.volume ? values[0]! : null };
    } finally {
      for (const { position, value } of meshes) { position.dispose(); value.dispose(); }
      this.busy = false;
      if (this.disposed) this.release();
    }
  }

  dispose() { this.disposed = true; if (!this.busy) this.release(); }
  private release() {
    if (this.released) return;
    this.released = true;
    this.target.dispose(); this.values.dispose();
  }
}
