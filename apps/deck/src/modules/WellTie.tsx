import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { scaleLinear } from "d3-scale";
import { Crosshair, RotateCcw } from "lucide-react";
import { amplitudeClip, forgeNeighbours, forgeSeismicSection, mdAtSurveyTvd } from "@ikhmalputra/subsurface-core";
import type { SeismicCube } from "@ikhmalputra/subsurface-core";
import { BASE } from "../base.ts";
import { useFetched } from "../data/fetch.ts";
import { useForgeTerrain, withoutFlatGround } from "../data/terrain.ts";
import { siteById, useForgeCube, useForgeVolume } from "../data/sites.ts";
import { bestFit, correlation, impedance, onSeismic, placed, reflectivity, synthetic, twoWayTime } from "../data/tie-model.ts";
import type { Fit } from "../data/tie-model.ts";
import { fmt } from "../format.ts";
import { Loading } from "./Empty.tsx";
import { useSize } from "./useSize.ts";
import { useWire } from "./wire.ts";

/**
 * Well tie at Utah FORGE 58-32 (MU-ESW1), the one FORGE well with sonic and density across the
 * granite contact, inside the PSDM volume. The tie happens in the site: the volume's slices are cut
 * through 58-32 and the synthetic is spliced into the inline slice as a band down the well, moving as
 * it is tied. Beside it, the plan and the log tracks. Drag the synthetic onto the event you believe,
 * and Fit refines the shift and stretch nearby, scored by correlation inside the tie window.
 * The correlation against shift is drawn too, so a second cycle that also fits is in plain sight.
 * Depth is the PSDM's: metres below its 1,800 m datum. The deck's cursor follows at the same level in 16A.
 */

interface TieFile { readonly topMdM: number; readonly stepM: number; readonly n: number; readonly source: string; readonly curves: Readonly<Record<"DTCO" | "RHOZ" | "GR" | "HCAL", { readonly values: readonly (number | null)[] }>> }
const parse = (buffer: ArrayBuffer) => JSON.parse(new TextDecoder().decode(buffer)) as TieFile;
const well = forgeNeighbours.find((entry) => entry.id === "58-32")!;
const cut = forgeSeismicSection.subVolume!;
const DATUM = forgeSeismicSection.seismicDatumElevationM;
const asArray = (values: readonly (number | null)[]) => Float64Array.from(values, (value) => value ?? NaN);

/** 58-32 in the section's frame: along the 16A section azimuth from 16A's planned wellhead, and to the right of it. */
const frame = (() => {
  const az = cut.azimuthDeg * Math.PI / 180, de = well.eastingM - forgeSeismicSection.wellhead.eastingM, dn = well.northingM - forgeSeismicSection.wellhead.northingM;
  return { alongM: de * Math.sin(az) + dn * Math.cos(az), offsetM: de * Math.cos(az) - dn * Math.sin(az) };
})();
/** TVD at an MD on 58-32's survey, linear between stations. */
function tvdAt(md: number) {
  const s = well.stations;
  for (let i = 1; i < s.length; i++) if (md <= s[i]!.mdM) { const t = (md - s[i - 1]!.mdM) / (s[i]!.mdM - s[i - 1]!.mdM || 1); return s[i - 1]!.tvdM + t * (s[i]!.tvdM - s[i - 1]!.tvdM); }
  const last = s.at(-1)!; return last.tvdM + (md - last.mdM);
}
/** The PSDM's depth for a TVD in 58-32: below the seismic datum, not the KB. */
const toSeismic = (tvd: number) => tvd + DATUM - well.depthZeroElevationM;

const TRACKS = [
  { key: "GR", label: "GR", unit: "gAPI", min: 0, max: 300, colour: "#a3e635" },
  { key: "DTCO", label: "Sonic", unit: "µs/ft", min: 140, max: 40, colour: "#c084fc" },
  { key: "RHOZ", label: "Density", unit: "g/cm³", min: 2.2, max: 2.9, colour: "#f472b6" },
  { key: "AI", label: "Impedance", unit: "10⁶ kg/m²s", min: 4, max: 18, colour: "#fb923c" },
] as const;

