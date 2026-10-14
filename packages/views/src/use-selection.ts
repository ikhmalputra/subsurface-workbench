"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { type Selection, type SelectionStore, cursorMdM, emptySelection } from "@ikhmalputra/subsurface-kernel";

/**
 * How a view joins the shared selection, or does not.
 *
 * Every view in this package takes `store?: SelectionStore`. Given one it subscribes itself and two
 * views on a page are linked with no host code between them. Given none it falls back to its own
 * local state and behaves exactly as a controlled component, which is what a host that wants to own
 * everything should get.
 *
 * That optionality is the whole design. The previous package made the host wire every relationship
 * by hand, so the quickstart showed you passing `selectedId` and `onSelect` yourself and nothing
 * linked until you did.
 */

export function useSelection(store?: SelectionStore): Selection {
  const [local, setLocal] = useState<Selection>(emptySelection);
  const subscribe = (notify: () => void) => (store ? store.subscribe(notify) : () => undefined);
  const read = () => (store ? store.get() : local);
  // The server has no store subscription; it renders the same snapshot the client starts from.
  const shared = useSyncExternalStore(subscribe, read, read);
  useEffect(() => { if (!store) setLocal(emptySelection); }, [store]);
  return store ? shared : local;
}

/** Reading and writing in one place, so a view never has to branch on whether it is linked. */
export interface Linked {
  readonly selection: Selection;
  /** The depth to draw a cursor at: what was picked, or what is under the pointer. */
  readonly cursorMdM: number | null;
  readonly select: (componentId: string | null) => void;
  readonly pin: (mdM: number | null) => void;
  readonly hover: (mdM: number | null) => void;
  readonly setWindow: (window: readonly [number, number] | null) => void;
}

export function useLinked(origin: string, store?: SelectionStore): Linked {
  const [local, setLocal] = useState<Selection>(emptySelection);
  const shared = useSelection(store);
  const selection = store ? shared : local;
  const change = (part: Partial<Selection>) => {
    if (store) store.set(part, origin);
    else setLocal((current) => ({ ...current, ...part }));
  };
  return {
    selection,
    cursorMdM: cursorMdM(selection),
    select: (componentId) => change({ componentId }),
    pin: (mdM) => change({ pinnedMdM: mdM }),
    hover: (mdM) => (store ? store.hover(mdM, origin) : setLocal((current) => ({ ...current, hoverMdM: mdM }))),
    setWindow: (window) => change({ window }),
  };
}
