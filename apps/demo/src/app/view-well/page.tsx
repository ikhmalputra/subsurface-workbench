import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoHeader, DemoPage } from "../../components/showcase";
import { ViewWellDemo } from "../../components/view-well-demo";

export const metadata: Metadata = { title: "View well · Subsurface SDK" };

const code = `
import { getWellComponents, wellComponentsToAssembly } from "@ikhmalputra/subsurface-core";
import { AssemblySchematic } from "@ikhmalputra/subsurface-react/assembly";
import { AssemblyScene } from "@ikhmalputra/subsurface-react/assembly-three";
import { CurvedSchematic } from "@ikhmalputra/subsurface-react/schematic";
import { InteractiveViewport } from "@ikhmalputra/subsurface-react/viewport";
import { ComponentInventory } from "@ikhmalputra/subsurface-react";
import { createSubsurfaceStore } from "@ikhmalputra/subsurface-core/state";
import { syncStateToUrl } from "@ikhmalputra/subsurface-core/state-url";
import { useSubsurfaceSelector } from "@ikhmalputra/subsurface-react/state";
import "@ikhmalputra/subsurface-react/styles.css";

const [store] = useState(() => {
  const store = createSubsurfaceStore();
  store.focusAsset("forge");
  return store;
});
const selectedId = useSubsurfaceSelector(store, (state) => state.activeAsset.componentId);
const setSelectedId = (id) => store.selectComponent(id, "host");
useEffect(() => syncStateToUrl(store, { onError: reportError }), [store]);

const components = getWellComponents(design);
const assembly = useMemo(() => wellComponentsToAssembly({
  id: design.id, name: design.wellName ?? design.id,
  totalDepthM: design.totalDepthM, components,
}), [design, components]);

// Selection is shared: the pick is outlined in orange (--sw-select) and
// everything else dims. "Exploded" pulls every component apart; omit
// exploded/onExplodedChange to let each view own its toggle.
<AssemblySchematic assembly={assembly} assetBaseUrl="/well-components"
  selectedId={selectedId} onSelect={setSelectedId}
  exploded={exploded} onExplodedChange={setExploded} />
<AssemblyScene assembly={assembly} assetBaseUrl="/well-components"
  selectedId={selectedId} onSelect={setSelectedId}
  exploded={exploded} onExplodedChange={setExploded} />

// "Follow trajectory": the same records bent along the survey (SVG, no WebGL).
// Component ids are shared, so one selectedId drives every view.
<InteractiveViewport name="Curved well section">
  <CurvedSchematic design={design} components={components}
    selectedId={selectedId} onSelect={setSelectedId} layersVisible />
</InteractiveViewport>

// Every record (746 on the synthetic S-profile) is searchable, filterable by
// type and paged; it jumps to whatever is selected in the views above.
<ComponentInventory components={components}
  selectedId={selectedId} onSelect={setSelectedId} />

// Well file: operational records linked to the construction by depth.
import { forgeOperations, parseLas, sectionAtDepth } from "@ikhmalputra/subsurface-core/records";
import { DaysVsDepthChart, HoleSectionLog, LogTracks, ServiceRunLog, WellHistoryLog }
  from "@ikhmalputra/subsurface-react/records";

const range = picked && { topFt: picked.topDepthM / 0.3048, baseFt: picked.bottomDepthM / 0.3048 };
const selectAt = (ft) => setSelectedId(sectionAtDepth(forgeOperations, ft)?.holeComponentId ?? null);

<HoleSectionLog operations={forgeOperations} selectedComponentId={selectedId}
  onSelectSection={(section) => setSelectedId(section.holeComponentId)} />
<DaysVsDepthChart operations={forgeOperations} onSelectDay={(day) => selectAt(day.mdFt)} />
<WellHistoryLog operations={forgeOperations} selectedRange={range} />   // 76 daily reports
<ServiceRunLog operations={forgeOperations} selectedRange={range} />    // 54 BHA/service runs
<LogTracks las={parseLas(await (await fetch(lasUrl)).text())} selectedRange={range}
  tracks={[{ mnemonic: "ROP", label: "ROP", color: "#147a65" }, /* WOB, RPM, … */]}
  onSelectDepth={selectAt} />

// Seismic: SEG-Y parsed in the browser, well projected onto the section.
import { forgeSeismicSection as meta, parseSegy, projectOntoSection, tvdToSeismicDepth } from "@ikhmalputra/subsurface-core/seismic";
import { SegyHeaderPanel, SeismicSection } from "@ikhmalputra/subsurface-react/seismic";
import { useDepthLink } from "@ikhmalputra/subsurface-react";

const file = parseSegy(await (await fetch("/data/forge-16a-psdm-section.sgy")).arrayBuffer());
const wellPath = projectOntoSection(survey.map((s) => ({ mdM: s.mdM,
  eastingM: meta.wellhead.eastingM + s.eastingM, northingM: meta.wellhead.northingM + s.northingM,
  depthM: tvdToSeismicDepth(s.tvdM, meta.rkbElevationM, meta.seismicDatumElevationM) })),
  { originEastingM: meta.wellhead.eastingM, originNorthingM: meta.wellhead.northingM, azimuthDeg: meta.section.azimuthDeg });
const link = useDepthLink(true, store);   // same store as selection, slices, camera and URL
<SeismicSection file={file} traceX={(t) => t.shotpoint} depthStep={5} depthLabel="m below datum"
  wellPath={wellPath} selectedId={selectedId} onSelectMd={(md) => selectAt(md / 0.3048)}
  mdWindow={link.window} onMdWindowChange={link.setWindow} cursorMdM={link.cursorMdM} onCursorMdChange={link.setCursorMdM} />
<AssemblySchematic assembly={assembly} depthWindow={link.window} onDepthWindowChange={link.setWindow}
  cursorDepthM={link.cursorMdM} onCursorDepthChange={link.setCursorMdM} />
<SegyHeaderPanel file={file} />

// The same well, section and survey log together in 3D.
import WellScene from "@ikhmalputra/subsurface-react/three";
import { TrajectoryLog } from "@ikhmalputra/subsurface-react/trajectory";
import { computeMinimumCurvature, seismicDepthToTvd } from "@ikhmalputra/subsurface-core";

// A well-centred int8 cube cut from the FORGE PSDM volume, uploaded once as a GPU 3D texture.
const volume = useMemo(() => ({ counts: new Int8Array(buffer), alongCount: 110, offsetCount: 61, sampleCount: 641,
  amplitudePerCount: cut.amplitudePerCount, azimuthDeg: cut.azimuthDeg, alongStartM: -762.5, alongEndM: 1987.5, offsetStartM: -762.5, offsetEndM: 762.5,
  topTvdM: seismicDepthToTvd(-2.5, rkb, datum), baseTvdM: seismicDepthToTvd(3202.5, rkb, datum) }), [buffer]);
// Crop and mode change without rebuilding the scene: cut it open along the well, across it or at a depth.
const volumeView = { mode: "solid", offsetM: [-762.5, 0], tvdM: [0, 2800] } as const;
<WellScene design={design} selectedId={selectedId} onSelect={setSelectedId} volume={volume} volumeView={volumeView} colorBy="dls"
  probeMdM={link.pinnedMdM} onProbe={link.pinCursor} cursorMdM={link.cursorMdM} onCursorMdChange={link.setCursorMdM} mdWindow={link.window} />
<TrajectoryLog survey={computeMinimumCurvature(survey, { tieIn: survey[0] })} selectedMdM={link.pinnedMdM} onSelectMd={link.pinCursor}
  cursorMdM={link.cursorMdM} onCursorMdChange={link.setCursorMdM} mdWindow={link.window} />
`;

