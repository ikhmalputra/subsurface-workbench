"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { GeoJSONSource, Map as GeographicMap, Marker, StyleSpecification } from "maplibre-gl";
import type { GeographicXY } from "@ikhmalputra/subsurface-core/gis";
import { CommandButton } from "./ui.js";

/**
 * Every well the host can place, on one map of the world. It opens as a globe, so wells on
 * opposite sides of the Pacific are in one view; a site's marker names it and says whether its
 * records are documented or synthetic. Choosing a site flies to it, where the map shows each
 * well's surface location, its path in plan and the outline of any seismic that covers it.
 *
 * The basemap is the host's own file — land and borders as GeoJSON, served from its origin — so
 * the map makes no third-party request and invents no terrain, roads or imagery. Without one the
 * map draws the graticule alone.
 */

export interface WellsMapWell {
  readonly id: string;
  readonly label: string;
  /** Surface location, longitude/latitude (WGS84 or a datum within metres of it). */
  readonly head: GeographicXY;
  /** The path in plan, longitude/latitude, wellhead first. */
  readonly path?: readonly GeographicXY[];
}

export interface WellsMapSite {
  readonly id: string;
  readonly label: string;
  readonly provenance: "documented" | "synthetic" | "user-authored";
  /** One line on what the site carries, e.g. "1 well · seismic volume · 2 formations". */
  readonly summary: string;
  readonly wells: readonly WellsMapWell[];
  /** Outlines such as a seismic survey's footprint: closed rings, longitude/latitude. */
  readonly footprints?: readonly { readonly id: string; readonly label: string; readonly ring: readonly GeographicXY[] }[];
}

export interface WellsMapProps {
  readonly sites: readonly WellsMapSite[];
  /** Self-hosted MapLibre CSP worker matching the installed engine version. */
  readonly workerUrl: string;
  /** Same-origin GeoJSON of land polygons (`properties.kind: "land"`) and borders (`"border"`). */
  readonly basemapUrl?: string;
  readonly basemapAttribution?: string;
  /**
   * Same-origin world imagery already in Web Mercator, square, spanning ±85.0511° (e.g. NASA Blue
   * Marble reprojected): laid under the coastlines and borders in place of the flat land fill, fading
   * as the map zooms in to a site.
   */
  readonly imageryUrl?: string;
  readonly imageryAttribution?: string;
  readonly selectedSiteId: string | null;
  readonly selectedWellId: string | null;
  /** A site (and well) chosen on the map; null when the reader returns to the world view. */
  readonly onSelect: (siteId: string | null, wellId: string | null) => void;
  /**
   * A point on a well to mark, such as where a linked depth cursor sits on the well's path in plan,
   * with the words to show beside it. The host places it; the map does not interpolate paths.
   */
  readonly cursor?: { readonly at: GeographicXY; readonly label: string } | null;
  /** A section line to draw, longitude/latitude ends. */
  readonly sectionLine?: readonly [GeographicXY, GeographicXY] | null;
  /**
   * Offer "Draw section": the reader drags a line on the map (its ends snap to a wellhead within
   * 14 px) and it is reported here; null when cleared. Without it the map draws no section tool.
   */
  readonly onSectionLineChange?: (line: readonly [GeographicXY, GeographicXY] | null) => void;
}

function localUrl(value: string): string {
  const url = new URL(value, window.location.href);
  if (url.origin !== window.location.origin || !["http:", "https:"].includes(url.protocol)) throw new TypeError("Offline map resources must be served from the host origin.");
  return url.href;
}

function graticule() {
  const features: { type: "Feature"; properties: { equator?: boolean }; geometry: { type: "LineString"; coordinates: number[][] } }[] = [];
  for (let lon = -180; lon <= 180; lon += 30) features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: Array.from({ length: 33 }, (_, i) => [lon, -80 + i * 5]) } });
  for (let lat = -60; lat <= 60; lat += 30) features.push({ type: "Feature", properties: { equator: lat === 0 }, geometry: { type: "LineString", coordinates: Array.from({ length: 73 }, (_, i) => [-180 + i * 5, lat]) } });
  return { type: "FeatureCollection" as const, features };
}

