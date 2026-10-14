import * as THREE from "three";
import { PMREMGenerator, WebGPURenderer } from "three/webgpu";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/**
 * One way to start a 3D scene. three.js's WebGPU renderer draws through WebGPU where the browser
 * has it and falls back to WebGL 2 by itself where it does not, so every scene gets the same node
 * materials, clipping groups and post-processing on both. A scene builds synchronously and draws
 * once `ready` resolves; until then `draws` is false and the scene's render call does nothing.
 */
export type SceneBackend = "webgpu" | "webgl2";

export interface SceneRenderer {
  readonly renderer: WebGPURenderer;
  /** Resolves with the backend in use once the device is up; rejects if neither WebGPU nor WebGL 2 starts. */
  readonly ready: Promise<SceneBackend>;
  /** True once `ready` has resolved and until `dispose`. */
  readonly draws: () => boolean;
  /** A room-lit environment map for physically based materials; available after `ready`. */
  environment(): THREE.Texture;
  dispose(): void;
}

export function createSceneRenderer({ antialias = true, alpha = true, pixelRatioCap = 2, toneMapping = THREE.ACESFilmicToneMapping }: { readonly antialias?: boolean; readonly alpha?: boolean; readonly pixelRatioCap?: number; readonly toneMapping?: THREE.ToneMapping } = {}): SceneRenderer {
  const renderer = new WebGPURenderer({ antialias, alpha });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
  renderer.toneMapping = toneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  let live = false, disposed = false;
  let pmrem: PMREMGenerator | null = null;
  let map: THREE.Texture | null = null;
  const ready = renderer.init().then(() => {
    if (disposed) throw new Error("The scene was closed before its renderer started.");
    live = true;
    const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "webgpu" : "webgl2";
    renderer.domElement.dataset.backend = backend;
    return backend as SceneBackend;
  });
  return {
    renderer,
    ready,
    draws: () => live && !disposed,
    environment() {
      if (!live) throw new Error("The environment map needs a started renderer; wait for ready.");
      if (!map) {
        pmrem = new PMREMGenerator(renderer);
        map = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      }
      return map;
    },
    dispose() {
      disposed = true;
      live = false;
      map?.dispose();
      pmrem?.dispose();
      renderer.dispose();
    },
  };
}
