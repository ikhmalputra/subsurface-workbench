import { useSyncExternalStore } from "react";

/**
 * Tops the user picks in Correlation, by well: one depth per top name per well, measured depth in
 * metres. They sit beside the Directorate's picks, never over them, and are kept in this browser.
 */
export interface Pick { readonly name: string; readonly md: number }

const KEY = "deck-picks-v1";
let picks: Readonly<Record<string, readonly Pick[]>> = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Pick[]>;
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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
