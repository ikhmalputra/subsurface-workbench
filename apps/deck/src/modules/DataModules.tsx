import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { LogTracks, SeismicSection } from "@ikhmalputra/subsurface-react/2d";
import { cubeSection, forgeSeismicSection, wellOnCubeSection } from "@ikhmalputra/subsurface-core";
import type { CubeTrace, SegyTrace } from "@ikhmalputra/subsurface-core";
import { useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";
import { forgeWell, useForgeCube, useForgeLog } from "../data/sites.ts";
import { signals, useDeck } from "../deck/store.ts";
import { fmt } from "../format.ts";
import { feetToMetres as fromFt, metresToFeet as toFt } from "@ikhmalputra/subsurface-core";
import { formationHorizons, sectionIntervals, sectionMarkers, useForgeSection, wellOnSection } from "../data/forge.ts";
import { shoesOf } from "../data/place.ts";
import { formatDate, logTo, useMoment } from "../data/history.ts";
import { useForgeOpenHole } from "../data/openhole.ts";
import { ListTree } from "lucide-react";
import { Empty, Loading } from "./Empty.tsx";
import { useSize } from "./useSize.ts";
import { useWire } from "./wire.ts";
import { tracksOf, useImportedLogs, useLasFile } from "../data/logs.ts";

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
  // Logs the user imported for this well sit beside the well's own sets, or are its only set.
  const imported = useImportedLogs(place.wellId);
  const [chosen, setSet] = useState<string>(forge ? "openhole" : place.petroLas ? "own" : imported[0]?.id ?? "own");
  const importedLog = imported.find((entry) => entry.id === chosen) ?? (!forge && !place.petroLas ? imported[0] ?? null : null);
  const set: "openhole" | "mudlog" = chosen === "mudlog" ? "mudlog" : "openhole";
  const fromFile = useLasFile(importedLog);
  const log = useForgeLog(forge && !importedLog && set === "mudlog");
  const { openHole, error: openHoleError } = useForgeOpenHole(forge && !importedLog && set === "openhole");
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
  const notYetLogged = forge && !importedLog && set === "openhole" && moment !== null && moment.date < OPEN_HOLE_LOGGED;
  const las = importedLog ? fromFile.las : !forge ? place.petroLas : set === "mudlog" ? (log.log && moment ? logTo(log.log, moment.asOf.drilledFt) : log.log) : notYetLogged ? null : openHole?.las ?? null;
  const loadError = importedLog ? fromFile.error : set === "mudlog" ? log.error : openHoleError;
  // The brushed interval is the selection the log shows; without one, the selected record's interval.
  const range = wire.brush ? { topFt: toFt(wire.brush[0]), baseFt: toFt(wire.brush[1]) } : selected ? { topFt: toFt(selected.topDepthM), baseFt: toFt(selected.bottomDepthM) } : null;
  const markers = forge || place.kind === "recorded" ? shoesOf(place).map((shoe) => ({ depthFt: toFt(shoe.mdM), label: shoe.label })) : (place.petro?.well.tops ?? []).map((top) => ({ depthFt: toFt(top.mdM), label: top.name }));
  return <div className="plot-fill logs-fill" ref={box}>
    {(forge || imported.length > 0) && <div className="log-sets" role="group" aria-label="Log set">
      {forge && <button type="button" aria-pressed={!importedLog && set === "openhole"} onClick={() => setSet("openhole")}>Open hole <small>Schlumberger · GDR 1292</small></button>}
      {forge && <button type="button" aria-pressed={!importedLog && set === "mudlog"} onClick={() => setSet("mudlog")}>Mud log <small>drilling · GDR 1283</small></button>}
      {!forge && place.petroLas && <button type="button" aria-pressed={!importedLog} onClick={() => setSet("own")}>{place.label} <small>synthetic</small></button>}
      {imported.map((entry) => <button key={entry.id} type="button" aria-pressed={importedLog?.id === entry.id} onClick={() => setSet(entry.id)}>{entry.fileName} <small>imported</small></button>)}
    </div>}
    {notYetLogged ? <Empty icon={ListTree} title="Not logged yet">{`The open-hole logs were run at TD; the resistivity print is dated 29 Dec 2020. On ${formatDate(moment!.date)} only the mud log exists.`}</Empty>
    : !las ? <Loading>{loadError ? `The logs could not be read (${loadError}).` : "Reading the logs…"}</Loading> : size.height > 0 &&
    <LogTracks key={`${place.wellId}-${importedLog?.id ?? set}`} las={las} tracks={importedLog ? tracksOf(las) : !forge ? petroTracks : set === "openhole" ? forgeOpenHoleTracks : tracks} markers={markers} intervals={forge && !importedLog && set === "mudlog" ? runIntervals : []}
      selectedRange={range} onBrush={(next) => wire.setBrush([fromFt(next.topFt), fromFt(next.baseFt)])}
      cursorFt={wire.cursor === null ? null : toFt(wire.cursor)} onCursorChange={(ft) => wire.hover(ft === null ? null : fromFt(ft))} onSelectDepth={(ft) => wire.pin(fromFt(ft))}
      depthWindowFt={wire.window ? [toFt(wire.window[0]), toFt(wire.window[1])] : null} onDepthWindowChange={(next) => wire.setWindow(next ? [fromFt(next[0]), fromFt(next[1])] : null)}
      title={importedLog ? `${importedLog.fileName} · imported for ${place.label}` : !forge ? `${place.label} open-hole logs (synthetic)` : set === "openhole" ? "FORGE 16A(78)-32 open-hole logs" : "FORGE 16A(78)-32 mud log"} height={Math.max(220, size.height - chrome)} />}
  </div>;
}

