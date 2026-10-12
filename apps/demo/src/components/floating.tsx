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
 * same side share it, which is how two panels sit side by side and four sit on four sides.
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
export type Dock = DockSide | "float";
export const DOCK_LABELS: Readonly<Record<Dock, string>> = { float: "Floating", left: "Dock left", right: "Dock right", top: "Dock top", bottom: "Dock bottom" };
/** Width of a side column and height of a top or bottom band, when docked. */
export const DOCK_SIZE: Readonly<Record<DockSide, number>> = { left: 320, right: 320, top: 280, bottom: 300 };
/** Height of the status bar, the one strip of chrome under the sheet. */
export const STATUS_PX = 28;

export interface DockRegistry {
  /** Open panels by id, with the side each is docked to (`float` for none). */
  readonly docks: ReadonlyMap<string, Dock>;
  readonly register: (id: string, dock: Dock | null) => void;
  /** Docking needs room beside the sheet; on a phone every panel floats and the choice is kept for later. */
  readonly enabled: boolean;
}
interface FloatHost {
  readonly layer: HTMLElement | null;
  readonly tray: HTMLElement | null;
  readonly registry: DockRegistry;
}
const noRegistry: DockRegistry = { docks: new Map(), register: () => undefined, enabled: true };
const FloatContext = createContext<FloatHost>({ layer: null, tray: null, registry: noRegistry });
export const FloatProvider = FloatContext.Provider;

/** The frame's dock registry: which open panels are docked where, and the insets they cost the sheet. */
export function useDockRegistry(): DockRegistry & { readonly insets: Readonly<Record<DockSide, number>> } {
  const [docks, setDocks] = useState<ReadonlyMap<string, Dock>>(() => new Map());
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 760px)");
    const update = () => setEnabled(!narrow.matches);
    update();
    narrow.addEventListener("change", update);
    return () => narrow.removeEventListener("change", update);
  }, []);
  const register = (id: string, dock: Dock | null) => setDocks((current) => {
    if ((dock === null && !current.has(id)) || current.get(id) === dock) return current;
    const next = new Map(current);
    if (dock === null) next.delete(id); else next.set(id, dock);
    return next;
  });
  const insets: Record<DockSide, number> = { left: 0, right: 0, top: 0, bottom: 0 };
  if (enabled) for (const dock of docks.values()) if (dock !== "float") insets[dock] = DOCK_SIZE[dock];
  return { docks, register, insets, enabled };
}

const positions = new Map<string, { left: number; top: number }>();
const docksRemembered = new Map<string, Dock>();
let stackOrder = 10;
const EDGE_PX = 24;

type Point = { readonly x: number; readonly y: number };

