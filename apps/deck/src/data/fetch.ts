import { useEffect, useState } from "react";

/**
 * Files the deck reads from its own origin, fetched and parsed once per URL however many modules
 * ask. A failed load is not kept, so asking again can succeed.
 */
const requests = new Map<string, Promise<unknown>>();

export function useFetched<T>(url: string | null, parse: (buffer: ArrayBuffer) => T): { readonly value: T | null; readonly error: string | null; readonly loading: boolean } {
  const [state, setState] = useState<{ url: string; value: T | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    let request = requests.get(url) as Promise<T> | undefined;
    if (!request) {
      request = fetch(url).then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.arrayBuffer(); }).then(parse);
      request.catch(() => requests.delete(url));
      requests.set(url, request);
    }
    request.then((value) => { if (live) setState({ url, value, error: null }); }, (cause: unknown) => { if (live) setState({ url, value: null, error: cause instanceof Error ? cause.message : String(cause) }); });
    return () => { live = false; };
  }, [url]);
  const current = state?.url === url ? state : null;
  return { value: current?.value ?? null, error: current?.error ?? null, loading: url !== null && current === null };
}
