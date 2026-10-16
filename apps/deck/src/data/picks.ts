import { useSyncExternalStore } from "react";

/**
 * Tops the user picks in Correlation, by well: one depth per top name per well, measured depth in
 * metres. They sit beside the Directorate's picks, never over them, and are kept in this browser.
 */
export interface Pick { readonly name: string; readonly md: number }

const KEY = "deck-picks-v1";
let picks: Readonly<Record<string, readonly Pick[]>> = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    // Only well entries that are lists of named depths: anything else is dropped rather than crash every load.
    const ok = (pick: unknown): pick is Pick => !!pick && typeof (pick as Pick).name === "string" && typeof (pick as Pick).md === "number" && Number.isFinite((pick as Pick).md);
    return Object.fromEntries(Object.entries(value).filter(([, list]) => Array.isArray(list)).map(([id, list]) => [id, (list as unknown[]).filter(ok)]));
  } catch { return {}; }
})();
const listeners = new Set<() => void>();
function changed(next: Readonly<Record<string, readonly Pick[]>>) {
  picks = next;
  try { localStorage.setItem(KEY, JSON.stringify(picks)); } catch { /* not kept */ }
  for (const listener of [...listeners]) listener();
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => picks;
export const usePicks = () => useSyncExternalStore(subscribe, snapshot, snapshot);
export const picksOf = (wellId: string) => picks[wellId] ?? [];

/** Sets (or moves) a well's pick of a top. */
export function setPick(wellId: string, name: string, md: number) {
  const rounded = Math.round(md * 10) / 10;
  changed({ ...picks, [wellId]: [...picksOf(wellId).filter((pick) => pick.name !== name), { name, md: rounded }].sort((a, b) => a.md - b.md) });
}
export function removePick(wellId: string, name: string) {
  const rest = picksOf(wellId).filter((pick) => pick.name !== name);
  const next = { ...picks };
  if (rest.length) next[wellId] = rest; else delete next[wellId];
  changed(next);
}
