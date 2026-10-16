import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { ArrowRight, Box, Braces, Database, Layers3, Loader2, Play, Search, Terminal } from "lucide-react";
import { Code } from "./Code.tsx";
import { ENTRY_NOTES } from "./entries.ts";
import reference from "./sdk-exports.json";
import { main as surveyMain } from "./examples/survey.ts";
import surveySource from "./examples/survey.ts?raw";
import { PlanWell } from "./examples/PlanWell.tsx";
import planSource from "./examples/PlanWell.tsx?raw";
import { CheckCasing } from "./examples/CheckCasing.tsx";
import casingSource from "./examples/CheckCasing.tsx?raw";
import { LinkedLogs } from "./examples/LinkedLogs.tsx";
import linkedSource from "./examples/LinkedLogs.tsx?raw";
import cutawaySource from "./examples/Cutaway3D.tsx?raw";
import linkViewsSource from "./guides/LinkViews.tsx?raw";
import yourDataSource from "./guides/yourData.ts?raw";
import serverSource from "./guides/server.ts?raw";
import { BASE } from "../base.ts";

/**
 * The Developers page: how to install the two packages the deck is built from, how they fit
 * together, live examples whose shown source is the file that runs, integration notes, and an API
 * reference generated from the packages' runtime exports (scripts/sdk-reference.mjs).
 */

const DECK = `${BASE}deck/`;
// The 3D engine is only fetched when its example is opened.
const Cutaway3D = lazy(() => import("./examples/Cutaway3D.tsx").then((module) => ({ default: module.Cutaway3D })));

type Entry = (typeof reference)[number];
const coreEntries = reference.filter((entry) => entry.package.endsWith("core"));
const reactEntries = reference.filter((entry) => entry.package.endsWith("react"));
const unique = (entries: readonly Entry[]) => new Set(entries.flatMap((entry) => entry.exports.map((item) => item.name))).size;

function SurveyConsole() {
  const lines = useMemo(() => { const out: string[] = []; surveyMain((line) => out.push(line)); return out; }, []);
  return <div className="ex-console" role="log" aria-label="Output of main()"><span className="ex-prompt">$ node survey.ts</span>{lines.map((line, index) => <span key={index}>{line}</span>)}</div>;
}

interface Example { readonly id: string; readonly title: string; readonly blurb: string; readonly file: string; readonly source: string; readonly uses: readonly string[]; readonly Result: ComponentType }
const EXAMPLES: readonly Example[] = [
  { id: "survey", title: "Compute a survey", file: "survey.ts", source: surveySource, Result: SurveyConsole,
    blurb: "Minimum curvature from MD, inclination and azimuth: TVD, north, east and dogleg severity per station, then the closure. Core only, so it runs in Node as it is.",
    uses: ["subsurface-core/trajectory"] },
  { id: "plan", title: "Plan a well", file: "PlanWell.tsx", source: planSource, Result: PlanWell,
    blurb: "Solve a build-and-hold profile to a target and draw it in plan and section, at true scale. Drag the target or move the sliders; an unreachable target says why.",
    uses: ["subsurface-core/trajectory", "subsurface-react/trajectory"] },
  { id: "casing", title: "Check a casing design", file: "CheckCasing.tsx", source: casingSource, Result: CheckCasing,
    blurb: "Burst, collapse and tension safety factors for every string of a design (API TR 5C3 ratings), and its schematic. Raise the wear allowance and watch strings fail.",
    uses: ["subsurface-core/well-design", "subsurface-react/2d"] },
  { id: "linked", title: "Link real data by depth", file: "LinkedLogs.tsx", source: linkedSource, Result: LinkedLogs,
    blurb: "FORGE 16A(78)-32’s published mud log (LAS) beside its as-built construction. One depth link: hover or zoom either view and the other follows, feet and metres converted at the edge.",
    uses: ["subsurface-core", "subsurface-core/records", "subsurface-react/2d", "subsurface-react/state"] },
  { id: "cutaway", title: "Cut a well open in 3D", file: "Cutaway3D.tsx", source: cutawaySource, Result: () => <Suspense fallback={<p className="ex-readout"><Loader2 size={14} className="dv-spin" /> Loading the 3D engine…</p>}><Cutaway3D /></Suspense>,
    blurb: "The design as modelled parts: casing, cement, tubing, the safety valve, built from the package’s Blender models. Orbit it, select a part, explode it. WebGPU with a WebGL 2 fallback.",
    uses: ["subsurface-core/well-design", "subsurface-react/assembly-three"] },
];

