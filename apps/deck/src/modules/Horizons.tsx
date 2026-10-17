import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Eye, EyeOff, Trash2, Undo2 } from "lucide-react";
import { forgeNeighbours, forgeSeismicSection, seismicImage, tvdToSeismicDepth } from "@ikhmalputra/subsurface-core";
import type { SeismicCube } from "@ikhmalputra/subsurface-core";
import { siteById, useForgeCube, useForgeVolume } from "../data/sites.ts";
import { useForgeTerrain, withoutFlatGround } from "../data/terrain.ts";
import { depthColour, phaseFromBytes } from "../data/horizon-model.ts";
import { ATTRIBUTE_MAPS, attributeAsSeismic, useAttributeVolume } from "../data/attribute-volumes.ts";
import type { AttributeVolume } from "../data/attribute-volumes.ts";
import type { Polarity } from "../data/horizon-model.ts";
import { addHorizon, depthsOf, gridOf, removeHorizon, surfaceOf, updateHorizon, useHorizons } from "../data/horizons.ts";
import type { Horizon } from "../data/horizons.ts";
import { addFault, addStickPoint, allSticks, faultSurfaceOf, faultsKey, removeFault, stickLinesOf, undoStickPoint, updateFault, useFaults } from "../data/faults.ts";
import type { Fault } from "../data/faults.ts";
import { cutOffs, faultAt, faultTrace, snapToRidge, throwOf } from "../data/fault-model.ts";
import type { SiteFence } from "@ikhmalputra/subsurface-react/3d";
import { fmt } from "../format.ts";
import { Loading } from "./Empty.tsx";
import { Frame, Inspector, Status } from "./frame/Frame.tsx";
import { useSize } from "./useSize.ts";

/**
 * Horizons on the FORGE PSDM, picked in the site: click a reflector on any slice and the deck tracks
 * it through the volume, peak to peak (or trough to trough), as far as the waveform holds. The surface
 * appears in 3D coloured by depth, as a structure map with contours, and on the inline section; a
 * looser or stricter correlation re-tracks it at once. Faults are picked as sticks on inlines and
 * joined into a surface; a horizon stops at a fault and is seeded again across it, which gives the
 * throw. Both are kept in this browser and also appear in Site in 3D.
 */

