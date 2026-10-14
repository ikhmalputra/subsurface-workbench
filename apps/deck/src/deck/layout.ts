/**
 * The magnetic grid. Tiles live on whole cells of a 12 × 8 grid; a drag or a resize snaps to cells
 * when it ends. Dropping a tile mostly over another swaps their places, the way promoting a tile to
 * the stage does, so the grid never holds two tiles in one place. Each module has a smallest size
 * it can still be read at, and a drop that would squeeze a tile below it is refused.
 *
 * Any module can be open or closed. Opening one finds it room: free cells first, then a strip of
 * the largest tile that can spare one, and only then the place of the tile used longest ago.
 */
export const COLS = 12;
export const ROWS = 8;

export interface Rect { readonly col: number; readonly row: number; readonly w: number; readonly h: number }
export interface MinSize { readonly w: number; readonly h: number }
/** The open tiles, by module id. */
export type Layout = Readonly<Record<string, Rect>>;
export type Mins = Readonly<Record<string, MinSize>>;

/** A record without some keys. */
export function without<T extends Readonly<Record<string, unknown>>>(record: T, ...keys: readonly string[]): T {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key))) as T;
}

const MIN_W = 2;
const MIN_H = 2;
/** How much of the smaller tile a drop must cover to count as a swap. */
const SWAP_SHARE = 0.4;

export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.col + a.w, b.col + b.w) - Math.max(a.col, b.col);
  const h = Math.min(a.row + a.h, b.row + b.h) - Math.max(a.row, b.row);
  return w > 0 && h > 0 ? w * h : 0;
}

function clampRect(rect: Rect, min: MinSize = { w: MIN_W, h: MIN_H }): Rect {
  const w = Math.max(min.w, Math.min(COLS, Math.round(rect.w)));
  const h = Math.max(min.h, Math.min(ROWS, Math.round(rect.h)));
  return { w, h, col: Math.max(0, Math.min(COLS - w, Math.round(rect.col))), row: Math.max(0, Math.min(ROWS - h, Math.round(rect.row))) };
}

const fits = (rect: Rect, min: MinSize) => rect.w >= min.w && rect.h >= min.h;
const minOf = (mins: Mins, id: string): MinSize => mins[id] ?? { w: MIN_W, h: MIN_H };
const isFree = (tiles: Layout, rect: Rect, except?: string) => Object.entries(tiles).every(([id, other]) => id === except || overlapArea(rect, other) === 0);

/** The outcome of a drop: the layout after it, where the dragged tile lands, and who it swapped with. */
export interface Drop { readonly tiles: Layout; readonly landed: Rect; readonly swappedWith: string | null }

/**
 * A move. Free cells take the tile; mostly over another tile, the two swap, if both still fit their
 * smallest sizes; anything else (a partial overlap, a swap that would squeeze) is refused with null.
 */
export function planMove(tiles: Layout, id: string, target: Rect, mins: Mins): Drop | null {
  const own = tiles[id];
  if (!own) return null;
  const next = clampRect({ ...target, w: own.w, h: own.h }, minOf(mins, id));
  const hit = Object.keys(tiles).filter((other) => other !== id).map((other) => ({ other, area: overlapArea(next, tiles[other]!) })).sort((a, b) => b.area - a.area)[0];
  if (!hit || hit.area === 0) return { tiles: { ...tiles, [id]: next }, landed: next, swappedWith: null };
  const theirs = tiles[hit.other]!;
  const smaller = Math.min(next.w * next.h, theirs.w * theirs.h);
  if (hit.area / smaller < SWAP_SHARE) return null;
  if (!fits(theirs, minOf(mins, id)) || !fits(own, minOf(mins, hit.other))) return null;
  return { tiles: { ...tiles, [id]: theirs, [hit.other]: own }, landed: theirs, swappedWith: hit.other };
}

/** A resize: snapped, never below the module's smallest size, never over a neighbour. */
export function planResize(tiles: Layout, id: string, target: Rect, mins: Mins): Drop | null {
  const own = tiles[id];
  if (!own) return null;
  const next = clampRect({ ...target, col: own.col, row: own.row }, minOf(mins, id));
  if (!isFree(tiles, next, id)) return null;
  return { tiles: { ...tiles, [id]: next }, landed: next, swappedWith: null };
}

