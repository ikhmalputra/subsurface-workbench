import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { ModuleId } from "../modules/registry.ts";
import { groups, missing, modules } from "../modules/registry.ts";
import type { Ghost } from "./Tile.tsx";
import { actions, useDeck } from "./store.ts";

/** The grid tells the dock which cell is under a point, so a module can be dropped where it is wanted. */
export const gridProbe: { cellAt: ((x: number, y: number) => { col: number; row: number } | null) | null } = { cellAt: null };

/**
 * Every module, open or not. Click one to open it where there is room (or, if it is open, to stage
 * it); drag one onto the grid to put it exactly there, over a tile to take that tile's place.
 */
export function Dock({ onGhost }: { readonly onGhost: (ghost: Ghost | null) => void }) {
  const tiles = useDeck((deck) => deck.tiles);
  const stage = useDeck((deck) => deck.stage);
  const siteId = useDeck((deck) => deck.siteId);
  const drag = useRef<{ id: ModuleId; x: number; y: number; moved: boolean } | null>(null);
  const [carry, setCarry] = useState<{ id: ModuleId; x: number; y: number } | null>(null);

  const down = (id: ModuleId) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id, x: event.clientX, y: event.clientY, moved: false };
  };
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current) return;
    if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
    current.moved = true;
    setCarry({ id: current.id, x: event.clientX, y: event.clientY });
    const cell = gridProbe.cellAt?.(event.clientX, event.clientY) ?? null;
    const landed = cell ? actions.previewDropIn(current.id, cell) : null;
    onGhost(landed ? { rect: landed, ok: true } : cell ? { rect: { col: Math.floor(cell.col), row: Math.floor(cell.row), w: 1, h: 1 }, ok: false } : null);
  };
  const up = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    drag.current = null; setCarry(null); onGhost(null);
    if (!current) return;
    if (!current.moved) { if (tiles[current.id]) actions.promote(current.id); else actions.open(current.id); return; }
    const cell = gridProbe.cellAt?.(event.clientX, event.clientY);
    if (cell) actions.dropIn(current.id, cell);
  };

  return <nav className="dock" aria-label="Modules">
    {groups.map((group) => <div key={group} className="dock-group" role="group" aria-label={group}>
      {modules.filter((spec) => spec.group === group).map((spec) => {
        const Icon = spec.icon;
        const open = !!tiles[spec.id];
        const waiting = missing(spec.id, siteId) !== null;
        return <button key={spec.id} type="button" className="dock-item" data-open={open || undefined} data-stage={stage === spec.id || undefined} data-waiting={waiting || undefined}
          aria-label={`${spec.title} (${spec.group}): ${spec.blurb}${open ? " (open)" : ""}`} title={`${spec.title} · ${spec.group}\n${spec.blurb}${open ? "\nOpen · click to stage" : "\nClick to open · drag onto the deck"}`}
          onPointerDown={down(spec.id)} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; setCarry(null); onGhost(null); }}>
          <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
        </button>;
      })}
    </div>)}
    {carry && createPortal(<div className="dock-carry" style={{ left: carry.x + 14, top: carry.y + 10 }} aria-hidden="true">{modules.find((spec) => spec.id === carry.id)?.title}</div>, document.body)}
  </nav>;
}
