"use client";

import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CommandButton } from "@ikhmalputra/subsurface-react/ui";

/**
 * Panels over — and beside — one full-bleed sheet.
 *
 * The workbench is the drawing. Everything else — the inspector, the well file, the navigation,
 * the tools — is a panel the reader opens from the tray at the foot of the window and either
 * leaves floating, dragged wherever it is useful, or docks to a side of the window the way a
 * CAD or compositing tool docks its palettes. A docked panel takes real space: the sheet gives
 * up that edge, so nothing on the drawing is ever under a docked panel. Panels docked to the
 * same side are one palette group — a row of tabs, one body — the way Photoshop and AutoCAD
 * group palettes: the newest to arrive is in front, a tab brings another forward, and every
 * panel in the group stays mounted so its state survives the switch.
 *
 * A closed panel is its title tab in the tray; an open one is a window. Positions and docks are
 * kept for the session so a panel reopens where it was left.
 *
 * The frame owns two host nodes — the floating layer and the tray — and the dock registry, and
 * hands them down. Panels portal into whichever host their state calls for, which keeps every
 * window in one stacking context and lets a panel declared deep inside a route sit above
 * everything on the page.
 */
export type DockSide = "left" | "right" | "top" | "bottom";
export type Dock = DockSide | "float" | "fill";
export const DOCK_LABELS: Readonly<Record<Dock, string>> = { float: "Floating", fill: "Fill the sheet", left: "Dock left", right: "Dock right", top: "Dock top", bottom: "Dock bottom" };
/** Width of a side column and height of a top or bottom band, when docked. */
export const DOCK_SIZE: Readonly<Record<DockSide, number>> = { left: 320, right: 320, top: 280, bottom: 300 };
/** Height of the status bar, the one strip of chrome under the sheet. */
export const STATUS_PX = 28;

export interface DockEntry { readonly dock: Dock; readonly size: number; readonly title: string }
export interface DockRegistry {
  /** Open panels by id, with the side each is docked to (`float` for none), its thickness and its title. Insertion order is arrival order. */
  readonly docks: ReadonlyMap<string, DockEntry>;
  /** The panel in front of each side's group: the newest to arrive there, or the tab last chosen. */
  readonly active: Readonly<Partial<Record<DockSide, string>>>;
  readonly register: (id: string, dock: Dock | null, size?: number, title?: string) => void;
  /** Bring one panel of a side's group to the front. */
  readonly activate: (side: DockSide, id: string) => void;
  /** Docking needs room beside the sheet; on a phone every panel floats and the choice is kept for later. */
  readonly enabled: boolean;
}
interface FloatHost {
  readonly layer: HTMLElement | null;
  readonly tray: HTMLElement | null;
  /** The inspector column. A panel docked right renders inside it, in flow, instead of over the sheet. */
  readonly column: HTMLElement | null;
  /** The shelf under the sheet. A register docked bottom renders inside it, at window width. */
  readonly shelf: HTMLElement | null;
  readonly registry: DockRegistry;
}
const noRegistry: DockRegistry = { docks: new Map(), active: {}, register: () => undefined, activate: () => undefined, enabled: true };
const FloatContext = createContext<FloatHost>({ layer: null, tray: null, column: null, shelf: null, registry: noRegistry });
export const FloatProvider = FloatContext.Provider;
/**
 * The registry the frame created and handed down.
 *
 * `useDockRegistry` *builds* a registry — calling it a second time makes a second, empty one, which
 * is how the inspector column came to believe nothing was ever docked. Anything that wants to read
 * what is open reads it from here.
 */
export function useDocks(): DockRegistry { return useContext(FloatContext).registry; }

const isSide = (dock: Dock | null | undefined): dock is DockSide => dock === "left" || dock === "right" || dock === "top" || dock === "bottom";

interface DockState { readonly docks: ReadonlyMap<string, DockEntry>; readonly active: Readonly<Partial<Record<DockSide, string>>> }