export function WellTie() {
  const wire = useWire("tie");
  const { value: file, error } = useFetched(`${BASE}data/forge-58-32-tie.json`, parse);
  const { cube, loading: cubeLoading } = useForgeCube(true);
  const site = siteById("forge");
  const { volume } = useForgeVolume(true);
  const [hoverMd, setHoverMd] = useState<number | null>(null);
  const [hz, setHz] = useState(25);
  const [polarity, setPolarity] = useState<1 | -1>(1);
  const [fit, setFitState] = useState<Fit>({ shiftM: 0, stretch: 1 });
  const [window_, setWindow] = useState<readonly [number, number]>([950, 1450]);
  const [lastFit, setLastFit] = useState<number | null>(null);
  const setFit = (next: Fit) => { setFitState({ shiftM: Math.round(next.shiftM * 10) / 10, stretch: Math.round(next.stretch * 1000) / 1000 }); setLastFit(null); };

  const logs = useMemo(() => {
    if (!file) return null;
    const md = Float64Array.from({ length: file.n }, (_, k) => file.topMdM + k * file.stepM);
    const tvd = Float64Array.from(md, tvdAt);
    const depth = Float64Array.from(tvd, toSeismic);
    const dt = asArray(file.curves.DTCO.values), rho = asArray(file.curves.RHOZ.values);
    const ai = impedance(dt, rho);
    return { md, tvd, depth, dt, rho, gr: asArray(file.curves.GR.values), ai, rc: reflectivity(ai), twt: twoWayTime(tvd, dt) };
  }, [file]);
  const syn = useMemo(() => logs ? synthetic(logs.rc, logs.twt, hz, polarity) : null, [logs, hz, polarity]);
  // The PSDM at the well and the bins either side of it along the section, every 5 m below the datum.
  const at = useMemo(() => Float64Array.from({ length: cut.samples }, (_, s) => s * cut.sampleIntervalM), []);
  const traces = useMemo(() => cube ? [-2, -1, 0, 1, 2].map((k) => traceAt(cube, frame.alongM + k * cut.spacingM, frame.offsetM)) : null, [cube]);
  const inWindow = useMemo(() => traces && logs ? Float64Array.from(traces[2]!, (value, s) => at[s]! >= window_[0] && at[s]! <= window_[1] && at[s]! >= logs.depth[0]! && at[s]! <= logs.depth.at(-1)! ? value : NaN) : null, [traces, logs, window_, at]);
  const r = syn && logs && inWindow ? correlation(onSeismic(syn, logs.depth, at, fit), inWindow) : NaN;
  // Correlation against shift at the current stretch: every cycle that could tie, in one curve.
  const scan = useMemo(() => syn && logs && inWindow ? Array.from({ length: 161 }, (_, i) => ({ shiftM: i - 80, r: correlation(onSeismic(syn, logs.depth, at, { shiftM: i - 80, stretch: fit.stretch }), inWindow) })) : null, [syn, logs, inWindow, at, fit.stretch]);
  const fitHere = () => {
    if (!syn || !logs || !inWindow) return;
    const best = bestFit(syn, logs.depth, inWindow, at, { shiftM: 15, stretch: 0.03 }, fit);
    setFitState({ shiftM: best.shiftM, stretch: best.stretch });
    setLastFit(best.r);
  };

  if (error) return <p className="tie-note">The 58-32 logs could not load: {error}</p>;
  if (!logs || !syn) return <Loading>Loading 58-32&apos;s logs…</Loading>;
  // The largest impedance increase in the logs, smoothed over 10 m the way a wavelet sees it: at 58-32, the granite contact.
  const step = logs.rc.reduce((best, _, k) => { let sum = 0; for (let j = -10; j <= 10; j++) sum += logs.rc[k + j] ?? 0; return sum > best.size ? { k, size: sum } : best; }, { k: 0, size: 0 });
  const contact = { depth: placed(logs.depth[step.k]!, logs.depth[0]!, fit), md: logs.md[step.k]! };
  // The synthetic as the site draws it: down 58-32 at each log MD moved by the tie, full colour at its 75th percentile, so the ordinary swings read as strongly as the seismic's.
  const pScale = Array.from(syn, Math.abs).filter(Number.isFinite).sort((x, y) => x - y)[Math.floor(syn.length * 0.75)] || 1;
  return <div className="tie">
    <header className="tie-bar">
      <span className="tie-title"><b>Well tie · 58-32 (MU-ESW1)</b><small>sonic and density across the granite contact, inside the PSDM volume</small></span>
      <label className="tie-slider">Wavelet <b>{hz} Hz</b><input id="tie-hz" type="range" min={10} max={50} step={1} value={hz} onChange={(event) => setHz(Number(event.target.value))} /></label>
      <span className="log-sets" role="group" aria-label="Polarity">
        <button type="button" aria-pressed={polarity === 1} title="An increase in impedance is a peak" onClick={() => setPolarity(1)}>Normal</button>
        <button type="button" aria-pressed={polarity === -1} title="An increase in impedance is a trough" onClick={() => setPolarity(-1)}>Reversed</button>
      </span>
      <span className="tie-fit">Shift <b>{fit.shiftM > 0 ? "+" : ""}{fmt(fit.shiftM, 1)} m</b> · stretch <b>{fmt((fit.stretch - 1) * 100, 1)}%</b></span>
      <button type="button" className="tie-button is-primary" onClick={fitHere} disabled={!inWindow} title="Search 15 m and 3% either side of where the synthetic is now"><Crosshair size={13} aria-hidden="true" />Fit here</button>
      <button type="button" className="tie-button" onClick={() => setFit({ shiftM: 0, stretch: 1 })}><RotateCcw size={13} aria-hidden="true" />Untie</button>
      <span className={`tie-r is-${!Number.isFinite(r) ? "none" : r >= 0.5 ? "good" : r >= 0.3 ? "fair" : "poor"}`} title="Correlation of the synthetic with the PSDM at the well, inside the tie window">r {Number.isFinite(r) ? r.toFixed(2) : "–"}{lastFit !== null && <small>fitted</small>}</span>
    </header>
    <div className="tie-stage">
      <section className="tie-3d" aria-label="The tie in the site">
        {site && volume ? <TieScene site={site} volume={volume} logs={logs} syn={syn} pScale={pScale} fit={fit} windowM={window_} hoverMd={hoverMd} />
          : <Loading>Loading the PSDM volume…</Loading>}
      </section>
      <aside className="tie-side">
        <div className="tie-side-top">
          {site && <PlanInset site={site} />}
          {scan && <Scan scan={scan} fit={fit} onShift={(shiftM) => setFit({ ...fit, shiftM })} />}
        </div>
        <div className="tie-body">
          {cubeLoading || !traces ? <Loading>Loading the PSDM volume…</Loading>
            : <Panel logs={logs} syn={syn} fit={fit} onFit={setFit} traces={traces} at={at} windowM={window_} onWindow={setWindow} wire={wire} contact={contact} onHoverMd={setHoverMd} />}
        </div>
      </aside>
    </div>
    <p className="petro-note">
      Logs: {file?.source}; sonic and density binned to 0.5 m, outliers (cycle skips, casing) left out. Seismic: {forgeSeismicSection.attribution}
      {" "}The PSDM&apos;s velocities are the processor&apos;s, not tied to check-shots or sonic, so a mis-tie of tens of metres is expected; the correlation curve shows every shift that would also fit. Zero-phase Ricker wavelet; reflectivity at normal incidence; time from the sonic alone.
    </p>
  </div>;
}

