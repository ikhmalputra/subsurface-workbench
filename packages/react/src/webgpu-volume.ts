import * as THREE from "three/webgpu";
import { Discard, Fn, If, Loop, clamp, float, max, min, mix, positionLocal, texture3DLoad, uniform, vec3, vec4 } from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { intersectSliceBox, validateSeismicVoxelCube } from "@ikhmalputra/subsurface-core";
import type { SubsurfaceSeismicVoxelCube } from "@ikhmalputra/subsurface-core/contracts";
import type { SubsurfaceStore, SubsurfaceState } from "@ikhmalputra/subsurface-core/state";
import type { Node } from "three/webgpu";

export interface WebGpuVolumeOptions {
  readonly store: SubsurfaceStore;
  /** Physical amplitude magnitude mapped to full colour/opacity, strictly positive. */
  readonly amplitudeLimit: number;
  readonly threshold?: number;
  readonly opacity?: number;
  readonly onError: (error: Error) => void;
}

/** Native WebGPU-only volume backend. No automatic WebGL fallback or raw data network I/O. */
export class WebGpuVolumeRenderer {
  readonly renderer = new THREE.Renderer(new THREE.WebGPUBackend(), { antialias: true });
  readonly canvas = this.renderer.domElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
  private readonly texture: THREE.Data3DTexture;
  private readonly volume: THREE.Mesh;
  private readonly slice: THREE.Mesh;
  private readonly controls: OrbitControls;
  private readonly observer: ResizeObserver;
  private readonly eye = uniform(new THREE.Vector3());
  private readonly threshold = uniform(0.4);
  private readonly opacity = uniform(0.2);
  private readonly limit = uniform(1);
  private readonly cropMax = uniform(new THREE.Vector3(1, 1, 1));
  private readonly normalizer: THREE.Vector3;
  private readonly origin: THREE.Vector3;
  private readonly scale: number;
  private unsubscribe: (() => void) | null = null;
  private ready = false;
  private disposed = false;
  private applying = false;
  private removeGpuErrorListener: (() => void) | null = null;
  private gpuFailure: Error | null = null;
  private initializing = false;

