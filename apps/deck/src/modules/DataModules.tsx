import { useLayoutEffect, useState } from "react";
import { LogTracks, SeismicSection } from "@ikhmalputra/subsurface-react/2d";
import { forgeSeismicSection } from "@ikhmalputra/subsurface-core";
import type { SegyTrace } from "@ikhmalputra/subsurface-core";
import { forgeWell, useForgeLog } from "../data/sites.ts";
import { feetToMetres as fromFt, metresToFeet as toFt } from "@ikhmalputra/subsurface-core";
import { sectionIntervals, sectionMarkers, useForgeSection, wellOnSection } from "../data/forge.ts";
import { shoesOf } from "../data/place.ts";
import { formatDate, logTo, useMoment } from "../data/history.ts";
import { useForgeOpenHole } from "../data/openhole.ts";
import { ListTree } from "lucide-react";
import { Empty, Loading } from "./Empty.tsx";
import { useSize } from "./useSize.ts";
import { useWire } from "./wire.ts";

const tracks = [
  { mnemonic: "ROP", label: "ROP", color: "#34d399" },
  { mnemonic: "WOB", label: "WOB", color: "#818cf8" },
  { mnemonic: "TORQUE", label: "Torque", color: "#fbbf24" },
  { mnemonic: "PP", label: "Pump pressure", color: "#f472b6" },
];
const runIntervals = forgeWell.operations.runs.filter((run) => run.topFt !== null && run.baseFt !== null)
  .map((run) => ({ id: run.id, label: run.sourceHeading, topFt: run.topFt!, baseFt: run.baseFt!, tone: run.outcome === "completed" ? "neutral" as const : run.outcome }));
/** Open-hole tracks on their usual scales: neutron and sonic reversed, resistivity logarithmic. */
const petroTracks = [
  { mnemonic: "GR", label: "GR", color: "#a3e635", min: 0, max: 150 },
  { mnemonic: "RT", label: "Deep resistivity", color: "#f87171", min: 0.2, max: 2000, scale: "log" as const },
  { mnemonic: "RHOB", label: "Density", color: "#f472b6", min: 1.95, max: 2.95 },
  { mnemonic: "NPHI", label: "Neutron", color: "#60a5fa", min: 0.45, max: -0.15 },
  { mnemonic: "DT", label: "Sonic", color: "#c084fc", min: 140, max: 40 },
  { mnemonic: "CALI", label: "Caliper", color: "#fbbf24", min: 6, max: 16 },
];

/** FORGE's open-hole curves (GDR 1292) on granite scales: porosity a few percent, resistivity logarithmic. */
const forgeOpenHoleTracks = [
  { mnemonic: "GR", label: "GR", color: "#a3e635", min: 0, max: 300 },
  { mnemonic: "K", label: "Potassium", color: "#fbbf24", min: 0, max: 8 },
  { mnemonic: "TH", label: "Thorium", color: "#f472b6", min: 0, max: 50 },
  { mnemonic: "RT90", label: "Rt 90 in", color: "#f87171", min: 1, max: 3000, scale: "log" as const },
  { mnemonic: "RT10", label: "Rt 10 in", color: "#fb923c", min: 1, max: 3000, scale: "log" as const },
  { mnemonic: "DPHI", label: "φ density", color: "#e879f9", min: 0.15, max: 0 },
  { mnemonic: "NPHI_SAN", label: "φ neutron", color: "#60a5fa", min: 0.15, max: 0 },
  { mnemonic: "DTC", label: "DTC", color: "#c084fc", min: 70, max: 40 },
  { mnemonic: "DTS", label: "DTS", color: "#a78bfa", min: 130, max: 80 },
  { mnemonic: "C24", label: "Caliper", color: "#facc15", min: 8, max: 12 },
  { mnemonic: "P32", label: "Fractures P32", color: "#2dd4bf", min: 0, max: 5 },
];
/** The thru-bit open-hole logs were run at TD: the resistivity print in GDR 1292 is dated 29 Dec 2020. */
const OPEN_HOLE_LOGGED = "2020-12-29";

