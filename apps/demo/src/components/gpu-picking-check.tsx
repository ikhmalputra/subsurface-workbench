"use client";

import { useState } from "react";
import { CommandButton } from "@ikhmalputra/subsurface-react/ui";

/** Offline GPU picking check with known geometry and amplitudes, run through the same WebGPU renderer (or its WebGL 2 fallback) the scenes use. */
export function GpuPickingCheck() {
  const [result, setResult] = useState<{ xyz: string; amplitude: number; miss: boolean; hidden: boolean; disposed: boolean; restored: boolean; backend: string } | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true); setError(""); setResult(null);
    try { await check(); } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { setBusy(false); }
  }
  async function check() {
    const THREE = await import("three"), { WebGPURenderer } = await import("three/webgpu"), { GpuFramebufferPicker } = await import("@ikhmalputra/subsurface-react/3d");
    let renderer: InstanceType<typeof WebGPURenderer> | null = null;
    let picker: InstanceType<typeof GpuFramebufferPicker> | null = null;
    const texture = new THREE.Data3DTexture(new Float32Array(8).fill(0.25), 2, 2, 2);
    const geometry = new THREE.PlaneGeometry(2, 2), material = new THREE.MeshBasicMaterial();
    try {
      renderer = new WebGPURenderer({ antialias: false });
      await renderer.init();
      renderer.setSize(64, 64);
      renderer.setClearColor("#f1f1f1", 0.7);
      renderer.autoClear = false;
      texture.type = THREE.FloatType; texture.format = THREE.RedFormat;
      texture.minFilter = texture.magFilter = THREE.NearestFilter; texture.needsUpdate = true;
      const mesh = new THREE.Mesh(geometry, material), camera = new THREE.PerspectiveCamera(90, 1, 0.1, 10);
      camera.position.z = 2; camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
      const targets = [{ mesh, volume: { texture, worldToTexture: new THREE.Matrix4().makeScale(0.5, 0.5, 0.5).setPosition(0.5, 0.5, 0.5), scale: 2, offset: 1 } }];
      picker = new GpuFramebufferPicker(renderer);
      const hit = await picker.pick(camera, targets, 32, 32);
      if (!hit || hit.amplitude === null) throw new Error("The GPU did not return a hit on the reference plane.");
      const miss = await picker.pick(camera, targets, 0, 0);
      const parent = new THREE.Group();
      parent.add(mesh); parent.visible = false;
      const hidden = await picker.pick(camera, targets, 32, 32);
      parent.visible = true;
      const pending = picker.pick(camera, targets, 32, 32);
      picker.dispose();
      const disposed = await pending;
      setResult({
        xyz: hit.point.toArray().join(","), amplitude: hit.amplitude, miss: miss === null,
        hidden: hidden === null, disposed: disposed === null,
        restored: renderer.getRenderTarget() === null && renderer.autoClear === false && Math.abs(renderer.getClearAlpha() - 0.7) < 1e-9 && camera.view === null,
        backend: (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "WebGPU" : "WebGL 2",
      });
    } finally {
      picker?.dispose(); renderer?.dispose(); texture.dispose(); geometry.dispose(); material.dispose();
    }
  }
  return <section aria-label="GPU picking check">
    <CommandButton icon="play" type="button" className="demo-toggle" disabled={busy} onClick={() => void run()}>{busy ? "Checking GPU picking..." : "Run GPU picking check"}</CommandButton>
    {error && <p role="alert">{error}</p>}
    {result && <output data-testid="gpu-check-result" data-xyz={result.xyz} data-amplitude={result.amplitude} data-miss={result.miss} data-hidden={result.hidden} data-disposed={result.disposed} data-restored={result.restored} data-backend={result.backend}>{result.backend} · surface XYZ {result.xyz}; amplitude {result.amplitude}; misses, visibility, disposal and renderer restoration {result.miss && result.hidden && result.disposed && result.restored ? "passed" : "failed"}</output>}
  </section>;
}
