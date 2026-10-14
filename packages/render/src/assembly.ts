import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, type Object3D } from "three";
import type { Placement } from "@ikhmalputra/subsurface-scene";
import { type Frame, alignToHole, defaultFrame, toScene } from "./frame.ts";

/**
 * The well's construction as a three.js group.
 *
 * It consumes placements and does no geometry of its own beyond the tubes: where a part goes, which
 * way it points and how big it is were all decided upstream, headless and tested. This layer turns
 * those answers into objects.
 *
 * Loading is injected. The renderer does not fetch, does not choose a loader and does not decide
 * what is same-origin — a host passes a function that returns an `Object3D` for a URL, and can
 * cache, verify digests or refuse as it sees fit. That also makes the scene graph testable without
 * a browser, which is the only way any of this gets checked.
 */

export interface LoadPart {
  (url: string, placement: Placement): Promise<Object3D>;
}

export interface AssemblyOptions {
  readonly frame?: Frame;
  /** Where the catalogue's files live, as the host chose to host them. */
  readonly assetBaseUrl: string;
  readonly load: LoadPart;
  /** Radial segments for generated tubes. Twenty-four is smooth at a casing's on-screen size. */
  readonly segments?: number;
}

export interface Built {
  readonly group: Group;
  /** What was drawn, in the order it was added, so a host can map a pick back to a component. */
  readonly drawn: readonly { readonly componentId: string; readonly object: Object3D }[];
  /**
   * What could not be drawn, and why. A model that fails to load is reported rather than swallowed:
   * a scene that quietly omits a casing string looks finished and is wrong.
   */
  readonly failed: readonly { readonly componentId: string; readonly why: string }[];
}

/** A casing, liner or hole section: a tube from the catalogue's bounds and the placement's scales. */
function tube(placement: Placement, segments: number, frame: Frame): Mesh {
  const { entry, radiusScale, lengthScale } = placement;
  const radius = entry.bounds.radius * radiusScale * frame.unitsPerMetre;
  const height = (entry.bounds.top - entry.bounds.bottom) * lengthScale * frame.unitsPerMetre;
  // Open-ended: a casing seen from inside the hole should not be capped, and the cap is what makes
  // a nested string look solid in a cutaway.
  const geometry = new CylinderGeometry(radius, radius, height, segments, 1, true);
  // The catalogue hangs a part from its origin along -Y; a cylinder is centred, so it moves down by
  // half its height to match the convention everything else obeys.
  geometry.translate(0, -height / 2, 0);
  return new Mesh(geometry, new MeshStandardMaterial({ metalness: 0.6, roughness: 0.45 }));
}

/** Position, orient and scale one object the way its placement says. */
function situate(object: Object3D, placement: Placement, frame: Frame): Object3D {
  object.position.copy(toScene(placement.top, frame));
  object.quaternion.copy(alignToHole(placement.along.inclinationDeg, placement.along.azimuthDeg));
  object.userData.componentId = placement.componentId;
  // The note travels with the object, so a host showing a tooltip or a selection panel has the
  // basis of what is drawn without looking it up again.
  object.userData.note = placement.note;
  object.userData.radiusBasis = placement.radiusBasis;
  return object;
}

export async function buildAssembly(placements: readonly Placement[], options: AssemblyOptions): Promise<Built> {
  const frame = options.frame ?? defaultFrame;
  const segments = options.segments ?? 24;
  const group = new Group();
  group.name = "well-construction";
  const drawn: { componentId: string; object: Object3D }[] = [];
  const failed: { componentId: string; why: string }[] = [];

  for (const placement of placements) {
    if (placement.entry.kind === "drawn") {
      const mesh = situate(tube(placement, segments, frame), placement, frame);
      group.add(mesh);
      drawn.push({ componentId: placement.componentId, object: mesh });
      continue;
    }
    const url = `${options.assetBaseUrl.replace(/\/$/, "")}/${placement.entry.model}`;
    try {
      const loaded = await options.load(url, placement);
      const scale = placement.radiusScale * frame.unitsPerMetre;
      loaded.scale.set(scale, placement.lengthScale * frame.unitsPerMetre, scale);
      group.add(situate(loaded, placement, frame));
      drawn.push({ componentId: placement.componentId, object: loaded });
    } catch (cause) {
      failed.push({ componentId: placement.componentId, why: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return { group, drawn, failed };
}

/** Free the geometry and materials a build created. A scene rebuilt per revision leaks without it. */
export function dispose(built: Built): void {
  for (const { object } of built.drawn) {
    object.traverse((node) => {
      const mesh = node as Mesh;
      mesh.geometry?.dispose?.();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((one) => one.dispose());
      else material?.dispose?.();
    });
  }
  built.group.clear();
}
