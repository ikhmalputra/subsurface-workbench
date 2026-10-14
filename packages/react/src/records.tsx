"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { scaleLinear } from "d3-scale";
import { useDepthZoom } from "./depth-zoom.js";
import { daysVsDepth, feetToMetres, intervalsOverlap, lasCurve, metresToFeet, type DayCategory, type HoleSectionRecord, type LasFile, type RunKind, type ServiceRun, type WellDay, type WellOperations } from "@ikhmalputra/subsurface-core";
import { AccessibleTable } from "./accessible-table.js";
import { CommandButton } from "./ui.js";

/** Measured-depth interval in feet, inclusive. */
export interface DepthRange {
  readonly topFt: number;
  readonly baseFt: number;
}

const int = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 0 });
const feet = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${int(value)} ft`);
const dualDepth = (value: number) => `${int(value)} ft · ${int(feetToMetres(value))} m`;
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const overlaps = (top: number, base: number, range: DepthRange) => intervalsOverlap(top, base, range.topFt, range.baseFt);
const fractions: Record<string, string> = { "0.25": " 1/4", "0.5": " 1/2", "0.75": " 3/4" };
const bitSize = (inches: number) => `${Math.floor(inches)}${fractions[String(inches % 1)] ?? ""} in`;

/** Interval drilled in a daily report: [MD − footage, MD], or the reported MD when nothing was drilled. */
export function dayInterval(day: WellDay): DepthRange | null {
  if (day.mdFt === null) return null;
  return { topFt: day.mdFt - (day.footageFt ?? 0), baseFt: day.mdFt };
}

function Pager({ page, count, onChange, label }: { readonly page: number; readonly count: number; readonly onChange: (page: number) => void; readonly label: string }) {
  if (count <= 1) return null;
  return <div className="sw-rec-pager">
    <CommandButton type="button" aria-label={`Previous ${label} page`} disabled={page === 0} onClick={() => onChange(page - 1)}><ChevronLeft size={15} aria-hidden /></CommandButton>
    <span>Page {page + 1} of {count}</span>
    <CommandButton type="button" aria-label={`Next ${label} page`} disabled={page >= count - 1} onClick={() => onChange(page + 1)}><ChevronRight size={15} aria-hidden /></CommandButton>
  </div>;
}

const categoryLabels: Record<DayCategory, string> = { drilling: "Drilling", tripping: "Tripping", casing: "Casing & cement", rig: "Rig up / BOP", circulating: "Circulate / ream", logging: "Logging", coring: "Coring", testing: "Testing", repair: "Repair", other: "Other" };

export interface WellHistoryLogProps {
  readonly operations: WellOperations;
  /** Highlights and optionally filters days whose drilled interval overlaps this range. */
  readonly selectedRange?: DepthRange | null;
  readonly focusDate?: string | null;
  readonly onSelectDay?: (day: WellDay) => void;
  readonly pageSize?: number;
  readonly title?: string;
}

/** Day-by-day operations history with search, activity filter, depth-interval filter and expandable report detail. */
export function WellHistoryLog({ operations, selectedRange = null, focusDate = null, onSelectDay, pageSize = 8, title = "Daily history" }: WellHistoryLogProps) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<DayCategory | "all">("all");
  const [inRange, setInRange] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [page, setPage] = useState(0);
  const [followed, setFollowed] = useState<string | null>(focusDate);
  const categories = [...new Set(operations.days.map((day) => day.category))];
  const needle = search.trim().toLowerCase();
  const matching = operations.days.filter((day) => {
    if (category !== "all" && day.category !== category) return false;
    if (inRange && selectedRange) { const interval = dayInterval(day); if (!interval || !overlaps(interval.topFt, interval.baseFt, selectedRange)) return false; }
    return !needle || `${day.headline} ${day.activities.join(" ")} ${day.planned}`.toLowerCase().includes(needle);
  });
  const pageCount = Math.max(1, Math.ceil(matching.length / pageSize));
  if (focusDate !== followed) {
    setFollowed(focusDate);
    const index = matching.findIndex((day) => day.date === focusDate);
    if (index >= 0) { setPage(Math.floor(index / pageSize)); setOpen((current) => new Set(current).add(focusDate as string)); }
  }
  const current = Math.min(page, pageCount - 1);
  const rows = matching.slice(current * pageSize, (current + 1) * pageSize);
  const toggle = (date: string) => setOpen((current) => { const next = new Set(current); if (next.has(date)) next.delete(date); else next.add(date); return next; });
  const reset = () => setPage(0);

  return <section className="sw-rec" aria-label={title} data-testid="well-history-log">
    <header className="sw-rec-head"><h3>{title}</h3><span>{matching.length} of {operations.days.length} reports</span></header>
    <div className="sw-rec-filters">
      <label htmlFor={`${id}-q`}>Search</label>
      <input id={`${id}-q`} type="search" placeholder="e.g. packer, FIT, stuck" value={search} onChange={(event) => { setSearch(event.target.value); reset(); }} />
      <label htmlFor={`${id}-c`}>Activity</label>
      <select id={`${id}-c`} value={category} onChange={(event) => { setCategory(event.target.value as DayCategory | "all"); reset(); }}>
        <option value="all">All activity</option>
        {categories.map((value) => <option key={value} value={value}>{categoryLabels[value]} ({operations.days.filter((day) => day.category === value).length})</option>)}
      </select>
      {selectedRange && <label className="sw-rec-check"><input type="checkbox" checked={inRange} onChange={(event) => { setInRange(event.target.checked); reset(); }} /> Only {int(selectedRange.topFt)}–{int(selectedRange.baseFt)} ft</label>}
    </div>
    <ol className="sw-rec-days">
      {rows.map((day) => {
        const interval = dayInterval(day);
        const hit = Boolean(selectedRange && interval && overlaps(interval.topFt, interval.baseFt, selectedRange));
        const expanded = open.has(day.date);
        return <li key={day.date} className={`${hit ? "is-in-range" : ""} ${day.date === focusDate ? "is-focus" : ""}`} data-testid="history-day">
          <div className="sw-rec-day-row">
            <CommandButton kind="selection" type="button" className="sw-rec-day-main" aria-pressed={day.date === focusDate} onClick={() => onSelectDay?.(day)}>
              <span className="sw-rec-date"><strong>{shortDate(day.date)}</strong><small>{day.dayFromSpud >= 0 ? `Day ${day.dayFromSpud}` : `Pre-spud ${day.dayFromSpud}`}</small></span>
              <span className="sw-rec-headline"><span className={`sw-rec-chip is-${day.category}`}>{categoryLabels[day.category]}</span>{day.headline}</span>
              <span className="sw-rec-nums">{day.mdFt === null ? <span>No depth</span> : <span>MD {feet(day.mdFt)}</span>}{day.footageFt ? <span>+{feet(day.footageFt)}</span> : null}{day.mudWeightPpg ? <span>{day.mudWeightPpg} ppg</span> : null}</span>
            </CommandButton>
            <CommandButton type="button" className="sw-rec-expand" aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} report for ${shortDate(day.date)}`} onClick={() => toggle(day.date)}><ChevronDown size={16} aria-hidden /></CommandButton>
          </div>
          {expanded && <div className="sw-rec-detail">
            <ol>{day.activities.map((activity, index) => <li key={index}>{activity}</li>)}</ol>
            {day.planned && <p><strong>Planned:</strong> {day.planned}</p>}
            <p className="sw-rec-cite">{day.tvdFt !== null && <>TVD {feet(day.tvdFt)} · </>}Daily operations summary, p. {day.page}</p>
          </div>}
        </li>;
      })}
    </ol>
    {!rows.length && <p className="sw-rec-empty">No reports match.</p>}
    <Pager page={current} count={pageCount} onChange={setPage} label="history" />
  </section>;
}

