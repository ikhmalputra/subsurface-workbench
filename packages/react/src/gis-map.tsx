"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Map as GeographicMap, GeoJSONSource, GeoJSONSourceSpecification, StyleSpecification } from "maplibre-gl";
import { prepareGisDocument, selectGisStation } from "@ikhmalputra/subsurface-core/gis";
import { emptyGisWorkspace } from "@ikhmalputra/subsurface-core/gis";
import type { GisDocument, GisWorkspaceState } from "@ikhmalputra/subsurface-core/gis";
import type { SubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import { useSubsurfaceSelector } from "./state-hooks.js";
import type { GisTrajectory3d, makeGisTrajectoryLayer } from "./gis-trajectories.js";
import type { OffshoreEnvironmentLayers } from "./offshore-environment.js";
export type { GisTrajectory3d } from "./gis-trajectories.js";
import { GisTools } from "./gis-tools.js";
import { CommandButton } from "./ui.js";

export interface GisMapProps {
  readonly document: GisDocument;
  readonly store: SubsurfaceStore;
  /** Self-hosted MapLibre CSP worker matching the installed engine version. */
  readonly workerUrl: string;
  /** Optional same-origin raster tile URL templates. No online provider is enabled implicitly. */
  readonly rasterTiles?: readonly string[];
  readonly rasterAttribution?: string;
  /** Optional embedded Three.js trajectories; requires the optional `three` peer. No second canvas is created. */
  readonly trajectories3d?: readonly GisTrajectory3d[];
  readonly children?: ReactNode;
  readonly gisState?: GisWorkspaceState;
  readonly onGisStateChange?: (state: GisWorkspaceState) => void;
}

function localUrl(value: string): string {
  const url = new URL(value, window.location.href);
  if (url.origin !== window.location.origin || !["http:", "https:"].includes(url.protocol)) throw new TypeError("Offline GIS resources must be served from the host origin.");
  return url.href;
}

export function GisMap({ document, store, workerUrl, rasterTiles, rasterAttribution, trajectories3d, children, gisState, onGisStateChange }: GisMapProps) {
  const model = useMemo(() => prepareGisDocument(document), [document]);
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<GeographicMap | null>(null);
  const trajectoryLayer = useRef<ReturnType<typeof makeGisTrajectoryLayer> | null>(null);
  const [threeReady, setThreeReady] = useState(false);
  const [colorBy, setColorBy] = useState<"dls" | "solid">("dls");
  const [constructionVisible, setConstructionVisible] = useState(true);
  const [diameterScale, setDiameterScale] = useState(400);
  const [environment, setEnvironment] = useState<OffshoreEnvironmentLayers>({ sea: true, water: true, seabed: true, subsurface: true });
  const [localGisState, setLocalGisState] = useState(emptyGisWorkspace);
  const gis = gisState ?? localGisState;
  const setGis = onGisStateChange ?? setLocalGisState;
  const inspecting = useEffectEvent(() => gis.tool === "identify");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string>("Move over the map for longitude / latitude");
  const [hidden, setHidden] = useState<readonly string[]>([]);
  const active = useSubsurfaceSelector(store, (state) => state.activeAsset);
  const picked = model.wells.find((entry) => entry.well.id === active.wellId) ?? model.wells[0]!;
  const selectedMd = active.depth_md;
  const station = active.wellId === picked.well.id && selectedMd !== null
    ? picked.stations.reduce((nearest, entry) => Math.abs(entry.mdM - selectedMd) < Math.abs(nearest.mdM - selectedMd) ? entry : nearest)
    : null;
  const exactStation = station?.mdM === active.depth_md;
  const publish = useEffectEvent((wellId: string, index: number) => {
    const well = model.wells.find((entry) => entry.well.id === wellId)?.well;
    if (well) selectGisStation(store, well, index, "gis-map");
  });
  const publishDepth = useEffectEvent((wellId: string, mdM: number, componentId: string | null) => {
    store.pinDepth(wellId, mdM, "gis-3d");
    store.selectComponent(componentId, "gis-3d");
  });

  useEffect(() => {
    let cancelled = false;
    let instance: GeographicMap | null = null;
    let resize: ResizeObserver | null = null;
    setReady(false);
    setThreeReady(false);
    setError(null);
    const setup = async () => {
      const library = await import("maplibre-gl/dist/maplibre-gl-csp.js");
      const makeLayer = trajectories3d?.length ? (await import("./gis-trajectories.js")).makeGisTrajectoryLayer : null;
      if (cancelled || !element.current) return;
      library.setWorkerUrl(localUrl(workerUrl));
      library.setWorkerCount(1);
      const style: StyleSpecification = {
        version: 8, sources: {},
        layers: [{ id: "background", type: "background", paint: { "background-color": "#eaf0f3" } }],
      };
      if (rasterTiles?.length) {
        if (!rasterAttribution?.trim()) throw new TypeError("Host raster basemap requires attribution.");
        rasterTiles.forEach(localUrl);
        style.sources.basemap = { type: "raster", tiles: [...rasterTiles], tileSize: 256, attribution: rasterAttribution };
        style.layers.push({ id: "basemap", type: "raster", source: "basemap" });
      }
      instance = new library.Map({
        container: element.current, style, center: [...model.wells[0]!.stations[0]!.geographic],
        zoom: 12, renderWorldCopies: false, maxPitch: trajectories3d?.length ? 85 : 60,
        transformRequest: (url) => ({ url: localUrl(url) }),
        attributionControl: false,
      });
      map.current = instance;
      const embedded = makeLayer && trajectories3d ? makeLayer(model, trajectories3d, library.MercatorCoordinate, (message) => { if (!cancelled) setError(message); }) : null;
      trajectoryLayer.current = embedded;
      instance.addControl(new library.NavigationControl(), "top-right");
      instance.addControl(new library.ScaleControl({ unit: "metric" }), "bottom-left");
      instance.addControl(new library.AttributionControl({ compact: false }), "bottom-right");
      instance.on("error", (event) => { if (!cancelled) setError(`GIS rendering/resource error: ${event.error.message}`); });
      instance.on("load", () => {
        if (cancelled || !instance) return;
        const lines: GeoJSONSourceSpecification["data"] = {
          type: "FeatureCollection",
          features: model.wells.map(({ well, stations }) => ({
            type: "Feature", properties: { wellId: well.id }, geometry: { type: "LineString", coordinates: stations.map((point) => [...point.geographic]) },
          })),
        };
        instance.addSource("wells", { type: "geojson", data: lines });
        instance.addLayer({ id: "well-paths", type: "line", source: "wells", paint: { "line-color": "#136d85", "line-width": 5 } });
        instance.addSource("wellheads", {
          type: "geojson", data: { type: "FeatureCollection", features: model.wells.map(({ well, stations }) => ({
            type: "Feature", properties: { wellId: well.id }, geometry: { type: "Point", coordinates: [...stations[0]!.geographic] },
          })) },
        });
        instance.addLayer({ id: "wellheads", type: "circle", source: "wellheads", paint: { "circle-radius": 7, "circle-color": "#fff", "circle-stroke-color": "#136d85", "circle-stroke-width": 3 } });
        for (const [index, { layer, coordinates }] of model.layers.entries()) {
          const layerId = `gis-layer-${index}`;
          const xy = coordinates.map((point) => [...point]);
          instance.addSource(layerId, { type: "geojson", data: { type: "Feature", properties: {}, geometry: layer.geometry === "Polygon" ? { type: "Polygon", coordinates: [xy] } : { type: "LineString", coordinates: xy } } });
          if (layer.geometry === "Polygon") instance.addLayer({ id: `${layerId}-fill`, type: "fill", source: layerId, paint: { "fill-color": "#548baa", "fill-opacity": 0.12 } }, "well-paths");
          instance.addLayer({ id: layerId, type: "line", source: layerId, paint: { "line-color": layer.kind === "seismic-footprint" ? "#497c99" : "#947033", "line-width": 2, "line-dasharray": [3, 2] } }, "well-paths");
        }
        instance.addSource("selected", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        instance.addLayer({ id: "selected", type: "circle", source: "selected", paint: { "circle-radius": 9, "circle-color": "#ff6a00", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
        instance.fitBounds([[...model.bounds[0]], [...model.bounds[1]]], { padding: 65, maxZoom: 15, duration: 0 });
        if (embedded) {
          instance.addLayer(embedded.layer);
          instance.setLayoutProperty("well-paths", "visibility", "none");
          instance.setLayoutProperty("selected", "visibility", "none");
          embedded.fit(null);
          setThreeReady(true);
        }
        instance.getCanvas().setAttribute("aria-label", embedded ? "Geographic map with embedded underwater 3D well trajectories. Drag to pan; right-drag to orbit; zoom with plus and minus. Click a path to pin measured depth or use the depth controls." : "Geographic GIS map. Pan with arrow keys; zoom with plus and minus. Use the station controls for keyboard selection.");
        setReady(true);
      });
      instance.on("mousemove", (event) => {
        setCursor(`${event.lngLat.lng.toFixed(6)}° longitude / ${event.lngLat.lat.toFixed(6)}° latitude`);
      });
      instance.on("click", (event) => {
        if (!inspecting()) return;
        if (!instance || !instance.getLayer("well-paths")) return;
        const picked3d = embedded?.pick(event.point.x, event.point.y);
        if (picked3d) { publishDepth(picked3d.wellId, picked3d.mdM, picked3d.componentId); return; }
        const features = instance.queryRenderedFeatures([[event.point.x - 8, event.point.y - 8], [event.point.x + 8, event.point.y + 8]], { layers: ["well-paths", "wellheads"] });
        const wellId = features[0]?.properties?.wellId;
        const entry = model.wells.find((item) => item.well.id === wellId);
        if (!entry) return;
        let index = 0, distance = Infinity;
        for (const point of entry.stations) {
          const pixel = instance.project([...point.geographic]);
          const next = (pixel.x - event.point.x) ** 2 + (pixel.y - event.point.y) ** 2;
          if (next < distance) { index = point.index; distance = next; }
        }
        publish(entry.well.id, index);
      });
      resize = new ResizeObserver(() => instance?.resize());
      resize.observe(element.current);
    };
    setup().catch((cause: unknown) => { if (!cancelled) setError(`GIS could not start: ${cause instanceof Error ? cause.message : String(cause)}`); });
    return () => { cancelled = true; resize?.disconnect(); instance?.remove(); map.current = null; trajectoryLayer.current = null; };
  }, [model, workerUrl, rasterTiles, rasterAttribution, trajectories3d]);

  useEffect(() => {
    if (!threeReady) return;
    trajectoryLayer.current?.select(active.wellId, active.depth_md, active.componentId);
    trajectoryLayer.current?.colorBy(colorBy);
    trajectoryLayer.current?.construction(constructionVisible, diameterScale);
    trajectoryLayer.current?.environment(environment);
  }, [threeReady, active.wellId, active.depth_md, active.componentId, colorBy, constructionVisible, diameterScale, environment]);

  useEffect(() => {
    if (!threeReady) return;
    trajectoryLayer.current?.bathymetry(gis.layers.find((layer) => layer.id === gis.bathymetryLayerId) ?? null);
  }, [threeReady, gis.layers, gis.bathymetryLayerId]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const selected = map.current.getSource("selected") as GeoJSONSource;
    selected.setData({ type: "FeatureCollection", features: station ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [...station.geographic] } }] : [] });
    for (const [index, { layer }] of model.layers.entries()) {
      const layerId = `gis-layer-${index}`;
      const visibility = hidden.includes(layer.id) ? "none" : "visible";
      map.current.setLayoutProperty(layerId, "visibility", visibility);
      if (layer.geometry === "Polygon") map.current.setLayoutProperty(`${layerId}-fill`, "visibility", visibility);
    }
  }, [ready, station, hidden, model]);

  useEffect(() => {
    if (!ready || !map.current || !element.current) return;
    const instance = map.current;
    const host = element.current;
    const applyTheme = () => {
      const css = getComputedStyle(host);
      const color = (name: string) => css.getPropertyValue(name).trim();
      instance.setPaintProperty("background", "background-color", color("--sw-paper"));
      instance.setPaintProperty("well-paths", "line-color", color("--sw-map-well"));
      instance.setPaintProperty("wellheads", "circle-stroke-color", color("--sw-map-well"));
      instance.setPaintProperty("selected", "circle-color", color("--sw-select"));
      for (const [index, { layer }] of model.layers.entries()) {
        const id = `gis-layer-${index}`;
        instance.setPaintProperty(id, "line-color", color(layer.kind === "seismic-footprint" ? "--sw-map-seismic-line" : "--sw-map-surface"));
        if (layer.geometry === "Polygon") instance.setPaintProperty(`${id}-fill`, "fill-color", color("--sw-map-seismic-fill"));
      }
    };
    applyTheme();
    const observer = new MutationObserver(applyTheme);
    const theme = host.closest("[data-sw-theme]");
    if (theme) observer.observe(theme, { attributes: true, attributeFilter: ["data-sw-theme"] });
    return () => observer.disconnect();
  }, [ready, model]);

  return <section className="sw-gis" aria-label="Geographic GIS workspace" data-testid="gis-map" data-ready={ready} data-3d-ready={threeReady} data-trajectory-count={threeReady ? trajectories3d?.length : 0} data-selected-well={active.wellId ?? ""} data-selected-md={station ? active.depth_md : ""} data-marker-md={!threeReady ? station?.mdM ?? "" : ""}>
    <div className="sw-gis-tools">
      <CommandButton icon="fit" type="button" disabled={!ready} onClick={() => trajectoryLayer.current ? trajectoryLayer.current.fit(null) : map.current?.fitBounds([[...model.bounds[0]], [...model.bounds[1]]], { padding: 65, maxZoom: 15, duration: 0 })}>Fit field</CommandButton>
      {trajectories3d?.length && <><CommandButton icon="focus" type="button" disabled={!threeReady || !active.wellId} onClick={() => trajectoryLayer.current?.fit(active.wellId)}>Focus selected trajectory</CommandButton><label>Trajectory colour <select value={colorBy} onChange={(event) => setColorBy(event.target.value === "dls" ? "dls" : "solid")}><option value="dls">Dogleg severity</option><option value="solid">Solid path</option></select></label></>}
      {trajectories3d?.some((item) => item.design.components?.length) && <>
        <label><input type="checkbox" checked={constructionVisible} onChange={(event) => setConstructionVisible(event.target.checked)} />Construction cutaway</label>
        <label>Diameter exaggeration<select value={diameterScale} onChange={(event) => setDiameterScale(Number(event.target.value))}>{[200, 400, 800].map((value) => <option key={value} value={value}>{value}×</option>)}</select></label>
        <CommandButton icon="inspect" disabled={!threeReady || !active.wellId || !active.componentId} onClick={() => { if (active.wellId && active.componentId) trajectoryLayer.current?.focusComponent(active.wellId, active.componentId); }}>Inspect selected component</CommandButton>
      </>}
      <CommandButton icon="view" type="button" disabled={!ready} onClick={() => map.current?.easeTo({ pitch: map.current.getPitch() > 0 ? 0 : 50, duration: 0 })}>Toggle map perspective</CommandButton>
      <span>EPSG:4326 input display / EPSG:3857 map projection</span>
    </div>
    {error && <p role="alert" className="sw-gis-error">{error}</p>}
    {trajectories3d?.length && <fieldset className="sw-gis-environment-controls"><legend>Illustrative offshore environment</legend>
      {([["sea", "Sea surface"], ["water", "Water column"], ["seabed", "Illustrative seabed"], ["subsurface", "Subsurface cutaway"]] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={environment[key]} onChange={(event) => setEnvironment({ ...environment, [key]: event.target.checked })} />{label}</label>)}
      <span>Assumed water depths · interpolated seabed, not bathymetry · open cutaway, not geological layers</span>
    </fieldset>}
    <div className="sw-gis-canvas" ref={element} data-testid="gis-canvas" />
    {!ready && !error && <p role="status">Starting self-hosted GIS engine…</p>}
    <p className="sw-gis-coordinate" aria-live="off">{cursor}</p>
    <GisTools map={ready ? map.current : null} state={gis} onChange={setGis} />
    {threeReady && <p className="sw-gis-coordinate">3D wells inside this map · sea surface at 0 m, seabed anchored to assumed wellhead water depths · altitude = −(water depth + TVD) · {constructionVisible && trajectories3d?.some((item) => item.design.components?.length) ? `construction cutaway: diameters exaggerated ${diameterScale}×; component colours, not DLS` : "trajectory: DLS 0 → 3°/30 m → above reference"} · environment drawn as a transparent cutaway so buried construction remains inspectable</p>}
    {children}
    <div className="sw-gis-panels">
      <fieldset><legend>CRS-aware layers</legend>
        {model.layers.map(({ layer }) => <label key={layer.id}>
          <input type="checkbox" checked={!hidden.includes(layer.id)} onChange={(event) => setHidden(event.target.checked ? hidden.filter((id) => id !== layer.id) : [...hidden, layer.id])} />
          <span>{layer.label}<small>{layer.crs} → EPSG:4326 / {layer.provenance}<br />{layer.source} / elevation not supplied</small></span>
        </label>)}
        <p>{rasterTiles?.length ? `Host basemap: ${rasterAttribution}` : "No basemap supplied. Geographic canvas and supplied layers only; no terrain, roads or imagery are invented."}</p>
      </fieldset>
      <fieldset><legend>Linked survey station</legend>
        <label>Well <select value={picked.well.id} onChange={(event) => {
          const entry = model.wells.find((item) => item.well.id === event.target.value);
          if (entry) selectGisStation(store, entry.well, 0, "gis-station-controls");
        }}>{model.wells.map(({ well }) => <option key={well.id} value={well.id}>{well.label}</option>)}</select></label>
        <label>Survey station <input type="range" min={0} max={picked.stations.length - 1} step={1} value={station?.index ?? 0} onChange={(event) => selectGisStation(store, picked.well, Number(event.target.value), "gis-station-controls")} /></label>
        <CommandButton icon="locate" type="button" onClick={() => selectGisStation(store, picked.well, picked.stations.length - 1, "gis-station-controls")}>Select final survey station</CommandButton>
        <output aria-live="polite">{station ? `${exactStation ? "" : `Selected ${active.depth_md!.toFixed(1)} m MD; ${threeReady ? "nearest source station for this register" : "map marker at nearest supplied station"}: `}${station.mdM.toFixed(1)} m MD / ${station.xyz[2].toFixed(1)} m TVD / ${station.geographic[0].toFixed(6)}°, ${station.geographic[1].toFixed(6)}°` : "No station selected"}</output>
        <small>{picked.well.crs} / metres / TVD positive down from {picked.well.depthDatum}. Source: {picked.well.source}. Picks use exact supplied stations.</small>
      </fieldset>
    </div>
  </section>;
}
