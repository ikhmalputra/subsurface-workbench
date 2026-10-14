import { useEffect, useRef, useState } from "react";

/** The pixel size of an element, kept current: for views that draw at a given height rather than filling. */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => { const box = entry!.contentRect; setSize({ width: Math.round(box.width), height: Math.round(box.height) }); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}