const cut = forgeSeismicSection.subVolume!;
const SiteScene = lazy(() => import("@ikhmalputra/subsurface-react/3d").then((module) => ({ default: module.SiteScene })));
type Slices = { readonly inline: number | null; readonly crossline: number | null; readonly depth: number | null };
type Mode = "horizon" | "fault";
type Show = "amplitude" | "coherence" | "fault" | "phase";
const SHOW_LABEL: Readonly<Record<Show, string>> = { amplitude: "Amplitude", coherence: "Coherence", fault: "Fault likelihood", phase: "Phase" };
const PHASES: readonly { deg: number; label: string }[] = [{ deg: 0, label: "0° peak" }, { deg: 90, label: "+90° zero below" }, { deg: 180, label: "180° trough" }, { deg: -90, label: "−90° zero above" }];
type Pick = { readonly alongM: number; readonly offsetM: number; readonly depthM: number; readonly slice?: string };
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
  const faults = useFaults();
  const [mode, setMode] = useState<Mode>("horizon");
  const [activeFault, setActiveFault] = useState<string | null>(faults.at(-1)?.id ?? null);
  const [newFault, setNewFault] = useState(false);
  const [across, setAcross] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const current = horizons.find((entry) => entry.id === active) ?? null;
  const fault = faults.find((entry) => entry.id === activeFault) ?? null;
  // Attributes from the same cube: what the slices and the section show, fault likelihood to snap sticks to, phase to track on.
  const [show, setShow] = useState<Show>("amplitude");
  const [snapping, setSnapping] = useState(true);
  const fl = useAttributeVolume(cube, show === "fault" || (mode === "fault" && snapping) ? "fault" : null);
  const anyPhase = horizons.some((entry) => entry.on === "phase");
  const phaseVol = useAttributeVolume(cube, show === "phase" || anyPhase ? "phase" : null);
  const coh = useAttributeVolume(cube, show === "coherence" ? "coherence" : null);
  const phase = useMemo(() => phaseVol && cube ? phaseFromBytes(phaseVol.bytes, cube) : undefined, [phaseVol, cube]);
  const shown: AttributeVolume | null = show === "fault" ? fl : show === "phase" ? phaseVol : show === "coherence" ? coh : null;
  const seismic = useMemo(() => volume && shown && show !== "amplitude" ? attributeAsSeismic(volume, shown, show) : volume, [volume, shown, show]);
  // Every horizon is tracked against every fault: it stops where one cuts it.
  const sticks = useMemo(() => allSticks(faults), [faults]);
  const stickKey = useMemo(() => faultsKey(faults), [faults]);
  const grids = useMemo(() => cube ? new Map(horizons.map((entry) => [entry.id, gridOf(entry, cube, sticks, stickKey, phase)])) : new Map<string, Float32Array>(), [horizons, cube, sticks, stickKey, phase]);
  const surfaces = useMemo(() => !site ? [] : [...withoutFlatGround(site.surfaces.filter((surface) => surface.role === "reference"), terrain),
    ...horizons.filter((entry) => entry.visible && grids.has(entry.id)).map((entry) => surfaceOf(entry, grids.get(entry.id)!)).filter((surface) => surface !== null),
    ...faults.filter((entry) => entry.visible).map(faultSurfaceOf).filter((surface) => surface !== null)], [site, horizons, grids, terrain, faults]);
  const fence = useMemo((): SiteFence | null => faults.some((entry) => entry.visible && entry.sticks.length) ? { label: "", stations: [], topM: 0, baseM: 0, lines: stickLinesOf(faults) } : null, [faults]);

  /**
   * A click on a slice. Picking horizons: seeds a new one when arming, adds a seed across a fault, or
   * moves the chosen one's seed. Picking faults: adds a point to the fault's stick on that inline.
   */
  const pick = (at: Pick) => {
    const a = Math.min(cut.alongCount - 1, Math.max(0, (at.alongM - cut.alongFromM) / cut.spacingM)), o = Math.min(cut.offsetCount - 1, toBin(at.offsetM, cut.offsetFromM));
    const s = tvdToSeismicDepth(at.depthM, forgeSeismicSection.rkbElevationM, forgeSeismicSection.seismicDatumElevationM) / cut.sampleIntervalM;
    setNote(null);
    if (mode === "fault") {
      if (at.slice && at.slice !== "inline") { setNote("Faults are picked on inlines: click on the inline slice, or on the section."); return; }
      const target = newFault || !fault ? addFault() : fault;
      if (target !== fault) { setActiveFault(target.id); setNewFault(false); }
      // Onto the fault likelihood's ridge within three traces, if the volume is there and snapping is on.
      const snapped = snapping && fl && cube ? snapToRidge(fl.bytes, cube, 255, a, o, s) : null;
      addStickPoint(target.id, o, { a: snapped ? snapped.a : a, s });
      if (snapping && fl && !snapped) setNote("No fault likelihood ridge within three traces: the point is where you clicked.");
      return;
    }
    const seed = { a: Math.round(a), o, s };
    if (arming || !current) { const made = addHorizon(seed, polarity); setActive(made.id); setArming(false); return; }
    if (across) { updateHorizon(current.id, { more: [...(current.more ?? []), seed] }); setAcross(false); return; }
    updateHorizon(current.id, { seed });
  };
  const switchMode = (next: Mode) => { setMode(next); setArming(false); setAcross(false); setNote(null); if (next === "fault" && !faults.length) setNewFault(true); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (arming || across || newFault) && (horizons.length || mode === "fault")) { event.preventDefault(); setArming(false); setAcross(false); setNewFault(false); }
      // ⌘Z undoes a stick point, except while typing, where it is the field's own undo.
      const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName));
      if (!typing && mode === "fault" && fault && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); undoStickPoint(fault.id); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [arming, across, newFault, horizons.length, mode, fault]);

  if (!site) return null;
  const grid = current ? grids.get(current.id) ?? null : null;
  const range = grid ? depthsOf(grid) : null;
  const hint = note ?? (mode === "fault" ? (newFault || !fault ? "Click on the fault on the inline slice to start a new fault" : `Adding to ${fault.name}: click down the fault on this inline · move the inline for the next stick · ⌘Z undoes`)
    : across ? "Click the same reflector on the far side of the fault · Esc to stop"
    : arming ? `Click a peak or trough on a slice to seed a horizon${horizons.length ? " · Esc to stop" : ""}` : null);
  const tracking = current ? <>
    <span className="log-sets" role="group" aria-label="What to follow">
      <button type="button" aria-pressed={current.polarity === "peak"} onClick={() => updateHorizon(current.id, { polarity: "peak" })}>Peak</button>
      <button type="button" aria-pressed={current.polarity === "trough"} onClick={() => updateHorizon(current.id, { polarity: "trough" })}>Trough</button>
    </span>
    <span className="log-sets" role="group" aria-label="Track on">
      <button type="button" aria-pressed={current.on !== "phase"} onClick={() => updateHorizon(current.id, { on: "amplitude" })} title="Follow the amplitude's peak or trough">Amplitude</button>
      <button type="button" aria-pressed={current.on === "phase"} onClick={() => updateHorizon(current.id, { on: "phase", phaseDeg: current.polarity === "trough" ? 180 : 0 })} title="Follow a chosen instantaneous phase: a peak, a trough or a zero crossing">Phase</button>
    </span>
    {current.on === "phase" && <label className="hz-check">Phase<select className="hz-select" value={current.phaseDeg ?? 0} aria-label="Phase followed" onChange={(event) => updateHorizon(current.id, { phaseDeg: Number(event.target.value) })}>{PHASES.map((ph) => <option key={ph.deg} value={ph.deg}>{ph.label}</option>)}</select>{!phase && <small> computing…</small>}</label>}
    <label className="tie-slider">Correlation ≥ <b>{current.minCorrelation.toFixed(2)}</b><input id="hz-correlation" type="range" min={0.4} max={0.95} step={0.01} value={current.minCorrelation} onChange={(event) => updateHorizon(current.id, { minCorrelation: Number(event.target.value) })} /></label>
    <label className="tie-slider">Step ≤ <b>{current.search * cut.sampleIntervalM} m</b><input id="hz-search" type="range" min={1} max={6} step={1} value={current.search} onChange={(event) => updateHorizon(current.id, { search: Number(event.target.value) })} /></label>
  </> : <span className="log-sets" role="group" aria-label="What to follow">
    <button type="button" aria-pressed={polarity === "peak"} onClick={() => setPolarity("peak")}>Peak</button>
    <button type="button" aria-pressed={polarity === "trough"} onClick={() => setPolarity("trough")}>Trough</button>
  </span>;
  return <Frame name="horizons" className="hz" title="FORGE PSDM" subtitle="Horizons and faults, picked by you on the PSDM"
    tools={<>
      <span className="log-sets hz-mode" role="group" aria-label="What to pick">
        <button type="button" aria-pressed={mode === "horizon"} onClick={() => switchMode("horizon")}>Horizons</button>
        <button type="button" aria-pressed={mode === "fault"} onClick={() => switchMode("fault")}>Faults</button>
      </span>
      {mode === "fault" ? <>
        <button type="button" className={`tie-button${newFault ? " is-primary" : ""}`} aria-pressed={newFault} onClick={() => setNewFault((on) => !on)}><Crosshair size={13} aria-hidden="true" />{newFault ? "Click the fault…" : "New fault"}</button>
        <button type="button" className="tie-button" disabled={!fault?.history.length} onClick={() => fault && undoStickPoint(fault.id)} title="Take the last point off (⌘Z)"><Undo2 size={13} aria-hidden="true" />Undo point</button>
        <label className="hz-check" title="Each point moves onto the ridge of the fault likelihood attribute within three traces"><input type="checkbox" checked={snapping} onChange={(event) => setSnapping(event.target.checked)} /> Snap to fault likelihood{snapping && !fl ? " (computing…)" : ""}</label>
      </> : <>
        <button type="button" className={`tie-button${arming ? " is-primary" : ""}`} aria-pressed={arming} onClick={() => setArming((on) => !on)}><Crosshair size={13} aria-hidden="true" />{arming ? "Click a reflector…" : "New horizon"}</button>
        {current && faults.some((entry) => entry.sticks.length) && <button type="button" className={`tie-button${across ? " is-primary" : ""}`} aria-pressed={across} onClick={() => setAcross((on) => !on)} title="Seed the same horizon on the far side of a fault">{across ? "Click it across the fault…" : "Seed across a fault"}</button>}
      </>}
      <label className="hz-show">Show<select className="hz-select" value={show} onChange={(event) => setShow(event.target.value as Show)} aria-label="What the slices show">{(Object.keys(SHOW_LABEL) as Show[]).map((k) => <option key={k} value={k}>{SHOW_LABEL[k]}</option>)}</select>{show !== "amplitude" && !shown && <small>computing…</small>}</label>
    </>}
    numbers={range && mode === "horizon" ? <span><small>Tracked</small><b>{Math.round(range.coverage * 100)}%</b></span> : fault ? <span><small>Sticks</small><b>{fault.sticks.length}</b></span> : undefined}
    canvas={<section className="tie-3d hz-3d" aria-label="Horizons and faults in the site" data-arming={arming || across || mode === "fault" || undefined} data-mode={mode}>
      {volume ? <Suspense fallback={<Loading>Starting the 3D site…</Loading>}>
        <SiteScene title="FORGE horizons" depthLabel={site.depthLabel} originLabel={site.originLabel} wells={site.wells} surfaces={surfaces}
          seismic={seismic} seismicClip={seismic && seismic !== volume ? 127 * seismic.amplitudePerCount : forgeSeismicSection.section.p99AbsAmplitude} slices={slices} onSlicesChange={(next) => setSlices(next)} onSeismicPick={pick} terrain={terrain} fence={fence} />
      </Suspense> : <Loading>Loading the PSDM volume…</Loading>}
    </section>}
    inspector={<Inspector id={`horizons-${mode}`} initial={mode === "fault" ? "faults" : "horizons"} sections={[
      { id: "horizons", title: "Horizons", summary: `${horizons.length}${current ? ` · ${current.name}` : ""}`, body: <HorizonList horizons={horizons} grids={grids} active={active} onActive={(id) => { setActive(id); if (mode === "fault") switchMode("horizon"); }} /> },
      mode === "horizon" && { id: "tracking", title: "Tracking", summary: current ? `${current.on === "phase" ? `phase ${current.phaseDeg ?? 0}°` : current.polarity} · ≥ ${current.minCorrelation.toFixed(2)}` : polarity, body: <div className="hz-tracking">{tracking}</div> },
      faults.length > 0 && { id: "faults", title: "Faults", summary: `${faults.length}`, body: <FaultList faults={faults} active={mode === "fault" ? activeFault : null} horizon={current} grid={grid} onActive={(id) => { setActiveFault(id); setNewFault(false); if (mode !== "fault") switchMode("fault"); }} /> },
      cube && grid && current && range && Number.isFinite(range.lo) && { id: "map", title: "Structure map", summary: `${fmt(range.lo)}–${fmt(range.hi)} m`, body: <StructureMap horizon={current} grid={grid} slices={slices} faults={faults} /> },
    ]} />}
    strip={cube ? <Section cube={cube} offsetM={slices.inline ?? 0} horizons={horizons} grids={grids} active={active} faults={faults} activeFault={mode === "fault" ? activeFault : null} onPick={pick} overlay={show !== "amplitude" && shown ? { bytes: shown.bytes, map: ATTRIBUTE_MAPS[show]!, label: SHOW_LABEL[show] } : null} /> : undefined}
    status={<Status items={[
      hint ? <b className="hz-status-hint">{hint}</b> : !horizons.length ? "No horizons yet: click New horizon, then a reflector on a slice or on the section below" : `${horizons.length} horizon${horizons.length === 1 ? "" : "s"} · ${faults.length} fault${faults.length === 1 ? "" : "s"} · yours, kept in this browser, not a mapped surface from FORGE`,
      `Seismic: ${forgeSeismicSection.attribution}`,
    ]} />} />;
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

