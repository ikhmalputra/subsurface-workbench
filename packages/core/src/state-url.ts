import { createInitialSubsurfaceState, createSubsurfaceStore } from "./state.ts";
import type { MdWindow, SpatialXYZ, SubsurfaceState, SubsurfaceStore, Unsubscribe } from "./state.ts";

const fields = ["v", "well", "component", "md", "xyz", "inline", "crossline", "depth", "camera", "target", "zoom", "window", "linked", "planeOrigin", "planeNormal", "logCurve", "logMode", "logDomain", "logRadius"] as const;

/** Owns only prefixed query keys; unrelated query parameters and the hash are preserved. */
export function stateToUrl(state: SubsurfaceState, input: string | URL, prefix = "sw."): URL {
  if (!prefix.trim()) throw new TypeError("URL state prefix must be non-empty.");
  validateUrlState(state);
  const url = new URL(input);
  for (const key of [...url.searchParams.keys()]) if (key.startsWith(prefix)) url.searchParams.delete(key);
  const put = (key: string, value: string | number | readonly number[] | null) => {
    if (value !== null) url.searchParams.set(prefix + key, Array.isArray(value) ? value.join(",") : String(value));
  };
  put("v", 1); put("well", state.activeAsset.wellId); put("component", state.activeAsset.componentId);
  // Hover is transient; share the explicitly picked MD instead of pointer noise.
  put("md", state.depthLink.pinnedMdM); put("xyz", state.activeAsset.spatial_xyz);
  put("inline", state.seismicSlices.inline); put("crossline", state.seismicSlices.crossline); put("depth", state.seismicSlices.time_depth);
  put("camera", state.viewState.position); put("target", state.viewState.target); put("zoom", state.viewState.zoom);
  put("window", state.depthLink.window); put("linked", state.depthLink.linked ? 1 : 0);
  const interpretation = state.interpretation;
  if (interpretation?.slicePlane) { put("planeOrigin", interpretation.slicePlane.origin); put("planeNormal", interpretation.slicePlane.normal); }
  if (interpretation?.logStyle) { const log = interpretation.logStyle; put("logCurve", log.curveId); put("logMode", log.mode); put("logDomain", log.domain); put("logRadius", log.radiusRange); }
  return url;
}

/** Returns null when this URL contains no SDK state. Invalid/unsupported links throw. */
export function stateFromUrl(input: string | URL, prefix = "sw."): SubsurfaceState | null {
  if (!prefix.trim()) throw new TypeError("URL state prefix must be non-empty.");
  const url = new URL(input);
  const params = url.searchParams;
  if (![...params.keys()].some((key) => key.startsWith(prefix))) return null;
  for (const key of params.keys()) {
    if (!key.startsWith(prefix)) continue;
    if (!fields.some((field) => prefix + field === key)) throw new TypeError(`Unknown state URL parameter: ${key}`);
    if (params.getAll(key).length !== 1) throw new TypeError(`Duplicate state URL parameter: ${key}`);
  }
  if (params.get(prefix + "v") !== "1") throw new TypeError("Unsupported state URL version.");
  const num = (key: string): number | null => {
    const raw = params.get(prefix + key);
    if (raw === null) return null;
    if (!raw.trim() || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)) throw new TypeError(`Invalid numeric state URL parameter: ${key}`);
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new TypeError(`Non-finite state URL parameter: ${key}`);
    return value;
  };
  const tuple = (key: string, length: number): number[] | null => {
    const raw = params.get(prefix + key);
    if (raw === null) return null;
    const values = raw.split(",").map((part) => {
      if (!part.trim() || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(part) || !Number.isFinite(Number(part))) throw new TypeError(`Invalid vector state URL parameter: ${key}`);
      return Number(part);
    });
    if (values.length !== length) throw new TypeError(`Invalid vector length for state URL parameter: ${key}`);
    return values;
  };
  const xyz = (key: string): SpatialXYZ | null => { const value = tuple(key, 3); return value ? [value[0]!, value[1]!, value[2]!] : null; };
  const initial = createInitialSubsurfaceState();
  const md = num("md");
  const range = tuple("window", 2);
  const window: MdWindow | null = range ? [range[0]!, range[1]!] : null;
  const linked = num("linked");
  const origin = xyz("planeOrigin"), normal = xyz("planeNormal");
  if ((origin === null) !== (normal === null)) throw new TypeError("Slice link requires both planeOrigin and planeNormal.");
  const curveId = params.get(prefix + "logCurve"), mode = params.get(prefix + "logMode");
  const domain = tuple("logDomain", 2), radius = tuple("logRadius", 2);
  const hasLog = [curveId, mode, domain, radius].some((v) => v !== null);
  if (hasLog && (curveId === null || (mode !== "color" && mode !== "radius" && mode !== "color-radius") || !domain || !radius)) throw new TypeError("Log link requires curve, mode, domain and radius range.");
  if (linked !== null && linked !== 0 && linked !== 1) throw new TypeError("State URL linked must be 0 or 1.");
  const next: SubsurfaceState = {
    ...initial,
    activeAsset: { wellId: params.get(prefix + "well"), componentId: params.get(prefix + "component"), depth_md: md, spatial_xyz: xyz("xyz") },
    seismicSlices: { inline: num("inline"), crossline: num("crossline"), time_depth: num("depth") },
    viewState: { position: xyz("camera") ?? initial.viewState.position, target: xyz("target") ?? initial.viewState.target, zoom: num("zoom") ?? 1 },
    depthLink: { linked: linked === null || linked === 1, window, pinnedMdM: md, hoverMdM: null },
    ...(origin || hasLog ? { interpretation: {
      slicePlane: origin && normal ? { origin, normal } : null,
      logStyle: curveId && (mode === "color" || mode === "radius" || mode === "color-radius") && domain && radius ? { curveId, mode, domain: [domain[0]!, domain[1]!] as const, radiusRange: [radius[0]!, radius[1]!] as const } : null,
    } } : {}),
  };
  // Share the same invariant checks as regular publishing.
  return validateUrlState(next);
}

