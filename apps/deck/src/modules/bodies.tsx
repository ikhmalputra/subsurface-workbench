import { Component, type ErrorInfo, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import { useDeck } from "../deck/store.ts";
import { DrillingRecord } from "./DrillingModules.tsx";
import { Logs, Seismic } from "./DataModules.tsx";
import { Empty } from "./Empty.tsx";
import { Globe } from "./Globe.tsx";
import type { ModuleId } from "./registry.ts";
import { missing, moduleById, pointsToDesigner, pointsToEditor } from "./registry.ts";
import { Site3D } from "./Site3D.tsx";
import { Strings } from "./StringModule.tsx";
import { Construction, Cutaway, Plan, Profile, Section, Well3D } from "./WellModules.tsx";
import { Cement, Hydraulics, KickTolerance, PressureWindow } from "./EngineeringModules.tsx";
import { Petrophysics } from "./PetroModule.tsx";
import { AntiCollision } from "./AntiCollision.tsx";
import { Curtain } from "./Curtain.tsx";
import { Geomechanics } from "./Geomechanics.tsx";
import { Decline } from "./Decline.tsx";
import { TorqueDrag } from "./TorqueDrag.tsx";
import { Barriers } from "./Barriers.tsx";
import { Compare } from "./Compare.tsx";
import { Designer } from "./Designer.tsx";
import { WellEditor } from "./WellEditor.tsx";
import { useRecordsVersion } from "../data/records.ts";
import { useImportedLogs } from "../data/logs.ts";
import { useDesignState } from "../data/design.ts";
import { actions } from "../deck/store.ts";

const views: Readonly<Record<ModuleId, () => ReactNode>> = {
  globe: Globe, site3d: Site3D,
  section: Section, well3d: Well3D, designer: Designer, editor: WellEditor, construction: Construction, compare: Compare, cutaway: Cutaway, plan: Plan, profile: Profile, anticollision: AntiCollision,
  logs: Logs, seismic: Seismic, curtain: Curtain,
  drilling: DrillingRecord, torquedrag: TorqueDrag,
  petro: Petrophysics,
  strings: Strings, window: PressureWindow, kick: KickTolerance, cement: Cement, hydraulics: Hydraulics, geomech: Geomechanics, barriers: Barriers, decline: Decline,
};

/**
 * One module failing must never take the deck with it: the tile says what went wrong and offers to
 * try again, and every other module carries on.
 */
class ModuleBoundary extends Component<{ readonly title: string; readonly children: ReactNode }, { readonly error: Error | null }> {
  override state: { readonly error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  override componentDidCatch(error: Error, info: ErrorInfo) { console.warn(`${this.props.title} failed`, error, info.componentStack); }
  override render() {
    if (!this.state.error) return this.props.children;
    return <div className="empty" role="alert"><TriangleAlert size={28} strokeWidth={1.4} aria-hidden="true" /><strong>{this.props.title} could not draw this</strong>
      <p>{this.state.error.message}</p><button type="button" className="retry" onClick={() => this.setState({ error: null })}>Try again</button></div>;
  }
}

/**
 * A module's body. When the place changes the body cross-fades to the new place's data; a module
 * with nothing true to draw for the place says what is missing instead.
 */
export function ModuleBody({ id }: { readonly id: ModuleId }) {
  const siteId = useDeck((deck) => deck.siteId);
  const spec = moduleById[id];
  // A planned well's empty tiles follow its design: subscribing redraws them as the stages fill in.
  useDesignState();
  useRecordsVersion();
  useImportedLogs(null);
  const reason = missing(id, siteId);
  const View = views[id];
  return <motion.div key={`${siteId ?? "world"}:${reason ? "empty" : "live"}`} className="module-body" initial={{ opacity: 0, filter: "blur(6px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}>
    {reason ? <Empty icon={spec.icon} title={id === "designer" ? "No planned well here" : pointsToDesigner(reason) ? "Not designed yet" : pointsToEditor(reason) ? "Not entered yet" : siteId ? `Nothing to draw for this site` : "No site chosen"}
      action={id === "designer" ? { label: "+ New well", run: () => actions.openNewWell(true) } : pointsToDesigner(reason) ? { label: "Open the Well designer", run: () => actions.promote("designer") } : pointsToEditor(reason) ? { label: "Open the Well editor", run: () => actions.promote("editor") } : undefined}>{reason}</Empty> : <ModuleBoundary title={spec.title}><View /></ModuleBoundary>}
  </motion.div>;
}