/** Every free rectangle at least `min` in size, largest first. The grid is small enough to enumerate. */
export function freeRects(tiles: Layout, min: MinSize): Rect[] {
  const found: Rect[] = [];
  for (let col = 0; col < COLS; col++) for (let row = 0; row < ROWS; row++) for (let w = min.w; col + w <= COLS; w++) for (let h = min.h; row + h <= ROWS; h++) {
    const rect = { col, row, w, h };
    if (isFree(tiles, rect)) found.push(rect);
  }
  return found.sort((a, b) => b.w * b.h - a.w * a.h || a.row - b.row || a.col - b.col);
}

/** Where opening a module puts it, and what (if anything) it displaced. */
export interface Opening { readonly tiles: Layout; readonly landed: Rect; readonly split: string | null; readonly replaced: string | null }

/** The stage gives room to a new module only while it stays a stage. */
const STAGE_MIN: MinSize = { w: 4, h: 5 };

/**
 * Trims a tile back from a rectangle that crosses one of its sides from edge to edge; null when the
 * rectangle cuts into it any other way, or would leave it smaller than `keep`.
 */
function trimAway(tile: Rect, cut: Rect, keep: MinSize): Rect | null {
  if (overlapArea(tile, cut) === 0) return tile;
  const spansWidth = cut.col <= tile.col && cut.col + cut.w >= tile.col + tile.w;
  const spansHeight = cut.row <= tile.row && cut.row + cut.h >= tile.row + tile.h;
  const options: Rect[] = [];
  if (spansWidth && cut.row > tile.row) options.push({ ...tile, h: cut.row - tile.row });
  if (spansWidth && cut.row + cut.h < tile.row + tile.h) options.push({ ...tile, row: cut.row + cut.h, h: tile.row + tile.h - (cut.row + cut.h) });
  if (spansHeight && cut.col > tile.col) options.push({ ...tile, w: cut.col - tile.col });
  if (spansHeight && cut.col + cut.w < tile.col + tile.w) options.push({ ...tile, col: cut.col + cut.w, w: tile.col + tile.w - (cut.col + cut.w) });
  const fitting = options.filter((option) => fits(option, keep) && overlapArea(option, cut) === 0);
  return fitting.sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? null;
}

/**
 * Room made by trimming: every placement of the new module, from its preferred size down to its
 * smallest, where each tile it covers can be trimmed back along a clean edge and still be read.
 * The best keeps the new module large and disturbs the fewest cells.
 */
function makeRoom(tiles: Layout, id: string, min: MinSize, preferred: MinSize, keepFor: (other: string) => MinSize): Opening | null {
  let best: { score: number; opening: Opening } | null = null;
  // Any size from the smallest up: a strip often has to span a whole tile's edge to cut it cleanly.
  for (let w = min.w; w <= COLS; w++) for (let h = min.h; h <= ROWS; h++) {
    for (let col = 0; col + w <= COLS; col++) for (let row = 0; row + h <= ROWS; row++) {
      const cut = { col, row, w, h };
      const next: Record<string, Rect> = {};
      let lost = 0, touched: string | null = null, ok = true;
      for (const [other, rect] of Object.entries(tiles)) {
        const trimmed = trimAway(rect, cut, keepFor(other));
        if (!trimmed) { ok = false; break; }
        if (trimmed !== rect) { lost += rect.w * rect.h - trimmed.w * trimmed.h; touched ??= other; }
        next[other] = trimmed;
      }
      if (!ok) continue;
      // Large up to the preferred size; beyond it, extra area is worth little and costs neighbours.
      const useful = Math.min(w, preferred.w) * Math.min(h, preferred.h);
      const score = useful * 10 - lost - (w * h - useful) * 0.5;
      if (!best || score > best.score) best = { score, opening: { tiles: { ...next, [id]: cut }, landed: cut, split: touched, replaced: null } };
    }
  }
  return best?.opening ?? null;
}

/**
 * Room for a module being opened. Free cells, as near the preferred size as they allow; otherwise
 * room made by trimming the tiles around it back along clean edges (the stage too, while it stays
 * at least `STAGE_MIN`); only then the place of the tile used longest ago.
 */
