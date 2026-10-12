import { useState } from "react";
import { InfoTip } from "./info-tip.js";
import { metresToFeet, positionAtMeasuredDepth } from "@ikhmalputra/subsurface-core";
import type { ComponentId, ComponentKind, WellComponent, WellDesign } from "@ikhmalputra/subsurface-core";
import { scaleLinear } from "d3-scale";
import { CommandButton } from "./ui.js";

const kindColor: Record<ComponentKind, string> = {
  Hole: "#66747b", Casing: "#197c6e", Cement: "#b5a77e", Valve: "#c46143",
  Wellhead: "#c46143", Tubular: "#ab6041", Connection: "#697b71", Coupling: "#697b71",
  "Casing joint": "#197c6e", "Tubing joint": "#ab6041", "Casing coupling": "#285c53",
  "Tubing coupling": "#85482f", Centralizer: "#7c6a4e", Packer: "#a14535",
  "Safety valve": "#a14535", "Gas lift mandrel": "#4f6b8a", Gauge: "#6f6685",
  "Landing nipple": "#8b6840",
};

/**
 * Whether this well's own source states its depths in feet.
 *
 * Every depth in a `WellDesign` is held in metres; this only decides which unit the drawing quotes
 * back, because showing a reader a number their source document does not contain is a misquotation
 * even when the conversion is exact.
 *
 * It used to be `provenance === "documented"`, which is not a unit. Two consequences, both live:
 * editing the FORGE well set its provenance to "user-authored" and silently switched this drawing
 * from feet to metres — while the interval's own base depth kept using `rawBottomDepthFt` — so one
 * component's extent was stated as "8.5 m MD to 1,629 ft report MD", two units 3.28x apart in one
 * sentence. And the feet-only branch carried a conversion factor into the geology track that had no
 * business there; see the TVD projection below.
 *
 * The question is answered by the data that makes it answerable: a design carrying a reported total
 * depth in feet is one whose source reported feet, whoever has edited it since.
 */
function reportsDepthInFeet(design: WellDesign): boolean {
  return design.reportedTotalDepthFt != null;
}

/** A design-space depth in metres, expressed in the unit this well's source reports. */
function reportedDepth(mdM: number, design: WellDesign): number {
  return reportsDepthInFeet(design) ? metresToFeet(mdM) : mdM;
}

function sourceDepthText(component: WellComponent, design: WellDesign): string {
  if (component.kind === "Wellhead" || component.kind === "Valve") return "Depth not reported / surface location marker only";
  const unit = reportsDepthInFeet(design) ? "ft report MD" : "m MD";
  const top = component.topDepthReported
    ? `${number(reportedDepth(component.topDepthM, design))} ${unit}`
    : reportsDepthInFeet(design) ? "Top unreported (plotted at 0)" : `${number(component.topDepthM)} m planned MD`;
  const bottom = component.rawBottomDepthFt != null
    ? `${number(component.rawBottomDepthFt)} ft report MD`
    : `${number(reportedDepth(component.bottomDepthM, design))} ${unit}`;
  return `${top} to ${bottom}`;
}

function sourceLink(component: WellComponent, design: WellDesign): string {
  if (design.provenance === "documented") return `Report p. ${component.sourcePage ?? "not cited"}`;
  return design.provenance === "user-authored" ? "User planned" : "Synthetic test fixture";
}

function intervalDomain(design: WellDesign): number {
  if (reportsDepthInFeet(design)) return Math.max(design.reportedTotalDepthFt ?? 0, design.surveyCoverageFt ?? 0, 1);
  return Math.max(design.totalDepthM, 1);
}

function intervalStart(component: WellComponent, design: WellDesign): number {
  return reportedDepth(component.topDepthM, design);
}

function intervalEnd(component: WellComponent, design: WellDesign): number {
  if (reportsDepthInFeet(design) && component.rawBottomDepthFt != null) return component.rawBottomDepthFt;
  return reportedDepth(component.bottomDepthM, design);
}

