import type { ButtonHTMLAttributes } from "react";
import { Children, isValidElement } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Crosshair, Database, Download, Eraser, Eye, EyeOff, FilePlus2, Focus, History, Info, Layers, Link2, Lock, LockOpen, Maximize2, Menu, Minus, Pencil, Play, Plus, Printer, Redo2, RotateCcw, Ruler, Save, Search, Settings2, Square, Trash2, Undo2, X, ZoomIn, ZoomOut } from "lucide-react";

/** Kept byte-compatible with the SDK's command vocabulary so the shared control audit still applies. */
const commandIcons = {
  add: Plus, remove: Trash2, clear: Eraser, reset: RotateCcw, apply: Check,
  previous: ArrowLeft, next: ArrowRight, up: ArrowUp, down: ArrowDown,
  fit: Maximize2, focus: Focus, locate: Crosshair, inspect: Search,
  view: Eye, hide: EyeOff, layers: Layers, link: Link2, settings: Settings2, menu: Menu,
  edit: Pencil, create: FilePlus2, save: Save, download: Download,
  print: Printer, play: Play, stop: Square, close: X, minus: Minus,
  zoomIn: ZoomIn, zoomOut: ZoomOut,
  lock: Lock, unlock: LockOpen, undo: Undo2, redo: Redo2,
  info: Info, source: Database, measure: Ruler, history: History,
} as const;

export type CommandIconName = keyof typeof commandIcons;

export function CommandIcon({ name }: { readonly name: CommandIconName }) {
  const Icon = commandIcons[name];
  return <Icon size={16} strokeWidth={1.75} aria-hidden="true" focusable="false" className="sw-command-icon" />;
}

export interface CommandButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly icon?: CommandIconName;
  /** Record selectors and tabs keep their own layout; commands share a standard control surface. */
  readonly kind?: "command" | "selection";
}

/**
 * The one control primitive. Emits `data-ui-kind`, which the cross-route control audit keys on, so the
 * shell satisfies the same accessible-name / height / radius / icon-size contract as the existing SDK.
 */
export function CommandButton({ icon, kind = "command", type = "button", children, ...props }: CommandButtonProps) {
  const content = Children.toArray(children).filter((child) => typeof child !== "string" || child.trim());
  const iconOnly = icon ? content.length === 0 : content.length === 1 && isValidElement(content[0]) && typeof content[0].type !== "string";
  return <button {...props} type={type} title={props.title ?? props["aria-label"]} data-ui-kind={kind} data-icon-only={iconOnly || undefined}>
    {icon && <CommandIcon name={icon} />}{children}
  </button>;
}
