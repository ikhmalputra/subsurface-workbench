import { useEffect, useMemo, useRef, useState } from "react";
import { scaleLinear } from "d3-scale";
import { Plus, Star, X } from "lucide-react";
import { mdAtSurveyTvd, tvdAtSurveyMd } from "@ikhmalputra/subsurface-core";
import type { WellComponent } from "@ikhmalputra/subsurface-core";
import { formatInches } from "@ikhmalputra/subsurface-react/2d";
import { useComparableWells, type ComparableWell } from "../data/wells.ts";
import { fmt } from "../format.ts";
import { useSize } from "./useSize.ts";
import { useWire } from "./wire.ts";

/**
 * Wells side by side: each construction drawn to one depth scale and one diameter scale, so a
 * deeper shoe sits lower and a bigger hole is wider whichever column it is in. Strings are matched
 * by their role (conductor, surface, intermediate, production, liner, tubing) and keep one colour in
 * every well; choosing one lights it in all of them and in the table, which reads each string's
 * records against the reference well (the first column).
 */

type Axis = "md" | "tvd" | "tvdss";
const AXIS_NAME: Readonly<Record<Axis, string>> = { md: "MD", tvd: "TVD", tvdss: "TVDSS" };
const AXIS_HELP: Readonly<Record<Axis, string>> = {
  md: "measured along each hole from its own depth reference",
  tvd: "vertical depth below each well's own depth reference",
  tvdss: "vertical depth below mean sea level: wells in one field line up on their geology",
};
const MAX_WELLS = 6;
const KEY = "deck-compare";

type Role = "conductor" | "surface" | "intermediate" | "intermediate-2" | "intermediate-3" | "production" | "liner" | "tubing";
const ROLES: readonly Role[] = ["conductor", "surface", "intermediate", "intermediate-2", "intermediate-3", "production", "liner", "tubing"];
const ROLE_NAME: Readonly<Record<Role, string>> = {
  conductor: "Conductor", surface: "Surface casing", intermediate: "Intermediate casing", "intermediate-2": "2nd intermediate", "intermediate-3": "3rd intermediate",
  production: "Production casing", liner: "Liner", tubing: "Tubing",
};
/** One colour per role in every well, clear of the six signal colours. */
const ROLE_COLOUR: Readonly<Record<Role, string>> = {
  conductor: "#8b95ad", surface: "#2bb39a", intermediate: "#4f7cf0", "intermediate-2": "#8ea6ff", "intermediate-3": "#b8c4ff",
  production: "#d9603b", liner: "#c9a227", tubing: "#e6d36a",
};

const IN_PER_MM = 1 / 25.4;
const inches = (mm: number | null) => mm === null ? null : mm * IN_PER_MM;

interface Stored { readonly ids: readonly string[]; readonly axis: Axis }
function stored(): Stored | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null") as Stored | null;
    return value && Array.isArray(value.ids) && (["md", "tvd", "tvdss"] as const).includes(value.axis) ? value : null;
  } catch { return null; }
}
function store(value: Stored) { try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* not kept */ } }

/** The strings by role: casing named for its role, else placed by its shoe; tubing is tubing. */
function rolesOf(components: readonly WellComponent[]) {
  const casings = components.filter((component) => component.kind === "Casing").sort((a, b) => a.bottomDepthM - b.bottomDepthM);
  const roles = new Map<string, Role>();
  let intermediate = 0;
  casings.forEach((casing, index) => {
    const name = casing.name.toLowerCase();
    const role: Role = /conductor/.test(name) ? "conductor" : /surface/.test(name) ? "surface" : /liner/.test(name) ? "liner" : /production/.test(name) ? "production"
      : /intermediate/.test(name) ? (["intermediate", "intermediate-2", "intermediate-3"] as const)[Math.min(2, intermediate++)]!
      : index === casings.length - 1 ? "production" : index === 0 ? "surface" : (["intermediate", "intermediate-2", "intermediate-3"] as const)[Math.min(2, intermediate++)]!;
    if (![...roles.values()].includes(role)) roles.set(casing.id, role);
  });
  const tubing = components.find((component) => component.kind === "Tubular");
  if (tubing) roles.set(tubing.id, "tubing");
  return roles;
}

