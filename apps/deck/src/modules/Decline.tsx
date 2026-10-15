import { useMemo, useRef, useState } from "react";
import { scaleLinear, scaleLog } from "d3-scale";
import { Download, FileUp, FolderOpen, Save, X } from "lucide-react";
import { arpsRate } from "@ikhmalputra/subsurface-core";
import type { fitArps } from "@ikhmalputra/subsurface-core";
import { useFetched } from "../data/fetch.ts";
import { analyse, analysesFile, forecastCsv, label, NAME, parseAnalysesFile, resultsOf, sameInputs } from "../data/dca.ts";
import type { DcaInputs, Product, ProductionRecord, SavedAnalysis } from "../data/dca.ts";
import { addAnalyses, deleteAnalysis, saveAnalysis, updateAnalysis, useSavedAnalyses } from "../data/analyses.ts";
import { fmt } from "../format.ts";
import { Loading } from "./Empty.tsx";
import { useSize } from "./useSize.ts";
import { BASE } from "../base.ts";

const parse = (buffer: ArrayBuffer) => JSON.parse(new TextDecoder().decode(buffer)) as ProductionRecord;
const fileName = (name: string, extension: string) => `${name.replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").slice(0, 80) || "decline"}.${extension}`;
function download(text: string, name: string, type: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
const when = (time: number) => new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * Arps decline curves on the Norwegian shelf, field by field, from Sodir's monthly production. Drag
 * across the plot to choose the months to fit; the fitted curve runs on to the economic limit, and
 * the remaining and ultimate volumes follow. The data is Sodir's net saleable production, as
 * published; months the table does not list are gaps, not zeros. An analysis can be saved (kept in
 * this browser), reopened, exported as a forecast CSV or as a file of analyses, and imported again.
 */
export function Decline() {
  const { value: record, error } = useFetched(`${BASE}data/sodir-field-production.json`, parse);
  const [fieldName, setFieldName] = useState("STATFJORD");
  const [product, setProduct] = useState<Product>("oil");
  const [window, setWindow] = useState<readonly [number, number] | null>(null);
  const [limitText, setLimitText] = useState("");
  const [bMax, setBMax] = useState(1);
  const saved = useSavedAnalyses();
  const [openId, setOpenId] = useState<string | null>(null);
  const [panel, setPanel] = useState<"none" | "save" | "list">("none");
  const [nameText, setNameText] = useState(""), [noteText, setNoteText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const inputs: DcaInputs = { field: fieldName, product, window, bMax, limit: Number(limitText) > 0 ? Number(limitText) : null };
  const analysis = useMemo(() => record ? analyse(record, inputs) : null, [record, fieldName, product, window?.[0], window?.[1], bMax, inputs.limit]);
  const [box] = useSize<HTMLDivElement>();
  const open = saved.find((entry) => entry.id === openId) ?? null;

  const restore = (entry: SavedAnalysis) => {
    if (record && !record.fields.some((field) => field.name === entry.inputs.field)) { setMessage(`${entry.name}: ${entry.inputs.field} is not in this production table.`); return; }
    setFieldName(entry.inputs.field); setProduct(entry.inputs.product); setWindow(entry.inputs.window); setBMax(entry.inputs.bMax);
    setLimitText(entry.inputs.limit === null ? "" : String(entry.inputs.limit));
    setOpenId(entry.id); setPanel("none"); setMessage(null);
  };
  const importFile = async (chosen: File | undefined) => {
    if (!chosen) return;
    try { const incoming = parseAnalysesFile(await chosen.text()); addAnalyses(incoming); setMessage(`Imported ${incoming.length} ${incoming.length === 1 ? "analysis" : "analyses"} from ${chosen.name}.`); }
    catch (reason) { setMessage(`${chosen.name}: ${(reason as Error).message}`); }
  };

  const productButtons = (reset: boolean) => <span className="log-sets" role="group" aria-label="Product">
    {(["oil", "gas", "oe"] as const).map((key) => <button key={key} type="button" aria-pressed={product === key} onClick={() => { setProduct(key); if (reset) { setLimitText(""); setWindow(null); } }}>{NAME[key]}</button>)}
  </span>;
  if (record && analysis?.kind === "no-product") return <div className="dca"><p className="curtain-head">{analysis.field.name} reports no {NAME[product].toLowerCase()} in Sodir&apos;s table.</p>{productButtons(false)}</div>;
  if (!record || !analysis || analysis.kind !== "ok") return <Loading>{error ? `The production table could not be read (${error}).` : "Reading Sodir's monthly production…"}</Loading>;
  const { field, series, span, chosen, fit, unit, last, limit, toLimit, producing } = analysis;
  const results = resultsOf(analysis);
  const current: DcaInputs & { window: readonly [number, number] } = { ...inputs, window: chosen };
  const changedSinceSaved = open ? !sameInputs(open.inputs, current) : false;
  const dataChanged = open ? open.source.sha256 !== record.source.sha256 : false;
  const drift = open && results && !changedSinceSaved && Math.abs(open.results.eur - results.eur) > Math.max(1e-6, Math.abs(open.results.eur) * 1e-4);
  const defaultName = `${field.name} ${NAME[product].toLowerCase()} · fit ${label(chosen[0])} to ${label(chosen[1])}`;
  const value = (name: string): Omit<SavedAnalysis, "id" | "savedAt"> | null => results ? {
    name: name.trim() || defaultName, note: noteText.trim(), inputs: current, results,
    source: { publisher: record.source.publisher, retrieved: record.source.retrieved, sha256: record.source.sha256 },
  } : null;
  const startSave = () => { setNameText(open?.name ?? defaultName); setNoteText(open?.note ?? ""); setPanel(panel === "save" ? "none" : "save"); setMessage(null); };
  // A copy saved beside the one it came from gets its own name: "… (2)", "… (3)".
  const unique = (name: string) => { const names = new Set(saved.map((entry) => entry.name)); if (!names.has(name)) return name; let n = 2; while (names.has(`${name} (${n})`)) n++; return `${name} (${n})`; };
  const commitNew = () => { const v = value(nameText); if (!v) return; const entry = saveAnalysis({ ...v, name: unique(v.name) }); setOpenId(entry.id); setPanel("none"); setMessage(`Saved “${entry.name}”.`); };
  const commitUpdate = () => { const v = value(nameText); if (!v || !open) return; updateAnalysis(open.id, v); setPanel("none"); setMessage(`Updated “${v.name}”.`); };
  const csv = (entry: SavedAnalysis | null) => {
    const target = entry ? analyse(record, entry.inputs) : analysis;
    if (target.kind !== "ok") { setMessage(`${entry?.name ?? "This analysis"}: its field or product is not in this production table.`); return; }
    const name = entry?.name ?? (open && !changedSinceSaved ? open.name : defaultName);
    download(forecastCsv(target, record, name), fileName(name, "csv"), "text/csv");
  };

  return <div className="dca" ref={box}>
    <header className="acx-head">
      <label className="dca-field">Field <select value={fieldName} onChange={(event) => { setFieldName(event.target.value); setWindow(null); setLimitText(""); }}>{record.fields.map((entry) => <option key={entry.name} value={entry.name}>{entry.name}</option>)}</select></label>
      {productButtons(true)}
      <label className="dca-field">b ≤ <select value={bMax} onChange={(event) => setBMax(Number(event.target.value))} aria-label="Largest Arps exponent">{[[1, "1 (harmonic)"], [0.5, "0.5"], [0, "0 (exponential)"]].map(([option, text]) => <option key={option} value={option}>{text}</option>)}</select></label>
      <label className="dca-field">Economic limit <input type="number" min={0} step="any" value={limitText} placeholder={limit === null ? "" : fmt(limit / unit.per, unit.per > 1 ? 3 : 0)} onChange={(event) => setLimitText(event.target.value)} aria-label={`Economic limit, ${unit.rate}`} /> {unit.rate}</label>
      <span className="dca-actions">
        <button type="button" className="dsg-tool" onClick={startSave} disabled={!results} aria-expanded={panel === "save"} title={results ? "Keep this analysis: the field, window, b and limit, and what they give" : "Nothing to save: not enough months to fit"}><Save size={14} />Save</button>
        <button type="button" className="dsg-tool" onClick={() => { setPanel(panel === "list" ? "none" : "list"); setMessage(null); }} aria-expanded={panel === "list"}><FolderOpen size={14} />Saved{saved.length ? ` · ${saved.length}` : ""}</button>
        <button type="button" className="dsg-tool" onClick={() => csv(null)} disabled={!results} title="The history and the forecast, month by month, as a spreadsheet"><Download size={14} />CSV</button>
      </span>
    </header>

    {open && <p className={`dca-open${changedSinceSaved ? " is-changed" : ""}`}>
      <b>{open.name}</b>
      <span>saved {when(open.savedAt)}{changedSinceSaved ? " · changed since it was saved" : " · as saved"}</span>
      {open.note && <em>{open.note}</em>}
      {dataChanged && <span className="dca-warn">Saved on Sodir data retrieved {open.source.retrieved}; this is the table retrieved {record.source.retrieved}.</span>}
      {drift && <span className="dca-warn">Saved EUR {fmt(open.results.eur, 2)} {open.results.volumeUnit}; the same choices give {fmt(results!.eur, 2)} now.</span>}
      {changedSinceSaved && <button type="button" className="dsg-tool" onClick={startSave}>Update or save as new…</button>}
      <button type="button" className="dca-close" aria-label="Close the saved analysis (keeps it saved)" title="Close (it stays saved)" onClick={() => setOpenId(null)}><X size={13} /></button>
    </p>}

    {panel === "save" && <form className="dca-panel dca-save" onSubmit={(event) => { event.preventDefault(); if (open) commitUpdate(); else commitNew(); }}>
      <label className="dca-field is-wide">Name <input value={nameText} onChange={(event) => setNameText(event.target.value)} placeholder={defaultName} autoFocus /></label>
      <label className="dca-field is-wide">Note <input value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="optional, e.g. post-2016 decline, excludes the late-life gas blowdown" /></label>
      <p className="dca-summary">{field.name} · {NAME[product]} · fit {label(chosen[0])} to {label(chosen[1])} · b ≤ {bMax} · limit {results ? `${fmt(results.limit, unit.per > 1 ? 3 : 0)} ${unit.rate}${results.limitIsDefault ? " (default)" : ""}` : "—"}{results ? ` · EUR ${fmt(results.eur, 2)} ${unit.volume}` : ""}</p>
      <span className="dsg-confirm">
        {open ? <><button type="submit" className="is-primary">Update “{open.name}”</button><button type="button" onClick={commitNew}>Save as new</button></> : <button type="submit" className="is-primary">Save</button>}
        <button type="button" onClick={() => setPanel("none")}>Cancel</button>
      </span>
    </form>}

    {panel === "list" && <div className="dca-panel dca-list">
      {saved.length === 0 && <p className="dca-empty">No saved analyses yet. Choose a field and a window, then Save. They are kept in this browser; export them to keep them elsewhere.</p>}
      {saved.map((entry) => <article key={entry.id} className={entry.id === openId ? "is-open" : undefined}>
        <div>
          <b>{entry.name}</b>
          <span>{entry.inputs.field} · {NAME[entry.inputs.product]} · fit {label(entry.inputs.window[0])} to {label(entry.inputs.window[1])} · b ≤ {entry.inputs.bMax} · saved {when(entry.savedAt)}</span>
          <span className="dca-numbers">b {fmt(entry.results.b, 2)} · Di {fmt(entry.results.diNominalPct, 1)} %/yr · EUR {fmt(entry.results.eur, 2)} {entry.results.volumeUnit} · remaining {fmt(entry.results.remaining, 2)}{entry.results.yearsToLimit === null ? " · limit beyond 50 years" : ` over ${fmt(entry.results.yearsToLimit, 1)} years`}</span>
          {entry.note && <em>{entry.note}</em>}
        </div>
        <span className="dsg-confirm">
          {confirmDelete === entry.id
            ? <>Delete it?<button type="button" className="is-danger" onClick={() => { deleteAnalysis(entry.id); if (openId === entry.id) setOpenId(null); setConfirmDelete(null); }}>Delete</button><button type="button" onClick={() => setConfirmDelete(null)}>Keep</button></>
            : <><button type="button" className="is-primary" onClick={() => restore(entry)}>Open</button><button type="button" onClick={() => csv(entry)} title="History and forecast as CSV">CSV</button><button type="button" aria-label={`Delete ${entry.name}`} onClick={() => setConfirmDelete(entry.id)}><X size={13} /></button></>}
        </span>
      </article>)}
      <footer>
        <button type="button" className="dsg-tool" disabled={!saved.length} onClick={() => download(analysesFile(saved), "decline-analyses.dca.json", "application/json")}><Download size={14} />Export all</button>
        <button type="button" className="dsg-tool" onClick={() => file.current?.click()}><FileUp size={14} />Import…</button>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={(event) => { void importFile(event.target.files?.[0]); event.target.value = ""; }} />
      </footer>
    </div>}
    {message && <p className="dca-message" role="status">{message}</p>}

    <p className="curtain-head">{field.name} · {label(span[0])} to {label(span[1])} · {producing ? `producing ${NAME[product].toLowerCase()}` : `${NAME[product].toLowerCase()} last reported ${label(last.month)}`} · fit window {label(chosen[0])} to {label(chosen[1])} ({fit?.samples ?? 0} months) · drag across the plot to choose it</p>
    <dl className="petro-summary geo-summary">
      <div><dt>Arps fit</dt><dd>{fit ? `b ${fmt(fit.b, 2)} · ${fit.b === 0 ? "exponential" : fit.b === 1 ? "harmonic" : "hyperbolic"}` : "not enough months"}</dd></div>
      <div><dt>Initial decline (nominal · effective)</dt><dd>{results ? `${fmt(results.diNominalPct, 1)} · ${fmt(results.diEffectivePct, 1)} %/yr` : "—"}</dd></div>
      <div><dt>qi at {label(chosen[0])} · R² (log)</dt><dd>{fit ? `${fmt(fit.qi / unit.per, unit.per > 1 ? 2 : 0)} ${unit.rate} · ${fmt(fit.r2Log, 3)}` : "—"}</dd></div>
      <div><dt>Produced to {label(last.month)}</dt><dd>{fmt(analysis.produced / unit.volumePer, 2)} {unit.volume}</dd></div>
      <div><dt>{producing ? "Remaining to the limit" : `Remaining on the trend (none reported since ${label(last.month)})`}</dt><dd>{fit && toLimit !== null ? `${fmt(analysis.remaining / unit.volumePer, 2)} ${unit.volume} · ${toLimit >= 50 ? "beyond 50 years" : `${fmt(Math.max(0, toLimit - analysis.tLast), 1)} years`}` : "—"}</dd></div>
      <div><dt>EUR · water–oil ratio, last 12 months</dt><dd>{fmt((analysis.produced + analysis.remaining) / unit.volumePer, 2)} {unit.volume} · {analysis.waterOil !== null ? fmt(analysis.waterOil, 2) : "no oil"}</dd></div>
    </dl>
    <Plot series={series} chosen={chosen} fit={fit} limit={limit} toLimit={toLimit} unit={unit} onWindow={setWindow} />
    <p className="petro-note">Source: {record.source.publisher}, table field_production_monthly, retrieved {record.source.retrieved}; {record.licence}. Net saleable volumes by calendar month, turned into rates by the days in each month. Arps (1945) fitted in log rate, b from 0 to {bMax === 0 ? "0 (exponential only)" : bMax}; months with no or zero production are left out of the fit. The forecast continues the fitted curve from the last reported month to the economic limit ({limitText ? "yours" : "5 % of the last reported rate until you set one"}), at most 50 years. Field-level decline mixes wells, workovers and new phases; read it as the field&apos;s trend, not a well&apos;s. Saved analyses stay in this browser.</p>
  </div>;
}

function Plot({ series, chosen, fit, limit, toLimit, unit, onWindow }: {
  readonly series: readonly { readonly month: number; readonly rate: number | null }[]; readonly chosen: readonly [number, number];
  readonly fit: ReturnType<typeof fitArps>; readonly limit: number | null; readonly toLimit: number | null; readonly unit: { readonly rate: string; readonly per: number };
  readonly onWindow: (window: readonly [number, number]) => void;
}) {
  const [box, size] = useSize<HTMLDivElement>();
  const width = Math.max(200, size.width), height = Math.max(160, size.height);
  const m = { left: 64, right: 16, top: 16, bottom: 32 };
  const end = Math.max(series.at(-1)!.month + 12, toLimit !== null ? chosen[0] + Math.ceil(toLimit * 12) : 0);
  const x = scaleLinear().domain([series[0]!.month, Math.min(end, series.at(-1)!.month + 12 * 25)]).range([m.left, width - m.right]);
  const positive = series.map((entry) => entry.rate).filter((rate): rate is number => rate !== null && rate > 0);
  const top = Math.max(...positive) * 1.5, bottom = Math.max(Math.min(...positive, limit ?? Infinity) / 2, top / 1e5);
  const y = scaleLog().domain([bottom, top]).range([height - m.bottom, m.top]).clamp(true);
  const drag = useRef<number | null>(null);
  const [draft, setDraft] = useState<readonly [number, number] | null>(null);
  const monthAt = (clientX: number, element: Element) => Math.round(x.invert(clientX - element.getBoundingClientRect().left));
  const curve: string[] = [];
  if (fit) {
    const stop = toLimit !== null ? chosen[0] + toLimit * 12 : x.domain()[1]!;
    for (let month = chosen[0]; month <= Math.min(stop, x.domain()[1]!); month += 1) curve.push(`${curve.length ? "L" : "M"}${x(month).toFixed(1)},${y(arpsRate(fit, (month - chosen[0]) / 12 + 1 / 24)).toFixed(1)}`);
  }
  const shown = draft ?? chosen;
  const years = x.ticks(8);
  return <div className="acx-plot dca-plot">
    <div ref={box} className="plot-area"><svg width={width} height={height} role="img" aria-label={`Monthly rate on a log scale with the fitted Arps curve; drag across to choose the months to fit`}
      onPointerDown={(event) => { drag.current = monthAt(event.clientX, event.currentTarget); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => { if (drag.current !== null) { const now = monthAt(event.clientX, event.currentTarget); setDraft([Math.min(drag.current, now), Math.max(drag.current, now)]); } }}
      onPointerUp={(event) => { const from = drag.current; drag.current = null; setDraft(null); if (from === null) return; const now = monthAt(event.clientX, event.currentTarget); if (Math.abs(now - from) >= 6) onWindow([Math.max(series[0]!.month, Math.min(from, now)), Math.min(series.at(-1)!.month, Math.max(from, now))]); }}>
      <rect className="dca-window" x={x(shown[0])} width={Math.max(1, x(shown[1]) - x(shown[0]))} y={m.top} height={height - m.top - m.bottom} />
      {years.map((tick) => <g key={tick} className="acx-grid"><line x1={x(tick)} x2={x(tick)} y1={m.top} y2={height - m.bottom} /><text x={x(tick)} y={height - m.bottom + 14} textAnchor="middle">{Math.floor(tick / 12)}</text></g>)}
      {y.ticks(5).filter((tick) => Math.log10(tick) % 1 === 0).map((tick) => <g key={tick} className="acx-grid"><line x1={m.left} x2={width - m.right} y1={y(tick)} y2={y(tick)} /><text x={m.left - 6} y={y(tick) + 3} textAnchor="end">{fmt(tick / unit.per, unit.per > 1 ? 3 : 0)}</text></g>)}
      {series.map((entry) => entry.rate !== null && entry.rate > 0 ? <circle key={entry.month} cx={x(entry.month)} cy={y(entry.rate)} r={1.8} className={entry.month >= chosen[0] && entry.month <= chosen[1] ? "dca-point is-in" : "dca-point"} /> : null)}
      {curve.length > 1 && <path d={curve.join("")} className="dca-fit" />}
      {limit !== null && <g><line className="dca-limit" x1={m.left} x2={width - m.right} y1={y(limit)} y2={y(limit)} /><text className="acx-axis" x={width - m.right - 4} y={y(limit) - 4} textAnchor="end">economic limit</text></g>}
      <line className="acx-cursor" x1={x(series.at(-1)!.month)} x2={x(series.at(-1)!.month)} y1={m.top} y2={height - m.bottom} />
      <text className="acx-axis" x={12} y={m.top + 4} transform={`rotate(-90 12 ${m.top + 4})`} textAnchor="end">{unit.rate} (log)</text>
    </svg></div>
  </div>;
}