/** The faults, each with its sticks and, on the chosen horizon, its throw where the horizon is tracked on both sides. */
function FaultList({ faults, active, horizon, grid, onActive }: { readonly faults: readonly Fault[]; readonly active: string | null; readonly horizon: Horizon | null; readonly grid: Float32Array | null; readonly onActive: (id: string) => void }) {
  return <ul className="hz-list is-faults" aria-label="Faults">
    {faults.map((entry) => {
      const thrown = grid && entry.sticks.length ? throwOf(grid, cut.alongCount, cut.offsetCount, entry.sticks) : null;
      return <li key={entry.id} data-active={entry.id === active || undefined} onClick={() => onActive(entry.id)}>
        <i style={{ background: entry.colour }} />
        <input id={`hz-fault-${entry.id}`} value={entry.name} aria-label="Fault name" onChange={(event) => updateFault(entry.id, { name: event.target.value })} onClick={(event) => event.stopPropagation()} />
        <small>{entry.sticks.length} stick{entry.sticks.length === 1 ? "" : "s"}{thrown ? ` · throw ${fmt(thrown.samples * cut.sampleIntervalM)} m on ${horizon?.name}` : horizon && entry.sticks.length >= 1 ? " · seed across it for the throw" : ""}</small>
        <button type="button" className="cor-icon" aria-label={entry.visible ? `Hide ${entry.name}` : `Show ${entry.name}`} onClick={(event) => { event.stopPropagation(); updateFault(entry.id, { visible: !entry.visible }); }}>{entry.visible ? <Eye size={12} /> : <EyeOff size={12} />}</button>
        <button type="button" className="cor-icon" aria-label={`Delete ${entry.name}`} onClick={(event) => { event.stopPropagation(); removeFault(entry.id); }}><Trash2 size={12} /></button>
      </li>;
    })}
  </ul>;
}

