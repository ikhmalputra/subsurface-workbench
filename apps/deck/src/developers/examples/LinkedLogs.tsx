// Real data, two views, one depth. FORGE 16A(78)-32's mud log (LAS) beside its construction,
// linked by measured depth: hover either one and both mark the depth; zoom either one and both
// follow. The log is in feet and the schematic in metres, so the link converts at the boundary.
import { useEffect, useState } from "react";
import { forgeDesign, getWellComponents, wellComponentsToAssembly } from "@ikhmalputra/subsurface-core";
import { parseLas, type LasFile } from "@ikhmalputra/subsurface-core/records";
import { AssemblySchematic, LogTracks } from "@ikhmalputra/subsurface-react/2d";
import { useDepthLink } from "@ikhmalputra/subsurface-react/state";

const M_PER_FT = 0.3048;
const components = getWellComponents(forgeDesign);
const assembly = wellComponentsToAssembly({
  id: forgeDesign.id, name: "16A(78)-32", totalDepthM: forgeDesign.totalDepthM, components,
});
const tracks = [
  { mnemonic: "ROP", label: "ROP", color: "#34d399" },
  { mnemonic: "WOB", label: "WOB", color: "#818cf8" },
  { mnemonic: "TORQUE", label: "Torque", color: "#fbbf24" },
];
type Window = readonly [number, number] | null;
const toFt = (window: Window) => window && [window[0] / M_PER_FT, window[1] / M_PER_FT] as const;
const toM = (window: Window) => window && [window[0] * M_PER_FT, window[1] * M_PER_FT] as const;

export function LinkedLogs() {
  const [las, setLas] = useState<LasFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const link = useDepthLink();

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/forge-16a-mudlog-10ft.las`)
      .then((response) => response.ok ? response.text() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((text) => setLas(parseLas(text)), (reason: Error) => setError(reason.message));
  }, []);

  return <div className="ex-pair">
    <div className="ex-schematic">
      <AssemblySchematic assembly={assembly} records={components} assetBaseUrl={`${import.meta.env.BASE_URL}well-components`}
        title="16A(78)-32 as built"
        cursorDepthM={link.cursorMdM} onCursorDepthChange={link.setCursorMdM}
        depthWindow={link.window} onDepthWindowChange={link.setWindow} />
    </div>
    {las
      ? <LogTracks las={las} tracks={tracks} height={540} title="Mud log, 10 ft bins"
          cursorFt={link.cursorMdM === null ? null : link.cursorMdM / M_PER_FT}
          onCursorChange={(ft) => link.setCursorMdM(ft === null ? null : ft * M_PER_FT)}
          depthWindowFt={toFt(link.window)} onDepthWindowChange={(window) => link.setWindow(toM(window))} />
      : <p className="ex-readout">{error ? `Could not load the mud log: ${error}` : "Loading the FORGE mud log…"}</p>}
  </div>;
}
