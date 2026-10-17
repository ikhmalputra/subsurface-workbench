import { Pause, Play } from "lucide-react";
import { PACKER_RATING_PSI } from "../../data/integrity-model.ts";
import type { annulusPressures } from "../../data/integrity-model.ts";
import { fmt } from "../../format.ts";

/**
 * The integrity lens's panel: the start-up clock, and a gauge per annulus with its pressure against
 * its MAASP, the limit that sets the MAASP, whether heat can build pressure in it, and a bleed.
 */
type Row = ReturnType<typeof annulusPressures>[number];
const LIMIT: Readonly<Record<string, string>> = { burst: "outer string's burst", collapse: "inner string's collapse", formation: "formation at the shoe", packer: "packer rating" };
export const hoursLabel = (h: number) => h < 48 ? `${h < 10 ? h.toFixed(1) : Math.round(h)} h` : h < 24 * 60 ? `${Math.round(h / 24)} days` : `${(h / 24 / 30.4).toFixed(h < 24 * 365 ? 0 : 1)} months`;

export function IntegritySide({ rows, hours, playing, onHours, onPlay, onBleed, onLimits, lifting }: {
  readonly rows: readonly Row[]; readonly hours: number; readonly playing: boolean;
  readonly onHours: (h: number) => void; readonly onPlay: () => void; readonly onBleed: (name: string, psi: number) => void; readonly onLimits: () => void; readonly lifting: boolean;
}) {
  const logH = Math.log10(Math.max(0.1, hours));
  return <>
    <div className="pw-unload">
      <button type="button" className="rail-button" aria-label={playing ? "Pause start-up" : "Play start-up"} onClick={onPlay}>{playing ? <Pause size={13} /> : <Play size={13} />}</button>
      <input type="range" min={-1} max={Math.log10(24 * 365)} step={0.01} value={logH} aria-label="Time on production" onChange={(event) => onHours(10 ** Number(event.target.value))} />
      <span>{hoursLabel(hours)} on production</span>
    </div>
    <div className="it-gauges">
      {rows.map((r) => {
        const a = r.annulus, ratio = Math.min(1.25, r.ratio), tone = ratio >= 1 ? "is-red" : ratio >= 0.8 ? "is-amber" : "is-green";
        return <section key={a.name} className={`it-gauge ${tone}`}>
          <header><b>{a.name} annulus</b><small>{a.name === "A" ? `${a.innerOdIn} in tubing in ${a.outerIdIn.toFixed(2)} in ID casing` : `${a.innerOdIn} in inside ${a.outerIdIn.toFixed(2)} in ID`} · to {fmt(Math.round(a.bottomMdM))} m · {r.source === "lift gas" ? "lift gas" : a.trapped ? "trapped above cement" : "open to the formation"}</small></header>
          <div className="it-bar"><i style={{ width: `${Math.min(100, ratio / 1.25 * 100)}%` }} /><em style={{ left: `${100 / 1.25}%` }} /></div>
          <p><b>{fmt(Math.round(r.psi))}</b> of <b>{fmt(Math.round(a.maasp.maaspPsi))}</b> psi MAASP · set by the {LIMIT[a.maasp.governing]}{r.source === "thermal" ? ` · ΔT ${r.deltaT.toFixed(0)} °F` : ""}</p>
          {r.source === "thermal" && r.psi > 50 && <button type="button" className="tie-button" onClick={() => onBleed(a.name, r.thermal)}>Bleed to 0 psi</button>}
        </section>;
      })}
    </div>
    <button type="button" className="tie-button" onClick={onLimits}>Every limit, annulus by annulus</button>
    <p className="nodal-hint">MAASP after ISO 16530-1: 80% of burst and collapse, the formation at an exposed shoe, the packer ({fmt(PACKER_RATING_PSI)} psi assumed). Heat by Ramey from the operating rate; each annulus warms by an assumed share of the tubing&apos;s rise (A 0.9, B 0.65, C 0.45); water-based fluid (α 2.5×10⁻⁴ /°F, κ 2.8×10⁻⁶ /psi); the strings balloon elastically.{lifting ? " While gas lifting, A holds the lift gas at its operating pressure." : ""} A bled annulus builds again as it warms further; one that builds back faster than heat explains would be sustained casing pressure (not modelled).</p>
  </>;
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
