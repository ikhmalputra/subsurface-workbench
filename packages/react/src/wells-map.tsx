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
  readonly selectedSiteId: string | null;
  readonly selectedWellId: string | null;
  /** A site (and well) chosen on the map; null when the reader returns to the world view. */
  readonly onSelect: (siteId: string | null, wellId: string | null) => void;
  /**
   * A point on a well to mark, such as where a linked depth cursor sits on the well's path in plan,
   * with the words to show beside it. The host places it; the map does not interpolate paths.
   */
  readonly cursor?: { readonly at: GeographicXY; readonly label: string } | null;
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

export function WellsMap({ sites, workerUrl, basemapUrl, basemapAttribution, selectedSiteId, selectedWellId, onSelect, cursor: depthCursor = null }: WellsMapProps) {
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
          heads: { type: "geojson", data: empty },
        },
        layers: [{ id: "water", type: "background", paint: { "background-color": "#dce7ef" } }],
      };
      if (basemapUrl) {
        if (!basemapAttribution?.trim()) throw new TypeError("A host basemap requires attribution.");
        style.sources.world = { type: "geojson", data: localUrl(basemapUrl), attribution: basemapAttribution };
        style.layers.push(
          { id: "land", type: "fill", source: "world", filter: ["==", ["get", "kind"], "land"], paint: { "fill-color": "#f4f1ea" } },
          { id: "coast", type: "line", source: "world", filter: ["==", ["get", "kind"], "land"], paint: { "line-color": "#a7b3bd", "line-width": 0.8 } },
          { id: "borders", type: "line", source: "world", filter: ["==", ["get", "kind"], "border"], paint: { "line-color": "#c3b9a8", "line-width": 0.7, "line-dasharray": [3, 2] } },
        );
      }
      style.layers.push(
        { id: "graticule", type: "line", source: "graticule", paint: { "line-color": "#9fb2c2", "line-width": ["case", ["==", ["get", "equator"], true], 1, 0.5], "line-opacity": 0.55 } },
        { id: "footprint-fill", type: "fill", source: "footprints", minzoom: 8, paint: { "fill-color": "#5b7fa3", "fill-opacity": 0.12 } },
        { id: "footprint-line", type: "line", source: "footprints", minzoom: 8, paint: { "line-color": "#41698f", "line-width": 1.6, "line-dasharray": [4, 2] } },
        { id: "paths", type: "line", source: "paths", minzoom: 9, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["case", ["get", "selected"], "#c2410c", "#1f6fb2"], "line-width": ["case", ["get", "selected"], 4, 2.6] } },
        { id: "heads", type: "circle", source: "heads", paint: {
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
      instance.on("mouseenter", "heads", () => { instance!.getCanvas().style.cursor = "pointer"; });
      instance.on("mouseleave", "heads", () => { instance!.getCanvas().style.cursor = ""; });
      instance.on("load", () => { if (!cancelled) setReady(true); });
      instance.getCanvas().setAttribute("aria-label", "World map of wells. Drag to pan, scroll to zoom. Choose a site from its label or from the list beside the map.");
      resize = new ResizeObserver(() => instance?.resize());
      resize.observe(element.current);
    })().catch((cause: unknown) => { if (!cancelled) setError(`The map could not start: ${cause instanceof Error ? cause.message : String(cause)}`); });
    return () => { cancelled = true; resize?.disconnect(); for (const marker of markers.current) marker.remove(); markers.current = []; instance?.remove(); map.current = null; };
  }, [workerUrl, basemapUrl, basemapAttribution]);

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

  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    let cancelled = false;
    void import("maplibre-gl").then((library) => {
      if (cancelled) return;
      for (const marker of markers.current) marker.remove();
      markers.current = sites.map((site) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `sw-wells-map-site is-${site.provenance}${site.id === selectedSiteId ? " is-selected" : ""}`;
        button.setAttribute("aria-label", `${site.label}, ${site.provenance}. ${site.summary}`);
        const name = document.createElement("strong"); name.textContent = site.label;
        const detail = document.createElement("span"); detail.textContent = `${site.provenance} · ${site.summary}`;
        button.append(name, detail);
        button.addEventListener("click", (event) => { event.stopPropagation(); choose(site.id, null); });
        const [[w], [e, n]] = siteBounds(site);
        return new library.Marker({ element: button, anchor: "bottom", offset: [0, -10] }).setLngLat([(w + e) / 2, n]).addTo(instance);
      });
      // Each well's name beside its surface location, shown once the map is close enough to separate them.
      for (const site of sites) for (const well of site.wells) {
        const tag = document.createElement("button");
        tag.type = "button";
        tag.className = `sw-wells-map-well${site.id === selectedSiteId && well.id === selectedWellId ? " is-selected" : ""}`;
        tag.textContent = well.label;
        tag.addEventListener("click", (event) => { event.stopPropagation(); choose(site.id, well.id); });
        markers.current.push(new library.Marker({ element: tag, anchor: "left", offset: [10, 0] }).setLngLat([...well.head]).addTo(instance));
      }
    });
    return () => { cancelled = true; };
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
    </div>
    {error && <p role="alert" className="sw-wells-map-error">{error}</p>}
    {!ready && !error && <p role="status" className="sw-wells-map-status">Starting the map…</p>}
    <p className="sw-wells-map-cursor" aria-live="off">{cursor ? `${cursor} · WGS84` : basemapUrl ? `Basemap: ${basemapAttribution}` : "No basemap supplied: graticule only"}</p>
  </section>;
}