function useDrag(id: string, panel: () => HTMLElement | null, onEdge?: (side: DockSide) => void) {
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
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, a, input, select, textarea, summary, label")) return;
    const element = panel();
    if (!element) return;
    const rect = element.getBoundingClientRect();
    start.current = { pointer: { x: event.clientX, y: event.clientY }, origin: { x: rect.left, y: rect.top }, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = start.current;
    if (!drag) return;
    const dx = event.clientX - drag.pointer.x, dy = event.clientY - drag.pointer.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
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

/** The rectangle of a docked panel: its share of the side it is docked to, between the other docks. */
function dockedStyle(dock: DockSide, index: number, count: number, insets: Readonly<Record<DockSide, number>>): CSSProperties {
  const height = `calc(100dvh - ${STATUS_PX}px)`;
  if (dock === "left" || dock === "right") {
    const share = `calc(${height} / ${count})`;
    return { [dock]: 0, top: `calc(${share} * ${index})`, width: DOCK_SIZE[dock], height: share };
  }
  const width = `calc(100vw - ${insets.left}px - ${insets.right}px)`;
  const share = `calc(${width} / ${count})`;
  return { left: `calc(${insets.left}px + ${share} * ${index})`, width: share, height: DOCK_SIZE[dock], ...(dock === "top" ? { top: 0 } : { bottom: STATUS_PX }) };
}

function useDock(id: string, open: boolean, defaultDock: Dock) {
  const { registry } = useContext(FloatContext);
  const [dock, setDockState] = useState<Dock>(() => docksRemembered.get(id) ?? defaultDock);
  const setDock = (next: Dock) => { docksRemembered.set(id, next); setDockState(next); };
  useEffect(() => { registry.register(id, open ? dock : null); return () => registry.register(id, null); }, [id, open, dock]);
  const siblings = Array.from(registry.docks.entries()).filter(([, side]) => side === dock && dock !== "float").map(([key]) => key);
  const insets: Record<DockSide, number> = { left: 0, right: 0, top: 0, bottom: 0 };
  for (const side of registry.docks.values()) if (side !== "float") insets[side] = DOCK_SIZE[side];
  const style = dock === "float" || !registry.enabled ? null : dockedStyle(dock, Math.max(0, siblings.indexOf(id)), Math.max(1, siblings.length), insets);
  return { dock, setDock, style };
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
}

/** A panel: a tab in the tray when closed; a window over the sheet, or a dock beside it, when open. */
export function FloatingPanel({ id, title, detail, open, onOpenChange, defaultStyle, defaultDock = "float", className, children, tray = true, scrollable = false }: FloatingPanelProps) {
  const host = useContext(FloatContext);
  const ref = useRef<HTMLElement>(null);
  const { dock, setDock, style: docked } = useDock(id, open, defaultDock);
  const { position, stack, handlers, raise } = useDrag(id, () => ref.current, setDock);
  // A panel comes to the front when it opens, not where its mount order left it: the navigation
  // is mounted with the frame, before any route's panels, and would otherwise open underneath them.
  useEffect(() => { if (open) raise(); }, [open]); // `raise` is recreated per render; depending on it would re-raise forever
  const style: CSSProperties = open ? { ...(docked ?? (position ? { left: position.left, top: position.top } : defaultStyle)), zIndex: docked ? 20 : stack } : {};
  const classes = `demo-float${open ? " is-open" : ""}${docked ? ` is-docked is-docked-${dock}` : ""}${className ? ` ${className}` : ""}`;
  const body = <div className={`demo-float-body${scrollable ? " is-scrollable" : ""}`} tabIndex={scrollable ? 0 : undefined}>{children}</div>;
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
  if (!host.layer) return null;
  const { onKeyDown, ...pointer } = handlers;
  return createPortal(<section ref={ref as never} className={classes} data-float={id} data-dock={dock} data-moved={position ? "true" : undefined} style={style} aria-label={`${title} panel`}>
    <div className="demo-float-head" {...(docked ? {} : pointer)}>
      {!docked && <span className="demo-float-grip" tabIndex={0} role="button" aria-label={`Move the ${title.toLowerCase()} panel`} onKeyDown={onKeyDown} />}
      <span className="demo-float-title">{title}</span>{detail && <span className="demo-float-sub">{detail}</span>}
      <DockControl title={title} dock={dock} onChange={setDock} />
      <CommandButton icon="close" className="demo-float-close" aria-label={`Dismiss ${title.toLowerCase()} panel`} onClick={() => onOpenChange(false)} />
    </div>
    {body}
  </section>, host.layer);
}

/** A strip of controls that floats over the sheet, dragged by its grip. Always open, never docked. */
export function FloatingToolbar({ id, label, defaultStyle, className, children }: { readonly id: string; readonly label: string; readonly defaultStyle: CSSProperties; readonly className?: string; readonly children: ReactNode }) {
  const host = useContext(FloatContext);
  const ref = useRef<HTMLDivElement>(null);
  const { position, stack, handlers } = useDrag(id, () => ref.current);
  if (!host.layer) return null;
  const style: CSSProperties = { ...(position ? { left: position.left, top: position.top, right: "auto", bottom: "auto" } : defaultStyle), zIndex: stack };
  return createPortal(<div ref={ref} className={`demo-float demo-float-toolbar${className ? ` ${className}` : ""}`} data-float={id} data-moved={position ? "true" : undefined} style={style} onPointerDown={handlers.onPointerDown} onPointerMove={handlers.onPointerMove} onPointerUp={handlers.onPointerUp}>
    <span className="demo-float-grip" tabIndex={0} aria-label={`Move the ${label}`} role="button" onKeyDown={handlers.onKeyDown} />
    {children}
  </div>, host.layer);
}
