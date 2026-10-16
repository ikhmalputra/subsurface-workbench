import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Eye, EyeOff, Trash2 } from "lucide-react";
import { forgeNeighbours, forgeSeismicSection, seismicImage, tvdToSeismicDepth } from "@ikhmalputra/subsurface-core";
import type { SeismicCube } from "@ikhmalputra/subsurface-core";
import { siteById, useForgeCube, useForgeVolume } from "../data/sites.ts";
import { useForgeTerrain, withoutFlatGround } from "../data/terrain.ts";
import { depthColour } from "../data/horizon-model.ts";
import type { Polarity } from "../data/horizon-model.ts";
import { addHorizon, depthsOf, gridOf, removeHorizon, surfaceOf, updateHorizon, useHorizons } from "../data/horizons.ts";
import type { Horizon } from "../data/horizons.ts";
import { fmt } from "../format.ts";
import { Loading } from "./Empty.tsx";
import { useSize } from "./useSize.ts";

/**
 * Horizons on the FORGE PSDM, picked in the site: click a reflector on any slice and the deck tracks
 * it through the volume, peak to peak (or trough to trough), as far as the waveform holds. The surface
 * appears in 3D coloured by depth, as a structure map with contours, and on the inline section; a
 * looser or stricter correlation re-tracks it at once. Horizons are kept in this browser and also
 * appear in Site in 3D.
 */

const cut = forgeSeismicSection.subVolume!;
const SiteScene = lazy(() => import("@ikhmalputra/subsurface-react/3d").then((module) => ({ default: module.SiteScene })));
type Slices = { readonly inline: number | null; readonly crossline: number | null; readonly depth: number | null };
const toBin = (value: number, from: number) => Math.max(0, Math.round((value - from) / cut.spacingM));

