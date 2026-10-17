// Read a microseismic catalogue in QuakeML 1.2 (the FDSN format ObsPy and the GDR exchange), then
// read it as a monitoring team does: completeness, Gutenberg–Richter b, and the traffic light.
import { useEffect, useMemo, useState } from "react";
import { readQuakeML } from "@ikhmalputra/subsurface-core/quakeml";
import type { QuakeCatalogue } from "@ikhmalputra/subsurface-core/quakeml";
import { bValue, completeness, trafficLight } from "@ikhmalputra/subsurface-core/induced-seismicity";

// The deck's synthetic stand-in for FORGE 16A's April 2022 catalogue; any QuakeML URL works.
const URL = `${import.meta.env.BASE_URL}data/synthetic/forge-16a-stimulation-2022.synthetic.quakeml.xml`;

export function Catalogue() {
  const [catalogue, setCatalogue] = useState<QuakeCatalogue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amber, setAmber] = useState(0.5);
  const [red, setRed] = useState(1.5);
  useEffect(() => {
    fetch(URL).then((r) => r.text()).then((xml) => setCatalogue(readQuakeML(xml))).catch((e: unknown) => setError(String(e)));
  }, []);

  const read = useMemo(() => {
    if (!catalogue) return null;
    const mags = catalogue.events.map((e) => Math.round(e.magnitude * 10) / 10); // to the 0.1 bin catalogues report
    const mc = completeness(mags);                                                // maximum curvature, +0.2
    return { mags, mc, b: bValue(mags, mc), max: Math.max(...mags) };             // Aki's maximum likelihood
  }, [catalogue]);
  if (error) return <p className="ex-readout">The catalogue did not load: {error}</p>;
  if (!catalogue || !read) return <p className="ex-readout">Reading the QuakeML…</p>;

  const light = trafficLight(read.max, amber, red);
  // Gutenberg–Richter: how many events at or above each magnitude, on a log scale.
  const bins = Array.from({ length: 36 }, (_, i) => -2 + i * 0.1);
  const counts = bins.map((m) => read.mags.filter((v) => v >= m - 1e-9).length);
  const W = 320, H = 170, x = (m: number) => 34 + (m + 2) / 3.6 * (W - 44), y = (n: number) => H - 22 - Math.log10(Math.max(1, n)) / 3 * (H - 34);
  const fit = (m: number) => Math.log10(read.b.n) - read.b.b * (m - read.mc);
  return <div className="ex-catalogue">
    <svg width={W} height={H} role="img" aria-label="Gutenberg–Richter plot">
      {[1, 10, 100].map((n) => <g key={n}><line x1={34} x2={W - 10} y1={y(n)} y2={y(n)} className="ex-grid" /><text x={30} y={y(n) + 3} textAnchor="end" className="ex-tick">{n}</text></g>)}
      {[-2, -1, 0, 1].map((m) => <text key={m} x={x(m)} y={H - 6} textAnchor="middle" className="ex-tick">M{m}</text>)}
      {counts.map((n, i) => n ? <circle key={i} cx={x(bins[i]!)} cy={y(n)} r={2.6} className="ex-dot" /> : null)}
      <line x1={x(read.mc)} x2={x(1.6)} y1={y(10 ** fit(read.mc))} y2={y(10 ** fit(1.6))} className="ex-fit" />
      <line x1={x(read.mc)} x2={x(read.mc)} y1={10} y2={H - 22} className="ex-mc" />
      {[amber, red].map((m, i) => <line key={i} x1={x(m)} x2={x(m)} y1={10} y2={H - 22} className={i ? "ex-red" : "ex-amber"} />)}
    </svg>
    <p className="ex-readout">{catalogue.events.length} events · Mc {read.mc.toFixed(1)} · b {read.b.b.toFixed(2)} ± {read.b.sigma.toFixed(2)} · largest Mw {read.max.toFixed(1)}</p>
    <label className="ex-slider">Amber at Mw <b>{amber.toFixed(1)}</b><input type="range" min={-1} max={2} step={0.1} value={amber} onChange={(e) => { const v = Number(e.target.value); setAmber(v); setRed(Math.max(red, v + 0.1)); }} /></label>
    <label className="ex-slider">Red at Mw <b>{red.toFixed(1)}</b><input type="range" min={-0.5} max={2.5} step={0.1} value={red} onChange={(e) => { const v = Number(e.target.value); setRed(v); setAmber(Math.min(amber, v - 0.1)); }} /></label>
    <p className={`ex-light is-${light.light}`}><b>{light.light}</b> {light.response}</p>
  </div>;
}