/** A well as the comparison reads it: its strings by role and its depths on the chosen axis. */
function build(well: ComparableWell, axis: Axis) {
  const roles = rolesOf(well.components);
  const strings = well.components.filter((component) => roles.has(component.id)).map((component) => ({ component, role: roles.get(component.id)! }));
  const holes = well.components.filter((component) => component.kind === "Hole" && component.outerDiameterMm !== null);
  const holeAt = (mdM: number) => holes.find((hole) => hole.topDepthM <= mdM && hole.bottomDepthM >= mdM) ?? null;
  const casings = strings.filter((entry) => entry.role !== "tubing");
  const cementOf = (casing: WellComponent) => well.components.find((component) => component.kind === "Cement" && component.parentId === casing.id)
    ?? well.components.find((component) => component.kind === "Cement" && !component.parentId && Math.abs(component.bottomDepthM - casing.bottomDepthM) < 1) ?? null;
  const stations = well.stations;
  const last = stations.at(-1) ?? null;
  // Below the last station TVD runs on along the last inclination: drawn, and said, as a projection.
  const tvdOf = (mdM: number): number | null => {
    if (!stations.length) return null;
    const tvd = tvdAtSurveyMd(stations, mdM);
    if (tvd !== null) return tvd;
    if (mdM < stations[0]!.mdM) return stations[0]!.tvdM - (stations[0]!.mdM - mdM);
    return last!.tvdM + (mdM - last!.mdM) * Math.cos(last!.inclinationDeg * Math.PI / 180);
  };
  const mdOfTvd = (tvdM: number): number | null => {
    if (!stations.length) return null;
    const md = mdAtSurveyTvd(stations, tvdM);
    if (md !== null) return md;
    if (tvdM < stations[0]!.tvdM) return stations[0]!.mdM - (stations[0]!.tvdM - tvdM);
    const cos = Math.cos(last!.inclinationDeg * Math.PI / 180);
    return cos > 0.02 ? last!.mdM + (tvdM - last!.tvdM) / cos : null;
  };
  const elevation = well.datum.elevationMslM;
  const can = axis === "md" || (stations.length > 1 && (axis === "tvd" || elevation !== null));
  const at = (mdM: number): number | null => {
    if (axis === "md") return mdM;
    const tvd = tvdOf(mdM);
    return tvd === null ? null : axis === "tvd" ? tvd : elevation === null ? null : tvd - elevation;
  };
  const mdAt = (value: number): number | null => axis === "md" ? value : mdOfTvd(axis === "tvd" ? value : value + (elevation ?? 0));
  const fromTvd = (tvdM: number): number | null => axis === "md" ? mdOfTvd(tvdM) : axis === "tvd" ? tvdM : elevation === null ? null : tvdM - elevation;
  const projectedBelowMdM = last && well.totalDepthM > last.mdM + 1 ? last.mdM : null;
  const maxInc = stations.reduce((best, station) => station.inclinationDeg > best.inc ? { inc: station.inclinationDeg, md: station.mdM } : best, { inc: 0, md: 0 });
  const deepestShoe = Math.max(0, ...casings.map((entry) => entry.component.bottomDepthM));
  const radiusIn = Math.max(0, ...well.components.filter((component) => component.kind === "Casing" || component.kind === "Hole" || component.kind === "Tubular").map((component) => (inches(component.outerDiameterMm) ?? 0) / 2));
  return { well, strings, casings, holes, holeAt, cementOf, at, mdAt, fromTvd, can, tvdOf, projectedBelowMdM, maxInc, deepestShoe, radiusIn };
}
type Built = ReturnType<typeof build>;

/** What is at a depth in a well: the innermost string there, the one around it, the hole, the formation. */
function readAt(built: Built, mdM: number | null) {
  if (mdM === null || mdM < 0) return "above the depth reference";
  if (mdM > built.well.totalDepthM + 0.5) return `below TD (${fmt(built.well.totalDepthM)} m MD)`;
  const here = built.strings.filter((entry) => entry.component.topDepthM <= mdM && entry.component.bottomDepthM >= mdM)
    .sort((a, b) => (a.component.outerDiameterMm ?? 0) - (b.component.outerDiameterMm ?? 0));
  const hole = built.holeAt(mdM);
  const tvd = built.tvdOf(mdM);
  const formation = tvd === null ? null : built.well.formations.find((layer) => layer.topTvdM <= tvd && layer.bottomTvdM > tvd) ?? null;
  const pipe = here.length ? here.map((entry) => formatInches(inches(entry.component.outerDiameterMm))).join(" in ") : hole ? "open hole" : "no string recorded";
  return `${fmt(mdM)} m MD · ${pipe}${hole ? ` · ${formatInches(inches(hole.outerDiameterMm))} hole` : ""}${formation ? ` · ${formation.name}` : ""}`;
}

