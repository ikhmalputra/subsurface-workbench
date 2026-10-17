import type { WellBundle } from "@ikhmalputra/subsurface-core/data-contract";
import { forceAreas, forceWells } from "../force.ts";
import { forceBundle } from "./convert.ts";

/** Every FORCE 2020 well in the data contract, once the index is in (none before). */
export function forceBundles(): readonly WellBundle[] {
  const labels = new Map(forceAreas().map((area) => [area.id, area.label]));
  return forceWells().map((well) => forceBundle(well, labels.get(well.area) ?? well.area));
}