function TrajectoryProfile({ design, selected, layersVisible, onSelect }: { design: WellDesign; selected?: WellComponent; layersVisible: boolean; onSelect: (id: ComponentId) => void }) {
  const [activeStationMd, setActiveStationMd] = useState<number | null>(null);
  const stations = design.survey ?? [positionAtMeasuredDepth(design, 0), positionAtMeasuredDepth(design, design.totalDepthM)];
  const eastings = stations.map((station) => station.eastingM);
  const maxTvd = Math.max(...stations.map((station) => station.tvdM), 1);
  const eastMin = Math.min(...eastings);
  const eastMax = Math.max(...eastings);
  const plot = { left: 78, top: 98, width: 422, height: 554 };
  const eastSpan = Math.max(eastMax - eastMin, 1);
  const pixelsPerMetre = Math.min(plot.width / eastSpan, plot.height / maxTvd);
  const horizontal = (easting: number) => plot.left + plot.width / 2 + (easting - (eastMin + eastMax) / 2) * pixelsPerMetre;
  const vertical = (tvd: number) => plot.top + (plot.height - maxTvd * pixelsPerMetre) / 2 + tvd * pixelsPerMetre;
  const trajectory = stations.map((point, index) => `${index === 0 ? "M" : "L"}${horizontal(point.eastingM)},${vertical(point.tvdM)}`).join(" ");
  const markEvery = Math.max(1, Math.floor(stations.length / 28));
  const shoes = design.provenance === "documented" ? (design.components ?? []).filter((item) => item.kind === "Casing") : [];
  const activeStation = stations.find((station) => station.mdM === activeStationMd);
  function selectNearestStation(event: React.MouseEvent<SVGPathElement>) {
    const svg = event.currentTarget.ownerSVGElement;
    const transform = svg?.getScreenCTM();
    if (!svg || !transform) return;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const localPoint = point.matrixTransform(transform.inverse());
    const nearest = stations.reduce((best, station) => {
      const distance = (horizontal(station.eastingM) - localPoint.x) ** 2 + (vertical(station.tvdM) - localPoint.y) ** 2;
      return distance < best.distance ? { station, distance } : best;
    }, { station: stations[0]!, distance: Number.POSITIVE_INFINITY });
    setActiveStationMd(nearest.station.mdM);
  }
  function selectKeyboardStation(event: React.KeyboardEvent<SVGPathElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setActiveStationMd(activeStation?.mdM ?? stations[Math.floor(stations.length / 2)]!.mdM);
    }
  }
  return <section className="sw-trajectory-panel" data-testid="schematic-track-trajectory" aria-label={`${design.surveyStatus === "planned" ? "Planned" : "Observed"} survey stations / Easting by TVD, measured depth station data`}>
    <div className="sw-schematic-panel-heading"><div><span>01 / PATH</span><h2>{design.surveyStatus === "planned" ? "Planned trajectory" : "Measured trajectory"}</h2></div><small>{design.surveyStatus === "planned" ? "User-entered course preview" : `${stations.length} survey stations`}</small></div>
    <svg className="sw-trajectory-profile" viewBox="0 0 540 720" role="group" aria-label={`${design.surveyStatus === "planned" ? "Planned" : "Observed"} well path, local Easting and TVD in metres`}>
      <defs><clipPath id="trajectory-plot-clip"><rect x="78" y="98" width="422" height="554" /></clipPath></defs>
      {layersVisible && (design.formations ?? []).map((layer) => <g key={layer.id}><rect x="78" y={vertical(layer.topTvdM)} width="422" height={Math.max(0, vertical(layer.bottomTvdM) - vertical(layer.topTvdM))} fill={layer.color} opacity="0.58" /><text x="88" y={(vertical(layer.topTvdM) + vertical(layer.bottomTvdM)) / 2} className="sw-profile-formation">{layer.name}</text></g>)}
      {scaleLinear().domain([eastMin, eastMax === eastMin ? eastMin + 1 : eastMax]).ticks(5).map((tick) => <g key={`e-${tick}`}><line x1={horizontal(tick)} x2={horizontal(tick)} y1="98" y2="652" stroke="#d9e1dc" strokeDasharray="4 6" /><text x={horizontal(tick)} y="676" textAnchor="middle" className="sw-profile-tick">{number(tick)}</text></g>)}
      {scaleLinear().domain([0, maxTvd]).ticks(7).map((tick) => <g key={`t-${tick}`}><line x1="78" x2="500" y1={vertical(tick)} y2={vertical(tick)} stroke="#d9e1dc" strokeDasharray="4 6" /><text x="68" y={vertical(tick) + 5} textAnchor="end" className="sw-profile-tick">{number(tick)}</text></g>)}
      <text x="288" y="706" textAnchor="middle" className="sw-profile-axis-title">LOCAL EASTING / m</text>
      <text x="18" y="78" className="sw-profile-axis-title">TVD / m RKB</text>
      <g clipPath="url(#trajectory-plot-clip)">
        <path d={trajectory} fill="none" stroke="transparent" strokeWidth="24" pointerEvents="stroke" role="button" tabIndex={0} aria-label="Select the nearest survey station" aria-pressed={activeStation !== undefined} data-testid="trajectory-hit-target" onClick={selectNearestStation} onKeyDown={selectKeyboardStation} />
        <path d={trajectory} fill="none" stroke="#fff" strokeWidth="17" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
        <path data-testid={design.provenance === "synthetic" ? "curved-casing-path" : undefined} d={trajectory} fill="none" stroke={design.surveyStatus === "planned" ? "#197c6e" : "#274f6a"} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
        {stations.filter((_, index) => index % markEvery === 0 || index === stations.length - 1).map((station) => {
          const active = station.mdM === activeStationMd;
          return <circle key={station.mdM} cx={horizontal(station.eastingM)} cy={vertical(station.tvdM)} r={active ? 7 : 4} fill={active ? "#f0aa38" : "#fff"} stroke={active ? "#633b0b" : "#274f6a"} strokeWidth={active ? 2 : 1.5} pointerEvents="none"><title>{`MD ${number(station.mdM)} m / TVD ${number(station.tvdM)} m`}</title></circle>;
        })}
        {shoes.map((casing) => { const point = positionAtMeasuredDepth(design, casing.bottomDepthM); const chosen = selected?.id === casing.id; return <g key={casing.id}><circle cx={horizontal(point.eastingM)} cy={vertical(point.tvdM)} r={chosen ? 9 : 5} fill={chosen ? "#ff6a00" : kindColor.Casing} stroke="#fff" strokeWidth={chosen ? 3 : 2}><title>{`${casing.name} shoe / ${casing.rawBottomDepthFt} ft report MD`}</title></circle></g>; })}
        {activeStation && <circle data-testid="trajectory-selected-station" data-md-m={activeStation.mdM} cx={horizontal(activeStation.eastingM)} cy={vertical(activeStation.tvdM)} r="11" fill="none" stroke="#b66b13" strokeWidth="2" pointerEvents="none" />}
      </g>
      <text x="88" y="84" className="sw-profile-tick">CENTERED LOCAL EASTING / RKB</text>
    </svg>
    <div className="sw-profile-legend"><span><i className="sw-legend-path" />{design.surveyStatus === "planned" ? "Planned path" : "Survey path"}</span>{layersVisible && (design.formations ?? []).map((layer) => <span key={layer.id}><i style={{ backgroundColor: layer.color }} />{layer.name}</span>)}</div>
    <div className="sw-profile-selection" aria-live="polite" data-testid="trajectory-selection">
      {activeStation ? <><strong>SELECTED SURVEY STATION</strong><span>MD {number(activeStation.mdM)} m</span><span>TVD {number(activeStation.tvdM)} m</span><span>E {number(activeStation.eastingM)} m / N {number(activeStation.northingM)} m</span></> : <span>Click anywhere on the path to inspect the nearest survey station.</span>}
    </div>
    {selected && <CommandButton icon="inspect" className="sw-profile-record-link" onClick={() => onSelect(selected.id)}>Inspect selected record / {sourceDepthText(selected, design)}</CommandButton>}
  </section>;
}

