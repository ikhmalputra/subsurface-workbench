import type { LucideIcon } from "lucide-react";
import {
  Activity, AlignHorizontalSpaceAround, Anchor, AudioLines, ArrowRight, AudioWaveform, Box, CalendarDays, Columns3, Command, Compass, Cylinder, Droplets, FilePen, Gauge, GitCompareArrows, Globe2, Layers, Layers2, Layers3,
  ListTree, Mountain, MousePointerClick, PencilRuler, Plus, Radar, Rotate3d, ScatterChart, ShieldAlert, ShieldCheck, Slice, TrendingDown, Waves,
} from "lucide-react";
import { Showcase3D } from "./Showcase3D.tsx";
import { BASE } from "../base.ts";

/**
 * The front door: Subsurface, discipline by discipline — seismic and geology, the rock, drilling and
 * well engineering, production — the tools in each, and how to use them. Everything here describes
 * the deck as it is built; the screenshots are the deck itself.
 */

const DECK = `${BASE}deck/`;

type Kind = "FORGE" | "NorthSea" | "Designs" | "Recorded" | "Equator" | "Anywhere";
interface Tool { readonly title: string; readonly icon: LucideIcon; readonly blurb: string; readonly on: readonly Kind[] }
interface Discipline { readonly name: string; readonly line: string; readonly tools: readonly Tool[] }
const DISCIPLINES: readonly Discipline[] = [
  { name: "Geophysics & geology", line: "The volume the wells sit in: seismic, horizons, formations, and where everything is.", tools: [
    { title: "Site in 3D", icon: Box, blurb: "Wells, horizons and reference levels in one frame; on FORGE, the seismic volume with inline, crossline and depth slices you drag; in the North Sea, each group top triangulated between the wells.", on: ["FORGE", "NorthSea", "Designs", "Recorded", "Equator"] },
    { title: "Correlation", icon: AlignHorizontalSpaceAround, blurb: "A field's wells side by side on their logs, the Directorate's tops joined from well to well. Flatten on any top, and pick your own beside theirs.", on: ["NorthSea"] },
    { title: "Well tie", icon: AudioLines, blurb: "The seismic a well's sonic and density predict, against the PSDM at FORGE 58-32: drag the synthetic onto its event, fit the shift and stretch, read the correlation.", on: ["FORGE"] },
    { title: "Horizons & faults", icon: Layers, blurb: "Click a reflector on a slice in 3D: it is tracked through FORGE's PSDM into a depth-coloured surface. Pick faults as sticks; the horizon stops at them and shows the throw.", on: ["FORGE"] },
    { title: "Seismic section", icon: AudioWaveform, blurb: "The PSDM along the well, or the inline and crossline you move in 3D, with the wells and formation tops drawn on it.", on: ["FORGE"] },
    { title: "Section line", icon: Slice, blurb: "Draw a line on the globe: the seismic along it, with every well that passes near.", on: ["FORGE"] },
    { title: "Globe", icon: Globe2, blurb: "Every located well and field on an offline globe; fly to a site or draw a section across it.", on: ["Anywhere"] },
  ] },
  { name: "Petrophysics", line: "What the logs say about the rock and what is in it.", tools: [
    { title: "Logs", icon: ListTree, blurb: "LAS curves on depth tracks: open-hole and mud logs, or files you import. Shift-drag to brush an interval.", on: ["FORGE", "NorthSea", "Recorded", "Equator"] },
    { title: "Petrophysics", icon: ScatterChart, blurb: "Shale volume, porosity, saturation and pay over the brushed interval; FORGE's granite read three ways, with its fractures.", on: ["FORGE", "Equator"] },
  ] },
  { name: "Geomechanics & pressure", line: "The stresses and pressures the hole has to stand in.", tools: [
    { title: "Geomechanics", icon: Mountain, blurb: "A 1D mechanical earth model: stresses, collapse and breakdown against the mud used.", on: ["FORGE"] },
    { title: "Pressure window", icon: Layers2, blurb: "Pore pressure, fracture gradient and the mud weights between them. Drag a mud weight to try it.", on: ["Designs"] },
  ] },
  { name: "Drilling", line: "Getting the hole to the target, safely, and what happened on the way.", tools: [
    { title: "Drilling record", icon: CalendarDays, blurb: "Days against depth, hole sections, runs and the daily reports.", on: ["FORGE"] },
    { title: "Torque & drag", icon: Anchor, blurb: "Soft-string hookload and torque, calibrated on the daily reports' string weights.", on: ["FORGE"] },
    { title: "Hydraulics", icon: Waves, blurb: "Bit pressure drop, jet velocity and annular velocity, with flow and nozzles you set.", on: ["Designs"] },
    { title: "Kick tolerance", icon: ShieldAlert, blurb: "The influx each shoe can take while drilling on.", on: ["Designs"] },
    { title: "Anti-collision", icon: Radar, blurb: "Separation to the neighbouring wells: ladder plot, travelling cylinder and the ISCWSA separation factor.", on: ["FORGE"] },
    { title: "Plan view", icon: Compass, blurb: "The path from above: north, east and closure, dogleg coloured.", on: ["FORGE", "NorthSea", "Designs", "Recorded", "Equator"] },
    { title: "Vertical section", icon: Activity, blurb: "Departure against TVD, with the formations.", on: ["FORGE", "NorthSea", "Designs", "Recorded", "Equator"] },
  ] },
  { name: "Well engineering & completions", line: "What is built in the hole, and whether it holds.", tools: [
    { title: "Well designer", icon: PencilRuler, blurb: "Plan a well stage by stage: place, datum, geology and pressures, trajectory, casing, cement, completion, checked live.", on: ["Designs"] },
    { title: "Construction", icon: Columns3, blurb: "The construction drawing, straight on depth or along the surveyed path.", on: ["FORGE", "Designs", "Recorded"] },
    { title: "Well section", icon: Layers3, blurb: "Construction, mud log and survey on one depth axis.", on: ["FORGE", "Designs", "Recorded"] },
    { title: "Well in 3D", icon: Rotate3d, blurb: "The well and its strings inside the seismic volume, with a log wrapped on the path.", on: ["FORGE", "Designs", "Recorded"] },
    { title: "Cutaway", icon: Cylinder, blurb: "The construction as a 3D cutaway of real component models.", on: ["FORGE", "Designs", "Recorded"] },
    { title: "Strings", icon: Gauge, blurb: "Each string's record and API ratings; on a design, burst, collapse and tension against them, live.", on: ["FORGE", "Designs", "Recorded"] },
    { title: "Cement", icon: Droplets, blurb: "Slurry volumes and the cement column against fracture.", on: ["Designs"] },
    { title: "Well barriers", icon: ShieldCheck, blurb: "Primary and secondary barrier envelopes, with what the records say of each element.", on: ["FORGE", "Designs", "Recorded"] },
  ] },
  { name: "Production", line: "What a field gives back, and how long it will keep giving.", tools: [
    { title: "Decline curves", icon: TrendingDown, blurb: "Arps decline fitted to any of 136 Norwegian fields' monthly production, forecast to an economic limit.", on: ["Anywhere"] },
  ] },
  { name: "Your data", line: "Bring your own wells in, change existing ones, and set them side by side.", tools: [
    { title: "Well editor", icon: FilePen, blurb: "Record a drilled well (survey, tops, casing, LAS logs) or edit an existing one over its record.", on: ["FORGE", "Recorded", "Equator"] },
    { title: "Compare wells", icon: GitCompareArrows, blurb: "Up to six wells side by side on one depth and one diameter scale, lined up by true depth below sea level.", on: ["Anywhere"] },
  ] },
];
const TOOL_COUNT = DISCIPLINES.reduce((sum, discipline) => sum + discipline.tools.length, 0);

