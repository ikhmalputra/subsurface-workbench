import { useSyncExternalStore } from "react";

/**
 * A site's timeline when it has no daily drilling reports: a producing well's life, history and
 * forecast, offered by whichever module models it. The time rail draws it and scrubs the shared
 * time cursor over it; the module listens to that cursor like any other.
 */
export interface Timeline {
  readonly siteId: string;
  readonly label: string;
  readonly startMs: number;
  readonly endMs: number;
  /** Where history ends and the forecast begins. */
  readonly todayMs: number;
  /** A profile to draw, 0–1 (e.g. oil rate), at evenly spaced times across the span. */
  readonly profile: readonly number[];
  readonly marks: readonly { readonly ms: number; readonly label: string }[];
  /** What the cursor snaps to (a day unless said), and how a time on it reads (a month unless said). */
  readonly stepMs?: number;
  readonly describe?: (ms: number) => string;
  /** The rail's name for this timeline beside another the site has (FORGE: its drilling days). */
  readonly short?: string;
}
let current: Timeline | null = null;
const listeners = new Set<() => void>();
export const timeline = {
  get: () => current,
  set: (next: Timeline | null) => { current = next; listeners.forEach((listener) => listener()); },
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
export const useTimeline = () => useSyncExternalStore(timeline.subscribe, timeline.get);
