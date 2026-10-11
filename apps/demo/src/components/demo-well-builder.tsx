"use client";

import { useEffect, useState } from "react";
import { forgeOffsetWell } from "@ikhmalputra/subsurface-core/offset-wells";
import type { OffsetWell } from "@ikhmalputra/subsurface-core/offset-wells";
import { WellDesignWorkflow } from "@ikhmalputra/subsurface-react/examples";
import { loadSavedOffsetLibrary, parseSavedOffsetLibrary, serializeSavedOffsetLibrary } from "../lib/demo-offset-library";

const storageKey = "subsurface-demo-wells";

export function DemoWellBuilder() {
  const [savedOffsets, setSavedOffsets] = useState<readonly OffsetWell[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const loaded = loadSavedOffsetLibrary(window.localStorage.getItem(storageKey));
      setSavedOffsets(loaded.offsets);
      if (loaded.migratedDocument !== null) {
        try {
          window.localStorage.setItem(storageKey, loaded.migratedDocument);
        } catch (error) {
          setStorageError(`Saved well library loaded, but its legacy data could not be upgraded: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      setStorageError(`Saved well library could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoaded(true);
    }
  }, []);

  function updateOffsets(next: readonly OffsetWell[]) {
    if (!loaded) {
      setStorageError("Saved well library is still loading. Try the change again in a moment.");
      return;
    }
    try {
      const serialized = serializeSavedOffsetLibrary(next);
      const normalized = parseSavedOffsetLibrary(serialized);
      window.localStorage.setItem(storageKey, serialized);
      setSavedOffsets(normalized);
      setStorageError(null);
    } catch (error) {
      setStorageError(`Saved well library could not be updated: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return <>
    {storageError && <p className="demo-storage-error" role="alert" data-testid="well-library-error">{storageError}</p>}
    <WellDesignWorkflow
      assetBaseUrl="/well-components"
      offsets={[forgeOffsetWell, ...savedOffsets]}
      onOffsetsChange={updateOffsets}
    />
  </>;
}
