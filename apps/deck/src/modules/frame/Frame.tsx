import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, X } from "lucide-react";

/**
 * Every module in five zones, the same everywhere: a toolbar (what it is, its lenses, its key
 * numbers), the canvas (the object itself: the well, the 3D, the logs — never covered), an
 * inspector (one column of sections, one open at a time), a strip (one timeline or chart along
 * the rails) and a status line (notes and hints, one line). Nothing is positioned over another
 * zone. Details open as a page in place of the canvas and inspector, with the way back in its head.
 * A small tile shows the toolbar and the canvas only: the module at a glance.
 */
export interface FramePage { readonly title: string; readonly context?: string; readonly body: ReactNode; readonly onBack: () => void; readonly backLabel?: string }

export function Frame({ name, title, subtitle, tools, numbers, canvas, inspector, strip, status, page, className }: {
  /** The module id, for the inspector's remembered section. */
  readonly name: string;
  readonly title: ReactNode; readonly subtitle?: ReactNode;
  readonly tools?: ReactNode; readonly numbers?: ReactNode;
  readonly canvas: ReactNode; readonly inspector?: ReactNode; readonly strip?: ReactNode; readonly status?: ReactNode;
  readonly page?: FramePage | null; readonly className?: string;
}) {
  // Esc takes a page back to the canvas before the deck puts an expanded tile back.
  useEffect(() => {
    if (!page) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); page.onBack(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [page]);
  return <div className={`mf${className ? ` ${className}` : ""}`} data-frame={name} data-inspector={inspector && !page ? "" : undefined} data-strip={strip && !page ? "" : undefined} data-page={page ? "" : undefined}>
    <header className="mf-toolbar">
      <span className="mf-title"><b>{title}</b>{subtitle && <small>{subtitle}</small>}</span>
      {tools && <span className="mf-tools">{tools}</span>}
      {numbers && <span className="mf-numbers">{numbers}</span>}
    </header>
    {page ? <section className="mf-page" aria-label={page.title}>
      <header>
        <button type="button" className="mf-back" onClick={page.onBack}><ArrowLeft size={14} aria-hidden="true" />{page.backLabel ?? "Back"}</button>
        <b>{page.title}</b>{page.context && <small>{page.context}</small>}
        <button type="button" className="mf-icon" aria-label="Close" title="Close (Esc)" onClick={page.onBack}><X size={13} /></button>
      </header>
      <div className="mf-page-body">{page.body}</div>
    </section> : <>
      <div className="mf-canvas">{canvas}</div>
      {inspector && <aside className="mf-inspector" aria-label="Inspector">{inspector}</aside>}
      {strip && <div className="mf-strip">{strip}</div>}
    </>}
    {status && <footer className="mf-status">{status}</footer>}
  </div>;
}

/** A section; `same` when its content opens with the same title (a chart card), which is then not repeated. */
export interface Section { readonly id: string; readonly title: string; readonly summary?: ReactNode; readonly body: ReactNode; readonly same?: boolean }

/**
 * The inspector: what is always needed at the top (`head`), then sections that fold, one open at a
 * time, the open one remembered per module and lens; then links to the module's pages. A new
 * feature adds a section here, never another card stacked under the last.
 */
export function Inspector({ id, head, sections, links, initial, reveal }: {
  readonly id: string; readonly head?: ReactNode; readonly sections: readonly (Section | null | false)[];
  readonly links?: readonly ({ readonly label: string; readonly onOpen: () => void } | null | false)[];
  /** The section open the first time. */
  readonly initial?: string;
  /** Open this section now (a Next button, a click on the canvas); `at` changes each time it is asked. */
  readonly reveal?: { readonly section: string; readonly at: number } | null;
}) {
  const shown = sections.filter((s): s is Section => !!s);
  const key = `deck-inspector-${id}`;
  // Remembered per inspector id (a module's lens), so switching lenses opens each one where it was left.
  const [openById, setOpenById] = useState<Readonly<Record<string, string | null>>>({});
  const stored = () => { try { const v = localStorage.getItem(key); return v === null ? undefined : v === "" ? null : v; } catch { return undefined; } };
  const open = id in openById ? openById[id]! : stored() ?? initial ?? shown[0]?.id ?? null;
  const choose = (next: string | null) => { setOpenById((m) => ({ ...m, [id]: next })); try { localStorage.setItem(key, next ?? ""); } catch { /* not kept */ } };
  const current = shown.some((s) => s.id === open) ? open : null;
  // Only a new request opens a section: re-running on every render would undo the reader's own choice.
  useEffect(() => { if (reveal) choose(reveal.section); }, [reveal?.at]);
  return <div className="mf-inspector-body">
    {head && <div className="mf-head">{head}</div>}
    {shown.map((s) => {
      const isOpen = s.id === current;
      return <section key={s.id} className="mf-section" data-open={isOpen || undefined}>
        <button type="button" className="mf-section-head" aria-expanded={isOpen} onClick={() => choose(isOpen ? null : s.id)}>
          {isOpen ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
          <b>{s.title}</b>{s.summary !== undefined && <small>{s.summary}</small>}
        </button>
        {isOpen && <div className={`mf-section-body${s.same ? " is-same" : ""}`}>{s.body}</div>}
      </section>;
    })}
    {links?.some(Boolean) && <nav className="mf-links">{links.filter((l): l is { label: string; onOpen: () => void } => !!l).map((l) => <button key={l.label} type="button" onClick={l.onOpen}>{l.label}<ChevronRight size={13} aria-hidden="true" /></button>)}</nav>}
  </div>;
}

/** The status line's items: short, one line, the first one most important. */
export function Status({ items }: { readonly items: readonly (ReactNode | null | false | undefined)[] }) {
  const shown = items.filter((x) => x !== null && x !== false && x !== undefined && x !== "");
  return <>{shown.map((item, i) => <span key={i} className="mf-status-item">{item}</span>)}</>;
}