const INSTALL = `# 1. Build and pack both packages from a checkout of subsurface-workbench
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm test:packages   # packs both into output/packages, installs them in an empty app, renders them

# 2. Add them to your app, with their peers
npm install ../subsurface-workbench/output/packages/ikhmalputra-subsurface-core-0.0.1.tgz \\
  ../subsurface-workbench/output/packages/ikhmalputra-subsurface-react-0.0.1.tgz \\
  react@19.3.0 react-dom@19.3.0 three@0.186.1`;

const FIRST = `import "@ikhmalputra/subsurface-react/styles.css";   // once, at your app's root
import { computeMinimumCurvature } from "@ikhmalputra/subsurface-core/trajectory";
import { TrajectoryPlanView } from "@ikhmalputra/subsurface-react/trajectory";

const survey = computeMinimumCurvature(stations);
<TrajectoryPlanView survey={survey} height={320} />`;

const ASSETS = `# The 3D scenes and schematics load the component models from a URL you serve.
cp -R node_modules/@ikhmalputra/subsurface-react/assets/well-components public/well-components

# The globe (WellsMap) needs MapLibre's CSP worker and the offline basemap, also self-hosted.
cp node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs public/gis/
cp node_modules/@ikhmalputra/subsurface-react/assets/gis/world-50m.json public/gis/`;

const CSP = `Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval';   # the meshopt model decoder is WebAssembly
  worker-src 'self';                      # the self-hosted MapLibre worker
  img-src 'self' blob: data:;
  connect-src 'self'                      # data comes from your own origin`;

const THEME = `<!-- Built in: light by default, or dark, or high-contrast, on any container -->
<section data-sw-theme="dark">…</section>

/* Or set the variables yourself; this is the deck's night theme. */
.my-app {
  --sw-ink: #e8ebf7; --sw-muted: #9aa3c0; --sw-line: rgba(160, 172, 255, .16);
  --sw-grid: rgba(160, 172, 255, .08); --sw-accent: #a78bfa; --sw-paper: transparent;
  --sw-surface: #10162a; --sw-cursor: #22d3ee; --sw-select: #ff8a3d; --sw-focus: #22d3ee;
}`;

const LAYERS = [
  { icon: Database, title: "Your data", body: "Surveys, LAS logs, SEG-Y, casing tallies, daily reports, production months: files and records you already have.", chips: ["LAS 2.0", "SEG-Y", "GeoJSON", "GeoTIFF", "JSON contracts"] },
  { icon: Braces, title: "subsurface-core", body: "Validates it, and computes on it. Framework-free TypeScript; runs in the browser, Node or a worker.", chips: ["trajectory", "well-design", "records", "seismic", "contracts", "units", "state"] },
  { icon: Layers3, title: "subsurface-react", body: "Draws it: depth tracks, schematics, plots, the seismic section, 3D scenes and the globe. Every view is controlled.", chips: ["2d", "3d", "gis", "records", "trajectory", "seismic"] },
  { icon: Box, title: "Your app", body: "Owns selection, fetching and persistence, links views through one store, and decides where the data lives.", chips: ["your state", "your storage", "your API"] },
];

const RULES = [
  { title: "Views are controlled", body: "A view never fetches records, stores anything or keeps a selection of its own. You pass the data and the selection; it reports what the user did." },
  { title: "Unknown stays unknown", body: "A value that was not reported renders as “not reported”. Nothing is filled in, interpolated across a gap or defaulted silently." },
  { title: "Provenance travels with data", body: "Records say whether they are documented, synthetic or user-authored, and cite their source page; the views show it." },
  { title: "Units are in the names", body: "mdM, depthFt, mudWeightSg, burstPsi: every number says its unit, and conversions happen at your boundary, explicitly." },
  { title: "No global state", body: "One store per workspace, created by you. Two decks on one page, or one per server request, never share anything." },
  { title: "Engineering screening", body: "Ratings follow API TR 5C3 and are tested against published values. It is a screening aid, not a certified well design." },
];

