import { useEffect, useMemo, useRef, useState } from "react";
import { forgeSeismicSection } from "@ikhmalputra/subsurface-core";
import { useForgeCube } from "../data/sites.ts";
import { wellOnSection } from "../data/forge.ts";
import { useFaults } from "../data/faults.ts";
import { compute } from "../compute/run.ts";
import type { AttributeName } from "../compute/attributes.ts";
import { Dial } from "./production/controls.tsx";
import { useWire } from "./wire.ts";

/**
 * Seismic attributes on the FORGE PSDM, in a chair display you orbit: an inline, a crossline and a
 * depth slice through the cube, the amplitude in grey and an attribute in colour over it. Each slice
 * is dragged through the volume by its face; the deck's depth cursor sets the depth slice; 16A runs
 * through the cube and the faults picked in Horizons are drawn as their sticks. Lenses choose the
 * attribute: envelope, phase, frequency, RMS, coherence, fault likelihood.
 */

const cut = forgeSeismicSection.subVolume!;
const NAMES: readonly { readonly id: AttributeName | "amplitude"; readonly label: string; readonly note: string }[] = [
  { id: "amplitude", label: "Amplitude", note: "The PSDM as delivered." },
  { id: "envelope", label: "Envelope", note: "Reflection strength: bright where the impedance contrast is strong, whatever the phase." },
  { id: "phase", label: "Phase", note: "Instantaneous phase: event continuity, independent of amplitude; faults and pinch-outs show as breaks in the bands." },
  { id: "frequency", label: "Frequency", note: "Instantaneous frequency, cycles per km of depth: softer, thicker or fractured intervals shift it." },
  { id: "rms", label: "RMS", note: "RMS amplitude in a 65 m window." },
  { id: "coherence", label: "Coherence", note: "Dip-steered semblance over 3 × 3 traces and 45 m: dark where the reflectors stop carrying on (faults, fracture zones)." },
  { id: "fault", label: "Fault likelihood", note: "Discontinuity sharpened and thinned to its ridge across the fault: a guide for picking fault sticks in Horizons." },
];
type Slices = { a: number; o: number; s: number };

/** Colour maps, 0–1 to RGB. */
const ramp = (stops: readonly [number, number, number][]) => (t: number): [number, number, number] => { const x = Math.max(0, Math.min(1, t)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i, a = stops[i]!, b = stops[i + 1]!; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; };
const MAPS: Readonly<Record<string, (t: number) => [number, number, number]>> = {
  envelope: ramp([[0, 0, 4], [80, 18, 123], [183, 55, 121], [252, 137, 97], [252, 253, 191]]),
  phase: (t) => { const h = t * 6, c = 220, x = c * (1 - Math.abs((h % 2) - 1)); const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x]; return [r + 30, g + 30, b + 30]; },
  frequency: ramp([[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]]),
  rms: ramp([[0, 0, 4], [87, 16, 110], [188, 55, 84], [249, 142, 9], [252, 255, 164]]),
  coherence: ramp([[10, 10, 14], [60, 60, 70], [170, 170, 180], [245, 245, 250]]),
  fault: ramp([[0, 0, 0], [120, 20, 10], [230, 70, 20], [255, 200, 40], [255, 255, 200]]),
};

