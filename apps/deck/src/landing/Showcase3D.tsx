import { useEffect, useMemo, useRef, useState } from "react";
import { Hand, Loader2 } from "lucide-react";
import { assemblyCatalog } from "@ikhmalputra/subsurface-core/assembly";
import type { Viewer } from "./viewer.ts";

/**
 * The 3D section: the subsurface first (the seismic volume, a well inside it, what was built in it),
 * then a live turntable of any component in the catalogue (the same Blender models the deck's
 * cutaway builds a well from) and the catalogue itself. The 3D engine is fetched only when the
 * viewer scrolls into view.
 */

const ASSETS = "/well-components/";
const fraction: Record<string, string> = { "0.125": "⅛", "0.25": "¼", "0.375": "⅜", "0.5": "½", "0.625": "⅝", "0.75": "¾", "0.875": "⅞" };
const inches = (value: number) => { const whole = Math.floor(value); const part = fraction[String(Number((value - whole).toFixed(3)))]; return part ? `${whole}${part}″` : `${Number(value.toFixed(3))}″`; };

const VIEWS: readonly { readonly image: string; readonly title: string; readonly body: string; readonly alt: string }[] = [
  { image: "/landing/site3d.jpg", title: "The volume", body: "Utah FORGE's 3D seismic with the granite reservoir top and three wells, in one frame. Drag the inline, crossline and depth slices; the seismic section follows.", alt: "Utah FORGE in 3D: 16A, 16B and 58-32 with the granite reservoir top and slices through the PSDM volume" },
  { image: "/landing/well3d.jpg", title: "The well in its rock", body: "16A inside the seismic it was drilled through, its open-hole gamma ray wrapped on the path as colour and thickness. Click the path to probe a depth.", alt: "FORGE 16A in 3D inside the PSDM volume, its open-hole section wrapped in the gamma-ray log, a probe ring at 2,571 m" },
  { image: "/landing/cutaway-close.jpg", title: "What was built in it", body: "Every string, cement sheath and tool cut open on a shared depth scale, built from the component models below. Explode it, isolate a part, section it.", alt: "Kestrel A-7's construction cut open in 3D: conductor, surface, intermediate and production strings, cement, tubing and the safety valve" },
];

export function Showcase3D() {
  const parts = useMemo(() => assemblyCatalog.filter((entry) => entry.asset.model), []);
  const categories = useMemo(() => [...new Set(parts.map((entry) => entry.category))], [parts]);
  const [chosen, setChosen] = useState("christmas-tree");
  const part = parts.find((entry) => entry.id === chosen) ?? parts[0]!;
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const [status, setStatus] = useState<"waiting" | "loading" | "ready" | "failed">("waiting");
  const [touched, setTouched] = useState(false);

  // Start the 3D engine the first time the viewer comes near the screen.
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    let cancelled = false;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || viewer.current) return;
      observer.disconnect();
      setStatus("loading");
      import("./viewer.ts").then(({ createViewer }) => {
        if (cancelled || !canvas.current) return;
        const turn = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        viewer.current = createViewer(canvas.current, { turn });
        setStatus("ready");
      }).catch(() => { if (!cancelled) setStatus("failed"); });
    }, { rootMargin: "300px" });
    observer.observe(element);
    return () => { cancelled = true; observer.disconnect(); viewer.current?.dispose(); viewer.current = null; };
  }, []);

  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (status !== "ready" || !viewer.current || !part.asset.model) return;
    setLoading(true);
    viewer.current.load(ASSETS + part.asset.model).then(() => setLoading(false), () => { setLoading(false); setStatus("failed"); });
  }, [status, part]);

  return <section className="lp-section lp-3d" id="in-3d" aria-labelledby="three-title">
    <div className="lp-head"><p className="lp-eyebrow">The subsurface in 3D</p><h2 id="three-title">From the seismic volume down to the last valve</h2>
      <p>Seismic, horizons and well paths share one 3D frame. Zoom into a well and every string, cement sheath and tool in it is a modelled part, placed at its depth and drawn to the well's own sizes.</p></div>

    <div className="lp-views">{VIEWS.map((view) => <figure key={view.title} className="lp-view">
      <div className="lp-shot"><img src={view.image} alt={view.alt} loading="lazy" width={1358} height={860} /></div>
      <figcaption><b>{view.title}</b>{view.body}</figcaption>
    </figure>)}</div>

    <div className="lp-subhead"><h3>{parts.length} component models. Turn any of them.</h3>
      <p>Wellheads and trees, casing hardware, completion tools, artificial lift, sand control and plugs, modelled in Blender: the parts the cutaway builds a well from.</p></div>

    <div className="lp-viewer">
      <div className="lp-stage" ref={stage} onPointerDown={() => setTouched(true)}>
        <canvas ref={canvas} aria-label={`${part.label}, a 3D model you can turn: drag to rotate, scroll to zoom`} />
        {status !== "ready" && <img className="lp-stage-still" src={ASSETS + part.asset.thumbnail} alt="" aria-hidden="true" />}
        {(status === "loading" || loading) && <span className="lp-stage-note"><Loader2 size={14} className="lp-spin" aria-hidden="true" />Loading the model</span>}
        {status === "failed" && <span className="lp-stage-note">3D is not available in this browser; showing the render.</span>}
        {status === "ready" && !touched && <span className="lp-stage-hint"><Hand size={14} aria-hidden="true" />Drag to turn · scroll to zoom</span>}
      </div>
      <aside className="lp-part">
        <p className="lp-part-cat">{part.category}</p>
        <h3>{part.label}</h3>
        <p>{part.description}</p>
        <dl>
          <div><dt>Outside diameter</dt><dd>{inches(part.odIn)}</dd></div>
          {part.idIn !== null && <div><dt>Bore</dt><dd>{inches(part.idIn)}</dd></div>}
          {part.lengthM > 0 && <div><dt>Length</dt><dd>{part.lengthM} m</dd></div>}
          <div><dt>Placed</dt><dd>{part.placementHint}</dd></div>
        </dl>
        <small>Nominal geometry for drawing, not a manufacturer's model.</small>
      </aside>
    </div>

    <div className="lp-library" aria-label="Component library">
      {categories.map((category) => <div key={category} className="lp-lib-group">
        <h4>{category}</h4>
        <div className="lp-lib-row">{parts.filter((entry) => entry.category === category).map((entry) => <button key={entry.id} type="button" className="lp-lib-item" aria-pressed={entry.id === chosen} onClick={() => { setChosen(entry.id); const box = stage.current?.getBoundingClientRect(); if (box && (box.bottom < 80 || box.top > window.innerHeight - 80)) stage.current!.scrollIntoView({ behavior: "smooth", block: "center" }); }}>
          <img src={ASSETS + entry.asset.thumbnail} alt="" loading="lazy" width={96} height={96} />
          <span>{entry.label}</span>
        </button>)}</div>
      </div>)}
    </div>

  </section>;
}