function DepthProgram({ design, components, selectedId, onSelect }: { design: WellDesign; components: readonly WellComponent[]; selectedId: string; onSelect: (id: ComponentId) => void }) {
  const domain = intervalDomain(design);
  const vertical = scaleLinear().domain([0, domain]).range([0, 590]);
  const ticks = vertical.ticks(6);
  const holes = components.filter((component) => component.kind === "Hole");
  const casings = components.filter((component) => component.kind === "Casing").sort((left, right) => (right.outerDiameterMm ?? 0) - (left.outerDiameterMm ?? 0));
  const cement = components.filter((component) => component.kind === "Cement");
  const surface = components.filter((component) => component.kind === "Wellhead" || component.kind === "Valve");
  const largestHole = Math.max(1, ...holes.map((component) => component.outerDiameterMm ?? 0));
  const largestCasing = Math.max(1, ...casings.map((component) => component.outerDiameterMm ?? 0));

  function intervalBar(component: WellComponent, family: "hole" | "casing" | "cement") {
      const start = Math.max(0, Math.min(domain, intervalStart(component, design)));
      const end = Math.max(start, Math.min(domain, intervalEnd(component, design)));
      const selected = component.id === selectedId;
      const diameter = family === "hole" ? (component.outerDiameterMm ?? 0) / largestHole : (component.outerDiameterMm ?? 0) / largestCasing;
      const width = family === "hole" ? 72 * diameter : family === "casing" ? 76 * diameter : 52;
      const labelDepth = sourceDepthText(component, design);
    return <CommandButton kind="selection" key={component.id} className={`sw-depth-program-bar sw-depth-program-${family} ${selected ? "sw-depth-program-selected" : ""}`} style={{ top: `${vertical(start)}px`, height: `${Math.max(end === start ? 5 : 3, vertical(end) - vertical(start))}px`, width: `${Math.max(width, family === "cement" ? 0 : 8)}px` }} data-testid={`schematic-component-${component.id}`} aria-label={`Select ${component.name}: ${labelDepth} / ${component.material}`} aria-pressed={selected} onClick={() => onSelect(component.id)}>
      {end - start > domain * 0.07 && <span>{component.name}</span>}
      <i title={component.rawBottomDepthFt != null ? `Reported shoe ${component.rawBottomDepthFt.toLocaleString("en-US")} ft MD` : `${number(component.bottomDepthM)} m MD`} />
    </CommandButton>;
  }

  return <section className="sw-depth-program" data-testid="schematic-depth-program" aria-label="Vertical well construction and casing shoe schematic">
    <div className="sw-depth-program-heading"><div><span>WELLBORE PROFILE / NOT TO SCALE</span><h3 className="sw-title">Measured-depth schematic<InfoTip label="About the depth schematic">Track width shows relative reported OD only. IDs, wall thickness, cement annulus geometry and unreported tops are not inferred. Select a shoe to open its source details.</InfoTip></h3></div><small>{reportsDepthInFeet(design) ? "REPORT MD / FT" : "PLANNED MD / M"}</small></div>
    <div className="sw-depth-program-grid">
      <div className="sw-depth-axis"><span className="sw-depth-axis-title">{reportsDepthInFeet(design) ? "MD / ft" : "MD / m"}</span><div className="sw-depth-axis-body">{ticks.map((tick) => <span key={tick} style={{ top: `${vertical(tick)}px` }}>{number(tick)}</span>)}</div></div>
      <div className="sw-depth-program-track" data-testid="schematic-track-hole" aria-label={`Hole diameters: ${holes.map((item) => item.name).join(", ")}`}><h4>HOLE</h4><div className="sw-depth-track-body">{ticks.map((tick) => <i key={tick} className="sw-depth-gridline" style={{ top: `${vertical(tick)}px` }} />)}{holes.map((component) => intervalBar(component, "hole"))}</div></div>
      <div className="sw-depth-program-track" data-testid="schematic-track-casing" aria-label={`Casing strings: ${casings.map((item) => `${item.name}, ${number(item.rawBottomDepthFt ?? intervalEnd(item, design))} ${reportsDepthInFeet(design) ? "ft report MD" : "m MD"}`).join(", ")}`}><h4>CASING / OD</h4><div className="sw-depth-track-body">{ticks.map((tick) => <i key={tick} className="sw-depth-gridline" style={{ top: `${vertical(tick)}px` }} />)}{casings.map((component) => intervalBar(component, "casing"))}</div></div>
      <div className="sw-depth-program-track" data-testid="schematic-track-cement" aria-label={`Cement records: ${cement.map((item) => item.name).join(", ")}`}><h4>CEMENT</h4><div className="sw-depth-track-body">{ticks.map((tick) => <i key={tick} className="sw-depth-gridline" style={{ top: `${vertical(tick)}px` }} />)}{cement.map((component) => intervalBar(component, "cement"))}</div></div>
      <div className="sw-depth-shoe-list"><h4>SHOES / SOURCE DEPTHS</h4>{casings.map((component) => <CommandButton kind="selection" key={component.id} aria-pressed={component.id === selectedId} onClick={() => onSelect(component.id)}><i style={{ background: kindColor.Casing }} /><span><strong>{component.name}</strong><small>{component.rawBottomDepthFt?.toLocaleString("en-US")} ft MD / report p.{component.sourcePage}</small></span></CommandButton>)}{cement.map((component) => <CommandButton kind="selection" key={component.id} aria-pressed={component.id === selectedId} onClick={() => onSelect(component.id)}><i style={{ background: kindColor.Cement }} /><span><strong>{component.name}</strong><small>{component.rawBottomDepthFt?.toLocaleString("en-US")} ft MD / outer bound not reported</small></span></CommandButton>)}{surface.map((component) => <CommandButton kind="selection" key={component.id} aria-pressed={component.id === selectedId} onClick={() => onSelect(component.id)}><i style={{ background: kindColor.Wellhead }} /><span><strong>{component.name}</strong><small>Surface marker / geometry not reported</small></span></CommandButton>)}</div>
    </div>
  </section>;
}

