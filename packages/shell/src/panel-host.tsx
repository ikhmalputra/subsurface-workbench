"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CommandButton } from "./ui.js";

export type PanelSide = "left" | "right";

export interface PanelSpec {
  readonly id: string;
  readonly title: string;
  readonly side?: PanelSide;
  /** Lower sorts first; ties fall back to title. */
  readonly order?: number;
}

interface Registered {
  readonly id: string;
  readonly title: string;
  readonly side: PanelSide;
  readonly order: number;
}

export interface PanelRegistry {
  readonly panels: readonly Registered[];
  readonly slots: Readonly<Record<string, HTMLElement | null>>;
  readonly register: (spec: Registered) => void;
  readonly unregister: (id: string) => void;
  readonly bindSlot: (id: string, element: HTMLElement | null) => void;
  readonly activeFor: (side: PanelSide) => string | null;
  readonly activate: (side: PanelSide, id: string) => void;
  readonly reveal: (id: string) => void;
}

const PanelContext = createContext<PanelRegistry | null>(null);

export function usePanelRegistry(): PanelRegistry {
  const registry = useContext(PanelContext);
  if (!registry) throw new Error("Panel components must be rendered inside <Workbench>.");
  return registry;
}

function sorted(panels: readonly Registered[], side: PanelSide) {
  return panels.filter((panel) => panel.side === side).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

/**
 * The shell owns the slots; views contribute panels. Every registered slot stays mounted and is hidden
 * rather than unmounted, so panel state and any canvas inside it survive tab and tool changes.
 */
export function usePanelHost(): PanelRegistry {
  const [panels, setPanels] = useState<readonly Registered[]>([]);
  const [slots, setSlots] = useState<Readonly<Record<string, HTMLElement | null>>>({});
  const [chosen, setChosen] = useState<Readonly<Record<PanelSide, string | null>>>({ left: null, right: null });

  // Each setter returns the previous value unchanged when nothing differs, so registration from an
  // effect and slot binding from a ref callback cannot drive a render loop.
  const register = useCallback((spec: Registered) => {
    setPanels((current) => {
      const index = current.findIndex((panel) => panel.id === spec.id);
      if (index === -1) return [...current, spec];
      const existing = current[index]!;
      if (existing.title === spec.title && existing.side === spec.side && existing.order === spec.order) return current;
      const next = current.slice();
      next[index] = spec;
      return next;
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setPanels((current) => (current.some((panel) => panel.id === id) ? current.filter((panel) => panel.id !== id) : current));
    setSlots((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const bindSlot = useCallback((id: string, element: HTMLElement | null) => {
    setSlots((current) => (current[id] === element ? current : { ...current, [id]: element }));
  }, []);

  const activate = useCallback((side: PanelSide, id: string) => {
    setChosen((current) => (current[side] === id ? current : { ...current, [side]: id }));
  }, []);

  return useMemo<PanelRegistry>(() => {
    const activeFor = (side: PanelSide) => {
      const list = sorted(panels, side);
      const pick = chosen[side];
      return pick && list.some((panel) => panel.id === pick) ? pick : (list[0]?.id ?? null);
    };
    return {
      panels, slots, register, unregister, bindSlot, activate, activeFor,
      // Canvas interactions call this to pull their panel forward, so picking a component can surface
      // the inspector without the view knowing where the dock lives.
      reveal: (id: string) => {
        const panel = panels.find((entry) => entry.id === id);
        if (panel) activate(panel.side, id);
      },
    };
  }, [panels, slots, register, unregister, bindSlot, activate, chosen]);
}

export function PanelHostProvider({ registry, children }: { readonly registry: PanelRegistry; readonly children: ReactNode }) {
  return <PanelContext.Provider value={registry}>{children}</PanelContext.Provider>;
}

/** Declare a panel anywhere inside the workbench; its content is teleported into the dock. */
export function Panel({ id, title, side = "right", order = 0, children }: PanelSpec & { readonly children: ReactNode }) {
  const { register, unregister, slots } = usePanelRegistry();
  useEffect(() => {
    register({ id, title, side, order });
    return () => unregister(id);
  }, [register, unregister, id, title, side, order]);
  const slot = slots[id] ?? null;
  return slot ? createPortal(children, slot) : null;
}

/**
 * The slot element is bound through a callback that is stable for the life of the panel. An inline
 * arrow function here would be a different identity on every render, so React 19 would detach it
 * (ref(null)) and reattach it (ref(element)) each time — and because binding sets state, that is an
 * infinite update loop rather than a cosmetic inefficiency.
 */
function PanelSlot({ id, hidden, bindSlot }: {
  readonly id: string;
  readonly hidden: boolean;
  readonly bindSlot: (id: string, element: HTMLElement | null) => void;
}) {
  const bind = useCallback((element: HTMLElement | null) => bindSlot(id, element), [bindSlot, id]);
  return <section id={`swb-panel-${id}`} className="swb-panel" role="tabpanel"
    aria-labelledby={`swb-tab-${id}`} data-panel-id={id} hidden={hidden} ref={bind} />;
}

export function PanelDock({ side }: { readonly side: PanelSide }) {
  const registry = usePanelRegistry();
  const list = sorted(registry.panels, side);
  const active = registry.activeFor(side);
  if (!list.length) return null;
  return <aside className="swb-dock" data-side={side} aria-label={`${side === "left" ? "Left" : "Right"} panels`} data-testid={`workbench-dock-${side}`}>
    <div className="swb-dock-tabs" role="tablist" aria-label={`${side === "left" ? "Left" : "Right"} panels`}>
      {list.map((panel) => <CommandButton key={panel.id} kind="selection" role="tab" id={`swb-tab-${panel.id}`}
        aria-selected={panel.id === active} aria-controls={`swb-panel-${panel.id}`}
        onClick={() => registry.activate(side, panel.id)}>{panel.title}</CommandButton>)}
    </div>
    <div className="swb-dock-body">
      {list.map((panel) => <PanelSlot key={panel.id} id={panel.id} hidden={panel.id !== active} bindSlot={registry.bindSlot} />)}
    </div>
  </aside>;
}
