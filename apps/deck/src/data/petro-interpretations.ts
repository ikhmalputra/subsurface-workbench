import { useSyncExternalStore } from "react";
import type { Interpretation } from "@ikhmalputra/subsurface-core/petro-clastic";

/**
 * The petrophysicist's interpretation of each FORCE well, as last left in Petrophysics: the clay
 * lines, the shale point, the saturation model with Rw, m and n, and the cutoffs. Kept in this
 * browser; Maps & volumetrics reads a well's net-to-gross, porosity and saturation through it in
 * place of its own quick-look, and says so.
 */
export interface KeptInterpretation { readonly interpretation: Interpretation; readonly zone: string; readonly wellName: string; readonly savedAt: number }
const KEY = "deck-petro-force-v1";
let kept: Readonly<Record<string, KeptInterpretation>> = (() => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown; return v && typeof v === "object" ? v as Record<string, KeptInterpretation> : {}; } catch { return {}; } })();
const listeners = new Set<() => void>();
function changed(next: Readonly<Record<string, KeptInterpretation>>) {
  kept = next;
  try { localStorage.setItem(KEY, JSON.stringify(kept)); } catch { /* not kept */ }
  for (const listener of [...listeners]) listener();
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useInterpretations = () => useSyncExternalStore(subscribe, () => kept, () => kept);
export const keepInterpretation = (wellId: string, entry: KeptInterpretation) => changed({ ...kept, [wellId]: entry });
export const forgetInterpretation = (wellId: string) => { const { [wellId]: _, ...rest } = kept; void _; changed(rest); };