function ConstructionSection({ design, components, selectedId, onSelect, layersVisible }: { design: WellDesign; components: readonly WellComponent[]; selectedId: string; onSelect: (id: ComponentId) => void; layersVisible: boolean }) {
  const domain = intervalDomain(design);
  const y = scaleLinear().domain([0, domain]).range([104, 698]);
  const ticks = y.ticks(6);
  const holes = components.filter((component) => component.kind === "Hole");
  const casings = components.filter((component) => component.kind === "Casing");
  const cements = components.filter((component) => component.kind === "Cement");
  const maxHoleOd = Math.max(1, ...holes.map((component) => component.outerDiameterMm ?? 0));
  const maxCasingOd = Math.max(1, ...casings.map((component) => component.outerDiameterMm ?? 0));
  function topDepth(component: WellComponent) {
    return Math.max(0, Math.min(domain, intervalStart(component, design)));
  }
  function bottomDepth(component: WellComponent) {
    return Math.max(topDepth(component), Math.min(domain, intervalEnd(component, design)));
  }
  function interval(component: WellComponent) {
    const top = y(topDepth(component));
    const bottom = y(bottomDepth(component));
    return { top, height: Math.max(bottom === top ? 7 : 3, bottom - top) };
  }
  function selectOnKey(event: React.KeyboardEvent<SVGGElement>, id: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(id);
    }
  }
  function mdAtTvd(tvdM: number) {
    const stations = design.survey ?? [];
    const upperIndex = stations.findIndex((station) => station.tvdM >= tvdM);
    if (upperIndex < 0) return domain;
    if (upperIndex === 0) return reportedDepth(stations[0]!.mdM, design);
    const upper = stations[upperIndex]!;
    const lower = stations[upperIndex - 1]!;
    const fraction = (tvdM - lower.tvdM) / (upper.tvdM - lower.tvdM);
    const mdM = lower.mdM + fraction * (upper.mdM - lower.mdM);
    return reportedDepth(mdM, design);
  }
  const records = [...components].sort((left, right) => topDepth(left) - topDepth(right));
  return <section className="sw-construction-section" data-testid="component-section-schematic" aria-labelledby="sw-construction-title">
    <div className="sw-schematic-panel-heading"><div><span>DEPTH-ALIGNED WELLBORE / INTERACTIVE</span><h2 id="sw-construction-title">Well construction</h2></div><small>{reportsDepthInFeet(design) ? "REPORT MD / ft" : "PLANNED MD / m"} / conceptual widths</small></div>
    <div className="sw-construction-layout">
      <div className="sw-wellbore-figure"><svg className="sw-wellbore-svg" viewBox="0 0 320 740" role="group" aria-label="Interactive depth-aligned wellbore, hole, casing and cement intervals">
      <defs>
        <pattern id="sw-construction-hole" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M0 7L7 0" stroke="#91a099" strokeWidth="1" /></pattern>
        <pattern id="sw-construction-cement" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 6L6 0" stroke="#ac9f7b" strokeWidth="1" /></pattern>
      </defs>
      <text x="86" y="31" textAnchor="middle" className="sw-construction-track-head">GEOLOGY</text>
      <text x="153" y="31" textAnchor="middle" className="sw-construction-track-head">HOLE</text>
      <text x="224" y="31" textAnchor="middle" className="sw-construction-track-head">CASING / OD</text>
      <text x="290" y="31" textAnchor="middle" className="sw-construction-track-head">CEMENT</text>
      <rect x="72" y="104" width="28" height="594" fill="#f4f7f4" stroke="#dce4df" />
      {layersVisible && (design.formations ?? []).map((layer) => {
        // `mdAtTvd` takes TVD in metres, which is what `topTvdM` is. A feet factor was applied
        // here, scaling FORGE's layer depths to 0.3048 of themselves: the granite reservoir top was
        // drawn at ~1,433 ft when the survey puts it at ~4,700 ft, and its base at ~2,609 ft rather
        // than the 10,955 ft survey end — the reservoir in the top quarter of a well it fills the
        // bottom half of. Invisible on the synthetic wells, where the factor was 1.
        const top = y(Math.max(0, Math.min(domain, mdAtTvd(layer.topTvdM))));
        const bottom = y(Math.max(0, Math.min(domain, mdAtTvd(layer.bottomTvdM))));
        return <rect key={layer.id} x="73" y={top} width="26" height={Math.max(2, bottom - top)} fill={layer.color} opacity="0.78"><title>{`${layer.name} / depth projected from TVD`}</title></rect>;
      })}
      <rect x="117" y="104" width="72" height="594" fill="#f7f9f7" stroke="#dce4df" />
      <rect x="195" y="104" width="58" height="594" fill="#f7f9f7" stroke="#dce4df" />
      <rect x="277" y="104" width="26" height="594" fill="#f7f9f7" stroke="#dce4df" />
      {ticks.map((tick) => <g key={tick}><line x1="58" x2="305" y1={y(tick)} y2={y(tick)} stroke="#dce4df" strokeDasharray="3 5" /><text x="52" y={y(tick) + 3} textAnchor="end" className="sw-construction-tick">{number(tick)}</text></g>)}
      <text x="7" y="81" className="sw-construction-note">{reportsDepthInFeet(design) ? "MD / ft" : "MD / m"}</text>
      <g data-testid="schematic-track-hole" aria-label={`Nominal borehole diameters: ${holes.map((component) => component.name).join(", ")}`}>
        {holes.map((component) => {
          const extent = interval(component);
          const width = 10 + 52 * (component.outerDiameterMm ?? 0) / maxHoleOd;
          const selected = component.id === selectedId;
          return <g key={component.id} data-testid={`schematic-component-${component.id}`} role="button" tabIndex={0} aria-label={`Select ${component.name}, nominal ${number(component.outerDiameterMm ?? 0)} millimetre hole, ${sourceDepthText(component, design)}`} aria-pressed={selected} onClick={() => onSelect(component.id)} onKeyDown={(event) => selectOnKey(event, component.id)}>
            <rect x={153 - width / 2} y={extent.top} width={width} height={extent.height} fill="url(#sw-construction-hole)" stroke={selected ? "#ff6a00" : "#708078"} strokeWidth={selected ? 3.5 : 1.5} opacity={selectedId && !selected ? 0.35 : 1} strokeDasharray="4 3" />
            <title>{`${component.name} / nominal hole only / ${sourceDepthText(component, design)}`}</title>
          </g>;
        })}
      </g>
      <g data-testid="schematic-track-casing" aria-label={`Reported casing OD and shoe depths: ${casings.map((component) => `${number(component.rawBottomDepthFt ?? 0)} ft report MD / ${component.material}`).join("; ")}`}>
        {casings.map((component) => {
          const extent = interval(component);
          const width = 12 + 44 * (component.outerDiameterMm ?? 0) / maxCasingOd;
          const color = component.id === "surface-casing" ? "#197c6e" : component.id === "intermediate-casing" ? "#4768a5" : component.id === "production-casing" ? "#c46143" : kindColor.Casing;
          const selected = component.id === selectedId;
          return <g key={component.id} data-testid={`schematic-section-${component.id}`} role="button" tabIndex={0} aria-label={`Select ${component.name}, ${component.material}, ${sourceDepthText(component, design)}, ${component.outerDiameterMm} millimetre OD`} aria-pressed={selected} onClick={() => onSelect(component.id)} onKeyDown={(event) => selectOnKey(event, component.id)}>
            <rect data-testid={`schematic-component-${component.id}`} x={224 - width / 2} y={extent.top} width={width} height={extent.height} fill={color} fillOpacity={selected ? 0.6 : 0.24} stroke={selected ? "#ff6a00" : color} strokeWidth={selected ? 3.5 : 1.5} opacity={selectedId && !selected ? 0.35 : 1} />
            <line x1={224 - width / 2} x2={224 + width / 2} y1={extent.top + extent.height} y2={extent.top + extent.height} stroke={selected ? "#ff6a00" : color} strokeWidth="3" opacity={selectedId && !selected ? 0.35 : 1} />
            <title>{`${component.name} / ${number(component.outerDiameterMm ?? 0)} mm OD / ID and wall thickness not reported / ${sourceDepthText(component, design)}`}</title>
          </g>;
        })}
      </g>
      <g data-testid="schematic-track-cement" aria-label="Cement source intervals; annular outside geometry not reported">
        {cements.map((component) => {
          const extent = interval(component);
          const selected = component.id === selectedId;
          return <g key={component.id} data-testid={`schematic-component-${component.id}`} role="button" tabIndex={0} aria-label={`Select ${component.name}, ${sourceDepthText(component, design)}, outer annulus not reported`} aria-pressed={selected} onClick={() => onSelect(component.id)} onKeyDown={(event) => selectOnKey(event, component.id)}>
            <rect x="282" y={extent.top} width="16" height={extent.height} fill="url(#sw-construction-cement)" stroke={selected ? "#ff6a00" : "#9b8d6d"} strokeWidth={selected ? 3.5 : 1} opacity={selectedId && !selected ? 0.35 : 1} strokeDasharray="3 2" />
            <title>{`${component.name} / placement interval only / outer annulus not reported / ${sourceLink(component, design)}`}</title>
          </g>;
        })}
      </g>
      <text x="160" y="725" textAnchor="middle" className="sw-construction-note">Depth-aligned / widths compare relative outside diameter</text>
      </svg>
        <div className="sw-wellbore-legend"><span><i className="sw-legend-hole" />Nominal hole</span><span><i className="sw-legend-casing" />Casing OD</span><span><i className="sw-legend-cement" />Cement interval</span></div>
      </div>
      <section className="sw-construction-register" aria-label="Construction source records">
        <div className="sw-register-heading"><div><span>INSPECTABLE RECORDS</span><h3 className="sw-title">Equipment &amp; intervals<InfoTip label="About the records">Select a record or interval to inspect its source. Missing tops, IDs, wall thickness and cement annuli are not inferred.</InfoTip></h3></div><small>{records.length} records</small></div>
        <div className="sw-register-list">{records.map((component) => <CommandButton kind="selection" key={component.id} className={`sw-register-item ${component.id === selectedId ? "sw-register-item-selected" : ""}`} data-testid={`construction-record-${component.id}`} aria-pressed={component.id === selectedId} onClick={() => onSelect(component.id)}>
          <i style={{ backgroundColor: kindColor[component.kind] }} />
          <span><strong>{component.name}</strong><small>{sourceDepthText(component, design)}</small><small>{component.material} / {sourceLink(component, design)}</small></span>
        </CommandButton>)}</div>
      </section>
    </div>
  </section>;
}


