"use client";

import { useEffect, useState } from "react";
import { loadLas, loadedLas, type LoadedLas } from "../lib/well-data";

export interface LasState {
  /** The URL this state describes, so a state left over from the previous well is never read. */
  readonly url: string | undefined;
  readonly status: "absent" | "loading" | "ready" | "error";
  readonly loaded: LoadedLas | null;
  readonly error: string | null;
}

function initial(url: string | undefined): LasState {
  if (!url) return { url, status: "absent", loaded: null, error: null };
  const already = loadedLas(url);
  return already
    ? { url, status: "ready", loaded: already, error: null }
    : { url, status: "loading", loaded: null, error: null };
}

/**
 * Subscribe to the one parse of a LAS file.
 *
 * Every pane that shows a mud log calls this, and the shared cache means the second caller pays
 * nothing: a pane opened after the first load renders ready on its first frame rather than
 * flashing a loading state. Passing `undefined` is how a pane says it does not need the file yet —
 * a collapsed tab, a well with no log — and nothing is fetched.
 */
export function useLas(url: string | undefined): LasState {
  const [state, setState] = useState<LasState>(() => initial(url));
  useEffect(() => {
    if (!url) { setState(initial(url)); return; }
    const already = loadedLas(url);
    if (already) { setState({ url, status: "ready", loaded: already, error: null }); return; }
    let live = true;
    setState({ url, status: "loading", loaded: null, error: null });
    loadLas(url)
      .then((loaded) => { if (live) setState({ url, status: "ready", loaded, error: null }); })
      .catch((error: unknown) => { if (live) setState({ url, status: "error", loaded: null, error: error instanceof Error ? error.message : String(error) }); });
    return () => { live = false; };
  }, [url]);
  // The effect runs after paint, so on the render where `url` changes the state still describes the
  // old one. Deriving the new state here keeps a pane from drawing another well's log for a frame.
  return state.url === url ? state : initial(url);
}