export function Compare() {
  const wire = useWire("compare");
  const { wells, unavailable } = useComparableWells();
  const saved = useMemo(stored, []);
  const placeWell = wire.place?.wellId ?? null;
  const [ids, setIds] = useState<readonly string[]>(() => {
    const known = saved?.ids.filter((id) => wells.some((well) => well.id === id)) ?? [];
    if (known.length) return known;
    // The deck's own well first, then its neighbours on the same site, then the rest.
    const first = wells.find((well) => well.id === placeWell);
    const rest = wells.filter((well) => well !== first).sort((a, b) => Number(b.site === first?.site) - Number(a.site === first?.site));
    return [...(first ? [first] : []), ...rest].slice(0, 3).map((well) => well.id);
  });
  const [axis, setAxisState] = useState<Axis>(saved?.axis ?? "md");
  useEffect(() => store({ ids, axis }), [ids, axis]);
  const [adding, setAdding] = useState(false);
  const [role, setRole] = useState<Role | null>(null);
  const shown = useMemo(() => ids.map((id) => wells.find((well) => well.id === id)).filter((well): well is ComparableWell => !!well), [ids, wells]);
  const built = useMemo(() => shown.map((well) => build(well, axis)), [shown, axis]);
  const add = (id: string) => { setIds((current) => current.includes(id) || current.length >= MAX_WELLS ? current : [...current, id]); setAdding(false); };
  const remove = (id: string) => setIds((current) => current.filter((value) => value !== id));
  const makeReference = (id: string) => setIds((current) => [id, ...current.filter((value) => value !== id)]);
  const [view, setView] = useState<readonly [number, number] | null>(null);
  const setAxis = (next: Axis) => { setAxisState(next); setView(null); };
  const blocked = built.filter((entry) => !entry.can);
  const drawable = built.filter((entry) => entry.can);
  const others = wells.filter((well) => !ids.includes(well.id));

  return <div className="cmp">
    <header className="acx-head cmp-head">
      <div className="cmp-add">
        <button type="button" className="cmp-add-button" aria-expanded={adding} disabled={ids.length >= MAX_WELLS} onClick={() => setAdding((open) => !open)}><Plus size={14} aria-hidden="true" /> Add well</button>
        {adding && <div className="cmp-menu" role="menu">
          {others.map((well) => <button key={well.id} type="button" role="menuitem" onClick={() => add(well.id)}>
            <b>{well.label}</b><small>{well.site} · {well.status}</small><span className={`badge is-${well.provenance}`}>{well.provenance}</span>
          </button>)}
          {!others.length && <p className="cmp-menu-note">Every well with a construction is on the comparison.</p>}
          {unavailable.length > 0 && <p className="cmp-menu-note">Not comparable: {unavailable.map((well) => well.label).join(", ")} ({unavailable[0]!.site}). {unavailable[0]!.why}</p>}
        </div>}
      </div>
      <span className="log-sets" role="group" aria-label="Depth axis">
        {(["md", "tvd", "tvdss"] as const).map((key) => <button key={key} type="button" aria-pressed={axis === key} title={AXIS_HELP[key]} onClick={() => setAxis(key)}>{AXIS_NAME[key]}</button>)}
      </span>
      {view && <button type="button" className="cmp-fit" onClick={() => setView(null)}>Whole wells</button>}
      <span className="cmp-hint" title={`${AXIS_NAME[axis]}: ${AXIS_HELP[axis]}`}>{AXIS_NAME[axis]}: {AXIS_HELP[axis]} · ⌘/Ctrl + wheel zooms</span>
    </header>
    {blocked.length > 0 && <p className="curtain-head">{blocked.map((entry) => entry.well.label).join(", ")}: no {axis === "tvdss" ? "datum elevation" : "survey"} in the records, so not drawn on {AXIS_NAME[axis]}.</p>}
    {shown.length === 0
      ? <p className="cmp-empty">Add a well to start a comparison.</p>
      : <Stage built={drawable} axis={axis} view={view} onView={setView} role={role} onRole={setRole} placeWell={placeWell} wire={wire} onRemove={remove} onReference={makeReference} />}
    {shown.length > 0 && <Table built={built} axis={axis} role={role} onRole={setRole} />}
    <p className="petro-note">
      {shown.map((well) => well.source).join(". ")}. Depths and diameters are to one scale across the wells, diameters exaggerated against depth; wall thickness is drawn, not measured.
      TVD comes from each well&apos;s survey by minimum curvature{built.some((entry) => entry.projectedBelowMdM !== null) ? "; below a survey's last station it runs on along the last inclination and is drawn dashed" : ""}.
      Strings are matched by role (named in the records, else by their place in the programme); Δ compares a string&apos;s shoe with the same string in the reference well, on the axis shown.
    </p>
  </div>;
}

// Below WIDE a column drops its label lane (the table and the readout carry the depths) rather than scroll sideways.
const RULER = 62, TOP = 40, BOTTOM = 14, LANE_W = 100, WIDE = 230, MIN_COL = 140;