export function Attributes() {
  const wire = useWire("attributes");
  const { cube, error } = useForgeCube(true);
  const [name, setName] = useState<AttributeName | "amplitude">("coherence");
  const [opacity, setOpacity] = useState(0.8);
  const [slices, setSlices] = useState<Slices>({ a: 60, o: 30, s: 380 });
  const [volumes, setVolumes] = useState<Partial<Record<AttributeName, { bytes: Uint8Array; lo: number; hi: number }>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!cube || name === "amplitude" || volumes[name]) return;
    let alive = true; setBusy(name);
    compute("attribute", name, cube.counts, { alongCount: cube.alongCount, offsetCount: cube.offsetCount, sampleCount: cube.sampleCount })
      .then((v) => { if (alive) { setVolumes((all) => ({ ...all, [name]: v })); setBusy(null); } }).catch(() => { if (alive) setBusy(null); });
    return () => { alive = false; };
  }, [cube, name, volumes]);
  // The depth cursor on 16A sets the depth slice.
  const cursorSample = useMemo(() => {
    if (wire.cursor === null) return null;
    const p = wellOnSection.reduce((best, q) => Math.abs(q.mdM - wire.cursor!) < Math.abs(best.mdM - wire.cursor!) ? q : best, wellOnSection[0]!);
    return Math.round(p.depthM / cut.sampleIntervalM);
  }, [wire.cursor]);
  useEffect(() => { if (cursorSample !== null && cursorSample >= 0 && cursorSample < cut.samples) setSlices((s) => ({ ...s, s: cursorSample })); }, [cursorSample]);
  const faults = useFaults();
  const info = NAMES.find((n) => n.id === name)!;
  if (error) return <p className="hz-empty">The PSDM volume did not load: {error}</p>;
  if (!cube) return <p className="hz-empty">Loading the FORGE PSDM volume…</p>;
  const attr = name === "amplitude" ? null : volumes[name] ?? null;
  return <div className="at">
    <header className="pw-bar">
      <span className="pw-title"><b>Attributes · FORGE PSDM</b><small>{((cut.alongToM - cut.alongFromM) / 1000).toFixed(2)} × {((cut.offsetToM - cut.offsetFromM) / 1000).toFixed(2)} km · {cut.samples} samples at {cut.sampleIntervalM} m · {busy ? `computing ${busy}…` : info.note}</small></span>
      <span className="pw-lenses at-lenses" role="tablist" aria-label="Attribute">
        {NAMES.map((n) => <button key={n.id} type="button" role="tab" aria-selected={name === n.id} onClick={() => setName(n.id)}>{n.label}</button>)}
      </span>
    </header>
    <div className="at-stage">
      <Chair cube={cube} attr={attr} map={name === "amplitude" ? null : MAPS[name]!} opacity={opacity} slices={slices} onSlices={setSlices} faults={faults.flatMap((f) => f.sticks)} onPin={wire.pin} />
      <aside className="pw-side">
        <div className="pw-dials">
          <Dial label="Inline (across)" value={slices.o} min={0} max={cube.offsetCount - 1} step={1} tone="#38bdf8" show={(v) => `${Math.round(cut.offsetFromM + v * cut.spacingM)} m`} onChange={(o) => setSlices((s) => ({ ...s, o }))} />
          <Dial label="Crossline (along)" value={slices.a} min={0} max={cube.alongCount - 1} step={1} tone="#f472b6" show={(v) => `${Math.round(cut.alongFromM + v * cut.spacingM)} m`} onChange={(a) => setSlices((s) => ({ ...s, a }))} />
          <Dial label="Depth slice" value={slices.s} min={0} max={cube.sampleCount - 1} step={1} tone="#f59e0b" show={(v) => `${Math.round(v * cut.sampleIntervalM)} m`} onChange={(s) => setSlices((x) => ({ ...x, s }))} />
          <Dial label="Attribute opacity" value={opacity} min={0} max={1} step={0.05} tone="#a78bfa" show={(v) => `${Math.round(v * 100)}%`} onChange={setOpacity} />
        </div>
        {attr && <div className="at-legend"><i style={{ background: `linear-gradient(90deg, ${Array.from({ length: 8 }, (_, k) => `rgb(${MAPS[name]!(k / 7).map(Math.round).join(",")})`).join(",")})` }} /><span><small>{name === "phase" ? "−180°" : name === "coherence" ? "discontinuous" : "low"}</small><small>{name === "phase" ? "+180°" : name === "coherence" ? "continuous" : "high"}</small></span></div>}
        <p className="nodal-hint">{info.note} Drag a slice&apos;s face to sweep it; drag elsewhere to orbit; scroll to zoom. The deck&apos;s depth cursor moves the depth slice. {faults.length ? `${faults.length} fault${faults.length === 1 ? "" : "s"} from Horizons drawn as sticks.` : "Faults picked in Horizons appear here as sticks."}</p>
      </aside>
    </div>
  </div>;
}

