import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { SiteFence, SiteSceneSurface } from "@ikhmalputra/subsurface-react/3d";
import { FORCE_SOURCE, areaWells, forceSite, useForceLogs } from "../data/force.ts";
import { useDeck } from "../deck/store.ts";
import { usePicks } from "../data/picks.ts";
import { busId } from "../data/force-model.ts";
import { depthColour } from "../data/horizon-model.ts";
import { closedHighs, closure, crestFrom, frameAround, levelLines, readCurve, sample, spacing, spillDepth, supportOf, trendSurface, volumeCurve } from "../data/map-model.ts";
import type { GridFrame } from "../data/map-model.ts";
import { monteCarlo, tornado } from "../data/volumetrics-model.ts";
import type { Fluid, InputName, Range, VolumeInputs } from "../data/volumetrics-model.ts";
import { rangeOf, topIn, zonePetro, zoneWells } from "../data/zone-model.ts";
import { useInterpretations } from "../data/petro-interpretations.ts";
import { zoneThroughInterpretation } from "../data/petro-force-model.ts";
import type { ZonePetro, ZoneWell } from "../data/zone-model.ts";
import { fmt } from "../format.ts";
import { Loading } from "./Empty.tsx";
import { Frame, Inspector, Status } from "./frame/Frame.tsx";
import { placeLabels } from "./frame/labels.ts";
import { useSize } from "./useSize.ts";

/**
 * Maps & volumetrics on a field's wells: a zone's top mapped between the wells that meet it (a
 * thin-plate spline, the minimum-curvature surface) and its thickness likewise; a contact set on
 * it makes a closure from the crest you choose, up to where it spills; the zone's net to gross,
 * porosity and water saturation come from the wells' own logs. A Monte Carlo over those ranges and
 * the contact gives the in-place volume as P90, P50 and P10, with the inputs that move it most.
 * FORCE 2020 carries no fluid contacts: the contact is yours, a what-if.
 */

const KEY = "deck-volumetrics-v1";
/** The least relief, crest to spill, that counts as a trap (as for the prospects the map marks). */
const MIN_RELIEF = 10;
type Editable = Exclude<InputName, "contact">;
interface Setup {
  readonly top: string; readonly base: string; readonly fluid: Fluid;
  /** Where the closure is grown from, as map east and north (a grid node moves when the grid does), and the contact depth: null for the defaults. */
  readonly crest: readonly [number, number] | null; readonly contact: number | null;
  /** How far the contact may lie either side of where it is set, metres. */
  readonly spread: number;
  readonly ranges: Partial<Record<Editable, Range>>;
}
/** Zones that are reservoirs in each area, top and base, where the Directorate's tops have them. */
const ZONES: Readonly<Record<string, readonly [string, string]>> = {
  "force-q33": ["Baat Gp.", "Dunlin Gp."], "force-q25": ["Hugin Fm.", "Sleipner Fm."], "force-q35": ["Sognefjord Fm.", "Fensfjord Fm."],
  "force-q29": ["Sognefjord Fm.", "Fensfjord Fm."], "force-q15": ["Hugin Fm.", "Skagerrak Fm."],
};
const FVF: Readonly<Record<Fluid, Range>> = { oil: { low: 1.15, mode: 1.3, high: 1.5 }, gas: { low: 0.0035, mode: 0.0045, high: 0.006 } };
const SW_DEFAULT: Range = { low: 0.2, mode: 0.35, high: 0.5 };
const FLUID_COLOUR: Readonly<Record<Fluid, string>> = { oil: "#34d399", gas: "#f87171" };
const LABEL: Readonly<Record<InputName, string>> = { contact: "Contact", ntg: "Net to gross", porosity: "Porosity", sw: "Water saturation", fvf: "Bo / Bg" };

/** Stored setups, each kept only if it still has the shape this code reads: a bad one is dropped rather than crash the module on every load. */
function readSetups(): Record<string, Setup> {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Partial<Setup>>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, s]) => s && typeof s.top === "string" && typeof s.base === "string" && (s.fluid === "oil" || s.fluid === "gas")
      && typeof s.spread === "number" && Number.isFinite(s.spread) && (s.contact === null || (typeof s.contact === "number" && Number.isFinite(s.contact))) && !!s.ranges && typeof s.ranges === "object")) as Record<string, Setup>;
  } catch { return {}; }
}
function writeSetup(area: string, setup: Setup) { try { localStorage.setItem(KEY, JSON.stringify({ ...readSetups(), [area]: setup })); } catch { /* not kept */ } }