export function Horizons() {
  const site = siteById("forge");
  const { volume } = useForgeVolume(true);
  const { cube } = useForgeCube(true);
  const horizons = useHorizons();
  const terrain = useForgeTerrain(true);
  const [active, setActive] = useState<string | null>(horizons.at(-1)?.id ?? null);
  const [arming, setArming] = useState(horizons.length === 0);
  const [polarity, setPolarity] = useState<Polarity>("peak");
  const [slices, setSlices] = useState<Slices>({ inline: 0, crossline: 600, depth: null });
  const current = horizons.find((entry) => entry.id === active) ?? null;
  const grids = useMemo(() => cube ? new Map(horizons.map((entry) => [entry.id, gridOf(entry, cube)])) : new Map<string, Float32Array>(), [horizons, cube]);
  const surfaces = useMemo(() => !site ? [] : [...withoutFlatGround(site.surfaces.filter((surface) => surface.role === "reference"), terrain),
    ...horizons.filter((entry) => entry.visible && grids.has(entry.id)).map((entry) => surfaceOf(entry, grids.get(entry.id)!)).filter((surface) => surface !== null)], [site, horizons, grids, terrain]);

  /** A click on a slice: seeds a new horizon when arming, or moves the chosen one's seed. */
  const pick = (at: { alongM: number; offsetM: number; depthM: number }) => {
    const seed = { a: Math.min(cut.alongCount - 1, toBin(at.alongM, cut.alongFromM)), o: Math.min(cut.offsetCount - 1, toBin(at.offsetM, cut.offsetFromM)), s: tvdToSeismicDepth(at.depthM, forgeSeismicSection.rkbElevationM, forgeSeismicSection.seismicDatumElevationM) / cut.sampleIntervalM };
    if (arming || !current) { const made = addHorizon(seed, polarity); setActive(made.id); setArming(false); return; }
    updateHorizon(current.id, { seed });
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && arming && horizons.length) { event.preventDefault(); setArming(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [arming, horizons.length]);

  if (!site) return null;
  const grid = current ? grids.get(current.id) ?? null : null;
  const range = grid ? depthsOf(grid) : null;
  return <div className="hz">
    <header className="tie-bar hz-bar">
      <span className="tie-title"><b>Horizons · FORGE PSDM</b><small>click a reflector on any slice: it is tracked through the volume, trace to trace</small></span>
      <span className="log-sets" role="group" aria-label="What to follow">
        <button type="button" aria-pressed={(current?.polarity ?? polarity) === "peak"} onClick={() => current ? updateHorizon(current.id, { polarity: "peak" }) : setPolarity("peak")}>Peak</button>
        <button type="button" aria-pressed={(current?.polarity ?? polarity) === "trough"} onClick={() => current ? updateHorizon(current.id, { polarity: "trough" }) : setPolarity("trough")}>Trough</button>
      </span>
      {current && <label className="tie-slider">Correlation ≥ <b>{current.minCorrelation.toFixed(2)}</b><input id="hz-correlation" type="range" min={0.4} max={0.95} step={0.01} value={current.minCorrelation} onChange={(event) => updateHorizon(current.id, { minCorrelation: Number(event.target.value) })} /></label>}
      {current && <label className="tie-slider">Step ≤ <b>{current.search * cut.sampleIntervalM} m</b><input id="hz-search" type="range" min={1} max={6} step={1} value={current.search} onChange={(event) => updateHorizon(current.id, { search: Number(event.target.value) })} /></label>}
      <button type="button" className={`tie-button${arming ? " is-primary" : ""}`} aria-pressed={arming} onClick={() => setArming((on) => !on)}><Crosshair size={13} aria-hidden="true" />{arming ? "Click a reflector…" : "New horizon"}</button>
      {range && <span className="tie-r is-good">{Math.round(range.coverage * 100)}%<small>tracked</small></span>}
    </header>
    <div className="tie-stage hz-stage">
      <section className="tie-3d" aria-label="Horizons in the site" data-arming={arming || undefined}>
        {volume ? <Suspense fallback={<Loading>Starting the 3D site…</Loading>}>
          <SiteScene title="FORGE horizons" depthLabel={site.depthLabel} originLabel={site.originLabel} wells={site.wells} surfaces={surfaces}
            seismic={volume} seismicClip={forgeSeismicSection.section.p99AbsAmplitude} slices={slices} onSlicesChange={(next) => setSlices(next)} onSeismicPick={pick} terrain={terrain} />
        </Suspense> : <Loading>Loading the PSDM volume…</Loading>}
        {arming && <p className="hz-hint">Click a peak or trough on a slice to seed a horizon{horizons.length ? " · Esc to stop" : ""}</p>}
      </section>
      <aside className="tie-side hz-side">
        <HorizonList horizons={horizons} grids={grids} active={active} onActive={setActive} />
        {cube && grid && current && <StructureMap horizon={current} grid={grid} slices={slices} />}
        {cube && <Section cube={cube} offsetM={slices.inline ?? 0} horizons={horizons} grids={grids} active={active} onPick={pick} />}
      </aside>
    </div>
    <p className="petro-note">
      Seismic: {forgeSeismicSection.attribution} Tracking follows the nearest {current?.polarity ?? polarity} within the step allowed, taking the steps whose waveform (±25 m) correlates best first; where nothing correlates enough, the horizon stops.
      It is your interpretation, kept in this browser; it is not a mapped surface from FORGE.
    </p>
  </div>;
}

function HorizonList({ horizons, grids, active, onActive }: { readonly horizons: readonly Horizon[]; readonly grids: ReadonlyMap<string, Float32Array>; readonly active: string | null; readonly onActive: (id: string) => void }) {
  if (!horizons.length) return <p className="hz-empty">No horizons yet. Click a reflector on a slice in 3D, or on the section below.</p>;
  return <ul className="hz-list">
    {horizons.map((entry) => {
      const grid = grids.get(entry.id), range = grid ? depthsOf(grid) : null;
      return <li key={entry.id} data-active={entry.id === active || undefined} onClick={() => onActive(entry.id)}>
        <i style={{ background: entry.colour }} />
        <input id={`hz-name-${entry.id}`} value={entry.name} aria-label="Horizon name" onChange={(event) => updateHorizon(entry.id, { name: event.target.value })} onClick={(event) => event.stopPropagation()} />
        <small>{range && Number.isFinite(range.lo) ? `${Math.round(range.coverage * 100)}% · ${fmt(range.lo)}–${fmt(range.hi)} m` : "not tracked"}</small>
        <button type="button" className="cor-icon" aria-label={entry.visible ? `Hide ${entry.name}` : `Show ${entry.name}`} onClick={(event) => { event.stopPropagation(); updateHorizon(entry.id, { visible: !entry.visible }); }}>{entry.visible ? <Eye size={12} /> : <EyeOff size={12} />}</button>
        <button type="button" className="cor-icon" aria-label={`Delete ${entry.name}`} onClick={(event) => { event.stopPropagation(); removeHorizon(entry.id); }}><Trash2 size={12} /></button>
      </li>;
    })}
  </ul>;
}

/** The active horizon from above: depth-coloured on the volume's grid, contoured every 25 m, with the wells and the slices. */
function StructureMap({ horizon, grid, slices }: { readonly horizon: Horizon; readonly grid: Float32Array; readonly slices: Slices }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, size] = useSize<HTMLDivElement>();
  const { lo, hi } = depthsOf(grid);
  const W = Math.max(200, size.width), H = Math.round(W * cut.offsetCount / cut.alongCount * 1.15);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    element.width = cut.alongCount; element.height = cut.offsetCount;
    const context = element.getContext("2d")!;
    const image = context.createImageData(cut.alongCount, cut.offsetCount);
    // Contours come from the grid smoothed over 5 × 5 traces: the tracked half-sample jitter would otherwise cross every line.
    const smooth = new Float32Array(grid.length).fill(NaN);
    for (let o = 0; o < cut.offsetCount; o++) for (let a = 0; a < cut.alongCount; a++) {
      if (Number.isNaN(grid[o * cut.alongCount + a]!)) continue;
      let sum = 0, n = 0;
      for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const oo = o + j, aa = a + i; if (oo < 0 || aa < 0 || oo >= cut.offsetCount || aa >= cut.alongCount) continue; const v = grid[oo * cut.alongCount + aa]!; if (!Number.isNaN(v)) { sum += v; n++; } }
      smooth[o * cut.alongCount + a] = sum / n;
    }
    for (let o = 0; o < cut.offsetCount; o++) for (let a = 0; a < cut.alongCount; a++) {
      const s = grid[o * cut.alongCount + a]!, at = ((cut.offsetCount - 1 - o) * cut.alongCount + a) * 4;
      if (Number.isNaN(s)) { image.data[at + 3] = 0; continue; }
      const depth = s * cut.sampleIntervalM, [r, g, b] = depthColour((depth - lo) / Math.max(1, hi - lo));
      // Contours every 25 m: a darker line where the depth crosses one.
      const here = smooth[o * cut.alongCount + a]! * cut.sampleIntervalM;
      const right = a + 1 < cut.alongCount ? smooth[o * cut.alongCount + a + 1] : undefined, up = o + 1 < cut.offsetCount ? smooth[(o + 1) * cut.alongCount + a] : undefined;
      const crosses = [right, up].some((other) => other !== undefined && !Number.isNaN(other) && Math.floor(other * cut.sampleIntervalM / 25) !== Math.floor(here / 25));
      const k = crosses ? 0.45 : 1;
      image.data[at] = r * 255 * k; image.data[at + 1] = g * 255 * k; image.data[at + 2] = b * 255 * k; image.data[at + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }, [grid, lo, hi]);
  // Map frame: along to the right, offset up, as the volume's grid lies; the arrow shows where north is.
  const x = (along: number) => (along - cut.alongFromM + cut.spacingM / 2) / (cut.alongCount * cut.spacingM) * W;
  const y = (offset: number) => H - (offset - cut.offsetFromM + cut.spacingM / 2) / (cut.offsetCount * cut.spacingM) * H;
  const az = cut.azimuthDeg * Math.PI / 180;
  const wellAt = (e: number, n: number) => ({ along: e * Math.sin(az) + n * Math.cos(az), offset: e * Math.cos(az) - n * Math.sin(az) });
  const heads = [{ id: "16A", e: 0, n: 0 }, ...forgeNeighbours.map((well) => ({ id: well.label.split(" ")[0]!, e: well.eastingM - forgeSeismicSection.wellhead.eastingM, n: well.northingM - forgeSeismicSection.wellhead.northingM }))];
  return <figure className="hz-map" ref={box}>
    <figcaption><b>{horizon.name}</b><span>structure · contours every 25 m</span></figcaption>
    <div className="hz-map-stage" style={{ height: H }}>
      <canvas ref={canvas} style={{ width: W, height: H }} />
      <svg width={W} height={H}>
        {slices.inline !== null && <line className="hz-map-slice" x1={0} x2={W} y1={y(slices.inline)} y2={y(slices.inline)} />}
        {slices.crossline !== null && <line className="hz-map-slice" x1={x(slices.crossline)} x2={x(slices.crossline)} y1={0} y2={H} />}
        {heads.map((head) => { const p = wellAt(head.e, head.n); return <g key={head.id} transform={`translate(${x(p.along)},${y(p.offset)})`}><circle r={4} /><text x={6} y={-5}>{head.id}</text></g>; })}
        <g transform={`translate(${W - 16},18) rotate(${cut.azimuthDeg + 90})`} className="hz-map-north"><path d="M0,-9 L4,4 L0,1 L-4,4 Z" /></g>
      </svg>
    </div>
    <div className="hz-ramp"><span>{fmt(lo)} m</span><i style={{ background: `linear-gradient(90deg, ${[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => `rgb(${depthColour(t).map((v) => Math.round(v * 255)).join(",")})`).join(", ")})` }} /><span>{fmt(hi)} m below datum</span></div>
  </figure>;
}

