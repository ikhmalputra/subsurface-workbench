import { useMemo, useRef, useState } from "react";
import { scaleLinear, scaleLog } from "d3-scale";
import { arpsCumulative, arpsRate, arpsTimeToRate, daysInMonth, effectiveDecline, fitArps } from "@ikhmalputra/subsurface-core";
import { useFetched } from "../data/fetch.ts";
import { fmt } from "../format.ts";
import { Loading } from "./Empty.tsx";
import { useSize } from "./useSize.ts";
import { BASE } from "../base.ts";

interface Field { readonly name: string; readonly npdid: number; readonly month: readonly number[]; readonly oil: readonly (number | null)[]; readonly gas: readonly (number | null)[]; readonly oe: readonly (number | null)[]; readonly water: readonly (number | null)[] }
interface Record { readonly source: { readonly url: string; readonly sha256: string; readonly retrieved: string; readonly publisher: string }; readonly licence: string; readonly fields: readonly Field[] }
type Product = "oil" | "gas" | "oe";

const parse = (buffer: ArrayBuffer) => JSON.parse(new TextDecoder().decode(buffer)) as Record;
/** Volumes are million Sm³ a month (gas: billion); rates are Sm³ a day. */
const SCALE: Readonly<globalThis.Record<Product, number>> = { oil: 1e6, gas: 1e9, oe: 1e6 };
const UNIT: Readonly<globalThis.Record<Product, { rate: string; per: number; volume: string; volumePer: number }>> = {
  oil: { rate: "Sm³/d", per: 1, volume: "MSm³", volumePer: 1e6 },
  gas: { rate: "MSm³/d", per: 1e6, volume: "GSm³", volumePer: 1e9 },
  oe: { rate: "Sm³ o.e./d", per: 1, volume: "MSm³ o.e.", volumePer: 1e6 },
};
const NAME: Readonly<globalThis.Record<Product, string>> = { oil: "Oil", gas: "Gas", oe: "Oil equivalent" };
const yearOf = (month: number) => month / 12;
const label = (month: number) => `${Math.floor(month / 12)}-${String(month % 12 + 1).padStart(2, "0")}`;

/**
 * Arps decline curves on the Norwegian shelf, field by field, from Sodir's monthly production. Drag
 * across the plot to choose the months to fit; the fitted curve runs on to the economic limit, and
 * the remaining and ultimate volumes follow. The data is Sodir's net saleable production, as
 * published; months the table does not list are gaps, not zeros.
 */
