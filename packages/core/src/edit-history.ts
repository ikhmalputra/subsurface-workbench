/**
 * What-if edits with apply, discard, undo and redo, over any immutable value.
 *
 * A what-if is a proposal: every view can show it live while it is being dragged, but nothing is
 * committed until it is applied. Applying records one labelled step; undo and redo move through
 * those steps. A proposal made while another is pending replaces it (dragging a slider is one
 * proposal that keeps changing), so one drag is one undo step, never a hundred.
 *
 * The history stores values, not diffs: every value is immutable, so a step is two references.
 */

export interface EditStep<T> {
  readonly label: string;
  readonly before: T;
  readonly after: T;
  /** UTC Unix epoch milliseconds when the step was applied. */
  readonly appliedAt: number;
}

export interface EditState<T> {
  /** The value as committed. */
  readonly committed: T;
  /** A what-if not yet applied, with what it is called; null when there is none. */
  readonly pending: { readonly label: string; readonly value: T } | null;
  readonly undo: readonly EditStep<T>[];
  readonly redo: readonly EditStep<T>[];
}

export interface EditHistory<T> {
  readonly getState: () => EditState<T>;
  /** What every view should show: the pending what-if if there is one, else the committed value. */
  readonly current: () => T;
  readonly subscribe: (listener: (state: EditState<T>) => void) => () => void;
  /** Starts or replaces the what-if. Proposing the committed value itself clears it. */
  readonly propose: (label: string, value: T) => void;
  /** Commits the what-if as one undoable step. Returns false when nothing was pending. */
  readonly apply: () => boolean;
  readonly discard: () => void;
  readonly undo: () => boolean;
  readonly redo: () => boolean;
  /** Replaces the whole history, e.g. when the document changes. */
  readonly reset: (value: T) => void;
}

export interface EditHistoryOptions<T> {
  /** At most this many undo steps are kept; older ones are dropped. Default 100. */
  readonly limit?: number;
  /** Whether two values are the same, so a no-op proposal or apply records nothing. Default `Object.is`. */
  readonly equals?: (a: T, b: T) => boolean;
  /** Clock for `appliedAt`; injectable for tests. */
  readonly now?: () => number;
}

export function createEditHistory<T>(initial: T, options: EditHistoryOptions<T> = {}): EditHistory<T> {
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Edit history limit must be a positive integer.");
  const equals = options.equals ?? Object.is;
  const now = options.now ?? Date.now;
  let state: EditState<T> = Object.freeze({ committed: initial, pending: null, undo: Object.freeze([]), redo: Object.freeze([]) });
  const listeners = new Set<(state: EditState<T>) => void>();
  const set = (next: EditState<T>) => {
    state = Object.freeze(next);
    for (const listener of [...listeners]) listener(state);
  };
  return {
    getState: () => state,
    current: () => state.pending?.value ?? state.committed,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    propose(label, value) {
      if (!label.trim()) throw new TypeError("A what-if needs a label.");
      if (equals(value, state.committed)) { if (state.pending) set({ ...state, pending: null }); return; }
      set({ ...state, pending: Object.freeze({ label, value }) });
    },
    apply() {
      const pending = state.pending;
      if (!pending) return false;
      const step: EditStep<T> = Object.freeze({ label: pending.label, before: state.committed, after: pending.value, appliedAt: now() });
      set({ committed: pending.value, pending: null, undo: Object.freeze([...state.undo, step].slice(-limit)), redo: Object.freeze([]) });
      return true;
    },
    discard() { if (state.pending) set({ ...state, pending: null }); },
    undo() {
      const step = state.undo.at(-1);
      if (!step) return false;
      set({ committed: step.before, pending: null, undo: Object.freeze(state.undo.slice(0, -1)), redo: Object.freeze([...state.redo, step]) });
      return true;
    },
    redo() {
      const step = state.redo.at(-1);
      if (!step) return false;
      set({ committed: step.after, pending: null, undo: Object.freeze([...state.undo, step]), redo: Object.freeze(state.redo.slice(0, -1)) });
      return true;
    },
    reset(value) { set({ committed: value, pending: null, undo: Object.freeze([]), redo: Object.freeze([]) }); },
  };
}
