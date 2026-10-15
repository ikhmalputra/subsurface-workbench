import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig } from "motion/react";
import { Cable, Moon, Pencil, Plus, Search, Sun, X } from "lucide-react";
import { useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";
import { siteById } from "../data/sites.ts";
import { amplitudeAtMd, useForgeSection } from "../data/forge.ts";
import { fmt } from "../format.ts";
import { placeAt, tvdOn, usePlace } from "../data/place.ts";
import { useForgeOpenHole, valueAt } from "../data/openhole.ts";
import { analyse, isDesignSite, useDesignState } from "../data/design.ts";
import { WhatIfBar } from "./WhatIfBar.tsx";
import { ModuleBody } from "../modules/bodies.tsx";
import type { ModuleId } from "../modules/registry.ts";
import { moduleIds, signalColour } from "../modules/registry.ts";
import { CommandBar } from "./CommandBar.tsx";
import { NewWell } from "./NewWell.tsx";
import { Dock, gridProbe } from "./Dock.tsx";
import { cellGeometry } from "./layout.ts";
import { Links } from "./Links.tsx";
import { actions, signals, useDeck } from "./store.ts";
import { Tile, type Ghost } from "./Tile.tsx";
import { TimeRail } from "./TimeRail.tsx";
import { formatDate, useMoment } from "../data/history.ts";

const GAP = 10;

export function Deck() {
  const theme = useDeck((deck) => deck.theme);
  const patch = useDeck((deck) => deck.patch);
  useEffect(() => { document.documentElement.dataset.deck = theme; document.documentElement.dataset.swTheme = theme === "night" ? "dark" : "light"; }, [theme]);
  return <MotionConfig reducedMotion="user">
    <div className="deck" data-sw-theme={theme === "night" ? "dark" : "light"} data-patch={patch || undefined}>
      <Bar />
      <Main />
      <WhatIfBar />
      <div className="rails"><DepthRail /><TimeRail /></div>
      <Lens />
      <Links />
      <CommandBar />
      <NewWell />
    </div>
  </MotionConfig>;
}

function Bar() {
  const theme = useDeck((deck) => deck.theme);
  const patch = useDeck((deck) => deck.patch);
  const siteId = useDeck((deck) => deck.siteId), wellId = useDeck((deck) => deck.wellId);
  const site = siteById(siteId);
  const well = site?.wells.find((entry) => entry.id === wellId);
  const pinned = useSubsurfaceSelector(signals, (state) => state.depthLink.pinnedMdM);
  const window_ = useSubsurfaceSelector(signals, (state) => state.depthLink.window);
  const componentId = useSubsurfaceSelector(signals, (state) => state.activeAsset.componentId);
  const place = usePlace();
  const component = place?.components.find((entry) => entry.id === componentId) ?? null;
  const brush = useSubsurfaceSelector(signals, (state) => state.dataInteraction.depthRange);
  const moment = useMoment();
  return <header className="bar">
    <span className="brand"><span className="brand-mark" aria-hidden="true">S</span>Subsurface <small>deck</small></span>
    <div className="chips" aria-label="Live signals" data-origin="bar">
      <span className="chip" style={{ ["--chip-colour" as string]: signalColour.place }}><i /><b>{site ? site.map.label : "World"}</b>{well && <span>· {well.label}</span>}
        {place && <button type="button" className="chip-edit" aria-label={`Edit ${place.label}`} title={place.kind === "design" ? "Edit this planned well in the Well designer" : place.kind === "recorded" ? "Edit this well's records in the Well editor" : "Edit this well in the Well editor: your changes sit over the record, which stays as it is"}
          onClick={() => place.kind === "design" ? actions.designWell(place.siteId) : actions.editWell(place.siteId, wellId)}><Pencil size={12} />{place.edits ? "Edited" : "Edit"}</button>}
        {site && <button type="button" aria-label="Back to the world" onClick={() => actions.selectSite(null)}><X size={12} /></button>}</span>
      {component && <span className="chip" style={{ ["--chip-colour" as string]: signalColour.object }}><i /><b>{component.name}</b>
        <button type="button" aria-label="Clear the selection" onClick={() => signals.selectComponent(null, "deck:bar")}><X size={12} /></button></span>}
      {pinned !== null && <span className="chip" style={{ ["--chip-colour" as string]: signalColour.depth }}><i /><b>{fmt(pinned)} m MD</b>
        <button type="button" aria-label="Clear the depth cursor" onClick={() => signals.pinDepth(signals.getState().activeAsset.wellId, null, "deck:bar")}><X size={12} /></button></span>}
      {moment && siteId === "forge" && <span className="chip" style={{ ["--chip-colour" as string]: signalColour.time }}><i /><b>{formatDate(moment.date)}</b><span>day {moment.asOf.dayFromSpud}</span>
        <button type="button" aria-label="Show the well as finally recorded" onClick={() => signals.setTimeCursor(null, "deck:bar")}><X size={12} /></button></span>}
      {brush && <span className="chip" style={{ ["--chip-colour" as string]: signalColour.object }}><i /><b>{fmt(brush[0])}–{fmt(brush[1])} m</b><span>brushed</span>
        <button type="button" aria-label="Clear the brushed interval" onClick={() => signals.setDataInteraction({ depthRange: null }, "deck:bar")}><X size={12} /></button></span>}
      {window_ && <span className="chip" style={{ ["--chip-colour" as string]: signalColour.depth }}><i /><b>{fmt(window_[0])}–{fmt(window_[1])} m</b><span>window</span>
        <button type="button" aria-label="Show the whole well" onClick={() => signals.setDepthWindow(null, "deck:bar")}><X size={12} /></button></span>}
    </div>
    <div className="bar-end">
      <button type="button" className="new-well" onClick={() => actions.openNewWell(true)} title="Plan a new well: place it, then design it stage by stage"><Plus size={15} />New well</button>
      <button type="button" className="find" onClick={() => actions.openCommand(true)}><Search size={14} />Fly, find, open or command<kbd>⌘K</kbd></button>
      <button type="button" className="icon-button" aria-pressed={patch} aria-label="Show every live link (hold ⌥)" title="Links between modules · hold ⌥" onClick={() => actions.setPatch(!patch)}><Cable size={15} /></button>
      <button type="button" className="icon-button" aria-label={theme === "night" ? "Switch to the day deck" : "Switch to the night deck"} onClick={() => actions.setTheme(theme === "night" ? "day" : "night")}>{theme === "night" ? <Sun size={15} /> : <Moon size={15} />}</button>
    </div>
  </header>;
}

function Main() {
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const onGhost = useCallback((next: Ghost | null) => setGhost(next), []);
  return <div className="main">
    <Dock onGhost={onGhost} />
    <Grid ghost={ghost} onGhost={onGhost} />
  </div>;
}

function Grid({ ghost, onGhost }: { readonly ghost: Ghost | null; readonly onGhost: (ghost: Ghost | null) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1200, height: 760 });
  const tiles = useDeck((deck) => deck.tiles);
  const siteId = useDeck((deck) => deck.siteId);
  const site = siteById(siteId);
  useEffect(() => {
    const box = element.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => { const { width, height } = entry!.contentRect; if (width && height) setSize({ width, height }); });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  const geometry = cellGeometry(size.width, size.height, GAP);
  useEffect(() => {
    gridProbe.cellAt = (x, y) => {
      const box = element.current?.getBoundingClientRect();
      if (!box || x < box.left || y < box.top || x > box.right || y > box.bottom) return null;
      return geometry.toCells(x - box.left, y - box.top);
    };
    return () => { gridProbe.cellAt = null; };
  }, [geometry]);
  const subtitle = (id: ModuleId): string | undefined => {
    if (id === "globe" || !site) return undefined;
    return siteId === "forge" && id !== "site3d" ? "16A(78)-32" : site.map.label;
  };
  const ghostBox = ghost ? geometry.toPx(ghost.rect) : null;
  return <main className="grid" ref={element}>
    {ghost && ghostBox && <div className="snap-ghost" data-refused={!ghost.ok || undefined} style={{ left: ghostBox.x, top: ghostBox.y, width: ghostBox.width, height: ghostBox.height }} />}
    <AnimatePresence>
      {moduleIds.filter((id) => tiles[id]).map((id) => <Tile key={id} id={id} geometry={geometry} subtitle={subtitle(id)} onGhost={onGhost}><ModuleBody id={id} /></Tile>)}
    </AnimatePresence>
  </main>;
}

/** Depth along the chosen well: hover to read, click to pin, drag to set a depth window. Every depth module follows. */
function DepthRail() {
  const place = usePlace();
  const moment = useMoment();
  const depth = useSubsurfaceSelector(signals, (state) => state.depthLink);
  const brush = useSubsurfaceSelector(signals, (state) => state.dataInteraction.depthRange);
  const track = useRef<HTMLDivElement>(null);
  const press = useRef<number | null>(null);
  const [band, setBand] = useState<readonly [number, number] | null>(null);
  if (!place) return <div className="rail" data-origin="rail"><span className="rail-label"><i />Depth</span><span className="rail-label">Follows the chosen well. Choose a site on the globe or press ⌘K.</span></div>;
  const td = place.totalDepthM, well = place.wellId;
  const surveyEnd = place.stations.at(-1)?.mdM ?? td;
  const mdAt = (clientX: number) => { const box = track.current!.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(td, (clientX - box.left) / box.width * td))); };
  const shown = depth.hoverMdM ?? depth.pinnedMdM;
  const pct = (md: number) => `${md / td * 100}%`;
  const tvd = shown === null ? null : tvdOn(place, shown);
  // About six ticks, on round numbers.
  const step = [100, 200, 250, 500, 1000].find((value) => td / value <= 7) ?? 1000;
  const reached = place.siteId === "forge" ? moment : null;
  return <div className="rail" aria-label="Depth rail" data-origin="rail">
    {reached && <span className="sr-only">Drilled to {fmt(reached.asOf.drilledM)} m MD on {formatDate(reached.date)}</span>}
    <span className="rail-label"><i />Depth</span>
    <div className="rail-track" ref={track} title="Hover to read · click to pin · drag to set a depth window · Shift-drag to brush an interval"
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); press.current = mdAt(event.clientX); }}
      onPointerMove={(event) => {
        const md = mdAt(event.clientX);
        signals.updateDepthHover(well, md, "deck:rail");
        if (press.current !== null && Math.abs(md - press.current) > td * 0.01) setBand([Math.min(md, press.current), Math.max(md, press.current)]);
      }}
      onPointerLeave={() => signals.updateDepthHover(well, null, "deck:rail")}
      onPointerUp={(event) => {
        const start = press.current; press.current = null;
        if (band) { if (event.shiftKey) signals.setDataInteraction({ depthRange: band }, "deck:rail"); else signals.setDepthWindow(band, "deck:rail"); setBand(null); return; }
        if (start !== null) signals.pinDepth(well, mdAt(event.clientX), "deck:rail");
      }}>
      {Array.from({ length: Math.floor(td / step) + 1 }, (_, i) => i * step).map((md) => <span key={md} className="rail-tick" style={{ left: pct(md) }}><span>{fmt(md)}</span></span>)}
      {surveyEnd < td - 1 && <span className="rail-survey" style={{ left: pct(surveyEnd), width: pct(td - surveyEnd) }} title="Beyond the last survey station" />}
      {reached && <span className="rail-undrilled" style={{ left: pct(Math.min(td, reached.asOf.drilledM)), width: pct(Math.max(0, td - reached.asOf.drilledM)) }} title={`Not yet drilled on ${formatDate(reached.date)}`} />}
      {brush && <span className="rail-brush" style={{ left: pct(brush[0]), width: pct(brush[1] - brush[0]) }} title="Brushed interval" />}
      {(band ?? depth.window) && <span className="rail-band" style={{ left: pct((band ?? depth.window)![0]), width: pct((band ?? depth.window)![1] - (band ?? depth.window)![0]) }} />}
      {depth.pinnedMdM !== null && <span className="rail-mark" style={{ left: pct(depth.pinnedMdM) }} />}
      {depth.hoverMdM !== null && <span className="rail-mark is-hover" style={{ left: pct(depth.hoverMdM) }} />}
    </div>
    <span className="rail-value">{shown === null ? `TD ${fmt(td)} m MD` : `${fmt(shown)} m MD · ${tvd === null ? "TVD not surveyed" : `${fmt(tvd)} m ${place.siteId === "equator" ? "TVDSS" : "TVD"}`}`}</span>
  </div>;
}