const SIGNALS: readonly { readonly name: string; readonly colour: string; readonly line: string }[] = [
  { name: "Place", colour: "var(--signal-place)", line: "The site, the field, the well. Choose one anywhere and every module moves to it." },
  { name: "Object", colour: "var(--signal-object)", line: "A string, a shoe, a component. Select it in one view, it lights up in all of them." },
  { name: "Depth", colour: "var(--signal-depth)", line: "Point at a depth in any log, section or 3D view: every depth view follows the cursor." },
  { name: "Time", colour: "var(--signal-time)", line: "Replay FORGE 16A day by day: the hole deepens and the strings go in as the reports say." },
  { name: "View", colour: "var(--signal-view)", line: "Camera and slices: what the 3D site shows, the seismic section shows." },
  { name: "What-if", colour: "var(--signal-whatif)", line: "Try a change on a design. Every module shows the result before you apply it." },
];

const STORIES: readonly { readonly kicker: string; readonly title: string; readonly body: string; readonly steps: readonly string[]; readonly image: string; readonly alt: string }[] = [
  {
    kicker: "Geophysics & geology", title: "Seismic, horizons and wells in one frame", image: `${BASE}landing/forge.jpg`, alt: "Utah FORGE in the deck at 2,400 m: the open-hole logs, the site in 3D with the seismic volume, the well in 3D and the seismic along the well",
    body: "Utah FORGE's 3D seismic (anisotropic PSDM) with the granite reservoir top and the wells that drilled it. Move a slice in 3D and the seismic section follows; draw a line on the globe and get the section along it, with every well that passes near.",
    steps: ["Fly to Utah FORGE from the globe or ⌘K", "Drag the inline, crossline and depth slices in Site in 3D", "Draw a section line on the globe for a section through any wells"],
  },
  {
    kicker: "Petrophysics & geomechanics", title: "Read the rock", image: `${BASE}landing/rock.jpg`, alt: "FORGE 16A at 2,400 m: granite porosity three ways and fracture intensity, a 1D mechanical earth model against the mud used, and the open-hole logs",
    body: "Twenty-four open-hole curves on FORGE's granite: porosity three ways, fracture intensity from the image log, a mechanical earth model calibrated on 58-32's stresses that says where the hole collapses or breaks down. On the Equator field: shale volume, porosity, saturation and net pay over any interval you brush.",
    steps: ["Open Logs, Petrophysics and Geomechanics side by side", "Shift-drag the logs to brush an interval", "Every tile reads the same depth: hover once, read everywhere"],
  },
  {
    kicker: "Drilling & well engineering", title: "Plan a well from the pore pressure up", image: `${BASE}landing/designer.jpg`, alt: "The Well designer on the casing stage, each string with its burst, collapse, tension and kick-tolerance checks",
    body: "Place a well anywhere, enter the formations and the pore and fracture pressures, draw the trajectory, and the casing is proposed from the pressure window. Edit any string: safety factors, kick tolerance, cement and hydraulics update as you type, and every other module redraws.",
    steps: ["Press + New well, name it and place it", "Fill each stage; the rail shows what is still missing", "Propose the casing, then regrade or edit string by string"],
  },
  {
    kicker: "Your data", title: "Bring your own wells in", image: `${BASE}landing/editor.jpg`, alt: "The Well editor on FORGE 16A: each record marked with its source page, one edited string with a revert button",
    body: "Record a drilled well: paste the survey straight from a spreadsheet or a contractor's report, add the formation tops and the casing as run, import LAS logs. Or edit an existing well: the record is never overwritten, every row says whether it is the record's or yours, and any edit reverts.",
    steps: ["New well → Record a drilled well, or Edit on the place chip", "Paste the survey: columns and units are read from the header", "Every change is a named step: ⌘Z to undo"],
  },
  {
    kicker: "Across the field", title: "Wells side by side, on the geology", image: `${BASE}landing/compare.jpg`, alt: "Compare wells: five FORGE wells side by side on true depth below sea level, strings matched by colour",
    body: "Up to six wells next to each other on one depth scale and one diameter scale. On true depth below sea level, FORGE's five wells line up on the same granite; strings are matched by role and the table reads each one against a reference well.",
    steps: ["Open Compare wells and add the wells", "Switch to TVDSS to line them up on the geology", "Click a string to light it in every well"],
  },
  {
    kicker: "Production", title: "Decline, field by field", image: `${BASE}landing/decline.jpg`, alt: "Decline curves: Statfjord's monthly oil since 1979 on a log scale, an Arps fit over the last ten years and its forecast to the economic limit",
    body: "Arps decline on the Norwegian Offshore Directorate's monthly production for 136 fields. Choose the months to fit by dragging across them; the remaining and ultimate volumes follow, and the forecast runs on to the economic limit you set.",
    steps: ["Open Decline curves and pick a field", "Drag across the months to fit", "Set an economic limit to read the remaining volume"],
  },
];