function Stage({ built, axis, view, onView, role, onRole, placeWell, wire, onRemove, onReference }: {
  readonly built: readonly Built[]; readonly axis: Axis; readonly view: readonly [number, number] | null; readonly onView: (view: readonly [number, number] | null) => void;
  readonly role: Role | null; readonly onRole: (role: Role | null) => void; readonly placeWell: string | null; readonly wire: ReturnType<typeof useWire>;
  readonly onRemove: (id: string) => void; readonly onReference: (id: string) => void;
}) {
  const [box, size] = useSize<HTMLDivElement>();
  const [body, bodySize] = useSize<HTMLDivElement>();
  const n = Math.max(1, built.length);
  const colW = Math.max(MIN_COL, Math.floor((Math.max(0, size.width) - RULER) / n));
  const lane = colW >= WIDE ? LANE_W : 0;
  const width = RULER + n * colW;
  const height = Math.max(260, bodySize.height);
  const full = useMemo((): readonly [number, number] => {
    const tops = built.map((entry) => entry.at(0)).filter((value): value is number => value !== null);
    const bottoms = built.map((entry) => entry.at(entry.well.totalDepthM)).filter((value): value is number => value !== null);
    return tops.length && bottoms.length ? [Math.min(...tops), Math.max(...bottoms)] : [0, 1];
  }, [built]);
  const domain = view ?? full;
  const y = scaleLinear().domain(domain).range([TOP, height - BOTTOM]);
  const maxRadiusIn = Math.max(1, ...built.map((entry) => entry.radiusIn));
  // A drawing wider than this stops reading as a well; spare room goes either side of it.
  const drawW = Math.min(colW - lane - (lane ? 14 : 8), 300);
  const k = (drawW / 2 - 8) / maxRadiusIn;
  const [hover, setHover] = useState<{ readonly value: number; readonly column: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const viewRef = useRef({ domain, full, onView });
  viewRef.current = { domain, full, onView };

  // ⌘/Ctrl + wheel zooms about the pointer; a plain wheel pans once zoomed in. Native, so it can stop the page scrolling.
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      const { domain: [a, b], full: [lo, hi], onView: set } = viewRef.current;
      const zooming = event.ctrlKey || event.metaKey;
      if (!zooming && a <= lo && b >= hi) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const span = b - a;
      if (zooming) {
        const at = a + (event.clientY - rect.top - TOP) / (rect.height - TOP - BOTTOM) * span;
        const next = Math.min(hi - lo, Math.max(20, span * Math.exp(event.deltaY * 0.002)));
        const from = Math.max(lo, Math.min(hi - next, at - (at - a) * next / span));
        set(next >= hi - lo - 0.5 ? null : [from, from + next]);
      } else {
        const shift = event.deltaY / (rect.height - TOP - BOTTOM) * span;
        const from = Math.max(lo, Math.min(hi - span, a + shift));
        set([from, from + span]);
      }
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);

  const move = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left, py = event.clientY - rect.top;
    if (py < TOP || py > height - BOTTOM || px < RULER) { leave(); return; }
    const column = Math.min(n - 1, Math.floor((px - RULER) / colW));
    const value = y.invert(py);
    setHover({ value, column });
    const entry = built[column];
    if (entry && entry.well.id === placeWell) wire.hover(entry.mdAt(value));
    else if (hover && built[hover.column]?.well.id === placeWell) wire.hover(null);
  };
  const leave = () => { if (hover && built[hover.column]?.well.id === placeWell) wire.hover(null); setHover(null); };
  const ticks = y.ticks(Math.max(4, Math.round(height / 70)));

  return <div className="cmp-stage" ref={box}>
    <div className="cmp-inner" style={{ width }}>
      <div className="cmp-heads" style={{ gridTemplateColumns: `${RULER}px repeat(${n}, ${colW}px)` }}>
        <div className="cmp-ruler-head">{AXIS_NAME[axis]}<small>m</small></div>
        {built.map((entry, index) => {
          const md = hover ? entry.mdAt(hover.value) : null;
          const tdOnAxis = entry.at(entry.well.totalDepthM);
          return <div key={entry.well.id} className={`cmp-col-head${index === 0 ? " is-reference" : ""}`}>
            <div className="cmp-col-title">
              <b title={`${entry.well.label} · ${entry.well.site}`}>{entry.well.label}</b>
              {index === 0 ? <span className="cmp-ref is-on" title="Reference: the other wells are read against this one"><Star size={13} aria-hidden="true" /></span>
                : <button type="button" className="cmp-ref" onClick={() => onReference(entry.well.id)} title="Set as reference: read the other wells against this one" aria-label={`Set ${entry.well.label} as reference`}><Star size={13} aria-hidden="true" /></button>}
              <button type="button" className="cmp-remove" aria-label={`Remove ${entry.well.label}`} onClick={() => onRemove(entry.well.id)}><X size={13} aria-hidden="true" /></button>
            </div>
            <small><span className={`cmp-dot is-${entry.well.provenance}`} title={entry.well.provenance} />{entry.well.site} · {entry.well.status}</small>
            <small className={hover ? "cmp-read is-live" : "cmp-read"}>{hover ? readAt(entry, md) : `TD ${fmt(entry.well.totalDepthM)} m MD${axis !== "md" && tdOnAxis !== null ? ` · ${fmt(tdOnAxis)} m ${AXIS_NAME[axis]}` : ""}`}</small>
          </div>;
        })}
      </div>
      <div className="cmp-body" ref={body}><svg ref={svg} width={width} height={height} className="cmp-svg" role="img" aria-label={`Construction of ${built.map((entry) => entry.well.label).join(", ")} side by side on ${AXIS_NAME[axis]}`}
        onPointerMove={move} onPointerLeave={leave} onDoubleClick={() => onView(null)}>
        <defs>
          <pattern id="cmp-cement" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" className="cmp-cement-ground" /><line x1="0" y1="0" x2="0" y2="6" className="cmp-cement-line" /></pattern>
          <clipPath id="cmp-clip"><rect x={0} y={TOP - 1} width={width} height={height - TOP - BOTTOM + 2} /></clipPath>
        </defs>
        <g className="cmp-ruler">
          {ticks.map((tick) => <g key={tick}><line x1={RULER - 6} x2={width} y1={y(tick)} y2={y(tick)} className={axis === "tvdss" && tick === 0 ? "cmp-msl" : "cmp-grid"} /><text x={RULER - 10} y={y(tick) + 3.5} textAnchor="end" className={axis === "tvdss" && tick === 0 ? "cmp-msl-text" : undefined}>{axis === "tvdss" && tick === 0 ? "MSL 0" : fmt(tick)}</text></g>)}
        </g>
        {built.map((entry, index) => <Column key={entry.well.id} entry={entry} x0={RULER + index * colW} colW={colW} drawW={drawW} lane={lane} k={k} y={y} height={height} role={role} onRole={onRole}
          cursorMdM={!hover && entry.well.id === placeWell ? wire.cursor : null} />)}
        {hover && <g className="cmp-hover" pointerEvents="none">
          <line x1={RULER} x2={width} y1={y(hover.value)} y2={y(hover.value)} />
          <rect x={2} y={y(hover.value) - 9} width={RULER - 6} height={18} rx={4} /><text x={RULER - 8} y={y(hover.value) + 4} textAnchor="end">{fmt(hover.value)}</text>
        </g>}
      </svg></div>
    </div>
  </div>;
}