const SiteScene = lazy(() => import("@ikhmalputra/subsurface-react/3d").then((module) => ({ default: module.SiteScene })));

/**
 * The tie in the site: the volume's inline and crossline slices cut through 58-32, the synthetic
 * spliced into the inline slice as a band down the well where the tie puts it (faded outside the tie
 * window), and the cursor ring at the depth under the pointer in the tracks.
 */
function TieScene({ site, volume, logs, syn, pScale, fit, windowM, hoverMd }: {
  readonly site: NonNullable<ReturnType<typeof siteById>>; readonly volume: NonNullable<ReturnType<typeof useForgeVolume>["volume"]>; readonly logs: Logs; readonly syn: Float64Array; readonly pScale: number;
  readonly fit: Fit; readonly windowM: readonly [number, number]; readonly hoverMd: number | null;
}) {
  const ribbon = useMemo(() => {
    const md: number[] = [], values: number[] = [];
    for (let k = 0; k < syn.length; k += 2) {
      const moved = placed(logs.depth[k]!, logs.depth[0]!, fit) - logs.depth[k]!;
      const shown = placed(logs.depth[k]!, logs.depth[0]!, fit), inside = shown >= windowM[0] && shown <= windowM[1];
      md.push(logs.md[k]! + moved); values.push(Math.max(-1, Math.min(1, syn[k]! / pScale)) * (inside ? 1 : 0.3));
    }
    return { wellId: "58-32", mdM: md, values, halfWidthM: 100, colorMap: "seismic" as const, label: `Synthetic · ${fit.shiftM > 0 ? "+" : ""}${fmt(fit.shiftM)} m` };
  }, [syn, logs, fit, pScale, windowM]);
  const slices = useMemo(() => ({ inline: frame.offsetM, crossline: frame.alongM, depth: null }), []);
  // The seismic shows the contact itself; FORGE's planar granite top is conceptual, and would hide the band below it.
  const terrain = useForgeTerrain(true);
  const references = useMemo(() => withoutFlatGround(site.surfaces.filter((surface) => surface.role === "reference"), terrain), [site, terrain]);
  const toMd = (depth: number) => depth - (DATUM - well.depthZeroElevationM);
  const cursor = useMemo(() => hoverMd === null ? null : { wellId: "58-32", mdM: hoverMd }, [hoverMd]);
  // The camera opens on the tie: the logged part of 58-32 around the window, not the whole site.
  const opening = useMemo(() => ({ wellId: "58-32", topMdM: toMd(windowM[0]) - 150, baseMdM: toMd(windowM[1]) + 150 }), []);
  return <Suspense fallback={<Loading>Starting the 3D site…</Loading>}>
    <SiteScene title="The tie at 58-32" depthLabel={site.depthLabel} originLabel={site.originLabel} wells={site.wells} surfaces={references}
      seismic={volume} seismicClip={forgeSeismicSection.section.p99AbsAmplitude} selectedWellId="58-32" slices={slices}
      ribbon={ribbon} cursor={cursor} frame={opening} terrain={terrain} />
  </Suspense>;
}

