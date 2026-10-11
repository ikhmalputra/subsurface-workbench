"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Map as GeographicMap, GeoJSONSource, MapMouseEvent } from "maplibre-gl";
import { gisAreaM2, gisDistanceM, importGisGeoJson, importGisGeoTiff, reprojectGisXY } from "@ikhmalputra/subsurface-core/gis";
import type { GeographicXY, GisImportedLayer, GisWorkspaceState } from "@ikhmalputra/subsurface-core/gis";
import { CommandButton } from "./ui.js";

export function GisTools({ map, state, onChange }: { map: GeographicMap | null; state: GisWorkspaceState; onChange: (state: GisWorkspaceState) => void }) {
  const [crs, setCrs] = useState("EPSG:4326"), [datum, setDatum] = useState(""), [mode, setMode] = useState<"imagery" | "elevation" | "depth">("imagery");
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [inspection, setInspection] = useState<{ layer: string; properties: Record<string, unknown> } | null>(null);
  const [coordinate, setCoordinate] = useState(""), [coordinateInput, setCoordinateInput] = useState("");
  const [seaDatumConfirmed, setSeaDatumConfirmed] = useState(false);
  const ids = useRef<string[]>([]);
  const commitImport = useEffectEvent((layer: GisImportedLayer) => {
    onChange({ ...state, layers: [...state.layers, layer] }); setInspection(null);
  });
  const updateLayer = (id: string, changes: Partial<GisImportedLayer>) => onChange({ ...state, layers: state.layers.map((layer) => layer.id === id ? { ...layer, ...changes } : layer) });
  const identify = useEffectEvent((point: { x: number; y: number }, geographic: GeographicXY) => {
    if (!map) return;
    if (state.tool !== "identify") {
      if (state.measurementFinished) return;
      try {
        const points = [...state.points, geographic];
        if (state.tool === "area") gisAreaM2(points);
        else gisDistanceM(points);
        onChange({ ...state, points }); setError(null);
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
      return;
    }
    const featureLayers = state.layers.filter((layer) => layer.vector && layer.visible).flatMap((layer) => [`${layer.id}-fill`, `${layer.id}-line`, `${layer.id}-point`]).filter((id) => map.getLayer(id));
    const feature = featureLayers.length ? map.queryRenderedFeatures([[point.x - 5, point.y - 5], [point.x + 5, point.y + 5]], { layers: featureLayers })[0] : undefined;
    if (feature) {
      const layer = state.layers.find((layer) => feature.layer.id.startsWith(`${layer.id}-`))!;
      const source = layer.vector?.features.find((item) => String(item.id) === String(feature.properties?.__sw_feature_id));
      if (!source) { setError("Picked GIS feature could not be matched to its imported source ID."); return; }
      setInspection({ layer: layer.label, properties: { ...source.properties, featureId: source.id } }); return;
    }
    for (const layer of [...state.layers].reverse()) {
      if (!layer.visible || !layer.raster) continue;
      const raster = layer.raster, xy = reprojectGisXY(geographic, "EPSG:4326", "EPSG:3857"), b = raster.displayBounds;
      if (xy[0] < b[0] || xy[0] > b[2] || xy[1] < b[1] || xy[1] > b[3]) continue;
      const x = Math.min(raster.width - 1, Math.floor((xy[0] - b[0]) / (b[2] - b[0]) * raster.width));
      const y = Math.min(raster.height - 1, Math.floor((b[3] - xy[1]) / (b[3] - b[1]) * raster.height));
      const value = raster.values?.[y * raster.width + x];
      setInspection({ layer: layer.label, properties: { value: value === undefined ? "RGB image" : Number.isFinite(value) ? value : "NoData", units: raster.mode === "imagery" ? "source image sample" : "metres", mode: raster.mode, verticalDatum: raster.verticalDatum ?? "not applicable", sampling: `nearest display pixel (${raster.width}×${raster.height})` } }); return;
    }
    setInspection(null);
  });
  const cursor = useEffectEvent((geographic: GeographicXY) => {
    try {
      const xy = reprojectGisXY(geographic, "EPSG:4326", crs);
      setCoordinate(`${crs}: ${xy[0].toFixed(crs === "EPSG:4326" ? 6 : 2)}, ${xy[1].toFixed(crs === "EPSG:4326" ? 6 : 2)} ${crs === "EPSG:4326" ? "degrees" : "m"}`);
    } catch (cause) { setCoordinate(`Coordinate unavailable: ${cause instanceof Error ? cause.message : String(cause)}`); }
  });
  useEffect(() => {
    if (!map) return;
    const click = (event: MapMouseEvent) => {
      const position = event.lngLat.wrap();
      try { identify(event.point, [position.lng, position.lat]); }
      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    };
    const move = (event: MapMouseEvent) => { const position = event.lngLat.wrap(); cursor([position.lng, position.lat]); };
    map.on("click", click); map.on("mousemove", move);
    return () => { map.off("click", click); map.off("mousemove", move); };
  }, [map]);
  useEffect(() => {
    if (!map) return;
    const enabled = map.doubleClickZoom.isEnabled();
    if (state.tool !== "identify") map.doubleClickZoom.disable();
    return () => { if (enabled) map.doubleClickZoom.enable(); };
  }, [map, state.tool]);
  useEffect(() => {
    if (!map) return;
    for (const id of ids.current.filter((id) => !state.layers.some((layer) => layer.id === id))) {
      for (const suffix of ["fill", "line", "point", "raster"]) if (map.getLayer(`${id}-${suffix}`)) map.removeLayer(`${id}-${suffix}`);
      if (map.getSource(id)) map.removeSource(id);
    }
    ids.current = state.layers.map((layer) => layer.id);
    for (const layer of state.layers) {
      const layout = { visibility: layer.visible ? "visible" as const : "none" as const };
      if (layer.vector) {
        if (!map.getSource(layer.id)) {
          map.addSource(layer.id, { type: "geojson", data: { ...layer.vector, features: layer.vector.features.map((feature) => ({ ...feature, properties: { ...feature.properties, __sw_feature_id: feature.id } })) } });
          map.addLayer({ id: `${layer.id}-fill`, source: layer.id, type: "fill", filter: ["==", "$type", "Polygon"], layout, paint: { "fill-color": layer.color, "fill-opacity": layer.opacity * 0.35 } }, "well-paths");
          map.addLayer({ id: `${layer.id}-line`, source: layer.id, type: "line", filter: ["!=", "$type", "Point"], layout, paint: { "line-color": layer.color, "line-width": 2, "line-opacity": layer.opacity } }, "well-paths");
          map.addLayer({ id: `${layer.id}-point`, source: layer.id, type: "circle", filter: ["==", "$type", "Point"], layout, paint: { "circle-color": layer.color, "circle-radius": 6, "circle-opacity": layer.opacity } }, "well-paths");
        }
        // `as const` keeps the layer types literal, so the derived paint keys narrow to real
        // property names instead of `${string}-color`, which maplibre v6 rightly rejects.
        for (const [suffix, type] of [["fill", "fill"], ["line", "line"], ["point", "circle"]] as const) {
          const id = `${layer.id}-${suffix}`;
          map.setPaintProperty(id, `${type}-color`, layer.color);
          map.setPaintProperty(id, `${type}-opacity`, layer.opacity * (suffix === "fill" ? 0.35 : 1));
          map.setLayoutProperty(id, "visibility", layout.visibility);
          map.moveLayer(id, "well-paths");
        }
      } else if (layer.raster) {
        if (map.getSource(layer.id)) {
          map.setPaintProperty(`${layer.id}-raster`, "raster-opacity", layer.opacity);
          map.setLayoutProperty(`${layer.id}-raster`, "visibility", layout.visibility);
          map.moveLayer(`${layer.id}-raster`, "well-paths"); continue;
        }
        const raster = layer.raster, canvas = document.createElement("canvas");
        canvas.width = raster.width; canvas.height = raster.height;
        const context = canvas.getContext("2d");
        if (!context) { setError("Raster rendering requires a 2D canvas context."); continue; }
        const image = context.createImageData(raster.width, raster.height); image.data.set(raster.rgba); context.putImageData(image, 0, 0);
        const pair = (xy: GeographicXY): [number, number] => [xy[0], xy[1]];
        map.addSource(layer.id, { type: "canvas", canvas, animate: false, coordinates: [pair(raster.corners[0]), pair(raster.corners[1]), pair(raster.corners[2]), pair(raster.corners[3])] });
        map.addLayer({ id: `${layer.id}-raster`, source: layer.id, type: "raster", layout, paint: { "raster-opacity": layer.opacity, "raster-fade-duration": 0 } }, "well-paths");
      }
    }
  }, [map, state.layers]);
  useEffect(() => {
    if (!map) return;
    const features: GeoJSON.Feature[] = state.points.map((coordinates, index) => ({ type: "Feature", properties: { vertex: index + 1 }, geometry: { type: "Point", coordinates: [...coordinates] } }));
    if (state.points.length >= 2) features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: state.points.map((xy) => [...xy]) } });
    if (state.tool === "area" && state.points.length >= 3) features.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...state.points.map((xy) => [...xy]), [...state.points[0]!]]] } });
    const data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };
    const source = map.getSource("gis-measurement") as GeoJSONSource | undefined;
    if (source) source.setData(data);
    else {
      if (state.measurementFinished) throw new TypeError("Measurement is finished. Clear or undo to edit it.");
      map.addSource("gis-measurement", { type: "geojson", data });
      map.addLayer({ id: "gis-measurement-area", type: "fill", source: "gis-measurement", filter: ["==", "$type", "Polygon"], paint: { "fill-color": "#ff6a00", "fill-opacity": 0.2 } });
      map.addLayer({ id: "gis-measurement-line", type: "line", source: "gis-measurement", paint: { "line-color": "#ff6a00", "line-width": 3 } });
      map.addLayer({ id: "gis-measurement-point", type: "circle", source: "gis-measurement", filter: ["==", "$type", "Point"], paint: { "circle-color": "#ff6a00", "circle-radius": 5 } });
    }
  }, [map, state.points, state.tool]);
  async function load(file: File) {
    setError(null); setBusy(true);
    try {
      if (file.size > 64 * 1024 * 1024) throw new RangeError("File limit is 64 MiB.");
      const id = `import-${crypto.randomUUID()}`;
      const data = /\.tiff?$/i.test(file.name)
        ? await importGisGeoTiff(await file.arrayBuffer(), { sourceCrs: crs, mode, verticalDatum: datum })
        : importGisGeoJson(JSON.parse(await file.text()), crs);
      commitImport({ ...data, id, label: file.name, source: file.name, sourceCrs: crs, visible: true, opacity: 1, color: "#397da3" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  function addCoordinate() {
    try {
      const values = coordinateInput.split(",").map((item) => Number(item.trim()));
      if (values.length !== 2 || coordinateInput.split(",").some((item) => !item.trim())) throw new TypeError("Enter two coordinates separated by a comma.");
      const xy = reprojectGisXY(values, crs, "EPSG:4326");
      if (state.tool === "identify") { map?.jumpTo({ center: [...xy], zoom: 12, pitch: 0, elevation: 0 }); }
      else {
        const points = [...state.points, xy];
        if (state.tool === "area") gisAreaM2(points); else gisDistanceM(points);
        onChange({ ...state, points });
      }
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  return <section className="sw-gis-workflow" aria-label="Offline GIS tools" data-testid="gis-tools">
    <h2>Offline GIS layers & spatial tools</h2>
    <p>Local GeoJSON vectors and north-up GeoTIFF imagery or bathymetry. Files stay in this browser session; no upload or external map requests.</p>
    <div className="sw-gis-import-controls">
      <label>Source / coordinate CRS<select value={crs} onChange={(event) => setCrs(event.target.value)}><option>EPSG:4326</option><option>EPSG:3857</option>{["326", "327"].flatMap((prefix) => Array.from({ length: 60 }, (_, index) => <option key={`${prefix}${index}`} value={`EPSG:${prefix}${String(index + 1).padStart(2, "0")}`}>WGS84 UTM {index + 1}{prefix === "326" ? "N" : "S"} · EPSG:{prefix}{String(index + 1).padStart(2, "0")}</option>))}</select></label>
      <label>GeoTIFF use<select value={mode} onChange={(event) => setMode(event.target.value === "depth" ? "depth" : event.target.value === "elevation" ? "elevation" : "imagery")}><option value="imagery">Map imagery</option><option value="elevation">Bathymetry: elevation, m positive up</option><option value="depth">Bathymetry: depth, m positive down</option></select></label>
      {mode !== "imagery" && <label>Vertical datum (metres)<input value={datum} onChange={(event) => setDatum(event.target.value)} placeholder="e.g. MSL; no datum conversion" /></label>}
      <label>Import local GIS file<input type="file" accept=".geojson,.json,.tif,.tiff" disabled={busy || !map} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void load(file); }} /></label>
    </div>
    {busy && <p role="status">Reading local GIS file...</p>}{error && <p role="alert" className="sw-gis-error">{error}</p>}
    <fieldset><legend>Map interaction</legend><label>GIS tool<select value={state.tool} onChange={(event) => { const tool = event.target.value === "distance" ? "distance" : event.target.value === "area" ? "area" : "identify"; onChange({ ...state, tool, points: [], measurementFinished: false }); }}><option value="identify">Identify features / inspect wells</option><option value="distance">Measure distance</option><option value="area">Measure area</option></select></label>
      <label>Coordinate pair (X, Y)<input value={coordinateInput} onChange={(event) => setCoordinateInput(event.target.value)} placeholder="longitude, latitude or easting, northing" /></label>
      <CommandButton icon={state.tool === "identify" ? "locate" : "add"} disabled={!map} onClick={addCoordinate}>{state.tool === "identify" ? "Go to coordinates" : "Add measurement vertex"}</CommandButton>
      <CommandButton icon="apply" disabled={state.tool === "identify" || state.measurementFinished || state.points.length < (state.tool === "area" ? 3 : 2)} onClick={() => onChange({ ...state, measurementFinished: true })}>Finish measurement</CommandButton>
      <CommandButton icon="reset" disabled={!state.points.length} onClick={() => onChange({ ...state, points: state.points.slice(0, -1), measurementFinished: false })}>Undo vertex</CommandButton>
      <CommandButton icon="clear" disabled={!state.points.length} onClick={() => onChange({ ...state, points: [], measurementFinished: false })}>Clear measurement</CommandButton>
      <output data-testid="gis-measurement">{state.tool === "area" ? `${gisAreaM2(state.points).toFixed(1)} m²` : `${gisDistanceM(state.points).toFixed(1)} m`} · {state.points.length} vertices · {state.measurementFinished ? "Finished" : "Live"} · WGS84 spherical horizontal measurement; excludes depth</output>
      <p>{coordinate || "Pointer coordinates use the selected CRS."} Click the map to identify a feature or add measurement vertices; coordinate entry is the keyboard alternative.</p>
    </fieldset>
    <section aria-label="Imported GIS layers"><h3>Layer stack · {state.layers.length}</h3>{!state.layers.length && <p>No local layers loaded. Import your geographic map, seabed grid or vector files; an online basemap is not substituted.</p>}
      {[...state.layers].reverse().map((layer) => <div className="sw-gis-layer-row" key={layer.id}>
        <label><input aria-label={`Show ${layer.label}`} type="checkbox" checked={layer.visible} onChange={(event) => updateLayer(layer.id, { visible: event.target.checked })} />{layer.label}</label>
        <small>{layer.sourceCrs} → EPSG:4326 · {layer.vector ? `${layer.vector.features.length} features` : `${layer.raster!.width}×${layer.raster!.height} display pixels · ${layer.raster!.mode} · ${layer.raster!.verticalDatum ?? "no vertical data"}`}</small>
        {layer.raster?.values && <small>Display colour range: {layer.raster.min} to {layer.raster.max}{layer.raster.mode === "imagery" ? " source sample units" : " m"} · nearest resampling · transparent NoData</small>}
        <label>Opacity<input aria-label={`Opacity ${layer.label}`} type="range" min={0} max={1} step={0.1} value={layer.opacity} onChange={(event) => updateLayer(layer.id, { opacity: Number(event.target.value) })} /></label>
        {layer.vector && <label>Colour<input type="color" aria-label={`Colour ${layer.label}`} value={layer.color} onChange={(event) => updateLayer(layer.id, { color: event.target.value })} /></label>}
        <CommandButton icon="fit" onClick={() => map?.fitBounds([[...layer.bounds[0]], [...layer.bounds[1]]], { padding: 60, maxZoom: 15, pitch: 0, elevation: 0, duration: 0 })}>Fit {layer.label}</CommandButton>
        <CommandButton icon="up" onClick={() => onChange({ ...state, layers: [...state.layers.filter((item) => item.id !== layer.id), layer] })}>Raise {layer.label}</CommandButton>
        <CommandButton icon="remove" onClick={() => { onChange({ ...state, layers: state.layers.filter((item) => item.id !== layer.id), bathymetryLayerId: state.bathymetryLayerId === layer.id ? null : state.bathymetryLayerId }); setInspection(null); }}>Remove {layer.label}</CommandButton>
        {layer.raster && layer.raster.mode !== "imagery" && <CommandButton icon="layers" disabled={!seaDatumConfirmed} onClick={() => onChange({ ...state, bathymetryLayerId: layer.id })}>Use {layer.label} as 3D seabed</CommandButton>}
        {layer.vector && <details><summary>Feature attributes · {layer.vector.features.length}</summary><select aria-label={`Inspect feature in ${layer.label}`} defaultValue="" onChange={(event) => { const feature = layer.vector!.features.find((feature) => String(feature.id) === event.target.value); if (feature) setInspection({ layer: layer.label, properties: { ...feature.properties, featureId: feature.id } }); }}><option value="">Choose feature</option>{layer.vector.features.slice(0, 1000).map((feature) => <option key={feature.id} value={feature.id}>{feature.id} · {feature.geometry.type}</option>)}</select>{layer.vector.features.length > 1000 && <p>First 1,000 listed; map identification covers all features.</p>}</details>}
      </div>)}
    </section>
    <label><input type="checkbox" checked={seaDatumConfirmed} onChange={(event) => setSeaDatumConfirmed(event.target.checked)} />I confirm the bathymetry datum is the map&apos;s sea-surface zero and values are metres; no vertical conversion.</label>
    {state.bathymetryLayerId && <p>3D seabed: {state.layers.find((layer) => layer.id === state.bathymetryLayerId)?.label}. Synthetic seabed and side curtains are replaced, not blended. Well water depths remain their original assumptions, not tied to this grid. Hide its layer to hide the surface. <CommandButton icon="reset" onClick={() => onChange({ ...state, bathymetryLayerId: null })}>Restore illustrative environment</CommandButton></p>}
    {inspection && <section aria-label="GIS feature attributes" data-testid="gis-identification"><h3>{inspection.layer}</h3><dl>{Object.entries(inspection.properties).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}</dl></section>}
  </section>;
}
