import { useSyncExternalStore } from "react";

/**
 * What the Stimulation module is showing, for the other views of the site: the model's events and
 * the catalogue's up to the job time, the stages' intervals on 16A, all in the model's frame (metres
 * east and north of 16A's as-built wellhead, elevation above sea level). Site in 3D draws them with
 * the site's own wells and seismic. Empty while the module is closed.
 */
export interface StimulationView {
  readonly tS: number;
  readonly model: readonly { readonly x: number; readonly y: number; readonly z: number; readonly mw: number; readonly colour: string }[];
  readonly observed: readonly { readonly x: number; readonly y: number; readonly z: number; readonly mw: number }[];
  readonly observedLabel: string | null;
  readonly stages: readonly { readonly id: string; readonly label: string; readonly colour: string; readonly topMdM: number; readonly baseMdM: number }[];
}
let current: StimulationView | null = null;
const listeners = new Set<() => void>();
export const stimulationView = {
  get: () => current,
  set: (next: StimulationView | null) => { current = next; for (const listener of [...listeners]) listener(); },
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
export const useStimulationView = () => useSyncExternalStore(stimulationView.subscribe, stimulationView.get);
