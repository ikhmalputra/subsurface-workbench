"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@ikhmalputra/subsurface-react/ui";
import { useWorkspace } from "./workspace-provider";
import { useTools } from "./tools";
import { useSceneSeismic } from "./well-seismic";
import { equatorSite, forgeSite, unlocatedWells } from "../lib/world-sites";
import { projectWell } from "../lib/project";
import { documentHref } from "../lib/tools";

const WellsMap = dynamic(() => import("@ikhmalputra/subsurface-react/gis").then((module) => module.WellsMap), { ssr: false, loading: () => <p role="status" className="demo-world-loading">Loading the map…</p> });
const SiteScene = dynamic(() => import("@ikhmalputra/subsurface-react/3d").then((module) => module.SiteScene), { ssr: false, loading: () => <p role="status" className="demo-world-loading">Loading the 3D site…</p> });

/**
 * The way in: every well the project can place, on a map of the world. Choosing a site flies the
 * map to it and opens the site in 3D beside the map — its wells, the surfaces between them and the
 * seismic over them in one frame. A documented well opens from here into the well workspace.
 */
export function WellsMapDocument() {
  const { fieldProject } = useWorkspace();
  const tools = useTools();
  const router = useRouter();
  const sites = useMemo(() => [forgeSite(), equatorSite(fieldProject)], [fieldProject]);
  const mapSites = useMemo(() => sites.map((site) => site.map), [sites]);
  const unlocated = useMemo(unlocatedWells, []);
  const [selection, setSelection] = useState<{ readonly site: string | null; readonly well: string | null }>({ site: null, well: null });
  const site = sites.find((entry) => entry.map.id === selection.site) ?? null;
  const forge = projectWell("forge");
  const seismic = useSceneSeismic(forge.seismic, site?.hasSeismic === true);
  const placed = sites.reduce((sum, entry) => sum + entry.map.wells.length, 0);

  // The field's register and trajectory tools belong to its correlation and section; the map has its own list.
  // Once, on opening: closePanel is stable in effect but not in identity.
  const closeOnOpen = useRef(tools.closePanel);
  useEffect(() => { closeOnOpen.current("field-register"); closeOnOpen.current("field-trajectory"); }, []);

  const openWell = (id: string) => router.push(documentHref("section", { well: id }));
  const choose = (siteId: string | null, wellId: string | null) => setSelection({ site: siteId, well: wellId });

  return <section className="demo-world" aria-label="Wells map" data-testid="wells-map-document" data-site={selection.site ?? ""}>
    <div className="demo-world-left">
      <div className="demo-world-map">
        <WellsMap sites={mapSites} workerUrl="/gis/maplibre-gl-worker.mjs" basemapUrl="/gis/world-50m.json" basemapAttribution="Natural Earth" selectedSiteId={selection.site} selectedWellId={selection.well} onSelect={choose} />
      </div>
      <nav className="demo-world-list" aria-label="Sites and wells">
        <h2>On the map <span>{sites.length} sites · {placed} wells</span></h2>
        <ul>
          {sites.map((entry) => <li key={entry.map.id} className={entry.map.id === selection.site ? "is-selected" : undefined}>
            <CommandButton kind="selection" className="demo-world-site-button" aria-pressed={entry.map.id === selection.site} onClick={() => choose(entry.map.id, null)}>
              <strong>{entry.map.label}</strong>
              <span className={`demo-world-badge is-${entry.map.provenance}`}>{entry.map.provenance}</span>
              <small>{entry.map.summary}</small>
            </CommandButton>
            {entry.map.wells.length > 1 && <span className="demo-world-wells" role="group" aria-label={`${entry.map.label} wells`}>
              {entry.map.wells.map((well) => <CommandButton key={well.id} kind="selection" aria-pressed={selection.site === entry.map.id && selection.well === well.id} onClick={() => choose(entry.map.id, well.id)}>{well.label}</CommandButton>)}
            </span>}
          </li>)}
        </ul>
        <h2>Without a location <span>{unlocated.length} wells</span></h2>
        <ul>
          {unlocated.map((well) => <li key={well.id} className="is-unlocated">
            <div><strong>{well.label}</strong><small>{well.reason}</small></div>
            <CommandButton icon="view" onClick={() => openWell(well.id)}>Open</CommandButton>
          </li>)}
        </ul>
      </nav>
    </div>
    <div className="demo-world-site">
      {site ? <>
        <header className="demo-world-site-head">
          <div>
            <p><span className={`demo-world-badge is-${site.map.provenance}`}>{site.map.provenance}</span><span className="demo-world-summary">{site.map.summary}</span></p>
            <h2>{site.map.label}</h2>
          </div>
          <div className="demo-world-site-actions">
            {site.projectWellId && <CommandButton icon="view" onClick={() => openWell(site.projectWellId!)}>Open well workspace</CommandButton>}
            {site.documents?.map((entry) => <CommandButton key={entry.id} icon={entry.id === "field-gis" ? "layers" : "view"} onClick={() => router.push(documentHref(entry.id))}>{entry.label}</CommandButton>)}
            <CommandButton icon="globe" onClick={() => choose(null, null)}>Back to world</CommandButton>
          </div>
        </header>
        <p className="demo-world-caveat">{site.caveat}{site.hasSeismic && seismic.loading ? " Loading the seismic volume…" : ""}{seismic.error ? ` The seismic volume could not be loaded: ${seismic.error}.` : ""}</p>
        <div className="demo-world-scene">
          <SiteScene key={site.map.id} title={`${site.map.label} in 3D`} depthLabel={site.depthLabel} originLabel={site.originLabel} wells={site.wells} surfaces={site.surfaces}
            seismic={site.hasSeismic ? seismic.volume : null} seismicClip={site.hasSeismic ? forge.seismic?.meta.section.p99AbsAmplitude : undefined} seismicNote={site.seismicNote}
            selectedWellId={selection.well} onSelectWell={(id) => choose(site.map.id, id)} />
        </div>
      </> : <div className="demo-world-empty">
        <h2>Choose a site</h2>
        <p>Every well the project can place is on the map. Choose one, on the map or in the list, to fly to it and open it in 3D: its wells, the surfaces between them and any seismic over them, in one frame.</p>
        <ul>
          {sites.map((entry) => <li key={entry.map.id}>
            <CommandButton kind="selection" onClick={() => choose(entry.map.id, null)}>
              <span className={`demo-world-badge is-${entry.map.provenance}`}>{entry.map.provenance}</span>
              <strong>{entry.map.label}</strong>
              <small>{entry.map.summary}</small>
            </CommandButton>
          </li>)}
        </ul>
      </div>}
    </div>
  </section>;
}
