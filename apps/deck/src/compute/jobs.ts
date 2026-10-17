import { parseLas } from "@ikhmalputra/subsurface-core/records";
import { parseSegy } from "@ikhmalputra/subsurface-core/seismic";
import type { forgePsdmVolumeLayout } from "@ikhmalputra/subsurface-core/seismic";

/**
 * The jobs the compute worker runs: parsing files and the heavier models. Each takes and returns
 * plain data (what a worker message can carry); see run.ts for how they are called.
 */
export const lasFromBuffer = (buffer: ArrayBuffer) => parseLas(new TextDecoder().decode(buffer));
export const lasFromText = (text: string) => parseLas(text);
export const segyFromBuffer = (buffer: ArrayBuffer, layout?: typeof forgePsdmVolumeLayout) => parseSegy(buffer, layout ? { layout } : undefined);
export { geomechanicsRows } from "./geomech.ts";
export { torqueAndDrag } from "./torque.ts";
export { stimulate } from "./stimulation.ts";
export { attribute } from "./attributes.ts";