/** The well's LAS curves, in feet as recorded; the shared cursor and window convert at the edge. */
export function Logs() {
  const wire = useWire("logs");
  const place = wire.place!;
  const forge = place.siteId === "forge";
  const [set, setSet] = useState<"openhole" | "mudlog">("openhole");
  const log = useForgeLog(forge && set === "mudlog");
  const { openHole, error: openHoleError } = useForgeOpenHole(forge && set === "openhole");
  const moment = useMoment();
  const [box, size] = useSize<HTMLDivElement>();
  // The log draws at a height it is given; give it what is left under its own header and readout.
  const [chrome, setChrome] = useState(120);
  useLayoutEffect(() => {
    const frame = box.current?.querySelector<HTMLElement>(".sw-logs-frame");
    const top = box.current?.getBoundingClientRect().top;
    if (frame && top !== undefined) { const next = Math.round(frame.getBoundingClientRect().top - top) + 14; if (Math.abs(next - chrome) > 2) setChrome(next); }
  });
  const selected = wire.selected;
  const notYetLogged = forge && set === "openhole" && moment !== null && moment.date < OPEN_HOLE_LOGGED;
  const las = !forge ? place.petroLas : set === "mudlog" ? (log.log && moment ? logTo(log.log, moment.asOf.drilledFt) : log.log) : notYetLogged ? null : openHole?.las ?? null;
  const loadError = set === "mudlog" ? log.error : openHoleError;
  // The brushed interval is the selection the log shows; without one, the selected record's interval.
  const range = wire.brush ? { topFt: toFt(wire.brush[0]), baseFt: toFt(wire.brush[1]) } : selected ? { topFt: toFt(selected.topDepthM), baseFt: toFt(selected.bottomDepthM) } : null;
  const markers = forge ? shoesOf(place).map((shoe) => ({ depthFt: toFt(shoe.mdM), label: shoe.label })) : (place.petro?.well.tops ?? []).map((top) => ({ depthFt: toFt(top.mdM), label: top.name }));
  return <div className="plot-fill" ref={box}>
    {forge && <div className="log-sets" role="group" aria-label="Log set">
      <button type="button" aria-pressed={set === "openhole"} onClick={() => setSet("openhole")}>Open hole <small>Schlumberger · GDR 1292</small></button>
      <button type="button" aria-pressed={set === "mudlog"} onClick={() => setSet("mudlog")}>Mud log <small>drilling · GDR 1283</small></button>
    </div>}
    {notYetLogged ? <Empty icon={ListTree} title="Not logged yet">{`The open-hole logs were run at TD; the resistivity print is dated 29 Dec 2020. On ${formatDate(moment!.date)} only the mud log exists.`}</Empty>
    : !las ? <Loading>{loadError ? `The logs could not be read (${loadError}).` : "Reading the logs…"}</Loading> : size.height > 0 &&
    <LogTracks key={`${place.wellId}-${set}`} las={las} tracks={!forge ? petroTracks : set === "openhole" ? forgeOpenHoleTracks : tracks} markers={markers} intervals={forge && set === "mudlog" ? runIntervals : []}
      selectedRange={range} onBrush={(next) => wire.setBrush([fromFt(next.topFt), fromFt(next.baseFt)])}
      cursorFt={wire.cursor === null ? null : toFt(wire.cursor)} onCursorChange={(ft) => wire.hover(ft === null ? null : fromFt(ft))} onSelectDepth={(ft) => wire.pin(fromFt(ft))}
      depthWindowFt={wire.window ? [toFt(wire.window[0]), toFt(wire.window[1])] : null} onDepthWindowChange={(next) => wire.setWindow(next ? [fromFt(next[0]), fromFt(next[1])] : null)}
      title={!forge ? `${place.label} open-hole logs (synthetic)` : set === "openhole" ? "FORGE 16A(78)-32 open-hole logs" : "FORGE 16A(78)-32 mud log"} height={Math.max(220, size.height - chrome)} />}
  </div>;
}

const alongLine = (trace: SegyTrace) => trace.shotpoint;
const meta = forgeSeismicSection;

/** The PSDM section along the well, with the strings, shoes and tops on it. */
export function Seismic() {
  const wire = useWire("seismic");
  const section = useForgeSection(true);
  if (!section.file) return <Loading>{section.error ? `The SEG-Y could not be read (${section.error}).` : "Reading the SEG-Y section…"}</Loading>;
  return <SeismicSection file={section.file} traceX={alongLine} xLabel={`Along the section from the wellhead (m) · azimuth ${meta.section.azimuthDeg.toFixed(1)}° grid`}
    depthStep={meta.volume.sampleIntervalM} depthLabel="m below datum" wellPath={wellOnSection} intervals={[...sectionIntervals(wire.selected), ...(wire.brush ? [{ id: "brush", label: "Brushed interval", topMdM: wire.brush[0], baseMdM: wire.brush[1], color: "#ff8a3d" }] : [])]} markers={sectionMarkers}
    selectedId={wire.componentId} cursorMdM={wire.cursor} onSelectMd={wire.pin} onCursorMdChange={wire.hover} mdWindow={wire.window} onMdWindowChange={wire.setWindow}
    title="FORGE 3D PSDM · section along 16A(78)-32" />;
}