const START: readonly { readonly icon: LucideIcon; readonly title: string; readonly body: string }[] = [
  { icon: Globe2, title: "Pick a place", body: "Click a site on the globe, or press ⌘K and type “fly to utah”. The site opens in 3D." },
  { icon: MousePointerClick, title: "Open modules", body: "The dock on the left holds every tool: click to open, drag onto the deck to place it, pull a corner to resize." },
  { icon: Layers3, title: "Follow a depth", body: "Hover any log, section or 3D well: the depth cursor moves everywhere. Click to pin it; Shift-drag a log to brush an interval." },
  { icon: Columns3, title: "Select a string", body: "Click a casing in any drawing: it is selected in every view, with its record and ratings." },
  { icon: Plus, title: "Make a well", body: "+ New well plans one in the Well designer, or records a drilled one in the Well editor." },
  { icon: Command, title: "Command everything", body: "⌘K finds any module, well, string or command: “open logs”, “depth 2500”, “day 23”." },
];

const KEYS: readonly { readonly keys: readonly string[]; readonly does: string }[] = [
  { keys: ["⌘", "K"], does: "Fly, find, open or command" },
  { keys: ["⌥"], does: "Hold to see every live link between modules" },
  { keys: ["⌘", "Z"], does: "Undo a design or record step (⇧⌘Z to redo)" },
  { keys: ["⌘", "↵"], does: "Apply a what-if (Esc discards it)" },
  { keys: ["⇧", "drag"], does: "Brush a depth interval on the logs" },
  { keys: ["⌘", "wheel"], does: "Zoom a depth view (wheel pans)" },
];