/** The plan: the wells, the PSDM volume's outline, the 16A section line and the two slices through 58-32, on the site's grid. */
function PlanInset({ site }: { readonly site: NonNullable<ReturnType<typeof siteById>> }) {
  const W = 248, H = 176, P = 14;
  const az = cut.azimuthDeg * Math.PI / 180, sinA = Math.sin(az), cosA = Math.cos(az);
  const plan = (along: number, offset: number) => [along * sinA + offset * cosA, along * cosA - offset * sinA] as const;
  const box = [plan(cut.alongFromM, cut.offsetFromM), plan(cut.alongToM, cut.offsetFromM), plan(cut.alongToM, cut.offsetToM), plan(cut.alongFromM, cut.offsetToM)];
  const xs = box.map((p) => p[0]), ys = box.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.min((W - 2 * P) / (x1 - x0), (H - 2 * P - 12) / (y1 - y0));
  const px = (e: number, n: number) => [P + (e - x0) * k + ((W - 2 * P) - (x1 - x0) * k) / 2, H - P - 12 - (n - y0) * k] as const;
  const pts = (list: readonly (readonly [number, number])[]) => list.map(([e, n]) => px(e, n).map((v) => v.toFixed(1)).join(",")).join(" ");
  const inline = [plan(cut.alongFromM, frame.offsetM), plan(cut.alongToM, frame.offsetM)], crossline = [plan(frame.alongM, cut.offsetFromM), plan(frame.alongM, cut.offsetToM)];
  const section = [plan(cut.alongFromM, 0), plan(cut.alongToM, 0)];
  const colours: Readonly<Record<string, string>> = { forge: "#60a5fa", "16b": "#fb923c", "58-32": "#22d3ee" };
  return <figure className="tie-plan">
    <figcaption><b>Plan</b><span>NAD83 / UTM 12N · from 16A&apos;s planned wellhead</span></figcaption>
    <svg width={W} height={H} role="img" aria-label="Plan of the wells, the PSDM volume and the slices through 58-32">
      <rect className="tie-plan-ground" x={0.5} y={0.5} width={W - 1} height={H - 1} rx={10} />
      <polygon className="tie-plan-volume" points={pts(box)} />
      <polyline className="tie-plan-section" points={pts(section)} />
      <polyline className="tie-plan-slice" points={pts(inline)} />
      <polyline className="tie-plan-slice" points={pts(crossline)} />
      {site.wells.map((entry) => {
        const path: [number, number][] = [];
        for (let i = 0; i < entry.mdM.length; i++) path.push([entry.xyz[i * 3]!, entry.xyz[i * 3 + 1]!]);
        const [hx, hy] = px(path[0]![0], path[0]![1]);
        const here = entry.id === "58-32";
        return <g key={entry.id} className="tie-plan-well" data-here={here || undefined}>
          <polyline points={pts(path)} stroke={colours[entry.id] ?? "var(--ink-2)"} />
          <circle cx={hx} cy={hy} r={here ? 5 : 3.5} fill={colours[entry.id] ?? "var(--ink-2)"} />
          <text x={hx + 7} y={hy - 6}>{entry.label.replace(/ \(.*\)$/, "")}</text>
        </g>;
      })}
      <g className="tie-plan-scale" transform={`translate(${P},${H - 10})`}><line x2={500 * k} /><text x={500 * k + 5} dy="0.32em">500 m</text></g>
      <text className="tie-plan-north" x={W - 14} y={18} textAnchor="middle">N</text>
      <path className="tie-plan-north" d={`M${W - 14},22 l-4,10 l4,-3 l4,3 z`} />
    </svg>
  </figure>;
}

