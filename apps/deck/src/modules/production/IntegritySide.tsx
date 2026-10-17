import { useRef } from "react";
import { FileUp, Pause, Play, RotateCcw, Wand2 } from "lucide-react";
import { scaleLinear } from "d3-scale";
import type { BleedTest, calibrateConductivity } from "@ikhmalputra/subsurface-core/integrity";
import { ASSUMED_CONDUCTIVITY, PACKER_RATING_PSI, measuredAt } from "../../data/integrity-model.ts";
import type { annulusPressures, bseeLimits } from "../../data/integrity-model.ts";
import { loadOwn } from "../../data/standard-files.ts";
import type { AnnulusRecord, TemperatureSurvey } from "../../data/synthetic.ts";
import { fmt } from "../../format.ts";
import { useSize } from "../useSize.ts";

/**
 * The integrity lens's panel: the start-up clock (the deck's time on production), the rock's heat
 * conduction calibrated to a temperature survey, the annulus record with its bleed-downs judged
 * for sustained casing pressure, and a gauge per annulus with its pressure against its MAASP, the
 * limit that sets it and BSEE's MAWOP.
 */
type Row = ReturnType<typeof annulusPressures>[number];
type Loaded<T> = { readonly value: T | null; readonly error: string | null; readonly own: boolean };
const LIMIT: Readonly<Record<string, string>> = { burst: "outer string's burst", collapse: "inner string's collapse", formation: "formation at the shoe", packer: "packer rating" };
const COLOUR: Readonly<Record<string, string>> = { A: "#34d399", B: "#a78bfa", C: "#f472b6" };
export const hoursLabel = (h: number) => h < 48 ? `${h < 10 ? h.toFixed(1) : Math.round(h)} h` : h < 24 * 60 ? `${Math.round(h / 24)} days` : `${(h / 24 / 30.4).toFixed(h < 24 * 365 ? 0 : 1)} months`;

/** The start-up clock: the deck's time on production, on a log scale, with play. */
export function IntegrityClock({ hours, playing, onHours, onPlay }: { readonly hours: number; readonly playing: boolean; readonly onHours: (h: number) => void; readonly onPlay: () => void }) {
  const logH = Math.log10(Math.max(0.1, hours));
  return <div className="pw-unload">
    <button type="button" className="rail-button" aria-label={playing ? "Pause start-up" : "Play start-up"} onClick={onPlay}>{playing ? <Pause size={13} /> : <Play size={13} />}</button>
    <input type="range" min={-1} max={Math.log10(24 * 365)} step={0.01} value={Math.min(logH, Math.log10(24 * 365))} aria-label="Time on production" onChange={(event) => onHours(10 ** Number(event.target.value))} />
    <span>{hoursLabel(hours)} on production</span>
  </div>;
}

/** A gauge per annulus: pressure against MAASP, the limit that sets it, BSEE's MAWOP, the measured value and the record's verdict. */
export function IntegrityGauges({ rows, hours, onBleed, bsee, record, diagnostics }: {
  readonly rows: readonly Row[]; readonly hours: number; readonly onBleed: (name: string, psi: number) => void;
  readonly bsee: ReturnType<typeof bseeLimits>; readonly record: Loaded<AnnulusRecord>; readonly diagnostics: Readonly<Record<string, readonly BleedTest[]>> | null;
}) {
  return <div className="it-gauges">
    {rows.map((r) => {
      const a = r.annulus, ratio = Math.min(1.25, r.ratio), tone = ratio >= 1 ? "is-red" : ratio >= 0.8 ? "is-amber" : "is-green";
      const limit = bsee.find((b) => b.name === a.name), measured = record.value ? measuredAt(record.value, a.name, hours) : null;
      const done = (diagnostics?.[a.name] ?? []).filter((t) => t.endH + 24 <= hours), scp = done.some((t) => t.sustained);
      return <section key={a.name} className={`it-gauge ${tone}`}>
        <header><b>{a.name} annulus{done.length > 0 && <em className={scp ? "it-scp is-bad" : "it-scp"}>{scp ? "SCP" : "thermal"}</em>}</b><small>{a.name === "A" ? `${a.innerOdIn} in tubing in ${a.outerIdIn.toFixed(2)} in ID casing` : `${a.innerOdIn} in inside ${a.outerIdIn.toFixed(2)} in ID`} · to {fmt(Math.round(a.bottomMdM))} m · {r.source === "lift gas" ? "lift gas" : a.trapped ? "trapped above cement" : "open to the formation"}</small></header>
        <div className="it-bar"><i style={{ width: `${Math.min(100, ratio / 1.25 * 100)}%` }} /><em style={{ left: `${100 / 1.25}%` }} />{limit && <u style={{ left: `${Math.min(100, limit.mawopPsi / a.maasp.maaspPsi / 1.25 * 100)}%` }} title={`MAWOP ${fmt(Math.round(limit.mawopPsi))} psi, ${limit.mawopBy}`} />}{measured !== null && <s style={{ left: `${Math.min(100, measured / a.maasp.maaspPsi / 1.25 * 100)}%` }} title={`Measured ${fmt(Math.round(measured))} psi`} />}</div>
        <p><b>{fmt(Math.round(r.psi))}</b> of <b>{fmt(Math.round(a.maasp.maaspPsi))}</b> psi MAASP · set by the {LIMIT[a.maasp.governing]}{r.source === "thermal" ? ` · ΔT ${r.deltaT.toFixed(0)} °F` : ""}{measured !== null ? ` · measured ${fmt(Math.round(measured))}` : ""}{limit ? ` · MAWOP ${fmt(Math.round(limit.mawopPsi))}` : ""}</p>
        {r.source === "thermal" && r.psi > 50 && <button type="button" className="tie-button" onClick={() => onBleed(a.name, r.thermal)}>Bleed to 0 psi</button>}
      </section>;
    })}
  </div>;
}