const SOURCES: readonly { readonly what: string; readonly from: string; readonly badge: "documented" | "synthetic" | "user-authored" }[] = [
  { what: "3D seismic, anisotropic PSDM", from: "Utah FORGE 2018–19 reflection processing", badge: "documented" },
  { what: "16A open-hole logs, 24 curves", from: "GDR 1292, Schlumberger", badge: "documented" },
  { what: "58-32 calibrated stresses", from: "GDR 1032", badge: "documented" },
  { what: "Utah FORGE 16A(78)-32: survey, construction, daily reports", from: "DOE Geothermal Data Repository, GDR 1283 (CC BY 4.0)", badge: "documented" },
  { what: "16B, 58-32, 56-32, 78-32, 78B-32 construction and surveys", from: "End-of-well reports, GDR 1516 · 1006 · 1295 · 1153 · 1330", badge: "documented" },
  { what: "118 Norwegian North Sea wells: logs, group and formation tops, casing shoes", from: "FORCE 2020 (Zenodo 4351156, CC BY 4.0), the Norwegian Offshore Directorate's data (NLOD)", badge: "documented" },
  { what: "Lithology for those wells", from: "The FORCE 2020 competition's interpretation", badge: "documented" },
  { what: "Monthly production of 136 Norwegian fields", from: "Norwegian Offshore Directorate (Sodir) FactPages, NLOD", badge: "documented" },
  { what: "The Equator field: wells, horizons, contacts and logs", from: "A synthetic field for petrophysics", badge: "synthetic" },
  { what: "Kestrel A-7, an offshore development well", from: "The deck's example design brief", badge: "synthetic" },
  { what: "Wells you plan, record or edit", from: "Kept in your browser; export them as files", badge: "user-authored" },
];