/** One trace of the cube at a position, every depth sample. */
function traceAt(cube: SeismicCube, alongM: number, offsetM: number): Float64Array {
  const a = Math.min(cube.alongCount - 1, Math.max(0, Math.round((alongM - cube.alongFromM) / cube.spacingM)));
  const o = Math.min(cube.offsetCount - 1, Math.max(0, Math.round((offsetM - cube.offsetFromM) / cube.spacingM)));
  return Float64Array.from({ length: cube.sampleCount }, (_, s) => cube.counts[(s * cube.offsetCount + o) * cube.alongCount + a]! * cube.amplitudePerCount);
}

const RULER = 64, HEAD = 34, LOG_W = 64, RC_W = 44, SYN_W = 110, SEIS_W = 150;

type Logs = { md: Float64Array; tvd: Float64Array; depth: Float64Array; dt: Float64Array; rho: Float64Array; gr: Float64Array; ai: Float64Array; rc: Float64Array; twt: Float64Array };

function Panel({ logs, syn, fit, onFit, traces, at, windowM, onWindow, wire, contact, onHoverMd }: {
  readonly logs: Logs; readonly syn: Float64Array; readonly fit: Fit; readonly onFit: (fit: Fit) => void; readonly traces: readonly Float64Array[]; readonly at: Float64Array; readonly onHoverMd: (md: number | null) => void;
  readonly windowM: readonly [number, number]; readonly onWindow: (window: readonly [number, number]) => void; readonly wire: ReturnType<typeof useWire>; readonly contact: { readonly depth: number; readonly md: number };
}) {
  const [box, size] = useSize<HTMLDivElement>();
  const width = Math.max(RULER + TRACKS.length * LOG_W + RC_W + SYN_W + SEIS_W + 16, size.width), height = Math.max(280, size.height);
  const [view, setView] = useState<readonly [number, number]>([800, 1700]);
  const y = scaleLinear().domain(view).range([HEAD, height - 8]);
  const x0 = RULER, tracksW = TRACKS.length * LOG_W;
  const rcX = x0 + tracksW, synX = rcX + RC_W + 6, seisX = synX + SYN_W + 6;
  const [hover, setHover] = useState<number | null>(null);
  const gesture = useRef<{ kind: "shift" | "window" | "pan"; y0: number; start: Fit | readonly [number, number]; d0: number } | null>(null);
  const [dragging, setDragging] = useState<"shift" | "window" | "pan" | null>(null);

  // The deck's cursor is in 16A; the same level here is the same elevation.
  const rkb16a = forgeSeismicSection.rkbElevationM;
  const toDeck = (depth: number) => wire.place ? mdAtSurveyTvd(wire.place.stations, depth - (DATUM - rkb16a)) : null;
  const fromDeck = (md: number | null) => { if (md === null || !wire.place) return null; const station = wire.place.stations; let tvd: number | null = null; for (let i = 1; i < station.length; i++) if (md <= station[i]!.mdM) { const t = (md - station[i - 1]!.mdM) / (station[i]!.mdM - station[i - 1]!.mdM || 1); tvd = station[i - 1]!.tvdM + t * (station[i]!.tvdM - station[i - 1]!.tvdM); break; } return tvd === null ? null : tvd + DATUM - rkb16a; };
  const cursor = hover ?? fromDeck(wire.cursor);

  // ⌘/Ctrl + wheel zooms about the pointer, a wheel pans in depth.
  const wheel = useRef({ view, height });
  wheel.current = { view, height };
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const { view: [a, b], height: h } = wheel.current, span = b - a;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const level = a + (event.clientY - element.getBoundingClientRect().top - HEAD) / (h - 8 - HEAD) * span;
        const next = Math.max(60, Math.min(3200, span * Math.exp(event.deltaY * 0.0015)));
        setView([level - (level - a) * next / span, level + (b - level) * next / span]);
      } else { const d = event.deltaY / (h - HEAD - 8) * span; setView([a + d, b + d]); }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [box]);

  const levelOf = (event: ReactPointerEvent<SVGSVGElement>) => y.invert(event.clientY - event.currentTarget.getBoundingClientRect().top);
  const xOf = (event: ReactPointerEvent<SVGSVGElement>) => event.clientX - event.currentTarget.getBoundingClientRect().left;
  const curve = (values: Float64Array, scale: (value: number) => number) => {
    let d = "", open = false, row = NaN;
    for (let k = 0; k < values.length; k++) {
      const py = Math.round(y(logs.depth[k]!));
      if (py < HEAD || py > height) { open = false; continue; }
      if (py === row) continue;
      row = py;
      const value = values[k]!;
      if (!Number.isFinite(value)) { open = false; continue; }
      d += `${open ? "L" : "M"}${scale(value).toFixed(1)},${py}`; open = true;
    }
    return d;
  };
  // A wiggle with its positive lobes filled: the way seismic is read at a well.
  const wiggle = (values: ArrayLike<number>, depths: (k: number) => number, centre: number, half: number, gain: number) => {
    let line = "", lobes = "";
    let inLobe = false;
    for (let k = 0; k < values.length; k++) {
      const py = y(depths(k));
      if (py < HEAD - 5 || py > height + 5) { if (inLobe) { lobes += `L${centre},${y(depths(k - 1)).toFixed(1)}Z`; inLobe = false; } continue; }
      const v = values[k]!;
      if (!Number.isFinite(v)) continue;
      const px = centre + Math.max(-half, Math.min(half, v * gain));
      line += `${line ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`;
      if (v > 0 && !inLobe) { lobes += `M${centre},${py.toFixed(1)}`; inLobe = true; }
      if (inLobe) lobes += `L${px.toFixed(1)},${py.toFixed(1)}`;
      if (v <= 0 && inLobe) { lobes += `L${centre},${py.toFixed(1)}Z`; inLobe = false; }
    }
    if (inLobe) lobes += `L${centre},${y(depths(values.length - 1)).toFixed(1)}Z`;
    return { line, lobes };
  };
  const synMax = Math.max(...Array.from(syn, Math.abs).filter(Number.isFinite)) || 1;
  const seisClip = amplitudeClip(Float32Array.from(traces[2]!)) || 1;
  const synDepth = (k: number) => placed(logs.depth[k]!, logs.depth[0]!, fit);
  const rcMax = 0.15;

  return <div className="tie-panel" ref={box}>
    <svg width={width} height={height} className="tie-svg" data-dragging={dragging ?? undefined}
      onPointerMove={(event) => {
        const level = levelOf(event), g = gesture.current;
        if (g?.kind === "shift") { const start = g.start as Fit; onFit({ ...start, shiftM: start.shiftM + (level - g.d0) }); return; }
        if (g?.kind === "window") { onWindow([Math.min(g.d0, level), Math.max(g.d0, level)]); return; }
        if (g?.kind === "pan") { const [a, b] = g.start as readonly [number, number]; const d = (g.y0 - event.clientY) * (b - a) / (height - HEAD - 8); setView([a + d, b + d]); return; }
        setHover(level);
        onHoverMd(level - (DATUM - well.depthZeroElevationM));
        const md = toDeck(level);
        if (md !== null) wire.hover(md);
      }}
      onPointerLeave={() => { setHover(null); onHoverMd(null); wire.hover(null); }}
      onPointerDown={(event) => {
        const level = levelOf(event), x = xOf(event);
        event.currentTarget.setPointerCapture(event.pointerId);
        if (x < RULER) { gesture.current = { kind: "window", y0: event.clientY, start: windowM, d0: level }; setDragging("window"); return; }
        if (x >= synX && x <= synX + SYN_W) { gesture.current = { kind: "shift", y0: event.clientY, start: fit, d0: level }; setDragging("shift"); return; }
        if (event.button === 1 || event.shiftKey) { gesture.current = { kind: "pan", y0: event.clientY, start: view, d0: level }; setDragging("pan"); return; }
        const md = toDeck(level);
        if (md !== null) wire.pin(md);
      }}
      onPointerUp={() => { gesture.current = null; setDragging(null); }}
      onDoubleClick={() => setView([800, 1700])}>
      {/* The tie window, where the correlation is scored. */}
      <rect className="tie-window" x={RULER} y={y(windowM[0])} width={seisX + SEIS_W - RULER} height={Math.max(0, y(windowM[1]) - y(windowM[0]))} />
      <Ruler y={y} height={height} md={(depth) => depth - (DATUM - well.depthZeroElevationM)} />
      {TRACKS.map((track, i) => {
        const x = x0 + i * LOG_W, scale = scaleLinear().domain([track.min, track.max]).range([x + 3, x + LOG_W - 3]).clamp(true);
        const values = track.key === "GR" ? logs.gr : track.key === "DTCO" ? logs.dt : track.key === "RHOZ" ? logs.rho : Float64Array.from(logs.ai, (value) => value / 1e6);
        return <g key={track.key}>
          <rect className="tie-track" x={x} y={HEAD} width={LOG_W} height={height - HEAD - 8} />
          <text className="tie-th" x={x + LOG_W / 2} y={13} textAnchor="middle">{track.label}</text>
          <text className="tie-ts" x={x + 3} y={27}>{track.min}</text><text className="tie-ts" x={x + LOG_W - 3} y={27} textAnchor="end">{track.max}</text>
          <path d={curve(values, scale)} stroke={track.colour} className="tie-curve" />
        </g>;
      })}
      <g>
        <rect className="tie-track" x={rcX} y={HEAD} width={RC_W} height={height - HEAD - 8} />
        <text className="tie-th" x={rcX + RC_W / 2} y={13} textAnchor="middle">RC</text>
        <text className="tie-ts" x={rcX + RC_W / 2} y={27} textAnchor="middle">±{rcMax}</text>
        <path className="tie-rc" d={Array.from(logs.rc, (value, k) => Math.abs(value) > 0.004 && y(logs.depth[k]!) > HEAD ? `M${rcX + RC_W / 2},${y(logs.depth[k]!).toFixed(1)}H${(rcX + RC_W / 2 + Math.max(-1, Math.min(1, value / rcMax)) * (RC_W / 2 - 2)).toFixed(1)}` : "").join("")} />
      </g>
      <g className="tie-syn" data-grab="">
        <rect className="tie-track is-grab" x={synX} y={HEAD} width={SYN_W} height={height - HEAD - 8} />
        <text className="tie-th" x={synX + SYN_W / 2} y={13} textAnchor="middle">Synthetic</text>
        <text className="tie-ts" x={synX + SYN_W / 2} y={27} textAnchor="middle">drag to shift</text>
        {[0.2, 0.5, 0.8].map((f) => { const w = wiggle(syn, synDepth, synX + SYN_W * f, SYN_W * 0.17, SYN_W * 0.17 / synMax); return <g key={f}><path d={w.lobes} className="tie-lobe is-syn" /><path d={w.line} className="tie-wiggle is-syn" /></g>; })}
      </g>
      <g>
        <rect className="tie-track" x={seisX} y={HEAD} width={SEIS_W} height={height - HEAD - 8} />
        <text className="tie-th" x={seisX + SEIS_W / 2} y={13} textAnchor="middle">PSDM at the well</text>
        <text className="tie-ts" x={seisX + SEIS_W / 2} y={27} textAnchor="middle">±2 bins along the section</text>
        {traces.map((trace, i) => { const w = wiggle(trace, (k) => at[k]!, seisX + SEIS_W * (0.1 + i * 0.2), SEIS_W * 0.1, SEIS_W * 0.1 / seisClip); return <g key={i} data-well={i === 2 || undefined}><path d={w.lobes} className="tie-lobe" /><path d={w.line} className="tie-wiggle" /></g>; })}
      </g>
      <g className="tie-contact"><line x1={rcX} x2={seisX + SEIS_W} y1={y(contact.depth)} y2={y(contact.depth)} /><text x={synX + 4} y={y(contact.depth) - 4}>largest impedance increase · {fmt(contact.md)} m MD</text></g>
      {cursor !== null && <g className="tie-cursor" pointerEvents="none">
        <line x1={RULER} x2={width} y1={y(cursor)} y2={y(cursor)} />
        <text x={RULER - 6} y={y(cursor) - 4} textAnchor="end">{fmt(cursor)}</text>
      </g>}
    </svg>
  </div>;
}

