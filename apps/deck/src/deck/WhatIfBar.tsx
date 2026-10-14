import { useEffect } from "react";
import { Check, Redo2, Undo2, X } from "lucide-react";
import { analyse, designHistory, useDesignState } from "../data/design.ts";
import { pulse, useDeck } from "./store.ts";

/**
 * The design's edit state in one place: the pending what-if with what it does to the strings, and
 * apply or discard; undo and redo of applied steps, each named. ⌘↵ applies, Esc discards, ⌘Z and
 * ⇧⌘Z step through the history. While a what-if is pending the deck says so, and every failing
 * string pulses magenta wherever it is drawn.
 */
export function WhatIfBar() {
  const siteId = useDeck((deck) => deck.siteId);
  const commandOpen = useDeck((deck) => deck.commandOpen);
  const state = useDesignState();
  const active = siteId === "kestrel";
  const pending = active ? state.pending : null;
  useEffect(() => {
    if (pending) document.documentElement.dataset.whatif = "";
    else delete document.documentElement.dataset.whatif;
  }, [pending]);
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (commandOpen || (event.target as HTMLElement | null)?.closest("input[type='number'], input[type='text'], textarea")) return;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey ? designHistory.redo() : designHistory.undo()) pulse("whatif", "bar"); }
      else if (meta && event.key === "Enter") { event.preventDefault(); if (designHistory.apply()) pulse("whatif", "bar"); }
      else if (event.key === "Escape" && designHistory.getState().pending) { event.preventDefault(); designHistory.discard(); pulse("whatif", "bar"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, commandOpen]);
  if (!active || (!pending && !state.undo.length && !state.redo.length)) return null;
  const failing = pending ? analyse(pending.value.brief).failing.length : 0;
  const before = analyse(state.committed.brief).failing.length;
  const lastUndo = state.undo.at(-1), lastRedo = state.redo.at(-1);
  return <div className={`whatif${pending ? " is-pending" : ""}`} role="region" aria-label="Design edits">
    <button type="button" className="whatif-step" disabled={!lastUndo} title={lastUndo ? `Undo: ${lastUndo.label} (⌘Z)` : "Nothing to undo"} aria-label={lastUndo ? `Undo ${lastUndo.label}` : "Nothing to undo"} onClick={() => { if (designHistory.undo()) pulse("whatif", "bar"); }}><Undo2 size={14} /></button>
    <button type="button" className="whatif-step" disabled={!lastRedo} title={lastRedo ? `Redo: ${lastRedo.label} (⇧⌘Z)` : "Nothing to redo"} aria-label={lastRedo ? `Redo ${lastRedo.label}` : "Nothing to redo"} onClick={() => { if (designHistory.redo()) pulse("whatif", "bar"); }}><Redo2 size={14} /></button>
    {pending ? <>
      <span className="whatif-label"><i />What-if <b>{pending.label}</b></span>
      <span className={`whatif-effect${failing > before ? " is-worse" : failing < before ? " is-better" : ""}`}>{failing ? `${failing} string${failing === 1 ? "" : "s"} fail` : "every string passes"}{failing !== before ? ` · was ${before}` : ""}</span>
      <button type="button" className="whatif-discard" onClick={() => { designHistory.discard(); pulse("whatif", "bar"); }}><X size={13} />Discard<kbd>Esc</kbd></button>
      <button type="button" className="whatif-apply" onClick={() => { designHistory.apply(); pulse("whatif", "bar"); }}><Check size={13} />Apply<kbd>⌘↵</kbd></button>
    </> : <span className="whatif-label is-quiet">{lastUndo ? <>Last applied: <b>{lastUndo.label}</b></> : <>Redo: <b>{lastRedo!.label}</b></>}</span>}
  </div>;
}
