import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { Maximize2, X } from "lucide-react";
import type { ModuleId } from "../modules/registry.ts";
import { moduleById, signalColour, signalName } from "../modules/registry.ts";
import type { Rect } from "./layout.ts";
import { actions, useDeck } from "./store.ts";

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
  const arriving = useDeck((deck) => deck.pulses.findLast((pulse) => pulse.to.includes(id)));
  const [gesture, setGesture] = useState<{ kind: "move" | "resize"; dx: number; dy: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [flashing, setFlashing] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    if (!arriving) return;
    const land = window.setTimeout(() => setFlashing(signalColour[arriving.signal]), TRAVEL_MS);
    const clear = window.setTimeout(() => setFlashing(null), TRAVEL_MS + 700);
    return () => { window.clearTimeout(land); window.clearTimeout(clear); };
  }, [arriving?.id]);

  if (!rect) return null;
  const box = geometry.toPx(rect);
  const target = (kind: "move" | "resize", dx: number, dy: number): Rect => {
    const cells = geometry.toCells(dx, dy);
    return kind === "move" ? { ...rect, col: rect.col + cells.col, row: rect.row + cells.row } : { ...rect, w: rect.w + cells.col, h: rect.h + cells.row };
  };
  const begin = (kind: "move" | "resize") => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (kind === "move" && (event.target as HTMLElement).closest("button"))) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, y: event.clientY };
    setGesture({ kind, dx: 0, dy: 0 });
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    if (!gesture || !start.current) return;
    const dx = event.clientX - start.current.x, dy = event.clientY - start.current.y;
    setGesture({ ...gesture, dx, dy });
    const aim = target(gesture.kind, dx, dy);
    const drop = actions.preview(gesture.kind, id, aim);
    setRefused(Math.hypot(dx, dy) > 4 && !drop);
    onGhost(drop ? { rect: drop.landed, ok: true } : { rect: { col: Math.round(aim.col), row: Math.round(aim.row), w: Math.round(aim.w), h: Math.round(aim.h) }, ok: false });
  };
  const end = () => {
    if (!gesture) return;
    const moved = Math.hypot(gesture.dx, gesture.dy) > 4;
    if (moved) (gesture.kind === "move" ? actions.place : actions.resize)(id, target(gesture.kind, gesture.dx, gesture.dy));
    setGesture(null); setRefused(false); start.current = null; onGhost(null);
  };

  const live = gesture
    ? gesture.kind === "move" ? { ...box, x: box.x + gesture.dx, y: box.y + gesture.dy } : { ...box, width: Math.max(160, box.width + gesture.dx), height: Math.max(120, box.height + gesture.dy) }
    : box;
  const Icon = spec.icon;
  return <motion.section
    className={`tile${isStage ? " is-stage" : ""}${gesture ? " is-dragging" : ""}${flashing ? " is-flash" : ""}`}
    style={{ left: 0, top: 0, ["--flash-colour" as string]: flashing ?? "transparent" }}
    initial={{ opacity: 0, scale: 0.96, x: live.x, y: live.y, width: live.width, height: live.height }}
    animate={{ opacity: 1, scale: 1, x: live.x, y: live.y, width: live.width, height: live.height }}
    exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
    transition={gesture ? { duration: 0 } : spring}
    aria-label={spec.title} data-module={id} data-stage={isStage || undefined} data-refused={refused || undefined}>
    <header className="tile-head" onPointerDown={begin("move")} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onDoubleClick={() => actions.promote(id)}>
      <span className="tile-icon"><Icon size={15} strokeWidth={1.8} aria-hidden="true" /></span>
      <span className="tile-title">{spec.title}</span>
      {subtitle && <span className="tile-sub">· {subtitle}</span>}
      <span className="tile-signals" title={`Listens to ${spec.listens.map((signal) => signalName[signal]).join(", ")}${spec.emits.length ? ` · sends ${spec.emits.map((signal) => signalName[signal]).join(", ")}` : ""}`} aria-hidden="true">{spec.listens.map((signal) => <i key={signal} style={{ ["--dot" as string]: signalColour[signal] }} />)}</span>
      {!isStage && <button type="button" className="tile-action" aria-label={`Bring ${spec.title} to the stage`} title="Bring to the stage" onClick={() => actions.promote(id)}><Maximize2 size={14} /></button>}
      <button type="button" className="tile-action" aria-label={`Close ${spec.title}`} title="Close" onClick={() => actions.close(id)}><X size={14} /></button>
    </header>
    <div className="tile-body">{children}</div>
    <div className="tile-resize" aria-hidden="true" onPointerDown={begin("resize")} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
  </motion.section>;
}