export function planOpen(tiles: Layout, id: string, mins: Mins, preferred: MinSize, stage: string | null, lastUsed: Readonly<Record<string, number>> = {}): Opening | null {
  if (tiles[id]) return { tiles, landed: tiles[id]!, split: null, replaced: null };
  const min = minOf(mins, id);
  const free = freeRects(tiles, min);
  if (free.length) {
    // The free rectangle whose overlap with the preferred size is largest, trimmed to that size.
    const best = free.reduce((a, b) => Math.min(b.w, preferred.w) * Math.min(b.h, preferred.h) > Math.min(a.w, preferred.w) * Math.min(a.h, preferred.h) ? b : a);
    const landed = { col: best.col, row: best.row, w: Math.min(best.w, Math.max(min.w, preferred.w)), h: Math.min(best.h, Math.max(min.h, preferred.h)) };
    return { tiles: { ...tiles, [id]: landed }, landed, split: null, replaced: null };
  }
  const bySize = Object.entries(tiles).sort(([, a], [, b]) => b.w * b.h - a.w * a.h);
  const made = makeRoom(tiles, id, min, preferred, (other) => other === stage ? { w: Math.max(STAGE_MIN.w, minOf(mins, other).w), h: Math.max(STAGE_MIN.h, minOf(mins, other).h) } : minOf(mins, other));
  if (made) return made;
  const oldest = bySize.map(([other]) => other).filter((other) => other !== stage).sort((a, b) => (lastUsed[a] ?? 0) - (lastUsed[b] ?? 0))
    .find((other) => fits(tiles[other]!, min));
  if (!oldest) return null;
  const landed = tiles[oldest]!;
  return { tiles: { ...without(tiles, oldest), [id]: landed }, landed, split: null, replaced: oldest };
}

/**
 * A module dropped from the dock at a cell. Over a tile, it takes that tile's place (the stage
 * included); on free cells, it takes the free room around the cell up to its preferred size.
 */
export function planDropIn(tiles: Layout, id: string, at: { readonly col: number; readonly row: number }, mins: Mins, preferred: MinSize): Opening | null {
  const min = minOf(mins, id);
  const cell = { col: Math.floor(at.col), row: Math.floor(at.row), w: 1, h: 1 };
  const under = Object.entries(tiles).find(([, rect]) => overlapArea(rect, cell) > 0);
  if (under) {
    const [other, rect] = under;
    if (other === id || !fits(rect, min)) return null;
    return { tiles: { ...without(tiles, other, id), [id]: rect }, landed: rect, split: null, replaced: other };
  }
  const others = without(tiles, id);
  const room = freeRects(others, min).filter((rect) => overlapArea(rect, cell) > 0);
  if (!room.length) return null;
  const best = room.reduce((a, b) => Math.min(b.w, preferred.w) * Math.min(b.h, preferred.h) > Math.min(a.w, preferred.w) * Math.min(a.h, preferred.h) ? b : a);
  const w = Math.min(best.w, Math.max(min.w, preferred.w)), h = Math.min(best.h, Math.max(min.h, preferred.h));
  // Keep the dropped cell inside the trimmed rectangle.
  const col = Math.max(best.col, Math.min(cell.col, best.col + best.w - w)), row = Math.max(best.row, Math.min(cell.row, best.row + best.h - h));
  const landed = { col, row, w, h };
  return { tiles: { ...others, [id]: landed }, landed, split: null, replaced: null };
}

/** A stored layout is used only if it names known modules, on the grid, without overlaps. */
export function isLayout(value: unknown, known: readonly string[], mins: Mins): value is Layout {
  if (!value || typeof value !== "object") return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return false;
  const placed: Rect[] = [];
  for (const [id, raw] of entries) {
    const rect = raw as Rect | undefined;
    if (!known.includes(id) || !rect || ![rect.col, rect.row, rect.w, rect.h].every(Number.isInteger)) return false;
    if (rect.col < 0 || rect.row < 0 || rect.col + rect.w > COLS || rect.row + rect.h > ROWS || !fits(rect, minOf(mins, id))) return false;
    if (placed.some((other) => overlapArea(other, rect) > 0)) return false;
    placed.push(rect);
  }
  return true;
}

/** Pixel geometry of the grid for a measured box. */
export function cellGeometry(width: number, height: number, gap: number) {
  const cellW = (width - gap * (COLS - 1)) / COLS;
  const cellH = (height - gap * (ROWS - 1)) / ROWS;
  const toPx = (rect: Rect) => ({ x: rect.col * (cellW + gap), y: rect.row * (cellH + gap), width: rect.w * cellW + (rect.w - 1) * gap, height: rect.h * cellH + (rect.h - 1) * gap });
  const toCells = (dx: number, dy: number) => ({ col: dx / (cellW + gap), row: dy / (cellH + gap) });
  return { cellW, cellH, toPx, toCells };
}