function Examples() {
  const [active, setActive] = useState(EXAMPLES[0]!.id);
  const example = EXAMPLES.find((entry) => entry.id === active)!;
  return <div className="dv-examples">
    <div className="dv-tabs" role="tablist" aria-label="Examples">{EXAMPLES.map((entry, index) =>
      <button key={entry.id} type="button" role="tab" id={`tab-${entry.id}`} aria-selected={entry.id === active} aria-controls="example-panel" onClick={() => setActive(entry.id)}>
        <span>{String(index + 1).padStart(2, "0")}</span>{entry.title}
      </button>)}
    </div>
    <div className="dv-example" role="tabpanel" id="example-panel" aria-labelledby={`tab-${active}`}>
      <header>
        <div><h3>{example.title}</h3><p>{example.blurb}</p></div>
        <div className="dv-uses">{example.uses.map((use) => <code key={use}>{use}</code>)}</div>
      </header>
      <div className="dv-split">
        <div className="dv-result" aria-label={`${example.title}, running`}>
          <p className="dv-live"><Play size={12} aria-hidden="true" />Running {example.file}, the file below</p>
          <example.Result key={example.id} />
        </div>
        <Code source={example.source} label={example.file} />
      </div>
    </div>
  </div>;
}

function Reference() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const needle = query.trim().toLowerCase();
  const matches = (entry: Entry) => !needle || entry.entry.toLowerCase().includes(needle) || entry.exports.some((item) => item.name.toLowerCase().includes(needle)) || (ENTRY_NOTES[entry.entry] ?? "").toLowerCase().includes(needle);
  const shown = (entry: Entry) => needle && !entry.entry.toLowerCase().includes(needle) && !(ENTRY_NOTES[entry.entry] ?? "").toLowerCase().includes(needle)
    ? entry.exports.filter((item) => item.name.toLowerCase().includes(needle)) : entry.exports;
  const groups = [{ name: "@ikhmalputra/subsurface-core", note: "Data, contracts and calculations. No DOM, no React.", entries: coreEntries }, { name: "@ikhmalputra/subsurface-react", note: "Views and scenes. Peers: react 19.3, react-dom 19.3, three 0.186.", entries: reactEntries }];
  return <>
    <label className="dv-search"><Search size={16} aria-hidden="true" /><input type="search" placeholder="Search entry points and exports: casing, parseLas, LogTracks…" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search the API reference" /></label>
    {groups.map((group) => {
      const entries = group.entries.filter(matches);
      return <div key={group.name} className="dv-ref-group">
        <header><h3>{group.name}</h3><p>{group.note}</p></header>
        {entries.length === 0 && <p className="dv-empty">Nothing here matches “{query}”.</p>}
        <div className="dv-ref-list">{entries.map((entry) => {
          const items = shown(entry);
          const expanded = open === entry.entry || (!!needle && items.length <= 24);
          return <article key={entry.entry} className="dv-ref">
            <header><code>{entry.entry.replace("@ikhmalputra/", "")}</code><span>{entry.defaultOnly ? "default export" : `${entry.exports.length} exports`}</span></header>
            <p>{ENTRY_NOTES[entry.entry] ?? ""}</p>
            {items.length > 0 && <div className="dv-ref-items">
              {(expanded ? items : items.slice(0, 12)).map((item) => <span key={item.name} className={`dv-ref-item is-${item.kind}`} title={item.kind}><i aria-hidden="true">{item.kind === "component" ? "<>" : item.kind === "hook" ? "use" : item.kind === "function" ? "ƒ" : item.kind === "class" ? "C" : "="}</i>{item.name}</span>)}
              {!expanded && items.length > 12 && <button type="button" className="dv-more" onClick={() => setOpen(entry.entry)}>+{items.length - 12} more</button>}
            </div>}
          </article>;
        })}</div>
      </div>;
    })}
    <p className="dv-ref-key"><span className="dv-ref-item is-function"><i>ƒ</i>function</span><span className="dv-ref-item is-component"><i>&lt;&gt;</i>component</span><span className="dv-ref-item is-hook"><i>use</i>hook</span><span className="dv-ref-item is-class"><i>C</i>class</span><span className="dv-ref-item is-value"><i>=</i>constant or data</span>Types ship beside each entry in <code>dist/*.d.ts</code>.</p>
  </>;
}

/** Highlights the nav link of the section in view. */
function useSectionInView(ids: readonly string[]) {
  const [current, setCurrent] = useState<string | null>(null);
  const seen = useRef(new Map<string, boolean>());
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) seen.current.set(entry.target.id, entry.isIntersecting);
      setCurrent(ids.find((id) => seen.current.get(id)) ?? null);
    }, { rootMargin: "-40% 0px -55% 0px" });
    for (const id of ids) { const element = document.getElementById(id); if (element) observer.observe(element); }
    return () => observer.disconnect();
  }, [ids]);
  return current;
}

