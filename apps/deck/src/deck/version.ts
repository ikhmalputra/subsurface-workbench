/**
 * The build the deck is running, and whether a newer one has been deployed under it.
 *
 * Every build carries `version.json` beside its pages (written by vite.config.ts). The deck reads
 * its own copy once at start, then reads it again every few minutes and when the tab comes back
 * into view. When the file names another version or commit, a release has been rolled out on this
 * origin: the deck says so in the lens bar and offers a reload. Nothing is fetched from anywhere but
 * the deck's own origin, and a host without the file (a plain static copy) is simply never updated
 * this way.
 */
export interface DeckVersion {
  readonly version: string;
  readonly commit: string;
  readonly builtAt: string;
  /** The schema versions this build reads: a client checks them against docs/UPGRADING.md before a jump. */
  readonly schemas: { readonly config: number; readonly contract: string };
  /** The oldest release this one upgrades from without an intermediate step. */
  readonly minUpgradeFrom: string;
}

let running: DeckVersion | null = null;
let available: DeckVersion | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };

const isVersion = (value: unknown): value is DeckVersion => typeof value === "object" && value !== null
  && typeof (value as DeckVersion).version === "string" && typeof (value as DeckVersion).commit === "string";
/** Two builds are the same deployment only when both version and commit agree: a rebuild of the same version is still new code. */
const same = (a: DeckVersion, b: DeckVersion) => a.version === b.version && a.commit === b.commit;

/** Reads `<base>version.json` without the HTTP cache; null when the host has none or it is not a version file. */
export async function readVersion(base: string, fetcher: typeof fetch = fetch): Promise<DeckVersion | null> {
  try {
    const response = await fetcher(`${base}version.json`, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return null;
    const json: unknown = await response.json();
    return isVersion(json) ? json : null;
  } catch {
    return null;
  }
}

/** The build this tab loaded, once `startUpdateWatch` has read it. */
export const runningVersion = (): DeckVersion | null => running;
/** The newer build deployed under this tab, or null. For `useSyncExternalStore`. */
export const updateAvailable = (): DeckVersion | null => available;
export function subscribeUpdate(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }

/**
 * Starts watching: the first read fixes the running build; later reads that differ announce an
 * update. Returns a stop function. `intervalMs` defaults to five minutes.
 */
export function startUpdateWatch(options: { readonly base: string; readonly intervalMs?: number; readonly fetcher?: typeof fetch; readonly window?: Pick<Window, "setInterval" | "clearInterval" | "addEventListener" | "removeEventListener"> & { readonly document?: Pick<Document, "visibilityState"> } }): () => void {
  const { base, intervalMs = 5 * 60_000, fetcher = fetch } = options;
  const win = options.window ?? (typeof window === "undefined" ? null : window);
  let stopped = false;
  const check = async () => {
    const seen = await readVersion(base, fetcher);
    if (stopped || !seen) return;
    if (!running) { running = seen; emit(); return; }
    if (!same(running, seen) && (!available || !same(available, seen))) { available = seen; emit(); }
  };
  void check();
  if (!win) return () => { stopped = true; };
  const timer = win.setInterval(() => void check(), intervalMs);
  const onVisible = () => { if ((win.document ?? (typeof document === "undefined" ? null : document))?.visibilityState !== "hidden") void check(); };
  win.addEventListener("visibilitychange", onVisible);
  return () => { stopped = true; win.clearInterval(timer); win.removeEventListener("visibilitychange", onVisible); };
}

/** Tests only. */
export function resetVersionWatch(): void { running = null; available = null; listeners.clear(); }