function validateUrlState(next: SubsurfaceState) { return createSubsurfaceStore(next).getState(); }

export interface StateUrlHost {
  readonly read: () => string;
  readonly replace: (url: string) => void;
  readonly onPopState: (listener: () => void) => Unsubscribe;
}

/** Browser host is created only on explicit invocation, making package imports SSR-safe. */
export function browserStateUrlHost(): StateUrlHost {
  if (typeof window === "undefined") throw new Error("URL synchronization requires a browser or an explicit StateUrlHost.");
  return {
    read: () => window.location.href,
    replace: (url) => window.history.replaceState(window.history.state, "", url),
    onPopState: (listener) => { window.addEventListener("popstate", listener); return () => window.removeEventListener("popstate", listener); },
  };
}

/** Hydrates first, then debounces replaceState writes. Errors are always reported to the host. */
export function syncStateToUrl(store: SubsurfaceStore, options: {
  readonly onError: (error: unknown) => void;
  readonly host?: StateUrlHost;
  readonly prefix?: string;
  readonly debounceMs?: number;
  /** Host-level asset/frame checks, applied before a URL snapshot replaces current state. */
  readonly validateState?: (state: SubsurfaceState) => void;
  /** Optional host defaults for navigating back to an unversioned URL (e.g. a legacy ?well= link). */
  readonly fallbackState?: () => SubsurfaceState;
}): Unsubscribe {
  const host = options.host ?? browserStateUrlHost();
  const prefix = options.prefix ?? "sw.";
  const delay = options.debounceMs ?? 150;
  if (!prefix.trim()) throw new TypeError("URL state prefix must be non-empty.");
  if (!Number.isFinite(delay) || delay < 0) throw new RangeError("URL debounce must be finite and non-negative.");
  let applying = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    applying = true;
    try {
      const next = stateFromUrl(host.read(), prefix);
      if (next) { options.validateState?.(next); store.hydrate(next, "url"); }
      else {
        const fallback = options.fallbackState?.() ?? createInitialSubsurfaceState();
        options.validateState?.(fallback);
        store.hydrate(fallback, "url");
      }
    } catch (error) { options.onError(error); } finally { applying = false; }
  };
  // An unversioned initial URL must not clear the host's selected well.
  try { const initial = stateFromUrl(host.read(), prefix); if (initial) { options.validateState?.(initial); store.hydrate(initial, "url"); } } catch (error) { options.onError(error); }
  const unsubscribe = store.subscribe((event) => {
    if (applying || event.type === "depth-hover") return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      try { const url = stateToUrl(store.getState(), host.read(), prefix).href; if (url !== host.read()) host.replace(url); } catch (error) { options.onError(error); }
    }, delay);
  });
  const offPop = host.onPopState(read);
  return () => { unsubscribe(); offPop(); if (timer !== undefined) clearTimeout(timer); };
}