/** The active horizon from above: depth-coloured on the volume's grid, contoured every 25 m, with the wells and the slices. */
function StructureMap({ horizon, grid, slices, faults }: { readonly horizon: Horizon; readonly grid: Float32Array; readonly slices: Slices; readonly faults: readonly Fault[] }) {
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
      const s = grid[o * cut.alongCount + a]!, at = (o * cut.alongCount + a) * 4;
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
  // Map frame: along to the right and offset down, so the map is a true plan (offset runs 90° clockwise of along); the arrow shows north.
  const x = (along: number) => (along - cut.alongFromM + cut.spacingM / 2) / (cut.alongCount * cut.spacingM) * W;
  const y = (offset: number) => (offset - cut.offsetFromM + cut.spacingM / 2) / (cut.offsetCount * cut.spacingM) * H;
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
        {faults.filter((entry) => entry.visible && entry.sticks.length).map((entry) => {
          // The gap the fault opens in the horizon: its cut-offs either side, inline by inline, as a polygon.
          const cuts = Array.from({ length: cut.offsetCount }, (_, o) => ({ o, at: cutOffs(grid, cut.alongCount, o, entry.sticks) })).filter((row) => row.at);
          const px = (a: number, o: number) => `${x(cut.alongFromM + a * cut.spacingM).toFixed(1)},${y(cut.offsetFromM + o * cut.spacingM).toFixed(1)}`;
          const outline = cuts.length > 1 ? [...cuts.map((row) => px(row.at!.a1 + 0.5, row.o)), ...[...cuts].reverse().map((row) => px(row.at!.a2 - 0.5, row.o))].join(" ") : "";
          // And the line where it cuts the horizon, so a fault shows even where the gap is narrower than a trace.
          const traces = faultTrace(grid, cut.alongCount, cut.offsetCount, entry.sticks);
          if (!outline && !traces.length) return null;
          return <g key={entry.id} style={{ color: entry.colour }}><title>{entry.name}</title>
            {outline && <polygon points={outline} className="hz-map-fault" />}
            {traces.map((line, i) => <polyline key={i} points={line.map(([a, o]) => px(a, o)).join(" ")} className="hz-map-fault-line" />)}
          </g>;
        })}
        {heads.map((head) => { const p = wellAt(head.e, head.n); return <g key={head.id} transform={`translate(${x(p.along)},${y(p.offset)})`}><circle r={4} /><text x={6} y={-5}>{head.id}</text></g>; })}
        <g transform={`translate(${W - 16},18) rotate(${90 - cut.azimuthDeg})`} className="hz-map-north"><path d="M0,-9 L4,4 L0,1 L-4,4 Z" /></g>
      </svg>
    </div>
    <div className="hz-ramp"><span>{fmt(lo)} m</span><i style={{ background: `linear-gradient(90deg, ${[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => `rgb(${depthColour(t).map((v) => Math.round(v * 255)).join(",")})`).join(", ")})` }} /><span>{fmt(hi)} m below datum</span></div>
  </figure>;
}