/** The frame's dock registry: which open panels are docked where, and the insets they cost the sheet. */
export function useDockRegistry(): DockRegistry & { readonly insets: Readonly<Record<DockSide, number>> } {
  const [{ docks, active }, setState] = useState<DockState>(() => ({ docks: new Map(), active: {} }));
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 760px)");
    const update = () => setEnabled(!narrow.matches);
    update();
    narrow.addEventListener("change", update);
    return () => narrow.removeEventListener("change", update);
  }, []);
  const register = (id: string, dock: Dock | null, size?: number, title = id) => setState((current) => {
    const entry = current.docks.get(id);
    const thickness = size ?? (isSide(dock) ? DOCK_SIZE[dock] : 0);
    if (dock === null && !entry) return current;
    if (entry && entry.dock === dock && entry.size === thickness) {
      if (entry.title === title) return current;
      // A retitled panel keeps its place in the group; only arrivals go to the front.
      return { ...current, docks: new Map(current.docks).set(id, { ...entry, title }) };
    }
    const docks = new Map(current.docks);
    docks.delete(id); // re-inserted last: the newest arrival on its side
    if (dock !== null) docks.set(id, { dock, size: thickness, title });
    const next: Partial<Record<DockSide, string>> = { ...current.active };
    const before = entry?.dock;
    // Leaving a side's group from the front hands the group to the neighbour: the tab after it, else the one before.
    if (isSide(before) && before !== dock && next[before] === id) {
      const order = Array.from(current.docks.entries()).filter(([, item]) => item.dock === before).map(([key]) => key);
      const at = order.indexOf(id);
      const neighbour = order[at + 1] ?? order[at - 1];
      if (neighbour) next[before] = neighbour; else delete next[before];
    }
    if (isSide(dock)) next[dock] = id;
    return { docks, active: next };
  });
  const activate = (side: DockSide, id: string) => setState((current) => current.active[side] === id || current.docks.get(id)?.dock !== side ? current : { ...current, active: { ...current.active, [side]: id } });
  const insets: Record<DockSide, number> = { left: 0, right: 0, top: 0, bottom: 0 };
  if (enabled) for (const { dock, size } of docks.values()) if (isSide(dock)) insets[dock] = Math.max(insets[dock], size);
  return { docks, active, register, activate, insets, enabled };
}

const positions = new Map<string, { left: number; top: number }>();
const docksRemembered = new Map<string, Dock>();
let stackOrder = 10;
const EDGE_PX = 24;

type Point = { readonly x: number; readonly y: number };

/**
 * Drag a panel by its head. `onEdge` docks it when it is let go against a window edge; `onDetach`
 * is called once a drag has actually begun, so a docked panel dragged by its tab tears off into
 * a window under the pointer — the head keeps the pointer capture across the re-render, so the
 * same gesture carries on moving the window it just made.
 */
function useDrag(id: string, panel: () => HTMLElement | null, onEdge?: (side: DockSide) => void, onDetach?: () => void) {
  const [position, setPosition] = useState(() => positions.get(id) ?? null);
  const [stack, setStack] = useState(() => ++stackOrder);
  const start = useRef<{ pointer: Point; origin: Point; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const place = (left: number, top: number) => {
    const element = panel();
    const width = element?.offsetWidth ?? 200, height = element?.offsetHeight ?? 40;
    const next = {
      left: Math.max(0, Math.min(window.innerWidth - Math.min(width, 120), left)),
      top: Math.max(0, Math.min(window.innerHeight - STATUS_PX - Math.min(height, 40), top)),
    };
    positions.set(id, next);
    setPosition(next);
  };
  const raise = () => setStack(++stackOrder);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    // React bubbles pointer events through portals, so a panel opened from this toolbar delivers
    // its clicks here too; capturing the pointer for those would swallow them. Only the element's
    // own DOM subtree drags it, and never from a control.
    if (!event.currentTarget.contains(event.target as Node)) return;
    raise();
    // A group's tab is the one control that also drags: it is how a palette is torn off.
    const control = (event.target as HTMLElement).closest("button, a, input, select, textarea, summary, label");
    if (event.button !== 0 || (control && !control.matches('[data-drag="tab"]'))) return;
    const element = panel();
    if (!element) return;
    const rect = element.getBoundingClientRect();
    start.current = { pointer: { x: event.clientX, y: event.clientY }, origin: { x: rect.left, y: rect.top }, moved: false };
    // Capturing retargets the pointer-up to the head, and with it the click, which a tab needs to
    // keep: a tab is captured only once a drag has begun.
    if (!control) event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = start.current;
    if (!drag) return;
    const dx = event.clientX - drag.pointer.x, dy = event.clientY - drag.pointer.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
      onDetach?.();
    }
    drag.moved = true;
    place(drag.origin.x + dx, drag.origin.y + dy);
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const drag = start.current;
    start.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag?.moved) return;
    suppressClick.current = true;
    // Released against a window edge: dock there, the way a window manager snaps.
    if (onEdge) {
      const side: DockSide | null = event.clientX <= EDGE_PX ? "left" : event.clientX >= window.innerWidth - EDGE_PX ? "right" : event.clientY <= EDGE_PX ? "top" : event.clientY >= window.innerHeight - STATUS_PX - EDGE_PX ? "bottom" : null;
      if (side) onEdge(side);
    }
  };
  // A drag must not also count as the click that toggles the panel.
  const onClick = (event: { preventDefault: () => void }) => { if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); } };
  // The keyboard moves a panel too: arrows nudge it, Shift makes the nudge a stride.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 64 : 16;
    const delta: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
    const move = delta[event.key];
    if (!move) return;
    event.preventDefault();
    const rect = panel()?.getBoundingClientRect();
    if (rect) place(rect.left + move.x, rect.top + move.y);
  };
  return { position, stack, handlers: { onPointerDown, onPointerMove, onPointerUp, onClick, onKeyDown }, raise };
}