export function Decline() {
  const { value: record, error } = useFetched(`${BASE}data/sodir-field-production.json`, parse);
  const [fieldName, setFieldName] = useState("STATFJORD");
  const [product, setProduct] = useState<Product>("oil");
  const [window, setWindow] = useState<readonly [number, number] | null>(null);
  const [limitText, setLimitText] = useState("");
  const [bMax, setBMax] = useState(1);
  const field = record?.fields.find((entry) => entry.name === fieldName) ?? null;
  const series = useMemo(() => !field ? null : field.month.map((month, i) => {
    const volume = field[product][i] ?? null;
    return { month, volume, rate: volume === null ? null : volume * SCALE[product] / daysInMonth(month), water: field.water[i] ?? null, oil: field.oil[i] ?? null };
  }), [field, product]);
  const span = series && series.length ? [series[0]!.month, series.at(-1)!.month] as const : null;
  // By default, the last ten years in which the field produced this product.
  const producedMonths = series?.filter((entry) => entry.rate !== null && entry.rate > 0).map((entry) => entry.month) ?? [];
  const chosen = window ?? (producedMonths.length ? [Math.max(producedMonths[0]!, producedMonths.at(-1)! - 119), producedMonths.at(-1)!] as const : span);
  const result = useMemo(() => {
    if (!series || !chosen) return null;
    const inside = series.filter((entry) => entry.month >= chosen[0] && entry.month <= chosen[1]);
    const fit = fitArps(inside.map((entry) => yearOf(entry.month - chosen[0]) + 1 / 24), inside.map((entry) => entry.rate), { bMax });
    return { inside, fit };
  }, [series, chosen?.[0], chosen?.[1], bMax]);
  const [box] = useSize<HTMLDivElement>();
  if (record && field && series && !producedMonths.length) return <div className="dca"><p className="curtain-head">{field.name} reports no {NAME[product].toLowerCase()} in Sodir&apos;s table.</p><span className="log-sets" role="group" aria-label="Product">{(["oil", "gas", "oe"] as const).map((key) => <button key={key} type="button" aria-pressed={product === key} onClick={() => setProduct(key)}>{NAME[key]}</button>)}</span></div>;
  if (!record || !field || !series || !span || !chosen) return <Loading>{error ? `The production table could not be read (${error}).` : "Reading Sodir's monthly production…"}</Loading>;
  const unit = UNIT[product];
  // The forecast runs on from the last month this product was produced, not the field's last month.
  const lastMonth = producedMonths.at(-1)!;
  const last = series.find((entry) => entry.month === lastMonth)!;
  const lastRate = [...series].reverse().find((entry) => entry.rate !== null && entry.rate > 0)?.rate ?? null;
  const limit = Number(limitText) > 0 ? Number(limitText) * unit.per : lastRate !== null ? lastRate * 0.05 : null;
  const fit = result?.fit ?? null;
  const tLast = yearOf(last.month - chosen[0]) + 1 / 24;
  const toLimit = fit && limit !== null ? Math.min(50, arpsTimeToRate(fit, limit)) : null;
  const produced = series.reduce((sum, entry) => sum + (entry.volume ?? 0), 0) * SCALE[product];
  const remaining = fit && toLimit !== null && toLimit > tLast ? arpsCumulative(fit, toLimit) - arpsCumulative(fit, tLast) : 0;
  const producing = last.month >= Math.max(...record.fields.map((entry) => entry.month.at(-1) ?? 0)) - 2;
  const fieldLast = series.at(-1)!;
  const lastYear = series.filter((entry) => entry.month > fieldLast.month - 12);
  const water = lastYear.reduce((sum, entry) => sum + (entry.water ?? 0), 0), oil = lastYear.reduce((sum, entry) => sum + (entry.oil ?? 0), 0);
  return <div className="dca" ref={box}>
    <header className="acx-head">
      <label className="dca-field">Field <select value={fieldName} onChange={(event) => { setFieldName(event.target.value); setWindow(null); setLimitText(""); }}>{record.fields.map((entry) => <option key={entry.name} value={entry.name}>{entry.name}</option>)}</select></label>
      <span className="log-sets" role="group" aria-label="Product">
        {(["oil", "gas", "oe"] as const).map((key) => <button key={key} type="button" aria-pressed={product === key} onClick={() => { setProduct(key); setLimitText(""); setWindow(null); }}>{NAME[key]}</button>)}
      </span>
      <label className="dca-field">b ≤ <select value={bMax} onChange={(event) => setBMax(Number(event.target.value))} aria-label="Largest Arps exponent">{[[1, "1 (harmonic)"], [0.5, "0.5"], [0, "0 (exponential)"]].map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
      <label className="dca-field">Economic limit <input type="number" min={0} step="any" value={limitText} placeholder={limit === null ? "" : fmt(limit / unit.per, unit.per > 1 ? 3 : 0)} onChange={(event) => setLimitText(event.target.value)} aria-label={`Economic limit, ${unit.rate}`} /> {unit.rate}</label>
    </header>
    <p className="curtain-head">{field.name} · {label(span[0])} to {label(span[1])} · {producing ? `producing ${NAME[product].toLowerCase()}` : `${NAME[product].toLowerCase()} last reported ${label(last.month)}`} · fit window {label(chosen[0])} to {label(chosen[1])} ({result?.fit?.samples ?? 0} months) · drag across the plot to choose it</p>
    <dl className="petro-summary geo-summary">
      <div><dt>Arps fit</dt><dd>{fit ? `b ${fmt(fit.b, 2)} · ${fit.b === 0 ? "exponential" : fit.b === 1 ? "harmonic" : "hyperbolic"}` : "not enough months"}</dd></div>
      <div><dt>Initial decline (nominal · effective)</dt><dd>{fit ? `${fmt(fit.di * 100, 1)} · ${fmt(effectiveDecline(fit) * 100, 1)} %/yr` : "—"}</dd></div>
      <div><dt>qi at {label(chosen[0])} · R² (log)</dt><dd>{fit ? `${fmt(fit.qi / unit.per, unit.per > 1 ? 2 : 0)} ${unit.rate} · ${fmt(fit.r2Log, 3)}` : "—"}</dd></div>
      <div><dt>Produced to {label(last.month)}</dt><dd>{fmt(produced / unit.volumePer, 2)} {unit.volume}</dd></div>
      <div><dt>{producing ? "Remaining to the limit" : `Remaining on the trend (none reported since ${label(last.month)})`}</dt><dd>{fit && toLimit !== null ? `${fmt(remaining / unit.volumePer, 2)} ${unit.volume} · ${toLimit >= 50 ? "beyond 50 years" : `${fmt(Math.max(0, toLimit - tLast), 1)} years`}` : "—"}</dd></div>
      <div><dt>EUR · water–oil ratio, last 12 months</dt><dd>{fmt((produced + remaining) / unit.volumePer, 2)} {unit.volume} · {oil > 0 ? fmt(water / oil, 2) : "no oil"}</dd></div>
    </dl>
    <Plot series={series} chosen={chosen} fit={fit} limit={limit} toLimit={toLimit} unit={unit} onWindow={setWindow} />
    <p className="petro-note">Source: {record.source.publisher}, table field_production_monthly, retrieved {record.source.retrieved}; {record.licence}. Net saleable volumes by calendar month, turned into rates by the days in each month. Arps (1945) fitted in log rate, b from 0 to {bMax === 0 ? "0 (exponential only)" : bMax}; months with no or zero production are left out of the fit. The forecast continues the fitted curve from the last reported month to the economic limit ({limitText ? "yours" : "5 % of the last reported rate until you set one"}), at most 50 years. Field-level decline mixes wells, workovers and new phases; read it as the field&apos;s trend, not a well&apos;s.</p>
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
