import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { Expand, Maximize2, Shrink, X } from "lucide-react";
import type { ModuleId } from "../modules/registry.ts";
import { fusionRule, fusionRules, moduleById, signalColour, signalName } from "../modules/registry.ts";
import type { Rect } from "./layout.ts";
import { COLS, ROWS } from "./layout.ts";
import { actions, deck as deckStore, useDeck } from "./store.ts";

const useDeckState = () => deckStore.get();

/** Where a drag would land, and whether the grid accepts it. */
export interface Ghost { readonly rect: Rect; readonly ok: boolean }

interface Geometry { readonly toPx: (rect: Rect) => { x: number; y: number; width: number; height: number }; readonly toCells: (dx: number, dy: number) => { col: number; row: number } }

const spring = { type: "spring", stiffness: 420, damping: 38, mass: 0.9 } as const;
/** How long a pulse takes to cross the deck; the receiving edge lights as it lands. */
export const TRAVEL_MS = 320;

/**
 * A module in glass. Drag the head to move it, the corner to resize it; either snaps to the grid on
 * release. Double-click the head, or the expand button, to bring it to the stage; the cross closes it.
 */
export function Tile({ id, geometry, subtitle, onGhost, children }: { readonly id: ModuleId; readonly geometry: Geometry; readonly subtitle?: string; readonly onGhost: (ghost: Ghost | null) => void; readonly children: ReactNode }) {
  const spec = moduleById[id];
  const rect = useDeck((deck) => deck.tiles[id]);
  const isStage = useDeck((deck) => deck.stage === id);
  const focused = useDeck((deck) => deck.focus === id);
  const arriving = useDeck((deck) => deck.pulses.findLast((pulse) => pulse.to.includes(id)));
  const [gesture, setGesture] = useState<{ kind: "move" | "resize"; dx: number; dy: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [flashing, setFlashing] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const siteId = useDeck((deck) => deck.siteId);
  const aimedHere = useDeck((deck) => deck.fuseAim?.to === id ? deck.fuseAim : null);
  const fusions = useDeck((deck) => deck.fusions);
  const fusedHere = Object.entries(fusions).filter(([key]) => key.endsWith(`>${id}`));

  useEffect(() => {
    if (!arriving) return;
    const land = window.setTimeout(() => setFlashing(signalColour[arriving.signal]), TRAVEL_MS);
    const clear = window.setTimeout(() => setFlashing(null), TRAVEL_MS + 700);
    return () => { window.clearTimeout(land); window.clearTimeout(clear); };
  }, [arriving?.id]);

  if (!rect) return null;
  // In focus the tile spreads over the whole grid; its own place in the layout is kept for when it goes back.
  const box = geometry.toPx(focused ? { col: 0, row: 0, w: COLS, h: ROWS } : rect);
  const target = (kind: "move" | "resize", dx: number, dy: number): Rect => {
    const cells = geometry.toCells(dx, dy);
    return kind === "move" ? { ...rect, col: rect.col + cells.col, row: rect.row + cells.row } : { ...rect, w: rect.w + cells.col, h: rect.h + cells.row };
  };
  const begin = (kind: "move" | "resize") => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || focused || (kind === "move" && (event.target as HTMLElement).closest("button"))) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, y: event.clientY };
    setGesture({ kind, dx: 0, dy: 0 });
  };
  /** A fusable tile whose middle is under the pointer: a drop there fuses rather than moves. */
  const fuseTarget = (x: number, y: number): ModuleId | null => {
    for (const element of document.elementsFromPoint(x, y)) {
      const tile = element.closest<HTMLElement>("[data-module]");
      const other = tile?.dataset.module as ModuleId | undefined;
      if (!tile || !other || other === id || !fusionRule(id, other, siteId)) continue;
      const box = tile.getBoundingClientRect();
      const inner = Math.abs(x - (box.left + box.width / 2)) < box.width * 0.3 && Math.abs(y - (box.top + box.height / 2)) < box.height * 0.3;
      return inner ? other : null;
    }
    return null;
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    if (!gesture || !start.current) return;
    const dx = event.clientX - start.current.x, dy = event.clientY - start.current.y;
    setGesture({ ...gesture, dx, dy });
    const into = gesture.kind === "move" ? fuseTarget(event.clientX, event.clientY) : null;
    actions.aimFuse(into ? { from: id, to: into } : null);
    if (into) { setRefused(false); onGhost(null); return; }
    const aim = target(gesture.kind, dx, dy);
    const drop = actions.preview(gesture.kind, id, aim);
    setRefused(Math.hypot(dx, dy) > 4 && !drop);
    onGhost(drop ? { rect: drop.landed, ok: true } : { rect: { col: Math.round(aim.col), row: Math.round(aim.row), w: Math.round(aim.w), h: Math.round(aim.h) }, ok: false });
  };
  const end = () => {
    if (!gesture) return;
    const moved = Math.hypot(gesture.dx, gesture.dy) > 4;
    const aim = useDeckState().fuseAim;
    if (aim && aim.from === id) actions.fuse(aim.from, aim.to, aim.from === "logs" ? "GR" : "tops");
    else if (moved) (gesture.kind === "move" ? actions.place : actions.resize)(id, target(gesture.kind, gesture.dx, gesture.dy));
    actions.aimFuse(null);
    setGesture(null); setRefused(false); start.current = null; onGhost(null);
  };

  const live = gesture
    ? gesture.kind === "move" ? { ...box, x: box.x + gesture.dx, y: box.y + gesture.dy } : { ...box, width: Math.max(160, box.width + gesture.dx), height: Math.max(120, box.height + gesture.dy) }
    : box;
  const Icon = spec.icon;
  return <motion.section
    className={`tile${isStage ? " is-stage" : ""}${focused ? " is-focus" : ""}${gesture ? " is-dragging" : ""}${flashing ? " is-flash" : ""}`}
    style={{ left: 0, top: 0, ["--flash-colour" as string]: flashing ?? "transparent" }}
    initial={{ opacity: 0, scale: 0.96, x: live.x, y: live.y, width: live.width, height: live.height }}
    animate={{ opacity: 1, scale: 1, x: live.x, y: live.y, width: live.width, height: live.height }}
    exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
    transition={gesture ? { duration: 0 } : spring}
    aria-label={spec.title} data-module={id} data-stage={isStage || undefined} data-refused={refused || undefined}>
    <header className="tile-head" onPointerDown={begin("move")} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onDoubleClick={() => focused ? actions.setFocus(null) : actions.promote(id)}>
      <span className="tile-icon"><Icon size={15} strokeWidth={1.8} aria-hidden="true" /></span>
      <span className="tile-title">{spec.title}</span>
      {subtitle && <span className="tile-sub">· {subtitle}</span>}
      <span className="tile-signals" title={`Listens to ${spec.listens.map((signal) => signalName[signal]).join(", ")}${spec.emits.length ? ` · sends ${spec.emits.map((signal) => signalName[signal]).join(", ")}` : ""}`} aria-hidden="true">{spec.listens.map((signal) => <i key={signal} style={{ ["--dot" as string]: signalColour[signal] }} />)}</span>
      {focused && <span className="tile-esc">Esc to put it back</span>}
      {!isStage && !focused && <button type="button" className="tile-action" aria-label={`Bring ${spec.title} to the stage`} title="Bring to the stage" onClick={() => actions.promote(id)}><Maximize2 size={14} /></button>}
      <button type="button" className="tile-action" aria-label={focused ? `Put ${spec.title} back in its tile` : `Spread ${spec.title} over the deck`} aria-pressed={focused} title={focused ? "Back to its tile (Esc)" : "Spread over the whole deck"} onClick={() => actions.setFocus(focused ? null : id)}>{focused ? <Shrink size={14} /> : <Expand size={14} />}</button>
      <button type="button" className="tile-action" aria-label={`Close ${spec.title}`} title="Close" onClick={() => actions.close(id)}><X size={14} /></button>
    </header>
    {fusedHere.length > 0 && <div className="fuse-chips">{fusedHere.map(([key, value]) => <FuseChip key={key} fusion={key} value={value} />)}</div>}
    <div className="tile-body">{children}</div>
    {aimedHere && <div className="fuse-zone" aria-hidden="true"><span>{fusionRules.find((rule) => rule.from === aimedHere.from && rule.to === id)?.verb}</span></div>}
    <div className="tile-resize" aria-hidden="true" onPointerDown={begin("resize")} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
  </motion.section>;
}