export function Landing() {
  return <div className="lp">
    <nav className="lp-nav" aria-label="Page">
      <a className="lp-brand" href={BASE}><span className="lp-mark" aria-hidden="true">S</span>Subsurface</a>
      <div className="lp-links"><a href="#disciplines">Disciplines</a><a href="#in-3d">3D</a><a href="#build">What it does</a><a href="#tools">Tools</a><a href="#start">How to use it</a><a href="#data">Data</a><a href={`${BASE}developers/`}>Developers</a></div>
      <a className="lp-cta is-small" href={DECK}>Open the deck<ArrowRight size={15} aria-hidden="true" /></a>
    </nav>

    <header className="lp-hero">
      <p className="lp-eyebrow">Subsurface, end to end</p>
      <h1>The whole subsurface,<br /><span>moving together.</span></h1>
      <p className="lp-lede">Seismic and geology, petrophysics, geomechanics, drilling, well engineering and production in one live deck: {TOOL_COUNT} linked modules that follow one place, one depth, one moment and one selection, on real public data.</p>
      <div className="lp-actions">
        <a className="lp-cta" href={DECK}>Open the deck<ArrowRight size={17} aria-hidden="true" /></a>
        <a className="lp-ghost" href="#start">How to use it</a>
      </div>
      <figure className="lp-shot is-hero"><img src={`${BASE}landing/deck.jpg`} alt="The deck on Utah FORGE: globe, site in 3D with seismic, well section and logs, linked by one depth cursor" width={1440} height={1000} /></figure>
      <dl className="lp-stats">
        <div><dt>{DISCIPLINES.length}</dt><dd>subsurface disciplines in one deck</dd></div>
        <div><dt>{TOOL_COUNT}</dt><dd>linked modules</dd></div>
        <div><dt>3D</dt><dd>PSDM seismic volume, 2.75 × 1.52 km, with the wells inside it</dd></div>
        <div><dt>0</dt><dd>values invented: unknowns read “not reported”</dd></div>
      </dl>
    </header>

    <section className="lp-section" id="disciplines" aria-labelledby="disciplines-title">
      <div className="lp-head"><p className="lp-eyebrow">One subsurface</p><h2 id="disciplines-title">{DISCIPLINES.length} disciplines, one place, one depth</h2>
        <p>From the seismic volume to the barrels a field gives back. Each discipline has its own tools; all of them share the same site, the same depth, the same moment and the same selection.</p></div>
      <div className="lp-disciplines">{DISCIPLINES.map((discipline) => <a key={discipline.name} className="lp-discipline" href="#tools">
        <i aria-hidden="true" /><b>{discipline.name}</b><p>{discipline.line}</p>
        <span>{discipline.tools.map((tool) => <em key={tool.title}>{tool.title}</em>)}</span>
      </a>)}</div>
    </section>

    <Showcase3D />

    <section className="lp-section" aria-labelledby="signals">
      <div className="lp-head"><p className="lp-eyebrow">The idea</p><h2 id="signals">Six signals, one deck</h2>
        <p>Modules don't talk to each other directly. They share six signals, each with one colour, used for nothing else. Hold ⌥ in the deck to see every link.</p></div>
      <div className="lp-signals">{SIGNALS.map((signal) => <div key={signal.name} className="lp-signal" style={{ ["--c" as string]: signal.colour }}><i aria-hidden="true" /><b>{signal.name}</b><p>{signal.line}</p></div>)}</div>
    </section>

    <section className="lp-section" id="build" aria-label="What it does">
      {STORIES.map((story, index) => <article key={story.title} className={`lp-story${index % 2 ? " is-flipped" : ""}`}>
        <div className="lp-story-text">
          <p className="lp-eyebrow">{story.kicker}</p>
          <h2>{story.title}</h2>
          <p>{story.body}</p>
          <ol>{story.steps.map((step) => <li key={step}>{step}</li>)}</ol>
        </div>
        <figure className="lp-shot"><img src={story.image} alt={story.alt} loading="lazy" width={1358} height={860} /></figure>
      </article>)}
    </section>

    <section className="lp-section" id="tools" aria-labelledby="tools-title">
      <div className="lp-head"><p className="lp-eyebrow">The tools</p><h2 id="tools-title">{TOOL_COUNT} modules across {DISCIPLINES.length} disciplines</h2>
        <p>Every module lives in the dock. Each says what it works on; where a site lacks the data, the tile says what is missing instead of guessing.</p></div>
      <div className="lp-groups">{DISCIPLINES.map((group) => <div key={group.name} className="lp-group">
        <header><h3>{group.name}</h3><p>{group.line}</p></header>
        <div className="lp-tools">{group.tools.map((tool) => <div key={tool.title} className="lp-tool">
          <tool.icon size={20} strokeWidth={1.6} aria-hidden="true" />
          <b>{tool.title}</b>
          <p>{tool.blurb}</p>
          <span className="lp-on">{tool.on.map((kind) => <em key={kind} className={`is-${kind.toLowerCase()}`}>{kind === "Designs" ? "Planned wells" : kind === "Recorded" ? "Wells you record" : kind === "NorthSea" ? "North Sea wells" : kind}</em>)}</span>
        </div>)}</div>
      </div>)}</div>
    </section>

    <section className="lp-section" id="start" aria-labelledby="start-title">
      <div className="lp-head"><p className="lp-eyebrow">How to use it</p><h2 id="start-title">Six moves and you know the deck</h2></div>
      <ol className="lp-start">{START.map((step, index) => <li key={step.title}><span className="lp-step-n">{index + 1}</span><step.icon size={20} strokeWidth={1.6} aria-hidden="true" /><b>{step.title}</b><p>{step.body}</p></li>)}</ol>
      <div className="lp-keys">
        <h3>Shortcuts</h3>
        <ul>{KEYS.map((key) => <li key={key.does}><span>{key.keys.map((part) => <kbd key={part}>{part}</kbd>)}</span>{key.does}</li>)}</ul>
        <p>On Windows and Linux, Ctrl stands in for ⌘ and Alt for ⌥.</p>
      </div>
    </section>

    <section className="lp-section" id="data" aria-labelledby="data-title">
      <div className="lp-head"><p className="lp-eyebrow">The data</p><h2 id="data-title">Where every number comes from</h2>
        <p>Every volume, well, curve and string carries its provenance. Documented values cite their source and page; where a report contradicts itself, both figures are shown. Nothing missing is filled in.</p></div>
      <div className="lp-badges"><span className="lp-badge is-documented">Documented</span>from public records<span className="lp-badge is-synthetic">Synthetic</span>made to show a workflow<span className="lp-badge is-user-authored">User-authored</span>entered by you</div>
      <table className="lp-sources"><tbody>{SOURCES.map((source) => <tr key={source.what}><td><span className={`lp-badge is-${source.badge}`}>{source.badge === "user-authored" ? "User-authored" : source.badge[0]!.toUpperCase() + source.badge.slice(1)}</span></td><th>{source.what}</th><td>{source.from}</td></tr>)}</tbody></table>
    </section>

    <footer className="lp-foot">
      <h2>Open the deck and fly to Utah FORGE.</h2>
      <p>It runs in your browser. Wells you plan, record or edit stay in this browser until you export them.</p>
      <a className="lp-cta" href={DECK}>Open the deck<ArrowRight size={17} aria-hidden="true" /></a>
      <small>Data: Utah FORGE via the DOE Geothermal Data Repository (CC BY 4.0) · Norwegian Offshore Directorate FactPages (NLOD) · Natural Earth basemap.</small>
    </footer>
  </div>;
}
