import { useEffect, useState } from "react";

/** Form fields for the designer and the editor: each commits one named step on Enter or when it loses focus; Escape puts the value back. */

export function NumberField({ label, value, unit, onCommit, min, max, step = "any", optional = false, hint, wide = false }: {
  readonly label: string; readonly value: number | null; readonly unit?: string; readonly onCommit: (value: number | null) => void;
  readonly min?: number; readonly max?: number; readonly step?: number | "any"; readonly optional?: boolean; readonly hint?: string; readonly wide?: boolean;
}) {
  const shown = value === null ? "" : String(Math.round(value * 1000) / 1000);
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setText(shown); setError(null); }, [shown]);
  const commit = () => {
    if (text === shown) return;
    if (text.trim() === "") { if (optional) { onCommit(null); return; } setError("Required"); return; }
    const number = Number(text);
    if (!Number.isFinite(number)) { setError("Not a number"); return; }
    if (min !== undefined && number < min) { setError(`At least ${min}`); return; }
    if (max !== undefined && number > max) { setError(`At most ${max}`); return; }
    setError(null);
    onCommit(number);
  };
  return <label className={`dsg-field${wide ? " is-wide" : ""}${error ? " is-error" : ""}`}>
    <span>{label}</span>
    <span className="dsg-input"><input inputMode="decimal" value={text} step={step} onChange={(event) => setText(event.target.value)} onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } if (event.key === "Escape") { setText(shown); setError(null); } }} placeholder={optional ? "not set" : ""} />{unit && <i>{unit}</i>}</span>
    {error ? <small className="dsg-error">{error}</small> : hint ? <small>{hint}</small> : null}
  </label>;
}

export function TextField({ label, value, onCommit, placeholder, wide = false }: { readonly label: string; readonly value: string; readonly onCommit: (value: string) => void; readonly placeholder?: string; readonly wide?: boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => { if (text !== value) onCommit(text); };
  return <label className={`dsg-field${wide ? " is-wide" : ""}`}><span>{label}</span>
    <span className="dsg-input"><input value={text} placeholder={placeholder} onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } }} /></span>
  </label>;
}

export function SelectField<T extends string | number>({ label, value, options, onCommit, wide = false }: { readonly label: string; readonly value: T; readonly options: readonly { readonly value: T; readonly label: string }[]; readonly onCommit: (value: T) => void; readonly wide?: boolean }) {
  return <label className={`dsg-field${wide ? " is-wide" : ""}`}><span>{label}</span>
    <span className="dsg-input"><select value={String(value)} onChange={(event) => { const found = options.find((option) => String(option.value) === event.target.value); if (found && found.value !== value) onCommit(found.value); }}>
      {options.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
    </select></span>
  </label>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { readonly value: T; readonly options: readonly { readonly value: T; readonly label: string }[]; readonly onChange: (value: T) => void; readonly label: string }) {
  return <div className="dsg-seg" role="radiogroup" aria-label={label}>
    {options.map((option) => <button key={option.value} type="button" role="radio" aria-checked={value === option.value} onClick={() => { if (option.value !== value) onChange(option.value); }}>{option.label}</button>)}
  </div>;
}


/** A number in a table cell: no label, the same commit rules. */
export function CellNumber({ value, onCommit, label, min, max, digits = 2 }: { readonly value: number; readonly onCommit: (value: number) => void; readonly label: string; readonly min?: number; readonly max?: number; readonly digits?: number }) {
  const shown = String(Math.round(value * 10 ** digits) / 10 ** digits);
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(shown); setBad(false); }, [shown]);
  const commit = () => {
    if (text === shown) return;
    const number = Number(text);
    if (text.trim() === "" || !Number.isFinite(number) || (min !== undefined && number < min) || (max !== undefined && number > max)) { setBad(true); return; }
    setBad(false);
    onCommit(number);
  };
  return <input className={`cell-input${bad ? " is-error" : ""}`} aria-label={label} inputMode="decimal" value={text} onChange={(event) => setText(event.target.value)} onBlur={commit}
    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } if (event.key === "Escape") { setText(shown); setBad(false); } }} />;
}
