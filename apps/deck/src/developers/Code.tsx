import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

/**
 * A code block with a copy button and light highlighting for TypeScript, TSX, shell and CSS:
 * comments, strings, keywords, numbers, JSX tags and import paths. One pass of one regex; anything
 * it does not recognise stays plain text, so a miss shows up as uncoloured, never as wrong code.
 */
const pattern = (comment: string) => new RegExp(String.raw`(?<comment>${comment})|(?<string>"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\`(?:[^\`\\]|\\.)*\`)|(?<tag><\/?[A-Za-z][\w.]*|\/>)|(?<keyword>\b(?:import|export|from|const|let|function|return|if|else|for|of|in|new|try|catch|throw|type|interface|extends|as|await|async|default|null|true|false|undefined)\b)|(?<number>\b\d[\d_]*(?:\.\d+)?\b)|(?<prop>--[\w-]+)`, "gm");
// Shell comments start with #; in TypeScript and CSS a # is a private name or a colour.
const TOKENS = { ts: pattern(String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`), css: pattern(String.raw`\/\*[\s\S]*?\*\/`), sh: pattern(String.raw`(?<=^|\s)#[^\n]*`) };

function highlight(source: string, language: keyof typeof TOKENS): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, key = 0;
  for (const match of source.matchAll(TOKENS[language])) {
    const kind = Object.entries(match.groups ?? {}).find(([, value]) => value !== undefined)?.[0];
    if (match.index > last) out.push(source.slice(last, match.index));
    out.push(<span key={key++} className={`tk-${kind}`}>{match[0]}</span>);
    last = match.index + match[0].length;
  }
  out.push(source.slice(last));
  return out;
}

export function Code({ source, label, language = "ts" }: { readonly source: string; readonly label?: string; readonly language?: "ts" | "sh" | "css" }) {
  const [copied, setCopied] = useState(false);
  const text = source.trimEnd();
  const copy = () => { void navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }); };
  return <figure className="dv-code" data-language={language}>
    {label && <figcaption><span>{label}</span></figcaption>}
    <button type="button" className="dv-copy" onClick={copy} aria-label={copied ? "Copied" : `Copy ${label ?? "code"}`}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy"}</button>
    <pre><code>{highlight(text, language)}</code></pre>
  </figure>;
}
