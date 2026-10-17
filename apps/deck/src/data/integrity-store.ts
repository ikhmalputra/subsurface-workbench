import { useSyncExternalStore } from "react";

/**
 * The annuli as the Nodal integrity lens last read them, for Barriers: each one's pressure, MAASP
 * and its limit, BSEE's MAWOP, and whether its record shows sustained casing pressure. Null until
 * the lens has been opened on this site.
 */
export interface AnnulusStatus {
  readonly name: string;
  readonly psi: number;
  readonly source: string;
  readonly maaspPsi: number;
  readonly governing: string;
  readonly mawopPsi: number;
  readonly mawopBy: string;
  readonly measuredPsi: number | null;
  readonly sustained: boolean | null;
}
let current: { readonly siteId: string; readonly hours: number; readonly annuli: readonly AnnulusStatus[] } | null = null;
const listeners = new Set<() => void>();
export const integrityStatus = {
  get: () => current,
  set: (next: typeof current) => { current = next; for (const listener of [...listeners]) listener(); },
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
export const useIntegrityStatus = () => useSyncExternalStore(integrityStatus.subscribe, integrityStatus.get);