/** Volumes as people quote them: oil in million Sm³ and MMbbl, gas in billion Sm³ and Bcf. */
const volume = (sm3: number, fluid: Fluid) => fluid === "oil" ? { big: sm3 / 1e6, unit: "10⁶ Sm³", alt: sm3 * 6.2898 / 1e6, altUnit: "MMbbl" } : { big: sm3 / 1e9, unit: "10⁹ Sm³", alt: sm3 * 35.3147 / 1e9, altUnit: "Bcf" };
const show = (v: number) => v >= 100 ? fmt(Math.round(v)) : v >= 10 ? v.toFixed(1) : v.toFixed(2);

const SiteScene = lazy(() => import("@ikhmalputra/subsurface-react/3d").then((module) => ({ default: module.SiteScene })));

export function Volumetrics() {
  const area = useDeck((deck) => deck.siteId)!;
  const all = useMemo(() => areaWells(area), [area]);
  const picks = usePicks();
  // The tops a zone can run between: those in five or more of the area's wells, shallowest first.
  const names = useMemo(() => {
    const seen = new Map<string, number[]>();
    for (const well of all) for (const top of [...well.groups, ...well.formations, ...(picks[busId(well)] ?? []).map((pick) => ({ name: pick.name, md: pick.md, tvdss: null }))]) seen.set(top.name, [...(seen.get(top.name) ?? []), top.tvdss ?? top.md]);
    return [...seen].filter(([, depths]) => depths.length >= 5).map(([name, depths]) => ({ name, depth: depths.sort((a, b) => a - b)[Math.floor(depths.length / 2)]! })).sort((a, b) => a.depth - b.depth);
  }, [all, picks]);
  /** The bases a zone can have: the tops lying deeper than its top in most of the wells that have both (medians across different wells mislead). */
  const below = (top: string) => names.filter((entry) => {
    let deeper = 0, shallower = 0;
    for (const well of all) {
      const t = topIn(well, top, picks[busId(well)] ?? []), b = topIn(well, entry.name, picks[busId(well)] ?? []);
      if (t && b) { if (b.md > t.md) deeper++; else shallower++; }
    }
    return deeper > 0 && deeper >= shallower;
  });
  const [setup, setSetupState] = useState<Setup>(() => {
    const kept = readSetups()[area];
    if (kept) return { ...kept, crest: Array.isArray(kept.crest) ? kept.crest : null };
    const [top, base] = ZONES[area] ?? [names.at(-2)?.name ?? "", names.at(-1)?.name ?? ""];
    return { top, base, fluid: "oil", crest: null, contact: null, spread: 25, ranges: {} };
  });
  const setSetup = (change: (current: Setup) => Setup) => setSetupState((current) => { const next = change(current); writeSetup(area, next); return next; });

  // ── The map ──────────────────────────────────────────────────────────────────────────────
  const zone = useMemo(() => zoneWells(all, setup.top, setup.base, (well) => picks[busId(well)] ?? []), [all, setup.top, setup.base, picks]);
  const map = useMemo(() => {
    if (zone.length < 3) return null;
    // Honours every well; away from them it falls back to the regional dip rather than invent highs.
    const frame = frameAround(zone, 96);
    const top = sample(frame, trendSurface(zone.map((entry) => ({ x: entry.x, y: entry.y, z: entry.top }))));
    const based = zone.filter((entry) => entry.base !== null);
    const mean = based.length ? based.reduce((s, entry) => s + entry.base! - entry.top, 0) / based.length : 0;
    const thickness = based.length >= 3 ? sample(frame, trendSurface(based.map((entry) => ({ x: entry.x, y: entry.y, z: entry.base! - entry.top })))).map((v) => Math.max(0, v)) : new Float32Array(top.length).fill(mean);
    // Where the map rests on wells: within one and a half well spacings of one. A closure that runs out of it leaks.
    const reach = 1.5 * spacing(zone), support = supportOf(frame, zone, reach);
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < top.length; k++) if (support[k]) { lo = Math.min(lo, top[k]!); hi = Math.max(hi, top[k]!); }
    return { frame, top, thickness, support, reach, lo, hi, highs: closedHighs(top, frame, support, MIN_RELIEF), based: based.length, meanThickness: mean };
  }, [zone]);
  const nodeAt = (frame: GridFrame, x: number, y: number) => Math.min(frame.ny - 1, Math.max(0, Math.round((y - frame.y0) / frame.cell))) * frame.nx + Math.min(frame.nx - 1, Math.max(0, Math.round((x - frame.x0) / frame.cell)));
  const trap = useMemo(() => {
    if (!map) return null;
    // By default the largest high that closes; with none, the high the shallowest well drains up to.
    const shallowest = [...zone].sort((a, b) => a.top - b.top)[0]!;
    const start = Array.isArray(setup.crest) ? nodeAt(map.frame, setup.crest[0], setup.crest[1]) : map.highs[0]?.crest ?? nodeAt(map.frame, shallowest.x, shallowest.y);
    const crest = crestFrom(map.top, map.frame, start, map.support);
    const crestDepth = map.top[crest]!, spill = spillDepth(map.top, map.frame, crest, map.support);
    const deepest = spill ?? Math.min(map.hi, crestDepth + 800);
    const curve = volumeCurve(map.top, map.thickness, map.frame, crest, deepest, 48, map.support);
    // A trap needs relief: a bump of a few metres between wells is the map's noise, not a closure.
    const closes = spill !== null && spill - crestDepth >= MIN_RELIEF;
    return { crest, crestDepth, spill, closes, deepest, curve };
  }, [map, zone, setup.crest]);
  const contact = trap ? Math.min(trap.deepest, Math.max(trap.crestDepth + 1, setup.contact ?? trap.crestDepth + 0.5 * (trap.deepest - trap.crestDepth))) : 0;
  const closed = useMemo(() => map && trap ? closure(map.top, map.frame, trap.crest, contact, map.support) : null, [map, trap, contact]);

  // ── The logs ─────────────────────────────────────────────────────────────────────────────
  const logged = useMemo(() => zone.filter((entry) => entry.baseMd !== null).map((entry) => entry.well), [zone]);
  const { logs } = useForceLogs(logged);
  // A well the petrophysicist has interpreted in Petrophysics is read through that interpretation; the rest by the quick-look below.
  const interpretations = useInterpretations();
  const [useYours, setUseYours] = useState(true);
  const petro = useMemo(() => new Map(zone.flatMap((entry): [string, ZonePetro & { readonly by: string }][] => {
    const l = logs.get(entry.well.id), own = useYours ? interpretations[entry.well.id] : undefined;
    if (!l || !entry.baseMd) return [];
    const p = own ? zoneThroughInterpretation(l, entry.topMd, entry.baseMd, own.interpretation) : zonePetro(l, entry.topMd, entry.baseMd);
    return p ? [[entry.well.id, { ...p, by: own ? "yours" : "quick-look" }]] : [];
  })), [zone, logs, interpretations, useYours]);
  const interpreted = [...petro.values()].filter((p) => p.by === "yours").length, interpretable = zone.filter((entry) => interpretations[entry.well.id]).length;
  const fromWells = useMemo(() => {
    const p = [...petro.values()], pay = p.flatMap((entry) => entry.paySw === null ? [] : [entry.paySw]);
    return { ntg: rangeOf(p.map((entry) => entry.ntg)), porosity: rangeOf(p.map((entry) => entry.porosity)), sw: rangeOf(pay), wells: p.length, payWells: pay.length };
  }, [petro]);
  const range = (name: Editable): { value: Range; from: string } => {
    const own = setup.ranges[name];
    if (own) return { value: own, from: "yours" };
    if (name === "fvf") return { value: FVF[setup.fluid], from: "typical" };
    const derived = fromWells[name];
    if (derived) return { value: derived, from: name === "sw" ? `pay in ${fromWells.payWells} wells` : `${fromWells.wells} wells` };
    return { value: name === "sw" ? SW_DEFAULT : name === "ntg" ? { low: 0.4, mode: 0.6, high: 0.8 } : { low: 0.15, mode: 0.22, high: 0.28 }, from: "typical" };
  };

  // ── The volumes ──────────────────────────────────────────────────────────────────────────
  // A high that does not close holds no volume the map can measure: no numbers rather than wrong ones.
  const inputs = useMemo((): VolumeInputs | null => !trap || !trap.closes ? null : {
    rock: (c: number) => readCurve(trap.curve.contacts, trap.curve.volumes, c),
    contact: { low: Math.max(trap.crestDepth, contact - setup.spread), mode: contact, high: Math.min(trap.deepest, contact + setup.spread) },
    ntg: range("ntg").value, porosity: range("porosity").value, sw: range("sw").value, fvf: range("fvf").value,
  }, [trap, contact, setup.spread, setup.ranges, setup.fluid, fromWells]);
  const result = useMemo(() => inputs ? monteCarlo(inputs) : null, [inputs]);
  const swings = useMemo(() => inputs ? tornado(inputs) : [], [inputs]);

  // ── The site ─────────────────────────────────────────────────────────────────────────────
  const site = forceSite(area);
  const origin = useMemo(() => { const placed = all.filter((well) => well.utm && well.lonLat); return [placed.reduce((s, w) => s + w.utm![0], 0) / Math.max(1, placed.length), placed.reduce((s, w) => s + w.utm![1], 0) / Math.max(1, placed.length)] as const; }, [all]);
  const wells = useMemo(() => site?.wells.map((well) => ({ ...well, markers: (well.markers ?? []).filter((marker) => marker.label === setup.top || marker.label === setup.base) })) ?? [], [site, setup.top, setup.base]);
  const surfaces = useMemo((): SiteSceneSurface[] => {
    if (!map) return [];
    const { frame, top, thickness, lo, hi } = map, step = 2;
    const nx = Math.floor((frame.nx - 1) / step) + 1, ny = Math.floor((frame.ny - 1) / step) + 1;
    const grid = (z: (k: number) => number) => {
      const points: [number, number, number][] = [], triangles: number[] = [];
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * step * frame.nx + i * step; points.push([frame.x0 + i * step * frame.cell - origin[0], frame.y0 + j * step * frame.cell - origin[1], z(k)]); }
      // Only where the map rests on wells: beyond them there is no surface to show.
      const on = (i: number, j: number) => map.support[j * step * frame.nx + i * step] === 1;
      for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) {
        const a = j * nx + i;
        if (on(i, j) && on(i + 1, j) && on(i, j + 1)) triangles.push(a, a + 1, a + nx);
        if (on(i + 1, j) && on(i + 1, j + 1) && on(i, j + 1)) triangles.push(a + 1, a + nx + 1, a + nx);
      }
      return { points, triangles };
    };
    const t = grid((k) => top[k]!), b = grid((k) => top[k]! + thickness[k]!);
    return [
      { id: "sea", label: "Sea level", provenance: "documented", role: "reference", color: "#3f8fc0", note: "0 m, the depth reference of the Directorate's TVDSS.", geometry: { kind: "plane", depthM: 0 } },
      { id: "zone-top", label: `${setup.top} top`, provenance: "user-authored", role: "horizon", color: "#f59e0b", note: `Mapped between the ${zone.length} wells that meet it by thin-plate spline. A map from wells alone: no seismic constrains it between them.`, geometry: { kind: "tin", ...t }, pointColors: t.points.map((p) => depthColour((p[2] - lo) / Math.max(1, hi - lo))) },
      { id: "zone-base", label: `${setup.base} top`, provenance: "user-authored", role: "horizon", color: "#64748b", quiet: true, note: "The zone's base: its top plus the thickness mapped between the wells.", geometry: { kind: "tin", ...b } },
    ];
  }, [map, origin, setup.top, setup.base, zone.length]);
  const fence = useMemo((): SiteFence | null => {
    if (!map || !closed?.cells) return null;
    const rings = levelLines(map.top, map.frame, contact, closed.mask);
    return { label: "", stations: [], topM: 0, baseM: 0, lines: rings.filter((ring) => ring.length > 2).map((ring, i) => ({ label: i === 0 ? `${setup.fluid === "oil" ? "OWC" : "GWC"} ${fmt(Math.round(contact))} m` : "", color: FLUID_COLOUR[setup.fluid], emphasis: true, points: ring.map(([x, y]) => [x - origin[0], y - origin[1], contact] as [number, number, number]) })) };
  }, [map, closed, contact, origin, setup.fluid]);

  if (!site) return null;
  const fluidName = setup.fluid === "oil" ? "STOIIP" : "GIIP";
  const ranges = <table className="vol-ranges">
    <tbody>
      <tr><th>{LABEL.contact}</th><td colSpan={3}><span className="vol-spread">± <input id="vol-spread" type="number" min={0} max={300} step={5} value={setup.spread} onChange={(event) => setSetup((current) => ({ ...current, spread: Math.max(0, Number(event.target.value) || 0) }))} /> m</span></td><td><small>yours</small></td></tr>
      {(["ntg", "porosity", "sw", "fvf"] as const).map((name) => {
        const { value, from } = range(name), percent = name !== "fvf", k = percent ? 100 : 1;
        const set = (key: keyof Range, raw: string) => { const v = Number(raw) / k; if (raw.trim() !== "" && Number.isFinite(v)) setSetup((current) => ({ ...current, ranges: { ...current.ranges, [name]: { ...value, [key]: v } } })); };
        return <tr key={name}>
          <th>{LABEL[name]}{percent && <small> %</small>}</th>
          {(["low", "mode", "high"] as const).map((key) => <td key={key}><input id={`vol-${name}-${key}`} type="number" step={percent ? 1 : setup.fluid === "gas" ? 0.0005 : 0.05} value={percent ? Math.round(value[key] * 10000) / 100 : Number(value[key].toPrecision(4))} onChange={(event) => set(key, event.target.value)} aria-label={`${LABEL[name]}, ${key === "mode" ? "most likely" : key}`} /></td>)}
          <td><small>{from}</small>{from === "yours" && <button type="button" className="cor-icon" aria-label={`Back to the ${LABEL[name]} from the wells`} onClick={() => setSetup((current) => ({ ...current, ranges: { ...current.ranges, [name]: undefined } }))}><RotateCcw size={11} /></button>}</td>
        </tr>;
      })}
    </tbody>
  </table>;
  const warnings = map && trap ? <>
    {map.based < 3 && <p className="vol-warn">{map.based ? `Only ${map.based} well${map.based === 1 ? "" : "s"} reach${map.based === 1 ? "es" : ""} ${setup.base} below ${setup.top}: the zone is taken as ${fmt(Math.round(map.meanThickness))} m thick everywhere.` : `No well reaches ${setup.base} below ${setup.top}: the zone has no thickness and no volume. Choose another base.`}</p>}
    {!trap.closes && <p className="vol-warn">{map.highs.length ? `This high ${trap.spill === null ? "does not close: above any contact it runs off the area the wells support" : `closes by only ${Math.round(trap.spill - trap.crestDepth)} m, within the map's noise`}. Click a closed high (▲) for volumes.` : "No high closes on the wells alone in this zone, so there is no volume to measure. The surface shown is the high the shallowest well drains up to; try another zone, or pick tops in Correlation to tie more wells."}</p>}
  </> : null;
  return <Frame name="volumetrics" className="vol" title={site.map.label} subtitle={`${setup.top} to ${setup.base} · ${fluidName} from the wells' own logs`}
    tools={<>
      <label className="vol-field">Zone<select id="vol-top" value={setup.top} onChange={(event) => { const top = event.target.value, bases = below(top); setSetup((current) => ({ ...current, top, base: bases.some((entry) => entry.name === current.base) ? current.base : bases[0]?.name ?? current.base, crest: null, contact: null })); }}>{names.map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></label>
      <label className="vol-field">to<select id="vol-base" value={setup.base} onChange={(event) => setSetup((current) => ({ ...current, base: event.target.value }))}>{below(setup.top).map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></label>
      <span className="log-sets" role="group" aria-label="Fluid">
        {(["oil", "gas"] as const).map((fluid) => <button key={fluid} type="button" aria-pressed={setup.fluid === fluid} onClick={() => setSetup((current) => ({ ...current, fluid, ranges: { ...current.ranges, fvf: undefined } }))}>{fluid === "oil" ? "Oil" : "Gas"}</button>)}
      </span>
      {trap && trap.deepest > trap.crestDepth + 1 && <label className="tie-slider vol-contact">{setup.fluid === "oil" ? "OWC" : "GWC"} <b>{fmt(Math.round(contact))} m</b>
        <input id="vol-contact" type="range" min={Math.ceil(trap.crestDepth + 1)} max={Math.floor(trap.deepest)} step={1} value={Math.round(contact)} onChange={(event) => setSetup((current) => ({ ...current, contact: Number(event.target.value) }))} /></label>}
    </>}
    numbers={result ? <>{([["P90", result.p90], ["P50", result.p50], ["P10", result.p10]] as const).map(([name, v]) => <span key={name}><small>{name}</small><b>{show(volume(v, setup.fluid).big)}</b></span>)}<em>{volume(0, setup.fluid).unit} {fluidName}</em></>
      : trap ? <span title={!trap.closes ? `This high has under ${MIN_RELIEF} m of closure on the wells alone: no trap the map can measure.` : "The deepest contact the closure holds before it spills"}><small>{trap.spill === null ? "does not close" : trap.closes ? "spill" : "no trap"}</small><b>{trap.spill === null ? "open" : `${fmt(Math.round(trap.spill))} m`}</b></span> : undefined}
    canvas={!map || !trap ? <p className="hz-empty">Fewer than three of this area&apos;s wells reach {setup.top}: nothing to map. Choose another zone.</p> : <div className="vol-split">
      <section className="tie-3d vol-3d" aria-label="The zone in 3D">
        <Suspense fallback={<Loading>Starting the 3D map…</Loading>}>
          <SiteScene key={`${area}-${setup.top}-${setup.base}`} title={`${setup.top} in 3D`} depthLabel={site.depthLabel} originLabel={site.originLabel} wells={wells} surfaces={surfaces} fence={fence} initialExaggeration={10} legend={false} />
        </Suspense>
      </section>
      <div className="vol-mapcol">
        <ZoneMap zone={zone} map={map} highs={map.highs} crest={trap.crest} mask={closed?.mask ?? null} contact={contact} fluid={setup.fluid} onCrest={(node) => setSetup((current) => ({ ...current, crest: [map.frame.x0 + (node % map.frame.nx) * map.frame.cell, map.frame.y0 + Math.floor(node / map.frame.nx) * map.frame.cell], contact: null }))} />
        {closed && <dl className="vol-trap">
          <div><dt>Crest</dt><dd>{fmt(Math.round(trap.crestDepth))} m</dd></div>
          <div><dt>Column</dt><dd>{fmt(Math.round(contact - trap.crestDepth))} m</dd></div>
          <div><dt>Area</dt><dd>{(closed.cells * map.frame.cell ** 2 / 1e6).toFixed(1)} km²</dd></div>
          <div><dt>Rock volume</dt><dd>{show(readCurve(trap.curve.contacts, trap.curve.volumes, contact) / 1e9)} km³</dd></div>
        </dl>}
      </div>
    </div>}
    inspector={map && trap ? <Inspector id="volumetrics" initial="volumes" head={warnings} sections={[
      result && { id: "volumes", title: "Volumes", summary: `P50 ${show(volume(result.p50, setup.fluid).big)} ${volume(0, setup.fluid).unit}`, body: <Results result={result} swings={swings} fluid={setup.fluid} /> },
      { id: "ranges", title: "Ranges", summary: "low · most likely · high", body: ranges },
      { id: "wells", title: "Wells in the zone", summary: `${zone.length}${interpretable ? ` · ${interpretable} ✎` : ""}`, body: <>
        {interpretable > 0 && <label className="vol-yours"><input type="checkbox" checked={useYours} onChange={(event) => setUseYours(event.target.checked)} /> Read {interpretable === 1 ? "that well" : `those ${interpretable} wells`} through your Petrophysics interpretation{interpreted ? ` (${interpreted} in use)` : ""}</label>}
        <WellTable zone={zone} petro={petro} />
      </> },
      { id: "method", title: "Method and sources", body: <p className="nodal-hint">{FORCE_SOURCE}. The top is mapped between the wells by thin-plate spline, the thickness likewise; nothing constrains either between wells. FORCE 2020 has no fluid contacts: the contact is yours, a what-if, and the closure is everything above it connected to the crest you click on the map. {interpreted ? `${interpreted} well${interpreted === 1 ? " is" : "s are"} read through your Petrophysics interpretation (marked ✎). The others: ` : ""}net rock is shale volume (gamma ray, linear) under 40% and porosity (density, with neutron where logged) over 10%; water saturation by Archie (a 1, m 2, n 2, Rw 0.05 Ω·m) with Sw under 0.6. {fluidName} = rock volume × N/G × φ × (1 − Sw) ÷ {setup.fluid === "oil" ? "Bo" : "Bg"}, sampled 4,000 times; P90 is the volume exceeded in 90% of the runs.</p> },
    ]} /> : undefined}
    status={<Status items={[
      "Click a closed high (▲) on the map to measure it · drag the contact in the toolbar",
      "FORCE 2020 has no fluid contacts: the contact is yours, a what-if",
    ]} />} />;
}

/** The zone's top from above: depth-coloured, contoured every 50 m, the closure shaded, its contact outlined; click to grow the closure from another crest. */
function ZoneMap({ zone, map, highs, crest, mask, contact, fluid, onCrest }: {
  readonly zone: readonly ZoneWell[]; readonly map: { readonly frame: GridFrame; readonly top: Float32Array; readonly support: Uint8Array; readonly lo: number; readonly hi: number };
  readonly highs: readonly { readonly crest: number; readonly depth: number; readonly spill: number }[];
  readonly crest: number; readonly mask: Uint8Array | null; readonly contact: number; readonly fluid: Fluid; readonly onCrest: (node: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, size] = useSize<HTMLDivElement>();
  const { frame, top, lo, hi } = map;
  const W = Math.max(200, size.width), H = Math.round(W * (frame.ny - 1) / (frame.nx - 1));
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    element.width = frame.nx; element.height = frame.ny;
    const context = element.getContext("2d")!, image = context.createImageData(frame.nx, frame.ny);
    const tint = fluid === "oil" ? [52, 211, 153] : [248, 113, 113];
    for (let j = 0; j < frame.ny; j++) for (let i = 0; i < frame.nx; i++) {
      const k = j * frame.nx + i, at = ((frame.ny - 1 - j) * frame.nx + i) * 4, z = top[k]!;
      let [r, g, b] = depthColour((z - lo) / Math.max(1, hi - lo)).map((v) => v * 255) as [number, number, number];
      // Beyond the wells the map is the regional dip only: dimmed, as a guess.
      if (!map.support[k]) { const grey = (r + g + b) / 3; r = grey * 0.35; g = grey * 0.35; b = grey * 0.4; }
      if (mask?.[k]) { r = r * 0.35 + tint[0]! * 0.65; g = g * 0.35 + tint[1]! * 0.65; b = b * 0.35 + tint[2]! * 0.65; }
      image.data.set([r, g, b, 255], at);
    }
    context.putImageData(image, 0, 0);
  }, [frame, top, lo, hi, mask, fluid]);
  const x = (v: number) => (v - frame.x0) / (frame.cell * (frame.nx - 1)) * W, y = (v: number) => H - (v - frame.y0) / (frame.cell * (frame.ny - 1)) * H;
  const rings = mask ? levelLines(top, frame, contact, mask) : [];
  // Contours as lines, every 50 m and bolder every 250 m: drawn, not stepped from the grid's cells.
  const contours = useMemo(() => {
    const out: { level: number; lines: [number, number][][] }[] = [];
    for (let level = Math.ceil(lo / 50) * 50; level < hi; level += 50) out.push({ level, lines: levelLines(top, frame, level) });
    return out;
  }, [top, frame, lo, hi]);
  const ci = crest % frame.nx, cj = Math.floor(crest / frame.nx);
  const km = 10_000, bar = km / (frame.cell * (frame.nx - 1)) * W;
  return <figure className="hz-map vol-map" ref={box}>
    <figcaption><b>Top depth</b><span>contours every 50 m · click to choose the crest</span></figcaption>
    <div className="hz-map-stage" style={{ height: H, cursor: "crosshair" }} onClick={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const i = Math.round((event.clientX - rect.left) / W * (frame.nx - 1)), j = Math.round((1 - (event.clientY - rect.top) / H) * (frame.ny - 1));
      onCrest(Math.min(frame.ny - 1, Math.max(0, j)) * frame.nx + Math.min(frame.nx - 1, Math.max(0, i)));
    }}>
      <canvas ref={canvas} style={{ width: W, height: H }} />
      <svg width={W} height={H}>
        {contours.map(({ level, lines }) => lines.map((line, i) => <polyline key={`${level}-${i}`} points={line.map(([px, py]) => `${x(px).toFixed(1)},${y(py).toFixed(1)}`).join(" ")} className={`vol-contour${level % 250 === 0 ? " is-index" : ""}`} />))}
        {rings.map((ring, i) => <polyline key={i} points={ring.map(([px, py]) => `${x(px).toFixed(1)},${y(py).toFixed(1)}`).join(" ")} className="vol-ring" style={{ stroke: FLUID_COLOUR[fluid] }} />)}
        {(() => { const shown = placeLabels(zone.map((entry) => ({ x: x(entry.x) + 5, y: y(entry.y) - 4, text: entry.well.name })), { charW: 6.2 }); return zone.map((entry, i) => <g key={entry.well.id} transform={`translate(${x(entry.x)},${y(entry.y)})`}><circle r={3.5} />{shown[i] ? <text x={5} y={-4}>{entry.well.name}</text> : <title>{entry.well.name}</title>}</g>); })()}
        {highs.filter((high) => high.crest !== crest).map((high) => <g key={high.crest} transform={`translate(${x(frame.x0 + (high.crest % frame.nx) * frame.cell)},${y(frame.y0 + Math.floor(high.crest / frame.nx) * frame.cell)})`} className="vol-high">
          <title>{`A closed high: crest ${fmt(Math.round(high.depth))} m, spills at ${fmt(Math.round(high.spill))} m. Click to use it.`}</title>
          <path d="M0,-5 L4.5,3 L-4.5,3 Z" /><text x={6} y={3}>{fmt(Math.round(high.spill - high.depth))} m</text></g>)}
        <g transform={`translate(${x(frame.x0 + ci * frame.cell)},${y(frame.y0 + cj * frame.cell)})`} className="vol-crest"><path d="M0,-7 L6,4 L-6,4 Z" /></g>
        <g transform={`translate(10,${H - 10})`} className="vol-scale"><line x1={0} x2={bar} /><text x={bar + 4} y={3}>10 km</text></g>
      </svg>
    </div>
    <div className="hz-ramp"><span>{fmt(Math.round(lo))} m</span><i style={{ background: `linear-gradient(90deg, ${[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => `rgb(${depthColour(t).map((v) => Math.round(v * 255)).join(",")})`).join(", ")})` }} /><span>{fmt(Math.round(hi))} m TVDSS</span></div>
  </figure>;
}

/** The volumes: how likely each is to be exceeded, and which inputs move it most. */
function Results({ result, swings, fluid }: { readonly result: ReturnType<typeof monteCarlo>; readonly swings: ReturnType<typeof tornado>; readonly fluid: Fluid }) {
  const [box, size] = useSize<HTMLDivElement>();
  const W = Math.max(220, size.width), H = 120, pad = 28;
  const runs = result.runs, max = runs[runs.length - 1]! || 1, u = (v: number) => volume(v, fluid).big;
  const x = (v: number) => pad + v / max * (W - pad - 8), y = (p: number) => 8 + (1 - p) * (H - 28);
  const step = Math.max(1, Math.floor(runs.length / 200));
  let d = "";
  for (let r = 0; r < runs.length; r += step) d += `${r ? "L" : "M"}${x(runs[r]!).toFixed(1)},${y(1 - r / runs.length).toFixed(1)}`;
  const base = result.mostLikely, span = Math.max(...swings.map((s) => s.high), base) - Math.min(...swings.map((s) => s.low), base) || 1, lo = Math.min(...swings.map((s) => s.low), base);
  const tx = (v: number) => 110 + (v - lo) / span * (W - 190);
  return <figure className="hz-section vol-results" ref={box}>
    <figcaption><b>Chance of exceeding</b><span>mean {show(u(result.mean))} · most likely {show(u(base))} {volume(0, fluid).unit}</span></figcaption>
    <svg width={W} height={H} className="vol-scurve">
      <line x1={pad} x2={W - 8} y1={y(0)} y2={y(0)} className="vol-axis" /><line x1={pad} x2={pad} y1={y(0)} y2={y(1)} className="vol-axis" />
      <path d={d} className="vol-curve" style={{ stroke: FLUID_COLOUR[fluid] }} />
      {([["P90", result.p90, 0.9], ["P50", result.p50, 0.5], ["P10", result.p10, 0.1]] as const).map(([name, v, p]) => <g key={name}>
        <line x1={x(v)} x2={x(v)} y1={y(0)} y2={y(p)} className="vol-mark" /><circle cx={x(v)} cy={y(p)} r={3} style={{ fill: FLUID_COLOUR[fluid] }} />
        <text x={x(v) + 4} y={y(p) - 4} className="vol-label">{name} {show(u(v))}</text>
      </g>)}
      <text x={4} y={y(1) + 4} className="vol-tick">100%</text><text x={4} y={y(0)} className="vol-tick">0%</text>
      <text x={W - 8} y={H - 4} className="vol-tick" textAnchor="end">{volume(0, fluid).unit}</text>
    </svg>
    <svg width={W} height={swings.length * 18 + 8} className="vol-tornado">
      <line x1={tx(base)} x2={tx(base)} y1={0} y2={swings.length * 18 + 4} className="vol-mark" />
      {swings.map((s, i) => <g key={s.name} transform={`translate(0,${i * 18 + 4})`}>
        <text x={104} y={11} textAnchor="end" className="vol-tick">{LABEL[s.name]}</text>
        <rect x={tx(s.low)} y={2} width={Math.max(1, tx(s.high) - tx(s.low))} height={12} rx={3} style={{ fill: FLUID_COLOUR[fluid] }} className="vol-bar" />
        <text x={tx(s.high) + 4} y={11} className="vol-tick">{show(u(s.low))}–{show(u(s.high))}</text>
      </g>)}
    </svg>
  </figure>;
}

/** The wells in the zone: where they meet it and what their logs read there. */
function WellTable({ zone, petro }: { readonly zone: readonly ZoneWell[]; readonly petro: ReadonlyMap<string, ZonePetro & { readonly by?: string }> }) {
  const rows = [...zone].sort((a, b) => a.top - b.top);
  return <div className="vol-wells">
    <table>
      <thead><tr><th>Well</th><th>Top m</th><th>Thick m</th><th>N/G</th><th>φ</th><th>Pay m</th></tr></thead>
      <tbody>{rows.map((entry) => { const p = petro.get(entry.well.id); return <tr key={entry.well.id} data-pay={p && p.payM >= 10 ? "" : undefined}>
        <td>{entry.well.name}{p?.by === "yours" && <span className="vol-mine" title="Read through your Petrophysics interpretation"> ✎</span>}</td><td>{fmt(Math.round(entry.top))}</td><td>{entry.base === null ? "–" : fmt(Math.round(entry.base - entry.top))}</td>
        <td>{p ? p.ntg.toFixed(2) : "–"}</td><td>{p ? p.porosity.toFixed(2) : "–"}</td><td>{p ? fmt(Math.round(p.payM)) : "–"}</td>
      </tr>; })}</tbody>
    </table>
  </div>;
}