export interface DaysVsDepthChartProps {
  readonly operations: WellOperations;
  readonly focusDate?: string | null;
  readonly onSelectDay?: (day: WellDay) => void;
  readonly title?: string;
  /**
   * Shared measured-depth cursor, in metres.
   *
   * This is the only view in the application on the axis the drilling stage actually reasons on —
   * date and measured depth together — and it could neither accept a depth nor emit one, so the
   * question "why did this interval take so long" was answered by reading four views in sequence
   * and holding the depth in your head. The Y axis is already measured depth, so the cursor is an
   * exact horizontal line and nothing is interpolated to draw it.
   */
  readonly cursorMdM?: number | null;
  /** Emitted with the depth under the pointer, alongside `onSelectDay` for the day under it. */
  readonly onSelectMd?: (mdM: number) => void;
}

const sectionFill = ["#eef4f0", "#e6eef6", "#f6efe4", "#efe9f5"];

/** Classic drilling days-versus-depth curve with hole sections, milestones and a selectable day cursor. */
export function DaysVsDepthChart({ operations, focusDate = null, onSelectDay, title = "Days vs depth", cursorMdM = null, onSelectMd }: DaysVsDepthChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const points = daysVsDepth(operations);
  const width = 560, height = 340, margin = { top: 16, right: 18, bottom: 34, left: 58 };
  const maxDay = Math.max(1, ...points.map((point) => point.day));
  const maxMd = Math.max(1, ...points.map((point) => point.mdFt), ...operations.sections.map((section) => section.baseFt));
  const x = scaleLinear().domain([0, maxDay]).range([margin.left, width - margin.right]);
  const y = scaleLinear().domain([0, maxMd]).range([margin.top, height - margin.bottom]).nice();
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(point.day).toFixed(1)},${y(point.mdFt).toFixed(1)}`).join("");
  const focus = operations.days.find((day) => day.date === focusDate);
  const byDay = new Map(operations.days.map((day) => [day.dayFromSpud, day]));

  // Runs that did not complete, on the only axis they have. The records carry depths and an outcome
  // but no dates, so they are drawn across the plot at their depths rather than placed on the day
  // axis — inventing a date for them would be inventing evidence.
  //
  // Five of FORGE's nine report a base depth and no top. Those are drawn as a line at the base
  // rather than a band, because a band would have to invent a top; a run with neither depth is not
  // drawn at all and the legend says how many.
  const troubleRuns = operations.runs.filter((run) => run.outcome !== "completed");
  const placedRuns = troubleRuns.filter((run) => run.baseFt !== null);
  const cursorFt = cursorMdM === null ? null : metresToFeet(cursorMdM);

  function pick(event: PointerEvent<SVGSVGElement>) {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const day = Math.round(x.invert(((event.clientX - box.left) / box.width) * width));
    const hit = byDay.get(Math.max(0, Math.min(maxDay, day)));
    if (hit) onSelectDay?.(hit);
    // The pointer carries a depth as well as a day, and the depth is what every other view reads.
    const depthFt = y.invert(((event.clientY - box.top) / box.height) * height);
    if (onSelectMd && depthFt >= 0 && depthFt <= maxMd) onSelectMd(feetToMetres(depthFt));
  }

  return <figure className="sw-rec sw-dvd" data-testid="days-vs-depth">
    <figcaption className="sw-rec-head"><h3>{title}</h3><span>{maxDay} days spud → last report · TD {feet(maxMd)}</span></figcaption>
    <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}: ${points.length} daily depths from spud to ${feet(points.at(-1)?.mdFt)}. ${placedRuns.length} of ${troubleRuns.length} runs that ended with a problem or failure are marked at their reported depths. Click to select a day and a depth.`} onPointerDown={pick}>
      {operations.sections.map((section, index) => <g key={section.id}>
        <rect x={margin.left} y={y(section.topFt)} width={width - margin.left - margin.right} height={Math.max(0, y(section.baseFt) - y(section.topFt))} fill={sectionFill[index % sectionFill.length]} />
        <text x={width - margin.right - 6} y={y(section.topFt) + 13} textAnchor="end" className="sw-dvd-band">{section.name} · {bitSize(section.bitSizeIn)}</text>
      </g>)}
      {y.ticks(6).map((tick) => <g key={tick}><line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} className="sw-dvd-grid" /><text x={margin.left - 6} y={y(tick) + 3} textAnchor="end" className="sw-dvd-tick">{int(tick)}</text></g>)}
      {x.ticks(8).map((tick) => <text key={tick} x={x(tick)} y={height - margin.bottom + 14} textAnchor="middle" className="sw-dvd-tick">{tick}</text>)}
      <text x={(margin.left + width - margin.right) / 2} y={height - 4} textAnchor="middle" className="sw-dvd-axis">Days from spud</text>
      <text transform={`translate(12 ${(margin.top + height - margin.bottom) / 2}) rotate(-90)`} textAnchor="middle" className="sw-dvd-axis">Measured depth (ft)</text>
      <path d={path} className="sw-dvd-line" />
      {operations.milestones.filter((event) => event.mdFt !== null).map((event) => {
        const day = operations.days.find((item) => item.date === event.date)?.dayFromSpud ?? 0;
        return <circle key={event.id} cx={x(Math.max(0, day))} cy={y(event.mdFt as number)} r={4.5} className="sw-dvd-milestone"><title>{`${event.label} · ${shortDate(event.date)} · ${feet(event.mdFt)}`}</title></circle>;
      })}
      {placedRuns.map((run) => {
        const base = run.baseFt as number;
        const topReported = run.topFt !== null;
        return <g key={run.id} className="sw-dvd-trouble" data-run-id={run.id} data-outcome={run.outcome} data-top-reported={String(topReported)}>
          {topReported
            ? <rect x={margin.left} y={y(run.topFt as number)} width={width - margin.left - margin.right} height={Math.max(2, y(base) - y(run.topFt as number))} />
            : <line x1={margin.left} x2={width - margin.right} y1={y(base)} y2={y(base)} />}
          <title>{`${run.id} · ${runKindLabels[run.kind]} · ${run.outcome} · ${topReported ? `${feet(run.topFt)}–${feet(base)}` : `base ${feet(base)}, top not reported`} · ${run.summary}`}</title>
        </g>;
      })}
      {cursorFt !== null && cursorFt >= 0 && cursorFt <= maxMd && <g className="sw-dvd-depth-cursor" data-cursor-ft={cursorFt.toFixed(1)}>
        <line x1={margin.left} x2={width - margin.right} y1={y(cursorFt)} y2={y(cursorFt)} />
        <text x={margin.left + 4} y={y(cursorFt) - 4} className="sw-dvd-tick">{feet(cursorFt)}</text>
      </g>}
      {focus && focus.dayFromSpud >= 0 && <g className="sw-dvd-focus">
        <line x1={x(focus.dayFromSpud)} x2={x(focus.dayFromSpud)} y1={margin.top} y2={height - margin.bottom} />
        {focus.mdFt !== null && <circle cx={x(focus.dayFromSpud)} cy={y(focus.mdFt)} r={6} />}
      </g>}
    </svg>
    {troubleRuns.length > 0 && <p className="sw-dvd-legend"><span><i aria-hidden="true" />{troubleRuns.length} of {operations.runs.length} runs ended with a problem or failure. {placedRuns.length} report a depth and are marked{placedRuns.length !== troubleRuns.length ? `; ${troubleRuns.length - placedRuns.length} report none` : ""}. {placedRuns.filter((run) => run.topFt === null).length} report a base and no top, drawn as a line rather than an interval. The records carry no dates, so none is placed on the day axis.</span></p>}
    <ul className="sw-dvd-events" aria-label="Milestones">
      {operations.milestones.map((event) => {
        const day = operations.days.find((item) => item.date === event.date);
        return <li key={event.id}><CommandButton kind="selection" type="button" disabled={!day} aria-pressed={Boolean(day && day.date === focusDate)} onClick={() => day && onSelectDay?.(day)}><strong>{event.label}</strong><small>{shortDate(event.date)}{event.mdFt !== null ? ` · ${feet(event.mdFt)}` : ""}</small></CommandButton></li>;
      })}
    </ul>
    <p className="sw-sr-only">{points.length} reported daily measured-depth values over {maxDay} days from spud. The chart uses measured depth in feet and omits days with unreported depth.</p>
    <AccessibleTable label="daily depth progress" description="Reported days from spud and measured depths; days without reported depth are not plotted." columns={[{ label: "Date" }, { label: "Day from spud", unit: "days" }, { label: "Measured depth", unit: "ft" }, { label: "Measured depth", unit: "m" }]} rowCount={points.length} getRows={(start, end) => points.slice(start, end).map((point) => [point.date, point.day, point.mdFt, feetToMetres(point.mdFt)])} />
  </figure>;
}

