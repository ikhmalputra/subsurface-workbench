"use client";

import { useEffect, useEffectEvent, useId, useRef, useState, type KeyboardEvent } from "react";
import type { SubsurfaceSeismicVoxelCube } from "@ikhmalputra/subsurface-core/contracts";
import { useSubsurfaceSelector } from "./state-hooks.js";
import { WebGpuVolumeRenderer } from "./webgpu-volume.js";
import type { WebGpuVolumeOptions } from "./webgpu-volume.js";
import { CommandButton } from "./ui.js";

export interface WebGpuSeismicCanvasProps extends WebGpuVolumeOptions {
  readonly cube: SubsurfaceSeismicVoxelCube;
}

/** Opt-in, native WebGPU canvas. Unsupported devices and shader/device errors are shown, never silently downgraded. */
export function WebGpuSeismicCanvas({ cube, store, amplitudeLimit, threshold, opacity, onError }: WebGpuSeismicCanvasProps) {
  const host = useRef<HTMLDivElement>(null), engine = useRef<WebGpuVolumeRenderer | null>(null);
  const summaryId = useId();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading"), [error, setError] = useState("");
  const viewState = useSubsurfaceSelector(store, (state) => state.viewState);
  const report = useEffectEvent((failure: Error) => { setError(failure.message); setStatus("error"); onError(failure); });
  const settings = useEffectEvent(() => ({ amplitudeLimit, threshold, opacity }));
  useEffect(() => {
    let disposed = false;
    let renderer: WebGpuVolumeRenderer | null = null;
    setStatus("loading"); setError("");
    try {
      renderer = new WebGpuVolumeRenderer(host.current!, cube, { store, ...settings(), onError: report });
      engine.current = renderer;
      void renderer.init().then(() => {
        if (!disposed) {
          setStatus("ready");
          renderer?.canvas.setAttribute("role", "img");
          renderer?.canvas.setAttribute("tabindex", "0");
          renderer?.canvas.setAttribute("aria-describedby", summaryId);
        }
      }).catch((failure: unknown) => {
        if (!disposed) { renderer?.dispose(); report(failure instanceof Error ? failure : new Error(String(failure))); }
      });
    } catch (failure) { report(failure instanceof Error ? failure : new Error(String(failure))); }
    return () => { disposed = true; renderer?.dispose(); engine.current = null; };
  }, [cube, store]);
  useEffect(() => {
    try { engine.current?.setSettings({ amplitudeLimit, threshold, opacity }); } catch (failure) { report(failure instanceof Error ? failure : new Error(String(failure))); }
  }, [amplitudeLimit, threshold, opacity]);

  const cameraStep = Math.max(...[
    cube.header.bounds.xMax - cube.header.bounds.xMin,
    cube.header.bounds.yMax - cube.header.bounds.yMin,
    cube.header.bounds.zMax - cube.header.bounds.zMin,
  ]) / 40;
  function moveCamera(axis: 0 | 1 | 2, amount: number) {
    const position = [...viewState.position] as [number, number, number];
    const target = [...viewState.target] as [number, number, number];
    position[axis] += cameraStep * amount;
    target[axis] += cameraStep * amount;
    store.setViewState({ position, target }, "webgpu-accessible-camera");
  }
  function zoomCamera(factor: number) {
    store.setViewState({ zoom: Math.max(0.1, Math.min(10, viewState.zoom * factor)) }, "webgpu-accessible-camera");
  }
  function handleCanvasKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys = {
      ArrowLeft: [0, -1] as const, ArrowRight: [0, 1] as const,
      ArrowUp: [2, -1] as const, ArrowDown: [2, 1] as const,
    } as const;
    const movement = event.key === "ArrowLeft" ? keys.ArrowLeft
      : event.key === "ArrowRight" ? keys.ArrowRight
        : event.key === "ArrowUp" ? keys.ArrowUp
          : event.key === "ArrowDown" ? keys.ArrowDown
            : null;
    if (movement) {
      event.preventDefault();
      moveCamera(movement[0], movement[1]);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault(); zoomCamera(1.25);
    } else if (event.key === "-") {
      event.preventDefault(); zoomCamera(0.8);
    }
  }
  return <section className="sw-webgpu-canvas" aria-label="WebGPU seismic viewer" data-testid="webgpu-viewer" data-status={status}>
    <div
      ref={host}
      className="sw-webgpu-host"
      onKeyDown={(event) => {
        if (event.target instanceof HTMLCanvasElement) handleCanvasKeyDown(event);
      }}
    />
    <p id={summaryId} className="sw-webgpu-a11y-summary">
      {cube.header.dimensions.join(" by ")} voxel samples in the supplied spatial bounds. Drag the canvas to orbit with a pointer,
      or focus it and use arrow keys to pan the camera and plus/minus to zoom. Equivalent camera buttons follow the canvas.
    </p>
    <div className="sw-webgpu-keyboard-controls" role="group" aria-label="Keyboard camera controls">
      <CommandButton icon="previous" type="button" aria-label="Move camera left" onClick={() => moveCamera(0, -1)}>Left</CommandButton>
      <CommandButton icon="up" type="button" aria-label="Move camera up" onClick={() => moveCamera(2, -1)}>Up</CommandButton>
      <CommandButton icon="down" type="button" aria-label="Move camera down" onClick={() => moveCamera(2, 1)}>Down</CommandButton>
      <CommandButton icon="next" type="button" aria-label="Move camera right" onClick={() => moveCamera(0, 1)}>Right</CommandButton>
      <CommandButton icon="zoomIn" type="button" aria-label="Zoom in" onClick={() => zoomCamera(1.25)}>Zoom in</CommandButton>
      <CommandButton icon="zoomOut" type="button" aria-label="Zoom out" onClick={() => zoomCamera(0.8)}>Zoom out</CommandButton>
    </div>
    <p className="sw-sr-only" aria-live="polite">Camera position {viewState.position.map((value) => value.toFixed(1)).join(", ")} metres; zoom {viewState.zoom.toFixed(2)}. Pan and zoom changes are linked through the shared view state.</p>
    {status === "loading" && <p role="status">Initializing native WebGPU...</p>}
    {status === "error" && <p role="alert">{error}</p>}
  </section>;
}
export { WebGpuVolumeRenderer } from "./webgpu-volume.js";
export type { WebGpuVolumeOptions } from "./webgpu-volume.js";
