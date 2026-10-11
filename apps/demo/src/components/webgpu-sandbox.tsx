"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { createSubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import { slicePlaneFromAngles } from "@ikhmalputra/subsurface-core";
import { syncStateToUrl } from "@ikhmalputra/subsurface-core/state-url";
import { createMockSeismicCube } from "@ikhmalputra/subsurface-core/sandbox";
import { useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";
import Link from "next/link";
import { GpuPickingCheck } from "./gpu-picking-check";
import { CommandButton } from "@ikhmalputra/subsurface-react/ui";

const WebGpuSeismicCanvas = dynamic(() => import("@ikhmalputra/subsurface-react/webgpu").then((m) => m.WebGpuSeismicCanvas), { ssr: false });

export function WebGpuSandbox() {
  const [store] = useState(() => {
    const store = createSubsurfaceStore();
    store.setViewState({ position: [4500, -4500, -3000], target: [0, 0, 1500], zoom: 1 });
    return store;
  });
  const [cube, setCube] = useState(() => createMockSeismicCube({ seed: 42 }));
  const [enabled, setEnabled] = useState(false), [threshold, setThreshold] = useState(40), [opacity, setOpacity] = useState(20), [error, setError] = useState<string | null>(null);
  const plane = useSubsurfaceSelector(store, (state) => state.interpretation?.slicePlane ?? null);
  useEffect(() => syncStateToUrl(store, { onError: (e) => setError(e instanceof Error ? e.message : String(e)) }), [store]);
  const tilt = plane ? Math.acos(Math.min(1, Math.max(-1, plane.normal[2]))) * 180 / Math.PI : 45;
  return <section className="demo-stage" aria-label="WebGPU sandbox">
    <div className="demo-toolbar">
      <CommandButton icon="play" type="button" className="demo-toggle" aria-pressed={enabled} onClick={() => { setError(null); setEnabled(!enabled); }}>{enabled ? "Stop WebGPU" : "Start WebGPU"}</CommandButton>
      <CommandButton icon="reset" type="button" className="demo-toggle" onClick={() => setCube(createMockSeismicCube({ seed: cube.header.id === "mock-seismic-42" ? 7 : 42, sampleType: cube.header.sampleType }))}>Regenerate seismic</CommandButton>
      <label>Voxel format<select aria-label="Voxel format" value={cube.header.sampleType} onChange={(e) => {
        const sampleType = e.target.value;
        if (sampleType !== "float32" && sampleType !== "uint8") { setEnabled(false); setError("Unsupported sandbox voxel format."); return; }
        setCube(createMockSeismicCube({ seed: cube.header.id === "mock-seismic-42" ? 42 : 7, sampleType }));
      }}><option value="float32">Float32</option><option value="uint8">Uint8 / calibrated</option></select></label>
      <label>Opacity<input type="range" min={0} max={100} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} /></label>
      <label>Transparent below<input type="range" min={0} max={95} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} /></label>
      <CommandButton icon="layers" type="button" className="demo-toggle" aria-pressed={!!plane} onClick={() => store.setSlicePlane(plane ? null : slicePlaneFromAngles([0, 0, 1500], 45, 45), "sandbox")}>Oblique slice</CommandButton>
      {plane && <>
        <label>Plane tilt<input type="range" min={0} max={180} value={tilt} onChange={(e) => store.setSlicePlane(slicePlaneFromAngles(plane.origin, 45, Number(e.target.value)), "sandbox")} /></label>
        <label>Slice depth<input type="range" min={0} max={3000} value={plane.origin[2]} onChange={(e) => store.setSlicePlane({ ...plane, origin: [plane.origin[0], plane.origin[1], Number(e.target.value)] }, "sandbox")} /></label>
      </>}
      <Link href="/view-well/">Use the WebGL well viewer</Link>
      <span>{cube.header.dimensions.join(" × ")} voxels · synthetic, offline</span>
    </div>
    {error && !enabled && <p role="alert">{error}</p>}
    {enabled ? <WebGpuSeismicCanvas cube={cube} store={store} amplitudeLimit={1} threshold={threshold / 100} opacity={opacity / 100} onError={(e) => setError(e.message)} /> : <p>Start the opt-in WebGPU canvas to test your browser and GPU. No data is uploaded.</p>}
    <GpuPickingCheck />
  </section>;
}