  constructor(private readonly host: HTMLElement, input: SubsurfaceSeismicVoxelCube, private readonly options: WebGpuVolumeOptions) {
    const cube = validateSeismicVoxelCube(input);
    const { dimensions: [nx, ny, nz], bounds: b, amplitude } = cube.header;
    this.setSettings(options);
    this.origin = new THREE.Vector3(b.xMin, b.yMin, b.zMin);
    this.normalizer = new THREE.Vector3(b.xMax - b.xMin, b.yMax - b.yMin, b.zMax - b.zMin);
    this.scale = Math.max(this.normalizer.x, this.normalizer.y, this.normalizer.z);
    this.texture = new THREE.Data3DTexture(cube.data, nx, ny, nz);
    this.texture.type = cube.data instanceof Float32Array ? THREE.FloatType : THREE.UnsignedByteType;
    this.texture.format = THREE.RedFormat;
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.unpackAlignment = 1;
    this.texture.needsUpdate = true;
    const dims = vec3(nx, ny, nz);
    const amplitudeScale = amplitude.scale * (cube.data instanceof Uint8Array ? 255 : 1);
    const sample = Fn(([uvw]: [Node<"vec3">]) => {
      const index = uvw.mul(dims).floor().clamp(vec3(0), dims.sub(1));
      return texture3DLoad(this.texture, index, 0).r.mul(amplitudeScale).add(amplitude.offset).div(this.limit);
    });
    const colour = Fn(([a]: [Node<"float">]) => mix(vec3(0.12, 0.3, 0.75), vec3(0.85, 0.22, 0.14), a.clamp(-1, 1).mul(0.5).add(0.5)));
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false });
    material.fragmentNode = Fn(() => {
      const dir = positionLocal.sub(this.eye);
      // Bound reciprocal directions without NaN/Inf for parallel rays on box faces.
      const signs = vec3(dir.x.greaterThanEqual(0).select(1, -1), dir.y.greaterThanEqual(0).select(1, -1), dir.z.greaterThanEqual(0).select(1, -1));
      const inv = signs.div(dir.abs().max(1e-7));
      const near = min(vec3(0).sub(this.eye).mul(inv), this.cropMax.sub(this.eye).mul(inv));
      const far = max(vec3(0).sub(this.eye).mul(inv), this.cropMax.sub(this.eye).mul(inv));
      const entry = clamp(max(max(near.x, near.y), near.z), 0, 1);
      const exit = clamp(min(min(far.x, far.y), far.z), 0, 1);
      If(exit.sub(entry).lessThanEqual(1e-7), () => { Discard(); });
      const start = this.eye.add(dir.mul(entry));
      const span = dir.mul(exit.sub(entry));
      const sum = vec4(0).toVar();
      Loop(192, ({ i }) => {
        const uvw = start.add(span.mul(float(i).add(0.5).div(192)));
        const a = sample(uvw);
        const alpha = a.abs().smoothstep(this.threshold, 1).mul(this.opacity);
        const weight = float(1).sub(sum.a).mul(alpha);
        sum.rgb.addAssign(colour(a).mul(weight));
        sum.a.addAssign(weight);
      });
      // Three uses straight alpha for this material.
      return vec4(sum.rgb.div(sum.a.max(1e-6)), sum.a);
    })();
    this.volume = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5), material);
    const sliceMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    sliceMaterial.fragmentNode = Fn(() => vec4(colour(sample(positionLocal)), 1))();
    this.slice = new THREE.Mesh(new THREE.BufferGeometry(), sliceMaterial);
    this.slice.visible = false;
    for (const mesh of [this.volume, this.slice]) {
      mesh.scale.set(this.normalizer.x / this.scale, -this.normalizer.z / this.scale, -this.normalizer.y / this.scale);
      // UVW uses X,Y,depth; map to Three X,-depth,-Y explicitly rather than a diagonal scale.
      mesh.matrixAutoUpdate = false;
      mesh.matrix.makeBasis(new THREE.Vector3(this.normalizer.x / this.scale, 0, 0), new THREE.Vector3(0, 0, -this.normalizer.y / this.scale), new THREE.Vector3(0, -this.normalizer.z / this.scale, 0));
      this.scene.add(mesh);
    }
    this.scene.background = new THREE.Color("#edf1ed");
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = false;
    this.controls.addEventListener("change", this.draw);
    this.controls.addEventListener("end", this.publishCamera);
    this.renderer.onDeviceLost = (info) => {
      if (this.disposed) return;
      this.ready = false;
      this.gpuFailure = new Error(`WebGPU device lost: ${info.message}`);
      this.options.onError(this.gpuFailure);
    };
    this.observer = new ResizeObserver(() => this.resize());
  }

  async init(): Promise<void> {
    this.initializing = true;
    try {
      await this.renderer.init();
      if (this.disposed) return;
      const backend = this.renderer.backend;
      if (!("isWebGPUBackend" in backend) || backend.isWebGPUBackend !== true) throw new Error("A native WebGPU backend is required.");
      // Three's public backend types do not describe the native device; guard this runtime boundary explicitly.
      const device: unknown = Reflect.get(backend, "device");
      if (!(device instanceof EventTarget) || !("limits" in device) || typeof device.limits !== "object" || device.limits === null || !("maxTextureDimension3D" in device.limits) || typeof device.limits.maxTextureDimension3D !== "number") throw new Error("WebGPU backend did not expose a valid device.");
      const dimensions = this.texture.image;
      if (Math.max(dimensions.width, dimensions.height, dimensions.depth) > device.limits.maxTextureDimension3D) throw new RangeError(`Seismic cube exceeds the device's ${device.limits.maxTextureDimension3D}-voxel 3D texture axis limit.`);
      const gpuError = (event: Event) => {
        if (this.disposed) return;
        const message = "error" in event && typeof event.error === "object" && event.error !== null && "message" in event.error && typeof event.error.message === "string" ? event.error.message : "Unknown GPU validation error";
        this.gpuFailure = new Error(`WebGPU validation failed: ${message}`);
        this.ready = false;
        this.options.onError(this.gpuFailure);
      };
      device.addEventListener("uncapturederror", gpuError);
      this.removeGpuErrorListener = () => device.removeEventListener("uncapturederror", gpuError);
      this.host.appendChild(this.canvas);
      this.canvas.setAttribute("aria-label", "WebGPU seismic volume");
      this.canvas.dataset.backend = "webgpu";
      this.applyState(this.options.store.getState());
      await this.renderer.compileAsync(this.scene, this.camera);
      if (this.disposed) return;
      if (this.gpuFailure) throw this.gpuFailure;
      this.ready = true;
      this.observer.observe(this.host);
      this.unsubscribe = this.options.store.subscribe((event) => {
        if (event.source === "webgpu-camera") return;
        if (!["camera", "interpretation", "slices", "hydrate"].includes(event.type)) return;
        this.applyState(event.state);
        this.draw();
      });
      this.resize();
      if (this.gpuFailure) throw this.gpuFailure;
    } catch (error) {
      if (!this.disposed) throw new Error(`WebGPU volume initialization failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    } finally {
      this.initializing = false;
      if (this.disposed) this.renderer.dispose();
    }
  }

  setSettings(settings: { amplitudeLimit: number; threshold?: number; opacity?: number }): void {
    const threshold = settings.threshold ?? 0.4, opacity = settings.opacity ?? 0.2;
    if (!Number.isFinite(settings.amplitudeLimit) || settings.amplitudeLimit <= 0 || !Number.isFinite(threshold) || threshold < 0 || threshold >= 1 || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new RangeError("WebGPU volume settings require positive amplitudeLimit, threshold in [0,1), opacity in [0,1].");
    this.limit.value = settings.amplitudeLimit; this.threshold.value = threshold; this.opacity.value = opacity;
    this.draw();
  }

  private applyState(state: SubsurfaceState) {
    this.applying = true;
    try {
      const local = (point: readonly [number, number, number]) => new THREE.Vector3((point[0] - this.origin.x) / this.scale, -(point[2] - this.origin.z) / this.scale, -(point[1] - this.origin.y) / this.scale);
      this.camera.position.copy(local(state.viewState.position));
      this.controls.target.copy(local(state.viewState.target));
      this.camera.zoom = state.viewState.zoom;
      const distance = this.camera.position.distanceTo(this.controls.target);
      this.camera.near = Math.max(0.0001, distance / 2000);
      this.camera.far = Math.max(100, distance * 10);
      this.camera.updateProjectionMatrix();
      this.controls.update();
      const plane = state.interpretation?.slicePlane;
      const cut = (value: number | null, origin: number, extent: number) => value === null ? 1 : Math.max(0.001, Math.min(1, (value - origin) / extent));
      this.cropMax.value.set(
        cut(state.seismicSlices.inline, this.origin.x, this.normalizer.x),
        cut(state.seismicSlices.crossline, this.origin.y, this.normalizer.y),
        cut(state.seismicSlices.time_depth, this.origin.z, this.normalizer.z),
      );
      this.volume.visible = !plane;
      this.slice.visible = !!plane;
      if (plane) {
        const n = plane.normal;
        const uvwOrigin = new THREE.Vector3(...plane.origin).sub(this.origin).divide(this.normalizer);
        const uvwNormal = new THREE.Vector3(...n).multiply(this.normalizer).normalize();
        const c = this.cropMax.value;
        const points = intersectSliceBox({ origin: [uvwOrigin.x, uvwOrigin.y, uvwOrigin.z], normal: [uvwNormal.x, uvwNormal.y, uvwNormal.z] }, [0, 0, 0], [c.x, c.y, c.z]);
        const geometry = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p)));
        const indices: number[] = [];
        for (let i = 1; i + 1 < points.length; i++) indices.push(0, i, i + 1);
        geometry.setIndex(indices);
        this.slice.geometry.dispose(); this.slice.geometry = geometry;
        this.slice.visible = points.length >= 3;
      }
    } finally { this.applying = false; }
  }

  private publishCamera = () => {
    if (this.applying || !this.ready) return;
    const world = (p: THREE.Vector3): readonly [number, number, number] => [p.x * this.scale + this.origin.x, -p.z * this.scale + this.origin.y, -p.y * this.scale + this.origin.z];
    this.options.store.setViewState({ position: world(this.camera.position), target: world(this.controls.target), zoom: this.camera.zoom }, "webgpu-camera");
  };
  private resize() {
    if (!this.ready || !this.host.clientWidth || !this.host.clientHeight) return;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(this.host.clientWidth, this.host.clientHeight);
    this.camera.aspect = this.host.clientWidth / this.host.clientHeight;
    this.camera.updateProjectionMatrix();
    this.draw();
  }
  private draw = () => {
    if (!this.ready || this.disposed) return;
    try {
      this.scene.updateMatrixWorld(true);
      this.eye.value.copy(this.camera.position).applyMatrix4(this.volume.matrixWorld.clone().invert());
      this.renderer.render(this.scene, this.camera);
    } catch (error) {
      this.ready = false;
      this.gpuFailure = new Error(`WebGPU rendering failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      this.options.onError(this.gpuFailure);
    }
  };
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.ready = false;
    this.unsubscribe?.(); this.observer.disconnect(); this.controls.dispose();
    this.removeGpuErrorListener?.();
    for (const mesh of [this.volume, this.slice]) {
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose()); else mesh.material.dispose();
    }
    this.texture.dispose();
    if (!this.initializing) this.renderer.dispose();
    this.canvas.remove();
  }
}
