import { useSyncExternalStore } from "react";
import type { SavedAnalysis } from "./dca.ts";

/**
 * Saved decline analyses, kept in this browser beside the deck's wells and designs. Each keeps what
 * the user chose and the numbers it gave when saved; reopening one recomputes from the data.
 */

const KEY = "deck-dca-v1";
let analyses: readonly SavedAnalysis[] = (() => { try { const value = JSON.parse(localStorage.getItem(KEY) ?? "[]") as SavedAnalysis[]; return Array.isArray(value) ? value : []; } catch { return []; } })();
const listeners = new Set<() => void>();
const changed = () => { try { localStorage.setItem(KEY, JSON.stringify(analyses)); } catch { /* not kept */ } for (const listener of [...listeners]) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => analyses;

export const useSavedAnalyses = (): readonly SavedAnalysis[] => useSyncExternalStore(subscribe, snapshot, snapshot);

export function saveAnalysis(value: Omit<SavedAnalysis, "id" | "savedAt">): SavedAnalysis {
  const entry: SavedAnalysis = { ...value, id: `dca-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, savedAt: Date.now() };
  analyses = [entry, ...analyses];
  changed();
  return entry;
}

export function updateAnalysis(id: string, value: Omit<SavedAnalysis, "id" | "savedAt">): void {
  analyses = analyses.map((entry) => entry.id === id ? { ...value, id, savedAt: Date.now() } : entry);
  changed();
}

export function deleteAnalysis(id: string): void {
  analyses = analyses.filter((entry) => entry.id !== id);
  changed();
}

/** Adds analyses read from a file; one already here (same id) is replaced by the file's. */
export function addAnalyses(incoming: readonly SavedAnalysis[]): void {
  const ids = new Set(incoming.map((entry) => entry.id));
  analyses = [...incoming, ...analyses.filter((entry) => !ids.has(entry.id))];
  changed();
}