/** What the integrity lens assumes, for its notes. */
export const integrityNotes = (lifting: boolean) => `MAASP after ISO 16530-1: 80% of burst and collapse, the formation at an exposed shoe, the packer (${fmt(PACKER_RATING_PSI)} psi assumed). MAWOP and the diagnostic test after BSEE NTL 2009-G01 (API RP 90). Heat by Ramey from the operating rate; each annulus warms by an assumed share of the tubing's rise (A 0.9, B 0.65, C 0.45); water-based fluid (α 2.5×10⁻⁴ /°F, κ 2.8×10⁻⁶ /psi); the strings balloon elastically.${lifting ? " While gas lifting, A holds the lift gas at its operating pressure." : ""}`;

/** The temperature survey against Ramey's profile at the survey's rate and time: as assumed, and as calibrated. */
export function SurveyCard({ survey, rock, onCalibrate, onAssume, surveyModel }: { readonly survey: Loaded<TemperatureSurvey>; readonly rock: { readonly k: number; readonly fit: ReturnType<typeof calibrateConductivity> | null }; readonly onCalibrate: () => void; readonly onAssume: () => void; readonly surveyModel: ((k: number) => number[]) | null }) {
  const [box, size] = useSize<HTMLDivElement>();
  const input = useRef<HTMLInputElement>(null);
  const s = survey.value;
  const W = Math.max(220, size.width - 16), H = 150, m = { l: 34, r: 8, t: 8, b: 20 };
  const assumed = s && surveyModel ? surveyModel(ASSUMED_CONDUCTIVITY) : null, now = s && surveyModel && rock.fit ? surveyModel(rock.k) : null;
  const tAll = s ? [...s.tempF, ...(assumed ?? [])] : [];
  const x = scaleLinear().domain(tAll.length ? [Math.min(...tAll) - 2, Math.max(...tAll) + 2] : [0, 1]).range([m.l, W - m.r]);
  const y = scaleLinear().domain([0, s ? Math.max(...s.mdM) : 1]).range([m.t, H - m.b]);
  const step = s ? Math.max(1, Math.floor(s.mdM.length / 300)) : 1;
  const path = (values: readonly number[]) => s!.mdM.map((md, i) => i % step ? "" : `${i ? "L" : "M"}${x(values[i]!).toFixed(1)},${y(md).toFixed(1)}`).join("");
  return <section className="nodal-card it-survey" ref={box}>
    <header><b>Rock, from the temperature survey</b><small>{s ? `${s.synthetic ? "synthetic DTS" : s.name} · LAS 2.0 · ${s.date}${s.hours ? ` · ${Math.round(s.hours / 24)} days on production` : ""}${s.rate ? ` at ${fmt(Math.round(s.rate))} STB/d` : ""}` : survey.error ?? "loading…"}</small></header>
    {s && <svg width={W} height={H}>
      {x.ticks(4).map((v) => <text key={v} x={x(v)} y={H - 6} textAnchor="middle" className="vol-tick">{v}°F</text>)}
      {y.ticks(3).map((v) => <g key={v}><line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} className="nodal-grid" /><text x={m.l - 4} y={y(v) + 3} textAnchor="end" className="vol-tick">{fmt(v)}</text></g>)}
      {s.mdM.map((md, i) => i % step ? null : <circle key={i} cx={x(s.tempF[i]!)} cy={y(md)} r={1.3} className="it-dts" />)}
      {assumed && <path d={path(assumed)} className="it-model is-assumed" />}
      {now && <path d={path(now)} className="it-model" />}
    </svg>}
    <p className="nodal-hint">{rock.fit ? `Calibrated: k ${rock.fit.k.toFixed(2)} Btu/hr·ft·°F, ±${Math.max(0.1, (rock.fit.range[1] - rock.fit.range[0]) / 2 / rock.fit.k * 100).toFixed(1)}% at 95%, ${rock.fit.rmsF.toFixed(2)} °F rms over ${fmt(rock.fit.n)} points. The assumed 1.4 is dashed.${rock.fit.atBoundary ? " The fit sits at the edge of the range searched: the survey does not pin it." : ""}` : "Ramey with an assumed rock conductivity of 1.4 (dashed). Calibrate it to the survey before trusting the build-up."}</p>
    <div className="pw-actions">
      <button type="button" className={`tie-button${rock.fit ? "" : " is-primary"}`} disabled={!s || !surveyModel} onClick={onCalibrate}><Wand2 size={11} /> Calibrate to the survey</button>
      {rock.fit && <button type="button" className="tie-button" onClick={onAssume}><RotateCcw size={11} /> Assumed rock</button>}
      <button type="button" className="tie-button" onClick={() => input.current?.click()}><FileUp size={11} /> Load LAS…</button>
      {survey.own && <button type="button" className="tie-button" onClick={() => { void loadOwn("dts", null); }}>Stand-in</button>}
      <input ref={input} type="file" accept=".las,.LAS" hidden onChange={(event) => { const f = event.target.files?.[0]; if (f) void loadOwn("dts", f); event.target.value = ""; }} />
    </div>
  </section>;
}

