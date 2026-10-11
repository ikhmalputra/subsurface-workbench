"use client";

import { sampleWellLog, slicePlaneFromAngles } from "@ikhmalputra/subsurface-core";
import type { SubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import type { SubsurfaceWellLogCurve } from "@ikhmalputra/subsurface-core/contracts";
import type { SceneSeismicVolume } from "@ikhmalputra/subsurface-react/three";
import { useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";

export function InterpretationControls({ store, volume, curve, picking, onPickingChange }: {
  store: SubsurfaceStore; volume: SceneSeismicVolume; curve: SubsurfaceWellLogCurve; picking: "cpu" | "gpu"; onPickingChange: (method: "cpu" | "gpu") => void;
}) {
  const interpretation = useSubsurfaceSelector(store, (state) => state.interpretation);
  const depth = useSubsurfaceSelector(store, (state) => state.activeAsset.depth_md);
  const plane = interpretation?.slicePlane, style = interpretation?.logStyle;
  const angle = volume.azimuthDeg * Math.PI / 180, along = (volume.alongStartM + volume.alongEndM) / 2, offset = (volume.offsetStartM + volume.offsetEndM) / 2;
  const centre = [
    (volume.originEastingM ?? 0) + Math.sin(angle) * along + Math.cos(angle) * offset,
    (volume.originNorthingM ?? 0) + Math.cos(angle) * along - Math.sin(angle) * offset,
    (volume.topTvdM + volume.baseTvdM) / 2,
  ] as const;
  const azimuth = plane ? (Math.atan2(plane.normal[0], plane.normal[1]) * 180 / Math.PI + 360) % 360 : volume.azimuthDeg;
  const tilt = plane ? Math.acos(Math.min(1, Math.max(-1, plane.normal[2]))) * 180 / Math.PI : 90;
  const distance = plane ? plane.normal.reduce((sum, n, i) => sum + n * (plane.origin[i]! - centre[i]!), 0) : 0;
  const maxDistance = Math.ceil(Math.hypot(volume.alongEndM - volume.alongStartM, volume.offsetEndM - volume.offsetStartM, volume.baseTvdM - volume.topTvdM) / 2);
  const logValue = depth === null ? null : sampleWellLog(curve, depth);
  return <div className="demo-cuts" role="group" aria-label="3D interpretation">
    <label>Seismic slice<select aria-label="Seismic slice" value={plane ? "arbitrary" : "volume"} onChange={(e) => store.setSlicePlane(e.target.value === "volume" ? null : slicePlaneFromAngles(centre, volume.azimuthDeg, 90), "slice-controls")}>
      <option value="volume">Volume / axis cuts</option><option value="arbitrary">Arbitrary plane</option>
    </select></label>
    {plane && <>
      <label>Plane azimuth<input aria-label="Plane azimuth" type="range" min={0} max={359} value={azimuth} onChange={(e) => store.setSlicePlane(slicePlaneFromAngles(plane.origin, Number(e.target.value), tilt), "slice-controls")} /><output>{Math.round(azimuth)} degrees</output></label>
      <label>Plane tilt<input aria-label="Plane tilt" type="range" min={0} max={180} value={tilt} onChange={(e) => store.setSlicePlane(slicePlaneFromAngles(plane.origin, azimuth, Number(e.target.value)), "slice-controls")} /><output>{Math.round(tilt)} degrees</output></label>
      <label>Plane offset<input aria-label="Plane offset" type="range" min={-maxDistance} max={maxDistance} value={Math.max(-maxDistance, Math.min(maxDistance, distance))} onChange={(e) => {
        const value = Number(e.target.value);
        store.setSlicePlane({ ...plane, origin: [centre[0] + plane.normal[0] * value, centre[1] + plane.normal[1] * value, centre[2] + plane.normal[2] * value] }, "slice-controls");
      }} /><output>{Math.round(distance)} m</output></label>
      <span>Drag the blue plane-normal handle in 3D to translate the slice.</span>
    </>}
    <label>Picking<select aria-label="Picking engine" value={picking} onChange={(e) => onPickingChange(e.target.value === "gpu" ? "gpu" : "cpu")}><option value="cpu">CPU raycast</option><option value="gpu">GPU framebuffer</option></select></label>
    <label>Synthetic porosity<select aria-label="Well log styling" value={style?.mode ?? "none"} onChange={(e) => {
      const mode = e.target.value;
      store.setLogStyle(mode === "color" || mode === "radius" || mode === "color-radius" ? { curveId: curve.id, mode, domain: [0.09, 0.23], radiusRange: [0.5, 2.5] } : null, "log-controls");
    }}>
      <option value="none">Off / survey DLS</option><option value="color">Colour</option><option value="radius">Display radius</option><option value="color-radius">Colour + radius</option>
    </select></label>
    {style && <output data-testid="porosity-readout">{depth === null ? "Hover a linked depth to sample" : logValue === null ? "No porosity at this MD" : `${(logValue * 100).toFixed(1)}% porosity at ${Math.round(depth)} m MD`} · synthetic, not FORGE data</output>}
  </div>;
}
