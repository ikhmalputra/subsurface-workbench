import { Component, type ErrorInfo, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import { useDeck } from "../deck/store.ts";
import { DrillingRecord } from "./DrillingModules.tsx";
import { Logs, Seismic } from "./DataModules.tsx";
import { Empty } from "./Empty.tsx";
import { Globe } from "./Globe.tsx";
import type { ModuleId } from "./registry.ts";
import { missing, moduleById } from "./registry.ts";
import { Site3D } from "./Site3D.tsx";
import { Strings } from "./StringModule.tsx";
import { Construction, Cutaway, Plan, Profile, Section, Well3D } from "./WellModules.tsx";
import { Cement, Hydraulics, KickTolerance, PressureWindow } from "./EngineeringModules.tsx";
import { Petrophysics } from "./PetroModule.tsx";

const views: Readonly<Record<ModuleId, () => ReactNode>> = {
  globe: Globe, site3d: Site3D,
  section: Section, well3d: Well3D, construction: Construction, cutaway: Cutaway, plan: Plan, profile: Profile,
  logs: Logs, seismic: Seismic,
  drilling: DrillingRecord,
  petro: Petrophysics,
  strings: Strings, window: PressureWindow, kick: KickTolerance, cement: Cement, hydraulics: Hydraulics,
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
  const reason = missing(id, siteId);
  const View = views[id];
  return <motion.div key={`${siteId ?? "world"}:${reason ? "empty" : "live"}`} className="module-body" initial={{ opacity: 0, filter: "blur(6px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}>
    {reason ? <Empty icon={spec.icon} title={siteId ? `Nothing to draw for this site` : "No site chosen"}>{reason}</Empty> : <ModuleBoundary title={spec.title}><View /></ModuleBoundary>}
  </motion.div>;
}
