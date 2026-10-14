import type { LucideIcon } from "lucide-react";

/** A tile with nothing true to draw says what it is waiting for, never goes blank. */
export function Empty({ icon: Icon, title, children }: { readonly icon: LucideIcon; readonly title: string; readonly children: string }) {
  return <div className="empty"><Icon size={28} strokeWidth={1.4} aria-hidden="true" /><strong>{title}</strong><p>{children}</p></div>;
}

export function Loading({ children }: { readonly children: string }) {
  return <div className="empty" role="status"><span className="spinner" aria-hidden="true" /><p>{children}</p></div>;
}
