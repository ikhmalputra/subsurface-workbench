import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { dateToMs, msToDate } from "@ikhmalputra/subsurface-core/records";
import { useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";
import { forgeWell } from "../data/sites.ts";
import { fmt } from "../format.ts";
import { allDates, formatDate, installs, momentOn, span } from "../data/history.ts";
import { signals, useDeck } from "./store.ts";
import { useTimeline } from "./timeline.ts";
import type { Timeline } from "./timeline.ts";

const SOURCE = "deck:clock";
const { operations } = forgeWell;
const maxFt = Math.max(...operations.days.map((day) => day.mdFt ?? 0));
const reportByDate = new Map(operations.days.map((day) => [day.date, day]));
/** Report categories are data, so they get muted tints, never a signal colour. */
const categoryTint: Readonly<Record<string, string>> = {
  drilling: "var(--cat-drilling)", coring: "var(--cat-drilling)", tripping: "var(--cat-trip)", casing: "var(--cat-casing)", testing: "var(--cat-casing)",
  logging: "var(--cat-log)", circulating: "var(--cat-trip)", rig: "var(--cat-rig)", repair: "var(--cat-problem)", other: "var(--cat-rig)",
};
const STEP_MS = 170;
const go = (date: string | null) => signals.setTimeCursor(date === null ? null : dateToMs(date), SOURCE);

/**
 * The well's history from the first report to rig release, one calendar day per step. Scrub it,
 * step it with the arrow keys, or play it: every module that listens to time shows the well as its
 * reports left it that day. "As recorded" returns to the finished well.
 */
export function TimeRail() {
  const siteId = useDeck((deck) => deck.siteId);
  const cursorMs = useSubsurfaceSelector(signals, (state) => state.time?.cursorMs ?? null);
  const date = cursorMs === null ? null : msToDate(cursorMs);
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [hover, setHover] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const produced = useTimeline();
  // At FORGE a module may offer a second timeline (the stimulation); the rail shows it when it appears, and either on request.
  const [forgeView, setForgeView] = useState<"drilling" | "other">("other");
  const offered = siteId === "forge" && produced?.siteId === "forge" ? produced.label : null;
  useEffect(() => { if (offered) setForgeView("other"); }, [offered]);

  // Play: one day per step from where the cursor is (or the first report) to rig release.
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const now = signals.getState().time?.cursorMs ?? null;
      const at = now === null ? -1 : allDates.indexOf(msToDate(now));
      if (at >= allDates.length - 1) { setPlaying(false); return; }
      go(allDates[at + 1]!);
    }, STEP_MS);
    return () => window.clearInterval(timer);
  }, [playing]);
  useEffect(() => { if (siteId !== "forge") setPlaying(false); }, [siteId]);

  const area = useMemo(() => {
    // The drilled depth by day, as a profile hanging from the top of the rail: deeper is lower.
    const points = allDates.map((day, index) => `${(index + 0.5) / allDates.length * 100},${momentOn(day).asOf.drilledFt / maxFt * 100}`);
    return `M0,0 L${points.join(" L")} L100,0 Z`;
  }, []);

  const alternative = siteId === "forge" && produced?.siteId === "forge" ? produced : null;
  const switcher = alternative ? <span className="rail-switch" role="group" aria-label="Which timeline">
    <button type="button" aria-pressed={forgeView === "drilling"} onClick={() => setForgeView("drilling")}>Drilling</button>
    <button type="button" aria-pressed={forgeView === "other"} onClick={() => setForgeView("other")}>{alternative.short ?? alternative.label}</button>
  </span> : null;
  if (alternative && forgeView === "other") return <LifeRail line={alternative} cursorMs={cursorMs} switcher={switcher} />;
  if (siteId !== "forge") return produced && produced.siteId === siteId ? <LifeRail line={produced} cursorMs={cursorMs} /> : <div className="rail is-time" data-origin="clock"><span className="rail-label is-time"><i />Time</span><span className="rail-label">{siteId ? "This site has no dated records to replay. A producing well's life appears here once its production is modelled." : "Replays a well's days. Choose Utah FORGE to drive time from here."}</span></div>;

  const pct = (day: string) => `${(allDates.indexOf(day) + 0.5) / allDates.length * 100}%`;
  const dateAt = (clientX: number) => {
    const box = track.current!.getBoundingClientRect();
    const index = Math.max(0, Math.min(allDates.length - 1, Math.floor((clientX - box.left) / box.width * allDates.length)));
    return allDates[index]!;
  };
  const down = (event: ReactPointerEvent<HTMLDivElement>) => { event.currentTarget.setPointerCapture(event.pointerId); dragging.current = true; setPlaying(false); go(dateAt(event.clientX)); };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const day = dateAt(event.clientX);
    setHover(day);
    if (dragging.current && day !== date) go(day);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = date === null ? allDates.length : allDates.indexOf(date);
    const to = (index: number) => { event.preventDefault(); go(allDates[Math.max(0, Math.min(allDates.length - 1, index))]!); };
    if (event.key === "ArrowRight") to(at + (event.shiftKey ? 7 : 1));
    else if (event.key === "ArrowLeft") to(at - (event.shiftKey ? 7 : 1));
    else if (event.key === "Home") to(0);
    else if (event.key === "End") to(allDates.length - 1);
    else if (event.key === " ") { event.preventDefault(); setPlaying((value) => !value); }
    else if (event.key === "Escape") { event.preventDefault(); go(null); }
  };
  const moment = date ? momentOn(date) : null;
  const shownHover = hover ? momentOn(hover) : null;
  return <div className="rail is-time" aria-label="Time rail" data-origin="clock">
    <span className="rail-label is-time"><i />Time</span>
    {switcher}
    <button type="button" className="rail-button" aria-label={playing ? "Pause the replay" : "Replay the well day by day"} title={playing ? "Pause (space)" : "Replay from spud (space)"}
      onClick={() => { if (!playing && (date === null || date === allDates.at(-1))) go(allDates[0]!); setPlaying(!playing); }}>{playing ? <Pause size={13} /> : <Play size={13} />}</button>
    <div className="rail-track time-track" ref={track} role="slider" tabIndex={0} aria-label="Day in the well's history" aria-valuemin={0} aria-valuemax={allDates.length - 1}
      aria-valuenow={date ? allDates.indexOf(date) : allDates.length - 1} aria-valuetext={date ? `${formatDate(date)}, ${moment?.asOf.report?.headline ?? "no daily report"}` : "As finally recorded"}
      onPointerDown={down} onPointerMove={move} onPointerUp={() => { dragging.current = false; }} onPointerLeave={() => setHover(null)} onKeyDown={key}>
      <svg className="time-profile" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d={area} /></svg>
      {allDates.map((day) => { const report = reportByDate.get(day); return report ? <i key={day} className="time-day" style={{ left: pct(day), ["--tint" as string]: categoryTint[report.category] ?? "var(--cat-rig)" }} /> : null; })}
      {operations.milestones.map((milestone) => <span key={milestone.id} className="time-milestone" style={{ left: pct(milestone.date) }} title={`${milestone.label} · ${formatDate(milestone.date)}${milestone.mdFt ? ` · ${fmt(milestone.mdFt)} ft` : ""} · p. ${milestone.page}`} />)}
      {installs.map((event) => <span key={`${event.componentId}-${event.date}`} className="time-install" style={{ left: pct(event.date) }} title={`${event.label} · ${formatDate(event.date)} · p. ${event.page}`} />)}
      {hover && hover !== date && <span className="time-mark is-hover" style={{ left: pct(hover) }} />}
      {date && <span className="time-mark" style={{ left: pct(date) }} />}
      {shownHover && hover !== date && <span className="time-tip" style={{ left: pct(hover!) }}>{formatDate(hover!)} · {shownHover.asOf.report ? shownHover.asOf.report.headline.toLowerCase() : "no daily report"}</span>}
    </div>
    <span className="rail-value">{moment ? <>Day {moment.asOf.dayFromSpud} · {formatDate(moment.date)} · {fmt(moment.asOf.drilledFt)} ft</> : <>As recorded · {formatDate(span.spud ?? span.first)} → {formatDate(span.last)}</>}</span>
    {date && <button type="button" className="rail-button" aria-label="Show the well as finally recorded" title="As recorded (Esc)" onClick={() => { setPlaying(false); go(null); }}><RotateCcw size={13} /></button>}
  </div>;
}

