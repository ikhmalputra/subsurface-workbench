import { useEffect, useState, useSyncExternalStore } from "react";
import { metresToFeet } from "@ikhmalputra/subsurface-core";
import { parseLas } from "@ikhmalputra/subsurface-core/records";
import type { LasFile } from "@ikhmalputra/subsurface-core/records";

/**
 * LAS files a user imports for a well, any well. What they are (curves, depth range, the index
 * unit) is kept with the deck's other records; the files themselves sit in this browser's IndexedDB,
 * which holds far more than local storage. A file is read back as it was given: only its depth index
 * is turned into feet, the unit the log tracks read.
 */

export interface ImportedLog {
  readonly id: string;
  readonly wellId: string;
  readonly fileName: string;
  readonly importedAt: number;
  readonly bytes: number;
  /** The index curve's mnemonic and unit as the file gives them, and the unit it was read in. */
  readonly index: { readonly mnemonic: string; readonly unit: string; readonly readAs: "m" | "ft" };
  readonly curves: readonly { readonly mnemonic: string; readonly unit: string; readonly description: string }[];
  readonly topM: number;
  readonly baseM: number;
  readonly samples: number;
  /** The file's WELL line, if any: to check it is the well it was imported for. */
  readonly lasWell: string | null;
}

const KEY = "deck-logs-v1";
let logs: readonly ImportedLog[] = (() => { try { const value = JSON.parse(localStorage.getItem(KEY) ?? "[]") as ImportedLog[]; return Array.isArray(value) ? value : []; } catch { return []; } })();
const listeners = new Set<() => void>();
const changed = () => { try { localStorage.setItem(KEY, JSON.stringify(logs)); } catch { /* not kept */ } for (const listener of [...listeners]) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => logs;

export const importedLogs = (wellId: string | null) => logs.filter((log) => log.wellId === wellId);
export function useImportedLogs(wellId: string | null): readonly ImportedLog[] {
  const all = useSyncExternalStore(subscribe, snapshot, snapshot);
  return all.filter((log) => log.wellId === wellId);
}

/* ---- IndexedDB: one store of LAS text by id ---- */
const database = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("deck-files", 1);
  request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("las")) request.result.createObjectStore("las"); };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error("This browser keeps no files (IndexedDB is unavailable)."));
});
async function store(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest) {
  const db = await database();
  return new Promise<unknown>((resolve, reject) => {
    const request = run(db.transaction("las", mode).objectStore("las"));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const FEET = /^(f|ft|feet|foot|usft|ft\(us\))$/i;
const METRES = /^(m|meter|meters|metre|metres)$/i;

/** Reads a LAS file and keeps it for a well; throws with the reason when it cannot be read. */
export async function importLas(wellId: string, file: File): Promise<ImportedLog> {
  const text = await file.text();
  let las: LasFile;
  try { las = parseLas(text); } catch (reason) { throw new Error(`Not a readable LAS file: ${(reason as Error).message}`, { cause: reason }); }
  const [index, ...curves] = las.curves;
  if (!index || !curves.length) throw new Error("The file has no curves besides its depth index.");
  const unit = index.unit.trim();
  const readAs = FEET.test(unit) ? "ft" : METRES.test(unit) ? "m" : null;
  if (!readAs) throw new Error(`The depth index ${index.mnemonic} is in "${unit || "no unit"}": only metres or feet can be placed on the well.`);
  const depths = index.values.filter((value): value is number => value !== null);
  if (!depths.length) throw new Error("The depth index has no values.");
  const toM = (value: number) => readAs === "ft" ? value * 0.3048 : value;
  const log: ImportedLog = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, wellId, fileName: file.name, importedAt: Date.now(), bytes: file.size,
    index: { mnemonic: index.mnemonic, unit, readAs }, curves: curves.map((curve) => ({ mnemonic: curve.mnemonic, unit: curve.unit, description: curve.description })),
    topM: toM(Math.min(...depths)), baseM: toM(Math.max(...depths)), samples: depths.length, lasWell: las.well.WELL?.value?.trim() || null,
  };
  await store("readwrite", (objects) => objects.put(text, log.id));
  logs = [...logs, log];
  changed();
  return log;
}
export async function removeLog(id: string) {
  logs = logs.filter((log) => log.id !== id);
  changed();
  try { await store("readwrite", (objects) => objects.delete(id)); } catch { /* the file goes with the browser's storage */ }
}

const parsed = new Map<string, LasFile>();
/** An imported log, read back and indexed in feet for the log tracks. */
export function useLasFile(log: ImportedLog | null): { readonly las: LasFile | null; readonly error: string | null } {
  const [state, setState] = useState<{ las: LasFile | null; error: string | null }>({ las: log ? parsed.get(log.id) ?? null : null, error: null });
  useEffect(() => {
    if (!log) { setState({ las: null, error: null }); return; }
    const kept = parsed.get(log.id);
    if (kept) { setState({ las: kept, error: null }); return; }
    let live = true;
    store("readonly", (objects) => objects.get(log.id)).then((text) => {
      if (!live) return;
      if (typeof text !== "string") { setState({ las: null, error: "The file is no longer in this browser's storage; import it again." }); return; }
      const las = parseLas(text);
      const [index, ...rest] = las.curves;
      const inFeet: LasFile = log.index.readAs === "ft" ? las : { ...las, curves: [{ ...index!, unit: "ft", values: index!.values.map((value) => value === null ? null : metresToFeet(value)) }, ...rest] };
      parsed.set(log.id, inFeet);
      setState({ las: inFeet, error: null });
    }).catch((reason: unknown) => { if (live) setState({ las: null, error: (reason as Error).message }); });
    return () => { live = false; };
  }, [log]);
  return state;
}

/** Tracks for an imported log: its curves (up to eight), each on the range its own values span. */
export function tracksOf(las: LasFile) {
  const palette = ["#a3e635", "#f87171", "#f472b6", "#60a5fa", "#c084fc", "#fbbf24", "#2dd4bf", "#fb923c"];
  return las.curves.slice(1, 9).map((curve, index) => {
    const values = curve.values.filter((value): value is number => value !== null && Number.isFinite(value)).sort((a, b) => a - b);
    const at = (q: number) => values[Math.min(values.length - 1, Math.max(0, Math.round(q * (values.length - 1))))] ?? 0;
    const resistivity = /^(rt|rd|rs|ild|ilm|lld|lls|res|at90|at10|rdeep|rlld|msfl)/i.test(curve.mnemonic) && at(0.01) > 0;
    const low = at(0.01), high = at(0.99);
    return { mnemonic: curve.mnemonic, label: curve.mnemonic, color: palette[index]!, min: resistivity ? Math.max(0.1, low) : low, max: high > low ? high : low + 1, ...(resistivity ? { scale: "log" as const } : {}) };
  });
}