const NAV = [["install", "Install"], ["fit", "How it fits"], ["examples", "Examples"], ["integrate", "Integrate"], ["reference", "Reference"]] as const;
const NAV_IDS = NAV.map(([id]) => id);

export function Developers() {
  const current = useSectionInView(NAV_IDS);
  // data-sw-theme: the SDK's own dark theme for its views, refined by the variables in developers.css.
  return <div className="lp dv" data-sw-theme="dark">
    <nav className="lp-nav" aria-label="Page">
      <a className="lp-brand" href={BASE}><span className="lp-mark" aria-hidden="true">S</span>Subsurface</a>
      <span className="dv-badge">Developers</span>
      <div className="lp-links">{NAV.map(([id, label]) => <a key={id} href={`#${id}`} aria-current={current === id ? "location" : undefined}>{label}</a>)}</div>
      <a className="lp-cta is-small" href={DECK}>Open the deck<ArrowRight size={15} aria-hidden="true" /></a>
    </nav>

    <header className="lp-hero dv-hero">
      <p className="lp-eyebrow">For developers</p>
      <h1>The deck is an SDK.<br /><span>Build your own.</span></h1>
      <p className="lp-lede">Everything in the deck comes from two TypeScript packages: the calculations, the parsers and every 2D and 3D view. Call the same code from your app, your server or a script.</p>
      <div className="lp-actions">
        <a className="lp-cta" href="#examples">Run the examples<ArrowRight size={17} aria-hidden="true" /></a>
        <a className="lp-ghost" href="#reference">API reference</a>
      </div>
      <dl className="lp-stats">
        <div><dt>2</dt><dd>packages: core (data and calculations) and react (views)</dd></div>
        <div><dt>{reference.length}</dt><dd>entry points, import only what you use</dd></div>
        <div><dt>{unique(coreEntries) + unique(reactEntries)}</dt><dd>exports, every one listed below</dd></div>
        <div><dt>28</dt><dd>deck modules built on them</dd></div>
      </dl>
    </header>

    <section className="lp-section" id="install" aria-labelledby="install-title">
      <div className="lp-head"><p className="lp-eyebrow">Install</p><h2 id="install-title">From a checkout to your first view</h2>
        <p>The packages are not on the npm registry yet. Until they are, install the packed tarballs: the same path <code>pnpm test:packages</code> checks on every run, installing both into an empty app with strict peer dependencies and rendering them.</p></div>
      <div className="dv-steps">
        <div className="dv-step"><span className="dv-step-n"><Terminal size={16} aria-hidden="true" /></span><div><h3>Pack and install</h3><p>Node 24 and pnpm, through corepack. React 19.3 and three.js 0.186 are peers.</p><Code source={INSTALL} label="terminal" language="sh" /></div></div>
        <div className="dv-step"><span className="dv-step-n"><Braces size={16} aria-hidden="true" /></span><div><h3>Import what you need</h3><p>Every entry point is its own module: a page that only computes surveys never loads three.js.</p><Code source={FIRST} label="app.tsx" /></div></div>
      </div>
    </section>

    <section className="lp-section" id="fit" aria-labelledby="fit-title">
      <div className="lp-head"><p className="lp-eyebrow">How it fits</p><h2 id="fit-title">Data in, calculations in the middle, views out, your app around it</h2>
        <p>The deck at <a href={DECK}>/deck/</a> is one app built this way: 28 modules over the same two packages you install.</p></div>
      <ol className="dv-layers">{LAYERS.map((layer, index) => <li key={layer.title} className="dv-layer">
        <layer.icon size={20} aria-hidden="true" />
        <h3>{layer.title}</h3><p>{layer.body}</p>
        <div>{layer.chips.map((chip) => <em key={chip}>{chip}</em>)}</div>
        {index < LAYERS.length - 1 && <ArrowRight className="dv-layer-arrow" size={18} aria-hidden="true" />}
      </li>)}</ol>
      <div className="dv-rules">{RULES.map((rule) => <div key={rule.title}><b>{rule.title}</b><p>{rule.body}</p></div>)}</div>
    </section>

    <section className="lp-section" id="examples" aria-labelledby="examples-title">
      <div className="lp-head"><p className="lp-eyebrow">Live examples</p><h2 id="examples-title">Read the code, then use what it made</h2>
        <p>Each example is one file you can copy into your app. The page imports that same file and runs it beside its source, so what you read is what you see working.</p></div>
      <Examples />
    </section>

    <section className="lp-section" id="integrate" aria-labelledby="integrate-title">
      <div className="lp-head"><p className="lp-eyebrow">Integrate</p><h2 id="integrate-title">Wiring it into your app</h2>
        <p>Three things every host app does, and three it usually asks about next.</p></div>
      <div className="dv-guides">
        <article className="dv-guide"><div><h3>Serve the models and the map</h3><p>Schematics and 3D scenes take an <code>assetBaseUrl</code>; the globe takes a <code>workerUrl</code>. Nothing is fetched from a CDN.</p></div><Code source={ASSETS} label="terminal" language="sh" /></article>
        <article className="dv-guide"><div><h3>Allow WebAssembly in your CSP</h3><p>The models are meshopt-compressed glTF; the decoder is WebAssembly. JavaScript <code>eval</code> stays blocked.</p></div><Code source={CSP} label="HTTP header" language="sh" /></article>
        <article className="dv-guide"><div><h3>Theme the views</h3><p>Views read CSS variables, so they sit in your design. Three themes are built in; override any variable to match your own.</p></div><Code source={THEME} label="theme" language="css" /></article>
        <article className="dv-guide"><div><h3>Link views through one store</h3><p>One depth, one well, one selection, shared by any number of views, inside React or out of it.</p></div><Code source={linkViewsSource} label="LinkViews.tsx" /></article>
        <article className="dv-guide"><div><h3>Bring your own data</h3><p>Validators turn untrusted JSON into typed snapshots or a precise error; parsers read LAS and SEG-Y files.</p></div><Code source={yourDataSource} label="yourData.ts" /></article>
        <article className="dv-guide"><div><h3>Run it on a server</h3><p>Core has no DOM and no React: screen a design in a Node script, a queue worker or an API route.</p></div><Code source={serverSource} label="server.ts" /></article>
      </div>
    </section>

    <section className="lp-section" id="reference" aria-labelledby="reference-title">
      <div className="lp-head"><p className="lp-eyebrow">API reference</p><h2 id="reference-title">Every entry point, every export</h2>
        <p>Generated from the built packages, not written by hand: a test fails when an export is added or removed and this list is not regenerated.</p></div>
      <Reference />
    </section>

    <footer className="lp-section dv-foot">
      <div><h2>See every view at work</h2><p>The deck is the largest example there is: open it, then find the module you want in this reference.</p></div>
      <a className="lp-cta" href={DECK}>Open the deck<ArrowRight size={17} aria-hidden="true" /></a>
      <p className="dv-fine">© 2026 Ikhmal Putra Manan. All rights reserved: using, copying or distributing the code needs written permission. Utah FORGE data adapted from McLennan et al. (2021) and the Geothermal Data Repository, CC BY 4.0. Engineering screening only; it does not replace a qualified well design.</p>
    </footer>
  </div>;
}
