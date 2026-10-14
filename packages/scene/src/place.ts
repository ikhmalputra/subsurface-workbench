import { type Known, absent, derived, isKnown } from "@ikhmalputra/subsurface-kernel";
import { at as positionAt, type Position } from "@ikhmalputra/subsurface-calc";
import { type CatalogueEntry, modelHeight } from "./catalogue.ts";

/**
 * Putting a rendered component where it belongs on the well.
 *
 * This is the half of the 3D view that is not three.js: given a component record and the computed
 * path, where does the model sit, which way does it point, and how big is it. Headless, so it can
 * be tested without a GPU, and so a 2D schematic and a 3D scene can agree by sharing it rather than
 * by two people implementing the same thing twice.
 *
 * The part that matters is the honesty. A casing whose outer diameter was reported is drawn at that
 * diameter. One whose diameter was not reported is drawn at the model's nominal radius, and the
 * placement says so — `radiusBasis` is `"reported"` or `"nominal"`, and a view that wants to mark
 * the difference has it. The previous design had a bare number and a comment.
 *
 * Exaggeration is explicit for the same reason. A 9⅝ inch casing in a 3,339 m well is 1/13,000th of
 * the drawing; at true scale the construction is invisible. Every drawing in this project widens it,
 * and every placement carries the factor it used so a reader is never left to assume the picture is
 * to scale.
 */

export type RadiusBasis = "reported" | "nominal";

export interface Component {
  readonly id: string;
  /** Which catalogue model draws this. */
  readonly modelId: string;
  readonly topMdM: number;
  readonly baseMdM: number;
  /** Outer diameter in metres, when a source reported one. */
  readonly outerDiameterM: Known<number>;
  /** Stretched down the hole (casing, liner, cement) or placed at natural size (valve, packer). */
  readonly fit: "stretch" | "natural";
}

export interface Placement {
  readonly componentId: string;
  readonly entry: CatalogueEntry;
  /** The interval this was placed over. A depth-indexed view needs it; a 3D one does not, and
   *  dropping it made every 2D consumer re-join the placement against the component list. */
  readonly topMdM: number;
  readonly baseMdM: number;
  /** Where the top of the model sits, in the well's own metre frame. */
  readonly top: { readonly northingM: number; readonly eastingM: number; readonly tvdM: number };
  /** The hole's direction there, which the model's -Y axis is turned to follow. */
  readonly along: { readonly inclinationDeg: number; readonly azimuthDeg: number };
  /** Metres per model unit across the body. */
  readonly radiusScale: number;
  /** Metres per model unit along the axis. */
  readonly lengthScale: number;
  /** Whether the radius came from a reported diameter or from the model's nominal one. */
  readonly radiusBasis: RadiusBasis;
  /** What the radius was multiplied by so the construction is visible. 1 is true scale. */
  readonly exaggeration: number;
  /** Said plainly, for a view to show beside the drawing. */
  readonly note: string;
}

export interface PlaceOptions {
  /**
   * How much to widen radii so the construction can be seen. The previous drawings used 150, which
   * is the number that makes a 9⅝ inch string legible beside a 3 km hole.
   */
  readonly exaggeration?: number;
  /** The radius used when no diameter was reported, in metres. Nominal, and labelled as such. */
  readonly nominalRadiusM?: number;
}

/**
 * Place one component on the path.
 *
 * Absent rather than approximate when the path cannot say where the top is — a component below the
 * last survey station has no surveyed position, and inventing one would place equipment in a part
 * of the hole nobody measured.
 */
export function place(component: Component, path: readonly Position[], entry: CatalogueEntry, options: PlaceOptions = {}): Known<Placement> {
  if (!(component.baseMdM >= component.topMdM)) return absent(`"${component.id}" ends above it starts`);
  const exaggeration = options.exaggeration ?? 150;
  const nominalRadiusM = options.nominalRadiusM ?? 0.1;

  const top = positionAt(path, component.topMdM);
  if (!isKnown(top)) return absent(`no surveyed position at ${Math.round(component.topMdM)} m MD for "${component.id}"`);
  const base = positionAt(path, component.baseMdM);
  if (!isKnown(base)) return absent(`no surveyed position at ${Math.round(component.baseMdM)} m MD for "${component.id}"`);

  const radiusBasis: RadiusBasis = isKnown(component.outerDiameterM) ? "reported" : "nominal";
  const trueRadiusM = isKnown(component.outerDiameterM) ? component.outerDiameterM.value / 2 : nominalRadiusM;
  const radiusScale = (trueRadiusM * exaggeration) / entry.bounds.radius;

  // A stretched part covers its interval along the hole; a discrete one keeps the proportions it
  // was modelled with, so a valve does not become a tube when it sits in a long section.
  const runM = Math.max(0, base.value.mdM - top.value.mdM);
  const lengthScale = component.fit === "stretch" && runM > 0 ? runM / modelHeight(entry) : radiusScale;

  const basisNote = radiusBasis === "reported"
    ? `outer diameter ${(trueRadiusM * 2 * 39.3701).toFixed(3)} in, reported`
    : `drawn at a nominal radius: no outer diameter was reported`;
  return derived({
    componentId: component.id,
    entry,
    topMdM: component.topMdM,
    baseMdM: component.baseMdM,
    top: { northingM: top.value.northingM, eastingM: top.value.eastingM, tvdM: top.value.tvdM },
    along: { inclinationDeg: top.value.inclinationDeg, azimuthDeg: top.value.azimuthDeg },
    radiusScale,
    lengthScale,
    radiusBasis,
    exaggeration,
    note: `${basisNote}; widths exaggerated ×${exaggeration}`,
  }, "placed on the computed path");
}

export interface Placed {
  readonly placements: readonly Placement[];
  /** Components that could not be placed, each with the reason, for a view to list rather than drop. */
  readonly omitted: readonly { readonly componentId: string; readonly why: string }[];
}

/**
 * Place a whole assembly, keeping what could not be placed.
 *
 * The previous drawings silently dropped a component they could not position, so a schematic of ten
 * records could show seven and look complete. Here the omissions come back with it.
 */
export function placeAll(
  components: readonly Component[],
  path: readonly Position[],
  entryFor: (modelId: string) => Known<CatalogueEntry>,
  options: PlaceOptions = {},
): Placed {
  const placements: Placement[] = [];
  const omitted: { componentId: string; why: string }[] = [];
  for (const component of components) {
    const entry = entryFor(component.modelId);
    if (!isKnown(entry)) { omitted.push({ componentId: component.id, why: entry.why }); continue; }
    const placement = place(component, path, entry.value, options);
    if (isKnown(placement)) placements.push(placement.value);
    else omitted.push({ componentId: component.id, why: placement.why });
  }
  return { placements, omitted };
}
