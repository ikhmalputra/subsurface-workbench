import { lazy, Suspense, useMemo, useState } from "react";
import { Cylinder } from "lucide-react";
import type { AssemblyIssue } from "@ikhmalputra/subsurface-core";
import { AssemblySchematic, CurvedAssemblySchematic, TrajectoryPlanView, TrajectorySectionView, WellSection } from "@ikhmalputra/subsurface-react/2d";
import { useForgeLog, useForgeVolume } from "../data/sites.ts";
import { formatDate, logTo, span, useMoment } from "../data/history.ts";
import { analyse, useDesign, useDesignState } from "../data/design.ts";
import { shoesOf, type Place } from "../data/place.ts";
import { signals, useDeck } from "../deck/store.ts";
import { WRAP_CURVES } from "../deck/Tile.tsx";
import { useForgeOpenHole } from "../data/openhole.ts";
import { Empty, Loading } from "./Empty.tsx";
import { useWire, type Wire } from "./wire.ts";
import { BASE } from "../base.ts";

const WellScene = lazy(() => import("@ikhmalputra/subsurface-react/3d").then((module) => ({ default: module.WellScene })));
const AssemblyScene = lazy(() => import("@ikhmalputra/subsurface-react/3d").then((module) => ({ default: module.AssemblyScene })));

const ASSETS = `${BASE}well-components`;
const NONE: readonly string[] = [];

/** Shoes to mark on the trajectory plots: FORGE's from its records, a design's from its strings. */
const markersOf = (place: Place) => shoesOf(place).map(({ mdM, label }) => ({ mdM, label }));

/**
 * The construction to draw. FORGE follows the time cursor; Kestrel A-7 follows the live design,
 * and while a what-if is pending its failing strings are flagged for every drawing to call out.
 */
function useConstruction(place: Place) {
  const moment = useMoment();
  const { brief } = useDesign();
  const state = useDesignState();
  return useMemo(() => {
    if (place.siteId === "forge" && moment) return { assembly: moment.assembly, components: moment.asOf.components, moment, issues: [] as AssemblyIssue[], alerts: NONE };
    if (place.kind === "design") {
      const analysis = analyse(brief);
      const issues: AssemblyIssue[] = analysis.failing.map((itemId) => ({ severity: "error", itemId, code: "design", message: analysis.sections.find((section) => section.sectionId === itemId)?.issues.find((issue) => issue.severity === "error")?.message ?? "Fails the design checks." }));
      return { assembly: place.assembly, components: place.components, moment: null, issues, alerts: state.pending ? analysis.failing : NONE };
    }
    return { assembly: place.assembly, components: place.components, moment: null, issues: [] as AssemblyIssue[], alerts: NONE };
  }, [place, moment, brief, state.pending]);
}

/** The brushed interval as a band: every depth drawing marks the same sample set. */
const brushBand = (wire: Wire) => wire.brush ? [{ id: "brush", label: "Brushed interval", topM: wire.brush[0], baseM: wire.brush[1] }] : [];

/** Construction, mud log and survey on one depth axis. */
export function Section() {
  const wire = useWire("section");
  const place = wire.place!;
  const forge = place.siteId === "forge";
  const log = useForgeLog(forge);
  const { assembly, components, moment } = useConstruction(place);
  const shown = log.log && moment ? logTo(log.log, moment.asOf.drilledFt) : log.log;
  if (!assembly) return null;
  return <WellSection assembly={assembly} components={components} survey={place.survey} stations={place.stations} formations={place.formations} totalDepthM={place.totalDepthM}
    operations={place.operations} {...(forge ? { log: shown, logState: log.status === "loading" ? { status: "loading" as const } : log.status === "error" ? { status: "error" as const, message: log.error ?? undefined } : undefined } : {})}
    assetBaseUrl={ASSETS} selectedId={wire.componentId} link={wire.link} onSelect={wire.select} onSelectMd={wire.pin} highlights={brushBand(wire)} />;
}

/** The well and its strings (and FORGE's PSDM volume). Selecting a string anywhere flies the camera to it. */
export function Well3D() {
  const wire = useWire("well3d");
  const place = wire.place!;
  const seismic = useForgeVolume(place.siteId === "forge");
  const { moment, alerts } = useConstruction(place);
  // Fused with the logs: the chosen open-hole curve wraps the well as a coloured, swelling cylinder.
  const wrapped = useDeck((deck) => deck.fusions["logs>well3d"] ?? null);
  const { openHole } = useForgeOpenHole(place.siteId === "forge" && wrapped !== null);
  const wrap = useMemo(() => {
    const spec = WRAP_CURVES.find((curve) => curve.mnemonic === wrapped);
    if (!openHole || !spec) return { curve: null, style: null };
    // The scene ties a log to its own design's id; the open-hole set knows the well by the deck's.
    const source = openHole.curve(spec.mnemonic);
    const curve = { version: 1 as const, id: source.id, wellId: place.design?.id ?? "forge", unit: source.unit, depthsMdM: source.depthsMdM, values: source.values, nullValue: "nan" as const };
    return { curve, style: { curveId: curve.id, mode: "color-radius" as const, domain: spec.domain, radiusRange: [0.9, 2.8] as const } };
  }, [openHole, wrapped, place.design?.id]);
  if (!place.design) return null;
  return <Suspense fallback={<Loading>Starting the 3D well…</Loading>}>
    <WellScene key={place.wellId} design={place.design} selectedId={wire.componentId ?? ""} onSelect={wire.select} focusOnSelect colorBy="dls" dlsLimitDegPer30m={3}
      volume={place.siteId === "forge" ? seismic.volume : null} probeMdM={wire.pinned} onProbe={wire.pin} cursorMdM={wire.cursor} onCursorMdChange={wire.hover} mdWindow={wire.brush ?? wire.window}
      onCameraViewChange={(view) => signals.setViewState(view, wire.source)}
      reachMdM={moment ? moment.asOf.drilledM : null} installedIds={moment ? moment.present : null} runToMdM={moment ? moment.runTo : null} alertIds={alerts}
      logCurve={wrap.curve} logStyle={wrap.style} />
  </Suspense>;
}

