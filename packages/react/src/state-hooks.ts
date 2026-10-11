"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import type { SubsurfaceState, SubsurfaceStore } from "@ikhmalputra/subsurface-core/state";

/** Select immutable branches/scalars; supply equality for derived objects. Raw canvas can subscribe directly. */
export function useSubsurfaceSelector<T>(store: SubsurfaceStore, selector: (state: SubsurfaceState) => T, equality: (a: T, b: T) => boolean = Object.is): T {
  const cache = useRef<{ state: SubsurfaceState; selector: typeof selector; value: T } | null>(null);
  const subscribe = useCallback((notify: () => void) => store.subscribe(() => notify()), [store]);
  const getSnapshot = useCallback(() => {
    const state = store.getState(), previous = cache.current;
    if (previous?.state === state && previous.selector === selector) return previous.value;
    const selected = selector(state);
    const value = previous && equality(previous.value, selected) ? previous.value : selected;
    cache.current = { state, selector, value };
    return value;
  }, [store, selector, equality]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
