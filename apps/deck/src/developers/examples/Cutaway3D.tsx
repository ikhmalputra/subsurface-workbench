// The same design in 3D: every string, cement sheath and tool built from the package's
// component models. Drag to orbit, scroll to zoom, click a part to select it; Exploded pulls the
// strings apart on one depth scale. /assembly-three loads only this scene, not the whole /3d entry.
import { useState } from "react";
import { designToAssembly, exampleWellBrief } from "@ikhmalputra/subsurface-core/well-design";
import { AssemblyScene } from "@ikhmalputra/subsurface-react/assembly-three";

const assembly = designToAssembly(exampleWellBrief());

export function Cutaway3D() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return <div className="ex-scene">
    <AssemblyScene assembly={assembly} assetBaseUrl={`${import.meta.env.BASE_URL}well-components`} title="Kestrel A-7, cut open"
      selectedId={selectedId} onSelect={setSelectedId} />
  </div>;
}
