/// <reference lib="webworker" />
import * as jobs from "./jobs.ts";
import { transferables } from "./transfer.ts";

/** The deck's compute worker: runs a job by name and posts back its result, typed arrays transferred. */
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async (event: MessageEvent<{ id: number; name: keyof typeof jobs; args: unknown[] }>) => {
  const { id, name, args } = event.data;
  try {
    const value = await (jobs[name] as (...a: unknown[]) => unknown)(...args);
    scope.postMessage({ id, value }, transferables(value));
  } catch (cause) {
    scope.postMessage({ id, error: cause instanceof Error ? cause.message : String(cause) });
  }
};