function Column({ entry, x0, colW, drawW, lane, k, y, height, role, onRole, cursorMdM }: {
  readonly entry: Built; readonly x0: number; readonly colW: number; readonly drawW: number; readonly lane: number; readonly k: number;
  readonly y: ReturnType<typeof scaleLinear<number, number>>; readonly height: number; readonly role: Role | null; readonly onRole: (role: Role | null) => void; readonly cursorMdM: number | null;
}) {
  const pad = Math.max(0, (colW - 6 - drawW - (lane ? 14 : 0) - lane) / 2);
  const left = x0 + 6 + pad, right = left + drawW, cx = (left + right) / 2;
  // The geology runs the column's width; the well and its labels sit on it.
  const bandLeft = x0 + 1, bandRight = x0 + colW - 1;
  const laneX = right + 14;
  const r = (mm: number | null) => (inches(mm) ?? 0) / 2 * k;
  const Y = (mdM: number) => { const value = entry.at(mdM); return value === null ? null : y(value); };
  const dim = (which: Role | null) => role !== null && which !== role ? " is-dim" : "";
  const [lo, hi] = y.domain() as [number, number];
  const casings = [...entry.casings].sort((a, b) => (b.component.outerDiameterMm ?? 0) - (a.component.outerDiameterMm ?? 0));
  const tubing = entry.strings.find((value) => value.role === "tubing") ?? null;
  const projected = entry.projectedBelowMdM;
  const ground = Y(0);
  const widest = Math.max(0, ...entry.well.components.filter((component) => component.kind === "Casing" || component.kind === "Hole").map((component) => r(component.outerDiameterMm))) + 8;

  // Cement in the annulus outside a casing, cut where an outer string's shoe changes what is outside it.
  const cement = casings.flatMap(({ component: casing, role: which }) => {
    const record = entry.cementOf(casing);
    if (!record) return [];
    const outer = casings.filter((other) => (other.component.outerDiameterMm ?? 0) > (casing.outerDiameterMm ?? 0));
    const cuts = [...new Set([record.topDepthM, record.bottomDepthM, ...outer.map((other) => other.component.bottomDepthM).filter((depth) => depth > record.topDepthM && depth < record.bottomDepthM)])].sort((a, b) => a - b);
    return cuts.slice(1).map((end, index) => {
      const start = cuts[index]!, middle = (start + end) / 2;
      const around = outer.filter((other) => other.component.topDepthM <= middle && other.component.bottomDepthM >= middle).sort((a, b) => (a.component.outerDiameterMm ?? 0) - (b.component.outerDiameterMm ?? 0))[0];
      const outerMm = around ? (around.component.outerDiameterMm ?? 0) - 2.5 / k * 25.4 * 2 : entry.holeAt(middle)?.outerDiameterMm ?? record.outerDiameterMm;
      return outerMm ? { key: `${casing.id}:${start}`, role: which, a: Y(start), b: Y(end), inner: r(casing.outerDiameterMm), outer: r(outerMm) } : null;
    }).filter((value): value is NonNullable<typeof value> => !!value);
  });

  // Labels in the lane beside the drawing: each string's size and shoe, then TD; pushed apart, never stacked.
  const items = [
    ...entry.strings.map(({ component, role: which }) => ({ key: component.id, role: which as Role | null, target: Y(component.bottomDepthM), anchorX: cx + r(component.outerDiameterMm) + 6, text: `${formatInches(inches(component.outerDiameterMm))} · ${fmtShort(entry.at(component.bottomDepthM))}` })),
    { key: "td", role: null, target: Y(entry.well.totalDepthM), anchorX: cx + r(entry.holeAt(entry.well.totalDepthM - 0.5)?.outerDiameterMm ?? null) + 4, text: `TD · ${fmtShort(entry.at(entry.well.totalDepthM))}` },
  ].filter((item): item is typeof item & { target: number } => lane > 0 && item.target !== null && item.target >= TOP - 2 && item.target <= height - BOTTOM + 2).sort((a, b) => a.target - b.target);
  const GAP = 14, first = TOP + 4, last = height - BOTTOM - 2;
  const placed = items.map((item) => ({ ...item, at: item.target }));
  let cursor = first - GAP;
  for (const item of placed) { item.at = Math.max(item.at, cursor + GAP); cursor = item.at; }
  let limit = last;
  for (let index = placed.length - 1; index >= 0; index--) { const item = placed[index]!; item.at = Math.min(item.at, limit); limit = item.at - GAP; }

  return <g className="cmp-col">
    <line x1={x0} x2={x0} y1={0} y2={height} className="cmp-divider" />
    <g clipPath="url(#cmp-clip)">
      {entry.well.formations.map((layer) => {
        const a = entry.fromTvd(layer.topTvdM), b = entry.fromTvd(layer.bottomTvdM);
        if (a === null || b === null || b < lo || a > hi) return null;
        const ya = y(a), yb = y(b);
        // The name sits in the room left of the well's widest string, cut short rather than run across it.
        const chars = Math.floor((cx - widest - 8 - (bandLeft + 6)) / 6.2);
        return <g key={layer.id}>
          <rect x={bandLeft} y={ya} width={bandRight - bandLeft} height={Math.max(0, yb - ya)} fill={layer.color} className="cmp-band"><title>{layer.name}</title></rect>
          <line x1={bandLeft} x2={bandRight} y1={ya} y2={ya} className="cmp-band-top" />
          {yb - ya >= 16 && chars >= 5 && <text x={bandLeft + 6} y={Math.max(ya, TOP) + 11} className="cmp-band-name">{layer.name.length > chars ? `${layer.name.slice(0, chars - 1).trimEnd()}…` : layer.name}</text>}
        </g>;
      })}
      {entry.holes.map((hole) => {
        const a = Y(hole.topDepthM), b = Y(hole.bottomDepthM), w = r(hole.outerDiameterMm);
        if (a === null || b === null) return null;
        const open = Math.max(hole.topDepthM, entry.deepestShoe);
        const ya = open < hole.bottomDepthM ? Y(open) : null;
        return <g key={hole.id}>
          <rect x={cx - w} y={a} width={w * 2} height={Math.max(0, b - a)} className="cmp-hole" />
          {ya !== null && <><line x1={cx - w} x2={cx - w} y1={ya} y2={b} className="cmp-open" /><line x1={cx + w} x2={cx + w} y1={ya} y2={b} className="cmp-open" /></>}
        </g>;
      })}
      {cement.map((segment) => segment.a === null || segment.b === null ? null : <g key={segment.key} className={`cmp-cement${dim(segment.role)}`}>
        <rect x={cx - segment.outer} y={segment.a} width={Math.max(0, segment.outer - segment.inner)} height={Math.max(0, segment.b - segment.a)} fill="url(#cmp-cement)" />
        <rect x={cx + segment.inner} y={segment.a} width={Math.max(0, segment.outer - segment.inner)} height={Math.max(0, segment.b - segment.a)} fill="url(#cmp-cement)" />
      </g>)}
      {casings.map(({ component, role: which }) => {
        const a = Y(component.topDepthM), b = Y(component.bottomDepthM), w = r(component.outerDiameterMm);
        if (a === null || b === null) return null;
        const colour = ROLE_COLOUR[which];
        const toggle = () => onRole(role === which ? null : which);
        const shoe = Math.min(10, b - a);
        return <g key={component.id} className={`cmp-string${dim(which)}${role === which ? " is-chosen" : ""}`} onClick={toggle} role="button" tabIndex={0} aria-pressed={role === which}
          aria-label={`${component.name}: shoe ${fmt(component.bottomDepthM)} m MD`} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } }}>
          <title>{`${component.name}\n${component.material}\nShoe ${fmt(component.bottomDepthM)} m MD`}</title>
          <rect x={cx - w - 5} y={a} width={9} height={b - a} className="cmp-hit" /><rect x={cx + w - 4} y={a} width={9} height={b - a} className="cmp-hit" />
          <rect x={cx - w} y={a} width={2.5} height={b - a} fill={colour} /><rect x={cx + w - 2.5} y={a} width={2.5} height={b - a} fill={colour} />
          <path d={`M${cx - w} ${b} h-8 l8 -${shoe} z M${cx + w} ${b} h8 l-8 -${shoe} z`} fill={colour} />
        </g>;
      })}
      {tubing && (() => {
        const { component } = tubing;
        const a = Y(component.topDepthM), b = Y(component.bottomDepthM), w = r(component.outerDiameterMm);
        if (a === null || b === null) return null;
        const toggle = () => onRole(role === "tubing" ? null : "tubing");
        return <g className={`cmp-string${dim("tubing")}${role === "tubing" ? " is-chosen" : ""}`} onClick={toggle} role="button" tabIndex={0} aria-pressed={role === "tubing"} aria-label={`${component.name}: tail ${fmt(component.bottomDepthM)} m MD`}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } }}>
          <title>{`${component.name}\n${component.material}\nTail ${fmt(component.bottomDepthM)} m MD`}</title>
          <rect x={cx - w - 4} y={a} width={w * 2 + 8} height={b - a} className="cmp-hit" />
          <rect x={cx - w} y={a} width={1.6} height={b - a} fill={ROLE_COLOUR.tubing} /><rect x={cx + w - 1.6} y={a} width={1.6} height={b - a} fill={ROLE_COLOUR.tubing} />
        </g>;
      })()}
      {entry.well.components.filter((component) => component.kind === "Packer" || component.kind === "Safety valve" || component.kind === "Gas lift mandrel").map((component) => {
        const at = Y(component.topDepthM);
        if (at === null || !tubing) return null;
        const tw = r(tubing.component.outerDiameterMm);
        const around = casings.filter(({ component: casing }) => casing.topDepthM <= component.topDepthM && casing.bottomDepthM >= component.topDepthM).sort((a, b) => (a.component.outerDiameterMm ?? 0) - (b.component.outerDiameterMm ?? 0))[0];
        const cw = around ? r(around.component.outerDiameterMm) - 2.5 : tw + 6;
        return <g key={component.id} className={`cmp-tool${dim("tubing")}`}><title>{`${component.name} · ${fmt(component.topDepthM)} m MD`}</title>
          {component.kind === "Packer" ? <><rect x={cx - cw} y={at - 3} width={cw - tw} height={6} /><rect x={cx + tw} y={at - 3} width={cw - tw} height={6} /></>
            : component.kind === "Safety valve" ? <path d={`M${cx} ${at - 5} l4 5 l-4 5 l-4 -5 z`} />
            : <rect x={cx + tw} y={at - 4} width={4} height={8} rx={1} />}
        </g>;
      })}
      {projected !== null && entry.at(projected) !== null && <line x1={bandLeft} x2={bandRight} y1={y(entry.at(projected)!)} y2={y(entry.at(projected)!)} className="cmp-projected"><title>{`Survey ends at ${fmt(projected)} m MD: TVD below is projected on the last inclination`}</title></line>}
      {cursorMdM !== null && Y(cursorMdM) !== null && <line x1={bandLeft} x2={bandRight} y1={Y(cursorMdM)!} y2={Y(cursorMdM)!} className="acx-cursor" />}
    </g>
    {ground !== null && ground >= TOP - 1 && ground <= height - BOTTOM && <Surface entry={entry} cx={cx} ground={ground} r={r} />}
    {placed.map((item) => <g key={item.key} className={`cmp-label${dim(item.role)}`}>
      <path d={`M${item.anchorX} ${item.target} L${laneX - 10} ${item.target} L${laneX - 4} ${item.at} H${laneX - 1}`} className="cmp-leader" />
      {item.role && <rect x={laneX} y={item.at - 6} width={3} height={12} rx={1} fill={ROLE_COLOUR[item.role]} />}
      <text x={laneX + 7} y={item.at + 4}>{item.text}</text>
    </g>)}
  </g>;
}

