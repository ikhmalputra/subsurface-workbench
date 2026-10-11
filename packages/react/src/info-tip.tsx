"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export interface InfoTipProps {
  /** Tooltip body. Kept in the DOM (hidden) so it stays the accessible description of the trigger. */
  readonly children: ReactNode;
  /** Accessible name of the trigger button. */
  readonly label?: string;
  /** Wider popover for lists. */
  readonly wide?: boolean;
  readonly className?: string;
}

const GAP = 8;
const EDGE = 8;

/** Small ⓘ trigger (a span, so it can sit inside a field label) that shows explanatory text on hover or focus; click pins it, Escape or an outside click closes it. */
export function InfoTip({ children, label = "More information", wide, className }: InfoTipProps) {
  const id = useId();
  const trigger = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [place, setPlace] = useState<{ left: number; top: number; arrow: number; above: boolean } | null>(null);
  const open = hover || focus || pinned;

  const measure = useCallback(() => {
    const anchor = trigger.current?.getBoundingClientRect();
    const box = pop.current;
    if (!anchor || !box) return;
    const width = box.offsetWidth;
    const height = box.offsetHeight;
    const center = anchor.left + anchor.width / 2;
    const left = Math.max(EDGE, Math.min(window.innerWidth - width - EDGE, center - 18));
    const above = anchor.bottom + GAP + height > window.innerHeight - EDGE && anchor.top - GAP - height > EDGE;
    setPlace({ left, top: above ? anchor.top - GAP - height : anchor.bottom + GAP, arrow: Math.max(10, Math.min(width - 10, center - left)), above });
  }, []);

  useLayoutEffect(() => {
    if (open) measure();
    else setPlace(null);
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPinned(false);
      setHover(false);
      trigger.current?.blur();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !pop.current?.contains(target)) setPinned(false);
    };
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, measure]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const enter = () => {
    clearTimeout(closeTimer.current);
    setHover(true);
  };
  const leave = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setHover(false), 140);
  };

  return <span className={`sw-tip${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}>
    <span
      ref={trigger}
      role="button"
      tabIndex={0}
      className="sw-tip-button"
      aria-label={label}
      aria-describedby={id}
      aria-expanded={pinned}
      onPointerEnter={enter}
      onPointerLeave={leave}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setPinned((value) => !value);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        setPinned((value) => !value);
      }}
    >i</span>
    <span
      ref={pop}
      id={id}
      role="tooltip"
      className={`sw-tip-pop${wide ? " is-wide" : ""}${place?.above ? " is-above" : ""}`}
      data-open={open && place ? "true" : undefined}
      style={place ? { left: place.left, top: place.top, ["--sw-tip-arrow" as string]: `${place.arrow}px` } : undefined}
      onPointerEnter={enter}
      onPointerLeave={leave}
    >{children}</span>
  </span>;
}