const runKindLabels: Record<RunKind, string> = { drilling: "Drilling", coring: "Coring", cleanout: "Clean-out", reaming: "Reaming", survey: "Survey", cooldown: "Cooldown", test: "Test", fishing: "Fishing", logging: "Logging", plugback: "Plug back", milling: "Milling" };

export interface ServiceRunLogProps {
  readonly operations: WellOperations;
  readonly selectedRange?: DepthRange | null;
  readonly focusRunId?: string | null;
  readonly onSelectRun?: (run: ServiceRun) => void;
  readonly title?: string;
}

/** Bottom-hole-assembly and service run register with type/outcome filters and depth-interval highlighting. */
export function ServiceRunLog({ operations, selectedRange = null, focusRunId = null, onSelectRun, title = "Service & BHA runs" }: ServiceRunLogProps) {
  const id = useId();
  const [kind, setKind] = useState<RunKind | "all">("all");
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [inRange, setInRange] = useState(false);
  const kinds = [...new Set(operations.runs.map((run) => run.kind))];
  const rows = operations.runs.filter((run) => {
    if (kind !== "all" && run.kind !== kind) return false;
    if (issuesOnly && run.outcome === "completed") return false;
    if (inRange && selectedRange) { const top = run.topFt ?? run.baseFt, base = run.baseFt ?? run.topFt; if (top === null || base === null || !overlaps(top, base, selectedRange)) return false; }
    return true;
  });
  const drilled = operations.runs.filter((run) => run.kind === "drilling" || run.kind === "coring").reduce((sum, run) => sum + (run.footageFt ?? 0), 0);
  const issues = operations.runs.filter((run) => run.outcome !== "completed").length;

  return <section className="sw-rec" aria-label={title} data-testid="service-run-log">
    <header className="sw-rec-head"><h3>{title}</h3><span>{operations.runs.length} runs · {int(drilled)} ft drilled/cored · {issues} with problems</span></header>
    <div className="sw-rec-filters">
      <label htmlFor={`${id}-k`}>Type</label>
      <select id={`${id}-k`} value={kind} onChange={(event) => setKind(event.target.value as RunKind | "all")}>
        <option value="all">All types</option>
        {kinds.map((value) => <option key={value} value={value}>{runKindLabels[value]} ({operations.runs.filter((run) => run.kind === value).length})</option>)}
      </select>
      <label className="sw-rec-check"><input type="checkbox" checked={issuesOnly} onChange={(event) => setIssuesOnly(event.target.checked)} /> Problems only</label>
      {selectedRange && <label className="sw-rec-check"><input type="checkbox" checked={inRange} onChange={(event) => setInRange(event.target.checked)} /> Only {int(selectedRange.topFt)}–{int(selectedRange.baseFt)} ft</label>}
    </div>
    <div className="sw-rec-table-wrap">
      <table className="sw-rec-table">
        <caption className="sw-rec-sr">{title}: run, type, interval, footage, average ROP, outcome and source page</caption>
        <thead><tr><th scope="col">Run</th><th scope="col">Type</th><th scope="col">Interval</th><th scope="col">Footage</th><th scope="col">ROP</th><th scope="col">Outcome</th><th scope="col">Page</th></tr></thead>
        <tbody>
          {rows.map((run) => {
            const top = run.topFt ?? run.baseFt, base = run.baseFt ?? run.topFt;
            const hit = Boolean(selectedRange && top !== null && base !== null && overlaps(top, base, selectedRange));
            return <tr key={run.id} className={`${hit ? "is-in-range" : ""} ${run.id === focusRunId ? "is-focus" : ""}`} data-testid="service-run">
              <th scope="row"><CommandButton kind="selection" type="button" aria-pressed={run.id === focusRunId} onClick={() => onSelectRun?.(run)}>{run.id}</CommandButton></th>
              <td><span className={`sw-rec-chip is-run-${run.kind}`}>{runKindLabels[run.kind]}</span><small>{run.summary}</small></td>
              <td className="sw-rec-num">{run.topFt !== null && run.baseFt !== null && run.topFt !== run.baseFt ? `${int(run.topFt)}–${int(run.baseFt)} ft` : run.baseFt !== null ? `at ${int(run.baseFt)} ft` : "—"}</td>
              <td className="sw-rec-num">{feet(run.footageFt)}</td>
              <td className="sw-rec-num">{run.avgRopFph === null ? "—" : `${run.avgRopFph} ft/h`}</td>
              <td><span className={`sw-rec-outcome is-${run.outcome}`}>{run.outcome}</span></td>
              <td className="sw-rec-num">p. {run.page}</td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    {!rows.length && <p className="sw-rec-empty">No runs match.</p>}
  </section>;
}

export interface HoleSectionLogProps {
  readonly operations: WellOperations;
  readonly selectedComponentId?: string | null;
  readonly onSelectSection?: (section: HoleSectionRecord) => void;
  readonly title?: string;
}

/** Per-hole-section summary: bit size, interval, casing, runs, footage, ROP and calendar span. */
export function HoleSectionLog({ operations, selectedComponentId = null, onSelectSection, title = "Hole sections" }: HoleSectionLogProps) {
  const total = Math.max(1, ...operations.sections.map((section) => section.baseFt));
  return <section className="sw-rec sw-sections" aria-label={title} data-testid="hole-section-log">
    <header className="sw-rec-head"><h3>{title}</h3><span>{operations.sections.length} sections · TD {feet(total)}</span></header>
    <ol>
      {operations.sections.map((section) => {
        const active = selectedComponentId === section.holeComponentId || selectedComponentId === section.casingComponentId;
        const days = section.firstDate && section.lastDate ? Math.round((Date.parse(section.lastDate) - Date.parse(section.firstDate)) / 86_400_000) + 1 : null;
        return <li key={section.id}>
          <CommandButton kind="selection" type="button" aria-pressed={active} onClick={() => onSelectSection?.(section)}>
            <span className="sw-sections-bar" aria-hidden><i style={{ top: `${(section.topFt / total) * 100}%`, height: `${Math.max(3, ((section.baseFt - section.topFt) / total) * 100)}%` }} /></span>
            <span className="sw-sections-body">
              <strong>{section.name} · {bitSize(section.bitSizeIn)}</strong>
              <span>{dualDepth(section.topFt)} → {dualDepth(section.baseFt)}</span>
              <span>{section.casing}</span>
              <span className="sw-sections-stats"><b>{section.runCount}</b> runs{section.problemRuns ? <> · <b>{section.problemRuns}</b> with problems</> : null} · <b>{int(section.drilledFt)}</b> ft · {section.avgRopFph === null ? "ROP —" : <><b>{section.avgRopFph}</b> ft/h avg</>}{days ? <> · <b>{days}</b> report days</> : null}</span>
            </span>
          </CommandButton>
        </li>;
      })}
    </ol>
  </section>;
}

export interface LogTrackSpec {
  readonly mnemonic: string;
  readonly label?: string;
  readonly color?: string;
  readonly min?: number;
  readonly max?: number;
}

export interface LogInterval extends DepthRange {
  readonly id: string;
  readonly label: string;
  readonly tone?: "neutral" | "problem" | "failed";
}

export interface LogTracksProps {
  readonly las: LasFile;
  readonly tracks: readonly LogTrackSpec[];
  /** Horizontal markers such as casing shoes. */
  readonly markers?: readonly { readonly depthFt: number; readonly label: string }[];
  /** Interval column, e.g. BHA runs. */
  readonly intervals?: readonly LogInterval[];
  readonly selectedRange?: DepthRange | null;
  readonly cursorFt?: number | null;
  readonly onSelectDepth?: (depthFt: number) => void;
  /** Reports the depth under the pointer (ft), `null` when it leaves. */
  readonly onCursorChange?: (depthFt: number | null) => void;
  /** Controlled depth window `[top, base]` in ft; `null` shows the full log. Leave `undefined` for an independent view. */
  readonly depthWindowFt?: readonly [number, number] | null;
  /** Reports zoom and pan (buttons, Ctrl/⌘ + wheel, wheel) so other depth views can follow. */
  readonly onDepthWindowChange?: (window: readonly [number, number] | null) => void;
  /** Handle zoom and pan gestures on the tracks (default); a host depth surface turns this off. */
  readonly depthGestures?: boolean;
  readonly height?: number;
  readonly title?: string;
  /**
   * Render as a track on a shared depth axis: a fixed plot inset so the container can align every
   * track's depth scale, the window taken as given rather than clamped to the log's own extent
   * (empty space beyond the data is correct when the axis is shared), and no header of its own.
   */
  readonly frame?: TrackFrame;
}

/** Plot inset for a view drawn as a track on a shared depth axis. */
// The depth-track contract is declared once, by the schematic; every track honours the same inset.
// It was declared here as well, identically, which is how three tracks came to agree by accident.
import type { TrackFrame } from "./assembly-schematic.tsx";
export type { TrackFrame };

function percentile(values: readonly number[], p: number) {
  if (!values.length) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 1;
}

/** Multi-track depth log (LAS) with casing markers, an interval column, hover readout and click-to-depth. */
export function LogTracks({ las, tracks, markers = [], intervals = [], selectedRange = null, cursorFt = null, onSelectDepth, onCursorChange, depthWindowFt, onDepthWindowChange, height = 620, title = "Depth log", frame: trackFrame, depthGestures = true }: LogTracksProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const index = las.curves[0];
  const depths = useMemo(() => (index?.values ?? []).map((value) => value ?? Number.NaN), [index]);
  const first = depths.find(Number.isFinite) ?? 0;
  const last = [...depths].reverse().find(Number.isFinite) ?? 1;
  const [ownWindow, setOwnWindow] = useState<readonly [number, number] | null>(null);
  const [hover, setHoverState] = useState<number | null>(null);
  const setHover = (depth: number | null) => { setHoverState(depth); onCursorChange?.(depth); };
  if (depthWindowFt !== undefined && (depthWindowFt?.[0] !== ownWindow?.[0] || depthWindowFt?.[1] !== ownWindow?.[1])) setOwnWindow(depthWindowFt);
  const depthWin = depthWindowFt !== undefined ? depthWindowFt : ownWindow;
  const clampWindow = (top: number, base: number) => {
    const span = Math.min(last - first, Math.max(20, base - top));
    const start = Math.min(Math.max(first, top), last - span);
    return { top: start, base: start + span };
  };
  // A framed track obeys the shared scale even where it has no samples; clamping to the log's
  // own extent would shift its mapping by the first sample depth and misalign it with every
  // track beside it.
  const view = trackFrame && depthWin ? { top: depthWin[0], base: depthWin[1] }
    : depthWin && depthWin[1] > first && depthWin[0] < last ? clampWindow(depthWin[0], depthWin[1]) : { top: first, base: last };
  const zoomed = view.base - view.top < last - first - 0.5;
  const setWindow = (next: readonly [number, number] | null) => {
    const value = next ? (() => { const c = clampWindow(next[0], next[1]); return c.base - c.top >= last - first - 0.5 ? null : [Math.round(c.top), Math.round(c.base)] as const; })() : null;
    setOwnWindow(value);
    onDepthWindowChange?.(value);
  };
  const selectionWindow = selectedRange ? [Math.max(first, selectedRange.topFt - 50), Math.min(last, selectedRange.baseFt + 50)] as const : null;
  const step = depths.length > 1 ? Math.abs((depths[1] ?? 0) - (depths[0] ?? 0)) || 1 : 1;
  const resolved = tracks.map((track) => {
    const curve = lasCurve(las, track.mnemonic);
    const values = curve?.values ?? [];
    const finite = values.filter((value): value is number => value !== null);
    return { ...track, curve, values, min: track.min ?? 0, max: track.max ?? Math.max(1, percentile(finite, 0.99)) };
  });
  const headerH = 46, depthW = 62, intervalW = intervals.length ? 30 : 0, trackW = 120;
  const width = depthW + intervalW + resolved.length * trackW;
  const y = scaleLinear().domain([view.top, view.base]).range(trackFrame ? [trackFrame.top, height - trackFrame.bottom] : [headerH + 4, height - 6]);
  const visible = depths.map((depth, i) => [depth, i] as const).filter(([depth]) => depth >= view.top - step && depth <= view.base + step);
  const nearest = (depth: number) => visible.reduce((best, item) => (Math.abs(item[0] - depth) < Math.abs(best[0] - depth) ? item : best), visible[0] ?? ([first, 0] as const));
  const shown = hover ?? cursorFt;
  const sample = shown === null ? null : nearest(shown);
  const tableColumns = [{ label: "Measured depth", unit: "ft" }, { label: "Measured depth", unit: "m" }, ...resolved.map((track) => ({ label: track.label ?? track.mnemonic, unit: track.curve?.unit ?? "" }))];

  function depthAt(event: PointerEvent<SVGSVGElement>) {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return null;
    const value = y.invert(((event.clientY - box.top) / box.height) * height);
    return Math.max(view.top, Math.min(view.base, Math.round(value)));
  }
  // The shared depth gestures (depth-zoom.ts) in the SVG's own units, on the log's extent in feet.
  useDepthZoom(svgRef, {
    enabled: depthGestures,
    window: zoomed ? [view.top, view.base] : null,
    axis: () => ({ extent: [first, last], plot: trackFrame ? [trackFrame.top, height - trackFrame.bottom] : [headerH + 4, height - 6], minSpan: Math.max(step * 4, 20) }),
    onWindow: setWindow,
  });

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "+" || event.key === "=" || event.key === "-") {
      event.preventDefault();
      const span = view.base - view.top, mid = hover ?? (view.top + view.base) / 2, next = span * (event.key === "-" ? 2 : 0.5);
      setWindow([mid - next / 2, mid + next / 2]);
      return;
    }
    if (event.key === "0") { event.preventDefault(); setWindow(null); return; }
    const base = hover ?? cursorFt ?? view.top;
    const delta = (event.shiftKey ? 10 : 1) * step;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setHover(Math.max(view.top, Math.min(view.base, base + (event.key === "ArrowDown" ? delta : -delta)))); }
    if (event.key === "Enter" && hover !== null) onSelectDepth?.(hover);
  }

  const readout = <div className="sw-logs-readout" aria-live="polite" data-testid="log-readout">
      {sample ? <><strong>{dualDepth(sample[0])}</strong>{resolved.map((track) => { const value = track.values[sample[1]]; return <span key={track.mnemonic}><i style={{ background: track.color ?? "#147a65" }} />{track.label ?? track.mnemonic} {value === null || value === undefined ? "—" : `${Math.round(value * 10) / 10} ${track.curve?.unit ?? ""}`}</span>; })}{intervals.filter((item) => sample[0] >= item.topFt && sample[0] <= item.baseFt).map((item) => <span key={item.id} className="sw-logs-run">{item.label}</span>)}</> : <span>Hover or use ↑/↓ on the log to read values; click or Enter selects that depth. Ctrl/⌘ + wheel or +/− zooms, wheel pans.</span>}
    </div>;
  return <section className="sw-rec sw-logs" aria-label={title} data-testid="log-tracks" data-track={trackFrame ? "true" : undefined}>
    {!trackFrame?.chromeless && <header className="sw-rec-head">
      <h3>{title}</h3>
      <div className="sw-logs-tools">
        <span>{int(view.top)}–{int(view.base)} ft</span>
        <CommandButton icon="fit" type="button" aria-pressed={!zoomed} onClick={() => setWindow(null)}>Full log</CommandButton>
        <CommandButton kind="selection" type="button" disabled={!selectionWindow} onClick={() => selectionWindow && setWindow(selectionWindow)}>Zoom to selection</CommandButton>
      </div>
    </header>}
    {!trackFrame?.chromeless && readout}
    <div className="sw-logs-frame" tabIndex={0} role="group" aria-label={`${title}. Arrow keys move the depth cursor, Shift for larger steps, Enter selects the depth. Plus and minus zoom, 0 shows the full log.`} onKeyDown={onKey} onBlur={() => setHover(null)}>
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} style={{ height, minWidth: width }} aria-hidden onPointerMove={(event) => setHover(depthAt(event))} onPointerLeave={() => setHover(null)} onPointerDown={(event) => { const depth = depthAt(event); if (depth !== null) onSelectDepth?.(depth); }}>
        <text x={depthW / 2} y={18} textAnchor="middle" className="sw-logs-label">MD</text>
        <text x={depthW / 2} y={32} textAnchor="middle" className="sw-logs-unit">ft</text>
        {y.ticks(10).map((tick) => <g key={tick}><line x1={depthW - 6} x2={width} y1={y(tick)} y2={y(tick)} className="sw-logs-grid" /><text x={depthW - 9} y={y(tick) + 3} textAnchor="end" className="sw-logs-tick">{int(tick)}</text></g>)}
        {selectedRange && <rect x={depthW} width={width - depthW} y={y(Math.max(view.top, selectedRange.topFt))} height={Math.max(2, y(Math.min(view.base, selectedRange.baseFt)) - y(Math.max(view.top, selectedRange.topFt)))} className="sw-logs-selection" />}
        {intervalW > 0 && <g>
          <text x={depthW + intervalW / 2} y={18} textAnchor="middle" className="sw-logs-label">Run</text>
          {intervals.filter((item) => item.baseFt >= view.top && item.topFt <= view.base).map((item) => <rect key={item.id} x={depthW + 5} width={intervalW - 10} y={y(Math.max(view.top, item.topFt))} height={Math.max(1.5, y(Math.min(view.base, item.baseFt)) - y(Math.max(view.top, item.topFt)))} className={`sw-logs-interval is-${item.tone ?? "neutral"}`}><title>{item.label}</title></rect>)}
        </g>}
        {resolved.map((track, t) => {
          const left = depthW + intervalW + t * trackW;
          const x = scaleLinear().domain([track.min, track.max]).range([left + 6, left + trackW - 6]).clamp(true);
          let d = "", pen = false;
          for (const [depth, i] of visible) {
            const value = track.values[i];
            if (value === null || value === undefined) { pen = false; continue; }
            d += `${pen ? "L" : "M"}${x(value).toFixed(1)},${y(depth).toFixed(1)}`;
            pen = true;
          }
          return <g key={track.mnemonic}>
            <line x1={left} x2={left} y1={0} y2={height} className="sw-logs-sep" />
            <text x={left + trackW / 2} y={16} textAnchor="middle" className="sw-logs-label" fill={track.color ?? "#147a65"}>{track.label ?? track.mnemonic}</text>
            <text x={left + 6} y={34} className="sw-logs-unit">{int(track.min)}</text>
            <text x={left + trackW - 6} y={34} textAnchor="end" className="sw-logs-unit">{int(track.max)} {track.curve?.unit ?? "?"}</text>
            <line x1={left + 6} x2={left + trackW - 6} y1={40} y2={40} stroke={track.color ?? "#147a65"} strokeWidth={2} />
            <path d={d} fill="none" stroke={track.color ?? "#147a65"} strokeWidth={1.1} vectorEffect="non-scaling-stroke" />
          </g>;
        })}
        {markers.filter((marker) => marker.depthFt >= view.top && marker.depthFt <= view.base).map((marker) => <g key={marker.label} className="sw-logs-marker"><line x1={depthW} x2={width} y1={y(marker.depthFt)} y2={y(marker.depthFt)} /><text x={width - 4} y={y(marker.depthFt) - 4} textAnchor="end">{marker.label}</text></g>)}
        {cursorFt !== null && cursorFt >= view.top && cursorFt <= view.base && <line x1={depthW} x2={width} y1={y(cursorFt)} y2={y(cursorFt)} className="sw-logs-cursor" />}
        {hover !== null && <line x1={depthW} x2={width} y1={y(hover)} y2={y(hover)} className="sw-logs-hover" />}
      </svg>
    </div>
    {/* As a track the readout sits under the plot, so the plot's top edge is the panel's top edge
        and lines up with the tracks beside it. */}
    {trackFrame?.chromeless && readout}
    <p className="sw-sr-only">{resolved.length} log tracks and {depths.length} samples from {int(first)} to {int(last)} ft measured depth. Null or invalid samples are reported as not reported in the table.</p>
    <AccessibleTable
      label={`${title} samples`}
      description="Columnar log samples at supplied depth keys. MD is provided in feet and converted to metres for display; null and non-finite samples are shown as not reported."
      columns={tableColumns}
      rowCount={depths.length}
      getRows={(start, end) => depths.slice(start, end).map((depth, offset) => {
        const index = start + offset;
        return [
          Number.isFinite(depth) ? depth : null,
          Number.isFinite(depth) ? feetToMetres(depth) : null,
          ...resolved.map((track) => {
            const value = track.values[index];
            return value === null || value === undefined || !Number.isFinite(value) ? null : value;
          }),
        ];
      })}
    />
  </section>;
}
