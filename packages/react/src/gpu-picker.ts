import * as THREE from "three";

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

const vertexShader = `
varying vec3 vPoint;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPoint = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;
const fragmentShader = `
precision highp sampler3D;
varying vec3 vPoint;
uniform float uId;
uniform bool uValuePass;
uniform bool uHasVolume;
uniform sampler3D uVolume;
uniform mat4 uWorldToTexture;
uniform float uScale;
uniform float uOffset;
void main() {
  float amplitude = 0.0;
  if (uHasVolume) {
    vec3 uvw = (uWorldToTexture * vec4(vPoint, 1.0)).xyz;
    amplitude = texture(uVolume, clamp(uvw, 0.0, 1.0)).r * uScale + uOffset;
  }
  gl_FragColor = uValuePass ? vec4(amplitude, 0.0, 0.0, uId) : vec4(vPoint, uId);
}`;

/** Two 1-pixel float FBO passes: scene XYZ/object ID, then actual GPU texture amplitude. */
export class GpuFramebufferPicker {
  private readonly target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  private readonly values = this.target.clone();
  private readonly emptyTexture = new THREE.Data3DTexture(new Float32Array(1), 1, 1, 1);
  private busy = false;
  private disposed = false;
  private released = false;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    if (!renderer.extensions.has("EXT_color_buffer_float")) throw new Error("GPU picking requires WebGL2 EXT_color_buffer_float; use explicit CPU picking on unsupported devices.");
    this.emptyTexture.type = THREE.FloatType;
    this.emptyTexture.format = THREE.RedFormat;
    this.emptyTexture.needsUpdate = true;
  }

  /** x/y are drawing-buffer pixels from the top-left, not CSS pixels. One pick at a time per instance. */
  async pick(camera: THREE.PerspectiveCamera, targets: readonly GpuPickTarget[], x: number, y: number): Promise<GpuSurfacePick | null> {
    if (this.disposed) throw new Error("GPU picker has been disposed.");
    if (this.busy) throw new Error("A GPU pick is already pending; coalesce pointer input before calling pick.");
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x >= size.x || y >= size.y) throw new RangeError("GPU pick pixel is outside the drawing buffer.");
    if (targets.length > 16_777_214) throw new RangeError("GPU pick IDs exceed exact float precision.");
    if (camera.view?.enabled) throw new Error("GPU picker expects an unsplit camera without an active view offset.");
    this.busy = true;
    const pickScene = new THREE.Scene(), materials: THREE.ShaderMaterial[] = [];
    const localCamera = camera.clone();
    localCamera.setViewOffset(size.x, size.y, Math.floor(x), Math.floor(y), 1, 1);
    localCamera.updateMatrixWorld(true);
    targets.forEach((binding, index) => {
      binding.mesh.updateWorldMatrix(true, false);
      const material = new THREE.ShaderMaterial({
        vertexShader, fragmentShader, side: THREE.DoubleSide, toneMapped: false, blending: THREE.NoBlending,
        uniforms: {
          uId: { value: index + 1 }, uValuePass: { value: false },
          uHasVolume: { value: !!binding.volume }, uVolume: { value: binding.volume?.texture ?? this.emptyTexture },
          uWorldToTexture: { value: binding.volume?.worldToTexture ?? new THREE.Matrix4() },
          uScale: { value: binding.volume?.scale ?? 1 }, uOffset: { value: binding.volume?.offset ?? 0 },
        },
      });
      materials.push(material);
      const mesh = new THREE.Mesh(binding.mesh.geometry, material);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(binding.mesh.matrixWorld);
      // Pick proxies may intentionally have invisible display materials; object visibility still applies.
      mesh.visible = true;
      for (let ancestor: THREE.Object3D | null = binding.mesh; ancestor; ancestor = ancestor.parent) {
        if (!ancestor.visible) { mesh.visible = false; break; }
      }
      mesh.layers.mask = binding.mesh.layers.mask;
      pickScene.add(mesh);
    });
    const renderer = this.renderer, previous = renderer.getRenderTarget();
    const color = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
    const autoClear = renderer.autoClear, xr = renderer.xr.enabled;
    const previousShaderError = renderer.debug.onShaderError;
    let shaderFailure: Error | null = null;
    try {
      try {
        renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
          shaderFailure = new Error(`GPU picking shader failed: ${gl.getProgramInfoLog(program) ?? gl.getShaderInfoLog(fragment) ?? gl.getShaderInfoLog(vertex) ?? "unknown compilation error"}`);
          previousShaderError?.(gl, program, vertex, fragment);
        };
        renderer.xr.enabled = false;
        renderer.autoClear = true;
        renderer.setClearColor(0, 0);
        renderer.setRenderTarget(this.target);
        renderer.render(pickScene, localCamera);
        if (shaderFailure) throw shaderFailure;
        for (const material of materials) material.uniforms.uValuePass!.value = true;
        renderer.setRenderTarget(this.values);
        renderer.render(pickScene, localCamera);
        if (shaderFailure) throw shaderFailure;
      } finally {
        renderer.setRenderTarget(previous);
        renderer.setClearColor(color, alpha);
        renderer.autoClear = autoClear;
        renderer.xr.enabled = xr;
        renderer.debug.onShaderError = previousShaderError;
      }
      const [coordinates, values] = await Promise.all([
        renderer.readRenderTargetPixelsAsync(this.target, 0, 0, 1, 1, new Float32Array(4)),
        renderer.readRenderTargetPixelsAsync(this.values, 0, 0, 1, 1, new Float32Array(4)),
      ]);
      if (this.disposed) return null;
      const id = Math.round(coordinates[3]!);
      if (id === 0) return null;
      const binding = targets[id - 1];
      if (!binding || ![...coordinates, ...values].every(Number.isFinite)) throw new Error("GPU pick returned invalid framebuffer data.");
      return { target: binding, point: new THREE.Vector3(coordinates[0], coordinates[1], coordinates[2]), amplitude: binding.volume ? values[0]! : null };
    } finally {
      for (const material of materials) material.dispose();
      this.busy = false;
      if (this.disposed) this.release();
    }
  }

  dispose() { this.disposed = true; if (!this.busy) this.release(); }
  private release() {
    if (this.released) return;
    this.released = true;
    this.target.dispose(); this.values.dispose(); this.emptyTexture.dispose();
  }
}