const alongLine = (trace: SegyTrace) => trace.shotpoint;
const alongCube = (trace: CubeTrace) => trace.alongM;
const acrossCube = (trace: CubeTrace) => trace.offsetM;
const meta = forgeSeismicSection;
const cut = meta.subVolume!;
type Shown = "well" | "inline" | "crossline";
const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${fmt(Math.abs(value))}`;

/**
 * The PSDM along the well (the published SEG-Y section), or an inline or crossline cut from the
 * same volume. Moving a slice in the 3D site turns this tile to that slice; stepping it here moves
 * the slice there. The well, its strings and its tops are drawn on whichever plane is shown.
 */
export function Seismic() {
  const wire = useWire("seismic");
  const section = useForgeSection(true);
  const slices = useSubsurfaceSelector(signals, (state) => state.seismicSlices);
  const [shown, setShown] = useState<Shown>("well");
  // Follow the slice that moved last, wherever it was moved.
  useEffect(() => signals.subscribe((event) => {
    if (event.type !== "slices") return;
    const now = event.state.seismicSlices, before = event.previous.seismicSlices;
    if (now.inline !== before.inline) setShown(now.inline === null ? "well" : "inline");
    else if (now.crossline !== before.crossline) setShown(now.crossline === null ? "well" : "crossline");
  }), []);
  const { cube, error } = useForgeCube(shown !== "well");
  const centreAlong = (cut.alongFromM + cut.alongToM) / 2;
  const position = shown === "inline" ? slices.inline ?? 0 : slices.crossline ?? centreAlong;
  const slice = useMemo(() => cube && shown !== "well" ? cubeSection(cube, shown, position) : null, [cube, shown, position]);
  const path = useMemo(() => {
    if (!slice) return wellOnSection;
    const projected = wellOnCubeSection(wellOnSection, slice);
    // A crossline is cut across the well: only the stretch of well near the plane belongs on it.
    return slice.kind === "crossline" ? projected.filter((point) => Math.abs(point.offsetM) <= 2 * cut.spacingM) : projected;
  }, [slice]);
  const offWell = slice?.kind === "inline" ? Math.round(path.reduce((sum, point) => sum + Math.abs(point.offsetM), 0) / Math.max(1, path.length)) : null;
  const show = (next: Shown) => {
    setShown(next);
    if (next === "inline" && slices.inline === null) signals.setSeismicSlices({ inline: 0 }, wire.source);
    if (next === "crossline" && slices.crossline === null) signals.setSeismicSlices({ crossline: centreAlong }, wire.source);
  };
  const step = (bins: number) => {
    if (!slice) return;
    const [from, to] = slice.kind === "inline" ? [cut.offsetFromM, cut.offsetToM] : [cut.alongFromM, cut.alongToM];
    const next = Math.min(to, Math.max(from, slice.positionM + bins * cut.spacingM));
    signals.setSeismicSlices(slice.kind === "inline" ? { inline: next } : { crossline: next }, wire.source);
  };
  const intervals = [...sectionIntervals(wire.selected), ...(wire.brush ? [{ id: "brush", label: "Brushed interval", topMdM: wire.brush[0], baseMdM: wire.brush[1], color: "#ff8a3d" }] : [])];
  const fusedTops = useDeck((deck) => "section>seismic" in deck.fusions);
  const linked = { horizons: fusedTops ? formationHorizons : [], intervals, markers: sectionMarkers, selectedId: wire.componentId, cursorMdM: wire.cursor, onSelectMd: wire.pin, onCursorMdChange: wire.hover, mdWindow: wire.window, onMdWindowChange: wire.setWindow, depthStep: meta.volume.sampleIntervalM, depthLabel: "m below datum" };
  return <div className="construction">
    <div className="log-sets" role="group" aria-label="Seismic plane">
      <button type="button" aria-pressed={shown === "well"} onClick={() => show("well")}>Along the well <small>SEG-Y</small></button>
      <button type="button" aria-pressed={shown === "inline"} onClick={() => show("inline")}>Inline {slices.inline !== null && <small>{`${signed(slices.inline)} m`}</small>}</button>
      <button type="button" aria-pressed={shown === "crossline"} onClick={() => show("crossline")}>Crossline {slices.crossline !== null && <small>{`${fmt(slices.crossline)} m`}</small>}</button>
      {slice && <span className="slice-step"><button type="button" aria-label="Previous bin" onClick={() => step(-1)}>◀</button><button type="button" aria-label="Next bin" onClick={() => step(1)}>▶</button></span>}
    </div>
    <div className="construction-body">
      {shown === "well"
        ? section.file
          ? <SeismicSection file={section.file} traceX={alongLine} xLabel={`Along the section from the wellhead (m) · azimuth ${meta.section.azimuthDeg.toFixed(1)}° grid`} wellPath={wellOnSection} {...linked} title="FORGE 3D PSDM · section along 16A(78)-32" />
          : <Loading>{section.error ? `The SEG-Y could not be read (${section.error}).` : "Reading the SEG-Y section…"}</Loading>
        : slice
          ? <SeismicSection key={slice.kind} file={slice.traces} traceX={slice.kind === "inline" ? alongCube : acrossCube} wellPath={path} {...linked}
            xLabel={slice.kind === "inline" ? `Along the section (m) · inline ${signed(slice.positionM)} m right of the line` : `Across the section (m, + right of ${meta.section.azimuthDeg.toFixed(1)}°) · crossline ${fmt(slice.positionM)} m along`}
            title={slice.kind === "inline" ? `Inline ${signed(slice.positionM)} m · the well is ${offWell === null ? "not reported" : `about ${fmt(offWell)} m`} off this plane` : `Crossline ${fmt(slice.positionM)} m along · the well where it crosses`} />
          : <Loading>{error ? `The volume could not be read (${error}).` : "Reading the PSDM volume…"}</Loading>}
    </div>
  </div>;
}
