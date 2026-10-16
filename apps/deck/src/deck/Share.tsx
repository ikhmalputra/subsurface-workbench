import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Link2, X } from "lucide-react";
import { usePlace } from "../data/place.ts";
import { actions, useDeck } from "./store.ts";
import { captureDeck, describeDeck, shareLink } from "./share.ts";

/** Links longer than this reach most people whole; some text fields and older mail clients cut them. */
const LONG_LINK = 8000;

/**
 * Share: the deck as it is at the moment the dialog opens, as one link. Everything rides in the
 * link itself, so nothing is uploaded and the link works without an account; the dialog says
 * what the link holds and what it leaves out.
 */
export function Share() {
  const open = useDeck((deck) => deck.shareOpen);
  if (!open) return null;
  return <ShareDialog />;
}

function ShareDialog() {
  const place = usePlace();
  const shared = useMemo(captureDeck, []);
  const said = useMemo(() => describeDeck(shared, (id) => place?.components.find((entry) => entry.id === id)?.name ?? id), [shared, place]);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"yes" | "select" | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let live = true;
    shareLink(shared).then((url) => { if (live) setLink(url); }, (reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : "The link could not be made."); });
    return () => { live = false; };
  }, [shared]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") actions.openShare(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (copied !== "yes") return; const timer = window.setTimeout(() => setCopied(null), 2400); return () => window.clearTimeout(timer); }, [copied]);
  const copy = () => {
    if (!link) return;
    const select = () => { field.current?.focus(); field.current?.select(); setCopied("select"); };
    if (!navigator.clipboard) return select();
    navigator.clipboard.writeText(link).then(() => setCopied("yes"), select);
  };
  const kb = link ? new Blob([link]).size / 1024 : 0;
  return <div className="cmd-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) actions.openShare(false); }}>
    <section className="nw share" role="dialog" aria-modal="true" aria-labelledby="share-title">
      <header className="nw-head">
        <Link2 size={18} aria-hidden="true" />
        <div><h2 id="share-title">Share this deck</h2><p>Whoever opens the link sees the deck as it is now: the place, the tiles, the depth and the day. The link holds all of it, so nothing is uploaded.</p></div>
        <button type="button" className="nw-close" aria-label="Close" onClick={() => actions.openShare(false)}><X size={16} /></button>
      </header>
      <dl className="share-rows">
        {said.rows.map((row) => <div key={row.label} data-mine={row.label === "Your well" || undefined}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
      </dl>
      <div className="share-left">
        <b>Not in the link</b>
        <ul>{said.left.map((line) => <li key={line}>{line}</li>)}</ul>
      </div>
      {error ? <p className="nw-error" role="alert">{error}</p> : <div className="share-link">
        <input ref={field} id="share-link" readOnly value={link ?? "Making the link…"} aria-label="Link to this deck" onFocus={(event) => event.currentTarget.select()} />
        <button type="button" className="nw-create" disabled={!link} onClick={copy}>{copied === "yes" ? <><Check size={14} aria-hidden="true" />Copied</> : <><Copy size={14} aria-hidden="true" />Copy link</>}</button>
      </div>}
      <p className="nw-hint" aria-live="polite">
        {copied === "select" ? "The link is selected: press ⌘C to copy it." : link ? `${kb.toFixed(1)} KB.${link.length > LONG_LINK ? " A long link, because it carries your well: chat apps and email take it, some short text fields cut it." : ""} Anyone with the link can open it.` : " "}
      </p>
      <footer className="nw-foot">
        {link && <a className="nw-import" href={link} target="_blank" rel="noopener">Open it in a new tab<ExternalLink size={13} aria-hidden="true" /></a>}
        <span className="nw-spacer" />
        <button type="button" className="nw-cancel" onClick={() => actions.openShare(false)}>Done</button>
      </footer>
    </section>
  </div>;
}