/** The rectangle of a docked panel: the whole of the side it is docked to, between the other docks. */
function dockedStyle(dock: DockSide | "fill", insets: Readonly<Record<DockSide, number>>): CSSProperties {
  const height = `calc(100dvh - ${STATUS_PX}px)`;
  // Fill: the sheet's own rectangle between the docks — a tab over the drawing, in effect.
  if (dock === "fill") return { left: insets.left, top: insets.top, width: `calc(100vw - ${insets.left}px - ${insets.right}px)`, height: `calc(${height} - ${insets.top}px - ${insets.bottom}px)` };
  // A side column or band is as thick as the thickest panel grouped there, so a tab switch never reflows the sheet.
  if (dock === "left" || dock === "right") return { [dock]: 0, top: 0, width: insets[dock], height };
  return { left: insets.left, width: `calc(100vw - ${insets.left}px - ${insets.right}px)`, height: insets[dock], ...(dock === "top" ? { top: 0 } : { bottom: STATUS_PX }) };
}

/** The palette group a side-docked panel belongs to: every panel on that side, in arrival order, and which is in front. */
export interface DockGroup { readonly side: DockSide; readonly tabs: readonly { readonly id: string; readonly title: string }[]; readonly active: boolean }

function useDock(id: string, title: string, open: boolean, defaultDock: Dock, dockSize?: number) {
  const { registry } = useContext(FloatContext);
  const [dock, setDockState] = useState<Dock>(() => docksRemembered.get(id) ?? defaultDock);
  const setDock = (next: Dock) => { docksRemembered.set(id, next); setDockState(next); };
  useEffect(() => { registry.register(id, open ? dock : null, dockSize, title); return () => registry.register(id, null); }, [id, open, dock, dockSize, title]); // the registry's register is stable per frame
  const insets: Record<DockSide, number> = { left: 0, right: 0, top: 0, bottom: 0 };
  for (const entry of registry.docks.values()) if (isSide(entry.dock)) insets[entry.dock] = Math.max(insets[entry.dock], entry.size);
  // Until the registry has heard of this panel, the column is at least its own thickness.
  if (isSide(dock)) insets[dock] = Math.max(insets[dock], dockSize ?? DOCK_SIZE[dock]);
  // A phone disables the side docks, not the fill: the document still fills the sheet there.
  const docked = dock !== "float" && (registry.enabled || dock === "fill");
  const style = docked ? dockedStyle(dock, insets) : null;
  let group: DockGroup | null = null;
  if (docked && isSide(dock)) {
    const tabs = Array.from(registry.docks.entries()).filter(([, entry]) => entry.dock === dock).map(([key, entry]) => ({ id: key, title: entry.title }));
    if (!tabs.some((tab) => tab.id === id)) tabs.push({ id, title });
    // A panel the registry has not placed yet is in front if nothing else is: it is the newest arrival.
    const active = registry.active[dock] ?? id;
    group = { side: dock, tabs, active: active === id || !tabs.some((tab) => tab.id === active) };
  }
  return { dock, setDock, style, group, activate: (panel: string) => { if (isSide(dock)) registry.activate(dock, panel); } };
}

const tabId = (id: string) => `float-tab-${id}`;
const bodyId = (id: string) => `float-body-${id}`;

/**
 * The tabs of a palette group, on the head of the panel in front. A click brings a panel forward;
 * the arrow keys walk the row, Home and End jump to its ends. The head that holds the tabs belongs
 * to the panel in front, so choosing another panel moves the row to that panel's head — focus
 * follows to the same tab in its new place.
 */
