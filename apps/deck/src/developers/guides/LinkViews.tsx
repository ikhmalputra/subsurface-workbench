// One store per workspace. Every view reads and writes the same well, depth and selection, and
// each change says which view made it, so a view can ignore its own echo.
import { createSubsurfaceStore, type SubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import { useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";

export const store = createSubsurfaceStore();
store.focusAsset("16A(78)-32");

// Outside React (a canvas, a map, a WebSocket): subscribe to one slice of the state.
const stop = store.subscribeSelector(
  (state) => state.activeAsset.depth_md,
  (mdM) => console.log("draw the cursor at", mdM),
  { ignoreSource: "log-track" },
);
store.updateDepthHover("16A(78)-32", 1234.5, "log-track"); // a log reports the depth under the pointer
store.pinDepth("16A(78)-32", 1230, "3d");                  // a click in the 3D view pins it
stop();

// Inside React: re-render only when the selected slice changes.
export function DepthReadout({ store }: { store: SubsurfaceStore }) {
  const mdM = useSubsurfaceSelector(store, (state) => state.activeAsset.depth_md);
  return <output>{mdM === null ? "No depth picked" : `${mdM.toFixed(1)} m MD`}</output>;
}
