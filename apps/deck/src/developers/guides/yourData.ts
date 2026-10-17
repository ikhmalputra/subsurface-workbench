// Untrusted input in; a typed, independent snapshot out, or an error naming the first bad field.
import { ContractValidationError, validateWellPath } from "@ikhmalputra/subsurface-core/contracts";
import { formatLas, parseLas } from "@ikhmalputra/subsurface-core/records";
import { readQuakeML, writeQuakeML } from "@ikhmalputra/subsurface-core/quakeml";
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
export const readCatalogue = (xml: string) => readQuakeML(xml);         // QuakeML 1.2: preferred origin and magnitude, uncertainties
export const writeCatalogue = writeQuakeML;                                 // and back, readable by ObsPy

// A time-indexed LAS 2.0 file, as a SCADA historian exports annulus pressures; parseLas reads it back.
export const annulusLas = formatLas({
  well: [{ mnemonic: "WELL", unit: "", value: "A-1", description: "Well name" }],
  curves: [
    { mnemonic: "ETIM", unit: "H", value: "", description: "Elapsed time", values: [0, 1, 2] },
    { mnemonic: "PA_B", unit: "PSIG", value: "", description: "B annulus pressure", values: [0, 140, 212] },
  ],
});