function GroupTabs({ id, group, onChoose }: { readonly id: string; readonly group: DockGroup; readonly onChoose: (panel: string) => void }) {
  const choose = (panel: string) => {
    onChoose(panel);
    requestAnimationFrame(() => document.getElementById(tabId(panel))?.focus());
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const ids = group.tabs.map((tab) => tab.id);
    const at = ids.indexOf(id);
    const target = event.key === "ArrowRight" || event.key === "ArrowDown" ? ids[(at + 1) % ids.length]
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? ids[(at - 1 + ids.length) % ids.length]
      : event.key === "Home" ? ids[0] : event.key === "End" ? ids[ids.length - 1] : undefined;
    if (!target || target === id) return;
    event.preventDefault();
    choose(target);
  };
  return <div className="demo-float-tabs" role="tablist" aria-label={`Panels docked ${group.side}`} onKeyDown={onKeyDown}>
    {group.tabs.map((tab) => <CommandButton key={tab.id} id={tabId(tab.id)} kind="selection" role="tab" className="demo-float-tab" data-drag="tab"
      aria-selected={tab.id === id} aria-controls={bodyId(tab.id)} tabIndex={tab.id === id ? 0 : -1} onClick={() => { if (tab.id !== id) choose(tab.id); }}>{tab.title}</CommandButton>)}
  </div>;
}

function DockControl({ title, dock, onChange }: { readonly title: string; readonly dock: Dock; readonly onChange: (dock: Dock) => void }) {
  return <select className="demo-float-dock" aria-label={`Dock ${title}`} value={dock} onChange={(event) => onChange(event.currentTarget.value as Dock)}>
    {(Object.keys(DOCK_LABELS) as Dock[]).map((value) => <option key={value} value={value}>{DOCK_LABELS[value]}</option>)}
  </select>;
}

export interface FloatingPanelProps {
  readonly id: string;
  readonly title: string;
  /** A second line on the title bar — a count, a provenance, a hint. Hidden on the tray tab. */
  readonly detail?: ReactNode;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Where the panel opens, floating, before it has been dragged: any fixed-position offsets, plus a width. */
  readonly defaultStyle: CSSProperties;
  /** Where the panel docks until the reader changes it; `float` opens it as a window. */
  readonly defaultDock?: Dock;
  readonly className?: string;
  readonly children: ReactNode;
  /** Without a tray tab the panel is opened by a control elsewhere and carries its own close button. */
  readonly tray?: boolean;
  /** The body scrolls itself and is keyboard-reachable; otherwise the content manages its own scrolling. */
  readonly scrollable?: boolean;
  /** Thickness when docked to a side — a column's width, a band's height — instead of the default. */
  readonly dockSize?: number;
  /** No title bar: the panel is the ground others sit on, and another document puts it away. */
  readonly headless?: boolean;
  /** Controls the host puts on the title bar, after the title — the ribbon carries the workspace bar. */
  readonly headExtra?: ReactNode;
}

