import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Maximize2, MousePointerClick, Move, X } from "lucide-react";
import { BASE } from "../base.ts";
import type { ModuleId, ModuleSpec } from "../modules/registry.ts";
import { SITE_KIND_LABEL, fusionRules, groups, missing, moduleById, modules, signalColour, signalName, siteKindOf, worksAt } from "../modules/registry.ts";
import type { Ghost } from "./Tile.tsx";
import { actions, deck, useDeck } from "./store.ts";

/** The grid tells the dock which cell is under a point, so a module can be dropped where it is wanted. */
export const gridProbe: { cellAt: ((x: number, y: number) => { col: number; row: number } | null) | null } = { cellAt: null };

/**
 * Every module, open or not. Click one to open it where there is room (or, if it is open, to expand
 * it over the deck); drag one onto the grid to put it exactly there, over a tile to take that
 * tile's place. Resting on one shows its card beside the dock.
 */
export function Dock({ onGhost }: { readonly onGhost: (ghost: Ghost | null) => void }) {
  const tiles = useDeck((deck) => deck.tiles);
  const stage = useDeck((deck) => deck.stage);
  const siteId = useDeck((deck) => deck.siteId);
  const drag = useRef<{ id: ModuleId; x: number; y: number; moved: boolean } | null>(null);
  const [carry, setCarry] = useState<{ id: ModuleId; x: number; y: number } | null>(null);
  // The card beside the dock: shown a beat after the pointer (or focus) rests on a module, gone while dragging.
  const [card, setCard] = useState<{ id: ModuleId; top: number; left: number } | null>(null);
  const timer = useRef(0);
  const showCard = (id: ModuleId, el: HTMLElement, now = false) => {
    window.clearTimeout(timer.current);
    const go = () => { const r = el.getBoundingClientRect(); setCard({ id, top: r.top + r.height / 2, left: r.right + 12 }); };
    if (now || card) go(); else timer.current = window.setTimeout(go, 140);
  };
  const hideCard = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setCard(null), 90); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // The card never outstays the pointer: anywhere off the dock and the card, a key, a scroll or the window losing focus puts it away.
  useEffect(() => {
    if (!card) return;
    const off = (event: PointerEvent) => { const at = event.target instanceof Element ? event.target : null; if (!at?.closest(".dock, .tool-card")) { window.clearTimeout(timer.current); setCard(null); } };
    const away = () => { window.clearTimeout(timer.current); setCard(null); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") away(); };
    window.addEventListener("pointermove", off, true); window.addEventListener("pointerdown", off, true); window.addEventListener("keydown", key, true);
    window.addEventListener("wheel", away, { passive: true }); window.addEventListener("blur", away);
    return () => { window.removeEventListener("pointermove", off, true); window.removeEventListener("pointerdown", off, true); window.removeEventListener("keydown", key, true); window.removeEventListener("wheel", away); window.removeEventListener("blur", away); };
  }, [card]);

  const down = (id: ModuleId) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    window.clearTimeout(timer.current); setCard(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id, x: event.clientX, y: event.clientY, moved: false };
  };
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current) return;
    if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
    current.moved = true;
    setCard(null);
    setCarry({ id: current.id, x: event.clientX, y: event.clientY });
    const cell = gridProbe.cellAt?.(event.clientX, event.clientY) ?? null;
    const landed = cell ? actions.previewDropIn(current.id, cell) : null;
    onGhost(landed ? { rect: landed, ok: true } : cell ? { rect: { col: Math.floor(cell.col), row: Math.floor(cell.row), w: 1, h: 1 }, ok: false } : null);
  };
  const up = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    drag.current = null; setCarry(null); onGhost(null);
    if (!current) return;
    // A click opens a closed module, and expands an open one over the deck (a click again, or Esc, puts it back).
    if (!current.moved) { if (tiles[current.id]) actions.setFocus(deck.get().focus === current.id ? null : current.id); else actions.open(current.id); return; }
    const cell = gridProbe.cellAt?.(event.clientX, event.clientY);
    if (cell) actions.dropIn(current.id, cell);
  };

  return <nav className="dock" aria-label="Modules">
    {groups.map((group) => <div key={group} className="dock-group" role="group" aria-label={group}>
      {modules.filter((spec) => spec.group === group).map((spec) => {
        const Icon = spec.icon;
        const open = !!tiles[spec.id];
        const waiting = missing(spec.id, siteId) !== null;
        return <button key={spec.id} type="button" className="dock-item" data-id={spec.id} data-open={open || undefined} data-stage={stage === spec.id || undefined} data-waiting={waiting || undefined}
          aria-label={`${spec.title} (${spec.group}): ${spec.blurb}${open ? " (open)" : ""}`} aria-describedby={card?.id === spec.id ? "dock-card" : undefined}
          onPointerEnter={(event) => showCard(spec.id, event.currentTarget)} onPointerLeave={hideCard} onFocus={(event) => showCard(spec.id, event.currentTarget, true)} onBlur={hideCard}
          onPointerDown={down(spec.id)} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; setCarry(null); onGhost(null); }}>
          <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
        </button>;
      })}
    </div>)}
    {card && !carry && createPortal(<ToolCard spec={moduleById[card.id]} top={card.top} left={card.left} siteId={siteId} open={!!tiles[card.id]} staged={stage === card.id} onEnter={() => window.clearTimeout(timer.current)} onLeave={hideCard} onClose={() => { window.clearTimeout(timer.current); setCard(null); }} />, document.body)}
    {carry && createPortal(<div className="dock-carry" style={{ left: carry.x + 14, top: carry.y + 10 }} aria-hidden="true">{modules.find((spec) => spec.id === carry.id)?.title}</div>, document.body)}
  </nav>;
}