/** What the signals mean here, in words and units, with sources; unknowns say "not reported". */
function Lens() {
  const siteId = useDeck((deck) => deck.siteId);
  const note = useDeck((deck) => deck.note);
  const site = siteById(siteId);
  const place = usePlace();
  const depth = useSubsurfaceSelector(signals, (state) => state.depthLink);
  const brush = useSubsurfaceSelector(signals, (state) => state.dataInteraction.depthRange);
  const componentId = useSubsurfaceSelector(signals, (state) => state.activeAsset.componentId);
  const forge = siteId === "forge";
  const section = useForgeSection(forge);
  const md = place ? depth.hoverMdM ?? depth.pinnedMdM : null;
  const here = place && md !== null ? placeAt(place, md) : null;
  const amplitude = forge && md !== null ? amplitudeAtMd(section.file, md) : null;
  const { openHole } = useForgeOpenHole(forge);
  const logged = forge && openHole && md !== null ? (["DPHI", "RT90", "P32", "K", "TH"] as const).map((mnemonic) => [mnemonic, valueAt(openHole, mnemonic, md)] as const) : null;
  const component = place?.components.find((entry) => entry.id === componentId);
  const moment = useMoment();
  const day = forge ? moment : null;
  const design = useDesignState();
  const whatIf = isDesignSite(siteId) && design.pending ? { label: design.pending.label, failing: analyse(design.pending.value.brief).failing.length, before: analyse(design.committed.brief).failing.length } : null;
  const dot = (colour: string) => ({ ["--dot" as string]: colour });
  const [fresh, setFresh] = useState(false);
  useEffect(() => { if (!note) return; setFresh(true); const timer = window.setTimeout(() => setFresh(false), 4000); return () => window.clearTimeout(timer); }, [note]);
  const stringName = (name: string) => name.split(" / ")[1] ?? name;
  return <footer className="lens" aria-live="polite">
    {fresh && note && <span className="toast" role="status">{note.text}</span>}
    <span><i className="lens-dot" style={dot(signalColour.place)} /><b>{site ? site.map.label : "The world"}</b>{site ? ` · ${site.map.provenance}` : " · choose a site"}{place && site && site.wells.length > 1 ? <> · well <b>{place.label}</b></> : null}</span>
    {whatIf && <span className="lens-whatif"><i className="lens-dot" style={dot(signalColour.whatif)} /><b>What-if</b> · {whatIf.label} · {whatIf.failing ? `${whatIf.failing} string${whatIf.failing === 1 ? "" : "s"} fail` : "every string passes"}{whatIf.before !== whatIf.failing ? ` (was ${whatIf.before})` : ""}</span>}
    {here && md !== null && place && <span className="mono"><i className="lens-dot" style={dot(signalColour.depth)} />
      <b>{fmt(md)} m MD</b>{here.tvd === null ? " · TVD not surveyed" : ` · ${fmt(here.tvd)} m ${place.siteId === "equator" ? "TVDSS" : "TVD"}`}
      {place.siteId !== "equator" && <>{" · "}{here.strings.length ? `inside ${here.strings.map((entry) => stringName(entry.name)).join(", ")}` : "open hole"}{" · "}{here.hole ? `${stringName(here.hole.name)} hole` : "hole not reported"}</>}
      {" · "}{here.formation ? here.formation.name : here.zone ? here.zone.name : "formation not reported"}
      {forge && <>{" · "}{amplitude ? `amplitude ${amplitude.value >= 0 ? "+" : ""}${amplitude.value.toFixed(2)} × p99${Math.abs(amplitude.offsetM) > 12.5 ? ` (well ${fmt(Math.abs(amplitude.offsetM))} m off the section)` : ""}` : section.file ? "amplitude not available" : "amplitude loading"}</>}
    </span>}
    {here && logged && logged.some(([, value]) => value !== null) && <span className="mono"><i className="lens-dot" style={dot(signalColour.depth)} /><b>Open hole</b>{" · "}{logged.map(([mnemonic, value]) => `${mnemonic === "DPHI" ? "φD" : mnemonic} ${value === null ? "not logged" : mnemonic === "DPHI" ? `${fmt(value * 100, 1)}%` : mnemonic === "RT90" ? `${fmt(value)} Ω·m` : mnemonic === "P32" ? `${fmt(value, 2)}/ft` : mnemonic === "K" ? `${fmt(value, 1)}%` : `${fmt(value, 1)} ppm`}`).join(" · ")}</span>}
    {brush && <span><i className="lens-dot" style={dot(signalColour.object)} /><b>Brushed {fmt(brush[0])}–{fmt(brush[1])} m MD</b> · {fmt(brush[1] - brush[0], 1)} m</span>}
    {day && <span><i className="lens-dot" style={dot(signalColour.time)} /><b>Day {day.asOf.dayFromSpud} · {formatDate(day.date)}</b>
      {day.asOf.report ? <> · {day.asOf.report.category} · {day.asOf.report.headline.toLowerCase()}{day.asOf.report.mudWeightPpg !== null ? ` · mud ${day.asOf.report.mudWeightPpg} ppg` : " · mud weight not reported"} · report p. {day.asOf.report.page}</> : " · no daily report for this date"}
      {[...day.asOf.events.map((event) => event.label), ...day.asOf.milestones.map((milestone) => milestone.label)].map((label) => <b key={label} className="lens-event"> · {label}</b>)}
    </span>}
    {component && <span><i className="lens-dot" style={dot(signalColour.object)} /><b>{component.name}</b> · {component.material} · {fmt(component.topDepthM)}–{fmt(component.bottomDepthM)} m MD{component.sourcePage ? ` · source p. ${component.sourcePage}` : place?.kind === "design" ? " · planned in the design brief" : " · source not reported"}</span>}
    {!site && <span>⌘K flies anywhere · the dock opens any module · drag tiles by the head · hold ⌥ to see every link</span>}
  </footer>;
}