export function CurvedSchematic({ design, components, selectedId, onSelect, layersVisible = false, mode, onModeChange }: { design: WellDesign; components: readonly WellComponent[]; selectedId: string; onSelect: (id: ComponentId) => void; layersVisible?: boolean; mode?: "construction" | "depth" | "trajectory"; onModeChange?: (mode: "construction" | "depth" | "trajectory") => void }) {
  const selected = components.find((component) => component.id === selectedId);
  const [internalMode, setInternalMode] = useState<"construction" | "depth" | "trajectory">(design.provenance === "synthetic" ? "trajectory" : "construction");
  const schematicMode = mode ?? internalMode;
  const changeMode = onModeChange ?? setInternalMode;
  return <div className="sw-well-schematic" role="group" aria-label="Well construction and trajectory schematics">
    <nav className="sw-schematic-tabs" aria-label="Schematic view">
      <CommandButton kind="selection" aria-label="Well construction schematic" aria-pressed={schematicMode === "construction"} onClick={() => changeMode("construction")}>Well construction</CommandButton>
      <CommandButton kind="selection" aria-label="Interval data table" aria-pressed={schematicMode === "depth"} onClick={() => changeMode("depth")}>Depth program</CommandButton>
      <CommandButton kind="selection" aria-label="Trajectory profile" aria-pressed={schematicMode === "trajectory"} onClick={() => changeMode("trajectory")}>Trajectory</CommandButton>
    </nav>
    {schematicMode === "construction" && <ConstructionSection design={design} components={components} selectedId={selectedId} onSelect={onSelect} layersVisible={layersVisible} />}
    {schematicMode === "depth" && <DepthProgram design={design} components={components} selectedId={selectedId} onSelect={onSelect} />}
    {schematicMode === "trajectory" && <TrajectoryProfile design={design} selected={selected} layersVisible={layersVisible} onSelect={onSelect} />}
    {selected && <div className="sw-schematic-selected" aria-live="polite"><strong>{selected.name}</strong><span>{sourceDepthText(selected, design)}</span><span>{selected.material}</span><span>{sourceLink(selected, design)}</span></div>}
  </div>;
}

function number(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}