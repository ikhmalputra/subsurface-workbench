// Untrusted input in; a typed, independent snapshot out, or an error naming the first bad field.
import { ContractValidationError, validateWellPath } from "@ikhmalputra/subsurface-core/contracts";
import { parseLas } from "@ikhmalputra/subsurface-core/records";
import { parseSegy } from "@ikhmalputra/subsurface-core/seismic";

export function readWellPath(json: unknown) {
  try {
    return validateWellPath(json);
  } catch (error) {
    // e.g. `$.reference.units: expected "m"`
    if (error instanceof ContractValidationError) console.warn("Rejected well path:", error.message);
    throw error;
  }
}

readWellPath({
  version: 1,
  id: "A-1",
  reference: { units: "m", crs: "EPSG:32612", depthDatum: "RKB" }, // units are stated, never assumed
  points: [[0, 0, 0], [0, 0, 1000]],
  measuredDepthsM: [0, 1000],
  logs: [],
});

export const readLog = (text: string) => parseLas(text);                 // LAS 2.0; NULL samples become null
export const readSeismic = (buffer: ArrayBuffer) => parseSegy(buffer);   // SEG-Y; IBM and IEEE floats, integers
