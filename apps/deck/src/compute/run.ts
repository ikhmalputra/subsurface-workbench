import { useEffect, useState } from "react";
import type * as Jobs from "./jobs.ts";

/**
 * Heavy work off the main thread. `compute("job", ...args)` runs one of the functions in jobs.ts in
 * a module worker and resolves with its result; typed arrays travel both ways by transfer, not by
 * copy. Where workers are not available (Node tests, a browser without module workers) the same
 * function runs here instead, so the result never depends on where it ran.
 */
type JobName = keyof typeof Jobs;
type Job<N extends JobName> = (typeof Jobs)[N];
type Result<N extends JobName> = Awaited<ReturnType<Job<N>>>;

let worker: Worker | null | undefined = null;
let next = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

function connect(): Worker | undefined {
  if (worker !== null) return worker;
  if (typeof Worker === "undefined") return (worker = undefined);
  try {
    const created = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "deck-compute" });
    created.onmessage = (event: MessageEvent<{ id: number; value?: unknown; error?: string }>) => {
      const job = pending.get(event.data.id); if (!job) return;
      pending.delete(event.data.id);
      if (event.data.error !== undefined) job.reject(new Error(event.data.error)); else job.resolve(event.data.value);
    };
    // A worker that cannot start (blocked, or failed to load) is dropped; jobs then run here.
    created.onerror = () => { for (const job of pending.values()) job.reject(new Error("The compute worker stopped.")); pending.clear(); worker = undefined; };
    return (worker = created);
  } catch { return (worker = undefined); }
}

export function compute<N extends JobName>(name: N, ...args: Parameters<Job<N>>): Promise<Result<N>> {
  const target = connect();
  if (!target) return import("./jobs.ts").then((jobs) => (jobs[name] as (...a: unknown[]) => Result<N>)(...args));
  return new Promise<Result<N>>((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    // Only raw buffers handed in (a fetched file) are transferred: typed arrays the page still holds are copied.
    target.postMessage({ id, name, args }, args.filter((arg): arg is ArrayBuffer => arg instanceof ArrayBuffer));
  });
}

/** A job's result for React: recomputed when `key` changes, the last result kept until the next arrives. */
export function useComputed<N extends JobName>(key: string | null, name: N, args: () => Parameters<Job<N>>): { readonly value: Result<N> | null; readonly error: string | null } {
  const [state, setState] = useState<{ key: string; value: Result<N> | null; error: string | null } | null>(null);
  useEffect(() => {
    if (key === null) return;
    let live = true;
    compute(name, ...args()).then((value) => { if (live) setState({ key, value, error: null }); }, (cause: unknown) => { if (live) setState({ key, value: null, error: cause instanceof Error ? cause.message : String(cause) }); });
    return () => { live = false; };
  }, [key]);
  return { value: state?.value ?? null, error: state?.key === key ? state.error : null };
}