/** The inline under the 3D inline slice, with every horizon drawn on it; a click here seeds too. */
function Section({ cube, offsetM, horizons, grids, active, faults, activeFault, onPick, overlay }: {
  readonly cube: SeismicCube; readonly offsetM: number; readonly horizons: readonly Horizon[]; readonly grids: ReadonlyMap<string, Float32Array>; readonly active: string | null;
  readonly faults: readonly Fault[]; readonly activeFault: string | null; readonly onPick: (at: Pick) => void;
  readonly overlay: { readonly bytes: Uint8Array; readonly map: (t: number) => [number, number, number]; readonly label: string } | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null), over = useRef<HTMLCanvasElement>(null);
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
  // The attribute over the amplitude, one pixel per trace and sample, translucent.
  useEffect(() => {
    const element = over.current;
    if (!element) return;
    element.width = cut.alongCount; element.height = base - top;
    const context = element.getContext("2d")!;
    if (!overlay) { context.clearRect(0, 0, element.width, element.height); return; }
    const image = context.createImageData(cut.alongCount, base - top);
    for (let s = top; s < base; s++) for (let a = 0; a < cut.alongCount; a++) {
      const v = overlay.bytes[(s * cut.offsetCount + o) * cut.alongCount + a]! / 255, [r, g, b] = overlay.map(v), at = ((s - top) * cut.alongCount + a) * 4;
      image.data[at] = r; image.data[at + 1] = g; image.data[at + 2] = b; image.data[at + 3] = 175;
    }
    context.putImageData(image, 0, 0);
  }, [overlay, o]);
  const x = (a: number) => (a + 0.5) / cut.alongCount * W, y = (s: number) => (s - top) / (base - top) * H;
  return <figure className="hz-section" ref={box}>
    <figcaption><b>Inline at {fmt(offsetM)} m</b><span>{overlay ? `${overlay.label} over the amplitude · ` : ""}follows the 3D inline slice · click a reflector to seed</span></figcaption>
    <div className="hz-section-stage" style={{ height: H }} onClick={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const a = (event.clientX - rect.left) / W * cut.alongCount - 0.5, s = top + (event.clientY - rect.top) / H * (base - top);
      onPick({ alongM: cut.alongFromM + a * cut.spacingM, offsetM, depthM: s * cut.sampleIntervalM - forgeSeismicSection.seismicDatumElevationM + forgeSeismicSection.rkbElevationM, slice: "inline" });
    }}>
      <canvas ref={canvas} style={{ width: W, height: H }} />
      <canvas ref={over} className="hz-overlay" style={{ width: W, height: H }} />
      <svg width={W} height={H}>
        {horizons.filter((entry) => entry.visible).map((entry) => {
          const grid = grids.get(entry.id);
          if (!grid) return null;
          let d = "", open = false;
          for (let a = 0; a < cut.alongCount; a++) { const s = grid[o * cut.alongCount + a]!; if (Number.isNaN(s)) { open = false; continue; } d += `${open ? "L" : "M"}${x(a).toFixed(1)},${y(s).toFixed(1)}`; open = true; }
          return <path key={entry.id} d={d} stroke={entry.colour} className="hz-section-line" data-active={entry.id === active || undefined} />;
        })}
        {faults.filter((entry) => entry.visible && entry.sticks.length).map((entry) => {
          const stick = entry.sticks.find((one) => one.o === o);
          // Between sticks the fault is interpolated: dashed, where it is read rather than picked.
          let trace = "";
          if (!stick) { let open = false; for (let s = top; s <= base; s += 4) { const f = faultAt(entry.sticks, o, s); if (f === null) { open = false; continue; } trace += `${open ? "L" : "M"}${x(f).toFixed(1)},${y(s).toFixed(1)}`; open = true; } }
          return <g key={entry.id} className="hz-section-fault" data-active={entry.id === activeFault || undefined} style={{ color: entry.colour }}>
            {trace && <path d={trace} className="is-read" />}
            {stick && <path d={stick.points.map((p, i) => `${i ? "L" : "M"}${x(p.a).toFixed(1)},${y(p.s).toFixed(1)}`).join("")} />}
            {stick?.points.map((p, i) => <circle key={i} cx={x(p.a)} cy={y(p.s)} r={3.2} />)}
          </g>;
        })}
        {[100, 200, 300].map((s) => <text key={s} x={4} y={y(s) - 3} className="hz-section-tick">{fmt(s * cut.sampleIntervalM)} m</text>)}
      </svg>
    </div>
  </figure>;
}
