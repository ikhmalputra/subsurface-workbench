import { useState } from "react";
import { DaysVsDepthChart, HoleSectionLog, ServiceRunLog, WellHistoryLog } from "@ikhmalputra/subsurface-react/records";
import { forgeWell } from "../data/sites.ts";
import { feetToMetres as fromFt, metresToFeet as toFt } from "@ikhmalputra/subsurface-core";
import { dateToMs } from "@ikhmalputra/subsurface-core/records";
import { useMoment } from "../data/history.ts";
import { signals } from "../deck/store.ts";
import { useWire, type Wire } from "./wire.ts";

const { operations } = forgeWell;
/** The interval the drilling records filter to: the selected record's, else the shared window. */
const rangeOf = (wire: Wire) => wire.selected ? { topFt: toFt(wire.selected.topDepthM), baseFt: toFt(wire.selected.bottomDepthM) } : wire.window ? { topFt: toFt(wire.window[0]), baseFt: toFt(wire.window[1]) } : null;

/** Choosing a day moves the time cursor there: every time-aware module follows. */
const goTo = (date: string, source: string) => signals.setTimeCursor(dateToMs(date), source);

type Reading = "curve" | "sections" | "runs" | "reports";
const RECORDS: readonly { readonly id: Reading; readonly label: string }[] = [
  { id: "curve", label: "Days vs depth" }, { id: "sections", label: "Hole sections" }, { id: "runs", label: "Runs" }, { id: "reports", label: "Daily reports" },
];

/**
 * FORGE's drilling record in one tile: the curve, the hole sections, the runs and the daily reports
 * are four readings of the same operations, so they share one tile and one set of links. Choosing a
 * day moves the time cursor; a section selects its string; a run sets the depth window.
 */
export function DrillingRecord() {
  const wire = useWire("drilling");
  const moment = useMoment();
  const [shown, setShown] = useState<Reading>("curve");
  return <div className="construction">
    <div className="log-sets" role="tablist" aria-label="Drilling record">
      {RECORDS.map((entry) => <button key={entry.id} type="button" role="tab" aria-selected={shown === entry.id} aria-pressed={shown === entry.id} onClick={() => setShown(entry.id)}>{entry.label}</button>)}
    </div>
    <div className="construction-body plot-fill scroll" role="tabpanel">
      {shown === "curve" && <DaysVsDepthChart operations={operations} focusDate={moment?.date ?? null} cursorMdM={wire.cursor} onSelectMd={wire.pin} onSelectDay={(day) => goTo(day.date, wire.source)} title="Days vs depth" />}
      {shown === "sections" && <HoleSectionLog operations={operations} selectedComponentId={wire.componentId} onSelectSection={(section) => wire.select(section.casingComponentId || section.holeComponentId)} />}
      {shown === "runs" && <ServiceRunLog operations={operations} selectedRange={rangeOf(wire)} onSelectRun={(run) => { if (run.topFt !== null && run.baseFt !== null) wire.setWindow([fromFt(run.topFt), fromFt(run.baseFt)]); }} />}
      {shown === "reports" && <WellHistoryLog operations={operations} selectedRange={rangeOf(wire)} focusDate={moment?.date ?? null} onSelectDay={(day) => goTo(day.date, wire.source)} />}
    </div>
  </div>;
}