function Ruler({ y, height, md }: { readonly y: ReturnType<typeof scaleLinear<number, number>>; readonly height: number; readonly md: (depth: number) => number }) {
  const ticks = y.ticks(Math.max(4, Math.floor(height / 60)));
  return <g className="tie-ruler">
    <rect className="tie-ruler-hit" x={0} y={HEAD} width={RULER} height={height - HEAD - 8} />
    <text x={RULER - 6} y={13} textAnchor="end" className="tie-th">PSDM depth</text>
    <text x={RULER - 6} y={27} textAnchor="end" className="tie-ts">m · 58-32 TVD</text>
    {ticks.map((tick) => <g key={tick} transform={`translate(0,${y(tick)})`}><line x1={RULER - 5} x2={RULER} /><text x={RULER - 8} dy="-0.1em" textAnchor="end">{fmt(tick)}</text><text x={RULER - 8} dy="1em" textAnchor="end" className="tie-ruler-md">{fmt(md(tick))}</text></g>)}
  </g>;
}

/** Correlation against bulk shift at the current stretch: each peak is a cycle the synthetic could tie to. */
function Scan({ scan, fit, onShift }: { readonly scan: readonly { readonly shiftM: number; readonly r: number }[]; readonly fit: Fit; readonly onShift: (shiftM: number) => void }) {
  const W = 260, H = 96, P = 22;
  const x = scaleLinear().domain([-80, 80]).range([P, W - 6]);
  const yr = scaleLinear().domain([-1, 1]).range([H - 16, 8]);
  const d = scan.filter((entry) => Number.isFinite(entry.r)).map((entry, i) => `${i ? "L" : "M"}${x(entry.shiftM).toFixed(1)},${yr(entry.r).toFixed(1)}`).join("");
  const peaks = scan.filter((entry, i) => i > 0 && i < scan.length - 1 && entry.r > 0.25 && entry.r >= scan[i - 1]!.r && entry.r >= scan[i + 1]!.r);
  return <figure className="tie-scan">
    <figcaption>Correlation against shift <small>click a peak to try it</small></figcaption>
    <svg width={W} height={H} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onShift(Math.round(x.invert(event.clientX - rect.left))); }}>
      <line className="tie-scan-zero" x1={P} x2={W - 6} y1={yr(0)} y2={yr(0)} />
      {[-80, -40, 0, 40, 80].map((tick) => <text key={tick} x={x(tick)} y={H - 3} textAnchor="middle">{tick > 0 ? "+" : ""}{tick}</text>)}
      <text x={2} y={yr(1) + 4}>1</text><text x={2} y={yr(0) + 3}>0</text>
      <path d={d} className="tie-scan-line" />
      {peaks.map((peak) => <circle key={peak.shiftM} cx={x(peak.shiftM)} cy={yr(peak.r)} r={3.5} className="tie-scan-peak"><title>{`${peak.shiftM > 0 ? "+" : ""}${peak.shiftM} m: r ${peak.r.toFixed(2)}`}</title></circle>)}
      <line className="tie-scan-now" x1={x(Math.max(-80, Math.min(80, fit.shiftM)))} x2={x(Math.max(-80, Math.min(80, fit.shiftM)))} y1={6} y2={H - 14} />
    </svg>
  </figure>;
}
