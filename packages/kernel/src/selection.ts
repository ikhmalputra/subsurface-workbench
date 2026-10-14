/**
 * What everyone is looking at.
 *
 * Four things, and only four, ever link one view to another: the component that is selected, the
 * depth the pointer is at, the depth that was picked, and the window on screen. Everything else is
 * presentation. The previous design knew this and still ended up with nine depth cursors and five
 * well selectors, because each view owned its own copy and a host wired them together by hand — and
 * most hosts, reasonably, did not.
 *
 * So this is one small store, framework-free, that views subscribe to themselves. Two views given
 * the same store are linked with no glue; a view given none behaves exactly as it did before,
 * driven by its props. That is the difference between a toolkit of parts and a toolkit of pieces.
 *
 * It holds no data. Logs, surveys, volumes and meshes stay wherever the host put them: a store that
 * accumulated buffers would be copied on every hover.
 */

export interface Selection {
  /** The well in focus, by whatever id the host uses. */
  readonly wellId: string | null;
  /** The component in focus. */
  readonly componentId: string | null;
  /** Where the pointer is, in metres MD. Transient; it changes on every mouse move. */
  readonly hoverMdM: number | null;
  /** The depth someone chose. Durable, and the one worth putting in a URL. */
  readonly pinnedMdM: number | null;
  /** The visible depth range in metres MD, or null for the whole well. */
  readonly window: readonly [number, number] | null;
}

export const emptySelection: Selection = { wellId: null, componentId: null, hoverMdM: null, pinnedMdM: null, window: null };

/** Why something changed, so a view can ignore its own echo rather than fight it. */
export type Origin = string;

export interface Change {
  readonly selection: Selection;
  readonly changed: readonly (keyof Selection)[];
  readonly origin: Origin;
}

export interface SelectionStore {
  get(): Selection;
  subscribe(listener: (change: Change) => void): () => void;
  set(part: Partial<Selection>, origin: Origin): void;
  /** Hover is separate because it fires per pointer move and most views do not want to re-render. */
  hover(mdM: number | null, origin: Origin): void;
}

export function createSelectionStore(initial: Partial<Selection> = {}): SelectionStore {
  let selection: Selection = { ...emptySelection, ...initial };
  const listeners = new Set<(change: Change) => void>();

  const announce = (part: Partial<Selection>, origin: Origin) => {
    const changed = (Object.keys(part) as (keyof Selection)[]).filter((key) => !same(selection[key], part[key]));
    // Nothing changed is not an event. Announcing it is how a hover turns into a render storm.
    if (changed.length === 0) return;
    selection = { ...selection, ...part };
    const change: Change = { selection, changed, origin };
    for (const listener of [...listeners]) listener(change);
  };

  return {
    get: () => selection,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set: (part, origin) => announce(part, origin),
    hover: (mdM, origin) => announce({ hoverMdM: mdM }, origin),
  };
}

const same = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((value, index) => value === b[index]) : a === b;

/** The depth a view should draw its cursor at: what was picked, or what is under the pointer. */
export const cursorMdM = (selection: Selection): number | null => selection.pinnedMdM ?? selection.hoverMdM;