export default function ViewWellPage() {
  return <DemoPage current="/view-well/">
    <DemoHeader eyebrow="Capability · read-only construction" title="View a well in 2.5D and 3D" lede="Any well record becomes a Blender-rendered construction: one adapter call turns components into an assembly, then the same schematic and cutaway primitives the builder uses render it read-only. Switch to “Follow trajectory” to draw the same records along the surveyed path, or search every record in the inventory. Below, the well file carries the operational record — hole sections, 76 daily reports, 54 service runs, the mud log and a SEG-Y seismic section along the well — all cross-linked to the selected component by depth. “2.5D + seismic” puts the section beside the schematic: zoom, pan or hover either one and the other (and the mud log) follows by measured depth, or unlink them to navigate each on its own. “3D well + seismic + survey” puts the well inside a full 3D cube of the FORGE PSDM volume — 2.75 × 1.52 km × 3.2 km around the well, shown as a solid block you can cut open along the well, across it or at any depth, or as a see-through volume render of the strongest reflectors — with the fully detailed well (casing strings, DLS-coloured path, MD labels, formations) drawn on top, beside the survey log: hover the cube for position, TVD, amplitude and the MD where the well reaches it, or hover the survey log, and the ring on the well, the depth outline around the cube and the survey values move together." points={["One adapter call turns any well record into a 2.5D schematic and 3D cutaway", "Well file: hole sections, 76 daily reports, 54 service runs, mud log and SEG-Y — cross-linked by depth", "2.5D + seismic: zoom, pan or hover either view and the other follows by MD", "3D: the full FORGE PSDM cube with the detailed well and survey log moving together"]} uses={["wellComponentsToAssembly", "AssemblySchematic", "AssemblyScene", "CurvedSchematic", "InteractiveViewport", "ComponentInventory", "HoleSectionLog", "WellHistoryLog", "DaysVsDepthChart", "ServiceRunLog", "LogTracks", "parseLas", "parseSegy", "SeismicSection", "SegyHeaderPanel", "seismicImage", "WellScene", "TrajectoryLog", "SurveyTable", "useDepthLink"]} code={code} />
    <Suspense fallback={<p role="status">Loading well...</p>}><ViewWellDemo /></Suspense>
  </DemoPage>;
}
