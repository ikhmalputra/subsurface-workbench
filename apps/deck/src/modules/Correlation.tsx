import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { scaleLinear, scaleLog } from "d3-scale";
import { Check, ChevronLeft, ChevronRight, Crosshair, Eye, EyeOff, Maximize2, WandSparkles, X } from "lucide-react";
import { useDeck, actions } from "../deck/store.ts";
import { fmt } from "../format.ts";
import { FORCE_SOURCE, LITHOLOGY, areaWells, busId, forceWellByBusId, mdAtTvdss, mdOf, sampleAt, tvdssAt, useForceLogs } from "../data/force.ts";
import type { ForceLogs, ForceWell } from "../data/force.ts";
import { flattenAt, matchPick, topsOf } from "../data/force-model.ts";
import type { Top } from "../data/force-model.ts";
import { removePick, setPick, usePicks } from "../data/picks.ts";
import { useSize } from "./useSize.ts";
import { LithologyLegend, LithologyPatterns, lithologyFill } from "./lithology-patterns.tsx";
import { Frame, Inspector, Status } from "./frame/Frame.tsx";
import { useWire } from "./wire.ts";
import { Section3D } from "./Section3D.tsx";

/**
 * Correlation: a section through a field's wells, built on its map. The wells stand side by side
 * on their logs, the Directorate's tops joined from well to well; hover a top to light it in every
 * well with its thickness below, click it to flatten the section on it, arm it to pick your own.
 * The deck's well is the highlighted column, and the depth cursor is one level across every well.
 */

const MAX_WELLS = 8;
const KEY = "deck-correlation-v2";
type Track = "res" | "dn" | "sonic";
type Spacing = "equal" | "distance";
const TRACK_NAME: Readonly<Record<Track, string>> = { res: "Resistivity", dn: "Density–neutron", sonic: "Sonic" };
interface Setup { readonly ids: readonly string[]; readonly flatten: string | null; readonly track: Track; readonly spacing: Spacing; readonly shown: readonly string[]; readonly view?: "panel" | "3d" }
const reduceMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Stored sections, each kept only if it still has the shape this code reads: a bad one is dropped rather than crash the module on every load. */
function readSetups(): Record<string, Setup> {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Partial<Setup>>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const strings = (list: unknown) => Array.isArray(list) && list.every((entry) => typeof entry === "string");
    return Object.fromEntries(Object.entries(value).filter(([, setup]) => setup && strings(setup.ids) && strings(setup.shown) && (setup.flatten === null || typeof setup.flatten === "string")
      && (["res", "dn", "sonic"] as unknown[]).includes(setup.track) && (["equal", "distance"] as unknown[]).includes(setup.spacing))) as Record<string, Setup>;
  } catch { return {}; }
}
function writeSetup(area: string, setup: Setup) { try { localStorage.setItem(KEY, JSON.stringify({ ...readSetups(), [area]: setup })); } catch { /* not kept */ } }

const distanceKm = (a: ForceWell, b: ForceWell) => a.utm && b.utm ? Math.hypot(a.utm[0] - b.utm[0], a.utm[1] - b.utm[1]) / 1000 : null;

/** Per well: TVDSS of every log sample, once. */
const levelsCache = new WeakMap<ForceWell, Float32Array>();
function sampleTvdss(well: ForceWell) {
  let levels = levelsCache.get(well);
  if (!levels) { levels = new Float32Array(well.n); for (let k = 0; k < well.n; k++) levels[k] = tvdssAt(well, mdOf(well, k)); levelsCache.set(well, levels); }
  return levels;
}

/** Picks the deck proposes for a top from one well's GR pattern: one per other well, with its match score. Nothing is a pick until accepted. */
interface Suggestion { readonly name: string; readonly from: string; readonly picks: ReadonlyMap<string, { readonly md: number; readonly r: number }> }
/** Match scores: what the deck calls them, measured against the Directorate's own picks in this data set. */
/** Graded on the score as shown (two decimals), so a label never disagrees with its number. */
const strength = (r: number) => { const shown = Math.round(r * 100) / 100; return shown >= 0.85 ? "strong" : shown >= 0.7 ? "fair" : "weak"; };
/** A top in a well as the panel reads it: your pick first, then the Directorate's. */
const topIn = (list: readonly Top[] | undefined, name: string) => list?.find((top) => top.name === name && top.kind === "yours") ?? list?.find((top) => top.name === name);

/** A top on the section: its name, kind and colour, and in how many of the wells it is. */
interface Entry { readonly name: string; readonly kind: Top["kind"]; readonly colour: string; readonly wells: number; readonly order: number; readonly group: string | null; readonly yours: boolean }