/** The annulus record over its span: each annulus measured, the thermal build-up the model gives from first production, the bleeds and what each says. */
export function RecordCard({ record, diagnostics, hours, onHours, thermal, bsee }: { readonly record: Loaded<AnnulusRecord>; readonly diagnostics: Readonly<Record<string, readonly BleedTest[]>> | null; readonly hours: number; readonly onHours: (h: number) => void; readonly thermal: ((name: string, h: number) => number) | null; readonly bsee: ReturnType<typeof bseeLimits> }) {
  const [box, size] = useSize<HTMLDivElement>();
  const input = useRef<HTMLInputElement>(null);
  const r = record.value;
  const W = Math.max(220, size.width - 16), H = 140, m = { l: 38, r: 8, t: 8, b: 20 };
  const end = r ? Math.max(1, ...r.hours.filter(Number.isFinite)) : 1;
  const names = r ? Object.keys(r.psi).sort() : [];
  const top = r ? Math.max(100, ...names.flatMap((n) => r.psi[n]!.map((v) => v ?? 0))) * 1.08 : 1;
  const x = scaleLinear().domain([0, end]).range([m.l, W - m.r]), y = scaleLinear().domain([0, top]).range([H - m.b, m.t]);
  const step = r ? Math.max(1, Math.floor(r.hours.length / 400)) : 1;
  const drag = useRef(false);
  const at = (clientX: number, el: SVGSVGElement) => Math.max(0.1, Math.min(end, x.invert(clientX - el.getBoundingClientRect().left)));
  return <section className="nodal-card it-record" ref={box}>
    <header><b>Annulus record</b><small>{r ? `${r.synthetic ? "synthetic SCADA" : r.name} · LAS 2.0, time-indexed · from ${r.start} · ${Math.round(end / 24)} days hourly` : record.error ?? "loading…"}</small></header>
    {r && <svg width={W} height={H} className="it-record-plot" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = true; onHours(at(event.clientX, event.currentTarget)); }} onPointerMove={(event) => { if (drag.current) onHours(at(event.clientX, event.currentTarget)); }} onPointerUp={() => { drag.current = false; }}>
      {y.ticks(3).map((v) => <g key={v}><line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} className="nodal-grid" /><text x={m.l - 4} y={y(v) + 3} textAnchor="end" className="vol-tick">{fmt(v)}</text></g>)}
      {x.ticks(5).map((v) => <text key={v} x={x(v)} y={H - 6} textAnchor="middle" className="vol-tick">{Math.round(v / 24)} d</text>)}
      {names.map((n) => {
        const series = r.psi[n]!, d = r.hours.map((h, i) => i % step || series[i] === null ? "" : `${i ? "L" : "M"}${x(h).toFixed(1)},${y(series[i]!).toFixed(1)}`).join("").replace(/^L/, "M");
        const model = thermal ? Array.from({ length: 60 }, (_, i) => { const h = Math.max(0.1, end * (i / 59) ** 2); return `${i ? "L" : "M"}${x(h).toFixed(1)},${y(Math.min(top, thermal(n, h))).toFixed(1)}`; }).join("") : "";
        return <g key={n} style={{ color: COLOUR[n] ?? "#e2e8f0" }}><path d={model} className="it-rec-model" /><path d={d} className="it-rec" /></g>;
      })}
      {names.flatMap((n, k) => (diagnostics?.[n] ?? []).map((t) => <g key={`${n}${t.startH}`} className={t.sustained ? "it-bleed is-bad" : "it-bleed"}><line x1={x(t.startH)} x2={x(t.startH)} y1={m.t} y2={H - m.b} /><text x={x(t.startH) - 3} y={m.t + 9 + k * 11} textAnchor="end">{n} bled{t.sustained ? ", built back" : ""}</text></g>))}
      {hours <= end && <line x1={x(hours)} x2={x(hours)} y1={m.t - 4} y2={H - m.b} className="it-now" />}
    </svg>}
    {r && names.map((n) => {
      const tests = diagnostics?.[n] ?? [], limit = bsee.find((b) => b.name === n);
      const peak = Math.max(0, ...r.psi[n]!.map((v) => v ?? 0));
      return <p key={n} className="it-verdict"><i style={{ background: COLOUR[n] }} /><b>{n}</b> {tests.length ? tests.map((t) => `bled ${fmt(Math.round(t.fromPsi))} → ${fmt(Math.round(t.toPsi))} psi in ${t.hoursToBleed.toFixed(0)} h on day ${Math.floor(t.startH / 24) + 1}${t.bledToZero ? "" : " (not to zero)"}; built back ${t.rebuildPsi === null ? "–" : fmt(Math.round(t.rebuildPsi))} psi in 24 h, heat explains ${fmt(Math.round(t.thermalPsi))}: ${t.sustained ? "sustained casing pressure, a leak is feeding it" : "thermal"}`).join("; ") : `not bled in the record; peak ${fmt(Math.round(peak))} psi`}{limit && limit.diagnoseAbovePsi !== null && peak > limit.diagnoseAbovePsi ? ` · above BSEE's ${Math.round(limit.share! * 100)}% of MIYP (${fmt(Math.round(limit.diagnoseAbovePsi))} psi): diagnose` : ""}.</p>;
    })}
    <div className="pw-actions">
      <button type="button" className="tie-button" onClick={() => input.current?.click()}><FileUp size={11} /> Load LAS…</button>
      {record.own && <button type="button" className="tie-button" onClick={() => { void loadOwn("annulus", null); }}>Stand-in</button>}
      <input ref={input} type="file" accept=".las,.LAS" hidden onChange={(event) => { const f = event.target.files?.[0]; if (f) void loadOwn("annulus", f); event.target.value = ""; }} />
    </div>
  </section>;
}

/** Every limit for every annulus, for the drawer. */
export function LimitsTable({ rows }: { readonly rows: readonly Row[] }) {
  return <table className="nodal-table">
    <thead><tr><th>Annulus</th><th>Burst<small>psi</small></th><th>Collapse<small>psi</small></th><th>Formation<small>psi</small></th><th>Packer<small>psi</small></th><th>MAASP<small>psi</small></th><th>Now<small>psi</small></th></tr></thead>
    <tbody>{rows.map((r) => { const l = (k: string) => r.annulus.maasp.limits.find((x) => x.limit === k); return <tr key={r.annulus.name}>
      <td>{r.annulus.name}</td>{["burst", "collapse", "formation", "packer"].map((k) => <td key={k} data-chosen={r.annulus.maasp.governing === k || undefined}>{l(k) ? fmt(Math.round(l(k)!.psi)) : "–"}</td>)}
      <td>{fmt(Math.round(r.annulus.maasp.maaspPsi))}</td><td>{fmt(Math.round(r.psi))}</td>
    </tr>; })}</tbody>
  </table>;
}