const GROUP_TINT: Readonly<Record<string, string>> = {
  "Geophysics & geology": "#38bdf8", Petrophysics: "#f59e0b", "Geomechanics & pressure": "#a78bfa", Drilling: "#f472b6",
  "Well engineering & completions": "#34d399", Production: "#fb923c", "Your data": "#94a3b8",
};

/**
 * What a module is, beside the dock: what it looks like (a capture of it at work), what it does, the
 * places it works at and whether it works here (and if not, what it is waiting for), the signals it
 * listens to and sends, what can be dropped on it, and how it opens.
 */
function ToolCard({ spec, top, left, siteId, open, staged, onEnter, onLeave, onClose }: { readonly spec: ModuleSpec; readonly top: number; readonly left: number; readonly siteId: string | null; readonly open: boolean; readonly staged: boolean; readonly onEnter: () => void; readonly onLeave: () => void; readonly onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shot, setShot] = useState(true);
  const [height, setHeight] = useState(360);
  useEffect(() => { setShot(true); }, [spec.id]);
  useEffect(() => { if (ref.current) setHeight(ref.current.offsetHeight); });
  const Icon = spec.icon, tint = GROUP_TINT[spec.group] ?? "#94a3b8";
  const waiting = missing(spec.id, siteId), kinds = worksAt(spec.id), here = siteKindOf(siteId);
  const drops = fusionRules.filter((rule) => rule.to === spec.id);
  const y = Math.max(12, Math.min(window.innerHeight - Math.min(height, window.innerHeight - 24) - 12, top - height / 2));
  return <div id="dock-card" ref={ref} className="tool-card" role="tooltip" style={{ top: y, left, ["--tint" as string]: tint, ["--arrow" as string]: `${Math.max(18, Math.min(height - 18, top - y))}px` }} onPointerEnter={onEnter} onPointerLeave={onLeave}>
    <div className="tool-card-shot">
      {shot ? <img src={`${BASE}landing/tools/${spec.id}.jpg`} alt="" width={480} height={300} onError={() => setShot(false)} /> : <span className="tool-card-glyph"><Icon size={46} strokeWidth={1.2} aria-hidden="true" /></span>}
      <span className="tool-card-group"><i />{spec.group}</span>
      <button type="button" className="tool-card-close" aria-label="Close this card" onClick={onClose}><X size={13} /></button>
    </div>
    <div className="tool-card-body">
      <h3><Icon size={16} strokeWidth={1.8} aria-hidden="true" />{spec.title}{open && <em>{staged ? "on stage" : "open"}</em>}</h3>
      <p>{spec.blurb}.</p>
      <div className={`tool-card-here${waiting ? " is-waiting" : ""}`}>{waiting ? <><b>Not here yet.</b> {waiting}</> : <><b>Ready here.</b> {siteId ? "It reads this place's data." : "It works without a place."}</>}</div>
      {kinds && <div className="tool-card-row"><small>Works at</small><span className="tool-card-chips">{kinds.map((k) => <span key={k} data-here={k === here || undefined}>{SITE_KIND_LABEL[k]}</span>)}</span></div>}
      {(spec.listens.length > 0 || spec.emits.length > 0) && <div className="tool-card-row"><small>Linked by</small><span className="tool-card-signals">
        {spec.listens.map((sg) => <span key={`l${sg}`} title={`Follows the deck's ${signalName[sg].toLowerCase()}`}><i style={{ background: signalColour[sg] }} />{signalName[sg]}</span>)}
        {spec.emits.length > 0 && <><ArrowRight size={11} aria-hidden="true" />{spec.emits.map((sg) => <span key={`e${sg}`} className="is-out" title={`Sets the deck's ${signalName[sg].toLowerCase()}`}><i style={{ background: signalColour[sg] }} />{signalName[sg]}</span>)}</>}
      </span></div>}
      {drops.length > 0 && <div className="tool-card-row"><small>Drop on it</small><span>{drops.map((rule) => `${moduleById[rule.from].title}: ${rule.verb.toLowerCase()}`).join(" · ")}</span></div>}
      <footer>
        <span><MousePointerClick size={12} aria-hidden="true" />{open ? "Click to expand it over the deck" : spec.opensOnStage ? "Click to open on the stage" : spec.opensFocused ? "Click to open over the deck" : `Click to open as a ${spec.size.w}×${spec.size.h} tile`}</span>
        <span><Move size={12} aria-hidden="true" />Drag onto the deck</span>
        {spec.opensFocused && <span><Maximize2 size={12} aria-hidden="true" />Esc puts it back</span>}
      </footer>
    </div>
  </div>;
}
