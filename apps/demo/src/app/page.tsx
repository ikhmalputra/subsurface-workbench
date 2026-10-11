import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "../components/showcase";
import { DemoAppearance } from "../components/demo-appearance";

export const metadata: Metadata = { title: "Subsurface SDK · showcase" };

const parts = ["christmas-tree", "wellhead", "safety-valve", "gas-lift-mandrel", "packer", "landing-nipple", "gauge", "float-shoe"];

const capabilities = [
  { href: "/view-well/", title: "View well", tag: "2.5D + 3D construction", image: "/well-components/wellhead.png", body: "Turn any well record into a WellView-style construction schematic and a lit 3D cutaway with one adapter call, bend the section along the surveyed path, or search every record.", imports: ["wellComponentsToAssembly", "AssemblySchematic", "AssemblyScene"] },
  { href: "/builder/", title: "Well builder", tag: "Plug-and-play design", image: "/well-components/packer.png", body: "Drag Blender-rendered components from a catalog onto the schematic or the 3D scene; placement is validated as you build.", imports: ["ComponentPalette", "AssemblyInspector", "placeComponent", "validateAssembly"] },
  { href: "/trajectory/", title: "3D trajectory", tag: "Survey + geology", image: "/well-components/production-casing.png", body: "Nested casing cutaways along the surveyed path inside a formation block. Click the path to probe depth and select.", imports: ["WellScene", "TrajectorySectionView", "BuildHoldForm"] },
  { href: "/analysis/", title: "Engineering studies", tag: "Evidence + findings", image: "/well-components/packer.png", body: "Define a drilling investigation, check source inputs, compare explicit intervals and save findings with supporting evidence and uncertainty.", imports: ["WellOperations", "LasFile", "useDepthLink"] },
  { href: "/well-report/", title: "Well report", tag: "Interactive + print", image: "/well-components/wellhead.png", body: "Render a host-owned report spec with sourced figures, explicit units, unknown values, linked depths, and a print-ready static layout.", imports: ["WellReportSpec", "validateWellReportSpec", "WellReportView"] },
] as const;

const packages = [
  ["@ikhmalputra/subsurface-core", "Well records, fixtures, assembly catalog and placement rules"],
  ["@ikhmalputra/subsurface-core/trajectory", "Minimum curvature, build-and-hold planner, survey validation"],
  ["@ikhmalputra/subsurface-core/records", "Daily history, service runs, hole sections, LAS 2.0 parser"],
  ["@ikhmalputra/subsurface-core/seismic", "SEG-Y rev 0/1/2 parser, IBM/IEEE decode, section projection"],
  ["@ikhmalputra/subsurface-core/well-design", "Brief, casing scheme, API 5C3 ratings, cement, design checks"],
  ["@ikhmalputra/subsurface-react", "ComponentInventory — searchable, paged record list"],
  ["@ikhmalputra/subsurface-react/assembly", "AssemblySchematic, ComponentPalette, AssemblyInspector"],
  ["@ikhmalputra/subsurface-react/assembly-three", "AssemblyScene — Blender GLB cutaway (three.js)"],
  ["@ikhmalputra/subsurface-react/schematic", "CurvedSchematic — construction drawn along the survey"],
  ["@ikhmalputra/subsurface-react/viewport", "InteractiveViewport — pan, zoom and fit"],
  ["@ikhmalputra/subsurface-react/trajectory", "Plan, section, log, survey table and build-and-hold form"],
  ["@ikhmalputra/subsurface-react/three", "WellScene — 3D trajectory (three.js)"],
  ["@ikhmalputra/subsurface-react/records", "Well history, days vs depth, run log, section log, log tracks"],
  ["@ikhmalputra/subsurface-react/seismic", "Seismic section with well overlay, SEG-Y header panel"],
  ["@ikhmalputra/subsurface-react/well-design", "Brief editors, pressure window, casing and cement tables"],
  ["@ikhmalputra/subsurface-react/examples", "Reference compositions — copy, don't depend"],
] as const;

export default function Home() {
  return <DemoAppearance navigation={<SiteNav current="/" />}>
    <div className="demo-home">
      <section className="demo-hero">
        <div>
          <p className="demo-eyebrow">Open SDK · well engineering visuals</p>
          <h1>Start with the well. Keep its context.</h1>
          <p className="demo-lede">Open the construction schematic first, inspect its records and trajectory, then review the available report. Well, component, depth and appearance stay with you across compatible views. Separate synthetic analysis examples are explicitly isolated from your active well.</p>
          <div className="demo-cta">
            <Link className="demo-button demo-button-primary" href="/view-well/">Open well workspace</Link>
            <Link className="demo-button" href="/builder/">Assemble one</Link>
          </div>
          <pre className="demo-install" tabIndex={0} aria-label="Install command"><code>pnpm add @ikhmalputra/subsurface-core @ikhmalputra/subsurface-react three</code></pre>
        </div>
        <div className="demo-hero-parts" aria-label="Rendered component catalog">
          {parts.map((part) => <figure key={part}>
            <img src={`/well-components/${part}.png`} alt="" />
            <figcaption>{part.replaceAll("-", " ")}</figcaption>
          </figure>)}
        </div>
      </section>

      <section aria-labelledby="capabilities">
        <h2 id="capabilities" className="demo-section-title">Capabilities</h2>
        <ul className="demo-cards">
          {capabilities.map((card) => <li key={card.href}>
            <Link href={card.href} className="demo-card" data-testid="capability-card">
              <img src={card.image} alt="" />
              <span className="demo-card-tag">{card.tag}</span>
              <span className="demo-card-title">{card.title}</span>
              <span className="demo-card-body">{card.body}</span>
              <span className="demo-card-imports">{card.imports.map((name) => <code key={name}>{name}</code>)}</span>
              <span className="demo-card-go" aria-hidden="true">Open example →</span>
            </Link>
          </li>)}
        </ul>
      </section>

      <section aria-labelledby="packages" className="demo-packages">
        <h2 id="packages" className="demo-section-title">Entry points</h2>
        <p className="demo-lede">Each entry point is tree-shakeable on its own; three.js is only pulled in by the two scene entries.</p>
        <table>
          <thead><tr><th scope="col">Import</th><th scope="col">Provides</th></tr></thead>
          <tbody>{packages.map(([name, provides]) => <tr key={name}><td><code>{name}</code></td><td>{provides}</td></tr>)}</tbody>
        </table>
      </section>
      <footer className="demo-foot">Synthetic examples are not engineering approval. FORGE 16A(78)-32 records cite public reports; nothing is invented.</footer>
    </div>
  </DemoAppearance>;
}