/** A producing well's life on the rail: history to today, the forecast after; scrub it like the drilling days. */
function LifeRail({ line, cursorMs, switcher = null }: { readonly line: Timeline; readonly cursorMs: number | null; readonly switcher?: ReactNode }) {
  const track = useRef<HTMLDivElement>(null), dragging = useRef(false);
  const span = line.endMs - line.startMs || 1, pct = (ms: number) => `${Math.max(0, Math.min(100, (ms - line.startMs) / span * 100))}%`;
  const at = (clientX: number) => { const box = track.current!.getBoundingClientRect(); return line.startMs + Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * span; };
  const stepMs = line.stepMs ?? 86400000, describe = line.describe ?? ((ms: number) => `${new Date(ms).toISOString().slice(0, 7)} · ${ms > line.todayMs ? "forecast" : "history"}`);
  const set = (ms: number | null) => signals.setTimeCursor(ms === null ? null : Math.round(ms / stepMs) * stepMs, SOURCE);
  const area = `M0,100 ${line.profile.map((v, i) => `L${(i / Math.max(1, line.profile.length - 1)) * 100},${100 - v * 92}`).join(" ")} L100,100 Z`;
  const inSpan = cursorMs !== null && cursorMs >= line.startMs && cursorMs <= line.endMs;
  return <div className="rail is-time" aria-label="Time rail" data-origin="clock">
    <span className="rail-label is-time"><i />Time</span>
    {switcher}
    <div className="rail-track time-track life-track" ref={track} role="slider" tabIndex={0} aria-label={line.label} aria-valuemin={line.startMs} aria-valuemax={line.endMs} aria-valuenow={cursorMs ?? line.todayMs}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragging.current = true; set(at(event.clientX)); }}
      onPointerMove={(event) => { if (dragging.current) set(at(event.clientX)); }} onPointerUp={() => { dragging.current = false; }}
      onKeyDown={(event) => { const now = cursorMs ?? line.todayMs, month = line.stepMs ? (line.endMs - line.startMs) / 100 : 30.4 * 86400000; if (event.key === "ArrowRight") { event.preventDefault(); set(Math.min(line.endMs, now + month)); } else if (event.key === "ArrowLeft") { event.preventDefault(); set(Math.max(line.startMs, now - month)); } else if (event.key === "Escape") set(null); }}>
      <svg className="time-profile life-profile" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d={area} /></svg>
      <span className="life-future" style={{ left: pct(line.todayMs) }} />
      {line.marks.map((mark) => <span key={mark.ms + mark.label} className="time-milestone" style={{ left: pct(mark.ms) }} title={mark.label} />)}
      <span className="time-mark is-today" style={{ left: pct(line.todayMs) }} />
      {inSpan && <span className="time-mark" style={{ left: pct(cursorMs) }} />}
    </div>
    <span className="rail-value">{inSpan ? describe(cursorMs) : line.describe ? line.label : <>{line.label} · today {new Date(line.todayMs).toISOString().slice(0, 7)}</>}</span>
    {inSpan && <button type="button" className="rail-button" aria-label="Back to today" title="Today (Esc)" onClick={() => set(null)}><RotateCcw size={13} /></button>}
  </div>;
}