/** The inline under the 3D inline slice, with every horizon drawn on it; a click here seeds too. */
function Section({ cube, offsetM, horizons, grids, active, onPick }: {
  readonly cube: SeismicCube; readonly offsetM: number; readonly horizons: readonly Horizon[]; readonly grids: ReadonlyMap<string, Float32Array>; readonly active: string | null;
  readonly onPick: (at: { alongM: number; offsetM: number; depthM: number }) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, size] = useSize<HTMLDivElement>();
  const o = Math.min(cut.offsetCount - 1, toBin(offsetM, cut.offsetFromM));
  const [top, base] = [80, 400];
  const W = Math.max(200, size.width), H = Math.max(160, size.height - 22);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const data = new Float32Array(cut.alongCount * (base - top));
    for (let a = 0; a < cut.alongCount; a++) for (let s = top; s < base; s++) data[a * (base - top) + s - top] = cube.counts[(s * cut.offsetCount + o) * cut.alongCount + a]! * cube.amplitudePerCount;
    const image = seismicImage({ traceCount: cut.alongCount, sampleCount: base - top, data }, { colorMap: "grey", clip: forgeSeismicSection.section.p99AbsAmplitude });
    element.width = image.width; element.height = image.height;
    // One column per trace, one row per sample: the canvas's own layout.
    const out = element.getContext("2d")!.createImageData(image.width, image.height);
    out.data.set(image.data);
    element.getContext("2d")!.putImageData(out, 0, 0);
  }, [cube, o]);
  const x = (a: number) => (a + 0.5) / cut.alongCount * W, y = (s: number) => (s - top) / (base - top) * H;
  return <figure className="hz-section" ref={box}>
    <figcaption><b>Inline at {fmt(offsetM)} m</b><span>follows the 3D inline slice · click a reflector to seed</span></figcaption>
    <div className="hz-section-stage" style={{ height: H }} onClick={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const a = (event.clientX - rect.left) / W * cut.alongCount - 0.5, s = top + (event.clientY - rect.top) / H * (base - top);
      onPick({ alongM: cut.alongFromM + a * cut.spacingM, offsetM, depthM: s * cut.sampleIntervalM - forgeSeismicSection.seismicDatumElevationM + forgeSeismicSection.rkbElevationM });
    }}>
      <canvas ref={canvas} style={{ width: W, height: H }} />
      <svg width={W} height={H}>
        {horizons.filter((entry) => entry.visible).map((entry) => {
          const grid = grids.get(entry.id);
          if (!grid) return null;
          let d = "", open = false;
          for (let a = 0; a < cut.alongCount; a++) { const s = grid[o * cut.alongCount + a]!; if (Number.isNaN(s)) { open = false; continue; } d += `${open ? "L" : "M"}${x(a).toFixed(1)},${y(s).toFixed(1)}`; open = true; }
          return <path key={entry.id} d={d} stroke={entry.colour} className="hz-section-line" data-active={entry.id === active || undefined} />;
        })}
        {[100, 200, 300].map((s) => <text key={s} x={4} y={y(s) - 3} className="hz-section-tick">{fmt(s * cut.sampleIntervalM)} m</text>)}
      </svg>
    </div>
  </figure>;
}