/** A panel: a tab in the tray when closed; a window over the sheet, or a dock beside it, when open. */
export function FloatingPanel({ id, title, detail, open, onOpenChange, defaultStyle, defaultDock = "float", className, children, tray = true, scrollable = false, dockSize, headless = false, headExtra }: FloatingPanelProps) {
  const host = useContext(FloatContext);
  const ref = useRef<HTMLElement>(null);
  // The workstation owns the regions: a panel cannot choose a window edge. A register goes to the
  // shelf under the sheet, everything else to the inspector column, and a document fills the sheet
  // rather than the viewport. This used to send all four sides to the column, which is how a
  // full-width register came to be drawn in 304px.
  const workstation = Boolean(host.column) || Boolean(host.shelf);
  const opening: Dock = !isSide(defaultDock) ? defaultDock
    : defaultDock === "bottom" && host.shelf ? "bottom"
    : host.column ? "right"
    : defaultDock;
  const { dock, setDock, style: docked, group, activate } = useDock(id, title, open, opening, dockSize);
  // Dragged by its tab, a grouped panel tears off into a window; the drag then carries the window.
  const { position, stack, handlers, raise } = useDrag(id, () => ref.current, setDock, () => { if (group) setDock("float"); });
  // A panel comes to the front when it opens, not where its mount order left it: the navigation
  // is mounted with the frame, before any route's panels, and would otherwise open underneath them.
  useEffect(() => { if (open) raise(); }, [open]); // `raise` is recreated per render; depending on it would re-raise forever
  // Stacking: a document filling the sheet is the ground everything else sits on; docked panels
  // sit above it; windows and toolbars (whose stack starts above 10) sit above those.
  const filling = workstation && dock === "fill";
  const style: CSSProperties = open
    ? filling
      ? { position: "absolute", inset: 0, zIndex: 1 }
      : { ...(docked ?? (position ? { left: position.left, top: position.top } : defaultStyle)), zIndex: docked ? (dock === "fill" ? 5 : 10) : stack }
    : {};
  const classes = `demo-float${open ? " is-open" : ""}${docked ? ` is-docked is-docked-${dock}` : ""}${className ? ` ${className}` : ""}`;
  // In a group only the front panel shows; the others keep their body mounted, hidden, so a tool's
  // state — a form half filled, a portal target — survives the switch.
  const inFront = !group || group.active;
  const body = <div id={bodyId(id)} className={`demo-float-body${scrollable ? " is-scrollable" : ""}`} tabIndex={scrollable ? 0 : undefined} role={group ? "tabpanel" : undefined} aria-labelledby={group ? tabId(id) : undefined}>{children}</div>;
  // Closed: a tab in the tray, a `details` whose summary opens it. Open: a window — the same for
  // every panel, whether it came from the tray or from a control — with a grip, the dock control
  // and a close button in a title bar that is not itself a control, so nothing nests inside one.
  if (!open) {
    if (!tray || !host.tray) return null;
    return createPortal(<details ref={ref as never} className={classes} data-float={id} open={false}
      onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) onOpenChange(true); }}>
      <summary className="demo-float-head"><span className="demo-float-title">{title}</span></summary>
      {/* The summary is the whole tab; the body stays empty in the tray. */}
    </details>, host.tray);
  }
  // The workstation gives the inspector its own grid column, so a panel docked right is not a
  // window positioned over the sheet at all: it renders in flow inside that column, and the
  // column carries the tab strip for the group. Nothing it does can cover the drawing.
  const inShelf = dock === "bottom" && host.shelf !== null;
  const inColumn = !inShelf && workstation && isSide(dock);
  const region = inShelf ? host.shelf : inColumn ? host.column : null;
  if (!host.layer && !region) return null;
  const { onKeyDown, ...pointer } = handlers;
  const controls = <>
    {headExtra}
    <DockControl title={title} dock={dock} onChange={setDock} />
    <CommandButton icon="close" className="demo-float-close" aria-label={`Dismiss ${title.toLowerCase()} panel`} onClick={() => onOpenChange(false)} />
  </>;
  if (region) return createPortal(<section ref={ref as never} className={`${classes} is-column${inShelf ? " is-shelf" : ""}`} data-float={id} data-dock={dock} data-in-front={group ? String(inFront) : undefined} hidden={!inFront || undefined} aria-label={`${title} panel`}>
    {!headless && <div className="demo-float-head swx-panel-head">
      <h2 className="demo-float-title">{title}</h2>{detail && <span className="demo-float-sub">{detail}</span>}
      <CommandButton icon="close" className="demo-float-close" aria-label={`Dismiss ${title.toLowerCase()} panel`} onClick={() => onOpenChange(false)} />
    </div>}
    {body}
  </section>, region);
  if (!host.layer) return null;
  return createPortal(<section ref={ref as never} className={`${classes}${headless ? " is-headless" : ""}`} data-float={id} data-dock={dock} data-moved={position ? "true" : undefined} data-in-front={group ? String(inFront) : undefined} hidden={!inFront || undefined} style={style} aria-label={`${title} panel`}>
    {!headless && inFront && (group
      // A palette group: the head is a tab per panel on this side, carried by the panel in front.
      // The heading stays an h2 for the reader and the heading order; the tab is what is seen.
      ? <div className="demo-float-head is-group" {...pointer}>
        <h2 className="demo-float-title sw-sr-only">{title}</h2>
        <GroupTabs id={id} group={group} onChoose={activate} />
        {detail && <span className="demo-float-sub">{detail}</span>}
        {controls}
      </div>
      : <div className="demo-float-head" {...(docked ? {} : pointer)}>
        {!docked && <span className="demo-float-grip" tabIndex={0} role="button" aria-label={`Move the ${title.toLowerCase()} panel`} onKeyDown={onKeyDown} />}
        <h2 className="demo-float-title">{title}</h2>{detail && <span className="demo-float-sub">{detail}</span>}
        {controls}
      </div>)}
    {body}
  </section>, host.layer);
}