function siteBounds(site: WellsMapSite): [[number, number], [number, number]] {
  const points = [...site.wells.flatMap((well) => [well.head, ...(well.path ?? [])]), ...(site.footprints ?? []).flatMap((footprint) => footprint.ring)];
  const lons = points.map((p) => p[0]), lats = points.map((p) => p[1]);
  return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
}

const WORLD = { center: [-176, 16] as [number, number], zoom: 1.35 };

export function WellsMap({ sites, workerUrl, basemapUrl, basemapAttribution, imageryUrl, imageryAttribution, selectedSiteId, selectedWellId, onSelect, cursor: depthCursor = null, sectionLine = null, onSectionLineChange }: WellsMapProps) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<GeographicMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const depthMarker = useRef<{ marker: Marker; text: HTMLElement } | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [globe, setGlobe] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [zoom, setZoom] = useState(WORLD.zoom);
  const choose = useEffectEvent((siteId: string | null, wellId: string | null) => onSelect(siteId, wellId));
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<readonly [GeographicXY, GeographicXY] | null>(null);
  const report = useEffectEvent((line: readonly [GeographicXY, GeographicXY] | null) => onSectionLineChange?.(line));
  const heads = useRef<readonly GeographicXY[]>([]);
  heads.current = sites.flatMap((site) => site.wells.map((well) => well.head));

  useEffect(() => {
    let cancelled = false, instance: GeographicMap | null = null, resize: ResizeObserver | null = null;
    setReady(false); setError(null);
    (async () => {
      const library = await import("maplibre-gl");
      if (cancelled || !element.current) return;
      library.setWorkerUrl(localUrl(workerUrl));
      library.setWorkerCount(1);
      const empty = { type: "FeatureCollection" as const, features: [] };
      const style: StyleSpecification = {
        version: 8,
        projection: { type: "globe" },
        sources: {
          graticule: { type: "geojson", data: graticule() },
          footprints: { type: "geojson", data: empty },
          paths: { type: "geojson", data: empty },
          // Clustered until zoom 10: a tenant's many wells read as counted groups, not a solid blot.
          heads: { type: "geojson", data: empty, cluster: true, clusterRadius: 36, clusterMaxZoom: 10 },
          section: { type: "geojson", data: empty },
        },
        layers: [{ id: "water", type: "background", paint: { "background-color": "#dce7ef" } }],
      };
      if (imageryUrl) {
        if (!imageryAttribution?.trim()) throw new TypeError("World imagery requires attribution.");
        style.sources.imagery = { type: "image", url: localUrl(imageryUrl), coordinates: [[-180, 85.0511], [180, 85.0511], [180, -85.0511], [-180, -85.0511]], ...(basemapUrl ? {} : { attribution: imageryAttribution }) } as typeof style.sources[string];
        style.layers.push({ id: "imagery", type: "raster", source: "imagery", paint: { "raster-opacity": ["interpolate", ["linear"], ["zoom"], 4, 1, 9, 0.35], "raster-fade-duration": 0 } });
      }
      if (basemapUrl) {
        if (!basemapAttribution?.trim()) throw new TypeError("A host basemap requires attribution.");
        style.sources.world = { type: "geojson", data: localUrl(basemapUrl), attribution: imageryUrl ? `${basemapAttribution} · ${imageryAttribution}` : basemapAttribution };
        style.layers.push(
          { id: "land", type: "fill", source: "world", filter: ["==", ["get", "kind"], "land"], paint: { "fill-color": "#f4f1ea", "fill-opacity": imageryUrl ? ["interpolate", ["linear"], ["zoom"], 4, 0, 9, 0.6] : 1 } },
          { id: "coast", type: "line", source: "world", filter: ["==", ["get", "kind"], "land"], paint: { "line-color": "#a7b3bd", "line-width": 0.8 } },
          { id: "borders", type: "line", source: "world", filter: ["==", ["get", "kind"], "border"], paint: { "line-color": "#c3b9a8", "line-width": 0.7, "line-dasharray": [3, 2] } },
        );
      }
      style.layers.push(
        { id: "graticule", type: "line", source: "graticule", paint: { "line-color": "#9fb2c2", "line-width": ["case", ["==", ["get", "equator"], true], 1, 0.5], "line-opacity": 0.55 } },
        { id: "footprint-fill", type: "fill", source: "footprints", minzoom: 8, paint: { "fill-color": "#5b7fa3", "fill-opacity": 0.12 } },
        { id: "footprint-line", type: "line", source: "footprints", minzoom: 8, paint: { "line-color": "#41698f", "line-width": 1.6, "line-dasharray": [4, 2] } },
        { id: "paths", type: "line", source: "paths", minzoom: 9, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["case", ["get", "selected"], "#c2410c", "#1f6fb2"], "line-width": ["case", ["get", "selected"], 4, 2.6] } },
        { id: "section-line", type: "line", source: "section", layout: { "line-cap": "round" }, paint: { "line-color": "#f59e0b", "line-width": 3, "line-dasharray": ["case", ["get", "draft"], ["literal", [2, 1.5]], ["literal", [1, 0]]] } },
        { id: "section-ends", type: "circle", source: "section", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 5, "circle-color": "#f59e0b", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5 } },
        { id: "head-clusters", type: "circle", source: "heads", filter: ["has", "point_count"], paint: {
          "circle-radius": ["step", ["get", "point_count"], 7, 10, 10, 100, 14, 1000, 19, 10000, 25],
          "circle-color": "#b45309", "circle-opacity": 0.82, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.4,
        } },
        { id: "heads", type: "circle", source: "heads", filter: ["!", ["has", "point_count"]], paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 4, 10, ["case", ["get", "selected"], 8, 6]],
          "circle-color": ["match", ["get", "provenance"], "documented", "#0f766e", "user-authored", "#1f6fb2", "#b45309"],
          "circle-stroke-color": ["case", ["get", "selected"], "#c2410c", "#ffffff"], "circle-stroke-width": ["case", ["get", "selected"], 3, 1.6],
        } },
      );
      instance = new library.Map({
        container: element.current, style, center: WORLD.center, zoom: WORLD.zoom, attributionControl: false, maxPitch: 60,
        transformRequest: (url) => ({ url: localUrl(url) }),
      });
      map.current = instance;
      instance.addControl(new library.NavigationControl({ visualizePitch: true }), "top-right");
      instance.addControl(new library.ScaleControl({ unit: "metric" }), "bottom-left");
      instance.addControl(new library.AttributionControl({ compact: true }), "bottom-right");
      instance.on("error", (event) => { if (!cancelled) setError(`Map error: ${event.error.message}`); });
      instance.on("mousemove", (event) => setCursor(`${event.lngLat.lat.toFixed(4)}°, ${event.lngLat.lng.toFixed(4)}°`));
      instance.on("mouseout", () => setCursor(null));
      instance.on("zoom", () => setZoom(instance!.getZoom()));
      instance.on("click", "heads", (event) => {
        const feature = event.features?.[0];
        if (feature) choose(String(feature.properties.siteId), String(feature.properties.wellId));
      });
      // A cluster opens by zooming in until it splits.
      instance.on("click", "head-clusters", (event) => {
        const feature = event.features?.[0];
        const source = instance!.getSource("heads") as GeoJSONSource;
        if (!feature || feature.geometry.type !== "Point") return;
        const at = feature.geometry.coordinates as [number, number];
        void source.getClusterExpansionZoom(Number(feature.properties.cluster_id)).then((zoom) => instance!.easeTo({ center: at, zoom: zoom + 0.5 }));
      });
      for (const layer of ["heads", "head-clusters"]) {
        instance.on("mouseenter", layer, () => { instance!.getCanvas().style.cursor = "pointer"; });
        instance.on("mouseleave", layer, () => { instance!.getCanvas().style.cursor = ""; });
      }
      instance.on("load", () => {
        if (cancelled) return;
        setReady(true);
        // The corner label already names the sources; the full credit stays one click away behind ⓘ.
        element.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
      });
      instance.getCanvas().setAttribute("aria-label", "World map of wells. Drag to pan, scroll to zoom. Choose a site from its label or from the list beside the map.");
      resize = new ResizeObserver(() => instance?.resize());
      resize.observe(element.current);
    })().catch((cause: unknown) => { if (!cancelled) setError(`The map could not start: ${cause instanceof Error ? cause.message : String(cause)}`); });
    return () => { cancelled = true; resize?.disconnect(); for (const marker of markers.current) marker.remove(); markers.current = []; instance?.remove(); map.current = null; };
  }, [workerUrl, basemapUrl, basemapAttribution, imageryUrl, imageryAttribution]);

  // Sites, wells and selection into the map's sources, and one labelled marker per site.
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    (instance.getSource("heads") as GeoJSONSource).setData({ type: "FeatureCollection", features: sites.flatMap((site) => site.wells.map((well) => ({
      type: "Feature" as const, properties: { siteId: site.id, wellId: well.id, provenance: site.provenance, selected: site.id === selectedSiteId && well.id === selectedWellId },
      geometry: { type: "Point" as const, coordinates: [...well.head] },
    }))) });
    (instance.getSource("paths") as GeoJSONSource).setData({ type: "FeatureCollection", features: sites.flatMap((site) => site.wells.filter((well) => (well.path?.length ?? 0) > 1).map((well) => ({
      type: "Feature" as const, properties: { selected: site.id === selectedSiteId && well.id === selectedWellId },
      geometry: { type: "LineString" as const, coordinates: well.path!.map((p) => [...p]) },
    }))) });
    (instance.getSource("footprints") as GeoJSONSource).setData({ type: "FeatureCollection", features: sites.flatMap((site) => (site.footprints ?? []).map((footprint) => ({
      type: "Feature" as const, properties: { label: footprint.label }, geometry: { type: "Polygon" as const, coordinates: [footprint.ring.map((p) => [...p])] },
    }))) });
  }, [ready, sites, selectedSiteId, selectedWellId]);

  // Labels as page elements, but only the ones in view. A tenant may list a thousand fields and
  // hundreds of thousands of wells; their heads are drawn on the GPU by the "heads" layer, and a
  // label is made only for a site or well on screen. Sites come first, up to 150. Wells' names show
  // from zoom 8, the nearest the centre first, up to 200. They are rebuilt when the map stops moving.
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    let cancelled = false, library: typeof import("maplibre-gl") | null = null;
    const anchors = sites.map((site) => { const [[w], [e, n]] = siteBounds(site); return { site, at: [(w + e) / 2, n] as [number, number] }; });
    const build = () => {
      if (cancelled || !library) return;
      for (const marker of markers.current) marker.remove();
      const bounds = instance.getBounds(), centre = instance.getCenter(), zoom = instance.getZoom();
      const inView = (at: readonly [number, number]) => bounds.contains(at as [number, number]);
      const near = (at: readonly [number, number]) => (at[0] - centre.lng) ** 2 + (at[1] - centre.lat) ** 2;
      const shownSites = anchors.filter((anchor) => anchor.site.id === selectedSiteId || inView(anchor.at))
        .sort((a, b) => Number(b.site.id === selectedSiteId) - Number(a.site.id === selectedSiteId) || near(a.at) - near(b.at)).slice(0, 150);
      markers.current = shownSites.map(({ site, at }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `sw-wells-map-site is-${site.provenance}${site.id === selectedSiteId ? " is-selected" : ""}`;
        button.setAttribute("aria-label", `${site.label}, ${site.provenance}. ${site.summary}`);
        const name = document.createElement("strong"); name.textContent = site.label;
        const detail = document.createElement("span"); detail.textContent = `${site.provenance} · ${site.summary}`;
        button.append(name, detail);
        button.addEventListener("click", (event) => { event.stopPropagation(); choose(site.id, null); });
        return new library!.Marker({ element: button, anchor: "bottom", offset: [0, -10] }).setLngLat(at).addTo(instance);
      });
      // The count on each cluster in view: the style carries no glyphs, so counts are page labels too, at most 80.
      const counted = new Set<number>();
      for (const feature of instance.querySourceFeatures("heads", { filter: ["has", "point_count"] })) {
        const id = Number(feature.properties.cluster_id);
        if (counted.has(id) || counted.size >= 80 || feature.geometry.type !== "Point") continue;
        const at = feature.geometry.coordinates as [number, number];
        if (!inView(at)) continue;
        counted.add(id);
        const count = document.createElement("span");
        count.className = "sw-wells-map-count";
        count.textContent = Number(feature.properties.point_count).toLocaleString("en-US");
        markers.current.push(new library!.Marker({ element: count, anchor: "center" }).setLngLat(at).addTo(instance));
      }
      // Each well's name beside its surface location, once the map is close enough to separate them.
      if (zoom >= 8) {
        const wells = sites.flatMap((site) => site.wells.filter((well) => inView(well.head)).map((well) => ({ site, well })))
          .sort((a, b) => Number(b.site.id === selectedSiteId && b.well.id === selectedWellId) - Number(a.site.id === selectedSiteId && a.well.id === selectedWellId) || near(a.well.head) - near(b.well.head)).slice(0, 200);
        for (const { site, well } of wells) {
          const tag = document.createElement("button");
          tag.type = "button";
          tag.className = `sw-wells-map-well${site.id === selectedSiteId && well.id === selectedWellId ? " is-selected" : ""}`;
          tag.textContent = well.label;
          tag.addEventListener("click", (event) => { event.stopPropagation(); choose(site.id, well.id); });
          markers.current.push(new library!.Marker({ element: tag, anchor: "left", offset: [10, 0] }).setLngLat([...well.head]).addTo(instance));
        }
      }
      declutter();
    };
    // Labels never sit on one another: after each redraw, a site or well label that would land on one
    // already placed (the selected site first, then sites before wells) is hidden until the map zooms in.
    let frame = 0;
    const declutter = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const placed: DOMRect[] = [];
        const order = [...markers.current].map((marker) => marker.getElement()).sort((a, b) => Number(b.classList.contains("is-selected")) - Number(a.classList.contains("is-selected")) || Number(b.classList.contains("sw-wells-map-count")) - Number(a.classList.contains("sw-wells-map-count")) || Number(b.classList.contains("sw-wells-map-site")) - Number(a.classList.contains("sw-wells-map-site")));
        for (const element of order) {
          element.style.display = "";
          const box = element.getBoundingClientRect();
          if (box.width === 0) continue;
          const hit = placed.some((other) => box.left < other.right - 1 && box.right > other.left + 1 && box.top < other.bottom - 1 && box.bottom > other.top + 1);
          // Out of the layout, not merely invisible: a hidden label must not count as a target that obscures its neighbour (WCAG 2.5.8).
          if (hit) element.style.display = "none"; else placed.push(box);
        }
      });
    };
    void import("maplibre-gl").then((loaded) => { library = loaded; build(); });
    // Clusters are made off the main thread after new data: their counts are labelled once they are in.
    const onData = (event: { sourceId?: string; isSourceLoaded?: boolean }) => { if (event.sourceId === "heads" && event.isSourceLoaded) build(); };
    instance.on("moveend", build);
    instance.on("move", declutter);
    // Marker positions settle with the last render; "idle" is when every one is where it will stay.
    instance.on("idle", declutter);
    instance.on("sourcedata", onData);
    return () => { cancelled = true; instance.off("moveend", build); instance.off("move", declutter); instance.off("idle", declutter); instance.off("sourcedata", onData); cancelAnimationFrame(frame); for (const marker of markers.current) marker.remove(); markers.current = []; };
  }, [ready, sites, selectedSiteId, selectedWellId]);

  // The host's cursor point: one marker, moved rather than rebuilt, so it can follow a pointer.
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    if (!depthCursor) { depthMarker.current?.marker.remove(); depthMarker.current = null; return; }
    if (depthMarker.current) {
      depthMarker.current.marker.setLngLat([...depthCursor.at]);
      depthMarker.current.text.textContent = depthCursor.label;
      return;
    }
    let cancelled = false;
    void import("maplibre-gl").then((library) => {
      if (cancelled || depthMarker.current) return;
      const dot = document.createElement("div");
      dot.className = "sw-wells-map-depth";
      const text = document.createElement("span");
      text.textContent = depthCursor.label;
      dot.append(text);
      depthMarker.current = { marker: new library.Marker({ element: dot, anchor: "center" }).setLngLat([...depthCursor.at]).addTo(instance), text };
    });
    return () => { cancelled = true; };
  }, [ready, depthCursor]);
  useEffect(() => () => { depthMarker.current?.marker.remove(); depthMarker.current = null; }, []);

  // Draw section: press, drag and release; the ends snap to a wellhead near the pointer.
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance || !drawing) return;
    const canvas = instance.getCanvas();
    const snap = (point: { x: number; y: number }, at: GeographicXY): GeographicXY => {
      let best: GeographicXY = at, distance = 14;
      for (const head of heads.current) { const p = instance.project([...head] as [number, number]); const d = Math.hypot(p.x - point.x, p.y - point.y); if (d < distance) { distance = d; best = head; } }
      return best;
    };
    let start: GeographicXY | null = null, startPoint: { x: number; y: number } | null = null;
    instance.dragPan.disable();
    canvas.style.cursor = "crosshair";
    type Pointer = { point: { x: number; y: number }; lngLat: { lng: number; lat: number } };
    const down = (event: Pointer) => { startPoint = event.point; start = snap(event.point, [event.lngLat.lng, event.lngLat.lat]); setDraft([start, start]); };
    const move = (event: Pointer) => { if (start) setDraft([start, snap(event.point, [event.lngLat.lng, event.lngLat.lat])]); };
    const up = (event: Pointer) => {
      if (!start || !startPoint) return;
      const from = start, end = snap(event.point, [event.lngLat.lng, event.lngLat.lat]);
      const long = Math.hypot(event.point.x - startPoint.x, event.point.y - startPoint.y) > 8;
      start = null; startPoint = null; setDraft(null);
      if (long) { report([from, end]); setDrawing(false); }
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !(event.target as Element | null)?.closest?.("input, textarea, select")) { start = null; setDraft(null); setDrawing(false); } };
    instance.on("mousedown", down); instance.on("mousemove", move); instance.on("mouseup", up);
    window.addEventListener("keydown", key);
    return () => {
      instance.off("mousedown", down); instance.off("mousemove", move); instance.off("mouseup", up);
      window.removeEventListener("keydown", key);
      instance.dragPan.enable(); canvas.style.cursor = "";
    };
  }, [ready, drawing]);

  // The section line (or the one being drawn) into its layer.
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    const line = draft ?? sectionLine;
    (instance.getSource("section") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: line ? [
      { type: "Feature" as const, properties: { draft: draft !== null }, geometry: { type: "LineString" as const, coordinates: line.map((p) => [...p]) } },
      ...line.map((p) => ({ type: "Feature" as const, properties: { draft: draft !== null }, geometry: { type: "Point" as const, coordinates: [...p] } })),
    ] : [] });
  }, [ready, draft, sectionLine]);

  // A chosen site flies into view; nothing chosen returns to the world.
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    const site = sites.find((entry) => entry.id === selectedSiteId);
    if (!site) { instance.flyTo({ center: WORLD.center, zoom: WORLD.zoom, pitch: 0, bearing: 0, essential: true, duration: 1600 }); return; }
    instance.fitBounds(siteBounds(site), { padding: { top: 90, bottom: 70, left: 70, right: 70 }, maxZoom: 13.5, duration: 2200, essential: true });
  }, [ready, selectedSiteId, sites]);

  useEffect(() => {
    if (!ready || !map.current) return;
    map.current.setProjection({ type: globe ? "globe" : "mercator" });
  }, [ready, globe]);

  // Paint from the theme's tokens, and again whenever the theme changes.
  useEffect(() => {
    const instance = map.current, host = element.current;
    if (!ready || !instance || !host) return;
    const apply = () => {
      const css = getComputedStyle(host);
      const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
      instance.setPaintProperty("water", "background-color", color("--sw-map-water", "#dce7ef"));
      if (instance.getLayer("land")) {
        instance.setPaintProperty("land", "fill-color", color("--sw-map-land", "#f4f1ea"));
        instance.setPaintProperty("coast", "line-color", color("--sw-map-coast", "#a7b3bd"));
        instance.setPaintProperty("borders", "line-color", color("--sw-map-border", "#c3b9a8"));
      }
      instance.setPaintProperty("graticule", "line-color", color("--sw-map-graticule", "#9fb2c2"));
    };
    apply();
    const observer = new MutationObserver(apply);
    const theme = host.closest("[data-sw-theme]");
    if (theme) observer.observe(theme, { attributes: true, attributeFilter: ["data-sw-theme"] });
    return () => observer.disconnect();
  }, [ready]);

  return <section className="sw-wells-map" aria-label="Wells map" data-testid="wells-map" data-ready={ready} data-selected-site={selectedSiteId ?? ""} data-zoomed={zoom > 8 ? "true" : undefined}>
    <div ref={element} className="sw-wells-map-canvas" />
    <div className="sw-scene-hud sw-wells-map-hud" role="toolbar" aria-label="Map view">
      <CommandButton icon="fit" disabled={!ready} onClick={() => { if (selectedSiteId === null) map.current?.flyTo({ center: WORLD.center, zoom: WORLD.zoom, pitch: 0, bearing: 0, duration: 1200 }); else choose(null, null); }}>World</CommandButton>
      <span className="sw-scene-hud-segment" role="group" aria-label="Projection">
        <CommandButton kind="selection" aria-pressed={globe} onClick={() => setGlobe(true)}>Globe</CommandButton>
        <CommandButton kind="selection" aria-pressed={!globe} onClick={() => setGlobe(false)}>Flat</CommandButton>
      </span>
      {onSectionLineChange && <span className="sw-scene-hud-segment" role="group" aria-label="Section">
        <CommandButton kind="selection" aria-pressed={drawing} disabled={!ready} onClick={() => setDrawing((value) => !value)}>{drawing ? "Drag a line… (Esc)" : "Draw section"}</CommandButton>
        {sectionLine && <CommandButton onClick={() => report(null)}>Clear</CommandButton>}
      </span>}
    </div>
    {error && <p role="alert" className="sw-wells-map-error">{error}</p>}
    {!ready && !error && <p role="status" className="sw-wells-map-status">Starting the map…</p>}
    <p className="sw-wells-map-cursor" aria-live="off">{cursor ? `${cursor} · WGS84` : basemapUrl ? `Basemap: ${basemapAttribution}${imageryUrl ? ` · imagery ${imageryAttribution}` : ""}` : imageryUrl ? `Imagery: ${imageryAttribution}` : "No basemap supplied: graticule only"}</p>
  </section>;
}