/** The curves a log can wrap the well with: a few that read well as colour in granite. */
export const WRAP_CURVES = [
  { mnemonic: "GR", label: "Gamma ray", domain: [0, 300] as const },
  { mnemonic: "P32", label: "Fracture intensity", domain: [0, 4] as const },
  { mnemonic: "RT90", label: "Resistivity 90 in", domain: [0, 2000] as const },
  { mnemonic: "DPHI", label: "Density porosity", domain: [0, 0.15] as const },
];

/** A fusion on the target's head: what is fused, a choice where there is one, and the way to pull it off. */
function FuseChip({ fusion, value }: { readonly fusion: string; readonly value: string }) {
  const [from] = fusion.split(">") as [ModuleId];
  return <span className="fuse-chip">
    <b>{moduleById[from].title}</b>
    {from === "logs"
      ? <select aria-label="Curve wrapped on the well" value={value} onChange={(event) => actions.fuse(from, fusion.split(">")[1] as ModuleId, event.target.value)}>{WRAP_CURVES.map((curve) => <option key={curve.mnemonic} value={curve.mnemonic}>{curve.label}</option>)}</select>
      : <span>formation tops</span>}
    <button type="button" aria-label={`Pull ${moduleById[from].title} off`} title="Pull it off" onClick={() => actions.unfuse(fusion)}><X size={12} /></button>
  </span>;
}
