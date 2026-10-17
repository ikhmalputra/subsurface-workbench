import { Component, lazy, Suspense, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import { useDeck } from "../deck/store.ts";
import { Empty, Loading } from "./Empty.tsx";
import type { ModuleId } from "./registry.ts";
import { missing, moduleById, pointsToDesigner, pointsToEditor } from "./registry.ts";
import { useRecordsVersion } from "../data/records.ts";
import { useImportedLogs } from "../data/logs.ts";
import { useCatalogueVersion } from "../data/catalogue-state.ts";
import { useDesignState } from "../data/design.ts";
import { actions } from "../deck/store.ts";

/**
 * Every module is its own chunk, fetched the first time its tile opens: the deck's first download
 * carries the shell and the tiles on screen, not all 27 modules. Once the deck is idle the rest are
 * fetched in the background, so opening one later is instant.
 */
const files = {
  "./AntiCollision.tsx": () => import("./AntiCollision.tsx"),
  "./Barriers.tsx": () => import("./Barriers.tsx"),
  "./Compare.tsx": () => import("./Compare.tsx"),
  "./DataSources.tsx": () => import("./DataSources.tsx"),
  "./Correlation.tsx": () => import("./Correlation.tsx"),
  "./WellTie.tsx": () => import("./WellTie.tsx"),
  "./Horizons.tsx": () => import("./Horizons.tsx"),
  "./Volumetrics.tsx": () => import("./Volumetrics.tsx"),
  "./Curtain.tsx": () => import("./Curtain.tsx"),
  "./DataModules.tsx": () => import("./DataModules.tsx"),
  "./Decline.tsx": () => import("./Decline.tsx"),
  "./Nodal.tsx": () => import("./Nodal.tsx"),
  "./Stimulation.tsx": () => import("./Stimulation.tsx"),
  "./Attributes.tsx": () => import("./Attributes.tsx"),
  "./Designer.tsx": () => import("./Designer.tsx"),
  "./DrillingModules.tsx": () => import("./DrillingModules.tsx"),
  "./EngineeringModules.tsx": () => import("./EngineeringModules.tsx"),
  "./Geomechanics.tsx": () => import("./Geomechanics.tsx"),
  "./Globe.tsx": () => import("./Globe.tsx"),
  "./LiveDrilling.tsx": () => import("./LiveDrilling.tsx"),
  "./PetroModule.tsx": () => import("./PetroModule.tsx"),
  "./Site3D.tsx": () => import("./Site3D.tsx"),
  "./StringModule.tsx": () => import("./StringModule.tsx"),
  "./TorqueDrag.tsx": () => import("./TorqueDrag.tsx"),
  "./WellEditor.tsx": () => import("./WellEditor.tsx"),
  "./WellModules.tsx": () => import("./WellModules.tsx"),
} as const;
type ModuleFile = keyof typeof files;
const view = (file: ModuleFile, name: string): ComponentType => lazy(() => files[file]().then((module) => ({ default: (module as unknown as Record<string, ComponentType>)[name]! })));
/** Fetch every module's chunk without running it: called once the deck is idle. */
export function prefetchModules() { for (const load of Object.values(files)) void load().catch(() => undefined); }

const views: Readonly<Record<ModuleId, ComponentType>> = {
  globe: view("./Globe.tsx", "Globe"), site3d: view("./Site3D.tsx", "Site3D"),
  section: view("./WellModules.tsx", "Section"), well3d: view("./WellModules.tsx", "Well3D"), designer: view("./Designer.tsx", "Designer"), editor: view("./WellEditor.tsx", "WellEditor"), construction: view("./WellModules.tsx", "Construction"), compare: view("./Compare.tsx", "Compare"), sources: view("./DataSources.tsx", "DataSources"), cutaway: view("./WellModules.tsx", "Cutaway"), plan: view("./WellModules.tsx", "Plan"), profile: view("./WellModules.tsx", "Profile"), anticollision: view("./AntiCollision.tsx", "AntiCollision"),
  logs: view("./DataModules.tsx", "Logs"), seismic: view("./DataModules.tsx", "Seismic"), curtain: view("./Curtain.tsx", "Curtain"), correlate: view("./Correlation.tsx", "Correlation"), tie: view("./WellTie.tsx", "WellTie"), horizons: view("./Horizons.tsx", "Horizons"), volumetrics: view("./Volumetrics.tsx", "Volumetrics"),
  drilling: view("./DrillingModules.tsx", "DrillingRecord"), torquedrag: view("./TorqueDrag.tsx", "TorqueDrag"),
  petro: view("./PetroModule.tsx", "Petrophysics"),
  strings: view("./StringModule.tsx", "Strings"), window: view("./EngineeringModules.tsx", "PressureWindow"), kick: view("./EngineeringModules.tsx", "KickTolerance"), rig: view("./LiveDrilling.tsx", "LiveDrilling"), cement: view("./EngineeringModules.tsx", "Cement"), hydraulics: view("./EngineeringModules.tsx", "Hydraulics"), geomech: view("./Geomechanics.tsx", "Geomechanics"), stimulation: view("./Stimulation.tsx", "Stimulation"), attributes: view("./Attributes.tsx", "Attributes"), barriers: view("./Barriers.tsx", "Barriers"), decline: view("./Decline.tsx", "Decline"), nodal: view("./Nodal.tsx", "Nodal"),
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
  useCatalogueVersion();
  const reason = missing(id, siteId);
  const View = views[id];
  return <motion.div key={`${siteId ?? "world"}:${reason ? "empty" : "live"}`} className="module-body" initial={{ opacity: 0, filter: "blur(6px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}>
    {reason ? <Empty icon={spec.icon} title={id === "designer" ? "No planned well here" : pointsToDesigner(reason) ? "Not designed yet" : pointsToEditor(reason) ? "Not entered yet" : siteId ? `Nothing to draw for this site` : "No site chosen"}
      action={id === "designer" ? { label: "+ New well", run: () => actions.openNewWell(true) } : pointsToDesigner(reason) ? { label: "Open the Well designer", run: () => actions.promote("designer") } : pointsToEditor(reason) ? { label: "Open the Well editor", run: () => actions.promote("editor") } : undefined}>{reason}</Empty> : <ModuleBoundary title={spec.title}><Suspense fallback={<Loading>{`Loading ${spec.title}…`}</Loading>}><View /></Suspense></ModuleBoundary>}
  </motion.div>;
}