type Drawing = "straight" | "curved";
const DRAWING_KEY = "deck-construction-drawing";
const storedDrawing = (): Drawing => { try { return localStorage.getItem(DRAWING_KEY) === "curved" ? "curved" : "straight"; } catch { return "straight"; } };

/**
 * The construction drawing, one module with two projections of the same records: straight on the
 * shared depth window (the engineering overview, with its exploded and detail modes), or along the
 * surveyed path. Selection, cursor and issues are the same in both.
 */
export function Construction() {
  const wire = useWire("construction");
  const place = wire.place!;
  const { assembly, components, issues } = useConstruction(place);
  const [drawing, setDrawingState] = useState<Drawing>(storedDrawing);
  const setDrawing = (next: Drawing) => { setDrawingState(next); try { localStorage.setItem(DRAWING_KEY, next); } catch { /* not kept */ } };
  if (!assembly) return null;
  return <div className="construction">
    <div className="log-sets" role="group" aria-label="Drawing">
      <button type="button" aria-pressed={drawing === "straight"} onClick={() => setDrawing("straight")}>Straight <small>on depth</small></button>
      <button type="button" aria-pressed={drawing === "curved"} onClick={() => setDrawing("curved")}>Along the path <small>surveyed</small></button>
    </div>
    <div className="construction-body">
      {drawing === "straight"
        ? <AssemblySchematic assembly={assembly} survey={place.stations} formations={place.formations} formationColumn={place.formations} records={components} assetBaseUrl={ASSETS}
          selectedId={wire.componentId} onSelect={wire.select} depthWindow={wire.window} onDepthWindowChange={wire.setWindow} issues={issues}
          cursorDepthM={wire.cursor} onCursorDepthChange={wire.hover} highlights={brushBand(wire)} title="Construction schematic" />
        : <CurvedAssemblySchematic assembly={assembly} survey={place.stations} formations={place.formations} records={components} assetBaseUrl={ASSETS} issues={issues}
          selectedId={wire.componentId} onSelect={wire.select} cursorMdM={wire.cursor} onCursorMdChange={wire.hover} onSelectMd={wire.pin} />}
    </div>
  </div>;
}

/** The construction as a 3D cutaway. */
export function Cutaway() {
  const wire = useWire("cutaway");
  const place = wire.place!;
  const { assembly: built, moment } = useConstruction(place);
  // The cutaway draws its borehole to the assembly's depth: on a past day, the depth drilled then.
  const assembly = useMemo(() => built && moment ? { ...built, totalDepthM: Math.max(1, moment.asOf.drilledM) } : built, [built, moment]);
  if (moment && moment.asOf.drilledFt === 0) return <Empty icon={Cylinder} title="Not spudded yet">{`On ${formatDate(moment.date)} the rig was moving in and rigging up; the well was spudded on ${formatDate(span.spud ?? span.first)}.`}</Empty>;
  if (!assembly) return null;
  return <Suspense fallback={<Loading>Starting the cutaway…</Loading>}>
    <AssemblyScene assembly={assembly} assetBaseUrl={ASSETS} selectedId={wire.componentId} onSelect={wire.select} title="Construction cutaway" />
  </Suspense>;
}

/** The path from above. The marker rides the shared cursor. */
export function Plan() {
  const wire = useWire("plan");
  const place = wire.place!;
  return <div className="plot-fill"><TrajectoryPlanView key={place.wellId} survey={place.survey} selectedMdM={wire.cursor} onSelectMd={wire.pin} markers={markersOf(place)} dlsLimitDegPer30m={3} fill /></div>;
}

/** Departure against TVD on the closure azimuth, with the formations. */
export function Profile() {
  const wire = useWire("profile");
  const place = wire.place!;
  const closure = place.survey.at(-1)?.closureAzimuthDeg ?? 0;
  return <div className="plot-fill"><TrajectorySectionView key={place.wellId} survey={place.survey} selectedMdM={wire.cursor} onSelectMd={wire.pin} markers={markersOf(place)} formations={place.formations} verticalSectionAzimuthDeg={closure} dlsLimitDegPer30m={3} fill /></div>;
}