export function Correlation() {
  const wire = useWire("correlate");
  const area = useDeck((deck) => deck.siteId)!;
  const placeWell = wire.place?.wellId ?? null;
  const all = useMemo(() => areaWells(area), [area]);
  const here = forceWellByBusId(placeWell);
  const [setup, setSetupState] = useState<Setup>(() => {
    const kept = readSetups()[area];
    const ids = kept?.ids.filter((id) => all.some((well) => well.id === id)) ?? [];
    if (kept && ids.length) return { ...kept, ids };
    // A first section: the deck's well and its three nearest neighbours, west to east.
    const first = here ?? all[0]!;
    const near = all.filter((well) => well !== first).sort((a, b) => (distanceKm(first, a) ?? 1e9) - (distanceKm(first, b) ?? 1e9)).slice(0, 3);
    const ids4 = [first, ...near].sort((a, b) => (a.utm?.[0] ?? 0) - (b.utm?.[0] ?? 0)).map((well) => well.id);
    return { ids: ids4, flatten: null, track: "res", spacing: "equal", shown: [] };
  });
  const setSetup = (change: (current: Setup) => Setup) => setSetupState((current) => { const next = change(current); writeSetup(area, next); return next; });
  const shown = useMemo(() => setup.ids.map((id) => all.find((well) => well.id === id)).filter((well): well is ForceWell => !!well), [setup.ids, all]);
  const { logs, errors } = useForceLogs(shown);
  const picks = usePicks();
  const tops = useMemo(() => new Map(shown.map((well) => [well.id, topsOf(well, picks[busId(well)] ?? [])])), [shown, picks]);
  // The deck's own well is always on the section.
  useEffect(() => { if (here && !setup.ids.includes(here.id)) setSetup((current) => ({ ...current, ids: [...current.ids, here.id].slice(-MAX_WELLS) })); }, [here?.id]);

  // Every top on the section, in depth order, each formation under its group.
  const entries = useMemo((): readonly Entry[] => {
    const byName = new Map<string, { kind: Top["kind"]; colour: string; wells: Set<string>; depths: number[]; group: string | null; yours: boolean }>();
    for (const [id, list] of tops) for (const top of list) {
      const entry = byName.get(top.name) ?? { kind: top.kind, colour: top.colour, wells: new Set<string>(), depths: [], group: null, yours: false };
      if (top.kind === "yours") entry.yours = true;
      if (top.kind === "group") { entry.kind = "group"; entry.colour = top.colour; }
      if (top.kind === "formation" && !entry.group) entry.group = [...list].filter((other) => other.kind === "group" && other.tvdss <= top.tvdss + 0.01).at(-1)?.name ?? null;
      entry.wells.add(id); entry.depths.push(top.tvdss); byName.set(top.name, entry);
    }
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
    return [...byName].map(([name, entry]) => ({ name, kind: entry.kind, colour: entry.colour, wells: entry.wells.size, order: median(entry.depths), group: entry.group, yours: entry.yours })).sort((a, b) => a.order - b.order);
  }, [tops]);
  // Which tops are drawn: every group, every top you have picked (a formation's too), and the formations you turn on.
  const visible = useMemo(() => new Set(entries.filter((entry) => entry.kind !== "formation" || entry.yours || setup.shown.includes(entry.name)).map((entry) => entry.name)), [entries, setup.shown]);
  const toggle = (name: string) => setSetup((current) => ({ ...current, shown: current.shown.includes(name) ? current.shown.filter((entry) => entry !== name) : [...current.shown, name] }));
  const flatten = (name: string | null) => setSetup((current) => ({ ...current, flatten: current.flatten === name ? null : name }));

  const [focus, setFocus] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [next, setNext] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  /** Every other well's best GR match, within 40 m of where the top is expected, for the pattern 15 m either side of it in the reference well. */
  const suggest = (name: string) => {
    const has = (well: ForceWell) => !!topIn(tops.get(well.id), name) && !!logs.get(well.id)?.curves.GR;
    const reference = here && shown.includes(here) && has(here) ? here : shown.find(has);
    if (!reference) { setSuggestion(null); setSuggestNote(`No well on the section has both ${name} and a GR log to match from.`); return; }
    const refTop = topIn(tops.get(reference.id), name)!;
    // Where the top is expected: relative to the flattening top where both wells have it, else in absolute depth.
    const refFlat = flattenAt(tops.get(reference.id) ?? [], setup.flatten);
    const found = new Map<string, { md: number; r: number }>();
    for (const well of shown) {
      const gr = logs.get(well.id)?.curves.GR;
      if (well === reference || !gr) continue;
      const own = topIn(tops.get(well.id), name);
      const flat = flattenAt(tops.get(well.id) ?? [], setup.flatten);
      const expected = own ? own.md : mdAtTvdss(well, refFlat !== null && flat !== null ? refTop.tvdss - refFlat + flat : refTop.tvdss);
      const match = matchPick(logs.get(reference.id)!.curves.GR!, sampleAt(reference, refTop.md), gr, sampleAt(well, expected), 30, 80);
      if (match) found.set(well.id, { md: mdOf(well, match.index), r: match.r });
    }
    setSuggestNote(null);
    setSuggestion({ name, from: reference.id, picks: found });
    setFocus(name);
  };
  const accept = (wellId: string) => {
    const pick = suggestion?.picks.get(wellId), well = shown.find((entry) => entry.id === wellId);
    if (!suggestion || !pick || !well) return;
    setPick(busId(well), suggestion.name, pick.md);
    const rest = new Map(suggestion.picks); rest.delete(wellId);
    setSuggestion(rest.size ? { ...suggestion, picks: rest } : null);
  };
  const acceptStrong = () => {
    if (!suggestion) return;
    const rest = new Map(suggestion.picks);
    for (const [id, pick] of suggestion.picks) { const well = shown.find((entry) => entry.id === id); if (well && strength(pick.r) === "strong") { setPick(busId(well), suggestion.name, pick.md); rest.delete(id); } }
    setSuggestion(rest.size ? { ...suggestion, picks: rest } : null);
  };
  const reject = (wellId: string) => { if (!suggestion) return; const rest = new Map(suggestion.picks); rest.delete(wellId); setSuggestion(rest.size ? { ...suggestion, picks: rest } : null); };
  useEffect(() => {
    // Esc first stops picking; only then does it put the tile back (the deck listens after this, in bubbling).
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (armed) { event.preventDefault(); setArmed(null); setNext(null); } else if (suggestion) { event.preventDefault(); setSuggestion(null); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [armed, suggestion]);
  const addWell = (id: string) => setSetup((current) => current.ids.includes(id) || current.ids.length >= MAX_WELLS ? current : { ...current, ids: [...current.ids, id] });
  const removeWell = (id: string) => setSetup((current) => current.ids.length <= 1 ? current : { ...current, ids: current.ids.filter((entry) => entry !== id) });
  const in3d = setup.view === "3d";
  // Picking and suggestions happen on the panel: asking for either brings it back.
  const toPanel = () => setSetup((current) => current.view === "3d" ? { ...current, view: "panel" } : current);
  const toggleWell = (id: string) => setup.ids.includes(id) ? removeWell(id) : addWell(id);
  const visibleNames = useMemo(() => entries.filter((entry) => visible.has(entry.name)).map((entry) => entry.name), [entries, visible]);
  const colours = useMemo(() => new Map(entries.map((entry) => [entry.name, entry.colour])), [entries]);
  const unflattened = setup.flatten ? shown.filter((well) => flattenAt(tops.get(well.id) ?? [], setup.flatten) === null) : [];

  const litho = [...new Set(shown.flatMap((well) => { const l = logs.get(well.id)?.litho; return l ? [...new Set(l)].filter((code) => code >= 0) : []; }))].sort((a, b) => a - b);
  const yours = [...tops.values()].flat().filter((top) => top.kind === "yours").length;
  return <Frame name="correlate" className="cor" title="Correlation" subtitle={`${shown.length} well${shown.length === 1 ? "" : "s"} · ${setup.flatten ? `flattened on ${setup.flatten}` : "hung on sea level"} · FORCE 2020 logs and the Directorate's tops`}
    tools={<>
      <span className="log-sets cor-view" role="group" aria-label="View">
        <button type="button" aria-pressed={!in3d} title="The wells side by side on their logs: read, flatten and pick" onClick={toPanel}>Panel</button>
        <button type="button" aria-pressed={in3d} title="The section standing in its field, with the tops as surfaces" onClick={() => setSetup((current) => ({ ...current, view: "3d" }))}>3D</button>
      </span>
      {!in3d && <>
        <span className={`cor-datum${setup.flatten ? " is-flat" : ""}`}>
          {setup.flatten ? <>Flattened on <b>{setup.flatten}</b><button type="button" aria-label="Back to sea level" title="Back to sea level" onClick={() => flatten(null)}><X size={12} /></button></> : <>Hung on <b>sea level</b></>}
        </span>
        <span className="log-sets" role="group" aria-label="Second track">
          {(["res", "dn", "sonic"] as const).map((track) => <button key={track} type="button" aria-pressed={setup.track === track} onClick={() => setSetup((current) => ({ ...current, track }))}>{TRACK_NAME[track]}</button>)}
        </span>
        <span className="log-sets" role="group" aria-label="Spacing">
          <button type="button" aria-pressed={setup.spacing === "equal"} onClick={() => setSetup((current) => ({ ...current, spacing: "equal" }))}>Equal</button>
          <button type="button" aria-pressed={setup.spacing === "distance"} title="Space the wells by their distance apart along the section" onClick={() => setSetup((current) => ({ ...current, spacing: "distance" }))}>By distance</button>
        </span>
      </>}
      {armed && <span className="cor-armed"><Crosshair size={13} aria-hidden="true" />Picking <b>{armed}</b><button type="button" onClick={() => { setArmed(null); setNext(null); }}>Done <kbd>Esc</kbd></button></span>}
    </>}
    numbers={<><span><small>Wells</small><b>{shown.length}</b></span><span><small>Your picks</small><b>{yours}</b></span></>}
    canvas={<div className="cor-canvas">
      {in3d ? <Section3D area={area} wells={shown} logs={logs} names={visibleNames} colours={colours} focus={focus} picks={picks}
        selectedId={placeWell} onToggle={(id) => { const well = forceWellByBusId(id); if (well && well.area === area) toggleWell(well.id); }} /> : <Panel wells={shown} logs={logs} errors={errors} tops={tops} setup={setup} visible={visible} placeWell={placeWell} area={area} wire={wire}
        focus={focus} onFocus={setFocus} armed={armed} next={next} onFlatten={flatten}
        onPicked={(well) => { const i = shown.indexOf(well); const after = shown.slice(i + 1).concat(shown.slice(0, i)).find((other) => !(tops.get(other.id) ?? []).some((top) => top.kind === "yours" && top.name === armed)); setNext(after?.id ?? null); }}
        onRemove={removeWell} suggestion={suggestion} onAccept={accept} onReject={reject}
        onReorder={(from, to) => setSetup((current) => { const ids = [...current.ids]; const [moved] = ids.splice(from, 1); ids.splice(to, 0, moved!); return { ...current, ids }; })}
        onMove={(id, by) => setSetup((current) => { const ids = [...current.ids]; const i = ids.indexOf(id), j = i + by; if (i < 0 || j < 0 || j >= ids.length) return current; [ids[i], ids[j]] = [ids[j]!, ids[i]!]; return { ...current, ids }; })} />}
      {/* The legend's swatches use the panel's pattern defs; in 3D the panel is gone, so they come along here. */}
      {in3d && <svg width={0} height={0} aria-hidden="true" style={{ position: "absolute" }}><LithologyPatterns /></svg>}
    </div>}
    inspector={<Inspector id="correlate" initial="tops"
      head={suggestion ? <div className="cor-suggest">
        <WandSparkles size={14} aria-hidden="true" />
        <span>{suggestion.picks.size ? <>Suggested <b>{suggestion.name}</b> in {suggestion.picks.size} well{suggestion.picks.size === 1 ? "" : "s"} from the GR pattern around it in <b>{shown.find((well) => well.id === suggestion.from)?.name}</b>. Check each one: accept or drag it.</> : <>No GR match for <b>{suggestion.name}</b> near where it is expected in the other wells.</>}</span>
        {[...suggestion.picks.values()].some((pick) => strength(pick.r) === "strong") && <button type="button" onClick={acceptStrong}>Accept the strong ones</button>}
        <button type="button" className="is-quiet" onClick={() => setSuggestion(null)}>Dismiss <kbd>Esc</kbd></button>
      </div> : suggestNote ? <p className="cor-note">{suggestNote}</p> : undefined}
      sections={[
        { id: "wells", title: "Wells on the section", summary: `${shown.length} of ${all.length}`, body: <WellMap wells={all} section={shown} placeWell={placeWell} onToggle={(well) => toggleWell(well.id)} full={shown.length >= MAX_WELLS} /> },
        { id: "tops", title: "Tops", summary: `${visible.size} shown${setup.flatten ? ` · flat on ${setup.flatten}` : ""}`, body: <>
          <TopsList entries={entries} visible={visible} flattened={setup.flatten} focus={focus} armed={armed} wellCount={shown.length}
            onFocus={setFocus} onToggle={toggle} onFlatten={flatten} onArm={(name) => { setArmed((current) => current === name ? null : name); setNext(null); toPanel(); }}
            suggesting={suggestion?.name ?? null} onSuggest={(name) => { toPanel(); if (suggestion?.name === name) setSuggestion(null); else suggest(name); }} />
          <form className="cor-newtop" onSubmit={(event) => { event.preventDefault(); const name = newName.trim(); if (name) { setArmed(name); setNewName(""); setNext(null); toPanel(); } }}>
            <input id="correlation-new-top" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="New top, e.g. Top Heimdal sand" aria-label="Name a new top to pick" />
            <button type="submit" disabled={!newName.trim()} title="Arm it, then click each well where it is"><Crosshair size={13} aria-hidden="true" /></button>
          </form>
        </> },
        yours > 0 && { id: "picks", title: "Your picks", summary: `${yours}`, body: <YourPicks wells={shown} tops={tops} /> },
        litho.length > 0 && { id: "litho", title: "Lithology", summary: `${litho.length} kinds`, body: <LithologyLegend codes={litho} /> },
      ]} />}
    status={<Status items={[
      armed ? <b className="hz-status-hint">Click {next ? shown.find((well) => well.id === next)?.name ?? "a well" : "a well"} at the depth of {armed}</b>
        : !in3d && unflattened.length > 0 ? `${unflattened.map((well) => well.name).join(", ")}: no ${setup.flatten} top, not drawn while flattened on it`
        : in3d ? "Add wells on the map · click one to take it off · drag to orbit · hover a top to bring its surface up" : "Drag the ruler to zoom · ⇧ drag a GR for a ghost · drag a header to reorder · double-click fits · click a top to flatten on it",
      `${FORCE_SOURCE}. Depths TVD below sea level; bands between wells join the Directorate's picks for reading, not mapped`,
    ]} />} />;
}

// ── The map ──────────────────────────────────────────────────────────────────────────────────

/** The area's wells in plan, the section drawn through the chosen ones in order: click a well to add or take it off. */
function WellMap({ wells, section, placeWell, onToggle, full }: { readonly wells: readonly ForceWell[]; readonly section: readonly ForceWell[]; readonly placeWell: string | null; readonly onToggle: (well: ForceWell) => void; readonly full: boolean }) {
  const W = 232, H = 188, PAD = 16;
  const [hover, setHover] = useState<ForceWell | null>(null);
  const located = wells.filter((well) => well.utm);
  const xs = located.map((well) => well.utm![0]), ys = located.map((well) => well.utm![1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.min((W - 2 * PAD) / (x1 - x0 || 1), (H - 2 * PAD - 14) / (y1 - y0 || 1));
  const px = (well: ForceWell) => [PAD + (well.utm![0] - x0) * k + ((W - 2 * PAD) - (x1 - x0) * k) / 2, H - PAD - 14 - (well.utm![1] - y0) * k] as const;
  const bar = [1, 2, 5, 10, 20, 50].find((km) => km * 1000 * k > 40) ?? 50;
  const line = section.filter((well) => well.utm).map((well) => px(well).join(",")).join(" ");
  const total = section.slice(1).reduce((sum, well, i) => sum + (distanceKm(section[i]!, well) ?? 0), 0);
  return <figure className="cor-map">
    <figcaption><b>Section</b><span>{section.length} wells · {fmt(total, 1)} km</span></figcaption>
    <svg width={W} height={H} role="img" aria-label="Map of the area's wells: click one to add it to the section or take it off">
      <rect className="cor-map-ground" x={0.5} y={0.5} width={W - 1} height={H - 1} rx={10} />
      <polyline className="cor-map-line" points={line} />
      {located.map((well) => {
        const [x, y] = px(well);
        const at = section.indexOf(well);
        const place = busId(well) === placeWell;
        return <g key={well.id} className="cor-map-well" data-on={at >= 0 || undefined} data-place={place || undefined} transform={`translate(${x},${y})`}
          onPointerEnter={() => setHover(well)} onPointerLeave={() => setHover(null)} onClick={() => { if (at >= 0 || !full) onToggle(well); }}>
          <circle r={12} className="cor-map-hit" />
          {at >= 0 ? <><circle r={8} /><text dy="0.34em" textAnchor="middle">{at + 1}</text></> : <circle r={3.2} />}
        </g>;
      })}
      <g className="cor-map-scale" transform={`translate(${PAD},${H - 12})`}><line x2={bar * 1000 * k} /><text x={bar * 1000 * k + 5} dy="0.32em">{bar} km</text></g>
      <text className="cor-map-north" x={W - 14} y={18} textAnchor="middle">N</text>
      <path className="cor-map-north" d={`M${W - 14},22 l-4,10 l4,-3 l4,3 z`} />
    </svg>
    <p className="cor-map-hint">{hover ? <><b>{hover.name}</b> · TD {fmt(hover.mdBase)} m MD · {section.includes(hover) ? "click to take it off" : full ? `the section holds ${MAX_WELLS} wells` : "click to add it"}</> : "Click wells to build the section; numbers are their order."}</p>
  </figure>;
}

// ── The tops ─────────────────────────────────────────────────────────────────────────────────

function TopsList({ entries, visible, flattened, focus, armed, wellCount, onFocus, onToggle, onFlatten, onArm, suggesting, onSuggest }: {
  readonly entries: readonly Entry[]; readonly visible: ReadonlySet<string>; readonly flattened: string | null; readonly focus: string | null; readonly armed: string | null; readonly wellCount: number;
  readonly onFocus: (name: string | null) => void; readonly onToggle: (name: string) => void; readonly onFlatten: (name: string) => void; readonly onArm: (name: string) => void;
  readonly suggesting: string | null; readonly onSuggest: (name: string) => void;
}) {
  const row = (entry: Entry) => <li key={entry.name} className={`cor-toprow is-${entry.kind}`} data-focus={focus === entry.name || undefined} data-flat={flattened === entry.name || undefined} data-armed={armed === entry.name || undefined} data-off={!visible.has(entry.name) || undefined}
    onPointerEnter={() => onFocus(entry.name)} onPointerLeave={() => onFocus(null)}>
    <i style={{ background: entry.colour }} />
    <button type="button" className="cor-topname" onClick={() => onFlatten(entry.name)} disabled={entry.wells < 2 && flattened !== entry.name} title={entry.wells < 2 ? "In one well only: nothing to flatten against" : flattened === entry.name ? "Back to sea level" : `Flatten the section on ${entry.name}`}>{entry.name}</button>
    <small title={`In ${entry.wells} of the ${wellCount} wells`}>{entry.wells}/{wellCount}</small>
    {entry.kind === "formation" && <button type="button" className="cor-icon" aria-label={visible.has(entry.name) ? `Hide ${entry.name}` : `Show ${entry.name}`} onClick={() => onToggle(entry.name)}>{visible.has(entry.name) ? <Eye size={12} /> : <EyeOff size={12} />}</button>}
    <button type="button" className="cor-icon" aria-label={`Suggest ${entry.name} in the other wells from its GR pattern`} aria-pressed={suggesting === entry.name} title="Suggest it in the other wells from the GR pattern around it" onClick={() => onSuggest(entry.name)}><WandSparkles size={12} /></button>
    <button type="button" className="cor-icon" aria-label={`Pick your own ${entry.name}`} aria-pressed={armed === entry.name} title="Pick your own: click each well where it is" onClick={() => onArm(entry.name)}><Crosshair size={12} /></button>
  </li>;
  const groups = entries.filter((entry) => entry.kind === "group");
  const yours = entries.filter((entry) => entry.kind === "yours");
  return <div className="cor-tops">
    <p className="cor-side-title"><b>Tops</b><span>hover to trace · click to flatten</span></p>
    <ul>
      {groups.map((group) => [row(group), ...entries.filter((entry) => entry.kind === "formation" && entry.group === group.name).map(row)])}
      {entries.filter((entry) => entry.kind === "formation" && !groups.some((group) => group.name === entry.group)).map(row)}
    </ul>
    {yours.length > 0 && <><p className="cor-side-title"><b>Yours</b></p><ul>{yours.map(row)}</ul></>}
  </div>;
}

// ── The section ──────────────────────────────────────────────────────────────────────────────

const RULER = 54, HEAD = 78, TRACKS = 40, GAP = 36, MIN_GAP = 26, BOTTOM = 10, LITHO = 7;
type Y = ReturnType<typeof scaleLinear<number, number>>;

/**
 * Moves toward a target over 450 ms when asked to, else jumps: the section slides when its datum
 * changes. `order` names what each value belongs to: when it changes (wells reordered), values jump,
 * so no column slides from the shift of the well that used to stand there.
 */
function useTween(target: readonly number[], animate: boolean, order = ""): readonly number[] {
  const [shown, setShown] = useState(target);
  const current = useRef(target), lastOrder = useRef(order);
  current.current = shown;
  const key = target.map((value) => Number.isFinite(value) ? value.toFixed(3) : "x").join();
  useEffect(() => {
    const from = current.current, reordered = lastOrder.current !== order;
    lastOrder.current = order;
    if (!animate || reordered || reduceMotion() || from.length !== target.length) { setShown(target); return; }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 450), e = 1 - (1 - t) ** 3;
      setShown(target.map((value, i) => Number.isFinite(value) && Number.isFinite(from[i]!) ? from[i]! + (value - from[i]!) * e : value));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [key]);
  return shown.length === target.length ? shown : target;
}

function Panel({ wells, logs, errors, tops, setup, visible, placeWell, area, wire, focus, onFocus, armed, next, onFlatten, onPicked, onRemove, onMove, suggestion, onAccept, onReject, onReorder }: {
  readonly wells: readonly ForceWell[]; readonly logs: ReadonlyMap<string, ForceLogs>; readonly errors: ReadonlyMap<string, string>; readonly tops: ReadonlyMap<string, readonly Top[]>;
  readonly setup: Setup; readonly visible: ReadonlySet<string>; readonly placeWell: string | null; readonly area: string; readonly wire: ReturnType<typeof useWire>;
  readonly focus: string | null; readonly onFocus: (name: string | null) => void; readonly armed: string | null; readonly next: string | null;
  readonly onFlatten: (name: string) => void; readonly onPicked: (well: ForceWell) => void; readonly onRemove: (id: string) => void; readonly onMove: (id: string, by: -1 | 1) => void;
  readonly suggestion: Suggestion | null; readonly onAccept: (wellId: string) => void; readonly onReject: (wellId: string) => void; readonly onReorder: (from: number, to: number) => void;
}) {
  const [box, size] = useSize<HTMLDivElement>();
  const n = wells.length;
  // Columns fill the width; by distance, the gaps between them are the wells' distances apart.
  const colW = Math.max(118, Math.min(setup.spacing === "distance" ? 210 : 320, Math.floor((size.width - RULER - GAP * (n - 1)) / Math.max(1, n))));
  const segs = wells.slice(1).map((well, i) => distanceKm(wells[i]!, well) ?? 0);
  const spare = Math.max(0, size.width - RULER - n * colW - MIN_GAP * (n - 1));
  const total = segs.reduce((sum, km) => sum + km, 0);
  const gaps = segs.map((km) => setup.spacing === "distance" && total > 0 ? MIN_GAP + spare * km / total : GAP);
  const lefts = wells.map((_, i) => RULER + i * colW + gaps.slice(0, i).reduce((sum, gap) => sum + gap, 0));
  const width = Math.max(size.width, (lefts.at(-1) ?? RULER) + colW + 4);
  const height = Math.max(260, size.height);

  // Each well's shift (0 on sea level, its flattening top's TVDSS when flattened) and the section's depth range, sliding together.
  const targetShift = wells.map((well) => flattenAt(tops.get(well.id) ?? [], setup.flatten) ?? NaN);
  const extent = useMemo((): [number, number] => {
    let lo = Infinity, hi = -Infinity;
    wells.forEach((well, i) => { const s = targetShift[i]!; if (Number.isNaN(s)) return; lo = Math.min(lo, tvdssAt(well, well.mdTop) - s); hi = Math.max(hi, tvdssAt(well, well.mdBase) - s); });
    return Number.isFinite(lo) ? [lo - 10, hi + 10] : [0, 1000];
  }, [wells.map((well) => well.id).join(), targetShift.join()]);
  const [view, setView] = useState<readonly [number, number] | null>(null);
  const [animate, setAnimate] = useState(false);
  const lastFlatten = useRef(setup.flatten);
  if (lastFlatten.current !== setup.flatten) { lastFlatten.current = setup.flatten; if (view) setView(null); if (!animate) setAnimate(true); }
  const target = view ?? extent;
  const tweened = useTween([...targetShift, target[0], target[1]], animate, wells.map((well) => well.id).join());
  const shifts = tweened.slice(0, n), domain: readonly [number, number] = [tweened[n]!, tweened[n + 1]!];
  const y = scaleLinear().domain(domain).range([HEAD + TRACKS, height - BOTTOM]);
  const drawn = wells.map((well, i) => ({ well, i, shift: shifts[i]! })).filter((entry) => Number.isFinite(entry.shift));

  const [hover, setHover] = useState<{ level: number; well: string | null } | null>(null);
  const [overTop, setOverTop] = useState<string | null>(null);
  const [brush, setBrushState] = useState<readonly [number, number] | null>(null);
  const brushing = useRef<readonly [number, number] | null>(null);
  const setBrush = (next: readonly [number, number] | null) => { brushing.current = next; setBrushState(next); };
  const drag = useRef<{ wellId: string; name: string } | null>(null);
  const pan = useRef<{ startY: number; domain: readonly [number, number] } | null>(null);
  // A ghost: an interval of one well's GR, Shift-dragged out of its track, carried over the others to compare.
  const [ghostSel, setGhostSelState] = useState<{ wellId: string; a: number; b: number } | null>(null);
  const selecting = useRef<{ wellId: string; a: number; b: number } | null>(null);
  const setGhostSel = (next: { wellId: string; a: number; b: number } | null) => { selecting.current = next; setGhostSelState(next); };
  const [ghost, setGhost] = useState<{ from: string; top: number; base: number; dropped: { wellId: string; level: number } | null } | null>(null);
  // A well's header dragged sideways: the well moves along the section.
  const [reorder, setReorderState] = useState<{ from: number; x: number; dx: number; active: boolean } | null>(null);
  const reordering = useRef<{ from: number; x: number; dx: number; active: boolean } | null>(null);
  const setReorder = (next: { from: number; x: number; dx: number; active: boolean } | null) => { reordering.current = next; setReorderState(next); };
  useEffect(() => {
    if (!ghost) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setGhost(null); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ghost]);

  const deckIndex = wells.findIndex((well) => busId(well) === placeWell);
  const deckWell = deckIndex >= 0 && Number.isFinite(shifts[deckIndex]!) ? wells[deckIndex]! : null;
  const deckShift = deckWell ? shifts[deckIndex]! : 0;
  const cursorLevel = hover?.level ?? (deckWell && wire.cursor !== null ? tvdssAt(deckWell, wire.cursor) - deckShift : null);
  const pinnedLevel = deckWell && wire.pinned !== null ? tvdssAt(deckWell, wire.pinned) - deckShift : null;
  const mdIn = (i: number, level: number) => mdAtTvdss(wells[i]!, level + shifts[i]!);

  const at = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left, level = y.invert(event.clientY - rect.top);
    const column = drawn.find(({ i }) => x >= lefts[i]! && x <= lefts[i]! + colW) ?? null;
    return { x, level, column };
  };
  /** The visible top under the pointer, in its column, within a few pixels. */
  const topAt = (column: { well: ForceWell; shift: number } | null, level: number) => {
    if (!column) return null;
    const py = y(level);
    return (tops.get(column.well.id) ?? []).filter((top) => visible.has(top.name)).map((top) => ({ top, d: Math.abs(y(top.tvdss - column.shift) - py) })).filter((entry) => entry.d < 5).sort((a, b) => a.d - b.d)[0]?.top ?? null;
  };

  // ⌘/Ctrl + wheel zooms about the pointer, a wheel pans in depth.
  const wheel = useRef({ domain, extent, height });
  wheel.current = { domain, extent, height };
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const { domain: [a, b], extent: [lo, hi], height: h } = wheel.current, span = b - a;
      const scale = scaleLinear().domain([a, b]).range([HEAD + TRACKS, h - BOTTOM]);
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const level = scale.invert(event.clientY - element.getBoundingClientRect().top);
        const next = Math.max(15, Math.min(hi - lo + 400, span * Math.exp(event.deltaY * 0.0015)));
        setAnimate(false); setView([level - (level - a) * next / span, level + (b - level) * next / span]);
      } else if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        event.preventDefault();
        const d = event.deltaY / (h - HEAD - TRACKS - BOTTOM) * span;
        setAnimate(false); setView([a + d, b + d]);
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [box]);

  const focused = focus ?? overTop;
  const fit = () => { setAnimate(true); setView(null); };
  return <div className="cor-stage" ref={box}>
    <svg width={width} height={height} className="cor-svg" role="img" aria-label={`Correlation of ${wells.map((well) => well.name).join(", ")}`}
      data-picking={armed ? "" : undefined} data-over-top={overTop && !armed ? "" : undefined}
      onPointerMove={(event) => {
        const { x, level, column } = at(event);
        const grab = reordering.current;
        if (grab) {
          const dx = event.clientX - grab.x;
          if (!grab.active && Math.abs(dx) > 6) event.currentTarget.setPointerCapture(event.pointerId);
          setReorder({ ...grab, dx, active: grab.active || Math.abs(dx) > 6 });
          return;
        }
        if (selecting.current) { setGhostSel({ ...selecting.current, b: level }); return; }
        if (brushing.current) { setBrush([brushing.current[0], level]); return; }
        if (pan.current) { const d = (pan.current.startY - event.clientY) / (height - HEAD - TRACKS - BOTTOM) * (pan.current.domain[1] - pan.current.domain[0]); setAnimate(false); setView([pan.current.domain[0] + d, pan.current.domain[1] + d]); return; }
        if (drag.current) { const i = wells.findIndex((well) => well.id === drag.current!.wellId); if (i >= 0) setPick(busId(wells[i]!), drag.current.name, Math.max(wells[i]!.mdTop, Math.min(wells[i]!.mdBase, mdIn(i, level)))); }
        setHover(x > RULER ? { level, well: column?.well.id ?? null } : null);
        const over = armed ? null : topAt(column, level)?.name ?? null;
        if (over !== overTop) { setOverTop(over); onFocus(over); }
        if (deckWell && x > RULER) wire.hover(Math.max(0, mdIn(deckIndex, level)));
      }}
      onPointerLeave={() => {
        // A grab that never became a drag (it is captured once it does) ends when the pointer leaves: released outside, it would otherwise stay stuck.
        if (reordering.current && !reordering.current.active) setReorder(null);
        setHover(null); if (overTop) { setOverTop(null); onFocus(null); } wire.hover(null); }}
      onPointerDown={(event) => {
        // A press on a well's header may become a drag along the section; its buttons keep their clicks.
        if ((event.target as Element).closest(".cor-colhead")) {
          const i = wells.findIndex((_, k) => event.clientX - event.currentTarget.getBoundingClientRect().left >= lefts[k]! && event.clientX - event.currentTarget.getBoundingClientRect().left <= lefts[k]! + colW);
          if (i >= 0 && !(event.target as Element).closest(".cor-tools")) setReorder({ from: i, x: event.clientX, dx: 0, active: false });
          return;
        }
        const { x, level, column } = at(event);
        event.currentTarget.setPointerCapture(event.pointerId);
        if (x <= RULER) { setBrush([level, level]); return; }
        if (ghost && !ghost.dropped && column) { setGhost({ ...ghost, dropped: { wellId: column.well.id, level } }); return; }
        if (event.shiftKey && column && x - lefts[column.i]! <= colW / 2) { setGhost(null); setGhostSel({ wellId: column.well.id, a: level, b: level }); return; }
        if (armed && column) {
          const mine = (tops.get(column.well.id) ?? []).find((top) => top.kind === "yours" && Math.abs(y(top.tvdss - column.shift) - y(level)) < 6);
          drag.current = { wellId: column.well.id, name: mine?.name ?? armed };
          setPick(busId(column.well), drag.current.name, Math.max(column.well.mdTop, Math.min(column.well.mdBase, mdIn(column.i, level))));
          return;
        }
        if (event.button === 1) { pan.current = { startY: event.clientY, domain }; return; }
        const top = topAt(column, level);
        if (top) { onFlatten(top.name); return; }
        if (deckWell) wire.pin(Math.max(0, mdIn(deckIndex, level)));
      }}
      onPointerUp={() => {
        const grab = reordering.current;
        if (grab) {
          setReorder(null);
          if (grab.active) {
            const centre = lefts[grab.from]! + colW / 2 + grab.dx;
            const to = lefts.reduce((best, left, k) => Math.abs(left + colW / 2 - centre) < Math.abs(lefts[best]! + colW / 2 - centre) ? k : best, 0);
            if (to !== grab.from) onReorder(grab.from, to);
          }
          return;
        }
        const sel = selecting.current;
        if (sel) {
          setGhostSel(null);
          const i = wells.findIndex((well) => well.id === sel.wellId);
          const [a, b] = [Math.min(sel.a, sel.b), Math.max(sel.a, sel.b)];
          if (i >= 0 && b - a > 3) setGhost({ from: sel.wellId, top: mdIn(i, a), base: mdIn(i, b), dropped: null });
          return;
        }
        if (brushing.current) { const [a, b] = [Math.min(...brushing.current), Math.max(...brushing.current)]; setBrush(null); if (b - a > 5) { setAnimate(true); setView([a, b]); } }
        if (drag.current) { const well = wells.find((entry) => entry.id === drag.current!.wellId); drag.current = null; if (well) onPicked(well); }
        pan.current = null;
      }}
      onDoubleClick={fit}>
      <LithologyPatterns />
      <Ruler y={y} height={height} flatten={setup.flatten} brush={brush} />
      <defs><clipPath id="cor-body"><rect x={RULER} y={HEAD + TRACKS} width={width} height={Math.max(0, height - HEAD - TRACKS - BOTTOM)} /></clipPath></defs>
      <g clipPath="url(#cor-body)"><Gaps drawn={drawn} tops={tops} visible={visible} focused={focused} y={y} lefts={lefts} colW={colW} /></g>
      <GapDistances wells={wells} lefts={lefts} colW={colW} />
      {wells.map((well, i) => {
        const shift = shifts[i]!;
        const moving = reorder?.active && reorder.from === i;
        return <g key={well.id} transform={`translate(${lefts[i]! + (moving ? reorder.dx : 0)},0)`} className={moving ? "cor-moving" : undefined}>
          <Head well={well} prev={wells[i - 1] ?? null} place={busId(well) === placeWell} next={next === well.id} colW={colW} first={i === 0} last={i === n - 1}
            onChoose={() => actions.selectSite(area, busId(well), "correlate")} onRemove={n > 1 ? () => onRemove(well.id) : null} onMove={(by) => onMove(well.id, by)} />
          <TrackHead colW={colW} track={setup.track} />
          {Number.isFinite(shift)
            ? <Column well={well} logs={logs.get(well.id) ?? null} error={errors.get(well.id) ?? null} tops={tops.get(well.id) ?? []} visible={visible} focused={focused} shift={shift} y={y} colW={colW} height={height} track={setup.track} place={busId(well) === placeWell} hovered={hover?.well === well.id}
              suggestion={suggestion?.picks.get(well.id) ?? null} suggested={suggestion?.name ?? null} reference={suggestion?.from === well.id} onAccept={() => onAccept(well.id)} onReject={() => onReject(well.id)} />
            : <text className="cor-missing" x={colW / 2} y={HEAD + TRACKS + 40} textAnchor="middle">No {setup.flatten} top</text>}
        </g>;
      })}
      {pinnedLevel !== null && <line className="cor-pinned" x1={RULER} x2={width} y1={y(pinnedLevel)} y2={y(pinnedLevel)} />}
      {cursorLevel !== null && <Cursor level={cursorLevel} y={y} drawn={drawn} logs={logs} tops={tops} lefts={lefts} colW={colW} width={width} flatten={setup.flatten} armed={armed} hoverWell={hover?.well ?? null} />}
      {ghostSel && (() => { const i = wells.findIndex((well) => well.id === ghostSel.wellId); return i >= 0 ? <rect className="cor-ghost-sel" x={lefts[i]} width={colW / 2} y={Math.min(y(ghostSel.a), y(ghostSel.b))} height={Math.abs(y(ghostSel.b) - y(ghostSel.a))} /> : null; })()}
      {ghost && (() => {
        const placed = ghost.dropped ?? (hover?.well ? { wellId: hover.well, level: hover.level } : null);
        const source = wells.find((well) => well.id === ghost.from), target = placed ? wells.findIndex((well) => well.id === placed.wellId) : -1;
        const gr = source ? logs.get(source.id)?.curves.GR : undefined;
        if (!source || !gr || target < 0) return null;
        return <Ghost source={source} gr={gr} top={ghost.top} base={ghost.base} level={placed!.level} x={lefts[target]!} colW={colW} y={y} dropped={!!ghost.dropped} onClear={() => setGhost(null)} />;
      })()}
      {brush && <rect className="cor-brush" x={0} width={width} y={Math.min(y(brush[0]), y(brush[1]))} height={Math.abs(y(brush[1]) - y(brush[0]))} />}
    </svg>
    {ghost && <p className="cor-ghost-hint">{ghost.dropped ? "Ghost dropped: Esc clears it, or Shift-drag another interval" : "Carry the ghost over another well; click to drop it · Esc clears it"}</p>}
    <button type="button" className="cor-fit" onClick={fit} title="Fit the whole section (double-click anywhere)" disabled={!view}><Maximize2 size={13} aria-hidden="true" />Fit</button>
  </div>;
}

function Ruler({ y, height, flatten, brush }: { readonly y: Y; readonly height: number; readonly flatten: string | null; readonly brush: readonly [number, number] | null }) {
  const ticks = y.ticks(Math.max(4, Math.floor((height - HEAD) / 52)));
  return <g className="cor-ruler" data-brushing={brush ? "" : undefined}>
    <rect className="cor-ruler-hit" x={0} y={HEAD + TRACKS} width={RULER} height={height - HEAD - TRACKS} />
    <text x={RULER - 8} y={HEAD + TRACKS - 8} textAnchor="end" className="cor-axis-title">{flatten ? "m from top" : "m TVDSS"}</text>
    {ticks.map((tick) => <g key={tick} transform={`translate(0,${y(tick)})`}><line x1={RULER - 6} x2={RULER} /><text x={RULER - 9} dy="0.32em" textAnchor="end" data-zero={flatten && tick === 0 ? "" : undefined}>{flatten && tick > 0 ? "+" : ""}{fmt(tick)}</text></g>)}
  </g>;
}

function Head({ well, prev, place, next, colW, first, last, onChoose, onRemove, onMove }: {
  readonly well: ForceWell; readonly prev: ForceWell | null; readonly place: boolean; readonly next: boolean; readonly colW: number; readonly first: boolean; readonly last: boolean;
  readonly onChoose: () => void; readonly onRemove: (() => void) | null; readonly onMove: (by: -1 | 1) => void;
}) {
  return <foreignObject x={0} y={4} width={colW} height={HEAD - 8}>
    <div className="cor-colhead" data-place={place || undefined} data-next={next || undefined}>
      <span className="cor-colrow">
        <button type="button" className="cor-name" onClick={onChoose} title={place ? "The deck's well: every module shows it" : `Make ${well.name} the deck's well`}>{well.name}</button>
        <span className="cor-tools">
          {!first && <button type="button" aria-label={`Move ${well.name} left`} onClick={() => onMove(-1)}><ChevronLeft size={12} /></button>}
          {!last && <button type="button" aria-label={`Move ${well.name} right`} onClick={() => onMove(1)}><ChevronRight size={12} /></button>}
          {onRemove && <button type="button" aria-label={`Take ${well.name} off the section`} onClick={onRemove}><X size={12} /></button>}
        </span>
      </span>
      <small>{place ? "deck's well · " : ""}TD {fmt(well.mdBase)} m MD · RKB {well.datumElevationM === null ? "–" : `${fmt(well.datumElevationM)} m`}</small>
      {next ? <em>pick here next</em> : prev ? <em className="cor-km">{fmt(distanceKm(prev, well) ?? 0, 1)} km from {prev.name}</em> : null}
    </div>
  </foreignObject>;
}

/** The scales over each well's two tracks. */
function TrackHead({ colW, track }: { readonly colW: number; readonly track: Track }) {
  const grW = Math.floor(colW / 2), t2x = grW + 4, t2W = colW - t2x;
  // Titles and scale ends only as long as the track is wide: a short title, then the ends alone, never one over the other.
  const fits = (text: string, room: number) => text.length * 5.6 <= room;
  const scale = (x: number, w: number, label: string, short: string, left: string, right: string, colour: string) => <g transform={`translate(${x},${HEAD})`}>
    <text x={w / 2} y={11} textAnchor="middle" className="cor-th">{fits(label, w - 4) ? label : short}</text>
    <line x1={2} x2={w - 2} y1={20} y2={20} stroke={colour} strokeWidth={2} />
    {fits(`${left}  ${right}`, w - 4) ? <><text x={2} y={32} className="cor-th-scale">{left}</text><text x={w - 2} y={32} textAnchor="end" className="cor-th-scale">{right}</text></>
      : fits(right, w - 4) ? <text x={w - 2} y={32} textAnchor="end" className="cor-th-scale">{right}</text> : null}
  </g>;
  return <g className="cor-trackhead">
    {scale(0, grW, "GR · lithology", "GR", "0", "150 API", "var(--ink)")}
    {track === "res" ? scale(t2x, t2W, "Deep · medium Rt", "Rt", "0.2", "200 Ω·m", "#f87171")
      : track === "dn" ? scale(t2x, t2W, "ρb · φN", "ρb·φN", "1.95 / 0.45", "2.95 / −0.15", "#f472b6")
        : scale(t2x, t2W, "DTC", "DTC", "140", "40 µs/ft", "#c084fc")}
  </g>;
}

// ── Drawing a well ───────────────────────────────────────────────────────────────────────────

/** A curve's samples as pixel rows (the row's mean), broken where it was not logged. */
function rows(values: Float32Array, levels: Float32Array, shift: number, y: Y, from = 0, to = values.length - 1): [number, number][][] {
  const [top, bottom] = y.range() as [number, number];
  const runs: [number, number][][] = [];
  let run: [number, number][] = [], row = NaN, sum = 0, count = 0;
  const flush = () => { if (count) run.push([sum / count, row]); sum = 0; count = 0; };
  const end = () => { flush(); if (run.length) runs.push(run); run = []; row = NaN; };
  for (let k = Math.max(0, from); k <= Math.min(values.length - 1, to); k++) {
    const value = values[k]!;
    const py = Math.round(y(levels[k]! - shift));
    if (py < top - 1 || py > bottom + 1) continue;
    if (Number.isNaN(value)) { end(); continue; }
    if (py !== row) { flush(); row = py; }
    sum += value; count++;
  }
  end();
  return runs;
}
const path = (runs: readonly (readonly [number, number])[][], x: (value: number) => number) => runs.map((run) => run.map(([value, py], i) => `${i ? "L" : "M"}${x(value).toFixed(1)},${py}`).join("")).join("");
const fill = (runs: readonly (readonly [number, number])[][], x: (value: number) => number, baseX: number) => runs.filter((run) => run.length > 1).map((run) => `M${baseX},${run[0]![1]}${run.map(([value, py]) => `L${x(value).toFixed(1)},${py}`).join("")}L${baseX},${run.at(-1)![1]}Z`).join("");

function Column({ well, logs, error, tops, visible, focused, shift, y, colW, height, track, place, hovered, suggestion, suggested, reference, onAccept, onReject }: {
  readonly well: ForceWell; readonly logs: ForceLogs | null; readonly error: string | null; readonly tops: readonly Top[]; readonly visible: ReadonlySet<string>; readonly focused: string | null;
  readonly shift: number; readonly y: Y; readonly colW: number; readonly height: number; readonly track: Track; readonly place: boolean; readonly hovered: boolean;
  readonly suggestion: { readonly md: number; readonly r: number } | null; readonly suggested: string | null; readonly reference: boolean; readonly onAccept: () => void; readonly onReject: () => void;
}) {
  const levels = sampleTvdss(well);
  const grW = Math.floor(colW / 2), t2x = grW + 4, t2W = colW - t2x;
  const top = y(tvdssAt(well, well.mdTop) - shift), base = y(tvdssAt(well, well.mdBase) - shift);
  const td = tvdssAt(well, well.mdBase);
  const clip = `cor-clip-${well.id}`;
  const curves = logs?.curves ?? {};
  const gr = scaleLinear().domain([0, 150]).range([LITHO, grW]).clamp(true);
  const groups = tops.filter((entry) => entry.kind === "group");

  // GR filled from the track's left edge to the curve, each stretch in its interpreted lithology's colour.
  const litho: { code: number; d: string }[] = [];
  if (curves.GR) {
    if (logs?.litho) {
      let from = 0;
      for (let k = 1; k <= well.n; k++) if (k === well.n || logs.litho[k] !== logs.litho[from]) {
        const code = logs.litho[from]!;
        if (code >= 0) litho.push({ code, d: fill(rows(curves.GR, levels, shift, y, from, k), gr, LITHO) });
        from = k;
      }
    } else litho.push({ code: -1, d: fill(rows(curves.GR, levels, shift, y), gr, LITHO) });
  }
  const grLine = curves.GR ? path(rows(curves.GR, levels, shift, y), gr) : "";
  const log = scaleLog().domain([0.2, 200]).range([t2x + 2, t2x + t2W - 2]).clamp(true);
  const rho = scaleLinear().domain([1.95, 2.95]).range([t2x + 2, t2x + t2W - 2]).clamp(true);
  const phi = scaleLinear().domain([0.45, -0.15]).range([t2x + 2, t2x + t2W - 2]).clamp(true);
  const dt = scaleLinear().domain([140, 40]).range([t2x + 2, t2x + t2W - 2]).clamp(true);
  // Density–neutron crossover, row by row: where neutron reads right of density (clean or gas-bearing rock).
  let crossover = "";
  if (track === "dn" && curves.RHOB && curves.NPHI) {
    const neutron = new Map(rows(curves.NPHI, levels, shift, y).flat().map(([value, py]) => [py, value]));
    for (const [value, py] of rows(curves.RHOB, levels, shift, y).flat()) { const n = neutron.get(py); if (n !== undefined && phi(n) > rho(value)) crossover += `M${rho(value).toFixed(1)},${py}H${phi(n).toFixed(1)}`; }
  }
  const shownTops = tops.filter((entry) => visible.has(entry.name));
  const focusTop = focused ? shownTops.find((entry) => entry.name === focused) : undefined;
  const below = focusTop ? shownTops.filter((entry) => entry.tvdss > focusTop.tvdss + 0.5).sort((a, b) => a.tvdss - b.tvdss)[0] : undefined;

  return <g data-hovered={hovered || undefined}>
    <defs><clipPath id={clip}><rect x={0} y={HEAD + TRACKS} width={colW} height={Math.max(0, height - HEAD - TRACKS - BOTTOM)} /></clipPath></defs>
    <g clipPath={`url(#${clip})`}>
      {groups.map((entry, i) => {
        const bottom = groups[i + 1]?.tvdss ?? td;
        const h = y(bottom - shift) - y(entry.tvdss - shift);
        return <g key={entry.name}>
          <rect x={0} y={y(entry.tvdss - shift)} width={colW} height={Math.max(0, h)} fill={entry.colour} className="cor-band" data-dim={focused && focused !== entry.name ? "" : undefined} />
          {(() => { const shown = Math.max(y(entry.tvdss - shift), HEAD + TRACKS), end = y(bottom - shift); return end - shown > 18 ? <text className="cor-band-label" x={colW - 4} y={shown + 12} textAnchor="end">{entry.name.replace(/ Gp\.$/, "")}</text> : null; })()}
        </g>;
      })}
      <rect className="cor-frame" x={0} y={top} width={colW} height={Math.max(0, base - top)} data-place={place || undefined} />
      <line className="cor-track" x1={t2x} x2={t2x} y1={top} y2={base} />
      {track === "res" && [0.2, 2, 20, 200].map((value) => <line key={value} className="cor-grid" x1={log(value)} x2={log(value)} y1={top} y2={base} />)}
      {litho.map((run, i) => <path key={i} d={run.d} fill={lithologyFill(run.code)} className="cor-litho" />)}
      {grLine && <path d={grLine} className="cor-curve is-gr" />}
      {crossover && <path d={crossover} className="cor-crossover" />}
      {track === "res" && <>
        {curves.RMED && <path d={path(rows(curves.RMED, levels, shift, y), log)} className="cor-curve" stroke="#fb923c" strokeDasharray="3 2" />}
        {curves.RDEP && <path d={path(rows(curves.RDEP, levels, shift, y), log)} className="cor-curve" stroke="#f87171" />}
      </>}
      {track === "dn" && <>
        {curves.NPHI && <path d={path(rows(curves.NPHI, levels, shift, y), phi)} className="cor-curve" stroke="#60a5fa" strokeDasharray="3 2" />}
        {curves.RHOB && <path d={path(rows(curves.RHOB, levels, shift, y), rho)} className="cor-curve" stroke="#f472b6" />}
      </>}
      {track === "sonic" && curves.DTC && <path d={path(rows(curves.DTC, levels, shift, y), dt)} className="cor-curve" stroke="#c084fc" />}
      {shownTops.map((entry) => {
        const py = y(entry.tvdss - shift);
        const lit = focused === entry.name;
        return <g key={`${entry.kind}-${entry.name}`} className={`cor-top is-${entry.kind}`} data-lit={lit || undefined} data-dim={focused && !lit ? "" : undefined}>
          <line x1={0} x2={colW} y1={py} y2={py} stroke={entry.colour} />
          {(lit || entry.kind === "yours") && <text x={colW - 4} y={py - 4} textAnchor="end" fill={entry.colour}>{entry.name}{entry.kind === "yours" ? " · yours" : ""}{lit ? ` · ${fmt(entry.md)} m MD` : ""}</text>}
        </g>;
      })}
      {focusTop && below && (() => {
        const a = y(focusTop.tvdss - shift), b = y(below.tvdss - shift), mid = (a + b) / 2;
        return b - a > 22 ? <g className="cor-thick" transform={`translate(${LITHO + 4},${mid})`}>
          <line x1={6} x2={6} y1={a - mid + 3} y2={b - mid - 3} />
          <rect x={12} y={-9} width={62} height={18} rx={9} /><text x={43} dy="0.34em" textAnchor="middle">{fmt(below.tvdss - focusTop.tvdss)} m</text>
        </g> : null;
      })()}
      {well.shoes.map((shoe) => <g key={shoe.label} className="cor-shoe" transform={`translate(0,${y((shoe.tvdss ?? tvdssAt(well, shoe.md)) - shift)})`}><path d="M0,0 L7,-6 L7,0 Z" /><title>{shoe.label} shoe, {fmt(shoe.md)} m MD</title></g>)}
    </g>
    {suggestion && suggested && (() => {
      const py = y(tvdssAt(well, suggestion.md) - shift);
      const own = topIn(tops, suggested);
      const delta = own ? suggestion.md - own.md : null;
      return <g className={`cor-suggested is-${strength(suggestion.r)}`}>
        <line x1={0} x2={colW} y1={py} y2={py} />
        <foreignObject x={4} y={py + 4} width={colW - 8} height={46}>
          <div className="cor-suggestion">
            <span><b>{suggested}?</b> {fmt(suggestion.md, 1)} m MD</span>
            <span><i>r {suggestion.r.toFixed(2)} · {strength(suggestion.r)}</i>{delta !== null && <i>{Math.abs(delta) < 0.5 ? " · on the pick" : ` · ${delta > 0 ? "+" : "−"}${fmt(Math.abs(delta), 1)} m vs ${own!.kind === "yours" ? "yours" : "Directorate"}`}</i>}</span>
            <button type="button" aria-label={`Accept ${suggested} at ${fmt(suggestion.md, 1)} m in ${well.name}`} onPointerDown={(event) => event.stopPropagation()} onClick={onAccept}><Check size={12} /></button>
            <button type="button" aria-label={`Dismiss the suggestion in ${well.name}`} onPointerDown={(event) => event.stopPropagation()} onClick={onReject}><X size={12} /></button>
          </div>
        </foreignObject>
      </g>;
    })()}
    {reference && suggested && (() => { const own = topIn(tops, suggested); return own ? <text className="cor-reference" x={colW - 4} y={y(own.tvdss - shift) + 13} textAnchor="end">matching from here</text> : null; })()}
    {!logs && <text className="cor-missing" x={colW / 2} y={Math.max(HEAD + TRACKS + 30, Math.min(base - 8, top + 30))} textAnchor="middle">{error ? `Logs could not load: ${error}` : "Loading logs…"}</text>}
  </g>;
}

/** Between neighbouring wells: each shared group band joined, and each shared top as a line. */
function Gaps({ drawn, tops, visible, focused, y, lefts, colW }: {
  readonly drawn: readonly { well: ForceWell; i: number; shift: number }[]; readonly tops: ReadonlyMap<string, readonly Top[]>; readonly visible: ReadonlySet<string>; readonly focused: string | null;
  readonly y: Y; readonly lefts: readonly number[]; readonly colW: number;
}) {
  const pairs = drawn.slice(0, -1).map((left, k) => [left, drawn[k + 1]!] as const).filter(([a, b]) => b.i === a.i + 1);
  return <g className="cor-gaps">
    {pairs.map(([a, b]) => {
      const ta = tops.get(a.well.id) ?? [], tb = tops.get(b.well.id) ?? [];
      const xa = lefts[a.i]! + colW, xb = lefts[b.i]!;
      const ga = ta.filter((top) => top.kind === "group"), gb = tb.filter((top) => top.kind === "group");
      const baseOf = (list: readonly Top[], i: number, well: ForceWell) => list[i + 1]?.tvdss ?? tvdssAt(well, well.mdBase);
      return <g key={`${a.well.id}-${b.well.id}`}>
        {ga.map((top, i) => {
          const j = gb.findIndex((other) => other.name === top.name);
          if (j < 0) return null;
          const ya = y(top.tvdss - a.shift), yb = y(gb[j]!.tvdss - b.shift), za = y(baseOf(ga, i, a.well) - a.shift), zb = y(baseOf(gb, j, b.well) - b.shift);
          return <polygon key={top.name} points={`${xa},${ya} ${xb},${yb} ${xb},${zb} ${xa},${za}`} fill={top.colour} className="cor-gapband" data-dim={focused && focused !== top.name ? "" : undefined} />;
        })}
        {ta.filter((top) => visible.has(top.name)).map((top) => {
          const other = tb.find((entry) => entry.name === top.name && (entry.kind === "yours") === (top.kind === "yours"));
          return other ? <line key={`${top.kind}-${top.name}`} className={`cor-join is-${top.kind}`} data-lit={focused === top.name || undefined} data-dim={focused && focused !== top.name ? "" : undefined}
            x1={xa} x2={xb} y1={y(top.tvdss - a.shift)} y2={y(other.tvdss - b.shift)} stroke={top.colour} /> : null;
        })}
      </g>;
    })}
  </g>;
}

/** The distance between neighbouring wells, over the gap between them. */
function GapDistances({ wells, lefts, colW }: { readonly wells: readonly ForceWell[]; readonly lefts: readonly number[]; readonly colW: number }) {
  return <g>{wells.slice(1).map((well, i) => <text key={well.id} className="cor-gapkm" x={(lefts[i]! + colW + lefts[i + 1]!) / 2} y={HEAD / 2 + 4} textAnchor="middle">{fmt(distanceKm(wells[i]!, well) ?? 0, 1)} km</text>)}</g>;
}

/** One level across the section, with what each well has there; while picking, the line is where the top will go. */
function Cursor({ level, y, drawn, logs, tops, lefts, colW, width, flatten, armed, hoverWell }: {
  readonly level: number; readonly y: Y; readonly drawn: readonly { well: ForceWell; i: number; shift: number }[]; readonly logs: ReadonlyMap<string, ForceLogs>;
  readonly tops: ReadonlyMap<string, readonly Top[]>; readonly lefts: readonly number[]; readonly colW: number; readonly width: number; readonly flatten: string | null; readonly armed: string | null; readonly hoverWell: string | null;
}) {
  const py = y(level);
  return <g className="cor-cursor" pointerEvents="none">
    <line x1={RULER} x2={width} y1={py} y2={py} />
    <text x={RULER - 9} y={py - 4} textAnchor="end" className="cor-cursor-level">{flatten && level > 0 ? "+" : ""}{fmt(level)}</text>
    {drawn.map(({ well, i, shift }) => {
      const md = mdAtTvdss(well, level + shift);
      if (md < well.mdTop - 1 || md > well.mdBase + 1) return null;
      if (armed && well.id === hoverWell) return <g key={well.id} transform={`translate(${lefts[i]},${py})`} className="cor-ghost">
        <line x1={0} x2={colW} /><rect x={4} y={-22} width={colW - 8} height={18} rx={9} /><text x={colW / 2} y={-9} textAnchor="middle">{armed} · {fmt(md)} m MD</text>
      </g>;
      const k = sampleAt(well, md), entry = logs.get(well.id);
      const gr = entry?.curves.GR?.[k];
      const code = entry?.litho?.[k] ?? -1;
      const group = [...(tops.get(well.id) ?? [])].filter((top) => top.kind === "group" && top.tvdss <= level + shift).at(-1);
      const flip = py > y.range()[1]! - 40;
      return <g key={well.id} transform={`translate(${lefts[i]! + 4},${py + (flip ? -32 : 5)})`}>
        <rect className="cor-chip" width={colW - 8} height={27} rx={6} />
        {code >= 0 && <rect x={5} y={6} width={6} height={15} rx={2} fill={lithologyFill(code)} />}
        <text x={code >= 0 ? 15 : 6} y={12}>{fmt(md)} m MD{gr !== undefined && !Number.isNaN(gr) ? ` · GR ${fmt(gr)}` : ""}</text>
        <text x={code >= 0 ? 15 : 6} y={23} className="cor-chip-sub">{code >= 0 ? LITHOLOGY[code]!.name : "no lithology"}{group ? ` · ${group.name.replace(/ Gp\.$/, "")}` : ""}</text>
      </g>;
    })}
  </g>;
}

/** An interval of one well's GR laid over another at a level: the same thickness, the same scale, to compare shapes. */
function Ghost({ source, gr, top, base, level, x, colW, y, dropped, onClear }: {
  readonly source: ForceWell; readonly gr: Float32Array; readonly top: number; readonly base: number; readonly level: number; readonly x: number; readonly colW: number; readonly y: Y; readonly dropped: boolean; readonly onClear: () => void;
}) {
  const levels = sampleTvdss(source);
  // Only the logged part of the interval: a selection above or below the logs is clipped to them.
  const from = Math.max(0, Math.min(source.n - 1, sampleAt(source, Math.min(top, base)))), to = Math.max(0, Math.min(source.n - 1, sampleAt(source, Math.max(top, base))));
  const start = levels[from]!;
  const scale = scaleLinear().domain([0, 150]).range([LITHO, Math.floor(colW / 2)]).clamp(true);
  let d = "";
  for (let k = from; k <= to; k++) { const value = gr[k]!; if (Number.isNaN(value)) continue; d += `${d ? "L" : "M"}${scale(value).toFixed(1)},${y(level + levels[k]! - start).toFixed(1)}`; }
  const a = y(level), b = y(level + levels[to]! - start);
  return <g className="cor-ghost-curve" transform={`translate(${x},0)`} data-dropped={dropped || undefined} pointerEvents="none">
    <rect x={2} y={a} width={colW / 2 - 2} height={Math.max(0, b - a)} rx={4} />
    <path d={d} />
    <text x={6} y={a - 5}>{source.name} GR · {fmt(top)}–{fmt(base)} m MD</text>
    {dropped && <foreignObject x={colW / 2 - 22} y={a - 18} width={20} height={20} pointerEvents="all"><button type="button" className="cor-ghost-x" aria-label="Clear the ghost" onPointerDown={(event) => event.stopPropagation()} onClick={onClear}><X size={11} /></button></foreignObject>}
  </g>;
}

/** The user's picks on the section's wells, against the Directorate's where it has the same top. */
function YourPicks({ wells, tops }: { readonly wells: readonly ForceWell[]; readonly tops: ReadonlyMap<string, readonly Top[]> }) {
  const list = wells.flatMap((well) => (tops.get(well.id) ?? []).filter((top) => top.kind === "yours").map((top) => {
    const theirs = (tops.get(well.id) ?? []).find((entry) => entry.name === top.name && entry.kind !== "yours");
    return { well, top, delta: theirs ? top.md - theirs.md : null };
  }));
  if (!list.length) return null;
  return <table className="cor-picks">
    <caption>Your picks <small>kept in this browser · drag one on the section to move it</small></caption>
    <thead><tr><th>Top</th><th>Well</th><th>MD</th><th>TVDSS</th><th>Against the Directorate</th><th /></tr></thead>
    <tbody>{list.map(({ well, top, delta }) => <tr key={`${well.id}-${top.name}`}>
      <td>{top.name}</td><td>{well.name}</td><td>{fmt(top.md, 1)} m</td><td>{fmt(top.tvdss, 1)} m</td>
      <td>{delta === null ? "not picked by the Directorate" : Math.abs(delta) < 0.05 ? "same depth" : `${delta > 0 ? "+" : "−"}${fmt(Math.abs(delta), 1)} m MD ${delta > 0 ? "deeper" : "shallower"}`}</td>
      <td><button type="button" className="cor-remove" aria-label={`Remove your ${top.name} pick in ${well.name}`} onClick={() => removePick(busId(well), top.name)}><X size={12} /></button></td>
    </tr>)}</tbody>
  </table>;
}