/**
 * The chair display: three slices through the cube drawn as textured planes. Each slice is painted
 * once into an image (one pixel a trace or sample) and drawn onto its face by an affine transform,
 * which an orthographic view keeps exact. Painted far to near.
 */
function Chair({ cube, attr, map, opacity, slices, onSlices, faults, onPin }: {
  readonly cube: NonNullable<ReturnType<typeof useForgeCube>["cube"]>; readonly attr: { bytes: Uint8Array } | null; readonly map: ((t: number) => [number, number, number]) | null; readonly opacity: number;
  readonly slices: Slices; readonly onSlices: (s: Slices) => void; readonly faults: readonly { readonly o: number; readonly points: readonly { readonly a: number; readonly s: number }[] }[]; readonly onPin: (md: number | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef({ yaw: 0.75, pitch: 0.42, zoom: 1, drag: null as null | { kind: "orbit" | "a" | "o" | "s"; x: number; y: number; yaw: number; pitch: number; start: Slices } });
  const live = useRef({ slices, onSlices });
  live.current = { slices, onSlices };
  const na = cube.alongCount, no = cube.offsetCount, ns = cube.sampleCount;
  // The slice images: amplitude grey, the attribute over it at its opacity.
  const paint = (w: number, h: number, voxel: (u: number, v: number) => number) => {
    const img = document.createElement("canvas"); img.width = w; img.height = h;
    const g = img.getContext("2d")!, data = g.createImageData(w, h);
    for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
      const i = voxel(u, v), amp = cube.counts[i]!, grey = 128 + amp, k = (v * w + u) * 4;
      let r = grey, gg = grey, b = grey;
      if (attr && map) { const [cr, cg, cb] = map(attr.bytes[i]! / 255); r = grey * (1 - opacity) + cr * opacity; gg = grey * (1 - opacity) + cg * opacity; b = grey * (1 - opacity) + cb * opacity; }
      data.data[k] = r; data.data[k + 1] = gg; data.data[k + 2] = b; data.data[k + 3] = 255;
    }
    g.putImageData(data, 0, 0);
    return img;
  };
  const idx = (a: number, o: number, s: number) => (s * no + o) * na + a;
  const images = useMemo(() => ({
    inline: paint(na, ns, (u, v) => idx(u, slices.o, v)),
    crossline: paint(no, ns, (u, v) => idx(slices.a, u, v)),
    depth: paint(na, no, (u, v) => idx(u, v, slices.s)),
  }), [cube, attr, map, opacity, slices.a, slices.o, slices.s]);
  const imagesRef = useRef(images); imagesRef.current = images;
  const faultsRef = useRef(faults); faultsRef.current = faults;

  useEffect(() => {
    const el = canvas.current, ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    let w = 0, h = 0, frame = 0;
    const resize = () => { const b = el.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1); w = Math.max(200, b.width); h = Math.max(200, b.height); el.width = Math.round(w * dpr); el.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const v = view.current, { slices: sl } = live.current, img = imagesRef.current;
      // World metres: x along, y offset, z up (depth down), centred on the cube.
      const X = (a: number) => (a - na / 2) * cut.spacingM, Y = (o: number) => (o - no / 2) * cut.spacingM, Z = (s: number) => -(s - ns / 2) * cut.sampleIntervalM;
      const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw), cp = Math.cos(v.pitch), sp = Math.sin(v.pitch), scale = Math.min(w, h) / 4300 * v.zoom;
      const P = (a: number, o: number, s: number) => { const x = X(a), y = Y(o), z = Z(s); const xr = x * cy - y * sy, yr = x * sy + y * cy; return { x: w / 2 + xr * scale, y: h / 2 - (z * cp - yr * sp) * scale, d: yr * cp + z * sp }; };
      ctx.setTransform(1, 0, 0, 1, 0, 0); const dpr = el.width / w; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bg = ctx.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, "#0b1222"); bg.addColorStop(1, "#141b2e"); ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      // The cube's frame.
      const corners = [[0, 0, 0], [na, 0, 0], [na, no, 0], [0, no, 0], [0, 0, ns], [na, 0, ns], [na, no, ns], [0, no, ns]].map(([a, o, s]) => P(a!, o!, s!));
      ctx.strokeStyle = "rgba(148, 163, 184, 0.25)"; ctx.lineWidth = 1;
      for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] as const) { ctx.beginPath(); ctx.moveTo(corners[i]!.x, corners[i]!.y); ctx.lineTo(corners[j]!.x, corners[j]!.y); ctx.stroke(); }
      // The three faces, each an image on a parallelogram. Each is cut into four by the other two slices
      // and the twelve pieces are painted far to near, so the planes cross correctly.
      const faces = [
        { key: "s" as const, img: img.depth, o0: P(0, 0, sl.s), u: P(1, 0, sl.s), vv: P(0, 1, sl.s), colour: "#f59e0b", cutU: sl.a, cutV: sl.o, at: (u: number, vv: number) => P(u, vv, sl.s) },
        { key: "o" as const, img: img.inline, o0: P(0, sl.o, 0), u: P(1, sl.o, 0), vv: P(0, sl.o, 1), colour: "#38bdf8", cutU: sl.a, cutV: sl.s, at: (u: number, vv: number) => P(u, sl.o, vv) },
        { key: "a" as const, img: img.crossline, o0: P(sl.a, 0, 0), u: P(sl.a, 1, 0), vv: P(sl.a, 0, 1), colour: "#f472b6", cutU: sl.o, cutV: sl.s, at: (u: number, vv: number) => P(sl.a, u, vv) },
      ];
      const pieces = faces.flatMap((f) => {
        const W2 = f.img.width, H2 = f.img.height, us = [0, f.cutU, W2], vs = [0, f.cutV, H2];
        return [0, 1].flatMap((i) => [0, 1].map((j) => ({ f, u0: us[i]!, u1: us[i + 1]!, v0: vs[j]!, v1: vs[j + 1]!, d: f.at((us[i]! + us[i + 1]!) / 2, (vs[j]! + vs[j + 1]!) / 2).d })));
      }).filter((q) => q.u1 > q.u0 && q.v1 > q.v0).sort((p, q) => q.d - p.d);
      for (const q of pieces) {
        const f = q.f;
        ctx.save();
        ctx.transform(f.u.x - f.o0.x, f.u.y - f.o0.y, f.vv.x - f.o0.x, f.vv.y - f.o0.y, f.o0.x, f.o0.y);
        ctx.beginPath(); ctx.rect(q.u0, q.v0, q.u1 - q.u0, q.v1 - q.v0); ctx.clip();
        ctx.imageSmoothingEnabled = true; ctx.drawImage(f.img, 0, 0);
        ctx.restore();
        const edge = [f.at(q.u0, q.v0), f.at(q.u1, q.v0), f.at(q.u1, q.v1), f.at(q.u0, q.v1)];
        ctx.strokeStyle = f.colour; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.85; ctx.beginPath(); edge.forEach((pt, k) => k ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)); ctx.closePath(); ctx.stroke(); ctx.globalAlpha = 1;
      }
      // 16A through the cube.
      const toA = (alongM: number) => (alongM - cut.alongFromM) / cut.spacingM, toO = (offsetM: number) => (offsetM - cut.offsetFromM) / cut.spacingM, toS = (depthM: number) => depthM / cut.sampleIntervalM;
      ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 2.5; ctx.beginPath();
      wellOnSection.forEach((p, i) => { const q = P(toA(p.alongM), toO(p.offsetM), toS(p.depthM)); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.stroke();
      const toe = wellOnSection.at(-1)!, tq = P(toA(toe.alongM), toO(toe.offsetM), toS(toe.depthM));
      ctx.fillStyle = "#e2e8f0"; ctx.font = "600 11px 'IBM Plex Sans', sans-serif"; ctx.textAlign = "left"; ctx.fillText("16A(78)-32", tq.x + 6, tq.y + 4);
      // Fault sticks from Horizons.
      ctx.strokeStyle = "#f87171"; ctx.lineWidth = 2;
      for (const stick of faultsRef.current) { ctx.beginPath(); stick.points.forEach((pt, i) => { const q = P(pt.a, stick.o, pt.s); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.stroke(); }
      // Axis labels.
      ctx.fillStyle = "rgba(226,232,240,0.6)"; ctx.font = "500 10px 'IBM Plex Sans', sans-serif";
      const lab = (p: { x: number; y: number }, text: string) => ctx.fillText(text, p.x, p.y);
      lab(P(na, 0, 0), `along ${Math.round(cut.alongToM)} m`); lab(P(0, no, 0), `across ${Math.round(cut.offsetToM)} m`); lab(P(0, 0, ns), `${Math.round(ns * cut.sampleIntervalM)} m`);
      ctx.textAlign = "right"; ctx.fillText("drag a face to sweep it · drag to orbit · scroll to zoom · double-click to reset", w - 10, h - 10);
      (el as HTMLCanvasElement & { faces?: typeof faces }).faces = faces;
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [na, no, ns]);

  /** Which face is under the pointer: the nearest one whose parallelogram holds it. */
  const faceAt = (x: number, y: number): "a" | "o" | "s" | null => {
    const faces = (canvas.current as (HTMLCanvasElement & { faces?: { key: "a" | "o" | "s"; o0: { x: number; y: number }; u: { x: number; y: number }; vv: { x: number; y: number }; img: HTMLCanvasElement }[] }) | null)?.faces;
    if (!faces) return null;
    for (const f of [...faces].reverse()) {
      const ux = f.u.x - f.o0.x, uy = f.u.y - f.o0.y, vx = f.vv.x - f.o0.x, vy = f.vv.y - f.o0.y, det = ux * vy - uy * vx;
      if (Math.abs(det) < 1e-9) continue;
      const px = x - f.o0.x, py = y - f.o0.y, u = (px * vy - py * vx) / det, v = (ux * py - uy * px) / det;
      if (u >= 0 && u <= f.img.width && v >= 0 && v <= f.img.height) return f.key;
    }
    return null;
  };
  return <canvas ref={canvas} className="at-canvas" aria-label="Seismic chair display: drag a face to sweep it, drag elsewhere to orbit, scroll to zoom"
    onPointerDown={(event) => { const b = event.currentTarget.getBoundingClientRect(); event.currentTarget.setPointerCapture(event.pointerId); const kind = faceAt(event.clientX - b.left, event.clientY - b.top) ?? "orbit"; const v = view.current; v.drag = { kind, x: event.clientX, y: event.clientY, yaw: v.yaw, pitch: v.pitch, start: live.current.slices }; }}
    onPointerMove={(event) => {
      const v = view.current, d = v.drag; if (!d) return;
      const dx = event.clientX - d.x, dy = event.clientY - d.y;
      if (d.kind === "orbit") { v.yaw = d.yaw + dx / 180; v.pitch = Math.max(-0.2, Math.min(1.4, d.pitch + dy / 220)); return; }
      // Sweep along the slice's normal as it falls on the screen.
      const step = (dx + dy) / 4, s = d.start;
      live.current.onSlices(d.kind === "s" ? { ...s, s: Math.max(0, Math.min(ns - 1, Math.round(s.s + dy / 0.6 / (Math.min(1, view.current.zoom))))) } : d.kind === "o" ? { ...s, o: Math.max(0, Math.min(no - 1, Math.round(s.o + step / 3))) } : { ...s, a: Math.max(0, Math.min(na - 1, Math.round(s.a + step / 3))) });
    }}
    onPointerUp={() => { view.current.drag = null; }}
    onWheel={(event) => { const v = view.current; v.zoom = Math.max(0.4, Math.min(5, v.zoom * Math.exp(-event.deltaY / 600))); }}
    onDoubleClick={() => { Object.assign(view.current, { yaw: 0.75, pitch: 0.42, zoom: 1 }); onPin(null); }} />;
}