function fmtAxis(value: number | null) { return value === null ? "—" : `${fmt(value)} m`; }
function fmtShort(value: number | null) { return value === null ? "—" : fmt(value); }

/** Wellhead and tree at the depth reference: drawn when the records have them, sized to the casing. */
function Surface({ entry, cx, ground, r }: { readonly entry: Built; readonly cx: number; readonly ground: number; readonly r: (mm: number | null) => number }) {
  const head = entry.well.components.find((component) => component.kind === "Wellhead");
  const valves = entry.well.components.filter((component) => component.kind === "Valve");
  const width = Math.max(18, 2 * Math.max(0, ...entry.casings.map(({ component }) => r(component.outerDiameterMm))) + 8);
  return <g className="cmp-surface">
    {head && <rect x={cx - width / 2} y={ground - 7} width={width} height={7} rx={1.5}><title>{head.name}</title></rect>}
    {valves.length > 0 && <g><title>{valves.map((valve) => valve.name).join(", ")}</title>
      <rect x={cx - 4} y={ground - 7 - 22} width={8} height={22} rx={1.5} />
      <rect x={cx - 11} y={ground - 7 - 15} width={22} height={5} rx={1.5} />
    </g>}
  </g>;
}

function Table({ built, axis, role, onRole }: { readonly built: readonly Built[]; readonly axis: Axis; readonly role: Role | null; readonly onRole: (role: Role | null) => void }) {
  const reference = built[0]!;
  const present = ROLES.filter((which) => built.some((entry) => entry.strings.some((value) => value.role === which)));
  const kinds = (entry: Built, kind: WellComponent["kind"]) => entry.well.components.filter((component) => component.kind === kind);
  const hasCompletion = built.some((entry) => kinds(entry, "Packer").length || kinds(entry, "Safety valve").length || kinds(entry, "Gas lift mandrel").length);
  const depthLine = (entry: Built, mdM: number) => `${fmt(mdM)} m MD${axis !== "md" ? ` · ${fmtAxis(entry.at(mdM))} ${AXIS_NAME[axis]}` : entry.tvdOf(mdM) !== null && Math.abs(entry.tvdOf(mdM)! - mdM) > 0.5 ? ` · ${fmt(entry.tvdOf(mdM)!)} m TVD` : ""}`;
  return <div className="acx-table-wrap">
    <table className="acx-table cmp-table">
      <thead><tr><th />{built.map((entry, index) => <th key={entry.well.id}>{entry.well.label}{index === 0 ? <small> · reference</small> : null}</th>)}</tr></thead>
      <tbody>
        <tr className="cmp-group"><th colSpan={built.length + 1}>Well</th></tr>
        <tr><th>Records</th>{built.map((entry) => <td key={entry.well.id}><span className={`badge is-${entry.well.provenance}`}>{entry.well.provenance}</span> {entry.well.status}{entry.well.purpose ? <span>{entry.well.purpose}</span> : null}</td>)}</tr>
        <tr><th>Depth reference</th>{built.map((entry) => <td key={entry.well.id}>{entry.well.datum.name}{entry.well.datum.elevationMslM !== null ? ` · ${fmt(entry.well.datum.elevationMslM, 1)} m above MSL` : " · elevation not reported"}</td>)}</tr>
        <tr><th>Total depth</th>{built.map((entry) => <td key={entry.well.id}>{depthLine(entry, entry.well.totalDepthM)}</td>)}</tr>
        <tr><th>Most inclined</th>{built.map((entry) => <td key={entry.well.id} className={entry.well.stations.length ? undefined : "cmp-none"}>{entry.well.stations.length ? `${fmt(entry.maxInc.inc, 1)}° at ${fmt(entry.maxInc.md)} m MD` : "no survey"}{entry.well.surveyNote ? <span>{entry.well.surveyNote}</span> : null}</td>)}</tr>
        <tr><th>Open hole below the last shoe</th>{built.map((entry) => {
          const length = entry.well.totalDepthM - entry.deepestShoe;
          const hole = entry.holeAt(entry.well.totalDepthM - 0.5);
          return <td key={entry.well.id}>{length > 0.5 ? `${fmt(length)} m · ${fmt(entry.deepestShoe)}–${fmt(entry.well.totalDepthM)} m MD${hole ? ` · ${formatInches(inches(hole.outerDiameterMm))}` : ""}` : "cased to TD"}</td>;
        })}</tr>
        <tr className="cmp-group"><th colSpan={built.length + 1}>Strings · choose one to light it in every well</th></tr>
        {present.map((which) => {
          const refString = reference.strings.find((value) => value.role === which)?.component ?? null;
          return <tr key={which} className={`cmp-row${role === which ? " is-chosen" : ""}`} onClick={() => onRole(role === which ? null : which)}>
            <th><i style={{ background: ROLE_COLOUR[which] }} />{ROLE_NAME[which]}</th>
            {built.map((entry, index) => {
              const string = entry.strings.find((value) => value.role === which)?.component ?? null;
              if (!string) return <td key={entry.well.id} className="cmp-none">none</td>;
              const hole = which === "tubing" ? null : entry.holeAt(string.bottomDepthM - 0.5);
              const cement = which === "tubing" ? null : entry.cementOf(string);
              const here = entry.at(string.bottomDepthM), there = refString ? reference.at(refString.bottomDepthM) : null;
              const delta = index > 0 && here !== null && there !== null ? here - there : null;
              // What the report says of the cement, where the well's records carry it in the string's description.
              const said = string.description.startsWith("Cement:"), silent = said && /not described/.test(string.description);
              const material = string.material && !/not reported/i.test(string.material) ? string.material.replaceAll(" / ", " · ") : "grade and weight not reported";
              return <td key={entry.well.id}>
                <b>{formatInches(inches(string.outerDiameterMm))}</b> · {material}{string.sourcePage ? <small> · p. {string.sourcePage}</small> : null}
                <span>{which === "tubing" ? "tail" : "shoe"} {depthLine(entry, string.bottomDepthM)}{delta !== null && Math.abs(delta) >= 0.5 ? <em className="cmp-delta"> Δ {delta > 0 ? "+" : "−"}{fmt(Math.abs(delta))} m</em> : delta !== null ? <em className="cmp-delta"> same depth</em> : null}</span>
                {which !== "tubing" && <span>{hole ? `in ${formatInches(inches(hole.outerDiameterMm))} hole` : "hole size not reported"} · {cement ? `cement top ${/≈/.test(cement.name) ? "≈ " : ""}${fmt(cement.topDepthM)} m MD` : silent ? "cement not described" : said ? "cement top not reported" : "no cement record"}</span>}
                {which !== "tubing" && said && !silent && <span className="cmp-quote">{string.description.slice(8)}</span>}
              </td>;
            })}
          </tr>;
        })}
        {hasCompletion && <>
          <tr className="cmp-group"><th colSpan={built.length + 1}>Completion</th></tr>
          {(["Packer", "Safety valve", "Gas lift mandrel"] as const).map((kind) => <tr key={kind}><th>{kind === "Gas lift mandrel" ? "Gas-lift mandrels" : kind === "Safety valve" ? "Subsurface safety valve" : "Packer"}</th>
            {built.map((entry) => { const found = kinds(entry, kind); return <td key={entry.well.id} className={found.length ? undefined : "cmp-none"}>{found.length ? found.map((component) => `${fmt(component.topDepthM)} m`).join(", ") + " MD" : "none in the records"}</td>; })}
          </tr>)}
        </>}
        {built.some((entry) => entry.well.notes?.length) && <tr><th>Where the report disagrees</th>{built.map((entry) => <td key={entry.well.id} className={entry.well.notes?.length ? "cmp-notes" : "cmp-none"}>{entry.well.notes?.length ? entry.well.notes.map((note, index) => <span key={index}>{note.text}{note.page !== null && !/\(pp?\. \d+/.test(note.text) ? ` (p. ${note.page})` : ""}</span>) : "none recorded here"}</td>)}</tr>}
        <tr><th>Wellhead and valves</th>{built.map((entry) => { const found = entry.well.components.filter((component) => component.kind === "Wellhead" || component.kind === "Valve"); return <td key={entry.well.id} className={found.length ? undefined : "cmp-none"}>{found.length ? found.map((component) => `${component.name}${component.sourcePage ? ` (p. ${component.sourcePage})` : ""}`).join(" · ") : "none in the records"}</td>; })}</tr>
      </tbody>
    </table>
  </div>;
}
